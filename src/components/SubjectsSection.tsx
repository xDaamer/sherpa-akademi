import React from 'react';
import { ArrowRight, BookOpen, GraduationCap } from 'lucide-react';

/*
 * DERSLER BÖLÜMÜ — "hangi derslerden özel ders veriyorsunuz?"
 * ============================================================================
 * 2026-10-18 SEO denetiminde ana sayfa ~410 kelimeydi ve hedeflenen sorguların
 * (TYT/AYT matematik özel ders vb.) hiçbiri sayfada geçmiyordu: "TYT" ve "AYT"
 * sıfır, "matematik" bir kez. Bu bölüm o boşluğu dolduruyor.
 *
 * Ders listesi FAQSection'daki "Hangi derslerden özel ders alabilirim?"
 * cevabıyla BİREBİR aynı. Buraya ders eklemek, verilmeyen bir hizmeti
 * vaat etmek olur — önce o cevabı (ve FAQPage şemasını) güncelleyin.
 *
 * Soru sayıları blogdaki konu dağılımı yazılarının tldr'leriyle aynı.
 * Bağlantılar düz <a>: blog sayfaları SPA'nın dışında, statik HTML.
 *
 * Bilerek motion YOK: statik HTML'de opacity:0 kalma riski taşımasın
 * (bkz. src/lib/ssr.ts) ve sayfaya gereksiz animasyon eklemesin.
 */

interface Ders {
  ad: string;
  aciklama: string;
  rehber?: { href: string; metin: string };
}

const YKS_DERSLERI: Ders[] = [
  {
    ad: 'TYT ve AYT Matematik',
    aciklama: 'TYT\'de 40, AYT\'de 40 soru. Temel kavramlar ve problemlerden fonksiyon, türev ve integrale kadar eksik olduğun konudan başlıyoruz.',
    rehber: { href: '/blog/tyt-matematik-konulari', metin: 'TYT matematik konuları' },
  },
  {
    ad: 'Geometri',
    aciklama: 'Üçgenler, çokgenler, çember ve analitik geometri. Matematik testinin içinde ama ayrı bir çalışma düzeni isteyen alan.',
    rehber: { href: '/blog/geometri-konulari-soru-dagilimi', metin: 'Geometri konuları' },
  },
  {
    ad: 'Fizik',
    aciklama: 'TYT\'de 7, AYT\'de 14 soru. Az soru olduğu için hangi konuya önce çalışılacağı, konuları bitirmekten daha belirleyici.',
    rehber: { href: '/blog/fizik-konulari-soru-dagilimi', metin: 'Fizik konuları' },
  },
  {
    ad: 'Kimya',
    aciklama: 'TYT\'de 7, AYT\'de 13 soru. Mol hesaplarından organik kimyaya, ezber ile mantığın ayrıldığı yeri birlikte buluyoruz.',
    rehber: { href: '/blog/kimya-konulari-soru-dagilimi', metin: 'Kimya konuları' },
  },
  {
    ad: 'Biyoloji',
    aciklama: 'TYT\'de 6, AYT\'de 13 soru. AYT\'de soruların yaklaşık yarısını getiren insan fizyolojisine ayrı bir plan kuruyoruz.',
    rehber: { href: '/blog/biyoloji-konulari-soru-dagilimi', metin: 'Biyoloji konuları' },
  },
  {
    ad: 'TYT Türkçe ve Paragraf',
    aciklama: 'TYT Türkçe 40 soru ve yaklaşık yarısı paragraf. Okuma hızı, anlam bilgisi ve dil bilgisi birlikte çalışılıyor.',
    rehber: { href: '/blog/paragraf-sorulari-nasil-cozulur', metin: 'Paragraf soruları nasıl çözülür' },
  },
  {
    ad: 'Tarih',
    aciklama: 'TYT\'de 5, AYT\'de 21 soru ile sözel derslerin en büyüğü. Kronolojiyi ezber yerine neden-sonuç zinciriyle kuruyoruz.',
    rehber: { href: '/blog/tarih-konulari-soru-dagilimi', metin: 'Tarih konuları' },
  },
  {
    ad: 'Coğrafya',
    aciklama: 'TYT\'de 5, AYT\'de 17 soru. Harita okuma, iklim ve beşeri coğrafya soruları için yorum odaklı çalışma.',
    rehber: { href: '/blog/cografya-konulari-soru-dagilimi', metin: 'Coğrafya konuları' },
  },
];

