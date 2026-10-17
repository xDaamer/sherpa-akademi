import need from "../../need.json" with { type: "json" };
import type { BlogAuthor, BlogCategory, BlogContent, BlogPost } from "./content.js";
import { renderInline, renderMarkdown, type TocEntry } from "./markdown.js";
import { renderedTitle } from "./editorial.js";
import {
  absolute, authorPath, blogHome, blogPage, categoryPage, categoryPath,
  postPath, rssPath, searchPath, tagPath,
} from "./urls.js";

/**
 * SAYFA ŞABLONLARI — SUNUCUDA DEĞİL, BUILD'DE ÇALIŞIR
 * ============================================================================
 * Public blog sayfaları React ile DEĞİL, burada düz HTML olarak üretiliyor ve
 * `dist/blog/**` altına statik dosya olarak yazılıyor.
 *
 * Gerekçe (Faz 1 §4: "tüm public blog sayfaları sunucu tarafında render
 * edilmeli"): site bir SPA ve içeriği JS üretiyor. Arama motoru ve AI
 * tarayıcıları için içeriğin HTML'de HAZIR olması gerekiyor. Statik üretim
 * bunu tanım gereği sağlıyor — JS hiç çalışmasa da yazı HTML'de duruyor.
 *
 * İkinci kazanç: panel bundle'ı bloga hiç girmiyor. Blog sayfaları kendi
 * küçük CSS'ini yüklüyor, React yüklemiyor.
 */

const SITE = need.site.domain.replace(/\/+$/, "");
const BRAND = need.site.name;

/** HTML'e gömülen her kullanıcı metni buradan geçer. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON-LD gövdesi <script> içine giriyor; "</script>" dizisi kaçırılmalı. */
function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

const TR_AY = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

/* Tarihler Türkiye saatinde gösteriliyor — yazı tarihleri +03:00 olarak
   yorumlanıyor (bkz. frontmatter.ts), gösterim de aynı dilimde olmalı. */
export function formatDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul", day: "numeric", month: "numeric", year: "numeric",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${TR_AY[Number(get("month")) - 1]} ${get("year")}`;
}

const isoDate = (date: Date) => date.toISOString();

interface LayoutOptions {
  title: string;
  description: string;
  path: string;
  /** Kanonik adres; verilmezse path'ten üretilir. */
  canonical?: string;
  noindex?: boolean;
  ogType?: "website" | "article";
  ogImage?: string;
  graph: unknown[];
  body: string;
  /** Sayfalamada rel=prev/next. */
  prev?: string;
  next?: string;
}

/**
 * Ortak sayfa kabuğu.
 *
 * Header ve footer, pazarlama sitesinin React bileşenlerinden BAĞIMSIZ olarak
 * burada tekrar yazılıyor. Bu bir tekrar ve bilinçli: React bileşenlerini
 * build zamanında render etmek, React'i ve Tailwind'in hash'li CSS dosyasını
 * bu hattın içine sokmak demekti. Bedel, marka renkleri değişirse iki yerin
 * güncellenmesi; karşılığı, blogun tamamen bağımsız ve hafif kalması.
 */
