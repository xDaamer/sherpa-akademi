import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Inbox, RefreshCw, Search, StickyNote } from 'lucide-react';
import { Button } from '../../ui/Button';
import { WhatsAppIcon } from '../../ui/WhatsAppIcon';
import { apiFetch, ApiRequestError } from '../../../lib/api';
import {
  Girdi,
  Secim,
  MetinAlani,
  Kutu,
  Uyari,
  Bos,
  sadeceTarih,
  sadeceSaat,
  telefonGoster,
} from './AdminUI';

/*
 * FORM BAŞVURULARI
 * ===========================================================================
 * Sitedeki iki adımlı formdan (PopUpForm / MobileLeadSheet) gelen kayıtlar,
 * yani public.leads. Bu tabloya şimdiye kadar yalnızca Supabase Dashboard'dan
 * bakılabiliyordu.
 *
 * BEYAN SALT OKUNUR — bkz. server/routes/admin.ts'teki BAŞVURULAR bölümü.
 * Yöneticinin yazdığı tek şey kendi takibi: "Arandı" kutusu, iki etiket
 * ("Deneme dersi alındı", "Takip gerekli") ve not (PATCH /basvurular/:id).
 *
 * TAKİP YAZMALARI LİSTEYİ YENİDEN ÇEKMİYOR, yalnızca o satırı yerelde
 * güncelliyor: yeniden çekmek başka bir satırda yazılmakta olan notu
 * silerdi. Bir yan etkisi bilerek kabul edildi — "Aranmayanlar" filtresinde
 * kutusu işaretlenen satır listeden hemen DÜŞMÜYOR, yenileyene kadar
 * yerinde kalıyor. Satırın tıklandığı anda gözden kaybolması, yanlış
 * tıklamayı geri almayı da imkânsız kılardı.
 *
 * ARANMA SAATİ Meta formunun cevabından veritabanında türüyor
 * (leads.call_time_slot, supabase-lead-followup.sql); panel onu yalnızca
 * gösteriyor ve filtreliyor, yazmıyor.
 *
 * SAYFALAMA SUNUCUDA: diğer sekmeler son 200 satırı çekip yetiniyor, ama
 * başvurular hesaplardan çok daha hızlı büyüyor ve arama da ancak sunucuda
 * bütün tabloyu kapsayabiliyor. Toplam sayı her istekte geliyor.
 *
 * "Ad Soyad" TEK KOLON: form onu tek alan olarak soruyor ve tabloda da tek
 * kolon. Ad ile soyadı burada bölmek tahmin olurdu ("Ayşe Nur Yılmaz"da
 * soyad hangisi?), tahmini veri gibi göstermek de yanıltıcı.
 *
 * İKİ KAYNAK: sitedeki form ve Meta (Facebook/Instagram) reklam formları
 * aynı tabloda; üstteki "Web sitesi / Meta" seçimi ayırıyor. Meta formundaki
 * sorular sitedekilerle birebir örtüşmediği için, Meta satırında formun ham
 * soru/cevapları ayrıca gösteriliyor (bkz. server/metaLeads.ts).
 */

interface Basvuru {
  id: string;
  createdAt: string;
  updatedAt: string | null;
  fullName: string;
  phone: string;
  examType: string | null;
  /* 1: yalnızca ad + telefon geldi, 2: detaylar da doldu. */
  step: number;
  studentFullName: string | null;
  parentFullName: string | null;
  userRole: string | null;
  gradeClass: string | null;
  subjects: string[];
  isRepeat: boolean;
  /* Takip (yöneticinin kendi alanları). contactedAt null: aranmadı. */
  contactedAt: string | null;
  note: string | null;
  noteUpdatedAt: string | null;
  trialTaken: boolean;
  needsFollowup: boolean;
  /* '08-17' | '17-19' | '19-sonrasi'; null: formda bu soru yoktu. */
  callTimeSlot: string | null;
  source: 'website' | 'meta';
  meta: {
    adName: string | null;
    campaignName: string | null;
    platform: string | null;
    fields: { name: string; value: string }[];
  } | null;
}

