import express from "express";
import { serviceClient } from "../supabase.js";
import { auditLog } from "../audit.js";
import { requireSession, requireUserType, type SessionLocals } from "../roles.js";
import { eksikSemaMi } from "../semaHatasi.js";
import { TR_OFFSET, haftaBasi, haftaSonrasi } from "../weekUtils.js";
import {
  type Aralik,
  adimaOturuyor,
  bitisHesapla,
  cakisiyor,
  dersBitisi,
  dersSuresi,
  musaitlikIcinde,
  musaitlikNormalize,
} from "../dersSaati.js";

/*
 * YÖNETİM PANELİ — /api/admin/*
 * ===========================================================================
 * Hesap açma, ders atama, ücret girme, form başvurularını görme. Bu ucları
 * yalnızca user_type='admin' olan kullanıcı görebiliyor.
 *
 * ---------------------------------------------------------------------------
 * BU MODÜL serviceClient() KULLANIYOR — VE BU, KURALIN İHLALİ DEĞİL İSTİSNASI
 * ---------------------------------------------------------------------------
 * portal.ts ve teacher.ts bilerek serviceClient() ÇAĞIRMIYOR; oradaki mantık
 * şu: veri kullanıcıya ait, dolayısıyla route'ta bir yetkilendirme hatası
 * olsa bile RLS "bu satır senin değil" diyerek emniyet ağı görevi görsün.
 *
 * Yönetim panelinde o ağın koruyacağı bir şey yok. Adminin meşru kapsamı
 * ZATEN her satır: bütün öğrencileri listelemek, herkese ders atamak,
 * herkesin ücretini girmek işin tanımı. "Başkasının satırı" diye bir kategori
 * olmadığı için RLS'in burada eleyeceği bir şey de yok.
 *
 * Ayrıca hesap açmanın BAŞKA YOLU YOK: auth.users'a şifre yazmak Supabase
 * Admin API'sini gerektiriyor (auth.admin.createUser) ve o da servis rolüyle
 * çalışıyor. Tabloya elle INSERT etmek — bcrypt'i elle üretip auth.identities
 * satırını da doğru kurmak — sürüme duyarlı ve sessizce bozulabilen bir iş;
 * eksik bir identities satırı "hesap açıldı ama giriş yapamıyor" olarak
 * ortaya çıkar. Dashboard'un kendi kullandığı yolu kullanıyoruz.
 *
 * DOLAYISIYLA BURADA SINIR ROUTE'UN KENDİSİ:
 *
 *   requireSession      -> oturumu çözer, rolü profiles'tan KULLANICININ
 *                          KENDİ jetonuyla okur (server/roles.ts)
 *   requireUserType     -> admin değilse 403
 *
 * Rol her istekte veritabanından yeniden okunuyor ve kullanıcı kendi
 * user_type'ını değiştiremiyor (profiles_update_own onu sabitliyor), yani
 * "kendini admin yapıp buraya gelmek" mümkün değil.
 *
 * KAYIP EMNİYET AĞININ KARŞILIĞI: her yazma denetim kaydına giriyor. Kim,
 * ne zaman, hangi hesabı açtı / hangi dersi sildi — servis rolüyle yapılan
 * bir işin geriye dönük tek cevabı bu (bkz. server/audit.ts).
 *
 * BU DOSYAYA YENİ BİR UÇ EKLERKEN: sorgunun WHERE'ini unutmak burada
 * RLS tarafından yakalanmaz. Servis rolü filtresiz bir UPDATE'i olduğu gibi
 * uygular.
 */

const router = express.Router();

router.use(requireSession);
router.use(requireUserType("admin"));

const GENERIC_ERROR = "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
const NOT_CONFIGURED = "Yönetim servisi şu anda kullanılamıyor.";

/*
 * ADIM ADIM HATA — yalnızca çok adımlı yazmalarda.
 * ---------------------------------------------------------------------------
 * Hesap açma dört adım (giriş kaydı, profil, müsaitlik, açıklama) ve hepsi
 * aynı GENERIC_ERROR'la düşüyordu: 2026-10-09'da "hesap açılmıyor" şikâyeti
 * hangi adımın patladığı bilinmeden geldi. Bu panel yalnızca yöneticiye açık,
 * yani HANGİ ADIMIN düştüğünü söylemek bir sızıntı değil. Ham veritabanı
 * mesajı yine istemciye gitmiyor (sunucu loguna gidiyor).
 *
 * Tablo/fonksiyon/kolon YOK hatası ayrıca tanınıyor (eksikSemaMi, kod listesi
 * ../semaHatasi.ts'te — sözleşme kapısı da aynı listeyi kullanıyor): bu,
 * kodun migration'dan önce deploy edildiği anlamına gelir ve çözümü tekrar
 * denemek değil, ilgili SQL dosyasını çalıştırmaktır.
 */
function adimHatasi(adim: string, error: { code?: string } | null | undefined, sqlDosyasi: string): string {
  return eksikSemaMi(error)
    ? `${adim} Veritabanı güncellemesi eksik: Supabase SQL Editor'de ${sqlDosyasi} çalıştırılmalı.`
    : `${adim} Lütfen tekrar deneyin.`;
}

const UUID_BICIMI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLLER = new Set(["student", "teacher", "admin"]);
const DERS_TURLERI = new Set(["ders", "koclu"]);
const DERS_DURUMLARI = new Set(["scheduled", "completed", "cancelled"]);
const ODEME_DURUMLARI = new Set(["odendi", "bekliyor", "gecikti"]);

/** Sitenin geri kalanıyla aynı kanonik biçim: "05321234567". */
function telefonNormalize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "").replace(/^0+/, "");
  const canonical = `0${digits}`;
  return /^05\d{9}$/.test(canonical) ? canonical : null;
}

function metin(value: unknown, maks = 200): string | null {
  if (typeof value !== "string") return null;
  const temiz = value.trim();
  if (!temiz || temiz.length > maks) return null;
  return temiz;
}

/** ISO tarih-saat. Geçersizse null — istemci `datetime-local` gönderiyor. */
function zaman(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Şifre uzunluğu SUNUCUDA da kontrol ediliyor. Supabase'in kendi alt sınırı
 * 6; burada 8 isteniyor çünkü bu şifreleri kullanıcı seçmiyor, yönetici
 * belirleyip kişiye iletiyor — kısa bir şifre kalıcı olarak kısa kalır.
 */
function sifre(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < 8 || value.length > 72) return null; // 72: bcrypt sınırı
  return value;
}

/*
 * Hesabın e-postası TELEFONDAN TÜRETİLİYOR. Giriş telefonla yapılıyor
 * (sunucu telefonu e-postaya çeviriyor, bkz. routes/auth.ts), yani e-posta
 * kullanıcıya hiç görünmeyen bir iç kimlik. Telefondan türetmek benzersizliği
 * de garantiliyor — profiles.phone zaten UNIQUE.
 *
 * Yönetici isterse gerçek bir e-posta verebilir; o zaman bu kullanılmaz.
 */
function turetilmisEposta(telefon: string): string {
  return `${telefon}@hesap.akademitu.com`;
}

/*
 * Kullanıcı adı: küçük harf, 3-30, [a-z0-9._-]. '@' YASAK — girişte e-posta
 * diye bir kavram yok ve kullanıcı adının e-postaya benzemesi kullanıcıya
 * "hangisini yazacağım" sorusunu sordururdu. Aynı kalıp veritabanında da
 * CHECK olarak duruyor (profiles_username_format).
 *
 * null döner: biçim geçersiz. Boş string ise 'kaldır' anlamına geliyor ve
 * çağıran taraf onu ayrıca ele alıyor.
 */
