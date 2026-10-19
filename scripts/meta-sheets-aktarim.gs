/**
 * META BAŞVURULARI (GOOGLE SHEETS) -> SHERPA AKADEMİ YÖNETİM PANELİ
 * ===========================================================================
 * Meta'nın "CRM kurulumu › Google Sheets" bağlantısının başvuru yazdığı
 * tabloya eklenir. Birkaç dakikada bir tablonun son satırlarını
 * https://www.sherpakademi.com/api/meta/sheets adresine gönderir; hangisinin
 * yeni olduğuna sunucu karar verir (bkz. server/routes/metaSheets.ts), yani
 * aynı satırın tekrar gitmesi zararsız ve yarıda kalan bir tur hiçbir
 * başvuruyu kaybettirmez.
 *
 * Bu dosyada DEĞİŞTİRİLECEK BİR ŞEY YOK — olduğu gibi yapıştırılır.
 *
 * KURULUM (bir kez):
 *  1. Başvuru tablosu açıkken: Uzantılar › Apps Script. Açılan dosyadaki her
 *     şeyi silip bu dosyanın tamamını yapıştırın, Kaydet (disket simgesi).
 *  2. Üstteki fonksiyon listesinden `anahtarOlustur` seçin › Çalıştır.
 *     Google izin isterse: hesabınızı seçin › Gelişmiş › "... projesine git
 *     (güvenli değil)" › İzin ver. (Kendi yazdığınız script olduğu için
 *     Google bu uyarıyı gösteriyor.)
 *  3. Alttaki "Yürütme günlüğü"nde yazan anahtarı kopyalayın ve Vercel'e
 *     META_SHEETS_KEY adıyla girin.
 *  4. Site yayına alındıktan sonra: `baslat` seçin › Çalıştır. Tablodaki
 *     bütün başvurular bir kez aktarılır, sonra her 5 dakikada bir yeniler.
 *
 * Aktarım hata verirse Google bunu e-postayla bildirir; bir sonraki tur
 * kendiliğinden yeniden dener.
 */

var ADRES = 'https://www.sherpakademi.com/api/meta/sheets';
var SON_SATIR_SAYISI = 300; // her turda gönderilen son satır sayısı (sekme başına)
var PARCA = 200; // tek istekte en fazla satır

/** Kurulum 2. adım: gizli anahtarı üretir ve günlüğe yazar. */
function anahtarOlustur() {
  var ozellikler = PropertiesService.getScriptProperties();
  var anahtar = ozellikler.getProperty('ANAHTAR');
  if (!anahtar) {
    anahtar = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    ozellikler.setProperty('ANAHTAR', anahtar);
  }
  console.log('Vercel › Settings › Environment Variables › META_SHEETS_KEY değeri:\n\n' + anahtar);
}

/** Kurulum 4. adım: geçmişin tamamını gönderir ve 5 dakikalık tetikleyiciyi kurar. */
function baslat() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'aktar') ScriptApp.deleteTrigger(t);
  });
  gonder_(true);
  ScriptApp.newTrigger('aktar').timeBased().everyMinutes(5).create();
  console.log('Tamam: aktarım her 5 dakikada bir kendiliğinden çalışacak.');
}

/** Tetikleyicinin çağırdığı fonksiyon. Elle de çalıştırılabilir. */
function aktar() {
  gonder_(false);
}

function gonder_(hepsi) {
  var anahtar = PropertiesService.getScriptProperties().getProperty('ANAHTAR');
  if (!anahtar) throw new Error('Önce anahtarOlustur fonksiyonunu çalıştırın.');

  var toplam = { gelen: 0, yazilan: 0, zatenVardi: 0, atlanan: 0 };

  /* Meta her form için ayrı bir sekme açabiliyor. Başlığında telefon sütunu
     olan her sekme başvuru sekmesi sayılır; başka sekmelere dokunulmaz. */
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sayfa) {
    var son = sayfa.getLastRow();
    var sutun = sayfa.getLastColumn();
    if (son < 2 || sutun < 1) return;

    var basliklar = sayfa.getRange(1, 1, 1, sutun).getDisplayValues()[0];
    if (!basliklar.some(function (b) { return /phone|telefon/i.test(b); })) return;

    var ilk = hepsi ? 2 : Math.max(2, son - SON_SATIR_SAYISI + 1);
    /* getDisplayValues: tarihler ve uzun sayılar (telefon) tabloda nasıl
       görünüyorsa öyle, metin olarak gelsin. */
    var degerler = sayfa.getRange(ilk, 1, son - ilk + 1, sutun).getDisplayValues();
    var satirlar = degerler
      .map(function (r) {
        var o = {};
        basliklar.forEach(function (b, i) {
          if (b && r[i] !== '') o[b] = r[i];
        });
        return o;
      })
      .filter(function (o) { return Object.keys(o).length > 0; });

    for (var i = 0; i < satirlar.length; i += PARCA) {
      var yanit = UrlFetchApp.fetch(ADRES, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + anahtar },
        payload: JSON.stringify({ satirlar: satirlar.slice(i, i + PARCA) }),
        muteHttpExceptions: true,
      });
      var kod = yanit.getResponseCode();
      if (kod === 401) throw new Error('Anahtar reddedildi (401): Vercel\'deki META_SHEETS_KEY ile anahtarOlustur\'un yazdığı anahtar aynı mı?');
      if (kod === 503) throw new Error('Sunucu hazır değil (503): META_SHEETS_KEY Vercel\'e girildi mi, site yeniden yayına alındı mı?');
      if (kod !== 200) throw new Error('Aktarım başarısız (' + kod + '): ' + yanit.getContentText().slice(0, 300));
      var sonuc = JSON.parse(yanit.getContentText());
      toplam.gelen += sonuc.gelen;
      toplam.yazilan += sonuc.yazilan;
      toplam.zatenVardi += sonuc.zatenVardi;
      toplam.atlanan += sonuc.atlanan;
    }
  });

  console.log(
    'Gönderilen: ' + toplam.gelen + ' · yeni: ' + toplam.yazilan +
    ' · zaten vardı: ' + toplam.zatenVardi + ' · telefonsuz (atlandı): ' + toplam.atlanan
  );
}
