import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowDown, CheckCircle2, ChevronDown, FileSignature, LogOut } from 'lucide-react';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, ApiRequestError } from '../../lib/api';

/*
 * ÖĞRETMEN SÖZLEŞMESİ — ENGELLEYİCİ ONAY PENCERESİ
 * ===========================================================================
 * Öğretmen paneli, sözleşme onaylanmadan kullanılamıyor. Bu pencere o onayı
 * topluyor; görsel dili KvkkModal'ınki, davranışı ise bilinçli olarak farklı:
 *
 *   KAPATILAMIYOR. Arka plana tıklamak, X düğmesi, Escape — hiçbiri yok.
 *   Kapatılabilen bir pencere "onaylamadan devam et" düğmesi demekti. Tek
 *   çıkış yolu altta: oturumu kapatmak (PanelHeader'daki çıkış düğmesi
 *   pencerenin arkasında kaldığı için burada tekrar var).
 *
 *   SIRA: metin -> kutucuklar -> düğme. Düğme yalnızca üç koşul birden
 *   sağlanınca açılıyor: sözleşme sonuna kadar kaydırıldı, aydınlatma metni
 *   okundu, hizmet koşulları kabul edildi. Kutucuklar metin okunmadan da
 *   işaretlenebiliyor; kilitli olan yalnızca düğme — sırayı dayatmak yerine
 *   eksik olanı söylüyoruz (düğmenin üstündeki satır).
 *
 *   METİNLER DÜZ YAZI. Gövdeler veritabanından geliyor ve whitespace-pre-line
 *   ile, React'in kendi kaçışıyla basılıyor; asla HTML olarak değil. Metni
 *   düzenleyebilen birinin panele betik sokabilmesi için bir yol açmıyoruz.
 *
 * BU BİR GÜVENLİK SINIRI DEĞİL. Pencereyi geliştirici araçlarıyla silmek
 * panelin boş hâlini gösterir, verisini değil: sözleşme onaylanmadan
 * /api/teacher/* uçlarının hepsi 403 SOZLESME_GEREKLI dönüyor (sunucu kapısı).
 *
 * ODAK TUZAĞI YOK, çünkü gerek yok: pencere açıkken sayfa arkada hiçbir
 * etkileşimli eleman çizmiyor (bkz. TeacherDashboardPage), Tab'ın kaçacağı
 * bir yer kalmıyor.
 */

export interface Belge {
  id: string;
  version: number;
  title: string;
  /** Düz metin. HTML olarak render EDİLMEZ. */
  body: string;
}

export interface Belgeler {
  sozlesme: Belge;
  aydinlatma: Belge;
  kosullar: Belge;
}

interface TeacherContractModalProps {
  belgeler: Belgeler;
  /** Onay kaydedildi; sayfa paneli açabilir. */
  onKabul: () => void;
  /** Belgeleri yeniden çek — metin okunurken güncellendiyse (409). */
  onYenile: () => Promise<void> | void;
}

/* "Sonuna geldi" toleransı (px). Alt sınırı piksel piksel tutturmak
   yakınlaştırmada ve kesirli piksel oranlarında bazen imkânsız oluyor. */
const SON_TOLERANS = 8;

/** ["a", "b", "c"] -> "a, b ve c". */
function listeMetni(parcalar: string[]): string {
  if (parcalar.length <= 1) return parcalar.join('');
  return `${parcalar.slice(0, -1).join(', ')} ve ${parcalar[parcalar.length - 1]}`;
}

/**
 * Tek bir zorunlu kutucuk + metnini aynı yerde açan bağlantı.
 * "Metni oku" düğmesi <label>'ın DIŞINDA: içinde olsaydı her tıklama
 * kutucuğu da değiştirirdi — metni okumak isteyen kişi farkında olmadan
 * onay vermiş olurdu.
 */
