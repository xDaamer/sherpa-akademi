import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { apiFetch, ApiRequestError } from '../../../lib/api';
import { Kutu, Uyari, Bos, ROL_ETIKET, sadeceTarih, type Hesap } from './AdminUI';

/*
 * SİLİNEN PROFİLLER — 30 gün geri getirilebilir
 * ===========================================================================
 * Hesaplar sekmesinin en altındaki düğmeyle açılıyor. Silinen bir hesap 30 gün
 * boyunca burada; "Geri getir" profili ve girişi aynen geri veriyor (dersler,
 * ödemeler, şifre hiç silinmemişti). 30 gün sonra sunucu hesabı kalıcı siliyor
 * ve satır listeden kendiliğinden düşüyor (bkz. server/routes/admin.ts).
 *
 * Sözleşme onaylamış bir öğretmen kalıcı silinemiyor (sözleşme kanıtı 10 yıl
 * saklanıyor); süresi dolsa da burada kalıyor, girişe kapalı, geri getirilebilir.
 */

interface SilinenHesap {
  id: string;
  fullName: string;
  phone: string;
  username: string | null;
  userType: Hesap['userType'];
  deletedAt: string;
  kaliciSilinme: string;
  kaliciSilinemedi: 'sozlesme' | 'silinemedi' | null;
}

function kalanGun(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

export const AdminDeletedAccounts: React.FC<{
  /* Bir hesap silindiğinde artıyor: liste açıksa yeniden okunuyor. */
  surum: number;
  onGeriGeldi: () => void;
}> = ({ surum, onGeriGeldi }) => {
  const [liste, setListe] = useState<SilinenHesap[] | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);
  const [mesgul, setMesgul] = useState<string | null>(null);

  const getir = useCallback(async () => {
    setHata(null);
    try {
      const veri = await apiFetch<{ accounts: SilinenHesap[] }>('/api/admin/silinenler');
      setListe(veri.accounts);
    } catch (err) {
      setHata(err instanceof ApiRequestError ? err.message : 'Silinen hesaplar alınamadı.');
      setListe([]);
    }
  }, []);

  useEffect(() => {
    void getir();
  }, [getir, surum]);

  async function geriGetir(h: SilinenHesap) {
    setMesgul(h.id);
    setHata(null);
    setBasari(null);
    try {
      await apiFetch(`/api/admin/silinenler/${h.id}/geri-getir`, { method: 'POST' });
      setBasari(`${h.fullName} geri getirildi. Eski şifresiyle giriş yapabilir.`);
      setListe((onceki) => (onceki ?? []).filter((x) => x.id !== h.id));
      onGeriGeldi();
    } catch (err) {
      setHata(err instanceof ApiRequestError ? err.message : 'Hesap geri getirilemedi.');
    } finally {
      setMesgul(null);
    }
  }

  return (
    <Kutu
      baslik="Silinen profiller"
      ikon={<Trash2 className="h-5 w-5" />}
      sag={liste && <span className="text-xs text-slate-400">{liste.length} kayıt</span>}
    >
      {hata && <Uyari tur="hata">{hata}</Uyari>}
      {basari && <Uyari tur="basari">{basari}</Uyari>}

      {liste === null ? (
        <p className="py-8 text-center text-sm text-slate-500">Yükleniyor...</p>
      ) : liste.length === 0 ? (
        <Bos>Silinen hesap yok.</Bos>
      ) : (
        <ul className="space-y-2">
          {liste.map((h) => (
            <li
              key={h.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-slate-200 p-3"
            >
              <span className="text-sm font-bold text-[#191F61]">{h.fullName}</span>
              <span className="text-sm text-slate-500">{h.phone}</span>
              {h.username && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                  {h.username}
                </span>
              )}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                {ROL_ETIKET[h.userType]}
              </span>
              <span className="text-xs text-slate-400">
                Silindi: {sadeceTarih(h.deletedAt)} ·{' '}
                {h.kaliciSilinemedi === 'sozlesme'
                  ? 'sözleşme kaydı olduğu için kalıcı silinmiyor'
                  : h.kaliciSilinemedi
                    ? 'kalıcı silme başarısız, tekrar denenecek'
                    : `${kalanGun(h.kaliciSilinme)} gün sonra kalıcı silinecek`}
              </span>
              <div className="ml-auto">
                <Button size="sm" variant="soft" onClick={() => void geriGetir(h)} disabled={mesgul !== null}>
                  <RotateCcw className="h-4 w-4" />
                  {mesgul === h.id ? 'Getiriliyor...' : 'Geri getir'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Kutu>
  );
};
