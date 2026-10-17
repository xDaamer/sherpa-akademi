import React, { Suspense, lazy, useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { Phone } from 'lucide-react';
import need from '../need.json';
import { SITE_URL } from './config';
import { WhatsAppIcon } from './components/ui/WhatsAppIcon';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { HomePage } from './pages/HomePage';
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage';
import { TermsPage } from './pages/TermsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RequireAuth } from './components/portal/RequireAuth';
import { RequireRole } from './components/portal/RequireRole';
import { CrossHostRedirect } from './components/CrossHostRedirect';
import { routingMode, panelHref, teacherPanelHref, adminPanelHref, loginHref } from './lib/host';
import { Button } from './components/ui/Button';

/*
 * PopUpForm (1073 satır) + içindeki KvkkModal ilk render'da asla görünmüyor
 * ama ana bundle'ın içindeydiler. Lighthouse bundle'ın %58'inin (117 KB)
 * kullanılmadığını ölçüyordu. React.lazy ile ayrı bir parçaya çıkıyorlar;
 * kullanıcı formu açtığında (scroll ya da butonla) indiriliyorlar.
 *
 * Suspense fallback yok (null): pop-up zaten görünmez durumdan açılıyor,
 * araya bir yükleniyor göstergesi koymak kaymaya yol açardı.
 */
const PopUpForm = lazy(() =>
  import('./components/PopUpForm').then((m) => ({ default: m.PopUpForm }))
);

/*
 * PANEL SAYFALARI AYRI PARÇALARDA.
 * Pazarlama sayfasına gelen ziyaretçi giriş, öğrenci/öğretmen/yönetim paneli
 * kodunu hiç kullanmıyor ama tek bundle'da hepsini indiriyordu (2026-10-18
 * ölçümü: index-*.js 544 kB). Her panel yalnızca o route açılınca iniyor.
 * Prerender bunlardan hiçbirini render etmiyor (yalnızca /, yasal sayfalar ve
 * 404), dolayısıyla sunucu tarafında Suspense'e düşen bir şey yok.
 */
const PortalLoginPage = lazy(() =>
  import('./pages/PortalLoginPage').then((m) => ({ default: m.PortalLoginPage }))
);
const TeacherDashboardPage = lazy(() =>
  import('./pages/TeacherDashboardPage').then((m) => ({ default: m.TeacherDashboardPage }))
);
const StudentCommentsPage = lazy(() =>
  import('./pages/StudentCommentsPage').then((m) => ({ default: m.StudentCommentsPage }))
);
const AdminPanelPage = lazy(() =>
  import('./pages/AdminPanelPage').then((m) => ({ default: m.AdminPanelPage }))
);
const PanelDispatch = lazy(() =>
  import('./components/portal/PanelDispatch').then((m) => ({ default: m.PanelDispatch }))
);

/*
 * KURULUŞ VE SİTE ŞEMALARI — MODÜL DÜZEYİNDE, ÇÜNKÜ JSX'TE RENDER EDİLİYORLAR.
 * ============================================================================
 * Eskiden bunlar bir useEffect içinde document.head'e enjekte ediliyordu.
 * useEffect SUNUCU RENDER'INDA HİÇ ÇALIŞMAZ: prerender'a geçince (bkz.
 * scripts/prerender.ts) statik HTML'de tek bir şema bulunmuyordu — yani JS
 * çalıştırmayan her tarayıcı için site yapılandırılmış veri taşımıyordu.
 *
 * Kalıp uydurulmadı, depoda zaten vardı: LegalPageChrome.tsx BreadcrumbList'i
 * aynı şekilde gövdede basıyor ve gerekçeyi yazıyor — Google ld+json bloklarını
 * <head>'de olduğu gibi gövdede de okur.
 *
 * İki nesne de yalnızca need.json ve SITE_URL'e bağlı, yani her render'da
 * yeniden kurmanın anlamı yok; modül düzeyinde bir kez kuruluyorlar.
 */
const organizationSchema = {
  "@context": "https://schema.org",
  /*
   * Tip `EducationalOrganization`: schema.org'da Organization'ın alt tipi ve
   * eğitim hizmeti veren bir kuruluşu Organization'dan daha isabetli anlatır.
   *
   * `@id` şart: paket şemalarındaki `Service.provider` bu kimliğe referans
   * verir. Eskiden sadece isimle bağlanıyordu ve grafik parçalı kalıyordu.
   */
  "@type": "EducationalOrganization",
  "@id": `${SITE_URL}/#organization`,
  "name": need.site.name,
  "url": `${SITE_URL}/`,
  "logo": `${SITE_URL}${need.site.logoUrl}`,
  "image": `${SITE_URL}/og-image.png`,
  "description": need.site.description,
  // E.164: tireli biçim yerine uluslararası standart.
  "telephone": "+905303699539",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": need.contact.address.street,
    "addressLocality": need.contact.address.city,
    "addressRegion": need.contact.address.region,
    "addressCountry": need.contact.address.country
  },
  "contactPoint": {
    "@type": "ContactPoint",
    "telephone": "+905303699539",
    "contactType": "customer service",
    "areaServed": "TR",
    "availableLanguage": ["Turkish"]
  },
  // Yalnızca gerçekten var olan hesaplar. 2026-10-18'e kadar burada açılmamış
  // YouTube/X hesapları duruyordu (YouTube adresi 404 veriyordu); var olmayan
  // bir profili sameAs ile işaret etmek kuruluş kimliğini bulanıklaştırır.
  "sameAs": Object.values(need.social)
};

