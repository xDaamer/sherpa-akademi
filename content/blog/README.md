# Blog içeriği nasıl yazılır

Bloğun tamamı bu klasördeki markdown dosyalarından üretiliyor. Veritabanı,
yönetim paneli ve giriş ekranı **yok**: yazı yayınlamak = dosyayı düzenleyip
`git push` yapmak. Push'tan ~35 saniye sonra yazı canlıda.

Bunun sebebi güvenlik. Çalışma anında içerik yazan bir uç olmadığı için o uca
bağlı zafiyet sınıfları da yok: editör üzerinden XSS, başkasının yazısını
düzenleme, önizleme jetonu sahteciliği, dosya yükleme açıkları. Yayın yetkisi
= depoya push yetkisi.

## Klasör düzeni

```
content/blog/
  yazilar/<slug>.md        ← yazılar. Dosya adı adresi belirler.
  kategoriler/<slug>.md    ← kategoriler (6 tane hazır geldi)
  yazarlar/<slug>.md       ← yazarlar. _sablon.md kopyalanarak eklenir.
  gorseller/               ← görsellerin kaynak dosyaları
  yonlendirmeler.json      ← slug değiştiğinde eski adres için 301
```

Adı `_` ile başlayan dosyalar atlanır — şablonlar bu yüzden `_sablon.md`.

## Yeni yazı açmak

1. Yazının türüne uyan şablonu kopyalayın:
   `cp _sablon-veri.md tyt-matematik-konu-dagilimi.md`
   Dosya adı doğrudan adres olur → `sherpakademi.com/blog/tyt-matematik-konu-dagilimi`
2. Frontmatter'ı doldurun, iskeletteki H2'leri yazın.
3. `npm run blog:check` çalıştırın.
4. Hata yoksa commit + push.

```yaml
---
title: "TYT Matematik Konu Dağılımı ve Soru Sayıları"
excerpt: "Son beş yılın TYT matematik sorularının konu bazlı dağılımı ve bu dağılımın çalışma planına nasıl yansıtılacağı."
tldr: "TYT matematikte 40 sorunun yaklaşık 12'si temel kavramlar, 8'i problemler ve 6'sı geometriden geliyor. Bu üç başlık toplam soruların yarısından fazlası."
type: veri                     # arketip — aşağıdaki tabloya bakın
category: yks
author: ad-soyad
reviewer: baska-ad-soyad      # isteğe bağlı: "X tarafından incelendi"
tags: [tyt, matematik, konu-dagilimi]
status: published              # draft | published
publishedAt: 2026-09-14
contentUpdatedAt:              # içerik ANLAMLI biçimde değişince güncelleyin
lastReviewedAt: 2026-09-14     # gözden geçirme tarihi (tazelik takibi)
cover: tyt-matematik.jpg
coverAlt: "TYT matematik konularının soru sayılarına göre dağılımını gösteren grafik"
ogImage:                       # boşsa kapak görseli kullanılır
seoTitle: "TYT Matematik Konu Dağılımı (Soru Sayılarıyla)"
seoDescription: "TYT matematikte hangi konudan kaç soru çıkıyor? Son beş yılın dağılımı, konu öncelikleri ve bu veriyle çalışma planı kurma rehberi."
focusKeyword: "tyt matematik konu dağılımı"
canonical:                     # boşsa kendi adresi
noindex: false
pillarOf: yks-hazirlik-rehberi # bağlı olduğu pillar yazının slug'ı
featured: false
faq:
  - q: "TYT matematikte kaç soru var?"
    a: "40 soru var ve tamamı tek oturumda çözülüyor."
  - q: "Geometri TYT'de ayrı bir bölüm mü?"
    a: "Hayır, geometri soruları matematik testinin içinde yer alıyor."
related: [lgs-matematik-calisma-plani]
---

## Gövde buradan başlar
```

### Alan kuralları

