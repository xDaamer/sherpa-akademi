-- =============================================================================
-- ÖĞRETMEN SÖZLEŞMESİ ONAYI — eklendi 2026-10-17
-- =============================================================================
-- UYGULANDI 2026-10-17 (Supabase SQL Editor, kod deploy edilmeden önce).
-- Aynı gün sözleşme v1 eklendi ve aydınlatma/koşullar v1'deki ders kaydı
-- kısımları çıkarıldı (henüz onay yokken; buradaki metinler canlıyla aynı).
-- Yeni bir ortamda bir kez çalıştırın; tamamı idempotent (IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS /
-- ON CONFLICT DO NOTHING), tekrar çalıştırmak zararsız.
--
-- Öğretmen paneli, öğretmen sözleşmeyi elektronik ortamda onaylamadan
-- kullanılamıyor: panelde kapatılamayan bir pencere sözleşmeyi gösteriyor,
-- iki zorunlu kutucuk (KVKK Aydınlatma Metni okundu, Hizmet Koşulları kabul)
-- ve "Okudum, anladım" butonu var. Açık rıza YOK — hiçbir işleme açık rızaya
-- dayanmıyor (bkz. aydınlatma metni §4).
--
-- BU DOSYA NE YAPIYOR:
--   1. teacher_legal_documents       — sürümlü belge metinleri (sözleşme,
--                                      aydınlatma metni, hizmet koşulları)
--   2. teacher_contract_acceptances  — yalnızca ekleme yapılan onay (kanıt)
--                                      kaydı
--   3. değişmezlik tetikleyicisi     — onaylanmış bir belge düzenlenemez,
--                                      silinemez
--   4. onay kaydı korumaları         — a) yalnızca ekleme: onay satırı
--                                      değiştirilemez, silinemez, TRUNCATE
--                                      edilemez; b) üç kimlik doğru türdeki
--                                      belgeyi gösteriyor mu
--   5. teacher_contract_status       — sunucudaki kapının tek sorgusu (RPC)
--   6. seed                          — kvkk_aydinlatma v1, hizmet_kosullari v1
--   7. sözleşme şablonu              — yorum satırı; sözleşme seed EDİLMİYOR
--
-- ---------------------------------------------------------------------------
-- SIRA: ÖNCE BU SQL, SONRA PUSH
-- ---------------------------------------------------------------------------
-- Bu dosya, onu kullanan kod push edilmeden ÖNCE SQL Editor'de
-- çalıştırılmalı (CLAUDE.md: supabase-*.sql taşıyan bir commit push
-- edilmeden önce SQL uygulanır). Sunucu şemanın eksik olmasını TOLERE
-- ediyor — kapı tablo/fonksiyon yoksa console.error yazıp isteği geçiriyor,
-- /api/admin/ozet de onay rozeti olmadan devam ediyor — yani sıra ters olursa
-- panel ÇÖKMEZ. Ama o arada kapı da ÇALIŞMAZ; kural yine "önce SQL".
-- Uyguladıktan sonra supabase-teacher-panel-tests.sql'i (36-38) çalıştırın.
--
-- Uygulandıktan sonra bile, sözleşme (ogretmen_sozlesmesi) eklenene kadar
-- teacher_contract_status 'yok' döner ve kapı KAPALI kalır: panel bugünkü
-- gibi çalışır. Sözleşmeyi eklediğiniz an, onaylamamış her öğretmen bir
-- sonraki isteğinde pencereyi görür (şablon §7'de).
--
-- ---------------------------------------------------------------------------
-- HUKUKİ METİNLER TASLAKTIR — KONTROL EDİN
-- ---------------------------------------------------------------------------
-- §6'daki iki metin bir avukat tarafından gözden geçirilmeden yayına
-- alınmamalı. Özellikle:
--
--   a) DERS KAYITLARI: dersler KAYDEDİLMİYOR (2026-10-17 kararı) ve iki
--      metin de bunu açıkça söylüyor; sözleşmenin 8.3'ü de kaydı öğrenci/
--      veli açık onayı ile Kurum'un yazılı iznine bağlıyor. İleride kayda
--      başlanırsa bu metinlerin YENİ SÜRÜMÜ gerekir (amaç, hukuki sebep,
--      saklama süresi); v1 imzalandıktan sonra düzenlenemez.
--   b) YURT DIŞINA AKTARIM: metin, Supabase ve Vercel'e aktarımın Kurul'un
--      ilan ettiği STANDART SÖZLEŞME ile yapıldığını ve sözleşmenin Kurum'a
--      bildirildiğini söylüyor (KVKK md. 9; bildirim imzadan itibaren 5 iş
--      günü içinde). Bu fiilen yapılmadıysa metin gerçeği yansıtmaz.
--   c) BANKA/IBAN: metin ödeme için banka hesabı ve IBAN bilgisi
--      işlendiğini söylüyor. Ödeme başka yolla yapılıyorsa düzeltin.
--   d) Giriş denemesi kayıtları 30 gün (server/security.ts > SAKLAMA_GUNU),
--      denetim kayıtları 180 gün (supabase-audit-log.sql > prune_audit_log)
--      — ikisi de KODDAN alındı. Temizlik fırsatçı (pg_cron kurulu değil),
--      yani satırlar bu sürelerden biraz uzun kalabilir. Kodda süreyi
--      değiştirirseniz metnin de yeni sürümünü yayınlayın.
--   e) Hizmet Koşulları §10, öğretmen aleyhine değişikliklerin öğretmen
--      onaylamadıkça onu bağlamayacağını söylüyor. Bu, "yeniden onay
--      istenmiyor" tasarımıyla tutarlı (herkes onayladığı sürümle bağlı) ve
--      TBK md. 24'e (tek taraflı değişiklik yetkisi veren genel işlem
--      koşulları) karşı bilerek seçildi; avukatınız farklı düşünebilir.
--      Aynı madde güncel sürümün "Panel üzerinden veya e-posta yoluyla"
--      bildirileceğini söylüyor; bugünkü arayüz metinleri yalnızca onay
--      penceresinde gösteriyor, yani yeni sürümü e-postayla duyurmanız gerekir.
--   f) Hizmet Koşulları §11 (İstanbul mahkemeleri): ilişki bir iş
--      sözleşmesi sayılırsa yetki şartı geçersiz olabilir (7036 sayılı İş
--      Mahkemeleri Kanunu md. 6). İlişkinin niteliğini avukatınızla
--      netleştirin.
--
-- ---------------------------------------------------------------------------
-- NEDEN profiles'ta bir kolon DEĞİL
-- ---------------------------------------------------------------------------
-- Öğretmen profiles'taki KENDİ satırını okuyabiliyor (profiles_select_own) ve
-- authenticated'ın o tabloda tablo seviyesinde UPDATE yetkisi var. Oraya
-- konan bir "sozlesme_onaylandi" bayrağını öğretmen kendi jetonuyla
-- PostgREST'ten doğrudan true yapardı ve kapı anlamsızlaşırdı. Ayrıca tek bir
-- bayrak "hangi metni, ne zaman, nereden" sorularını cevaplayamaz; kanıt
-- olarak işe yarayan şey bu tablodaki satır. teacher_availability /
-- teacher_descriptions ile aynı desen: RLS açık, politika yok, yetki yok.
--
-- ---------------------------------------------------------------------------
-- NEDEN onay kaydını YALNIZCA servis rolü yazıyor
-- ---------------------------------------------------------------------------
-- Onay kaydı bir KANIT, audit_log gibi. Öğretmen bu tabloya kendi jetonuyla
-- yazabilseydi IP'yi, zamanı ve onayladığı sürümü istediği gibi
-- doldururdu; kaydın değeri, öğretmenin dokunamadığı bir yerden (sunucudan)
-- yazılmasında. Sunucu (server/routes/teacherContract.ts) satırı yazarken
-- öğretmen kimliğini oturumdan alıyor, istemciden gelen bir kimliği kabul
-- etmiyor. Belgeler de aynı nedenle yalnızca servis rolüyle okunuyor:
-- kimsenin kişisel verisi değiller (testimonials gibi), ama tablo
-- authenticated'a açılırsa okuma ile yazma yetkisini ayrı ayrı yönetmek
-- gerekirdi — hiç açmamak daha basit ve testi (36) daha keskin.
--
-- ---------------------------------------------------------------------------
-- NEDEN ON DELETE RESTRICT — VE BUNUN SONUCU
-- ---------------------------------------------------------------------------
-- Sözleşme kayıtları genel zamanaşımı süresince (TBK md. 146: 10 yıl)
-- saklanmalı; bir uyuşmazlıkta "bu öğretmen bu metni şu tarihte onayladı"
-- delili bu satır. CASCADE, hesabı silmenin delili de sessizce silmesi
-- demekti. Bu yüzden:
--
--   * Sözleşmeyi onaylamış bir öğretmen Supabase Dashboard'dan (ya da Admin
--     API ile) SİLİNEMEZ; silme FK hatasıyla başarısız olur. BİLEREK.
--     Hesabı kapatmak gerekirse silmek yerine şifresini değiştirin /
--     kullanıcıyı engelleyin (Authentication > Users > Ban user).
--   * "Önce onay satırını sil, sonra kullanıcıyı" yolu da KAPALI: onay
--     satırları değiştirilemez ve silinemez (§4a). Bu, onay vermiş HER
--     öğretmen için geçerli — `npm run test:panels`'in her çalıştırmada
--     açıp sözleşmeyi onaylattığı test öğretmeni dahil. O hesaplar da
--     aşağıdaki kaçış yolu kullanılmadıkça silinemez.
--   * Bir onayda kullanılmış belge de silinemez (FK + §3'teki tetikleyici).
--   * Yönetim panelinin hesap açarken hata olursa kullanıcıyı geri silmesi
--     (server/routes/admin.ts) etkilenmez: yeni hesabın onay satırı yok.
--
-- BİLİNÇLİ KAÇIŞ YOLU — yalnızca nadir, meşru durumlar için: ör. saklama
-- süresi (10 yıl) dolduktan sonra gelen bir KVKK silme talebi ya da test
-- hesaplarının temizliği. Tek işlem içinde: tetikleyici yalnızca bu işlem
-- süresince kapalı (ALTER TABLE'ın kilidi o arada başka yazmaları da
-- bekletiyor) ve bir hata olursa ROLLBACK onu da geri açıyor. Saklama
-- süresi dolmadan gerçek bir öğretmenin kaydını silmeden önce delili dışa
-- aktarmayı düşünün.
--
-- begin;
-- alter table public.teacher_contract_acceptances
--   disable trigger teacher_contract_acceptances_append_only;
-- delete from public.teacher_contract_acceptances
--  where teacher_id = '<ogretmen-uuid>';
-- alter table public.teacher_contract_acceptances
--   enable trigger teacher_contract_acceptances_append_only;
-- commit;
-- -- Ardından kullanıcı Dashboard'dan silinebilir; FK artık engellemez.
-- -- Onay satırı kalmayan belgeler de yeniden düzenlenebilir hâle gelir.
--
-- ---------------------------------------------------------------------------
-- SÜRÜM KURALI — YENİDEN ONAY İSTENMİYOR
-- ---------------------------------------------------------------------------
-- Bir türün GEÇERLİ belgesi, o türün en yüksek `version`'lı satırı. Yeni
-- sürüm yayınlamak = yeni satır eklemek (açılıp kapanan bir bayrak yok).
-- Bir kez onaylayan öğretmen, yeni sürüm yayınlansa da ONAYLI kalır; yine de
-- hangi sürümü onayladığı satırında kayıtlı. Bu kural tek bir yerde,
-- teacher_contract_status'ta; "her yeni sözleşme sürümünde yeniden onay"a
-- geçmek orada tek satırlık bir değişiklik (bkz. §5).
--
-- Bu dosyadaki seed metnini düzenleyip dosyayı yeniden çalıştırmak mevcut
-- v1'i GÜNCELLEMEZ (ON CONFLICT DO NOTHING). Değişiklik = yeni sürüm.
-- =============================================================================


-- =========================================================================
-- 1) teacher_legal_documents — sürümlü belge metinleri
-- =========================================================================
-- body DÜZ METİN: istemci onu HTML/markdown olarak değil, `white-space:
-- pre-line` ile gösteriyor (XSS'e karşı güvenli). Satır sonları korunuyor,
-- satır başındaki boşluklar yutuluyor. Bu yüzden: her paragraf TEK satır,
-- paragraflar arasında boş satır, başlıklar kendi satırında ("1. VERİ
-- SORUMLUSU"), listeler "- " ya da "a) " ile. Markdown yıldızı kullanmayın.
CREATE TABLE IF NOT EXISTS public.teacher_legal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  version INT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_legal_documents_kind
    CHECK (kind IN ('ogretmen_sozlesmesi', 'kvkk_aydinlatma', 'hizmet_kosullari')),
  CONSTRAINT teacher_legal_documents_version CHECK (version >= 1),
  CONSTRAINT teacher_legal_documents_title_length
    CHECK (char_length(title) BETWEEN 1 AND 200 AND btrim(title) <> ''),
  CONSTRAINT teacher_legal_documents_body_length
    CHECK (char_length(body) BETWEEN 1 AND 200000 AND btrim(body) <> ''),
  -- §7'deki şablon, yer tutucusu silinmeden çalıştırılırsa reddedilsin.
  -- Yeniden onay istenmediği için yer tutucuyu onaylayan bir öğretmen
  -- SONSUZA kadar onu onaylamış sayılırdı; bu kısıt o kazayı kapatıyor.
  CONSTRAINT teacher_legal_documents_not_placeholder
    CHECK (strpos(body, 'buraya yapıştırın') = 0),
  -- ON CONFLICT (kind, version) bu kısıta dayanıyor.
  CONSTRAINT teacher_legal_documents_kind_version UNIQUE (kind, version)
);

