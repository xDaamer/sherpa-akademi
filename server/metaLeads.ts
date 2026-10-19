import { serviceClient } from "./supabase.js";

/*
 * META BAŞVURUSU -> public.leads SATIRI
 * ============================================================================
 * Meta (Facebook/Instagram) reklam formu başvuruları iki kapıdan gelebiliyor;
 * ikisi de buradaki eşlemeyi ve yazmayı kullanıyor ki aynı başvuru hangi
 * kapıdan gelirse gelsin aynı satıra dönüşsün:
 *
 *   - server/routes/metaSheets.ts   Meta'nın kendi Google Sheets bağlantısı +
 *                                   tablodaki Apps Script (CANLIDA KULLANILAN).
 *   - server/routes/metaWebhook.ts  Kendi Meta uygulamasıyla webhook + Graph
 *                                   API. Kurulumu zor bulundu, ortam
 *                                   değişkenleri tanımlı değilse 503 döner.
 *
 * Şema: supabase-meta-leads.sql. meta_lead_id UNIQUE ve yazma ON CONFLICT DO
 * NOTHING: aynı başvuru iki kez (ya da iki kapıdan) gelse de tek satır.
 */

export interface MetaAlan {
  name: string;
  values: string[];
}

/** Yeniden denemenin sonucu değiştirmeyeceği durum (ör. telefonsuz form). */
export class KaliciHata extends Error {}

/** Panel "bağlantı kurulmamış" uyarısını bu ikisinden HİÇBİRİ yoksa gösterir. */
export function metaYapilandirildi(): boolean {
  const webhook = Boolean(
    process.env.META_APP_SECRET && process.env.META_VERIFY_TOKEN && process.env.META_PAGE_ACCESS_TOKEN,
  );
  return webhook || Boolean(process.env.META_SHEETS_KEY);
}

/**
 * "+90 532 123 45 67", "p:+905321234567" (Meta'nın dışa aktarım biçimi),
 * "905321234567" -> "05321234567". Türk cep numarası değilse olduğu gibi.
 */
export function telefonNormalize(ham: string): string {
  const rakam = ham.replace(/\D/g, "");
  const m = rakam.match(/^(?:90|0)?(5\d{9})$/);
  return m ? `0${m[1]}` : ham.replace(/^p:/i, "").trim();
}

/**
 * Meta dışa aktarımlarında kimlikler türüne göre önekli geliyor ("l:123",
 * "f:456", "ag:789"). Önek atılıyor ki webhook'tan gelen "123" ile tablodan
 * gelen "l:123" AYNI başvuru olarak tanınsın.
 */
export function kimlikSade(ham: string): string {
  return ham.trim().replace(/^[a-z]{1,3}:/i, "");
}

/** Türkçe karakter ve büyük/küçük harf farkını yok sayan anahtar. */
function sade(s: string): string {
  return s
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .trim();
}

/*
 * Meta'nın standart alanları sabit adlı (full_name, phone_number...). Özel
 * sorularınki ise formu kuranın yazdığı metinden türüyor; Google Sheets'te
 * başlık bazen insan okur hâlinde ("Ad soyad", "Telefon numarası"). O yüzden
 * önce tam ad, sonra adın İÇİNDE geçen kelimeye bakılıyor. Eşleşmeyen hiçbir
 * şey kaybolmuyor: meta_fields hepsini tutuyor ve panel onları ayrıca gösteriyor.
 */
