/* =============================================
   ATIK KONTROL YÖNETİM SİSTEMİ - APP LOGIC
   ============================================= */

'use strict';

// ─── STATE ───────────────────────────────────────────────────────────────────
const DEFAULT_GSHEET_URL = 'https://script.google.com/macros/s/AKfycbynBf7pBHQrZ0Vh3lSyTyceozIBXF_uZP2ZIkkd76C7SkSqKoRRJANC68LGCqTAXYHCCg/exec';
let records = [];
let editingId = null;
let filteredRecords = [];
let gsheetConfig = { webappUrl: '', lastSync: null };
let yemeklerCache = [];

// ─── THEME ───────────────────────────────────────────────────────────────────
// Initial theme is handled by inline script in HTML (reads localStorage)
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? '' : 'dark';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('atik_kontrol_theme', newTheme || 'light');
  if (typeof drawAllCharts === 'function') drawAllCharts();
}

function loadAccent() {
  const saved = localStorage.getItem('atik_kontrol_accent') || 'blue';
  document.documentElement.setAttribute('data-accent', saved);
  document.querySelectorAll('.accent-dot').forEach(b => {
    b.classList.toggle('active', b.dataset.accent === saved);
  });
}

function setAccent(name) {
  document.documentElement.setAttribute('data-accent', name);
  localStorage.setItem('atik_kontrol_accent', name);
  document.querySelectorAll('.accent-dot').forEach(b => {
    b.classList.toggle('active', b.dataset.accent === name);
  });
  if (typeof drawAllCharts === 'function') drawAllCharts();
}

// ─── TOAST NOTIFICATION ───────────────────────────────────────────────────────
function showToast(message, type) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'info');
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.classList.add('toast-visible'); });
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hiding');
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }, 3000);
}

// ─── PAGINATION ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;
let currentPage = 1;
let selectedIds = new Set();

// ─── UNSAVED CHANGES ──────────────────────────────────────────────────────────
let formModified = false;

// ─── CHART YEAR / MONTH FILTER ──────────────────────────────────────────────
let chartYearFilter = 'all';
let chartMonthFilter = 0;
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
  drawAllCharts();
}
function setChartMonth(month) {
  chartMonthFilter = Number(month);
  document.querySelectorAll('.month-btn').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.month) === chartMonthFilter);
  });
  drawAllCharts();
}
// ─── LOGIN / LOGOUT / ROLES ────────────────────────────────────────────────

const ADMIN_PASSWORD = '2525';
const VIEWER_PASSWORD = 'gör';

const ROLE_ADMIN = 'admin';
const ROLE_VIEWER = 'viewer';

function getRole() {
  return localStorage.getItem('atik_kontrol_role') || ROLE_VIEWER;
}

function requireAdmin() {
  if (getRole() !== ROLE_ADMIN) {
    showToast('Bu işlem için admin yetkisi gerekli.', 'error');
    return false;
  }
  return true;
}

function doLogout() {
  localStorage.removeItem('atik_kontrol_login_hash');
  localStorage.removeItem('atik_kontrol_role');
  location.reload();
}

function doLogin() {
  const input = document.getElementById('loginPassword');
  const error = document.getElementById('loginError');
  let role = null;
  if (input.value === ADMIN_PASSWORD) role = ROLE_ADMIN;
  else if (input.value === VIEWER_PASSWORD) role = ROLE_VIEWER;

  if (role) {
    localStorage.setItem('atik_kontrol_login_hash', btoa(input.value));
    localStorage.setItem('atik_kontrol_role', role);
    document.getElementById('loginOverlay').classList.add('hidden');
    document.body.setAttribute('data-role', role);
    document.getElementById('roleBadge').textContent = role === ROLE_ADMIN ? 'Admin' : 'Görüntüleme';
    if (window._loginResolve) { window._loginResolve(); window._loginResolve = null; }
  } else {
    window._loginAttempts = (window._loginAttempts || 0) + 1;
    error.textContent = 'Hatalı şifre!';
    error.style.display = 'block';
    input.value = '';
    input.focus();
    if (window._loginAttempts >= 5) {
      error.textContent = 'Çok fazla hatalı giriş! Sayfa yenileniyor...';
      setTimeout(() => location.reload(), 2000);
    }
  }
}

function applyViewerRestrictions() {
  if (getRole() !== ROLE_ADMIN) {
    document.querySelectorAll('.menu-table textarea, .menu-table input, .note-input, .kisi-input, #haccpForm textarea, #haccpForm input, #haccpForm select').forEach(el => { el.readOnly = true; el.disabled = true; el.style.opacity = '0.7'; });
    document.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const savedHash = localStorage.getItem('atik_kontrol_login_hash');
  if (savedHash) {
    document.getElementById('loginOverlay').classList.add('hidden');
    const role = getRole();
    document.body.setAttribute('data-role', role);
    const badge = document.getElementById('roleBadge');
    if (badge) badge.textContent = role === ROLE_ADMIN ? 'Admin' : 'Görüntüleme';
  } else {
    document.getElementById('loginPassword').focus();
    await new Promise(resolve => {
      window._loginResolve = resolve;
      window._loginAttempts = 0;
    });
  }

  loadGSheetConfig();
  loadAccent();
  setConnectionStatus('sync');
  setLoadingText('Veriler senkronize ediliyor...', 'Google Sheets bağlantısı kuruluyor');
  loadData();
  loadHaccpData();
  loadYagData();
  loadAmbalajData();
  setCurrentDate();
  renderAll();
  drawAllCharts();
  await restoreActiveTab();
  updateSyncUI();

  // Güvenlik: 12 sn sonra loading overlay'i zorla kapat
  var forceHideTimer = setTimeout(function() {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }, 12000);

  // Paralel senkronizasyon
  setLoadingSub('Veriler güncelleniyor...');
  var [mainOk, dishOk, haccpOk] = await Promise.all([
    gsheetConfig.webappUrl ? fetchWithRetry(() => syncFromGSheets(), 2, 500, 8000) : true,
    gsheetConfig.webappUrl ? fetchWithRetry(() => syncDishesFromGSheets(), 2, 500, 8000) : true,
    gsheetConfig.webappUrl ? fetchWithRetry(() => syncHaccpFromGSheets(), 2, 500, 8000) : true
  ]);
  clearTimeout(forceHideTimer);
  if (gsheetConfig.webappUrl) { saveHaccpData(); renderHaccp(); }
  var menuOk = true;

  refreshMenuProduction();
  initDishAutocomplete();

  // Loading overlay'i kapat
  document.getElementById('loadingOverlay').classList.add('hidden');

  // Bağlantı durumunu göster
  if ((!gsheetConfig.webappUrl || (mainOk && dishOk))) {
    setConnectionStatus('ok');
  } else {
    setConnectionStatus('err');
  }

  // Otomatik polling: 30 sn'de bir Google Sheets'ten güncel verileri çek
  startAutoSync();
  showSyncTime('başlatıldı');
});

let autoSyncTimer = null;

function startAutoSync() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  if (!gsheetConfig.webappUrl) return;
  autoSyncTimer = setInterval(async () => {
    await autoPull();
  }, 30000);
}

let lastPollData = null;

async function autoPull() {
  try {
    const res = await fetch(gsheetConfig.webappUrl + '?action=getAll');
    const data = await res.json();
    if (!data.data || data.data.length === 0) return;

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

    const serialized = JSON.stringify(cloudRecords);
    if (serialized === lastPollData) {
      showSyncTime();
      return;
    }

    lastPollData = serialized;
    records = cloudRecords;
    records.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
    saveData();
    filteredRecords = [...records];
    renderAll();
    drawAllCharts();
    setConnectionStatus('ok');
    showSyncTime('Veri güncellendi');
  } catch (_) {
    setConnectionStatus('err');
  }
}

function showSyncTime(msg) {
  const el = document.getElementById('connSyncTime');
  if (!el) return;
  const now = new Date();
  const time = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  el.textContent = msg ? `Bağlı • ${time} (${msg})` : `Bağlı • ${time}`;
}

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

function normalizeSaat(v) {
  if (!v) return '';
  if (/^\d{2}:\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (!isNaN(d)) {
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  return v;
}

function setCurrentDate() {
  const el = document.getElementById('currentDate');
  const now = new Date();
  el.textContent = now.toLocaleDateString('tr-TR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  // Set default date for form
  document.getElementById('fTarih').value = formatLocalDate(now);
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

function saveData() { if (!requireAdmin()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    // Storage full or unavailable - ignore silently
  }
  syncToSheetSilent();
  // Polling karşılaştırması için cloud verisini güncelle
  lastPollData = null;
  showSyncTime('kaydedildi');
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

async function syncHaccpToGSheets() {
  if (!gsheetConfig.webappUrl) {
    showToast('Önce Web App URL\'sini ayarlayın (Senkronizasyon paneli).', 'error');
    return;
  }
  try {
    if (haccpRecords.length === 0) {
      var pulled = await syncHaccpFromGSheets();
      if (pulled) {
        if (haccpRecords.length > 0) {
          showToast('Google Sheets\'ten ' + haccpRecords.length + ' kayıt alındı.', 'success');
          saveHaccpData();
          renderHaccp();
        } else {
          showToast('Depo adları Google Sheets\'ten alındı.', 'success');
        }
      } else {
        showToast('Google Sheets\'te kayıt bulunamadı.', 'info');
      }
      return;
    }
    var depoAdlari = loadHaccpDepoAdlari();
    const res = await fetch(gsheetConfig.webappUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'saveHaccp', records: haccpRecords, depoAdlari: depoAdlari })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Gıda Güvenliği verileri senkronize edildi (' + data.count + ' kayıt).', 'success');
    } else {
      showToast('Hata: ' + (data.error || 'Bilinmeyen hata'), 'error');
    }
  } catch (err) {
    showToast('Bağlantı hatası: ' + err.message, 'error');
  }
}

let haccpSyncTimer = null;
function syncHaccpSilent(forceDepoOnly) {
  if (haccpSyncTimer) clearTimeout(haccpSyncTimer);
  if (haccpRecords.length === 0 && !forceDepoOnly) return;
  haccpSyncTimer = setTimeout(async () => {
    if (!gsheetConfig.webappUrl) return;
    try {
      var depoAdlari = loadHaccpDepoAdlari();
      await fetch(gsheetConfig.webappUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'saveHaccp', records: haccpRecords, depoAdlari: depoAdlari })
      });
    } catch (_) {}
  }, 400);
}

async function syncHaccpFromGSheets() {
  if (!gsheetConfig.webappUrl) return false;
  try {
    // Önce POST action dene (yeni sunucu), olmazsa GET ile 3 sayfayı oku (eski sunucu)
    let data;
    try {
      const res = await fetch(gsheetConfig.webappUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'getHaccp' })
      });
      data = await res.json();
    } catch (_) { data = null; }
    if (!data || !data.data) {
      // Eski sunucu: 3 sayfayı ayrı ayrı GET ile oku
      var allRows = [];
      var sheets = ['G%C4%B1da%20G%C3%BCvenli%C4%9Fi', 'Numune%20Takibi', 'Hijyen%20Kontrol'];
      for (var si = 0; si < sheets.length; si++) {
        try {
          var r2 = await fetch(gsheetConfig.webappUrl + '?sheet=' + sheets[si]);
          var d2 = await r2.json();
          if (d2.data) allRows = allRows.concat(d2.data);
        } catch (_) {}
      }
      data = { data: allRows, depoAdlari: data && data.depoAdlari ? data.depoAdlari : (allRows.length > 0 ? [] : undefined) };
    }
    if (data.data && data.data.length > 0) {
      haccpRecords = data.data.map(r => {
        var typ = (r.type || 'sicaklik').toLowerCase();
        var base = {
          id: Number(r.id) || Date.now() + Math.random(),
          type: typ,
          tarih: normalizeDate(r.tarih || ''),
          saat: normalizeSaat(r.saat || ''),
          not: r.not_ || r.not || '',
          ogun: r.ogun || '',
          yemekAdi: r.yemekAdi || '',
          miktar: r.miktar || '',
          saklamaSicakligi: r.saklamaSicakligi || '',
          imhaTarihi: r.imhaTarihi || '',
          alan: r.alan || '',
          yapilacakIs: r.yapilacakIs || '',
          yapanKisi: r.yapanKisi || '',
          yapildiMi: r.yapildiMi != null ? Number(r.yapildiMi) : undefined
        };
        if (typ === 'sicaklik') {
          base.depoAd = (r.depoAd || (r.depoNo ? 'Depo ' + r.depoNo : '')).replace(/^Depo /, '');
          base.sicaklik = r.sicaklik != null ? Number(r.sicaklik) : undefined;
          base.nem = r.nem != null ? Number(r.nem) : undefined;
        }
        return base;
      });
    }
    var hasDepo = false;
    if (data.depoAdlari && Array.isArray(data.depoAdlari) && data.depoAdlari.length > 0) {
      try { localStorage.setItem(HACCP_DEPO_KEY, JSON.stringify(data.depoAdlari)); } catch (_) {}
      hasDepo = true;
    }
    if (data.data && data.data.length > 0) return true;
    if (hasDepo) return true;
    return false;
  } catch (_) { return false; }
}

// -- Retry helper with timeout --
async function fetchWithRetry(fn, maxRetries = 3, delayMs = 1000, timeoutMs = 10000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await withTimeout(fn(), timeoutMs);
      if (result !== false) return result;
    } catch (_) {}
    if (i < maxRetries - 1) {
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  return false;
}

async function withTimeout(promise, ms) {
  var timeoutPromise = new Promise(function(_, reject) {
    setTimeout(function() { reject(new Error('timeout')); }, ms);
  });
  return await Promise.race([promise, timeoutPromise]);
}

function setConnectionStatus(state) {
  const dot = document.getElementById('connDot');
  if (!dot) return;
  dot.className = 'conn-dot';
  if (state === 'ok') dot.classList.add('conn-ok');
  else if (state === 'err') dot.classList.add('conn-err');
  else if (state === 'sync') dot.classList.add('conn-sync');
}

function setLoadingText(text, sub) {
  const el = document.getElementById('loadingText');
  if (el) el.textContent = text;
  if (sub !== undefined) setLoadingSub(sub);
}

function setLoadingSub(text) {
  const el = document.getElementById('loadingSub');
  if (el) el.textContent = text;
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

function getMenuUrl() {
  return gsheetConfig.webappUrl;
}

function saveGSheetUrl() { if (!requireAdmin()) return;
  const url = document.getElementById('gsheetUrl').value.trim();
  gsheetConfig.webappUrl = url || DEFAULT_GSHEET_URL;
  try {
    localStorage.setItem('atik_kontrol_gsheet_config', JSON.stringify(gsheetConfig));
  } catch (e) {}
  updateSyncUI();
  showToast('Web App URL kaydedildi.', 'success');
  if (url) testGSheetConnection();
}

function saveAllUrls() {
  const url1 = document.getElementById('gsheetUrl').value.trim();
  gsheetConfig.webappUrl = url1 || DEFAULT_GSHEET_URL;
  try {
    localStorage.setItem('atik_kontrol_gsheet_config', JSON.stringify(gsheetConfig));
  } catch (e) {}
  updateSyncUI();
  showToast('URL kaydedildi.', 'success');
  if (url1) testGSheetConnection();
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

async function quickPullFromSheets() {
  if (!gsheetConfig.webappUrl) {
    showToast('Önce Web App URL\'sini ayarlayın (Senkronize Et → URL kaydet).', 'error');
    return;
  }
  try { await syncFromGSheets(); } catch (e) { showToast('Senkronizasyon hatası: ' + e.message, 'error'); }
}

async function syncToGSheets() { if (!requireAdmin()) return;
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
      setConnectionStatus('ok');
      showToast('Veriler Google Sheet\'e yedeklendi (' + data.count + ' kayıt).', 'success');
    } else {
      showToast('Hata: ' + (data.error || 'Bilinmeyen hata'), 'error');
    }
  } catch (err) {
    setConnectionStatus('err');
    showToast('Bağlantı hatası: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Yerel → Google Sheet (Yedekle)';
  }
}

async function syncFromGSheets() { if (!requireAdmin()) return;
  if (!gsheetConfig.webappUrl) {
    showToast('Önce Web App URL\'sini girin.', 'error');
    return false;
  }
  const btn = document.getElementById('syncDownloadBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'İndiriliyor...'; }
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
        if (btn) { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Google Sheet → Yerel (İndir)'; }
        return true;
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
      setConnectionStatus('ok');
      await syncHaccpFromGSheets();
      saveHaccpData();
      renderHaccp();
      if (!btn) showToast('Google Sheet\'ten ' + cloudRecords.length + ' kayıt indirildi.', 'success');
      return true;
    } else {
      if (btn) showToast('Hata: ' + (data.error || 'Veri alınamadı'), 'error');
      return false;
    }
  } catch (err) {
    setConnectionStatus('err');
    return false;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Google Sheet → Yerel (İndir)';
    }
  }
}

