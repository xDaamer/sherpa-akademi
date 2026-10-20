import type { Request } from "express";
import { serviceClient } from "./supabase.js";

/*
 * DENETİM KAYDI
 * ============================================================================
 * "Kim, ne zaman, nereden, hangi işlemi yaptı." Tablo tanımı ve gerekçesi
 * supabase-audit-log.sql'de — o dosyayı Supabase SQL Editor'de bir kez
 * çalıştırmadan buradaki yazmalar sessizce başarısız olur (ve olmalıdır:
 * log yazamamak isteği bozmamalı).
 *
 * NEDEN winston/dosya DEĞİL: Vercel'de serverless fonksiyonun dosya sistemi
 * geçici ve her örnek ayrı. Diske yazılan bir audit.log, isteği karşılayan
 * örnekle birlikte kaybolur. Kalıcı tek yer zaten kullandığımız Postgres.
 *
 * SERVİS ROLÜ İLE YAZILIR — bilerek: kullanıcının kendi jetonuyla yazılsaydı,
 * kullanıcının kendi denetim kaydına yazma (dolayısıyla RLS'i esnetince
 * okuma/silme) yetkisi olurdu. Denetim kaydının değeri, konusu olan kişinin
 * ona dokunamamasıdır.
 *
 * HASSAS VERİ YAZILMAZ: şifre, jeton, çerez, ödeme detayı. Bkz. SQL dosyası.
 */

/*
 * BAŞARISIZ GİRİŞ BURAYA YAZILMAZ — zaten public.auth_attempts'te.
 * ---------------------------------------------------------------------------
 * Her giriş denemesi (başarılı/başarısız) IP, telefon ve sonuçla birlikte
 * oraya kaydediliyor (bkz. server/security.ts: recordAttempt +
 * markAttemptResult). Aynı olayı ikinci bir tabloya da yazmak, her başarısız
 * denemede fazladan bir yazma ve iki ayrı yerde tutulan iki ayrı "gerçek"
 * demek olurdu. "Şu numaraya kaç kez yanlış şifreyle girilmeye çalışıldı"
 * sorusu auth_attempts'e sorulur.
 *
 * Buradaki olaylar auth_attempts'in CEVAPLAYAMADIKLARI: hangi KULLANICI
 * (user_id) oturum açtı/kapattı ve kendi verisini ne zaman görüntüledi.
 */
export type AuditAction =
  | "LOGIN_SUCCESS"
  | "LOGOUT"
  | "VIEW_PORTAL_SUMMARY"
  /* Öğretmen paneli. VIEW_TEACHER_SCHEDULE, VIEW_PORTAL_SUMMARY'nin
     karşılığı: öğretmenin verisine baktığı tek uç orası.
     FORBIDDEN_ROLE ise farklı bir soruyu cevaplıyor — "kim, kendi rolüne
     ait olmayan bir ucu yokladı" (bkz. server/roles.ts). */
  | "VIEW_TEACHER_SCHEDULE"
  /* Dersi "işlendi" yapmak/geri almak bir VERİ DEĞİŞİKLİĞİ ve öğrencinin
     gördüğü şeyi etkiliyor (yorumlar yalnızca tamamlanmış derslerde görünür).
     Görüntüleme olaylarından farklı olarak bunun geriye dönük cevabı
     başka hiçbir yerde yok — lessons.status yalnızca son hâli tutuyor. */
  | "LESSON_STATUS_CHANGED"
  /* Öğretmen sözleşmesini onaylamak. Asıl kanıt teacher_contract_acceptances
     satırı (IP, zaman, onaylanan belge kimlikleri); bu kayıt olayı diğer
     panel olaylarının yanında, aynı zaman çizelgesinde gösteriyor. Detayda
     yalnızca onaylanan SÜRÜM numaraları var, metin değil. */
  | "TEACHER_CONTRACT_ACCEPTED"
  /* TEACHER_LESSON_CREATED 2026-09-24 ile 2026-10-09 arasında yazıldı
     (öğretmenin kendi dersini açması); yetki kaldırıldı, bu tip artık
     üretilmiyor. audit_log'da o döneme ait satırlar kalabilir. */
  /* Yönetim paneli. Bu olaylar diğerlerinden DAHA ÖNEMLİ: /api/admin/*
     servis rolüyle çalışıyor, yani RLS emniyet ağı orada yok ve yapılan
     işin geriye dönük tek kaydı burası (bkz. server/routes/admin.ts).
     Detaya asla şifre ya da ödeme tutarı yazılmaz. */
  | "ADMIN_ACCOUNT_CREATED"
  | "ADMIN_ACCOUNT_UPDATED"
  | "ADMIN_PASSWORD_RESET"
  /* Hesap silme (30 gün geri getirilebilir), geri getirme ve 30 gün sonraki
     kalıcı silme. Detayda hesap kimliği ve rol var; telefon YOK. */
  | "ADMIN_ACCOUNT_DELETED"
  | "ADMIN_ACCOUNT_RESTORED"
  | "ADMIN_ACCOUNT_PURGED"
  | "ADMIN_LESSON_WRITE"
  | "ADMIN_LESSON_DELETED"
  /* Öğretmenin müsait saatlerini değiştirmek. Detaya yalnızca aralık SAYISI
     yazılıyor; saatlerin kendisi tabloda zaten var, kayıt kopyası değil. */
  | "ADMIN_AVAILABILITY_WRITE"
  /* Öğretmen açıklamasını yazmak ya da kaldırmak. Detaya metnin kendisi
     DEĞİL, yalnızca uzunluğu yazılıyor (0 = kaldırıldı). */
  | "ADMIN_TEACHER_DESCRIPTION_WRITE"
  | "ADMIN_PAYMENT_WRITE"
  | "ADMIN_PAYMENT_DELETED"
  /* Başvuru listesine bakmak. Diğer yönetim okumaları kayda girmiyor;
     bu giriyor çünkü veri hesabı olmayan kişilere ait (formu dolduranın
     telefonu, çocuğun adı) ve onlar bu panelin varlığından habersiz. */
  | "ADMIN_LEADS_VIEWED"
  /* Başvurunun takibi: "arandı" işareti, "Deneme dersi alındı" / "Takip
     gerekli" etiketleri ya da not. Detayda yalnızca değişen işaretlerin yeni
     hâli ve notun UZUNLUĞU (0 = kaldırıldı); notun metni kişisel veri
     içerebilir. */
  | "ADMIN_LEAD_FOLLOWUP_WRITE"
  | "FORBIDDEN_ROLE";

