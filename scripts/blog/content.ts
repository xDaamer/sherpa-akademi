import fs from "fs";
import path from "path";
import {
  Diagnostics,
  parseFrontmatter,
  readBoolean,
  readDate,
  readFaq,
  readList,
  readText,
  rejectUnknownKeys,
  type Diagnostic,
  type FaqItem,
} from "./frontmatter.js";
import { SLUG_PATTERN, slugify } from "./slug.js";
import { authorPath, categoryPath, postPath, tagPath } from "./urls.js";
import { ARCHETYPES, ARCHETYPE_KEYS, checkEditorial } from "./editorial.js";

/**
 * İÇERİK YÜKLEYİCİ
 * ============================================================================
 * `content/blog/` altındaki markdown dosyalarını okur, doğrular ve aralarındaki
 * ilişkileri çözer. Build'in ilk adımı: burada hata varsa `vite build`e hiç
 * geçilmez.
 *
 * DOĞRULAMA NEDEN BU KADAR SIKI: veritabanı yok, dolayısıyla bir yabancı
 * anahtarın ya da NOT NULL kısıtının tutacağı hiçbir şey yok. Şemanın işini
 * bu dosya yapıyor — var olmayan kategoriye bağlı yazı, kendine referans
 * veren pillar, kırık iç link ve alt metni boş görsel burada yakalanmazsa
 * canlıda yakalanır.
 */

export interface BlogAuthor {
  slug: string;
  /**
   * "kisi" (varsayılan) gerçek bir insan -> Person şeması. "ekip" bir kadro
   * adına yazılan içerik -> Organization şeması. Bir ekibi Person olarak
   * işaretlemek, var olmayan bir kişi beyan etmek demek (E-E-A-T açısından
   * yanıltıcı); gerçek isimli yazarlar eklendikçe onlar "kisi" olur.
   */
  kind: "kisi" | "ekip";
  fullName: string;
  jobTitle: string;
  /** E-E-A-T: mezuniyet, deneyim yılı, sertifika. Person şemasına giriyor. */
  credentials: string;
  avatar: string;
  linkedin: string;
  /** knowsAbout — Person şemasındaki uzmanlık alanları. */
  expertise: string[];
  /** Yazar kutusunda ve /blog/yazar/<slug> sayfasında görünen biyografi. */
  bioMarkdown: string;
  sourcePath: string;
}

export interface BlogCategory {
  slug: string;
  name: string;
  /** §4.2: liste sayfasındaki H1 ("YKS Hazırlık Yazıları"). */
  heading: string;
  parent: string | null;
  seoTitle: string;
  seoDescription: string;
  heroImage: string;
  sortOrder: number;
  /** Kategori sayfasında H1 altında görünen tanıtım metni (§2: min 120 kelime). */
  descriptionMarkdown: string;
  sourcePath: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  /** §4.3: girişteki "kısa cevap" kutusu. AI alıntısı için kritik. */
  tldr: string;
  categorySlug: string;
  tags: string[];
  authorSlug: string;
  /** "X öğretmen tarafından incelendi" — E-E-A-T sinyali, isteğe bağlı. */
  reviewerSlug: string | null;
  publishedAt: Date;
  /** dateModified: yalnızca ANLAMLI içerik değişiminde elle güncellenir. */
  contentUpdatedAt: Date | null;
  /** Tazelik döngüsü takibi (§3.2: 90/180 gün uyarısı). */
  lastReviewedAt: Date | null;
  cover: string;
  coverAlt: string;
  ogImage: string;
  seoTitle: string;
  seoDescription: string;
  focusKeyword: string;
  canonical: string;
  noindex: boolean;
  /** Faz 2 §2'deki 8 arketipten biri: pillar | veri | nasil | karar | ... */
  type: string;
  isPillar: boolean;
  pillarSlug: string | null;
  featured: boolean;
  faq: FaqItem[];
  related: string[];
  bodyMarkdown: string;
  wordCount: number;
  readingTimeMin: number;
  sourcePath: string;
}

export interface BlogRedirect {
  from: string;
  to: string;
}

export interface BlogContent {
  /** Yalnızca YAYINDA olan yazılar, en yeniden eskiye. */
  posts: BlogPost[];
  /** Taslak + ileri tarihli yazılar — build'e girmez, raporda görünür. */
  unpublished: { slug: string; reason: string; sourcePath: string }[];
  categories: BlogCategory[];
  authors: BlogAuthor[];
  tags: { slug: string; name: string; count: number }[];
  redirects: BlogRedirect[];
  warnings: Diagnostic[];
}