type Takip = Pick<
  Basvuru,
  'contactedAt' | 'note' | 'noteUpdatedAt' | 'trialTaken' | 'needsFollowup' | 'callTimeSlot'
>;

/** PATCH gövdesi: yalnızca değişen alan gönderiliyor. */
type TakipGovdesi = { contacted?: boolean; trialTaken?: boolean; needsFollowup?: boolean; note?: string };

interface Cevap {
  leads: Basvuru[];
  metaConfigured: boolean;
  /* false: supabase-lead-followup.sql henüz çalıştırılmamış. */
  followupAvailable: boolean;
  total: number;
  page: number;
  pageSize: number;
}

const Yok: React.FC = () => <span className="text-slate-300">—</span>;

/** Boş/null metin için tire; tablo hücrelerinde boşluğu "yüklenmedi" sanmasınlar. */
const Deger: React.FC<{ v: string | null | undefined }> = ({ v }) => (v ? <>{v}</> : <Yok />);

type Kaynak = '' | 'website' | 'meta';

const KAYNAKLAR: { deger: Kaynak; etiket: string }[] = [
  { deger: '', etiket: 'Tümü' },
  { deger: 'website', etiket: 'Web sitesi' },
  { deger: 'meta', etiket: 'Meta' },
];

/* Sunucudaki LEAD_NOT_MAKS ile aynı (ve leads_admin_note_length). */
const NOT_MAKS = 2000;

/* Meta formundaki üç seçenek; değerler private.aranma_dilimi'nin döndürdükleri. */
const ARANMA_DILIMLERI: { deger: string; etiket: string }[] = [
  { deger: '08-17', etiket: '08.00–17.00' },
  { deger: '17-19', etiket: '17.00–19.00' },
  { deger: '19-sonrasi', etiket: '19.00 sonrası' },
];
const DILIM_ETIKET = Object.fromEntries(ARANMA_DILIMLERI.map((d) => [d.deger, d.etiket]));

const AranmaSaati: React.FC<{ dilim: string | null }> = ({ dilim }) =>
  dilim && DILIM_ETIKET[dilim] ? (
    <span
      title="Meta formunda aranmak istediği saat"
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#191F61]/5 px-2 py-0.5 text-[11px] font-semibold text-[#191F61]"
    >
      <Clock className="h-3 w-3" aria-hidden="true" />
      {DILIM_ETIKET[dilim]}
    </span>
  ) : null;

/* Açık/kapalı etiketler. Kapalıyken kesik çerçeveli: "tıklanırsa eklenir"
   görünüyor, ama satırda dolu bir rozet gibi yer kaplamıyor. */
const ETIKETLER: { alan: 'trialTaken' | 'needsFollowup'; etiket: string; acikSinif: string }[] = [
  {
    alan: 'trialTaken',
    etiket: 'Deneme dersi alındı',
    acikSinif: 'border-transparent bg-[#B6D6CC] text-[#191F61]',
  },
  {
    alan: 'needsFollowup',
    etiket: 'Takip gerekli',
    acikSinif: 'border-transparent bg-rose-100 text-rose-800',
  },
];

/* Graph'ın `platform` değeri ("fb" / "ig"); tanınmayan bir değer gelirse
   rozet yalnızca "Meta" der, uydurmaz. */
const PLATFORM_ETIKET: Record<string, string> = {
  fb: 'Facebook',
  facebook: 'Facebook',
  ig: 'Instagram',
  instagram: 'Instagram',
};

const KaynakRozeti: React.FC<{ b: Basvuru }> = ({ b }) =>
  b.source === 'meta' ? (
    <span
      title={
        [b.meta?.campaignName, b.meta?.adName].filter(Boolean).join(' · ') || 'Meta reklam formu'
      }
      className="whitespace-nowrap rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-800"
    >
      {(b.meta?.platform && PLATFORM_ETIKET[b.meta.platform.toLowerCase()]) || 'Meta'}
    </span>
  ) : (
    <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
      Site
    </span>
  );

