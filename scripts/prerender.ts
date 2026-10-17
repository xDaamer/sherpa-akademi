import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import need from "../need.json" with { type: "json" };
import { SHOW_TEACHER_TICKER } from "../src/config.ts";

/**
 * PAZARLAMA SAYFALARINI STATİK HTML'E BASAR — `vite build`'den SONRA çalışır.
 * ============================================================================
 * NEDEN VAR
 * ---------------------------------------------------------------------------
 * Bu dosyadan önce sunucu HER rota için aynı boş kabuğu döndürüyordu. Canlıda
 * ölçüldü (2026-09-14):
 *
 *     curl https://www.akademitu.com/   ->  6391 byte
 *     <div id="root"></div>
 *     h1: 0   h2: 0   h3: 0   a href: 0   ld+json: 0
 *
 * React kaynağında bunların hepsi VARDI — H1, başlık hiyerarşisi, iç linkler,
 * beş çeşit JSON-LD — ama tamamı istemcide render ediliyordu. Googlebot JS
 * çalıştırır ama render kuyruğu ayrı ve gecikmelidir; Bingbot, Yandex, sosyal
 * medya önizleme tarayıcıları ve LLM tarayıcıları (GPTBot, ClaudeBot,
 * PerplexityBot) çalıştırmaz. Onlar için site tamamen boştu.
 *
 * Üstüne her rota ana sayfanın <title>, description ve canonical'ını
 * taşıyordu; /gizlilik-politikasi Google'a "ben aslında ana sayfayım" diyordu.
 * PageMeta.tsx bunu JS çalışınca düzeltiyordu, ilk HTML'de değil.
 *
 * Teşhis ve çözüm önerisi zaten depoda kayıtlıydı:
 * seo-audit/faz-5-taranabilirlik.md, K-01.
 *
 * NASIL ÇALIŞIYOR
 * ---------------------------------------------------------------------------
 * `vite build --ssr` ile derlenen dist-ssr/entry-server.js import ediliyor ve
 * her rota Node içinde render edilip dist/index.html kabuğunun <div id="root">
 * içine yerleştiriliyor. <head> de rotaya göre yeniden yazılıyor.
 *
 * ÇIKTI KLASÖR/index.html BİÇİMİNDE (404.html ve app.html hariç). Bu bilinçli
 * ve blog üreticisinin dayandığı mekanizmanın aynısı: Vercel istek karşılarken
 * önce DOSYA SİSTEMİNE bakıyor, rewrite kurallarına sonra. /gizlilik-politikasi
 * adresinde gerçek bir dosya bulunduğu için vercel.json'daki SPA yakalayıcısı
 * devreye girmiyor — sayfa CDN'den statik geliyor, fonksiyon hiç çalışmıyor.
 *
 * KURAL: BU SCRIPT YALNIZCA .html YAZAR.
 * ---------------------------------------------------------------------------
 * sitemap*.xml ve robots.txt'e ASLA dokunma. O zincir iki script arasında
 * paylaşılmış durumda: scripts/generate-seo.ts (prebuild) public/sitemap.xml'i
 * üretiyor, scripts/blog/build.ts (postbuild) onu sitemap-sayfalar.xml'e
 * kopyalayıp kök sitemap'i bir index dosyasına çeviriyor. Araya "yardımcı
 * olmak için" bir yazma eklemek o zinciri sessizce bozar.
 *
 * vercel.json'DAKİ REWRITE SIRASI — BURAYLA BİRLİKTE OKUNMALI
 * ---------------------------------------------------------------------------
 * Vercel ilk eşleşen rewrite kuralını uyguluyor ve sıra taşıyıcı:
 *
 *   1. /api/(.*)                      -> fonksiyon
 *   2. portal host'undaki her şey     -> /app.html   (boş kabuk)
 *   3. /login, /panel*, /portal*      -> /app.html
 *   4. geriye kalan her şey           -> KURAL YOK. Vercel çıktı kökündeki
 *                                        404.html'i kendisi, 404 koduyla sunar.
 *
 * 4. adımda 2026-10-18'e kadar `/((?!api/).*) -> /404.html` rewrite'ı vardı.
 * Rewrite hedefi bir dosya olduğu için Vercel onu 200 ile döndürüyordu: var
 * olmayan her adres (/llms.txt, /Blog, /manifest.json...) "soft 404"tü. Kural
 * kalkınca aynı sayfa gerçek 404 koduyla geliyor. Geri eklemeyin.
 *
 * Eskiden tek bir kural vardı ve her şeyi /index.html'e yolluyordu. O zaman
 * zararsızdı çünkü index.html boş bir kabuktu; artık ana sayfanın tam içeriği,
 * yani aynı kural panel açılışlarında pazarlama sayfasını çizer ve var olmayan
 * adreslere "index, follow" ile ana sayfayı döndürürdü.
 *
 * AMA 2. KURAL PORTAL HOST'UNUN KÖKÜNÜ (/) YAKALAYAMIYOR — ölçüldü.
 * Vercel'in sırası: redirects -> DOSYA SİSTEMİ -> rewrites. "/" diskte
 * index.html'e çözülüyor, dolayısıyla hiçbir rewrite oraya ulaşamıyor. Bu,
 * prerender'ın çalışmasını sağlayan mekanizmanın ta kendisi (/gizlilik-politikasi
 * gerçek bir dosya olduğu için 4. kurala düşmüyor) — ama iki yönlü kesiyor.
 * 2. kural portal host'undaki DOSYASI OLMAYAN yolları (/ogretmen, /yorumlar,
 * /yonetim) doğru şekilde boş kabuğa yolluyor; yalnızca kök için çaresiz.
 *
 * Kök için tek altyapısal çözüm middleware (dosya sisteminden ÖNCE çalışan tek
 * yer). Bu proje statik servis üzerine kurulu ve serverless kırılganlığıyla
 * geçmişi var (bkz. CLAUDE.md, FUNCTION_INVOCATION_FAILED), o yüzden kökteki
 * pazarlama gövdesi index.html'e gömülen altı satırlık bir korumayla
 * temizleniyor — panelHostKorumasi(). Kozmetik bir sorun için kozmetik bir
 * çözüm: panel zaten çalışıyordu, sorun yalnızca React mount olmadan önceki
 * anlık pazarlama sayfası görüntüsüydü.
 *
 * DİKKAT: vercel.json şema doğrulamasından geçiyor ve TANIMSIZ ÜST DÜZEY
 * ANAHTAR KABUL ETMİYOR. Bu açıklama oraya bir "_not" alanı olarak konmuştu ve
 * dağıtım "should NOT have additional property" ile build'e hiç başlamadan
 * düştü (2026-09-15). O dosyaya yorum da eklenemez — açıklama bu yüzden burada.
 *
 * BİLİNEN SINIRLAR (eksiklik değil, bilinçli takas)
 * ---------------------------------------------------------------------------
 * 1) TestimonialsSection `isLoading: true` ile başlıyor ve yorumları
 *    useEffect'te çekiyor; dolayısıyla "Velilerimizin Görüşleri" H2'si statik
 *    HTML'de YOK. Build sırasında fetch etmek build'e ağ hatası ekler ve veriyi
 *    HTML'e dondurur; başlığı koşulun dışına almak ise API düştüğünde canlı
 *    sayfada altı boş bir başlık bırakır (bugün bölüm sessizce kayboluyor).
 *    Ana sayfa yine h1 + 4 h2 + 16 h3 gönderiyor.
 * 2) SSS cevaplarından yalnızca açık olan ilki DOM'da (AnimatePresence), yani
 *    statik HTML'de 6 soru + 1 cevap var. Rich result'ı besleyen FAQPage
 *    şeması altı sorunun da tamamını taşıyor, o yüzden kabul edilebilir.
 * 3) Footer'daki yıl build anında donuyor. createRoot ile istemci yeniden
 *    render ettiği için yalnızca bayat bir CDN kopyasında yılbaşı gecesi fark
 *    edilebilir.
 */

