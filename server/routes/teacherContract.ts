import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../supabase.js";
import { auditLog } from "../audit.js";
import type { SessionLocals } from "../roles.js";
import { nesneYokMu } from "../semaHatasi.js";

/*
 * ÖĞRETMEN SÖZLEŞMESİ — /api/teacher/sozlesme ve panelin sözleşme kapısı
 * ===========================================================================
 * Öğretmen, paneli kullanmadan önce öğretmen sözleşmesini elektronik olarak
 * onaylıyor: sözleşme metni + iki zorunlu kutucuk (KVKK Aydınlatma Metni
 * okundu, Hizmet Koşulları kabul). Onay verilene kadar /api/teacher/*
 * altındaki her uç — bu dosyadaki iki uç HARİÇ — 403 dönüyor. Kapı arayüzde
 * de var ama asıl sınır burası: modalı DevTools'tan kaldıran biri yine hiçbir
 * veri alamaz.
 *
 * Tablolar ve RPC: supabase-teacher-contract.sql.
 *
 * ---------------------------------------------------------------------------
 * BU MODÜL serviceClient() KULLANIYOR — VE BU, KURALIN İHLALİ DEĞİL İSTİSNASI
 * ---------------------------------------------------------------------------
 * teacher.ts bilerek serviceClient() ÇAĞIRMIYOR: öğretmen verisi kullanıcıya
 * ait, RLS "bu satır senin değil" diyerek emniyet ağı olsun diye. Bu dosya
 * o kuralın belgelenmiş istisnası ve üç sebebi var:
 *
 *   1. ONAY KAYDI BİR KANIT — audit_log gibi (server/audit.ts aynı gerekçeyi
 *      anlatıyor). teacher_contract_acceptances satırı "kim, hangi sürümü, ne
 *      zaman, hangi IP'den onayladı" sorusunun hukuken dayanılacak cevabı.
 *      Öğretmen bu satırı kendi JWT'siyle yazabilseydi, aynı jetonla
 *      PostgREST'e doğrudan gidip ip'yi, accepted_at'i ve onayladığı sürümü
 *      istediği gibi uydurabilirdi. Kanıtın değeri, konusu olan kişinin onu
 *      yazamamasıdır. O yüzden tabloda politika da yetki de yok; yalnızca
 *      servis rolü yazıyor ve zamanı veritabanının varsayılanı (now()) koyuyor.
 *
 *   2. BELGE METİNLERİ KİMSEYE AİT DEĞİL — yayınlanmış yorumlar (testimonials)
 *      gibi. Sözleşme, aydınlatma metni ve koşullar herkese aynı; "başkasının
 *      satırı" diye bir kategori yok, RLS'in eleyeceği bir şey de yok.
 *
 *   3. DURUM RPC'Sİ (teacher_contract_status) YALNIZCA SERVİS ROLÜNE AÇIK —
 *      öğretmen başka bir öğretmenin onay durumunu yoklayamasın diye.
 *
 * DOLAYISIYLA BURADA SINIR ROUTE'UN KENDİSİ:
 *   Her sorgu res.locals.userId ile sınırlı — o değer requireSession'ın
 *   doğruladığı oturumdan geliyor (server/roles.ts). İstemciden HİÇBİR
 *   teacherId okunmuyor: ne gövdeden, ne sorgu parametresinden. Gövdeden
 *   gelen tek şey öğretmenin onayladığı belgelerin kimlikleri ve iki kutucuk;
 *   kimlikler de sunucudaki güncel sürümlerle karşılaştırılıyor.
 *
 * BU DOSYAYA YENİ BİR SORGU EKLERKEN: servis rolü RLS'i baypas ediyor,
 * `.eq("teacher_id", userId)` unutulursa hiçbir şey yakalamaz.
 *
 * YENİDEN ONAY İSTENMİYOR: bir kez onaylayan öğretmen, metnin yeni sürümü
 * yayınlansa da onaylı sayılıyor (karar RPC'de, tek satır). Yine de her onay
 * satırı hangi sürümlerin onaylandığını taşıyor.
 */

/** Belge türleri — API'deki anahtar -> veritabanındaki kind. */
const TURLER = {
  sozlesme: "ogretmen_sozlesmesi",
  aydinlatma: "kvkk_aydinlatma",
  kosullar: "hizmet_kosullari",
} as const;