/*
 * Meta formunun ham soru/cevapları. Ad ve telefon zaten kendi kolonlarında;
 * burada tekrarlanmıyor. Soru adları Meta'nın verdiği hâliyle (özel
 * sorularda formu kuranın yazdığı metin, alt çizgili).
 *
 * Etiket cevabın ÜSTÜNDE, yanında değil: özel sorular uzun cümleler
 * ("hangi sınava hazırlanıyorsunuz?") ve yan yana dizilince etiket sütunu
 * cevabı dar bir şeride sıkıştırıyordu.
 */
const soruEtiketi = (ad: string) => {
  const metin = ad.replace(/_/g, ' ').trim();
  return metin.charAt(0).toLocaleUpperCase('tr') + metin.slice(1);
};
const GIZLI_META_ALANLARI = new Set(['full_name', 'first_name', 'last_name', 'phone_number']);

const MetaAlanlari: React.FC<{ b: Basvuru; bosken?: React.ReactNode }> = ({ b, bosken = null }) => {
  const alanlar = (b.meta?.fields ?? []).filter((f) => f.value && !GIZLI_META_ALANLARI.has(f.name));
  if (!b.meta || (alanlar.length === 0 && !b.meta.campaignName && !b.meta.adName)) return <>{bosken}</>;
  const satirlar = [
    ...(b.meta.campaignName ? [{ k: 'Kampanya', v: b.meta.campaignName }] : []),
    ...(b.meta.adName ? [{ k: 'Reklam', v: b.meta.adName }] : []),
    ...alanlar.map((f) => ({ k: soruEtiketi(f.name), v: f.value })),
  ];
  return (
    <dl className="mt-2 space-y-1.5 text-xs">
      {satirlar.map((x, i) => (
        <div key={`${i}-${x.k}`}>
          <dt className="font-bold text-slate-400">{x.k}</dt>
          <dd className="text-slate-700">{x.v}</dd>
        </div>
      ))}
    </dl>
  );
};

const DurumRozeti: React.FC<{ b: Basvuru }> = ({ b }) => (
  <div className="flex flex-wrap gap-1">
    <KaynakRozeti b={b} />
    {b.source === 'meta' ? null : b.step >= 2 ? (
      <span
        title={
          b.updatedAt
            ? `Detaylar ${sadeceTarih(b.updatedAt)} ${sadeceSaat(b.updatedAt)}'te dolduruldu.`
            : undefined
        }
        className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800"
      >
        Tamamlandı
      </span>
    ) : (
      <span
        title="Yalnızca ilk adım (ad, telefon) gönderildi."
        className="whitespace-nowrap rounded-full bg-[#c5a059]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#7a5f2a]"
      >
        Yarım
      </span>
    )}
    {b.isRepeat && (
      <span
        title="Bu numarayla daha önce de başvuru yapılmış."
        className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600"
      >
        Tekrar
      </span>
    )}
  </div>
);

/** Arama + WhatsApp bağlantısı. wa.me ülke koduyla ve baştaki 0 olmadan ister. */
const Telefon: React.FC<{ tel: string }> = ({ tel }) => {
  const rakam = tel.replace(/\D/g, '').replace(/^0+/, '');
  const gecerli = /^5\d{9}$/.test(rakam);

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {gecerli ? (
        <a
          href={`tel:+90${rakam}`}
          className="font-semibold text-[#191F61] underline-offset-2 hover:underline"
        >
          {telefonGoster(tel)}
        </a>
      ) : (
        <span className="font-semibold text-slate-700">{tel}</span>
      )}
      {gecerli && (
        <a
          href={`https://wa.me/90${rakam}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${telefonGoster(tel)} numarasına WhatsApp'tan yaz`}
          className="text-emerald-600 hover:text-emerald-700"
        >
          <WhatsAppIcon className="h-4 w-4" />
        </a>
      )}
    </span>
  );
};

/* Başvuranın kim olduğu (Veli / Öğrenci) yalnızca ikinci adımda soruluyor;
   ilk adımda kalan satırda gösterilecek bir cevap yok. */
const rolGoster = (b: Basvuru) => (b.step >= 2 ? b.userRole : null);