function kullaniciAdiNormalize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const temiz = value.trim().toLowerCase();
  return /^[a-z0-9._-]{3,30}$/.test(temiz) ? temiz : null;
}

function epostaNormalize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const e = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}

/*
 * Öğretmen açıklaması: verdiği dersler, notlar — serbest metin. Boş metin
 * "açıklamayı kaldır" demek; alanı boşaltmanın başka yolu yok ve tabloda boş
 * satır tutulmuyor (teacher_descriptions_length).
 */
const ACIKLAMA_MAKS = 2000;

function aciklamaNormalize(value: unknown): { hata: string } | { aciklama: string } {
  if (typeof value !== "string") return { hata: "Açıklama gönderilmedi." };
  const temiz = value.trim();
  if (temiz.length > ACIKLAMA_MAKS) {
    return { hata: `Açıklama en fazla ${ACIKLAMA_MAKS} karakter olabilir.` };
  }
  return { aciklama: temiz };
}

/* ==================================================================== ÖZET */

/**
 * Panelin açılışta ihtiyaç duyduğu her şey: tüm hesaplar, öğretmenlerin
 * açıklamaları ve öğretmen sözleşmesi onay durumu. Dersler ve ödemeler ayrı
 * uçlarda — onlar filtrelenerek çekiliyor ve hesap listesinden çok daha hızlı
 * büyüyor.
 *
 * `sozlesme` alanı: öğretmende `{ onaylandi, tarih }` — tarih İLK onayın
 * zamanı (yeniden onay istenmiyor, ilk onay hukuki olarak belirleyici olan);
 * öğretmen dışındaki hesaplarda null. İki durumda HERKESTE null ve istemci
 * null'da rozet göstermiyor:
 *   - Henüz hiç öğretmen sözleşmesi yayınlanmamışsa. Kapı o sırada devre dışı
 *     ('yok'); her öğretmenin yanında "onay bekleniyor" yazmak, beklenmeyen
 *     bir onayı bekliyormuş gibi gösterirdi.
 *   - Sözleşme ya da onay tablosu okunamazsa (migration henüz uygulanmamış
 *     olabilir). "Onaylamadı" demek yanlış olurdu, çünkü bilinmiyor.
 */