export function layout(options: LayoutOptions): string {
  const canonical = options.canonical ?? absolute(SITE, options.path);
  const robots = options.noindex
    ? "noindex, follow"
    : "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1";
  const ogImage = options.ogImage ?? `${SITE}/og-image.png`;
  const fullTitle = options.title;

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(options.description)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${esc(canonical)}">
${options.prev ? `<link rel="prev" href="${esc(options.prev)}">\n` : ""}${options.next ? `<link rel="next" href="${esc(options.next)}">\n` : ""}<meta property="og:type" content="${options.ogType ?? "website"}">
<meta property="og:site_name" content="${esc(BRAND)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(options.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:locale" content="tr_TR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(options.description)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<link rel="icon" type="image/x-icon" href="/favicon.ico?v=6">
<link rel="icon" type="image/png" sizes="256x256" href="/favicon.png?v=6">
<link rel="shortcut icon" href="/favicon.ico?v=6">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=6">
<link rel="alternate" type="application/rss+xml" title="${esc(BRAND)} Blog" href="${rssPath()}">
<meta name="theme-color" content="#191F61">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geologica:wght@400;600;800&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geologica:wght@400;600;800&display=swap"></noscript>
<link rel="stylesheet" href="/blog.css">
<script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@graph": options.graph })}</script>
</head>
<body>
<a class="atla" href="#icerik">İçeriğe atla</a>
<header class="ust">
  <div class="kap ust-ic">
    <a class="marka" href="/">${esc(BRAND)}</a>
    <nav class="ust-menu" aria-label="Site">
      <a href="/">Ana sayfa</a>
      <a href="${blogHome()}">Blog</a>
      <a class="dugme dugme-kucuk" href="/#paketler">Ücretsiz ön görüşme</a>
    </nav>
  </div>
</header>
<main id="icerik">
${options.body}
</main>
<footer class="alt">
  <div class="kap alt-ic">
    <div>
      <p class="alt-marka">${esc(BRAND)}</p>
      <p class="alt-metin">${esc(need.site.description)}</p>
    </div>
    <nav class="alt-menu" aria-label="Alt bilgi">
      <a href="/">Ana sayfa</a>
      <a href="${blogHome()}">Blog</a>
      <a href="/gizlilik-politikasi">Gizlilik politikası</a>
      <a href="/kullanim-kosullari">Kullanım koşulları</a>
      <a href="${rssPath()}">RSS</a>
    </nav>
  </div>
  <p class="alt-telif">© ${new Date().getFullYear()} ${esc(BRAND)}</p>
</footer>
</body>
</html>
`;
}

/* -------------------------------------------------------------------------- */
/* JSON-LD parçaları — @id ile birbirine bağlanıyor (Faz 1 §6).                */

export function organizationNode() {
  return {
    "@type": "EducationalOrganization",
    "@id": `${SITE}/#organization`,
    name: BRAND,
    url: `${SITE}/`,
    logo: `${SITE}${need.site.logoUrl}`,
    sameAs: Object.values(need.social),
  };
}

export function personNode(author: BlogAuthor) {
  const url = absolute(SITE, authorPath(author.slug));
  if (author.kind === "ekip") {
    // Ekip bir kişi değil: kuruluşun alt birimi olarak işaretleniyor. @id
    // parçası "#person" olarak kalıyor ki BlogPosting.author / ProfilePage
    // referansları tek yerden değişmeden çözülsün.
    return {
      "@type": "Organization",
      "@id": url + "#person",
      name: author.fullName,
      description: author.credentials,
      url,
      parentOrganization: { "@id": `${SITE}/#organization` },
      ...(author.expertise.length > 0 ? { knowsAbout: author.expertise } : {}),
    };
  }
  return {
    "@type": "Person",
    "@id": url + "#person",
    name: author.fullName,
    jobTitle: author.jobTitle,
    description: author.credentials,
    url,
    ...(author.expertise.length > 0 ? { knowsAbout: author.expertise } : {}),
    ...(author.linkedin ? { sameAs: [author.linkedin] } : {}),
  };
}

export function breadcrumbNode(items: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absolute(SITE, item.path),
    })),
  };
}

/* -------------------------------------------------------------------------- */

function breadcrumbHtml(items: { name: string; path: string }[]): string {
  const parts = items.map((item, index) =>
    index === items.length - 1
      ? `<span aria-current="page">${esc(item.name)}</span>`
      : `<a href="${item.path}">${esc(item.name)}</a>`,
  );
  return `<nav class="kirinti kap" aria-label="Sayfa yolu">${parts.join('<span class="ayrac">›</span>')}</nav>`;
}

function cardHtml(post: BlogPost, categories: BlogCategory[]): string {
  const category = categories.find((item) => item.slug === post.categorySlug);
  return `<article class="kart">
  <a class="kart-kategori" href="${categoryPath(post.categorySlug)}">${esc(category?.name ?? "")}</a>
  <h3 class="kart-baslik"><a href="${postPath(post.slug)}">${esc(post.title)}</a></h3>
  <p class="kart-ozet">${esc(post.excerpt)}</p>
  <p class="kart-meta"><time datetime="${isoDate(post.publishedAt)}">${formatDate(post.publishedAt)}</time> · ${post.readingTimeMin} dk okuma</p>
</article>`;
}