export function alanlariEsle(alanlar: MetaAlan[]) {
  const deger = (a: MetaAlan) => (a.values ?? []).join(", ").trim();
  const bul = (test: (ad: string) => boolean) => {
    const a = alanlar.find((x) => test(sade(x.name)));
    return a ? deger(a) || null : null;
  };

  /* "öğrencinin sınıfı", "veli telefonu" gibi sorular kişi adı değil. */
  const adDegil = (a: string) => /sinif|grade|telefon|phone|okul|school|sinav|exam/.test(a);
  const baskasininAdi = (a: string) => /ogrenci|student|veli|parent/.test(a);

  const adSoyad =
    bul((a) => a === "full_name" || a === "full name") ??
    ([bul((a) => a === "first_name"), bul((a) => a === "last_name")].filter(Boolean).join(" ") || null) ??
    bul((a) => /ad(i|iniz)?[ _]?soyad|tam[ _]ad|isim|full.?name/.test(a) && !baskasininAdi(a) && !adDegil(a));
  /* Önce Meta'nın standart alanı: formda "veli_telefonu" gibi ikinci bir
     telefon sorusu varsa, dizideki sıraya göre o seçilmesin. */
  const telefon =
    bul((a) => a === "phone_number" || a === "phone number") ??
    bul((a) => a.includes("telefon") || a.includes("phone"));

  const sinavHam = bul((a) => a.includes("sinav") || a.includes("exam"));
  let sinav: string | null = null;
  if (sinavHam) {
    const s = sade(sinavHam);
    sinav = s.includes("lgs") ? "LGS" : /yks|tyt|ayt|universite/.test(s) ? "YKS" : "Diğer";
  }

  return {
    adSoyad,
    telefon,
    sinav,
    sinif: bul((a) => a.includes("sinif") || a.includes("grade")),
    ogrenci: bul(
      (a) => (a.includes("ogrenci") || a.includes("student")) && !a.includes("veli") && !adDegil(a),
    ),
    veli: bul((a) => (a.includes("veli") || a.includes("parent")) && !adDegil(a)),
  };
}

/** Graph'ın "2026-10-18T10:00:00+0000" biçimi; okunamıyorsa şimdiki zaman. */
export function zaman(ham: string | undefined | null): string {
  const d = ham ? new Date(ham) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

export interface MetaBasvuruGirdisi {
  leadId: string;
  createdTime?: string | null;
  formId?: string | null;
  adName?: string | null;
  campaignName?: string | null;
  platform?: string | null;
  alanlar: MetaAlan[];
}

/** leads satırı; telefon yoksa KaliciHata. */
export function metaSatiri(g: MetaBasvuruGirdisi) {
  const e = alanlariEsle(g.alanlar);
  if (!e.telefon) {
    /* leads.phone NOT NULL ve panel telefonla çalışıyor. Kalıcı — tekrar
       denemek telefonu getirmez. Önlemi Meta tarafında: formda telefon
       sorusu zorunlu olmalı. Başvuru Meta'nın kendi panelinde yine duruyor. */
    throw new KaliciHata(`telefon alanı yok (form ${g.formId ?? "?"})`);
  }
  return {
    source: "meta",
    meta_lead_id: g.leadId,
    meta_form_id: g.formId || null,
    meta_ad_name: g.adName || null,
    meta_campaign_name: g.campaignName || null,
    meta_platform: g.platform || null,
    meta_fields: g.alanlar,
    full_name: e.adSoyad || "İsimsiz (Meta)",
    phone: telefonNormalize(e.telefon),
    exam_type: e.sinav,
    student_full_name: e.ogrenci ?? "",
    parent_full_name: e.veli ?? "",
    grade_class: e.sinif ?? "",
    selected_subjects: [] as string[],
    /* step = 2: bkz. supabase-meta-leads.sql — update_lead_step2'nin bu
       satıra dokunmaması için de gerekli. */
    step: 2,
    created_at: zaman(g.createdTime),
  };
}

/** Tek satır yaz; zaten varsa (aynı meta_lead_id) sessizce hiçbir şey yapmaz. */
export async function metaSatiriYaz(satir: ReturnType<typeof metaSatiri>): Promise<void> {
  const supabase = serviceClient();
  if (!supabase) throw new Error("Supabase yapılandırılmamış");
  const { error } = await supabase
    .from("leads")
    .upsert(satir, { onConflict: "meta_lead_id", ignoreDuplicates: true });
  if (error) throw new Error(`leads yazılamadı: ${error.code} ${error.message}`);
}
