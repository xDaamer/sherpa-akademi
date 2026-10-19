import express from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { KaliciHata, kimlikSade, metaSatiri, metaSatiriYaz, type MetaAlan } from "../metaLeads.js";

/*
 * META LEAD ADS WEBHOOK — /api/meta/webhook
 * ============================================================================
 * Facebook/Instagram "Potansiyel müşteri" formlarından gelen başvuruları
 * public.leads'e source='meta' ile yazar. Şema: supabase-meta-leads.sql,
 * eşleme ve yazma: server/metaLeads.ts.
 *
 * ŞU AN KULLANILMIYOR: kendi Meta uygulamasının kurulumu (sistem kullanıcısı
 * jetonu) zor bulundu ve Google Sheets yolu seçildi (routes/metaSheets.ts).
 * Kod test edilmiş hâliyle duruyor; ortam değişkenleri tanımlı değilken POST
 * 503 döner, yani kapalı. İki yol birlikte de çalışabilir: kimlikler ortak,
 * aynı başvuru iki kapıdan gelirse tek satır olur.
 *
 * Meta bildirimde başvurunun KENDİSİNİ göndermiyor, yalnızca kimliğini
 * (leadgen_id). Alanlar ayrıca Graph API'den, sayfa jetonuyla çekiliyor.
 *
 * GÜVENLİK: bu uç oturumsuz ve Origin'siz — çağıran bir tarayıcı değil,
 * Meta'nın sunucusu. Bu yüzden /api/leads* altında DEĞİL (oradaki
 * requireTrustedOrigin Origin'siz POST'u reddeder). Yerine iki kapı var:
 *   - POST gövdesinin HMAC-SHA256 imzası META_APP_SECRET ile doğrulanıyor;
 *     imzasız/yanlış imzalı istek tek satır bile yazamıyor.
 *   - İmza geçse bile satırın içeriği gövdeden değil Graph API'den geliyor,
 *     yani yazılan her şey Meta'da gerçekten var olan bir başvuru.
 *
 * Ortam değişkenleri (hepsi sunucu tarafı, VITE_ öneki ALMAZ):
 *   META_APP_SECRET          Uygulama gizli anahtarı — imza doğrulaması.
 *   META_VERIFY_TOKEN        Webhook kurulurken Meta'ya yazılan rastgele metin.
 *   META_PAGE_ACCESS_TOKEN   Süresiz sayfa jetonu (leads_retrieval izni).
 *   META_PAGE_ID             İsteğe bağlı: yalnızca bu sayfanın başvuruları.
 *   META_GRAPH_VERSION       İsteğe bağlı, varsayılan v25.0.
 *
 * YANIT KODLARI BİLEREK SEÇİLİ: Meta 200 dışındaki her yanıtı ~36 saat
 * boyunca yeniden deniyor. Graph'tan ya da veritabanından gelen HER hata
 * 500 dönüyor ki başvuru kaybolmasın; aynı bildirim tekrar gelirse
 * meta_lead_id UNIQUE olduğu için satır ikinci kez açılmıyor.
 *
 * Graph'ın 100 kodunu ("nesne yok, ya da EKSİK İZİN yüzünden okunamıyor")
 * kalıcı saymak cazip ama YANLIŞ: jetonda leads_retrieval eksikse ya da
 * Leads Access Manager uygulamaya erişim vermemişse de aynı kod geliyor.
 * Onu atlamak, izin düzeltilene kadar gelen bütün gerçek başvuruları sessizce
 * yok ederdi; 500 dönünce ise izin düzeltildiği an Meta'nın yeniden
 * denemesiyle hepsi geliyor. Kalıcı sayılan yalnızca iki durum var:
 * Dashboard'daki "Test" düğmesinin sahte kimliği (444...) ve telefonsuz form.
 */

const router = express.Router();

type HamGovdeli = express.Request & { rawBody?: Buffer };

/** Bu ucun kendi ortam değişkenleri; Sheets anahtarı tek başına onu açmaz. */
function webhookYapilandirildi(): boolean {
  return Boolean(
    process.env.META_APP_SECRET && process.env.META_VERIFY_TOKEN && process.env.META_PAGE_ACCESS_TOKEN,
  );
}

/*
 * /api/meta/*'nin KENDİ gövde ayrıştırıcısı (metaSheets de kullanıyor);
 * server.ts onu genel express.json'dan ÖNCE bağlıyor (genel olan `req._body`
 * dolu görünce atlıyor). İki sebep:
 *   - İmza, Meta'nın gönderdiği BAYT DİZİSİ üzerinden hesaplanıyor; yeniden
 *     serileştirilmiş JSON aynı baytları vermez. `verify` ham gövdeyi tutuyor.
 *   - Genel 16 KB sınırı toplu bir bildirimi (aynı anda düşen çok başvuru)
 *     413 ile reddederdi; Meta da aynı 413'ü 36 saat yeniden denerdi.
 */
export const metaGovdeAyristirici = express.json({
  limit: "512kb",
  verify: (req, _res, buf) => {
    (req as HamGovdeli).rawBody = buf;
  },
});

function imzaGecerli(req: HamGovdeli): boolean {
  const gizli = process.env.META_APP_SECRET;
  const baslik = req.get("x-hub-signature-256");
  if (baslik && !req.rawBody) {
    /* İmzalı istek geldi ama ham gövde yok: metaGovdeAyristirici bu istekte
       çalışmamış demek. Her bildirim 401 alır; sessiz kalmasın. */
    console.error("[Meta] ham gövde yok, imza doğrulanamıyor — server.ts'te metaGovdeAyristirici sırasını kontrol edin.");
  }
  if (!gizli || !baslik?.startsWith("sha256=") || !req.rawBody) return false;

  const beklenen = Buffer.from(createHmac("sha256", gizli).update(req.rawBody).digest("hex"));
  const gelen = Buffer.from(baslik.slice("sha256=".length));
  return gelen.length === beklenen.length && timingSafeEqual(gelen, beklenen);
}