router.get("/ozet", async (_req, res) => {
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });

  try {
    const [{ data: profiller, error }, aciklamalar, onaylar, sozlesmeVarMi] = await Promise.all([
      admin
        .from("profiles")
        .select("id, full_name, phone, username, user_type, created_at")
        .order("user_type", { ascending: true })
        .order("full_name", { ascending: true }),
      admin.from("teacher_descriptions").select("teacher_id, description"),
      /* Artan sırada: aşağıdaki döngü her öğretmen için İLK satırı tutuyor.
         Satır sayısı öğretmen sayısı kadar (onay bir kez veriliyor; çift
         tıklama da sunucuda yeni satır yazmıyor), yani tamamını okumak ucuz. */
      admin
        .from("teacher_contract_acceptances")
        .select("teacher_id, accepted_at")
        .order("accepted_at", { ascending: true }),
      /* Yayınlanmış bir sözleşme var mı: tek satırlık kimlik okuması, metin yok. */
      admin.from("teacher_legal_documents").select("id").eq("kind", "ogretmen_sozlesmesi").limit(1),
    ]);

    if (error) {
      console.error("[Admin] profiller okunamadı:", error.message);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }

    /* Açıklamalar okunamazsa liste YİNE açılıyor, açıklamasız. Yardımcı bir
       alan yüzünden bütün panelin kilitlenmesi — tablo henüz yokken deploy
       edilmesi dahil — bedelinden büyük bir hata olurdu. */
    if (aciklamalar.error) {
      console.error("[Admin] öğretmen açıklamaları okunamadı:", aciklamalar.error.message);
    }
    const aciklamaHaritasi = new Map(
      (aciklamalar.data ?? []).map((a) => [a.teacher_id as string, a.description as string]),
    );

    /* Onaylar da aynı toleransla: okunamazsa liste açılıyor, `sozlesme` herkeste
       null. Sözleşme tablosu henüz yokken deploy edilmesi yönetim panelini
       kilitlememeli. */
    if (onaylar.error) {
      console.error("[Admin] sözleşme onayları okunamadı:", onaylar.error.message);
    }
    if (sozlesmeVarMi.error) {
      console.error("[Admin] sözleşme belgesi okunamadı:", sozlesmeVarMi.error.message);
    }
    /* Onay durumu ancak İKİ okuma da başarılıysa ve bir sözleşme yayınlanmışsa
       gösteriliyor; aksi hâlde herkeste null (bkz. uç yorumu). */
    const onayDurumuGosterilir =
      !onaylar.error && !sozlesmeVarMi.error && (sozlesmeVarMi.data ?? []).length > 0;
    const ilkOnay = new Map<string, string>();
    for (const o of onaylar.data ?? []) {
      const id = o.teacher_id as string;
      if (!ilkOnay.has(id)) ilkOnay.set(id, o.accepted_at as string);
    }

    return res.json({
      success: true,
      accounts: (profiller ?? []).map((p) => ({
        id: p.id,
        fullName: p.full_name,
        phone: p.phone,
        username: p.username,
        userType: p.user_type,
        createdAt: p.created_at,
        description: p.user_type === "teacher" ? aciklamaHaritasi.get(p.id) ?? null : null,
        sozlesme:
          p.user_type === "teacher" && onayDurumuGosterilir
            ? { onaylandi: ilkOnay.has(p.id), tarih: ilkOnay.get(p.id) ?? null }
            : null,
      })),
    });
  } catch (err: any) {
    console.error("[Admin] özet istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/* ================================================================= HESAPLAR */

/**
 * HESAP AÇ — POST /api/admin/hesaplar
 *
 * İki adım ve İKİSİ DE GEREKLİ (bkz. supabase-portal-auth.sql §1b):
 *   1. auth.users kaydı — Admin API ile, şifre hash'i Supabase'e bırakılıyor.
 *      `email_confirm: true` ŞART: doğrulanmamış bir hesap doğru şifreyle
 *      bile giriş yapamaz ve elle açılan hesapta doğrulama postası beklemenin
 *      anlamı yok.
 *   2. profiles satırı — telefon burada yaşıyor ve giriş bu satır üzerinden
 *      çözülüyor. Profili olmayan kullanıcı giriş YAPAMAZ.
 *
 * 1 olup 2 olmazsa ortada giriş yapamayan yetim bir auth kullanıcısı kalır;
 * o yüzden 2 başarısız olursa 1 GERİ ALINIYOR (aşağıdaki deleteUser).
 *
 * ÖĞRETMEN HESABINDA ÜÇÜNCÜ ADIM: müsait saatler (en az bir aralık, zorunlu).
 * Ders atama artık öğretmenin programından yapılıyor; müsaitliği olmayan bir
 * öğretmene hiç ders atanamaz. Bu adım da başarısız olursa hesap aynı
 * şekilde geri alınıyor — profiles auth.users'a CASCADE ile bağlı, yani
 * deleteUser profili de götürüyor.
 */
router.post("/hesaplar", async (req, res) => {
  const { userId: yapanId } = res.locals as unknown as SessionLocals;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });

  const fullName = metin(req.body?.fullName, 120);
  const phone = telefonNormalize(req.body?.phone);
  const password = sifre(req.body?.password);
  const userType = typeof req.body?.userType === "string" ? req.body.userType : "";
  const email = req.body?.email ? epostaNormalize(req.body.email) : null;
  const username = req.body?.username ? kullaniciAdiNormalize(req.body.username) : null;

  if (!fullName) return res.status(400).json({ success: false, error: "Ad soyad gerekli." });
  if (!phone) {
    return res.status(400).json({ success: false, error: "Telefon 05 ile başlamalı ve 11 haneli olmalı." });
  }
  if (!password) {
    return res.status(400).json({ success: false, error: "Şifre en az 8 karakter olmalı." });
  }
  if (!ROLLER.has(userType)) {
    return res.status(400).json({ success: false, error: "Geçersiz hesap türü." });
  }
  if (req.body?.email && !email) {
    return res.status(400).json({ success: false, error: "E-posta biçimi geçersiz." });
  }
  if (req.body?.username && !username) {
    return res.status(400).json({
      success: false,
      error: "Kullanıcı adı 3-30 karakter olmalı; sadece küçük harf, rakam, nokta, alt çizgi ve tire.",
    });
  }

  /* Müsaitlik auth kullanıcısı açılmadan ÖNCE doğrulanıyor: sonradan
     reddetmek geri alma gerektirirdi. Öğretmen dışındaki rollerde yok sayılır. */
  let musaitlik: Aralik[] = [];
  if (userType === "teacher") {
    const m = musaitlikNormalize(req.body?.availability);
    if ("hata" in m) return res.status(400).json({ success: false, error: m.hata });
    if (m.araliklar.length === 0) {
      return res.status(400).json({ success: false, error: "Öğretmenin en az bir müsait saat aralığı olmalı." });
    }
    musaitlik = m.araliklar;
  }

  /* Açıklama isteğe bağlı ve yalnızca öğretmende; o da auth kullanıcısından
     ÖNCE doğrulanıyor. */
  let aciklama = "";
  if (userType === "teacher" && req.body?.description !== undefined) {
    const a = aciklamaNormalize(req.body.description);
    if ("hata" in a) return res.status(400).json({ success: false, error: a.hata });
    aciklama = a.aciklama;
  }

  try {
    /* Telefon çakışması ÖNCEDEN kontrol ediliyor: auth kullanıcısını açıp
       sonra profiles'ın UNIQUE kısıtına takılmak, geri alma gerektiren
       gereksiz bir tur demek. */
    const { data: mevcut } = await admin
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (mevcut) {
      return res.status(409).json({ success: false, error: "Bu telefon numarası zaten kayıtlı." });
    }

    /* Kullanıcı adı çakışması da ÖNCEDEN eleniyor; aynı gerekçe — auth
       kullanıcısını açıp sonra UNIQUE indekse takılmak geri alma gerektirir. */
    if (username) {
      const { data: adVar } = await admin
        .from("profiles")
        .select("id")
        .eq("username", username)
        .maybeSingle();
      if (adVar) {
        return res.status(409).json({ success: false, error: "Bu kullanıcı adı zaten alınmış." });
      }
    }

    const { data: yeni, error: authHatasi } = await admin.auth.admin.createUser({
      email: email ?? turetilmisEposta(phone),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (authHatasi || !yeni?.user) {
      console.error("[Admin] auth kullanıcısı açılamadı:", authHatasi?.message);
      const cakisma = authHatasi?.message?.toLowerCase().includes("already");
      return res.status(cakisma ? 409 : 502).json({
        success: false,
        error: cakisma ? "Bu e-posta zaten kayıtlı." : "Hesap açılamadı: giriş kaydı oluşturulamadı. Lütfen tekrar deneyin.",
      });
    }

    const { error: profilHatasi } = await admin
      .from("profiles")
      .insert({ id: yeni.user.id, full_name: fullName, phone, username, user_type: userType });

    if (profilHatasi) {
      /* GERİ ALMA: profil yazılamadıysa auth kullanıcısı da kalmamalı.
         Aksi halde o telefonla bir daha hesap açılamaz (e-posta çakışır) ve
         ortada hiçbir işe yaramayan bir kullanıcı durur. */
      console.error("[Admin] profil yazılamadı, auth kullanıcısı geri alınıyor:", profilHatasi.message);
      await admin.auth.admin.deleteUser(yeni.user.id).catch((e) =>
        console.error("[Admin] geri alma da başarısız:", e?.message || e),
      );
      return res.status(502).json({
        success: false,
        error: adimHatasi("Hesap açılamadı: profil kaydedilemedi.", profilHatasi, "supabase-teacher-panel.sql"),
      });
    }

    if (userType === "teacher") {
      const { error: musaitlikHatasi } = await admin.rpc("set_teacher_availability", {
        p_teacher: yeni.user.id,
        p_slots: musaitlik,
      });
      if (musaitlikHatasi) {
        /* Aynı geri alma: müsaitliği olmayan bir öğretmen hesabı, bu ekranın
           "müsait saatler zorunlu" kuralını delmiş olurdu. */
        console.error("[Admin] müsaitlik yazılamadı, hesap geri alınıyor:", musaitlikHatasi.message);
        await admin.auth.admin.deleteUser(yeni.user.id).catch((e) =>
          console.error("[Admin] geri alma da başarısız:", e?.message || e),
        );
        return res.status(502).json({
          success: false,
          error: adimHatasi(
            "Hesap açılamadı: müsait saatler kaydedilemedi.",
            musaitlikHatasi,
            "supabase-teacher-availability.sql",
          ),
        });
      }

      /* Açıklama da aynı kurala tabi: yazılamazsa hesap geri alınıyor.
         Yönetici "açıldı" görüp açıklamanın sessizce kaybolduğunu ancak
         listede fark ederdi; tekrar denemek, yarım bir hesabı düzeltmekten
         kolay. */
      if (aciklama) {
        const aciklamaHatasi = await aciklamaYaz(admin, yeni.user.id, aciklama, yapanId);
        if (aciklamaHatasi) {
          console.error("[Admin] açıklama yazılamadı, hesap geri alınıyor:", aciklamaHatasi.message);
          await admin.auth.admin.deleteUser(yeni.user.id).catch((e) =>
            console.error("[Admin] geri alma da başarısız:", e?.message || e),
          );
          return res.status(502).json({
            success: false,
            error: adimHatasi(
              "Hesap açılamadı: açıklama kaydedilemedi (açıklamayı boş bırakarak açabilirsiniz).",
              aciklamaHatasi,
              "supabase-teacher-descriptions.sql",
            ),
          });
        }
      }
    }

    /* ŞİFRE DENETİM KAYDINA YAZILMIYOR — bkz. supabase-audit-log.sql. */
    auditLog(req, "ADMIN_ACCOUNT_CREATED", {
      userId: yapanId,
      detay: { hesapId: yeni.user.id, rol: userType },
    });

    return res.json({
      success: true,
      account: { id: yeni.user.id, fullName, phone, username, userType, description: aciklama || null },
    });
  } catch (err: any) {
    console.error("[Admin] hesap açma istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/** HESAP DÜZENLE — PATCH /api/admin/hesaplar/:id (ad / telefon / rol) */
router.patch("/hesaplar/:id", async (req, res) => {
  const { userId: yapanId } = res.locals as unknown as SessionLocals;
  const { id } = req.params;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });
  if (!UUID_BICIMI.test(id)) {
    return res.status(400).json({ success: false, error: "Hesap bulunamadı." });
  }

  const degisiklik: Record<string, unknown> = {};

  if (req.body?.fullName !== undefined) {
    const ad = metin(req.body.fullName, 120);
    if (!ad) return res.status(400).json({ success: false, error: "Ad soyad gerekli." });
    degisiklik.full_name = ad;
  }

  if (req.body?.phone !== undefined) {
    const tel = telefonNormalize(req.body.phone);
    if (!tel) {
      return res.status(400).json({ success: false, error: "Telefon 05 ile başlamalı ve 11 haneli olmalı." });
    }
    degisiklik.phone = tel;
  }

  if (req.body?.username !== undefined) {
    /* Boş string = kullanıcı adını KALDIR. Alanı boşaltmanın başka bir yolu
       olmazdı ve yanlış atanmış bir adı geri almak gerekebilir. */
    if (req.body.username === "" || req.body.username === null) {
      degisiklik.username = null;
    } else {
      const ad = kullaniciAdiNormalize(req.body.username);
      if (!ad) {
        return res.status(400).json({
          success: false,
          error: "Kullanıcı adı 3-30 karakter olmalı; sadece küçük harf, rakam, nokta, alt çizgi ve tire.",
        });
      }
      degisiklik.username = ad;
    }
  }

  if (req.body?.userType !== undefined) {
    if (!ROLLER.has(req.body.userType)) {
      return res.status(400).json({ success: false, error: "Geçersiz hesap türü." });
    }
    /*
     * KENDİ ROLÜNÜ DÜŞÜREMEZ. Tek admin kendini öğrenciye çevirirse panele
     * girebilecek kimse kalmaz ve geri dönüşün tek yolu SQL olur — bu
     * panelin var oluş sebebine aykırı.
     */
    if (id === yapanId && req.body.userType !== "admin") {
      return res.status(400).json({
        success: false,
        error: "Kendi yönetici rolünüzü kaldıramazsınız. Önce başka bir yönetici atayın.",
      });
    }
    degisiklik.user_type = req.body.userType;
  }

  if (Object.keys(degisiklik).length === 0) {
    return res.status(400).json({ success: false, error: "Değiştirilecek bir alan gönderilmedi." });
  }

  try {
    const { data, error } = await admin
      .from("profiles")
      .update(degisiklik)
      .eq("id", id)
      .select("id, full_name, phone, username, user_type")
      .maybeSingle();

    if (error) {
      console.error("[Admin] hesap güncellenemedi:", error.message);
      /* 23505 = UNIQUE ihlali. Telefon mu kullanıcı adı mı çakıştı, mesajdan
         ayırt ediliyor ki yönetici hangi alanı düzelteceğini bilsin. */
      const cakisma = error.code === "23505";
      const adCakismasi = cakisma && (error.message ?? "").includes("username");
      return res.status(cakisma ? 409 : 502).json({
        success: false,
        error: !cakisma
          ? GENERIC_ERROR
          : adCakismasi
            ? "Bu kullanıcı adı zaten alınmış."
            : "Bu telefon numarası zaten kayıtlı.",
      });
    }
    if (!data) return res.status(404).json({ success: false, error: "Hesap bulunamadı." });

    auditLog(req, "ADMIN_ACCOUNT_UPDATED", {
      userId: yapanId,
      /* Hangi ALANLARIN değiştiği yazılıyor, yeni DEĞERLER değil: denetim
         kaydı "kim ne yaptı"yı tespit eder, veriyi kopyalamaz. */
      detay: { hesapId: id, alanlar: Object.keys(degisiklik) },
    });

    return res.json({
      success: true,
      account: {
        id: data.id,
        fullName: data.full_name,
        phone: data.phone,
        username: data.username,
        userType: data.user_type,
      },
    });
  } catch (err: any) {
    console.error("[Admin] hesap güncelleme istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/**
 * ŞİFRE SIFIRLA — POST /api/admin/hesaplar/:id/sifre
 * Sitede "şifremi unuttum" akışı yok (hesaplar elle açılıyor), yani şifresini
 * unutan biri için tek yol bu.
 */
router.post("/hesaplar/:id/sifre", async (req, res) => {
  const { userId: yapanId } = res.locals as unknown as SessionLocals;
  const { id } = req.params;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });
  if (!UUID_BICIMI.test(id)) {
    return res.status(400).json({ success: false, error: "Hesap bulunamadı." });
  }

  const yeniSifre = sifre(req.body?.password);
  if (!yeniSifre) {
    return res.status(400).json({ success: false, error: "Şifre en az 8 karakter olmalı." });
  }

  try {
    const { error } = await admin.auth.admin.updateUserById(id, { password: yeniSifre });
    if (error) {
      console.error("[Admin] şifre sıfırlanamadı:", error.message);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }

    auditLog(req, "ADMIN_PASSWORD_RESET", { userId: yapanId, detay: { hesapId: id } });
    return res.json({ success: true });
  } catch (err: any) {
    console.error("[Admin] şifre sıfırlama istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/* ======================================================= ÖĞRETMEN MÜSAİTLİĞİ */

/*
 * Öğretmenin haftalık müsait saatleri (public.teacher_availability,
 * supabase-teacher-availability.sql). Hesap açılırken zorunlu; sonradan bu
 * uçlarla değiştiriliyor. Tablo yalnızca servis rolüne açık — öğretmen kendi
 * müsaitliğini yazamıyor, okuyamıyor da (şimdilik gereken de bu kadar).
 */

/** Hesap gerçekten bir öğretmen mi. Değilse uçlar 404 dönüyor. */
async function ogretmenMi(admin: NonNullable<ReturnType<typeof serviceClient>>, id: string) {
  const { data, error } = await admin.from("profiles").select("id, user_type").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.user_type === "teacher";
}

async function musaitlikOku(
  admin: NonNullable<ReturnType<typeof serviceClient>>,
  ogretmenId: string,
): Promise<Aralik[]> {
  const { data, error } = await admin
    .from("teacher_availability")
    .select("weekday, start_minute, end_minute")
    .eq("teacher_id", ogretmenId)
    .order("weekday", { ascending: true })
    .order("start_minute", { ascending: true });
  /* Hata nesnesi OLDUĞU GİBİ fırlatılıyor (new Error'a sarılmadan): kod
     korunsun ki çağıran "tablo yok" durumunu tanıyabilsin (adimHatasi). */
  if (error) throw error;
  return (data ?? []).map((a) => ({
    weekday: a.weekday,
    startMinute: a.start_minute,
    endMinute: a.end_minute,
  }));
}

/** MÜSAİTLİĞİ OKU — GET /api/admin/ogretmenler/:id/musaitlik */
router.get("/ogretmenler/:id/musaitlik", async (req, res) => {
  const { id } = req.params;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });
  if (!UUID_BICIMI.test(id)) return res.status(404).json({ success: false, error: "Öğretmen bulunamadı." });

  try {
    if (!(await ogretmenMi(admin, id))) {
      return res.status(404).json({ success: false, error: "Öğretmen bulunamadı." });
    }
    return res.json({ success: true, availability: await musaitlikOku(admin, id) });
  } catch (err: any) {
    console.error("[Admin] müsaitlik okunamadı:", err?.message || err);
    return res.status(502).json({
      success: false,
      error: adimHatasi("Müsait saatler okunamadı.", err, "supabase-teacher-availability.sql"),
    });
  }
});

/**
 * MÜSAİTLİĞİ DEĞİŞTİR — PUT /api/admin/ogretmenler/:id/musaitlik
 * Listenin TAMAMI gönderiliyor ve eskisinin yerine geçiyor (tek işlemde,
 * set_teacher_availability RPC'si). Mevcut dersler bundan ETKİLENMEZ:
 * müsaitliği daralan bir öğretmenin önceden atanmış dersi yerinde kalır.
 */
router.put("/ogretmenler/:id/musaitlik", async (req, res) => {
  const { userId: yapanId } = res.locals as unknown as SessionLocals;
  const { id } = req.params;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });
  if (!UUID_BICIMI.test(id)) return res.status(404).json({ success: false, error: "Öğretmen bulunamadı." });

  const m = musaitlikNormalize(req.body?.availability);
  if ("hata" in m) return res.status(400).json({ success: false, error: m.hata });
  if (m.araliklar.length === 0) {
    return res.status(400).json({ success: false, error: "Öğretmenin en az bir müsait saat aralığı olmalı." });
  }

  try {
    if (!(await ogretmenMi(admin, id))) {
      return res.status(404).json({ success: false, error: "Öğretmen bulunamadı." });
    }

    const { error } = await admin.rpc("set_teacher_availability", { p_teacher: id, p_slots: m.araliklar });
    if (error) {
      console.error("[Admin] müsaitlik yazılamadı:", error.message);
      return res.status(502).json({
        success: false,
        error: adimHatasi("Müsait saatler kaydedilemedi.", error, "supabase-teacher-availability.sql"),
      });
    }

    auditLog(req, "ADMIN_AVAILABILITY_WRITE", {
      userId: yapanId,
      detay: { hesapId: id, aralikSayisi: m.araliklar.length },
    });
    return res.json({ success: true, availability: m.araliklar });
  } catch (err: any) {
    console.error("[Admin] müsaitlik istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/* ======================================================= ÖĞRETMEN AÇIKLAMASI */

/*
 * public.teacher_descriptions (supabase-teacher-descriptions.sql): öğretmenin
 * verdiği dersler ve yöneticinin notları. YALNIZCA YÖNETİCİ görür — tablo
 * anon ve authenticated'a kapalı, öğretmen kendi açıklamasını da okuyamıyor.
 * Ayrı bir okuma ucu yok: açıklamalar /ozet ile hesap listesine geliyor.
 */

/** Açıklamayı yazar; boşsa satırı siler. Başarıda null, hatada veritabanı hatası döner. */
async function aciklamaYaz(
  admin: NonNullable<ReturnType<typeof serviceClient>>,
  ogretmenId: string,
  aciklama: string,
  yapanId: string,
): Promise<{ message: string; code?: string } | null> {
  /* Tek ifade (upsert), DELETE+INSERT değil: iki ayrı istek arasında bir hata
     açıklamayı tamamen silmiş bırakırdı. */
  const { error } = aciklama
    ? await admin.from("teacher_descriptions").upsert(
        {
          teacher_id: ogretmenId,
          description: aciklama,
          updated_at: new Date().toISOString(),
          updated_by: yapanId,
        },
        { onConflict: "teacher_id" },
      )
    : await admin.from("teacher_descriptions").delete().eq("teacher_id", ogretmenId);
  return error ?? null;
}

/**
 * AÇIKLAMAYI DEĞİŞTİR — PUT /api/admin/ogretmenler/:id/aciklama
 * Gövde: { description: string }. Boş metin açıklamayı kaldırıyor.
 */
router.put("/ogretmenler/:id/aciklama", async (req, res) => {
  const { userId: yapanId } = res.locals as unknown as SessionLocals;
  const { id } = req.params;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });
  if (!UUID_BICIMI.test(id)) return res.status(404).json({ success: false, error: "Öğretmen bulunamadı." });

  const a = aciklamaNormalize(req.body?.description);
  if ("hata" in a) return res.status(400).json({ success: false, error: a.hata });

  try {
    if (!(await ogretmenMi(admin, id))) {
      return res.status(404).json({ success: false, error: "Öğretmen bulunamadı." });
    }

    const hata = await aciklamaYaz(admin, id, a.aciklama, yapanId);
    if (hata) {
      console.error("[Admin] açıklama yazılamadı:", hata.message);
      return res.status(502).json({
        success: false,
        error: adimHatasi("Açıklama kaydedilemedi.", hata, "supabase-teacher-descriptions.sql"),
      });
    }

    auditLog(req, "ADMIN_TEACHER_DESCRIPTION_WRITE", {
      userId: yapanId,
      detay: { hesapId: id, uzunluk: a.aciklama.length },
    });
    return res.json({ success: true, description: a.aciklama || null });
  } catch (err: any) {
    console.error("[Admin] açıklama istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/**
 * ÖĞRETMENİN HAFTASI — GET /api/admin/ogretmenler/:id/program?week=YYYY-MM-DD
 *
 * Ders atama ekranının ızgarası: o haftanın müsaitliği ve DOLU saatleri.
 * Hafta sınırları /api/teacher/schedule ile aynı yerden (weekUtils), yani
 * yöneticinin gördüğü hafta öğretmenin kendi panelindekiyle aynı.
 * İptal edilmiş dersler gelmiyor — saati doldurmuyorlar.
 */
router.get("/ogretmenler/:id/program", async (req, res) => {
  const { id } = req.params;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });
  if (!UUID_BICIMI.test(id)) return res.status(404).json({ success: false, error: "Öğretmen bulunamadı." });

  const pazartesi = haftaBasi(req.query.week);
  const sonrakiPazartesi = haftaSonrasi(pazartesi);

  try {
    if (!(await ogretmenMi(admin, id))) {
      return res.status(404).json({ success: false, error: "Öğretmen bulunamadı." });
    }

    const [musaitlik, derslerSonuc] = await Promise.all([
      musaitlikOku(admin, id),
      admin
        .from("lessons")
        .select("id, user_id, subject, starts_at, ends_at, status, is_trial")
        .eq("teacher_id", id)
        .neq("status", "cancelled")
        .gte("starts_at", `${pazartesi}T00:00:00${TR_OFFSET}`)
        .lt("starts_at", `${sonrakiPazartesi}T00:00:00${TR_OFFSET}`)
        .order("starts_at", { ascending: true }),
    ]);

    if (derslerSonuc.error) {
      console.error("[Admin] öğretmen programı okunamadı:", derslerSonuc.error.message);
      return res.status(502).json({
        success: false,
        error: adimHatasi("Öğretmenin programı okunamadı.", derslerSonuc.error, "supabase-teacher-availability.sql"),
      });
    }

    const dersler = derslerSonuc.data ?? [];
    const ogrenciIdleri = [...new Set(dersler.map((d) => d.user_id))];
    const adlar = new Map<string, string>();
    if (ogrenciIdleri.length) {
      const { data: kisiler } = await admin.from("profiles").select("id, full_name").in("id", ogrenciIdleri);
      for (const k of kisiler ?? []) adlar.set(k.id, k.full_name);
    }

    return res.json({
      success: true,
      weekStart: pazartesi,
      availability: musaitlik,
      lessons: dersler.map((d) => ({
        id: d.id,
        studentName: adlar.get(d.user_id) ?? null,
        subject: d.subject,
        startsAt: d.starts_at,
        endsAt: dersBitisi(d.starts_at, d.ends_at),
        status: d.status,
        isTrial: d.is_trial,
      })),
    });
  } catch (err: any) {
    console.error("[Admin] öğretmen programı istisnası:", err?.message || err);
    return res.status(500).json({
      success: false,
      error: adimHatasi("Öğretmenin programı okunamadı.", err, "supabase-teacher-availability.sql"),
    });
  }
});

/* =================================================================== DERSLER */

/** PATCH'te karşılaştırma için okunan mevcut ders. */
interface MevcutDers {
  id: string;
  teacher_id: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  is_trial: boolean;
}

/**
 * Ders gövdesini doğrular. Hata varsa mesajı (ve HTTP kodunu), yoksa satırı
 * döndürür.
 *
 * SAAT KURALLARI (yalnızca saat "değiştiyse" uygulanıyor, aşağıya bkz.):
 *   - öğretmen zorunlu — saat onun programından seçiliyor
 *   - başlangıç saat başı ya da buçuk (Türkiye saati)
 *   - süre istemciden ALINMIYOR: deneme 25 dk, normal 50 dk, ends_at burada
 *   - dersin tamamı öğretmenin o günkü müsait aralıklarından birine sığmalı
 *   - öğretmenin VE öğrencinin iptal edilmemiş başka bir dersiyle çakışmamalı
 *
 * NE ZAMAN "DEĞİŞTİ" SAYILIYOR: yeni ders, ya da düzenlemede başlangıç,
 * öğretmen ya da deneme bayrağı farklıysa, ya da iptal edilmiş ders geri
 * açılıyorsa. Saati değişmeyen bir düzenleme (yalnızca konu ya da durum)
 * kuralları atlıyor — yoksa bu kurallardan ÖNCE girilmiş bir ders (14:15'te
 * başlayan, öğretmensiz, müsaitlik tanımlanmamış) bir daha hiç
 * düzenlenemez, iptal bile edilemezdi.
 *
 * YARIŞ DURUMU: çakışma kontrolü ile yazma arasında ikinci bir yönetici aynı
 * saati alabilir. Veritabanında bir exclusion kısıtı yok (eski veride
 * çakışmalar olabilir ve kısıt eklenemez); tek yöneticili bir panelde kabul
 * edilen bir boşluk.
 */
async function dersGovdesi(
  admin: NonNullable<ReturnType<typeof serviceClient>>,
  body: any,
  mevcut: MevcutDers | null,
): Promise<{ hata: string; kod?: number } | { satir: Record<string, unknown> }> {
  const studentId = typeof body?.studentId === "string" ? body.studentId : "";
  const teacherId = body?.teacherId ? String(body.teacherId) : null;
  const subject = metin(body?.subject, 120);
  const startsAt = zaman(body?.startsAt);
  const isTrial = body?.isTrial === true;
  const kind = typeof body?.kind === "string" ? body.kind : "ders";
  const status = typeof body?.status === "string" ? body.status : "scheduled";

  if (!UUID_BICIMI.test(studentId)) return { hata: "Öğrenci seçilmedi." };
  if (teacherId && !UUID_BICIMI.test(teacherId)) return { hata: "Öğretmen seçimi geçersiz." };
  if (!subject) return { hata: "Ders konusu gerekli." };
  if (!startsAt) return { hata: "Programdan bir ders saati seçin." };
  if (!DERS_TURLERI.has(kind)) return { hata: "Geçersiz ders türü." };
  if (!DERS_DURUMLARI.has(status)) return { hata: "Geçersiz ders durumu." };

  /*
   * Seçilen kişilerin ROLLERİ doğrulanıyor. Veritabanı bunu kontrol etmiyor
   * (lessons.user_id yalnızca auth.users'a bakıyor), yani bu olmadan bir
   * öğretmen yanlışlıkla "öğrenci" alanına yazılabilir ve o ders kimsenin
   * panelinde doğru görünmezdi.
   */
  const { data: kisiler } = await admin
    .from("profiles")
    .select("id, full_name, user_type")
    .in("id", teacherId ? [studentId, teacherId] : [studentId]);

  const ogrenci = (kisiler ?? []).find((k) => k.id === studentId);
  if (!ogrenci) return { hata: "Öğrenci bulunamadı." };
  if (ogrenci.user_type !== "student") return { hata: "Seçilen kişi öğrenci değil." };

  let ogretmenAdi: string | null = null;
  if (teacherId) {
    const ogretmen = (kisiler ?? []).find((k) => k.id === teacherId);
    if (!ogretmen) return { hata: "Öğretmen bulunamadı." };
    if (ogretmen.user_type !== "teacher") return { hata: "Seçilen kişi öğretmen değil." };
    ogretmenAdi = ogretmen.full_name;
  }

  const saatDegisti =
    !mevcut ||
    new Date(mevcut.starts_at).getTime() !== new Date(startsAt).getTime() ||
    mevcut.teacher_id !== teacherId ||
    mevcut.is_trial !== isTrial ||
    (mevcut.status === "cancelled" && status !== "cancelled");

  let endsAt: string | null = mevcut?.ends_at ?? null;

  if (saatDegisti) {
    if (!teacherId) return { hata: "Öğretmen seçilmedi. Ders saati öğretmenin programından seçiliyor." };
    if (!adimaOturuyor(startsAt)) {
      return { hata: "Dersler yalnızca saat başı ya da buçukta başlayabilir." };
    }

    const sure = dersSuresi(isTrial);
    endsAt = bitisHesapla(startsAt, sure);

    const musaitlik = await musaitlikOku(admin, teacherId);
    if (!musaitlikIcinde(musaitlik, startsAt, sure)) {
      return { hata: `Bu saat öğretmenin müsait saatlerinin dışında (${sure} dk'lık ders sığmıyor).` };
    }

    /*
     * Çakışma: öğretmenin ya da öğrencinin iptal edilmemiş başka bir dersi.
     * Alt sınır bir gün önce — en uzun ders bile o kadar geriye taşmaz, ve
     * sorgu bütün geçmişi taramasın. Kimlikler UUID_BICIMI'nden geçti, yani
     * or() sözdizimine güvenle giriyor.
     */
    if (status !== "cancelled") {
      const birGunOnce = new Date(new Date(startsAt).getTime() - 24 * 60 * 60 * 1000).toISOString();
      let sorgu = admin
        .from("lessons")
        .select("id, user_id, teacher_id, starts_at, ends_at")
        .neq("status", "cancelled")
        .gt("starts_at", birGunOnce)
        .lt("starts_at", endsAt)
        .or(`teacher_id.eq.${teacherId},user_id.eq.${studentId}`);
      if (mevcut) sorgu = sorgu.neq("id", mevcut.id);

      const { data: digerleri, error } = await sorgu;
      if (error) throw new Error(error.message);

      for (const d of digerleri ?? []) {
        if (!cakisiyor(startsAt, endsAt, d.starts_at, dersBitisi(d.starts_at, d.ends_at))) continue;
        return d.teacher_id === teacherId
          ? { hata: "Öğretmenin bu saatte başka bir dersi var.", kod: 409 }
          : { hata: "Öğrencinin bu saatte başka bir dersi var.", kod: 409 };
      }
    }
  }

  return {
    satir: {
      user_id: studentId,
      teacher_id: teacherId,
      subject,
      /* teacher_name DENORMALİZE tutuluyor: öğrenci paneli bunu gösteriyor ve
         öğretmen hesabı silinse bile dersin kimden alındığı kalmalı
         (bkz. supabase-teacher-panel.sql'deki kolon yorumu). */
      teacher_name: ogretmenAdi,
      starts_at: startsAt,
      ends_at: endsAt,
      is_trial: isTrial,
      kind,
      status,
    },
  };
}

/** DERSLERİ LİSTELE — GET /api/admin/dersler?from=&to=&studentId=&teacherId= */
router.get("/dersler", async (req, res) => {
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });

  try {
    let sorgu = admin
      .from("lessons")
      .select("id, user_id, teacher_id, subject, teacher_name, starts_at, ends_at, kind, status, is_trial")
      .order("starts_at", { ascending: false })
      .limit(200);

    const from = zaman(req.query.from);
    const to = zaman(req.query.to);
    if (from) sorgu = sorgu.gte("starts_at", from);
    if (to) sorgu = sorgu.lte("starts_at", to);
    if (typeof req.query.studentId === "string" && UUID_BICIMI.test(req.query.studentId)) {
      sorgu = sorgu.eq("user_id", req.query.studentId);
    }
    if (typeof req.query.teacherId === "string" && UUID_BICIMI.test(req.query.teacherId)) {
      sorgu = sorgu.eq("teacher_id", req.query.teacherId);
    }

    const { data: dersler, error } = await sorgu;
    if (error) {
      console.error("[Admin] dersler okunamadı:", error.message);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }

    const kisiIdleri = [
      ...new Set(
        (dersler ?? []).flatMap((d) => [d.user_id, d.teacher_id]).filter(Boolean) as string[],
      ),
    ];
    const adlar = new Map<string, string>();
    if (kisiIdleri.length) {
      const { data: kisiler } = await admin
        .from("profiles")
        .select("id, full_name")
        .in("id", kisiIdleri);
      for (const k of kisiler ?? []) adlar.set(k.id, k.full_name);
    }

    return res.json({
      success: true,
      lessons: (dersler ?? []).map((d) => ({
        id: d.id,
        studentId: d.user_id,
        studentName: adlar.get(d.user_id) ?? null,
        teacherId: d.teacher_id,
        teacherName: d.teacher_id ? (adlar.get(d.teacher_id) ?? d.teacher_name) : d.teacher_name,
        subject: d.subject,
        startsAt: d.starts_at,
        endsAt: d.ends_at,
        isTrial: d.is_trial,
        kind: d.kind,
        status: d.status,
      })),
    });
  } catch (err: any) {
    console.error("[Admin] ders listesi istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/** DERS EKLE — POST /api/admin/dersler */
router.post("/dersler", async (req, res) => {
  const { userId: yapanId } = res.locals as unknown as SessionLocals;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });

  try {
    const dogrulama = await dersGovdesi(admin, req.body, null);
    if ("hata" in dogrulama) {
      return res.status(dogrulama.kod ?? 400).json({ success: false, error: dogrulama.hata });
    }

    const { data, error } = await admin
      .from("lessons")
      .insert(dogrulama.satir)
      .select("id")
      .single();

    if (error) {
      console.error("[Admin] ders eklenemedi:", error.message);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }

    auditLog(req, "ADMIN_LESSON_WRITE", { userId: yapanId, detay: { dersId: data.id, islem: "olustur" } });
    return res.json({ success: true, id: data.id });
  } catch (err: any) {
    console.error("[Admin] ders ekleme istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/** DERS DÜZENLE — PATCH /api/admin/dersler/:id */
router.patch("/dersler/:id", async (req, res) => {
  const { userId: yapanId } = res.locals as unknown as SessionLocals;
  const { id } = req.params;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });
  if (!UUID_BICIMI.test(id)) return res.status(400).json({ success: false, error: "Ders bulunamadı." });

  try {
    /* Mevcut ders okunuyor: saat kurallarının uygulanıp uygulanmayacağı
       neyin DEĞİŞTİĞİNE bağlı (bkz. dersGovdesi). */
    const { data: mevcut, error: okumaHatasi } = await admin
      .from("lessons")
      .select("id, teacher_id, starts_at, ends_at, status, is_trial")
      .eq("id", id)
      .maybeSingle();
    if (okumaHatasi) {
      console.error("[Admin] ders okunamadı:", okumaHatasi.message);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }
    if (!mevcut) return res.status(404).json({ success: false, error: "Ders bulunamadı." });

    const dogrulama = await dersGovdesi(admin, req.body, mevcut);
    if ("hata" in dogrulama) {
      return res.status(dogrulama.kod ?? 400).json({ success: false, error: dogrulama.hata });
    }

    /* `.eq("id", id)` — servis rolüyle çalışıldığı için bunu unutmak TÜM
       dersleri güncellemek demek; RLS burada yakalamaz. */
    const { data, error } = await admin
      .from("lessons")
      .update(dogrulama.satir)
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[Admin] ders güncellenemedi:", error.message);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }
    if (!data) return res.status(404).json({ success: false, error: "Ders bulunamadı." });

    auditLog(req, "ADMIN_LESSON_WRITE", { userId: yapanId, detay: { dersId: id, islem: "duzenle" } });
    return res.json({ success: true, id });
  } catch (err: any) {
    console.error("[Admin] ders güncelleme istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/** DERS SİL — DELETE /api/admin/dersler/:id (yorumu da CASCADE ile gider) */
router.delete("/dersler/:id", async (req, res) => {
  const { userId: yapanId } = res.locals as unknown as SessionLocals;
  const { id } = req.params;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });
  if (!UUID_BICIMI.test(id)) return res.status(400).json({ success: false, error: "Ders bulunamadı." });

  try {
    const { data, error } = await admin.from("lessons").delete().eq("id", id).select("id").maybeSingle();
    if (error) {
      console.error("[Admin] ders silinemedi:", error.message);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }
    if (!data) return res.status(404).json({ success: false, error: "Ders bulunamadı." });

    auditLog(req, "ADMIN_LESSON_DELETED", { userId: yapanId, detay: { dersId: id } });
    return res.json({ success: true });
  } catch (err: any) {
    console.error("[Admin] ders silme istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/* =================================================================== ÖDEMELER */

function odemeGovdesi(body: any): { hata: string } | { satir: Record<string, unknown> } {
  const studentId = typeof body?.studentId === "string" ? body.studentId : "";
  const period = metin(body?.period, 60);
  const status = typeof body?.status === "string" ? body.status : "bekliyor";
  const currency = metin(body?.currency, 8) ?? "TRY";
  const dueOn = body?.dueOn ? String(body.dueOn) : null;

  /* Tutar Number()'a çevriliyor: istemci metin gönderebilir ("1500" ya da
     "1500,50"). Virgül noktaya çevriliyor çünkü Türkçe klavyede ondalık
     ayırıcı virgül. */
  const ham = typeof body?.amount === "string" ? body.amount.replace(",", ".") : body?.amount;
  const amount = Number(ham);

  if (!UUID_BICIMI.test(studentId)) return { hata: "Öğrenci seçilmedi." };
  if (!period) return { hata: "Dönem gerekli (örn. 2026-09 ya da Eylül 2026)." };
  if (!Number.isFinite(amount) || amount < 0) return { hata: "Tutar geçersiz." };
  if (!ODEME_DURUMLARI.has(status)) return { hata: "Geçersiz ödeme durumu." };
  if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return { hata: "Son ödeme tarihi geçersiz." };

  return {
    satir: { user_id: studentId, period, amount, currency, status, due_on: dueOn },
  };
}

/** ÖDEMELERİ LİSTELE — GET /api/admin/odemeler?studentId= */
router.get("/odemeler", async (req, res) => {
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });

  try {
    let sorgu = admin
      .from("payments")
      .select("id, user_id, period, amount, currency, status, due_on, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (typeof req.query.studentId === "string" && UUID_BICIMI.test(req.query.studentId)) {
      sorgu = sorgu.eq("user_id", req.query.studentId);
    }

    const { data: odemeler, error } = await sorgu;
    if (error) {
      console.error("[Admin] ödemeler okunamadı:", error.message);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }

    const idler = [...new Set((odemeler ?? []).map((o) => o.user_id))];
    const adlar = new Map<string, string>();
    if (idler.length) {
      const { data: kisiler } = await admin.from("profiles").select("id, full_name").in("id", idler);
      for (const k of kisiler ?? []) adlar.set(k.id, k.full_name);
    }

    return res.json({
      success: true,
      payments: (odemeler ?? []).map((o) => ({
        id: o.id,
        studentId: o.user_id,
        studentName: adlar.get(o.user_id) ?? null,
        period: o.period,
        amount: Number(o.amount),
        currency: o.currency,
        status: o.status,
        dueOn: o.due_on,
      })),
    });
  } catch (err: any) {
    console.error("[Admin] ödeme listesi istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/** ÖDEME EKLE — POST /api/admin/odemeler */
router.post("/odemeler", async (req, res) => {
  const { userId: yapanId } = res.locals as unknown as SessionLocals;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });

  const dogrulama = odemeGovdesi(req.body);
  if ("hata" in dogrulama) return res.status(400).json({ success: false, error: dogrulama.hata });

  try {
    const { data, error } = await admin.from("payments").insert(dogrulama.satir).select("id").single();
    if (error) {
      console.error("[Admin] ödeme eklenemedi:", error.message);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }

    /* TUTAR DENETİM KAYDINA YAZILMIYOR — supabase-audit-log.sql ödeme
       detayını açıkça yasaklıyor. Hangi satırın dokunulduğu yeterli. */
    auditLog(req, "ADMIN_PAYMENT_WRITE", { userId: yapanId, detay: { odemeId: data.id, islem: "olustur" } });
    return res.json({ success: true, id: data.id });
  } catch (err: any) {
    console.error("[Admin] ödeme ekleme istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/** ÖDEME DÜZENLE — PATCH /api/admin/odemeler/:id */
router.patch("/odemeler/:id", async (req, res) => {
  const { userId: yapanId } = res.locals as unknown as SessionLocals;
  const { id } = req.params;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });
  if (!UUID_BICIMI.test(id)) return res.status(400).json({ success: false, error: "Ödeme bulunamadı." });

  const dogrulama = odemeGovdesi(req.body);
  if ("hata" in dogrulama) return res.status(400).json({ success: false, error: dogrulama.hata });

  try {
    const { data, error } = await admin
      .from("payments")
      .update(dogrulama.satir)
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[Admin] ödeme güncellenemedi:", error.message);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }
    if (!data) return res.status(404).json({ success: false, error: "Ödeme bulunamadı." });

    auditLog(req, "ADMIN_PAYMENT_WRITE", { userId: yapanId, detay: { odemeId: id, islem: "duzenle" } });
    return res.json({ success: true, id });
  } catch (err: any) {
    console.error("[Admin] ödeme güncelleme istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/** ÖDEME SİL — DELETE /api/admin/odemeler/:id */
router.delete("/odemeler/:id", async (req, res) => {
  const { userId: yapanId } = res.locals as unknown as SessionLocals;
  const { id } = req.params;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });
  if (!UUID_BICIMI.test(id)) return res.status(400).json({ success: false, error: "Ödeme bulunamadı." });

  try {
    const { data, error } = await admin.from("payments").delete().eq("id", id).select("id").maybeSingle();
    if (error) {
      console.error("[Admin] ödeme silinemedi:", error.message);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }
    if (!data) return res.status(404).json({ success: false, error: "Ödeme bulunamadı." });

    auditLog(req, "ADMIN_PAYMENT_DELETED", { userId: yapanId, detay: { odemeId: id } });
    return res.json({ success: true });
  } catch (err: any) {
    console.error("[Admin] ödeme silme istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/* ================================================================ BAŞVURULAR */

/*
 * Sitedeki iki adımlı formdan gelen başvurular (public.leads). Bu tablo
 * kimseye ait değil: anon ve authenticated'ın üzerinde HİÇBİR yetkisi yok
 * (supabase-portal-auth.sql), satırları /api/leads servis rolüyle yazıyor.
 * Okumanın da tek yolu servis rolü, yani bu uç yukarıdaki istisnanın
 * kapsamına doğal olarak giriyor — RLS'in eleyebileceği bir "sahip" yok.
 *
 * SALT OKUNUR. Düzenleme/silme ucu bilerek yok: başvuru, formu dolduran
 * kişinin beyanı ve yöneticinin onu değiştirmesi için bir sebep yok.
 *
 * `website` (bal küpü) ve `first_seen_lead_id` seçilmiyor: ilki dolu olan
 * satır zaten hiç yazılmıyor (server.ts reddediyor), ikincisinin panelde
 * karşılığı `is_repeat_submission` bayrağı.
 */

const BASVURU_SAYFA_BOYUTU = 50;
const BASVURU_SINAVLARI = new Set(["YKS", "LGS", "Diğer"]);

/**
 * Arama metni PostgREST'in `or=(...)` sözdiziminin İÇİNE yazılıyor. Virgül,
 * nokta ve parantez orada ayırıcı; `*` ve `%` joker. Temizlenmeden geçen bir
 * "a,phone.neq.x" filtreyi değiştirir. Yalnızca harf, rakam ve boşluk kalıyor
 * — ad ve telefon aramak için gereken her şey bu.
 */
function aramaMetni(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const temiz = value
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return temiz.length >= 2 ? temiz : null;
}

/** BAŞVURULARI LİSTELE — GET /api/admin/basvurular?sayfa=&q=&sinav=&adim= */
router.get("/basvurular", async (req, res) => {
  const { userId: yapanId } = res.locals as unknown as SessionLocals;
  const admin = serviceClient();
  if (!admin) return res.status(503).json({ success: false, error: NOT_CONFIGURED });

  const sayfa = Math.min(Math.max(Number.parseInt(String(req.query.sayfa ?? "1"), 10) || 1, 1), 10_000);
  const bas = (sayfa - 1) * BASVURU_SAYFA_BOYUTU;

  try {
    let sorgu = admin
      .from("leads")
      /* Tek literal olmalı: birleştirilmiş string supabase-js'in satır tipini
         çıkarmasını engelliyor. */
      .select(
        "id, created_at, updated_at, full_name, phone, exam_type, step, student_full_name, parent_full_name, user_role, grade_class, selected_subjects, is_repeat_submission",
        { count: "exact" },
      )
      /* `id` eşitlik bozucu: adım 1 damgayı sunucudan alıyor ve aynı
         milisaniyeye düşen iki başvuru sayfa sınırında yer değiştirmesin. */
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(bas, bas + BASVURU_SAYFA_BOYUTU - 1);

    if (typeof req.query.sinav === "string" && BASVURU_SINAVLARI.has(req.query.sinav)) {
      sorgu = sorgu.eq("exam_type", req.query.sinav);
    }
    if (req.query.adim === "1" || req.query.adim === "2") {
      sorgu = sorgu.eq("step", Number(req.query.adim));
    }

    const arama = aramaMetni(req.query.q);
    if (arama) {
      /* Boşluklar da joker oluyor: "ahmet yılmaz" -> *ahmet*yılmaz*, yani
         araya ikinci bir ad girse de ("Ahmet Can Yılmaz") eşleşiyor. URL'de
         boşluk taşımamanın da yolu bu. */
      const desen = arama.split(" ").join("*");
      const kosullar = ["full_name", "student_full_name", "parent_full_name"].map(
        (kolon) => `${kolon}.ilike.*${desen}*`,
      );
      /* Telefon "05321234567" biçiminde saklanıyor; yönetici "0532 123 45"
         yazsa da eşleşsin diye aramadaki rakamlar bitişik aranıyor. */
      const rakamlar = arama.replace(/\D/g, "");
      if (rakamlar.length >= 3) kosullar.push(`phone.ilike.*${rakamlar}*`);
      sorgu = sorgu.or(kosullar.join(","));
    }

    const { data, error, count } = await sorgu;
    if (error) {
      console.error("[Admin] başvurular okunamadı:", error.message);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }

    /* Başkalarının kişisel verisine (telefon, çocuğun adı) erişim, kim ne
       zaman baktı sorusunu cevaplanabilir kılmak için kayda giriyor. Arama
       metni YAZILMIYOR: bir telefon numarası olabilir. */
    auditLog(req, "ADMIN_LEADS_VIEWED", {
      userId: yapanId,
      detay: { sayfa, adet: data?.length ?? 0 },
    });

    return res.json({
      success: true,
      total: count ?? 0,
      page: sayfa,
      pageSize: BASVURU_SAYFA_BOYUTU,
      leads: (data ?? []).map((l) => ({
        id: l.id,
        createdAt: l.created_at,
        updatedAt: l.updated_at,
        fullName: l.full_name,
        phone: l.phone,
        examType: l.exam_type,
        step: l.step,
        studentFullName: l.student_full_name || null,
        parentFullName: l.parent_full_name || null,
        userRole: l.user_role || null,
        gradeClass: l.grade_class || null,
        subjects: Array.isArray(l.selected_subjects) ? l.selected_subjects : [],
        isRepeat: Boolean(l.is_repeat_submission),
      })),
    });
  } catch (err: any) {
    console.error("[Admin] başvuru listesi istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

export default router;
