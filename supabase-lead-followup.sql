-- =============================================================================
-- BAŞVURU TAKİBİ — eklendi 2026-10-20
-- =============================================================================
-- Yönetim panelinin "Başvurular" sekmesinde her başvuru için:
--   - "Arandı" kutusu (contacted_at),
--   - serbest metin yönetici notu (admin_note),
--   - iki etiket: "Deneme dersi alındı" (trial_taken), "Takip gerekli"
--     (needs_followup),
--   - Meta formundaki "hangi saatte aranmak istersiniz" cevabından türeyen
--     aranma dilimi (call_time_slot) — filtre bunun üzerinden çalışıyor.
-- Yalnızca YÖNETİCİLER görür ve yazar (/api/admin/basvurular, servis rolü).
--
-- ÖNCE supabase-meta-leads.sql (meta_fields kolonu ona ait), sonra bu dosya;
-- ikisi de push'tan ÖNCE Supabase SQL Editor'de. İdempotent.
-- Uygulanmadan deploy edilse de sekme AÇILIR: liste bu kolonlar olmadan
-- tekrar deneniyor ve kutular devre dışı görünüyor. Yalnızca işaretlemek ve
-- not kaydetmek hata döner.
--
-- ---------------------------------------------------------------------------
-- NEDEN leads'te kolon (ayrı bir tablo DEĞİL)
-- ---------------------------------------------------------------------------
-- teacher_descriptions'ın ayrı tablo olmasının sebebi, öğretmenin profiles'taki
-- kendi satırını okuyabilmesiydi. leads'te öyle bir okuyucu yok: anon ve
-- authenticated'ın tabloda HİÇBİR yetkisi yok (supabase-portal-auth.sql),
-- yeni kolonlar da o tablo seviyesindeki yetkisizliği devralıyor. Kolon olunca
-- "aranmayanlar" filtresi tek bir `contacted_at is null` oluyor; ayrı tabloda
-- "satırı hiç olmayan ya da işaretsiz olan" sorgusu gerekirdi.
--
-- BAŞVURUNUN KENDİSİ YİNE SALT OKUNUR. Yönetici yalnızca takip kolonlarını
-- yazıyor; formu dolduranın beyanı (ad, telefon, sınav, dersler...) ve
-- `updated_at` dokunulmadan kalıyor. `updated_at` "ikinci adım ne zaman
-- dolduruldu" demek (update_lead_step2 yazıyor, panel öyle gösteriyor);
-- notun zamanı o yüzden kendi kolonunda.
-- =============================================================================

ALTER TABLE public.leads
  -- NULL: henüz aranmadı. Kutu işaretlenince o anın zamanı.
  ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ,
  -- İşaretleyen yönetici. Hesabı silinse de işaret kalmalı.
  ADD COLUMN IF NOT EXISTS contacted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_note TEXT,
  ADD COLUMN IF NOT EXISTS admin_note_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_note_updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trial_taken BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_followup BOOLEAN NOT NULL DEFAULT false;

-- Boş not satırda tutulmuyor: sunucu boş metni NULL yazıyor (notu kaldırmak).
-- Sınır sunucudaki LEAD_NOT_MAKS ile aynı. CHECK ayrı ekleniyor ki dosya ikinci
-- kez çalıştığında patlamasın.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_admin_note_length' AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_admin_note_length
      CHECK (admin_note IS NULL OR char_length(admin_note) BETWEEN 1 AND 2000);
  END IF;
END;
$$;

COMMENT ON COLUMN public.leads.contacted_at IS
  'Yönetici "arandı" diye işaretlediği an; NULL = aranmadı. Yalnızca /api/admin yazar.';
COMMENT ON COLUMN public.leads.admin_note IS
  'Yöneticinin başvuru notu. Formu dolduranın beyanı değil; yalnızca /api/admin yazar.';


