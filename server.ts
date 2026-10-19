import express from "express";
import path from "path";
import { readFileSync } from "fs";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
/*
 * `.js` uzantısı ZORUNLU (bkz. api/[...path].ts'teki uzun açıklama): proje
 * "type": "module" ve Node'un ESM çözümleyicisi uzantı tahmin etmez.
 * tsconfig "moduleResolution": "bundler" olduğu için tsc bunu YAKALAMAZ —
 * eksik uzantı ancak canlıda cold start'ta patlar. Disiplin elle.
 *
 * Bu modüllerin hiçbiri `vite` import etmez; etseydi Vercel'in izleyicisi
 * onu fonksiyon paketine çeker ve fonksiyonu çökertirdi.
 */
import authRouter from "./server/routes/auth.js";
import portalRouter from "./server/routes/portal.js";
import teacherRouter from "./server/routes/teacher.js";
import adminRouter from "./server/routes/admin.js";
import metaWebhookRouter, { metaGovdeAyristirici } from "./server/routes/metaWebhook.js";
import metaSheetsRouter from "./server/routes/metaSheets.js";
import { serviceClient, describeConfiguration } from "./server/supabase.js";
import { requireTrustedOrigin, isRateLimited, recordAttempt } from "./server/security.js";

// Plain readFileSync+JSON.parse instead of `import ... with { type: "json" }` or
// createRequire(import.meta.url): both rely on syntax/semantics that can break
// depending on whether Vercel's Node function runtime bundles this as ESM or CJS.
// readFileSync + process.cwd() has no module-system-specific syntax at all, so it
// behaves identically under tsx (dev), esbuild (npm start), and Vercel.
//
// Wrapped in try/catch: this runs at module load (cold start). If it throws
// unguarded, the whole function fails to load and EVERY route 500s
// (FUNCTION_INVOCATION_FAILED) — including ones that never touch `need` —
// which is exactly the failure mode this deployment kept hitting. Falling
// back to a minimal shape keeps the function alive even if the file can't
// be read, so at least the actual error is diagnosable from server logs
// instead of a blanket crash.
//
// VERCEL NOTU: bu okuma bir ÇALIŞMA ANI yol ifadesidir. Vercel'in dosya
// izleyicisi (nft) yalnızca statik import'ları takip eder, `process.cwd()` ile
// kurulan bir yolu göremez — dolayısıyla need.json'ı fonksiyon paketine
// kendiliğinden koymaz ve aşağıdaki catch'e düşülür (/api/config boş döner).
// Bu yüzden vercel.json'da açıkça bildiriliyor:
//     "functions": { "api/**": { "includeFiles": "need.json" } }
// O satır silinirse burası sessizce boş nesneye düşer.
let need: any = { site: {}, contact: {}, social: {}, seo: { pages: [] } };
try {
  need = JSON.parse(readFileSync(path.join(process.cwd(), "need.json"), "utf-8"));
} catch (err: any) {
  console.error("[Server API] Failed to read need.json:", err?.message || err);
}

// quiet: true suppresses dotenv's own startup log line (including its random
// promotional "tip" messages) so it never buries the Supabase error logs below.
dotenv.config({ quiet: true });

const app = express();
const PORT = 3000;

app.set("trust proxy", 1);
app.disable("x-powered-by");
/*
 * /api/meta/*'nin kendi ayrıştırıcısı genelinden ÖNCE gelmeli: ham gövdeyi
 * (webhook imzası için) o tutuyor ve sınırı daha geniş (Google Sheets
 * aktarımı yüzlerce satırı tek istekte yolluyor). Genel express.json, gövdesi
 * zaten ayrıştırılmış isteği atlıyor. Bkz. server/routes/metaWebhook.ts.
 */
app.use("/api/meta", metaGovdeAyristirici);
app.use(express.json({ limit: "16kb" }));
/* Oturum jetonları httpOnly çerezde taşınıyor (bkz. server/cookies.ts). */
app.use(cookieParser());

const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");

  /*
   * Bu kontrol yalnızca `Origin` VARSA bakar, yoksa geçirir — dolayısıyla
   * tek başına CSRF koruması DEĞİLDİR. Gerçek koruma requireTrustedOrigin()
   * (server/security.ts): durum değiştiren isteklerde Origin ZORUNLU ve o,
   * hem /api/auth hem /api/leads uçlarına ayrıca uygulanıyor.
   * Buradaki hâli, tanımlı bir liste varken yanlış kaynaktan gelen istekleri
   * erkenden elemek için korunuyor.
   */
  const origin = req.get("origin");
  if (origin && allowedOrigins.size > 0 && !allowedOrigins.has(origin)) {
    return res.status(403).json({ success: false, error: "Geçersiz istek kaynağı." });
  }

  next();
});