COMMENT ON TABLE public.teacher_legal_documents IS
  'Öğretmen sözleşmesi, KVKK aydınlatma metni ve hizmet koşulları; sürümlü. Geçerli belge = o türün en yüksek version''ı. Onaylanmış belge değiştirilemez (private.teacher_legal_documents_immutable). Yalnızca servis rolü okur/yazar.';

-- Supabase public şemadaki yeni tablolara anon/authenticated için varsayılan
-- yetki veriyor; REVOKE bu yüzden ŞART, süs değil.
ALTER TABLE public.teacher_legal_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teacher_legal_documents FROM anon, authenticated;
GRANT ALL ON public.teacher_legal_documents TO service_role;


-- =========================================================================
-- 2) teacher_contract_acceptances — onay (kanıt) kaydı
-- =========================================================================
-- Yalnızca EKLEME yapılır (§4a'daki tetikleyici bunu zorluyor; servis rolü
-- ve Dashboard dahil). "Öğretmen onayladı mı" sorusunun cevabı: bu
-- tabloda satırı var mı. Çift tıkta sunucu ikinci satırı yazmıyor; yine de
-- birden çok satır olması zararsız (ilk onay = en eski accepted_at).
CREATE TABLE IF NOT EXISTS public.teacher_contract_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  sozlesme_id UUID NOT NULL
    REFERENCES public.teacher_legal_documents(id) ON DELETE RESTRICT,
  aydinlatma_id UUID NOT NULL
    REFERENCES public.teacher_legal_documents(id) ON DELETE RESTRICT,
  kosullar_id UUID NOT NULL
    REFERENCES public.teacher_legal_documents(id) ON DELETE RESTRICT,
  aydinlatma_okundu BOOLEAN NOT NULL,
  kosullar_kabul BOOLEAN NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Sunucunun gördüğü istemci IP'si (req.ip; trust proxy açık).
  ip TEXT,
  user_agent TEXT,
  -- İki kutucuk zorunlu: false ile bir "onay" kaydı anlamsız.
  CONSTRAINT teacher_contract_acceptances_aydinlatma_okundu CHECK (aydinlatma_okundu),
  CONSTRAINT teacher_contract_acceptances_kosullar_kabul CHECK (kosullar_kabul),
  CONSTRAINT teacher_contract_acceptances_user_agent_length
    CHECK (char_length(user_agent) <= 500)
);