-- -----------------------------------------------------------------------------
-- ARANMA DİLİMİ: Meta formunun cevabından türeyen kolon
-- -----------------------------------------------------------------------------
-- Meta formunda "hangi saatte aranmak istersiniz" sorusu var; cevaplar
-- "08.00-17.00", "17.00-19.00", "19.00 sonrası". Ham hâli meta_fields'ta
-- duruyor ama orada filtrelenemiyor: sorunun adı formu kuranın yazdığı metin
-- ve JSONB dizisinin içinde.
--
-- GENERATED kolon, sunucuda hesaplanıp yazılan bir kolon DEĞİL: böylece
--   - var olan bütün Meta satırları bu ALTER'la birlikte doluyor (ayrı bir
--     geri doldurma UPDATE'i ve onun ayrı bir kopyası yok),
--   - aktarım kodu (server/metaLeads.ts) bu kolonu hiç bilmiyor; migration
--     uygulanmadan deploy edilse de Meta aktarımı kırılmıyor.
--
-- Soru ADINA değil CEVABA bakılıyor: ad formdan forma değişebilir, cevabın
-- biçimi (saat + aralık/"sonrası") değişmiyor. Tarih gibi görünen cevaplar
-- ("12.05.2010") eşleşmesin diye saatten sonra nokta/rakam gelmemeli.
-- Dilim ilk saate göre: <17 '08-17', <19 '17-19', aksi '19-sonrasi' —
-- Meta'daki üç seçeneğin sınırları. Sitedeki formda bu soru yok; o
-- satırlarda (meta_fields NULL) kolon NULL.
--
-- Fonksiyon `private` şemasında (PostgREST RPC olarak yayınlamasın diye, bkz.
-- supabase-teacher-panel.sql). O şemada varsayılan EXECUTE yok; leads'e
-- INSERT/UPDATE eden servis rolü her satırda bu fonksiyonu çağırıyor, yani
-- aşağıdaki GRANT olmadan SİTEDEKİ FORM DAHİL her başvuru yazması düşerdi.
-- Gövde hata veremeyecek şekilde yazıldı (::int yalnızca 1-2 rakama
-- uygulanıyor, beklenmeyen JSON biçimi boş diziye düşüyor) — form yazmasının
-- yolunda.
--
-- Fonksiyon değiştirilirse (CREATE OR REPLACE) var olan satırlar KENDİLİĞİNDEN
-- yeniden hesaplanmaz; ardından şunu çalıştırın:
--   UPDATE public.leads SET meta_fields = meta_fields WHERE meta_fields IS NOT NULL;
-- -----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.aranma_dilimi(alanlar JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN s.saat < 17 THEN '08-17'
           WHEN s.saat < 19 THEN '17-19'
           ELSE '19-sonrasi'
         END
  FROM (
    SELECT (regexp_match(v.deger, '(\d{1,2})\s*[.:]\s*\d{2}(?![.\d])'))[1]::int AS saat
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(alanlar) = 'array' THEN alanlar ELSE '[]'::jsonb END
         ) AS f(alan)
    CROSS JOIN LATERAL jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(f.alan -> 'values') = 'array' THEN f.alan -> 'values' ELSE '[]'::jsonb END
         ) AS v(deger)
    WHERE v.deger ~* '\d{1,2}\s*[.:]\s*\d{2}(?![.\d])\s*([-–—_/]|sonra|önce|once|ile)'
    LIMIT 1
  ) AS s
$$;

COMMENT ON FUNCTION private.aranma_dilimi(JSONB) IS
  'Meta formunun "aranma saati" cevabını üç dilimden birine çevirir; leads.call_time_slot bunu kullanıyor.';

REVOKE ALL ON FUNCTION private.aranma_dilimi(JSONB) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.aranma_dilimi(JSONB) TO service_role;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS call_time_slot TEXT
  GENERATED ALWAYS AS (private.aranma_dilimi(meta_fields)) STORED;

-- PostgREST şema önbelleği yeni kolonları hemen görsün.
NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Kolonlar geldi; Meta başvuruları dilimlere dağıldı (NULL'lar sitedeki
--    satırlar ve aranma saati sorusu olmayan Meta formları):
-- select source, call_time_slot, count(*) from public.leads group by 1, 2 order by 1, 2;
--
-- 2) Hangi cevap hangi dilime düştü — beklenmedik bir biçim varsa burada görünür:
-- select distinct v as cevap, private.aranma_dilimi(meta_fields) as dilim
--   from public.leads, jsonb_array_elements(meta_fields) f, jsonb_array_elements_text(f->'values') v
--  where source = 'meta' and v ~ '\d[.:]\d{2}';
--
-- 3) SERVİS ROLÜ yazabiliyor (yani form ve Meta aktarımı kırılmadı). Bu
--    dosyayı çalıştırdıktan HEMEN SONRA, push'u beklemeden: kolon veritabanında
--    oluştuğu anda her başvuru yazması bu fonksiyonu çağırıyor. Sunucunun
--    rolüyle sahte bir yazma yapıp geri alıyor; hiçbir şey kalıcı değişmez:
-- begin;
--   set local role service_role;
--   update public.leads set meta_fields = meta_fields
--    where id = (select id from public.leads order by created_at desc limit 1);
-- rollback;
--    -> SQL Editor "Success. No rows returned" demeli. Kırmızı bir
--       "permission denied for function aranma_dilimi" görürseniz form
--       BOZUK demektir; hemen şunu çalıştırın, form eski hâline döner:
--         ALTER TABLE public.leads DROP COLUMN IF EXISTS call_time_slot;
--
-- 4) anon/authenticated'ın leads üzerinde hâlâ HİÇBİR yetkisi yok (0 satır):
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema='public' and table_name='leads'
--    and grantee in ('anon','authenticated');