const CONTENT_DIR = path.join(process.cwd(), "content", "blog");

const POST_KEYS = [
  "title", "excerpt", "tldr", "category", "tags", "author", "reviewer",
  "status", "publishedAt", "contentUpdatedAt", "lastReviewedAt",
  "cover", "coverAlt", "ogImage",
  "seoTitle", "seoDescription", "focusKeyword", "canonical", "noindex",
  "type", "pillarOf", "featured", "faq", "related",
] as const;

const CATEGORY_KEYS = [
  "name", "heading", "parent", "seoTitle", "seoDescription", "heroImage", "sortOrder",
] as const;

const AUTHOR_KEYS = [
  "kind", "fullName", "jobTitle", "credentials", "avatar", "linkedin", "expertise",
] as const;

/**
 * YAYIN DURUMU TEK KURALLA BELİRLENİR: `status: published` VE `publishedAt`
 * geçmişte. §2 iki mekanizma öneriyordu (cron job ya da sorgu filtresi) ve
 * "ikisini birden yapma" diyordu — burada mekanizma build zamanı filtresidir,
 * bu yüzden ayrı bir `scheduled` durumu YOK: ileri tarihli `published` bir
 * yazı zaten zamanlanmış demektir. İki isim aynı şeyi anlatırsa biri
 * er geç diğeriyle çelişir.
 *
 * SONUÇ (bilerek): ileri tarihli bir yazı, o tarih geldiğinde KENDİLİĞİNDEN
 * yayınlanmaz — yeni bir deploy gerekir. Build raporu bunu uyarı olarak
 * yazıyor; otomatikleştirmek istenirse Vercel Cron + Deploy Hook yeterli.
 */
const STATUSES = new Set(["draft", "published"]);

function readDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
    .sort();
}

function relative(file: string) {
  return path.relative(process.cwd(), file);
}

/** Markdown işaretlerini kabaca atıp kelime sayar. Tam metin değil, ölçü. */
export function countWords(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]/g, " ")
    .replace(/:::\s*\w*/g, " ");

  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/* Ortalama okuma hızı ~200 kelime/dk; yuvarlama yukarı, en az 1 dk. */
const readingTime = (words: number) => Math.max(1, Math.ceil(words / 200));

/* -------------------------------------------------------------------------- */

function loadAuthors(errors: Diagnostic[], warnings: Diagnostic[]): BlogAuthor[] {
  const dir = path.join(CONTENT_DIR, "yazarlar");
  const authors: BlogAuthor[] = [];

  for (const name of readDir(dir)) {
    const file = path.join(dir, name);
    const diag = new Diagnostics(relative(file));
    const parsed = parseFrontmatter(fs.readFileSync(file, "utf-8"), diag);

    if (parsed) {
      rejectUnknownKeys(parsed.data, AUTHOR_KEYS, diag);

      const slug = name.replace(/\.md$/, "");
      if (!SLUG_PATTERN.test(slug)) {
        diag.error(`Dosya adı geçerli bir slug değil: "${slug}".`);
      }

      const credentials = readText(parsed.data, "credentials", diag, { required: true });

      /*
       * E-E-A-T'nin taşıyıcı alanı bu. Doldurulmamış bir şablon metni
       * Person şemasına girip "uzmanlık" iddiası üretirse, o iddia yanlış
       * olur. Hata değil uyarı: yeni bir yazar eklerken build'i kilitlemesin.
       */
      if (/DOLDUR|TODO|örnek metin/i.test(credentials)) {
        diag.warn("`credentials` hâlâ şablon metni içeriyor — gerçek bilgiyle değiştirin.", "credentials");
      }

      const kind = readText(parsed.data, "kind", diag) || "kisi";
      if (kind !== "kisi" && kind !== "ekip") {
        diag.error(`\`kind\` "kisi" ya da "ekip" olmalı: "${kind}".`, "kind");
      }

      authors.push({
        slug,
        kind: kind === "ekip" ? "ekip" : "kisi",
        fullName: readText(parsed.data, "fullName", diag, { required: true, max: 120 }),
        jobTitle: readText(parsed.data, "jobTitle", diag, { required: true, max: 160 }),
        credentials,
        avatar: readText(parsed.data, "avatar", diag),
        linkedin: readText(parsed.data, "linkedin", diag),
        expertise: readList(parsed.data, "expertise", diag),
        bioMarkdown: parsed.body.trim(),
        sourcePath: relative(file),
      });

      if (!parsed.body.trim()) {
        diag.error("Yazar dosyasının gövdesi boş — biyografi `---` bloğundan sonra yazılır.");
      }
    }

    errors.push(...diag.errors);
    warnings.push(...diag.warnings);
  }

  return authors;
}

