import express from "express";
import { userClient } from "../supabase.js";
import { auditLog } from "../audit.js";
import { requireSession, requireUserType, type SessionLocals } from "../roles.js";
import { TR_OFFSET, haftaBasi, haftaSonrasi } from "../weekUtils.js";
import sozlesmeRouter, { requireSignedContract } from "./teacherContract.js";

/*
 * ÖĞRETMEN PANELİ VERİSİ — /api/teacher/*
 * ===========================================================================
 * /api/portal ile AYNI yetki modelini kullanıyor ve aynı sebeple: veri
 * kullanıcıya ait, dolayısıyla her sorgu çerezdeki jetonla kurulan bir
 * istemciyle (userClient) ve RLS altında çalışıyor.
 *
 * Bu dosyada da serviceClient() ÇAĞRILMAZ. Öğretmen verisi "kimseye ait
 * olmayan" veri değil — tam tersine, hangi öğretmenin hangi dersi göreceği
 * bu katmanın bütün meselesi. Servis rolü kullanılırsa yetkilendirme
 * tamamen route kodunun doğruluğuna kalır ve RLS emniyet ağı düşer.
 *
 * Öğretmen sözleşmesi kapısı ve /sozlesme uçları ./teacherContract.ts'te ve
 * o dosya serviceClient() KULLANIYOR — belgelenmiş bir istisna (onay kaydı
 * bir kanıt; öğretmenin kendi jetonuyla yazılamamalı). Gerekçe oranın
 * başlığında. Bu dosyanın kendisi için kural değişmedi.
 *
 * İKİ KATMAN, İKİ FARKLI İŞ:
 *   requireUserType("teacher") -> "burası senin panelin değil" (403).
 *   RLS politikaları           -> "bu satır senin değil" (satır hiç gelmez).
 * Birincisi kaldırılsa veri yine sızmaz; ikincisi kaldırılsa sızar.
 */

const router = express.Router();

router.use(requireSession);
router.use(requireUserType("teacher"));

/*
 * SÖZLEŞME KAPISI — SIRA YÜK TAŞIYOR.
 *   1. Rol kapısı ÖNCE: öğrenci ya da yönetici buraya gelirse "sözleşmeyi
 *      onaylayın" değil, rol 403'ü almalı — sözleşme yalnızca öğretmeni
 *      ilgilendiriyor, ve rol reddi denetim kaydına yalnızca orada yazılıyor.
 *   2. /sozlesme uçları kapının ÖNÜNDE: arkasında olsalardı onaylamamış bir
 *      öğretmen onay veremezdi.
 *   3. Kapı: bundan sonra mount edilen her şey — /ozet, /schedule, ders
 *      durumu, yorum — sözleşme onaylanmadan 403 SOZLESME_GEREKLI döner.
 * Bu dosyaya yeni bir uç eklemek onu otomatik olarak kapının arkasına koyar.
 */
router.use("/sozlesme", sozlesmeRouter);
router.use(requireSignedContract);

/**
 * Öğretmenin kim olduğunu döndüren küçük uç.
 *
 * Ayrı bir /api/auth/me varken bu neden var: /api/auth/me rolden bağımsız
 * çalışır ve öğretmene özel hiçbir şey bilmez. Burası öğretmen panelinin
 * kendi ucu ve rol kapısının ARKASINDA — bir öğrencinin buraya 403 alması,
 * yetkilendirmenin çalıştığının en küçük kanıtı.
 */
router.get("/ozet", (_req, res) => {
  const { userId, fullName } = res.locals as unknown as SessionLocals;

  return res.json({
    success: true,
    teacher: { id: userId, fullName },
  });
});

/*
 * Hafta sınırları artık ../weekUtils.js'te: /api/portal da aynı hesabı
 * kullanıyor (öğrencinin "bu hafta"sı ile öğretmenin programı sessizce
 * ayrışmasın diye), o yüzden mantık iki dosyaya kopyalanmak yerine tek
 * yerde yaşıyor.
 */