/*
 * Lead hız limiti artık Postgres tabanlı (server/security.ts).
 * Buradaki bellek içi Map kaldırıldı: Vercel'de her serverless örneği kendi
 * belleğine sahip olduğu için sayaç saldırgan yeni bir örneğe düştüğü an
 * sıfırlanıyordu — yani pratikte hiçbir şeyi sınırlamıyordu. Üstelik Map hiç
 * budanmadığı için uzun ömürlü `npm start` sürecinde sızıntı yapıyordu.
 */
async function limitLeadRequests(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (await isRateLimited(req, res, "lead")) return;
  await recordAttempt(req, "lead");
  next();
}

function isValidTurkishMobile(value: string) {
  return /^0?5\d{9}$/.test(value.replace(/\D/g, ""));
}

const LEAD_GENERIC_ERROR =
  "Form gönderilirken bir sorun oluştu. Lütfen tekrar deneyin ya da bizi WhatsApp üzerinden arayın.";

/*
 * Lead route'ları eskiden HATA DURUMUNDA DA `success: true` dönüyordu (hatalar
 * yalnızca log'a gidiyordu). O davranış, istemci doğrudan Supabase'e giderken
 * fark etmiyordu; artık form buradan geçtiği için düşen bir başvuruda kullanıcı
 * "kaydedildi" görürdü — sessiz veri kaybı. Artık hata gerçekten hata dönüyor.
 *
 * Ham Postgres/PostgREST mesajı kullanıcıya GÖSTERİLMEZ (şema ve kısıt adlarını
 * sızdırır, üstelik İngilizcedir). Tek istisna P0001: bu, hız limiti
 * trigger'ımızın RAISE EXCEPTION ile ürettiği, kullanıcıya gösterilmek üzere
 * Türkçe yazılmış kendi metnimiz. (İstemci tarafındaki friendlyErrorMessage ile
 * aynı kural.)
 */
function friendlyLeadError(error: { code?: string; message?: string } | null | undefined): string {
  if (error?.code === "P0001" && error.message) return error.message;
  return LEAD_GENERIC_ERROR;
}

/*
 * Servis rolü istemcisi — RLS'i baypas eder.
 * Fabrika artık server/supabase.ts'te; oradaki yorum hangi istemcinin ne
 * zaman kullanılacağını anlatıyor. Buradaki `supabase` yalnızca KULLANICIYA
 * AİT OLMAYAN işler için: lead kaydı (henüz kimse giriş yapmamış) ve
 * yayınlanmış yorumların okunması. Giriş yapmış kullanıcının verisine bununla
 * dokunulmaz — o iş userClient(accessToken) ile yapılır.
 *
 * VITE_SUPABASE_URL yedeği kaldırıldı: o değişkenler artık hiç tanımlı değil
 * (Faz 2'nin amacı zaten anahtarları tarayıcı bundle'ından çıkarmaktı).
 */
const supabase = serviceClient();

if (!supabase) {
  console.warn(
    "[Server API] Supabase not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY). " +
    "Leads will only be logged/stored locally and /api/testimonials will return an empty list.",
  );
}

if (!describeConfiguration().anonKey) {
  console.warn(
    "[Server API] SUPABASE_ANON_KEY tanımlı değil — /api/auth/* çalışmayacak. " +
    "Bu anahtar artık SUNUCU tarafında yaşıyor (eskiden VITE_SUPABASE_ANON_KEY idi).",
  );
}

/*
 * Kimlik doğrulama uçları. requireTrustedOrigin durum değiştiren isteklerde
 * Origin başlığını ZORUNLU kılıyor; tarayıcılar POST'ta bunu her zaman
 * gönderdiği için başlıksız bir istek tarayıcıdan gelmiyor demektir.
 */
app.use("/api/auth", requireTrustedOrigin, authRouter);

/*
 * Panel verisi. requireTrustedOrigin burada da var ama asıl koruma modülün
 * kendisinde: her sorgu kullanıcının kendi jetonuyla, RLS altında çalışıyor.
 */
app.use("/api/portal", requireTrustedOrigin, portalRouter);