type BelgeAnahtari = keyof typeof TURLER;
const ANAHTARLAR = Object.keys(TURLER) as BelgeAnahtari[];

interface Belge {
  id: string;
  version: number;
  title: string;
  body: string;
}

const GENERIC_ERROR = "Sözleşme bilgisi alınamadı. Lütfen tekrar deneyin.";
const KAYIT_ERROR = "Onayınız kaydedilemedi. Lütfen tekrar deneyin.";
const KAPI_ERROR = "Öğretmen paneli şu anda kullanılamıyor. Lütfen biraz sonra tekrar deneyin.";
const YAPILANDIRMA_ERROR =
  "Sözleşme metinleri eksik yayınlanmış. Lütfen yöneticiyle iletişime geçin.";
const GUNCELLENDI = {
  success: false,
  error: "Sözleşme metinleri güncellendi. Lütfen sayfayı yenileyip güncel metni okuyun.",
  code: "SOZLESME_GUNCELLENDI",
} as const;

/* teacher.ts ve admin.ts'teki kalıbın aynısı. Biçimsiz bir kimlikle sorgu
   atmak Postgres'ten 22P02 aldırırdı; bu bir 400. */
const UUID_BICIMI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Durum = "yok" | "imzali" | "imzasiz";

type DurumSonucu =
  | { tur: "durum"; durum: Durum }
  /* Tablo/RPC henüz yok: supabase-teacher-contract.sql uygulanmamış. */
  | { tur: "eksik-sema" }
  | { tur: "hata" };

/**
 * Öğretmenin onay durumu, tek RPC ile. Kapı her /api/teacher isteğinde bunu
 * çağırıyor; "bir sözleşme yayınlanmış mı" ve "bu öğretmen onaylamış mı"
 * sorularını iki ayrı tur yerine tek sorguda cevaplamak RPC'nin var olma
 * sebebi.
 */
async function durumOku(admin: SupabaseClient, userId: string): Promise<DurumSonucu> {
  const { data, error } = await admin.rpc("teacher_contract_status", { p_teacher: userId });

  if (error) {
    /* DAR liste (nesneYokMu): yalnızca tablo/fonksiyon HİÇ yoksa açık.
       Eksik KOLON şema sapması demek ve aşağıdaki "hata" yoluna düşüyor —
       kapı kapalı (503). Gerekçe ../semaHatasi.ts'te. */
    if (nesneYokMu(error)) {
      console.error(
        "[Sozlesme] KAPI DEVRE DIŞI: supabase-teacher-contract.sql uygulanmamış görünüyor —",
        error.code,
        error.message,
      );
      return { tur: "eksik-sema" };
    }
    console.error("[Sozlesme] durum okunamadı:", error.code, error.message);
    return { tur: "hata" };
  }

  if (data === "yok" || data === "imzali" || data === "imzasiz") {
    return { tur: "durum", durum: data };
  }

  /* Bilinmeyen bir değer "imzalı" sayılamaz: RPC değiştirilip buradaki liste
     unutulursa kapı sessizce açılırdı. Hata gibi ele alınıyor. */
  console.error("[Sozlesme] beklenmeyen durum değeri:", data);
  return { tur: "hata" };
}

/* ================================================================== KAPI */

/**
 * SÖZLEŞME KAPISI — requireSession + requireUserType("teacher")'DAN SONRA
 * mount edilir (userId orada doğrulanıyor), /sozlesme uçlarından SONRA
 * (onlar kapının önünde kalmalı, yoksa onay hiç verilemez). Bkz. teacher.ts.
 *
 *   'imzasiz'      -> 403 SOZLESME_GEREKLI
 *   'yok'/'imzali' -> geçer ('yok': henüz sözleşme yayınlanmamış, kapı kapalı
 *                     değil, devre dışı — panel bugünkü gibi çalışır)
 *
 * TABLO YA DA RPC HİÇ YOKSA GEÇİRİYOR (fail-open), bilerek: /api/admin/ozet'in
 * teacher_descriptions'ı yokken listeyi yine açmasıyla aynı gerekçe. Kod
 * migration'dan önce deploy edilirse bütün öğretmen panellerinin çökmesi,
 * henüz hiç yayınlanmamış bir sözleşmenin bir süre sorulmamasından çok daha
 * büyük bir zarar. Henüz tablo yoksa yayınlanmış sözleşme de yok; davranış
 * 'yok' ile aynı. Eksik KOLON bu istisnaya GİRMİYOR (şema sapması; sözleşme
 * yayınlanmış olabilir) — bkz. ../semaHatasi.ts.
 *
 * DİĞER HER HATADA 503 (fail-closed): veritabanı cevap vermiyorsa ya da
 * servis rolü yapılandırılmamışsa, onay durumu bilinmiyor demektir ve
 * bilinmeyen durum "onaylı" sayılmaz.
 */