COMMENT ON TABLE public.teacher_contract_acceptances IS
  'Öğretmen sözleşmesi onay kaydı (kanıt): kim, hangi sürümleri, ne zaman, hangi IP/tarayıcıdan. Yalnızca ekleme (UPDATE/DELETE/TRUNCATE tetikleyiciyle engelli); yalnızca servis rolü yazar. ON DELETE RESTRICT: onaylamış öğretmen silinemez (TBK md. 146, 10 yıl).';

-- Kapının sorgusu (teacher_id) ve "ilk onay" sorgusu (accepted_at) için.
CREATE INDEX IF NOT EXISTS teacher_contract_acceptances_teacher
  ON public.teacher_contract_acceptances (teacher_id, accepted_at);

ALTER TABLE public.teacher_contract_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teacher_contract_acceptances FROM anon, authenticated;
GRANT ALL ON public.teacher_contract_acceptances TO service_role;


-- =========================================================================
-- 3) Değişmezlik tetikleyicisi — onaylanmış belge değiştirilemez
-- =========================================================================
-- Yeniden onay istenmediği için, onaylanmış bir metni yerinde düzenlemek
-- imzacıların NEYİ onayladığına dair kanıtı sessizce bozardı: satır aynı
-- id'yi gösterir ama metin artık başka. Bu yüzden bir belge herhangi bir
-- onay satırında (üç kimlik kolonundan herhangi birinde) geçtiği andan
-- itibaren kind/version/title/body/created_at değiştirilemez ve belge
-- silinemez. Henüz kimsenin onaylamadığı bir belgede yazım hatası
-- düzeltilebilir.
--
-- id'nin değiştirilmesini ayrıca FK engelliyor (ON UPDATE NO ACTION).
-- TRUNCATE satır tetikleyicilerini atlar, ama FK onu engeller; TRUNCATE
-- ... CASCADE ise onay tablosunu da boşaltacağı için §4a'daki TRUNCATE
-- tetikleyicisine takılır.
--
-- Fonksiyon `private` şemasında: public'te olsaydı PostgREST onu RPC olarak
-- da yayınlardı (supabase-teacher-panel.sql'deki ogrencim_mi gerekçesi).
-- Tetikleyiciler çağıranın EXECUTE yetkisine bakmadan çalışır, yani yetkiyi
-- herkesten almak tetikleyiciyi bozmaz. SECURITY DEFINER DEĞİL: belgeleri
-- güncelleyebilen tek roller (servis rolü, postgres) onay tablosunu zaten
-- okuyabiliyor.
--
-- `private` şeması supabase-teacher-panel.sql'de kuruldu ve yetkileri orada
-- ayarlandı; IF NOT EXISTS mevcut şemaya ve yetkilerine dokunmaz. Yeni bir
-- ortamda ilk kez burada oluşursa da PUBLIC'in yeni bir şemada varsayılan
-- yetkisi yok.
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.teacher_legal_documents_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Hiçbir korunan alan değişmiyorsa (ör. SET title = title) serbest.
  -- İç içe IF bilerek: DELETE'te NEW'e hiç dokunulmuyor.
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.kind, NEW.version, NEW.title, NEW.body, NEW.created_at)
       IS NOT DISTINCT FROM
       (OLD.kind, OLD.version, OLD.title, OLD.body, OLD.created_at) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.teacher_contract_acceptances a
    WHERE a.sozlesme_id = OLD.id
       OR a.aydinlatma_id = OLD.id
       OR a.kosullar_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Bu belge en az bir öğretmen tarafından onaylandı; değiştirilemez. Yeni bir sürüm ekleyin (version + 1).'
      USING ERRCODE = 'restrict_violation',
            DETAIL = format('İşlem: %s, belge: %s (%s, sürüm %s)',
                            TG_OP, OLD.id, OLD.kind, OLD.version);
  END IF;

  -- BEFORE tetikleyicisi: DELETE'te OLD dönmezse silme SESSİZCE atlanır.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.teacher_legal_documents_immutable() IS
  'Bir onayda kullanılmış belgenin UPDATE (kind/version/title/body/created_at) ve DELETE işlemini reddeder. Yeni metin = yeni sürüm (version + 1).';

REVOKE EXECUTE ON FUNCTION private.teacher_legal_documents_immutable()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS teacher_legal_documents_immutable ON public.teacher_legal_documents;
CREATE TRIGGER teacher_legal_documents_immutable
  BEFORE UPDATE OR DELETE ON public.teacher_legal_documents
  FOR EACH ROW EXECUTE FUNCTION private.teacher_legal_documents_immutable();


-- =========================================================================
-- 4) Onay kaydı korumaları
-- =========================================================================