function loadCategories(errors: Diagnostic[], warnings: Diagnostic[]): BlogCategory[] {
  const dir = path.join(CONTENT_DIR, "kategoriler");
  const categories: BlogCategory[] = [];

  for (const name of readDir(dir)) {
    const file = path.join(dir, name);
    const diag = new Diagnostics(relative(file));
    const parsed = parseFrontmatter(fs.readFileSync(file, "utf-8"), diag);

    if (parsed) {
      rejectUnknownKeys(parsed.data, CATEGORY_KEYS, diag);

      const slug = name.replace(/\.md$/, "");
      if (!SLUG_PATTERN.test(slug)) {
        diag.error(`Dosya adı geçerli bir slug değil: "${slug}".`);
      }

      const categoryName = readText(parsed.data, "name", diag, { required: true, max: 120 });
      const description = parsed.body.trim();

      /* §2: kategori açıklaması en az 120 kelime — "boş kategori sayfası"
         sinyali vermemek için. Yayını engellemeyen bir SEO tavsiyesi. */
      const words = countWords(description);
      if (words < 120) {
        diag.warn(`Kategori açıklaması ${words} kelime; hedef en az 120.`);
      }

      const sortOrderRaw = parsed.data.sortOrder;
      if (sortOrderRaw !== undefined && typeof sortOrderRaw !== "number") {
        diag.error("`sortOrder` sayı olmalı.", "sortOrder");
      }

      categories.push({
        slug,
        name: categoryName,
        heading: readText(parsed.data, "heading", diag, { max: 120 }) || `${categoryName} Yazıları`,
        parent: readText(parsed.data, "parent", diag) || null,
        seoTitle: readText(parsed.data, "seoTitle", diag, { max: 70 }),
        seoDescription: readText(parsed.data, "seoDescription", diag, { max: 170, min: 140 }),
        heroImage: readText(parsed.data, "heroImage", diag),
        sortOrder: typeof sortOrderRaw === "number" ? sortOrderRaw : 0,
        descriptionMarkdown: description,
        sourcePath: relative(file),
      });
    }

    errors.push(...diag.errors);
    warnings.push(...diag.warnings);
  }

  return categories.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));
}

interface LoadedPost {
  post: BlogPost;
  published: boolean;
  reason: string;
}