function ctaHtml(baslik: string, metin: string): string {
  return `<aside class="cta">
  <h2 class="cta-baslik">${esc(baslik)}</h2>
  <p class="cta-metin">${esc(metin)}</p>
  <p><a class="dugme" href="/#paketler">Ücretsiz ön görüşme talep et</a></p>
</aside>`;
}

function tocHtml(toc: TocEntry[]): string {
  if (toc.length < 3) return "";
  const items = toc
    .map((entry) => `<li class="toc-${entry.level}"><a href="#${entry.id}">${esc(entry.text)}</a></li>`)
    .join("\n");
  return `<details class="toc" open>
  <summary>İçindekiler</summary>
  <ol>
${items}
  </ol>
</details>`;
}

function faqHtml(faq: { q: string; a: string }[]): string {
  if (faq.length === 0) return "";
  const items = faq
    .map((item) => `<details class="sss-oge"><summary>${esc(item.q)}</summary><p>${esc(item.a)}</p></details>`)
    .join("\n");
  return `<section class="sss">
  <h2 id="sikca-sorulan-sorular">Sıkça sorulan sorular <a class="capa" href="#sikca-sorulan-sorular" aria-label="Bu bölüme bağlantı">#</a></h2>
${items}
</section>`;
}

function authorBoxHtml(author: BlogAuthor, reviewer: BlogAuthor | null): string {
  return `<section class="yazar-kutu">
  <h2 class="yazar-baslik">Yazar</h2>
  <p class="yazar-ad"><a href="${authorPath(author.slug)}">${esc(author.fullName)}</a></p>
  <p class="yazar-unvan">${esc(author.jobTitle)}</p>
  <p class="yazar-kimlik">${esc(author.credentials)}</p>
  ${reviewer ? `<p class="yazar-inceleme">Bu yazı <a href="${authorPath(reviewer.slug)}">${esc(reviewer.fullName)}</a> tarafından incelendi.</p>` : ""}
</section>`;
}

/* -------------------------------------------------------------------------- */