export async function requireSignedContract(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const { userId } = res.locals as unknown as SessionLocals;

  const admin = serviceClient();
  if (!admin) {
    console.error("[Sozlesme] servis istemcisi yok — kapı kapalı tutuluyor.");
    return res.status(503).json({ success: false, error: KAPI_ERROR });
  }

  let sonuc: DurumSonucu;
  try {
    sonuc = await durumOku(admin, userId);
  } catch (err: any) {
    console.error("[Sozlesme] kapı istisnası:", err?.message || err);
    return res.status(503).json({ success: false, error: KAPI_ERROR });
  }

  if (sonuc.tur === "hata") {
    return res.status(503).json({ success: false, error: KAPI_ERROR });
  }

  if (sonuc.tur === "durum" && sonuc.durum === "imzasiz") {
    return res.status(403).json({
      success: false,
      error: "Paneli kullanmak için önce öğretmen sözleşmesini onaylamalısınız.",
      code: "SOZLESME_GEREKLI",
    });
  }

  /* next() try'ın DIŞINDA: sonraki katmanın bir hatası bu kapının
     "durum okunamadı" cevabına karışmasın. */
  next();
}

/* ================================================================= UÇLAR */

const router = express.Router();

/**
 * Her türün GÜNCEL sürümü (en yüksek version) — metinleriyle birlikte.
 * Üç küçük paralel sorgu: tablonun tamamını çekmek eski sürümlerin uzun
 * metinlerini de taşırdı.
 */
