import React from 'react';
import { UserCheck, BarChart3, Users, MessageSquare, Clock } from 'lucide-react';
import { motion } from 'motion/react';
import { IS_SERVER } from '../lib/ssr';

interface WhyUsSectionProps {
  onOpenTrialForm: () => void;
}

export const WhyUsSection: React.FC<WhyUsSectionProps> = ({ onOpenTrialForm }) => {
  const features = [
    {
      icon: UserCheck,
      title: 'Birebir Özel Ders',
      description: 'Ders tamamen sana ayrılır. Kalabalık sınıfta sorulamayan soru burada sorulur, anlatım senin hızına göre ilerler.',
    },
    {
      icon: BarChart3,
      title: 'Kişiye Özel İlerleme Analizi',
      description: 'Öğrencinin eksik olduğu konular yapay zeka destekli analiz matrisi ile tespit edilir, zaman boşa harcanmaz.',
    },
    {
      icon: Clock,
      title: 'Esnek Saatler',
      description: 'İnternet olan her yerde size uygun gün ve saatlerde ders alın.',
    },
    {
      icon: MessageSquare,
      title: 'Şeffaf Veli Bilgilendirmesi',
      description: 'Her ders sonunda işlenen konular, öğrencinin soru çözme hızı ve haftalık ödev takibi veli ile düzenli paylaşılır.',
    },
  ];

  return (
    <section id="neden-biz" className="py-16 sm:py-24 bg-white relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* BAŞLIK */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-[#191F61] font-extrabold text-sm uppercase tracking-wider bg-[#191F61]/10 border border-[#c5a059]/30 px-4 py-1.5 rounded-full inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#c5a059]" />
            Farkımız
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[#191F61] tracking-tight mt-3">
            Neden Sherpa Akademi'de Özel Ders?
          </h2>
          <p className="mt-3 text-slate-600 text-base sm:text-lg">
            Kalabalık sınıflar yerine birebir özel ders: eksiklerini tek tek kapat, hedefine kendi hızında ilerle.
          </p>
        </div>

        {/* 4 ANA ÖZELLİK KARTLARI */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((item, index) => {
            const IconComponent = item.icon;
            return (
              <motion.div
                key={index}
                initial={IS_SERVER ? false : { opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.45, delay: index * 0.08 }}
                className="bg-slate-50 hover:bg-[#191F61] hover:text-white rounded-3xl p-8 border border-slate-200/80 shadow-sm hover:shadow-2xl transition-colors duration-300 group"
              >
                <div className="w-14 h-14 rounded-2xl bg-[#191F61] text-[#B6D6CC] group-hover:bg-[#B6D6CC] group-hover:text-[#191F61] flex items-center justify-center mb-6 transition-colors duration-300 shadow-md">
                  <IconComponent className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-[#191F61] group-hover:text-white transition-colors">
                  {item.title}
                </h3>
                <p className="mt-3 text-slate-600 group-hover:text-slate-200 text-sm leading-relaxed transition-colors">
                  {item.description}
                </p>
              </motion.div>
            );
          })}
        </div>

      </div>
    </section>
  );
};
