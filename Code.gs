const SHEET_NAME = 'Atık Kontrol Sistemi';
const DISH_SHEET_NAME = 'Yemek Listesi';
const HACCP_SHEET_NAME = 'Gıda Güvenliği';
const NUMUNE_SHEET_NAME = 'Numune Takibi';
const HIJYEN_SHEET_NAME = 'Hijyen Kontrol';
const DEPO_ADLARI_SHEET = 'Depo Adları';
const HACCP_DEPO_KEY = 'HACCP_DEPO_ADLARI';
const YAG_SHEET_NAME = 'Atık Yağ';
const AMBALAJ_SHEET_NAME = 'Ambalaj Atıkları';

var HACCP_HEADERS = ['id', 'type', 'tarih', 'saat', 'depoAd', 'sicaklik', 'not_', 'lastModified', 'nem'];
var DISH_HEADERS = ['id', 'ad', 'kalori', 'alerjen'];
var YAG_HEADERS = ['id', 'tarih', 'makbuzNo', 'tur', 'miktar', 'not', 'lastModified'];
var AMBALAJ_HEADERS = ['id', 'tarih', 'tur', 'miktar', 'not', 'lastModified'];
for (var di = 1; di <= 18; di++) { DISH_HEADERS.push('ürün ' + di, 'miktar ' + di, 'birim ' + di); }

function formatCellValue(val, header) {
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val)) {
    if (header === 'saat') {
      return Utilities.formatDate(val, Session.getScriptTimeZone(), 'HH:mm');
    }
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return val;
}

// === DEPO ADLARI: Sheet'te kalıcı (PropertiesService yedek) ===

function getDepoAdlari() {
  var list = [];
  // 1. Sheet'ten oku (başlık satırı yok, 0-indeks)
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(DEPO_ADLARI_SHEET);
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 0; i < data.length; i++) {
        var name = String(data[i][0] || '').trim();
        if (name) list.push(name);
      }
    }
  } catch (_) {}
  if (list.length > 0) return list;
  // 2. PropertiesService
  try {
    var str = PropertiesService.getDocumentProperties().getProperty(HACCP_DEPO_KEY);
    if (str) { var p = JSON.parse(str); if (Array.isArray(p) && p.length > 0) return p; }
  } catch (_) {}
  return ['Soğuk Hava Deposu 5', 'Soğuk Hava Deposu 6', 'Soğuk Hava Deposu 7', 'Soğuk Hava Deposu 8'];
}

function saveDepoAdlari(list) {
  if (!Array.isArray(list) || list.length === 0) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(DEPO_ADLARI_SHEET);
    if (!sheet) sheet = ss.insertSheet(DEPO_ADLARI_SHEET);
    sheet.clear();
    var rows = list.map(function(n) { return [n]; });
    sheet.getRange(1, 1, rows.length, 1).setValues(rows);
  } catch (_) {}
  try { PropertiesService.getDocumentProperties().setProperty(HACCP_DEPO_KEY, JSON.stringify(list)); } catch (_) {}
}

function depoNoToName(val) {
  if (!val) return '';
  var s = String(val).trim();
  var list = getDepoAdlari();
  // Tam eşleşme (isim zaten listede)
  if (list.indexOf(s) >= 0) return s;
  // Küçük/büyük harf duyarsız eşleşme
  for (var i = 0; i < list.length; i++) {
    if (list[i].toLowerCase() === s.toLowerCase()) return list[i];
  }
  // Sayısal değer ara: listede sonu bu sayıyla biten ismi bul
  var num = parseInt(s, 10);
  if (!isNaN(num)) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i].match(/(\d+)$/);
      if (m && parseInt(m[1], 10) === num) return list[i];
    }
    // Sıra indeksi dene (1-indexed)
    if (num >= 1 && num <= list.length) return list[num - 1];
  }
  return s;
}

// === DEPO HTML (QR'da telefon gösterimi) ===

