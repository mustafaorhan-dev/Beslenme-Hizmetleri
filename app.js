/* =============================================
   ATIK KONTROL YÖNETİM SİSTEMİ - APP LOGIC
   ============================================= */

'use strict';

// ─── STATE ───────────────────────────────────────────────────────────────────
let records = [];
let editingId = null;
let filteredRecords = [];
let yemeklerCache = [];
let unitPricesCache = [];
let weeklySummaryOffset = 0;
let dailySummaryOffset = 0;
let hcSelectedYear = null;   // Harcama menüsünde seçili yıl (null => kayıtlardan türetilir)
let hcSelectedMonth = null;  // Harcama menüsünde seçili ay (null => Tüm Yıl, 0-11 => belirli ay)
let hcTablePage = 0;         // Harcama tablosunda aktif sayfa

// ─── SUPABASE ────────────────────────────────────────────────────────────────
const SUPABASE_URL = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.supabaseUrl : '';
const SUPABASE_ANON_KEY = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.supabaseAnonKey : '';
var supabaseClient = null;
try {
  if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storage: window.localStorage
      }
    });
  }
} catch (_) {}

// ─── SUPABASE AUTH STATE ──────────────────────────────────────────────────────
let supabaseSession = null;

async function initSupabaseAuth() {
  if (!supabaseClient) return;
  // Get current session
  var { data: { session } } = await supabaseClient.auth.getSession();
  supabaseSession = session;

  // Listen for auth state changes
  supabaseClient.auth.onAuthStateChange((event, session) => {
    supabaseSession = session;
    if (event === 'SIGNED_IN' && session) {
      handleSupabaseLogin(session);
    } else if (event === 'SIGNED_OUT') {
      handleSupabaseLogout();
    }
  });
}

async function handleSupabaseLogin(session) {
  if (!session || !session.user) return;
  var userId = session.user.id;
  try {
    var { data, error } = await supabaseClient.from('user_roles')
      .select('role, display_name')
      .eq('auth_user_id', userId)
      .single();
    if (error || !data) {
      // user_roles'da kayıt yoksa legacy kullanıcı listesinden bulup otomatik at
      // (böylece Supabase'de "kullanıcı rolleri" boş kalmaz)
      var email = session.user.email || '';
      var username = email.split('@')[0].toLowerCase();
      var cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
      var legacyUser = null;
      if (cfg.users && Array.isArray(cfg.users)) {
        legacyUser = cfg.users.find(function(u) { return (u.username || '').toLowerCase() === username; }) || null;
      }
      var role = legacyUser ? (legacyUser.role || 'asci') : 'asci';
      var displayName = legacyUser ? (legacyUser.displayName || username) : (session.user.email || 'Kullanıcı');
      try {
        await supabaseClient.from('user_roles').insert({ auth_user_id: userId, role: role, display_name: displayName });
      } catch (_) {}
      applyLoginState(role, displayName, true);
      logIslem('login', displayName + ' Supabase Auth ile giriş yaptı');
      return;
    }
    var role = data.role || 'asci';
    var displayName = data.display_name || session.user.email || 'Kullanıcı';
    applyLoginState(role, displayName, true);
    logIslem('login', displayName + ' Supabase Auth ile giriş yaptı');
  } catch (_) {}
}

function applyLoginState(role, displayName, isSupabaseAuth) {
  sessionStorage.setItem('atik_kontrol_role', role);
  sessionStorage.setItem('atik_kontrol_display_name', displayName);
  if (isSupabaseAuth) sessionStorage.setItem('atik_kontrol_supabase_auth', 'true');
  else sessionStorage.removeItem('atik_kontrol_supabase_auth');
  sessionStorage.setItem('atik_kontrol_login_time', String(Date.now()));
  localStorage.setItem('atik_kontrol_last_login', new Date().toISOString());
  document.getElementById('loginOverlay').classList.add('hidden');
  document.body.setAttribute('data-role', role);
  document.getElementById('roleBadge').textContent = displayName;
  renderAdminPanelBtn();
  applyRolePermissions();
  if (window._loginResolve) { window._loginResolve(); window._loginResolve = null; }
}

function handleSupabaseLogout() {
  sessionStorage.removeItem('atik_kontrol_role');
  sessionStorage.removeItem('atik_kontrol_display_name');
  sessionStorage.removeItem('atik_kontrol_supabase_auth');
}

// ─── REMOTE PASSWORD HASH CACHE (legacy) ──────────────────────────────────────
let remoteHashes = { adminHash: null };

async function syncPasswordHashesFromRemote() {
  // Legacy: config tablosu anon erişime kapalı, bu yüzden çalışmaz
  // Sadece Supabase Auth ile devam edin
}

async function syncUsersFromSupabase() {
  // Kullanıcı listesi app_users tablosundan çekilir (çoklu cihaz desteği)
  if (!supabaseClient) return false;
  try {
    var { data, error } = await supabaseClient.from('app_users')
      .select('username, password_hash, role, display_name');
    if (error || !data || data.length === 0) return false;
    var remoteUsers = data.map(function(r) {
      return {
        username: r.username,
        passwordHash: r.password_hash,
        role: r.role || 'asci',
        displayName: r.display_name || r.username
      };
    });
    var cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
    var localUsers = (cfg.users && Array.isArray(cfg.users)) ? cfg.users : [];
    var remoteByUsername = {};
    remoteUsers.forEach(function(u) { remoteByUsername[u.username] = u; });
    var combined = [];
    // Yereldeki kullanıcıları koru, uzaktaki güncel kayıtla değiştir
    localUsers.forEach(function(u) {
      if (remoteByUsername[u.username]) combined.push(remoteByUsername[u.username]);
      else combined.push(u);
    });
    // Uzaktaki yeni kullanıcıları ekle (başka cihazdan eklenen)
    remoteUsers.forEach(function(u) {
      if (!localUsers.some(function(l) { return l.username === u.username; })) combined.push(u);
    });
    if (combined.length > 0) {
      APP_CONFIG.users = combined;
      try { localStorage.setItem('atik_kontrol_users', JSON.stringify(combined)); } catch (_) {}
    }
    return true;
  } catch (_) { return false; }
}

async function saveUsersToSupabase(users) {
  // Kullanıcı listesi app_users tablosuna yazılır (çoklu cihaz desteği)
  if (!supabaseClient) return false;
  try {
    var rows = users.map(function(u) {
      return {
        username: u.username,
        password_hash: u.passwordHash,
        role: u.role || 'asci',
        display_name: u.displayName || u.username
      };
    });
    var { error } = await supabaseClient.from('app_users').upsert(rows, { onConflict: 'username' });
    if (error) return false;
    return true;
  } catch (_) { return false; }
}

// ─── THEME ───────────────────────────────────────────────────────────────────
// Initial theme is handled by inline script in HTML (reads localStorage)
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? '' : 'dark';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('atik_kontrol_theme', newTheme || 'light');
  redrawActiveCharts();
}

function redrawActiveCharts() {
  const active = document.querySelector('.tab-content.active');
  if (!active) return;
  switch (active.id) {
    case 'content-charts': if (typeof drawAllCharts === 'function') drawAllCharts(); break;
    case 'content-yillik': renderYearlyCharts(); break;
    case 'content-harcama': renderHarcamaMenu(); break;
    case 'content-birimfiyat': renderBirimFiyatlar(); break;
    case 'content-yag': renderYagTable(); break;
    case 'content-ambalaj': renderAmbalajTable(); break;
    case 'content-report': renderReport(); break;
    case 'content-records': renderRecordsTable(); break;
  }
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
  redrawActiveCharts();
}

// ─── TOAST NOTIFICATION ───────────────────────────────────────────────────────
function showToast(message, type) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'info');
  const icons = { success: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>', error: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>', info: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' };
  toast.innerHTML = (icons[type] || icons.info) + '<span>' + escapeHtml(message) + '</span>';
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.classList.add('toast-visible'); });
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hiding');
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }, 4000);
}

// ─── PAGINATION ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;
let currentPage = 1;
let selectedIds = new Set();

// ─── UNSAVED CHANGES ──────────────────────────────────────────────────────────
let formModified = false;
let lastPollData = null;

// ─── CHART YEAR / MONTH FILTER ──────────────────────────────────────────────
let chartYearFilter = String(new Date().getFullYear());
let chartMonthFilter = 0;
let yillikYearFilter = String(new Date().getFullYear());
let yillikPrevYearFilter = '';
let reportYearFilter = 0;
let recordsYearFilter = 0;
function getAvailableYears() {
  const years = new Set();
  const now = new Date().getFullYear();
  years.add(now);
  years.add(now - 1);
  records.forEach(r => {
    if (r.tarih) {
      const y = new Date(r.tarih + 'T12:00:00').getFullYear();
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

const ROLE_ADMIN = 'admin';
const ROLE_DIYETISYEN = 'diyetisyen';
const ROLE_DEPO = 'depo';
const ROLE_ASCI = 'asci';
const ROLE_GIDA_MUHENDISI = 'gida_muhendisi';
const ROLE_TEMIZLIKCI = 'temizlikci';

const ROLE_LABELS = { admin: 'Admin', diyetisyen: 'Diyetisyen', depo: 'Depo Sorumlusu', asci: 'Aşçı', gida_muhendisi: 'Gıda Mühendisi', temizlikci: 'Temizlikçi', sadece_gorme: 'Sadece Görme' };

const ROLE_PERMISSIONS_KEY = 'atik_kontrol_role_permissions';
const ROLE_PERMISSIONS_SUPABASE_KEY = 'role_permissions';
let inactivityTimeoutMs = (function() {
  try {
    var v = parseInt(localStorage.getItem('atik_kontrol_inactivity_timeout'), 10);
    if (!isNaN(v) && v >= 0) return v;
  } catch (_) {}
  return 300000;
})();

const CORE_ROLES = ['diyetisyen', 'depo', 'asci'];

const DEFAULT_ROLE_PERMISSIONS = {
  diyetisyen: {
    tabs: { dashboard: false, menu: true, records: false, report: true, haccp: false, kalibrasyon: false, yag: false, ambalaj: false, charts: true, yillik: true, harcama: false, birimfiyat: false },
    canEditMenu: true,
    canSaveMenu: true,
    canSeeProduction: true,
    canAddRecord: false,
    canAddHaccp: false,
    canAddYag: false,
    canAddAmbalaj: false,
    canAddKalibrasyon: false,
    canExport: false,
    canSync: false,
    canSeeAdminPanel: false,
    canEditHaccp: false,
    canEditDepo: false,
    canEditHarcamaOran: false,
    canEditYag: false,
    canEditAmbalaj: false,
    canEditKalibrasyon: false,
    canEditBirimFiyat: false,
    canMenuOnayaGonder: true,
    canMenuOnayla: false,
    canMenuReddet: false
  },
  depo: {
    tabs: { dashboard: true, menu: true, records: true, report: true, haccp: true, kalibrasyon: true, yag: true, ambalaj: true, charts: true, yillik: true, harcama: false, birimfiyat: true },
    canEditMenu: false,
    canSaveMenu: false,
    canSeeProduction: true,
    canAddRecord: true,
    canAddHaccp: true,
    canAddYag: true,
    canAddAmbalaj: true,
    canAddKalibrasyon: true,
    canExport: false,
    canSync: false,
    canSeeAdminPanel: false,
    canEditHaccp: true,
    canEditDepo: true,
    canEditHarcamaOran: false,
    canEditYag: true,
    canEditAmbalaj: true,
    canEditKalibrasyon: true,
    canEditBirimFiyat: true,
    canMenuOnayaGonder: false,
    canMenuOnayla: false,
    canMenuReddet: false
  },
  asci: {
    tabs: { dashboard: false, menu: true, records: false, report: false, haccp: false, kalibrasyon: false, yag: false, ambalaj: false, charts: false, yillik: false, harcama: false, birimfiyat: false },
    canEditMenu: false,
    canSaveMenu: false,
    canSeeProduction: true,
    canAddRecord: false,
    canAddHaccp: false,
    canAddYag: false,
    canAddAmbalaj: false,
    canAddKalibrasyon: false,
    canExport: false,
    canSync: false,
    canSeeAdminPanel: false,
    canEditHaccp: false,
    canEditDepo: false,
    canEditHarcamaOran: false,
    canEditYag: false,
    canEditAmbalaj: false,
    canEditKalibrasyon: false,
    canEditBirimFiyat: false,
    canMenuOnayaGonder: false,
    canMenuOnayla: false,
    canMenuReddet: false
  },
  gida_muhendisi: {
    tabs: { dashboard: true, menu: true, records: true, report: true, haccp: true, kalibrasyon: true, yag: true, ambalaj: true, charts: true, yillik: true, harcama: false, birimfiyat: true },
    canEditMenu: false,
    canSaveMenu: false,
    canSeeProduction: true,
    canAddRecord: false,
    canAddHaccp: false,
    canAddYag: false,
    canAddAmbalaj: false,
    canAddKalibrasyon: true,
    canExport: false,
    canSync: false,
    canSeeAdminPanel: false,
    canEditHaccp: false,
    canEditDepo: false,
    canEditHarcamaOran: false,
    canEditYag: false,
    canEditAmbalaj: false,
    canEditKalibrasyon: true,
    canEditBirimFiyat: true,
    canMenuOnayaGonder: false,
    canMenuOnayla: true,
    canMenuReddet: true
  },
  temizlikci: {
    tabs: { dashboard: true, menu: true, records: true, report: true, haccp: true, kalibrasyon: true, yag: true, ambalaj: true, charts: true, yillik: true, harcama: false, birimfiyat: true },
    canEditMenu: false,
    canSaveMenu: false,
    canSeeProduction: true,
    canAddRecord: false,
    canAddHaccp: false,
    canAddYag: false,
    canAddAmbalaj: false,
    canAddKalibrasyon: false,
    canExport: false,
    canSync: false,
    canSeeAdminPanel: false,
    canEditHaccp: false,
    canEditDepo: false,
    canEditHarcamaOran: false,
    canEditYag: false,
    canEditAmbalaj: false,
    canEditKalibrasyon: false,
    canEditBirimFiyat: false,
    canMenuOnayaGonder: false,
    canMenuOnayla: false,
    canMenuReddet: false
  },
  sadece_gorme: {
    tabs: { dashboard: true, menu: true, records: true, report: true, haccp: true, kalibrasyon: true, yag: true, ambalaj: true, charts: true, yillik: true, harcama: false, birimfiyat: true },
    canEditMenu: false,
    canSaveMenu: false,
    canSeeProduction: true,
    canAddRecord: false,
    canAddHaccp: false,
    canAddYag: false,
    canAddAmbalaj: false,
    canAddKalibrasyon: false,
    canExport: false,
    canSync: false,
    canSeeAdminPanel: false,
    canEditHaccp: false,
    canEditDepo: false,
    canEditHarcamaOran: false,
    canEditYag: false,
    canEditAmbalaj: false,
    canEditKalibrasyon: false,
    canEditBirimFiyat: false,
    canMenuOnayaGonder: false,
    canMenuOnayla: false,
    canMenuReddet: false
  }
};

let rolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS));

function getRolePermissions(role) {
  if (role === ROLE_ADMIN) return null;
  return rolePermissions[role] || JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS.asci));
}

function hasPerm(key) {
  if (getRole() === ROLE_ADMIN) return true;
  var perm = getRolePermissions(getRole());
  return !!(perm && perm[key]);
}
function canAddRecords() { return hasPerm('canAddRecord'); }
function canAddHaccpRecords() { return hasPerm('canAddHaccp'); }
function canAddYagRecords() { return hasPerm('canAddYag'); }
function canAddAmbalajRecords() { return hasPerm('canAddAmbalaj'); }
function canAddKalibrasyonRecords() { return hasPerm('canAddKalibrasyon'); }
function canEditHaccpRecords() { return hasPerm('canEditHaccp'); }
function canEditYagRecords() { return hasPerm('canEditYag'); }
function canEditAmbalajRecords() { return hasPerm('canEditAmbalaj'); }
function canEditKalibrasyonRecords() { return hasPerm('canEditKalibrasyon'); }
function canEditMenuRecords() { return hasPerm('canEditMenu'); }

function serializePermsPayload() {
  return JSON.stringify({ ver: 2, roles: rolePermissions, inactivity_timeout: inactivityTimeoutMs });
}

function parsePermsPayload(parsed) {
  if (parsed && typeof parsed === 'object' && parsed.ver === 2 && parsed.roles && typeof parsed.roles === 'object') {
    var t = (typeof parsed.inactivity_timeout === 'number' && parsed.inactivity_timeout >= 0) ? parsed.inactivity_timeout : null;
    return { roles: parsed.roles, inactivityTimeout: t };
  }
  return { roles: parsed, inactivityTimeout: null };
}

function loadRolePermissions() {
  try {
    var saved = localStorage.getItem(ROLE_PERMISSIONS_KEY);
    if (saved) {
      var payload = parsePermsPayload(JSON.parse(saved));
      if (payload.roles && typeof payload.roles === 'object') {
        Object.keys(DEFAULT_ROLE_PERMISSIONS).forEach(function(role) {
          var def = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS[role]));
          var savedRole = payload.roles[role] || {};
          var merged = Object.assign({}, def, savedRole);
          merged.tabs = Object.assign({}, def.tabs, savedRole.tabs || {});
          rolePermissions[role] = merged;
        });
      }
      if (payload.inactivityTimeout !== null) inactivityTimeoutMs = payload.inactivityTimeout;
    }
  } catch (_) {}
}

function saveRolePermissions() {
  try { localStorage.setItem(ROLE_PERMISSIONS_KEY, serializePermsPayload()); } catch (_) {}
}

async function syncRolePermissionsToSupabase() {
  if (!supabaseClient) return;
  try {
    var { error } = await supabaseClient.from('config').upsert(
      { key: ROLE_PERMISSIONS_SUPABASE_KEY, value: serializePermsPayload(), last_modified: new Date().toISOString() },
      { onConflict: 'key' }
    );
  } catch (_) {}
}

async function syncRolePermissionsFromSupabase() {
  if (!supabaseClient) return false;
  try {
    var { data, error } = await supabaseClient.from('config').select('value').eq('key', ROLE_PERMISSIONS_SUPABASE_KEY).single();
    if (error || !data || !data.value) return false;
    var payload = parsePermsPayload(JSON.parse(data.value));
    if (payload.roles && typeof payload.roles === 'object') {
      Object.keys(DEFAULT_ROLE_PERMISSIONS).forEach(function(role) {
        var def = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS[role]));
        var savedRole = payload.roles[role] || {};
        var merged = Object.assign({}, def, savedRole);
        merged.tabs = Object.assign({}, def.tabs, savedRole.tabs || {});
        rolePermissions[role] = merged;
      });
      if (payload.inactivityTimeout !== null) inactivityTimeoutMs = payload.inactivityTimeout;
      saveRolePermissions();
      resetInactivityTimer();
      return true;
    }
    return false;
  } catch (_) { return false; }
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function getRole() {
  return sessionStorage.getItem('atik_kontrol_role') || '';
}

// Harcama (₺) bilgileri yalnızca admin rolüne görünür
function canSeeHarcama() {
  return getRole() === ROLE_ADMIN;
}

// Dışa aktarma (PDF/yazdırma) pencerelerinde harcama öğelerini gizleyen CSS kuralı
function harcamaHiddenCss() {
  return canSeeHarcama() ? '' : '.col-harcama,.td-harcama,.report-item-harcama,.chart-card-harcama,.field-harcama{display:none!important}';
}

function isUsingSupabaseAuth() {
  return sessionStorage.getItem('atik_kontrol_supabase_auth') === 'true';
}

function isAdminSessionValid() {
  if (getRole() !== ROLE_ADMIN) return false;

  // Supabase Auth ile giriş yapıldıysa cache'lenmiş session'ı kontrol et
  if (isUsingSupabaseAuth()) {
    return !!supabaseSession;
  }

  // Legacy: client-side hash kontrolü
  const storedHash = sessionStorage.getItem('atik_kontrol_admin_hash_proof');
  if (!storedHash) return false;
  const loginTime = parseInt(sessionStorage.getItem('atik_kontrol_login_time') || '0');
  if (Date.now() - loginTime > 3600000) {
    sessionStorage.removeItem('atik_kontrol_admin_hash_proof');
    sessionStorage.removeItem('atik_kontrol_login_time');
    return false;
  }
  const cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
  if (cfg.users && Array.isArray(cfg.users)) {
    const adminHashes = cfg.users.filter(u => u.role === ROLE_ADMIN).map(u => u.passwordHash);
    if (adminHashes.includes(storedHash)) return true;
  }
  return false;
}

function requireAdmin() {
  var role = getRole();
  if (!role) { showToast('Oturum bulunamadı. Lütfen giriş yapın.', 'error'); return false; }
  
  // Supabase Auth kullanılıyorsa session varlığını kontrol et
  if (isUsingSupabaseAuth() && supabaseClient) {
    if (!supabaseSession) {
      showToast('Oturum süresi doldu. Lütfen tekrar giriş yapın.', 'error');
      sessionStorage.removeItem('atik_kontrol_role');
      location.reload();
      return false;
    }
  } else if (role === ROLE_ADMIN) {
    // Legacy admin: hash proof kontrolü
    var storedHash = sessionStorage.getItem('atik_kontrol_admin_hash_proof');
    if (!storedHash) {
      showToast('Bu işlem için admin yetkisi gerekli.', 'error');
      return false;
    }
    var loginTime = parseInt(sessionStorage.getItem('atik_kontrol_login_time') || '0');
    if (Date.now() - loginTime > 3600000) {
      sessionStorage.removeItem('atik_kontrol_admin_hash_proof');
      sessionStorage.removeItem('atik_kontrol_login_time');
      showToast('Oturum süresi doldu. Lütfen tekrar giriş yapın.', 'error');
      location.reload();
      return false;
    }
  }
  
  return true;
}

async function doLogin() {
  const usernameSelect = document.getElementById('loginUsername');
  const input = document.getElementById('loginPassword');
  const error = document.getElementById('loginError');
  const username = usernameSelect.value;
  const password = input.value;
  
  if (!username) {
    error.textContent = 'Lütfen kullanıcı seçin!';
    error.style.display = 'block';
    return;
  }

  // 1. Önce legacy auth dene (yönetim panelinde değiştirilen şifre burada geçerli)
  const inputHash = await sha256(password);
  
  let role = null;
  let displayName = '';
  const cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
  
  if (cfg.users && Array.isArray(cfg.users)) {
    const user = cfg.users.find(u => u.username === username && u.passwordHash === inputHash);
    if (user) {
      role = user.role;
      displayName = user.displayName;
    }
  }

  if (role) {
    sessionStorage.setItem('atik_kontrol_role', role);
    sessionStorage.setItem('atik_kontrol_display_name', displayName);
    sessionStorage.removeItem('atik_kontrol_supabase_auth');
    if (role === ROLE_ADMIN) {
      sessionStorage.setItem('atik_kontrol_admin_hash_proof', inputHash);
      sessionStorage.setItem('atik_kontrol_login_time', String(Date.now()));
    }
    localStorage.setItem('atik_kontrol_last_login', new Date().toISOString());
    rememberLoginUser(username);
    document.getElementById('loginOverlay').classList.add('hidden');
    document.body.setAttribute('data-role', role);
    document.getElementById('roleBadge').textContent = displayName;
    renderAdminPanelBtn();
    applyRolePermissions();
    if (window._loginResolve) { window._loginResolve(); window._loginResolve = null; }
    logIslem('login', displayName + ' (legacy) sisteme giriş yaptı');
    return;
  }

  // 2. Legacy yoksa/başarısızsa Supabase Auth ile dene (e-posta olarak @ekle)
  if (supabaseClient) {
    var email = username.indexOf('@') === -1 ? username + '@beslenme.local' : username;
    var { data: signInData, error: signInError } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });
    if (!signInError && signInData && signInData.session) {
      // Başarılı Supabase Auth - rol user_roles'dan (veya legacy fallback'ten) gelecek
      rememberLoginUser(username);
      return;
    }
  }

  // 3. Her ikisi de başarısız
  window._loginAttempts = (window._loginAttempts || 0) + 1;
  error.textContent = 'Hatalı kullanıcı adı veya şifre!';
  error.style.display = 'block';
  input.value = '';
  input.focus();
  if (window._loginAttempts >= 5) {
    error.textContent = 'Çok fazla hatalı giriş! Sayfa yenileniyor...';
    setTimeout(() => location.reload(), 2000);
  }
}

function renderAdminPanelBtn() {
  const btn = document.getElementById('adminPanelBtn');
  const logBtn = document.getElementById('logPanelBtn');
  const isAdmin = getRole() === ROLE_ADMIN;
  if (btn) btn.style.display = isAdmin ? '' : 'none';
  if (logBtn) logBtn.style.display = isAdmin ? '' : 'none';
}

function openAdminPanel() {
  if (getRole() !== ROLE_ADMIN) {
    showToast('Bu işlem için admin yetkisi gerekli.', 'error');
    return;
  }
  document.getElementById('apReAuthContainer').style.display = 'block';
  document.getElementById('apPanelBody').style.display = 'none';
  document.getElementById('apReAuthPw').value = '';
  document.getElementById('apReAuthError').style.display = 'none';
  document.getElementById('apReAuthError').textContent = '';
  document.getElementById('apError').style.display = 'none';
  document.getElementById('apError').textContent = '';
  document.getElementById('apSuccess').style.display = 'none';
  document.getElementById('apSuccess').textContent = '';
  apRenderRolePermissions();
  var roleLabel = getRole() === ROLE_ADMIN ? 'Yönetici' : 'Görüntüleme';
  document.getElementById('apSessionRole').textContent = roleLabel;
  var lastLogin = localStorage.getItem('atik_kontrol_last_login');
  if (lastLogin) {
    try {
      var d = new Date(lastLogin);
      document.getElementById('apLastLogin').textContent = d.toLocaleString('tr-TR');
    } catch (_) { document.getElementById('apLastLogin').textContent = lastLogin; }
  } else {
    document.getElementById('apLastLogin').textContent = 'Bu oturum';
  }
  var authMode = isUsingSupabaseAuth() ? 'Supabase Auth' : 'Legacy (SHA-256)';
  document.getElementById('apAuthMode').textContent = authMode;
  document.getElementById('apStorageInfo').textContent = supabaseClient ? 'Supabase + Yerel' : 'Yerel (tarayıcı)';
  document.getElementById('adminPanelModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  apLoadLogs();
}

async function apReAuth() {
  const pw = document.getElementById('apReAuthPw').value;
  const errorEl = document.getElementById('apReAuthError');

  // Supabase Auth ile giriş yapıldıysa session doğrulaması yap
  if (isUsingSupabaseAuth() && supabaseClient) {
    try {
      var { data: { session } } = await supabaseClient.auth.getSession();
      if (session) {
        document.getElementById('apReAuthContainer').style.display = 'none';
        document.getElementById('apPanelBody').style.display = 'block';
        errorEl.style.display = 'none';
        apRenderUserList();
        apRenderRolePermissions();
        apRenderInactivityTimeout();
        return;
      }
    } catch (_) {}
  }

  // Legacy fallback: SHA-256 hash kontrolü
  const hash = await sha256(pw);
  const cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
  var adminHash = '';
  if (cfg.users && Array.isArray(cfg.users)) {
    const adminUser = cfg.users.find(u => u.role === ROLE_ADMIN);
    if (adminUser) adminHash = adminUser.passwordHash;
  }
  if (hash === adminHash) {
    document.getElementById('apReAuthContainer').style.display = 'none';
    document.getElementById('apPanelBody').style.display = 'block';
    errorEl.style.display = 'none';
    apRenderUserList();
    apRenderRolePermissions();
    apRenderInactivityTimeout();
  } else {
    errorEl.textContent = 'Admin şifresi yanlış!';
    errorEl.style.display = 'block';
    document.getElementById('apReAuthPw').value = '';
    document.getElementById('apReAuthPw').focus();
  }
}

function closeAdminPanel() {
  document.getElementById('adminPanelModal').classList.remove('open');
  document.body.style.overflow = '';
}

function doLogout() {
  logIslem('logout', (sessionStorage.getItem('atik_kontrol_display_name') || 'bilinmiyor') + ' çıkış yaptı');
  // Supabase Auth'ten çıkış yap
  if (supabaseClient && isUsingSupabaseAuth()) {
    supabaseClient.auth.signOut();
  }
  // Tüm veriyi temizle (sekme bazlı sessionStorage)
  var keysToKeep = ['atik_kontrol_theme', 'atik_kontrol_accent', 'haccp_depo_adlari', ROLE_PERMISSIONS_KEY, 'sb-' + SUPABASE_URL + '-auth-token', 'atik_kontrol_users', 'ogrenci_basi_harcama_orani', 'personel_basi_harcama_orani', 'uretilen_yemek_basi_harcama_orani', 'atik_kontrol_son_personel', 'atik_kontrol_inactivity_timeout'];
  var preserved = {};
  keysToKeep.forEach(function(k) {
    try { var v = localStorage.getItem(k); if (v) preserved[k] = v; } catch (_) {}
  });
  localStorage.clear();
  Object.keys(preserved).forEach(function(k) {
    try { localStorage.setItem(k, preserved[k]); } catch (_) {}
  });
  // sessionStorage'ı da temizle (veriler burada duruyor)
  try { sessionStorage.clear(); } catch (_) {}
  // Service Worker önbelleğini temizle
  if ('caches' in window) {
    caches.keys().then(function(names) {
      names.forEach(function(name) { caches.delete(name); });
    });
  }
  location.reload();
}

function updatePasswordStrength(input, barId) {
  var val = input.value || '';
  var bar = document.getElementById(barId);
  if (!bar) return;
  var strength = 0;
  if (val.length >= 3) strength += 25;
  if (val.length >= 6) strength += 25;
  if (/[A-Z]/.test(val) && /[a-z]/.test(val)) strength += 20;
  if (/\d/.test(val)) strength += 15;
  if (/[^A-Za-z0-9]/.test(val)) strength += 15;
  strength = Math.min(strength, 100);
  bar.style.width = strength + '%';
  if (strength < 30) { bar.style.background = '#ef4444'; }
  else if (strength < 50) { bar.style.background = '#f97316'; }
  else if (strength < 70) { bar.style.background = '#eab308'; }
  else { bar.style.background = '#22c55e'; }
}

async function saveAdminSettings() {
  if (getRole() !== ROLE_ADMIN) return;
  var errorEl = document.getElementById('apError');
  var successEl = document.getElementById('apSuccess');
  errorEl.style.display = 'none';
  successEl.style.display = 'none';
  var inactSel = document.getElementById('apInactivityTimeout');
  if (inactSel) {
    var inactVal = parseInt(inactSel.value, 10);
    if (isNaN(inactVal) || inactVal < 0) inactVal = 300000;
    inactivityTimeoutMs = inactVal;
    try { localStorage.setItem('atik_kontrol_inactivity_timeout', String(inactVal)); } catch (_) {}
    resetInactivityTimer();
  }
  var roles = Object.keys(rolePermissions);
  roles.forEach(function(role) {
    var perm = rolePermissions[role];
    if (!perm) return;
    var prefix = 'apRole_' + role + '_';
    var tabs = ['dashboard', 'menu', 'records', 'report', 'haccp', 'kalibrasyon', 'yag', 'ambalaj', 'charts', 'yillik', 'harcama', 'birimfiyat'];
    tabs.forEach(function(tab) {
      var cb = document.getElementById(prefix + 'tab_' + tab);
      if (cb) perm.tabs[tab] = cb.checked;
    });
    var checks = ['canEditMenu', 'canSaveMenu', 'canSeeProduction', 'canAddRecord', 'canAddHaccp', 'canAddYag', 'canAddAmbalaj', 'canAddKalibrasyon', 'canExport', 'canSync', 'canSeeAdminPanel', 'canEditHaccp', 'canEditDepo', 'canEditHarcamaOran', 'canEditBirimFiyat', 'canEditYag', 'canEditAmbalaj', 'canEditKalibrasyon', 'canMenuOnayaGonder', 'canMenuOnayla', 'canMenuReddet'];
    checks.forEach(function(key) {
      var cb = document.getElementById(prefix + key);
      if (cb) perm[key] = cb.checked;
    });
  });
  saveRolePermissions();
  syncRolePermissionsToSupabase();
  successEl.textContent = 'Rol izinleri güncellendi.';
  successEl.style.display = 'block';
  showToast('Ayarlar kaydedildi.', 'success');
  applyRolePermissions();
}

function apRenderRolePermissions() {
  var container = document.getElementById('apRolePermissions');
  if (!container) return;
  var roles = Object.keys(rolePermissions);
  var permLabels = {
    canEditMenu: 'Menüdüzenleyebilir',
    canSaveMenu: 'Menüyü kaydedebilir',
    canSeeProduction: 'Ürün ihtiyaç listesini görebilir',
    canAddRecord: 'Yeni kayıt ekleyebilir (üretim/tüketim/atık ana kayıtlar)',
    canAddHaccp: 'Depo sıcaklık kaydı ekleyebilir',
    canAddYag: 'Atık yağ kaydı ekleyebilir',
    canAddAmbalaj: 'Ambalaj atığı kaydı ekleyebilir',
    canAddKalibrasyon: 'Kalibrasyona tabi cihaz kaydı ekleyebilir',
    canExport: 'Dışa aktarabilir',
    canSync: 'Senkronizasyon yapabilir',
    canSeeAdminPanel: 'Yönetim panelini görebilir',
    canEditHaccp: 'Depo sıcaklık kayıtlarını düzenleyebilir/silebilir',
    canEditDepo: 'Depo adlarını düzenleyebilir',
    canEditHarcamaOran: 'Harcama oranını/tutarını değiştirebilir',
    canEditBirimFiyat: 'Birim fiyat listesini düzenleyebilir',
    canEditYag: 'Atık yağ bilgilerini düzenleyebilir/silebilir',
    canEditAmbalaj: 'Ambalaj atık kayıtlarını düzenleyebilir/silebilir',
    canEditKalibrasyon: 'Kalibrasyon cihaz bilgilerini düzenleyebilir/silebilir',
    canMenuOnayaGonder: 'Menüyü onaya gönderebilir',
    canMenuOnayla: 'Menüyü onaylayabilir',
    canMenuReddet: 'Menüyü reddedebilir'
  };
  var tabLabels = { dashboard: 'Panel', menu: 'Menü', records: 'Kayıtlar', report: 'Rapor', haccp: 'Gıda Güvenliği', kalibrasyon: 'Kalibrasyon', yag: 'Atık Yağ', ambalaj: 'Ambalaj Atıkları', charts: 'Grafikler', yillik: 'Yıllık', harcama: 'Harcama', birimfiyat: 'Ürün ve Fiyatlar' };
  var html = '';
  roles.forEach(function(role) {
    var perm = rolePermissions[role] || {};
    var prefix = 'apRole_' + role + '_';
    var isCore = CORE_ROLES.indexOf(role) !== -1;
    var label = (ROLE_LABELS[role] || role);
    html += '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:0.85rem;margin-bottom:0.75rem">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;padding-bottom:0.5rem;border-bottom:1px solid var(--border)">';
    html += '<div style="font-size:0.95rem;font-weight:700;color:var(--text-primary)">' + label + (isCore ? '' : ' <span style="font-size:0.7rem;color:var(--text-muted);font-weight:400">(özel rol)</span>') + '</div>';
    html += '<div style="display:flex;gap:0.4rem">';
    html += '<button class="btn btn-ghost btn-sm" onclick="apResetRolePermissions(\'' + role + '\')" title="Varsayılana sıfırla" style="font-size:0.75rem;padding:3px 8px;color:var(--accent)">Sıfırla</button>';
    if (!isCore) {
      html += '<button class="btn btn-ghost btn-sm" onclick="apDeleteRole(\'' + role + '\')" title="Bu rolü sil" style="font-size:0.75rem;padding:3px 8px;color:#ef4444">Sil</button>';
    }
    html += '</div></div>';
    html += '<div style="font-size:0.8rem;font-weight:600;color:var(--text-muted);margin-bottom:0.4rem">Görünen Sekmeler</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.25rem;margin-bottom:0.75rem">';
    Object.keys(tabLabels).forEach(function(tab) {
      html += '<label style="display:flex;align-items:center;gap:0.4rem;padding:0.25rem 0;cursor:pointer;font-size:0.82rem">';
      html += '<input type="checkbox" id="' + prefix + 'tab_' + tab + '"' + (perm.tabs && perm.tabs[tab] ? ' checked' : '') + ' /> ' + tabLabels[tab];
      html += '</label>';
    });
    html += '</div>';
    html += '<div style="font-size:0.8rem;font-weight:600;color:var(--text-muted);margin-bottom:0.4rem">İzinler</div>';
    Object.keys(permLabels).forEach(function(key) {
      html += '<label style="display:flex;align-items:center;gap:0.4rem;padding:0.25rem 0;cursor:pointer;font-size:0.82rem">';
      html += '<input type="checkbox" id="' + prefix + key + '"' + (perm[key] ? ' checked' : '') + ' /> ' + permLabels[key];
      html += '</label>';
    });
    html += '</div>';
  });
  html += '<div style="background:var(--bg-card);border:1px dashed var(--border);border-radius:10px;padding:0.85rem;margin-bottom:0.75rem">';
  html += '<div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:0.5rem">Yeni Rol Ekle</div>';
  html += '<div style="display:flex;gap:0.5rem">';
  html += '<input type="text" id="apNewRoleName" placeholder="Rol adı (ör: temizlikçi)" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:0.85rem" />';
  html += '<button class="btn btn-primary btn-sm" onclick="apAddRole()">Ekle</button>';
  html += '</div></div>';
  container.innerHTML = html;
}

function apResetRolePermissions(role) {
  if (getRole() !== ROLE_ADMIN) return;
  if (!confirm('Bu rolün izinlerini varsayılana sıfırlamak istediğinize emin misiniz?')) return;
  if (DEFAULT_ROLE_PERMISSIONS[role]) {
    rolePermissions[role] = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS[role]));
  } else {
    delete rolePermissions[role];
  }
  saveRolePermissions();
  syncRolePermissionsToSupabase();
  apRenderRolePermissions();
  applyRolePermissions();
  showToast((ROLE_LABELS[role] || role) + ' izinleri sıfırlandı.', 'success');
}

function apDeleteRole(role) {
  if (getRole() !== ROLE_ADMIN) return;
  if (CORE_ROLES.indexOf(role) !== -1) { showToast('Temel roller silinemez.', 'error'); return; }
  if (!confirm('"' + (ROLE_LABELS[role] || role) + '" rolünü silmek istediğinize emin misiniz?')) return;
  delete rolePermissions[role];
  delete ROLE_LABELS[role];
  saveRolePermissions();
  syncRolePermissionsToSupabase();
  apRenderRolePermissions();
  showToast((ROLE_LABELS[role] || role) + ' rolü silindi.', 'success');
}

function apAddRole() {
  if (getRole() !== ROLE_ADMIN) return;
  var nameInput = document.getElementById('apNewRoleName');
  var name = (nameInput.value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!name) { showToast('Rol adı gerekli.', 'error'); return; }
  if (rolePermissions[name]) { showToast('Bu rol zaten var.', 'error'); return; }
  if (['admin'].indexOf(name) !== -1) { showToast('Bu rol adı kullanılamaz.', 'error'); return; }
  ROLE_LABELS[name] = nameInput.value.trim();
  rolePermissions[name] = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS.asci));
  saveRolePermissions();
  syncRolePermissionsToSupabase();
  nameInput.value = '';
  apRenderRolePermissions();
  showToast('"' + ROLE_LABELS[name] + '" rolü eklendi. İzinleri özelleştirebilirsiniz.', 'success');
}

// ─── KULLANICI YÖNETİMİ ─────────────────────────────────────────────────────
function getUsers() {
  var cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
  if (cfg.users && Array.isArray(cfg.users)) return JSON.parse(JSON.stringify(cfg.users));
  return [];
}

async function saveUsers(users) {
  APP_CONFIG.users = users;
  try { localStorage.setItem('atik_kontrol_users', JSON.stringify(users)); } catch (_) {}
  var remoteOk = await saveUsersToSupabase(users);
  return remoteOk;
}

function loadUsersFromStorage() {
  try {
    var saved = localStorage.getItem('atik_kontrol_users');
    if (saved) {
      var users = JSON.parse(saved);
      if (Array.isArray(users) && users.length > 0) APP_CONFIG.users = users;
    }
  } catch (_) {}
}

function apRenderUserList() {
  var container = document.getElementById('apUserList');
  if (!container) return;
  var users = getUsers();
  if (users.length === 0) {
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);margin:0">Kayıtlı kullanıcı yok.</p>';
    return;
  }
  var roleLabels = { admin: 'Admin', diyetisyen: 'Diyetisyen', depo: 'Depo Sorumlusu', asci: 'Aşçı' };
  var roleColors = { admin: '#ef4444', diyetisyen: '#6366f1', depo: '#f59e0b', asci: '#22c55e' };
  var html = '<div style="display:flex;flex-direction:column;gap:0.5rem">';
  users.forEach(function(user, i) {
    var roleLabel = roleLabels[user.role] || ROLE_LABELS[user.role] || user.role;
    var roleColor = roleColors[user.role] || '#888';
    html += '<div style="display:flex;align-items:center;gap:0.5rem;padding:0.6rem 0.75rem;background:var(--bg-card);border:1px solid var(--border);border-radius:8px">';
    html += '<div style="flex:1">';
    html += '<div style="font-size:0.9rem;font-weight:600;color:var(--text-primary)">' + escapeHtml(user.displayName) + '</div>';
    html += '<div style="font-size:0.75rem;color:var(--text-muted)">@' + escapeHtml(user.username) + ' &middot; <span style="color:' + roleColor + ';font-weight:600">' + roleLabel + '</span></div>';
    html += '</div>';
    html += '<button class="btn btn-ghost btn-sm" onclick="apEditUser(' + i + ')" title="Düzenle" style="padding:4px 8px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>';
    html += '<button class="btn btn-ghost btn-sm" onclick="apDeleteUser(' + i + ')" title="Sil" style="padding:4px 8px;color:#ef4444"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>';
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

async function apAddUser() {
  if (getRole() !== ROLE_ADMIN) return;
  var username = document.getElementById('apNewUsername').value.trim().toLowerCase();
  var displayName = document.getElementById('apNewDisplayName').value.trim();
  var password = document.getElementById('apNewPassword').value;
  var role = document.getElementById('apNewRole').value;
  var errorEl = document.getElementById('apError');
  var successEl = document.getElementById('apSuccess');
  errorEl.style.display = 'none';
  successEl.style.display = 'none';

  if (!username) { errorEl.textContent = 'Kullanıcı adı gerekli.'; errorEl.style.display = 'block'; return; }
  if (!displayName) { errorEl.textContent = 'Görünen ad gerekli.'; errorEl.style.display = 'block'; return; }
  if (!password || password.length < 3) { errorEl.textContent = 'Şifre en az 3 karakter olmalı.'; errorEl.style.display = 'block'; return; }

  var users = getUsers();
  if (users.some(function(u) { return u.username === username; })) {
    errorEl.textContent = 'Bu kullanıcı adı zaten var.';
    errorEl.style.display = 'block';
    return;
  }

  var hash = await sha256(password);
  users.push({ username: username, passwordHash: hash, role: role, displayName: displayName });
  var remoteOk = await saveUsers(users);

  document.getElementById('apNewUsername').value = '';
  document.getElementById('apNewDisplayName').value = '';
  document.getElementById('apNewPassword').value = '';
  apRenderUserList();
  successEl.textContent = '"' + displayName + '" kullanıcısı eklendi.' + (remoteOk ? ' (Supabase)' : ' (yerel)');
  successEl.style.display = 'block';
  showToast('Kullanıcı eklendi.' + (remoteOk ? '' : ' (sadece yerel)'), 'success');
  logIslem('kullanici_ekle', displayName + ' (' + role + ') eklendi');
}

function apEditUser(index) {
  if (getRole() !== ROLE_ADMIN) return;
  var users = getUsers();
  var user = users[index];
  if (!user) return;

  var roleLabels = { admin: 'Admin', diyetisyen: 'Diyetisyen', depo: 'Depo Sorumlusu', asci: 'Aşçı' };

  var container = document.getElementById('apUserList');
  var html = '<div style="background:var(--bg-card);border:2px solid var(--accent);border-radius:8px;padding:0.75rem">';  html += '<div style="font-size:0.85rem;font-weight:600;color:var(--accent);margin-bottom:0.5rem">Kullanıcıyı Düzenle</div>';
  html += '<input type="hidden" id="apEditIndex" value="' + index + '" />';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem">';
  html += '<div><label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:0.2rem">Kullanıcı Adı</label>';
  html += '<input type="text" id="apEditUsername" value="' + escapeHtml(user.username) + '" readonly style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-muted);font-size:0.85rem" /></div>';
  html += '<div><label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:0.2rem">Görünen Ad</label>';
  html += '<input type="text" id="apEditDisplayName" value="' + escapeHtml(user.displayName) + '" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:0.85rem" /></div>';
  html += '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem">';
  html += '<div><label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:0.2rem">Yeni Şifre (boş = değişmez)</label>';
  html += '<input type="password" id="apEditPassword" placeholder="Yeni şifre (en az 3 karakter)" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:0.85rem" /></div>';
  html += '<div><label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:0.2rem">Rol</label>';
  html += '<select id="apEditRole" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:0.85rem">';
  ['admin','diyetisyen','depo','asci','gida_muhendisi','temizlikci','sadece_gorme'].forEach(function(r) {
    html += '<option value="' + r + '"' + (user.role === r ? ' selected' : '') + '>' + (roleLabels[r] || ROLE_LABELS[r] || r) + '</option>';
  });
  html += '</select></div>';
  html += '</div>';
  html += '<div style="display:flex;gap:0.5rem">';
  html += '<button class="btn btn-primary btn-sm" onclick="apSaveEditUser()">Kaydet</button>';
  html += '<button class="btn btn-ghost btn-sm" onclick="apRenderUserList()">İptal</button>';
  html += '</div></div>';
  container.innerHTML = html;
}

async function apSaveEditUser() {
  if (getRole() !== ROLE_ADMIN) return;
  var index = parseInt(document.getElementById('apEditIndex').value);
  var users = getUsers();
  var user = users[index];
  if (!user) return;

  var displayName = document.getElementById('apEditDisplayName').value.trim();
  var role = document.getElementById('apEditRole').value;
  var newPw = document.getElementById('apEditPassword').value;
  var errorEl = document.getElementById('apError');
  var successEl = document.getElementById('apSuccess');
  errorEl.style.display = 'none';
  successEl.style.display = 'none';

  if (!displayName) { errorEl.textContent = 'Görünen ad gerekli.'; errorEl.style.display = 'block'; return; }
  if (newPw && newPw.length < 3) { errorEl.textContent = 'Şifre en az 3 karakter olmalı.'; errorEl.style.display = 'block'; return; }

  user.displayName = displayName;
  user.role = role;
  if (newPw && newPw.length >= 3) {
    user.passwordHash = await sha256(newPw);
  }
  users[index] = user;
  var remoteOk = await saveUsers(users);
  apRenderUserList();
  successEl.textContent = displayName + ' güncellendi.' + (remoteOk ? ' (Supabase)' : ' (yerel)');
  successEl.style.display = 'block';
  showToast(displayName + ' güncellendi.' + (remoteOk ? '' : ' (sadece yerel)'), 'success');
  logIslem('kullanici_duzenle', displayName + ' güncellendi');
}

async function apDeleteUser(index) {
  if (getRole() !== ROLE_ADMIN) return;
  var users = getUsers();
  var user = users[index];
  if (!user) return;
  if (user.username === 'admin') { showToast('Admin kullanıcısı silinemez.', 'error'); return; }
  if (!confirm('"' + user.displayName + '" kullanıcısını silmek istediğinize emin misiniz?')) return;
  users.splice(index, 1);
  var remoteOk = await saveUsers(users);
  apRenderUserList();
  showToast('Kullanıcı silindi.' + (remoteOk ? '' : ' (sadece yerel)'), 'success');
  logIslem('kullanici_sil', user.displayName + ' silindi');
}

async function apLoadLogs() {
  var container = document.getElementById('logPanelBody') || document.getElementById('apLogList');
  if (!container) return;
  if (!supabaseClient) { container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-muted)">Supabase bağlı değil.</div>'; return; }
  container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-muted)">Yükleniyor...</div>';
  try {
    var filterIslem = document.getElementById('logFilterIslem');
    var filterKullanici = document.getElementById('logFilterKullanici');
    var query = supabaseClient.from('user_logs').select('*').order('tarih', { ascending: false }).limit(200);
    if (filterIslem && filterIslem.value) query = query.eq('islem', filterIslem.value);
    var { data, error } = await query;
    if (error) throw error;
    if (filterKullanici && filterKullanici.value && data) {
      var arama = filterKullanici.value.toLowerCase();
      data = data.filter(function(r) { return (r.kullanici || '').toLowerCase().indexOf(arama) !== -1; });
    }
    if (!data || data.length === 0) { container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-muted)">Log kaydı bulunamadı.</div>'; return; }
    var islemRenk = { login: '#22c55e', logout: '#ef4444', yeni_kayit: '#3b82f6', kayit_duzenle: '#f59e0b', kayit_sil: '#ef4444', kullanici_ekle: '#3b82f6', kullanici_duzenle: '#f59e0b', kullanici_sil: '#ef4444' };
    var islemEtiket = { login: 'Giriş', logout: 'Çıkış', yeni_kayit: 'Yeni Kayıt', kayit_duzenle: 'Düzenleme', kayit_sil: 'Silme', kullanici_ekle: 'Kullanıcı Ekle', kullanici_duzenle: 'Kullanıcı Düzenle', kullanici_sil: 'Kullanıcı Sil' };
    var html = '<table style="width:100%;border-collapse:collapse;font-size:0.78rem">';
    html += '<thead><tr style="background:var(--bg-card);position:sticky;top:0;z-index:1"><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600">Tarih</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600">Kullanıcı</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600">İşlem</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600">Detay</th></tr></thead><tbody>';
    data.forEach(function(r) {
      var tarih = '';
      try { tarih = new Date(r.tarih).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { tarih = r.tarih || ''; }
      var renk = islemRenk[r.islem] || 'var(--text-muted)';
      var etiket = islemEtiket[r.islem] || r.islem;
      html += '<tr style="border-bottom:1px solid var(--border)">';
      html += '<td style="padding:5px 8px;white-space:nowrap;color:var(--text-muted)">' + tarih + '</td>';
      html += '<td style="padding:5px 8px;font-weight:600">' + escapeHtml(r.kullanici || '') + ' <span style="font-size:0.7rem;color:var(--text-muted)">(' + escapeHtml(r.rol || '') + ')</span></td>';
      html += '<td style="padding:5px 8px"><span style="background:' + renk + '22;color:' + renk + ';padding:2px 8px;border-radius:4px;font-weight:600;font-size:0.72rem">' + etiket + '</span></td>';
      html += '<td style="padding:5px 8px;color:var(--text-muted)">' + escapeHtml(r.detay || '') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (_) {
    container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--danger)">Loglar yüklenemedi.</div>';
  }
}

function openLogPanel() {
  if (getRole() !== ROLE_ADMIN) return;
  document.getElementById('logPanelModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  apLoadLogs();
}

function closeLogPanel() {
  document.getElementById('logPanelModal').classList.remove('open');
  document.body.style.overflow = '';
}

function openManualModal() {
  var el = document.getElementById('manualModal');
  if (!el) return;
  var vLabel = document.getElementById('manualVersion');
  if (vLabel && typeof APP_CONFIG !== 'undefined' && APP_CONFIG.version) {
    vLabel.textContent = 'v' + APP_CONFIG.version;
  }
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeManualModal() {
  var el = document.getElementById('manualModal');
  if (el) el.classList.remove('open');
  document.body.style.overflow = '';
}

function exportManualPDF() {
  var body = document.querySelector('#manualModal .manual-body');
  if (!body) { showToast('Kılavuz içeriği bulunamadı.', 'error'); return; }
  var printWin = window.open('', '_blank', 'width=900,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  var manualHtml = body.outerHTML;
  printWin.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>Kullanım Kılavuzu - Atık Kontrol</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #222; font-size: 13px; line-height: 1.6; }
      h1 { font-size: 1.4rem; margin: 0 0 0.2rem; }
      .date { font-size: 0.8rem; color: #666; margin-bottom: 1.5rem; }
      .manual-hero { text-align: center; border-bottom: 2px solid #444; padding-bottom: 1rem; margin-bottom: 1.5rem; }
      .manual-hero-badge { display: inline-block; border: 1px solid #999; border-radius: 999px; padding: 0.2rem 0.8rem; font-size: 0.75rem; margin-bottom: 0.5rem; color: #555; }
      .manual-hero h3 { margin: 0.2rem 0; font-size: 1.1rem; }
      .manual-hero p { margin: 0; color: #555; font-size: 0.85rem; }
      .manual-toc { border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; page-break-inside: avoid; }
      .manual-toc > strong { display: block; margin-bottom: 0.5rem; }
      .manual-toc-links { display: flex; flex-wrap: wrap; gap: 0.25rem 1.5rem; font-size: 0.8rem; }
      .manual-toc-links a { color: inherit; text-decoration: none; width: calc(50% - 0.75rem); box-sizing: border-box; }
      .manual-section { border: 1px solid #ddd; border-radius: 8px; padding: 0.9rem 1.1rem; margin-bottom: 1rem; page-break-inside: avoid; }
      .manual-section h3 { margin: 0 0 0.5rem; font-size: 1rem; color: #333; }
      .manual-section h3::before { content: '\\25B8 '; color: #666; }
      .manual-section p { margin: 0.4rem 0; font-size: 0.85rem; color: #444; }
      .manual-section ul { margin: 0.4rem 0; padding-left: 1.2rem; font-size: 0.85rem; color: #444; }
      .manual-section li { margin: 0.2rem 0; }
      .manual-section li strong, .manual-section p strong { color: #111; }
      .manual-section li em, .manual-section p em { color: #333; }
      @media print { a { color: inherit !important; } }
    </style>
  </head><body>
    <h1>KIRŞEHİR AHİ EVRAN ÜNİVERSİTESİ<br>Beslenme Hizmetleri Yönetim Sistemi</h1>
    <div class="date">${new Date().toLocaleDateString('tr-TR')}</div>
    ${manualHtml}
  </body></html>`);
  printWin.document.close();
  printWin.focus();
  triggerPrint(printWin);
}

function applyViewerRestrictions() {
  if (getRole() === ROLE_ADMIN) return;
  var perm = getRolePermissions(getRole());
  if (!perm) return;
  Object.keys(perm.tabs || {}).forEach(function(key) {
    var btn = document.getElementById('tab-' + key);
    if (btn) btn.style.display = perm.tabs[key] ? '' : 'none';
  });
  var actionBtn = document.querySelector('.sidebar-nav .tab-btn[onclick*="openModal"]');
  if (actionBtn) actionBtn.style.display = perm.canAddRecord ? '' : 'none';
  var syncBtn = document.querySelector('.sidebar-actions .tab-btn[onclick*="syncAllToSupabase"]');
  if (syncBtn) syncBtn.style.display = perm.canSync ? '' : 'none';
  var pullBtn = document.querySelector('.sidebar-actions .tab-btn[onclick*="syncAllFromSupabase"]');
  if (pullBtn) pullBtn.style.display = perm.canSync ? '' : 'none';
  // Sekme içindeki tüm "Supabase'e Kaydet / Supabase'ten Çek" butonları da canSync'e bağlı
  if (!perm.canSync) {
    document.querySelectorAll('button[onclick]').forEach(function(btn) {
      var onclick = btn.getAttribute('onclick') || '';
      if (/(sync(All|Haccp|Yag|Ambalaj|Kalibrasyon|Dishes|Menu)(To|From)Supabase)/.test(onclick)) {
        btn.style.display = 'none';
      }
    });
  }
  var adminBtn = document.getElementById('adminPanelBtn');
  if (adminBtn) adminBtn.style.display = perm.canSeeAdminPanel ? '' : 'none';
  var logBtn = document.getElementById('logPanelBtn');
  if (logBtn) logBtn.style.display = perm.canSeeAdminPanel ? '' : 'none';
  if (!perm.canEditMenu) {
    document.querySelectorAll('.menu-table textarea, .menu-table input, .note-input, .kisi-input').forEach(function(el) {
      el.readOnly = true; el.disabled = true; el.style.opacity = '0.7';
    });
    document.querySelectorAll('[contenteditable]').forEach(function(el) { el.removeAttribute('contenteditable'); });
  }
  if (!perm.canAddRecord) {
    document.querySelectorAll('.btn-primary[onclick*="openModal"]').forEach(function(el) { el.style.display = 'none'; });
  }
  if (!perm.canAddHaccp) {
    document.querySelectorAll('.btn-primary[onclick*="openHaccpModal"]').forEach(function(el) { el.style.display = 'none'; });
  }
  if (!perm.canAddYag) {
    document.querySelectorAll('.btn-primary[onclick*="openYagModal"]').forEach(function(el) { el.style.display = 'none'; });
  }
  if (!perm.canAddAmbalaj) {
    document.querySelectorAll('.btn-primary[onclick*="openAmbalajModal"]').forEach(function(el) { el.style.display = 'none'; });
  }
  if (!perm.canAddKalibrasyon) {
    document.querySelectorAll('.btn-primary[onclick*="openKalibrasyonModal"]').forEach(function(el) { el.style.display = 'none'; });
  }
  if (!perm.canEditHaccp) {
    document.querySelectorAll('#haccpForm textarea, #haccpForm input, #haccpForm select').forEach(function(el) {
      el.readOnly = true; el.disabled = true; el.style.opacity = '0.7';
    });
  }
  if (!perm.canEditDepo) {
    var depoBtn = document.querySelector('button[onclick*="showHaccpDepoYonetim"]');
    if (depoBtn) depoBtn.style.display = 'none';
  }
  if (!perm.canEditHarcamaOran) {
    var hcOran = document.getElementById('hcOran');
    if (hcOran) { hcOran.readOnly = true; hcOran.title = 'Oranı değiştirme yetkiniz yok.'; }
    var hcOranBtn = document.querySelector('button[onclick*="hcKaydetOran"]');
    if (hcOranBtn) hcOranBtn.style.display = 'none';
    var hcPersOran = document.getElementById('hcPersonelOran');
    if (hcPersOran) { hcPersOran.readOnly = true; hcPersOran.title = 'Oranı değiştirme yetkiniz yok.'; }
    var hcPersOranBtn = document.querySelector('button[onclick*="hcKaydetPersonelOran"]');
    if (hcPersOranBtn) hcPersOranBtn.style.display = 'none';
    var hcYemekOran = document.getElementById('hcYemekOran');
    if (hcYemekOran) { hcYemekOran.readOnly = true; hcYemekOran.title = 'Oranı değiştirme yetkiniz yok.'; }
    var hcYemekOranBtn = document.querySelector('button[onclick*="hcKaydetYemekOran"]');
    if (hcYemekOranBtn) hcYemekOranBtn.style.display = 'none';
  }
  if (!perm.canExport) {
    var exRe = /export(Data|AllCSV|DataCSV|DataJSON|DataSettings|HaccpCSV|YemekCSV|YemekListesiPDF|PDF|DashboardPDF|RecordsPDF|ChartsPDF|KalibrasyonCSV)|print(Menu|Report|Qr|YagList|AmbalajList|KalibrasyonList)|triggerImport|importBackupInput|importFullBackup|haccpFileInput|yemekCSVUpload/;
    document.querySelectorAll('button[onclick]').forEach(function(btn) {
      var onclick = btn.getAttribute('onclick') || '';
      if (exRe.test(onclick)) btn.style.display = 'none';
    });
  }
}

function applyRolePermissions() {
  var role = getRole();
  document.querySelectorAll('.tab-btn').forEach(function(btn) { btn.style.display = ''; });
  document.getElementById('adminPanelBtn').style.display = 'none';
  document.querySelectorAll('.sidebar-actions .tab-btn').forEach(function(btn) { btn.style.display = ''; });
  if (role === ROLE_ADMIN) return;
  applyViewerRestrictions();
  var perm = getRolePermissions(role);
  if (!perm) return;
  if (!perm.canSaveMenu) {
    document.querySelectorAll('.menu-table + .menu-hint .btn-primary, #content-menu .btn-primary[onclick*="saveWeeklyMenu"]').forEach(function(el) { el.style.display = 'none'; });
    var saveBtns = document.querySelectorAll('#content-menu button');
    saveBtns.forEach(function(btn) {
      var onclick = btn.getAttribute('onclick') || '';
      if (onclick.includes('saveWeeklyMenu')) btn.style.display = 'none';
    });
  }
  if (!perm.canSeeProduction) {
    var ps = document.getElementById('productionSection');
    if (ps) ps.style.display = 'none';
    var wts = document.getElementById('weeklyTotalSection');
    if (wts) wts.style.display = 'none';
  }
  document.querySelectorAll('.btn-ghost[onclick*="openYemekModal"]').forEach(function(el) { el.style.display = 'none'; });
  if (role === ROLE_ASCI) {
    for (var ci = 0; ci < 5; ci++) {
      for (var di = 0; di < 5; di++) {
        var ta = document.getElementById('m' + ci + '_' + di);
        if (ta) { ta.style.cursor = 'default'; }
      }
    }
  }
}

function populateLoginUsers() {
  var select = document.getElementById('loginUsername');
  if (!select) return;
  var cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
  if (!cfg.users || !Array.isArray(cfg.users)) return;
  // Mevcut seçenekleri temizle (ilk option hariç)
  while (select.options.length > 1) select.remove(1);
  cfg.users.forEach(function(user) {
    var opt = document.createElement('option');
    opt.value = user.username;
    opt.textContent = user.displayName;
    select.appendChild(opt);
  });
  // Beni Hatırla: daha önce seçilmiş kullanıcıyı geri yükle
  var remembered = localStorage.getItem('atik_kontrol_remember_user');
  if (remembered) {
    var found = false;
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value === remembered) { select.selectedIndex = i; found = true; break; }
    }
    var rm = document.getElementById('rememberMe');
    if (found && rm) rm.checked = true;
    if (remembered && !found && rm) rm.checked = false;
  }
}

function rememberLoginUser(username) {
  var rm = document.getElementById('rememberMe');
  if (rm && rm.checked && username) {
    localStorage.setItem('atik_kontrol_remember_user', username);
  } else if (!rm || !rm.checked) {
    localStorage.removeItem('atik_kontrol_remember_user');
  }
}

function togglePwVisibility() {
  var input = document.getElementById('loginPassword');
  if (!input) return;
  var hidden = input.type === 'password';
  input.type = hidden ? 'text' : 'password';
  var wrap = input.closest ? input.closest('.login-field-wrap') : null;
  if (wrap) wrap.classList.toggle('login-password-hidden', hidden);
  var btn = document.getElementById('pwToggle');
  if (btn) btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
}

function showForgotPw() {
  var modal = document.getElementById('loginForgotModal');
  if (modal) modal.classList.add('open');
}

function hideForgotPw() {
  var modal = document.getElementById('loginForgotModal');
  if (modal) modal.classList.remove('open');
}

function openSupport() {
  showToast('Destek için lütfen Sistem Yöneticinizle iletişime geçin.', 'info');
}


// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Önce Supabase Auth'u başlat (session varsa otomatik giriş yapar)
  await initSupabaseAuth();

  loadRolePermissions();
  loadUsersFromStorage();
  await syncUsersFromSupabase();
  populateLoginUsers();
  document.getElementById('loginPassword').focus();

  var existingRole = sessionStorage.getItem('atik_kontrol_role');
  var isSupabaseAuth = isUsingSupabaseAuth();

  if (existingRole) {
    // Supabase Auth ile giriş yapıldıysa session'ı doğrula
    if (isSupabaseAuth && supabaseClient) {
      var { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) {
        // Session geçersiz, legacy'e düş veya login göster
        sessionStorage.removeItem('atik_kontrol_role');
        sessionStorage.removeItem('atik_kontrol_supabase_auth');
      }
    }
    existingRole = sessionStorage.getItem('atik_kontrol_role');
    if (existingRole) {
      document.getElementById('loginOverlay').classList.add('hidden');
      document.body.setAttribute('data-role', existingRole);
      var displayName = sessionStorage.getItem('atik_kontrol_display_name') || (existingRole === ROLE_ADMIN ? 'Admin' : 'Görüntüleme');
      document.getElementById('roleBadge').textContent = displayName;
      renderAdminPanelBtn();
      applyRolePermissions();
    }
  }

  if (!sessionStorage.getItem('atik_kontrol_role')) {
    await new Promise(resolve => {
      window._loginResolve = resolve;
      window._loginAttempts = 0;
    });
  }

  loadAccent();
  setLoadingText('Veriler yükleniyor...', 'Supabase bağlantısı kontrol ediliyor');
  loadData();
  loadHaccpData();
  loadYagData();
  loadAmbalajData();
  loadKalibrasyonData();

  // Records her sayfa yüklenişinde Supabase'ten çekilir (çoklu cihaz desteği)
  if (supabaseClient) {
    setLoadingText('Veriler yükleniyor...', 'Sunucudan veriler alınıyor...');
    try {
      var { data: rData } = await supabaseClient.from('records').select('*').order('tarih', { ascending: false });
      if (rData && rData.length > 0) {
        var serverIds = new Set(rData.map(function(r) { return Number(r.id); }));
        var localIds = new Set(records.map(function(r) { return r.id; }));
        var hasNew = rData.some(function(r) { return !localIds.has(Number(r.id)); });
        var hasRemoved = records.some(function(r) { return !serverIds.has(r.id); });
        if (hasNew || hasRemoved || records.length === 0) {
          records = rData.map(function(r) { return {
            id: Number(r.id) || Date.now() + Math.random(),
            tarih: normalizeDate(r.tarih),
            yemek: Number(r.yemek) || 0, fire: Number(r.fire) || 0,
            turnike: Number(r.turnike) || 0, personel: Number(r.personel) || 0,
            toplam: Number(r.toplam) || 0, porsiyon: Number(r.porsiyon) || 0,
            atik: Number(r.atik) || 0, ogrenci: Number(r.ogrenci) || 0,
            harcama_tutari: Number(r.harcama_tutari) || 0, yemek_adi: r.yemek_adi || ''
          }; });
          records.sort(function(a, b) { return new Date(b.tarih) - new Date(a.tarih); });
          saveData();
        }
      }
    } catch (_) {}
    filteredRecords = [...records];
  }

  if (supabaseClient) {
    await syncRolePermissionsFromSupabase().catch(function(){});
    await syncHarcamaOranlariFromSupabase().catch(function(){});
    await syncUnitPricesFromSupabase().catch(function(){});
  }

  // Yag ve ambalaj her sayfada Supabase'ten çekilir
  if (supabaseClient) {
    try {
      await syncYagFromSupabase();
      if (yagRecords.length > 0) {
        try { sessionStorage.setItem(YAG_STORAGE_KEY, JSON.stringify(yagRecords)); } catch (_) {}
        try { localStorage.removeItem(YAG_STORAGE_KEY); } catch (_) {}
      }
      await syncAmbalajFromSupabase();
      if (ambalajRecords.length > 0) {
        try { sessionStorage.setItem(AMBALAJ_STORAGE_KEY, JSON.stringify(ambalajRecords)); } catch (_) {}
        try { localStorage.removeItem(AMBALAJ_STORAGE_KEY); } catch (_) {}
      }
      await syncKalibrasyonFromSupabase();
      if (kalibrasyonCihazlari.length > 0) {
        try { sessionStorage.setItem(KALIBRASYON_STORAGE_KEY, JSON.stringify(kalibrasyonCihazlari)); } catch (_) {}
        try { localStorage.removeItem(KALIBRASYON_STORAGE_KEY); } catch (_) {}
      }
      await syncDishesFromSupabase();
    } catch (_) {}
  }

  // YemeklerCache boşsa yine de dene
  if (!yemeklerCache.length && supabaseClient) {
    await syncDishesFromSupabase();
  }

  // HACCP (soğuk depo sıcaklık) verileri her sayfa yüklenişinde Supabase'ten çekilir
  if (supabaseClient) {
    await syncHaccpFromSupabase();
    if (haccpRecords.length > 0) {
      try { sessionStorage.setItem(HACCP_STORAGE_KEY, JSON.stringify(haccpRecords)); } catch (_) {}
      try { localStorage.removeItem(HACCP_STORAGE_KEY); } catch (_) {}
    }
  }

  setCurrentDate();
  if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.version) {
    var vLabel = document.getElementById('appVersionLabel');
    if (vLabel) vLabel.textContent = 'v' + APP_CONFIG.version;
  }
  renderAll();
  drawAllCharts();
  await restoreActiveTab();
  menuOnayBildirim();

  // Güvenlik: 10 sn sonra loading overlay'i zorla kapat
  var forceHideTimer = setTimeout(function() {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }, 10000);

  setLoadingSub('Uygulama başlatılıyor...');
  clearTimeout(forceHideTimer);

  refreshMenuProduction();
  initDishAutocomplete();

  // Ana içeriğe tıklayınca sidebar'ı kapat
  var mc = document.querySelector('.main-content');
  if (mc) mc.addEventListener('click', function(e) {
    if (document.querySelector('.sidebar').classList.contains('open')) closeSidebar();
  });

  // Loading overlay'i kapat
  document.getElementById('loadingOverlay').classList.add('hidden');

  setConnectionStatus('ok');
  showSyncTime('hazır');
  startPolling();
  resetInactivityTimer();
});

// ─── AUTO POLL & INACTIVITY LOCK ─────────────────────────────────────────────
let pollInterval = null;
let inactivityTimer = null;
const POLL_INTERVAL = 180000;

function startPolling() {
  stopPolling();
  pollInterval = setInterval(function() {
    if (!supabaseClient) return;
    supabaseClient.from('records').select('*').order('tarih', { ascending: false }).then(function({ data }) {
      if (!data || data.length === 0) return;
      var serverIds = new Set(data.map(function(r) { return Number(r.id); }));
      var localIds = new Set(records.map(function(r) { return r.id; }));
      var hasNew = data.some(function(r) { return !localIds.has(Number(r.id)); });
      var hasRemoved = records.some(function(r) { return !serverIds.has(r.id); });
      if (!hasNew && !hasRemoved) { showSyncTime('otomatik • güncel'); return; }
      records = data.map(function(r) { return {
        id: Number(r.id) || Date.now() + Math.random(),
        tarih: normalizeDate(r.tarih),
        yemek: Number(r.yemek) || 0, fire: Number(r.fire) || 0,
        turnike: Number(r.turnike) || 0, personel: Number(r.personel) || 0,
        toplam: Number(r.toplam) || 0, porsiyon: Number(r.porsiyon) || 0,
        atik: Number(r.atik) || 0, ogrenci: Number(r.ogrenci) || 0,
        harcama_tutari: Number(r.harcama_tutari) || 0, yemek_adi: r.yemek_adi || ''
      }; });
      records.sort(function(a, b) { return new Date(b.tarih) - new Date(a.tarih); });
      saveData();
      filteredRecords = [...records];
      renderAll();
      drawAllCharts();
      showSyncTime('otomatik • güncellendi');
    }).catch(function() {});
  }, POLL_INTERVAL);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  if (!inactivityTimeoutMs) return;
  if (getRole()) {
    inactivityTimer = setTimeout(lockScreen, inactivityTimeoutMs);
  }
}

function apRenderInactivityTimeout() {
  var sel = document.getElementById('apInactivityTimeout');
  if (!sel) return;
  sel.value = String(inactivityTimeoutMs);
  if (sel.selectedIndex < 0) sel.value = '300000';
}

function lockScreen() {
  logIslem('logout', (sessionStorage.getItem('atik_kontrol_display_name') || 'bilinmiyor') + ' oturumu kapattı');
  stopPolling();
  if (supabaseClient && isUsingSupabaseAuth()) {
    supabaseClient.auth.signOut();
  }
  sessionStorage.removeItem('atik_kontrol_role');
  document.getElementById('loginOverlay').classList.remove('hidden');
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').style.display = 'none';
  document.getElementById('loginPassword').focus();
}

['click', 'keydown', 'touchstart', 'mousemove'].forEach(function(evt) {
  document.addEventListener(evt, resetInactivityTimer);
});

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
  // DD.MM.YYYY veya DD/MM/YYYY (Türkiye formatı)
  var m = v.match(/^(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
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

function displayDate(dateStr) {
  if (!dateStr) return '—';
  var n = normalizeDate(dateStr);
  if (!n) return '—';
  var d = new Date(n + 'T12:00:00');
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
    // sessionStorage'den oku (sekme bazlı, kapanınca silinir)
    var stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      records = JSON.parse(stored);
    } else {
      // localStorage'dan migrate et (eski kullanıcılar için) ve temizle
      stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        records = JSON.parse(stored);
        try { sessionStorage.setItem(STORAGE_KEY, stored); } catch (_) {}
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      } else {
        records = [];
      }
    }
  } catch (e) {
    records = [];
  }
  records.forEach(function(r) { if (r.tarih) r.tarih = normalizeDate(r.tarih); });
  filteredRecords = [...records];
}

function saveData() { if (!requireAdmin()) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    // Storage full or unavailable - ignore silently
  }
  setTimeout(function() { syncRecordsToSupabase(); }, 0);
  lastPollData = null;
  showSyncTime('kaydedildi');
}

async function syncRecordsToSupabase() {
  if (!supabaseClient || records.length === 0) return;
  try {
    var { error } = await supabaseClient.from('records').upsert(records, { onConflict: 'id' });
    if (error) console.warn('Supabase sync error:', error);
  } catch (_) {}
}

async function refreshRecordsFromSupabase() {
  if (!supabaseClient) return;
  try {
    var { data } = await supabaseClient.from('records').select('*').order('tarih', { ascending: false });
    if (data && data.length > 0) {
      var serverIds = new Set(data.map(function(r) { return Number(r.id); }));
      var localIds = new Set(records.map(function(r) { return r.id; }));
      var hasNew = data.some(function(r) { return !localIds.has(Number(r.id)); });
      var hasRemoved = records.some(function(r) { return !serverIds.has(r.id); });
      if (hasNew || hasRemoved || records.length === 0) {
        records = data.map(function(r) { return {
          id: Number(r.id) || Date.now() + Math.random(),
          tarih: normalizeDate(r.tarih),
          yemek: Number(r.yemek) || 0, fire: Number(r.fire) || 0,
          turnike: Number(r.turnike) || 0, personel: Number(r.personel) || 0,
          toplam: Number(r.toplam) || 0, porsiyon: Number(r.porsiyon) || 0,
          atik: Number(r.atik) || 0, ogrenci: Number(r.ogrenci) || 0,
          harcama_tutari: Number(r.harcama_tutari) || 0, yemek_adi: r.yemek_adi || ''
        }; });
        records.sort(function(a, b) { return new Date(b.tarih) - new Date(a.tarih); });
        saveData();
        filteredRecords = [...records];
        renderRecordsTable();
        renderAll();
        drawAllCharts();
      }
    }
  } catch (_) {}
}

function parseNumComma(v) {
  if (v == null || v === '') return null;
  return Number(String(v).replace(',', '.'));
}

// ─── ÖĞRENCİ BAŞINA HARCAMA ORANI ────────────────────────────────────────────
const HARCAMA_ORAN_SUPABASE_KEY = 'harcama_oranlari';
function getOgrenciBasiHarcamaOrani() {
  var val = localStorage.getItem('ogrenci_basi_harcama_orani');
  return val !== null ? parseFloat(val) : 70.37;
}
function setOgrenciBasiHarcamaOrani(val) {
  localStorage.setItem('ogrenci_basi_harcama_orani', String(val));
  syncHarcamaOranlariToSupabase();
}

// ─── PERSONEL BAŞINA HARCAMA ORANI ───────────────────────────────────────────
function getPersonelBasiHarcamaOrani() {
  var val = localStorage.getItem('personel_basi_harcama_orani');
  return val !== null ? parseFloat(val) : 50.00;
}
function setPersonelBasiHarcamaOrani(val) {
  localStorage.setItem('personel_basi_harcama_orani', String(val));
  syncHarcamaOranlariToSupabase();
}

// ─── ÜRETİLEN YEMEK BAŞINA HARCAMA ORANI ─────────────────────────────────────
function getUretilenYemekBasiHarcamaOrani() {
  var val = localStorage.getItem('uretilen_yemek_basi_harcama_orani');
  return val !== null ? parseFloat(val) : 12.00;
}
function setUretilenYemekBasiHarcamaOrani(val) {
  localStorage.setItem('uretilen_yemek_basi_harcama_orani', String(val));
  syncHarcamaOranlariToSupabase();
}

// ─── SUPABASE HARCAMA ORAN SENKRONİZASYONU ───────────────────────────────────
async function syncHarcamaOranlariToSupabase() {
  if (!supabaseClient) return;
  try {
    var payload = {
      ogrenci: getOgrenciBasiHarcamaOrani(),
      personel: getPersonelBasiHarcamaOrani(),
      uretilenYemek: getUretilenYemekBasiHarcamaOrani()
    };
    var { error } = await supabaseClient.from('config').upsert(
      { key: HARCAMA_ORAN_SUPABASE_KEY, value: JSON.stringify(payload), last_modified: new Date().toISOString() },
      { onConflict: 'key' }
    );
  } catch (_) {}
}

async function syncHarcamaOranlariFromSupabase() {
  if (!supabaseClient) return false;
  try {
    var { data, error } = await supabaseClient.from('config').select('value').eq('key', HARCAMA_ORAN_SUPABASE_KEY).single();
    if (error || !data || !data.value) return false;
    var parsed = JSON.parse(data.value);
    if (parsed && typeof parsed === 'object') {
      if (parsed.ogrenci != null) localStorage.setItem('ogrenci_basi_harcama_orani', String(parsed.ogrenci));
      if (parsed.personel != null) localStorage.setItem('personel_basi_harcama_orani', String(parsed.personel));
      if (parsed.uretilenYemek != null) localStorage.setItem('uretilen_yemek_basi_harcama_orani', String(parsed.uretilenYemek));
      return true;
    }
    return false;
  } catch (_) { return false; }
}

// ─── BİRİM FİYAT LİSTESİ ────────────────────────────────────────────────────
const UNIT_PRICES_SUPABASE_KEY = 'unit_prices';

function loadUnitPrices() { return unitPricesCache; }

function saveUnitPrices(list) {
  unitPricesCache = list;
}

async function addUnitPrice(urun_adi, birim, birim_fiyat, yil, birim_carpan) {
  var item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    urun_adi: urun_adi.trim(),
    birim: birim || 'kg',
    birim_fiyat: parseFloat(birim_fiyat) || 0,
    yil: parseInt(yil) || new Date().getFullYear(),
    birim_carpan: parseFloat(birim_carpan) || 0
  };
  unitPricesCache.push(item);
  if (supabaseClient) {
    try {
      var { error } = await supabaseClient.from(UNIT_PRICES_SUPABASE_KEY).upsert(
        { id: item.id, urun_adi: item.urun_adi, birim: item.birim, birim_fiyat: item.birim_fiyat, yil: item.yil, birim_carpan: item.birim_carpan },
        { onConflict: 'id' }
      );
      if (error) throw error;
    } catch (e) { console.error('Supabase addUnitPrice error:', e); }
  }
}

async function editUnitPrice(id, alanlar) {
  var item = unitPricesCache.find(function(p) { return p.id === id; });
  if (!item) return;
  if (alanlar.urun_adi !== undefined) item.urun_adi = alanlar.urun_adi.trim();
  if (alanlar.birim !== undefined) item.birim = alanlar.birim;
  if (alanlar.birim_fiyat !== undefined) item.birim_fiyat = parseFloat(alanlar.birim_fiyat) || 0;
  if (alanlar.yil !== undefined) item.yil = parseInt(alanlar.yil) || item.yil;
  if (alanlar.birim_carpan !== undefined) item.birim_carpan = parseFloat(alanlar.birim_carpan) || 0;
  if (supabaseClient) {
    try {
      var { error } = await supabaseClient.from(UNIT_PRICES_SUPABASE_KEY).upsert(
        { id: item.id, urun_adi: item.urun_adi, birim: item.birim, birim_fiyat: item.birim_fiyat, yil: item.yil, birim_carpan: item.birim_carpan || 0 },
        { onConflict: 'id' }
      );
      if (error) throw error;
    } catch (e) { console.error('Supabase editUnitPrice error:', e); }
  }
}

async function deleteUnitPrice(id) {
  unitPricesCache = unitPricesCache.filter(function(p) { return p.id !== id; });
  if (supabaseClient) {
    try {
      var { error } = await supabaseClient.from(UNIT_PRICES_SUPABASE_KEY).delete().eq('id', id);
      if (error) throw error;
    } catch (e) { console.error('Supabase deleteUnitPrice error:', e); }
  }
}

function bfBulDuplike() {
  var groups = {};
  unitPricesCache.forEach(function(p) {
    var key = normIsim(p.urun_adi) + '|' + p.yil;
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });
  var duplar = [];
  Object.keys(groups).forEach(function(k) {
    if (groups[k].length > 1) duplar.push(groups[k]);
  });
  return duplar;
}

async function bfTemizleDuplike(grup) {
  if (!canEditBirimFiyat()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  var enIyi = grup.reduce(function(a, b) { return a.birim_fiyat > b.birim_fiyat ? a : b; });
  for (var i = 0; i < grup.length; i++) {
    if (grup[i].id !== enIyi.id) {
      await deleteUnitPrice(grup[i].id);
    }
  }
  renderBirimFiyatlar();
  showToast('Duplike kayıtlar temizlendi. En yüksek fiyat korundu.', 'success');
}

async function bfTumDuplariTemizle() {
  if (!canEditBirimFiyat()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  var duplar = bfBulDuplike();
  if (duplar.length === 0) { showToast('Duplike kayıt bulunamadı.', 'info'); return; }
  for (var d = 0; d < duplar.length; d++) {
    var grup = duplar[d];
    var enIyi = grup.reduce(function(a, b) { return a.birim_fiyat > b.birim_fiyat ? a : b; });
    for (var i = 0; i < grup.length; i++) {
      if (grup[i].id !== enIyi.id) {
        await deleteUnitPrice(grup[i].id);
      }
    }
  }
  renderBirimFiyatlar();
  showToast(duplar.length + ' grupta toplam ' + duplar.reduce(function(s, g) { return s + g.length - 1; }, 0) + ' duplike kayıt silindi.', 'success');
}

async function syncUnitPricesFromSupabase() {
  if (!supabaseClient) return false;
  try {
    var { data, error } = await supabaseClient.from(UNIT_PRICES_SUPABASE_KEY).select('*');
    if (error || !data) return false;
    if (data.length > 0) {
      unitPricesCache = data.map(function(p) {
        return {
          id: String(p.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
          urun_adi: String(p.urun_adi || '').trim(),
          birim: String(p.birim || 'kg').trim(),
          birim_fiyat: parseFloat(p.birim_fiyat) || 0,
          yil: parseInt(p.yil) || new Date().getFullYear(),
          birim_carpan: parseFloat(p.birim_carpan) || 0
        };
      });
      return true;
    }
    return false;
  } catch (_) { return false; }
}

function normBirimGlobal(b) {
  var s = (b || 'gr').toString().trim().toLowerCase().replace(/\s/g, '');
  if (/^g(ram|rams|ramaj)?$/.test(s)) return 'gr';
  if (/^l(itre|itr|t)?$/.test(s)) return 'litre';
  if (/^m(l|ili(litre)?)?$/.test(s)) return 'ml';
  if (/^t(enek(e)?)?$/.test(s)) return 'teneke';
  if (/^kol(i)?$/.test(s)) return 'koli';
  if (/^adet$/.test(s)) return 'adet';
  return s;
}

function normIsim(s) {
  return s.trim().toLowerCase()
    .replace(/İ/g, 'i').replace(/ı/g, 'i').replace(/I/g, 'i')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c');
}

function findBirimFiyat(malzemeAdi, birim) {
  var currentYear = new Date().getFullYear();
  var normalized = normIsim(malzemeAdi);
  var birimN = normBirimGlobal(birim);

  function birimTarget(bn) {
    if (bn === 'gr') return ['kg', 'teneke'];
    if (bn === 'ml') return ['litre', 'teneke'];
    if (bn === 'litre') return ['teneke', 'ml'];
    if (bn === 'kg') return ['teneke', 'gr'];
    if (bn === 'teneke') return ['litre', 'kg'];
    return [];
  }

  var exactYearBirim = unitPricesCache.filter(function(p) {
    return normIsim(p.urun_adi) === normalized && p.yil === currentYear && normBirimGlobal(p.birim) === birimN;
  });
  if (exactYearBirim.length > 0) return exactYearBirim[exactYearBirim.length - 1];

  var exactYear = unitPricesCache.filter(function(p) {
    return normIsim(p.urun_adi) === normalized && p.yil === currentYear;
  });
  if (exactYear.length > 0) {
    var targets = birimTarget(birimN);
    for (var t = 0; t < targets.length; t++) {
      var fb = exactYear.find(function(p) { return normBirimGlobal(p.birim) === targets[t]; });
      if (fb) return fb;
    }
    return exactYear[exactYear.length - 1];
  }

  var matches = unitPricesCache.filter(function(p) {
    return normIsim(p.urun_adi) === normalized;
  });
  if (matches.length === 0) return null;
  var exact = matches.find(function(p) { return normBirimGlobal(p.birim) === birimN; });
  if (exact) return exact;
  var targets2 = birimTarget(birimN);
  for (var t2 = 0; t2 < targets2.length; t2++) {
    var fb2 = matches.find(function(p) { return normBirimGlobal(p.birim) === targets2[t2]; });
    if (fb2) return fb2;
  }
  return matches[matches.length - 1];
}

var BIRIM_CARPAN = {
  'kg|gr': 1000,
  'gr|kg': 0.001,
  'litre|ml': 1000,
  'ml|litre': 0.001,
  'teneke|lt': 18,
  'lt|teneke': 1/18,
  'teneke|litre': 18,
  'litre|teneke': 1/18,
  'koli|kg': 10,
  'kg|koli': 0.1,
  'koli|gr': 10000,
  'gr|koli': 0.0001
};

function birimDonusum(miktar, fromBirim, toBirim, urunCarpan) {
  var from = normBirimGlobal(fromBirim);
  var to = normBirimGlobal(toBirim);
  if (from === to) return miktar;

  var pair = from + '|' + to;
  if (urunCarpan && urunCarpan > 0) {
    var fromPair = from + '|' + normBirimGlobal('lt');
    var toPair = to + '|' + normBirimGlobal('lt');
    if (from === 'teneke' && to === 'lt') return miktar * urunCarpan;
    if (from === 'lt' && to === 'teneke') return miktar / urunCarpan;
    if (from === 'teneke' && to === 'ml') return miktar * urunCarpan * 1000;
    if (from === 'ml' && to === 'teneke') return miktar / (urunCarpan * 1000);
    if (from === 'teneke' && to === 'gr') return miktar * urunCarpan * 1000;
    if (from === 'gr' && to === 'teneke') return miktar / (urunCarpan * 1000);
    if (from === 'teneke' && to === 'kg') return miktar * urunCarpan;
    if (from === 'kg' && to === 'teneke') return miktar / urunCarpan;
    if (from === 'koli' && to === 'kg') return miktar * urunCarpan;
    if (from === 'kg' && to === 'koli') return miktar / urunCarpan;
    if (from === 'koli' && to === 'gr') return miktar * urunCarpan * 1000;
    if (from === 'gr' && to === 'koli') return miktar / (urunCarpan * 1000);
  }

  if (BIRIM_CARPAN[pair]) return miktar * BIRIM_CARPAN[pair];
  var rPair = to + '|' + from;
  if (BIRIM_CARPAN[rPair]) return miktar / BIRIM_CARPAN[rPair];

  if (from === 'gr' && to === 'kg') return miktar / 1000;
  if (from === 'kg' && to === 'gr') return miktar * 1000;
  if (from === 'ml' && to === 'litre') return miktar / 1000;
  if (from === 'litre' && to === 'ml') return miktar * 1000;
  if (from === 'lt' && to === 'ml') return miktar * 1000;
  if (from === 'ml' && to === 'lt') return miktar / 1000;
  if (from === 'lt' && to === 'litre') return miktar;
  if (from === 'litre' && to === 'lt') return miktar;

  return miktar;
}

function birimFiyatTutar(malzemeAdi, birim, miktar) {
  var fp = findBirimFiyat(malzemeAdi, birim);
  if (!fp) return null;
  var birimNorm = normBirimGlobal(birim);
  var fiyatBirim = normBirimGlobal(fp.birim);
  if (birimNorm === fiyatBirim) return miktar * fp.birim_fiyat;
  var carpan = fp.birim_carpan || 0;
  var donusumMiktari = birimDonusum(miktar, birimNorm, fiyatBirim, carpan > 0 ? carpan : null);
  return donusumMiktari * fp.birim_fiyat;
}

let birimFiyatSeciliYil = new Date().getFullYear();

function renderBirimFiyatlar() {
  var container = document.getElementById('content-birimfiyat');
  if (!container) return;

  var currentYear = new Date().getFullYear();
  var years = [];
  for (var y = currentYear + 5; y >= currentYear - 5; y--) years.push(y);

  var filtered = unitPricesCache.filter(function(p) { return p.yil === birimFiyatSeciliYil; });
  filtered.sort(function(a, b) { return a.urun_adi.localeCompare(b.urun_adi, 'tr'); });

  var BF_PAGE_SIZE = 50;
  if (!window._bfPage) window._bfPage = 1;
  var bfToplamSayfa = Math.max(1, Math.ceil(filtered.length / BF_PAGE_SIZE));
  if (window._bfPage > bfToplamSayfa) window._bfPage = bfToplamSayfa;
  var bfStart = (window._bfPage - 1) * BF_PAGE_SIZE;
  var bfSlice = filtered.slice(bfStart, bfStart + BF_PAGE_SIZE);

  var toplamTutar = filtered.reduce(function(s, p) { return s + p.birim_fiyat; }, 0);
  var ortalama = filtered.length > 0 ? toplamTutar / filtered.length : 0;
  var bfPerms = canEditBirimFiyat();

  container.innerHTML = `
    <div class="section-card">
      <div class="section-header">
        <h2>Ürün ve Birim Fiyat Listesi</h2>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
          <div style="display:flex;align-items:center;border:1px solid var(--border);border-radius:8px;overflow:hidden">
            <button class="btn btn-ghost btn-sm" onclick="bfYilDegistir(-1)" style="border:none;border-radius:0;padding:6px 10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg></button>
            <span id="bfYilGoster" style="padding:6px 14px;font-weight:700;font-size:0.95rem;color:var(--text-primary);min-width:50px;text-align:center;cursor:pointer;user-select:none" title="Tıkla, yıl seç" onclick="bfYilSeciciAc()">${birimFiyatSeciliYil}</span>
            <button class="btn btn-ghost btn-sm" onclick="bfYilDegistir(1)" style="border:none;border-radius:0;padding:6px 10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg></button>
          </div>
          ${bfPerms ? '<button class="btn btn-primary btn-sm" onclick="bfYeniUrun()">+ Yeni Ürün</button>' : ''}
          <button class="btn btn-ghost btn-sm" onclick="bfExportCSV()">CSV İndir</button>
          <button class="btn btn-ghost btn-sm" onclick="printBirimFiyatlar()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Yazdır
          </button>
          ${bfPerms ? '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'bfCSVUpload\').click()">CSV Yükle</button>' : ''}
          <input type="file" id="bfCSVUpload" accept=".csv,.txt" style="display:none" onchange="bfImportCSV(event)" />
        </div>
      </div>
      <div class="bf-kpi-grid">
        <div class="bf-kpi kayitli"><div class="bf-kpi-value">${filtered.length}</div><div class="bf-kpi-label">Kayıtlı Ürün</div></div>
        <div class="bf-kpi toplam"><div class="bf-kpi-value">${formatTRY(toplamTutar)}</div><div class="bf-kpi-label">Toplam Tutar</div></div>
        <div class="bf-kpi ortalama"><div class="bf-kpi-value">${formatTRY(ortalama)}</div><div class="bf-kpi-label">Ortalama Birim Fiyat</div></div>
        <div class="bf-kpi fiyat"><div class="bf-kpi-value">${birimFiyatSeciliYil}</div><div class="bf-kpi-label">Seçili Yıl</div></div>
      </div>
      ${bfBulDuplike().length > 0 ? '<div style="padding:0.6rem 0.8rem;background:rgba(250,204,21,0.12);border:1px solid rgba(250,204,21,0.4);border-radius:8px;margin-bottom:0.75rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem"><span style="font-size:0.82rem;color:#ca8a04;font-weight:600">⚠️ ' + bfBulDuplike().length + ' üründe tekrar eden kayıt bulundu. Fiyat hesaplamalarında hata olabilir.</span>' + (bfPerms ? '<button class="btn btn-ghost btn-sm" style="color:#ca8a04;border:1px solid rgba(250,204,21,0.4)" onclick="bfTumDuplariTemizle()">Tek Tek Temizle</button>' : '') + '</div>' : ''}
      <div id="bfFormContainer" style="display:none;margin-bottom:1rem"></div>
      <div class="table-wrapper">
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th style="text-align:left;width:30%">Ürün Adı</th>
              <th style="text-align:center;width:12%">Birim</th>
              <th style="text-align:center;width:18%">Birim Fiyat (₺)</th>
              <th style="text-align:center;width:18%">1 Birim =</th>
              <th style="text-align:center;width:10%">Yıl</th>
              ${bfPerms ? '<th style="text-align:center;width:12%">İşlem</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${bfSlice.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem">Bu yıl için henüz ürün eklenmemiş.</td></tr>' : ''}
            ${bfSlice.map(function(p) {
              var carpanGoster = p.birim_carpan > 0 ? p.birim_carpan + ' ' + (p.birim === 'teneke' ? 'lt' : p.birim === 'koli' ? 'kg' : p.birim === 'kg' ? 'gr' : p.birim === 'litre' ? 'ml' : '') : '—';
              return '<tr data-id="' + p.id + '">' +
                '<td style="text-align:left"><strong>' + escapeHtml(p.urun_adi) + '</strong></td>' +
                '<td style="text-align:center">' + escapeHtml(p.birim) + '</td>' +
                '<td style="text-align:center;font-weight:600;color:var(--accent-cyan)">' + p.birim_fiyat.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺</td>' +
                '<td style="text-align:center;font-size:0.8rem;color:var(--text-dim)">' + carpanGoster + '</td>' +
                '<td style="text-align:center">' + p.yil + '</td>' +
                (bfPerms ?
                  '<td style="text-align:center;white-space:nowrap">' +
                    '<button class="btn-icon btn-sm" onclick="bfDuzenle(\'' + p.id + '\')" title="Düzenle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
                    '<button class="btn-icon btn-sm" onclick="bfSil(\'' + p.id + '\')" title="Sil" style="color:var(--danger)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>' +
                  '</td>' : '') +
                '</td>';
            }).join('')}
          </tbody>
        </table>
      </div>
      ${bfToplamSayfa > 1 ? '<div style="display:flex;justify-content:center;align-items:center;gap:0.4rem;margin-top:0.75rem;flex-wrap:wrap">' +
        '<button class="btn btn-ghost btn-sm" onclick="window._bfPage=1;renderBirimFiyatlar()" ' + (window._bfPage === 1 ? 'disabled' : '') + '>&laquo;</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="window._bfPage--;renderBirimFiyatlar()" ' + (window._bfPage === 1 ? 'disabled' : '') + '>&lsaquo;</button>' +
        '<span style="font-size:0.85rem;color:var(--text-dim);padding:0 8px">Sayfa ' + window._bfPage + ' / ' + bfToplamSayfa + '</span>' +
        '<button class="btn btn-ghost btn-sm" onclick="window._bfPage++;renderBirimFiyatlar()" ' + (window._bfPage >= bfToplamSayfa ? 'disabled' : '') + '>&rsaquo;</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="window._bfPage=' + bfToplamSayfa + ';renderBirimFiyatlar()" ' + (window._bfPage >= bfToplamSayfa ? 'disabled' : '') + '>&raquo;</button>' +
      '</div>' : ''}
      <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.5rem">Toplam ${filtered.length} ürün${bfToplamSayfa > 1 ? ' | Sayfa ' + window._bfPage + '/' + bfToplamSayfa : ''} | Fiyatlar yıl bazlıdır. Eşleşme: Malzeme adı normalize edilerek otomatik eşleştirilir.</div>
    </div>
  `;
}

function bfYilDegistir(delta) {
  birimFiyatSeciliYil += delta;
  window._bfPage = 1;
  renderBirimFiyatlar();
}

function bfYilSeciciAc() {
  var mevcut = birimFiyatSeciliYil;
  var sonYil = mevcut + 10;
  var ilkYil = mevcut - 10;
  var yillar = [];
  for (var y = sonYil; y >= ilkYil; y--) yillar.push(y);
  var yillarHtml = yillar.map(function(y) {
    var bg = y === mevcut ? 'var(--accent-cyan)' : 'transparent';
    var fg = y === mevcut ? '#fff' : 'var(--text-primary)';
    var fw = y === mevcut ? '700' : '400';
    return '<div class="bf-ypick-yil" style="cursor:pointer;padding:0.45rem 0;text-align:center;border-radius:6px;font-weight:' + fw + ';font-size:0.88rem;color:' + fg + ';background:' + bg + ';transition:all 0.15s" onmouseover="this.style.background=\'var(--bg-hover)\'" onmouseout="this.style.background=\'' + bg + '\'" onclick="birimFiyatSeciliYil=' + y + ';window._bfPage=1;renderBirimFiyatlar()">' + y + '</div>';
  }).join('');

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = '<div class="modal sync-panel" style="max-width:340px"><div class="modal-header"><h2 style="font-size:1rem">Yıl Seç</h2><button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div><div class="modal-body" style="padding:0.75rem"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.35rem">' + yillarHtml + '</div></div></div>';
  document.body.appendChild(overlay);
}

let bfDuzenlemeId = null;

function bfYeniUrun() {
  if (!canEditBirimFiyat()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  bfDuzenlemeId = null;
  var form = document.getElementById('bfFormContainer');
  if (!form) return;
  form.style.display = 'block';
  form.innerHTML = `<div style="padding:0.75rem;background:var(--bg-card);border-radius:var(--radius-sm);border:1px solid var(--border)">
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:end">
      <div style="flex:4;min-width:200px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">Ürün Adı</label>
        <input type="text" id="bf_ad" placeholder="Örn: Domates" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem" />
      </div>
      <div style="flex:0.5;min-width:80px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">Birim</label>
        <select id="bf_birim" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem">
          <option value="kg">KG</option>
          <option value="koli">KOLİ</option>
          <option value="litre">LİTRE</option>
          <option value="adet">ADET</option>
          <option value="teneke">TENEKE</option>
        </select>
      </div>
      <div style="flex:1;min-width:100px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">Birim Fiyat (₺)</label>
        <input type="number" id="bf_fiyat" step="0.01" min="0" placeholder="0.00" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem" />
      </div>
      <div style="flex:0.8;min-width:90px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">1 Birim = X (alt birim)</label>
        <input type="number" id="bf_carpan" step="any" min="0" placeholder="Örn: 18" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem" />
        <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px">teneke=18, koli=10</div>
      </div>
      <div style="display:flex;gap:0.3rem;align-items:end;padding-bottom:1px">
        <button class="btn btn-primary btn-sm" onclick="bfKaydet()">Kaydet</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('bfFormContainer').style.display='none'">İptal</button>
      </div>
    </div>
  </div>`;
  document.getElementById('bf_ad').focus();
}

function bfDuzenle(id) {
  var item = unitPricesCache.find(function(p) { return p.id === id; });
  if (!item) return;
  bfDuzenlemeId = id;
  var form = document.getElementById('bfFormContainer');
  if (!form) return;
  form.style.display = 'block';
  form.innerHTML = `<div style="padding:0.75rem;background:var(--bg-card);border-radius:var(--radius-sm);border:1px solid var(--border)">
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:end">
      <div style="flex:2;min-width:140px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">Ürün Adı</label>
        <input type="text" id="bf_ad" value="${escapeHtml(item.urun_adi)}" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem" />
      </div>
      <div style="flex:0.5;min-width:80px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">Birim</label>
        <select id="bf_birim" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem">
          <option value="kg"${item.birim === 'kg' ? ' selected' : ''}>KG</option>
          <option value="koli"${item.birim === 'koli' ? ' selected' : ''}>KOLİ</option>
          <option value="litre"${item.birim === 'litre' ? ' selected' : ''}>LİTRE</option>
          <option value="adet"${item.birim === 'adet' ? ' selected' : ''}>ADET</option>
          <option value="teneke"${item.birim === 'teneke' ? ' selected' : ''}>TENEKE</option>
        </select>
      </div>
      <div style="flex:1;min-width:100px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">Birim Fiyat (₺)</label>
        <input type="number" id="bf_fiyat" step="0.01" min="0" value="${item.birim_fiyat}" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem" />
      </div>
      <div style="flex:0.8;min-width:90px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">1 Birim = X (alt birim)</label>
        <input type="number" id="bf_carpan" step="any" min="0" value="${item.birim_carpan || ''}" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem" />
        <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px">teneke=18, koli=10</div>
      </div>
      <div style="display:flex;gap:0.3rem;align-items:end;padding-bottom:1px">
        <button class="btn btn-primary btn-sm" onclick="bfKaydet()">Güncelle</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('bfFormContainer').style.display='none'">İptal</button>
      </div>
    </div>
  </div>`;
  document.getElementById('bf_ad').focus();
}

function bfKaydet() {
  if (!canEditBirimFiyat()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  var ad = (document.getElementById('bf_ad').value || '').trim();
  var birim = document.getElementById('bf_birim').value;
  var fiyat = parseFloat(document.getElementById('bf_fiyat').value) || 0;
  var carpan = parseFloat(document.getElementById('bf_carpan').value) || 0;
  if (!ad) { showToast('Ürün adı zorunludur.', 'error'); return; }
  if (fiyat <= 0) { showToast('Geçerli bir fiyat girin.', 'error'); return; }
  if (bfDuzenlemeId) {
    editUnitPrice(bfDuzenlemeId, { urun_adi: ad, birim: birim, birim_fiyat: fiyat, birim_carpan: carpan });
    showToast('Ürün güncellendi.', 'success');
  } else {
    addUnitPrice(ad, birim, fiyat, birimFiyatSeciliYil, carpan);
    showToast('Ürün eklendi.', 'success');
  }
  document.getElementById('bfFormContainer').style.display = 'none';
  bfDuzenlemeId = null;
  renderBirimFiyatlar();
}

function bfSil(id) {
  if (!canEditBirimFiyat()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  if (!confirm('Bu ürünü silmek istediğinize emin misiniz?')) return;
  deleteUnitPrice(id);
  showToast('Ürün silindi.', 'success');
  renderBirimFiyatlar();
}

function bfExportCSV() {
  var filtered = unitPricesCache.filter(function(p) { return p.yil === birimFiyatSeciliYil; });
  if (!filtered.length) { showToast('Dışa aktarılacak ürün yok.', 'error'); return; }
  var rows = [['Ürün Adı', 'Birim', 'Birim Fiyat (₺)', 'Yıl']];
  filtered.forEach(function(p) { rows.push([p.urun_adi, p.birim, p.birim_fiyat, p.yil]); });
  var csv = rows.map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\n');
  var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'birim_fiyatlar_' + birimFiyatSeciliYil + '.csv';
  link.click();
  showToast('CSV indirildi.', 'success');
}

function bfImportCSV(event) {
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var lines = e.target.result.split(/\r?\n/).filter(function(l) { return l.trim(); });
    if (lines.length < 2) { showToast('CSV boş veya geçersiz.', 'error'); return; }
    var imported = 0;
    for (var i = 1; i < lines.length; i++) {
      var cols = lines[i].split(/[;,]/).map(function(c) { return c.replace(/^"|"$/g, '').trim(); });
      if (cols.length < 3) continue;
      var ad = cols[0];
      var birim = cols[1] || 'kg';
      var fiyat = parseFloat(cols[2].replace(/\./g, '').replace(',', '.')) || 0;
      var yil = parseInt(cols[3]) || birimFiyatSeciliYil;
      if (ad && fiyat > 0) {
        addUnitPrice(ad, birim, fiyat, yil);
        imported++;
      }
    }
    showToast(imported + ' ürün içe aktarıldı.', 'success');
    renderBirimFiyatlar();
  };
  reader.readAsText(file, 'UTF-8');
  event.target.value = '';
}

function printBirimFiyatlar() {
  var filtered = unitPricesCache.filter(function(p) { return p.yil === birimFiyatSeciliYil; });
  filtered.sort(function(a, b) { return a.urun_adi.localeCompare(b.urun_adi, 'tr'); });
  var tl = function(v) { return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20BA'; };

  var rows = filtered.map(function(p, i) {
    return '<tr><td>' + (i + 1) + '</td><td style="text-align:left"><strong>' + escapeHtml(p.urun_adi) + '</strong></td><td>' + escapeHtml(p.birim) + '</td><td style="text-align:right">' + tl(p.birim_fiyat) + '</td><td>' + p.yil + '</td></tr>';
  }).join('');

  var win = window.open('', '_blank', 'width=800,height=600');
  if (!win) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ürün ve Birim Fiyat Listesi - ' + birimFiyatSeciliYil + '</title><style>');
  win.document.write('@page{size:portrait;margin:1.5cm}');
  win.document.write('body{font-family:Arial,sans-serif;padding:20px;margin:0;color:#1e293b}');
  win.document.write('h1{font-size:1.3rem;margin:0 0 2px}');
  win.document.write('.sub{font-size:0.8rem;color:#64748b;margin-bottom:1rem}');
  win.document.write('table{width:100%;border-collapse:collapse;font-size:0.8rem;margin-top:10px}');
  win.document.write('th{background:#f1f5f9;font-weight:600;padding:0.5rem;text-align:center;border:1px solid #ddd}');
  win.document.write('td{padding:0.4rem 0.5rem;border:1px solid #ddd;text-align:center}');
  win.document.write('tr:nth-child(even){background:#f8fafc}');
  win.document.write('.footer{text-align:center;font-size:0.75rem;color:#999;margin-top:2rem;border-top:1px solid #ddd;padding-top:0.5rem}');
  win.document.write('</style></head><body>');
  win.document.write('<h1>Ürün ve Birim Fiyat Listesi</h1>');
  win.document.write('<div class="sub">' + birimFiyatSeciliYil + ' Yılı \u2014 ' + filtered.length + ' \u00fcr\u00fcn</div>');
  win.document.write('<table><thead><tr><th style="width:30px">#</th><th style="text-align:left">\u00dcr\u00fcn Ad\u0131</th><th>Birim</th><th>Birim Fiyat (\u20BA)</th><th>Y\u0131l</th></tr></thead><tbody>' + rows + '</tbody></table>');
  win.document.write('<div class="footer">K\u0131r\u015fehir Ahi Evran \u00dcniversitesi &bull; Beslenme Hizmetleri &bull; ' + new Date().toLocaleDateString('tr-TR') + '</div>');
  win.document.write('</body></html>');
  win.document.close();
  triggerPrint(win);
}

function haccpRecordToDB(r) {
  return {
    id: Number(r.id) || Date.now(),
    type: r.type || 'sicaklik',
    tarih: r.tarih || '',
    saat: r.saat || '',
    depo_ad: r.depoAd || '',
    sicaklik: parseNumComma(r.sicaklik),
    nem: parseNumComma(r.nem),
    not_: r.not || '',
    last_modified: new Date().toISOString()
  };
}

async function syncHaccpToSupabase() {
  if (!supabaseClient) { showToast('Supabase bağlantısı yok.', 'error'); return; }
  try {
    if (haccpRecords.length > 0) {
      var dbRows = haccpRecords.map(haccpRecordToDB);
      var { error } = await supabaseClient.from('haccp_records').upsert(dbRows, { onConflict: 'id' });
      if (error) { showToast('Supabase hatası: ' + error.message, 'error'); return; }
    }
    var depoAdlari = loadHaccpDepoAdlari();
    if (depoAdlari.length > 0) {
      var depoRows = depoAdlari.map(function(ad) { return { ad: ad }; });
      var { error: depoErr } = await supabaseClient.from('haccp_depo_adlari').upsert(depoRows, { onConflict: 'ad' });
      if (depoErr) { showToast('Depo adı hatası: ' + depoErr.message, 'error'); return; }
    }
    showToast('HACCP verileri Supabase\'e senkronize edildi.', 'success');
  } catch (err) {
    showToast('Supabase bağlantı hatası: ' + err.message, 'error');
  }
}

let haccpSyncTimer = null;
let lastHaccpSyncHash = '';
function syncHaccpSilent(forceDepoOnly) {
  if (haccpSyncTimer) clearTimeout(haccpSyncTimer);
  if (haccpRecords.length === 0 && !forceDepoOnly) return;
  if (!supabaseClient) return;
  var currentHash = JSON.stringify(haccpRecords) + JSON.stringify(loadHaccpDepoAdlari()) + JSON.stringify(depoLimitleriCache);
  if (currentHash === lastHaccpSyncHash && !forceDepoOnly) return;
  lastHaccpSyncHash = currentHash;
  haccpSyncTimer = setTimeout(async () => {
    try {
      if (haccpRecords.length > 0) {
        var dbRows = haccpRecords.map(haccpRecordToDB);
        var { error } = await supabaseClient.from('haccp_records').upsert(dbRows, { onConflict: 'id' });
        if (error) showToast('Supabase HACCP hatası: ' + error.message, 'error');
      }
      var depoAdlari = loadHaccpDepoAdlari();
      var depoLimitleri = depoLimitleriCache;
      if (depoAdlari.length > 0) {
        var depoRows = depoAdlari.map(function(ad) {
          var lim = depoLimitleri[ad] || {};
          return { ad: ad, min_limit: lim.min != null ? lim.min : null, max_limit: lim.max != null ? lim.max : null };
        });
        await supabaseClient.from('haccp_depo_adlari').upsert(depoRows, { onConflict: 'ad' });
      }
    } catch (err) {
      showToast('Supabase bağlantı hatası: ' + (err.message || err), 'error');
    }
  }, 400);
}

async function syncHaccpFromSupabase() {
  if (!supabaseClient) return false;
  try {
    var { data: hData, error: hErr } = await supabaseClient.from('haccp_records').select('*').order('tarih', { ascending: false });
    if (hErr) return false;
    if (hData && hData.length > 0) {
      haccpRecords = hData.map(function(r) {
        var typ = (r.type || 'sicaklik').toLowerCase();
        return {
          id: Number(r.id) || Date.now() + Math.random(),
          type: typ,
          tarih: normalizeDate(r.tarih || ''),
          saat: normalizeSaat(r.saat || ''),
          depoAd: r.depo_ad || '',
          sicaklik: typ === 'sicaklik' ? parseNumComma(r.sicaklik) : null,
          not: r.not_ || r.not || '',
          nem: typ === 'sicaklik' ? parseNumComma(r.nem) : null
        };
      });
      lastHaccpSyncHash = JSON.stringify(haccpRecords);
    }
    var { data: dData } = await supabaseClient.from('haccp_depo_adlari').select('ad, min_limit, max_limit');
    if (dData && dData.length > 0) {
      var adlar = dData.map(function(d) { return d.ad; });
      try { localStorage.setItem(HACCP_DEPO_KEY, JSON.stringify(adlar)); } catch (_) {}
      depoLimitleriCache = {};
      dData.forEach(function(d) {
        if (d.min_limit != null && d.max_limit != null) {
          depoLimitleriCache[d.ad] = { min: parseFloat(d.min_limit), max: parseFloat(d.max_limit) };
        }
      });
    }
    if (hData && hData.length > 0) return true;
    if (dData && dData.length > 0) return true;
    return false;
  } catch (_) { return false; }
}

// ─── HACCP 100 KAYIT OLUŞTUR ────────────────────────────────────────────────
function generateHaccpSample() {
  if (!canAddHaccpRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  var depo = 'Soğuk Hava Deposu 5';
  var now = Date.now();
  var records = [];
  var mevcut = haccpRecords.filter(function(r) { return r.id && r.type === 'sicaklik'; });
  for (var i = 0; i < 100; i++) {
    var d = new Date(2026, 5, 30 - Math.floor(i / 4), 0, 0, 0);
    d.setHours([6, 12, 18, 0][i % 4]);
    var sicaklik = (2 + Math.random() * 3).toFixed(1);
    var nem = Math.floor(75 + Math.random() * 20);
    records.push({
      id: now + i,
      type: 'sicaklik',
      tarih: d.toISOString().slice(0, 10),
      saat: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
      depoAd: depo,
      sicaklik: parseFloat(sicaklik),
      not: '',
      nem: nem
    });
  }
  haccpRecords = mevcut.concat(records);
  saveHaccpData();
  renderHaccp();
  showToast('100 adet sıcaklık kaydı oluşturuldu (son 25 gün, günde 4 ölçüm).', 'success');
}

// ─── HACCP EXCEL İNDİR ──────────────────────────────────────────────────────
function canExport() {
  if (getRole() === ROLE_ADMIN) return true;
  var perm = getRolePermissions(getRole());
  return !!(perm && perm.canExport);
}

function exportHaccpCSV() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  if (haccpRecords.length === 0) { showToast('İndirilecek kayıt yok.', 'error'); return; }
  var headers = ['id','type','tarih','saat','depoAd','sicaklik','not','lastModified','nem'];
  var rows = [headers.join(',')];
  haccpRecords.forEach(function(r) {
    var vals = headers.map(function(h) {
      var v = r[h] !== undefined ? r[h] : '';
      if (h === 'sicaklik' && v === undefined) v = r.sicaklik != null ? r.sicaklik : '';
      if (h === 'nem' && v === undefined) v = r.nem != null ? r.nem : '';
      if (h === 'depoAd' && (!v || v === 'undefined')) v = r.depoAd || '';
      v = String(v).replace(/"/g, '""');
      return v.indexOf(',') > -1 ? '"' + v + '"' : v;
    });
    rows.push(vals.join(','));
  });
  var blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'HACCP_' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(haccpRecords.length + ' kayıt CSV olarak indirildi.', 'success');
}

// ─── HACCP DOSYA YÜKLE ──────────────────────────────────────────────────────
var HACCP_FIELD_MAP = {
  'Tarih': 'tarih', 'Saat': 'saat', 'Depo Adı': 'depoAd', 'Depo Ad': 'depoAd', 'Depo': 'depoAd',
  'Sıcaklık (°C)': 'sicaklik', 'Sıcaklık': 'sicaklik', 'Sicaklik': 'sicaklik', 'Sıcaklık (C)': 'sicaklik',
  'Nem (%)': 'nem', 'Nem': 'nem', 'Not': 'not', 'not': 'not',
  'id': 'id', 'type': 'type', 'tarih': 'tarih', 'saat': 'saat',
  'depoAd': 'depoAd', 'depo_ad': 'depoAd', 'sicaklik': 'sicaklik', 'nem': 'nem',
  'not_': 'not', 'last_modified': 'last_modified'
};

function importHaccpFile(event) {
  if (!canAddHaccpRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var text = e.target.result;
      var rows;
      if (file.name.endsWith('.json')) {
        rows = JSON.parse(text);
        if (!Array.isArray(rows)) rows = [rows];
      } else {
        var lines = text.split(/\r?\n/).filter(function(l) { return l.trim(); });
        if (lines.length < 2) { showToast('CSV en az 2 satır olmalı (başlık + veri).', 'error'); return; }
        var delim = lines[0].includes(';') ? ';' : ',';
        var headers = lines[0].split(delim).map(function(h) { return h.replace(/^"|"$/g, '').trim(); });
        rows = [];
        for (var i = 1; i < lines.length; i++) {
          var vals = lines[i].split(delim).map(function(v) { return v.replace(/^"|"$/g, '').trim(); });
          var row = {};
          for (var j = 0; j < headers.length; j++) {
            var field = HACCP_FIELD_MAP[headers[j]] || headers[j];
            row[field] = vals[j] || '';
          }
          if (row.tarih) {
            row.tarih = normalizeDate(row.tarih);
            row.type = row.type || 'sicaklik';
            row.id = row.id || Date.now() + Math.random();
            row.sicaklik = row.sicaklik !== '' ? Number(String(row.sicaklik).replace(',', '.')) : null;
            row.nem = row.nem !== '' ? Number(String(row.nem).replace(',', '.')) : null;
            rows.push(row);
          }
        }
      }
      if (rows.length === 0) { showToast('Dosyada kayıt bulunamadı.', 'error'); return; }
      var eklenen = 0;
      var guncellenen = 0;
      rows.forEach(function(r) {
        var idx = haccpRecords.findIndex(function(er) { return String(er.id) === String(r.id); });
        if (idx !== -1) {
          haccpRecords[idx] = r;
          guncellenen++;
        } else {
          haccpRecords.push(r);
          eklenen++;
        }
      });
      saveHaccpData();
      renderHaccp();
      var mesaj = eklenen + ' yeni kayıt eklendi';
      if (guncellenen > 0) mesaj += ', ' + guncellenen + ' kayıt güncellendi';
      showToast(mesaj + ' (' + haccpRecords.length + ' toplam).', 'success');
    } catch (err) { showToast('Dosya okuma hatası: ' + err.message, 'error'); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ─── YAG (Atık Yağ) SYNC ────────────────────────────────────────────────────

function yagRecordToDB(r) {
  return {
    id: Number(r.id) || Date.now(),
    tarih: r.tarih || '',
    makbuz_no: r.makbuzNo || '',
    tur: r.tur || '',
    miktar: Number(r.miktar) || 0,
    not_: r.not || '',
    last_modified: new Date().toISOString()
  };
}

async function syncYagToSupabase() {
  if (!supabaseClient) return;
  try {
    if (yagRecords.length > 0) {
      await supabaseClient.from('yag_records').upsert(yagRecords.map(yagRecordToDB), { onConflict: 'id' });
    }
    showToast('Yağ verileri Supabase\'e senkronize edildi.', 'success');
  } catch (_) {}
}

let yagSyncTimer = null;
function syncYagSilent() {
  if (yagSyncTimer) clearTimeout(yagSyncTimer);
  yagSyncTimer = setTimeout(async () => {
    if (!supabaseClient || yagRecords.length === 0) return;
    try {
      await supabaseClient.from('yag_records').upsert(yagRecords.map(yagRecordToDB), { onConflict: 'id' });
    } catch (_) {}
  }, 400);
}

async function syncYagFromSupabase() {
  if (!supabaseClient) return false;
  try {
    var { data, error } = await supabaseClient.from('yag_records').select('*').order('tarih', { ascending: false });
    if (error) return false;
    if (data && data.length > 0) {
      yagRecords = data.map(function(r) {
        return {
          id: Number(r.id) || Date.now(),
          tarih: normalizeDate(r.tarih || ''),
          makbuzNo: r.makbuz_no || '',
          tur: r.tur || '',
          miktar: Number(r.miktar) || 0,
          not: r.not_ || ''
        };
      });
      saveYagData();
      renderYagTable();
      return true;
    }
    return false;
  } catch (_) { return false; }
}

async function refreshYagFromSupabase() {
  if (!supabaseClient) return;
  try {
    var { data } = await supabaseClient.from('yag_records').select('*').order('tarih', { ascending: false });
    if (data && data.length > 0) {
      yagRecords = data.map(function(r) { return {
        id: Number(r.id) || Date.now(),
        tarih: normalizeDate(r.tarih || ''),
        makbuzNo: r.makbuz_no || '',
        tur: r.tur || '',
        miktar: Number(r.miktar) || 0,
        not: r.not_ || ''
      }; });
      saveYagData();
      renderYagTable();
    }
  } catch (_) {}
}

// ─── AMBALAJ (Ambalaj Atıkları) SYNC ────────────────────────────────────────

function ambalajRecordToDB(r) {
  return {
    id: Number(r.id) || Date.now(),
    tarih: r.tarih || '',
    tur: r.tur || '',
    miktar: Number(r.miktar) || 0,
    birim: r.birim || 'kg',
    not_: r.not || '',
    last_modified: new Date().toISOString()
  };
}

async function syncAmbalajToSupabase() {
  if (!supabaseClient) return;
  try {
    if (ambalajRecords.length > 0) {
      await supabaseClient.from('ambalaj_records').upsert(ambalajRecords.map(ambalajRecordToDB), { onConflict: 'id' });
    }
    showToast('Ambalaj verileri Supabase\'e senkronize edildi.', 'success');
  } catch (_) {}
}

let ambalajSyncTimer = null;
function syncAmbalajSilent() {
  if (ambalajSyncTimer) clearTimeout(ambalajSyncTimer);
  ambalajSyncTimer = setTimeout(async () => {
    if (!supabaseClient || ambalajRecords.length === 0) return;
    try {
      await supabaseClient.from('ambalaj_records').upsert(ambalajRecords.map(ambalajRecordToDB), { onConflict: 'id' });
    } catch (_) {}
  }, 400);
}

async function logIslem(islem, detay) {
  if (!supabaseClient) return;
  var displayName = sessionStorage.getItem('atik_kontrol_display_name') || 'bilinmiyor';
  var role = sessionStorage.getItem('atik_kontrol_role') || '';
  try {
    await supabaseClient.from('user_logs').insert({
      tarih: new Date().toISOString(),
      kullanici: displayName,
      rol: role,
      islem: islem || '',
      detay: detay || ''
    });
  } catch (_) {}
}

async function syncAmbalajFromSupabase() {
  if (!supabaseClient) return false;
  try {
    var { data, error } = await supabaseClient.from('ambalaj_records').select('*').order('tarih', { ascending: false });
    if (error) return false;
    if (data && data.length > 0) {
      ambalajRecords = data.map(function(r) {
        return {
          id: Number(r.id) || Date.now(),
          tarih: normalizeDate(r.tarih || ''),
          tur: r.tur || '',
          miktar: Number(r.miktar) || 0,
          birim: r.birim || 'kg',
          not: r.not_ || ''
        };
      });
      saveAmbalajData();
      renderAmbalajTable();
      return true;
    }
    return false;
  } catch (_) { return false; }
}

async function refreshAmbalajFromSupabase() {
  if (!supabaseClient) return;
  try {
    var { data } = await supabaseClient.from('ambalaj_records').select('*').order('tarih', { ascending: false });
    if (data && data.length > 0) {
      ambalajRecords = data.map(function(r) { return {
        id: Number(r.id) || Date.now(),
        tarih: normalizeDate(r.tarih || ''),
        tur: r.tur || '',
        miktar: Number(r.miktar) || 0,
        birim: r.birim || 'kg',
        not: r.not_ || ''
      }; });
      saveAmbalajData();
      renderAmbalajTable();
    }
  } catch (_) {}
}

// ─── KALİBRASYON (Kalibrasyona Tabi Cihazlar) SYNC ──────────────────────────

function kalibrasyonRecordToDB(r) {
  return {
    id: Number(r.id) || Date.now(),
    cihaz_adi: r.cihazAdi || '',
    marka_model: r.markaModel || '',
    sicil_no: r.sicilNo || '',
    durum: r.durum || 'calisir',
    dogrulama: r.dogrulama || '',
    son_kalibrasyon: r.sonKalibrasyon || '',
    sonraki_kalibrasyon: r.sonrakiKalibrasyon || '',
    konum: r.konum || '',
    sorumlu: r.sorumlu || '',
    not_: r.not || '',
    last_modified: new Date().toISOString()
  };
}

async function syncKalibrasyonToSupabase() {
  if (!supabaseClient) return;
  try {
    if (kalibrasyonCihazlari.length > 0) {
      await supabaseClient.from('kalibrasyon_cihazlari').upsert(kalibrasyonCihazlari.map(kalibrasyonRecordToDB), { onConflict: 'id' });
    }
    showToast('Kalibrasyon verileri Supabase\'e senkronize edildi.', 'success');
  } catch (_) {}
}

let kalibrasyonSyncTimer = null;
function syncKalibrasyonSilent() {
  if (kalibrasyonSyncTimer) clearTimeout(kalibrasyonSyncTimer);
  kalibrasyonSyncTimer = setTimeout(async () => {
    if (!supabaseClient || kalibrasyonCihazlari.length === 0) return;
    try {
      await supabaseClient.from('kalibrasyon_cihazlari').upsert(kalibrasyonCihazlari.map(kalibrasyonRecordToDB), { onConflict: 'id' });
    } catch (_) {}
  }, 400);
}

async function syncKalibrasyonFromSupabase() {
  if (!supabaseClient) return false;
  try {
    var { data, error } = await supabaseClient.from('kalibrasyon_cihazlari').select('*').order('cihaz_adi', { ascending: true });
    if (error) return false;
    if (data && data.length > 0) {
      kalibrasyonCihazlari = data.map(function(r) {
        return {
          id: Number(r.id) || Date.now(),
          cihazAdi: r.cihaz_adi || '',
          markaModel: r.marka_model || '',
          sicilNo: r.sicil_no || '',
          durum: r.durum || 'calisir',
          dogrulama: r.dogrulama || '',
          sonKalibrasyon: normalizeDate(r.son_kalibrasyon || ''),
          sonrakiKalibrasyon: normalizeDate(r.sonraki_kalibrasyon || ''),
          konum: r.konum || '',
          sorumlu: r.sorumlu || '',
          not: r.not_ || ''
        };
      });
      saveKalibrasyonData();
      renderKalibrasyon();
      return true;
    }
    return false;
  } catch (_) { return false; }
}

async function refreshKalibrasyonFromSupabase() {
  if (!supabaseClient) return;
  try {
    var { data } = await supabaseClient.from('kalibrasyon_cihazlari').select('*').order('cihaz_adi', { ascending: true });
    if (data && data.length > 0) {
      kalibrasyonCihazlari = data.map(function(r) { return {
        id: Number(r.id) || Date.now(),
        cihazAdi: r.cihaz_adi || '',
        markaModel: r.marka_model || '',
        sicilNo: r.sicil_no || '',
        durum: r.durum || 'calisir',
        dogrulama: r.dogrulama || '',
        sonKalibrasyon: normalizeDate(r.son_kalibrasyon || ''),
        sonrakiKalibrasyon: normalizeDate(r.sonraki_kalibrasyon || ''),
        konum: r.konum || '',
        sorumlu: r.sorumlu || '',
        not: r.not_ || ''
      }; });
      saveKalibrasyonData();
      renderKalibrasyon();
    }
  } catch (_) {}
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

async function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs || 45000);
  try {
    var res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    return res;
  } finally {
    clearTimeout(timer);
  }
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

// ─── SUPABASE SYNC ─────────────────────────────────────────────────────────────
function getMenuUrl() {
  return SUPABASE_URL;
}

async function syncAllToSupabase() { if (!requireAdmin()) return;
  if (!confirm('Tüm yerel veriler Supabase bulutuna yedeklensin mi?')) return;
  if (!supabaseClient) { showToast('Supabase bağlantısı yok.', 'error'); return; }
  var toastMsg = [];
  try {
    if (records.length > 0) {
      var { count: rCount } = await supabaseClient.from('records').upsert(records, { onConflict: 'id' }).select('count');
      toastMsg.push('Kayıtlar: ' + (rCount || records.length));
    }
    if (haccpRecords.length > 0) {
      await supabaseClient.from('haccp_records').upsert(haccpRecords.map(haccpRecordToDB), { onConflict: 'id' });
      var depoAdlari = loadHaccpDepoAdlari();
      if (depoAdlari.length > 0) {
        await supabaseClient.from('haccp_depo_adlari').upsert(depoAdlari.map(function(a) { return { ad: a }; }), { onConflict: 'ad' });
      }
      toastMsg.push('HACCP: ' + haccpRecords.length);
    }
    if (yagRecords.length > 0) {
      await supabaseClient.from('yag_records').upsert(yagRecords.map(yagRecordToDB), { onConflict: 'id' });
      toastMsg.push('Yağ: ' + yagRecords.length);
    }
    if (ambalajRecords.length > 0) {
      await supabaseClient.from('ambalaj_records').upsert(ambalajRecords.map(ambalajRecordToDB), { onConflict: 'id' });
      toastMsg.push('Ambalaj: ' + ambalajRecords.length);
    }
    if (kalibrasyonCihazlari.length > 0) {
      await supabaseClient.from('kalibrasyon_cihazlari').upsert(kalibrasyonCihazlari.map(kalibrasyonRecordToDB), { onConflict: 'id' });
      toastMsg.push('Kalibrasyon: ' + kalibrasyonCihazlari.length);
    }
    await syncHarcamaOranlariToSupabase();
    showToast('Supabase\'e yedeklendi: ' + (toastMsg.join(', ') || 'güncel veri yok'), 'success');
  } catch (err) {
    showToast('Supabase hatası: ' + err.message, 'error');
  }
}

async function syncAllFromSupabase() { if (!requireAdmin()) return;
  if (!confirm('Supabase\'ten alınan veriler mevcut yerel verilerin üzerine yazsın mı?')) return;
  if (!supabaseClient) { showToast('Supabase bağlantısı yok.', 'error'); return; }
  var toastMsg = [];
  try {
    var { data: rData } = await supabaseClient.from('records').select('*').order('tarih', { ascending: false });
    if (rData && rData.length > 0) {
      records = rData.map(function(r) { return {
        id: Number(r.id) || Date.now() + Math.random(),
        tarih: normalizeDate(r.tarih),
        yemek: Number(r.yemek) || 0,
        fire: Number(r.fire) || 0,
        turnike: Number(r.turnike) || 0,
        personel: Number(r.personel) || 0,
        toplam: Number(r.toplam) || 0,
        porsiyon: Number(r.porsiyon) || 0,
        atik: Number(r.atik) || 0,
        ogrenci: Number(r.ogrenci) || 0,
        harcama_tutari: Number(r.harcama_tutari) || 0,
        yemek_adi: r.yemek_adi || ''
      }; });
      records.sort(function(a, b) { return new Date(b.tarih) - new Date(a.tarih); });
      saveData();
      filteredRecords = [...records];
      renderAll();
      drawAllCharts();
      toastMsg.push('Kayıtlar: ' + records.length);
    }
    var hPulled = await syncHaccpFromSupabase();
    if (hPulled) toastMsg.push('HACCP: ' + haccpRecords.length);
    await syncYagFromSupabase();
    await syncAmbalajFromSupabase();
    var kPulled = await syncKalibrasyonFromSupabase();
    if (kPulled) toastMsg.push('Kalibrasyon: ' + kalibrasyonCihazlari.length);
    var hOranPulled = await syncHarcamaOranlariFromSupabase();
    if (hOranPulled) toastMsg.push('Harcama Oranları');
    showToast('Supabase\'ten alındı: ' + (toastMsg.join(', ') || 'veri yok'), 'success');
  } catch (err) {
    showToast('Supabase hatası: ' + err.message, 'error');
  }
}

// ─── PREDICTION ──────────────────────────────────────────────────────────────
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
  const gecisData = sorted.map(r => r.turnike || 0);
  drawSparkline('sparklineAtik', atikData, '#f97316');
  drawSparkline('sparklineGecis', gecisData, '#22c55e');
}

// ─── WASTE DETAIL ────────────────────────────────────────────────────────────
// ─── PDF EXPORT ──────────────────────────────────────────────────────────────
function triggerPrint(win, ms) {
  if (!win) return;
  win.onafterprint = function () { try { win.close(); } catch (e) {} };
  var doPrint = function () {
    if (!win.closed) { try { win.focus(); win.print(); } catch (e) {} }
  };
  if (win.document.readyState === 'complete') {
    setTimeout(doPrint, ms || 300);
  } else {
    win.onload = function () { setTimeout(doPrint, 100); };
    setTimeout(doPrint, ms && ms > 1500 ? ms : 3500);
  }
}

function exportPDF() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
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
      @page { size: landscape; margin: 1cm; }
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
      ${harcamaHiddenCss()}
      </style>
    </head><body>
      <h1>Atık Kontrol Raporu</h1>
      <div class="date">${new Date().toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'})}</div>
      ${cards}
      <div class="footer">Kırşehir Ahi Evran Üniversitesi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
    </body></html>`);
  printWin.document.close();
  printWin.focus();
  triggerPrint(printWin);
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
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
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
  triggerPrint(printWin);
}

// ─── HACCP / GIDA GUVENLIGI ───────────────────────────────────────────────────
const HACCP_STORAGE_KEY = 'haccp_records';
const HACCP_DEPO_KEY = 'haccp_depo_adlari';
const DEFAULT_DEPO_ADLARI = ['Soğuk Hava Deposu 5', 'Soğuk Hava Deposu 6', 'Soğuk Hava Deposu 7', 'Soğuk Hava Deposu 8'];
let haccpRecords = [];
let depoLimitleriCache = {};
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

function saveDepoLimitsFromRow(input) {
  if (!canEditDepoAdlari()) return;
  var row = input.closest('[data-depo]');
  if (!row) return;
  var depoAd = row.dataset.depo;
  var min = parseFloat(row.querySelector('.depo-limit-min').value);
  var max = parseFloat(row.querySelector('.depo-limit-max').value);
  if (!isNaN(min) && !isNaN(max)) {
    depoLimitleriCache[depoAd] = { min: min, max: max };
  } else {
    delete depoLimitleriCache[depoAd];
  }
  syncHaccpSilent(true);
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
  if (!canEditDepoAdlari()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const list = loadHaccpDepoAdlari().filter(n => n !== name);
  saveHaccpDepoAdlari(list);
  delete depoLimitleriCache[name];
  renderHaccpDepoListesi();
  renderHaccpSicaklikDepoSelect();
  return list;
}

function canEditDepoAdlari() {
  var role = getRole();
  if (role === ROLE_ADMIN) return true;
  var perm = getRolePermissions(role);
  return !!(perm && perm.canEditDepo);
}

function showHaccpDepoYonetim() {
  if (!canEditDepoAdlari()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  document.getElementById('haccpDepoModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderHaccpDepoListesi();
}

function closeHaccpDepoModal() {
  document.getElementById('haccpDepoModal').classList.remove('open');
  document.body.style.overflow = '';
}

function addHaccpDepoAdiFromInput() {
  if (!canEditDepoAdlari()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
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
    var limits = depoLimitleriCache[n] || null;
    var minVal = limits && !isNaN(limits.min) ? limits.min : '';
    var maxVal = limits && !isNaN(limits.max) ? limits.max : '';
    return '<div data-depo="' + n.replace(/"/g, '&quot;') + '" style="padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<span style="font-weight:600;font-size:0.9rem">' + n + '</span>' +
      '<div style="display:flex;gap:4px">' +
      '<button class="btn btn-ghost btn-sm" onclick="showQrModal(\'' + n.replace(/'/g, "\\'") + '\')" title="QR Kod">QR</button>' +
      '<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="removeHaccpDepoAdi(\'' + n.replace(/'/g, "\\'") + '\')">Sil</button>' +
      '</div></div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:4px;font-size:0.78rem;color:var(--text-muted)">' +
      'Alt Limit: <input type="number" step="0.1" value="' + minVal + '" class="depo-limit-min" style="width:72px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:0.78rem" oninput="saveDepoLimitsFromRow(this)" placeholder="—"> °C' +
      'Üst Limit: <input type="number" step="0.1" value="' + maxVal + '" class="depo-limit-max" style="width:72px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:0.78rem" oninput="saveDepoLimitsFromRow(this)" placeholder="—"> °C' +
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
    var stored = sessionStorage.getItem(HACCP_STORAGE_KEY);
    if (stored) {
      haccpRecords = JSON.parse(stored);
    } else {
      stored = localStorage.getItem(HACCP_STORAGE_KEY);
      if (stored) {
        haccpRecords = JSON.parse(stored);
        try { sessionStorage.setItem(HACCP_STORAGE_KEY, stored); } catch (_) {}
        try { localStorage.removeItem(HACCP_STORAGE_KEY); } catch (_) {}
      } else {
        haccpRecords = [];
      }
    }
  } catch (_) { haccpRecords = []; }
  haccpRecords.forEach(function(r) { if (r.tarih) r.tarih = normalizeDate(r.tarih); });
  renderHaccp();
}

function saveHaccpData() { if (!requireAdmin()) return;
  try { sessionStorage.setItem(HACCP_STORAGE_KEY, JSON.stringify(haccpRecords)); } catch (_) {}
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
  var depoRenkler = ['#6366f1', '#f97316', '#10b981', '#0ea5e9', '#22d3ee', '#f59e0b', '#ef4444', '#14b8a6'];
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
      var limits = getDepoSicaklikLimitleri(ad);
      var minOk = limits.min, maxOk = limits.max;
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
}

function getHaccpRecords(type) {
  return haccpRecords.filter(r => r.type === type).sort((a, b) => b.tarih + b.saat > a.tarih + a.saat ? 1 : -1);
}

function getDepoSicaklikLimitleri(depoAd) {
  var ad = String(depoAd || '').trim();
  var adLower = ad.toLowerCase();
  var stored = depoLimitleriCache[ad] || null;
  if (stored && !isNaN(stored.min) && !isNaN(stored.max)) return stored;
  if (adLower.includes('dondurucu') || adLower.includes('eksi')) return { min: -24, max: -18 };
  return { min: 0, max: 4 };
}

function sicaklikDurum(sicaklik, depoAd) {
  const v = parseFloat(sicaklik);
  if (isNaN(v)) return { text: '—', cls: '' };
  var limits = getDepoSicaklikLimitleri(depoAd);
  if (v >= limits.min && v <= limits.max) return { text: 'Uygun', cls: 'badge badge-ok' };
  if (v < limits.min) return { text: 'Düşük', cls: 'badge badge-warn' };
  return { text: 'Yüksek', cls: 'badge badge-err' };
}

var haccpSicaklikPage = 0;
var haccpSicaklikPageSize = 100;
var haccpSelectedIds = new Set();

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

  // apply depo filter
  if (filterSelect && filterSelect.value) {
    records = records.filter(function(r) { return (r.depoAd || ('Depo ' + r.depoNo)) === filterSelect.value; });
  }

  // apply date filter
  var tarihBas = document.getElementById('haccpSicaklikTarihBas');
  var tarihBit = document.getElementById('haccpSicaklikTarihBit');
  if (tarihBas && tarihBas.value) {
    records = records.filter(function(r) { return r.tarih >= tarihBas.value; });
  }
  if (tarihBit && tarihBit.value) {
    records = records.filter(function(r) { return r.tarih <= tarihBit.value; });
  }

  if (records.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    if (nav) nav.style.display = 'none';
    document.getElementById('haccpBatchBar').style.display = 'none';
    return;
  }
  table.style.display = 'table';
  empty.style.display = 'none';

  var totalPages = Math.ceil(records.length / haccpSicaklikPageSize);
  if (haccpSicaklikPage >= totalPages) haccpSicaklikPage = 0;
  if (haccpSicaklikPage < 0) haccpSicaklikPage = totalPages - 1;
  var start = haccpSicaklikPage * haccpSicaklikPageSize;
  var pageRecords = records.slice(start, start + haccpSicaklikPageSize);
  var canEdit = canEditHaccpRecords();

  // batch bar
  var batchBar = document.getElementById('haccpBatchBar');
  var batchCount = document.getElementById('haccpBatchCount');
  if (canEdit && haccpSelectedIds.size > 0) {
    batchBar.style.display = 'flex';
    batchCount.textContent = haccpSelectedIds.size + ' seçili';
  } else {
    batchBar.style.display = 'none';
  }

  // header checkbox state
  var allSelected = canEdit && pageRecords.every(function(r) { return haccpSelectedIds.has(r.id); });

  tbody.innerHTML = pageRecords.map(r => {
    var checked = haccpSelectedIds.has(r.id) ? ' checked' : '';
    const depoAd = r.depoAd || ('Depo ' + r.depoNo);
    const durum = sicaklikDurum(r.sicaklik, depoAd);
    var chkCell = canEdit
      ? '<td><input type="checkbox" class="haccp-select-chk" data-id="' + r.id + '"' + checked + ' onchange="haccpToggleSelect(' + r.id + ')" style="cursor:pointer"></td>'
      : '<td></td>';
    var actionCell = canEdit
      ? '<td>' +
        '<button class="btn-icon" onclick="editHaccpRecord(\'sicaklik\',' + r.id + ')" title="Düzenle">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button class="btn-icon" onclick="deleteHaccpRecord(\'sicaklik\',' + r.id + ')" title="Sil" style="color:var(--danger)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
        '</button>' +
        '</td>'
      : '<td></td>';
    return `<tr>
      ${chkCell}
      <td>${formatTarihTR(r.tarih)}</td>
      <td>${r.saat || '—'}</td>
      <td>${depoAd}</td>
      <td class="${durum.cls}"><strong>${r.sicaklik != null && !isNaN(r.sicaklik) ? Number(r.sicaklik).toLocaleString('tr-TR', {minimumFractionDigits:1,maximumFractionDigits:1}) : '—'}</strong></td>
      <td>${r.nem != null && r.nem !== '' && !isNaN(r.nem) ? Number(r.nem).toLocaleString('tr-TR', {minimumFractionDigits:0,maximumFractionDigits:1}) : '—'}</td>
      <td>${r.not || '—'}</td>
      ${actionCell}
    </tr>`;
  }).join('');

  // update header checkbox
  var headerChk = document.getElementById('haccpSelectAllChk');
  if (headerChk) { headerChk.checked = allSelected; headerChk.disabled = !canEdit; }

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
  var tarihBas = document.getElementById('haccpSicaklikTarihBas');
  var tarihBit = document.getElementById('haccpSicaklikTarihBit');
  if (tarihBas && tarihBas.value) records = records.filter(function(r) { return r.tarih >= tarihBas.value; });
  if (tarihBit && tarihBit.value) records = records.filter(function(r) { return r.tarih <= tarihBit.value; });
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
  var tarihEtiketi = '';
  if (tarihBas && tarihBas.value) tarihEtiketi += ' ' + tarihBas.value + ' —';
  if (tarihBit && tarihBit.value) tarihEtiketi += ' ' + tarihBit.value;
  if (tarihEtiketi) tarihEtiketi = ' | Tarih:' + tarihEtiketi;
  win.document.write('<p>' + (depo || 'T\u00fcm depolar') + tarihEtiketi + ' &mdash; ' + records.length + ' kay\u0131t</p>');
  win.document.write('<table><thead><tr><th>Tarih</th><th>Saat</th><th>Depo</th><th>S\u0131cakl\u0131k</th><th>Nem</th><th>Durum</th></tr></thead><tbody>' + rows + '</tbody></table>');
  win.document.write('</body></html>');
  win.document.close();
  triggerPrint(win);
}

function haccpSicaklikPagePrev() {
  if (haccpSicaklikPage > 0) { haccpSicaklikPage--; renderHaccpSicaklik(); }
}

function haccpSicaklikPageNext() {
  var records = getHaccpRecords('sicaklik');
  var totalPages = Math.ceil(records.length / haccpSicaklikPageSize);
  if (haccpSicaklikPage < totalPages - 1) { haccpSicaklikPage++; renderHaccpSicaklik(); }
}

function haccpToggleSelect(id) {
  if (!canEditHaccpRecords()) return;
  if (haccpSelectedIds.has(id)) haccpSelectedIds.delete(id);
  else haccpSelectedIds.add(id);
  renderHaccpSicaklik();
}

function haccpToggleSelectAll(checked) {
  if (!canEditHaccpRecords()) return;
  var records = getHaccpRecords('sicaklik');
  var filterSelect = document.getElementById('haccpSicaklikDepoFilter');
  if (filterSelect && filterSelect.value) {
    records = records.filter(function(r) { return (r.depoAd || ('Depo ' + r.depoNo)) === filterSelect.value; });
  }
  var tarihBas = document.getElementById('haccpSicaklikTarihBas');
  var tarihBit = document.getElementById('haccpSicaklikTarihBit');
  if (tarihBas && tarihBas.value) records = records.filter(function(r) { return r.tarih >= tarihBas.value; });
  if (tarihBit && tarihBit.value) records = records.filter(function(r) { return r.tarih <= tarihBit.value; });
  var totalPages = Math.ceil(records.length / haccpSicaklikPageSize);
  var start = haccpSicaklikPage * haccpSicaklikPageSize;
  var page = records.slice(start, start + haccpSicaklikPageSize);
  page.forEach(function(r) {
    if (checked) haccpSelectedIds.add(r.id);
    else haccpSelectedIds.delete(r.id);
  });
  renderHaccpSicaklik();
}

async function haccpDeleteSelected() {
  if (!canEditHaccpRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  if (haccpSelectedIds.size === 0) { showToast('Seçili kayıt yok.', 'error'); return; }
  if (!confirm('Seçili ' + haccpSelectedIds.size + ' kaydı silmek istediğinize emin misiniz?')) return;
  var ids = [...haccpSelectedIds];
  if (supabaseClient && ids.length > 0) {
    try {
      var { error } = await supabaseClient.from('haccp_records').delete().in('id', ids);
      if (error) throw error;
    } catch (e) {
      showToast('Supabase\'den silinemedi: ' + (e.message || e), 'error');
      return;
    }
  }
  haccpRecords = haccpRecords.filter(function(r) { return !haccpSelectedIds.has(r.id); });
  haccpSelectedIds.clear();
  saveHaccpData();
  renderHaccp();
  showToast('Seçili kayıtlar silindi.', 'success');
}

function openHaccpModal(type, id) {
  if (type !== 'sicaklik') return showToast('Sadece sıcaklık kaydı destekleniyor.', 'error');
  if (id) {
    if (!canEditHaccpRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddHaccpRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  }
  editingHaccpType = type;
  editingHaccpId = id || null;

  const overlay = document.getElementById('haccpModal');
  const title = document.getElementById('haccpModalTitle');
  const body = document.getElementById('haccpFormBody');

  title.textContent = 'Depo Sıcaklık Kaydı';

  let rec = null;
  if (id) rec = haccpRecords.find(r => r.id === id && r.type === type);

  const now = new Date();
  const today = formatLocalDate(now);
  const saat = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');

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
  if (editingHaccpId) {
    if (!canEditHaccpRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddHaccpRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  }
  const type = editingHaccpType;
  let rec = { id: editingHaccpId || Date.now(), type };

  rec.tarih = document.getElementById('hfTarih').value;
  rec.saat = document.getElementById('hfSaat').value;
  rec.depoAd = document.getElementById('hfDepoAd').value.trim();
  rec.sicaklik = parseNumComma(document.getElementById('hfSicaklik').value);
  rec.nem = parseNumComma(document.getElementById('hfNem').value);
  rec.not = document.getElementById('hfNot').value.trim();

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

async function deleteHaccpRecord(type, id) {
  if (!canEditHaccpRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
  if (supabaseClient) {
    try {
      var { error } = await supabaseClient.from('haccp_records').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      showToast('Supabase\'den silinemedi: ' + (e.message || e), 'error');
      return;
    }
  }
  haccpRecords = haccpRecords.filter(r => !(r.id === id && r.type === type));
  haccpSelectedIds.delete(id);
  saveHaccpData();
  renderHaccp();
  showToast('Kayıt silindi.', 'success');
}



function exportChartsPDF() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
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
      .chart-dl-btn { display: none !important; }
      .footer { text-align: center; font-size: 0.75rem; color: #999; margin-top: 2rem; border-top: 1px solid #ddd; padding-top: 0.5rem; }
      ${harcamaHiddenCss()}
    </style>
  </head><body>
    <h1>Grafikler - Atık Kontrol Yönetim Sistemi</h1>
    <div class="date">${new Date().toLocaleDateString('tr-TR')}</div>
    ${chartsHtml}
    <div class="footer">Atık Kontrol Yönetim Sistemi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
  </body></html>`);
  printWin.document.close();
  printWin.focus();
  triggerPrint(printWin);
}

// ─── GRAFİK YARDIMCILARI & WORD'E AKTARMA ─────────────────────────────────────

function _chartHeaderEl(canvas) {
  const area = canvas.closest('.chart-area') || canvas.parentElement;
  if (!area) return null;
  let el = area.previousElementSibling;
  while (el) {
    if (el.classList.contains('section-header') || el.classList.contains('chart-subheader')) return el;
    el = el.previousElementSibling;
  }
  const card = canvas.closest('.chart-card') || canvas.closest('.section-card');
  return card ? card.querySelector('.section-header, .chart-subheader') : null;
}

function _chartTitle(canvas) {
  const header = _chartHeaderEl(canvas);
  if (!header) return 'Grafik';
  const clone = header.cloneNode(true);
  clone.querySelectorAll('.chart-dl-btn, .badge, .chart-total, .chart-subhint').forEach(function(n) { n.remove(); });
  return (clone.textContent || 'Grafik').replace(/\s+/g, ' ').trim() || 'Grafik';
}

function _chartWhitePng(canvas) {
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width || 600;
  tmp.height = canvas.height || 400;
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tmp.width, tmp.height);
  ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
  return tmp.toDataURL('image/png');
}

function _qpEncodeAscii(str) {
  let out = '', lineLen = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i], code = str.charCodeAt(i);
    if (ch === '\r' || ch === '\n') { out += ch; lineLen = 0; continue; }
    let tok;
    if (code === 61) tok = '=3D';
    else if (code < 32 || code > 126) tok = '=' + code.toString(16).toUpperCase().padStart(2, '0');
    else tok = ch;
    if (lineLen + tok.length > 74) { out += '=\r\n'; lineLen = 0; }
    out += tok;
    lineLen += tok.length;
  }
  return out;
}

function _wrapBase64(b64) {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

function _toAsciiHtml(html) {
  return html.replace(/[\u0080-\uFFFF]/g, function(ch) { return '&#' + ch.codePointAt(0) + ';'; });
}

function exportChartsWord() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const sections = [
    { sel: '#content-charts', label: 'Aylık Grafikler' },
    { sel: '#content-yillik', label: 'Yıllık Grafikler' },
    { sel: '#content-harcama', label: 'Harcama Grafikleri' }
  ];
  const images = [];
  const blocks = [];
  let idx = 0, hadAny = false;
  sections.forEach(function(sec) {
    const root = document.querySelector(sec.sel);
    if (!root) return;
    const cards = [];
    root.querySelectorAll('canvas[id^="canvas"]').forEach(function(canvas) {
      if (canvas.classList.contains('kpi-sparkline')) return;
      if (canvas.style.display === 'none') return;
      const chart = window.Chart && Chart.getChart ? Chart.getChart(canvas) : null;
      if (!chart) return;
      idx++;
      const name = 'grafik_' + idx + '.png';
      // Word CSS'i güvenilir uygulamadigi icin resimlere acik width/height veriyoruz (A4 yatay sayfaya sigacak)
      const w0 = canvas.width || 800, h0 = canvas.height || 400;
      const oran = w0 / h0;
      let dispW;
      if (oran > 0.85 && oran < 1.2 && w0 <= 600) {
        dispW = Math.min(360, w0); // kucuk kare/donut grafikler buyutulmez
      } else {
        dispW = Math.round(w0 * Math.min(1000 / w0, 580 / h0));
      }
      const dispH = Math.round(dispW * h0 / w0);
      images.push({ name: name, base64: _chartWhitePng(canvas).split(',')[1] });
      cards.push('<div class="kart"><h2>' + escapeHtml(_chartTitle(canvas)) + '</h2><img src="' + name + '" width="' + dispW + '" height="' + dispH + '" alt="" /></div>');
      hadAny = true;
    });
    if (cards.length) blocks.push('<h1>' + escapeHtml(sec.label) + '</h1>' + cards.join(''));
  });
  if (!hadAny) { showToast('Dışa aktarılacak dolu grafik bulunamadı.', 'error'); return; }

  const bugun = new Date().toLocaleDateString('tr-TR');
  const html =
    '<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">' +
    '<head><meta charset="utf-8"><title>Grafikler - Atik Kontrol</title>' +
    '<style>' +
    '@page WordSection1{size:841.95pt 595.35pt;margin:36pt;mso-page-orientation:landscape}' +
    'div.WordSection1{page:WordSection1}' +
    'body{font-family:Arial,sans-serif;font-size:11pt;color:#1e293b}' +
    'h1{font-size:14pt;color:#0f172a;border-bottom:1px solid #cbd5e1;padding-bottom:3pt;margin:16pt 0 8pt}' +
    '.kart{page-break-inside:avoid;margin-bottom:14pt}' +
    '.kart h2{font-size:12pt;margin:0 0 6pt;color:#334155}' +
    '.kart img{border:1px solid #e2e8f0}' +
    '.tarih{font-size:9pt;color:#64748b;margin:4pt 0}' +
    '</style></head><body><div class="WordSection1">' +
    '<p class="tarih">Rapor Tarihi: ' + bugun + '</p>' +
    blocks.join('') +
    '<p class="tarih">Atık Kontrol Yönetim Sistemi &bull; ' + bugun + '</p>' +
    '</div></body></html>';

  const boundary = '----=_NextPart_ATIK_' + Date.now();
  const locBase = 'file:///C:/ATIK_GRAFIKLER/';
  let mht =
    'From: "Atik Kontrol Yonetim Sistemi" <rapor@local>\r\n' +
    'Subject: Grafikler - Atik Kontrol\r\n' +
    'Date: ' + new Date().toUTCString() + '\r\n' +
    'MIME-Version: 1.0\r\n' +
    'Content-Type: multipart/related; type="text/html"; boundary="' + boundary + '"\r\n\r\n' +
    'Bu bir MIME formatli birlesik belgedir.\r\n\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: text/html; charset="utf-8"\r\n' +
    'Content-Transfer-Encoding: quoted-printable\r\n' +
    'Content-Location: ' + locBase + 'grafikler.html\r\n\r\n' +
    _qpEncodeAscii(_toAsciiHtml(html)) + '\r\n';
  images.forEach(function(img) {
    mht += '--' + boundary + '\r\n' +
      'Content-Type: image/png\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      'Content-Location: ' + locBase + img.name + '\r\n\r\n' +
      _wrapBase64(img.base64) + '\r\n';
  });
  mht += '--' + boundary + '--\r\n';

  const blob = new Blob([mht], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Grafikler_' + new Date().toISOString().slice(0, 10) + '.doc';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 4000);
  showToast(idx + ' grafik Word belgesine aktarıldı.', 'success');
}

function exportYillikPDF() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const printWin = window.open('', '_blank', 'width=1100,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  const canvases = document.querySelectorAll('#content-yillik canvas');
  const replacements = [];
  canvases.forEach(c => {
    const img = document.createElement('img');
    const pieArea = c.closest ? c.closest('.chart-area-pie') : null;
    if (pieArea) {
      const w = c.width, h = c.height;
      const side = Math.max(20, Math.min(w, h));
      const sx = Math.floor((w - side) / 2);
      const sy = Math.floor((h - side) / 2);
      const tmp = document.createElement('canvas');
      tmp.width = side; tmp.height = side;
      tmp.getContext('2d').drawImage(c, sx, sy, side, side, 0, 0, side, side);
      img.src = tmp.toDataURL();
      img.style.width = '96px';
      img.style.height = '96px';
    } else {
      img.src = c.toDataURL();
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    }
    replacements.push({ old: c.outerHTML, new: img.outerHTML });
  });
  let html = document.getElementById('content-yillik').innerHTML;
  replacements.forEach(r => { html = html.replace(r.old, r.new); });
  printWin.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>Yıllık Karşılaştırma - Atık Kontrol</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      h1 { font-size: 1.3rem; margin-bottom: 0.5rem; }
      .date { font-size: 0.8rem; color: #666; margin-bottom: 1.5rem; }
      .section-card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; page-break-inside: avoid; }
      .section-header h2 { font-size: 0.95rem; margin: 0 0 0.5rem; }
      canvas { max-width: 100%; height: auto !important; }
      .donut-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.8rem; margin-bottom: 1rem; }
      .donut-grid .chart-card { padding: 0.6rem 0.75rem; text-align: center; }
      .donut-grid .chart-area-pie { height: 120px; display: flex; align-items: center; justify-content: center; }
      .donut-grid .chart-area-pie img { width: 96px; height: 96px; object-fit: contain; margin: 0 auto; }
      .donut-grid .section-header h2 { font-size: 0.8rem; margin: 0 0 0.4rem; }
      .donut-legend { display: flex; justify-content: center; flex-wrap: wrap; gap: 0.6rem 1rem; font-size: 0.7rem; margin-top: 0.4rem; }
      .donut-legend-item { display: flex; align-items: center; gap: 0.25rem; color: #333; }
      .donut-legend-item .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
      .donut-legend-item .val { font-weight: 700; }
      .chart-note { font-size: 0.68rem; color: #666; margin-top: 0.35rem; }
      .chart-empty { font-size: 0.8rem; color: #999; text-align: center; padding: 2rem; }
      .chart-year-filter { display: none; }
      .toolbar-actions { display: none; }
      .chart-dl-btn { display: none !important; }
      .comparison-grid { font-size: 0.8rem; }
      .comparison-item { display: flex; gap: 1rem; padding: 0.4rem 0; border-bottom: 1px solid #eee; }
      .comparison-label { flex: 1; font-weight: 600; }
      .comparison-old, .comparison-new { width: 110px; text-align: right; }
      .comparison-diff { width: 130px; text-align: center; }
      .comparison-badge { font-weight: 700; }
      .badge { font-size: 0.75rem; color: #555; }
      .footer { text-align: center; font-size: 0.75rem; color: #999; margin-top: 2rem; border-top: 1px solid #ddd; padding-top: 0.5rem; }
      table.data-table { width: 100%; border-collapse: collapse; font-size: 0.65rem; margin-top: 0.5rem; }
      table.data-table th, table.data-table td { padding: 5px 6px; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
      table.data-table th { background: #f1f5f9; font-weight: 700; text-align: left; font-size: 0.6rem; }
      table.data-table td { text-align: right; }
      table.data-table td:first-child { text-align: left; font-weight: 500; }
      table.data-table tr:last-child { font-weight: 700; background: #f8fafc; border-top: 2px solid #cbd5e1; }
      @media print { table.data-table { font-size: 0.55rem; } table.data-table th, table.data-table td { padding: 3px 4px; } }
    </style>
  </head><body>
    <h1>Yıllık Karşılaştırma - Atık Kontrol Yönetim Sistemi</h1>
    <div class="date">${new Date().toLocaleDateString('tr-TR')}</div>
    ${html}
    <div class="footer">Atık Kontrol Yönetim Sistemi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
  </body></html>`);
  printWin.document.close();
  printWin.focus();
  triggerPrint(printWin);
}

function exportDashboardPDF() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const printWin = window.open('', '_blank', 'width=1100,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  const content = document.getElementById('content-dashboard');
  const kpiHtml = content.querySelector('.kpi-grid').outerHTML;
  const weeklyHtml = content.querySelector('.weekly-summary') ? content.querySelector('.weekly-summary').outerHTML : '';
  const cardsHtml = [...content.querySelectorAll(':scope > .section-card')].map(c => c.outerHTML).join('');
  printWin.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>Pano - Atık Kontrol</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      h1 { font-size: 1.3rem; margin-bottom: 0.3rem; }
      .date { font-size: 0.8rem; color: #666; margin-bottom: 1rem; }
      .kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-bottom: 1.5rem; }
      .kpi-card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; display: flex; align-items: center; gap: 0.8rem; page-break-inside: avoid; }
      .kpi-icon { width: 36px; height: 36px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 8px; }
      .kpi-icon svg, .ws-card-icon svg { width: 20px; height: 20px; }
      .kpi-label { font-size: 0.7rem; color: #666; font-weight: 600; text-transform: uppercase; }
      .kpi-value { font-size: 1.3rem; font-weight: 700; }
      .weekly-summary-body { display: flex; flex-wrap: wrap; gap: 0.5rem; }
      .weekly-summary-body .ws-card { display: flex; align-items: center; gap: 0.5rem; border: 1px solid #ddd; border-radius: 8px; padding: 0.5rem 0.7rem; flex: 1 1 160px; min-width: 0; }
      .weekly-summary-body .ws-card-icon { width: 32px; height: 32px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 8px; }
      .weekly-summary-body .ws-card-content { display: flex; flex-direction: column; min-width: 0; }
      .weekly-summary-body .ws-label { font-size: 0.62rem; color: #666; font-weight: 600; }
      .weekly-summary-body .ws-value { font-size: 0.95rem; font-weight: 700; color: #000; }
      .weekly-summary-body .ws-sub { font-size: 0.58rem; color: #888; }
      .weekly-summary-body .ts-item { display: flex; align-items: center; gap: 0.15rem; padding: 0.5rem 0.8rem; border: 1px solid #ddd; border-radius: 8px; min-width: 110px; flex: 1; }
      .section-card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; page-break-inside: avoid; }
      .section-header h2 { font-size: 0.95rem; margin: 0 0 0.5rem; }
      .data-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
      .data-table th { background: #f5f5f5; padding: 0.4rem 0.5rem; text-align: left; }
      .data-table td { padding: 0.35rem 0.5rem; border-bottom: 1px solid #eee; }
      .weekly-summary { border: 1px solid #ddd; border-radius: 8px; padding: 0.85rem 1.25rem; margin-bottom: 1rem; page-break-inside: avoid; }
      .weekly-summary-header { display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-weight: 700; font-size: 0.85rem; margin-bottom: 0.5rem; }
      .weekly-nav-btn { display: none !important; }
      .weekly-summary-body { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; justify-content: center; }
      .weekly-summary-body .ts-item { display: flex; flex-direction: column; align-items: center; gap: 0.15rem; padding: 0.5rem 0.8rem; border: 1px solid #ddd; border-radius: 8px; min-width: 110px; flex: 1; }
      .weekly-summary-body .ts-label { font-size: 0.65rem; color: #666; font-weight: 600; }
      .weekly-summary-body .ts-value { font-size: 1rem; font-weight: 700; }
      .toolbar, .kpi-trend, canvas, .btn { display: none; }
      .weekly-summary .badge { display: inline !important; font-size: 0.7rem; color: #666; }
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
      .section-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.4rem; }
      .section-header .badge { display: inline-block; font-size: 0.7rem; color: #555; background: #f5f5f5; border: 1px solid #ddd; border-radius: 999px; padding: 0.15rem 0.6rem; }
      .comparison-grid { display: flex; flex-direction: column; gap: 0; }
      .comparison-header-row, .comparison-item { border: none; border-radius: 0; background: transparent; padding: 0.4rem 0.5rem; border-bottom: 1px solid #ddd; box-shadow: none; }
      .comparison-header-row { background: #f5f5f5; }
      .comparison-label { width: 140px; flex-basis: 140px; font-weight: 600; flex-shrink: 0; font-size: 0.75rem; }
      .comparison-old { width: 110px; flex-shrink: 0; text-align: right; font-size: 0.75rem; }
      .comparison-arrow { flex-shrink: 0; font-size: 0.85rem; width: 16px; text-align: center; }
      .comparison-new { width: 110px; flex-shrink: 0; text-align: right; font-weight: 700; font-size: 0.8rem; }
      .comparison-diff { width: 130px; flex-shrink: 0; text-align: center; font-size: 0.75rem; }
      .comparison-badge { font-size: 0.7rem; font-weight: 700; padding: 0.1rem 0.5rem; border-radius: 999px; white-space: nowrap; }
      .footer { text-align: center; font-size: 0.75rem; color: #999; margin-top: 2rem; border-top: 1px solid #ddd; padding-top: 0.5rem; }
      ${harcamaHiddenCss()}
    </style>
  </head><body>
    <h1>Kırşehir Ahi Evran Üniversitesi - Beslenme Hizmetleri Yönetim Sistemi</h1>
    <div class="date">${new Date().toLocaleDateString('tr-TR')}</div>
    ${kpiHtml}
    ${weeklyHtml}
    ${cardsHtml}
    <div class="footer">Kırşehir Ahi Evran Üniversitesi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
  </body></html>`);
  printWin.document.close();
  printWin.focus();
  triggerPrint(printWin);
}

function exportRecordsPDF() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
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
      ${harcamaHiddenCss()}
    </style>
  </head><body>
    <h1>Tüm Kayıtlar</h1>
    <div class="date">${new Date().toLocaleDateString('tr-TR')}</div>
    ${tableHtml}
    <div class="footer">Atık Kontrol Yönetim Sistemi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
  </body></html>`);
  printWin.document.close();
  printWin.focus();
  triggerPrint(printWin);
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
  if (name === 'yillik') renderYearlyCharts();
  if (name === 'harcama') renderHarcamaMenu();
  if (name === 'birimfiyat') { renderBirimFiyatlar(); if (unitPricesCache.length === 0 && supabaseClient) syncUnitPricesFromSupabase().then(function() { renderBirimFiyatlar(); }); }
  if (name === 'report') renderReport();
  if (name === 'records') {
    if (filteredRecords.length === 0) {
      if (records.length > 0) {
        filteredRecords = [...records];
      } else if (supabaseClient) {
        await refreshRecordsFromSupabase();
      }
    }
    renderRecordsTable();
  }
  closeSidebar();
  if (name === 'menu') await renderMenu();
  if (name === 'haccp') loadHaccpData();
  if (name === 'yag') { renderYagTable(); if (yagRecords.length === 0 && supabaseClient) refreshYagFromSupabase(); }
  if (name === 'ambalaj') { renderAmbalajTable(); if (ambalajRecords.length === 0 && supabaseClient) refreshAmbalajFromSupabase(); }
  if (name === 'kalibrasyon') { renderKalibrasyon(); if (kalibrasyonCihazlari.length === 0 && supabaseClient) refreshKalibrasyonFromSupabase(); }
  const labels = { dashboard: t('sidebarPanel'), menu: t('sidebarMenu'), records: t('sidebarRecords'), charts: t('sidebarCharts'), yillik: t('sidebarYearly'), harcama: t('sidebarSpending'), birimfiyat: t('sidebarUnitPrice'), report: t('sidebarReport'), haccp: t('sidebarHaccp'), yag: t('sidebarOil'), ambalaj: t('sidebarPackaging'), kalibrasyon: t('sidebarCalibration') };
  document.getElementById('pageTitle').textContent = labels[name] || name;
  localStorage.setItem('atik_kontrol_active_tab', name);
  applyTranslations();
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
// ─── MODAL ─────────────────────────────────────────────────────────────────────
function openModal(id = null) {
  if (!canAddRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
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
    // Yemekhanede Çalışan Personel Sayısı: son kayıtta kullanılan değer otomatik dolar, elle değiştirilebilir
    const fPersonelEl = document.getElementById('fPersonel');
    if (fPersonelEl) {
      const sonPersonel = localStorage.getItem('atik_kontrol_son_personel');
      if (sonPersonel !== null) fPersonelEl.value = sonPersonel;
      autoCalcGecis();
    }
  }

  // Porsiyon: yeni kayıtta sabit (400), düzenlemede değiştirilebilir (eski hataları düzeltmek için)
  const fPorsiyonEl = document.getElementById('fPorsiyon');
  const fPorsiyonBadge = document.getElementById('fPorsiyonBadge');
  if (fPorsiyonEl) {
    if (id !== null) {
      fPorsiyonEl.readOnly = false;
      fPorsiyonEl.classList.remove('readonly-input');
      fPorsiyonEl.oninput = autoCalcAtik;
      if (fPorsiyonBadge) fPorsiyonBadge.textContent = 'Düzenlenebilir';
    } else {
      fPorsiyonEl.readOnly = true;
      fPorsiyonEl.classList.add('readonly-input');
      fPorsiyonEl.oninput = null;
      if (fPorsiyonBadge) fPorsiyonBadge.textContent = 'Sabit';
    }
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
  autoCalc();
  autoCalcHarcama();
}

// ─── AUTO CALC ─────────────────────────────────────────────────────────────────
function autoCalc() {
  const yemek = parseFloat(document.getElementById('fYemek').value) || 0;
  document.getElementById('fFire').value = (yemek * 0.9).toFixed(2);
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
  // Formül: (FireMiktarı - ToplamGeçiş) x Porsiyon / 1000
  // Örnek: fire=495, toplam=443, porsiyon=400 → (495-443)*400/1000 = 20,80 kg
  const atik = Math.max(0, (fire - toplam) * porsiyon / 1000);
  document.getElementById('fAtik').value = atik.toFixed(2);
}

function autoCalcHarcama() {
  const ogrenci = parseInt(document.getElementById('fOgrenci').value) || 0;
  const oran = getOgrenciBasiHarcamaOrani();
  const harcama = ogrenci * oran;
  const el = document.getElementById('fHarcama');
  if (el) el.value = harcama.toFixed(2);
}

// ─── DEFERRED RENDER ───────────────────────────────────────────────────────────
function scheduleRender() {
  setTimeout(function() {
    try { renderAll(); } catch (e) { console.warn('renderAll:', e); }
  }, 50);
  setTimeout(function() {
    try { drawAllCharts(); } catch (e) { console.warn('drawAllCharts:', e); }
  }, 100);
}

// ─── SAVE / UPDATE RECORD ──────────────────────────────────────────────────────
function saveRecord(e) {
  if (!canAddRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  e.preventDefault();

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

  formModified = false;
  const savedEditingId = editingId;
  closeModal();

  try {
    const yemek  = parseFloat(document.getElementById('fYemek').value)   || 0;
    const fire   = parseFloat(document.getElementById('fFire').value)    || 0;
    const turnike = parseInt(document.getElementById('fTurnike').value)   || 0;
    const personel = parseInt(document.getElementById('fPersonel').value) || 0;
    const ogrenci  = parseInt(document.getElementById('fOgrenci').value)  || 0;
    const toplam  = parseInt(document.getElementById('fToplam').value)    || 0;
    const porsiyon = parseInt(document.getElementById('fPorsiyon').value) || 0;
    const atik = Math.max(0, (fire - toplam) * porsiyon / 1000);
    const harcama_tutari = ogrenci * getOgrenciBasiHarcamaOrani();
    // Yemekhanede çalışan personel sayısını sonraki kayıtlar için otomatik doldurmak üzere sakla
    try { localStorage.setItem('atik_kontrol_son_personel', String(personel)); } catch (_) {}

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
      harcama_tutari,
      id: savedEditingId !== null ? savedEditingId : Date.now()
    };

    if (savedEditingId !== null) {
      const idx = records.findIndex(r => r.id === savedEditingId);
      if (idx !== -1) records[idx] = rec;
      showToast('Kayıt başarıyla güncellendi.', 'success');
      logIslem('kayit_duzenle', 'yemek #' + savedEditingId + ' güncellendi');
    } else {
      records.push(rec);
      showToast('Yeni kayıt başarıyla eklendi.', 'success');
      logIslem('yeni_kayit', 'yemek ' + (rec.tarih || '') + ' eklendi');
    }

    records.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
    saveData();
    filteredRecords = [...records];
    scheduleRender();
  } catch (e) {
    showToast('Hata: ' + e.message, 'error');
  }
}

// ─── DELETE ────────────────────────────────────────────────────────────────────
async function deleteRecord(id) {
  if (!canAddRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
  if (supabaseClient) {
    try {
      var { error } = await supabaseClient.from('records').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      showToast('Supabase\'den silinemedi: ' + (e.message || e), 'error');
      return;
    }
  }
  try {
    records = records.filter(function(r) { return r.id !== id; });
    selectedIds.delete(id);
    saveData();
    filteredRecords = [...records];
    renderRecordsTable();
    renderAll();
    drawAllCharts();
    showToast('Kayıt silindi.', 'success');
    logIslem('kayit_sil', 'yemek #' + id + ' silindi');
  } catch (e) {
    showToast('Hata: ' + e.message, 'error');
  }
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
  if (!canAddRecords()) return;
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  renderRecordsTable();
}

function toggleSelectAll() {
  if (!canAddRecords()) return;
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
  if (canAddRecords() && selectedIds.size > 0) {
    bar.style.display = 'flex';
    count.textContent = selectedIds.size + ' seçili';
  } else {
    bar.style.display = 'none';
  }
}

function deleteSelected() {
  if (!canAddRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  if (selectedIds.size === 0) {
    showToast('Seçili kayıt yok.', 'error');
    return;
  }
  if (!confirm('Seçili ' + selectedIds.size + ' kaydı silmek istediğinize emin misiniz?')) return;
  try {
    var ids = [...selectedIds];
    records = records.filter(function(r) { return !selectedIds.has(r.id); });
    selectedIds.clear();
    saveData();
    if (supabaseClient && ids.length > 0) {
      (async function() { try { await supabaseClient.from('records').delete().in('id', ids); } catch (_) {} })();
    }
    filteredRecords = [...records];
    currentPage = 1;
    renderRecordsTable();
    renderAll();
    drawAllCharts();
    showToast('Seçili kayıtlar silindi.', 'success');
  } catch (e) {
    showToast('Hata: ' + e.message, 'error');
  }
}

// ─── IMPORT ────────────────────────────────────────────────────────────────────
// ─── CSV YARDIMCILARI (Türkçe format: tırnaklı alan, binlik nokta, ondalık virgül) ──
function parseCsvText(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === ';') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
}

function _csvNormKey(s) {
  return String(s).toLocaleLowerCase('tr').replace(/[^a-zçğıöşü0-9]/g, '');
}

function mapCsvHeader(h) {
  const k = _csvNormKey(h);
  if (!k) return '';
  if (/tarih|tarıh/.test(k)) return 'tarih';
  if (/öğr|ogrenci|öğrenci/.test(k)) return 'ogrenci';
  if (/tür[üu]|ad[ıi]$/.test(k)) return 'yemek_adi';
  if (/fire/.test(k)) return 'fire';
  if (/turnike/.test(k)) return 'turnike';
  if (/porsiyon/.test(k)) return 'porsiyon';
  if (/atık|atik/.test(k)) return 'atik';
  if (/harcama/.test(k)) return 'harcama_tutari';
  if (/personel|pers/.test(k)) return 'personel';
  if (/toplam/.test(k)) return 'toplam';
  if (/üretilen|uretilen|üretim|uretim/.test(k)) return 'yemek';
  return '';
}

function parseTrNum(v) {
  if (v === undefined || v === null) return 0;
  let s = String(v).trim();
  if (!s || s === '-') return 0;
  const neg = /^-/.test(s);
  s = s.replace(/^-/, '').replace(/[^\d.,]/g, '');
  // 1.283 veya 1.283,50 -> binlik ayraç noktalarını kaldır
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

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
        const rows = parseCsvText(content);
        if (rows.length < 2) throw new Error('CSV en az 2 satır olmalı (başlık + veri)');
        const headers = rows[0].map(mapCsvHeader);
        for (let i = 1; i < rows.length; i++) {
          const cells = rows[i];
          const row = {};
          headers.forEach((field, idx) => {
            if (!field) return;
            row[field] = (cells[idx] !== undefined ? String(cells[idx]) : '').trim();
          });
          const tarih = normalizeDate(row.tarih || '');
          if (!tarih) continue;
          const rec = {
            yemek: parseTrNum(row.yemek),
            fire: parseTrNum(row.fire),
            turnike: parseTrNum(row.turnike),
            personel: parseTrNum(row.personel),
            toplam: parseTrNum(row.toplam),
            porsiyon: parseTrNum(row.porsiyon),
            ogrenci: parseTrNum(row.ogrenci)
          };
          rec.tarih = tarih;
          // Atik: dosyada varsa aynen al (kaynak sadakati), yoksa formulle hesapla
          rec.atik = (row.atik !== undefined && row.atik !== '')
            ? parseTrNum(row.atik)
            : Math.round((rec.fire - rec.toplam) * rec.porsiyon) / 1000;
          rec.harcama_tutari = (row.harcama_tutari !== undefined && row.harcama_tutari !== '')
            ? parseTrNum(row.harcama_tutari)
            : rec.ogrenci * getOgrenciBasiHarcamaOrani();
          rec.yemek_adi = row.yemek_adi || '';
          rec.id = Date.now() + i;
          imported.push(rec);
        }
      } else {
        throw new Error('Desteklenen dosya türleri: .csv, .json');
      }
      if (imported.length === 0) {
        showToast('İçe aktarılacak geçerli kayıt bulunamadı.', 'error');
        return;
      }
      // Cift kayit korumasi: ayni tarih + uretim + turnike + yemek adi varsa atla
      const mevcutAnahtarlar = new Set(records.map(r => (r.tarih || '') + '|' + r.yemek + '|' + r.turnike + '|' + (r.yemek_adi || '')));
      const yeniKayitlar = [];
      let atlanan = 0, nextId = Date.now();
      imported.forEach(function(r) {
        const anahtar = (r.tarih || '') + '|' + r.yemek + '|' + r.turnike + '|' + (r.yemek_adi || '');
        if (mevcutAnahtarlar.has(anahtar)) { atlanan++; return; }
        while (records.some(x => x.id === nextId)) nextId++;
        r.id = nextId++;
        mevcutAnahtarlar.add(anahtar);
        yeniKayitlar.push(r);
      });
      records.push(...yeniKayitlar);
      records.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
      saveData();
      filteredRecords = [...records];
      renderAll();
      drawAllCharts();
      if (yeniKayitlar.length > 0) {
        showToast(yeniKayitlar.length + ' kayıt eklendi' + (atlanan > 0 ? ' (' + atlanan + ' kayıt zaten mevcut, atlandı)' : '') + '.', 'success');
      } else {
        showToast('Tüm kayıtlar zaten mevcut, hiçbir şey eklenmedi.', 'error');
      }
    } catch (err) {
      showToast('İçe aktarma hatası: ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

// ─── DATA MANAGEMENT ──────────────────────────────────────────────────────────
async function clearAllData() { if (!requireAdmin()) return;
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
  if (supabaseClient) {
    try { await supabaseClient.from('records').delete().neq('id', 0); } catch (_) {}
  }
  renderAll();
  drawAllCharts();
  showToast('Tüm kayıtlar silindi.', 'success');
}

function exportData() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  exportDataJSON();
}

function exportDataJSON() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
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

function exportDataCSV() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  if (records.length === 0) { showToast('Dışa aktarılacak kayıt yok.', 'error'); return; }
  var showHarcama = canSeeHarcama();
  var headers = ['Tarih','Üretilen Yemek Sayısı','%10 Fire','Turnike Geçiş Sayısı','Yemekhanede Çalışan Personel Sayısı','Toplam Geçiş','Porsiyon Miktarı (gr)','Atık Miktarı (kg)','Yemek Hiz. Yar. Öğr. Sayısı','Yemek Adı'];
  if (showHarcama) headers.splice(9, 0, 'Harcama Tutarı (₺)');
  var rows = records.map(function(r) {
    var row = [r.tarih || '', r.yemek || 0, r.fire || 0, r.turnike || 0, r.personel || 0,
      r.toplam || 0, r.porsiyon || 0, r.atik || 0, r.ogrenci || 0, (r.yemek_adi || '').replace(/"/g,'""')];
    if (showHarcama) row.splice(9, 0, r.harcama_tutari || 0);
    return row;
  });
  var csv = '\uFEFF' + headers.join(';') + '\n' + rows.map(function(r) { return r.join(';'); }).join('\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = 'atik_kontrol_' + new Date().toISOString().split('T')[0] + '.csv';
  link.click();
  URL.revokeObjectURL(url);
  showToast('CSV dosyası indirildi.', 'success');
}

function exportAllCSV() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  var done = 0;
  var total = 3;
  var tasks = [
    function() { exportDataCSV(); },
    function() { exportHaccpCSV(); },
    function() { exportYemekCSV(); }
  ];
  tasks.forEach(function(fn, i) {
    setTimeout(function() {
      fn();
      done++;
      if (done === total) showToast('Tüm CSV dosyaları indirildi.', 'success');
    }, i * 500);
  });
}

var exportRunning = false;
function exportDelay(ms) { return new Promise(function(res) { setTimeout(res, ms); }); }

async function exportEverything() {
  if (exportRunning) return;
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  exportRunning = true;
  showToast('Tüm veriler indiriliyor...', 'info');
  var yemekler = loadYemekler() || [];
  var tasks = [];
  if (records.length > 0) tasks.push(exportDataCSV);
  if (haccpRecords.length > 0) tasks.push(exportHaccpCSV);
  if (yemekler.length > 0) tasks.push(exportYemekCSV);
  if (kalibrasyonCihazlari.length > 0) tasks.push(exportKalibrasyonCSV);
  if (records.length > 0) tasks.push(exportDataSettings);
  if (tasks.length > 0) {
    tasks[0]();
    for (var i = 1; i < tasks.length; i++) {
      await exportDelay(700);
      tasks[i]();
    }
  }
  try { await exportMenuJSON(); } catch (e) { }
  await exportDelay(300);
  exportRunning = false;
  showToast('Tüm veriler indirildi.', 'success');
}

function exportDataSettings() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const settings = {
    version: 3,
    exportedAt: new Date().toISOString(),
    records: records.map(r => ({ ...r, yemek_adi: r.yemek_adi || '' }))
  };
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `atik_kontrol_yedek_${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Tüm veriler dışa aktarıldı.', 'success');
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
      saveData();
      filteredRecords = [...records];
      renderAll();
      drawAllCharts();
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
  renderWeeklySummary();
  renderDailySummary();
  renderDataInfo();
  renderLastRecordsTable();
  renderRecordsTable();
  renderReport();
  renderSparklines();
  renderWeeklyComparison();
  renderMonthlyComparison();
  renderYearlyComparison();
  var yillikContent = document.getElementById('content-yillik');
  if (yillikContent && yillikContent.classList.contains('active')) renderYearlyCharts();
  renderAnomalies();
  renderHaccp();
  renderYagTable();
  renderAmbalajTable();
  renderKalibrasyon();
}

// ─── DAILY DETAIL PANEL ─────────────────────────────────────────────────────
function changeDailyOffset(delta) {
  dailySummaryOffset += delta;
  renderDailySummary();
}

function renderDailySummary() {
  var el = document.getElementById('dailySummary');
  var body = document.getElementById('dailySummaryBody');
  var badge = document.getElementById('dailySummaryBadge');
  var label = document.getElementById('dailySummaryLabel');
  if (!el || !body) return;

  if (records.length === 0) {
    body.innerHTML = '<div class="ts-item"><span class="ts-label">' + t('wsNoRecordsYet') + '</span></div>';
    el.style.display = 'none';
    return;
  }

  var now = new Date();
  now.setDate(now.getDate() + dailySummaryOffset);
  var dayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  var dayLabel = displayDate(dayStr);

  var rec = records.find(function(r) { return r.tarih === dayStr; });

  var isToday = dailySummaryOffset === 0;
  label.textContent = isToday ? t('wsTodayDetail') : t('wsDailyDetail');
  badge.textContent = dayLabel;

  document.getElementById('dailyPrev').disabled = false;
  document.getElementById('dailyNext').disabled = dailySummaryOffset >= 0;

  if (!rec) {
    body.innerHTML = '<div class="ts-item"><span class="ts-label">' + dayLabel + ' - ' + t('wsNoRecordToday') + '</span></div>';
    return;
  }

  var yemek = rec.yemek || 0;
  var fire = rec.fire || 0;
  var turnike = rec.turnike || 0;
  var personel = rec.personel || 0;
  var toplam = rec.toplam || 0;
  var porsiyon = rec.porsiyon || 0;
  var atik = rec.atik || 0;

  var kalanYemek = yemek - fire - toplam;
  var copPorsiyon = porsiyon > 0 ? (atik * 1000 / porsiyon) : 0;

  var avgAtik = records.length > 0 ? (records.reduce(function(s,r){return s+(r.atik||0);},0) / records.length) : 0;
  var atikStatus = atik > avgAtik * 1.2 ? 'bad' : (atik < avgAtik * 0.8 ? 'good' : 'warn');

  body.innerHTML =
    '<div class="ws-card ws-cyan"><div class="ws-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12h20v2a10 10 0 01-10 10h0a10 10 0 01-10-10v-2z"/><path d="M7 8l2-6h6l2 6H7z"/><path d="M10 4v2M14 4v2"/><path d="M12 14v4"/></svg></div><div class="ws-card-content"><span class="ws-label">' + t('wsProducedMeal') + '</span><span class="ws-value">' + yemek.toLocaleString('tr-TR') + '</span></div></div>' +
    '<div class="ws-card ws-green"><div class="ws-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div><div class="ws-card-content"><span class="ws-label">' + t('wsTotalPasses') + '</span><span class="ws-value">' + toplam.toLocaleString('tr-TR') + '</span><span class="ws-sub">' + t('wsTurnstile') + ': ' + turnike + ' &middot; ' + t('wsStaffCount') + ': ' + personel + '</span></div></div>' +
    '<div class="ws-card ws-orange"><div class="ws-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div><div class="ws-card-content"><span class="ws-label">' + t('wsWasteAmount') + '</span><span class="ws-value">' + atik.toFixed(1) + ' kg</span><span class="ws-sub">' + t('wsWaste') + ': ' + fire + '</span></div></div>' +
    '<div class="ws-card ws-purple"><div class="ws-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg></div><div class="ws-card-content"><span class="ws-label">' + t('wsWastedPortion') + '</span><span class="ws-value" style="color:#ef4444">' + copPorsiyon.toFixed(0) + ' ' + t('wsPortion') + '</span><span class="ws-sub" style="font-size:0.58rem">' + atik.toFixed(1) + ' × 1000 ÷ ' + porsiyon + ' = ' + copPorsiyon.toFixed(0) + '</span></div></div>';
}

// ─── WEEKLY SUMMARY ──────────────────────────────────────────────────────────
function getWeeklyDateRange(offset) {
  var now = new Date();
  var dayOfWeek = now.getDay();
  var monOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  var monday = new Date(now);
  monday.setDate(now.getDate() + monOffset + offset * 7);
  monday.setHours(0, 0, 0, 0);
  var sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday: monday, sunday: sunday };
}

function fmtDateShort(d) {
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
}

function changeWeeklyOffset(delta) {
  weeklySummaryOffset += delta;
  renderWeeklySummary();
}

function renderWeeklySummary() {
  var el = document.getElementById('weeklySummary');
  var body = document.getElementById('weeklySummaryBody');
  var badge = document.getElementById('weeklySummaryBadge');
  var label = document.getElementById('weeklySummaryLabel');
  if (!el || !body) return;

  if (records.length === 0) {
    body.innerHTML = '<div class="ts-item"><span class="ts-label">' + t('wsNoRecordsYet') + '</span></div>';
    return;
  }

  var range = getWeeklyDateRange(weeklySummaryOffset);
  var mon = range.monday;
  var sun = range.sunday;

  function fmtISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var monStr = fmtISO(mon);
  var sunStr = fmtISO(sun);

  var weekRecs = records.filter(function(r) { return r.tarih >= monStr && r.tarih <= sunStr; });

  var topYemek = weekRecs.reduce(function(s, r) { return s + (r.yemek || 0); }, 0);
  var topTurnike = weekRecs.reduce(function(s, r) { return s + (r.turnike || 0); }, 0);
  var topPersonel = weekRecs.reduce(function(s, r) { return s + (r.personel || 0); }, 0);
  var topAtik = weekRecs.reduce(function(s, r) { return s + (r.atik || 0); }, 0);
  var topOgrenci = weekRecs.reduce(function(s, r) { return s + (r.ogrenci || 0); }, 0);

  var isCurrentWeek = weeklySummaryOffset === 0;
  label.textContent = isCurrentWeek ? t('weeklyBadge') : t('weeklySummary');
  badge.textContent = fmtDateShort(mon) + ' — ' + fmtDateShort(sun);

  document.getElementById('weeklyPrev').disabled = false;
  document.getElementById('weeklyNext').disabled = weeklySummaryOffset >= 0;

  if (weekRecs.length === 0) {
    body.innerHTML = '<div class="ts-item"><span class="ts-label">' + t('wsNoRecordThisWeek') + '</span></div>';
    return;
  }

  body.innerHTML =
    '<div class="ws-card ws-cyan"><div class="ws-card-icon"><svg viewBox="0 0 24 24" fill="none"><defs><linearGradient id="wCy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#67e8f9"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs><path d="M5 10a7 7 0 0114 0v5H5v-5z" fill="url(#wCy)"/><ellipse cx="12" cy="15" rx="7" ry="2.4" fill="url(#wCy)"/><ellipse cx="12" cy="14.6" rx="5" ry="1.6" fill="#e2f8ff" opacity="0.5"/><path d="M8.5 6.5c-.5-.9.2-2.2.2-2.2M12 5.4c-.5-.9.2-2.2.2-2.2M15.5 6.5c-.5-.9.2-2.2.2-2.2" stroke="url(#wCy)" stroke-width="1.5" stroke-linecap="round"/></svg></div><div class="ws-card-content"><span class="ws-label">' + t('wsProducedMeal') + '</span><span class="ws-value">' + topYemek.toLocaleString('tr-TR') + '</span></div></div>' +
    '<div class="ws-card ws-green"><div class="ws-card-icon"><svg viewBox="0 0 24 24" fill="none"><defs><linearGradient id="wGr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6ee7b7"/><stop offset="1" stop-color="#059669"/></linearGradient></defs><circle cx="9" cy="8" r="3.2" fill="url(#wGr)"/><path d="M3.5 20v-1.5A4.5 4.5 0 018 14h2a4.5 4.5 0 014.5 4.5V20" fill="url(#wGr)"/><circle cx="16" cy="8.8" r="2.6" fill="url(#wGr)" opacity="0.75"/><path d="M16 13.5a4.5 4.5 0 014.5 4.5v1H13v-1a4.5 4.5 0 013-4.5" fill="url(#wGr)" opacity="0.75"/></svg></div><div class="ws-card-content"><span class="ws-label">' + t('wsTotalPasses') + '</span><span class="ws-value">' + (topTurnike + topPersonel).toLocaleString('tr-TR') + '</span><span class="ws-sub">' + t('wsTurnstile') + ': ' + topTurnike.toLocaleString('tr-TR') + ' &middot; ' + t('wsStaffSKS') + ': ' + topPersonel.toLocaleString('tr-TR') + '</span></div></div>' +
    '<div class="ws-card ws-orange"><div class="ws-card-icon"><svg viewBox="0 0 24 24" fill="none"><defs><linearGradient id="wOr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdba74"/><stop offset="1" stop-color="#ea580c"/></linearGradient></defs><path d="M4 7h16l-1 13.2A1.8 1.8 0 0117.2 22H6.8A1.8 1.8 0 015 20.2L4 7z" fill="url(#wOr)"/><path d="M3 5h18v2.4H3z" fill="url(#wOr)"/><path d="M9 11h2v7H9zM13 11h2v7h-2z" fill="#fff" opacity="0.45"/><path d="M10 3h4v2h-4z" fill="url(#wOr)"/></svg></div><div class="ws-card-content"><span class="ws-label">' + t('wsWasteAmount') + '</span><span class="ws-value">' + topAtik.toFixed(1) + ' kg</span></div></div>' +
    '<div class="ws-card ws-purple"><div class="ws-card-icon"><svg viewBox="0 0 24 24" fill="none"><defs><linearGradient id="wPu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8b4fe"/><stop offset="1" stop-color="#0284c7"/></linearGradient></defs><path d="M4 7h7l2 2h7a1.5 1.5 0 011.5 1.5V18A1.5 1.5 0 0120 19.5H4A1.5 1.5 0 012.5 18V8.5A1.5 1.5 0 014 7z" fill="url(#wPu)"/><path d="M2.5 9.5h19" stroke="#fff" stroke-width="0.8" opacity="0.4"/></svg></div><div class="ws-card-content"><span class="ws-label">' + t('wsStudents') + '</span><span class="ws-value">' + topOgrenci.toLocaleString('tr-TR') + '</span></div></div>';
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
  const fmt = (d) => displayDate(d);
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
    document.getElementById('kpiHaccpAlarm').textContent = '0';
    document.getElementById('kpiKalibrasyonAlarm').textContent = '0';
    renderTrend('trendAvgAtik', null);
    renderTrend('trendTotalAtik', null);
    return;
  }

  const totalAtik = records.reduce((s, r) => s + (r.atik || 0), 0);
  const avgAtik = totalAtik / n;
  document.getElementById('kpiAvgAtik').textContent = avgAtik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const lastRec = records[0];
  const totalGecis = records.reduce((s, r) => s + (r.turnike || 0), 0);
  document.getElementById('kpiLastGecis').textContent = totalGecis.toLocaleString('tr-TR');
  document.getElementById('kpiTotalAtik').textContent = totalAtik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  renderTrend('trendAvgAtik', getTrend(avgAtik, records, 'atik'), true);
  renderTrend('trendTotalAtik', getTrend(totalAtik, records, 'atik'), true);

  // Bugünkü Üretim
  const todayStr = formatLocalDate(new Date());
  const todayRec = records.find(r => r.tarih === todayStr);
  const elBugunYemek = document.getElementById('kpiBugunYemek');
  const elBugunYemekSub = document.getElementById('kpiBugunYemekSub');
  if (todayRec) {
    elBugunYemek.textContent = (todayRec.yemek || 0).toLocaleString('tr-TR');
    elBugunYemekSub.textContent = 'Yararlanan: ' + (todayRec.toplam || 0).toLocaleString('tr-TR');
  } else {
    elBugunYemek.textContent = '—';
    elBugunYemekSub.textContent = 'Bugün kayıt yok';
  }

  // HACCP Alarm: son 24 saatteki uygunsuz sıcaklıklar
  const alarmRecs = haccpRecords.filter(function(r) {
    if (r.type !== 'sicaklik') return false;
    if (!r.tarih || !r.sicaklik) return false;
    if (r.tarih !== todayStr) {
      var d = new Date(r.tarih + 'T12:00:00');
      var now = new Date();
      if (isNaN(d) || (now - d) > 86400000 * 2) return false;
    }
    var v = parseFloat(r.sicaklik);
    if (isNaN(v)) return false;
    var limits = getDepoSicaklikLimitleri(r.depoAd);
    return v < limits.min || v > limits.max;
  });
  var alarmCount = alarmRecs.length;
  document.getElementById('kpiHaccpAlarm').textContent = alarmCount;
  var alarmSub = document.getElementById('kpiHaccpAlarmSub');
  if (alarmCount > 0) {
    alarmSub.innerHTML = '<span style="color:#ef4444;font-weight:600">' + alarmCount + ' uyarı var</span>';
  } else {
    alarmSub.textContent = 'Tüm değerler uygun';
  }

  // Kalibrasyon Alarm: süresi dolan veya kalibrasyon yapılmamış cihazlar
  var kalibrasyonAlarmSayisi = kalibrasyonCihazlari.filter(function(r) {
    var st = getKalibrasyonDurum(r);
    return st === 'suresi_doldu' || st === 'yapilmadi';
  }).length;
  var kAlarmEl = document.getElementById('kpiKalibrasyonAlarm');
  var kAlarmSub = document.getElementById('kpiKalibrasyonAlarmSub');
  if (kAlarmEl) {
    kAlarmEl.textContent = kalibrasyonAlarmSayisi;
    if (kalibrasyonAlarmSayisi > 0) {
      var yakinSayi = kalibrasyonCihazlari.filter(function(r) { return getKalibrasyonDurum(r) === 'yakinlasiyor'; }).length;
      var subTxt = kalibrasyonAlarmSayisi + ' cihaz alarmda';
      if (yakinSayi > 0) subTxt += ', ' + yakinSayi + ' yaklaşıyor';
      kAlarmSub.innerHTML = '<span style="color:#ef4444;font-weight:600">' + subTxt + '</span>';
    } else {
      var yakinToplam = kalibrasyonCihazlari.filter(function(r) { return getKalibrasyonDurum(r) === 'yakinlasiyor'; }).length;
      if (yakinToplam > 0) {
        kAlarmSub.innerHTML = '<span style="color:#f59e0b;font-weight:600">' + yakinToplam + ' cihaz yaklaşıyor</span>';
      } else {
        kAlarmSub.textContent = 'Tüm kalibrasyonlar geçerli';
      }
    }
  }
}

function renderWeeklyComparison() {
  const card = document.getElementById('weeklyCompCard');
  const grid = document.getElementById('weeklyCompGrid');
  const badge = document.getElementById('weeklyCompBadge');
  if (!card || records.length < 2) { if (card) card.style.display = 'none'; return; }

  var now = new Date();
  var dayOfWeek = now.getDay();
  var monOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  var thisMon = new Date(now); thisMon.setDate(now.getDate() + monOffset);
  var thisSun = new Date(thisMon); thisSun.setDate(thisMon.getDate() + 6);
  var lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
  var lastSun = new Date(thisMon); lastSun.setDate(thisMon.getDate() - 1);

  function fmt(d) { var y = d.getFullYear(); var m = String(d.getMonth()+1).padStart(2,'0'); var day = String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+day; }
  function inRange(r, start, end) { return r.tarih >= fmt(start) && r.tarih <= fmt(end); }

  var thisWeek = records.filter(function(r) { return inRange(r, thisMon, thisSun); });
  var lastWeek = records.filter(function(r) { return inRange(r, lastMon, lastSun); });

  if (thisWeek.length === 0 && lastWeek.length === 0) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  function sum(arr, field) { return arr.reduce(function(s, r) { return s + (r[field] || 0); }, 0); }

  var thisAtik = sum(thisWeek, 'atik');
  var lastAtik = sum(lastWeek, 'atik');
  var thisYemek = sum(thisWeek, 'yemek');
  var lastYemek = sum(lastWeek, 'yemek');
  var thisKisi = sum(thisWeek, 'toplam');
  var lastKisi = sum(lastWeek, 'toplam');
  var thisKisiAtik = thisKisi > 0 ? thisAtik / thisKisi : 0;
  var lastKisiAtik = lastKisi > 0 ? lastAtik / lastKisi : 0;
  var thisTurnike = sum(thisWeek, 'turnike');
  var lastTurnike = sum(lastWeek, 'turnike');
  var thisOgrenci = sum(thisWeek, 'ogrenci');
  var lastOgrenci = sum(lastWeek, 'ogrenci');

  badge.textContent = (thisMon.getDate()+'/'+(thisMon.getMonth()+1)) + ' - ' + (thisSun.getDate()+'/'+(thisSun.getMonth()+1)) + ' vs ' + (lastMon.getDate()+'/'+(lastMon.getMonth()+1)) + ' - ' + (lastSun.getDate()+'/'+(lastSun.getMonth()+1));

  var items = [
    { label: t('compTotalWaste'), val: thisAtik, prev: lastAtik, unit: ' kg', lower: true, decimals: 1 },
    { label: t('compTotalProduction'), val: thisYemek, prev: lastYemek, unit: ' porsiyon', lower: false, decimals: 0 },
    { label: t('compTurnstilePasses'), val: thisTurnike, prev: lastTurnike, unit: '', lower: false, decimals: 0 },
    { label: t('compStudentCount'), val: thisOgrenci, prev: lastOgrenci, unit: '', lower: false, decimals: 0 },
    { label: t('compWastePerPerson'), val: thisKisiAtik, prev: lastKisiAtik, unit: ' gr', lower: true, decimals: 2 },
  ];

  grid.innerHTML = '<div class="comparison-header-row">'
    + '<span class="comparison-label">' + t('compDataType') + '</span>'
    + '<span class="comparison-old">' + t('compLastWeek') + '</span>'
    + '<span class="comparison-arrow"></span>'
    + '<span class="comparison-new">' + t('compThisWeek') + '</span>'
    + '<span class="comparison-diff">' + t('compDiff') + '</span>'
    + '</div>'
    + items.map(function(it) {
    var diff = it.val - it.prev;
    var pct = it.prev ? (diff / it.prev) * 100 : 0;
    var good = it.lower ? diff < 0 : diff > 0;
    var cls = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');
    var arrow = diff > 0 ? '↑' : (diff < 0 ? '↓' : '→');
    var label = arrow + ' ' + (diff >= 0 ? '+' : '') + diff.toFixed(it.decimals) + it.unit;
    return '<div class="comparison-item">'
      + '<span class="comparison-label">' + it.label + '</span>'
      + '<span class="comparison-old">' + it.prev.toFixed(it.decimals) + it.unit + '</span>'
      + '<span class="comparison-arrow">→</span>'
      + '<span class="comparison-new">' + it.val.toFixed(it.decimals) + it.unit + '</span>'
      + '<span class="comparison-diff"><span class="comparison-badge ' + cls + '">' + label + '</span></span>'
      + '</div>';
  }).join('');
}

function renderMonthlyComparison() {
  const card = document.getElementById('monthlyCompCard');
  const grid = document.getElementById('monthlyCompGrid');
  const badge = document.getElementById('monthlyCompBadge');
  if (!card || records.length < 2) { if (card) card.style.display = 'none'; return; }

  var now = new Date();
  var thisStart = new Date(now.getFullYear(), now.getMonth(), 1);
  var thisEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  var lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var lastEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  function fmt(d) { var y = d.getFullYear(); var m = String(d.getMonth()+1).padStart(2,'0'); var day = String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+day; }
  function inRange(r, start, end) { return r.tarih >= fmt(start) && r.tarih <= fmt(end); }

  var thisMonth = records.filter(function(r) { return inRange(r, thisStart, thisEnd); });
  var lastMonth = records.filter(function(r) { return inRange(r, lastStart, lastEnd); });

  if (thisMonth.length === 0 && lastMonth.length === 0) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  function sum(arr, field) { return arr.reduce(function(s, r) { return s + (r[field] || 0); }, 0); }

  var thisAtik = sum(thisMonth, 'atik');
  var lastAtik = sum(lastMonth, 'atik');
  var thisYemek = sum(thisMonth, 'yemek');
  var lastYemek = sum(lastMonth, 'yemek');
  var thisKisi = sum(thisMonth, 'toplam');
  var lastKisi = sum(lastMonth, 'toplam');
  var thisKisiAtik = thisKisi > 0 ? thisAtik / thisKisi : 0;
  var lastKisiAtik = lastKisi > 0 ? lastAtik / lastKisi : 0;
  var thisTurnike = sum(thisMonth, 'turnike');
  var lastTurnike = sum(lastMonth, 'turnike');
  var thisOgrenci = sum(thisMonth, 'ogrenci');
  var lastOgrenci = sum(lastMonth, 'ogrenci');

  var months = t('monthNames');
  badge.textContent = months[thisStart.getMonth()] + ' vs ' + months[lastStart.getMonth()];

  var items = [
    { label: t('compTotalWaste'), val: thisAtik, prev: lastAtik, unit: ' kg', lower: true, decimals: 1 },
    { label: t('compTotalProduction'), val: thisYemek, prev: lastYemek, unit: ' porsiyon', lower: false, decimals: 0 },
    { label: t('compTurnstilePasses'), val: thisTurnike, prev: lastTurnike, unit: '', lower: false, decimals: 0 },
    { label: t('compStudentCount'), val: thisOgrenci, prev: lastOgrenci, unit: '', lower: false, decimals: 0 },
    { label: t('compWastePerPerson'), val: thisKisiAtik, prev: lastKisiAtik, unit: ' gr', lower: true, decimals: 2 },
  ];

  grid.innerHTML = '<div class="comparison-header-row">'
    + '<span class="comparison-label">' + t('compDataType') + '</span>'
    + '<span class="comparison-old">' + t('compLastMonth') + '</span>'
    + '<span class="comparison-arrow"></span>'
    + '<span class="comparison-new">' + t('compThisMonth') + '</span>'
    + '<span class="comparison-diff">' + t('compDiff') + '</span>'
    + '</div>'
    + items.map(function(it) {
    var diff = it.val - it.prev;
    var cls = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');
    var arrow = diff > 0 ? '↑' : (diff < 0 ? '↓' : '→');
    var label = arrow + ' ' + (diff >= 0 ? '+' : '') + diff.toFixed(it.decimals) + it.unit;
    return '<div class="comparison-item">'
      + '<span class="comparison-label">' + it.label + '</span>'
      + '<span class="comparison-old">' + it.prev.toFixed(it.decimals) + it.unit + '</span>'
      + '<span class="comparison-arrow">→</span>'
      + '<span class="comparison-new">' + it.val.toFixed(it.decimals) + it.unit + '</span>'
      + '<span class="comparison-diff"><span class="comparison-badge ' + cls + '">' + label + '</span></span>'
      + '</div>';
  }).join('');
}

function renderYearlyComparison() {
  const card = document.getElementById('yearlyCompCard');
  const grid = document.getElementById('yearlyCompGrid');
  const badge = document.getElementById('yearlyCompBadge');
  if (!card || records.length < 2) { if (card) card.style.display = 'none'; return; }

  var now = new Date();
  var thisStart = new Date(now.getFullYear(), 0, 1);
  var thisEnd = now;
  var lastStart = new Date(now.getFullYear() - 1, 0, 1);
  var lastEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

  function fmt(d) { var y = d.getFullYear(); var m = String(d.getMonth()+1).padStart(2,'0'); var day = String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+day; }
  function inRange(r, start, end) { return r.tarih >= fmt(start) && r.tarih <= fmt(end); }

  var thisYear = records.filter(function(r) { return inRange(r, thisStart, thisEnd); });
  var lastYear = records.filter(function(r) { return inRange(r, lastStart, lastEnd); });

  if (thisYear.length === 0 && lastYear.length === 0) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  function sum(arr, field) { return arr.reduce(function(s, r) { return s + (r[field] || 0); }, 0); }

  var thisAtik = sum(thisYear, 'atik');
  var lastAtik = sum(lastYear, 'atik');
  var thisYemek = sum(thisYear, 'yemek');
  var lastYemek = sum(lastYear, 'yemek');
  var thisKisi = sum(thisYear, 'toplam');
  var lastKisi = sum(lastYear, 'toplam');
  var thisKisiAtik = thisKisi > 0 ? thisAtik / thisKisi : 0;
  var lastKisiAtik = lastKisi > 0 ? lastAtik / lastKisi : 0;
  var thisTurnike = sum(thisYear, 'turnike');
  var lastTurnike = sum(lastYear, 'turnike');
  var thisOgrenci = sum(thisYear, 'ogrenci');
  var lastOgrenci = sum(lastYear, 'ogrenci');

  badge.textContent = now.getFullYear() + ' vs ' + (now.getFullYear() - 1);

  var items = [
    { label: t('compTotalWaste'), val: thisAtik, prev: lastAtik, unit: ' kg', lower: true, decimals: 1 },
    { label: t('compTotalProduction'), val: thisYemek, prev: lastYemek, unit: ' porsiyon', lower: false, decimals: 0 },
    { label: t('compTurnstilePasses'), val: thisTurnike, prev: lastTurnike, unit: '', lower: false, decimals: 0 },
    { label: t('compStudentCount'), val: thisOgrenci, prev: lastOgrenci, unit: '', lower: false, decimals: 0 },
    { label: t('compWastePerPerson'), val: thisKisiAtik, prev: lastKisiAtik, unit: ' gr', lower: true, decimals: 2 },
  ];

  grid.innerHTML = '<div class="comparison-header-row">'
    + '<span class="comparison-label">' + t('compDataType') + '</span>'
    + '<span class="comparison-old">' + t('compLastYear') + '</span>'
    + '<span class="comparison-arrow"></span>'
    + '<span class="comparison-new">' + t('compThisYear') + '</span>'
    + '<span class="comparison-diff">' + t('compDiff') + '</span>'
    + '</div>'
    + items.map(function(it) {
    var diff = it.val - it.prev;
    var cls = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');
    var arrow = diff > 0 ? '↑' : (diff < 0 ? '↓' : '→');
    var label = arrow + ' ' + (diff >= 0 ? '+' : '') + diff.toFixed(it.decimals) + it.unit;
    return '<div class="comparison-item">'
      + '<span class="comparison-label">' + it.label + '</span>'
      + '<span class="comparison-old">' + it.prev.toFixed(it.decimals) + it.unit + '</span>'
      + '<span class="comparison-arrow">→</span>'
      + '<span class="comparison-new">' + it.val.toFixed(it.decimals) + it.unit + '</span>'
      + '<span class="comparison-diff"><span class="comparison-badge ' + cls + '">' + label + '</span></span>'
      + '</div>';
  }).join('');
}

var anomalyPage = 0;
var ANOMALY_PAGE_SIZE = 5;
var anomalyList = [];

function renderAnomalies() {
  const card = document.getElementById('anomalyCard');
  const table = document.getElementById('anomalyTable');
  const tbody = document.getElementById('anomalyTbody');
  const badge = document.getElementById('anomalyBadge');
  if (!card || records.length < 5) { if (card) card.style.display = 'none'; return; }

  var values = records.map(function(r) { return r.atik || 0; });
  var mean = values.reduce(function(s, v) { return s + v; }, 0) / values.length;
  var stddev = Math.sqrt(values.reduce(function(s, v) { return s + (v - mean) * (v - mean); }, 0) / values.length);
  var threshold = mean + 1.5 * stddev;

  anomalyList = records.filter(function(r) { return (r.atik || 0) > threshold; });
  anomalyList.sort(function(a, b) { return a.tarih < b.tarih ? 1 : -1; });

  if (anomalyList.length === 0) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  badge.textContent = anomalyList.length + ' anormal gün';

  var totalPages = Math.max(1, Math.ceil(anomalyList.length / ANOMALY_PAGE_SIZE));
  if (anomalyPage >= totalPages) anomalyPage = totalPages - 1;
  if (anomalyPage < 0) anomalyPage = 0;
  var start = anomalyPage * ANOMALY_PAGE_SIZE;
  var pageList = anomalyList.slice(start, start + ANOMALY_PAGE_SIZE);

  table.style.display = 'table';
  tbody.innerHTML = pageList.map(function(r) {
    var pctAbove = mean > 0 ? ((r.atik - mean) / mean) * 100 : 0;
    var por = (r.porsiyon || 400) > 0 ? ((r.atik || 0) * 1000 / (r.porsiyon || 400)) : 0;
    return '<tr>'
      + '<td style="font-weight:600;white-space:nowrap">' + displayDate(r.tarih) + '</td>'
      + '<td class="td-atik">' + (r.atik || 0).toFixed(1) + '</td>'
      + '<td style="color:var(--accent-orange)">' + por.toFixed(0) + '</td>'
      + '<td>' + mean.toFixed(1) + '</td>'
      + '<td><span class="comparison-badge up">+' + pctAbove.toFixed(0) + '%</span></td>'
      + '<td>' + (r.yemek_adi || '—') + '</td>'
      + '</tr>';
  }).join('');

  renderAnomalyPagination();
}

function renderAnomalyPagination() {
  const container = document.getElementById('anomalyPagination');
  if (!container) return;
  const totalPages = Math.max(1, Math.ceil(anomalyList.length / ANOMALY_PAGE_SIZE));
  if (totalPages <= 1) { container.style.display = 'none'; container.innerHTML = ''; return; }
  container.style.display = 'flex';
  const p = anomalyPage + 1;
  let html = '';
  html += `<button class="btn btn-ghost btn-sm" onclick="goToAnomalyPage(1)" ${p === 1 ? 'disabled' : ''}>&#171;</button>`;
  html += `<button class="btn btn-ghost btn-sm" onclick="goToAnomalyPage(${p - 1})" ${p === 1 ? 'disabled' : ''}>&#8249;</button>`;
  html += `<span class="page-info">${p} / ${totalPages}</span>`;
  html += `<button class="btn btn-ghost btn-sm" onclick="goToAnomalyPage(${p + 1})" ${p === totalPages ? 'disabled' : ''}>&#8250;</button>`;
  html += `<button class="btn btn-ghost btn-sm" onclick="goToAnomalyPage(${totalPages})" ${p === totalPages ? 'disabled' : ''}>&#187;</button>`;
  html += `<span class="page-total">${anomalyList.length} kayıt</span>`;
  container.innerHTML = html;
}

function goToAnomalyPage(p) {
  const totalPages = Math.max(1, Math.ceil(anomalyList.length / ANOMALY_PAGE_SIZE));
  if (p < 1) p = 1;
  if (p > totalPages) p = totalPages;
  anomalyPage = p - 1;
  renderAnomalies();
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

function getYearFilteredRecords() {
  if (!recordsYearFilter || Number(recordsYearFilter) === 0) return [...records];
  return records.filter(r => {
    if (!r.tarih) return false;
    const d = new Date(r.tarih + 'T12:00:00');
    return !isNaN(d) && d.getFullYear() === Number(recordsYearFilter);
  });
}

function renderRecordsYearFilter() {
  const container = document.getElementById('recordsYearFilter');
  if (!container) return;
  const years = getAvailableYears();
  const selectStyle = 'padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;background:var(--bg-card);color:var(--text)';
  let h = '<div style="display:flex;gap:6px;align-items:center">';
  h += '<label style="font-size:0.8rem;color:var(--text-muted);white-space:nowrap">Yıl:</label>';
  h += '<select onchange="setRecordsYear(this.value)" style="' + selectStyle + '">';
  h += '<option value="0"' + (Number(recordsYearFilter) === 0 ? ' selected' : '') + '>Tümü</option>';
  years.forEach(y => {
    const s = Number(recordsYearFilter) === Number(y) ? ' selected' : '';
    h += '<option value="' + y + '"' + s + '>' + y + '</option>';
  });
  h += '</select></div>';
  container.innerHTML = h;
}

function setRecordsYear(v) {
  recordsYearFilter = Number(v) || 0;
  renderRecordsTable();
}

function renderRecordsTable() {
  const tbody = document.getElementById('recordsTbody');
  const table = document.getElementById('recordsTable');
  const empty = document.getElementById('emptyStateRecords');

  filteredRecords = getYearFilteredRecords();
  renderRecordsYearFilter();

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
  const dateStr = displayDate(r.tarih);
  const canMutate = showActions && canAddRecords();

  const checkbox = canMutate ? `
    <td>
      <input type="checkbox" class="row-checkbox" ${selectedIds.has(r.id) ? 'checked' : ''}
        onchange="toggleSelect(${r.id})" />
    </td>` : (showActions ? '<td></td>' : '');

  const actions = canMutate ? `
    <td>
      <div style="display:flex;gap:0.4rem">
        <button class="btn btn-icon" onclick="openModal(${r.id})" title="Düzenle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-danger" onclick="deleteRecord(${r.id})" title="Sil">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    </td>` : (showActions ? '<td></td>' : '');

  const mealBadge = r.yemek_adi ? `<span class="meal-badge">${escapeHtml(r.yemek_adi)}</span>` : '';

  const safe = (v) => (v ?? 0);
  return `<tr class="${selectedIds.has(r.id) ? 'row-selected' : ''}">
    ${checkbox}
    <td>${dateStr}</td>
    <td>${safe(r.yemek).toLocaleString('tr-TR')}</td>
    <td>${safe(r.fire).toLocaleString('tr-TR')}</td>
    <td class="td-gecis">${safe(r.toplam).toLocaleString('tr-TR')}</td>
    <td class="${(r.porsiyon||0) !== 400 ? 'porsiyon-warn' : ''}">${safe(r.porsiyon).toLocaleString('tr-TR')}</td>
    <td class="td-atik">${safe(r.atik).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg</td>
    <td style="color:var(--accent-orange);font-weight:600">${(r.porsiyon > 0 ? (r.atik * 1000 / r.porsiyon) : 0).toFixed(0)} prs.</td>
    ${showActions ? `
    <td>${mealBadge}</td>` : ''}
    ${actions}
  </tr>`;

}

function buildReportRow(r) {
  const dateStr = displayDate(r.tarih);
  const mealBadge = r.yemek_adi ? `<span class="meal-badge">${escapeHtml(r.yemek_adi)}</span>` : '';
  const safe = (v) => (v ?? 0);
  const turnike = safe(r.turnike);
  const ogrenci = safe(r.ogrenci);
  const personel = safe(r.personel);
  // Turnike = Akademik/İdari Personel + Öğrenci → Akademik ve İdari = Turnike − Öğrenci
  const idariAkademik = Math.max(0, turnike - ogrenci);
  const fazlalik = ogrenci > turnike ? ' style="background:rgba(250,204,21,0.18);outline:1px solid rgba(250,204,21,0.5)"' : '';
  return `<tr${fazlalik}>
    <td>${dateStr}</td>
    <td>${safe(r.yemek).toLocaleString('tr-TR')}</td>
    <td>${safe(r.fire).toLocaleString('tr-TR')}</td>
    <td class="td-gecis">${turnike.toLocaleString('tr-TR')}</td>
    <td>${idariAkademik.toLocaleString('tr-TR')}</td>
    <td>${ogrenci.toLocaleString('tr-TR')}</td>
    <td class="td-personel">${personel.toLocaleString('tr-TR')}</td>
    <td class="td-gecis">${safe(r.toplam).toLocaleString('tr-TR')}</td>
    <td class="${(r.porsiyon||0) !== 400 ? 'porsiyon-warn' : ''}">${safe(r.porsiyon).toLocaleString('tr-TR')}</td>
    <td class="td-atik">${safe(r.atik).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg</td>
    <td style="color:var(--accent-orange);font-weight:600">${(r.porsiyon > 0 ? (r.atik * 1000 / r.porsiyon) : 0).toFixed(0)} prs.</td>
  </tr>`;
}

// ===== ORTAK KATEGORİ YARDIMCILARI =====
var MENU_KATEGORI_SOZLUK = {
  'Et Ürünleri': ['kıyma', 'kiyma', 'tavuk', 'sığır', 'sigir', 'kuzu', 'balık', 'balik', 'sucuk', 'sosis', 'pastırma', 'pastirma', 'jambon', 'antrikot', 'bonfile', 'pirzola', 'kavurma', 'döner', 'doner', 'köfte', 'kofte', 'fileto', 'adana', 'urfa', 'dana', 'kuyruk yağı', 'kuyruk'],
  'Süt Ürünleri': ['süt', 'sut', 'yoğurt', 'yogurt', 'peynir', 'tereyağı', 'tereyagi', 'tereyağ', 'terayağı', 'tereyag', 'ayran', 'kaşar', 'kasar', 'krema', 'çökelek', 'cökelek', 'süzme', 'kaymak', 'beyaz peynir', 'lor', 'kefir', 'yumurta'],
  'Kuru Bakliyat': ['nohut', 'mercimek', 'fasulye', 'pirinç', 'pirinc', 'bulgur', 'mısır', 'misir', 'arpa', 'buğday', 'bugday', 'kuru fasulye', 'maş', 'barbunya', 'keşkek', 'keskek', 'susam', 'tahin', 'makarna', 'şehriye', 'sehriye', 'erişte', 'eriste', 'noodle', 'tel şehriye', 'yufka', 'un'],
  'Baharatlar': ['tuz', 'kırmızı biber', 'pul biber', 'toz biber', 'nane', 'kuru nane', 'taze nane', 'karabiber', 'kimyon', 'kekik', 'sumak', 'zerdeçal', 'tarçın', 'yenibahar', 'mahlep', 'safran', 'köri', 'hardal', 'vanilya', 'kakule', 'zencefil', 'muskat', 'çöven', 'isot', 'tatlı biber', 'acı biber', 'çemen', 'çemenotu', 'rigan', 'reyhan', 'defne yaprağı', 'hing', 'darçın', 'anason', 'yıldız anason', 'karanfil', 'alibiber', 'çam fıstığı', 'fındık', 'badem', 'ceviz'],
  'Sebze ve Meyve': ['domates', 'biber', 'çarliston biber', 'kapya biber', 'sivri biber', 'yeşil biber', 'soğan', 'sogan', 'sarımsak', 'patates', 'patlıcan', 'salatalık', 'salatalik', 'salça', 'salca', 'limon', 'marul', 'çilek', 'cilek', 'muz', 'portakal', 'elma', 'üzüm', 'uzum', 'havuç', 'havuc', 'kabak', 'ıspanak', 'ispanak', 'lahana', 'brokoli', 'karnabahar', 'dereotu', 'maydanoz', 'rok', 'tarhun', 'rezene', 'kereviz', 'pırasa', 'pirasa', 'bezelye', 'mantar', 'kuşkonmaz', 'enginar', 'kuru incir', 'incir', 'kuru kayısı', 'kayısı', 'kuru üzüm', 'kuru erik', 'erik', 'kiraz', 'vişne', 'nar', 'armut', 'kavun', 'karpuz', 'ananas', 'greyfurt', 'mandalina', 'kivi', 'balkabağı', 'kestane']
};
var MENU_KATEGORI_SIRASI = ['Et Ürünleri', 'Süt Ürünleri', 'Kuru Bakliyat', 'Baharatlar', 'Sebze ve Meyve', 'Diğer'];
var MENU_KATEGORI_RENKLERI = {
  'Et Ürünleri': { bg: '#fef2f2', border: '#fca5a5', icon: '🥩', renk: '#dc2626' },
  'Süt Ürünleri': { bg: '#eff6ff', border: '#93c5fd', icon: '🧀', renk: '#2563eb' },
  'Kuru Bakliyat': { bg: '#fefce8', border: '#fde047', icon: '🫘', renk: '#ca8a04' },
  'Baharatlar': { bg: '#fff7ed', border: '#fdba74', icon: '🌶️', renk: '#ea580c' },
  'Sebze ve Meyve': { bg: '#f0fdf4', border: '#86efac', icon: '🥬', renk: '#16a34a' },
  'Diğer': { bg: '#f1f5f9', border: '#94a3b8', icon: '📦', renk: '#475569' }
};

function menuGetKategori(malzemeAdi) {
  var ad = malzemeAdi.toLowerCase().trim()
    .replace(/[ıI]/g, 'ı').replace(/İ/g, 'i')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (var kategori in MENU_KATEGORI_SOZLUK) {
    var keywords = MENU_KATEGORI_SOZLUK[kategori];
    for (var i = 0; i < keywords.length; i++) {
      var kw = keywords[i].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      var re = new RegExp('(?:^|[\\s,;|/])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[\\s,;|/]|$)');
      if (re.test(ad) || kw === ad) return kategori;
    }
  }
  return 'Diğer';
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
  const normBirim = normBirimGlobal;
  const fmt = (total, birim) => {
    if (total <= 0) return '—';
    if (birim === 'gr') return total >= 1000 ? (Math.round(total / 10) / 100) + ' kg' : Math.round(total) + ' gr';
    if (birim === 'ml') return total >= 1000 ? (Math.round(total / 10) / 100) + ' lt' : Math.round(total) + ' ml';
    if (birim === 'lt' || birim === 'litre') return (Math.round(total * 100) / 100) + ' lt';
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
  if (!hasAny) { section.style.display = 'none'; renderWeeklyTotal([], days); renderMaliTablo(days); return; }
  section.style.display = 'block';

  const wrapper = section.querySelector('.table-wrapper');
  let html = '';
  days.forEach(d => {
    const kisi = d.data.kisi || 0;
    html += `<div class="prod-day"><div class="prod-day-header"><span class="prod-day-label">${d.gun}</span><span class="prod-day-kisi">${kisi} ${t('person')}</span></div><div class="prod-day-body"><div class="prod-cesit-row">`;

    const dayAgg = {};
    for (let ci = 0; ci < 5; ci++) {
      const raw = d.data.yemekler[ci] || '';
      const name = parseDishName(raw);
      if (!name) continue;
      const dish = findDish(name);

      html += `<div class="prod-cesit-col prod-cesit-col-c${ci + 1}"><div class="prod-cesit">${ci + 1}. Çeşit: ${escapeHtml(name)}</div>`;

      if (dish && dish.tarif && dish.tarif.length) {
        dish.tarif.forEach((ing, idx) => {
          const miktarKisi = ing.miktar_kisi || ing.miktar || 0;
          const total = miktarKisi * kisi;
          const birim = normBirim(ing.birim);
          const birimLabel = birim === 'gr' ? ' gr' : birim === 'ml' ? ' ml' : birim === 'lt' || birim === 'litre' ? ' lt' : ' ' + birim;
          html += `<div class="prod-ing"><span class="prod-num">${idx + 1}.</span><span class="prod-name">${escapeHtml(ing.malzeme.trim())} <span class="prod-kisi-birim">(${miktarKisi}${birimLabel})</span></span><span class="prod-sep">—</span><span class="prod-qty">${fmt(total, birim)}</span></div>`;

          const key = ing.malzeme.trim().toLowerCase() + '|' + birim;
          if (!dayAgg[key]) {
            dayAgg[key] = { ad: ing.malzeme.trim(), birim, total: 0, miktarKisi, birimLabel, cesitler: 0, cesitSet: {} };
          }
          dayAgg[key].total += miktarKisi * kisi;
          if (!dayAgg[key].cesitSet[ci]) {
            dayAgg[key].cesitSet[ci] = true;
            dayAgg[key].cesitler++;
          }
        });
      }
      html += '</div>';
    }
    html += '</div>';

    const dayEntries = Object.values(dayAgg).filter(e => e.total > 0);
    if (dayEntries.length) {
      var gunlukToplam = 0;
      dayEntries.forEach(e => {
        var hesapMiktari = (e.birim === 'adet') ? Math.ceil(e.total) : e.total;
        var tut = birimFiyatTutar(e.ad, e.birim, hesapMiktari);
        if (tut > 0) gunlukToplam += Math.round(tut * 100) / 100;
      });
        html += `<div class="prod-day-total"><div class="prod-day-total-header"><span class="prod-day-total-icon">Σ</span> ${t('stockDeductionList')} – ${d.gun}${gunlukToplam > 0 ? `<span style="margin-left:auto;font-weight:700;font-size:0.88rem;color:var(--accent-cyan)">${t('total')}: ${formatTRY(gunlukToplam)}</span>` : ''}</div>${gunlukToplam > 0 ? `<div class="prod-day-kisibasi">${t('perPersonCost')}: ${kisi > 0 ? formatTRY(Math.round((gunlukToplam / kisi) * 100) / 100) : '—'}</div>` : ''}<div class="prod-day-total-body">`;
      dayEntries.forEach((e, idx) => {
        const cInfo = e.cesitler > 1 ? ` <span class="prod-kisi-birim">(${e.cesitler} ${t('inVarieties')})</span>` : '';
        var hesapMiktari = (e.birim === 'adet') ? Math.ceil(e.total) : e.total;
        const found = findBirimFiyat(e.ad, e.birim);
        const tutar = birimFiyatTutar(e.ad, e.birim, hesapMiktari);
        const fiyatGoster = found && tutar > 0 ? `<span class="fiyat-badge">${formatTRY(tutar)}</span>` : '';
        html += `<div class="prod-ing"><span class="prod-num">${idx + 1}.</span><span class="prod-name">${escapeHtml(e.ad)}${cInfo}</span><span class="prod-sep">—</span><span class="prod-qty">${fmt(e.total, e.birim)}${fiyatGoster}</span></div>`;
      });
      html += '</div></div>';
    }

    html += '</div></div>';
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
  renderMaliTablo(days);
}

function renderWeeklyTotal(dishEntries, days) {
  const section = document.getElementById('weeklyTotalSection');
  if (!section) return;

  const fmtTotal = (total, birim) => {
    if (total <= 0) return '—';
    if (birim === 'gr') return total >= 1000 ? (Math.round(total / 10) / 100) + ' kg' : Math.round(total) + ' gr';
    if (birim === 'ml') return total >= 1000 ? (Math.round(total / 10) / 100) + ' lt' : Math.round(total) + ' ml';
    if (birim === 'lt' || birim === 'litre') return (Math.round(total * 100) / 100) + ' lt';
    return Math.round(total) + ' ' + birim;
  };

  const normBirim = normBirimGlobal;

  // Aggregate across all dishes, per ingredient
  const agg = {};
  dishEntries.forEach(dish => {
    if (!dish.tarif) return;
    dish.tarif.forEach(ing => {
      const miktarKisi = ing.miktar_kisi || ing.miktar || 0;
      const birim = normBirim(ing.birim);
      const key = ing.malzeme.trim().toLowerCase() + '|' + birim;
      if (!agg[key]) agg[key] = { ad: ing.malzeme.trim(), birim, total: 0, miktarKisi: miktarKisi, birimLabel: birim === 'gr' ? ' gr' : birim === 'ml' ? ' ml' : birim === 'lt' || birim === 'litre' ? ' lt' : ' ' + birim };
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

  var kategoriler = {};
  var kategoriSiralama = {};
  MENU_KATEGORI_SIRASI.forEach(function(k, i) { kategoriSiralama[k] = i; });

  entries.forEach(function(e) {
    var kategori = menuGetKategori(e.ad);
    if (!kategoriler[kategori]) kategoriler[kategori] = [];
    kategoriler[kategori].push(e);
  });

  var siraliKategoriler = Object.keys(kategoriler).sort(function(a, b) {
    var sa = kategoriSiralama[a] !== undefined ? kategoriSiralama[a] : 99;
    var sb = kategoriSiralama[b] !== undefined ? kategoriSiralama[b] : 99;
    return sa - sb;
  });

  var globalIdx = 0;
  var haftalikGenelToplam = 0;
  siraliKategoriler.forEach(function(kategori) {
    var items = kategoriler[kategori];
    items.forEach(function(e) {
      if (e.total <= 0) return;
      var birimAd = normBirim(e.birim);
      var hesapMiktari = (birimAd === 'adet') ? Math.ceil(e.total) : e.total;
      var tut = birimFiyatTutar(e.ad, birimAd, hesapMiktari);
      if (tut > 0) haftalikGenelToplam += Math.round(tut * 100) / 100;
    });
  });

  var html = `<div class="weekly-total-card">
    <div class="weekly-total-header">Haftalık Toplam İhtiyaç Listesi${haftalikGenelToplam > 0 ? `<span style="margin-left:auto;font-weight:700;font-size:0.9rem;color:var(--accent-cyan)">Toplam Maliyet: ${formatTRY(haftalikGenelToplam)}</span>` : ''}</div>
    <div class="weekly-total-body">`;

  siraliKategoriler.forEach(function(kategori) {
    var items = kategoriler[kategori];
    var renk = MENU_KATEGORI_RENKLERI[kategori] || MENU_KATEGORI_RENKLERI['Diğer'];
    var kategoriToplam = 0;
    items.forEach(function(e) {
      if (e.total <= 0) return;
      var birimAd = normBirim(e.birim);
      var hesapMiktariW = (birimAd === 'adet') ? Math.ceil(e.total) : e.total;
      var found = findBirimFiyat(e.ad, birimAd);
      if (found) kategoriToplam += Math.round(birimFiyatTutar(e.ad, birimAd, hesapMiktariW) * 100) / 100;
    });
    html += `<div class="wt-kategori">
      <div class="wt-kategori-header" style="background:${renk.bg};border-left:4px solid ${renk.border};color:${renk.renk}">
        <span>${renk.icon}</span> ${kategori} <span style="font-weight:400;font-size:0.75rem;opacity:0.7;margin-left:4px">(${items.length})</span>
        ${kategoriToplam > 0 ? `<span style="margin-left:auto;font-weight:700;font-size:0.85rem;color:${renk.renk}">${formatTRY(kategoriToplam)}</span>` : ''}
      </div>
      <div class="weekly-total-grid">`;
    items.forEach(function(e) {
      var total = e.total;
      if (total <= 0) return;
      globalIdx++;
      var birimAd = normBirim(e.birim);
      var hesapMiktariW = (birimAd === 'adet') ? Math.ceil(total) : total;
      var found = findBirimFiyat(e.ad, birimAd);
      var tutar = birimFiyatTutar(e.ad, birimAd, hesapMiktariW);
      var fiyatGoster = found && tutar > 0 ? `<span class="fiyat-badge">${formatTRY(tutar)}</span>` : '';
      html += `<div class="weekly-total-item"><span class="weekly-total-num">${globalIdx}.</span><span class="weekly-total-name">${escapeHtml(e.ad)} <span class="prod-kisi-birim">(${e.miktarKisi}${e.birimLabel})</span></span><span class="weekly-total-sep">—</span><span class="weekly-total-qty">${fmtTotal(total, e.birim)}${fiyatGoster}</span></div>`;
    });
    html += '</div></div>';
  });

  html += '</div></div>';
  section.innerHTML = html;
}

// ===== MALİ TABLO (HAFTALIK MALİYET ÖZETİ) =====
function renderMaliTablo(days) {
  var container = document.getElementById('menuMaliTablo');
  if (!container) return;

  var yemekler = loadYemekler();
  var normBirim = normBirimGlobal;
  var parseDishName = function(val) { return val.trim().split('\n')[0].replace(/ - \(.*/, '').trim(); };
  var findDish = function(name) {
    var lower = name.toLowerCase();
    var exact = yemekler.find(function(y) { return y.ad.toLowerCase() === lower; });
    if (exact) return exact;
    return yemekler.find(function(y) {
      var yLower = y.ad.toLowerCase();
      return yLower.startsWith(lower) || lower.startsWith(yLower);
    });
  };

  var gunVerileri = [];
  var katAgg = {};
  var eksikSet = {};
  var genelToplam = 0;
  var toplamKisiGun = 0;
  var menuVar = false;

  days.forEach(function(d) {
    var kisi = d.data.kisi || 0;
    var dayAgg = {};
    var gunMenuVar = false;
    for (var ci = 0; ci < 5; ci++) {
      var raw = d.data.yemekler[ci] || '';
      var name = parseDishName(raw);
      if (!name) continue;
      var dish = findDish(name);
      if (!dish || !dish.tarif || !dish.tarif.length) continue;
      gunMenuVar = true;
      dish.tarif.forEach(function(ing) {
        var miktarKisi = ing.miktar_kisi || ing.miktar || 0;
        var birim = normBirim(ing.birim);
        var key = ing.malzeme.trim().toLowerCase() + '|' + birim;
        if (!dayAgg[key]) dayAgg[key] = { ad: ing.malzeme.trim(), birim: birim, total: 0 };
        dayAgg[key].total += miktarKisi * kisi;
      });
    }
    if (gunMenuVar) menuVar = true;

    var tarihStr = '';
    if (d.tarih) tarihStr = formatDateStrTR(d.tarih);
    else if (d.key) { var p = d.key.split('-'); if (p.length === 3) tarihStr = p[2] + '.' + p[1] + '.' + p[0]; }

    var gunToplam = 0;
    Object.keys(dayAgg).forEach(function(k) {
      var e = dayAgg[k];
      if (e.total <= 0) return;
      var hesap = (e.birim === 'adet') ? Math.ceil(e.total) : e.total;
      var tut = birimFiyatTutar(e.ad, e.birim, hesap);
      if (tut === null || tut === undefined || isNaN(tut)) { eksikSet[e.ad.trim().toLowerCase()] = true; tut = 0; }
      gunToplam += Math.round(tut * 100) / 100;
      var kat = menuGetKategori(e.ad);
      katAgg[kat] = Math.round(((katAgg[kat] || 0) + tut) * 100) / 100;
    });
    gunToplam = Math.round(gunToplam * 100) / 100;
    genelToplam = Math.round((genelToplam + gunToplam) * 100) / 100;
    toplamKisiGun += kisi;
    gunVerileri.push({ gun: d.gun, tarih: tarihStr, kisi: kisi, toplam: gunToplam, aktif: gunMenuVar });
  });

  if (!menuVar) { container.style.display = 'none'; container.innerHTML = ''; return; }
  container.style.display = 'block';

  var kisGun = toplamKisiGun > 0 ? genelToplam / toplamKisiGun : 0;
  var eksikSayi = Object.keys(eksikSet).length;

  var html = '<div class="mali-card">';
  html += '<div class="mali-header"><span class="mali-header-icon">₺</span><span>Mali Tablo</span><span class="mali-header-sub">Haftalık Malzeme Maliyeti Özeti</span>' +
    (eksikSayi > 0 ? '<span class="mali-uyari" title="Birim Fiyatlar sekmesinden tanımlayabilirsiniz">' + eksikSayi + ' malzemenin birim fiyatı tanımlı değil</span>' : '') +
    '</div>';
  html += '<div class="mali-body">';

  // Özet kartları
  html += '<div class="mali-chips">' +
    '<div class="mali-chip mali-chip-vurgu"><div class="mali-chip-label">' + t('weeklyGrandTotal') + '</div><div class="mali-chip-value">' + formatTRY(genelToplam) + '</div></div>' +
    '<div class="mali-chip"><div class="mali-chip-label">' + t('dailyAverage') + '</div><div class="mali-chip-value">' + formatTRY(Math.round(genelToplam / 5 * 100) / 100) + '</div></div>' +
    '<div class="mali-chip"><div class="mali-chip-label">' + t('avgPerPerson') + '</div><div class="mali-chip-value">' + formatTRY(Math.round(kisGun * 100) / 100) + '</div></div>' +
    '<div class="mali-chip"><div class="mali-chip-label">' + t('totalPersonDays') + '</div><div class="mali-chip-value">' + toplamKisiGun + '</div></div>' +
    '</div>';

  // Günlük maliyet tablosu
  html += '<div class="table-wrapper"><table class="data-table mali-table"><thead><tr>' +
    '<th>' + t('colDay') + '</th><th>' + t('colDate') + '</th><th style="text-align:center">' + t('colPerson') + '</th><th style="text-align:right">' + t('dailyMaterialCost') + '</th><th style="text-align:right">' + t('perPerson') + '</th>' +
    '</tr></thead><tbody>';
  gunVerileri.forEach(function(g) {
    var basi = g.kisi > 0 ? formatTRY(Math.round(g.toplam / g.kisi * 100) / 100) : '—';
    html += '<tr' + (g.aktif ? '' : ' class="mali-pasif"') + '>' +
      '<td><strong>' + escapeHtml(g.gun) + '</strong></td>' +
      '<td>' + tarihFormatla2(g.tarih) + '</td>' +
      '<td style="text-align:center">' + (g.kisi || '—') + '</td>' +
      '<td class="mali-tutar">' + formatTRY(g.toplam) + '</td>' +
      '<td class="mali-tutar-alt">' + basi + '</td></tr>';
  });
  var ortBasi = toplamKisiGun > 0 ? formatTRY(Math.round(kisGun * 100) / 100) : '—';
  html += '</tbody><tfoot><tr class="mali-toplam-row">' +
    '<td colspan="2"><strong>HAFTALIK TOPLAM</strong></td>' +
    '<td style="text-align:center"><strong>' + toplamKisiGun + '</strong></td>' +
    '<td class="mali-tutar"><strong>' + formatTRY(genelToplam) + '</strong></td>' +
    '<td class="mali-tutar-alt"><strong>' + ortBasi + '</strong></td></tr></tfoot></table></div>';

  // Kategori dağılımı
  var katSirali = MENU_KATEGORI_SIRASI.filter(function(k) { return katAgg[k] && katAgg[k] > 0; });
  if (katSirali.length) {
    html += '<div class="mali-kat-baslik">Kategori Dağılımı</div>';
    html += '<div class="mali-kat-liste">';
    katSirali.forEach(function(kat) {
      var renk = MENU_KATEGORI_RENKLERI[kat] || MENU_KATEGORI_RENKLERI['Diğer'];
      var tutar = katAgg[kat];
      var pctRaw = genelToplam > 0 ? Math.round(tutar / genelToplam * 100) : 0;
      var yuzde = Math.max(2, Math.min(100, pctRaw));
      html += '<div class="mali-kat-row">' +
        '<span class="mali-kat-icon" style="background:' + renk.bg + ';color:' + renk.renk + '">' + renk.icon + '</span>' +
        '<span class="mali-kat-ad" style="color:' + renk.renk + '">' + escapeHtml(kat) + '</span>' +
        '<div class="mali-kat-bar-wrap"><div class="mali-kat-bar" style="width:' + yuzde + '%;background:linear-gradient(90deg,' + renk.renk + '99,' + renk.renk + ')"></div></div>' +
        '<span class="mali-kat-tutar">' + formatTRY(tutar) + '</span>' +
        '<span class="mali-kat-yuzde">%' + pctRaw + '</span>' +
        '</div>';
    });
    html += '</div>';
  }

  html += '</div></div>';
  container.innerHTML = html;
}

function tarihFormatla2(str) {
  if (!str) return '—';
  var p = str.split('.');
  if (p.length !== 3) return escapeHtml(str);
  var aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var ay = aylar[(parseInt(p[1], 10) || 1) - 1] || p[1];
  return parseInt(p[0], 10) + ' ' + ay;
}

function importYemekCSV(event) { if (!requireAdmin()) return;
  const file = event.target.files[0];
  if (!file) return;
  const inputEl = event.target;
  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      var text = ev.target.result;
      var hasMojibake = /[Ãâ€€ŸŒŽšž]/.test(text) || /\?EHR|ORUM/.test(text);
      if (hasMojibake && !text.includes('Ş')) {
        var reader2 = new FileReader();
        reader2.onload = function(ev2) {
          try { processYemekCSV(ev2.target.result.replace(/^\uFEFF/, '')); }
          catch(e2) { showToast('CSV işleme hatası: ' + e2.message, 'error'); }
        };
        reader2.readAsText(file, 'ISO-8859-9');
        return;
      }
      processYemekCSV(text.replace(/^\uFEFF/, ''));
    } catch(e) { showToast('CSV okuma hatası: ' + e.message, 'error'); }
    inputEl.value = '';
  };
  reader.readAsText(file);
  event.target.value = '';
}

function processYemekCSV(text) {
  try {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) throw new Error('CSV boş');
    const headers = parseCSVLine(lines[0]);
    const adIdx = headers.findIndex(h => /yemek.*ad|adı|^ad$/i.test(h));
    const kaloriIdx = headers.findIndex(h => /kalori|kcal/i.test(h));
    const alerjenIdx = headers.findIndex(h => /alerjen/i.test(h));
    const urunCols = [];
    const miktarCols = [];
    const birimCols = [];
    headers.forEach((h, i) => {
      const m = h.match(/^\s*[üu]r[üu]n\s*(\d+)\s*$/i);
      if (m) urunCols.push({ idx: i, num: parseInt(m[1]) });
      if (/^\s*miktar\s*\d+\s*$/i.test(h)) miktarCols.push({ idx: i, num: parseInt(h.match(/\d+/)[0]) });
      if (/^\s*birim\s*\d+\s*$/i.test(h)) birimCols.push({ idx: i, num: parseInt(h.match(/\d+/)[0]) });
    });
    const list = loadYemekler();
    const basla = adIdx === -1 ? 0 : 1;
    for (let r = basla; r < lines.length; r++) {
      const cols = parseCSVLine(lines[r]);
      let ad = '';
      if (adIdx !== -1 && adIdx < cols.length) {
        ad = (cols[adIdx] || '').trim();
      } else if (basla === 0) {
        ad = (cols[0] || '').trim();
      }
      if (!ad) continue;
      const tarif = [];
      urunCols.forEach((uc) => {
        const malzeme = (cols[uc.idx] || '').trim();
        if (!malzeme) return;
        const mc = miktarCols.find(m => m.num === uc.num);
        const bc = birimCols.find(b => b.num === uc.num);
        let miktarStr = (mc && mc.idx < cols.length) ? (cols[mc.idx] || '').trim() : '';
        miktarStr = miktarStr.replace(',', '.');
        const miktar_kisi = parseFloat(miktarStr) || 0;
        const birim = (bc && bc.idx < cols.length) ? (cols[bc.idx] || '').trim() : 'gr';
        tarif.push({ malzeme, miktar_kisi, birim });
      });
      const mevcut = list.findIndex(y => y.ad.toLowerCase() === ad.toLowerCase());
      const yemek = {
        id: mevcut !== -1 ? list[mevcut].id : 'y_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        ad: ad,
        kalori: (kaloriIdx !== -1 && kaloriIdx < cols.length) ? (cols[kaloriIdx] || '').trim() : (mevcut !== -1 ? list[mevcut].kalori || '' : ''),
        alerjen: (alerjenIdx !== -1 && alerjenIdx < cols.length) ? (cols[alerjenIdx] || '').trim() : (mevcut !== -1 ? list[mevcut].alerjen || '' : ''),
        tarif: tarif.length ? tarif : (mevcut !== -1 ? list[mevcut].tarif || [] : [])
      };
      if (mevcut !== -1) {
        list[mevcut] = yemek;
      } else {
        list.push(yemek);
      }
    }
    saveYemekler(list);
    renderYemekListesi();
    showToast(list.length + ' yemek yüklendi.', 'success');
  } catch (err) {
    showToast('CSV yükleme hatası: ' + err.message, 'error');
  }
}

function exportYemekCSV() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const list = loadYemekler();
  if (!list || !list.length) { showToast('Dışa aktarılacak yemek yok.', 'error'); return; }
  const maxUrun = list.reduce((m, y) => Math.max(m, (y.tarif || []).length), 0);
  const headers = ['Yemek Adı', 'Kalori', 'Alerjen'];
  for (let i = 1; i <= maxUrun; i++) {
    headers.push('Ürün ' + i, 'Miktar ' + i, 'Birim ' + i);
  }
  function cell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const rows = list.map(function(y) {
    const row = [cell(y.ad), cell(y.kalori), cell(y.alerjen)];
    for (let i = 0; i < maxUrun; i++) {
      const t = (y.tarif && y.tarif[i]) || {};
      row.push(cell(t.malzeme), cell(t.miktar_kisi), cell(t.birim));
    }
    return row.join(',');
  });
  const csv = '\uFEFF' + headers.map(cell).join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'yemek_listesi_' + new Date().toISOString().split('T')[0] + '.csv';
  link.click();
  URL.revokeObjectURL(url);
  showToast('Yemek listesi CSV olarak indirildi.', 'success');
}

// ─── YEMEK LISTESI (DISH POOL) ─────────────────────────────────────────────────
function loadYemekler() {
  return yemeklerCache;
}

function saveYemekler(list) { if (!requireAdmin()) return;
  yemeklerCache = list;
  syncDishesToSupabase().catch(() => {});
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
    <thead><tr><th style="width:30%">Yemek Adı</th><th style="width:12%">Kalori</th><th style="width:20%">Alerjen</th><th style="width:50px">Reçete</th><th style="width:70px">İşlem</th></tr></thead>
    <tbody>${filtered.map(y => `<tr>
      <td style="max-width:0;overflow:hidden;text-overflow:ellipsis"><strong>${escapeHtml(y.ad)}</strong></td>
      <td style="font-size:0.8rem;white-space:nowrap">${escapeHtml(y.kalori || '')}</td>
      <td style="font-size:0.8rem;color:var(--text-muted);max-width:0;overflow:hidden;text-overflow:ellipsis">${escapeHtml(y.alerjen || '')}</td>
      <td style="text-align:center;white-space:nowrap">${(y.tarif && y.tarif.length) ? `<span title="${y.tarif.length} malzeme" style="cursor:help;font-size:0.75rem;color:var(--accent-cyan)">${y.tarif.length} ürün</span>` : `<span style="font-size:0.7rem;color:var(--text-muted)">—</span>`}</td>
      <td style="white-space:nowrap;text-align:center">
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
        <input type="text" id="yf_ad" value="${escapeHtml(ad)}" placeholder="Örn: ŞEHRIYE ÇORBASI" style="width:100%" />
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
        <strong style="font-size:0.82rem">${t('ingredients')}</strong>
        <span style="font-size:0.7rem;color:var(--text-muted)">${t('perPersonGram')}</span>
      </div>
      <table style="width:100%;font-size:0.8rem">
        <thead><tr><th style="text-align:left">${t('colIngredient')}</th><th style="width:80px;text-align:center">${t('colPerPerson')}</th><th style="width:60px">${t('colUnit')}</th><th style="width:30px"></th></tr></thead>
        <tbody id="yfTarif_tbody">${tarifRows}</tbody>
      </table>
      <button class="btn btn-ghost btn-sm" onclick="yfTarifEkle()" style="margin-top:0.4rem">${t('addIngredient')}</button>
    </div>
  </div>`;

  container.querySelectorAll('.yf-malzeme').forEach(function(input) {
    setupMalzemeAutocomplete(input);
  });
}

function setupMalzemeAutocomplete(input) {
  function closeList() {
    var list = input.parentNode.querySelector('.mz-autocomplete');
    if (list) list.remove();
  }
  function renderList(filter) {
    closeList();
    if (!filter) return;
    var q = normIsim(filter);
    var seen = {};
    var options = [];
    unitPricesCache.forEach(function(p) {
      var ad = (p.urun_adi || '').trim();
      if (!ad || seen[ad]) return;
      seen[ad] = true;
      if (normIsim(ad).indexOf(q) !== -1) options.push(ad);
    });
    if (!options.length) return;

    var wrap = input.parentNode;
    wrap.style.position = 'relative';
    var list = document.createElement('div');
    list.className = 'mz-autocomplete';
    var html = '';
    options.slice(0, 12).forEach(function(ad) {
      html += '<div class="mz-ac-item" data-val="' + escapeHtml(ad) + '">' + escapeHtml(ad) + '</div>';
    });
    list.innerHTML = html;

    list.addEventListener('mousedown', function(e) {
      e.preventDefault();
      var item = e.target.closest('.mz-ac-item');
      if (!item) return;
      input.value = item.getAttribute('data-val');
      closeList();
    });

    wrap.appendChild(list);
  }

  input.addEventListener('input', function() { renderList(input.value); });
  input.addEventListener('focus', function() { renderList(input.value); });
  input.addEventListener('blur', function() { setTimeout(closeList, 120); });
  input.addEventListener('keydown', function(e) {
    if (e.key !== 'Tab') return;
    var list = input.parentNode.querySelector('.mz-autocomplete');
    if (list && list.children.length > 0) {
      e.preventDefault();
      input.value = list.children[0].getAttribute('data-val');
      closeList();
    }
  });
}

function syncTarifFromDom() {
  var malzemeInputs = document.querySelectorAll('.yf-malzeme');
  var miktarInputs = document.querySelectorAll('.yf-miktar');
  var birimSelects = document.querySelectorAll('.yf-birim');
  for (var i = 0; i < yfTarif.length; i++) {
    if (malzemeInputs[i]) yfTarif[i].malzeme = malzemeInputs[i].value;
    if (miktarInputs[i]) yfTarif[i].miktar_kisi = parseFloat(miktarInputs[i].value) || 0;
    if (birimSelects[i]) yfTarif[i].birim = birimSelects[i].value;
  }
}

function yfTarifEkle() {
  syncTarifFromDom();
  yfTarif.push({ malzeme: '', miktar_kisi: 0, birim: 'gr' });
  const ad = document.getElementById('yf_ad').value;
  const kalori = document.getElementById('yf_kalori').value;
  const alerjen = document.getElementById('yf_alerjen').value;
  renderYemekForm(ad, kalori, alerjen);
}

function yfTarifSil(idx) {
  syncTarifFromDom();
  yfTarif.splice(idx, 1);
  const ad = document.getElementById('yf_ad').value;
  const kalori = document.getElementById('yf_kalori').value;
  const alerjen = document.getElementById('yf_alerjen').value;
  renderYemekForm(ad, kalori, alerjen);
}

function saveYemekForm() { if (!canEditMenuRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
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

function deleteYemek(id) { if (!canEditMenuRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  if (!confirm('Bu yemeği silmek istediğinize emin misiniz?')) return;
  let list = loadYemekler();
  list = list.filter(y => y.id !== id);
  saveYemekler(list);
  renderYemekListesi();
  showToast('Yemek silindi.', 'success');
}

function openYemekModal() {
  document.getElementById('yemekModal').classList.add('open');
  document.getElementById('yemekSearchInput').value = '';
  editingYemekId = null;
  document.getElementById('yemekFormContainer').style.display = 'none';
  renderYemekListesi();
  // Background'da Supabase'ten taze veri çek (cache güncelle)
  syncDishesFromSupabase().then(updated => { if (updated) renderYemekListesi(); });
  if (supabaseClient) syncUnitPricesFromSupabase().catch(function(){});
}
function closeYemekModal() {
  document.getElementById('yemekModal').classList.remove('open');
}

function exportYemekListesiPDF() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const list = loadYemekler();
  if (!list || !list.length) {
    showToast('Dışa aktarılacak yemek yok.', 'error');
    return;
  }
  const printWin = window.open('', '_blank', 'width=1000,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }

  const rowsHtml = list.map(function(y) {
    const tarifHtml = (y.tarif && y.tarif.length)
      ? '<table class="tarif">' + y.tarif.map(function(t) {
          const miktar = Number(t.miktar_kisi) || 0;
          return '<tr><td class="mz">' + escapeHtml(t.malzeme || '') + '</td><td class="mk">' + (miktar ? miktar.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : '') + ' ' + escapeHtml(t.birim || 'gr') + '</td></tr>';
        }).join('') + '</table>'
      : '<div class="tarif-yok">—</div>';
    return '<tr>' +
      '<td class="yemek-ad"><strong>' + escapeHtml(y.ad) + '</strong>' + (y.kalori ? '<div class="kalori">' + escapeHtml(y.kalori) + '</div>' : '') + '</td>' +
      '<td class="alerjen">' + (y.alerjen ? escapeHtml(y.alerjen) : '') + '</td>' +
      '<td>' + tarifHtml + '</td>' +
    '</tr>';
  }).join('');

  printWin.document.write('<!DOCTYPE html><html><head>' +
    '<meta charset="UTF-8"><title>Yemek Listesi</title>' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:20px;margin:0}' +
    'h1{font-size:1.3rem;margin-bottom:0.2rem}' +
    '.date{font-size:0.8rem;color:#666;margin-bottom:0.3rem}' +
    '.info{font-size:0.75rem;color:#888;margin-bottom:1rem}' +
    'table{width:100%;border-collapse:collapse}' +
    'th{background:#f1f5f9;font-weight:700;padding:6px 8px;text-align:left;border:1px solid #ddd;font-size:0.8rem}' +
    'td{padding:6px 8px;border:1px solid #ddd;vertical-align:top;font-size:0.78rem}' +
    '.yemek-ad{width:30%}' +
    '.kalori{font-size:0.68rem;color:#64748b;margin-top:2px;font-weight:400}' +
    '.alerjen{width:18%;color:#b91c1c}' +
    'table.tarif{width:100%;border:none}' +
    'table.tarif td{border:none;border-bottom:1px solid #eee;padding:2px 4px}' +
    'table.tarif .mz{width:70%}' +
    'table.tarif .mk{width:30%;text-align:right;white-space:nowrap}' +
    '.tarif-yok{color:#999}' +
    'tr{page-break-inside:avoid}' +
    '.footer{text-align:center;font-size:0.75rem;color:#999;margin-top:2rem;border-top:1px solid #ddd;padding-top:0.5rem}' +
    '</style></head><body>' +
    '<h1>Yemek Listesi</h1>' +
    '<div class="date">' + new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) + '</div>' +
    '<div class="info">Toplam ' + list.length + ' yemek</div>' +
    '<table><thead><tr><th>' + t('foodName') + '</th><th>' + t('allergen') + '</th><th>' + t('recipePerPerson') + '</th></tr></thead>' +
    '<tbody>' + rowsHtml + '</tbody></table>' +
    '<div class="footer">Kırşehir Ahi Evran Üniversitesi &bull; Yemek Listesi &bull; ' + new Date().toLocaleDateString('tr-TR') + '</div>' +
    '</body></html>');
  printWin.document.close();
  printWin.focus();
  triggerPrint(printWin);
}

// -- Supabase dish sync --
async function syncDishesFromSupabase() {
  if (!supabaseClient) return false;
  try {
    var { data, error } = await supabaseClient.from('dishes').select('*');
    if (error) return false;
    if (data && data.length > 0) {
      yemeklerCache = data.map(function(d) {
        var tarif = [];
        if (d.tarif && Array.isArray(d.tarif)) tarif = d.tarif;
        return {
          id: String(d.id || Date.now().toString(36) + Math.random().toString(36).slice(2,6)),
          ad: String(d.ad || '').trim(),
          kalori: String(d.kalori || '').trim(),
          alerjen: String(d.alerjen || '').trim(),
          tarif: tarif
        };
      });
      if (document.getElementById('productionSection')) refreshMenuProduction();
      return true;
    }
    return false;
  } catch (_) { return false; }
}

async function syncDishesToSupabase() {
  if (!supabaseClient) return;
  try {
    var list = loadYemekler();
    await supabaseClient.from('dishes').upsert(list, { onConflict: 'id' });
  } catch (_) {}
}

// -- Menu Supabase sync --
async function fetchMenuData() {
  if (!supabaseClient) return {};
  try {
    var { data, error } = await supabaseClient.from('weekly_menu').select('*');
    if (error || !data) return {};
    var result = {};
    data.forEach(function(row) {
      if (row.data && typeof row.data === 'object') result[row.week_key] = row.data;
    });
    return result;
  } catch (_) { return {}; }
}

async function saveMenuData(allData) {
  if (!supabaseClient) return;
  try {
    var upserts = [];
    Object.keys(allData).forEach(function(weekKey) {
      upserts.push({ week_key: weekKey, data: allData[weekKey] });
    });
    if (upserts.length > 0) {
      var { error } = await supabaseClient.from('weekly_menu').upsert(upserts, { onConflict: 'week_key' });
      if (error) showToast('Menü kaydedilemedi: ' + error.message, 'error');
    }
  } catch (_) { showToast('Menü kaydedilemedi (bağlantı hatası).', 'error'); }
}

// -- Live production refresh --
function refreshMenuProduction() {
  if (!document.getElementById('mk_0')) return; // menü henüz render edilmemiş
  const monday = getWeekStartDate(menuWeekOffset);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const weekKey = formatDateStr(monday) + '-' + formatDateStr(friday);
  const days = getGUNLER().map((gun, i) => {
    const tarih = new Date(monday);
    tarih.setDate(monday.getDate() + i);
    const key = formatDateStr(tarih);
    const yemekler = [];
    const notlar = [];
    for (let c = 0; c < 5; c++) {
      const el = document.getElementById('m' + c + '_' + i);
      yemekler.push(el ? el.textContent : '');
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
    if (e.target.id && /^m\d_\d$/.test(e.target.id)) {
      activeDishTextarea = e.target;
      showDishDropdown(e.target);
      autoResizeTextarea(e.target);
    }
  });

  document.addEventListener('input', function(e) {
    if (e.target.id && /^m\d_\d$/.test(e.target.id)) {
      autoResizeTextarea(e.target);
    }
    if (e.target === activeDishTextarea) {
      showDishDropdown(e.target);
    }
    if (e.target.id && /^m\d_\d$/.test(e.target.id)) {
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
    `<div class="dish-suggestion-item" data-id="${escapeHtml(y.id)}">
       <div style="font-weight:600">${escapeHtml(y.ad)} ${y.kalori ? '<span style="font-size:0.7rem;opacity:0.6">(' + escapeHtml(y.kalori) + ')</span>' : ''}</div>
       ${y.alerjen ? '<div style="font-size:0.7rem;opacity:0.7;margin-top:2px;line-height:1.3">' + escapeHtml(y.alerjen) + '</div>' : ''}
     </div>`
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

function formatTRY(val) {
  if (typeof val !== 'number' || isNaN(val)) return '0,00 ₺';
  return val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
}

// ─── REPORT ────────────────────────────────────────────────────────────────────
function getReportData() {
  if (!reportYearFilter) return records;
  return records.filter(function(r) {
    return r.tarih && new Date(r.tarih + 'T12:00:00').getFullYear() === Number(reportYearFilter);
  });
}

function renderReportYearFilter() {
  const container = document.getElementById('reportYearFilter');
  if (!container) return;
  const years = getAvailableYears();
  let html = '<label style="font-size:0.8rem;color:var(--text-muted)">Yıl:</label>';
  html += '<select onchange="setReportYear(this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;background:var(--bg-card);color:var(--text)">';
  html += '<option value="0"' + (Number(reportYearFilter) === 0 ? ' selected' : '') + '>Tümü</option>';
  years.forEach(function(y) {
    const sel = Number(reportYearFilter) === Number(y) ? ' selected' : '';
    html += '<option value="' + y + '"' + sel + '>' + y + '</option>';
  });
  html += '</select>';
  container.innerHTML = html;
}

function setReportYear(v) {
  reportYearFilter = Number(v) || 0;
  renderReport();
}

function renderReport() {
  renderReportYearFilter();
  const data = getReportData();
  const n = data.length;

  if (n === 0) {
    ['rTotalKayit','rTotalYemek','rTotalFireKar','rTotalYemekSonrasi','rTotalTurnike',
     'rTotalGecis','rTotalPersonel','rAvgPorsiyon','rTotalPorsiyon','rCopPorsiyon','rMaxWeekGecis','rTotalAtik','rAvgAtik','rTotalOgrenci',
     'rMaxAtik','rMinAtik','rTrendAtik','rTrendGecis'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('reportTbody').innerHTML = '';
    const avgPorItem = document.getElementById('rAvgPorsiyonItem');
    if (avgPorItem) avgPorItem.style.display = '';
    renderWasteByFoodType(data);
    return;
  }

  const totalYemek = data.reduce((s,r) => s+(r.yemek||0), 0);
  const totalTurnike = data.reduce((s,r) => s+(r.turnike||0), 0);
  const totalPersonel = data.reduce((s,r) => s+(r.personel||0), 0);
  const totalGecis = data.reduce((s,r) => s+(r.toplam||0), 0);
  const porsiyonUretimKayitlari = data.filter(r => (r.yemek||0) > 0);
  const avgPorsiyon = porsiyonUretimKayitlari.length ? porsiyonUretimKayitlari.reduce((s,r) => s+(r.porsiyon||0), 0) / porsiyonUretimKayitlari.length : 0;
  const porsiyonFarklari = porsiyonUretimKayitlari.filter(r => (r.porsiyon||0) !== 400);
  const totalAtik = data.reduce((s,r) => s+(r.atik||0), 0);
  const totalOgrenci = data.reduce((s,r) => s+(r.ogrenci||0), 0);
  const atikValues = data.map(r => r.atik || 0);
  const maxAtik = Math.max(...atikValues);
  const minAtik = Math.min(...atikValues);
  const maxAtikRec = data.find(r => (r.atik||0) === maxAtik);
  const minAtikRec = data.find(r => (r.atik||0) === minAtik);
  const maxAtikDate = maxAtikRec ? displayDate(maxAtikRec.tarih) : '';
  const minAtikDate = minAtikRec ? displayDate(minAtikRec.tarih) : '';

  // Trend: son 7 gün vs önceki 7 gün
  const sortedByDate = [...data].sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
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
  data.forEach(r => {
    const d = new Date(r.tarih + 'T12:00:00');
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
  document.getElementById('rTotalPersonel').textContent = totalPersonel.toLocaleString('tr-TR');
  document.getElementById('rTotalGecis').textContent = totalGecis.toLocaleString('tr-TR');
  const totalPorsiyon = records.reduce((s,r) => s+(r.porsiyon||0), 0);
  const copPorsiyon = records.reduce((s,r) => s + ((r.porsiyon||0) > 0 ? (r.atik||0) * 1000 / (r.porsiyon||400) : 0), 0);
  const avgPorItem = document.getElementById('rAvgPorsiyonItem');
  const avgPorEl = document.getElementById('rAvgPorsiyon');
  if (avgPorItem) avgPorItem.style.display = '';
  if (avgPorEl) avgPorEl.innerHTML = '400 gr' + (porsiyonFarklari.length > 0 ? `<span style="display:block;font-size:0.7rem;color:#ef4444;font-weight:600">${porsiyonFarklari.length} kayıt 400 değil</span>` : '');
  document.getElementById('rTotalPorsiyon').textContent = totalPorsiyon.toLocaleString('tr-TR') + ' gr';
  document.getElementById('rCopPorsiyon').textContent = copPorsiyon.toFixed(0).toLocaleString('tr-TR') + ' porsiyon';
  document.getElementById('rMaxWeekGecis').innerHTML = maxWeekLabel !== '—' ? `${maxWeekLabel} <br><span style="font-size:0.9rem;opacity:0.8;font-weight:normal">(${maxWeekVal.toLocaleString('tr-TR')} Kişi)</span>` : '—';
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
  reportTbody.innerHTML = data.map(r => buildReportRow(r)).join('');

  renderWasteByFoodType(data);
}

function renderWasteByFoodType(list) {
  const section = document.getElementById('wasteByFoodType');
  const body = document.getElementById('wasteByFoodTypeBody');
  if (!section || !body) return;
  const source = Array.isArray(list) ? list : records;
  const filtered = source.filter(r => r.yemek_adi && r.yemek_adi.trim());
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
  let html = '<table class="data-table" style="min-width:500px"><thead><tr><th>' + t('thFoodType') + '</th><th>' + t('wasteByFoodRecords') + '</th><th>' + t('kpiTotalWaste') + '</th><th>' + t('wasteByFoodRate') + '</th><th>' + t('wasteByFoodPerPerson') + '</th></tr></thead><tbody>';
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
  if (years.length > 0 && years.indexOf(Number(chartYearFilter)) === -1) {
    chartYearFilter = String(years[years.length - 1]);
  }
  var html = '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
  html += '<label style="font-size:0.8rem;color:var(--text-muted)">Yıl:</label>';
  html += '<select onchange="setChartYear(this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;background:var(--bg-card);color:var(--text)">';
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

// ─── YILLIK KARŞILAŞTIRMA TAB ───────────────────────────────────────────────
function getEffectiveYillikYears() {
  const years = getAvailableYears();
  const latest = years.length > 0 ? Number(years[years.length - 1]) : new Date().getFullYear();
  const sel = Number(yillikYearFilter) > 0 ? Number(yillikYearFilter) : latest;
  let prev = Number(yillikPrevYearFilter) > 0 ? Number(yillikPrevYearFilter) : 0;
  if (prev === sel) prev = 0;
  return { sel: sel, prev: prev > 0 ? prev : null };
}

function renderYillikYearFilter() {
  const container = document.getElementById('yillikYearFilter');
  if (!container) return;
  const years = getAvailableYears();
  const eff = getEffectiveYillikYears();
  function yearOptions(rawVal, disableVal) {
    let h = '<option value=""' + (rawVal === '' ? ' selected' : '') + '>Seçiniz</option>';
    years.forEach(function(y) {
      const s = rawVal !== '' && Number(rawVal) === Number(y) ? ' selected' : '';
      const dis = disableVal !== undefined && disableVal !== null && Number(y) === Number(disableVal) ? ' disabled' : '';
      h += '<option value="' + y + '"' + s + dis + '>' + y + '</option>';
    });
    return h;
  }
  const selectStyle = 'padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;background:var(--bg-card);color:var(--text)';
  var html = '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
  html += '<label style="font-size:0.8rem;color:var(--text-muted)">1. Yıl:</label>';
  html += '<select onchange="setYillikYear(this.value)" style="' + selectStyle + '">' + yearOptions(yillikYearFilter, null) + '</select>';
  html += '<span style="font-size:0.85rem;font-weight:700;color:var(--text-muted)">vs</span>';
  html += '<label style="font-size:0.8rem;color:var(--text-muted)">2. Yıl:</label>';
  var prevOpts = '<option value=""' + (yillikPrevYearFilter === '' ? ' selected' : '') + '>Karşılaştırma Yok</option>';
  years.forEach(function(y) {
    const s = yillikPrevYearFilter !== '' && Number(yillikPrevYearFilter) === Number(y) ? ' selected' : '';
    const dis = Number(y) === eff.sel ? ' disabled' : '';
    prevOpts += '<option value="' + y + '"' + s + dis + '>' + y + '</option>';
  });
  html += '<select onchange="setYillikPrevYear(this.value)" style="' + selectStyle + '">' + prevOpts + '</select>';
  html += '</div>';
  container.innerHTML = html;
}

function setYillikYear(year) {
  if (year === '') return;
  yillikYearFilter = String(year);
  yillikPrevYearFilter = '';
  renderYillikYearFilter();
  renderYearlyCharts();
}

function setYillikPrevYear(year) {
  yillikPrevYearFilter = String(year);
  renderYillikYearFilter();
  renderYearlyCharts();
}

function renderYearlyCharts() {
  renderYillikYearFilter();
  var eff = getEffectiveYillikYears();
  var sel = eff.sel;
  var prev = eff.prev;
  var hasPrev = prev !== null && prev > 0;
  var monthLabels = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];

  function buildYear(year) {
    var monthly = [];
    for (var m = 0; m < 12; m++) monthly.push({ uretim: 0, turnike: 0, ogrenci: 0, atik: 0, toplam: 0 });
    records.forEach(function(r) {
      if (!r.tarih) return;
      var d = new Date(r.tarih + 'T12:00:00');
      if (isNaN(d) || d.getFullYear() !== year) return;
      var m = d.getMonth();
      monthly[m].uretim += Number(r.yemek) || 0;
      monthly[m].turnike += Number(r.turnike) || 0;
      monthly[m].ogrenci += Number(r.ogrenci) || 0;
      monthly[m].toplam += Number(r.toplam) || 0;
      monthly[m].atik += Number(r.atik) || 0;
    });
    return monthly;
  }

  var thisData = buildYear(sel);
  var prevData = hasPrev ? buildYear(prev) : [];

  function fieldTotal(monthly, field) { return monthly.reduce(function(s, v) { return s + (v[field] || 0); }, 0); }
  var curTot = { uretim: fieldTotal(thisData, 'uretim'), turnike: fieldTotal(thisData, 'turnike'), ogrenci: fieldTotal(thisData, 'ogrenci'), atik: fieldTotal(thisData, 'atik'), toplam: fieldTotal(thisData, 'toplam') };
  var pastTot = hasPrev ? { uretim: fieldTotal(prevData, 'uretim'), turnike: fieldTotal(prevData, 'turnike'), ogrenci: fieldTotal(prevData, 'ogrenci'), atik: fieldTotal(prevData, 'atik'), toplam: fieldTotal(prevData, 'toplam') } : { uretim: 0, turnike: 0, ogrenci: 0, atik: 0, toplam: 0 };

  // Eski yıllık grafikleri temizle
  chartInstances.forEach(function(c, id) {
    if (String(id).indexOf('canvasYillik') === 0 || String(id).indexOf('canvasDonut') === 0) { c.destroy(); chartInstances.delete(id); }
  });

  function makeYillikTotalDonut(canvasId, emptyId, color, thisTotal, prevTotal, unitLabel) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var staleInstance = chartInstances.get(canvasId);
    if (staleInstance) { try { staleInstance.destroy(); } catch (_) {} chartInstances.delete(canvasId); }
    var empty = document.getElementById(emptyId);
    if (thisTotal <= 0 && prevTotal <= 0) {
      if (empty) empty.style.display = 'block';
      canvas.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    canvas.style.display = 'block';
    var ctx = canvas.getContext('2d');
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var textColor = isDark ? '#e2e8f0' : '#1e293b';
    var fmt = function(v) { return Math.round(v).toLocaleString('tr-TR'); };
    var grand = thisTotal + prevTotal;
    var curTxt = fmt(thisTotal) + unitLabel;
    var prevTxt = fmt(prevTotal) + unitLabel;
    var center = null;
    var cUp = isDark ? '#4ade80' : '#16a34a';
    var cDn = isDark ? '#f87171' : '#dc2626';
    if (!hasPrev) {
      center = { arrow: '', arrowColor: textColor, text: curTxt, color: textColor, fontSize: 13 };
    } else if (prevTotal > 0) {
      var ch = (thisTotal - prevTotal) / prevTotal * 100;
      var up = ch >= 0;
      var abs = Math.abs(ch);
      if (abs < 0.5) {
        center = { arrow: '', arrowColor: textColor, text: '%0', color: textColor, fontSize: 14 };
      } else {
        var txt = (abs >= 10 ? Math.round(abs) : (Math.round(abs * 10) / 10)).toString().replace('.', ',') + '%';
        center = { arrow: up ? '▲' : '▼', arrowColor: up ? cUp : cDn, text: txt, color: up ? cUp : cDn, fontSize: 14 };
      }
    } else if (thisTotal > 0) {
      center = { arrow: '●', arrowColor: cUp, text: 'Yeni', color: cUp, fontSize: 14 };
    }
    var legendEl = document.getElementById('donutLegend' + canvasId.replace('canvasDonut', ''));
    if (legendEl) {
      if (!hasPrev) {
        legendEl.innerHTML =
          '<div class="donut-legend-item"><span class="dot" style="background:' + color + '"></span>' + sel + '<span class="val" style="color:' + color + '">' + curTxt + '</span></div>';
      } else {
        legendEl.innerHTML =
          '<div class="donut-legend-item"><span class="dot" style="background:' + color + '"></span>' + sel + '<span class="val" style="color:' + color + '">' + curTxt + '</span></div>' +
          '<div class="donut-legend-item"><span class="dot" style="background:' + color + '66"></span>' + prev + '<span class="val" style="color:' + color + '">' + prevTxt + '</span></div>';
      }
    }
    var chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: hasPrev ? [String(sel), String(prev)] : [String(sel)],
        datasets: [{
          data: hasPrev ? [thisTotal, prevTotal] : [thisTotal],
          backgroundColor: hasPrev ? [color, color + '55'] : [color],
          borderColor: isDark ? '#1e293b' : '#ffffff',
          borderWidth: 2,
          hoverOffset: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        devicePixelRatio: Math.max(window.devicePixelRatio || 1, 2),
        cutout: hasPrev ? '62%' : '50%',
        animation: { duration: 700, easing: 'easeOutCubic' },
        plugins: {
          legend: { display: false },
          donutLabels: { enabled: true, values: hasPrev ? [curTxt, prevTxt] : [curTxt], colors: ['#000000'], fontSize: 13, center: center },
          tooltip: {
            backgroundColor: '#000000', titleColor: '#ffffff', bodyColor: '#ffffff',
            borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1, padding: 8, cornerRadius: 8,
            callbacks: {
              label: function(c) {
                var p = grand > 0 ? (c.parsed / grand * 100).toFixed(1) : '0.0';
                return ' ' + c.label + ': ' + fmt(c.parsed) + unitLabel + ' · %' + p;
              }
            }
          }
        }
      },
      plugins: [donutLabelsPlugin]
    });
    chartInstances.set(canvasId, chart);
  }

  try { makeYillikTotalDonut('canvasDonutUretim', 'chartDonutUretimEmpty', '#6366f1', curTot.uretim, pastTot.uretim, ''); } catch (e) { console.warn('toplam uretim:', e); }
  try { makeYillikTotalDonut('canvasDonutTurnike', 'chartDonutTurnikeEmpty', '#10b981', curTot.toplam, pastTot.toplam, ''); } catch (e) { console.warn('toplam yararlanan:', e); }
  try { makeYillikTotalDonut('canvasDonutOgrenci', 'chartDonutOgrenciEmpty', '#0ea5e9', curTot.ogrenci, pastTot.ogrenci, ''); } catch (e) { console.warn('toplam ogrenci:', e); }
  try { makeYillikTotalDonut('canvasDonutAtik', 'chartDonutAtikEmpty', '#f97316', curTot.atik, pastTot.atik, ' kg'); } catch (e) { console.warn('toplam atik:', e); }

  function makeYillikChart(canvasId, emptyId, metricColor, getThis, getPrev) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var staleInstance = chartInstances.get(canvasId);
    if (staleInstance) { try { staleInstance.destroy(); } catch (_) {} chartInstances.delete(canvasId); }
    var empty = document.getElementById(emptyId);
    var hasThis = thisData.some(function(v) { return getThis(v) > 0; });
    var hasPrevData = prevData.length > 0 && prevData.some(function(v) { return getPrev(v) > 0; });
    if (!hasThis && !hasPrevData) {
      if (empty) empty.style.display = 'block';
      canvas.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    canvas.style.display = 'block';
    var parent = canvas.parentElement;
    var w = Math.min(parent.offsetWidth || 400, parent.clientWidth || 400);
    var h = Math.min(parent.offsetHeight || 280, parent.clientHeight || 280);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var colors = {
      text: isDark ? '#e2e8f0' : '#1e293b',
      grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    };
    var thisArr = monthLabels.map(function(_, m) { return getThis(thisData[m]); });
    var prevArr = monthLabels.map(function(_, m) { return hasPrevData ? getPrev(prevData[m]) : 0; });
    var allMax = Math.max.apply(null, thisArr.concat(prevArr));
    var suggestedMax = allMax > 0 ? allMax * 1.18 : 10;
    var datasets = [
      {
        label: String(sel),
        data: thisArr,
        backgroundColor: metricColor,
        borderColor: metricColor,
        borderWidth: 0,
        borderRadius: 6,
        barPercentage: 0.8,
        categoryPercentage: hasPrevData ? 0.65 : 0.5,
        maxBarThickness: 60,
      }
    ];
    if (hasPrevData) {
      datasets.push({
        label: String(prev),
        data: prevArr,
        backgroundColor: metricColor + '35',
        borderColor: metricColor,
        borderWidth: 1,
        borderDash: [4, 4],
        borderRadius: 6,
        barPercentage: 0.8,
        categoryPercentage: 0.65,
        maxBarThickness: 60,
      });
    }
    var chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: monthLabels,
        datasets: datasets
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
            backgroundColor: '#000000',
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            borderColor: 'rgba(255,255,255,0.2)',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            bodyFont: { size: 11, family: 'Inter' },
            titleFont: { size: 11, family: 'Inter', weight: 'bold' },
            callbacks: {
              label: function(c) { return ' ' + c.dataset.label + ': ' + (c.parsed.y >= 100 ? Math.round(c.parsed.y) : c.parsed.y >= 10 ? c.parsed.y.toFixed(1) : c.parsed.y.toFixed(2)); }
            }
          },
          valueLabels: true,
        },
        scales: {
          x: {
            ticks: { color: colors.text, font: { size: 12, family: 'Inter' } },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            ticks: { color: colors.text, font: { size: 12, family: 'Inter' } },
            grid: { color: colors.grid }
          }
        },
        onClick: function(e, elements) {
          if (elements.length > 0) {
            var m = elements[0].index;
            var recs = records.filter(function(r) {
              if (!r.tarih) return false;
              var d = new Date(r.tarih + 'T12:00:00');
              return !isNaN(d) && d.getFullYear() === sel && d.getMonth() === m;
            });
            if (recs.length > 0) showChartDetailModal(monthLabels[m] + ' ' + sel, recs);
          }
        }
      },
      plugins: [chartValueLabelPlugin]
    });
    chartInstances.set(canvasId, chart);
  }

  try { makeYillikChart('canvasYillikUretim', 'chartYillikUretimEmpty', '#6366f1', function(v) { return v.uretim; }, function(v) { return v.uretim; }); } catch (e) { console.warn('yillik uretim:', e); }
  try { makeYillikChart('canvasYillikTurnike', 'chartYillikTurnikeEmpty', '#10b981', function(v) { return v.turnike; }, function(v) { return v.turnike; }); } catch (e) { console.warn('yillik turnike:', e); }
  try { makeYillikChart('canvasYillikOgrenci', 'chartYillikOgrenciEmpty', '#0ea5e9', function(v) { return v.ogrenci; }, function(v) { return v.ogrenci; }); } catch (e) { console.warn('yillik ogrenci:', e); }
  try { makeYillikChart('canvasYillikAtik', 'chartYillikAtikEmpty', '#f97316', function(v) { return v.atik; }, function(v) { return v.atik; }); } catch (e) { console.warn('yillik atik:', e); }
  renderYillikWasteTable(sel, hasPrev ? prev : null);
}

function renderYillikWasteTable(year1, year2) {
  var container = document.getElementById('yillikWasteTableContainer');
  if (!container) return;

  function getYearData(year) {
    var map = {};
    records.forEach(function(r) {
      if (!r.tarih) return;
      var d = new Date(r.tarih + 'T12:00:00');
      if (isNaN(d) || d.getFullYear() !== year) return;
      var key = r.yemek_adi || 'Belirsiz';
      if (!map[key]) map[key] = { uretim: 0, atik: 0, porsiyon: 0, adet: 0 };
      map[key].uretim += Number(r.yemek) || 0;
      map[key].atik += Number(r.atik) || 0;
      map[key].porsiyon += Number(r.porsiyon) || 0;
      map[key].adet++;
    });
    return map;
  }

  var data1 = getYearData(year1);
  var data2 = year2 ? getYearData(year2) : null;

  var allFoods = new Set(Object.keys(data1));
  if (data2) Object.keys(data2).forEach(function(f) { allFoods.add(f); });
  var foods = [...allFoods].sort();

  if (foods.length === 0) {
    container.innerHTML = '<div style="padding:1rem;color:var(--text-muted);text-align:center;font-size:0.85rem">' + (t('emptyDashboard') || 'Kayıt bulunamadı.') + '</div>';
    return;
  }

  var hasComparison = data2 !== null;
  var fmt = function(v) { return Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
  var fmtInt = function(v) { return Number(v).toLocaleString('tr-TR'); };

  var totals1 = { uretim: 0, atik: 0, porsiyon: 0 };
  var totals2 = { uretim: 0, atik: 0, porsiyon: 0 };

  var rows = foods.map(function(food) {
    var d1 = data1[food] || { uretim: 0, atik: 0, porsiyon: 0 };
    var d2 = data2 ? (data2[food] || { uretim: 0, atik: 0, porsiyon: 0 }) : null;
    totals1.uretim += d1.uretim;
    totals1.atik += d1.atik;
    totals1.porsiyon += d1.porsiyon;
    if (d2) {
      totals2.uretim += d2.uretim;
      totals2.atik += d2.atik;
      totals2.porsiyon += d2.porsiyon;
    }
    var atikGr1 = d1.porsiyon > 0 ? (d1.atik * 1000 / d1.porsiyon) : 0;
    var atikGr2 = d2 && d2.porsiyon > 0 ? (d2.atik * 1000 / d2.porsiyon) : 0;
    return { food: food, d1: d1, d2: d2, atikGr1: atikGr1, atikGr2: atikGr2 };
  });

  rows.sort(function(a, b) { return b.d1.atik - a.d1.atik; });

  var h = '<table class="data-table" style="width:100%;font-size:0.82rem;border-collapse:collapse">';
  h += '<thead><tr>';
  h += '<th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border);white-space:nowrap">' + (t('thFoodType') || 'Yemek Türü') + '</th>';
  h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">' + year1 + ' Üretim</th>';
  h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">' + year1 + ' Atık (kg)</th>';
  h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">' + year1 + ' Atık (gr/pors.)</th>';
  if (hasComparison) {
    h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">' + year2 + ' Üretim</th>';
    h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">' + year2 + ' Atık (kg)</th>';
    h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">' + year2 + ' Atık (gr/pors.)</th>';
    h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">Fark (kg)</th>';
  }
  h += '</tr></thead><tbody>';

  rows.forEach(function(row) {
    h += '<tr style="border-bottom:1px solid var(--border)">';
    h += '<td style="padding:7px 10px;font-weight:500">' + escapeHtml(row.food) + '</td>';
    h += '<td style="padding:7px 10px;text-align:right">' + fmtInt(row.d1.uretim) + '</td>';
    h += '<td style="padding:7px 10px;text-align:right;color:var(--accent-orange);font-weight:600">' + fmt(row.d1.atik) + '</td>';
    h += '<td style="padding:7px 10px;text-align:right">' + fmt(row.atikGr1) + '</td>';
    if (hasComparison) {
      h += '<td style="padding:7px 10px;text-align:right">' + fmtInt(row.d2.uretim) + '</td>';
      h += '<td style="padding:7px 10px;text-align:right;color:var(--accent-orange);font-weight:600">' + fmt(row.d2.atik) + '</td>';
      h += '<td style="padding:7px 10px;text-align:right">' + fmt(row.atikGr2) + '</td>';
      var fark = row.d1.atik - row.d2.atik;
      var farkCls = fark > 0 ? 'color:var(--accent-red)' : fark < 0 ? 'color:var(--accent-green)' : '';
      h += '<td style="padding:7px 10px;text-align:right;font-weight:600;' + farkCls + '">' + (fark > 0 ? '+' : '') + fmt(fark) + '</td>';
    }
    h += '</tr>';
  });

  var toplamAtikGr1 = totals1.porsiyon > 0 ? (totals1.atik * 1000 / totals1.porsiyon) : 0;
  h += '<tr style="border-top:2px solid var(--border);font-weight:700;background:var(--bg-card)">';
  h += '<td style="padding:8px 10px">TOPLAM</td>';
  h += '<td style="padding:8px 10px;text-align:right">' + fmtInt(totals1.uretim) + '</td>';
  h += '<td style="padding:8px 10px;text-align:right;color:var(--accent-orange)">' + fmt(totals1.atik) + '</td>';
  h += '<td style="padding:8px 10px;text-align:right">' + fmt(toplamAtikGr1) + '</td>';
  if (hasComparison) {
    var toplamAtikGr2 = totals2.porsiyon > 0 ? (totals2.atik * 1000 / totals2.porsiyon) : 0;
    var toplamFark = totals1.atik - totals2.atik;
    var tfCls = toplamFark > 0 ? 'color:var(--accent-red)' : toplamFark < 0 ? 'color:var(--accent-green)' : '';
    h += '<td style="padding:8px 10px;text-align:right">' + fmtInt(totals2.uretim) + '</td>';
    h += '<td style="padding:8px 10px;text-align:right;color:var(--accent-orange)">' + fmt(totals2.atik) + '</td>';
    h += '<td style="padding:8px 10px;text-align:right">' + fmt(toplamAtikGr2) + '</td>';
    h += '<td style="padding:8px 10px;text-align:right;font-weight:700;' + tfCls + '">' + (toplamFark > 0 ? '+' : '') + fmt(toplamFark) + '</td>';
  }
  h += '</tr>';
  h += '</tbody></table>';
  container.innerHTML = h;
}

const chartInstances = new Map();

const donutLabelsPlugin = {
  id: 'donutLabels',
  afterDatasetsDraw(chart) {
    var opts = chart.options.plugins && chart.options.plugins.donutLabels;
    if (!opts) return;
    var meta = chart.getDatasetMeta(0);
    if (!meta.data.length) return;
    var ctx = chart.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (opts.enabled) {
      meta.data.forEach(function(arc, i) {
      var value = opts.values && opts.values[i];
      if (value === undefined || value === null) return;
      var mid = (arc.startAngle + arc.endAngle) / 2;
      var radius = (arc.innerRadius + arc.outerRadius) / 2;
      var x = arc.x + Math.cos(mid) * radius;
      var y = arc.y + Math.sin(mid) * radius;
      var numLen = value.replace(/\s+\S+$/, '').length;
      var fs = numLen <= 6 ? (opts.fontSize || 10) : Math.max(8, (opts.fontSize || 10) - 2);
      ctx.font = 'bold ' + fs + 'px Inter, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(value, x, y);
      ctx.fillStyle = (opts.colors && opts.colors[i]) || '#334155';
      ctx.fillText(value, x, y);
    });
    }
    var ctr = opts.center;
    if (ctr && ctr.text) {
      var cArc = meta.data[0];
      if (cArc && cArc.x !== undefined) {
        ctx.font = '11px Inter, sans-serif';
        ctx.fillStyle = ctr.arrowColor || '#334155';
        ctx.fillText(ctr.arrow || '', cArc.x, cArc.y - 6);
        ctx.font = 'bold ' + (ctr.fontSize || 10) + 'px Inter, sans-serif';
        ctx.fillStyle = ctr.color || '#334155';
        ctx.fillText(ctr.text, cArc.x, cArc.y + 6);
      }
    }
    ctx.restore();
  }
};
const chartValueLabelPlugin = {
  id: 'valueLabels',
  afterDraw(chart) {
    if (!chart.options.plugins.valueLabels) return;
    const pos = chart.options.plugins.valueLabelsPosition || 'above';
    const ctx = chart.ctx;
    const top = chart.chartArea ? chart.chartArea.top : 0;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const insideColor = isDark ? '#ffffff' : '#000000';
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      meta.data.forEach((bar, idx) => {
        const val = ds.data[idx];
        if (val === undefined || val === null || isNaN(val)) return;
        const isTL = ds.label && ds.label.includes('₺');
        if (isTL && val === 0) return;
        const display = isTL
          ? val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'
          : val === 0 ? '0' : val >= 100 ? Math.round(val).toString() : val >= 10 ? val.toFixed(1) : val.toFixed(2);
        let inside = pos === 'inside';
        let labelX = bar.x;
        let labelY;
        if (!inside && bar.y - 7 < top) inside = true;
        if (inside) {
          ctx.fillStyle = insideColor;
          ctx.textBaseline = 'middle';
          labelY = bar.y + bar.height / 2;
          if (bar.y < top) labelY = Math.max(top + 12, labelY);
        } else {
          ctx.fillStyle = chart.options.plugins?.legend?.labels?.color || '#334155';
          ctx.textBaseline = 'bottom';
          labelY = bar.y - 7;
        }
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(display, labelX, labelY);
      });
    });
  }
};

let _chartVer = 0;
function drawAllCharts() {
  _chartVer++;
  renderChartYearFilter();

  let chartRecords = records.filter(r => {
    if (!r.tarih) return false;
    const d = new Date(r.tarih + 'T12:00:00');
    if (d.getFullYear() !== Number(chartYearFilter)) return false;
    if (chartMonthFilter > 0 && d.getMonth() + 1 !== chartMonthFilter) return false;
    return true;
  });

  // Grafik kartlarındaki canlı yıl toplamları (veri değiştikçe güncellenir)
  const totYemek = chartRecords.reduce((s, r) => s + (Number(r.yemek) || 0), 0);
  const totTurnike = chartRecords.reduce((s, r) => s + (Number(r.toplam) || 0), 0);
  const totOgrenci = chartRecords.reduce((s, r) => s + (Number(r.ogrenci) || 0), 0);
  const totIdariPersonel = chartRecords.reduce((s, r) => s + Math.max(0, (Number(r.turnike) || 0) - (Number(r.ogrenci) || 0)) + (Number(r.personel) || 0), 0);
  const totAtik = chartRecords.reduce((s, r) => s + (Number(r.atik) || 0), 0);
  const totAtikPorsiyon = chartRecords.reduce((s, r) => s + ((Number(r.porsiyon) || 0) > 0 ? (Number(r.atik) || 0) * 1000 / (Number(r.porsiyon) || 400) : 0), 0);
  const totFark = totYemek - totTurnike;
  const totAtikOran = totYemek > 0 ? (totAtik * 250 / totYemek) : 0;
  const totAtikPerKisi = totTurnike > 0 ? (totAtik / totTurnike) : 0;
  function setChartTotal(id, val, formatter, label) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = formatter(val) + '<small>' + (label || 'Yıl Toplamı') + '</small>';
  }
  setChartTotal('chartTotalYemek', totYemek, v => Math.round(v).toLocaleString('tr-TR'));
  setChartTotal('chartTotalTurnike', totTurnike, v => Math.round(v).toLocaleString('tr-TR'));
  setChartTotal('chartTotalOgrenci', totOgrenci, v => Math.round(v).toLocaleString('tr-TR'));
  setChartTotal('chartTotalIdariPersonel', totIdariPersonel, v => Math.round(v).toLocaleString('tr-TR'));
  setChartTotal('chartTotalAtik', totAtik, v => v.toLocaleString('tr-TR', { maximumFractionDigits: 1 }));
  setChartTotal('chartTotalFark', totFark, v => (Math.round(v)).toLocaleString('tr-TR'));
  setChartTotal('chartTotalAtikOran', totAtikOran, v => v.toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' %', 'Yıl Ortalaması');
  setChartTotal('chartTotalAtikPerKisi', totAtikPerKisi, v => v.toLocaleString('tr-TR', { maximumFractionDigits: 2 }), 'Yıl Ortalaması');
  setChartTotal('chartTotalAtikPorsiyon', totAtikPorsiyon, v => Math.round(v).toLocaleString('tr-TR'));

  const emptyIds = ['chartAtikEmpty','chartYemekEmpty','chartTurnikeEmpty','chartAylikEmpty','chartFarkEmpty','chartAtikOranEmpty','chartOgrenciEmpty','chartIdariPersonelEmpty','chartAtikPerKisiEmpty','chartAtikPorsiyonEmpty','chartHaccpAylikEmpty'];
  const canvasIds = ['canvasAtik','canvasYemek','canvasTurnike','canvasAylik','canvasFark','canvasAtikOran','canvasOgrenci','canvasIdariPersonel','canvasAtikPerKisi','canvasAtikPorsiyon','canvasHaccpAylik'];

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
    const date = new Date(r.tarih + 'T12:00:00');
    const monthKey = (date.getMonth() + 1) + '/' + date.getFullYear();
    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = { yemek: 0, toplam: 0, atik: 0, turnike: 0, ogrenci: 0, idari: 0, personel: 0, harcama: 0, porsiyon: 0, atikPorsiyon: 0 };
    }
    monthlyData[monthKey].yemek += r.yemek;
    monthlyData[monthKey].toplam += r.toplam;
    monthlyData[monthKey].atik += r.atik;
    monthlyData[monthKey].turnike += r.turnike;
    monthlyData[monthKey].ogrenci += r.ogrenci;
    monthlyData[monthKey].idari += Math.max(0, (r.turnike || 0) - (r.ogrenci || 0));
    monthlyData[monthKey].personel += r.personel;
    monthlyData[monthKey].harcama += (r.harcama_tutari || 0);
    monthlyData[monthKey].porsiyon += r.porsiyon;
    // Çöpe giden porsiyon = atık kg × 1000 / porsiyon gr
    if (r.porsiyon > 0) {
      monthlyData[monthKey].atikPorsiyon += r.atik * 1000 / r.porsiyon;
    }
  });

  const chartYears = [Number(chartYearFilter)];
  let allMonthLabels = [];
  chartYears.forEach(y => {
    for (let m = 1; m <= 12; m++) allMonthLabels.push(m + '/' + y);
  });
  const getMonthVal = (label, field) => (monthlyData[label] ? monthlyData[label][field] : 0);

  const uyari = [];
  allMonthLabels.forEach(m => {
    const top = getMonthVal(m, 'toplam');
    const sum = getMonthVal(m, 'ogrenci') + getMonthVal(m, 'idari') + getMonthVal(m, 'personel');
    if (Math.abs(top - sum) > 0.5) uyari.push(m + ': Geçiş=' + top + ' | Öğr+Akd+İdr+Pers=' + sum + ' (fark ' + (top - sum) + ')');
  });
  const fazlaOgrenci = chartRecords.filter(r => (Number(r.ogrenci) || 0) > (Number(r.turnike) || 0))
    .map(r => r.tarih + ' (Turnike:' + r.turnike + ' / Öğr:' + r.ogrenci + ')');
  const uyariEl = document.getElementById('chartAylikUyari');
  if (uyariEl) {
    const lines = [];
    if (uyari.length) lines.push('Aylık uyumsuzluk: ' + uyari.join(' | '));
    if (fazlaOgrenci.length) lines.push('Öğrenci > Turnike olan günler: ' + fazlaOgrenci.join(', '));
    if (lines.length) {
      uyariEl.style.display = 'block';
      uyariEl.textContent = lines.join(' — ');
    } else {
      uyariEl.style.display = 'none';
    }
  }

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
            maxBarThickness: isLineDS ? undefined : 72,
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
              autoSkip: true,
              maxTicksLimit: Math.min(labels.length, 15),
              autoSkipPadding: 10,
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
    return chart;
  }

  function getRecordsByLabel(label) {
    const parts = label.split('/');
    if (parts.length === 2) {
      const ay = parseInt(parts[0]), yil = parseInt(parts[1]);
      if (!isNaN(ay) && !isNaN(yil)) {
        return records.filter(r => {
          const d = new Date(r.tarih + 'T12:00:00');
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
          const d = new Date(r.tarih + 'T12:00:00');
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

  // --- Charts (her biri try-catch ile izole) ---
  try { makeChart('canvasAtik', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'atik')), color: '#f97316', label: t('chartMonthlyWasteKg') }], { onClick: clickHandler }); } catch(e) { console.warn('chartAtik error:', e); }
  try { makeChart('canvasAtikPorsiyon', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'atikPorsiyon')), color: '#fb923c', label: t('chartMonthlyWastePortion') }], { onClick: clickHandler }); } catch(e) { console.warn('chartAtikPorsiyon error:', e); }
  try { makeChart('canvasYemek', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'yemek')), color: '#6366f1', label: t('chartMonthlyMealCount') }], { onClick: clickHandler }); } catch(e) { console.warn('chartYemek error:', e); }
  try { makeChart('canvasTurnike', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'toplam')), color: '#10b981', label: t('chartMonthlyTurnstile') }], { onClick: clickHandler }); } catch(e) { console.warn('chartTurnike error:', e); }

  const prevYearAtik = allMonthLabels.map(m => {
    const [ay, yil] = m.split('/');
    return getMonthVal(ay + '/' + (parseInt(yil) - 1), 'atikPorsiyon');
  });
  const hasPrevYear = prevYearAtik.some(v => v > 0);
  const aylikSets = [
    { data: allMonthLabels.map(m => getMonthVal(m, 'yemek')), color: '#6366f1', label: t('chartMonthlyProduction') },
    { data: allMonthLabels.map(m => getMonthVal(m, 'toplam')), color: '#22d3ee', label: t('chartMonthlyPasses') },
    { data: allMonthLabels.map(m => getMonthVal(m, 'atikPorsiyon')), color: '#f59e0b', label: t('chartMonthlyWaste') },
  ];
  if (hasPrevYear) aylikSets.push({ data: prevYearAtik, color: '#f59e0b', label: t('chartLastYearWaste'), dashed: true });
  try { makeChart('canvasAylik', allMonthLabels, aylikSets, { onClick: clickHandler, type: 'bar' }); } catch(e) { console.warn('chartAylik error:', e); }

  const farkData = allMonthLabels.map(m => getMonthVal(m, 'yemek') - getMonthVal(m, 'toplam'));
  try { makeChart('canvasFark', allMonthLabels, [{ data: farkData, color: '#3b82f6', label: 'Üretim ile Turnike Geçişi Arasındaki Fark' }], { onClick: clickHandler }); } catch(e) { console.warn('chartFark error:', e); }

  const aylikOran = allMonthLabels.map(m => {
    const y = getMonthVal(m, 'yemek'), a = getMonthVal(m, 'atik');
    return y > 0 ? (a * 250 / y) : 0;
  });
  try { makeChart('canvasAtikOran', allMonthLabels, [{ data: aylikOran, color: '#0ea5e9', label: t('chartMonthlyWasteRate') }], { onClick: clickHandler }); } catch(e) { console.warn('chartAtikOran error:', e); }
  try { makeChart('canvasOgrenci', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'ogrenci')), color: '#0ea5e9', label: t('chartMonthlyStudent') }], { onClick: clickHandler }); } catch(e) { console.warn('chartOgrenci error:', e); }
  try { makeChart('canvasIdariPersonel', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'idari') + getMonthVal(m, 'personel')), color: '#0ea5e9', label: 'Akademik ve İdari + SKS Personeli' }], { onClick: clickHandler }); } catch(e) { console.warn('chartIdariPersonel error:', e); }

  const atikPerKisi = allMonthLabels.map(m => {
    const t = getMonthVal(m, 'toplam'), a = getMonthVal(m, 'atik');
    return t > 0 ? a / t : 0;
  });
  try { makeChart('canvasAtikPerKisi', allMonthLabels, [{ data: atikPerKisi, color: '#14b8a6', label: t('chartWastePerPersonLabel') }], { onClick: clickHandler }); } catch(e) { console.warn('chartAtikPerKisi error:', e); }

  // --- HACCP Sicaklik Chart (her depo ayri kart) ---
  function haccpFilter(r) {
    if (r.type !== 'sicaklik') return false;
    if (!r.tarih) return false;
    var d = new Date(r.tarih + 'T12:00:00');
    if (d.getFullYear() !== Number(chartYearFilter)) return false;
    if (chartMonthFilter > 0 && d.getMonth() + 1 !== chartMonthFilter) return false;
    return true;
  }
  var sicaklikKayitlari = haccpRecords.filter(haccpFilter);
  var container = document.getElementById('haccpSicaklikChartContainer');
  if (!container) return;
  container.innerHTML = '';
  if (sicaklikKayitlari.length > 0) {
    var depoRenkPaleti = ['#6366f1', '#f97316', '#10b981', '#0ea5e9', '#22d3ee', '#f59e0b', '#ef4444', '#14b8a6'];
    var depoVeri = {};
    sicaklikKayitlari.forEach(function(r) {
      if (!r.tarih) return;
      var ad = r.depoAd || 'Bilinmeyen';
      if (!depoVeri[ad]) depoVeri[ad] = {};
      var v = parseFloat(r.sicaklik);
      if (isNaN(v)) return;
      var d = new Date(r.tarih + 'T12:00:00');
      var gun = d.getDay();
      var fark = d.getDate() - gun + (gun === 0 ? -6 : 1);
      var pazartesi = new Date(d);
      pazartesi.setDate(fark);
      var haftaAnahtari = formatLocalDate(pazartesi);
      if (!depoVeri[ad][haftaAnahtari]) depoVeri[ad][haftaAnahtari] = [];
      depoVeri[ad][haftaAnahtari].push(v);
    });
    var tumHaftalar = [];
    Object.values(depoVeri).forEach(function(h) { Object.keys(h).forEach(function(w) { if (tumHaftalar.indexOf(w) === -1) tumHaftalar.push(w); }); });
    tumHaftalar.sort();
    var tumDepolar = Object.keys(depoVeri).sort(function(a, b) {
      var na = parseInt(a.match(/\d+/) || 0);
      var nb = parseInt(b.match(/\d+/) || 0);
      return na - nb;
    });
    var haftaEtiketleri = tumHaftalar.map(function(h) {
      var bas = new Date(h + 'T12:00:00');
      var bit = new Date(bas);
      bit.setDate(bas.getDate() + 6);
      var fmt = function(dd) { return String(dd.getDate()).padStart(2,'0') + '.' + String(dd.getMonth()+1).padStart(2,'0'); };
      return fmt(bas) + ' - ' + fmt(bit);
    });
    tumDepolar.forEach(function(ad, idx) {
      var card = document.createElement('div');
      card.className = 'section-card chart-card chart-card-full';
      var header = document.createElement('div');
      header.className = 'section-header';
      header.innerHTML = '<h2>' + escapeHtml(ad) + ' - Sıcaklık Geçmişi</h2>';
      card.appendChild(header);
      var area = document.createElement('div');
      area.className = 'chart-area';
      var canvas = document.createElement('canvas');
      var cid = 'canvasSicaklik_' + idx;
      canvas.id = cid;
      area.appendChild(canvas);
      card.appendChild(area);
      var note = document.createElement('div');
      note.className = 'chart-note';
      note.textContent = 'Haftalık ortalama sıcaklık değerleri — alt ve üst limit çizgileriyle birlikte';
      card.appendChild(note);
      container.appendChild(card);
      var depoData = {
        data: tumHaftalar.map(function(w) {
          var vals = (depoVeri[ad] && depoVeri[ad][w]) || [];
          if (vals.length === 0) return null;
          var sum = vals.reduce(function(a, b) { return a + b; }, 0);
          return Math.round(sum / vals.length * 10) / 10;
        }),
        color: depoRenkPaleti[idx % depoRenkPaleti.length],
        label: ad
      };
      var limits = getDepoSicaklikLimitleri(ad);
      var thresholds = [
        { data: haftaEtiketleri.map(function() { return limits.max; }), color: '#ef4444', label: 'Üst Limit (' + (limits.max > 0 ? '+' : '') + limits.max + '°C)', dashed: true },
        { data: haftaEtiketleri.map(function() { return limits.min; }), color: '#3b82f6', label: 'Alt Limit (' + limits.min + '°C)', dashed: true },
      ];
      try { makeChart(cid, haftaEtiketleri, [depoData].concat(thresholds), { type: 'line', showValues: false }); } catch(e) { console.warn('chartSicaklik_' + idx + ' error:', e); }
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
      var d = new Date(r.tarih + 'T12:00:00');
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
    var depoRenkler2 = ['#6366f1', '#f97316', '#10b981', '#0ea5e9', '#22d3ee', '#f59e0b', '#ef4444', '#14b8a6'];
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
    try { makeChart('canvasHaccpAylik', aylikAyLabels, aylikDatasets, { type: 'bar', showValues: true }); } catch(e) { console.warn('chartHaccpAylik error:', e); }
  } else {
    if (aylikSicaklikEmpty) aylikSicaklikEmpty.style.display = 'block';
    if (aylikSicaklikCanvas) aylikSicaklikCanvas.style.display = 'none';
  }

}

// ─── HARCAMA MENÜSÜ ────────────────────────────────────────────────────────────
let harcamaMenuChart = null;
let harcamaPersonelChart = null;
let harcamaYemekChart = null;

function renderHarcamaMenu() {
  hcUpdateNav();
  const oranInput = document.getElementById('hcOran');
  if (oranInput && document.activeElement !== oranInput) {
    oranInput.value = getOgrenciBasiHarcamaOrani().toFixed(2);
  }
  const oran = parseFloat(oranInput && oranInput.value) || 0;
  const status = document.getElementById('hcOranStatus');
  if (status) {
    const saved = getOgrenciBasiHarcamaOrani();
    status.textContent = 'Kayıtlı oran: ' + saved.toFixed(2) + ' ₺' + (oran !== saved ? ' (kaydedilmemiş değişiklik)' : '');
    status.style.color = oran !== saved ? '#f59e0b' : '#22c55e';
  }
  const persOranInput = document.getElementById('hcPersonelOran');
  if (persOranInput && document.activeElement !== persOranInput) {
    persOranInput.value = getPersonelBasiHarcamaOrani().toFixed(2);
  }
  const persOran = parseFloat(persOranInput && persOranInput.value) || 0;
  const persStatus = document.getElementById('hcPersonelOranStatus');
  if (persStatus) {
    const persSaved = getPersonelBasiHarcamaOrani();
    persStatus.textContent = 'Kayıtlı oran: ' + persSaved.toFixed(2) + ' ₺' + (persOran !== persSaved ? ' (kaydedilmemiş değişiklik)' : '');
    persStatus.style.color = persOran !== persSaved ? '#f59e0b' : '#22c55e';
  }
  const yemekOranInput = document.getElementById('hcYemekOran');
  if (yemekOranInput && document.activeElement !== yemekOranInput) {
    yemekOranInput.value = getUretilenYemekBasiHarcamaOrani().toFixed(2);
  }
  const yemekOran = parseFloat(yemekOranInput && yemekOranInput.value) || 0;
  const yemekStatus = document.getElementById('hcYemekOranStatus');
  if (yemekStatus) {
    const yemekSaved = getUretilenYemekBasiHarcamaOrani();
    yemekStatus.textContent = 'Kayıtlı oran: ' + yemekSaved.toFixed(2) + ' ₺' + (yemekOran !== yemekSaved ? ' (kaydedilmemiş değişiklik)' : '');
    yemekStatus.style.color = yemekOran !== yemekSaved ? '#f59e0b' : '#22c55e';
  }
  renderHarcamaMenuKpis(oran, persOran, yemekOran);
  renderHarcamaMenuChart(oran);
  renderHarcamaMenuPersonelChart(persOran);
  renderHarcamaMenuYemekChart(yemekOran);
  renderHarcamaMenuTable(oran, persOran, yemekOran);
}

function renderHarcamaMenuKpis(oran, persOran, yemekOran) {
  const el = document.getElementById('hcKpis');
  if (!el) return;
  const withOgrenci = hcActiveRecords().filter(r => (r.ogrenci || 0) > 0);
  const withPersonel = hcActiveRecords().filter(r => hcToplamPersonel(r) > 0);
  const withYemek = hcActiveRecords().filter(r => (r.yemek || 0) > 0);
  const totalOgrenciHarcama = withOgrenci.reduce((s, r) => s + (r.ogrenci || 0) * oran, 0);
  const totalPersonelHarcama = withPersonel.reduce((s, r) => s + hcToplamPersonel(r) * persOran, 0);
  const totalYemekHarcama = withYemek.reduce((s, r) => s + (r.yemek || 0) * (yemekOran || 0), 0);
  const totalOgrenci = withOgrenci.reduce((s, r) => s + (r.ogrenci || 0), 0);
  const totalPersonel = withPersonel.reduce((s, r) => s + hcToplamPersonel(r), 0);
  const totalYemek = withYemek.reduce((s, r) => s + (r.yemek || 0), 0);
  const monthlyOgrenci = {};
  const monthlyPersonel = {};
  const monthlyYemek = {};
  withOgrenci.forEach(r => {
    const d = new Date(r.tarih + 'T12:00:00');
    if (isNaN(d)) return;
    const key = (d.getMonth() + 1) + '/' + d.getFullYear();
    if (!monthlyOgrenci[key]) monthlyOgrenci[key] = 0;
    monthlyOgrenci[key] += (r.ogrenci || 0) * oran;
  });
  withPersonel.forEach(r => {
    const d = new Date(r.tarih + 'T12:00:00');
    if (isNaN(d)) return;
    const key = (d.getMonth() + 1) + '/' + d.getFullYear();
    if (!monthlyPersonel[key]) monthlyPersonel[key] = 0;
    monthlyPersonel[key] += hcToplamPersonel(r) * persOran;
  });
  withYemek.forEach(r => {
    const d = new Date(r.tarih + 'T12:00:00');
    if (isNaN(d)) return;
    const key = (d.getMonth() + 1) + '/' + d.getFullYear();
    if (!monthlyYemek[key]) monthlyYemek[key] = 0;
    monthlyYemek[key] += (r.yemek || 0) * (yemekOran || 0);
  });
  const valsO = Object.values(monthlyOgrenci);
  const valsP = Object.values(monthlyPersonel);
  const valsY = Object.values(monthlyYemek);
  const avgMonthlyO = valsO.length ? valsO.reduce((a, b) => a + b, 0) / valsO.length : 0;
  const avgMonthlyP = valsP.length ? valsP.reduce((a, b) => a + b, 0) / valsP.length : 0;
  const avgMonthlyY = valsY.length ? valsY.reduce((a, b) => a + b, 0) / valsY.length : 0;
  const maxKeyO = valsO.length ? Object.keys(monthlyOgrenci).reduce((a, b) => monthlyOgrenci[a] >= monthlyOgrenci[b] ? a : b) : null;
  const maxKeyP = valsP.length ? Object.keys(monthlyPersonel).reduce((a, b) => monthlyPersonel[a] >= monthlyPersonel[b] ? a : b) : null;
  const maxYKey = valsY.length ? Object.keys(monthlyYemek).reduce((a, b) => monthlyYemek[a] >= monthlyYemek[b] ? a : b) : null;
  const monthLabel = key => {
    if (!key) return '—';
    const parts = key.split('/');
    return HC_MONTHS_TR[Number(parts[0]) - 1] + ' ' + parts[1];
  };
  const fmtTL = v => v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-icon kpi-cyan">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">Toplam Öğrenci Harcama</span>
        <span class="kpi-value" id="hcTotal">${fmtTL(totalOgrenciHarcama)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-blue">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">Toplam Personel Harcama</span>
        <span class="kpi-value" id="hcPersonelTotal">${fmtTL(totalPersonelHarcama)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-green">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">Ort. Aylık Öğr. Harcama</span>
        <span class="kpi-value" id="hcAvg">${fmtTL(avgMonthlyO)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-orange">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">Ort. Aylık Pers. Harcama</span>
        <span class="kpi-value" id="hcPersonelAvg">${fmtTL(avgMonthlyP)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-blue">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">Toplam Öğrenci</span>
        <span class="kpi-value" id="hcOgrenci">${totalOgrenci.toLocaleString('tr-TR')}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-green">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">Toplam Personel</span>
        <span class="kpi-value" id="hcPersonel">${totalPersonel.toLocaleString('tr-TR')}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-orange">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">En Yüksek Öğr. Ay</span>
        <span class="kpi-value" id="hcMaxMonth" style="font-size:1.25rem">${monthLabel(maxKeyO)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-purple">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">En Yüksek Pers. Ay</span>
        <span class="kpi-value" id="hcPersonelMaxMonth" style="font-size:1.25rem">${monthLabel(maxKeyP)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-cyan">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><path d="M6 1v3M10 1v3M14 1v3"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">Toplam Yemek Harcama</span>
        <span class="kpi-value" id="hcYemekTotal">${fmtTL(totalYemekHarcama)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-green">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">Ort. Aylık Yemek Harcama</span>
        <span class="kpi-value" id="hcYemekAvg">${fmtTL(avgMonthlyY)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-blue">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">Toplam Üretilen Yemek</span>
        <span class="kpi-value" id="hcYemekAdet">${totalYemek.toLocaleString('tr-TR')}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-orange">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">En Yüksek Yemek Ay</span>
        <span class="kpi-value" id="hcYemekMaxMonth" style="font-size:1.25rem">${monthLabel(maxYKey)}</span>
      </div>
    </div>
  `;
}

function renderHarcamaMenuChart(oran) {
  const canvas = document.getElementById('canvasHarcamaMenu');
  const empty = document.getElementById('hcChartEmpty');
  if (!canvas || !empty) return;
  if (harcamaMenuChart) { harcamaMenuChart.destroy(); harcamaMenuChart = null; }

  // Hiç kayıt yoksa boş durumu göster
  const hasAnyDate = records.some(r => { const d = new Date(r.tarih + 'T12:00:00'); return !isNaN(d); });
  if (!hasAnyDate) {
    empty.style.display = 'block';
    canvas.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  canvas.style.display = 'block';

  // Seçili yıl/aya göre aylık toplamlar
  const active = hcActiveRecords();
  const monthly = {};
  active.forEach(r => {
    const d = new Date(r.tarih + 'T12:00:00');
    if (isNaN(d)) return;
    const m = d.getMonth();
    monthly[m] = (monthly[m] || 0) + (r.ogrenci || 0) * oran;
  });

  // Tüm Yıl => 12 ay (boş aylar 0 ile), belirli ay => tek çubuk
  let labels, data;
  if (hcSelectedMonth === null) {
    labels = HC_MONTHS_TR.map((m, i) => m.slice(0, 3) + ' ' + String(hcSelectedYear).slice(2));
    data = HC_MONTHS_TR.map((_, i) => monthly[i] || 0);
  } else {
    labels = [HC_MONTHS_TR[hcSelectedMonth] + ' ' + hcSelectedYear];
    data = [monthly[hcSelectedMonth] || 0];
  }

  const chartMax = Math.max.apply(null, data.length ? data : [0]);
  const suggestedMax = chartMax > 0 ? chartMax * 1.18 : 10;

  const area = canvas.parentElement;
  // Kaydırma için kanvas boyutu: 12 ay => geniş kanvas (yatay kaydırma çubuğu görünür)
  const areaW = Math.max(area.clientWidth || 400, 320);
  const barW = 88;
  const targetW = Math.max(areaW, labels.length * barW + 70);
  const canvasH = 340;
  canvas.style.width = targetW + 'px';
  canvas.style.height = canvasH + 'px';
  canvas.width = targetW;
  canvas.height = canvasH;
  area.style.width = '100%';

  const ctx = canvas.getContext('2d');
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const colors = {
    text: isDark ? '#e2e8f0' : '#1e293b',
    grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
  };
  const baseColor = '#14b8a6';
  const selColor = '#f59e0b';
  const barColors = data.map((v, i) =>
    hcSelectedMonth !== null && i === 0 ? selColor :
    hcSelectedMonth === null && monthly[i] === 0 ? 'rgba(148,163,184,0.25)' : baseColor
  );

  harcamaMenuChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Öğrenci Harcama (₺)',
        data,
        backgroundColor: barColors,
        borderColor: barColors,
        borderRadius: 6,
        barPercentage: 0.8,
        categoryPercentage: 0.75,
        maxBarThickness: 72,
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      devicePixelRatio: Math.max(window.devicePixelRatio || 1, 2),
      animation: { duration: 600, easing: 'easeOutCubic' },
      plugins: {
        legend: { display: hcSelectedMonth === null, labels: { color: colors.text, font: { size: 13, family: 'Inter', weight: '500' } } },
        tooltip: {
          backgroundColor: '#000000',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          bodyFont: { size: 11, family: 'Inter' },
          titleFont: { size: 11, family: 'Inter', weight: 'bold' },
          callbacks: { label: c => ' ' + c.dataset.label + ': ' + c.parsed.y.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺' }
        },
        valueLabels: true,
      },
      scales: {
        x: { ticks: { color: colors.text, font: { size: 12, family: 'Inter' }, maxRotation: 45 }, grid: { display: false } },
          y: {
            beginAtZero: true,
            suggestedMax: suggestedMax,
            ticks: { color: colors.text, font: { size: 12, family: 'Inter' } },
            grid: { color: colors.grid }
          }
      }
    },
    plugins: [chartValueLabelPlugin]
  });
}

function renderHarcamaMenuPersonelChart(persOran) {
  const canvas = document.getElementById('canvasHarcamaPersonel');
  const empty = document.getElementById('hcPersonelChartEmpty');
  if (!canvas || !empty) return;
  if (harcamaPersonelChart) { harcamaPersonelChart.destroy(); harcamaPersonelChart = null; }

  const hasAnyDate = records.some(r => { const d = new Date(r.tarih + 'T12:00:00'); return !isNaN(d); });
  if (!hasAnyDate) {
    empty.style.display = 'block';
    canvas.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  canvas.style.display = 'block';

  const active = hcActiveRecords();
  const monthly = {};
  active.forEach(r => {
    const d = new Date(r.tarih + 'T12:00:00');
    if (isNaN(d)) return;
    const m = d.getMonth();
    monthly[m] = (monthly[m] || 0) + hcToplamPersonel(r) * persOran;
  });

  let labels, data;
  if (hcSelectedMonth === null) {
    labels = HC_MONTHS_TR.map((m, i) => m.slice(0, 3) + ' ' + String(hcSelectedYear).slice(2));
    data = HC_MONTHS_TR.map((_, i) => monthly[i] || 0);
  } else {
    labels = [HC_MONTHS_TR[hcSelectedMonth] + ' ' + hcSelectedYear];
    data = [monthly[hcSelectedMonth] || 0];
  }

  const chartMax = Math.max.apply(null, data.length ? data : [0]);
  const suggestedMax = chartMax > 0 ? chartMax * 1.18 : 10;

  const area = canvas.parentElement;
  const areaW = Math.max(area.clientWidth || 400, 320);
  const barW = 88;
  const targetW = Math.max(areaW, labels.length * barW + 70);
  const canvasH = 340;
  canvas.style.width = targetW + 'px';
  canvas.style.height = canvasH + 'px';
  canvas.width = targetW;
  canvas.height = canvasH;
  area.style.width = '100%';

  const ctx = canvas.getContext('2d');
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const colors = {
    text: isDark ? '#e2e8f0' : '#1e293b',
    grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
  };
  const baseColor = '#6366f1';
  const selColor = '#f59e0b';
  const barColors = data.map((v, i) =>
    hcSelectedMonth !== null && i === 0 ? selColor :
    hcSelectedMonth === null && monthly[i] === 0 ? 'rgba(148,163,184,0.25)' : baseColor
  );

  harcamaPersonelChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Personel Harcama (₺)',
        data,
        backgroundColor: barColors,
        borderColor: barColors,
        borderRadius: 6,
        barPercentage: 0.8,
        categoryPercentage: 0.75,
        maxBarThickness: 72,
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      devicePixelRatio: Math.max(window.devicePixelRatio || 1, 2),
      animation: { duration: 600, easing: 'easeOutCubic' },
      plugins: {
        legend: { display: hcSelectedMonth === null, labels: { color: colors.text, font: { size: 13, family: 'Inter', weight: '500' } } },
        tooltip: {
          backgroundColor: '#000000',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          bodyFont: { size: 11, family: 'Inter' },
          titleFont: { size: 11, family: 'Inter', weight: 'bold' },
          callbacks: { label: c => ' ' + c.dataset.label + ': ' + c.parsed.y.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺' }
        },
        valueLabels: true,
      },
      scales: {
        x: { ticks: { color: colors.text, font: { size: 12, family: 'Inter' }, maxRotation: 45 }, grid: { display: false } },
          y: {
            beginAtZero: true,
            suggestedMax: suggestedMax,
            ticks: { color: colors.text, font: { size: 12, family: 'Inter' } },
            grid: { color: colors.grid }
          }
      }
    },
    plugins: [chartValueLabelPlugin]
  });
}

function renderHarcamaMenuYemekChart(yemekOran) {
  const canvas = document.getElementById('canvasHarcamaYemek');
  const empty = document.getElementById('hcYemekChartEmpty');
  if (!canvas || !empty) return;
  if (harcamaYemekChart) { harcamaYemekChart.destroy(); harcamaYemekChart = null; }

  const hasAnyDate = records.some(r => { const d = new Date(r.tarih + 'T12:00:00'); return !isNaN(d); });
  if (!hasAnyDate) {
    empty.style.display = 'block';
    canvas.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  canvas.style.display = 'block';

  const active = hcActiveRecords();
  const monthly = {};
  active.forEach(r => {
    const d = new Date(r.tarih + 'T12:00:00');
    if (isNaN(d)) return;
    const m = d.getMonth();
    monthly[m] = (monthly[m] || 0) + (r.yemek || 0) * (yemekOran || 0);
  });

  let labels, data;
  if (hcSelectedMonth === null) {
    labels = HC_MONTHS_TR.map((m, i) => m.slice(0, 3) + ' ' + String(hcSelectedYear).slice(2));
    data = HC_MONTHS_TR.map((_, i) => monthly[i] || 0);
  } else {
    labels = [HC_MONTHS_TR[hcSelectedMonth] + ' ' + hcSelectedYear];
    data = [monthly[hcSelectedMonth] || 0];
  }

  const chartMax = Math.max.apply(null, data.length ? data : [0]);
  const suggestedMax = chartMax > 0 ? chartMax * 1.18 : 10;

  const area = canvas.parentElement;
  const areaW = Math.max(area.clientWidth || 400, 320);
  const barW = 88;
  const targetW = Math.max(areaW, labels.length * barW + 70);
  const canvasH = 340;
  canvas.style.width = targetW + 'px';
  canvas.style.height = canvasH + 'px';
  canvas.width = targetW;
  canvas.height = canvasH;
  area.style.width = '100%';

  const ctx = canvas.getContext('2d');
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const colors = {
    text: isDark ? '#e2e8f0' : '#1e293b',
    grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
  };
  const baseColor = '#e8793a';
  const selColor = '#f59e0b';
  const barColors = data.map((v, i) =>
    hcSelectedMonth !== null && i === 0 ? selColor :
    hcSelectedMonth === null && monthly[i] === 0 ? 'rgba(148,163,184,0.25)' : baseColor
  );

  harcamaYemekChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Yemek Harcama (₺)',
        data,
        backgroundColor: barColors,
        borderColor: barColors,
        borderRadius: 6,
        barPercentage: 0.8,
        categoryPercentage: 0.75,
        maxBarThickness: 72,
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      devicePixelRatio: Math.max(window.devicePixelRatio || 1, 2),
      animation: { duration: 600, easing: 'easeOutCubic' },
      plugins: {
        legend: { display: hcSelectedMonth === null, labels: { color: colors.text, font: { size: 13, family: 'Inter', weight: '500' } } },
        tooltip: {
          backgroundColor: '#000000',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          bodyFont: { size: 11, family: 'Inter' },
          titleFont: { size: 11, family: 'Inter', weight: 'bold' },
          callbacks: { label: c => ' ' + c.dataset.label + ': ' + c.parsed.y.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺' }
        },
        valueLabels: true,
      },
      scales: {
        x: { ticks: { color: colors.text, font: { size: 12, family: 'Inter' }, maxRotation: 45 }, grid: { display: false } },
          y: {
            beginAtZero: true,
            suggestedMax: suggestedMax,
            ticks: { color: colors.text, font: { size: 12, family: 'Inter' } },
            grid: { color: colors.grid }
          }
      }
    },
    plugins: [chartValueLabelPlugin]
  });
}

function renderHarcamaMenuTable(oran, persOran, yemekOran) {
  const tbody = document.getElementById('hcTbody');
  const pag = document.getElementById('hcPagination');
  if (!tbody) return;
  const sorted = hcActiveRecords().sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:1rem">Henüz kayıt yok.</td></tr>';
    if (pag) pag.innerHTML = '';
    return;
  }
  const perPage = 10;
  const totalPages = Math.ceil(sorted.length / perPage);
  if (hcTablePage > totalPages - 1) hcTablePage = totalPages - 1;
  const start = hcTablePage * perPage;
  const pageRows = sorted.slice(start, start + perPage);
  tbody.innerHTML = pageRows.map(r => {
    const ogrTutar = (r.ogrenci || 0) * oran;
    const toplamPersonel = hcToplamPersonel(r);
    const persTutar = toplamPersonel * persOran;
    const uretilenYemek = (r.yemek || 0);
    const yemekTutar = uretilenYemek * (yemekOran || 0);
    const tl = v => v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
    return `<tr>
      <td>${displayDate(r.tarih)}</td>
      <td>${(r.ogrenci || 0).toLocaleString('tr-TR')}</td>
      <td>${tl(oran)}</td>
      <td>${tl(ogrTutar)}</td>
      <td>${toplamPersonel.toLocaleString('tr-TR')}</td>
      <td>${tl(persOran)}</td>
      <td>${tl(persTutar)}</td>
      <td>${uretilenYemek.toLocaleString('tr-TR')}</td>
      <td>${tl(yemekTutar)}</td>
    </tr>`;
  }).join('');
  if (pag) {
    pag.setAttribute('data-total', String(totalPages));
    if (totalPages <= 1) {
      pag.innerHTML = '';
    } else {
      const p = hcTablePage + 1;
      pag.innerHTML =
        `<button class="btn btn-ghost btn-sm" onclick="hcGoToPage(1)" ${p === 1 ? 'disabled' : ''}>&#171;</button>` +
        `<button class="btn btn-ghost btn-sm" onclick="hcGoToPage(${p - 1})" ${p === 1 ? 'disabled' : ''}>&#8249;</button>` +
        `<span class="page-info">${p} / ${totalPages}</span>` +
        `<button class="btn btn-ghost btn-sm" onclick="hcGoToPage(${p + 1})" ${p === totalPages ? 'disabled' : ''}>&#8250;</button>` +
        `<button class="btn btn-ghost btn-sm" onclick="hcGoToPage(${totalPages})" ${p === totalPages ? 'disabled' : ''}>&#187;</button>` +
        `<span class="page-total">${sorted.length} kayıt</span>`;
    }
  }
}

// ─── HARCAMA MENÜSÜ NAV (yıl / ay / kaydırma) ────────────────────────────────
const HC_MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

function hcGetYears() {
  var set = {};
  records.forEach(function (r) {
    var d = new Date(r.tarih + 'T12:00:00');
    if (!isNaN(d)) set[d.getFullYear()] = true;
  });
  var years = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  return years.length ? years : [new Date().getFullYear()];
}

function hcDefaultYear() {
  var years = hcGetYears();
  return years[years.length - 1];
}

function renderHarcamaNav() {
  var container = document.getElementById('hcControls');
  if (!container) return;
  var years = hcGetYears();
  if (hcSelectedYear === null || years.indexOf(hcSelectedYear) === -1) hcSelectedYear = hcDefaultYear();
  var html = '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
  html += '<label style="font-size:0.8rem;color:var(--text-muted)">Yıl:</label>';
  html += '<select id="hcYearSelect" onchange="hcSetYearFromSelect()" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;background:var(--bg-card);color:var(--text-primary)">';
  years.forEach(function (y) {
    html += '<option value="' + y + '"' + (hcSelectedYear === y ? ' selected' : '') + '>' + y + '</option>';
  });
  html += '</select>';
  html += '<span style="font-size:0.8rem;color:var(--text-muted);margin-left:4px">Ay:</span>';
  var months = ['Tümü', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  months.forEach(function (m, i) {
    var active = (i === 0 ? hcSelectedMonth === null : hcSelectedMonth === i - 1) ? ' active' : '';
    html += '<button class="year-btn month-btn' + active + '" data-hc-month="' + i + '" onclick="hcSetMonth(' + i + ')">' + m + '</button>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function hcSetYearFromSelect() {
  var sel = document.getElementById('hcYearSelect');
  if (!sel) return;
  var y = parseInt(sel.value, 10);
  if (!isNaN(y) && y !== hcSelectedYear) { hcSelectedYear = y; hcTablePage = 0; renderHarcamaMenu(); }
}

function hcSetMonth(i) {
  hcSelectedMonth = i === 0 ? null : i - 1;
  hcTablePage = 0;
  var btns = document.querySelectorAll('#hcControls .month-btn');
  for (var k = 0; k < btns.length; k++) {
    btns[k].classList.toggle('active', Number(btns[k].getAttribute('data-hc-month')) === i);
  }
  renderHarcamaMenu();
}

function hcGoToPage(p) {
  var pag = document.getElementById('hcPagination');
  var total = 0;
  if (pag) total = parseInt(pag.getAttribute('data-total'), 10) || 0;
  if (p < 1 || p > total) return;
  if (p - 1 !== hcTablePage) {
    hcTablePage = p - 1;
    const oranInput = document.getElementById('hcOran');
    const oran = parseFloat(oranInput && oranInput.value) || 0;
    const persOranInput = document.getElementById('hcPersonelOran');
    const persOran = parseFloat(persOranInput && persOranInput.value) || 0;
    renderHarcamaMenuTable(oran, persOran);
  }
}

function hcActiveRecords() {
  var year = hcSelectedYear === null ? hcDefaultYear() : hcSelectedYear;
  return records.filter(function (r) {
    var d = new Date(r.tarih + 'T12:00:00');
    if (isNaN(d)) return false;
    if (d.getFullYear() !== year) return false;
    if (hcSelectedMonth !== null && d.getMonth() !== hcSelectedMonth) return false;
    return true;
  });
}

function hcToplamPersonel(r) {
  return ((r.turnike || 0) - (r.ogrenci || 0)) + (r.personel || 0);
}

function hcUpdateNav() {
  renderHarcamaNav();
  var badge = document.getElementById('hcChartBadge');
  if (badge) {
    if (hcSelectedMonth === null) {
      badge.style.display = 'none';
    } else {
      badge.style.display = 'inline-flex';
      badge.textContent = HC_MONTHS_TR[hcSelectedMonth] + ' ' + hcSelectedYear;
    }
  }
  var persBadge = document.getElementById('hcPersonelChartBadge');
  if (persBadge) {
    if (hcSelectedMonth === null) {
      persBadge.style.display = 'none';
    } else {
      persBadge.style.display = 'inline-flex';
      persBadge.textContent = HC_MONTHS_TR[hcSelectedMonth] + ' ' + hcSelectedYear;
    }
  }
  var yemekBadge = document.getElementById('hcYemekChartBadge');
  if (yemekBadge) {
    if (hcSelectedMonth === null) {
      yemekBadge.style.display = 'none';
    } else {
      yemekBadge.style.display = 'inline-flex';
      yemekBadge.textContent = HC_MONTHS_TR[hcSelectedMonth] + ' ' + hcSelectedYear;
    }
  }
}

function canEditHarcamaOran() {
  var role = getRole();
  if (role === ROLE_ADMIN) return true;
  var perm = getRolePermissions(role);
  return !!(perm && perm.canEditHarcamaOran);
}

function canEditBirimFiyat() {
  var role = getRole();
  if (role === ROLE_ADMIN) return true;
  var perm = getRolePermissions(role);
  return !!(perm && perm.canEditBirimFiyat);
}

function hcKaydetOran() {
  if (!canEditHarcamaOran()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const input = document.getElementById('hcOran');
  const val = parseFloat(input && input.value);
  const status = document.getElementById('hcOranStatus');
  if (!status) return;
  if (!val || isNaN(val) || val <= 0) {
    status.textContent = 'Geçerli bir oran girin!';
    status.style.color = '#ef4444';
    return;
  }
  setOgrenciBasiHarcamaOrani(val);
  status.textContent = 'Oran kaydedildi: ' + val.toFixed(2) + ' ₺';
  status.style.color = '#22c55e';
  renderHarcamaMenu();
}

function hcKaydetPersonelOran() {
  if (!canEditHarcamaOran()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const input = document.getElementById('hcPersonelOran');
  const val = parseFloat(input && input.value);
  const status = document.getElementById('hcPersonelOranStatus');
  if (!status) return;
  if (!val || isNaN(val) || val <= 0) {
    status.textContent = 'Geçerli bir oran girin!';
    status.style.color = '#ef4444';
    return;
  }
  setPersonelBasiHarcamaOrani(val);
  status.textContent = 'Oran kaydedildi: ' + val.toFixed(2) + ' ₺';
  status.style.color = '#22c55e';
  renderHarcamaMenu();
}

function hcKaydetYemekOran() {
  if (!canEditHarcamaOran()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const input = document.getElementById('hcYemekOran');
  const val = parseFloat(input && input.value);
  const status = document.getElementById('hcYemekOranStatus');
  if (!status) return;
  if (!val || isNaN(val) || val <= 0) {
    status.textContent = 'Geçerli bir oran girin!';
    status.style.color = '#ef4444';
    return;
  }
  setUretilenYemekBasiHarcamaOrani(val);
  status.textContent = 'Oran kaydedildi: ' + val.toFixed(2) + ' ₺';
  status.style.color = '#22c55e';
  renderHarcamaMenu();
}

function printHarcama() {
  var oran = getOgrenciBasiHarcamaOrani();
  var persOran = getPersonelBasiHarcamaOrani();
  var yemekOran = getUretilenYemekBasiHarcamaOrani();

  var kpisHtml = document.getElementById('hcKpis') ? document.getElementById('hcKpis').innerHTML : '';

  var ogrImg = '';
  if (harcamaMenuChart) {
    var c1 = document.getElementById('canvasHarcamaMenu');
    if (c1) ogrImg = '<img src="' + c1.toDataURL('image/png') + '" style="max-width:100%;height:auto;margin:8px 0" />';
  }
  var persImg = '';
  if (harcamaPersonelChart) {
    var c2 = document.getElementById('canvasHarcamaPersonel');
    if (c2) persImg = '<img src="' + c2.toDataURL('image/png') + '" style="max-width:100%;height:auto;margin:8px 0" />';
  }
  var yemekImg = '';
  if (harcamaYemekChart) {
    var c3 = document.getElementById('canvasHarcamaYemek');
    if (c3) yemekImg = '<img src="' + c3.toDataURL('image/png') + '" style="max-width:100%;height:auto;margin:8px 0" />';
  }

  var sorted = hcActiveRecords().sort(function(a, b) { return new Date(b.tarih) - new Date(a.tarih); });
  var tl = function(v) { return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20BA'; };
  var rows = sorted.map(function(r) {
    var ogrTutar = (r.ogrenci || 0) * oran;
    var toplamP = hcToplamPersonel(r);
    var persTutar = toplamP * persOran;
    var uretilenYemek = (r.yemek || 0);
    var yemekTutar = uretilenYemek * yemekOran;
    return '<tr><td>' + displayDate(r.tarih) + '</td><td>' + (r.ogrenci || 0).toLocaleString('tr-TR') + '</td><td>' + tl(oran) + '</td><td>' + tl(ogrTutar) + '</td><td>' + toplamP.toLocaleString('tr-TR') + '</td><td>' + tl(persOran) + '</td><td>' + tl(persTutar) + '</td><td>' + uretilenYemek.toLocaleString('tr-TR') + '</td><td>' + tl(yemekTutar) + '</td></tr>';
  }).join('');

  var yearLabel = hcSelectedYear || new Date().getFullYear();
  var monthLabel = hcSelectedMonth !== null ? HC_MONTHS_TR[hcSelectedMonth] + ' ' + yearLabel : 'T\u00fcm Y\u0131l ' + yearLabel;

  var win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) { showToast('Pop-up engelleyiciyi kapat\u0131n.', 'error'); return; }
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Harcama Raporu - ' + monthLabel + '</title><style>');
  win.document.write('@page{size:landscape;margin:1cm}');
  win.document.write('body{font-family:Arial,sans-serif;padding:20px;margin:0;color:#1e293b}');
  win.document.write('h1{font-size:1.3rem;margin:0 0 2px}');
  win.document.write('.sub{font-size:0.8rem;color:#64748b;margin-bottom:1rem}');
  win.document.write('.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin:10px 0 16px}');
  win.document.write('.kpi-card{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px}');
  win.document.write('.kpi-icon{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;flex-shrink:0}');
  win.document.write('.kpi-icon svg{width:14px;height:14px}');
  win.document.write('.kpi-label{font-size:10px;color:#64748b;text-transform:uppercase;display:block}');
  win.document.write('.kpi-value{font-size:16px;font-weight:700;display:block;margin-top:2px}');
  win.document.write('.chart-title{font-size:0.9rem;font-weight:600;margin:16px 0 4px;color:#334155}');
  win.document.write('table{width:100%;border-collapse:collapse;font-size:0.75rem;margin-top:10px}');
  win.document.write('th{background:#f1f5f9;font-weight:600;padding:0.45rem 0.6rem;text-align:center;border:1px solid #ddd;font-size:0.7rem;text-transform:uppercase}');
  win.document.write('td{padding:0.35rem 0.6rem;border:1px solid #ddd;text-align:center}');
  win.document.write('tr:nth-child(even){background:#f8fafc}');
  win.document.write('.footer{text-align:center;font-size:0.75rem;color:#999;margin-top:2rem;border-top:1px solid #ddd;padding-top:0.5rem}');
  win.document.write('.chart-note{font-size:0.75rem;color:#64748b;margin:2px 0 6px}');
  win.document.write(harcamaHiddenCss());
  win.document.write('</style></head><body>');
  win.document.write('<h1>Harcama Hesaplama Raporu</h1>');
  win.document.write('<div class="sub">' + monthLabel + ' &mdash; \u00d6\u011fr. Ba\u015f\u0131: ' + tl(oran) + ' | Pers. Ba\u015f\u0131: ' + tl(persOran) + ' | Yemek Ba\u015f\u0131: ' + tl(yemekOran) + ' &mdash; ' + sorted.length + ' kay\u0131t</div>');
  win.document.write('<div class="kpi-grid">' + kpisHtml + '</div>');
  if (ogrImg) {
    win.document.write('<div class="chart-title">\u00d6\u011frenci Harcama Tutar\u0131 (\u20BA)</div>');
    win.document.write('<div class="chart-note">\u00d6\u011frenci Harcama = \u00d6\u011frenci Say\u0131s\u0131 \u00d7 \u00d6\u011frenci Ba\u015f\u0131 Harcama Tutar\u0131</div>');
    win.document.write(ogrImg);
  }
  if (persImg) {
    win.document.write('<div class="chart-title">Personel Harcama Tutar\u0131 (\u20BA)</div>');
    win.document.write('<div class="chart-note">Personel Harcama = Toplam Personel \u00d7 Personel Ba\u015f\u0131 Harcama Tutar\u0131</div>');
    win.document.write(persImg);
  }
  if (yemekImg) {
    win.document.write('<div class="chart-title">Yemek Harcama Tutar\u0131 (\u20BA)</div>');
    win.document.write('<div class="chart-note">Yemek Harcama = \u00dcret. Yemek Say\u0131s\u0131 \u00d7 Yemek Ba\u015f\u0131 Harcama Tutar\u0131</div>');
    win.document.write(yemekImg);
  }
  win.document.write('<div class="chart-title" style="margin-top:16px">Harcama Hesaplama Tablosu</div>');
  win.document.write('<table><thead><tr><th>Tarih</th><th>\u00d6\u011frenci Say\u0131s\u0131</th><th>\u00d6\u011fr. Oran\u0131 (\u20BA)</th><th>\u00d6\u011frenci Harcama (\u20BA)</th><th>Personel Say\u0131s\u0131</th><th>Pers. Oran\u0131 (\u20BA)</th><th>Personel Harcama (\u20BA)</th><th>\u00dcret. Yemek</th><th>Yemek Harcama (\u20BA)</th></tr></thead><tbody>' + rows + '</tbody></table>');
  win.document.write('<div class="footer">K\u0131r\u015fehir Ahi Evran \u00dcniversitesi &bull; Beslenme Hizmetleri &bull; ' + new Date().toLocaleDateString('tr-TR') + '</div>');
  win.document.write('</body></html>');
  win.document.close();
  triggerPrint(win);
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
        <thead><tr><th>Tarih</th><th>Üretim</th><th>Geçiş</th><th>Atık</th><th>Öğrenci</th>${canSeeHarcama() ? '<th>Harcama</th>' : ''}<th>Yemek Türü</th></tr></thead>
        <tbody>${records.slice(0, 100).map(r => `<tr>
          <td>${displayDate(r.tarih)}</td>
          <td>${r.yemek || '—'}</td>
          <td>${r.toplam || '—'}</td>
          <td>${(r.atik||0).toFixed(1)}</td>
          <td>${r.ogrenci || '—'}</td>
          ${canSeeHarcama() ? `<td>${Number(r.harcama_tutari || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺</td>` : ''}
          <td>${r.yemek_adi || '—'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  }
  if (footer) footer.innerHTML = '<button class="btn btn-primary" onclick="closeModal()">Kapat</button>';
  overlay.style.display = 'flex';
}

// ─── MENÜ ONAY AKIŞI (Diyetisyen → Gıda Mühendisi/Admin) ─────────────────────
const MENU_DURUMLAR = { TASLAK: 'taslak', ONAY_BEKLIYOR: 'onay_bekliyor', ONAYLANDI: 'onaylandi', REDDEDILDI: 'reddedildi' };
let currentMenuDurumMeta = null;

function menuDurumLabel(durum) {
  const m = { taslak: 'Taslak', onay_bekliyor: 'Onay Bekliyor', onaylandi: 'Onaylandı', reddedildi: 'Reddedildi' };
  return m[durum] || 'Taslak';
}

function getMenuDurumMeta(weekData) {
  const d = (weekData && weekData._durum) || {};
  return {
    durum: d.durum || MENU_DURUMLAR.TASLAK,
    onaylayan: d.onaylayan || '',
    onay_tarihi: d.onay_tarihi || '',
    onay_notu: d.onay_notu || ''
  };
}

function canMenuOnayla() {
  const role = getRole();
  if (role === ROLE_ADMIN) return true;
  const perm = getRolePermissions(role);
  return !!(perm && perm.canMenuOnayla);
}

function canMenuReddet() {
  const role = getRole();
  if (role === ROLE_ADMIN) return true;
  const perm = getRolePermissions(role);
  return !!(perm && perm.canMenuReddet);
}

function canMenuOnayaGonder() {
  const role = getRole();
  if (role === ROLE_ADMIN) return true;
  const perm = getRolePermissions(role);
  return !!(perm && perm.canMenuOnayaGonder);
}

function canMenuDuzenle(durum) {
  const role = getRole();
  if (role !== ROLE_ADMIN && role !== ROLE_DIYETISYEN) return false;
  return durum === MENU_DURUMLAR.TASLAK || durum === MENU_DURUMLAR.REDDEDILDI;
}

async function getCurrentWeekContext() {
  const monday = getWeekStartDate(menuWeekOffset);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const weekKey = formatDateStr(monday) + '-' + formatDateStr(friday);
  const allData = await fetchMenuData();
  return { weekKey: weekKey, allData: allData, weekData: allData[weekKey] || {} };
}

function collectMenuWeekFromDOM() {
  const monday = getWeekStartDate(menuWeekOffset);
  const weekData = {};
  getGUNLER().forEach((_, i) => {
    const tarih = new Date(monday);
    tarih.setDate(monday.getDate() + i);
    const key = formatDateStr(tarih);
    const yemekler = [];
    for (let c = 0; c < 5; c++) {
      const el = document.getElementById('m' + c + '_' + i);
      yemekler.push(el ? el.textContent : '');
    }
    const notlar = [];
    for (let n = 0; n < 10; n++) {
      const el = document.getElementById('mn_' + n + '_' + i);
      notlar.push(el ? el.value : '');
    }
    const kisi = parseInt(document.getElementById('mk_' + i).value) || 0;
    weekData[key] = { yemekler: yemekler, kisi: kisi, notlar: notlar };
  });
  return weekData;
}

async function menuOnayaGonder() {
  if (!canMenuOnayaGonder()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const ctx = await getCurrentWeekContext();
  const meta = getMenuDurumMeta(ctx.weekData);
  if (meta.durum !== MENU_DURUMLAR.TASLAK && meta.durum !== MENU_DURUMLAR.REDDEDILDI) {
    showToast('Menü zaten onay sürecinde veya onaylanmış. Onayı kaldırmadan gönderemezsiniz.', 'error');
    return;
  }
  const weekData = collectMenuWeekFromDOM();
  weekData._durum = { durum: MENU_DURUMLAR.ONAY_BEKLIYOR, onaylayan: '', onay_tarihi: '', onay_notu: '' };
  ctx.allData[ctx.weekKey] = weekData;
  await saveMenuData(ctx.allData);
  logIslem('menu_onaya_gonder', sessionStorage.getItem('atik_kontrol_display_name') + ' ' + ctx.weekKey + ' menüsünü onaya gönderdi');
  showToast('Menü onaya gönderildi. Gıda Mühendisi/Admin onayı bekleniyor.', 'success');
  await renderMenu();
}

async function menuOnayla() {
  if (!canMenuOnayla()) { showToast('Bu işlem için gıda mühendisi veya admin yetkisi gerekli.', 'error'); return; }
  const ctx = await getCurrentWeekContext();
  const meta = getMenuDurumMeta(ctx.weekData);
  if (meta.durum !== MENU_DURUMLAR.ONAY_BEKLIYOR) {
    showToast('Onaylanacak bekleyen menü yok (durum: ' + menuDurumLabel(meta.durum) + ').', 'error');
    return;
  }
  const displayName = sessionStorage.getItem('atik_kontrol_display_name') || getRole();
  ctx.weekData._durum = { durum: MENU_DURUMLAR.ONAYLANDI, onaylayan: displayName, onay_tarihi: new Date().toISOString(), onay_notu: '' };
  ctx.allData[ctx.weekKey] = ctx.weekData;
  await saveMenuData(ctx.allData);
  logIslem('menu_onayla', displayName + ' ' + ctx.weekKey + ' menüsünü onayladı');
  showToast('Menü onaylandı.', 'success');
  await renderMenu();
}

function menuReddet() {
  if (!canMenuReddet()) { showToast('Bu işlem için menü reddetme yetkisi gerekli.', 'error'); return; }
  document.getElementById('menuRedNotu').value = '';
  document.getElementById('menuRedError').style.display = 'none';
  document.getElementById('menuRedModal').classList.add('open');
}

function menuRedOnayla() {
  const not = (document.getElementById('menuRedNotu').value || '').trim();
  if (!not) { document.getElementById('menuRedError').style.display = 'block'; return; }
  document.getElementById('menuRedModal').classList.remove('open');
  menuReddetApply(not);
}

async function menuReddetApply(not) {
  const ctx = await getCurrentWeekContext();
  const meta = getMenuDurumMeta(ctx.weekData);
  if (meta.durum !== MENU_DURUMLAR.ONAY_BEKLIYOR) {
    showToast('Menü bekleyen durumda değil.', 'error');
    return;
  }
  const displayName = sessionStorage.getItem('atik_kontrol_display_name') || getRole();
  ctx.weekData._durum = { durum: MENU_DURUMLAR.REDDEDILDI, onaylayan: displayName, onay_tarihi: new Date().toISOString(), onay_notu: not };
  ctx.allData[ctx.weekKey] = ctx.weekData;
  await saveMenuData(ctx.allData);
  logIslem('menu_reddet', displayName + ' ' + ctx.weekKey + ' menüsünü reddetti: ' + not);
  showToast('Menü gerekçeli olarak reddedildi.', 'success');
  await renderMenu();
}

async function menuOnayGeriCek() {
  if (getRole() !== ROLE_ADMIN) { showToast('Bu işlem için admin yetkisi gerekli.', 'error'); return; }
  if (!confirm('Menünün onayı kaldırılsın mı? Tekrar düzenleme ve onaya gönderme mümkün olacak.')) return;
  const ctx = await getCurrentWeekContext();
  const meta = getMenuDurumMeta(ctx.weekData);
  if (meta.durum !== MENU_DURUMLAR.ONAYLANDI && meta.durum !== MENU_DURUMLAR.ONAY_BEKLIYOR) {
    showToast('Onayı kaldırılacak bir durum yok.', 'error');
    return;
  }
  ctx.weekData._durum = { durum: MENU_DURUMLAR.TASLAK, onaylayan: '', onay_tarihi: '', onay_notu: '' };
  ctx.allData[ctx.weekKey] = ctx.weekData;
  await saveMenuData(ctx.allData);
  logIslem('menu_onay_kaldir', sessionStorage.getItem('atik_kontrol_display_name') + ' ' + ctx.weekKey + ' menüsünün onayını kaldırdı');
  showToast('Onay kaldırıldı, menü düzenlemeye açık.', 'success');
  await renderMenu();
}

async function menuOnayBildirim() {
  if (!canMenuOnayla() || !supabaseClient) return;
  try {
    const allData = await fetchMenuData();
    const bekleyen = Object.keys(allData).filter(function(k) {
      return getMenuDurumMeta(allData[k]).durum === MENU_DURUMLAR.ONAY_BEKLIYOR;
    });
    if (bekleyen.length > 0) {
      showToast(bekleyen.length + ' haftanın menüsü onay bekliyor.', 'info');
    }
  } catch (_) {}
}

function renderMenuDurumBar(durumMeta, pendingCount) {
  const role = getRole();
  const badge = document.getElementById('menuDurumBadge');
  const warn = document.getElementById('menuOnayUyari');
  const warnMetin = document.getElementById('menuOnayUyariMetin');
  const pendingGoBtn = document.getElementById('menuPendingGoBtn');

  let badgeClass = 'badge';
  if (durumMeta.durum === MENU_DURUMLAR.ONAYLANDI) badgeClass += ' badge-ok';
  else if (durumMeta.durum === MENU_DURUMLAR.ONAY_BEKLIYOR) badgeClass += ' badge-warn';
  else if (durumMeta.durum === MENU_DURUMLAR.REDDEDILDI) badgeClass += ' badge-err';

  let badgeText = menuDurumLabel(durumMeta.durum);
  if (durumMeta.onaylayan && (durumMeta.durum === MENU_DURUMLAR.ONAYLANDI || durumMeta.durum === MENU_DURUMLAR.REDDEDILDI)) {
    badgeText += ' · ' + durumMeta.onaylayan;
  }
  if (badge) {
    badge.className = badgeClass;
    badge.textContent = badgeText;
    badge.style.display = '';
  }

  const canEdit = canMenuDuzenle(durumMeta.durum);
  const durumDuzeltilebilir = durumMeta.durum === MENU_DURUMLAR.TASLAK || durumMeta.durum === MENU_DURUMLAR.REDDEDILDI;
  const saveBtn = document.getElementById('menuSaveBtn');
  const clearBtn = document.getElementById('menuClearBtn');
  const sendBtn = document.getElementById('menuSendBtn');
  const approveBtn = document.getElementById('menuApproveBtn');
  const rejectBtn = document.getElementById('menuRejectBtn');
  const withdrawBtn = document.getElementById('menuWithdrawBtn');

  if (saveBtn) saveBtn.style.display = (role === ROLE_ADMIN || role === ROLE_DIYETISYEN) && durumDuzeltilebilir ? '' : 'none';
  if (clearBtn) clearBtn.style.display = role === ROLE_ADMIN && canEdit ? '' : 'none';
  if (sendBtn) sendBtn.style.display = canMenuOnayaGonder() && durumDuzeltilebilir ? '' : 'none';
  if (approveBtn) {
    approveBtn.style.display = canMenuOnayla() ? '' : 'none';
    approveBtn.disabled = durumMeta.durum !== MENU_DURUMLAR.ONAY_BEKLIYOR;
    approveBtn.title = durumMeta.durum === MENU_DURUMLAR.ONAY_BEKLIYOR
      ? 'Menüyü onayla'
      : 'Menü henüz onaya gönderilmedi. Diyetisyen "Onaya Gönder"e bastığında buradan onaylayabilirsiniz.';
  }
  if (rejectBtn) {
    rejectBtn.style.display = canMenuReddet() ? '' : 'none';
    rejectBtn.disabled = durumMeta.durum !== MENU_DURUMLAR.ONAY_BEKLIYOR;
    rejectBtn.title = durumMeta.durum === MENU_DURUMLAR.ONAY_BEKLIYOR
      ? 'Menüyü gerekçeli olarak reddet'
      : 'Menü henüz onaya gönderilmedi. Diyetisyen "Onaya Gönder"e bastığında buradan reddedebilirsiniz.';
  }
  if (withdrawBtn) withdrawBtn.style.display = role === ROLE_ADMIN && (durumMeta.durum === MENU_DURUMLAR.ONAYLANDI || durumMeta.durum === MENU_DURUMLAR.ONAY_BEKLIYOR) ? '' : 'none';

  if (warn) {
    const isApprover = canMenuOnayla();
    const isCurrentPending = durumMeta.durum === MENU_DURUMLAR.ONAY_BEKLIYOR;
    if (isApprover && !isCurrentPending && pendingCount > 0) {
      warn.style.display = '';
      if (warnMetin) warnMetin.textContent = pendingCount + ' haftanın menüsü onay bekliyor. Bekleyen haftaya gidip onaylayabilirsiniz.';
      if (pendingGoBtn) pendingGoBtn.style.display = '';
    } else {
      if (pendingGoBtn) pendingGoBtn.style.display = 'none';
      if (durumMeta.durum === MENU_DURUMLAR.ONAYLANDI) {
        warn.style.display = 'none';
      } else {
        warn.style.display = '';
        let metin = 'Bu haftanın menüsü henüz gıda mühendisi tarafından onaylanmadı.';
        if (durumMeta.durum === MENU_DURUMLAR.REDDEDILDI) {
          metin = 'Bu menü reddedildi' + (durumMeta.onaylayan ? ' (' + durumMeta.onaylayan + ')' : '');
          if (durumMeta.onay_notu) metin += ': ' + durumMeta.onay_notu;
          metin += '. Diyetisyen düzelttikten sonra yeniden onaya gönderebilir.';
        } else if (durumMeta.durum === MENU_DURUMLAR.ONAY_BEKLIYOR) {
          metin = 'Bu menü onay bekliyor. Onaylanmadan üretim listesinde "onaysız" olarak işaretlenir.';
        }
        if (warnMetin) warnMetin.textContent = metin;
      }
    }
  }
  return canEdit;
}

function menuGecBekleyenHafta() {
  fetchMenuData().then(function(allData) {
    var pending = Object.keys(allData).filter(function(k) {
      return getMenuDurumMeta(allData[k]).durum === MENU_DURUMLAR.ONAY_BEKLIYOR;
    });
    if (!pending.length) return;
    var base = formatDateStr(getWeekStartDate(menuWeekOffset));
    var best = null;
    pending.forEach(function(k) {
      var start = k.split('-').slice(0, 3).join('-');
      var diff = Math.round((new Date(start + 'T12:00:00') - new Date(base + 'T12:00:00')) / 86400000);
      var abs = Math.abs(diff);
      if (best === null || abs < best.abs) best = { abs: abs, diff: diff };
    });
    if (best === null) return;
    menuWeekOffset += best.diff / 7;
    renderMenu();
  });
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
  currentMenuDurumMeta = getMenuDurumMeta(weekData);
  const pendingCount = Object.keys(allData).filter(function(k) {
    return getMenuDurumMeta(allData[k]).durum === MENU_DURUMLAR.ONAY_BEKLIYOR;
  }).length;
  const canEdit = renderMenuDurumBar(currentMenuDurumMeta, pendingCount);

  // Gün verilerini topla
  const days = getGUNLER().map((gun, i) => {
    const tarih = new Date(monday);
    tarih.setDate(monday.getDate() + i);
    const key = formatDateStr(tarih);
    var dd = weekData[key] || { yemekler: ['','','','',''], kisi: 0, notlar: [] };
    while (dd.notlar.length < 10) dd.notlar.push('');
    const dayData = dd;
    return { gun, key, tarih, data: dayData };
  });

  // Başlık satırı
  const thead = document.getElementById('menuThead');
  thead.innerHTML = `<tr>
    <th style="width:100px">${t('menuVariety')}</th>
    ${days.map(d => `<th>${escapeHtml(d.gun)}<br><span style="display:inline-block;margin-top:0.3rem;font-size:0.74rem;font-weight:800;background:linear-gradient(135deg,var(--accent-purple),var(--accent-cyan));color:#fff;padding:0.18rem 0.65rem;border-radius:999px;box-shadow:0 2px 6px rgba(99,102,241,0.3)">${formatDateStrTR(d.tarih)}</span></th>`).join('')}
  </tr>`;

  // Cache henüz dolmamışsa 500ms sonra tekrar dene
  if (!yemeklerCache.length) {
    if (window._menuRetryTimer) clearTimeout(window._menuRetryTimer);
    window._menuRetryTimer = setTimeout(refreshMenuProduction, 500);
  }

  // Gövde: her çeşit için bir satır + kişi sayısı satırı
  const cesitler = [t('menuVariety1'), t('menuVariety2'), t('menuVariety3'), t('menuVariety4'), t('menuVariety5')];
  const tbody = document.getElementById('menuTbody');
  tbody.innerHTML = cesitler.map((label, ci) => {
    return `<tr>
      <td><strong>${label}</strong></td>
      ${days.map((d, di) => {
        const val = escapeHtml(d.data.yemekler[ci] || '');
        return `<td><div class="menu-cell-pick" id="m${ci}_${di}" data-ci="${ci}" data-di="${di}" style="min-height:50px;padding:5px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:0.82rem;cursor:pointer;white-space:pre-wrap;word-break:break-word;overflow:hidden">${val || '<span style="color:var(--text-muted);opacity:0.5">' + escapeHtml(label) + '</span>'}</div></td>`;
      }).join('')}
    </tr>`;
  }).join('') + `<tr style="pointer-events:none"><td colspan="6" style="height:8px;padding:0;border:none;background:var(--bg-card)"></td></tr>` + `<tr onclick="event.stopPropagation()">
    <td><strong>${t('menuPersonCount')}</strong></td>
    ${days.map((d, di) => {
      return `<td><input type="number" class="kisi-input" id="mk_${di}" value="${Number(d.data.kisi) || 0}" min="0" placeholder="0" oninput="refreshMenuProduction()" onclick="event.stopPropagation()" /></td>`;
    }).join('')}
  </tr>`;
  // Not satırları: sadece visibleNoteCount kadar göster
  let visibleNoteCount = window._menuNoteCount || 1;
  // Kaydedilmiş notlar varsa, onları da göster
  days.forEach(d => {
    if (d.data.notlar) {
      for (let i = 0; i < d.data.notlar.length; i++) {
        if (d.data.notlar[i] && i + 1 > visibleNoteCount) {
          visibleNoteCount = i + 1;
        }
      }
    }
  });
  window._menuNoteCount = visibleNoteCount;
  for (let ni = 0; ni < visibleNoteCount; ni++) {
    let tr = document.createElement('tr');
    tr.id = 'noteRow_' + ni;
    tr.onclick = function(e) { e.stopPropagation(); };
    tr.innerHTML = `<td onclick="event.stopPropagation()" onpointerdown="event.stopPropagation()"><strong>Not ${ni + 1}</strong>
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();removeNoteRow(${ni})" title="Bu notu sil" style="font-size:0.8rem;padding:0 0.3rem;line-height:1;margin-left:4px;color:var(--accent-red);${visibleNoteCount <= 1 ? 'display:none' : ''}">−</button>
    </td>
      ${days.map((d, di) => {
        const val = escapeHtml((d.data.notlar && d.data.notlar[ni]) || '');
        return `<td onclick="event.stopPropagation()" onpointerdown="event.stopPropagation()"><textarea class="note-input" id="mn_${ni}_${di}" rows="1" placeholder="..." onclick="event.stopPropagation()" onfocus="event.stopPropagation()" onpointerdown="event.stopPropagation()" style="touch-action:manipulation">${val}</textarea></td>`;
      }).join('')}`;
    tbody.appendChild(tr);
  }
  // + butonu satırı
  let addRow = document.createElement('tr');
  addRow.id = 'noteAddRow';
  addRow.onclick = function(e) { e.stopPropagation(); };
  addRow.innerHTML = `<td style="vertical-align:middle">
    <button class="btn btn-ghost btn-sm" onclick="addNoteRow()" title="Yeni not ekle" style="font-size:1.1rem;padding:0.2rem 0.6rem;line-height:1">+</button>
  </td>
  ${days.map(() => `<td></td>`).join('')}`;
  tbody.appendChild(addRow);
  // yemek seçici: her hücreye doğrudan listener + event delegation
  if (canEdit) {
    for (let ci = 0; ci < 5; ci++) {
      for (let ci2 = 0; ci2 < 5; ci2++) {
        const cell = document.getElementById('m' + ci + '_' + ci2);
        if (cell && !cell._pickerAttached) {
          cell.addEventListener('click', function(e) {
            e.stopPropagation();
            _pickerCi = ci;
            _pickerDi = ci2;
            openMealPicker();
          });
          cell._pickerAttached = true;
        }
      }
    }
  }
  // Menü kilitliyse düzenleme engellensin
  if (!canEdit) {
    for (let ci = 0; ci < 5; ci++) {
      for (let di = 0; di < 5; di++) {
        const cell = document.getElementById('m' + ci + '_' + di);
        if (cell) { cell.style.cursor = 'default'; cell.style.pointerEvents = 'none'; }
      }
    }
    getGUNLER().forEach((_, i) => {
      const k = document.getElementById('mk_' + i);
      if (k) k.disabled = true;
      for (let n = 0; n < 10; n++) {
        const el = document.getElementById('mn_' + n + '_' + i);
        if (el) el.disabled = true;
      }
    });
    const addRow = document.getElementById('noteAddRow');
    if (addRow) addRow.style.display = 'none';
  }
  renderProduction(weekKey, weekData, days);
  applyViewerRestrictions();
  applyRolePermissions();
}

let _pickerCi = 0, _pickerDi = 0;

async function openMealPicker() {
  let list = loadYemekler();
  if (!list.length) {
    await syncDishesFromSupabase();
    list = loadYemekler();
  }
  if (!list.length) { showToast('Yemek listesi boş. Önce Yemek Listesi\'ne CSV yükleyin.', 'warning'); return; }
  const cell = document.getElementById('m' + _pickerCi + '_' + _pickerDi);
  const mevcut = cell ? cell.textContent.trim().split('\n')[0] : '';
  // picker overlay
  let overlay = document.getElementById('mealPickerOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'mealPickerOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    overlay.addEventListener('click', function(ev) { if (ev.target === this) this.style.display = 'none'; });
    document.body.appendChild(overlay);
  }
  const html = `<div style="background:var(--bg-card);border-radius:12px;padding:1.5rem;max-width:500px;width:90%;max-height:80vh;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
      <h3 style="font-size:1rem;font-weight:600">Yemek Seç</h3>
      <div style="display:flex;gap:0.5rem;align-items:center">
        <button class="btn btn-sm" style="background:var(--color-danger, #e53e3e);color:#fff;border:none;padding:0.3rem 0.6rem;border-radius:6px;cursor:pointer;font-size:0.78rem" onclick="clearMenuCell()">🗑 Temizle</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('mealPickerOverlay').style.display='none'">✕</button>
      </div>
    </div>
    <input type="text" id="mealPickerSearch" placeholder="Yemek ara..." style="padding:0.5rem;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);margin-bottom:0.75rem" oninput="renderMealPickerList()" />
    <div id="mealPickerList" style="overflow-y:auto;flex:1">${list.map(y => `<div class="meal-picker-item" data-ad="${escapeHtml(y.ad)}" style="padding:0.5rem 0.75rem;cursor:pointer;border-radius:6px;transition:background 0.15s" onclick="selectMealFromPicker(this)" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='transparent'">${escapeHtml(formatYemek(y).replace(/\n/g, '<br>'))}</div>`).join('')}</div>
  </div>`;
  overlay.innerHTML = html;
  overlay.style.display = 'flex';
  setTimeout(function() {
    const inp = document.getElementById('mealPickerSearch');
    if (inp) { inp.focus(); inp.value = ''; renderMealPickerList(); }
  }, 100);
}

function renderMealPickerList() {
  const list = loadYemekler();
  const q = (document.getElementById('mealPickerSearch').value || '').toLowerCase();
  const container = document.getElementById('mealPickerList');
  if (!container) return;
  const filtered = q ? list.filter(y => y.ad.toLowerCase().includes(q)) : list;
  container.innerHTML = filtered.length ? filtered.map(y => `<div class="meal-picker-item" data-ad="${escapeHtml(y.ad)}" style="padding:0.5rem 0.75rem;cursor:pointer;border-radius:6px;transition:background 0.15s" onclick="selectMealFromPicker(this)" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='transparent'">${escapeHtml(formatYemek(y).replace(/\n/g, '<br>'))}</div>`).join('') : '<div style="padding:1rem;text-align:center;color:var(--text-muted)">Eşleşen yemek bulunamadı.</div>';
}

function selectMealFromPicker(el) {
  const ad = el.getAttribute('data-ad');
  if (!ad) return;
  const list = loadYemekler();
  const y = list.find(i => i.ad === ad);
  if (!y) return;
  const cell = document.getElementById('m' + _pickerCi + '_' + _pickerDi);
  if (cell) {
    cell.textContent = formatYemek(y);
    refreshMenuProduction();
  }
  document.getElementById('mealPickerOverlay').style.display = 'none';
}

function clearMenuCell() {
  const cell = document.getElementById('m' + _pickerCi + '_' + _pickerDi);
  if (cell) {
    cell.textContent = '';
    refreshMenuProduction();
  }
  document.getElementById('mealPickerOverlay').style.display = 'none';
}

function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
}

// ─── MENU HELPERS ──────────────────────────────────────────────────────────
const GUNLER_TR = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
function getGUNLER() { return t('dayNames'); }
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

async function saveWeeklyMenu() {
  var role = getRole();
  if (role !== ROLE_ADMIN && role !== ROLE_DIYETISYEN) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const ctx = await getCurrentWeekContext();
  const meta = getMenuDurumMeta(ctx.weekData);
  if (!canMenuDuzenle(meta.durum)) {
    showToast('Menü onay sürecinde; düzenlemek için önce onayı kaldırın.', 'error');
    return;
  }
  const weekData = collectMenuWeekFromDOM();
  // Kaydet: durum zaten reddedildiyse gerekçe korunsun, değilse taslak olarak kaydet
  weekData._durum = meta.durum === MENU_DURUMLAR.REDDEDILDI
    ? { durum: MENU_DURUMLAR.REDDEDILDI, onaylayan: meta.onaylayan, onay_tarihi: meta.onay_tarihi, onay_notu: meta.onay_notu }
    : { durum: MENU_DURUMLAR.TASLAK, onaylayan: '', onay_tarihi: '', onay_notu: '' };
  ctx.allData[ctx.weekKey] = weekData;
  await saveMenuData(ctx.allData);
  showToast('Menü taslak olarak kaydedildi.', 'success');
  await renderMenu();
}

async function shiftMenuWeek(delta) {
  menuWeekOffset += delta;
  await renderMenu();
}

function addNoteRow() {
  const ni = window._menuNoteCount || 1;
  const tbody = document.getElementById('menuTbody');
  const tr = document.createElement('tr');
  tr.id = 'noteRow_' + ni;
  tr.onclick = function(e) { e.stopPropagation(); };
  tr.innerHTML = `<td><strong>Not ${ni + 1}</strong>
    <button class="btn btn-ghost btn-sm" onclick="removeNoteRow(${ni})" title="Bu notu sil" style="font-size:0.8rem;padding:0 0.3rem;line-height:1;margin-left:4px;color:var(--accent-red)">−</button>
  </td>
    ${getGUNLER().map((_, di) => `<td><textarea class="note-input" id="mn_${ni}_${di}" rows="1" placeholder="..." onclick="event.stopPropagation()" onfocus="event.stopPropagation()" onpointerdown="event.stopPropagation()" style="touch-action:manipulation"></textarea></td>`).join('')}`;
  const addRow = document.getElementById('noteAddRow');
  if (addRow) tbody.insertBefore(tr, addRow);
  window._menuNoteCount = ni + 1;
  // İlk not satırındaki eksi butonunu göster (gizliydi)
  const firstRow = document.getElementById('noteRow_0');
  if (firstRow) {
    const btn = firstRow.querySelector('button');
    if (btn) btn.style.display = '';
  }
  showToast('Not ' + (ni + 1) + ' eklendi.', 'success');
}

function removeNoteRow(ni) {
  if ((window._menuNoteCount || 1) <= 1) return;
  const tbody = document.getElementById('menuTbody');
  // Değerleri kaydır: silinen nottan sonrakileri bir üst satıra taşı
  for (let n = ni + 1; n < (window._menuNoteCount || 1); n++) {
    getGUNLER().forEach((_, di) => {
      const fromEl = document.getElementById('mn_' + n + '_' + di);
      const toEl = document.getElementById('mn_' + (n - 1) + '_' + di);
      if (fromEl && toEl) toEl.value = fromEl.value;
    });
  }
  // En son satırı sil
  const lastRow = document.getElementById('noteRow_' + ((window._menuNoteCount || 1) - 1));
  if (lastRow) lastRow.remove();
  window._menuNoteCount--;
  // Sadece 1 not kaldıysa eksi butonunu gizle
  if (window._menuNoteCount <= 1) {
    const firstRow = document.getElementById('noteRow_0');
    if (firstRow) {
      const btn = firstRow.querySelector('button');
      if (btn) btn.style.display = 'none';
    }
  }
  showToast('Not ' + (ni + 1) + ' silindi.', 'success');
}

function clearWeeklyMenu() { if (!canEditMenuRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  if (!confirm('Bu haftanın menüsünü temizlemek istediğinize emin misiniz?')) return;
  const monday = getWeekStartDate(menuWeekOffset);
  getGUNLER().forEach((_, i) => {
    for (let c = 0; c < 5; c++) {
      const el = document.getElementById('m' + c + '_' + i);
      if (el) el.textContent = '';
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
  if (!allData || Object.keys(allData).length === 0) return;
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

function importMenuCSV(event) { if (!requireAdmin()) return;
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      const text = ev.target.result;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) throw new Error('CSV en az 2 satır içermelidir (başlık + veri)');
      const headers = parseCSVLine(lines[0]);
      // gün sütunlarını bul (Pazartesi, Salı, ...)
      const gunIdxMap = {};
      getGUNLER().forEach((gun, i) => {
        const idx = headers.findIndex(h => h.toLowerCase().includes(gun.slice(0,3).toLowerCase()) || gun.toLowerCase().includes(h.toLowerCase()));
        if (idx !== -1) gunIdxMap[i] = idx;
      });
      if (!Object.keys(gunIdxMap).length) throw new Error('Gün sütunları bulunamadı (Pazartesi, Salı, ...)');
      const cesitSatirlari = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
      let kisiSatir = -1;
      for (let r = 1; r < lines.length; r++) {
        const cols = parseCSVLine(lines[r]);
        const ilkHuc = (cols[0] || '').trim().toLowerCase();
        for (let c = 1; c <= 5; c++) {
          if (new RegExp('^\\s*' + c + '\\s*\\.?\\s*çeşit','i').test(ilkHuc) || new RegExp('^\\s*' + c + '\\s*\\.?\\s*cesit','i').test(ilkHuc)) {
            cesitSatirlari[String(c)] = r;
          }
        }
        if (/kişi|kisi/.test(ilkHuc)) kisiSatir = r;
      }
      // şu anki görünen haftanın tarihlerini al
      const monday = getWeekStartDate(menuWeekOffset);
      const allData = await fetchMenuData();
      const weekKey = formatDateStr(monday) + '-' + formatDateStr(new Date(monday.getTime() + 4*86400000));
      if (!allData[weekKey]) allData[weekKey] = {};
      getGUNLER().forEach((_, i) => {
        const tarih = new Date(monday);
        tarih.setDate(monday.getDate() + i);
        const key = formatDateStr(tarih);
        const gunIdx = gunIdxMap[i];
        if (gunIdx === undefined) return;
        if (!allData[weekKey][key]) allData[weekKey][key] = { yemekler: ['','','','',''], kisi: 0, notlar: [] };
        const row = allData[weekKey][key];
        for (let c = 1; c <= 5; c++) {
          const satir = cesitSatirlari[String(c)];
          if (satir > 0 && satir < lines.length) {
            const cols = parseCSVLine(lines[satir]);
            if (gunIdx < cols.length) row.yemekler[c-1] = (cols[gunIdx] || '').trim();
          }
        }
        if (kisiSatir > 0 && kisiSatir < lines.length) {
          const cols = parseCSVLine(lines[kisiSatir]);
          if (gunIdx < cols.length) row.kisi = parseInt(cols[gunIdx]) || 0;
        }
      });
      await saveMenuData(allData);
      await renderMenu();
      showToast('CSV menü yüklendi.', 'success');
    } catch (err) {
      showToast('CSV yükleme hatası: ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
  event.target.value = '';
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ─── ATIK YAG (WASTE OIL) ────────────────────────────────────────────────────
const YAG_STORAGE_KEY = 'atik_kontrol_yag';
let yagRecords = [];
let editingYagId = null;
let yagPage = 0;
const YAG_PAGE_SIZE = 10;

function loadYagData() {
  try {
    var stored = sessionStorage.getItem(YAG_STORAGE_KEY);
    if (stored) {
      yagRecords = JSON.parse(stored);
    } else {
      stored = localStorage.getItem(YAG_STORAGE_KEY);
      if (stored) {
        yagRecords = JSON.parse(stored);
        try { sessionStorage.setItem(YAG_STORAGE_KEY, stored); } catch (_) {}
        try { localStorage.removeItem(YAG_STORAGE_KEY); } catch (_) {}
      } else {
        yagRecords = [];
      }
    }
  } catch (_) { yagRecords = []; }
  yagRecords.forEach(function(r) { if (r.tarih) r.tarih = normalizeDate(r.tarih); });
}

function saveYagData() {
  try { sessionStorage.setItem(YAG_STORAGE_KEY, JSON.stringify(yagRecords)); } catch (_) {}
}

function renderYagOzet(list) {
  const grid = document.getElementById('yagOzetGrid');
  if (!grid) return;
  const adet = list.length;
  const toplam = list.reduce((s, r) => s + (Number(r.miktar) || 0), 0);
  const ort = adet ? toplam / adet : 0;
  const maxR = adet ? Math.max(...list.map(r => Number(r.miktar) || 0)) : 0;
  const minR = adet ? Math.min(...list.map(r => Number(r.miktar) || 0)) : 0;
  const turler = new Set(list.map(r => r.tur).filter(Boolean));
  const yilToplam = {};
  list.forEach(r => {
    const y = new Date(r.tarih + 'T12:00:00').getFullYear();
    if (!isNaN(y)) yilToplam[y] = (yilToplam[y] || 0) + (Number(r.miktar) || 0);
  });
  const yillar = Object.keys(yilToplam).sort();
  const fmt = (v) => v.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' lt';
  let html = `
    <div class="report-item">
      <span class="report-label">Toplam Kayıt</span>
      <span class="report-value">${adet.toLocaleString('tr-TR')}</span>
    </div>
    <div class="report-item report-item-highlight" style="background: rgba(249,115,22,0.08); border-color: rgba(249,115,22,0.25);">
      <span class="report-label">Toplam Atık Yağ</span>
      <span class="report-value" style="color:#f97316">${fmt(toplam)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">Ort. Miktar / Kayıt</span>
      <span class="report-value">${fmt(ort)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">En Yüksek Miktar</span>
      <span class="report-value">${fmt(maxR)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">En Düşük Miktar</span>
      <span class="report-value">${fmt(minR)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">Yağ Türü Çeşidi</span>
      <span class="report-value">${turler.size.toLocaleString('tr-TR')}</span>
    </div>
  `;
  const simdikiYil = String(new Date().getFullYear());
  yillar.forEach(y => {
    if (y !== simdikiYil) return;
    html += `
    <div class="report-item">
      <span class="report-label">${y} Toplam</span>
      <span class="report-value" style="color:var(--accent)">${fmt(yilToplam[y])}</span>
    </div>`;
  });
  grid.innerHTML = html;
}

function getYagBaseFiltered() {
  let f = [...yagRecords];
  var bas = document.getElementById('yagTarihBas');
  var bit = document.getElementById('yagTarihBit');
  var tur = document.getElementById('yagTurFilter');
  if (bas && bas.value) f = f.filter(function(r) { return r.tarih >= bas.value; });
  if (bit && bit.value) f = f.filter(function(r) { return r.tarih <= bit.value; });
  if (tur && tur.value) f = f.filter(function(r) { return r.tur === tur.value; });
  return f;
}

function getYagFiltered() {
  let f = getYagBaseFiltered();
  if (yagSelectedYear) f = f.filter(function(r) { return (r.tarih || '').slice(0, 4) === yagSelectedYear; });
  return f;
}

function yagYilDegistir(v) {
  yagSelectedYear = v || '';
  renderYagTable();
}

function yagSifirla() {
  ['yagTarihBas', 'yagTarihBit'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var tur = document.getElementById('yagTurFilter');
  if (tur) tur.value = '';
  yagSelectedYear = '';
  yagPage = 0;
  renderYagTable();
}

function renderYagFilterBar() {
  var sel = document.getElementById('yagYilFilter');
  var set = {};
  getYagBaseFiltered().forEach(function(r) {
    if (r.tarih) set[r.tarih.slice(0, 4)] = true;
  });
  var years = Object.keys(set).sort();
  if (sel) {
    if (yagSelectedYear && years.indexOf(yagSelectedYear) === -1) {
      yagSelectedYear = years.length ? years[years.length - 1] : '';
    }
    var html = '<option value="">Tümü</option>' + years.map(function(y) {
      return '<option value="' + y + '"' + (yagSelectedYear === y ? ' selected' : '') + '>' + y + '</option>';
    }).join('');
    sel.innerHTML = html;
  }
  var bas = document.getElementById('yagTarihBas');
  var bit = document.getElementById('yagTarihBit');
  var tur = document.getElementById('yagTurFilter');
  var active = !!((bas && bas.value) || (bit && bit.value) || (tur && tur.value) || yagSelectedYear);
  var badge = document.getElementById('yagFiltreBadge');
  if (badge) badge.style.display = active ? 'inline-flex' : 'none';
  var ozet = document.getElementById('yagFiltreOzet');
  if (ozet) {
    var parts = [];
    if ((bas && bas.value) || (bit && bit.value)) {
      parts.push((bas && bas.value ? displayDate(bas.value) : 'Başlangıç') + ' – ' + (bit && bit.value ? displayDate(bit.value) : 'Bitiş'));
    }
    if (tur && tur.value) parts.push('Tür: ' + tur.value);
    if (yagSelectedYear) parts.push('Yıl: ' + yagSelectedYear);
    ozet.textContent = parts.length
      ? 'Aktif filtre: ' + parts.join(' · ')
      : 'Filtre yok — tüm atık yağ kayıtları gösteriliyor.';
  }
}

function renderYagTable() {
  const tbody = document.getElementById('yagTbody');
  const table = document.getElementById('yagTable');
  const empty = document.getElementById('emptyStateYag');
  const badge = document.getElementById('yagBadge');

  badge.textContent = yagRecords.length + ' kayıt';

  renderYagFilterBar();

  const filtered = getYagFiltered();

  if (yagRecords.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = 'Henüz atık yağ kaydı girilmemiş.';
    renderYagOzet([]);
    drawYagChart([]);
    return;
  }

  if (filtered.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = 'Bu filtreleme kriterlerine uygun kayıt bulunamadı.';
    renderYagOzet([]);
    drawYagChart([]);
    return;
  }
  empty.querySelector('p').textContent = 'Henüz atık yağ kaydı girilmemiş.';

  // Filtrelenmiş özet kartları
  renderYagOzet(filtered);

  empty.style.display = 'none';
  table.style.display = 'table';

  const sorted = filtered.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  const totalPages = Math.ceil(sorted.length / YAG_PAGE_SIZE);
  if (yagPage >= totalPages) yagPage = Math.max(0, totalPages - 1);
  const start = yagPage * YAG_PAGE_SIZE;
  const pageItems = sorted.slice(start, start + YAG_PAGE_SIZE);
  var canEditYag = canEditYagRecords();

  tbody.innerHTML = pageItems.map(r => {
    const dateStr = displayDate(r.tarih);
    var actionCell = canEditYag
      ? '<td>' +
        '<button class="btn-icon" onclick="editYagRecord(' + r.id + ')" title="Düzenle">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button class="btn-icon" onclick="deleteYagRecord(' + r.id + ')" title="Sil" style="color:var(--danger)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
        '</button>' +
        '</td>'
      : '<td></td>';
    return `<tr>
      <td>${dateStr}</td>
      <td>${escapeHtml(r.makbuzNo || '—')}</td>
      <td>${escapeHtml(r.tur || '—')}</td>
      <td>${(r.miktar || 0).toFixed(1)}</td>
      <td>${escapeHtml(r.not || '—')}</td>
      ${actionCell}
    </tr>`;
  }).join('');

  const pagination = document.getElementById('yagPagination');
  if (pagination) {
    if (totalPages > 1) {
      pagination.innerHTML =
        '<button class="btn-icon" data-yag-page="' + (yagPage - 1) + '"' + (yagPage === 0 ? ' disabled style="opacity:0.4"' : '') + '>‹</button>' +
        Array.from({length: totalPages}, function(_, i) {
          return '<button class="btn-icon" data-yag-page="' + i + '"' + (i === yagPage ? ' style="font-weight:700;color:var(--primary)"' : '') + '>' + (i + 1) + '</button>';
        }).join('') +
        '<button class="btn-icon" data-yag-page="' + (yagPage + 1) + '"' + (yagPage >= totalPages - 1 ? ' disabled style="opacity:0.4"' : '') + '>›</button>';
    } else {
      pagination.innerHTML = '';
    }
  }

  drawYagChart(filtered);
}

function openYagModal(id) {
  if (id) {
    if (!canEditYagRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddYagRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  }
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
  if (editingYagId) {
    if (!canEditYagRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddYagRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  }

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
    logIslem('kayit_duzenle', 'yag #' + editingYagId + ' güncellendi');
  } else {
    yagRecords.push(rec);
    showToast('Atık yağ kaydı eklendi.', 'success');
    logIslem('yeni_kayit', 'yag ' + (rec.tur || '') + ' ' + rec.miktar + ' lt eklendi');
  }

  saveYagData();
  renderYagTable();
  syncYagSilent();
  closeYagModal();
}

function editYagRecord(id) { openYagModal(id); }

async function deleteYagRecord(id) {
  if (!canEditYagRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  if (!confirm('Bu atık yağ kaydını silmek istediğinize emin misiniz?')) return;
  yagRecords = yagRecords.filter(r => r.id !== id);
  saveYagData();
  if (supabaseClient) {
    try { await supabaseClient.from('yag_records').delete().eq('id', id); } catch (_) {}
  }
  renderYagTable();
  syncYagSilent();
  showToast('Atık yağ kaydı silindi.', 'success');
  logIslem('kayit_sil', 'yag #' + id + ' silindi');
}

let yagChartInstance = null;
let yagTurChartInstance = null;
let yagSelectedYear = '';

var AYLAR_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

function drawYagChart(list) {
  var canvas = document.getElementById('canvasYag');
  var empty = document.getElementById('chartYagEmpty');
  if (!canvas || !empty) return;
  if (yagChartInstance) { yagChartInstance.destroy(); yagChartInstance = null; }

  var monthly = {};
  list.forEach(function(r) {
    if (!r.tarih) return;
    var mk = r.tarih.slice(5, 7) + '/' + r.tarih.slice(0, 4);
    monthly[mk] = (monthly[mk] || 0) + (Number(r.miktar) || 0);
  });

  var labels = [], values = [], barKeys = [], prevValues = null, prevYear = null;
  if (yagSelectedYear) {
    var y = Number(yagSelectedYear);
    for (var i = 0; i < 12; i++) {
      var mk0 = (i < 9 ? '0' + (i + 1) : String(i + 1)) + '/' + y;
      labels.push(AYLAR_KISA[i]);
      values.push(monthly[mk0] || 0);
      barKeys.push({ y: y, m: i });
    }
    prevYear = y - 1;
    var prevMonthly = {};
    getYagBaseFiltered().forEach(function(r) {
      if (!r.tarih || r.tarih.slice(0, 4) !== String(prevYear)) return;
      var m = parseInt(r.tarih.slice(5, 7), 10) - 1;
      if (!isNaN(m)) prevMonthly[m] = (prevMonthly[m] || 0) + (Number(r.miktar) || 0);
    });
    prevValues = [];
    for (var j = 0; j < 12; j++) prevValues.push(prevMonthly[j] || 0);
  } else {
    Object.keys(monthly).sort(function(a, b) {
      var pa = a.split('/'), pb = b.split('/');
      return pa[1] !== pb[1] ? pa[1] - pb[1] : pa[0] - pb[0];
    }).forEach(function(k) {
      var p = k.split('/');
      labels.push(AYLAR_KISA[Number(p[0]) - 1] + ' \'' + String(Number(p[1])).slice(2));
      values.push(monthly[k]);
      barKeys.push({ y: Number(p[1]), m: Number(p[0]) - 1 });
    });
  }

  var hasCurrent = values.some(function(v) { return v > 0; });
  var hasPrev = prevValues !== null && prevValues.some(function(v) { return v > 0; });
  if (!hasCurrent && !hasPrev) { empty.style.display = 'block'; canvas.style.display = 'none'; return; }
  empty.style.display = 'none';
  canvas.style.display = 'block';

  var parent = canvas.parentElement;
  var w = Math.max(parent.clientWidth || 400, 320);
  canvas.style.width = w + 'px';
  canvas.style.height = '250px';
  canvas.width = w;
  canvas.height = 250;
  var ctx = canvas.getContext('2d');

  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var textColor = isDark ? '#e2e8f0' : '#1e293b';
  var gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  var mainColor = '#f97316';

  var barColors = values.map(function(v) { return v > 0 ? mainColor : 'rgba(148,163,184,0.25)'; });

  var datasets = [{
    label: yagSelectedYear ? 'Atık Yağ ' + yagSelectedYear + ' (lt)' : 'Atık Yağ (lt)',
    data: values,
    backgroundColor: barColors,
    borderRadius: 4,
    barPercentage: 0.6,
    categoryPercentage: 0.75,
    maxBarThickness: 52
  }];
  if (hasPrev) {
    datasets.push({
      label: 'Önceki Yıl ' + prevYear + ' (lt)',
      data: prevValues,
      type: 'line',
      borderColor: 'rgba(37,99,235,0.55)',
      backgroundColor: 'rgba(37,99,235,0.08)',
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: 'rgba(37,99,235,0.6)',
      fill: false,
      tension: 0.3
    });
  }

  yagChartInstance = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      devicePixelRatio: Math.max(window.devicePixelRatio || 1, 2),
      animation: { duration: 500, easing: 'easeOutCubic' },
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { color: textColor, font: { size: 11 } }
        },
        valueLabels: !hasPrev,
        valueLabelsPosition: 'above',
        tooltip: {
          backgroundColor: '#000',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 1,
          callbacks: {
            label: function(c) { return ' ' + c.dataset.label + ': ' + c.parsed.y.toFixed(1) + ' lt'; }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: textColor, font: { size: 10 }, autoSkip: false },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: textColor, font: { size: 10 } },
          grid: { color: gridColor }
        }
      },
      onClick: function(e) {
        var active = yagChartInstance.getElementsAtEventForMode(e, 'index', { intersect: true }, false);
        if (active.length > 0) {
          var key = barKeys[active[0].index];
          if (key) {
            var detail = list.filter(function(r) {
              if (!r.tarih) return false;
              var d = new Date(r.tarih + 'T12:00:00');
              return !isNaN(d) && d.getFullYear() === key.y && d.getMonth() === key.m;
            });
            if (detail.length > 0) showChartDetailModal(AYLAR_KISA[key.m] + ' ' + key.y + ' Atık Yağ', detail);
          }
        }
      }
    },
    plugins: [chartValueLabelPlugin]
  });
}

function drawYagTurChart(list) {
  var canvas = document.getElementById('canvasYagTur');
  var empty = document.getElementById('chartYagTurEmpty');
  if (!canvas || !empty) return;
  if (yagTurChartInstance) { yagTurChartInstance.destroy(); yagTurChartInstance = null; }

  var totals = {};
  list.forEach(function(r) {
    var t = r.tur || 'Belirtilmemiş';
    totals[t] = (totals[t] || 0) + (Number(r.miktar) || 0);
  });
  var keys = Object.keys(totals).sort();
  if (keys.length === 0) { empty.style.display = 'block'; canvas.style.display = 'none'; return; }
  empty.style.display = 'none';
  canvas.style.display = 'block';

  var parent = canvas.parentElement;
  var w = Math.max(parent.clientWidth || 400, 320);
  canvas.style.width = w + 'px';
  canvas.style.height = '230px';
  canvas.width = w;
  canvas.height = 230;
  var ctx = canvas.getContext('2d');

  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var textColor = isDark ? '#e2e8f0' : '#1e293b';
  var palette = ['#f97316', '#f59e0b', '#fb923c', '#eab308', '#fdba74', '#ea580c', '#d97706', '#fde047', '#c2410c'];
  var data = keys.map(function(k) { return totals[k]; });
  var grand = data.reduce(function(a, b) { return a + b; }, 0);

  yagTurChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: keys,
      datasets: [{
        data: data,
        backgroundColor: keys.map(function(_, i) { return palette[i % palette.length]; }),
        borderColor: isDark ? '#1e293b' : '#ffffff',
        borderWidth: 2,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: textColor, font: { size: 11 }, boxWidth: 12, boxHeight: 12, padding: 12 }
        },
        tooltip: {
          backgroundColor: '#000',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 1,
          callbacks: {
            label: function(c) {
              var pct = grand > 0 ? (c.parsed / grand * 100).toFixed(1) : '0.0';
              return ' ' + c.label + ': ' + c.parsed.toFixed(1) + ' lt (%' + pct + ')';
            }
          }
        }
      }
    },
    plugins: []
  });
}


// ─── AMBALAJ ATIKLARI ────────────────────────────────────────────────────
const AMBALAJ_STORAGE_KEY = 'atik_kontrol_ambalaj';
let ambalajRecords = [];
let editingAmbalajId = null;
let ambalajBirim = 'kg';
let ambalajPage = 0;
const AMBALAJ_PAGE_SIZE = 10;

function toggleAmbalajBirim() {
  var btn = document.getElementById('afBirimToggle');
  var inp = document.getElementById('afMiktar');
  if (ambalajBirim === 'kg') {
    ambalajBirim = 'g';
    btn.textContent = 'g';
    if (inp.value) inp.value = (parseFloat(inp.value) * 1000).toFixed(0);
    inp.step = '1';
    inp.placeholder = '0';
  } else {
    ambalajBirim = 'kg';
    btn.textContent = 'kg';
    if (inp.value) inp.value = (parseFloat(inp.value) / 1000).toFixed(3);
    inp.step = '0.001';
    inp.placeholder = '0.000';
  }
}

function loadAmbalajData() {
  try {
    var stored = sessionStorage.getItem(AMBALAJ_STORAGE_KEY);
    if (stored) {
      ambalajRecords = JSON.parse(stored);
    } else {
      stored = localStorage.getItem(AMBALAJ_STORAGE_KEY);
      if (stored) {
        ambalajRecords = JSON.parse(stored);
        try { sessionStorage.setItem(AMBALAJ_STORAGE_KEY, stored); } catch (_) {}
        try { localStorage.removeItem(AMBALAJ_STORAGE_KEY); } catch (_) {}
      } else {
        ambalajRecords = [];
      }
    }
  } catch (_) { ambalajRecords = []; }
  ambalajRecords.forEach(function(r) { if (r.tarih) r.tarih = normalizeDate(r.tarih); });
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('#ambalajPagination .btn-icon');
  if (btn && btn.hasAttribute('data-ambalaj-page') && !btn.disabled) {
    var page = parseInt(btn.getAttribute('data-ambalaj-page'));
    if (!isNaN(page) && page >= 0) {
      ambalajPage = page;
      renderAmbalajTable();
    }
  }
  btn = e.target.closest('#yagPagination .btn-icon');
  if (btn && btn.hasAttribute('data-yag-page') && !btn.disabled) {
    var page = parseInt(btn.getAttribute('data-yag-page'));
    if (!isNaN(page) && page >= 0) {
      yagPage = page;
      renderYagTable();
    }
  }
  btn = e.target.closest('#kalibrasyonPagination .btn-icon');
  if (btn && btn.hasAttribute('data-kalibrasyon-page') && !btn.disabled) {
    var page = parseInt(btn.getAttribute('data-kalibrasyon-page'));
    if (!isNaN(page) && page >= 0) {
      kalibrasyonPage = page;
      renderKalibrasyon();
    }
  }
});

function saveAmbalajData() {
  try { sessionStorage.setItem(AMBALAJ_STORAGE_KEY, JSON.stringify(ambalajRecords)); } catch (_) {}
}

function ambalajToKg(r) {
  return (r.birim === 'g') ? (Number(r.miktar) || 0) / 1000 : (Number(r.miktar) || 0);
}

function renderAmbalajOzet(list) {
  const grid = document.getElementById('ambalajOzetGrid');
  if (!grid) return;
  const adet = list.length;
  const toplam = list.reduce((s, r) => s + ambalajToKg(r), 0);
  const ort = adet ? toplam / adet : 0;
  const maxR = adet ? Math.max(...list.map(r => ambalajToKg(r))) : 0;
  const minR = adet ? Math.min(...list.map(r => ambalajToKg(r))) : 0;
  const turler = new Set(list.map(r => r.tur).filter(Boolean));
  const yilToplam = {};
  list.forEach(r => {
    const y = new Date(r.tarih + 'T12:00:00').getFullYear();
    if (!isNaN(y)) yilToplam[y] = (yilToplam[y] || 0) + ambalajToKg(r);
  });
  const yillar = Object.keys(yilToplam).sort();
  const fmt = (v) => v.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' kg';
  let html = `
    <div class="report-item">
      <span class="report-label">Toplam Kayıt</span>
      <span class="report-value">${adet.toLocaleString('tr-TR')}</span>
    </div>
    <div class="report-item report-item-highlight" style="background: rgba(16,185,129,0.08); border-color: rgba(16,185,129,0.25);">
      <span class="report-label">Toplam Ambalaj Atığı</span>
      <span class="report-value" style="color:#10b981">${fmt(toplam)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">Ort. Miktar / Kayıt</span>
      <span class="report-value">${fmt(ort)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">En Yüksek Miktar</span>
      <span class="report-value">${fmt(maxR)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">En Düşük Miktar</span>
      <span class="report-value">${fmt(minR)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">Atık Türü Çeşidi</span>
      <span class="report-value">${turler.size.toLocaleString('tr-TR')}</span>
    </div>
  `;
  const simdikiYil = String(new Date().getFullYear());
  yillar.forEach(y => {
    if (y !== simdikiYil) return;
    html += `
    <div class="report-item">
      <span class="report-label">${y} Toplam</span>
      <span class="report-value" style="color:var(--accent)">${fmt(yilToplam[y])}</span>
    </div>`;
  });
  grid.innerHTML = html;
}

function getAmbalajBaseFiltered() {
  let f = [...ambalajRecords];
  var bas = document.getElementById('ambalajTarihBas');
  var bit = document.getElementById('ambalajTarihBit');
  var tur = document.getElementById('ambalajTurFilter');
  if (bas && bas.value) f = f.filter(function(r) { return r.tarih >= bas.value; });
  if (bit && bit.value) f = f.filter(function(r) { return r.tarih <= bit.value; });
  if (tur && tur.value) f = f.filter(function(r) { return r.tur === tur.value; });
  return f;
}

function getAmbalajFiltered() {
  let f = getAmbalajBaseFiltered();
  if (ambalajSelectedYear) f = f.filter(function(r) { return (r.tarih || '').slice(0, 4) === ambalajSelectedYear; });
  return f;
}

function ambalajYilDegistir(v) {
  ambalajSelectedYear = v || '';
  renderAmbalajTable();
}

function ambalajSifirla() {
  ['ambalajTarihBas', 'ambalajTarihBit'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var tur = document.getElementById('ambalajTurFilter');
  if (tur) tur.value = '';
  ambalajSelectedYear = '';
  ambalajPage = 0;
  renderAmbalajTable();
}

function renderAmbalajFilterBar() {
  var sel = document.getElementById('ambalajYilFilter');
  var set = {};
  getAmbalajBaseFiltered().forEach(function(r) {
    if (r.tarih) set[r.tarih.slice(0, 4)] = true;
  });
  var years = Object.keys(set).sort();
  if (sel) {
    if (ambalajSelectedYear && years.indexOf(ambalajSelectedYear) === -1) {
      ambalajSelectedYear = years.length ? years[years.length - 1] : '';
    }
    var html = '<option value="">Tümü</option>' + years.map(function(y) {
      return '<option value="' + y + '"' + (ambalajSelectedYear === y ? ' selected' : '') + '>' + y + '</option>';
    }).join('');
    sel.innerHTML = html;
  }
  var bas = document.getElementById('ambalajTarihBas');
  var bit = document.getElementById('ambalajTarihBit');
  var tur = document.getElementById('ambalajTurFilter');
  var active = !!((bas && bas.value) || (bit && bit.value) || (tur && tur.value) || ambalajSelectedYear);
  var badge = document.getElementById('ambalajFiltreBadge');
  if (badge) badge.style.display = active ? 'inline-flex' : 'none';
  var ozet = document.getElementById('ambalajFiltreOzet');
  if (ozet) {
    var parts = [];
    if ((bas && bas.value) || (bit && bit.value)) {
      parts.push((bas && bas.value ? displayDate(bas.value) : 'Başlangıç') + ' – ' + (bit && bit.value ? displayDate(bit.value) : 'Bitiş'));
    }
    if (tur && tur.value) parts.push('Tür: ' + tur.value);
    if (ambalajSelectedYear) parts.push('Yıl: ' + ambalajSelectedYear);
    ozet.textContent = parts.length
      ? 'Aktif filtre: ' + parts.join(' · ')
      : 'Filtre yok — tüm ambalaj atığı kayıtları gösteriliyor.';
  }
}

function renderAmbalajTable() {
  const tbody = document.getElementById('ambalajTbody');
  const table = document.getElementById('ambalajTable');
  const empty = document.getElementById('emptyStateAmbalaj');
  const badge = document.getElementById('ambalajBadge');

  badge.textContent = ambalajRecords.length + ' kayıt';

  renderAmbalajFilterBar();

  const filtered = getAmbalajFiltered();

  if (ambalajRecords.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = 'Henüz ambalaj atığı kaydı girilmemiş.';
    renderAmbalajOzet([]);
    drawAmbalajChart([]);
    return;
  }

  if (filtered.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = 'Bu filtreleme kriterlerine uygun kayıt bulunamadı.';
    renderAmbalajOzet([]);
    drawAmbalajChart([]);
    return;
  }
  empty.querySelector('p').textContent = 'Henüz ambalaj atığı kaydı girilmemiş.';

  // Filtrelenmiş özet kartları
  renderAmbalajOzet(filtered);

  empty.style.display = 'none';
  table.style.display = 'table';

  const sorted = filtered.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  const totalPages = Math.ceil(sorted.length / AMBALAJ_PAGE_SIZE);
  if (ambalajPage >= totalPages) ambalajPage = Math.max(0, totalPages - 1);
  const start = ambalajPage * AMBALAJ_PAGE_SIZE;
  const pageItems = sorted.slice(start, start + AMBALAJ_PAGE_SIZE);

  var canEditAmbalaj = canEditAmbalajRecords();

  tbody.innerHTML = pageItems.map(r => {
    const dateStr = displayDate(r.tarih);
    var actionCell = canEditAmbalaj
      ? '<td>' +
        '<button class="btn-icon" onclick="editAmbalajRecord(' + r.id + ')" title="Düzenle">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button class="btn-icon" onclick="deleteAmbalajRecord(' + r.id + ')" title="Sil" style="color:var(--danger)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
        '</button>' +
        '</td>'
      : '<td></td>';
    return `<tr>
      <td>${dateStr}</td>
      <td>${escapeHtml(r.tur || '—')}</td>
      <td>${(r.miktar || 0) < 1 && (r.birim || 'kg') === 'kg' ? (r.miktar || 0).toFixed(3) : (r.miktar || 0).toFixed(1)} <span style="font-size:0.7rem;color:var(--text-muted)">${(r.birim || 'kg') === 'g' ? 'gr' : 'kg'}</span></td>
      <td>${escapeHtml(r.not || '—')}</td>
      ${actionCell}
    </tr>`;
  }).join('');

  const pagination = document.getElementById('ambalajPagination');
  if (pagination) {
    if (totalPages > 1) {
      pagination.innerHTML =
        '<button class="btn-icon" data-ambalaj-page="' + (ambalajPage - 1) + '"' + (ambalajPage === 0 ? ' disabled style="opacity:0.4"' : '') + '>‹</button>' +
        Array.from({length: totalPages}, function(_, i) {
          return '<button class="btn-icon" data-ambalaj-page="' + i + '"' + (i === ambalajPage ? ' style="font-weight:700;color:var(--primary)"' : '') + '>' + (i + 1) + '</button>';
        }).join('') +
        '<button class="btn-icon" data-ambalaj-page="' + (ambalajPage + 1) + '"' + (ambalajPage >= totalPages - 1 ? ' disabled style="opacity:0.4"' : '') + '>›</button>';
    } else {
      pagination.innerHTML = '';
    }
  }

  drawAmbalajChart(filtered);
}

function openAmbalajModal(id) {
  if (id) {
    if (!canEditAmbalajRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddAmbalajRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  }
  editingAmbalajId = id || null;
  const overlay = document.getElementById('ambalajModal');
  const title = document.getElementById('ambalajModalTitle');
  const form = document.getElementById('ambalajForm');

  form.reset();
  document.getElementById('afTarih').value = formatLocalDate(new Date());

  ambalajBirim = 'kg';
  var btn = document.getElementById('afBirimToggle');
  if (btn) { btn.textContent = 'kg'; document.getElementById('afMiktar').step = '0.001'; document.getElementById('afMiktar').placeholder = '0.000'; }

  if (id) {
    const rec = ambalajRecords.find(r => r.id === id);
    if (!rec) return;
    title.textContent = 'Ambalaj Atığı Kaydını Düzenle';
    document.getElementById('afTarih').value = rec.tarih;
    document.getElementById('afTur').value = rec.tur || '';
    document.getElementById('afNot').value = rec.not || '';

    ambalajBirim = rec.birim || 'kg';
    var btn = document.getElementById('afBirimToggle');
    if (btn) {
      btn.textContent = ambalajBirim === 'g' ? 'g' : 'kg';
      var inp = document.getElementById('afMiktar');
      if (ambalajBirim === 'g') { inp.step = '1'; inp.placeholder = '0'; }
      else { inp.step = '0.001'; inp.placeholder = '0.000'; }
    }
    document.getElementById('afMiktar').value = rec.miktar || '';
  } else {
    title.textContent = 'Yeni Ambalaj Atığı Kaydı';
    document.getElementById('afTur').value = '';
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
  if (editingAmbalajId) {
    if (!canEditAmbalajRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddAmbalajRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  }

  var rawMiktar = parseFloat(document.getElementById('afMiktar').value) || 0;

  const rec = {
    id: editingAmbalajId || Date.now(),
    tarih: document.getElementById('afTarih').value,
    tur: document.getElementById('afTur').value,
    miktar: rawMiktar,
    birim: ambalajBirim || 'kg',
    not: document.getElementById('afNot').value.trim()
  };

  if (editingAmbalajId) {
    const idx = ambalajRecords.findIndex(r => r.id === editingAmbalajId);
    if (idx !== -1) ambalajRecords[idx] = rec;
    showToast('Ambalaj atığı kaydı güncellendi.', 'success');
    logIslem('kayit_duzenle', 'ambalaj #' + editingAmbalajId + ' güncellendi');
  } else {
    ambalajRecords.push(rec);
    showToast('Ambalaj atığı kaydı eklendi.', 'success');
    logIslem('yeni_kayit', 'ambalaj ' + (rec.tur || '') + ' ' + rec.miktar + ' ' + (rec.birim || 'kg'));
  }

  saveAmbalajData();
  renderAmbalajTable();
  syncAmbalajSilent();
  closeAmbalajModal();
}

function editAmbalajRecord(id) { openAmbalajModal(id); }

async function deleteAmbalajRecord(id) {
  if (!canEditAmbalajRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  if (!confirm('Bu ambalaj atığı kaydını silmek istediğinize emin misiniz?')) return;
  ambalajRecords = ambalajRecords.filter(r => r.id !== id);
  saveAmbalajData();
  if (supabaseClient) {
    try { await supabaseClient.from('ambalaj_records').delete().eq('id', id); } catch (_) {}
  }
  renderAmbalajTable();
  syncAmbalajSilent();
  showToast('Ambalaj atığı kaydı silindi.', 'success');
  logIslem('kayit_sil', 'ambalaj #' + id + ' silindi');
}

let ambalajChartInstance = null;
let ambalajTurChartInstance = null;
let ambalajSelectedYear = '';

function drawAmbalajChart(list) {
  var canvas = document.getElementById('canvasAmbalaj');
  var empty = document.getElementById('chartAmbalajEmpty');
  if (!canvas || !empty) return;
  if (ambalajChartInstance) { ambalajChartInstance.destroy(); ambalajChartInstance = null; }

  var monthly = {};
  list.forEach(function(r) {
    if (!r.tarih) return;
    var mk = r.tarih.slice(5, 7) + '/' + r.tarih.slice(0, 4);
    monthly[mk] = (monthly[mk] || 0) + ambalajToKg(r);
  });

  var labels = [], values = [], barKeys = [], prevValues = null, prevYear = null;
  if (ambalajSelectedYear) {
    var y = Number(ambalajSelectedYear);
    for (var i = 0; i < 12; i++) {
      var mk0 = (i < 9 ? '0' + (i + 1) : String(i + 1)) + '/' + y;
      labels.push(AYLAR_KISA[i]);
      values.push(monthly[mk0] || 0);
      barKeys.push({ y: y, m: i });
    }
    prevYear = y - 1;
    var prevMonthly = {};
    getAmbalajBaseFiltered().forEach(function(r) {
      if (!r.tarih || r.tarih.slice(0, 4) !== String(prevYear)) return;
      var m = parseInt(r.tarih.slice(5, 7), 10) - 1;
      if (!isNaN(m)) prevMonthly[m] = (prevMonthly[m] || 0) + ambalajToKg(r);
    });
    prevValues = [];
    for (var j = 0; j < 12; j++) prevValues.push(prevMonthly[j] || 0);
  } else {
    Object.keys(monthly).sort(function(a, b) {
      var pa = a.split('/'), pb = b.split('/');
      return pa[1] !== pb[1] ? pa[1] - pb[1] : pa[0] - pb[0];
    }).forEach(function(k) {
      var p = k.split('/');
      labels.push(AYLAR_KISA[Number(p[0]) - 1] + ' \'' + String(Number(p[1])).slice(2));
      values.push(monthly[k]);
      barKeys.push({ y: Number(p[1]), m: Number(p[0]) - 1 });
    });
  }

  var hasCurrent = values.some(function(v) { return v > 0; });
  var hasPrev = prevValues !== null && prevValues.some(function(v) { return v > 0; });
  if (!hasCurrent && !hasPrev) { empty.style.display = 'block'; canvas.style.display = 'none'; return; }
  empty.style.display = 'none';
  canvas.style.display = 'block';

  var parent = canvas.parentElement;
  var w = Math.max(parent.clientWidth || 400, 320);
  canvas.style.width = w + 'px';
  canvas.style.height = '250px';
  canvas.width = w;
  canvas.height = 250;
  var ctx = canvas.getContext('2d');

  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var textColor = isDark ? '#e2e8f0' : '#1e293b';
  var gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  var mainColor = '#10b981';

  var barColors = values.map(function(v) { return v > 0 ? mainColor : 'rgba(148,163,184,0.25)'; });

  var datasets = [{
    label: ambalajSelectedYear ? 'Ambalaj Atığı ' + ambalajSelectedYear + ' (kg)' : 'Ambalaj Atığı (kg)',
    data: values,
    backgroundColor: barColors,
    borderRadius: 4,
    barPercentage: 0.6,
    categoryPercentage: 0.75,
    maxBarThickness: 52
  }];
  if (hasPrev) {
    datasets.push({
      label: 'Önceki Yıl ' + prevYear + ' (kg)',
      data: prevValues,
      type: 'line',
      borderColor: 'rgba(99,102,241,0.55)',
      backgroundColor: 'rgba(99,102,241,0.08)',
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: 'rgba(99,102,241,0.6)',
      fill: false,
      tension: 0.3
    });
  }

  ambalajChartInstance = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      devicePixelRatio: Math.max(window.devicePixelRatio || 1, 2),
      animation: { duration: 500, easing: 'easeOutCubic' },
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { color: textColor, font: { size: 11 } }
        },
        valueLabels: !hasPrev,
        valueLabelsPosition: 'above',
        tooltip: {
          backgroundColor: '#000',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 1,
          callbacks: {
            label: function(c) {
              var v = c.parsed.y;
              return ' ' + c.dataset.label + ': ' + (v < 1 ? v.toFixed(3) : v.toFixed(1)) + ' kg';
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: textColor, font: { size: 10 }, autoSkip: false },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: textColor, font: { size: 10 } },
          grid: { color: gridColor }
        }
      },
      onClick: function(e) {
        var active = ambalajChartInstance.getElementsAtEventForMode(e, 'index', { intersect: true }, false);
        if (active.length > 0) {
          var key = barKeys[active[0].index];
          if (key) {
            var detail = list.filter(function(r) {
              if (!r.tarih) return false;
              var d = new Date(r.tarih + 'T12:00:00');
              return !isNaN(d) && d.getFullYear() === key.y && d.getMonth() === key.m;
            });
            if (detail.length > 0) showChartDetailModal(AYLAR_KISA[key.m] + ' ' + key.y + ' Ambalaj Atığı', detail);
          }
        }
      }
    },
    plugins: [chartValueLabelPlugin]
  });
}

function drawAmbalajTurChart(list) {
  var canvas = document.getElementById('canvasAmbalajTur');
  var empty = document.getElementById('chartAmbalajTurEmpty');
  if (!canvas || !empty) return;
  if (ambalajTurChartInstance) { ambalajTurChartInstance.destroy(); ambalajTurChartInstance = null; }

  var totals = {};
  list.forEach(function(r) {
    var t = r.tur || 'Belirtilmemiş';
    totals[t] = (totals[t] || 0) + ambalajToKg(r);
  });
  var keys = Object.keys(totals).sort();
  if (keys.length === 0) { empty.style.display = 'block'; canvas.style.display = 'none'; return; }
  empty.style.display = 'none';
  canvas.style.display = 'block';

  var parent = canvas.parentElement;
  var w = Math.max(parent.clientWidth || 400, 320);
  canvas.style.width = w + 'px';
  canvas.style.height = '230px';
  canvas.width = w;
  canvas.height = 230;
  var ctx = canvas.getContext('2d');

  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var textColor = isDark ? '#e2e8f0' : '#1e293b';
  var palette = ['#10b981', '#14b8a6', '#34d399', '#0ea5e9', '#22d3ee', '#6366f1', '#a3e635', '#3b82f6', '#06b6d4'];
  var data = keys.map(function(k) { return totals[k]; });
  var grand = data.reduce(function(a, b) { return a + b; }, 0);

  ambalajTurChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: keys,
      datasets: [{
        data: data,
        backgroundColor: keys.map(function(_, i) { return palette[i % palette.length]; }),
        borderColor: isDark ? '#1e293b' : '#ffffff',
        borderWidth: 2,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: textColor, font: { size: 11 }, boxWidth: 12, boxHeight: 12, padding: 12 }
        },
        tooltip: {
          backgroundColor: '#000',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 1,
          callbacks: {
            label: function(c) {
              var pct = grand > 0 ? (c.parsed / grand * 100).toFixed(1) : '0.0';
              return ' ' + c.label + ': ' + (c.parsed < 1 ? c.parsed.toFixed(3) : c.parsed.toFixed(1)) + ' kg (%' + pct + ')';
            }
          }
        }
      }
    },
    plugins: []
  });
}


function buildExportHTML() {
  var gunler = t('dayNames');
  var cesitler = [t('menuVariety1'), t('menuVariety2'), t('menuVariety3'), t('menuVariety4'), t('menuVariety5')];
  var weekLabel = (document.getElementById('menuWeekLabel') || {}).textContent || '';

  // Read menu data from DOM
  var tableData = [];
  for (var ci = 0; ci < 5; ci++) {
    var cells = [];
    for (var di = 0; di < 5; di++) {
      var el = document.getElementById('m' + ci + '_' + di);
      cells.push(el ? el.textContent : '');
    }
    tableData.push({ label: cesitler[ci], cells: cells });
  }
  var kisiCells = [];
  var kisiVals = [];
  for (var di = 0; di < 5; di++) {
    var el = document.getElementById('mk_' + di);
    var v = el ? el.value : '0';
    kisiCells.push(v);
    kisiVals.push(parseInt(v) || 0);
  }
  tableData.push({ label: t('menuPersonCount'), cells: kisiCells });
  var dayNotes = [];
  for (var di = 0; di < 5; di++) {
    var notes = [];
    for (var ni = 0; ni < 10; ni++) {
      var el = document.getElementById('mn_' + ni + '_' + di);
      if (el && el.value) notes.push(el.value);
    }
    dayNotes.push(notes);
  }

  // Compute production data
  var yemekler = (typeof loadYemekler === 'function') ? loadYemekler() : [];
  var parseName = function(val) { return (val || '').trim().split('\n')[0].replace(/ - \(.*/, '').trim(); };
  var findDish = function(name) {
    if (!name) return null;
    var lower = name.toLowerCase();
    for (var i = 0; i < yemekler.length; i++) {
      if (yemekler[i].ad.toLowerCase() === lower) return yemekler[i];
    }
    for (var i = 0; i < yemekler.length; i++) {
      var yl = yemekler[i].ad.toLowerCase();
      if (yl.startsWith(lower) || lower.startsWith(yl)) return yemekler[i];
    }
    return null;
  };
  var normBirim = normBirimGlobal;
  var fmt = function(total, birim) {
    if (total <= 0) return '—';
    if (birim === 'gr') return total >= 1000 ? (Math.round(total / 10) / 100) + ' kg' : Math.round(total) + ' gr';
    if (birim === 'ml') return total >= 1000 ? (Math.round(total / 10) / 100) + ' lt' : Math.round(total) + ' ml';
    if (birim === 'lt' || birim === 'litre') return (Math.round(total * 100) / 100) + ' lt';
    return Math.round(total) + ' ' + birim;
  };

  // Per-day production rows
  var prodDaysHtml = '';
  var weekAgg = {}; // for weekly total
  for (var di = 0; di < 5; di++) {
    var kisi = kisiVals[di];
    var dayCesitler = '';
    var dayHasAny = false;
    var dayAgg = {};
    for (var ci = 0; ci < 5; ci++) {
      var el = document.getElementById('m' + ci + '_' + di);
      var raw = el ? el.textContent : '';
      var name = parseName(raw);
      if (!name) continue;
      var dish = findDish(name);
      if (!dish || !dish.tarif || !dish.tarif.length) continue;
      dayHasAny = true;
      var ingHtml = '';
      dish.tarif.forEach(function(ing, idx) {
        var miktarKisi = ing.miktar_kisi || ing.miktar || 0;
        var total = miktarKisi * kisi;
        var birim = normBirim(ing.birim);
        var birimLabel = birim === 'gr' ? ' gr' : birim === 'ml' ? ' ml' : birim === 'lt' || birim === 'litre' ? ' lt' : ' ' + birim;
        ingHtml += '<div class="ping"><span class="pn">' + escapeHtml(ing.malzeme.trim()) + ' <small style="color:#999">(' + miktarKisi + birimLabel + ')</small></span><span class="pq">' + fmt(total, birim) + '</span></div>';
        // accumulate for weekly total
        var key = ing.malzeme.trim().toLowerCase() + '|' + birim;
        if (!weekAgg[key]) weekAgg[key] = { ad: ing.malzeme.trim(), birim: birim, total: 0, miktarKisi: miktarKisi, birimLabel: birimLabel };
        weekAgg[key].total += total;
        // accumulate for daily total
        if (!dayAgg[key]) dayAgg[key] = { ad: ing.malzeme.trim(), birim: birim, total: 0, miktarKisi: miktarKisi, birimLabel: birimLabel, cesitler: 0, cesitSet: {} };
        dayAgg[key].total += total;
        if (!dayAgg[key].cesitSet[ci]) {
          dayAgg[key].cesitSet[ci] = true;
          dayAgg[key].cesitler++;
        }
      });
      dayCesitler += '<div class="pcol pcol-c' + (ci + 1) + '"><div class="pces">' + escapeHtml(ci + 1 + '. Çeşit: ' + name) + '</div>' + ingHtml + '</div>';
    }
    if (dayHasAny) {
      var dayTotalHtml = '';
      var dayEntries = Object.values(dayAgg).filter(function(e) { return e.total > 0; });
      if (dayEntries.length) {
        dayTotalHtml = '<div class="pdt"><div class="pdth">' + t('stockDeductionList') + ' – ' + gunler[di] + '</div>';
        dayEntries.forEach(function(e) {
          var cInfo = e.cesitler > 1 ? ' <small style="color:#999">(' + e.cesitler + ' ' + t('inVarieties') + ')</small>' : '';
          dayTotalHtml += '<div class="pdting"><span class="pdtn">' + escapeHtml(e.ad) + cInfo + '</span><span class="pdtq">' + fmt(e.total, e.birim) + '</span></div>';
        });
        dayTotalHtml += '</div>';
      }
      prodDaysHtml += '<div class="pday"><div class="phd"><span class="plab">' + gunler[di] + '</span><span class="pkisi">' + kisi + ' ' + t('person') + '</span></div><div class="pbd"><div class="prow">' + dayCesitler + '</div>' + dayTotalHtml + '</div></div>';
    }
  }

  // Weekly total HTML
  var weeklyHtml = '';
  var weekEntries = Object.values(weekAgg).filter(function(e) { return e.total > 0; });
  if (weekEntries.length) {
    weekEntries.sort(function(a, b) { return a.ad.localeCompare(b.ad); });
    weeklyHtml = '<div class="s-title">Haftalık Toplam İhtiyaç Listesi</div><div class="wcard"><div class="whd">Malzeme &mdash; Miktar</div><div class="wbd">';
    weekEntries.forEach(function(e) {
      weeklyHtml += '<div class="wit"><span class="wn">' + escapeHtml(e.ad) + '</span><span class="wq">' + fmt(e.total, e.birim) + '</span></div>';
    });
    weeklyHtml += '</div></div>';
  }

  // Assemble full HTML
  var html = '<div class="pdf-wrap">';
  html += '<style>' +
    '.pdf-wrap{margin:0;padding:6px 12px;font-family:Arial,sans-serif;color:#222;background:#fff;font-size:12px;width:190mm}' +
    'h1{margin:0 0 3px;font-size:16px;color:#111}' +
    '.sub{font-size:11px;color:#888;margin-bottom:5px}' +
    '.menu-table{width:100%;border-collapse:collapse;font-size:10px}' +
    '.menu-table th,.menu-table td{border:1px solid #bbb;padding:2px 4px;text-align:left;vertical-align:top}' +
    '.menu-table th{background:#eee;font-size:10px;font-weight:700;text-align:center}' +
    '.menu-table th:first-child{text-align:left;width:45px}' +
    '.menu-table td:first-child{font-weight:600;width:45px;white-space:nowrap;font-size:9px}' +
    '.s-title{font-size:13px;font-weight:700;margin:10px 0 4px;padding-bottom:2px;border-bottom:2px solid #6366f1;color:#1e293b}' +
    '.pday{margin-bottom:6px;border:1px solid #ddd;border-radius:3px;overflow:hidden}' +
    '.phd{padding:3px 6px;background:#f5f5f5;border-bottom:1px solid #ddd;font-size:12px;font-weight:700;display:flex;align-items:center}' +
    '.plab{color:#333}.pkisi{margin-left:auto;font-size:9px;color:#666}' +
    '.pbd{padding:3px 5px}' +
    '.prow{display:flex;gap:5px;flex-wrap:wrap}' +
    '.pcol{flex:1;min-width:90px;padding:3px 4px;border:1px solid #eee;border-radius:2px}' +
    '.pcol-c1{background:#f6f7fe;border-color:#d9dcf2}.pcol-c2{background:#f4fbfd;border-color:#d5eaf0}' +
    '.pcol-c3{background:#f5fbf7;border-color:#d8ecdf}.pcol-c4{background:#fdf9f4;border-color:#f2e3d0}' +
    '.pcol-c5{background:#fcf5f9;border-color:#efdbe7}' +
    '.pces{font-weight:700;font-size:10px;margin-bottom:1px;padding-bottom:1px;border-bottom:1px solid #ddd;color:#333}' +
    '.ping{font-size:9px;line-height:1.4;color:#555;display:flex;gap:2px}' +
    '.pn{flex:1}.pq{text-align:right;font-weight:600;color:#333;white-space:nowrap}' +
    '.pdt{margin-top:4px;border-top:1px dashed #bbb;padding-top:3px}' +
    '.pdth{font-size:10px;font-weight:700;color:#333;margin-bottom:2px}' +
    '.pdting{display:flex;gap:4px;font-size:9px;line-height:1.4}' +
    '.pdtn{flex:1;color:#333}.pdtq{font-weight:600;color:#333;white-space:nowrap}' +
    '.wcard{border:1px solid #ddd;border-radius:3px;overflow:hidden}' +
    '.whd{padding:3px 6px;background:#f5f5f5;border-bottom:1px solid #ddd;font-size:12px;font-weight:700;color:#333}' +
    '.wbd{padding:3px 6px}' +
    '.wit{display:flex;gap:6px;font-size:9px;line-height:1.5;padding:1px 0;border-bottom:1px solid #f0f0f0}' +
    '.wn{color:#333}.wq{font-weight:600;color:#333;white-space:nowrap;margin-left:auto}' +
    '.fot{text-align:center;font-size:8px;color:#aaa;margin-top:8px;padding-top:3px;border-top:1px solid #ddd}' +
    '</style>';

  // Title + Menu table (must fit on 1 page)
  html += '<h1>Haftalık Menü Listesi</h1><div class="sub">' + escapeHtml(weekLabel) + '</div>';
  var durum = currentMenuDurumMeta || {};
  var durumNot = 'Menü Durumu: TASLAK (ONAYSIZ)';
  if (durum.durum === MENU_DURUMLAR.ONAYLANDI) {
    durumNot = 'Menü Durumu: ONAYLANDI' + (durum.onaylayan ? ' - ' + durum.onaylayan : '');
  } else if (durum.durum === MENU_DURUMLAR.ONAY_BEKLIYOR) {
    durumNot = 'Menü Durumu: ONAY BEKLİYOR (ONAYSIZ)';
  } else if (durum.durum === MENU_DURUMLAR.REDDEDILDI) {
    durumNot = 'Menü Durumu: REDDEDİLDİ' + (durum.onay_notu ? ' - ' + durum.onay_notu : '');
  }
  html += '<div class="sub" style="color:#b45309;font-weight:700">' + escapeHtml(durumNot) + '</div>';
  html += '<table class="menu-table"><thead><tr><th></th>';
  for (var di = 0; di < 5; di++) html += '<th>' + gunler[di] + '</th>';
  html += '</tr></thead><tbody>';
  for (var ci = 0; ci < tableData.length; ci++) {
    var row = tableData[ci];
    html += '<tr><td>' + escapeHtml(row.label) + '</td>';
    for (var di = 0; di < 5; di++) {
      var cellVal = escapeHtml(row.cells[di]);
      var nhtml = '';
      if (ci === 0 && dayNotes[di] && dayNotes[di].length) {
        nhtml = '<div style="font-size:6px;color:#888;margin-top:1px">' + dayNotes[di].map(function(n) { return escapeHtml(n); }).join('<br>') + '</div>';
      }
      html += '<td>' + cellVal + nhtml + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';

  // Per-day product lists
  if (prodDaysHtml) {
    html += '<div class="s-title" style="page-break-before:always">Ürün İhtiyaç Listesi</div>' + prodDaysHtml;
  }

  // Weekly total (last)
  if (weeklyHtml) {
    weeklyHtml = weeklyHtml.replace('<div class="s-title">', '<div class="s-title" style="page-break-before:always">');
    html += weeklyHtml;
  }

  html += '<div class="fot">Kırşehir Ahi Evran Üniversitesi - Beslenme Hizmetleri Yönetim Sistemi</div>';
  html += '</div>';
  return html;
}

function printYagList() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  var list = yagRecords.filter(function(r) { return r.tarih; });
  var bas = document.getElementById('yagTarihBas');
  var bit = document.getElementById('yagTarihBit');
  var tur = document.getElementById('yagTurFilter');
  if (bas && bas.value) list = list.filter(function(r) { return r.tarih >= bas.value; });
  if (bit && bit.value) list = list.filter(function(r) { return r.tarih <= bit.value; });
  if (tur && tur.value) list = list.filter(function(r) { return r.tur === tur.value; });
  if (yagSelectedYear) list = list.filter(function(r) { return (r.tarih || '').slice(0, 4) === yagSelectedYear; });
  list.sort(function(a, b) { return new Date(b.tarih) - new Date(a.tarih); });
  if (!list.length) { showToast('Listelenecek kayıt bulunamadı.', 'error'); return; }
  var html = '<div style="padding:10px 14px;font-family:Arial,sans-serif;font-size:11px">';
  html += '<h1 style="font-size:14px;margin:0 0 4px">Atık Yağ Kayıtları</h1>';
  html += '<div style="font-size:10px;color:#888;margin-bottom:6px">' + new Date().toLocaleDateString('tr-TR') + '</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:10px">';
  html += '<thead><tr>';
  ['Tarih','Makbuz No','Yağ Türü','Miktar (lt)','Not'].forEach(function(h) {
    html += '<th style="border:1px solid #bbb;padding:4px 6px;background:#eee;text-align:left;font-weight:700">' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  list.forEach(function(r) {
    html += '<tr>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + displayDate(r.tarih) + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.makbuzNo || '—') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.tur || '—') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + (r.miktar || 0).toFixed(1) + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.not || '—') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  var total = list.reduce(function(s, r) { return s + (r.miktar || 0); }, 0);
  html += '<div style="margin-top:6px;font-size:10px;font-weight:700;text-align:right">' + t('total') + ': ' + total.toFixed(1) + ' lt</div>';
  html += '<div style="text-align:center;font-size:8px;color:#aaa;margin-top:10px;padding-top:4px;border-top:1px solid #ddd">Atık Yağ Kayıt Listesi</div>';
  html += '</div>';
  var win = window.open('', '_blank', 'width=800,height=600');
  if (!win) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  win.document.open();
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Atık Yağ Kayıtları</title></head><body style="margin:0;background:#fff">' + html + '</body></html>');
  win.document.close();
  win.focus();
  triggerPrint(win);
}

function printAmbalajList() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  var list = ambalajRecords.filter(function(r) { return r.tarih; });
  var bas = document.getElementById('ambalajTarihBas');
  var bit = document.getElementById('ambalajTarihBit');
  var tur = document.getElementById('ambalajTurFilter');
  if (bas && bas.value) list = list.filter(function(r) { return r.tarih >= bas.value; });
  if (bit && bit.value) list = list.filter(function(r) { return r.tarih <= bit.value; });
  if (tur && tur.value) list = list.filter(function(r) { return r.tur === tur.value; });
  if (ambalajSelectedYear) list = list.filter(function(r) { return (r.tarih || '').slice(0, 4) === ambalajSelectedYear; });
  list.sort(function(a, b) { return new Date(b.tarih) - new Date(a.tarih); });
  if (!list.length) { showToast('Listelenecek kayıt bulunamadı.', 'error'); return; }
  var html = '<div style="padding:10px 14px;font-family:Arial,sans-serif;font-size:11px">';
  html += '<h1 style="font-size:14px;margin:0 0 4px">Ambalaj Atıkları Kayıtları</h1>';
  html += '<div style="font-size:10px;color:#888;margin-bottom:6px">' + new Date().toLocaleDateString('tr-TR') + '</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:10px">';
  html += '<thead><tr>';
  ['Tarih','Atık Türü','Miktar (kg)','Not'].forEach(function(h) {
    html += '<th style="border:1px solid #bbb;padding:4px 6px;background:#eee;text-align:left;font-weight:700">' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  list.forEach(function(r) {
    var birimLabel = (r.birim || 'kg') === 'g' ? ' gr' : ' kg';
    html += '<tr>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + displayDate(r.tarih) + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.tur || '—') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + (r.miktar || 0).toFixed((r.birim || 'kg') === 'g' ? 0 : 1) + birimLabel + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.not || '—') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  var totalKg = list.reduce(function(s, r) { return s + ((r.birim === 'g') ? (Number(r.miktar) || 0) / 1000 : (Number(r.miktar) || 0)); }, 0);
  html += '<div style="margin-top:6px;font-size:10px;font-weight:700;text-align:right">' + t('total') + ': ' + totalKg.toFixed(1) + ' kg</div>';
  html += '<div style="text-align:center;font-size:8px;color:#aaa;margin-top:10px;padding-top:4px;border-top:1px solid #ddd">Ambalaj Atığı Kayıt Listesi</div>';
  html += '</div>';
  var win = window.open('', '_blank', 'width=800,height=600');
  if (!win) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  win.document.open();
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ambalaj Atıkları Kayıtları</title></head><body style="margin:0;background:#fff">' + html + '</body></html>');
  win.document.close();
  win.focus();
  triggerPrint(win);
}

function printMenu() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  var html = buildExportHTML();
  var win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  win.document.open();
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Haftalık Menü</title></head><body style="margin:0;background:#fff">' + html + '</body></html>');
  win.document.close();
  win.focus();
  triggerPrint(win);
}

// ─── KALİBRASYONA TABİ CİHAZLAR ──────────────────────────────────────────────
const KALIBRASYON_STORAGE_KEY = 'atik_kontrol_kalibrasyon';
let kalibrasyonCihazlari = [];
let editingKalibrasyonId = null;
let kalibrasyonPage = 0;
const KALIBRASYON_PAGE_SIZE = 10;

const KALIBRASYON_DURUMLAR = {
  calisir: { text: 'Çalışır Durumda', cls: 'badge badge-ok' },
  arizali: { text: 'Arızalı', cls: 'badge badge-err' },
  bakim: { text: 'Bakım Yapılacak', cls: 'badge badge-warn' },
  hurda: { text: 'Hurdaya Ayrılacak', cls: 'badge badge-err' }
};

function getCihazDurumBilgi(r) {
  var d = KALIBRASYON_DURUMLAR[r.durum];
  if (!d) return KALIBRASYON_DURUMLAR.calisir;
  return d;
}

function getKalibrasyonDurum(r) {
  var next = r.sonrakiKalibrasyon;
  if (!r.sonKalibrasyon && !next) return 'yapilmadi';
  if (!next) return 'gecerli';
  var todayStr = formatLocalDate(new Date());
  if (next < todayStr) return 'suresi_doldu';
  var d = new Date();
  d.setDate(d.getDate() + 30);
  var limitStr = formatLocalDate(d);
  if (next <= limitStr) return 'yakinlasiyor';
  return 'gecerli';
}

function getKalibrasyonDurumBilgi(r) {
  var st = getKalibrasyonDurum(r);
  if (st === 'yakinlasiyor') return { text: 'Yaklaşıyor', cls: 'badge badge-warn' };
  if (st === 'suresi_doldu') return { text: 'Süresi Doldu', cls: 'badge badge-err' };
  if (st === 'yapilmadi') return { text: 'Yapılmadı', cls: 'badge badge-err' };
  return { text: 'Geçerli', cls: 'badge badge-ok' };
}

function loadKalibrasyonData() {
  try {
    var stored = sessionStorage.getItem(KALIBRASYON_STORAGE_KEY);
    if (stored) {
      kalibrasyonCihazlari = JSON.parse(stored);
    } else {
      stored = localStorage.getItem(KALIBRASYON_STORAGE_KEY);
      if (stored) {
        kalibrasyonCihazlari = JSON.parse(stored);
        try { sessionStorage.setItem(KALIBRASYON_STORAGE_KEY, stored); } catch (_) {}
        try { localStorage.removeItem(KALIBRASYON_STORAGE_KEY); } catch (_) {}
      } else {
        kalibrasyonCihazlari = [];
      }
    }
  } catch (_) { kalibrasyonCihazlari = []; }
  kalibrasyonCihazlari.forEach(function(r) {
    if (!r.durum) r.durum = 'calisir';
    if (r.sonKalibrasyon) r.sonKalibrasyon = normalizeDate(r.sonKalibrasyon);
    if (r.sonrakiKalibrasyon) r.sonrakiKalibrasyon = normalizeDate(r.sonrakiKalibrasyon);
  });
}

function saveKalibrasyonData() {
  try { sessionStorage.setItem(KALIBRASYON_STORAGE_KEY, JSON.stringify(kalibrasyonCihazlari)); } catch (_) {}
}

function renderKalibrasyonOzet(list) {
  const grid = document.getElementById('kalibrasyonOzetGrid');
  if (!grid) return;
  const toplam = list.length;
  var gecerli = 0, doldu = 0, yapilmadi = 0, calisir = 0, arizali = 0, bakim = 0, hurda = 0, yaklasan = 0;
  var bolumler = new Set();
  list.forEach(function(r) {
    var st = getKalibrasyonDurum(r);
    if (st === 'gecerli') gecerli++;
    else if (st === 'yakinlasiyor') yaklasan++;
    else if (st === 'suresi_doldu') doldu++;
    else yapilmadi++;
    var d = r.durum;
    if (d === 'arizali') arizali++;
    else if (d === 'bakim') bakim++;
    else if (d === 'hurda') hurda++;
    else calisir++;
    if (r.konum) bolumler.add(r.konum);
  });
  var fmtN = function(v) { return v.toLocaleString('tr-TR'); };
  var html = `
    <div class="report-item">
      <span class="report-label"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>Toplam Cihaz</span>
      <span class="report-value">${fmtN(toplam)}</span>
    </div>
    <div class="report-item">
      <span class="report-label" style="color:#10b981"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Çalışır Durumda</span>
      <span class="report-value" style="color:#10b981">${fmtN(calisir)}</span>
    </div>
    <div class="report-item">
      <span class="report-label" style="color:#ef4444"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>Arızalı</span>
      <span class="report-value" style="color:#ef4444">${fmtN(arizali)}</span>
    </div>
    <div class="report-item">
      <span class="report-label" style="color:#f59e0b"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>Bakım Yapılacak</span>
      <span class="report-value" style="color:#f59e0b">${fmtN(bakim)}</span>
    </div>
    <div class="report-item">
      <span class="report-label" style="color:#ef4444"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>Hurdaya Ayrılacak</span>
      <span class="report-value" style="color:#ef4444">${fmtN(hurda)}</span>
    </div>
    <div class="report-item">
      <span class="report-label" style="color:#10b981"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 11 12 14 15 9"/></svg>Kalibrasyonu Geçerli</span>
      <span class="report-value" style="color:#10b981">${fmtN(gecerli)}</span>
    </div>
    <div class="report-item">
      <span class="report-label" style="color:#f59e0b"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Kalibrasyonu Yaklaşan (30 Gün)</span>
      <span class="report-value" style="color:#f59e0b">${fmtN(yaklasan)}</span>
    </div>
    <div class="report-item">
      <span class="report-label"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>Farklı Bölüm</span>
      <span class="report-value">${fmtN(bolumler.size)}</span>
    </div>
  `;
  grid.innerHTML = html;
}

function renderKalibrasyon() {
  const tbody = document.getElementById('kalibrasyonTbody');
  const table = document.getElementById('kalibrasyonTable');
  const empty = document.getElementById('kalibrasyonEmpty');
  const badge = document.getElementById('kalibrasyonBadge');
  if (!tbody || !table || !empty) return;

  badge.textContent = kalibrasyonCihazlari.length + ' cihaz';

  if (kalibrasyonCihazlari.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    renderKalibrasyonOzet([]);
    return;
  }

  let filtered = [...kalibrasyonCihazlari];
  var durumFilter = document.getElementById('kalibrasyonDurumFilter');
  if (durumFilter && durumFilter.value) {
    var fd = durumFilter.value;
    filtered = filtered.filter(function(r) { return (r.durum || 'calisir') === fd; });
  }
  var konumFilter = document.getElementById('kalibrasyonKonumFilter');
  if (konumFilter && konumFilter.value.trim()) {
    var kw = konumFilter.value.trim().toLowerCase();
    filtered = filtered.filter(function(r) { return (r.konum || '').toLowerCase().indexOf(kw) !== -1; });
  }

  if (filtered.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = 'Bu filtreleme kriterlerine uygun cihaz bulunamadı.';
    renderKalibrasyonOzet([]);
    return;
  }
  empty.querySelector('p').textContent = 'Henüz kalibrasyona tabi cihaz kaydı girilmemiş.';

  renderKalibrasyonOzet(filtered);

  empty.style.display = 'none';
  table.style.display = 'table';

  const sorted = filtered.sort(function(a, b) { return (a.cihazAdi || '').localeCompare(b.cihazAdi || ''); });
  const totalPages = Math.ceil(sorted.length / KALIBRASYON_PAGE_SIZE);
  if (kalibrasyonPage >= totalPages) kalibrasyonPage = Math.max(0, totalPages - 1);
  const start = kalibrasyonPage * KALIBRASYON_PAGE_SIZE;
  const pageItems = sorted.slice(start, start + KALIBRASYON_PAGE_SIZE);
  var canEditK = canEditKalibrasyonRecords();

  tbody.innerHTML = pageItems.map(r => {
    var durumB = getCihazDurumBilgi(r);
    var kalB = getKalibrasyonDurumBilgi(r);
    var actionCell = canEditK
      ? '<td>' +
        '<button class="btn-icon" onclick="editKalibrasyonRecord(' + r.id + ')" title="Düzenle">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button class="btn-icon" onclick="deleteKalibrasyonRecord(' + r.id + ')" title="Sil" style="color:var(--danger)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
        '</button>' +
        '</td>'
      : '<td></td>';
    return `<tr>
      <td>${escapeHtml(r.cihazAdi || '—')}</td>
      <td>${escapeHtml(r.markaModel || '—')}</td>
      <td>${escapeHtml(r.sicilNo || '—')}</td>
      <td><span class="${durumB.cls}">${durumB.text}</span></td>
      <td><span class="${kalB.cls}">${kalB.text}</span></td>
      <td>${displayDate(r.sonKalibrasyon)}</td>
      <td>${displayDate(r.sonrakiKalibrasyon)}</td>
      <td>${escapeHtml(r.konum || '—')}</td>
      <td>${escapeHtml(r.sorumlu || '—')}</td>
      <td>${escapeHtml(r.not || '—')}</td>
      ${actionCell}
    </tr>`;
  }).join('');

  const pagination = document.getElementById('kalibrasyonPagination');
  if (pagination) {
    if (totalPages > 1) {
      var fp = kalibrasyonPage === 0;
      var lp = kalibrasyonPage >= totalPages - 1;
      pagination.innerHTML =
        '<button class="btn-icon" data-kalibrasyon-page="0"' + (fp ? ' disabled style="opacity:0.4"' : '') + '>«</button>' +
        '<button class="btn-icon" data-kalibrasyon-page="' + (kalibrasyonPage - 1) + '"' + (fp ? ' disabled style="opacity:0.4"' : '') + '>‹</button>' +
        '<span style="font-weight:600;margin:0 4px">' + (kalibrasyonPage + 1) + ' / ' + totalPages + '</span>' +
        '<button class="btn-icon" data-kalibrasyon-page="' + (kalibrasyonPage + 1) + '"' + (lp ? ' disabled style="opacity:0.4"' : '') + '>›</button>' +
        '<button class="btn-icon" data-kalibrasyon-page="' + (totalPages - 1) + '"' + (lp ? ' disabled style="opacity:0.4"' : '') + '>»</button>' +
        '<span style="color:var(--text-muted);font-size:0.8rem;margin-left:8px">' + filtered.length + ' cihaz</span>';
    } else {
      pagination.innerHTML = '';
    }
  }
}

function openKalibrasyonModal(id) {
  if (id) {
    if (!canEditKalibrasyonRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddKalibrasyonRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  }
  editingKalibrasyonId = id || null;
  const overlay = document.getElementById('kalibrasyonModal');
  const title = document.getElementById('kalibrasyonModalTitle');
  const form = document.getElementById('kalibrasyonForm');

  form.reset();
  document.getElementById('kfDurum').value = 'calisir';

  if (id) {
    const rec = kalibrasyonCihazlari.find(r => r.id === id);
    if (!rec) return;
    title.textContent = 'Kalibrasyona Tabi Cihazı Düzenle';
    document.getElementById('kfCihazAdi').value = rec.cihazAdi || '';
    document.getElementById('kfMarkaModel').value = rec.markaModel || '';
    document.getElementById('kfSicilNo').value = rec.sicilNo || '';
    document.getElementById('kfDurum').value = rec.durum || 'calisir';
    document.getElementById('kfDogrulama').value = rec.dogrulama || '';
    document.getElementById('kfSonKalibrasyon').value = rec.sonKalibrasyon || '';
    document.getElementById('kfSonrakiKalibrasyon').value = rec.sonrakiKalibrasyon || '';
    document.getElementById('kfKonum').value = rec.konum || '';
    document.getElementById('kfSorumlu').value = rec.sorumlu || '';
    document.getElementById('kfNot').value = rec.not || '';
  } else {
    title.textContent = 'Yeni Kalibrasyona Tabi Cihaz';
  }

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeKalibrasyonModal() {
  document.getElementById('kalibrasyonModal').classList.remove('open');
  document.body.style.overflow = '';
  editingKalibrasyonId = null;
}

function saveKalibrasyonRecord(e) {
  e.preventDefault();
  if (editingKalibrasyonId) {
    if (!canEditKalibrasyonRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddKalibrasyonRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  }

  var cihazAdi = document.getElementById('kfCihazAdi').value.trim();
  if (!cihazAdi) { showToast('Cihaz adı gerekli.', 'error'); return; }

  var rec = {
    id: editingKalibrasyonId || Date.now(),
    cihazAdi: cihazAdi,
    markaModel: document.getElementById('kfMarkaModel').value.trim(),
    sicilNo: document.getElementById('kfSicilNo').value.trim(),
    durum: document.getElementById('kfDurum').value,
    dogrulama: document.getElementById('kfDogrulama').value.trim(),
    sonKalibrasyon: document.getElementById('kfSonKalibrasyon').value,
    sonrakiKalibrasyon: document.getElementById('kfSonrakiKalibrasyon').value,
    konum: document.getElementById('kfKonum').value.trim(),
    sorumlu: document.getElementById('kfSorumlu').value.trim(),
    not: document.getElementById('kfNot').value.trim()
  };

  if (editingKalibrasyonId) {
    const idx = kalibrasyonCihazlari.findIndex(r => r.id === editingKalibrasyonId);
    if (idx !== -1) kalibrasyonCihazlari[idx] = rec;
    showToast('Cihaz bilgisi güncellendi.', 'success');
    logIslem('kayit_duzenle', 'kalibrasyon #' + editingKalibrasyonId + ' güncellendi');
  } else {
    kalibrasyonCihazlari.push(rec);
    showToast('Cihaz kaydı eklendi.', 'success');
    logIslem('yeni_kayit', 'kalibrasyon ' + (rec.cihazAdi || ''));
  }

  saveKalibrasyonData();
  renderKalibrasyon();
  renderKPIs();
  syncKalibrasyonSilent();
  closeKalibrasyonModal();
}

function editKalibrasyonRecord(id) { openKalibrasyonModal(id); }

async function deleteKalibrasyonRecord(id) {
  if (!canEditKalibrasyonRecords()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  if (!confirm('Bu cihaz kaydını silmek istediğinize emin misiniz?')) return;
  kalibrasyonCihazlari = kalibrasyonCihazlari.filter(r => r.id !== id);
  saveKalibrasyonData();
  if (supabaseClient) {
    try { await supabaseClient.from('kalibrasyon_cihazlari').delete().eq('id', id); } catch (_) {}
  }
  renderKalibrasyon();
  renderKPIs();
  syncKalibrasyonSilent();
  showToast('Cihaz kaydı silindi.', 'success');
  logIslem('kayit_sil', 'kalibrasyon #' + id + ' silindi');
}

function exportKalibrasyonCSV() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  if (kalibrasyonCihazlari.length === 0) { showToast('İndirilecek kayıt yok.', 'error'); return; }
  var headers = ['Cihaz Adı', 'Marka-Model', 'Sicil No', 'Cihaz Durumu', 'Kalibrasyon Durumu', 'Doğrulama', 'Son Kalibrasyon', 'Bir Sonraki Kalibrasyon', 'Bölüm', 'Sorumlu', 'Not', 'id'];
  var rows = [headers.join(',')];
  kalibrasyonCihazlari.forEach(function(r) {
    var cihazB = getCihazDurumBilgi(r);
    var kalB = getKalibrasyonDurumBilgi(r);
    var vals = [
      r.cihazAdi || '', r.markaModel || '', r.sicilNo || '', cihazB.text, kalB.text,
      r.dogrulama || '', r.sonKalibrasyon || '', r.sonrakiKalibrasyon || '',
      r.konum || '', r.sorumlu || '', r.not || '', r.id
    ];
    vals = vals.map(function(v) {
      v = String(v).replace(/"/g, '""');
      return v.indexOf(',') > -1 ? '"' + v + '"' : v;
    });
    rows.push(vals.join(','));
  });
  var blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'Kalibrasyon_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(kalibrasyonCihazlari.length + ' kayıt CSV olarak indirildi.', 'success');
}

function printKalibrasyonList() {
  if (!canExport()) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
  var list = [...kalibrasyonCihazlari].sort(function(a, b) { return (a.cihazAdi || '').localeCompare(b.cihazAdi || ''); });
  if (!list.length) { showToast('Listelenecek cihaz bulunamadı.', 'error'); return; }
  var html = '<div style="padding:10px 14px;font-family:Arial,sans-serif;font-size:11px">';
  html += '<h1 style="font-size:14px;margin:0 0 4px">Kalibrasyona Tabi Cihazlar</h1>';
  html += '<div style="font-size:10px;color:#888;margin-bottom:6px">' + new Date().toLocaleDateString('tr-TR') + '</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:10px">';
  html += '<thead><tr>';
  ['Cihaz Adı', 'Marka-Model', 'Sicil No', 'Durum', 'Kal.', 'Son Kal.', 'Bir Sonraki', 'Bölüm', 'Sorumlu'].forEach(function(h) {
    html += '<th style="border:1px solid #bbb;padding:4px 6px;background:#eee;text-align:left;font-weight:700">' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  list.forEach(function(r) {
    var cihazB = getCihazDurumBilgi(r);
    var kalB = getKalibrasyonDurumBilgi(r);
    var renkC = cihazB.cls.indexOf('err') !== -1 ? '#ef4444' : cihazB.cls.indexOf('warn') !== -1 ? '#f59e0b' : '#10b981';
    var renkK = kalB.cls.indexOf('err') !== -1 ? '#ef4444' : kalB.cls.indexOf('warn') !== -1 ? '#f59e0b' : '#10b981';
    html += '<tr>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.cihazAdi || '—') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.markaModel || '—') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.sicilNo || '—') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px;font-weight:700;color:' + renkC + '">' + cihazB.text + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px;font-weight:700;color:' + renkK + '">' + kalB.text + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + displayDate(r.sonKalibrasyon) + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + displayDate(r.sonrakiKalibrasyon) + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.konum || '—') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.sorumlu || '—') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  html += '<div style="margin-top:6px;font-size:10px;font-weight:700;text-align:right">' + t('total') + ': ' + list.length + ' ' + t('devices') + '</div>';
  html += '<div style="text-align:center;font-size:8px;color:#aaa;margin-top:10px;padding-top:4px;border-top:1px solid #ddd">Kalibrasyona Tabi Cihaz Listesi</div>';
  html += '</div>';
  var win = window.open('', '_blank', 'width=800,height=600');
  if (!win) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  win.document.open();
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Kalibrasyona Tabi Cihazlar</title></head><body style="margin:0;background:#fff">' + html + '</body></html>');
  win.document.close();
  win.focus();
  triggerPrint(win);
}

// ─── YUKARI ÇIK BUTONU ──────────────────────────────────────────────────────
(function() {
  function getScroller() {
    var active = document.querySelector('.tab-content.active');
    if (active && active.scrollHeight > active.clientHeight) return active;
    return document.querySelector('.main-content');
  }
  function getScrollTop() {
    var sc = getScroller();
    if (!sc) return window.pageYOffset || document.documentElement.scrollTop || 0;
    return sc.scrollTop || 0;
  }
  function updateBtn() {
    var btn = document.getElementById('scrollTopBtn');
    if (!btn) return;
    btn.classList.toggle('visible', getScrollTop() > 240);
  }
  window.scrollToTopApp = function() {
    var sc = getScroller();
    if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
    var btn = document.getElementById('scrollTopBtn');
    if (btn) btn.classList.remove('visible');
  };
  // capture=true: iç konteynerlerin scroll olaylarını da yakalar
  document.addEventListener('scroll', updateBtn, true);
  window.addEventListener('scroll', updateBtn);
  document.addEventListener('click', function() { setTimeout(updateBtn, 400); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateBtn);
  else updateBtn();
})();

// ─── I18N TRANSLATIONS ─────────────────────────────────────────────────────────
var I18N = {
  tr: {
    loginSub: "BESLENME HİZMETLERİ YÖNETİM SİSTEMİ",
    loginFormSub: "Giriş Yapınız",
    loginUsername: "Kullanıcı",
    loginSelectUser: "Kullanıcı Seçin",
    loginPassword: "Şifre",
    loginBtn: "Giriş Yap",
    loginHint: "Şifrenizi yöneticinizden alabilirsiniz",
    loginFeature1: "Menü Planlaması, Günlük Üretim, Tüketim ve Atık Takibi",
    loginFeature2: "Detaylı Raporlama",
    loginFeature3: "Canlı Panel ve Grafikler",
    loginRemember: "Beni Hatırla",
    loginForgot: "Şifremi Unuttum?",
    loginForgotTitle: "Şifremi Unuttum",
    loginForgotText: "Şifre talebi için lütfen mustafa.orhan@ahievran.edu.tr adresine e-posta gönderin.",
    loginForgotOk: "Kapat",
    loginSecure: "Güvenli Bağlantı",
    menuLabel: "Menü",
    headerSubtitle: "Beslenme Hizmetleri Yönetim Sistemi",
    btnLogout: "Çıkış",
    btnPrev: "Önceki",
    btnNext: "Sonraki",
    loading: "Yükleniyor...",
    loadingText: "Veriler senkronize ediliyor...",
    loadingSub: "Supabase bağlantısı kontrol ediliyor",
    loadingSkip: "Tıklayarak geç",
    versionLabel: "Uygulama Sürümü",
    sidebarPanel: "Panel",
    sidebarMenu: "Haftalık Menü",
    sidebarRecords: "Kayıtlar",
    sidebarReport: "Rapor",
    sidebarHaccp: "Gıda Güvenliği",
    sidebarCalibration: "Kalibrasyon",
    sidebarOil: "Atık Yağ",
    sidebarPackaging: "Ambalaj Atıkları",
    sidebarCharts: "Grafikler",
    sidebarYearly: "Yıllık Karşılaştırma",
    sidebarSpending: "Harcama",
    sidebarUnitPrice: "Ürün ve Fiyatlar",
    sidebarDownload: "Tümünü İndir",
    sidebarBackup: "Supabase'e Yedekle",
    sidebarRestore: "Supabase'ten Çek",
    sidebarAdmin: "Yönetim",
    sidebarLogs: "Log Kayıtları",
    sidebarTheme: "Tema",
    sidebarManual: "Kullanım Kılavuzu",
    dashboardPrintPdf: "PDF Yazdır",
    kpiTotalRecords: "Toplam Üretim Günü",
    kpiTodayProduction: "Bugünkü Üretim",
    kpiHaccpAlarm: "Soğuk Hava Depo Sıcaklık Alarmı",
    kpiCalibrationAlarm: "Kalibrasyon Alarmı",
    kpiAvgWaste: "Ort. Atık (kg)",
    kpiTotalPasses: "Turnikeden Toplam Geçiş Rakamı",
    kpiTotalWaste: "Toplam Atık (kg)",
    kpiWasteRate: "Atık Oranı",
    weeklyPrevBtn: "Önceki Hafta",
    weeklySummary: "Haftalık Özet",
    weeklyNextBtn: "Sonraki Hafta",
    weeklyBadge: "Bu Hafta",
    dailyPrevBtn: "Önceki Gün",
    dailySummary: "Günlük Detay",
    dailyNextBtn: "Sonraki Gün",
    weeklyCompTitle: "Haftalık Karşılaştırma",
    monthlyCompTitle: "Aylık Karşılaştırma",
    monthlyBadge: "Bu Ay",
    yearlyBadge: "Bu Yıl",
    anomalyTitle: "Anomali Tespiti",
    anomalyBadge: "Anormal Atık Günleri",
    lastRecordsTitle: "Son Kayıtlar",
    dashboardGoToRecords: "Kayıtlara Git",
    emptyDashboard: "Henüz kayıt yok...",
    formulaTitle: "ATIK HESAPLAMA FORMÜLÜ",
    recordsEntryBtn: "Üretim Tüketim Gir",
    recordsImportBtn: "İçe Aktar",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "CSV İndir",
    recordsDeleteBtn: "Seçilileri Sil",
    emptyRecords: "Gösterilecek kayıt bulunamadı.",
    thDate: "Tarih",
    thProducedPerson: "Üretilen Yemek (Kişi)",
    thWaste10: "%10 Fire",
    thBeneficiary: "Yemek Hiz. Yararlanan Personel ve Öğrenci",
    thPortionGr: "Porsiyon (gr)",
    thWasteKg: "Atık (kg)",
    thWastedPortion: "Çöpe Giden (pors.)",
    thFoodType: "Yemek Türü",
    thAction: "İşlem",
    thAcademicStaff: "Turnikeden Geçen Akademik ve İdari Personel",
    thStudentCount: "Turnikeden Geçen Öğrenci Sayısı",
    thBeneficiaryTotal: "Yemek Hiz. Yararlanan Toplam Kişi",
    sksStaff: "SKS Yemek Hizmeti Personeli",
    summaryReport: "Özet Rapor",
    reportPdfBtn: "PDF Aç",
    allRecordsPrint: "Tüm Kayıtlar (Yazdırma Görünümü)",
    rTotalRecords: "Toplam Kayıt Sayısı",
    rTotalMeals: "Toplam Üretilen Yemek",
    rTotalWaste10: "Toplam %10 Fire",
    rTotalAfterWaste: "Toplam %10 Fire Sonrası Yemek",
    rTotalTurnstile: "Toplam Turnike Geçisi",
    rTotalBeneficiary: "Yemek Hiz. Yararlanan Toplam Kişi",
    rTotalStaff: "Yararlanan Toplam SKS Personeli",
    rPortionSize: "Porsiyon Miktarı (gr)",
    rTotalPortion: "Toplam Porsiyon (gr)",
    rWastedPortion: "Çöpe Giden Porsiyon",
    rMaxWeeklyBeneficiary: "En Yüksek Haftalık Yararlanan Kişi",
    rTotalWasteKg: "Toplam Atık Miktarı (kg)",
    rAvgWasteKg: "Ort. Atık Miktarı (kg)",
    rTotalStudents: "Toplam Öğrenci Sayısı",
    rMaxWaste: "En Yüksek Atık (kg)",
    rMinWaste: "En Düşük Atık (kg)",
    rWasteTrend: "Atık Trendi (son 7 gün)",
    rBeneficiaryTrend: "Yemek Hiz. Yararlanan Trendi (son 7 gün)",
    wasteByFoodTitle: "Yemek Türü Bazında Atık Analizi",
    wasteByFoodEmpty: "Yemek türü verisi girilen kayıt bulunamadı.",
    wasteByFoodRecords: "Kayıt Sayısı",
    wasteByFoodRate: "Atık Oranı",
    wasteByFoodPerPerson: "Kişi Başı Atık (kg)",
    wsProducedMeal: "Üretilen Yemek (Kişi)",
    wsTotalPasses: "Toplam Geçiş",
    wsTurnstile: "Turnike",
    wsStaffSKS: "Y. Hiz. Yr. SKS",
    wsWasteAmount: "Atık Miktarı",
    wsWastedPortion: "Çöpe Giden",
    wsStudents: "Y.H. Yar. Öğrenci",
    wsNoRecordsYet: "Henüz kayıt yok",
    wsNoRecordThisWeek: "Bu hafta kayıt yok",
    wsNoRecordToday: "Kayıt yok",
    wsTodayDetail: "Bugünün Detayı",
    wsDailyDetail: "Günlük Detay",
    wsWaste: "Fire",
    wsPortion: "porsiyon",
    wsProduced: "Üretilen",
    wsTurnstileCount: "Turnike Geçiş",
    wsStaffCount: "Personel",
    menuTitle: "Haftalık Menü Listesi",
    menuStatusBadge: "Durum",
    menuSaveBtn: "Kaydet",
    menuSendBtn: "Onaya Gönder",
    menuApproveBtn: "Onayla",
    menuRejectBtn: "Reddet",
    menuWithdrawBtn: "Onayı Kaldır",
    menuClearBtn: "Tabloyu Temizle",
    menuPrintBtn: "Yazdır",
    menuFoodListBtn: "Yemek Listesi",
    menuFoodListUploadBtn: "CSV Yükle",
    menuFoodListCsvBtn: "CSV İndir",
    menuWarningPrefix: "Onaysız Menü:",
    menuWarningText: "Bu haftanın menüsü henüz gıda mühendisi tarafından onaylanmadı.",
    menuHintText: "Yemek isimlerini yazın...",
    productNeedsTitle: "Ürün İhtiyaç Listesi",
    weeklyNeedsTitle: "Haftalık Toplam İhtiyaç Listesi",
    foodListTitle: "Yemek Listesi",
    modalRejectMenu: "Menüyü Reddet",
    modalRejectDesc: "Red gerekçesi zorunludur.",
    menuRejectConfirm: "Reddet",
    haccpTitle: "Gıda Güvenliği Yönetimi",
    haccpCsvBtn: "CSV İndir",
    haccpColdStorage: "Soğuk Depo Sıcaklık Kayıtları",
    haccpNewBtn: "Yeni Kayıt",
    haccpDepotBtn: "Depo Adları",
    haccpDepoQrNote: "Depo adlarını düzenleyip QR butonuyla her depo için QR kod oluşturabilirsiniz.",
    haccpModalTitle: "Yeni Kayıt",
    filterDepot: "Depo Filtresi:",
    filterAll: "Tümü",
    filterDateRange: "Tarih Aralığı:",
    emptyHaccp: "Henüz sıcaklık kaydı girilmemiş.",
    btnDeleteSelectedHaccp: "Seçili Sil",
    btnPdf: "PDF",
    depoNamesTitle: "Depo Adları",
    oilNewBtn: "Yeni Kayıt",
    oilListBtn: "Liste",
    oilFilterTitle: "Atık Yağ Filtreleri",
    filterOilType: "Yağ Türü:",
    btnReset: "Sıfırla",
    oilSummaryTitle: "Atık Yağ Özeti",
    oilChartTitle: "Atık Yağ Grafikleri",
    oilChartSubtitle: "Aylık Atık Yağ Miktarı (lt)",
    oilChartEmpty: "Atık yağ kaydı girildiğinde grafik gösterilecek",
    oilChartNote: "Tarih, yağ türü ve yıl filtrelerine göre aylık atık yağ toplamları",
    oilRecordsTitle: "Atık Yağ Kayıtları",
    oilModalTitle: "Atık Yağ Kaydı",
    emptyOil: "Henüz atık yağ kaydı girilmemiş.",
    ambalajNewBtn: "Yeni Kayıt",
    ambalajListBtn: "Liste",
    packagingFilterTitle: "Ambalaj Atığı Filtreleri",
    filterWasteType: "Atık Türü:",
    packagingSummaryTitle: "Ambalaj Atığı Özeti",
    packagingChartTitle: "Ambalaj Atığı Grafikleri",
    packagingChartSubtitle: "Aylık Ambalaj Atığı Miktarı (kg)",
    packagingChartEmpty: "Ambalaj atığı kaydı girildiğinde grafik gösterilecek",
    packagingChartNote: "Tarih, atık türü ve yıl filtrelerine göre aylık ambalaj atığı toplamları (kg)",
    packagingRecordsTitle: "Ambalaj Atıkları Kayıtları",
    packagingModalTitle: "Ambalaj Atığı Kaydı",
    emptyPackaging: "Henüz ambalaj atığı kaydı girilmemiş.",
    kalibrasyonNewBtn: "Yeni Cihaz",
    kalibrasyonListBtn: "Liste",
    kalibrasyonCsvBtn: "CSV İndir",
    calibrationSummary: "Kalibrasyon Özeti",
    calibrationDevices: "Kalibrasyona Tabi Cihazlar",
    calibrationModalTitle: "Kalibrasyona Tabi Cihaz",
    filterStatus: "Durum:",
    filterDepartment: "Bölüm:",
    btnWordExport: "Word'e Aktar",
    btnPrint: "PDF Yazdır",
    chartProdWaste: "Üretim - Geçiş - Atık Karşılaştırması",
    chartEmpty: "Veri girildiğinde grafik gösterilecek",
    chartProdWasteNote: "Üretim, turnike geçisi ve Çöpe Giden porsiyonun aylık karşılaştırması",
    chartStudentCount: "Beslenme Hizmetlerinden Yararlanan Öğrenci Sayısı",
    yearTotal: "Yıl Toplamı",
    chartStudentNote: "Günlük öğrenci geçişlerinin aylık toplamı",
    chartStaffTotal: "Akademik ve İdari + SKS Personeli Toplamı",
    chartStaffNote: "Akademik ve İdari (Turnike - Öğrenci) ile SKS Yemek Hizmeti Personeli toplamı",
    chartMonthlyProd: "Aylık Yemek Üretimi",
    chartMonthlyProdNote: "Günlük üretilen yemek sayılarının aylık toplamı",
    chartMonthlyTurnstile: "Aylık Turnike Geçiş Sayıları",
    chartTurnstileNote: "Öğrenci + personel + dış geçiş toplamı",
    chartMonthlyWaste: "Aylık Atık Miktarı (kg)",
    chartMonthlyWasteNote: "Günlük atıkların aylık toplamı (kg)",
    chartMonthlyWastePortion: "Aylık Atık Miktarı (porsiyon)",
    chartWastePortionNote: "Günlük Çöpe Giden porsiyonların aylık toplamı",
    chartDiff: "Üretim ile Geçis Arasındaki Fark",
    chartDiffNote: "Üretilen yemek sayısı ile turnike geçisi arasındaki fark",
    chartWasteRatio: "Üretilen Yemeğe Oranla Atık %",
    yearAverage: "Yıl Ortalaması",
    chartWasteRatioNote: "Üretilen yemeğin yüzde kaçı atık oluyor",
    chartWastePerPerson: "Kişi Başı Atık (kg/kişi)",
    chartWastePerPersonNote: "Yemekhaneye giren kişi başına düşen ortalama atık",
    chartMonthlyTemp: "Aylık Ortalama Depo Sıcaklıkları (°C)",
    chartTempEmpty: "Sıcaklık kaydı girildiğinde grafik gösterilecek",
    chartTempNote: "Her deponun aylık ortalama sıcaklığı",
    yearlyPdfBtn: "PDF Yazdır",
    yearlyTotalProd: "Toplam Üretim Karşılaştırması",
    yearlyTotalProdNote: "Yıl toplamı - 1. yıl vs 2. yıl (porsiyon)",
    yearlyTotalBen: "Yemek Hiz. Yararlanan Toplam Kişi",
    yearlyTotalBenNote: "Yıl toplamı - 1. yıl vs 2. yıl (toplam kişi)",
    yearlyStudentComp: "Yemek Hizmetinden Yararlanan Öğrenci Karşılaştırması",
    yearlyStudentNote: "Yıl toplamı - 1. yıl vs 2. yıl (öğrenci)",
    yearlyWasteComp: "Atık Karşılaştırması (kg)",
    yearlyWasteNote: "Yıl toplamı - 1. yıl vs 2. yıl (kg)",
    yearlyMonthlyProd: "Aylık Üretim Karşılaştırması",
    yearlyMonthlyProdNote: "1. yıl vs 2. yıl - üretilen yemek sayısı (porsiyon)",
    yearlyMonthlyTurnstile: "Aylık Turnike Geçiş Karşılaştırması",
    yearlyMonthlyTurnstileNote: "1. yıl vs 2. yıl - turnike geçiş sayısı",
    yearlyMonthlyStudent: "Aylık Öğrenci Turnike Geçisi Karşılaştırması",
    yearlyMonthlyStudentNote: "1. yıl vs 2. yıl - öğrenci turnike geçiş sayısı",
    yearlyMonthlyWaste: "Aylık Atık Karşılaştırması (kg)",
    yearlyMonthlyWasteNote: "1. yıl vs 2. yıl - atık miktarı (kg)",
    yearlyWasteListTitle: "Yıllık Atık Listesi",
    spendingRatesTitle: "Kişi Başı Harcama Oranları (Öğrenci, Personel & Yemek)",
    spendingStudentRate: "Öğrenci Başı Harcama Tutarı (TL)",
    btnSaveStudentRate: "Ögr. Tutar Kaydet",
    spendingStaffRate: "Personel Başı Harcama Tutarı (TL)",
    btnSaveStaffRate: "Pers. Tutar Kaydet",
    spendingMealRate: "Yemek Başı Harcama Tutarı (TL)",
    btnSaveMealRate: "Yemek Tutar Kaydet",
    spendingDesc: "Öğrenci Harcama = Öğrenci Sayısı × Öğrenci Başı Tutar",
    spendingStudentTitle: "Öğrenci Harcama Tutarı (TL)",
    spendingChartEmpty: "Kayıt girildiğinde grafik gösterilecek",
    spendingStudentNote: "Öğrenci Harcama (TL) = Öğrenci Sayısı × Öğrenci Başı Harcama Tutarı",
    spendingStaffTitle: "Personel Harcama Tutarı (TL)",
    spendingStaffNote: "Personel Harcama (TL) = Personel Sayısı × Personel Başı Harcama Tutarı",
    spendingMealTitle: "Yemek Harcama Tutarı (TL)",
    spendingMealNote: "Yemek Harcama (TL) = Üretilen Yemek Sayısı × Yemek Başı Harcama Tutarı",
    spendingTableTitle: "Harcama Hesaplama Tablosu",
    syncTitle: "Supabase Senkronizasyon",
    syncCloseBtn: "Kapat",
    modalNewRecord: "Yeni Kayıt Ekle",
    formDate: "Tarih",
    formProducedCount: "Üretilen Yemek Sayısı",
    formTurnstileCount: "Turnike Geçiş Sayısı",
    formStudentCount: "Yemek Hiz. Yar. Öğr. Sayısı",
    formFoodType: "Yemek Türü",
    formAutoCalc: "Otomatik Hesaplamalar",
    badgeAutomatic: "Otomatik",
    badgeFixed: "Sabit",
    badgeAutoEditable: "Otomatik + Düzenlenebilir",
    btnCancel: "İptal",
    entryFormSubmit: "Kaydet",
    formReceiptNo: "Makbuz No",
    formOilType: "Yağ Türü",
    formAmountLt: "Miktar (lt)",
    formNote: "Not",
    formWasteType: "Atık Türü",
    formAmount: "Miktar",
    formDeviceName: "Cihaz Adı",
    formBrandModel: "Marka-Model",
    formSerialNo: "Sicil No",
    formStatus: "Durum",
    formVerification: "Doğrulama",
    formLastCalibration: "Son Kalibrasyon",
    formNextCalibration: "Bir Sonraki Kalibrasyon",
    formLocation: "Bulunduğu Yer/Bölüm",
    formResponsible: "Sorumlu Kişi",
    btnSave: "Kaydet",
    btnAdd: "Ekle",
    btnClose: "Kapat",
    qrTitle: "QR Kod",
    qrHint: "QR kodu depo kapılarına asmak için yazdırın.",
    adminTitle: "Yönetim Paneli",
    adminReAuthText: "Admin paneline erişim için lütfen admin şifrenizi girin.",
    adminPassword: "Admin Şifresi",
    btnVerify: "Doğrula",
    adminSessionRole: "Oturum Rolü",
    adminLastLogin: "Son Giriş",
    adminAuthMethod: "Auth Yöntemi",
    adminStorage: "Şifre Deposu",
    adminDataSource: "Veri Kaynağı",
    adminUserMgmt: "Kullanıcı Yönetimi",
    adminUserMgmtDesc: "Kullanıcıları ekleyin, düzenleyin veya silin.",
    adminAddUser: "Yeni Kullanıcı Ekle",
    adminUsername: "Kullanıcı Adı",
    adminDisplayName: "Görünen Ad",
    adminPasswordLabel: "Şifre",
    adminRole: "Rol",
    adminAddUserBtn: "Kullanıcı Ekle",
    adminRolePerms: "Rol Bazlı İzin Ayarları",
    adminRolePermsDesc: "Her rol için hangi sekmeleri görebileceğini ayarlayın.",
    adminSecurity: "Oturum Güvenliği",
    adminSecurityDesc: "Belirtilen süre boyunca hiçbir işlem yapılmazsa oturum kapanır.",
    adminInactivityTimeout: "Hareketsizlik Kapanma Süresi",
    adminLogsTitle: "İşlem Log Kayıtları",
    adminLogsDesc: "Kullanıcı giriş/çıkış ve kayıt işlemleri",
    btnRefresh: "Yenile",
    adminSaveBtn: "Ayarları Kaydet",
    adminFooterNote: "Şifreler sunucuda kalıcı olarak saklanır.",
    adminCloseBtn: "Kapat",
    logFilterDelete: "Silme",
    logFilterAddUser: "Kullanıcı Ekle",
    logFilterDeleteUser: "Kullanıcı Sil",
    adminRefreshBtn: "Yenile",
    manualTitle: "Kullanım Kılavuzu",
    manualSubtitle: "Yemekhane Üretim, Tüketim ve Atık Kontrol Sistemi",
    compDataType: "Veri Türü",
    compLastWeek: "Geçen Hafta",
    compThisWeek: "Bu Hafta",
    compLastMonth: "Geçen Ay",
    compThisMonth: "Bu Ay",
    compLastYear: "Geçen Yıl",
    compThisYear: "Bu Yıl",
    compDiff: "Fark",
    compTotalWaste: "Toplam Atık (kg)",
    compTotalProduction: "Toplam Üretim",
    compTurnstilePasses: "Turnike Geçiş",
    compStudentCount: "Öğrenci Sayısı",
    compWastePerPerson: "Kişi Başı Atık (gr)",
    monthlyCompDesc: "Bu ay ile geçen ay karşılaştırılır. ↑ artış, ↓ azalış. Atık ve kişi başı atıkta düşüş (↓) iyidir.",
    yearlyCompDesc: "Bu yıl (yılbaşından bugüne) ile geçen yılın aynı dönemi karşılaştırılır. ↑ artış, ↓ azalış. Atık ve kişi başı atıkta düşüş (↓) iyidir.",
    monthNames: ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"],
    haccpColDate: "Tarih",
    haccpColTime: "Saat",
    haccpColDepot: "Depo Adı",
    haccpColTemp: "Sıcaklık (°C)",
    haccpColHumidity: "Nem (%)",
    haccpColNote: "Not",
    haccpColAction: "İşlem",
    dayNames: ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"],
    menuVariety: "Çeşit",
    menuVariety1: "1. Çeşit",
    menuVariety2: "2. Çeşit",
    menuVariety3: "3. Çeşit",
    menuVariety4: "4. Çeşit",
    menuVariety5: "5. Çeşit",
    menuPersonCount: "Kişi Sayısı",
    stockDeductionList: "Stok Düşüm Listesi",
    perPersonCost: "Kişi Başı Maliyet",
    total: "Toplam",
    inVarieties: "çeşitte",
    person: "kişi",
    weeklyGrandTotal: "Haftalık Genel Toplam",
    dailyAverage: "Günlük Ortalama",
    avgPerPerson: "Kişi Başı Ortalama",
    totalPersonDays: "Toplam Kişi/Gün",
    colDay: "Gün",
    colDate: "Tarih",
    colPerson: "Kişi",
    dailyMaterialCost: "Günlük Malzeme Maliyeti",
    perPerson: "Kişi Başı",
    ingredients: "Malzemeler",
    perPersonGram: "(kişi başı gram)",
    colIngredient: "Malzeme",
    colPerPerson: "/kişi",
    colUnit: "Birim",
    addIngredient: "+ Malzeme Ekle",
    foodName: "Yemek Adı",
    allergen: "Alerjen",
    recipePerPerson: "Reçete (kişi başı)",
    devices: "cihaz",
    chartMonthlyProduction: "Aylık Üretim (kişi)",
    chartMonthlyPasses: "Aylık Geçiş (kişi)",
    chartMonthlyWaste: "Aylık Çöpe Giden (porsiyon)",
    chartLastYearWaste: "Geçen Yıl Çöpe Giden (porsiyon)",
    chartMonthlyWasteKg: "Aylık Atık (kg)",
    chartMonthlyWastePortion: "Aylık Atık (porsiyon)",
    chartMonthlyMealCount: "Aylık Üretim Sayısı",
    chartMonthlyTurnstile: "Aylık Turnike Geçisi",
    chartMonthlyWasteRate: "Aylık Atık Oranı %",
    chartMonthlyStudent: "Aylık Öğrenci Sayısı",
    chartWastePerPersonLabel: "Kişi Başı Atık (kg/kişi)",
  },
  en: {
    loginSub: "NUTRITION SERVICES MANAGEMENT SYSTEM",
    loginFormSub: "Sign In",
    loginUsername: "Username",
    loginSelectUser: "Select User",
    loginPassword: "Password",
    loginBtn: "Sign In",
    loginHint: "You can get your password from your administrator",
    loginFeature1: "Menu Planning, Daily Production, Consumption & Waste Tracking",
    loginFeature2: "Detailed Reporting",
    loginFeature3: "Live Dashboard & Charts",
    loginRemember: "Remember Me",
    loginForgot: "Forgot Password?",
    loginForgotTitle: "Forgot Password",
    loginForgotText: "Please contact your System Administrator to reset your password.",
    loginForgotOk: "Close",
    loginSecure: "Secure Connection",
    menuLabel: "Menu",
    headerSubtitle: "Nutrition Services Management System",
    btnLogout: "Logout",
    btnPrev: "Previous",
    btnNext: "Next",
    loading: "Loading...",
    loadingText: "Syncing data...",
    loadingSub: "Checking Supabase connection",
    loadingSkip: "Click to skip",
    versionLabel: "Application Version",
    sidebarPanel: "Dashboard",
    sidebarMenu: "Weekly Menu",
    sidebarRecords: "Records",
    sidebarReport: "Report",
    sidebarHaccp: "Food Safety",
    sidebarCalibration: "Calibration",
    sidebarOil: "Waste Oil",
    sidebarPackaging: "Packaging Waste",
    sidebarCharts: "Charts",
    sidebarYearly: "Yearly Comparison",
    sidebarSpending: "Spending",
    sidebarUnitPrice: "Unit Prices",
    sidebarDownload: "Download All",
    sidebarBackup: "Backup to Supabase",
    sidebarRestore: "Restore from Supabase",
    sidebarAdmin: "Administration",
    sidebarLogs: "Log Records",
    sidebarTheme: "Theme",
    sidebarManual: "User Manual",
    dashboardPrintPdf: "Print PDF",
    kpiTotalRecords: "Total Production Days",
    kpiTodayProduction: "Today's Production",
    kpiHaccpAlarm: "Cold Storage Temperature Alarm",
    kpiCalibrationAlarm: "Calibration Alarm",
    kpiAvgWaste: "Avg. Waste (kg)",
    kpiTotalPasses: "Total Turnstile Passes",
    kpiTotalWaste: "Total Waste (kg)",
    kpiWasteRate: "Waste Rate",
    weeklyPrevBtn: "Previous Week",
    weeklySummary: "Weekly Summary",
    weeklyNextBtn: "Next Week",
    weeklyBadge: "This Week",
    dailyPrevBtn: "Previous Day",
    dailySummary: "Daily Detail",
    dailyNextBtn: "Next Day",
    weeklyCompTitle: "Weekly Comparison",
    monthlyCompTitle: "Monthly Comparison",
    monthlyBadge: "This Month",
    yearlyBadge: "This Year",
    anomalyTitle: "Anomaly Detection",
    anomalyBadge: "Abnormal Waste Days",
    lastRecordsTitle: "Recent Records",
    dashboardGoToRecords: "Go to Records",
    emptyDashboard: "No records yet...",
    formulaTitle: "WASTE CALCULATION FORMULA",
    recordsEntryBtn: "Enter Production Consumption",
    recordsImportBtn: "Import",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "Download CSV",
    recordsDeleteBtn: "Delete Selected",
    emptyRecords: "No records found.",
    thDate: "Date",
    thProducedPerson: "Meals Produced (Person)",
    thWaste10: "10% Waste",
    thBeneficiary: "Nutrition Service Beneficiaries",
    thPortionGr: "Portion (g)",
    thWasteKg: "Waste (kg)",
    thWastedPortion: "Discarded (portion)",
    thFoodType: "Food Type",
    thAction: "Action",
    thAcademicStaff: "Academic & Administrative Staff via Turnstile",
    thStudentCount: "Students via Turnstile",
    thBeneficiaryTotal: "Total Nutrition Service Beneficiaries",
    sksStaff: "SKS Nutrition Service Staff",
    summaryReport: "Summary Report",
    reportPdfBtn: "Open PDF",
    allRecordsPrint: "All Records (Print View)",
    rTotalRecords: "Total Records",
    rTotalMeals: "Total Meals Produced",
    rTotalWaste10: "Total 10% Waste",
    rTotalAfterWaste: "Total Meals After 10% Waste",
    rTotalTurnstile: "Total Turnstile Passes",
    rTotalBeneficiary: "Total Nutrition Service Beneficiaries",
    rTotalStaff: "Total SKS Staff Benefited",
    rPortionSize: "Portion Size (g)",
    rTotalPortion: "Total Portion (g)",
    rWastedPortion: "Discarded Portion",
    rMaxWeeklyBeneficiary: "Highest Weekly Beneficiary Count",
    rTotalWasteKg: "Total Waste Amount (kg)",
    rAvgWasteKg: "Avg. Waste Amount (kg)",
    rTotalStudents: "Total Student Count",
    rMaxWaste: "Highest Waste (kg)",
    rMinWaste: "Lowest Waste (kg)",
    rWasteTrend: "Waste Trend (last 7 days)",
    rBeneficiaryTrend: "Beneficiary Trend (last 7 days)",
    wasteByFoodTitle: "Waste Analysis by Food Type",
    wasteByFoodEmpty: "No records with food type data found.",
    wasteByFoodRecords: "Record Count",
    wasteByFoodRate: "Waste Rate",
    wasteByFoodPerPerson: "Waste per Person (kg)",
    wsProducedMeal: "Meals Produced (Pax)",
    wsTotalPasses: "Total Passes",
    wsTurnstile: "Turnstile",
    wsStaffSKS: "Nutr. Staff",
    wsWasteAmount: "Waste Amount",
    wsWastedPortion: "Wasted Portion",
    wsStudents: "Nutr. Students",
    wsNoRecordsYet: "No records yet",
    wsNoRecordThisWeek: "No records this week",
    wsNoRecordToday: "No record",
    wsTodayDetail: "Today's Detail",
    wsDailyDetail: "Daily Detail",
    wsWaste: "Waste",
    wsPortion: "portion",
    wsProduced: "Produced",
    wsTurnstileCount: "Turnstile",
    wsStaffCount: "Staff",
    menuTitle: "Weekly Menu List",
    menuStatusBadge: "Status",
    menuSaveBtn: "Save",
    menuSendBtn: "Send for Approval",
    menuApproveBtn: "Approve",
    menuRejectBtn: "Reject",
    menuWithdrawBtn: "Withdraw Approval",
    menuClearBtn: "Clear Table",
    menuPrintBtn: "Print",
    menuFoodListBtn: "Food List",
    menuFoodListUploadBtn: "Upload CSV",
    menuFoodListCsvBtn: "Download CSV",
    menuWarningPrefix: "Unapproved Menu:",
    menuWarningText: "This week's menu has not yet been approved by the food engineer.",
    menuHintText: "Type food names...",
    productNeedsTitle: "Product Needs List",
    weeklyNeedsTitle: "Weekly Total Needs List",
    foodListTitle: "Food List",
    modalRejectMenu: "Reject Menu",
    modalRejectDesc: "Rejection reason is required.",
    menuRejectConfirm: "Reject",
    haccpTitle: "Food Safety Management",
    haccpCsvBtn: "Download CSV",
    haccpColdStorage: "Cold Storage Temperature Records",
    haccpNewBtn: "New Record",
    haccpDepotBtn: "Depot Names",
    haccpDepoQrNote: "You can edit depot names and generate QR codes for each depot using the QR button.",
    haccpModalTitle: "New Record",
    filterDepot: "Depot Filter:",
    filterAll: "All",
    filterDateRange: "Date Range:",
    emptyHaccp: "No temperature records entered yet.",
    btnDeleteSelectedHaccp: "Delete Selected",
    btnPdf: "PDF",
    depoNamesTitle: "Depot Names",
    oilNewBtn: "New Record",
    oilListBtn: "List",
    oilFilterTitle: "Waste Oil Filters",
    filterOilType: "Oil Type:",
    btnReset: "Reset",
    oilSummaryTitle: "Waste Oil Summary",
    oilChartTitle: "Waste Oil Charts",
    oilChartSubtitle: "Monthly Waste Oil Amount (lt)",
    oilChartEmpty: "Charts will appear when waste oil records are entered",
    oilChartNote: "Monthly waste oil totals by date, oil type and year filters",
    oilRecordsTitle: "Waste Oil Records",
    oilModalTitle: "Waste Oil Record",
    emptyOil: "No waste oil records entered yet.",
    ambalajNewBtn: "New Record",
    ambalajListBtn: "List",
    packagingFilterTitle: "Packaging Waste Filters",
    filterWasteType: "Waste Type:",
    packagingSummaryTitle: "Packaging Waste Summary",
    packagingChartTitle: "Packaging Waste Charts",
    packagingChartSubtitle: "Monthly Packaging Waste Amount (kg)",
    packagingChartEmpty: "Charts will appear when packaging waste records are entered",
    packagingChartNote: "Monthly packaging waste totals by date, waste type and year filters (kg)",
    packagingRecordsTitle: "Packaging Waste Records",
    packagingModalTitle: "Packaging Waste Record",
    emptyPackaging: "No packaging waste records entered yet.",
    kalibrasyonNewBtn: "New Device",
    kalibrasyonListBtn: "List",
    kalibrasyonCsvBtn: "Download CSV",
    calibrationSummary: "Calibration Summary",
    calibrationDevices: "Devices Subject to Calibration",
    calibrationModalTitle: "Device for Calibration",
    filterStatus: "Status:",
    filterDepartment: "Department:",
    btnWordExport: "Export to Word",
    btnPrint: "Print PDF",
    chartProdWaste: "Production - Passes - Waste Comparison",
    chartEmpty: "Charts will appear when data is entered",
    chartProdWasteNote: "Monthly comparison of production, turnstile passes and discarded portions",
    chartStudentCount: "Number of Students Using Nutrition Services",
    yearTotal: "Year Total",
    chartStudentNote: "Monthly total of daily student passes",
    chartStaffTotal: "Academic & Administrative + SKS Staff Total",
    chartStaffNote: "Total of Academic & Administrative (Turnstile - Students) and SKS Nutrition Service Staff",
    chartMonthlyProd: "Monthly Meal Production",
    chartMonthlyProdNote: "Monthly total of daily meal counts produced",
    chartMonthlyTurnstile: "Monthly Turnstile Pass Counts",
    chartTurnstileNote: "Student + staff + external passes total",
    chartMonthlyWaste: "Monthly Waste Amount (kg)",
    chartMonthlyWasteNote: "Monthly total of daily waste (kg)",
    chartMonthlyWastePortion: "Monthly Waste Amount (portions)",
    chartWastePortionNote: "Monthly total of daily discarded portions",
    chartDiff: "Difference Between Production and Passes",
    chartDiffNote: "Difference between meals produced and turnstile passes",
    chartWasteRatio: "Waste % of Meals Produced",
    yearAverage: "Year Average",
    chartWasteRatioNote: "Percentage of produced meals that become waste",
    chartWastePerPerson: "Waste per Person (kg/person)",
    chartWastePerPersonNote: "Average waste per person entering the dining hall",
    chartMonthlyTemp: "Monthly Average Depot Temperatures (°C)",
    chartTempEmpty: "Charts will appear when temperature records are entered",
    chartTempNote: "Monthly average temperature of each depot",
    yearlyPdfBtn: "Print PDF",
    yearlyTotalProd: "Total Production Comparison",
    yearlyTotalProdNote: "Year total - Year 1 vs Year 2 (portions)",
    yearlyTotalBen: "Total Nutrition Service Beneficiaries",
    yearlyTotalBenNote: "Year total - Year 1 vs Year 2 (total people)",
    yearlyStudentComp: "Nutrition Service Student Beneficiary Comparison",
    yearlyStudentNote: "Year total - Year 1 vs Year 2 (students)",
    yearlyWasteComp: "Waste Comparison (kg)",
    yearlyWasteNote: "Year total - Year 1 vs Year 2 (kg)",
    yearlyMonthlyProd: "Monthly Production Comparison",
    yearlyMonthlyProdNote: "Year 1 vs Year 2 - meals produced (portions)",
    yearlyMonthlyTurnstile: "Monthly Turnstile Pass Comparison",
    yearlyMonthlyTurnstileNote: "Year 1 vs Year 2 - turnstile pass count",
    yearlyMonthlyStudent: "Monthly Student Turnstile Pass Comparison",
    yearlyMonthlyStudentNote: "Year 1 vs Year 2 - student turnstile pass count",
    yearlyMonthlyWaste: "Monthly Waste Comparison (kg)",
    yearlyMonthlyWasteNote: "Year 1 vs Year 2 - waste amount (kg)",
    yearlyWasteListTitle: "Yearly Waste List",
    spendingRatesTitle: "Per Person Spending Rates (Students, Staff & Meals)",
    spendingStudentRate: "Student Per Person Spending Amount (TL)",
    btnSaveStudentRate: "Save Student Amount",
    spendingStaffRate: "Staff Per Person Spending Amount (TL)",
    btnSaveStaffRate: "Save Staff Amount",
    spendingMealRate: "Per Meal Spending Amount (TL)",
    btnSaveMealRate: "Save Meal Amount",
    spendingDesc: "Student Spending = Student Count × Student Per Person Amount",
    spendingStudentTitle: "Student Spending Amount (TL)",
    spendingChartEmpty: "Charts will appear when records are entered",
    spendingStudentNote: "Student Spending (TL) = Student Count × Student Per Person Spending Amount",
    spendingStaffTitle: "Staff Spending Amount (TL)",
    spendingStaffNote: "Staff Spending (TL) = Staff Count × Staff Per Person Spending Amount",
    spendingMealTitle: "Meal Spending Amount (TL)",
    spendingMealNote: "Meal Spending (TL) = Meals Produced × Per Meal Spending Amount",
    spendingTableTitle: "Spending Calculation Table",
    syncTitle: "Supabase Synchronization",
    syncCloseBtn: "Close",
    modalNewRecord: "Add New Record",
    formDate: "Date",
    formProducedCount: "Number of Meals Produced",
    formTurnstileCount: "Number of Turnstile Passes",
    formStudentCount: "Number of Students Using Nutrition",
    formFoodType: "Food Type",
    formAutoCalc: "Automatic Calculations",
    badgeAutomatic: "Automatic",
    badgeFixed: "Fixed",
    badgeAutoEditable: "Automatic + Editable",
    btnCancel: "Cancel",
    entryFormSubmit: "Save",
    formReceiptNo: "Receipt No",
    formOilType: "Oil Type",
    formAmountLt: "Amount (lt)",
    formNote: "Note",
    formWasteType: "Waste Type",
    formAmount: "Amount",
    formDeviceName: "Device Name",
    formBrandModel: "Brand-Model",
    formSerialNo: "Serial No",
    formStatus: "Status",
    formVerification: "Verification",
    formLastCalibration: "Last Calibration",
    formNextCalibration: "Next Calibration",
    formLocation: "Location/Department",
    formResponsible: "Responsible Person",
    btnSave: "Save",
    btnAdd: "Add",
    btnClose: "Close",
    qrTitle: "QR Code",
    qrHint: "Print the QR code to hang on depot doors.",
    adminTitle: "Administration Panel",
    adminReAuthText: "Please enter your admin password to access the admin panel.",
    adminPassword: "Admin Password",
    btnVerify: "Verify",
    adminSessionRole: "Session Role",
    adminLastLogin: "Last Login",
    adminAuthMethod: "Auth Method",
    adminStorage: "Password Store",
    adminDataSource: "Data Source",
    adminUserMgmt: "User Management",
    adminUserMgmtDesc: "Add, edit or delete users.",
    adminAddUser: "Add New User",
    adminUsername: "Username",
    adminDisplayName: "Display Name",
    adminPasswordLabel: "Password",
    adminRole: "Role",
    adminAddUserBtn: "Add User",
    adminRolePerms: "Role-Based Permission Settings",
    adminRolePermsDesc: "Set which tabs each role can view.",
    adminSecurity: "Session Security",
    adminSecurityDesc: "Session will close if no activity is performed for the specified duration.",
    adminInactivityTimeout: "Inactivity Timeout",
    adminLogsTitle: "Activity Log Records",
    adminLogsDesc: "User login/logout and record operations",
    btnRefresh: "Refresh",
    adminSaveBtn: "Save Settings",
    adminFooterNote: "Passwords are stored permanently on the server.",
    adminCloseBtn: "Close",
    logFilterDelete: "Delete",
    logFilterAddUser: "Add User",
    logFilterDeleteUser: "Delete User",
    adminRefreshBtn: "Refresh",
    manualTitle: "User Manual",
    manualSubtitle: "Dining Hall Production, Consumption and Waste Control System",
    compDataType: "Data Type",
    compLastWeek: "Last Week",
    compThisWeek: "This Week",
    compLastMonth: "Last Month",
    compThisMonth: "This Month",
    compLastYear: "Last Year",
    compThisYear: "This Year",
    compDiff: "Diff",
    compTotalWaste: "Total Waste (kg)",
    compTotalProduction: "Total Production",
    compTurnstilePasses: "Turnstile Passes",
    compStudentCount: "Student Count",
    compWastePerPerson: "Waste per Person (gr)",
    monthlyCompDesc: "Comparing this month with last month. ↑ increase, ↓ decrease. A decrease (↓) in waste and waste per person is good.",
    yearlyCompDesc: "Comparing this year (year-to-date) with the same period last year. ↑ increase, ↓ decrease. A decrease (↓) in waste and waste per person is good.",
    monthNames: ["January","February","March","April","May","June","July","August","September","October","November","December"],
    haccpColDate: "Date",
    haccpColTime: "Time",
    haccpColDepot: "Depot Name",
    haccpColTemp: "Temperature (°C)",
    haccpColHumidity: "Humidity (%)",
    haccpColNote: "Note",
    haccpColAction: "Action",
    dayNames: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    menuVariety: "Variety",
    menuVariety1: "1st Variety",
    menuVariety2: "2nd Variety",
    menuVariety3: "3rd Variety",
    menuVariety4: "4th Variety",
    menuVariety5: "5th Variety",
    menuPersonCount: "Person Count",
    stockDeductionList: "Stock Deduction List",
    perPersonCost: "Per Person Cost",
    total: "Total",
    inVarieties: "varieties",
    person: "pax",
    weeklyGrandTotal: "Weekly Grand Total",
    dailyAverage: "Daily Average",
    avgPerPerson: "Average per Person",
    totalPersonDays: "Total Person/Days",
    colDay: "Day",
    colDate: "Date",
    colPerson: "Pax",
    dailyMaterialCost: "Daily Material Cost",
    perPerson: "Per Person",
    ingredients: "Ingredients",
    perPersonGram: "(per person gram)",
    colIngredient: "Ingredient",
    colPerPerson: "/person",
    colUnit: "Unit",
    addIngredient: "+ Add Ingredient",
    foodName: "Food Name",
    allergen: "Allergen",
    recipePerPerson: "Recipe (per person)",
    devices: "devices",
    chartMonthlyProduction: "Monthly Production (pax)",
    chartMonthlyPasses: "Monthly Passes (pax)",
    chartMonthlyWaste: "Monthly Wasted (portions)",
    chartLastYearWaste: "Last Year Wasted (portions)",
    chartMonthlyWasteKg: "Monthly Waste (kg)",
    chartMonthlyWastePortion: "Monthly Waste (portions)",
    chartMonthlyMealCount: "Monthly Meal Count",
    chartMonthlyTurnstile: "Monthly Turnstile Passes",
    chartMonthlyWasteRate: "Monthly Waste Rate %",
    chartMonthlyStudent: "Monthly Student Count",
    chartWastePerPersonLabel: "Waste per Person (kg/pax)",
  },
  az: {
    loginSub: "QIDA XİDMƏTLƏRİ İDARƏETMƏ SİSTEMİ",
    loginFormSub: "Daxil olun",
    loginUsername: "İstifadəçi",
    loginSelectUser: "İstifadəçi seçin",
    loginPassword: "Şifrə",
    loginBtn: "Daxil ol",
    loginHint: "Şifrənizi administratorunuzdan ala bilərsiniz",
    loginFeature1: "Menyu Planlaması, Günlük İstehsal, İstehlak və Tullantı İzləmə",
    loginFeature2: "Ətraflı Hesabatlar",
    loginFeature3: "Canlı Panel və Qrafiklər",
    loginRemember: "Məni Xatırla",
    loginForgot: "Şifrəmi Unutdum?",
    loginForgotTitle: "Şifrəmi Unutdum",
    loginForgotText: "Şifrənizi sıfırlamaq üçün Sistem Administratorunuzla əlaqə saxlayın.",
    loginForgotOk: "Bağla",
    loginSecure: "Təhlükəsiz Bağlantı",
    menuLabel: "Menyu",
    headerSubtitle: "Qida Xidmətləri İdarəetmə Sistemi",
    btnLogout: "Çıxış",
    btnPrev: "Əvvəlki",
    btnNext: "Növbəti",
    loading: "Yüklənir...",
    loadingText: "Məlumatlar sinxronlaşdırılır...",
    loadingSub: "Supabase bağlantısı yoxlanılır",
    loadingSkip: "Keçmək üçün klikləyin",
    versionLabel: "Tətbiq Versiyası",
    sidebarPanel: "Panel",
    sidebarMenu: "Həftəlik Menyu",
    sidebarRecords: "Qeydlər",
    sidebarReport: "Hesabat",
    sidebarHaccp: "Qida Təhlükəsizliyi",
    sidebarCalibration: "Kalibrləmə",
    sidebarOil: "Tullantı Yağı",
    sidebarPackaging: "Qablaşdırma Tullantıları",
    sidebarCharts: "Qrafiklər",
    sidebarYearly: "İllik Müqayisə",
    sidebarSpending: "Xərclər",
    sidebarUnitPrice: "Vahid Qiymətlər",
    sidebarDownload: "Hamısını Yüklə",
    sidebarBackup: "Supabase-ə Yedeklə",
    sidebarRestore: "Supabase-dən Çək",
    sidebarAdmin: "İdarəetmə",
    sidebarLogs: "Jurnal Qeydləri",
    sidebarTheme: "Mövzu",
    sidebarManual: "İstifadəçi Təlimatı",
    dashboardPrintPdf: "PDF Çap Et",
    kpiTotalRecords: "Ümumi İstehsal Günü",
    kpiTodayProduction: "Bu günün İstehsalı",
    kpiHaccpAlarm: "Soyuducu Anbar Temperaturu Alarmı",
    kpiCalibrationAlarm: "Kalibrləmə Alarmı",
    kpiAvgWaste: "Ort. Tullantı (kg)",
    kpiTotalPasses: "Toplam Turnike Keçidi",
    kpiTotalWaste: "Ümumi Tullantı (kg)",
    kpiWasteRate: "Tullantı Nisbəti",
    weeklyPrevBtn: "Əvvəlki Həftə",
    weeklySummary: "Həftəlik Xülasə",
    weeklyNextBtn: "Növbəti Həftə",
    weeklyBadge: "Bu Həftə",
    dailyPrevBtn: "Əvvəlki Gün",
    dailySummary: "Günlük Detay",
    dailyNextBtn: "Növbəti Gün",
    weeklyCompTitle: "Həftəlik Müqayisə",
    monthlyCompTitle: "Aylıq Müqayisə",
    monthlyBadge: "Bu Ay",
    yearlyBadge: "Bu İl",
    anomalyTitle: "Anomaliya Aşkarlanması",
    anomalyBadge: "Anormal Tullantı Günləri",
    lastRecordsTitle: "Son Qeydlər",
    dashboardGoToRecords: "Qeydlərə Get",
    emptyDashboard: "Hələ qeyd yoxdur...",
    formulaTitle: "TULLANTI HESABLAMA FORMULU",
    recordsEntryBtn: "İstehsal İstehlak Gir",
    recordsImportBtn: "İdxal",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "CSV Yüklə",
    recordsDeleteBtn: "Seçilənləri Sil",
    emptyRecords: "Göstəriləcək qeyd tapılmadı.",
    thDate: "Tarix",
    thProducedPerson: "İstehsal olunan Yemək (Şəxs)",
    thWaste10: "%10 Tullantı",
    thBeneficiary: "Yemək Xidm. Faydalanan Personnel və Tələbə",
    thPortionGr: "Porsiyon (g)",
    thWasteKg: "Tullantı (kg)",
    thWastedPortion: "Zibilə gedən (pors.)",
    thFoodType: "Yemək Növü",
    thAction: "Əməliyyat",
    thAcademicStaff: "Turnikə Keçən Akademik və İdarəçi Personnel",
    thStudentCount: "Turnikə Keçən Tələbə sayı",
    thBeneficiaryTotal: "Yemək Xidm. Faydalanan Toplam Şəxs",
    sksStaff: "SKS Yemək Xidməti Personnelı",
    summaryReport: "Xülasə Hesabatı",
    reportPdfBtn: "PDF Aç",
    allRecordsPrint: "Bütün Qeydlər (Çap Görünüşü)",
    rTotalRecords: "Toplam Qeyd sayı",
    rTotalMeals: "Toplam İstehsal Olunan Yemək",
    rTotalWaste10: "Toplam %10 Tullantı",
    rTotalAfterWaste: "Toplam %10 Tullantı Sonrası Yemək",
    rTotalTurnstile: "Toplam Turnike Keçidi",
    rTotalBeneficiary: "Yemək Xidm. Faydalanan Toplam Şəxs",
    rTotalStaff: "Faydalanan Toplam SKS Personnelı",
    rPortionSize: "Porsiyon Həcmi (g)",
    rTotalPortion: "Toplam Porsiyon (g)",
    rWastedPortion: "Zibilə Gedən Porsiyon",
    rMaxWeeklyBeneficiary: "Ən Yüksək Həftəlik Faydalanan Şəxs",
    rTotalWasteKg: "Toplam Tullantı Miqdarı (kg)",
    rAvgWasteKg: "Ort. Tullantı Miqdarı (kg)",
    rTotalStudents: "Toplam Tələbə sayı",
    rMaxWaste: "Ən Yüksək Tullantı (kg)",
    rMinWaste: "Ən aşağı Tullantı (kg)",
    rWasteTrend: "Tullantı Trendi (son 7 gün)",
    rBeneficiaryTrend: "Faydalanan Trendi (son 7 gün)",
    wasteByFoodTitle: "Yemək Növü üzrə Tullantı Təhlili",
    wasteByFoodEmpty: "Yemək növü məlumatı olan qeyd tapılmadı.",
    wasteByFoodRecords: "Qeyd sayı",
    wasteByFoodRate: "Tullantı nisbəti",
    wasteByFoodPerPerson: "Şəxs başına tullantı (kg)",
    wsProducedMeal: "İstehsal olunan yemək (nəfər)",
    wsTotalPasses: "Ümumi keçiş",
    wsTurnstile: "Turniket",
    wsStaffSKS: "SKS personalı",
    wsWasteAmount: "Tullantı miqdarı",
    wsWastedPortion: "Çöpe gedən",
    wsStudents: "Yemək xidm. tələbələri",
    wsNoRecordsYet: "Hələ qeyd yoxdur",
    wsNoRecordThisWeek: "Bu həftə qeyd yoxdur",
    wsNoRecordToday: "Qeyd yoxdur",
    wsTodayDetail: "Bu günün təfərrüatı",
    wsDailyDetail: "Günlük təfərrüat",
    wsWaste: "İtki",
    wsPortion: "porsiya",
    wsProduced: "İstehsal",
    wsTurnstileCount: "Turniket keçidi",
    wsStaffCount: "Personal",
    menuTitle: "Həftəlik Menyu Siyahısı",
    menuStatusBadge: "Vəziyyət",
    menuSaveBtn: "Saxla",
    menuSendBtn: "Təsdiqə Göndər",
    menuApproveBtn: "Təsdiqlə",
    menuRejectBtn: "Rədd et",
    menuWithdrawBtn: "Təsdiqi Geri Al",
    menuClearBtn: "Cədvəli Təmizlə",
    menuPrintBtn: "Çap Et",
    menuFoodListBtn: "Yemək Siyahısı",
    menuFoodListUploadBtn: "CSV Yüklə",
    menuFoodListCsvBtn: "CSV Yüklə",
    menuWarningPrefix: "Təsdiqlənməmiş Menyu:",
    menuWarningText: "Bu həftənin menyusu hələ qida mühəndisi tərəfindən təsdiqlənməyib.",
    menuHintText: "Yemək adlarını yazın...",
    productNeedsTitle: "Məhsul Ehtiyatı Siyahısı",
    weeklyNeedsTitle: "Həftəlik Toplam Ehtiyat Siyahısı",
    foodListTitle: "Yemək Siyahısı",
    modalRejectMenu: "Menyunu Rədd Et",
    modalRejectDesc: "Rədd səbəbi məcburidir.",
    menuRejectConfirm: "Rədd et",
    haccpTitle: "Qida Təhlükəsizliyi İdarəetməsi",
    haccpCsvBtn: "CSV Yüklə",
    haccpColdStorage: "Soyuducu Anbar Temperaturu Qeydləri",
    haccpNewBtn: "Yeni Qeyd",
    haccpDepotBtn: "Anbar Adları",
    haccpDepoQrNote: "Anbar adlarını redaktə edib QR düyməsi ilə hər anbar üçün QR kod yarada bilərsiniz.",
    haccpModalTitle: "Yeni Qeyd",
    filterDepot: "Anbar Filtri:",
    filterAll: "Hamısı",
    filterDateRange: "Tarix Aralığı:",
    emptyHaccp: "Hələ temperatur qeydi daxil edilməyib.",
    btnDeleteSelectedHaccp: "Seçilənləri Sil",
    btnPdf: "PDF",
    depoNamesTitle: "Anbar Adları",
    oilNewBtn: "Yeni Qeyd",
    oilListBtn: "Siyahı",
    oilFilterTitle: "Tullantı Yağı Filtrləri",
    filterOilType: "Yağ Növü:",
    btnReset: "Sıfırla",
    oilSummaryTitle: "Tullantı Yağı Xülasəsi",
    oilChartTitle: "Tullantı Yağı Qrafikləri",
    oilChartSubtitle: "Aylıq Tullantı Yağı Miqdarı (lt)",
    oilChartEmpty: "Tullantı yağı qeydi daxil edildikdə qrafik göstəriləcək",
    oilChartNote: "Tarix, yağ növü və il filtrlərinə görə aylıq tullantı yağı cəmləri",
    oilRecordsTitle: "Tullantı Yağı Qeydləri",
    oilModalTitle: "Tullantı Yağı Qeydi",
    emptyOil: "Hələ tullantı yağı qeydi daxil edilməyib.",
    ambalajNewBtn: "Yeni Qeyd",
    ambalajListBtn: "Siyahı",
    packagingFilterTitle: "Qablaşdırma Tullantısı Filtrləri",
    filterWasteType: "Tullantı Növü:",
    packagingSummaryTitle: "Qablaşdırma Tullantısı Xülasəsi",
    packagingChartTitle: "Qablaşdırma Tullantısı Qrafikləri",
    packagingChartSubtitle: "Aylıq Qablaşdırma Tullantısı Miqdarı (kg)",
    packagingChartEmpty: "Qablaşdırma tullantısı qeydi daxil edildikdə qrafik göstəriləcək",
    packagingChartNote: "Tarix, tullantı növü və il filtrlərinə görə aylıq qablaşdırma tullantısı cəmləri (kg)",
    packagingRecordsTitle: "Qablaşdırma Tullantıları Qeydləri",
    packagingModalTitle: "Qablaşdırma Tullantısı Qeydi",
    emptyPackaging: "Hələ qablaşdırma tullantısı qeydi daxil edilməyib.",
    kalibrasyonNewBtn: "Yeni Cihaz",
    kalibrasyonListBtn: "Siyahı",
    kalibrasyonCsvBtn: "CSV Yüklə",
    calibrationSummary: "Kalibrləmə Xülasəsi",
    calibrationDevices: "Kalibrləməyə Tabi Cihazlar",
    calibrationModalTitle: "Kalibrləməyə Tabi Cihaz",
    filterStatus: "Vəziyyət:",
    filterDepartment: "Şöbə:",
    btnWordExport: "Word-ə İxrac",
    btnPrint: "PDF Çap Et",
    chartProdWaste: "İstehsal - Keçid - Tullantı Müqayisəsi",
    chartEmpty: "Məlumat daxil edildikdə qrafik göstəriləcək",
    chartProdWasteNote: "İstehsal, turnike keçidi və Zibilə Gedən porsiyonun aylıq müqayisəsi",
    chartStudentCount: "Qida Xidmətlərindən Faydalan Tələbə sayı",
    yearTotal: "İl Cəmi",
    chartStudentNote: "Günlük tələbə keçidlərinin aylıq cəmi",
    chartStaffTotal: "Akademik və İdarəçi + SKS Personnel Cəmi",
    chartStaffNote: "Akademik və İdarəçi (Turnike - Tələbə) ilə SKS Yemək Xidməti Personnelı cəmi",
    chartMonthlyProd: "Aylıq Yemək İstehsalı",
    chartMonthlyProdNote: "Günlük istehsal olunan yemək sayılarının aylıq cəmi",
    chartMonthlyTurnstile: "Aylıq Turnike Keçid Sayları",
    chartTurnstileNote: "Tələbə + personnel + xarici keçid cəmi",
    chartMonthlyWaste: "Aylıq Tullantı Miqdarı (kg)",
    chartMonthlyWasteNote: "Günlük tullantıların aylıq cəmi (kg)",
    chartMonthlyWastePortion: "Aylıq Tullantı Miqdarı (porsiyon)",
    chartWastePortionNote: "Günlük Zibilə Gedən porsiyonların aylıq cəmi",
    chartDiff: "İstehsal ilə Keçid Arasındakı Fərq",
    chartDiffNote: "İstehsal olunan yemək sayı ilə turnike keçidi arasındakı fərq",
    chartWasteRatio: "İstehsal Olunan Yeməyə Oranla Tullantı %",
    yearAverage: "İl Ortalaması",
    chartWasteRatioNote: "İstehsal olunan yeməyin faizi nə qədər tullantı olur",
    chartWastePerPerson: "Şəxs Başına Tullantı (kg/şəxs)",
    chartWastePerPersonNote: "Müəssisəyə daxil olan şəxs başına düşən orta tullantı",
    chartMonthlyTemp: "Aylıq Ortalama Anbar Temperaturları (°C)",
    chartTempEmpty: "Temperatur qeydi daxil edildikdə qrafik göstəriləcək",
    chartTempNote: "Hər anbarın aylıq orta temperaturu",
    yearlyPdfBtn: "PDF Çap Et",
    yearlyTotalProd: "Toplam İstehsal Müqayisəsi",
    yearlyTotalProdNote: "İl cəmi - 1. il vs 2. il (porsiyon)",
    yearlyTotalBen: "Yemək Xidm. Faydalanan Toplam Şəxs",
    yearlyTotalBenNote: "İl cəmi - 1. il vs 2. il (toplam şəxs)",
    yearlyStudentComp: "Yemək Xidmətindən Faydalan Tələbə Müqayisəsi",
    yearlyStudentNote: "İl cəmi - 1. il vs 2. il (tələbə)",
    yearlyWasteComp: "Tullantı Müqayisəsi (kg)",
    yearlyWasteNote: "İl cəmi - 1. il vs 2. il (kg)",
    yearlyMonthlyProd: "Aylıq İstehsal Müqayisəsi",
    yearlyMonthlyProdNote: "1. il vs 2. il - istehsal olunan yemək sayı (porsiyon)",
    yearlyMonthlyTurnstile: "Aylıq Turnike Keçid Müqayisəsi",
    yearlyMonthlyTurnstileNote: "1. il vs 2. il - turnike keçid sayı",
    yearlyMonthlyStudent: "Aylıq Tələbə Turnike Keçidi Müqayisəsi",
    yearlyMonthlyStudentNote: "1. il vs 2. il - tələbə turnike keçid sayı",
    yearlyMonthlyWaste: "Aylıq Tullantı Müqayisəsi (kg)",
    yearlyMonthlyWasteNote: "1. il vs 2. il - tullantı miqdarı (kg)",
    yearlyWasteListTitle: "İllik Tullantı Siyahısı",
    spendingRatesTitle: "Şəxs Başına Xərc Nisbətləri (Tələbə, Personnel & Yemək)",
    spendingStudentRate: "Tələbə Başına Xərc Məbləği (TL)",
    btnSaveStudentRate: "Tələbə Məbləğini Saxla",
    spendingStaffRate: "Personnel Başına Xərc Məbləği (TL)",
    btnSaveStaffRate: "Personnel Məbləğini Saxla",
    spendingMealRate: "Yemək Başına Xərc Məbləği (TL)",
    btnSaveMealRate: "Yemək Məbləğini Saxla",
    spendingDesc: "Tələbə Xərci = Tələbə sayı × Tələbə Başına Məbləğ",
    spendingStudentTitle: "Tələbə Xərc Məbləği (TL)",
    spendingChartEmpty: "Qeyd daxil edildikdə qrafik göstəriləcək",
    spendingStudentNote: "Tələbə Xərci (TL) = Tələbə sayı × Tələbə Başına Xərc Məbləği",
    spendingStaffTitle: "Personnel Xərc Məbləği (TL)",
    spendingStaffNote: "Personnel Xərci (TL) = Personnel sayı × Personnel Başına Xərc Məbləği",
    spendingMealTitle: "Yemək Xərc Məbləği (TL)",
    spendingMealNote: "Yemək Xərci (TL) = İstehsal olunan Yemək sayı × Yemək Başına Xərc Məbləği",
    spendingTableTitle: "Xərc Hesablama Cədvəli",
    syncTitle: "Supabase Sinxronizasiyası",
    syncCloseBtn: "Bağla",
    modalNewRecord: "Yeni Qeyd Əlavə Et",
    formDate: "Tarix",
    formProducedCount: "İstehsal Olunan Yemək sayı",
    formTurnstileCount: "Turnike Keçid sayı",
    formStudentCount: "Yemək Xidm. Fayd. Tələbə sayı",
    formFoodType: "Yemək Növü",
    formAutoCalc: "Avtomatik Hesablamalar",
    badgeAutomatic: "Avtomatik",
    badgeFixed: "Sabit",
    badgeAutoEditable: "Avtomatik + Redaktə Edilə bilən",
    btnCancel: "Ləğv et",
    entryFormSubmit: "Saxla",
    formReceiptNo: "Qəbuz Nömrəsi",
    formOilType: "Yağ Növü",
    formAmountLt: "Miqdar (lt)",
    formNote: "Qeyd",
    formWasteType: "Tullantı Növü",
    formAmount: "Miqdar",
    formDeviceName: "Cihaz Adı",
    formBrandModel: "Brend-Model",
    formSerialNo: "Seriya Nömrəsi",
    formStatus: "Vəziyyət",
    formVerification: "Doğrulama",
    formLastCalibration: "Son Kalibrləmə",
    formNextCalibration: "Növbəti Kalibrləmə",
    formLocation: "Yer/Şöbə",
    formResponsible: "Məsul Şəxs",
    btnSave: "Saxla",
    btnAdd: "Əlavə et",
    btnClose: "Bağla",
    qrTitle: "QR Kod",
    qrHint: "QR kodu anbar qapılarına asmaq üçün çap edin.",
    adminTitle: "İdarəetmə Paneli",
    adminReAuthText: "İdarəetmə panelinə daxil olmaq üçün admin şifrənizi daxil edin.",
    adminPassword: "Admin Şifrəsi",
    btnVerify: "Doğrula",
    adminSessionRole: "Oturum Rollu",
    adminLastLogin: "Son Giriş",
    adminAuthMethod: "Auth Metodu",
    adminStorage: "Şifrə Anbarı",
    adminDataSource: "Məlumat Mənbəyi",
    adminUserMgmt: "İstifadəçi İdarəetməsi",
    adminUserMgmtDesc: "İstifadəçiləri əlavə edin, redaktə edin və ya silin.",
    adminAddUser: "Yeni İstifadəçi Əlavə Et",
    adminUsername: "İstifadəçi Adı",
    adminDisplayName: "Görünən Ad",
    adminPasswordLabel: "Şifrə",
    adminRole: "Rol",
    adminAddUserBtn: "İstifadəçi Əlavə Et",
    adminRolePerms: "Rollara Əsaslanan İzin Parametrləri",
    adminRolePermsDesc: "Hər rol üçün hansı sekmeleri görə biləcəyini təyin edin.",
    adminSecurity: "Oturum Təhlükəsizliyi",
    adminSecurityDesc: "Göstərilən müddət ərzində heç bir əməliyyat aparılmazsa oturum bağlanacaq.",
    adminInactivityTimeout: "Hərəkətsizlik Bağlanma Müddəti",
    adminLogsTitle: "Əməliyyat Jurnal Qeydləri",
    adminLogsDesc: "İstifadəçi giriş/çixış və qeyd əməliyyatları",
    btnRefresh: "Yenilə",
    adminSaveBtn: "Parametrləri Saxla",
    adminFooterNote: "Şifrələr serverdə daimi olaraq saxlanılır.",
    adminCloseBtn: "Bağla",
    logFilterDelete: "Silmə",
    logFilterAddUser: "İstifadəçi Əlavə Et",
    logFilterDeleteUser: "İstifadəçi Sil",
    adminRefreshBtn: "Yenilə",
    manualTitle: "İstifadəçi Təlimatı",
    manualSubtitle: "Müəssisə İstehsalı, İstehlakı və Tullantı Nəzarət Sistemi",
    compDataType: "Məlumat Növü",
    compLastWeek: "Keçən Həftə",
    compThisWeek: "Bu Həftə",
    compLastMonth: "Keçən Ay",
    compThisMonth: "Bu Ay",
    compLastYear: "Keçən İl",
    compThisYear: "Bu İl",
    compDiff: "Fərq",
    compTotalWaste: "Ümumi Tullantı (kg)",
    compTotalProduction: "Ümumi İstehsal",
    compTurnstilePasses: "Turnike Keçidi",
    compStudentCount: "Tələbə Sayı",
    compWastePerPerson: "Adambaşına Tullantı (qr)",
    monthlyCompDesc: "Bu ay keçən ay ilə müqayisə olunur. ↑ artım, ↓ azalma. Tullantı və adambaşına tullantıda azalma (↓) yaxşıdır.",
    yearlyCompDesc: "Bu il (ilin əvvəlindən bu günə) keçən ilin eyni dövrü ilə müqayisə olunur. ↑ artım, ↓ azalma. Tullantı və adambaşına tullantıda azalma (↓) yaxşıdır.",
    monthNames: ["Yanvar","Fevral","Mart","Aprel","May","İyun","İyul","Avqust","Sentyabr","Oktyabr","Noyabr","Dekabr"],
    haccpColDate: "Tarix",
    haccpColTime: "Saat",
    haccpColDepot: "Anbar adı",
    haccpColTemp: "Temperatur (°C)",
    haccpColHumidity: "Rütubət (%)",
    haccpColNote: "Qeyd",
    haccpColAction: "Əməliyyat",
    dayNames: ["Bazar ertəsi", "Çərşənbə axşamı", "Çərşənbə", "Cümə axşamı", "Cümə"],
    menuVariety: "Növ",
    menuVariety1: "1 növ",
    menuVariety2: "2 növ",
    menuVariety3: "3 növ",
    menuVariety4: "4 növ",
    menuVariety5: "5 növ",
    menuPersonCount: "Şəxs sayı",
    stockDeductionList: "Stok Siyahısı",
    perPersonCost: "Adambaşına Xərc",
    total: "Cəmi",
    inVarieties: "növdə",
    person: "nəfər",
    weeklyGrandTotal: "Həftəlik Ümumi Cəmi",
    dailyAverage: "Günlük Orta",
    avgPerPerson: "Nəfər Başına Orta",
    totalPersonDays: "Cəmi Nəfər/Gün",
    colDay: "Gün",
    colDate: "Tarix",
    colPerson: "Nəfər",
    dailyMaterialCost: "Günlük Material Xərci",
    perPerson: "Nəfər Başına",
    ingredients: "Materiallar",
    perPersonGram: "(nəfər başı qr)",
    colIngredient: "Material",
    colPerPerson: "/nəfər",
    colUnit: "Vahid",
    addIngredient: "+ Material Əlavə Et",
    foodName: "Yeməyin Adı",
    allergen: "Allergen",
    recipePerPerson: "Resept (nəfər başı)",
    devices: "cihaz",
  },
  ru: {
    loginSub: "СИСТЕМА УПРАВЛЕНИЯ ПИТАНИЕМ",
    loginFormSub: "Войти",
    loginUsername: "Пользователь",
    loginSelectUser: "Выберите пользователя",
    loginPassword: "Пароль",
    loginBtn: "Войти",
    loginHint: "Пароль можно получить у администратора",
    loginFeature1: "Меню, ежедневное производство, потребление и отходы",
    loginFeature2: "Подробные отчёты",
    loginFeature3: "Живая панель и графики",
    loginRemember: "Запомнить меня",
    loginForgot: "Забыли пароль?",
    loginForgotTitle: "Забыли пароль",
    loginForgotText: "Для сброса пароля свяжитесь с системным администратором.",
    loginForgotOk: "Закрыть",
    loginSecure: "Безопасное соединение",
    menuLabel: "Меню",
    headerSubtitle: "Система управления службами питания",
    btnLogout: "Выход",
    btnPrev: "Назад",
    btnNext: "Далее",
    loading: "Загрузка...",
    loadingText: "Синхронизация данных...",
    loadingSub: "Проверка подключения Supabase",
    loadingSkip: "Нажмите для пропуска",
    versionLabel: "Версия приложения",
    sidebarPanel: "Панель",
    sidebarMenu: "Меню на неделю",
    sidebarRecords: "Записи",
    sidebarReport: "Отчёт",
    sidebarHaccp: "Безопасность пищи",
    sidebarCalibration: "Калибровка",
    sidebarOil: "Отработанное масло",
    sidebarPackaging: "Упаковочные отходы",
    sidebarCharts: "Графики",
    sidebarYearly: "Годовое сравнение",
    sidebarSpending: "Расходы",
    sidebarUnitPrice: "Единичные цены",
    sidebarDownload: "Скачать всё",
    sidebarBackup: "Резервное копирование",
    sidebarRestore: "Восстановить из Supabase",
    sidebarAdmin: "Администрирование",
    sidebarLogs: "Журналы",
    sidebarTheme: "Тема",
    sidebarManual: "Руководство пользователя",
    dashboardPrintPdf: "Печать PDF",
    kpiTotalRecords: "Всего дней производства",
    kpiTodayProduction: "Производство сегодня",
    kpiHaccpAlarm: "Тревога температуры холодильника",
    kpiCalibrationAlarm: "Тревога калибровки",
    kpiAvgWaste: "Средн. отходы (кг)",
    kpiTotalPasses: "Всего проходов через турникет",
    kpiTotalWaste: "Всего отходов (кг)",
    kpiWasteRate: "Процент отходов",
    weeklyPrevBtn: "Предыдущая неделя",
    weeklySummary: "Сводка за неделю",
    weeklyNextBtn: "Следующая неделя",
    weeklyBadge: "Эта неделя",
    dailyPrevBtn: "Предыдущий день",
    dailySummary: "Детали за день",
    dailyNextBtn: "Следующий день",
    weeklyCompTitle: "Сравнение по неделям",
    monthlyCompTitle: "Сравнение по месяцам",
    monthlyBadge: "Этот месяц",
    yearlyBadge: "Этот год",
    anomalyTitle: "Обнаружение аномалий",
    anomalyBadge: "Дни с аномальными отходами",
    lastRecordsTitle: "Последние записи",
    dashboardGoToRecords: "Перейти к записям",
    emptyDashboard: "Записей пока нет...",
    formulaTitle: "ФОРМУЛА РАСЧЁТА ОТХОДОВ",
    recordsEntryBtn: "Ввести производство/потребление",
    recordsImportBtn: "Импорт",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "Скачать CSV",
    recordsDeleteBtn: "Удалить выбранные",
    emptyRecords: "Записи не найдены.",
    thDate: "Дата",
    thProducedPerson: "Приготовлено блюд (чел.)",
    thWaste10: "10% отходы",
    thBeneficiary: "Получатели услуг питания",
    thPortionGr: "Порция (г)",
    thWasteKg: "Отходы (кг)",
    thWastedPortion: "Выброшено (порц.)",
    thFoodType: "Тип блюда",
    thAction: "Действие",
    thAcademicStaff: "Академический и административный персонал через турникет",
    thStudentCount: "Студенты через турникет",
    thBeneficiaryTotal: "Всего получателей услуг питания",
    sksStaff: "Персонал СКС",
    summaryReport: "Сводный отчёт",
    reportPdfBtn: "Открыть PDF",
    allRecordsPrint: "Все записи (Печатный вид)",
    rTotalRecords: "Общее число записей",
    rTotalMeals: "Всего приготовлено блюд",
    rTotalWaste10: "Всего 10% отходы",
    rTotalAfterWaste: "Всего блюд после 10% отходов",
    rTotalTurnstile: "Всего проходов через турникет",
    rTotalBeneficiary: "Всего получателей услуг питания",
    rTotalStaff: "Всего персонала СКС",
    rPortionSize: "Размер порции (г)",
    rTotalPortion: "Всего порций (г)",
    rWastedPortion: "Выброшенные порции",
    rMaxWeeklyBeneficiary: "Максимум получателей за неделю",
    rTotalWasteKg: "Общее количество отходов (кг)",
    rAvgWasteKg: "Средн. количество отходов (кг)",
    rTotalStudents: "Общее число студентов",
    rMaxWaste: "Максимум отходов (кг)",
    rMinWaste: "Минимум отходов (кг)",
    rWasteTrend: "Динамика отходов (посл. 7 дней)",
    rBeneficiaryTrend: "Динамика получателей (посл. 7 дней)",
    wasteByFoodTitle: "Анализ отходов по типу блюда",
    wasteByFoodEmpty: "Записи с данными о типе блюда не найдены.",
    wasteByFoodRecords: "Количество записей",
    wasteByFoodRate: "Процент отходов",
    wasteByFoodPerPerson: "Отходы на человека (кг)",
    wsProducedMeal: "Приготовлено блюд (чел.)",
    wsTotalPasses: "Всего проходов",
    wsTurnstile: "Турникет",
    wsStaffSKS: "Персонал СКС",
    wsWasteAmount: "Количество отходов",
    wsWastedPortion: "В мусор",
    wsStudents: "Студенты пит.",
    wsNoRecordsYet: "Записей пока нет",
    wsNoRecordThisWeek: "Нет записей за эту неделю",
    wsNoRecordToday: "Нет записи",
    wsTodayDetail: "Детали за сегодня",
    wsDailyDetail: "Дневная сводка",
    wsWaste: "Потери",
    wsPortion: "порция",
    wsProduced: "Выработано",
    wsTurnstileCount: "Проходы турникета",
    wsStaffCount: "Персонал",
    menuTitle: "Меню на неделю",
    menuStatusBadge: "Статус",
    menuSaveBtn: "Сохранить",
    menuSendBtn: "Отправить на согласование",
    menuApproveBtn: "Согласовать",
    menuRejectBtn: "Отклонить",
    menuWithdrawBtn: "Отозвать согласование",
    menuClearBtn: "Очистить таблицу",
    menuPrintBtn: "Печать",
    menuFoodListBtn: "Список блюд",
    menuFoodListUploadBtn: "Загрузить CSV",
    menuFoodListCsvBtn: "Скачать CSV",
    menuWarningPrefix: "Меню без согласования:",
    menuWarningText: "Меню на эту неделю ещё не утверждено инженером по питанию.",
    menuHintText: "Введите названия блюд...",
    productNeedsTitle: "Список необходимых продуктов",
    weeklyNeedsTitle: "Еженедельный общий список потребностей",
    foodListTitle: "Список блюд",
    modalRejectMenu: "Отклонить меню",
    modalRejectDesc: "Причина отклонения обязательна.",
    menuRejectConfirm: "Отклонить",
    haccpTitle: "Управление безопасностью пищевых продуктов",
    haccpCsvBtn: "Скачать CSV",
    haccpColdStorage: "Записи температуры холодильника",
    haccpNewBtn: "Новая запись",
    haccpDepotBtn: "Названия складов",
    haccpDepoQrNote: "Вы можете редактировать названия складов и генерировать QR-коды для каждого склада с помощью кнопки QR.",
    haccpModalTitle: "Новая запись",
    filterDepot: "Фильтр по складу:",
    filterAll: "Все",
    filterDateRange: "Диапазон дат:",
    emptyHaccp: "Записи температуры ещё не введены.",
    btnDeleteSelectedHaccp: "Удалить выбранные",
    btnPdf: "PDF",
    depoNamesTitle: "Названия складов",
    oilNewBtn: "Новая запись",
    oilListBtn: "Список",
    oilFilterTitle: "Фильтры отработанного масла",
    filterOilType: "Тип масла:",
    btnReset: "Сбросить",
    oilSummaryTitle: "Сводка по отработанному маслу",
    oilChartTitle: "Графики отработанного масла",
    oilChartSubtitle: "Ежемесячное количество отработанного масла (л)",
    oilChartEmpty: "Графики появятся после ввода записей об отработанном масле",
    oilChartNote: "Ежемесячные итоги отработанного масла по дате, типу масла и году",
    oilRecordsTitle: "Записи отработанного масла",
    oilModalTitle: "Запись отработанного масла",
    emptyOil: "Записи отработанного масла ещё не введены.",
    ambalajNewBtn: "Новая запись",
    ambalajListBtn: "Список",
    packagingFilterTitle: "Фильтры упаковочных отходов",
    filterWasteType: "Тип отходов:",
    packagingSummaryTitle: "Сводка по упаковочным отходам",
    packagingChartTitle: "Графики упаковочных отходов",
    packagingChartSubtitle: "Ежемесячное количество упаковочных отходов (кг)",
    packagingChartEmpty: "Графики появятся после ввода записей об упаковочных отходах",
    packagingChartNote: "Ежемесячные итоги упаковочных отходов по дате, типу отходов и году (кг)",
    packagingRecordsTitle: "Записи упаковочных отходов",
    packagingModalTitle: "Запись упаковочных отходов",
    emptyPackaging: "Записи упаковочных отходов ещё не введены.",
    kalibrasyonNewBtn: "Новое устройство",
    kalibrasyonListBtn: "Список",
    kalibrasyonCsvBtn: "Скачать CSV",
    calibrationSummary: "Сводка калибровки",
    calibrationDevices: "Устройства подлежащие калибровке",
    calibrationModalTitle: "Устройство для калибровки",
    filterStatus: "Статус:",
    filterDepartment: "Отдел:",
    btnWordExport: "Экспорт в Word",
    btnPrint: "Печать PDF",
    chartProdWaste: "Сравнение производства - проходов - отходов",
    chartEmpty: "Графики появятся после ввода данных",
    chartProdWasteNote: "Ежемесячное сравнение производства, проходов через турникет и выброшенных порций",
    chartStudentCount: "Число студентов, пользующихся услугами питания",
    yearTotal: "Итого за год",
    chartStudentNote: "Ежемесячный итог дневных проходов студентов",
    chartStaffTotal: "Академический и административный + персонал СКС",
    chartStaffNote: "Итог академического и административного (Турникет - Студенты) и персонала СКС",
    chartMonthlyProd: "Ежемесячное производство блюд",
    chartMonthlyProdNote: "Ежемесячный итог дневного количества произведённых блюд",
    chartMonthlyTurnstile: "Ежемесячное количество проходов через турникет",
    chartTurnstileNote: "Итог студенты + персонал + внешние проходы",
    chartMonthlyWaste: "Ежемесячное количество отходов (кг)",
    chartMonthlyWasteNote: "Ежемесячный итог дневных отходов (кг)",
    chartMonthlyWastePortion: "Ежемесячное количество отходов (порции)",
    chartWastePortionNote: "Ежемесячный итог дневных выброшенных порций",
    chartDiff: "Разница между производством и проходами",
    chartDiffNote: "Разница между произведёнными блюдами и проходами через турникет",
    chartWasteRatio: "Отходы в % от произведённых блюд",
    yearAverage: "Среднегодовой показатель",
    chartWasteRatioNote: "Процент произведённых блюд, которые становятся отходами",
    chartWastePerPerson: "Отходы на человека (кг/чел.)",
    chartWastePerPersonNote: "Средние отходы на каждого посетителя столовой",
    chartMonthlyTemp: "Среднемесячная температура на складах (°C)",
    chartTempEmpty: "Графики появятся после ввода записей о температуре",
    chartTempNote: "Среднемесячная температура каждого склада",
    yearlyPdfBtn: "Печать PDF",
    yearlyTotalProd: "Сравнение общего производства",
    yearlyTotalProdNote: "Итого за год - 1-й год vs 2-й год (порции)",
    yearlyTotalBen: "Всего получателей услуг питания",
    yearlyTotalBenNote: "Итого за год - 1-й год vs 2-й год (всего человек)",
    yearlyStudentComp: "Сравнение студентов-получателей",
    yearlyStudentNote: "Итого за год - 1-й год vs 2-й год (студенты)",
    yearlyWasteComp: "Сравнение отходов (кг)",
    yearlyWasteNote: "Итого за год - 1-й год vs 2-й год (кг)",
    yearlyMonthlyProd: "Ежемесячное сравнение производства",
    yearlyMonthlyProdNote: "1-й год vs 2-й год - произведённые блюда (порции)",
    yearlyMonthlyTurnstile: "Ежемесячное сравнение проходов через турникет",
    yearlyMonthlyTurnstileNote: "1-й год vs 2-й год - количество проходов",
    yearlyMonthlyStudent: "Ежемесячное сравнение проходов студентов",
    yearlyMonthlyStudentNote: "1-й год vs 2-й год - количество проходов студентов",
    yearlyMonthlyWaste: "Ежемесячное сравнение отходов (кг)",
    yearlyMonthlyWasteNote: "1-й год vs 2-й год - количество отходов (кг)",
    yearlyWasteListTitle: "Годовой список отходов",
    spendingRatesTitle: "Расходы на человека (Студенты, персонал и блюда)",
    spendingStudentRate: "Расходы на студента (TL)",
    btnSaveStudentRate: "Сохранить сумму студентов",
    spendingStaffRate: "Расходы на сотрудника (TL)",
    btnSaveStaffRate: "Сохранить сумму персонала",
    spendingMealRate: "Расходы на блюдо (TL)",
    btnSaveMealRate: "Сохранить сумму блюд",
    spendingDesc: "Расходы студентов = Число студентов × Расходы на студента",
    spendingStudentTitle: "Расходы на студентов (TL)",
    spendingChartEmpty: "Графики появятся после ввода записей",
    spendingStudentNote: "Расходы студентов (TL) = Число студентов × Расходы на студента",
    spendingStaffTitle: "Расходы на персонал (TL)",
    spendingStaffNote: "Расходы персонала (TL) = Число персонала × Расходы на сотрудника",
    spendingMealTitle: "Расходы на блюда (TL)",
    spendingMealNote: "Расходы на блюда (TL) = Произведённые блюда × Расходы на блюдо",
    spendingTableTitle: "Таблица расчёта расходов",
    syncTitle: "Синхронизация с Supabase",
    syncCloseBtn: "Закрыть",
    modalNewRecord: "Добавить запись",
    formDate: "Дата",
    formProducedCount: "Количество произведённых блюд",
    formTurnstileCount: "Количество проходов через турникет",
    formStudentCount: "Число студентов",
    formFoodType: "Тип блюда",
    formAutoCalc: "Автоматические расчёты",
    badgeAutomatic: "Автоматически",
    badgeFixed: "Фиксировано",
    badgeAutoEditable: "Автоматически + Редактируемое",
    btnCancel: "Отмена",
    entryFormSubmit: "Сохранить",
    formReceiptNo: "Номер квитанции",
    formOilType: "Тип масла",
    formAmountLt: "Количество (л)",
    formNote: "Примечание",
    formWasteType: "Тип отходов",
    formAmount: "Количество",
    formDeviceName: "Название устройства",
    formBrandModel: "Бренд-модель",
    formSerialNo: "Серийный номер",
    formStatus: "Статус",
    formVerification: "Поверка",
    formLastCalibration: "Последняя калибровка",
    formNextCalibration: "Следующая калибровка",
    formLocation: "Местоположение/Отдел",
    formResponsible: "Ответственное лицо",
    btnSave: "Сохранить",
    btnAdd: "Добавить",
    btnClose: "Закрыть",
    qrTitle: "QR-код",
    qrHint: "Распечатайте QR-код для размещения на дверях склада.",
    adminTitle: "Панель администрирования",
    adminReAuthText: "Пожалуйста, введите пароль администратора для доступа к панели.",
    adminPassword: "Пароль администратора",
    btnVerify: "Проверить",
    adminSessionRole: "Роль сессии",
    adminLastLogin: "Последний вход",
    adminAuthMethod: "Метод авторизации",
    adminStorage: "Хранилище паролей",
    adminDataSource: "Источник данных",
    adminUserMgmt: "Управление пользователями",
    adminUserMgmtDesc: "Добавляйте, редактируйте или удаляйте пользователей.",
    adminAddUser: "Добавить пользователя",
    adminUsername: "Имя пользователя",
    adminDisplayName: "Отображаемое имя",
    adminPasswordLabel: "Пароль",
    adminRole: "Роль",
    adminAddUserBtn: "Добавить пользователя",
    adminRolePerms: "Настройки прав по ролям",
    adminRolePermsDesc: "Настройте, какие вкладки доступны каждой роли.",
    adminSecurity: "Безопасность сессии",
    adminSecurityDesc: "Сессия будет закрыта, если нет активности в течение указанного времени.",
    adminInactivityTimeout: "Тайм-аут неактивности",
    adminLogsTitle: "Журнал действий",
    adminLogsDesc: "Вход/выход пользователей и операции с записями",
    btnRefresh: "Обновить",
    adminSaveBtn: "Сохранить настройки",
    adminFooterNote: "Пароли хранятся на сервере постоянно.",
    adminCloseBtn: "Закрыть",
    logFilterDelete: "Удаление",
    logFilterAddUser: "Добавление пользователя",
    logFilterDeleteUser: "Удаление пользователя",
    adminRefreshBtn: "Обновить",
    manualTitle: "Руководство пользователя",
    manualSubtitle: "Система контроля производства, потребления и отходов",
    compDataType: "Тип данных",
    compLastWeek: "Прошлая неделя",
    compThisWeek: "Эта неделя",
    compLastMonth: "Прошлый месяц",
    compThisMonth: "Этот месяц",
    compLastYear: "Прошлый год",
    compThisYear: "Этот год",
    compDiff: "Разница",
    compTotalWaste: "Всего отходов (кг)",
    compTotalProduction: "Всего произведено",
    compTurnstilePasses: "Проходы турникета",
    compStudentCount: "Кол-во студентов",
    compWastePerPerson: "Отходов на человека (гр)",
    monthlyCompDesc: "Сравнение текущего месяца с прошлым. ↑ рост, ↓ снижение. Снижение (↓) отходов и отходов на человека — это хорошо.",
    yearlyCompDesc: "Сравнение текущего года (с начала года) с аналогичным периодом прошлого года. ↑ рост, ↓ снижение. Снижение (↓) отходов и отходов на человека — это хорошо.",
    monthNames: ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"],
    haccpColDate: "Дата",
    haccpColTime: "Время",
    haccpColDepot: "Название склада",
    haccpColTemp: "Температура (°C)",
    haccpColHumidity: "Влажность (%)",
    haccpColNote: "Примечание",
    haccpColAction: "Действие",
    dayNames: ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"],
    menuVariety: "Вид",
    menuVariety1: "1-й вид",
    menuVariety2: "2-й вид",
    menuVariety3: "3-й вид",
    menuVariety4: "4-й вид",
    menuVariety5: "5-й вид",
    menuPersonCount: "Кол-во человек",
    stockDeductionList: "Списание со склада",
    perPersonCost: "Стоимость на человека",
    total: "Итого",
    inVarieties: "видах",
    person: "чел.",
    weeklyGrandTotal: "Итого за неделю",
    dailyAverage: "Среднее в день",
    avgPerPerson: "Среднее на человека",
    totalPersonDays: "Всего человек/дней",
    colDay: "День",
    colDate: "Дата",
    colPerson: "Чел.",
    dailyMaterialCost: "Суточная стоимость материалов",
    perPerson: "На человека",
    ingredients: "Ингредиенты",
    perPersonGram: "(грамм на человека)",
    colIngredient: "Ингредиент",
    colPerPerson: "/чел.",
    colUnit: "Ед.",
    addIngredient: "+ Добавить ингредиент",
    foodName: "Название блюда",
    allergen: "Аллерген",
    recipePerPerson: "Рецепт (на человека)",
    devices: "шт.",
  },
  ar: {
    loginSub: "نظام إدارة خدمات التغذية",
    loginFormSub: "تسجيل الدخول",
    loginUsername: "اسم المستخدم",
    loginSelectUser: "اختر المستخدم",
    loginPassword: "كلمة المرور",
    loginBtn: "تسجيل الدخول",
    loginHint: "يمكنك الحصول على كلمة المرور من المسؤول",
    loginFeature1: "تخطيط القائمة والإنتاج اليومي والاستهلاك والنفايات",
    loginFeature2: "تقارير مفصلة",
    loginFeature3: "لوحة مباشرة ورسوم بيانية",
    loginRemember: "تذكرني",
    loginForgot: "نسيت كلمة المرور؟",
    loginForgotTitle: "نسيت كلمة المرور",
    loginForgotText: "لإعادة تعيين كلمة المرور، يرجى التواصل مع مسؤول النظام.",
    loginForgotOk: "إغلاق",
    loginSecure: "اتصال آمن",
    menuLabel: "القائمة",
    headerSubtitle: "نظام إدارة خدمات التغذية",
    btnLogout: "تسجيل الخروج",
    btnPrev: "السابق",
    btnNext: "التالي",
    loading: "جارٍ التحميل...",
    loadingText: "مزامنة البيانات...",
    loadingSub: "التحقق من اتصال Supabase",
    loadingSkip: "انقر للتخطي",
    versionLabel: "إصدار التطبيق",
    sidebarPanel: "لوحة التحكم",
    sidebarMenu: "القائمة الأسبوعية",
    sidebarRecords: "السجلات",
    sidebarReport: "التقرير",
    sidebarHaccp: "سلامة الغذاء",
    sidebarCalibration: "المعايرة",
    sidebarOil: "النفايات الزيتية",
    sidebarPackaging: "نفايات التغليف",
    sidebarCharts: "الرسوم البيانية",
    sidebarYearly: "المقارنة السنوية",
    sidebarSpending: "المصروفات",
    sidebarUnitPrice: "الأسعاروحدة",
    sidebarDownload: "تنزيل الكل",
    sidebarBackup: "النسخ الاحتياطي إلى Supabase",
    sidebarRestore: "الاستعادة من Supabase",
    sidebarAdmin: "الإدارة",
    sidebarLogs: "سجلات النشاط",
    sidebarTheme: "المظهر",
    sidebarManual: "دليل المستخدم",
    dashboardPrintPdf: "طباعة PDF",
    kpiTotalRecords: "إجمالي أيام الإنتاج",
    kpiTodayProduction: "إنتاج اليوم",
    kpiHaccpAlarm: "تنبيه درجة حرارة التخزين البارد",
    kpiCalibrationAlarm: "تنبيه المعايرة",
    kpiAvgWaste: "متوسط النفايات (كغ)",
    kpiTotalPasses: "إجمالي عبور البوابة الدوّارة",
    kpiTotalWaste: "إجمالي النفايات (كغ)",
    kpiWasteRate: "نسبة النفايات",
    weeklyPrevBtn: "الأسبوع السابق",
    weeklySummary: "ملخص أسبوعي",
    weeklyNextBtn: "الأسبوع التالي",
    weeklyBadge: "هذا الأسبوع",
    dailyPrevBtn: "اليوم السابق",
    dailySummary: "تفاصيل يومية",
    dailyNextBtn: "اليوم التالي",
    weeklyCompTitle: "مقارنة أسبوعية",
    monthlyCompTitle: "مقارنة شهرية",
    monthlyBadge: "هذا الشهر",
    yearlyBadge: "هذا العام",
    anomalyTitle: "اكتشاف الشذوذ",
    anomalyBadge: "أيام النفايات غير الطبيعية",
    lastRecordsTitle: "آخر السجلات",
    dashboardGoToRecords: "الذهاب إلى السجلات",
    emptyDashboard: "لا توجد سجلات بعد...",
    formulaTitle: "صيغة حساب النفايات",
    recordsEntryBtn: "إدخال الإنتاج والاستهلاك",
    recordsImportBtn: "استيراد",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "تنزيل CSV",
    recordsDeleteBtn: "حذف المحدد",
    emptyRecords: "لم يتم العثور على سجلات.",
    thDate: "التاريخ",
    thProducedPerson: "الوجبات المُنتجة (شخص)",
    thWaste10: "نفايات 10%",
    thBeneficiary: "المستفيدون من خدمة الطعام",
    thPortionGr: "الحصة (غ)",
    thWasteKg: "النفايات (كغ)",
    thWastedPortion: "المُهملة (حصة)",
    thFoodType: "نوع الطعام",
    thAction: "الإجراء",
    thAcademicStaff: "الكاديميون والإداريون عبر البوابة الدوّارة",
    thStudentCount: "الطلاب عبر البوابة الدوّارة",
    thBeneficiaryTotal: "إجمالي مستفيدي خدمة الطعام",
    sksStaff: "موظفو خدمة الطعام (SKS)",
    summaryReport: "تقرير ملخص",
    reportPdfBtn: "فتح PDF",
    allRecordsPrint: "جميع السجلات (عرض الطباعة)",
    rTotalRecords: "إجمالي عدد السجلات",
    rTotalMeals: "إجمالي الوجبات المُنتجة",
    rTotalWaste10: "إجمالي نفايات 10%",
    rTotalAfterWaste: "إجمالي الوجبات بعد نفايات 10%",
    rTotalTurnstile: "إجمالي عبور البوابة الدوّارة",
    rTotalBeneficiary: "إجمالي مستفيدي خدمة الطعام",
    rTotalStaff: "إجمالي موظفي SKS المستفيدون",
    rPortionSize: "حجم الحصة (غ)",
    rTotalPortion: "إجمالي الحصص (غ)",
    rWastedPortion: "الحصص المُهملة",
    rMaxWeeklyBeneficiary: "أقصى عدد مستفيدين أسبوعياً",
    rTotalWasteKg: "إجمالي كمية النفايات (كغ)",
    rAvgWasteKg: "متوسط كمية النفايات (كغ)",
    rTotalStudents: "إجمالي عدد الطلاب",
    rMaxWaste: "أقصى نفايات (كغ)",
    rMinWaste: "أدنى نفايات (كغ)",
    rWasteTrend: "اتجاه النفايات (آخر 7 أيام)",
    rBeneficiaryTrend: "اتجاه المستفيدين (آخر 7 أيام)",
    wasteByFoodTitle: "تحليل النفايات حسب نوع الطعام",
    wasteByFoodEmpty: "لم يتم العثور على سجلات تحتوي على بيانات نوع الطعام.",
    wasteByFoodRecords: "عدد السجلات",
    wasteByFoodRate: "نسبة النفايات",
    wasteByFoodPerPerson: "النفايات للشخص (كغ)",
    wsProducedMeal: "الوجبات المنتجة (فرد)",
    wsTotalPasses: "إجمالي العبور",
    wsTurnstile: "البوابة الدوّارة",
    wsStaffSKS: "موظفو التغذية",
    wsWasteAmount: "كمية النفايات",
    wsWastedPortion: "النفايات",
    wsStudents: "طلاب التغذية",
    wsNoRecordsYet: "لا توجد سجلات بعد",
    wsNoRecordThisWeek: "لا سجلات هذا الأسبوع",
    wsNoRecordToday: "لا سجل",
    wsTodayDetail: "تفاصيل اليوم",
    wsDailyDetail: "التفاصيل اليومية",
    wsWaste: "هدر",
    wsPortion: "وجبة",
    wsProduced: "إنتاج",
    wsTurnstileCount: "عبور البوابة",
    wsStaffCount: "الموظفون",
    menuTitle: "قائمة الطعام الأسبوعية",
    menuStatusBadge: "الحالة",
    menuSaveBtn: "حفظ",
    menuSendBtn: "إرسال للموافقة",
    menuApproveBtn: "موافقة",
    menuRejectBtn: "رفض",
    menuWithdrawBtn: "سحب الموافقة",
    menuClearBtn: "مسح الجدول",
    menuPrintBtn: "طباعة",
    menuFoodListBtn: "قائمة الطعام",
    menuFoodListUploadBtn: "تحميل CSV",
    menuFoodListCsvBtn: "تنزيل CSV",
    menuWarningPrefix: "قائمة غير معتمدة:",
    menuWarningText: "لم تتم الموافقة على قائمة هذا الأسبوع من قِبَل مهندس الأغذية بعد.",
    menuHintText: "اكتب أسماء الوجبات...",
    productNeedsTitle: "قائمة احتياجات المنتجات",
    weeklyNeedsTitle: "القائمة الأسبوعية الإجمالية للاحتياجات",
    foodListTitle: "قائمة الطعام",
    modalRejectMenu: "رفض القائمة",
    modalRejectDesc: "سبب الرفض مطلوب.",
    menuRejectConfirm: "رفض",
    haccpTitle: "إدارة سلامة الأغذية",
    haccpCsvBtn: "تنزيل CSV",
    haccpColdStorage: "سجلات درجة حرارة التخزين البارد",
    haccpNewBtn: "سجل جديد",
    haccpDepotBtn: "أسماء المستودعات",
    haccpDepoQrNote: "يمكنك تعديل أسماء المستودعات وإنشاء رموز QR لكل مستودع باستخدام زر QR.",
    haccpModalTitle: "سجل جديد",
    filterDepot: "تصفية المستودع:",
    filterAll: "الكل",
    filterDateRange: "نطاق التاريخ:",
    emptyHaccp: "لم يتم إدخال سجلات درجة الحرارة بعد.",
    btnDeleteSelectedHaccp: "حذف المحدد",
    btnPdf: "PDF",
    depoNamesTitle: "أسماء المستودعات",
    oilNewBtn: "سجل جديد",
    oilListBtn: "قائمة",
    oilFilterTitle: "تصفية النفايات الزيتية",
    filterOilType: "نوع الزيت:",
    btnReset: "إعادة تعيين",
    oilSummaryTitle: "ملخص النفايات الزيتية",
    oilChartTitle: "الرسوم البيانية للنفايات الزيتية",
    oilChartSubtitle: "كمية النفايات الزيتية الشهرية (لتر)",
    oilChartEmpty: "ستظهر الروم البيانية عند إدخال سجلات النفايات الزيتية",
    oilChartNote: "المجاميع الشهرية للنفايات الزيتية حسب التاريخ ونوع الزيت والسنة",
    oilRecordsTitle: "سجلات النفايات الزيتية",
    oilModalTitle: "سجل النفايات الزيتية",
    emptyOil: "لم يتم إدخال سجلات النفايات الزيتية بعد.",
    ambalajNewBtn: "سجل جديد",
    ambalajListBtn: "قائمة",
    packagingFilterTitle: "تصفية نفايات التغليف",
    filterWasteType: "نوع النفايات:",
    packagingSummaryTitle: "ملخص نفايات التغليف",
    packagingChartTitle: "الرسوم البيانية لنفايات التغليف",
    packagingChartSubtitle: "كمية نفايات التغليف الشهرية (كغ)",
    packagingChartEmpty: "ستظهر الرسوم البيانية عند إدخال سجلات نفايات التغليف",
    packagingChartNote: "المجاميع الشهرية لنفايات التغليف حسب التاريخ ونوع النفايات والسنة (كغ)",
    packagingRecordsTitle: "سجلات نفايات التغليف",
    packagingModalTitle: "سجل نفايات التغليف",
    emptyPackaging: "لم يتم إدخال سجلات نفايات التغليف بعد.",
    kalibrasyonNewBtn: "جهاز جديد",
    kalibrasyonListBtn: "قائمة",
    kalibrasyonCsvBtn: "تنزيل CSV",
    calibrationSummary: "ملخص المعايرة",
    calibrationDevices: "الأجهزة الخاضعة للمعايرة",
    calibrationModalTitle: "جهاز للمعايرة",
    filterStatus: "الحالة:",
    filterDepartment: "القسم:",
    btnWordExport: "تصدير إلى Word",
    btnPrint: "طباعة PDF",
    chartProdWaste: "مقارنة الإنتاج والعبور والنفايات",
    chartEmpty: "ستظهر الرسوم البيانية عند إدخال البيانات",
    chartProdWasteNote: "مقارنة شهرية بين الإنتاج وعبور البوابة الدوّارة والحصص المُهملة",
    chartStudentCount: "عدد الطلاب المستفيدين من خدمات التغذية",
    yearTotal: "المجموع السنوي",
    chartStudentNote: "المجموع الشهري لعبور الطلاب اليومي",
    chartStaffTotal: "الكاديميون والإداريون + موظفو SKS",
    chartStaffNote: "مجموع الكاديميين والإداريين (البوابة الدوّارة - الطلاب) وموظفي خدمة الطعام SKS",
    chartMonthlyProd: "الإنتاج الشهري للوجبات",
    chartMonthlyProdNote: "المجموع الشهري لعدد الوجبات المُنتجة يومياً",
    chartMonthlyTurnstile: "عدد عبور البوابة الدوّارة الشهري",
    chartTurnstileNote: "مجموع الطلاب + الموظفون + العابرون من الخارج",
    chartMonthlyWaste: "كمية النفايات الشهرية (كغ)",
    chartMonthlyWasteNote: "المجموع الشهري للنفايات اليومية (كغ)",
    chartMonthlyWastePortion: "كمية النفايات الشهرية (حصص)",
    chartWastePortionNote: "المجموع الشهري للحصص المُهملة يومياً",
    chartDiff: "الفرق بين الإنتاج والعبور",
    chartDiffNote: "الفرق بين عدد الوجبات المُنتجة وعبور البوابة الدوّارة",
    chartWasteRatio: "نسبة النفايات من الوجبات المُنتجة",
    yearAverage: "المتوسط السنوي",
    chartWasteRatioNote: "نسبة الوجبات المُنتجة التي تتحول إلى نفايات",
    chartWastePerPerson: "النفايات لكل شخص (كغ/شخص)",
    chartWastePerPersonNote: "متوسط النفايات لكل شخص يدخل المطعم",
    chartMonthlyTemp: "متوسط درجات حرارة المستودعات الشهرية (°C)",
    chartTempEmpty: "ستظهر الرسوم البيانية عند إدخال سجلات درجات الحرارة",
    chartTempNote: "متوسط درجة الحرارة الشهرية لكل مستودع",
    yearlyPdfBtn: "طباعة PDF",
    yearlyTotalProd: "مقارنة الإجمالي السنوي للإنتاج",
    yearlyTotalProdNote: "المجموع السنوي - السنة الأولى vs السنة الثانية (حصص)",
    yearlyTotalBen: "إجمالي مستفيدي خدمة الطعام",
    yearlyTotalBenNote: "المجموع السنوي - السنة الأولى vs السنة الثانية (إجمالي الأشخاص)",
    yearlyStudentComp: "مقارنة الطلاب المستفيدين من خدمة الطعام",
    yearlyStudentNote: "المجموع السنوي - السنة الأولى vs السنة الثانية (الطلاب)",
    yearlyWasteComp: "مقارنة النفايات (كغ)",
    yearlyWasteNote: "المجموع السنوي - السنة الأولى vs السنة الثانية (كغ)",
    yearlyMonthlyProd: "مقارنة الإنتاج الشهري",
    yearlyMonthlyProdNote: "السنة الأولى vs السنة الثانية - الوجبات المُنتجة (حصص)",
    yearlyMonthlyTurnstile: "مقارنة عبور البوابة الدوّارة الشهري",
    yearlyMonthlyTurnstileNote: "السنة الأولى vs السنة الثانية - عدد عبور البوابة الدوّارة",
    yearlyMonthlyStudent: "مقارنة عبور الطلاب الشهري",
    yearlyMonthlyStudentNote: "السنة الأولى vs السنة الثانية - عدد عبور الطلاب",
    yearlyMonthlyWaste: "مقارنة النفايات الشهرية (كغ)",
    yearlyMonthlyWasteNote: "السنة الأولى vs السنة الثانية - كمية النفايات (كغ)",
    yearlyWasteListTitle: "قائمة النفايات السنوية",
    spendingRatesTitle: "معدلات الإنفاق لكل شخص (الطلاب والموظفون والوجبات)",
    spendingStudentRate: "مبلغ إنفاق كل طالب (TL)",
    btnSaveStudentRate: "حفظ مبلغ الطلاب",
    spendingStaffRate: "مبلغ إنفاق كل موظف (TL)",
    btnSaveStaffRate: "حفظ مبلغ الموظفين",
    spendingMealRate: "مبلغ إنفاق كل وجبة (TL)",
    btnSaveMealRate: "حفظ مبلغ الوجبات",
    spendingDesc: "إنفاق الطلاب = عدد الطلاب × مبلغ إنفاق كل طالب",
    spendingStudentTitle: "مبلغ إنفاق الطلاب (TL)",
    spendingChartEmpty: "ستظهر الرسوم البيانية عند إدخال السجلات",
    spendingStudentNote: "إنفاق الطلاب (TL) = عدد الطلاب × مبلغ إنفاق كل طالب",
    spendingStaffTitle: "مبلغ إنفاق الموظفين (TL)",
    spendingStaffNote: "إنفاق الموظفين (TL) = عدد الموظفين × مبلغ إنفاق كل موظف",
    spendingMealTitle: "مبلغ إنفاق الوجبات (TL)",
    spendingMealNote: "إنفاق الوجبات (TL) = الوجبات المُنتجة × مبلغ إنفاق كل وجبة",
    spendingTableTitle: "جدول حساب الإنفاق",
    syncTitle: "مزامنة Supabase",
    syncCloseBtn: "إغلاق",
    modalNewRecord: "إضافة سجل جديد",
    formDate: "التاريخ",
    formProducedCount: "عدد الوجبات المُنتجة",
    formTurnstileCount: "عدد عبور البوابة الدوّارة",
    formStudentCount: "عدد الطلاب المستفيدين",
    formFoodType: "نوع الطعام",
    formAutoCalc: "حسابات تلقائية",
    badgeAutomatic: "تلقائي",
    badgeFixed: "ثابت",
    badgeAutoEditable: "تلقائي + قابل للتعديل",
    btnCancel: "إلغاء",
    entryFormSubmit: "حفظ",
    formReceiptNo: "رقم الإيصال",
    formOilType: "نوع الزيت",
    formAmountLt: "الكمية (لتر)",
    formNote: "ملاحظة",
    formWasteType: "نوع النفايات",
    formAmount: "الكمية",
    formDeviceName: "اسم الجهاز",
    formBrandModel: "العلامة التجارية-الطراز",
    formSerialNo: "الرقم التسلسلي",
    formStatus: "الحالة",
    formVerification: "التحقق",
    formLastCalibration: "آخر معايرة",
    formNextCalibration: "المعايرة التالية",
    formLocation: "الموقع/القسم",
    formResponsible: "الشخص المسؤول",
    btnSave: "حفظ",
    btnAdd: "إضافة",
    btnClose: "إغلاق",
    qrTitle: "رمز QR",
    qrHint: "اطبع رمز QR لتثبيته على أبواب المستودعات.",
    adminTitle: "لوحة الإدارة",
    adminReAuthText: "يرجى إدخال كلمة مرور المسؤول للوصول إلى لوحة الإدارة.",
    adminPassword: "كلمة مرور المسؤول",
    btnVerify: "تحقق",
    adminSessionRole: "دور الجلسة",
    adminLastLogin: "آخر دخول",
    adminAuthMethod: "طريقة المصادقة",
    adminStorage: "مخزن كلمات المرور",
    adminDataSource: "مصدر البيانات",
    adminUserMgmt: "إدارة المستخدمين",
    adminUserMgmtDesc: "إضافة أو تعديل أو حذف المستخدمين.",
    adminAddUser: "إضافة مستخدم جديد",
    adminUsername: "اسم المستخدم",
    adminDisplayName: "الاسم الظاهر",
    adminPasswordLabel: "كلمة المرور",
    adminRole: "الدور",
    adminAddUserBtn: "إضافة مستخدم",
    adminRolePerms: "إعدادات الأذونات حسب الأدوار",
    adminRolePermsDesc: "تحديد التبويبات التي يمكن لكل دور عرضها.",
    adminSecurity: "أمان الجلسة",
    adminSecurityDesc: "ستُغلق الجلسة إذا لم يتم تنفيذ أي نشاط خلال المدة المحددة.",
    adminInactivityTimeout: "مهلة عدم النشاط",
    adminLogsTitle: "سجلات النشاط",
    adminLogsDesc: "تسجيل دخول/خروج المستخدمين وعمليات السجلات",
    btnRefresh: "تحديث",
    adminSaveBtn: "حفظ الإعدادات",
    adminFooterNote: "تُخزّن كلمات المرور بشكل دائم على الخادم.",
    adminCloseBtn: "إغلاق",
    logFilterDelete: "حذف",
    logFilterAddUser: "إضافة مستخدم",
    logFilterDeleteUser: "حذف مستخدم",
    adminRefreshBtn: "تحديث",
    manualTitle: "دليل المستخدم",
    manualSubtitle: "نظام التحكم في إنتاج واستهلاك ونفايات المطعم",
    compDataType: "نوع البيانات",
    compLastWeek: "الأسبوع الماضي",
    compThisWeek: "هذا الأسبوع",
    compLastMonth: "الشهر الماضي",
    compThisMonth: "هذا الشهر",
    compLastYear: "العام الماضي",
    compThisYear: "هذا العام",
    compDiff: "الفرق",
    compTotalWaste: "إجمالي النفايات (كغ)",
    compTotalProduction: "إجمالي الإنتاج",
    compTurnstilePasses: "عبور البوابة",
    compStudentCount: "عدد الطلاب",
    compWastePerPerson: "النفايات للفرد (غرام)",
    monthlyCompDesc: "مقارنة هذا الشهر مع الشهر الماضي. ↑ زيادة، ↓ انخفاض.انخفاض النفايات والنفايات للفرد (↓) جيد.",
    yearlyCompDesc: "مقارنة هذا العام (من بداية السنة حتى الآن) مع نفس الفترة من العام الماضي. ↑ زيادة، ↓ انخفاض.انخفاض النفايات والنفايات للفرد (↓) جيد.",
    monthNames: ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"],
    haccpColDate: "التاريخ",
    haccpColTime: "الوقت",
    haccpColDepot: "اسم المستودع",
    haccpColTemp: "درجة الحرارة (°م)",
    haccpColHumidity: "الرطوبة (%)",
    haccpColNote: "ملاحظة",
    haccpColAction: "إجراء",
    dayNames: ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"],
    menuVariety: "نوع",
    menuVariety1: "النوع الأول",
    menuVariety2: "النوع الثاني",
    menuVariety3: "النوع الثالث",
    menuVariety4: "النوع الرابع",
    menuVariety5: "النوع الخامس",
    menuPersonCount: "عدد الأشخاص",
    stockDeductionList: "قائمة خصم المخزون",
    perPersonCost: "التكلفة لكل فرد",
    total: "المجموع",
    inVarieties: "أنواع",
    person: "فرد",
    weeklyGrandTotal: "المجموع الأسبوعي",
    dailyAverage: "المتوسط اليومي",
    avgPerPerson: "المتوسط للفرد",
    totalPersonDays: "إجمالي الأشخاص/أيام",
    colDay: "اليوم",
    colDate: "التاريخ",
    colPerson: "الأشخاص",
    dailyMaterialCost: "تكلفة المواد اليومية",
    perPerson: "للفرد",
    ingredients: "المكونات",
    perPersonGram: "(غرام للفرد)",
    colIngredient: "المكون",
    colPerPerson: "/فرد",
    colUnit: "الوحدة",
    addIngredient: "+ إضافة مكون",
    foodName: "اسم الطبق",
    allergen: "الallingيرجين",
    recipePerPerson: "الوصفة (للفرد)",
    devices: "أجهزة",
  },
  de: {
    loginSub: "ERNAHRUNGSDIENST-VERWALTUNGSSYSTEM",
    loginFormSub: "Anmelden",
    loginUsername: "Benutzername",
    loginSelectUser: "Benutzer auswählen",
    loginPassword: "Passwort",
    loginBtn: "Anmelden",
    loginHint: "Sie erhalten Ihr Passwort von Ihrem Administrator",
    loginFeature1: "Menüplanung, tägliche Produktion, Verbrauch & Abfallverfolgung",
    loginFeature2: "Detaillierte Berichte",
    loginFeature3: "Live-Dashboard & Diagramme",
    loginRemember: "Angemeldet bleiben",
    loginForgot: "Passwort vergessen?",
    loginForgotTitle: "Passwort vergessen",
    loginForgotText: "Bitte wenden Sie sich zum Zurücksetzen des Passworts an Ihren Systemadministrator.",
    loginForgotOk: "Schließen",
    loginSecure: "Sichere Verbindung",
    menuLabel: "Menü",
    headerSubtitle: "Ernährungsdienste-Verwaltungssystem",
    btnLogout: "Abmelden",
    btnPrev: "Zurück",
    btnNext: "Weiter",
    loading: "Laden...",
    loadingText: "Daten werden synchronisiert...",
    loadingSub: "Supabase-Verbindung wird geprüft",
    loadingSkip: "Klicken zum Überspringen",
    versionLabel: "Anwendungsversion",
    sidebarPanel: "Dashboard",
    sidebarMenu: "Wochenmenü",
    sidebarRecords: "Aufzeichnungen",
    sidebarReport: "Bericht",
    sidebarHaccp: "Lebensmittelsicherheit",
    sidebarCalibration: "Kalibrierung",
    sidebarOil: "Altöl",
    sidebarPackaging: "Verpackungsabfall",
    sidebarCharts: "Diagramme",
    sidebarYearly: "Jahresvergleich",
    sidebarSpending: "Ausgaben",
    sidebarUnitPrice: "Stückpreise",
    sidebarDownload: "Alle herunterladen",
    sidebarBackup: "Bei Supabase sichern",
    sidebarRestore: "Von Supabase wiederherstellen",
    sidebarAdmin: "Verwaltung",
    sidebarLogs: "Protokolle",
    sidebarTheme: "Design",
    sidebarManual: "Benutzerhandbuch",
    dashboardPrintPdf: "PDF drucken",
    kpiTotalRecords: "Gesamte Produktions Tage",
    kpiTodayProduction: "Heutige Produktion",
    kpiHaccpAlarm: "Kühllager-Temperaturalarm",
    kpiCalibrationAlarm: "Kalibrierungsalarm",
    kpiAvgWaste: "Durchschn. Abfall (kg)",
    kpiTotalPasses: "Gesamte Drehkreuzdurchgänge",
    kpiTotalWaste: "Gesamter Abfall (kg)",
    kpiWasteRate: "Abfallquote",
    weeklyPrevBtn: "Vorherige Woche",
    weeklySummary: "Wochenzusammenfassung",
    weeklyNextBtn: "Nächste Woche",
    weeklyBadge: "Diese Woche",
    dailyPrevBtn: "Vorheriger Tag",
    dailySummary: "Tagesdetails",
    dailyNextBtn: "Nächster Tag",
    weeklyCompTitle: "Wochenvergleich",
    monthlyCompTitle: "Monatsvergleich",
    monthlyBadge: "Dieser Monat",
    yearlyBadge: "Dieses Jahr",
    anomalyTitle: "Anomalieerkennung",
    anomalyBadge: "Anormale Abfaltage",
    lastRecordsTitle: "Letzte Aufzeichnungen",
    dashboardGoToRecords: "Zu den Aufzeichnungen",
    emptyDashboard: "Noch keine Einträge...",
    formulaTitle: "ABFALLBERECHNUNGSFORMEL",
    recordsEntryBtn: "Produktion & Verbrauch eingeben",
    recordsImportBtn: "Importieren",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "CSV herunterladen",
    recordsDeleteBtn: "Ausgewählte löschen",
    emptyRecords: "Keine Aufzeichnungen gefunden.",
    thDate: "Datum",
    thProducedPerson: "Hergestellte Mahlzeiten (Person)",
    thWaste10: "10% Abfall",
    thBeneficiary: "Ernährungsdienst-Nutzer",
    thPortionGr: "Portion (g)",
    thWasteKg: "Abfall (kg)",
    thWastedPortion: "Entsorgt (Portionen)",
    thFoodType: "Essenstyp",
    thAction: "Aktion",
    thAcademicStaff: "Akademisches & Verwaltungspersonal über Drehkreuz",
    thStudentCount: "Studierende über Drehkreuz",
    thBeneficiaryTotal: "Gesamte Ernährungsdienst-Nutzer",
    sksStaff: "SKS-Ernährungsdienst-Personal",
    summaryReport: "Zusammenfassungsbericht",
    reportPdfBtn: "PDF öffnen",
    allRecordsPrint: "Alle Aufzeichnungen (Druckansicht)",
    rTotalRecords: "Gesamtzahl der Aufzeichnungen",
    rTotalMeals: "Gesamtzahl hergestellter Mahlzeiten",
    rTotalWaste10: "Gesamter 10%-Abfall",
    rTotalAfterWaste: "Mahlzeiten nach 10%-Abfall",
    rTotalTurnstile: "Gesamte Drehkreuzdurchgänge",
    rTotalBeneficiary: "Gesamte Ernährungsdienst-Nutzer",
    rTotalStaff: "Gesamtes SKS-Personal",
    rPortionSize: "Portionsgröße (g)",
    rTotalPortion: "Gesamtportionen (g)",
    rWastedPortion: "Entsorgte Portionen",
    rMaxWeeklyBeneficiary: "Höchste wöchentliche Nutzeranzahl",
    rTotalWasteKg: "Gesamte Abfallmenge (kg)",
    rAvgWasteKg: "Durchschn. Abfallmenge (kg)",
    rTotalStudents: "Gesamte Studierendenzahl",
    rMaxWaste: "Höchster Abfall (kg)",
    rMinWaste: "Niedrigster Abfall (kg)",
    rWasteTrend: "Abfalltrend (letzte 7 Tage)",
    rBeneficiaryTrend: "Nutzertrend (letzte 7 Tage)",
    wasteByFoodTitle: "Abfallanalyse nach Essenstyp",
    wasteByFoodEmpty: "Keine Aufzeichnungen mit Essenstyp-Daten gefunden.",
    wasteByFoodRecords: "Anzahl Einträge",
    wasteByFoodRate: "Abfallquote",
    wasteByFoodPerPerson: "Abfall pro Person (kg)",
    wsProducedMeal: "Mahlzeiten produziert (Pers.)",
    wsTotalPasses: "Gesamte Durchgänge",
    wsTurnstile: "Drehkreuz",
    wsStaffSKS: "Verpflegungspersonal",
    wsWasteAmount: "Abfallmenge",
    wsWastedPortion: "In den Müll",
    wsStudents: "Ernährungsstud.",
    wsNoRecordsYet: "Noch keine Einträge",
    wsNoRecordThisWeek: "Keine Einträge diese Woche",
    wsNoRecordToday: "Kein Eintrag",
    wsTodayDetail: "Heutige Details",
    wsDailyDetail: "Tagesdetails",
    wsWaste: "Verlust",
    wsPortion: "Portion",
    wsProduced: "Produziert",
    wsTurnstileCount: "Drehkreuzgänge",
    wsStaffCount: "Personal",
    menuTitle: "Wochen-Menüliste",
    menuStatusBadge: "Status",
    menuSaveBtn: "Speichern",
    menuSendBtn: "Zur Genehmigung senden",
    menuApproveBtn: "Genehmigen",
    menuRejectBtn: "Ablehnen",
    menuWithdrawBtn: "Genehmigung zurückziehen",
    menuClearBtn: "Tabelle leeren",
    menuPrintBtn: "Drucken",
    menuFoodListBtn: "Speisekarte",
    menuFoodListUploadBtn: "CSV hochladen",
    menuFoodListCsvBtn: "CSV herunterladen",
    menuWarningPrefix: "Nicht genehmigtes Menü:",
    menuWarningText: "Das Menü dieser Woche wurde vom Lebensmitteltechnologen noch nicht genehmigt.",
    menuHintText: "Essensnamen eingeben...",
    productNeedsTitle: "Produktbedarfsliste",
    weeklyNeedsTitle: "Wöchentliche Gesamtbedarfsliste",
    foodListTitle: "Speisekarte",
    modalRejectMenu: "Menü ablehnen",
    modalRejectDesc: "Ablehnungsgrund ist erforderlich.",
    menuRejectConfirm: "Ablehnen",
    haccpTitle: "Lebensmittelsicherheitsmanagement",
    haccpCsvBtn: "CSV herunterladen",
    haccpColdStorage: "Kühllager-Temperaturaufzeichnungen",
    haccpNewBtn: "Neuer Eintrag",
    haccpDepotBtn: "Lagerhausnamen",
    haccpDepoQrNote: "Sie können Lagerhausnamen bearbeiten und mit der QR-Schaltfläche QR-Codes für jedes Lagerhaus generieren.",
    haccpModalTitle: "Neuer Eintrag",
    filterDepot: "Lagerhausfilter:",
    filterAll: "Alle",
    filterDateRange: "Zeitraum:",
    emptyHaccp: "Noch keine Temperatureinträge vorhanden.",
    btnDeleteSelectedHaccp: "Ausgewählte löschen",
    btnPdf: "PDF",
    depoNamesTitle: "Lagerhausnamen",
    oilNewBtn: "Neuer Eintrag",
    oilListBtn: "Liste",
    oilFilterTitle: "Altöl-Filter",
    filterOilType: "Öltyp:",
    btnReset: "Zurücksetzen",
    oilSummaryTitle: "Altöl-Zusammenfassung",
    oilChartTitle: "Altöl-Diagramme",
    oilChartSubtitle: "Monatliche Altöl-Menge (Liter)",
    oilChartEmpty: "Diagramme werden angezeigt, wenn Altöleinträge erfasst werden",
    oilChartNote: "Monatliche Altöl-Summen nach Datum, Öltyp und Jahresfilter",
    oilRecordsTitle: "Altöl-Aufzeichnungen",
    oilModalTitle: "Altöl-Eintrag",
    emptyOil: "Noch keine Altöleinträge vorhanden.",
    ambalajNewBtn: "Neuer Eintrag",
    ambalajListBtn: "Liste",
    packagingFilterTitle: "Verpackungsabfall-Filter",
    filterWasteType: "Abfalltyp:",
    packagingSummaryTitle: "Verpackungsabfall-Zusammenfassung",
    packagingChartTitle: "Verpackungsabfall-Diagramme",
    packagingChartSubtitle: "Monatliche Verpackungsabfall-Menge (kg)",
    packagingChartEmpty: "Diagramme werden angezeigt, wenn Verpackungsabfälle erfasst werden",
    packagingChartNote: "Monatliche Verpackungsabfall-Summen nach Datum, Abfalltyp und Jahresfilter (kg)",
    packagingRecordsTitle: "Verpackungsabfall-Aufzeichnungen",
    packagingModalTitle: "Verpackungsabfall-Eintrag",
    emptyPackaging: "Noch keine Verpackungsabfall-Einträge vorhanden.",
    kalibrasyonNewBtn: "Neues Gerät",
    kalibrasyonListBtn: "Liste",
    kalibrasyonCsvBtn: "CSV herunterladen",
    calibrationSummary: "Kalibrierungszusammenfassung",
    calibrationDevices: "Zu kalibrierende Geräte",
    calibrationModalTitle: "Gerät zur Kalibrierung",
    filterStatus: "Status:",
    filterDepartment: "Abteilung:",
    btnWordExport: "Nach Word exportieren",
    btnPrint: "PDF drucken",
    chartProdWaste: "Produktion - Durchgänge - Abfall-Vergleich",
    chartEmpty: "Diagramme werden angezeigt, wenn Daten eingegeben werden",
    chartProdWasteNote: "Monatlicher Vergleich von Produktion, Drehkreuzdurchgängen und entsorgten Portionen",
    chartStudentCount: "Anzahl der Studierenden im Ernährungsdienst",
    yearTotal: "Jahresgesamt",
    chartStudentNote: "Monatliche Summe der täglichen Studierendendurchgänge",
    chartStaffTotal: "Akademisches & Verwaltungspersonal + SKS-Personal",
    chartStaffNote: "Summe von Akademischem & Verwaltungspersonal (Drehkreuz - Studierende) und SKS-Ernährungsdienst-Personal",
    chartMonthlyProd: "Monatliche Mahlzeitenproduktion",
    chartMonthlyProdNote: "Monatliche Summe der täglich hergestellten Mahlzeiten",
    chartMonthlyTurnstile: "Monatliche Drehkreuzdurchgänge",
    chartTurnstileNote: "Studierende + Personal + externe Durchgänge",
    chartMonthlyWaste: "Monatliche Abfallmenge (kg)",
    chartMonthlyWasteNote: "Monatliche Summe des täglichen Abfalls (kg)",
    chartMonthlyWastePortion: "Monatliche Abfallmenge (Portionen)",
    chartWastePortionNote: "Monatliche Summe der täglich entsorgten Portionen",
    chartDiff: "Differenz zwischen Produktion und Durchgängen",
    chartDiffNote: "Unterschied zwischen hergestellten Mahlzeiten und Drehkreuzdurchgängen",
    chartWasteRatio: "Abfall % der hergestellten Mahlzeiten",
    yearAverage: "Jahresdurchschnitt",
    chartWasteRatioNote: "Prozentsatz der hergestellten Mahlzeiten, die zu Abfall werden",
    chartWastePerPerson: "Abfall pro Person (kg/Person)",
    chartWastePerPersonNote: "Durchschnittlicher Abfall pro Person im Speisesaal",
    chartMonthlyTemp: "Monatliche durchschnittliche Lagerhaus-Temperaturen (°C)",
    chartTempEmpty: "Diagramme werden angezeigt, wenn Temperatureinträge erfasst werden",
    chartTempNote: "Monatliche Durchschnittstemperatur jedes Lagerhauses",
    yearlyPdfBtn: "PDF drucken",
    yearlyTotalProd: "Gesamtproduktions-Vergleich",
    yearlyTotalProdNote: "Jahresgesamt - Jahr 1 vs Jahr 2 (Portionen)",
    yearlyTotalBen: "Gesamte Ernährungsdienst-Nutzer",
    yearlyTotalBenNote: "Jahresgesamt - Jahr 1 vs Jahr 2 (Gesamtpersonen)",
    yearlyStudentComp: "Studierenden-Nutzervergleich im Ernährungsdienst",
    yearlyStudentNote: "Jahresgesamt - Jahr 1 vs Jahr 2 (Studierende)",
    yearlyWasteComp: "Abfall-Vergleich (kg)",
    yearlyWasteNote: "Jahresgesamt - Jahr 1 vs Jahr 2 (kg)",
    yearlyMonthlyProd: "Monatlicher Produktionsvergleich",
    yearlyMonthlyProdNote: "Jahr 1 vs Jahr 2 - hergestellte Mahlzeiten (Portionen)",
    yearlyMonthlyTurnstile: "Monatlicher Drehkreuz-Vergleich",
    yearlyMonthlyTurnstileNote: "Jahr 1 vs Jahr 2 - Anzahl der Drehkreuzdurchgänge",
    yearlyMonthlyStudent: "Monatlicher Studierenden-Drehkreuz-Vergleich",
    yearlyMonthlyStudentNote: "Jahr 1 vs Jahr 2 - Studierende-Drehkreuzdurchgänge",
    yearlyMonthlyWaste: "Monatlicher Abfall-Vergleich (kg)",
    yearlyMonthlyWasteNote: "Jahr 1 vs Jahr 2 - Abfallmenge (kg)",
    yearlyWasteListTitle: "Jährliche Abfallliste",
    spendingRatesTitle: "Pro-Kopf-Ausgaben (Studierende, Personal & Mahlzeiten)",
    spendingStudentRate: "Studierenden-Ausgaben pro Person (TL)",
    btnSaveStudentRate: "Studierenden-Betrag speichern",
    spendingStaffRate: "Personal-Ausgaben pro Person (TL)",
    btnSaveStaffRate: "Personal-Betrag speichern",
    spendingMealRate: "Mahlzeiten-Ausgaben pro Mahlzeit (TL)",
    btnSaveMealRate: "Mahlzeiten-Betrag speichern",
    spendingDesc: "Studierenden-Ausgaben = Studierendenzahl × Studierenden-Ausgaben pro Person",
    spendingStudentTitle: "Studierenden-Ausgaben (TL)",
    spendingChartEmpty: "Diagramme werden angezeigt, wenn Einträge erfasst werden",
    spendingStudentNote: "Studierenden-Ausgaben (TL) = Studierendenzahl × Studierenden-Ausgaben pro Person",
    spendingStaffTitle: "Personal-Ausgaben (TL)",
    spendingStaffNote: "Personal-Ausgaben (TL) = Personalanzahl × Personal-Ausgaben pro Person",
    spendingMealTitle: "Mahlzeiten-Ausgaben (TL)",
    spendingMealNote: "Mahlzeiten-Ausgaben (TL) = Hergestellte Mahlzeiten × Mahlzeiten-Ausgaben pro Mahlzeit",
    spendingTableTitle: "Ausgabenberechnungstabelle",
    syncTitle: "Supabase-Synchronisierung",
    syncCloseBtn: "Schließen",
    modalNewRecord: "Neuen Eintrag hinzufügen",
    formDate: "Datum",
    formProducedCount: "Anzahl hergestellter Mahlzeiten",
    formTurnstileCount: "Anzahl der Drehkreuzdurchgänge",
    formStudentCount: "Anzahl der Studierenden",
    formFoodType: "Essenstyp",
    formAutoCalc: "Automatische Berechnungen",
    badgeAutomatic: "Automatisch",
    badgeFixed: "Fest",
    badgeAutoEditable: "Automatisch + Bearbeitbar",
    btnCancel: "Abbrechen",
    entryFormSubmit: "Speichern",
    formReceiptNo: "Belegnummer",
    formOilType: "Öltyp",
    formAmountLt: "Menge (Liter)",
    formNote: "Notiz",
    formWasteType: "Abfalltyp",
    formAmount: "Menge",
    formDeviceName: "Gerätename",
    formBrandModel: "Marke-Modell",
    formSerialNo: "Seriennummer",
    formStatus: "Status",
    formVerification: "Eichung",
    formLastCalibration: "Letzte Kalibrierung",
    formNextCalibration: "Nächste Kalibrierung",
    formLocation: "Standort/Abteilung",
    formResponsible: "Verantwortliche Person",
    btnSave: "Speichern",
    btnAdd: "Hinzufügen",
    btnClose: "Schließen",
    qrTitle: "QR-Code",
    qrHint: "Drucken Sie den QR-Code für die Lagerhaustüren aus.",
    adminTitle: "Verwaltungspanel",
    adminReAuthText: "Bitte geben Sie Ihr Admin-Passwort ein, um auf das Verwaltungspanel zuzugreifen.",
    adminPassword: "Admin-Passwort",
    btnVerify: "Überprüfen",
    adminSessionRole: "Sitzungsrolle",
    adminLastLogin: "Letzte Anmeldung",
    adminAuthMethod: "Auth-Methode",
    adminStorage: "Passwortspeicher",
    adminDataSource: "Datenquelle",
    adminUserMgmt: "Benutzerverwaltung",
    adminUserMgmtDesc: "Benutzer hinzufügen, bearbeiten oder löschen.",
    adminAddUser: "Neuen Benutzer hinzufügen",
    adminUsername: "Benutzername",
    adminDisplayName: "Anzeigename",
    adminPasswordLabel: "Passwort",
    adminRole: "Rolle",
    adminAddUserBtn: "Benutzer hinzufügen",
    adminRolePerms: "Rollenbasierte Berechtigungseinstellungen",
    adminRolePermsDesc: "Legen Sie fest, welche Registerkarten jede Rolle sehen kann.",
    adminSecurity: "Sitzungssicherheit",
    adminSecurityDesc: "Die Sitzung wird geschlossen, wenn innerhalb des angegebenen Zeitraums keine Aktivität erfolgt.",
    adminInactivityTimeout: "Inaktivitäts-Timeout",
    adminLogsTitle: "Aktivitätsprotokolle",
    adminLogsDesc: "Benutzeran/-abmeldungen und Eintragsoperationen",
    btnRefresh: "Aktualisieren",
    adminSaveBtn: "Einstellungen speichern",
    adminFooterNote: "Passwörter werden dauerhaft auf dem Server gespeichert.",
    adminCloseBtn: "Schließen",
    logFilterDelete: "Löschen",
    logFilterAddUser: "Benutzer hinzufügen",
    logFilterDeleteUser: "Benutzer löschen",
    adminRefreshBtn: "Aktualisieren",
    manualTitle: "Benutzerhandbuch",
    manualSubtitle: "Speisenhaus-Produktions-, Verbrauchs- und Abfallkontrollsystem",
    compDataType: "Datentyp",
    compLastWeek: "Vorherige Woche",
    compThisWeek: "Diese Woche",
    compLastMonth: "Vorheriger Monat",
    compThisMonth: "Dieser Monat",
    compLastYear: "Vorheriges Jahr",
    compThisYear: "Dieses Jahr",
    compDiff: "Differenz",
    compTotalWaste: "Gesamtabfall (kg)",
    compTotalProduction: "Gesamtproduktion",
    compTurnstilePasses: "Drehkreuzdurchgänge",
    compStudentCount: "Anzahl Studenten",
    compWastePerPerson: "Abfall pro Person (g)",
    monthlyCompDesc: "Vergleich dieses Monats mit dem Vormonat. ↑ Anstieg, ↓ Rückgang. Ein Rückgang (↓) bei Abfall und Abfall pro Person ist gut.",
    yearlyCompDesc: "Vergleich dieses Jahres (Jahresbilanz) mit demselben Zeitraum des Vorjahres. ↑ Anstieg, ↓ Rückgang. Ein Rückgang (↓) bei Abfall und Abfall pro Person ist gut.",
    monthNames: ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"],
    haccpColDate: "Datum",
    haccpColTime: "Uhrzeit",
    haccpColDepot: "Lagername",
    haccpColTemp: "Temperatur (°C)",
    haccpColHumidity: "Feuchtigkeit (%)",
    haccpColNote: "Notiz",
    haccpColAction: "Aktion",
    dayNames: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"],
    menuVariety: "Sorte",
    menuVariety1: "1. Sorte",
    menuVariety2: "2. Sorte",
    menuVariety3: "3. Sorte",
    menuVariety4: "4. Sorte",
    menuVariety5: "5. Sorte",
    menuPersonCount: "Personenanzahl",
    stockDeductionList: "Lagerabschreibungsliste",
    perPersonCost: "Kosten pro Person",
    total: "Gesamt",
    inVarieties: "Sorten",
    person: "Pers.",
    weeklyGrandTotal: "Wöchentliche Gesamtsumme",
    dailyAverage: "Tagesdurchschnitt",
    avgPerPerson: "Durchschnitt pro Person",
    totalPersonDays: "Gesamt Personen/Tage",
    colDay: "Tag",
    colDate: "Datum",
    colPerson: "Pers.",
    dailyMaterialCost: "Tägliche Materialkosten",
    perPerson: "Pro Person",
    ingredients: "Zutaten",
    perPersonGram: "(Gramm pro Person)",
    colIngredient: "Zutat",
    colPerPerson: "/Pers.",
    colUnit: "Einheit",
    addIngredient: "+ Zutat hinzufügen",
    foodName: "Gerichtname",
    allergen: "Allergen",
    recipePerPerson: "Rezept (pro Person)",
    devices: "Geräte",
  },
  fr: {
    loginSub: "SYSTÈME DE GESTION DES SERVICES DE RESTAURATION",
    loginFormSub: "Connexion",
    loginUsername: "Nom d'utilisateur",
    loginSelectUser: "Sélectionner l'utilisateur",
    loginPassword: "Mot de passe",
    loginBtn: "Se connecter",
    loginHint: "Vous pouvez obtenir votre mot de passe auprès de votre administrateur",
    loginFeature1: "Planification du menu, production quotidienne, consommation et déchets",
    loginFeature2: "Rapports détaillés",
    loginFeature3: "Tableau de bord en direct et graphiques",
    loginRemember: "Se souvenir de moi",
    loginForgot: "Mot de passe oublié ?",
    loginForgotTitle: "Mot de passe oublié",
    loginForgotText: "Veuillez contacter votre administrateur système pour réinitialiser le mot de passe.",
    loginForgotOk: "Fermer",
    loginSecure: "Connexion sécurisée",
    menuLabel: "Menu",
    headerSubtitle: "Système de gestion des services de nutrition",
    btnLogout: "Déconnexion",
    btnPrev: "Précédent",
    btnNext: "Suivant",
    loading: "Chargement...",
    loadingText: "Synchronisation des données...",
    loadingSub: "Vérification de la connexion Supabase",
    loadingSkip: "Cliquez pour ignorer",
    versionLabel: "Version de l'application",
    sidebarPanel: "Tableau de bord",
    sidebarMenu: "Menu hebdomadaire",
    sidebarRecords: "Enregistrements",
    sidebarReport: "Rapport",
    sidebarHaccp: "Sécurité alimentaire",
    sidebarCalibration: "Calibration",
    sidebarOil: "Huile usagée",
    sidebarPackaging: "Déchets d'emballage",
    sidebarCharts: "Graphiques",
    sidebarYearly: "Comparaison annuelle",
    sidebarSpending: "Dépenses",
    sidebarUnitPrice: "Prix unitaires",
    sidebarDownload: "Tout télécharger",
    sidebarBackup: "Sauvegarder sur Supabase",
    sidebarRestore: "Restaurer depuis Supabase",
    sidebarAdmin: "Administration",
    sidebarLogs: "Journaux",
    sidebarTheme: "Thème",
    sidebarManual: "Manuel utilisateur",
    dashboardPrintPdf: "Imprimer PDF",
    kpiTotalRecords: "Total des jours de production",
    kpiTodayProduction: "Production du jour",
    kpiHaccpAlarm: "Alarme température chambre froide",
    kpiCalibrationAlarm: "Alarme de calibration",
    kpiAvgWaste: "Déchets moyens (kg)",
    kpiTotalPasses: "Total des passages au tourniquet",
    kpiTotalWaste: "Total des déchets (kg)",
    kpiWasteRate: "Taux de déchets",
    weeklyPrevBtn: "Semaine précédente",
    weeklySummary: "Résumé hebdomadaire",
    weeklyNextBtn: "Semaine suivante",
    weeklyBadge: "Cette semaine",
    dailyPrevBtn: "Jour précédent",
    dailySummary: "Détail quotidien",
    dailyNextBtn: "Jour suivant",
    weeklyCompTitle: "Comparaison hebdomadaire",
    monthlyCompTitle: "Comparaison mensuelle",
    monthlyBadge: "Ce mois-ci",
    yearlyBadge: "Cette année",
    anomalyTitle: "Détection d'anomalies",
    anomalyBadge: "Jours de déchets anormaux",
    lastRecordsTitle: "Derniers enregistrements",
    dashboardGoToRecords: "Aller aux enregistrements",
    emptyDashboard: "Pas encore d'enregistrements...",
    formulaTitle: "FORMULE DE CALCUL DES DÉCHETS",
    recordsEntryBtn: "Saisir production/consommation",
    recordsImportBtn: "Importer",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "Télécharger CSV",
    recordsDeleteBtn: "Supprimer la sélection",
    emptyRecords: "Aucun enregistrement trouvé.",
    thDate: "Date",
    thProducedPerson: "Repas produits (Personne)",
    thWaste10: "10% de déchets",
    thBeneficiary: "Bénéficiaires du service de restauration",
    thPortionGr: "Portion (g)",
    thWasteKg: "Déchets (kg)",
    thWastedPortion: "Jetée (portion)",
    thFoodType: "Type de plat",
    thAction: "Action",
    thAcademicStaff: "Personnel académique & administratif via tourniquet",
    thStudentCount: "Étudiants via tourniquet",
    thBeneficiaryTotal: "Total des bénéficiaires du service de restauration",
    sksStaff: "Personnel SKS restauration",
    summaryReport: "Rapport de synthèse",
    reportPdfBtn: "Ouvrir PDF",
    allRecordsPrint: "Tous les enregistrements (Vue d'impression)",
    rTotalRecords: "Nombre total d'enregistrements",
    rTotalMeals: "Total des repas produits",
    rTotalWaste10: "Total des déchets 10%",
    rTotalAfterWaste: "Total des repas après 10% de déchets",
    rTotalTurnstile: "Total des passages au tourniquet",
    rTotalBeneficiary: "Total des bénéficiaires du service de restauration",
    rTotalStaff: "Total du personnel SKS bénéficiaire",
    rPortionSize: "Taille de la portion (g)",
    rTotalPortion: "Total des portions (g)",
    rWastedPortion: "Portions jetées",
    rMaxWeeklyBeneficiary: "Nombre maximum de bénéficiaires hebdomadaire",
    rTotalWasteKg: "Quantité totale de déchets (kg)",
    rAvgWasteKg: "Quantité moyenne de déchets (kg)",
    rTotalStudents: "Nombre total d'étudiants",
    rMaxWaste: "Déchets maximum (kg)",
    rMinWaste: "Déchets minimum (kg)",
    rWasteTrend: "Tendance des déchets (7 derniers jours)",
    rBeneficiaryTrend: "Tendance des bénéficiaires (7 derniers jours)",
    wasteByFoodTitle: "Analyse des déchets par type de plat",
    wasteByFoodEmpty: "Aucun enregistrement avec des données de type de plat trouvé.",
    wasteByFoodRecords: "Nombre d'enreg.",
    wasteByFoodRate: "Taux de déchets",
    wasteByFoodPerPerson: "Déchets par personne (kg)",
    wsProducedMeal: "Repas produits (pers.)",
    wsTotalPasses: "Total des passages",
    wsTurnstile: "Tourniquet",
    wsStaffSKS: "Personnel restauration",
    wsWasteAmount: "Quantité de déchets",
    wsWastedPortion: "Jeté",
    wsStudents: "Étudiants nutrition",
    wsNoRecordsYet: "Aucun enregistrement",
    wsNoRecordThisWeek: "Aucun enreg. cette semaine",
    wsNoRecordToday: "Aucun enreg.",
    wsTodayDetail: "Détails du jour",
    wsDailyDetail: "Détails quotidiens",
    wsWaste: "Perte",
    wsPortion: "portion",
    wsProduced: "Produit",
    wsTurnstileCount: "Passages tourniquet",
    wsStaffCount: "Personnel",
    menuTitle: "Menu hebdomadaire",
    menuStatusBadge: "Statut",
    menuSaveBtn: "Enregistrer",
    menuSendBtn: "Envoyer pour approbation",
    menuApproveBtn: "Approuver",
    menuRejectBtn: "Rejeter",
    menuWithdrawBtn: "Retirer l'approbation",
    menuClearBtn: "Effacer le tableau",
    menuPrintBtn: "Imprimer",
    menuFoodListBtn: "Liste des plats",
    menuFoodListUploadBtn: "Téléverser CSV",
    menuFoodListCsvBtn: "Télécharger CSV",
    menuWarningPrefix: "Menu non approuvé :",
    menuWarningText: "Le menu de cette semaine n'a pas encore été approuvé par le nutritionniste.",
    menuHintText: "Tapez les noms des plats...",
    productNeedsTitle: "Liste des besoins en produits",
    weeklyNeedsTitle: "Liste hebdomadaire des besoins totaux",
    foodListTitle: "Liste des plats",
    modalRejectMenu: "Rejeter le menu",
    modalRejectDesc: "Le motif de rejet est obligatoire.",
    menuRejectConfirm: "Rejeter",
    haccpTitle: "Gestion de la sécurité alimentaire",
    haccpCsvBtn: "Télécharger CSV",
    haccpColdStorage: "Enregistrements de température chambre froide",
    haccpNewBtn: "Nouvel enregistrement",
    haccpDepotBtn: "Noms des dépôts",
    haccpDepoQrNote: "Vous pouvez modifier les noms des dépôts et générer des codes QR pour chaque dépôt avec le bouton QR.",
    haccpModalTitle: "Nouvel enregistrement",
    filterDepot: "Filtre de dépôt :",
    filterAll: "Tous",
    filterDateRange: "Période :",
    emptyHaccp: "Aucun enregistrement de température saisi.",
    btnDeleteSelectedHaccp: "Supprimer la sélection",
    btnPdf: "PDF",
    depoNamesTitle: "Noms des dépôts",
    oilNewBtn: "Nouvel enregistrement",
    oilListBtn: "Liste",
    oilFilterTitle: "Filtres huile usagée",
    filterOilType: "Type d'huile :",
    btnReset: "Réinitialiser",
    oilSummaryTitle: "Résumé des huiles usagées",
    oilChartTitle: "Graphiques des huiles usagées",
    oilChartSubtitle: "Quantité mensuelle d'huile usagée (litres)",
    oilChartEmpty: "Les graphiques apparaîtront lorsque des enregistrements d'huile usagée seront saisis",
    oilChartNote: "Totaux mensuels d'huile usagée par date, type d'huile et filtres d'année",
    oilRecordsTitle: "Enregistrements d'huile usagée",
    oilModalTitle: "Enregistrement d'huile usagée",
    emptyOil: "Aucun enregistrement d'huile usagée saisi.",
    ambalajNewBtn: "Nouvel enregistrement",
    ambalajListBtn: "Liste",
    packagingFilterTitle: "Filtres déchets d'emballage",
    filterWasteType: "Type de déchet :",
    packagingSummaryTitle: "Résumé des déchets d'emballage",
    packagingChartTitle: "Graphiques des déchets d'emballage",
    packagingChartSubtitle: "Quantité mensuelle de déchets d'emballage (kg)",
    packagingChartEmpty: "Les graphiques apparaîtront lorsque des enregistrements de déchets d'emballage seront saisis",
    packagingChartNote: "Totaux mensuels de déchets d'emballage par date, type de déchet et filtres d'année (kg)",
    packagingRecordsTitle: "Enregistrements de déchets d'emballage",
    packagingModalTitle: "Enregistrement de déchets d'emballage",
    emptyPackaging: "Aucun enregistrement de déchets d'emballage saisi.",
    kalibrasyonNewBtn: "Nouvel appareil",
    kalibrasyonListBtn: "Liste",
    kalibrasyonCsvBtn: "Télécharger CSV",
    calibrationSummary: "Résumé de la calibration",
    calibrationDevices: "Appareils soumis à la calibration",
    calibrationModalTitle: "Appareil pour calibration",
    filterStatus: "Statut :",
    filterDepartment: "Département :",
    btnWordExport: "Exporter vers Word",
    btnPrint: "Imprimer PDF",
    chartProdWaste: "Comparaison Production - Passages - Déchets",
    chartEmpty: "Les graphiques apparaîtront lorsque des données seront saisies",
    chartProdWasteNote: "Comparaison mensuelle de la production, des passages au tourniquet et des portions jetées",
    chartStudentCount: "Nombre d'étudiants utilisant le service de restauration",
    yearTotal: "Total annuel",
    chartStudentNote: "Total mensuel des passages étudiants quotidiens",
    chartStaffTotal: "Total personnel académique & administratif + SKS",
    chartStaffNote: "Total du personnel académique & administratif (Tourniquet - Étudiants) et du personnel SKS restauration",
    chartMonthlyProd: "Production mensuelle de repas",
    chartMonthlyProdNote: "Total mensuel du nombre de repas produits quotidiennement",
    chartMonthlyTurnstile: "Passages mensuels au tourniquet",
    chartTurnstileNote: "Total étudiants + personnel + passages externes",
    chartMonthlyWaste: "Quantité mensuelle de déchets (kg)",
    chartMonthlyWasteNote: "Total mensuel des déchets quotidiens (kg)",
    chartMonthlyWastePortion: "Quantité mensuelle de déchets (portions)",
    chartWastePortionNote: "Total mensuel des portions jetées quotidiennement",
    chartDiff: "Différence entre production et passages",
    chartDiffNote: "Différence entre repas produits et passages au tourniquet",
    chartWasteRatio: "Déchets % des repas produits",
    yearAverage: "Moyenne annuelle",
    chartWasteRatioNote: "Pourcentage des repas produits qui deviennent des déchets",
    chartWastePerPerson: "Déchets par personne (kg/personne)",
    chartWastePerPersonNote: "Déchets moyens par personne entrant dans la cantine",
    chartMonthlyTemp: "Températures moyennes mensuelles des dépôts (°C)",
    chartTempEmpty: "Les graphiques apparaîtront lorsque des enregistrements de température seront saisis",
    chartTempNote: "Température moyenne mensuelle de chaque dépôt",
    yearlyPdfBtn: "Imprimer PDF",
    yearlyTotalProd: "Comparaison de la production totale",
    yearlyTotalProdNote: "Total annuel - Année 1 vs Année 2 (portions)",
    yearlyTotalBen: "Total des bénéficiaires du service de restauration",
    yearlyTotalBenNote: "Total annuel - Année 1 vs Année 2 (total personnes)",
    yearlyStudentComp: "Comparaison des étudiants bénéficiaires",
    yearlyStudentNote: "Total annuel - Année 1 vs Année 2 (étudiants)",
    yearlyWasteComp: "Comparaison des déchets (kg)",
    yearlyWasteNote: "Total annuel - Année 1 vs Année 2 (kg)",
    yearlyMonthlyProd: "Comparaison mensuelle de la production",
    yearlyMonthlyProdNote: "Année 1 vs Année 2 - repas produits (portions)",
    yearlyMonthlyTurnstile: "Comparaison mensuelle des passages au tourniquet",
    yearlyMonthlyTurnstileNote: "Année 1 vs Année 2 - nombre de passages au tourniquet",
    yearlyMonthlyStudent: "Comparaison mensuelle des passages étudiants",
    yearlyMonthlyStudentNote: "Année 1 vs Année 2 - nombre de passages étudiants",
    yearlyMonthlyWaste: "Comparaison mensuelle des déchets (kg)",
    yearlyMonthlyWasteNote: "Année 1 vs Année 2 - quantité de déchets (kg)",
    yearlyWasteListTitle: "Liste annuelle des déchets",
    spendingRatesTitle: "Taux de dépenses par personne (Étudiants, Personnel & Repas)",
    spendingStudentRate: "Montant de dépense par étudiant (TL)",
    btnSaveStudentRate: "Enregistrer montant étudiants",
    spendingStaffRate: "Montant de dépense par membre du personnel (TL)",
    btnSaveStaffRate: "Enregistrer montant personnel",
    spendingMealRate: "Montant de dépense par repas (TL)",
    btnSaveMealRate: "Enregistrer montant repas",
    spendingDesc: "Dépenses étudiants = Nombre d'étudiants × Montant par étudiant",
    spendingStudentTitle: "Dépenses étudiants (TL)",
    spendingChartEmpty: "Les graphiques apparaîtront lorsque des enregistrements seront saisis",
    spendingStudentNote: "Dépenses étudiants (TL) = Nombre d'étudiants × Montant par étudiant",
    spendingStaffTitle: "Dépenses personnel (TL)",
    spendingStaffNote: "Dépenses personnel (TL) = Nombre de personnel × Montant par membre du personnel",
    spendingMealTitle: "Dépenses repas (TL)",
    spendingMealNote: "Dépenses repas (TL) = Repas produits × Montant par repas",
    spendingTableTitle: "Tableau de calcul des dépenses",
    syncTitle: "Synchronisation Supabase",
    syncCloseBtn: "Fermer",
    modalNewRecord: "Ajouter un enregistrement",
    formDate: "Date",
    formProducedCount: "Nombre de repas produits",
    formTurnstileCount: "Nombre de passages au tourniquet",
    formStudentCount: "Nombre d'étudiants",
    formFoodType: "Type de plat",
    formAutoCalc: "Calculs automatiques",
    badgeAutomatic: "Automatique",
    badgeFixed: "Fixe",
    badgeAutoEditable: "Automatique + Modifiable",
    btnCancel: "Annuler",
    entryFormSubmit: "Enregistrer",
    formReceiptNo: "N° de reçu",
    formOilType: "Type d'huile",
    formAmountLt: "Quantité (litres)",
    formNote: "Note",
    formWasteType: "Type de déchet",
    formAmount: "Quantité",
    formDeviceName: "Nom de l'appareil",
    formBrandModel: "Marque-Modèle",
    formSerialNo: "Numéro de série",
    formStatus: "Statut",
    formVerification: "Vérification",
    formLastCalibration: "Dernière calibration",
    formNextCalibration: "Prochaine calibration",
    formLocation: "Emplacement/Département",
    formResponsible: "Personne responsable",
    btnSave: "Enregistrer",
    btnAdd: "Ajouter",
    btnClose: "Fermer",
    qrTitle: "Code QR",
    qrHint: "Imprimez le code QR à accrocher sur les portes des dépôts.",
    adminTitle: "Panneau d'administration",
    adminReAuthText: "Veuillez entrer votre mot de passe administrateur pour accéder au panneau.",
    adminPassword: "Mot de passe administrateur",
    btnVerify: "Vérifier",
    adminSessionRole: "Rôle de la session",
    adminLastLogin: "Dernière connexion",
    adminAuthMethod: "Méthode d'authentification",
    adminStorage: "Stockage des mots de passe",
    adminDataSource: "Source de données",
    adminUserMgmt: "Gestion des utilisateurs",
    adminUserMgmtDesc: "Ajoutez, modifiez ou supprimez des utilisateurs.",
    adminAddUser: "Ajouter un utilisateur",
    adminUsername: "Nom d'utilisateur",
    adminDisplayName: "Nom affiché",
    adminPasswordLabel: "Mot de passe",
    adminRole: "Rôle",
    adminAddUserBtn: "Ajouter l'utilisateur",
    adminRolePerms: "Paramètres de permissions par rôle",
    adminRolePermsDesc: "Définissez quels onglets chaque rôle peut voir.",
    adminSecurity: "Sécurité de session",
    adminSecurityDesc: "La session se ferma si aucune activité n'est effectuée pendant la durée spécifiée.",
    adminInactivityTimeout: "Délai d'inactivité",
    adminLogsTitle: "Journal des activités",
    adminLogsDesc: "Connexion/déconnexion des utilisateurs et opérations sur les enregistrements",
    btnRefresh: "Actualiser",
    adminSaveBtn: "Enregistrer les paramètres",
    adminFooterNote: "Les mots de passe sont stockés en permanence sur le serveur.",
    adminCloseBtn: "Fermer",
    logFilterDelete: "Suppression",
    logFilterAddUser: "Ajout d'utilisateur",
    logFilterDeleteUser: "Suppression d'utilisateur",
    adminRefreshBtn: "Actualiser",
    manualTitle: "Manuel utilisateur",
    manualSubtitle: "Système de contrôle de la production, consommation et des déchets de la cantine",
    compDataType: "Type de données",
    compLastWeek: "Semaine dernière",
    compThisWeek: "Cette semaine",
    compLastMonth: "Mois dernier",
    compThisMonth: "Ce mois-ci",
    compLastYear: "Année dernière",
    compThisYear: "Cette année",
    compDiff: "Écart",
    compTotalWaste: "Déchets totaux (kg)",
    compTotalProduction: "Production totale",
    compTurnstilePasses: "Passages tourniquet",
    compStudentCount: "Nombre d'étudiants",
    compWastePerPerson: "Déchets par personne (g)",
    monthlyCompDesc: "Comparaison de ce mois avec le mois dernier. ↑ augmentation, ↓ diminution. Une diminution (↓) des déchets et des déchets par personne est bonne.",
    yearlyCompDesc: "Comparaison de cette année (du début de l'année à aujourd'hui) avec la même période l'année dernière. ↑ augmentation, ↓ diminution. Une diminution (↓) des déchets et des déchets par personne est bonne.",
    monthNames: ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"],
    haccpColDate: "Date",
    haccpColTime: "Heure",
    haccpColDepot: "Nom de l'entrepôt",
    haccpColTemp: "Température (°C)",
    haccpColHumidity: "Humidité (%)",
    haccpColNote: "Note",
    haccpColAction: "Action",
    dayNames: ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"],
    menuVariety: "Variété",
    menuVariety1: "1ère variété",
    menuVariety2: "2ème variété",
    menuVariety3: "3ème variété",
    menuVariety4: "4ème variété",
    menuVariety5: "5ème variété",
    menuPersonCount: "Nombre de personnes",
    stockDeductionList: "Liste de déduction de stock",
    perPersonCost: "Coût par personne",
    total: "Total",
    inVarieties: "variétés",
    person: "pers.",
    weeklyGrandTotal: "Total hebdomadaire",
    dailyAverage: "Moyenne journalière",
    avgPerPerson: "Moyenne par personne",
    totalPersonDays: "Total personnes/jours",
    colDay: "Jour",
    colDate: "Date",
    colPerson: "Pers.",
    dailyMaterialCost: "Coût matériaux journalier",
    perPerson: "Par personne",
    ingredients: "Ingrédients",
    perPersonGram: "(grammes par personne)",
    colIngredient: "Ingrédient",
    colPerPerson: "/pers.",
    colUnit: "Unité",
    addIngredient: "+ Ajouter un ingrédient",
    foodName: "Nom du plat",
    allergen: "Allergène",
    recipePerPerson: "Recette (par personne)",
    devices: "appareils",
  },
  es: {
    loginSub: "SISTEMA DE GESTIÓN DE SERVICIOS DE NUTRICIÓN",
    loginFormSub: "Iniciar sesión",
    loginUsername: "Usuario",
    loginSelectUser: "Seleccionar usuario",
    loginPassword: "Contraseña",
    loginBtn: "Iniciar sesión",
    loginHint: "Puede obtener su contraseña del administrador",
    loginFeature1: "Planificación de menú, producción diaria, consumo y residuos",
    loginFeature2: "Informes detallados",
    loginFeature3: "Panel en vivo y gráficos",
    loginRemember: "Recuérdame",
    loginForgot: "¿Olvidó su contraseña?",
    loginForgotTitle: "Contraseña olvidada",
    loginForgotText: "Para restablecer su contraseña, póngase en contacto con el administrador del sistema.",
    loginForgotOk: "Cerrar",
    loginSecure: "Conexión segura",
    menuLabel: "Menú",
    headerSubtitle: "Sistema de gestión de servicios de nutrición",
    btnLogout: "Cerrar sesión",
    btnPrev: "Anterior",
    btnNext: "Siguiente",
    loading: "Cargando...",
    loadingText: "Sincronizando datos...",
    loadingSub: "Verificando conexión con Supabase",
    loadingSkip: "Haga clic para omitir",
    versionLabel: "Versión de la aplicación",
    sidebarPanel: "Panel",
    sidebarMenu: "Menú semanal",
    sidebarRecords: "Registros",
    sidebarReport: "Informe",
    sidebarHaccp: "Seguridad alimentaria",
    sidebarCalibration: "Calibración",
    sidebarOil: "Aceite usado",
    sidebarPackaging: "Residuos de envases",
    sidebarCharts: "Gráficos",
    sidebarYearly: "Comparación anual",
    sidebarSpending: "Gastos",
    sidebarUnitPrice: "Precios unitarios",
    sidebarDownload: "Descargar todo",
    sidebarBackup: "Copia de seguridad en Supabase",
    sidebarRestore: "Restaurar desde Supabase",
    sidebarAdmin: "Administración",
    sidebarLogs: "Registros de actividad",
    sidebarTheme: "Tema",
    sidebarManual: "Manual de usuario",
    dashboardPrintPdf: "Imprimir PDF",
    kpiTotalRecords: "Total de días de producción",
    kpiTodayProduction: "Producción de hoy",
    kpiHaccpAlarm: "Alarma de temperatura de cámara frigorífica",
    kpiCalibrationAlarm: "Alarma de calibración",
    kpiAvgWaste: "Residuos promedio (kg)",
    kpiTotalPasses: "Total de pasadas por torniquete",
    kpiTotalWaste: "Total de residuos (kg)",
    kpiWasteRate: "Tasa de residuos",
    weeklyPrevBtn: "Semana anterior",
    weeklySummary: "Resumen semanal",
    weeklyNextBtn: "Semana siguiente",
    weeklyBadge: "Esta semana",
    dailyPrevBtn: "Día anterior",
    dailySummary: "Detalle diario",
    dailyNextBtn: "Día siguiente",
    weeklyCompTitle: "Comparación semanal",
    monthlyCompTitle: "Comparación mensual",
    monthlyBadge: "Este mes",
    yearlyBadge: "Este año",
    anomalyTitle: "Detección de anomalías",
    anomalyBadge: "Días con residuos anormales",
    lastRecordsTitle: "Últimos registros",
    dashboardGoToRecords: "Ir a registros",
    emptyDashboard: "Aún no hay registros...",
    formulaTitle: "FÓRMULA DE CÁLCULO DE RESIDUOS",
    recordsEntryBtn: "Ingresar producción/consumo",
    recordsImportBtn: "Importar",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "Descargar CSV",
    recordsDeleteBtn: "Eliminar seleccionados",
    emptyRecords: "No se encontraron registros.",
    thDate: "Fecha",
    thProducedPerson: "Comidas producidas (Persona)",
    thWaste10: "Residuos 10%",
    thBeneficiary: "Beneficiarios del servicio de alimentación",
    thPortionGr: "Porción (g)",
    thWasteKg: "Residuos (kg)",
    thWastedPortion: "Descartada (porción)",
    thFoodType: "Tipo de comida",
    thAction: "Acción",
    thAcademicStaff: "Personal académico y administrativo por torniquete",
    thStudentCount: "Estudiantes por torniquete",
    thBeneficiaryTotal: "Total de beneficiarios del servicio de alimentación",
    sksStaff: "Personal SKS de alimentación",
    summaryReport: "Informe resumen",
    reportPdfBtn: "Abrir PDF",
    allRecordsPrint: "Todos los registros (Vista de impresión)",
    rTotalRecords: "Total de registros",
    rTotalMeals: "Total de comidas producidas",
    rTotalWaste10: "Total de residuos 10%",
    rTotalAfterWaste: "Total de comidas después de 10% de residuos",
    rTotalTurnstile: "Total de pasadas por torniquete",
    rTotalBeneficiary: "Total de beneficiarios del servicio de alimentación",
    rTotalStaff: "Total de personal SKS beneficiado",
    rPortionSize: "Tamaño de porción (g)",
    rTotalPortion: "Total de porciones (g)",
    rWastedPortion: "Porciones descartadas",
    rMaxWeeklyBeneficiary: "Máximo de beneficiarios semanales",
    rTotalWasteKg: "Cantidad total de residuos (kg)",
    rAvgWasteKg: "Cantidad promedio de residuos (kg)",
    rTotalStudents: "Total de estudiantes",
    rMaxWaste: "Máximo de residuos (kg)",
    rMinWaste: "Mínimo de residuos (kg)",
    rWasteTrend: "Tendencia de residuos (últimos 7 días)",
    rBeneficiaryTrend: "Tendencia de beneficiarios (últimos 7 días)",
    wasteByFoodTitle: "Análisis de residuos por tipo de comida",
    wasteByFoodEmpty: "No se encontraron registros con datos de tipo de comida.",
    wasteByFoodRecords: "Nº de registros",
    wasteByFoodRate: "Tasa de residuos",
    wasteByFoodPerPerson: "Residuos por persona (kg)",
    wsProducedMeal: "Comidas producidas (pers.)",
    wsTotalPasses: "Total de pases",
    wsTurnstile: "Torniquete",
    wsStaffSKS: "Personal de nutrición",
    wsWasteAmount: "Cantidad de residuos",
    wsWastedPortion: "Al basurero",
    wsStudents: "Estudiantes nutrición",
    wsNoRecordsYet: "Sin registros aún",
    wsNoRecordThisWeek: "Sin registros esta semana",
    wsNoRecordToday: "Sin registro",
    wsTodayDetail: "Detalle de hoy",
    wsDailyDetail: "Detalle diario",
    wsWaste: "Merma",
    wsPortion: "porción",
    wsProduced: "Producido",
    wsTurnstileCount: "Pases torniquete",
    wsStaffCount: "Personal",
    menuTitle: "Menú semanal",
    menuStatusBadge: "Estado",
    menuSaveBtn: "Guardar",
    menuSendBtn: "Enviar para aprobación",
    menuApproveBtn: "Aprobar",
    menuRejectBtn: "Rechazar",
    menuWithdrawBtn: "Retirar aprobación",
    menuClearBtn: "Limpiar tabla",
    menuPrintBtn: "Imprimir",
    menuFoodListBtn: "Lista de comidas",
    menuFoodListUploadBtn: "Subir CSV",
    menuFoodListCsvBtn: "Descargar CSV",
    menuWarningPrefix: "Menú no aprobado:",
    menuWarningText: "El menú de esta semana aún no ha sido aprobado por el ingeniero de alimentos.",
    menuHintText: "Escriba los nombres de las comidas...",
    productNeedsTitle: "Lista de necesidades de productos",
    weeklyNeedsTitle: "Lista semanal total de necesidades",
    foodListTitle: "Lista de comidas",
    modalRejectMenu: "Rechazar menú",
    modalRejectDesc: "El motivo de rechazo es obligatorio.",
    menuRejectConfirm: "Rechazar",
    haccpTitle: "Gestión de seguridad alimentaria",
    haccpCsvBtn: "Descargar CSV",
    haccpColdStorage: "Registros de temperatura de cámara frigorífica",
    haccpNewBtn: "Nuevo registro",
    haccpDepotBtn: "Nombres de depósitos",
    haccpDepoQrNote: "Puede editar los nombres de los depósitos y generar códigos QR para cada depósito con el botón QR.",
    haccpModalTitle: "Nuevo registro",
    filterDepot: "Filtro de depósito:",
    filterAll: "Todos",
    filterDateRange: "Rango de fechas:",
    emptyHaccp: "Aún no se han ingresado registros de temperatura.",
    btnDeleteSelectedHaccp: "Eliminar seleccionados",
    btnPdf: "PDF",
    depoNamesTitle: "Nombres de depósitos",
    oilNewBtn: "Nuevo registro",
    oilListBtn: "Lista",
    oilFilterTitle: "Filtros de aceite usado",
    filterOilType: "Tipo de aceite:",
    btnReset: "Restablecer",
    oilSummaryTitle: "Resumen de aceite usado",
    oilChartTitle: "Gráficos de aceite usado",
    oilChartSubtitle: "Cantidad mensual de aceite usado (litros)",
    oilChartEmpty: "Los gráficos aparecerán cuando se ingresen registros de aceite usado",
    oilChartNote: "Totales mensuales de aceite usado por fecha, tipo de aceite y filtros de año",
    oilRecordsTitle: "Registros de aceite usado",
    oilModalTitle: "Registro de aceite usado",
    emptyOil: "Aún no se han ingresado registros de aceite usado.",
    ambalajNewBtn: "Nuevo registro",
    ambalajListBtn: "Lista",
    packagingFilterTitle: "Filtros de residuos de envases",
    filterWasteType: "Tipo de residuo:",
    packagingSummaryTitle: "Resumen de residuos de envases",
    packagingChartTitle: "Gráficos de residuos de envases",
    packagingChartSubtitle: "Cantidad mensual de residuos de envases (kg)",
    packagingChartEmpty: "Los gráficos aparecerán cuando se ingresen registros de residuos de envases",
    packagingChartNote: "Totales mensuales de residuos de envases por fecha, tipo de residuo y filtros de año (kg)",
    packagingRecordsTitle: "Registros de residuos de envases",
    packagingModalTitle: "Registro de residuos de envases",
    emptyPackaging: "Aún no se han ingresado registros de residuos de envases.",
    kalibrasyonNewBtn: "Nuevo dispositivo",
    kalibrasyonListBtn: "Lista",
    kalibrasyonCsvBtn: "Descargar CSV",
    calibrationSummary: "Resumen de calibración",
    calibrationDevices: "Dispositivos sujetos a calibración",
    calibrationModalTitle: "Dispositivo para calibración",
    filterStatus: "Estado:",
    filterDepartment: "Departamento:",
    btnWordExport: "Exportar a Word",
    btnPrint: "Imprimir PDF",
    chartProdWaste: "Comparación Producción - Pasadas - Residuos",
    chartEmpty: "Los gráficos aparecerán cuando se ingresen datos",
    chartProdWasteNote: "Comparación mensual de producción, pasadas por torniquete y porciones descartadas",
    chartStudentCount: "Número de estudiantes que usan el servicio de alimentación",
    yearTotal: "Total anual",
    chartStudentNote: "Total mensual de pasadas diarias de estudiantes",
    chartStaffTotal: "Total de personal académico y administrativo + SKS",
    chartStaffNote: "Total del personal académico y administrativo (Torniquete - Estudiantes) y del personal SKS de alimentación",
    chartMonthlyProd: "Producción mensual de comidas",
    chartMonthlyProdNote: "Total mensual del número diario de comidas producidas",
    chartMonthlyTurnstile: "Pasadas mensuales por torniquete",
    chartTurnstileNote: "Estudiantes + personal + pasadas externas",
    chartMonthlyWaste: "Cantidad mensual de residuos (kg)",
    chartMonthlyWasteNote: "Total mensual de residuos diarios (kg)",
    chartMonthlyWastePortion: "Cantidad mensual de residuos (porciones)",
    chartWastePortionNote: "Total mensual de porciones descartadas diariamente",
    chartDiff: "Diferencia entre producción y pasadas",
    chartDiffNote: "Diferencia entre comidas producidas y pasadas por torniquete",
    chartWasteRatio: "Residuos % de las comidas producidas",
    yearAverage: "Promedio anual",
    chartWasteRatioNote: "Porcentaje de comidas producidas que se convierten en residuos",
    chartWastePerPerson: "Residuos por persona (kg/persona)",
    chartWastePerPersonNote: "Residuos promedio por persona que ingresa al comedor",
    chartMonthlyTemp: "Temperaturas promedio mensuales de depósitos (°C)",
    chartTempEmpty: "Los gráficos aparecerán cuando se ingresen registros de temperatura",
    chartTempNote: "Temperatura promedio mensual de cada depósito",
    yearlyPdfBtn: "Imprimir PDF",
    yearlyTotalProd: "Comparación de producción total",
    yearlyTotalProdNote: "Total anual - Año 1 vs Año 2 (porciones)",
    yearlyTotalBen: "Total de beneficiarios del servicio de alimentación",
    yearlyTotalBenNote: "Total anual - Año 1 vs Año 2 (total personas)",
    yearlyStudentComp: "Comparación de estudiantes beneficiarios",
    yearlyStudentNote: "Total anual - Año 1 vs Año 2 (estudiantes)",
    yearlyWasteComp: "Comparación de residuos (kg)",
    yearlyWasteNote: "Total anual - Año 1 vs Año 2 (kg)",
    yearlyMonthlyProd: "Comparación mensual de producción",
    yearlyMonthlyProdNote: "Año 1 vs Año 2 - comidas producidas (porciones)",
    yearlyMonthlyTurnstile: "Comparación mensual de pasadas por torniquete",
    yearlyMonthlyTurnstileNote: "Año 1 vs Año 2 - cantidad de pasadas por torniquete",
    yearlyMonthlyStudent: "Comparación mensual de pasadas de estudiantes",
    yearlyMonthlyStudentNote: "Año 1 vs Año 2 - cantidad de pasadas de estudiantes",
    yearlyMonthlyWaste: "Comparación mensual de residuos (kg)",
    yearlyMonthlyWasteNote: "Año 1 vs Año 2 - cantidad de residuos (kg)",
    yearlyWasteListTitle: "Lista anual de residuos",
    spendingRatesTitle: "Tasas de gasto por persona (Estudiantes, Personal y Comidas)",
    spendingStudentRate: "Monto de gasto por estudiante (TL)",
    btnSaveStudentRate: "Guardar monto estudiantes",
    spendingStaffRate: "Monto de gasto por miembro del personal (TL)",
    btnSaveStaffRate: "Guardar monto personal",
    spendingMealRate: "Monto de gasto por comida (TL)",
    btnSaveMealRate: "Guardar monto comidas",
    spendingDesc: "Gasto de estudiantes = Nro. estudiantes × Monto por estudiante",
    spendingStudentTitle: "Gasto de estudiantes (TL)",
    spendingChartEmpty: "Los gráficos aparecerán cuando se ingresen registros",
    spendingStudentNote: "Gasto de estudiantes (TL) = Nro. estudiantes × Monto por estudiante",
    spendingStaffTitle: "Gasto del personal (TL)",
    spendingStaffNote: "Gasto del personal (TL) = Nro. personal × Monto por miembro del personal",
    spendingMealTitle: "Gasto de comidas (TL)",
    spendingMealNote: "Gasto de comidas (TL) = Comidas producidas × Monto por comida",
    spendingTableTitle: "Tabla de cálculo de gastos",
    syncTitle: "Sincronización Supabase",
    syncCloseBtn: "Cerrar",
    modalNewRecord: "Agregar nuevo registro",
    formDate: "Fecha",
    formProducedCount: "Número de comidas producidas",
    formTurnstileCount: "Número de pasadas por torniquete",
    formStudentCount: "Número de estudiantes",
    formFoodType: "Tipo de comida",
    formAutoCalc: "Cálculos automáticos",
    badgeAutomatic: "Automático",
    badgeFixed: "Fijo",
    badgeAutoEditable: "Automático + Editable",
    btnCancel: "Cancelar",
    entryFormSubmit: "Guardar",
    formReceiptNo: "N° de recibo",
    formOilType: "Tipo de aceite",
    formAmountLt: "Cantidad (litros)",
    formNote: "Nota",
    formWasteType: "Tipo de residuo",
    formAmount: "Cantidad",
    formDeviceName: "Nombre del dispositivo",
    formBrandModel: "Marca-Modelo",
    formSerialNo: "Número de serie",
    formStatus: "Estado",
    formVerification: "Verificación",
    formLastCalibration: "Última calibración",
    formNextCalibration: "Siguiente calibración",
    formLocation: "Ubicación/Departamento",
    formResponsible: "Persona responsable",
    btnSave: "Guardar",
    btnAdd: "Agregar",
    btnClose: "Cerrar",
    qrTitle: "Código QR",
    qrHint: "Imprima el código QR para colgar en las puertas de los depósitos.",
    adminTitle: "Panel de administración",
    adminReAuthText: "Ingrese su contraseña de administrador para acceder al panel.",
    adminPassword: "Contraseña de administrador",
    btnVerify: "Verificar",
    adminSessionRole: "Rol de sesión",
    adminLastLogin: "Último inicio de sesión",
    adminAuthMethod: "Método de autenticación",
    adminStorage: "Almacén de contraseñas",
    adminDataSource: "Fuente de datos",
    adminUserMgmt: "Gestión de usuarios",
    adminUserMgmtDesc: "Agregue, edite o elimine usuarios.",
    adminAddUser: "Agregar nuevo usuario",
    adminUsername: "Nombre de usuario",
    adminDisplayName: "Nombre para mostrar",
    adminPasswordLabel: "Contraseña",
    adminRole: "Rol",
    adminAddUserBtn: "Agregar usuario",
    adminRolePerms: "Configuración de permisos por rol",
    adminRolePermsDesc: "Configure qué pestañas puede ver cada rol.",
    adminSecurity: "Seguridad de sesión",
    adminSecurityDesc: "La sesión se cerrará si no hay actividad durante el tiempo especificado.",
    adminInactivityTimeout: "Tiempo de inactividad",
    adminLogsTitle: "Registros de actividad",
    adminLogsDesc: "Inicio/cierre de sesión de usuarios y operaciones de registros",
    btnRefresh: "Actualizar",
    adminSaveBtn: "Guardar configuración",
    adminFooterNote: "Las contraseñas se almacenan permanentemente en el servidor.",
    adminCloseBtn: "Cerrar",
    logFilterDelete: "Eliminación",
    logFilterAddUser: "Agregar usuario",
    logFilterDeleteUser: "Eliminar usuario",
    adminRefreshBtn: "Actualizar",
    manualTitle: "Manual de usuario",
    manualSubtitle: "Sistema de control de producción, consumo y residuos del comedor",
    compDataType: "Tipo de dato",
    compLastWeek: "Semana pasada",
    compThisWeek: "Esta semana",
    compLastMonth: "Mes pasado",
    compThisMonth: "Este mes",
    compLastYear: "Año pasado",
    compThisYear: "Este año",
    compDiff: "Diferencia",
    compTotalWaste: "Residuos totales (kg)",
    compTotalProduction: "Producción total",
    compTurnstilePasses: "Pasos de torniquete",
    compStudentCount: "Número de estudiantes",
    compWastePerPerson: "Residuos por persona (g)",
    monthlyCompDesc: "Comparación de este mes con el mes pasado. ↑ aumento, ↓ disminución. Una disminución (↓) en residuos y residuos por persona es buena.",
    yearlyCompDesc: "Comparación de este año (año hasta la fecha) con el mismo período del año pasado. ↑ aumento, ↓ disminución. Una disminución (↓) en residuos y residuos por persona es buena.",
    monthNames: ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"],
    haccpColDate: "Fecha",
    haccpColTime: "Hora",
    haccpColDepot: "Nombre del almacén",
    haccpColTemp: "Temperatura (°C)",
    haccpColHumidity: "Humedad (%)",
    haccpColNote: "Nota",
    haccpColAction: "Acción",
    dayNames: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"],
    menuVariety: "Variedad",
    menuVariety1: "1ª Variedad",
    menuVariety2: "2ª Variedad",
    menuVariety3: "3ª Variedad",
    menuVariety4: "4ª Variedad",
    menuVariety5: "5ª Variedad",
    menuPersonCount: "Número de personas",
    stockDeductionList: "Lista de deducción de stock",
    perPersonCost: "Costo por persona",
    total: "Total",
    inVarieties: "variedades",
    person: "pers.",
    weeklyGrandTotal: "Total semanal",
    dailyAverage: "Promedio diario",
    avgPerPerson: "Promedio por persona",
    totalPersonDays: "Total personas/días",
    colDay: "Día",
    colDate: "Fecha",
    colPerson: "Pers.",
    dailyMaterialCost: "Costo diario de materiales",
    perPerson: "Por persona",
    ingredients: "Ingredientes",
    perPersonGram: "(gramos por persona)",
    colIngredient: "Ingrediente",
    colPerPerson: "/pers.",
    colUnit: "Unidad",
    addIngredient: "+ Agregar ingrediente",
    foodName: "Nombre del plato",
    allergen: "Alérgeno",
    recipePerPerson: "Receta (por persona)",
    devices: "dispositivos",
  },
  pt: {
    loginSub: "SISTEMA DE GESTÃO DE SERVIÇOS DE NUTRIÇÃO",
    loginFormSub: "Entrar",
    loginUsername: "Usuário",
    loginSelectUser: "Selecionar usuário",
    loginPassword: "Senha",
    loginBtn: "Entrar",
    loginHint: "Você pode obter sua senha do administrador",
    loginFeature1: "Planejamento de cardápio, produção diária, consumo e resíduos",
    loginFeature2: "Relatórios detalhados",
    loginFeature3: "Painel ao vivo e gráficos",
    loginRemember: "Lembrar de mim",
    loginForgot: "Esqueceu a senha?",
    loginForgotTitle: "Senha esquecida",
    loginForgotText: "Para redefinir sua senha, entre em contato com o administrador do sistema.",
    loginForgotOk: "Fechar",
    loginSecure: "Conexão segura",
    menuLabel: "Cardápio",
    headerSubtitle: "Sistema de gestão de serviços de nutrição",
    btnLogout: "Sair",
    btnPrev: "Anterior",
    btnNext: "Próximo",
    loading: "Carregando...",
    loadingText: "Sincronizando dados...",
    loadingSub: "Verificando conexão com Supabase",
    loadingSkip: "Clique para pular",
    versionLabel: "Versão do aplicativo",
    sidebarPanel: "Painel",
    sidebarMenu: "Cardápio semanal",
    sidebarRecords: "Registros",
    sidebarReport: "Relatório",
    sidebarHaccp: "Segurança alimentar",
    sidebarCalibration: "Calibração",
    sidebarOil: "Óleo usado",
    sidebarPackaging: "Resíduos de embalagem",
    sidebarCharts: "Gráficos",
    sidebarYearly: "Comparação anual",
    sidebarSpending: "Despesas",
    sidebarUnitPrice: "Preços unitários",
    sidebarDownload: "Baixar tudo",
    sidebarBackup: "Backup no Supabase",
    sidebarRestore: "Restaurar do Supabase",
    sidebarAdmin: "Administração",
    sidebarLogs: "Registros de atividade",
    sidebarTheme: "Tema",
    sidebarManual: "Manual do usuário",
    dashboardPrintPdf: "Imprimir PDF",
    kpiTotalRecords: "Total de dias de produção",
    kpiTodayProduction: "Produção de hoje",
    kpiHaccpAlarm: "Alarme de temperatura da câmara fria",
    kpiCalibrationAlarm: "Alarme de calibração",
    kpiAvgWaste: "Resíduos médios (kg)",
    kpiTotalPasses: "Total de passagens pelo catraca",
    kpiTotalWaste: "Total de resíduos (kg)",
    kpiWasteRate: "Taxa de resíduos",
    weeklyPrevBtn: "Semana anterior",
    weeklySummary: "Resumo semanal",
    weeklyNextBtn: "Próxima semana",
    weeklyBadge: "Esta semana",
    dailyPrevBtn: "Dia anterior",
    dailySummary: "Detalhe diário",
    dailyNextBtn: "Próximo dia",
    weeklyCompTitle: "Comparação semanal",
    monthlyCompTitle: "Comparação mensal",
    monthlyBadge: "Este mês",
    yearlyBadge: "Este ano",
    anomalyTitle: "Detecção de anomalias",
    anomalyBadge: "Dias com resíduos anormais",
    lastRecordsTitle: "Últimos registros",
    dashboardGoToRecords: "Ir para registros",
    emptyDashboard: "Ainda não há registros...",
    formulaTitle: "FÓRMULA DE CÁLCULO DE RESÍDUOS",
    recordsEntryBtn: "Inserir produção/consumo",
    recordsImportBtn: "Importar",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "Baixar CSV",
    recordsDeleteBtn: "Excluir selecionados",
    emptyRecords: "Nenhum registro encontrado.",
    thDate: "Data",
    thProducedPerson: "Refeições produzidas (Pessoa)",
    thWaste10: "10% de resíduos",
    thBeneficiary: "Beneficiários do serviço de alimentação",
    thPortionGr: "Porção (g)",
    thWasteKg: "Resíduos (kg)",
    thWastedPortion: "Descartada (porção)",
    thFoodType: "Tipo de refeição",
    thAction: "Ação",
    thAcademicStaff: "Pessoal acadêmico e administrativo pela catraca",
    thStudentCount: "Estudantes pela catraca",
    thBeneficiaryTotal: "Total de beneficiários do serviço de alimentação",
    sksStaff: "Pessoal SKS de alimentação",
    summaryReport: "Relatório resumo",
    reportPdfBtn: "Abrir PDF",
    allRecordsPrint: "Todos os registros (Visão de impressão)",
    rTotalRecords: "Total de registros",
    rTotalMeals: "Total de refeições produzidas",
    rTotalWaste10: "Total de resíduos 10%",
    rTotalAfterWaste: "Total de refeições após 10% de resíduos",
    rTotalTurnstile: "Total de passagens pela catraca",
    rTotalBeneficiary: "Total de beneficiários do serviço de alimentação",
    rTotalStaff: "Total de pessoal SKS beneficiado",
    rPortionSize: "Tamanho da porção (g)",
    rTotalPortion: "Total de porções (g)",
    rWastedPortion: "Porções descartadas",
    rMaxWeeklyBeneficiary: "Máximo de beneficiários semanais",
    rTotalWasteKg: "Quantidade total de resíduos (kg)",
    rAvgWasteKg: "Quantidade média de resíduos (kg)",
    rTotalStudents: "Total de estudantes",
    rMaxWaste: "Máximo de resíduos (kg)",
    rMinWaste: "Mínimo de resíduos (kg)",
    rWasteTrend: "Tendência de resíduos (últimos 7 dias)",
    rBeneficiaryTrend: "Tendência de beneficiários (últimos 7 dias)",
    wasteByFoodTitle: "Análise de resíduos por tipo de refeição",
    wasteByFoodEmpty: "Nenhum registro com dados de tipo de refeição encontrado.",
    wasteByFoodRecords: "Nº de registros",
    wasteByFoodRate: "Taxa de resíduos",
    wasteByFoodPerPerson: "Resíduos por pessoa (kg)",
    wsProducedMeal: "Refeições produzidas (pessoa)",
    wsTotalPasses: "Total de passagens",
    wsTurnstile: "Catraca",
    wsStaffSKS: "Pessoal de nutrição",
    wsWasteAmount: "Quantidade de resíduos",
    wsWastedPortion: "Descartado",
    wsStudents: "Estudantes nutrição",
    wsNoRecordsYet: "Nenhum registro ainda",
    wsNoRecordThisWeek: "Nenhum registro esta semana",
    wsNoRecordToday: "Sem registro",
    wsTodayDetail: "Detalhe de hoje",
    wsDailyDetail: "Detalhe diário",
    wsWaste: "Perda",
    wsPortion: "porção",
    wsProduced: "Produzido",
    wsTurnstileCount: "Passagens catraca",
    wsStaffCount: "Pessoal",
    menuTitle: "Cardápio semanal",
    menuStatusBadge: "Estado",
    menuSaveBtn: "Salvar",
    menuSendBtn: "Enviar para aprovação",
    menuApproveBtn: "Aprovar",
    menuRejectBtn: "Rejeitar",
    menuWithdrawBtn: "Retirar aprovação",
    menuClearBtn: "Limpar tabela",
    menuPrintBtn: "Imprimir",
    menuFoodListBtn: "Lista de refeições",
    menuFoodListUploadBtn: "Carregar CSV",
    menuFoodListCsvBtn: "Baixar CSV",
    menuWarningPrefix: "Cardápio não aprovado:",
    menuWarningText: "O cardápio desta semana ainda não foi aprovado pelo engenheiro de alimentos.",
    menuHintText: "Digite os nomes das refeições...",
    productNeedsTitle: "Lista de necessidades de produtos",
    weeklyNeedsTitle: "Lista semanal total de necessidades",
    foodListTitle: "Lista de refeições",
    modalRejectMenu: "Rejeitar cardápio",
    modalRejectDesc: "O motivo da rejeição é obrigatório.",
    menuRejectConfirm: "Rejeitar",
    haccpTitle: "Gestão de segurança alimentar",
    haccpCsvBtn: "Baixar CSV",
    haccpColdStorage: "Registros de temperatura da câmara fria",
    haccpNewBtn: "Novo registro",
    haccpDepotBtn: "Nomes dos depósitos",
    haccpDepoQrNote: "Você pode editar os nomes dos depósitos e gerar códigos QR para cada depósito com o botão QR.",
    haccpModalTitle: "Novo registro",
    filterDepot: "Filtro de depósito:",
    filterAll: "Todos",
    filterDateRange: "Intervalo de datas:",
    emptyHaccp: "Ainda não há registros de temperatura.",
    btnDeleteSelectedHaccp: "Excluir selecionados",
    btnPdf: "PDF",
    depoNamesTitle: "Nomes dos depósitos",
    oilNewBtn: "Novo registro",
    oilListBtn: "Lista",
    oilFilterTitle: "Filtros de óleo usado",
    filterOilType: "Tipo de óleo:",
    btnReset: "Redefinir",
    oilSummaryTitle: "Resumo do óleo usado",
    oilChartTitle: "Gráficos do óleo usado",
    oilChartSubtitle: "Quantidade mensal de óleo usado (litros)",
    oilChartEmpty: "Os gráficos aparecerão quando registros de óleo usado forem inseridos",
    oilChartNote: "Totais mensais de óleo usado por data, tipo de óleo e filtros de ano",
    oilRecordsTitle: "Registros de óleo usado",
    oilModalTitle: "Registro de óleo usado",
    emptyOil: "Ainda não há registros de óleo usado.",
    ambalajNewBtn: "Novo registro",
    ambalajListBtn: "Lista",
    packagingFilterTitle: "Filtros de resíduos de embalagem",
    filterWasteType: "Tipo de resíduo:",
    packagingSummaryTitle: "Resumo de resíduos de embalagem",
    packagingChartTitle: "Gráficos de resíduos de embalagem",
    packagingChartSubtitle: "Quantidade mensal de resíduos de embalagem (kg)",
    packagingChartEmpty: "Os gráficos aparecerão quando registros de resíduos de embalagem forem inseridos",
    packagingChartNote: "Totais mensais de resíduos de embalagem por data, tipo de resíduo e filtros de ano (kg)",
    packagingRecordsTitle: "Registros de resíduos de embalagem",
    packagingModalTitle: "Registro de resíduos de embalagem",
    emptyPackaging: "Ainda não há registros de resíduos de embalagem.",
    kalibrasyonNewBtn: "Novo dispositivo",
    kalibrasyonListBtn: "Lista",
    kalibrasyonCsvBtn: "Baixar CSV",
    calibrationSummary: "Resumo da calibração",
    calibrationDevices: "Dispositivos sujeitos a calibração",
    calibrationModalTitle: "Dispositivo para calibração",
    filterStatus: "Estado:",
    filterDepartment: "Departamento:",
    btnWordExport: "Exportar para Word",
    btnPrint: "Imprimir PDF",
    chartProdWaste: "Comparação Produção - Passagens - Resíduos",
    chartEmpty: "Os gráficos aparecerão quando dados forem inseridos",
    chartProdWasteNote: "Comparação mensal de produção, passagens pela catraca e porções descartadas",
    chartStudentCount: "Número de estudantes que usam o serviço de alimentação",
    yearTotal: "Total anual",
    chartStudentNote: "Total mensal de passagens diárias de estudantes",
    chartStaffTotal: "Pessoal acadêmico e administrativo + SKS",
    chartStaffNote: "Total do pessoal acadêmico e administrativo (Catraca - Estudantes) e do pessoal SKS de alimentação",
    chartMonthlyProd: "Produção mensal de refeições",
    chartMonthlyProdNote: "Total mensal do número diário de refeições produzidas",
    chartMonthlyTurnstile: "Passagens mensais pela catraca",
    chartTurnstileNote: "Estudantes + pessoal + passagens externas",
    chartMonthlyWaste: "Quantidade mensal de resíduos (kg)",
    chartMonthlyWasteNote: "Total mensal de resíduos diários (kg)",
    chartMonthlyWastePortion: "Quantidade mensal de resíduos (porções)",
    chartWastePortionNote: "Total mensal de porções descartadas diariamente",
    chartDiff: "Diferença entre produção e passagens",
    chartDiffNote: "Diferença entre refeições produzidas e passagens pela catraca",
    chartWasteRatio: "Resíduos % das refeições produzidas",
    yearAverage: "Média anual",
    chartWasteRatioNote: "Percentual das refeições produzidas que se tornam resíduos",
    chartWastePerPerson: "Resíduos por pessoa (kg/pessoa)",
    chartWastePerPersonNote: "Resíduos médios por pessoa que entra no refeitório",
    chartMonthlyTemp: "Temperaturas médias mensais dos depósitos (°C)",
    chartTempEmpty: "Os gráficos aparecerão quando registros de temperatura forem inseridos",
    chartTempNote: "Temperatura média mensal de cada depósito",
    yearlyPdfBtn: "Imprimir PDF",
    yearlyTotalProd: "Comparação da produção total",
    yearlyTotalProdNote: "Total anual - Ano 1 vs Ano 2 (porções)",
    yearlyTotalBen: "Total de beneficiários do serviço de alimentação",
    yearlyTotalBenNote: "Total anual - Ano 1 vs Ano 2 (total de pessoas)",
    yearlyStudentComp: "Comparação de estudantes beneficiários",
    yearlyStudentNote: "Total anual - Ano 1 vs Ano 2 (estudantes)",
    yearlyWasteComp: "Comparação de resíduos (kg)",
    yearlyWasteNote: "Total anual - Ano 1 vs Ano 2 (kg)",
    yearlyMonthlyProd: "Comparação mensal da produção",
    yearlyMonthlyProdNote: "Ano 1 vs Ano 2 - refeições produzidas (porções)",
    yearlyMonthlyTurnstile: "Comparação mensal de passagens pela catraca",
    yearlyMonthlyTurnstileNote: "Ano 1 vs Ano 2 - quantidade de passagens pela catraca",
    yearlyMonthlyStudent: "Comparação mensal de passagens de estudantes",
    yearlyMonthlyStudentNote: "Ano 1 vs Ano 2 - quantidade de passagens de estudantes",
    yearlyMonthlyWaste: "Comparação mensal de resíduos (kg)",
    yearlyMonthlyWasteNote: "Ano 1 vs Ano 2 - quantidade de resíduos (kg)",
    yearlyWasteListTitle: "Lista anual de resíduos",
    spendingRatesTitle: "Taxas de despesa por pessoa (Estudantes, Pessoal e Refeições)",
    spendingStudentRate: "Valor de despesa por estudante (TL)",
    btnSaveStudentRate: "Salvar valor estudantes",
    spendingStaffRate: "Valor de despesa por membro do pessoal (TL)",
    btnSaveStaffRate: "Salvar valor pessoal",
    spendingMealRate: "Valor de despesa por refeição (TL)",
    btnSaveMealRate: "Salvar valor refeições",
    spendingDesc: "Despesa de estudantes = Nº estudantes × Valor por estudante",
    spendingStudentTitle: "Despesa de estudantes (TL)",
    spendingChartEmpty: "Os gráficos aparecerão quando registros forem inseridos",
    spendingStudentNote: "Despesa de estudantes (TL) = Nº estudantes × Valor por estudante",
    spendingStaffTitle: "Despesa do pessoal (TL)",
    spendingStaffNote: "Despesa do pessoal (TL) = Nº pessoal × Valor por membro do pessoal",
    spendingMealTitle: "Despesa de refeições (TL)",
    spendingMealNote: "Despesa de refeições (TL) = Refeições produzidas × Valor por refeição",
    spendingTableTitle: "Tabela de cálculo de despesas",
    syncTitle: "Sincronização Supabase",
    syncCloseBtn: "Fechar",
    modalNewRecord: "Adicionar novo registro",
    formDate: "Data",
    formProducedCount: "Número de refeições produzidas",
    formTurnstileCount: "Número de passagens pela catraca",
    formStudentCount: "Número de estudantes",
    formFoodType: "Tipo de refeição",
    formAutoCalc: "Cálculos automáticos",
    badgeAutomatic: "Automático",
    badgeFixed: "Fixo",
    badgeAutoEditable: "Automático + Editável",
    btnCancel: "Cancelar",
    entryFormSubmit: "Salvar",
    formReceiptNo: "Nº de recibo",
    formOilType: "Tipo de óleo",
    formAmountLt: "Quantidade (litros)",
    formNote: "Nota",
    formWasteType: "Tipo de resíduo",
    formAmount: "Quantidade",
    formDeviceName: "Nome do dispositivo",
    formBrandModel: "Marca-Modelo",
    formSerialNo: "Número de série",
    formStatus: "Estado",
    formVerification: "Verificação",
    formLastCalibration: "Última calibração",
    formNextCalibration: "Próxima calibração",
    formLocation: "Localização/Departamento",
    formResponsible: "Pessoa responsável",
    btnSave: "Salvar",
    btnAdd: "Adicionar",
    btnClose: "Fechar",
    qrTitle: "Código QR",
    qrHint: "Imprima o código QR para pendurar nas portas dos depósitos.",
    adminTitle: "Painel de administração",
    adminReAuthText: "Por favor, insira sua senha de administrador para acessar o painel.",
    adminPassword: "Senha de administrador",
    btnVerify: "Verificar",
    adminSessionRole: "Função da sessão",
    adminLastLogin: "Último login",
    adminAuthMethod: "Método de autenticação",
    adminStorage: "Armazenamento de senhas",
    adminDataSource: "Fonte de dados",
    adminUserMgmt: "Gestão de usuários",
    adminUserMgmtDesc: "Adicione, edite ou exclua usuários.",
    adminAddUser: "Adicionar novo usuário",
    adminUsername: "Nome de usuário",
    adminDisplayName: "Nome exibido",
    adminPasswordLabel: "Senha",
    adminRole: "Função",
    adminAddUserBtn: "Adicionar usuário",
    adminRolePerms: "Configurações de permissões por função",
    adminRolePermsDesc: "Configure quais abas cada função pode visualizar.",
    adminSecurity: "Segurança da sessão",
    adminSecurityDesc: "A sessão será encerrada se não houver atividade durante o período especificado.",
    adminInactivityTimeout: "Tempo limite de inatividade",
    adminLogsTitle: "Registros de atividade",
    adminLogsDesc: "Login/logout de usuários e operações de registros",
    btnRefresh: "Atualizar",
    adminSaveBtn: "Salvar configurações",
    adminFooterNote: "As senhas são armazenadas permanentemente no servidor.",
    adminCloseBtn: "Fechar",
    logFilterDelete: "Exclusão",
    logFilterAddUser: "Adicionar usuário",
    logFilterDeleteUser: "Excluir usuário",
    adminRefreshBtn: "Atualizar",
    manualTitle: "Manual do usuário",
    manualSubtitle: "Sistema de controle de produção, consumo e resíduos do refeitório",
    compDataType: "Tipo de dado",
    compLastWeek: "Semana passada",
    compThisWeek: "Esta semana",
    compLastMonth: "Mês passado",
    compThisMonth: "Este mês",
    compLastYear: "Ano passado",
    compThisYear: "Este ano",
    compDiff: "Diferença",
    compTotalWaste: "Resíduos totais (kg)",
    compTotalProduction: "Produção total",
    compTurnstilePasses: "Passagens catraca",
    compStudentCount: "Número de estudantes",
    compWastePerPerson: "Resíduos por pessoa (g)",
    monthlyCompDesc: "Comparação deste mês com o mês passado. ↑ aumento, ↓ diminuição. Uma diminuição (↓) nos resíduos e resíduos por pessoa é boa.",
    yearlyCompDesc: "Comparação deste ano (ano até o momento) com o mesmo período do ano passado. ↑ aumento, ↓ diminuição. Uma diminuição (↓) nos resíduos e resíduos por pessoa é boa.",
    monthNames: ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"],
    haccpColDate: "Data",
    haccpColTime: "Hora",
    haccpColDepot: "Nome do depósito",
    haccpColTemp: "Temperatura (°C)",
    haccpColHumidity: "Umidade (%)",
    haccpColNote: "Nota",
    haccpColAction: "Ação",
    dayNames: ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"],
    menuVariety: "Variedade",
    menuVariety1: "1ª Variedade",
    menuVariety2: "2ª Variedade",
    menuVariety3: "3ª Variedade",
    menuVariety4: "4ª Variedade",
    menuVariety5: "5ª Variedade",
    menuPersonCount: "Número de pessoas",
    stockDeductionList: "Lista de dedução de estoque",
    perPersonCost: "Custo por pessoa",
    total: "Total",
    inVarieties: "variedades",
    person: "pessoa",
    weeklyGrandTotal: "Total semanal",
    dailyAverage: "Média diária",
    avgPerPerson: "Média por pessoa",
    totalPersonDays: "Total pessoas/dias",
    colDay: "Dia",
    colDate: "Data",
    colPerson: "Pessoa",
    dailyMaterialCost: "Custo diário de materiais",
    perPerson: "Por pessoa",
    ingredients: "Ingredientes",
    perPersonGram: "(gramas por pessoa)",
    colIngredient: "Ingrediente",
    colPerPerson: "/pessoa",
    colUnit: "Unidade",
    addIngredient: "+ Adicionar ingrediente",
    foodName: "Nome do prato",
    allergen: "Alérgeno",
    recipePerPerson: "Receita (por pessoa)",
    devices: "dispositivos",
  },
  uz: {
    loginSub: "OVQATLANTIRISH XIZMATLARINI BOSHQARISH TIZIMI",
    loginFormSub: "Kirish",
    loginUsername: "Foydalanuvchi",
    loginSelectUser: "Foydalanuvchini tanlang",
    loginPassword: "Parol",
    loginBtn: "Kirish",
    loginHint: "Parolingizni administratoringizdan olishingiz mumkin",
    loginFeature1: "Menyu rejalashtirish, kunlik ishlab chiqarish, iste'mol va chiqindilarni kuzatish",
    loginFeature2: "Batafsil hisobotlar",
    loginFeature3: "Jonli panel va grafiklar",
    loginRemember: "Meni eslab qol",
    loginForgot: "Parolni unutdingizmi?",
    loginForgotTitle: "Parolni unutdingiz",
    loginForgotText: "Parolni tiklash uchun tizim administratoringiz bilan bog'laning.",
    loginForgotOk: "Yopish",
    loginSecure: "Xavfsiz ulanish",
    menuLabel: "Menyu",
    headerSubtitle: "Ovqatlantirish xizmatlarini boshqarish tizimi",
    btnLogout: "Chiqish",
    btnPrev: "Oldingi",
    btnNext: "Keyingi",
    loading: "Yuklanmoqda...",
    loadingText: "Ma'lumotlar sinxronlashtirilmoqda...",
    loadingSub: "Supabase ulanishi tekshirilmoqda",
    loadingSkip: "O'tish uchun bosing",
    versionLabel: "Ilova versiyasi",
    sidebarPanel: "Panel",
    sidebarMenu: "Haftalik menyu",
    sidebarRecords: "Yozuvlar",
    sidebarReport: "Hisobot",
    sidebarHaccp: "Oziq-ovqat xavfsizligi",
    sidebarCalibration: "Kalibrlash",
    sidebarOil: "Chiqindilangan moy",
    sidebarPackaging: "Qadoqlash chiqindilari",
    sidebarCharts: "Grafiklar",
    sidebarYearly: "Yillik taqqoslash",
    sidebarSpending: "Xarajatlar",
    sidebarUnitPrice: "Birlik narxlari",
    sidebarDownload: "Hammasini yuklab olish",
    sidebarBackup: "Supabase ga zaxiralash",
    sidebarRestore: "Supabase dan tiklash",
    sidebarAdmin: "Boshqaruv",
    sidebarLogs: "Jurnal yozuvlari",
    sidebarTheme: "Mavzu",
    sidebarManual: "Foydalanuvchi qo'llanmasi",
    dashboardPrintPdf: "PDF chop etish",
    kpiTotalRecords: "Jami ishlab chiqarish kunlari",
    kpiTodayProduction: "Bugungi ishlab chiqarish",
    kpiHaccpAlarm: "Sovutgich harorati signalizatsiyasi",
    kpiCalibrationAlarm: "Kalibrlash signalizatsiyasi",
    kpiAvgWaste: "O'rt. chiqindi (kg)",
    kpiTotalPasses: "Shlagbirdan jami o'tish",
    kpiTotalWaste: "Jami chiqindi (kg)",
    kpiWasteRate: "Chiqindi foizi",
    weeklyPrevBtn: "Oldingi hafta",
    weeklySummary: "Haftalik xulosa",
    weeklyNextBtn: "Keyingi hafta",
    weeklyBadge: "Bu hafta",
    dailyPrevBtn: "Oldingi kun",
    dailySummary: "Kunlik tafsilot",
    dailyNextBtn: "Keyingi kun",
    weeklyCompTitle: "Haftalik taqqoslash",
    monthlyCompTitle: "Oylik taqqoslash",
    monthlyBadge: "Bu oy",
    yearlyBadge: "Bu yil",
    anomalyTitle: "Anomaliya aniqlash",
    anomalyBadge: "Nodud chiqindi kunlari",
    lastRecordsTitle: "Oxirgi yozuvlar",
    dashboardGoToRecords: "Yozuvlarga o'tish",
    emptyDashboard: "Hali yozuvlar yo'q...",
    formulaTitle: "CHIQINDI HISOBOSH FORMULASI",
    recordsEntryBtn: "Ishlab chiqarish iste'mol kiritish",
    recordsImportBtn: "Import",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "CSV yuklab olish",
    recordsDeleteBtn: "Tanlanganlarni o'chirish",
    emptyRecords: "Yozuvlar topilmadi.",
    thDate: "Sana",
    thProducedPerson: "Ishlab chiqarilgan ovqat (Shaxs)",
    thWaste10: "10% chiqindi",
    thBeneficiary: "Ovqatlanish xizmati foydalanuvchilari",
    thPortionGr: "Porsiya (g)",
    thWasteKg: "Chiqindi (kg)",
    thWastedPortion: "Tashlab yuborilgan (porsiya)",
    thFoodType: "Ovqat turi",
    thAction: "Amal",
    thAcademicStaff: "Shlagbirdan o'tgan akademik va ma'muriy xodimlar",
    thStudentCount: "Shlagbirdan o'tgan talabalar soni",
    thBeneficiaryTotal: "Ovqatlanish xizmati jami foydalanuvchilari",
    sksStaff: "SKS ovqatlanish xizmati xodimlari",
    summaryReport: "Xulosa hisoboti",
    reportPdfBtn: "PDF ochish",
    allRecordsPrint: "Barcha yozuvlar (Chop ko'rinishi)",
    rTotalRecords: "Jami yozuvlar soni",
    rTotalMeals: "Jami ishlab chiqarilgan ovqat",
    rTotalWaste10: "Jami 10% chiqindi",
    rTotalAfterWaste: "Jami 10% chiqindidan keyingi ovqat",
    rTotalTurnstile: "Jami shlagbirdan o'tish",
    rTotalBeneficiary: "Ovqatlanish xizmati jami foydalanuvchilari",
    rTotalStaff: "Jami SKS xodimlari foydalangan",
    rPortionSize: "Porsiya hajmi (g)",
    rTotalPortion: "Jami porsiya (g)",
    rWastedPortion: "Tashlab yuborilgan porsiya",
    rMaxWeeklyBeneficiary: "Eng yuqori haftalik foydalanuvchilar",
    rTotalWasteKg: "Jami chiqindi miqdori (kg)",
    rAvgWasteKg: "O'rt. chiqindi miqdori (kg)",
    rTotalStudents: "Jami talabalar soni",
    rMaxWaste: "Eng yuqori chiqindi (kg)",
    rMinWaste: "Eng past chiqindi (kg)",
    rWasteTrend: "Chiqindi trendi (oxirgi 7 kun)",
    rBeneficiaryTrend: "Foydalanuvchilar trendi (oxirgi 7 kun)",
    wasteByFoodTitle: "Ovqat turi bo'yicha chiqindi tahlili",
    wasteByFoodEmpty: "Ovqat turi ma'lumotlari kiritilgan yozuvlar topilmadi.",
    wasteByFoodRecords: "Yozuvlar soni",
    wasteByFoodRate: "Chiqindi foizi",
    wasteByFoodPerPerson: "Shaxs boshiga chiqindi (kg)",
    wsProducedMeal: "Tayyorlangan ovqat (kishi)",
    wsTotalPasses: "Jami o'tish",
    wsTurnstile: "Turniket",
    wsStaffSKS: "Ovqatlanish xodimi",
    wsWasteAmount: "Chiqindi miqdori",
    wsWastedPortion: "Chiqindiga",
    wsStudents: "Ovqatlanish talab.",
    wsNoRecordsYet: "Hali yozuv yo'q",
    wsNoRecordThisWeek: "Shu haftada yozuv yo'q",
    wsNoRecordToday: "Yozuv yo'q",
    wsTodayDetail: "Bugunning tafsilotlari",
    wsDailyDetail: "Kunlik tafsilotlar",
    wsWaste: "Yo'qotish",
    wsPortion: "porsiya",
    wsProduced: "Ishlab chiqarilgan",
    wsTurnstileCount: "Turniket o'tishlari",
    wsStaffCount: "Xodimlar",
    menuTitle: "Haftalik menyu ro'yxati",
    menuStatusBadge: "Holat",
    menuSaveBtn: "Saqlash",
    menuSendBtn: "Tasdiqqa yuborish",
    menuApproveBtn: "Tasdiqlash",
    menuRejectBtn: "Rad etish",
    menuWithdrawBtn: "Tasdiqni bekor qilish",
    menuClearBtn: "Jadvalni tozalash",
    menuPrintBtn: "Chop etish",
    menuFoodListBtn: "Ovqat ro'yxati",
    menuFoodListUploadBtn: "CSV yuklash",
    menuFoodListCsvBtn: "CSV yuklab olish",
    menuWarningPrefix: "Tasdiqlanmagan menyu:",
    menuWarningText: "Bu hafta menyusi hali oziq-ovqat muhandisi tomonidan tasdiqlanmagan.",
    menuHintText: "Ovqat nomlarini kiriting...",
    productNeedsTitle: "Mahsulot ehtiyojlar ro'yxati",
    weeklyNeedsTitle: "Haftalik umumiy ehtiyojlar ro'yxati",
    foodListTitle: "Ovqat ro'yxati",
    modalRejectMenu: "Menyuni rad etish",
    modalRejectDesc: "Rad etish sababi majburiy.",
    menuRejectConfirm: "Rad etish",
    haccpTitle: "Oziq-ovqat xavfsizligini boshqarish",
    haccpCsvBtn: "CSV yuklab olish",
    haccpColdStorage: "Sovutgich harorati yozuvlari",
    haccpNewBtn: "Yangi yozuv",
    haccpDepotBtn: "Ombor nomlari",
    haccpDepoQrNote: "Ombor nomlarini tahrirlab, QR tugmasi bilan har bir ombor uchun QR kod yaratishingiz mumkin.",
    haccpModalTitle: "Yangi yozuv",
    filterDepot: "Ombor filtri:",
    filterAll: "Barchasi",
    filterDateRange: "Sana oralig'i:",
    emptyHaccp: "Hali harorat yozuvlari kiritilmagan.",
    btnDeleteSelectedHaccp: "Tanlanganlarni o'chirish",
    btnPdf: "PDF",
    depoNamesTitle: "Ombor nomlari",
    oilNewBtn: "Yangi yozuv",
    oilListBtn: "Ro'yxat",
    oilFilterTitle: "Chiqindi moy filtrlari",
    filterOilType: "Moy turi:",
    btnReset: "Qayta o'rnatish",
    oilSummaryTitle: "Chiqindi moy xulosasi",
    oilChartTitle: "Chiqindi moy grafikalari",
    oilChartSubtitle: "Oylik chiqindi moy miqdori (litr)",
    oilChartEmpty: "Chiqindi moy yozuvlari kiritilganda grafikalar ko'rsatiladi",
    oilChartNote: "Sana, moy turi va yil filtrlariga ko'ra oylik chiqindi moy umumiy miqdorlari",
    oilRecordsTitle: "Chiqindi moy yozuvlari",
    oilModalTitle: "Chiqindi moy yozuvi",
    emptyOil: "Hali chiqindi moy yozuvlari kiritilmagan.",
    ambalajNewBtn: "Yangi yozuv",
    ambalajListBtn: "Ro'yxat",
    packagingFilterTitle: "Qadoqlash chiqindilari filtrlari",
    filterWasteType: "Chiqindi turi:",
    packagingSummaryTitle: "Qadoqlash chiqindilari xulosasi",
    packagingChartTitle: "Qadoqlash chiqindilari grafikalari",
    packagingChartSubtitle: "Oylik qadoqlash chiqindilari miqdori (kg)",
    packagingChartEmpty: "Qadoqlash chiqindilari yozuvlari kiritilganda grafikalar ko'rsatiladi",
    packagingChartNote: "Sana, chiqindi turi va yil filtrlariga ko'ra oylik qadoqlash chiqindilari umumiy miqdorlari (kg)",
    packagingRecordsTitle: "Qadoqlash chiqindilari yozuvlari",
    packagingModalTitle: "Qadoqlash chiqindilari yozuvi",
    emptyPackaging: "Hali qadoqlash chiqindilari yozuvlari kiritilmagan.",
    kalibrasyonNewBtn: "Yangi qurilma",
    kalibrasyonListBtn: "Ro'yxat",
    kalibrasyonCsvBtn: "CSV yuklab olish",
    calibrationSummary: "Kalibrlash xulosasi",
    calibrationDevices: "Kalibrlashga bo'ysundirilgan qurilmalar",
    calibrationModalTitle: "Kalibrlash uchun qurilma",
    filterStatus: "Holat:",
    filterDepartment: "Bo'lim:",
    btnWordExport: "Word ga eksport",
    btnPrint: "PDF chop etish",
    chartProdWaste: "Ishlab chiqarish - O'tish - Chiqindi taqqoslash",
    chartEmpty: "Ma'lumot kiritilganda grafikalar ko'rsatiladi",
    chartProdWasteNote: "Ishlab chiqarish, shlagbirdan o'tish va tashlab yuborilgan porsiyalarning oylik taqqoslash",
    chartStudentCount: "Ovqatlanish xizmatlaridan foydalanuvchi talabalar soni",
    yearTotal: "Yil umumiy",
    chartStudentNote: "Kunlik talaba o'tishlarining oylik umumiy miqdori",
    chartStaffTotal: "Akademik va ma'muriy + SKS xodimlari umumiy",
    chartStaffNote: "Akademik va ma'muriy (Shlagbirdan - Talabalar) va SKS ovqatlanish xizmati xodimlari umumiy miqdori",
    chartMonthlyProd: "Oylik ovqat ishlab chiqarish",
    chartMonthlyProdNote: "Kunlik ishlab chiqarilgan ovqat sonlarining oylik umumiy miqdori",
    chartMonthlyTurnstile: "Oylik shlagbirdan o'tish sonlari",
    chartTurnstileNote: "Talabalar + xodimlar + tashqi o'tishlar umumiy",
    chartMonthlyWaste: "Oylik chiqindi miqdori (kg)",
    chartMonthlyWasteNote: "Kunlik chiqindilarning oylik umumiy miqdori (kg)",
    chartMonthlyWastePortion: "Oylik chiqindi miqdori (porsiya)",
    chartWastePortionNote: "Kunlik tashlab yuborilgan porsiyalarning oylik umumiy miqdori",
    chartDiff: "Ishlab chiqarish va o'tish orasidagi farq",
    chartDiffNote: "Ishlab chiqarilgan ovqat soni va shlagbirdan o'tish soni orasidagi farq",
    chartWasteRatio: "Ishlab chiqarilgan ovqatga nisbatan chiqindi %",
    yearAverage: "Yil o'rtachasi",
    chartWasteRatioNote: "Ishlab chiqarilgan ovqatning necha foizi chiqindi bo'ladi",
    chartWastePerPerson: "Shaxs boshiga chiqindi (kg/shaxs)",
    chartWastePerPersonNote: "Oshxonasiga kirgan shaxs boshiga o'rtacha chiqindi",
    chartMonthlyTemp: "Oylik o'rtacha ombor haroratlari (°C)",
    chartTempEmpty: "Harorat yozuvlari kiritilganda grafikalar ko'rsatiladi",
    chartTempNote: "Har bir omborning oylik o'rtacha harorati",
    yearlyPdfBtn: "PDF chop etish",
    yearlyTotalProd: "Jami ishlab chiqarish taqqoslash",
    yearlyTotalProdNote: "Yil umumiy - 1-yil vs 2-yil (porsiya)",
    yearlyTotalBen: "Ovqatlanish xizmati jami foydalanuvchilari",
    yearlyTotalBenNote: "Yil umumiy - 1-yil vs 2-yil (jami shaxslar)",
    yearlyStudentComp: "Ovqatlanish xizmatidan foydalanuvchi talabalar taqqoslash",
    yearlyStudentNote: "Yil umumiy - 1-yil vs 2-yil (talabalar)",
    yearlyWasteComp: "Chiqindi taqqoslash (kg)",
    yearlyWasteNote: "Yil umumiy - 1-yil vs 2-yil (kg)",
    yearlyMonthlyProd: "Oylik ishlab chiqarish taqqoslash",
    yearlyMonthlyProdNote: "1-yil vs 2-yil - ishlab chiqarilgan ovqat soni (porsiya)",
    yearlyMonthlyTurnstile: "Oylik shlagbirdan o'tish taqqoslash",
    yearlyMonthlyTurnstileNote: "1-yil vs 2-yil - shlagbirdan o'tish soni",
    yearlyMonthlyStudent: "Oylik talaba shlagbirdan o'tish taqqoslash",
    yearlyMonthlyStudentNote: "1-yil vs 2-yil - talaba shlagbirdan o'tish soni",
    yearlyMonthlyWaste: "Oylik chiqindi taqqoslash (kg)",
    yearlyMonthlyWasteNote: "1-yil vs 2-yil - chiqindi miqdori (kg)",
    yearlyWasteListTitle: "Yillik chiqindi ro'yxati",
    spendingRatesTitle: "Shaxs boshiga xarajat stavkalari (Talabalar, xodimlar va ovqatlar)",
    spendingStudentRate: "Talaba boshiga xarajat miqdori (TL)",
    btnSaveStudentRate: "Talaba miqdorini saqlash",
    spendingStaffRate: "Xodim boshiga xarajat miqdori (TL)",
    btnSaveStaffRate: "Xodim miqdorini saqlash",
    spendingMealRate: "Ovqat boshiga xarajat miqdori (TL)",
    btnSaveMealRate: "Ovqat miqdorini saqlash",
    spendingDesc: "Talaba xarajati = Talabalar soni × Talaba boshiga miqdor",
    spendingStudentTitle: "Talaba xarajat miqdori (TL)",
    spendingChartEmpty: "Yozuvlar kiritilganda grafikalar ko'rsatiladi",
    spendingStudentNote: "Talaba xarajati (TL) = Talabalar soni × Talaba boshiga xarajat miqdori",
    spendingStaffTitle: "Xodim xarajat miqdori (TL)",
    spendingStaffNote: "Xodim xarajati (TL) = Xodimlar soni × Xodim boshiga xarajat miqdori",
    spendingMealTitle: "Ovqat xarajat miqdori (TL)",
    spendingMealNote: "Ovqat xarajati (TL) = Ishlab chiqarilgan ovqat soni × Ovqat boshiga xarajat miqdori",
    spendingTableTitle: "Xarajat hisoblash jadvali",
    syncTitle: "Supabase sinxronizatsiyasi",
    syncCloseBtn: "Yopish",
    modalNewRecord: "Yangi yozuv qo'shish",
    formDate: "Sana",
    formProducedCount: "Ishlab chiqarilgan ovqat soni",
    formTurnstileCount: "Shlagbirdan o'tish soni",
    formStudentCount: "Talabalar soni",
    formFoodType: "Ovqat turi",
    formAutoCalc: "Avtomatik hisoblashlar",
    badgeAutomatic: "Avtomatik",
    badgeFixed: "Belgilangan",
    badgeAutoEditable: "Avtomatik + Tahrirlash mumkin",
    btnCancel: "Bekor qilish",
    entryFormSubmit: "Saqlash",
    formReceiptNo: "Kvitansiya raqami",
    formOilType: "Moy turi",
    formAmountLt: "Miqdor (litr)",
    formNote: "Eslatma",
    formWasteType: "Chiqindi turi",
    formAmount: "Miqdor",
    formDeviceName: "Qurilma nomi",
    formBrandModel: "Brend-model",
    formSerialNo: "Seriya raqami",
    formStatus: "Holat",
    formVerification: "Tekshirish",
    formLastCalibration: "Oxirgi kalibrlash",
    formNextCalibration: "Keyingi kalibrlash",
    formLocation: "Joy/Bolim",
    formResponsible: "Mas'ul shaxs",
    btnSave: "Saqlash",
    btnAdd: "Qo'shish",
    btnClose: "Yopish",
    qrTitle: "QR kod",
    qrHint: "QR kodni ombor eshiklariga osish uchun chop eting.",
    adminTitle: "Boshqaruv paneli",
    adminReAuthText: "Boshqaruv paneliga kirish uchun admin parolni kiriting.",
    adminPassword: "Admin paroli",
    btnVerify: "Tekshirish",
    adminSessionRole: "Sessiya roli",
    adminLastLogin: "Oxirgi kirish",
    adminAuthMethod: "Avtorizatsiya usuli",
    adminStorage: "Parol saqlash",
    adminDataSource: "Ma'lumot manbai",
    adminUserMgmt: "Foydalanuvchilarni boshqarish",
    adminUserMgmtDesc: "Foydalanuvchilarni qo'shing, tahrirlang yoki o'chiring.",
    adminAddUser: "Yangi foydalanuvchi qo'shish",
    adminUsername: "Foydalanuvchi nomi",
    adminDisplayName: "Ko'rsatiladigan nom",
    adminPasswordLabel: "Parol",
    adminRole: "Rol",
    adminAddUserBtn: "Foydalanuvchi qo'shish",
    adminRolePerms: "Rolga asoslangan ruxsat sozlamalari",
    adminRolePermsDesc: "Har bir rol qaysi tablarni ko'rishi mumkinligini sozlang.",
    adminSecurity: "Sessiya xavfsizligi",
    adminSecurityDesc: "Belgilangan vaqt davomida hech qanday faoliyat bo'lmasa, sessiya yopiladi.",
    adminInactivityTimeout: "Faolsizlik vaqti",
    adminLogsTitle: "Faoliyat jurnal yozuvlari",
    adminLogsDesc: "Foydalanuvchi kirish/chiqish va yozuv operatsiyalari",
    btnRefresh: "Yangilash",
    adminSaveBtn: "Sozlamalarni saqlash",
    adminFooterNote: "Parollar serverda doimiy saqlanadi.",
    adminCloseBtn: "Yopish",
    logFilterDelete: "O'chirish",
    logFilterAddUser: "Foydalanuvchi qo'shish",
    logFilterDeleteUser: "Foydalanuvchi o'chirish",
    adminRefreshBtn: "Yangilash",
    manualTitle: "Foydalanuvchi qo'llanmasi",
    manualSubtitle: "Oshxona ishlab chiqarish, iste'mol va chiqindi nazorat tizimi",
    compDataType: "Ma'lumot turi",
    compLastWeek: "O'tgan hafta",
    compThisWeek: "Bu hafta",
    compLastMonth: "O'tgan oy",
    compThisMonth: "Bu oy",
    compLastYear: "O'tgan yil",
    compThisYear: "Bu yil",
    compDiff: "Farq",
    compTotalWaste: "Jami chiqindi (kg)",
    compTotalProduction: "Jami ishlab chiqarish",
    compTurnstilePasses: "Turniket o'tishlari",
    compStudentCount: "Talabalar soni",
    compWastePerPerson: "Kishi boshiga chiqindi (gr)",
    monthlyCompDesc: "Joriy oy o'tgan oy bilan solishtirilmoqda. ↑ o'sish, ↓ kamayish. Chiqindi va kishi boshiga chiqindining kamayishi (↓) yaxshi.",
    yearlyCompDesc: "Joriy yil (yil boshidan bugunga) o'tgan yilning shu davri bilan solishtirilmoqda. ↑ o'sish, ↓ kamayish. Chiqindi va kishi boshiga chiqindining kamayishi (↓) yaxshi.",
    monthNames: ["Yanvar","Fevral","Mart","Aprel","May","Iyun","Iyul","Avgust","Sentabr","Oktabr","Noyabr","Dekabr"],
    haccpColDate: "Sana",
    haccpColTime: "Vaqt",
    haccpColDepot: "Ombor nomi",
    haccpColTemp: "Harorat (°C)",
    haccpColHumidity: "Namlik (%)",
    haccpColNote: "Eslatma",
    haccpColAction: "Amal",
    dayNames: ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma"],
    menuVariety: "Turi",
    menuVariety1: "1-tur",
    menuVariety2: "2-tur",
    menuVariety3: "3-tur",
    menuVariety4: "4-tur",
    menuVariety5: "5-tur",
    menuPersonCount: "Kishilar soni",
    stockDeductionList: "Ombor ayirish ro'yxati",
    perPersonCost: "Bir kishi uchun xarajat",
    total: "Jami",
    inVarieties: "turlarda",
    person: "kishi",
    weeklyGrandTotal: "Haftalik umumiy jami",
    dailyAverage: "Kunlik ortacha",
    avgPerPerson: "Kishi boshiga ortacha",
    totalPersonDays: "Jami kishi/kunlar",
    colDay: "Kun",
    colDate: "Sana",
    colPerson: "Kishi",
    dailyMaterialCost: "Kunlik material xarajati",
    perPerson: "Kishi boshiga",
    ingredients: "Masallar",
    perPersonGram: "(kishi boshiga gr)",
    colIngredient: "Masal",
    colPerPerson: "/kishi",
    colUnit: "Birlik",
    addIngredient: "+ Masal qo'shish",
    foodName: "Ovqat nomi",
    allergen: "Allergen",
    recipePerPerson: "Retsept (kishi boshiga)",
    devices: "qurilmalar",
  }
};

var currentLang = localStorage.getItem('bhys_lang') || 'tr';
var langLabels = { tr:'TR', en:'EN', az:'AZ', ru:'RU', ar:'AR', de:'DE', fr:'FR', es:'ES', pt:'PT', uz:'UZ' };

function toggleLangDropdown() {
  var dd = document.getElementById('langDropdown');
  if (dd) dd.classList.toggle('open');
}

function setLanguage(lang) {
  if (!I18N[lang]) return;
  currentLang = lang;
  localStorage.setItem('bhys_lang', lang);
  document.documentElement.setAttribute('lang', lang);
  if (lang === 'ar') {
    document.documentElement.setAttribute('dir', 'rtl');
  } else {
    document.documentElement.removeAttribute('dir');
  }
  var opts = document.querySelectorAll('.lang-option');
  opts.forEach(function(o) {
    o.classList.toggle('active', o.getAttribute('data-lang') === lang);
  });
  var flagEl = document.getElementById('langCurrentFlag');
  if (flagEl) flagEl.textContent = langLabels[lang] || lang.toUpperCase();
  var dd = document.getElementById('langDropdown');
  if (dd) dd.classList.remove('open');
  applyTranslations();
}

function t(key) {
  var dict = I18N[currentLang] || I18N['tr'];
  return dict[key] || I18N['tr'][key] || key;
}

function applyTranslations() {
  var dict = I18N[currentLang] || I18N['tr'];

  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });

  document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
    var key = el.getAttribute('data-i18n-title');
    if (dict[key]) el.title = dict[key];
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
    var key = el.getAttribute('data-i18n-placeholder');
    if (dict[key]) el.placeholder = dict[key];
  });

  var pageTitles = {
    'tab-dashboard': dict.sidebarPanel,
    'tab-menu': dict.sidebarMenu,
    'tab-records': dict.sidebarRecords,
    'tab-report': dict.sidebarReport,
    'tab-haccp': dict.sidebarHaccp,
    'tab-kalibrasyon': dict.sidebarCalibration,
    'tab-yag': dict.sidebarOil,
    'tab-ambalaj': dict.sidebarPackaging,
    'tab-charts': dict.sidebarCharts,
    'tab-yillik': dict.sidebarYearly,
    'tab-harcama': dict.sidebarSpending,
    'tab-birimfiyat': dict.sidebarUnitPrice,
  };

  var pageTitleEl = document.getElementById('pageTitle');
  if (pageTitleEl) {
    var activeTab = document.querySelector('.tab-btn.active');
    if (activeTab && pageTitles[activeTab.id]) {
      pageTitleEl.textContent = pageTitles[activeTab.id];
    }
  }

  document.title = currentLang === 'tr'
    ? 'Kırşehir Ahi Evran Üniversitesi - BHYS'
    : 'Kırşehir Ahi Evran University - NSMS';
}

document.addEventListener('click', function(e) {
  var sel = document.getElementById('langSelector');
  var dd = document.getElementById('langDropdown');
  if (sel && dd && !sel.contains(e.target)) {
    dd.classList.remove('open');
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { setLanguage(currentLang); });
} else {
  setLanguage(currentLang);
}




