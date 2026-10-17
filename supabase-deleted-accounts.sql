-- =============================================================================
-- SİLİNEN HESAPLAR — 30 gün bekleyen, geri getirilebilen silme
-- =============================================================================
-- Yönetim panelindeki "Sil" bir hesabı HEMEN yok etmiyor:
--
--   1. auth kullanıcısı YASAKLANIYOR (Admin API, ban_duration) — sunucuda.
--      Oturum yenilenemez, yeni giriş yapılamaz.
--   2. profiles satırı bu tabloya TAŞINIYOR (soft_delete_account, tek
--      işlem). Profili olmayan kullanıcı giriş yapamaz (telefon -> e-posta
--      eşlemesi profiles üzerinden) ve elindeki jetonla da panele giremez
--      (requireSession profil yoksa 403).
--   3. 30 gün sonra sunucu auth kullanıcısını gerçekten siliyor; bu tablodaki
--      satır ON DELETE CASCADE ile kendiliğinden gidiyor.
--
-- auth.users'a bağlı her şey (dersler, ödemeler, müsaitlik, açıklama, sözleşme
-- onayı) 30 gün boyunca YERİNDE kalıyor; geri getirmek profili geri koymak +
-- yasağı kaldırmak, şifre dahil hiçbir şey kaybolmuyor.
--
-- NEDEN PROFİLİ TAŞIMAK, BİR deleted_at BAYRAĞI DEĞİL: bayrak, profiles'ı
-- okuyan her sorgunun (giriş, requireSession, öğretmenin öğrenci adları,
-- yönetim listesi) onu filtrelemesini gerektirirdi; biri unutulursa silinmiş
-- hesap geri sızar. Satır yoksa unutulacak bir filtre de yok. Bedeli: bekleme
-- süresinde telefon numarası boşa çıkıyor, aynı numarayla yeni hesap açılırsa
-- geri getirme 23505 ile reddediliyor (sunucu bunu açıkça söylüyor).
--
-- pg_cron bu projede YOK; 30 günlük temizliği sunucu fırsatçı yapıyor
-- (yönetim paneli açıldığında, bkz. server/routes/admin.ts kaliciSilmeTurlari).
--
-- Bu dosyayı push'tan ÖNCE Supabase SQL Editor'de çalıştırın. İdempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.deleted_accounts (
  -- CASCADE: kalıcı silmede (auth.admin.deleteUser) satır kendiliğinden gider.
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Profilin TAMAMI. Geri getirme jsonb_populate_record ile aynen geri koyuyor;
  -- kolon listesini burada tekrarlamak, profiles'a eklenecek her kolonda bu
  -- dosyayı unutmaya açık olurdu.
  profile JSONB NOT NULL,
  -- Listeleme için profilden kopyalar (JSONB'yi açmadan sıralayıp göstermek).
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  user_type TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Silen yönetici. Onun hesabı silinse de kayıt kalmalı.
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Kalıcı silme denendi ama olmadı (ör. sözleşme onaylamış öğretmen:
  -- teacher_contract_acceptances ON DELETE RESTRICT). Satır listede kalır,
  -- geri getirilebilir; deneme günde bir tekrarlanır.
  purge_attempted_at TIMESTAMPTZ,
  purge_error TEXT
);

COMMENT ON TABLE public.deleted_accounts IS
  'Silinen hesapların profilleri, 30 gün geri getirilebilir. Yalnızca servis rolü okur/yazar.';

CREATE INDEX IF NOT EXISTS deleted_accounts_deleted_at ON public.deleted_accounts (deleted_at);

-- leads / teacher_descriptions ile aynı desen: RLS açık, politika yok, yetki
-- yok. Okuyan/yazan tek yer /api/admin/* (servis rolü).
ALTER TABLE public.deleted_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deleted_accounts FROM anon, authenticated;
GRANT ALL ON public.deleted_accounts TO service_role;


-- -----------------------------------------------------------------------------
-- soft_delete_account — profili taşı (tek işlem)
-- -----------------------------------------------------------------------------
-- Telefon doğrulaması BURADA DA yapılıyor (p_phone): sunucu zaten karşılaştırıyor
-- ama satır kilitlendikten sonraki karşılaştırma, arada telefonu değişmiş bir
-- hesabı silmeyi de engelliyor.
--
-- KORUMA: profiles'a başka bir tablodan yabancı anahtar varsa işlem REDDEDİLİYOR.
-- Bu dosya yazılırken öyle bir bağ yok (her şey auth.users'a bağlı), ama
-- Dashboard'dan elle kurulmuş bir "references profiles ON DELETE CASCADE",
-- profili taşırken öğrencinin derslerini sessizce silerdi. Geri getirilebilir
-- silmenin tek vaadi hiçbir şeyin kaybolmaması; o vaadi tutamıyorsak hiç
-- silmemek doğru olan.
CREATE OR REPLACE FUNCTION public.soft_delete_account(p_id UUID, p_phone TEXT, p_by UUID)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_row public.profiles%ROWTYPE;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE contype = 'f'
      AND confrelid = 'public.profiles'::regclass
      AND conrelid <> 'public.profiles'::regclass
  ) THEN
    RETURN 'profil_bagli';
  END IF;

  SELECT * INTO v_row FROM public.profiles WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'yok';
  END IF;
  IF v_row.phone IS DISTINCT FROM p_phone THEN
    RETURN 'telefon';
  END IF;

  INSERT INTO public.deleted_accounts (id, profile, full_name, phone, user_type, deleted_by)
  VALUES (v_row.id, to_jsonb(v_row), v_row.full_name, v_row.phone, v_row.user_type, p_by)
  ON CONFLICT (id) DO UPDATE
    SET profile = EXCLUDED.profile,
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        user_type = EXCLUDED.user_type,
        deleted_at = now(),
        deleted_by = EXCLUDED.deleted_by,
        purge_attempted_at = NULL,
        purge_error = NULL;

  DELETE FROM public.profiles WHERE id = p_id;
  RETURN 'tamam';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.soft_delete_account(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_account(UUID, TEXT, UUID) TO service_role;


-- -----------------------------------------------------------------------------
-- restore_account — profili geri koy (tek işlem)
-- -----------------------------------------------------------------------------
-- Telefon ya da kullanıcı adı bekleme süresinde başka bir hesaba verildiyse
-- INSERT 23505 ile düşer ve işlem geri alınır; satır burada kalır.
CREATE OR REPLACE FUNCTION public.restore_account(p_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_profile JSONB;
BEGIN
  SELECT profile INTO v_profile FROM public.deleted_accounts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'yok';
  END IF;

  INSERT INTO public.profiles
  SELECT * FROM jsonb_populate_record(NULL::public.profiles, v_profile);

  DELETE FROM public.deleted_accounts WHERE id = p_id;
  RETURN 'tamam';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restore_account(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_account(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) anon/authenticated'ın yetkisi yok (0 satır):
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema='public' and table_name='deleted_accounts'
--    and grantee in ('anon','authenticated');
--
-- 2) RPC'ler yalnızca servis rolüne açık:
-- select routine_name, grantee from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name in ('soft_delete_account','restore_account');
--
-- 3) profiles'a bağlı başka tablo YOK (0 satır olmalı; varsa silme reddedilir):
-- select conrelid::regclass, conname from pg_constraint
--  where contype='f' and confrelid='public.profiles'::regclass
--    and conrelid <> 'public.profiles'::regclass;
--
-- 4) 30 gün sonra kalıcı silmede ne olacak: auth.users'a bağlı tabloların
--    ON DELETE davranışı. 'r'/'a' (RESTRICT/NO ACTION) olan bir tablo o hesabın
--    kalıcı silinmesini engeller; hesap listede "kalıcı silinemedi" olarak kalır.
-- select conrelid::regclass, conname, confdeltype from pg_constraint
--  where contype='f' and confrelid='auth.users'::regclass
--    and connamespace='public'::regnamespace;
