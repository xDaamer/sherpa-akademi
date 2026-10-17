import React from 'react';
import { Link } from 'react-router-dom';
import { Phone, MapPin } from 'lucide-react';
import logoGradient from '../assets/logo-gradient.png';
import need from '../../need.json';
import { Button } from './ui/Button';

interface FooterProps {
  onOpenTrialForm: () => void;
}

/*
 * Bölüm bağlantıları düz `<a href="#paketler">` DEĞİL, `<Link to="/" state=…>`.
 * -----------------------------------------------------------------------------
 * Footer her sayfada ortak. Yasal sayfalarda `#paketler` diye bir element
 * olmadığı için eski düz çapa bağlantıları oralarda HİÇBİR ŞEY yapmıyordu.
 * Header aynı problemi `navigate('/', { state: { scrollTo } })` ile çözmüştü;
 * footer bu mantığı hiç almamıştı. `Link` hem her sayfadan çalışır hem de
 * DOM'da taranabilir bir `href` üretir.
 */
const sectionLinks = [
  { id: 'ana-sayfa', label: 'Ana Sayfa' },
  { id: 'paketler', label: 'Paketler & Fiyatlar' },
  { id: 'neden-biz', label: 'Neden Sherpa Akademi?' },
  { id: 'sss', label: 'Sıkça Sorulan Sorular' },
];

/*
 * "Programlarımız" sitenin en kelime zengini metniydi ve hiçbir yere
 * bağlanmıyordu — üstelik yanındaki sütun bağlantı olduğu için kullanıcıya
 * bağlantı gibi görünüyor ama tıklanmıyordu. Artık her biri ilgili bölüme
 * gidiyor; anchor text zaten idealdi, sadece `<a>` içine alınması gerekiyordu.
 */
const programLinks = [
  { id: 'paketler', label: 'YKS Sayısal / Eşit Ağırlık Özel Ders' },
  { id: 'paketler', label: 'LGS Birebir Özel Ders' },
  { id: 'paketler', label: 'Matematik & Geometri Özel Ders' },
  { id: 'paketler', label: 'Fizik, Kimya, Biyoloji Dersleri' },
  { id: 'neden-biz', label: 'Sınav Stresi & Zaman Yönetimi' },
];

/* Metin bağlantılarının dokunma hedefi 16-17px yüksekliğindeydi; parmakla
   isabetli tıklamak zordu, aralarındaki boşluk da ~10px'ti. `min-h-[44px]`
   görsel tasarımı bozmadan tıklanabilir alanı standarda çıkarır — liste
   aralığı (space-y) buna karşılık sıfırlandı, yükseklik artık padding'den
   geliyor. */
const linkClass =
  'inline-flex items-center min-h-[44px] hover:text-[#B6D6CC] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c5a059] focus-visible:ring-offset-2 focus-visible:ring-offset-[#191F61]';