const TH =
  'whitespace-nowrap border-b border-slate-200 px-2 pb-2 text-left text-xs font-bold uppercase tracking-wider text-slate-400';
/* Altında not satırı olan satırın hücreleri çizgisiz (TD_UST): çizgi notun
   altına iniyor, satır ile notu tek kayıt gibi okutuyor. İki sınıf ayrı,
   çünkü `border-b` ile `border-b-0` aynı elemanda çakışırdı (tailwind-merge yok). */
const TD_UST = 'px-2 py-2.5 align-top text-sm text-slate-700';
const TD = `${TD_UST} border-b border-slate-100`;
const KOLON_SAYISI = 12;

export const AdminLeads: React.FC = () => {
  const [arama, setArama] = useState('');
  const [sorguArama, setSorguArama] = useState('');
  const [sinav, setSinav] = useState('');
  const [adim, setAdim] = useState('');
  const [kaynak, setKaynak] = useState<Kaynak>('');
  const [arandi, setArandi] = useState('');
  const [etiket, setEtiket] = useState('');
  const [saat, setSaat] = useState('');
  const [sayfa, setSayfa] = useState(1);
  const [cevap, setCevap] = useState<Cevap | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);

  /* Takip yazması süren satırlar. Küme, çünkü yönetici iki satırın kutusunu
     art arda işaretleyebilir; biri bitince ötekinin kilidi açılmasın. */
  const [kaydedilenler, setKaydedilenler] = useState<ReadonlySet<string>>(new Set());
  const [takipHata, setTakipHata] = useState<{ id: string; mesaj: string } | null>(null);
  /* Notu düzenlenen başvuru; aynı anda tek düzenleyici açık. */
  const [notAcik, setNotAcik] = useState<string | null>(null);
  const [notTaslak, setNotTaslak] = useState('');

  /* Filtre hızlı değişince yanıtlar sırasız dönebilir; yalnızca SON isteğin
     cevabı ekrana yazılıyor. */
  const istekNo = useRef(0);
  const ustRef = useRef<HTMLDivElement>(null);

  /* Arama her tuşta değil, yazma durunca gidiyor. Sayfa da aynı anda 1'e
     dönüyor — ikisi tek render'da birleşiyor, iki istek çıkmıyor. */
  useEffect(() => {
    const t = setTimeout(() => {
      setSorguArama(arama.trim());
      setSayfa(1);
    }, 350);
    return () => clearTimeout(t);
  }, [arama]);

  const getir = useCallback(async () => {
    const no = ++istekNo.current;
    setYukleniyor(true);

    const p = new URLSearchParams({ sayfa: String(sayfa) });
    if (sorguArama) p.set('q', sorguArama);
    if (sinav) p.set('sinav', sinav);
    if (adim) p.set('adim', adim);
    if (kaynak) p.set('kaynak', kaynak);
    if (arandi) p.set('arandi', arandi);
    if (etiket) p.set('etiket', etiket);
    if (saat) p.set('saat', saat);

    try {
      const veri = await apiFetch<Cevap>(`/api/admin/basvurular?${p.toString()}`);
      if (no !== istekNo.current) return;
      setCevap(veri);
      setHata(null);
    } catch (err) {
      if (no !== istekNo.current) return;
      setHata(err instanceof ApiRequestError ? err.message : 'Başvurular alınamadı.');
    } finally {
      if (no === istekNo.current) setYukleniyor(false);
    }
  }, [sayfa, sorguArama, sinav, adim, kaynak, arandi, etiket, saat]);

  useEffect(() => {
    void getir();
  }, [getir]);

  async function takipYaz(id: string, govde: TakipGovdesi): Promise<boolean> {
    setKaydedilenler((k) => new Set(k).add(id));
    setTakipHata((h) => (h?.id === id ? null : h));
    try {
      const yeni = await apiFetch<Takip>(`/api/admin/basvurular/${id}`, { method: 'PATCH', body: govde });
      const takip: Takip = {
        contactedAt: yeni.contactedAt,
        note: yeni.note,
        noteUpdatedAt: yeni.noteUpdatedAt,
        trialTaken: yeni.trialTaken,
        needsFollowup: yeni.needsFollowup,
        callTimeSlot: yeni.callTimeSlot,
      };
      setCevap((c) => c && { ...c, leads: c.leads.map((l) => (l.id === id ? { ...l, ...takip } : l)) });
      return true;
    } catch (err) {
      setTakipHata({ id, mesaj: err instanceof ApiRequestError ? err.message : 'Kaydedilemedi.' });
      return false;
    } finally {
      setKaydedilenler((k) => {
        const y = new Set(k);
        y.delete(id);
        return y;
      });
    }
  }

  function notAc(b: Basvuru) {
    setNotAcik(notAcik === b.id ? null : b.id);
    setNotTaslak(b.note ?? '');
  }

  async function notKaydet(id: string) {
    if (await takipYaz(id, { note: notTaslak })) setNotAcik(null);
  }

  function sayfayaGit(yeni: number) {
    setSayfa(yeni);
    /* Sayfa düğmeleri listenin altında; yeni sayfa da yukarıdan okunur. */
    ustRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const basvurular = cevap?.leads ?? [];
  const toplam = cevap?.total ?? 0;
  const boyut = cevap?.pageSize ?? 50;
  const sonSayfa = Math.max(1, Math.ceil(toplam / boyut));
  const ilk = toplam === 0 ? 0 : (sayfa - 1) * boyut + 1;
  const son = Math.min(sayfa * boyut, toplam);
  const filtreVar = Boolean(sorguArama || sinav || adim || kaynak || arandi || etiket || saat);
  const metaBagliDegil = cevap?.metaConfigured === false;
  const takipKapali = cevap?.followupAvailable === false;

  /*
   * Takip kontrolleri hem kartta hem tabloda kullanılıyor. Bileşen değil
   * düz fonksiyon: AdminLeads'in içinde tanımlanan bir bileşen her render'da
   * yeni bir tür olur ve React onu baştan kurar — not yazılırken metin
   * alanı her tuşta odağını kaybederdi.
   */
  const aradiKutusu = (b: Basvuru, metinli: boolean) => (
    <label
      title={
        b.contactedAt
          ? `${sadeceTarih(b.contactedAt)} ${sadeceSaat(b.contactedAt)}'te arandı olarak işaretlendi.`
          : 'Arandı olarak işaretle'
      }
      className={`inline-flex items-center gap-2 ${takipKapali ? '' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        checked={Boolean(b.contactedAt)}
        disabled={takipKapali || kaydedilenler.has(b.id)}
        onChange={(e) => void takipYaz(b.id, { contacted: e.target.checked })}
        aria-label={metinli ? undefined : `${b.fullName} arandı`}
        className="h-5 w-5 shrink-0 cursor-pointer accent-emerald-600 disabled:cursor-not-allowed"
      />
      {metinli && <span className="text-sm font-semibold text-slate-700">Arandı</span>}
    </label>
  );

  const etiketDugmeleri = (b: Basvuru) => (
    <div className="flex flex-wrap gap-1.5">
      {ETIKETLER.map((e) => {
        const acik = b[e.alan];
        return (
          <button
            key={e.alan}
            type="button"
            aria-pressed={acik}
            disabled={takipKapali || kaydedilenler.has(b.id)}
            onClick={() => void takipYaz(b.id, { [e.alan]: !acik })}
            className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              acik
                ? e.acikSinif
                : 'border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700'
            }`}
          >
            {e.etiket}
          </button>
        );
      })}
    </div>
  );

  const notDugmesi = (b: Basvuru) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => notAc(b)}
      disabled={takipKapali}
      aria-expanded={notAcik === b.id}
      className="-ml-2"
    >
      <StickyNote className="h-4 w-4" aria-hidden="true" />
      {b.note ? 'Notu düzenle' : 'Not ekle'}
    </Button>
  );

  const notBolumu = (b: Basvuru) => {
    const kaydediliyor = kaydedilenler.has(b.id);
    if (notAcik === b.id) {
      return (
        <div>
          <MetinAlani
            value={notTaslak}
            onChange={(e) => setNotTaslak(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNotAcik(null);
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void notKaydet(b.id);
            }}
            aria-label={`${b.fullName} için not`}
            placeholder="Görüşme notu: ne konuşuldu, ne zaman tekrar aranacak…"
            rows={3}
            maxLength={NOT_MAKS}
            disabled={kaydediliyor}
            autoFocus
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void notKaydet(b.id)} disabled={kaydediliyor}>
              {kaydediliyor ? 'Kaydediliyor...' : 'Notu kaydet'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setNotAcik(null)}>
              Vazgeç
            </Button>
            <span className="text-xs text-slate-400">
              Yalnızca yöneticiler görür. Boş bırakıp kaydederseniz kaldırılır.
            </span>
          </div>
        </div>
      );
    }
    if (!b.note) return null;
    return (
      <div className="rounded-xl bg-[#c5a059]/10 px-3 py-2">
        <p className="whitespace-pre-line text-sm text-slate-700">{b.note}</p>
        {b.noteUpdatedAt && (
          <p className="mt-1 text-[11px] tabular-nums text-slate-400">
            {sadeceTarih(b.noteUpdatedAt)} · {sadeceSaat(b.noteUpdatedAt)}
          </p>
        )}
      </div>
    );
  };

  const takipHatasi = (b: Basvuru) =>
    takipHata?.id === b.id ? (
      <p role="alert" className="text-xs font-semibold text-rose-700">
        {takipHata.mesaj}
      </p>
    ) : null;

  return (
    <div ref={ustRef} className="scroll-mt-4">
      <Kutu
        baslik="Form başvuruları"
        ikon={<Inbox className="h-5 w-5" />}
        sag={
          <span className="text-xs text-slate-400">
            {cevap ? `${toplam} başvuru` : ''}
          </span>
        }
      >
        {hata && <Uyari tur="hata">{hata}</Uyari>}

        <div
          role="radiogroup"
          aria-label="Başvuru kaynağı"
          className="mb-3 inline-flex rounded-xl bg-slate-100 p-1"
        >
          {KAYNAKLAR.map((k) => (
            <button
              key={k.deger || 'hepsi'}
              type="button"
              role="radio"
              aria-checked={kaynak === k.deger}
              onClick={() => {
                setKaynak(k.deger);
                setSayfa(1);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                kaynak === k.deger
                  ? 'bg-white text-[#191F61] shadow-sm'
                  : 'text-slate-500 hover:text-[#191F61]'
              }`}
            >
              {k.etiket}
            </button>
          ))}
        </div>

        {kaynak === 'meta' && metaBagliDegil && (
          <Uyari tur="hata">
            Meta bağlantısı henüz kurulmamış: sunucuda META_SHEETS_KEY tanımlı değil. Tanımlanana
            kadar Google Sheets'teki Meta başvuruları buraya aktarılmaz.
          </Uyari>
        )}

        {takipKapali && (
          <Uyari tur="hata">
            Arandı işareti, etiketler ve notlar için veritabanı güncellemesi eksik: Supabase SQL
            Editor'de supabase-lead-followup.sql çalıştırılmalı.
          </Uyari>
        )}

        <div className="mb-2 flex gap-2">
          <label className="relative block flex-1">
            <span className="sr-only">Ad veya telefon ara</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Girdi
              type="search"
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              placeholder="Ad veya telefon ara"
              className="pl-9"
            />
          </label>
          <Button
            variant="soft"
            size="sm"
            onClick={() => void getir()}
            disabled={yukleniyor}
            aria-label="Listeyi yenile"
          >
            <RefreshCw className={`h-4 w-4 ${yukleniyor ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Secim
            aria-label="Hedef sınav"
            value={sinav}
            onChange={(e) => {
              setSinav(e.target.value);
              setSayfa(1);
            }}
          >
            <option value="">Tüm sınavlar</option>
            <option value="YKS">YKS</option>
            <option value="LGS">LGS</option>
            <option value="Diğer">Diğer</option>
          </Secim>

          <Secim
            aria-label="Başvuru durumu"
            value={adim}
            onChange={(e) => {
              setAdim(e.target.value);
              setSayfa(1);
            }}
          >
            <option value="">Tüm başvurular</option>
            <option value="2">Tamamlanan</option>
            <option value="1">Yarım kalan</option>
          </Secim>

          <Secim
            aria-label="Arama durumu"
            value={arandi}
            onChange={(e) => {
              setArandi(e.target.value);
              setSayfa(1);
            }}
          >
            <option value="">Aranan + aranmayan</option>
            <option value="0">Aranmayanlar</option>
            <option value="1">Arananlar</option>
          </Secim>

          <Secim
            aria-label="Etiket"
            value={etiket}
            onChange={(e) => {
              setEtiket(e.target.value);
              setSayfa(1);
            }}
          >
            <option value="">Tüm etiketler</option>
            <option value="deneme">Deneme dersi alındı</option>
            <option value="takip">Takip gerekli</option>
          </Secim>

          <Secim
            aria-label="Aranmak istediği saat"
            value={saat}
            onChange={(e) => {
              setSaat(e.target.value);
              setSayfa(1);
            }}
          >
            <option value="">Tüm saatler</option>
            {ARANMA_DILIMLERI.map((d) => (
              <option key={d.deger} value={d.deger}>
                {d.etiket}
              </option>
            ))}
            <option value="yok">Saat belirtilmemiş</option>
          </Secim>
        </div>

        {!cevap && yukleniyor ? (
          <p className="py-8 text-center text-sm text-slate-500">Yükleniyor...</p>
        ) : basvurular.length === 0 ? (
          <Bos>{filtreVar ? 'Bu filtreyle eşleşen başvuru yok.' : 'Henüz başvuru yok.'}</Bos>
        ) : (
          <div
            aria-busy={yukleniyor}
            className={`transition-opacity ${yukleniyor ? 'opacity-60' : ''}`}
          >
            {/* MOBİL: kart listesi. On kolonlu tablo telefonda okunmuyor. */}
            <ul className="space-y-2 lg:hidden">
              {basvurular.map((b) => (
                <li
                  key={b.id}
                  className={`rounded-2xl border p-3 ${
                    b.contactedAt ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-[#191F61]">
                        {b.fullName}
                        {rolGoster(b) && (
                          <span className="ml-1.5 text-xs font-medium text-slate-500">
                            ({rolGoster(b)})
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {sadeceTarih(b.createdAt)} · {sadeceSaat(b.createdAt)}
                      </p>
                    </div>
                    <DurumRozeti b={b} />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <Telefon tel={b.phone} />
                    <AranmaSaati dilim={b.callTimeSlot} />
                  </div>

                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="font-bold text-slate-400">Sınav</dt>
                    <dd className="text-slate-700"><Deger v={b.examType} /></dd>
                    <dt className="font-bold text-slate-400">Öğrenci</dt>
                    <dd className="text-slate-700"><Deger v={b.studentFullName} /></dd>
                    <dt className="font-bold text-slate-400">Veli</dt>
                    <dd className="text-slate-700"><Deger v={b.parentFullName} /></dd>
                    <dt className="font-bold text-slate-400">Sınıf</dt>
                    <dd className="text-slate-700"><Deger v={b.gradeClass} /></dd>
                    {/* Meta formunda ders sorusu yok; yerine formun kendi
                        cevapları aşağıda. */}
                    {b.source !== 'meta' && (
                      <>
                        <dt className="font-bold text-slate-400">Dersler</dt>
                        <dd className="text-slate-700">
                          <Deger v={b.subjects.join(', ')} />
                        </dd>
                      </>
                    )}
                  </dl>
                  <MetaAlanlari b={b} />

                  <div className="mt-3 space-y-2 border-t border-slate-200/70 pt-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {aradiKutusu(b, true)}
                      {etiketDugmeleri(b)}
                    </div>
                    {notBolumu(b)}
                    {notAcik !== b.id && notDugmesi(b)}
                    {takipHatasi(b)}
                  </div>
                </li>
              ))}
            </ul>

            {/* MASAÜSTÜ: tablo. Geniş içerik kendi içinde kayar, sayfa
                gövdesi yatay kaymaz. */}
            <div className="-mx-4 hidden overflow-x-auto px-4 lg:block sm:-mx-6 sm:px-6">
              <table className="w-full min-w-[1280px] border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className={TH}>Arandı</th>
                    <th className={TH}>Tarih</th>
                    <th className={TH}>Saat</th>
                    <th className={TH}>Ad Soyad</th>
                    <th className={TH}>Telefon</th>
                    <th className={TH}>Sınav</th>
                    <th className={TH}>Öğrenci</th>
                    <th className={TH}>Veli</th>
                    <th className={TH}>Sınıf</th>
                    <th className={TH}>Dersler / Form</th>
                    <th className={TH}>Durum</th>
                    <th className={TH}>Takip</th>
                  </tr>
                </thead>
                <tbody>
                  {basvurular.map((b) => {
                    const notSatiri = notAcik === b.id || Boolean(b.note);
                    const t = notSatiri ? TD_UST : TD;
                    const zemin = b.contactedAt ? 'bg-emerald-50/40' : '';
                    return (
                      <React.Fragment key={b.id}>
                        <tr className={zemin || 'hover:bg-slate-50/70'}>
                          <td className={`${t} text-center`}>
                            {aradiKutusu(b, false)}
                            {b.contactedAt && (
                              <span className="block whitespace-nowrap text-[10px] tabular-nums text-emerald-700">
                                {sadeceTarih(b.contactedAt)}
                              </span>
                            )}
                          </td>
                          <td className={`${t} whitespace-nowrap tabular-nums`}>
                            {sadeceTarih(b.createdAt)}
                          </td>
                          <td className={`${t} whitespace-nowrap tabular-nums text-slate-500`}>
                            {sadeceSaat(b.createdAt)}
                          </td>
                          <td className={t}>
                            <span className="font-bold text-[#191F61]">{b.fullName}</span>
                            {rolGoster(b) && (
                              <span className="block text-xs text-slate-500">{rolGoster(b)}</span>
                            )}
                          </td>
                          <td className={t}>
                            <Telefon tel={b.phone} />
                            {b.callTimeSlot && (
                              <div className="mt-1">
                                <AranmaSaati dilim={b.callTimeSlot} />
                              </div>
                            )}
                          </td>
                          <td className={`${t} whitespace-nowrap`}>
                            <Deger v={b.examType} />
                          </td>
                          <td className={t}>
                            <Deger v={b.studentFullName} />
                          </td>
                          <td className={t}>
                            <Deger v={b.parentFullName} />
                          </td>
                          <td className={`${t} whitespace-nowrap`}>
                            <Deger v={b.gradeClass} />
                          </td>
                          <td className={`${t} max-w-[240px] text-xs`}>
                            {b.source === 'meta' ? (
                              <MetaAlanlari b={b} bosken={<Yok />} />
                            ) : (
                              <Deger v={b.subjects.join(', ')} />
                            )}
                          </td>
                          <td className={t}>
                            <DurumRozeti b={b} />
                          </td>
                          <td className={`${t} w-[190px]`}>
                            <div className="flex flex-col items-start gap-1.5">
                              {etiketDugmeleri(b)}
                              {notAcik !== b.id && notDugmesi(b)}
                              {takipHatasi(b)}
                            </div>
                          </td>
                        </tr>
                        {notSatiri && (
                          <tr className={zemin}>
                            <td colSpan={KOLON_SAYISI} className="border-b border-slate-100 px-2 pb-3">
                              {notBolumu(b)}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {toplam > boyut && (
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="text-xs tabular-nums text-slate-500">
              {ilk}–{son} / {toplam}
            </span>
            <div className="flex gap-1.5">
              <Button
                variant="soft"
                size="sm"
                aria-label="Önceki sayfa"
                disabled={yukleniyor || sayfa <= 1}
                onClick={() => sayfayaGit(sayfa - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="soft"
                size="sm"
                aria-label="Sonraki sayfa"
                disabled={yukleniyor || sayfa >= sonSayfa}
                onClick={() => sayfayaGit(sayfa + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Kutu>
    </div>
  );
};
