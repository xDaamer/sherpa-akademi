/*
 * PANELLER — CANLI UÇTAN UCA DOĞRULAMA
 * ============================================================================
 * Üç panelin (yönetim, öğretmen, öğrenci) birlikte çalıştığını gerçek HTTP
 * üzerinden ölçer: yönetici hesap açar, ders atar, ücret girer; açılan
 * öğretmen hesabıyla giriş yapılır, sözleşme kapısı sınanıp sözleşme
 * onaylanır (yayınlanmış bir sözleşme varsa), ders "işlendi" yapılıp yorum
 * yazılır; açılan öğrenci hesabıyla girilip ders, ödeme ve yorumun göründüğü
 * doğrulanır. Sonunda roller arası 403'ler sınanır ve test verisi silinir.
 *
 * NEDEN CANLIYA KARŞI ÇALIŞIR
 * ----------------------------------------------------------------------------
 * Yereldeki .env'de servis rolü anahtarı BİLEREK yok ve login'in kendisi de
 * ona bağlı — yani localhost'ta hiç giriş yapılamıyor. Doğrulamanın yeri
 * canlı dağıtım (bkz. CLAUDE.md > "How this project is verified").
 *
 * KULLANIM
 * ----------------------------------------------------------------------------
 *   npm run test:panels -- --base https://www.sherpakademi.com \
 *     --admin 05xxxxxxxxx:yonetici-sifresi
 *
 * Yalnızca YÖNETİCİ kimliği gerekiyor; öğretmen ve öğrenci hesaplarını betik
 * kendisi açar (bu zaten test edilen şeylerden biri). Hazır hesaplarla
 * çalışmak isterseniz --teacher / --student ekleyebilirsiniz.
 *
 * ŞİFRE KOMUT SATIRINDAN GEÇER, yani kabuk geçmişinize yazılır. Paylaşılan
 * bir makinede çalıştırıyorsanız komutun başına boşluk koyun ya da sonradan
 * yönetim panelinden şifreyi değiştirin.
 *
 * NE YAZAR, NE SİLER
 * ----------------------------------------------------------------------------
 * Açtığı DERS ve ÖDEME kayıtlarını sonunda siler. Ders saati öğretmenin
 * programından seçiliyor (önümüzdeki iki haftadaki ilk boş yarım saat);
 * --teacher ile hazır bir öğretmen verilirse onun müsaitliğine ve
 * açıklamasına dokunmaz. Açtığı HESAPLARI silmez —
 * panelde hesap silme bilerek yok (bkz. AdminAccounts.tsx); kimlikleri ekrana
 * yazar, gerekirse Supabase Dashboard'dan kaldırılır.
 *
 * SÖZLEŞME ONAYI SİLİNEMEZ: öğretmen sözleşmesi yayınlanmışsa betik, kendi
 * açtığı öğretmen adına teacher_contract_acceptances'a bir satır yazar. O
 * tablo yalnızca eklemeye açık ve teacher_id'si ON DELETE RESTRICT — yani
 * satır da, artık o öğretmen hesabı da Dashboard'dan silinemez. Sonda
 * ayrıca yazdırılır. --teacher ile verilen GERÇEK bir öğretmen adına onay
 * VERİLMEZ (birinin yerine imza atmak olurdu); o öğretmen onaylamamışsa
 * kapı testi tek bir KALDI sayılır, öğretmen panelinin geri kalan testleri
 * ATLANIR ve öğretmen panelden kendisi onaylamalıdır.
 *
 * ÇEREZLER ELLE TAŞINIR: oturum httpOnly çerezde ve Node'un fetch'i çerez
 * saklamıyor. ORIGIN başlığı da elle eklenir: requireTrustedOrigin durum
 * değiştiren isteklerde onu zorunlu kılıyor ve tarayıcı dışında kimse
 * göndermiyor — eklenmezse her POST 403 döner ve test yanlış yerden kalır.
 */

interface Kimlik {
  phone: string;
  password: string;
}

function argOku(ad: string): string | undefined {
  const i = process.argv.indexOf(`--${ad}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function kimlikAyristir(ham: string | undefined): Kimlik | null {
  if (!ham || !ham.includes(":")) return null;
  const i = ham.indexOf(":");
  return { phone: ham.slice(0, i), password: ham.slice(i + 1) };
}

const BASE = (argOku("base") || "https://www.sherpakademi.com").replace(/\/$/, "");
const YONETICI = kimlikAyristir(argOku("admin"));
let OGRETMEN = kimlikAyristir(argOku("teacher"));
let OGRENCI = kimlikAyristir(argOku("student"));

if (!YONETICI) {
  console.error("--admin gerekli. Biçim: --admin 05xxxxxxxxx:sifre");
  process.exit(1);
}

/** Tek bir oturumun çerezleri. Her kullanıcı için ayrı kavanoz. */
class Kavanoz {
  private cerezler = new Map<string, string>();

  yut(response: Response) {
    /* getSetCookie() her Set-Cookie başlığını ayrı verir; tek bir
       get("set-cookie") hepsini virgülle birleştirip çerez değerlerindeki
       virgüllerle karıştırırdı. */
    for (const satir of response.headers.getSetCookie?.() ?? []) {
      const [cift] = satir.split(";");
      const esittir = cift.indexOf("=");
      if (esittir < 0) continue;
      const ad = cift.slice(0, esittir).trim();
      const deger = cift.slice(esittir + 1).trim();
      /* Boş değer = silme talimatı. */
      if (deger === "") this.cerezler.delete(ad);
      else this.cerezler.set(ad, deger);
    }
  }

  basligi(): string {
    return [...this.cerezler].map(([a, d]) => `${a}=${d}`).join("; ");
  }
}

interface Cevap {
  status: number;
  body: any;
}

async function istek(
  kavanoz: Kavanoz,
  yol: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<Cevap> {
  const { method = "GET", body } = opts;
  const headers: Record<string, string> = { Origin: BASE };
  const cerez = kavanoz.basligi();
  if (cerez) headers.Cookie = cerez;
  if (body) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE}${yol}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });

  kavanoz.yut(response);

  let veri: any = null;
  try {
    veri = await response.json();
  } catch {
    veri = null;
  }
  return { status: response.status, body: veri };
}

let toplam = 0;
let gecen = 0;
const kalanlar: string[] = [];

function kontrol(ad: string, kosul: boolean, ayrinti = "") {
  toplam += 1;
  if (kosul) gecen += 1;
  else kalanlar.push(`${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
  console.log(`  ${kosul ? "GEÇTİ" : "KALDI"}  ${ad}${ayrinti ? `  (${ayrinti})` : ""}`);
}

async function girisYap(kimlik: Kimlik, etiket: string) {
  const kavanoz = new Kavanoz();
  const cevap = await istek(kavanoz, "/api/auth/login", {
    method: "POST",
    body: { phone: kimlik.phone, password: kimlik.password, website: "" },
  });

  if (cevap.status !== 200) {
    console.error(`\n  ${etiket} girişi başarısız (${cevap.status}): ${cevap.body?.error ?? ""}`);
    return null;
  }
  return { kavanoz, user: cevap.body.user };
}

/* Test hesaplarının numaraları çalıştırma anından türetiliyor: aynı betiğin
   iki koşusu birbirinin numarasına çarpmasın (profiles.phone UNIQUE). */
const DAMGA = Date.now().toString().slice(-7);
const URETILEN = {
  teacherPhone: `0555${DAMGA}`,
  studentPhone: `0556${DAMGA}`,
  /* Kullanıcı adı kalıbı: küçük harf + rakam + nokta. '@' yasak olduğu için
     e-postaya benzeyen bir değer denenmiyor; onu ayrı bir test eliyor. */
  teacherUsername: `ogretmen.${DAMGA}`,
  password: `Test${DAMGA}aA!`,
};

/* Betiğin açtığı öğretmenin müsaitliği: her gün 09:00-21:00. */
const TEST_MUSAITLIK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 21 * 60,
}));

