import React from 'react';
import { Check, Gift, Zap, ArrowRight, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { SITE_URL } from '../config';
import { IS_SERVER } from '../lib/ssr';
import { Button } from './ui/Button';

interface PackagesSectionProps {
  onOpenTrialForm: () => void;
}

/*
 * ŞEMA KURALLARI — bozmadan önce okuyun:
 *
 * 1) Fiyat `Service` üzerinde DEĞİL, `offers` altındaki `Offer` üzerinde
 *    durur. Eskiden `Service.price` / `Service.priceSpecification`
 *    yazılıydı; bunlar Service'in özellikleri olmadığı için Google
 *    hepsini yok sayıyordu — yani sayfanın en güçlü ticari sinyali
 *    (şeffaf fiyat) yapılandırılmış veri olarak hiç iletilmiyordu.
 *
 * 2) Her hizmetin `@id`'si BENZERSİZ olmalı. Eskiden "Ücretsiz Deneme
 *    Dersi" ile "Özel Ders Paketi" aynı `#ozel-ders` kimliğini
 *    paylaşıyordu; ayrıştırıcı ikisini tek varlık sanıp birleştiriyordu.
 *
 * 3) `itemListElement` ögeleri `ListItem` + `position` ile sarılır;
 *    böylece sıralama (hangisi öne çıkan paket) da iletilir.
 *
 * 4) `unitCode` UN/CEFACT Rec 20 kodu bekler. "MON" (ay) geçerlidir;
 *    eskiden yazan "H27" o listede yok. "Ders başına" için standart bir
 *    kod olmadığından serbest metin alanı `unitText` kullanılıyor.
 *
 * 5) MODÜL DÜZEYİNDE ve JSX'te render ediliyor, useEffect ile head'e
 *    enjekte EDİLMİYOR: useEffect sunucu render'ında çalışmaz, yani
 *    prerender edilmiş HTML'de fiyatların şeması hiç bulunmuyordu.
 */
const provider = { "@id": `${SITE_URL}/#organization` };

const services = [
  {
    id: 'deneme-dersi',
    name: 'Ücretsiz Deneme Dersi',
    description:
      'Hedefinize ve seviyenize uygun hocanızla 30-40 dakikalık tanışma seansı; eksikleriniz birlikte belirlenir. Hiçbir ücret veya taahhüt ödemezsiniz.',
    price: '0',
    unitText: 'ders',
  },
  {
    id: 'ozel-ders-paketi',
    name: 'Özel Ders Paketi',
    description:
      'Haftalık belirlenmiş saatlerde eksiklerinize odaklanan birebir online özel ders. İlerleme analizi ve haftalık veli bilgilendirmesi.',
    price: '950',
    unitText: 'ders',
  },
  {
    id: 'kocluk-programi',
    name: 'Koçluk Programı',
    description:
      'Haftalık revizyon ve planlama görüşmesi ile kişiye özel çalışma planı. Farklı teknikler ile en verimli çalışma yolunu keşfet.',
    price: '3150',
    unitCode: 'MON',
  },
];

const serviceSchema = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "Birebir özel ders paketleri",
  "itemListElement": services.map((service, index) => ({
    "@type": "ListItem",
    "position": index + 1,
    "item": {
      "@type": "Service",
      "@id": `${SITE_URL}/#${service.id}`,
      "name": service.name,
      "description": service.description,
      "serviceType": "Online birebir özel ders",
      "provider": provider,
      "areaServed": { "@type": "Country", "name": "Türkiye" },
      "offers": {
        "@type": "Offer",
        "price": service.price,
        "priceCurrency": "TRY",
        "availability": "https://schema.org/InStock",
        "url": `${SITE_URL}/#paketler`,
        "priceSpecification": {
          "@type": "UnitPriceSpecification",
          "price": service.price,
          "priceCurrency": "TRY",
          ...(service.unitCode
            ? { "unitCode": service.unitCode }
            : { "unitText": service.unitText }),
        },
      },
    },
  })),
};

