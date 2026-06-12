const SHEET_NAME = 'Atık Kontrol Sistemi';

function doGet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    return jsonResponse({ data: [], error: 'Sayfa bulunamadı' });
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
