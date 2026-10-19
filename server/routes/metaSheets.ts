import express from "express";
import { createHash, timingSafeEqual } from "crypto";
import { serviceClient } from "../supabase.js";
import {
  KaliciHata,
  alanlariEsle,
  kimlikSade,
  metaSatiri,
  metaSatiriYaz,
  telefonNormalize,
  type MetaAlan,
} from "../metaLeads.js";

/*
 * META -> GOOGLE SHEETS -> PANEL — POST /api/meta/sheets
 * ============================================================================
 * Meta'nın kendi "CRM kurulumu › Google Sheets" bağlantısı reklam formu
 * başvurularını bir tabloya yazıyor. Tablodaki Apps Script
 * (scripts/meta-sheets-aktarim.gs) birkaç dakikada bir SON SATIRLARI olduğu
 * gibi buraya gönderiyor; hangisinin yeni olduğuna burada karar veriliyor.
 *
 * NEDEN SCRIPT "APTAL": Script yalnızca başlık -> değer çiftlerini yolluyor,
 * eşleme kuralı (hangi sütun telefon, hangisi sınav) burada. Kural değişince
 * yöneticinin script'i yeniden yapıştırması gerekmiyor.
 *
 * NEDEN HER SEFERİNDE SON N SATIR, "KALDIĞI YER" DEĞİL: Tablo başvurunun asıl
 * kaynağı ve hiçbir şey silmiyor. Script durum tutmadığı için yarıda kalan
 * bir aktarım, ağ hatası ya da sunucu hatası bir başvuruyu KAYBETTİREMEZ —
 * sonraki tur aynı satırları yeniden yollar. Tekrarı meta_lead_id (Meta'nın
 * başvuru kimliği, UNIQUE) eliyor; zaten var olanlar önce tek sorguyla
 * ayıklanıyor ki BEFORE INSERT tetikleyicileri her turda boşuna çalışmasın.
 *
 * GÜVENLİK: Çağıran Google'ın sunucusu, Origin yok — bu yüzden /api/leads*
 * altında değil. Kapı META_SHEETS_KEY: script onu `Authorization: Bearer`
 * ile yolluyor. Webhook yolundan farkı: içerik Graph API'den doğrulanmıyor,
 * anahtarı bilen satır yazabilir. Anahtar yalnızca Vercel'de ve tablonun
 * script özelliklerinde duruyor; tabloya düzenleme erişimi olan zaten
 * başvuruların tamamını görebiliyor.
 *
 * YANIT: Herhangi bir satır GEÇİCİ bir hatayla yazılamazsa 500 — Apps Script
 * hata verir, Google tetikleyici hatasını e-postayla bildirir, sonraki tur
 * yeniden dener. Telefonsuz satır kalıcı sayılır ve atlanır (200).
 */

const router = express.Router();

const AZAMI_SATIR = 500;
const AZAMI_SUTUN = 100;
const AZAMI_DEGER = 1000;

/* Meta'nın tabloya yazdığı sistem sütunları. Bunlar form cevabı değil;
   meta_fields'a girmiyor, gerekenler kendi kolonlarına gidiyor. */
const SISTEM_SUTUNLARI = new Set([
  "id", "lead_id", "leadgen_id", "created_time", "ad_id", "ad_name", "adset_id",
  "adset_name", "campaign_id", "campaign_name", "form_id", "form_name",
  "is_organic", "platform", "lead_status", "inbox_url", "page_id", "page_name",
  "retailer_item_id",
]);

const sutunAdi = (s: string) => s.trim().toLocaleLowerCase("tr").replace(/\s+/g, "_");

function anahtarGecerli(req: express.Request): boolean {
  const beklenen = process.env.META_SHEETS_KEY;
  const baslik = req.get("authorization") ?? "";
  if (!beklenen || !baslik.startsWith("Bearer ")) return false;
  /* Özetler karşılaştırılıyor: timingSafeEqual eşit uzunluk istiyor ve
     uzunluk farkı da sızmasın. */
  const a = createHash("sha256").update(baslik.slice("Bearer ".length)).digest();
  const b = createHash("sha256").update(beklenen).digest();
  return timingSafeEqual(a, b);
}

interface HazirSatir {
  leadId: string;
  sistem: Record<string, string>;
  alanlar: MetaAlan[];
}