/*
 * `potentialAction`/`SearchAction` kaldırıldı: sitede arama kutusu yok ve
 * `?q=` parametresini işleyen hiçbir kod yok. Var olmayan bir işlevi
 * işaretlemek yapılandırılmış veri politikası ihlali riskidir; ayrıca
 * Google Sitelinks Searchbox'ı 2024'te büyük ölçüde kullanımdan kaldırdı.
 */
const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  "name": need.site.name,
  "url": `${SITE_URL}/`,
  "inLanguage": "tr-TR",
  "publisher": { "@id": `${SITE_URL}/#organization` }
};

export default function App() {
  const [formMode, setFormMode] = useState<'scroll' | 'button' | null>(null);
  const [hasScrolledTriggered, setHasScrolledTriggered] = useState(false);
  const [activeSection, setActiveSection] = useState('ana-sayfa');
  const location = useLocation();

  /*
   * HANGİ HOST, HANGİ SAYFALAR (bkz. src/lib/host.ts)
   * -------------------------------------------------------------------------
   * 'portal' -> portal.sherpakademi.com: yalnızca panel, kökte.
   * 'main'   -> sherpakademi.com: pazarlama sayfaları + /login.
   * 'both'   -> localhost / önizleme: ikisi birden, panel /panel yolunda.
   *
   * Host sekmenin ömrü boyunca değişmediği için bir kez okunuyor.
   */
  const mode = routingMode();
  const isPortalHost = mode === 'portal';
  const isHome = !isPortalHost && location.pathname === '/';

  /*
   * Portal (giriş/kayıt) sitenin genel chrome'unu ALMAZ: header, footer,
   * "Sizi Arayalım" sekmesi, WhatsApp düğmesi ve mobil yapışkan CTA çubuğu
   * pazarlama ögeleri. Giriş yapmaya çalışan birinin ekranında işleri yok ve
   * yapışkan çubuk formun gönder butonunun üstüne oturuyordu.
   * Kök div'in mobil alt dolgusu da o çubuk için ayrılmıştı — çubuk yoksa
   * dolgu da olmamalı, aksi halde portal sayfasının altında boş bir şerit
   * kalıyor.
   *
   * Adresler taşındıktan sonra bu bayrak artık yalnızca yola bakamıyor: panel
   * kendi host'unun KÖKÜNDE (/) duruyor, giriş ekranı ise ana sitede /login
   * yolunda. Eski /portal* adresleri de (yönlendirilirken) chrome almamalı.
   *
   * /panel EŞİTLİK DEĞİL ÖNEK kontrolü: öğretmen paneli 'both' modunda
   * /panel/ogretmen yolunda duruyor ve o da bir panel ekranı — eşitlikte
   * kalsaydı yapışkan mobil CTA çubuğu öğretmen panelinin üstüne otururdu.
   */
  const isPortal =
    isPortalHost ||
    location.pathname === '/login' ||
    location.pathname.startsWith('/panel') ||
    location.pathname.startsWith('/portal');

  // AUTOMATIC POP-UP ON SCROLL DOWN (Triggers scroll mode form) — home page only
  useEffect(() => {
    if (!isHome) return;

    /*
     * Bu handler her scroll olayında dört kez getBoundingClientRect() çağırıp
     * setState ediyordu: tick başına zorunlu senkron layout, throttle yok. Aynı
     * handler 280px'te pop-up'ı da açtığı için pop-up tam bir scroll fırtınasının
     * ortasında doğuyor ve açılış animasyonu ilk karelerinde takılıyordu.
     *
     * rAF ile kareye bir kez indiriliyor; ölçümler karenin içinde kaldığı için
     * scroll başına en fazla bir layout oluyor. Bölüm elemanları da her tick'te
     * yeniden sorgulanmıyor.
     */
    const sectionIds = ['ana-sayfa', 'paketler', 'neden-biz', 'sss'];
    let sections: (HTMLElement | null)[] | null = null;
    let ticking = false;

    const update = () => {
      ticking = false;

      if (window.scrollY > 280 && !hasScrolledTriggered) {
        setFormMode('scroll');
        setHasScrolledTriggered(true);
      }

      // İlk tick'te bir kez çözülür; bölümler sayfa ömrü boyunca sabit.
      if (!sections) {
        sections = sectionIds.map((id) => document.getElementById(id));
      }

      for (let i = 0; i < sections.length; i += 1) {
        const element = sections[i];
        if (!element) continue;

        const rect = element.getBoundingClientRect();
        if (rect.top <= 200 && rect.bottom >= 100) {
          setActiveSection(sectionIds[i]);
          break;
        }
      }
    };

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [hasScrolledTriggered, isHome]);

  const handleOpenTrialForm = () => {
    setFormMode('button');
  };

  const handleCloseTrialForm = () => {
    setFormMode(null);
  };

  /*
   * Mobildeki alttan açılan sayfa yalnızca ad/telefon alan kısa bir adımdır.
   * Kişi "Gönder"e bastığında ikinci adım aynı yarım ekranda devam etmez —
   * form, ana sayfadaki "Ücretsiz Deneme Dersi" butonunun açtığı tam ekran
   * pencereye geçer. PopUpForm aradaki durumu (ad, telefon, adım) koruduğu
   * için kişi bilgilerini ikinci kez girmez.
   */
  const handleEscalateToModal = () => {
    setFormMode('button');
  };

  /*
   * Alttaki yapışkan çubuk 73px yüksekliğinde; sayfa için ayrılan boşluk ise
   * 64px'ti, yani alt bilginin son satırı çubuğun altında kalıyordu. Ayrılan
   * yer artık çubuğun gerçek yüksekliği kadar ve telefonun alt güvenli alanını
   * da (çentikli cihazlardaki ana ekran çubuğu) hesaba katıyor.
   */
  return (
    <div
      className={`min-h-screen bg-slate-50 flex flex-col font-sans selection:bg-[#B6D6CC] selection:text-[#191F61] ${
        isPortal ? '' : 'pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-0'
      }`}
    >
      <Analytics />
      <SpeedInsights />
      {/*
        KURULUŞ + SİTE ŞEMASI. Panel host'unda YAYINLANMAZ:
        portal.sherpakademi.com tamamen noindex (vercel.json'daki X-Robots-Tag) ve
        orada kuruluş/site şeması basmak, dizine girmemesi istenen bir adresi
        kanonik site gibi gösterirdi.
      */}
      {!isPortalHost && (
        <>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
          />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
          />
        </>
      )}
      {/* 1. SABİT HEADER (LOGO, YAZI, MENÜ VE BEYAZ METİNLİ MAVİ DÜĞME) */}
      {!isPortal && (
        <Header
          onOpenTrialForm={handleOpenTrialForm}
          activeSection={activeSection}
        />
      )}

      {/* 2. SAYFA İÇERİKLERİ */}
      {/*
        ROUTE AĞACI HOST'A GÖRE KURULUYOR.
        -----------------------------------------------------------------------
        Panel portal.sherpakademi.com KÖKÜNDE, giriş ekranı sherpakademi.com/login'de.
        Eski /portal ve /portal/panel adresleri bir süre canlıda yayındaydı ve
        yer imlerinde/paylaşımlarda duruyor olabilir; hepsi yeni karşılığına
        yönlendiriliyor. Aynı yönlendirmeler Vercel kenarında da (vercel.json)
        tanımlı — oradaki 308'ler JS hiç çalışmadan devreye girer, buradakiler
        ise yerel/önizleme ortamları ve uygulama içi gezinme için.
      */}
      <Suspense fallback={<div className="flex-grow" />}>
      {isPortalHost ? (
        <Routes>
          {/*
            KÖK: rolü ne olursa olsun herkes buraya düşebiliyor (yer imi, eski
            /portal* yönlendirmeleri, elle yazım). PanelDispatch öğrenciye
            kendi panelini gösteriyor, öğretmeni /ogretmen'e yolluyor.
          */}
          <Route
            path="/"
            element={
              <RequireAuth>
                <PanelDispatch />
              </RequireAuth>
            }
          />
          {/*
            ÖĞRETMEN PANELİ. RequireRole bir güvenlik sınırı DEĞİL (paketi iki
            rol de indiriyor) — asıl sınır /api/teacher'ın rol kapısı ve RLS.
            Buradaki iş yanlış kapıya gelene ne olduğunu söylemek.
          */}
          <Route
            path="/ogretmen"
            element={
              <RequireAuth>
                <RequireRole allow="teacher">
                  <TeacherDashboardPage />
                </RequireRole>
              </RequireAuth>
            }
          />
          {/*
            ÖĞRENCİNİN DERS YORUMLARI. Panelin alt sayfası — kök ekranda
            duran "Koçundan not" bölümünden buraya bağlanıyor.
          */}
          <Route
            path="/yorumlar"
            element={
              <RequireAuth>
                <RequireRole allow="student">
                  <StudentCommentsPage />
                </RequireRole>
              </RequireAuth>
            }
          />
          {/*
            YÖNETİM PANELİ. RequireRole yine bir güvenlik sınırı DEĞİL —
            /api/admin/* servis rolüyle çalıştığı için oradaki
            requireUserType("admin") sınırın tamamı.
          */}
          <Route
            path="/yonetim"
            element={
              <RequireAuth>
                <RequireRole allow="admin">
                  <AdminPanelPage />
                </RequireRole>
              </RequireAuth>
            }
          />
          {/* Eski yollar bu host'a da düşebilir (yer imi, elle yazım). */}
          <Route path="/panel" element={<Navigate to="/" replace />} />
          <Route path="/portal" element={<Navigate to="/" replace />} />
          <Route path="/portal/*" element={<Navigate to="/" replace />} />
          {/* Giriş ekranı bu host'ta YOK; ana sitede kalıyor. */}
          <Route path="/login" element={<CrossHostRedirect to={loginHref()} />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/" element={<HomePage onOpenTrialForm={handleOpenTrialForm} />} />
          <Route path="/gizlilik-politikasi" element={<PrivacyPolicyPage />} />
          <Route path="/kullanim-kosullari" element={<TermsPage />} />

          {/* GİRİŞ — ana sitede kalan tek portal sayfası. */}
          <Route path="/login" element={<PortalLoginPage />} />

          {/* Eski adresler. */}
          <Route path="/portal" element={<Navigate to="/login" replace />} />
          {/* Kayıt ekranı kaldırıldı (hesaplar elle açılıyor). Adres kısa süre
              canlıda yayındaydı; 404 yerine girişe yönlendiriliyor. */}
          <Route path="/portal/kayit" element={<Navigate to="/login" replace />} />
          <Route path="/portal/panel" element={<CrossHostRedirect to={panelHref()} />} />

          {/*
            /panel: 'both' modunda (localhost, önizleme) panelin gerçek yolu —
            orada ayrı bir host olmadığı için panel bir yerde durmak zorunda.
            Canlı ana sitede ise panel yok, bu route panel host'una atıyor.
          */}
          <Route
            path="/panel"
            element={
              mode === 'both' ? (
                <RequireAuth>
                  <PanelDispatch />
                </RequireAuth>
              ) : (
                <CrossHostRedirect to={panelHref()} />
              )
            }
          />

          {/*
            Öğretmen panelinin 'both' modundaki karşılığı. Canlı ana sitede
            panel yok, bu route öğretmen paneline (panel host'una) atıyor.
          */}
          <Route
            path="/panel/ogretmen"
            element={
              mode === 'both' ? (
                <RequireAuth>
                  <RequireRole allow="teacher">
                    <TeacherDashboardPage />
                  </RequireRole>
                </RequireAuth>
              ) : (
                <CrossHostRedirect to={teacherPanelHref()} />
              )
            }
          />

          {/*
            Panel alt sayfalarının ANA SİTEDE yazılmış hâlleri. Canlı panel
            adresleri portal.sherpakademi.com/ogretmen ve /yorumlar; birileri bu
            yolları ana siteye yazarsa 404 yerine doğru host'a gitmeli —
            /portal/panel için zaten yapılanın aynısı.
            'both' modunda bu yollar ayrı ayrı mount edilmiyor: orada panelin
            tamamı /panel altında ve aşağıdaki route'lar o işi görüyor.
          */}
          {mode !== 'both' && (
            <Route path="/ogretmen" element={<CrossHostRedirect to={teacherPanelHref()} />} />
          )}
          {mode !== 'both' && (
            <Route path="/yorumlar" element={<CrossHostRedirect to={panelHref()} />} />
          )}
          {mode !== 'both' && (
            <Route path="/yonetim" element={<CrossHostRedirect to={adminPanelHref()} />} />
          )}

          {/* Ders yorumlarının 'both' modundaki karşılığı. */}
          <Route
            path="/panel/yorumlar"
            element={
              mode === 'both' ? (
                <RequireAuth>
                  <RequireRole allow="student">
                    <StudentCommentsPage />
                  </RequireRole>
                </RequireAuth>
              ) : (
                <CrossHostRedirect to={panelHref()} />
              )
            }
          />

          {/* Yönetim panelinin 'both' modundaki karşılığı. */}
          <Route
            path="/panel/yonetim"
            element={
              mode === 'both' ? (
                <RequireAuth>
                  <RequireRole allow="admin">
                    <AdminPanelPage />
                  </RequireRole>
                </RequireAuth>
              ) : (
                <CrossHostRedirect to={adminPanelHref()} />
              )
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      )}
      </Suspense>

      {/* 3. FOOTER BÖLÜMÜ */}
      {!isPortal && <Footer onOpenTrialForm={handleOpenTrialForm} />}

      {/* 4. ÇİFT MODLU DENEME DERSİ FORMU */}
      {/* formMode null iken hiç mount edilmiyor: parçanın indirilmesi de
          kullanıcı formu ilk kez açana kadar ertelenir. */}
      {formMode !== null && !isPortal && (
        <Suspense fallback={null}>
          <PopUpForm
            isOpen
            mode={formMode}
            onClose={handleCloseTrialForm}
            onEscalateToModal={handleEscalateToModal}
          />
        </Suspense>
      )}

      {/* 5. SAĞ TARAF: ARAYALIM SEKMESİ (SABIT) — YALNIZCA MASAÜSTÜ */}
      {/*
        Görünürlük sekmenin kendisinde değil, bu sarmalayıcıda: Button'ın temel
        sınıfları arasında `inline-flex` var ve `hidden` ile aynı özgüllükte
        olduğu için className'e yazılan `hidden` kaybediyordu — sekme telefonda
        da ekranın sağ kenarında duruyordu. Sarmalayıcı div'de böyle bir çakışma
        yok. (Bkz. Button.tsx: projede tailwind-merge yok, ezme güvenilir değil.)
        Kırılma noktası bilerek `sm`: kodun en başından beri yazdığı değer buydu,
        yalnızca hiç uygulanamıyordu.
      */}
      {!isPortal && (
        <div className="fixed right-0 top-1/2 -translate-y-1/2 z-40 hidden sm:block">
          {/* Kendi biçimi olduğu için size="none": renk/hover/odak varyanttan gelir. */}
          <Button
            size="none"
            onClick={handleOpenTrialForm}
            className="flex flex-col px-4 py-10 rounded-l-2xl"
          >
            <Phone className="w-6 h-6" />
            <span
              className="text-[11px] font-bold whitespace-nowrap"
              style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
            >
              Sizi Arayalım
            </span>
          </Button>
        </div>
      )}

      {/* 6. SAĞ ALT: WHATSAPP BUTONU (SABIT) */}
      {!isPortal && (
        <div className="fixed bottom-24 sm:bottom-6 right-6 z-40 group">
          <a
            href={need.contact.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="WhatsApp'tan yazın"
            className="bg-green-500 hover:bg-green-600 text-white p-3 rounded-full shadow-lg transition-all duration-300 transform hover:scale-110 active:scale-95 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c5a059] focus-visible:ring-offset-2"
          >
            <WhatsAppIcon className="w-8 h-8" />
          </a>

          {/* WHATSAPP TOOLTIP */}
          <div className="absolute bottom-20 right-0 bg-slate-800 text-white text-sm font-semibold px-4 py-2.5 rounded-xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            Detaylı bilgi al
            <div className="absolute -bottom-2 right-4 w-4 h-4 bg-slate-800 transform rotate-45" />
          </div>
        </div>
      )}

      {/* 7. MOBİL YAPIŞKAN CTA BAR */}
      {!isPortal && (
        <div className="fixed bottom-0 inset-x-0 z-40 sm:hidden bg-white border-t border-slate-200 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Button fullWidth size="lg" onClick={handleOpenTrialForm}>
            Ücretsiz Deneme Dersi Al
          </Button>
        </div>
      )}
    </div>
  );
}