const GENERIC_ERROR = "Ders programı alınamadı. Lütfen tekrar deneyin.";

/**
 * HAFTALIK DERS PROGRAMI — GET /api/teacher/schedule?week=YYYY-MM-DD
 *
 * `week` yalnızca HANGİ HAFTA sorusunu cevaplıyor. KİMİN programı sorusunun
 * cevabı istemciden GELMİYOR: öğretmen kimliği oturumdan (res.locals.userId)
 * okunuyor. İstemcinin gönderebileceği bir teacherId parametresi yok — olsaydı
 * en klasik IDOR'u davet ederdi.
 */
router.get("/schedule", async (req, res) => {
  const { accessToken, userId } = res.locals as unknown as SessionLocals;

  const supabase = userClient(accessToken);
  if (!supabase) {
    return res.status(503).json({ success: false, error: GENERIC_ERROR });
  }

  const pazartesi = haftaBasi(req.query.week);
  const sonrakiPazartesi = haftaSonrasi(pazartesi);

  try {
    auditLog(req, "VIEW_TEACHER_SCHEDULE", { userId, detay: { hafta: pazartesi } });

    /*
     * `.eq("teacher_id", userId)` ŞART — RLS'e bırakılamaz.
     * lessons'ta iki SELECT politikası var ve OR'lanıyorlar: "benim
     * derslerim (user_id)" VEYA "benim verdiğim dersler (teacher_id)".
     * Filtresiz bir sorgu, öğretmenin kendi ÖĞRENCİ kaydı varsa onu da
     * getirirdi. RLS hâlâ başkasının verisini vermiyor; filtre doğru soruyu
     * sormak için.
     */
    const { data: dersler, error: derslerHatasi } = await supabase
      .from("lessons")
      .select("id, user_id, subject, starts_at, ends_at, status, kind, is_trial, teacher_name")
      .eq("teacher_id", userId)
      .gte("starts_at", `${pazartesi}T00:00:00${TR_OFFSET}`)
      .lt("starts_at", `${sonrakiPazartesi}T00:00:00${TR_OFFSET}`)
      .order("starts_at", { ascending: true });

    if (derslerHatasi) {
      console.error("[Teacher] program sorgusu başarısız:", derslerHatasi.message);
      return res.status(502).json({ success: false, error: GENERIC_ERROR });
    }

    /*
     * ÖĞRENCİ ADLARI AYRI SORGUDA.
     * PostgREST'in gömme (embed) özelliği kullanılamıyor: lessons.user_id
     * auth.users'a bağlı, public.profiles'a değil — ilişki şemalar arası
     * olduğu için `select("..., profiles(full_name)")` çalışmaz.
     *
     * Bu ikinci sorgu RLS altında ve profiles_select_as_teacher politikası
     * sayesinde dönüyor: öğretmen bir profili ancak o öğrenciyle DERSİ VARSA
     * görebiliyor (bkz. supabase-teacher-panel.sql §4d). Yani buraya listeyi
     * genişletmek bir şey açmaz; politika neyi verdiğine kendisi karar veriyor.
     */
    const ogrenciIdleri = [...new Set((dersler ?? []).map((d) => d.user_id))];
    const dersIdleri = (dersler ?? []).map((d) => d.id);

    const adlar = new Map<string, string | null>();
    const yorumlar = new Map<string, { text: string; updatedAt: string }>();

    /*
     * YORUMLAR DA BU CEVAPTA DÖNÜYOR. Panelin ders listesi hem "işlendi mi"
     * hem "ne yazmıştım" sorularını aynı satırda gösteriyor; ayrı bir uçtan
     * çekilseydi aynı yorum iki yerde ayrı ayrı tutulur ve biri
     * güncellendiğinde öteki eskimiş kalırdı.
     *
     * İki yardımcı sorgu paralel; ders yoksa ikisi de hiç çalışmıyor.
     */
    const [profilSonuc, yorumSonuc] = await Promise.all([
      ogrenciIdleri.length
        ? supabase.from("profiles").select("id, full_name").in("id", ogrenciIdleri)
        : null,
      dersIdleri.length
        ? supabase.from("lesson_comments").select("lesson_id, comment, updated_at").in("lesson_id", dersIdleri)
        : null,
    ]);

    if (profilSonuc?.error) {
      /* Ad çözülemezse program yine de gösterilmeli: saat ve konu
         öğretmenin asıl ihtiyacı, ad olmadan da tablo işe yarar. */
      console.error("[Teacher] öğrenci adları okunamadı:", profilSonuc.error.message);
    }
    for (const p of profilSonuc?.data ?? []) adlar.set(p.id, p.full_name);

    if (yorumSonuc?.error) {
      console.error("[Teacher] yorumlar okunamadı:", yorumSonuc.error.message);
    }
    for (const y of yorumSonuc?.data ?? []) {
      yorumlar.set(y.lesson_id, { text: y.comment, updatedAt: y.updated_at });
    }

    return res.json({
      success: true,
      weekStart: pazartesi,
      lessons: (dersler ?? []).map((d) => ({
        id: d.id,
        subject: d.subject,
        startsAt: d.starts_at,
        endsAt: d.ends_at,
        status: d.status,
        kind: d.kind,
        isTrial: d.is_trial,
        studentId: d.user_id,
        studentName: adlar.get(d.user_id) ?? null,
        comment: yorumlar.get(d.id) ?? null,
      })),
    });
  } catch (err: any) {
    console.error("[Teacher] program istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: GENERIC_ERROR });
  }
});

/* =========================================================================
 * DERS YORUMLARI
 * =========================================================================
 * Ders başına TEK yorum. Kısıt veritabanında (lesson_comments.lesson_id
 * UNIQUE) ve yazma tek bir INSERT ... ON CONFLICT DO UPDATE ile yapılıyor —
 * DELETE + INSERT DEĞİL. Sebep: iki ayrı ifade arasında ikinci bir istek
 * araya girerse ya iki satır oluşur ya da yorum bir an yok olur. Tek ifade
 * atomiktir.
 */

const YORUM_MAKS = 2000;
const YORUM_ERROR = "Yorum kaydedilemedi. Lütfen tekrar deneyin.";
const DURUM_ERROR = "Ders durumu güncellenemedi. Lütfen tekrar deneyin.";

/*
 * Yol parametresi biçimi ÖNCE kontrol ediliyor: biçimsiz bir değerle sorgu
 * atmak Postgres'ten 22P02 aldırır ve 500'e dönerdi. Bu bir 400.
 */
const UUID_BICIMI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * "Bu ders senin değil" ile "böyle bir ders yok" AYNI cevabı veriyor.
 * Ayrıştırmak, elindeki kimlikleri tek tek deneyen birine hangi ders
 * kimliklerinin gerçek olduğunu söylerdi — girişteki "numara yok / şifre
 * yanlış" ayrımının kaldırılmasıyla aynı gerekçe.
 */
const DERS_YOK = "Ders bulunamadı veya bu derse erişiminiz yok.";

/**
 * DERSİ "İŞLENDİ" YAP / GERİ AL — PATCH /api/teacher/lessons/:lessonId/status
 *
 * Bu ucun var olma sebebi: yorum yalnızca tamamlanmış derse yazılabiliyor ve
 * bugüne kadar scheduled -> completed geçişini yapan hiçbir arayüz yoktu, yani
 * pratikte hiç yorum yazılamıyordu. Geçiş artık öğretmenin kendisinde.
 *
 * GERİ ALMAYA İZİN VAR: yanlış derse tıklamak kolay. Geri alınca yorum satırı
 * SİLİNMEZ — ders yeniden tamamlandı yapılınca metin olduğu gibi döner.
 * Öğrencinin yorum listesi status='completed' filtrelediği için, geri alınmış
 * bir dersin yorumu öğrenciye görünmez; bu istenen davranış.
 *
 * KORUMA KATMANLARI:
 *   1. Bu route  : dersin sahibi mi, hedef değer geçerli mi.
 *   2. RLS       : lessons_update_status_as_teacher — başkasının dersi ve
 *                  'cancelled' dersler hiç güncellenemez.
 *   3. Kolon yetkisi: authenticated'a YALNIZCA status kolonunda UPDATE
 *                  verildi. Route baştan aşağı hatalı olsa bile subject,
 *                  starts_at, user_id ya da teacher_id değiştirilemez.
 */
const GECERLI_DURUMLAR = new Set(["scheduled", "completed"]);

router.patch("/lessons/:lessonId/status", async (_req, res) => {
  const { accessToken, userId } = res.locals as unknown as SessionLocals;
  const { lessonId } = _req.params;
  const { status } = _req.body ?? {};

  if (!UUID_BICIMI.test(lessonId)) {
    return res.status(400).json({ success: false, error: DERS_YOK });
  }

  /* 'cancelled' BİLEREK kabul edilmiyor: dersi iptal etmek bir yönetim
     kararı (ücretlendirmeyi de ilgilendirir), öğretmenin işi değil. */
  if (typeof status !== "string" || !GECERLI_DURUMLAR.has(status)) {
    return res.status(400).json({ success: false, error: "Geçersiz ders durumu." });
  }

  const supabase = userClient(accessToken);
  if (!supabase) {
    return res.status(503).json({ success: false, error: DURUM_ERROR });
  }

  try {
    const { data: ders, error: dersHatasi } = await supabase
      .from("lessons")
      .select("id, teacher_id, status")
      .eq("id", lessonId)
      .maybeSingle();

    if (dersHatasi) {
      console.error("[Teacher] ders okunamadı:", dersHatasi.message);
      return res.status(502).json({ success: false, error: DURUM_ERROR });
    }

    /* IDOR kapısı — /comment ucundakiyle aynı gerekçe: ders null olabilir
       (RLS gizledi ya da yok) veya öğretmeni başkası olabilir; ikisi de 403
       ve AYNI mesaj, böylece hangi ders kimliklerinin gerçek olduğu
       dışarıdan yoklanamıyor. */
    if (!ders || ders.teacher_id !== userId) {
      return res.status(403).json({ success: false, error: DERS_YOK });
    }

    if (!GECERLI_DURUMLAR.has(ders.status)) {
      return res.status(400).json({
        success: false,
        error: "İptal edilmiş bir dersin durumu panelden değiştirilemez.",
      });
    }

    const { data: guncel, error: yazmaHatasi } = await supabase
      .from("lessons")
      .update({ status })
      .eq("id", lessonId)
      .select("id, status")
      .maybeSingle();

    if (yazmaHatasi) {
      console.error("[Teacher] ders durumu yazılamadı:", yazmaHatasi.message);
      return res.status(502).json({ success: false, error: DURUM_ERROR });
    }

    auditLog(_req, "LESSON_STATUS_CHANGED", {
      userId,
      detay: { dersId: lessonId, eski: ders.status, yeni: status },
    });

    return res.json({ success: true, status: guncel?.status ?? status });
  } catch (err: any) {
    console.error("[Teacher] ders durumu istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: DURUM_ERROR });
  }
});

/**
 * YORUM YAZ/GÜNCELLE — PUT /api/teacher/lessons/:lessonId/comment
 *
 * ÜÇ KATMANLI KORUMA, üçü de gerekli:
 *   1. Bu route: dersin teacher_id'si oturum sahibi mi (403), ders
 *      tamamlanmış mı (400). Kullanıcıya ANLAMLI hata döndürmek için.
 *   2. RLS: lesson_comments_insert/update_as_teacher politikaları aynı
 *      koşulu veritabanında da uyguluyor. Buradaki kod hatalı olsa bile
 *      satır yazılamaz.
 *   3. CHECK kısıtı: boş/2000'den uzun yorum veritabanında da reddediliyor.
 */
router.put("/lessons/:lessonId/comment", async (_req, res) => {
  const { accessToken, userId } = res.locals as unknown as SessionLocals;
  const { lessonId } = _req.params;
  const { comment } = _req.body ?? {};

  if (!UUID_BICIMI.test(lessonId)) {
    return res.status(400).json({ success: false, error: DERS_YOK });
  }

  if (typeof comment !== "string") {
    return res.status(400).json({ success: false, error: "Yorum metni gerekli." });
  }

  /* Kırpılmış hâli değerlendiriliyor: yalnızca boşluktan oluşan bir yorum
     boş yorumdur. Veritabanındaki CHECK de btrim ile aynı şeyi söylüyor. */
  const temiz = comment.trim();
  if (!temiz) {
    return res.status(400).json({ success: false, error: "Yorum boş olamaz." });
  }
  if (temiz.length > YORUM_MAKS) {
    return res
      .status(400)
      .json({ success: false, error: `Yorum en fazla ${YORUM_MAKS} karakter olabilir.` });
  }

  const supabase = userClient(accessToken);
  if (!supabase) {
    return res.status(503).json({ success: false, error: YORUM_ERROR });
  }

  try {
    /*
     * Dersin sahibi ve durumu okunuyor. RLS zaten başka öğretmenin dersini
     * döndürmüyor, ama "0 satır" ile "yanlış durum" ayrımını burada yapmak
     * gerekiyor — kullanıcıya ne olduğunu söyleyebilmek için.
     */
    const { data: ders, error: dersHatasi } = await supabase
      .from("lessons")
      .select("id, teacher_id, status")
      .eq("id", lessonId)
      .maybeSingle();

    if (dersHatasi) {
      console.error("[Teacher] ders okunamadı:", dersHatasi.message);
      return res.status(502).json({ success: false, error: YORUM_ERROR });
    }

    /*
     * IDOR KAPISI. ders null olabilir (RLS gizledi ya da yok) veya
     * öğretmeni başkası olabilir — ikisi de 403 ve AYNI mesaj.
     *
     * `ders.teacher_id !== userId` kontrolü, RLS yüzünden teorik olarak
     * ulaşılamaz görünüyor ama YİNE DE VAR: öğretmen kendi ÖĞRENCİ olduğu
     * bir dersi lessons_select_own ile görebilir. O ders ona gelir ama
     * teacher_id'si kendisi değildir — bu satır tam olarak onu eliyor.
     */
    if (!ders || ders.teacher_id !== userId) {
      return res.status(403).json({ success: false, error: DERS_YOK });
    }

    if (ders.status !== "completed") {
      return res.status(400).json({
        success: false,
        error: "Yorum yalnızca tamamlanmış derslere eklenebilir.",
      });
    }

    /*
     * TEK ATOMİK İFADE: INSERT ... ON CONFLICT (lesson_id) DO UPDATE.
     * onConflict lesson_id üzerindeki UNIQUE kısıtını hedefliyor; kısıt
     * olmasaydı Postgres 42P10 verirdi (leads tablosunda bunun canlı örneği
     * yaşandı, bkz. CLAUDE.md).
     *
     * updated_at elle set EDİLMİYOR: lesson_comments_touch_updated_at
     * tetikleyicisi ON CONFLICT DO UPDATE yolunda da çalışıyor. Elle yazmak
     * iki ayrı doğruluk kaynağı yaratırdı.
     */
    const { data: yazilan, error: yazmaHatasi } = await supabase
      .from("lesson_comments")
      .upsert({ lesson_id: lessonId, teacher_id: userId, comment: temiz }, { onConflict: "lesson_id" })
      .select("comment, updated_at")
      .maybeSingle();

    if (yazmaHatasi) {
      console.error("[Teacher] yorum yazılamadı:", yazmaHatasi.message);
      return res.status(502).json({ success: false, error: YORUM_ERROR });
    }

    return res.json({
      success: true,
      comment: yazilan ? { text: yazilan.comment, updatedAt: yazilan.updated_at } : null,
    });
  } catch (err: any) {
    console.error("[Teacher] yorum istisnası:", err?.message || err);
    return res.status(500).json({ success: false, error: YORUM_ERROR });
  }
});

export default router;