const DIST = path.join(process.cwd(), "dist");
const SSR_BUNDLE = path.join(process.cwd(), "dist-ssr", "entry-server.js");
const SITE = need.site.domain;

const INDEKSLENEBILIR =
  "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1";
const INDEKSLENMEZ = "noindex, follow";

/* HTML öznitelik değeri kaçışı. scripts/blog/templates.ts'teki esc() ile aynı
   işi yapıyor ama oradan import EDİLMİYOR: o modül markdown-it ve tüm blog
   içerik yükleyicisini de beraberinde çekiyor, prerender'ın blog boru hattına
   bağımlı olmasının hiçbir gerekçesi yok. */
function attr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Rota {
  /** dist/ içindeki hedef dosya. */
  cikti: string;
  /** StaticRouter'a verilecek adres; null ise gövde render edilmez (boş kabuk). */
  render: string | null;
  title: string;
  description: string;
  /** null ise canonical etiketi hiç basılmaz. */
  canonical: string | null;
  robots: string;
  hreflang: boolean;
  /** Hero görselinin ön yüklemesi yalnızca ana sayfada anlamlı. */
  heroPreload: boolean;
}

function seoSayfa(id: string) {
  const sayfa = need.seo.pages.find((p) => p.id === id);
  if (!sayfa) throw new Error(`need.json seo.pages içinde "${id}" yok.`);
  return sayfa;
}