function loadPosts(
  errors: Diagnostic[],
  warnings: Diagnostic[],
  now: Date,
): LoadedPost[] {
  const dir = path.join(CONTENT_DIR, "yazilar");
  const loaded: LoadedPost[] = [];

  for (const name of readDir(dir)) {
    const file = path.join(dir, name);
    const diag = new Diagnostics(relative(file));
    const parsed = parseFrontmatter(fs.readFileSync(file, "utf-8"), diag);

    if (!parsed) {
      errors.push(...diag.errors);
      warnings.push(...diag.warnings);
      continue;
    }

    rejectUnknownKeys(parsed.data, POST_KEYS, diag);

    /* SLUG DOSYA ADINDAN GELİR, frontmatter'dan değil: iki kaynak olsaydı
       birbirinden ayrı düşerlerdi ve hangisinin adres olduğu belirsizleşirdi.
       Dosyayı yeniden adlandırmak = adresi değiştirmek; eski adres için
       yonlendirmeler.json'a satır eklemek gerekir. */
    const slug = name.replace(/\.md$/, "");
    if (!SLUG_PATTERN.test(slug)) {
      diag.error(`Dosya adı geçerli bir slug değil: "${slug}" (küçük harf, rakam ve tire).`);
    }
    if (slug.length > 200) {
      diag.error("Slug 200 karakteri aşıyor.");
    }
    if (/(^|-)(19|20)\d{2}(-|$)/.test(slug)) {
      diag.warn("Slug yıl içeriyor. Yazı güncellendiğinde adres yanıltıcı olur; yılı başlıkta tutun.");
    }
    if (slug.split("-").length > 6) {
      diag.warn(`Slug ${slug.split("-").length} kelime; 3-6 kelime hedefleniyor.`);
    }

    const status = readText(parsed.data, "status", diag, { required: true });
    if (status && !STATUSES.has(status)) {
      diag.error(`\`status\` yalnızca "draft" veya "published" olabilir (bulunan: "${status}").`, "status");
    }

    const isPublished = status === "published";
    const publishedAt = readDate(parsed.data, "publishedAt", diag, { required: isPublished });
    const contentUpdatedAt = readDate(parsed.data, "contentUpdatedAt", diag);
    const lastReviewedAt = readDate(parsed.data, "lastReviewedAt", diag);

    /* §6 doğrulama kuralı: dateModified >= datePublished. Şemayı üretirken
       değil, burada yakalanmalı — orada yakalamak kırık şemayı yayına
       çıkarmak demek olurdu. */
    if (publishedAt && contentUpdatedAt && contentUpdatedAt < publishedAt) {
      diag.error("`contentUpdatedAt`, `publishedAt`ten önce olamaz.", "contentUpdatedAt");
    }

    const cover = readText(parsed.data, "cover", diag);
    const coverAlt = readText(parsed.data, "coverAlt", diag, { max: 200 });

    /* KABUL KRİTERİ: alt metni olmayan görselle yazı yayınlanamaz. */
    if (cover && !coverAlt) {
      diag.error("Kapak görseli var ama `coverAlt` boş. Alt metin zorunlu.", "coverAlt");
    }

    const canonical = readText(parsed.data, "canonical", diag);
    /*
     * §11.3 A04: `canonical` alanına dış alan adı yazılabilseydi, bir yazı
     * tüm SEO otoritesini dışarıya devredebilirdi. Yalnızca kendi sitemizin
     * yolları kabul ediliyor; "//baska.site" da reddediliyor çünkü tarayıcı
     * onu protokol-göreli mutlak adres olarak çözer.
     */
    if (canonical && (!canonical.startsWith("/") || canonical.startsWith("//"))) {
      diag.error("`canonical` yalnızca kendi sitemizin yolu olabilir (`/` ile başlamalı).", "canonical");
    }

    /*
     * ARKETİP (Faz 2 §2). Ayrı bir `pillar: true` bayrağı YOK: pillar bir
     * tür, bayrak değil. İkisi birden olsaydı "type: veri + pillar: true"
     * gibi anlamsız bir kombinasyon mümkün olur ve hangisinin kazandığı
     * belirsiz kalırdı.
     */
    const type = readText(parsed.data, "type", diag, { required: true });
    if (type && !ARCHETYPES[type]) {
      diag.error(
        `\`type\` şu değerlerden biri olmalı: ${ARCHETYPE_KEYS.join(", ")} (bulunan: "${type}").`,
        "type",
      );
    }

    const isPillar = type === "pillar";
    const pillarSlug = readText(parsed.data, "pillarOf", diag) || null;

    if (isPillar && pillarSlug) {
      diag.error("Pillar yazı başka bir pillar'a bağlanamaz; `pillarOf` alanını silin.", "pillarOf");
    }
    if (pillarSlug === slug) {
      diag.error("`pillarOf` yazının kendisini gösteremez.", "pillarOf");
    }

    const related = readList(parsed.data, "related", diag, { max: 4 });
    if (related.includes(slug)) {
      diag.error("`related` yazının kendisini içeremez.", "related");
    }

    const tags = readList(parsed.data, "tags", diag);
    for (const tag of tags) {
      if (!SLUG_PATTERN.test(tag)) {
        diag.error(`Etiket slug biçiminde olmalı: "${tag}" -> "${slugify(tag)}".`, "tags");
      }
    }

    const body = parsed.body.trim();
    if (!body) {
      diag.error("Yazının gövdesi boş.");
    }

    /* §3.2: H1 editörde kullanılamaz — sayfadaki tek H1 `title`dan gelir.
       Markdown'da `# ` ile başlayan bir satır ikinci bir H1 üretirdi. */
    if (/^#\s+/m.test(body)) {
      diag.error("Gövdede `# ` (H1) kullanılamaz; sayfadaki tek H1 `title` alanıdır. En üst seviye `## ` olmalı.");
    }

    const words = countWords(body);
    const title = readText(parsed.data, "title", diag, { required: true, max: 200 });

    const post: BlogPost = {
      slug,
      title,
      excerpt: readText(parsed.data, "excerpt", diag, { required: true, max: 320 }),
      tldr: readText(parsed.data, "tldr", diag, { required: isPublished }),
      categorySlug: readText(parsed.data, "category", diag, { required: true }),
      tags,
      authorSlug: readText(parsed.data, "author", diag, { required: true }),
      reviewerSlug: readText(parsed.data, "reviewer", diag) || null,
      publishedAt: publishedAt ?? new Date(0),
      contentUpdatedAt,
      lastReviewedAt,
      cover,
      coverAlt,
      ogImage: readText(parsed.data, "ogImage", diag),
      seoTitle: readText(parsed.data, "seoTitle", diag, { max: 70 }),
      seoDescription: readText(parsed.data, "seoDescription", diag, { max: 170, min: 140 }),
      focusKeyword: readText(parsed.data, "focusKeyword", diag, { max: 120 }),
      canonical,
      noindex: readBoolean(parsed.data, "noindex", diag),
      type,
      isPillar,
      pillarSlug,
      featured: readBoolean(parsed.data, "featured", diag),
      faq: readFaq(parsed.data, diag),
      related,
      bodyMarkdown: body,
      wordCount: words,
      readingTimeMin: readingTime(words),
      sourcePath: relative(file),
    };

    let reason = "";
    if (status === "draft") reason = "taslak";
    else if (publishedAt && publishedAt > now) {
      reason = `ileri tarihli (${publishedAt.toISOString().slice(0, 10)})`;
      diag.warn(
        `Yayın tarihi gelecekte. O tarih geldiğinde KENDİLİĞİNDEN yayınlanmaz — yeniden deploy gerekir.`,
        "publishedAt",
      );
    }

    loaded.push({ post, published: isPublished && !reason, reason });

    errors.push(...diag.errors);
    warnings.push(...diag.warnings);
  }

  return loaded;
}