async function testGSheetConnection() {
  try {
    const res = await fetch(gsheetConfig.webappUrl + '?action=getAll', { method: 'GET', mode: 'cors' });
    if (res.ok) {
      document.getElementById('syncStatusLabel').textContent = 'Bağlantı başarılı';
      document.getElementById('syncStatusSub').textContent = 'Google Sheet\'e erişilebiliyor';
      document.getElementById('syncStatusIcon').className = 'sync-status-icon sync-ok';
      setConnectionStatus('ok');
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
    const printWin = window.open('', '_blank', 'width=1100,height=800');
    if (!printWin) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
    const cards = [...document.querySelectorAll('#content-report > .section-card')].map(c => c.outerHTML).join('');
    printWin.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8"><title>Atık Kontrol Raporu</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { font-size: 1.3rem; margin-bottom: 0.3rem; }
        .date { font-size: 0.8rem; color: #666; margin-bottom: 1rem; }
        .section-card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; page-break-inside: avoid; }
        .section-header h2 { font-size: 0.95rem; margin: 0 0 0.5rem; }
        .report-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(180px,1fr)); gap: 8px; margin: 10px 0; }
        .report-item { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; }
        .report-label { font-size: 10px; color: #64748b; text-transform: uppercase; }
        .report-value { font-size: 16px; font-weight: 700; margin-top: 2px; }
        .report-subdate { font-size: 0.65rem; color: #94a3b8; font-weight: 400; display: block; margin-top: 1px; }
        .data-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
        .data-table th { background: #f1f5f9; font-weight: 600; padding: 0.4rem 0.5rem; text-align: left; border: 1px solid #ddd; }
        .data-table td { padding: 0.35rem 0.5rem; border: 1px solid #ddd; }
        .trend-up { color: #ef4444; font-weight: 700; }
        .trend-down { color: #10b981; font-weight: 700; }
        .trend-flat { color: #64748b; font-weight: 700; }
        .badge, .btn, .toolbar, .year-btn { display: none; }
      .note-input { width: 100%; padding: 3px 5px; border: 1px solid #ccc; border-radius: 3px; font-size: 0.7rem; resize: vertical; min-height: 24px; font-family: inherit; }
      .footer { text-align: center; font-size: 0.75rem; color: #999; margin-top: 2rem; border-top: 1px solid #ddd; padding-top: 0.5rem; }
      </style>
    </head><body>
      <h1>Atık Kontrol Raporu</h1>
      <div class="date">${new Date().toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'})}</div>
      ${cards}
      <div class="footer">Atık Kontrol Yönetim Sistemi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
    </body></html>`);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => { try { printWin.print(); } catch(e) {} }, 500);
  });
}

// --- QR KOD -----------------------------------------------------------------

function showQrModal(depoAdi) {
  document.getElementById('qrDepoAdi').textContent = depoAdi;
  var baseUrl = 'https://mustafaorhan-dev.github.io/depo-sicaklik/';
  var pageUrl = baseUrl + '?depo=' + encodeURIComponent(depoAdi);
  var url = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(pageUrl);
  document.getElementById('qrImage').src = url;
  document.getElementById('qrUrlDisplay').textContent = pageUrl;
  document.getElementById('qrModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeQrModal() {
  document.getElementById('qrModal').classList.remove('open');
  document.body.style.overflow = '';
}

function printQr() {
  var depoAdi = document.getElementById('qrDepoAdi').textContent;
  var img = document.getElementById('qrImage');
  var printWin = window.open('', '_blank', 'width=400,height=500');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapat' + String.fromCharCode(305) + 'n.', 'error'); return; }
  printWin.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>QR Kod - ' + depoAdi + '</title>' +
    '<style>body{text-align:center;font-family:Arial,sans-serif;padding:20px;margin:0}' +
    'h1{font-size:1.2rem;margin-bottom:0.3rem}' +
    '.sub{font-size:0.85rem;color:#666;margin-bottom:1.5rem}' +
    'img{width:280px;height:280px;border:2px solid #ddd;border-radius:12px;padding:10px;background:#fff}' +
    '</style></head><body>' +
    '<h1>' + depoAdi + '</h1>' +
    '<div class="sub">S' + String.fromCharCode(305) + 'cakl' + String.fromCharCode(305) + 'k kayd' + String.fromCharCode(305) + ' i' + String.fromCharCode(231) + 'in QR kodu okutun</div>' +
    '<img src="' + img.src + '" alt="QR Kod" />' +
    '</body></html>');
  printWin.document.close();
  printWin.focus();
  setTimeout(function() { try { printWin.print(); } catch(e) {} }, 500);
}

// ─── HACCP / GIDA GUVENLIGI ───────────────────────────────────────────────────
const HACCP_STORAGE_KEY = 'haccp_records';
const HACCP_DEPO_KEY = 'haccp_depo_adlari';
const DEFAULT_DEPO_ADLARI = ['Soğuk Hava Deposu 5', 'Soğuk Hava Deposu 6', 'Soğuk Hava Deposu 7', 'Soğuk Hava Deposu 8'];
let haccpRecords = [];
let editingHaccpId = null;
let editingHaccpType = null;

function loadHaccpDepoAdlari() {
  try {
    var stored = localStorage.getItem(HACCP_DEPO_KEY);
    if (stored !== null) {
      var parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return [...DEFAULT_DEPO_ADLARI];
}

function saveHaccpDepoAdlari(list) {
  try { localStorage.setItem(HACCP_DEPO_KEY, JSON.stringify(list)); } catch (_) {}
  syncHaccpSilent(true);
}

function getHaccpDepoAdlari() {
  return loadHaccpDepoAdlari();
}

function addHaccpDepoAdi(name) {
  const list = loadHaccpDepoAdlari();
  name = name.trim();
  if (name && !list.includes(name)) {
    list.push(name);
    saveHaccpDepoAdlari(list);
  }
  return list;
}

function removeHaccpDepoAdi(name) {
  const list = loadHaccpDepoAdlari().filter(n => n !== name);
  saveHaccpDepoAdlari(list);
  renderHaccpDepoListesi();
  renderHaccpSicaklikDepoSelect();
  return list;
}

function showHaccpDepoYonetim() {
  document.getElementById('haccpDepoModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderHaccpDepoListesi();
}

function closeHaccpDepoModal() {
  document.getElementById('haccpDepoModal').classList.remove('open');
  document.body.style.overflow = '';
}

function addHaccpDepoAdiFromInput() {
  const input = document.getElementById('haccpYeniDepoInput');
  if (!input || !input.value.trim()) return;
  addHaccpDepoAdi(input.value.trim());
  input.value = '';
  renderHaccpDepoListesi();
  renderHaccpSicaklikDepoSelect();
}

function renderHaccpDepoListesi() {
  const list = loadHaccpDepoAdlari();
  const container = document.getElementById('haccpDepoListesi');
  if (!container) return;
  container.innerHTML = list.map(function(n) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">' +
      '<span>' + n + '</span>' +
      '<div style="display:flex;gap:4px">' +
      '<button class="btn btn-ghost btn-sm" onclick="showQrModal(\'' + n.replace(/'/g, "\\'") + '\')" title="QR Kod">\uD83D\uDCF7 QR</button>' +
      '<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="removeHaccpDepoAdi(\'' + n.replace(/'/g, "\\'") + '\')">Sil</button>' +
      '</div></div>';
  }).join('');
}

function renderHaccpSicaklikDepoSelect() {
  const select = document.getElementById('hfDepoAd');
  if (!select) return;
  const currentVal = select.value;
  const list = getHaccpDepoAdlari();
  select.innerHTML = list.map(function(d) {
    var sel = d === currentVal ? ' selected' : '';
    return '<option value="' + d.replace(/"/g,'&quot;') + '"' + sel + '>' + d + '</option>';
  }).join('');
}

function loadHaccpData() {
  try {
    const stored = localStorage.getItem(HACCP_STORAGE_KEY);
    haccpRecords = stored ? JSON.parse(stored) : [];
  } catch (_) { haccpRecords = []; }
  renderHaccp();
}

function saveHaccpData() { if (!requireAdmin()) return;
  try { localStorage.setItem(HACCP_STORAGE_KEY, JSON.stringify(haccpRecords)); } catch (_) {}
  syncHaccpSilent();
}

function renderHaccpDepoSummary() {
  var el = document.getElementById('haccpDepoSummary');
  if (!el) return;
  var recs = haccpRecords.filter(function(r) { return r.type === 'sicaklik' && r.tarih && (r.sicaklik != null || r.nem != null); });
  if (recs.length === 0) { el.innerHTML = ''; return; }

  var today = new Date();
  var yediGunOnce = new Date(today);
  yediGunOnce.setDate(yediGunOnce.getDate() - 7);
  var yediGunOnceStr = formatLocalDate(yediGunOnce);
  var son7 = recs.filter(function(r) { return r.tarih >= yediGunOnceStr; });

  if (son7.length === 0) { el.innerHTML = ''; return; }

  var depoMap = {};
  son7.forEach(function(r) {
    var ad = r.depoAd || 'Bilinmeyen';
    if (!depoMap[ad]) depoMap[ad] = { sicaklik: [], nem: [] };
    if (r.sicaklik != null && r.sicaklik !== '') depoMap[ad].sicaklik.push(parseFloat(r.sicaklik));
    if (r.nem != null && r.nem !== '') depoMap[ad].nem.push(parseFloat(r.nem));
  });

  var html = '<div style="display:flex;gap:0.5rem;flex-wrap:wrap">';
  var depoRenkler = ['#6366f1', '#f97316', '#10b981', '#a855f7', '#22d3ee', '#f59e0b', '#ef4444', '#d946ef'];
  var ri = 0;
  Object.keys(depoMap).sort().forEach(function(ad) {
    var sicVals = depoMap[ad].sicaklik;
    var nemVals = depoMap[ad].nem;
    if (sicVals.length === 0 && nemVals.length === 0) return;
    var renk = depoRenkler[ri % depoRenkler.length]; ri++;
    var nemAvg = nemVals.length > 0 ? (nemVals.reduce(function(a, b) { return a + b; }, 0) / nemVals.length) : null;
    var topKayit = sicVals.length + nemVals.length;
    html += '<div style="flex:1;min-width:160px;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.02)">' +
      '<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.3rem">' +
      '<span style="width:8px;height:8px;border-radius:50%;background:' + renk + ';flex-shrink:0"></span>' +
      '<span style="font-size:0.78rem;font-weight:600;color:var(--text-primary)">' + ad + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:0.5rem;font-size:0.72rem;color:var(--text-muted);flex-wrap:wrap">';
    if (sicVals.length > 0) {
      var min = Math.min.apply(null, sicVals);
      var max = Math.max.apply(null, sicVals);
      var avg = sicVals.reduce(function(a, b) { return a + b; }, 0) / sicVals.length;
      var da = ad.toLowerCase();
      var minOk, maxOk;
      if (da.includes('dondurucu')) { minOk = -24; maxOk = -18; }
      else { minOk = 0; maxOk = 4; }
      var durum = min >= minOk && max <= maxOk ? 'Uygun' : (max > maxOk ? 'Yüksek' : 'Düşük');
      html += '<span>Min: <strong style="color:' + (min < minOk || min > maxOk ? '#ef4444' : 'var(--text-primary)') + '">' + min.toFixed(1) + '°C</strong></span>' +
        '<span>Ort: <strong style="color:var(--text-primary)">' + avg.toFixed(1) + '°C</strong></span>' +
        '<span>Maks: <strong style="color:' + (max > maxOk || max < minOk ? '#ef4444' : 'var(--text-primary)') + '">' + max.toFixed(1) + '°C</strong></span>';
    }
    if (nemAvg !== null) {
      html += '<span>Nem: <strong>' + nemAvg.toFixed(0) + '%</strong></span>';
    }
    html += '<span style="margin-left:auto;font-size:0.65rem;color:var(--text-muted)">' + topKayit + ' kayıt</span>' +
      '</div></div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

function renderHaccp() {
  renderHaccpDepoSummary();
  renderHaccpSicaklik();
  renderHaccpNumune();
  renderHaccpHijyen();
}

function getHaccpRecords(type) {
  return haccpRecords.filter(r => r.type === type).sort((a, b) => b.tarih + b.saat > a.tarih + a.saat ? 1 : -1);
}

function sicaklikDurum(sicaklik, depoAd) {
  const v = parseFloat(sicaklik);
  if (isNaN(v)) return { text: '—', cls: '' };
  var min, max;
  var da = String(depoAd || '').toLowerCase();
  if (da.includes('dondurucu')) { min = -24; max = -18; }
  else if (da.includes('so\u011fuk') || da.includes('soguk')) { min = 0; max = 4; }
  if (v >= min && v <= max) return { text: 'Uygun', cls: 'badge badge-ok' };
  if (v < min) return { text: 'Düşük', cls: 'badge badge-warn' };
  return { text: 'Yüksek', cls: 'badge badge-err' };
}

var haccpSicaklikPage = 0;
var haccpSicaklikPageSize = 5;

function formatTarihTR(t) {
  if (!t) return '—';
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[3] + '.' + m[2] + '.' + m[1] : t;
}

function renderHaccpSicaklik() {
  const tbody = document.getElementById('haccpSicaklikTbody');
  const table = document.getElementById('haccpSicaklikTable');
  const empty = document.getElementById('haccpSicaklikEmpty');
  const nav = document.getElementById('haccpSicaklikNav');
  const filterSelect = document.getElementById('haccpSicaklikDepoFilter');
  let records = getHaccpRecords('sicaklik');

  // populate filter options
  if (filterSelect) {
    var curVal = filterSelect.value;
    var depoSet = {};
    records.forEach(function(r) { depoSet[r.depoAd || ('Depo ' + r.depoNo)] = true; });
    getHaccpDepoAdlari().forEach(function(d) { depoSet[d] = true; });
    var depoList = Object.keys(depoSet).sort();
    filterSelect.innerHTML = '<option value="">T\u00fcm\u00fc</option>' +
      depoList.map(function(d) { return '<option value="' + d.replace(/"/g,'&quot;') + '"' + (d === curVal ? ' selected' : '') + '>' + d + '</option>'; }).join('');
  }

  // apply filter
  if (filterSelect && filterSelect.value) {
    records = records.filter(function(r) { return (r.depoAd || ('Depo ' + r.depoNo)) === filterSelect.value; });
  }

  if (records.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    if (nav) nav.style.display = 'none';
    return;
  }
  table.style.display = 'table';
  empty.style.display = 'none';

  var totalPages = Math.ceil(records.length / haccpSicaklikPageSize);
  if (haccpSicaklikPage >= totalPages) haccpSicaklikPage = 0;
  if (haccpSicaklikPage < 0) haccpSicaklikPage = totalPages - 1;
  var start = haccpSicaklikPage * haccpSicaklikPageSize;
  var pageRecords = records.slice(start, start + haccpSicaklikPageSize);

  tbody.innerHTML = pageRecords.map(r => {
    const depoAd = r.depoAd || ('Depo ' + r.depoNo);
    const durum = sicaklikDurum(r.sicaklik, depoAd);
    return `<tr>
      <td>${formatTarihTR(r.tarih)}</td>
      <td>${r.saat || '—'}</td>
      <td>${depoAd}</td>
      <td class="${durum.cls}"><strong>${r.sicaklik != null ? r.sicaklik : '—'}</strong></td>
      <td>${r.nem != null ? r.nem : '—'}</td>
      <td>${r.not || '—'}</td>
      <td>
        <button class="btn-icon" onclick="editHaccpRecord('sicaklik',${r.id})" title="Düzenle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon" onclick="deleteHaccpRecord('sicaklik',${r.id})" title="Sil" style="color:var(--danger)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');

  if (nav) {
    nav.style.display = totalPages > 1 ? 'block' : 'none';
    document.getElementById('haccpSicaklikPageInfo').textContent = 'Sayfa ' + (haccpSicaklikPage + 1) + ' / ' + totalPages + ' (' + records.length + ' kayıt)';
    document.getElementById('haccpSicaklikPrevBtn').disabled = haccpSicaklikPage === 0;
    document.getElementById('haccpSicaklikNextBtn').disabled = haccpSicaklikPage >= totalPages - 1;
  }
}

function haccpSicaklikPrint() {
  var records = getHaccpRecords('sicaklik');
  var filter = document.getElementById('haccpSicaklikDepoFilter');
  var depo = filter ? filter.value : '';
  if (depo) records = records.filter(function(r) { return (r.depoAd || ('Depo ' + r.depoNo)) === depo; });
  records.sort(function(a, b) {
    if (a.tarih !== b.tarih) return a.tarih > b.tarih ? -1 : 1;
    return (a.saat || '') > (b.saat || '') ? -1 : 1;
  });
  var rows = records.map(function(r) {
    var da = r.depoAd || ('Depo ' + r.depoNo);
    var durum = sicaklikDurum(r.sicaklik, da);
    var nem = r.nem != null ? r.nem : '\u2014';
    var sicaklikGoster = r.sicaklik != null ? r.sicaklik : '\u2014';
    return '<tr><td>' + formatTarihTR(r.tarih) + '</td><td>' + (r.saat || '\u2014') + '</td><td>' + da + '</td><td>' + sicaklikGoster + '</td><td>' + nem + '</td><td class="' + durum.cls + '">' + durum.text + '</td></tr>';
  }).join('');
  var win = window.open('', '_blank');
  win.document.write('<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"/><title>So\u011fuk Depo S\u0131cakl\u0131k Kay\u0131tlar\u0131</title><style>');
  win.document.write('body{font-family:Arial,sans-serif;margin:20px;color:#333}h1{font-size:18px;margin-bottom:4px}p{font-size:12px;color:#666;margin-bottom:15px}');
  win.document.write('table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #ddd}th{background:#f5f5f5;font-weight:600}');
  win.document.write('.badge-ok{color:#10b981}.badge-warn{color:#f59e0b}.badge-err{color:#ef4444}');
  win.document.write('@media print{body{margin:10mm}button{display:none}}');
  win.document.write('</style></head><body>');
  win.document.write('<h1>So\u011fuk Depo S\u0131cakl\u0131k Kay\u0131tlar\u0131</h1>');
  win.document.write('<p>' + (depo || 'T\u00fcm depolar') + ' &mdash; ' + records.length + ' kay\u0131t</p>');
  win.document.write('<table><thead><tr><th>Tarih</th><th>Saat</th><th>Depo</th><th>S\u0131cakl\u0131k</th><th>Nem</th><th>Durum</th></tr></thead><tbody>' + rows + '</tbody></table>');
  win.document.write('</body></html>');
  win.document.close();
  setTimeout(function() { win.print(); }, 500);
}

function haccpSicaklikPagePrev() {
  if (haccpSicaklikPage > 0) { haccpSicaklikPage--; renderHaccpSicaklik(); }
}

function haccpSicaklikPageNext() {
  var records = getHaccpRecords('sicaklik');
  var totalPages = Math.ceil(records.length / haccpSicaklikPageSize);
  if (haccpSicaklikPage < totalPages - 1) { haccpSicaklikPage++; renderHaccpSicaklik(); }
}

function renderHaccpNumune() {
  const tbody = document.getElementById('haccpNumuneTbody');
  const table = document.getElementById('haccpNumuneTable');
  const empty = document.getElementById('haccpNumuneEmpty');
  const records = getHaccpRecords('numune');

  if (records.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }
  table.style.display = 'table';
  empty.style.display = 'none';

  tbody.innerHTML = records.map(r => `<tr>
    <td>${formatTarihTR(r.tarih)}</td>
    <td>${r.ogun || '—'}</td>
    <td>${r.yemekAdi || '—'}</td>
    <td>${r.miktar || '—'}</td>
    <td>${r.saklamaSicakligi || '—'}</td>
    <td>${formatTarihTR(r.imhaTarihi)}</td>
    <td>
      <button class="btn-icon" onclick="editHaccpRecord('numune',${r.id})" title="Düzenle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="btn-icon" onclick="deleteHaccpRecord('numune',${r.id})" title="Sil" style="color:var(--danger)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button>
    </td>
  </tr>`).join('');
}

function renderHaccpHijyen() {
  const tbody = document.getElementById('haccpHijyenTbody');
  const table = document.getElementById('haccpHijyenTable');
  const empty = document.getElementById('haccpHijyenEmpty');
  const records = getHaccpRecords('hijyen');

  if (records.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }
  table.style.display = 'table';
  empty.style.display = 'none';

  tbody.innerHTML = records.map(r => `<tr>
    <td>${formatTarihTR(r.tarih)}</td>
    <td>${r.alan || '—'}</td>
    <td>${r.yapilacakIs || '—'}</td>
    <td>${r.yapanKisi || '—'}</td>
    <td><span class="${r.yapildiMi ? 'badge badge-ok' : 'badge badge-warn'}">${r.yapildiMi ? 'Yapıldı' : 'Yapılmadı'}</span></td>
    <td>${r.not || '—'}</td>
    <td>
      <button class="btn-icon" onclick="editHaccpRecord('hijyen',${r.id})" title="Düzenle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="btn-icon" onclick="deleteHaccpRecord('hijyen',${r.id})" title="Sil" style="color:var(--danger)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button>
    </td>
  </tr>`).join('');
}

function openHaccpModal(type, id) {
  editingHaccpType = type;
  editingHaccpId = id || null;

  const overlay = document.getElementById('haccpModal');
  const title = document.getElementById('haccpModalTitle');
  const body = document.getElementById('haccpFormBody');

  const titles = { sicaklik: 'Depo Sıcaklık Kaydı', numune: 'Numune Kaydı', hijyen: 'Hijyen Kontrol Kaydı' };
  title.textContent = titles[type] || 'Yeni Kayıt';

  let rec = null;
  if (id) rec = haccpRecords.find(r => r.id === id && r.type === type);

  const now = new Date();
  const today = formatLocalDate(now);
  const saat = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');

  if (type === 'sicaklik') {
    var depoAdlari = getHaccpDepoAdlari();
    var depoVal = rec ? (rec.depoAd || '') : '';
    var depoOptions = depoAdlari.map(function(d) {
      var sel = d === depoVal ? ' selected' : '';
      return '<option value="' + d.replace(/"/g,'&quot;') + '"' + sel + '>' + d + '</option>';
    }).join('');
    body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="form-group"><label>Tarih</label><input type="date" id="hfTarih" value="${rec ? rec.tarih : today}" required /></div>
        <div class="form-group"><label>Saat</label><input type="time" id="hfSaat" value="${rec ? rec.saat : saat}" required /></div>
        <div class="form-group"><label>Depo Adı</label><select id="hfDepoAd" required style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px">${depoOptions}</select></div>
        <div class="form-group"><label>Sıcaklık (°C)</label><input type="number" id="hfSicaklik" step="0.1" value="${rec ? rec.sicaklik : ''}" placeholder="0.0 (boş bırakılabilir)" /></div>
        <div class="form-group"><label>Nem (%)</label><input type="number" id="hfNem" step="0.1" value="${rec ? (rec.nem ?? '') : ''}" placeholder="50" /></div>
        <div class="form-group" style="grid-column:span 2"><label>Not</label><input type="text" id="hfNot" value="${rec ? (rec.not || '') : ''}" placeholder="İsteğe bağlı" /></div>
      </div>`;
  } else if (type === 'numune') {
    body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="form-group"><label>Tarih</label><input type="date" id="hfTarih" value="${rec ? rec.tarih : today}" required /></div>
        <div class="form-group"><label>Öğün</label><select id="hfOgun"><option value="Sabah" ${rec && rec.ogun === 'Sabah' ? 'selected' : ''}>Sabah</option><option value="Öğle" ${rec && rec.ogun === 'Öğle' ? 'selected' : ''}>Öğle</option><option value="Akşam" ${rec && rec.ogun === 'Akşam' ? 'selected' : ''}>Akşam</option></select></div>
        <div class="form-group"><label>Yemek Adı</label><input type="text" id="hfYemekAdi" value="${rec ? rec.yemekAdi : ''}" placeholder="Örn: Mercimek Çorbası" required /></div>
        <div class="form-group"><label>Miktar (gr)</label><input type="text" id="hfMiktar" value="${rec ? rec.miktar : ''}" placeholder="200" /></div>
        <div class="form-group"><label>Saklama Sıcaklığı</label><input type="text" id="hfSaklama" value="${rec ? rec.saklamaSicakligi : '+4°C'}" placeholder="+4°C" /></div>
        <div class="form-group"><label>İmha Tarihi</label><input type="date" id="hfImha" value="${rec ? rec.imhaTarihi : ''}" /></div>
      </div>`;
  } else if (type === 'hijyen') {
    body.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="form-group"><label>Tarih</label><input type="date" id="hfTarih" value="${rec ? rec.tarih : today}" required /></div>
        <div class="form-group"><label>Alan</label><input type="text" id="hfAlan" value="${rec ? rec.alan : ''}" placeholder="Örn: Tezgah" required /></div>
        <div class="form-group" style="grid-column:span 2"><label>Yapılacak İş</label><input type="text" id="hfIs" value="${rec ? rec.yapilacakIs : ''}" placeholder="Örn: Temizlik ve dezenfeksiyon" required /></div>
        <div class="form-group"><label>Yapan Kişi</label><input type="text" id="hfYapan" value="${rec ? rec.yapanKisi : ''}" placeholder="Ad Soyad" required /></div>
        <div class="form-group"><label>Durum</label><select id="hfYapildiMi"><option value="1" ${rec && rec.yapildiMi ? 'selected' : ''}>Yapıldı</option><option value="0" ${rec && !rec.yapildiMi ? 'selected' : ''}>Yapılmadı</option></select></div>
        <div class="form-group" style="grid-column:span 2"><label>Not</label><input type="text" id="hfNot" value="${rec ? (rec.not || '') : ''}" placeholder="İsteğe bağlı" /></div>
      </div>`;
  }

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeHaccpModal() {
  document.getElementById('haccpModal').classList.remove('open');
  document.body.style.overflow = '';
  editingHaccpId = null;
  editingHaccpType = null;
}

function saveHaccpRecord(e) {
  e.preventDefault();
  const type = editingHaccpType;
  let rec = { id: editingHaccpId || Date.now(), type };

  if (type === 'sicaklik') {
    rec.tarih = document.getElementById('hfTarih').value;
    rec.saat = document.getElementById('hfSaat').value;
    rec.depoAd = document.getElementById('hfDepoAd').value.trim();
    rec.sicaklik = document.getElementById('hfSicaklik').value;
    rec.nem = document.getElementById('hfNem').value;
    rec.not = document.getElementById('hfNot').value.trim();
  } else if (type === 'numune') {
    rec.tarih = document.getElementById('hfTarih').value;
    rec.ogun = document.getElementById('hfOgun').value;
    rec.yemekAdi = document.getElementById('hfYemekAdi').value.trim();
    rec.miktar = document.getElementById('hfMiktar').value.trim();
    rec.saklamaSicakligi = document.getElementById('hfSaklama').value.trim();
    rec.imhaTarihi = document.getElementById('hfImha').value;
  } else if (type === 'hijyen') {
    rec.tarih = document.getElementById('hfTarih').value;
    rec.alan = document.getElementById('hfAlan').value.trim();
    rec.yapilacakIs = document.getElementById('hfIs').value.trim();
    rec.yapanKisi = document.getElementById('hfYapan').value.trim();
    rec.yapildiMi = document.getElementById('hfYapildiMi').value === '1';
    rec.not = document.getElementById('hfNot').value.trim();
  }

  if (type !== 'sicaklik') {
    delete rec.depoAd;
    delete rec.sicaklik;
  }

  if (editingHaccpId) {
    const idx = haccpRecords.findIndex(r => r.id === editingHaccpId);
    if (idx !== -1) haccpRecords[idx] = rec;
    showToast('Kayıt güncellendi.', 'success');
  } else {
    haccpRecords.push(rec);
    showToast('Kayıt eklendi.', 'success');
  }

  saveHaccpData();
  renderHaccp();
  closeHaccpModal();
}

function editHaccpRecord(type, id) {
  openHaccpModal(type, id);
}

function deleteHaccpRecord(type, id) { if (!requireAdmin()) return;
  if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
  haccpRecords = haccpRecords.filter(r => !(r.id === id && r.type === type));
  saveHaccpData();
  renderHaccp();
  showToast('Kayıt silindi.', 'success');
}



function printReport() {
  exportPDF();
}

function exportChartsPDF() {
  const printWin = window.open('', '_blank', 'width=1100,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  // Canvas'ları resim'e çevir
  const canvases = document.querySelectorAll('#content-charts canvas');
  const replacements = [];
  canvases.forEach(c => {
    const img = document.createElement('img');
    img.src = c.toDataURL();
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    replacements.push({ old: c.outerHTML, new: img.outerHTML });
  });
  let chartsHtml = document.getElementById('content-charts').innerHTML;
  replacements.forEach(r => { chartsHtml = chartsHtml.replace(r.old, r.new); });
  printWin.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>Grafikler - Atık Kontrol</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      h1 { font-size: 1.3rem; margin-bottom: 0.5rem; }
      .date { font-size: 0.8rem; color: #666; margin-bottom: 1.5rem; }
      .section-card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; page-break-inside: avoid; }
      .section-header h2 { font-size: 0.95rem; margin: 0 0 0.5rem; }
      canvas { max-width: 100%; height: auto !important; }
      .chart-empty { font-size: 0.8rem; color: #999; text-align: center; padding: 2rem; }
      .chart-year-filter { display: none; }
      .toolbar-actions { display: none; }
      .footer { text-align: center; font-size: 0.75rem; color: #999; margin-top: 2rem; border-top: 1px solid #ddd; padding-top: 0.5rem; }
    </style>
  </head><body>
    <h1>Grafikler - Atık Kontrol Yönetim Sistemi</h1>
    <div class="date">${new Date().toLocaleDateString('tr-TR')}</div>
    ${chartsHtml}
    <div class="footer">Atık Kontrol Yönetim Sistemi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
  </body></html>`);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => { try { printWin.print(); } catch(e) {} }, 500);
}

function exportDashboardPDF() {
  const printWin = window.open('', '_blank', 'width=1100,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  const content = document.getElementById('content-dashboard');
  const kpiHtml = content.querySelector('.kpi-grid').outerHTML;
  const cardsHtml = [...content.querySelectorAll(':scope > .section-card')].map(c => c.outerHTML).join('');
  printWin.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>Pano - Atık Kontrol</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      h1 { font-size: 1.3rem; margin-bottom: 0.3rem; }
      .date { font-size: 0.8rem; color: #666; margin-bottom: 1rem; }
      .kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-bottom: 1.5rem; }
      .kpi-card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; display: flex; align-items: center; gap: 0.8rem; page-break-inside: avoid; }
      .kpi-icon { width: 36px; height: 36px; flex-shrink: 0; }
      .kpi-label { font-size: 0.7rem; color: #666; font-weight: 600; text-transform: uppercase; }
      .kpi-value { font-size: 1.3rem; font-weight: 700; }
      .section-card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; page-break-inside: avoid; }
      .section-header h2 { font-size: 0.95rem; margin: 0 0 0.5rem; }
      .data-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
      .data-table th { background: #f5f5f5; padding: 0.4rem 0.5rem; text-align: left; }
      .data-table td { padding: 0.35rem 0.5rem; border-bottom: 1px solid #eee; }
      .toolbar, .kpi-trend, canvas, .btn, .badge { display: none; }
      .prod-day { border: 1px solid #ddd; border-radius: 8px; margin-bottom: 1rem; overflow: hidden; page-break-inside: avoid; }
      .prod-day-header { font-size: 0.85rem; font-weight: 700; padding: 0.5rem 0.75rem; background: #f5f5f5; border-bottom: 1px solid #ddd; display: flex; align-items: center; gap: 0.5rem; }
      .prod-day-header .prod-day-kisi { margin-left: auto; font-size: 0.7rem; color: #666; }
      .prod-day-body { padding: 0.5rem 0.75rem; }
      .prod-cesit-row { display: flex; gap: 0.5rem; }
      .prod-cesit-col { flex: 1; min-width: 120px; }
      .prod-cesit { font-weight: 600; font-size: 0.78rem; margin-bottom: 0.2rem; color: #333; white-space: nowrap; border-bottom: 1px solid #ddd; padding-bottom: 0.15rem; }
      .prod-ing { display: flex; gap: 0.25rem; font-size: 0.72rem; line-height: 1.6; color: #555; align-items: baseline; }
      .prod-num { width: 1.3rem; text-align: right; flex-shrink: 0; }
      .prod-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .prod-sep { width: 1.2rem; text-align: center; flex-shrink: 0; color: #999; }
      .prod-qty { width: 4.5rem; text-align: right; flex-shrink: 0; font-weight: 600; }
      .section-title { font-size: 0.9rem; font-weight: 700; margin: 0.5rem 0; color: #333; }
      .footer { text-align: center; font-size: 0.75rem; color: #999; margin-top: 2rem; border-top: 1px solid #ddd; padding-top: 0.5rem; }
    </style>
  </head><body>
    <h1>Yemekhane Atık Kontrol Paneli</h1>
    <div class="date">${new Date().toLocaleDateString('tr-TR')}</div>
    ${kpiHtml}
    ${cardsHtml}
    <div class="footer">Atık Kontrol Yönetim Sistemi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
  </body></html>`);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => { try { printWin.print(); } catch(e) {} }, 500);
}

function exportRecordsPDF() {
  const printWin = window.open('', '_blank', 'width=1100,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  const tableHtml = document.querySelector('#content-records .table-wrapper')?.outerHTML || '<p>Kayıt yok</p>';
  printWin.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>Kayıtlar - Atık Kontrol</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      h1 { font-size: 1.3rem; margin-bottom: 0.3rem; }
      .date { font-size: 0.8rem; color: #666; margin-bottom: 1rem; }
      .data-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
      .data-table th { background: #f5f5f5; padding: 0.4rem 0.5rem; text-align: left; white-space: nowrap; }
      .data-table td { padding: 0.35rem 0.5rem; border-bottom: 1px solid #eee; }
      .toolbar, .bulk-bar, .pagination, .btn, .empty-state svg { display: none; }
      .footer { text-align: center; font-size: 0.75rem; color: #999; margin-top: 2rem; border-top: 1px solid #ddd; padding-top: 0.5rem; }
    </style>
  </head><body>
    <h1>Tüm Kayıtlar</h1>
    <div class="date">${new Date().toLocaleDateString('tr-TR')}</div>
    ${tableHtml}
    <div class="footer">Atık Kontrol Yönetim Sistemi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
  </body></html>`);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => { try { printWin.print(); } catch(e) {} }, 500);
}

// ─── TABS ──────────────────────────────────────────────────────────────────────
async function restoreActiveTab() {
  const saved = localStorage.getItem('atik_kontrol_active_tab');
  if (saved && saved !== 'dashboard') {
    await switchTab(saved);
  }
}

async function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('content-' + name).classList.add('active');
  if (name === 'charts') drawAllCharts();
  if (name === 'report') renderReport();
  closeSidebar();
  if (name === 'menu') await renderMenu();
  if (name === 'haccp') loadHaccpData();
  if (name === 'yag') renderYagTable();
  if (name === 'ambalaj') renderAmbalajTable();
  const labels = { dashboard: 'Panel', menu: 'Menü', records: 'Kayıtlar', charts: 'Grafikler', report: 'Rapor', haccp: 'Gıda Güvenliği', yag: 'Atık Yağ', ambalaj: 'Ambalaj Atıkları' };
  document.getElementById('pageTitle').textContent = labels[name] || name;
  localStorage.setItem('atik_kontrol_active_tab', name);
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
    document.getElementById('fTarih').value = formatLocalDate(new Date());
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
  autoCalc();
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
  // Formül: (ÜretilenYemek - FireMiktarı - ToplamGeçiş) x Porsiyon / 1000
  // Örnek: (550 - 55 - 443) x 400 / 1000 = 20,80 kg
  const atik = Math.max(0, (yemek - fire - toplam) * porsiyon / 1000);
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
  // Formül: (ÜretilenYemek - FireMiktarı - ToplamGeçiş) x Porsiyon / 1000
  const atik = Math.max(0, (yemek - fire - toplam) * porsiyon / 1000);

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
  formModified = false;
  closeModal();
}

// ─── DELETE ────────────────────────────────────────────────────────────────────
function deleteRecord(id) { if (!requireAdmin()) return;
  if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
  records = records.filter(r => r.id !== id);
  selectedIds.delete(id);
  saveData();
  filteredRecords = [...records];
  renderAll();
  drawAllCharts();
  showToast('Kayıt silindi.', 'success');
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

function deleteSelected() { if (!requireAdmin()) return;
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
      const newRecords = [];
      imported.forEach(r => {
        if (r.id && existingIds.has(r.id)) {
          r.id = Date.now() + Math.floor(Math.random() * 10000);
        }
        newRecords.push(r);
      });
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
function clearAllData() { if (!requireAdmin()) return;
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

function exportData() {
  exportDataJSON();
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

function importFullBackup() { if (!requireAdmin()) return;
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
      if (data.gsheetConfig) {
        if (data.gsheetConfig.webappUrl && !gsheetConfig.webappUrl) {
          gsheetConfig.webappUrl = data.gsheetConfig.webappUrl;
        }
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
  renderTodaySummary();
  renderDataInfo();
  renderLastRecordsTable();
  renderRecordsTable();
  renderReport();
  renderSparklines();
  renderComparison();
}

function renderTodaySummary() {
  const el = document.getElementById('todaySummary');
  const body = document.getElementById('todaySummaryBody');
  if (!el || !body) return;
  if (records.length === 0) {
    body.innerHTML = `<div class="ts-item"><span class="ts-label">Henüz kayıt girilmedi</span></div>`;
    return;
  }
  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
  const todayRec = records.find(r => r.tarih === todayStr);
  if (!todayRec) {
    body.innerHTML = `<div class="ts-item"><span class="ts-label">Bugün henüz kayıt girilmedi</span></div>`;
    return;
  }
  const pct = records.length >= 2 ? ((todayRec.atik||0) / records.reduce((s,r) => s+(r.atik||0),0) * 100).toFixed(1) : '—';
  const avgAtik = records.length > 0 ? (records.reduce((s,r) => s+(r.atik||0),0) / records.length).toFixed(2) : '—';
  const atikStatus = (todayRec.atik||0) > parseFloat(avgAtik) * 1.2 ? 'bad' : (todayRec.atik||0) < parseFloat(avgAtik) * 0.8 ? 'good' : 'warn';
  body.innerHTML = `
    <div class="ts-item"><span class="ts-label">Üretim</span><span class="ts-value">${(todayRec.yemek||0).toLocaleString('tr-TR')}</span></div>
    <div class="ts-item"><span class="ts-label">Geçiş</span><span class="ts-value">${(todayRec.toplam||0).toLocaleString('tr-TR')}</span></div>
    <div class="ts-item"><span class="ts-label">Atık</span><span class="ts-value ${atikStatus}">${(todayRec.atik||0).toFixed(1)} kg</span></div>
    <div class="ts-item"><span class="ts-label">Porsiyon</span><span class="ts-value">${(todayRec.porsiyon||0)} gr</span></div>
    <div class="ts-item"><span class="ts-label">Atık Oranı</span><span class="ts-value warn">%${pct}</span></div>
    <div class="ts-item"><span class="ts-label">Ort. Atık</span><span class="ts-value">${avgAtik} kg</span></div>
  `;
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
  const first = dates[0];
  const last = dates[dates.length - 1];
  const fmt = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('tr-TR') : '—';
  const totalYemek = records.reduce((s, r) => s + (r.yemek || 0), 0);
  const totalAtik = records.reduce((s, r) => s + (r.atik || 0), 0);
  rangeEl.textContent = `${records.length} kayıt • ${fmt(first)} — ${fmt(last)} • ${totalYemek.toLocaleString('tr-TR')} üretim • ${totalAtik.toFixed(1)} kg atık`;
}

function getTrend(_current, arr, field) {
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
    document.getElementById('kpiBugunYemek').textContent = '—';
    document.getElementById('kpiBugunAtik').textContent = '—';
    document.getElementById('kpiHaccpAlarm').textContent = '0';
    renderTrend('trendAvgAtik', null);
    renderTrend('trendTotalAtik', null);
    return;
  }

  const totalAtik = records.reduce((s, r) => s + (r.atik || 0), 0);
  const avgAtik = totalAtik / n;
  document.getElementById('kpiAvgAtik').textContent = avgAtik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const lastRec = records[0];
  document.getElementById('kpiLastGecis').textContent = lastRec ? (lastRec.toplam || 0).toLocaleString('tr-TR') : '0';
  document.getElementById('kpiTotalAtik').textContent = totalAtik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  renderTrend('trendAvgAtik', getTrend(avgAtik, records, 'atik'), true);
  renderTrend('trendTotalAtik', getTrend(totalAtik, records, 'atik'), true);

  // Bugünkü Üretim & Atık
  const todayStr = formatLocalDate(new Date());
  const todayRec = records.find(r => r.tarih === todayStr);
  const elBugunYemek = document.getElementById('kpiBugunYemek');
  const elBugunAtik = document.getElementById('kpiBugunAtik');
  const elBugunAtikDurum = document.getElementById('kpiBugunAtikDurum');
  const elBugunYemekSub = document.getElementById('kpiBugunYemekSub');
  if (todayRec) {
    elBugunYemek.textContent = (todayRec.yemek || 0).toLocaleString('tr-TR');
    elBugunYemekSub.textContent = 'Geçiş: ' + (todayRec.toplam || 0).toLocaleString('tr-TR');
    elBugunAtik.textContent = (todayRec.atik || 0).toFixed(1) + ' kg';
    const avg = parseFloat(avgAtik);
    if (avg > 0 && (todayRec.atik||0) > avg * 1.2) {
      elBugunAtikDurum.innerHTML = '<span style="color:#ef4444;font-size:0.7rem;font-weight:600">▲ Ortalamanın üstünde</span>';
    } else if (avg > 0 && (todayRec.atik||0) < avg * 0.8) {
      elBugunAtikDurum.innerHTML = '<span style="color:#10b981;font-size:0.7rem;font-weight:600">▼ Ortalamanın altında</span>';
    } else {
      elBugunAtikDurum.innerHTML = '<span style="color:#f59e0b;font-size:0.7rem;font-weight:600">● Ortalamaya yakın</span>';
    }
  } else {
    elBugunYemek.textContent = '—';
    elBugunYemekSub.textContent = 'Bugün kayıt yok';
    elBugunAtik.textContent = '—';
    elBugunAtikDurum.innerHTML = '';
  }

  // HACCP Alarm: son 24 saatteki uygunsuz sıcaklıklar
  const alarmRecs = haccpRecords.filter(function(r) {
    if (r.type !== 'sicaklik') return false;
    if (!r.tarih || !r.sicaklik) return false;
    if (r.tarih !== todayStr) {
      var d = new Date(r.tarih + 'T00:00:00');
      var now = new Date();
      if (isNaN(d) || (now - d) > 86400000 * 2) return false;
    }
    var v = parseFloat(r.sicaklik);
    if (isNaN(v)) return false;
    var da = String(r.depoAd || '').toLowerCase();
    if (da.includes('dondurucu')) return v < -24 || v > -18;
    return v < 0 || v > 4;
  });
  var alarmCount = alarmRecs.length;
  document.getElementById('kpiHaccpAlarm').textContent = alarmCount;
  var alarmSub = document.getElementById('kpiHaccpAlarmSub');
  if (alarmCount > 0) {
    alarmSub.innerHTML = '<span style="color:#ef4444;font-weight:600">' + alarmCount + ' uyarı var</span>';
  } else {
    alarmSub.textContent = 'Tüm değerler uygun';
  }
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
    document.getElementById('emptyRecordsMsg').textContent = 'Gösterilecek kayıt bulunamadı.';
    renderPagination();
    return;
  }

  empty.style.display = 'none';
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

  const mealBadge = r.yemek_adi ? `<span class="meal-badge">${escapeHtml(r.yemek_adi)}</span>` : '';

  const safe = (v) => (v ?? 0);
  return `<tr class="${selectedIds.has(r.id) ? 'row-selected' : ''}">
    ${checkbox}
    <td>${dateStr}</td>
    <td>${safe(r.yemek).toLocaleString('tr-TR')}</td>
    <td>${safe(r.fire).toLocaleString('tr-TR')}</td>
    <td>${safe(r.turnike).toLocaleString('tr-TR')}</td>
    <td>${safe(r.personel).toLocaleString('tr-TR')}</td>
    <td class="td-gecis">${safe(r.toplam).toLocaleString('tr-TR')}</td>
    <td>${safe(r.porsiyon).toLocaleString('tr-TR')}</td>
    <td class="td-atik">${safe(r.atik).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
    <td>${safe(r.ogrenci).toLocaleString('tr-TR')}</td>
    <td>${mealBadge}</td>
    ${actions}
  </tr>`;

}

function renderProduction(_weekKey, _weekData, days) {
  const section = document.getElementById('productionSection');
  const yemekler = loadYemekler();

  const parseDishName = (val) => val.trim().split('\n')[0].replace(/ - \(.*/, '').trim();
  const findDish = (name) => {
    const lower = name.toLowerCase();
    const exact = yemekler.find(y => y.ad.toLowerCase() === lower);
    if (exact) return exact;
    return yemekler.find(y => {
      const yLower = y.ad.toLowerCase();
      return yLower.startsWith(lower) || lower.startsWith(yLower);
    });
  };
  const normBirim = (b) => {
    let s = (b || 'gr').toLowerCase().replace(/\s/g, '');
    if (/^g(ram|rams|ramaj)?$/.test(s)) return 'gr';
    if (/^l(itre|itr)?$/.test(s)) return 'lt';
    if (/^m(l|ili(litre)?)?$/.test(s)) return 'ml';
    return s;
  };
  const fmt = (total, birim) => {
    if (total <= 0) return '—';
    if (birim === 'gr') return total >= 1000 ? (Math.round(total / 10) / 100) + ' kg' : Math.round(total) + ' gr';
    if (birim === 'ml') return total >= 1000 ? (Math.round(total / 10) / 100) + ' lt' : Math.round(total) + ' ml';
    if (birim === 'lt') return (Math.round(total * 100) / 100) + ' lt';
    return Math.round(total) + ' ' + birim;
  };

  const hasAny = days.some(d => {
    for (let ci = 0; ci < 5; ci++) {
      const raw = d.data.yemekler[ci] || '';
      const name = parseDishName(raw);
      const dish = name ? findDish(name) : null;
      if (dish && dish.tarif && dish.tarif.length) return true;
    }
    return false;
  });
  if (!hasAny) { section.style.display = 'none'; renderWeeklyTotal([], days); return; }
  section.style.display = 'block';

  const wrapper = section.querySelector('.table-wrapper');
  let html = '';
  days.forEach(d => {
    const kisi = d.data.kisi || 0;
    html += `<div class="prod-day"><div class="prod-day-header"><span class="prod-day-label">${d.gun}</span><span class="prod-day-kisi">${kisi} kişi</span></div><div class="prod-day-body"><div class="prod-cesit-row">`;

    for (let ci = 0; ci < 5; ci++) {
      const raw = d.data.yemekler[ci] || '';
      const name = parseDishName(raw);
      if (!name) continue;
      const dish = findDish(name);

      html += `<div class="prod-cesit-col"><div class="prod-cesit">${ci + 1}. Çeşit: ${escapeHtml(name)}</div>`;

      if (dish && dish.tarif && dish.tarif.length) {
        dish.tarif.forEach((ing, idx) => {
          const miktarKisi = ing.miktar_kisi || ing.miktar || 0;
          const total = miktarKisi * kisi;
          const birim = normBirim(ing.birim);
          html += `<div class="prod-ing"><span class="prod-num">${idx + 1}.</span><span class="prod-name">${escapeHtml(ing.malzeme.trim())}</span><span class="prod-sep">—</span><span class="prod-qty">${fmt(total, birim)}</span></div>`;
        });
      }
      html += '</div>';
    }
    html += '</div></div></div>';
  });

  wrapper.innerHTML = html;

  // Weekly total
  const allDishes = [];
  days.forEach(d => {
    for (let ci = 0; ci < 5; ci++) {
      const raw = d.data.yemekler[ci] || '';
      const name = parseDishName(raw);
      const dish = name ? findDish(name) : null;
      if (dish && dish.tarif && dish.tarif.length && !allDishes.find(x => x.ad === dish.ad)) {
        allDishes.push(dish);
      }
    }
  });
  renderWeeklyTotal(allDishes, days);
}

function renderWeeklyTotal(dishEntries, days) {
  const section = document.getElementById('weeklyTotalSection');
  if (!section) return;

  const fmtTotal = (total, birim) => {
    if (total <= 0) return '—';
    if (birim === 'gr') return total >= 1000 ? (Math.round(total / 10) / 100) + ' kg' : Math.round(total) + ' gr';
    if (birim === 'ml') return total >= 1000 ? (Math.round(total / 10) / 100) + ' lt' : Math.round(total) + ' ml';
    if (birim === 'lt') return (Math.round(total * 100) / 100) + ' lt';
    return Math.round(total) + ' ' + birim;
  };

  const normBirim = (b) => {
    let s = (b || 'gr').toLowerCase().replace(/\s/g, '');
    if (/^g(ram|rams|ramaj)?$/.test(s)) return 'gr';
    if (/^l(itre|itr)?$/.test(s)) return 'lt';
    if (/^m(l|ili(litre)?)?$/.test(s)) return 'ml';
    return s;
  };

  // Aggregate across all dishes, per ingredient
  const agg = {};
  dishEntries.forEach(dish => {
    if (!dish.tarif) return;
    dish.tarif.forEach(ing => {
      const miktarKisi = ing.miktar_kisi || ing.miktar || 0;
      const birim = normBirim(ing.birim);
      const key = ing.malzeme.trim().toLowerCase() + '|' + birim;
      if (!agg[key]) agg[key] = { ad: ing.malzeme.trim(), birim, total: 0 };
      days.forEach((d, i) => {
        const kisi = d.data.kisi || 0;
        const adMatch = d.data.yemekler.find(y => {
          const t = y.trim().split('\n')[0].replace(/ - \(.*/, '').trim().toLowerCase();
          return t === dish.ad.toLowerCase() || t.startsWith(dish.ad.toLowerCase()) || dish.ad.toLowerCase().startsWith(t);
        });
        if (adMatch) agg[key].total += kisi * miktarKisi;
      });
    });
  });

  const entries = Object.values(agg);
  if (!entries.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  section.innerHTML = `<div class="weekly-total-card">
    <div class="weekly-total-header">Haftalık Toplam İhtiyaç Listesi</div>
    <div class="weekly-total-body">
      <div class="weekly-total-grid">${entries.map((e, idx) => {
        const total = e.total;
        if (total <= 0) return '';
        return `<div class="weekly-total-item"><span class="weekly-total-num">${idx + 1}.</span><span class="weekly-total-name">${escapeHtml(e.ad)}</span><span class="weekly-total-sep">—</span><span class="weekly-total-qty">${fmtTotal(total, e.birim)}</span></div>`;
      }).filter(Boolean).join('')}</div>
    </div>
  </div>`;
}

// ─── YEMEK LISTESI (DISH POOL) ─────────────────────────────────────────────────
function loadYemekler() {
  return yemeklerCache;
}

function saveYemekler(list) { if (!requireAdmin()) return;
  yemeklerCache = list;
  syncDishesToGSheets().catch(() => {});
}

function formatYemek(y) {
  let s = y.ad;
  if (y.kalori) s += ' - (' + y.kalori + ')';
  if (y.alerjen) s += '\n' + y.alerjen;
  return s;
}

function renderYemekListesi() {
  const container = document.getElementById('yemekListesiContainer');
  const list = loadYemekler();
  const query = (document.getElementById('yemekSearchInput').value || '').toLowerCase();
  const filtered = query ? list.filter(y => y.ad.toLowerCase().includes(query)) : list;

  if (!filtered.length) {
    if (query) {
      container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.85rem">"<strong>' + escapeHtml(query) + '</strong>" için eşleşen yemek bulunamadı.</div>';
    } else {
      container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.85rem">Henüz yemek eklenmemiş. "+ Yeni Yemek" butonuna tıklayarak ekleyin.</div>';
    }
    return;
  }

  container.innerHTML = `<table class="data-table" style="width:100%">
    <thead><tr><th style="width:35%">Yemek Adı</th><th style="width:15%">Kalori</th><th style="width:25%">Alerjen</th><th style="width:50px">Reçete</th><th style="width:60px">İşlem</th></tr></thead>
    <tbody>${filtered.map(y => `<tr>
      <td><strong>${escapeHtml(y.ad)}</strong></td>
      <td style="font-size:0.8rem">${escapeHtml(y.kalori || '')}</td>
      <td style="font-size:0.8rem;color:var(--text-muted)">${escapeHtml(y.alerjen || '')}</td>
      <td style="text-align:center">${(y.tarif && y.tarif.length) ? `<span title="${y.tarif.length} malzeme" style="cursor:help;font-size:0.75rem;color:var(--accent-cyan)">${y.tarif.length} ürün</span>` : `<span style="font-size:0.7rem;color:var(--text-muted)">—</span>`}</td>
      <td style="white-space:nowrap">
        <button class="btn-icon btn-sm" onclick="editYemek('${escapeHtml(y.id)}')" title="Düzenle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon btn-sm" onclick="deleteYemek('${escapeHtml(y.id)}')" title="Sil">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </td>
    </tr>`).join('')}</tbody>
  </table>`;
}

let editingYemekId = null;

let yfTarif = [];

function showYemekForm(editId) {
  const container = document.getElementById('yemekFormContainer');
  let ad = '', kalori = '', alerjen = '';
  yfTarif = [];
  editingYemekId = null;

  if (editId) {
    const list = loadYemekler();
    const y = list.find(i => i.id === editId);
    if (y) {
      ad = y.ad; kalori = y.kalori || ''; alerjen = y.alerjen || '';
      yfTarif = (y.tarif || []).map(t => ({ ...t }));
      editingYemekId = editId;
    }
  }

  renderYemekForm(ad, kalori, alerjen);
  container.style.display = 'block';
  document.getElementById('yf_ad').focus();
}

function renderYemekForm(ad, kalori, alerjen) {
  const container = document.getElementById('yemekFormContainer');
  const tarifRows = yfTarif.map((t, i) => `
    <tr>
      <td><input type="text" class="yf-malzeme" value="${escapeHtml(t.malzeme)}" placeholder="Malzeme adı" data-idx="${i}" style="width:100%" /></td>
      <td style="width:80px"><input type="number" class="yf-miktar" value="${t.miktar_kisi || ''}" step="0.1" min="0" data-idx="${i}" style="width:70px;text-align:center" placeholder="0" /></td>
      <td style="width:60px">
        <select class="yf-birim" data-idx="${i}" style="width:55px;padding:0.3rem;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:0.75rem">
          <option value="gr" ${(t.birim||'gr')==='gr'?'selected':''}>gr</option>
          <option value="adet" ${t.birim==='adet'?'selected':''}>adet</option>
          <option value="lt" ${t.birim==='lt'?'selected':''}>lt</option>
          <option value="ml" ${t.birim==='ml'?'selected':''}>ml</option>
        </select>
      </td>
      <td style="width:30px"><button class="btn-icon btn-sm" onclick="yfTarifSil(${i})" style="color:var(--danger)">✕</button></td>
    </tr>
  `).join('');

  container.innerHTML = `<div style="padding:0.75rem;background:var(--bg-card);border-radius:var(--radius-sm);border:1px solid var(--border)">
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:end;margin-bottom:0.75rem">
      <div style="flex:2;min-width:140px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">Yemek Adı</label>
        <input type="text" id="yf_ad" value="${escapeHtml(ad)}" placeholder="Örn: �?EHRIYE ÇORBASI" style="width:100%" />
      </div>
      <div style="flex:1;min-width:100px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">Kalori</label>
        <input type="text" id="yf_kalori" value="${escapeHtml(kalori)}" placeholder="Örn: 160 KCAL" style="width:100%" />
      </div>
      <div style="flex:1;min-width:120px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">Alerjen</label>
        <input type="text" id="yf_alerjen" value="${escapeHtml(alerjen)}" placeholder="Örn: Gluten İçeren Tahıllar" style="width:100%" />
      </div>
      <div style="display:flex;gap:0.3rem;align-items:end;padding-bottom:1px">
        <button class="btn btn-primary btn-sm" onclick="saveYemekForm()">Kaydet</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('yemekFormContainer').style.display='none'">İptal</button>
      </div>
    </div>

    <div style="border-top:1px solid var(--border);padding-top:0.75rem">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
        <strong style="font-size:0.82rem">Malzemeler</strong>
        <span style="font-size:0.7rem;color:var(--text-muted)">(kişi başı gram)</span>
      </div>
      <table style="width:100%;font-size:0.8rem">
        <thead><tr><th style="text-align:left">Malzeme</th><th style="width:80px;text-align:center">/kişi</th><th style="width:60px">Birim</th><th style="width:30px"></th></tr></thead>
        <tbody id="yfTarif_tbody">${tarifRows}</tbody>
      </table>
      <button class="btn btn-ghost btn-sm" onclick="yfTarifEkle()" style="margin-top:0.4rem">+ Malzeme Ekle</button>
    </div>
  </div>`;
}

function yfTarifEkle() {
  yfTarif.push({ malzeme: '', miktar_kisi: 0, birim: 'gr' });
  const ad = document.getElementById('yf_ad').value;
  const kalori = document.getElementById('yf_kalori').value;
  const alerjen = document.getElementById('yf_alerjen').value;
  renderYemekForm(ad, kalori, alerjen);
}

function yfTarifSil(idx) {
  yfTarif.splice(idx, 1);
  const ad = document.getElementById('yf_ad').value;
  const kalori = document.getElementById('yf_kalori').value;
  const alerjen = document.getElementById('yf_alerjen').value;
  renderYemekForm(ad, kalori, alerjen);
}

function saveYemekForm() { if (!requireAdmin()) return;
  const ad = document.getElementById('yf_ad').value.trim();
  if (!ad) { showToast('Yemek adı zorunludur.', 'error'); return; }
  const kalori = document.getElementById('yf_kalori').value.trim();
  const alerjen = document.getElementById('yf_alerjen').value.trim();

  // Read ingredients from DOM
  const malzemeInputs = document.querySelectorAll('.yf-malzeme');
  const miktarInputs = document.querySelectorAll('.yf-miktar');
  const birimSelects = document.querySelectorAll('.yf-birim');
  const tarif = [];
  malzemeInputs.forEach((el, i) => {
    const malzeme = el.value.trim();
    if (malzeme) {
      tarif.push({
        malzeme: malzeme,
        miktar_kisi: parseFloat(miktarInputs[i]?.value) || 0,
        birim: birimSelects[i]?.value || 'gr'
      });
    }
  });

  let list = loadYemekler();

  if (editingYemekId) {
    const y = list.find(i => i.id === editingYemekId);
    if (y) { y.ad = ad; y.kalori = kalori; y.alerjen = alerjen; y.tarif = tarif; }
  } else {
    list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2,6), ad, kalori, alerjen, tarif });
  }

  saveYemekler(list);
  document.getElementById('yemekFormContainer').style.display = 'none';
  editingYemekId = null;
  renderYemekListesi();
  showToast('Yemek kaydedildi.', 'success');
}

function editYemek(id) {
  showYemekForm(id);
}

function deleteYemek(id) { if (!requireAdmin()) return;
  if (!confirm('Bu yemeği silmek istediğinize emin misiniz?')) return;
  let list = loadYemekler();
  list = list.filter(y => y.id !== id);
  saveYemekler(list);
  renderYemekListesi();
  showToast('Yemek silindi.', 'success');
}

function openYemekModal() {
  document.getElementById('yemekModal').classList.add('show');
  document.getElementById('yemekSearchInput').value = '';
  editingYemekId = null;
  document.getElementById('yemekFormContainer').style.display = 'none';
  renderYemekListesi();
  // Background'da Google Sheets'ten taze veri çek (cache güncelle)
  syncDishesFromGSheets().then(updated => { if (updated) renderYemekListesi(); });
}
function closeYemekModal() {
  document.getElementById('yemekModal').classList.remove('show');
}

// -- Google Sheets dish sync --
async function syncDishesFromGSheets() {
  const url = getMenuUrl();
  if (!url) return false;
  try {
    const res = await fetch(url + '?sheet=Yemek%20Listesi');
    const json = await res.json();
    if (json.data && Array.isArray(json.data)) {
      const list = json.data.filter(d => d.ad && d.ad.trim()).map(d => {
        let tarif = [];

        // 1. JSON tarif sütunu varsa onu dene
        if (d.tarif) {
          try { tarif = JSON.parse(d.tarif); } catch (e) {}
        }

        // 2. Yoksa düz sütun formatını dene: ürün N, miktar N, birim N
        if (!tarif.length) {
          const keys = Object.keys(d);
          for (let n = 1; n <= 20; n++) {
            const urunKey = keys.find(k => k.toLowerCase().replace(/\s/g,'') === ('ürün'+n).toLowerCase());
            const miktarKey = keys.find(k => k.toLowerCase().replace(/\s/g,'') === ('miktar'+n).toLowerCase());
            const birimKey = keys.find(k => k.toLowerCase().replace(/\s/g,'') === ('birim'+n).toLowerCase());
            if (urunKey && d[urunKey] && String(d[urunKey]).trim()) {
              const miktar = miktarKey ? parseFloat(d[miktarKey]) || 0 : 0;
              let b = birimKey ? String(d[birimKey] || 'gr').trim().toLowerCase().replace(/\s/g,'') : 'gr';
              if (b === 'g' || b === 'gr' || b === 'gram' || b === 'grams' || b === 'gramaj') b = 'gr';
              else if (b === 'l' || b === 'lt' || b === 'litre' || b === 'litr') b = 'lt';
              else if (b === 'ml' || b === 'mil' || b === 'mililitre' || b === 'mili') b = 'ml';
              const birim = b;
              tarif.push({ malzeme: String(d[urunKey]).trim(), miktar_kisi: miktar, birim: birim });
            } else break;
          }
        }

        return {
          id: String(d.id || Date.now().toString(36) + Math.random().toString(36).slice(2,6)),
          ad: String(d.ad || '').trim(),
          kalori: String(d.kalori || '').trim(),
          alerjen: String(d.alerjen || '').trim(),
          tarif: tarif
        };
      });
      yemeklerCache = list;
      // Menü sekmesi açıksa ürün tablosunu güncelle
      if (document.getElementById('productionSection')) refreshMenuProduction();
      return true;
    }
    return false;
  } catch (_) { return false; }
}

async function syncDishesToGSheets() {
  const url = getMenuUrl();
  if (!url) return;
  try {
    const list = loadYemekler();
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'saveDishes', dishes: list })
    });
  } catch (_) {}
}

// -- Menu Google Sheet sync --
async function fetchMenuData() {
  const url = getMenuUrl();
  if (!url) return {};
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'loadMenu' })
    });
    const json = await res.json();
    if (json.menuData) {
      const parsed = JSON.parse(json.menuData);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    }
    return {};
  } catch (_) { return {}; }
}

async function saveMenuData(allData) {
  const url = getMenuUrl();
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'saveMenu', menuData: JSON.stringify(allData) })
    });
    const json = await res.json();
    if (!json.success) showToast('Menü kaydedilemedi: ' + (json.error || ''), 'error');
  } catch (_) { showToast('Menü kaydedilemedi (bağlantı hatası).', 'error'); }
}

// -- Live production refresh --
function refreshMenuProduction() {
  if (!document.getElementById('mk_0')) return; // menü henüz render edilmemiş
  const monday = getWeekStartDate(menuWeekOffset);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const weekKey = formatDateStr(monday) + '-' + formatDateStr(friday);
  const days = GUNLER.map((gun, i) => {
    const tarih = new Date(monday);
    tarih.setDate(monday.getDate() + i);
    const key = formatDateStr(tarih);
    const yemekler = [];
    const notlar = [];
    for (let c = 0; c < 5; c++) {
      const el = document.getElementById('m' + c + '_' + i);
      yemekler.push(el ? el.value : '');
    }
    for (let n = 0; n < 10; n++) {
      const el = document.getElementById('mn_' + n + '_' + i);
      if (el) notlar.push(el.value);
    }
    const kisi = parseInt(document.getElementById('mk_' + i).value) || 0;
    return { gun, key, data: { yemekler, kisi, notlar } };
  });
  const wd = {};
  days.forEach(d => { wd[d.key] = d.data; });
  renderProduction(weekKey, wd, days);
}

// -- Autocomplete in menu cells --
let activeDishTextarea = null;
let dishSuggestionsEl = null;
let dishAutocompleteInited = false;

function initDishAutocomplete() {
  if (dishAutocompleteInited) return;
  dishAutocompleteInited = true;
  dishSuggestionsEl = document.createElement('div');
  dishSuggestionsEl.className = 'dish-suggestions';
  dishSuggestionsEl.style.display = 'none';
  document.body.appendChild(dishSuggestionsEl);

  document.addEventListener('focusin', function(e) {
    if (e.target.tagName === 'TEXTAREA' && e.target.id && e.target.id.startsWith('m') && e.target.id.includes('_')) {
      activeDishTextarea = e.target;
      showDishDropdown(e.target);
    }
  });

  document.addEventListener('input', function(e) {
    if (e.target === activeDishTextarea) {
      showDishDropdown(e.target);
    }
    if (e.target.id && e.target.id.startsWith('m') && e.target.id.includes('_')) {
      refreshMenuProduction();
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.target !== activeDishTextarea) return;
    const items = dishSuggestionsEl.querySelectorAll('.dish-suggestion-item');
    if (!items.length) return;
    const active = dishSuggestionsEl.querySelector('.dish-suggestion-item.active');
    let idx = -1;
    if (active) idx = Array.from(items).indexOf(active);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (idx + 1) % items.length;
      items.forEach(el => el.classList.remove('active'));
      items[next].classList.add('active');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (idx - 1 + items.length) % items.length;
      items.forEach(el => el.classList.remove('active'));
      items[prev].classList.add('active');
    } else if (e.key === 'Enter') {
      if (active) {
        e.preventDefault();
        selectDishItem(active.dataset.id);
      }
    } else if (e.key === 'Escape') {
      hideDishDropdown();
    }
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.dish-suggestions') && e.target !== activeDishTextarea) {
      hideDishDropdown();
    }
  });
}

function showDishDropdown(textarea) {
  const list = loadYemekler();
  if (!list.length) { hideDishDropdown(); return; }

  const val = textarea.value.split('\n')[0].toLowerCase();
  const filtered = val ? list.filter(y => y.ad.toLowerCase().includes(val)) : list;
  if (!filtered.length && val) { hideDishDropdown(); return; }

  const rect = textarea.getBoundingClientRect();
  dishSuggestionsEl.innerHTML = filtered.map(y =>
    `<div class="dish-suggestion-item" data-id="${escapeHtml(y.id)}">${escapeHtml(y.ad)} <span style="font-size:0.7rem;opacity:0.6">${escapeHtml(y.kalori || '')}</span></div>`
  ).join('');
  dishSuggestionsEl.style.display = 'block';
  dishSuggestionsEl.style.top = (rect.bottom + window.scrollY + 2) + 'px';
  dishSuggestionsEl.style.left = rect.left + 'px';
  dishSuggestionsEl.style.width = Math.max(rect.width, 250) + 'px';

  dishSuggestionsEl.querySelectorAll('.dish-suggestion-item').forEach(el => {
    el.addEventListener('mousedown', function(e) {
      e.preventDefault();
      selectDishItem(this.dataset.id);
    });
  });
}

function selectDishItem(id) {
  if (!activeDishTextarea) return;
  const list = loadYemekler();
  const y = list.find(i => i.id === id);
  if (y) {
    activeDishTextarea.value = formatYemek(y);
    activeDishTextarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  hideDishDropdown();
  activeDishTextarea.focus();
}

function hideDishDropdown() {
  if (dishSuggestionsEl) dishSuggestionsEl.style.display = 'none';
}

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ─── REPORT ────────────────────────────────────────────────────────────────────
function renderReport() {
  const n = records.length;

  if (n === 0) {
    ['rTotalKayit','rTotalYemek','rTotalFireKar','rTotalYemekSonrasi','rTotalTurnike',
     'rTotalGecis','rAvgPorsiyon','rMaxWeekGecis','rTotalAtik','rAvgAtik','rTotalOgrenci',
     'rMaxAtik','rMinAtik','rTrendAtik','rTrendGecis','rCarbonFootprint'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('reportTbody').innerHTML = '';
    return;
  }

  const totalYemek = records.reduce((s,r) => s+(r.yemek||0), 0);
  const totalTurnike = records.reduce((s,r) => s+(r.turnike||0), 0);
  const totalPersonel = records.reduce((s,r) => s+(r.personel||0), 0);
  const totalGecis = records.reduce((s,r) => s+(r.toplam||0), 0);
  const avgPorsiyon = records.reduce((s,r) => s+(r.porsiyon||0), 0) / n;
  const totalAtik = records.reduce((s,r) => s+(r.atik||0), 0);
  const totalOgrenci = records.reduce((s,r) => s+(r.ogrenci||0), 0);
  const atikValues = records.map(r => r.atik || 0);
  const maxAtik = Math.max(...atikValues);
  const minAtik = Math.min(...atikValues);
  const maxAtikRec = records.find(r => (r.atik||0) === maxAtik);
  const minAtikRec = records.find(r => (r.atik||0) === minAtik);
  const maxAtikDate = maxAtikRec ? new Date(maxAtikRec.tarih + 'T00:00:00').toLocaleDateString('tr-TR') : '';
  const minAtikDate = minAtikRec ? new Date(minAtikRec.tarih + 'T00:00:00').toLocaleDateString('tr-TR') : '';

  // Trend: son 7 gün vs önceki 7 gün
  const sortedByDate = [...records].sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  const last7 = sortedByDate.slice(0, 7);
  const prev7 = sortedByDate.slice(7, 14);
  const avgAtikLast7 = last7.length ? last7.reduce((s, r) => s+(r.atik||0), 0) / last7.length : 0;
  const avgAtikPrev7 = prev7.length ? prev7.reduce((s, r) => s+(r.atik||0), 0) / prev7.length : 0;
  const avgGecisLast7 = last7.length ? last7.reduce((s, r) => s+(r.toplam||0), 0) / last7.length : 0;
  const avgGecisPrev7 = prev7.length ? prev7.reduce((s, r) => s+(r.toplam||0), 0) / prev7.length : 0;
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

  // Karbon Ayak İzi = toplam atık (kg) × 2.5 kg CO₂e/kg
  const carbonFootprint = totalAtik * 2.5;
  const carbonEl = document.getElementById('rCarbonFootprint');
  if (carbonEl) {
    carbonEl.innerHTML = `${carbonFootprint.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg CO₂<br><span class="report-subdate">atık × 2.5 CO₂e/kg</span>`;
  }

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

  renderWasteByFoodType();
}

function renderWasteByFoodType() {
  const section = document.getElementById('wasteByFoodType');
  const body = document.getElementById('wasteByFoodTypeBody');
  if (!section || !body) return;
  const filtered = records.filter(r => r.yemek_adi && r.yemek_adi.trim());
  if (filtered.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  const groups = {};
  let totalAtik = 0;
  filtered.forEach(r => {
    const key = r.yemek_adi.trim();
    if (!groups[key]) groups[key] = { ad: key, toplamAtik: 0, kayitSayisi: 0, toplamGecis: 0 };
    groups[key].toplamAtik += r.atik || 0;
    groups[key].kayitSayisi++;
    groups[key].toplamGecis += r.toplam || 0;
    totalAtik += r.atik || 0;
  });
  const sorted = Object.values(groups).sort((a, b) => b.toplamAtik - a.toplamAtik);
  let html = '<table class="data-table" style="min-width:500px"><thead><tr><th>Yemek Türü</th><th>Kayıt Sayısı</th><th>Toplam Atık (kg)</th><th>Atık Oranı</th><th>Kişi Başı Atık (kg)</th></tr></thead><tbody>';
  sorted.forEach(g => {
    const pct = totalAtik > 0 ? ((g.toplamAtik / totalAtik) * 100).toFixed(1) : '—';
    const kisiBasi = g.toplamGecis > 0 ? (g.toplamAtik / g.toplamGecis).toFixed(3) : '—';
    html += `<tr><td><strong>${g.ad}</strong></td><td>${g.kayitSayisi}</td><td>${g.toplamAtik.toFixed(1)}</td><td>%${pct}</td><td>${kisiBasi}</td></tr>`;
  });
  html += '</tbody></table>';
  body.innerHTML = html;
}

// ─── CHART UTILITY ───────────────────────────────────────────────────────────
function fmt(v) {
  // Trailing zero'ları at, tam sayıysa .00 gösterme
  return v.toFixed(2).replace(/\.?0+$/, '');
}

// ─── CHARTS (Chart.js) ──────────────────────────────────────────────────────────────────

function renderChartYearFilter() {
  const container = document.getElementById('chartYearFilter');
  if (!container) return;
  const years = getAvailableYears();
  var html = '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
  html += '<label style="font-size:0.8rem;color:var(--text-muted)">Yıl:</label>';
  html += '<select onchange="setChartYear(this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;background:var(--bg-card);color:var(--text)">';
  html += '<option value="all" ' + (chartYearFilter === 'all' ? 'selected' : '') + '>Tümü</option>';
  years.forEach(function(y) {
    var sel = chartYearFilter === String(y) ? ' selected' : '';
    html += '<option value="' + y + '"' + sel + '>' + y + '</option>';
  });
  html += '</select>';
  html += '<span style="font-size:0.8rem;color:var(--text-muted);margin-left:4px">Ay:</span>';
  var months = ['Tümü','Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  months.forEach(function(m, i) {
    var active = i === chartMonthFilter ? ' active' : '';
    html += '<button class="year-btn month-btn' + active + '" data-month="' + i + '" onclick="setChartMonth(' + i + ')">' + m + '</button>';
  });
  html += '</div>';
  container.innerHTML = html;
}

const chartInstances = new Map();
const chartValueLabelPlugin = {
  id: 'valueLabels',
  afterDraw(chart) {
    if (!chart.options.plugins.valueLabels) return;
    const ctx = chart.ctx;
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      meta.data.forEach((bar, idx) => {
        const val = ds.data[idx];
        if (val === undefined || val === null || isNaN(val)) return;
        ctx.fillStyle = chart.options.plugins?.legend?.labels?.color || '#334155';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const display = val >= 100 ? Math.round(val).toString() : val >= 10 ? val.toFixed(1) : val.toFixed(2);
        ctx.fillText(display, bar.x, bar.y - 7);
      });
    });
  }
};

let _chartVer = 0;
function drawAllCharts() {
  _chartVer++;
  renderChartYearFilter();

  let chartRecords = records;
  if (chartYearFilter !== 'all') {
    chartRecords = records.filter(r => {
      if (!r.tarih) return false;
      const y = new Date(r.tarih + 'T00:00:00').getFullYear();
      return y === Number(chartYearFilter);
    });
  }

  const emptyIds = ['chartAtikEmpty','chartYemekEmpty','chartTurnikeEmpty','chartAylikEmpty','chartFarkEmpty','chartAtikOranEmpty','chartOgrenciEmpty','chartKarbonEmpty','chartAtikPerKisiEmpty','chartHaftalikGecisEmpty','chartHaccpAylikEmpty'];
  const canvasIds = ['canvasAtik','canvasYemek','canvasTurnike','canvasAylik','canvasFark','canvasAtikOran','canvasOgrenci','canvasKarbon','canvasAtikPerKisi','canvasHaftalikGecis','canvasHaccpAylik'];

  if (chartRecords.length === 0) {
  emptyIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'block';
    });
  canvasIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    return;
  }

  emptyIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  canvasIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
  });

  const sorted = [...chartRecords].sort((a,b) => new Date(a.tarih) - new Date(b.tarih));

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

  const chartYears = chartYearFilter !== 'all'
    ? [Number(chartYearFilter)]
    : [...new Set(sorted.map(r => new Date(r.tarih + 'T00:00:00').getFullYear()))].sort();
  let allMonthLabels = [];
  chartYears.forEach(y => {
    for (let m = 1; m <= 12; m++) allMonthLabels.push(m + '/' + y);
  });
  const getMonthVal = (label, field) => (monthlyData[label] ? monthlyData[label][field] : 0);

  // Destroy old Chart.js instances
  chartInstances.forEach(c => c.destroy());
  chartInstances.clear();

  function makeChart(id, labels, datasets, extra) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const parent = canvas.parentElement;
    const w = Math.min(parent.offsetWidth || 400, parent.clientWidth || 400);
    const h = Math.min(parent.offsetHeight || 280, parent.clientHeight || 280);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const colors = {
      text: isDark ? '#e2e8f0' : '#1e293b',
      grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      tooltipBg: '#000000',
      tooltipBorder: 'rgba(255,255,255,0.2)',
    };
    const chartType = extra?.type || 'bar';
    const chart = new Chart(ctx, {
      type: chartType,
      data: {
        labels,
        datasets: datasets.map(d => {
          const dsType = d.type || chartType;
          const isLineDS = dsType === 'line';
          return {
            type: dsType,
            label: d.label,
            data: d.data,
            backgroundColor: isLineDS ? d.color + '20' : (d.dashed ? d.color + '60' : d.color),
            borderColor: d.color,
            borderWidth: isLineDS ? (d.dashed ? 2 : 2) : (d.dashed ? 1 : 0),
            borderDash: d.dashed ? (isLineDS ? [6, 4] : [3, 3]) : undefined,
            borderRadius: isLineDS ? 0 : 6,
            barPercentage: isLineDS ? undefined : 0.85,
            categoryPercentage: isLineDS ? undefined : 0.8,
            pointRadius: isLineDS ? (d.dashed ? 0 : 3) : undefined,
            pointHoverRadius: isLineDS ? (d.dashed ? 0 : 5) : undefined,
            fill: isLineDS ? (d.dashed ? false : true) : undefined,
            tension: isLineDS ? 0.3 : undefined,
            spanGaps: isLineDS ? true : undefined,
          };
        })
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        devicePixelRatio: Math.max(window.devicePixelRatio || 1, 2),
        animation: { duration: 900, easing: 'easeOutCubic' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: colors.text, font: { size: 13, family: 'Inter', weight: '500' } } },
          tooltip: {
            backgroundColor: colors.tooltipBg,
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            borderColor: colors.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            caretPadding: 4,
            caretSize: 5,
            bodyFont: { size: 11, family: 'Inter' },
            titleFont: { size: 11, family: 'Inter', weight: 'bold' },
            callbacks: {
              label: ctx => ' ' + ctx.dataset.label + ': ' + (ctx.parsed.y >= 100 ? Math.round(ctx.parsed.y) : ctx.parsed.y >= 10 ? ctx.parsed.y.toFixed(1) : ctx.parsed.y.toFixed(2))
            }
          },
          valueLabels: extra && extra.showValues !== false,
        },
        scales: {
          x: {
            ticks: {
              color: colors.text, font: { size: 12, family: 'Inter' },
              maxRotation: labels.length > 20 ? 90 : 45,
              autoSkip: false,
              maxTicksLimit: labels.length,
            },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            ticks: { color: colors.text, font: { size: 12, family: 'Inter' } },
            grid: { color: colors.grid }
          }
        },
        onClick: (e, elements) => {
          if (elements.length > 0 && extra && extra.onClick) {
            extra.onClick(labels[elements[0].index]);
          }
        }
      },
      plugins: [chartValueLabelPlugin]
    });
    chartInstances.set(id, chart);

    // Force tooltip styles via MutationObserver (Chart.js overrides inline styles on hover)
    const forceTooltip = () => {
      const tooltipEl = document.getElementById('chartjs-tooltip-' + chart.id);
      if (tooltipEl) {
        tooltipEl.style.setProperty('background', '#000000', 'important');
        tooltipEl.style.setProperty('color', '#ffffff', 'important');
        tooltipEl.style.setProperty('opacity', '1', 'important');
      }
    };
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes.length) {
          for (const node of m.addedNodes) {
            if (node.id && node.id.startsWith('chartjs-tooltip')) {
              const el = node;
              el.style.setProperty('background', '#000000', 'important');
              el.style.setProperty('color', '#ffffff', 'important');
              el.style.setProperty('opacity', '1', 'important');
              el.style.setProperty('transition', 'none', 'important');
              el.style.setProperty('backdrop-filter', 'blur(20px)', 'important');
              el.style.setProperty('-webkit-backdrop-filter', 'blur(20px)', 'important');
              el.style.setProperty('box-shadow', '0 12px 40px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.3)', 'important');
              el.style.setProperty('border', '1px solid rgba(255,255,255,0.2)', 'important');
              el.style.setProperty('z-index', '99999', 'important');
              el.style.setProperty('transform', 'translateZ(0)', 'important');
            }
          }
        }
        if (m.type === 'attributes' && m.attributeName === 'style' && m.target.id && m.target.id.startsWith('chartjs-tooltip')) {
          m.target.style.setProperty('background', '#000000', 'important');
          m.target.style.setProperty('background-color', '#000000', 'important');
          m.target.style.setProperty('color', '#ffffff', 'important');
          m.target.style.setProperty('opacity', '1', 'important');
          m.target.style.setProperty('z-index', '99999', 'important');
          m.target.style.setProperty('position', 'absolute', 'important');
          m.target.style.setProperty('transform', 'translateZ(0)', 'important');
          m.target.style.setProperty('backdrop-filter', 'blur(20px)', 'important');
        }
      }
    });
    observer.observe(parent, { childList: true, subtree: false, attributes: true, attributeFilter: ['style'] });

    // Initial attempt
    setTimeout(forceTooltip, 100);
    setTimeout(forceTooltip, 500);

    return chart;
  }

  function getRecordsByLabel(label) {
    const parts = label.split('/');
    if (parts.length === 2) {
      const ay = parseInt(parts[0]), yil = parseInt(parts[1]);
      if (!isNaN(ay) && !isNaN(yil)) {
        return records.filter(r => {
          const d = new Date(r.tarih + 'T00:00:00');
          return !isNaN(d) && d.getMonth() + 1 === ay && d.getFullYear() === yil;
        });
      }
    }
    const range = label.split(' - ');
    if (range.length === 2) {
      const parseDM = (s) => { const p = s.split('.'); return p.length === 2 ? { d: parseInt(p[0]), m: parseInt(p[1]) } : null; };
      const s = parseDM(range[0]), e = parseDM(range[1]);
      if (s && e) {
        return records.filter(r => {
          const d = new Date(r.tarih + 'T00:00:00');
          if (isNaN(d)) return false;
          const md = d.getMonth() + 1, dd = d.getDate();
          if (s.m === e.m) return md === s.m && dd >= s.d && dd <= e.d;
          return (md > s.m || (md === s.m && dd >= s.d)) && (md < e.m || (md === e.m && dd <= e.d));
        });
      }
    }
    return null;
  }
  const clickHandler = (label) => { const r = getRecordsByLabel(label); if (r) showChartDetailModal(label, r); };

  // --- Charts ---
  makeChart('canvasAtik', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'atik')), color: '#f97316', label: 'Aylik Atik (kg)' }], { onClick: clickHandler });
  makeChart('canvasYemek', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'yemek')), color: '#6366f1', label: 'Aylik Uretim Sayisi' }], { onClick: clickHandler });
  makeChart('canvasTurnike', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'toplam')), color: '#10b981', label: 'Aylik Turnike Gecisi' }], { onClick: clickHandler });

  const prevYearAtik = allMonthLabels.map(m => {
    const [ay, yil] = m.split('/');
    return getMonthVal(ay + '/' + (parseInt(yil) - 1), 'atik');
  });
  const hasPrevYear = prevYearAtik.some(v => v > 0);
  const gecisTrendData = allMonthLabels.map(m => getMonthVal(m, 'toplam'));
  let trendLine = [];
  if (gecisTrendData.length > 1) {
    const n = gecisTrendData.length;
    const meanX = (n - 1) / 2;
    const meanY = gecisTrendData.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - meanX) * (gecisTrendData[i] - meanY);
      den += (i - meanX) ** 2;
    }
    const slope = den !== 0 ? num / den : 0;
    const intercept = meanY - slope * meanX;
    trendLine = gecisTrendData.map((_, i) => Math.max(0, slope * i + intercept));
  }
  const aylikSets = [
    { data: allMonthLabels.map(m => getMonthVal(m, 'yemek')), color: '#6366f1', label: 'Aylik Uretim' },
    { data: allMonthLabels.map(m => getMonthVal(m, 'toplam')), color: '#22d3ee', label: 'Aylik Gecis' },
    { data: allMonthLabels.map(m => getMonthVal(m, 'atik')), color: '#f59e0b', label: 'Aylik Atik (kg)' },
  ];
  if (hasPrevYear) aylikSets.push({ data: prevYearAtik, color: '#f59e0b', label: 'Gecen Yil Atik (kg)', dashed: true });
  if (trendLine.length > 0) aylikSets.push({ data: trendLine, color: '#ef4444', label: 'Gecis Trendi', type: 'line', dashed: true });
  makeChart('canvasAylik', allMonthLabels, aylikSets, { onClick: clickHandler, type: 'bar' });

  const farkData = allMonthLabels.map(m => getMonthVal(m, 'yemek') - getMonthVal(m, 'toplam'));
  makeChart('canvasFark', allMonthLabels, [{ data: farkData, color: '#8b5cf6', label: 'Uretim - Gecis Farki' }], { onClick: clickHandler });

  const aylikOran = allMonthLabels.map(m => {
    const y = getMonthVal(m, 'yemek'), a = getMonthVal(m, 'atik');
    return y > 0 ? (a / y * 100) : 0;
  });
  makeChart('canvasAtikOran', allMonthLabels, [{ data: aylikOran, color: '#a855f7', label: 'Aylik Atik Orani %' }], { onClick: clickHandler });
  makeChart('canvasOgrenci', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'ogrenci')), color: '#a855f7', label: 'Aylik Ogrenci Sayisi' }], { onClick: clickHandler });

  const karbonData = allMonthLabels.map(m => getMonthVal(m, 'atik') * 2.5);
  makeChart('canvasKarbon', allMonthLabels, [{ data: karbonData, color: '#22c55e', label: 'Karbon Ayak Izi (kg CO2)' }], { onClick: clickHandler });

  const atikPerKisi = allMonthLabels.map(m => {
    const t = getMonthVal(m, 'toplam'), a = getMonthVal(m, 'atik');
    return t > 0 ? a / t : 0;
  });
  makeChart('canvasAtikPerKisi', allMonthLabels, [{ data: atikPerKisi, color: '#d946ef', label: 'Kisi Basi Atik (kg/kisi)' }], { onClick: clickHandler });

  // Weekly
  const weeklyData = {};
  sorted.forEach(r => {
    const d = new Date(r.tarih + 'T00:00:00');
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d); monday.setDate(diff);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const fmt = (date) => date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
    const label = fmt(monday) + ' - ' + fmt(sunday);
    if (!weeklyData[label]) weeklyData[label] = 0;
    weeklyData[label] += r.toplam;
  });
  const weekLabels = Object.keys(weeklyData);
  const weekValues = weekLabels.map(l => weeklyData[l]);
  if (weekLabels.length > 0) {
    makeChart('canvasHaftalikGecis', weekLabels, [{ data: weekValues, color: '#0ea5e9', label: 'Haftalik Gecis' }], { onClick: clickHandler });
  }

  // --- HACCP Sicaklik Chart (her depo ayri kart) ---
  function haccpFilter(r) {
    if (r.type !== 'sicaklik') return false;
    if (!r.tarih) return false;
    var d = new Date(r.tarih + 'T00:00:00');
    if (chartYearFilter !== 'all' && d.getFullYear() !== Number(chartYearFilter)) return false;
    if (chartMonthFilter > 0 && d.getMonth() + 1 !== chartMonthFilter) return false;
    return true;
  }
  var sicaklikKayitlari = haccpRecords.filter(haccpFilter);
  var container = document.getElementById('haccpSicaklikChartContainer');
  if (!container) return;
  container.innerHTML = '';
  if (sicaklikKayitlari.length > 0) {
    var gunlukVeri = {};
    sicaklikKayitlari.forEach(function(r) {
      if (!r.tarih) return;
      var ad = r.depoAd || 'Bilinmeyen';
      if (!gunlukVeri[r.tarih]) gunlukVeri[r.tarih] = {};
      if (!gunlukVeri[r.tarih][ad]) gunlukVeri[r.tarih][ad] = [];
      var v = parseFloat(r.sicaklik);
      if (!isNaN(v)) gunlukVeri[r.tarih][ad].push(v);
    });
    var gunlukTarihler = Object.keys(gunlukVeri).sort();
    var tumDepolar = [];
    gunlukTarihler.forEach(function(t) { Object.keys(gunlukVeri[t]).forEach(function(d) { if (tumDepolar.indexOf(d) === -1) tumDepolar.push(d); }); });
    tumDepolar.sort(function(a, b) {
      var na = parseInt(a.match(/\d+/) || 0);
      var nb = parseInt(b.match(/\d+/) || 0);
      return na - nb;
    });
    var sicaklikLabels = gunlukTarihler.map(function(t) {
      var p = t.split('-');
      return p.length === 3 ? p[2] + '/' + p[1] : t;
    });
    var depoRenkPaleti = ['#6366f1', '#f97316', '#10b981', '#a855f7', '#22d3ee', '#f59e0b', '#ef4444', '#d946ef'];
    tumDepolar.forEach(function(ad, idx) {
      var card = document.createElement('div');
      card.className = 'section-card chart-card chart-card-full';
      var header = document.createElement('div');
      header.className = 'section-header';
      header.innerHTML = '<h2>' + ad + ' - Sıcaklık Geçmişi</h2>';
      card.appendChild(header);
      var area = document.createElement('div');
      area.className = 'chart-area';
      var canvas = document.createElement('canvas');
      var cid = 'canvasSicaklik_' + idx;
      canvas.id = cid;
      area.appendChild(canvas);
      card.appendChild(area);
      container.appendChild(card);
      var depoData = {
        data: gunlukTarihler.map(function(t) {
          var vals = (gunlukVeri[t] && gunlukVeri[t][ad]) || [];
          if (vals.length === 0) return null;
          var sum = vals.reduce(function(a, b) { return a + b; }, 0);
          return Math.round(sum / vals.length * 10) / 10;
        }),
        color: depoRenkPaleti[idx % depoRenkPaleti.length],
        label: ad
      };
      var thresholds = [
        { data: sicaklikLabels.map(function() { return 4; }), color: '#ef4444', label: 'Üst Limit (+4°C)', dashed: true },
        { data: sicaklikLabels.map(function() { return 0; }), color: '#22c55e', label: 'Alt Limit (0°C)', dashed: true },
      ];
      if (ad.toLowerCase().includes('dondurucu')) {
        thresholds.push({ data: sicaklikLabels.map(function() { return -18; }), color: '#3b82f6', label: 'Dondurucu Üst (-18°C)', dashed: true });
      }
      makeChart(cid, sicaklikLabels, [depoData].concat(thresholds), { type: 'line', showValues: false });
    });
  }

  // --- Aylik Ortalama Depo Sicaklik Bar Chart (her depo ayri cubuk) ---
  var aylikSicaklikEmpty = document.getElementById('chartHaccpAylikEmpty');
  var aylikSicaklikCanvas = document.getElementById('canvasHaccpAylik');
  var aylikSicaklikKayitlari = haccpRecords.filter(haccpFilter);
  if (aylikSicaklikKayitlari.length > 0) {
    if (aylikSicaklikEmpty) aylikSicaklikEmpty.style.display = 'none';
    if (aylikSicaklikCanvas) aylikSicaklikCanvas.style.display = 'block';
    var aylikGruplar = {};
    aylikSicaklikKayitlari.forEach(function(r) {
      if (!r.tarih) return;
      var d = new Date(r.tarih + 'T00:00:00');
      var ayKey = (d.getMonth() + 1) + '/' + d.getFullYear();
      if (!aylikGruplar[ayKey]) aylikGruplar[ayKey] = {};
      var ad = r.depoAd || 'Bilinmeyen';
      if (!aylikGruplar[ayKey][ad]) aylikGruplar[ayKey][ad] = [];
      aylikGruplar[ayKey][ad].push(parseFloat(r.sicaklik));
    });
    var aylikAyLabels = Object.keys(aylikGruplar).sort(function(a, b) {
      var pa = a.split('/'), pb = b.split('/');
      return parseInt(pa[1]) - parseInt(pb[1]) || parseInt(pa[0]) - parseInt(pb[0]);
    });
    var aylikDepoIsimleri = [];
    aylikAyLabels.forEach(function(ay) {
      Object.keys(aylikGruplar[ay]).forEach(function(ad) {
        if (aylikDepoIsimleri.indexOf(ad) === -1) aylikDepoIsimleri.push(ad);
      });
    });
    aylikDepoIsimleri.sort(function(a, b) {
      var na = parseInt(a.match(/\d+/) || 0);
      var nb = parseInt(b.match(/\d+/) || 0);
      return na - nb;
    });
    var depoRenkler2 = ['#6366f1', '#f97316', '#10b981', '#a855f7', '#22d3ee', '#f59e0b', '#ef4444', '#d946ef'];
    var aylikDatasets = aylikDepoIsimleri.map(function(ad, idx) {
      return {
        data: aylikAyLabels.map(function(ay) {
          var vals = (aylikGruplar[ay] && aylikGruplar[ay][ad]) || [];
          if (vals.length === 0) return null;
          var sum = vals.reduce(function(a, b) { return a + b; }, 0);
          return Math.round(sum / vals.length * 10) / 10;
        }),
        color: depoRenkler2[idx % depoRenkler2.length],
        label: ad
      };
    });
    makeChart('canvasHaccpAylik', aylikAyLabels, aylikDatasets, { type: 'bar', showValues: true });
  } else {
    if (aylikSicaklikEmpty) aylikSicaklikEmpty.style.display = 'block';
    if (aylikSicaklikCanvas) aylikSicaklikCanvas.style.display = 'none';
  }

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
function lightenColor(hex, amount) {
  if (!hex || typeof hex !== 'string') return 'rgb(180,180,180)';
  let h = hex;
  if (!h.startsWith('#')) h = '#' + h;
  if (h.length === 4) {
    h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  const num = parseInt(h.slice(1), 16);
  if (isNaN(num)) return hex;
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r},${g},${b})`;
}
function hexToRgba(hex, a) {
  const num = parseInt(hex.slice(1), 16);
  const r = num >> 16, g = (num >> 8) & 0xff, b = num & 0xff;
  return `rgba(${r},${g},${b},${a})`;
}

function showChartDetailModal(title, records) {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modal');
  const header = modal.querySelector('.modal-header h3');
  const footer = modal.querySelector('.modal-footer');
  if (header) header.textContent = title;
  const body = modal.querySelector('.form-grid');
  if (!body) return;
  if (records.length === 0) {
    body.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-dim)">Bu dönem için kayıt bulunamadı.</div>';
  } else {
    body.innerHTML = `<div style="overflow-x:auto;max-height:400px;overflow-y:auto">
      <table class="data-table" style="min-width:400px">
        <thead><tr><th>Tarih</th><th>Üretim</th><th>Geçiş</th><th>Atık</th><th>Öğrenci</th><th>Yemek Türü</th></tr></thead>
        <tbody>${records.slice(0, 100).map(r => `<tr>
          <td>${new Date(r.tarih + 'T00:00:00').toLocaleDateString('tr-TR')}</td>
          <td>${r.yemek || '—'}</td>
          <td>${r.toplam || '—'}</td>
          <td>${(r.atik||0).toFixed(1)}</td>
          <td>${r.ogrenci || '—'}</td>
          <td>${r.yemek_adi || '—'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  }
  if (footer) footer.innerHTML = '<button class="btn btn-primary" onclick="closeModal()">Kapat</button>';
  overlay.style.display = 'flex';
}

async function renderMenu() {
  const monday = getWeekStartDate(menuWeekOffset);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const weekKey = formatDateStr(monday) + '-' + formatDateStr(friday);
  const weekLabel = `${formatDateStrTR(monday)} - ${formatDateStrTR(friday)} MENÜ LİSTESİ`;

  document.getElementById('menuWeekLabel').textContent = weekLabel;
  document.getElementById('menuTitle').textContent = weekLabel;

  const allData = await fetchMenuData();
  const weekData = allData[weekKey] || {};

  // Gün verilerini topla
  const days = GUNLER.map((gun, i) => {
    const tarih = new Date(monday);
    tarih.setDate(monday.getDate() + i);
    const key = formatDateStr(tarih);
    var dd = weekData[key] || { yemekler: ['','','','',''], kisi: 0, notlar: [] };
    while (dd.notlar.length < 10) dd.notlar.push('');
    const dayData = dd;
    return { gun, key, data: dayData };
  });

  // Başlık satırı
  const thead = document.getElementById('menuThead');
  thead.innerHTML = `<tr>
    <th style="width:100px">Çeşit</th>
    ${days.map(d => `<th>${escapeHtml(d.gun)}<br><span style="font-size:0.65rem;font-weight:400;opacity:0.7">${escapeHtml(d.key)}</span></th>`).join('')}
  </tr>`;

  // Cache henüz dolmamışsa 500ms sonra tekrar dene
  if (!yemeklerCache.length) {
    if (window._menuRetryTimer) clearTimeout(window._menuRetryTimer);
    window._menuRetryTimer = setTimeout(refreshMenuProduction, 500);
  }

  // Gövde: her çeşit için bir satır + kişi sayısı satırı
  const cesitler = ['1. Çeşit', '2. Çeşit', '3. Çeşit', '4. Çeşit', '5. Çeşit'];
  const tbody = document.getElementById('menuTbody');
  tbody.innerHTML = cesitler.map((label, ci) => {
    return `<tr>
      <td><strong>${label}</strong></td>
      ${days.map((d, di) => {
        const val = escapeHtml(d.data.yemekler[ci] || '');
        return `<td><textarea id="m${ci}_${di}" placeholder="${escapeHtml(label)}" rows="3">${val}</textarea></td>`;
      }).join('')}
    </tr>`;
  }).join('') + `<tr>
    <td><strong>Kişi Sayısı</strong></td>
    ${days.map((d, di) => {
      return `<td><input type="number" class="kisi-input" id="mk_${di}" value="${Number(d.data.kisi) || 0}" min="0" placeholder="0" /></td>`;
    }).join('')}
  </tr>` + Array.from({length: 10}, (_, ni) => `<tr>
    <td><strong>Not ${ni + 1}</strong></td>
    ${days.map((d, di) => {
      const val = escapeHtml((d.data.notlar && d.data.notlar[ni]) || '');
      return `<td><textarea class="note-input" id="mn_${ni}_${di}" rows="1" placeholder="...">${val}</textarea></td>`;
    }).join('')}
  </tr>`).join('');
  renderProduction(weekKey, weekData, days);
  applyViewerRestrictions();
}

// ─── MENU HELPERS ──────────────────────────────────────────────────────────
const GUNLER = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
let menuWeekOffset = 0;

function formatDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function formatDateStrTR(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

function getWeekStartDate(offset) {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) + offset * 7;
  const monday = new Date(now);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

async function saveWeeklyMenu() { if (!requireAdmin()) return;
  const monday = getWeekStartDate(menuWeekOffset);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const weekKey = formatDateStr(monday) + '-' + formatDateStr(friday);
  const allData = await fetchMenuData();
  const weekData = {};
  GUNLER.forEach((_, i) => {
    const tarih = new Date(monday);
    tarih.setDate(monday.getDate() + i);
    const key = formatDateStr(tarih);
    const yemekler = [];
    for (let c = 0; c < 5; c++) {
      const el = document.getElementById('m' + c + '_' + i);
      yemekler.push(el ? el.value : '');
    }
    const notlar = [];
    for (let n = 0; n < 10; n++) {
      const el = document.getElementById('mn_' + n + '_' + i);
      notlar.push(el ? el.value : '');
    }
    const kisi = parseInt(document.getElementById('mk_' + i).value) || 0;
    weekData[key] = { yemekler, kisi, notlar };
  });
  allData[weekKey] = weekData;
  await saveMenuData(allData);
  showToast('Menü kaydedildi.', 'success');
}

async function shiftMenuWeek(delta) {
  menuWeekOffset += delta;
  await renderMenu();
}

function clearWeeklyMenu() { if (!requireAdmin()) return;
  if (!confirm('Bu haftanın menüsünü temizlemek istediğinize emin misiniz?')) return;
  const monday = getWeekStartDate(menuWeekOffset);
  GUNLER.forEach((_, i) => {
    for (let c = 0; c < 5; c++) {
      const el = document.getElementById('m' + c + '_' + i);
      if (el) el.value = '';
    }
    for (let n = 0; n < 10; n++) {
      const el = document.getElementById('mn_' + n + '_' + i);
      if (el) el.value = '';
    }
    const el = document.getElementById('mk_' + i);
    if (el) el.value = '0';
  });
  refreshMenuProduction();
  showToast('Menü temizlendi.', 'success');
}

async function exportMenuJSON() {
  const allData = await fetchMenuData();
  const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `menu_${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Menü JSON olarak indirildi.', 'success');
}

function importMenuJSON(event) { if (!requireAdmin()) return;
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      const data = JSON.parse(ev.target.result);
      await saveMenuData(data);
      await renderMenu();
      showToast('Menü yüklendi.', 'success');
    } catch (err) {
      showToast('Menü yükleme hatası: ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
  event.target.value = '';
}

// ─── ATIK YAG (WASTE OIL) ────────────────────────────────────────────────────
const YAG_STORAGE_KEY = 'atik_kontrol_yag';
let yagRecords = [];
let editingYagId = null;

function loadYagData() {
  try {
    const stored = localStorage.getItem(YAG_STORAGE_KEY);
    yagRecords = stored ? JSON.parse(stored) : [];
  } catch (_) { yagRecords = []; }
}

function saveYagData() {
  try { localStorage.setItem(YAG_STORAGE_KEY, JSON.stringify(yagRecords)); } catch (_) {}
}

function renderYagTable() {
  const tbody = document.getElementById('yagTbody');
  const table = document.getElementById('yagTable');
  const empty = document.getElementById('emptyStateYag');
  const badge = document.getElementById('yagBadge');

  badge.textContent = yagRecords.length + ' kayıt';

  if (yagRecords.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  table.style.display = 'table';

  const sorted = [...yagRecords].sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  tbody.innerHTML = sorted.map(r => {
    const dateStr = r.tarih ? new Date(r.tarih + 'T00:00:00').toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
    return `<tr>
      <td>${dateStr}</td>
      <td>${escapeHtml(r.makbuzNo || '—')}</td>
      <td>${escapeHtml(r.tur || '—')}</td>
      <td>${(r.miktar || 0).toFixed(1)}</td>
      <td>${escapeHtml(r.not || '—')}</td>
      <td>
        <button class="btn-icon" onclick="editYagRecord(${r.id})" title="Düzenle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon" onclick="deleteYagRecord(${r.id})" title="Sil" style="color:var(--danger)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function openYagModal(id) {
  editingYagId = id || null;
  const overlay = document.getElementById('yagModal');
  const title = document.getElementById('yagModalTitle');
  const form = document.getElementById('yagForm');

  form.reset();
  document.getElementById('yfTarih').value = formatLocalDate(new Date());

  if (id) {
    const rec = yagRecords.find(r => r.id === id);
    if (!rec) return;
    title.textContent = 'Atık Yağ Kaydını Düzenle';
    document.getElementById('yfTarih').value = rec.tarih;
    document.getElementById('yfMakbuz').value = rec.makbuzNo || '';
    document.getElementById('yfTur').value = rec.tur || '';
    document.getElementById('yfMiktar').value = rec.miktar || '';
    document.getElementById('yfNot').value = rec.not || '';
  } else {
    title.textContent = 'Yeni Atık Yağ Kaydı';
  }

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeYagModal() {
  document.getElementById('yagModal').classList.remove('open');
  document.body.style.overflow = '';
  editingYagId = null;
}

function saveYagRecord(e) {
  e.preventDefault();

  const rec = {
    id: editingYagId || Date.now(),
    tarih: document.getElementById('yfTarih').value,
    makbuzNo: document.getElementById('yfMakbuz').value.trim(),
    tur: document.getElementById('yfTur').value,
    miktar: parseFloat(document.getElementById('yfMiktar').value) || 0,
    not: document.getElementById('yfNot').value.trim()
  };

  if (editingYagId) {
    const idx = yagRecords.findIndex(r => r.id === editingYagId);
    if (idx !== -1) yagRecords[idx] = rec;
    showToast('Atık yağ kaydı güncellendi.', 'success');
  } else {
    yagRecords.push(rec);
    showToast('Atık yağ kaydı eklendi.', 'success');
  }

  saveYagData();
  renderYagTable();
  closeYagModal();
}

function editYagRecord(id) { openYagModal(id); }

function deleteYagRecord(id) {
  if (!confirm('Bu atık yağ kaydını silmek istediğinize emin misiniz?')) return;
  yagRecords = yagRecords.filter(r => r.id !== id);
  saveYagData();
  renderYagTable();
  showToast('Atık yağ kaydı silindi.', 'success');
}

// ─── AMBALAJ ATIKLARI ────────────────────────────────────────────────────
const AMBALAJ_STORAGE_KEY = 'atik_kontrol_ambalaj';
let ambalajRecords = [];
let editingAmbalajId = null;

function loadAmbalajData() {
  try {
    const stored = localStorage.getItem(AMBALAJ_STORAGE_KEY);
    ambalajRecords = stored ? JSON.parse(stored) : [];
  } catch (_) { ambalajRecords = []; }
}

function saveAmbalajData() {
  try { localStorage.setItem(AMBALAJ_STORAGE_KEY, JSON.stringify(ambalajRecords)); } catch (_) {}
}

function renderAmbalajTable() {
  const tbody = document.getElementById('ambalajTbody');
  const table = document.getElementById('ambalajTable');
  const empty = document.getElementById('emptyStateAmbalaj');
  const badge = document.getElementById('ambalajBadge');

  badge.textContent = ambalajRecords.length + ' kayıt';

  if (ambalajRecords.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  table.style.display = 'table';

  const sorted = [...ambalajRecords].sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  tbody.innerHTML = sorted.map(r => {
    const dateStr = r.tarih ? new Date(r.tarih + 'T00:00:00').toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
    return `<tr>
      <td>${dateStr}</td>
      <td>${escapeHtml(r.tur || '—')}</td>
      <td>${(r.miktar || 0).toFixed(1)}</td>
      <td>${escapeHtml(r.not || '—')}</td>
      <td>
        <button class="btn-icon" onclick="editAmbalajRecord(${r.id})" title="Düzenle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon" onclick="deleteAmbalajRecord(${r.id})" title="Sil" style="color:var(--danger)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function openAmbalajModal(id) {
  editingAmbalajId = id || null;
  const overlay = document.getElementById('ambalajModal');
  const title = document.getElementById('ambalajModalTitle');
  const form = document.getElementById('ambalajForm');

  form.reset();
  document.getElementById('afTarih').value = formatLocalDate(new Date());

  if (id) {
    const rec = ambalajRecords.find(r => r.id === id);
    if (!rec) return;
    title.textContent = 'Ambalaj Atığı Kaydını Düzenle';
    document.getElementById('afTarih').value = rec.tarih;
    document.getElementById('afTur').value = rec.tur || '';
    document.getElementById('afMiktar').value = rec.miktar || '';
    document.getElementById('afNot').value = rec.not || '';
  } else {
    title.textContent = 'Yeni Ambalaj Atığı Kaydı';
  }

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeAmbalajModal() {
  document.getElementById('ambalajModal').classList.remove('open');
  document.body.style.overflow = '';
  editingAmbalajId = null;
}

function saveAmbalajRecord(e) {
  e.preventDefault();

  const rec = {
    id: editingAmbalajId || Date.now(),
    tarih: document.getElementById('afTarih').value,
    tur: document.getElementById('afTur').value,
    miktar: parseFloat(document.getElementById('afMiktar').value) || 0,
    not: document.getElementById('afNot').value.trim()
  };

  if (editingAmbalajId) {
    const idx = ambalajRecords.findIndex(r => r.id === editingAmbalajId);
    if (idx !== -1) ambalajRecords[idx] = rec;
    showToast('Ambalaj atığı kaydı güncellendi.', 'success');
  } else {
    ambalajRecords.push(rec);
    showToast('Ambalaj atığı kaydı eklendi.', 'success');
  }

  saveAmbalajData();
  renderAmbalajTable();
  closeAmbalajModal();
}

function editAmbalajRecord(id) { openAmbalajModal(id); }

function deleteAmbalajRecord(id) {
  if (!confirm('Bu ambalaj atığı kaydını silmek istediğinize emin misiniz?')) return;
  ambalajRecords = ambalajRecords.filter(r => r.id !== id);
  saveAmbalajData();
  renderAmbalajTable();
  showToast('Ambalaj atığı kaydı silindi.', 'success');
}

function exportMenuPDF() {
  const printWin = window.open('', '_blank', 'width=1100,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  // Klonla ve input değerlerini attribute'a yaz (outerHTML için)
  var clone = document.querySelector('#content-menu .section-card');
  if (!clone) { printWin.document.write('<p>Menü yok</p>'); printWin.document.close(); return; }
  clone = clone.cloneNode(true);
  clone.querySelectorAll('input').forEach(function(inp) { if (inp.value) inp.setAttribute('value', inp.value); });
  clone.querySelectorAll('textarea').forEach(function(ta) { ta.textContent = ta.value; });
  const menuHtml = clone.outerHTML;
  printWin.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>Haftalık Menü</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      h1 { font-size: 1.3rem; margin-bottom: 0.3rem; }
      .date { font-size: 0.8rem; color: #666; margin-bottom: 1rem; }
      .data-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
      .data-table th { background: #f5f5f5; padding: 0.4rem 0.5rem; text-align: left; }
      .data-table td { padding: 0.35rem 0.5rem; border-bottom: 1px solid #eee; }
      .menu-date-nav, .btn, .toolbar-actions, .menu-hint { display: none; }
      .prod-day { border: 1px solid #ddd; border-radius: 10px; margin-bottom: 0.8rem; overflow: hidden; page-break-inside: avoid; background: #fff; }
      .prod-day-header { font-size: 0.88rem; font-weight: 700; padding: 0.45rem 0.8rem; background: #f5f5f5; border-bottom: 1px solid #ddd; display: flex; align-items: center; gap: 0.5rem; }
      .prod-day-header .prod-day-label { color: #555; }
      .prod-day-header .prod-day-kisi { margin-left: auto; font-size: 0.7rem; color: #666; }
      .prod-day-body { padding: 0.5rem 0.8rem; overflow-x: auto; }
      .prod-cesit-row { display: flex; gap: 0.75rem; flex-wrap: nowrap; }
      .prod-cesit-col { flex: 1; min-width: 0; display: grid; grid-template-columns: 1.3rem 1fr 1.2rem 4.5rem; gap: 0 0.1rem; padding: 0.35rem 0.4rem; border-radius: 6px; }
      .prod-cesit { grid-column: 1 / -1; font-weight: 700; font-size: 0.78rem; margin: 0 0 0.2rem; padding: 0 0 0.2rem; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 2px solid #aaa; }
      .prod-ing { display: contents; font-size: 0.72rem; line-height: 1.65; color: #555; }
      .prod-num { text-align: right; color: #888; font-weight: 500; }
      .prod-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .prod-sep { text-align: center; color: #bbb; }
      .prod-qty { text-align: right; font-weight: 600; color: #333; }
      .weekly-total-card { border: 1px solid #ddd; border-radius: 10px; margin-top: 0.8rem; overflow: hidden; background: #fff; page-break-inside: avoid; }
      .weekly-total-header { font-size: 0.88rem; font-weight: 700; padding: 0.45rem 0.8rem; background: #f5f5f5; border-bottom: 1px solid #ddd; color: #333; }
      .weekly-total-body { padding: 0.5rem 0.8rem; }
      .weekly-total-grid { display: grid; grid-template-columns: 1.3rem 1fr 1.2rem 4.5rem; max-width: 500px; }
      .weekly-total-item { display: contents; font-size: 0.75rem; line-height: 1.8; white-space: nowrap; }
      .weekly-total-num { text-align: right; color: #888; font-weight: 500; }
      .weekly-total-name { overflow: hidden; text-overflow: ellipsis; color: #333; }
      .weekly-total-sep { text-align: center; color: #bbb; }
      .weekly-total-qty { text-align: right; font-weight: 600; color: #333; }
      .footer { text-align: center; font-size: 0.75rem; color: #999; margin-top: 2rem; border-top: 1px solid #ddd; padding-top: 0.5rem; }
    </style>
  </head><body>
    <h1>Haftalık Menü Listesi</h1>
    <div class="date">${new Date().toLocaleDateString('tr-TR')}</div>
    ${menuHtml}
    <div class="footer">Yemekhane Menü ve Atık Yönetim Sistemi</div>
  </body></html>`);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => { try { printWin.print(); } catch(e) {} }, 500);
}
