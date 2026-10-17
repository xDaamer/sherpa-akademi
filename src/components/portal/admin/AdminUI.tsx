import React from 'react';

/*
 * YÖNETİM PANELİNİN ORTAK PARÇALARI
 * ===========================================================================
 * Üç sekme (hesaplar, dersler, ödemeler) aynı form ritmini paylaşıyor.
 * Bunlar ayrı bir tasarım sistemi değil — sadece aynı Tailwind sınıf
 * dizisini üç dosyada tekrar yazmamak için. Sitenin genel bileşenleri
 * (Button, Field) pazarlama sayfalarının diline göre kurulmuş ve burada
 * gereken şey daha yoğun, tablo benzeri bir form.
 */

export interface Hesap {
  id: string;
  fullName: string;
  phone: string;
  /* Girişin ikinci yolu, isteğe bağlı. null: bu hesap yalnızca telefonla
     girer (bkz. profiles.username). */
  username: string | null;
  userType: 'student' | 'teacher' | 'admin';
  createdAt?: string;
  /* Yalnızca öğretmende: verdiği dersler, notlar. Sadece yöneticiye gelir
     (public.teacher_descriptions); öğretmen kendi açıklamasını göremez. */
  description?: string | null;
  /* Yalnızca öğretmende: öğretmen sözleşmesinin onay durumu. tarih, İLK
     onayın zamanı (ISO). Öğretmen olmayan hesaplarda ve sunucu onay tablosunu
     okuyamadığında (migration henüz uygulanmadıysa) null — rozet o zaman hiç
     gösterilmiyor; "bilinmiyor"u "bekleniyor" diye göstermek yanlış olurdu. */
  sozlesme?: { onaylandi: boolean; tarih: string | null } | null;
}

/** Sunucudaki sınırla aynı (server/routes/admin.ts, ACIKLAMA_MAKS). */
export const ACIKLAMA_MAKS = 2000;

export const ROL_ETIKET: Record<Hesap['userType'], string> = {
  student: 'Öğrenci',
  teacher: 'Öğretmen',
  admin: 'Yönetici',
};

const GIRDI_SINIF =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 ' +
  'placeholder:text-slate-400 focus:border-[#191F61] focus:outline-none focus:ring-2 focus:ring-[#191F61]/20 ' +
  'disabled:bg-slate-50 disabled:text-slate-400';

/** Etiketli alan. Etiket <label> ile sarılı, yani tıklanınca girdi odaklanır. */
export const Alan: React.FC<{
  etiket: string;
  ipucu?: string;
  children: React.ReactNode;
  genis?: boolean;
}> = ({ etiket, ipucu, children, genis = false }) => (
  <label className={`block ${genis ? 'sm:col-span-2' : ''}`}>
    <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
      {etiket}
    </span>
    {children}
    {ipucu && <span className="mt-1 block text-xs text-slate-400">{ipucu}</span>}
  </label>
);

export const Girdi: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input {...props} className={`${GIRDI_SINIF} ${props.className ?? ''}`} />
);

export const Secim: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
  <select {...props} className={`${GIRDI_SINIF} ${props.className ?? ''}`} />
);

export const MetinAlani: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea {...props} className={`${GIRDI_SINIF} resize-y ${props.className ?? ''}`} />
);

/** Bölüm kabuğu — üç sekme de aynı çerçeveyi kullanıyor. */
export const Kutu: React.FC<{
  baslik: string;
  ikon?: React.ReactNode;
  sag?: React.ReactNode;
  children: React.ReactNode;
}> = ({ baslik, ikon, sag, children }) => (
  <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="mb-4 flex flex-wrap items-center gap-2.5">
      {ikon && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#191F61]/10 text-[#191F61]">
          {ikon}
        </span>
      )}
      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">{baslik}</h2>
      {sag && <div className="ml-auto">{sag}</div>}
    </div>
    {children}
  </section>
);

/**
 * Hata ve başarı satırı. role, ekran okuyucunun duyurması için: yönetici
 * formu gönderdikten sonra sayfanın neresinde ne değiştiğini görmeyebilir.
 */
export const Uyari: React.FC<{ tur: 'hata' | 'basari'; children: React.ReactNode }> = ({
  tur,
  children,
}) => (
  <p
    role={tur === 'hata' ? 'alert' : 'status'}
    className={`mb-4 rounded-xl border p-3 text-sm font-semibold ${
      tur === 'hata'
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800'
    }`}
  >
    {children}
  </p>
);

export const Bos: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{children}</p>
);

/*
 * datetime-local <-> ISO dönüşümü.
 * Girdi YEREL saat veriyor ("2026-09-15T14:00", saat dilimi yok); veritabanı
 * timestamptz tutuyor. new Date(yerel) tarayıcının saat dilimini uyguluyor —
 * yöneticinin Türkiye'de olduğu varsayımıyla doğru sonuç veriyor. Panelin
 * geri kalanı görüntülemede Europe/Istanbul'u AÇIKÇA kullanıyor; burada
 * kullanılamıyor çünkü girdi elemanının kendi saat dilimi kavramı yok.
 */
export function isoyaCevir(yerel: string): string {
  return new Date(yerel).toISOString();
}

export function girdiyeCevir(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  /* Yerel saat bileşenleriyle "YYYY-MM-DDTHH:mm" kuruluyor; toISOString()
     UTC'ye çevirip girdiyi saatlerce kaydırırdı. */
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TZ = 'Europe/Istanbul';

export function tarihSaat(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/* Başvuru tablosu tarihi ve saati ayrı kolonlarda gösteriyor. */
export function sadeceTarih(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

export function sadeceSaat(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** "05321234567" -> "0532 123 45 67". Tanınmayan biçim olduğu gibi döner. */
export function telefonGoster(tel: string): string {
  if (!/^05\d{9}$/.test(tel)) return tel;
  return `${tel.slice(0, 4)} ${tel.slice(4, 7)} ${tel.slice(7, 9)} ${tel.slice(9)}`;
}

export function paraBirimi(tutar: number, birim: string): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: birim || 'TRY',
    maximumFractionDigits: 2,
  }).format(tutar);
}
