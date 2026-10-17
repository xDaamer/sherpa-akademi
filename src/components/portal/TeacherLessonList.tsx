import React, { useState } from 'react';
import { Check, ChevronDown, ListChecks, Undo2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { apiFetch, ApiRequestError } from '../../lib/api';
import { DenemeRozeti } from './DenemeRozeti';

/*
 * HAFTANIN DERSLERİ — SATIR SATIR, TIKLANABİLİR
 * ===========================================================================
 * Üstteki ızgara "hafta nasıl görünüyor" sorusunu cevaplıyor; burası
 * "ne yapmam gerekiyor" sorusunu. Aynı veriden besleniyorlar (tek istek,
 * /api/teacher/schedule) — ızgara bakmak için, liste dokunmak için.
 *
 * AKIŞ: ders satırına tıkla -> açılır -> "Ders işlendi" -> yorum kutusu.
 * Yorum yalnızca tamamlanmış derse yazılabildiği için (sunucu 400 ile
 * reddediyor) sıra tersine çevrilemez; arayüz de bu sırayı dayatıyor ki
 * kullanıcı reddedilecek bir şeyi hiç denemesin.
 *
 * VURGULAMA: günü gelmiş dersler öne çıkıyor. Bir öğretmen panele genelde
 * "bugün ne vardı, işaretledim mi" diye bakar; haftanın tamamı aynı ağırlıkta
 * gösterilseydi o soru her seferinde gözle taranırdı.
 *   bugün          -> altın çerçeve + "Bugün" rozeti
 *   geçmiş + işaretlenmemiş -> "işaretlenmedi" uyarısı (yapılacak iş)
 *   gelecek        -> sakin
 */

const TZ = 'Europe/Istanbul';
const MAKS = 2000;

export interface Yorum {
  text: string;
  updatedAt: string;
}

export interface ProgramDersi {
  id: string;
  subject: string;
  startsAt: string;
  endsAt: string | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  kind: 'ders' | 'koclu';
  isTrial: boolean;
  studentId: string;
  studentName: string | null;
  comment: Yorum | null;
}

/** timestamptz -> Türkiye'deki takvim günü, "2026-09-08". */
export function trTarih(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

function trSaat(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function trGunAdi(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(iso));
}

/** Bugünün Türkiye'deki tarihi — sunucunun +03:00 varsayımıyla aynı. */
function bugunTR(): string {
  return trTarih(new Date().toISOString());
}

const DURUM_ETIKET: Record<ProgramDersi['status'], { metin: string; sinif: string }> = {
  scheduled: { metin: 'Planlandı', sinif: 'bg-slate-100 text-slate-600' },
  completed: { metin: 'İşlendi', sinif: 'bg-emerald-100 text-emerald-800' },
  cancelled: { metin: 'İptal', sinif: 'bg-slate-200 text-slate-500' },
};

/*
 * SÖZLEŞME KAPISI: panel açıkken bir öğretmen sözleşmesi yayınlanırsa bu
 * satırdaki PATCH/PUT istekleri 403 SOZLESME_GEREKLI dönüyor. Ham 403
 * metnini satırın altına basmak yerine sayfaya haber veriliyor; sayfa kapıyı
 * yeniden sorup onay penceresini açıyor. İşleyici `false` dönerse (sayfanın
 * döngü sigortası atmış, bkz. TeacherDashboardPage) iş satıra geri kalıyor
 * ve mesaj her zamanki gibi gösteriliyor — sessizce yutulmuyor.
 */
type SozlesmeGerekliIsleyici = () => boolean | void;

function sozlesmeyeDevredildi(err: unknown, isleyici?: SozlesmeGerekliIsleyici): boolean {
  if (!isleyici) return false;
  if (!(err instanceof ApiRequestError) || err.code !== 'SOZLESME_GEREKLI') return false;
  return isleyici() !== false;
}

const DersSatiri: React.FC<{
  ders: ProgramDersi;
  acik: boolean;
  onAcKapa: () => void;
  onGuncelle: (id: string, degisiklik: Partial<ProgramDersi>) => void;
  onSozlesmeGerekli?: SozlesmeGerekliIsleyici;
}> = ({ ders, acik, onAcKapa, onGuncelle, onSozlesmeGerekli }) => {
  const [metin, setMetin] = useState(ders.comment?.text ?? '');
  const [mesgul, setMesgul] = useState(false);
  const [kaydedildi, setKaydedildi] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const bugun = bugunTR();
  const gun = trTarih(ders.startsAt);
  const bugunMu = gun === bugun;
  const gecmisMi = gun < bugun;
  /* "Yapılacak iş": günü geçmiş ama hâlâ işaretlenmemiş ders. */
  const bekliyor = (gecmisMi || bugunMu) && ders.status === 'scheduled';

  const temiz = metin.trim();
  const degisti = temiz !== (ders.comment?.text ?? '');
  const yorumGonderilebilir = degisti && temiz.length > 0 && temiz.length <= MAKS && !mesgul;

  async function durumDegistir(yeni: 'completed' | 'scheduled') {
    setMesgul(true);
    setHata(null);
    try {
      await apiFetch(`/api/teacher/lessons/${ders.id}/status`, {
        method: 'PATCH',
        body: { status: yeni },
      });
      onGuncelle(ders.id, { status: yeni });
    } catch (err) {
      if (sozlesmeyeDevredildi(err, onSozlesmeGerekli)) return;
      setHata(err instanceof ApiRequestError ? err.message : 'Ders durumu güncellenemedi.');
    } finally {
      setMesgul(false);
    }
  }

  async function yorumKaydet() {
    if (!yorumGonderilebilir) return;
    setMesgul(true);
    setHata(null);
    setKaydedildi(false);
    try {
      const cevap = await apiFetch<{ comment: Yorum | null }>(
        `/api/teacher/lessons/${ders.id}/comment`,
        { method: 'PUT', body: { comment: temiz } }
      );
      if (cevap.comment) {
        onGuncelle(ders.id, { comment: cevap.comment });
        setKaydedildi(true);
      }
    } catch (err) {
      if (sozlesmeyeDevredildi(err, onSozlesmeGerekli)) return;
      setHata(err instanceof ApiRequestError ? err.message : 'Yorum kaydedilemedi.');
    } finally {
      setMesgul(false);
    }
  }

  const durum = DURUM_ETIKET[ders.status];

  return (
    <li
      className={`overflow-hidden rounded-2xl border transition-colors ${
        bugunMu
          ? 'border-[#c5a059] bg-[#c5a059]/5'
          : ders.status === 'cancelled'
            ? 'border-slate-200 bg-slate-50'
            : 'border-slate-200 bg-white'
      }`}
    >
      {/*
        Satırın tamamı düğme: küçük bir ok simgesine nişan almak yerine
        istenen yere tıklanabilsin. <button> seçildi ki klavyeyle de
        açılabilsin (div + onClick olsaydı sekme sırasına girmezdi).
      */}
      <button
        type="button"
        onClick={onAcKapa}
        aria-expanded={acik}
        className="flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c5a059] focus-visible:ring-inset"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-bold text-[#191F61]">
              {ders.studentName ?? 'İsimsiz öğrenci'}
            </span>
            <span className="truncate text-sm text-slate-600">{ders.subject}</span>
            {ders.isTrial && <DenemeRozeti />}
            {bugunMu && (
              <span className="rounded-full bg-[#c5a059] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Bugün
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {trGunAdi(ders.startsAt)} · {trSaat(ders.startsAt)}
            {ders.endsAt ? ` – ${trSaat(ders.endsAt)}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {bekliyor && (
            <span className="hidden rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 sm:inline">
              İşaretlenmedi
            </span>
          )}
          {ders.status === 'completed' && !ders.comment && (
            <span className="hidden rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 sm:inline">
              Yorum bekliyor
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${durum.sinif}`}
          >
            {durum.metin}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${acik ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {acik && (
        <div className="border-t border-slate-200 px-4 py-4">
          {ders.status === 'cancelled' ? (
            <p className="text-sm text-slate-500">
              Bu ders iptal edilmiş. İptal kaydı panelden değiştirilemez.
            </p>
          ) : ders.status === 'scheduled' ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="mr-auto text-sm text-slate-600">
                Ders işlendiyse işaretleyin; ardından öğrencinize yorum bırakabilirsiniz.
              </p>
              <Button size="sm" onClick={() => durumDegistir('completed')} disabled={mesgul}>
                {mesgul ? 'İşaretleniyor...' : 'Ders işlendi'}
              </Button>
            </div>
          ) : (
            <>
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Öğrenciye yorum
                </span>
                <textarea
                  value={metin}
                  onChange={(e) => {
                    setMetin(e.target.value);
                    /* Yazmaya başlayınca onay kalkıyor: eski bir "Kaydedildi",
                       yeni metnin de kaydedildiği izlenimini verirdi. */
                    setKaydedildi(false);
                  }}
                  rows={3}
                  maxLength={MAKS}
                  placeholder="Bu ders hakkında öğrencinize not bırakın..."
                  className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-[#191F61] focus:outline-none focus:ring-2 focus:ring-[#191F61]/20"
                />
              </label>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                {/* Sayaç yalnızca sınıra yaklaşınca beliriyor; her zaman
                    görünen bir sayaç 2000'in uzağındaki kullanıcı için gürültü. */}
                {temiz.length > MAKS - 200 && (
                  <span className={`text-xs font-medium ${temiz.length > MAKS ? 'text-rose-600' : 'text-slate-400'}`}>
                    {temiz.length} / {MAKS}
                  </span>
                )}

                {kaydedildi && !degisti && (
                  <span role="status" className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <Check className="h-3.5 w-3.5" />
                    Kaydedildi
                  </span>
                )}

                {ders.comment && !kaydedildi && !degisti && (
                  <span className="text-xs text-slate-400">
                    Son güncelleme: {trGunAdi(ders.comment.updatedAt)}
                  </span>
                )}

                {/* Geri alma: yanlış derse tıklamak kolay ve geri alınamazsa
                    öğretmenin tek çaresi yöneticiye başvurmak olurdu. Yorum
                    silinmez, ders yeniden işaretlenince geri gelir. */}
                <button
                  type="button"
                  onClick={() => durumDegistir('scheduled')}
                  disabled={mesgul}
                  className="flex items-center gap-1 rounded text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c5a059]"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  İşaretlemeyi geri al
                </button>

                <Button size="sm" className="ml-auto" onClick={yorumKaydet} disabled={!yorumGonderilebilir}>
                  {mesgul ? 'Kaydediliyor...' : ders.comment ? 'Yorumu güncelle' : 'Yorumu kaydet'}
                </Button>
              </div>
            </>
          )}

          {hata && (
            <p role="alert" className="mt-3 text-xs font-semibold text-rose-600">
              {hata}
            </p>
          )}
        </div>
      )}
    </li>
  );
};

export const TeacherLessonList: React.FC<{
  lessons: ProgramDersi[];
  onGuncelle: (id: string, degisiklik: Partial<ProgramDersi>) => void;
  /** Bir istek SOZLESME_GEREKLI ile reddedilince çağrılır (bkz. yukarıda). */
  onSozlesmeGerekli?: SozlesmeGerekliIsleyici;
}> = ({ lessons, onGuncelle, onSozlesmeGerekli }) => {
  /* Aynı anda tek satır açık: iki uzun yorum kutusunu yan yana açmanın
     faydası yok, listeyi de okunmaz hâle getirir. */
  const [acikId, setAcikId] = useState<string | null>(null);

  const bekleyen = lessons.filter(
    (d) => d.status === 'scheduled' && trTarih(d.startsAt) <= bugunTR()
  ).length;

  return (
    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#191F61]/10 text-[#191F61]">
          <ListChecks className="h-5 w-5" />
        </span>
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
          Bu haftanın dersleri
        </h2>
        {bekleyen > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
            {bekleyen} ders işaretlenmeyi bekliyor
          </span>
        )}
      </div>

      {lessons.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Bu hafta dersiniz yok.
        </p>
      ) : (
        <ul className="space-y-2">
          {lessons.map((ders) => (
            <DersSatiri
              key={ders.id}
              ders={ders}
              acik={acikId === ders.id}
              onAcKapa={() => setAcikId(acikId === ders.id ? null : ders.id)}
              onGuncelle={onGuncelle}
              onSozlesmeGerekli={onSozlesmeGerekli}
            />
          ))}
        </ul>
      )}
    </section>
  );
};
