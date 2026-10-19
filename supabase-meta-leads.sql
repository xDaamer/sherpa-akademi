-- =============================================================================
-- META (FACEBOOK / INSTAGRAM) LEAD ADS -> public.leads
-- =============================================================================
-- Meta'daki "Potansiyel müşteri" (Lead Ads) formlarından gelen başvurular,
-- sitedeki formla AYNI tabloya yazılıyor ve yönetim panelinin "Başvurular"
-- sekmesinde "Web sitesi / Meta" seçimiyle ayrılıyor.
--
-- Akış (bkz. server/routes/metaWebhook.ts):
--   1. Biri Meta formunu gönderir; Meta, /api/meta/webhook'a yalnızca
--      leadgen_id içeren imzalı bir bildirim POST eder.
--   2. Sunucu imzayı (X-Hub-Signature-256, META_APP_SECRET) doğrular, sonra
--      Graph API'den başvurunun alanlarını sayfa jetonuyla çeker.
--   3. Satır source='meta' ile yazılır. meta_lead_id UNIQUE: Meta aynı
--      bildirimi birden çok kez gönderebiliyor (yeniden deneme), ikinci
--      gelişte satır tekrar açılmıyor.
--
-- Meta satırları step = 2 yazılıyor: Meta formu tek seferde, eksiksiz
-- gönderiliyor (sitedeki "yarım kaldı" durumu orada yok). Ayrıca bunun bir
-- güvenlik sonucu var: update_lead_step2 bir telefonun EN SON step = 1
-- satırını güncelliyor; Meta satırı step = 1 olsaydı, aynı numarayla sitede
-- ikinci adımı dolduran biri Meta başvurusunun üzerine yazardı.
--
-- Bu dosyayı push'tan ÖNCE Supabase SQL Editor'de çalıştırın. İdempotent.
-- =============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'website',
  -- Meta'nın başvuru kimliği (leadgen_id). Yeniden denemelerde tekrar
  -- yazmayı engelleyen anahtar.
  ADD COLUMN IF NOT EXISTS meta_lead_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_form_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_ad_name TEXT,
  ADD COLUMN IF NOT EXISTS meta_campaign_name TEXT,
  -- 'fb' / 'ig' — Graph API'nin `platform` alanı.
  ADD COLUMN IF NOT EXISTS meta_platform TEXT,
  -- Formdaki TÜM sorular ve cevaplar, Meta'nın verdiği hâliyle
  -- ([{ "name": ..., "values": [...] }]). Meta formundaki özel sorular
  -- sitedeki kolonlara birebir oturmuyor; hiçbiri kaybolmasın diye ham
  -- hâli saklanıyor, panel bunları ayrıca gösteriyor.
  ADD COLUMN IF NOT EXISTS meta_fields JSONB;

-- Var olan bütün satırlar sitedeki formdan geldi; DEFAULT bunu zaten
-- sağlıyor. CHECK ayrı ekleniyor ki dosya ikinci kez çalıştığında patlamasın.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_source_check' AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_source_check CHECK (source IN ('website', 'meta'));
  END IF;
END;
$$;

-- KISMİ (WHERE ...) DEĞİL, düz bir unique indeks: sunucu ON CONFLICT
-- (meta_lead_id) DO NOTHING yazıyor ve Postgres kısmi bir indeksi koşulsuz
-- bir ON CONFLICT'ten çıkaramıyor (42P10). Sitedeki satırlarda kolon NULL;
-- unique indeks birden çok NULL'a zaten izin veriyor.
CREATE UNIQUE INDEX IF NOT EXISTS leads_meta_lead_id_key
  ON public.leads (meta_lead_id);

-- Panelin "kaynak" filtresi + created_at sıralaması.
CREATE INDEX IF NOT EXISTS leads_source_created_at
  ON public.leads (source, created_at DESC);

-- Meta formunda hedef sınav sorusu olmayabilir; uydurmak ("YKS" varsayılanı)
-- yanlış etiket demek. Zaten NULL olabiliyorsa bu satır bir şey değiştirmez.
ALTER TABLE public.leads ALTER COLUMN exam_type DROP NOT NULL;


-- -----------------------------------------------------------------------------
-- Site geneli hız limiti Meta'ya UYGULANMIYOR
-- -----------------------------------------------------------------------------
-- enforce_leads_insert_rate_limit (supabase-anon-lead-insert.sql) dakikada 20
-- INSERT'ten sonra hata veriyor. Bu, sitedeki forma karşı bir bot önlemi;
-- Meta satırları imzası doğrulanmış bildirimlerden geliyor. Bir kampanyanın
-- yoğun anında reddedilen Meta başvurusu Meta'nın yeniden denemesine kalırdı
-- — kaybolmaz ama gecikir, üstelik sitedeki formun kotasını da tüketirdi.
-- Gövde aynı, yalnızca baştaki iki satır yeni.
CREATE OR REPLACE FUNCTION public.enforce_leads_insert_rate_limit()
RETURNS trigger AS $$
DECLARE
  recent_count INT;
BEGIN
  IF NEW.source = 'meta' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO recent_count FROM public.leads
  WHERE created_at > now() - interval '1 minute'
    AND source = 'website';
  IF recent_count >= 20 THEN
    RAISE EXCEPTION 'Çok fazla istek gönderildi. Lütfen birkaç dakika sonra tekrar deneyin.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.enforce_leads_insert_rate_limit() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Kolonlar geldi, eski satırların hepsi 'website':
-- select source, count(*) from public.leads group by source;
--
-- 2) anon/authenticated'ın leads üzerinde hâlâ HİÇBİR yetkisi yok (0 satır):
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema='public' and table_name='leads'
--    and grantee in ('anon','authenticated');
