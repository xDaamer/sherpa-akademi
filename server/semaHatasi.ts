/*
 * EKSİK ŞEMA HATASI — "kod migration'dan önce deploy edildi"
 * ===========================================================================
 * Tablo/fonksiyon/kolon YOK hatası diğer veritabanı hatalarından ayrı
 * tanınıyor: bu, kodun ilgili SQL dosyası Supabase SQL Editor'de
 * çalıştırılmadan önce deploy edildiği anlamına gelir ve çözümü tekrar denemek
 * değil, o SQL dosyasını çalıştırmaktır.
 *
 * İki liste var ve ikisi FARKLI iş görüyor:
 *   - EKSIK_SEMA_KODLARI / eksikSemaMi — server/routes/admin.ts
 *     (adimHatasi): yöneticiye hangi SQL dosyasının eksik olduğunu söylüyor.
 *     Yalnızca bir MESAJ seçiyor, yani geniş olması zararsız.
 *   - TABLO_YA_DA_FONKSIYON_YOK / nesneYokMu — server/routes/teacherContract.ts
 *     (requireSignedContract): sözleşme tablosu ya da RPC'si HİÇ yoksa kapıyı
 *     açık bırakıyor (fail-open). Bu bir GÜVENLİK kararı, o yüzden dar.
 *
 * Kodlar tek dosyada: iki yerde ayrı ayrı tutulsaydı biri yeni bir kodu
 * öğrenip öteki öğrenmezdi.
 */
export const EKSIK_SEMA_KODLARI: ReadonlySet<string> = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "42883", // undefined_function
  "PGRST202", // fonksiyon şema önbelleğinde yok
  "PGRST204", // kolon şema önbelleğinde yok
  "PGRST205", // tablo şema önbelleğinde yok
]);

/** Supabase/PostgREST hatası "şema henüz yok" mu diyor? */
export function eksikSemaMi(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && EKSIK_SEMA_KODLARI.has(error.code));
}

/*
 * YALNIZCA "NESNE HİÇ YOK" — sözleşme kapısının fail-open listesi.
 * ---------------------------------------------------------------------------
 * Tablo ya da fonksiyon yoksa migration HİÇ uygulanmamış demektir: henüz
 * yayınlanmış bir sözleşme de yok, kapıyı açık bırakmak 'yok' durumuyla aynı
 * sonucu verir ve migration'dan önce gelen bir deploy panelleri kilitlemez.
 *
 * KOLON YOK (42703, PGRST204) BURADA BİLEREK YOK: o, migration uygulanmış ama
 * şema beklenenden sapmış demek (elle değiştirilmiş bir tablo, yarım kalmış
 * bir ALTER). Bu durumda sözleşme YAYINLANMIŞ olabilir; kapıyı açmak
 * onaylamamış öğretmenleri içeri alırdı. Kapı orada kapalı kalıyor (503).
 */
export const TABLO_YA_DA_FONKSIYON_YOK: ReadonlySet<string> = new Set([
  "42P01", // undefined_table
  "42883", // undefined_function
  "PGRST202", // fonksiyon şema önbelleğinde yok
  "PGRST205", // tablo şema önbelleğinde yok
]);

/** Hata "tablo/fonksiyon hiç yok" mu diyor? (Kolon eksikliği SAYILMAZ.) */
export function nesneYokMu(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && TABLO_YA_DA_FONKSIYON_YOK.has(error.code));
}