export function postPage(post: BlogPost, content: BlogContent): string {
  const author = content.authors.find((item) => item.slug === post.authorSlug)!;
  const reviewer = post.reviewerSlug
    ? content.authors.find((item) => item.slug === post.reviewerSlug) ?? null
    : null;
  const category = content.categories.find((item) => item.slug === post.categorySlug)!;
  const { html, toc } = renderMarkdown(post.bodyMarkdown);

  const modified = post.contentUpdatedAt ?? post.publishedAt;
  const canonical = post.canonical ? absolute(SITE, post.canonical) : absolute(SITE, postPath(post.slug));

  /* Aynı kümedeki diğer yazılar. */
  const clusterKey = post.isPillar ? post.slug : post.pillarSlug;
  const cluster = clusterKey
    ? content.posts.filter(
        (item) => item.slug !== post.slug && (item.slug === clusterKey || item.pillarSlug === clusterKey),
      )
    : [];

  /* İlgili yazılar: elle verilmişse o, yoksa aynı kategoriden en yeniler. */
  const related = post.related.length > 0
    ? post.related.map((slug) => content.posts.find((item) => item.slug === slug)!).filter(Boolean)
    : content.posts
        .filter((item) => item.slug !== post.slug && item.categorySlug === post.categorySlug)
        .slice(0, 3);

  const crumbs = [
    { name: "Ana Sayfa", path: "/" },
    { name: "Blog", path: blogHome() },
    { name: category.name, path: categoryPath(category.slug) },
    { name: post.title, path: postPath(post.slug) },
  ];

  const graph: unknown[] = [
    {
      "@type": "BlogPosting",
      "@id": `${canonical}#article`,
      /* headline <= 110 karakter (Faz 1 §6); başlık uzunsa kırpılıyor. */
      headline: post.title.length > 110 ? `${post.title.slice(0, 107)}...` : post.title,
      description: post.seoDescription || post.excerpt,
      inLanguage: "tr-TR",
      datePublished: isoDate(post.publishedAt),
      dateModified: isoDate(modified),
      wordCount: post.wordCount,
      timeRequired: `PT${post.readingTimeMin}M`,
      articleSection: category.name,
      keywords: post.tags.join(", ") || undefined,
      mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
      author: { "@id": absolute(SITE, authorPath(author.slug)) + "#person" },
      publisher: { "@id": `${SITE}/#organization` },
      ...(reviewer ? { reviewedBy: { "@id": absolute(SITE, authorPath(reviewer.slug)) + "#person" } } : {}),
    },
    personNode(author),
    ...(reviewer ? [personNode(reviewer)] : []),
    organizationNode(),
    breadcrumbNode(crumbs),
  ];

  /* FAQPage YALNIZCA sayfada görünür SSS varsa ve metinleri birebir aynıysa
     (Faz 1 §6). Görünmeyen şema kural ihlali. */
  if (post.faq.length >= 2) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: post.faq.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    });
  }

  const guncelleme = post.contentUpdatedAt
    ? ` · <span>Güncelleme: <time datetime="${isoDate(post.contentUpdatedAt)}">${formatDate(post.contentUpdatedAt)}</time></span>`
    : "";

  const body = `${breadcrumbHtml(crumbs)}
<article class="yazi kap">
  <header class="yazi-ust">
    <a class="kart-kategori" href="${categoryPath(category.slug)}">${esc(category.name)}</a>
    <h1>${esc(post.title)}</h1>
    <p class="yazi-meta">
      <a href="${authorPath(author.slug)}">${esc(author.fullName)}</a> ·
      <time datetime="${isoDate(post.publishedAt)}">${formatDate(post.publishedAt)}</time>${guncelleme} ·
      ${post.readingTimeMin} dk okuma
    </p>
  </header>

  <aside class="tldr">
    <p class="tldr-baslik">Kısa cevap</p>
    <p>${esc(post.tldr)}</p>
  </aside>

  ${tocHtml(toc)}

  <div class="govde">
${html}
  </div>

  ${faqHtml(post.faq)}
  ${authorBoxHtml(author, reviewer)}
</article>

${cluster.length > 0 ? `<section class="kap bolum">
  <h2>Bu kümedeki diğer yazılar</h2>
  <div class="kartlar">${cluster.map((item) => cardHtml(item, content.categories)).join("\n")}</div>
</section>` : ""}

${related.length > 0 ? `<section class="kap bolum">
  <h2>İlgili yazılar</h2>
  <div class="kartlar">${related.map((item) => cardHtml(item, content.categories)).join("\n")}</div>
</section>` : ""}

<div class="kap">${ctaHtml(
    "Nereden başlayacağını birlikte belirleyelim",
    "Seviyeni ölçüp sana uygun bir plan kuruyoruz. İlk görüşme ücretsiz, taahhüt yok.",
  )}</div>`;

  return layout({
    title: renderedTitle(post.seoTitle, post.title),
    description: post.seoDescription || post.excerpt,
    path: postPath(post.slug),
    canonical,
    noindex: post.noindex,
    ogType: "article",
    ogImage: post.ogImage || post.cover || undefined,
    graph,
    body,
  });
}

/* -------------------------------------------------------------------------- */

interface ListOptions {
  title: string;
  description: string;
  heading: string;
  introHtml: string;
  path: string;
  posts: BlogPost[];
  content: BlogContent;
  page: number;
  totalPages: number;
  pageUrl: (page: number) => string;
  crumbs: { name: string; path: string }[];
  noindex?: boolean;
  extraGraph?: unknown[];
  featured?: BlogPost | null;
}

function pagerHtml(options: ListOptions): string {
  if (options.totalPages <= 1) return "";
  const links: string[] = [];
  for (let page = 1; page <= options.totalPages; page += 1) {
    links.push(
      page === options.page
        ? `<span class="sayfa aktif" aria-current="page">${page}</span>`
        : `<a class="sayfa" href="${options.pageUrl(page)}">${page}</a>`,
    );
  }
  return `<nav class="sayfalama" aria-label="Sayfalar">${links.join("")}</nav>`;
}