function serveDepoHtml(depoAdi) {
  var jsonData = '[]';
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('G\u0131da G\u00fcvenli\u011fi');
    if (sheet) {
      var rows = sheet.getDataRange().getValues();
      if (rows.length > 1) {
        var h = rows[0];
        var depoAdIdx = -1, typeIdx = -1;
        for (var j = 0; j < h.length; j++) {
          var hh = String(h[j]).trim();
          if (hh === 'depoAd') depoAdIdx = j;
          if (hh === 'type') typeIdx = j;
        }
        var data = [];
        for (var i = 1; i < rows.length; i++) {
          var rowDepo = String(rows[i][depoAdIdx] || '').trim();
          var rowType = String(rows[i][typeIdx] || '').trim();
          if (rowType !== 'sicaklik' || rowDepo !== depoAdi) continue;
          var row = {};
          for (var j = 0; j < h.length; j++) {
            var v = rows[i][j];
            if (Object.prototype.toString.call(v) === '[object Date]') {
              if (String(h[j]).trim() === 'saat') {
                v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
              } else {
                v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
              }
            }
            row[String(h[j]).trim()] = v;
          }
          data.push(row);
        }
        jsonData = JSON.stringify(data);
      }
    }
  } catch (e) {
    jsonData = '[]';
  }
  var html = '<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/><title>' + depoAdi + '</title><style>';
  html += '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}';
  html += ':root{--bg:#f1f5f9;--card:#fff;--text:#1e293b;--text2:#475569;--text3:#94a3b8;--border:#e2e8f0;--accent:#6366f1;--green:#10b981;--red:#ef4444;--orange:#f59e0b;--radius:14px;--shadow:0 4px 16px rgba(0,0,0,0.06)}';
  html += '@media(prefers-color-scheme:dark){:root{--bg:#0a0f1e;--card:#131d35;--text:#e2e8f0;--text2:#94a3b8;--text3:#64748b;--border:rgba(255,255,255,0.08);--shadow:0 4px 20px rgba(0,0,0,0.4)}}';
  html += 'html{height:100%}body{font-family:-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100%}';
  html += '.container{max-width:600px;margin:0 auto;padding:1rem}';
  html += '.header{background:var(--card);border-bottom:1px solid var(--border);padding:1rem 1.25rem;position:sticky;top:0;z-index:10}';
  html += '.header h1{font-size:1.1rem;font-weight:700}.header .sub{font-size:0.75rem;color:var(--text3);display:block;margin-top:2px}';
  html += '.section-title{font-size:0.85rem;font-weight:700;color:var(--text2);margin:1.25rem 0 0.75rem;display:flex;align-items:center;gap:0.5rem}';
  html += '.reading-list{display:flex;flex-direction:column;gap:0.5rem;padding-bottom:1rem}';
  html += '.reading-item{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:0.85rem 1rem;display:flex;align-items:center;gap:0.5rem;box-shadow:var(--shadow)}';
  html += '.reading-item .reading-time:first-child{margin-right:0.25rem}.reading-item .reading-temp{margin-right:auto}';
  html += '.reading-time{font-size:0.75rem;color:var(--text3);min-width:50px;font-weight:600}';
  html += '.reading-temp{font-size:1.2rem;font-weight:800;min-width:70px}';
  html += '.reading-nem{font-size:0.85rem;color:var(--text2);min-width:45px;text-align:right}';
  html += '.reading-temp.ok{color:var(--green)}.reading-temp.warn{color:var(--orange)}.reading-temp.err{color:var(--red)}';
  html += '.reading-empty{text-align:center;padding:2rem;color:var(--text3);font-size:0.9rem;background:var(--card);border-radius:12px;border:1px dashed var(--border);margin-bottom:1rem}';
  html += '</style></head><body>';
  html += '<div class="header"><h1>' + depoAdi + '</h1><span class="sub" id="pageSub"></span></div>';
  html += '<div class="container" id="mainContainer"></div>';
  html += '<script>';
  html += 'var recs=' + jsonData + ';';
  html += 'recs.sort(function(a,b){return a.tarih>b.tarih?-1:1;});';
  html += 'var ts=new Date(),td=ts.getFullYear()+\'-\'+(ts.getMonth()+1+"").padStart(2,\'0\')+\'-\'+(ts.getDate()+"").padStart(2,\'0\');';
  html += 'var tdRecs=recs.filter(function(r){return r.tarih===td;}).sort(function(a,b){return (a.saat||"")>(b.saat||"")?1:-1;});';
  html += 'var h="";';
  html += 'h+=\'<div class="section-title">Bug\u00fcnk\u00fc Kay\u0131tlar<span style="margin-left:auto;font-size:0.7rem;font-weight:400;color:var(--text3)">S\u0131cakl\u0131k / Nem</span></div><div class="reading-list">\';';
  html += 'if(tdRecs.length===0){h+=\'<div class="reading-empty">Bug\u00fcn hen\u00fcz kay\u0131t girilmedi</div>\';}';
  html += 'else{tdRecs.forEach(function(r){var v=parseFloat(r.sicaklik),c="ok";if(v<0){c="warn"}else if(v>4){c="err"}';
  html += 'var nem=r.nem!=null?r.nem+"%":"—";';
  html += 'h+=\'<div class="reading-item"><span class="reading-time">\'+(r.saat||"--:--")+\'</span><span class="reading-temp \'+c+\'">\'+r.sicaklik+\'\u00b0C</span><span class="reading-nem">\'+nem+\'</span></div>\';});}';
  html += 'h+=\'</div>\';';
  html += 'h+=\'<div class="section-title">Son Kay\u0131tlar<span style="margin-left:auto;font-size:0.7rem;font-weight:400;color:var(--text3)">S\u0131cakl\u0131k / Nem</span></div><div class="reading-list">\';';
  html += 'if(recs.length===0){h+=\'<div class="reading-empty">Hen\u00fcz kay\u0131t yok</div>\';}';
  html += 'else{recs.slice(0,20).forEach(function(r){var d=r.tarih?r.tarih.slice(8,10)+\'.\'+r.tarih.slice(5,7)+\'.\'+r.tarih.slice(0,4):"--";';
  html += 'var v=parseFloat(r.sicaklik),c="ok";if(v<0){c="warn"}else if(v>4){c="err"}';
  html += 'var nem=r.nem!=null?r.nem+"%":"—";';
  html += 'h+=\'<div class="reading-item"><span class="reading-time">\'+d+\'</span><span class="reading-time">\'+(r.saat||"--:--")+\'</span><span class="reading-temp \'+c+\'">\'+r.sicaklik+\'\u00b0C</span><span class="reading-nem">\'+nem+\'</span></div>\';});}';
  html += 'h+=\'</div>\';';
  html += 'document.getElementById(\'mainContainer\').innerHTML=h;';
  html += 'document.getElementById(\'pageSub\').textContent=recs.length+\' kay\u0131t\';';
  html += '</script>';
  html += '</body></html>';
  return ContentService.createTextOutput(html).setMimeType(ContentService.MimeType.HTML);
}