/** Abonelik doğrulaması: Meta webhook'u kaydederken bir kez GET atar. */
router.get("/webhook", (req, res) => {
  const beklenen = process.env.META_VERIFY_TOKEN;
  if (
    beklenen &&
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === beklenen &&
    typeof req.query["hub.challenge"] === "string"
  ) {
    return res.type("text/plain").send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

interface MetaBasvuru {
  id: string;
  created_time?: string;
  form_id?: string;
  field_data?: MetaAlan[];
}

interface MetaReklam {
  ad_name?: string;
  campaign_name?: string;
  platform?: string;
}

/*
 * Meta Dashboard'daki webhook "Test" düğmesi örnek bir bildirim yolluyor ve
 * içindeki kimlikler yalnızca 4'lerden oluşuyor (444444444444). Gerçek bir
 * başvuru kimliğinin böyle olması pratikte imkânsız.
 */
const ornekBildirimMi = (id: string) => /^4+$/.test(id);

async function graphGet<T>(id: string, alanlar: string): Promise<T> {
  const surum = process.env.META_GRAPH_VERSION || "v25.0";
  const url = new URL(`https://graph.facebook.com/${surum}/${encodeURIComponent(id)}`);
  url.searchParams.set("fields", alanlar);
  /* Jeton sorgu dizesinde değil başlıkta: hata log'una URL düşerse jeton
     onunla birlikte düşmesin. */
  const yanit = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.META_PAGE_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(6000),
  });
  const govde: any = await yanit.json().catch(() => null);
  if (!yanit.ok || !govde) {
    const h = govde?.error;
    throw new Error(`Graph ${yanit.status} kod=${h?.code}/${h?.error_subcode} ${h?.message ?? ""}`);
  }
  return govde as T;
}

/*
 * İKİ AYRI ÇAĞRI, bilerek. Başvurunun kendisi (form cevapları) leads_retrieval
 * ile okunuyor; reklam ve kampanya adı ise reklam hesabı tarafında ayrıca
 * yetki istiyor. Tek çağrıda istenseydi, reklam hesabına erişimi olmayan bir
 * jeton yüzünden BAŞVURUNUN TAMAMI okunamazdı. Reklam bilgisi panelde
 * yalnızca bilgi amaçlı; alınamazsa satır onsuz yazılıyor.
 */
async function basvuruyuGetir(leadgenId: string): Promise<{ b: MetaBasvuru; r: MetaReklam }> {
  const [b, r] = await Promise.allSettled([
    graphGet<MetaBasvuru>(leadgenId, "id,created_time,form_id,field_data"),
    graphGet<MetaReklam>(leadgenId, "ad_name,campaign_name,platform"),
  ]);
  if (b.status === "rejected") throw b.reason;
  if (r.status === "rejected") {
    console.warn(`[Meta] başvuru ${leadgenId}: reklam bilgisi alınamadı, onsuz yazılıyor:`, r.reason?.message);
  }
  return { b: b.value, r: r.status === "fulfilled" ? r.value : {} };
}

async function basvuruyuYaz(leadgenId: string): Promise<void> {
  if (ornekBildirimMi(leadgenId)) {
    throw new KaliciHata("Dashboard test bildirimi (gerçek başvuru değil) — imza doğrulandı, uç çalışıyor");
  }

  const { b, r } = await basvuruyuGetir(leadgenId);
  await metaSatiriYaz(
    metaSatiri({
      leadId: kimlikSade(b.id || leadgenId),
      createdTime: b.created_time,
      formId: b.form_id,
      adName: r.ad_name,
      campaignName: r.campaign_name,
      platform: r.platform,
      alanlar: Array.isArray(b.field_data) ? b.field_data : [],
    }),
  );
}

router.post("/webhook", async (req: HamGovdeli, res) => {
  if (!webhookYapilandirildi()) return res.sendStatus(503);
  if (!imzaGecerli(req)) return res.sendStatus(401);

  if (req.body?.object !== "page") return res.sendStatus(200);

  const sayfa = process.env.META_PAGE_ID;
  const kimlikler: string[] = [];
  for (const giris of Array.isArray(req.body.entry) ? req.body.entry : []) {
    for (const degisim of Array.isArray(giris?.changes) ? giris.changes : []) {
      const v = degisim?.value;
      if (degisim?.field !== "leadgen" || !v?.leadgen_id) continue;
      if (sayfa && String(v.page_id) !== sayfa) continue;
      kimlikler.push(String(v.leadgen_id));
    }
  }

  /* Vercel'de yanıt gittikten sonra fonksiyon donduruluyor; iş yanıttan
     ÖNCE bitmeli, arka plana atılamaz. Toplu bildirimde başvurular paralel
     işleniyor: sırayla işlemek Meta'nın yanıt süresini aşabilirdi. */
  const sonuclar = await Promise.allSettled(kimlikler.map((id) => basvuruyuYaz(id)));
  let gecici = false;
  sonuclar.forEach((s, i) => {
    if (s.status === "fulfilled") return;
    const err: any = s.reason;
    if (err instanceof KaliciHata) {
      console.warn(`[Meta] başvuru ${kimlikler[i]} atlandı:`, err.message);
    } else {
      gecici = true;
      console.error(`[Meta] başvuru ${kimlikler[i]} yazılamadı (Meta yeniden deneyecek):`, err?.message || err);
    }
  });

  return res.sendStatus(gecici ? 500 : 200);
});

export default router;
