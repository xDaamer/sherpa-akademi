import React, { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { FAQItem } from '../types';

/*
 * SORULAR MODÜL DÜZEYİNDE — BİLEŞENİN İÇİNDE DEĞİL.
 * ============================================================================
 * Sabit bir liste; her render'da yeniden kurulmasının anlamı yoktu. Dahası
 * içeride durması gizli bir hataya yol açıyordu: şemayı basan useEffect'in
 * bağımlılığı `[faqs]`'ti ve `faqs` her render'da YENİ bir dizi olduğu için
 * akordeon her tıklandığında effect yeniden çalışıp <head>'e bir script daha
 * ekliyordu. Diziyi buraya alıp şemayı JSX'te render etmek hatayı siliyor.
 */
const faqs: FAQItem[] = [
  {
    question: 'Ücretsiz deneme dersi tam olarak nasıl gerçekleşiyor?',
    answer: 'Ücretsiz deneme dersi talebinizi bıraktıktan sonra hedefinize ve seviyenize uygun hocanız sizinle iletişime geçer. 30-40 dakikalık online tanışma seansında seviye tespiti yapılır, eksik konularınız belirlenir, beklentileriniz dinlenir ve örnek anlatım gerçekleşir. Hiçbir ücret veya taahhüt ödemezsiniz.',
  },
  {
    question: 'Dersleriniz online mı yoksa yüz yüze mi?',
    answer: 'Derslerimiz ve koçluk görüşmelerimiz interaktif dijital tahta, ekran paylaşımı ve HD kamera desteği ile tamamen online olarak yapılmaktadır. Bu sayede Türkiye’nin her yerinden birebir özel ders alabilir, eksiklerinizi evden çıkmadan kapatabilirsiniz.',
  },
  {
    question: 'Hangi derslerden özel ders alabilirim?',
    answer: 'YKS (Matematik, Geometri, Fizik, Kimya, Biyoloji, Türkçe, Paragraf, Tarih, Coğrafya) ve LGS (Matematik, Fen Bilimleri, Türkçe) alanındaki tüm derslerden özel ders alabilirsiniz.',
  },
  {
    question: 'Haftalık 2 ders ve üzeri alımlardaki bedava koçluk nedir?',
    answer: 'Yeni öğrencilere özel kampanyamız kapsamında, haftalık 2 veya daha fazla özel ders alan tüm öğrencilerimize 3.150 TL değerindeki birebir koçluk ve haftalık takip programı tamamen hediye edilmektedir. Minimum bir aylık paketlerde geçerlidir.',
  },
  {
    question: 'Eğitmen kadronuz kimlerden oluşuyor?',
    answer: 'Eğitmenlerimiz, ders verdikleri alanda birebir ders deneyimi olan hocalardan oluşur. Her öğrenciyi ücretsiz deneme dersinde belirlenen seviyesine, eksiklerine ve hedefine göre en uygun hocayla eşleştiririz; böylece ders ilk dakikadan eksik olduğunuz konulara odaklanır.',
  },
  {
    question: 'Ders sonrasında veliler bilgilendiriliyor mu?',
    answer: 'Her özel ders ve koçluk seansı sonrasında velilerimize öğrencinin katılım durumu, performans artışı, konu hakimiyeti, ve izlenen çalışma programı hakkında detaylı bilgi verilir.',
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": faqs.map(faq => ({
    "@type": "Question",
    "name": faq.question,
    "acceptedAnswer": {
      "@type": "Answer",
      "text": faq.answer
    }
  }))
};

export const FAQSection: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="sss" className="py-16 sm:py-24 bg-slate-50 border-t border-slate-200/60">
      {/*
        FAQPage ŞEMASI GÖVDEDE. Eskiden useEffect ile <head>'e enjekte
        ediliyordu; useEffect sunucu render'ında çalışmadığı için prerender
        edilmiş HTML'de hiç görünmüyordu. Altı sorunun tamamı burada —
        akordeonda aynı anda yalnızca biri açık olsa da rich result'ı besleyen
        şey bu blok, DOM'daki görünür cevap değil.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* SSS BAŞLIK */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-[#191F61]/10 text-[#191F61] px-4 py-1.5 rounded-full text-xs font-bold mb-3">
            <HelpCircle className="w-4 h-4 text-[#191F61]" />
            <span>Sıkça Sorulan Sorular</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[#191F61] tracking-tight">
            Özel Ders Hakkında Sıkça Sorulan Sorular
          </h2>
          <p className="mt-2 text-slate-600 text-sm sm:text-base">
            Sherpa Akademi özel ders sistemi hakkında bilmek istediğiniz her şey.
          </p>
        </div>

        {/* ACCORDION LİSTESİ */}
        <div className="space-y-4">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={index}
                className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-colors duration-200 ${
                  isOpen ? 'border-[#191F61]/20' : 'border-slate-200/80'
                }`}
              >
                {/*
                  Soru metni görsel olarak zaten bir başlıktı ama `<span>`
                  içindeydi: sayfanın başlık taslağında SSS bölümü tek bir
                  H2'den ibaret görünüyor, ekran okuyucu kullanıcısı başlık
                  listesiyle sorular arasında gezinemiyordu. `h3 > button`
                  erişilebilirlikte tercih edilen kalıptır: başlık yapıya
                  girer, buton açma/kapama davranışını taşımaya devam eder.
                */}
                <h3 className="font-bold text-base sm:text-lg text-[#191F61]">
                  <button
                    onClick={() => toggleFAQ(index)}
                    aria-expanded={isOpen}
                    /* focus:outline-none yerine görünür bir odak halkası:
                       klavyeyle gezerken hangi soruda olunduğu belli olmalı. */
                    className="w-full text-left px-6 py-5 flex items-center justify-between gap-4 cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c5a059] focus-visible:ring-inset"
                  >
                    <span>{faq.question}</span>
                    <ChevronDown
                      className={`w-5 h-5 text-[#191F61] shrink-0 transition-transform duration-300 ${
                        isOpen ? 'rotate-180 text-[#191F61]' : ''
                      }`}
                    />
                  </button>
                </h3>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="px-6 pb-5 pt-1 text-slate-600 text-sm leading-relaxed border-t border-slate-100">
                        {faq.answer}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
};