function pazarlamaRotasi(id: string, cikti: string): Rota {
  const sayfa = seoSayfa(id);
  return {
    cikti,
    render: sayfa.path,
    title: sayfa.title,
    description: sayfa.description,
    canonical: `${SITE}${sayfa.path}`,
    robots: INDEKSLENEBILIR,
    hreflang: true,
    /* Ön yüklenen görsel hoca şeridinin ilk karesi; şerit kapalıyken
       (src/config.ts) indirilir ama hiç kullanılmaz. */
    heroPreload: sayfa.path === "/" && SHOW_TEACHER_TICKER,
  };
}

const ROTALAR: Rota[] = [
  pazarlamaRotasi("home", "index.html"),
  pazarlamaRotasi("privacy", "gizlilik-politikasi/index.html"),
  pazarlamaRotasi("terms", "kullanim-kosullari/index.html"),

  /*
   * 404 — hiçbir dosyaya ve rewrite'a uymayan istekte Vercel bunu 404 koduyla
   * sunuyor (vercel.json'da bilerek bir yakalayıcı rewrite yok).
   *
   * canonical YOK: 404 gerçek bir adrese karşılık gelmiyor, ona canonical
   * vermek ("bu sayfanın aslı şurası") ile noindex ("bunu dizine alma") çelişen
   * iki sinyal olurdu. Gerekçenin uzun hâli PageMeta.tsx'te.
   *
   * noindex yine de duruyor: bir yerden 200 ile servis edilirse (ör. önizleme
   * ortamında farklı bir yönlendirme) sayfa yine dizine girmesin.
   */
  {
    cikti: "404.html",
    render: "/bu-adres-yok",
    title: need.seo.notFound.title,
    description: need.seo.notFound.description,
    canonical: null,
    robots: INDEKSLENMEZ,
    hreflang: false,
    heroPreload: false,
  },

  /*
   * BOŞ KABUK — panel host'u, /login ve /panel* buraya yönleniyor.
   *
   * Prerender'dan sonra dist/index.html artık ana sayfanın TAM içeriği. Aynı
   * dosya portal.akademitu.com'a da servis ediliyordu: müdahale edilmese panel
   * her açılışta bir an hero + fiyatlar + footer çizer, sonra React silip
   * paneli basardı — her öğretmen, öğrenci ve admin için, her seferinde.
   *
   * Bu dosya bugünkü dist/index.html ile aynı: boş #root. Aynı JS bundle'ı
   * taşıdığı için istemci yönlendirmesi hiç etkilenmiyor.
   */
  {
    cikti: "app.html",
    render: null,
    title: `${need.site.name} Panel`,
    description: `${need.site.name} öğrenci ve öğretmen paneli.`,
    canonical: null,
    robots: INDEKSLENMEZ,
    hreflang: false,
    heroPreload: false,
  },
];