export const Footer: React.FC<FooterProps> = ({ onOpenTrialForm }) => {
  /* Telefonda alt boşluk daha geniş: sabit WhatsApp düğmesi tam da telif
     satırının üzerine oturuyor, sürüm numarasını örtüyordu. */
  return (
    <footer className="bg-[#191F61] text-white pt-16 pb-20 sm:pb-12 border-t border-[#191F61]/80 relative overflow-hidden">

      {/* DEKORATİF ARKA PLAN YUMUŞATICI */}
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-[#B6D6CC]/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 pb-12 border-b border-white/10">

          {/* MARKA BİLGİSİ */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {/* width/height: görsel inmeden yer ayrılır.
                  alt BOŞ: marka adı hemen yanda gerçek metin olarak duruyor,
                  dolayısıyla işaret dekoratif. Burada alt="Sherpa Akademi"
                  yazıyordu ve ekran okuyucu adı iki kez okuyordu. Header ve
                  mobil menü zaten aynı sebeple boş alt kullanıyor. */}
              <img
                src={logoGradient}
                alt=""
                width={256}
                height={256}
                className="h-11 md:h-12 w-auto object-contain"
              />
              <span className="text-2xl font-extrabold tracking-tight text-white">
                Sherpa Akademi
              </span>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed">
              Birebir online özel derslerle eksiklerini kapat, hayalindeki liseye ya da üniversiteye kendi hızında hazırlan.
            </p>
          </div>

          {/* HIZLI BAĞLANTILAR
              h4 -> h3: sayfadaki son başlık H2 olduğu için H4 bir seviye
              atlıyordu (H2 -> H4). Üç sayfada birden oluşan bir sıçramaydı. */}
          <div>
            <h3 className="font-bold text-lg text-white mb-4">
              Hızlı Bağlantılar
            </h3>
            <ul className="text-sm text-slate-300">
              {sectionLinks.map((item) => (
                <li key={item.id}>
                  <Link
                    /* pathname + hash: DOM'da `/#paketler` üretir, yani
                       tarayıcı da arama motoru da bağlantının hangi bölüme
                       gittiğini görür. Sadece `to="/"` yazılsaydı dokuz
                       bağlantının dokuzu da `/` gösterirdi. */
                    to={{ pathname: '/', hash: `#${item.id}` }}
                    state={{ scrollTo: item.id }}
                    className={linkClass}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* DERSLER & PROGRAMLAR */}
          <div>
            <h3 className="font-bold text-lg text-white mb-4">
              Programlarımız
            </h3>
            <ul className="text-sm text-slate-300">
              {programLinks.map((item) => (
                <li key={item.label}>
                  <Link
                    /* pathname + hash: DOM'da `/#paketler` üretir, yani
                       tarayıcı da arama motoru da bağlantının hangi bölüme
                       gittiğini görür. Sadece `to="/"` yazılsaydı dokuz
                       bağlantının dokuzu da `/` gösterirdi. */
                    to={{ pathname: '/', hash: `#${item.id}` }}
                    state={{ scrollTo: item.id }}
                    className={linkClass}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* İLETİŞİM BİLGİLERİ */}
          <div className="space-y-3">
            <h3 className="font-bold text-lg text-white mb-4">
              İletişim & Destek
            </h3>
            {/* Telefon artık tıklanabilir: mobilde numarayı elle kopyalamak
                gerekmiyor. `tel:` E.164 biçimini ister. */}
            <div className="flex items-center gap-3 text-sm text-slate-300">
              <Phone className="w-4 h-4 text-[#B6D6CC] shrink-0" />
              <a href="tel:+905303699539" className={linkClass}>
                {need.contact.phoneFormatted}
              </a>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-300">
              <MapPin className="w-4 h-4 text-[#B6D6CC] shrink-0" />
              <span>
                {need.contact.address.street}, Maslak/{need.contact.address.city}
              </span>
            </div>

            <div className="pt-2">
              <Button variant="mint" size="md" className="min-h-[44px]" onClick={onOpenTrialForm}>
                Ücretsiz Deneme Dersi İste
              </Button>
            </div>
          </div>

        </div>

        {/* TELİF HAKKI VE ALT BİLGİ */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4 text-center sm:text-left">
          <p>© {new Date().getFullYear()} Sherpa Akademi. Tüm hakları saklıdır.</p>
          <div className="flex items-center gap-4">
            {/* Blog statik olarak üretiliyor ve router'ın route ağacında yok;
                <Link> yerine düz <a> (bkz. Header.tsx'teki uzun not). */}
            <a href="/blog" className={linkClass}>Blog</a>
            <Link to="/gizlilik-politikasi" className={linkClass}>Gizlilik Politikası</Link>
            <Link to="/kullanim-kosullari" className={linkClass}>Kullanım Koşulları</Link>
            {/* text-slate-500 lacivert zeminde 2.82:1 kontrast veriyordu
                (axe-core'un tespit ettiği tek gerçek ihlal). */}
            <p className="text-slate-400">v{need.site.version}</p>
          </div>
        </div>
      </div>
    </footer>
  );
};