export const PackagesSection: React.FC<PackagesSectionProps> = ({ onOpenTrialForm }) => {
  return (
    <section id="paketler" className="py-16 sm:py-24 bg-slate-50 relative">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* SEKTÖR BAŞLIĞI VE ALT METİN */}
        <div className="text-center max-w-3xl mx-auto mb-12 sm:mb-16">
          <div className="inline-flex items-center gap-2 bg-[#191F61]/10 text-[#191F61] border border-[#c5a059]/30 px-4 py-1.5 rounded-full text-xs sm:text-sm font-bold mb-3 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-[#c5a059]" />
            <span>Sana En Uygun Eğitim Paketi</span>
          </div>
          {/* H2'ler hedef ifadeleri taşımalı: eskiden dört H2'nin hiçbirinde
              "YKS", "LGS", "koçluk" veya "özel ders" geçmiyordu. */}
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[#191F61] tracking-tight">
            Birebir Özel Ders Paketleri
          </h2>
          <p className="mt-3 text-slate-600 text-base sm:text-lg">
            Birebir özel derslerle eksiklerini kapat, hedefine adım adım yaklaş. Sürpriz ücret yok!
          </p>
        </div>

        {/* PAKET KARTLARI GRID (3 PAKET) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch max-w-6xl mx-auto">
          
          {/* 1. SOL PAKET: ÜCRETSİZ DENEME DERSİ */}
          <motion.div
            initial={IS_SERVER ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45 }}
            className="bg-white rounded-3xl p-8 border border-slate-200 shadow-md hover:shadow-xl transition-shadow duration-300 flex flex-col justify-between relative group">
            <div>
              <div className="inline-block bg-[#B6D6CC]/30 text-[#191F61] px-3.5 py-1 rounded-xl text-xs font-bold mb-4">
                İlk Adım
              </div>
              <h3 className="text-2xl font-bold text-[#191F61]">
                Ücretsiz Deneme Dersi
              </h3>
              <p className="text-slate-500 text-sm mt-1">
                Herhangi bir taahhüt vermeden koçunuzla tanışın.
              </p>

              <div className="my-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold text-[#191F61]">0 TL</span>
                  <span className="text-slate-400 text-sm font-medium">/ 1 Ders</span>
                </div>
                <span className="inline-block mt-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-md">
                  Tamamen Ücretsiz
                </span>
              </div>

              <div className="space-y-3.5 pt-4 border-t border-slate-100">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#B6D6CC]/40 text-[#191F61] flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-700 font-medium">Seviye tespiti</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#B6D6CC]/40 text-[#191F61] flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-700 font-medium">Hoca ile tanışma</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#B6D6CC]/40 text-[#191F61] flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-700 font-medium">Çalışma planı önerisi</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#B6D6CC]/40 text-[#191F61] flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-700 font-medium">Tamamen ücretsiz</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm text-slate-800 font-bold">Hiçbir taahhüt veya bağlılık yok</span>
                </div>
              </div>
            </div>

            <Button
              variant="soft"
              size="lg"
              fullWidth
              onClick={onOpenTrialForm}
              className="mt-8"
            >
              Hemen Deneme Dersi Al
            </Button>
          </motion.div>

          {/* 2. SAĞ PAKET (ÖNE ÇIKAN): ÖZEL DERS PAKETİ */}
          {/* NOT: bu kart '-translate-y-3' ile statik olarak yukarı kaydırılmış durumda;
              motion'a y-transform verilmiyor, aksi halde giriş animasyonu bitince
              motion'ın satır-içi transform'u bu kaymayı ezer. Sadece opacity animasyonu var. */}
          <motion.div
            initial={IS_SERVER ? false : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45, delay: 0.08 }}
            className="bg-[#191F61] text-white rounded-3xl p-8 border-2 border-[#c5a059] shadow-2xl flex flex-col justify-between relative transform -translate-y-3 z-10">
            {/* POPÜLER ROZETİ */}
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#c5a059] text-white px-4 py-1 rounded-full text-xs font-black uppercase tracking-wider shadow-md flex items-center gap-1.5 border border-amber-200/40">
              <Zap className="w-3.5 h-3.5 fill-current text-white" /> En Çok Tercih Edilen
            </div>

            <div>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-2xl font-bold text-white">
                    Özel Ders Paketi
                  </h3>
                  <p className="text-[#B6D6CC] text-xs font-semibold mt-1">
                    YKS & LGS Özel Dersleri
                  </p>
                </div>
                <span className="bg-white/10 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg">
                  Birebir
                </span>
              </div>

              {/* FİYAT (1050 TL -> 950 TL İNDİRİMİ) */}
              <div className="my-6">
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 line-through text-lg font-bold">1050 TL</span>
                  <span className="text-4xl font-extrabold text-[#B6D6CC]">950 TL</span>
                  <span className="text-slate-300 text-xs font-medium">/ Ders</span>
                </div>
                <p className="text-xs text-[#B6D6CC] mt-1 font-semibold flex items-center gap-1">
                  <Gift className="w-3.5 h-3.5" /> Haftalık 2+ ders alımında 3.150 TL Koçluk Bedava!
                </p>
              </div>

              {/* ÖZELLİKLER */}
              <div className="space-y-3 pt-4 border-t border-white/10">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#B6D6CC] text-[#191F61] flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-100 font-medium">Kişiye özel analizle eksik konu tespiti</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#B6D6CC] text-[#191F61] flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-100 font-medium">Birebir eğitim</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#B6D6CC] text-[#191F61] flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-100 font-medium">Öğrenciye uygun ders materyalleri</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#B6D6CC] text-[#191F61] flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-100 font-medium">Ders sonu veli bilgilendirmeleri</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#B6D6CC] text-[#191F61] flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-100 font-medium">Ücretsiz çalışma planı</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#B6D6CC] text-[#191F61] flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-100 font-bold text-[#B6D6CC]">50 dakikalık özel ders</span>
                </div>
              </div>
            </div>

            <Button
              variant="mint"
              size="lg"
              fullWidth
              onClick={onOpenTrialForm}
              className="mt-8"
            >
              <span>İndirimli Derse Başla</span>
              <ArrowRight className="w-5 h-5" />
            </Button>
          </motion.div>

          {/* 3. KOÇLUK PAKETİ */}
          <motion.div
            initial={IS_SERVER ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45, delay: 0.16 }}
            className="bg-white rounded-3xl p-8 border border-slate-200 shadow-md hover:shadow-xl transition-shadow duration-300 flex flex-col justify-between relative group">
            <div>
              <div className="inline-block bg-emerald-50 text-emerald-700 px-3.5 py-1 rounded-xl text-xs font-bold mb-4">
                Koçluk
              </div>
              <h3 className="text-2xl font-bold text-[#191F61]">
                Koçluk Programı
              </h3>
              <p className="text-slate-500 text-sm mt-1">
                Çalışma başarısını maksimize et
              </p>

              <div className="my-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold text-[#191F61]">3.150 TL</span>
                  <span className="text-slate-400 text-sm font-medium">/ Ay</span>
                </div>
                <span className="inline-block mt-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-md">
                  En Verimli Çalışma
                </span>
              </div>

              <div className="space-y-3.5 pt-4 border-t border-slate-100">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-700 font-medium">Haftalık revizyon ve planlama görüşmesi</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-700 font-medium">Tamamen kişiye özel çalışma planı</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-800 font-bold">Farklı teknikler ile en verimli çalışma yolunu keşfet</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-700 font-medium">Haftalık ilerleme takibi</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span className="text-sm text-slate-700 font-medium">Motivasyon ve zaman yönetimi rehberliği</span>
                </div>
              </div>
            </div>

            <Button
              variant="softEmerald"
              size="lg"
              fullWidth
              onClick={onOpenTrialForm}
              className="mt-8"
            >
              Koçluk Başla
            </Button>
          </motion.div>

        </div>

      </div>
    </section>
  );
};