| Alan | Kural |
|---|---|
| `type` | Zorunlu. 8 arketipten biri (aşağıdaki tablo). Kelime aralığını ve türe özgü zorunlulukları belirler. |
| `title` | En fazla 200 karakter. Sayfadaki tek `H1` budur. |
| `excerpt` | En fazla 320 karakter. Kart ve liste özeti. |
| `tldr` | Yayınlanan yazılarda **zorunlu**. Sorunun doğrudan cevabı, 2–3 cümle. AI aramalarında alıntılanan kısım genelde burası. |
| `seoTitle` | En fazla 70. Boşsa `title` kullanılır. |
| `seoDescription` | 140–170 karakter. |
| `coverAlt` | `cover` varsa **zorunlu** — alt metinsiz görsel build'i durdurur. |
| `canonical` | Yalnızca `/` ile başlayan kendi yollarımız. Dış adres kabul edilmez. |
| `faq` | Ya boş ya en az 2 soru. Sayfadaki accordion ve `FAQPage` şeması aynı metni kullanır. |
| `related` | En fazla 4, yayında olan yazılar. Boşsa otomatik seçilir. |

### Gövde kuralları

- **`# ` (H1) kullanmayın.** Sayfadaki tek H1 `title` alanıdır; gövde `## ` ile başlar.
- İç linkler `/` ile başlar: `[TYT konuları](/blog/tyt-konulari)`. Kırık iç link build'i durdurur.
- Görsellerde alt metin zorunlu: `![Grafik açıklaması](/blog/gorseller/dosya.webp)`.
- En az 3 iç link ve bağlı olduğu pillar yazıya bir link önerilir (uyarı verir, engellemez).
- Yıl bilgisi **slug'a konmaz**. Yazı her yıl güncellenecek, adres sabit kalmalı; yıl sadece başlıkta ve metinde geçer.

## Arketipler (yazı türleri)

Her yazı sekiz kalıptan **birine** oturur. Tür sadece bir etiket değil: kelime
aralığını ve o türün olmazsa olmaz ögesini de belirler; `blog:check` bunları
türe göre ölçer.

| `type` | Ne işe yarar | Kelime | Türe özgü zorunluluk |
|---|---|---|---|
| `pillar` | Küme merkezi, iç link dağıtıcısı | 2.500–4.000 | Tablo, 5 SSS, her cluster'a link |
| `veri` | Trafik motoru — konu dağılımı, puan tablosu | 900–1.500 | **Merkezde tablo**, veri kaynağı belirtilmeli |
| `nasil` | "Nasıl yapılır" sorguları | 1.200–1.800 | `## Örnek: ...` bölümü, somut sayılarla |
| `karar` | Dönüşüm — "X mi Y mi" | 1.200–1.800 | Karşılaştırma tablosu, iki tarafın da sınırları |
| `guncel` | Duyuru, takvim | 600–900 | Tarih tablosu + yorum katmanı |
| `veli` | Karar verici veliye | 1.000–1.500 | Örnek diyalog bölümü |
| `vaka` | Başarı hikâyesi, E-E-A-T | 800–1.200 | Somut başlangıç/sonuç sayıları |
| `arac` | Hesaplayıcı, şablon | serbest | Araç fold üstünde |

Her tür için hazır iskelet var: `_sablon-<type>.md`. Kopyalayarak başlayın —
iskeletteki H2 sırası tesadüfi değil.

### Küme (pillar–cluster) kuralı

Bir yazı tek bir kümeye ait olur (`pillarOf`). Pillar her cluster'a link verir,
her cluster pillar'a. **Yeni bir cluster yayınladığınızda pillar dosyasına
dönüp linkini eklemek zorundasınız** — `blog:check` linki olmayan cluster'ı
*hata* olarak veriyor, uyarı olarak değil. Sebebi: uyarı olsaydı tam da bu
adım atlanırdı ve altı ay sonra pillar on cluster'ın üçüne bağlı kalırdı.

Aynı odak kelimeyi iki yazıda hedeflemek de **hata**: birbirlerinin sıralamasını
yerler. Şüphe varsa yeni yazı açmayın, mevcut yazıyı genişletin.

## Taslak ve zamanlama