const LGS_DERSLERI: Ders[] = [
  {
    ad: 'LGS Matematik',
    aciklama: 'Çok adımlı, okuma yükü yüksek sorular. İşlem hızından çok soruyu doğru kurmayı çalışıyoruz.',
  },
  {
    ad: 'LGS Fen Bilimleri',
    aciklama: 'Deney, grafik ve tablo yorumlama. Bilgiyi ezberlemek yerine bir durumda kullanmayı öğreten sorular.',
  },
  {
    ad: 'LGS Türkçe',
    aciklama: 'Paragraf, sözel mantık ve görsel okuma. Sözel bölümün en çok soru getiren testine düzenli okuma alışkanlığıyla hazırlık.',
  },
];

const DersKarti: React.FC<{ ders: Ders }> = ({ ders }) => (
  <li className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
    <h4 className="text-base font-bold text-[#191F61]">{ders.ad}</h4>
    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{ders.aciklama}</p>
    {ders.rehber && (
      <a
        href={ders.rehber.href}
        className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#191F61] underline decoration-[#c5a059]/60 underline-offset-4 hover:decoration-[#c5a059]"
      >
        {ders.rehber.metin}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    )}
  </li>
);

export const SubjectsSection: React.FC = () => (
  <section id="dersler" aria-labelledby="dersler-basligi" className="py-16 sm:py-24 bg-slate-50">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="text-center max-w-3xl mx-auto mb-12">
        <h2 id="dersler-basligi" className="text-3xl sm:text-4xl font-extrabold text-[#191F61] tracking-tight">
          Hangi Derslerde Online Özel Ders Veriyoruz?
        </h2>
        <p className="mt-3 text-slate-600 text-base sm:text-lg">
          TYT, AYT ve LGS'nin tüm ana derslerinde birebir online özel ders. Her ders, ücretsiz deneme
          dersinde belirlenen eksiklerinden başlıyor; konuyu baştan anlatmak yerine puan getirmeyen
          yere odaklanıyoruz.
        </p>
      </div>

      <div className="grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h3 className="flex items-center gap-2 text-xl font-bold text-[#191F61] mb-4">
            <GraduationCap className="h-5 w-5 text-[#c5a059]" aria-hidden="true" />
            YKS: TYT ve AYT Özel Ders
          </h3>
          <ul className="grid gap-4 sm:grid-cols-2">
            {YKS_DERSLERI.map((ders) => (
              <DersKarti key={ders.ad} ders={ders} />
            ))}
          </ul>
          <p className="mt-5 text-sm text-slate-600">
            Hangi derse ne zaman ağırlık verileceğini{' '}
            <a href="/blog/yks-hazirlik-rehberi" className="font-semibold text-[#191F61] underline decoration-[#c5a059]/60 underline-offset-4">
              YKS hazırlık rehberinde
            </a>{' '}
            aylara göre anlattık.
          </p>
        </div>

        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold text-[#191F61] mb-4">
            <BookOpen className="h-5 w-5 text-[#c5a059]" aria-hidden="true" />
            LGS Özel Ders
          </h3>
          <ul className="grid gap-4">
            {LGS_DERSLERI.map((ders) => (
              <DersKarti key={ders.ad} ders={ders} />
            ))}
          </ul>
          <p className="mt-5 text-sm text-slate-600">
            LGS soruları bilgiyi değil, bilgiyi kullanmayı ölçüyor. Nereden başlanacağını{' '}
            <a href="/blog/lgs-hazirlik-rehberi" className="font-semibold text-[#191F61] underline decoration-[#c5a059]/60 underline-offset-4">
              LGS hazırlık rehberinde
            </a>{' '}
            topladık.
          </p>
        </div>
      </div>
    </div>
  </section>
);