// === DO GET ===

function getSheetOrCreate(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

function readSheetData(sheet) {
  var data = sheet.getDataRange().getValues();
  if (!data || data.length <= 1) return [];
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    headers.forEach(function(h, idx) { row[h] = formatCellValue(data[i][idx], h); });
    if (row.depoAd || row.depoNo) {
      row.depoAd = depoNoToName(row.depoAd || row.depoNo);
    }
    rows.push(row);
  }
  return rows;
}

function doGet(e) {
  const sheetName = (e && e.parameter && e.parameter.sheet) || SHEET_NAME;

  // 3 HACCP sayfasını birleştir
  if (sheetName === 'T%C3%BCm%20HACCP' || sheetName === 'Tüm HACCP') {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var allData = [];
    [HACCP_SHEET_NAME, NUMUNE_SHEET_NAME, HIJYEN_SHEET_NAME].forEach(function(name) {
      var s = ss.getSheetByName(name);
      if (s) allData = allData.concat(readSheetData(s));
    });
    return jsonResponse({ data: allData, depoAdlari: getDepoAdlari() });
  }

  if (sheetName === YAG_SHEET_NAME || sheetName === AMBALAJ_SHEET_NAME) {
    var s2 = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!s2) return jsonResponse({ data: [] });
    return jsonResponse({ data: readSheetData(s2) });
  }

  if (sheetName === NUMUNE_SHEET_NAME || sheetName === HIJYEN_SHEET_NAME) {
    var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!s) return jsonResponse({ data: [], depoAdlari: getDepoAdlari() });
    return jsonResponse({ data: readSheetData(s), depoAdlari: getDepoAdlari() });
  }

  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    if (sheetName === DISH_SHEET_NAME) {
      sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(DISH_SHEET_NAME);
      sheet.appendRow(DISH_HEADERS);
    } else if (sheetName === HACCP_SHEET_NAME || sheetName === NUMUNE_SHEET_NAME || sheetName === HIJYEN_SHEET_NAME) {
      sheet = getSheetOrCreate(sheetName, HACCP_HEADERS);
    } else {
      return jsonResponse({ data: [], error: 'Sayfa bulunamadı: ' + sheetName });
    }
  }
  if (sheetName === HACCP_SHEET_NAME || sheetName === NUMUNE_SHEET_NAME || sheetName === HIJYEN_SHEET_NAME) {
    sheet.getRange(1, 1, 1, HACCP_HEADERS.length).setValues([HACCP_HEADERS]);
  } else if (sheetName === SHEET_NAME) {
    var atikHeaders = ['id', 'tarih', 'yemek', 'fire', 'turnike', 'personel', 'toplam', 'porsiyon', 'atik', 'ogrenci', 'yemek_adi', 'lastModified'];
    sheet.getRange(1, 1, 1, atikHeaders.length).setValues([atikHeaders]);
  } else if (sheetName === DISH_SHEET_NAME) {
    sheet.getRange(1, 1, 1, DISH_HEADERS.length).setValues([DISH_HEADERS]);
  }
  var response = { data: readSheetData(sheet) };
  if (sheetName === HACCP_SHEET_NAME || sheetName === NUMUNE_SHEET_NAME || sheetName === HIJYEN_SHEET_NAME) {
    response.depoAdlari = getDepoAdlari();
  }
  return jsonResponse(response);
}