- `status: draft` → yayına hiç çıkmaz, `blog:check` raporunda görünür.
- `status: published` + ileri tarihli `publishedAt` → o tarihe kadar yayınlanmaz.
  **Tarih geldiğinde kendiliğinden yayınlanmaz**; yeni bir deploy gerekir.
- Taslağı canlıya benzer bir ortamda görmek için ayrı bir dalda çalışın: Vercel
  o dal için otomatik bir önizleme adresi üretir ve önizleme dağıtımları zaten
  arama motorlarına kapalıdır.

## Yazarlar

`kind: kisi` (varsayılan) gerçek bir insan içindir ve `Person` şeması üretir.
Bir kadro adına yazılan içerik için `kind: ekip` kullanın; `Organization`
olarak, sitenin kuruluşuna bağlı işaretlenir. Bir ekibi kişi gibi göstermek
var olmayan bir yazar beyan etmek olur.

## Slug değiştirmek

Dosyayı yeniden adlandırmak adresi değiştirir. Eski adres yer imlerinde ve
Google'da duruyor olabilir, bu yüzden yönlendirme gerekir.

> **Dikkat:** `yonlendirmeler.json` şu an yalnızca doğrulanıyor, hiçbir yere
> yazılmıyor — oraya eklenen satır canlıda yönlendirme ÜRETMEZ. Gerçek
> yönlendirmeyi kök dizindeki `vercel.json`'un `redirects` listesine
> `"permanent": true` ile ekleyin (örnek: yazar adresi
> `/blog/yazar/akademitu-egitim-ekibi` orada yönleniyor). Aşağıdaki biçim,
> dosya ileride bağlanırsa diye duruyor:

```json
[{ "from": "/blog/eski-adres", "to": "/blog/yeni-adres" }]
```

Hedef yalnızca kendi sitemizin yolu olabilir (`/` ile başlar, `//` ile başlayamaz)
ve zincir kurulamaz: `A → B` varken `B → C` eklenemez, doğrudan son hedefi yazın.

## Doğrulama

```
npm run blog:check
```

**Hata** build'i durdurur:

- eksik zorunlu alan, olmayan kategori/yazar/tür, kırık iç link
- alt metinsiz görsel, gövdede `# ` (H1), başlık seviyesi atlama (H2→H4)
- `canonical` veya yönlendirme hedefinde dış alan adı
- pillar'ın link vermediği cluster, aynı odak kelimeyi paylaşan iki yazı
- **taahhüt içeren ifade**: "garanti", "%100 başarı", "kesin sonuç", puan vaadi.
  Hem etik dışı hem reklam mevzuatı riski — bu yüzden uyarı değil hata.

**Uyarı** yayını engellemez, SEO tavsiyesidir:

- türün kelime aralığı dışında kalmak, türün istediği tablo/örnek bölümünün olmaması
- odak kelimenin altı yerden birinde geçmemesi (başlık, ilk 100 kelime, bir H2,
  slug, meta açıklama, kapak alt metni)
- 3'ten az iç link, kümeden 3'ten az link, pillar'a link yokluğu
- 30 kelimeyi aşan cümle, 4 cümleyi aşan paragraf, 300 kelime boyunca görsel
  kırılma olmaması
- soru formunda 2'den az H2, hiç tablo/liste olmaması
- TL;DR'ın cevap yerine "bu yazıda ... ele alacağız" demesi
- "buraya tıklayın" gibi açıklayıcı olmayan anchor metni
- 90/180 günden eski `lastReviewedAt`

### Ölçülemeyenler

Bunlar makineye devredilmedi, çünkü uydurma bir ölçüt yanlış güven verir.
İnsan kararı olarak kalıyorlar (bkz. `STIL-REHBERI.md`): H2'nin altındaki ilk
paragrafın soruyu doğrudan cevaplaması, öğrenciye "sen"/veliye "siz" tonunun
tutarlılığı, karşılaştırmanın dürüstlüğü, örneğin gerçekten somut olması.

`npm run build` aynı kontrolü baştan çalıştırır — kırık içerik canlıya çıkamaz.
