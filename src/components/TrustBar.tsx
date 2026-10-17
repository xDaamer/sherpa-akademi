import React from 'react';
import { Target, Gift, Clock } from 'lucide-react';
import { motion } from 'motion/react';
import { IS_SERVER } from '../lib/ssr';

// SADE GÜVEN ŞERİDİ: Hero'nun hemen altında, ziyaretçiye anında güven veren
// kısa maddeler. Uydurma istatistik yok — sitenin zaten savunduğu gerçek
// vaatlerin (taahhütsüz deneme dersi, esnek online dersler) özeti.
const trustItems = [
  { icon: Target, label: 'Eksiğe Odaklı Birebir Ders' },
  { icon: Gift, label: 'İlk Ders %100 Ücretsiz' },
  { icon: Clock, label: 'Esnek Online Ders Saatleri' },
];

export const TrustBar: React.FC = () => {
  return (
    <section aria-labelledby="guven-basligi" className="px-4 sm:px-6 lg:px-8 relative z-10">
      {/* Başlıksız <section> ekran okuyucuda "adsız bölge" yaratır.
          Şerit görsel olarak Hero'nun devamı olduğu için başlık sadece
          erişilebilirlik ağacında var: sr-only. Metin WhyUsSection'ın
          "Neden Sherpa Akademi..." başlığından bilerek farklı: iki H2'nin
          neredeyse aynı olması sayfanın başlık hiyerarşisini bulanıklaştırıyordu. */}
      <h2 id="guven-basligi" className="sr-only">
        Birebir online özel derste ilk adım
      </h2>
      <div className="max-w-6xl mx-auto -mt-6 sm:-mt-8 bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-lg shadow-slate-900/5 px-5 sm:px-8 py-5 sm:py-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-5 gap-x-4 sm:gap-6">
          {trustItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.label}
                initial={IS_SERVER ? false : { opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.4, delay: index * 0.06 }}
                /* Madde sayısı tekse mobildeki iki sütunlu ızgarada son madde
                   tek başına kalır; iki sütuna yayılıyor ama ortalanmıyor:
                   ortalandığında ikonu üstündeki ikonlarla aynı hizada
                   durmuyor, üç ikonun oluşturduğu sol dikey hat kırılıyordu. */
                className={`flex items-center gap-3${
                  trustItems.length % 2 === 1 &&
                  index === trustItems.length - 1
                    ? ' col-span-2 sm:col-span-1'
                    : ''
                }`}
              >
                <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#191F61]/10 text-[#191F61] flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-sm font-bold text-slate-700 leading-tight">
                  {item.label}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
