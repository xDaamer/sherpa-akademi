import React from 'react';
import { ArrowRight, CheckCircle, GraduationCap } from 'lucide-react';
import { TeacherTicker } from './TeacherTicker';
import { Button } from './ui/Button';
import { SHOW_TEACHER_TICKER } from '../config';

interface HeroSectionProps {
  onOpenTrialForm: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onOpenTrialForm }) => {
  /* Şerit kapalıyken (bkz. config.ts) sağ yarı boş kalmasın diye metin tek,
     ortalanmış bir sütuna geçiyor. */
  const ticker = SHOW_TEACHER_TICKER;

  return (
    <section id="ana-sayfa" className="py-8 sm:py-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* ANA DİKDÖRTGEN KUTU (YUMUŞATILMIŞ KENARLAR VE MAVİ ARKA PLAN #191F61) */}
      <div className="bg-gradient-to-br from-[#101442] via-[#1a1f5a] to-[#2a3080] rounded-3xl sm:rounded-[2.5rem] p-6 sm:p-10 lg:p-14 text-white shadow-2xl relative overflow-hidden border border-white/10">
        {/* ARKA PLAN DEKORATİF IŞIK/MİNT/GOLD DOKUNUŞLARI */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#B6D6CC]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-[#c5a059]/10 rounded-full blur-2xl pointer-events-none" />

        {/* İKİ EŞİT PARÇAYA BÖLÜNEN GRID (BİLGİSAYAR VE TABLETTE YAN YANA: SOL YAZI/BUTON, SAĞ HOCA KUTUSU; MOBİLDE ALT ALTA) */}
        <div className={`grid grid-cols-1 ${ticker ? 'md:grid-cols-2' : ''} gap-8 md:gap-8 lg:gap-12 items-center relative z-10`}>
          
          {/* SOL YARI: METİN VE BEYAZ BUTON */}
          <div className={ticker ? 'space-y-5 md:space-y-6 lg:pr-4' : 'space-y-5 md:space-y-7 max-w-4xl mx-auto text-center py-2 md:py-6'}>
            
            {/*
              BAŞLIK
              Title "Online Birebir Özel Ders | ..." vaat ediyor;
              H1 bunu doğrulamalı — arayan kişi SERP'te gördüğü ifadeyi
              sayfada bulabilmeli. 2026-10-18: ana vurgu "YKS/LGS koçluğu"ndan
              özel derse alındı; YKS/LGS hedef kitle olarak ikinci planda. Vurgu 2026-10-09'da "derece hocaları"ndan
              birebir özel derse taşındı: kadro artık derece yapmış
              hocalarla sınırlı değil, o iddia geri eklenirse doğru olmaz.
            */}
            <h1 className={`${ticker ? 'text-2xl sm:text-3xl md:text-3xl lg:text-5xl' : 'text-2xl sm:text-3xl md:text-4xl lg:text-5xl'} font-extrabold text-white leading-[1.18] tracking-tight`}>
              Birebir Online Özel Ders ile Eksiklerini Kapat
            </h1>

            {/* AVANTAJ MADDELERİ
                text-xs (12px) yerine text-sm: bunlar sayfanın en ikna edici
                ifadeleri ve mobilde en küçük punto ile gösteriliyorlardı. */}
            <div className={`${ticker ? 'grid grid-cols-2 gap-2.5 sm:gap-3' : 'flex flex-wrap justify-center gap-x-6 gap-y-2.5'} pt-1 text-sm text-slate-200`}>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[#B6D6CC] shrink-0" />
                {/* "Özel ders" ifadesinin ilk 100 kelimede geçmesi için:
                    eskiden sadece "Birebir Ders" yazıyordu ve ifade ancak
                    ~120. kelimede (paket kartında) ortaya çıkıyordu. */}
                <span>Birebir Özel Ders</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[#B6D6CC] shrink-0" />
                <span>YKS &amp; LGS Hazırlık</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[#B6D6CC] shrink-0" />
                <span>Takip & Veli Raporu</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[#B6D6CC] shrink-0" />
                <span>İlk Ders Ücretsiz</span>
              </div>
            </div>

            {/* BEYAZ BUTON (İÇİNDE MAVİ YAZI) */}
            <div className={`pt-2 sm:pt-4 ${ticker ? '' : 'flex justify-center'}`}>
              <Button
                variant="inverse"
                size="lg"
                onClick={onOpenTrialForm}
                className="w-full sm:w-auto lg:text-lg group border-b-2 border-[#c5a059]/30"
              >
                <span>Ücretsiz deneme dersi al</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          </div>

          {/* SAĞ YARI: YÜKLENEN GÖRSELLERİN AKACAĞI ALAN (ÇERÇEVESİZ & KUTUSUZ)
              Geçici olarak kapalı — bkz. config.ts'teki SHOW_TEACHER_TICKER. */}
          {ticker && (
            <div className="relative h-[360px] sm:h-[400px] md:h-[440px] lg:h-[480px] overflow-hidden">
              <TeacherTicker />
            </div>
          )}

        </div>

      </div>
    </section>
  );
};