/* -------------------------------------------------------------------------- */

/**
 * YÖNLENDİRMELER — `content/blog/yonlendirmeler.json`
 *
 * §11.3 A04'ün en kolay gözden kaçan zafiyeti open redirect'ti. Burada
 * hedef DIŞ ADRES OLAMAZ: yalnızca `/` ile başlayan, `//` ile başlamayan
 * kendi yollarımız kabul ediliyor. Ayrıca zincir (A->B->C) ve döngü
 * (A->B->A) reddediliyor: §10.3 "tek hop" istiyor.
 */
function loadRedirects(errors: Diagnostic[], warnings: Diagnostic[]): BlogRedirect[] {
  const file = path.join(CONTENT_DIR, "yonlendirmeler.json");
  if (!fs.existsSync(file)) return [];

  const diag = new Diagnostics(relative(file));
  let raw: unknown;

  try {
    raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err: any) {
    diag.error(`JSON okunamadı: ${err?.message || err}`);
    errors.push(...diag.errors);
    return [];
  }

  if (!Array.isArray(raw)) {
    diag.error("Dosya bir liste olmalı: [{ \"from\": \"/blog/eski\", \"to\": \"/blog/yeni\" }]");
    errors.push(...diag.errors);
    return [];
  }

  const redirects: BlogRedirect[] = [];
  const seen = new Set<string>();

  raw.forEach((entry, index) => {
    const record = entry as Record<string, unknown>;
    const from = typeof record?.from === "string" ? record.from.trim() : "";
    const to = typeof record?.to === "string" ? record.to.trim() : "";

    if (!from || !to) {
      diag.error(`[${index}] hem \`from\` hem \`to\` içermeli.`);
      return;
    }

    for (const [label, value] of [["from", from], ["to", to]] as const) {
      if (!value.startsWith("/") || value.startsWith("//")) {
        diag.error(`[${index}] \`${label}\` kendi sitemizin yolu olmalı ("/" ile başlamalı, "//" ile değil): "${value}"`);
      }
      if (/[\r\n]/.test(value)) {
        diag.error(`[${index}] \`${label}\` satır sonu içeremez.`);
      }
    }

    if (from === to) {
      diag.error(`[${index}] kendine yönlendirme: "${from}"`);
      return;
    }
    if (seen.has(from)) {
      diag.error(`[${index}] "${from}" için ikinci bir yönlendirme var.`);
      return;
    }

    seen.add(from);
    redirects.push({ from, to });
  });

  /* Zincir: bir yönlendirmenin hedefi başka bir yönlendirmenin kaynağıysa
     tarayıcı iki hop atar. Döngü de aynı kontrolle yakalanıyor. */
  for (const redirect of redirects) {
    if (seen.has(redirect.to)) {
      diag.error(
        `Zincir: "${redirect.from}" -> "${redirect.to}" ve "${redirect.to}" da yönlendiriliyor. Doğrudan son hedefi yazın.`,
      );
    }
  }

  errors.push(...diag.errors);
  warnings.push(...diag.warnings);
  return redirects;
}