-- 4a) Yalnızca ekleme — onay satırı değiştirilemez, silinemez
-- -------------------------------------------------------------------------
-- RLS ve yetkiler öğretmeni dışarıda tutuyor ama servis rolünü ve
-- Dashboard'u (postgres) DEĞİL: onlar RLS'i baypas eder. Kanıt kaydının
-- değeri sonradan dokunulamamasında; bir sunucu hatası, yanlış bir SQL ya
-- da Dashboard'da bir tıklama "kim neyi ne zaman onayladı" kaydını sessizce
-- değiştirmemeli. Bu yüzden bu tetikleyici RLS testi değil, veritabanı
-- seviyesinde bir korkuluk: UPDATE ve DELETE satır başına, TRUNCATE deyim
-- başına reddediliyor (TRUNCATE satır tetikleyicilerini atlar ve bu
-- tabloya FK ile bağlı bir tablo yok, ayrı tetikleyici şart).
--
-- Meşru bir silme için başlıktaki "BİLİNÇLİ KAÇIŞ YOLU"na bakın.
CREATE OR REPLACE FUNCTION private.teacher_contract_acceptances_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- TRUNCATE deyim seviyesinde çalışır: OLD yok, satır kimliği yazılamaz.
  IF TG_LEVEL = 'STATEMENT' THEN
    RAISE EXCEPTION 'Sözleşme onay kayıtları değiştirilemez ve silinemez; bunlar delil kaydıdır.'
      USING ERRCODE = 'restrict_violation',
            DETAIL = format('İşlem: %s', TG_OP),
            HINT = 'Meşru bir silme için supabase-teacher-contract.sql başlığındaki kaçış yoluna bakın.';
  END IF;

  RAISE EXCEPTION 'Sözleşme onay kayıtları değiştirilemez ve silinemez; bunlar delil kaydıdır.'
    USING ERRCODE = 'restrict_violation',
          DETAIL = format('İşlem: %s, kayıt: %s, öğretmen: %s', TG_OP, OLD.id, OLD.teacher_id),
          HINT = 'Meşru bir silme için supabase-teacher-contract.sql başlığındaki kaçış yoluna bakın.';
END;
$$;

COMMENT ON FUNCTION private.teacher_contract_acceptances_append_only() IS
  'teacher_contract_acceptances yalnızca ekleme: UPDATE, DELETE ve TRUNCATE reddedilir (servis rolü ve Dashboard dahil). Kaçış yolu dosya başlığında.';

REVOKE EXECUTE ON FUNCTION private.teacher_contract_acceptances_append_only()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS teacher_contract_acceptances_append_only ON public.teacher_contract_acceptances;
CREATE TRIGGER teacher_contract_acceptances_append_only
  BEFORE UPDATE OR DELETE ON public.teacher_contract_acceptances
  FOR EACH ROW EXECUTE FUNCTION private.teacher_contract_acceptances_append_only();

DROP TRIGGER IF EXISTS teacher_contract_acceptances_no_truncate ON public.teacher_contract_acceptances;
CREATE TRIGGER teacher_contract_acceptances_no_truncate
  BEFORE TRUNCATE ON public.teacher_contract_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION private.teacher_contract_acceptances_append_only();


-- 4b) Belge türü — üç kimlik doğru türü gösteriyor mu
-- -------------------------------------------------------------------------
-- FK yalnızca "böyle bir belge var" der; sozlesme_id'ye bir aydınlatma
-- metninin kimliğini yazmayı engellemez. Sunucu kimlikleri güncel
-- sürümlerle karşılaştırıyor, bu ikinci savunma hattı.
--
-- FOR SHARE bilerek: FK kontrolünün aldığı KEY SHARE kilidi, belgenin
-- metnini değiştiren bir UPDATE ile ÇAKIŞMAZ. Yani kilit olmadan, bir
-- belgenin metni düzenlenirken aynı anda o belgeye bir onay yazılabilir ve
-- §3'teki tetikleyici onayı göremeyebilirdi. FOR SHARE ikisini sıraya
-- sokuyor.
CREATE OR REPLACE FUNCTION private.teacher_contract_acceptance_kinds()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_kind TEXT;
BEGIN
  SELECT d.kind INTO v_kind
  FROM public.teacher_legal_documents d
  WHERE d.id = NEW.sozlesme_id
  FOR SHARE;
  IF v_kind IS DISTINCT FROM 'ogretmen_sozlesmesi' THEN
    RAISE EXCEPTION 'sozlesme_id bir öğretmen sözleşmesini göstermiyor (bulunan tür: %).',
      coalesce(v_kind, 'belge yok')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT d.kind INTO v_kind
  FROM public.teacher_legal_documents d
  WHERE d.id = NEW.aydinlatma_id
  FOR SHARE;
  IF v_kind IS DISTINCT FROM 'kvkk_aydinlatma' THEN
    RAISE EXCEPTION 'aydinlatma_id bir KVKK aydınlatma metnini göstermiyor (bulunan tür: %).',
      coalesce(v_kind, 'belge yok')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT d.kind INTO v_kind
  FROM public.teacher_legal_documents d
  WHERE d.id = NEW.kosullar_id
  FOR SHARE;
  IF v_kind IS DISTINCT FROM 'hizmet_kosullari' THEN
    RAISE EXCEPTION 'kosullar_id hizmet koşullarını göstermiyor (bulunan tür: %).',
      coalesce(v_kind, 'belge yok')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.teacher_contract_acceptance_kinds() IS
  'Onay satırındaki sozlesme_id/aydinlatma_id/kosullar_id doğru türdeki belgeyi gösteriyor mu; belgeleri FOR SHARE kilitler (değişmezlik tetikleyicisiyle yarışı önler).';

REVOKE EXECUTE ON FUNCTION private.teacher_contract_acceptance_kinds()
  FROM PUBLIC, anon, authenticated;

-- Yalnızca INSERT: UPDATE zaten §4a'da reddediliyor.
DROP TRIGGER IF EXISTS teacher_contract_acceptance_kinds ON public.teacher_contract_acceptances;
CREATE TRIGGER teacher_contract_acceptance_kinds
  BEFORE INSERT ON public.teacher_contract_acceptances
  FOR EACH ROW EXECUTE FUNCTION private.teacher_contract_acceptance_kinds();