const OnayKutusu: React.FC<{
  belge: Belge;
  etiket: string;
  isaretli: boolean;
  onDegis: (deger: boolean) => void;
  disabled: boolean;
}> = ({ belge, etiket, isaretli, onDegis, disabled }) => {
  const [acik, setAcik] = useState(false);
  const metinId = useId();

  return (
    <div className="rounded-2xl border border-slate-200 p-3">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={isaretli}
          onChange={(e) => onDegis(e.target.checked)}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#191F61]"
        />
        <span>
          <span className="block text-sm font-bold text-[#191F61]">{etiket}</span>
          <span className="block text-xs text-slate-500">
            {belge.title} · Sürüm {belge.version}
          </span>
        </span>
      </label>

      <div className="mt-1.5 pl-7">
        <Button
          variant="link"
          className="gap-1 text-xs"
          aria-expanded={acik}
          aria-controls={metinId}
          onClick={() => setAcik((onceki) => !onceki)}
        >
          {acik ? 'Metni gizle' : 'Metni oku'}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${acik ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </Button>
      </div>

      {acik && (
        <div
          id={metinId}
          tabIndex={0}
          aria-label={belge.title}
          className="mt-2 max-h-48 overflow-y-auto whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c5a059]"
        >
          {belge.body}
        </div>
      )}
    </div>
  );
};

export const TeacherContractModal: React.FC<TeacherContractModalProps> = ({
  belgeler,
  onKabul,
  onYenile,
}) => {
  const { logout } = useAuth();
  const { sozlesme, aydinlatma, kosullar } = belgeler;

  const [sonaGeldi, setSonaGeldi] = useState(false);
  const [aydinlatmaOkundu, setAydinlatmaOkundu] = useState(false);
  const [kosullarKabul, setKosullarKabul] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  /* 409 sonrası onayları sıfırlamak için sayaç: yeniden çekilen belgelerin
     kimlikleri değişmemişse aşağıdaki effect başka türlü tetiklenmezdi. */
  const [sifirlama, setSifirlama] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const metinRef = useRef<HTMLDivElement>(null);
  const icerikRef = useRef<HTMLDivElement>(null);

  const baslikId = useId();
  const yardimId = useId();

  /*
   * "Sonuna kadar okundu" bir kez doğru olunca DOĞRU KALIYOR: kişi metni
   * bitirip bir paragrafı yeniden okumak için yukarı kaydırdığında düğme
   * tekrar kilitlenmemeli. Sıfırlanmasının tek yolu metnin değişmesi (409).
   */
  const sonaKontrol = useCallback(() => {
    const el = metinRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - SON_TOLERANS) {
      setSonaGeldi(true);
    }
  }, []);

  /* Açılışta: arka plan kaymasın, odak pencereye geçsin. Önceki overflow
     değeri saklanıp geri yazılıyor (Header'daki mobil menüyle aynı desen). */
  useEffect(() => {
    const oncekiOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = oncekiOverflow;
    };
  }, []);

  /*
   * Metin kutudan kısaysa kaydırılacak bir şey yok, onScroll hiç tetiklenmez —
   * bu durumda metin baştan okunmuş sayılmalı, yoksa düğme sonsuza kadar
   * kilitli kalırdı. ResizeObserver hem kutuyu (pencere boyutu, telefonun
   * yan çevrilmesi) hem içeriği (metnin yeniden akması) izliyor.
   */
  useEffect(() => {
    const kutu = metinRef.current;
    const icerik = icerikRef.current;
    if (!kutu) return;

    sonaKontrol();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sonaKontrol);
      return () => window.removeEventListener('resize', sonaKontrol);
    }

    const gozlemci = new ResizeObserver(() => sonaKontrol());
    gozlemci.observe(kutu);
    if (icerik) gozlemci.observe(icerik);

    return () => gozlemci.disconnect();
  }, [sonaKontrol]);

  /*
   * Belgeler değişince (409 sonrası yeniden çekildi) ya da sıfırlama
   * istenince onaylar düşüyor, kutu başa dönüyor ve kısa metin kuralı yeniden
   * değerlendiriliyor. Sıfırlama 409 işleyicisinde değil BURADA: yeniden
   * çekme sürerken kişi eski metni sonuna kadar kaydırabilir; o "okundu"
   * işareti yeni gelen metne taşınmamalı. İlk açılışta da çalışıyor —
   * zararsız, değerler zaten başlangıç hâlinde.
   */
  useEffect(() => {
    setSonaGeldi(false);
    setAydinlatmaOkundu(false);
    setKosullarKabul(false);
    const kutu = metinRef.current;
    if (kutu) kutu.scrollTop = 0;
    sonaKontrol();
  }, [sozlesme.id, sozlesme.body, aydinlatma.id, kosullar.id, sifirlama, sonaKontrol]);

  const eksikler: string[] = [];
  if (!sonaGeldi) eksikler.push('sözleşmeyi sonuna kadar okuyun');
  if (!aydinlatmaOkundu) eksikler.push('aydınlatma metnini işaretleyin');
  if (!kosullarKabul) eksikler.push('koşulları kabul edin');

  const gonderilebilir = eksikler.length === 0 && !mesgul;

  async function onayla() {
    if (!gonderilebilir) return;
    setMesgul(true);
    setHata(null);

    try {
      await apiFetch('/api/teacher/sozlesme', {
        method: 'POST',
        body: {
          sozlesmeId: sozlesme.id,
          aydinlatmaId: aydinlatma.id,
          kosullarId: kosullar.id,
          aydinlatmaOkundu: true,
          kosullarKabul: true,
        },
      });
      /* Başarıda sayfa bu pencereyi söküyor; mesgul'ü geri almak gereksiz. */
      onKabul();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'SOZLESME_GUNCELLENDI') {
        /*
         * Öğretmen tam olarak gördüğü metni onaylamalı: sunucu, gönderilen
         * kimlikler güncel sürümlerle eşleşmiyorsa reddediyor. Onaylar
         * sıfırlanıyor ve güncel metin yükleniyor. Sunucunun mesajı
         * "sayfayı yenileyin" diyor; yenilemeyi burada zaten yaptığımız
         * için kişiye ne olduğunu kendi cümlemizle söylüyoruz.
         */
        setHata(
          'Metinler siz okurken güncellendi. Güncel hâli yüklendi; lütfen yeniden okuyup onaylayın.'
        );
        setSifirlama((n) => n + 1);
        try {
          await onYenile();
        } finally {
          setMesgul(false);
        }
        return;
      }

      setHata(err instanceof ApiRequestError ? err.message : 'Onayınız kaydedilemedi.');
      setMesgul(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex justify-center overflow-y-auto p-3 sm:p-4">
      {/* Arka plan. Tıklama işleyicisi YOK — pencere kapatılamıyor. */}
      <div className="fixed inset-0 z-0 bg-slate-950/60 backdrop-blur-sm" aria-hidden="true" />

      {/*
        YERLEŞİM: üç bölümlü sütun — başlık ve alt kısım sabit (shrink-0),
        ortası tek esnek bölge ve kendi içinde kayıyor. Sözleşme kutusu o
        bölgenin en üstünde, sabit yükseklikte; altında ipucu ve kutucuklar.
        Böylece küçük bir telefonda da sıra "metin -> kutucuklar" kalıyor ve
        düğme hiçbir zaman ekranın dışına itilmiyor. Esneyen tek bölge olması
        bilinçli: iki küçülebilir bölge olsaydı aradaki payı tarayıcı içerik
        uzunluğuna göre bölüştürür, uzun sözleşme kutucukları birkaç piksele
        ezerdi.

        Yatay tutulan bir telefon gibi çok alçak ekranlarda orta bölgenin
        min-h'ı pencerenin kendisini taşırıyor; o zaman pencere bütün olarak
        kayıyor (pencerenin kendi overflow-y-auto'su) ve hiçbir şey
        erişilemez kalmıyor.

        YÜKSEKLİK SINIRI dvh DEĞİL max-h-full: fixed inset-0 sarmalayıcının
        yüksekliği her tarayıcıda görünür alan kadar, yüzde de ona göre
        çözülüyor. 100dvh'yi tanımayan tarayıcılar (iOS < 15.4) sınırı
        tamamen düşürürdü; düz 100vh ise iOS'ta araç çubuğunun altında
        kalan kısmı da sayar ve düğmeyi ekranın dışına iterdi. Yedek olarak
        sarmalayıcı da kayabiliyor; dikey ortalama items-center ile değil
        my-auto ile yapılıyor, çünkü taşma olduğunda items-center üst kısmı
        kaydırılamayan bir yere keser.
      */}
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={baslikId}
        tabIndex={-1}
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="relative z-10 my-auto flex max-h-full w-full max-w-2xl flex-col overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 text-slate-800 shadow-2xl focus:outline-none sm:max-h-[90vh] sm:p-6"
      >
        {/* BAŞLIK */}
        <div className="mb-3 flex shrink-0 items-start gap-3 border-b border-slate-100 pb-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#191F61]/10 text-[#191F61]">
            <FileSignature className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id={baslikId} className="text-lg font-extrabold leading-snug text-[#191F61]">
              {sozlesme.title}
            </h2>
            <p className="text-xs text-slate-500">
              Paneli kullanmaya başlamadan önce lütfen okuyup onaylayın.
            </p>
            <p className="text-[11px] font-semibold text-slate-400">Sürüm {sozlesme.version}</p>
          </div>
        </div>

        {/* ORTA BÖLGE — tek esnek, kendi içinde kayan bölüm. */}
        <div className="min-h-[9rem] flex-1 space-y-3 overflow-y-auto">
          {/*
            SÖZLEŞME METNİ. Sabit yükseklik (ekranın ~üçte biri, masaüstünde
            en fazla 18rem): metnin kendisi kayıyor, "sonuna kadar okundu" bu
            kutunun kaydırmasından ölçülüyor. Klavyeyle de kaydırılabilsin
            diye odaklanabilir.
          */}
          <div
            ref={metinRef}
            onScroll={sonaKontrol}
            tabIndex={0}
            aria-label={`${sozlesme.title} metni`}
            className="h-[34dvh] max-h-72 min-h-32 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c5a059]"
          >
            <div ref={icerikRef} className="whitespace-pre-line">
              {sozlesme.body}
            </div>
          </div>

          {sonaGeldi ? (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              Sözleşmenin tamamını okudunuz.
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <ArrowDown className="h-4 w-4 shrink-0 motion-safe:animate-bounce" aria-hidden="true" />
              Devam etmek için metni sonuna kadar kaydırın.
            </p>
          )}

          <OnayKutusu
            belge={aydinlatma}
            etiket="KVKK Aydınlatma Metni'ni okudum ve anladım."
            isaretli={aydinlatmaOkundu}
            onDegis={setAydinlatmaOkundu}
            disabled={mesgul}
          />

          <OnayKutusu
            belge={kosullar}
            etiket="Hizmet ve Kullanım Koşulları'nı okudum, kabul ediyorum."
            isaretli={kosullarKabul}
            onDegis={setKosullarKabul}
            disabled={mesgul}
          />

        </div>

        {/* ALT KISIM — düğme her zaman görünür. Hata da burada, orta bölgede
            değil: orada kaydırılan alanın dışında kalıp görülmeyebilirdi. */}
        <div className="mt-3 shrink-0 space-y-2 border-t border-slate-100 pt-3">
          {hata && (
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 sm:text-sm"
            >
              {hata}
            </p>
          )}

          {eksikler.length > 0 && (
            <p id={yardimId} className="text-xs text-slate-500">
              Onaylamak için {listeMetni(eksikler)}.
            </p>
          )}

          <Button
            size="lg"
            fullWidth
            onClick={() => void onayla()}
            disabled={!gonderilebilir}
            aria-describedby={eksikler.length > 0 ? yardimId : undefined}
          >
            {mesgul ? 'Kaydediliyor…' : 'Okudum, anladım'}
          </Button>

          <div className="flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => void logout()} disabled={mesgul}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Çıkış yap
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