// === MENU SHEET ===

const MENU_SHEET_NAME = 'Menü Verisi';

// === DO POST ===

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'getDishes' || action === 'saveDishes') {
      return handleDishAction(action, body);
    }

    // HACCP işlemleri
    if (action === 'saveHaccp') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const haccpSheet = getSheetOrCreate(HACCP_SHEET_NAME, HACCP_HEADERS);

      const records = body.records || [];
      haccpSheet.getRange(1, 1, 1, HACCP_HEADERS.length).setValues([HACCP_HEADERS]);
      var lr = haccpSheet.getLastRow();
      if (lr > 1) haccpSheet.getRange(2, 1, lr - 1, HACCP_HEADERS.length).clearContent();

      if (records.length > 0) {
        var rows = records.map(function(r) {
          return [
            String(r.id || ''), String('sicaklik'), String(r.tarih || ''),
            r.saat || '', depoNoToName(r.depoAd || r.depoNo || ''),
            (r.sicaklik != null) ? Number(r.sicaklik) : '',
            r.not || '', new Date().toISOString(),
            (r.nem != null) ? Number(r.nem) : ''
          ];
        });
        haccpSheet.getRange(2, 1, rows.length, HACCP_HEADERS.length).setValues(rows);
      }

      if (body.depoAdlari && Array.isArray(body.depoAdlari)) {
        saveDepoAdlari(body.depoAdlari);
      }
      return jsonResponse({ success: true, count: records.length, action: 'saveHaccp' });
    }

    if (action === 'savePasswords') {
      const props = PropertiesService.getDocumentProperties();
      if (body.adminHash) props.setProperty('adminHash', body.adminHash);
      if (body.viewerHash) props.setProperty('viewerHash', body.viewerHash);
      return jsonResponse({ success: true });
    }

    if (action === 'getPasswords') {
      const props = PropertiesService.getDocumentProperties();
      return jsonResponse({
        adminHash: props.getProperty('adminHash') || '',
        viewerHash: props.getProperty('viewerHash') || ''
      });
    }

    if (action === 'saveYag') {
      return saveGenericSheet(YAG_SHEET_NAME, YAG_HEADERS, body.records || []);
    }
    if (action === 'getYag') {
      return getGenericSheet(YAG_SHEET_NAME, YAG_HEADERS);
    }
    if (action === 'saveAmbalaj') {
      return saveGenericSheet(AMBALAJ_SHEET_NAME, AMBALAJ_HEADERS, body.records || []);
    }
    if (action === 'getAmbalaj') {
      return getGenericSheet(AMBALAJ_SHEET_NAME, AMBALAJ_HEADERS);
    }

    if (action === 'getHaccp') {
      const ss2 = SpreadsheetApp.getActiveSpreadsheet();
      var allData = [];
      [HACCP_SHEET_NAME].forEach(function(name) {
        var s2 = ss2.getSheetByName(name);
        if (!s2) s2 = getSheetOrCreate(name, HACCP_HEADERS);
        allData = allData.concat(readSheetData(s2));
      });
      return jsonResponse({ data: allData, depoAdlari: getDepoAdlari() });
    }

    // Menü işlemleri
    if (action === 'saveMenu') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName(MENU_SHEET_NAME);
      if (!sheet) sheet = ss.insertSheet(MENU_SHEET_NAME);
      const data = body.menuData || '{}';
      sheet.clear();
      sheet.getRange(1, 1).setValue('menuJson');
      sheet.getRange(1, 2).setValue(data);
      return jsonResponse({ success: true });
    }
    if (action === 'loadMenu') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName(MENU_SHEET_NAME);
      if (!sheet) return jsonResponse({ menuData: '{}' });
      const val = sheet.getRange(1, 2).getValue();
      return jsonResponse({ menuData: val || '{}' });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) {
      return jsonResponse({ error: 'Sayfa bulunamadı' });
    }
    ensureHeaders(sheet);
    const headers = ['id', 'tarih', 'yemek', 'fire', 'turnike', 'personel', 'toplam', 'porsiyon', 'atik', 'ogrenci', 'yemek_adi', 'lastModified'];

    if (action === 'saveAll') {
      const records = body.records || [];
      // Mevcut sheet verilerini oku (elle girilen kayıtları korumak için)
      var existing = readSheetData(sheet);
      var idMap = {};
      existing.forEach(function(e, idx) { if (e.id) idMap[String(e.id)] = idx; });
      // Gelen kayıtları ekle/güncelle
      records.forEach(function(r) {
        var key = String(r.id || '');
        if (key && idMap[key] !== undefined) {
          existing[idMap[key]] = r; // güncelle
        } else {
          existing.push(r); // yeni ekle
        }
      });
      // Tarihe göre sırala (yeniler üstte)
      existing.sort(function(a, b) { return String(b.tarih || '').localeCompare(String(a.tarih || '')); });
      // Sheet'e yaz
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
      if (existing.length > 0) {
        var rows = existing.map(function(r) { return [
          String(r.id || r.id_ || ''), String(r.tarih || ''), Number(r.yemek) || 0,
          Number(r.fire) || 0, Number(r.turnike) || 0, Number(r.personel) || 0,
          Number(r.toplam) || 0, Number(r.porsiyon) || 0, Number(r.atik) || 0,
          Number(r.ogrenci) || 0, String(r.yemek_adi || ''), new Date().toISOString()
        ]; });
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      }
      return jsonResponse({ success: true, count: existing.length, action: 'saveAll' });
    }

    if (action === 'append') {
      const records = body.records || [];
      if (records.length > 0) {
        const rows = records.map(r => [
          String(r.id || ''), String(r.tarih || ''), Number(r.yemek) || 0,
          Number(r.fire) || 0, Number(r.turnike) || 0, Number(r.personel) || 0,
          Number(r.toplam) || 0, Number(r.porsiyon) || 0, Number(r.atik) || 0,
          Number(r.ogrenci) || 0, String(r.yemek_adi || ''), new Date().toISOString()
        ]);
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
      }
      return jsonResponse({ success: true, count: records.length, action: 'append' });
    }

    if (action === 'clear') {
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
      }
      return jsonResponse({ success: true, action: 'clear' });
    }

    return jsonResponse({ error: 'Bilinmeyen action: ' + action });
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

