const SHEET_NAME = 'Atık Kontrol Sistemi';
const DISH_SHEET_NAME = 'Yemek Listesi';

function doGet(e) {
  const sheetName = (e && e.parameter && e.parameter.sheet) || SHEET_NAME;
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    // Yemek Listesi sayfası yoksa otomatik oluştur
    if (sheetName === DISH_SHEET_NAME) {
      sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(DISH_SHEET_NAME);
      sheet.appendRow(['id', 'ad', 'kalori', 'alerjen']);
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
    sheet.appendRow(['id', 'ad', 'kalori', 'alerjen']);
  }

  if (action === 'getDishes') {
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return jsonResponse({ dishes: [] });
    const dishes = [];
    for (let i = 1; i < data.length; i++) {
      dishes.push({ id: String(data[i][0] || ''), ad: String(data[i][1] || ''), kalori: String(data[i][2] || ''), alerjen: String(data[i][3] || '') });
    }
    return jsonResponse({ dishes });
  }

  if (action === 'saveDishes') {
    const dishes = body.dishes || [];
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
    }
    if (dishes.length > 0) {
      const rows = dishes.map(d => [String(d.id || ''), String(d.ad || ''), String(d.kalori || ''), String(d.alerjen || '')]);
      sheet.getRange(2, 1, rows.length, 4).setValues(rows);
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