function satiriHazirla(ham: unknown): HazirSatir | null {
  if (!ham || typeof ham !== "object" || Array.isArray(ham)) return null;

  const sistem: Record<string, string> = {};
  const alanlar: MetaAlan[] = [];
  for (const [baslik, deger] of Object.entries(ham).slice(0, AZAMI_SUTUN)) {
    const v = String(deger ?? "").trim().slice(0, AZAMI_DEGER);
    if (!v || !baslik.trim()) continue;
    const ad = sutunAdi(baslik);
    if (SISTEM_SUTUNLARI.has(ad)) sistem[ad] = v;
    else alanlar.push({ name: baslik.trim(), values: [v] });
  }
  if (alanlar.length === 0) return null;

  /* Meta'nın tablosunda başvuru kimliği bir sütunda olmalı. Yoksa (başlıklar
     farklı adlandırılmışsa) kimlik YALNIZCA değişmeyen bilgilerden türetiliyor:
     zaman, form, telefon, ad. Bütün sütunlardan türetilseydi, tabloya elle
     eklenen bir "Arandı mı?" sütununu doldurmak aynı başvuruyu yeni sanıp
     panele ikinci kez yazdırırdı. */
  const metaKimligi = sistem.id ?? sistem.lead_id ?? sistem.leadgen_id;
  let leadId: string;
  if (metaKimligi) {
    leadId = kimlikSade(metaKimligi);
  } else {
    const e = alanlariEsle(alanlar);
    leadId =
      "sheet:" +
      createHash("sha256")
        .update(
          [sistem.created_time ?? "", sistem.form_id ?? "", e.telefon ? telefonNormalize(e.telefon) : "", e.adSoyad ?? ""].join("|"),
        )
        .digest("hex")
        .slice(0, 32);
  }

  return { leadId, sistem, alanlar };
}

/* Express 4 async hataları yakalamıyor: buradan kaçan bir istisna işlenmemiş
   ret olur ve süreci düşürür. Sarmalayıcı her şeyi 500'e çeviriyor. */
router.post("/sheets", (req, res) => {
  aktar(req, res).catch((err) => {
    console.error("[Meta/Sheets] beklenmeyen hata:", err?.message || err);
    if (!res.headersSent) res.status(500).json({ success: false });
  });
});

async function aktar(req: express.Request, res: express.Response) {
  if (!process.env.META_SHEETS_KEY) return res.status(503).json({ success: false });
  if (!anahtarGecerli(req)) return res.status(401).json({ success: false });

  const ham = req.body?.satirlar;
  if (!Array.isArray(ham) || ham.length > AZAMI_SATIR) {
    return res.status(400).json({ success: false, error: `satirlar: en fazla ${AZAMI_SATIR} satırlık dizi` });
  }

  const supabase = serviceClient();
  if (!supabase) return res.status(503).json({ success: false });

  /* Aynı tur içinde aynı başvuru iki kez geldiyse (tabloda kopya satır) bir kez. */
  const satirlar = [...new Map(
    ham.map(satiriHazirla).filter((s): s is HazirSatir => s !== null).map((s) => [s.leadId, s]),
  ).values()];

  /* Zaten yazılmış olanlar. 100'lük parçalar: `in.(...)` URL'de gidiyor. */
  const varOlan = new Set<string>();
  const kimlikler = satirlar.map((s) => s.leadId);
  for (let i = 0; i < kimlikler.length; i += 100) {
    const { data, error } = await supabase
      .from("leads")
      .select("meta_lead_id")
      .in("meta_lead_id", kimlikler.slice(i, i + 100));
    if (error) {
      console.error("[Meta/Sheets] var olan başvurular okunamadı:", error.code, error.message);
      return res.status(500).json({ success: false });
    }
    for (const r of data ?? []) if (r.meta_lead_id) varOlan.add(r.meta_lead_id);
  }

  const yeniler = satirlar.filter((s) => !varOlan.has(s.leadId));
  /* `async` ŞART: metaSatiri telefonsuz satırda EŞZAMANLI fırlatıyor. Düz bir
     ok fonksiyonunda o hata allSettled'a hiç ulaşmadan dışarı kaçar ve —
     telefonsuz tek bir satır her turda son 300'ün içinde kalacağı için —
     aktarımı kalıcı olarak düşürürdü (testte yakalandı). */
  const sonuclar = await Promise.allSettled(
    yeniler.map(async (s) =>
      metaSatiriYaz(
        metaSatiri({
          leadId: s.leadId,
          createdTime: s.sistem.created_time,
          formId: s.sistem.form_id ? kimlikSade(s.sistem.form_id) : null,
          adName: s.sistem.ad_name,
          campaignName: s.sistem.campaign_name,
          platform: s.sistem.platform,
          alanlar: s.alanlar,
        }),
      ),
    ),
  );

  let yazilan = 0;
  let atlanan = 0;
  let hatali = 0;
  sonuclar.forEach((s, i) => {
    if (s.status === "fulfilled") return void yazilan++;
    if (s.reason instanceof KaliciHata) {
      atlanan++;
      console.warn(`[Meta/Sheets] başvuru ${yeniler[i].leadId} atlandı:`, s.reason.message);
    } else {
      hatali++;
      console.error(`[Meta/Sheets] başvuru ${yeniler[i].leadId} yazılamadı (sonraki tur yeniden denenecek):`, s.reason?.message || s.reason);
    }
  });

  return res.status(hatali ? 500 : 200).json({
    success: hatali === 0,
    gelen: ham.length,
    zatenVardi: satirlar.length - yeniler.length,
    yazilan,
    atlanan,
    hatali,
  });
}

export default router;