/* -------------------------------------------------------------------------- */

/**
 * Gövdedeki linkleri ve görselleri doğrular.
 *
 * `clusterSlugs`: bu yazıyla AYNI kümedeki diğer yazılar. Faz 2 §3.8 iç link
 * asgarisini "kendi kümesinden 3 yazı" diye tanımlıyor — rastgele 3 link
 * değil. Küme dışına verilen linkler sayılmaz, çünkü kümenin işi otoriteyi
 * kendi içinde dolaştırmak.
 */
function scanBody(
  post: BlogPost,
  knownPaths: Set<string>,
  clusterSlugs: Set<string>,
  diag: Diagnostics,
) {
  /* Görseller: alt metni boş olan HATA (kabul kriteri). */
  const images = [...post.bodyMarkdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g)];
  for (const [, alt, src] of images) {
    if (!alt.trim()) {
      diag.error(`Alt metni boş görsel: ${src}`);
    }
  }

  /* Linkler: görsel sözdiziminin parçası olanlar hariç (öndeki "!" ile ayrılıyor). */
  const links = [...post.bodyMarkdown.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g)]
    .filter(([, bang]) => bang !== "!")
    .map(([, , , href]) => href);

  let internal = 0;
  let withinCluster = 0;
  let toPillar = false;

  for (const href of links) {
    if (href.startsWith("#") || /^https?:\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("tel:")) {
      continue;
    }

    if (!href.startsWith("/")) {
      diag.error(`İç link "/" ile başlamalı (göreli yol kullanmayın): "${href}"`);
      continue;
    }

    const clean = href.split("#")[0].split("?")[0].replace(/\/$/, "") || "/";

    if (!knownPaths.has(clean)) {
      diag.error(`Kırık iç link: "${href}" böyle bir sayfa yok.`);
      continue;
    }

    internal += 1;
    if (post.pillarSlug && clean === postPath(post.pillarSlug)) {
      toPillar = true;
    }
    for (const sibling of clusterSlugs) {
      if (clean === postPath(sibling)) {
        withinCluster += 1;
        break;
      }
    }
  }

  /*
   * İÇ LİNK ASGARİSİ (Faz 2 §3.8). Üçü de uyarı: yayını engellemezler ama
   * kümeyi zayıflatırlar.
   */
  if (internal < 3) {
    diag.warn(`Yazıda ${internal} iç link var; en az 3 hedefleniyor.`);
  }
  if (clusterSlugs.size > 0 && withinCluster < 3) {
    diag.warn(
      `Kendi kümesinden ${withinCluster} yazıya link var; en az 3 öneriliyor (küme içi bağlantı otoriteyi dolaştırır).`,
    );
  }
  if (post.pillarSlug && !toPillar) {
    diag.warn(`Bağlı olduğu pillar yazıya ("${post.pillarSlug}") link verilmemiş.`);
  }
}

/* -------------------------------------------------------------------------- */

export class ContentError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(`${diagnostics.length} içerik hatası bulundu.`);
    this.name = "ContentError";
  }
}