/* -------------------------------------------------------------------------- */

/** Tek eşleşme bekleyen değiştirme: bulamazsa build'i düşürür. */
function degistir(html: string, desen: RegExp, yeni: string, ne: string): string {
  if (!desen.test(html)) {
    throw new Error(
      `Kabukta "${ne}" bulunamadı. index.html değişmiş olabilir; ` +
      `scripts/prerender.ts'teki deseni güncelleyin.`,
    );
  }
  return html.replace(desen, () => yeni);
}

/**
 * PANEL HOST'UNDAKİ PAZARLAMA GÖVDESİNİ, BOYANMADAN SİLER.
 *
 * Yalnızca dist/index.html'e giriyor, çünkü portal.akademitu.com'un kökü
 * kaçınılmaz olarak o dosyayı alıyor (yukarıdaki rewrite notuna bakın).
 *
 * İki parça: <head>'deki betik host'u işaretliyor ve <style> #root'u görünmez
 * yapıyor — böylece gövde ayrıştırılırken hiçbir şey boyanmıyor. Gövdenin
 * sonundaki betik #root'u boşaltıp işareti kaldırıyor, yani React mount
 * olduğunda kap hem boş hem görünür. Ana host'ta öznitelik hiç konmadığı için
 * kural hiç eşleşmiyor, maliyeti sıfır.
 *
 * Host testi host.ts'teki routingMode() ile aynı: ilk etiketi "portal" olan her
 * host panel sayılıyor (portal.akademitu.local gibi yerel kurulumlar dahil).
 *
 * JS kapalıyken panel host'unda pazarlama sayfası görünür kalıyor — panel zaten
 * JS'siz çalışmadığı için bu bir kayıp değil.
 */
function panelHostKorumasi(html: string): string {
  const kafa =
    '    <script>\n' +
    '      /* Panel host\'u da bu dosyayı alıyor: "/" diskte index.html\'e\n' +
    '         çözüldüğü için vercel.json\'daki host kuralı köke ulaşamıyor.\n' +
    '         Ayrıntı: scripts/prerender.ts */\n' +
    '      if (location.hostname.split(".")[0] === "portal") {\n' +
    '        document.documentElement.setAttribute("data-panel-host", "");\n' +
    '      }\n' +
    '    </' + 'script>\n' +
    '    <style>[data-panel-host] #root { visibility: hidden }</style>\n';

  const govde =
    '\n    <script>\n' +
    '      if (document.documentElement.hasAttribute("data-panel-host")) {\n' +
    '        document.getElementById("root").textContent = "";\n' +
    '        document.documentElement.removeAttribute("data-panel-host");\n' +
    '      }\n' +
    '    </' + 'script>';

  html = degistir(html, /(\n\s*<\/head>)/, kafa + "  </head>", "</head>");
  html = degistir(html, /(\n\s*<\/body>)/, govde + "\n  </body>", "</body>");
  return html;
}

