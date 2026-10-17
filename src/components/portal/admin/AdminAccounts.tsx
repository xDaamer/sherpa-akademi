import React, { useState } from 'react';
import { UserPlus, KeyRound, Users, CalendarClock, FileText } from 'lucide-react';
import { Button } from '../../ui/Button';
import { apiFetch, ApiRequestError } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import {
  Alan,
  Girdi,
  Secim,
  MetinAlani,
  Kutu,
  Uyari,
  Bos,
  ROL_ETIKET,
  ACIKLAMA_MAKS,
  sadeceTarih,
  type Hesap,
} from './AdminUI';
import { MusaitlikDuzenleyici } from './AdminAvailability';
import type { Aralik } from '../../../lib/dersSaati';

/*
 * HESAPLAR — açma, düzenleme, şifre sıfırlama
 * ===========================================================================
 * Portalda kayıt ekranı yok ve olmayacak: hesapları yönetici açıyor. Bu sekme
 * eskiden Supabase Dashboard + elle SQL gerektiren iki adımlı işin yerini
 * alıyor (auth kullanıcısı + profiles satırı); sunucu ikisini tek istekte ve
 * geri alınabilir şekilde yapıyor (bkz. server/routes/admin.ts).
 *
 * ÖĞRETMEN HESABI MÜSAİT SAATLER OLMADAN AÇILMIYOR (2026-10-09): ders atama
 * öğretmenin programından yapılıyor ve müsaitliği olmayan bir öğretmene
 * hiç ders atanamaz. Mevcut öğretmenlerin müsaitliği satırlarındaki
 * "Müsaitlik" düğmesinden değiştiriliyor.
 *
 * ÖĞRETMEN AÇIKLAMASI (2026-10-09): verdiği dersler ve notlar. İsteğe bağlı;
 * hesap açarken ya da satırdaki "Açıklama" düğmesinden yazılıyor ve satırın
 * altında görünüyor. Yalnızca yöneticiler görür — bu bir arayüz gizlemesi
 * değil, tablo öğretmene veritabanında kapalı (supabase-teacher-descriptions.sql).
 *
 * HESAP SİLME YOK ve bu bilinçli: bir auth kullanıcısını silmek ders
 * geçmişini de etkileyen, geri dönüşü olmayan bir iş. Yanlış satıra basmanın
 * bedeli, panelde kazanılan rahatlıktan büyük. Erişimi kesmek gerekirse
 * Supabase Dashboard'dan yapılır.
 */

const BOS_FORM = {
  fullName: '',
  phone: '',
  username: '',
  password: '',
  userType: 'student' as Hesap['userType'],
  availability: [] as Aralik[],
  description: '',
};