export function loadBlogContent(now: Date = new Date()): BlogContent {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];

  const authors = loadAuthors(errors, warnings);
  const categories = loadCategories(errors, warnings);
  const loaded = loadPosts(errors, warnings, now);
  const redirects = loadRedirects(errors, warnings);

  const authorSlugs = new Set(authors.map((author) => author.slug));
  const categorySlugs = new Set(categories.map((category) => category.slug));

  /* Üst kategori var mı — §2: iki seviye yeter, daha derine izin yok. */
  for (const category of categories) {
    const diag = new Diagnostics(category.sourcePath);
    if (category.parent) {
      if (!categorySlugs.has(category.parent)) {
        diag.error(`\`parent\` diye bir kategori yok: "${category.parent}".`, "parent");
      } else {
        const parent = categories.find((item) => item.slug === category.parent);
        if (parent?.parent) {
          diag.error("Kategori ağacı en fazla iki seviye olabilir.", "parent");
        }
      }
    }
    errors.push(...diag.errors);
  }

  const published = loaded.filter((item) => item.published).map((item) => item.post);
  const publishedSlugs = new Set(published.map((post) => post.slug));

  /*
   * Bilinen yolların tamamı — iç link doğrulaması bunun üzerinden yapılıyor.
   * Yalnızca YAYINDAKİ sayfalar var: taslağa verilen link canlıda 404 olur,
   * dolayısıyla kırık link sayılır ve build'i durdurur.
   */
  const knownPaths = new Set<string>([
    "/", "/gizlilik-politikasi", "/kullanim-kosullari", "/blog",
  ]);
  for (const post of published) knownPaths.add(postPath(post.slug));
  for (const category of categories) knownPaths.add(categoryPath(category.slug));
  for (const author of authors) knownPaths.add(authorPath(author.slug));

  const tagCounts = new Map<string, number>();
  for (const post of published) {
    for (const tag of post.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  for (const tag of tagCounts.keys()) knownPaths.add(tagPath(tag));

  /*
   * KÜME HARİTASI (Faz 2 §1). Bir kümenin üyeleri: pillar'ın kendisi ve ona
   * `pillarOf` ile bağlanan yazılar. İç link asgarisi bu küme üzerinden
   * ölçülüyor, kategori üzerinden değil — kategori bir raf, küme ise bir
   * konu etrafındaki bağlantı ağı; ikisi aynı şey değil.
   */
  const clusterMembers = new Map<string, Set<string>>();
  for (const post of published) {
    const key = post.isPillar ? post.slug : post.pillarSlug;
    if (!key) continue;
    const members = clusterMembers.get(key) ?? new Set<string>();
    members.add(post.slug);
    clusterMembers.set(key, members);
  }

  /* Yazıların çapraz referansları — kategori/yazar/pillar/ilgili yazılar. */
  for (const { post, published: isLive } of loaded) {
    const diag = new Diagnostics(post.sourcePath);

    if (post.categorySlug && !categorySlugs.has(post.categorySlug)) {
      diag.error(`\`category\` diye bir kategori yok: "${post.categorySlug}".`, "category");
    }
    if (post.authorSlug && !authorSlugs.has(post.authorSlug)) {
      diag.error(`\`author\` diye bir yazar yok: "${post.authorSlug}".`, "author");
    }
    if (post.reviewerSlug && !authorSlugs.has(post.reviewerSlug)) {
      diag.error(`\`reviewer\` diye bir yazar yok: "${post.reviewerSlug}".`, "reviewer");
    }

    /* Yalnızca yayındaki yazılar için: taslak, yayındaki bir yazıya
       bağlanamıyorsa bu henüz bir sorun değil. */
    if (isLive) {
      if (post.pillarSlug && !publishedSlugs.has(post.pillarSlug)) {
        diag.error(`\`pillarOf\` yayında olan bir yazı olmalı: "${post.pillarSlug}".`, "pillarOf");
      }
      for (const slug of post.related) {
        if (!publishedSlugs.has(slug)) {
          diag.error(`\`related\` içindeki "${slug}" yayında değil ya da yok.`, "related");
        }
      }
      const clusterKey = post.isPillar ? post.slug : post.pillarSlug;
      const siblings = new Set(clusterMembers.get(clusterKey ?? "") ?? []);
      siblings.delete(post.slug);

      scanBody(post, knownPaths, siblings, diag);

      checkEditorial(
        {
          type: post.type,
          title: post.title,
          slug: post.slug,
          seoTitle: post.seoTitle,
          seoDescription: post.seoDescription,
          excerpt: post.excerpt,
          focusKeyword: post.focusKeyword,
          coverAlt: post.coverAlt,
          tldr: post.tldr,
          faqCount: post.faq.length,
        },
        post.bodyMarkdown,
        diag,
      );

      /* Faz 2 §1: her yazı tek bir kümeye ait. Küme dışında duran bir yazı
         ne otorite alır ne verir — uyarı, çünkü araç/duyuru sayfalarının
         kümesiz durması meşru olabilir. */
      if (!post.isPillar && !post.pillarSlug) {
        diag.warn("Yazı hiçbir kümeye bağlı değil (`pillarOf` boş).", "pillarOf");
      }
    }

    errors.push(...diag.errors);
    warnings.push(...diag.warnings);
  }

  /*
   * KÜME BÜTÜNLÜĞÜ — PILLAR HER CLUSTER'A LİNK VERMELİ (Faz 2 §1)
   * ---------------------------------------------------------------------------
   * Faz 2 bunu açıkça söylüyor: "Yeni cluster yayınlandığında pillar
   * güncellenir ve linki eklenir. Bu adım atlanırsa küme çalışmaz."
   *
   * UYARI DEĞİL HATA olmasının sebebi tam olarak bu cümle. Uyarı olsaydı
   * atlanacak şey tam da bu olurdu: yeni yazıyı yazan kişi onu yayınlar,
   * pillar'a dönüp link eklemeyi unutur, uyarı listesinde kaybolur ve altı
   * ay sonra pillar on cluster'ın üçüne bağlı kalır. Hata olduğunda cluster
   * ile pillar güncellemesi AYNI commit'te olmak zorunda.
   */
  for (const [pillarSlug, members] of clusterMembers) {
    const pillar = published.find((post) => post.slug === pillarSlug);
    if (!pillar) continue;

    const diag = new Diagnostics(pillar.sourcePath);

    for (const member of members) {
      if (member === pillarSlug) continue;
      if (!pillar.bodyMarkdown.includes(postPath(member))) {
        diag.error(
          `Kümedeki "${member}" yazısına link verilmemiş. ` +
          `Pillar her cluster'a link vermeli — ilgili paragrafın içinden, sonda liste olarak değil.`,
        );
      }
    }

    errors.push(...diag.errors);
  }

  /*
   * ANAHTAR KELİME KANİBALİZASYONU (Faz 2 §1)
   * Aynı odak kelimeyi hedefleyen iki yazı birbirinin sıralamasını yiyor ve
   * Google hangisini göstereceğine kendi karar veriyor — genelde yanlış olana.
   * Faz 2'nin reçetesi net: "Şüphe varsa mevcut yazıyı genişlet, yeni yazı
   * açma." Bu yüzden hata.
   */
  const byKeyword = new Map<string, BlogPost[]>();
  for (const post of published) {
    if (!post.focusKeyword) continue;
    const key = slugify(post.focusKeyword);
    byKeyword.set(key, [...(byKeyword.get(key) ?? []), post]);
  }
  for (const [, rivals] of byKeyword) {
    if (rivals.length < 2) continue;
    for (const post of rivals) {
      const diag = new Diagnostics(post.sourcePath);
      const others = rivals.filter((rival) => rival !== post).map((rival) => rival.slug);
      diag.error(
        `Aynı odak kelimeyi ("${post.focusKeyword}") hedefleyen başka yazı(lar) var: ${others.join(", ")}. ` +
        `Kanibalizasyon — yazılardan birini genişletip diğerini ona yönlendirin.`,
        "focusKeyword",
      );
      errors.push(...diag.errors);
    }
  }

  /* Yönlendirme hedefi gerçekten var mı? Olmayan bir sayfaya 301 atmak,
     kullanıcıyı 404'e iki adımda götürmektir. */
  for (const redirect of redirects) {
    const diag = new Diagnostics("content/blog/yonlendirmeler.json");
    const clean = redirect.to.split("#")[0].replace(/\/$/, "") || "/";
    if (!knownPaths.has(clean)) {
      diag.error(`Yönlendirme hedefi yok: "${redirect.to}"`);
    }
    if (knownPaths.has(redirect.from.replace(/\/$/, ""))) {
      diag.error(`"${redirect.from}" hem yayında bir sayfa hem de yönlendirme kaynağı.`);
    }
    errors.push(...diag.errors);
  }

  if (errors.length > 0) throw new ContentError(errors);

  published.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  const tags = [...tagCounts.entries()]
    .map(([slug, count]) => ({ slug, name: slug.replace(/-/g, " "), count }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug, "tr"));

  return {
    posts: published,
    unpublished: loaded
      .filter((item) => !item.published)
      .map((item) => ({ slug: item.post.slug, reason: item.reason || "yayında değil", sourcePath: item.post.sourcePath })),
    categories,
    authors,
    tags,
    redirects,
    warnings,
  };
}