-- =========================================================================
-- 5) teacher_contract_status — kapının tek sorgusu
-- =========================================================================
-- Dönüş:
--   'yok'     — hiç ogretmen_sozlesmesi yayınlanmamış: kapı KAPALI, geçir.
--   'imzali'  — öğretmenin EN AZ BİR onay satırı var (hangi sürüm olursa).
--   'imzasiz' — sözleşme var, öğretmenin onayı yok: 403 SOZLESME_GEREKLI.
--
-- Sunucu her öğretmen isteğinde bunu servis rolüyle çağırıyor; tek gidiş
-- dönüş. SECURITY DEFINER DEĞİL: servis rolü RLS'i zaten baypas ediyor,
-- başka kimse de çağıramıyor (aşağıdaki REVOKE).
--
-- "HER YENİ SÖZLEŞME SÜRÜMÜNDE YENİDEN ONAY" İSTENİRSE: 'imzali' satırındaki
-- koşula güncel sözleşmenin kimliğini eklemek yeterli —
--
--     WHEN EXISTS (SELECT 1 FROM public.teacher_contract_acceptances a
--                  WHERE a.teacher_id = p_teacher
--                    AND a.sozlesme_id = (SELECT d.id FROM public.teacher_legal_documents d
--                                         WHERE d.kind = 'ogretmen_sozlesmesi'
--                                         ORDER BY d.version DESC LIMIT 1))
--       THEN 'imzali'
--
-- (Sunucudaki "zaten onaylıysa yeni satır yazma" kontrolü bu fonksiyona
-- değil kendi sorgusuna bakıyorsa, onu da aynı şekilde güncelleyin.)
CREATE OR REPLACE FUNCTION public.teacher_contract_status(p_teacher UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.teacher_legal_documents d
                     WHERE d.kind = 'ogretmen_sozlesmesi')
      THEN 'yok'
    WHEN EXISTS (SELECT 1 FROM public.teacher_contract_acceptances a
                 WHERE a.teacher_id = p_teacher)
      THEN 'imzali'
    ELSE 'imzasiz'
  END;
$$;

COMMENT ON FUNCTION public.teacher_contract_status(UUID) IS
  'Öğretmen sözleşmesi durumu: yok (sözleşme yayınlanmamış, kapı kapalı) | imzali (herhangi bir onay satırı var) | imzasiz. Yalnızca servis rolü çağırır.';

-- PostgREST public şemadaki her fonksiyonu RPC olarak yayınlıyor; servis
-- rolü dışında kimse çağıramamalı (set_teacher_availability ile aynı
-- gerekçe). Supabase yeni fonksiyonlara authenticated'a da doğrudan EXECUTE
-- veriyor; yalnızca PUBLIC'ten almak YETMEZ.
REVOKE EXECUTE ON FUNCTION public.teacher_contract_status(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_contract_status(UUID) TO service_role;


-- =========================================================================
-- 6) SEED — KVKK aydınlatma metni v1, hizmet koşulları v1
-- =========================================================================
-- TASLAK — avukat kontrolünden geçmeli (bkz. başlıktaki KONTROL EDİN).
-- $metin$ ... $metin$: Türkçe kesme işaretleri (Kerem Ünal'dır) tırnak
-- kaçırmadan yazılabilsin diye. Metin $metin$'in hemen ardından başlıyor,
-- yoksa gövde boş bir satırla açılırdı.
INSERT INTO public.teacher_legal_documents (kind, version, title, body)
VALUES (
  'kvkk_aydinlatma',
  1,
  'Öğretmenler İçin KVKK Aydınlatma Metni',
  $metin$Son güncelleme: 17.10.2026

Bu aydınlatma metni, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") md. 10 ve Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ uyarınca, Sherpa Akademi platformunda ders veren veya ders vermek üzere anlaşan öğretmenlerin ("Öğretmen") kişisel verilerinin işlenmesine ilişkin olarak veri sorumlusu tarafından hazırlanmıştır.

1. VERİ SORUMLUSU

Kişisel verileriniz, KVKK uyarınca veri sorumlusu sıfatıyla Kerem Ünal ("Veri Sorumlusu") tarafından işlenmektedir. "Sherpa Akademi", Veri Sorumlusu tarafından işletilen eğitim platformunun ve markanın adıdır.

Veri Sorumlusu: Kerem Ünal
Adres: Katar Cd., Maslak Mah., Sarıyer/İstanbul
E-posta: keremunl0616@gmail.com

2. İŞLENEN KİŞİSEL VERİ KATEGORİLERİ

Öğretmen ile kurulan hizmet ilişkisi kapsamında aşağıdaki kişisel verileriniz işlenmektedir:

- Kimlik: ad, soyad.
- İletişim: telefon numarası, e-posta adresi.
- Mesleki deneyim: branş, eğitim ve deneyim bilgileri, haftalık müsaitlik saatleri.
- Müşteri işlem: verdiğiniz dersler, derslerin tarih, saat ve durum bilgileri, öğrencilere yazdığınız ders yorumları.
- Finans: hizmet bedelinin ödenebilmesi için banka hesap ve IBAN bilgileri, ödeme kayıtları.
- İşlem güvenliği: IP adresi, oturum açma ve kapama kayıtları, giriş denemesi kayıtları, tarayıcı bilgisi, sözleşme onay kaydı ve onay zamanı.

Online dersler Veri Sorumlusu tarafından ses veya görüntü olarak kaydedilmemektedir. Bu metin kapsamında özel nitelikli kişisel verilerinizin (KVKK md. 6) işlenmesi öngörülmemektedir.

3. KİŞİSEL VERİLERİN İŞLENME AMAÇLARI

Kişisel verileriniz aşağıdaki amaçlarla işlenmektedir:

- Öğretmen hizmet sözleşmesinin kurulması ve ifası,
- Derslerin planlanması, öğrenci ile öğretmenin eşleştirilmesi ve ders programının yönetilmesi,
- Öğretmen paneli hesabının oluşturulması ve yönetilmesi,
- Hizmet bedellerinin hesaplanması ve ödenmesi,
- Vergi ve muhasebe mevzuatı başta olmak üzere hukuki yükümlülüklerin yerine getirilmesi,
- Bilgi güvenliğinin sağlanması, yetkisiz erişimlerin önlenmesi ve tespit edilmesi,
- Hizmet kalitesinin denetlenmesi ve geliştirilmesi,
- Öğrencilerin büyük bölümünün reşit olmaması nedeniyle güvenliklerinin sağlanması ve korunması,
- Olası uyuşmazlıkların yönetilmesi, hukuki süreçlerin takibi ve delil oluşturulması,
- Yetkili kamu kurum ve kuruluşlarının talep ve denetimlerinin karşılanması.

4. KİŞİSEL VERİ İŞLEMENİN HUKUKİ SEBEPLERİ

Kişisel verileriniz, KVKK md. 5/2'de sayılan aşağıdaki hukuki sebeplere dayanılarak işlenmektedir:

a) Bir sözleşmenin kurulması veya ifasıyla doğrudan doğruya ilgili olması kaydıyla, sözleşmenin taraflarına ait kişisel verilerin işlenmesinin gerekli olması (md. 5/2-c): kimlik, iletişim, mesleki deneyim, müşteri işlem ve finans verileriniz; derslerin planlanması, öğrenci eşleştirmesi, öğretmen paneli hesabının yönetilmesi ve ödemelerin yapılması amacıyla.

b) Veri sorumlusunun hukuki yükümlülüğünü yerine getirebilmesi için zorunlu olması (md. 5/2-ç): vergi ve muhasebe mevzuatı uyarınca tutulması gereken kimlik, finans ve müşteri işlem verileriniz ile yetkili kamu kurum ve kuruluşlarının talepleri kapsamındaki verileriniz.

c) Bir hakkın tesisi, kullanılması veya korunması için veri işlemenin zorunlu olması (md. 5/2-e): sözleşme onay kaydı ile ders ve ödeme kayıtlarınız; olası uyuşmazlıklarda hakların korunması amacıyla.