export const AdminAccounts: React.FC<{
  hesaplar: Hesap[];
  yukleniyor: boolean;
  onDegisti: () => void;
}> = ({ hesaplar, yukleniyor, onDegisti }) => {
  const { user } = useAuth();
  const [form, setForm] = useState(BOS_FORM);
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);

  /* Düzenlenen satırın kimliği; null ise hiçbiri açık değil. */
  const [duzenlenen, setDuzenlenen] = useState<string | null>(null);
  const [duzenForm, setDuzenForm] = useState<Partial<Hesap>>({});
  const [sifreAcik, setSifreAcik] = useState<string | null>(null);
  const [yeniSifre, setYeniSifre] = useState('');
  /* Müsaitliği düzenlenen öğretmen ve taslak liste. Taslak null iken sunucudan
     okunuyor. */
  const [musaitlikAcik, setMusaitlikAcik] = useState<string | null>(null);
  const [musaitlikTaslak, setMusaitlikTaslak] = useState<Aralik[] | null>(null);
  /* Açıklaması düzenlenen öğretmen. Metin listeden geliyor, ayrı okuma yok. */
  const [aciklamaAcik, setAciklamaAcik] = useState<string | null>(null);
  const [aciklamaTaslak, setAciklamaTaslak] = useState('');

  const ogretmenEksik = form.userType === 'teacher' && form.availability.length === 0;

  async function hesapAc(e: React.FormEvent) {
    e.preventDefault();
    setMesgul(true);
    setHata(null);
    setBasari(null);
    try {
      /* Boş kullanıcı adı hiç GÖNDERİLMİYOR: sunucu boş string'i "biçim
         geçersiz" sayardı. Alan isteğe bağlı, yokluğu bir hata değil. */
      /* Müsaitlik ve açıklama yalnızca öğretmen hesabında gönderiliyor; başka
         rolde sunucu zaten yok sayıyor ama gereksiz veri taşımaya gerek yok. */
      const ogretmen = form.userType === 'teacher';
      await apiFetch('/api/admin/hesaplar', {
        method: 'POST',
        body: {
          ...form,
          username: form.username.trim() || undefined,
          availability: ogretmen ? form.availability : undefined,
          description: ogretmen && form.description.trim() ? form.description : undefined,
        },
      });
      /* Şifre ekranda TEKRAR GÖSTERİLMİYOR: yönetici onu zaten kendi yazdı.
         Kaydedilmiş bir şifreyi ekranda tutmak, panel açık unutulduğunda
         gereksiz bir sızıntı yüzeyi. */
      setBasari(`${form.fullName} için hesap açıldı. Şifreyi kişiye iletin.`);
      setForm(BOS_FORM);
      onDegisti();
    } catch (err) {
      setHata(err instanceof ApiRequestError ? err.message : 'Hesap açılamadı.');
    } finally {
      setMesgul(false);
    }
  }

  async function duzenKaydet(id: string) {
    setMesgul(true);
    setHata(null);
    setBasari(null);
    try {
      await apiFetch(`/api/admin/hesaplar/${id}`, { method: 'PATCH', body: duzenForm });
      setBasari('Hesap güncellendi.');
      setDuzenlenen(null);
      onDegisti();
    } catch (err) {
      setHata(err instanceof ApiRequestError ? err.message : 'Hesap güncellenemedi.');
    } finally {
      setMesgul(false);
    }
  }

  function aciklamaAc(h: Hesap) {
    setDuzenlenen(null);
    setSifreAcik(null);
    setMusaitlikAcik(null);
    setAciklamaAcik(aciklamaAcik === h.id ? null : h.id);
    setAciklamaTaslak(h.description ?? '');
  }

  async function aciklamaKaydet(id: string) {
    setMesgul(true);
    setHata(null);
    setBasari(null);
    try {
      /* Boş metin sunucuda açıklamayı KALDIRIYOR — "sil" düğmesi ayrıca yok. */
      await apiFetch(`/api/admin/ogretmenler/${id}/aciklama`, {
        method: 'PUT',
        body: { description: aciklamaTaslak },
      });
      setBasari(aciklamaTaslak.trim() ? 'Açıklama kaydedildi.' : 'Açıklama kaldırıldı.');
      setAciklamaAcik(null);
      onDegisti();
    } catch (err) {
      setHata(err instanceof ApiRequestError ? err.message : 'Açıklama kaydedilemedi.');
    } finally {
      setMesgul(false);
    }
  }

  async function musaitlikAc(id: string) {
    setDuzenlenen(null);
    setSifreAcik(null);
    setAciklamaAcik(null);
    if (musaitlikAcik === id) {
      setMusaitlikAcik(null);
      return;
    }
    setMusaitlikAcik(id);
    setMusaitlikTaslak(null);
    setHata(null);
    try {
      const veri = await apiFetch<{ availability: Aralik[] }>(`/api/admin/ogretmenler/${id}/musaitlik`);
      setMusaitlikTaslak(veri.availability);
    } catch (err) {
      setHata(err instanceof ApiRequestError ? err.message : 'Müsait saatler alınamadı.');
      setMusaitlikAcik(null);
    }
  }

  async function musaitlikKaydet(id: string) {
    if (!musaitlikTaslak) return;
    setMesgul(true);
    setHata(null);
    setBasari(null);
    try {
      await apiFetch(`/api/admin/ogretmenler/${id}/musaitlik`, {
        method: 'PUT',
        body: { availability: musaitlikTaslak },
      });
      setBasari('Müsait saatler güncellendi.');
      setMusaitlikAcik(null);
    } catch (err) {
      setHata(err instanceof ApiRequestError ? err.message : 'Müsait saatler kaydedilemedi.');
    } finally {
      setMesgul(false);
    }
  }

  async function sifreSifirla(id: string) {
    setMesgul(true);
    setHata(null);
    setBasari(null);
    try {
      await apiFetch(`/api/admin/hesaplar/${id}/sifre`, {
        method: 'POST',
        body: { password: yeniSifre },
      });
      setBasari('Şifre güncellendi. Yeni şifreyi kişiye iletin.');
      setSifreAcik(null);
      setYeniSifre('');
    } catch (err) {
      setHata(err instanceof ApiRequestError ? err.message : 'Şifre güncellenemedi.');
    } finally {
      setMesgul(false);
    }
  }

  return (
    <div className="space-y-6">
      <Kutu baslik="Yeni hesap aç" ikon={<UserPlus className="h-5 w-5" />}>
        {hata && <Uyari tur="hata">{hata}</Uyari>}
        {basari && <Uyari tur="basari">{basari}</Uyari>}

        <form onSubmit={hesapAc} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Alan etiket="Ad soyad">
            <Girdi
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              placeholder="Ayşe Yılmaz"
              required
            />
          </Alan>

          <Alan etiket="Telefon" ipucu="Giriş bu numarayla yapılır.">
            <Girdi
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="05321234567"
              inputMode="numeric"
              required
            />
          </Alan>

          {/*
            Kullanıcı adı İSTEĞE BAĞLI: telefon her hesapta var ve giriş için
            yeterli. Zorunlu tutmak, ihtiyacı olmayan herkese bir alan daha
            doldurtmak olurdu.
          */}
          <Alan
            etiket="Kullanıcı adı (isteğe bağlı)"
            ipucu="3-30 karakter · harf, rakam, . _ - · büyük harfler küçüğe çevrilir"
          >
            <Girdi
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="ornek.kullanici"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </Alan>

          <Alan etiket="Şifre" ipucu="En az 8 karakter. Kişiye siz ileteceksiniz.">
            <Girdi
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="En az 8 karakter"
              required
            />
          </Alan>

          <Alan etiket="Hesap türü">
            <Secim
              value={form.userType}
              onChange={(e) => setForm({ ...form, userType: e.target.value as Hesap['userType'] })}
            >
              <option value="student">Öğrenci</option>
              <option value="teacher">Öğretmen</option>
              <option value="admin">Yönetici</option>
            </Secim>
          </Alan>

          {form.userType === 'teacher' && (
            <div className="sm:col-span-2">
              <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">
                Müsait saatler
              </p>
              <p className="mb-3 text-xs text-slate-400">
                Öğretmenin her hafta ders verebileceği saatler. Ders atarken yalnızca bu
                saatlerin içine ders konabilir. En az bir aralık gerekli.
              </p>
              <MusaitlikDuzenleyici
                value={form.availability}
                onChange={(availability) => setForm({ ...form, availability })}
                disabled={mesgul}
              />
            </div>
          )}

          {form.userType === 'teacher' && (
            <Alan
              etiket="Açıklama (isteğe bağlı)"
              ipucu="Yalnızca yöneticiler görür; öğretmen göremez."
              genis
            >
              <MetinAlani
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Verdiği dersler: TYT-AYT Matematik, LGS Fen Bilimleri…"
                rows={3}
                maxLength={ACIKLAMA_MAKS}
                disabled={mesgul}
              />
            </Alan>
          )}

          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={mesgul || ogretmenEksik}>
              {mesgul ? 'Açılıyor...' : 'Hesabı aç'}
            </Button>
            {ogretmenEksik && (
              <span className="text-xs font-semibold text-amber-700">
                Öğretmen hesabı için en az bir müsait saat aralığı ekleyin.
              </span>
            )}
          </div>
        </form>
      </Kutu>

      <Kutu
        baslik="Hesaplar"
        ikon={<Users className="h-5 w-5" />}
        sag={<span className="text-xs text-slate-400">{hesaplar.length} kayıt</span>}
      >
        {yukleniyor ? (
          <p className="py-8 text-center text-sm text-slate-500">Yükleniyor...</p>
        ) : hesaplar.length === 0 ? (
          <Bos>Henüz hesap yok.</Bos>
        ) : (
          <ul className="space-y-2">
            {hesaplar.map((h) => (
              <li key={h.id} className="rounded-2xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-bold text-[#191F61]">{h.fullName}</span>
                  <span className="text-sm text-slate-500">{h.phone}</span>
                  {h.username && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                      {h.username}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      h.userType === 'admin'
                        ? 'bg-[#c5a059]/20 text-[#7a5f2a]'
                        : h.userType === 'teacher'
                          ? 'bg-[#191F61]/10 text-[#191F61]'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {ROL_ETIKET[h.userType]}
                  </span>
                  {h.id === user?.id && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      siz
                    </span>
                  )}
                  {/* Sözleşme rozeti. Alan yoksa (null: sunucu onay tablosunu
                      okuyamadı) hiçbir şey çizilmiyor — bilinmeyen durumu
                      "bekleniyor" diye göstermek yöneticiyi yanıltırdı. */}
                  {h.userType === 'teacher' && h.sozlesme && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        h.sozlesme.onaylandi
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {h.sozlesme.onaylandi
                        ? `Sözleşme onaylı${h.sozlesme.tarih ? ` · ${sadeceTarih(h.sozlesme.tarih)}` : ''}`
                        : 'Sözleşme onayı bekleniyor'}
                    </span>
                  )}

                  <div className="ml-auto flex gap-1.5">
                    {h.userType === 'teacher' && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => aciklamaAc(h)}>
                          <FileText className="h-4 w-4" />
                          <span className="hidden sm:inline">Açıklama</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void musaitlikAc(h.id)}>
                          <CalendarClock className="h-4 w-4" />
                          <span className="hidden sm:inline">Müsaitlik</span>
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSifreAcik(null);
                        setMusaitlikAcik(null);
                        setAciklamaAcik(null);
                        setDuzenlenen(duzenlenen === h.id ? null : h.id);
                        setDuzenForm({
                          fullName: h.fullName,
                          phone: h.phone,
                          username: h.username,
                          userType: h.userType,
                        });
                      }}
                    >
                      Düzenle
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDuzenlenen(null);
                        setMusaitlikAcik(null);
                        setAciklamaAcik(null);
                        setSifreAcik(sifreAcik === h.id ? null : h.id);
                        setYeniSifre('');
                      }}
                    >
                      <KeyRound className="h-4 w-4" />
                      <span className="hidden sm:inline">Şifre</span>
                    </Button>
                  </div>
                </div>

                {/* Açıklama düzenleyici kapalıyken satırın altında. Yoksa hiçbir
                    şey gösterilmiyor: boş bir "açıklama yok" satırı her
                    öğretmeni listede bir satır uzatırdı. */}
                {h.userType === 'teacher' && h.description && aciklamaAcik !== h.id && (
                  <p className="mt-2 whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {h.description}
                  </p>
                )}

                {aciklamaAcik === h.id && (
                  <div className="mt-3 border-t border-slate-200 pt-3">
                    <Alan
                      etiket="Açıklama"
                      ipucu="Yalnızca yöneticiler görür. Boş bırakıp kaydederseniz kaldırılır."
                    >
                      <MetinAlani
                        value={aciklamaTaslak}
                        onChange={(e) => setAciklamaTaslak(e.target.value)}
                        placeholder="Verdiği dersler: TYT-AYT Matematik, LGS Fen Bilimleri…"
                        rows={3}
                        maxLength={ACIKLAMA_MAKS}
                        disabled={mesgul}
                        autoFocus
                      />
                    </Alan>
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" onClick={() => aciklamaKaydet(h.id)} disabled={mesgul}>
                        {mesgul ? 'Kaydediliyor...' : 'Açıklamayı kaydet'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setAciklamaAcik(null)}>
                        Vazgeç
                      </Button>
                    </div>
                  </div>
                )}

                {duzenlenen === h.id && (
                  <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Alan etiket="Ad soyad">
                      <Girdi
                        value={duzenForm.fullName ?? ''}
                        onChange={(e) => setDuzenForm({ ...duzenForm, fullName: e.target.value })}
                      />
                    </Alan>
                    <Alan etiket="Telefon">
                      <Girdi
                        value={duzenForm.phone ?? ''}
                        onChange={(e) => setDuzenForm({ ...duzenForm, phone: e.target.value })}
                      />
                    </Alan>
                    <Alan etiket="Kullanıcı adı" ipucu="Boş bırakılırsa kaldırılır.">
                      <Girdi
                        value={duzenForm.username ?? ''}
                        onChange={(e) => setDuzenForm({ ...duzenForm, username: e.target.value })}
                        placeholder="—"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    </Alan>
                    <Alan etiket="Hesap türü">
                      <Secim
                        value={duzenForm.userType ?? 'student'}
                        onChange={(e) =>
                          setDuzenForm({ ...duzenForm, userType: e.target.value as Hesap['userType'] })
                        }
                      >
                        <option value="student">Öğrenci</option>
                        <option value="teacher">Öğretmen</option>
                        <option value="admin">Yönetici</option>
                      </Secim>
                    </Alan>
                    <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                      <Button size="sm" onClick={() => duzenKaydet(h.id)} disabled={mesgul}>
                        {mesgul ? 'Kaydediliyor...' : 'Kaydet'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDuzenlenen(null)}>
                        Vazgeç
                      </Button>
                    </div>
                  </div>
                )}

                {musaitlikAcik === h.id && (
                  <div className="mt-3 border-t border-slate-200 pt-3">
                    {musaitlikTaslak === null ? (
                      <p className="py-4 text-center text-sm text-slate-500">Yükleniyor...</p>
                    ) : (
                      <>
                        <MusaitlikDuzenleyici
                          value={musaitlikTaslak}
                          onChange={setMusaitlikTaslak}
                          disabled={mesgul}
                        />
                        <p className="mt-2 text-xs text-slate-400">
                          Önceden atanmış dersler etkilenmez; yeni saatler yalnızca bundan sonraki
                          ders atamalarında geçerli.
                        </p>
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => musaitlikKaydet(h.id)}
                            disabled={mesgul || musaitlikTaslak.length === 0}
                          >
                            {mesgul ? 'Kaydediliyor...' : 'Müsait saatleri kaydet'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setMusaitlikAcik(null)}>
                            Vazgeç
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {sifreAcik === h.id && (
                  <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-200 pt-3">
                    <div className="min-w-[220px] flex-1">
                      <Alan etiket="Yeni şifre" ipucu="En az 8 karakter.">
                        <Girdi
                          type="text"
                          value={yeniSifre}
                          onChange={(e) => setYeniSifre(e.target.value)}
                          placeholder="Yeni şifre"
                        />
                      </Alan>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => sifreSifirla(h.id)}
                      disabled={mesgul || yeniSifre.length < 8}
                    >
                      {mesgul ? 'Kaydediliyor...' : 'Şifreyi değiştir'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setSifreAcik(null)}>
                      Vazgeç
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Kutu>
    </div>
  );
};