/*
 * Öğretmen paneli verisi. Aynı desen: requireTrustedOrigin burada da var ama
 * asıl koruma modülün kendisinde — önce rol kapısı (öğrenci gelirse 403),
 * sonra RLS (öğretmen yalnızca teacher_id'si kendisi olan dersleri görür).
 */
app.use("/api/teacher", requireTrustedOrigin, teacherRouter);

/*
 * Yönetim paneli. Diğer iki panelden FARKLI bir yetki modeli: bu modül
 * servis rolüyle çalışıyor (hesap açmanın başka yolu yok) ve dolayısıyla
 * RLS emniyet ağı devrede DEĞİL — sınırın tamamı requireUserType("admin").
 * Gerekçesi server/routes/admin.ts'in başında.
 */
app.use("/api/admin", requireTrustedOrigin, adminRouter);

/*
 * Meta reklam formu başvuruları. requireTrustedOrigin BİLEREK YOK: çağıranlar
 * tarayıcı değil (Google'ın Apps Script sunucusu / Meta'nın sunucusu), Origin
 * göndermiyorlar. Koruma: /sheets'te gizli anahtar, /webhook'ta imza — bkz.
 * modüllerin başı. Canlıda kullanılan /sheets.
 */
app.use("/api/meta", metaSheetsRouter);
app.use("/api/meta", metaWebhookRouter);

// API Routes
app.get("/api/health", (_req, res) => {
  /*
   * Buradaki `env` teşhisi (hangi değişken adı tanımlı) dağıtım sırasında
   * "değişkenleri girdim ama çalışmıyor" sorununu ölçerek çözmek için geçiciydi
   * ve iş bitince kaldırıldı: altyapı yapılandırmasını dışarıya anlatmanın
   * kalıcı bir sebebi yok.
   */
  res.json({ status: "ok", supabaseConfigured: !!supabase });
});

/*
 * SEO: /sitemap.xml ve /robots.txt BU DOSYADAN SERVİS EDİLMEZ.
 * -------------------------------------------------------------------------
 * İkisini de `scripts/generate-seo.ts` build öncesi `public/` altına yazar
 * ve statik dosya olarak sunulurlar. Buradaki Express route'ları aynı işi
 * ikinci kez yapıyordu; üstelik Vercel'de bu fonksiyon çalışmadığı için
 * (bkz. CLAUDE.md) hiçbir zaman devreye girmiyorlardı. Dev'de ise statik
 * dosyaları gölgeleyip prod'dan farklı çıktı üretiyorlardı.
 *
 * Tek kaynak: need.json -> scripts/generate-seo.ts -> public/
 */

// API endpoint to get site config (for frontend)
app.get("/api/config", (_req, res) => {
  res.json({
    site: need.site,
    contact: need.contact,
    social: need.social
  });
});

// Public testimonials list (server-mediated: browser never talks to Supabase directly)
app.get("/api/testimonials", async (_req, res) => {
  if (!supabase) {
    return res.json({ success: true, testimonials: [] });
  }

  try {
    const { data, error } = await supabase
      .from("testimonials")
      .select("id, student_name, student_grade, content, rating")
      .eq("is_published", true)
      .order("display_order", { ascending: true });

    if (error) {
      console.warn("[Server API] Supabase Testimonials Notice:", error.message);
      return res.json({ success: true, testimonials: [] });
    }

    return res.json({ success: true, testimonials: data ?? [] });
  } catch (err: any) {
    console.error("[Server API] Supabase Exception Testimonials:", err?.message || err);
    return res.json({ success: true, testimonials: [] });
  }
});