d) İlgili kişinin temel hak ve özgürlüklerine zarar vermemek kaydıyla, veri sorumlusunun meşru menfaatleri için veri işlenmesinin zorunlu olması (md. 5/2-f): işlem güvenliği kayıtlarınız (IP adresi, oturum ve giriş denemesi kayıtları, tarayıcı bilgisi); bilgi güvenliğinin sağlanması ve yetkisiz erişimlerin önlenmesi amacıyla.

Açık rızaya dayalı bir kişisel veri işleme faaliyeti yürütülmemektedir; bu nedenle sizden açık rıza talep edilmemektedir.

5. KİŞİSEL VERİLERİN AKTARILMASI

Kişisel verileriniz, yukarıda belirtilen amaçlarla ve KVKK md. 8 ve md. 9'da öngörülen şartlara uygun olarak aşağıdaki alıcı gruplarına aktarılabilmektedir:

- Kanunen yetkili kamu kurum ve kuruluşları (vergi daireleri, yargı mercileri ve kolluk kuvvetleri dahil); hukuki yükümlülük bulunması ve talep edilmesi hâlinde,
- Hukuki danışmanlar ve mali müşavirler; hukuki ve mali yükümlülüklerin yerine getirilmesi ve hakların korunması amacıyla, gerekli olduğu ölçüde,
- Hizmetin sunulması için destek alınan hizmet sağlayıcılar (barındırma, veritabanı, kimlik doğrulama, e-posta ve görüntülü görüşme hizmetleri); yalnızca hizmetin gerektirdiği ölçüde,
- Ders verdiğiniz öğrenciler ve velileri; adınız, ders bilgileriniz ve ders yorumlarınız, ders hizmetinin ifası amacıyla.

Yurt dışına aktarım (KVKK md. 9): Öğretmen paneli ve verilerinizin saklandığı altyapı; veritabanı ve kimlik doğrulama hizmetleri için Supabase, sunucu ve içerik dağıtımı hizmetleri için Vercel tarafından sağlanmaktadır. Bu hizmet sağlayıcılar yurt dışında bulunan sunucuları kullanabilmektedir. Online derslerin yürütüldüğü görüntülü görüşme hizmeti sağlayıcıları da yurt dışında bulunan sunucuları kullanabilmektedir. Kişisel verilerinizin yurt dışına aktarımı, KVKK md. 9 kapsamında uygun güvencelerden biri olan, Kişisel Verileri Koruma Kurulu tarafından ilan edilen standart sözleşmenin akdedilmesi ve Kişisel Verileri Koruma Kurumu'na bildirilmesi yoluyla gerçekleştirilmektedir.

6. KİŞİSEL VERİLERİN TOPLANMA YÖNTEMİ

Kişisel verileriniz; öğretmen paneli, e-posta, telefon ve anlık mesajlaşma uygulamaları aracılığıyla elektronik ortamda, otomatik ya da bir veri kayıt sisteminin parçası olmak kaydıyla otomatik olmayan yollarla toplanmaktadır. İşlem güvenliği kayıtları öğretmen panelinin kullanımı sırasında otomatik yollarla oluşturulmaktadır.

7. KİŞİSEL VERİLERİN SAKLANMA SÜRELERİ

Kişisel verileriniz, işlenme amaçlarının gerektirdiği ve ilgili mevzuatta öngörülen süreler boyunca saklanmaktadır:

- Sözleşme ilişkisi kapsamında işlenen veriler: sözleşme ilişkisi süresince ve sözleşmenin sona ermesinden itibaren genel zamanaşımı süresi olan 10 yıl (6098 sayılı Türk Borçlar Kanunu md. 146) boyunca. Sözleşme onay kaydı (onay tarihi ve saati, IP adresi, tarayıcı bilgisi ve onaylanan metinlerin sürümü) da bu süre boyunca saklanır.
- Vergi ve muhasebe mevzuatı uyarınca tutulması zorunlu kayıtlar: ilgili mevzuatta öngörülen süre boyunca (213 sayılı Vergi Usul Kanunu md. 253 uyarınca, ilgili oldukları yılı takip eden takvim yılından başlayarak 5 yıl).
- Öğretmen paneli denetim kayıtları (oturum açma ve kapama, panel kullanım kayıtları): 180 gün.
- Giriş denemesi kayıtları (IP adresi, giriş için kullanılan telefon numarası veya kullanıcı adı, denemenin sonucu): 30 gün.

Saklama sürelerinin sona ermesiyle kişisel verileriniz, Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hale Getirilmesi Hakkında Yönetmelik'e uygun olarak silinir, yok edilir veya anonim hâle getirilir.

8. İLGİLİ KİŞİ OLARAK HAKLARINIZ

KVKK md. 11 uyarınca Veri Sorumlusuna başvurarak:

a) Kişisel verilerinizin işlenip işlenmediğini öğrenme,
b) Kişisel verileriniz işlenmişse buna ilişkin bilgi talep etme,
c) Kişisel verilerinizin işlenme amacını ve bunların amacına uygun kullanılıp kullanılmadığını öğrenme,
ç) Yurt içinde veya yurt dışında kişisel verilerinizin aktarıldığı üçüncü kişileri bilme,
d) Kişisel verilerinizin eksik veya yanlış işlenmiş olması hâlinde bunların düzeltilmesini isteme,
e) KVKK md. 7'de öngörülen şartlar çerçevesinde kişisel verilerinizin silinmesini veya yok edilmesini isteme,
f) (d) ve (e) bentleri uyarınca yapılan işlemlerin, kişisel verilerinizin aktarıldığı üçüncü kişilere bildirilmesini isteme,
g) İşlenen verilerin münhasıran otomatik sistemler vasıtasıyla analiz edilmesi suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme,
ğ) Kişisel verilerinizin kanuna aykırı olarak işlenmesi sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme

haklarına sahipsiniz.

9. BAŞVURU YÖNTEMİ

Yukarıda sayılan haklarınıza ilişkin taleplerinizi, Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ'e uygun olarak; yazılı olarak yukarıdaki adrese bizzat veya noter aracılığıyla ya da kayıtlı elektronik posta (KEP) adresinizi, güvenli elektronik imzanızı veya mobil imzanızı kullanarak veya Veri Sorumlusunun sisteminde kayıtlı bulunan e-posta adresinizden keremunl0616@gmail.com adresine göndererek iletebilirsiniz.

Başvurunuzda adınız, soyadınız, yazılı başvurularda imzanız, T.C. kimlik numaranız (yabancılar için uyruk ile pasaport numarası veya varsa kimlik numarası), tebligata esas yerleşim yeri veya iş yeri adresiniz, varsa bildirime esas e-posta adresiniz ve telefon numaranız ile talep konunuzun bulunması gerekmektedir.

Başvurularınız, talebin niteliğine göre en kısa sürede ve en geç 30 (otuz) gün içinde ücretsiz olarak sonuçlandırılır. İşlemin ayrıca bir maliyet gerektirmesi hâlinde, Kişisel Verileri Koruma Kurulu tarafından belirlenen tarifedeki ücret alınabilir.