async function guncelBelgeler(
  admin: SupabaseClient,
): Promise<{ hata: string } | { belgeler: Record<BelgeAnahtari, Belge | null> }> {
  const sonuclar = await Promise.all(
    ANAHTARLAR.map((anahtar) =>
      admin
        .from("teacher_legal_documents")
        .select("id, version, title, body")
        .eq("kind", TURLER[anahtar])
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  );

  const belgeler = {} as Record<BelgeAnahtari, Belge | null>;
  for (let i = 0; i < ANAHTARLAR.length; i++) {
    const { data, error } = sonuclar[i];
    if (error) return { hata: error.message };
    belgeler[ANAHTARLAR[i]] = data
      ? { id: data.id, version: data.version, title: data.title, body: data.body }
      : null;
  }
  return { belgeler };
}

/**
 * SÖZLEŞME DURUMU — GET /api/teacher/sozlesme
 *
 *   { success, gerekli: false }                        — 'yok' ya da 'imzali'
 *   { success, gerekli: true, belgeler: { sozlesme, aydinlatma, kosullar } }
 *
 * Her belge { id, version, title, body }. Metin düz metin olarak dönüyor;
 * istemci onu HTML olarak render etmiyor.
 *
 * 'imzasiz' ama aydınlatma metni ya da koşullar yoksa 503: öğretmene eksik bir
 * belge setini onaylatmak, iki zorunlu kutucuğu anlamsız kılardı. Bu bir
 * yayın hatası ve çözümü yöneticide.
 */
router.get("/", async (_req, res) => {
  const { userId } = res.locals as unknown as SessionLocals;

  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: GENERIC_ERROR });

  try {
    const sonuc = await durumOku(admin, userId);

    /* Şema eksikse kapıyla AYNI cevap: kapı geçiriyorsa modal da açılmamalı. */
    if (sonuc.tur === "eksik-sema") return res.json({ success: true, gerekli: false });
    if (sonuc.tur === "hata") return res.status(502).json({ success: false, error: GENERIC_ERROR });
    if (sonuc.durum !== "imzasiz") return res.json({ success: true, gerekli: false });

    const okuma = await guncelBelgeler(admin);
    if ("hata" in okuma) {
      console.error("[Sozlesme] belgeler okunamadı:", okuma.hata);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }

    const { sozlesme, aydinlatma, kosullar } = okuma.belgeler;
    if (!sozlesme || !aydinlatma || !kosullar) {
      console.error("[Sozlesme] eksik belge — sozlesme/aydinlatma/kosullar:", {
        sozlesme: Boolean(sozlesme),
        aydinlatma: Boolean(aydinlatma),
        kosullar: Boolean(kosullar),
      });
      return res.status(503).json({ success: false, error: YAPILANDIRMA_ERROR });
    }

    return res.json({ success: true, gerekli: true, belgeler: { sozlesme, aydinlatma, kosullar } });
  } catch (err: any) {
    console.error("[Sozlesme] durum istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/**
 * ONAY — POST /api/teacher/sozlesme
 * Gövde: { sozlesmeId, aydinlatmaId, kosullarId, aydinlatmaOkundu, kosullarKabul }
 *
 *   200 { success }  — kaydedildi, ya da ZATEN onaylıydı (çift tık; yeni satır
 *                      yazılmaz)
 *   400              — biçimsiz kimlik ya da kutucuklardan biri `true` değil
 *   409 SOZLESME_GUNCELLENDI — gönderilen kimliklerden biri güncel sürüm
 *                      değil. Öğretmen tam olarak GÖRDÜĞÜ metni onaylamış
 *                      olsun diye: modal açıkken yeni sürüm yayınlandıysa eski
 *                      metne verilen onay yeni metne yazılmamalı.
 *
 * HİÇ SÖZLEŞME YAYINLANMAMIŞSA ('yok') DA 409 ve aynı kod — 400 değil. Bu,
 * istemcinin elindeki metnin artık geçerli olmadığı durumun özel bir hâli
 * (ör. henüz kimsenin onaylamadığı sözleşme satırı silindi). İstemci 409'da
 * belgeleri yeniden çekiyor; GET o zaman gerekli:false dönüyor ve panel
 * açılıyor — yani kullanıcı takılı kalmıyor. Şema eksikken de aynı gerekçeyle
 * 409.
 *
 * Kutucuklar sunucuda AYRICA zorunlu: veritabanındaki CHECK (= true) son
 * savunma, ama kullanıcıya anlamlı bir mesaj buradan dönüyor.
 */
router.post("/", async (req, res) => {
  const { userId } = res.locals as unknown as SessionLocals;
  const { sozlesmeId, aydinlatmaId, kosullarId, aydinlatmaOkundu, kosullarKabul } = req.body ?? {};

  const kimlikler = [sozlesmeId, aydinlatmaId, kosullarId];
  if (!kimlikler.every((k) => typeof k === "string" && UUID_BICIMI.test(k))) {
    return res.status(400).json({
      success: false,
      error: "Geçersiz belge bilgisi. Lütfen sayfayı yenileyip tekrar deneyin.",
    });
  }
  if (aydinlatmaOkundu !== true) {
    return res.status(400).json({
      success: false,
      error: "KVKK Aydınlatma Metni'ni okuduğunuzu onaylamalısınız.",
    });
  }
  if (kosullarKabul !== true) {
    return res.status(400).json({ success: false, error: "Hizmet Koşulları'nı kabul etmelisiniz." });
  }

  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: KAYIT_ERROR });

  try {
    const sonuc = await durumOku(admin, userId);
    if (sonuc.tur === "hata") return res.status(502).json({ success: false, error: KAYIT_ERROR });
    if (sonuc.tur === "eksik-sema" || sonuc.durum === "yok") return res.status(409).json(GUNCELLENDI);

    /* ÇİFT TIK / İKİNCİ SEKME: zaten onaylı. Yeni satır yazılmıyor — kanıt
       kaydını şişirmenin bir anlamı yok ve ilk onay belirleyici olan. */
    if (sonuc.durum === "imzali") return res.json({ success: true });

    /* Güncel kimlikler: metin gerekmiyor, yalnızca hangi satırın güncel
       olduğu ve sürüm numarası (denetim kaydı için). Satır sayısı belge türü
       x sürüm kadar — küçük; en yüksek sürüm her türde ilk gelen. */
    const { data: satirlar, error: belgeHatasi } = await admin
      .from("teacher_legal_documents")
      .select("id, kind, version")
      .order("version", { ascending: false });

    if (belgeHatasi) {
      console.error("[Sozlesme] belge kimlikleri okunamadı:", belgeHatasi.message);
      return res.status(502).json({ success: false, error: KAYIT_ERROR });
    }

    const guncel = new Map<string, { id: string; version: number }>();
    for (const s of satirlar ?? []) {
      if (!guncel.has(s.kind)) guncel.set(s.kind, { id: s.id, version: s.version });
    }

    const sozlesme = guncel.get(TURLER.sozlesme);
    const aydinlatma = guncel.get(TURLER.aydinlatma);
    const kosullar = guncel.get(TURLER.kosullar);

    if (!sozlesme || !aydinlatma || !kosullar) {
      console.error("[Sozlesme] onay sırasında eksik belge:", {
        sozlesme: Boolean(sozlesme),
        aydinlatma: Boolean(aydinlatma),
        kosullar: Boolean(kosullar),
      });
      return res.status(503).json({ success: false, error: YAPILANDIRMA_ERROR });
    }

    /* UUID karşılaştırması küçük harfle: Postgres kimliği küçük harfle
       döndürüyor, istemcinin büyük harfli göndermesi "farklı metin" değil. */
    const ayni = (gelen: string, beklenen: string) => gelen.toLowerCase() === beklenen.toLowerCase();
    if (
      !ayni(sozlesmeId, sozlesme.id) ||
      !ayni(aydinlatmaId, aydinlatma.id) ||
      !ayni(kosullarId, kosullar.id)
    ) {
      return res.status(409).json(GUNCELLENDI);
    }

    /*
     * KANIT SATIRI. teacher_id OTURUMDAN — gövdede böyle bir alan yok.
     * accepted_at gönderilmiyor: veritabanının now() varsayılanı koyuyor,
     * sunucunun saatine bile güvenilmiyor.
     * Kimlikler istemcinin değil, sunucunun okuduğu güncel satırlardan.
     *
     * Eşzamanlı iki istek (aynı anda iki sekme) ikisi de 'imzasiz' görüp iki
     * satır yazabilir. Zararsız: ikisi de gerçek bir onay ve /api/admin/ozet
     * ilk onayın tarihini gösteriyor.
     *
     * Aşağıdaki 23505 dalı YALNIZCA SAVUNMA AMAÇLI: bugün tabloda UNIQUE yok,
     * yani bu dal hiç çalışmaz. İleride teacher_id'ye bir UNIQUE eklenirse
     * çakışma "zaten onaylı" demek olur ve 502 yerine 200 dönsün diye duruyor.
     */
    const { error: yazmaHatasi } = await admin.from("teacher_contract_acceptances").insert({
      teacher_id: userId,
      sozlesme_id: sozlesme.id,
      aydinlatma_id: aydinlatma.id,
      kosullar_id: kosullar.id,
      aydinlatma_okundu: true,
      kosullar_kabul: true,
      ip: req.ip || null,
      user_agent: (req.get("user-agent") || "").slice(0, 500) || null,
    });

    if (yazmaHatasi) {
      if (yazmaHatasi.code === "23505") return res.json({ success: true });
      console.error("[Sozlesme] onay yazılamadı:", yazmaHatasi.code, yazmaHatasi.message);
      return res.status(502).json({ success: false, error: KAYIT_ERROR });
    }

    /* Denetim kaydına yalnızca SÜRÜMLER — metin değil (tabloda zaten var). */
    auditLog(req, "TEACHER_CONTRACT_ACCEPTED", {
      userId,
      detay: {
        sozlesmeSurum: sozlesme.version,
        aydinlatmaSurum: aydinlatma.version,
        kosullarSurum: kosullar.version,
      },
    });

    return res.json({ success: true });
  } catch (err: any) {
    console.error("[Sozlesme] onay istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: KAYIT_ERROR });
  }
});

export default router;
