import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, FileWarning, LogOut } from 'lucide-react';
import { PageMeta } from '../components/PageMeta';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import { apiFetch, ApiRequestError } from '../lib/api';
import { SITE_URL } from '../config';
import need from '../../need.json';
import { routingMode, TEACHER_PATH } from '../lib/host';
import { GUN_ADLARI, gunEkle, gunEtiketi } from '../lib/haftaTarih';
import { PanelHeader } from '../components/portal/PanelHeader';
import { DenemeRozeti } from '../components/portal/DenemeRozeti';
import {
  TeacherLessonList,
  trTarih,
  type ProgramDersi,
} from '../components/portal/TeacherLessonList';
import {
  TeacherContractModal,
  type Belgeler,
} from '../components/portal/TeacherContractModal';

/*
 * ÖĞRETMEN PANELİ — portal.sherpakademi.com/ogretmen
 * ===========================================================================
 * Öğrenci paneliyle (PortalDashboardPage) aynı host'ta, aynı çerezle, aynı
 * kabuk diliyle; ayrı olan yalnızca veri ve hangi soruyu cevapladığı:
 *
 *   öğrenci paneli  -> "benim derslerim, denemelerim, ödemelerim"
 *   öğretmen paneli -> "benim verdiğim dersler"
 *
 * Veri /api/teacher/* üzerinden geliyor. O uçlar rol kapısının arkasında
 * (server/roles.ts) ve sorguları öğretmenin kendi jetonuyla, RLS altında
 * çalıştırıyor — yani bu sayfa başka bir öğretmenin programını hiçbir
 * durumda göremez. Hangi öğretmenin programı olduğu istemciden SORULMUYOR;
 * sunucu oturumdan biliyor.
 *
 * DERS EKLEME ve SİLME burada YOK, ikisi de bilinçli: dersi açmak da
 * kaldırmak da yönetim işi (admin panelindeki "ders ata"). Öğretmen 2026-09-24
 * ile 2026-10-09 arasında kendi öğrencilerine ders açabiliyordu; bu yetki
 * geri alındı. Öğretmenin elindeki tek yazma, dersi /status ucuyla
 * 'completed' ile 'scheduled' arasında çevirmek ve yorum yazmak.
 *
 * SÖZLEŞME KAPISI: panel, öğretmen sözleşmesi onaylanmadan açılmıyor. Kapı
 * route'ta değil SAYFANIN İÇİNDE, çünkü bu sayfa iki adreste yaşıyor
 * (portal host'unda /ogretmen, 'both' modunda /panel/ogretmen) ve kapının
 * ikisinde de geçerli olması gerekiyor. Önce /api/teacher/sozlesme
 * soruluyor; program ancak cevap "onaylı" (ya da "henüz sözleşme yok")
 * olunca çekiliyor. Bu da bir güvenlik sınırı değil — sunucu, onay yokken
 * /api/teacher/* uçlarının hepsini 403 SOZLESME_GEREKLI ile reddediyor.
 */

/*
 * ProgramDersi ve trTarih TeacherLessonList'ten geliyor: ızgara ile liste
 * AYNI veriyi gösteriyor, tipin iki ayrı yerde yaşaması ikisinin sessizce
 * ayrışması demekti (yorum alanı eklendiğinde tam olarak bu olurdu).
 */
interface ProgramCevabi {
  weekStart: string;
  lessons: ProgramDersi[];
}

type SozlesmeCevabi =
  | { success: true; gerekli: false }
  | { success: true; gerekli: true; belgeler: Belgeler };

/*
 * Sözleşme kapısının durumu:
 *   kontrol -> soruluyor; panel henüz çizilmiyor
 *   gerekli -> onay penceresi, arkasında panel YOK
 *   tamam   -> onaylı ya da henüz yayınlanmış bir sözleşme yok; panel açık
 *   hata    -> durum öğrenilemedi; içeri ALINMIYOR (sunucu zaten 403 dönerdi),
 *              yeniden deneme düğmesi gösteriliyor
 */
type SozlesmeDurumu =
  | { durum: 'kontrol' }
  | { durum: 'gerekli'; belgeler: Belgeler }
  | { durum: 'tamam' }
  | { durum: 'hata'; mesaj: string };