export function listPage(options: ListOptions): string {
  const cards = options.posts.map((post) => cardHtml(post, options.content.categories)).join("\n");

  const kategoriler = options.content.categories
    .map((category) => `<a class="etiket" href="${categoryPath(category.slug)}">${esc(category.name)}</a>`)
    .join("\n");

  const featured = options.featured
    ? `<article class="one-cikan">
  <a class="kart-kategori" href="${categoryPath(options.featured.categorySlug)}">${esc(
    options.content.categories.find((c) => c.slug === options.featured!.categorySlug)?.name ?? "",
  )}</a>
  <h2><a href="${postPath(options.featured.slug)}">${esc(options.featured.title)}</a></h2>
  <p>${esc(options.featured.excerpt)}</p>
  <p class="kart-meta"><time datetime="${isoDate(options.featured.publishedAt)}">${formatDate(options.featured.publishedAt)}</time> · ${options.featured.readingTimeMin} dk okuma</p>
</article>`
    : "";

  const body = `${breadcrumbHtml(options.crumbs)}
<div class="kap">
  <header class="liste-ust">
    <h1>${esc(options.heading)}</h1>
    <div class="giris">${options.introHtml}</div>
  </header>

  <nav class="kategori-serit" aria-label="Kategoriler">${kategoriler}</nav>

  ${featured}

  <div class="kartlar">${cards}</div>

  ${pagerHtml(options)}

  ${ctaHtml(
    "Hazırlık planını birlikte kuralım",
    "Eksiklerini birebir online özel dersle kapat. İlk görüşme ücretsiz, taahhüt yok.",
  )}
</div>`;

  return layout({
    title: options.title,
    description: options.description,
    path: options.path,
    noindex: options.noindex,
    graph: [
      ...(options.extraGraph ?? []),
      organizationNode(),
      breadcrumbNode(options.crumbs),
    ],
    body,
    prev: options.page > 1 ? absolute(SITE, options.pageUrl(options.page - 1)) : undefined,
    next: options.page < options.totalPages ? absolute(SITE, options.pageUrl(options.page + 1)) : undefined,
  });
}

export function authorPage(author: BlogAuthor, posts: BlogPost[], content: BlogContent): string {
  const crumbs = [
    { name: "Ana Sayfa", path: "/" },
    { name: "Blog", path: blogHome() },
    { name: author.fullName, path: authorPath(author.slug) },
  ];

  const body = `${breadcrumbHtml(crumbs)}
<div class="kap">
  <header class="liste-ust">
    <h1>${esc(author.fullName)}</h1>
    <p class="yazar-unvan">${esc(author.jobTitle)}</p>
    <div class="giris">${renderInline(author.bioMarkdown)}</div>
    <p class="yazar-kimlik">${esc(author.credentials)}</p>
  </header>
  <h2>Yazıları</h2>
  <div class="kartlar">${posts.map((post) => cardHtml(post, content.categories)).join("\n")}</div>
</div>`;

  return layout({
    title: `${author.fullName} | ${BRAND} Blog`,
    description: author.credentials.slice(0, 160),
    path: authorPath(author.slug),
    graph: [
      { "@type": "ProfilePage", mainEntity: { "@id": absolute(SITE, authorPath(author.slug)) + "#person" } },
      personNode(author),
      organizationNode(),
      breadcrumbNode(crumbs),
    ],
    body,
  });
}

export function notFoundPage(content: BlogContent): string {
  const populer = content.posts.slice(0, 4).map((post) => cardHtml(post, content.categories)).join("\n");
  const body = `<div class="kap">
  <header class="liste-ust">
    <h1>Aradığınız yazı bulunamadı</h1>
    <p>Adres değişmiş ya da yazı kaldırılmış olabilir. Aşağıdaki yazılara göz atabilir ya da <a href="${blogHome()}">blog ana sayfasına</a> dönebilirsiniz.</p>
  </header>
  <h2>Öne çıkan yazılar</h2>
  <div class="kartlar">${populer}</div>
</div>`;

  return layout({
    title: `Sayfa bulunamadı | ${BRAND} Blog`,
    description: "Aradığınız blog yazısı bulunamadı.",
    path: `${blogHome()}/404`,
    noindex: true,
    graph: [organizationNode()],
    body,
  });
}

export { SITE, searchPath, tagPath, categoryPage, blogPage };
