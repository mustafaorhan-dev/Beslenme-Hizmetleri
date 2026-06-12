/* =============================================
   ATIK KONTROL YÖNETİM SİSTEMİ - APP LOGIC
   ============================================= */

'use strict';

// ─── STATE ───────────────────────────────────────────────────────────────────
const DEFAULT_GSHEET_URL = 'https://script.google.com/macros/s/AKfycbzt9EBgIOC7LL_FMxaZa9F2wKSHHhCTws-fzLX89wA_1_xjoMW_OkI5-5xYTNDUstENow/exec';
let records = [];
let editingId = null;
let filteredRecords = [];
let gsheetConfig = { webappUrl: '', lastSync: null };

// ─── THEME ───────────────────────────────────────────────────────────────────
// Initial theme is handled by inline script in HTML (reads localStorage)
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? '' : 'dark';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('atik_kontrol_theme', newTheme || 'light');
}

// ─── PAGINATION ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;
let currentPage = 1;
let selectedIds = new Set();

// ─── UNSAVED CHANGES ──────────────────────────────────────────────────────────
let formModified = false;

// ─── CHART YEAR FILTER ──────────────────────────────────────────────────────
let chartYearFilter = 'all';
function getAvailableYears() {
  const years = new Set();
  records.forEach(r => {
    if (r.tarih) {
      const y = new Date(r.tarih + 'T00:00:00').getFullYear();
      if (!isNaN(y)) years.add(y);
    }
  });
  return [...years].sort();
}
function setChartYear(year) {
  chartYearFilter = year;
  document.querySelectorAll('.year-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.year === year);
  });
  drawAllCharts();
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  loadGSheetConfig();
  setCurrentDate();
  renderAll();
  drawAllCharts();
  updateSyncUI();
  if (gsheetConfig.webappUrl) {
    syncFromGSheets();
  }
});

// ─── DATE ──────────────────────────────────────────────────────────────────────
function normalizeDate(v) {
  if (!v) return '';
  // Zaten YYYY-MM-DD formatında mı?
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // Sayısal (Google Sheets serial date)?
  if (/^\d+(\.\d+)?$/.test(String(v))) {
    const d = new Date(1899, 11, 30 + Number(v));
    if (!isNaN(d)) return formatLocalDate(d);
  }
  // Diğer formatlar (ISO, "Sat Jan 15 2026", vb.)
  const d = new Date(v);
  if (!isNaN(d)) return formatLocalDate(d);
  return '';
}

function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function setCurrentDate() {
  const el = document.getElementById('currentDate');
  const now = new Date();
  el.textContent = now.toLocaleDateString('tr-TR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  // Set default date for form
  document.getElementById('fTarih').value = now.toISOString().split('T')[0];
}

// ─── STORAGE ───────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'atik_kontrol_records';

function loadData() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    records = stored ? JSON.parse(stored) : [];
  } catch (e) {
    records = [];
  }
  filteredRecords = [...records];
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    // Storage full or unavailable - ignore silently
  }
  syncToSheetSilent();
}

async function syncToSheetSilent() {
  if (!gsheetConfig.webappUrl || records.length === 0) return;
  try {
    await fetch(gsheetConfig.webappUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'saveAll', records })
    });
  } catch (_) {}
}

// ─── GSHEET CONFIG ─────────────────────────────────────────────────────────────
function loadGSheetConfig() {
  try {
    const stored = localStorage.getItem('atik_kontrol_gsheet_config');
    if (stored) {
      const parsed = JSON.parse(stored);
      gsheetConfig = {
        webappUrl: parsed.webappUrl || DEFAULT_GSHEET_URL,
        lastSync: parsed.lastSync || null
      };
    } else {
      gsheetConfig = { webappUrl: DEFAULT_GSHEET_URL, lastSync: null };
    }
  } catch (e) {
    gsheetConfig = { webappUrl: DEFAULT_GSHEET_URL, lastSync: null };
  }
}

function saveGSheetUrl() {
  const url = document.getElementById('gsheetUrl').value.trim();
  gsheetConfig.webappUrl = url || DEFAULT_GSHEET_URL;
  try {
    localStorage.setItem('atik_kontrol_gsheet_config', JSON.stringify(gsheetConfig));
  } catch (e) {}
  updateSyncUI();
  showToast('Web App URL kaydedildi.', 'success');
  if (url) testGSheetConnection();
}

function updateSyncUI() {
  const statusLabel = document.getElementById('syncStatusLabel');
  const statusSub = document.getElementById('syncStatusSub');
  const statusIcon = document.getElementById('syncStatusIcon');
  const lastLabel = document.getElementById('syncLastLabel');
  const urlInput = document.getElementById('gsheetUrl');

  if (urlInput) urlInput.value = gsheetConfig.webappUrl || '';

  if (gsheetConfig.lastSync) {
    const d = new Date(gsheetConfig.lastSync);
    lastLabel.textContent = 'Son senkronizasyon: ' + d.toLocaleString('tr-TR');
  } else {
    lastLabel.textContent = 'Son senkronizasyon: —';
  }

  if (gsheetConfig.webappUrl) {
    statusLabel.textContent = 'URL yapılandırıldı';
    statusSub.textContent = 'Senkronizasyon butonlarını kullanabilirsiniz';
    statusIcon.className = 'sync-status-icon sync-ok';
    statusIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  } else {
    statusLabel.textContent = 'Bağlantı kurulmadı';
    statusSub.textContent = 'Ayarlardan Web App URL\'sini girin';
    statusIcon.className = 'sync-status-icon';
    statusIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>';
  }
}

function openSyncPanel() {
  document.getElementById('syncOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  updateSyncUI();
}

function closeSyncPanel() {
  document.getElementById('syncOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function quickPullFromSheets() {
  if (!gsheetConfig.webappUrl) {
    showToast('Önce Web App URL\'sini ayarlayın (Senkronize Et → URL kaydet).', 'error');
    return;
  }
  syncFromGSheets();
}

async function syncToGSheets() {
  if (!gsheetConfig.webappUrl) {
    showToast('Önce Web App URL\'sini girin.', 'error');
    return;
  }
  if (records.length === 0) {
    showToast('Senkronize edilecek kayıt yok.', 'error');
    return;
  }
  const btn = document.getElementById('syncUploadBtn');
  btn.disabled = true;
  btn.textContent = 'Senkronize ediliyor...';
  try {
    const res = await fetch(gsheetConfig.webappUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'saveAll', records })
    });
    const data = await res.json();
    if (data.success) {
      gsheetConfig.lastSync = new Date().toISOString();
      try { localStorage.setItem('atik_kontrol_gsheet_config', JSON.stringify(gsheetConfig)); } catch (e) {}
      updateSyncUI();
      showToast('Veriler Google Sheet\'e yedeklendi (' + data.count + ' kayıt).', 'success');
    } else {
      showToast('Hata: ' + (data.error || 'Bilinmeyen hata'), 'error');
    }
  } catch (err) {
    showToast('Bağlantı hatası: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Yerel → Google Sheet (Yedekle)';
  }
}

async function syncFromGSheets() {
  if (!gsheetConfig.webappUrl) {
    showToast('Önce Web App URL\'sini girin.', 'error');
    return;
  }
  const btn = document.getElementById('syncDownloadBtn');
  btn.disabled = true;
  btn.textContent = 'İndiriliyor...';
  try {
    const res = await fetch(gsheetConfig.webappUrl + '?action=getAll');
    const data = await res.json();
    if (data.data) {
      const cloudRecords = data.data
        .filter(r => r.id)
        .map(r => ({
          id: Number(r.id) || Date.now(),
          tarih: normalizeDate(r.tarih),
          yemek: Number(r.yemek) || 0,
          fire: Number(r.fire) || 0,
          turnike: Number(r.turnike) || 0,
          personel: Number(r.personel) || 0,
          toplam: Number(r.toplam) || 0,
          porsiyon: Number(r.porsiyon) || 0,
          atik: Number(r.atik) || 0,
          ogrenci: Number(r.ogrenci) || 0,
          yemek_adi: r.yemek_adi || ''
        }));
      if (cloudRecords.length === 0) {
        showToast('Google Sheet\'te kayıt bulunamadı.', 'error');
        btn.disabled = false;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Google Sheet → Yerel (İndir)';
        return;
      }
      records = cloudRecords;
      records.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
      saveData();
      filteredRecords = [...records];
      renderAll();
      drawAllCharts();
      gsheetConfig.lastSync = new Date().toISOString();
      try { localStorage.setItem('atik_kontrol_gsheet_config', JSON.stringify(gsheetConfig)); } catch (e) {}
      updateSyncUI();
      showToast('Google Sheet\'ten ' + cloudRecords.length + ' kayıt indirildi.', 'success');
    } else {
      showToast('Hata: ' + (data.error || 'Veri alınamadı'), 'error');
    }
  } catch (err) {
    showToast('Bağlantı hatası: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Google Sheet → Yerel (İndir)';
  }
}

async function testGSheetConnection() {
  try {
    const res = await fetch(gsheetConfig.webappUrl + '?action=getAll', { method: 'GET', mode: 'cors' });
    if (res.ok) {
      document.getElementById('syncStatusLabel').textContent = 'Bağlantı başarılı';
      document.getElementById('syncStatusSub').textContent = 'Google Sheet\'e erişilebiliyor';
      document.getElementById('syncStatusIcon').className = 'sync-status-icon sync-ok';
    }
  } catch (e) {
    // Silent fail - user can test manually
  }
}

// ─── CARBON FOOTPRINT ────────────────────────────────────────────────────────
function calcCarbonFootprint(totalAtikKg) {
  return totalAtikKg * 2.5;
}
function calcDailyCarbon(atikKg) {
  return atikKg * 2.5;
}

// ─── PREDICTION ──────────────────────────────────────────────────────────────
function predictNextWaste() {
  if (records.length < 3) return null;
  const sorted = [...records].sort((a, b) => new Date(a.tarih) - new Date(b.tarih));
  const n = sorted.length;
  const indices = sorted.map((_, i) => i);
  const atikValues = sorted.map(r => r.atik);
  const meanX = (n - 1) / 2;
  const meanY = atikValues.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (atikValues[i] - meanY);
    den += (i - meanX) ** 2;
  }
  const slope = den !== 0 ? num / den : 0;
  const intercept = meanY - slope * meanX;
  return { next: slope * n + intercept, slope, intercept, n };
}
function getLast7AvgWaste() {
  const last7 = records.slice(0, Math.min(7, records.length));
  if (last7.length === 0) return 0;
  return last7.reduce((s, r) => s + r.atik, 0) / last7.length;
}