Başvurunuzun reddedilmesi, verilen cevabı yetersiz bulmanız veya başvurunuza süresinde cevap verilmemesi hâllerinde; cevabı öğrendiğiniz tarihten itibaren 30 (otuz) gün ve her hâlde başvuru tarihinden itibaren 60 (altmış) gün içinde Kişisel Verileri Koruma Kurulu'na şikâyette bulunabilirsiniz (KVKK md. 14).$metin$
)
ON CONFLICT (kind, version) DO NOTHING;

INSERT INTO public.teacher_legal_documents (kind, version, title, body)
VALUES (
  'hizmet_kosullari',
  1,
  'Öğretmen Paneli Hizmet ve Kullanım Koşulları',
  $metin$Son güncelleme: 17.10.2026

1. TARAFLAR VE KAPSAM

Bu Hizmet ve Kullanım Koşulları ("Koşullar"), Sherpa Akademi markasıyla eğitim hizmeti sunan Kerem Ünal ("Sherpa Akademi") ile Sherpa Akademi bünyesinde ders veren öğretmen ("Öğretmen") arasında, öğretmen panelinin ("Panel") kullanımına ilişkin hak ve yükümlülükleri düzenler.

Bu Koşullar ile taraflar arasındaki Öğretmen Hizmet Sözleşmesi ("Sözleşme") arasında çelişki bulunması hâlinde Sözleşme hükümleri esas alınır. Bu Koşullarda düzenlenmeyen hususlarda Sözleşme ve ilgili mevzuat hükümleri uygulanır.

2. HESAP GÜVENLİĞİ

- Panel hesabı Öğretmene özeldir; başkasına devredilemez, kullandırılamaz veya paylaşılamaz.
- Öğretmen, şifresinin gizliliğini korumakla ve şifresini üçüncü kişilerle paylaşmamakla yükümlüdür.
- Hesabına yetkisiz erişildiğinden veya şifresinin üçüncü kişilerce öğrenildiğinden şüphelenen Öğretmen, durumu derhal Sherpa Akademi'ye bildirir.
- Hesap üzerinden gerçekleştirilen işlemler Öğretmen tarafından gerçekleştirilmiş sayılır ve bunlardan Öğretmen sorumludur. Yetkisiz erişimin Sherpa Akademi'ye bildirilmesinden sonra gerçekleşen işlemler bu kapsamda değildir.

3. ÖĞRENCİ VERİLERİNİN GİZLİLİĞİ

- Öğretmen, Panel aracılığıyla eriştiği öğrenci ve veli bilgilerini (ad, soyad, ders bilgileri, değerlendirme ve yorumlar dahil) yalnızca ders hizmetinin yürütülmesi amacıyla kullanır.
- Bu bilgiler kopyalanamaz, indirilemez, ekran görüntüsü alınarak veya başka herhangi bir yolla kaydedilemez, üçüncü kişilerle paylaşılamaz ve kişisel amaçlarla saklanamaz.
- Öğretmen, 6698 sayılı Kişisel Verilerin Korunması Kanunu md. 12 kapsamında kişisel verilerin hukuka aykırı olarak işlenmesini ve bunlara hukuka aykırı olarak erişilmesini önlemek amacıyla Sherpa Akademi'nin belirlediği güvenlik tedbirlerine uyar.
- Öğrenci veya veli bilgilerinin yetkisiz kişilerce ele geçirildiğinden haberdar olan Öğretmen, durumu gecikmeksizin Sherpa Akademi'ye bildirir.
- Bu madde kapsamındaki gizlilik yükümlülüğü, Sözleşmenin veya Panel kullanımının herhangi bir nedenle sona ermesinden sonra da süresiz olarak devam eder.

4. REŞİT OLMAYAN ÖĞRENCİLERLE İLETİŞİM

- Öğrencilerin önemli bir kısmı reşit değildir. Öğretmen, öğrencilerle ve velileriyle yalnızca Sherpa Akademi'nin belirlediği iletişim kanalları üzerinden iletişim kurar.
- Öğretmen, ders amacı dışında öğrencilerle kişisel iletişim kurmaz; öğrencilerden kişisel telefon numarası, sosyal medya hesabı veya benzeri iletişim bilgisi talep etmez ve kendi bu tür bilgilerini öğrencilerle paylaşmaz.
- Öğretmen; derslerde ve her türlü iletişimde müstehcen, şiddet içeren, ayrımcı, aşağılayıcı veya öğrencinin yaşına uygun olmayan içerik paylaşamaz ve bu nitelikte davranışlarda bulunamaz.
- Öğretmen, bir öğrencinin güvenliğini tehlikeye düşürebilecek bir durumdan veya şüpheli bir davranıştan haberdar olduğunda bunu derhal Sherpa Akademi'ye bildirir.

5. DERS KAYITLARI

- Online dersler Sherpa Akademi tarafından ses veya görüntü olarak kaydedilmez.
- Öğretmen de dersleri, Sözleşmede öngörüldüğü üzere öğrenci ve velinin açık onayı ile Sherpa Akademi'nin yazılı izni olmaksızın kaydedemez, fotoğraflayamaz ve paylaşamaz.

6. PANEL KAYITLARININ DOĞRULUĞU

- Öğretmen, derslerin "işlendi" olarak işaretlenmesi başta olmak üzere Panel'e girdiği ders durumu bilgilerinin doğru ve zamanında girilmesinden sorumludur. Gerçeğe aykırı kayıt girilmesi bu Koşulların ihlali sayılır.
- Öğrencilere yazılan ders yorumları gerçeği yansıtır ve öğrenciye saygılı, yapıcı bir dille yazılır; öğrencinin kişiliğini hedef alan, aşağılayıcı veya dersle ilgisi olmayan ifadeler içeremez.

7. FİKRİ MÜLKİYET

Panel, Sherpa Akademi markası ve logosu, Panel'de yer alan içerikler ve yazılım üzerindeki tüm fikri ve sınai mülkiyet hakları Sherpa Akademi'ye aittir. Öğretmen, bunları Sherpa Akademi'nin yazılı izni olmaksızın çoğaltamaz, dağıtamaz, değiştiremez veya ticari amaçla kullanamaz. Bu Koşullar, Öğretmene Panel'i ders hizmetinin yürütülmesi amacıyla kullanma hakkı dışında herhangi bir hak veya lisans vermez.

8. ERİŞİMİN ASKIYA ALINMASI

Öğretmenin bu Koşulları ihlal etmesi veya ihlal ettiğine dair ciddi bir şüphe bulunması hâlinde, özellikle öğrenci güvenliğinin gerektirdiği durumlarda, Sherpa Akademi Panel'e erişimi geçici veya kalıcı olarak durdurabilir. Erişimin durdurulması, Sherpa Akademi'nin Sözleşmeden ve ilgili mevzuattan doğan diğer haklarını ortadan kaldırmaz.

9. HİZMETİN SÜREKLİLİĞİ VE SORUMLULUK

Sherpa Akademi, Panel'in kesintisiz ve hatasız çalışması için makul özeni gösterir. Bununla birlikte planlı bakım çalışmaları, teknik arızalar veya üçüncü taraf altyapı hizmet sağlayıcılarından kaynaklanan kesintiler nedeniyle Panel'e geçici olarak erişilemeyebilir. Sherpa Akademi, kastı veya ağır ihmali bulunmadıkça bu tür kesintilerden doğan zararlardan sorumlu tutulamaz.

10. DEĞİŞİKLİKLER

Sherpa Akademi bu Koşulları güncelleyebilir. Güncel sürüm, yayımlanma tarihiyle birlikte Öğretmene Panel üzerinden veya e-posta yoluyla bildirilir. Öğretmenin aleyhine olan değişiklikler, Öğretmenin onayı alınmadıkça Öğretmen bakımından hüküm doğurmaz.

11. UYGULANACAK HUKUK VE YETKİLİ MERCİLER

Bu Koşulların uygulanmasında ve yorumlanmasında Türk hukuku uygulanır. Bu Koşullardan doğan uyuşmazlıkların çözümünde İstanbul mahkemeleri ve icra daireleri yetkilidir.

12. YÜRÜRLÜK

Bu Koşullar, Öğretmenin Panel üzerinden elektronik ortamda onay vermesiyle yürürlüğe girer. Öğretmen, onay vermeden önce bu Koşulları okuduğunu ve anladığını kabul eder. Onay kaydı; onay tarihi ve saati, IP adresi, tarayıcı bilgisi ve onaylanan metnin sürümüyle birlikte saklanır.$metin$
)
ON CONFLICT (kind, version) DO NOTHING;


