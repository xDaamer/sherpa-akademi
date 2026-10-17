/**
 * TEK HTTP GİRİŞ NOKTASI
 * ============================================================================
 * Frontend artık Supabase'e doğrudan gitmiyor; her şey kendi /api/* katmanımıza
 * uğruyor. Bu dosya o katmanla konuşmanın tek yolu.
 *
 * `credentials: 'include'` şart: oturum jetonu httpOnly çerezde duruyor ve
 * JavaScript onu okuyamıyor (localStorage'da tutmamanın bütün amacı bu).
 * Çerezin isteğe eklenmesini tarayıcıya bırakıyoruz.
 *
 * 401'de bir kez /api/auth/refresh denenip istek tekrarlanıyor: access token
 * bir saatte bir sona eriyor ve kullanıcının bunu görmesi için hiçbir sebep
 * yok. "Bir kez" önemli — yenileme de 401 dönerse döngüye girmemeli.
 */

export interface ApiError {
  status: number;
  message: string;
}

export class ApiRequestError extends Error implements ApiError {
  status: number;
  /**
   * Sunucunun makinece okunacak hata kodu (ör. 'SOZLESME_GEREKLI'). Mesaj
   * kullanıcıya gösterilmek için; ona göre dal açmak metin değişince sessizce
   * bozulurdu. Kod yalnızca sunucu gönderdiyse dolu.
   */
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

const NETWORK_ERROR =
  'Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.';
const UNKNOWN_ERROR = 'Bir sorun oluştu. Lütfen tekrar deneyin.';

/**
 * "Bir oturum açılmıştı" işareti (bkz. server/cookies.ts). Jeton İÇERMEZ ve
 * güvenlik kararı vermez — yalnızca boşa istek atmamak için okunuyor.
 * Uydurulabilir; uydurulmasının tek sonucu bir 401 almaktır.
 */
export function hasSessionHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((entry) => entry.startsWith('ak_session='));
}

/* Aynı anda birden fazla istek 401 alırsa tek bir yenileme yapılsın: aksi
   halde her biri ayrı ayrı /api/auth/refresh çağırır ve Supabase yenileme
   jetonunu döndürdüğü için sonrakiler geçersiz jetonla başarısız olur. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }

  return refreshInFlight;
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Yenileme denemesini kapatır — /api/auth/* uçlarının kendisi için. */
  skipRefresh?: boolean;
}

/**
 * Başarılıysa gövdeyi döndürür, değilse ApiRequestError fırlatır.
 * Sunucu hata mesajlarını zaten Türkçe ve kullanıcıya gösterilebilir biçimde
 * üretiyor (ham Postgres hatası asla dışarı çıkmıyor, bkz. server.ts).
 */
export async function apiFetch<T = unknown>(
  path: string,
  { method = 'GET', body, skipRefresh = false }: ApiFetchOptions = {}
): Promise<T> {
  const send = () =>
    fetch(path, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

  let response: Response;
  try {
    response = await send();
  } catch {
    throw new ApiRequestError(0, NETWORK_ERROR);
  }

  /* İşaret yoksa hiç oturum açılmamış demektir; yenilemeyi denemek kesin
     başarısız olacak bir istek daha eklemekten ibaret olurdu. */
  if (response.status === 401 && !skipRefresh && hasSessionHint()) {
    const refreshed = await refreshSession();
    if (refreshed) {
      try {
        response = await send();
      } catch {
        throw new ApiRequestError(0, NETWORK_ERROR);
      }
    }
  }

  /* Gövde her zaman JSON beklenmiyor: 502/504 gibi durumlarda araya giren
     altyapı HTML dönebilir. Ayrıştırma hatası isteği çökertmemeli. */
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success === false) {
    throw new ApiRequestError(
      response.status,
      typeof payload?.error === 'string' ? payload.error : UNKNOWN_ERROR,
      typeof payload?.code === 'string' ? payload.code : undefined
    );
  }

  return payload as T;
}