function handleDishAction(action, body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(DISH_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DISH_SHEET_NAME);
    sheet.appendRow(DISH_HEADERS);
  }

  if (action === 'getDishes') {
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return jsonResponse({ dishes: [] });
    const headers = data[0].map(h => h.toString().trim().toLowerCase());
    const dishes = [];
    for (let i = 1; i < data.length; i++) {
      let tarif = [];
      const tarifIdx = headers.indexOf('tarif');
      if (tarifIdx >= 0) {
        try { tarif = JSON.parse(data[i][tarifIdx] || '[]'); } catch (e) {}
      }
      if (!tarif.length) {
        for (let n = 1; n <= 20; n++) {
          const urunIdx = headers.indexOf('ürün ' + n);
          const miktarIdx = headers.indexOf('miktar ' + n);
          const birimIdx = headers.indexOf('birim ' + n);
          if (urunIdx >= 0 && data[i][urunIdx]) {
            const malzeme = String(data[i][urunIdx] || '').trim();
            const miktar = miktarIdx >= 0 ? parseFloat(data[i][miktarIdx]) || 0 : 0;
            const birim = birimIdx >= 0 ? String(data[i][birimIdx] || 'gr').trim() : 'gr';
            if (malzeme) tarif.push({ malzeme: malzeme, miktar_kisi: miktar, birim: birim });
          } else break;
        }
      }
      dishes.push({
        id: String(data[i][0] || ''),
        ad: String(data[i][1] || ''),
        kalori: String(data[i][2] || ''),
        alerjen: String(data[i][3] || ''),
        tarif: tarif
      });
    }
    return jsonResponse({ dishes });
  }

  if (action === 'saveDishes') {
    const dishes = body.dishes || [];
    let maxIng = 0;
    dishes.forEach(function(d) { if (d.tarif && d.tarif.length > maxIng) maxIng = d.tarif.length; });
    if (maxIng < 10) maxIng = 10;

    var headerRow = ['id', 'ad', 'kalori', 'alerjen'];
    for (var n = 1; n <= maxIng; n++) {
      headerRow.push('ürün ' + n, 'miktar ' + n, 'birim ' + n);
    }

    sheet.clear();
    sheet.appendRow(headerRow);

    if (dishes.length > 0) {
      var rows = dishes.map(function(d) {
        var row = [String(d.id || ''), String(d.ad || ''), String(d.kalori || ''), String(d.alerjen || '')];
        var tarif = d.tarif || [];
        for (var n = 0; n < maxIng; n++) {
          if (n < tarif.length) {
            row.push(tarif[n].malzeme || '', Number(tarif[n].miktar_kisi) || 0, tarif[n].birim || 'gr');
          } else {
            row.push('', 0, 'gr');
          }
        }
        return row;
      });
      sheet.getRange(2, 1, rows.length, headerRow.length).setValues(rows);
    }
    return jsonResponse({ success: true, count: dishes.length });
  }

  return jsonResponse({ error: 'Bilinmeyen dish action: ' + action });
}

function saveGenericSheet(sheetName, headers, records) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) { sheet = ss.insertSheet(sheetName); sheet.appendRow(headers); }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var lr = sheet.getLastRow();
  if (lr > 1) sheet.getRange(2, 1, lr - 1, headers.length).clearContent();
  if (records.length > 0) {
    var rows = records.map(function(r) {
      return headers.map(function(h) {
        if (h === 'lastModified') return new Date().toISOString();
        var v = r[h] !== undefined ? r[h] : '';
        if (h === 'miktar' && v !== '') return Number(v);
        return String(v);
      });
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  return jsonResponse({ success: true, count: records.length });
}

function getGenericSheet(sheetName, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) { sheet = ss.insertSheet(sheetName); sheet.appendRow(headers); }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return jsonResponse({ data: readSheetData(sheet) });
}

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id', 'tarih', 'yemek', 'fire', 'turnike', 'personel', 'toplam', 'porsiyon', 'atik', 'ogrenci', 'yemek_adi', 'lastModified']);
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