-- =========================================================================
-- 7) ÖĞRETMEN SÖZLEŞMESİ — ŞABLON (bilerek yorum satırı)
-- =========================================================================
-- Sözleşme seed EDİLMİYOR; metni siz ekliyorsunuz. Bu satır eklenene kadar
-- teacher_contract_status 'yok' döner ve kapı KAPALI kalır. Eklendiği an,
-- onaylamamış her öğretmen panelde onay penceresini görür.
--
-- Nasıl:
--   1. Aşağıdaki dört satırı kopyalayıp baştaki "-- " işaretlerini silin.
--   2. "...buraya yapıştırın..." yazısını SİLİP sözleşme metnini iki
--      $metin$ etiketinin ARASINA yapıştırın. Yer tutucu metinde kalırsa
--      INSERT reddedilir (teacher_legal_documents_not_placeholder).
--   3. Biçim §1'deki gibi DÜZ METİN: her paragraf tek satır, paragraflar
--      arasında boş satır, başlıklar kendi satırında, listeler "- " ile.
--      Word'den kopyalarken madde işaretleri (•) kalabilir; sorun değil.
--   4. Metni $metin$'in hemen ardından başlatın (araya satır sonu koymayın).
--
-- insert into public.teacher_legal_documents (kind, version, title, body)
-- values ('ogretmen_sozlesmesi', 1, 'Öğretmen Hizmet Sözleşmesi',
-- $metin$...buraya yapıştırın...$metin$)
-- on conflict (kind, version) do nothing;
--
-- YENİ SÜRÜM YAYINLAMAK (herhangi bir tür için)
-- Onaylanmış bir belgeyi DÜZENLEMEYİN — §3'teki tetikleyici zaten
-- engelliyor. Bir sonraki sürümü yeni satır olarak ekleyin (yer tutucu
-- yine silinmeli, yoksa INSERT reddedilir):
--
-- insert into public.teacher_legal_documents (kind, version, title, body)
-- values ('ogretmen_sozlesmesi', 2, 'Öğretmen Hizmet Sözleşmesi',
-- $metin$...buraya yapıştırın...$metin$);
--
-- Geçerli belge = en yüksek version; yeni öğretmenler v2'yi onaylar.
-- Daha önce onaylamış öğretmenlerden yeniden onay İSTENMEZ (§5); onların
-- satırı v1'i göstermeye devam eder. "Son güncelleme" satırını da
-- güncellemeyi unutmayın. Henüz KİMSENİN onaylamadığı bir sürümdeki yazım
-- hatası UPDATE ile düzeltilebilir.


-- PostgREST şema önbelleği yeni tabloları ve RPC'yi hemen görsün.
NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- DOĞRULAMA
-- =========================================================================
-- 1) Hangi öğretmen onayladı — Dashboard'dan durumu görmek için de bu.
--    Onaylamamışlar üstte. Sürüm kolonları ilk onaydaki sürümler.
-- select p.full_name,
--        p.phone,
--        (a.id is not null)  as onayladi,
--        a.accepted_at       as ilk_onay,
--        s.version           as sozlesme_surumu,
--        ay.version          as aydinlatma_surumu,
--        ko.version          as kosullar_surumu,
--        a.ip
--   from public.profiles p
--   left join lateral (
--     select x.* from public.teacher_contract_acceptances x
--      where x.teacher_id = p.id
--      order by x.accepted_at
--      limit 1
--   ) a on true
--   left join public.teacher_legal_documents s  on s.id  = a.sozlesme_id
--   left join public.teacher_legal_documents ay on ay.id = a.aydinlatma_id
--   left join public.teacher_legal_documents ko on ko.id = a.kosullar_id
--  where p.user_type = 'teacher'
--  order by onayladi, p.full_name;
--
-- 2) Her türün geçerli sürümü (ogretmen_sozlesmesi satırı yoksa kapı kapalı):
-- select distinct on (kind) kind, version, title, created_at,
--        char_length(body) as uzunluk
--   from public.teacher_legal_documents
--  order by kind, version desc;
--
-- 3) anon/authenticated'ın tablolarda yetkisi yok (0 satır):
-- select table_name, grantee, privilege_type
--   from information_schema.role_table_grants
--  where table_schema = 'public'
--    and table_name in ('teacher_legal_documents', 'teacher_contract_acceptances')
--    and grantee in ('anon', 'authenticated');
--
-- 4) RPC yalnızca servis rolüne (ve sahibine) açık:
-- select grantee from information_schema.routine_privileges
--  where routine_schema = 'public' and routine_name = 'teacher_contract_status';
--
-- 5) Değişmezlik tetikleyicisi (en az bir onay varken anlamlı; kalıcı
--    değişiklik yok):
-- begin;
-- update public.teacher_legal_documents set title = title || '.'
--  where id = (select sozlesme_id from public.teacher_contract_acceptances limit 1);
-- -- beklenen: HATA "Bu belge en az bir öğretmen tarafından onaylandı; ..."
-- rollback;
--
-- 6) Onay kaydı yalnızca ekleme (en az bir onay varken anlamlı):
-- begin;
-- update public.teacher_contract_acceptances set ip = ip
--  where id = (select id from public.teacher_contract_acceptances limit 1);
-- -- beklenen: HATA "Sözleşme onay kayıtları değiştirilemez ve silinemez; ..."
-- rollback;