function clientIp(req: Request): string {
  /* server.ts'te app.set("trust proxy", 1) var; req.ip X-Forwarded-For'u yansıtır. */
  return req.ip || "unknown";
}

/**
 * Olayı kaydeder. BEKLENMEZ (fire-and-forget) — çağıran taraf `void` ile
 * çağırır: denetim kaydı yazmak kullanıcıyı bekletmemeli ve yazılamaması
 * isteği başarısız etmemeli. Hatalar yalnızca sunucu log'una düşer.
 */
export function auditLog(
  req: Request,
  action: AuditAction,
  options: { userId?: string | null; detay?: Record<string, unknown> } = {},
): void {
  const supabase = serviceClient();
  if (!supabase) return;

  const row = {
    user_id: options.userId ?? null,
    action,
    ip: clientIp(req),
    /* Hangi alan adından geldiği: akademitu.com mı portal.akademitu.com mı.
       İki host'lu kurulumda "giriş nereden yapıldı" sorusunun tek cevabı. */
    host: (req.get("host") || "").split(":")[0].toLowerCase() || null,
    detay: options.detay ?? null,
  };

  void (async () => {
    try {
      const { error } = await supabase.from("audit_log").insert(row);
      if (error) {
        console.error("[Audit] kayıt yazılamadı:", error.message, action);
        return;
      }
      void pruneAuditLog();
    } catch (err: any) {
      console.error("[Audit] kayıt istisnası:", err?.message || err, action);
    }
  })();
}

/*
 * FIRSATÇI TEMİZLİK — auth_attempts'teki desenin aynısı ve aynı gerekçeyle:
 * pg_cron bu projede kurulu değil, o yüzden zamanlanmış bir iş yerine
 * yazmaların küçük bir kısmında temizlik tetikleniyor.
 *
 * Olasılık %2 değil %0,5: denetim kaydı auth_attempts'ten daha sık yazılıyor
 * (her panel açılışı bir satır) ve saklama süresi 6 kat uzun, yani temizliğin
 * bu kadar sık koşmasına gerek yok.
 */
async function pruneAuditLog(): Promise<void> {
  if (Math.random() >= 0.005) return;

  const supabase = serviceClient();
  if (!supabase) return;

  try {
    /* Silme kuralının tek tanımı SQL tarafında (prune_audit_log); süre iki
       yerde ayrı ayrı yazılırsa biri güncellenip diğeri unutulur. */
    const { error } = await supabase.rpc("prune_audit_log");
    if (error) console.error("[Audit] eski kayıtlar temizlenemedi:", error.message);
  } catch (err: any) {
    console.error("[Audit] temizlik istisnası:", err?.message || err);
  }
}
