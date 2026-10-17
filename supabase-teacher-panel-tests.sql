-- =============================================================================
-- ÖĞRETMEN PANELİ — RLS GÜVENLİK TESTLERİ
-- =============================================================================
-- Supabase SQL Editor'de OLDUĞU GİBİ çalıştırın. Tamamı BEGIN ... ROLLBACK
-- içinde: canlı veritabanında KALICI HİÇBİR DEĞİŞİKLİK BIRAKMAZ. Test
-- kullanıcıları, dersleri ve yorumları işlem içinde kurulur ve geri alınır.
--
-- SON ÇALIŞTIRMA: 2026-09-11 — 27 doğrulamanın 27'si GEÇTİ. (Ölçüm iki
-- turda yapıldı: 1-16 ilk sürümle, 17-27 ile 1/10'un yeni beklentileri
-- iptal dersi fixture'ı eklendikten sonra; dosyanın tamamı tek script
-- olarak henüz koşulmadı — SQL Editor'de bir kez çalıştırıp doğrulayın.)
--
-- 28-32 numaralı testler 2026-09-24'te öğretmenin kendi öğrencisine ders
-- açması için eklendi. 2026-10-09'da o yetki kaldırıldı (supabase-teacher-
-- panel.sql §5): artık BEŞİ DE RED bekliyor — 28 dahil, yetkinin gerçekten
-- gittiğini kanıtlayan test o. HENÜZ ÇALIŞTIRILMADI — §5'i uyguladıktan
-- sonra bu dosyayı SQL Editor'de çalıştırıp bu notu gerçek sonuçla
-- güncelleyin.
--
-- 33-35 numaralı testler 2026-10-09'da öğretmen açıklaması için eklendi
-- (supabase-teacher-descriptions.sql): öğretmen ve öğrenci tabloyu OKUYAMAZ
-- ve YAZAMAZ, üçü de RED bekliyor. HENÜZ ÇALIŞTIRILMADI.
--
-- 36-38 numaralı testler 2026-10-17'de öğretmen sözleşmesi için eklendi
-- (supabase-teacher-contract.sql): öğretmen sözleşme belgelerini OKUYAMAZ,
-- kendi onay kaydını YAZAMAZ ve durum RPC'sini ÇAĞIRAMAZ — üçü de RED
-- bekliyor ve bu üçünde YALNIZCA 42501 geçiyor sayılıyor (37'de bir FK ya
-- da belge türü hatası sahte bir geçiş olurdu). HENÜZ ÇALIŞTIRILMADI.
--
-- BAĞIMLILIK: dosya iki migration'ın uygulanmış olmasını gerektiriyor —
-- supabase-teacher-descriptions.sql (33-35 fixture'ı) ve supabase-teacher-
-- contract.sql (36-38 fixture'ı). Biri eksikse dosya o fixture'ın
-- INSERT'inde durur (42P01) ve hiçbir test sonucu yazılmaz.
--
-- SQL EDITOR'ÜN "RLS YOK" UYARISI BEKLENEN DURUM: editör, RLS açılmadan
-- oluşturulan her tabloyu işaretliyor ve TEMP tabloyu ayırt etmiyor.
-- Buradaki sonuc/k/b/d geçici tablolar: yalnızca bu oturumun pg_temp
-- şemasında duruyorlar, API'ye açık değiller ve ROLLBACK ile siliniyorlar.
-- "Run this query" ile devam edin. sonuc'a RLS AÇMAYIN: authenticated'a
-- geçildikten sonra sonuç yazabilmek için ona INSERT izni verildi, politikasız
-- bir RLS bu yazmaları engeller ve test hiçbir sonuç kaydedemez.
--
-- ---------------------------------------------------------------------------
-- NEDEN BURADA, ARAYÜZDE DEĞİL
-- ---------------------------------------------------------------------------
-- Öğretmen panelinin güvenlik sınırı ARAYÜZDE DEĞİL, iki yerde:
--
--   1. Rol kapısı (server/roles.ts)  -> "burası senin panelin değil" (403)
--   2. RLS politikaları              -> "bu satır senin değil" (satır gelmez)
--
-- Birincisi kaldırılsa veri yine sızmaz; ikincisi kaldırılsa sızar. Bu yüzden
-- asıl testler burada: rol taklit edilip veritabanına doğrudan soruluyor.
-- Tarayıcıdan yapılan bir test, araya giren her katmanın doğru çalışmasına
-- bağlı olduğu için hangi katmanın koruduğunu SÖYLEYEMEZ.
--
-- Arayüz/HTTP tarafı (403'ler, yönlendirmeler) ayrıca elle test edilmeli —
-- yöntemi CLAUDE.md'de "Öğretmen paneli testleri" başlığı altında.
--
-- ---------------------------------------------------------------------------
-- ROL TAKLİDİ NASIL ÇALIŞIYOR
-- ---------------------------------------------------------------------------
-- Supabase'de auth.uid(), request.jwt.claims içindeki `sub` alanını okuyor.
-- set_config ile o alanı ve rolü ayarlamak, PostgREST'ten gelen gerçek bir
-- isteğin gördüğü koşulların aynısını üretiyor. Gerçek bir jeton veya şifre
-- gerekmiyor — RLS jetonu değil, jetonun içindeki kimliği kullanıyor.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE sonuc (no int, test text, beklenen text, alinan text, gecti bool);
-- authenticated rolüne geçtikten sonra da yazabilmek için gerekli; aksi halde
-- test kendi sonucunu kaydedemez (42501).
GRANT INSERT, SELECT ON sonuc TO authenticated;

CREATE TEMP TABLE k (ad text PRIMARY KEY, id uuid);
INSERT INTO k VALUES
  ('ogretmenA','aaaaaaaa-0000-0000-0000-000000000001'),
  ('ogretmenB','bbbbbbbb-0000-0000-0000-000000000002'),
  ('ogrenci1', 'cccccccc-0000-0000-0000-000000000003'),
  ('ogrenci2', 'dddddddd-0000-0000-0000-000000000004');

-- auth.users satırları yalnızca FK'ler için; şifre alanı anlamsız bir değer,
-- çünkü bu testte hiç giriş yapılmıyor.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       ad || '@test.local', 'x', now(), now()
FROM k;

INSERT INTO public.profiles (id, full_name, phone, user_type) VALUES
  ((SELECT id FROM k WHERE ad='ogretmenA'), 'Ogretmen A',  '05550000001', 'teacher'),
  ((SELECT id FROM k WHERE ad='ogretmenB'), 'Ogretmen B',  '05550000002', 'teacher'),
  ((SELECT id FROM k WHERE ad='ogrenci1'),  'Ogrenci Bir', '05550000003', 'student'),
  ((SELECT id FROM k WHERE ad='ogrenci2'),  'Ogrenci Iki', '05550000004', 'student');

-- 33-35 icin: A'nin yoneticinin yazdigi bir aciklamasi var (supabase-teacher-
-- descriptions.sql uygulanmis olmali, yoksa dosya burada durur).
INSERT INTO public.teacher_descriptions (teacher_id, description)
VALUES ((SELECT id FROM k WHERE ad='ogretmenA'), 'TYT Matematik');

-- 36-38 icin: her turden birer belge (supabase-teacher-contract.sql
-- uygulanmis olmali, yoksa dosya burada durur). Test 37'deki INSERT'e izin
-- verilseydi FK'leri VE belge turu tetikleyicisini gececek gercek kimlikler:
-- rastgele kimlikle RED yetkiden degil FK (23503) ya da tur (23514)
-- hatasindan gelir ve test SAHTE gecerdi. version 9999: gercek satirlarla
-- (kind, version) cakismasin diye. Hicbir onay satiri bunlari gostermedigi
-- icin degismezlik tetikleyicisine takilmaz; ROLLBACK ile gider.
CREATE TEMP TABLE b (ad text PRIMARY KEY, id uuid);
INSERT INTO b VALUES ('sozlesme',  'eeeeeeee-0000-0000-0000-000000000001'),
                     ('aydinlatma','eeeeeeee-0000-0000-0000-000000000002'),
                     ('kosullar',  'eeeeeeee-0000-0000-0000-000000000003');

INSERT INTO public.teacher_legal_documents (id, kind, version, title, body) VALUES
  ((SELECT id FROM b WHERE ad='sozlesme'),   'ogretmen_sozlesmesi', 9999, 'Test sozlesme',   'Test metni'),
  ((SELECT id FROM b WHERE ad='aydinlatma'), 'kvkk_aydinlatma',     9999, 'Test aydinlatma', 'Test metni'),
  ((SELECT id FROM b WHERE ad='kosullar'),   'hizmet_kosullari',    9999, 'Test kosullar',   'Test metni');

CREATE TEMP TABLE d (ad text PRIMARY KEY, id uuid);
INSERT INTO d VALUES ('A1','11111111-0000-0000-0000-000000000001'),
                     ('A2','11111111-0000-0000-0000-000000000002'),
                     ('AIPTAL','11111111-0000-0000-0000-000000000009'),
                     ('B1','22222222-0000-0000-0000-000000000001');

-- A1: A'nin tamamlanmis dersi | A2: A'nin planli dersi
-- AIPTAL: A'nin IPTAL dersi (ogretmen dokunamamali) | B1: B'nin dersi
INSERT INTO public.lessons (id, user_id, teacher_id, subject, starts_at, ends_at, status) VALUES
  ((SELECT id FROM d WHERE ad='A1'), (SELECT id FROM k WHERE ad='ogrenci1'),
   (SELECT id FROM k WHERE ad='ogretmenA'), 'Matematik',
   now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'completed'),
  ((SELECT id FROM d WHERE ad='A2'), (SELECT id FROM k WHERE ad='ogrenci1'),
   (SELECT id FROM k WHERE ad='ogretmenA'), 'Fizik',
   now() + interval '1 day', now() + interval '1 day' + interval '1 hour', 'scheduled'),
  ((SELECT id FROM d WHERE ad='AIPTAL'), (SELECT id FROM k WHERE ad='ogrenci1'),
   (SELECT id FROM k WHERE ad='ogretmenA'), 'Biyoloji',
   now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'cancelled'),
  ((SELECT id FROM d WHERE ad='B1'), (SELECT id FROM k WHERE ad='ogrenci2'),
   (SELECT id FROM k WHERE ad='ogretmenB'), 'Kimya',
   now() - interval '1 day', now() - interval '1 day' + interval '1 hour', 'completed');

DO $$
DECLARE
  tA uuid; tB uuid; s1 uuid; s2 uuid;
  dA1 uuid; dA2 uuid; dB1 uuid; dIptal uuid;
  bS uuid; bA uuid; bK uuid;
  n int;
BEGIN
  SELECT id INTO tA  FROM k WHERE ad='ogretmenA';
  SELECT id INTO tB  FROM k WHERE ad='ogretmenB';
  SELECT id INTO s1  FROM k WHERE ad='ogrenci1';
  SELECT id INTO s2  FROM k WHERE ad='ogrenci2';
  SELECT id INTO dA1 FROM d WHERE ad='A1';
  SELECT id INTO dA2 FROM d WHERE ad='A2';
  SELECT id INTO dB1 FROM d WHERE ad='B1';
  SELECT id INTO dIptal FROM d WHERE ad='AIPTAL';
  SELECT id INTO bS FROM b WHERE ad='sozlesme';
  SELECT id INTO bA FROM b WHERE ad='aydinlatma';
  SELECT id INTO bK FROM b WHERE ad='kosullar';

  -- ======================================================== ÖĞRETMEN A GİBİ
  PERFORM set_config('role','authenticated',true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',tA,'role','authenticated')::text, true);

  SELECT count(*) INTO n FROM public.lessons;
  INSERT INTO sonuc VALUES (1,'OgretmenA kac ders goruyor','3 (A1, A2, iptal)', n::text, n=3);

  -- Planin 1. senaryosu: baska ogretmenin programina erisim.
  SELECT count(*) INTO n FROM public.lessons WHERE id = dB1;
  INSERT INTO sonuc VALUES (2,'OgretmenA, OgretmenB dersini goruyor mu','0', n::text, n=0);

  -- profiles_select_as_teacher: erisim ROLE degil DERSE bagli.
  SELECT count(*) INTO n FROM public.profiles WHERE id = s1;
  INSERT INTO sonuc VALUES (3,'OgretmenA kendi ogrencisinin profilini','1', n::text, n=1);

  SELECT count(*) INTO n FROM public.profiles WHERE id = s2;
  INSERT INTO sonuc VALUES (4,'OgretmenA baska ogrencinin profilini','0', n::text, n=0);

  BEGIN
    INSERT INTO public.lesson_comments (lesson_id, teacher_id, comment)
    VALUES (dA1, tA, 'Ilk yorum')
    ON CONFLICT (lesson_id) DO UPDATE SET comment = excluded.comment;
    INSERT INTO sonuc VALUES (5,'OgretmenA kendi dersine yorum','izin','izin', true);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (5,'OgretmenA kendi dersine yorum','izin','RED '||sqlstate, false);
  END;

  -- Planin 1./IDOR senaryosu: baska ogretmenin dersine yorum.
  BEGIN
    INSERT INTO public.lesson_comments (lesson_id, teacher_id, comment)
    VALUES (dB1, tA, 'Izinsiz yorum');
    INSERT INTO sonuc VALUES (6,'OgretmenA, OgretmenB dersine yorum','RED','IZIN VERILDI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (6,'OgretmenA, OgretmenB dersine yorum','RED','RED '||sqlstate, true);
  END;

  -- Planin 4. senaryosu: ayni derse tekrar yorum -> hep TEK satir.
  BEGIN
    INSERT INTO public.lesson_comments (lesson_id, teacher_id, comment)
    VALUES (dA1, tA, 'Ikinci yorum')
    ON CONFLICT (lesson_id) DO UPDATE SET comment = excluded.comment;
  EXCEPTION WHEN others THEN NULL;
  END;

  PERFORM set_config('role','postgres',true);
  SELECT count(*) INTO n FROM public.lesson_comments WHERE lesson_id = dA1;
  INSERT INTO sonuc VALUES (7,'Ayni derse 2 yorum sonrasi satir sayisi','1', n::text, n=1);

  SELECT count(*) INTO n FROM public.lesson_comments WHERE lesson_id = dA1 AND comment='Ikinci yorum';
  INSERT INTO sonuc VALUES (8,'Son yorum ustune yazildi mi','1', n::text, n=1);

  -- ======================================================== ÖĞRETMEN B GİBİ
  PERFORM set_config('role','authenticated',true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',tB,'role','authenticated')::text, true);

  SELECT count(*) INTO n FROM public.lesson_comments WHERE lesson_id = dA1;
  INSERT INTO sonuc VALUES (9,'OgretmenB, A nin yorumunu goruyor mu','0', n::text, n=0);

  -- ========================================================= ÖĞRENCİ 1 GİBİ
  PERFORM set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated')::text, true);

  SELECT count(*) INTO n FROM public.lessons;
  INSERT INTO sonuc VALUES (10,'Ogrenci1 kac ders goruyor','3 (kendi)', n::text, n=3);

  SELECT count(*) INTO n FROM public.lesson_comments WHERE lesson_id = dA1;
  INSERT INTO sonuc VALUES (11,'Ogrenci1 kendi dersinin yorumunu','1', n::text, n=1);

  -- Planin 5. senaryosu: baska ogrencinin lessonId'si.
  SELECT count(*) INTO n FROM public.lesson_comments WHERE lesson_id = dB1;
  INSERT INTO sonuc VALUES (12,'Ogrenci1 baskasinin ders yorumunu','0', n::text, n=0);

  BEGIN
    INSERT INTO public.lesson_comments (lesson_id, teacher_id, comment) VALUES (dA2, s1, 'Ogrenci yazdi');
    INSERT INTO sonuc VALUES (13,'Ogrenci yorum YAZABILIYOR mu','RED','YAZDI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (13,'Ogrenci yorum YAZABILIYOR mu','RED','RED '||sqlstate, true);
  END;

  BEGIN
    UPDATE public.lesson_comments SET comment='Ogrenci degistirdi' WHERE lesson_id = dA1;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO sonuc VALUES (14,'Ogrenci yorumu DEGISTIREBILIYOR mu','0 satir', n::text||' satir', n=0);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (14,'Ogrenci yorumu DEGISTIREBILIYOR mu','0 satir','RED '||sqlstate, true);
  END;

  -- Yetki yukseltme: user_type profiles_update_own ile sabitlenmis olmali.
  BEGIN
    UPDATE public.profiles SET user_type='teacher' WHERE id = s1;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO sonuc VALUES (15,'Ogrenci kendini ogretmen yapabiliyor mu','RED', n::text||' satir', n=0);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (15,'Ogrenci kendini ogretmen yapabiliyor mu','RED','RED '||sqlstate, true);
  END;

  -- ================================ DERS DURUMU: "İŞLENDİ" İŞARETLEMESİ
  -- Bu blok iki kısıtı birlikte sınıyor: kolon bazlı GRANT UPDATE (status)
  -- ve lessons_update_status_as_teacher politikası. Politikayı bırakıp kolon
  -- yetkisini kaldırmak (ya da tersi) testlerden BİRİNİ geçirir, hepsini
  -- değil — ikisinin de gerekli olmasının ölçüsü bu.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',tA,'role','authenticated')::text, true);

  BEGIN
    UPDATE public.lessons SET status='completed' WHERE id=dA2;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO sonuc VALUES (17,'OgretmenA kendi dersini isledi yapma','1 satir', n||' satir', n=1);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (17,'OgretmenA kendi dersini isledi yapma','1 satir','RED '||sqlstate, false);
  END;

  BEGIN
    UPDATE public.lessons SET status='scheduled' WHERE id=dA2;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO sonuc VALUES (18,'Geri alma (completed -> scheduled)','1 satir', n||' satir', n=1);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (18,'Geri alma (completed -> scheduled)','1 satir','RED '||sqlstate, false);
  END;

  BEGIN
    UPDATE public.lessons SET status='completed' WHERE id=dB1;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO sonuc VALUES (19,'Baska ogretmenin dersini isaretleme','0 satir', n||' satir', n=0);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (19,'Baska ogretmenin dersini isaretleme','0 satir','RED '||sqlstate, true);
  END;

  BEGIN
    UPDATE public.lessons SET status='completed' WHERE id=dIptal;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO sonuc VALUES (20,'Iptal dersi diriltme','0 satir', n||' satir', n=0);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (20,'Iptal dersi diriltme','0 satir','RED '||sqlstate, true);
  END;

  BEGIN
    UPDATE public.lessons SET status='cancelled' WHERE id=dA2;
    INSERT INTO sonuc VALUES (21,'Kendi dersini cancelled yapma','RED','GECTI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (21,'Kendi dersini cancelled yapma','RED','RED '||sqlstate, true);
  END;

  -- Kolon yetkisinin islevi: status DISINDAKI her kolon 42501.
  BEGIN
    UPDATE public.lessons SET subject='Ele gecirildi' WHERE id=dA2;
    INSERT INTO sonuc VALUES (22,'subject degistirme','RED','GECTI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (22,'subject degistirme','RED','RED '||sqlstate, true);
  END;

  BEGIN
    UPDATE public.lessons SET user_id=tA WHERE id=dA2;
    INSERT INTO sonuc VALUES (23,'user_id degistirme (dersi tasima)','RED','GECTI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (23,'user_id degistirme (dersi tasima)','RED','RED '||sqlstate, true);
  END;

  BEGIN
    UPDATE public.lessons SET teacher_id=tA WHERE id=dB1;
    INSERT INTO sonuc VALUES (24,'teacher_id degistirme (ders calma)','RED','GECTI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (24,'teacher_id degistirme (ders calma)','RED','RED '||sqlstate, true);
  END;

  BEGIN
    UPDATE public.lessons SET starts_at=now() WHERE id=dA2;
    INSERT INTO sonuc VALUES (25,'starts_at degistirme','RED','GECTI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (25,'starts_at degistirme','RED','RED '||sqlstate, true);
  END;

  BEGIN
    DELETE FROM public.lessons WHERE id=dA2;
    INSERT INTO sonuc VALUES (26,'Ogretmen ders silme','RED','SILDI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (26,'Ogretmen ders silme','RED','RED '||sqlstate, true);
  END;

  -- ============================================ ÖĞRETMEN DERS AÇAMAZ
  -- 2026-09-24'te açılan yetki 2026-10-09'da kaldırıldı (lessons'a INSERT
  -- yetkisi ve lessons_insert_as_teacher yok). Beklenen: hepsi 42501.
  -- Hâlâ ÖĞRETMEN A kimliğindeyiz (yukarıdaki UPDATE testleriyle aynı context).
  BEGIN
    INSERT INTO public.lessons (user_id, teacher_id, teacher_name, subject, starts_at, status)
    VALUES (s1, tA, 'Ogretmen A', 'Yeni ders', now() + interval '2 days', 'scheduled');
    INSERT INTO sonuc VALUES (28,'OgretmenA kendi ogrencisine ders acma','RED','IZIN VERILDI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (28,'OgretmenA kendi ogrencisine ders acma','RED','RED '||sqlstate, true);
  END;

  -- Hic ortak dersi olmayan (OgretmenB'nin) ogrencisine.
  BEGIN
    INSERT INTO public.lessons (user_id, teacher_id, teacher_name, subject, starts_at, status)
    VALUES (s2, tA, 'Ogretmen A', 'Izinsiz ders', now() + interval '2 days', 'scheduled');
    INSERT INTO sonuc VALUES (29,'OgretmenA, OgretmenB nin ogrencisine ders acma','RED','IZIN VERILDI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (29,'OgretmenA, OgretmenB nin ogrencisine ders acma','RED','RED '||sqlstate, true);
  END;

  -- Baskasi adina (teacher_id=tB) ders acma denemesi -- kendi ogrencisi olsa bile.
  BEGIN
    INSERT INTO public.lessons (user_id, teacher_id, teacher_name, subject, starts_at, status)
    VALUES (s1, tB, 'Ogretmen B', 'Baskasi adina', now() + interval '2 days', 'scheduled');
    INSERT INTO sonuc VALUES (30,'OgretmenA, OgretmenB adina ders acma','RED','IZIN VERILDI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (30,'OgretmenA, OgretmenB adina ders acma','RED','RED '||sqlstate, true);
  END;

  -- 'cancelled' durumuyla acma denemesi -- iptal bir yonetim karari, olusturmada da kapali.
  BEGIN
    INSERT INTO public.lessons (user_id, teacher_id, teacher_name, subject, starts_at, status)
    VALUES (s1, tA, 'Ogretmen A', 'Iptal ders', now() + interval '2 days', 'cancelled');
    INSERT INTO sonuc VALUES (31,'OgretmenA cancelled durumla ders acma','RED','IZIN VERILDI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (31,'OgretmenA cancelled durumla ders acma','RED','RED '||sqlstate, true);
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated')::text, true);
  BEGIN
    UPDATE public.lessons SET status='completed' WHERE id=dA2;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO sonuc VALUES (27,'Ogrenci kendi dersini isledi yapma','0 satir', n||' satir', n=0);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (27,'Ogrenci kendi dersini isledi yapma','0 satir','RED '||sqlstate, true);
  END;

  -- Ogrenci kendi adina INSERT ile ders acmaya calisiyor -- bu uc hicbir ogrenciye acik degil.
  BEGIN
    INSERT INTO public.lessons (user_id, teacher_id, teacher_name, subject, starts_at, status)
    VALUES (s1, s1, 'Sahte', 'Ogrenci acti', now() + interval '2 days', 'scheduled');
    INSERT INTO sonuc VALUES (32,'Ogrenci kendi dersini INSERT ile acma','RED','ACTI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (32,'Ogrenci kendi dersini INSERT ile acma','RED','RED '||sqlstate, true);
  END;

  -- ========================================================= ÖĞRENCİ 2 GİBİ
  PERFORM set_config('request.jwt.claims', json_build_object('sub',s2,'role','authenticated')::text, true);

  SELECT count(*) INTO n FROM public.profiles;
  INSERT INTO sonuc VALUES (16,'Ogrenci2 kac profil goruyor','1 (kendi)', n::text, n=1);

  -- =========================================== ÖĞRETMEN AÇIKLAMASI (33-35)
  -- supabase-teacher-descriptions.sql: tablo authenticated'a HİÇ açık değil.
  -- "0 satır" değil RED bekleniyor — öğretmen KENDİ açıklamasını da okuyamamalı.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',tA,'role','authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM public.teacher_descriptions WHERE teacher_id = tA;
    INSERT INTO sonuc VALUES (33,'OgretmenA kendi aciklamasini okuma','RED', n||' satir okudu', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (33,'OgretmenA kendi aciklamasini okuma','RED','RED '||sqlstate, true);
  END;

  BEGIN
    INSERT INTO public.teacher_descriptions (teacher_id, description) VALUES (tA, 'Kendi yazdi')
    ON CONFLICT (teacher_id) DO UPDATE SET description = excluded.description;
    INSERT INTO sonuc VALUES (34,'OgretmenA kendi aciklamasini yazma','RED','YAZDI!', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (34,'OgretmenA kendi aciklamasini yazma','RED','RED '||sqlstate, true);
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM public.teacher_descriptions;
    INSERT INTO sonuc VALUES (35,'Ogrenci ogretmen aciklamalarini okuma','RED', n||' satir okudu', false);
  EXCEPTION WHEN others THEN
    INSERT INTO sonuc VALUES (35,'Ogrenci ogretmen aciklamalarini okuma','RED','RED '||sqlstate, true);
  END;

  -- ========================================== ÖĞRETMEN SÖZLEŞMESİ (36-38)
  -- supabase-teacher-contract.sql: belgeler, onay kaydı ve durum RPC'si
  -- authenticated'a HİÇ açık değil; onay kaydını yalnızca servis rolü
  -- (sunucu) yazar. Öğretmen kendi onayını kendi jetonuyla yazabilseydi
  -- IP'yi, zamanı ve sürümü sahteleyebilirdi. 33-35'ten farkı: burada
  -- yalnızca 42501 (insufficient_privilege) geçiyor; başka her hata KALDI.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',tA,'role','authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM public.teacher_legal_documents;
    INSERT INTO sonuc VALUES (36,'OgretmenA sozlesme belgelerini okuma','RED 42501', n||' satir okudu', false);
  EXCEPTION
    WHEN insufficient_privilege THEN
      INSERT INTO sonuc VALUES (36,'OgretmenA sozlesme belgelerini okuma','RED 42501','RED '||sqlstate, true);
    WHEN others THEN
      INSERT INTO sonuc VALUES (36,'OgretmenA sozlesme belgelerini okuma','RED 42501','RED '||sqlstate, false);
  END;

  -- Fixture belgeleriyle: izin verilseydi bu INSERT FK'leri ve belge turu
  -- tetikleyicisini gecerdi (bkz. DO blogundan onceki fixture notu).
  BEGIN
    INSERT INTO public.teacher_contract_acceptances
      (teacher_id, sozlesme_id, aydinlatma_id, kosullar_id,
       aydinlatma_okundu, kosullar_kabul, ip, user_agent)
    VALUES (tA, bS, bA, bK, true, true, '203.0.113.7', 'sahte tarayici');
    INSERT INTO sonuc VALUES (37,'OgretmenA kendi onay kaydini yazma','RED 42501','YAZDI!', false);
  EXCEPTION
    WHEN insufficient_privilege THEN
      INSERT INTO sonuc VALUES (37,'OgretmenA kendi onay kaydini yazma','RED 42501','RED '||sqlstate, true);
    WHEN others THEN
      INSERT INTO sonuc VALUES (37,'OgretmenA kendi onay kaydini yazma','RED 42501','RED '||sqlstate, false);
  END;

  BEGIN
    PERFORM public.teacher_contract_status(tA);
    INSERT INTO sonuc VALUES (38,'OgretmenA sozlesme durumunu RPC ile sorgulama','RED 42501','CAGIRDI!', false);
  EXCEPTION
    WHEN insufficient_privilege THEN
      INSERT INTO sonuc VALUES (38,'OgretmenA sozlesme durumunu RPC ile sorgulama','RED 42501','RED '||sqlstate, true);
    WHEN others THEN
      INSERT INTO sonuc VALUES (38,'OgretmenA sozlesme durumunu RPC ile sorgulama','RED 42501','RED '||sqlstate, false);
  END;

  PERFORM set_config('role','postgres',true);
END $$;

SELECT no, test, beklenen, alinan,
       CASE WHEN gecti THEN 'GECTI' ELSE 'KALDI' END AS durum
FROM sonuc ORDER BY no;

-- KALICI DEĞİŞİKLİK YOK. Bu satırı COMMIT ile değiştirmeyin — test verisi
-- canlı veritabanında kalır ve 05550000xx numaralı sahte profiller oluşur.
ROLLBACK;