function kafayiYaz(kabuk: string, rota: Rota): string {
  let html = kabuk;

  html = degistir(html, /<title>[\s\S]*?<\/title>/, `<title>${attr(rota.title)}</title>`, "<title>");

  html = degistir(
    html,
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${attr(rota.description)}" />`,
    'meta[name=description]',
  );

  html = degistir(
    html,
    /<meta name="robots" content="[^"]*" \/>/,
    `<meta name="robots" content="${rota.robots}" />`,
    'meta[name=robots]',
  );

  /*
   * CANONICAL + HREFLANG birlikte ele alınıyor, çünkü ikisi de aynı satırın
   * yerine geçiyor ve ikisi de noindex sayfalarda BASILMIYOR.
   *
   * HREFLANG HAKKINDA DÜRÜST NOT: gerçek SEO değeri yok. hreflang bir sayfanın
   * BAŞKA dil/bölge sürümlerini bildirmek içindir; site tek dilli, tek pazar,
   * alternatifi yok. Kendine referans veren bir çift geçerli ama işlevsiz bir
   * bildirimdir — Google tek elemanlı bir küme görüp geçer. Denetim araçlarının
   * kontrol listesini kapatmak için duruyor, sıfır riskle (hreflang
   * kullanılıyorsa kendine referans ZORUNLUDUR; asıl hata onu atlamaktır).
   * Siteye ikinci bir dil eklenirse burası gerçekten anlamlı hâle gelir.
   * Bunu gerçek bir i18n altyapısı sanmayın.
   */
  const canonicalDeseni = /<link rel="canonical" href="[^"]*" \/>/;
  if (rota.canonical) {
    const satirlar = [`<link rel="canonical" href="${attr(rota.canonical)}" />`];
    if (rota.hreflang) {
      satirlar.push(
        `    <link rel="alternate" hreflang="tr" href="${attr(rota.canonical)}" />`,
        `    <link rel="alternate" hreflang="x-default" href="${attr(rota.canonical)}" />`,
      );
    }
    html = degistir(html, canonicalDeseni, satirlar.join("\n"), "link[rel=canonical]");
  } else {
    html = degistir(html, canonicalDeseni, "", "link[rel=canonical]");
  }

  /* Sosyal paylaşım etiketleri de rotaya özel olmalı; aksi halde her bağlantı
     ana sayfanın başlığıyla paylaşılır. og:url / twitter:url noindex
     sayfalarda ana sayfayı göstermesin diye site köküne sabitleniyor. */
  const adres = rota.canonical ?? `${SITE}/`;
  const ogEtiketleri: [RegExp, string][] = [
    [/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${attr(adres)}" />`],
    [/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${attr(rota.title)}" />`],
    [/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${attr(rota.description)}" />`],
    [/<meta name="twitter:url" content="[^"]*" \/>/, `<meta name="twitter:url" content="${attr(adres)}" />`],
    [/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${attr(rota.title)}" />`],
    [/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${attr(rota.description)}" />`],
  ];
  for (const [desen, yeni] of ogEtiketleri) {
    html = degistir(html, desen, yeni, desen.source.slice(0, 40));
  }

  /*
   * HERO ÖN YÜKLEMESİ YALNIZCA ANA SAYFADA.
   * index.html'deki yorum bu anı zaten bekliyordu: "SPA statik HTML'inde
   * route'a göre koşullu preload yapmanın yolu yok; prerender'a geçilirse bu
   * satır yalnızca ana sayfaya konulmalı." Diğer rotalarda ~21 KB boşa
   * gidiyordu ve konsolda "preloaded but not used" uyarısı üretiyordu.
   * Açıklama yorumu da birlikte siliniyor — olmayan bir etiketi anlatan bir
   * yorum bırakmak sonraki okuyucuyu yanıltır.
   */
  if (!rota.heroPreload) {
    html = degistir(
      html,
      /\n[ \t]*<!--\s*\n\s*LCP GÖRSELİ ÖN YÜKLEME[\s\S]*?\/>\n/,
      "\n",
      "LCP preload bloğu",
    );
  }

  return html;
}

/* -------------------------------------------------------------------------- */

function yaz(rota: string, html: string) {
  const hedef = path.join(DIST, rota);
  fs.mkdirSync(path.dirname(hedef), { recursive: true });
  fs.writeFileSync(hedef, html, "utf-8");
}

/**
 * ÇIKTI DOĞRULAMALARI — sessizce bozulmuş bir prerender, hiç prerender
 * yapmamaktan KÖTÜDÜR, çünkü düzelmiş gibi görünür. Bu yüzden hepsi build'i
 * düşürüyor, uyarı basıp geçmiyor.
 */
function dogrula(rota: Rota, html: string, hatalar: string[]) {
  const ad = rota.cikti;
  const say = (re: RegExp) => (html.match(re) || []).length;

  if (rota.render) {
    if (html.includes('<div id="root"></div>')) {
      hatalar.push(`${ad}: #root boş kalmış — gövde yerleştirilmemiş.`);
    }
    if (say(/<h1/g) !== 1) {
      hatalar.push(`${ad}: ${say(/<h1/g)} adet <h1> var, 1 bekleniyordu.`);
    }
    /*
     * motion REGRESYON KİLİDİ. `initial={{opacity:0}}` sunucu çıktısına
     * inline stil olarak yazılıyor; guard'sız bir motion.div eklenirse sayfa
     * dolu görünür ama tarayıcı içeriği görmez. Tam olarak kaçınmaya
     * çalıştığımız durumun sessiz hâli — bu yüzden build'i düşürüyor.
     * Çözüm: src/lib/ssr.ts -> initial={IS_SERVER ? false : {...}}
     */
    if (/opacity:\s*0[^.\d]/.test(html)) {
      hatalar.push(
        `${ad}: çıktıda "opacity:0" var — guard'sız bir motion bileşeni ` +
        `içeriği tarayıcıdan gizliyor (bkz. src/lib/ssr.ts).`,
      );
    }
  }

  const canonicalSayisi = say(/rel="canonical"/g);
  if (rota.canonical && canonicalSayisi !== 1) {
    hatalar.push(`${ad}: ${canonicalSayisi} adet canonical var, 1 bekleniyordu.`);
  }
  if (!rota.canonical && canonicalSayisi !== 0) {
    hatalar.push(`${ad}: noindex sayfada canonical var (${canonicalSayisi} adet).`);
  }
  if (!rota.hreflang && say(/hreflang=/g) !== 0) {
    hatalar.push(`${ad}: noindex sayfada hreflang var.`);
  }

  if (!html.includes(`<title>${attr(rota.title)}</title>`)) {
    hatalar.push(`${ad}: <title> rotaya özel değil.`);
  }

  /* Asset hash'leri istemci ve SSR build'i arasında ayrışırsa sayfa var
     olmayan bir dosyaya işaret eder (kırık logo). Diskte arayıp yakalıyoruz. */
  for (const varlik of new Set(html.match(/\/assets\/[A-Za-z0-9._-]+/g) ?? [])) {
    if (!fs.existsSync(path.join(DIST, varlik))) {
      hatalar.push(`${ad}: eksik varlık ${varlik} (istemci/SSR hash ayrışması?).`);
    }
  }
}

/* -------------------------------------------------------------------------- */

async function main() {
  if (!fs.existsSync(DIST)) {
    console.error("[prerender] dist/ yok — bu script `vite build`den SONRA çalışmalı.");
    process.exit(1);
  }
  if (!fs.existsSync(SSR_BUNDLE)) {
    console.error(
      "[prerender] dist-ssr/entry-server.js yok — `vite build --ssr src/entry-server.tsx " +
      "--outDir dist-ssr` adımı çalışmamış (bkz. package.json `build`).",
    );
    process.exit(1);
  }

  const { render } = (await import(pathToFileURL(SSR_BUNDLE).href)) as {
    render: (url: string) => string;
  };

  /* Kabuk BİR KEZ okunuyor ve her rota kendi kopyası üzerinde çalışıyor —
     aksi halde ana sayfanın çıktısı sonraki rotaların girdisi olurdu. */
  const kabuk = fs.readFileSync(path.join(DIST, "index.html"), "utf-8");

  const hatalar: string[] = [];

  for (const rota of ROTALAR) {
    let html = kafayiYaz(kabuk, rota);

    if (rota.render) {
      const govde = render(rota.render);
      html = degistir(
        html,
        /<div id="root"><\/div>/,
        `<div id="root">${govde}</div>`,
        '#root',
      );
    }

    if (rota.cikti === "index.html") html = panelHostKorumasi(html);

    dogrula(rota, html, hatalar);
    yaz(rota.cikti, html);
  }

  if (hatalar.length > 0) {
    console.error(`[prerender] ${hatalar.length} doğrulama hatası:`);
    for (const hata of hatalar) console.error(`  - ${hata}`);
    process.exit(1);
  }

  const adlar = ROTALAR.map((r) => r.cikti).join(", ");
  console.log(`✅ Prerender: ${ROTALAR.length} sayfa statik HTML'e yazıldı (${adlar})`);
}

main().catch((err) => {
  console.error(`[prerender] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