// Step 1: Lead Submission (Name & Phone)
app.post("/api/leads", requireTrustedOrigin, limitLeadRequests, async (req, res) => {
  const { fullName, phone, examType, website } = req.body;

  if (website || typeof fullName !== "string" || typeof phone !== "string" || !fullName.trim() || !isValidTurkishMobile(phone)) {
    return res.status(400).json({ success: false, error: "Ad soyad ve telefon zorunludur." });
  }

  const payload = {
    full_name: String(fullName).trim(),
    phone: String(phone).trim(),
    exam_type: examType ? String(examType).trim() : "YKS",
    step: 1,
    created_at: new Date().toISOString(),
  };

  /*
   * Yapılandırma eksikse SESSİZCE BAŞARILI DÖNÜLMEZ. Eskiden dönülüyordu ve
   * sonuç şuydu: kullanıcı "kaydedildi" görüyor, başvuru yalnızca kendi
   * tarayıcısındaki localStorage'da kalıyor ve kimse oraya bakmıyor — yani
   * sessiz veri kaybı. Yanlış yapılandırılmış bir dağıtım gürültü çıkarmalı.
   */
  if (!supabase) {
    console.error("[Server API] Lead Step 1 reddedildi: Supabase yapılandırılmamış.", payload);
    return res.status(503).json({ success: false, error: LEAD_GENERIC_ERROR });
  }

  try {
    const { data, error } = await supabase
      .from("leads")
      .insert([payload])
      .select("id")
      .single();

    if (error) {
      // Full detail (message/code/details/hint) so a misconfigured service-role
      // key, schema mismatch, or RLS issue is diagnosable from Vercel/server logs.
      console.error("[Server API] Supabase Step 1 INSERT failed:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        payload,
      });
      return res.status(502).json({ success: false, error: friendlyLeadError(error) });
    }

    return res.json({ success: true, id: data?.id });
  } catch (err: any) {
    console.error("[Server API] Supabase Exception Step 1:", err?.message || err, { payload });
    return res.status(502).json({ success: false, error: LEAD_GENERIC_ERROR });
  }
});

const ALLOWED_EXAM_TYPES = new Set(["YKS", "LGS", "Diğer"]);