// ─── SPARKLINES ──────────────────────────────────────────────────────────────
function drawSparkline(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || data.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth || 120;
  const h = canvas.offsetHeight || 40;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const pad = 2;
  const cW = w - pad * 2;
  const cH = h - pad * 2;
  const maxVal = Math.max(...data, 1);
  const minVal = Math.min(...data, 0);
  const range = maxVal - minVal || 1;
  const xStep = cW / (data.length - 1);
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = pad + i * xStep;
    const y = pad + cH - ((v - minVal) / range) * cH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = color + '20';
  ctx.lineTo(pad + (data.length - 1) * xStep, pad + cH);
  ctx.lineTo(pad, pad + cH);
  ctx.closePath();
  ctx.fill();
}
function renderSparklines() {
  if (records.length < 2) return;
  const sorted = [...records].sort((a, b) => new Date(a.tarih) - new Date(b.tarih));
  const atikData = sorted.map(r => r.atik);
  const gecisData = sorted.map(r => r.toplam);
  drawSparkline('sparklineAtik', atikData, '#f97316');
  drawSparkline('sparklineGecis', gecisData, '#22c55e');
}

// ─── WASTE DETAIL ────────────────────────────────────────────────────────────
// ─── PDF EXPORT ──────────────────────────────────────────────────────────────
function exportPDF() {
  if (records.length === 0) {
    showToast('Dışa aktarılacak kayıt yok.', 'error');
    return;
  }
  switchTab('report');
  renderReport();
  setTimeout(() => {
    const totalAtik = records.reduce((s,r) => s+r.atik, 0);
    const carbon = calcCarbonFootprint(totalAtik);
    const pred = predictNextWaste();
    const reportEl = document.getElementById('content-report');
    const printWin = window.open('', '_blank', 'width=1000,height=800');
    printWin.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8"><title>Atık Kontrol Raporu</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; color: #1e293b; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
        th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
        th { background: #f1f5f9; font-weight: 600; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        h2 { font-size: 14px; margin: 16px 0 6px; color: #475569; }
        .report-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(180px,1fr)); gap: 8px; margin: 10px 0; }
        .report-item { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; }
        .report-label { font-size: 10px; color: #64748b; text-transform: uppercase; }
        .report-value { font-size: 16px; font-weight: 700; margin-top: 2px; }
        .footer { margin-top: 20px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10px; }
      </style>
    </head><body>
      <h1>Atık Kontrol Raporu</h1>
      <p style="font-size:12px;color:#64748b">${new Date().toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'})}</p>
      <h2>Özet</h2>
      <div class="report-grid">
        <div class="report-item"><div class="report-label">Toplam Kayıt</div><div class="report-value">${records.length}</div></div>
        <div class="report-item"><div class="report-label">Toplam Atık</div><div class="report-value">${totalAtik.toFixed(1)} kg</div></div>
        <div class="report-item"><div class="report-label">Ort. Atık</div><div class="report-value">${(totalAtik/records.length).toFixed(1)} kg</div></div>
        <div class="report-item"><div class="report-label">CO₂ Ayak İzi</div><div class="report-value">${carbon.toFixed(1)} kg</div></div>
        ${pred ? `<div class="report-item"><div class="report-label">Tahmin (sonraki)</div><div class="report-value">${Math.max(0, pred.next).toFixed(1)} kg</div></div>` : ''}
      </div>
      <h2>Hedef Uyumu</h2>
      <div style="margin:6px 0">${document.getElementById('complianceContainer') ? document.getElementById('complianceContainer').innerHTML : ''}</div>
      <h2>Kayıtlar (son 20)</h2>
      ${document.getElementById('reportTbody') ? (() => {
        const rows = [...document.getElementById('reportTbody').querySelectorAll('tr')].slice(0,20);
        const headers = [...document.querySelectorAll('#reportTable thead th')].map(th => th.textContent);
        if (rows.length === 0) return '<p>Kayıt yok</p>';
        let html = '<table><thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>';
        rows.forEach(tr => { html += '<tr>' + [...tr.querySelectorAll('td')].map(td => '<td>' + td.innerHTML + '</td>').join('') + '</tr>'; });
        return html + '</tbody></table>';
      })() : '<p>Kayıt tablosu bulunamadı</p>'}
      <div class="footer">Atık Kontrol Yönetim Sistemi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
    </body></html>`);
    printWin.document.close();
    setTimeout(() => { printWin.focus(); printWin.print(); }, 500);
  }, 400);
}

// ─── TABS ──────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('content-' + name).classList.add('active');
  if (name === 'charts') drawAllCharts();
  if (name === 'report') renderReport();
  // Menü seçilince sidebar'ı kapat
  closeSidebar();
  // Sayfa başlığını güncelle
  if (name === 'menu') renderMenu();
  const labels = { dashboard: 'Panel', records: 'Kayıtlar', charts: 'Grafikler', report: 'Rapor', menu: 'Menü' };
  document.getElementById('pageTitle').textContent = labels[name] || name;
}

// ─── SIDEBAR TOGGLE ──────────────────────────────────────────────────────────
function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
  document.body.classList.toggle('sidebar-open');
  if (window.innerWidth < 600) {
    document.getElementById('sidebarOverlay').classList.toggle('show');
  }
}
function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  document.body.classList.remove('sidebar-open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}
// Ana içeriğe tıklayınca sidebar'ı kapat
document.querySelector('.main-content').addEventListener('click', function(e) {
  if (document.querySelector('.sidebar').classList.contains('open')) closeSidebar();
});

// ─── MODAL ─────────────────────────────────────────────────────────────────────
function openModal(id = null) {
  editingId = id;
  formModified = false;
  const overlay = document.getElementById('modalOverlay');
  const title = document.getElementById('modalTitle');
  const submitBtn = document.getElementById('formSubmitBtn');

  document.getElementById('entryForm').reset();

  if (id !== null) {
    const rec = records.find(r => r.id === id);
    if (!rec) return;
    title.textContent = 'Kaydı Düzenle';
    submitBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Güncelle`;
    populateForm(rec);
  } else {
    title.textContent = 'Yeni Kayıt Ekle';
    submitBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Kaydet`;
    const now = new Date();
    document.getElementById('fTarih').value = now.toISOString().split('T')[0];
  }

  // Form değişiklik izleme
  document.querySelectorAll('#entryForm input').forEach(el => {
    el.addEventListener('input', () => { formModified = true; }, { once: true });
  });

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  if (formModified && !confirm('Kaydedilmemiş değişiklikler var. Yine de kapatmak istiyor musunuz?')) return;
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
  editingId = null;
  formModified = false;
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

function populateForm(rec) {
  document.getElementById('fTarih').value = rec.tarih;
  document.getElementById('fYemekAdi').value = rec.yemek_adi || '';
  document.getElementById('fYemek').value = rec.yemek;
  document.getElementById('fFire').value = rec.fire;
  document.getElementById('fTurnike').value = rec.turnike;
  document.getElementById('fPersonel').value = rec.personel;
  document.getElementById('fToplam').value = rec.toplam;
  document.getElementById('fPorsiyon').value = rec.porsiyon;
  document.getElementById('fOgrenci').value = rec.ogrenci;
  // Atik alanını formul ile yeniden hesapla - eski manuel değer yerine
  autoCalcAtik();
}

// ─── AUTO CALC ─────────────────────────────────────────────────────────────────
function autoCalc() {
  const yemek = parseFloat(document.getElementById('fYemek').value) || 0;
  document.getElementById('fFire').value = (yemek * 0.1).toFixed(2);
  autoCalcGecis();
}

function autoCalcGecis() {
  const turnike = parseInt(document.getElementById('fTurnike').value) || 0;
  const personel = parseInt(document.getElementById('fPersonel').value) || 0;
  // Toplam Geçiş = Turnike + Personel (iç personel dahil, öğrenci ayrı kolon)
  document.getElementById('fToplam').value = turnike + personel;
  autoCalcAtik();
}

function autoCalcAtik() {
  const yemek   = parseFloat(document.getElementById('fYemek').value)  || 0;
  const fire    = parseFloat(document.getElementById('fFire').value)   || 0;
  const toplam  = parseInt(document.getElementById('fToplam').value)   || 0;
  const porsiyon = parseInt(document.getElementById('fPorsiyon').value) || 0;
  // Formül: ((retilen Yemek - %10 Fire) - Toplam Geçiş) x Porsiyon / 1000
  // Örnek: ((550 - 55) - 443) x 400 / 1000 = 20,80 kg
  const atik = ((yemek - fire) - toplam) * porsiyon / 1000;
  document.getElementById('fAtik').value = atik.toFixed(2);
}

// ─── SAVE / UPDATE RECORD ──────────────────────────────────────────────────────
function saveRecord(e) {
  e.preventDefault();

  // Form doğrulama
  const fYemek = document.getElementById('fYemek');
  const fTurnike = document.getElementById('fTurnike');
  const fPersonel = document.getElementById('fPersonel');
  const fPorsiyon = document.getElementById('fPorsiyon');
  const fOgrenci = document.getElementById('fOgrenci');
  const errors = [];
  if (parseFloat(fYemek.value) < 0) errors.push('Üretilen yemek sayısı negatif olamaz.');
  if (parseInt(fTurnike.value) < 0) errors.push('Turnike geçiş sayısı negatif olamaz.');
  if (parseInt(fPersonel.value) < 0) errors.push('Personel sayısı negatif olamaz.');
  if (parseInt(fPorsiyon.value) < 0) errors.push('Porsiyon miktarı negatif olamaz.');
  if (parseInt(fOgrenci.value) < 0) errors.push('Öğrenci sayısı negatif olamaz.');
  if (errors.length > 0) {
    showToast(errors.join(' '), 'error');
    return;
  }

  const yemek  = parseFloat(document.getElementById('fYemek').value)   || 0;
  const fire   = parseFloat(document.getElementById('fFire').value)    || 0;  // autoCalc tarafından hesaplanan değer
  const turnike = parseInt(document.getElementById('fTurnike').value)   || 0;
  const personel = parseInt(document.getElementById('fPersonel').value) || 0;
  const ogrenci  = parseInt(document.getElementById('fOgrenci').value)  || 0;
  const toplam  = parseInt(document.getElementById('fToplam').value)    || 0;  // autoCalcGecis tarafından hesaplanan değer
  const porsiyon = parseInt(document.getElementById('fPorsiyon').value) || 0;
  // Formül: ((retilen Yemek - %10 Fire) - Toplam Geçiş) x Porsiyon / 1000
  const atik = ((yemek - fire) - toplam) * porsiyon / 1000;

  const rec = {
    tarih: document.getElementById('fTarih').value,
    yemek_adi: document.getElementById('fYemekAdi').value || '',
    yemek,
    fire,
    turnike,
    personel,
    toplam,
    porsiyon,
    atik,
    ogrenci,
    id: editingId !== null ? editingId : Date.now()
  };

  if (editingId !== null) {
    const idx = records.findIndex(r => r.id === editingId);
    if (idx !== -1) records[idx] = rec;
    showToast('Kayıt başarıyla güncellendi.', 'success');
  } else {
    records.push(rec);
    showToast('Yeni kayıt başarıyla eklendi.', 'success');
  }

  // Sort by date desc
  records.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  saveData();
  filteredRecords = [...records];
  renderAll();
  drawAllCharts();
  closeModal();
}

// ─── DELETE ────────────────────────────────────────────────────────────────────
function deleteRecord(id) {
  if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
  records = records.filter(r => r.id !== id);
  selectedIds.delete(id);
  saveData();
  filteredRecords = [...records];
  renderAll();
  drawAllCharts();
  showToast('Kayıt silindi.', 'success');
}

// ─── FILTER ────────────────────────────────────────────────────────────────────
function filterRecords() {
  const query = document.getElementById('searchInput').value.toLowerCase().trim();
  const start = document.getElementById('filterStart').value;
  const end = document.getElementById('filterEnd').value;

  filteredRecords = records.filter(r => {
    const tarihStr = r.tarih ? (() => {
      const d = new Date(r.tarih + 'T00:00:00');
      if (isNaN(d)) return r.tarih;
      const gun = String(d.getDate()).padStart(2, '0');
      const ay = String(d.getMonth() + 1).padStart(2, '0');
      const yil = d.getFullYear();
      return [gun + '.' + ay + '.' + yil, gun + '.' + ay, gun, ay + '.' + yil, yil].join(' ');
    })() : '';
    const matchQuery = !query ||
      r.tarih.includes(query) ||
      tarihStr.includes(query) ||
      String(r.yemek).includes(query) ||
      String(r.atik).includes(query) ||
      String(r.ogrenci).includes(query) ||
      (r.yemek_adi || '').toLowerCase().includes(query);
    const matchStart = !start || r.tarih >= start;
    const matchEnd = !end || r.tarih <= end;
    return matchQuery && matchStart && matchEnd;
  });

  filteredRecords = sortRecords(filteredRecords);
  currentPage = 1;
  renderRecordsTable();
}

function clearFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('filterStart').value = '';
  document.getElementById('filterEnd').value = '';
  filteredRecords = [...records];
  currentPage = 1;
  sortField = 'tarih'; sortDir = -1;
  renderRecordsTable();
}

// ─── SORT ──────────────────────────────────────────────────────────────────────
let sortField = 'tarih';
let sortDir = -1; // -1 = desc, 1 = asc
function toggleSort(field) {
  if (sortField === field) sortDir *= -1;
  else { sortField = field; sortDir = -1; }
  renderRecordsTable();
}
function sortRecords(arr) {
  const sorted = [...arr].sort((a, b) => {
    let va = a[sortField], vb = b[sortField];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return -sortDir;
    if (va > vb) return sortDir;
    return 0;
  });
  return sorted;
}
function renderSortIndicators() {
  document.querySelectorAll('#recordsTable th[data-field]').forEach(th => {
    const f = th.dataset.field;
    th.innerHTML = th.innerHTML.replace(/ ?[▲▼]?$/, '') + (f === sortField ? (sortDir === -1 ? ' ▼' : ' ▲') : '');
  });
}

// ─── PAGINATION ────────────────────────────────────────────────────────────────
function getPaginatedRecords() {
  const start = (currentPage - 1) * PAGE_SIZE;
  return filteredRecords.slice(start, start + PAGE_SIZE);
}

function totalPages() {
  return Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
}

function goToPage(p) {
  if (p < 1 || p > totalPages()) return;
  currentPage = p;
  renderRecordsTable();
}

function renderPagination() {
  const container = document.getElementById('pagination');
  if (!container) return;
  const tp = totalPages();
  if (tp <= 1) {
    container.innerHTML = '';
    return;
  }
  let html = '';
  html += `<button class="btn btn-ghost btn-sm" onclick="goToPage(1)" ${currentPage === 1 ? 'disabled' : ''}>&#171;</button>`;
  html += `<button class="btn btn-ghost btn-sm" onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>&#8249;</button>`;
  html += `<span class="page-info">${currentPage} / ${tp}</span>`;
  html += `<button class="btn btn-ghost btn-sm" onclick="goToPage(${currentPage + 1})" ${currentPage === tp ? 'disabled' : ''}>&#8250;</button>`;
  html += `<button class="btn btn-ghost btn-sm" onclick="goToPage(${tp})" ${currentPage === tp ? 'disabled' : ''}>&#187;</button>`;
  html += `<span class="page-total">${filteredRecords.length} kayıt</span>`;
  container.innerHTML = html;
}

// ─── BULK DELETE ───────────────────────────────────────────────────────────────
function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  renderRecordsTable();
}

function toggleSelectAll() {
  const page = getPaginatedRecords();
  const allSelected = page.every(r => selectedIds.has(r.id));
  if (allSelected) {
    page.forEach(r => selectedIds.delete(r.id));
  } else {
    page.forEach(r => selectedIds.add(r.id));
  }
  renderRecordsTable();
}

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  const count = document.getElementById('bulkCount');
  if (!bar || !count) return;
  if (selectedIds.size > 0) {
    bar.style.display = 'flex';
    count.textContent = selectedIds.size + ' seçili';
  } else {
    bar.style.display = 'none';
  }
}

function deleteSelected() {
  if (selectedIds.size === 0) {
    showToast('Seçili kayıt yok.', 'error');
    return;
  }
  if (!confirm(`Seçili ${selectedIds.size} kaydı silmek istediğinize emin misiniz?`)) return;
  records = records.filter(r => !selectedIds.has(r.id));
  selectedIds.clear();
  saveData();
  filteredRecords = [...records];
  currentPage = 1;
  renderAll();
  drawAllCharts();
  showToast('Seçili kayıtlar silindi.', 'success');
}

// ─── IMPORT ────────────────────────────────────────────────────────────────────
function triggerImport() {
  document.getElementById('importInput').click();
}

function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    const content = ev.target.result;
    try {
      let imported = [];
      if (file.name.endsWith('.json')) {
        imported = JSON.parse(content);
        if (!Array.isArray(imported)) imported = [imported];
      } else if (file.name.endsWith('.csv')) {
        const lines = content.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) throw new Error('CSV en az 2 satır olmalı (başlık + veri)');
        const headers = lines[0].split(';').map(h => h.replace(/^"|"$/g, '').trim());
        const fieldMap = {
          'Tarih': 'tarih', 'Üretilen Yemek Sayısı': 'yemek', '%10 Fire': 'fire',
          'Turnike Geçiş Sayısı': 'turnike', 'Yemekhanede Çalışan Personel Sayısı': 'personel',
          'Toplam Geçiş': 'toplam', 'Porsiyon Miktarı (gr)': 'porsiyon',
          'Atık Miktarı (kg)': 'atik', 'Yemek Hiz. Yar. Öğr. Sayısı': 'ogrenci',
          'Yemek Türü': 'yemek_adi',
          'tarih': 'tarih', 'yemek': 'yemek', 'fire': 'fire', 'turnike': 'turnike',
          'personel': 'personel', 'toplam': 'toplam', 'porsiyon': 'porsiyon',
          'atik': 'atik', 'ogrenci': 'ogrenci', 'yemek_adi': 'yemek_adi'
        };
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(';').map(v => v.replace(/^"|"$/g, '').trim());
          const row = {};
          headers.forEach((h, idx) => {
            const field = fieldMap[h] || h;
            row[field] = vals[idx] || '';
          });
          if (row.tarih) {
            row.id = Date.now() + i;
            row.yemek = Number(row.yemek) || 0;
            row.fire = Number(row.fire) || 0;
            row.turnike = Number(row.turnike) || 0;
            row.personel = Number(row.personel) || 0;
            row.toplam = Number(row.toplam) || 0;
            row.porsiyon = Number(row.porsiyon) || 0;
            row.atik = Number(row.atik) || 0;
            row.ogrenci = Number(row.ogrenci) || 0;
            imported.push(row);
          }
        }
      } else {
        throw new Error('Desteklenen dosya türleri: .csv, .json');
      }
      if (imported.length === 0) {
        showToast('İçe aktarılacak kayıt bulunamadı.', 'error');
        return;
      }
      // Mevcut kayıtlara ekle (çakışma kontrolü yapmadan)
      const existingIds = new Set(records.map(r => r.id));
      const newRecords = imported.filter(r => r.id && !existingIds.has(r.id));
      if (newRecords.length === 0 && imported.length > 0) {
        // ID çakışması varsa yeni ID ata
        imported.forEach(r => { r.id = Date.now() + Math.floor(Math.random() * 10000); });
        newRecords.push(...imported);
      }
      records.push(...newRecords);
      records.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
      saveData();
      filteredRecords = [...records];
      renderAll();
      drawAllCharts();
      showToast(`${newRecords.length} kayıt içe aktarıldı.`, 'success');
    } catch (err) {
      showToast('İçe aktarma hatası: ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

// ─── DATA MANAGEMENT ──────────────────────────────────────────────────────────
function clearAllData() {
  if (records.length === 0) {
    showToast('Silinecek kayıt yok.', 'error');
    return;
  }
  if (!confirm('TÜM kayıtları silmek istediğinize emin misiniz?\nBu işlem geri alınamaz!')) return;
  if (!confirm('Son bir kez daha: Tüm veriler silinsin mi?')) return;
  records = [];
  filteredRecords = [];
  selectedIds.clear();
  currentPage = 1;
  saveData();
  renderAll();
  drawAllCharts();
  showToast('Tüm kayıtlar silindi.', 'success');
}

function exportDataJSON() {
  if (records.length === 0) {
    showToast('Dışa aktarılacak kayıt yok.', 'error');
    return;
  }
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `atik_kontrol_${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('JSON dosyası indirildi.', 'success');
}

function exportDataSettings() {
  const settings = {
    version: 2,
    exportedAt: new Date().toISOString(),
    records: records.map(r => ({ ...r, yemek_adi: r.yemek_adi || '' })),
    gsheetConfig: gsheetConfig
  };
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `atik_kontrol_yedek_${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Tüm veriler (ayarlar dahil) dışa aktarıldı.', 'success');
}

function importFullBackup() {
  document.getElementById('importBackupInput').click();
}

function handleFullBackupImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.records) {
        showToast('Geçersiz yedek dosyası.', 'error');
        return;
      }
      if (!confirm(`${data.records.length} kayıt içe aktarılsın mı? Mevcut kayıtlar korunacak.`)) return;
      const existingIds = new Set(records.map(r => r.id));
      const newRecords = data.records.filter(r => r.id && !existingIds.has(r.id));
      records.push(...newRecords);
      records.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
      if (data.gsheetConfig && data.gsheetConfig.webappUrl && !gsheetConfig.webappUrl) {
        gsheetConfig.webappUrl = data.gsheetConfig.webappUrl;
      }
      saveData();
      filteredRecords = [...records];
      renderAll();
      drawAllCharts();
      updateSyncUI();
      showToast(`${newRecords.length} kayıt içe aktarıldı.`, 'success');
    } catch (err) {
      showToast('Yedek yükleme hatası: ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

// ─── RENDER ────────────────────────────────────────────────────────────────────
function renderAll() {
  renderKPIs();
  renderDataInfo();
  renderLastRecordsTable();
  renderRecordsTable();
  renderReport();
  renderSparklines();
  renderComparison();
}

function renderDataInfo() {
  const el = document.getElementById('dataInfo');
  const rangeEl = document.getElementById('dataInfoRange');
  if (!el || !rangeEl) return;
  if (records.length === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'flex';
  const dates = records.map(r => r.tarih).filter(Boolean).sort();
  const first = dates[dates.length - 1];
  const last = dates[0];
  const fmt = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('tr-TR') : '—';
  const totalYemek = records.reduce((s, r) => s + r.yemek, 0);
  const totalAtik = records.reduce((s, r) => s + r.atik, 0);
  rangeEl.textContent = `${records.length} kayıt • ${fmt(first)} — ${fmt(last)} • ${totalYemek.toLocaleString('tr-TR')} üretim • ${totalAtik.toFixed(1)} kg atık`;
}

function getTrend(current, arr, field) {
  if (arr.length < 2) return null;
  const mid = Math.floor(arr.length / 2);
  const recent = arr.slice(0, mid);
  const earlier = arr.slice(mid);
  if (recent.length === 0 || earlier.length === 0) return null;
  const avgRecent = recent.reduce((s, r) => s + r[field], 0) / recent.length;
  const avgEarlier = earlier.reduce((s, r) => s + r[field], 0) / earlier.length;
  if (avgEarlier === 0) return null;
  return ((avgRecent - avgEarlier) / avgEarlier) * 100;
}
function renderTrend(elId, pct, reverse) {
  const el = document.getElementById(elId);
  if (!el || pct === null) { if (el) el.textContent = ''; return; }
  const up = reverse ? pct < 0 : pct > 0;
  const cls = up ? '#ef4444' : '#10b981';
  el.innerHTML = `<span style="color:${cls};font-size:0.75rem;font-weight:600">${up ? '▲' : '▼'} %${Math.abs(pct).toFixed(1)}</span>`;
}
function renderKPIs() {
  const n = records.length;
  document.getElementById('kpiTotalRecords').textContent = n;

  if (n === 0) {
    document.getElementById('kpiAvgAtik').textContent = '0';
    document.getElementById('kpiLastGecis').textContent = '0';
    document.getElementById('kpiTotalAtik').textContent = '0';
    renderTrend('trendAvgAtik', null);
    renderTrend('trendTotalAtik', null);
    return;
  }

  const totalAtik = records.reduce((s, r) => s + r.atik, 0);
  const avgAtik = totalAtik / n;
  document.getElementById('kpiAvgAtik').textContent = avgAtik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  document.getElementById('kpiLastGecis').textContent = records[0].toplam.toLocaleString('tr-TR');
  document.getElementById('kpiTotalAtik').textContent = totalAtik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  renderTrend('trendAvgAtik', getTrend(avgAtik, records, 'atik'), true);
  renderTrend('trendTotalAtik', getTrend(totalAtik, records, 'atik'), true);
}

function renderComparison() {
  const card = document.getElementById('comparisonCard');
  const grid = document.getElementById('comparisonGrid');
  const badge = document.getElementById('comparisonBadge');
  if (records.length < 4) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  const mid = Math.floor(records.length / 2);
  const first = records.slice(mid);
  const second = records.slice(0, mid);
  const sum = (arr, f) => arr.reduce((s, r) => s + r[f], 0);
  const avg = (arr, f) => arr.length ? sum(arr, f) / arr.length : 0;
  const items = [
    { label: 'Ort. Atık (kg)', f1: avg(first, 'atik'), f2: avg(second, 'atik'), unit: ' kg', lower: true },
    { label: 'Ort. Üretim', f1: avg(first, 'yemek'), f2: avg(second, 'yemek'), unit: '', lower: false },
    { label: 'Ort. Geçiş', f1: avg(first, 'toplam'), f2: avg(second, 'toplam'), unit: '', lower: false },
  ];
  badge.textContent = `${first.length} kayıt → ${second.length} kayıt`;
  grid.innerHTML = items.map(it => {
    const diff = it.f2 - it.f1;
    const pct = it.f1 ? (diff / it.f1) * 100 : 0;
    const good = it.lower ? diff < 0 : diff > 0;
    return `<div class="comparison-item">
      <span class="comparison-label">${it.label}</span>
      <span class="comparison-old">${it.f1.toFixed(1)}${it.unit}</span>
      <span class="comparison-arrow">→</span>
      <span class="comparison-new">${it.f2.toFixed(1)}${it.unit}</span>
      <span class="comparison-diff" style="color:${good ? '#10b981' : '#ef4444'};font-weight:600">${diff >= 0 ? '+' : ''}${diff.toFixed(2)}${it.unit}</span>
    </div>`;
  }).join('');
}

function renderLastRecordsTable() {
  const last5 = records.slice(0, 5);
  const tbody = document.getElementById('lastRecordsTbody');
  const table = document.getElementById('lastRecordsTable');
  const empty = document.getElementById('emptyStateDashboard');
  const badge = document.getElementById('lastRecordsBadge');

  badge.textContent = records.length + ' kayıt';

  if (last5.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  table.style.display = 'table';
  tbody.innerHTML = last5.map(r => buildRow(r, false)).join('');
}

function renderRecordsTable() {
  const tbody = document.getElementById('recordsTbody');
  const table = document.getElementById('recordsTable');
  const empty = document.getElementById('emptyStateRecords');

  if (filteredRecords.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    document.getElementById('emptyRecordsMsg').textContent = records.length === 0
      ? 'Gösterilecek kayıt bulunamadı.'
      : 'Arama kriterlerine uygun kayıt bulunamadı.';
    document.getElementById('emptyClearFilter').style.display = records.length > 0 ? 'inline-flex' : 'none';
    renderPagination();
    return;
  }

  empty.style.display = 'none';
  document.getElementById('emptyClearFilter').style.display = 'none';
  table.style.display = 'table';
  const page = getPaginatedRecords();
  tbody.innerHTML = page.map(r => buildRow(r, true)).join('');

  // Select-all checkbox durumu
  const selectAll = document.getElementById('selectAll');
  if (selectAll) {
    const allSelected = page.every(r => selectedIds.has(r.id));
    selectAll.checked = allSelected;
    selectAll.indeterminate = page.some(r => selectedIds.has(r.id)) && !allSelected;
  }

  renderSortIndicators();
  updateBulkBar();
  renderPagination();
}

function buildRow(r, showActions) {
  const dateStr = r.tarih ? new Date(r.tarih + 'T00:00:00').toLocaleDateString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  }) : '—';

  const checkbox = showActions ? `
    <td>
      <input type="checkbox" class="row-checkbox" ${selectedIds.has(r.id) ? 'checked' : ''}
        onchange="toggleSelect(${r.id})" />
    </td>` : '';

  const actions = showActions ? `
    <td>
      <div style="display:flex;gap:0.4rem">
        <button class="btn btn-icon" onclick="openModal(${r.id})" title="Düzenle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-danger" onclick="deleteRecord(${r.id})" title="Sil">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    </td>` : '';

  const mealBadge = r.yemek_adi ? `<span class="meal-badge">${r.yemek_adi}</span>` : '';

  return `<tr class="${selectedIds.has(r.id) ? 'row-selected' : ''}">
    ${checkbox}
    <td>${dateStr}</td>
    <td>${r.yemek.toLocaleString('tr-TR')}</td>
    <td>${r.fire.toLocaleString('tr-TR')}</td>
    <td>${r.turnike.toLocaleString('tr-TR')}</td>
    <td>${r.personel.toLocaleString('tr-TR')}</td>
    <td class="td-gecis">${r.toplam.toLocaleString('tr-TR')}</td>
    <td>${r.porsiyon.toLocaleString('tr-TR')}</td>
    <td class="td-atik">${r.atik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
    <td>${r.ogrenci.toLocaleString('tr-TR')}</td>
    <td>${mealBadge}</td>
    ${actions}
  </tr>`;
}

// ─── REPORT ────────────────────────────────────────────────────────────────────
function renderReport() {
  const n = records.length;

  if (n === 0) {
    ['rTotalKayit','rTotalYemek','rTotalFireKar','rTotalYemekSonrasi','rTotalTurnike',
     'rTotalGecis','rAvgPorsiyon','rMaxWeekGecis','rTotalAtik','rAvgAtik','rTotalOgrenci',
     'rMaxAtik','rMinAtik','rTrendAtik','rTrendGecis'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('reportTbody').innerHTML = '';
    return;
  }

  const totalYemek = records.reduce((s,r) => s+r.yemek, 0);
  const totalTurnike = records.reduce((s,r) => s+r.turnike, 0);
  const totalPersonel = records.reduce((s,r) => s+r.personel, 0);
  const totalGecis = records.reduce((s,r) => s+r.toplam, 0);
  const avgPorsiyon = records.reduce((s,r) => s+r.porsiyon, 0) / n;
  const totalAtik = records.reduce((s,r) => s+r.atik, 0);
  const totalOgrenci = records.reduce((s,r) => s+r.ogrenci, 0);
  const atikValues = records.map(r => r.atik);
  const maxAtik = Math.max(...atikValues);
  const minAtik = Math.min(...atikValues);
  const maxAtikRec = records.find(r => r.atik === maxAtik);
  const minAtikRec = records.find(r => r.atik === minAtik);
  const maxAtikDate = maxAtikRec ? new Date(maxAtikRec.tarih + 'T00:00:00').toLocaleDateString('tr-TR') : '';
  const minAtikDate = minAtikRec ? new Date(minAtikRec.tarih + 'T00:00:00').toLocaleDateString('tr-TR') : '';

  // Trend: son 7 gün vs önceki 7 gün
  const sortedByDate = [...records].sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  const last7 = sortedByDate.slice(0, 7);
  const prev7 = sortedByDate.slice(7, 14);
  const avgAtikLast7 = last7.length ? last7.reduce((s, r) => s + r.atik, 0) / last7.length : 0;
  const avgAtikPrev7 = prev7.length ? prev7.reduce((s, r) => s + r.atik, 0) / prev7.length : 0;
  const avgGecisLast7 = last7.length ? last7.reduce((s, r) => s + r.toplam, 0) / last7.length : 0;
  const avgGecisPrev7 = prev7.length ? prev7.reduce((s, r) => s + r.toplam, 0) / prev7.length : 0;
  const trendAtik = avgAtikPrev7 > 0 ? ((avgAtikLast7 - avgAtikPrev7) / avgAtikPrev7 * 100).toFixed(1) : 0;
  const trendGecis = avgGecisPrev7 > 0 ? ((avgGecisLast7 - avgGecisPrev7) / avgGecisPrev7 * 100).toFixed(1) : 0;

  // Haftalık Geçiş Hesaplama
  const weeklyGecis = {};
  records.forEach(r => {
    const d = new Date(r.tarih + 'T00:00:00');
    // Haftanın başını (Pazartesi) bul
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    const format = (date) => date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
    const weekLabel = `${format(monday)} - ${format(sunday)}`;
    weeklyGecis[weekLabel] = (weeklyGecis[weekLabel] || 0) + r.toplam;
  });

  let maxWeekLabel = '—';
  let maxWeekVal = 0;
  for (const [w, val] of Object.entries(weeklyGecis)) {
    if (val > maxWeekVal) {
      maxWeekVal = val;
      maxWeekLabel = w;
    }
  }

  document.getElementById('rTotalKayit').textContent = n;
  document.getElementById('rTotalYemek').textContent = totalYemek.toLocaleString('tr-TR');
  document.getElementById('rTotalFireKar').textContent = (totalYemek * 0.1).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  document.getElementById('rTotalYemekSonrasi').textContent = (totalYemek * 0.9).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  document.getElementById('rTotalTurnike').textContent = totalTurnike.toLocaleString('tr-TR');
  document.getElementById('rTotalGecis').textContent = totalGecis.toLocaleString('tr-TR');
  document.getElementById('rAvgPorsiyon').textContent = avgPorsiyon.toFixed(0) + ' gr';
  document.getElementById('rMaxWeekGecis').innerHTML = maxWeekLabel !== '—' ? `${maxWeekLabel} <br><span style="font-size:0.9rem;opacity:0.8;font-weight:normal">(${maxWeekVal.toLocaleString('tr-TR')} Geçiş)</span>` : '—';
  document.getElementById('rTotalAtik').textContent = totalAtik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' kg';
  document.getElementById('rAvgAtik').textContent = (totalAtik / n).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' kg';
  document.getElementById('rTotalOgrenci').textContent = totalOgrenci.toLocaleString('tr-TR');
  document.getElementById('rMaxAtik').innerHTML = `${maxAtik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg<br><span class="report-subdate">${maxAtikDate}</span>`;
  document.getElementById('rMinAtik').innerHTML = `${minAtik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg<br><span class="report-subdate">${minAtikDate}</span>`;

  // Trend
  const trendAtikEl = document.getElementById('rTrendAtik');
  const trendGecisEl = document.getElementById('rTrendGecis');
  if (trendAtikEl) {
    const sign = trendAtik > 0 ? '↑' : trendAtik < 0 ? '↓' : '→';
    const cls = trendAtik > 0 ? 'trend-up' : trendAtik < 0 ? 'trend-down' : 'trend-flat';
    trendAtikEl.innerHTML = `<span class="${cls}">${sign} %${Math.abs(trendAtik)}</span><span class="report-subdate">son 7 kayıt / önceki 7</span>`;
  }
  if (trendGecisEl) {
    const sign = trendGecis > 0 ? '↑' : trendGecis < 0 ? '↓' : '→';
    const cls = trendGecis > 0 ? 'trend-up' : trendGecis < 0 ? 'trend-down' : 'trend-flat';
    trendGecisEl.innerHTML = `<span class="${cls}">${sign} %${Math.abs(trendGecis)}</span><span class="report-subdate">son 7 kayıt / önceki 7</span>`;
  }

  const reportTbody = document.getElementById('reportTbody');
  reportTbody.innerHTML = records.map(r => buildRow(r, false)).join('');
}

// ─── CHART UTILITY ───────────────────────────────────────────────────────────
function fmt(v) {
  // Trailing zero'ları at, tam sayıysa .00 gösterme
  return v.toFixed(2).replace(/\.?0+$/, '');
}

// ─── CHARTS ────────────────────────────────────────────────────────────────────
// Pure canvas chart renderer (no external dependencies)

function renderChartYearFilter() {
  const container = document.getElementById('chartYearFilter');
  if (!container) return;
  const years = getAvailableYears();
  if (years.length === 0) { container.innerHTML = ''; return; }
  let html = '<button class="year-btn' + (chartYearFilter === 'all' ? ' active' : '') + '" data-year="all" onclick="setChartYear(\'all\')">Tümü</button>';
  years.forEach(y => {
    html += '<button class="year-btn' + (chartYearFilter === String(y) ? ' active' : '') + '" data-year="' + y + '" onclick="setChartYear(\'' + y + '\')">' + y + '</button>';
  });
  container.innerHTML = html;
}

function drawAllCharts() {
  renderChartYearFilter();

  // Yıl filtresi uygula
  let chartRecords = records;
  if (chartYearFilter !== 'all') {
    chartRecords = records.filter(r => {
      if (!r.tarih) return false;
      const y = new Date(r.tarih + 'T00:00:00').getFullYear();
      return y === Number(chartYearFilter);
    });
  }

  if (chartRecords.length === 0) {
    ['chartAtikEmpty','chartYemekEmpty','chartTurnikeEmpty','chartAylikEmpty','chartAtikOranEmpty','chartOgrenciEmpty'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'block';
    });
    ['canvasAtik','canvasYemek','canvasTurnike','canvasAylik','canvasAtikOran','canvasOgrenci'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    return;
  }

  // Show canvases, hide empties
  ['chartAtikEmpty','chartYemekEmpty','chartTurnikeEmpty','chartAylikEmpty','chartAtikOranEmpty','chartOgrenciEmpty'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  ['canvasAtik','canvasYemek','canvasTurnike','canvasAylik','canvasAtikOran','canvasOgrenci'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
  });

  const sorted = [...chartRecords].sort((a,b) => new Date(a.tarih) - new Date(b.tarih));

  // Aylık Gruplandırma (önce hesapla ki tüm grafikler kullanabilsin)
  const monthlyData = {};
  sorted.forEach(r => {
    const date = new Date(r.tarih + 'T00:00:00');
    const monthKey = (date.getMonth() + 1) + '/' + date.getFullYear();
    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = { yemek: 0, toplam: 0, atik: 0, turnike: 0, ogrenci: 0 };
    }
    monthlyData[monthKey].yemek += r.yemek;
    monthlyData[monthKey].toplam += r.toplam;
    monthlyData[monthKey].atik += r.atik;
    monthlyData[monthKey].turnike += r.turnike;
    monthlyData[monthKey].ogrenci += r.ogrenci;
  });

  const monthLabels = Object.keys(monthlyData);

  // Tüm ayları kapsayan etiketler (veri olmayan aylar dahil)
  const chartYears = chartYearFilter !== 'all'
    ? [Number(chartYearFilter)]
    : [...new Set(sorted.map(r => new Date(r.tarih + 'T00:00:00').getFullYear()))].sort();
  let allMonthLabels = [];
  chartYears.forEach(y => {
    for (let m = 1; m <= 12; m++) allMonthLabels.push(m + '/' + y);
  });
  // Varsayılan: veri varsa onu kullan, yoksa 0
  const getMonthVal = (label, field) => (monthlyData[label] ? monthlyData[label][field] : 0);

  // Aylık Atık (canvasAtik) — tüm 12 ay göster
  drawBarChart('canvasAtik', allMonthLabels, [
    { data: allMonthLabels.map(m => getMonthVal(m, 'atik')), color: '#f97316', label: 'Aylık Atık (kg)' }
  ]);

  drawBarChart('canvasYemek', allMonthLabels, [
    { data: allMonthLabels.map(m => getMonthVal(m, 'yemek')), color: '#1e40af', label: 'Aylık Üretim Sayısı' }
  ]);

  drawBarChart('canvasTurnike', allMonthLabels, [
    { data: allMonthLabels.map(m => getMonthVal(m, 'toplam')), color: '#22c55e', label: 'Aylık Turnike Geçişi' }
  ]);

  drawBarChart('canvasAylik', allMonthLabels, [
    { data: allMonthLabels.map(m => getMonthVal(m, 'yemek')), color: '#1e40af', label: 'Aylık Üretim' },
    { data: allMonthLabels.map(m => getMonthVal(m, 'toplam')), color: '#14b8a6', label: 'Aylık Geçiş' },
    { data: allMonthLabels.map(m => getMonthVal(m, 'atik')), color: '#f97316', label: 'Aylık Atık (kg)' }
  ]);

  // Aylık Atık Oranı % = (aylık atik / aylık yemek) * 100
  const aylikOran = allMonthLabels.map(m => {
    const yemek = getMonthVal(m, 'yemek');
    const atik = getMonthVal(m, 'atik');
    return yemek > 0 ? (atik / yemek * 100) : 0;
  });
  const totalYemekSum = sorted.reduce((s, r) => s + r.yemek, 0);
  const totalAtikSum = sorted.reduce((s, r) => s + r.atik, 0);
  const avgOran = totalYemekSum > 0 ? (totalAtikSum / totalYemekSum * 100) : 0;

  drawBarChart('canvasAtikOran', allMonthLabels, [
    { data: aylikOran, color: '#ef4444', label: 'Aylık Atık Oranı %' }
  ]);

  drawBarChart('canvasOgrenci', allMonthLabels, [
    { data: allMonthLabels.map(m => getMonthVal(m, 'ogrenci')), color: '#a855f7', label: 'Aylık Öğrenci Sayısı' }
  ]);

  // Chart tooltip'leri kur
  setupChartTooltip('canvasAtik', allMonthLabels, [
    { data: allMonthLabels.map(m => getMonthVal(m, 'atik')), color: '#f59e0b', label: 'Aylık Atık (kg)' }
  ]);
  setupChartTooltip('canvasYemek', allMonthLabels, [
    { data: allMonthLabels.map(m => getMonthVal(m, 'yemek')), color: '#6366f1', label: 'Aylık Üretim Sayısı' }
  ]);
  setupChartTooltip('canvasTurnike', allMonthLabels, [
    { data: allMonthLabels.map(m => getMonthVal(m, 'toplam')), color: '#10b981', label: 'Aylık Turnike Geçişi' }
  ]);
  setupChartTooltip('canvasAylik', allMonthLabels, [
    { data: allMonthLabels.map(m => getMonthVal(m, 'yemek')), color: '#6366f1', label: 'Aylık Üretim' },
    { data: allMonthLabels.map(m => getMonthVal(m, 'toplam')), color: '#22d3ee', label: 'Aylık Geçiş' },
    { data: allMonthLabels.map(m => getMonthVal(m, 'atik')), color: '#f59e0b', label: 'Aylık Atık (kg)' }
  ]);
  setupChartTooltip('canvasAtikOran', allMonthLabels, [
    { data: aylikOran, color: '#a855f7', label: 'Aylık Atık Oranı %' }
  ]);
  setupChartTooltip('canvasOgrenci', allMonthLabels, [
    { data: allMonthLabels.map(m => getMonthVal(m, 'ogrenci')), color: '#a855f7', label: 'Aylık Öğrenci Sayısı' }
  ]);
}

function getCanvasCtx(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const parent = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.min(parent.offsetWidth || 400, parent.clientWidth || 400);
  const h = Math.min(parent.offsetHeight || 280, parent.clientHeight || 280);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas._w = w;
  canvas._h = h;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}
function getGridColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim() || 'rgba(255,255,255,0.05)';
}
function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function darkenColor(hex, amount) {
  if (!hex || typeof hex !== 'string') return 'rgb(100,100,100)';
  let h = hex;
  if (!h.startsWith('#')) h = '#' + h;
  // Handle shorthand hex (#fff -> #ffffff)
  if (h.length === 4) {
    h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  const num = parseInt(h.slice(1), 16);
  if (isNaN(num)) return hex;
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `rgb(${r},${g},${b})`;
}
function hexToRgba(hex, a) {
  const num = parseInt(hex.slice(1), 16);
  const r = num >> 16, g = (num >> 8) & 0xff, b = num & 0xff;
  return `rgba(${r},${g},${b},${a})`;
}

// ─── CHART TOOLTIP ────────────────────────────────────────────────────────────
// Her canvas için tooltip metaverisini sakla
const chartMetaMap = new Map();

function setupChartTooltip(canvasId, labels, datasets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const tipId = canvasId + 'Tooltip';
  let tip = document.getElementById(tipId);
  if (!tip) {
    tip = document.createElement('div');
    tip.id = tipId;
    tip.className = 'chart-tooltip';
    canvas.parentElement.appendChild(tip);
  }
  chartMetaMap.set(canvasId, { labels, datasets, tip });

  // Mousemove'i ilk seferde bağla
  if (!canvas.dataset.tooltipInit) {
    canvas.dataset.tooltipInit = '1';
    canvas.addEventListener('mousemove', function(e) {
      const meta = chartMetaMap.get(this.id);
      if (!meta || !meta.labels.length) return;
      const rect = this.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const W = this._w;
      const H = this._h;
      const pad = { top: 28, right: 24, bottom: 48, left: 64 };
      const cW = W - pad.left - pad.right;
      const n = meta.labels.length;
      // Grafik alanı dışı (üst/alt boşluk)? Gizle
      if (my < pad.top || my > H - pad.bottom) { meta.tip.style.display = 'none'; return; }
      const groupW = cW / n;
      // Hangi group? En yakın grubu bul, yuvarla
      const rawIdx = (mx - pad.left) / groupW;
      const gi = Math.round(rawIdx);
      if (gi < 0 || gi >= n) { meta.tip.style.display = 'none'; return; }
      // Her group için geçerli bölge: group'ün %80'i (kenarlarda biraz boşluk)
      const groupCenter = pad.left + gi * groupW + groupW / 2;
      if (Math.abs(mx - groupCenter) > groupW * 0.5) { meta.tip.style.display = 'none'; return; }
      // Değerleri topla
      const label = meta.labels[gi];
      const lines = meta.datasets.map(d => {
        const val = d.data[gi];
        const text = val !== undefined ? fmt(val) : '—';
        return `<span style="color:${d.color}">●</span> ${d.label}: <strong>${text}</strong>`;
      });
      meta.tip.innerHTML = `<div class="tip-label">${label}</div>` + lines.join('<br>');
      // Tooltip konumu
      let tipX = e.clientX - rect.left + 12;
      let tipY = e.clientY - rect.top - 10;
      // Taşma kontrolü
      const tipW = meta.tip.offsetWidth || 120;
      if (tipX + tipW > W - 8) tipX = e.clientX - rect.left - tipW - 8;
      meta.tip.style.left = tipX + 'px';
      meta.tip.style.top = tipY + 'px';
      meta.tip.style.display = 'block';
    });
    canvas.addEventListener('mouseleave', function() {
      const meta = chartMetaMap.get(this.id);
      if (meta) meta.tip.style.display = 'none';
    });
  }
}

function drawLineChart(canvasId, labels, datasets) {
  const ctx = getCanvasCtx(canvasId);
  if (!ctx) return;
  const W = ctx.canvas._w;
  const H = ctx.canvas._h;
  const pad = { top: 24, right: 24, bottom: 48, left: 56 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  // Gather all values
  const allVals = datasets.flatMap(d => d.data);
  const minV = Math.min(...allVals, 0);
  const maxV = Math.max(...allVals, 1);
  const range = maxV - minV || 1;

  const xStep = labels.length > 1 ? cW / (labels.length - 1) : cW;

  function toX(i) { return pad.left + (labels.length > 1 ? i * xStep : cW / 2); }
  function toY(v) { return pad.top + cH - ((v - minV) / range) * cH; }

  // Grid
  const gridLines = 5;
  ctx.strokeStyle = getGridColor();
  ctx.lineWidth = 1;
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + (i / gridLines) * cH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();

    const val = maxV - (i / gridLines) * range;
    ctx.fillStyle = cssVar('--chart-text', 'rgba(148,163,184,0.6)');
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(val >= 100 ? 0 : 1), pad.left - 6, y + 4);
  }

  // Datasets
  datasets.forEach(ds => {
    if (ds.data.length === 0) return;

    // Gradient fill
    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    grad.addColorStop(0, ds.color + '30');
    grad.addColorStop(1, ds.color + '00');

    ctx.beginPath();
    ds.data.forEach((v, i) => {
      const x = toX(i), y = toY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(toX(ds.data.length - 1), H - pad.bottom);
    ctx.lineTo(toX(0), H - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ds.data.forEach((v, i) => {
      const x = toX(i), y = toY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = ds.color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Dots
    ds.data.forEach((v, i) => {
      const x = toX(i), y = toY(v);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = ds.color;
      ctx.fill();
      ctx.strokeStyle = '#0a0f1e';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  });

  // X labels
  ctx.fillStyle = cssVar('--chart-text', 'rgba(148,163,184,0.7)');
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(labels.length / 10));
  // Yıl ortalamak için grup bul
  const yearGroups = {};
  labels.forEach((l, i) => {
    const parts = l.split('/');
    if (parts.length === 2 && !isNaN(parts[0]) && parts[1].length === 4) {
      if (!yearGroups[parts[1]]) yearGroups[parts[1]] = [];
      yearGroups[parts[1]].push(i);
    }
  });
  labels.forEach((l, i) => {
    if (i % step === 0 || i === labels.length - 1) {
      const x = toX(i);
      const parts = l.split('/');
      if (parts.length === 2 && !isNaN(parts[0]) && parts[1].length === 4) {
        ctx.fillText(parts[0], x, H - pad.bottom + 12);
      } else {
        ctx.fillText(l, x, H - pad.bottom + 16);
      }
    }
  });
  // Yılları ortala
  ctx.font = '8px Inter, sans-serif';
  ctx.fillStyle = cssVar('--chart-text-dim', 'rgba(148,163,184,0.5)');
  ctx.textAlign = 'center';
  for (const [year, indices] of Object.entries(yearGroups)) {
    const firstX = toX(indices[0]);
    const lastX = toX(indices[indices.length - 1]);
    const cx = (firstX + lastX) / 2;
    ctx.fillText(year, cx, H - pad.bottom + 24);
  }
  ctx.font = '10px Inter, sans-serif';
  ctx.fillStyle = cssVar('--chart-text', 'rgba(148,163,184,0.7)');

  // Legend
  const legendX = pad.left;
  const legendY = 8;
  datasets.forEach((ds, i) => {
    const x = legendX + i * 130;
    ctx.fillStyle = ds.color;
    ctx.fillRect(x, legendY, 20, 3);
    ctx.fillStyle = cssVar('--chart-text', 'rgba(226,232,240,0.8)');
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(ds.label, x + 24, legendY + 6);
  });
}

function drawBarChart(canvasId, labels, datasets) {
  const ctx = getCanvasCtx(canvasId);
  if (!ctx) return;
  const W = ctx.canvas._w;
  const H = ctx.canvas._h;
  const pad = { top: 24, right: 24, bottom: 48, left: 56 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  const allVals = datasets.flatMap(d => d.data);
  const maxV = Math.max(...allVals, 1);
  const n = labels.length;
  const numDs = datasets.length;
  const groupW = cW / n;
  const barW = Math.max(4, (groupW * 0.85) / numDs);
  const barGap = barW * 0.12;

  function toY(v) { return pad.top + cH - (v / maxV) * cH; }

  // Grid
  const gridLines = 5;
  ctx.strokeStyle = getGridColor();
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + (i / gridLines) * cH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();

    const val = maxV - (i / gridLines) * maxV;
    ctx.fillStyle = cssVar('--chart-text-dim', 'rgba(148,163,184,0.5)');
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(val >= 100 ? Math.round(val) : val >= 10 ? val.toFixed(1) : val.toFixed(2), pad.left - 6, y + 4);
  }

  // Bars
  datasets.forEach((ds, di) => {
    ds.data.forEach((v, gi) => {
      const groupStart = pad.left + gi * groupW + (groupW - numDs * barW - (numDs - 1) * barGap) / 2;
      const x = groupStart + di * (barW + barGap);
      const y = toY(v);
      const barH = pad.top + cH - y;

      // Gölge + gradient
      ctx.shadowColor = ds.color + '40';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;

      const grad = ctx.createLinearGradient(0, y, 0, y + barH);
      grad.addColorStop(0, ds.color);
      grad.addColorStop(1, darkenColor(ds.color, 25));
      ctx.fillStyle = grad;

      const r = Math.min(6, barW / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
      ctx.lineTo(x + barW, y + barH);
      ctx.lineTo(x, y + barH);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();

      // Gölge sıfırla
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Parlak üst çizgi
      ctx.fillStyle = hexToRgba(ds.color, 0.35);
      ctx.fillRect(x + r, y + 1, barW - r * 2, 2);

      // Değeri çubuğun içine yaz
      if (barW >= 10) { 
        ctx.fillStyle = cssVar('--chart-bar-label', 'rgba(255,255,255,0.95)');
        const textVal = v !== undefined ? fmt(v) : '—';
        
        let fontSize = 13;
        ctx.font = `bold ${fontSize}px Inter, sans-serif`;
        let textWidth = ctx.measureText(textVal).width;

        // Yatay sığmıyorsa fontu küçült (minimum 9px'e kadar)
        while (textWidth > barW - 2 && fontSize > 9) {
          fontSize--;
          ctx.font = `bold ${fontSize}px Inter, sans-serif`;
          textWidth = ctx.measureText(textVal).width;
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';

        // Hafif gölge efekti ile yazı
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;

        // Eğer çubuk yeterince yüksekse içine, kısaysa dışına üstüne yaz
        if (barH > fontSize + 10) {
          ctx.fillText(textVal, x + barW / 2, y + fontSize + 4);
        } else {
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetY = 0;
          ctx.fillStyle = cssVar('--chart-bar-label-outside', 'rgba(226,232,240,0.9)');
          ctx.fillText(textVal, x + barW / 2, y - 6);
        }
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
      }
    });
  });

  // X labels
  ctx.fillStyle = cssVar('--chart-text', 'rgba(148,163,184,0.7)');
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(labels.length / 10));
  // Yıl ortalamak için grup bul
  const yearGroups = {};
  labels.forEach((l, i) => {
    const parts = l.split('/');
    if (parts.length === 2 && !isNaN(parts[0]) && parts[1].length === 4) {
      if (!yearGroups[parts[1]]) yearGroups[parts[1]] = [];
      yearGroups[parts[1]].push(i);
    }
  });
  labels.forEach((l, i) => {
    if (i % step === 0 || i === labels.length - 1) {
      const x = pad.left + i * groupW + groupW / 2;
      const parts = l.split('/');
      if (parts.length === 2 && !isNaN(parts[0]) && parts[1].length === 4) {
        ctx.fillText(parts[0], x, H - pad.bottom + 12);
      } else {
        ctx.fillText(l, x, H - pad.bottom + 16);
      }
    }
  });
  // Yılları ortala
  ctx.font = '8px Inter, sans-serif';
  ctx.fillStyle = cssVar('--chart-text-dim', 'rgba(148,163,184,0.5)');
  ctx.textAlign = 'center';
  for (const [year, indices] of Object.entries(yearGroups)) {
    const firstX = pad.left + indices[0] * groupW + groupW / 2;
    const lastX = pad.left + indices[indices.length - 1] * groupW + groupW / 2;
    const cx = (firstX + lastX) / 2;
    ctx.fillText(year, cx, H - pad.bottom + 24);
  }
  ctx.font = '10px Inter, sans-serif';
  ctx.fillStyle = cssVar('--chart-text', 'rgba(148,163,184,0.7)');

  // Legend
  datasets.forEach((ds, i) => {
    const x = pad.left + i * 130;
    const y = 10;
    // Yuvarlak işaret
    ctx.beginPath();
    ctx.arc(x + 8, y + 5, 5, 0, Math.PI * 2);
    ctx.fillStyle = ds.color;
    ctx.fill();
    ctx.fillStyle = cssVar('--chart-text-dim', 'rgba(148,163,184,0.7)');
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(ds.label, x + 18, y + 9);
  });
}

// Redraw charts on window resize
window.addEventListener('resize', () => {
  if (document.getElementById('content-charts').classList.contains('active')) {
    drawAllCharts();
  }
});

// ─── EXPORT CSV ────────────────────────────────────────────────────────────────
function exportData() {
  if (records.length === 0) {
    showToast('Dışa aktarılacak kayıt bulunamadı.', 'error');
    return;
  }

  const headers = [
    'Tarih',
    'Üretilen Yemek Sayısı',
    '%10 Fire',
    'Turnike Geçiş Sayısı',
    'Yemekhanede Çalışan Personel Sayısı',
    'Toplam Geçiş',
    'Porsiyon Miktarı (gr)',
    'Atık Miktarı (kg)',
    'Yemek Hiz. Yar. Öğr. Sayısı',
    'Yemek Türü'
  ];

  const rows = records.map(r => [
    r.tarih,
    r.yemek,
    r.fire,
    r.turnike,
    r.personel,
    r.toplam,
    r.porsiyon,
    r.atik,
    r.ogrenci,
    r.yemek_adi || ''
  ].map(v => `"${v}"`).join(';'));

  const bom = '\uFEFF';
  const csvContent = bom + [headers.join(';'), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `atik_kontrol_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('CSV dosyası indirildi.', 'success');
}

// ─── PRINT ─────────────────────────────────────────────────────────────────────
function printReport() {
  exportPDF();
}

// ─── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;

  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── KEYBOARD ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeSyncPanel(); }

  // Ctrl+N: Yeni kayıt
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    if (!document.getElementById('modalOverlay').classList.contains('open')) openModal();
  }
  // Ctrl+F: Arama kutusuna odaklan
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    const searchInput = document.getElementById('searchInput');
    if (searchInput) { searchInput.focus(); searchInput.select(); }
  }
  // Ctrl+E: CSV dışa aktar
  if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
    e.preventDefault();
    exportData();
  }
  // ? : Kısayol yardımı
  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.target.matches('input, textarea')) {
    e.preventDefault();
    const el = document.getElementById('shortcutsHelp');
    if (el) el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
  }
});

// ─── WEEKLY MENU ──────────────────────────────────────────────────────────────
const MENU_STORAGE_KEY = 'atik_kontrol_menu';
const GUNLER = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
let menuWeekOffset = 0;

function getWeekStartDate(offset) {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) + offset * 7;
  const monday = new Date(now);
  monday.setDate(diff);
  return monday;
}

function formatDateStr(d) {
  const gun = String(d.getDate()).padStart(2, '0');
  const ay = String(d.getMonth() + 1).padStart(2, '0');
  const yil = d.getFullYear();
  return gun + '.' + ay + '.' + yil;
}

function loadWeeklyMenu() {
  try {
    const stored = localStorage.getItem(MENU_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) { return {}; }
}

function saveWeeklyMenu() {
  const monday = getWeekStartDate(menuWeekOffset);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const weekKey = formatDateStr(monday) + '-' + formatDateStr(friday);

  const menuData = {};
  GUNLER.forEach((gun, i) => {
    const tarih = new Date(monday);
    tarih.setDate(monday.getDate() + i);
    const key = formatDateStr(tarih);
    menuData[key] = {
      yemekler: [
        document.getElementById('m1_' + i).value,
        document.getElementById('m2_' + i).value,
        document.getElementById('m3_' + i).value,
        document.getElementById('m4_' + i).value,
        document.getElementById('m5_' + i).value
      ],
      kisi: parseInt(document.getElementById('mk_' + i).value) || 0
    };
  });

  const allData = loadWeeklyMenu();
  allData[weekKey] = menuData;
  try { localStorage.setItem(MENU_STORAGE_KEY, JSON.stringify(allData)); } catch (e) {}
  showToast('Haftalık menü kaydedildi.', 'success');
}

function clearWeeklyMenu() {
  if (!confirm('Bu haftanın menüsünü temizlemek istediğinize emin misiniz?')) return;
  const monday = getWeekStartDate(menuWeekOffset);
  GUNLER.forEach((_, i) => {
    ['m1_','m2_','m3_','m4_','m5_'].forEach(id => document.getElementById(id + i).value = '');
    document.getElementById('mk_' + i).value = '';
  });
  showToast('Menü temizlendi.', 'success');
}

function shiftMenuWeek(dir) {
  menuWeekOffset += dir;
  renderMenu();
}

function renderMenu() {
  const monday = getWeekStartDate(menuWeekOffset);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const weekKey = formatDateStr(monday) + '-' + formatDateStr(friday);

  document.getElementById('menuWeekLabel').textContent = weekKey + ' MENÜ LİSTESİ';
  document.getElementById('menuTitle').textContent = weekKey + ' MENÜ LİSTESİ';

  const allData = loadWeeklyMenu();
  const weekData = allData[weekKey] || {};

  const tbody = document.getElementById('menuTbody');
  tbody.innerHTML = GUNLER.map((gun, i) => {
    const tarih = new Date(monday);
    tarih.setDate(monday.getDate() + i);
    const key = formatDateStr(tarih);
    const dayData = weekData[key] || { yemekler: ['','','','',''], kisi: 0 };

    return `<tr>
      <td>${gun}<br><span style="font-size:0.7rem;color:var(--text-muted)">${key}</span></td>
      <td><input type="text" id="m1_${i}" value="${dayData.yemekler[0] || ''}" placeholder="1. çeşit" /></td>
      <td><input type="text" id="m2_${i}" value="${dayData.yemekler[1] || ''}" placeholder="2. çeşit" /></td>
      <td><input type="text" id="m3_${i}" value="${dayData.yemekler[2] || ''}" placeholder="3. çeşit" /></td>
      <td><input type="text" id="m4_${i}" value="${dayData.yemekler[3] || ''}" placeholder="4. çeşit" /></td>
      <td><input type="text" id="m5_${i}" value="${dayData.yemekler[4] || ''}" placeholder="5. çeşit" /></td>
      <td><input type="number" class="kisi-input" id="mk_${i}" value="${dayData.kisi || 0}" min="0" placeholder="0" /></td>
    </tr>`;
  }).join('');
}