/*
 * SAAT DİLİMİ AÇIKÇA BELİRTİLİYOR, tarayıcının yereline BIRAKILMIYOR.
 * Program Türkiye saatiyle konuşulan bir şey: yurt dışındaki bir öğretmen
 * panelini açtığında dersinin "09:00"da olduğunu görmeli, kendi saatiyle
 * 06:00 değil. Sunucu da hafta sınırlarını +03:00 ile kuruyor
 * (server/weekUtils.ts) — iki taraf aynı varsayımda.
 */
const TZ = 'Europe/Istanbul';

/** timestamptz -> Türkiye'deki saat (0-23). Izgaradaki satırı belirler. */
function trSaatNo(iso: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(
      new Date(iso)
    )
  );
}

/** timestamptz -> "14:30". */
function trSaatMetni(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

const DURUM_ETIKET: Record<ProgramDersi['status'], { metin: string; sinif: string }> = {
  scheduled: { metin: 'Planlandı', sinif: 'bg-[#191F61]/10 text-[#191F61]' },
  completed: { metin: 'İşlendi', sinif: 'bg-emerald-100 text-emerald-800' },
  cancelled: { metin: 'İptal', sinif: 'bg-slate-200 text-slate-600' },
};

/* Izgaranın varsayılan aralığı. Bu aralığın dışına düşen bir ders varsa
   aralık ona göre GENİŞLİYOR (aşağıda) — sabit bir pencere, saat 22:00'deki
   bir dersi görünmez kılardı. */
const VARSAYILAN_ILK_SAAT = 9;
const VARSAYILAN_SON_SAAT = 21;

/** Tek bir dersin kartı. Izgarada ve mobil listede aynı bileşen. */
const DersKarti: React.FC<{ ders: ProgramDersi; saatGoster?: boolean }> = ({
  ders,
  saatGoster = false,
}) => {
  const durum = DURUM_ETIKET[ders.status];

  return (
    <div
      className={`rounded-lg border p-2 text-left ${
        ders.status === 'cancelled'
          ? 'border-slate-200 bg-slate-50 opacity-70'
          : 'border-[#191F61]/15 bg-[#191F61]/5'
      }`}
    >
      {saatGoster && (
        <p className="text-xs font-bold text-slate-500">
          {trSaatMetni(ders.startsAt)}
          {ders.endsAt ? ` – ${trSaatMetni(ders.endsAt)}` : ''}
        </p>
      )}
      <p className="truncate text-sm font-bold text-[#191F61]" title={ders.studentName ?? ''}>
        {ders.studentName ?? 'İsimsiz öğrenci'}
      </p>
      <p className="truncate text-xs text-slate-600" title={ders.subject}>
        {ders.subject}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <span
          className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${durum.sinif}`}
        >
          {durum.metin}
        </span>
        {ders.isTrial && <DenemeRozeti />}
      </div>
    </div>
  );
};

export const TeacherDashboardPage: React.FC = () => {
  const { user, logout } = useAuth();
  const [sozlesme, setSozlesme] = useState<SozlesmeDurumu>({ durum: 'kontrol' });
  const [program, setProgram] = useState<ProgramCevabi | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);

  /*
   * Sözleşme durumunu sor. `sessiz`: ekranı "Yükleniyor"a çevirmeden yenile —
   * onay penceresi 409 sonrası belgeleri yeniden çekerken kullanıyor; aksi
   * halde pencere sökülüp yeniden kurulur ve gösterdiği mesaj kaybolurdu.
   */
  const sozlesmeKontrol = useCallback(async (sessiz = false) => {
    if (!sessiz) setSozlesme({ durum: 'kontrol' });

    try {
      const cevap = await apiFetch<SozlesmeCevabi>('/api/teacher/sozlesme');
      setSozlesme(
        cevap.gerekli ? { durum: 'gerekli', belgeler: cevap.belgeler } : { durum: 'tamam' }
      );
    } catch (err) {
      setSozlesme({
        durum: 'hata',
        mesaj:
          err instanceof ApiRequestError ? err.message : 'Sözleşme onay durumu öğrenilemedi.',
      });
    }
  }, []);

  useEffect(() => {
    void sozlesmeKontrol();
  }, [sozlesmeKontrol]);

  const sozlesmeTamam = sozlesme.durum === 'tamam';

  /*
   * Döngü sigortası: program isteği SOZLESME_GEREKLI dönünce kapı yeniden
   * soruluyor. Kapının cevabı ile sunucunun ara katmanı bir gün ayrışırsa
   * ("gerekli değil" deyip yine 403 verirse) bu, kontrol -> tamam -> 403 ->
   * kontrol diye sonsuza kadar dönerdi. Arka arkaya ikinci 403'te yeniden
   * sormak yerine hatayı gösteriyoruz; başarılı bir program isteği sigortayı
   * sıfırlıyor.
   */
  const sozlesmeYenidenSoruldu = useRef(false);

  /*
   * Bir istek SOZLESME_GEREKLI dönünce kapıyı yeniden sor — sigortaya
   * uyarak. true: soruldu, onay penceresi gelecek (çağıran hata göstermesin);
   * false: sigorta atmış, çağıran hatayı kendisi göstersin. Program isteği
   * ve ders listesindeki PATCH/PUT istekleri aynı yoldan geçiyor.
   */
  const sozlesmeyiYenidenSor = useCallback((): boolean => {
    if (sozlesmeYenidenSoruldu.current) return false;
    sozlesmeYenidenSoruldu.current = true;
    void sozlesmeKontrol();
    return true;
  }, [sozlesmeKontrol]);

  /*
   * İstenen hafta. null: "sunucu bugünün haftasını seçsin" — ilk açılışta
   * tarihi istemcide hesaplamak, sunucunun hafta tanımıyla (Türkiye saati)
   * ayrışma riski demekti. Sunucu cevabında weekStart'ı döndürüyor ve
   * gezinme oradan devam ediyor.
   */
  const [istenenHafta, setIstenenHafta] = useState<string | null>(null);

  const getir = useCallback((hafta: string | null) => {
    setYukleniyor(true);

    const yol = hafta ? `/api/teacher/schedule?week=${hafta}` : '/api/teacher/schedule';

    return apiFetch<ProgramCevabi>(yol)
      .then((veri) => {
        sozlesmeYenidenSoruldu.current = false;
        setProgram(veri);
        setHata(null);
      })
      .catch((err) => {
        /* Sunucu sözleşme onayı istiyorsa hata satırı değil, onay penceresi
           doğru cevap — kapı yeniden soruluyor (bir kez; bkz. sigorta). */
        if (
          err instanceof ApiRequestError &&
          err.code === 'SOZLESME_GEREKLI' &&
          sozlesmeyiYenidenSor()
        ) {
          return;
        }
        setHata(err instanceof ApiRequestError ? err.message : 'Ders programı alınamadı.');
      })
      .finally(() => {
        setYukleniyor(false);
      });
  }, [sozlesmeyiYenidenSor]);

  /*
   * Bir satır işaretlenince/yorumlanınca TÜM haftayı yeniden çekmiyoruz:
   * yalnızca o ders güncelleniyor. Yeniden çekmek, o sırada başka bir
   * satırda yazılmakta olan metni ve açık satırı sıfırlardı — ayrıca
   * sunucu zaten değişen alanı cevabında döndürüyor.
   */
  const dersGuncelle = useCallback((id: string, degisiklik: Partial<ProgramDersi>) => {
    setProgram((onceki) =>
      onceki
        ? {
            ...onceki,
            lessons: onceki.lessons.map((d) => (d.id === id ? { ...d, ...degisiklik } : d)),
          }
        : onceki
    );
  }, []);

  /* Program yalnızca sözleşme kapısı açıkken çekiliyor: onaysız bir istek
     zaten 403 dönerdi, üstelik onay penceresinin arkasında boşuna. */
  useEffect(() => {
    if (!sozlesmeTamam) return;
    let iptal = false;
    void getir(istenenHafta).then(() => {
      if (iptal) return;
    });
    return () => {
      iptal = true;
    };
  }, [getir, istenenHafta, sozlesmeTamam]);

  const haftaBasi = program?.weekStart ?? null;

  /* Haftanın yedi günü, "YYYY-MM-DD" listesi. Izgaranın sütunları. */
  const gunler = useMemo(
    () => (haftaBasi ? Array.from({ length: 7 }, (_, i) => gunEkle(haftaBasi, i)) : []),
    [haftaBasi]
  );

  /* Gün -> o günün dersleri. Izgara her hücrede listeyi taramasın diye
     tek seferde kuruluyor. */
  const gunlereGore = useMemo(() => {
    const harita = new Map<string, ProgramDersi[]>();
    for (const ders of program?.lessons ?? []) {
      const gun = trTarih(ders.startsAt);
      const mevcut = harita.get(gun);
      if (mevcut) mevcut.push(ders);
      else harita.set(gun, [ders]);
    }
    return harita;
  }, [program]);

  /* Izgaranın saat aralığı: varsayılan 09-21, ama dışına taşan ders varsa
     ona göre genişliyor. */
  const saatler = useMemo(() => {
    let ilk = VARSAYILAN_ILK_SAAT;
    let son = VARSAYILAN_SON_SAAT;

    for (const ders of program?.lessons ?? []) {
      const baslangic = trSaatNo(ders.startsAt);
      if (baslangic < ilk) ilk = baslangic;
      if (baslangic > son) son = baslangic;
    }

    return Array.from({ length: son - ilk + 1 }, (_, i) => ilk + i);
  }, [program]);

  const dersVar = (program?.lessons.length ?? 0) > 0;
  const ilkAd = user?.fullName?.trim().split(' ')[0];
  const yerel = routingMode() === 'both';

  /* Öğrenci panelindeki gerekçenin aynısı: panel kendi alt alan adında
     yaşıyor, adresi ana siteninki değil. 'both' modunda (localhost/
     önizleme) ayrı host olmadığı için ana origin doğru cevap. */
  const meta = (
    <PageMeta
      title="Öğretmen Paneli | Sherpa Akademi"
      description="Sherpa Akademi öğretmen paneli."
      origin={yerel ? SITE_URL : need.portal.domain}
      path={yerel ? `/panel${TEACHER_PATH}` : TEACHER_PATH}
      noIndex
    />
  );

  /* Erken dönüşler bütün hook'lardan SONRA: hook sırası her render'da aynı
     kalmalı. RequireAuth/RequireRole'un yükleme ekranıyla aynı görünüm. */
  if (sozlesme.durum === 'kontrol') {
    return (
      <>
        {meta}
        <div className="flex min-h-dvh items-center justify-center bg-slate-50">
          <p className="text-sm font-medium text-slate-500">Yükleniyor...</p>
        </div>
      </>
    );
  }

  if (sozlesme.durum === 'hata') {
    return (
      <>
        {meta}
        <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
              <FileWarning className="h-6 w-6" />
            </span>
            <h1 className="text-xl font-extrabold tracking-tight text-[#191F61]">
              Panel şu an açılamadı
            </h1>
            <p role="alert" className="mt-2 text-sm text-slate-600">
              {sozlesme.mesaj}
            </p>
            <div className="mt-6 flex flex-col items-center gap-2">
              <Button onClick={() => void sozlesmeKontrol()}>Tekrar dene</Button>
              <Button variant="ghost" size="sm" onClick={() => void logout()}>
                <LogOut className="h-4 w-4" />
                Çıkış yap
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  /*
   * Onay penceresi açıkken ARKADA PANEL ÇİZİLMİYOR — ne PanelHeader ne
   * program. Bilinçli: arkada etkileşimli eleman olmayınca Tab'ın kaçacağı
   * bir yer kalmıyor, ayrıca bir odak tuzağı yazmaya gerek yok; ve panelin
   * hiçbir parçası (başlıktaki bağlantılar dahil) onaydan önce kullanılamıyor.
   * Çıkış düğmesi pencerenin kendisinde.
   */
  if (sozlesme.durum === 'gerekli') {
    return (
      <>
        {meta}
        <div className="min-h-dvh bg-slate-50" />
        <TeacherContractModal
          belgeler={sozlesme.belgeler}
          onKabul={() => setSozlesme({ durum: 'tamam' })}
          onYenile={() => sozlesmeKontrol(true)}
        />
      </>
    );
  }

  return (
    <>
      {meta}

      <div className="min-h-dvh bg-slate-50">
        <PanelHeader rozet={{ metin: 'Öğretmen', ton: 'mint' }} genislik="max-w-6xl" />

        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
          <div className="mb-8">
            <h1 className="text-3xl font-extrabold tracking-tight text-[#191F61] sm:text-4xl">
              Hoş geldiniz{ilkAd ? `, ${ilkAd}` : ''}.
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Verdiğiniz derslerin haftalık programı.
            </p>
          </div>

          {hata && (
            <p
              role="alert"
              className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700"
            >
              {hata}
            </p>
          )}

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            {/* HAFTA GEZİNMESİ */}
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#191F61]/10 text-[#191F61]">
                <CalendarDays className="h-5 w-5" />
              </span>

              <div className="mr-auto">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                  Haftalık program
                </h2>
                {haftaBasi && (
                  <p className="text-xs text-slate-500">
                    {gunEtiketi(haftaBasi)} – {gunEtiketi(gunEkle(haftaBasi, 6))}
                  </p>
                )}
              </div>

              {/* Bugüne dönüş: null göndermek "sunucu bugünün haftasını
                  seçsin" demek — tarih hesabı tek yerde kalıyor. */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIstenenHafta(null)}
                disabled={yukleniyor}
              >
                Bu hafta
              </Button>

              <div className="flex gap-1.5">
                <Button
                  variant="soft"
                  size="sm"
                  aria-label="Önceki hafta"
                  disabled={yukleniyor || !haftaBasi}
                  onClick={() => haftaBasi && setIstenenHafta(gunEkle(haftaBasi, -7))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="soft"
                  size="sm"
                  aria-label="Sonraki hafta"
                  disabled={yukleniyor || !haftaBasi}
                  onClick={() => haftaBasi && setIstenenHafta(gunEkle(haftaBasi, 7))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {yukleniyor ? (
              <p className="py-16 text-center text-sm text-slate-500">Yükleniyor...</p>
            ) : !dersVar ? (
              <p className="rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                Bu hafta dersiniz yok.
              </p>
            ) : (
              <>
                {/*
                  MOBİL: gün gün liste. Yedi sütunlu bir ızgara telefonda
                  okunamaz — sütun başına ~50px düşer. Saat ızgarası öğretmenin
                  haftayı bir bakışta görmesi için; telefonda o "bir bakış"
                  zaten mümkün değil, o yüzden sıralı liste daha dürüst.
                */}
                <div className="space-y-5 lg:hidden">
                  {gunler.map((gun, i) => {
                    const dersler = gunlereGore.get(gun) ?? [];
                    if (dersler.length === 0) return null;

                    return (
                      <div key={gun}>
                        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                          {GUN_ADLARI[i]} · {gunEtiketi(gun)}
                        </h3>
                        <div className="space-y-2">
                          {dersler.map((ders) => (
                            <DersKarti key={ders.id} ders={ders} saatGoster />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/*
                  MASAÜSTÜ: saat x gün ızgarası.
                  overflow-x-auto sarmalayıcı: proje kuralı gereği geniş içerik
                  kendi içinde kaysın, sayfa gövdesi yatay kaymasın.
                */}
                <div className="-mx-4 hidden overflow-x-auto px-4 lg:block">
                  <table className="w-full min-w-[900px] border-separate border-spacing-0">
                    <thead>
                      <tr>
                        <th className="w-16 border-b border-slate-200 pb-2 text-left text-xs font-bold uppercase tracking-wider text-slate-400">
                          Saat
                        </th>
                        {gunler.map((gun, i) => (
                          <th
                            key={gun}
                            className="border-b border-slate-200 px-1.5 pb-2 text-left text-xs font-bold uppercase tracking-wider text-slate-500"
                          >
                            {GUN_ADLARI[i]}
                            <span className="ml-1 font-medium normal-case text-slate-400">
                              {gunEtiketi(gun)}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {saatler.map((saat) => (
                        <tr key={saat}>
                          <td className="border-b border-slate-100 py-1.5 align-top text-xs font-bold text-slate-400">
                            {String(saat).padStart(2, '0')}:00
                          </td>
                          {gunler.map((gun) => {
                            const hucre = (gunlereGore.get(gun) ?? []).filter(
                              (d) => trSaatNo(d.startsAt) === saat
                            );

                            return (
                              <td
                                key={`${gun}-${saat}`}
                                className="border-b border-slate-100 px-1.5 py-1.5 align-top"
                              >
                                <div className="space-y-1.5">
                                  {hucre.map((ders) => (
                                    <DersKarti key={ders.id} ders={ders} saatGoster />
                                  ))}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          {/*
            Aynı haftanın dersleri, bu kez satır satır ve dokunulabilir.
            Izgara "hafta nasıl görünüyor"u, liste "ne yapmam gerekiyor"u
            cevaplıyor; ikisi de tek istekten (program) besleniyor, o yüzden
            bir satır işaretlenince ızgaradaki rozeti de anında değişiyor.
          */}
          <TeacherLessonList
            lessons={program?.lessons ?? []}
            onGuncelle={dersGuncelle}
            onSozlesmeGerekli={sozlesmeyiYenidenSor}
          />
        </main>
      </div>
    </>
  );
};
