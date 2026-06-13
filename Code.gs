const SHEET_NAME = 'Atık Kontrol Sistemi';
const DISH_SHEET_NAME = 'Yemek Listesi';

function doGet(e) {
  const sheetName = (e && e.parameter && e.parameter.sheet) || SHEET_NAME;
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    // Yemek Listesi sayfası yoksa otomatik oluştur
    if (sheetName === DISH_SHEET_NAME) {
      sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(DISH_SHEET_NAME);
      sheet.appendRow(['id', 'ad', 'kalori', 'alerjen', 'ürün 1', 'miktar 1', 'birim 1', 'ürün 2', 'miktar 2', 'birim 2', 'ürün 3', 'miktar 3', 'birim 3', 'ürün 4', 'miktar 4', 'birim 4', 'ürün 5', 'miktar 5', 'birim 5', 'ürün 6', 'miktar 6', 'birim 6', 'ürün 7', 'miktar 7', 'birim 7', 'ürün 8', 'miktar 8', 'birim 8', 'ürün 9', 'miktar 9', 'birim 9', 'ürün 10', 'miktar 10', 'birim 10']);
    } else {
      return jsonResponse({ data: [], error: 'Sayfa bulunamadı: ' + sheetName });
    }
  }
  const data = sheet.getDataRange().getValues();
  if (data.length === 0) return jsonResponse({ data: [] });
  const headers = data[0].map(h => h.toString().trim());
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = {};
    headers.forEach((h, idx) => { row[h] = data[i][idx]; });
    rows.push(row);
  }
  return jsonResponse({ data: rows });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'getDishes' || action === 'saveDishes') {
      return handleDishAction(action, body);
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) {
      return jsonResponse({ error: 'Sayfa bulunamadı' });
    }
    ensureHeaders(sheet);
    const headers = ['id', 'tarih', 'yemek', 'fire', 'turnike', 'personel', 'toplam', 'porsiyon', 'atik', 'ogrenci', 'yemek_adi', 'lastModified'];

    if (action === 'saveAll') {
      const records = body.records || [];
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
      }
      if (records.length > 0) {
        const rows = records.map(r => [
          String(r.id || ''), String(r.tarih || ''), Number(r.yemek) || 0,
          Number(r.fire) || 0, Number(r.turnike) || 0, Number(r.personel) || 0,
          Number(r.toplam) || 0, Number(r.porsiyon) || 0, Number(r.atik) || 0,
          Number(r.ogrenci) || 0, String(r.yemek_adi || ''), new Date().toISOString()
        ]);
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      }
      return jsonResponse({ success: true, count: records.length, action: 'saveAll' });
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
    sheet.appendRow(['id', 'ad', 'kalori', 'alerjen', 'ürün 1', 'miktar 1', 'birim 1', 'ürün 2', 'miktar 2', 'birim 2', 'ürün 3', 'miktar 3', 'birim 3', 'ürün 4', 'miktar 4', 'birim 4', 'ürün 5', 'miktar 5', 'birim 5', 'ürün 6', 'miktar 6', 'birim 6', 'ürün 7', 'miktar 7', 'birim 7', 'ürün 8', 'miktar 8', 'birim 8', 'ürün 9', 'miktar 9', 'birim 9', 'ürün 10', 'miktar 10', 'birim 10']);
  }

  if (action === 'getDishes') {
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return jsonResponse({ dishes: [] });
    const headers = data[0].map(h => h.toString().trim().toLowerCase());
    const dishes = [];
    for (let i = 1; i < data.length; i++) {
      let tarif = [];
      // JSON tarif sütunu varsa
      const tarifIdx = headers.indexOf('tarif');
      if (tarifIdx >= 0) {
        try { tarif = JSON.parse(data[i][tarifIdx] || '[]'); } catch (e) {}
      }
      // Düz sütun formatı (ürün N, miktar N, birim N)
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
    // En fazla kaç malzeme var?
    let maxIng = 0;
    dishes.forEach(function(d) { if (d.tarif && d.tarif.length > maxIng) maxIng = d.tarif.length; });
    if (maxIng < 10) maxIng = 10;

    // Başlık satırı: sabit sütunlar + malzeme üçlüleri
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