// Step 2: Lead Details Update
app.post("/api/leads/step2", requireTrustedOrigin, limitLeadRequests, async (req, res) => {
  const {
    leadId,
    phone,
    fullName,
    examType,
    studentFullName,
    parentFullName,
    userRole,
    gradeClass,
    selectedSubjects,
    website,
  } = req.body;

  if (website || typeof phone !== "string" || typeof studentFullName !== "string" || !studentFullName.trim() || !isValidTurkishMobile(phone)) {
    return res.status(400).json({ success: false, error: "Telefon ve öğrenci adı zorunludur." });
  }

  const payload = {
    phone: String(phone).trim(),
    student_full_name: String(studentFullName).trim(),
    parent_full_name: parentFullName ? String(parentFullName).trim() : "",
    user_role: userRole || "Öğrenci",
    grade_class: gradeClass || "",
    selected_subjects: Array.isArray(selectedSubjects) ? selectedSubjects : [],
    step: 2,
    updated_at: new Date().toISOString(),
  };

  if (!supabase) {
    console.error("[Server API] Lead Step 2 reddedildi: Supabase yapılandırılmamış.", payload);
    return res.status(503).json({ success: false, error: LEAD_GENERIC_ERROR });
  }

  try {
    let error;
    if (leadId && !String(leadId).startsWith("lead_") && !String(leadId).startsWith("srv_")) {
      // Step 1's insert gave us a real row id - update it directly.
      /*
       * exam_type BU DALDA DA yazılmalı. Mobildeki kısa ilk adım yalnızca ad ve
       * telefon soruyor, hedef sınav ikinci adımda geliyor — burada atlanırsa
       * step 1'in varsayılanı olan "YKS" kalıcı oluyor ve LGS'ye hazırlanan
       * öğrenciler yanlış etiketle kaydediliyor.
       *
       * Bu dal eskiden hiç çalışmıyordu: saveLeadStep1 gerçek satır id'sini
       * değil localStorage yedek id'sini ("lead_...") döndürdüğü için adım 2
       * her zaman aşağıdaki RPC dalına düşüyordu ve exam_type'ı orası yazıyordu.
       * Sunucu artık gerçek id döndürdüğü için bu dal devreye girdi ve eksiklik
       * ortaya çıktı (canlı test sırasında yakalandı).
       */
      const updatePayload: Record<string, unknown> = { ...payload };
      if (examType && ALLOWED_EXAM_TYPES.has(String(examType))) {
        updatePayload.exam_type = String(examType);
      }

      const resUpdate = await supabase
        .from("leads")
        .update(updatePayload)
        .eq("id", leadId);
      error = resUpdate.error;
    } else {
      /*
       * Adım 1 ya hiç çalışmadı (leadId yok) ya da insert'i başarısız oldu ve
       * elimizde yalnızca sahte bir yedek id var ("srv_"/"lead_" önekli).
       *
       * BURASI ESKİDEN `upsert(..., { onConflict: "phone" })` İDİ VE ÇALIŞMIYORDU:
       * yorumu "phone UNIQUE" diyordu ama supabase-anon-lead-insert.sql o kısıtı
       * (leads_phone_key) düşürdü — aynı numarayla tekrar başvuruya izin vermek
       * için. Eşleşen unique kısıt olmadığında Postgres 42P10 veriyor ("there is
       * no unique or exclusion constraint matching the ON CONFLICT
       * specification"), hata da yutulduğu için adım 2 sessizce kayboluyordu.
       *
       * Doğrusu istemcinin kullandığı RPC'yi çağırmak: update_lead_step2 bu
       * telefonun EN SON step=1 satırını hedefliyor, yani "hangi satır" sorusunu
       * unique kısıta ihtiyaç duymadan doğru cevaplıyor. Servis rolü bu
       * fonksiyonu anon GRANT'ından bağımsız olarak çalıştırabilir.
       */
      const resRpc = await supabase.rpc("update_lead_step2", {
        p_phone: payload.phone,
        p_student_full_name: payload.student_full_name,
        p_parent_full_name: payload.parent_full_name,
        p_user_role: payload.user_role,
        p_grade_class: payload.grade_class,
        p_selected_subjects: payload.selected_subjects,
        p_website: "",
        p_exam_type:
          examType && ALLOWED_EXAM_TYPES.has(String(examType)) ? String(examType) : null,
      });
      error = resRpc.error;

      /*
       * RPC yalnızca step=1 satırını günceller; öyle bir satır yoksa sessizce
       * çıkar. Adım 1 hiç ulaşmamışsa başvuru tamamen kaybolmasın diye burada
       * yeni bir satır açılıyor (fullName de bu yüzden taşınıyor).
       */
      if (!error) {
        const tamamlananlar = () =>
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("phone", payload.phone)
            .eq("step", 2);
        /* Meta başvuruları da step = 2 yazılıyor (supabase-meta-leads.sql);
           aynı numaranın Meta satırı sitedeki başvuruyu yutmasın diye yalnızca
           site satırları sayılıyor. Filtreli sayım HERHANGİ bir hatayla
           düşerse (ör. migration henüz çalıştırılmamış, `source` yok) eski
           filtresiz sayıma dönülüyor: yoksa count null kalır ve her ikinci
           adımda MÜKERRER satır açılırdı. Hata koduna bakılamıyor: bu bir HEAD
           isteği, gövdesi yok ve supabase-js hatayı kodsuz döndürüyor. */
        let { count, error: sayimHatasi } = await tamamlananlar().eq("source", "website");
        if (sayimHatasi) ({ count } = await tamamlananlar());

        if ((count ?? 0) === 0) {
          const insertPayload: Record<string, unknown> = { ...payload };
          if (fullName) insertPayload.full_name = String(fullName).trim();
          if (examType && ALLOWED_EXAM_TYPES.has(String(examType))) {
            insertPayload.exam_type = String(examType);
          }
          const resInsert = await supabase.from("leads").insert(insertPayload);
          error = resInsert.error;
        }
      }
    }

    if (error) {
      console.error("[Server API] Supabase Step 2 write failed:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        leadId,
        payload,
      });
      return res.status(502).json({ success: false, error: friendlyLeadError(error) });
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error("[Server API] Supabase Exception Step 2:", err?.message || err, { leadId, payload });
    return res.status(502).json({ success: false, error: LEAD_GENERIC_ERROR });
  }
});

function startProductionServer() {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

// On Vercel, this file is imported by api/[...path].ts as a serverless
// function handler — it must never bind a port or serve dist/ from local
// disk there (Vercel serves the static build and routes /api/* to the
// function separately).
//
// Local dev (`npm run dev`) does NOT run this file directly — it runs
// dev-server.ts instead, which imports `app` from here and adds Vite's
// middleware itself. That split matters: this file must never reference
// `vite` in any way (static or dynamic import), because Vercel's function
// bundler traces every import reachable from this file — including dynamic
// ones — to decide what to include in the deployed function. Pulling in
// `vite` (a large dev-only tool) that way was confirmed to break the
// function at runtime (every /api/* request failed with
// FUNCTION_INVOCATION_FAILED, even simple GETs, i.e. a cold-start crash).
//
// `npm start` (production, `node server-dist/server.cjs`) does run this
// file directly, hence the production-only branch below.
if (!process.env.VERCEL && process.env.NODE_ENV === "production") {
  startProductionServer();
}

export default app;