/* Betiğin açtığı öğretmenin açıklaması. Öğretmen uçlarının yanıtlarında bu
   metin ARANIYOR: geçerse açıklama yöneticiden başkasına sızmış demektir. */
const TEST_ACIKLAMA = "TEST aciklama: TYT Matematik, AYT Fizik";

function gunEkle(tarih: string, n: number): string {
  const d = new Date(`${tarih}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function trAn(tarih: string, dakika: number): string {
  const hh = String(Math.floor(dakika / 60)).padStart(2, "0");
  const mm = String(dakika % 60).padStart(2, "0");
  return new Date(`${tarih}T${hh}:${mm}:00+03:00`).toISOString();
}

/**
 * Öğretmenin programından ilk boş saati bulur — ders atama ekranının
 * yaptığının aynısı, sunucunun kendi program ucundan. Önümüzdeki iki hafta
 * taranıyor ki ders her zaman gelecekte olsun.
 */
async function bosSaatBul(kavanoz: Kavanoz, ogretmenId: string, sureDk: number): Promise<string | null> {
  const trBugun = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  for (const ek of [7, 14]) {
    const r = await istek(kavanoz, `/api/admin/ogretmenler/${ogretmenId}/program?week=${gunEkle(trBugun, ek)}`);
    if (r.status !== 200) return null;
    const { weekStart, availability, lessons } = r.body;
    for (let g = 0; g < 7; g++) {
      const tarih = gunEkle(weekStart, g);
      for (const a of availability.filter((x: any) => x.weekday === g + 1)) {
        for (let dk = a.startMinute; dk + sureDk <= a.endMinute; dk += 30) {
          const bas = new Date(trAn(tarih, dk)).getTime();
          const bit = bas + sureDk * 60_000;
          const dolu = lessons.some(
            (l: any) => new Date(l.startsAt).getTime() < bit && bas < new Date(l.endsAt).getTime(),
          );
          if (!dolu) return new Date(bas).toISOString();
        }
      }
    }
  }
  return null;
}

async function calistir() {
  console.log(`\nPanel testleri — ${BASE}\n`);

  /* Sözleşme onayı geri alınamayan tek yazma; sonda ayrıca raporlanıyor. */
  let sozlesmeOnayiYazildi = false;

  /* =============================================================== YÖNETİCİ */
  console.log("1) Yönetici");
  const yonetici = await girisYap(YONETICI!, "Yönetici");
  if (!yonetici) {
    console.error("  Yönetici girişi olmadan devam edilemez.");
    process.exit(1);
  }
  kontrol("userType = admin", yonetici.user?.userType === "admin", `${yonetici.user?.userType}`);

  let r = await istek(yonetici.kavanoz, "/api/admin/ozet");
  kontrol("GET /api/admin/ozet -> 200", r.status === 200, `${r.status}`);
  const oncekiSayi = r.body?.accounts?.length ?? 0;

  /* Form başvuruları: salt okunur, test veri YAZMIYOR. Toplamın sayfadaki
     satırdan az olmaması ve filtrenin toplamı büyütmemesi, sayfalama ile
     filtrenin sunucuda gerçekten uygulandığını gösteriyor. */
  r = await istek(yonetici.kavanoz, "/api/admin/basvurular");
  kontrol("GET /api/admin/basvurular -> 200", r.status === 200, `${r.status} ${r.body?.error ?? ""}`);
  const basvuruToplam: number = r.body?.total ?? -1;
  kontrol(
    "Başvuru listesi ve toplam tutarlı",
    Array.isArray(r.body?.leads) && basvuruToplam >= r.body.leads.length && r.body.leads.length <= 50,
    `${r.body?.leads?.length} satır / toplam ${basvuruToplam}`,
  );
  r = await istek(yonetici.kavanoz, "/api/admin/basvurular?adim=2&q=a,phone.neq.x");
  kontrol(
    "Filtre + virgüllü arama -> 200 ve toplamı büyütmüyor",
    r.status === 200 && (r.body?.total ?? Infinity) <= basvuruToplam,
    `${r.status} toplam ${r.body?.total}`,
  );

  /* Yönetici, diğer iki panelin uçlarına GİREMEZ: rol kapısı tek rol kabul
     ediyor ve bu bilinçli (bkz. CLAUDE.md > admin bölümü). Cevapta `code`
     OLMAMALI: /api/teacher'da rol kapısı sözleşme kapısından önce çalışıyor,
     yani yönetici SOZLESME_GEREKLI değil, düz rol 403'ünü almalı. */
  for (const yol of ["/api/portal/ozet", "/api/teacher/schedule"]) {
    const x = await istek(yonetici.kavanoz, yol);
    kontrol(`Yönetici -> ${yol} ENGELLENİYOR (rol 403'ü, kodsuz)`, x.status === 403 && x.body?.code === undefined,
      `${x.status} ${x.body?.code ?? ""}`);
  }

  /* Son yöneticinin kendini kilitlemesi engelleniyor. */
  r = await istek(yonetici.kavanoz, `/api/admin/hesaplar/${yonetici.user.id}`, {
    method: "PATCH",
    body: { userType: "student" },
  });
  kontrol("Yönetici kendi rolünü DÜŞÜREMİYOR (400)", r.status === 400, `${r.status}`);

  /* ================================================================ HESAPLAR */
  console.log("\n2) Hesap açma");
  let ogretmenId: string | undefined;
  let ogrenciId: string | undefined;

  if (!OGRETMEN) {
    /* Müsaitliksiz öğretmen hesabı reddediliyor — auth kullanıcısı açılmadan
       ÖNCE, yani bu deneme arkasında hesap bırakmıyor. */
    r = await istek(yonetici.kavanoz, "/api/admin/hesaplar", {
      method: "POST",
      body: {
        fullName: "TEST Ogretmen",
        phone: URETILEN.teacherPhone,
        password: URETILEN.password,
        userType: "teacher",
      },
    });
    kontrol("Müsait saatsiz öğretmen hesabı ENGELLENİYOR (400)", r.status === 400, `${r.status}`);

    r = await istek(yonetici.kavanoz, "/api/admin/hesaplar", {
      method: "POST",
      body: {
        fullName: "TEST Ogretmen",
        phone: URETILEN.teacherPhone,
        username: URETILEN.teacherUsername,
        password: URETILEN.password,
        userType: "teacher",
        availability: TEST_MUSAITLIK,
        description: TEST_ACIKLAMA,
      },
    });
    kontrol("Öğretmen hesabı açıldı (200)", r.status === 200, `${r.status} ${r.body?.error ?? ""}`);
    kontrol("Kullanıcı adı kaydedildi", r.body?.account?.username === URETILEN.teacherUsername,
      `${r.body?.account?.username}`);
    kontrol("Açıklama hesapla birlikte kaydedildi", r.body?.account?.description === TEST_ACIKLAMA,
      `${r.body?.account?.description}`);
    ogretmenId = r.body?.account?.id;
    OGRETMEN = { phone: URETILEN.teacherPhone, password: URETILEN.password };
  }

  if (!OGRENCI) {
    r = await istek(yonetici.kavanoz, "/api/admin/hesaplar", {
      method: "POST",
      body: {
        fullName: "TEST Ogrenci",
        phone: URETILEN.studentPhone,
        password: URETILEN.password,
        userType: "student",
      },
    });
    kontrol("Öğrenci hesabı açıldı (200)", r.status === 200, `${r.status} ${r.body?.error ?? ""}`);
    ogrenciId = r.body?.account?.id;
    OGRENCI = { phone: URETILEN.studentPhone, password: URETILEN.password };
  }

  /* Doğrulama sınırları */
  r = await istek(yonetici.kavanoz, "/api/admin/hesaplar", {
    method: "POST",
    body: { fullName: "X", phone: URETILEN.teacherPhone, password: URETILEN.password, userType: "teacher" },
  });
  kontrol("Aynı telefonla ikinci hesap ENGELLENİYOR (409)", r.status === 409, `${r.status}`);

  r = await istek(yonetici.kavanoz, "/api/admin/hesaplar", {
    method: "POST",
    body: { fullName: "X", phone: "12345", password: URETILEN.password, userType: "teacher" },
  });
  kontrol("Geçersiz telefon ENGELLENİYOR (400)", r.status === 400, `${r.status}`);

  r = await istek(yonetici.kavanoz, "/api/admin/hesaplar", {
    method: "POST",
    body: { fullName: "X", phone: `0557${DAMGA}`, password: "kisa", userType: "teacher" },
  });
  kontrol("8 karakterden kısa şifre ENGELLENİYOR (400)", r.status === 400, `${r.status}`);

  /* Kullanıcı adı biçim kuralları — '@' özellikle sınanıyor: e-postayla
     karışmaması bu özelliğin tanımının parçası.
     BÜYÜK HARF BU LİSTEDE DEĞİL, bilerek: kullanıcı adı küçültülerek
     saklanıyor ve girişte de küçültülüyor, yani "AHMET" reddedilmez,
     "ahmet"e çevrilir. Reddetmek, girişte büyük harfi kabul edip açılışta
     etmemek olurdu. Normalleştirme aşağıda ayrıca sınanıyor. */
  for (const kotu of ["ab", "kullanici@ornek.com", "boşluk var", "a".repeat(31)]) {
    const x = await istek(yonetici.kavanoz, "/api/admin/hesaplar", {
      method: "POST",
      body: {
        fullName: "X",
        phone: `0559${DAMGA}`,
        username: kotu,
        password: URETILEN.password,
        userType: "student",
      },
    });
    kontrol(`Geçersiz kullanıcı adı "${kotu.slice(0, 18)}" ENGELLENİYOR (400)`, x.status === 400, `${x.status}`);
  }

  r = await istek(yonetici.kavanoz, "/api/admin/hesaplar", {
    method: "POST",
    body: {
      fullName: "X",
      phone: `0559${DAMGA}`,
      username: URETILEN.teacherUsername,
      password: URETILEN.password,
      userType: "student",
    },
  });
  kontrol("Aynı kullanıcı adıyla ikinci hesap ENGELLENİYOR (409)", r.status === 409, `${r.status}`);

  /* BÜYÜK HARF KÜÇÜLTÜLÜYOR. Düzenleme ucundan sınanıyor, açma ucundan
     değil: açma her seferinde bir hesap daha yaratır ve panelde hesap silme
     olmadığı için testin arkasında birikirdi. */
  if (ogretmenId) {
    const buyukAd = `BUYUK.${DAMGA}`;
    r = await istek(yonetici.kavanoz, `/api/admin/hesaplar/${ogretmenId}`, {
      method: "PATCH",
      body: { username: buyukAd },
    });
    kontrol(
      "Büyük harfli kullanıcı adı KABUL EDİLİP küçültülüyor",
      r.status === 200 && r.body?.account?.username === buyukAd.toLowerCase(),
      `${r.status} -> ${r.body?.account?.username}`,
    );

    /* Boş string = kaldır; sonra asıl adı geri koy. */
    r = await istek(yonetici.kavanoz, `/api/admin/hesaplar/${ogretmenId}`, {
      method: "PATCH",
      body: { username: "" },
    });
    kontrol("Boş değer kullanıcı adını KALDIRIYOR", r.status === 200 && r.body?.account?.username === null,
      `${r.status} -> ${r.body?.account?.username}`);

    r = await istek(yonetici.kavanoz, `/api/admin/hesaplar/${ogretmenId}`, {
      method: "PATCH",
      body: { username: URETILEN.teacherUsername },
    });
    kontrol("Kullanıcı adı geri konuldu", r.status === 200, `${r.status}`);
  }

  r = await istek(yonetici.kavanoz, "/api/admin/ozet");
  const beklenen = oncekiSayi + (ogretmenId ? 1 : 0) + (ogrenciId ? 1 : 0);
  kontrol(
    "Liste yeni hesapları gösteriyor",
    (r.body?.accounts?.length ?? 0) === beklenen,
    `${r.body?.accounts?.length} (beklenen ${beklenen})`,
  );

  /* Açılan hesapların kimlikleri hazır gelmediyse listeden çözülüyor. */
  const hepsi = r.body?.accounts ?? [];
  ogretmenId ??= hepsi.find((h: any) => h.phone === OGRETMEN!.phone)?.id;
  ogrenciId ??= hepsi.find((h: any) => h.phone === OGRENCI!.phone)?.id;

  /* =============================================================== MÜSAİTLİK */
  console.log("\n3) Öğretmen müsaitliği");
  const testOgretmeni = !argOku("teacher");

  r = await istek(yonetici.kavanoz, `/api/admin/ogretmenler/${ogretmenId}/musaitlik`);
  kontrol("Müsaitlik okunuyor (200)", r.status === 200, `${r.status} ${r.body?.error ?? ""}`);
  if (testOgretmeni) {
    kontrol("Hesap açarken girilen 7 aralık kaydedilmiş", r.body?.availability?.length === 7,
      `${r.body?.availability?.length}`);
  }

  r = await istek(yonetici.kavanoz, `/api/admin/ogretmenler/${ogrenciId}/program`);
  kontrol("Öğrencinin 'programı' YOK (404)", r.status === 404, `${r.status}`);

  /* Yazma testleri yalnızca betiğin kendi öğretmeninde: gerçek bir
     öğretmenin müsaitliğine dokunulmuyor. */
  if (testOgretmeni) {
    r = await istek(yonetici.kavanoz, `/api/admin/ogretmenler/${ogretmenId}/musaitlik`, {
      method: "PUT",
      body: { availability: [{ weekday: 1, startMinute: 545, endMinute: 600 }] },
    });
    kontrol("Yarım saate oturmayan aralık ENGELLENİYOR (400)", r.status === 400, `${r.status}`);

    r = await istek(yonetici.kavanoz, `/api/admin/ogretmenler/${ogretmenId}/musaitlik`, {
      method: "PUT",
      body: { availability: [] },
    });
    kontrol("Boş müsaitlik ENGELLENİYOR (400)", r.status === 400, `${r.status}`);

    r = await istek(yonetici.kavanoz, `/api/admin/ogretmenler/${ogretmenId}/musaitlik`, {
      method: "PUT",
      body: {
        availability: [
          ...TEST_MUSAITLIK.filter((a) => a.weekday !== 1),
          { weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
          { weekday: 1, startMinute: 11 * 60, endMinute: 21 * 60 },
        ],
      },
    });
    const pazartesi = (r.body?.availability ?? []).filter((a: any) => a.weekday === 1);
    kontrol(
      "Çakışan aralıklar BİRLEŞTİRİLİYOR",
      r.status === 200 && pazartesi.length === 1 && pazartesi[0].endMinute === 21 * 60,
      `${r.status} ${JSON.stringify(pazartesi)}`,
    );
  }

  /* ======================================================= ÖĞRETMEN AÇIKLAMASI */
  console.log("\n3b) Öğretmen açıklaması");
  const aciklamaOku = async () => {
    const o = await istek(yonetici.kavanoz, "/api/admin/ozet");
    return (o.body?.accounts ?? []).find((h: any) => h.id === ogretmenId)?.description;
  };

  r = await istek(yonetici.kavanoz, `/api/admin/ogretmenler/${ogrenciId}/aciklama`, {
    method: "PUT",
    body: { description: "Ogrenciye aciklama" },
  });
  kontrol("Öğrenciye açıklama yazılamıyor (404)", r.status === 404, `${r.status}`);

  /* Yazma testleri yine yalnızca betiğin kendi öğretmeninde. */
  if (testOgretmeni) {
    kontrol("Hesap listesi açıklamayı gösteriyor", (await aciklamaOku()) === TEST_ACIKLAMA);

    r = await istek(yonetici.kavanoz, `/api/admin/ogretmenler/${ogretmenId}/aciklama`, {
      method: "PUT",
      body: { description: "x".repeat(2001) },
    });
    kontrol("2000 karakteri aşan açıklama ENGELLENİYOR (400)", r.status === 400, `${r.status}`);

    r = await istek(yonetici.kavanoz, `/api/admin/ogretmenler/${ogretmenId}/aciklama`, {
      method: "PUT",
      body: { description: "   " },
    });
    kontrol("Boş açıklama KALDIRIYOR", r.status === 200 && r.body?.description === null,
      `${r.status} -> ${r.body?.description}`);
    kontrol("Kaldırılan açıklama listede null", (await aciklamaOku()) === null);

    r = await istek(yonetici.kavanoz, `/api/admin/ogretmenler/${ogretmenId}/aciklama`, {
      method: "PUT",
      body: { description: TEST_ACIKLAMA },
    });
    kontrol("Açıklama geri yazıldı", r.status === 200 && (await aciklamaOku()) === TEST_ACIKLAMA,
      `${r.status}`);
  }

  /* ================================================================== DERSLER */
  console.log("\n4) Ders atama");
  const baslangic = await bosSaatBul(yonetici.kavanoz, ogretmenId!, 50);
  kontrol("Öğretmenin programında boş saat bulundu", Boolean(baslangic), `${baslangic}`);

  const dersGovdesi = (startsAt: string | null, ekstra: Record<string, unknown> = {}) => ({
    studentId: ogrenciId,
    teacherId: ogretmenId,
    subject: "TEST TYT Matematik",
    startsAt,
    kind: "ders",
    status: "scheduled",
    ...ekstra,
  });

  r = await istek(yonetici.kavanoz, "/api/admin/dersler", { method: "POST", body: dersGovdesi(baslangic) });
  kontrol("Ders atandı (200)", r.status === 200, `${r.status} ${r.body?.error ?? ""}`);
  const dersId = r.body?.id;

  r = await istek(yonetici.kavanoz, "/api/admin/dersler", { method: "POST", body: dersGovdesi(baslangic) });
  kontrol("Aynı saate ikinci ders ENGELLENİYOR (409)", r.status === 409, `${r.status} ${r.body?.error ?? ""}`);

  const ceyrekGecesi = new Date(new Date(baslangic!).getTime() + 15 * 60_000).toISOString();
  r = await istek(yonetici.kavanoz, "/api/admin/dersler", { method: "POST", body: dersGovdesi(ceyrekGecesi) });
  kontrol("Saat başı/buçuk olmayan başlangıç ENGELLENİYOR (400)", r.status === 400, `${r.status}`);

  if (testOgretmeni) {
    /* Test öğretmeni 09:00-21:00 müsait; aynı gün 03:00 dışarıda. */
    const gece = trAn(new Date(new Date(baslangic!).getTime() + 3 * 3600_000).toISOString().slice(0, 10), 3 * 60);
    r = await istek(yonetici.kavanoz, "/api/admin/dersler", { method: "POST", body: dersGovdesi(gece) });
    kontrol("Müsaitlik dışındaki saat ENGELLENİYOR (400)", r.status === 400, `${r.status}`);
  }

  /* Deneme dersi: süre 25 dk ve istemcinin gönderdiği bitiş YOK SAYILIYOR. */
  const denemeSaati = await bosSaatBul(yonetici.kavanoz, ogretmenId!, 25);
  r = await istek(yonetici.kavanoz, "/api/admin/dersler", {
    method: "POST",
    body: dersGovdesi(denemeSaati, {
      subject: "TEST deneme dersi",
      isTrial: true,
      endsAt: new Date(new Date(denemeSaati!).getTime() + 3 * 3600_000).toISOString(),
    }),
  });
  kontrol("Deneme dersi atandı (200)", r.status === 200, `${r.status} ${r.body?.error ?? ""}`);
  const denemeId = r.body?.id;

  /* Rol doğrulaması: veritabanı bunu yapmıyor, route yapıyor. */
  r = await istek(yonetici.kavanoz, "/api/admin/dersler", {
    method: "POST",
    body: { studentId: ogretmenId, subject: "X", startsAt: baslangic, kind: "ders", status: "scheduled" },
  });
  kontrol("Öğretmen, öğrenci alanına KONAMIYOR (400)", r.status === 400, `${r.status}`);

  r = await istek(yonetici.kavanoz, "/api/admin/dersler");
  const listeDers = (r.body?.lessons ?? []).find((d: any) => d.id === dersId);
  kontrol(
    "Ders listede ve adlar çözülmüş",
    Boolean(listeDers?.studentName && listeDers?.teacherName),
    `${listeDers?.studentName} / ${listeDers?.teacherName}`,
  );
  const dakika = (d: any) => (new Date(d?.endsAt).getTime() - new Date(d?.startsAt).getTime()) / 60_000;
  kontrol("Normal ders 50 dk (bitişi sunucu hesapladı)", dakika(listeDers) === 50 && listeDers?.isTrial === false,
    `${dakika(listeDers)} dk`);
  const listeDeneme = (r.body?.lessons ?? []).find((d: any) => d.id === denemeId);
  kontrol("Deneme dersi 25 dk ve işaretli", dakika(listeDeneme) === 25 && listeDeneme?.isTrial === true,
    `${dakika(listeDeneme)} dk, isTrial=${listeDeneme?.isTrial}`);

  r = await istek(yonetici.kavanoz, `/api/admin/dersler/${denemeId}`, { method: "DELETE" });
  kontrol("Deneme dersi silindi", r.status === 200, `${r.status}`);

  /* Saati değişmeyen düzenleme kuralları yeniden uygulamıyor; konu değişiyor. */
  r = await istek(yonetici.kavanoz, `/api/admin/dersler/${dersId}`, {
    method: "PATCH",
    body: dersGovdesi(baslangic, { subject: "TEST TYT Matematik (düzenlendi)" }),
  });
  kontrol("Ders konusu düzenlendi (200)", r.status === 200, `${r.status} ${r.body?.error ?? ""}`);

  /* =================================================================== ÜCRET */
  console.log("\n5) Ücret girme");
  r = await istek(yonetici.kavanoz, "/api/admin/odemeler", {
    method: "POST",
    body: {
      studentId: ogrenciId,
      period: "TEST-2026-09",
      amount: "9500,50",
      currency: "TRY",
      status: "bekliyor",
      dueOn: "2026-09-30",
    },
  });
  kontrol("Ödeme eklendi (200)", r.status === 200, `${r.status} ${r.body?.error ?? ""}`);
  const odemeId = r.body?.id;

  r = await istek(yonetici.kavanoz, "/api/admin/odemeler");
  const listeOdeme = (r.body?.payments ?? []).find((o: any) => o.id === odemeId);
  kontrol("Virgüllü tutar doğru çözüldü", listeOdeme?.amount === 9500.5, `${listeOdeme?.amount}`);

  r = await istek(yonetici.kavanoz, `/api/admin/odemeler/${odemeId}`, {
    method: "PATCH",
    body: {
      studentId: ogrenciId,
      period: "TEST-2026-09",
      amount: 12000,
      currency: "TRY",
      status: "odendi",
      dueOn: null,
    },
  });
  kontrol("Ödeme düzenlendi (200)", r.status === 200, `${r.status}`);

  /* ================================================================ ÖĞRETMEN */
  console.log("\n6) Öğretmen paneli");
  const ogretmen = await girisYap(OGRETMEN!, "Öğretmen");
  if (!ogretmen) {
    console.error("  Panelden açılan hesapla giriş yapılamadı — Admin API akışı bozuk.");
    process.exit(1);
  }
  kontrol("Panelden açılan hesapla giriş yapılabiliyor", true, "Admin API akışı doğru");
  kontrol("userType = teacher", ogretmen.user?.userType === "teacher", `${ogretmen.user?.userType}`);

  /* KULLANICI ADIYLA GİRİŞ — telefonla aynı hesabı açmalı. */
  if (ogretmenId) {
    const kav = new Kavanoz();
    const ka = await istek(kav, "/api/auth/login", {
      method: "POST",
      body: { username: URETILEN.teacherUsername, password: URETILEN.password, website: "" },
    });
    kontrol("Kullanıcı adıyla giriş -> 200", ka.status === 200, `${ka.status} ${ka.body?.error ?? ""}`);
    kontrol("Aynı hesabı açıyor", ka.body?.user?.id === ogretmenId, `${ka.body?.user?.id === ogretmenId}`);

    /* Büyük harfle yazılsa da çalışmalı: kullanıcı adı küçültülerek saklanıyor. */
    const kav2 = new Kavanoz();
    const buyuk = await istek(kav2, "/api/auth/login", {
      method: "POST",
      body: {
        username: URETILEN.teacherUsername.toUpperCase(),
        password: URETILEN.password,
        website: "",
      },
    });
    kontrol("Kullanıcı adı BÜYÜK harfle de çalışıyor", buyuk.status === 200, `${buyuk.status}`);

    const kav3 = new Kavanoz();
    const yanlis = await istek(kav3, "/api/auth/login", {
      method: "POST",
      body: { username: URETILEN.teacherUsername, password: "yanlis-sifre", website: "" },
    });
    kontrol("Kullanıcı adı + yanlış şifre -> 401", yanlis.status === 401, `${yanlis.status}`);

    const kav4 = new Kavanoz();
    const yok = await istek(kav4, "/api/auth/login", {
      method: "POST",
      body: { username: `olmayan.${DAMGA}`, password: URETILEN.password, website: "" },
    });
    kontrol("Olmayan kullanıcı adı -> 401 (aynı mesaj)", yok.status === 401, `${yok.status}`);
  }

  /* ========================================================= SÖZLEŞME KAPISI */
  /* Yayınlanmış bir öğretmen sözleşmesi varken onaylamamış öğretmenin panel
     uçlarının HEPSİ 403 SOZLESME_GEREKLI dönmeli; onay ucu kapının önünde.
     Bu blok aşağıdaki ilk /schedule çağrısından ÖNCE olmak zorunda: onay
     verilmeden o çağrı 403 alırdı. Sözleşme henüz yayınlanmamışsa kapı devre
     dışı ve test atlanıyor — KALDI sayılmıyor. */
  console.log("\n6a) Sözleşme kapısı");
  /* Bu bloktan sonra öğretmen hâlâ onaysızsa true: kalan öğretmen testleri atlanır. */
  let sozlesmeKapali = false;
  r = await istek(ogretmen.kavanoz, "/api/teacher/sozlesme");
  kontrol("GET /api/teacher/sozlesme -> 200", r.status === 200, `${r.status} ${r.body?.error ?? ""}`);
  /* Uç hata döndüyse (502/503) kapının durumu bilinmiyor; kalan öğretmen
     testleri tek tek 403'e düşüp raporu boğmasın. */
  if (r.status !== 200) sozlesmeKapali = true;

  if (r.status === 200 && r.body?.gerekli === false) {
    console.log("  ATLANDI  Kapı testi — sözleşme henüz yayınlanmamış ya da bu öğretmen zaten onaylamış.");
  } else if (r.status === 200 && r.body?.gerekli === true) {
    const b = r.body.belgeler ?? {};
    kontrol(
      "Üç belge de geliyor (sözleşme, aydınlatma metni, koşullar)",
      ["sozlesme", "aydinlatma", "kosullar"].every(
        (k) => typeof b[k]?.id === "string" && typeof b[k]?.version === "number" && Boolean(b[k]?.body),
      ),
      ["sozlesme", "aydinlatma", "kosullar"].map((k) => `${k} v${b[k]?.version ?? "?"}`).join(", "),
    );
    const gecerliOnay = {
      sozlesmeId: b.sozlesme?.id,
      aydinlatmaId: b.aydinlatma?.id,
      kosullarId: b.kosullar?.id,
      aydinlatmaOkundu: true,
      kosullarKabul: true,
    };
    const onayGonder = (govde: Record<string, unknown>) =>
      istek(ogretmen.kavanoz, "/api/teacher/sozlesme", { method: "POST", body: govde });

    for (const yol of ["/api/teacher/schedule", "/api/teacher/ozet"]) {
      const x = await istek(ogretmen.kavanoz, yol);
      kontrol(
        `Onaysız öğretmen -> ${yol} ENGELLENİYOR (403 SOZLESME_GEREKLI)`,
        x.status === 403 && x.body?.code === "SOZLESME_GEREKLI",
        `${x.status} ${x.body?.code ?? ""}`,
      );
    }

    let x = await onayGonder({ ...gecerliOnay, kosullarKabul: false });
    kontrol("Hizmet Koşulları kabul edilmeden onay ENGELLENİYOR (400)", x.status === 400, `${x.status}`);

    x = await onayGonder({ ...gecerliOnay, aydinlatmaOkundu: false });
    kontrol("Aydınlatma metni okundu işaretlenmeden onay ENGELLENİYOR (400)", x.status === 400, `${x.status}`);

    /* Güncel olmayan (burada: hiç var olmayan) bir sözleşme kimliği —
       öğretmen modal açıkken yeni sürüm yayınlanmış gibi. */
    x = await onayGonder({ ...gecerliOnay, sozlesmeId: crypto.randomUUID() });
    kontrol(
      "Güncel olmayan sözleşme kimliği ENGELLENİYOR (409 SOZLESME_GUNCELLENDI)",
      x.status === 409 && x.body?.code === "SOZLESME_GUNCELLENDI",
      `${x.status} ${x.body?.code ?? ""}`,
    );

    const ozettekiSozlesme = async () => {
      const o = await istek(yonetici.kavanoz, "/api/admin/ozet");
      return (o.body?.accounts ?? []).find((h: any) => h.id === ogretmenId)?.sozlesme;
    };

    /* Onay yalnızca BETİĞİN KENDİ öğretmeni adına (bkz. baştaki not). */
    if (testOgretmeni) {
      const once = await ozettekiSozlesme();
      kontrol("Yönetim listesi öğretmeni ONAY BEKLİYOR gösteriyor", once?.onaylandi === false && once?.tarih === null,
        JSON.stringify(once));

      x = await onayGonder(gecerliOnay);
      kontrol("Sözleşme onaylandı (200)", x.status === 200, `${x.status} ${x.body?.error ?? ""}`);
      if (x.status === 200) sozlesmeOnayiYazildi = true;

      x = await onayGonder(gecerliOnay);
      kontrol("İkinci onay da 200 (çift tık; yeni satır yazılmıyor)", x.status === 200, `${x.status}`);

      x = await istek(ogretmen.kavanoz, "/api/teacher/sozlesme");
      kontrol("Onaydan sonra sözleşme artık gerekmiyor", x.status === 200 && x.body?.gerekli === false,
        `${x.status} gerekli=${x.body?.gerekli}`);

      const sonra = await ozettekiSozlesme();
      kontrol(
        "Yönetim listesi öğretmeni ONAYLI ve tarihli gösteriyor",
        sonra?.onaylandi === true && typeof sonra?.tarih === "string",
        JSON.stringify(sonra),
      );
    } else {
      kontrol(
        "Verilen öğretmen sözleşmeyi onaylamış",
        false,
        "betik gerçek bir öğretmen adına onay vermez; öğretmen panelden kendisi onaylamalı",
      );
    }
    sozlesmeKapali = !sozlesmeOnayiYazildi;
  }

  /* Onaysız kalan öğretmenle (--teacher ile verilen gerçek bir öğretmen ya da
     onayı başarısız olan test öğretmeni) aşağıdaki her öğretmen ucu
     403 SOZLESME_GEREKLI döner. Kapı zaten tek bir KALDI olarak raporlandı;
     ardından gelen onlarca 403'ü KALDI diye listelemek raporu okunmaz yapardı. */
  const YORUM = "TEST yorumu — uçtan uca doğrulama.";
  if (sozlesmeKapali) {
    console.log("  ATLANDI  Program, ders durumu ve yorum testleri — öğretmen sözleşmeyi onaylamamış.");
  } else {
    r = await istek(ogretmen.kavanoz, "/api/teacher/schedule");
    kontrol("Program -> 200", r.status === 200, `${r.status}`);
    kontrol(
      "Atanan ders öğretmenin programında",
      (r.body?.lessons ?? []).some((d: any) => d.id === dersId),
      `${(r.body?.lessons ?? []).length} ders`,
    );

    /* Açıklama yalnızca yöneticinin: öğretmenin kendi uçlarının hiçbirinde
       geçmemeli. (Veritabanı katmanı ayrıca supabase-teacher-panel-tests.sql
       33-35'te sınanıyor.) */
    if (testOgretmeni) {
      const me = await istek(ogretmen.kavanoz, "/api/auth/me");
      const ozet = await istek(ogretmen.kavanoz, "/api/teacher/ozet");
      kontrol(
        "Öğretmen kendi açıklamasını GÖREMİYOR",
        !JSON.stringify([r.body, me.body, ozet.body]).includes(TEST_ACIKLAMA),
      );
    }

    /* Tamamlanmamış derse yorum reddedilmeli. */
    r = await istek(ogretmen.kavanoz, `/api/teacher/lessons/${dersId}/comment`, {
      method: "PUT",
      body: { comment: "Erken yorum denemesi" },
    });
    kontrol("Tamamlanmamış derse yorum ENGELLENİYOR (400)", r.status === 400, `${r.status}`);

    r = await istek(ogretmen.kavanoz, `/api/teacher/lessons/${dersId}/status`, {
      method: "PATCH",
      body: { status: "completed" },
    });
    kontrol('Ders "işlendi" yapıldı (200)', r.status === 200, `${r.status}`);

    r = await istek(ogretmen.kavanoz, `/api/teacher/lessons/${dersId}/status`, {
      method: "PATCH",
      body: { status: "cancelled" },
    });
    kontrol("Öğretmen dersi İPTAL EDEMİYOR (400)", r.status === 400, `${r.status}`);

    r = await istek(ogretmen.kavanoz, `/api/teacher/lessons/${dersId}/comment`, {
      method: "PUT",
      body: { comment: YORUM },
    });
    kontrol("Yorum yazıldı (200)", r.status === 200, `${r.status}`);

    r = await istek(ogretmen.kavanoz, `/api/teacher/lessons/${dersId}/comment`, {
      method: "PUT",
      body: { comment: "   " },
    });
    kontrol("Boş yorum ENGELLENİYOR (400)", r.status === 400, `${r.status}`);

    r = await istek(
      ogretmen.kavanoz,
      "/api/teacher/lessons/99999999-9999-4999-8999-999999999999/comment",
      { method: "PUT", body: { comment: "Başkasının dersi" } },
    );
    kontrol("Başkasının dersine yorum ENGELLENİYOR (403)", r.status === 403, `${r.status}`);
  }

  /* ================================================================= ÖĞRENCİ */
  console.log("\n7) Öğrenci paneli");
  const ogrenci = await girisYap(OGRENCI!, "Öğrenci");
  if (!ogrenci) {
    console.error("  Öğrenci girişi başarısız.");
    process.exit(1);
  }
  kontrol("userType = student", ogrenci.user?.userType === "student", `${ogrenci.user?.userType}`);

  r = await istek(ogrenci.kavanoz, "/api/portal/ozet");
  kontrol("Öğrenci paneli -> 200", r.status === 200, `${r.status}`);
  kontrol(
    "Girilen ücret öğrencinin panelinde",
    (r.body?.payments ?? []).some((o: any) => o.id === odemeId),
    `${(r.body?.payments ?? []).length} ödeme`,
  );

  r = await istek(ogrenci.kavanoz, "/api/portal/yorumlar");
  kontrol("Koçun yorumları -> 200", r.status === 200, `${r.status}`);
  const yorumlu = (r.body?.lessons ?? []).find((d: any) => d.id === dersId);
  if (sozlesmeKapali) {
    console.log("  ATLANDI  Öğretmenin yorumu — öğretmen sözleşmeyi onaylamadığı için yorum yazılmadı.");
  } else {
    kontrol("Öğretmenin yorumu öğrenciye görünüyor", yorumlu?.comment?.text === YORUM,
      `${yorumlu?.comment?.text ?? "YOK"}`);
  }

  /* =========================================================== ROL İZOLASYONU */
  console.log("\n8) Rol izolasyonu");
  for (const [ad, kav] of [
    ["Öğretmen", ogretmen.kavanoz],
    ["Öğrenci", ogrenci.kavanoz],
  ] as const) {
    for (const yol of [
      "/api/admin/ozet",
      "/api/admin/dersler",
      "/api/admin/odemeler",
      "/api/admin/basvurular",
      `/api/admin/ogretmenler/${ogretmenId}/program`,
    ]) {
      const x = await istek(kav, yol);
      kontrol(`${ad} -> ${yol} ENGELLENİYOR (403)`, x.status === 403, `${x.status}`);
    }
    const y = await istek(kav, "/api/admin/hesaplar", {
      method: "POST",
      body: { fullName: "Sizma", phone: `0558${DAMGA}`, password: "AAaa12345", userType: "admin" },
    });
    kontrol(`${ad} hesap AÇAMIYOR (403)`, y.status === 403, `${y.status}`);
  }

  const ogrenciOgretmenUcu = await istek(ogrenci.kavanoz, "/api/teacher/schedule");
  kontrol("Öğrenci -> /api/teacher/schedule ENGELLENİYOR (403)",
    ogrenciOgretmenUcu.status === 403, `${ogrenciOgretmenUcu.status}`);

  /* Sözleşme uçları sözleşme kapısının önünde ama ROL kapısının arkasında:
     öğrenci "sözleşmeyi onaylayın" değil, rol 403'ünü almalı (kodsuz). */
  const ogrenciSozlesme = await istek(ogrenci.kavanoz, "/api/teacher/sozlesme");
  kontrol("Öğrenci -> /api/teacher/sozlesme ENGELLENİYOR (rol 403'ü)",
    ogrenciSozlesme.status === 403 && ogrenciSozlesme.body?.code === undefined,
    `${ogrenciSozlesme.status} ${ogrenciSozlesme.body?.code ?? ""}`);
  const ogrenciOnay = await istek(ogrenci.kavanoz, "/api/teacher/sozlesme", {
    method: "POST",
    body: {
      sozlesmeId: crypto.randomUUID(),
      aydinlatmaId: crypto.randomUUID(),
      kosullarId: crypto.randomUUID(),
      aydinlatmaOkundu: true,
      kosullarKabul: true,
    },
  });
  kontrol("Öğrenci sözleşme ONAYLAYAMIYOR (403)", ogrenciOnay.status === 403, `${ogrenciOnay.status}`);

  const ogretmenOgrenciUcu = await istek(ogretmen.kavanoz, "/api/portal/ozet");
  kontrol("Öğretmen -> /api/portal/ozet ENGELLENİYOR (403)",
    ogretmenOgrenciUcu.status === 403, `${ogretmenOgrenciUcu.status}`);

  /* ================================================================ OTURUMSUZ */
  console.log("\n9) Oturumsuz");
  const bos = new Kavanoz();
  for (const yol of [
    "/api/portal/ozet",
    "/api/portal/yorumlar",
    "/api/teacher/schedule",
    "/api/teacher/sozlesme",
    "/api/admin/ozet",
    "/api/admin/basvurular",
  ]) {
    const x = await istek(bos, yol);
    kontrol(`Oturumsuz ${yol} -> 401`, x.status === 401, `${x.status}`);
  }

  /* ================================================================== TEMİZLİK */
  console.log("\n10) Temizlik");
  r = await istek(yonetici.kavanoz, `/api/admin/dersler/${dersId}`, { method: "DELETE" });
  kontrol("Test dersi silindi", r.status === 200, `${r.status}`);
  r = await istek(yonetici.kavanoz, `/api/admin/odemeler/${odemeId}`, { method: "DELETE" });
  kontrol("Test ödemesi silindi", r.status === 200, `${r.status}`);

  console.log(`\n${gecen}/${toplam} test geçti.`);
  if (kalanlar.length) {
    console.log("\nKALANLAR:");
    for (const x of kalanlar) console.log(`  - ${x}`);
  }

  if (ogretmenId || ogrenciId) {
    console.log("\nBETİĞİN AÇTIĞI HESAPLAR (silinmedi — panelde hesap silme yok):");
    if (ogretmenId) {
      console.log(`  TEST Ogretmen  ${OGRETMEN!.phone}  (kullanıcı adı: ${URETILEN.teacherUsername})`);
    }
    if (ogrenciId) console.log(`  TEST Ogrenci   ${OGRENCI!.phone}`);
    console.log(`  şifre: ${URETILEN.password}`);
  }

  if (sozlesmeOnayiYazildi) {
    console.log("\nSÖZLEŞME ONAYI YAZILDI (silinemez):");
    console.log(`  TEST Ogretmen ${OGRETMEN!.phone} adına teacher_contract_acceptances'a bir satır eklendi.`);
    console.log("  Tablo yalnızca eklemeye açık ve teacher_id ON DELETE RESTRICT — bu öğretmen");
    console.log("  hesabı artık Dashboard'dan da silinemez.");
  }

  process.exit(gecen === toplam ? 0 : 1);
}

calistir().catch((err) => {
  console.error("\nTest çalıştırılamadı:", err?.message || err);
  process.exit(1);
});
