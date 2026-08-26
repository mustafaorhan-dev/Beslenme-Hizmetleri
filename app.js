/* =============================================
   ATIK KONTROL YÃ–NETÄ°M SÄ°STEMÄ° - APP LOGIC
   ============================================= */

'use strict';

// â”€â”€â”€ STATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let records = [];
let editingId = null;
let filteredRecords = [];
let yemeklerCache = [];
let unitPricesCache = [];
let weeklySummaryOffset = 0;
let dailySummaryOffset = 0;
let hcSelectedYear = null;   // Harcama menÃ¼sÃ¼nde seÃ§ili yÄ±l (null => kayÄ±tlardan tÃ¼retilir)
let hcSelectedMonth = null;  // Harcama menÃ¼sÃ¼nde seÃ§ili ay (null => TÃ¼m YÄ±l, 0-11 => belirli ay)
let hcTablePage = 0;         // Harcama tablosunda aktif sayfa

// â”€â”€â”€ SUPABASE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ SUPABASE AUTH STATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      // user_roles'da kayÄ±t yoksa legacy kullanÄ±cÄ± listesinden bulup otomatik at
      // (bÃ¶ylece Supabase'de "kullanÄ±cÄ± rolleri" boÅŸ kalmaz)
      var email = session.user.email || '';
      var username = email.split('@')[0].toLowerCase();
      var cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
      var legacyUser = null;
      if (cfg.users && Array.isArray(cfg.users)) {
        legacyUser = cfg.users.find(function(u) { return (u.username || '').toLowerCase() === username; }) || null;
      }
      var role = legacyUser ? (legacyUser.role || 'asci') : 'asci';
      var displayName = legacyUser ? (legacyUser.displayName || username) : (session.user.email || 'KullanÄ±cÄ±');
      try {
        await supabaseClient.from('user_roles').insert({ auth_user_id: userId, role: role, display_name: displayName });
      } catch (_) {}
      applyLoginState(role, displayName, true);
      logIslem('login', displayName + ' Supabase Auth ile giriÅŸ yaptÄ±');
      return;
    }
    var role = data.role || 'asci';
    var displayName = data.display_name || session.user.email || 'KullanÄ±cÄ±';
    applyLoginState(role, displayName, true);
    logIslem('login', displayName + ' Supabase Auth ile giriÅŸ yaptÄ±');
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

// â”€â”€â”€ REMOTE PASSWORD HASH CACHE (legacy) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let remoteHashes = { adminHash: null };

async function syncPasswordHashesFromRemote() {
  // Legacy: config tablosu anon eriÅŸime kapalÄ±, bu yÃ¼zden Ã§alÄ±ÅŸmaz
  // Sadece Supabase Auth ile devam edin
}

async function syncUsersFromSupabase() {
  // KullanÄ±cÄ± listesi app_users tablosundan Ã§ekilir (Ã§oklu cihaz desteÄŸi)
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
    // Yereldeki kullanÄ±cÄ±larÄ± koru, uzaktaki gÃ¼ncel kayÄ±tla deÄŸiÅŸtir
    localUsers.forEach(function(u) {
      if (remoteByUsername[u.username]) combined.push(remoteByUsername[u.username]);
      else combined.push(u);
    });
    // Uzaktaki yeni kullanÄ±cÄ±larÄ± ekle (baÅŸka cihazdan eklenen)
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
  // KullanÄ±cÄ± listesi app_users tablosuna yazÄ±lÄ±r (Ã§oklu cihaz desteÄŸi)
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

// â”€â”€â”€ THEME â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ TOAST NOTIFICATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ PAGINATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PAGE_SIZE = 20;
let currentPage = 1;
let selectedIds = new Set();

// â”€â”€â”€ UNSAVED CHANGES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let formModified = false;
let lastPollData = null;

// â”€â”€â”€ CHART YEAR / MONTH FILTER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
// â”€â”€â”€ LOGIN / LOGOUT / ROLES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ROLE_ADMIN = 'admin';
const ROLE_DIYETISYEN = 'diyetisyen';
const ROLE_DEPO = 'depo';
const ROLE_ASCI = 'asci';
const ROLE_GIDA_MUHENDISI = 'gida_muhendisi';
const ROLE_TEMIZLIKCI = 'temizlikci';

const ROLE_LABELS = { admin: 'Admin', diyetisyen: 'Diyetisyen', depo: 'Depo Sorumlusu', asci: 'AÅŸÃ§Ä±', gida_muhendisi: 'GÄ±da MÃ¼hendisi', temizlikci: 'TemizlikÃ§i', sadece_gorme: 'Sadece GÃ¶rme' };

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

// Harcama (â‚º) bilgileri yalnÄ±zca admin rolÃ¼ne gÃ¶rÃ¼nÃ¼r
function canSeeHarcama() {
  return getRole() === ROLE_ADMIN;
}

// DÄ±ÅŸa aktarma (PDF/yazdÄ±rma) pencerelerinde harcama Ã¶ÄŸelerini gizleyen CSS kuralÄ±
function harcamaHiddenCss() {
  return canSeeHarcama() ? '' : '.col-harcama,.td-harcama,.report-item-harcama,.chart-card-harcama,.field-harcama{display:none!important}';
}

function isUsingSupabaseAuth() {
  return sessionStorage.getItem('atik_kontrol_supabase_auth') === 'true';
}

function isAdminSessionValid() {
  if (getRole() !== ROLE_ADMIN) return false;

  // Supabase Auth ile giriÅŸ yapÄ±ldÄ±ysa cache'lenmiÅŸ session'Ä± kontrol et
  if (isUsingSupabaseAuth()) {
    return !!supabaseSession;
  }

  // Legacy: client-side hash kontrolÃ¼
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
  if (!role) { showToast('Oturum bulunamadÄ±. LÃ¼tfen giriÅŸ yapÄ±n.', 'error'); return false; }
  
  // Supabase Auth kullanÄ±lÄ±yorsa session varlÄ±ÄŸÄ±nÄ± kontrol et
  if (isUsingSupabaseAuth() && supabaseClient) {
    if (!supabaseSession) {
      showToast('Oturum sÃ¼resi doldu. LÃ¼tfen tekrar giriÅŸ yapÄ±n.', 'error');
      sessionStorage.removeItem('atik_kontrol_role');
      location.reload();
      return false;
    }
  } else if (role === ROLE_ADMIN) {
    // Legacy admin: hash proof kontrolÃ¼
    var storedHash = sessionStorage.getItem('atik_kontrol_admin_hash_proof');
    if (!storedHash) {
      showToast('Bu iÅŸlem iÃ§in admin yetkisi gerekli.', 'error');
      return false;
    }
    var loginTime = parseInt(sessionStorage.getItem('atik_kontrol_login_time') || '0');
    if (Date.now() - loginTime > 3600000) {
      sessionStorage.removeItem('atik_kontrol_admin_hash_proof');
      sessionStorage.removeItem('atik_kontrol_login_time');
      showToast('Oturum sÃ¼resi doldu. LÃ¼tfen tekrar giriÅŸ yapÄ±n.', 'error');
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
    error.textContent = t('selectUser');
    error.style.display = 'block';
    return;
  }

  // 1. Ã–nce legacy auth dene (yÃ¶netim panelinde deÄŸiÅŸtirilen ÅŸifre burada geÃ§erli)
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
    document.getElementById('loginOverlay').classList.add('hidden');
    document.body.setAttribute('data-role', role);
    document.getElementById('roleBadge').textContent = displayName;
    renderAdminPanelBtn();
    applyRolePermissions();
    if (window._loginResolve) { window._loginResolve(); window._loginResolve = null; }
    logIslem('login', displayName + ' (legacy) sisteme giriÅŸ yaptÄ±');
    return;
  }

  // 2. Legacy yoksa/baÅŸarÄ±sÄ±zsa Supabase Auth ile dene (e-posta olarak @ekle)
  if (supabaseClient) {
    var email = username.indexOf('@') === -1 ? username + '@beslenme.local' : username;
    var { data: signInData, error: signInError } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });
    if (!signInError && signInData && signInData.session) {
      // BaÅŸarÄ±lÄ± Supabase Auth - rol user_roles'dan (veya legacy fallback'ten) gelecek
      return;
    }
  }

  // 3. Her ikisi de baÅŸarÄ±sÄ±z
  window._loginAttempts = (window._loginAttempts || 0) + 1;
  error.textContent = t('wrongCredentials');
  error.style.display = 'block';
  input.value = '';
  input.focus();
  if (window._loginAttempts >= 5) {
    error.textContent = t('tooManyAttempts');
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
    showToast('Bu iÅŸlem iÃ§in admin yetkisi gerekli.', 'error');
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
  var roleLabel = getRole() === ROLE_ADMIN ? 'YÃ¶netici' : 'GÃ¶rÃ¼ntÃ¼leme';
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
  document.getElementById('apStorageInfo').textContent = supabaseClient ? 'Supabase + Yerel' : 'Yerel (tarayÄ±cÄ±)';
  document.getElementById('adminPanelModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  apLoadLogs();
}

async function apReAuth() {
  const pw = document.getElementById('apReAuthPw').value;
  const errorEl = document.getElementById('apReAuthError');

  // Supabase Auth ile giriÅŸ yapÄ±ldÄ±ysa session doÄŸrulamasÄ± yap
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

  // Legacy fallback: SHA-256 hash kontrolÃ¼
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
    errorEl.textContent = 'Admin ÅŸifresi yanlÄ±ÅŸ!';
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
  logIslem('logout', (sessionStorage.getItem('atik_kontrol_display_name') || 'bilinmiyor') + ' Ã§Ä±kÄ±ÅŸ yaptÄ±');
  // Supabase Auth'ten Ã§Ä±kÄ±ÅŸ yap
  if (supabaseClient && isUsingSupabaseAuth()) {
    supabaseClient.auth.signOut();
  }
  // TÃ¼m veriyi temizle (sekme bazlÄ± sessionStorage)
  var keysToKeep = ['atik_kontrol_theme', 'atik_kontrol_accent', 'haccp_depo_adlari', ROLE_PERMISSIONS_KEY, 'sb-' + SUPABASE_URL + '-auth-token', 'atik_kontrol_users', 'ogrenci_basi_harcama_orani', 'personel_basi_harcama_orani', 'uretilen_yemek_basi_harcama_orani', 'atik_kontrol_son_personel', 'atik_kontrol_inactivity_timeout'];
  var preserved = {};
  keysToKeep.forEach(function(k) {
    try { var v = localStorage.getItem(k); if (v) preserved[k] = v; } catch (_) {}
  });
  localStorage.clear();
  Object.keys(preserved).forEach(function(k) {
    try { localStorage.setItem(k, preserved[k]); } catch (_) {}
  });
  // sessionStorage'Ä± da temizle (veriler burada duruyor)
  try { sessionStorage.clear(); } catch (_) {}
  // Service Worker Ã¶nbelleÄŸini temizle
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
  successEl.textContent = 'Rol izinleri gÃ¼ncellendi.';
  successEl.style.display = 'block';
  showToast('Ayarlar kaydedildi.', 'success');
  applyRolePermissions();
}

function apRenderRolePermissions() {
  var container = document.getElementById('apRolePermissions');
  if (!container) return;
  var roles = Object.keys(rolePermissions);
  var permLabels = {
    canEditMenu: 'MenÃ¼dÃ¼zenleyebilir',
    canSaveMenu: 'MenÃ¼yÃ¼ kaydedebilir',
    canSeeProduction: 'ÃœrÃ¼n ihtiyaÃ§ listesini gÃ¶rebilir',
    canAddRecord: 'Yeni kayÄ±t ekleyebilir (Ã¼retim/tÃ¼ketim/atÄ±k ana kayÄ±tlar)',
    canAddHaccp: 'Depo sÄ±caklÄ±k kaydÄ± ekleyebilir',
    canAddYag: 'AtÄ±k yaÄŸ kaydÄ± ekleyebilir',
    canAddAmbalaj: 'Ambalaj atÄ±ÄŸÄ± kaydÄ± ekleyebilir',
    canAddKalibrasyon: 'Kalibrasyona tabi cihaz kaydÄ± ekleyebilir',
    canExport: 'DÄ±ÅŸa aktarabilir',
    canSync: 'Senkronizasyon yapabilir',
    canSeeAdminPanel: 'YÃ¶netim panelini gÃ¶rebilir',
    canEditHaccp: 'Depo sÄ±caklÄ±k kayÄ±tlarÄ±nÄ± dÃ¼zenleyebilir/silebilir',
    canEditDepo: 'Depo adlarÄ±nÄ± dÃ¼zenleyebilir',
    canEditHarcamaOran: 'Harcama oranÄ±nÄ±/tutarÄ±nÄ± deÄŸiÅŸtirebilir',
    canEditBirimFiyat: 'Birim fiyat listesini dÃ¼zenleyebilir',
    canEditYag: 'AtÄ±k yaÄŸ bilgilerini dÃ¼zenleyebilir/silebilir',
    canEditAmbalaj: 'Ambalaj atÄ±k kayÄ±tlarÄ±nÄ± dÃ¼zenleyebilir/silebilir',
    canEditKalibrasyon: 'Kalibrasyon cihaz bilgilerini dÃ¼zenleyebilir/silebilir',
    canMenuOnayaGonder: 'MenÃ¼yÃ¼ onaya gÃ¶nderebilir',
    canMenuOnayla: 'MenÃ¼yÃ¼ onaylayabilir',
    canMenuReddet: 'MenÃ¼yÃ¼ reddedebilir'
  };
  var tabLabels = { dashboard: 'Panel', menu: 'MenÃ¼', records: 'KayÄ±tlar', report: 'Rapor', haccp: 'GÄ±da GÃ¼venliÄŸi', kalibrasyon: 'Kalibrasyon', yag: 'AtÄ±k YaÄŸ', ambalaj: 'Ambalaj AtÄ±klarÄ±', charts: 'Grafikler', yillik: 'YÄ±llÄ±k', harcama: 'Harcama', birimfiyat: 'Birim Fiyatlar' };
  var html = '';
  roles.forEach(function(role) {
    var perm = rolePermissions[role] || {};
    var prefix = 'apRole_' + role + '_';
    var isCore = CORE_ROLES.indexOf(role) !== -1;
    var label = (ROLE_LABELS[role] || role);
    html += '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:0.85rem;margin-bottom:0.75rem">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;padding-bottom:0.5rem;border-bottom:1px solid var(--border)">';
    html += '<div style="font-size:0.95rem;font-weight:700;color:var(--text-primary)">' + label + (isCore ? '' : ' <span style="font-size:0.7rem;color:var(--text-muted);font-weight:400">(Ã¶zel rol)</span>') + '</div>';
    html += '<div style="display:flex;gap:0.4rem">';
    html += '<button class="btn btn-ghost btn-sm" onclick="apResetRolePermissions(\'' + role + '\')" title="VarsayÄ±lana sÄ±fÄ±rla" style="font-size:0.75rem;padding:3px 8px;color:var(--accent)">SÄ±fÄ±rla</button>';
    if (!isCore) {
      html += '<button class="btn btn-ghost btn-sm" onclick="apDeleteRole(\'' + role + '\')" title="Bu rolÃ¼ sil" style="font-size:0.75rem;padding:3px 8px;color:#ef4444">Sil</button>';
    }
    html += '</div></div>';
    html += '<div style="font-size:0.8rem;font-weight:600;color:var(--text-muted);margin-bottom:0.4rem">GÃ¶rÃ¼nen Sekmeler</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.25rem;margin-bottom:0.75rem">';
    Object.keys(tabLabels).forEach(function(tab) {
      html += '<label style="display:flex;align-items:center;gap:0.4rem;padding:0.25rem 0;cursor:pointer;font-size:0.82rem">';
      html += '<input type="checkbox" id="' + prefix + 'tab_' + tab + '"' + (perm.tabs && perm.tabs[tab] ? ' checked' : '') + ' /> ' + tabLabels[tab];
      html += '</label>';
    });
    html += '</div>';
    html += '<div style="font-size:0.8rem;font-weight:600;color:var(--text-muted);margin-bottom:0.4rem">Ä°zinler</div>';
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
  html += '<input type="text" id="apNewRoleName" placeholder="Rol adÄ± (Ã¶r: temizlikÃ§i)" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:0.85rem" />';
  html += '<button class="btn btn-primary btn-sm" onclick="apAddRole()">Ekle</button>';
  html += '</div></div>';
  container.innerHTML = html;
}

function apResetRolePermissions(role) {
  if (getRole() !== ROLE_ADMIN) return;
  if (!confirm('Bu rolÃ¼n izinlerini varsayÄ±lana sÄ±fÄ±rlamak istediÄŸinize emin misiniz?')) return;
  if (DEFAULT_ROLE_PERMISSIONS[role]) {
    rolePermissions[role] = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS[role]));
  } else {
    delete rolePermissions[role];
  }
  saveRolePermissions();
  syncRolePermissionsToSupabase();
  apRenderRolePermissions();
  applyRolePermissions();
  showToast((ROLE_LABELS[role] || role) + ' izinleri sÄ±fÄ±rlandÄ±.', 'success');
}

function apDeleteRole(role) {
  if (getRole() !== ROLE_ADMIN) return;
  if (CORE_ROLES.indexOf(role) !== -1) { showToast('Temel roller silinemez.', 'error'); return; }
  if (!confirm('"' + (ROLE_LABELS[role] || role) + '" rolÃ¼nÃ¼ silmek istediÄŸinize emin misiniz?')) return;
  delete rolePermissions[role];
  delete ROLE_LABELS[role];
  saveRolePermissions();
  syncRolePermissionsToSupabase();
  apRenderRolePermissions();
  showToast((ROLE_LABELS[role] || role) + ' rolÃ¼ silindi.', 'success');
}

function apAddRole() {
  if (getRole() !== ROLE_ADMIN) return;
  var nameInput = document.getElementById('apNewRoleName');
  var name = (nameInput.value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!name) { showToast('Rol adÄ± gerekli.', 'error'); return; }
  if (rolePermissions[name]) { showToast('Bu rol zaten var.', 'error'); return; }
  if (['admin'].indexOf(name) !== -1) { showToast('Bu rol adÄ± kullanÄ±lamaz.', 'error'); return; }
  ROLE_LABELS[name] = nameInput.value.trim();
  rolePermissions[name] = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS.asci));
  saveRolePermissions();
  syncRolePermissionsToSupabase();
  nameInput.value = '';
  apRenderRolePermissions();
  showToast('"' + ROLE_LABELS[name] + '" rolÃ¼ eklendi. Ä°zinleri Ã¶zelleÅŸtirebilirsiniz.', 'success');
}

// â”€â”€â”€ KULLANICI YÃ–NETÄ°MÄ° â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);margin:0">KayÄ±tlÄ± kullanÄ±cÄ± yok.</p>';
    return;
  }
  var roleLabels = { admin: 'Admin', diyetisyen: 'Diyetisyen', depo: 'Depo Sorumlusu', asci: 'AÅŸÃ§Ä±' };
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
    html += '<button class="btn btn-ghost btn-sm" onclick="apEditUser(' + i + ')" title="DÃ¼zenle" style="padding:4px 8px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>';
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

  if (!username) { errorEl.textContent = 'KullanÄ±cÄ± adÄ± gerekli.'; errorEl.style.display = 'block'; return; }
  if (!displayName) { errorEl.textContent = 'GÃ¶rÃ¼nen ad gerekli.'; errorEl.style.display = 'block'; return; }
  if (!password || password.length < 3) { errorEl.textContent = 'Åifre en az 3 karakter olmalÄ±.'; errorEl.style.display = 'block'; return; }

  var users = getUsers();
  if (users.some(function(u) { return u.username === username; })) {
    errorEl.textContent = 'Bu kullanÄ±cÄ± adÄ± zaten var.';
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
  successEl.textContent = '"' + displayName + '" kullanÄ±cÄ±sÄ± eklendi.' + (remoteOk ? ' (Supabase)' : ' (yerel)');
  successEl.style.display = 'block';
  showToast('KullanÄ±cÄ± eklendi.' + (remoteOk ? '' : ' (sadece yerel)'), 'success');
  logIslem('kullanici_ekle', displayName + ' (' + role + ') eklendi');
}

function apEditUser(index) {
  if (getRole() !== ROLE_ADMIN) return;
  var users = getUsers();
  var user = users[index];
  if (!user) return;

  var roleLabels = { admin: 'Admin', diyetisyen: 'Diyetisyen', depo: 'Depo Sorumlusu', asci: 'AÅŸÃ§Ä±' };

  var container = document.getElementById('apUserList');
  var html = '<div style="background:var(--bg-card);border:2px solid var(--accent);border-radius:8px;padding:0.75rem">';  html += '<div style="font-size:0.85rem;font-weight:600;color:var(--accent);margin-bottom:0.5rem">KullanÄ±cÄ±yÄ± DÃ¼zenle</div>';
  html += '<input type="hidden" id="apEditIndex" value="' + index + '" />';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem">';
  html += '<div><label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:0.2rem">KullanÄ±cÄ± AdÄ±</label>';
  html += '<input type="text" id="apEditUsername" value="' + escapeHtml(user.username) + '" readonly style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-muted);font-size:0.85rem" /></div>';
  html += '<div><label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:0.2rem">GÃ¶rÃ¼nen Ad</label>';
  html += '<input type="text" id="apEditDisplayName" value="' + escapeHtml(user.displayName) + '" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:0.85rem" /></div>';
  html += '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem">';
  html += '<div><label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:0.2rem">Yeni Åifre (boÅŸ = deÄŸiÅŸmez)</label>';
  html += '<input type="password" id="apEditPassword" placeholder="Yeni ÅŸifre (en az 3 karakter)" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:0.85rem" /></div>';
  html += '<div><label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:0.2rem">Rol</label>';
  html += '<select id="apEditRole" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:0.85rem">';
  ['admin','diyetisyen','depo','asci','gida_muhendisi','temizlikci','sadece_gorme'].forEach(function(r) {
    html += '<option value="' + r + '"' + (user.role === r ? ' selected' : '') + '>' + (roleLabels[r] || ROLE_LABELS[r] || r) + '</option>';
  });
  html += '</select></div>';
  html += '</div>';
  html += '<div style="display:flex;gap:0.5rem">';
  html += '<button class="btn btn-primary btn-sm" onclick="apSaveEditUser()">Kaydet</button>';
  html += '<button class="btn btn-ghost btn-sm" onclick="apRenderUserList()">Ä°ptal</button>';
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

  if (!displayName) { errorEl.textContent = 'GÃ¶rÃ¼nen ad gerekli.'; errorEl.style.display = 'block'; return; }
  if (newPw && newPw.length < 3) { errorEl.textContent = 'Åifre en az 3 karakter olmalÄ±.'; errorEl.style.display = 'block'; return; }

  user.displayName = displayName;
  user.role = role;
  if (newPw && newPw.length >= 3) {
    user.passwordHash = await sha256(newPw);
  }
  users[index] = user;
  var remoteOk = await saveUsers(users);
  apRenderUserList();
  successEl.textContent = displayName + ' gÃ¼ncellendi.' + (remoteOk ? ' (Supabase)' : ' (yerel)');
  successEl.style.display = 'block';
  showToast(displayName + ' gÃ¼ncellendi.' + (remoteOk ? '' : ' (sadece yerel)'), 'success');
  logIslem('kullanici_duzenle', displayName + ' gÃ¼ncellendi');
}

async function apDeleteUser(index) {
  if (getRole() !== ROLE_ADMIN) return;
  var users = getUsers();
  var user = users[index];
  if (!user) return;
  if (user.username === 'admin') { showToast('Admin kullanÄ±cÄ±sÄ± silinemez.', 'error'); return; }
  if (!confirm('"' + user.displayName + '" kullanÄ±cÄ±sÄ±nÄ± silmek istediÄŸinize emin misiniz?')) return;
  users.splice(index, 1);
  var remoteOk = await saveUsers(users);
  apRenderUserList();
  showToast('KullanÄ±cÄ± silindi.' + (remoteOk ? '' : ' (sadece yerel)'), 'success');
  logIslem('kullanici_sil', user.displayName + ' silindi');
}

async function apLoadLogs() {
  var container = document.getElementById('logPanelBody') || document.getElementById('apLogList');
  if (!container) return;
  if (!supabaseClient) { container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-muted)">Supabase baÄŸlÄ± deÄŸil.</div>'; return; }
  container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-muted)">YÃ¼kleniyor...</div>';
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
    if (!data || data.length === 0) { container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-muted)">Log kaydÄ± bulunamadÄ±.</div>'; return; }
    var islemRenk = { login: '#22c55e', logout: '#ef4444', yeni_kayit: '#3b82f6', kayit_duzenle: '#f59e0b', kayit_sil: '#ef4444', kullanici_ekle: '#3b82f6', kullanici_duzenle: '#f59e0b', kullanici_sil: '#ef4444' };
    var islemEtiket = { login: 'GiriÅŸ', logout: 'Ã‡Ä±kÄ±ÅŸ', yeni_kayit: 'Yeni KayÄ±t', kayit_duzenle: 'DÃ¼zenleme', kayit_sil: 'Silme', kullanici_ekle: 'KullanÄ±cÄ± Ekle', kullanici_duzenle: 'KullanÄ±cÄ± DÃ¼zenle', kullanici_sil: 'KullanÄ±cÄ± Sil' };
    var html = '<table style="width:100%;border-collapse:collapse;font-size:0.78rem">';
    html += '<thead><tr style="background:var(--bg-card);position:sticky;top:0;z-index:1"><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600">Tarih</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600">KullanÄ±cÄ±</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600">Ä°ÅŸlem</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600">Detay</th></tr></thead><tbody>';
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
    container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--danger)">Loglar yÃ¼klenemedi.</div>';
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
  if (!body) { showToast('KÄ±lavuz iÃ§eriÄŸi bulunamadÄ±.', 'error'); return; }
  var printWin = window.open('', '_blank', 'width=900,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatÄ±n.', 'error'); return; }
  var manualHtml = body.outerHTML;
  printWin.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>KullanÄ±m KÄ±lavuzu - AtÄ±k Kontrol</title>
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
    <h1>KIRÅEHÄ°R AHÄ° EVRAN ÃœNÄ°VERSÄ°TESÄ°<br>Beslenme Hizmetleri YÃ¶netim Sistemi</h1>
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
  // Sekme iÃ§indeki tÃ¼m "Supabase'e Kaydet / Supabase'ten Ã‡ek" butonlarÄ± da canSync'e baÄŸlÄ±
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
    if (hcOran) { hcOran.readOnly = true; hcOran.title = 'OranÄ± deÄŸiÅŸtirme yetkiniz yok.'; }
    var hcOranBtn = document.querySelector('button[onclick*="hcKaydetOran"]');
    if (hcOranBtn) hcOranBtn.style.display = 'none';
    var hcPersOran = document.getElementById('hcPersonelOran');
    if (hcPersOran) { hcPersOran.readOnly = true; hcPersOran.title = 'OranÄ± deÄŸiÅŸtirme yetkiniz yok.'; }
    var hcPersOranBtn = document.querySelector('button[onclick*="hcKaydetPersonelOran"]');
    if (hcPersOranBtn) hcPersOranBtn.style.display = 'none';
    var hcYemekOran = document.getElementById('hcYemekOran');
    if (hcYemekOran) { hcYemekOran.readOnly = true; hcYemekOran.title = 'OranÄ± deÄŸiÅŸtirme yetkiniz yok.'; }
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
  // Mevcut seÃ§enekleri temizle (ilk option hariÃ§)
  while (select.options.length > 1) select.remove(1);
  cfg.users.forEach(function(user) {
    var opt = document.createElement('option');
    opt.value = user.username;
    opt.textContent = user.displayName;
    select.appendChild(opt);
  });
}

// â”€â”€â”€ INIT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
document.addEventListener('DOMContentLoaded', async () => {
  // Ã–nce Supabase Auth'u baÅŸlat (session varsa otomatik giriÅŸ yapar)
  await initSupabaseAuth();

  loadRolePermissions();
  loadUsersFromStorage();
  await syncUsersFromSupabase();
  populateLoginUsers();
  document.getElementById('loginPassword').focus();

  var existingRole = sessionStorage.getItem('atik_kontrol_role');
  var isSupabaseAuth = isUsingSupabaseAuth();

  if (existingRole) {
    // Supabase Auth ile giriÅŸ yapÄ±ldÄ±ysa session'Ä± doÄŸrula
    if (isSupabaseAuth && supabaseClient) {
      var { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) {
        // Session geÃ§ersiz, legacy'e dÃ¼ÅŸ veya login gÃ¶ster
        sessionStorage.removeItem('atik_kontrol_role');
        sessionStorage.removeItem('atik_kontrol_supabase_auth');
      }
    }
    existingRole = sessionStorage.getItem('atik_kontrol_role');
    if (existingRole) {
      document.getElementById('loginOverlay').classList.add('hidden');
      document.body.setAttribute('data-role', existingRole);
      var displayName = sessionStorage.getItem('atik_kontrol_display_name') || (existingRole === ROLE_ADMIN ? 'Admin' : 'GÃ¶rÃ¼ntÃ¼leme');
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
  setLoadingText('Veriler yÃ¼kleniyor...', 'Supabase baÄŸlantÄ±sÄ± kontrol ediliyor');
  loadData();
  loadHaccpData();
  loadYagData();
  loadAmbalajData();
  loadKalibrasyonData();

  // Records her sayfa yÃ¼kleniÅŸinde Supabase'ten Ã§ekilir (Ã§oklu cihaz desteÄŸi)
  if (supabaseClient) {
    setLoadingText('Veriler yÃ¼kleniyor...', 'Sunucudan veriler alÄ±nÄ±yor...');
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

  // Yag ve ambalaj her sayfada Supabase'ten Ã§ekilir
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

  // YemeklerCache boÅŸsa yine de dene
  if (!yemeklerCache.length && supabaseClient) {
    await syncDishesFromSupabase();
  }

  // HACCP (soÄŸuk depo sÄ±caklÄ±k) verileri her sayfa yÃ¼kleniÅŸinde Supabase'ten Ã§ekilir
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

  // GÃ¼venlik: 10 sn sonra loading overlay'i zorla kapat
  var forceHideTimer = setTimeout(function() {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }, 10000);

  setLoadingSub('Uygulama baÅŸlatÄ±lÄ±yor...');
  clearTimeout(forceHideTimer);

  refreshMenuProduction();
  initDishAutocomplete();

  // Ana iÃ§eriÄŸe tÄ±klayÄ±nca sidebar'Ä± kapat
  var mc = document.querySelector('.main-content');
  if (mc) mc.addEventListener('click', function(e) {
    if (document.querySelector('.sidebar').classList.contains('open')) closeSidebar();
  });

  // Loading overlay'i kapat
  document.getElementById('loadingOverlay').classList.add('hidden');

  setConnectionStatus('ok');
  showSyncTime('hazÄ±r');
  startPolling();
  resetInactivityTimer();
});

// â”€â”€â”€ AUTO POLL & INACTIVITY LOCK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      if (!hasNew && !hasRemoved) { showSyncTime('otomatik â€¢ gÃ¼ncel'); return; }
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
      showSyncTime('otomatik â€¢ gÃ¼ncellendi');
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
  logIslem('logout', (sessionStorage.getItem('atik_kontrol_display_name') || 'bilinmiyor') + ' oturumu kapattÄ±');
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
  el.textContent = msg ? `BaÄŸlÄ± â€¢ ${time} (${msg})` : `BaÄŸlÄ± â€¢ ${time}`;
}

// â”€â”€â”€ DATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function normalizeDate(v) {
  if (!v) return '';
  // Zaten YYYY-MM-DD formatÄ±nda mÄ±?
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // DD.MM.YYYY veya DD/MM/YYYY (TÃ¼rkiye formatÄ±)
  var m = v.match(/^(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
  // SayÄ±sal (Google Sheets serial date)?
  if (/^\d+(\.\d+)?$/.test(String(v))) {
    const d = new Date(1899, 11, 30 + Number(v));
    if (!isNaN(d)) return formatLocalDate(d);
  }
  // DiÄŸer formatlar (ISO, "Sat Jan 15 2026", vb.)
  const d = new Date(v);
  if (!isNaN(d)) return formatLocalDate(d);
  return '';
}

function displayDate(dateStr) {
  if (!dateStr) return 'â€”';
  var n = normalizeDate(dateStr);
  if (!n) return 'â€”';
  var d = new Date(n + 'T12:00:00');
  if (isNaN(d)) return 'â€”';
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

// â”€â”€â”€ STORAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const STORAGE_KEY = 'atik_kontrol_records';

function loadData() {
  try {
    // sessionStorage'den oku (sekme bazlÄ±, kapanÄ±nca silinir)
    var stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      records = JSON.parse(stored);
    } else {
      // localStorage'dan migrate et (eski kullanÄ±cÄ±lar iÃ§in) ve temizle
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

// â”€â”€â”€ Ã–ÄRENCÄ° BAÅINA HARCAMA ORANI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const HARCAMA_ORAN_SUPABASE_KEY = 'harcama_oranlari';
function getOgrenciBasiHarcamaOrani() {
  var val = localStorage.getItem('ogrenci_basi_harcama_orani');
  return val !== null ? parseFloat(val) : 70.37;
}
function setOgrenciBasiHarcamaOrani(val) {
  localStorage.setItem('ogrenci_basi_harcama_orani', String(val));
  syncHarcamaOranlariToSupabase();
}

// â”€â”€â”€ PERSONEL BAÅINA HARCAMA ORANI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getPersonelBasiHarcamaOrani() {
  var val = localStorage.getItem('personel_basi_harcama_orani');
  return val !== null ? parseFloat(val) : 50.00;
}
function setPersonelBasiHarcamaOrani(val) {
  localStorage.setItem('personel_basi_harcama_orani', String(val));
  syncHarcamaOranlariToSupabase();
}

// â”€â”€â”€ ÃœRETÄ°LEN YEMEK BAÅINA HARCAMA ORANI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getUretilenYemekBasiHarcamaOrani() {
  var val = localStorage.getItem('uretilen_yemek_basi_harcama_orani');
  return val !== null ? parseFloat(val) : 12.00;
}
function setUretilenYemekBasiHarcamaOrani(val) {
  localStorage.setItem('uretilen_yemek_basi_harcama_orani', String(val));
  syncHarcamaOranlariToSupabase();
}

// â”€â”€â”€ SUPABASE HARCAMA ORAN SENKRONÄ°ZASYONU â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ BÄ°RÄ°M FÄ°YAT LÄ°STESÄ° â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  if (!canEditBirimFiyat()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  var enIyi = grup.reduce(function(a, b) { return a.birim_fiyat > b.birim_fiyat ? a : b; });
  for (var i = 0; i < grup.length; i++) {
    if (grup[i].id !== enIyi.id) {
      await deleteUnitPrice(grup[i].id);
    }
  }
  renderBirimFiyatlar();
  showToast('Duplike kayÄ±tlar temizlendi. En yÃ¼ksek fiyat korundu.', 'success');
}

async function bfTumDuplariTemizle() {
  if (!canEditBirimFiyat()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  var duplar = bfBulDuplike();
  if (duplar.length === 0) { showToast('Duplike kayÄ±t bulunamadÄ±.', 'info'); return; }
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
  showToast(duplar.length + ' grupta toplam ' + duplar.reduce(function(s, g) { return s + g.length - 1; }, 0) + ' duplike kayÄ±t silindi.', 'success');
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
    .replace(/Ä°/g, 'i').replace(/Ä±/g, 'i').replace(/I/g, 'i')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ÄŸ/g, 'g').replace(/Ã¼/g, 'u').replace(/ÅŸ/g, 's').replace(/Ã¶/g, 'o').replace(/Ã§/g, 'c');
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
        <h2>${t('unitPriceList')}</h2>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
          <div style="display:flex;align-items:center;border:1px solid var(--border);border-radius:8px;overflow:hidden">
            <button class="btn btn-ghost btn-sm" onclick="bfYilDegistir(-1)" style="border:none;border-radius:0;padding:6px 10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg></button>
            <span id="bfYilGoster" style="padding:6px 14px;font-weight:700;font-size:0.95rem;color:var(--text-primary);min-width:50px;text-align:center;cursor:pointer;user-select:none" title="TÄ±kla, yÄ±l seÃ§" onclick="bfYilSeciciAc()">${birimFiyatSeciliYil}</span>
            <button class="btn btn-ghost btn-sm" onclick="bfYilDegistir(1)" style="border:none;border-radius:0;padding:6px 10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg></button>
          </div>
          ${bfPerms ? '<button class="btn btn-primary btn-sm" onclick="bfYeniUrun()">+ Yeni ÃœrÃ¼n</button>' : ''}
          <button class="btn btn-ghost btn-sm" onclick="bfExportCSV()">CSV Ä°ndir</button>
          <button class="btn btn-ghost btn-sm" onclick="printBirimFiyatlar()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            YazdÄ±r
          </button>
          ${bfPerms ? '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'bfCSVUpload\').click()">CSV YÃ¼kle</button>' : ''}
          <input type="file" id="bfCSVUpload" accept=".csv,.txt" style="display:none" onchange="bfImportCSV(event)" />
        </div>
      </div>
      <div class="bf-kpi-grid">
        <div class="bf-kpi kayitli"><div class="bf-kpi-value">${filtered.length}</div><div class="bf-kpi-label">${t('registeredProducts')}</div></div>
        <div class="bf-kpi toplam"><div class="bf-kpi-value">${formatTRY(toplamTutar)}</div><div class="bf-kpi-label">${t('totalAmount')}</div></div>
        <div class="bf-kpi ortalama"><div class="bf-kpi-value">${formatTRY(ortalama)}</div><div class="bf-kpi-label">${t('avgUnitPrice')}</div></div>
        <div class="bf-kpi fiyat"><div class="bf-kpi-value">${birimFiyatSeciliYil}</div><div class="bf-kpi-label">${t('selectedYear')}</div></div>
      </div>
      ${bfBulDuplike().length > 0 ? '<div style="padding:0.6rem 0.8rem;background:rgba(250,204,21,0.12);border:1px solid rgba(250,204,21,0.4);border-radius:8px;margin-bottom:0.75rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem"><span style="font-size:0.82rem;color:#ca8a04;font-weight:600">âš ï¸ ' + bfBulDuplike().length + ' ' + t('duplicateWarning') + '</span>' + (bfPerms ? '<button class="btn btn-ghost btn-sm" style="color:#ca8a04;border:1px solid rgba(250,204,21,0.4)" onclick="bfTumDuplariTemizle()">' + t('cleanDuplicates') + '</button>' : '') + '</div>' : ''}
      <div id="bfFormContainer" style="display:none;margin-bottom:1rem"></div>
      <div class="table-wrapper">
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th style="text-align:left;width:30%">${t('colProductName')}</th>
              <th style="text-align:center;width:12%">${t('colUnit')}</th>
              <th style="text-align:center;width:18%">${t('colUnitPrice')}</th>
              <th style="text-align:center;width:18%">${t('colUnitEquals')}</th>
              <th style="text-align:center;width:10%">${t('colYear')}</th>
              ${bfPerms ? '<th style="text-align:center;width:12%">Ä°ÅŸlem</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${bfSlice.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem">' + t('noProductsThisYear') + '</td></tr>' : ''}
            ${bfSlice.map(function(p) {
              var carpanGoster = p.birim_carpan > 0 ? p.birim_carpan + ' ' + (p.birim === 'teneke' ? 'lt' : p.birim === 'koli' ? 'kg' : p.birim === 'kg' ? 'gr' : p.birim === 'litre' ? 'ml' : '') : 'â€”';
              return '<tr data-id="' + p.id + '">' +
                '<td style="text-align:left"><strong>' + escapeHtml(p.urun_adi) + '</strong></td>' +
                '<td style="text-align:center">' + escapeHtml(p.birim) + '</td>' +
                '<td style="text-align:center;font-weight:600;color:var(--accent-cyan)">' + p.birim_fiyat.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' â‚º</td>' +
                '<td style="text-align:center;font-size:0.8rem;color:var(--text-dim)">' + carpanGoster + '</td>' +
                '<td style="text-align:center">' + p.yil + '</td>' +
                (bfPerms ?
                  '<td style="text-align:center;white-space:nowrap">' +
                    '<button class="btn-icon btn-sm" onclick="bfDuzenle(\'' + p.id + '\')" title="' + t('btnEdit') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
                    '<button class="btn-icon btn-sm" onclick="bfSil(\'' + p.id + '\')" title="' + t('btnDelete') + '" style="color:var(--danger)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>' +
                  '</td>' : '') +
                '</td>';
            }).join('')}
          </tbody>
        </table>
      </div>
      ${bfToplamSayfa > 1 ? '<div style="display:flex;justify-content:center;align-items:center;gap:0.4rem;margin-top:0.75rem;flex-wrap:wrap">' +
        '<button class="btn btn-ghost btn-sm" onclick="window._bfPage=1;renderBirimFiyatlar()" ' + (window._bfPage === 1 ? 'disabled' : '') + '>&laquo;</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="window._bfPage--;renderBirimFiyatlar()" ' + (window._bfPage === 1 ? 'disabled' : '') + '>&lsaquo;</button>' +
        '<span style="font-size:0.85rem;color:var(--text-dim);padding:0 8px">' + t('pageLabel') + ' ' + window._bfPage + ' / ' + bfToplamSayfa + '</span>' +
        '<button class="btn btn-ghost btn-sm" onclick="window._bfPage++;renderBirimFiyatlar()" ' + (window._bfPage >= bfToplamSayfa ? 'disabled' : '') + '>&rsaquo;</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="window._bfPage=' + bfToplamSayfa + ';renderBirimFiyatlar()" ' + (window._bfPage >= bfToplamSayfa ? 'disabled' : '') + '>&raquo;</button>' +
      '</div>' : ''}
      <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.5rem">${t('totalProductsLabel')} ${filtered.length} ${t('totalProductsSuffix')}${bfToplamSayfa > 1 ? ' | ' + t('pageLabel') + ' ' + window._bfPage + '/' + bfToplamSayfa : ''} | ${t('priceYearNote')}</div>
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
  overlay.innerHTML = '<div class="modal sync-panel" style="max-width:340px"><div class="modal-header"><h2 style="font-size:1rem">' + t('selectYear') + '</h2><button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div><div class="modal-body" style="padding:0.75rem"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.35rem">' + yillarHtml + '</div></div></div>';
  document.body.appendChild(overlay);
}

let bfDuzenlemeId = null;

function bfYeniUrun() {
  if (!canEditBirimFiyat()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  bfDuzenlemeId = null;
  var form = document.getElementById('bfFormContainer');
  if (!form) return;
  form.style.display = 'block';
  form.innerHTML = `<div style="padding:0.75rem;background:var(--bg-card);border-radius:var(--radius-sm);border:1px solid var(--border)">
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:end">
      <div style="flex:4;min-width:200px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">${t('colProductName')}</label>
        <input type="text" id="bf_ad" placeholder="Ã–rn: Domates" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem" />
      </div>
      <div style="flex:0.5;min-width:80px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">${t('colUnit')}</label>
        <select id="bf_birim" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem">
          <option value="kg">KG</option>
          <option value="koli">KOLÄ°</option>
          <option value="litre">LÄ°TRE</option>
          <option value="adet">ADET</option>
          <option value="teneke">TENEKE</option>
        </select>
      </div>
      <div style="flex:1;min-width:100px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">${t('colUnitPrice')}</label>
        <input type="number" id="bf_fiyat" step="0.01" min="0" placeholder="0.00" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem" />
      </div>
      <div style="flex:0.8;min-width:90px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">1 Birim = X (alt birim)</label>
        <input type="number" id="bf_carpan" step="any" min="0" placeholder="Ã–rn: 18" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem" />
        <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px">teneke=18, koli=10</div>
      </div>
      <div style="display:flex;gap:0.3rem;align-items:end;padding-bottom:1px">
        <button class="btn btn-primary btn-sm" onclick="bfKaydet()">${t('btnSave')}</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('bfFormContainer').style.display='none'">${t('btnCancel')}</button>
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
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">${t('colProductName')}</label>
        <input type="text" id="bf_ad" value="${escapeHtml(item.urun_adi)}" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem" />
      </div>
      <div style="flex:0.5;min-width:80px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">${t('colUnit')}</label>
        <select id="bf_birim" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem">
          <option value="kg"${item.birim === 'kg' ? ' selected' : ''}>KG</option>
          <option value="koli"${item.birim === 'koli' ? ' selected' : ''}>KOLÄ°</option>
          <option value="litre"${item.birim === 'litre' ? ' selected' : ''}>LÄ°TRE</option>
          <option value="adet"${item.birim === 'adet' ? ' selected' : ''}>ADET</option>
          <option value="teneke"${item.birim === 'teneke' ? ' selected' : ''}>TENEKE</option>
        </select>
      </div>
      <div style="flex:1;min-width:100px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">${t('colUnitPrice')}</label>
        <input type="number" id="bf_fiyat" step="0.01" min="0" value="${item.birim_fiyat}" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem" />
      </div>
      <div style="flex:0.8;min-width:90px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">1 Birim = X (alt birim)</label>
        <input type="number" id="bf_carpan" step="any" min="0" value="${item.birim_carpan || ''}" style="width:100%;padding:0.45rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:0.85rem" />
        <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px">teneke=18, koli=10</div>
      </div>
      <div style="display:flex;gap:0.3rem;align-items:end;padding-bottom:1px">
        <button class="btn btn-primary btn-sm" onclick="bfKaydet()">${t('btnSave')}</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('bfFormContainer').style.display='none'">${t('btnCancel')}</button>
      </div>
    </div>
  </div>`;
  document.getElementById('bf_ad').focus();
}

function bfKaydet() {
  if (!canEditBirimFiyat()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  var ad = (document.getElementById('bf_ad').value || '').trim();
  var birim = document.getElementById('bf_birim').value;
  var fiyat = parseFloat(document.getElementById('bf_fiyat').value) || 0;
  var carpan = parseFloat(document.getElementById('bf_carpan').value) || 0;
  if (!ad) { showToast('ÃœrÃ¼n adÄ± zorunludur.', 'error'); return; }
  if (fiyat <= 0) { showToast('GeÃ§erli bir fiyat girin.', 'error'); return; }
  if (bfDuzenlemeId) {
    editUnitPrice(bfDuzenlemeId, { urun_adi: ad, birim: birim, birim_fiyat: fiyat, birim_carpan: carpan });
    showToast('ÃœrÃ¼n gÃ¼ncellendi.', 'success');
  } else {
    addUnitPrice(ad, birim, fiyat, birimFiyatSeciliYil, carpan);
    showToast('ÃœrÃ¼n eklendi.', 'success');
  }
  document.getElementById('bfFormContainer').style.display = 'none';
  bfDuzenlemeId = null;
  renderBirimFiyatlar();
}

function bfSil(id) {
  if (!canEditBirimFiyat()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (!confirm('Bu Ã¼rÃ¼nÃ¼ silmek istediÄŸinize emin misiniz?')) return;
  deleteUnitPrice(id);
  showToast('ÃœrÃ¼n silindi.', 'success');
  renderBirimFiyatlar();
}

function bfExportCSV() {
  var filtered = unitPricesCache.filter(function(p) { return p.yil === birimFiyatSeciliYil; });
  if (!filtered.length) { showToast('DÄ±ÅŸa aktarÄ±lacak Ã¼rÃ¼n yok.', 'error'); return; }
  var rows = [[t('colProductName'), t('colUnit'), t('colUnitPrice'), t('colYear')]];
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
    if (lines.length < 2) { showToast('CSV boÅŸ veya geÃ§ersiz.', 'error'); return; }
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
    showToast(imported + ' Ã¼rÃ¼n iÃ§e aktarÄ±ldÄ±.', 'success');
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
  if (!win) { showToast('Pop-up engelleyiciyi kapatÄ±n.', 'error'); return; }
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + t('unitPriceList') + ' - ' + birimFiyatSeciliYil + '</title><style>');
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
  win.document.write('<h1>' + t('unitPriceList') + '</h1>');
  win.document.write('<div class="sub">' + birimFiyatSeciliYil + ' YÄ±lÄ± \u2014 ' + filtered.length + ' \u00fcr\u00fcn</div>');
  win.document.write('<table><thead><tr><th style="width:30px">#</th><th style="text-align:left">' + t('colProductName') + '</th><th>' + t('colUnit') + '</th><th>' + t('colUnitPrice') + '</th><th>' + t('colYear') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
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
  if (!supabaseClient) { showToast('Supabase baÄŸlantÄ±sÄ± yok.', 'error'); return; }
  try {
    if (haccpRecords.length > 0) {
      var dbRows = haccpRecords.map(haccpRecordToDB);
      var { error } = await supabaseClient.from('haccp_records').upsert(dbRows, { onConflict: 'id' });
      if (error) { showToast('Supabase hatasÄ±: ' + error.message, 'error'); return; }
    }
    var depoAdlari = loadHaccpDepoAdlari();
    if (depoAdlari.length > 0) {
      var depoRows = depoAdlari.map(function(ad) { return { ad: ad }; });
      var { error: depoErr } = await supabaseClient.from('haccp_depo_adlari').upsert(depoRows, { onConflict: 'ad' });
      if (depoErr) { showToast('Depo adÄ± hatasÄ±: ' + depoErr.message, 'error'); return; }
    }
    showToast('HACCP verileri Supabase\'e senkronize edildi.', 'success');
  } catch (err) {
    showToast('Supabase baÄŸlantÄ± hatasÄ±: ' + err.message, 'error');
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
        if (error) showToast('Supabase HACCP hatasÄ±: ' + error.message, 'error');
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
      showToast('Supabase baÄŸlantÄ± hatasÄ±: ' + (err.message || err), 'error');
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

// â”€â”€â”€ HACCP 100 KAYIT OLUÅTUR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function generateHaccpSample() {
  if (!canAddHaccpRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  var depo = 'SoÄŸuk Hava Deposu 5';
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
  showToast('100 adet sÄ±caklÄ±k kaydÄ± oluÅŸturuldu (son 25 gÃ¼n, gÃ¼nde 4 Ã¶lÃ§Ã¼m).', 'success');
}

// â”€â”€â”€ HACCP EXCEL Ä°NDÄ°R â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function canExport() {
  if (getRole() === ROLE_ADMIN) return true;
  var perm = getRolePermissions(getRole());
  return !!(perm && perm.canExport);
}

function exportHaccpCSV() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (haccpRecords.length === 0) { showToast('Ä°ndirilecek kayÄ±t yok.', 'error'); return; }
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
  showToast(haccpRecords.length + ' kayÄ±t CSV olarak indirildi.', 'success');
}

// â”€â”€â”€ HACCP DOSYA YÃœKLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
var HACCP_FIELD_MAP = {
  'Tarih': 'tarih', 'Saat': 'saat', 'Depo AdÄ±': 'depoAd', 'Depo Ad': 'depoAd', 'Depo': 'depoAd',
  'SÄ±caklÄ±k (Â°C)': 'sicaklik', 'SÄ±caklÄ±k': 'sicaklik', 'Sicaklik': 'sicaklik', 'SÄ±caklÄ±k (C)': 'sicaklik',
  'Nem (%)': 'nem', 'Nem': 'nem', 'Not': 'not', 'not': 'not',
  'id': 'id', 'type': 'type', 'tarih': 'tarih', 'saat': 'saat',
  'depoAd': 'depoAd', 'depo_ad': 'depoAd', 'sicaklik': 'sicaklik', 'nem': 'nem',
  'not_': 'not', 'last_modified': 'last_modified'
};

function importHaccpFile(event) {
  if (!canAddHaccpRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
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
        if (lines.length < 2) { showToast('CSV en az 2 satÄ±r olmalÄ± (baÅŸlÄ±k + veri).', 'error'); return; }
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
      if (rows.length === 0) { showToast('Dosyada kayÄ±t bulunamadÄ±.', 'error'); return; }
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
      var mesaj = eklenen + ' yeni kayÄ±t eklendi';
      if (guncellenen > 0) mesaj += ', ' + guncellenen + ' kayÄ±t gÃ¼ncellendi';
      showToast(mesaj + ' (' + haccpRecords.length + ' toplam).', 'success');
    } catch (err) { showToast('Dosya okuma hatasÄ±: ' + err.message, 'error'); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// â”€â”€â”€ YAG (AtÄ±k YaÄŸ) SYNC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    showToast('YaÄŸ verileri Supabase\'e senkronize edildi.', 'success');
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

// â”€â”€â”€ AMBALAJ (Ambalaj AtÄ±klarÄ±) SYNC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ KALÄ°BRASYON (Kalibrasyona Tabi Cihazlar) SYNC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ SUPABASE SYNC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getMenuUrl() {
  return SUPABASE_URL;
}

async function syncAllToSupabase() { if (!requireAdmin()) return;
  if (!supabaseClient) { showToast('Supabase baÄŸlantÄ±sÄ± yok.', 'error'); return; }
  var toastMsg = [];
  try {
    if (records.length > 0) {
      var { count: rCount } = await supabaseClient.from('records').upsert(records, { onConflict: 'id' }).select('count');
      toastMsg.push('KayÄ±tlar: ' + (rCount || records.length));
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
      toastMsg.push('YaÄŸ: ' + yagRecords.length);
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
    showToast('Supabase\'e yedeklendi: ' + (toastMsg.join(', ') || 'gÃ¼ncel veri yok'), 'success');
  } catch (err) {
    showToast('Supabase hatasÄ±: ' + err.message, 'error');
  }
}

async function syncAllFromSupabase() { if (!requireAdmin()) return;
  if (!supabaseClient) { showToast('Supabase baÄŸlantÄ±sÄ± yok.', 'error'); return; }
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
      toastMsg.push('KayÄ±tlar: ' + records.length);
    }
    var hPulled = await syncHaccpFromSupabase();
    if (hPulled) toastMsg.push('HACCP: ' + haccpRecords.length);
    await syncYagFromSupabase();
    await syncAmbalajFromSupabase();
    var kPulled = await syncKalibrasyonFromSupabase();
    if (kPulled) toastMsg.push('Kalibrasyon: ' + kalibrasyonCihazlari.length);
    var hOranPulled = await syncHarcamaOranlariFromSupabase();
    if (hOranPulled) toastMsg.push('Harcama OranlarÄ±');
    showToast('Supabase\'ten alÄ±ndÄ±: ' + (toastMsg.join(', ') || 'veri yok'), 'success');
  } catch (err) {
    showToast('Supabase hatasÄ±: ' + err.message, 'error');
  }
}

// â”€â”€â”€ PREDICTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getLast7AvgWaste() {
  const last7 = records.slice(0, Math.min(7, records.length));
  if (last7.length === 0) return 0;
  return last7.reduce((s, r) => s + r.atik, 0) / last7.length;
}

// â”€â”€â”€ SPARKLINES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ WASTE DETAIL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€â”€ PDF EXPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (records.length === 0) {
    showToast('DÄ±ÅŸa aktarÄ±lacak kayÄ±t yok.', 'error');
    return;
  }
  switchTab('report');
  renderReport();
  setTimeout(() => {
    const printWin = window.open('', '_blank', 'width=1100,height=800');
    if (!printWin) { showToast('Pop-up engelleyiciyi kapatÄ±n.', 'error'); return; }
    const cards = [...document.querySelectorAll('#content-report > .section-card')].map(c => c.outerHTML).join('');
    printWin.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8"><title>AtÄ±k Kontrol Raporu</title>
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
      <h1>AtÄ±k Kontrol Raporu</h1>
      <div class="date">${new Date().toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'})}</div>
      ${cards}
      <div class="footer">KÄ±rÅŸehir Ahi Evran Ãœniversitesi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
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
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
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

// â”€â”€â”€ HACCP / GIDA GUVENLIGI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const HACCP_STORAGE_KEY = 'haccp_records';
const HACCP_DEPO_KEY = 'haccp_depo_adlari';
const DEFAULT_DEPO_ADLARI = ['SoÄŸuk Hava Deposu 5', 'SoÄŸuk Hava Deposu 6', 'SoÄŸuk Hava Deposu 7', 'SoÄŸuk Hava Deposu 8'];
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
  if (!canEditDepoAdlari()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
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
  if (!canEditDepoAdlari()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  document.getElementById('haccpDepoModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderHaccpDepoListesi();
}

function closeHaccpDepoModal() {
  document.getElementById('haccpDepoModal').classList.remove('open');
  document.body.style.overflow = '';
}

function addHaccpDepoAdiFromInput() {
  if (!canEditDepoAdlari()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
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
      'Alt Limit: <input type="number" step="0.1" value="' + minVal + '" class="depo-limit-min" style="width:72px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:0.78rem" oninput="saveDepoLimitsFromRow(this)" placeholder="â€”"> Â°C' +
      'Ãœst Limit: <input type="number" step="0.1" value="' + maxVal + '" class="depo-limit-max" style="width:72px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:0.78rem" oninput="saveDepoLimitsFromRow(this)" placeholder="â€”"> Â°C' +
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
    var ad = r.depoAd || t('unknownDepo');
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
      var durum = min >= minOk && max <= maxOk ? t('tempAppropriate') : (max > maxOk ? t('tempHigh') : t('tempLow'));
      html += '<span>' + t('tempMin') + '<strong style="color:' + (min < minOk || min > maxOk ? '#ef4444' : 'var(--text-primary)') + '">' + min.toFixed(1) + 'Â°C</strong></span>' +
        '<span>' + t('tempAvg') + '<strong style="color:var(--text-primary)">' + avg.toFixed(1) + 'Â°C</strong></span>' +
        '<span>' + t('tempMax') + '<strong style="color:' + (max > maxOk || max < minOk ? '#ef4444' : 'var(--text-primary)') + '">' + max.toFixed(1) + 'Â°C</strong></span>';
    }
    if (nemAvg !== null) {
      html += '<span>' + t('humidity') + '<strong>' + nemAvg.toFixed(0) + '%</strong></span>';
    }
    html += '<span style="margin-left:auto;font-size:0.65rem;color:var(--text-muted)">' + topKayit + t('recordCount') + '</span>' +
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
  if (isNaN(v)) return { text: 'â€”', cls: '' };
  var limits = getDepoSicaklikLimitleri(depoAd);
  if (v >= limits.min && v <= limits.max) return { text: t('tempAppropriate'), cls: 'badge badge-ok' };
  if (v < limits.min) return { text: t('tempLow'), cls: 'badge badge-warn' };
  return { text: t('tempHigh'), cls: 'badge badge-err' };
}

var haccpSicaklikPage = 0;
var haccpSicaklikPageSize = 100;
var haccpSelectedIds = new Set();

function formatTarihTR(t) {
  if (!t) return 'â€”';
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
    records.forEach(function(r) { depoSet[r.depoAd || (t('depot') + ' ' + r.depoNo)] = true; });
    getHaccpDepoAdlari().forEach(function(d) { depoSet[d] = true; });
    var depoList = Object.keys(depoSet).sort();
    filterSelect.innerHTML = '<option value="">T\u00fcm\u00fc</option>' +
      depoList.map(function(d) { return '<option value="' + d.replace(/"/g,'&quot;') + '"' + (d === curVal ? ' selected' : '') + '>' + d + '</option>'; }).join('');
  }

  // apply depo filter
  if (filterSelect && filterSelect.value) {
    records = records.filter(function(r) { return (r.depoAd || (t('depot') + ' ' + r.depoNo)) === filterSelect.value; });
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
    batchCount.textContent = haccpSelectedIds.size + t('selectedCount');
  } else {
    batchBar.style.display = 'none';
  }

  // header checkbox state
  var allSelected = canEdit && pageRecords.every(function(r) { return haccpSelectedIds.has(r.id); });

  tbody.innerHTML = pageRecords.map(r => {
    var checked = haccpSelectedIds.has(r.id) ? ' checked' : '';
    const depoAd = r.depoAd || (t('depot') + ' ' + r.depoNo);
    const durum = sicaklikDurum(r.sicaklik, depoAd);
    var chkCell = canEdit
      ? '<td><input type="checkbox" class="haccp-select-chk" data-id="' + r.id + '"' + checked + ' onchange="haccpToggleSelect(' + r.id + ')" style="cursor:pointer"></td>'
      : '<td></td>';
    var actionCell = canEdit
      ? '<td>' +
        '<button class="btn-icon" onclick="editHaccpRecord(\'sicaklik\',' + r.id + ')" title="DÃ¼zenle">' +
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
      <td>${r.saat || 'â€”'}</td>
      <td>${depoAd}</td>
      <td class="${durum.cls}"><strong>${r.sicaklik != null && !isNaN(r.sicaklik) ? Number(r.sicaklik).toLocaleString('tr-TR', {minimumFractionDigits:1,maximumFractionDigits:1}) : 'â€”'}</strong></td>
      <td>${r.nem != null && r.nem !== '' && !isNaN(r.nem) ? Number(r.nem).toLocaleString('tr-TR', {minimumFractionDigits:0,maximumFractionDigits:1}) : 'â€”'}</td>
      <td>${r.not || 'â€”'}</td>
      ${actionCell}
    </tr>`;
  }).join('');

  // update header checkbox
  var headerChk = document.getElementById('haccpSelectAllChk');
  if (headerChk) { headerChk.checked = allSelected; headerChk.disabled = !canEdit; }

  if (nav) {
    nav.style.display = totalPages > 1 ? 'block' : 'none';
    document.getElementById('haccpSicaklikPageInfo').textContent = t('pageRecords') + (haccpSicaklikPage + 1) + ' / ' + totalPages + ' (' + records.length + t('recordCount');
    document.getElementById('haccpSicaklikPrevBtn').disabled = haccpSicaklikPage === 0;
    document.getElementById('haccpSicaklikNextBtn').disabled = haccpSicaklikPage >= totalPages - 1;
  }
}

function haccpSicaklikPrint() {
  var records = getHaccpRecords('sicaklik');
  var filter = document.getElementById('haccpSicaklikDepoFilter');
  var depo = filter ? filter.value : '';
  if (depo) records = records.filter(function(r) { return (r.depoAd || (t('depot') + ' ' + r.depoNo)) === depo; });
  var tarihBas = document.getElementById('haccpSicaklikTarihBas');
  var tarihBit = document.getElementById('haccpSicaklikTarihBit');
  if (tarihBas && tarihBas.value) records = records.filter(function(r) { return r.tarih >= tarihBas.value; });
  if (tarihBit && tarihBit.value) records = records.filter(function(r) { return r.tarih <= tarihBit.value; });
  records.sort(function(a, b) {
    if (a.tarih !== b.tarih) return a.tarih > b.tarih ? -1 : 1;
    return (a.saat || '') > (b.saat || '') ? -1 : 1;
  });
  var rows = records.map(function(r) {
    var da = r.depoAd || (t('depot') + ' ' + r.depoNo);
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
  if (tarihBas && tarihBas.value) tarihEtiketi += ' ' + tarihBas.value + ' â€”';
  if (tarihBit && tarihBit.value) tarihEtiketi += ' ' + tarihBit.value;
  if (tarihEtiketi) tarihEtiketi = t('dateRangeLabel') + tarihEtiketi;
  win.document.write('<p>' + (depo || t('allDepots')) + tarihEtiketi + ' &mdash; ' + records.length + ' kay\u0131t</p>');
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
    records = records.filter(function(r) { return (r.depoAd || (t('depot') + ' ' + r.depoNo)) === filterSelect.value; });
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
  if (!canEditHaccpRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (haccpSelectedIds.size === 0) { showToast(t('noSelectedRecord'), 'error'); return; }
  if (!confirm(t('deleteSelectedConfirm') + haccpSelectedIds.size + t('deleteSelectedConfirmSuffix'))) return;
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
  showToast(t('selectedRecordsDeleted'), 'success');
}

function openHaccpModal(type, id) {
  if (type !== 'sicaklik') return showToast('Sadece sÄ±caklÄ±k kaydÄ± destekleniyor.', 'error');
  if (id) {
    if (!canEditHaccpRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddHaccpRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  }
  editingHaccpType = type;
  editingHaccpId = id || null;

  const overlay = document.getElementById('haccpModal');
  const title = document.getElementById('haccpModalTitle');
  const body = document.getElementById('haccpFormBody');

  title.textContent = t('depotTempRecordTitle');

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
        <div class="form-group"><label>Depo AdÄ±</label><select id="hfDepoAd" required style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px">${depoOptions}</select></div>
        <div class="form-group"><label>SÄ±caklÄ±k (Â°C)</label><input type="number" id="hfSicaklik" step="0.1" value="${rec ? rec.sicaklik : ''}" placeholder="0.0 (boÅŸ bÄ±rakÄ±labilir)" /></div>
        <div class="form-group"><label>Nem (%)</label><input type="number" id="hfNem" step="0.1" value="${rec ? (rec.nem ?? '') : ''}" placeholder="50" /></div>
        <div class="form-group" style="grid-column:span 2"><label>Not</label><input type="text" id="hfNot" value="${rec ? (rec.not || '') : ''}" placeholder="Ä°steÄŸe baÄŸlÄ±" /></div>
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
    if (!canEditHaccpRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddHaccpRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
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
    showToast('KayÄ±t gÃ¼ncellendi.', 'success');
  } else {
    haccpRecords.push(rec);
    showToast('KayÄ±t eklendi.', 'success');
  }

  saveHaccpData();
  renderHaccp();
  closeHaccpModal();
}

function editHaccpRecord(type, id) {
  openHaccpModal(type, id);
}

async function deleteHaccpRecord(type, id) {
  if (!canEditHaccpRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (!confirm(t('deleteConfirm'))) return;
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
  showToast(t('recordDeleted'), 'success');
}



function exportChartsPDF() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  const printWin = window.open('', '_blank', 'width=1100,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatÄ±n.', 'error'); return; }
  // Canvas'larÄ± resim'e Ã§evir
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
    <meta charset="UTF-8"><title>Grafikler - AtÄ±k Kontrol</title>
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
    <h1>Grafikler - AtÄ±k Kontrol YÃ¶netim Sistemi</h1>
    <div class="date">${new Date().toLocaleDateString('tr-TR')}</div>
    ${chartsHtml}
    <div class="footer">AtÄ±k Kontrol YÃ¶netim Sistemi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
  </body></html>`);
  printWin.document.close();
  printWin.focus();
  triggerPrint(printWin);
}

// â”€â”€â”€ GRAFÄ°K YARDIMCILARI & WORD'E AKTARMA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  const sections = [
    { sel: '#content-charts', label: 'AylÄ±k Grafikler' },
    { sel: '#content-yillik', label: 'YÄ±llÄ±k Grafikler' },
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
      // Word CSS'i gÃ¼venilir uygulamadigi icin resimlere acik width/height veriyoruz (A4 yatay sayfaya sigacak)
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
  if (!hadAny) { showToast('DÄ±ÅŸa aktarÄ±lacak dolu grafik bulunamadÄ±.', 'error'); return; }

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
    '<p class="tarih">AtÄ±k Kontrol YÃ¶netim Sistemi &bull; ' + bugun + '</p>' +
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
  showToast(idx + ' grafik Word belgesine aktarÄ±ldÄ±.', 'success');
}

function exportYillikPDF() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  const printWin = window.open('', '_blank', 'width=1100,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatÄ±n.', 'error'); return; }
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
    <meta charset="UTF-8"><title>YÄ±llÄ±k KarÅŸÄ±laÅŸtÄ±rma - AtÄ±k Kontrol</title>
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
    <h1>YÄ±llÄ±k KarÅŸÄ±laÅŸtÄ±rma - AtÄ±k Kontrol YÃ¶netim Sistemi</h1>
    <div class="date">${new Date().toLocaleDateString('tr-TR')}</div>
    ${html}
    <div class="footer">AtÄ±k Kontrol YÃ¶netim Sistemi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
  </body></html>`);
  printWin.document.close();
  printWin.focus();
  triggerPrint(printWin);
}

function exportDashboardPDF() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  const printWin = window.open('', '_blank', 'width=1100,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatÄ±n.', 'error'); return; }
  const content = document.getElementById('content-dashboard');
  const kpiHtml = content.querySelector('.kpi-grid').outerHTML;
  const weeklyHtml = content.querySelector('.weekly-summary') ? content.querySelector('.weekly-summary').outerHTML : '';
  const cardsHtml = [...content.querySelectorAll(':scope > .section-card')].map(c => c.outerHTML).join('');
  printWin.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>Pano - AtÄ±k Kontrol</title>
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
    <h1>KÄ±rÅŸehir Ahi Evran Ãœniversitesi - Beslenme Hizmetleri YÃ¶netim Sistemi</h1>
    <div class="date">${new Date().toLocaleDateString('tr-TR')}</div>
    ${kpiHtml}
    ${weeklyHtml}
    ${cardsHtml}
    <div class="footer">KÄ±rÅŸehir Ahi Evran Ãœniversitesi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
  </body></html>`);
  printWin.document.close();
  printWin.focus();
  triggerPrint(printWin);
}

function exportRecordsPDF() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  const printWin = window.open('', '_blank', 'width=1100,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatÄ±n.', 'error'); return; }
  const tableHtml = document.querySelector('#content-records .table-wrapper')?.outerHTML || '<p>KayÄ±t yok</p>';
  printWin.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>KayÄ±tlar - AtÄ±k Kontrol</title>
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
    <h1>TÃ¼m KayÄ±tlar</h1>
    <div class="date">${new Date().toLocaleDateString('tr-TR')}</div>
    ${tableHtml}
    <div class="footer">AtÄ±k Kontrol YÃ¶netim Sistemi &bull; ${new Date().toLocaleDateString('tr-TR')}</div>
  </body></html>`);
  printWin.document.close();
  printWin.focus();
  triggerPrint(printWin);
}

// â”€â”€â”€ TABS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ SIDEBAR TOGGLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
// â”€â”€â”€ MODAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function openModal(id = null) {
  if (!canAddRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  editingId = id;
  formModified = false;
  const overlay = document.getElementById('modalOverlay');
  const title = document.getElementById('modalTitle');
  const submitBtn = document.getElementById('formSubmitBtn');

  document.getElementById('entryForm').reset();

  if (id !== null) {
    const rec = records.find(r => r.id === id);
    if (!rec) return;
    title.textContent = t('editRecord');
    submitBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>${t('btnUpdate')}`;
    populateForm(rec);
  } else {
    title.textContent = t('addRecord');
    submitBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>${t('btnSave')}`;
    document.getElementById('fTarih').value = formatLocalDate(new Date());
    // Yemekhanede Ã‡alÄ±ÅŸan Personel SayÄ±sÄ±: son kayÄ±tta kullanÄ±lan deÄŸer otomatik dolar, elle deÄŸiÅŸtirilebilir
    const fPersonelEl = document.getElementById('fPersonel');
    if (fPersonelEl) {
      const sonPersonel = localStorage.getItem('atik_kontrol_son_personel');
      if (sonPersonel !== null) fPersonelEl.value = sonPersonel;
      autoCalcGecis();
    }
  }

  // Porsiyon: yeni kayÄ±tta sabit (400), dÃ¼zenlemede deÄŸiÅŸtirilebilir (eski hatalarÄ± dÃ¼zeltmek iÃ§in)
  const fPorsiyonEl = document.getElementById('fPorsiyon');
  const fPorsiyonBadge = document.getElementById('fPorsiyonBadge');
  if (fPorsiyonEl) {
    if (id !== null) {
      fPorsiyonEl.readOnly = false;
      fPorsiyonEl.classList.remove('readonly-input');
      fPorsiyonEl.oninput = autoCalcAtik;
      if (fPorsiyonBadge) fPorsiyonBadge.textContent = t('editable');
    } else {
      fPorsiyonEl.readOnly = true;
      fPorsiyonEl.classList.add('readonly-input');
      fPorsiyonEl.oninput = null;
      if (fPorsiyonBadge) fPorsiyonBadge.textContent = t('fixed');
    }
  }

  // Form deÄŸiÅŸiklik izleme
  document.querySelectorAll('#entryForm input').forEach(el => {
    el.addEventListener('input', () => { formModified = true; }, { once: true });
  });

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  if (formModified && !confirm(t('unsavedConfirm'))) return;
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

// â”€â”€â”€ AUTO CALC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function autoCalc() {
  const yemek = parseFloat(document.getElementById('fYemek').value) || 0;
  document.getElementById('fFire').value = (yemek * 0.9).toFixed(2);
  autoCalcGecis();
}

function autoCalcGecis() {
  const turnike = parseInt(document.getElementById('fTurnike').value) || 0;
  const personel = parseInt(document.getElementById('fPersonel').value) || 0;
  // Toplam GeÃ§iÅŸ = Turnike + Personel (iÃ§ personel dahil, Ã¶ÄŸrenci ayrÄ± kolon)
  document.getElementById('fToplam').value = turnike + personel;
  autoCalcAtik();
}

function autoCalcAtik() {
  const yemek   = parseFloat(document.getElementById('fYemek').value)  || 0;
  const fire    = parseFloat(document.getElementById('fFire').value)   || 0;
  const toplam  = parseInt(document.getElementById('fToplam').value)   || 0;
  const porsiyon = parseInt(document.getElementById('fPorsiyon').value) || 0;
  // FormÃ¼l: (FireMiktarÄ± - ToplamGeÃ§iÅŸ) x Porsiyon / 1000
  // Ã–rnek: fire=495, toplam=443, porsiyon=400 â†’ (495-443)*400/1000 = 20,80 kg
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

// â”€â”€â”€ DEFERRED RENDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function scheduleRender() {
  setTimeout(function() {
    try { renderAll(); } catch (e) { console.warn('renderAll:', e); }
  }, 50);
  setTimeout(function() {
    try { drawAllCharts(); } catch (e) { console.warn('drawAllCharts:', e); }
  }, 100);
}

// â”€â”€â”€ SAVE / UPDATE RECORD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function saveRecord(e) {
  if (!canAddRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  e.preventDefault();

  const fYemek = document.getElementById('fYemek');
  const fTurnike = document.getElementById('fTurnike');
  const fPersonel = document.getElementById('fPersonel');
  const fPorsiyon = document.getElementById('fPorsiyon');
  const fOgrenci = document.getElementById('fOgrenci');
  const errors = [];
  if (parseFloat(fYemek.value) < 0) errors.push(t('negMeals'));
  if (parseInt(fTurnike.value) < 0) errors.push(t('negTurnstile'));
  if (parseInt(fPersonel.value) < 0) errors.push(t('negStaff'));
  if (parseInt(fPorsiyon.value) < 0) errors.push(t('negPortion'));
  if (parseInt(fOgrenci.value) < 0) errors.push(t('negStudent'));
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
    // Yemekhanede Ã§alÄ±ÅŸan personel sayÄ±sÄ±nÄ± sonraki kayÄ±tlar iÃ§in otomatik doldurmak Ã¼zere sakla
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
      showToast(t('recordUpdated'), 'success');
      logIslem('kayit_duzenle', 'yemek #' + savedEditingId + ' gÃ¼ncellendi');
    } else {
      records.push(rec);
      showToast(t('recordAdded'), 'success');
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

// â”€â”€â”€ DELETE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function deleteRecord(id) {
  if (!canAddRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (!confirm(t('deleteConfirm'))) return;
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
    showToast(t('recordDeleted'), 'success');
    logIslem('kayit_sil', 'yemek #' + id + ' silindi');
  } catch (e) {
    showToast('Hata: ' + e.message, 'error');
  }
}

// â”€â”€â”€ SORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    th.innerHTML = th.innerHTML.replace(/ ?[â–²â–¼]?$/, '') + (f === sortField ? (sortDir === -1 ? ' â–¼' : ' â–²') : '');
  });
}

// â”€â”€â”€ PAGINATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  html += `<span class="page-total">${filteredRecords.length} kayÄ±t</span>`;
  container.innerHTML = html;
}

// â”€â”€â”€ BULK DELETE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    count.textContent = selectedIds.size + t('selected');
  } else {
    bar.style.display = 'none';
  }
}

function deleteSelected() {
  if (!canAddRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (selectedIds.size === 0) {
    showToast(t('noSelectedRecord'), 'error');
    return;
  }
  if (!confirm('SeÃ§ili ' + selectedIds.size + ' kaydÄ± silmek istediÄŸinize emin misiniz?')) return;
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
    showToast(t('selectedRecordsDeleted'), 'success');
  } catch (e) {
    showToast('Hata: ' + e.message, 'error');
  }
}

// â”€â”€â”€ IMPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€â”€ CSV YARDIMCILARI (TÃ¼rkÃ§e format: tÄ±rnaklÄ± alan, binlik nokta, ondalÄ±k virgÃ¼l) â”€â”€
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
  return String(s).toLocaleLowerCase('tr').replace(/[^a-zÃ§ÄŸÄ±Ã¶ÅŸÃ¼0-9]/g, '');
}

function mapCsvHeader(h) {
  const k = _csvNormKey(h);
  if (!k) return '';
  if (/tarih|tarÄ±h/.test(k)) return 'tarih';
  if (/Ã¶ÄŸr|ogrenci|Ã¶ÄŸrenci/.test(k)) return 'ogrenci';
  if (/tÃ¼r[Ã¼u]|ad[Ä±i]$/.test(k)) return 'yemek_adi';
  if (/fire/.test(k)) return 'fire';
  if (/turnike/.test(k)) return 'turnike';
  if (/porsiyon/.test(k)) return 'porsiyon';
  if (/atÄ±k|atik/.test(k)) return 'atik';
  if (/harcama/.test(k)) return 'harcama_tutari';
  if (/personel|pers/.test(k)) return 'personel';
  if (/toplam/.test(k)) return 'toplam';
  if (/Ã¼retilen|uretilen|Ã¼retim|uretim/.test(k)) return 'yemek';
  return '';
}

function parseTrNum(v) {
  if (v === undefined || v === null) return 0;
  let s = String(v).trim();
  if (!s || s === '-') return 0;
  const neg = /^-/.test(s);
  s = s.replace(/^-/, '').replace(/[^\d.,]/g, '');
  // 1.283 veya 1.283,50 -> binlik ayraÃ§ noktalarÄ±nÄ± kaldÄ±r
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
        if (rows.length < 2) throw new Error('CSV en az 2 satÄ±r olmalÄ± (baÅŸlÄ±k + veri)');
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
        throw new Error('Desteklenen dosya tÃ¼rleri: .csv, .json');
      }
      if (imported.length === 0) {
        showToast('Ä°Ã§e aktarÄ±lacak geÃ§erli kayÄ±t bulunamadÄ±.', 'error');
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
        showToast(yeniKayitlar.length + ' kayÄ±t eklendi' + (atlanan > 0 ? ' (' + atlanan + ' kayÄ±t zaten mevcut, atlandÄ±)' : '') + '.', 'success');
      } else {
        showToast('TÃ¼m kayÄ±tlar zaten mevcut, hiÃ§bir ÅŸey eklenmedi.', 'error');
      }
    } catch (err) {
      showToast('Ä°Ã§e aktarma hatasÄ±: ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

// â”€â”€â”€ DATA MANAGEMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function clearAllData() { if (!requireAdmin()) return;
  if (records.length === 0) {
    showToast(t('noRecordToDelete'), 'error');
    return;
  }
  if (!confirm(t('deleteAllConfirm'))) return;
  if (!confirm('Son bir kez daha: TÃ¼m veriler silinsin mi?')) return;
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
  showToast(t('allRecordsDeleted'), 'success');
}

function exportData() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  exportDataJSON();
}

function exportDataJSON() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (records.length === 0) {
    showToast('DÄ±ÅŸa aktarÄ±lacak kayÄ±t yok.', 'error');
    return;
  }
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `atik_kontrol_${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('JSON dosyasÄ± indirildi.', 'success');
}

function exportDataCSV() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (records.length === 0) { showToast('DÄ±ÅŸa aktarÄ±lacak kayÄ±t yok.', 'error'); return; }
  var showHarcama = canSeeHarcama();
  var headers = ['Tarih','Ãœretilen Yemek SayÄ±sÄ±','%10 Fire','Turnike GeÃ§iÅŸ SayÄ±sÄ±','Yemekhanede Ã‡alÄ±ÅŸan Personel SayÄ±sÄ±','Toplam GeÃ§iÅŸ','Porsiyon MiktarÄ± (gr)','AtÄ±k MiktarÄ± (kg)','Yemek Hiz. Yar. Ã–ÄŸr. SayÄ±sÄ±','Yemek AdÄ±'];
  if (showHarcama) headers.splice(9, 0, 'Harcama TutarÄ± (â‚º)');
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
  showToast('CSV dosyasÄ± indirildi.', 'success');
}

function exportAllCSV() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
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
      if (done === total) showToast('TÃ¼m CSV dosyalarÄ± indirildi.', 'success');
    }, i * 500);
  });
}

var exportRunning = false;
function exportDelay(ms) { return new Promise(function(res) { setTimeout(res, ms); }); }

async function exportEverything() {
  if (exportRunning) return;
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  exportRunning = true;
  showToast('TÃ¼m veriler indiriliyor...', 'info');
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
  showToast('TÃ¼m veriler indirildi.', 'success');
}

function exportDataSettings() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
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
  showToast('TÃ¼m veriler dÄ±ÅŸa aktarÄ±ldÄ±.', 'success');
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
        showToast('GeÃ§ersiz yedek dosyasÄ±.', 'error');
        return;
      }
      if (!confirm(`${data.records.length} kayÄ±t iÃ§e aktarÄ±lsÄ±n mÄ±? Mevcut kayÄ±tlar korunacak.`)) return;
      const existingIds = new Set(records.map(r => r.id));
      const newRecords = data.records.filter(r => r.id && !existingIds.has(r.id));
      records.push(...newRecords);
      records.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
      saveData();
      filteredRecords = [...records];
      renderAll();
      drawAllCharts();
      showToast(`${newRecords.length} kayÄ±t iÃ§e aktarÄ±ldÄ±.`, 'success');
    } catch (err) {
      showToast('Yedek yÃ¼kleme hatasÄ±: ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

// â”€â”€â”€ RENDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ DAILY DETAIL PANEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    '<div class="ws-card ws-purple"><div class="ws-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg></div><div class="ws-card-content"><span class="ws-label">' + t('wsWastedPortion') + '</span><span class="ws-value" style="color:#ef4444">' + copPorsiyon.toFixed(0) + ' ' + t('wsPortion') + '</span><span class="ws-sub" style="font-size:0.58rem">' + atik.toFixed(1) + ' Ã— 1000 Ã· ' + porsiyon + ' = ' + copPorsiyon.toFixed(0) + '</span></div></div>';
}

// â”€â”€â”€ WEEKLY SUMMARY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  badge.textContent = fmtDateShort(mon) + ' â€” ' + fmtDateShort(sun);

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
  rangeEl.textContent = `${records.length} ${t('dataInfoRecord')} â€¢ ${fmt(first)} â€” ${fmt(last)} â€¢ ${totalYemek.toLocaleString('tr-TR')} ${t('dataInfoProduction')} â€¢ ${totalAtik.toFixed(1)} kg ${t('dataInfoWaste')}`;
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
  el.innerHTML = `<span style="color:${cls};font-size:0.75rem;font-weight:600">${up ? 'â–²' : 'â–¼'} %${Math.abs(pct).toFixed(1)}</span>`;
}
function renderKPIs() {
  const n = records.length;
  document.getElementById('kpiTotalRecords').textContent = n;

  if (n === 0) {
    document.getElementById('kpiAvgAtik').textContent = '0';
    document.getElementById('kpiLastGecis').textContent = '0';
    document.getElementById('kpiTotalAtik').textContent = '0';
    document.getElementById('kpiBugunYemek').textContent = 'â€”';
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

  // BugÃ¼nkÃ¼ Ãœretim
  const todayStr = formatLocalDate(new Date());
  const todayRec = records.find(r => r.tarih === todayStr);
  const elBugunYemek = document.getElementById('kpiBugunYemek');
  const elBugunYemekSub = document.getElementById('kpiBugunYemekSub');
  if (todayRec) {
    elBugunYemek.textContent = (todayRec.yemek || 0).toLocaleString('tr-TR');
    elBugunYemekSub.textContent = t('kpiBeneficiary') + (todayRec.toplam || 0).toLocaleString('tr-TR');
  } else {
    elBugunYemek.textContent = 'â€”';
    elBugunYemekSub.textContent = t('kpiNoRecordToday');
  }

  // HACCP Alarm: son 24 saatteki uygunsuz sÄ±caklÄ±klar
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
    alarmSub.innerHTML = '<span style="color:#ef4444;font-weight:600">' + alarmCount + ' ' + t('kpiAlertsCount') + '</span>';
  } else {
    alarmSub.textContent = t('kpiAllValuesOk');
  }

  // Kalibrasyon Alarm: sÃ¼resi dolan veya kalibrasyon yapÄ±lmamÄ±ÅŸ cihazlar
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
      var subTxt = kalibrasyonAlarmSayisi + ' ' + t('kpiDeviceInAlarm');
      if (yakinSayi > 0) subTxt += ', ' + yakinSayi + ' ' + t('kpiApproaching');
      kAlarmSub.innerHTML = '<span style="color:#ef4444;font-weight:600">' + subTxt + '</span>';
    } else {
      var yakinToplam = kalibrasyonCihazlari.filter(function(r) { return getKalibrasyonDurum(r) === 'yakinlasiyor'; }).length;
      if (yakinToplam > 0) {
        kAlarmSub.innerHTML = '<span style="color:#f59e0b;font-weight:600">' + yakinToplam + ' ' + t('kpiDeviceInAlarm') + ' ' + t('kpiApproaching') + '</span>';
      } else {
        kAlarmSub.textContent = t('kpiAllCalibrationsValid');
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
    { label: t('compTotalProduction'), val: thisYemek, prev: lastYemek, unit: ' ' + t('portion'), lower: false, decimals: 0 },
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
    var arrow = diff > 0 ? 'â†‘' : (diff < 0 ? 'â†“' : 'â†’');
    var label = arrow + ' ' + (diff >= 0 ? '+' : '') + diff.toFixed(it.decimals) + it.unit;
    return '<div class="comparison-item">'
      + '<span class="comparison-label">' + it.label + '</span>'
      + '<span class="comparison-old">' + it.prev.toFixed(it.decimals) + it.unit + '</span>'
      + '<span class="comparison-arrow">â†’</span>'
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
    { label: t('compTotalProduction'), val: thisYemek, prev: lastYemek, unit: ' ' + t('portion'), lower: false, decimals: 0 },
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
    var arrow = diff > 0 ? 'â†‘' : (diff < 0 ? 'â†“' : 'â†’');
    var label = arrow + ' ' + (diff >= 0 ? '+' : '') + diff.toFixed(it.decimals) + it.unit;
    return '<div class="comparison-item">'
      + '<span class="comparison-label">' + it.label + '</span>'
      + '<span class="comparison-old">' + it.prev.toFixed(it.decimals) + it.unit + '</span>'
      + '<span class="comparison-arrow">â†’</span>'
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
    { label: t('compTotalProduction'), val: thisYemek, prev: lastYemek, unit: ' ' + t('portion'), lower: false, decimals: 0 },
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
    var arrow = diff > 0 ? 'â†‘' : (diff < 0 ? 'â†“' : 'â†’');
    var label = arrow + ' ' + (diff >= 0 ? '+' : '') + diff.toFixed(it.decimals) + it.unit;
    return '<div class="comparison-item">'
      + '<span class="comparison-label">' + it.label + '</span>'
      + '<span class="comparison-old">' + it.prev.toFixed(it.decimals) + it.unit + '</span>'
      + '<span class="comparison-arrow">â†’</span>'
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
  badge.textContent = anomalyList.length + ' ' + t('abnormalDays');

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
      + '<td>' + (r.yemek_adi || 'â€”') + '</td>'
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
  html += `<span class="page-total">${anomalyList.length} ${t('dataInfoRecord')}</span>`;
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

  badge.textContent = records.length + ' ' + t('dataInfoRecord');

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
  h += '<label style="font-size:0.8rem;color:var(--text-muted);white-space:nowrap">YÄ±l:</label>';
  h += '<select onchange="setRecordsYear(this.value)" style="' + selectStyle + '">';
  h += '<option value="0"' + (Number(recordsYearFilter) === 0 ? ' selected' : '') + '>TÃ¼mÃ¼</option>';
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
    document.getElementById('emptyRecordsMsg').textContent = t('noRecordsToDisplay');
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
        <button class="btn btn-icon" onclick="openModal(${r.id})" title="${t('btnEdit')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-danger" onclick="deleteRecord(${r.id})" title="${t('btnDelete')}">
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
    <td style="color:var(--accent-orange);font-weight:600">${(r.porsiyon > 0 ? (r.atik * 1000 / r.porsiyon) : 0).toFixed(0)} ${t('portion').substring(0,3)}.</td>
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
  // Turnike = Akademik/Ä°dari Personel + Ã–ÄŸrenci â†’ Akademik ve Ä°dari = Turnike âˆ’ Ã–ÄŸrenci
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
    <td style="color:var(--accent-orange);font-weight:600">${(r.porsiyon > 0 ? (r.atik * 1000 / r.porsiyon) : 0).toFixed(0)} ${t('portion').substring(0,3)}.</td>
  </tr>`;
}

// ===== ORTAK KATEGORÄ° YARDIMCILARI =====
var MENU_KATEGORI_SOZLUK = {
  'Et ÃœrÃ¼nleri': ['kÄ±yma', 'kiyma', 'tavuk', 'sÄ±ÄŸÄ±r', 'sigir', 'kuzu', 'balÄ±k', 'balik', 'sucuk', 'sosis', 'pastÄ±rma', 'pastirma', 'jambon', 'antrikot', 'bonfile', 'pirzola', 'kavurma', 'dÃ¶ner', 'doner', 'kÃ¶fte', 'kofte', 'fileto', 'adana', 'urfa', 'dana', 'kuyruk yaÄŸÄ±', 'kuyruk'],
  'SÃ¼t ÃœrÃ¼nleri': ['sÃ¼t', 'sut', 'yoÄŸurt', 'yogurt', 'peynir', 'tereyaÄŸÄ±', 'tereyagi', 'tereyaÄŸ', 'terayaÄŸÄ±', 'tereyag', 'ayran', 'kaÅŸar', 'kasar', 'krema', 'Ã§Ã¶kelek', 'cÃ¶kelek', 'sÃ¼zme', 'kaymak', 'beyaz peynir', 'lor', 'kefir', 'yumurta'],
  'Kuru Bakliyat': ['nohut', 'mercimek', 'fasulye', 'pirinÃ§', 'pirinc', 'bulgur', 'mÄ±sÄ±r', 'misir', 'arpa', 'buÄŸday', 'bugday', 'kuru fasulye', 'maÅŸ', 'barbunya', 'keÅŸkek', 'keskek', 'susam', 'tahin', 'makarna', 'ÅŸehriye', 'sehriye', 'eriÅŸte', 'eriste', 'noodle', 'tel ÅŸehriye', 'yufka', 'un'],
  'Baharatlar': ['tuz', 'kÄ±rmÄ±zÄ± biber', 'pul biber', 'toz biber', 'nane', 'kuru nane', 'taze nane', 'karabiber', 'kimyon', 'kekik', 'sumak', 'zerdeÃ§al', 'tarÃ§Ä±n', 'yenibahar', 'mahlep', 'safran', 'kÃ¶ri', 'hardal', 'vanilya', 'kakule', 'zencefil', 'muskat', 'Ã§Ã¶ven', 'isot', 'tatlÄ± biber', 'acÄ± biber', 'Ã§emen', 'Ã§emenotu', 'rigan', 'reyhan', 'defne yapraÄŸÄ±', 'hing', 'darÃ§Ä±n', 'anason', 'yÄ±ldÄ±z anason', 'karanfil', 'alibiber', 'Ã§am fÄ±stÄ±ÄŸÄ±', 'fÄ±ndÄ±k', 'badem', 'ceviz'],
  'Sebze ve Meyve': ['domates', 'biber', 'Ã§arliston biber', 'kapya biber', 'sivri biber', 'yeÅŸil biber', 'soÄŸan', 'sogan', 'sarÄ±msak', 'patates', 'patlÄ±can', 'salatalÄ±k', 'salatalik', 'salÃ§a', 'salca', 'limon', 'marul', 'Ã§ilek', 'cilek', 'muz', 'portakal', 'elma', 'Ã¼zÃ¼m', 'uzum', 'havuÃ§', 'havuc', 'kabak', 'Ä±spanak', 'ispanak', 'lahana', 'brokoli', 'karnabahar', 'dereotu', 'maydanoz', 'rok', 'tarhun', 'rezene', 'kereviz', 'pÄ±rasa', 'pirasa', 'bezelye', 'mantar', 'kuÅŸkonmaz', 'enginar', 'kuru incir', 'incir', 'kuru kayÄ±sÄ±', 'kayÄ±sÄ±', 'kuru Ã¼zÃ¼m', 'kuru erik', 'erik', 'kiraz', 'viÅŸne', 'nar', 'armut', 'kavun', 'karpuz', 'ananas', 'greyfurt', 'mandalina', 'kivi', 'balkabaÄŸÄ±', 'kestane']
};
var MENU_KATEGORI_SIRASI = ['Et ÃœrÃ¼nleri', 'SÃ¼t ÃœrÃ¼nleri', 'Kuru Bakliyat', 'Baharatlar', 'Sebze ve Meyve', 'DiÄŸer'];
var MENU_KATEGORI_RENKLERI = {
  'Et ÃœrÃ¼nleri': { bg: '#fef2f2', border: '#fca5a5', icon: 'ğŸ¥©', renk: '#dc2626' },
  'SÃ¼t ÃœrÃ¼nleri': { bg: '#eff6ff', border: '#93c5fd', icon: 'ğŸ§€', renk: '#2563eb' },
  'Kuru Bakliyat': { bg: '#fefce8', border: '#fde047', icon: 'ğŸ«˜', renk: '#ca8a04' },
  'Baharatlar': { bg: '#fff7ed', border: '#fdba74', icon: 'ğŸŒ¶ï¸', renk: '#ea580c' },
  'Sebze ve Meyve': { bg: '#f0fdf4', border: '#86efac', icon: 'ğŸ¥¬', renk: '#16a34a' },
  'DiÄŸer': { bg: '#f1f5f9', border: '#94a3b8', icon: 'ğŸ“¦', renk: '#475569' }
};

function menuGetKategori(malzemeAdi) {
  var ad = malzemeAdi.toLowerCase().trim()
    .replace(/[Ä±I]/g, 'Ä±').replace(/Ä°/g, 'i')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (var kategori in MENU_KATEGORI_SOZLUK) {
    var keywords = MENU_KATEGORI_SOZLUK[kategori];
    for (var i = 0; i < keywords.length; i++) {
      var kw = keywords[i].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      var re = new RegExp('(?:^|[\\s,;|/])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[\\s,;|/]|$)');
      if (re.test(ad) || kw === ad) return kategori;
    }
  }
  return 'DiÄŸer';
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
    if (total <= 0) return 'â€”';
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

      html += `<div class="prod-cesit-col prod-cesit-col-c${ci + 1}"><div class="prod-cesit">${ci + 1}. Ã‡eÅŸit: ${escapeHtml(name)}</div>`;

      if (dish && dish.tarif && dish.tarif.length) {
        dish.tarif.forEach((ing, idx) => {
          const miktarKisi = ing.miktar_kisi || ing.miktar || 0;
          const total = miktarKisi * kisi;
          const birim = normBirim(ing.birim);
          const birimLabel = birim === 'gr' ? ' gr' : birim === 'ml' ? ' ml' : birim === 'lt' || birim === 'litre' ? ' lt' : ' ' + birim;
          html += `<div class="prod-ing"><span class="prod-num">${idx + 1}.</span><span class="prod-name">${escapeHtml(ing.malzeme.trim())} <span class="prod-kisi-birim">(${miktarKisi}${birimLabel})</span></span><span class="prod-sep">â€”</span><span class="prod-qty">${fmt(total, birim)}</span></div>`;

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
      html += `<div class="prod-day-total"><div class="prod-day-total-header"><span class="prod-day-total-icon">Î£</span> ${t('stockDeductionList')} â€“ ${d.gun}${gunlukToplam > 0 ? `<span style="margin-left:auto;font-weight:700;font-size:0.88rem;color:var(--accent-cyan)">${t('total')}: ${formatTRY(gunlukToplam)}</span>` : ''}</div><div class="prod-day-total-body">`;
      dayEntries.forEach((e, idx) => {
        const cInfo = e.cesitler > 1 ? ` <span class="prod-kisi-birim">(${e.cesitler} ${t('inVarieties')})</span>` : '';
        var hesapMiktari = (e.birim === 'adet') ? Math.ceil(e.total) : e.total;
        const found = findBirimFiyat(e.ad, e.birim);
        const tutar = birimFiyatTutar(e.ad, e.birim, hesapMiktari);
        const fiyatGoster = found && tutar > 0 ? `<span class="fiyat-badge">${formatTRY(tutar)}</span>` : '';
        html += `<div class="prod-ing"><span class="prod-num">${idx + 1}.</span><span class="prod-name">${escapeHtml(e.ad)}${cInfo}</span><span class="prod-sep">â€”</span><span class="prod-qty">${fmt(e.total, e.birim)}${fiyatGoster}</span></div>`;
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
    if (total <= 0) return 'â€”';
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
    <div class="weekly-total-header">${t('weeklyTotalList')}${haftalikGenelToplam > 0 ? `<span style="margin-left:auto;font-weight:700;font-size:0.9rem;color:var(--accent-cyan)">${t('totalCost')}: ${formatTRY(haftalikGenelToplam)}</span>` : ''}</div>
    <div class="weekly-total-body">`;

  siraliKategoriler.forEach(function(kategori) {
    var items = kategoriler[kategori];
    var renk = MENU_KATEGORI_RENKLERI[kategori] || MENU_KATEGORI_RENKLERI['DiÄŸer'];
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
        <span>${renk.icon}</span> ${tCategory(kategori)} <span style="font-weight:400;font-size:0.75rem;opacity:0.7;margin-left:4px">(${items.length})</span>
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
      html += `<div class="weekly-total-item"><span class="weekly-total-num">${globalIdx}.</span><span class="weekly-total-name">${escapeHtml(e.ad)} <span class="prod-kisi-birim">(${e.miktarKisi}${e.birimLabel})</span></span><span class="weekly-total-sep">â€”</span><span class="weekly-total-qty">${fmtTotal(total, e.birim)}${fiyatGoster}</span></div>`;
    });
    html += '</div></div>';
  });

  html += '</div></div>';
  section.innerHTML = html;
}

// ===== MALÄ° TABLO (HAFTALIK MALÄ°YET Ã–ZETÄ°) =====
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
  html += '<div class="mali-header"><span class="mali-header-icon">â‚º</span><span>' + t('maliTablo') + '</span><span class="mali-header-sub">' + t('maliTabloSubtitle') + '</span>' +
    (eksikSayi > 0 ? '<span class="mali-uyari" title="' + t('maliUnitPriceHint') + '">' + eksikSayi + ' ' + t('maliUnitPriceMissing') + '</span>' : '') +
    '</div>';
  html += '<div class="mali-body">';

  // Ã–zet kartlarÄ±
  html += '<div class="mali-chips">' +
    '<div class="mali-chip mali-chip-vurgu"><div class="mali-chip-label">' + t('weeklyGrandTotal') + '</div><div class="mali-chip-value">' + formatTRY(genelToplam) + '</div></div>' +
    '<div class="mali-chip"><div class="mali-chip-label">' + t('dailyAverage') + '</div><div class="mali-chip-value">' + formatTRY(Math.round(genelToplam / 5 * 100) / 100) + '</div></div>' +
    '<div class="mali-chip"><div class="mali-chip-label">' + t('avgPerPerson') + '</div><div class="mali-chip-value">' + formatTRY(Math.round(kisGun * 100) / 100) + '</div></div>' +
    '<div class="mali-chip"><div class="mali-chip-label">' + t('totalPersonDays') + '</div><div class="mali-chip-value">' + toplamKisiGun + '</div></div>' +
    '</div>';

  // GÃ¼nlÃ¼k maliyet tablosu
  html += '<div class="table-wrapper"><table class="data-table mali-table"><thead><tr>' +
    '<th>' + t('colDay') + '</th><th>' + t('colDate') + '</th><th style="text-align:center">' + t('colPerson') + '</th><th style="text-align:right">' + t('dailyMaterialCost') + '</th><th style="text-align:right">' + t('perPerson') + '</th>' +
    '</tr></thead><tbody>';
  gunVerileri.forEach(function(g) {
    var basi = g.kisi > 0 ? formatTRY(Math.round(g.toplam / g.kisi * 100) / 100) : 'â€”';
    html += '<tr' + (g.aktif ? '' : ' class="mali-pasif"') + '>' +
      '<td><strong>' + escapeHtml(g.gun) + '</strong></td>' +
      '<td>' + tarihFormatla2(g.tarih) + '</td>' +
      '<td style="text-align:center">' + (g.kisi || 'â€”') + '</td>' +
      '<td class="mali-tutar">' + formatTRY(g.toplam) + '</td>' +
      '<td class="mali-tutar-alt">' + basi + '</td></tr>';
  });
  var ortBasi = toplamKisiGun > 0 ? formatTRY(Math.round(kisGun * 100) / 100) : 'â€”';
  html += '</tbody><tfoot><tr class="mali-toplam-row">' +
    '<td colspan="2"><strong>' + t('weeklyTotal') + '</strong></td>' +
    '<td style="text-align:center"><strong>' + toplamKisiGun + '</strong></td>' +
    '<td class="mali-tutar"><strong>' + formatTRY(genelToplam) + '</strong></td>' +
    '<td class="mali-tutar-alt"><strong>' + ortBasi + '</strong></td></tr></tfoot></table></div>';

  // Kategori daÄŸÄ±lÄ±mÄ±
  var katSirali = MENU_KATEGORI_SIRASI.filter(function(k) { return katAgg[k] && katAgg[k] > 0; });
  if (katSirali.length) {
    html += '<div class="mali-kat-baslik">' + t('categoryDistribution') + '</div>';
    html += '<div class="mali-kat-liste">';
    katSirali.forEach(function(kat) {
      var renk = MENU_KATEGORI_RENKLERI[kat] || MENU_KATEGORI_RENKLERI['DiÄŸer'];
      var tutar = katAgg[kat];
      var pctRaw = genelToplam > 0 ? Math.round(tutar / genelToplam * 100) : 0;
      var yuzde = Math.max(2, Math.min(100, pctRaw));
      html += '<div class="mali-kat-row">' +
        '<span class="mali-kat-icon" style="background:' + renk.bg + ';color:' + renk.renk + '">' + renk.icon + '</span>' +
        '<span class="mali-kat-ad" style="color:' + renk.renk + '">' + escapeHtml(tCategory(kat)) + '</span>' +
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
  if (!str) return 'â€”';
  var p = str.split('.');
  if (p.length !== 3) return escapeHtml(str);
  var ay = t('month' + (parseInt(p[1], 10) || 1));
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
      var hasMojibake = /[ÃƒÃ¢â‚¬â‚¬Å¸Å’Å½Å¡Å¾]/.test(text) || /\?EHR|ORUM/.test(text);
      if (hasMojibake && !text.includes('Å')) {
        var reader2 = new FileReader();
        reader2.onload = function(ev2) {
          try { processYemekCSV(ev2.target.result.replace(/^\uFEFF/, '')); }
          catch(e2) { showToast('CSV iÅŸleme hatasÄ±: ' + e2.message, 'error'); }
        };
        reader2.readAsText(file, 'ISO-8859-9');
        return;
      }
      processYemekCSV(text.replace(/^\uFEFF/, ''));
    } catch(e) { showToast('CSV okuma hatasÄ±: ' + e.message, 'error'); }
    inputEl.value = '';
  };
  reader.readAsText(file);
  event.target.value = '';
}

function processYemekCSV(text) {
  try {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) throw new Error('CSV boÅŸ');
    const headers = parseCSVLine(lines[0]);
    const adIdx = headers.findIndex(h => /yemek.*ad|adÄ±|^ad$/i.test(h));
    const kaloriIdx = headers.findIndex(h => /kalori|kcal/i.test(h));
    const alerjenIdx = headers.findIndex(h => /alerjen/i.test(h));
    const urunCols = [];
    const miktarCols = [];
    const birimCols = [];
    headers.forEach((h, i) => {
      const m = h.match(/^\s*[Ã¼u]r[Ã¼u]n\s*(\d+)\s*$/i);
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
    showToast(list.length + ' yemek yÃ¼klendi.', 'success');
  } catch (err) {
    showToast('CSV yÃ¼kleme hatasÄ±: ' + err.message, 'error');
  }
}

function exportYemekCSV() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  const list = loadYemekler();
  if (!list || !list.length) { showToast('DÄ±ÅŸa aktarÄ±lacak yemek yok.', 'error'); return; }
  const maxUrun = list.reduce((m, y) => Math.max(m, (y.tarif || []).length), 0);
  const headers = ['Yemek AdÄ±', 'Kalori', 'Alerjen'];
  for (let i = 1; i <= maxUrun; i++) {
    headers.push('ÃœrÃ¼n ' + i, 'Miktar ' + i, 'Birim ' + i);
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

// â”€â”€â”€ YEMEK LISTESI (DISH POOL) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.85rem">"<strong>' + escapeHtml(query) + '</strong>" iÃ§in eÅŸleÅŸen yemek bulunamadÄ±.</div>';
    } else {
      container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.85rem">HenÃ¼z yemek eklenmemiÅŸ. "+ Yeni Yemek" butonuna tÄ±klayarak ekleyin.</div>';
    }
    return;
  }

  container.innerHTML = `<table class="data-table" style="width:100%">
    <thead><tr><th style="width:30%">Yemek AdÄ±</th><th style="width:12%">Kalori</th><th style="width:20%">Alerjen</th><th style="width:50px">ReÃ§ete</th><th style="width:70px">Ä°ÅŸlem</th></tr></thead>
    <tbody>${filtered.map(y => `<tr>
      <td style="max-width:0;overflow:hidden;text-overflow:ellipsis"><strong>${escapeHtml(y.ad)}</strong></td>
      <td style="font-size:0.8rem;white-space:nowrap">${escapeHtml(y.kalori || '')}</td>
      <td style="font-size:0.8rem;color:var(--text-muted);max-width:0;overflow:hidden;text-overflow:ellipsis">${escapeHtml(y.alerjen || '')}</td>
      <td style="text-align:center;white-space:nowrap">${(y.tarif && y.tarif.length) ? `<span title="${y.tarif.length} malzeme" style="cursor:help;font-size:0.75rem;color:var(--accent-cyan)">${y.tarif.length} Ã¼rÃ¼n</span>` : `<span style="font-size:0.7rem;color:var(--text-muted)">â€”</span>`}</td>
      <td style="white-space:nowrap;text-align:center">
        <button class="btn-icon btn-sm" onclick="editYemek('${escapeHtml(y.id)}')" title="DÃ¼zenle">
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
      <td><input type="text" class="yf-malzeme" value="${escapeHtml(t.malzeme)}" placeholder="Malzeme adÄ±" data-idx="${i}" style="width:100%" /></td>
      <td style="width:80px"><input type="number" class="yf-miktar" value="${t.miktar_kisi || ''}" step="0.1" min="0" data-idx="${i}" style="width:70px;text-align:center" placeholder="0" /></td>
      <td style="width:60px">
        <select class="yf-birim" data-idx="${i}" style="width:55px;padding:0.3rem;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:0.75rem">
          <option value="gr" ${(t.birim||'gr')==='gr'?'selected':''}>gr</option>
          <option value="adet" ${t.birim==='adet'?'selected':''}>adet</option>
          <option value="lt" ${t.birim==='lt'?'selected':''}>lt</option>
          <option value="ml" ${t.birim==='ml'?'selected':''}>ml</option>
        </select>
      </td>
      <td style="width:30px"><button class="btn-icon btn-sm" onclick="yfTarifSil(${i})" style="color:var(--danger)">âœ•</button></td>
    </tr>
  `).join('');

  container.innerHTML = `<div style="padding:0.75rem;background:var(--bg-card);border-radius:var(--radius-sm);border:1px solid var(--border)">
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:end;margin-bottom:0.75rem">
      <div style="flex:2;min-width:140px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">Yemek AdÄ±</label>
        <input type="text" id="yf_ad" value="${escapeHtml(ad)}" placeholder="Ã–rn: ÅEHRIYE Ã‡ORBASI" style="width:100%" />
      </div>
      <div style="flex:1;min-width:100px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">Kalori</label>
        <input type="text" id="yf_kalori" value="${escapeHtml(kalori)}" placeholder="Ã–rn: 160 KCAL" style="width:100%" />
      </div>
      <div style="flex:1;min-width:120px">
        <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.15rem">Alerjen</label>
        <input type="text" id="yf_alerjen" value="${escapeHtml(alerjen)}" placeholder="Ã–rn: Gluten Ä°Ã§eren TahÄ±llar" style="width:100%" />
      </div>
      <div style="display:flex;gap:0.3rem;align-items:end;padding-bottom:1px">
        <button class="btn btn-primary btn-sm" onclick="saveYemekForm()">Kaydet</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('yemekFormContainer').style.display='none'">Ä°ptal</button>
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

function saveYemekForm() { if (!canEditMenuRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  const ad = document.getElementById('yf_ad').value.trim();
  if (!ad) { showToast('Yemek adÄ± zorunludur.', 'error'); return; }
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

function deleteYemek(id) { if (!canEditMenuRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (!confirm(t('deleteFoodConfirm'))) return;
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
  // Background'da Supabase'ten taze veri Ã§ek (cache gÃ¼ncelle)
  syncDishesFromSupabase().then(updated => { if (updated) renderYemekListesi(); });
}
function closeYemekModal() {
  document.getElementById('yemekModal').classList.remove('open');
}

function exportYemekListesiPDF() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  const list = loadYemekler();
  if (!list || !list.length) {
    showToast('DÄ±ÅŸa aktarÄ±lacak yemek yok.', 'error');
    return;
  }
  const printWin = window.open('', '_blank', 'width=1000,height=800');
  if (!printWin) { showToast('Pop-up engelleyiciyi kapatÄ±n.', 'error'); return; }

  const rowsHtml = list.map(function(y) {
    const tarifHtml = (y.tarif && y.tarif.length)
      ? '<table class="tarif">' + y.tarif.map(function(t) {
          const miktar = Number(t.miktar_kisi) || 0;
          return '<tr><td class="mz">' + escapeHtml(t.malzeme || '') + '</td><td class="mk">' + (miktar ? miktar.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : '') + ' ' + escapeHtml(t.birim || 'gr') + '</td></tr>';
        }).join('') + '</table>'
      : '<div class="tarif-yok">â€”</div>';
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
    '<div class="footer">KÄ±rÅŸehir Ahi Evran Ãœniversitesi &bull; Yemek Listesi &bull; ' + new Date().toLocaleDateString('tr-TR') + '</div>' +
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
      if (error) showToast('MenÃ¼ kaydedilemedi: ' + error.message, 'error');
    }
  } catch (_) { showToast('MenÃ¼ kaydedilemedi (baÄŸlantÄ± hatasÄ±).', 'error'); }
}

// -- Live production refresh --
function refreshMenuProduction() {
  if (!document.getElementById('mk_0')) return; // menÃ¼ henÃ¼z render edilmemiÅŸ
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
  if (typeof val !== 'number' || isNaN(val)) return '0,00 â‚º';
  return val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' â‚º';
}

// â”€â”€â”€ REPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  let html = '<label style="font-size:0.8rem;color:var(--text-muted)">' + t('yearFilterLabel') + '</label>';
  html += '<select onchange="setReportYear(this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;background:var(--bg-card);color:var(--text)">';
  html += '<option value="0"' + (Number(reportYearFilter) === 0 ? ' selected' : '') + '>TÃ¼mÃ¼</option>';
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
      document.getElementById(id).textContent = 'â€”';
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

  // Trend: son 7 gÃ¼n vs Ã¶nceki 7 gÃ¼n
  const sortedByDate = [...data].sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  const last7 = sortedByDate.slice(0, 7);
  const prev7 = sortedByDate.slice(7, 14);
  const avgAtikLast7 = last7.length ? last7.reduce((s, r) => s+(r.atik||0), 0) / last7.length : 0;
  const avgAtikPrev7 = prev7.length ? prev7.reduce((s, r) => s+(r.atik||0), 0) / prev7.length : 0;
  const avgGecisLast7 = last7.length ? last7.reduce((s, r) => s+(r.toplam||0), 0) / last7.length : 0;
  const avgGecisPrev7 = prev7.length ? prev7.reduce((s, r) => s+(r.toplam||0), 0) / prev7.length : 0;
  const trendAtik = avgAtikPrev7 > 0 ? ((avgAtikLast7 - avgAtikPrev7) / avgAtikPrev7 * 100).toFixed(1) : 0;
  const trendGecis = avgGecisPrev7 > 0 ? ((avgGecisLast7 - avgGecisPrev7) / avgGecisPrev7 * 100).toFixed(1) : 0;

  // HaftalÄ±k GeÃ§iÅŸ Hesaplama
  const weeklyGecis = {};
  data.forEach(r => {
    const d = new Date(r.tarih + 'T12:00:00');
    // HaftanÄ±n baÅŸÄ±nÄ± (Pazartesi) bul
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

  let maxWeekLabel = 'â€”';
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
  if (avgPorEl) avgPorEl.innerHTML = t('avgPortion400') + (porsiyonFarklari.length > 0 ? `<span style="display:block;font-size:0.7rem;color:#ef4444;font-weight:600">${porsiyonFarklari.length} ${t('recordsNot400')}</span>` : '');
  document.getElementById('rTotalPorsiyon').textContent = totalPorsiyon.toLocaleString('tr-TR') + ' ' + t('gram');
  document.getElementById('rCopPorsiyon').textContent = copPorsiyon.toFixed(0).toLocaleString('tr-TR') + ' ' + t('portion');
  document.getElementById('rMaxWeekGecis').innerHTML = maxWeekLabel !== 'â€”' ? `${maxWeekLabel} <br><span style="font-size:0.9rem;opacity:0.8;font-weight:normal">(${maxWeekVal.toLocaleString('tr-TR')} ${t('personLabel')})</span>` : 'â€”';
  document.getElementById('rTotalAtik').textContent = totalAtik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' kg';
  document.getElementById('rAvgAtik').textContent = (totalAtik / n).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' kg';
  document.getElementById('rTotalOgrenci').textContent = totalOgrenci.toLocaleString('tr-TR');
  document.getElementById('rMaxAtik').innerHTML = `${maxAtik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg<br><span class="report-subdate">${maxAtikDate}</span>`;
  document.getElementById('rMinAtik').innerHTML = `${minAtik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg<br><span class="report-subdate">${minAtikDate}</span>`;

  // Trend
  const trendAtikEl = document.getElementById('rTrendAtik');
  const trendGecisEl = document.getElementById('rTrendGecis');
  if (trendAtikEl) {
    const sign = trendAtik > 0 ? 'â†‘' : trendAtik < 0 ? 'â†“' : 'â†’';
    const cls = trendAtik > 0 ? 'trend-up' : trendAtik < 0 ? 'trend-down' : 'trend-flat';
    trendAtikEl.innerHTML = `<span class="${cls}">${sign} %${Math.abs(trendAtik)}</span><span class="report-subdate">${t('last7RecordsPrev7')}</span>`;
  }
  if (trendGecisEl) {
    const sign = trendGecis > 0 ? 'â†‘' : trendGecis < 0 ? 'â†“' : 'â†’';
    const cls = trendGecis > 0 ? 'trend-up' : trendGecis < 0 ? 'trend-down' : 'trend-flat';
    trendGecisEl.innerHTML = `<span class="${cls}">${sign} %${Math.abs(trendGecis)}</span><span class="report-subdate">${t('last7RecordsPrev7')}</span>`;
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
    const pct = totalAtik > 0 ? ((g.toplamAtik / totalAtik) * 100).toFixed(1) : 'â€”';
    const kisiBasi = g.toplamGecis > 0 ? (g.toplamAtik / g.toplamGecis).toFixed(3) : 'â€”';
    html += `<tr><td><strong>${g.ad}</strong></td><td>${g.kayitSayisi}</td><td>${g.toplamAtik.toFixed(1)}</td><td>%${pct}</td><td>${kisiBasi}</td></tr>`;
  });
  html += '</tbody></table>';
  body.innerHTML = html;
}

// â”€â”€â”€ CHART UTILITY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fmt(v) {
  // Trailing zero'larÄ± at, tam sayÄ±ysa .00 gÃ¶sterme
  return v.toFixed(2).replace(/\.?0+$/, '');
}

// â”€â”€â”€ CHARTS (Chart.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function renderChartYearFilter() {
  const container = document.getElementById('chartYearFilter');
  if (!container) return;
  const years = getAvailableYears();
  if (years.length > 0 && years.indexOf(Number(chartYearFilter)) === -1) {
    chartYearFilter = String(years[years.length - 1]);
  }
  var html = '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
  html += '<label style="font-size:0.8rem;color:var(--text-muted)">' + t('yearFilterLabel') + '</label>';
  html += '<select onchange="setChartYear(this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;background:var(--bg-card);color:var(--text)">';
  years.forEach(function(y) {
    var sel = chartYearFilter === String(y) ? ' selected' : '';
    html += '<option value="' + y + '"' + sel + '>' + y + '</option>';
  });
  html += '</select>';
  html += '<span style="font-size:0.8rem;color:var(--text-muted);margin-left:4px">' + t('monthFilterLabel') + '</span>';
  var months = [t('filterAll'),t('month1'),t('month2'),t('month3'),t('month4'),t('month5'),t('month6'),t('month7'),t('month8'),t('month9'),t('month10'),t('month11'),t('month12')];
  months.forEach(function(m, i) {
    var active = i === chartMonthFilter ? ' active' : '';
    html += '<button class="year-btn month-btn' + active + '" data-month="' + i + '" onclick="setChartMonth(' + i + ')">' + m + '</button>';
  });
  html += '</div>';
  container.innerHTML = html;
}

// â”€â”€â”€ YILLIK KARÅILAÅTIRMA TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    let h = '<option value=""' + (rawVal === '' ? ' selected' : '') + '>' + t('chartSelectYear') + '</option>';
    years.forEach(function(y) {
      const s = rawVal !== '' && Number(rawVal) === Number(y) ? ' selected' : '';
      const dis = disableVal !== undefined && disableVal !== null && Number(y) === Number(disableVal) ? ' disabled' : '';
      h += '<option value="' + y + '"' + s + dis + '>' + y + '</option>';
    });
    return h;
  }
  const selectStyle = 'padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;background:var(--bg-card);color:var(--text)';
  var html = '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
  html += '<label style="font-size:0.8rem;color:var(--text-muted)">' + t('year1Label') + '</label>';
  html += '<select onchange="setYillikYear(this.value)" style="' + selectStyle + '">' + yearOptions(yillikYearFilter, null) + '</select>';
  html += '<span style="font-size:0.85rem;font-weight:700;color:var(--text-muted)">vs</span>';
  html += '<label style="font-size:0.8rem;color:var(--text-muted)">' + t('year2Label') + '</label>';
  var prevOpts = '<option value=""' + (yillikPrevYearFilter === '' ? ' selected' : '') + '>' + t('noComparison') + '</option>';
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
  var monthLabels = [t('monthShort1'),t('monthShort2'),t('monthShort3'),t('monthShort4'),t('monthShort5'),t('monthShort6'),t('monthShort7'),t('monthShort8'),t('monthShort9'),t('monthShort10'),t('monthShort11'),t('monthShort12')];

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

  // Eski yÄ±llÄ±k grafikleri temizle
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
        center = { arrow: up ? 'â–²' : 'â–¼', arrowColor: up ? cUp : cDn, text: txt, color: up ? cUp : cDn, fontSize: 14 };
      }
    } else if (thisTotal > 0) {
      center = { arrow: 'â—', arrowColor: cUp, text: t('newLabel'), color: cUp, fontSize: 14 };
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
                return ' ' + c.label + ': ' + fmt(c.parsed) + unitLabel + ' Â· %' + p;
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
    container.innerHTML = '<div style="padding:1rem;color:var(--text-muted);text-align:center;font-size:0.85rem">' + (t('emptyDashboard') || 'KayÄ±t bulunamadÄ±.') + '</div>';
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
  h += '<th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border);white-space:nowrap">' + t('thFoodType') + '</th>';
  h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">' + year1 + t('productionLabel') + '</th>';
  h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">' + year1 + t('wasteKgLabel') + '</th>';
  h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">' + year1 + t('wasteGrPortionLabel') + '</th>';
  if (hasComparison) {
    h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">' + year2 + t('productionLabel') + '</th>';
    h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">' + year2 + t('wasteKgLabel') + '</th>';
    h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">' + year2 + t('wasteGrPortionLabel') + '</th>';
    h += '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border);white-space:nowrap">' + t('diffKgLabel') + '</th>';
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
  h += '<td style="padding:8px 10px">' + t('totalRow') + '</td>';
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
        const isTL = ds.label && ds.label.includes('â‚º');
        if (isTL && val === 0) return;
        const display = isTL
          ? val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' â‚º'
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

  // Grafik kartlarÄ±ndaki canlÄ± yÄ±l toplamlarÄ± (veri deÄŸiÅŸtikÃ§e gÃ¼ncellenir)
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
    el.innerHTML = formatter(val) + '<small>' + (label || t('yearTotal')) + '</small>';
  }
  setChartTotal('chartTotalYemek', totYemek, v => Math.round(v).toLocaleString('tr-TR'));
  setChartTotal('chartTotalTurnike', totTurnike, v => Math.round(v).toLocaleString('tr-TR'));
  setChartTotal('chartTotalOgrenci', totOgrenci, v => Math.round(v).toLocaleString('tr-TR'));
  setChartTotal('chartTotalIdariPersonel', totIdariPersonel, v => Math.round(v).toLocaleString('tr-TR'));
  setChartTotal('chartTotalAtik', totAtik, v => v.toLocaleString('tr-TR', { maximumFractionDigits: 1 }));
  setChartTotal('chartTotalFark', totFark, v => (Math.round(v)).toLocaleString('tr-TR'));
  setChartTotal('chartTotalAtikOran', totAtikOran, v => v.toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' %', t('yearAverage'));
  setChartTotal('chartTotalAtikPerKisi', totAtikPerKisi, v => v.toLocaleString('tr-TR', { maximumFractionDigits: 2 }), t('yearAverage'));
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
    // Ã‡Ã¶pe giden porsiyon = atÄ±k kg Ã— 1000 / porsiyon gr
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
    if (Math.abs(top - sum) > 0.5) uyari.push(m + ': GeÃ§iÅŸ=' + top + ' | Ã–ÄŸr+Akd+Ä°dr+Pers=' + sum + ' (fark ' + (top - sum) + ')');
  });
  const fazlaOgrenci = chartRecords.filter(r => (Number(r.ogrenci) || 0) > (Number(r.turnike) || 0))
    .map(r => r.tarih + ' (Turnike:' + r.turnike + ' / Ã–ÄŸr:' + r.ogrenci + ')');
  const uyariEl = document.getElementById('chartAylikUyari');
  if (uyariEl) {
    const lines = [];
    if (uyari.length) lines.push('AylÄ±k uyumsuzluk: ' + uyari.join(' | '));
    if (fazlaOgrenci.length) lines.push('Ã–ÄŸrenci > Turnike olan gÃ¼nler: ' + fazlaOgrenci.join(', '));
    if (lines.length) {
      uyariEl.style.display = 'block';
      uyariEl.textContent = lines.join(' â€” ');
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
  try { makeChart('canvasFark', allMonthLabels, [{ data: farkData, color: '#3b82f6', label: t('chartProductionVsTurnstile') }], { onClick: clickHandler }); } catch(e) { console.warn('chartFark error:', e); }

  const aylikOran = allMonthLabels.map(m => {
    const y = getMonthVal(m, 'yemek'), a = getMonthVal(m, 'atik');
    return y > 0 ? (a * 250 / y) : 0;
  });
  try { makeChart('canvasAtikOran', allMonthLabels, [{ data: aylikOran, color: '#0ea5e9', label: t('chartMonthlyWasteRate') }], { onClick: clickHandler }); } catch(e) { console.warn('chartAtikOran error:', e); }
  try { makeChart('canvasOgrenci', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'ogrenci')), color: '#0ea5e9', label: t('chartMonthlyStudent') }], { onClick: clickHandler }); } catch(e) { console.warn('chartOgrenci error:', e); }
  try { makeChart('canvasIdariPersonel', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'idari') + getMonthVal(m, 'personel')), color: '#0ea5e9', label: t('chartStaffTotal') }], { onClick: clickHandler }); } catch(e) { console.warn('chartIdariPersonel error:', e); }

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
      header.innerHTML = '<h2>' + escapeHtml(ad) + ' - SÄ±caklÄ±k GeÃ§miÅŸi</h2>';
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
      note.textContent = 'HaftalÄ±k ortalama sÄ±caklÄ±k deÄŸerleri â€” alt ve Ã¼st limit Ã§izgileriyle birlikte';
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
        { data: haftaEtiketleri.map(function() { return limits.max; }), color: '#ef4444', label: 'Ãœst Limit (' + (limits.max > 0 ? '+' : '') + limits.max + 'Â°C)', dashed: true },
        { data: haftaEtiketleri.map(function() { return limits.min; }), color: '#3b82f6', label: 'Alt Limit (' + limits.min + 'Â°C)', dashed: true },
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

// â”€â”€â”€ HARCAMA MENÃœSÃœ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    status.textContent = t('registeredRate') + saved.toFixed(2) + ' â‚º' + (oran !== saved ? t('unsavedChanges') : '');
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
    persStatus.textContent = t('registeredRate') + persSaved.toFixed(2) + ' â‚º' + (persOran !== persSaved ? t('unsavedChanges') : '');
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
    yemekStatus.textContent = t('registeredRate') + yemekSaved.toFixed(2) + ' â‚º' + (yemekOran !== yemekSaved ? t('unsavedChanges') : '');
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
    if (!key) return 'â€”';
    const parts = key.split('/');
    return HC_MONTHS_TR[Number(parts[0]) - 1] + ' ' + parts[1];
  };
  const fmtTL = v => v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' â‚º';
  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-icon kpi-cyan">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">${t('kpiTotalStudentSpending')}</span>
        <span class="kpi-value" id="hcTotal">${fmtTL(totalOgrenciHarcama)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-blue">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">${t('kpiTotalStaffSpending')}</span>
        <span class="kpi-value" id="hcPersonelTotal">${fmtTL(totalPersonelHarcama)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-green">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">${t('kpiAvgMonthlyStudentSpending')}</span>
        <span class="kpi-value" id="hcAvg">${fmtTL(avgMonthlyO)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-orange">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">${t('kpiAvgMonthlyStaffSpending')}</span>
        <span class="kpi-value" id="hcPersonelAvg">${fmtTL(avgMonthlyP)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-blue">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">${t('kpiTotalStudents')}</span>
        <span class="kpi-value" id="hcOgrenci">${totalOgrenci.toLocaleString('tr-TR')}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-green">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">${t('kpiTotalStaff')}</span>
        <span class="kpi-value" id="hcPersonel">${totalPersonel.toLocaleString('tr-TR')}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-orange">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">${t('kpiHighestStudentMonth')}</span>
        <span class="kpi-value" id="hcMaxMonth" style="font-size:1.25rem">${monthLabel(maxKeyO)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-purple">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">${t('kpiHighestStaffMonth')}</span>
        <span class="kpi-value" id="hcPersonelMaxMonth" style="font-size:1.25rem">${monthLabel(maxKeyP)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-cyan">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><path d="M6 1v3M10 1v3M14 1v3"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">${t('kpiTotalMealSpending')}</span>
        <span class="kpi-value" id="hcYemekTotal">${fmtTL(totalYemekHarcama)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-green">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">${t('kpiAvgMonthlyMealSpending')}</span>
        <span class="kpi-value" id="hcYemekAvg">${fmtTL(avgMonthlyY)}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-blue">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">${t('kpiTotalMealsProduced')}</span>
        <span class="kpi-value" id="hcYemekAdet">${totalYemek.toLocaleString('tr-TR')}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-orange">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">${t('kpiHighestMealMonth')}</span>
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

  // HiÃ§ kayÄ±t yoksa boÅŸ durumu gÃ¶ster
  const hasAnyDate = records.some(r => { const d = new Date(r.tarih + 'T12:00:00'); return !isNaN(d); });
  if (!hasAnyDate) {
    empty.style.display = 'block';
    canvas.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  canvas.style.display = 'block';

  // SeÃ§ili yÄ±l/aya gÃ¶re aylÄ±k toplamlar
  const active = hcActiveRecords();
  const monthly = {};
  active.forEach(r => {
    const d = new Date(r.tarih + 'T12:00:00');
    if (isNaN(d)) return;
    const m = d.getMonth();
    monthly[m] = (monthly[m] || 0) + (r.ogrenci || 0) * oran;
  });

  // TÃ¼m YÄ±l => 12 ay (boÅŸ aylar 0 ile), belirli ay => tek Ã§ubuk
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
  // KaydÄ±rma iÃ§in kanvas boyutu: 12 ay => geniÅŸ kanvas (yatay kaydÄ±rma Ã§ubuÄŸu gÃ¶rÃ¼nÃ¼r)
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
        label: t('chartStudentSpending'),
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
          callbacks: { label: c => ' ' + c.dataset.label + ': ' + c.parsed.y.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' â‚º' }
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
        label: t('chartStaffSpending'),
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
          callbacks: { label: c => ' ' + c.dataset.label + ': ' + c.parsed.y.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' â‚º' }
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
        label: t('chartMealSpending'),
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
          callbacks: { label: c => ' ' + c.dataset.label + ': ' + c.parsed.y.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' â‚º' }
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
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:1rem">' + t('noRecordsYet') + '</td></tr>';
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
    const tl = v => v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' â‚º';
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
        `<span class="page-total">${sorted.length} kayÄ±t</span>`;
    }
  }
}

// â”€â”€â”€ HARCAMA MENÃœSÃœ NAV (yÄ±l / ay / kaydÄ±rma) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const HC_MONTHS_TR = [t('month1'), t('month2'), t('month3'), t('month4'), t('month5'), t('month6'), t('month7'), t('month8'), t('month9'), t('month10'), t('month11'), t('month12')];

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
  html += '<label style="font-size:0.8rem;color:var(--text-muted)">YÄ±l:</label>';
  html += '<select id="hcYearSelect" onchange="hcSetYearFromSelect()" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;background:var(--bg-card);color:var(--text-primary)">';
  years.forEach(function (y) {
    html += '<option value="' + y + '"' + (hcSelectedYear === y ? ' selected' : '') + '>' + y + '</option>';
  });
  html += '</select>';
  html += '<span style="font-size:0.8rem;color:var(--text-muted);margin-left:4px">Ay:</span>';
  var months = [t('filterAll'), t('month1'), t('month2'), t('month3'), t('month4'), t('month5'), t('month6'), t('month7'), t('month8'), t('month9'), t('month10'), t('month11'), t('month12')];
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
  if (!canEditHarcamaOran()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  const input = document.getElementById('hcOran');
  const val = parseFloat(input && input.value);
  const status = document.getElementById('hcOranStatus');
  if (!status) return;
  if (!val || isNaN(val) || val <= 0) {
    status.textContent = t('invalidRate');
    status.style.color = '#ef4444';
    return;
  }
  setOgrenciBasiHarcamaOrani(val);
  status.textContent = t('rateSaved') + val.toFixed(2) + ' â‚º';
  status.style.color = '#22c55e';
  renderHarcamaMenu();
}

function hcKaydetPersonelOran() {
  if (!canEditHarcamaOran()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  const input = document.getElementById('hcPersonelOran');
  const val = parseFloat(input && input.value);
  const status = document.getElementById('hcPersonelOranStatus');
  if (!status) return;
  if (!val || isNaN(val) || val <= 0) {
    status.textContent = t('invalidRate');
    status.style.color = '#ef4444';
    return;
  }
  setPersonelBasiHarcamaOrani(val);
  status.textContent = t('rateSaved') + val.toFixed(2) + ' â‚º';
  status.style.color = '#22c55e';
  renderHarcamaMenu();
}

function hcKaydetYemekOran() {
  if (!canEditHarcamaOran()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  const input = document.getElementById('hcYemekOran');
  const val = parseFloat(input && input.value);
  const status = document.getElementById('hcYemekOranStatus');
  if (!status) return;
  if (!val || isNaN(val) || val <= 0) {
    status.textContent = t('invalidRate');
    status.style.color = '#ef4444';
    return;
  }
  setUretilenYemekBasiHarcamaOrani(val);
  status.textContent = t('rateSaved') + val.toFixed(2) + ' â‚º';
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
    body.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-dim)">' + t('chartDetailEmpty') + '</div>';
  } else {
    body.innerHTML = `<div style="overflow-x:auto;max-height:400px;overflow-y:auto">
      <table class="data-table" style="min-width:400px">
        <thead><tr><th>${t('formDate')}</th><th>${t('chartColProduction')}</th><th>${t('chartColPasses')}</th><th>${t('chartColWaste')}</th><th>${t('chartColStudent')}</th>${canSeeHarcama() ? '<th>Harcama</th>' : ''}<th>${t('chartColFoodType')}</th></tr></thead>
        <tbody>${records.slice(0, 100).map(r => `<tr>
          <td>${displayDate(r.tarih)}</td>
          <td>${r.yemek || 'â€”'}</td>
          <td>${r.toplam || 'â€”'}</td>
          <td>${(r.atik||0).toFixed(1)}</td>
          <td>${r.ogrenci || 'â€”'}</td>
          ${canSeeHarcama() ? `<td>${Number(r.harcama_tutari || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} â‚º</td>` : ''}
          <td>${r.yemek_adi || 'â€”'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  }
  if (footer) footer.innerHTML = '<button class="btn btn-primary" onclick="closeModal()">' + t('chartClose') + '</button>';
  overlay.style.display = 'flex';
}

// â”€â”€â”€ MENÃœ ONAY AKIÅI (Diyetisyen â†’ GÄ±da MÃ¼hendisi/Admin) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MENU_DURUMLAR = { TASLAK: 'taslak', ONAY_BEKLIYOR: 'onay_bekliyor', ONAYLANDI: 'onaylandi', REDDEDILDI: 'reddedildi' };
let currentMenuDurumMeta = null;

function menuDurumLabel(durum) {
  const m = { taslak: t('menuStatusDraft'), onay_bekliyor: t('menuStatusPending'), onaylandi: t('menuStatusApproved'), reddedildi: t('menuStatusRejected') };
  return m[durum] || t('menuStatusDraft');
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
  if (!canMenuOnayaGonder()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  const ctx = await getCurrentWeekContext();
  const meta = getMenuDurumMeta(ctx.weekData);
  if (meta.durum !== MENU_DURUMLAR.TASLAK && meta.durum !== MENU_DURUMLAR.REDDEDILDI) {
    showToast('MenÃ¼ zaten onay sÃ¼recinde veya onaylanmÄ±ÅŸ. OnayÄ± kaldÄ±rmadan gÃ¶nderemezsiniz.', 'error');
    return;
  }
  const weekData = collectMenuWeekFromDOM();
  weekData._durum = { durum: MENU_DURUMLAR.ONAY_BEKLIYOR, onaylayan: '', onay_tarihi: '', onay_notu: '' };
  ctx.allData[ctx.weekKey] = weekData;
  await saveMenuData(ctx.allData);
  logIslem('menu_onaya_gonder', sessionStorage.getItem('atik_kontrol_display_name') + ' ' + ctx.weekKey + ' menÃ¼sÃ¼nÃ¼ onaya gÃ¶nderdi');
  showToast(t('menuSentForApproval'), 'success');
  await renderMenu();
}

async function menuOnayla() {
  if (!canMenuOnayla()) { showToast('Bu iÅŸlem iÃ§in gÄ±da mÃ¼hendisi veya admin yetkisi gerekli.', 'error'); return; }
  const ctx = await getCurrentWeekContext();
  const meta = getMenuDurumMeta(ctx.weekData);
  if (meta.durum !== MENU_DURUMLAR.ONAY_BEKLIYOR) {
    showToast('Onaylanacak bekleyen menÃ¼ yok (durum: ' + menuDurumLabel(meta.durum) + ').', 'error');
    return;
  }
  const displayName = sessionStorage.getItem('atik_kontrol_display_name') || getRole();
  ctx.weekData._durum = { durum: MENU_DURUMLAR.ONAYLANDI, onaylayan: displayName, onay_tarihi: new Date().toISOString(), onay_notu: '' };
  ctx.allData[ctx.weekKey] = ctx.weekData;
  await saveMenuData(ctx.allData);
  logIslem('menu_onayla', displayName + ' ' + ctx.weekKey + ' menÃ¼sÃ¼nÃ¼ onayladÄ±');
  showToast(t('menuApproved'), 'success');
  await renderMenu();
}

function menuReddet() {
  if (!canMenuReddet()) { showToast('Bu iÅŸlem iÃ§in menÃ¼ reddetme yetkisi gerekli.', 'error'); return; }
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
    showToast('MenÃ¼ bekleyen durumda deÄŸil.', 'error');
    return;
  }
  const displayName = sessionStorage.getItem('atik_kontrol_display_name') || getRole();
  ctx.weekData._durum = { durum: MENU_DURUMLAR.REDDEDILDI, onaylayan: displayName, onay_tarihi: new Date().toISOString(), onay_notu: not };
  ctx.allData[ctx.weekKey] = ctx.weekData;
  await saveMenuData(ctx.allData);
  logIslem('menu_reddet', displayName + ' ' + ctx.weekKey + ' menÃ¼sÃ¼nÃ¼ reddetti: ' + not);
  showToast(t('menuRejectedMsg'), 'success');
  await renderMenu();
}

async function menuOnayGeriCek() {
  if (getRole() !== ROLE_ADMIN) { showToast('Bu iÅŸlem iÃ§in admin yetkisi gerekli.', 'error'); return; }
  if (!confirm('MenÃ¼nÃ¼n onayÄ± kaldÄ±rÄ±lsÄ±n mÄ±? Tekrar dÃ¼zenleme ve onaya gÃ¶nderme mÃ¼mkÃ¼n olacak.')) return;
  const ctx = await getCurrentWeekContext();
  const meta = getMenuDurumMeta(ctx.weekData);
  if (meta.durum !== MENU_DURUMLAR.ONAYLANDI && meta.durum !== MENU_DURUMLAR.ONAY_BEKLIYOR) {
    showToast('OnayÄ± kaldÄ±rÄ±lacak bir durum yok.', 'error');
    return;
  }
  ctx.weekData._durum = { durum: MENU_DURUMLAR.TASLAK, onaylayan: '', onay_tarihi: '', onay_notu: '' };
  ctx.allData[ctx.weekKey] = ctx.weekData;
  await saveMenuData(ctx.allData);
  logIslem('menu_onay_kaldir', sessionStorage.getItem('atik_kontrol_display_name') + ' ' + ctx.weekKey + ' menÃ¼sÃ¼nÃ¼n onayÄ±nÄ± kaldÄ±rdÄ±');
  showToast('Onay kaldÄ±rÄ±ldÄ±, menÃ¼ dÃ¼zenlemeye aÃ§Ä±k.', 'success');
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
      showToast(bekleyen.length + ' haftanÄ±n menÃ¼sÃ¼ onay bekliyor.', 'info');
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
    badgeText += ' Â· ' + durumMeta.onaylayan;
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
      ? t('menuApprove')
      : t('menuApproveDisabled');
  }
  if (rejectBtn) {
    rejectBtn.style.display = canMenuReddet() ? '' : 'none';
    rejectBtn.disabled = durumMeta.durum !== MENU_DURUMLAR.ONAY_BEKLIYOR;
    rejectBtn.title = durumMeta.durum === MENU_DURUMLAR.ONAY_BEKLIYOR
      ? t('menuReject')
      : t('menuRejectDisabled');
  }
  if (withdrawBtn) withdrawBtn.style.display = role === ROLE_ADMIN && (durumMeta.durum === MENU_DURUMLAR.ONAYLANDI || durumMeta.durum === MENU_DURUMLAR.ONAY_BEKLIYOR) ? '' : 'none';

  if (warn) {
    const isApprover = canMenuOnayla();
    const isCurrentPending = durumMeta.durum === MENU_DURUMLAR.ONAY_BEKLIYOR;
    if (isApprover && !isCurrentPending && pendingCount > 0) {
      warn.style.display = '';
      if (warnMetin) warnMetin.textContent = pendingCount + ' haftanÄ±n menÃ¼sÃ¼ onay bekliyor. Bekleyen haftaya gidip onaylayabilirsiniz.';
      if (pendingGoBtn) pendingGoBtn.style.display = '';
    } else {
      if (pendingGoBtn) pendingGoBtn.style.display = 'none';
      if (durumMeta.durum === MENU_DURUMLAR.ONAYLANDI) {
        warn.style.display = 'none';
      } else {
        warn.style.display = '';
        let metin = t('menuNotApproved');
        if (durumMeta.durum === MENU_DURUMLAR.REDDEDILDI) {
          metin = t('menuRejected') + (durumMeta.onaylayan ? ' (' + durumMeta.onaylayan + ')' : '');
          if (durumMeta.onay_notu) metin += ': ' + durumMeta.onay_notu;
          metin += t('menuRejectedSuffix');
        } else if (durumMeta.durum === MENU_DURUMLAR.ONAY_BEKLIYOR) {
          metin = 'Bu menÃ¼ onay bekliyor. Onaylanmadan Ã¼retim listesinde "onaysÄ±z" olarak iÅŸaretlenir.';
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
  const weekLabel = `${formatDateStrTR(monday)} - ${formatDateStrTR(friday)} ${t('menuListTitle')}`;

  document.getElementById('menuWeekLabel').textContent = weekLabel;
  document.getElementById('menuTitle').textContent = weekLabel;

  const allData = await fetchMenuData();
  const weekData = allData[weekKey] || {};
  currentMenuDurumMeta = getMenuDurumMeta(weekData);
  const pendingCount = Object.keys(allData).filter(function(k) {
    return getMenuDurumMeta(allData[k]).durum === MENU_DURUMLAR.ONAY_BEKLIYOR;
  }).length;
  const canEdit = renderMenuDurumBar(currentMenuDurumMeta, pendingCount);

  // GÃ¼n verilerini topla
  const days = getGUNLER().map((gun, i) => {
    const tarih = new Date(monday);
    tarih.setDate(monday.getDate() + i);
    const key = formatDateStr(tarih);
    var dd = weekData[key] || { yemekler: ['','','','',''], kisi: 0, notlar: [] };
    while (dd.notlar.length < 10) dd.notlar.push('');
    const dayData = dd;
    return { gun, key, tarih, data: dayData };
  });

  // BaÅŸlÄ±k satÄ±rÄ±
  const thead = document.getElementById('menuThead');
  thead.innerHTML = `<tr>
    <th style="width:100px">${t('menuVariety')}</th>
    ${days.map(d => `<th>${escapeHtml(d.gun)}<br><span style="display:inline-block;margin-top:0.3rem;font-size:0.74rem;font-weight:800;background:linear-gradient(135deg,var(--accent-purple),var(--accent-cyan));color:#fff;padding:0.18rem 0.65rem;border-radius:999px;box-shadow:0 2px 6px rgba(99,102,241,0.3)">${formatDateStrTR(d.tarih)}</span></th>`).join('')}
  </tr>`;

  // Cache henÃ¼z dolmamÄ±ÅŸsa 500ms sonra tekrar dene
  if (!yemeklerCache.length) {
    if (window._menuRetryTimer) clearTimeout(window._menuRetryTimer);
    window._menuRetryTimer = setTimeout(refreshMenuProduction, 500);
  }

  // GÃ¶vde: her Ã§eÅŸit iÃ§in bir satÄ±r + kiÅŸi sayÄ±sÄ± satÄ±rÄ±
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
  // Not satÄ±rlarÄ±: sadece visibleNoteCount kadar gÃ¶ster
  let visibleNoteCount = window._menuNoteCount || 1;
  // KaydedilmiÅŸ notlar varsa, onlarÄ± da gÃ¶ster
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
    tr.innerHTML = `<td onclick="event.stopPropagation()" onpointerdown="event.stopPropagation()"><strong>${t('noteLabel')}${ni + 1}</strong>
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();removeNoteRow(${ni})" title="${t('deleteNote')}" style="font-size:0.8rem;padding:0 0.3rem;line-height:1;margin-left:4px;color:var(--accent-red);${visibleNoteCount <= 1 ? 'display:none' : ''}">âˆ’</button>
    </td>
      ${days.map((d, di) => {
        const val = escapeHtml((d.data.notlar && d.data.notlar[ni]) || '');
        return `<td onclick="event.stopPropagation()" onpointerdown="event.stopPropagation()"><textarea class="note-input" id="mn_${ni}_${di}" rows="1" placeholder="..." onclick="event.stopPropagation()" onfocus="event.stopPropagation()" onpointerdown="event.stopPropagation()" style="touch-action:manipulation">${val}</textarea></td>`;
      }).join('')}`;
    tbody.appendChild(tr);
  }
  // + butonu satÄ±rÄ±
  let addRow = document.createElement('tr');
  addRow.id = 'noteAddRow';
  addRow.onclick = function(e) { e.stopPropagation(); };
  addRow.innerHTML = `<td style="vertical-align:middle">
    <button class="btn btn-ghost btn-sm" onclick="addNoteRow()" title="${t('addNote')}" style="font-size:1.1rem;padding:0.2rem 0.6rem;line-height:1">+</button>
  </td>
  ${days.map(() => `<td></td>`).join('')}`;
  tbody.appendChild(addRow);
  // yemek seÃ§ici: her hÃ¼creye doÄŸrudan listener + event delegation
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
  // MenÃ¼ kilitliyse dÃ¼zenleme engellensin
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
  if (!list.length) { showToast('Yemek listesi boÅŸ. Ã–nce Yemek Listesi\'ne CSV yÃ¼kleyin.', 'warning'); return; }
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
      <h3 style="font-size:1rem;font-weight:600">${t('mealPickerTitle')}</h3>
      <div style="display:flex;gap:0.5rem;align-items:center">
        <button class="btn btn-sm" style="background:var(--color-danger, #e53e3e);color:#fff;border:none;padding:0.3rem 0.6rem;border-radius:6px;cursor:pointer;font-size:0.78rem" onclick="clearMenuCell()">${t('clearLabel')}</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('mealPickerOverlay').style.display='none'">âœ•</button>
      </div>
    </div>
    <input type="text" id="mealPickerSearch" placeholder="${t('searchMealPlaceholder')}" style="padding:0.5rem;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);margin-bottom:0.75rem" oninput="renderMealPickerList()" />
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
  container.innerHTML = filtered.length ? filtered.map(y => `<div class="meal-picker-item" data-ad="${escapeHtml(y.ad)}" style="padding:0.5rem 0.75rem;cursor:pointer;border-radius:6px;transition:background 0.15s" onclick="selectMealFromPicker(this)" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='transparent'">${escapeHtml(formatYemek(y).replace(/\n/g, '<br>'))}</div>`).join('') : '<div style="padding:1rem;text-align:center;color:var(--text-muted)">' + t('noMatchingMeal') + '</div>';
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

// â”€â”€â”€ MENU HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GUNLER_TR = ['Pazartesi', 'SalÄ±', 'Ã‡arÅŸamba', 'PerÅŸembe', 'Cuma'];
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
  if (role !== ROLE_ADMIN && role !== ROLE_DIYETISYEN) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  const ctx = await getCurrentWeekContext();
  const meta = getMenuDurumMeta(ctx.weekData);
  if (!canMenuDuzenle(meta.durum)) {
    showToast('MenÃ¼ onay sÃ¼recinde; dÃ¼zenlemek iÃ§in Ã¶nce onayÄ± kaldÄ±rÄ±n.', 'error');
    return;
  }
  const weekData = collectMenuWeekFromDOM();
  // Kaydet: durum zaten reddedildiyse gerekÃ§e korunsun, deÄŸilse taslak olarak kaydet
  weekData._durum = meta.durum === MENU_DURUMLAR.REDDEDILDI
    ? { durum: MENU_DURUMLAR.REDDEDILDI, onaylayan: meta.onaylayan, onay_tarihi: meta.onay_tarihi, onay_notu: meta.onay_notu }
    : { durum: MENU_DURUMLAR.TASLAK, onaylayan: '', onay_tarihi: '', onay_notu: '' };
  ctx.allData[ctx.weekKey] = weekData;
  await saveMenuData(ctx.allData);
  showToast(t('menuDraftSaved'), 'success');
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
  tr.innerHTML = `<td><strong>${t('noteLabel')}${ni + 1}</strong>
    <button class="btn btn-ghost btn-sm" onclick="removeNoteRow(${ni})" title="${t('deleteNote')}" style="font-size:0.8rem;padding:0 0.3rem;line-height:1;margin-left:4px;color:var(--accent-red)">âˆ’</button>
  </td>
    ${getGUNLER().map((_, di) => `<td><textarea class="note-input" id="mn_${ni}_${di}" rows="1" placeholder="..." onclick="event.stopPropagation()" onfocus="event.stopPropagation()" onpointerdown="event.stopPropagation()" style="touch-action:manipulation"></textarea></td>`).join('')}`;
  const addRow = document.getElementById('noteAddRow');
  if (addRow) tbody.insertBefore(tr, addRow);
  window._menuNoteCount = ni + 1;
  // Ä°lk not satÄ±rÄ±ndaki eksi butonunu gÃ¶ster (gizliydi)
  const firstRow = document.getElementById('noteRow_0');
  if (firstRow) {
    const btn = firstRow.querySelector('button');
    if (btn) btn.style.display = '';
  }
  showToast(t('noteLabel') + (ni + 1) + ' eklendi.', 'success');
}

function removeNoteRow(ni) {
  if ((window._menuNoteCount || 1) <= 1) return;
  const tbody = document.getElementById('menuTbody');
  // DeÄŸerleri kaydÄ±r: silinen nottan sonrakileri bir Ã¼st satÄ±ra taÅŸÄ±
  for (let n = ni + 1; n < (window._menuNoteCount || 1); n++) {
    getGUNLER().forEach((_, di) => {
      const fromEl = document.getElementById('mn_' + n + '_' + di);
      const toEl = document.getElementById('mn_' + (n - 1) + '_' + di);
      if (fromEl && toEl) toEl.value = fromEl.value;
    });
  }
  // En son satÄ±rÄ± sil
  const lastRow = document.getElementById('noteRow_' + ((window._menuNoteCount || 1) - 1));
  if (lastRow) lastRow.remove();
  window._menuNoteCount--;
  // Sadece 1 not kaldÄ±ysa eksi butonunu gizle
  if (window._menuNoteCount <= 1) {
    const firstRow = document.getElementById('noteRow_0');
    if (firstRow) {
      const btn = firstRow.querySelector('button');
      if (btn) btn.style.display = 'none';
    }
  }
  showToast(t('noteLabel') + (ni + 1) + ' silindi.', 'success');
}

function clearWeeklyMenu() { if (!canEditMenuRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (!confirm('Bu haftanÄ±n menÃ¼sÃ¼nÃ¼ temizlemek istediÄŸinize emin misiniz?')) return;
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
  showToast(t('menuCleared'), 'success');
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
  showToast('MenÃ¼ JSON olarak indirildi.', 'success');
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
      showToast('MenÃ¼ yÃ¼klendi.', 'success');
    } catch (err) {
      showToast('MenÃ¼ yÃ¼kleme hatasÄ±: ' + err.message, 'error');
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
      if (lines.length < 2) throw new Error('CSV en az 2 satÄ±r iÃ§ermelidir (baÅŸlÄ±k + veri)');
      const headers = parseCSVLine(lines[0]);
      // gÃ¼n sÃ¼tunlarÄ±nÄ± bul (Pazartesi, SalÄ±, ...)
      const gunIdxMap = {};
      getGUNLER().forEach((gun, i) => {
        const idx = headers.findIndex(h => h.toLowerCase().includes(gun.slice(0,3).toLowerCase()) || gun.toLowerCase().includes(h.toLowerCase()));
        if (idx !== -1) gunIdxMap[i] = idx;
      });
      if (!Object.keys(gunIdxMap).length) throw new Error('GÃ¼n sÃ¼tunlarÄ± bulunamadÄ± (Pazartesi, SalÄ±, ...)');
      const cesitSatirlari = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
      let kisiSatir = -1;
      for (let r = 1; r < lines.length; r++) {
        const cols = parseCSVLine(lines[r]);
        const ilkHuc = (cols[0] || '').trim().toLowerCase();
        for (let c = 1; c <= 5; c++) {
          if (new RegExp('^\\s*' + c + '\\s*\\.?\\s*Ã§eÅŸit','i').test(ilkHuc) || new RegExp('^\\s*' + c + '\\s*\\.?\\s*cesit','i').test(ilkHuc)) {
            cesitSatirlari[String(c)] = r;
          }
        }
        if (/kiÅŸi|kisi/.test(ilkHuc)) kisiSatir = r;
      }
      // ÅŸu anki gÃ¶rÃ¼nen haftanÄ±n tarihlerini al
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
      showToast('CSV menÃ¼ yÃ¼klendi.', 'success');
    } catch (err) {
      showToast('CSV yÃ¼kleme hatasÄ±: ' + err.message, 'error');
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

// â”€â”€â”€ ATIK YAG (WASTE OIL) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      <span class="report-label">${t('totalRecordCount')}</span>
      <span class="report-value">${adet.toLocaleString('tr-TR')}</span>
    </div>
    <div class="report-item report-item-highlight" style="background: rgba(249,115,22,0.08); border-color: rgba(249,115,22,0.25);">
      <span class="report-label">${t('totalWasteOil')}</span>
      <span class="report-value" style="color:#f97316">${fmt(toplam)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">${t('avgAmountPerRecord')}</span>
      <span class="report-value">${fmt(ort)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">${t('highestAmount')}</span>
      <span class="report-value">${fmt(maxR)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">${t('lowestAmount')}</span>
      <span class="report-value">${fmt(minR)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">${t('oilTypeCount')}</span>
      <span class="report-value">${turler.size.toLocaleString('tr-TR')}</span>
    </div>
  `;
  const simdikiYil = String(new Date().getFullYear());
  yillar.forEach(y => {
    if (y !== simdikiYil) return;
    html += `
    <div class="report-item">
      <span class="report-label">${y}${t('yearTotalSuffix')}</span>
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
    var html = '<option value="">TÃ¼mÃ¼</option>' + years.map(function(y) {
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
      parts.push((bas && bas.value ? displayDate(bas.value) : t('startDate')) + ' â€“ ' + (bit && bit.value ? displayDate(bit.value) : t('endDate')));
    }
    if (tur && tur.value) parts.push(t('typeLabel') + tur.value);
    if (yagSelectedYear) parts.push(t('yearLabel') + yagSelectedYear);
    ozet.textContent = parts.length
      ? t('activeFilterLabel') + parts.join(' Â· ')
      : t('noFilterMessage');
  }
}

function renderYagTable() {
  const tbody = document.getElementById('yagTbody');
  const table = document.getElementById('yagTable');
  const empty = document.getElementById('emptyStateYag');
  const badge = document.getElementById('yagBadge');

  badge.textContent = yagRecords.length + ' ' + t('dataInfoRecord');

  renderYagFilterBar();

  const filtered = getYagFiltered();

  if (yagRecords.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = t('noWasteOilRecord');
    renderYagOzet([]);
    drawYagChart([]);
    return;
  }

  if (filtered.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = t('noMatchingFilterRecord');
    renderYagOzet([]);
    drawYagChart([]);
    return;
  }
  empty.querySelector('p').textContent = t('noWasteOilRecord');

  // FiltrelenmiÅŸ Ã¶zet kartlarÄ±
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
        '<button class="btn-icon" onclick="editYagRecord(' + r.id + ')" title="DÃ¼zenle">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button class="btn-icon" onclick="deleteYagRecord(' + r.id + ')" title="Sil" style="color:var(--danger)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
        '</button>' +
        '</td>'
      : '<td></td>';
    return `<tr>
      <td>${dateStr}</td>
      <td>${escapeHtml(r.makbuzNo || 'â€”')}</td>
      <td>${escapeHtml(r.tur || 'â€”')}</td>
      <td>${(r.miktar || 0).toFixed(1)}</td>
      <td>${escapeHtml(r.not || 'â€”')}</td>
      ${actionCell}
    </tr>`;
  }).join('');

  const pagination = document.getElementById('yagPagination');
  if (pagination) {
    if (totalPages > 1) {
      pagination.innerHTML =
        '<button class="btn-icon" data-yag-page="' + (yagPage - 1) + '"' + (yagPage === 0 ? ' disabled style="opacity:0.4"' : '') + '>â€¹</button>' +
        Array.from({length: totalPages}, function(_, i) {
          return '<button class="btn-icon" data-yag-page="' + i + '"' + (i === yagPage ? ' style="font-weight:700;color:var(--primary)"' : '') + '>' + (i + 1) + '</button>';
        }).join('') +
        '<button class="btn-icon" data-yag-page="' + (yagPage + 1) + '"' + (yagPage >= totalPages - 1 ? ' disabled style="opacity:0.4"' : '') + '>â€º</button>';
    } else {
      pagination.innerHTML = '';
    }
  }

  drawYagChart(filtered);
}

function openYagModal(id) {
  if (id) {
    if (!canEditYagRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddYagRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
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
    title.textContent = t('editWasteOilRecord');
    document.getElementById('yfTarih').value = rec.tarih;
    document.getElementById('yfMakbuz').value = rec.makbuzNo || '';
    document.getElementById('yfTur').value = rec.tur || '';
    document.getElementById('yfMiktar').value = rec.miktar || '';
    document.getElementById('yfNot').value = rec.not || '';
  } else {
    title.textContent = t('newWasteOilRecord');
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
    if (!canEditYagRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddYagRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
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
    showToast('AtÄ±k yaÄŸ kaydÄ± gÃ¼ncellendi.', 'success');
    logIslem('kayit_duzenle', 'yag #' + editingYagId + ' gÃ¼ncellendi');
  } else {
    yagRecords.push(rec);
    showToast('AtÄ±k yaÄŸ kaydÄ± eklendi.', 'success');
    logIslem('yeni_kayit', 'yag ' + (rec.tur || '') + ' ' + rec.miktar + ' lt eklendi');
  }

  saveYagData();
  renderYagTable();
  syncYagSilent();
  closeYagModal();
}

function editYagRecord(id) { openYagModal(id); }

async function deleteYagRecord(id) {
  if (!canEditYagRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (!confirm('Bu atÄ±k yaÄŸ kaydÄ±nÄ± silmek istediÄŸinize emin misiniz?')) return;
  yagRecords = yagRecords.filter(r => r.id !== id);
  saveYagData();
  if (supabaseClient) {
    try { await supabaseClient.from('yag_records').delete().eq('id', id); } catch (_) {}
  }
  renderYagTable();
  syncYagSilent();
  showToast('AtÄ±k yaÄŸ kaydÄ± silindi.', 'success');
  logIslem('kayit_sil', 'yag #' + id + ' silindi');
}

let yagChartInstance = null;
let yagTurChartInstance = null;
let yagSelectedYear = '';

var AYLAR_KISA = [t('monthShort1'), t('monthShort2'), t('monthShort3'), t('monthShort4'), t('monthShort5'), t('monthShort6'), t('monthShort7'), t('monthShort8'), t('monthShort9'), t('monthShort10'), t('monthShort11'), t('monthShort12')];

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
    label: yagSelectedYear ? t('wasteOilChartLabel') + ' ' + yagSelectedYear + ' (lt)' : t('wasteOilChartLabel') + ' (lt)',
    data: values,
    backgroundColor: barColors,
    borderRadius: 4,
    barPercentage: 0.6,
    categoryPercentage: 0.75,
    maxBarThickness: 52
  }];
  if (hasPrev) {
    datasets.push({
      label: t('previousYearLabel') + ' ' + prevYear + ' (lt)',
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
            if (detail.length > 0) showChartDetailModal(AYLAR_KISA[key.m] + ' ' + key.y + ' ' + t('wasteOilChartLabel'), detail);
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
    var tur = r.tur || t('undefinedType');
    totals[tur] = (totals[tur] || 0) + (Number(r.miktar) || 0);
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


// â”€â”€â”€ AMBALAJ ATIKLARI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      <span class="report-label">${t('totalRecordCount')}</span>
      <span class="report-value">${adet.toLocaleString('tr-TR')}</span>
    </div>
    <div class="report-item report-item-highlight" style="background: rgba(16,185,129,0.08); border-color: rgba(16,185,129,0.25);">
      <span class="report-label">${t('totalWastePackaging')}</span>
      <span class="report-value" style="color:#10b981">${fmt(toplam)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">${t('avgAmountPerRecord')}</span>
      <span class="report-value">${fmt(ort)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">${t('highestAmount')}</span>
      <span class="report-value">${fmt(maxR)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">${t('lowestAmount')}</span>
      <span class="report-value">${fmt(minR)}</span>
    </div>
    <div class="report-item">
      <span class="report-label">${t('wasteTypeCount')}</span>
      <span class="report-value">${turler.size.toLocaleString('tr-TR')}</span>
    </div>
  `;
  const simdikiYil = String(new Date().getFullYear());
  yillar.forEach(y => {
    if (y !== simdikiYil) return;
    html += `
    <div class="report-item">
      <span class="report-label">${y}${t('yearTotalSuffix')}</span>
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
    var html = '<option value="">TÃ¼mÃ¼</option>' + years.map(function(y) {
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
      parts.push((bas && bas.value ? displayDate(bas.value) : t('startDate')) + ' â€“ ' + (bit && bit.value ? displayDate(bit.value) : t('endDate')));
    }
    if (tur && tur.value) parts.push(t('typeLabel') + tur.value);
    if (ambalajSelectedYear) parts.push(t('yearLabel') + ambalajSelectedYear);
    ozet.textContent = parts.length
      ? t('activeFilterLabel') + parts.join(' Â· ')
      : t('noFilterMessagePackaging');
  }
}

function renderAmbalajTable() {
  const tbody = document.getElementById('ambalajTbody');
  const table = document.getElementById('ambalajTable');
  const empty = document.getElementById('emptyStateAmbalaj');
  const badge = document.getElementById('ambalajBadge');

  badge.textContent = ambalajRecords.length + ' ' + t('dataInfoRecord');

  renderAmbalajFilterBar();

  const filtered = getAmbalajFiltered();

  if (ambalajRecords.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = t('noWastePackagingRecord');
    renderAmbalajOzet([]);
    drawAmbalajChart([]);
    return;
  }

  if (filtered.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = t('noMatchingFilterPackage');
    renderAmbalajOzet([]);
    drawAmbalajChart([]);
    return;
  }
  empty.querySelector('p').textContent = t('noWastePackagingRecord');

  // FiltrelenmiÅŸ Ã¶zet kartlarÄ±
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
        '<button class="btn-icon" onclick="editAmbalajRecord(' + r.id + ')" title="DÃ¼zenle">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button class="btn-icon" onclick="deleteAmbalajRecord(' + r.id + ')" title="Sil" style="color:var(--danger)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
        '</button>' +
        '</td>'
      : '<td></td>';
    return `<tr>
      <td>${dateStr}</td>
      <td>${escapeHtml(r.tur || 'â€”')}</td>
      <td>${(r.miktar || 0) < 1 && (r.birim || 'kg') === 'kg' ? (r.miktar || 0).toFixed(3) : (r.miktar || 0).toFixed(1)} <span style="font-size:0.7rem;color:var(--text-muted)">${(r.birim || 'kg') === 'g' ? 'gr' : 'kg'}</span></td>
      <td>${escapeHtml(r.not || 'â€”')}</td>
      ${actionCell}
    </tr>`;
  }).join('');

  const pagination = document.getElementById('ambalajPagination');
  if (pagination) {
    if (totalPages > 1) {
      pagination.innerHTML =
        '<button class="btn-icon" data-ambalaj-page="' + (ambalajPage - 1) + '"' + (ambalajPage === 0 ? ' disabled style="opacity:0.4"' : '') + '>â€¹</button>' +
        Array.from({length: totalPages}, function(_, i) {
          return '<button class="btn-icon" data-ambalaj-page="' + i + '"' + (i === ambalajPage ? ' style="font-weight:700;color:var(--primary)"' : '') + '>' + (i + 1) + '</button>';
        }).join('') +
        '<button class="btn-icon" data-ambalaj-page="' + (ambalajPage + 1) + '"' + (ambalajPage >= totalPages - 1 ? ' disabled style="opacity:0.4"' : '') + '>â€º</button>';
    } else {
      pagination.innerHTML = '';
    }
  }

  drawAmbalajChart(filtered);
}

function openAmbalajModal(id) {
  if (id) {
    if (!canEditAmbalajRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddAmbalajRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
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
    title.textContent = t('editWastePackagingRecord');
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
    title.textContent = t('newWastePackagingRecord');
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
    if (!canEditAmbalajRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddAmbalajRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
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
    showToast('Ambalaj atÄ±ÄŸÄ± kaydÄ± gÃ¼ncellendi.', 'success');
    logIslem('kayit_duzenle', 'ambalaj #' + editingAmbalajId + ' gÃ¼ncellendi');
  } else {
    ambalajRecords.push(rec);
    showToast('Ambalaj atÄ±ÄŸÄ± kaydÄ± eklendi.', 'success');
    logIslem('yeni_kayit', 'ambalaj ' + (rec.tur || '') + ' ' + rec.miktar + ' ' + (rec.birim || 'kg'));
  }

  saveAmbalajData();
  renderAmbalajTable();
  syncAmbalajSilent();
  closeAmbalajModal();
}

function editAmbalajRecord(id) { openAmbalajModal(id); }

async function deleteAmbalajRecord(id) {
  if (!canEditAmbalajRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (!confirm('Bu ambalaj atÄ±ÄŸÄ± kaydÄ±nÄ± silmek istediÄŸinize emin misiniz?')) return;
  ambalajRecords = ambalajRecords.filter(r => r.id !== id);
  saveAmbalajData();
  if (supabaseClient) {
    try { await supabaseClient.from('ambalaj_records').delete().eq('id', id); } catch (_) {}
  }
  renderAmbalajTable();
  syncAmbalajSilent();
  showToast('Ambalaj atÄ±ÄŸÄ± kaydÄ± silindi.', 'success');
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
    label: ambalajSelectedYear ? t('wastePackagingChartLabel') + ' ' + ambalajSelectedYear + ' (kg)' : t('wastePackagingChartLabel') + ' (kg)',
    data: values,
    backgroundColor: barColors,
    borderRadius: 4,
    barPercentage: 0.6,
    categoryPercentage: 0.75,
    maxBarThickness: 52
  }];
  if (hasPrev) {
    datasets.push({
      label: t('previousYearLabel') + ' ' + prevYear + ' (kg)',
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
            if (detail.length > 0) showChartDetailModal(AYLAR_KISA[key.m] + ' ' + key.y + ' ' + t('wastePackagingChartLabel'), detail);
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
    var tur = r.tur || t('undefinedType');
    totals[tur] = (totals[tur] || 0) + ambalajToKg(r);
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
    if (total <= 0) return 'â€”';
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
      dayCesitler += '<div class="pcol pcol-c' + (ci + 1) + '"><div class="pces">' + escapeHtml(ci + 1 + '. Ã‡eÅŸit: ' + name) + '</div>' + ingHtml + '</div>';
    }
    if (dayHasAny) {
      var dayTotalHtml = '';
      var dayEntries = Object.values(dayAgg).filter(function(e) { return e.total > 0; });
      if (dayEntries.length) {
        dayTotalHtml = '<div class="pdt"><div class="pdth">' + t('stockDeductionList') + ' â€“ ' + gunler[di] + '</div>';
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
    weeklyHtml = '<div class="s-title">HaftalÄ±k Toplam Ä°htiyaÃ§ Listesi</div><div class="wcard"><div class="whd">Malzeme &mdash; Miktar</div><div class="wbd">';
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
  html += '<h1>HaftalÄ±k MenÃ¼ Listesi</h1><div class="sub">' + escapeHtml(weekLabel) + '</div>';
  var durum = currentMenuDurumMeta || {};
  var durumNot = 'MenÃ¼ Durumu: TASLAK (ONAYSIZ)';
  if (durum.durum === MENU_DURUMLAR.ONAYLANDI) {
    durumNot = 'MenÃ¼ Durumu: ONAYLANDI' + (durum.onaylayan ? ' - ' + durum.onaylayan : '');
  } else if (durum.durum === MENU_DURUMLAR.ONAY_BEKLIYOR) {
    durumNot = 'MenÃ¼ Durumu: ONAY BEKLÄ°YOR (ONAYSIZ)';
  } else if (durum.durum === MENU_DURUMLAR.REDDEDILDI) {
    durumNot = 'MenÃ¼ Durumu: REDDEDÄ°LDÄ°' + (durum.onay_notu ? ' - ' + durum.onay_notu : '');
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
    html += '<div class="s-title" style="page-break-before:always">ÃœrÃ¼n Ä°htiyaÃ§ Listesi</div>' + prodDaysHtml;
  }

  // Weekly total (last)
  if (weeklyHtml) {
    weeklyHtml = weeklyHtml.replace('<div class="s-title">', '<div class="s-title" style="page-break-before:always">');
    html += weeklyHtml;
  }

  html += '<div class="fot">KÄ±rÅŸehir Ahi Evran Ãœniversitesi - Beslenme Hizmetleri YÃ¶netim Sistemi</div>';
  html += '</div>';
  return html;
}

function printYagList() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  var list = yagRecords.filter(function(r) { return r.tarih; });
  var bas = document.getElementById('yagTarihBas');
  var bit = document.getElementById('yagTarihBit');
  var tur = document.getElementById('yagTurFilter');
  if (bas && bas.value) list = list.filter(function(r) { return r.tarih >= bas.value; });
  if (bit && bit.value) list = list.filter(function(r) { return r.tarih <= bit.value; });
  if (tur && tur.value) list = list.filter(function(r) { return r.tur === tur.value; });
  if (yagSelectedYear) list = list.filter(function(r) { return (r.tarih || '').slice(0, 4) === yagSelectedYear; });
  list.sort(function(a, b) { return new Date(b.tarih) - new Date(a.tarih); });
  if (!list.length) { showToast('Listelenecek kayÄ±t bulunamadÄ±.', 'error'); return; }
  var html = '<div style="padding:10px 14px;font-family:Arial,sans-serif;font-size:11px">';
  html += '<h1 style="font-size:14px;margin:0 0 4px">AtÄ±k YaÄŸ KayÄ±tlarÄ±</h1>';
  html += '<div style="font-size:10px;color:#888;margin-bottom:6px">' + new Date().toLocaleDateString('tr-TR') + '</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:10px">';
  html += '<thead><tr>';
  ['Tarih','Makbuz No','YaÄŸ TÃ¼rÃ¼','Miktar (lt)','Not'].forEach(function(h) {
    html += '<th style="border:1px solid #bbb;padding:4px 6px;background:#eee;text-align:left;font-weight:700">' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  list.forEach(function(r) {
    html += '<tr>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + displayDate(r.tarih) + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.makbuzNo || 'â€”') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.tur || 'â€”') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + (r.miktar || 0).toFixed(1) + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.not || 'â€”') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  var total = list.reduce(function(s, r) { return s + (r.miktar || 0); }, 0);
  html += '<div style="margin-top:6px;font-size:10px;font-weight:700;text-align:right">' + t('total') + ': ' + total.toFixed(1) + ' lt</div>';
  html += '<div style="text-align:center;font-size:8px;color:#aaa;margin-top:10px;padding-top:4px;border-top:1px solid #ddd">AtÄ±k YaÄŸ KayÄ±t Listesi</div>';
  html += '</div>';
  var win = window.open('', '_blank', 'width=800,height=600');
  if (!win) { showToast('Pop-up engelleyiciyi kapatÄ±n.', 'error'); return; }
  win.document.open();
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>AtÄ±k YaÄŸ KayÄ±tlarÄ±</title></head><body style="margin:0;background:#fff">' + html + '</body></html>');
  win.document.close();
  win.focus();
  triggerPrint(win);
}

function printAmbalajList() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  var list = ambalajRecords.filter(function(r) { return r.tarih; });
  var bas = document.getElementById('ambalajTarihBas');
  var bit = document.getElementById('ambalajTarihBit');
  var tur = document.getElementById('ambalajTurFilter');
  if (bas && bas.value) list = list.filter(function(r) { return r.tarih >= bas.value; });
  if (bit && bit.value) list = list.filter(function(r) { return r.tarih <= bit.value; });
  if (tur && tur.value) list = list.filter(function(r) { return r.tur === tur.value; });
  if (ambalajSelectedYear) list = list.filter(function(r) { return (r.tarih || '').slice(0, 4) === ambalajSelectedYear; });
  list.sort(function(a, b) { return new Date(b.tarih) - new Date(a.tarih); });
  if (!list.length) { showToast('Listelenecek kayÄ±t bulunamadÄ±.', 'error'); return; }
  var html = '<div style="padding:10px 14px;font-family:Arial,sans-serif;font-size:11px">';
  html += '<h1 style="font-size:14px;margin:0 0 4px">Ambalaj AtÄ±klarÄ± KayÄ±tlarÄ±</h1>';
  html += '<div style="font-size:10px;color:#888;margin-bottom:6px">' + new Date().toLocaleDateString('tr-TR') + '</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:10px">';
  html += '<thead><tr>';
  ['Tarih','AtÄ±k TÃ¼rÃ¼','Miktar (kg)','Not'].forEach(function(h) {
    html += '<th style="border:1px solid #bbb;padding:4px 6px;background:#eee;text-align:left;font-weight:700">' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  list.forEach(function(r) {
    var birimLabel = (r.birim || 'kg') === 'g' ? ' gr' : ' kg';
    html += '<tr>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + displayDate(r.tarih) + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.tur || 'â€”') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + (r.miktar || 0).toFixed((r.birim || 'kg') === 'g' ? 0 : 1) + birimLabel + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.not || 'â€”') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  var totalKg = list.reduce(function(s, r) { return s + ((r.birim === 'g') ? (Number(r.miktar) || 0) / 1000 : (Number(r.miktar) || 0)); }, 0);
  html += '<div style="margin-top:6px;font-size:10px;font-weight:700;text-align:right">' + t('total') + ': ' + totalKg.toFixed(1) + ' kg</div>';
  html += '<div style="text-align:center;font-size:8px;color:#aaa;margin-top:10px;padding-top:4px;border-top:1px solid #ddd">Ambalaj AtÄ±ÄŸÄ± KayÄ±t Listesi</div>';
  html += '</div>';
  var win = window.open('', '_blank', 'width=800,height=600');
  if (!win) { showToast('Pop-up engelleyiciyi kapatÄ±n.', 'error'); return; }
  win.document.open();
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ambalaj AtÄ±klarÄ± KayÄ±tlarÄ±</title></head><body style="margin:0;background:#fff">' + html + '</body></html>');
  win.document.close();
  win.focus();
  triggerPrint(win);
}

function printMenu() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  var html = buildExportHTML();
  var win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { showToast('Pop-up engelleyiciyi kapatÄ±n.', 'error'); return; }
  win.document.open();
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>HaftalÄ±k MenÃ¼</title></head><body style="margin:0;background:#fff">' + html + '</body></html>');
  win.document.close();
  win.focus();
  triggerPrint(win);
}

// â”€â”€â”€ KALÄ°BRASYONA TABÄ° CÄ°HAZLAR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const KALIBRASYON_STORAGE_KEY = 'atik_kontrol_kalibrasyon';
let kalibrasyonCihazlari = [];
let editingKalibrasyonId = null;
let kalibrasyonPage = 0;
const KALIBRASYON_PAGE_SIZE = 10;

function getKALIBRASYON_DURUMLAR() {
  return {
    calisir: { text: t('statusWorking'), cls: 'badge badge-ok' },
    arizali: { text: t('statusDefective'), cls: 'badge badge-err' },
    bakim: { text: t('statusMaintenance'), cls: 'badge badge-warn' },
    hurda: { text: t('statusScrap'), cls: 'badge badge-err' }
  };
}

function getCihazDurumBilgi(r) {
  var d = getKALIBRASYON_DURUMLAR()[r.durum];
  if (!d) return getKALIBRASYON_DURUMLAR().calisir;
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
  if (st === 'yakinlasiyor') return { text: t('statusApproaching'), cls: 'badge badge-warn' };
  if (st === 'suresi_doldu') return { text: t('statusExpired'), cls: 'badge badge-err' };
  if (st === 'yapilmadi') return { text: t('statusNotDone'), cls: 'badge badge-err' };
  return { text: t('statusValid'), cls: 'badge badge-ok' };
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
      <span class="report-label"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>${t('totalDevices')}</span>
      <span class="report-value">${fmtN(toplam)}</span>
    </div>
    <div class="report-item">
      <span class="report-label" style="color:#10b981"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>${t('statusWorking')}</span>
      <span class="report-value" style="color:#10b981">${fmtN(calisir)}</span>
    </div>
    <div class="report-item">
      <span class="report-label" style="color:#ef4444"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>${t('statusDefective')}</span>
      <span class="report-value" style="color:#ef4444">${fmtN(arizali)}</span>
    </div>
    <div class="report-item">
      <span class="report-label" style="color:#f59e0b"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>${t('statusMaintenance')}</span>
      <span class="report-value" style="color:#f59e0b">${fmtN(bakim)}</span>
    </div>
    <div class="report-item">
      <span class="report-label" style="color:#ef4444"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>${t('statusScrap')}</span>
      <span class="report-value" style="color:#ef4444">${fmtN(hurda)}</span>
    </div>
    <div class="report-item">
      <span class="report-label" style="color:#10b981"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 11 12 14 15 9"/></svg>${t('calibrationValid')}</span>
      <span class="report-value" style="color:#10b981">${fmtN(gecerli)}</span>
    </div>
    <div class="report-item">
      <span class="report-label" style="color:#f59e0b"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${t('calibrationApproaching')}</span>
      <span class="report-value" style="color:#f59e0b">${fmtN(yaklasan)}</span>
    </div>
    <div class="report-item">
      <span class="report-label"><svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${t('differentDepartments')}</span>
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

  badge.textContent = kalibrasyonCihazlari.length + ' ' + t('deviceCount');

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
    empty.querySelector('p').textContent = t('noDeviceFound');
    renderKalibrasyonOzet([]);
    return;
  }
  empty.querySelector('p').textContent = t('noDeviceRecord');

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
        '<button class="btn-icon" onclick="editKalibrasyonRecord(' + r.id + ')" title="DÃ¼zenle">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button class="btn-icon" onclick="deleteKalibrasyonRecord(' + r.id + ')" title="Sil" style="color:var(--danger)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
        '</button>' +
        '</td>'
      : '<td></td>';
    return `<tr>
      <td>${escapeHtml(r.cihazAdi || 'â€”')}</td>
      <td>${escapeHtml(r.markaModel || 'â€”')}</td>
      <td>${escapeHtml(r.sicilNo || 'â€”')}</td>
      <td><span class="${durumB.cls}">${durumB.text}</span></td>
      <td><span class="${kalB.cls}">${kalB.text}</span></td>
      <td>${displayDate(r.sonKalibrasyon)}</td>
      <td>${displayDate(r.sonrakiKalibrasyon)}</td>
      <td>${escapeHtml(r.konum || 'â€”')}</td>
      <td>${escapeHtml(r.sorumlu || 'â€”')}</td>
      <td>${escapeHtml(r.not || 'â€”')}</td>
      ${actionCell}
    </tr>`;
  }).join('');

  const pagination = document.getElementById('kalibrasyonPagination');
  if (pagination) {
    if (totalPages > 1) {
      var fp = kalibrasyonPage === 0;
      var lp = kalibrasyonPage >= totalPages - 1;
      pagination.innerHTML =
        '<button class="btn-icon" data-kalibrasyon-page="0"' + (fp ? ' disabled style="opacity:0.4"' : '') + '>Â«</button>' +
        '<button class="btn-icon" data-kalibrasyon-page="' + (kalibrasyonPage - 1) + '"' + (fp ? ' disabled style="opacity:0.4"' : '') + '>â€¹</button>' +
        '<span style="font-weight:600;margin:0 4px">' + (kalibrasyonPage + 1) + ' / ' + totalPages + '</span>' +
        '<button class="btn-icon" data-kalibrasyon-page="' + (kalibrasyonPage + 1) + '"' + (lp ? ' disabled style="opacity:0.4"' : '') + '>â€º</button>' +
        '<button class="btn-icon" data-kalibrasyon-page="' + (totalPages - 1) + '"' + (lp ? ' disabled style="opacity:0.4"' : '') + '>Â»</button>' +
        '<span style="color:var(--text-muted);font-size:0.8rem;margin-left:8px">' + filtered.length + ' ' + t('deviceCount') + '</span>';
    } else {
      pagination.innerHTML = '';
    }
  }
}

function openKalibrasyonModal(id) {
  if (id) {
    if (!canEditKalibrasyonRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddKalibrasyonRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
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
    title.textContent = t('editDeviceTitle');
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
    title.textContent = t('newDeviceTitle');
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
    if (!canEditKalibrasyonRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  } else {
    if (!canAddKalibrasyonRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  }

  var cihazAdi = document.getElementById('kfCihazAdi').value.trim();
  if (!cihazAdi) { showToast('Cihaz adÄ± gerekli.', 'error'); return; }

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
    showToast('Cihaz bilgisi gÃ¼ncellendi.', 'success');
    logIslem('kayit_duzenle', 'kalibrasyon #' + editingKalibrasyonId + ' gÃ¼ncellendi');
  } else {
    kalibrasyonCihazlari.push(rec);
    showToast('Cihaz kaydÄ± eklendi.', 'success');
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
  if (!canEditKalibrasyonRecords()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (!confirm('Bu cihaz kaydÄ±nÄ± silmek istediÄŸinize emin misiniz?')) return;
  kalibrasyonCihazlari = kalibrasyonCihazlari.filter(r => r.id !== id);
  saveKalibrasyonData();
  if (supabaseClient) {
    try { await supabaseClient.from('kalibrasyon_cihazlari').delete().eq('id', id); } catch (_) {}
  }
  renderKalibrasyon();
  renderKPIs();
  syncKalibrasyonSilent();
  showToast('Cihaz kaydÄ± silindi.', 'success');
  logIslem('kayit_sil', 'kalibrasyon #' + id + ' silindi');
}

function exportKalibrasyonCSV() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  if (kalibrasyonCihazlari.length === 0) { showToast('Ä°ndirilecek kayÄ±t yok.', 'error'); return; }
  var headers = ['Cihaz AdÄ±', 'Marka-Model', 'Sicil No', 'Cihaz Durumu', 'Kalibrasyon Durumu', 'DoÄŸrulama', 'Son Kalibrasyon', 'Bir Sonraki Kalibrasyon', 'BÃ¶lÃ¼m', 'Sorumlu', 'Not', 'id'];
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
  showToast(kalibrasyonCihazlari.length + ' kayÄ±t CSV olarak indirildi.', 'success');
}

function printKalibrasyonList() {
  if (!canExport()) { showToast('Bu iÅŸlem iÃ§in yetkiniz yok.', 'error'); return; }
  var list = [...kalibrasyonCihazlari].sort(function(a, b) { return (a.cihazAdi || '').localeCompare(b.cihazAdi || ''); });
  if (!list.length) { showToast('Listelenecek cihaz bulunamadÄ±.', 'error'); return; }
  var html = '<div style="padding:10px 14px;font-family:Arial,sans-serif;font-size:11px">';
  html += '<h1 style="font-size:14px;margin:0 0 4px">Kalibrasyona Tabi Cihazlar</h1>';
  html += '<div style="font-size:10px;color:#888;margin-bottom:6px">' + new Date().toLocaleDateString('tr-TR') + '</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:10px">';
  html += '<thead><tr>';
  ['Cihaz AdÄ±', 'Marka-Model', 'Sicil No', 'Durum', 'Kal.', 'Son Kal.', 'Bir Sonraki', 'BÃ¶lÃ¼m', 'Sorumlu'].forEach(function(h) {
    html += '<th style="border:1px solid #bbb;padding:4px 6px;background:#eee;text-align:left;font-weight:700">' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  list.forEach(function(r) {
    var cihazB = getCihazDurumBilgi(r);
    var kalB = getKalibrasyonDurumBilgi(r);
    var renkC = cihazB.cls.indexOf('err') !== -1 ? '#ef4444' : cihazB.cls.indexOf('warn') !== -1 ? '#f59e0b' : '#10b981';
    var renkK = kalB.cls.indexOf('err') !== -1 ? '#ef4444' : kalB.cls.indexOf('warn') !== -1 ? '#f59e0b' : '#10b981';
    html += '<tr>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.cihazAdi || 'â€”') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.markaModel || 'â€”') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.sicilNo || 'â€”') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px;font-weight:700;color:' + renkC + '">' + cihazB.text + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px;font-weight:700;color:' + renkK + '">' + kalB.text + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + displayDate(r.sonKalibrasyon) + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + displayDate(r.sonrakiKalibrasyon) + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.konum || 'â€”') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.sorumlu || 'â€”') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  html += '<div style="margin-top:6px;font-size:10px;font-weight:700;text-align:right">' + t('total') + ': ' + list.length + ' ' + t('devices') + '</div>';
  html += '<div style="text-align:center;font-size:8px;color:#aaa;margin-top:10px;padding-top:4px;border-top:1px solid #ddd">Kalibrasyona Tabi Cihaz Listesi</div>';
  html += '</div>';
  var win = window.open('', '_blank', 'width=800,height=600');
  if (!win) { showToast('Pop-up engelleyiciyi kapatÄ±n.', 'error'); return; }
  win.document.open();
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Kalibrasyona Tabi Cihazlar</title></head><body style="margin:0;background:#fff">' + html + '</body></html>');
  win.document.close();
  win.focus();
  triggerPrint(win);
}

// â”€â”€â”€ YUKARI Ã‡IK BUTONU â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // capture=true: iÃ§ konteynerlerin scroll olaylarÄ±nÄ± da yakalar
  document.addEventListener('scroll', updateBtn, true);
  window.addEventListener('scroll', updateBtn);
  document.addEventListener('click', function() { setTimeout(updateBtn, 400); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateBtn);
  else updateBtn();
})();

// â”€â”€â”€ I18N TRANSLATIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
var I18N = {
  tr: {
    loginSub: "BESLENME HÄ°ZMETLERÄ° YÃ–NETÄ°M SÄ°STEMÄ°",
    loginFormSub: "Oturum AÃ§Ä±nÄ±z",
    loginUsername: "KullanÄ±cÄ±",
    loginSelectUser: "KullanÄ±cÄ± SeÃ§in",
    loginPassword: "Åifre",
    loginBtn: "GiriÅŸ Yap",
    loginHint: "Åifrenizi yÃ¶neticinizden alabilirsiniz",
    loginFeature1: "MenÃ¼ PlanlamasÄ±, GÃ¼nlÃ¼k Ãœretim, TÃ¼ketim ve AtÄ±k Takibi",
    loginFeature2: "DetaylÄ± Raporlama",
    loginFeature3: "CanlÄ± Panel ve Grafikler",
    menuLabel: "MenÃ¼",
    headerSubtitle: "Beslenme Hizmetleri YÃ¶netim Sistemi",
    btnLogout: "Ã‡Ä±kÄ±ÅŸ",
    btnPrev: "Ã–nceki",
    btnNext: "Sonraki",
    loading: "YÃ¼kleniyor...",
    loadingText: "Veriler senkronize ediliyor...",
    loadingSub: "Supabase baÄŸlantÄ±sÄ± kontrol ediliyor",
    loadingSkip: "TÄ±klayarak geÃ§",
    versionLabel: "Uygulama SÃ¼rÃ¼mÃ¼",
    sidebarPanel: "Panel",
    sidebarMenu: "HaftalÄ±k MenÃ¼",
    sidebarRecords: "KayÄ±tlar",
    sidebarReport: "Rapor",
    sidebarHaccp: "GÄ±da GÃ¼venliÄŸi",
    sidebarCalibration: "Kalibrasyon",
    sidebarOil: "AtÄ±k YaÄŸ",
    sidebarPackaging: "Ambalaj AtÄ±klarÄ±",
    sidebarCharts: "Grafikler",
    sidebarYearly: "YÄ±llÄ±k KarÅŸÄ±laÅŸtÄ±rma",
    sidebarSpending: "Harcama",
    sidebarUnitPrice: "Birim Fiyatlar",
    sidebarDownload: "TÃ¼mÃ¼nÃ¼ Ä°ndir",
    sidebarBackup: "Supabase'e Yedekle",
    sidebarRestore: "Supabase'ten Ã‡ek",
    sidebarAdmin: "YÃ¶netim",
    sidebarLogs: "Log KayÄ±tlarÄ±",
    sidebarTheme: "Tema",
    sidebarManual: "KullanÄ±m KÄ±lavuzu",
    dashboardPrintPdf: "PDF YazdÄ±r",
    kpiTotalRecords: "Toplam Ãœretim GÃ¼nÃ¼",
    kpiTodayProduction: "BugÃ¼nkÃ¼ Ãœretim",
    kpiHaccpAlarm: "SoÄŸuk Hava Depo SÄ±caklÄ±k AlarmÄ±",
    kpiCalibrationAlarm: "Kalibrasyon AlarmÄ±",
    kpiAvgWaste: "Ort. AtÄ±k (kg)",
    kpiTotalPasses: "Turnikeden Toplam GeÃ§iÅŸ RakamÄ±",
    kpiTotalWaste: "Toplam AtÄ±k (kg)",
    kpiWasteRate: "AtÄ±k OranÄ±",
    weeklyPrevBtn: "Ã–nceki Hafta",
    weeklySummary: "HaftalÄ±k Ã–zet",
    weeklyNextBtn: "Sonraki Hafta",
    weeklyBadge: "Bu Hafta",
    dailyPrevBtn: "Ã–nceki GÃ¼n",
    dailySummary: "GÃ¼nlÃ¼k Detay",
    dailyNextBtn: "Sonraki GÃ¼n",
    weeklyCompTitle: "HaftalÄ±k KarÅŸÄ±laÅŸtÄ±rma",
    monthlyCompTitle: "AylÄ±k KarÅŸÄ±laÅŸtÄ±rma",
    monthlyBadge: "Bu Ay",
    yearlyBadge: "Bu YÄ±l",
    anomalyTitle: "Anomali Tespiti",
    anomalyBadge: "Anormal AtÄ±k GÃ¼nleri",
    lastRecordsTitle: "Son KayÄ±tlar",
    dashboardGoToRecords: "KayÄ±tlara Git",
    emptyDashboard: "HenÃ¼z kayÄ±t yok...",
    formulaTitle: "ATIK HESAPLAMA FORMÃœLÃœ",
    recordsEntryBtn: "Ãœretim TÃ¼ketim Gir",
    recordsImportBtn: "Ä°Ã§e Aktar",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "CSV Ä°ndir",
    recordsDeleteBtn: "SeÃ§ilileri Sil",
    emptyRecords: "GÃ¶sterilecek kayÄ±t bulunamadÄ±.",
    thDate: "Tarih",
    thProducedPerson: "Ãœretilen Yemek (KiÅŸi)",
    thWaste10: "%10 Fire",
    thBeneficiary: "Yemek Hiz. Yararlanan Personel ve Ã–ÄŸrenci",
    thPortionGr: "Porsiyon (gr)",
    thWasteKg: "AtÄ±k (kg)",
    thWastedPortion: "Ã‡Ã¶pe Giden (pors.)",
    thFoodType: "Yemek TÃ¼rÃ¼",
    thAction: "Ä°ÅŸlem",
    thAcademicStaff: "Turnikeden GeÃ§en Akademik ve Ä°dari Personel",
    thStudentCount: "Turnikeden GeÃ§en Ã–ÄŸrenci SayÄ±sÄ±",
    thBeneficiaryTotal: "Yemek Hiz. Yararlanan Toplam KiÅŸi",
    sksStaff: "SKS Yemek Hizmeti Personeli",
    summaryReport: "Ã–zet Rapor",
    reportPdfBtn: "PDF AÃ§",
    allRecordsPrint: "TÃ¼m KayÄ±tlar (YazdÄ±rma GÃ¶rÃ¼nÃ¼mÃ¼)",
    rTotalRecords: "Toplam KayÄ±t SayÄ±sÄ±",
    rTotalMeals: "Toplam Ãœretilen Yemek",
    rTotalWaste10: "Toplam %10 Fire",
    rTotalAfterWaste: "Toplam %10 Fire SonrasÄ± Yemek",
    rTotalTurnstile: "Toplam Turnike GeÃ§isi",
    rTotalBeneficiary: "Yemek Hiz. Yararlanan Toplam KiÅŸi",
    rTotalStaff: "Yararlanan Toplam SKS Personeli",
    rPortionSize: "Porsiyon MiktarÄ± (gr)",
    rTotalPortion: "Toplam Porsiyon (gr)",
    rWastedPortion: "Ã‡Ã¶pe Giden Porsiyon",
    rMaxWeeklyBeneficiary: "En YÃ¼ksek HaftalÄ±k Yararlanan KiÅŸi",
    rTotalWasteKg: "Toplam AtÄ±k MiktarÄ± (kg)",
    rAvgWasteKg: "Ort. AtÄ±k MiktarÄ± (kg)",
    rTotalStudents: "Toplam Ã–ÄŸrenci SayÄ±sÄ±",
    rMaxWaste: "En YÃ¼ksek AtÄ±k (kg)",
    rMinWaste: "En DÃ¼ÅŸÃ¼k AtÄ±k (kg)",
    rWasteTrend: "AtÄ±k Trendi (son 7 gÃ¼n)",
    rBeneficiaryTrend: "Yemek Hiz. Yararlanan Trendi (son 7 gÃ¼n)",
    wasteByFoodTitle: "Yemek TÃ¼rÃ¼ BazÄ±nda AtÄ±k Analizi",
    wasteByFoodEmpty: "Yemek tÃ¼rÃ¼ verisi girilen kayÄ±t bulunamadÄ±.",
    wasteByFoodRecords: "KayÄ±t SayÄ±sÄ±",
    wasteByFoodRate: "AtÄ±k OranÄ±",
    wasteByFoodPerPerson: "KiÅŸi BaÅŸÄ± AtÄ±k (kg)",
    wsProducedMeal: "Ãœretilen Yemek (KiÅŸi)",
    wsTotalPasses: "Toplam GeÃ§iÅŸ",
    wsTurnstile: "Turnike",
    wsStaffSKS: "Y. Hiz. Yr. SKS",
    wsWasteAmount: "AtÄ±k MiktarÄ±",
    wsWastedPortion: "Ã‡Ã¶pe Giden",
    wsStudents: "Y.H. Yar. Ã–ÄŸrenci",
    wsNoRecordsYet: "HenÃ¼z kayÄ±t yok",
    wsNoRecordThisWeek: "Bu hafta kayÄ±t yok",
    wsNoRecordToday: "KayÄ±t yok",
    wsTodayDetail: "BugÃ¼nÃ¼n DetayÄ±",
    wsDailyDetail: "GÃ¼nlÃ¼k Detay",
    wsWaste: "Fire",
    wsPortion: "porsiyon",
    wsProduced: "Ãœretilen",
    wsTurnstileCount: "Turnike GeÃ§iÅŸ",
    wsStaffCount: "Personel",
    menuTitle: "HaftalÄ±k MenÃ¼ Listesi",
    menuStatusBadge: "Durum",
    menuSaveBtn: "Kaydet",
    menuSendBtn: "Onaya GÃ¶nder",
    menuApproveBtn: "Onayla",
    menuRejectBtn: "Reddet",
    menuWithdrawBtn: "OnayÄ± KaldÄ±r",
    menuClearBtn: "Tabloyu Temizle",
    menuPrintBtn: "YazdÄ±r",
    menuFoodListBtn: "Yemek Listesi",
    menuFoodListUploadBtn: "CSV YÃ¼kle",
    menuFoodListCsvBtn: "CSV Ä°ndir",
    menuWarningPrefix: "OnaysÄ±z MenÃ¼:",
    menuWarningText: "Bu haftanÄ±n menÃ¼sÃ¼ henÃ¼z gÄ±da mÃ¼hendisi tarafÄ±ndan onaylanmadÄ±.",
    menuHintText: "Yemek isimlerini yazÄ±n...",
    productNeedsTitle: "ÃœrÃ¼n Ä°htiyaÃ§ Listesi",
    weeklyNeedsTitle: "HaftalÄ±k Toplam Ä°htiyaÃ§ Listesi",
    foodListTitle: "Yemek Listesi",
    modalRejectMenu: "MenÃ¼yÃ¼ Reddet",
    modalRejectDesc: "Red gerekÃ§esi zorunludur.",
    menuRejectConfirm: "Reddet",
    haccpTitle: "GÄ±da GÃ¼venliÄŸi YÃ¶netimi",
    haccpCsvBtn: "CSV Ä°ndir",
    haccpColdStorage: "SoÄŸuk Depo SÄ±caklÄ±k KayÄ±tlarÄ±",
    haccpNewBtn: "Yeni KayÄ±t",
    haccpDepotBtn: "Depo AdlarÄ±",
    haccpDepoQrNote: "Depo adlarÄ±nÄ± dÃ¼zenleyip QR butonuyla her depo iÃ§in QR kod oluÅŸturabilirsiniz.",
    haccpModalTitle: "Yeni KayÄ±t",
    filterDepot: "Depo Filtresi:",
    filterAll: "TÃ¼mÃ¼",
    filterDateRange: "Tarih AralÄ±ÄŸÄ±:",
    emptyHaccp: "HenÃ¼z sÄ±caklÄ±k kaydÄ± girilmemiÅŸ.",
    btnDeleteSelectedHaccp: "SeÃ§ili Sil",
    btnPdf: "PDF",
    depoNamesTitle: "Depo AdlarÄ±",
    oilNewBtn: "Yeni KayÄ±t",
    oilListBtn: "Liste",
    oilFilterTitle: "AtÄ±k YaÄŸ Filtreleri",
    filterOilType: "YaÄŸ TÃ¼rÃ¼:",
    btnReset: "SÄ±fÄ±rla",
    oilSummaryTitle: "AtÄ±k YaÄŸ Ã–zeti",
    oilChartTitle: "AtÄ±k YaÄŸ Grafikleri",
    oilChartSubtitle: "AylÄ±k AtÄ±k YaÄŸ MiktarÄ± (lt)",
    oilChartEmpty: "AtÄ±k yaÄŸ kaydÄ± girildiÄŸinde grafik gÃ¶sterilecek",
    oilChartNote: "Tarih, yaÄŸ tÃ¼rÃ¼ ve yÄ±l filtrelerine gÃ¶re aylÄ±k atÄ±k yaÄŸ toplamlarÄ±",
    oilRecordsTitle: "AtÄ±k YaÄŸ KayÄ±tlarÄ±",
    oilModalTitle: "AtÄ±k YaÄŸ KaydÄ±",
    emptyOil: "HenÃ¼z atÄ±k yaÄŸ kaydÄ± girilmemiÅŸ.",
    ambalajNewBtn: "Yeni KayÄ±t",
    ambalajListBtn: "Liste",
    packagingFilterTitle: "Ambalaj AtÄ±ÄŸÄ± Filtreleri",
    filterWasteType: "AtÄ±k TÃ¼rÃ¼:",
    packagingSummaryTitle: "Ambalaj AtÄ±ÄŸÄ± Ã–zeti",
    packagingChartTitle: "Ambalaj AtÄ±ÄŸÄ± Grafikleri",
    packagingChartSubtitle: "AylÄ±k Ambalaj AtÄ±ÄŸÄ± MiktarÄ± (kg)",
    packagingChartEmpty: "Ambalaj atÄ±ÄŸÄ± kaydÄ± girildiÄŸinde grafik gÃ¶sterilecek",
    packagingChartNote: "Tarih, atÄ±k tÃ¼rÃ¼ ve yÄ±l filtrelerine gÃ¶re aylÄ±k ambalaj atÄ±ÄŸÄ± toplamlarÄ± (kg)",
    packagingRecordsTitle: "Ambalaj AtÄ±klarÄ± KayÄ±tlarÄ±",
    packagingModalTitle: "Ambalaj AtÄ±ÄŸÄ± KaydÄ±",
    emptyPackaging: "HenÃ¼z ambalaj atÄ±ÄŸÄ± kaydÄ± girilmemiÅŸ.",
    kalibrasyonNewBtn: "Yeni Cihaz",
    kalibrasyonListBtn: "Liste",
    kalibrasyonCsvBtn: "CSV Ä°ndir",
    calibrationSummary: "Kalibrasyon Ã–zeti",
    calibrationDevices: "Kalibrasyona Tabi Cihazlar",
    calibrationModalTitle: "Kalibrasyona Tabi Cihaz",
    filterStatus: "Durum:",
    filterDepartment: "BÃ¶lÃ¼m:",
    btnWordExport: "Word'e Aktar",
    btnPrint: "PDF YazdÄ±r",
    chartProdWaste: "Ãœretim - GeÃ§iÅŸ - AtÄ±k KarÅŸÄ±laÅŸtÄ±rmasÄ±",
    chartEmpty: "Veri girildiÄŸinde grafik gÃ¶sterilecek",
    chartProdWasteNote: "Ãœretim, turnike geÃ§isi ve Ã‡Ã¶pe Giden porsiyonun aylÄ±k karÅŸÄ±laÅŸtÄ±rmasÄ±",
    chartStudentCount: "Beslenme Hizmetlerinden Yararlanan Ã–ÄŸrenci SayÄ±sÄ±",
    yearTotal: "YÄ±l ToplamÄ±",
    chartStudentNote: "GÃ¼nlÃ¼k Ã¶ÄŸrenci geÃ§iÅŸlerinin aylÄ±k toplamÄ±",
    chartStaffTotal: "Akademik ve Ä°dari + SKS Personeli ToplamÄ±",
    chartStaffNote: "Akademik ve Ä°dari (Turnike - Ã–ÄŸrenci) ile SKS Yemek Hizmeti Personeli toplamÄ±",
    chartMonthlyProd: "AylÄ±k Yemek Ãœretimi",
    chartMonthlyProdNote: "GÃ¼nlÃ¼k Ã¼retilen yemek sayÄ±larÄ±nÄ±n aylÄ±k toplamÄ±",
    chartMonthlyTurnstile: "AylÄ±k Turnike GeÃ§iÅŸ SayÄ±larÄ±",
    chartTurnstileNote: "Ã–ÄŸrenci + personel + dÄ±ÅŸ geÃ§iÅŸ toplamÄ±",
    chartMonthlyWaste: "AylÄ±k AtÄ±k MiktarÄ± (kg)",
    chartMonthlyWasteNote: "GÃ¼nlÃ¼k atÄ±klarÄ±n aylÄ±k toplamÄ± (kg)",
    chartMonthlyWastePortion: "AylÄ±k AtÄ±k MiktarÄ± (porsiyon)",
    chartWastePortionNote: "GÃ¼nlÃ¼k Ã‡Ã¶pe Giden porsiyonlarÄ±n aylÄ±k toplamÄ±",
    chartDiff: "Ãœretim ile GeÃ§is ArasÄ±ndaki Fark",
    chartDiffNote: "Ãœretilen yemek sayÄ±sÄ± ile turnike geÃ§isi arasÄ±ndaki fark",
    chartWasteRatio: "Ãœretilen YemeÄŸe Oranla AtÄ±k %",
    yearAverage: "YÄ±l OrtalamasÄ±",
    chartWasteRatioNote: "Ãœretilen yemeÄŸin yÃ¼zde kaÃ§Ä± atÄ±k oluyor",
    chartWastePerPerson: "KiÅŸi BaÅŸÄ± AtÄ±k (kg/kiÅŸi)",
    chartWastePerPersonNote: "Yemekhaneye giren kiÅŸi baÅŸÄ±na dÃ¼ÅŸen ortalama atÄ±k",
    chartMonthlyTemp: "AylÄ±k Ortalama Depo SÄ±caklÄ±klarÄ± (Â°C)",
    chartTempEmpty: "SÄ±caklÄ±k kaydÄ± girildiÄŸinde grafik gÃ¶sterilecek",
    chartTempNote: "Her deponun aylÄ±k ortalama sÄ±caklÄ±ÄŸÄ±",
    yearlyPdfBtn: "PDF YazdÄ±r",
    yearlyTotalProd: "Toplam Ãœretim KarÅŸÄ±laÅŸtÄ±rmasÄ±",
    yearlyTotalProdNote: "YÄ±l toplamÄ± - 1. yÄ±l vs 2. yÄ±l (porsiyon)",
    yearlyTotalBen: "Yemek Hiz. Yararlanan Toplam KiÅŸi",
    yearlyTotalBenNote: "YÄ±l toplamÄ± - 1. yÄ±l vs 2. yÄ±l (toplam kiÅŸi)",
    yearlyStudentComp: "Yemek Hizmetinden Yararlanan Ã–ÄŸrenci KarÅŸÄ±laÅŸtÄ±rmasÄ±",
    yearlyStudentNote: "YÄ±l toplamÄ± - 1. yÄ±l vs 2. yÄ±l (Ã¶ÄŸrenci)",
    yearlyWasteComp: "AtÄ±k KarÅŸÄ±laÅŸtÄ±rmasÄ± (kg)",
    yearlyWasteNote: "YÄ±l toplamÄ± - 1. yÄ±l vs 2. yÄ±l (kg)",
    yearlyMonthlyProd: "AylÄ±k Ãœretim KarÅŸÄ±laÅŸtÄ±rmasÄ±",
    yearlyMonthlyProdNote: "1. yÄ±l vs 2. yÄ±l - Ã¼retilen yemek sayÄ±sÄ± (porsiyon)",
    yearlyMonthlyTurnstile: "AylÄ±k Turnike GeÃ§iÅŸ KarÅŸÄ±laÅŸtÄ±rmasÄ±",
    yearlyMonthlyTurnstileNote: "1. yÄ±l vs 2. yÄ±l - turnike geÃ§iÅŸ sayÄ±sÄ±",
    yearlyMonthlyStudent: "AylÄ±k Ã–ÄŸrenci Turnike GeÃ§isi KarÅŸÄ±laÅŸtÄ±rmasÄ±",
    yearlyMonthlyStudentNote: "1. yÄ±l vs 2. yÄ±l - Ã¶ÄŸrenci turnike geÃ§iÅŸ sayÄ±sÄ±",
    yearlyMonthlyWaste: "AylÄ±k AtÄ±k KarÅŸÄ±laÅŸtÄ±rmasÄ± (kg)",
    yearlyMonthlyWasteNote: "1. yÄ±l vs 2. yÄ±l - atÄ±k miktarÄ± (kg)",
    yearlyWasteListTitle: "YÄ±llÄ±k AtÄ±k Listesi",
    spendingRatesTitle: "KiÅŸi BaÅŸÄ± Harcama OranlarÄ± (Ã–ÄŸrenci, Personel & Yemek)",
    spendingStudentRate: "Ã–ÄŸrenci BaÅŸÄ± Harcama TutarÄ± (TL)",
    btnSaveStudentRate: "Ã–gr. Tutar Kaydet",
    spendingStaffRate: "Personel BaÅŸÄ± Harcama TutarÄ± (TL)",
    btnSaveStaffRate: "Pers. Tutar Kaydet",
    spendingMealRate: "Yemek BaÅŸÄ± Harcama TutarÄ± (TL)",
    btnSaveMealRate: "Yemek Tutar Kaydet",
    spendingDesc: "Ã–ÄŸrenci Harcama = Ã–ÄŸrenci SayÄ±sÄ± Ã— Ã–ÄŸrenci BaÅŸÄ± Tutar",
    spendingStudentTitle: "Ã–ÄŸrenci Harcama TutarÄ± (TL)",
    spendingChartEmpty: "KayÄ±t girildiÄŸinde grafik gÃ¶sterilecek",
    spendingStudentNote: "Ã–ÄŸrenci Harcama (TL) = Ã–ÄŸrenci SayÄ±sÄ± Ã— Ã–ÄŸrenci BaÅŸÄ± Harcama TutarÄ±",
    spendingStaffTitle: "Personel Harcama TutarÄ± (TL)",
    spendingStaffNote: "Personel Harcama (TL) = Personel SayÄ±sÄ± Ã— Personel BaÅŸÄ± Harcama TutarÄ±",
    spendingMealTitle: "Yemek Harcama TutarÄ± (TL)",
    spendingMealNote: "Yemek Harcama (TL) = Ãœretilen Yemek SayÄ±sÄ± Ã— Yemek BaÅŸÄ± Harcama TutarÄ±",
    spendingTableTitle: "Harcama Hesaplama Tablosu",
    syncTitle: "Supabase Senkronizasyon",
    syncCloseBtn: "Kapat",
    modalNewRecord: "Yeni KayÄ±t Ekle",
    formDate: "Tarih",
    formProducedCount: "Ãœretilen Yemek SayÄ±sÄ±",
    formTurnstileCount: "Turnike GeÃ§iÅŸ SayÄ±sÄ±",
    formStudentCount: "Yemek Hiz. Yar. Ã–ÄŸr. SayÄ±sÄ±",
    formFoodType: "Yemek TÃ¼rÃ¼",
    formAutoCalc: "Otomatik Hesaplamalar",
    badgeAutomatic: "Otomatik",
    badgeFixed: "Sabit",
    badgeAutoEditable: "Otomatik + DÃ¼zenlenebilir",
    btnCancel: "Ä°ptal",
    entryFormSubmit: "Kaydet",
    formReceiptNo: "Makbuz No",
    formOilType: "YaÄŸ TÃ¼rÃ¼",
    formAmountLt: "Miktar (lt)",
    formNote: "Not",
    formWasteType: "AtÄ±k TÃ¼rÃ¼",
    formAmount: "Miktar",
    formDeviceName: "Cihaz AdÄ±",
    formBrandModel: "Marka-Model",
    formSerialNo: "Sicil No",
    formStatus: "Durum",
    formVerification: "DoÄŸrulama",
    formLastCalibration: "Son Kalibrasyon",
    formNextCalibration: "Bir Sonraki Kalibrasyon",
    formLocation: "BulunduÄŸu Yer/BÃ¶lÃ¼m",
    formResponsible: "Sorumlu KiÅŸi",
    btnSave: "Kaydet",
    btnAdd: "Ekle",
    btnClose: "Kapat",
    qrTitle: "QR Kod",
    qrHint: "QR kodu depo kapÄ±larÄ±na asmak iÃ§in yazdÄ±rÄ±n.",
    adminTitle: "YÃ¶netim Paneli",
    adminReAuthText: "Admin paneline eriÅŸim iÃ§in lÃ¼tfen admin ÅŸifrenizi girin.",
    adminPassword: "Admin Åifresi",
    btnVerify: "DoÄŸrula",
    adminSessionRole: "Oturum RolÃ¼",
    adminLastLogin: "Son GiriÅŸ",
    adminAuthMethod: "Auth YÃ¶ntemi",
    adminStorage: "Åifre Deposu",
    adminDataSource: "Veri KaynaÄŸÄ±",
    adminUserMgmt: "KullanÄ±cÄ± YÃ¶netimi",
    adminUserMgmtDesc: "KullanÄ±cÄ±larÄ± ekleyin, dÃ¼zenleyin veya silin.",
    adminAddUser: "Yeni KullanÄ±cÄ± Ekle",
    adminUsername: "KullanÄ±cÄ± AdÄ±",
    adminDisplayName: "GÃ¶rÃ¼nen Ad",
    adminPasswordLabel: "Åifre",
    adminRole: "Rol",
    adminAddUserBtn: "KullanÄ±cÄ± Ekle",
    adminRolePerms: "Rol BazlÄ± Ä°zin AyarlarÄ±",
    adminRolePermsDesc: "Her rol iÃ§in hangi sekmeleri gÃ¶rebileceÄŸini ayarlayÄ±n.",
    adminSecurity: "Oturum GÃ¼venliÄŸi",
    adminSecurityDesc: "Belirtilen sÃ¼re boyunca hiÃ§bir iÅŸlem yapÄ±lmazsa oturum kapanÄ±r.",
    adminInactivityTimeout: "Hareketsizlik Kapanma SÃ¼resi",
    adminLogsTitle: "Ä°ÅŸlem Log KayÄ±tlarÄ±",
    adminLogsDesc: "KullanÄ±cÄ± giriÅŸ/Ã§Ä±kÄ±ÅŸ ve kayÄ±t iÅŸlemleri",
    btnRefresh: "Yenile",
    adminSaveBtn: "AyarlarÄ± Kaydet",
    adminFooterNote: "Åifreler sunucuda kalÄ±cÄ± olarak saklanÄ±r.",
    adminCloseBtn: "Kapat",
    logFilterDelete: "Silme",
    logFilterAddUser: "KullanÄ±cÄ± Ekle",
    logFilterDeleteUser: "KullanÄ±cÄ± Sil",
    adminRefreshBtn: "Yenile",
    manualTitle: "KullanÄ±m KÄ±lavuzu",
    manualSubtitle: "Yemekhane Ãœretim, TÃ¼ketim ve AtÄ±k Kontrol Sistemi",
    compDataType: "Veri TÃ¼rÃ¼",
    compLastWeek: "GeÃ§en Hafta",
    compThisWeek: "Bu Hafta",
    compLastMonth: "GeÃ§en Ay",
    compThisMonth: "Bu Ay",
    compLastYear: "GeÃ§en YÄ±l",
    compThisYear: "Bu YÄ±l",
    compDiff: "Fark",
    compTotalWaste: "Toplam AtÄ±k (kg)",
    compTotalProduction: "Toplam Ãœretim",
    compTurnstilePasses: "Turnike GeÃ§iÅŸ",
    compStudentCount: "Ã–ÄŸrenci SayÄ±sÄ±",
    compWastePerPerson: "KiÅŸi BaÅŸÄ± AtÄ±k (gr)",
    monthlyCompDesc: "Bu ay ile geÃ§en ay karÅŸÄ±laÅŸtÄ±rÄ±lÄ±r. â†‘ artÄ±ÅŸ, â†“ azalÄ±ÅŸ. AtÄ±k ve kiÅŸi baÅŸÄ± atÄ±kta dÃ¼ÅŸÃ¼ÅŸ (â†“) iyidir.",
    yearlyCompDesc: "Bu yÄ±l (yÄ±lbaÅŸÄ±ndan bugÃ¼ne) ile geÃ§en yÄ±lÄ±n aynÄ± dÃ¶nemi karÅŸÄ±laÅŸtÄ±rÄ±lÄ±r. â†‘ artÄ±ÅŸ, â†“ azalÄ±ÅŸ. AtÄ±k ve kiÅŸi baÅŸÄ± atÄ±kta dÃ¼ÅŸÃ¼ÅŸ (â†“) iyidir.",
    monthNames: ["Ocak","Åubat","Mart","Nisan","MayÄ±s","Haziran","Temmuz","AÄŸustos","EylÃ¼l","Ekim","KasÄ±m","AralÄ±k"],
    haccpColDate: "Tarih",
    haccpColTime: "Saat",
    haccpColDepot: "Depo AdÄ±",
    haccpColTemp: "SÄ±caklÄ±k (Â°C)",
    haccpColHumidity: "Nem (%)",
    haccpColNote: "Not",
    haccpColAction: "Ä°ÅŸlem",
    dayNames: ["Pazartesi", "SalÄ±", "Ã‡arÅŸamba", "PerÅŸembe", "Cuma"],
    menuVariety: "Ã‡eÅŸit",
    menuVariety1: "1. Ã‡eÅŸit",
    menuVariety2: "2. Ã‡eÅŸit",
    menuVariety3: "3. Ã‡eÅŸit",
    menuVariety4: "4. Ã‡eÅŸit",
    menuVariety5: "5. Ã‡eÅŸit",
    menuPersonCount: "KiÅŸi SayÄ±sÄ±",
    stockDeductionList: "Stok DÃ¼ÅŸÃ¼m Listesi",
    total: "Toplam",
    inVarieties: "Ã§eÅŸitte",
    person: "kiÅŸi",
    weeklyGrandTotal: "HaftalÄ±k Genel Toplam",
    dailyAverage: "GÃ¼nlÃ¼k Ortalama",
    avgPerPerson: "KiÅŸi BaÅŸÄ± Ortalama",
    totalPersonDays: "Toplam KiÅŸi/GÃ¼n",
    colDay: "GÃ¼n",
    colDate: "Tarih",
    colPerson: "KiÅŸi",
    dailyMaterialCost: "GÃ¼nlÃ¼k Malzeme Maliyeti",
    perPerson: "KiÅŸi BaÅŸÄ±",
    ingredients: "Malzemeler",
    perPersonGram: "(kiÅŸi baÅŸÄ± gram)",
    colIngredient: "Malzeme",
    colPerPerson: "/kiÅŸi",
    colUnit: "Birim",
    addIngredient: "+ Malzeme Ekle",
    foodName: "Yemek AdÄ±",
    allergen: "Alerjen",
    recipePerPerson: "ReÃ§ete (kiÅŸi baÅŸÄ±)",
    devices: "cihaz",
    chartMonthlyProduction: "AylÄ±k Ãœretim (kiÅŸi)",
    chartMonthlyPasses: "AylÄ±k GeÃ§iÅŸ (kiÅŸi)",
    chartMonthlyWaste: "AylÄ±k Ã‡Ã¶pe Giden (porsiyon)",
    chartLastYearWaste: "GeÃ§en YÄ±l Ã‡Ã¶pe Giden (porsiyon)",
    chartMonthlyWasteKg: "AylÄ±k AtÄ±k (kg)",
    chartMonthlyWastePortion: "AylÄ±k AtÄ±k (porsiyon)",
    chartMonthlyMealCount: "AylÄ±k Ãœretim SayÄ±sÄ±",
    chartMonthlyTurnstile: "AylÄ±k Turnike GeÃ§isi",
    chartMonthlyWasteRate: "AylÄ±k AtÄ±k OranÄ± %",
    chartMonthlyStudent: "AylÄ±k Ã–ÄŸrenci SayÄ±sÄ±",
    chartWastePerPersonLabel: "KiÅŸi BaÅŸÄ± AtÄ±k (kg/kiÅŸi)",
    maliTablo: "Mali Tablo",
    maliTabloSubtitle: "HaftalÄ±k Malzeme Maliyeti Ã–zeti",
    maliUnitPriceMissing: "malzemenin birim fiyatÄ± tanÄ±mlÄ± deÄŸil",
    maliUnitPriceHint: "Birim Fiyatlar sekmesinden tanÄ±mlayabilirsiniz",
    weeklyTotal: "HAFTALIK TOPLAM",
    categoryDistribution: "Kategori DaÄŸÄ±lÄ±mÄ±",
    weeklyTotalList: "HaftalÄ±k Toplam Ä°htiyaÃ§ Listesi",
    totalCost: "Toplam Maliyet",
    catMeat: "Et ÃœrÃ¼nleri",
    catDairy: "SÃ¼t ÃœrÃ¼nleri",
    catLegumes: "Kuru Bakliyat",
    catSpices: "Baharatlar",
    catVegetable: "Sebze ve Meyve",
    catOther: "DiÄŸer",
    month1: "Ocak", month2: "Åubat", month3: "Mart", month4: "Nisan",
    month5: "MayÄ±s", month6: "Haziran", month7: "Temmuz", month8: "AÄŸustos",
    month9: "EylÃ¼l", month10: "Ekim", month11: "KasÄ±m", month12: "AralÄ±k",
    menuListTitle: "MENÃœ LÄ°STESÄ°",
    totalDevices: "Toplam Cihaz",
    statusWorking: "Ã‡alÄ±ÅŸÄ±r Durumda",
    statusDefective: "ArÄ±zalÄ±",
    statusMaintenance: "BakÄ±m YapÄ±lacak",
    statusScrap: "Hurdaya AyrÄ±lacak",
    calibrationValid: "Kalibrasyonu GeÃ§erli",
    calibrationApproaching: "Kalibrasyonu YaklaÅŸan (30 GÃ¼n)",
    differentDepartments: "FarklÄ± BÃ¶lÃ¼m",
    statusApproaching: "YaklaÅŸÄ±yor",
    statusExpired: "SÃ¼resi Doldu",
    statusNotDone: "YapÄ±lmadÄ±",
    statusValid: "GeÃ§erli",
    noDeviceFound: "Bu filtreleme kriterlerine uygun cihaz bulunamadÄ±.",
    noDeviceRecord: "HenÃ¼z kalibrasyona tabi cihaz kaydÄ± girilmemiÅŸ.",
    deviceCount: "cihaz",
    deviceCountSuffix: " cihaz",
    editDeviceTitle: "Kalibrasyona Tabi CihazÄ± DÃ¼zenle",
    newDeviceTitle: "Yeni Kalibrasyona Tabi Cihaz",
    kpiBeneficiary: "Yararlanan: ",
    kpiNoRecordToday: "BugÃ¼n kayÄ±t yok",
    kpiAlertsCount: "uyarÄ± var",
    kpiAllValuesOk: "TÃ¼m deÄŸerler uygun",
    kpiDeviceInAlarm: "cihaz alarmda",
    kpiApproaching: "yaklaÅŸÄ±yor",
    kpiAllCalibrationsValid: "TÃ¼m kalibrasyonlar geÃ§erli",
    filterAll: "TÃ¼mÃ¼",
    colDeviceName: "Cihaz AdÄ±",
    colBrandModel: "Marka-Model",
    colSerialNo: "Sicil No",
    colDeviceStatus: "Cihaz Durumu",
    colCalibration: "Kalibrasyon",
    colLastCalibration: "Son Kalibrasyon",
    colNextCalibration: "Bir Sonraki",
    colDepartment: "BÃ¶lÃ¼m",
    colResponsible: "Sorumlu",
    colNote: "Not",
    colAction: "Ä°ÅŸlem",
    unitPriceList: "Birim Fiyat Listesi",
    registeredProducts: "KayÄ±tlÄ± ÃœrÃ¼n",
    totalAmount: "Toplam Tutar",
    avgUnitPrice: "Ortalama Birim Fiyat",
    selectedYear: "SeÃ§ili YÄ±l",
    duplicateWarning: "Ã¼rÃ¼nde tekrar eden kayÄ±t bulundu. Fiyat hesaplamalarÄ±nda hata olabilir.",
    cleanDuplicates: "Tek Tek Temizle",
    colProductName: "ÃœrÃ¼n AdÄ±",
    colUnit: "Birim",
    colUnitPrice: "Birim Fiyat (â‚º)",
    colUnitEquals: "1 Birim =",
    colYear: "YÄ±l",
    noProductsThisYear: "Bu yÄ±l iÃ§in henÃ¼z Ã¼rÃ¼n eklenmemiÅŸ.",
    btnEdit: "DÃ¼zenle",
    btnDelete: "Sil",
    pageLabel: "Sayfa",
    totalProductsLabel: "Toplam",
    totalProductsSuffix: " Ã¼rÃ¼n",
    priceYearNote: "Fiyatlar yÄ±l bazlÄ±dÄ±r. EÅŸleÅŸme: Malzeme adÄ± normalize edilerek otomatik eÅŸleÅŸtirilir.",
    btnAddNewProduct: "+ Yeni ÃœrÃ¼n",
    btnDownloadCSV: "CSV Ä°ndir",
    btnPrint: "YazdÄ±r",
    btnUploadCSV: "CSV YÃ¼kle",
    clickToSelectYear: "TÄ±kla, yÄ±l seÃ§",
    selectYear: "YÄ±l SeÃ§",
    dataInfoRecord: "kayÄ±t",
    dataInfoProduction: "Ã¼retim",
    dataInfoWaste: "atÄ±k",
    portion: "porsiyon",
    abnormalDays: "anormal gÃ¼n",
    noRecordsToDisplay: "GÃ¶sterilecek kayÄ±t bulunamadÄ±.",
    colYearLabel: "YÄ±l",
    avgPortion400: "400 gr",
    recordsNot400: "kayÄ±t 400 deÄŸil",
    gram: " gr",
    personLabel: "KiÅŸi",
    last7RecordsPrev7: "son 7 kayÄ±t / Ã¶nceki 7",
    tempAppropriate: "Uygun",
    tempLow: "DÃ¼ÅŸÃ¼k",
    tempHigh: "YÃ¼ksek",
    lowerLimit: "Alt Limit: ",
    upperLimit: "Ãœst Limit: ",
    unknownDepo: "Bilinmeyen",
    tempMin: "Min: ",
    tempAvg: "Ort: ",
    tempMax: "Maks: ",
    humidity: "Nem: ",
    depot: "Depo",
    selectedCount: " seÃ§ili",
    pageRecords: "Sayfa ",
    recordCount: " kayÄ±t)",
    tempRecordsTitle: "SoÄŸuk Depo SÄ±caklÄ±k KayÄ±tlarÄ±",
    dateRangeLabel: " | Tarih:",
    allDepots: "TÃ¼m depolar",
    colTime: "Saat",
    colDepot: "Depo",
    colTemperature: "SÄ±caklÄ±k",
    colStatus: "Durum",
    depotTempRecordTitle: "Depo SÄ±caklÄ±k KaydÄ±",
    formDate: "Tarih",
    formTime: "Saat",
    formDepotName: "Depo AdÄ±",
    formTemperature: "SÄ±caklÄ±k (Â°C)",
    tempPlaceholder: "0.0 (boÅŸ bÄ±rakÄ±labilir)",
    formHumidity: "Nem (%)",
    formNoteOptional: "Ä°steÄŸe baÄŸlÄ±",
    deleteConfirm: "Bu kaydÄ± silmek istediÄŸinize emin misiniz?",
    deleteSelectedConfirm: "SeÃ§ili ",
    deleteSelectedConfirmSuffix: " kaydÄ± silmek istediÄŸinize emin misiniz?",
    tempHistory: " SÄ±caklÄ±k GeÃ§miÅŸi",
    weeklyAvgTempNote: "HaftalÄ±k ortalama sÄ±caklÄ±k deÄŸerleri â€” alt ve Ã¼st limit Ã§izgileriyle birlikte",
    upperLimitLabel: "Ãœst Limit (",
    lowerLimitLabel: "Alt Limit (",
    totalRecordCount: "Toplam KayÄ±t",
    totalWasteOil: "Toplam AtÄ±k YaÄŸ",
    avgAmountPerRecord: "Ort. Miktar / KayÄ±t",
    highestAmount: "En YÃ¼ksek Miktar",
    lowestAmount: "En DÃ¼ÅŸÃ¼k Miktar",
    oilTypeCount: "YaÄŸ TÃ¼rÃ¼ Ã‡eÅŸidi",
    yearTotalSuffix: " Toplam",
    startDate: "BaÅŸlangÄ±Ã§",
    endDate: "BitiÅŸ",
    typeLabel: "TÃ¼r: ",
    yearLabel: "YÄ±l: ",
    activeFilterLabel: "Aktif filtre: ",
    noFilterMessage: "Filtre yok â€” tÃ¼m atÄ±k yaÄŸ kayÄ±tlarÄ± gÃ¶steriliyor.",
    noWasteOilRecord: "HenÃ¼z atÄ±k yaÄŸ kaydÄ± girilmemiÅŸ.",
    noMatchingFilterRecord: "Bu filtreleme kriterlerine uygun kayÄ±t bulunamadÄ±.",
    editWasteOilRecord: "AtÄ±k YaÄŸ KaydÄ±nÄ± DÃ¼zenle",
    newWasteOilRecord: "Yeni AtÄ±k YaÄŸ KaydÄ±",
    wasteOilChartLabel: "AtÄ±k YaÄŸ",
    previousYearLabel: "Ã–nceki YÄ±l",
    undefinedType: "BelirtilmemiÅŸ",
    totalWastePackaging: "Toplam Ambalaj AtÄ±ÄŸÄ±",
    wasteTypeCount: "AtÄ±k TÃ¼rÃ¼ Ã‡eÅŸidi",
    noWastePackagingRecord: "HenÃ¼z ambalaj atÄ±ÄŸÄ± kaydÄ± girilmemiÅŸ.",
    noMatchingFilterPackage: "Bu filtreleme kriterlerine uygun kayÄ±t bulunamadÄ±.",
    noFilterMessagePackaging: "Filtre yok â€” tÃ¼m ambalaj atÄ±ÄŸÄ± kayÄ±tlarÄ± gÃ¶steriliyor.",
    editWastePackagingRecord: "Ambalaj AtÄ±ÄŸÄ± KaydÄ±nÄ± DÃ¼zenle",
    newWastePackagingRecord: "Yeni Ambalaj AtÄ±ÄŸÄ± KaydÄ±",
    wastePackagingChartLabel: "Ambalaj AtÄ±ÄŸÄ±",
    chartDetailEmpty: "Bu dÃ¶nem iÃ§in kayÄ±t bulunamadÄ±.",
    chartClose: "Kapat",
    chartColProduction: "Ãœretim",
    chartColPasses: "GeÃ§iÅŸ",
    chartColWaste: "AtÄ±k",
    chartColStudent: "Ã–ÄŸrenci",
    chartColFoodType: "Yemek TÃ¼rÃ¼",
    chartProductionVsTurnstile: "Ãœretim ile Turnike GeÃ§iÅŸi ArasÄ±ndaki Fark",
    chartStaffTotal: "Akademik ve Ä°dari + SKS Personeli",
    yearFilterLabel: "YÄ±l:",
    monthFilterLabel: "Ay:",
    chartSelectYear: "SeÃ§iniz",
    year1Label: "1. YÄ±l:",
    year2Label: "2. YÄ±l:",
    noComparison: "KarÅŸÄ±laÅŸtÄ±rma Yok",
    newLabel: "Yeni",
    foodTypeLabel: "Yemek TÃ¼rÃ¼",
    productionLabel: " Ãœretim",
    wasteKgLabel: " AtÄ±k (kg)",
    wasteGrPortionLabel: " AtÄ±k (gr/pors.)",
    diffKgLabel: "Fark (kg)",
    totalRow: "TOPLAM",
    registeredRate: "KayÄ±tlÄ± oran: ",
    unsavedChanges: " (kaydedilmemiÅŸ deÄŸiÅŸiklik)",
    kpiTotalStudentSpending: "Toplam Ã–ÄŸrenci Harcama",
    kpiTotalStaffSpending: "Toplam Personel Harcama",
    kpiAvgMonthlyStudentSpending: "Ort. AylÄ±k Ã–ÄŸr. Harcama",
    kpiAvgMonthlyStaffSpending: "Ort. AylÄ±k Pers. Harcama",
    kpiTotalStudents: "Toplam Ã–ÄŸrenci",
    kpiTotalStaff: "Toplam Personel",
    kpiHighestStudentMonth: "En YÃ¼ksek Ã–ÄŸr. Ay",
    kpiHighestStaffMonth: "En YÃ¼ksek Pers. Ay",
    kpiTotalMealSpending: "Toplam Yemek Harcama",
    kpiAvgMonthlyMealSpending: "Ort. AylÄ±k Yemek Harcama",
    kpiTotalMealsProduced: "Toplam Ãœretilen Yemek",
    kpiHighestMealMonth: "En YÃ¼ksek Yemek Ay",
    chartStudentSpending: "Ã–ÄŸrenci Harcama (â‚º)",
    chartStaffSpending: "Personel Harcama (â‚º)",
    chartMealSpending: "Yemek Harcama (â‚º)",
    noRecordsYet: "HenÃ¼z kayÄ±t yok.",
    invalidRate: "GeÃ§erli bir oran girin!",
    rateSaved: "Oran kaydedildi: ",
    menuStatusDraft: "Taslak",
    menuStatusPending: "Onay Bekliyor",
    menuStatusApproved: "OnaylandÄ±",
    menuStatusRejected: "Reddedildi",
    menuApprove: "MenÃ¼yÃ¼ onayla",
    menuApproveDisabled: "MenÃ¼ henÃ¼z onaya gÃ¶nderilmedi. Diyetisyen \"Onaya GÃ¶nder\"e bastÄ±ÄŸÄ±nda buradan onaylayabilirsiniz.",
    menuReject: "MenÃ¼yÃ¼ gerekÃ§eli olarak reddet",
    menuRejectDisabled: "MenÃ¼ henÃ¼z onaya gÃ¶nderilmedi. Diyetisyen \"Onaya GÃ¶nder\"e bastÄ±ÄŸÄ±nda buradan reddedebilirsiniz.",
    menuPendingCount: " haftanÄ±n menÃ¼sÃ¼ onay bekliyor. Bekleyen haftaya gidip onaylayabilirsiniz.",
    menuNotApproved: "Bu haftanÄ±n menÃ¼sÃ¼ henÃ¼z gÄ±da mÃ¼hendisi tarafÄ±ndan onaylanmadÄ±.",
    menuRejected: "Bu menÃ¼ reddedildi",
    menuRejectedSuffix: ". Diyetisyen dÃ¼zelttikten sonra yeniden onaya gÃ¶nderebilir.",
    menuAwaitingApproval: "Bu menÃ¼ onay bekliyor. Onaylanmadan Ã¼retim listesinde \"onaysÄ±z\" olarak iÅŸaretlenir.",
    noteLabel: "Not ",
    deleteNote: "Bu notu sil",
    addNote: "Yeni not ekle",
    mealPickerTitle: "Yemek SeÃ§",
    clearLabel: "ğŸ—‘ Temizle",
    searchMealPlaceholder: "Yemek ara...",
    noMatchingMeal: "EÅŸleÅŸen yemek bulunamadÄ±.",
    varietyLabel: " Ã‡eÅŸit: ",
    addRecord: "Yeni KayÄ±t Ekle",
    editRecord: "KaydÄ± DÃ¼zenle",
    btnUpdate: "GÃ¼ncelle",
    recordAdded: "KayÄ±t baÅŸarÄ±yla eklendi.",
    recordUpdated: "KayÄ±t baÅŸarÄ±yla gÃ¼ncellendi.",
    recordDeleted: "KayÄ±t silindi.",
    allRecordsDeleted: "TÃ¼m kayÄ±tlar silindi.",
    selectedRecordsDeleted: "SeÃ§ili kayÄ±tlar silindi.",
    noRecordToDelete: "Silinecek kayÄ±t yok.",
    noSelectedRecord: "HiÃ§ kayÄ±t seÃ§ilmedi.",
    deleteAllConfirm: "TÃœM kayÄ±tlarÄ± silmek istediÄŸinize emin misiniz?\nBu iÅŸlem geri alÄ±namaz!",
    deleteFoodConfirm: "Bu yemeÄŸi silmek istediÄŸinize emin misiniz?",
    selected: " seÃ§ili",
    negMeals: "Ãœretilen yemek sayÄ±sÄ± negatif olamaz.",
    negTurnstile: "Turnike geÃ§iÅŸ sayÄ±sÄ± negatif olamaz.",
    negStaff: "Personel sayÄ±sÄ± negatif olamaz.",
    negPortion: "Porsiyon miktarÄ± negatif olamaz.",
    negStudent: "Ã–ÄŸrenci sayÄ±sÄ± negatif olamaz.",
    unsavedConfirm: "KaydedilmemiÅŸ deÄŸiÅŸiklikler var. Kapatmak istediÄŸinize emin misiniz?",
    selectUser: "LÃ¼tfen kullanÄ±cÄ± seÃ§in.",
    wrongCredentials: "KullanÄ±cÄ± adÄ± veya ÅŸifre hatalÄ±.",
    tooManyAttempts: "Ã‡ok fazla deneme. LÃ¼tfen bekleyin.",
    editable: "DÃ¼zenlenebilir",
    fixed: "Sabit",
    menuSentForApproval: "MenÃ¼ onaya gÃ¶nderildi. GÄ±da MÃ¼hendisi/Admin onayÄ± bekleniyor.",
    menuApproved: "MenÃ¼ onaylandÄ±.",
    menuRejectedMsg: "MenÃ¼ gerekÃ§eli olarak reddedildi.",
    menuDraftSaved: "MenÃ¼ taslak olarak kaydedildi.",
    menuCleared: "MenÃ¼ temizlendi.",
    monthShort1: "Oca",
    monthShort2: "Åub",
    monthShort3: "Mar",
    monthShort4: "Nis",
    monthShort5: "May",
    monthShort6: "Haz",
    monthShort7: "Tem",
    monthShort8: "AÄŸu",
    monthShort9: "Eyl",
    monthShort10: "Eki",
    monthShort11: "Kas",
    monthShort12: "Ara"
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
    chartMonthlyTemp: "Monthly Average Depot Temperatures (Â°C)",
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
    spendingDesc: "Student Spending = Student Count Ã— Student Per Person Amount",
    spendingStudentTitle: "Student Spending Amount (TL)",
    spendingChartEmpty: "Charts will appear when records are entered",
    spendingStudentNote: "Student Spending (TL) = Student Count Ã— Student Per Person Spending Amount",
    spendingStaffTitle: "Staff Spending Amount (TL)",
    spendingStaffNote: "Staff Spending (TL) = Staff Count Ã— Staff Per Person Spending Amount",
    spendingMealTitle: "Meal Spending Amount (TL)",
    spendingMealNote: "Meal Spending (TL) = Meals Produced Ã— Per Meal Spending Amount",
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
    monthlyCompDesc: "Comparing this month with last month. â†‘ increase, â†“ decrease. A decrease (â†“) in waste and waste per person is good.",
    yearlyCompDesc: "Comparing this year (year-to-date) with the same period last year. â†‘ increase, â†“ decrease. A decrease (â†“) in waste and waste per person is good.",
    monthNames: ["January","February","March","April","May","June","July","August","September","October","November","December"],
    haccpColDate: "Date",
    haccpColTime: "Time",
    haccpColDepot: "Depot Name",
    haccpColTemp: "Temperature (Â°C)",
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
    maliTablo: "Financial Table",
    maliTabloSubtitle: "Weekly Material Cost Summary",
    maliUnitPriceMissing: "material unit price not defined",
    maliUnitPriceHint: "You can define from the Unit Prices tab",
    weeklyTotal: "WEEKLY TOTAL",
    categoryDistribution: "Category Distribution",
    weeklyTotalList: "Weekly Total Requirements List",
    totalCost: "Total Cost",
    catMeat: "Meat Products",
    catDairy: "Dairy Products",
    catLegumes: "Dry Legumes",
    catSpices: "Spices",
    catVegetable: "Vegetables & Fruits",
    catOther: "Other",
    month1: "January", month2: "February", month3: "March", month4: "April",
    month5: "May", month6: "June", month7: "July", month8: "August",
    month9: "September", month10: "October", month11: "November", month12: "December",
    menuListTitle: "MENU LIST",
    totalDevices: "Total Devices",
    statusWorking: "Working",
    statusDefective: "Defective",
    statusMaintenance: "Needs Maintenance",
    statusScrap: "To Be Scrapped",
    calibrationValid: "Calibration Valid",
    calibrationApproaching: "Calibration Approaching (30 Days)",
    differentDepartments: "Different Departments",
    statusApproaching: "Approaching",
    statusExpired: "Expired",
    statusNotDone: "Not Done",
    statusValid: "Valid",
    noDeviceFound: "No devices found matching these filter criteria.",
    noDeviceRecord: "No calibration device records entered yet.",
    deviceCount: "devices",
    deviceCountSuffix: " devices",
    editDeviceTitle: "Edit Calibration Device",
    newDeviceTitle: "New Calibration Device",
    kpiBeneficiary: "Beneficiaries: ",
    kpiNoRecordToday: "No record today",
    kpiAlertsCount: "alerts",
    kpiAllValuesOk: "All values are within range",
    kpiDeviceInAlarm: "devices in alarm",
    kpiApproaching: "approaching",
    kpiAllCalibrationsValid: "All calibrations are valid",
    filterAll: "All",
    colDeviceName: "Device Name",
    colBrandModel: "Brand-Model",
    colSerialNo: "Serial No",
    colDeviceStatus: "Device Status",
    colCalibration: "Calibration",
    colLastCalibration: "Last Calibration",
    colNextCalibration: "Next",
    colDepartment: "Department",
    colResponsible: "Responsible",
    colNote: "Note",
    colAction: "Action",
    unitPriceList: "Unit Price List",
    registeredProducts: "Registered Products",
    totalAmount: "Total Amount",
    avgUnitPrice: "Average Unit Price",
    selectedYear: "Selected Year",
    duplicateWarning: "products with duplicate records found. Price calculations may have errors.",
    cleanDuplicates: "Clean One by One",
    colProductName: "Product Name",
    colUnit: "Unit",
    colUnitPrice: "Unit Price (â‚º)",
    colUnitEquals: "1 Unit =",
    colYear: "Year",
    noProductsThisYear: "No products added for this year yet.",
    btnEdit: "Edit",
    btnDelete: "Delete",
    pageLabel: "Page",
    totalProductsLabel: "Total",
    totalProductsSuffix: " products",
    priceYearNote: "Prices are year-based. Matching: Material name is auto-matched by normalization.",
    btnAddNewProduct: "+ New Product",
    btnDownloadCSV: "CSV Download",
    btnPrint: "Print",
    btnUploadCSV: "CSV Upload",
    clickToSelectYear: "Click to select year",
    selectYear: "Select Year",
    dataInfoRecord: "records",
    dataInfoProduction: "production",
    dataInfoWaste: "waste",
    portion: "portions",
    abnormalDays: "abnormal days",
    noRecordsToDisplay: "No records to display.",
    colYearLabel: "Year",
    avgPortion400: "400 gr",
    recordsNot400: "records not 400",
    gram: " gr",
    personLabel: "Person",
    last7RecordsPrev7: "last 7 records / previous 7",
    tempAppropriate: "Appropriate",
    tempLow: "Low",
    tempHigh: "High",
    lowerLimit: "Lower Limit: ",
    upperLimit: "Upper Limit: ",
    unknownDepo: "Unknown",
    tempMin: "Min: ",
    tempAvg: "Avg: ",
    tempMax: "Max: ",
    humidity: "Humidity: ",
    depot: "Depot",
    selectedCount: " selected",
    pageRecords: "Page ",
    recordCount: " records)",
    tempRecordsTitle: "Cold Storage Temperature Records",
    dateRangeLabel: " | Date:",
    allDepots: "All depots",
    colTime: "Time",
    colDepot: "Depot",
    colTemperature: "Temperature",
    colStatus: "Status",
    depotTempRecordTitle: "Depot Temperature Record",
    formDate: "Date",
    formTime: "Time",
    formDepotName: "Depot Name",
    formTemperature: "Temperature (Â°C)",
    tempPlaceholder: "0.0 (can be left empty)",
    formHumidity: "Humidity (%)",
    formNoteOptional: "Optional",
    deleteConfirm: "Are you sure you want to delete this record?",
    deleteSelectedConfirm: "Are you sure you want to delete ",
    deleteSelectedConfirmSuffix: " selected records?",
    tempHistory: " Temperature History",
    weeklyAvgTempNote: "Weekly average temperature values â€” with upper and lower limit lines",
    upperLimitLabel: "Upper Limit (",
    lowerLimitLabel: "Lower Limit (",
    totalRecordCount: "Total Records",
    totalWasteOil: "Total Waste Oil",
    avgAmountPerRecord: "Avg. Amount / Record",
    highestAmount: "Highest Amount",
    lowestAmount: "Lowest Amount",
    oilTypeCount: "Oil Type Count",
    yearTotalSuffix: " Total",
    startDate: "Start",
    endDate: "End",
    typeLabel: "Type: ",
    yearLabel: "Year: ",
    activeFilterLabel: "Active filter: ",
    noFilterMessage: "No filter â€” showing all waste oil records.",
    noWasteOilRecord: "No waste oil records entered yet.",
    noMatchingFilterRecord: "No records found matching these filter criteria.",
    editWasteOilRecord: "Edit Waste Oil Record",
    newWasteOilRecord: "New Waste Oil Record",
    wasteOilChartLabel: "Waste Oil",
    previousYearLabel: "Previous Year",
    undefinedType: "Unspecified",
    totalWastePackaging: "Total Packaging Waste",
    wasteTypeCount: "Waste Type Count",
    noWastePackagingRecord: "No packaging waste records entered yet.",
    noMatchingFilterPackage: "No records found matching these filter criteria.",
    noFilterMessagePackaging: "No filter â€” showing all packaging waste records.",
    editWastePackagingRecord: "Edit Packaging Waste Record",
    newWastePackagingRecord: "New Packaging Waste Record",
    wastePackagingChartLabel: "Packaging Waste",
    chartDetailEmpty: "No records found for this period.",
    chartClose: "Close",
    chartColProduction: "Production",
    chartColPasses: "Passes",
    chartColWaste: "Waste",
    chartColStudent: "Students",
    chartColFoodType: "Food Type",
    chartProductionVsTurnstile: "Difference Between Production and Turnstile Passes",
    chartStaffTotal: "Academic & Administrative + SKS Staff",
    yearFilterLabel: "Year:",
    monthFilterLabel: "Month:",
    chartSelectYear: "Select",
    year1Label: "Year 1:",
    year2Label: "Year 2:",
    noComparison: "No Comparison",
    newLabel: "New",
    foodTypeLabel: "Food Type",
    productionLabel: " Production",
    wasteKgLabel: " Waste (kg)",
    wasteGrPortionLabel: " Waste (gr/portion)",
    diffKgLabel: "Diff (kg)",
    totalRow: "TOTAL",
    registeredRate: "Saved rate: ",
    unsavedChanges: " (unsaved changes)",
    kpiTotalStudentSpending: "Total Student Spending",
    kpiTotalStaffSpending: "Total Staff Spending",
    kpiAvgMonthlyStudentSpending: "Avg. Monthly Student Spending",
    kpiAvgMonthlyStaffSpending: "Avg. Monthly Staff Spending",
    kpiTotalStudents: "Total Students",
    kpiTotalStaff: "Total Staff",
    kpiHighestStudentMonth: "Highest Student Month",
    kpiHighestStaffMonth: "Highest Staff Month",
    kpiTotalMealSpending: "Total Meal Spending",
    kpiAvgMonthlyMealSpending: "Avg. Monthly Meal Spending",
    kpiTotalMealsProduced: "Total Meals Produced",
    kpiHighestMealMonth: "Highest Meal Month",
    chartStudentSpending: "Student Spending (â‚º)",
    chartStaffSpending: "Staff Spending (â‚º)",
    chartMealSpending: "Meal Spending (â‚º)",
    noRecordsYet: "No records yet.",
    invalidRate: "Please enter a valid rate!",
    rateSaved: "Rate saved: ",
    menuStatusDraft: "Draft",
    menuStatusPending: "Pending Approval",
    menuStatusApproved: "Approved",
    menuStatusRejected: "Rejected",
    menuApprove: "Approve menu",
    menuApproveDisabled: "Menu has not been submitted for approval yet. When the dietitian clicks \"Submit for Approval\", you can approve from here.",
    menuReject: "Reject menu with reason",
    menuRejectDisabled: "Menu has not been submitted for approval yet. When the dietitian clicks \"Submit for Approval\", you can reject from here.",
    menuPendingCount: " weeks' menus awaiting approval. You can go to the pending week and approve.",
    menuNotApproved: "This week's menu has not been approved by the food engineer yet.",
    menuRejected: "This menu has been rejected",
    menuRejectedSuffix: ". The dietitian can correct and resubmit.",
    menuAwaitingApproval: "This menu is awaiting approval. It will be marked as \"unapproved\" in the production list.",
    noteLabel: "Note ",
    deleteNote: "Delete this note",
    addNote: "Add new note",
    mealPickerTitle: "Select Meal",
    clearLabel: "ğŸ—‘ Clear",
    searchMealPlaceholder: "Search meals...",
    noMatchingMeal: "No matching meals found.",
    varietyLabel: " Variety: ",
    addRecord: "Add New Record",
    editRecord: "Edit Record",
    btnUpdate: "Update",
    recordAdded: "Record added successfully.",
    recordUpdated: "Record updated successfully.",
    recordDeleted: "Record deleted.",
    allRecordsDeleted: "All records deleted.",
    selectedRecordsDeleted: "Selected records deleted.",
    noRecordToDelete: "No record to delete.",
    noSelectedRecord: "No record selected.",
    deleteAllConfirm: "Are you sure you want to delete ALL records?\nThis action cannot be undone!",
    deleteFoodConfirm: "Are you sure you want to delete this food item?",
    selected: " selected",
    negMeals: "Produced meal count cannot be negative.",
    negTurnstile: "Turnstile count cannot be negative.",
    negStaff: "Staff count cannot be negative.",
    negPortion: "Portion amount cannot be negative.",
    negStudent: "Student count cannot be negative.",
    unsavedConfirm: "You have unsaved changes. Are you sure you want to close?",
    selectUser: "Please select a user.",
    wrongCredentials: "Wrong username or password.",
    tooManyAttempts: "Too many attempts. Please wait.",
    editable: "Editable",
    fixed: "Fixed",
    menuSentForApproval: "Menu submitted for approval. Waiting for Food Engineer/Admin approval.",
    menuApproved: "Menu approved.",
    menuRejectedMsg: "Menu rejected with justification.",
    menuDraftSaved: "Menu saved as draft.",
    menuCleared: "Menu cleared.",
    monthShort1: "Jan",
    monthShort2: "Feb",
    monthShort3: "Mar",
    monthShort4: "Apr",
    monthShort5: "May",
    monthShort6: "Jun",
    monthShort7: "Jul",
    monthShort8: "Aug",
    monthShort9: "Sep",
    monthShort10: "Oct",
    monthShort11: "Nov",
    monthShort12: "Dec"
  },
  az: {
    loginSub: "QIDA XÄ°DMÆTLÆRÄ° Ä°DARÆETMÆ SÄ°STEMÄ°",
    loginFormSub: "Daxil olun",
    loginUsername: "Ä°stifadÉ™Ã§i",
    loginSelectUser: "Ä°stifadÉ™Ã§i seÃ§in",
    loginPassword: "ÅifrÉ™",
    loginBtn: "Daxil ol",
    loginHint: "ÅifrÉ™nizi administratorunuzdan ala bilÉ™rsiniz",
    loginFeature1: "Menyu PlanlamasÄ±, GÃ¼nlÃ¼k Ä°stehsal, Ä°stehlak vÉ™ TullantÄ± Ä°zlÉ™mÉ™",
    loginFeature2: "ÆtraflÄ± Hesabatlar",
    loginFeature3: "CanlÄ± Panel vÉ™ QrafiklÉ™r",
    menuLabel: "Menyu",
    headerSubtitle: "Qida XidmÉ™tlÉ™ri Ä°darÉ™etmÉ™ Sistemi",
    btnLogout: "Ã‡Ä±xÄ±ÅŸ",
    btnPrev: "ÆvvÉ™lki",
    btnNext: "NÃ¶vbÉ™ti",
    loading: "YÃ¼klÉ™nir...",
    loadingText: "MÉ™lumatlar sinxronlaÅŸdÄ±rÄ±lÄ±r...",
    loadingSub: "Supabase baÄŸlantÄ±sÄ± yoxlanÄ±lÄ±r",
    loadingSkip: "KeÃ§mÉ™k Ã¼Ã§Ã¼n kliklÉ™yin",
    versionLabel: "TÉ™tbiq VersiyasÄ±",
    sidebarPanel: "Panel",
    sidebarMenu: "HÉ™ftÉ™lik Menyu",
    sidebarRecords: "QeydlÉ™r",
    sidebarReport: "Hesabat",
    sidebarHaccp: "Qida TÉ™hlÃ¼kÉ™sizliyi",
    sidebarCalibration: "KalibrlÉ™mÉ™",
    sidebarOil: "TullantÄ± YaÄŸÄ±",
    sidebarPackaging: "QablaÅŸdÄ±rma TullantÄ±larÄ±",
    sidebarCharts: "QrafiklÉ™r",
    sidebarYearly: "Ä°llik MÃ¼qayisÉ™",
    sidebarSpending: "XÉ™rclÉ™r",
    sidebarUnitPrice: "Vahid QiymÉ™tlÉ™r",
    sidebarDownload: "HamÄ±sÄ±nÄ± YÃ¼klÉ™",
    sidebarBackup: "Supabase-É™ YedeklÉ™",
    sidebarRestore: "Supabase-dÉ™n Ã‡É™k",
    sidebarAdmin: "Ä°darÉ™etmÉ™",
    sidebarLogs: "Jurnal QeydlÉ™ri",
    sidebarTheme: "MÃ¶vzu",
    sidebarManual: "Ä°stifadÉ™Ã§i TÉ™limatÄ±",
    dashboardPrintPdf: "PDF Ã‡ap Et",
    kpiTotalRecords: "Ãœmumi Ä°stehsal GÃ¼nÃ¼",
    kpiTodayProduction: "Bu gÃ¼nÃ¼n Ä°stehsalÄ±",
    kpiHaccpAlarm: "Soyuducu Anbar Temperaturu AlarmÄ±",
    kpiCalibrationAlarm: "KalibrlÉ™mÉ™ AlarmÄ±",
    kpiAvgWaste: "Ort. TullantÄ± (kg)",
    kpiTotalPasses: "Toplam Turnike KeÃ§idi",
    kpiTotalWaste: "Ãœmumi TullantÄ± (kg)",
    kpiWasteRate: "TullantÄ± NisbÉ™ti",
    weeklyPrevBtn: "ÆvvÉ™lki HÉ™ftÉ™",
    weeklySummary: "HÉ™ftÉ™lik XÃ¼lasÉ™",
    weeklyNextBtn: "NÃ¶vbÉ™ti HÉ™ftÉ™",
    weeklyBadge: "Bu HÉ™ftÉ™",
    dailyPrevBtn: "ÆvvÉ™lki GÃ¼n",
    dailySummary: "GÃ¼nlÃ¼k Detay",
    dailyNextBtn: "NÃ¶vbÉ™ti GÃ¼n",
    weeklyCompTitle: "HÉ™ftÉ™lik MÃ¼qayisÉ™",
    monthlyCompTitle: "AylÄ±q MÃ¼qayisÉ™",
    monthlyBadge: "Bu Ay",
    yearlyBadge: "Bu Ä°l",
    anomalyTitle: "Anomaliya AÅŸkarlanmasÄ±",
    anomalyBadge: "Anormal TullantÄ± GÃ¼nlÉ™ri",
    lastRecordsTitle: "Son QeydlÉ™r",
    dashboardGoToRecords: "QeydlÉ™rÉ™ Get",
    emptyDashboard: "HÉ™lÉ™ qeyd yoxdur...",
    formulaTitle: "TULLANTI HESABLAMA FORMULU",
    recordsEntryBtn: "Ä°stehsal Ä°stehlak Gir",
    recordsImportBtn: "Ä°dxal",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "CSV YÃ¼klÉ™",
    recordsDeleteBtn: "SeÃ§ilÉ™nlÉ™ri Sil",
    emptyRecords: "GÃ¶stÉ™rilÉ™cÉ™k qeyd tapÄ±lmadÄ±.",
    thDate: "Tarix",
    thProducedPerson: "Ä°stehsal olunan YemÉ™k (ÅÉ™xs)",
    thWaste10: "%10 TullantÄ±",
    thBeneficiary: "YemÉ™k Xidm. Faydalanan Personnel vÉ™ TÉ™lÉ™bÉ™",
    thPortionGr: "Porsiyon (g)",
    thWasteKg: "TullantÄ± (kg)",
    thWastedPortion: "ZibilÉ™ gedÉ™n (pors.)",
    thFoodType: "YemÉ™k NÃ¶vÃ¼",
    thAction: "ÆmÉ™liyyat",
    thAcademicStaff: "TurnikÉ™ KeÃ§É™n Akademik vÉ™ Ä°darÉ™Ã§i Personnel",
    thStudentCount: "TurnikÉ™ KeÃ§É™n TÉ™lÉ™bÉ™ sayÄ±",
    thBeneficiaryTotal: "YemÉ™k Xidm. Faydalanan Toplam ÅÉ™xs",
    sksStaff: "SKS YemÉ™k XidmÉ™ti PersonnelÄ±",
    summaryReport: "XÃ¼lasÉ™ HesabatÄ±",
    reportPdfBtn: "PDF AÃ§",
    allRecordsPrint: "BÃ¼tÃ¼n QeydlÉ™r (Ã‡ap GÃ¶rÃ¼nÃ¼ÅŸÃ¼)",
    rTotalRecords: "Toplam Qeyd sayÄ±",
    rTotalMeals: "Toplam Ä°stehsal Olunan YemÉ™k",
    rTotalWaste10: "Toplam %10 TullantÄ±",
    rTotalAfterWaste: "Toplam %10 TullantÄ± SonrasÄ± YemÉ™k",
    rTotalTurnstile: "Toplam Turnike KeÃ§idi",
    rTotalBeneficiary: "YemÉ™k Xidm. Faydalanan Toplam ÅÉ™xs",
    rTotalStaff: "Faydalanan Toplam SKS PersonnelÄ±",
    rPortionSize: "Porsiyon HÉ™cmi (g)",
    rTotalPortion: "Toplam Porsiyon (g)",
    rWastedPortion: "ZibilÉ™ GedÉ™n Porsiyon",
    rMaxWeeklyBeneficiary: "Æn YÃ¼ksÉ™k HÉ™ftÉ™lik Faydalanan ÅÉ™xs",
    rTotalWasteKg: "Toplam TullantÄ± MiqdarÄ± (kg)",
    rAvgWasteKg: "Ort. TullantÄ± MiqdarÄ± (kg)",
    rTotalStudents: "Toplam TÉ™lÉ™bÉ™ sayÄ±",
    rMaxWaste: "Æn YÃ¼ksÉ™k TullantÄ± (kg)",
    rMinWaste: "Æn aÅŸaÄŸÄ± TullantÄ± (kg)",
    rWasteTrend: "TullantÄ± Trendi (son 7 gÃ¼n)",
    rBeneficiaryTrend: "Faydalanan Trendi (son 7 gÃ¼n)",
    wasteByFoodTitle: "YemÉ™k NÃ¶vÃ¼ Ã¼zrÉ™ TullantÄ± TÉ™hlili",
    wasteByFoodEmpty: "YemÉ™k nÃ¶vÃ¼ mÉ™lumatÄ± olan qeyd tapÄ±lmadÄ±.",
    wasteByFoodRecords: "Qeyd sayÄ±",
    wasteByFoodRate: "TullantÄ± nisbÉ™ti",
    wasteByFoodPerPerson: "ÅÉ™xs baÅŸÄ±na tullantÄ± (kg)",
    wsProducedMeal: "Ä°stehsal olunan yemÉ™k (nÉ™fÉ™r)",
    wsTotalPasses: "Ãœmumi keÃ§iÅŸ",
    wsTurnstile: "Turniket",
    wsStaffSKS: "SKS personalÄ±",
    wsWasteAmount: "TullantÄ± miqdarÄ±",
    wsWastedPortion: "Ã‡Ã¶pe gedÉ™n",
    wsStudents: "YemÉ™k xidm. tÉ™lÉ™bÉ™lÉ™ri",
    wsNoRecordsYet: "HÉ™lÉ™ qeyd yoxdur",
    wsNoRecordThisWeek: "Bu hÉ™ftÉ™ qeyd yoxdur",
    wsNoRecordToday: "Qeyd yoxdur",
    wsTodayDetail: "Bu gÃ¼nÃ¼n tÉ™fÉ™rrÃ¼atÄ±",
    wsDailyDetail: "GÃ¼nlÃ¼k tÉ™fÉ™rrÃ¼at",
    wsWaste: "Ä°tki",
    wsPortion: "porsiya",
    wsProduced: "Ä°stehsal",
    wsTurnstileCount: "Turniket keÃ§idi",
    wsStaffCount: "Personal",
    menuTitle: "HÉ™ftÉ™lik Menyu SiyahÄ±sÄ±",
    menuStatusBadge: "VÉ™ziyyÉ™t",
    menuSaveBtn: "Saxla",
    menuSendBtn: "TÉ™sdiqÉ™ GÃ¶ndÉ™r",
    menuApproveBtn: "TÉ™sdiqlÉ™",
    menuRejectBtn: "RÉ™dd et",
    menuWithdrawBtn: "TÉ™sdiqi Geri Al",
    menuClearBtn: "CÉ™dvÉ™li TÉ™mizlÉ™",
    menuPrintBtn: "Ã‡ap Et",
    menuFoodListBtn: "YemÉ™k SiyahÄ±sÄ±",
    menuFoodListUploadBtn: "CSV YÃ¼klÉ™",
    menuFoodListCsvBtn: "CSV YÃ¼klÉ™",
    menuWarningPrefix: "TÉ™sdiqlÉ™nmÉ™miÅŸ Menyu:",
    menuWarningText: "Bu hÉ™ftÉ™nin menyusu hÉ™lÉ™ qida mÃ¼hÉ™ndisi tÉ™rÉ™findÉ™n tÉ™sdiqlÉ™nmÉ™yib.",
    menuHintText: "YemÉ™k adlarÄ±nÄ± yazÄ±n...",
    productNeedsTitle: "MÉ™hsul EhtiyatÄ± SiyahÄ±sÄ±",
    weeklyNeedsTitle: "HÉ™ftÉ™lik Toplam Ehtiyat SiyahÄ±sÄ±",
    foodListTitle: "YemÉ™k SiyahÄ±sÄ±",
    modalRejectMenu: "Menyunu RÉ™dd Et",
    modalRejectDesc: "RÉ™dd sÉ™bÉ™bi mÉ™cburidir.",
    menuRejectConfirm: "RÉ™dd et",
    haccpTitle: "Qida TÉ™hlÃ¼kÉ™sizliyi Ä°darÉ™etmÉ™si",
    haccpCsvBtn: "CSV YÃ¼klÉ™",
    haccpColdStorage: "Soyuducu Anbar Temperaturu QeydlÉ™ri",
    haccpNewBtn: "Yeni Qeyd",
    haccpDepotBtn: "Anbar AdlarÄ±",
    haccpDepoQrNote: "Anbar adlarÄ±nÄ± redaktÉ™ edib QR dÃ¼ymÉ™si ilÉ™ hÉ™r anbar Ã¼Ã§Ã¼n QR kod yarada bilÉ™rsiniz.",
    haccpModalTitle: "Yeni Qeyd",
    filterDepot: "Anbar Filtri:",
    filterAll: "HamÄ±sÄ±",
    filterDateRange: "Tarix AralÄ±ÄŸÄ±:",
    emptyHaccp: "HÉ™lÉ™ temperatur qeydi daxil edilmÉ™yib.",
    btnDeleteSelectedHaccp: "SeÃ§ilÉ™nlÉ™ri Sil",
    btnPdf: "PDF",
    depoNamesTitle: "Anbar AdlarÄ±",
    oilNewBtn: "Yeni Qeyd",
    oilListBtn: "SiyahÄ±",
    oilFilterTitle: "TullantÄ± YaÄŸÄ± FiltrlÉ™ri",
    filterOilType: "YaÄŸ NÃ¶vÃ¼:",
    btnReset: "SÄ±fÄ±rla",
    oilSummaryTitle: "TullantÄ± YaÄŸÄ± XÃ¼lasÉ™si",
    oilChartTitle: "TullantÄ± YaÄŸÄ± QrafiklÉ™ri",
    oilChartSubtitle: "AylÄ±q TullantÄ± YaÄŸÄ± MiqdarÄ± (lt)",
    oilChartEmpty: "TullantÄ± yaÄŸÄ± qeydi daxil edildikdÉ™ qrafik gÃ¶stÉ™rilÉ™cÉ™k",
    oilChartNote: "Tarix, yaÄŸ nÃ¶vÃ¼ vÉ™ il filtrlÉ™rinÉ™ gÃ¶rÉ™ aylÄ±q tullantÄ± yaÄŸÄ± cÉ™mlÉ™ri",
    oilRecordsTitle: "TullantÄ± YaÄŸÄ± QeydlÉ™ri",
    oilModalTitle: "TullantÄ± YaÄŸÄ± Qeydi",
    emptyOil: "HÉ™lÉ™ tullantÄ± yaÄŸÄ± qeydi daxil edilmÉ™yib.",
    ambalajNewBtn: "Yeni Qeyd",
    ambalajListBtn: "SiyahÄ±",
    packagingFilterTitle: "QablaÅŸdÄ±rma TullantÄ±sÄ± FiltrlÉ™ri",
    filterWasteType: "TullantÄ± NÃ¶vÃ¼:",
    packagingSummaryTitle: "QablaÅŸdÄ±rma TullantÄ±sÄ± XÃ¼lasÉ™si",
    packagingChartTitle: "QablaÅŸdÄ±rma TullantÄ±sÄ± QrafiklÉ™ri",
    packagingChartSubtitle: "AylÄ±q QablaÅŸdÄ±rma TullantÄ±sÄ± MiqdarÄ± (kg)",
    packagingChartEmpty: "QablaÅŸdÄ±rma tullantÄ±sÄ± qeydi daxil edildikdÉ™ qrafik gÃ¶stÉ™rilÉ™cÉ™k",
    packagingChartNote: "Tarix, tullantÄ± nÃ¶vÃ¼ vÉ™ il filtrlÉ™rinÉ™ gÃ¶rÉ™ aylÄ±q qablaÅŸdÄ±rma tullantÄ±sÄ± cÉ™mlÉ™ri (kg)",
    packagingRecordsTitle: "QablaÅŸdÄ±rma TullantÄ±larÄ± QeydlÉ™ri",
    packagingModalTitle: "QablaÅŸdÄ±rma TullantÄ±sÄ± Qeydi",
    emptyPackaging: "HÉ™lÉ™ qablaÅŸdÄ±rma tullantÄ±sÄ± qeydi daxil edilmÉ™yib.",
    kalibrasyonNewBtn: "Yeni Cihaz",
    kalibrasyonListBtn: "SiyahÄ±",
    kalibrasyonCsvBtn: "CSV YÃ¼klÉ™",
    calibrationSummary: "KalibrlÉ™mÉ™ XÃ¼lasÉ™si",
    calibrationDevices: "KalibrlÉ™mÉ™yÉ™ Tabi Cihazlar",
    calibrationModalTitle: "KalibrlÉ™mÉ™yÉ™ Tabi Cihaz",
    filterStatus: "VÉ™ziyyÉ™t:",
    filterDepartment: "ÅÃ¶bÉ™:",
    btnWordExport: "Word-É™ Ä°xrac",
    btnPrint: "PDF Ã‡ap Et",
    chartProdWaste: "Ä°stehsal - KeÃ§id - TullantÄ± MÃ¼qayisÉ™si",
    chartEmpty: "MÉ™lumat daxil edildikdÉ™ qrafik gÃ¶stÉ™rilÉ™cÉ™k",
    chartProdWasteNote: "Ä°stehsal, turnike keÃ§idi vÉ™ ZibilÉ™ GedÉ™n porsiyonun aylÄ±q mÃ¼qayisÉ™si",
    chartStudentCount: "Qida XidmÉ™tlÉ™rindÉ™n Faydalan TÉ™lÉ™bÉ™ sayÄ±",
    yearTotal: "Ä°l CÉ™mi",
    chartStudentNote: "GÃ¼nlÃ¼k tÉ™lÉ™bÉ™ keÃ§idlÉ™rinin aylÄ±q cÉ™mi",
    chartStaffTotal: "Akademik vÉ™ Ä°darÉ™Ã§i + SKS Personnel CÉ™mi",
    chartStaffNote: "Akademik vÉ™ Ä°darÉ™Ã§i (Turnike - TÉ™lÉ™bÉ™) ilÉ™ SKS YemÉ™k XidmÉ™ti PersonnelÄ± cÉ™mi",
    chartMonthlyProd: "AylÄ±q YemÉ™k Ä°stehsalÄ±",
    chartMonthlyProdNote: "GÃ¼nlÃ¼k istehsal olunan yemÉ™k sayÄ±larÄ±nÄ±n aylÄ±q cÉ™mi",
    chartMonthlyTurnstile: "AylÄ±q Turnike KeÃ§id SaylarÄ±",
    chartTurnstileNote: "TÉ™lÉ™bÉ™ + personnel + xarici keÃ§id cÉ™mi",
    chartMonthlyWaste: "AylÄ±q TullantÄ± MiqdarÄ± (kg)",
    chartMonthlyWasteNote: "GÃ¼nlÃ¼k tullantÄ±larÄ±n aylÄ±q cÉ™mi (kg)",
    chartMonthlyWastePortion: "AylÄ±q TullantÄ± MiqdarÄ± (porsiyon)",
    chartWastePortionNote: "GÃ¼nlÃ¼k ZibilÉ™ GedÉ™n porsiyonlarÄ±n aylÄ±q cÉ™mi",
    chartDiff: "Ä°stehsal ilÉ™ KeÃ§id ArasÄ±ndakÄ± FÉ™rq",
    chartDiffNote: "Ä°stehsal olunan yemÉ™k sayÄ± ilÉ™ turnike keÃ§idi arasÄ±ndakÄ± fÉ™rq",
    chartWasteRatio: "Ä°stehsal Olunan YemÉ™yÉ™ Oranla TullantÄ± %",
    yearAverage: "Ä°l OrtalamasÄ±",
    chartWasteRatioNote: "Ä°stehsal olunan yemÉ™yin faizi nÉ™ qÉ™dÉ™r tullantÄ± olur",
    chartWastePerPerson: "ÅÉ™xs BaÅŸÄ±na TullantÄ± (kg/ÅŸÉ™xs)",
    chartWastePerPersonNote: "MÃ¼É™ssisÉ™yÉ™ daxil olan ÅŸÉ™xs baÅŸÄ±na dÃ¼ÅŸÉ™n orta tullantÄ±",
    chartMonthlyTemp: "AylÄ±q Ortalama Anbar TemperaturlarÄ± (Â°C)",
    chartTempEmpty: "Temperatur qeydi daxil edildikdÉ™ qrafik gÃ¶stÉ™rilÉ™cÉ™k",
    chartTempNote: "HÉ™r anbarÄ±n aylÄ±q orta temperaturu",
    yearlyPdfBtn: "PDF Ã‡ap Et",
    yearlyTotalProd: "Toplam Ä°stehsal MÃ¼qayisÉ™si",
    yearlyTotalProdNote: "Ä°l cÉ™mi - 1. il vs 2. il (porsiyon)",
    yearlyTotalBen: "YemÉ™k Xidm. Faydalanan Toplam ÅÉ™xs",
    yearlyTotalBenNote: "Ä°l cÉ™mi - 1. il vs 2. il (toplam ÅŸÉ™xs)",
    yearlyStudentComp: "YemÉ™k XidmÉ™tindÉ™n Faydalan TÉ™lÉ™bÉ™ MÃ¼qayisÉ™si",
    yearlyStudentNote: "Ä°l cÉ™mi - 1. il vs 2. il (tÉ™lÉ™bÉ™)",
    yearlyWasteComp: "TullantÄ± MÃ¼qayisÉ™si (kg)",
    yearlyWasteNote: "Ä°l cÉ™mi - 1. il vs 2. il (kg)",
    yearlyMonthlyProd: "AylÄ±q Ä°stehsal MÃ¼qayisÉ™si",
    yearlyMonthlyProdNote: "1. il vs 2. il - istehsal olunan yemÉ™k sayÄ± (porsiyon)",
    yearlyMonthlyTurnstile: "AylÄ±q Turnike KeÃ§id MÃ¼qayisÉ™si",
    yearlyMonthlyTurnstileNote: "1. il vs 2. il - turnike keÃ§id sayÄ±",
    yearlyMonthlyStudent: "AylÄ±q TÉ™lÉ™bÉ™ Turnike KeÃ§idi MÃ¼qayisÉ™si",
    yearlyMonthlyStudentNote: "1. il vs 2. il - tÉ™lÉ™bÉ™ turnike keÃ§id sayÄ±",
    yearlyMonthlyWaste: "AylÄ±q TullantÄ± MÃ¼qayisÉ™si (kg)",
    yearlyMonthlyWasteNote: "1. il vs 2. il - tullantÄ± miqdarÄ± (kg)",
    yearlyWasteListTitle: "Ä°llik TullantÄ± SiyahÄ±sÄ±",
    spendingRatesTitle: "ÅÉ™xs BaÅŸÄ±na XÉ™rc NisbÉ™tlÉ™ri (TÉ™lÉ™bÉ™, Personnel & YemÉ™k)",
    spendingStudentRate: "TÉ™lÉ™bÉ™ BaÅŸÄ±na XÉ™rc MÉ™blÉ™ÄŸi (TL)",
    btnSaveStudentRate: "TÉ™lÉ™bÉ™ MÉ™blÉ™ÄŸini Saxla",
    spendingStaffRate: "Personnel BaÅŸÄ±na XÉ™rc MÉ™blÉ™ÄŸi (TL)",
    btnSaveStaffRate: "Personnel MÉ™blÉ™ÄŸini Saxla",
    spendingMealRate: "YemÉ™k BaÅŸÄ±na XÉ™rc MÉ™blÉ™ÄŸi (TL)",
    btnSaveMealRate: "YemÉ™k MÉ™blÉ™ÄŸini Saxla",
    spendingDesc: "TÉ™lÉ™bÉ™ XÉ™rci = TÉ™lÉ™bÉ™ sayÄ± Ã— TÉ™lÉ™bÉ™ BaÅŸÄ±na MÉ™blÉ™ÄŸ",
    spendingStudentTitle: "TÉ™lÉ™bÉ™ XÉ™rc MÉ™blÉ™ÄŸi (TL)",
    spendingChartEmpty: "Qeyd daxil edildikdÉ™ qrafik gÃ¶stÉ™rilÉ™cÉ™k",
    spendingStudentNote: "TÉ™lÉ™bÉ™ XÉ™rci (TL) = TÉ™lÉ™bÉ™ sayÄ± Ã— TÉ™lÉ™bÉ™ BaÅŸÄ±na XÉ™rc MÉ™blÉ™ÄŸi",
    spendingStaffTitle: "Personnel XÉ™rc MÉ™blÉ™ÄŸi (TL)",
    spendingStaffNote: "Personnel XÉ™rci (TL) = Personnel sayÄ± Ã— Personnel BaÅŸÄ±na XÉ™rc MÉ™blÉ™ÄŸi",
    spendingMealTitle: "YemÉ™k XÉ™rc MÉ™blÉ™ÄŸi (TL)",
    spendingMealNote: "YemÉ™k XÉ™rci (TL) = Ä°stehsal olunan YemÉ™k sayÄ± Ã— YemÉ™k BaÅŸÄ±na XÉ™rc MÉ™blÉ™ÄŸi",
    spendingTableTitle: "XÉ™rc Hesablama CÉ™dvÉ™li",
    syncTitle: "Supabase SinxronizasiyasÄ±",
    syncCloseBtn: "BaÄŸla",
    modalNewRecord: "Yeni Qeyd ÆlavÉ™ Et",
    formDate: "Tarix",
    formProducedCount: "Ä°stehsal Olunan YemÉ™k sayÄ±",
    formTurnstileCount: "Turnike KeÃ§id sayÄ±",
    formStudentCount: "YemÉ™k Xidm. Fayd. TÉ™lÉ™bÉ™ sayÄ±",
    formFoodType: "YemÉ™k NÃ¶vÃ¼",
    formAutoCalc: "Avtomatik Hesablamalar",
    badgeAutomatic: "Avtomatik",
    badgeFixed: "Sabit",
    badgeAutoEditable: "Avtomatik + RedaktÉ™ EdilÉ™ bilÉ™n",
    btnCancel: "LÉ™ÄŸv et",
    entryFormSubmit: "Saxla",
    formReceiptNo: "QÉ™buz NÃ¶mrÉ™si",
    formOilType: "YaÄŸ NÃ¶vÃ¼",
    formAmountLt: "Miqdar (lt)",
    formNote: "Qeyd",
    formWasteType: "TullantÄ± NÃ¶vÃ¼",
    formAmount: "Miqdar",
    formDeviceName: "Cihaz AdÄ±",
    formBrandModel: "Brend-Model",
    formSerialNo: "Seriya NÃ¶mrÉ™si",
    formStatus: "VÉ™ziyyÉ™t",
    formVerification: "DoÄŸrulama",
    formLastCalibration: "Son KalibrlÉ™mÉ™",
    formNextCalibration: "NÃ¶vbÉ™ti KalibrlÉ™mÉ™",
    formLocation: "Yer/ÅÃ¶bÉ™",
    formResponsible: "MÉ™sul ÅÉ™xs",
    btnSave: "Saxla",
    btnAdd: "ÆlavÉ™ et",
    btnClose: "BaÄŸla",
    qrTitle: "QR Kod",
    qrHint: "QR kodu anbar qapÄ±larÄ±na asmaq Ã¼Ã§Ã¼n Ã§ap edin.",
    adminTitle: "Ä°darÉ™etmÉ™ Paneli",
    adminReAuthText: "Ä°darÉ™etmÉ™ panelinÉ™ daxil olmaq Ã¼Ã§Ã¼n admin ÅŸifrÉ™nizi daxil edin.",
    adminPassword: "Admin ÅifrÉ™si",
    btnVerify: "DoÄŸrula",
    adminSessionRole: "Oturum Rollu",
    adminLastLogin: "Son GiriÅŸ",
    adminAuthMethod: "Auth Metodu",
    adminStorage: "ÅifrÉ™ AnbarÄ±",
    adminDataSource: "MÉ™lumat MÉ™nbÉ™yi",
    adminUserMgmt: "Ä°stifadÉ™Ã§i Ä°darÉ™etmÉ™si",
    adminUserMgmtDesc: "Ä°stifadÉ™Ã§ilÉ™ri É™lavÉ™ edin, redaktÉ™ edin vÉ™ ya silin.",
    adminAddUser: "Yeni Ä°stifadÉ™Ã§i ÆlavÉ™ Et",
    adminUsername: "Ä°stifadÉ™Ã§i AdÄ±",
    adminDisplayName: "GÃ¶rÃ¼nÉ™n Ad",
    adminPasswordLabel: "ÅifrÉ™",
    adminRole: "Rol",
    adminAddUserBtn: "Ä°stifadÉ™Ã§i ÆlavÉ™ Et",
    adminRolePerms: "Rollara Æsaslanan Ä°zin ParametrlÉ™ri",
    adminRolePermsDesc: "HÉ™r rol Ã¼Ã§Ã¼n hansÄ± sekmeleri gÃ¶rÉ™ bilÉ™cÉ™yini tÉ™yin edin.",
    adminSecurity: "Oturum TÉ™hlÃ¼kÉ™sizliyi",
    adminSecurityDesc: "GÃ¶stÉ™rilÉ™n mÃ¼ddÉ™t É™rzindÉ™ heÃ§ bir É™mÉ™liyyat aparÄ±lmazsa oturum baÄŸlanacaq.",
    adminInactivityTimeout: "HÉ™rÉ™kÉ™tsizlik BaÄŸlanma MÃ¼ddÉ™ti",
    adminLogsTitle: "ÆmÉ™liyyat Jurnal QeydlÉ™ri",
    adminLogsDesc: "Ä°stifadÉ™Ã§i giriÅŸ/Ã§ixÄ±ÅŸ vÉ™ qeyd É™mÉ™liyyatlarÄ±",
    btnRefresh: "YenilÉ™",
    adminSaveBtn: "ParametrlÉ™ri Saxla",
    adminFooterNote: "ÅifrÉ™lÉ™r serverdÉ™ daimi olaraq saxlanÄ±lÄ±r.",
    adminCloseBtn: "BaÄŸla",
    logFilterDelete: "SilmÉ™",
    logFilterAddUser: "Ä°stifadÉ™Ã§i ÆlavÉ™ Et",
    logFilterDeleteUser: "Ä°stifadÉ™Ã§i Sil",
    adminRefreshBtn: "YenilÉ™",
    manualTitle: "Ä°stifadÉ™Ã§i TÉ™limatÄ±",
    manualSubtitle: "MÃ¼É™ssisÉ™ Ä°stehsalÄ±, Ä°stehlakÄ± vÉ™ TullantÄ± NÉ™zarÉ™t Sistemi",
    compDataType: "MÉ™lumat NÃ¶vÃ¼",
    compLastWeek: "KeÃ§É™n HÉ™ftÉ™",
    compThisWeek: "Bu HÉ™ftÉ™",
    compLastMonth: "KeÃ§É™n Ay",
    compThisMonth: "Bu Ay",
    compLastYear: "KeÃ§É™n Ä°l",
    compThisYear: "Bu Ä°l",
    compDiff: "FÉ™rq",
    compTotalWaste: "Ãœmumi TullantÄ± (kg)",
    compTotalProduction: "Ãœmumi Ä°stehsal",
    compTurnstilePasses: "Turnike KeÃ§idi",
    compStudentCount: "TÉ™lÉ™bÉ™ SayÄ±",
    compWastePerPerson: "AdambaÅŸÄ±na TullantÄ± (qr)",
    monthlyCompDesc: "Bu ay keÃ§É™n ay ilÉ™ mÃ¼qayisÉ™ olunur. â†‘ artÄ±m, â†“ azalma. TullantÄ± vÉ™ adambaÅŸÄ±na tullantÄ±da azalma (â†“) yaxÅŸÄ±dÄ±r.",
    yearlyCompDesc: "Bu il (ilin É™vvÉ™lindÉ™n bu gÃ¼nÉ™) keÃ§É™n ilin eyni dÃ¶vrÃ¼ ilÉ™ mÃ¼qayisÉ™ olunur. â†‘ artÄ±m, â†“ azalma. TullantÄ± vÉ™ adambaÅŸÄ±na tullantÄ±da azalma (â†“) yaxÅŸÄ±dÄ±r.",
    monthNames: ["Yanvar","Fevral","Mart","Aprel","May","Ä°yun","Ä°yul","Avqust","Sentyabr","Oktyabr","Noyabr","Dekabr"],
    haccpColDate: "Tarix",
    haccpColTime: "Saat",
    haccpColDepot: "Anbar adÄ±",
    haccpColTemp: "Temperatur (Â°C)",
    haccpColHumidity: "RÃ¼tubÉ™t (%)",
    haccpColNote: "Qeyd",
    haccpColAction: "ÆmÉ™liyyat",
    dayNames: ["Bazar ertÉ™si", "Ã‡É™rÅŸÉ™nbÉ™ axÅŸamÄ±", "Ã‡É™rÅŸÉ™nbÉ™", "CÃ¼mÉ™ axÅŸamÄ±", "CÃ¼mÉ™"],
    menuVariety: "NÃ¶v",
    menuVariety1: "1 nÃ¶v",
    menuVariety2: "2 nÃ¶v",
    menuVariety3: "3 nÃ¶v",
    menuVariety4: "4 nÃ¶v",
    menuVariety5: "5 nÃ¶v",
    menuPersonCount: "ÅÉ™xs sayÄ±",
    stockDeductionList: "Stok SiyahÄ±sÄ±",
    total: "CÉ™mi",
    inVarieties: "nÃ¶vdÉ™",
    person: "nÉ™fÉ™r",
    weeklyGrandTotal: "HÉ™ftÉ™lik Ãœmumi CÉ™mi",
    dailyAverage: "GÃ¼nlÃ¼k Orta",
    avgPerPerson: "NÉ™fÉ™r BaÅŸÄ±na Orta",
    totalPersonDays: "CÉ™mi NÉ™fÉ™r/GÃ¼n",
    colDay: "GÃ¼n",
    colDate: "Tarix",
    colPerson: "NÉ™fÉ™r",
    dailyMaterialCost: "GÃ¼nlÃ¼k Material XÉ™rci",
    perPerson: "NÉ™fÉ™r BaÅŸÄ±na",
    ingredients: "Materiallar",
    perPersonGram: "(nÉ™fÉ™r baÅŸÄ± qr)",
    colIngredient: "Material",
    colPerPerson: "/nÉ™fÉ™r",
    colUnit: "Vahid",
    addIngredient: "+ Material ÆlavÉ™ Et",
    foodName: "YemÉ™yin AdÄ±",
    allergen: "Allergen",
    recipePerPerson: "Resept (nÉ™fÉ™r baÅŸÄ±)",
    devices: "cihaz",
    chartMonthlyProduction: "Aylýq Ýstehsal (nǽfǽr)",
    chartMonthlyPasses: "Aylýq Keçid (nǽfǽr)",
    chartLastYearWaste: "Keçǽn Ýl Çöpǽ Gedǽn (porsiya)",
    chartMonthlyWasteKg: "Aylýq Tullantý (kg)",
    chartMonthlyMealCount: "Aylýq Ýstehsal Sayý",
    chartMonthlyWasteRate: "Aylýq Tullantý Nisbǽti %",
    chartMonthlyStudent: "Aylýq Tǽlǽbǽ Sayý",
    chartWastePerPersonLabel: "Nǽfǽr Baþýna Tullantý (kg/nǽfǽr)",
    maliTablo: "Mali CÉ™dvÉ™l",
    maliTabloSubtitle: "HÉ™ftÉ™lik Material XÉ™rclÉ™ri XÃ¼lasÉ™si",
    maliUnitPriceMissing: "materialÄ±n vahid qiymÉ™ti tÉ™yin olunmayÄ±b",
    maliUnitPriceHint: "Vahid QiymÉ™tlÉ™r bÃ¶lmÉ™sindÉ™n tÉ™yin edÉ™ bilÉ™rsiniz",
    weeklyTotal: "HÆFTÆLÄ°K CÆMÄ°",
    categoryDistribution: "Kateqoriya PaylanmasÄ±",
    weeklyTotalList: "HÉ™ftÉ™lik Ãœmumi Ehtiyac SiyahÄ±sÄ±",
    totalCost: "Ãœmumi XÉ™rc",
    catMeat: "Æt MÉ™hsullarÄ±",
    catDairy: "SÃ¼t MÉ™hsullarÄ±",
    catLegumes: "Quru Bulqar",
    catSpices: "Ædviyyatlar",
    catVegetable: "TÉ™rÉ™vÉ™z vÉ™ MeyvÉ™",
    catOther: "DigÉ™r",
    month1: "Yanvar", month2: "Fevral", month3: "Mart", month4: "Aprel",
    month5: "May", month6: "Ä°yun", month7: "Ä°yul", month8: "Avqust",
    month9: "Sentyabr", month10: "Oktyabr", month11: "Noyabr", month12: "Dekabr",
    menuListTitle: "MENYU SÄ°YAHISI",
    totalDevices: "Ãœmumi Cihaz",
    statusWorking: "Ä°ÅŸlÉ™yir",
    statusDefective: "Nasaz",
    statusMaintenance: "TÉ™mir LazÄ±m",
    statusScrap: "Xarabaya Ã‡Ä±karÄ±lacaq",
    calibrationValid: "KalibrlÉ™mÉ™ KeÃ§É™rli",
    calibrationApproaching: "KalibrlÉ™mÉ™ YaxÄ±nlaÅŸÄ±r (30 GÃ¼n)",
    differentDepartments: "FÉ™rqli BÃ¶lmÉ™",
    statusApproaching: "YaxÄ±nlaÅŸÄ±r",
    statusExpired: "MÃ¼ddÉ™ti Bitdi",
    statusNotDone: "EdilmÉ™yib",
    statusValid: "KeÃ§É™rli",
    noDeviceFound: "Bu filtrlÉ™mÉ™ meyarlarÄ±na uyÄŸun cihaz tapÄ±lmadÄ±.",
    noDeviceRecord: "HÉ™lÉ™ kalibrlÉ™mÉ™yÉ™ tabe cihaz qeydi daxil edilmÉ™yib.",
    deviceCount: "cihaz",
    deviceCountSuffix: " cihaz",
    editDeviceTitle: "KalibrlÉ™mÉ™ CihazÄ±nÄ± RedaktÉ™ Et",
    newDeviceTitle: "Yeni KalibrlÉ™mÉ™ CihazÄ±",
    kpiBeneficiary: "FaydalanÄ±lan: ",
    kpiNoRecordToday: "Bu gÃ¼n qeyd yoxdur",
    kpiAlertsCount: "xÉ™bÉ™rdarlÄ±q var",
    kpiAllValuesOk: "BÃ¼tÃ¼n dÉ™yÉ™rlÉ™r uyÄŸundur",
    kpiDeviceInAlarm: "cihaz alarmda",
    kpiApproaching: "yaxÄ±nlaÅŸÄ±r",
    kpiAllCalibrationsValid: "BÃ¼tÃ¼n kalibrlÉ™mÉ™lÉ™r keÃ§É™rlidir",
    filterAll: "HamÄ±sÄ±",
    colDeviceName: "Cihaz AdÄ±",
    colBrandModel: "Marka-Model",
    colSerialNo: "Sicil NÃ¶mrÉ™si",
    colDeviceStatus: "Cihaz VÉ™ziyyÉ™ti",
    colCalibration: "KalibrlÉ™mÉ™",
    colLastCalibration: "Son KalibrlÉ™mÉ™",
    colNextCalibration: "NÃ¶vbÉ™ti",
    colDepartment: "BÃ¶lmÉ™",
    colResponsible: "MÉ™sul",
    colNote: "Qeyd",
    colAction: "ÆmÉ™liyyat",
    unitPriceList: "Vahid QiymÉ™t SiyahÄ±sÄ±",
    registeredProducts: "QeydiyyatlÄ± MÉ™hsul",
    totalAmount: "Ãœmumi MÉ™blÉ™ÄŸ",
    avgUnitPrice: "Orta Vahid QiymÉ™t",
    selectedYear: "SeÃ§ilmiÅŸ Ä°l",
    duplicateWarning: "mÉ™hsulda tÉ™krar qeyd tapÄ±ldÄ±. QiymÉ™t hesablamalarÄ±nda xÉ™ta ola bilÉ™r.",
    cleanDuplicates: "TÉ™k-tÉ™k TÉ™mizlÉ™",
    colProductName: "MÉ™hsul AdÄ±",
    colUnit: "Vahid",
    colUnitPrice: "Vahid QiymÉ™t (â‚º)",
    colUnitEquals: "1 Vahid =",
    colYear: "Ä°l",
    noProductsThisYear: "Bu il Ã¼Ã§Ã¼n hÉ™lÉ™ mÉ™hsul É™lavÉ™ edilmÉ™yib.",
    btnEdit: "RedaktÉ™",
    btnDelete: "Sil",
    pageLabel: "SÉ™hifÉ™",
    totalProductsLabel: "Ãœmumi",
    totalProductsSuffix: " mÉ™hsul",
    priceYearNote: "QiymÉ™tlÉ™r il Ã¼zrÉ™dir. EÅŸleÅŸmÉ™: Material adÄ± avtomatik normallaÅŸdÄ±rÄ±lÄ±r.",
    btnAddNewProduct: "+ Yeni MÉ™hsul",
    btnDownloadCSV: "CSV YÃ¼klÉ™",
    btnPrint: "Ã‡ap",
    btnUploadCSV: "CSV YÃ¼klÉ™",
    clickToSelectYear: "Ä°l seÃ§mÉ™k Ã¼Ã§Ã¼n basÄ±n",
    selectYear: "Ä°l SeÃ§",
    dataInfoRecord: "qeyd",
    dataInfoProduction: "istehsal",
    dataInfoWaste: "tullantÄ±",
    portion: "porsiya",
    abnormalDays: "anormal gÃ¼n",
    noRecordsToDisplay: "GÃ¶stÉ™rilÉ™cÉ™k qeyd tapÄ±lmadÄ±.",
    colYearLabel: "Ä°l",
    avgPortion400: "400 q",
    recordsNot400: "qeyd 400 deyil",
    gram: " q",
    personLabel: "ÅÉ™xs",
    last7RecordsPrev7: "son 7 qeyd / É™vvÉ™lki 7",
    tempAppropriate: "UyÄŸun",
    tempLow: "AÅŸaÄŸÄ±",
    tempHigh: "YÃ¼ksÉ™k",
    lowerLimit: "Alt Limit: ",
    upperLimit: "Ãœst Limit: ",
    unknownDepo: "NamÉ™lum",
    tempMin: "Min: ",
    tempAvg: "Orta: ",
    tempMax: "Maks: ",
    humidity: "NÉ™mlik: ",
    depot: "Anbar",
    selectedCount: " seÃ§ildi",
    pageRecords: "SÉ™hifÉ™ ",
    recordCount: " qeyd)",
    tempRecordsTitle: "Soyuducu Anbar Temperatur QeydlÉ™ri",
    dateRangeLabel: " | Tarix:",
    allDepots: "BÃ¼tÃ¼n anbarlar",
    colTime: "Vaxt",
    colDepot: "Anbar",
    colTemperature: "Temperatur",
    colStatus: "VÉ™ziyyÉ™t",
    depotTempRecordTitle: "Anbar Temperatur Qeydi",
    formDate: "Tarix",
    formTime: "Vaxt",
    formDepotName: "Anbar AdÄ±",
    formTemperature: "Temperatur (Â°C)",
    tempPlaceholder: "0.0 (boÅŸ qoya bilÉ™rsiniz)",
    formHumidity: "NÉ™mlik (%)",
    formNoteOptional: "Ä°stÉ™yÉ™ gÃ¶rÉ™",
    deleteConfirm: "Bu qeydi silmÉ™k istÉ™diyinizÉ™ É™minsiniz?",
    deleteSelectedConfirm: "SeÃ§ilmiÅŸ ",
    deleteSelectedConfirmSuffix: " qeydi silmÉ™k istÉ™diyinizÉ™ É™minsiniz?",
    tempHistory: " Temperatur TarixÃ§É™si",
    weeklyAvgTempNote: "HÉ™ftÉ™lik orta temperatur dÉ™yÉ™rlÉ™ri â€” alt vÉ™ Ã¼st limit xÉ™tlÉ™ri ilÉ™",
    upperLimitLabel: "Ãœst Limit (",
    lowerLimitLabel: "Alt Limit (",
    totalRecordCount: "Ãœmumi Qeyd",
    totalWasteOil: "Ãœmumi AtÄ±k YaÄŸ",
    avgAmountPerRecord: "Ort. Miqdar / Qeyd",
    highestAmount: "Æn YÃ¼ksÉ™k Miqdar",
    lowestAmount: "Æn AÅŸaÄŸÄ± Miqdar",
    oilTypeCount: "YaÄŸ NÃ¶vÃ¼ SayÄ±",
    yearTotalSuffix: " CÉ™mi",
    startDate: "BaÅŸlanÄŸÄ±c",
    endDate: "BitiÅŸ",
    typeLabel: "NÃ¶v: ",
    yearLabel: "Ä°l: ",
    activeFilterLabel: "Aktiv filter: ",
    noFilterMessage: "Filter yox â€” bÃ¼tÃ¼n atÄ±k yaÄŸ qeydlÉ™ri gÃ¶stÉ™rilir.",
    noWasteOilRecord: "HÉ™lÉ™ atÄ±k yaÄŸ qeydi daxil edilmÉ™yib.",
    noMatchingFilterRecord: "Bu filter meyarlarÄ±na uyÄŸun qeyd tapÄ±lmadÄ±.",
    editWasteOilRecord: "AtÄ±k YaÄŸ Qeydini RedaktÉ™ Et",
    newWasteOilRecord: "Yeni AtÄ±k YaÄŸ Qeydi",
    wasteOilChartLabel: "AtÄ±k YaÄŸ",
    previousYearLabel: "ÆvvÉ™lki Ä°l",
    undefinedType: "MÃ¼É™yyÉ™n edilmÉ™yib",
    totalWastePackaging: "Ãœmumi Ambalaj AtÄ±ÄŸÄ±",
    wasteTypeCount: "AtÄ±k NÃ¶vÃ¼ SayÄ±",
    noWastePackagingRecord: "HÉ™lÉ™ ambalaj atÄ±ÄŸÄ± qeydi daxil edilmÉ™yib.",
    noMatchingFilterPackage: "Bu filter meyarlarÄ±na uyÄŸun qeyd tapÄ±lmadÄ±.",
    noFilterMessagePackaging: "Filter yox â€” bÃ¼tÃ¼n ambalaj atÄ±ÄŸÄ± qeydlÉ™ri gÃ¶stÉ™rilir.",
    editWastePackagingRecord: "Ambalaj AtÄ±ÄŸÄ± Qeydini RedaktÉ™ Et",
    newWastePackagingRecord: "Yeni Ambalaj AtÄ±ÄŸÄ± Qeydi",
    wastePackagingChartLabel: "Ambalaj AtÄ±ÄŸÄ±",
    chartDetailEmpty: "Bu dÃ¶vr Ã¼Ã§Ã¼n qeyd tapÄ±lmadÄ±.",
    chartClose: "BaÄŸla",
    chartColProduction: "Ä°stehsal",
    chartColPasses: "KeÃ§iÅŸ",
    chartColWaste: "AtÄ±k",
    chartColStudent: "TÉ™lÉ™bÉ™",
    chartColFoodType: "YemÉ™k NÃ¶vÃ¼",
    chartProductionVsTurnstile: "Ä°stehsal ilÉ™ Turnike KeÃ§iÅŸi ArasÄ±ndakÄ± FÉ™rq",
    chartStaffTotal: "Akademik vÉ™ Ä°dari + SKS PersonalÄ±",
    yearFilterLabel: "Ä°l:",
    monthFilterLabel: "Ay:",
    chartSelectYear: "SeÃ§in",
    year1Label: "1. Ä°l:",
    year2Label: "2. Ä°l:",
    noComparison: "MÃ¼qayisÉ™ Yoxdur",
    newLabel: "Yeni",
    foodTypeLabel: "YemÉ™k NÃ¶vÃ¼",
    productionLabel: " Ä°stehsal",
    wasteKgLabel: " AtÄ±k (kq)",
    wasteGrPortionLabel: " AtÄ±k (q/porsiya)",
    diffKgLabel: "FÉ™rq (kq)",
    totalRow: "CÆMÄ°",
    registeredRate: "QeydiyyatlÄ± nisbÉ™t: ",
    unsavedChanges: " (yadda saxlanÄ±lmamÄ±ÅŸ dÉ™yiÅŸiklik)",
    kpiTotalStudentSpending: "Ãœmumi TÉ™lÉ™bÉ™ XÉ™rci",
    kpiTotalStaffSpending: "Ãœmumi Personal XÉ™rci",
    kpiAvgMonthlyStudentSpending: "Ort. AylÄ±q TÉ™lÉ™bÉ™ XÉ™rci",
    kpiAvgMonthlyStaffSpending: "Ort. AylÄ±q Personal XÉ™rci",
    kpiTotalStudents: "Ãœmumi TÉ™lÉ™bÉ™",
    kpiTotalStaff: "Ãœmumi Personal",
    kpiHighestStudentMonth: "Æn YÃ¼ksÉ™k TÉ™lÉ™bÉ™ AyÄ±",
    kpiHighestStaffMonth: "Æn YÃ¼ksÉ™k Personal AyÄ±",
    kpiTotalMealSpending: "Ãœmumi YemÉ™k XÉ™rci",
    kpiAvgMonthlyMealSpending: "Ort. AylÄ±q YemÉ™k XÉ™rci",
    kpiTotalMealsProduced: "Ãœmumi Ä°stehsal OlunmuÅŸ YemÉ™k",
    kpiHighestMealMonth: "Æn YÃ¼ksÉ™k YemÉ™k AyÄ±",
    chartStudentSpending: "TÉ™lÉ™bÉ™ XÉ™rci (â‚º)",
    chartStaffSpending: "Personal XÉ™rci (â‚º)",
    chartMealSpending: "YemÉ™k XÉ™rci (â‚º)",
    noRecordsYet: "HÉ™lÉ™ qeyd yoxdur.",
    invalidRate: "KeÃ§É™rli nisbÉ™t daxil edin!",
    rateSaved: "NisbÉ™t yadda saxlandÄ±: ",
    menuStatusDraft: "Qaralama",
    menuStatusPending: "TÉ™sdiq GÃ¶zlÉ™yir",
    menuStatusApproved: "TÉ™sdiqlÉ™ndi",
    menuStatusRejected: "RÉ™dd edildi",
    menuApprove: "Menyunu tÉ™sdiqlÉ™",
    menuApproveDisabled: "Menyu hÉ™lÉ™ tÉ™sdiqÉ™ gÃ¶ndÉ™rilmÉ™yib. Diyetoloq \"TÉ™sdiqÉ™ GÃ¶ndÉ™r\"É™ basanda buradan tÉ™sdiqlÉ™yÉ™ bilÉ™rsiniz.",
    menuReject: "Menyunu É™saslandÄ±raraq rÉ™dd et",
    menuRejectDisabled: "Menyu hÉ™lÉ™ tÉ™sdiqÉ™ gÃ¶ndÉ™rilmÉ™yib. Diyetoloq \"TÉ™sdiqÉ™ GÃ¶ndÉ™r\"É™ basanda buradan rÉ™dd edÉ™ bilÉ™rsiniz.",
    menuPendingCount: " hÉ™ftÉ™ menyusu tÉ™sdiq gÃ¶zlÉ™yir. GÃ¶zlÉ™yÉ™n hÉ™ftÉ™yÉ™ gedib tÉ™sdiqlÉ™yÉ™ bilÉ™rsiniz.",
    menuNotApproved: "Bu hÉ™ftÉ™nin menyusu hÉ™lÉ™ qida mÃ¼hÉ™ndisi tÉ™rÉ™findÉ™n tÉ™sdiqlÉ™nmÉ™yib.",
    menuRejected: "Bu menyu rÉ™dd edilib",
    menuRejectedSuffix: ". Diyetoloq dÃ¼zÉ™liÅŸ edib yenidÉ™n gÃ¶ndÉ™rÉ™ bilÉ™r.",
    menuAwaitingApproval: "Bu menyu tÉ™sdiq gÃ¶zlÉ™yir. TÉ™sdiqlÉ™nmÉ™dÉ™n istehsal siyahÄ±sÄ±nda \"tÉ™sdiqsiz\" kimi qeyd olunur.",
    noteLabel: "Qeyd ",
    deleteNote: "Bu qeydi sil",
    addNote: "Yeni qeyd É™lavÉ™ et",
    mealPickerTitle: "YemÉ™k SeÃ§",
    clearLabel: "ğŸ—‘ TÉ™mizlÉ™",
    searchMealPlaceholder: "YemÉ™k axtar...",
    noMatchingMeal: "UyÄŸun yemÉ™k tapÄ±lmadÄ±.",
    varietyLabel: " NÃ¶v: ",
    addRecord: "Yeni Qeyd ÆlavÉ™ Et",
    editRecord: "Qeydi RedaktÉ™ Et",
    btnUpdate: "YenilÉ™",
    recordAdded: "Qeyd uÄŸurla É™lavÉ™ olundu.",
    recordUpdated: "Qeyd uÄŸurla yenilÉ™ndi.",
    recordDeleted: "Qeyd silindi.",
    allRecordsDeleted: "BÃ¼tÃ¼n qeydlÉ™r silindi.",
    selectedRecordsDeleted: "SeÃ§ilmiÅŸ qeydlÉ™r silindi.",
    noRecordToDelete: "SilmÉ™k Ã¼Ã§Ã¼n qeyd yoxdur.",
    noSelectedRecord: "HeÃ§ bir qeyd seÃ§ilmÉ™yib.",
    deleteAllConfirm: "BÃ¼tÃ¼n qeydlÉ™ri silmÉ™k istÉ™diyinizÉ™ É™minsiniz?\nBu É™mÉ™liyyat geri alÄ±na bilmÉ™z!",
    deleteFoodConfirm: "Bu yemÉ™yi silmÉ™k istÉ™diyinizÉ™ É™minsiniz?",
    selected: " seÃ§ilmiÅŸ",
    negMeals: "Ä°stehsal olunan yemÉ™k sayÄ± mÉ™nfi ola bilmÉ™z.",
    negTurnstile: "Turniket sayÄ± mÉ™nfi ola bilmÉ™z.",
    negStaff: "HeyÉ™t sayÄ± mÉ™nfi ola bilmÉ™z.",
    negPortion: "Porsiya miqdarÄ± mÉ™nfi ola bilmÉ™z.",
    negStudent: "TÉ™lÉ™bÉ™ sayÄ± mÉ™nfi ola bilmÉ™z.",
    unsavedConfirm: "Qeyd edilmÉ™miÅŸ dÉ™yiÅŸikliklÉ™r var. BaÄŸlamaq istÉ™diyinizÉ™ É™minsiniz?",
    selectUser: "ZÉ™hmÉ™t olmasa istifadÉ™Ã§i seÃ§in.",
    wrongCredentials: "Ä°stifadÉ™Ã§i adÄ± vÉ™ ya ÅŸifrÉ™ yanlÄ±ÅŸdÄ±r.",
    tooManyAttempts: "Ã‡ox sayda cÉ™hd. ZÉ™hmÉ™t olmasa gÃ¶zlÉ™yin.",
    editable: "RedaktÉ™ oluna bilÉ™r",
    fixed: "Sabit",
    menuSentForApproval: "Menyu tÉ™sdiqÉ™ gÃ¶ndÉ™rildi. Qida MÃ¼hÉ™ndisi/Ä°nzibatÃ§Ä± tÉ™sdiqi gÃ¶zlÉ™nilir.",
    menuApproved: "Menyu tÉ™sdiqlÉ™ndi.",
    menuRejectedMsg: "Menyu É™saslandÄ±rÄ±lmÄ±ÅŸ olaraq rÉ™dd edildi.",
    menuDraftSaved: "Menyu qaralama olaraq yadda saxlanÄ±ldÄ±.",
    menuCleared: "Menyu tÉ™mizlÉ™ndi.",
    monthShort1: "Yan",
    monthShort2: "Fev",
    monthShort3: "Mar",
    monthShort4: "Apr",
    monthShort5: "May",
    monthShort6: "Ä°yun",
    monthShort7: "Ä°yul",
    monthShort8: "Avq",
    monthShort9: "Sen",
    monthShort10: "Okt",
    monthShort11: "Noy",
    monthShort12: "Dek"
  },
  ru: {
    loginSub: "Ğ¡Ğ˜Ğ¡Ğ¢Ğ•ĞœĞ Ğ£ĞŸĞ ĞĞ’Ğ›Ğ•ĞĞ˜Ğ¯ ĞŸĞ˜Ğ¢ĞĞĞ˜Ğ•Ğœ",
    loginFormSub: "Ğ’Ğ¾Ğ¹Ñ‚Ğ¸",
    loginUsername: "ĞŸĞ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»ÑŒ",
    loginSelectUser: "Ğ’Ñ‹Ğ±ĞµÑ€Ğ¸Ñ‚Ğµ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»Ñ",
    loginPassword: "ĞŸĞ°Ñ€Ğ¾Ğ»ÑŒ",
    loginBtn: "Ğ’Ğ¾Ğ¹Ñ‚Ğ¸",
    loginHint: "ĞŸĞ°Ñ€Ğ¾Ğ»ÑŒ Ğ¼Ğ¾Ğ¶Ğ½Ğ¾ Ğ¿Ğ¾Ğ»ÑƒÑ‡Ğ¸Ñ‚ÑŒ Ñƒ Ğ°Ğ´Ğ¼Ğ¸Ğ½Ğ¸ÑÑ‚Ñ€Ğ°Ñ‚Ğ¾Ñ€Ğ°",
    loginFeature1: "ĞœĞµĞ½Ñ, ĞµĞ¶ĞµĞ´Ğ½ĞµĞ²Ğ½Ğ¾Ğµ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ¾, Ğ¿Ğ¾Ñ‚Ñ€ĞµĞ±Ğ»ĞµĞ½Ğ¸Ğµ Ğ¸ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ñ‹",
    loginFeature2: "ĞŸĞ¾Ğ´Ñ€Ğ¾Ğ±Ğ½Ñ‹Ğµ Ğ¾Ñ‚Ñ‡Ñ‘Ñ‚Ñ‹",
    loginFeature3: "Ğ–Ğ¸Ğ²Ğ°Ñ Ğ¿Ğ°Ğ½ĞµĞ»ÑŒ Ğ¸ Ğ³Ñ€Ğ°Ñ„Ğ¸ĞºĞ¸",
    menuLabel: "ĞœĞµĞ½Ñ",
    headerSubtitle: "Ğ¡Ğ¸ÑÑ‚ĞµĞ¼Ğ° ÑƒĞ¿Ñ€Ğ°Ğ²Ğ»ĞµĞ½Ğ¸Ñ ÑĞ»ÑƒĞ¶Ğ±Ğ°Ğ¼Ğ¸ Ğ¿Ğ¸Ñ‚Ğ°Ğ½Ğ¸Ñ",
    btnLogout: "Ğ’Ñ‹Ñ…Ğ¾Ğ´",
    btnPrev: "ĞĞ°Ğ·Ğ°Ğ´",
    btnNext: "Ğ”Ğ°Ğ»ĞµĞµ",
    loading: "Ğ—Ğ°Ğ³Ñ€ÑƒĞ·ĞºĞ°...",
    loadingText: "Ğ¡Ğ¸Ğ½Ñ…Ñ€Ğ¾Ğ½Ğ¸Ğ·Ğ°Ñ†Ğ¸Ñ Ğ´Ğ°Ğ½Ğ½Ñ‹Ñ…...",
    loadingSub: "ĞŸÑ€Ğ¾Ğ²ĞµÑ€ĞºĞ° Ğ¿Ğ¾Ğ´ĞºĞ»ÑÑ‡ĞµĞ½Ğ¸Ñ Supabase",
    loadingSkip: "ĞĞ°Ğ¶Ğ¼Ğ¸Ñ‚Ğµ Ğ´Ğ»Ñ Ğ¿Ñ€Ğ¾Ğ¿ÑƒÑĞºĞ°",
    versionLabel: "Ğ’ĞµÑ€ÑĞ¸Ñ Ğ¿Ñ€Ğ¸Ğ»Ğ¾Ğ¶ĞµĞ½Ğ¸Ñ",
    sidebarPanel: "ĞŸĞ°Ğ½ĞµĞ»ÑŒ",
    sidebarMenu: "ĞœĞµĞ½Ñ Ğ½Ğ° Ğ½ĞµĞ´ĞµĞ»Ñ",
    sidebarRecords: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸",
    sidebarReport: "ĞÑ‚Ñ‡Ñ‘Ñ‚",
    sidebarHaccp: "Ğ‘ĞµĞ·Ğ¾Ğ¿Ğ°ÑĞ½Ğ¾ÑÑ‚ÑŒ Ğ¿Ğ¸Ñ‰Ğ¸",
    sidebarCalibration: "ĞšĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ°",
    sidebarOil: "ĞÑ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğµ Ğ¼Ğ°ÑĞ»Ğ¾",
    sidebarPackaging: "Ğ£Ğ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ğµ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ñ‹",
    sidebarCharts: "Ğ“Ñ€Ğ°Ñ„Ğ¸ĞºĞ¸",
    sidebarYearly: "Ğ“Ğ¾Ğ´Ğ¾Ğ²Ğ¾Ğµ ÑÑ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ",
    sidebarSpending: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹",
    sidebarUnitPrice: "Ğ•Ğ´Ğ¸Ğ½Ğ¸Ñ‡Ğ½Ñ‹Ğµ Ñ†ĞµĞ½Ñ‹",
    sidebarDownload: "Ğ¡ĞºĞ°Ñ‡Ğ°Ñ‚ÑŒ Ğ²ÑÑ‘",
    sidebarBackup: "Ğ ĞµĞ·ĞµÑ€Ğ²Ğ½Ğ¾Ğµ ĞºĞ¾Ğ¿Ğ¸Ñ€Ğ¾Ğ²Ğ°Ğ½Ğ¸Ğµ",
    sidebarRestore: "Ğ’Ğ¾ÑÑÑ‚Ğ°Ğ½Ğ¾Ğ²Ğ¸Ñ‚ÑŒ Ğ¸Ğ· Supabase",
    sidebarAdmin: "ĞĞ´Ğ¼Ğ¸Ğ½Ğ¸ÑÑ‚Ñ€Ğ¸Ñ€Ğ¾Ğ²Ğ°Ğ½Ğ¸Ğµ",
    sidebarLogs: "Ğ–ÑƒÑ€Ğ½Ğ°Ğ»Ñ‹",
    sidebarTheme: "Ğ¢ĞµĞ¼Ğ°",
    sidebarManual: "Ğ ÑƒĞºĞ¾Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ¾ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»Ñ",
    dashboardPrintPdf: "ĞŸĞµÑ‡Ğ°Ñ‚ÑŒ PDF",
    kpiTotalRecords: "Ğ’ÑĞµĞ³Ğ¾ Ğ´Ğ½ĞµĞ¹ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ°",
    kpiTodayProduction: "ĞŸÑ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ¾ ÑĞµĞ³Ğ¾Ğ´Ğ½Ñ",
    kpiHaccpAlarm: "Ğ¢Ñ€ĞµĞ²Ğ¾Ğ³Ğ° Ñ‚ĞµĞ¼Ğ¿ĞµÑ€Ğ°Ñ‚ÑƒÑ€Ñ‹ Ñ…Ğ¾Ğ»Ğ¾Ğ´Ğ¸Ğ»ÑŒĞ½Ğ¸ĞºĞ°",
    kpiCalibrationAlarm: "Ğ¢Ñ€ĞµĞ²Ğ¾Ğ³Ğ° ĞºĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ¸",
    kpiAvgWaste: "Ğ¡Ñ€ĞµĞ´Ğ½. Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ñ‹ (ĞºĞ³)",
    kpiTotalPasses: "Ğ’ÑĞµĞ³Ğ¾ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ¾Ğ² Ñ‡ĞµÑ€ĞµĞ· Ñ‚ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚",
    kpiTotalWaste: "Ğ’ÑĞµĞ³Ğ¾ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (ĞºĞ³)",
    kpiWasteRate: "ĞŸÑ€Ğ¾Ñ†ĞµĞ½Ñ‚ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    weeklyPrevBtn: "ĞŸÑ€ĞµĞ´Ñ‹Ğ´ÑƒÑ‰Ğ°Ñ Ğ½ĞµĞ´ĞµĞ»Ñ",
    weeklySummary: "Ğ¡Ğ²Ğ¾Ğ´ĞºĞ° Ğ·Ğ° Ğ½ĞµĞ´ĞµĞ»Ñ",
    weeklyNextBtn: "Ğ¡Ğ»ĞµĞ´ÑƒÑÑ‰Ğ°Ñ Ğ½ĞµĞ´ĞµĞ»Ñ",
    weeklyBadge: "Ğ­Ñ‚Ğ° Ğ½ĞµĞ´ĞµĞ»Ñ",
    dailyPrevBtn: "ĞŸÑ€ĞµĞ´Ñ‹Ğ´ÑƒÑ‰Ğ¸Ğ¹ Ğ´ĞµĞ½ÑŒ",
    dailySummary: "Ğ”ĞµÑ‚Ğ°Ğ»Ğ¸ Ğ·Ğ° Ğ´ĞµĞ½ÑŒ",
    dailyNextBtn: "Ğ¡Ğ»ĞµĞ´ÑƒÑÑ‰Ğ¸Ğ¹ Ğ´ĞµĞ½ÑŒ",
    weeklyCompTitle: "Ğ¡Ñ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ Ğ¿Ğ¾ Ğ½ĞµĞ´ĞµĞ»ÑĞ¼",
    monthlyCompTitle: "Ğ¡Ñ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ Ğ¿Ğ¾ Ğ¼ĞµÑÑÑ†Ğ°Ğ¼",
    monthlyBadge: "Ğ­Ñ‚Ğ¾Ñ‚ Ğ¼ĞµÑÑÑ†",
    yearlyBadge: "Ğ­Ñ‚Ğ¾Ñ‚ Ğ³Ğ¾Ğ´",
    anomalyTitle: "ĞĞ±Ğ½Ğ°Ñ€ÑƒĞ¶ĞµĞ½Ğ¸Ğµ Ğ°Ğ½Ğ¾Ğ¼Ğ°Ğ»Ğ¸Ğ¹",
    anomalyBadge: "Ğ”Ğ½Ğ¸ Ñ Ğ°Ğ½Ğ¾Ğ¼Ğ°Ğ»ÑŒĞ½Ñ‹Ğ¼Ğ¸ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ°Ğ¼Ğ¸",
    lastRecordsTitle: "ĞŸĞ¾ÑĞ»ĞµĞ´Ğ½Ğ¸Ğµ Ğ·Ğ°Ğ¿Ğ¸ÑĞ¸",
    dashboardGoToRecords: "ĞŸĞµÑ€ĞµĞ¹Ñ‚Ğ¸ Ğº Ğ·Ğ°Ğ¿Ğ¸ÑÑĞ¼",
    emptyDashboard: "Ğ—Ğ°Ğ¿Ğ¸ÑĞµĞ¹ Ğ¿Ğ¾ĞºĞ° Ğ½ĞµÑ‚...",
    formulaTitle: "Ğ¤ĞĞ ĞœĞ£Ğ›Ğ Ğ ĞĞ¡Ğ§ĞĞ¢Ğ ĞĞ¢Ğ¥ĞĞ”ĞĞ’",
    recordsEntryBtn: "Ğ’Ğ²ĞµÑÑ‚Ğ¸ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ¾/Ğ¿Ğ¾Ñ‚Ñ€ĞµĞ±Ğ»ĞµĞ½Ğ¸Ğµ",
    recordsImportBtn: "Ğ˜Ğ¼Ğ¿Ğ¾Ñ€Ñ‚",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "Ğ¡ĞºĞ°Ñ‡Ğ°Ñ‚ÑŒ CSV",
    recordsDeleteBtn: "Ğ£Ğ´Ğ°Ğ»Ğ¸Ñ‚ÑŒ Ğ²Ñ‹Ğ±Ñ€Ğ°Ğ½Ğ½Ñ‹Ğµ",
    emptyRecords: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ Ğ½Ğµ Ğ½Ğ°Ğ¹Ğ´ĞµĞ½Ñ‹.",
    thDate: "Ğ”Ğ°Ñ‚Ğ°",
    thProducedPerson: "ĞŸÑ€Ğ¸Ğ³Ğ¾Ñ‚Ğ¾Ğ²Ğ»ĞµĞ½Ğ¾ Ğ±Ğ»ÑĞ´ (Ñ‡ĞµĞ».)",
    thWaste10: "10% Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ñ‹",
    thBeneficiary: "ĞŸĞ¾Ğ»ÑƒÑ‡Ğ°Ñ‚ĞµĞ»Ğ¸ ÑƒÑĞ»ÑƒĞ³ Ğ¿Ğ¸Ñ‚Ğ°Ğ½Ğ¸Ñ",
    thPortionGr: "ĞŸĞ¾Ñ€Ñ†Ğ¸Ñ (Ğ³)",
    thWasteKg: "ĞÑ‚Ñ…Ğ¾Ğ´Ñ‹ (ĞºĞ³)",
    thWastedPortion: "Ğ’Ñ‹Ğ±Ñ€Ğ¾ÑˆĞµĞ½Ğ¾ (Ğ¿Ğ¾Ñ€Ñ†.)",
    thFoodType: "Ğ¢Ğ¸Ğ¿ Ğ±Ğ»ÑĞ´Ğ°",
    thAction: "Ğ”ĞµĞ¹ÑÑ‚Ğ²Ğ¸Ğµ",
    thAcademicStaff: "ĞĞºĞ°Ğ´ĞµĞ¼Ğ¸Ñ‡ĞµÑĞºĞ¸Ğ¹ Ğ¸ Ğ°Ğ´Ğ¼Ğ¸Ğ½Ğ¸ÑÑ‚Ñ€Ğ°Ñ‚Ğ¸Ğ²Ğ½Ñ‹Ğ¹ Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ» Ñ‡ĞµÑ€ĞµĞ· Ñ‚ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚",
    thStudentCount: "Ğ¡Ñ‚ÑƒĞ´ĞµĞ½Ñ‚Ñ‹ Ñ‡ĞµÑ€ĞµĞ· Ñ‚ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚",
    thBeneficiaryTotal: "Ğ’ÑĞµĞ³Ğ¾ Ğ¿Ğ¾Ğ»ÑƒÑ‡Ğ°Ñ‚ĞµĞ»ĞµĞ¹ ÑƒÑĞ»ÑƒĞ³ Ğ¿Ğ¸Ñ‚Ğ°Ğ½Ğ¸Ñ",
    sksStaff: "ĞŸĞµÑ€ÑĞ¾Ğ½Ğ°Ğ» Ğ¡ĞšĞ¡",
    summaryReport: "Ğ¡Ğ²Ğ¾Ğ´Ğ½Ñ‹Ğ¹ Ğ¾Ñ‚Ñ‡Ñ‘Ñ‚",
    reportPdfBtn: "ĞÑ‚ĞºÑ€Ñ‹Ñ‚ÑŒ PDF",
    allRecordsPrint: "Ğ’ÑĞµ Ğ·Ğ°Ğ¿Ğ¸ÑĞ¸ (ĞŸĞµÑ‡Ğ°Ñ‚Ğ½Ñ‹Ğ¹ Ğ²Ğ¸Ğ´)",
    rTotalRecords: "ĞĞ±Ñ‰ĞµĞµ Ñ‡Ğ¸ÑĞ»Ğ¾ Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹",
    rTotalMeals: "Ğ’ÑĞµĞ³Ğ¾ Ğ¿Ñ€Ğ¸Ğ³Ğ¾Ñ‚Ğ¾Ğ²Ğ»ĞµĞ½Ğ¾ Ğ±Ğ»ÑĞ´",
    rTotalWaste10: "Ğ’ÑĞµĞ³Ğ¾ 10% Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ñ‹",
    rTotalAfterWaste: "Ğ’ÑĞµĞ³Ğ¾ Ğ±Ğ»ÑĞ´ Ğ¿Ğ¾ÑĞ»Ğµ 10% Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    rTotalTurnstile: "Ğ’ÑĞµĞ³Ğ¾ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ¾Ğ² Ñ‡ĞµÑ€ĞµĞ· Ñ‚ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚",
    rTotalBeneficiary: "Ğ’ÑĞµĞ³Ğ¾ Ğ¿Ğ¾Ğ»ÑƒÑ‡Ğ°Ñ‚ĞµĞ»ĞµĞ¹ ÑƒÑĞ»ÑƒĞ³ Ğ¿Ğ¸Ñ‚Ğ°Ğ½Ğ¸Ñ",
    rTotalStaff: "Ğ’ÑĞµĞ³Ğ¾ Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ»Ğ° Ğ¡ĞšĞ¡",
    rPortionSize: "Ğ Ğ°Ğ·Ğ¼ĞµÑ€ Ğ¿Ğ¾Ñ€Ñ†Ğ¸Ğ¸ (Ğ³)",
    rTotalPortion: "Ğ’ÑĞµĞ³Ğ¾ Ğ¿Ğ¾Ñ€Ñ†Ğ¸Ğ¹ (Ğ³)",
    rWastedPortion: "Ğ’Ñ‹Ğ±Ñ€Ğ¾ÑˆĞµĞ½Ğ½Ñ‹Ğµ Ğ¿Ğ¾Ñ€Ñ†Ğ¸Ğ¸",
    rMaxWeeklyBeneficiary: "ĞœĞ°ĞºÑĞ¸Ğ¼ÑƒĞ¼ Ğ¿Ğ¾Ğ»ÑƒÑ‡Ğ°Ñ‚ĞµĞ»ĞµĞ¹ Ğ·Ğ° Ğ½ĞµĞ´ĞµĞ»Ñ",
    rTotalWasteKg: "ĞĞ±Ñ‰ĞµĞµ ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (ĞºĞ³)",
    rAvgWasteKg: "Ğ¡Ñ€ĞµĞ´Ğ½. ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (ĞºĞ³)",
    rTotalStudents: "ĞĞ±Ñ‰ĞµĞµ Ñ‡Ğ¸ÑĞ»Ğ¾ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ²",
    rMaxWaste: "ĞœĞ°ĞºÑĞ¸Ğ¼ÑƒĞ¼ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (ĞºĞ³)",
    rMinWaste: "ĞœĞ¸Ğ½Ğ¸Ğ¼ÑƒĞ¼ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (ĞºĞ³)",
    rWasteTrend: "Ğ”Ğ¸Ğ½Ğ°Ğ¼Ğ¸ĞºĞ° Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (Ğ¿Ğ¾ÑĞ». 7 Ğ´Ğ½ĞµĞ¹)",
    rBeneficiaryTrend: "Ğ”Ğ¸Ğ½Ğ°Ğ¼Ğ¸ĞºĞ° Ğ¿Ğ¾Ğ»ÑƒÑ‡Ğ°Ñ‚ĞµĞ»ĞµĞ¹ (Ğ¿Ğ¾ÑĞ». 7 Ğ´Ğ½ĞµĞ¹)",
    wasteByFoodTitle: "ĞĞ½Ğ°Ğ»Ğ¸Ğ· Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² Ğ¿Ğ¾ Ñ‚Ğ¸Ğ¿Ñƒ Ğ±Ğ»ÑĞ´Ğ°",
    wasteByFoodEmpty: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ Ñ Ğ´Ğ°Ğ½Ğ½Ñ‹Ğ¼Ğ¸ Ğ¾ Ñ‚Ğ¸Ğ¿Ğµ Ğ±Ğ»ÑĞ´Ğ° Ğ½Ğµ Ğ½Ğ°Ğ¹Ğ´ĞµĞ½Ñ‹.",
    wasteByFoodRecords: "ĞšĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹",
    wasteByFoodRate: "ĞŸÑ€Ğ¾Ñ†ĞµĞ½Ñ‚ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    wasteByFoodPerPerson: "ĞÑ‚Ñ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° Ñ‡ĞµĞ»Ğ¾Ğ²ĞµĞºĞ° (ĞºĞ³)",
    wsProducedMeal: "ĞŸÑ€Ğ¸Ğ³Ğ¾Ñ‚Ğ¾Ğ²Ğ»ĞµĞ½Ğ¾ Ğ±Ğ»ÑĞ´ (Ñ‡ĞµĞ».)",
    wsTotalPasses: "Ğ’ÑĞµĞ³Ğ¾ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    wsTurnstile: "Ğ¢ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚",
    wsStaffSKS: "ĞŸĞµÑ€ÑĞ¾Ğ½Ğ°Ğ» Ğ¡ĞšĞ¡",
    wsWasteAmount: "ĞšĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    wsWastedPortion: "Ğ’ Ğ¼ÑƒÑĞ¾Ñ€",
    wsStudents: "Ğ¡Ñ‚ÑƒĞ´ĞµĞ½Ñ‚Ñ‹ Ğ¿Ğ¸Ñ‚.",
    wsNoRecordsYet: "Ğ—Ğ°Ğ¿Ğ¸ÑĞµĞ¹ Ğ¿Ğ¾ĞºĞ° Ğ½ĞµÑ‚",
    wsNoRecordThisWeek: "ĞĞµÑ‚ Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹ Ğ·Ğ° ÑÑ‚Ñƒ Ğ½ĞµĞ´ĞµĞ»Ñ",
    wsNoRecordToday: "ĞĞµÑ‚ Ğ·Ğ°Ğ¿Ğ¸ÑĞ¸",
    wsTodayDetail: "Ğ”ĞµÑ‚Ğ°Ğ»Ğ¸ Ğ·Ğ° ÑĞµĞ³Ğ¾Ğ´Ğ½Ñ",
    wsDailyDetail: "Ğ”Ğ½ĞµĞ²Ğ½Ğ°Ñ ÑĞ²Ğ¾Ğ´ĞºĞ°",
    wsWaste: "ĞŸĞ¾Ñ‚ĞµÑ€Ğ¸",
    wsPortion: "Ğ¿Ğ¾Ñ€Ñ†Ğ¸Ñ",
    wsProduced: "Ğ’Ñ‹Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ¾",
    wsTurnstileCount: "ĞŸÑ€Ğ¾Ñ…Ğ¾Ğ´Ñ‹ Ñ‚ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚Ğ°",
    wsStaffCount: "ĞŸĞµÑ€ÑĞ¾Ğ½Ğ°Ğ»",
    menuTitle: "ĞœĞµĞ½Ñ Ğ½Ğ° Ğ½ĞµĞ´ĞµĞ»Ñ",
    menuStatusBadge: "Ğ¡Ñ‚Ğ°Ñ‚ÑƒÑ",
    menuSaveBtn: "Ğ¡Ğ¾Ñ…Ñ€Ğ°Ğ½Ğ¸Ñ‚ÑŒ",
    menuSendBtn: "ĞÑ‚Ğ¿Ñ€Ğ°Ğ²Ğ¸Ñ‚ÑŒ Ğ½Ğ° ÑĞ¾Ğ³Ğ»Ğ°ÑĞ¾Ğ²Ğ°Ğ½Ğ¸Ğµ",
    menuApproveBtn: "Ğ¡Ğ¾Ğ³Ğ»Ğ°ÑĞ¾Ğ²Ğ°Ñ‚ÑŒ",
    menuRejectBtn: "ĞÑ‚ĞºĞ»Ğ¾Ğ½Ğ¸Ñ‚ÑŒ",
    menuWithdrawBtn: "ĞÑ‚Ğ¾Ğ·Ğ²Ğ°Ñ‚ÑŒ ÑĞ¾Ğ³Ğ»Ğ°ÑĞ¾Ğ²Ğ°Ğ½Ğ¸Ğµ",
    menuClearBtn: "ĞÑ‡Ğ¸ÑÑ‚Ğ¸Ñ‚ÑŒ Ñ‚Ğ°Ğ±Ğ»Ğ¸Ñ†Ñƒ",
    menuPrintBtn: "ĞŸĞµÑ‡Ğ°Ñ‚ÑŒ",
    menuFoodListBtn: "Ğ¡Ğ¿Ğ¸ÑĞ¾Ğº Ğ±Ğ»ÑĞ´",
    menuFoodListUploadBtn: "Ğ—Ğ°Ğ³Ñ€ÑƒĞ·Ğ¸Ñ‚ÑŒ CSV",
    menuFoodListCsvBtn: "Ğ¡ĞºĞ°Ñ‡Ğ°Ñ‚ÑŒ CSV",
    menuWarningPrefix: "ĞœĞµĞ½Ñ Ğ±ĞµĞ· ÑĞ¾Ğ³Ğ»Ğ°ÑĞ¾Ğ²Ğ°Ğ½Ğ¸Ñ:",
    menuWarningText: "ĞœĞµĞ½Ñ Ğ½Ğ° ÑÑ‚Ñƒ Ğ½ĞµĞ´ĞµĞ»Ñ ĞµÑ‰Ñ‘ Ğ½Ğµ ÑƒÑ‚Ğ²ĞµÑ€Ğ¶Ğ´ĞµĞ½Ğ¾ Ğ¸Ğ½Ğ¶ĞµĞ½ĞµÑ€Ğ¾Ğ¼ Ğ¿Ğ¾ Ğ¿Ğ¸Ñ‚Ğ°Ğ½Ğ¸Ñ.",
    menuHintText: "Ğ’Ğ²ĞµĞ´Ğ¸Ñ‚Ğµ Ğ½Ğ°Ğ·Ğ²Ğ°Ğ½Ğ¸Ñ Ğ±Ğ»ÑĞ´...",
    productNeedsTitle: "Ğ¡Ğ¿Ğ¸ÑĞ¾Ğº Ğ½ĞµĞ¾Ğ±Ñ…Ğ¾Ğ´Ğ¸Ğ¼Ñ‹Ñ… Ğ¿Ñ€Ğ¾Ğ´ÑƒĞºÑ‚Ğ¾Ğ²",
    weeklyNeedsTitle: "Ğ•Ğ¶ĞµĞ½ĞµĞ´ĞµĞ»ÑŒĞ½Ñ‹Ğ¹ Ğ¾Ğ±Ñ‰Ğ¸Ğ¹ ÑĞ¿Ğ¸ÑĞ¾Ğº Ğ¿Ğ¾Ñ‚Ñ€ĞµĞ±Ğ½Ğ¾ÑÑ‚ĞµĞ¹",
    foodListTitle: "Ğ¡Ğ¿Ğ¸ÑĞ¾Ğº Ğ±Ğ»ÑĞ´",
    modalRejectMenu: "ĞÑ‚ĞºĞ»Ğ¾Ğ½Ğ¸Ñ‚ÑŒ Ğ¼ĞµĞ½Ñ",
    modalRejectDesc: "ĞŸÑ€Ğ¸Ñ‡Ğ¸Ğ½Ğ° Ğ¾Ñ‚ĞºĞ»Ğ¾Ğ½ĞµĞ½Ğ¸Ñ Ğ¾Ğ±ÑĞ·Ğ°Ñ‚ĞµĞ»ÑŒĞ½Ğ°.",
    menuRejectConfirm: "ĞÑ‚ĞºĞ»Ğ¾Ğ½Ğ¸Ñ‚ÑŒ",
    haccpTitle: "Ğ£Ğ¿Ñ€Ğ°Ğ²Ğ»ĞµĞ½Ğ¸Ğµ Ğ±ĞµĞ·Ğ¾Ğ¿Ğ°ÑĞ½Ğ¾ÑÑ‚ÑŒÑ Ğ¿Ğ¸Ñ‰ĞµĞ²Ñ‹Ñ… Ğ¿Ñ€Ğ¾Ğ´ÑƒĞºÑ‚Ğ¾Ğ²",
    haccpCsvBtn: "Ğ¡ĞºĞ°Ñ‡Ğ°Ñ‚ÑŒ CSV",
    haccpColdStorage: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ Ñ‚ĞµĞ¼Ğ¿ĞµÑ€Ğ°Ñ‚ÑƒÑ€Ñ‹ Ñ…Ğ¾Ğ»Ğ¾Ğ´Ğ¸Ğ»ÑŒĞ½Ğ¸ĞºĞ°",
    haccpNewBtn: "ĞĞ¾Ğ²Ğ°Ñ Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ",
    haccpDepotBtn: "ĞĞ°Ğ·Ğ²Ğ°Ğ½Ğ¸Ñ ÑĞºĞ»Ğ°Ğ´Ğ¾Ğ²",
    haccpDepoQrNote: "Ğ’Ñ‹ Ğ¼Ğ¾Ğ¶ĞµÑ‚Ğµ Ñ€ĞµĞ´Ğ°ĞºÑ‚Ğ¸Ñ€Ğ¾Ğ²Ğ°Ñ‚ÑŒ Ğ½Ğ°Ğ·Ğ²Ğ°Ğ½Ğ¸Ñ ÑĞºĞ»Ğ°Ğ´Ğ¾Ğ² Ğ¸ Ğ³ĞµĞ½ĞµÑ€Ğ¸Ñ€Ğ¾Ğ²Ğ°Ñ‚ÑŒ QR-ĞºĞ¾Ğ´Ñ‹ Ğ´Ğ»Ñ ĞºĞ°Ğ¶Ğ´Ğ¾Ğ³Ğ¾ ÑĞºĞ»Ğ°Ğ´Ğ° Ñ Ğ¿Ğ¾Ğ¼Ğ¾Ñ‰ÑŒÑ ĞºĞ½Ğ¾Ğ¿ĞºĞ¸ QR.",
    haccpModalTitle: "ĞĞ¾Ğ²Ğ°Ñ Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ",
    filterDepot: "Ğ¤Ğ¸Ğ»ÑŒÑ‚Ñ€ Ğ¿Ğ¾ ÑĞºĞ»Ğ°Ğ´Ñƒ:",
    filterAll: "Ğ’ÑĞµ",
    filterDateRange: "Ğ”Ğ¸Ğ°Ğ¿Ğ°Ğ·Ğ¾Ğ½ Ğ´Ğ°Ñ‚:",
    emptyHaccp: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ Ñ‚ĞµĞ¼Ğ¿ĞµÑ€Ğ°Ñ‚ÑƒÑ€Ñ‹ ĞµÑ‰Ñ‘ Ğ½Ğµ Ğ²Ğ²ĞµĞ´ĞµĞ½Ñ‹.",
    btnDeleteSelectedHaccp: "Ğ£Ğ´Ğ°Ğ»Ğ¸Ñ‚ÑŒ Ğ²Ñ‹Ğ±Ñ€Ğ°Ğ½Ğ½Ñ‹Ğµ",
    btnPdf: "PDF",
    depoNamesTitle: "ĞĞ°Ğ·Ğ²Ğ°Ğ½Ğ¸Ñ ÑĞºĞ»Ğ°Ğ´Ğ¾Ğ²",
    oilNewBtn: "ĞĞ¾Ğ²Ğ°Ñ Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ",
    oilListBtn: "Ğ¡Ğ¿Ğ¸ÑĞ¾Ğº",
    oilFilterTitle: "Ğ¤Ğ¸Ğ»ÑŒÑ‚Ñ€Ñ‹ Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ³Ğ¾ Ğ¼Ğ°ÑĞ»Ğ°",
    filterOilType: "Ğ¢Ğ¸Ğ¿ Ğ¼Ğ°ÑĞ»Ğ°:",
    btnReset: "Ğ¡Ğ±Ñ€Ğ¾ÑĞ¸Ñ‚ÑŒ",
    oilSummaryTitle: "Ğ¡Ğ²Ğ¾Ğ´ĞºĞ° Ğ¿Ğ¾ Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ¼Ñƒ Ğ¼Ğ°ÑĞ»Ñƒ",
    oilChartTitle: "Ğ“Ñ€Ğ°Ñ„Ğ¸ĞºĞ¸ Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ³Ğ¾ Ğ¼Ğ°ÑĞ»Ğ°",
    oilChartSubtitle: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ğ¾Ğµ ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ³Ğ¾ Ğ¼Ğ°ÑĞ»Ğ° (Ğ»)",
    oilChartEmpty: "Ğ“Ñ€Ğ°Ñ„Ğ¸ĞºĞ¸ Ğ¿Ğ¾ÑĞ²ÑÑ‚ÑÑ Ğ¿Ğ¾ÑĞ»Ğµ Ğ²Ğ²Ğ¾Ğ´Ğ° Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹ Ğ¾Ğ± Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ¼ Ğ¼Ğ°ÑĞ»Ğµ",
    oilChartNote: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ñ‹Ğµ Ğ¸Ñ‚Ğ¾Ğ³Ğ¸ Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ³Ğ¾ Ğ¼Ğ°ÑĞ»Ğ° Ğ¿Ğ¾ Ğ´Ğ°Ñ‚Ğµ, Ñ‚Ğ¸Ğ¿Ñƒ Ğ¼Ğ°ÑĞ»Ğ° Ğ¸ Ğ³Ğ¾Ğ´Ñƒ",
    oilRecordsTitle: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ³Ğ¾ Ğ¼Ğ°ÑĞ»Ğ°",
    oilModalTitle: "Ğ—Ğ°Ğ¿Ğ¸ÑÑŒ Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ³Ğ¾ Ğ¼Ğ°ÑĞ»Ğ°",
    emptyOil: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ³Ğ¾ Ğ¼Ğ°ÑĞ»Ğ° ĞµÑ‰Ñ‘ Ğ½Ğµ Ğ²Ğ²ĞµĞ´ĞµĞ½Ñ‹.",
    ambalajNewBtn: "ĞĞ¾Ğ²Ğ°Ñ Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ",
    ambalajListBtn: "Ğ¡Ğ¿Ğ¸ÑĞ¾Ğº",
    packagingFilterTitle: "Ğ¤Ğ¸Ğ»ÑŒÑ‚Ñ€Ñ‹ ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    filterWasteType: "Ğ¢Ğ¸Ğ¿ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²:",
    packagingSummaryTitle: "Ğ¡Ğ²Ğ¾Ğ´ĞºĞ° Ğ¿Ğ¾ ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ğ¼ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ°Ğ¼",
    packagingChartTitle: "Ğ“Ñ€Ğ°Ñ„Ğ¸ĞºĞ¸ ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    packagingChartSubtitle: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ğ¾Ğµ ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (ĞºĞ³)",
    packagingChartEmpty: "Ğ“Ñ€Ğ°Ñ„Ğ¸ĞºĞ¸ Ğ¿Ğ¾ÑĞ²ÑÑ‚ÑÑ Ğ¿Ğ¾ÑĞ»Ğµ Ğ²Ğ²Ğ¾Ğ´Ğ° Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹ Ğ¾Ğ± ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ°Ñ…",
    packagingChartNote: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ñ‹Ğµ Ğ¸Ñ‚Ğ¾Ğ³Ğ¸ ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² Ğ¿Ğ¾ Ğ´Ğ°Ñ‚Ğµ, Ñ‚Ğ¸Ğ¿Ñƒ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² Ğ¸ Ğ³Ğ¾Ğ´Ñƒ (ĞºĞ³)",
    packagingRecordsTitle: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    packagingModalTitle: "Ğ—Ğ°Ğ¿Ğ¸ÑÑŒ ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    emptyPackaging: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² ĞµÑ‰Ñ‘ Ğ½Ğµ Ğ²Ğ²ĞµĞ´ĞµĞ½Ñ‹.",
    kalibrasyonNewBtn: "ĞĞ¾Ğ²Ğ¾Ğµ ÑƒÑÑ‚Ñ€Ğ¾Ğ¹ÑÑ‚Ğ²Ğ¾",
    kalibrasyonListBtn: "Ğ¡Ğ¿Ğ¸ÑĞ¾Ğº",
    kalibrasyonCsvBtn: "Ğ¡ĞºĞ°Ñ‡Ğ°Ñ‚ÑŒ CSV",
    calibrationSummary: "Ğ¡Ğ²Ğ¾Ğ´ĞºĞ° ĞºĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ¸",
    calibrationDevices: "Ğ£ÑÑ‚Ñ€Ğ¾Ğ¹ÑÑ‚Ğ²Ğ° Ğ¿Ğ¾Ğ´Ğ»ĞµĞ¶Ğ°Ñ‰Ğ¸Ğµ ĞºĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞµ",
    calibrationModalTitle: "Ğ£ÑÑ‚Ñ€Ğ¾Ğ¹ÑÑ‚Ğ²Ğ¾ Ğ´Ğ»Ñ ĞºĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ¸",
    filterStatus: "Ğ¡Ñ‚Ğ°Ñ‚ÑƒÑ:",
    filterDepartment: "ĞÑ‚Ğ´ĞµĞ»:",
    btnWordExport: "Ğ­ĞºÑĞ¿Ğ¾Ñ€Ñ‚ Ğ² Word",
    btnPrint: "ĞŸĞµÑ‡Ğ°Ñ‚ÑŒ PDF",
    chartProdWaste: "Ğ¡Ñ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ° - Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ¾Ğ² - Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    chartEmpty: "Ğ“Ñ€Ğ°Ñ„Ğ¸ĞºĞ¸ Ğ¿Ğ¾ÑĞ²ÑÑ‚ÑÑ Ğ¿Ğ¾ÑĞ»Ğµ Ğ²Ğ²Ğ¾Ğ´Ğ° Ğ´Ğ°Ğ½Ğ½Ñ‹Ñ…",
    chartProdWasteNote: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ğ¾Ğµ ÑÑ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ°, Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ¾Ğ² Ñ‡ĞµÑ€ĞµĞ· Ñ‚ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚ Ğ¸ Ğ²Ñ‹Ğ±Ñ€Ğ¾ÑˆĞµĞ½Ğ½Ñ‹Ñ… Ğ¿Ğ¾Ñ€Ñ†Ğ¸Ğ¹",
    chartStudentCount: "Ğ§Ğ¸ÑĞ»Ğ¾ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ², Ğ¿Ğ¾Ğ»ÑŒĞ·ÑƒÑÑ‰Ğ¸Ñ…ÑÑ ÑƒÑĞ»ÑƒĞ³Ğ°Ğ¼Ğ¸ Ğ¿Ğ¸Ñ‚Ğ°Ğ½Ğ¸Ñ",
    yearTotal: "Ğ˜Ñ‚Ğ¾Ğ³Ğ¾ Ğ·Ğ° Ğ³Ğ¾Ğ´",
    chartStudentNote: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ñ‹Ğ¹ Ğ¸Ñ‚Ğ¾Ğ³ Ğ´Ğ½ĞµĞ²Ğ½Ñ‹Ñ… Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ¾Ğ² ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ²",
    chartStaffTotal: "ĞĞºĞ°Ğ´ĞµĞ¼Ğ¸Ñ‡ĞµÑĞºĞ¸Ğ¹ Ğ¸ Ğ°Ğ´Ğ¼Ğ¸Ğ½Ğ¸ÑÑ‚Ñ€Ğ°Ñ‚Ğ¸Ğ²Ğ½Ñ‹Ğ¹ + Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ» Ğ¡ĞšĞ¡",
    chartStaffNote: "Ğ˜Ñ‚Ğ¾Ğ³ Ğ°ĞºĞ°Ğ´ĞµĞ¼Ğ¸Ñ‡ĞµÑĞºĞ¾Ğ³Ğ¾ Ğ¸ Ğ°Ğ´Ğ¼Ğ¸Ğ½Ğ¸ÑÑ‚Ñ€Ğ°Ñ‚Ğ¸Ğ²Ğ½Ğ¾Ğ³Ğ¾ (Ğ¢ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚ - Ğ¡Ñ‚ÑƒĞ´ĞµĞ½Ñ‚Ñ‹) Ğ¸ Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ»Ğ° Ğ¡ĞšĞ¡",
    chartMonthlyProd: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ğ¾Ğµ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ¾ Ğ±Ğ»ÑĞ´",
    chartMonthlyProdNote: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ñ‹Ğ¹ Ğ¸Ñ‚Ğ¾Ğ³ Ğ´Ğ½ĞµĞ²Ğ½Ğ¾Ğ³Ğ¾ ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ° Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²ĞµĞ´Ñ‘Ğ½Ğ½Ñ‹Ñ… Ğ±Ğ»ÑĞ´",
    chartMonthlyTurnstile: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ğ¾Ğµ ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ¾Ğ² Ñ‡ĞµÑ€ĞµĞ· Ñ‚ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚",
    chartTurnstileNote: "Ğ˜Ñ‚Ğ¾Ğ³ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ñ‹ + Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ» + Ğ²Ğ½ĞµÑˆĞ½Ğ¸Ğµ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ñ‹",
    chartMonthlyWaste: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ğ¾Ğµ ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (ĞºĞ³)",
    chartMonthlyWasteNote: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ñ‹Ğ¹ Ğ¸Ñ‚Ğ¾Ğ³ Ğ´Ğ½ĞµĞ²Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (ĞºĞ³)",
    chartMonthlyWastePortion: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ğ¾Ğµ ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (Ğ¿Ğ¾Ñ€Ñ†Ğ¸Ğ¸)",
    chartWastePortionNote: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ñ‹Ğ¹ Ğ¸Ñ‚Ğ¾Ğ³ Ğ´Ğ½ĞµĞ²Ğ½Ñ‹Ñ… Ğ²Ñ‹Ğ±Ñ€Ğ¾ÑˆĞµĞ½Ğ½Ñ‹Ñ… Ğ¿Ğ¾Ñ€Ñ†Ğ¸Ğ¹",
    chartDiff: "Ğ Ğ°Ğ·Ğ½Ğ¸Ñ†Ğ° Ğ¼ĞµĞ¶Ğ´Ñƒ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ¾Ğ¼ Ğ¸ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ°Ğ¼Ğ¸",
    chartDiffNote: "Ğ Ğ°Ğ·Ğ½Ğ¸Ñ†Ğ° Ğ¼ĞµĞ¶Ğ´Ñƒ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²ĞµĞ´Ñ‘Ğ½Ğ½Ñ‹Ğ¼Ğ¸ Ğ±Ğ»ÑĞ´Ğ°Ğ¼Ğ¸ Ğ¸ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ°Ğ¼Ğ¸ Ñ‡ĞµÑ€ĞµĞ· Ñ‚ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚",
    chartWasteRatio: "ĞÑ‚Ñ…Ğ¾Ğ´Ñ‹ Ğ² % Ğ¾Ñ‚ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²ĞµĞ´Ñ‘Ğ½Ğ½Ñ‹Ñ… Ğ±Ğ»ÑĞ´",
    yearAverage: "Ğ¡Ñ€ĞµĞ´Ğ½ĞµĞ³Ğ¾Ğ´Ğ¾Ğ²Ğ¾Ğ¹ Ğ¿Ğ¾ĞºĞ°Ğ·Ğ°Ñ‚ĞµĞ»ÑŒ",
    chartWasteRatioNote: "ĞŸÑ€Ğ¾Ñ†ĞµĞ½Ñ‚ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²ĞµĞ´Ñ‘Ğ½Ğ½Ñ‹Ñ… Ğ±Ğ»ÑĞ´, ĞºĞ¾Ñ‚Ğ¾Ñ€Ñ‹Ğµ ÑÑ‚Ğ°Ğ½Ğ¾Ğ²ÑÑ‚ÑÑ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ°Ğ¼Ğ¸",
    chartWastePerPerson: "ĞÑ‚Ñ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° Ñ‡ĞµĞ»Ğ¾Ğ²ĞµĞºĞ° (ĞºĞ³/Ñ‡ĞµĞ».)",
    chartWastePerPersonNote: "Ğ¡Ñ€ĞµĞ´Ğ½Ğ¸Ğµ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° ĞºĞ°Ğ¶Ğ´Ğ¾Ğ³Ğ¾ Ğ¿Ğ¾ÑĞµÑ‚Ğ¸Ñ‚ĞµĞ»Ñ ÑÑ‚Ğ¾Ğ»Ğ¾Ğ²Ğ¾Ğ¹",
    chartMonthlyTemp: "Ğ¡Ñ€ĞµĞ´Ğ½ĞµĞ¼ĞµÑÑÑ‡Ğ½Ğ°Ñ Ñ‚ĞµĞ¼Ğ¿ĞµÑ€Ğ°Ñ‚ÑƒÑ€Ğ° Ğ½Ğ° ÑĞºĞ»Ğ°Ğ´Ğ°Ñ… (Â°C)",
    chartTempEmpty: "Ğ“Ñ€Ğ°Ñ„Ğ¸ĞºĞ¸ Ğ¿Ğ¾ÑĞ²ÑÑ‚ÑÑ Ğ¿Ğ¾ÑĞ»Ğµ Ğ²Ğ²Ğ¾Ğ´Ğ° Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹ Ğ¾ Ñ‚ĞµĞ¼Ğ¿ĞµÑ€Ğ°Ñ‚ÑƒÑ€Ğµ",
    chartTempNote: "Ğ¡Ñ€ĞµĞ´Ğ½ĞµĞ¼ĞµÑÑÑ‡Ğ½Ğ°Ñ Ñ‚ĞµĞ¼Ğ¿ĞµÑ€Ğ°Ñ‚ÑƒÑ€Ğ° ĞºĞ°Ğ¶Ğ´Ğ¾Ğ³Ğ¾ ÑĞºĞ»Ğ°Ğ´Ğ°",
    yearlyPdfBtn: "ĞŸĞµÑ‡Ğ°Ñ‚ÑŒ PDF",
    yearlyTotalProd: "Ğ¡Ñ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ Ğ¾Ğ±Ñ‰ĞµĞ³Ğ¾ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ°",
    yearlyTotalProdNote: "Ğ˜Ñ‚Ğ¾Ğ³Ğ¾ Ğ·Ğ° Ğ³Ğ¾Ğ´ - 1-Ğ¹ Ğ³Ğ¾Ğ´ vs 2-Ğ¹ Ğ³Ğ¾Ğ´ (Ğ¿Ğ¾Ñ€Ñ†Ğ¸Ğ¸)",
    yearlyTotalBen: "Ğ’ÑĞµĞ³Ğ¾ Ğ¿Ğ¾Ğ»ÑƒÑ‡Ğ°Ñ‚ĞµĞ»ĞµĞ¹ ÑƒÑĞ»ÑƒĞ³ Ğ¿Ğ¸Ñ‚Ğ°Ğ½Ğ¸Ñ",
    yearlyTotalBenNote: "Ğ˜Ñ‚Ğ¾Ğ³Ğ¾ Ğ·Ğ° Ğ³Ğ¾Ğ´ - 1-Ğ¹ Ğ³Ğ¾Ğ´ vs 2-Ğ¹ Ğ³Ğ¾Ğ´ (Ğ²ÑĞµĞ³Ğ¾ Ñ‡ĞµĞ»Ğ¾Ğ²ĞµĞº)",
    yearlyStudentComp: "Ğ¡Ñ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ²-Ğ¿Ğ¾Ğ»ÑƒÑ‡Ğ°Ñ‚ĞµĞ»ĞµĞ¹",
    yearlyStudentNote: "Ğ˜Ñ‚Ğ¾Ğ³Ğ¾ Ğ·Ğ° Ğ³Ğ¾Ğ´ - 1-Ğ¹ Ğ³Ğ¾Ğ´ vs 2-Ğ¹ Ğ³Ğ¾Ğ´ (ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ñ‹)",
    yearlyWasteComp: "Ğ¡Ñ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (ĞºĞ³)",
    yearlyWasteNote: "Ğ˜Ñ‚Ğ¾Ğ³Ğ¾ Ğ·Ğ° Ğ³Ğ¾Ğ´ - 1-Ğ¹ Ğ³Ğ¾Ğ´ vs 2-Ğ¹ Ğ³Ğ¾Ğ´ (ĞºĞ³)",
    yearlyMonthlyProd: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ğ¾Ğµ ÑÑ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ°",
    yearlyMonthlyProdNote: "1-Ğ¹ Ğ³Ğ¾Ğ´ vs 2-Ğ¹ Ğ³Ğ¾Ğ´ - Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²ĞµĞ´Ñ‘Ğ½Ğ½Ñ‹Ğµ Ğ±Ğ»ÑĞ´Ğ° (Ğ¿Ğ¾Ñ€Ñ†Ğ¸Ğ¸)",
    yearlyMonthlyTurnstile: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ğ¾Ğµ ÑÑ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ¾Ğ² Ñ‡ĞµÑ€ĞµĞ· Ñ‚ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚",
    yearlyMonthlyTurnstileNote: "1-Ğ¹ Ğ³Ğ¾Ğ´ vs 2-Ğ¹ Ğ³Ğ¾Ğ´ - ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    yearlyMonthlyStudent: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ğ¾Ğµ ÑÑ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ¾Ğ² ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ²",
    yearlyMonthlyStudentNote: "1-Ğ¹ Ğ³Ğ¾Ğ´ vs 2-Ğ¹ Ğ³Ğ¾Ğ´ - ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ¾Ğ² ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ²",
    yearlyMonthlyWaste: "Ğ•Ğ¶ĞµĞ¼ĞµÑÑÑ‡Ğ½Ğ¾Ğµ ÑÑ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (ĞºĞ³)",
    yearlyMonthlyWasteNote: "1-Ğ¹ Ğ³Ğ¾Ğ´ vs 2-Ğ¹ Ğ³Ğ¾Ğ´ - ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (ĞºĞ³)",
    yearlyWasteListTitle: "Ğ“Ğ¾Ğ´Ğ¾Ğ²Ğ¾Ğ¹ ÑĞ¿Ğ¸ÑĞ¾Ğº Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    spendingRatesTitle: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° Ñ‡ĞµĞ»Ğ¾Ğ²ĞµĞºĞ° (Ğ¡Ñ‚ÑƒĞ´ĞµĞ½Ñ‚Ñ‹, Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ» Ğ¸ Ğ±Ğ»ÑĞ´Ğ°)",
    spendingStudentRate: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ° (TL)",
    btnSaveStudentRate: "Ğ¡Ğ¾Ñ…Ñ€Ğ°Ğ½Ğ¸Ñ‚ÑŒ ÑÑƒĞ¼Ğ¼Ñƒ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ²",
    spendingStaffRate: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° ÑĞ¾Ñ‚Ñ€ÑƒĞ´Ğ½Ğ¸ĞºĞ° (TL)",
    btnSaveStaffRate: "Ğ¡Ğ¾Ñ…Ñ€Ğ°Ğ½Ğ¸Ñ‚ÑŒ ÑÑƒĞ¼Ğ¼Ñƒ Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ»Ğ°",
    spendingMealRate: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° Ğ±Ğ»ÑĞ´Ğ¾ (TL)",
    btnSaveMealRate: "Ğ¡Ğ¾Ñ…Ñ€Ğ°Ğ½Ğ¸Ñ‚ÑŒ ÑÑƒĞ¼Ğ¼Ñƒ Ğ±Ğ»ÑĞ´",
    spendingDesc: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ² = Ğ§Ğ¸ÑĞ»Ğ¾ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ² Ã— Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ°",
    spendingStudentTitle: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ² (TL)",
    spendingChartEmpty: "Ğ“Ñ€Ğ°Ñ„Ğ¸ĞºĞ¸ Ğ¿Ğ¾ÑĞ²ÑÑ‚ÑÑ Ğ¿Ğ¾ÑĞ»Ğµ Ğ²Ğ²Ğ¾Ğ´Ğ° Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹",
    spendingStudentNote: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ² (TL) = Ğ§Ğ¸ÑĞ»Ğ¾ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ² Ã— Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ°",
    spendingStaffTitle: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ» (TL)",
    spendingStaffNote: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ»Ğ° (TL) = Ğ§Ğ¸ÑĞ»Ğ¾ Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ»Ğ° Ã— Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° ÑĞ¾Ñ‚Ñ€ÑƒĞ´Ğ½Ğ¸ĞºĞ°",
    spendingMealTitle: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° Ğ±Ğ»ÑĞ´Ğ° (TL)",
    spendingMealNote: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° Ğ±Ğ»ÑĞ´Ğ° (TL) = ĞŸÑ€Ğ¾Ğ¸Ğ·Ğ²ĞµĞ´Ñ‘Ğ½Ğ½Ñ‹Ğµ Ğ±Ğ»ÑĞ´Ğ° Ã— Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° Ğ±Ğ»ÑĞ´Ğ¾",
    spendingTableTitle: "Ğ¢Ğ°Ğ±Ğ»Ğ¸Ñ†Ğ° Ñ€Ğ°ÑÑ‡Ñ‘Ñ‚Ğ° Ñ€Ğ°ÑÑ…Ğ¾Ğ´Ğ¾Ğ²",
    syncTitle: "Ğ¡Ğ¸Ğ½Ñ…Ñ€Ğ¾Ğ½Ğ¸Ğ·Ğ°Ñ†Ğ¸Ñ Ñ Supabase",
    syncCloseBtn: "Ğ—Ğ°ĞºÑ€Ñ‹Ñ‚ÑŒ",
    modalNewRecord: "Ğ”Ğ¾Ğ±Ğ°Ğ²Ğ¸Ñ‚ÑŒ Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ",
    formDate: "Ğ”Ğ°Ñ‚Ğ°",
    formProducedCount: "ĞšĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²ĞµĞ´Ñ‘Ğ½Ğ½Ñ‹Ñ… Ğ±Ğ»ÑĞ´",
    formTurnstileCount: "ĞšĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ¾Ğ² Ñ‡ĞµÑ€ĞµĞ· Ñ‚ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚",
    formStudentCount: "Ğ§Ğ¸ÑĞ»Ğ¾ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ²",
    formFoodType: "Ğ¢Ğ¸Ğ¿ Ğ±Ğ»ÑĞ´Ğ°",
    formAutoCalc: "ĞĞ²Ñ‚Ğ¾Ğ¼Ğ°Ñ‚Ğ¸Ñ‡ĞµÑĞºĞ¸Ğµ Ñ€Ğ°ÑÑ‡Ñ‘Ñ‚Ñ‹",
    badgeAutomatic: "ĞĞ²Ñ‚Ğ¾Ğ¼Ğ°Ñ‚Ğ¸Ñ‡ĞµÑĞºĞ¸",
    badgeFixed: "Ğ¤Ğ¸ĞºÑĞ¸Ñ€Ğ¾Ğ²Ğ°Ğ½Ğ¾",
    badgeAutoEditable: "ĞĞ²Ñ‚Ğ¾Ğ¼Ğ°Ñ‚Ğ¸Ñ‡ĞµÑĞºĞ¸ + Ğ ĞµĞ´Ğ°ĞºÑ‚Ğ¸Ñ€ÑƒĞµĞ¼Ğ¾Ğµ",
    btnCancel: "ĞÑ‚Ğ¼ĞµĞ½Ğ°",
    entryFormSubmit: "Ğ¡Ğ¾Ñ…Ñ€Ğ°Ğ½Ğ¸Ñ‚ÑŒ",
    formReceiptNo: "ĞĞ¾Ğ¼ĞµÑ€ ĞºĞ²Ğ¸Ñ‚Ğ°Ğ½Ñ†Ğ¸Ğ¸",
    formOilType: "Ğ¢Ğ¸Ğ¿ Ğ¼Ğ°ÑĞ»Ğ°",
    formAmountLt: "ĞšĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ (Ğ»)",
    formNote: "ĞŸÑ€Ğ¸Ğ¼ĞµÑ‡Ğ°Ğ½Ğ¸Ğµ",
    formWasteType: "Ğ¢Ğ¸Ğ¿ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    formAmount: "ĞšĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾",
    formDeviceName: "ĞĞ°Ğ·Ğ²Ğ°Ğ½Ğ¸Ğµ ÑƒÑÑ‚Ñ€Ğ¾Ğ¹ÑÑ‚Ğ²Ğ°",
    formBrandModel: "Ğ‘Ñ€ĞµĞ½Ğ´-Ğ¼Ğ¾Ğ´ĞµĞ»ÑŒ",
    formSerialNo: "Ğ¡ĞµÑ€Ğ¸Ğ¹Ğ½Ñ‹Ğ¹ Ğ½Ğ¾Ğ¼ĞµÑ€",
    formStatus: "Ğ¡Ñ‚Ğ°Ñ‚ÑƒÑ",
    formVerification: "ĞŸĞ¾Ğ²ĞµÑ€ĞºĞ°",
    formLastCalibration: "ĞŸĞ¾ÑĞ»ĞµĞ´Ğ½ÑÑ ĞºĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ°",
    formNextCalibration: "Ğ¡Ğ»ĞµĞ´ÑƒÑÑ‰Ğ°Ñ ĞºĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ°",
    formLocation: "ĞœĞµÑÑ‚Ğ¾Ğ¿Ğ¾Ğ»Ğ¾Ğ¶ĞµĞ½Ğ¸Ğµ/ĞÑ‚Ğ´ĞµĞ»",
    formResponsible: "ĞÑ‚Ğ²ĞµÑ‚ÑÑ‚Ğ²ĞµĞ½Ğ½Ğ¾Ğµ Ğ»Ğ¸Ñ†Ğ¾",
    btnSave: "Ğ¡Ğ¾Ñ…Ñ€Ğ°Ğ½Ğ¸Ñ‚ÑŒ",
    btnAdd: "Ğ”Ğ¾Ğ±Ğ°Ğ²Ğ¸Ñ‚ÑŒ",
    btnClose: "Ğ—Ğ°ĞºÑ€Ñ‹Ñ‚ÑŒ",
    qrTitle: "QR-ĞºĞ¾Ğ´",
    qrHint: "Ğ Ğ°ÑĞ¿ĞµÑ‡Ğ°Ñ‚Ğ°Ğ¹Ñ‚Ğµ QR-ĞºĞ¾Ğ´ Ğ´Ğ»Ñ Ñ€Ğ°Ğ·Ğ¼ĞµÑ‰ĞµĞ½Ğ¸Ñ Ğ½Ğ° Ğ´Ğ²ĞµÑ€ÑÑ… ÑĞºĞ»Ğ°Ğ´Ğ°.",
    adminTitle: "ĞŸĞ°Ğ½ĞµĞ»ÑŒ Ğ°Ğ´Ğ¼Ğ¸Ğ½Ğ¸ÑÑ‚Ñ€Ğ¸Ñ€Ğ¾Ğ²Ğ°Ğ½Ğ¸Ñ",
    adminReAuthText: "ĞŸĞ¾Ğ¶Ğ°Ğ»ÑƒĞ¹ÑÑ‚Ğ°, Ğ²Ğ²ĞµĞ´Ğ¸Ñ‚Ğµ Ğ¿Ğ°Ñ€Ğ¾Ğ»ÑŒ Ğ°Ğ´Ğ¼Ğ¸Ğ½Ğ¸ÑÑ‚Ñ€Ğ°Ñ‚Ğ¾Ñ€Ğ° Ğ´Ğ»Ñ Ğ´Ğ¾ÑÑ‚ÑƒĞ¿Ğ° Ğº Ğ¿Ğ°Ğ½ĞµĞ»Ğ¸.",
    adminPassword: "ĞŸĞ°Ñ€Ğ¾Ğ»ÑŒ Ğ°Ğ´Ğ¼Ğ¸Ğ½Ğ¸ÑÑ‚Ñ€Ğ°Ñ‚Ğ¾Ñ€Ğ°",
    btnVerify: "ĞŸÑ€Ğ¾Ğ²ĞµÑ€Ğ¸Ñ‚ÑŒ",
    adminSessionRole: "Ğ Ğ¾Ğ»ÑŒ ÑĞµÑÑĞ¸Ğ¸",
    adminLastLogin: "ĞŸĞ¾ÑĞ»ĞµĞ´Ğ½Ğ¸Ğ¹ Ğ²Ñ…Ğ¾Ğ´",
    adminAuthMethod: "ĞœĞµÑ‚Ğ¾Ğ´ Ğ°Ğ²Ñ‚Ğ¾Ñ€Ğ¸Ğ·Ğ°Ñ†Ğ¸Ğ¸",
    adminStorage: "Ğ¥Ñ€Ğ°Ğ½Ğ¸Ğ»Ğ¸Ñ‰Ğµ Ğ¿Ğ°Ñ€Ğ¾Ğ»ĞµĞ¹",
    adminDataSource: "Ğ˜ÑÑ‚Ğ¾Ñ‡Ğ½Ğ¸Ğº Ğ´Ğ°Ğ½Ğ½Ñ‹Ñ…",
    adminUserMgmt: "Ğ£Ğ¿Ñ€Ğ°Ğ²Ğ»ĞµĞ½Ğ¸Ğµ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»ÑĞ¼Ğ¸",
    adminUserMgmtDesc: "Ğ”Ğ¾Ğ±Ğ°Ğ²Ğ»ÑĞ¹Ñ‚Ğµ, Ñ€ĞµĞ´Ğ°ĞºÑ‚Ğ¸Ñ€ÑƒĞ¹Ñ‚Ğµ Ğ¸Ğ»Ğ¸ ÑƒĞ´Ğ°Ğ»ÑĞ¹Ñ‚Ğµ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»ĞµĞ¹.",
    adminAddUser: "Ğ”Ğ¾Ğ±Ğ°Ğ²Ğ¸Ñ‚ÑŒ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»Ñ",
    adminUsername: "Ğ˜Ğ¼Ñ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»Ñ",
    adminDisplayName: "ĞÑ‚Ğ¾Ğ±Ñ€Ğ°Ğ¶Ğ°ĞµĞ¼Ğ¾Ğµ Ğ¸Ğ¼Ñ",
    adminPasswordLabel: "ĞŸĞ°Ñ€Ğ¾Ğ»ÑŒ",
    adminRole: "Ğ Ğ¾Ğ»ÑŒ",
    adminAddUserBtn: "Ğ”Ğ¾Ğ±Ğ°Ğ²Ğ¸Ñ‚ÑŒ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»Ñ",
    adminRolePerms: "ĞĞ°ÑÑ‚Ñ€Ğ¾Ğ¹ĞºĞ¸ Ğ¿Ñ€Ğ°Ğ² Ğ¿Ğ¾ Ñ€Ğ¾Ğ»ÑĞ¼",
    adminRolePermsDesc: "ĞĞ°ÑÑ‚Ñ€Ğ¾Ğ¹Ñ‚Ğµ, ĞºĞ°ĞºĞ¸Ğµ Ğ²ĞºĞ»Ğ°Ğ´ĞºĞ¸ Ğ´Ğ¾ÑÑ‚ÑƒĞ¿Ğ½Ñ‹ ĞºĞ°Ğ¶Ğ´Ğ¾Ğ¹ Ñ€Ğ¾Ğ»Ğ¸.",
    adminSecurity: "Ğ‘ĞµĞ·Ğ¾Ğ¿Ğ°ÑĞ½Ğ¾ÑÑ‚ÑŒ ÑĞµÑÑĞ¸Ğ¸",
    adminSecurityDesc: "Ğ¡ĞµÑÑĞ¸Ñ Ğ±ÑƒĞ´ĞµÑ‚ Ğ·Ğ°ĞºÑ€Ñ‹Ñ‚Ğ°, ĞµÑĞ»Ğ¸ Ğ½ĞµÑ‚ Ğ°ĞºÑ‚Ğ¸Ğ²Ğ½Ğ¾ÑÑ‚Ğ¸ Ğ² Ñ‚ĞµÑ‡ĞµĞ½Ğ¸Ğµ ÑƒĞºĞ°Ğ·Ğ°Ğ½Ğ½Ğ¾Ğ³Ğ¾ Ğ²Ñ€ĞµĞ¼ĞµĞ½Ğ¸.",
    adminInactivityTimeout: "Ğ¢Ğ°Ğ¹Ğ¼-Ğ°ÑƒÑ‚ Ğ½ĞµĞ°ĞºÑ‚Ğ¸Ğ²Ğ½Ğ¾ÑÑ‚Ğ¸",
    adminLogsTitle: "Ğ–ÑƒÑ€Ğ½Ğ°Ğ» Ğ´ĞµĞ¹ÑÑ‚Ğ²Ğ¸Ğ¹",
    adminLogsDesc: "Ğ’Ñ…Ğ¾Ğ´/Ğ²Ñ‹Ñ…Ğ¾Ğ´ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»ĞµĞ¹ Ğ¸ Ğ¾Ğ¿ĞµÑ€Ğ°Ñ†Ğ¸Ğ¸ Ñ Ğ·Ğ°Ğ¿Ğ¸ÑÑĞ¼Ğ¸",
    btnRefresh: "ĞĞ±Ğ½Ğ¾Ğ²Ğ¸Ñ‚ÑŒ",
    adminSaveBtn: "Ğ¡Ğ¾Ñ…Ñ€Ğ°Ğ½Ğ¸Ñ‚ÑŒ Ğ½Ğ°ÑÑ‚Ñ€Ğ¾Ğ¹ĞºĞ¸",
    adminFooterNote: "ĞŸĞ°Ñ€Ğ¾Ğ»Ğ¸ Ñ…Ñ€Ğ°Ğ½ÑÑ‚ÑÑ Ğ½Ğ° ÑĞµÑ€Ğ²ĞµÑ€Ğµ Ğ¿Ğ¾ÑÑ‚Ğ¾ÑĞ½Ğ½Ğ¾.",
    adminCloseBtn: "Ğ—Ğ°ĞºÑ€Ñ‹Ñ‚ÑŒ",
    logFilterDelete: "Ğ£Ğ´Ğ°Ğ»ĞµĞ½Ğ¸Ğµ",
    logFilterAddUser: "Ğ”Ğ¾Ğ±Ğ°Ğ²Ğ»ĞµĞ½Ğ¸Ğµ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»Ñ",
    logFilterDeleteUser: "Ğ£Ğ´Ğ°Ğ»ĞµĞ½Ğ¸Ğµ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»Ñ",
    adminRefreshBtn: "ĞĞ±Ğ½Ğ¾Ğ²Ğ¸Ñ‚ÑŒ",
    manualTitle: "Ğ ÑƒĞºĞ¾Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ¾ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»Ñ",
    manualSubtitle: "Ğ¡Ğ¸ÑÑ‚ĞµĞ¼Ğ° ĞºĞ¾Ğ½Ñ‚Ñ€Ğ¾Ğ»Ñ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ°, Ğ¿Ğ¾Ñ‚Ñ€ĞµĞ±Ğ»ĞµĞ½Ğ¸Ñ Ğ¸ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    compDataType: "Ğ¢Ğ¸Ğ¿ Ğ´Ğ°Ğ½Ğ½Ñ‹Ñ…",
    compLastWeek: "ĞŸÑ€Ğ¾ÑˆĞ»Ğ°Ñ Ğ½ĞµĞ´ĞµĞ»Ñ",
    compThisWeek: "Ğ­Ñ‚Ğ° Ğ½ĞµĞ´ĞµĞ»Ñ",
    compLastMonth: "ĞŸÑ€Ğ¾ÑˆĞ»Ñ‹Ğ¹ Ğ¼ĞµÑÑÑ†",
    compThisMonth: "Ğ­Ñ‚Ğ¾Ñ‚ Ğ¼ĞµÑÑÑ†",
    compLastYear: "ĞŸÑ€Ğ¾ÑˆĞ»Ñ‹Ğ¹ Ğ³Ğ¾Ğ´",
    compThisYear: "Ğ­Ñ‚Ğ¾Ñ‚ Ğ³Ğ¾Ğ´",
    compDiff: "Ğ Ğ°Ğ·Ğ½Ğ¸Ñ†Ğ°",
    compTotalWaste: "Ğ’ÑĞµĞ³Ğ¾ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² (ĞºĞ³)",
    compTotalProduction: "Ğ’ÑĞµĞ³Ğ¾ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²ĞµĞ´ĞµĞ½Ğ¾",
    compTurnstilePasses: "ĞŸÑ€Ğ¾Ñ…Ğ¾Ğ´Ñ‹ Ñ‚ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚Ğ°",
    compStudentCount: "ĞšĞ¾Ğ»-Ğ²Ğ¾ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ²",
    compWastePerPerson: "ĞÑ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² Ğ½Ğ° Ñ‡ĞµĞ»Ğ¾Ğ²ĞµĞºĞ° (Ğ³Ñ€)",
    monthlyCompDesc: "Ğ¡Ñ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ Ñ‚ĞµĞºÑƒÑ‰ĞµĞ³Ğ¾ Ğ¼ĞµÑÑÑ†Ğ° Ñ Ğ¿Ñ€Ğ¾ÑˆĞ»Ñ‹Ğ¼. â†‘ Ñ€Ğ¾ÑÑ‚, â†“ ÑĞ½Ğ¸Ğ¶ĞµĞ½Ğ¸Ğµ. Ğ¡Ğ½Ğ¸Ğ¶ĞµĞ½Ğ¸Ğµ (â†“) Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² Ğ¸ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² Ğ½Ğ° Ñ‡ĞµĞ»Ğ¾Ğ²ĞµĞºĞ° â€” ÑÑ‚Ğ¾ Ñ…Ğ¾Ñ€Ğ¾ÑˆĞ¾.",
    yearlyCompDesc: "Ğ¡Ñ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ğµ Ñ‚ĞµĞºÑƒÑ‰ĞµĞ³Ğ¾ Ğ³Ğ¾Ğ´Ğ° (Ñ Ğ½Ğ°Ñ‡Ğ°Ğ»Ğ° Ğ³Ğ¾Ğ´Ğ°) Ñ Ğ°Ğ½Ğ°Ğ»Ğ¾Ğ³Ğ¸Ñ‡Ğ½Ñ‹Ğ¼ Ğ¿ĞµÑ€Ğ¸Ğ¾Ğ´Ğ¾Ğ¼ Ğ¿Ñ€Ğ¾ÑˆĞ»Ğ¾Ğ³Ğ¾ Ğ³Ğ¾Ğ´Ğ°. â†‘ Ñ€Ğ¾ÑÑ‚, â†“ ÑĞ½Ğ¸Ğ¶ĞµĞ½Ğ¸Ğµ. Ğ¡Ğ½Ğ¸Ğ¶ĞµĞ½Ğ¸Ğµ (â†“) Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² Ğ¸ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² Ğ½Ğ° Ñ‡ĞµĞ»Ğ¾Ğ²ĞµĞºĞ° â€” ÑÑ‚Ğ¾ Ñ…Ğ¾Ñ€Ğ¾ÑˆĞ¾.",
    monthNames: ["Ğ¯Ğ½Ğ²Ğ°Ñ€ÑŒ","Ğ¤ĞµĞ²Ñ€Ğ°Ğ»ÑŒ","ĞœĞ°Ñ€Ñ‚","ĞĞ¿Ñ€ĞµĞ»ÑŒ","ĞœĞ°Ğ¹","Ğ˜ÑĞ½ÑŒ","Ğ˜ÑĞ»ÑŒ","ĞĞ²Ğ³ÑƒÑÑ‚","Ğ¡ĞµĞ½Ñ‚ÑĞ±Ñ€ÑŒ","ĞĞºÑ‚ÑĞ±Ñ€ÑŒ","ĞĞ¾ÑĞ±Ñ€ÑŒ","Ğ”ĞµĞºĞ°Ğ±Ñ€ÑŒ"],
    haccpColDate: "Ğ”Ğ°Ñ‚Ğ°",
    haccpColTime: "Ğ’Ñ€ĞµĞ¼Ñ",
    haccpColDepot: "ĞĞ°Ğ·Ğ²Ğ°Ğ½Ğ¸Ğµ ÑĞºĞ»Ğ°Ğ´Ğ°",
    haccpColTemp: "Ğ¢ĞµĞ¼Ğ¿ĞµÑ€Ğ°Ñ‚ÑƒÑ€Ğ° (Â°C)",
    haccpColHumidity: "Ğ’Ğ»Ğ°Ğ¶Ğ½Ğ¾ÑÑ‚ÑŒ (%)",
    haccpColNote: "ĞŸÑ€Ğ¸Ğ¼ĞµÑ‡Ğ°Ğ½Ğ¸Ğµ",
    haccpColAction: "Ğ”ĞµĞ¹ÑÑ‚Ğ²Ğ¸Ğµ",
    dayNames: ["ĞŸĞ¾Ğ½ĞµĞ´ĞµĞ»ÑŒĞ½Ğ¸Ğº", "Ğ’Ñ‚Ğ¾Ñ€Ğ½Ğ¸Ğº", "Ğ¡Ñ€ĞµĞ´Ğ°", "Ğ§ĞµÑ‚Ğ²ĞµÑ€Ğ³", "ĞŸÑÑ‚Ğ½Ğ¸Ñ†Ğ°"],
    menuVariety: "Ğ’Ğ¸Ğ´",
    menuVariety1: "1-Ğ¹ Ğ²Ğ¸Ğ´",
    menuVariety2: "2-Ğ¹ Ğ²Ğ¸Ğ´",
    menuVariety3: "3-Ğ¹ Ğ²Ğ¸Ğ´",
    menuVariety4: "4-Ğ¹ Ğ²Ğ¸Ğ´",
    menuVariety5: "5-Ğ¹ Ğ²Ğ¸Ğ´",
    menuPersonCount: "ĞšĞ¾Ğ»-Ğ²Ğ¾ Ñ‡ĞµĞ»Ğ¾Ğ²ĞµĞº",
    stockDeductionList: "Ğ¡Ğ¿Ğ¸ÑĞ°Ğ½Ğ¸Ğµ ÑĞ¾ ÑĞºĞ»Ğ°Ğ´Ğ°",
    total: "Ğ˜Ñ‚Ğ¾Ğ³Ğ¾",
    inVarieties: "Ğ²Ğ¸Ğ´Ğ°Ñ…",
    person: "Ñ‡ĞµĞ».",
    weeklyGrandTotal: "Ğ˜Ñ‚Ğ¾Ğ³Ğ¾ Ğ·Ğ° Ğ½ĞµĞ´ĞµĞ»Ñ",
    dailyAverage: "Ğ¡Ñ€ĞµĞ´Ğ½ĞµĞµ Ğ² Ğ´ĞµĞ½ÑŒ",
    avgPerPerson: "Ğ¡Ñ€ĞµĞ´Ğ½ĞµĞµ Ğ½Ğ° Ñ‡ĞµĞ»Ğ¾Ğ²ĞµĞºĞ°",
    totalPersonDays: "Ğ’ÑĞµĞ³Ğ¾ Ñ‡ĞµĞ»Ğ¾Ğ²ĞµĞº/Ğ´Ğ½ĞµĞ¹",
    colDay: "Ğ”ĞµĞ½ÑŒ",
    colDate: "Ğ”Ğ°Ñ‚Ğ°",
    colPerson: "Ğ§ĞµĞ».",
    dailyMaterialCost: "Ğ¡ÑƒÑ‚Ğ¾Ñ‡Ğ½Ğ°Ñ ÑÑ‚Ğ¾Ğ¸Ğ¼Ğ¾ÑÑ‚ÑŒ Ğ¼Ğ°Ñ‚ĞµÑ€Ğ¸Ğ°Ğ»Ğ¾Ğ²",
    perPerson: "ĞĞ° Ñ‡ĞµĞ»Ğ¾Ğ²ĞµĞºĞ°",
    ingredients: "Ğ˜Ğ½Ğ³Ñ€ĞµĞ´Ğ¸ĞµĞ½Ñ‚Ñ‹",
    perPersonGram: "(Ğ³Ñ€Ğ°Ğ¼Ğ¼ Ğ½Ğ° Ñ‡ĞµĞ»Ğ¾Ğ²ĞµĞºĞ°)",
    colIngredient: "Ğ˜Ğ½Ğ³Ñ€ĞµĞ´Ğ¸ĞµĞ½Ñ‚",
    colPerPerson: "/Ñ‡ĞµĞ».",
    colUnit: "Ğ•Ğ´.",
    addIngredient: "+ Ğ”Ğ¾Ğ±Ğ°Ğ²Ğ¸Ñ‚ÑŒ Ğ¸Ğ½Ğ³Ñ€ĞµĞ´Ğ¸ĞµĞ½Ñ‚",
    foodName: "ĞĞ°Ğ·Ğ²Ğ°Ğ½Ğ¸Ğµ Ğ±Ğ»ÑĞ´Ğ°",
    allergen: "ĞĞ»Ğ»ĞµÑ€Ğ³ĞµĞ½",
    recipePerPerson: "Ğ ĞµÑ†ĞµĞ¿Ñ‚ (Ğ½Ğ° Ñ‡ĞµĞ»Ğ¾Ğ²ĞµĞºĞ°)",
    devices: "ÑˆÑ‚.",
    chartMonthlyProduction: "Ежемесячное производство (чел.)",
    chartMonthlyPasses: "Ежемесячные проходы (чел.)",
    chartLastYearWaste: "Прошлый год утилизировано (порций)",
    chartMonthlyWasteKg: "Ежемесячные отходы (кг)",
    chartMonthlyMealCount: "Ежемесячное количество приёмов пищи",
    chartMonthlyWasteRate: "Ежемесячный уровень отходов %",
    chartMonthlyStudent: "Ежемесячное количество студентов",
    chartWastePerPersonLabel: "Отходы на человека (кг/чел.)",
    maliTablo: "Ğ¤Ğ¸Ğ½Ğ°Ğ½ÑĞ¾Ğ²Ğ°Ñ Ğ¢Ğ°Ğ±Ğ»Ğ¸Ñ†Ğ°",
    maliTabloSubtitle: "Ğ¡Ğ²Ğ¾Ğ´ĞºĞ° Ğ½ĞµĞ´ĞµĞ»ÑŒĞ½Ñ‹Ñ… Ğ·Ğ°Ñ‚Ñ€Ğ°Ñ‚ Ğ½Ğ° Ğ¼Ğ°Ñ‚ĞµÑ€Ğ¸Ğ°Ğ»Ñ‹",
    maliUnitPriceMissing: "ĞµĞ´Ğ¸Ğ½Ğ¸Ñ‡Ğ½Ğ°Ñ Ñ†ĞµĞ½Ğ° Ğ¼Ğ°Ñ‚ĞµÑ€Ğ¸Ğ°Ğ»Ğ° Ğ½Ğµ Ğ¾Ğ¿Ñ€ĞµĞ´ĞµĞ»ĞµĞ½Ğ°",
    maliUnitPriceHint: "ĞœĞ¾Ğ¶Ğ½Ğ¾ Ğ·Ğ°Ğ´Ğ°Ñ‚ÑŒ Ğ² Ñ€Ğ°Ğ·Ğ´ĞµĞ»Ğµ Â«Ğ•Ğ´Ğ¸Ğ½Ğ¸Ñ‡Ğ½Ñ‹Ğµ Ñ†ĞµĞ½Ñ‹Â»",
    weeklyTotal: "Ğ˜Ğ¢ĞĞ“Ğ Ğ—Ğ ĞĞ•Ğ”Ğ•Ğ›Ğ®",
    categoryDistribution: "Ğ Ğ°ÑĞ¿Ñ€ĞµĞ´ĞµĞ»ĞµĞ½Ğ¸Ğµ Ğ¿Ğ¾ ĞºĞ°Ñ‚ĞµĞ³Ğ¾Ñ€Ğ¸ÑĞ¼",
    weeklyTotalList: "Ğ•Ğ¶ĞµĞ½ĞµĞ´ĞµĞ»ÑŒĞ½Ñ‹Ğ¹ ÑĞ¿Ğ¸ÑĞ¾Ğº Ğ¿Ğ¾Ñ‚Ñ€ĞµĞ±Ğ½Ğ¾ÑÑ‚ĞµĞ¹",
    totalCost: "ĞĞ±Ñ‰Ğ°Ñ ÑÑ‚Ğ¾Ğ¸Ğ¼Ğ¾ÑÑ‚ÑŒ",
    catMeat: "ĞœÑÑĞ½Ñ‹Ğµ Ğ¿Ñ€Ğ¾Ğ´ÑƒĞºÑ‚Ñ‹",
    catDairy: "ĞœĞ¾Ğ»Ğ¾Ñ‡Ğ½Ñ‹Ğµ Ğ¿Ñ€Ğ¾Ğ´ÑƒĞºÑ‚Ñ‹",
    catLegumes: "Ğ¡ÑƒÑ…Ğ¸Ğµ Ğ±Ğ¾Ğ±Ğ¾Ğ²Ñ‹Ğµ",
    catSpices: "Ğ¡Ğ¿ĞµÑ†Ğ¸Ğ¸",
    catVegetable: "ĞĞ²Ğ¾Ñ‰Ğ¸ Ğ¸ Ñ„Ñ€ÑƒĞºÑ‚Ñ‹",
    catOther: "ĞŸÑ€Ğ¾Ñ‡ĞµĞµ",
    month1: "Ğ¯Ğ½Ğ²Ğ°Ñ€ÑŒ", month2: "Ğ¤ĞµĞ²Ñ€Ğ°Ğ»ÑŒ", month3: "ĞœĞ°Ñ€Ñ‚", month4: "ĞĞ¿Ñ€ĞµĞ»ÑŒ",
    month5: "ĞœĞ°Ğ¹", month6: "Ğ˜ÑĞ½ÑŒ", month7: "Ğ˜ÑĞ»ÑŒ", month8: "ĞĞ²Ğ³ÑƒÑÑ‚",
    month9: "Ğ¡ĞµĞ½Ñ‚ÑĞ±Ñ€ÑŒ", month10: "ĞĞºÑ‚ÑĞ±Ñ€ÑŒ", month11: "ĞĞ¾ÑĞ±Ñ€ÑŒ", month12: "Ğ”ĞµĞºĞ°Ğ±Ñ€ÑŒ",
    menuListTitle: "Ğ¡ĞŸĞ˜Ğ¡ĞĞš ĞœĞ•ĞĞ®",
    totalDevices: "Ğ’ÑĞµĞ³Ğ¾ ÑƒÑÑ‚Ñ€Ğ¾Ğ¹ÑÑ‚Ğ²",
    statusWorking: "Ğ˜ÑĞ¿Ñ€Ğ°Ğ²Ğ½Ğ¾",
    statusDefective: "ĞĞµĞ¸ÑĞ¿Ñ€Ğ°Ğ²Ğ½Ğ¾",
    statusMaintenance: "Ğ¢Ñ€ĞµĞ±ÑƒĞµÑ‚ Ğ¾Ğ±ÑĞ»ÑƒĞ¶Ğ¸Ğ²Ğ°Ğ½Ğ¸Ñ",
    statusScrap: "ĞŸĞ¾Ğ´Ğ»ĞµĞ¶Ğ¸Ñ‚ ÑĞ¿Ğ¸ÑĞ°Ğ½Ğ¸Ñ",
    calibrationValid: "ĞšĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ° Ğ´ĞµĞ¹ÑÑ‚Ğ²Ğ¸Ñ‚ĞµĞ»ÑŒĞ½Ğ°",
    calibrationApproaching: "ĞšĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ° Ğ¿Ñ€Ğ¸Ğ±Ğ»Ğ¸Ğ¶Ğ°ĞµÑ‚ÑÑ (30 Ğ´Ğ½ĞµĞ¹)",
    differentDepartments: "Ğ Ğ°Ğ·Ğ½Ñ‹Ğµ Ğ¾Ñ‚Ğ´ĞµĞ»Ñ‹",
    statusApproaching: "ĞŸÑ€Ğ¸Ğ±Ğ»Ğ¸Ğ¶Ğ°ĞµÑ‚ÑÑ",
    statusExpired: "Ğ¡Ñ€Ğ¾Ğº Ğ¸ÑÑ‚Ñ‘Ğº",
    statusNotDone: "ĞĞµ Ğ²Ñ‹Ğ¿Ğ¾Ğ»Ğ½ĞµĞ½Ğ¾",
    statusValid: "Ğ”ĞµĞ¹ÑÑ‚Ğ²Ğ¸Ñ‚ĞµĞ»ÑŒĞ½Ğ¾",
    noDeviceFound: "Ğ£ÑÑ‚Ñ€Ğ¾Ğ¹ÑÑ‚Ğ²Ğ°, ÑĞ¾Ğ¾Ñ‚Ğ²ĞµÑ‚ÑÑ‚Ğ²ÑƒÑÑ‰Ğ¸Ğµ ÑÑ‚Ğ¸Ğ¼ ĞºÑ€Ğ¸Ñ‚ĞµÑ€Ğ¸ÑĞ¼, Ğ½Ğµ Ğ½Ğ°Ğ¹Ğ´ĞµĞ½Ñ‹.",
    noDeviceRecord: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ Ğ¾Ğ± ÑƒÑÑ‚Ñ€Ğ¾Ğ¹ÑÑ‚Ğ²Ğ°Ñ… Ğ´Ğ»Ñ ĞºĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ¸ Ğ¿Ğ¾ĞºĞ° Ğ½Ğµ Ğ²Ğ²ĞµĞ´ĞµĞ½Ñ‹.",
    deviceCount: "ÑˆÑ‚.",
    deviceCountSuffix: " ÑˆÑ‚.",
    editDeviceTitle: "Ğ ĞµĞ´Ğ°ĞºÑ‚Ğ¸Ñ€Ğ¾Ğ²Ğ°Ñ‚ÑŒ ÑƒÑÑ‚Ñ€Ğ¾Ğ¹ÑÑ‚Ğ²Ğ¾ ĞºĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ¸",
    newDeviceTitle: "ĞĞ¾Ğ²Ğ¾Ğµ ÑƒÑÑ‚Ñ€Ğ¾Ğ¹ÑÑ‚Ğ²Ğ¾ ĞºĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ¸",
    kpiBeneficiary: "ĞŸĞ¾Ğ»ÑŒĞ·ÑƒÑÑ‚ÑÑ: ",
    kpiNoRecordToday: "ĞĞµÑ‚ Ğ·Ğ°Ğ¿Ğ¸ÑĞ¸ Ğ·Ğ° ÑĞµĞ³Ğ¾Ğ´Ğ½Ñ",
    kpiAlertsCount: "Ğ¿Ñ€ĞµĞ´ÑƒĞ¿Ñ€ĞµĞ¶Ğ´ĞµĞ½Ğ¸Ğ¹",
    kpiAllValuesOk: "Ğ’ÑĞµ Ğ·Ğ½Ğ°Ñ‡ĞµĞ½Ğ¸Ñ Ğ² Ğ½Ğ¾Ñ€Ğ¼Ğµ",
    kpiDeviceInAlarm: "ÑƒÑÑ‚Ñ€Ğ¾Ğ¹ÑÑ‚Ğ² Ğ² Ñ‚Ñ€ĞµĞ²Ğ¾Ğ³Ğµ",
    kpiApproaching: "Ğ¿Ñ€Ğ¸Ğ±Ğ»Ğ¸Ğ¶Ğ°ĞµÑ‚ÑÑ",
    kpiAllCalibrationsValid: "Ğ’ÑĞµ ĞºĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ¸ Ğ´ĞµĞ¹ÑÑ‚Ğ²Ğ¸Ñ‚ĞµĞ»ÑŒĞ½Ñ‹",
    filterAll: "Ğ’ÑĞµ",
    colDeviceName: "ĞĞ°Ğ·Ğ²Ğ°Ğ½Ğ¸Ğµ ÑƒÑÑ‚Ñ€Ğ¾Ğ¹ÑÑ‚Ğ²Ğ°",
    colBrandModel: "ĞœĞ°Ñ€ĞºĞ°-ĞœĞ¾Ğ´ĞµĞ»ÑŒ",
    colSerialNo: "Ğ¡ĞµÑ€Ğ¸Ğ¹Ğ½Ñ‹Ğ¹ Ğ½Ğ¾Ğ¼ĞµÑ€",
    colDeviceStatus: "Ğ¡Ğ¾ÑÑ‚Ğ¾ÑĞ½Ğ¸Ğµ",
    colCalibration: "ĞšĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ°",
    colLastCalibration: "ĞŸĞ¾ÑĞ»ĞµĞ´Ğ½ÑÑ ĞºĞ°Ğ»Ğ¸Ğ±Ñ€Ğ¾Ğ²ĞºĞ°",
    colNextCalibration: "Ğ¡Ğ»ĞµĞ´ÑƒÑÑ‰Ğ°Ñ",
    colDepartment: "ĞÑ‚Ğ´ĞµĞ»",
    colResponsible: "ĞÑ‚Ğ²ĞµÑ‚ÑÑ‚Ğ²ĞµĞ½Ğ½Ñ‹Ğ¹",
    colNote: "ĞŸÑ€Ğ¸Ğ¼ĞµÑ‡Ğ°Ğ½Ğ¸Ğµ",
    colAction: "Ğ”ĞµĞ¹ÑÑ‚Ğ²Ğ¸Ğµ",
    unitPriceList: "Ğ¡Ğ¿Ğ¸ÑĞ¾Ğº ĞµĞ´Ğ¸Ğ½Ğ¸Ñ‡Ğ½Ñ‹Ñ… Ñ†ĞµĞ½",
    registeredProducts: "Ğ—Ğ°Ñ€ĞµĞ³Ğ¸ÑÑ‚Ñ€Ğ¸Ñ€Ğ¾Ğ²Ğ°Ğ½Ğ½Ñ‹Ğµ Ñ‚Ğ¾Ğ²Ğ°Ñ€Ñ‹",
    totalAmount: "ĞĞ±Ñ‰Ğ°Ñ ÑÑƒĞ¼Ğ¼Ğ°",
    avgUnitPrice: "Ğ¡Ñ€ĞµĞ´Ğ½ÑÑ Ñ†ĞµĞ½Ğ° Ğ·Ğ° ĞµĞ´Ğ¸Ğ½Ğ¸Ñ†Ñƒ",
    selectedYear: "Ğ’Ñ‹Ğ±Ñ€Ğ°Ğ½Ğ½Ñ‹Ğ¹ Ğ³Ğ¾Ğ´",
    duplicateWarning: "Ñ‚Ğ¾Ğ²Ğ°Ñ€Ğ¾Ğ² Ñ Ğ´ÑƒĞ±Ğ»Ğ¸Ñ€ÑƒÑÑ‰Ğ¸Ğ¼Ğ¸ÑÑ Ğ·Ğ°Ğ¿Ğ¸ÑÑĞ¼Ğ¸. Ğ Ğ°ÑÑ‡Ñ‘Ñ‚ Ñ†ĞµĞ½ Ğ¼Ğ¾Ğ¶ĞµÑ‚ ÑĞ¾Ğ´ĞµÑ€Ğ¶Ğ°Ñ‚ÑŒ Ğ¾ÑˆĞ¸Ğ±ĞºĞ¸.",
    cleanDuplicates: "Ğ£Ğ´Ğ°Ğ»Ğ¸Ñ‚ÑŒ Ğ¿Ğ¾ Ğ¾Ğ´Ğ½Ğ¾Ğ¼Ñƒ",
    colProductName: "ĞĞ°Ğ·Ğ²Ğ°Ğ½Ğ¸Ğµ Ñ‚Ğ¾Ğ²Ğ°Ñ€Ğ°",
    colUnit: "Ğ•Ğ´.",
    colUnitPrice: "Ğ¦ĞµĞ½Ğ° Ğ·Ğ° ĞµĞ´Ğ¸Ğ½Ğ¸Ñ†Ñƒ (â‚º)",
    colUnitEquals: "1 Ğ•Ğ´. =",
    colYear: "Ğ“Ğ¾Ğ´",
    noProductsThisYear: "Ğ¢Ğ¾Ğ²Ğ°Ñ€Ñ‹ Ğ·Ğ° ÑÑ‚Ğ¾Ñ‚ Ğ³Ğ¾Ğ´ ĞµÑ‰Ñ‘ Ğ½Ğµ Ğ´Ğ¾Ğ±Ğ°Ğ²Ğ»ĞµĞ½Ñ‹.",
    btnEdit: "Ğ ĞµĞ´Ğ°ĞºÑ‚Ğ¸Ñ€Ğ¾Ğ²Ğ°Ñ‚ÑŒ",
    btnDelete: "Ğ£Ğ´Ğ°Ğ»Ğ¸Ñ‚ÑŒ",
    pageLabel: "Ğ¡Ñ‚Ñ€Ğ°Ğ½Ğ¸Ñ†Ğ°",
    totalProductsLabel: "Ğ˜Ñ‚Ğ¾Ğ³Ğ¾",
    totalProductsSuffix: " Ñ‚Ğ¾Ğ²Ğ°Ñ€Ğ¾Ğ²",
    priceYearNote: "Ğ¦ĞµĞ½Ñ‹ Ğ¿Ñ€Ğ¸Ğ²ÑĞ·Ğ°Ğ½Ñ‹ Ğº Ğ³Ğ¾Ğ´Ñƒ. Ğ¡Ğ¾Ğ¿Ğ¾ÑÑ‚Ğ°Ğ²Ğ»ĞµĞ½Ğ¸Ğµ: Ğ½Ğ°Ğ·Ğ²Ğ°Ğ½Ğ¸Ğµ Ğ¼Ğ°Ñ‚ĞµÑ€Ğ¸Ğ°Ğ»Ğ° Ğ°Ğ²Ñ‚Ğ¾Ğ¼Ğ°Ñ‚Ğ¸Ñ‡ĞµÑĞºĞ¸ Ğ½Ğ¾Ñ€Ğ¼Ğ°Ğ»Ğ¸Ğ·ÑƒĞµÑ‚ÑÑ.",
    btnAddNewProduct: "+ ĞĞ¾Ğ²Ñ‹Ğ¹ Ñ‚Ğ¾Ğ²Ğ°Ñ€",
    btnDownloadCSV: "Ğ¡ĞºĞ°Ñ‡Ğ°Ñ‚ÑŒ CSV",
    btnPrint: "ĞŸĞµÑ‡Ğ°Ñ‚ÑŒ",
    btnUploadCSV: "Ğ—Ğ°Ğ³Ñ€ÑƒĞ·Ğ¸Ñ‚ÑŒ CSV",
    clickToSelectYear: "ĞĞ°Ğ¶Ğ¼Ğ¸Ñ‚Ğµ Ğ´Ğ»Ñ Ğ²Ñ‹Ğ±Ğ¾Ñ€Ğ° Ğ³Ğ¾Ğ´Ğ°",
    selectYear: "Ğ’Ñ‹Ğ±Ñ€Ğ°Ñ‚ÑŒ Ğ³Ğ¾Ğ´",
    dataInfoRecord: "Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹",
    dataInfoProduction: "Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²ĞµĞ´ĞµĞ½Ğ¾",
    dataInfoWaste: "Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ñ‹",
    portion: "Ğ¿Ğ¾Ñ€Ñ†Ğ¸Ğ¹",
    abnormalDays: "Ğ°Ğ½Ğ¾Ğ¼Ğ°Ğ»ÑŒĞ½Ñ‹Ñ… Ğ´Ğ½ĞµĞ¹",
    noRecordsToDisplay: "ĞĞµÑ‚ Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹ Ğ´Ğ»Ñ Ğ¾Ñ‚Ğ¾Ğ±Ñ€Ğ°Ğ¶ĞµĞ½Ğ¸Ñ.",
    colYearLabel: "Ğ“Ğ¾Ğ´",
    avgPortion400: "400 Ğ³",
    recordsNot400: "Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹ Ğ½Ğµ 400",
    gram: " Ğ³",
    personLabel: "Ğ§ĞµĞ»",
    last7RecordsPrev7: "Ğ¿Ğ¾ÑĞ»ĞµĞ´Ğ½Ğ¸Ğµ 7 Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹ / Ğ¿Ñ€ĞµĞ´Ñ‹Ğ´ÑƒÑ‰Ğ¸Ğµ 7",
    tempAppropriate: "ĞĞ¾Ñ€Ğ¼Ğ°",
    tempLow: "ĞĞ¸Ğ·ĞºĞ°Ñ",
    tempHigh: "Ğ’Ñ‹ÑĞ¾ĞºĞ°Ñ",
    lowerLimit: "ĞĞ¸Ğ¶Ğ½Ğ¸Ğ¹ Ğ¿Ñ€ĞµĞ´ĞµĞ»: ",
    upperLimit: "Ğ’ĞµÑ€Ñ…Ğ½Ğ¸Ğ¹ Ğ¿Ñ€ĞµĞ´ĞµĞ»: ",
    unknownDepo: "ĞĞµĞ¸Ğ·Ğ²ĞµÑÑ‚Ğ½Ğ¾",
    tempMin: "ĞœĞ¸Ğ½: ",
    tempAvg: "Ğ¡Ñ€Ğ´: ",
    tempMax: "ĞœĞ°ĞºÑ: ",
    humidity: "Ğ’Ğ»Ğ°Ğ¶Ğ½Ğ¾ÑÑ‚ÑŒ: ",
    depot: "Ğ¥Ğ¾Ğ»Ğ¾Ğ´Ğ¸Ğ»ÑŒĞ½Ğ¸Ğº",
    selectedCount: " Ğ²Ñ‹Ğ±Ñ€Ğ°Ğ½Ğ¾",
    pageRecords: "Ğ¡Ñ‚Ñ€Ğ°Ğ½Ğ¸Ñ†Ğ° ",
    recordCount: " Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹)",
    tempRecordsTitle: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ Ñ‚ĞµĞ¼Ğ¿ĞµÑ€Ğ°Ñ‚ÑƒÑ€Ñ‹ Ñ…Ğ¾Ğ»Ğ¾Ğ´Ğ¸Ğ»ÑŒĞ½Ğ¸ĞºĞ¾Ğ²",
    dateRangeLabel: " | Ğ”Ğ°Ñ‚Ğ°:",
    allDepots: "Ğ’ÑĞµ Ñ…Ğ¾Ğ»Ğ¾Ğ´Ğ¸Ğ»ÑŒĞ½Ğ¸ĞºĞ¸",
    colTime: "Ğ’Ñ€ĞµĞ¼Ñ",
    colDepot: "Ğ¥Ğ¾Ğ»Ğ¾Ğ´Ğ¸Ğ»ÑŒĞ½Ğ¸Ğº",
    colTemperature: "Ğ¢ĞµĞ¼Ğ¿ĞµÑ€Ğ°Ñ‚ÑƒÑ€Ğ°",
    colStatus: "Ğ¡Ñ‚Ğ°Ñ‚ÑƒÑ",
    depotTempRecordTitle: "Ğ—Ğ°Ğ¿Ğ¸ÑÑŒ Ñ‚ĞµĞ¼Ğ¿ĞµÑ€Ğ°Ñ‚ÑƒÑ€Ñ‹",
    formDate: "Ğ”Ğ°Ñ‚Ğ°",
    formTime: "Ğ’Ñ€ĞµĞ¼Ñ",
    formDepotName: "ĞĞ°Ğ·Ğ²Ğ°Ğ½Ğ¸Ğµ Ñ…Ğ¾Ğ»Ğ¾Ğ´Ğ¸Ğ»ÑŒĞ½Ğ¸ĞºĞ°",
    formTemperature: "Ğ¢ĞµĞ¼Ğ¿ĞµÑ€Ğ°Ñ‚ÑƒÑ€Ğ° (Â°C)",
    tempPlaceholder: "0.0 (Ğ¼Ğ¾Ğ¶Ğ½Ğ¾ Ğ¾ÑÑ‚Ğ°Ğ²Ğ¸Ñ‚ÑŒ Ğ¿ÑƒÑÑ‚Ñ‹Ğ¼)",
    formHumidity: "Ğ’Ğ»Ğ°Ğ¶Ğ½Ğ¾ÑÑ‚ÑŒ (%)",
    formNoteOptional: "ĞĞµĞ¾Ğ±ÑĞ·Ğ°Ñ‚ĞµĞ»ÑŒĞ½Ğ¾",
    deleteConfirm: "Ğ’Ñ‹ ÑƒĞ²ĞµÑ€ĞµĞ½Ñ‹, Ñ‡Ñ‚Ğ¾ Ñ…Ğ¾Ñ‚Ğ¸Ñ‚Ğµ ÑƒĞ´Ğ°Ğ»Ğ¸Ñ‚ÑŒ ÑÑ‚Ñƒ Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ?",
    deleteSelectedConfirm: "Ğ’Ñ‹ ÑƒĞ²ĞµÑ€ĞµĞ½Ñ‹, Ñ‡Ñ‚Ğ¾ Ñ…Ğ¾Ñ‚Ğ¸Ñ‚Ğµ ÑƒĞ´Ğ°Ğ»Ğ¸Ñ‚ÑŒ ",
    deleteSelectedConfirmSuffix: " Ğ²Ñ‹Ğ±Ñ€Ğ°Ğ½Ğ½Ñ‹Ñ… Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹?",
    tempHistory: " Ğ˜ÑÑ‚Ğ¾Ñ€Ğ¸Ñ Ñ‚ĞµĞ¼Ğ¿ĞµÑ€Ğ°Ñ‚ÑƒÑ€Ñ‹",
    weeklyAvgTempNote: "Ğ¡Ñ€ĞµĞ´Ğ½Ğ¸Ğµ Ğ½ĞµĞ´ĞµĞ»ÑŒĞ½Ñ‹Ğµ Ğ·Ğ½Ğ°Ñ‡ĞµĞ½Ğ¸Ñ Ñ‚ĞµĞ¼Ğ¿ĞµÑ€Ğ°Ñ‚ÑƒÑ€Ñ‹ â€” Ñ Ğ»Ğ¸Ğ½Ğ¸ÑĞ¼Ğ¸ Ğ²ĞµÑ€Ñ…Ğ½ĞµĞ³Ğ¾ Ğ¸ Ğ½Ğ¸Ğ¶Ğ½ĞµĞ³Ğ¾ Ğ¿Ñ€ĞµĞ´ĞµĞ»Ğ¾Ğ²",
    upperLimitLabel: "Ğ’ĞµÑ€Ñ…Ğ½Ğ¸Ğ¹ Ğ¿Ñ€ĞµĞ´ĞµĞ» (",
    lowerLimitLabel: "ĞĞ¸Ğ¶Ğ½Ğ¸Ğ¹ Ğ¿Ñ€ĞµĞ´ĞµĞ» (",
    totalRecordCount: "Ğ’ÑĞµĞ³Ğ¾ Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹",
    totalWasteOil: "Ğ’ÑĞµĞ³Ğ¾ Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ³Ğ¾ Ğ¼Ğ°ÑĞ»Ğ°",
    avgAmountPerRecord: "Ğ¡Ñ€Ğ´. ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ / Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ",
    highestAmount: "ĞĞ°Ğ¸Ğ±Ğ¾Ğ»ÑŒÑˆĞµĞµ ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾",
    lowestAmount: "ĞĞ°Ğ¸Ğ¼ĞµĞ½ÑŒÑˆĞµĞµ ĞºĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾",
    oilTypeCount: "ĞšĞ¾Ğ»-Ğ²Ğ¾ Ğ²Ğ¸Ğ´Ğ¾Ğ² Ğ¼Ğ°ÑĞ»Ğ°",
    yearTotalSuffix: " Ğ˜Ñ‚Ğ¾Ğ³Ğ¾",
    startDate: "ĞĞ°Ñ‡Ğ°Ğ»Ğ¾",
    endDate: "ĞšĞ¾Ğ½ĞµÑ†",
    typeLabel: "Ğ¢Ğ¸Ğ¿: ",
    yearLabel: "Ğ“Ğ¾Ğ´: ",
    activeFilterLabel: "ĞĞºÑ‚Ğ¸Ğ²Ğ½Ñ‹Ğ¹ Ñ„Ğ¸Ğ»ÑŒÑ‚Ñ€: ",
    noFilterMessage: "Ğ‘ĞµĞ· Ñ„Ğ¸Ğ»ÑŒÑ‚Ñ€Ğ° â€” Ğ¿Ğ¾ĞºĞ°Ğ·Ğ°Ğ½Ñ‹ Ğ²ÑĞµ Ğ·Ğ°Ğ¿Ğ¸ÑĞ¸ Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ³Ğ¾ Ğ¼Ğ°ÑĞ»Ğ°.",
    noWasteOilRecord: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ³Ğ¾ Ğ¼Ğ°ÑĞ»Ğ° Ğ¿Ğ¾ĞºĞ° Ğ½Ğµ Ğ²Ğ²ĞµĞ´ĞµĞ½Ñ‹.",
    noMatchingFilterRecord: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸, ÑĞ¾Ğ¾Ñ‚Ğ²ĞµÑ‚ÑÑ‚Ğ²ÑƒÑÑ‰Ğ¸Ğµ ĞºÑ€Ğ¸Ñ‚ĞµÑ€Ğ¸ÑĞ¼ Ñ„Ğ¸Ğ»ÑŒÑ‚Ñ€Ğ°, Ğ½Ğµ Ğ½Ğ°Ğ¹Ğ´ĞµĞ½Ñ‹.",
    editWasteOilRecord: "Ğ ĞµĞ´Ğ°ĞºÑ‚Ğ¸Ñ€Ğ¾Ğ²Ğ°Ñ‚ÑŒ Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ³Ğ¾ Ğ¼Ğ°ÑĞ»Ğ°",
    newWasteOilRecord: "ĞĞ¾Ğ²Ğ°Ñ Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ Ğ¾Ñ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğ³Ğ¾ Ğ¼Ğ°ÑĞ»Ğ°",
    wasteOilChartLabel: "ĞÑ‚Ñ€Ğ°Ğ±Ğ¾Ñ‚Ğ°Ğ½Ğ½Ğ¾Ğµ Ğ¼Ğ°ÑĞ»Ğ¾",
    previousYearLabel: "ĞŸÑ€ĞµĞ´Ñ‹Ğ´ÑƒÑ‰Ğ¸Ğ¹ Ğ³Ğ¾Ğ´",
    undefinedType: "ĞĞµ ÑƒĞºĞ°Ğ·Ğ°Ğ½Ğ¾",
    totalWastePackaging: "Ğ’ÑĞµĞ³Ğ¾ ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    wasteTypeCount: "ĞšĞ¾Ğ»-Ğ²Ğ¾ Ğ²Ğ¸Ğ´Ğ¾Ğ² Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    noWastePackagingRecord: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ² Ğ¿Ğ¾ĞºĞ° Ğ½Ğµ Ğ²Ğ²ĞµĞ´ĞµĞ½Ñ‹.",
    noMatchingFilterPackage: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸, ÑĞ¾Ğ¾Ñ‚Ğ²ĞµÑ‚ÑÑ‚Ğ²ÑƒÑÑ‰Ğ¸Ğµ ĞºÑ€Ğ¸Ñ‚ĞµÑ€Ğ¸ÑĞ¼ Ñ„Ğ¸Ğ»ÑŒÑ‚Ñ€Ğ°, Ğ½Ğµ Ğ½Ğ°Ğ¹Ğ´ĞµĞ½Ñ‹.",
    noFilterMessagePackaging: "Ğ‘ĞµĞ· Ñ„Ğ¸Ğ»ÑŒÑ‚Ñ€Ğ° â€” Ğ¿Ğ¾ĞºĞ°Ğ·Ğ°Ğ½Ñ‹ Ğ²ÑĞµ Ğ·Ğ°Ğ¿Ğ¸ÑĞ¸ ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ².",
    editWastePackagingRecord: "Ğ ĞµĞ´Ğ°ĞºÑ‚Ğ¸Ñ€Ğ¾Ğ²Ğ°Ñ‚ÑŒ Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    newWastePackagingRecord: "ĞĞ¾Ğ²Ğ°Ñ Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ ÑƒĞ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ñ… Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ğ¾Ğ²",
    wastePackagingChartLabel: "Ğ£Ğ¿Ğ°ĞºĞ¾Ğ²Ğ¾Ñ‡Ğ½Ñ‹Ğµ Ğ¾Ñ‚Ñ…Ğ¾Ğ´Ñ‹",
    chartDetailEmpty: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ Ğ·Ğ° ÑÑ‚Ğ¾Ñ‚ Ğ¿ĞµÑ€Ğ¸Ğ¾Ğ´ Ğ½Ğµ Ğ½Ğ°Ğ¹Ğ´ĞµĞ½Ñ‹.",
    chartClose: "Ğ—Ğ°ĞºÑ€Ñ‹Ñ‚ÑŒ",
    chartColProduction: "ĞŸÑ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ¾",
    chartColPasses: "ĞŸÑ€Ğ¾Ñ…Ğ¾Ğ´Ñ‹",
    chartColWaste: "ĞÑ‚Ñ…Ğ¾Ğ´Ñ‹",
    chartColStudent: "Ğ¡Ñ‚ÑƒĞ´ĞµĞ½Ñ‚Ñ‹",
    chartColFoodType: "Ğ’Ğ¸Ğ´ Ğ±Ğ»ÑĞ´Ğ°",
    chartProductionVsTurnstile: "Ğ Ğ°Ğ·Ğ½Ğ¸Ñ†Ğ° Ğ¼ĞµĞ¶Ğ´Ñƒ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ¾Ğ¼ Ğ¸ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ°Ğ¼Ğ¸ Ñ‡ĞµÑ€ĞµĞ· Ñ‚ÑƒÑ€Ğ½Ğ¸ĞºĞµÑ‚",
    chartStaffTotal: "ĞĞºĞ°Ğ´ĞµĞ¼Ğ¸Ñ‡ĞµÑĞºĞ¸Ğ¹ + Ğ°Ğ´Ğ¼Ğ¸Ğ½Ğ¸ÑÑ‚Ñ€Ğ°Ñ‚Ğ¸Ğ²Ğ½Ñ‹Ğ¹ + Ğ¡ĞšĞ¡ Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ»",
    yearFilterLabel: "Ğ“Ğ¾Ğ´:",
    monthFilterLabel: "ĞœĞµÑÑÑ†:",
    chartSelectYear: "Ğ’Ñ‹Ğ±Ñ€Ğ°Ñ‚ÑŒ",
    year1Label: "1. Ğ“Ğ¾Ğ´:",
    year2Label: "2. Ğ“Ğ¾Ğ´:",
    noComparison: "Ğ‘ĞµĞ· ÑÑ€Ğ°Ğ²Ğ½ĞµĞ½Ğ¸Ñ",
    newLabel: "ĞĞ¾Ğ²Ñ‹Ğ¹",
    foodTypeLabel: "Ğ’Ğ¸Ğ´ Ğ±Ğ»ÑĞ´Ğ°",
    productionLabel: " ĞŸÑ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ¾",
    wasteKgLabel: " ĞÑ‚Ñ…Ğ¾Ğ´Ñ‹ (ĞºĞ³)",
    wasteGrPortionLabel: " ĞÑ‚Ñ…Ğ¾Ğ´Ñ‹ (Ğ³/Ğ¿Ğ¾Ñ€Ñ†Ğ¸Ñ)",
    diffKgLabel: "Ğ Ğ°Ğ·Ğ½Ğ¸Ñ†Ğ° (ĞºĞ³)",
    totalRow: "Ğ˜Ğ¢ĞĞ“Ğ",
    registeredRate: "Ğ¡Ğ¾Ñ…Ñ€Ğ°Ğ½Ñ‘Ğ½Ğ½Ğ°Ñ ÑÑ‚Ğ°Ğ²ĞºĞ°: ",
    unsavedChanges: " (Ğ½Ğµ ÑĞ¾Ñ…Ñ€Ğ°Ğ½Ñ‘Ğ½Ğ½Ñ‹Ğµ Ğ¸Ğ·Ğ¼ĞµĞ½ĞµĞ½Ğ¸Ñ)",
    kpiTotalStudentSpending: "ĞĞ±Ñ‰Ğ¸Ğµ Ñ€Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ²",
    kpiTotalStaffSpending: "ĞĞ±Ñ‰Ğ¸Ğµ Ñ€Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ»Ğ°",
    kpiAvgMonthlyStudentSpending: "Ğ¡Ñ€Ğ´. Ğ¼ĞµÑÑÑ‡Ğ½Ñ‹Ğµ Ñ€Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ²",
    kpiAvgMonthlyStaffSpending: "Ğ¡Ñ€Ğ´. Ğ¼ĞµÑÑÑ‡Ğ½Ñ‹Ğµ Ñ€Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ»Ğ°",
    kpiTotalStudents: "Ğ’ÑĞµĞ³Ğ¾ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ²",
    kpiTotalStaff: "Ğ’ÑĞµĞ³Ğ¾ Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ»Ğ°",
    kpiHighestStudentMonth: "ĞœĞ°ĞºÑ. Ñ€Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ²",
    kpiHighestStaffMonth: "ĞœĞ°ĞºÑ. Ñ€Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ»Ğ°",
    kpiTotalMealSpending: "ĞĞ±Ñ‰Ğ¸Ğµ Ñ€Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° Ğ¿Ğ¸Ñ‚Ğ°Ğ½Ğ¸Ğµ",
    kpiAvgMonthlyMealSpending: "Ğ¡Ñ€Ğ´. Ğ¼ĞµÑÑÑ‡Ğ½Ñ‹Ğµ Ñ€Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° Ğ¿Ğ¸Ñ‚Ğ°Ğ½Ğ¸Ğµ",
    kpiTotalMealsProduced: "Ğ’ÑĞµĞ³Ğ¾ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²ĞµĞ´ĞµĞ½Ğ¾ Ğ±Ğ»ÑĞ´",
    kpiHighestMealMonth: "ĞœĞ°ĞºÑ. Ñ€Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° Ğ¿Ğ¸Ñ‚Ğ°Ğ½Ğ¸Ğµ",
    chartStudentSpending: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ² (â‚º)",
    chartStaffSpending: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ»Ğ° (â‚º)",
    chartMealSpending: "Ğ Ğ°ÑÑ…Ğ¾Ğ´Ñ‹ Ğ½Ğ° Ğ¿Ğ¸Ñ‚Ğ°Ğ½Ğ¸Ğµ (â‚º)",
    noRecordsYet: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ Ğ¿Ğ¾ĞºĞ° Ğ¾Ñ‚ÑÑƒÑ‚ÑÑ‚Ğ²ÑƒÑÑ‚.",
    invalidRate: "Ğ’Ğ²ĞµĞ´Ğ¸Ñ‚Ğµ Ğ´ĞµĞ¹ÑÑ‚Ğ²Ğ¸Ñ‚ĞµĞ»ÑŒĞ½ÑƒÑ ÑÑ‚Ğ°Ğ²ĞºÑƒ!",
    rateSaved: "Ğ¡Ñ‚Ğ°Ğ²ĞºĞ° ÑĞ¾Ñ…Ñ€Ğ°Ğ½ĞµĞ½Ğ°: ",
    menuStatusDraft: "Ğ§ĞµÑ€Ğ½Ğ¾Ğ²Ğ¸Ğº",
    menuStatusPending: "ĞĞ¶Ğ¸Ğ´Ğ°ĞµÑ‚ ÑƒÑ‚Ğ²ĞµÑ€Ğ¶Ğ´ĞµĞ½Ğ¸Ñ",
    menuStatusApproved: "Ğ£Ñ‚Ğ²ĞµÑ€Ğ¶Ğ´ĞµĞ½Ğ¾",
    menuStatusRejected: "ĞÑ‚ĞºĞ»Ğ¾Ğ½ĞµĞ½Ğ¾",
    menuApprove: "Ğ£Ñ‚Ğ²ĞµÑ€Ğ´Ğ¸Ñ‚ÑŒ Ğ¼ĞµĞ½Ñ",
    menuApproveDisabled: "ĞœĞµĞ½Ñ ĞµÑ‰Ñ‘ Ğ½Ğµ Ğ¾Ñ‚Ğ¿Ñ€Ğ°Ğ²Ğ»ĞµĞ½Ğ¾ Ğ½Ğ° ÑƒÑ‚Ğ²ĞµÑ€Ğ¶Ğ´ĞµĞ½Ğ¸Ğµ. ĞšĞ¾Ğ³Ğ´Ğ° Ğ´Ğ¸ĞµÑ‚Ğ¾Ğ»Ğ¾Ğ³ Ğ½Ğ°Ğ¶Ğ¼Ñ‘Ñ‚ Â«ĞÑ‚Ğ¿Ñ€Ğ°Ğ²Ğ¸Ñ‚ÑŒ Ğ½Ğ° ÑƒÑ‚Ğ²ĞµÑ€Ğ¶Ğ´ĞµĞ½Ğ¸ĞµÂ», Ğ²Ñ‹ ÑĞ¼Ğ¾Ğ¶ĞµÑ‚Ğµ ÑƒÑ‚Ğ²ĞµÑ€Ğ´Ğ¸Ñ‚ÑŒ Ğ¾Ñ‚ÑÑĞ´Ğ°.",
    menuReject: "ĞÑ‚ĞºĞ»Ğ¾Ğ½Ğ¸Ñ‚ÑŒ Ğ¼ĞµĞ½Ñ Ñ Ğ¾Ğ±Ğ¾ÑĞ½Ğ¾Ğ²Ğ°Ğ½Ğ¸ĞµĞ¼",
    menuRejectDisabled: "ĞœĞµĞ½Ñ ĞµÑ‰Ñ‘ Ğ½Ğµ Ğ¾Ñ‚Ğ¿Ñ€Ğ°Ğ²Ğ»ĞµĞ½Ğ¾ Ğ½Ğ° ÑƒÑ‚Ğ²ĞµÑ€Ğ¶Ğ´ĞµĞ½Ğ¸Ğµ. ĞšĞ¾Ğ³Ğ´Ğ° Ğ´Ğ¸ĞµÑ‚Ğ¾Ğ»Ğ¾Ğ³ Ğ½Ğ°Ğ¶Ğ¼Ñ‘Ñ‚ Â«ĞÑ‚Ğ¿Ñ€Ğ°Ğ²Ğ¸Ñ‚ÑŒ Ğ½Ğ° ÑƒÑ‚Ğ²ĞµÑ€Ğ¶Ğ´ĞµĞ½Ğ¸ĞµÂ», Ğ²Ñ‹ ÑĞ¼Ğ¾Ğ¶ĞµÑ‚Ğµ Ğ¾Ñ‚ĞºĞ»Ğ¾Ğ½Ğ¸Ñ‚ÑŒ Ğ¾Ñ‚ÑÑĞ´Ğ°.",
    menuPendingCount: " Ğ¼ĞµĞ½Ñ Ğ¾Ğ¶Ğ¸Ğ´Ğ°ÑÑ‚ ÑƒÑ‚Ğ²ĞµÑ€Ğ¶Ğ´ĞµĞ½Ğ¸Ñ. ĞŸĞµÑ€ĞµĞ¹Ğ´Ğ¸Ñ‚Ğµ Ğº Ğ¾Ğ¶Ğ¸Ğ´Ğ°ÑÑ‰ĞµĞ¹ Ğ½ĞµĞ´ĞµĞ»Ğµ Ğ¸ ÑƒÑ‚Ğ²ĞµÑ€Ğ´Ğ¸Ñ‚Ğµ.",
    menuNotApproved: "ĞœĞµĞ½Ñ Ğ½Ğ° ÑÑ‚Ñƒ Ğ½ĞµĞ´ĞµĞ»Ñ ĞµÑ‰Ñ‘ Ğ½Ğµ ÑƒÑ‚Ğ²ĞµÑ€Ğ¶Ğ´ĞµĞ½Ğ¾ Ğ¸Ğ½Ğ¶ĞµĞ½ĞµÑ€Ğ¾Ğ¼ Ğ¿Ğ¾ Ğ¿Ğ¸Ñ‰ĞµĞ²Ğ¾Ğ¹ Ğ±ĞµĞ·Ğ¾Ğ¿Ğ°ÑĞ½Ğ¾ÑÑ‚Ğ¸.",
    menuRejected: "Ğ­Ñ‚Ğ¾ Ğ¼ĞµĞ½Ñ Ğ¾Ñ‚ĞºĞ»Ğ¾Ğ½ĞµĞ½Ğ¾",
    menuRejectedSuffix: ". Ğ”Ğ¸ĞµÑ‚Ğ¾Ğ»Ğ¾Ğ³ Ğ¼Ğ¾Ğ¶ĞµÑ‚ Ğ¸ÑĞ¿Ñ€Ğ°Ğ²Ğ¸Ñ‚ÑŒ Ğ¸ Ğ¾Ñ‚Ğ¿Ñ€Ğ°Ğ²Ğ¸Ñ‚ÑŒ Ğ¿Ğ¾Ğ²Ñ‚Ğ¾Ñ€Ğ½Ğ¾.",
    menuAwaitingApproval: "Ğ­Ñ‚Ğ¾ Ğ¼ĞµĞ½Ñ Ğ¾Ğ¶Ğ¸Ğ´Ğ°ĞµÑ‚ ÑƒÑ‚Ğ²ĞµÑ€Ğ¶Ğ´ĞµĞ½Ğ¸Ñ. Ğ‘ĞµĞ· ÑƒÑ‚Ğ²ĞµÑ€Ğ¶Ğ´ĞµĞ½Ğ¸Ñ Ğ¾Ğ½Ğ¾ Ğ±ÑƒĞ´ĞµÑ‚ Ğ¿Ğ¾Ğ¼ĞµÑ‡ĞµĞ½Ğ¾ ĞºĞ°Ğº Â«Ğ½ĞµÑƒÑ‚Ğ²ĞµÑ€Ğ¶Ğ´Ñ‘Ğ½Ğ½Ğ¾ĞµÂ» Ğ² ÑĞ¿Ğ¸ÑĞºĞµ Ğ¿Ñ€Ğ¾Ğ¸Ğ·Ğ²Ğ¾Ğ´ÑÑ‚Ğ²Ğ°.",
    noteLabel: "Ğ—Ğ°Ğ¼ĞµÑ‚ĞºĞ° ",
    deleteNote: "Ğ£Ğ´Ğ°Ğ»Ğ¸Ñ‚ÑŒ ÑÑ‚Ñƒ Ğ·Ğ°Ğ¼ĞµÑ‚ĞºÑƒ",
    addNote: "Ğ”Ğ¾Ğ±Ğ°Ğ²Ğ¸Ñ‚ÑŒ Ğ·Ğ°Ğ¼ĞµÑ‚ĞºÑƒ",
    mealPickerTitle: "Ğ’Ñ‹Ğ±Ñ€Ğ°Ñ‚ÑŒ Ğ±Ğ»ÑĞ´Ğ¾",
    clearLabel: "ğŸ—‘ ĞÑ‡Ğ¸ÑÑ‚Ğ¸Ñ‚ÑŒ",
    searchMealPlaceholder: "ĞŸĞ¾Ğ¸ÑĞº Ğ±Ğ»ÑĞ´Ğ°...",
    noMatchingMeal: "ĞŸĞ¾Ğ´Ñ…Ğ¾Ğ´ÑÑ‰ĞµĞµ Ğ±Ğ»ÑĞ´Ğ¾ Ğ½Ğµ Ğ½Ğ°Ğ¹Ğ´ĞµĞ½Ğ¾.",
    varietyLabel: " Ğ’Ğ¸Ğ´: ",
    addRecord: "Ğ”Ğ¾Ğ±Ğ°Ğ²Ğ¸Ñ‚ÑŒ Ğ½Ğ¾Ğ²ÑƒÑ Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ",
    editRecord: "Ğ ĞµĞ´Ğ°ĞºÑ‚Ğ¸Ñ€Ğ¾Ğ²Ğ°Ñ‚ÑŒ Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ",
    btnUpdate: "ĞĞ±Ğ½Ğ¾Ğ²Ğ¸Ñ‚ÑŒ",
    recordAdded: "Ğ—Ğ°Ğ¿Ğ¸ÑÑŒ ÑƒÑĞ¿ĞµÑˆĞ½Ğ¾ Ğ´Ğ¾Ğ±Ğ°Ğ²Ğ»ĞµĞ½Ğ°.",
    recordUpdated: "Ğ—Ğ°Ğ¿Ğ¸ÑÑŒ ÑƒÑĞ¿ĞµÑˆĞ½Ğ¾ Ğ¾Ğ±Ğ½Ğ¾Ğ²Ğ»ĞµĞ½Ğ°.",
    recordDeleted: "Ğ—Ğ°Ğ¿Ğ¸ÑÑŒ ÑƒĞ´Ğ°Ğ»ĞµĞ½Ğ°.",
    allRecordsDeleted: "Ğ’ÑĞµ Ğ·Ğ°Ğ¿Ğ¸ÑĞ¸ ÑƒĞ´Ğ°Ğ»ĞµĞ½Ñ‹.",
    selectedRecordsDeleted: "Ğ’Ñ‹Ğ±Ñ€Ğ°Ğ½Ğ½Ñ‹Ğµ Ğ·Ğ°Ğ¿Ğ¸ÑĞ¸ ÑƒĞ´Ğ°Ğ»ĞµĞ½Ñ‹.",
    noRecordToDelete: "ĞĞµÑ‚ Ğ·Ğ°Ğ¿Ğ¸ÑĞµĞ¹ Ğ´Ğ»Ñ ÑƒĞ´Ğ°Ğ»ĞµĞ½Ğ¸Ñ.",
    noSelectedRecord: "Ğ—Ğ°Ğ¿Ğ¸ÑĞ¸ Ğ½Ğµ Ğ²Ñ‹Ğ±Ñ€Ğ°Ğ½Ñ‹.",
    deleteAllConfirm: "Ğ’Ñ‹ ÑƒĞ²ĞµÑ€ĞµĞ½Ñ‹, Ñ‡Ñ‚Ğ¾ Ñ…Ğ¾Ñ‚Ğ¸Ñ‚Ğµ ÑƒĞ´Ğ°Ğ»Ğ¸Ñ‚ÑŒ Ğ’Ğ¡Ğ• Ğ·Ğ°Ğ¿Ğ¸ÑĞ¸?\nĞ­Ñ‚Ğ¾ Ğ´ĞµĞ¹ÑÑ‚Ğ²Ğ¸Ğµ Ğ½ĞµĞ»ÑŒĞ·Ñ Ğ¾Ñ‚Ğ¼ĞµĞ½Ğ¸Ñ‚ÑŒ!",
    deleteFoodConfirm: "Ğ’Ñ‹ ÑƒĞ²ĞµÑ€ĞµĞ½Ñ‹, Ñ‡Ñ‚Ğ¾ Ñ…Ğ¾Ñ‚Ğ¸Ñ‚Ğµ ÑƒĞ´Ğ°Ğ»Ğ¸Ñ‚ÑŒ ÑÑ‚Ğ¾ Ğ±Ğ»ÑĞ´Ğ¾?",
    selected: " Ğ²Ñ‹Ğ±Ñ€Ğ°Ğ½Ğ¾",
    negMeals: "ĞšĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¿Ñ€Ğ¸Ğ³Ğ¾Ñ‚Ğ¾Ğ²Ğ»ĞµĞ½Ğ½Ñ‹Ñ… Ğ±Ğ»ÑĞ´ Ğ½Ğµ Ğ¼Ğ¾Ğ¶ĞµÑ‚ Ğ±Ñ‹Ñ‚ÑŒ Ğ¾Ñ‚Ñ€Ğ¸Ñ†Ğ°Ñ‚ĞµĞ»ÑŒĞ½Ñ‹Ğ¼.",
    negTurnstile: "ĞšĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¿Ñ€Ğ¾Ñ…Ğ¾Ğ´Ğ¾Ğ² Ğ½Ğµ Ğ¼Ğ¾Ğ¶ĞµÑ‚ Ğ±Ñ‹Ñ‚ÑŒ Ğ¾Ñ‚Ñ€Ğ¸Ñ†Ğ°Ñ‚ĞµĞ»ÑŒĞ½Ñ‹Ğ¼.",
    negStaff: "ĞšĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¿ĞµÑ€ÑĞ¾Ğ½Ğ°Ğ»Ğ° Ğ½Ğµ Ğ¼Ğ¾Ğ¶ĞµÑ‚ Ğ±Ñ‹Ñ‚ÑŒ Ğ¾Ñ‚Ñ€Ğ¸Ñ†Ğ°Ñ‚ĞµĞ»ÑŒĞ½Ñ‹Ğ¼.",
    negPortion: "ĞšĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ Ğ¿Ğ¾Ñ€Ñ†Ğ¸Ğ¹ Ğ½Ğµ Ğ¼Ğ¾Ğ¶ĞµÑ‚ Ğ±Ñ‹Ñ‚ÑŒ Ğ¾Ñ‚Ñ€Ğ¸Ñ†Ğ°Ñ‚ĞµĞ»ÑŒĞ½Ñ‹Ğ¼.",
    negStudent: "ĞšĞ¾Ğ»Ğ¸Ñ‡ĞµÑÑ‚Ğ²Ğ¾ ÑÑ‚ÑƒĞ´ĞµĞ½Ñ‚Ğ¾Ğ² Ğ½Ğµ Ğ¼Ğ¾Ğ¶ĞµÑ‚ Ğ±Ñ‹Ñ‚ÑŒ Ğ¾Ñ‚Ñ€Ğ¸Ñ†Ğ°Ñ‚ĞµĞ»ÑŒĞ½Ñ‹Ğ¼.",
    unsavedConfirm: "Ğ•ÑÑ‚ÑŒ Ğ½ĞµÑĞ¾Ñ…Ñ€Ğ°Ğ½Ñ‘Ğ½Ğ½Ñ‹Ğµ Ğ¸Ğ·Ğ¼ĞµĞ½ĞµĞ½Ğ¸Ñ. Ğ’Ñ‹ ÑƒĞ²ĞµÑ€ĞµĞ½Ñ‹, Ñ‡Ñ‚Ğ¾ Ñ…Ğ¾Ñ‚Ğ¸Ñ‚Ğµ Ğ·Ğ°ĞºÑ€Ñ‹Ñ‚ÑŒ?",
    selectUser: "ĞŸĞ¾Ğ¶Ğ°Ğ»ÑƒĞ¹ÑÑ‚Ğ°, Ğ²Ñ‹Ğ±ĞµÑ€Ğ¸Ñ‚Ğµ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»Ñ.",
    wrongCredentials: "ĞĞµĞ²ĞµÑ€Ğ½Ğ¾Ğµ Ğ¸Ğ¼Ñ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»Ñ Ğ¸Ğ»Ğ¸ Ğ¿Ğ°Ñ€Ğ¾Ğ»ÑŒ.",
    tooManyAttempts: "Ğ¡Ğ»Ğ¸ÑˆĞºĞ¾Ğ¼ Ğ¼Ğ½Ğ¾Ğ³Ğ¾ Ğ¿Ğ¾Ğ¿Ñ‹Ñ‚Ğ¾Ğº. ĞŸĞ¾Ğ¶Ğ°Ğ»ÑƒĞ¹ÑÑ‚Ğ°, Ğ¿Ğ¾Ğ´Ğ¾Ğ¶Ğ´Ğ¸Ñ‚Ğµ.",
    editable: "Ğ ĞµĞ´Ğ°ĞºÑ‚Ğ¸Ñ€ÑƒĞµĞ¼Ğ°Ñ",
    fixed: "Ğ¤Ğ¸ĞºÑĞ¸Ñ€Ğ¾Ğ²Ğ°Ğ½Ğ½Ğ°Ñ",
    menuSentForApproval: "ĞœĞµĞ½Ñ Ğ¾Ñ‚Ğ¿Ñ€Ğ°Ğ²Ğ»ĞµĞ½Ğ¾ Ğ½Ğ° ÑĞ¾Ğ³Ğ»Ğ°ÑĞ¾Ğ²Ğ°Ğ½Ğ¸Ğµ. ĞĞ¶Ğ¸Ğ´Ğ°ĞµÑ‚ÑÑ Ğ¾Ğ´Ğ¾Ğ±Ñ€ĞµĞ½Ğ¸Ğµ Ğ¸Ğ½Ğ¶ĞµĞ½ĞµÑ€Ğ°-Ñ‚ĞµÑ…Ğ½Ğ¾Ğ»Ğ¾Ğ³Ğ°/Ğ°Ğ´Ğ¼Ğ¸Ğ½Ğ¸ÑÑ‚Ñ€Ğ°Ñ‚Ğ¾Ñ€Ğ°.",
    menuApproved: "ĞœĞµĞ½Ñ Ğ¾Ğ´Ğ¾Ğ±Ñ€ĞµĞ½Ğ¾.",
    menuRejectedMsg: "ĞœĞµĞ½Ñ Ğ¾Ñ‚ĞºĞ»Ğ¾Ğ½ĞµĞ½Ğ¾ Ñ Ğ¾Ğ±Ğ¾ÑĞ½Ğ¾Ğ²Ğ°Ğ½Ğ¸ĞµĞ¼.",
    menuDraftSaved: "ĞœĞµĞ½Ñ ÑĞ¾Ñ…Ñ€Ğ°Ğ½ĞµĞ½Ğ¾ ĞºĞ°Ğº Ñ‡ĞµÑ€Ğ½Ğ¾Ğ²Ğ¸Ğº.",
    menuCleared: "ĞœĞµĞ½Ñ Ğ¾Ñ‡Ğ¸Ñ‰ĞµĞ½Ğ¾.",
    monthShort1: "Ğ¯Ğ½Ğ²",
    monthShort2: "Ğ¤ĞµĞ²",
    monthShort3: "ĞœĞ°Ñ€",
    monthShort4: "ĞĞ¿Ñ€",
    monthShort5: "ĞœĞ°Ğ¹",
    monthShort6: "Ğ˜ÑĞ½",
    monthShort7: "Ğ˜ÑĞ»",
    monthShort8: "ĞĞ²Ğ³",
    monthShort9: "Ğ¡ĞµĞ½",
    monthShort10: "ĞĞºÑ‚",
    monthShort11: "ĞĞ¾Ñ",
    monthShort12: "Ğ”ĞµĞº"
  },
  ar: {
    loginSub: "Ù†Ø¸Ø§Ù… Ø¥Ø¯Ø§Ø±Ø© Ø®Ø¯Ù…Ø§Øª Ø§Ù„ØªØºØ°ÙŠØ©",
    loginFormSub: "ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„",
    loginUsername: "Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…",
    loginSelectUser: "Ø§Ø®ØªØ± Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…",
    loginPassword: "ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ±",
    loginBtn: "ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„",
    loginHint: "ÙŠÙ…ÙƒÙ†Ùƒ Ø§Ù„Ø­ØµÙˆÙ„ Ø¹Ù„Ù‰ ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± Ù…Ù† Ø§Ù„Ù…Ø³Ø¤ÙˆÙ„",
    loginFeature1: "ØªØ®Ø·ÙŠØ· Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© ÙˆØ§Ù„Ø¥Ù†ØªØ§Ø¬ Ø§Ù„ÙŠÙˆÙ…ÙŠ ÙˆØ§Ù„Ø§Ø³ØªÙ‡Ù„Ø§Ùƒ ÙˆØ§Ù„Ù†ÙØ§ÙŠØ§Øª",
    loginFeature2: "ØªÙ‚Ø§Ø±ÙŠØ± Ù…ÙØµÙ„Ø©",
    loginFeature3: "Ù„ÙˆØ­Ø© Ù…Ø¨Ø§Ø´Ø±Ø© ÙˆØ±Ø³ÙˆÙ… Ø¨ÙŠØ§Ù†ÙŠØ©",
    menuLabel: "Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©",
    headerSubtitle: "Ù†Ø¸Ø§Ù… Ø¥Ø¯Ø§Ø±Ø© Ø®Ø¯Ù…Ø§Øª Ø§Ù„ØªØºØ°ÙŠØ©",
    btnLogout: "ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø®Ø±ÙˆØ¬",
    btnPrev: "Ø§Ù„Ø³Ø§Ø¨Ù‚",
    btnNext: "Ø§Ù„ØªØ§Ù„ÙŠ",
    loading: "Ø¬Ø§Ø±Ù Ø§Ù„ØªØ­Ù…ÙŠÙ„...",
    loadingText: "Ù…Ø²Ø§Ù…Ù†Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª...",
    loadingSub: "Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† Ø§ØªØµØ§Ù„ Supabase",
    loadingSkip: "Ø§Ù†Ù‚Ø± Ù„Ù„ØªØ®Ø·ÙŠ",
    versionLabel: "Ø¥ØµØ¯Ø§Ø± Ø§Ù„ØªØ·Ø¨ÙŠÙ‚",
    sidebarPanel: "Ù„ÙˆØ­Ø© Ø§Ù„ØªØ­ÙƒÙ…",
    sidebarMenu: "Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠØ©",
    sidebarRecords: "Ø§Ù„Ø³Ø¬Ù„Ø§Øª",
    sidebarReport: "Ø§Ù„ØªÙ‚Ø±ÙŠØ±",
    sidebarHaccp: "Ø³Ù„Ø§Ù…Ø© Ø§Ù„ØºØ°Ø§Ø¡",
    sidebarCalibration: "Ø§Ù„Ù…Ø¹Ø§ÙŠØ±Ø©",
    sidebarOil: "Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø²ÙŠØªÙŠØ©",
    sidebarPackaging: "Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØºÙ„ÙŠÙ",
    sidebarCharts: "Ø§Ù„Ø±Ø³ÙˆÙ… Ø§Ù„Ø¨ÙŠØ§Ù†ÙŠØ©",
    sidebarYearly: "Ø§Ù„Ù…Ù‚Ø§Ø±Ù†Ø© Ø§Ù„Ø³Ù†ÙˆÙŠØ©",
    sidebarSpending: "Ø§Ù„Ù…ØµØ±ÙˆÙØ§Øª",
    sidebarUnitPrice: "Ø§Ù„Ø£Ø³Ø¹Ø§Ø±ÙˆØ­Ø¯Ø©",
    sidebarDownload: "ØªÙ†Ø²ÙŠÙ„ Ø§Ù„ÙƒÙ„",
    sidebarBackup: "Ø§Ù„Ù†Ø³Ø® Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠ Ø¥Ù„Ù‰ Supabase",
    sidebarRestore: "Ø§Ù„Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ù…Ù† Supabase",
    sidebarAdmin: "Ø§Ù„Ø¥Ø¯Ø§Ø±Ø©",
    sidebarLogs: "Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ù†Ø´Ø§Ø·",
    sidebarTheme: "Ø§Ù„Ù…Ø¸Ù‡Ø±",
    sidebarManual: "Ø¯Ù„ÙŠÙ„ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…",
    dashboardPrintPdf: "Ø·Ø¨Ø§Ø¹Ø© PDF",
    kpiTotalRecords: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø£ÙŠØ§Ù… Ø§Ù„Ø¥Ù†ØªØ§Ø¬",
    kpiTodayProduction: "Ø¥Ù†ØªØ§Ø¬ Ø§Ù„ÙŠÙˆÙ…",
    kpiHaccpAlarm: "ØªÙ†Ø¨ÙŠÙ‡ Ø¯Ø±Ø¬Ø© Ø­Ø±Ø§Ø±Ø© Ø§Ù„ØªØ®Ø²ÙŠÙ† Ø§Ù„Ø¨Ø§Ø±Ø¯",
    kpiCalibrationAlarm: "ØªÙ†Ø¨ÙŠÙ‡ Ø§Ù„Ù…Ø¹Ø§ÙŠØ±Ø©",
    kpiAvgWaste: "Ù…ØªÙˆØ³Ø· Ø§Ù„Ù†ÙØ§ÙŠØ§Øª (ÙƒØº)",
    kpiTotalPasses: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø¹Ø¨ÙˆØ± Ø§Ù„Ø¨ÙˆØ§Ø¨Ø© Ø§Ù„Ø¯ÙˆÙ‘Ø§Ø±Ø©",
    kpiTotalWaste: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ù†ÙØ§ÙŠØ§Øª (ÙƒØº)",
    kpiWasteRate: "Ù†Ø³Ø¨Ø© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª",
    weeklyPrevBtn: "Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ Ø§Ù„Ø³Ø§Ø¨Ù‚",
    weeklySummary: "Ù…Ù„Ø®Øµ Ø£Ø³Ø¨ÙˆØ¹ÙŠ",
    weeklyNextBtn: "Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ Ø§Ù„ØªØ§Ù„ÙŠ",
    weeklyBadge: "Ù‡Ø°Ø§ Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹",
    dailyPrevBtn: "Ø§Ù„ÙŠÙˆÙ… Ø§Ù„Ø³Ø§Ø¨Ù‚",
    dailySummary: "ØªÙØ§ØµÙŠÙ„ ÙŠÙˆÙ…ÙŠØ©",
    dailyNextBtn: "Ø§Ù„ÙŠÙˆÙ… Ø§Ù„ØªØ§Ù„ÙŠ",
    weeklyCompTitle: "Ù…Ù‚Ø§Ø±Ù†Ø© Ø£Ø³Ø¨ÙˆØ¹ÙŠØ©",
    monthlyCompTitle: "Ù…Ù‚Ø§Ø±Ù†Ø© Ø´Ù‡Ø±ÙŠØ©",
    monthlyBadge: "Ù‡Ø°Ø§ Ø§Ù„Ø´Ù‡Ø±",
    yearlyBadge: "Ù‡Ø°Ø§ Ø§Ù„Ø¹Ø§Ù…",
    anomalyTitle: "Ø§ÙƒØªØ´Ø§Ù Ø§Ù„Ø´Ø°ÙˆØ°",
    anomalyBadge: "Ø£ÙŠØ§Ù… Ø§Ù„Ù†ÙØ§ÙŠØ§Øª ØºÙŠØ± Ø§Ù„Ø·Ø¨ÙŠØ¹ÙŠØ©",
    lastRecordsTitle: "Ø¢Ø®Ø± Ø§Ù„Ø³Ø¬Ù„Ø§Øª",
    dashboardGoToRecords: "Ø§Ù„Ø°Ù‡Ø§Ø¨ Ø¥Ù„Ù‰ Ø§Ù„Ø³Ø¬Ù„Ø§Øª",
    emptyDashboard: "Ù„Ø§ ØªÙˆØ¬Ø¯ Ø³Ø¬Ù„Ø§Øª Ø¨Ø¹Ø¯...",
    formulaTitle: "ØµÙŠØºØ© Ø­Ø³Ø§Ø¨ Ø§Ù„Ù†ÙØ§ÙŠØ§Øª",
    recordsEntryBtn: "Ø¥Ø¯Ø®Ø§Ù„ Ø§Ù„Ø¥Ù†ØªØ§Ø¬ ÙˆØ§Ù„Ø§Ø³ØªÙ‡Ù„Ø§Ùƒ",
    recordsImportBtn: "Ø§Ø³ØªÙŠØ±Ø§Ø¯",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "ØªÙ†Ø²ÙŠÙ„ CSV",
    recordsDeleteBtn: "Ø­Ø°Ù Ø§Ù„Ù…Ø­Ø¯Ø¯",
    emptyRecords: "Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø³Ø¬Ù„Ø§Øª.",
    thDate: "Ø§Ù„ØªØ§Ø±ÙŠØ®",
    thProducedPerson: "Ø§Ù„ÙˆØ¬Ø¨Ø§Øª Ø§Ù„Ù…ÙÙ†ØªØ¬Ø© (Ø´Ø®Øµ)",
    thWaste10: "Ù†ÙØ§ÙŠØ§Øª 10%",
    thBeneficiary: "Ø§Ù„Ù…Ø³ØªÙÙŠØ¯ÙˆÙ† Ù…Ù† Ø®Ø¯Ù…Ø© Ø§Ù„Ø·Ø¹Ø§Ù…",
    thPortionGr: "Ø§Ù„Ø­ØµØ© (Øº)",
    thWasteKg: "Ø§Ù„Ù†ÙØ§ÙŠØ§Øª (ÙƒØº)",
    thWastedPortion: "Ø§Ù„Ù…ÙÙ‡Ù…Ù„Ø© (Ø­ØµØ©)",
    thFoodType: "Ù†ÙˆØ¹ Ø§Ù„Ø·Ø¹Ø§Ù…",
    thAction: "Ø§Ù„Ø¥Ø¬Ø±Ø§Ø¡",
    thAcademicStaff: "Ø§Ù„ÙƒØ§Ø¯ÙŠÙ…ÙŠÙˆÙ† ÙˆØ§Ù„Ø¥Ø¯Ø§Ø±ÙŠÙˆÙ† Ø¹Ø¨Ø± Ø§Ù„Ø¨ÙˆØ§Ø¨Ø© Ø§Ù„Ø¯ÙˆÙ‘Ø§Ø±Ø©",
    thStudentCount: "Ø§Ù„Ø·Ù„Ø§Ø¨ Ø¹Ø¨Ø± Ø§Ù„Ø¨ÙˆØ§Ø¨Ø© Ø§Ù„Ø¯ÙˆÙ‘Ø§Ø±Ø©",
    thBeneficiaryTotal: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ù…Ø³ØªÙÙŠØ¯ÙŠ Ø®Ø¯Ù…Ø© Ø§Ù„Ø·Ø¹Ø§Ù…",
    sksStaff: "Ù…ÙˆØ¸ÙÙˆ Ø®Ø¯Ù…Ø© Ø§Ù„Ø·Ø¹Ø§Ù… (SKS)",
    summaryReport: "ØªÙ‚Ø±ÙŠØ± Ù…Ù„Ø®Øµ",
    reportPdfBtn: "ÙØªØ­ PDF",
    allRecordsPrint: "Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø³Ø¬Ù„Ø§Øª (Ø¹Ø±Ø¶ Ø§Ù„Ø·Ø¨Ø§Ø¹Ø©)",
    rTotalRecords: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø¹Ø¯Ø¯ Ø§Ù„Ø³Ø¬Ù„Ø§Øª",
    rTotalMeals: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„ÙˆØ¬Ø¨Ø§Øª Ø§Ù„Ù…ÙÙ†ØªØ¬Ø©",
    rTotalWaste10: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ù†ÙØ§ÙŠØ§Øª 10%",
    rTotalAfterWaste: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„ÙˆØ¬Ø¨Ø§Øª Ø¨Ø¹Ø¯ Ù†ÙØ§ÙŠØ§Øª 10%",
    rTotalTurnstile: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø¹Ø¨ÙˆØ± Ø§Ù„Ø¨ÙˆØ§Ø¨Ø© Ø§Ù„Ø¯ÙˆÙ‘Ø§Ø±Ø©",
    rTotalBeneficiary: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ù…Ø³ØªÙÙŠØ¯ÙŠ Ø®Ø¯Ù…Ø© Ø§Ù„Ø·Ø¹Ø§Ù…",
    rTotalStaff: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ù…ÙˆØ¸ÙÙŠ SKS Ø§Ù„Ù…Ø³ØªÙÙŠØ¯ÙˆÙ†",
    rPortionSize: "Ø­Ø¬Ù… Ø§Ù„Ø­ØµØ© (Øº)",
    rTotalPortion: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø­ØµØµ (Øº)",
    rWastedPortion: "Ø§Ù„Ø­ØµØµ Ø§Ù„Ù…ÙÙ‡Ù…Ù„Ø©",
    rMaxWeeklyBeneficiary: "Ø£Ù‚ØµÙ‰ Ø¹Ø¯Ø¯ Ù…Ø³ØªÙÙŠØ¯ÙŠÙ† Ø£Ø³Ø¨ÙˆØ¹ÙŠØ§Ù‹",
    rTotalWasteKg: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ ÙƒÙ…ÙŠØ© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª (ÙƒØº)",
    rAvgWasteKg: "Ù…ØªÙˆØ³Ø· ÙƒÙ…ÙŠØ© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª (ÙƒØº)",
    rTotalStudents: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø¹Ø¯Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨",
    rMaxWaste: "Ø£Ù‚ØµÙ‰ Ù†ÙØ§ÙŠØ§Øª (ÙƒØº)",
    rMinWaste: "Ø£Ø¯Ù†Ù‰ Ù†ÙØ§ÙŠØ§Øª (ÙƒØº)",
    rWasteTrend: "Ø§ØªØ¬Ø§Ù‡ Ø§Ù„Ù†ÙØ§ÙŠØ§Øª (Ø¢Ø®Ø± 7 Ø£ÙŠØ§Ù…)",
    rBeneficiaryTrend: "Ø§ØªØ¬Ø§Ù‡ Ø§Ù„Ù…Ø³ØªÙÙŠØ¯ÙŠÙ† (Ø¢Ø®Ø± 7 Ø£ÙŠØ§Ù…)",
    wasteByFoodTitle: "ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø­Ø³Ø¨ Ù†ÙˆØ¹ Ø§Ù„Ø·Ø¹Ø§Ù…",
    wasteByFoodEmpty: "Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø³Ø¬Ù„Ø§Øª ØªØ­ØªÙˆÙŠ Ø¹Ù„Ù‰ Ø¨ÙŠØ§Ù†Ø§Øª Ù†ÙˆØ¹ Ø§Ù„Ø·Ø¹Ø§Ù….",
    wasteByFoodRecords: "Ø¹Ø¯Ø¯ Ø§Ù„Ø³Ø¬Ù„Ø§Øª",
    wasteByFoodRate: "Ù†Ø³Ø¨Ø© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª",
    wasteByFoodPerPerson: "Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ù„Ù„Ø´Ø®Øµ (ÙƒØº)",
    wsProducedMeal: "Ø§Ù„ÙˆØ¬Ø¨Ø§Øª Ø§Ù„Ù…Ù†ØªØ¬Ø© (ÙØ±Ø¯)",
    wsTotalPasses: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø¹Ø¨ÙˆØ±",
    wsTurnstile: "Ø§Ù„Ø¨ÙˆØ§Ø¨Ø© Ø§Ù„Ø¯ÙˆÙ‘Ø§Ø±Ø©",
    wsStaffSKS: "Ù…ÙˆØ¸ÙÙˆ Ø§Ù„ØªØºØ°ÙŠØ©",
    wsWasteAmount: "ÙƒÙ…ÙŠØ© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª",
    wsWastedPortion: "Ø§Ù„Ù†ÙØ§ÙŠØ§Øª",
    wsStudents: "Ø·Ù„Ø§Ø¨ Ø§Ù„ØªØºØ°ÙŠØ©",
    wsNoRecordsYet: "Ù„Ø§ ØªÙˆØ¬Ø¯ Ø³Ø¬Ù„Ø§Øª Ø¨Ø¹Ø¯",
    wsNoRecordThisWeek: "Ù„Ø§ Ø³Ø¬Ù„Ø§Øª Ù‡Ø°Ø§ Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹",
    wsNoRecordToday: "Ù„Ø§ Ø³Ø¬Ù„",
    wsTodayDetail: "ØªÙØ§ØµÙŠÙ„ Ø§Ù„ÙŠÙˆÙ…",
    wsDailyDetail: "Ø§Ù„ØªÙØ§ØµÙŠÙ„ Ø§Ù„ÙŠÙˆÙ…ÙŠØ©",
    wsWaste: "Ù‡Ø¯Ø±",
    wsPortion: "ÙˆØ¬Ø¨Ø©",
    wsProduced: "Ø¥Ù†ØªØ§Ø¬",
    wsTurnstileCount: "Ø¹Ø¨ÙˆØ± Ø§Ù„Ø¨ÙˆØ§Ø¨Ø©",
    wsStaffCount: "Ø§Ù„Ù…ÙˆØ¸ÙÙˆÙ†",
    menuTitle: "Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø·Ø¹Ø§Ù… Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠØ©",
    menuStatusBadge: "Ø§Ù„Ø­Ø§Ù„Ø©",
    menuSaveBtn: "Ø­ÙØ¸",
    menuSendBtn: "Ø¥Ø±Ø³Ø§Ù„ Ù„Ù„Ù…ÙˆØ§ÙÙ‚Ø©",
    menuApproveBtn: "Ù…ÙˆØ§ÙÙ‚Ø©",
    menuRejectBtn: "Ø±ÙØ¶",
    menuWithdrawBtn: "Ø³Ø­Ø¨ Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©",
    menuClearBtn: "Ù…Ø³Ø­ Ø§Ù„Ø¬Ø¯ÙˆÙ„",
    menuPrintBtn: "Ø·Ø¨Ø§Ø¹Ø©",
    menuFoodListBtn: "Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø·Ø¹Ø§Ù…",
    menuFoodListUploadBtn: "ØªØ­Ù…ÙŠÙ„ CSV",
    menuFoodListCsvBtn: "ØªÙ†Ø²ÙŠÙ„ CSV",
    menuWarningPrefix: "Ù‚Ø§Ø¦Ù…Ø© ØºÙŠØ± Ù…Ø¹ØªÙ…Ø¯Ø©:",
    menuWarningText: "Ù„Ù… ØªØªÙ… Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø¹Ù„Ù‰ Ù‚Ø§Ø¦Ù…Ø© Ù‡Ø°Ø§ Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ Ù…Ù† Ù‚ÙØ¨ÙÙ„ Ù…Ù‡Ù†Ø¯Ø³ Ø§Ù„Ø£ØºØ°ÙŠØ© Ø¨Ø¹Ø¯.",
    menuHintText: "Ø§ÙƒØªØ¨ Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„ÙˆØ¬Ø¨Ø§Øª...",
    productNeedsTitle: "Ù‚Ø§Ø¦Ù…Ø© Ø§Ø­ØªÙŠØ§Ø¬Ø§Øª Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª",
    weeklyNeedsTitle: "Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠØ© Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠØ© Ù„Ù„Ø§Ø­ØªÙŠØ§Ø¬Ø§Øª",
    foodListTitle: "Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø·Ø¹Ø§Ù…",
    modalRejectMenu: "Ø±ÙØ¶ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©",
    modalRejectDesc: "Ø³Ø¨Ø¨ Ø§Ù„Ø±ÙØ¶ Ù…Ø·Ù„ÙˆØ¨.",
    menuRejectConfirm: "Ø±ÙØ¶",
    haccpTitle: "Ø¥Ø¯Ø§Ø±Ø© Ø³Ù„Ø§Ù…Ø© Ø§Ù„Ø£ØºØ°ÙŠØ©",
    haccpCsvBtn: "ØªÙ†Ø²ÙŠÙ„ CSV",
    haccpColdStorage: "Ø³Ø¬Ù„Ø§Øª Ø¯Ø±Ø¬Ø© Ø­Ø±Ø§Ø±Ø© Ø§Ù„ØªØ®Ø²ÙŠÙ† Ø§Ù„Ø¨Ø§Ø±Ø¯",
    haccpNewBtn: "Ø³Ø¬Ù„ Ø¬Ø¯ÙŠØ¯",
    haccpDepotBtn: "Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª",
    haccpDepoQrNote: "ÙŠÙ…ÙƒÙ†Ùƒ ØªØ¹Ø¯ÙŠÙ„ Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª ÙˆØ¥Ù†Ø´Ø§Ø¡ Ø±Ù…ÙˆØ² QR Ù„ÙƒÙ„ Ù…Ø³ØªÙˆØ¯Ø¹ Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø²Ø± QR.",
    haccpModalTitle: "Ø³Ø¬Ù„ Ø¬Ø¯ÙŠØ¯",
    filterDepot: "ØªØµÙÙŠØ© Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹:",
    filterAll: "Ø§Ù„ÙƒÙ„",
    filterDateRange: "Ù†Ø·Ø§Ù‚ Ø§Ù„ØªØ§Ø±ÙŠØ®:",
    emptyHaccp: "Ù„Ù… ÙŠØªÙ… Ø¥Ø¯Ø®Ø§Ù„ Ø³Ø¬Ù„Ø§Øª Ø¯Ø±Ø¬Ø© Ø§Ù„Ø­Ø±Ø§Ø±Ø© Ø¨Ø¹Ø¯.",
    btnDeleteSelectedHaccp: "Ø­Ø°Ù Ø§Ù„Ù…Ø­Ø¯Ø¯",
    btnPdf: "PDF",
    depoNamesTitle: "Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª",
    oilNewBtn: "Ø³Ø¬Ù„ Ø¬Ø¯ÙŠØ¯",
    oilListBtn: "Ù‚Ø§Ø¦Ù…Ø©",
    oilFilterTitle: "ØªØµÙÙŠØ© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø²ÙŠØªÙŠØ©",
    filterOilType: "Ù†ÙˆØ¹ Ø§Ù„Ø²ÙŠØª:",
    btnReset: "Ø¥Ø¹Ø§Ø¯Ø© ØªØ¹ÙŠÙŠÙ†",
    oilSummaryTitle: "Ù…Ù„Ø®Øµ Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø²ÙŠØªÙŠØ©",
    oilChartTitle: "Ø§Ù„Ø±Ø³ÙˆÙ… Ø§Ù„Ø¨ÙŠØ§Ù†ÙŠØ© Ù„Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø²ÙŠØªÙŠØ©",
    oilChartSubtitle: "ÙƒÙ…ÙŠØ© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø²ÙŠØªÙŠØ© Ø§Ù„Ø´Ù‡Ø±ÙŠØ© (Ù„ØªØ±)",
    oilChartEmpty: "Ø³ØªØ¸Ù‡Ø± Ø§Ù„Ø±ÙˆÙ… Ø§Ù„Ø¨ÙŠØ§Ù†ÙŠØ© Ø¹Ù†Ø¯ Ø¥Ø¯Ø®Ø§Ù„ Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø²ÙŠØªÙŠØ©",
    oilChartNote: "Ø§Ù„Ù…Ø¬Ø§Ù…ÙŠØ¹ Ø§Ù„Ø´Ù‡Ø±ÙŠØ© Ù„Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø²ÙŠØªÙŠØ© Ø­Ø³Ø¨ Ø§Ù„ØªØ§Ø±ÙŠØ® ÙˆÙ†ÙˆØ¹ Ø§Ù„Ø²ÙŠØª ÙˆØ§Ù„Ø³Ù†Ø©",
    oilRecordsTitle: "Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø²ÙŠØªÙŠØ©",
    oilModalTitle: "Ø³Ø¬Ù„ Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø²ÙŠØªÙŠØ©",
    emptyOil: "Ù„Ù… ÙŠØªÙ… Ø¥Ø¯Ø®Ø§Ù„ Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø²ÙŠØªÙŠØ© Ø¨Ø¹Ø¯.",
    ambalajNewBtn: "Ø³Ø¬Ù„ Ø¬Ø¯ÙŠØ¯",
    ambalajListBtn: "Ù‚Ø§Ø¦Ù…Ø©",
    packagingFilterTitle: "ØªØµÙÙŠØ© Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØºÙ„ÙŠÙ",
    filterWasteType: "Ù†ÙˆØ¹ Ø§Ù„Ù†ÙØ§ÙŠØ§Øª:",
    packagingSummaryTitle: "Ù…Ù„Ø®Øµ Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØºÙ„ÙŠÙ",
    packagingChartTitle: "Ø§Ù„Ø±Ø³ÙˆÙ… Ø§Ù„Ø¨ÙŠØ§Ù†ÙŠØ© Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØºÙ„ÙŠÙ",
    packagingChartSubtitle: "ÙƒÙ…ÙŠØ© Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØºÙ„ÙŠÙ Ø§Ù„Ø´Ù‡Ø±ÙŠØ© (ÙƒØº)",
    packagingChartEmpty: "Ø³ØªØ¸Ù‡Ø± Ø§Ù„Ø±Ø³ÙˆÙ… Ø§Ù„Ø¨ÙŠØ§Ù†ÙŠØ© Ø¹Ù†Ø¯ Ø¥Ø¯Ø®Ø§Ù„ Ø³Ø¬Ù„Ø§Øª Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØºÙ„ÙŠÙ",
    packagingChartNote: "Ø§Ù„Ù…Ø¬Ø§Ù…ÙŠØ¹ Ø§Ù„Ø´Ù‡Ø±ÙŠØ© Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØºÙ„ÙŠÙ Ø­Ø³Ø¨ Ø§Ù„ØªØ§Ø±ÙŠØ® ÙˆÙ†ÙˆØ¹ Ø§Ù„Ù†ÙØ§ÙŠØ§Øª ÙˆØ§Ù„Ø³Ù†Ø© (ÙƒØº)",
    packagingRecordsTitle: "Ø³Ø¬Ù„Ø§Øª Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØºÙ„ÙŠÙ",
    packagingModalTitle: "Ø³Ø¬Ù„ Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØºÙ„ÙŠÙ",
    emptyPackaging: "Ù„Ù… ÙŠØªÙ… Ø¥Ø¯Ø®Ø§Ù„ Ø³Ø¬Ù„Ø§Øª Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØºÙ„ÙŠÙ Ø¨Ø¹Ø¯.",
    kalibrasyonNewBtn: "Ø¬Ù‡Ø§Ø² Ø¬Ø¯ÙŠØ¯",
    kalibrasyonListBtn: "Ù‚Ø§Ø¦Ù…Ø©",
    kalibrasyonCsvBtn: "ØªÙ†Ø²ÙŠÙ„ CSV",
    calibrationSummary: "Ù…Ù„Ø®Øµ Ø§Ù„Ù…Ø¹Ø§ÙŠØ±Ø©",
    calibrationDevices: "Ø§Ù„Ø£Ø¬Ù‡Ø²Ø© Ø§Ù„Ø®Ø§Ø¶Ø¹Ø© Ù„Ù„Ù…Ø¹Ø§ÙŠØ±Ø©",
    calibrationModalTitle: "Ø¬Ù‡Ø§Ø² Ù„Ù„Ù…Ø¹Ø§ÙŠØ±Ø©",
    filterStatus: "Ø§Ù„Ø­Ø§Ù„Ø©:",
    filterDepartment: "Ø§Ù„Ù‚Ø³Ù…:",
    btnWordExport: "ØªØµØ¯ÙŠØ± Ø¥Ù„Ù‰ Word",
    btnPrint: "Ø·Ø¨Ø§Ø¹Ø© PDF",
    chartProdWaste: "Ù…Ù‚Ø§Ø±Ù†Ø© Ø§Ù„Ø¥Ù†ØªØ§Ø¬ ÙˆØ§Ù„Ø¹Ø¨ÙˆØ± ÙˆØ§Ù„Ù†ÙØ§ÙŠØ§Øª",
    chartEmpty: "Ø³ØªØ¸Ù‡Ø± Ø§Ù„Ø±Ø³ÙˆÙ… Ø§Ù„Ø¨ÙŠØ§Ù†ÙŠØ© Ø¹Ù†Ø¯ Ø¥Ø¯Ø®Ø§Ù„ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª",
    chartProdWasteNote: "Ù…Ù‚Ø§Ø±Ù†Ø© Ø´Ù‡Ø±ÙŠØ© Ø¨ÙŠÙ† Ø§Ù„Ø¥Ù†ØªØ§Ø¬ ÙˆØ¹Ø¨ÙˆØ± Ø§Ù„Ø¨ÙˆØ§Ø¨Ø© Ø§Ù„Ø¯ÙˆÙ‘Ø§Ø±Ø© ÙˆØ§Ù„Ø­ØµØµ Ø§Ù„Ù…ÙÙ‡Ù…Ù„Ø©",
    chartStudentCount: "Ø¹Ø¯Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨ Ø§Ù„Ù…Ø³ØªÙÙŠØ¯ÙŠÙ† Ù…Ù† Ø®Ø¯Ù…Ø§Øª Ø§Ù„ØªØºØ°ÙŠØ©",
    yearTotal: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„Ø³Ù†ÙˆÙŠ",
    chartStudentNote: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„Ø´Ù‡Ø±ÙŠ Ù„Ø¹Ø¨ÙˆØ± Ø§Ù„Ø·Ù„Ø§Ø¨ Ø§Ù„ÙŠÙˆÙ…ÙŠ",
    chartStaffTotal: "Ø§Ù„ÙƒØ§Ø¯ÙŠÙ…ÙŠÙˆÙ† ÙˆØ§Ù„Ø¥Ø¯Ø§Ø±ÙŠÙˆÙ† + Ù…ÙˆØ¸ÙÙˆ SKS",
    chartStaffNote: "Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„ÙƒØ§Ø¯ÙŠÙ…ÙŠÙŠÙ† ÙˆØ§Ù„Ø¥Ø¯Ø§Ø±ÙŠÙŠÙ† (Ø§Ù„Ø¨ÙˆØ§Ø¨Ø© Ø§Ù„Ø¯ÙˆÙ‘Ø§Ø±Ø© - Ø§Ù„Ø·Ù„Ø§Ø¨) ÙˆÙ…ÙˆØ¸ÙÙŠ Ø®Ø¯Ù…Ø© Ø§Ù„Ø·Ø¹Ø§Ù… SKS",
    chartMonthlyProd: "Ø§Ù„Ø¥Ù†ØªØ§Ø¬ Ø§Ù„Ø´Ù‡Ø±ÙŠ Ù„Ù„ÙˆØ¬Ø¨Ø§Øª",
    chartMonthlyProdNote: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„Ø´Ù‡Ø±ÙŠ Ù„Ø¹Ø¯Ø¯ Ø§Ù„ÙˆØ¬Ø¨Ø§Øª Ø§Ù„Ù…ÙÙ†ØªØ¬Ø© ÙŠÙˆÙ…ÙŠØ§Ù‹",
    chartMonthlyTurnstile: "Ø¹Ø¯Ø¯ Ø¹Ø¨ÙˆØ± Ø§Ù„Ø¨ÙˆØ§Ø¨Ø© Ø§Ù„Ø¯ÙˆÙ‘Ø§Ø±Ø© Ø§Ù„Ø´Ù‡Ø±ÙŠ",
    chartTurnstileNote: "Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„Ø·Ù„Ø§Ø¨ + Ø§Ù„Ù…ÙˆØ¸ÙÙˆÙ† + Ø§Ù„Ø¹Ø§Ø¨Ø±ÙˆÙ† Ù…Ù† Ø§Ù„Ø®Ø§Ø±Ø¬",
    chartMonthlyWaste: "ÙƒÙ…ÙŠØ© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø´Ù‡Ø±ÙŠØ© (ÙƒØº)",
    chartMonthlyWasteNote: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„Ø´Ù‡Ø±ÙŠ Ù„Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ÙŠÙˆÙ…ÙŠØ© (ÙƒØº)",
    chartMonthlyWastePortion: "ÙƒÙ…ÙŠØ© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø´Ù‡Ø±ÙŠØ© (Ø­ØµØµ)",
    chartWastePortionNote: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„Ø´Ù‡Ø±ÙŠ Ù„Ù„Ø­ØµØµ Ø§Ù„Ù…ÙÙ‡Ù…Ù„Ø© ÙŠÙˆÙ…ÙŠØ§Ù‹",
    chartDiff: "Ø§Ù„ÙØ±Ù‚ Ø¨ÙŠÙ† Ø§Ù„Ø¥Ù†ØªØ§Ø¬ ÙˆØ§Ù„Ø¹Ø¨ÙˆØ±",
    chartDiffNote: "Ø§Ù„ÙØ±Ù‚ Ø¨ÙŠÙ† Ø¹Ø¯Ø¯ Ø§Ù„ÙˆØ¬Ø¨Ø§Øª Ø§Ù„Ù…ÙÙ†ØªØ¬Ø© ÙˆØ¹Ø¨ÙˆØ± Ø§Ù„Ø¨ÙˆØ§Ø¨Ø© Ø§Ù„Ø¯ÙˆÙ‘Ø§Ø±Ø©",
    chartWasteRatio: "Ù†Ø³Ø¨Ø© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ù…Ù† Ø§Ù„ÙˆØ¬Ø¨Ø§Øª Ø§Ù„Ù…ÙÙ†ØªØ¬Ø©",
    yearAverage: "Ø§Ù„Ù…ØªÙˆØ³Ø· Ø§Ù„Ø³Ù†ÙˆÙŠ",
    chartWasteRatioNote: "Ù†Ø³Ø¨Ø© Ø§Ù„ÙˆØ¬Ø¨Ø§Øª Ø§Ù„Ù…ÙÙ†ØªØ¬Ø© Ø§Ù„ØªÙŠ ØªØªØ­ÙˆÙ„ Ø¥Ù„Ù‰ Ù†ÙØ§ÙŠØ§Øª",
    chartWastePerPerson: "Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ù„ÙƒÙ„ Ø´Ø®Øµ (ÙƒØº/Ø´Ø®Øµ)",
    chartWastePerPersonNote: "Ù…ØªÙˆØ³Ø· Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ù„ÙƒÙ„ Ø´Ø®Øµ ÙŠØ¯Ø®Ù„ Ø§Ù„Ù…Ø·Ø¹Ù…",
    chartMonthlyTemp: "Ù…ØªÙˆØ³Ø· Ø¯Ø±Ø¬Ø§Øª Ø­Ø±Ø§Ø±Ø© Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª Ø§Ù„Ø´Ù‡Ø±ÙŠØ© (Â°C)",
    chartTempEmpty: "Ø³ØªØ¸Ù‡Ø± Ø§Ù„Ø±Ø³ÙˆÙ… Ø§Ù„Ø¨ÙŠØ§Ù†ÙŠØ© Ø¹Ù†Ø¯ Ø¥Ø¯Ø®Ø§Ù„ Ø³Ø¬Ù„Ø§Øª Ø¯Ø±Ø¬Ø§Øª Ø§Ù„Ø­Ø±Ø§Ø±Ø©",
    chartTempNote: "Ù…ØªÙˆØ³Ø· Ø¯Ø±Ø¬Ø© Ø§Ù„Ø­Ø±Ø§Ø±Ø© Ø§Ù„Ø´Ù‡Ø±ÙŠØ© Ù„ÙƒÙ„ Ù…Ø³ØªÙˆØ¯Ø¹",
    yearlyPdfBtn: "Ø·Ø¨Ø§Ø¹Ø© PDF",
    yearlyTotalProd: "Ù…Ù‚Ø§Ø±Ù†Ø© Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø³Ù†ÙˆÙŠ Ù„Ù„Ø¥Ù†ØªØ§Ø¬",
    yearlyTotalProdNote: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„Ø³Ù†ÙˆÙŠ - Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø£ÙˆÙ„Ù‰ vs Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø«Ø§Ù†ÙŠØ© (Ø­ØµØµ)",
    yearlyTotalBen: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ù…Ø³ØªÙÙŠØ¯ÙŠ Ø®Ø¯Ù…Ø© Ø§Ù„Ø·Ø¹Ø§Ù…",
    yearlyTotalBenNote: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„Ø³Ù†ÙˆÙŠ - Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø£ÙˆÙ„Ù‰ vs Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø«Ø§Ù†ÙŠØ© (Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø£Ø´Ø®Ø§Øµ)",
    yearlyStudentComp: "Ù…Ù‚Ø§Ø±Ù†Ø© Ø§Ù„Ø·Ù„Ø§Ø¨ Ø§Ù„Ù…Ø³ØªÙÙŠØ¯ÙŠÙ† Ù…Ù† Ø®Ø¯Ù…Ø© Ø§Ù„Ø·Ø¹Ø§Ù…",
    yearlyStudentNote: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„Ø³Ù†ÙˆÙŠ - Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø£ÙˆÙ„Ù‰ vs Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø«Ø§Ù†ÙŠØ© (Ø§Ù„Ø·Ù„Ø§Ø¨)",
    yearlyWasteComp: "Ù…Ù‚Ø§Ø±Ù†Ø© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª (ÙƒØº)",
    yearlyWasteNote: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„Ø³Ù†ÙˆÙŠ - Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø£ÙˆÙ„Ù‰ vs Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø«Ø§Ù†ÙŠØ© (ÙƒØº)",
    yearlyMonthlyProd: "Ù…Ù‚Ø§Ø±Ù†Ø© Ø§Ù„Ø¥Ù†ØªØ§Ø¬ Ø§Ù„Ø´Ù‡Ø±ÙŠ",
    yearlyMonthlyProdNote: "Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø£ÙˆÙ„Ù‰ vs Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø«Ø§Ù†ÙŠØ© - Ø§Ù„ÙˆØ¬Ø¨Ø§Øª Ø§Ù„Ù…ÙÙ†ØªØ¬Ø© (Ø­ØµØµ)",
    yearlyMonthlyTurnstile: "Ù…Ù‚Ø§Ø±Ù†Ø© Ø¹Ø¨ÙˆØ± Ø§Ù„Ø¨ÙˆØ§Ø¨Ø© Ø§Ù„Ø¯ÙˆÙ‘Ø§Ø±Ø© Ø§Ù„Ø´Ù‡Ø±ÙŠ",
    yearlyMonthlyTurnstileNote: "Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø£ÙˆÙ„Ù‰ vs Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø«Ø§Ù†ÙŠØ© - Ø¹Ø¯Ø¯ Ø¹Ø¨ÙˆØ± Ø§Ù„Ø¨ÙˆØ§Ø¨Ø© Ø§Ù„Ø¯ÙˆÙ‘Ø§Ø±Ø©",
    yearlyMonthlyStudent: "Ù…Ù‚Ø§Ø±Ù†Ø© Ø¹Ø¨ÙˆØ± Ø§Ù„Ø·Ù„Ø§Ø¨ Ø§Ù„Ø´Ù‡Ø±ÙŠ",
    yearlyMonthlyStudentNote: "Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø£ÙˆÙ„Ù‰ vs Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø«Ø§Ù†ÙŠØ© - Ø¹Ø¯Ø¯ Ø¹Ø¨ÙˆØ± Ø§Ù„Ø·Ù„Ø§Ø¨",
    yearlyMonthlyWaste: "Ù…Ù‚Ø§Ø±Ù†Ø© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø´Ù‡Ø±ÙŠØ© (ÙƒØº)",
    yearlyMonthlyWasteNote: "Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø£ÙˆÙ„Ù‰ vs Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø«Ø§Ù†ÙŠØ© - ÙƒÙ…ÙŠØ© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª (ÙƒØº)",
    yearlyWasteListTitle: "Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø§Ù„Ø³Ù†ÙˆÙŠØ©",
    spendingRatesTitle: "Ù…Ø¹Ø¯Ù„Ø§Øª Ø§Ù„Ø¥Ù†ÙØ§Ù‚ Ù„ÙƒÙ„ Ø´Ø®Øµ (Ø§Ù„Ø·Ù„Ø§Ø¨ ÙˆØ§Ù„Ù…ÙˆØ¸ÙÙˆÙ† ÙˆØ§Ù„ÙˆØ¬Ø¨Ø§Øª)",
    spendingStudentRate: "Ù…Ø¨Ù„Øº Ø¥Ù†ÙØ§Ù‚ ÙƒÙ„ Ø·Ø§Ù„Ø¨ (TL)",
    btnSaveStudentRate: "Ø­ÙØ¸ Ù…Ø¨Ù„Øº Ø§Ù„Ø·Ù„Ø§Ø¨",
    spendingStaffRate: "Ù…Ø¨Ù„Øº Ø¥Ù†ÙØ§Ù‚ ÙƒÙ„ Ù…ÙˆØ¸Ù (TL)",
    btnSaveStaffRate: "Ø­ÙØ¸ Ù…Ø¨Ù„Øº Ø§Ù„Ù…ÙˆØ¸ÙÙŠÙ†",
    spendingMealRate: "Ù…Ø¨Ù„Øº Ø¥Ù†ÙØ§Ù‚ ÙƒÙ„ ÙˆØ¬Ø¨Ø© (TL)",
    btnSaveMealRate: "Ø­ÙØ¸ Ù…Ø¨Ù„Øº Ø§Ù„ÙˆØ¬Ø¨Ø§Øª",
    spendingDesc: "Ø¥Ù†ÙØ§Ù‚ Ø§Ù„Ø·Ù„Ø§Ø¨ = Ø¹Ø¯Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨ Ã— Ù…Ø¨Ù„Øº Ø¥Ù†ÙØ§Ù‚ ÙƒÙ„ Ø·Ø§Ù„Ø¨",
    spendingStudentTitle: "Ù…Ø¨Ù„Øº Ø¥Ù†ÙØ§Ù‚ Ø§Ù„Ø·Ù„Ø§Ø¨ (TL)",
    spendingChartEmpty: "Ø³ØªØ¸Ù‡Ø± Ø§Ù„Ø±Ø³ÙˆÙ… Ø§Ù„Ø¨ÙŠØ§Ù†ÙŠØ© Ø¹Ù†Ø¯ Ø¥Ø¯Ø®Ø§Ù„ Ø§Ù„Ø³Ø¬Ù„Ø§Øª",
    spendingStudentNote: "Ø¥Ù†ÙØ§Ù‚ Ø§Ù„Ø·Ù„Ø§Ø¨ (TL) = Ø¹Ø¯Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨ Ã— Ù…Ø¨Ù„Øº Ø¥Ù†ÙØ§Ù‚ ÙƒÙ„ Ø·Ø§Ù„Ø¨",
    spendingStaffTitle: "Ù…Ø¨Ù„Øº Ø¥Ù†ÙØ§Ù‚ Ø§Ù„Ù…ÙˆØ¸ÙÙŠÙ† (TL)",
    spendingStaffNote: "Ø¥Ù†ÙØ§Ù‚ Ø§Ù„Ù…ÙˆØ¸ÙÙŠÙ† (TL) = Ø¹Ø¯Ø¯ Ø§Ù„Ù…ÙˆØ¸ÙÙŠÙ† Ã— Ù…Ø¨Ù„Øº Ø¥Ù†ÙØ§Ù‚ ÙƒÙ„ Ù…ÙˆØ¸Ù",
    spendingMealTitle: "Ù…Ø¨Ù„Øº Ø¥Ù†ÙØ§Ù‚ Ø§Ù„ÙˆØ¬Ø¨Ø§Øª (TL)",
    spendingMealNote: "Ø¥Ù†ÙØ§Ù‚ Ø§Ù„ÙˆØ¬Ø¨Ø§Øª (TL) = Ø§Ù„ÙˆØ¬Ø¨Ø§Øª Ø§Ù„Ù…ÙÙ†ØªØ¬Ø© Ã— Ù…Ø¨Ù„Øº Ø¥Ù†ÙØ§Ù‚ ÙƒÙ„ ÙˆØ¬Ø¨Ø©",
    spendingTableTitle: "Ø¬Ø¯ÙˆÙ„ Ø­Ø³Ø§Ø¨ Ø§Ù„Ø¥Ù†ÙØ§Ù‚",
    syncTitle: "Ù…Ø²Ø§Ù…Ù†Ø© Supabase",
    syncCloseBtn: "Ø¥ØºÙ„Ø§Ù‚",
    modalNewRecord: "Ø¥Ø¶Ø§ÙØ© Ø³Ø¬Ù„ Ø¬Ø¯ÙŠØ¯",
    formDate: "Ø§Ù„ØªØ§Ø±ÙŠØ®",
    formProducedCount: "Ø¹Ø¯Ø¯ Ø§Ù„ÙˆØ¬Ø¨Ø§Øª Ø§Ù„Ù…ÙÙ†ØªØ¬Ø©",
    formTurnstileCount: "Ø¹Ø¯Ø¯ Ø¹Ø¨ÙˆØ± Ø§Ù„Ø¨ÙˆØ§Ø¨Ø© Ø§Ù„Ø¯ÙˆÙ‘Ø§Ø±Ø©",
    formStudentCount: "Ø¹Ø¯Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨ Ø§Ù„Ù…Ø³ØªÙÙŠØ¯ÙŠÙ†",
    formFoodType: "Ù†ÙˆØ¹ Ø§Ù„Ø·Ø¹Ø§Ù…",
    formAutoCalc: "Ø­Ø³Ø§Ø¨Ø§Øª ØªÙ„Ù‚Ø§Ø¦ÙŠØ©",
    badgeAutomatic: "ØªÙ„Ù‚Ø§Ø¦ÙŠ",
    badgeFixed: "Ø«Ø§Ø¨Øª",
    badgeAutoEditable: "ØªÙ„Ù‚Ø§Ø¦ÙŠ + Ù‚Ø§Ø¨Ù„ Ù„Ù„ØªØ¹Ø¯ÙŠÙ„",
    btnCancel: "Ø¥Ù„ØºØ§Ø¡",
    entryFormSubmit: "Ø­ÙØ¸",
    formReceiptNo: "Ø±Ù‚Ù… Ø§Ù„Ø¥ÙŠØµØ§Ù„",
    formOilType: "Ù†ÙˆØ¹ Ø§Ù„Ø²ÙŠØª",
    formAmountLt: "Ø§Ù„ÙƒÙ…ÙŠØ© (Ù„ØªØ±)",
    formNote: "Ù…Ù„Ø§Ø­Ø¸Ø©",
    formWasteType: "Ù†ÙˆØ¹ Ø§Ù„Ù†ÙØ§ÙŠØ§Øª",
    formAmount: "Ø§Ù„ÙƒÙ…ÙŠØ©",
    formDeviceName: "Ø§Ø³Ù… Ø§Ù„Ø¬Ù‡Ø§Ø²",
    formBrandModel: "Ø§Ù„Ø¹Ù„Ø§Ù…Ø© Ø§Ù„ØªØ¬Ø§Ø±ÙŠØ©-Ø§Ù„Ø·Ø±Ø§Ø²",
    formSerialNo: "Ø§Ù„Ø±Ù‚Ù… Ø§Ù„ØªØ³Ù„Ø³Ù„ÙŠ",
    formStatus: "Ø§Ù„Ø­Ø§Ù„Ø©",
    formVerification: "Ø§Ù„ØªØ­Ù‚Ù‚",
    formLastCalibration: "Ø¢Ø®Ø± Ù…Ø¹Ø§ÙŠØ±Ø©",
    formNextCalibration: "Ø§Ù„Ù…Ø¹Ø§ÙŠØ±Ø© Ø§Ù„ØªØ§Ù„ÙŠØ©",
    formLocation: "Ø§Ù„Ù…ÙˆÙ‚Ø¹/Ø§Ù„Ù‚Ø³Ù…",
    formResponsible: "Ø§Ù„Ø´Ø®Øµ Ø§Ù„Ù…Ø³Ø¤ÙˆÙ„",
    btnSave: "Ø­ÙØ¸",
    btnAdd: "Ø¥Ø¶Ø§ÙØ©",
    btnClose: "Ø¥ØºÙ„Ø§Ù‚",
    qrTitle: "Ø±Ù…Ø² QR",
    qrHint: "Ø§Ø·Ø¨Ø¹ Ø±Ù…Ø² QR Ù„ØªØ«Ø¨ÙŠØªÙ‡ Ø¹Ù„Ù‰ Ø£Ø¨ÙˆØ§Ø¨ Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª.",
    adminTitle: "Ù„ÙˆØ­Ø© Ø§Ù„Ø¥Ø¯Ø§Ø±Ø©",
    adminReAuthText: "ÙŠØ±Ø¬Ù‰ Ø¥Ø¯Ø®Ø§Ù„ ÙƒÙ„Ù…Ø© Ù…Ø±ÙˆØ± Ø§Ù„Ù…Ø³Ø¤ÙˆÙ„ Ù„Ù„ÙˆØµÙˆÙ„ Ø¥Ù„Ù‰ Ù„ÙˆØ­Ø© Ø§Ù„Ø¥Ø¯Ø§Ø±Ø©.",
    adminPassword: "ÙƒÙ„Ù…Ø© Ù…Ø±ÙˆØ± Ø§Ù„Ù…Ø³Ø¤ÙˆÙ„",
    btnVerify: "ØªØ­Ù‚Ù‚",
    adminSessionRole: "Ø¯ÙˆØ± Ø§Ù„Ø¬Ù„Ø³Ø©",
    adminLastLogin: "Ø¢Ø®Ø± Ø¯Ø®ÙˆÙ„",
    adminAuthMethod: "Ø·Ø±ÙŠÙ‚Ø© Ø§Ù„Ù…ØµØ§Ø¯Ù‚Ø©",
    adminStorage: "Ù…Ø®Ø²Ù† ÙƒÙ„Ù…Ø§Øª Ø§Ù„Ù…Ø±ÙˆØ±",
    adminDataSource: "Ù…ØµØ¯Ø± Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª",
    adminUserMgmt: "Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ†",
    adminUserMgmtDesc: "Ø¥Ø¶Ø§ÙØ© Ø£Ùˆ ØªØ¹Ø¯ÙŠÙ„ Ø£Ùˆ Ø­Ø°Ù Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ†.",
    adminAddUser: "Ø¥Ø¶Ø§ÙØ© Ù…Ø³ØªØ®Ø¯Ù… Ø¬Ø¯ÙŠØ¯",
    adminUsername: "Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…",
    adminDisplayName: "Ø§Ù„Ø§Ø³Ù… Ø§Ù„Ø¸Ø§Ù‡Ø±",
    adminPasswordLabel: "ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ±",
    adminRole: "Ø§Ù„Ø¯ÙˆØ±",
    adminAddUserBtn: "Ø¥Ø¶Ø§ÙØ© Ù…Ø³ØªØ®Ø¯Ù…",
    adminRolePerms: "Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ø£Ø°ÙˆÙ†Ø§Øª Ø­Ø³Ø¨ Ø§Ù„Ø£Ø¯ÙˆØ§Ø±",
    adminRolePermsDesc: "ØªØ­Ø¯ÙŠØ¯ Ø§Ù„ØªØ¨ÙˆÙŠØ¨Ø§Øª Ø§Ù„ØªÙŠ ÙŠÙ…ÙƒÙ† Ù„ÙƒÙ„ Ø¯ÙˆØ± Ø¹Ø±Ø¶Ù‡Ø§.",
    adminSecurity: "Ø£Ù…Ø§Ù† Ø§Ù„Ø¬Ù„Ø³Ø©",
    adminSecurityDesc: "Ø³ØªÙØºÙ„Ù‚ Ø§Ù„Ø¬Ù„Ø³Ø© Ø¥Ø°Ø§ Ù„Ù… ÙŠØªÙ… ØªÙ†ÙÙŠØ° Ø£ÙŠ Ù†Ø´Ø§Ø· Ø®Ù„Ø§Ù„ Ø§Ù„Ù…Ø¯Ø© Ø§Ù„Ù…Ø­Ø¯Ø¯Ø©.",
    adminInactivityTimeout: "Ù…Ù‡Ù„Ø© Ø¹Ø¯Ù… Ø§Ù„Ù†Ø´Ø§Ø·",
    adminLogsTitle: "Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ù†Ø´Ø§Ø·",
    adminLogsDesc: "ØªØ³Ø¬ÙŠÙ„ Ø¯Ø®ÙˆÙ„/Ø®Ø±ÙˆØ¬ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ† ÙˆØ¹Ù…Ù„ÙŠØ§Øª Ø§Ù„Ø³Ø¬Ù„Ø§Øª",
    btnRefresh: "ØªØ­Ø¯ÙŠØ«",
    adminSaveBtn: "Ø­ÙØ¸ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª",
    adminFooterNote: "ØªÙØ®Ø²Ù‘Ù† ÙƒÙ„Ù…Ø§Øª Ø§Ù„Ù…Ø±ÙˆØ± Ø¨Ø´ÙƒÙ„ Ø¯Ø§Ø¦Ù… Ø¹Ù„Ù‰ Ø§Ù„Ø®Ø§Ø¯Ù….",
    adminCloseBtn: "Ø¥ØºÙ„Ø§Ù‚",
    logFilterDelete: "Ø­Ø°Ù",
    logFilterAddUser: "Ø¥Ø¶Ø§ÙØ© Ù…Ø³ØªØ®Ø¯Ù…",
    logFilterDeleteUser: "Ø­Ø°Ù Ù…Ø³ØªØ®Ø¯Ù…",
    adminRefreshBtn: "ØªØ­Ø¯ÙŠØ«",
    manualTitle: "Ø¯Ù„ÙŠÙ„ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…",
    manualSubtitle: "Ù†Ø¸Ø§Ù… Ø§Ù„ØªØ­ÙƒÙ… ÙÙŠ Ø¥Ù†ØªØ§Ø¬ ÙˆØ§Ø³ØªÙ‡Ù„Ø§Ùƒ ÙˆÙ†ÙØ§ÙŠØ§Øª Ø§Ù„Ù…Ø·Ø¹Ù…",
    compDataType: "Ù†ÙˆØ¹ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª",
    compLastWeek: "Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ Ø§Ù„Ù…Ø§Ø¶ÙŠ",
    compThisWeek: "Ù‡Ø°Ø§ Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹",
    compLastMonth: "Ø§Ù„Ø´Ù‡Ø± Ø§Ù„Ù…Ø§Ø¶ÙŠ",
    compThisMonth: "Ù‡Ø°Ø§ Ø§Ù„Ø´Ù‡Ø±",
    compLastYear: "Ø§Ù„Ø¹Ø§Ù… Ø§Ù„Ù…Ø§Ø¶ÙŠ",
    compThisYear: "Ù‡Ø°Ø§ Ø§Ù„Ø¹Ø§Ù…",
    compDiff: "Ø§Ù„ÙØ±Ù‚",
    compTotalWaste: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ù†ÙØ§ÙŠØ§Øª (ÙƒØº)",
    compTotalProduction: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø¥Ù†ØªØ§Ø¬",
    compTurnstilePasses: "Ø¹Ø¨ÙˆØ± Ø§Ù„Ø¨ÙˆØ§Ø¨Ø©",
    compStudentCount: "Ø¹Ø¯Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨",
    compWastePerPerson: "Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ù„Ù„ÙØ±Ø¯ (ØºØ±Ø§Ù…)",
    monthlyCompDesc: "Ù…Ù‚Ø§Ø±Ù†Ø© Ù‡Ø°Ø§ Ø§Ù„Ø´Ù‡Ø± Ù…Ø¹ Ø§Ù„Ø´Ù‡Ø± Ø§Ù„Ù…Ø§Ø¶ÙŠ. â†‘ Ø²ÙŠØ§Ø¯Ø©ØŒ â†“ Ø§Ù†Ø®ÙØ§Ø¶.Ø§Ù†Ø®ÙØ§Ø¶ Ø§Ù„Ù†ÙØ§ÙŠØ§Øª ÙˆØ§Ù„Ù†ÙØ§ÙŠØ§Øª Ù„Ù„ÙØ±Ø¯ (â†“) Ø¬ÙŠØ¯.",
    yearlyCompDesc: "Ù…Ù‚Ø§Ø±Ù†Ø© Ù‡Ø°Ø§ Ø§Ù„Ø¹Ø§Ù… (Ù…Ù† Ø¨Ø¯Ø§ÙŠØ© Ø§Ù„Ø³Ù†Ø© Ø­ØªÙ‰ Ø§Ù„Ø¢Ù†) Ù…Ø¹ Ù†ÙØ³ Ø§Ù„ÙØªØ±Ø© Ù…Ù† Ø§Ù„Ø¹Ø§Ù… Ø§Ù„Ù…Ø§Ø¶ÙŠ. â†‘ Ø²ÙŠØ§Ø¯Ø©ØŒ â†“ Ø§Ù†Ø®ÙØ§Ø¶.Ø§Ù†Ø®ÙØ§Ø¶ Ø§Ù„Ù†ÙØ§ÙŠØ§Øª ÙˆØ§Ù„Ù†ÙØ§ÙŠØ§Øª Ù„Ù„ÙØ±Ø¯ (â†“) Ø¬ÙŠØ¯.",
    monthNames: ["ÙŠÙ†Ø§ÙŠØ±","ÙØ¨Ø±Ø§ÙŠØ±","Ù…Ø§Ø±Ø³","Ø£Ø¨Ø±ÙŠÙ„","Ù…Ø§ÙŠÙˆ","ÙŠÙˆÙ†ÙŠÙˆ","ÙŠÙˆÙ„ÙŠÙˆ","Ø£ØºØ³Ø·Ø³","Ø³Ø¨ØªÙ…Ø¨Ø±","Ø£ÙƒØªÙˆØ¨Ø±","Ù†ÙˆÙÙ…Ø¨Ø±","Ø¯ÙŠØ³Ù…Ø¨Ø±"],
    haccpColDate: "Ø§Ù„ØªØ§Ø±ÙŠØ®",
    haccpColTime: "Ø§Ù„ÙˆÙ‚Øª",
    haccpColDepot: "Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹",
    haccpColTemp: "Ø¯Ø±Ø¬Ø© Ø§Ù„Ø­Ø±Ø§Ø±Ø© (Â°Ù…)",
    haccpColHumidity: "Ø§Ù„Ø±Ø·ÙˆØ¨Ø© (%)",
    haccpColNote: "Ù…Ù„Ø§Ø­Ø¸Ø©",
    haccpColAction: "Ø¥Ø¬Ø±Ø§Ø¡",
    dayNames: ["Ø§Ù„Ø§Ø«Ù†ÙŠÙ†", "Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡", "Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡", "Ø§Ù„Ø®Ù…ÙŠØ³", "Ø§Ù„Ø¬Ù…Ø¹Ø©"],
    menuVariety: "Ù†ÙˆØ¹",
    menuVariety1: "Ø§Ù„Ù†ÙˆØ¹ Ø§Ù„Ø£ÙˆÙ„",
    menuVariety2: "Ø§Ù„Ù†ÙˆØ¹ Ø§Ù„Ø«Ø§Ù†ÙŠ",
    menuVariety3: "Ø§Ù„Ù†ÙˆØ¹ Ø§Ù„Ø«Ø§Ù„Ø«",
    menuVariety4: "Ø§Ù„Ù†ÙˆØ¹ Ø§Ù„Ø±Ø§Ø¨Ø¹",
    menuVariety5: "Ø§Ù„Ù†ÙˆØ¹ Ø§Ù„Ø®Ø§Ù…Ø³",
    menuPersonCount: "Ø¹Ø¯Ø¯ Ø§Ù„Ø£Ø´Ø®Ø§Øµ",
    stockDeductionList: "Ù‚Ø§Ø¦Ù…Ø© Ø®ØµÙ… Ø§Ù„Ù…Ø®Ø²ÙˆÙ†",
    total: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹",
    inVarieties: "Ø£Ù†ÙˆØ§Ø¹",
    person: "ÙØ±Ø¯",
    weeklyGrandTotal: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠ",
    dailyAverage: "Ø§Ù„Ù…ØªÙˆØ³Ø· Ø§Ù„ÙŠÙˆÙ…ÙŠ",
    avgPerPerson: "Ø§Ù„Ù…ØªÙˆØ³Ø· Ù„Ù„ÙØ±Ø¯",
    totalPersonDays: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø£Ø´Ø®Ø§Øµ/Ø£ÙŠØ§Ù…",
    colDay: "Ø§Ù„ÙŠÙˆÙ…",
    colDate: "Ø§Ù„ØªØ§Ø±ÙŠØ®",
    colPerson: "Ø§Ù„Ø£Ø´Ø®Ø§Øµ",
    dailyMaterialCost: "ØªÙƒÙ„ÙØ© Ø§Ù„Ù…ÙˆØ§Ø¯ Ø§Ù„ÙŠÙˆÙ…ÙŠØ©",
    perPerson: "Ù„Ù„ÙØ±Ø¯",
    ingredients: "Ø§Ù„Ù…ÙƒÙˆÙ†Ø§Øª",
    perPersonGram: "(ØºØ±Ø§Ù… Ù„Ù„ÙØ±Ø¯)",
    colIngredient: "Ø§Ù„Ù…ÙƒÙˆÙ†",
    colPerPerson: "/ÙØ±Ø¯",
    colUnit: "Ø§Ù„ÙˆØ­Ø¯Ø©",
    addIngredient: "+ Ø¥Ø¶Ø§ÙØ© Ù…ÙƒÙˆÙ†",
    foodName: "Ø§Ø³Ù… Ø§Ù„Ø·Ø¨Ù‚",
    allergen: "Ø§Ù„allingÙŠØ±Ø¬ÙŠÙ†",
    recipePerPerson: "Ø§Ù„ÙˆØµÙØ© (Ù„Ù„ÙØ±Ø¯)",
    devices: "Ø£Ø¬Ù‡Ø²Ø©",
    chartMonthlyProduction: "الإنتاج الشهري (فرد)",
    chartMonthlyPasses: "العبور الشهري (فرد)",
    chartLastYearWaste: "الهدر من السنة الماضية (وجبات)",
    chartMonthlyWasteKg: "النفايات الشهرية (كغ)",
    chartMonthlyMealCount: "عدد الوجبات الشهرية",
    chartMonthlyWasteRate: "نسبة النفايات الشهرية %",
    chartMonthlyStudent: "عدد الطلاب الشهري",
    chartWastePerPersonLabel: "النفايات لكل فرد (كغ/فرد)",
    maliTablo: "Ø§Ù„Ø¬Ø¯ÙˆÙ„ Ø§Ù„Ù…Ø§Ù„ÙŠ",
    maliTabloSubtitle: "Ù…Ù„Ø®Øµ ØªÙƒØ§Ù„ÙŠÙ Ø§Ù„Ù…ÙˆØ§Ø¯ Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠØ©",
    maliUnitPriceMissing: "Ø³Ø¹Ø± Ø§Ù„ÙˆØ­Ø¯Ø© Ù„Ù„Ù…Ø§Ø¯Ø© ØºÙŠØ± Ù…Ø­Ø¯Ø¯",
    maliUnitPriceHint: "ÙŠÙ…ÙƒÙ†Ùƒ Ø§Ù„ØªØ­Ø¯ÙŠØ¯ Ù…Ù† ØªØ¨ÙˆÙŠØ¨ Ø£Ø³Ø¹Ø§Ø± Ø§Ù„ÙˆØ­Ø¯Ø©",
    weeklyTotal: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠ",
    categoryDistribution: "ØªÙˆØ²ÙŠØ¹ Ø§Ù„ÙØ¦Ø§Øª",
    weeklyTotalList: "Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø§Ø­ØªÙŠØ§Ø¬Ø§Øª Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠØ© Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠØ©",
    totalCost: "Ø§Ù„ØªÙƒÙ„ÙØ© Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠØ©",
    catMeat: "Ù…Ù†ØªØ¬Ø§Øª Ø§Ù„Ù„Ø­ÙˆÙ…",
    catDairy: "Ù…Ù†ØªØ¬Ø§Øª Ø§Ù„Ø£Ù„Ø¨Ø§Ù†",
    catLegumes: "Ø§Ù„Ø¨Ù‚ÙˆÙ„ÙŠØ§Øª Ø§Ù„Ø¬Ø§ÙØ©",
    catSpices: "Ø§Ù„ØªÙˆØ§Ø¨Ù„",
    catVegetable: "Ø§Ù„Ø®Ø¶Ø±ÙˆØ§Øª ÙˆØ§Ù„ÙÙˆØ§ÙƒÙ‡",
    catOther: "Ø£Ø®Ø±Ù‰",
    month1: "ÙŠÙ†Ø§ÙŠØ±", month2: "ÙØ¨Ø±Ø§ÙŠØ±", month3: "Ù…Ø§Ø±Ø³", month4: "Ø£Ø¨Ø±ÙŠÙ„",
    month5: "Ù…Ø§ÙŠÙˆ", month6: "ÙŠÙˆÙ†ÙŠÙˆ", month7: "ÙŠÙˆÙ„ÙŠÙˆ", month8: "Ø£ØºØ³Ø·Ø³",
    month9: "Ø³Ø¨ØªÙ…Ø¨Ø±", month10: "Ø£ÙƒØªÙˆØ¨Ø±", month11: "Ù†ÙˆÙÙ…Ø¨Ø±", month12: "Ø¯ÙŠØ³Ù…Ø¨Ø±",
    menuListTitle: "Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©",
    totalDevices: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø£Ø¬Ù‡Ø²Ø©",
    statusWorking: "ÙŠØ¹Ù…Ù„",
    statusDefective: "Ù…Ø¹Ø·Ù„",
    statusMaintenance: "ÙŠØ­ØªØ§Ø¬ ØµÙŠØ§Ù†Ø©",
    statusScrap: "ÙŠØ¬Ø¨ ØªØ¬Ù‡ÙŠØ²Ø©",
    calibrationValid: "Ø§Ù„Ù…Ø¹Ø§ÙŠØ±Ø© ØµØ§Ù„Ø­Ø©",
    calibrationApproaching: "Ø§Ù„Ù…Ø¹Ø§ÙŠØ±Ø© ØªÙ‚ØªØ±Ø¨ (30 ÙŠÙˆÙ…)",
    differentDepartments: "Ø£Ù‚Ø³Ø§Ù… Ù…Ø®ØªÙ„ÙØ©",
    statusApproaching: "ÙŠÙ‚ØªØ±Ø¨",
    statusExpired: "Ø§Ù†ØªÙ‡Øª Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ©",
    statusNotDone: "Ù„Ù… ÙŠØªÙ…",
    statusValid: "ØµØ§Ù„Ø­",
    noDeviceFound: "Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø£Ø¬Ù‡Ø²Ø© ØªØ·Ø§Ø¨Ù‚ Ù…Ø¹Ø§ÙŠÙŠØ± Ø§Ù„ØªØµÙÙŠØ© Ù‡Ø°Ù‡.",
    noDeviceRecord: "Ù„Ù… ÙŠØªÙ… Ø¥Ø¯Ø®Ø§Ù„ Ø³Ø¬Ù„Ø§Øª Ø£Ø¬Ù‡Ø²Ø© Ø§Ù„Ù…Ø¹Ø§ÙŠØ±Ø© Ø¨Ø¹Ø¯.",
    deviceCount: "Ø£Ø¬Ù‡Ø²Ø©",
    deviceCountSuffix: " Ø£Ø¬Ù‡Ø²Ø©",
    editDeviceTitle: "ØªØ¹Ø¯ÙŠÙ„ Ø¬Ù‡Ø§Ø² Ø§Ù„Ù…Ø¹Ø§ÙŠØ±Ø©",
    newDeviceTitle: "Ø¬Ù‡Ø§Ø² Ù…Ø¹Ø§ÙŠØ±Ø© Ø¬Ø¯ÙŠØ¯",
    kpiBeneficiary: "Ø§Ù„Ù…Ø³ØªÙÙŠØ¯ÙˆÙ†: ",
    kpiNoRecordToday: "Ù„Ø§ ØªÙˆØ¬Ø¯ Ø³Ø¬Ù„Ø§Øª Ø§Ù„ÙŠÙˆÙ…",
    kpiAlertsCount: "ØªÙ†Ø¨ÙŠÙ‡Ø§Øª",
    kpiAllValuesOk: "Ø¬Ù…ÙŠØ¹ Ø§Ù„Ù‚ÙŠÙ… Ù…Ù‚Ø¨ÙˆÙ„Ø©",
    kpiDeviceInAlarm: "Ø£Ø¬Ù‡Ø²Ø© ÙÙŠ Ø­Ø§Ù„Ø© Ø§Ù†Ø°Ø§Ø±",
    kpiApproaching: "ØªÙ‚ØªØ±Ø¨",
    kpiAllCalibrationsValid: "Ø¬Ù…ÙŠØ¹ Ø§Ù„Ù…Ø¹Ø§ÙŠØ±Ø§Øª ØµØ§Ù„Ø­Ø©",
    filterAll: "Ø§Ù„ÙƒÙ„",
    colDeviceName: "Ø§Ø³Ù… Ø§Ù„Ø¬Ù‡Ø§Ø²",
    colBrandModel: "Ø§Ù„Ø¹Ù„Ø§Ù…Ø© Ø§Ù„ØªØ¬Ø§Ø±ÙŠØ©-Ø§Ù„Ø·Ø±Ø§Ø²",
    colSerialNo: "Ø§Ù„Ø±Ù‚Ù… Ø§Ù„ØªØ³Ù„Ø³Ù„ÙŠ",
    colDeviceStatus: "Ø­Ø§Ù„Ø© Ø§Ù„Ø¬Ù‡Ø§Ø²",
    colCalibration: "Ø§Ù„Ù…Ø¹Ø§ÙŠØ±Ø©",
    colLastCalibration: "Ø¢Ø®Ø± Ù…Ø¹Ø§ÙŠØ±Ø©",
    colNextCalibration: "Ø§Ù„ØªØ§Ù„ÙŠØ©",
    colDepartment: "Ø§Ù„Ù‚Ø³Ù…",
    colResponsible: "Ø§Ù„Ù…Ø³Ø¤ÙˆÙ„",
    colNote: "Ù…Ù„Ø§Ø­Ø¸Ø©",
    colAction: "Ø§Ù„Ø¥Ø¬Ø±Ø§Ø¡",
    unitPriceList: "Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø£Ø³Ø¹Ø§Ø±ÙˆØ­Ø¯Ø§Øª",
    registeredProducts: "Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª Ø§Ù„Ù…Ø³Ø¬Ù„Ø©",
    totalAmount: "Ø§Ù„Ù…Ø¨Ù„Øº Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ",
    avgUnitPrice: "Ù…ØªÙˆØ³Ø· Ø³Ø¹Ø± Ø§Ù„ÙˆØ­Ø¯Ø©",
    selectedYear: "Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ù…Ø­Ø¯Ø¯Ø©",
    duplicateWarning: "Ù…Ù†ØªØ¬Ø§Øª Ø¨Ù‡Ø§ Ø³Ø¬Ù„Ø§Øª Ù…ÙƒØ±Ø±Ø©. Ù‚Ø¯ ØªØ­ØªÙˆÙŠ Ø­Ø³Ø§Ø¨Ø§Øª Ø§Ù„Ø£Ø³Ø¹Ø§Ø± Ø¹Ù„Ù‰ Ø£Ø®Ø·Ø§Ø¡.",
    cleanDuplicates: "Ø­Ø°Ù ÙˆØ§Ø­Ø¯Ø§Ù‹ ØªÙ„Ùˆ Ø§Ù„Ø¢Ø®Ø±",
    colProductName: "Ø§Ø³Ù… Ø§Ù„Ù…Ù†ØªØ¬",
    colUnit: "Ø§Ù„ÙˆØ­Ø¯Ø©",
    colUnitPrice: "Ø³Ø¹Ø± Ø§Ù„ÙˆØ­Ø¯Ø© (â‚º)",
    colUnitEquals: "1 ÙˆØ­Ø¯Ø© =",
    colYear: "Ø§Ù„Ø³Ù†Ø©",
    noProductsThisYear: "Ù„Ù… ØªØªÙ… Ø¥Ø¶Ø§ÙØ© Ù…Ù†ØªØ¬Ø§Øª Ù„Ù‡Ø°Ù‡ Ø§Ù„Ø³Ù†Ø© Ø¨Ø¹Ø¯.",
    btnEdit: "ØªØ¹Ø¯ÙŠÙ„",
    btnDelete: "Ø­Ø°Ù",
    pageLabel: "ØµÙØ­Ø©",
    totalProductsLabel: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹",
    totalProductsSuffix: " Ù…Ù†ØªØ¬Ø§Øª",
    priceYearNote: "Ø§Ù„Ø£Ø³Ø¹Ø§Ø± Ø­Ø³Ø¨ Ø§Ù„Ø³Ù†Ø©. Ø§Ù„Ù…Ø·Ø§Ø¨Ù‚Ø©: ÙŠØªÙ… Ù…Ø·Ø§Ø¨Ù‚Ø© Ø§Ø³Ù… Ø§Ù„Ù…Ø§Ø¯Ø© ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹.",
    btnAddNewProduct: "+ Ù…Ù†ØªØ¬ Ø¬Ø¯ÙŠØ¯",
    btnDownloadCSV: "ØªÙ†Ø²ÙŠÙ„ CSV",
    btnPrint: "Ø·Ø¨Ø§Ø¹Ø©",
    btnUploadCSV: "ØªØ­Ù…ÙŠÙ„ CSV",
    clickToSelectYear: "Ø§Ù†Ù‚Ø± Ù„Ø§Ø®ØªÙŠØ§Ø± Ø§Ù„Ø³Ù†Ø©",
    selectYear: "Ø§Ø®ØªØ± Ø§Ù„Ø³Ù†Ø©",
    dataInfoRecord: "Ø³Ø¬Ù„",
    dataInfoProduction: "Ø¥Ù†ØªØ§Ø¬",
    dataInfoWaste: "Ù†ÙØ§ÙŠØ§Øª",
    portion: "ÙˆØ¬Ø¨Ø§Øª",
    abnormalDays: "Ø£ÙŠØ§Ù… ØºÙŠØ± Ø·Ø¨ÙŠØ¹ÙŠØ©",
    noRecordsToDisplay: "Ù„Ø§ ØªÙˆØ¬Ø¯ Ø³Ø¬Ù„Ø§Øª Ù„Ù„Ø¹Ø±Ø¶.",
    colYearLabel: "Ø§Ù„Ø³Ù†Ø©",
    avgPortion400: "400 Ø¬Ø±Ø§Ù…",
    recordsNot400: "Ø³Ø¬Ù„Ø§Øª Ù„ÙŠØ³Øª 400",
    gram: " Ø¬Ø±Ø§Ù…",
    personLabel: "Ø´Ø®Øµ",
    last7RecordsPrev7: "Ø¢Ø®Ø± 7 Ø³Ø¬Ù„Ø§Øª / Ø§Ù„Ø³Ø§Ø¨Ù‚Ø© 7",
    tempAppropriate: "Ù…Ù†Ø§Ø³Ø¨",
    tempLow: "Ù…Ù†Ø®ÙØ¶",
    tempHigh: "Ù…Ø±ØªÙØ¹",
    lowerLimit: "Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ø¯Ù†Ù‰: ",
    upperLimit: "Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ù‚ØµÙ‰: ",
    unknownDepo: "ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ",
    tempMin: "Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ø¯Ù†Ù‰: ",
    tempAvg: "Ø§Ù„Ù…ØªÙˆØ³Ø·: ",
    tempMax: "Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ù‚ØµÙ‰: ",
    humidity: "Ø§Ù„Ø±Ø·ÙˆØ¨Ø©: ",
    depot: "Ù…Ø³ØªÙˆØ¯Ø¹",
    selectedCount: " Ù…Ø­Ø¯Ø¯",
    pageRecords: "ØµÙØ­Ø© ",
    recordCount: " Ø³Ø¬Ù„)",
    tempRecordsTitle: "Ø³Ø¬Ù„Ø§Øª Ø¯Ø±Ø¬Ø© Ø­Ø±Ø§Ø±Ø© Ø§Ù„ØªØ®Ø²ÙŠÙ† Ø§Ù„Ø¨Ø§Ø±Ø¯",
    dateRangeLabel: " | Ø§Ù„ØªØ§Ø±ÙŠØ®:",
    allDepots: "Ø¬Ù…ÙŠØ¹ Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª",
    colTime: "Ø§Ù„ÙˆÙ‚Øª",
    colDepot: "Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹",
    colTemperature: "Ø§Ù„Ø­Ø±Ø§Ø±Ø©",
    colStatus: "Ø§Ù„Ø­Ø§Ù„Ø©",
    depotTempRecordTitle: "Ø³Ø¬Ù„ Ø¯Ø±Ø¬Ø© Ø­Ø±Ø§Ø±Ø© Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹",
    formDate: "Ø§Ù„ØªØ§Ø±ÙŠØ®",
    formTime: "Ø§Ù„ÙˆÙ‚Øª",
    formDepotName: "Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹",
    formTemperature: "Ø§Ù„Ø­Ø±Ø§Ø±Ø© (Â°Ù…)",
    tempPlaceholder: "0.0 (ÙŠÙ…ÙƒÙ† ØªØ±ÙƒÙ‡ ÙØ§Ø±ØºØ§Ù‹)",
    formHumidity: "Ø§Ù„Ø±Ø·ÙˆØ¨Ø© (%)",
    formNoteOptional: "Ø§Ø®ØªÙŠØ§Ø±ÙŠ",
    deleteConfirm: "Ù‡Ù„ Ø£Ù†Øª Ù…ØªØ£ÙƒØ¯ Ù…Ù† Ø­Ø°Ù Ù‡Ø°Ø§ Ø§Ù„Ø³Ø¬Ù„ØŸ",
    deleteSelectedConfirm: "Ù‡Ù„ Ø£Ù†Øª Ù…ØªØ£ÙƒØ¯ Ù…Ù† Ø­Ø°Ù ",
    deleteSelectedConfirmSuffix: " Ø³Ø¬Ù„Ø§Øª Ù…Ø­Ø¯Ø¯Ø©ØŸ",
    tempHistory: " Ø³Ø¬Ù„ Ø§Ù„Ø­Ø±Ø§Ø±Ø©",
    weeklyAvgTempNote: "Ù…ØªÙˆØ³Ø· Ø¯Ø±Ø¬Ø§Øª Ø§Ù„Ø­Ø±Ø§Ø±Ø© Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠØ© â€” Ù…Ø¹ Ø®Ø·ÙˆØ· Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ø¹Ù„Ù‰ ÙˆØ§Ù„Ø£Ø¯Ù†Ù‰",
    upperLimitLabel: "Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ù‚ØµÙ‰ (",
    lowerLimitLabel: "Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ø¯Ù†Ù‰ (",
    totalRecordCount: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø³Ø¬Ù„Ø§Øª",
    totalWasteOil: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø²ÙŠØª Ø§Ù„Ù†ÙØ§ÙŠØ§Øª",
    avgAmountPerRecord: "Ù…ØªÙˆØ³Ø· Ø§Ù„ÙƒÙ…ÙŠØ© / Ø³Ø¬Ù„",
    highestAmount: "Ø£Ø¹Ù„Ù‰ ÙƒÙ…ÙŠØ©",
    lowestAmount: "Ø£Ø¯Ù†Ù‰ ÙƒÙ…ÙŠØ©",
    oilTypeCount: "Ø¹Ø¯Ø¯ Ø£Ù†ÙˆØ§Ø¹ Ø§Ù„Ø²ÙŠØª",
    yearTotalSuffix: " Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹",
    startDate: "Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©",
    endDate: "Ø§Ù„Ù†Ù‡Ø§ÙŠØ©",
    typeLabel: "Ø§Ù„Ù†ÙˆØ¹: ",
    yearLabel: "Ø§Ù„Ø³Ù†Ø©: ",
    activeFilterLabel: "Ø§Ù„ÙÙ„ØªØ± Ø§Ù„Ù†Ø´Ø·: ",
    noFilterMessage: "Ø¨Ø¯ÙˆÙ† ÙÙ„ØªØ± â€” Ø¹Ø±Ø¶ Ø¬Ù…ÙŠØ¹ Ø³Ø¬Ù„Ø§Øª Ø²ÙŠØª Ø§Ù„Ù†ÙØ§ÙŠØ§Øª.",
    noWasteOilRecord: "Ù„Ù… ÙŠØªÙ… Ø¥Ø¯Ø®Ø§Ù„ Ø³Ø¬Ù„Ø§Øª Ø²ÙŠØª Ø§Ù„Ù†ÙØ§ÙŠØ§Øª Ø¨Ø¹Ø¯.",
    noMatchingFilterRecord: "Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø³Ø¬Ù„Ø§Øª ØªØ·Ø§Ø¨Ù‚ Ù…Ø¹Ø§ÙŠÙŠØ± Ø§Ù„ÙÙ„ØªØ±.",
    editWasteOilRecord: "ØªØ¹Ø¯ÙŠÙ„ Ø³Ø¬Ù„ Ø²ÙŠØª Ø§Ù„Ù†ÙØ§ÙŠØ§Øª",
    newWasteOilRecord: "Ø³Ø¬Ù„ Ø²ÙŠØª Ù†ÙØ§ÙŠØ§Øª Ø¬Ø¯ÙŠØ¯",
    wasteOilChartLabel: "Ø²ÙŠØª Ø§Ù„Ù†ÙØ§ÙŠØ§Øª",
    previousYearLabel: "Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø³Ø§Ø¨Ù‚Ø©",
    undefinedType: "ØºÙŠØ± Ù…Ø­Ø¯Ø¯",
    totalWastePackaging: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØ¹Ø¨Ø¦Ø©",
    wasteTypeCount: "Ø¹Ø¯Ø¯ Ø£Ù†ÙˆØ§Ø¹ Ø§Ù„Ù†ÙØ§ÙŠØ§Øª",
    noWastePackagingRecord: "Ù„Ù… ÙŠØªÙ… Ø¥Ø¯Ø®Ø§Ù„ Ø³Ø¬Ù„Ø§Øª Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØ¹Ø¨Ø¦Ø© Ø¨Ø¹Ø¯.",
    noMatchingFilterPackage: "Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø³Ø¬Ù„Ø§Øª ØªØ·Ø§Ø¨Ù‚ Ù…Ø¹Ø§ÙŠÙŠØ± Ø§Ù„ÙÙ„ØªØ±.",
    noFilterMessagePackaging: "Ø¨Ø¯ÙˆÙ† ÙÙ„ØªØ± â€” Ø¹Ø±Ø¶ Ø¬Ù…ÙŠØ¹ Ø³Ø¬Ù„Ø§Øª Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØ¹Ø¨Ø¦Ø©.",
    editWastePackagingRecord: "ØªØ¹Ø¯ÙŠÙ„ Ø³Ø¬Ù„ Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØ¹Ø¨Ø¦Ø©",
    newWastePackagingRecord: "Ø³Ø¬Ù„ Ù†ÙØ§ÙŠØ§Øª ØªØ¹Ø¨Ø¦Ø© Ø¬Ø¯ÙŠØ¯",
    wastePackagingChartLabel: "Ù†ÙØ§ÙŠØ§Øª Ø§Ù„ØªØ¹Ø¨Ø¦Ø©",
    chartDetailEmpty: "Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø³Ø¬Ù„Ø§Øª Ù„Ù‡Ø°Ù‡ Ø§Ù„ÙØªØ±Ø©.",
    chartClose: "Ø¥ØºÙ„Ø§Ù‚",
    chartColProduction: "Ø§Ù„Ø¥Ù†ØªØ§Ø¬",
    chartColPasses: "Ø§Ù„Ù…Ø±ÙˆØ±",
    chartColWaste: "Ø§Ù„Ù†ÙØ§ÙŠØ§Øª",
    chartColStudent: "Ø§Ù„Ø·Ù„Ø§Ø¨",
    chartColFoodType: "Ù†ÙˆØ¹ Ø§Ù„Ø·Ø¹Ø§Ù…",
    chartProductionVsTurnstile: "Ø§Ù„ÙØ±Ù‚ Ø¨ÙŠÙ† Ø§Ù„Ø¥Ù†ØªØ§Ø¬ ÙˆØ§Ù„Ù…Ø±ÙˆØ± Ø¹Ø¨Ø± Ø§Ù„Ø¯ÙˆØ§Ø±",
    chartStaffTotal: "Ø§Ù„Ù‡ÙŠØ¦Ø© Ø§Ù„Ø£ÙƒØ§Ø¯ÙŠÙ…ÙŠØ© ÙˆØ§Ù„Ø¥Ø¯Ø§Ø±ÙŠØ© + Ø£Ø³Ø§ØªØ°Ø©(SK)",
    yearFilterLabel: "Ø§Ù„Ø³Ù†Ø©:",
    monthFilterLabel: "Ø§Ù„Ø´Ù‡Ø±:",
    chartSelectYear: "Ø§Ø®ØªÙŠØ§Ø±",
    year1Label: "Ø§Ù„Ø³Ù†Ø© 1:",
    year2Label: "Ø§Ù„Ø³Ù†Ø© 2:",
    noComparison: "Ø¨Ø¯ÙˆÙ† Ù…Ù‚Ø§Ø±Ù†Ø©",
    newLabel: "Ø¬Ø¯ÙŠØ¯",
    foodTypeLabel: "Ù†ÙˆØ¹ Ø§Ù„Ø·Ø¹Ø§Ù…",
    productionLabel: " Ø§Ù„Ø¥Ù†ØªØ§Ø¬",
    wasteKgLabel: " Ù†ÙØ§ÙŠØ§Øª (ÙƒØ¬Ù…)",
    wasteGrPortionLabel: " Ù†ÙØ§ÙŠØ§Øª (Ø¬Ø±Ø§Ù…/ÙˆØ¬Ø¨Ø©)",
    diffKgLabel: "Ø§Ù„ÙØ±Ù‚ (ÙƒØ¬Ù…)",
    totalRow: "Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹",
    registeredRate: "Ø§Ù„Ù…Ø¹Ø¯Ù„ Ø§Ù„Ù…Ø­ÙÙˆØ¸: ",
    unsavedChanges: " (ØªØºÙŠÙŠØ±Ø§Øª ØºÙŠØ± Ù…Ø­ÙÙˆØ¸Ø©)",
    kpiTotalStudentSpending: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ù…ØµØ±ÙˆÙØ§Øª Ø§Ù„Ø·Ù„Ø§Ø¨",
    kpiTotalStaffSpending: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ù…ØµØ±ÙˆÙØ§Øª Ø§Ù„Ù…ÙˆØ¸ÙÙŠÙ†",
    kpiAvgMonthlyStudentSpending: "Ù…ØªÙˆØ³Ø· Ù…ØµØ±ÙˆÙØ§Øª Ø§Ù„Ø·Ù„Ø§Ø¨ Ø§Ù„Ø´Ù‡Ø±ÙŠØ©",
    kpiAvgMonthlyStaffSpending: "Ù…ØªÙˆØ³Ø· Ù…ØµØ±ÙˆÙØ§Øª Ø§Ù„Ù…ÙˆØ¸ÙÙŠÙ† Ø§Ù„Ø´Ù‡Ø±ÙŠØ©",
    kpiTotalStudents: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø·Ù„Ø§Ø¨",
    kpiTotalStaff: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ù…ÙˆØ¸ÙÙŠÙ†",
    kpiHighestStudentMonth: "Ø£Ø¹Ù„Ù‰ Ø´Ù‡Ø± Ù„Ù„Ø·Ù„Ø§Ø¨",
    kpiHighestStaffMonth: "Ø£Ø¹Ù„Ù‰ Ø´Ù‡Ø± Ù„Ù„Ù…ÙˆØ¸ÙÙŠÙ†",
    kpiTotalMealSpending: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ù…ØµØ±ÙˆÙØ§Øª Ø§Ù„Ø·Ø¹Ø§Ù…",
    kpiAvgMonthlyMealSpending: "Ù…ØªÙˆØ³Ø· Ù…ØµØ±ÙˆÙØ§Øª Ø§Ù„Ø·Ø¹Ø§Ù… Ø§Ù„Ø´Ù‡Ø±ÙŠØ©",
    kpiTotalMealsProduced: "Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø·Ø¹Ø§Ù… Ø§Ù„Ù…Ù†ØªØ¬",
    kpiHighestMealMonth: "Ø£Ø¹Ù„Ù‰ Ø´Ù‡Ø± Ù„Ù„Ø·Ø¹Ø§Ù…",
    chartStudentSpending: "Ù…ØµØ±ÙˆÙØ§Øª Ø§Ù„Ø·Ù„Ø§Ø¨ (â‚º)",
    chartStaffSpending: "Ù…ØµØ±ÙˆÙØ§Øª Ø§Ù„Ù…ÙˆØ¸ÙÙŠÙ† (â‚º)",
    chartMealSpending: "Ù…ØµØ±ÙˆÙØ§Øª Ø§Ù„Ø·Ø¹Ø§Ù… (â‚º)",
    noRecordsYet: "Ù„Ø§ ØªÙˆØ¬Ø¯ Ø³Ø¬Ù„Ø§Øª Ø¨Ø¹Ø¯.",
    invalidRate: "ÙŠØ±Ø¬Ù‰ Ø¥Ø¯Ø®Ø§Ù„ Ù…Ø¹Ø¯Ù„ ØµØ§Ù„Ø­!",
    rateSaved: "ØªÙ… Ø­ÙØ¸ Ø§Ù„Ù…Ø¹Ø¯Ù„: ",
    menuStatusDraft: "Ù…Ø³ÙˆØ¯Ø©",
    menuStatusPending: "Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„Ø§Ø¹ØªÙ…Ø§Ø¯",
    menuStatusApproved: "Ù…Ø¹ØªÙ…Ø¯",
    menuStatusRejected: "Ù…Ø±ÙÙˆØ¶",
    menuApprove: "Ø§Ø¹ØªÙ…Ø§Ø¯ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©",
    menuApproveDisabled: "Ù„Ù… ÙŠØªÙ… ØªÙ‚Ø¯ÙŠÙ… Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ù„Ù„Ø§Ø¹ØªÙ…Ø§Ø¯ Ø¨Ø¹Ø¯. Ø¹Ù†Ø¯Ù…Ø§ ÙŠØ¶ØºØ· Ø§Ù„Ù… nutrition Ø¹Ù„Ù‰ \"ØªÙ‚Ø¯ÙŠÙ… Ù„Ù„Ø§Ø¹ØªÙ…Ø§Ø¯\" ÙŠÙ…ÙƒÙ†Ùƒ Ø§Ù„Ø§Ø¹ØªÙ…Ø§Ø¯ Ù…Ù† Ù‡Ù†Ø§.",
    menuReject: "Ø±ÙØ¶ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ù…Ø¹ Ø§Ù„ØªØ¨Ø±ÙŠØ±",
    menuRejectDisabled: "Ù„Ù… ÙŠØªÙ… ØªÙ‚Ø¯ÙŠÙ… Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ù„Ù„Ø§Ø¹ØªÙ…Ø§Ø¯ Ø¨Ø¹Ø¯. Ø¹Ù†Ø¯Ù…Ø§ ÙŠØ¶ØºØ· Ø§Ù„Ù… nutrition Ø¹Ù„Ù‰ \"ØªÙ‚Ø¯ÙŠÙ… Ù„Ù„Ø§Ø¹ØªÙ…Ø§Ø¯\" ÙŠÙ…ÙƒÙ†Ùƒ Ø§Ù„Ø±ÙØ¶ Ù…Ù† Ù‡Ù†Ø§.",
    menuPendingCount: " Ù‚ÙˆØ§Ø¦Ù… Ø£ weeks ØªÙ†ØªØ¸Ø± Ø§Ù„Ø§Ø¹ØªÙ…Ø§Ø¯. ÙŠÙ…ÙƒÙ†Ùƒ Ø§Ù„Ø°Ù‡Ø§Ø¨ Ø¥Ù„Ù‰ Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ Ø§Ù„Ù…ØªØ£Ø®Ø± ÙˆØ§Ù„Ø§Ø¹ØªÙ…Ø§Ø¯.",
    menuNotApproved: "Ù‚Ø§Ø¦Ù…Ø© Ù‡Ø°Ø§ Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ Ù„Ù… ÙŠØªÙ… Ø§Ø¹ØªÙ…Ø§Ø¯Ù‡Ø§ Ù…Ù† Ù‚ÙØ¨ÙÙ„ Ù…Ù‡Ù†Ø¯Ø³ Ø§Ù„Ø£ØºØ°ÙŠØ© Ø¨Ø¹Ø¯.",
    menuRejected: "ØªÙ… Ø±ÙØ¶ Ù‡Ø°Ù‡ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©",
    menuRejectedSuffix: ". ÙŠÙ…ÙƒÙ† Ù„Ù„Ù… nutrition Ø§Ù„ØªØµØ­ÙŠØ­ ÙˆØ¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØªÙ‚Ø¯ÙŠÙ….",
    menuAwaitingApproval: "Ù‡Ø°Ù‡ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„Ø§Ø¹ØªÙ…Ø§Ø¯. Ø³ØªÙÙˆØ¶Ø¹ Ø¹Ù„Ø§Ù…Ø© \"ØºÙŠØ± Ù…Ø¹ØªÙ…Ø¯Ø©\" ÙÙŠ Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø¥Ù†ØªØ§Ø¬.",
    noteLabel: "Ù…Ù„Ø§Ø­Ø¸Ø© ",
    deleteNote: "Ø­Ø°Ù Ù‡Ø°Ù‡ Ø§Ù„Ù…Ù„Ø§Ø­Ø¸Ø©",
    addNote: "Ø¥Ø¶Ø§ÙØ© Ù…Ù„Ø§Ø­Ø¸Ø© Ø¬Ø¯ÙŠØ¯Ø©",
    mealPickerTitle: "Ø§Ø®ØªÙŠØ§Ø± Ø§Ù„Ø·Ø¹Ø§Ù…",
    clearLabel: "ğŸ—‘ Ù…Ø³Ø­",
    searchMealPlaceholder: "Ø§Ù„Ø¨Ø­Ø« Ø¹Ù† Ø·Ø¹Ø§Ù…...",
    noMatchingMeal: "Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø·Ø¹Ø§Ù… Ù…Ø·Ø§Ø¨Ù‚.",
    varietyLabel: " ØµÙ†Ù: ",
    addRecord: "Ø¥Ø¶Ø§ÙØ© Ø³Ø¬Ù„ Ø¬Ø¯ÙŠØ¯",
    editRecord: "ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ø³Ø¬Ù„",
    btnUpdate: "ØªØ­Ø¯ÙŠØ«",
    recordAdded: "ØªÙ…Øª Ø¥Ø¶Ø§ÙØ© Ø§Ù„Ø³Ø¬Ù„ Ø¨Ù†Ø¬Ø§Ø­.",
    recordUpdated: "ØªÙ… ØªØ­Ø¯ÙŠØ« Ø§Ù„Ø³Ø¬Ù„ Ø¨Ù†Ø¬Ø§Ø­.",
    recordDeleted: "ØªÙ… Ø­Ø°Ù Ø§Ù„Ø³Ø¬Ù„.",
    allRecordsDeleted: "ØªÙ… Ø­Ø°Ù Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø³Ø¬Ù„Ø§Øª.",
    selectedRecordsDeleted: "ØªÙ… Ø­Ø°Ù Ø§Ù„Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ù…Ø­Ø¯Ø¯Ø©.",
    noRecordToDelete: "Ù„Ø§ ØªÙˆØ¬Ø¯ Ø³Ø¬Ù„Ø§Øª Ù„Ù„Ø­Ø°Ù.",
    noSelectedRecord: "Ù„Ù… ÙŠØªÙ… ØªØ­Ø¯ÙŠØ¯ Ø£ÙŠ Ø³Ø¬Ù„.",
    deleteAllConfirm: "Ù‡Ù„ Ø£Ù†Øª Ù…ØªØ£ÙƒØ¯ Ø£Ù†Ùƒ ØªØ±ÙŠØ¯ Ø­Ø°Ù Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø³Ø¬Ù„Ø§ØªØŸ\nÙ„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„ØªØ±Ø§Ø¬Ø¹ Ø¹Ù† Ù‡Ø°Ø§ Ø§Ù„Ø¥Ø¬Ø±Ø§Ø¡!",
    deleteFoodConfirm: "Ù‡Ù„ Ø£Ù†Øª Ù…ØªØ£ÙƒØ¯ Ø£Ù†Ùƒ ØªØ±ÙŠØ¯ Ø­Ø°Ù Ù‡Ø°Ø§ Ø§Ù„Ø·Ø¹Ø§Ù…ØŸ",
    selected: " Ù…Ø­Ø¯Ø¯",
    negMeals: "Ø¹Ø¯Ø¯ Ø§Ù„ÙˆØ¬Ø¨Ø§Øª Ø§Ù„Ù…Ù†ØªØ¬Ø© Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ù† ÙŠÙƒÙˆÙ† Ø³Ø§Ù„Ø¨Ø§Ù‹.",
    negTurnstile: "Ø¹Ø¯Ø¯ Ø¹Ù…Ù„ÙŠØ§Øª Ø§Ù„Ù…Ø±ÙˆØ± Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ù† ÙŠÙƒÙˆÙ† Ø³Ø§Ù„Ø¨Ø§Ù‹.",
    negStaff: "Ø¹Ø¯Ø¯ Ø§Ù„Ù…ÙˆØ¸ÙÙŠÙ† Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ù† ÙŠÙƒÙˆÙ† Ø³Ø§Ù„Ø¨Ø§Ù‹.",
    negPortion: "ÙƒÙ…ÙŠØ© Ø§Ù„Ø­ØµØ© Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ù† ØªÙƒÙˆÙ† Ø³Ø§Ù„Ø¨Ø©.",
    negStudent: "Ø¹Ø¯Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨ Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ù† ÙŠÙƒÙˆÙ† Ø³Ø§Ù„Ø¨Ø§Ù‹.",
    unsavedConfirm: "Ù‡Ù†Ø§Ùƒ ØªØºÙŠÙŠØ±Ø§Øª ØºÙŠØ± Ù…Ø­ÙÙˆØ¸Ø©. Ù‡Ù„ Ø£Ù†Øª Ù…ØªØ£ÙƒØ¯ Ø£Ù†Ùƒ ØªØ±ÙŠØ¯ Ø§Ù„Ø¥ØºÙ„Ø§Ù‚ØŸ",
    selectUser: "ÙŠØ±Ø¬Ù‰ ØªØ­Ø¯ÙŠØ¯ Ù…Ø³ØªØ®Ø¯Ù….",
    wrongCredentials: "Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ø£Ùˆ ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± ØºÙŠØ± ØµØ­ÙŠØ­Ø©.",
    tooManyAttempts: "Ù…Ø­Ø§ÙˆÙ„Ø§Øª ÙƒØ«ÙŠØ±Ø© Ø¬Ø¯Ø§Ù‹. ÙŠØ±Ø¬Ù‰ Ø§Ù„Ø§Ù†ØªØ¸Ø§Ø±.",
    editable: "Ù‚Ø§Ø¨Ù„ Ù„Ù„ØªØ¹Ø¯ÙŠÙ„",
    fixed: "Ø«Ø§Ø¨Øª",
    menuSentForApproval: "ØªÙ… Ø¥Ø±Ø³Ø§Ù„ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ù„Ù„Ù…ÙˆØ§ÙÙ‚Ø©. ÙÙŠ Ø§Ù†ØªØ¸Ø§Ø± Ù…ÙˆØ§ÙÙ‚Ø© Ù…Ù‡Ù†Ø¯Ø³ Ø§Ù„Ø£ØºØ°ÙŠØ©/Ø§Ù„Ù…Ø¯ÙŠØ±.",
    menuApproved: "ØªÙ…Øª Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø¹Ù„Ù‰ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©.",
    menuRejectedMsg: "ØªÙ… Ø±ÙØ¶ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ù…Ø¹ Ø§Ù„ØªØ¨Ø±ÙŠØ±.",
    menuDraftSaved: "ØªÙ… Ø­ÙØ¸ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© ÙƒÙ…Ø³ÙˆØ¯Ø©.",
    menuCleared: "ØªÙ… Ù…Ø³Ø­ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©.",
    monthShort1: "ÙŠÙ†Ø§ÙŠØ±",
    monthShort2: "ÙØ¨Ø±Ø§ÙŠØ±",
    monthShort3: "Ù…Ø§Ø±Ø³",
    monthShort4: "Ø£Ø¨Ø±ÙŠÙ„",
    monthShort5: "Ù…Ø§ÙŠÙˆ",
    monthShort6: "ÙŠÙˆÙ†ÙŠÙˆ",
    monthShort7: "ÙŠÙˆÙ„ÙŠÙˆ",
    monthShort8: "Ø£ØºØ³Ø·Ø³",
    monthShort9: "Ø³Ø¨ØªÙ…Ø¨Ø±",
    monthShort10: "Ø£ÙƒØªÙˆØ¨Ø±",
    monthShort11: "Ù†ÙˆÙÙ…Ø¨Ø±",
    monthShort12: "Ø¯ÙŠØ³Ù…Ø¨Ø±"
  },
  de: {
    loginSub: "ERNAHRUNGSDIENST-VERWALTUNGSSYSTEM",
    loginFormSub: "Anmelden",
    loginUsername: "Benutzername",
    loginSelectUser: "Benutzer auswÃ¤hlen",
    loginPassword: "Passwort",
    loginBtn: "Anmelden",
    loginHint: "Sie erhalten Ihr Passwort von Ihrem Administrator",
    loginFeature1: "MenÃ¼planung, tÃ¤gliche Produktion, Verbrauch & Abfallverfolgung",
    loginFeature2: "Detaillierte Berichte",
    loginFeature3: "Live-Dashboard & Diagramme",
    menuLabel: "MenÃ¼",
    headerSubtitle: "ErnÃ¤hrungsdienste-Verwaltungssystem",
    btnLogout: "Abmelden",
    btnPrev: "ZurÃ¼ck",
    btnNext: "Weiter",
    loading: "Laden...",
    loadingText: "Daten werden synchronisiert...",
    loadingSub: "Supabase-Verbindung wird geprÃ¼ft",
    loadingSkip: "Klicken zum Ãœberspringen",
    versionLabel: "Anwendungsversion",
    sidebarPanel: "Dashboard",
    sidebarMenu: "WochenmenÃ¼",
    sidebarRecords: "Aufzeichnungen",
    sidebarReport: "Bericht",
    sidebarHaccp: "Lebensmittelsicherheit",
    sidebarCalibration: "Kalibrierung",
    sidebarOil: "AltÃ¶l",
    sidebarPackaging: "Verpackungsabfall",
    sidebarCharts: "Diagramme",
    sidebarYearly: "Jahresvergleich",
    sidebarSpending: "Ausgaben",
    sidebarUnitPrice: "StÃ¼ckpreise",
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
    kpiHaccpAlarm: "KÃ¼hllager-Temperaturalarm",
    kpiCalibrationAlarm: "Kalibrierungsalarm",
    kpiAvgWaste: "Durchschn. Abfall (kg)",
    kpiTotalPasses: "Gesamte DrehkreuzdurchgÃ¤nge",
    kpiTotalWaste: "Gesamter Abfall (kg)",
    kpiWasteRate: "Abfallquote",
    weeklyPrevBtn: "Vorherige Woche",
    weeklySummary: "Wochenzusammenfassung",
    weeklyNextBtn: "NÃ¤chste Woche",
    weeklyBadge: "Diese Woche",
    dailyPrevBtn: "Vorheriger Tag",
    dailySummary: "Tagesdetails",
    dailyNextBtn: "NÃ¤chster Tag",
    weeklyCompTitle: "Wochenvergleich",
    monthlyCompTitle: "Monatsvergleich",
    monthlyBadge: "Dieser Monat",
    yearlyBadge: "Dieses Jahr",
    anomalyTitle: "Anomalieerkennung",
    anomalyBadge: "Anormale Abfaltage",
    lastRecordsTitle: "Letzte Aufzeichnungen",
    dashboardGoToRecords: "Zu den Aufzeichnungen",
    emptyDashboard: "Noch keine EintrÃ¤ge...",
    formulaTitle: "ABFALLBERECHNUNGSFORMEL",
    recordsEntryBtn: "Produktion & Verbrauch eingeben",
    recordsImportBtn: "Importieren",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "CSV herunterladen",
    recordsDeleteBtn: "AusgewÃ¤hlte lÃ¶schen",
    emptyRecords: "Keine Aufzeichnungen gefunden.",
    thDate: "Datum",
    thProducedPerson: "Hergestellte Mahlzeiten (Person)",
    thWaste10: "10% Abfall",
    thBeneficiary: "ErnÃ¤hrungsdienst-Nutzer",
    thPortionGr: "Portion (g)",
    thWasteKg: "Abfall (kg)",
    thWastedPortion: "Entsorgt (Portionen)",
    thFoodType: "Essenstyp",
    thAction: "Aktion",
    thAcademicStaff: "Akademisches & Verwaltungspersonal Ã¼ber Drehkreuz",
    thStudentCount: "Studierende Ã¼ber Drehkreuz",
    thBeneficiaryTotal: "Gesamte ErnÃ¤hrungsdienst-Nutzer",
    sksStaff: "SKS-ErnÃ¤hrungsdienst-Personal",
    summaryReport: "Zusammenfassungsbericht",
    reportPdfBtn: "PDF Ã¶ffnen",
    allRecordsPrint: "Alle Aufzeichnungen (Druckansicht)",
    rTotalRecords: "Gesamtzahl der Aufzeichnungen",
    rTotalMeals: "Gesamtzahl hergestellter Mahlzeiten",
    rTotalWaste10: "Gesamter 10%-Abfall",
    rTotalAfterWaste: "Mahlzeiten nach 10%-Abfall",
    rTotalTurnstile: "Gesamte DrehkreuzdurchgÃ¤nge",
    rTotalBeneficiary: "Gesamte ErnÃ¤hrungsdienst-Nutzer",
    rTotalStaff: "Gesamtes SKS-Personal",
    rPortionSize: "PortionsgrÃ¶ÃŸe (g)",
    rTotalPortion: "Gesamtportionen (g)",
    rWastedPortion: "Entsorgte Portionen",
    rMaxWeeklyBeneficiary: "HÃ¶chste wÃ¶chentliche Nutzeranzahl",
    rTotalWasteKg: "Gesamte Abfallmenge (kg)",
    rAvgWasteKg: "Durchschn. Abfallmenge (kg)",
    rTotalStudents: "Gesamte Studierendenzahl",
    rMaxWaste: "HÃ¶chster Abfall (kg)",
    rMinWaste: "Niedrigster Abfall (kg)",
    rWasteTrend: "Abfalltrend (letzte 7 Tage)",
    rBeneficiaryTrend: "Nutzertrend (letzte 7 Tage)",
    wasteByFoodTitle: "Abfallanalyse nach Essenstyp",
    wasteByFoodEmpty: "Keine Aufzeichnungen mit Essenstyp-Daten gefunden.",
    wasteByFoodRecords: "Anzahl EintrÃ¤ge",
    wasteByFoodRate: "Abfallquote",
    wasteByFoodPerPerson: "Abfall pro Person (kg)",
    wsProducedMeal: "Mahlzeiten produziert (Pers.)",
    wsTotalPasses: "Gesamte DurchgÃ¤nge",
    wsTurnstile: "Drehkreuz",
    wsStaffSKS: "Verpflegungspersonal",
    wsWasteAmount: "Abfallmenge",
    wsWastedPortion: "In den MÃ¼ll",
    wsStudents: "ErnÃ¤hrungsstud.",
    wsNoRecordsYet: "Noch keine EintrÃ¤ge",
    wsNoRecordThisWeek: "Keine EintrÃ¤ge diese Woche",
    wsNoRecordToday: "Kein Eintrag",
    wsTodayDetail: "Heutige Details",
    wsDailyDetail: "Tagesdetails",
    wsWaste: "Verlust",
    wsPortion: "Portion",
    wsProduced: "Produziert",
    wsTurnstileCount: "DrehkreuzgÃ¤nge",
    wsStaffCount: "Personal",
    menuTitle: "Wochen-MenÃ¼liste",
    menuStatusBadge: "Status",
    menuSaveBtn: "Speichern",
    menuSendBtn: "Zur Genehmigung senden",
    menuApproveBtn: "Genehmigen",
    menuRejectBtn: "Ablehnen",
    menuWithdrawBtn: "Genehmigung zurÃ¼ckziehen",
    menuClearBtn: "Tabelle leeren",
    menuPrintBtn: "Drucken",
    menuFoodListBtn: "Speisekarte",
    menuFoodListUploadBtn: "CSV hochladen",
    menuFoodListCsvBtn: "CSV herunterladen",
    menuWarningPrefix: "Nicht genehmigtes MenÃ¼:",
    menuWarningText: "Das MenÃ¼ dieser Woche wurde vom Lebensmitteltechnologen noch nicht genehmigt.",
    menuHintText: "Essensnamen eingeben...",
    productNeedsTitle: "Produktbedarfsliste",
    weeklyNeedsTitle: "WÃ¶chentliche Gesamtbedarfsliste",
    foodListTitle: "Speisekarte",
    modalRejectMenu: "MenÃ¼ ablehnen",
    modalRejectDesc: "Ablehnungsgrund ist erforderlich.",
    menuRejectConfirm: "Ablehnen",
    haccpTitle: "Lebensmittelsicherheitsmanagement",
    haccpCsvBtn: "CSV herunterladen",
    haccpColdStorage: "KÃ¼hllager-Temperaturaufzeichnungen",
    haccpNewBtn: "Neuer Eintrag",
    haccpDepotBtn: "Lagerhausnamen",
    haccpDepoQrNote: "Sie kÃ¶nnen Lagerhausnamen bearbeiten und mit der QR-SchaltflÃ¤che QR-Codes fÃ¼r jedes Lagerhaus generieren.",
    haccpModalTitle: "Neuer Eintrag",
    filterDepot: "Lagerhausfilter:",
    filterAll: "Alle",
    filterDateRange: "Zeitraum:",
    emptyHaccp: "Noch keine TemperatureintrÃ¤ge vorhanden.",
    btnDeleteSelectedHaccp: "AusgewÃ¤hlte lÃ¶schen",
    btnPdf: "PDF",
    depoNamesTitle: "Lagerhausnamen",
    oilNewBtn: "Neuer Eintrag",
    oilListBtn: "Liste",
    oilFilterTitle: "AltÃ¶l-Filter",
    filterOilType: "Ã–ltyp:",
    btnReset: "ZurÃ¼cksetzen",
    oilSummaryTitle: "AltÃ¶l-Zusammenfassung",
    oilChartTitle: "AltÃ¶l-Diagramme",
    oilChartSubtitle: "Monatliche AltÃ¶l-Menge (Liter)",
    oilChartEmpty: "Diagramme werden angezeigt, wenn AltÃ¶leintrÃ¤ge erfasst werden",
    oilChartNote: "Monatliche AltÃ¶l-Summen nach Datum, Ã–ltyp und Jahresfilter",
    oilRecordsTitle: "AltÃ¶l-Aufzeichnungen",
    oilModalTitle: "AltÃ¶l-Eintrag",
    emptyOil: "Noch keine AltÃ¶leintrÃ¤ge vorhanden.",
    ambalajNewBtn: "Neuer Eintrag",
    ambalajListBtn: "Liste",
    packagingFilterTitle: "Verpackungsabfall-Filter",
    filterWasteType: "Abfalltyp:",
    packagingSummaryTitle: "Verpackungsabfall-Zusammenfassung",
    packagingChartTitle: "Verpackungsabfall-Diagramme",
    packagingChartSubtitle: "Monatliche Verpackungsabfall-Menge (kg)",
    packagingChartEmpty: "Diagramme werden angezeigt, wenn VerpackungsabfÃ¤lle erfasst werden",
    packagingChartNote: "Monatliche Verpackungsabfall-Summen nach Datum, Abfalltyp und Jahresfilter (kg)",
    packagingRecordsTitle: "Verpackungsabfall-Aufzeichnungen",
    packagingModalTitle: "Verpackungsabfall-Eintrag",
    emptyPackaging: "Noch keine Verpackungsabfall-EintrÃ¤ge vorhanden.",
    kalibrasyonNewBtn: "Neues GerÃ¤t",
    kalibrasyonListBtn: "Liste",
    kalibrasyonCsvBtn: "CSV herunterladen",
    calibrationSummary: "Kalibrierungszusammenfassung",
    calibrationDevices: "Zu kalibrierende GerÃ¤te",
    calibrationModalTitle: "GerÃ¤t zur Kalibrierung",
    filterStatus: "Status:",
    filterDepartment: "Abteilung:",
    btnWordExport: "Nach Word exportieren",
    btnPrint: "PDF drucken",
    chartProdWaste: "Produktion - DurchgÃ¤nge - Abfall-Vergleich",
    chartEmpty: "Diagramme werden angezeigt, wenn Daten eingegeben werden",
    chartProdWasteNote: "Monatlicher Vergleich von Produktion, DrehkreuzdurchgÃ¤ngen und entsorgten Portionen",
    chartStudentCount: "Anzahl der Studierenden im ErnÃ¤hrungsdienst",
    yearTotal: "Jahresgesamt",
    chartStudentNote: "Monatliche Summe der tÃ¤glichen StudierendendurchgÃ¤nge",
    chartStaffTotal: "Akademisches & Verwaltungspersonal + SKS-Personal",
    chartStaffNote: "Summe von Akademischem & Verwaltungspersonal (Drehkreuz - Studierende) und SKS-ErnÃ¤hrungsdienst-Personal",
    chartMonthlyProd: "Monatliche Mahlzeitenproduktion",
    chartMonthlyProdNote: "Monatliche Summe der tÃ¤glich hergestellten Mahlzeiten",
    chartMonthlyTurnstile: "Monatliche DrehkreuzdurchgÃ¤nge",
    chartTurnstileNote: "Studierende + Personal + externe DurchgÃ¤nge",
    chartMonthlyWaste: "Monatliche Abfallmenge (kg)",
    chartMonthlyWasteNote: "Monatliche Summe des tÃ¤glichen Abfalls (kg)",
    chartMonthlyWastePortion: "Monatliche Abfallmenge (Portionen)",
    chartWastePortionNote: "Monatliche Summe der tÃ¤glich entsorgten Portionen",
    chartDiff: "Differenz zwischen Produktion und DurchgÃ¤ngen",
    chartDiffNote: "Unterschied zwischen hergestellten Mahlzeiten und DrehkreuzdurchgÃ¤ngen",
    chartWasteRatio: "Abfall % der hergestellten Mahlzeiten",
    yearAverage: "Jahresdurchschnitt",
    chartWasteRatioNote: "Prozentsatz der hergestellten Mahlzeiten, die zu Abfall werden",
    chartWastePerPerson: "Abfall pro Person (kg/Person)",
    chartWastePerPersonNote: "Durchschnittlicher Abfall pro Person im Speisesaal",
    chartMonthlyTemp: "Monatliche durchschnittliche Lagerhaus-Temperaturen (Â°C)",
    chartTempEmpty: "Diagramme werden angezeigt, wenn TemperatureintrÃ¤ge erfasst werden",
    chartTempNote: "Monatliche Durchschnittstemperatur jedes Lagerhauses",
    yearlyPdfBtn: "PDF drucken",
    yearlyTotalProd: "Gesamtproduktions-Vergleich",
    yearlyTotalProdNote: "Jahresgesamt - Jahr 1 vs Jahr 2 (Portionen)",
    yearlyTotalBen: "Gesamte ErnÃ¤hrungsdienst-Nutzer",
    yearlyTotalBenNote: "Jahresgesamt - Jahr 1 vs Jahr 2 (Gesamtpersonen)",
    yearlyStudentComp: "Studierenden-Nutzervergleich im ErnÃ¤hrungsdienst",
    yearlyStudentNote: "Jahresgesamt - Jahr 1 vs Jahr 2 (Studierende)",
    yearlyWasteComp: "Abfall-Vergleich (kg)",
    yearlyWasteNote: "Jahresgesamt - Jahr 1 vs Jahr 2 (kg)",
    yearlyMonthlyProd: "Monatlicher Produktionsvergleich",
    yearlyMonthlyProdNote: "Jahr 1 vs Jahr 2 - hergestellte Mahlzeiten (Portionen)",
    yearlyMonthlyTurnstile: "Monatlicher Drehkreuz-Vergleich",
    yearlyMonthlyTurnstileNote: "Jahr 1 vs Jahr 2 - Anzahl der DrehkreuzdurchgÃ¤nge",
    yearlyMonthlyStudent: "Monatlicher Studierenden-Drehkreuz-Vergleich",
    yearlyMonthlyStudentNote: "Jahr 1 vs Jahr 2 - Studierende-DrehkreuzdurchgÃ¤nge",
    yearlyMonthlyWaste: "Monatlicher Abfall-Vergleich (kg)",
    yearlyMonthlyWasteNote: "Jahr 1 vs Jahr 2 - Abfallmenge (kg)",
    yearlyWasteListTitle: "JÃ¤hrliche Abfallliste",
    spendingRatesTitle: "Pro-Kopf-Ausgaben (Studierende, Personal & Mahlzeiten)",
    spendingStudentRate: "Studierenden-Ausgaben pro Person (TL)",
    btnSaveStudentRate: "Studierenden-Betrag speichern",
    spendingStaffRate: "Personal-Ausgaben pro Person (TL)",
    btnSaveStaffRate: "Personal-Betrag speichern",
    spendingMealRate: "Mahlzeiten-Ausgaben pro Mahlzeit (TL)",
    btnSaveMealRate: "Mahlzeiten-Betrag speichern",
    spendingDesc: "Studierenden-Ausgaben = Studierendenzahl Ã— Studierenden-Ausgaben pro Person",
    spendingStudentTitle: "Studierenden-Ausgaben (TL)",
    spendingChartEmpty: "Diagramme werden angezeigt, wenn EintrÃ¤ge erfasst werden",
    spendingStudentNote: "Studierenden-Ausgaben (TL) = Studierendenzahl Ã— Studierenden-Ausgaben pro Person",
    spendingStaffTitle: "Personal-Ausgaben (TL)",
    spendingStaffNote: "Personal-Ausgaben (TL) = Personalanzahl Ã— Personal-Ausgaben pro Person",
    spendingMealTitle: "Mahlzeiten-Ausgaben (TL)",
    spendingMealNote: "Mahlzeiten-Ausgaben (TL) = Hergestellte Mahlzeiten Ã— Mahlzeiten-Ausgaben pro Mahlzeit",
    spendingTableTitle: "Ausgabenberechnungstabelle",
    syncTitle: "Supabase-Synchronisierung",
    syncCloseBtn: "SchlieÃŸen",
    modalNewRecord: "Neuen Eintrag hinzufÃ¼gen",
    formDate: "Datum",
    formProducedCount: "Anzahl hergestellter Mahlzeiten",
    formTurnstileCount: "Anzahl der DrehkreuzdurchgÃ¤nge",
    formStudentCount: "Anzahl der Studierenden",
    formFoodType: "Essenstyp",
    formAutoCalc: "Automatische Berechnungen",
    badgeAutomatic: "Automatisch",
    badgeFixed: "Fest",
    badgeAutoEditable: "Automatisch + Bearbeitbar",
    btnCancel: "Abbrechen",
    entryFormSubmit: "Speichern",
    formReceiptNo: "Belegnummer",
    formOilType: "Ã–ltyp",
    formAmountLt: "Menge (Liter)",
    formNote: "Notiz",
    formWasteType: "Abfalltyp",
    formAmount: "Menge",
    formDeviceName: "GerÃ¤tename",
    formBrandModel: "Marke-Modell",
    formSerialNo: "Seriennummer",
    formStatus: "Status",
    formVerification: "Eichung",
    formLastCalibration: "Letzte Kalibrierung",
    formNextCalibration: "NÃ¤chste Kalibrierung",
    formLocation: "Standort/Abteilung",
    formResponsible: "Verantwortliche Person",
    btnSave: "Speichern",
    btnAdd: "HinzufÃ¼gen",
    btnClose: "SchlieÃŸen",
    qrTitle: "QR-Code",
    qrHint: "Drucken Sie den QR-Code fÃ¼r die LagerhaustÃ¼ren aus.",
    adminTitle: "Verwaltungspanel",
    adminReAuthText: "Bitte geben Sie Ihr Admin-Passwort ein, um auf das Verwaltungspanel zuzugreifen.",
    adminPassword: "Admin-Passwort",
    btnVerify: "ÃœberprÃ¼fen",
    adminSessionRole: "Sitzungsrolle",
    adminLastLogin: "Letzte Anmeldung",
    adminAuthMethod: "Auth-Methode",
    adminStorage: "Passwortspeicher",
    adminDataSource: "Datenquelle",
    adminUserMgmt: "Benutzerverwaltung",
    adminUserMgmtDesc: "Benutzer hinzufÃ¼gen, bearbeiten oder lÃ¶schen.",
    adminAddUser: "Neuen Benutzer hinzufÃ¼gen",
    adminUsername: "Benutzername",
    adminDisplayName: "Anzeigename",
    adminPasswordLabel: "Passwort",
    adminRole: "Rolle",
    adminAddUserBtn: "Benutzer hinzufÃ¼gen",
    adminRolePerms: "Rollenbasierte Berechtigungseinstellungen",
    adminRolePermsDesc: "Legen Sie fest, welche Registerkarten jede Rolle sehen kann.",
    adminSecurity: "Sitzungssicherheit",
    adminSecurityDesc: "Die Sitzung wird geschlossen, wenn innerhalb des angegebenen Zeitraums keine AktivitÃ¤t erfolgt.",
    adminInactivityTimeout: "InaktivitÃ¤ts-Timeout",
    adminLogsTitle: "AktivitÃ¤tsprotokolle",
    adminLogsDesc: "Benutzeran/-abmeldungen und Eintragsoperationen",
    btnRefresh: "Aktualisieren",
    adminSaveBtn: "Einstellungen speichern",
    adminFooterNote: "PasswÃ¶rter werden dauerhaft auf dem Server gespeichert.",
    adminCloseBtn: "SchlieÃŸen",
    logFilterDelete: "LÃ¶schen",
    logFilterAddUser: "Benutzer hinzufÃ¼gen",
    logFilterDeleteUser: "Benutzer lÃ¶schen",
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
    compTurnstilePasses: "DrehkreuzdurchgÃ¤nge",
    compStudentCount: "Anzahl Studenten",
    compWastePerPerson: "Abfall pro Person (g)",
    monthlyCompDesc: "Vergleich dieses Monats mit dem Vormonat. â†‘ Anstieg, â†“ RÃ¼ckgang. Ein RÃ¼ckgang (â†“) bei Abfall und Abfall pro Person ist gut.",
    yearlyCompDesc: "Vergleich dieses Jahres (Jahresbilanz) mit demselben Zeitraum des Vorjahres. â†‘ Anstieg, â†“ RÃ¼ckgang. Ein RÃ¼ckgang (â†“) bei Abfall und Abfall pro Person ist gut.",
    monthNames: ["Januar","Februar","MÃ¤rz","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"],
    haccpColDate: "Datum",
    haccpColTime: "Uhrzeit",
    haccpColDepot: "Lagername",
    haccpColTemp: "Temperatur (Â°C)",
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
    total: "Gesamt",
    inVarieties: "Sorten",
    person: "Pers.",
    weeklyGrandTotal: "WÃ¶chentliche Gesamtsumme",
    dailyAverage: "Tagesdurchschnitt",
    avgPerPerson: "Durchschnitt pro Person",
    totalPersonDays: "Gesamt Personen/Tage",
    colDay: "Tag",
    colDate: "Datum",
    colPerson: "Pers.",
    dailyMaterialCost: "TÃ¤gliche Materialkosten",
    perPerson: "Pro Person",
    ingredients: "Zutaten",
    perPersonGram: "(Gramm pro Person)",
    colIngredient: "Zutat",
    colPerPerson: "/Pers.",
    colUnit: "Einheit",
    addIngredient: "+ Zutat hinzufÃ¼gen",
    foodName: "Gerichtname",
    allergen: "Allergen",
    recipePerPerson: "Rezept (pro Person)",
    devices: "GerÃ¤te",
    chartMonthlyProduction: "Monatliche Produktion (pax)",
    chartMonthlyPasses: "Monatliche Durchgänge (pax)",
    chartLastYearWaste: "Vorjahr Verschwendetes (Portionen)",
    chartMonthlyWasteKg: "Monatliche Abfälle (kg)",
    chartMonthlyMealCount: "Monatliche Mahlzeitenanzahl",
    chartMonthlyWasteRate: "Monatliche Abfallrate %",
    chartMonthlyStudent: "Monatliche Schüleranzahl",
    chartWastePerPersonLabel: "Abfall pro Person (kg/Person)",
    maliTablo: "Finanztabelle",
    maliTabloSubtitle: "WÃ¶chentliche Materialkosten-Zusammenfassung",
    maliUnitPriceMissing: "Material-Einheitspreis nicht definiert",
    maliUnitPriceHint: "Sie kÃ¶nnen im Tab Einheitspreise festlegen",
    weeklyTotal: "WÃ–CHENTLICHE GESAMTSUMME",
    categoryDistribution: "Kategorieverteilung",
    weeklyTotalList: "WÃ¶chentliche Gesamtbedarfsliste",
    totalCost: "Gesamtkosten",
    catMeat: "Fleischprodukte",
    catDairy: "Milchprodukte",
    catLegumes: "Trockenleguminosen",
    catSpices: "GewÃ¼rze",
    catVegetable: "GemÃ¼se & Obst",
    catOther: "Sonstiges",
    month1: "Januar", month2: "Februar", month3: "MÃ¤rz", month4: "April",
    month5: "Mai", month6: "Juni", month7: "Juli", month8: "August",
    month9: "September", month10: "Oktober", month11: "November", month12: "Dezember",
    menuListTitle: "MENÃœLISTE",
    totalDevices: "GerÃ¤te Gesamt",
    statusWorking: "FunktionsfÃ¤hig",
    statusDefective: "Defekt",
    statusMaintenance: "Wartung erforderlich",
    statusScrap: "Zur Verschrottung",
    calibrationValid: "Kalibrierung gÃ¼ltig",
    calibrationApproaching: "Kalibrierung naht (30 Tage)",
    differentDepartments: "Verschiedene Abteilungen",
    statusApproaching: "NÃ¤hert sich",
    statusExpired: "Abgelaufen",
    statusNotDone: "Nicht durchgefÃ¼hrt",
    statusValid: "GÃ¼ltig",
    noDeviceFound: "Keine GerÃ¤te gefunden, die diesen Filterkriterien entsprechen.",
    noDeviceRecord: "Es wurden noch keine KalibrierungsgerÃ¤te erfasst.",
    deviceCount: "GerÃ¤te",
    deviceCountSuffix: " GerÃ¤te",
    editDeviceTitle: "KalibrierungsgerÃ¤t bearbeiten",
    newDeviceTitle: "Neues KalibrierungsgerÃ¤t",
    kpiBeneficiary: "Bereich: ",
    kpiNoRecordToday: "Kein Eintrag heute",
    kpiAlertsCount: "Warnungen",
    kpiAllValuesOk: "Alle Werte sind OK",
    kpiDeviceInAlarm: "GerÃ¤te im Alarm",
    kpiApproaching: "nÃ¤hert sich",
    kpiAllCalibrationsValid: "Alle Kalibrierungen sind gÃ¼ltig",
    filterAll: "Alle",
    colDeviceName: "GerÃ¤tename",
    colBrandModel: "Marke-Modell",
    colSerialNo: "Seriennummer",
    colDeviceStatus: "GerÃ¤testatus",
    colCalibration: "Kalibrierung",
    colLastCalibration: "Letzte Kalibrierung",
    colNextCalibration: "NÃ¤chste",
    colDepartment: "Abteilung",
    colResponsible: "Verantwortlich",
    colNote: "Notiz",
    colAction: "Aktion",
    unitPriceList: "Einheitspreisliste",
    registeredProducts: "Registrierte Produkte",
    totalAmount: "Gesamtbetrag",
    avgUnitPrice: "Durchschnittlicher Einheitspreis",
    selectedYear: "AusgewÃ¤hltes Jahr",
    duplicateWarning: "Produkte mit doppelten EintrÃ¤gen gefunden. Preisberechnungen kÃ¶nnen Fehler enthalten.",
    cleanDuplicates: "Einzeln bereinigen",
    colProductName: "Produktname",
    colUnit: "Einheit",
    colUnitPrice: "Einheitspreis (â‚º)",
    colUnitEquals: "1 Einheit =",
    colYear: "Jahr",
    noProductsThisYear: "FÃ¼r dieses Jahr wurden noch keine Produkte hinzugefÃ¼gt.",
    btnEdit: "Bearbeiten",
    btnDelete: "LÃ¶schen",
    pageLabel: "Seite",
    totalProductsLabel: "Gesamt",
    totalProductsSuffix: " Produkte",
    priceYearNote: "Preise sind jahresbezogen. Zuordnung: Materialname wird automatisch normalisiert.",
    btnAddNewProduct: "+ Neues Produkt",
    btnDownloadCSV: "CSV Herunterladen",
    btnPrint: "Drucken",
    btnUploadCSV: "CSV Hochladen",
    clickToSelectYear: "Klicken zum AuswÃ¤hlen",
    selectYear: "Jahr auswÃ¤hlen",
    dataInfoRecord: "EintrÃ¤ge",
    dataInfoProduction: "Produktion",
    dataInfoWaste: "Abfall",
    portion: "Portionen",
    abnormalDays: "anormale Tage",
    noRecordsToDisplay: "Keine EintrÃ¤ge zum Anzeigen.",
    colYearLabel: "Jahr",
    avgPortion400: "400 g",
    recordsNot400: "EintrÃ¤ge nicht 400",
    gram: " g",
    personLabel: "Person",
    last7RecordsPrev7: "letzte 7 EintrÃ¤ge / vorherige 7",
    tempAppropriate: "Angemessen",
    tempLow: "Niedrig",
    tempHigh: "Hoch",
    lowerLimit: "Untergrenze: ",
    upperLimit: "Obergrenze: ",
    unknownDepo: "Unbekannt",
    tempMin: "Min: ",
    tempAvg: "Std: ",
    tempMax: "Max: ",
    humidity: "Feuchtigkeit: ",
    depot: "Lager",
    selectedCount: " ausgewÃ¤hlt",
    pageRecords: "Seite ",
    recordCount: " EintrÃ¤ge)",
    tempRecordsTitle: "KÃ¼hllager-Temperaturaufzeichnungen",
    dateRangeLabel: " | Datum:",
    allDepots: "Alle Lager",
    colTime: "Zeit",
    colDepot: "Lager",
    colTemperature: "Temperatur",
    colStatus: "Status",
    depotTempRecordTitle: "Lager-Temperaturaufzeichnung",
    formDate: "Datum",
    formTime: "Zeit",
    formDepotName: "Lagername",
    formTemperature: "Temperatur (Â°C)",
    tempPlaceholder: "0.0 (kann leer gelassen werden)",
    formHumidity: "Feuchtigkeit (%)",
    formNoteOptional: "Optional",
    deleteConfirm: "Sind Sie sicher, dass Sie diesen Eintrag lÃ¶schen mÃ¶chten?",
    deleteSelectedConfirm: "Sind Sie sicher, dass Sie ",
    deleteSelectedConfirmSuffix: " ausgewÃ¤hlte EintrÃ¤ge lÃ¶schen mÃ¶chten?",
    tempHistory: " Temperaturverlauf",
    weeklyAvgTempNote: "WÃ¶chentliche Durchschnittstemperaturwerte â€” mit Unter- und Obergrenzlinien",
    upperLimitLabel: "Obergrenze (",
    lowerLimitLabel: "Untergrenze (",
    totalRecordCount: "GesamteintrÃ¤ge",
    totalWasteOil: "Gesamt AltÃ¶l",
    avgAmountPerRecord: "Std. Menge / Eintrag",
    highestAmount: "HÃ¶chste Menge",
    lowestAmount: "Niedrigste Menge",
    oilTypeCount: "Ã–ltyp-Anzahl",
    yearTotalSuffix: " Gesamt",
    startDate: "Anfang",
    endDate: "Ende",
    typeLabel: "Typ: ",
    yearLabel: "Jahr: ",
    activeFilterLabel: "Aktiver Filter: ",
    noFilterMessage: "Kein Filter â€” alle AltÃ¶laufzeichnungen werden angezeigt.",
    noWasteOilRecord: "Noch keine AltÃ¶laufzeichnungen eingegeben.",
    noMatchingFilterRecord: "Keine EintrÃ¤ge gefunden, die diesen Filterkriterien entsprechen.",
    editWasteOilRecord: "AltÃ¶laufzeichnung bearbeiten",
    newWasteOilRecord: "Neue AltÃ¶laufzeichnung",
    wasteOilChartLabel: "AltÃ¶l",
    previousYearLabel: "Vorheriges Jahr",
    undefinedType: "Nicht spezifiziert",
    totalWastePackaging: "Gesamt Verpackungsabfall",
    wasteTypeCount: "Abfalltyp-Anzahl",
    noWastePackagingRecord: "Noch keine Verpackungsabfallaufzeichnungen eingegeben.",
    noMatchingFilterPackage: "Keine EintrÃ¤ge gefunden, die diesen Filterkriterien entsprechen.",
    noFilterMessagePackaging: "Kein Filter â€” alle Verpackungsabfallaufzeichnungen werden angezeigt.",
    editWastePackagingRecord: "Verpackungsabfallaufzeichnung bearbeiten",
    newWastePackagingRecord: "Neue Verpackungsabfallaufzeichnung",
    wastePackagingChartLabel: "Verpackungsabfall",
    chartDetailEmpty: "Keine EintrÃ¤ge fÃ¼r diesen Zeitraum gefunden.",
    chartClose: "SchlieÃŸen",
    chartColProduction: "Produktion",
    chartColPasses: "DurchgÃ¤nge",
    chartColWaste: "Abfall",
    chartColStudent: "Studenten",
    chartColFoodType: "Gerichtart",
    chartProductionVsTurnstile: "Differenz zwischen Produktion und DrehkreuzdurchgÃ¤ngen",
    chartStaffTotal: "Akademisches + Verwaltungspersonal + SKS",
    yearFilterLabel: "Jahr:",
    monthFilterLabel: "Monat:",
    chartSelectYear: "AuswÃ¤hlen",
    year1Label: "Jahr 1:",
    year2Label: "Jahr 2:",
    noComparison: "Kein Vergleich",
    newLabel: "Neu",
    foodTypeLabel: "Gerichtart",
    productionLabel: " Produktion",
    wasteKgLabel: " Abfall (kg)",
    wasteGrPortionLabel: " Abfall (g/Portion)",
    diffKgLabel: "Differenz (kg)",
    totalRow: "GESAMT",
    registeredRate: "Gespeicherter Satz: ",
    unsavedChanges: " (ungespeicherte Ã„nderungen)",
    kpiTotalStudentSpending: "Gesamte Studentenausgaben",
    kpiTotalStaffSpending: "Gesamte Personalausgaben",
    kpiAvgMonthlyStudentSpending: "Std. monatl. Studentenausgaben",
    kpiAvgMonthlyStaffSpending: "Std. monatl. Personalausgaben",
    kpiTotalStudents: "Gesamt Studenten",
    kpiTotalStaff: "Gesamt Personal",
    kpiHighestStudentMonth: "HÃ¶chster Studentenmonat",
    kpiHighestStaffMonth: "HÃ¶chster Personalmonat",
    kpiTotalMealSpending: "Gesamte Essensausgaben",
    kpiAvgMonthlyMealSpending: "Std. monatl. Essensausgaben",
    kpiTotalMealsProduced: "Gesamt produzierte Mahlzeiten",
    kpiHighestMealMonth: "HÃ¶chster Mahlzeitenmonat",
    chartStudentSpending: "Studentenausgaben (â‚º)",
    chartStaffSpending: "Personalausgaben (â‚º)",
    chartMealSpending: "Essensausgaben (â‚º)",
    noRecordsYet: "Noch keine EintrÃ¤ge.",
    invalidRate: "Bitte geben Sie einen gÃ¼ltigen Satz ein!",
    rateSaved: "Satz gespeichert: ",
    menuStatusDraft: "Entwurf",
    menuStatusPending: "Genehmigung ausstehend",
    menuStatusApproved: "Genehmigt",
    menuStatusRejected: "Abgelehnt",
    menuApprove: "MenÃ¼ genehmigen",
    menuApproveDisabled: "MenÃ¼ wurde noch nicht zur Genehmigung eingereicht. Wenn der DiÃ¤tarzt auf 'Zur Genehmigung einreichen' klickt, kÃ¶nnen Sie hier genehmigen.",
    menuReject: "MenÃ¼ mit BegrÃ¼ndung ablehnen",
    menuRejectDisabled: "MenÃ¼ wurde noch nicht zur Genehmigung eingereicht. Wenn der DiÃ¤tarzt auf 'Zur Genehmigung einreichen' klickt, kÃ¶nnen Sie hier ablehnen.",
    menuPendingCount: " WochenmenÃ¼s warten auf Genehmigung. Sie kÃ¶nnen zur ausstehenden Woche wechseln und genehmigen.",
    menuNotApproved: "Das MenÃ¼ dieser Woche wurde vom Lebensmittelingenieur noch nicht genehmigt.",
    menuRejected: "Dieses MenÃ¼ wurde abgelehnt",
    menuRejectedSuffix: ". Der DiÃ¤tarzt kann korrigieren und erneut einreichen.",
    menuAwaitingApproval: "Dieses MenÃ¼ wartet auf Genehmigung. Ohne Genehmigung wird es in der Produktionsliste als 'ungenehmigt' markiert.",
    noteLabel: "Notiz ",
    deleteNote: "Diese Notiz lÃ¶schen",
    addNote: "Neue Notiz hinzufÃ¼gen",
    mealPickerTitle: "Gericht auswÃ¤hlen",
    clearLabel: "ğŸ—‘ LÃ¶schen",
    searchMealPlaceholder: "Gericht suchen...",
    noMatchingMeal: "Kein passendes Gericht gefunden.",
    varietyLabel: " Sorte: ",
    addRecord: "Neuen Eintrag hinzufÃ¼gen",
    editRecord: "Eintrag bearbeiten",
    btnUpdate: "Aktualisieren",
    recordAdded: "Eintrag erfolgreich hinzugefÃ¼gt.",
    recordUpdated: "Eintrag erfolgreich aktualisiert.",
    recordDeleted: "Eintrag gelÃ¶scht.",
    allRecordsDeleted: "Alle EintrÃ¤ge gelÃ¶scht.",
    selectedRecordsDeleted: "AusgewÃ¤hlte EintrÃ¤ge gelÃ¶scht.",
    noRecordToDelete: "Keine EintrÃ¤ge zum LÃ¶schen.",
    noSelectedRecord: "Keine EintrÃ¤ge ausgewÃ¤hlt.",
    deleteAllConfirm: "Sind Sie sicher, dass Sie ALLE EintrÃ¤ge lÃ¶schen mÃ¶chten?\nDiese Aktion kann nicht rÃ¼ckgÃ¤ngig gemacht werden!",
    deleteFoodConfirm: "Sind Sie sicher, dass Sie dieses Gericht lÃ¶schen mÃ¶chten?",
    selected: " ausgewÃ¤hlt",
    negMeals: "Die Anzahl der zubereiteten Mahlzeiten kann nicht negativ sein.",
    negTurnstile: "Die Drehkreuzanzahl kann nicht negativ sein.",
    negStaff: "Die Personalanzahl kann nicht negativ sein.",
    negPortion: "Die Portionsmenge kann nicht negativ sein.",
    negStudent: "Die Studentenanzahl kann nicht negativ sein.",
    unsavedConfirm: "Es gibt nicht gespeicherte Ã„nderungen. MÃ¶chten Sie wirklich schlieÃŸen?",
    selectUser: "Bitte wÃ¤hlen Sie einen Benutzer.",
    wrongCredentials: "Falscher Benutzername oder Passwort.",
    tooManyAttempts: "Zu viele Versuche. Bitte warten.",
    editable: "Bearbeitbar",
    fixed: "Fest",
    menuSentForApproval: "MenÃ¼ zur Genehmigung eingereicht. Warten auf Genehmigung durch Lebensmitteltechniker/Admin.",
    menuApproved: "MenÃ¼ genehmigt.",
    menuRejectedMsg: "MenÃ¼ mit BegrÃ¼ndung abgelehnt.",
    menuDraftSaved: "MenÃ¼ als Entwurf gespeichert.",
    menuCleared: "MenÃ¼ geleert.",
    monthShort1: "Jan",
    monthShort2: "Feb",
    monthShort3: "MÃ¤r",
    monthShort4: "Apr",
    monthShort5: "Mai",
    monthShort6: "Jun",
    monthShort7: "Jul",
    monthShort8: "Aug",
    monthShort9: "Sep",
    monthShort10: "Okt",
    monthShort11: "Nov",
    monthShort12: "Dez"
  },
  fr: {
    loginSub: "SYSTÃˆME DE GESTION DES SERVICES DE RESTAURATION",
    loginFormSub: "Connexion",
    loginUsername: "Nom d'utilisateur",
    loginSelectUser: "SÃ©lectionner l'utilisateur",
    loginPassword: "Mot de passe",
    loginBtn: "Se connecter",
    loginHint: "Vous pouvez obtenir votre mot de passe auprÃ¨s de votre administrateur",
    loginFeature1: "Planification du menu, production quotidienne, consommation et dÃ©chets",
    loginFeature2: "Rapports dÃ©taillÃ©s",
    loginFeature3: "Tableau de bord en direct et graphiques",
    menuLabel: "Menu",
    headerSubtitle: "SystÃ¨me de gestion des services de nutrition",
    btnLogout: "DÃ©connexion",
    btnPrev: "PrÃ©cÃ©dent",
    btnNext: "Suivant",
    loading: "Chargement...",
    loadingText: "Synchronisation des donnÃ©es...",
    loadingSub: "VÃ©rification de la connexion Supabase",
    loadingSkip: "Cliquez pour ignorer",
    versionLabel: "Version de l'application",
    sidebarPanel: "Tableau de bord",
    sidebarMenu: "Menu hebdomadaire",
    sidebarRecords: "Enregistrements",
    sidebarReport: "Rapport",
    sidebarHaccp: "SÃ©curitÃ© alimentaire",
    sidebarCalibration: "Calibration",
    sidebarOil: "Huile usagÃ©e",
    sidebarPackaging: "DÃ©chets d'emballage",
    sidebarCharts: "Graphiques",
    sidebarYearly: "Comparaison annuelle",
    sidebarSpending: "DÃ©penses",
    sidebarUnitPrice: "Prix unitaires",
    sidebarDownload: "Tout tÃ©lÃ©charger",
    sidebarBackup: "Sauvegarder sur Supabase",
    sidebarRestore: "Restaurer depuis Supabase",
    sidebarAdmin: "Administration",
    sidebarLogs: "Journaux",
    sidebarTheme: "ThÃ¨me",
    sidebarManual: "Manuel utilisateur",
    dashboardPrintPdf: "Imprimer PDF",
    kpiTotalRecords: "Total des jours de production",
    kpiTodayProduction: "Production du jour",
    kpiHaccpAlarm: "Alarme tempÃ©rature chambre froide",
    kpiCalibrationAlarm: "Alarme de calibration",
    kpiAvgWaste: "DÃ©chets moyens (kg)",
    kpiTotalPasses: "Total des passages au tourniquet",
    kpiTotalWaste: "Total des dÃ©chets (kg)",
    kpiWasteRate: "Taux de dÃ©chets",
    weeklyPrevBtn: "Semaine prÃ©cÃ©dente",
    weeklySummary: "RÃ©sumÃ© hebdomadaire",
    weeklyNextBtn: "Semaine suivante",
    weeklyBadge: "Cette semaine",
    dailyPrevBtn: "Jour prÃ©cÃ©dent",
    dailySummary: "DÃ©tail quotidien",
    dailyNextBtn: "Jour suivant",
    weeklyCompTitle: "Comparaison hebdomadaire",
    monthlyCompTitle: "Comparaison mensuelle",
    monthlyBadge: "Ce mois-ci",
    yearlyBadge: "Cette annÃ©e",
    anomalyTitle: "DÃ©tection d'anomalies",
    anomalyBadge: "Jours de dÃ©chets anormaux",
    lastRecordsTitle: "Derniers enregistrements",
    dashboardGoToRecords: "Aller aux enregistrements",
    emptyDashboard: "Pas encore d'enregistrements...",
    formulaTitle: "FORMULE DE CALCUL DES DÃ‰CHETS",
    recordsEntryBtn: "Saisir production/consommation",
    recordsImportBtn: "Importer",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "TÃ©lÃ©charger CSV",
    recordsDeleteBtn: "Supprimer la sÃ©lection",
    emptyRecords: "Aucun enregistrement trouvÃ©.",
    thDate: "Date",
    thProducedPerson: "Repas produits (Personne)",
    thWaste10: "10% de dÃ©chets",
    thBeneficiary: "BÃ©nÃ©ficiaires du service de restauration",
    thPortionGr: "Portion (g)",
    thWasteKg: "DÃ©chets (kg)",
    thWastedPortion: "JetÃ©e (portion)",
    thFoodType: "Type de plat",
    thAction: "Action",
    thAcademicStaff: "Personnel acadÃ©mique & administratif via tourniquet",
    thStudentCount: "Ã‰tudiants via tourniquet",
    thBeneficiaryTotal: "Total des bÃ©nÃ©ficiaires du service de restauration",
    sksStaff: "Personnel SKS restauration",
    summaryReport: "Rapport de synthÃ¨se",
    reportPdfBtn: "Ouvrir PDF",
    allRecordsPrint: "Tous les enregistrements (Vue d'impression)",
    rTotalRecords: "Nombre total d'enregistrements",
    rTotalMeals: "Total des repas produits",
    rTotalWaste10: "Total des dÃ©chets 10%",
    rTotalAfterWaste: "Total des repas aprÃ¨s 10% de dÃ©chets",
    rTotalTurnstile: "Total des passages au tourniquet",
    rTotalBeneficiary: "Total des bÃ©nÃ©ficiaires du service de restauration",
    rTotalStaff: "Total du personnel SKS bÃ©nÃ©ficiaire",
    rPortionSize: "Taille de la portion (g)",
    rTotalPortion: "Total des portions (g)",
    rWastedPortion: "Portions jetÃ©es",
    rMaxWeeklyBeneficiary: "Nombre maximum de bÃ©nÃ©ficiaires hebdomadaire",
    rTotalWasteKg: "QuantitÃ© totale de dÃ©chets (kg)",
    rAvgWasteKg: "QuantitÃ© moyenne de dÃ©chets (kg)",
    rTotalStudents: "Nombre total d'Ã©tudiants",
    rMaxWaste: "DÃ©chets maximum (kg)",
    rMinWaste: "DÃ©chets minimum (kg)",
    rWasteTrend: "Tendance des dÃ©chets (7 derniers jours)",
    rBeneficiaryTrend: "Tendance des bÃ©nÃ©ficiaires (7 derniers jours)",
    wasteByFoodTitle: "Analyse des dÃ©chets par type de plat",
    wasteByFoodEmpty: "Aucun enregistrement avec des donnÃ©es de type de plat trouvÃ©.",
    wasteByFoodRecords: "Nombre d'enreg.",
    wasteByFoodRate: "Taux de dÃ©chets",
    wasteByFoodPerPerson: "DÃ©chets par personne (kg)",
    wsProducedMeal: "Repas produits (pers.)",
    wsTotalPasses: "Total des passages",
    wsTurnstile: "Tourniquet",
    wsStaffSKS: "Personnel restauration",
    wsWasteAmount: "QuantitÃ© de dÃ©chets",
    wsWastedPortion: "JetÃ©",
    wsStudents: "Ã‰tudiants nutrition",
    wsNoRecordsYet: "Aucun enregistrement",
    wsNoRecordThisWeek: "Aucun enreg. cette semaine",
    wsNoRecordToday: "Aucun enreg.",
    wsTodayDetail: "DÃ©tails du jour",
    wsDailyDetail: "DÃ©tails quotidiens",
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
    menuFoodListUploadBtn: "TÃ©lÃ©verser CSV",
    menuFoodListCsvBtn: "TÃ©lÃ©charger CSV",
    menuWarningPrefix: "Menu non approuvÃ© :",
    menuWarningText: "Le menu de cette semaine n'a pas encore Ã©tÃ© approuvÃ© par le nutritionniste.",
    menuHintText: "Tapez les noms des plats...",
    productNeedsTitle: "Liste des besoins en produits",
    weeklyNeedsTitle: "Liste hebdomadaire des besoins totaux",
    foodListTitle: "Liste des plats",
    modalRejectMenu: "Rejeter le menu",
    modalRejectDesc: "Le motif de rejet est obligatoire.",
    menuRejectConfirm: "Rejeter",
    haccpTitle: "Gestion de la sÃ©curitÃ© alimentaire",
    haccpCsvBtn: "TÃ©lÃ©charger CSV",
    haccpColdStorage: "Enregistrements de tempÃ©rature chambre froide",
    haccpNewBtn: "Nouvel enregistrement",
    haccpDepotBtn: "Noms des dÃ©pÃ´ts",
    haccpDepoQrNote: "Vous pouvez modifier les noms des dÃ©pÃ´ts et gÃ©nÃ©rer des codes QR pour chaque dÃ©pÃ´t avec le bouton QR.",
    haccpModalTitle: "Nouvel enregistrement",
    filterDepot: "Filtre de dÃ©pÃ´t :",
    filterAll: "Tous",
    filterDateRange: "PÃ©riode :",
    emptyHaccp: "Aucun enregistrement de tempÃ©rature saisi.",
    btnDeleteSelectedHaccp: "Supprimer la sÃ©lection",
    btnPdf: "PDF",
    depoNamesTitle: "Noms des dÃ©pÃ´ts",
    oilNewBtn: "Nouvel enregistrement",
    oilListBtn: "Liste",
    oilFilterTitle: "Filtres huile usagÃ©e",
    filterOilType: "Type d'huile :",
    btnReset: "RÃ©initialiser",
    oilSummaryTitle: "RÃ©sumÃ© des huiles usagÃ©es",
    oilChartTitle: "Graphiques des huiles usagÃ©es",
    oilChartSubtitle: "QuantitÃ© mensuelle d'huile usagÃ©e (litres)",
    oilChartEmpty: "Les graphiques apparaÃ®tront lorsque des enregistrements d'huile usagÃ©e seront saisis",
    oilChartNote: "Totaux mensuels d'huile usagÃ©e par date, type d'huile et filtres d'annÃ©e",
    oilRecordsTitle: "Enregistrements d'huile usagÃ©e",
    oilModalTitle: "Enregistrement d'huile usagÃ©e",
    emptyOil: "Aucun enregistrement d'huile usagÃ©e saisi.",
    ambalajNewBtn: "Nouvel enregistrement",
    ambalajListBtn: "Liste",
    packagingFilterTitle: "Filtres dÃ©chets d'emballage",
    filterWasteType: "Type de dÃ©chet :",
    packagingSummaryTitle: "RÃ©sumÃ© des dÃ©chets d'emballage",
    packagingChartTitle: "Graphiques des dÃ©chets d'emballage",
    packagingChartSubtitle: "QuantitÃ© mensuelle de dÃ©chets d'emballage (kg)",
    packagingChartEmpty: "Les graphiques apparaÃ®tront lorsque des enregistrements de dÃ©chets d'emballage seront saisis",
    packagingChartNote: "Totaux mensuels de dÃ©chets d'emballage par date, type de dÃ©chet et filtres d'annÃ©e (kg)",
    packagingRecordsTitle: "Enregistrements de dÃ©chets d'emballage",
    packagingModalTitle: "Enregistrement de dÃ©chets d'emballage",
    emptyPackaging: "Aucun enregistrement de dÃ©chets d'emballage saisi.",
    kalibrasyonNewBtn: "Nouvel appareil",
    kalibrasyonListBtn: "Liste",
    kalibrasyonCsvBtn: "TÃ©lÃ©charger CSV",
    calibrationSummary: "RÃ©sumÃ© de la calibration",
    calibrationDevices: "Appareils soumis Ã  la calibration",
    calibrationModalTitle: "Appareil pour calibration",
    filterStatus: "Statut :",
    filterDepartment: "DÃ©partement :",
    btnWordExport: "Exporter vers Word",
    btnPrint: "Imprimer PDF",
    chartProdWaste: "Comparaison Production - Passages - DÃ©chets",
    chartEmpty: "Les graphiques apparaÃ®tront lorsque des donnÃ©es seront saisies",
    chartProdWasteNote: "Comparaison mensuelle de la production, des passages au tourniquet et des portions jetÃ©es",
    chartStudentCount: "Nombre d'Ã©tudiants utilisant le service de restauration",
    yearTotal: "Total annuel",
    chartStudentNote: "Total mensuel des passages Ã©tudiants quotidiens",
    chartStaffTotal: "Total personnel acadÃ©mique & administratif + SKS",
    chartStaffNote: "Total du personnel acadÃ©mique & administratif (Tourniquet - Ã‰tudiants) et du personnel SKS restauration",
    chartMonthlyProd: "Production mensuelle de repas",
    chartMonthlyProdNote: "Total mensuel du nombre de repas produits quotidiennement",
    chartMonthlyTurnstile: "Passages mensuels au tourniquet",
    chartTurnstileNote: "Total Ã©tudiants + personnel + passages externes",
    chartMonthlyWaste: "QuantitÃ© mensuelle de dÃ©chets (kg)",
    chartMonthlyWasteNote: "Total mensuel des dÃ©chets quotidiens (kg)",
    chartMonthlyWastePortion: "QuantitÃ© mensuelle de dÃ©chets (portions)",
    chartWastePortionNote: "Total mensuel des portions jetÃ©es quotidiennement",
    chartDiff: "DiffÃ©rence entre production et passages",
    chartDiffNote: "DiffÃ©rence entre repas produits et passages au tourniquet",
    chartWasteRatio: "DÃ©chets % des repas produits",
    yearAverage: "Moyenne annuelle",
    chartWasteRatioNote: "Pourcentage des repas produits qui deviennent des dÃ©chets",
    chartWastePerPerson: "DÃ©chets par personne (kg/personne)",
    chartWastePerPersonNote: "DÃ©chets moyens par personne entrant dans la cantine",
    chartMonthlyTemp: "TempÃ©ratures moyennes mensuelles des dÃ©pÃ´ts (Â°C)",
    chartTempEmpty: "Les graphiques apparaÃ®tront lorsque des enregistrements de tempÃ©rature seront saisis",
    chartTempNote: "TempÃ©rature moyenne mensuelle de chaque dÃ©pÃ´t",
    yearlyPdfBtn: "Imprimer PDF",
    yearlyTotalProd: "Comparaison de la production totale",
    yearlyTotalProdNote: "Total annuel - AnnÃ©e 1 vs AnnÃ©e 2 (portions)",
    yearlyTotalBen: "Total des bÃ©nÃ©ficiaires du service de restauration",
    yearlyTotalBenNote: "Total annuel - AnnÃ©e 1 vs AnnÃ©e 2 (total personnes)",
    yearlyStudentComp: "Comparaison des Ã©tudiants bÃ©nÃ©ficiaires",
    yearlyStudentNote: "Total annuel - AnnÃ©e 1 vs AnnÃ©e 2 (Ã©tudiants)",
    yearlyWasteComp: "Comparaison des dÃ©chets (kg)",
    yearlyWasteNote: "Total annuel - AnnÃ©e 1 vs AnnÃ©e 2 (kg)",
    yearlyMonthlyProd: "Comparaison mensuelle de la production",
    yearlyMonthlyProdNote: "AnnÃ©e 1 vs AnnÃ©e 2 - repas produits (portions)",
    yearlyMonthlyTurnstile: "Comparaison mensuelle des passages au tourniquet",
    yearlyMonthlyTurnstileNote: "AnnÃ©e 1 vs AnnÃ©e 2 - nombre de passages au tourniquet",
    yearlyMonthlyStudent: "Comparaison mensuelle des passages Ã©tudiants",
    yearlyMonthlyStudentNote: "AnnÃ©e 1 vs AnnÃ©e 2 - nombre de passages Ã©tudiants",
    yearlyMonthlyWaste: "Comparaison mensuelle des dÃ©chets (kg)",
    yearlyMonthlyWasteNote: "AnnÃ©e 1 vs AnnÃ©e 2 - quantitÃ© de dÃ©chets (kg)",
    yearlyWasteListTitle: "Liste annuelle des dÃ©chets",
    spendingRatesTitle: "Taux de dÃ©penses par personne (Ã‰tudiants, Personnel & Repas)",
    spendingStudentRate: "Montant de dÃ©pense par Ã©tudiant (TL)",
    btnSaveStudentRate: "Enregistrer montant Ã©tudiants",
    spendingStaffRate: "Montant de dÃ©pense par membre du personnel (TL)",
    btnSaveStaffRate: "Enregistrer montant personnel",
    spendingMealRate: "Montant de dÃ©pense par repas (TL)",
    btnSaveMealRate: "Enregistrer montant repas",
    spendingDesc: "DÃ©penses Ã©tudiants = Nombre d'Ã©tudiants Ã— Montant par Ã©tudiant",
    spendingStudentTitle: "DÃ©penses Ã©tudiants (TL)",
    spendingChartEmpty: "Les graphiques apparaÃ®tront lorsque des enregistrements seront saisis",
    spendingStudentNote: "DÃ©penses Ã©tudiants (TL) = Nombre d'Ã©tudiants Ã— Montant par Ã©tudiant",
    spendingStaffTitle: "DÃ©penses personnel (TL)",
    spendingStaffNote: "DÃ©penses personnel (TL) = Nombre de personnel Ã— Montant par membre du personnel",
    spendingMealTitle: "DÃ©penses repas (TL)",
    spendingMealNote: "DÃ©penses repas (TL) = Repas produits Ã— Montant par repas",
    spendingTableTitle: "Tableau de calcul des dÃ©penses",
    syncTitle: "Synchronisation Supabase",
    syncCloseBtn: "Fermer",
    modalNewRecord: "Ajouter un enregistrement",
    formDate: "Date",
    formProducedCount: "Nombre de repas produits",
    formTurnstileCount: "Nombre de passages au tourniquet",
    formStudentCount: "Nombre d'Ã©tudiants",
    formFoodType: "Type de plat",
    formAutoCalc: "Calculs automatiques",
    badgeAutomatic: "Automatique",
    badgeFixed: "Fixe",
    badgeAutoEditable: "Automatique + Modifiable",
    btnCancel: "Annuler",
    entryFormSubmit: "Enregistrer",
    formReceiptNo: "NÂ° de reÃ§u",
    formOilType: "Type d'huile",
    formAmountLt: "QuantitÃ© (litres)",
    formNote: "Note",
    formWasteType: "Type de dÃ©chet",
    formAmount: "QuantitÃ©",
    formDeviceName: "Nom de l'appareil",
    formBrandModel: "Marque-ModÃ¨le",
    formSerialNo: "NumÃ©ro de sÃ©rie",
    formStatus: "Statut",
    formVerification: "VÃ©rification",
    formLastCalibration: "DerniÃ¨re calibration",
    formNextCalibration: "Prochaine calibration",
    formLocation: "Emplacement/DÃ©partement",
    formResponsible: "Personne responsable",
    btnSave: "Enregistrer",
    btnAdd: "Ajouter",
    btnClose: "Fermer",
    qrTitle: "Code QR",
    qrHint: "Imprimez le code QR Ã  accrocher sur les portes des dÃ©pÃ´ts.",
    adminTitle: "Panneau d'administration",
    adminReAuthText: "Veuillez entrer votre mot de passe administrateur pour accÃ©der au panneau.",
    adminPassword: "Mot de passe administrateur",
    btnVerify: "VÃ©rifier",
    adminSessionRole: "RÃ´le de la session",
    adminLastLogin: "DerniÃ¨re connexion",
    adminAuthMethod: "MÃ©thode d'authentification",
    adminStorage: "Stockage des mots de passe",
    adminDataSource: "Source de donnÃ©es",
    adminUserMgmt: "Gestion des utilisateurs",
    adminUserMgmtDesc: "Ajoutez, modifiez ou supprimez des utilisateurs.",
    adminAddUser: "Ajouter un utilisateur",
    adminUsername: "Nom d'utilisateur",
    adminDisplayName: "Nom affichÃ©",
    adminPasswordLabel: "Mot de passe",
    adminRole: "RÃ´le",
    adminAddUserBtn: "Ajouter l'utilisateur",
    adminRolePerms: "ParamÃ¨tres de permissions par rÃ´le",
    adminRolePermsDesc: "DÃ©finissez quels onglets chaque rÃ´le peut voir.",
    adminSecurity: "SÃ©curitÃ© de session",
    adminSecurityDesc: "La session se ferma si aucune activitÃ© n'est effectuÃ©e pendant la durÃ©e spÃ©cifiÃ©e.",
    adminInactivityTimeout: "DÃ©lai d'inactivitÃ©",
    adminLogsTitle: "Journal des activitÃ©s",
    adminLogsDesc: "Connexion/dÃ©connexion des utilisateurs et opÃ©rations sur les enregistrements",
    btnRefresh: "Actualiser",
    adminSaveBtn: "Enregistrer les paramÃ¨tres",
    adminFooterNote: "Les mots de passe sont stockÃ©s en permanence sur le serveur.",
    adminCloseBtn: "Fermer",
    logFilterDelete: "Suppression",
    logFilterAddUser: "Ajout d'utilisateur",
    logFilterDeleteUser: "Suppression d'utilisateur",
    adminRefreshBtn: "Actualiser",
    manualTitle: "Manuel utilisateur",
    manualSubtitle: "SystÃ¨me de contrÃ´le de la production, consommation et des dÃ©chets de la cantine",
    compDataType: "Type de donnÃ©es",
    compLastWeek: "Semaine derniÃ¨re",
    compThisWeek: "Cette semaine",
    compLastMonth: "Mois dernier",
    compThisMonth: "Ce mois-ci",
    compLastYear: "AnnÃ©e derniÃ¨re",
    compThisYear: "Cette annÃ©e",
    compDiff: "Ã‰cart",
    compTotalWaste: "DÃ©chets totaux (kg)",
    compTotalProduction: "Production totale",
    compTurnstilePasses: "Passages tourniquet",
    compStudentCount: "Nombre d'Ã©tudiants",
    compWastePerPerson: "DÃ©chets par personne (g)",
    monthlyCompDesc: "Comparaison de ce mois avec le mois dernier. â†‘ augmentation, â†“ diminution. Une diminution (â†“) des dÃ©chets et des dÃ©chets par personne est bonne.",
    yearlyCompDesc: "Comparaison de cette annÃ©e (du dÃ©but de l'annÃ©e Ã  aujourd'hui) avec la mÃªme pÃ©riode l'annÃ©e derniÃ¨re. â†‘ augmentation, â†“ diminution. Une diminution (â†“) des dÃ©chets et des dÃ©chets par personne est bonne.",
    monthNames: ["Janvier","FÃ©vrier","Mars","Avril","Mai","Juin","Juillet","AoÃ»t","Septembre","Octobre","Novembre","DÃ©cembre"],
    haccpColDate: "Date",
    haccpColTime: "Heure",
    haccpColDepot: "Nom de l'entrepÃ´t",
    haccpColTemp: "TempÃ©rature (Â°C)",
    haccpColHumidity: "HumiditÃ© (%)",
    haccpColNote: "Note",
    haccpColAction: "Action",
    dayNames: ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"],
    menuVariety: "VariÃ©tÃ©",
    menuVariety1: "1Ã¨re variÃ©tÃ©",
    menuVariety2: "2Ã¨me variÃ©tÃ©",
    menuVariety3: "3Ã¨me variÃ©tÃ©",
    menuVariety4: "4Ã¨me variÃ©tÃ©",
    menuVariety5: "5Ã¨me variÃ©tÃ©",
    menuPersonCount: "Nombre de personnes",
    stockDeductionList: "Liste de dÃ©duction de stock",
    total: "Total",
    inVarieties: "variÃ©tÃ©s",
    person: "pers.",
    weeklyGrandTotal: "Total hebdomadaire",
    dailyAverage: "Moyenne journaliÃ¨re",
    avgPerPerson: "Moyenne par personne",
    totalPersonDays: "Total personnes/jours",
    colDay: "Jour",
    colDate: "Date",
    colPerson: "Pers.",
    dailyMaterialCost: "CoÃ»t matÃ©riaux journalier",
    perPerson: "Par personne",
    ingredients: "IngrÃ©dients",
    perPersonGram: "(grammes par personne)",
    colIngredient: "IngrÃ©dient",
    colPerPerson: "/pers.",
    colUnit: "UnitÃ©",
    addIngredient: "+ Ajouter un ingrÃ©dient",
    foodName: "Nom du plat",
    allergen: "AllergÃ¨ne",
    recipePerPerson: "Recette (par personne)",
    devices: "appareils",
    chartMonthlyProduction: "Production mensuelle (pax)",
    chartMonthlyPasses: "Passages mensuels (pax)",
    chartLastYearWaste: "Gaspillage de l'année dernière (portions)",
    chartMonthlyWasteKg: "Déchets mensuels (kg)",
    chartMonthlyMealCount: "Nombre de repas mensuels",
    chartMonthlyWasteRate: "Taux de gaspillage mensuel %",
    chartMonthlyStudent: "Nombre d'étudiants mensuel",
    chartWastePerPersonLabel: "Déchets par personne (kg/personne)",
    maliTablo: "Tableau Financier",
    maliTabloSubtitle: "RÃ©sumÃ© hebdomadaire des coÃ»ts matÃ©riaux",
    maliUnitPriceMissing: "prix unitaire du matÃ©riau non dÃ©fini",
    maliUnitPriceHint: "Vous pouvez dÃ©finir dans l'onglet Prix Unitaire",
    weeklyTotal: "TOTAL HEBDOMADAIRE",
    categoryDistribution: "RÃ©partition par catÃ©gorie",
    weeklyTotalList: "Liste des besoins hebdomadaires totaux",
    totalCost: "CoÃ»t total",
    catMeat: "Produits carnÃ©s",
    catDairy: "Produits laitiers",
    catLegumes: "LÃ©gumineuses sÃ¨ches",
    catSpices: "Ã‰pices",
    catVegetable: "LÃ©gumes et Fruits",
    catOther: "Autres",
    month1: "Janvier", month2: "FÃ©vrier", month3: "Mars", month4: "Avril",
    month5: "Mai", month6: "Juin", month7: "Juillet", month8: "AoÃ»t",
    month9: "Septembre", month10: "Octobre", month11: "Novembre", month12: "DÃ©cembre",
    menuListTitle: "LISTE DU MENU",
    totalDevices: "Total des appareils",
    statusWorking: "En service",
    statusDefective: "DÃ©fectueux",
    statusMaintenance: "Maintenance requise",
    statusScrap: "Ã€ mettre au rebut",
    calibrationValid: "Calibration valide",
    calibrationApproaching: "Calibration Ã  venir (30 jours)",
    differentDepartments: "DÃ©partements diffÃ©rents",
    statusApproaching: "Approche",
    statusExpired: "ExpirÃ©",
    statusNotDone: "Non effectuÃ©",
    statusValid: "Valide",
    noDeviceFound: "Aucun appareil trouvÃ© correspondant Ã  ces critÃ¨res.",
    noDeviceRecord: "Aucun enregistrement d'appareil de calibration saisi.",
    deviceCount: "appareils",
    deviceCountSuffix: " appareils",
    editDeviceTitle: "Modifier l'appareil de calibration",
    newDeviceTitle: "Nouvel appareil de calibration",
    kpiBeneficiary: "BÃ©nÃ©ficiaires: ",
    kpiNoRecordToday: "Aujourd'hui pas d'enregistrement",
    kpiAlertsCount: "alertes",
    kpiAllValuesOk: "Toutes les valeurs sont conformes",
    kpiDeviceInAlarm: "appareils en alarme",
    kpiApproaching: "approche",
    kpiAllCalibrationsValid: "Toutes les calibrations sont valides",
    filterAll: "Tous",
    colDeviceName: "Nom de l'appareil",
    colBrandModel: "Marque-ModÃ¨le",
    colSerialNo: "NumÃ©ro de sÃ©rie",
    colDeviceStatus: "Ã‰tat de l'appareil",
    colCalibration: "Calibration",
    colLastCalibration: "DerniÃ¨re calibration",
    colNextCalibration: "Prochaine",
    colDepartment: "DÃ©partement",
    colResponsible: "Responsable",
    colNote: "Note",
    colAction: "Action",
    unitPriceList: "Liste des prix unitaires",
    registeredProducts: "Produits enregistrÃ©s",
    totalAmount: "Montant total",
    avgUnitPrice: "Prix unitaire moyen",
    selectedYear: "AnnÃ©e sÃ©lectionnÃ©e",
    duplicateWarning: "produits avec des enregistrements en double trouvÃ©s. Les calculs de prix peuvent contenir des erreurs.",
    cleanDuplicates: "Nettoyer un par un",
    colProductName: "Nom du produit",
    colUnit: "UnitÃ©",
    colUnitPrice: "Prix unitaire (â‚º)",
    colUnitEquals: "1 UnitÃ© =",
    colYear: "AnnÃ©e",
    noProductsThisYear: "Aucun produit ajoutÃ© pour cette annÃ©e.",
    btnEdit: "Modifier",
    btnDelete: "Supprimer",
    pageLabel: "Page",
    totalProductsLabel: "Total",
    totalProductsSuffix: " produits",
    priceYearNote: "Les prix sont par annÃ©e. Correspondance: Le nom du matÃ©riau est automatiquement normalisÃ©.",
    btnAddNewProduct: "+ Nouveau produit",
    btnDownloadCSV: "TÃ©lÃ©charger CSV",
    btnPrint: "Imprimer",
    btnUploadCSV: "TÃ©lÃ©charger CSV",
    clickToSelectYear: "Cliquez pour sÃ©lectionner l'annÃ©e",
    selectYear: "SÃ©lectionner l'annÃ©e",
    dataInfoRecord: "enregistrements",
    dataInfoProduction: "production",
    dataInfoWaste: "dÃ©chets",
    portion: "portions",
    abnormalDays: "jours anormaux",
    noRecordsToDisplay: "Aucun enregistrement Ã  afficher.",
    colYearLabel: "AnnÃ©e",
    avgPortion400: "400 g",
    recordsNot400: "enregistrements â‰  400",
    gram: " g",
    personLabel: "Pers",
    last7RecordsPrev7: "7 derniers enreg. / 7 prÃ©cÃ©dents",
    tempAppropriate: "Conforme",
    tempLow: "Bas",
    tempHigh: "Haut",
    lowerLimit: "Limite basse: ",
    upperLimit: "Limite haute: ",
    unknownDepo: "Inconnu",
    tempMin: "Min: ",
    tempAvg: "Moy: ",
    tempMax: "Max: ",
    humidity: "HumiditÃ©: ",
    depot: "Chambre",
    selectedCount: " sÃ©lectionnÃ©s",
    pageRecords: "Page ",
    recordCount: " enreg.)",
    tempRecordsTitle: "Enregistrements de tempÃ©rature du froid",
    dateRangeLabel: " | Date:",
    allDepots: "Toutes les chambres",
    colTime: "Heure",
    colDepot: "Chambre",
    colTemperature: "TempÃ©rature",
    colStatus: "Ã‰tat",
    depotTempRecordTitle: "Enregistrement de tempÃ©rature",
    formDate: "Date",
    formTime: "Heure",
    formDepotName: "Nom de la chambre",
    formTemperature: "TempÃ©rature (Â°C)",
    tempPlaceholder: "0.0 (peut Ãªtre laissÃ© vide)",
    formHumidity: "HumiditÃ© (%)",
    formNoteOptional: "Optionnel",
    deleteConfirm: "ÃŠtes-vous sÃ»r de vouloir supprimer cet enregistrement ?",
    deleteSelectedConfirm: "ÃŠtes-vous sÃ»r de vouloir supprimer ",
    deleteSelectedConfirmSuffix: " enregistrements sÃ©lectionnÃ©s ?",
    tempHistory: " Historique de tempÃ©rature",
    weeklyAvgTempNote: "Valeurs moyennes hebdomadaires de tempÃ©rature â€” avec lignes de limites haute et basse",
    upperLimitLabel: "Limite haute (",
    lowerLimitLabel: "Limite basse (",
    totalRecordCount: "Total des enregistrements",
    totalWasteOil: "Total huile usagÃ©e",
    avgAmountPerRecord: "Moy. quantitÃ© / enreg.",
    highestAmount: "QuantitÃ© la plus Ã©levÃ©e",
    lowestAmount: "QuantitÃ© la plus basse",
    oilTypeCount: "Nombre de types d'huile",
    yearTotalSuffix: " Total",
    startDate: "DÃ©but",
    endDate: "Fin",
    typeLabel: "Type: ",
    yearLabel: "AnnÃ©e: ",
    activeFilterLabel: "Filtre actif: ",
    noFilterMessage: "Aucun filtre â€” affichage de tous les enregistrements d'huile usagÃ©e.",
    noWasteOilRecord: "Aucun enregistrement d'huile usagÃ©e saisi.",
    noMatchingFilterRecord: "Aucun enregistrement trouvÃ© pour ces critÃ¨res.",
    editWasteOilRecord: "Modifier l'enregistrement d'huile usagÃ©e",
    newWasteOilRecord: "Nouvel enregistrement d'huile usagÃ©e",
    wasteOilChartLabel: "Huile usagÃ©e",
    previousYearLabel: "AnnÃ©e prÃ©cÃ©dente",
    undefinedType: "Non spÃ©cifiÃ©",
    totalWastePackaging: "Total dÃ©chets d'emballage",
    wasteTypeCount: "Nombre de types de dÃ©chets",
    noWastePackagingRecord: "Aucun enregistrement de dÃ©chets d'emballage saisi.",
    noMatchingFilterPackage: "Aucun enregistrement trouvÃ© pour ces critÃ¨res.",
    noFilterMessagePackaging: "Aucun filtre â€” affichage de tous les enregistrements de dÃ©chets d'emballage.",
    editWastePackagingRecord: "Modifier l'enregistrement de dÃ©chets d'emballage",
    newWastePackagingRecord: "Nouvel enregistrement de dÃ©chets d'emballage",
    wastePackagingChartLabel: "DÃ©chets d'emballage",
    chartDetailEmpty: "Aucun enregistrement trouvÃ© pour cette pÃ©riode.",
    chartClose: "Fermer",
    chartColProduction: "Production",
    chartColPasses: "Passages",
    chartColWaste: "DÃ©chets",
    chartColStudent: "Ã‰tudiants",
    chartColFoodType: "Type de plat",
    chartProductionVsTurnstile: "DiffÃ©rence entre production et passages au tourniquet",
    chartStaffTotal: "Personnel acadÃ©mique + administratif + SKS",
    yearFilterLabel: "AnnÃ©e:",
    monthFilterLabel: "Mois:",
    chartSelectYear: "SÃ©lectionner",
    year1Label: "AnnÃ©e 1:",
    year2Label: "AnnÃ©e 2:",
    noComparison: "Sans comparaison",
    newLabel: "Nouveau",
    foodTypeLabel: "Type de plat",
    productionLabel: " Production",
    wasteKgLabel: " DÃ©chets (kg)",
    wasteGrPortionLabel: " DÃ©chets (g/portion)",
    diffKgLabel: "Diff (kg)",
    totalRow: "TOTAL",
    registeredRate: "Taux enregistrÃ©: ",
    unsavedChanges: " (modifications non enregistrÃ©es)",
    kpiTotalStudentSpending: "DÃ©penses totales Ã©tudiants",
    kpiTotalStaffSpending: "DÃ©penses totales personnel",
    kpiAvgMonthlyStudentSpending: "DÃ©p. moy. mensuelle Ã©tudiants",
    kpiAvgMonthlyStaffSpending: "DÃ©p. moy. mensuelle personnel",
    kpiTotalStudents: "Total Ã©tudiants",
    kpiTotalStaff: "Total personnel",
    kpiHighestStudentMonth: "Mois le plus Ã©levÃ© Ã©tudiants",
    kpiHighestStaffMonth: "Mois le plus Ã©levÃ© personnel",
    kpiTotalMealSpending: "DÃ©penses totales repas",
    kpiAvgMonthlyMealSpending: "DÃ©p. moy. mensuelle repas",
    kpiTotalMealsProduced: "Total repas produits",
    kpiHighestMealMonth: "Mois le plus Ã©levÃ© repas",
    chartStudentSpending: "DÃ©penses Ã©tudiants (â‚º)",
    chartStaffSpending: "DÃ©penses personnel (â‚º)",
    chartMealSpending: "DÃ©penses repas (â‚º)",
    noRecordsYet: "Aucun enregistrement.",
    invalidRate: "Veuillez entrer un taux valide !",
    rateSaved: "Taux enregistrÃ©: ",
    menuStatusDraft: "Brouillon",
    menuStatusPending: "En attente d'approbation",
    menuStatusApproved: "ApprouvÃ©",
    menuStatusRejected: "RejetÃ©",
    menuApprove: "Approuver le menu",
    menuApproveDisabled: "Le menu n'a pas encore Ã©tÃ© soumis pour approbation. Lorsque le diÃ©tÃ©ticien clique sur Â« Soumettre pour approbation Â», vous pouvez approuver ici.",
    menuReject: "Rejeter le menu avec motif",
    menuRejectDisabled: "Le menu n'a pas encore Ã©tÃ© soumis pour approbation. Lorsque le diÃ©tÃ©ticien clique sur Â« Soumettre pour approbation Â», vous pouvez rejeter ici.",
    menuPendingCount: " menus en attente d'approbation. Allez Ã  la semaine en attente pour approuver.",
    menuNotApproved: "Le menu de cette semaine n'a pas encore Ã©tÃ© approuvÃ© par l'ingÃ©nieur alimentaire.",
    menuRejected: "Ce menu a Ã©tÃ© rejetÃ©",
    menuRejectedSuffix: ". Le diÃ©tÃ©ticien peut corriger et resoumettre.",
    menuAwaitingApproval: "Ce menu attend approbation. Il sera marquÃ© comme Â« non approuvÃ© Â» dans la liste de production.",
    noteLabel: "Note ",
    deleteNote: "Supprimer cette note",
    addNote: "Ajouter une note",
    mealPickerTitle: "Choisir un plat",
    clearLabel: "ğŸ—‘ Effacer",
    searchMealPlaceholder: "Rechercher un plat...",
    noMatchingMeal: "Aucun plat correspondant trouvÃ©.",
    varietyLabel: " VariÃ©tÃ©: ",
    addRecord: "Ajouter un nouvel enregistrement",
    editRecord: "Modifier l'enregistrement",
    btnUpdate: "Mettre Ã  jour",
    recordAdded: "Enregistrement ajoutÃ© avec succÃ¨s.",
    recordUpdated: "Enregistrement mis Ã  jour avec succÃ¨s.",
    recordDeleted: "Enregistrement supprimÃ©.",
    allRecordsDeleted: "Tous les enregistrements supprimÃ©s.",
    selectedRecordsDeleted: "Enregistrements sÃ©lectionnÃ©s supprimÃ©s.",
    noRecordToDelete: "Aucun enregistrement Ã  supprimer.",
    noSelectedRecord: "Aucun enregistrement sÃ©lectionnÃ©.",
    deleteAllConfirm: "ÃŠtes-vous sÃ»r de vouloir supprimer TOUS les enregistrements ?\nCette action est irrÃ©versible !",
    deleteFoodConfirm: "ÃŠtes-vous sÃ»r de vouloir supprimer cet aliment ?",
    selected: " sÃ©lectionnÃ©s",
    negMeals: "Le nombre de repas produits ne peut pas Ãªtre nÃ©gatif.",
    negTurnstile: "Le nombre de passages ne peut pas Ãªtre nÃ©gatif.",
    negStaff: "Le nombre de personnel ne peut pas Ãªtre nÃ©gatif.",
    negPortion: "La quantitÃ© de portions ne peut pas Ãªtre nÃ©gative.",
    negStudent: "Le nombre d'Ã©tudiants ne peut pas Ãªtre nÃ©gatif.",
    unsavedConfirm: "Vous avez des modifications non enregistrÃ©es. Voulez-vous vraiment fermer ?",
    selectUser: "Veuillez sÃ©lectionner un utilisateur.",
    wrongCredentials: "Nom d'utilisateur ou mot de passe incorrect.",
    tooManyAttempts: "Trop de tentatives. Veuillez patienter.",
    editable: "Modifiable",
    fixed: "Fixe",
    menuSentForApproval: "Menu soumis pour approbation. En attente de l'approbation de l'ingÃ©nieur alimentaire/admin.",
    menuApproved: "Menu approuvÃ©.",
    menuRejectedMsg: "Menu rejetÃ© avec justification.",
    menuDraftSaved: "Menu enregistrÃ© comme brouillon.",
    menuCleared: "Menu effacÃ©.",
    monthShort1: "Janv",
    monthShort2: "FÃ©vr",
    monthShort3: "Mars",
    monthShort4: "Avr",
    monthShort5: "Mai",
    monthShort6: "Juin",
    monthShort7: "Juil",
    monthShort8: "AoÃ»t",
    monthShort9: "Sept",
    monthShort10: "Oct",
    monthShort11: "Nov",
    monthShort12: "DÃ©c"
  },
  es: {
    loginSub: "SISTEMA DE GESTIÃ“N DE SERVICIOS DE NUTRICIÃ“N",
    loginFormSub: "Iniciar sesiÃ³n",
    loginUsername: "Usuario",
    loginSelectUser: "Seleccionar usuario",
    loginPassword: "ContraseÃ±a",
    loginBtn: "Iniciar sesiÃ³n",
    loginHint: "Puede obtener su contraseÃ±a del administrador",
    loginFeature1: "PlanificaciÃ³n de menÃº, producciÃ³n diaria, consumo y residuos",
    loginFeature2: "Informes detallados",
    loginFeature3: "Panel en vivo y grÃ¡ficos",
    menuLabel: "MenÃº",
    headerSubtitle: "Sistema de gestiÃ³n de servicios de nutriciÃ³n",
    btnLogout: "Cerrar sesiÃ³n",
    btnPrev: "Anterior",
    btnNext: "Siguiente",
    loading: "Cargando...",
    loadingText: "Sincronizando datos...",
    loadingSub: "Verificando conexiÃ³n con Supabase",
    loadingSkip: "Haga clic para omitir",
    versionLabel: "VersiÃ³n de la aplicaciÃ³n",
    sidebarPanel: "Panel",
    sidebarMenu: "MenÃº semanal",
    sidebarRecords: "Registros",
    sidebarReport: "Informe",
    sidebarHaccp: "Seguridad alimentaria",
    sidebarCalibration: "CalibraciÃ³n",
    sidebarOil: "Aceite usado",
    sidebarPackaging: "Residuos de envases",
    sidebarCharts: "GrÃ¡ficos",
    sidebarYearly: "ComparaciÃ³n anual",
    sidebarSpending: "Gastos",
    sidebarUnitPrice: "Precios unitarios",
    sidebarDownload: "Descargar todo",
    sidebarBackup: "Copia de seguridad en Supabase",
    sidebarRestore: "Restaurar desde Supabase",
    sidebarAdmin: "AdministraciÃ³n",
    sidebarLogs: "Registros de actividad",
    sidebarTheme: "Tema",
    sidebarManual: "Manual de usuario",
    dashboardPrintPdf: "Imprimir PDF",
    kpiTotalRecords: "Total de dÃ­as de producciÃ³n",
    kpiTodayProduction: "ProducciÃ³n de hoy",
    kpiHaccpAlarm: "Alarma de temperatura de cÃ¡mara frigorÃ­fica",
    kpiCalibrationAlarm: "Alarma de calibraciÃ³n",
    kpiAvgWaste: "Residuos promedio (kg)",
    kpiTotalPasses: "Total de pasadas por torniquete",
    kpiTotalWaste: "Total de residuos (kg)",
    kpiWasteRate: "Tasa de residuos",
    weeklyPrevBtn: "Semana anterior",
    weeklySummary: "Resumen semanal",
    weeklyNextBtn: "Semana siguiente",
    weeklyBadge: "Esta semana",
    dailyPrevBtn: "DÃ­a anterior",
    dailySummary: "Detalle diario",
    dailyNextBtn: "DÃ­a siguiente",
    weeklyCompTitle: "ComparaciÃ³n semanal",
    monthlyCompTitle: "ComparaciÃ³n mensual",
    monthlyBadge: "Este mes",
    yearlyBadge: "Este aÃ±o",
    anomalyTitle: "DetecciÃ³n de anomalÃ­as",
    anomalyBadge: "DÃ­as con residuos anormales",
    lastRecordsTitle: "Ãšltimos registros",
    dashboardGoToRecords: "Ir a registros",
    emptyDashboard: "AÃºn no hay registros...",
    formulaTitle: "FÃ“RMULA DE CÃLCULO DE RESIDUOS",
    recordsEntryBtn: "Ingresar producciÃ³n/consumo",
    recordsImportBtn: "Importar",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "Descargar CSV",
    recordsDeleteBtn: "Eliminar seleccionados",
    emptyRecords: "No se encontraron registros.",
    thDate: "Fecha",
    thProducedPerson: "Comidas producidas (Persona)",
    thWaste10: "Residuos 10%",
    thBeneficiary: "Beneficiarios del servicio de alimentaciÃ³n",
    thPortionGr: "PorciÃ³n (g)",
    thWasteKg: "Residuos (kg)",
    thWastedPortion: "Descartada (porciÃ³n)",
    thFoodType: "Tipo de comida",
    thAction: "AcciÃ³n",
    thAcademicStaff: "Personal acadÃ©mico y administrativo por torniquete",
    thStudentCount: "Estudiantes por torniquete",
    thBeneficiaryTotal: "Total de beneficiarios del servicio de alimentaciÃ³n",
    sksStaff: "Personal SKS de alimentaciÃ³n",
    summaryReport: "Informe resumen",
    reportPdfBtn: "Abrir PDF",
    allRecordsPrint: "Todos los registros (Vista de impresiÃ³n)",
    rTotalRecords: "Total de registros",
    rTotalMeals: "Total de comidas producidas",
    rTotalWaste10: "Total de residuos 10%",
    rTotalAfterWaste: "Total de comidas despuÃ©s de 10% de residuos",
    rTotalTurnstile: "Total de pasadas por torniquete",
    rTotalBeneficiary: "Total de beneficiarios del servicio de alimentaciÃ³n",
    rTotalStaff: "Total de personal SKS beneficiado",
    rPortionSize: "TamaÃ±o de porciÃ³n (g)",
    rTotalPortion: "Total de porciones (g)",
    rWastedPortion: "Porciones descartadas",
    rMaxWeeklyBeneficiary: "MÃ¡ximo de beneficiarios semanales",
    rTotalWasteKg: "Cantidad total de residuos (kg)",
    rAvgWasteKg: "Cantidad promedio de residuos (kg)",
    rTotalStudents: "Total de estudiantes",
    rMaxWaste: "MÃ¡ximo de residuos (kg)",
    rMinWaste: "MÃ­nimo de residuos (kg)",
    rWasteTrend: "Tendencia de residuos (Ãºltimos 7 dÃ­as)",
    rBeneficiaryTrend: "Tendencia de beneficiarios (Ãºltimos 7 dÃ­as)",
    wasteByFoodTitle: "AnÃ¡lisis de residuos por tipo de comida",
    wasteByFoodEmpty: "No se encontraron registros con datos de tipo de comida.",
    wasteByFoodRecords: "NÂº de registros",
    wasteByFoodRate: "Tasa de residuos",
    wasteByFoodPerPerson: "Residuos por persona (kg)",
    wsProducedMeal: "Comidas producidas (pers.)",
    wsTotalPasses: "Total de pases",
    wsTurnstile: "Torniquete",
    wsStaffSKS: "Personal de nutriciÃ³n",
    wsWasteAmount: "Cantidad de residuos",
    wsWastedPortion: "Al basurero",
    wsStudents: "Estudiantes nutriciÃ³n",
    wsNoRecordsYet: "Sin registros aÃºn",
    wsNoRecordThisWeek: "Sin registros esta semana",
    wsNoRecordToday: "Sin registro",
    wsTodayDetail: "Detalle de hoy",
    wsDailyDetail: "Detalle diario",
    wsWaste: "Merma",
    wsPortion: "porciÃ³n",
    wsProduced: "Producido",
    wsTurnstileCount: "Pases torniquete",
    wsStaffCount: "Personal",
    menuTitle: "MenÃº semanal",
    menuStatusBadge: "Estado",
    menuSaveBtn: "Guardar",
    menuSendBtn: "Enviar para aprobaciÃ³n",
    menuApproveBtn: "Aprobar",
    menuRejectBtn: "Rechazar",
    menuWithdrawBtn: "Retirar aprobaciÃ³n",
    menuClearBtn: "Limpiar tabla",
    menuPrintBtn: "Imprimir",
    menuFoodListBtn: "Lista de comidas",
    menuFoodListUploadBtn: "Subir CSV",
    menuFoodListCsvBtn: "Descargar CSV",
    menuWarningPrefix: "MenÃº no aprobado:",
    menuWarningText: "El menÃº de esta semana aÃºn no ha sido aprobado por el ingeniero de alimentos.",
    menuHintText: "Escriba los nombres de las comidas...",
    productNeedsTitle: "Lista de necesidades de productos",
    weeklyNeedsTitle: "Lista semanal total de necesidades",
    foodListTitle: "Lista de comidas",
    modalRejectMenu: "Rechazar menÃº",
    modalRejectDesc: "El motivo de rechazo es obligatorio.",
    menuRejectConfirm: "Rechazar",
    haccpTitle: "GestiÃ³n de seguridad alimentaria",
    haccpCsvBtn: "Descargar CSV",
    haccpColdStorage: "Registros de temperatura de cÃ¡mara frigorÃ­fica",
    haccpNewBtn: "Nuevo registro",
    haccpDepotBtn: "Nombres de depÃ³sitos",
    haccpDepoQrNote: "Puede editar los nombres de los depÃ³sitos y generar cÃ³digos QR para cada depÃ³sito con el botÃ³n QR.",
    haccpModalTitle: "Nuevo registro",
    filterDepot: "Filtro de depÃ³sito:",
    filterAll: "Todos",
    filterDateRange: "Rango de fechas:",
    emptyHaccp: "AÃºn no se han ingresado registros de temperatura.",
    btnDeleteSelectedHaccp: "Eliminar seleccionados",
    btnPdf: "PDF",
    depoNamesTitle: "Nombres de depÃ³sitos",
    oilNewBtn: "Nuevo registro",
    oilListBtn: "Lista",
    oilFilterTitle: "Filtros de aceite usado",
    filterOilType: "Tipo de aceite:",
    btnReset: "Restablecer",
    oilSummaryTitle: "Resumen de aceite usado",
    oilChartTitle: "GrÃ¡ficos de aceite usado",
    oilChartSubtitle: "Cantidad mensual de aceite usado (litros)",
    oilChartEmpty: "Los grÃ¡ficos aparecerÃ¡n cuando se ingresen registros de aceite usado",
    oilChartNote: "Totales mensuales de aceite usado por fecha, tipo de aceite y filtros de aÃ±o",
    oilRecordsTitle: "Registros de aceite usado",
    oilModalTitle: "Registro de aceite usado",
    emptyOil: "AÃºn no se han ingresado registros de aceite usado.",
    ambalajNewBtn: "Nuevo registro",
    ambalajListBtn: "Lista",
    packagingFilterTitle: "Filtros de residuos de envases",
    filterWasteType: "Tipo de residuo:",
    packagingSummaryTitle: "Resumen de residuos de envases",
    packagingChartTitle: "GrÃ¡ficos de residuos de envases",
    packagingChartSubtitle: "Cantidad mensual de residuos de envases (kg)",
    packagingChartEmpty: "Los grÃ¡ficos aparecerÃ¡n cuando se ingresen registros de residuos de envases",
    packagingChartNote: "Totales mensuales de residuos de envases por fecha, tipo de residuo y filtros de aÃ±o (kg)",
    packagingRecordsTitle: "Registros de residuos de envases",
    packagingModalTitle: "Registro de residuos de envases",
    emptyPackaging: "AÃºn no se han ingresado registros de residuos de envases.",
    kalibrasyonNewBtn: "Nuevo dispositivo",
    kalibrasyonListBtn: "Lista",
    kalibrasyonCsvBtn: "Descargar CSV",
    calibrationSummary: "Resumen de calibraciÃ³n",
    calibrationDevices: "Dispositivos sujetos a calibraciÃ³n",
    calibrationModalTitle: "Dispositivo para calibraciÃ³n",
    filterStatus: "Estado:",
    filterDepartment: "Departamento:",
    btnWordExport: "Exportar a Word",
    btnPrint: "Imprimir PDF",
    chartProdWaste: "ComparaciÃ³n ProducciÃ³n - Pasadas - Residuos",
    chartEmpty: "Los grÃ¡ficos aparecerÃ¡n cuando se ingresen datos",
    chartProdWasteNote: "ComparaciÃ³n mensual de producciÃ³n, pasadas por torniquete y porciones descartadas",
    chartStudentCount: "NÃºmero de estudiantes que usan el servicio de alimentaciÃ³n",
    yearTotal: "Total anual",
    chartStudentNote: "Total mensual de pasadas diarias de estudiantes",
    chartStaffTotal: "Total de personal acadÃ©mico y administrativo + SKS",
    chartStaffNote: "Total del personal acadÃ©mico y administrativo (Torniquete - Estudiantes) y del personal SKS de alimentaciÃ³n",
    chartMonthlyProd: "ProducciÃ³n mensual de comidas",
    chartMonthlyProdNote: "Total mensual del nÃºmero diario de comidas producidas",
    chartMonthlyTurnstile: "Pasadas mensuales por torniquete",
    chartTurnstileNote: "Estudiantes + personal + pasadas externas",
    chartMonthlyWaste: "Cantidad mensual de residuos (kg)",
    chartMonthlyWasteNote: "Total mensual de residuos diarios (kg)",
    chartMonthlyWastePortion: "Cantidad mensual de residuos (porciones)",
    chartWastePortionNote: "Total mensual de porciones descartadas diariamente",
    chartDiff: "Diferencia entre producciÃ³n y pasadas",
    chartDiffNote: "Diferencia entre comidas producidas y pasadas por torniquete",
    chartWasteRatio: "Residuos % de las comidas producidas",
    yearAverage: "Promedio anual",
    chartWasteRatioNote: "Porcentaje de comidas producidas que se convierten en residuos",
    chartWastePerPerson: "Residuos por persona (kg/persona)",
    chartWastePerPersonNote: "Residuos promedio por persona que ingresa al comedor",
    chartMonthlyTemp: "Temperaturas promedio mensuales de depÃ³sitos (Â°C)",
    chartTempEmpty: "Los grÃ¡ficos aparecerÃ¡n cuando se ingresen registros de temperatura",
    chartTempNote: "Temperatura promedio mensual de cada depÃ³sito",
    yearlyPdfBtn: "Imprimir PDF",
    yearlyTotalProd: "ComparaciÃ³n de producciÃ³n total",
    yearlyTotalProdNote: "Total anual - AÃ±o 1 vs AÃ±o 2 (porciones)",
    yearlyTotalBen: "Total de beneficiarios del servicio de alimentaciÃ³n",
    yearlyTotalBenNote: "Total anual - AÃ±o 1 vs AÃ±o 2 (total personas)",
    yearlyStudentComp: "ComparaciÃ³n de estudiantes beneficiarios",
    yearlyStudentNote: "Total anual - AÃ±o 1 vs AÃ±o 2 (estudiantes)",
    yearlyWasteComp: "ComparaciÃ³n de residuos (kg)",
    yearlyWasteNote: "Total anual - AÃ±o 1 vs AÃ±o 2 (kg)",
    yearlyMonthlyProd: "ComparaciÃ³n mensual de producciÃ³n",
    yearlyMonthlyProdNote: "AÃ±o 1 vs AÃ±o 2 - comidas producidas (porciones)",
    yearlyMonthlyTurnstile: "ComparaciÃ³n mensual de pasadas por torniquete",
    yearlyMonthlyTurnstileNote: "AÃ±o 1 vs AÃ±o 2 - cantidad de pasadas por torniquete",
    yearlyMonthlyStudent: "ComparaciÃ³n mensual de pasadas de estudiantes",
    yearlyMonthlyStudentNote: "AÃ±o 1 vs AÃ±o 2 - cantidad de pasadas de estudiantes",
    yearlyMonthlyWaste: "ComparaciÃ³n mensual de residuos (kg)",
    yearlyMonthlyWasteNote: "AÃ±o 1 vs AÃ±o 2 - cantidad de residuos (kg)",
    yearlyWasteListTitle: "Lista anual de residuos",
    spendingRatesTitle: "Tasas de gasto por persona (Estudiantes, Personal y Comidas)",
    spendingStudentRate: "Monto de gasto por estudiante (TL)",
    btnSaveStudentRate: "Guardar monto estudiantes",
    spendingStaffRate: "Monto de gasto por miembro del personal (TL)",
    btnSaveStaffRate: "Guardar monto personal",
    spendingMealRate: "Monto de gasto por comida (TL)",
    btnSaveMealRate: "Guardar monto comidas",
    spendingDesc: "Gasto de estudiantes = Nro. estudiantes Ã— Monto por estudiante",
    spendingStudentTitle: "Gasto de estudiantes (TL)",
    spendingChartEmpty: "Los grÃ¡ficos aparecerÃ¡n cuando se ingresen registros",
    spendingStudentNote: "Gasto de estudiantes (TL) = Nro. estudiantes Ã— Monto por estudiante",
    spendingStaffTitle: "Gasto del personal (TL)",
    spendingStaffNote: "Gasto del personal (TL) = Nro. personal Ã— Monto por miembro del personal",
    spendingMealTitle: "Gasto de comidas (TL)",
    spendingMealNote: "Gasto de comidas (TL) = Comidas producidas Ã— Monto por comida",
    spendingTableTitle: "Tabla de cÃ¡lculo de gastos",
    syncTitle: "SincronizaciÃ³n Supabase",
    syncCloseBtn: "Cerrar",
    modalNewRecord: "Agregar nuevo registro",
    formDate: "Fecha",
    formProducedCount: "NÃºmero de comidas producidas",
    formTurnstileCount: "NÃºmero de pasadas por torniquete",
    formStudentCount: "NÃºmero de estudiantes",
    formFoodType: "Tipo de comida",
    formAutoCalc: "CÃ¡lculos automÃ¡ticos",
    badgeAutomatic: "AutomÃ¡tico",
    badgeFixed: "Fijo",
    badgeAutoEditable: "AutomÃ¡tico + Editable",
    btnCancel: "Cancelar",
    entryFormSubmit: "Guardar",
    formReceiptNo: "NÂ° de recibo",
    formOilType: "Tipo de aceite",
    formAmountLt: "Cantidad (litros)",
    formNote: "Nota",
    formWasteType: "Tipo de residuo",
    formAmount: "Cantidad",
    formDeviceName: "Nombre del dispositivo",
    formBrandModel: "Marca-Modelo",
    formSerialNo: "NÃºmero de serie",
    formStatus: "Estado",
    formVerification: "VerificaciÃ³n",
    formLastCalibration: "Ãšltima calibraciÃ³n",
    formNextCalibration: "Siguiente calibraciÃ³n",
    formLocation: "UbicaciÃ³n/Departamento",
    formResponsible: "Persona responsable",
    btnSave: "Guardar",
    btnAdd: "Agregar",
    btnClose: "Cerrar",
    qrTitle: "CÃ³digo QR",
    qrHint: "Imprima el cÃ³digo QR para colgar en las puertas de los depÃ³sitos.",
    adminTitle: "Panel de administraciÃ³n",
    adminReAuthText: "Ingrese su contraseÃ±a de administrador para acceder al panel.",
    adminPassword: "ContraseÃ±a de administrador",
    btnVerify: "Verificar",
    adminSessionRole: "Rol de sesiÃ³n",
    adminLastLogin: "Ãšltimo inicio de sesiÃ³n",
    adminAuthMethod: "MÃ©todo de autenticaciÃ³n",
    adminStorage: "AlmacÃ©n de contraseÃ±as",
    adminDataSource: "Fuente de datos",
    adminUserMgmt: "GestiÃ³n de usuarios",
    adminUserMgmtDesc: "Agregue, edite o elimine usuarios.",
    adminAddUser: "Agregar nuevo usuario",
    adminUsername: "Nombre de usuario",
    adminDisplayName: "Nombre para mostrar",
    adminPasswordLabel: "ContraseÃ±a",
    adminRole: "Rol",
    adminAddUserBtn: "Agregar usuario",
    adminRolePerms: "ConfiguraciÃ³n de permisos por rol",
    adminRolePermsDesc: "Configure quÃ© pestaÃ±as puede ver cada rol.",
    adminSecurity: "Seguridad de sesiÃ³n",
    adminSecurityDesc: "La sesiÃ³n se cerrarÃ¡ si no hay actividad durante el tiempo especificado.",
    adminInactivityTimeout: "Tiempo de inactividad",
    adminLogsTitle: "Registros de actividad",
    adminLogsDesc: "Inicio/cierre de sesiÃ³n de usuarios y operaciones de registros",
    btnRefresh: "Actualizar",
    adminSaveBtn: "Guardar configuraciÃ³n",
    adminFooterNote: "Las contraseÃ±as se almacenan permanentemente en el servidor.",
    adminCloseBtn: "Cerrar",
    logFilterDelete: "EliminaciÃ³n",
    logFilterAddUser: "Agregar usuario",
    logFilterDeleteUser: "Eliminar usuario",
    adminRefreshBtn: "Actualizar",
    manualTitle: "Manual de usuario",
    manualSubtitle: "Sistema de control de producciÃ³n, consumo y residuos del comedor",
    compDataType: "Tipo de dato",
    compLastWeek: "Semana pasada",
    compThisWeek: "Esta semana",
    compLastMonth: "Mes pasado",
    compThisMonth: "Este mes",
    compLastYear: "AÃ±o pasado",
    compThisYear: "Este aÃ±o",
    compDiff: "Diferencia",
    compTotalWaste: "Residuos totales (kg)",
    compTotalProduction: "ProducciÃ³n total",
    compTurnstilePasses: "Pasos de torniquete",
    compStudentCount: "NÃºmero de estudiantes",
    compWastePerPerson: "Residuos por persona (g)",
    monthlyCompDesc: "ComparaciÃ³n de este mes con el mes pasado. â†‘ aumento, â†“ disminuciÃ³n. Una disminuciÃ³n (â†“) en residuos y residuos por persona es buena.",
    yearlyCompDesc: "ComparaciÃ³n de este aÃ±o (aÃ±o hasta la fecha) con el mismo perÃ­odo del aÃ±o pasado. â†‘ aumento, â†“ disminuciÃ³n. Una disminuciÃ³n (â†“) en residuos y residuos por persona es buena.",
    monthNames: ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"],
    haccpColDate: "Fecha",
    haccpColTime: "Hora",
    haccpColDepot: "Nombre del almacÃ©n",
    haccpColTemp: "Temperatura (Â°C)",
    haccpColHumidity: "Humedad (%)",
    haccpColNote: "Nota",
    haccpColAction: "AcciÃ³n",
    dayNames: ["Lunes", "Martes", "MiÃ©rcoles", "Jueves", "Viernes"],
    menuVariety: "Variedad",
    menuVariety1: "1Âª Variedad",
    menuVariety2: "2Âª Variedad",
    menuVariety3: "3Âª Variedad",
    menuVariety4: "4Âª Variedad",
    menuVariety5: "5Âª Variedad",
    menuPersonCount: "NÃºmero de personas",
    stockDeductionList: "Lista de deducciÃ³n de stock",
    total: "Total",
    inVarieties: "variedades",
    person: "pers.",
    weeklyGrandTotal: "Total semanal",
    dailyAverage: "Promedio diario",
    avgPerPerson: "Promedio por persona",
    totalPersonDays: "Total personas/dÃ­as",
    colDay: "DÃ­a",
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
    allergen: "AlÃ©rgeno",
    recipePerPerson: "Receta (por persona)",
    devices: "dispositivos",
    chartMonthlyProduction: "Producción mensual (pax)",
    chartMonthlyPasses: "Pasadas mensuales (pax)",
    chartLastYearWaste: "Desperdicio del año pasado (porciones)",
    chartMonthlyWasteKg: "Residuos mensuales (kg)",
    chartMonthlyMealCount: "Cantidad mensual de comidas",
    chartMonthlyWasteRate: "Tasa de residuos mensual %",
    chartMonthlyStudent: "Cantidad mensual de estudiantes",
    chartWastePerPersonLabel: "Residuos por persona (kg/persona)",
    maliTablo: "Tabla Financiera",
    maliTabloSubtitle: "Resumen semanal de costos de materiales",
    maliUnitPriceMissing: "precio unitario del material no definido",
    maliUnitPriceHint: "Puede definir en la pestaÃ±a de Precios Unitarios",
    weeklyTotal: "TOTAL SEMANAL",
    categoryDistribution: "DistribuciÃ³n por categorÃ­a",
    weeklyTotalList: "Lista semanal de necesidades totales",
    totalCost: "Costo total",
    catMeat: "Productos cÃ¡rnicos",
    catDairy: "Productos lÃ¡cteos",
    catLegumes: "Legumbres secas",
    catSpices: "Especias",
    catVegetable: "Verduras y Frutas",
    catOther: "Otros",
    month1: "Enero", month2: "Febrero", month3: "Marzo", month4: "Abril",
    month5: "Mayo", month6: "Junio", month7: "Julio", month8: "Agosto",
    month9: "Septiembre", month10: "Octubre", month11: "Noviembre", month12: "Diciembre",
    menuListTitle: "LISTA DEL MENÃš",
    totalDevices: "Total de dispositivos",
    statusWorking: "Funcionando",
    statusDefective: "Defectuoso",
    statusMaintenance: "Requiere mantenimiento",
    statusScrap: "A desguazar",
    calibrationValid: "CalibraciÃ³n vÃ¡lida",
    calibrationApproaching: "CalibraciÃ³n prÃ³xima (30 dÃ­as)",
    differentDepartments: "Diferentes departamentos",
    statusApproaching: "PrÃ³ximamente",
    statusExpired: "Vencido",
    statusNotDone: "No realizado",
    statusValid: "VÃ¡lido",
    noDeviceFound: "No se encontraron dispositivos con estos criterios de filtro.",
    noDeviceRecord: "AÃºn no se han registrado dispositivos de calibraciÃ³n.",
    deviceCount: "dispositivos",
    deviceCountSuffix: " dispositivos",
    editDeviceTitle: "Editar dispositivo de calibraciÃ³n",
    newDeviceTitle: "Nuevo dispositivo de calibraciÃ³n",
    kpiBeneficiary: "Beneficiarios: ",
    kpiNoRecordToday: "Sin registro hoy",
    kpiAlertsCount: "alertas",
    kpiAllValuesOk: "Todos los valores son correctos",
    kpiDeviceInAlarm: "dispositivos en alarma",
    kpiApproaching: "se aproxima",
    kpiAllCalibrationsValid: "Todas las calibraciones son vÃ¡lidas",
    filterAll: "Todos",
    colDeviceName: "Nombre del dispositivo",
    colBrandModel: "Marca-Modelo",
    colSerialNo: "NÃºmero de serie",
    colDeviceStatus: "Estado del dispositivo",
    colCalibration: "CalibraciÃ³n",
    colLastCalibration: "Ãšltima calibraciÃ³n",
    colNextCalibration: "PrÃ³xima",
    colDepartment: "Departamento",
    colResponsible: "Responsable",
    colNote: "Nota",
    colAction: "AcciÃ³n",
    unitPriceList: "Lista de precios unitarios",
    registeredProducts: "Productos registrados",
    totalAmount: "Monto total",
    avgUnitPrice: "Precio unitario promedio",
    selectedYear: "Año seleccionado",
    duplicateWarning: "productos con registros duplicados encontrados. Los cálculos de precios pueden tener errores.",
    cleanDuplicates: "Limpiar uno por uno",
    colProductName: "Nombre del producto",
    colUnitPrice: "Precio unitario (₺)",
    colUnitEquals: "1 Unidad =",
    colYear: "Año",
    noProductsThisYear: "No se han añadido productos para este año.",
    btnEdit: "Editar",
    btnDelete: "Eliminar",
    pageLabel: "Página",
    totalProductsLabel: "Total",
    totalProductsSuffix: " productos",
    priceYearNote: "Los precios son por año. Coincidencia: El nombre del material se empareja automáticamente por normalización.",
    btnAddNewProduct: "+ Nuevo producto",
    btnDownloadCSV: "Descargar CSV",
    btnUploadCSV: "Subir CSV",
    clickToSelectYear: "Haga clic para seleccionar año",
    selectYear: "Seleccionar año",
    dataInfoRecord: "registros",
    dataInfoProduction: "producciÃ³n",
    dataInfoWaste: "residuos",
    portion: "porciones",
    abnormalDays: "dÃ­as anormales",
    noRecordsToDisplay: "No hay registros para mostrar.",
    colYearLabel: "AÃ±o",
    avgPortion400: "400 g",
    recordsNot400: "registros no 400",
    gram: " g",
    personLabel: "Pers",
    last7RecordsPrev7: "Ãºltimos 7 registros / 7 anteriores",
    tempAppropriate: "Adecuado",
    tempLow: "Bajo",
    tempHigh: "Alto",
    lowerLimit: "LÃ­mite inferior: ",
    upperLimit: "LÃ­mite superior: ",
    unknownDepo: "Desconocido",
    tempMin: "MÃ­n: ",
    tempAvg: "Prome: ",
    tempMax: "MÃ¡x: ",
    humidity: "Humedad: ",
    depot: "CÃ¡mara",
    selectedCount: " seleccionados",
    pageRecords: "PÃ¡gina ",
    recordCount: " registros)",
    tempRecordsTitle: "Registros de temperatura de frÃ­o",
    dateRangeLabel: " | Fecha:",
    allDepots: "Todas las cÃ¡maras",
    colTime: "Hora",
    colDepot: "CÃ¡mara",
    colTemperature: "Temperatura",
    colStatus: "Estado",
    depotTempRecordTitle: "Registro de temperatura",
    formDate: "Fecha",
    formTime: "Hora",
    formDepotName: "Nombre de cÃ¡mara",
    formTemperature: "Temperatura (Â°C)",
    tempPlaceholder: "0.0 (puede dejarse vacÃ­o)",
    formHumidity: "Humedad (%)",
    formNoteOptional: "Opcional",
    deleteConfirm: "Â¿EstÃ¡ seguro de que desea eliminar este registro?",
    deleteSelectedConfirm: "Â¿EstÃ¡ seguro de que desea eliminar ",
    deleteSelectedConfirmSuffix: " registros seleccionados?",
    tempHistory: " Historial de temperatura",
    weeklyAvgTempNote: "Valores promedio semanales de temperatura â€” con lÃ­neas de lÃ­mite superior e inferior",
    upperLimitLabel: "LÃ­mite superior (",
    lowerLimitLabel: "LÃ­mite inferior (",
    totalRecordCount: "Total de registros",
    totalWasteOil: "Total aceite usado",
    avgAmountPerRecord: "Prom. cantidad / registro",
    highestAmount: "Cantidad mÃ¡s alta",
    lowestAmount: "Cantidad mÃ¡s baja",
    oilTypeCount: "Tipos de aceite",
    yearTotalSuffix: " Total",
    startDate: "Inicio",
    endDate: "Fin",
    typeLabel: "Tipo: ",
    yearLabel: "AÃ±o: ",
    activeFilterLabel: "Filtro activo: ",
    noFilterMessage: "Sin filtro â€” mostrando todos los registros de aceite usado.",
    noWasteOilRecord: "AÃºn no se han registrado aceites usados.",
    noMatchingFilterRecord: "No se encontraron registros con estos criterios.",
    editWasteOilRecord: "Editar registro de aceite usado",
    newWasteOilRecord: "Nuevo registro de aceite usado",
    wasteOilChartLabel: "Aceite usado",
    previousYearLabel: "AÃ±o anterior",
    undefinedType: "No especificado",
    totalWastePackaging: "Total residuos de embalaje",
    wasteTypeCount: "Tipos de residuos",
    noWastePackagingRecord: "AÃºn no se han registrado residuos de embalaje.",
    noMatchingFilterPackage: "No se encontraron registros con estos criterios.",
    noFilterMessagePackaging: "Sin filtro â€” mostrando todos los registros de residuos de embalaje.",
    editWastePackagingRecord: "Editar registro de residuos de embalaje",
    newWastePackagingRecord: "Nuevo registro de residuos de embalaje",
    wastePackagingChartLabel: "Residuos de embalaje",
    chartDetailEmpty: "No se encontraron registros para este perÃ­odo.",
    chartClose: "Cerrar",
    chartColProduction: "ProducciÃ³n",
    chartColPasses: "Pasadas",
    chartColWaste: "Residuos",
    chartColStudent: "Estudiantes",
    chartColFoodType: "Tipo de alimento",
    chartProductionVsTurnstile: "Diferencia entre producciÃ³n y pasadas por torniquete",
    chartStaffTotal: "Personal acadÃ©mico + administrativo + SKS",
    yearFilterLabel: "AÃ±o:",
    monthFilterLabel: "Mes:",
    chartSelectYear: "Seleccionar",
    year1Label: "AÃ±o 1:",
    year2Label: "AÃ±o 2:",
    noComparison: "Sin comparaciÃ³n",
    newLabel: "Nuevo",
    foodTypeLabel: "Tipo de alimento",
    productionLabel: " ProducciÃ³n",
    wasteKgLabel: " Residuos (kg)",
    wasteGrPortionLabel: " Residuos (g/porciÃ³n)",
    diffKgLabel: "Diferencia (kg)",
    totalRow: "TOTAL",
    registeredRate: "Tasa guardada: ",
    unsavedChanges: " (cambios no guardados)",
    kpiTotalStudentSpending: "Gasto total estudiantes",
    kpiTotalStaffSpending: "Gasto total personal",
    kpiAvgMonthlyStudentSpending: "Gasto prom. mensual estudiantes",
    kpiAvgMonthlyStaffSpending: "Gasto prom. mensual personal",
    kpiTotalStudents: "Total estudiantes",
    kpiTotalStaff: "Total personal",
    kpiHighestStudentMonth: "Mes mÃ¡s alto estudiantes",
    kpiHighestStaffMonth: "Mes mÃ¡s alto personal",
    kpiTotalMealSpending: "Gasto total comidas",
    kpiAvgMonthlyMealSpending: "Gasto prom. mensual comidas",
    kpiTotalMealsProduced: "Total comidas producidas",
    kpiHighestMealMonth: "Mes mÃ¡s alto comidas",
    chartStudentSpending: "Gasto estudiantes (â‚º)",
    chartStaffSpending: "Gasto personal (â‚º)",
    chartMealSpending: "Gasto comidas (â‚º)",
    noRecordsYet: "AÃºn no hay registros.",
    invalidRate: "Â¡Ingrese una tasa vÃ¡lida!",
    rateSaved: "Tasa guardada: ",
    menuStatusDraft: "Borrador",
    menuStatusPending: "Pendiente de aprobaciÃ³n",
    menuStatusApproved: "Aprobado",
    menuStatusRejected: "Rechazado",
    menuApprove: "Aprobar menÃº",
    menuApproveDisabled: "El menÃº aÃºn no ha sido enviado para aprobaciÃ³n. Cuando el dietista haga clic en \"Enviar para aprobaciÃ³n\", podrÃ¡ aprobar desde aquÃ­.",
    menuReject: "Rechazar menÃº con justificaciÃ³n",
    menuRejectDisabled: "El menÃº aÃºn no ha sido enviado para aprobaciÃ³n. Cuando el dietista haga clic en \"Enviar para aprobaciÃ³n\", podrÃ¡ rechazar desde aquÃ­.",
    menuPendingCount: " menÃºs esperando aprobaciÃ³n. Vaya a la semana pendiente para aprobar.",
    menuNotApproved: "El menÃº de esta semana aÃºn no ha sido aprobado por el ingeniero de alimentos.",
    menuRejected: "Este menÃº ha sido rechazado",
    menuRejectedSuffix: ". El dietista puede corregir y reenviar.",
    menuAwaitingApproval: "Este menÃº estÃ¡ esperando aprobaciÃ³n. Se marcarÃ¡ como \"no aprobado\" en la lista de producciÃ³n.",
    noteLabel: "Nota ",
    deleteNote: "Eliminar esta nota",
    addNote: "Agregar nueva nota",
    mealPickerTitle: "Seleccionar alimento",
    clearLabel: "ğŸ—‘ Limpiar",
    searchMealPlaceholder: "Buscar alimentos...",
    noMatchingMeal: "No se encontraron alimentos coincidentes.",
    varietyLabel: " Variedad: ",
    addRecord: "Agregar nuevo registro",
    editRecord: "Editar registro",
    btnUpdate: "Actualizar",
    recordAdded: "Registro agregado exitosamente.",
    recordUpdated: "Registro actualizado exitosamente.",
    recordDeleted: "Registro eliminado.",
    allRecordsDeleted: "Todos los registros eliminados.",
    selectedRecordsDeleted: "Registros seleccionados eliminados.",
    noRecordToDelete: "No hay registros para eliminar.",
    noSelectedRecord: "No se seleccionÃ³ ningÃºn registro.",
    deleteAllConfirm: "Â¿EstÃ¡ seguro de que desea eliminar TODOS los registros?\nÂ¡Esta acciÃ³n no se puede deshacer!",
    deleteFoodConfirm: "Â¿EstÃ¡ seguro de que desea eliminar este alimento?",
    selected: " seleccionados",
    negMeals: "La cantidad de comidas producidas no puede ser negativa.",
    negTurnstile: "La cantidad de turnos no puede ser negativa.",
    negStaff: "La cantidad de personal no puede ser negativa.",
    negPortion: "La cantidad de porciones no puede ser negativa.",
    negStudent: "La cantidad de estudiantes no puede ser negativa.",
    unsavedConfirm: "Tiene cambios sin guardar. Â¿EstÃ¡ seguro de que desea cerrar?",
    selectUser: "Por favor seleccione un usuario.",
    wrongCredentials: "Nombre de usuario o contraseÃ±a incorrectos.",
    tooManyAttempts: "Demasiados intentos. Por favor espere.",
    editable: "Editable",
    fixed: "Fijo",
    menuSentForApproval: "MenÃº enviado para aprobaciÃ³n. Esperando aprobaciÃ³n del ingeniero de alimentos/admin.",
    menuApproved: "MenÃº aprobado.",
    menuRejectedMsg: "MenÃº rechazado con justificaciÃ³n.",
    menuDraftSaved: "MenÃº guardado como borrador.",
    menuCleared: "MenÃº limpiado.",
    monthShort1: "Ene",
    monthShort2: "Feb",
    monthShort3: "Mar",
    monthShort4: "Abr",
    monthShort5: "May",
    monthShort6: "Jun",
    monthShort7: "Jul",
    monthShort8: "Ago",
    monthShort9: "Sep",
    monthShort10: "Oct",
    monthShort11: "Nov",
    monthShort12: "Dic"
  },
  pt: {
    loginSub: "SISTEMA DE GESTÃƒO DE SERVIÃ‡OS DE NUTRIÃ‡ÃƒO",
    loginFormSub: "Entrar",
    loginUsername: "UsuÃ¡rio",
    loginSelectUser: "Selecionar usuÃ¡rio",
    loginPassword: "Senha",
    loginBtn: "Entrar",
    loginHint: "VocÃª pode obter sua senha do administrador",
    loginFeature1: "Planejamento de cardÃ¡pio, produÃ§Ã£o diÃ¡ria, consumo e resÃ­duos",
    loginFeature2: "RelatÃ³rios detalhados",
    loginFeature3: "Painel ao vivo e grÃ¡ficos",
    menuLabel: "CardÃ¡pio",
    headerSubtitle: "Sistema de gestÃ£o de serviÃ§os de nutriÃ§Ã£o",
    btnLogout: "Sair",
    btnPrev: "Anterior",
    btnNext: "PrÃ³ximo",
    loading: "Carregando...",
    loadingText: "Sincronizando dados...",
    loadingSub: "Verificando conexÃ£o com Supabase",
    loadingSkip: "Clique para pular",
    versionLabel: "VersÃ£o do aplicativo",
    sidebarPanel: "Painel",
    sidebarMenu: "CardÃ¡pio semanal",
    sidebarRecords: "Registros",
    sidebarReport: "RelatÃ³rio",
    sidebarHaccp: "SeguranÃ§a alimentar",
    sidebarCalibration: "CalibraÃ§Ã£o",
    sidebarOil: "Ã“leo usado",
    sidebarPackaging: "ResÃ­duos de embalagem",
    sidebarCharts: "GrÃ¡ficos",
    sidebarYearly: "ComparaÃ§Ã£o anual",
    sidebarSpending: "Despesas",
    sidebarUnitPrice: "PreÃ§os unitÃ¡rios",
    sidebarDownload: "Baixar tudo",
    sidebarBackup: "Backup no Supabase",
    sidebarRestore: "Restaurar do Supabase",
    sidebarAdmin: "AdministraÃ§Ã£o",
    sidebarLogs: "Registros de atividade",
    sidebarTheme: "Tema",
    sidebarManual: "Manual do usuÃ¡rio",
    dashboardPrintPdf: "Imprimir PDF",
    kpiTotalRecords: "Total de dias de produÃ§Ã£o",
    kpiTodayProduction: "ProduÃ§Ã£o de hoje",
    kpiHaccpAlarm: "Alarme de temperatura da cÃ¢mara fria",
    kpiCalibrationAlarm: "Alarme de calibraÃ§Ã£o",
    kpiAvgWaste: "ResÃ­duos mÃ©dios (kg)",
    kpiTotalPasses: "Total de passagens pelo catraca",
    kpiTotalWaste: "Total de resÃ­duos (kg)",
    kpiWasteRate: "Taxa de resÃ­duos",
    weeklyPrevBtn: "Semana anterior",
    weeklySummary: "Resumo semanal",
    weeklyNextBtn: "PrÃ³xima semana",
    weeklyBadge: "Esta semana",
    dailyPrevBtn: "Dia anterior",
    dailySummary: "Detalhe diÃ¡rio",
    dailyNextBtn: "PrÃ³ximo dia",
    weeklyCompTitle: "ComparaÃ§Ã£o semanal",
    monthlyCompTitle: "ComparaÃ§Ã£o mensal",
    monthlyBadge: "Este mÃªs",
    yearlyBadge: "Este ano",
    anomalyTitle: "DetecÃ§Ã£o de anomalias",
    anomalyBadge: "Dias com resÃ­duos anormais",
    lastRecordsTitle: "Ãšltimos registros",
    dashboardGoToRecords: "Ir para registros",
    emptyDashboard: "Ainda nÃ£o hÃ¡ registros...",
    formulaTitle: "FÃ“RMULA DE CÃLCULO DE RESÃDUOS",
    recordsEntryBtn: "Inserir produÃ§Ã£o/consumo",
    recordsImportBtn: "Importar",
    recordsPrintPdf: "PDF",
    recordsCsvBtn: "Baixar CSV",
    recordsDeleteBtn: "Excluir selecionados",
    emptyRecords: "Nenhum registro encontrado.",
    thDate: "Data",
    thProducedPerson: "RefeiÃ§Ãµes produzidas (Pessoa)",
    thWaste10: "10% de resÃ­duos",
    thBeneficiary: "BeneficiÃ¡rios do serviÃ§o de alimentaÃ§Ã£o",
    thPortionGr: "PorÃ§Ã£o (g)",
    thWasteKg: "ResÃ­duos (kg)",
    thWastedPortion: "Descartada (porÃ§Ã£o)",
    thFoodType: "Tipo de refeiÃ§Ã£o",
    thAction: "AÃ§Ã£o",
    thAcademicStaff: "Pessoal acadÃªmico e administrativo pela catraca",
    thStudentCount: "Estudantes pela catraca",
    thBeneficiaryTotal: "Total de beneficiÃ¡rios do serviÃ§o de alimentaÃ§Ã£o",
    sksStaff: "Pessoal SKS de alimentaÃ§Ã£o",
    summaryReport: "RelatÃ³rio resumo",
    reportPdfBtn: "Abrir PDF",
    allRecordsPrint: "Todos os registros (VisÃ£o de impressÃ£o)",
    rTotalRecords: "Total de registros",
    rTotalMeals: "Total de refeiÃ§Ãµes produzidas",
    rTotalWaste10: "Total de resÃ­duos 10%",
    rTotalAfterWaste: "Total de refeiÃ§Ãµes apÃ³s 10% de resÃ­duos",
    rTotalTurnstile: "Total de passagens pela catraca",
    rTotalBeneficiary: "Total de beneficiÃ¡rios do serviÃ§o de alimentaÃ§Ã£o",
    rTotalStaff: "Total de pessoal SKS beneficiado",
    rPortionSize: "Tamanho da porÃ§Ã£o (g)",
    rTotalPortion: "Total de porÃ§Ãµes (g)",
    rWastedPortion: "PorÃ§Ãµes descartadas",
    rMaxWeeklyBeneficiary: "MÃ¡ximo de beneficiÃ¡rios semanais",
    rTotalWasteKg: "Quantidade total de resÃ­duos (kg)",
    rAvgWasteKg: "Quantidade mÃ©dia de resÃ­duos (kg)",
    rTotalStudents: "Total de estudantes",
    rMaxWaste: "MÃ¡ximo de resÃ­duos (kg)",
    rMinWaste: "MÃ­nimo de resÃ­duos (kg)",
    rWasteTrend: "TendÃªncia de resÃ­duos (Ãºltimos 7 dias)",
    rBeneficiaryTrend: "TendÃªncia de beneficiÃ¡rios (Ãºltimos 7 dias)",
    wasteByFoodTitle: "AnÃ¡lise de resÃ­duos por tipo de refeiÃ§Ã£o",
    wasteByFoodEmpty: "Nenhum registro com dados de tipo de refeiÃ§Ã£o encontrado.",
    wasteByFoodRecords: "NÂº de registros",
    wasteByFoodRate: "Taxa de resÃ­duos",
    wasteByFoodPerPerson: "ResÃ­duos por pessoa (kg)",
    wsProducedMeal: "RefeiÃ§Ãµes produzidas (pessoa)",
    wsTotalPasses: "Total de passagens",
    wsTurnstile: "Catraca",
    wsStaffSKS: "Pessoal de nutriÃ§Ã£o",
    wsWasteAmount: "Quantidade de resÃ­duos",
    wsWastedPortion: "Descartado",
    wsStudents: "Estudantes nutriÃ§Ã£o",
    wsNoRecordsYet: "Nenhum registro ainda",
    wsNoRecordThisWeek: "Nenhum registro esta semana",
    wsNoRecordToday: "Sem registro",
    wsTodayDetail: "Detalhe de hoje",
    wsDailyDetail: "Detalhe diÃ¡rio",
    wsWaste: "Perda",
    wsPortion: "porÃ§Ã£o",
    wsProduced: "Produzido",
    wsTurnstileCount: "Passagens catraca",
    wsStaffCount: "Pessoal",
    menuTitle: "CardÃ¡pio semanal",
    menuStatusBadge: "Estado",
    menuSaveBtn: "Salvar",
    menuSendBtn: "Enviar para aprovaÃ§Ã£o",
    menuApproveBtn: "Aprovar",
    menuRejectBtn: "Rejeitar",
    menuWithdrawBtn: "Retirar aprovaÃ§Ã£o",
    menuClearBtn: "Limpar tabela",
    menuPrintBtn: "Imprimir",
    menuFoodListBtn: "Lista de refeiÃ§Ãµes",
    menuFoodListUploadBtn: "Carregar CSV",
    menuFoodListCsvBtn: "Baixar CSV",
    menuWarningPrefix: "CardÃ¡pio nÃ£o aprovado:",
    menuWarningText: "O cardÃ¡pio desta semana ainda nÃ£o foi aprovado pelo engenheiro de alimentos.",
    menuHintText: "Digite os nomes das refeiÃ§Ãµes...",
    productNeedsTitle: "Lista de necessidades de produtos",
    weeklyNeedsTitle: "Lista semanal total de necessidades",
    foodListTitle: "Lista de refeiÃ§Ãµes",
    modalRejectMenu: "Rejeitar cardÃ¡pio",
    modalRejectDesc: "O motivo da rejeiÃ§Ã£o Ã© obrigatÃ³rio.",
    menuRejectConfirm: "Rejeitar",
    haccpTitle: "GestÃ£o de seguranÃ§a alimentar",
    haccpCsvBtn: "Baixar CSV",
    haccpColdStorage: "Registros de temperatura da cÃ¢mara fria",
    haccpNewBtn: "Novo registro",
    haccpDepotBtn: "Nomes dos depÃ³sitos",
    haccpDepoQrNote: "VocÃª pode editar os nomes dos depÃ³sitos e gerar cÃ³digos QR para cada depÃ³sito com o botÃ£o QR.",
    haccpModalTitle: "Novo registro",
    filterDepot: "Filtro de depÃ³sito:",
    filterAll: "Todos",
    filterDateRange: "Intervalo de datas:",
    emptyHaccp: "Ainda nÃ£o hÃ¡ registros de temperatura.",
    btnDeleteSelectedHaccp: "Excluir selecionados",
    btnPdf: "PDF",
    depoNamesTitle: "Nomes dos depÃ³sitos",
    oilNewBtn: "Novo registro",
    oilListBtn: "Lista",
    oilFilterTitle: "Filtros de Ã³leo usado",
    filterOilType: "Tipo de Ã³leo:",
    btnReset: "Redefinir",
    oilSummaryTitle: "Resumo do Ã³leo usado",
    oilChartTitle: "GrÃ¡ficos do Ã³leo usado",
    oilChartSubtitle: "Quantidade mensal de Ã³leo usado (litros)",
    oilChartEmpty: "Os grÃ¡ficos aparecerÃ£o quando registros de Ã³leo usado forem inseridos",
    oilChartNote: "Totais mensais de Ã³leo usado por data, tipo de Ã³leo e filtros de ano",
    oilRecordsTitle: "Registros de Ã³leo usado",
    oilModalTitle: "Registro de Ã³leo usado",
    emptyOil: "Ainda nÃ£o hÃ¡ registros de Ã³leo usado.",
    ambalajNewBtn: "Novo registro",
    ambalajListBtn: "Lista",
    packagingFilterTitle: "Filtros de resÃ­duos de embalagem",
    filterWasteType: "Tipo de resÃ­duo:",
    packagingSummaryTitle: "Resumo de resÃ­duos de embalagem",
    packagingChartTitle: "GrÃ¡ficos de resÃ­duos de embalagem",
    packagingChartSubtitle: "Quantidade mensal de resÃ­duos de embalagem (kg)",
    packagingChartEmpty: "Os grÃ¡ficos aparecerÃ£o quando registros de resÃ­duos de embalagem forem inseridos",
    packagingChartNote: "Totais mensais de resÃ­duos de embalagem por data, tipo de resÃ­duo e filtros de ano (kg)",
    packagingRecordsTitle: "Registros de resÃ­duos de embalagem",
    packagingModalTitle: "Registro de resÃ­duos de embalagem",
    emptyPackaging: "Ainda nÃ£o hÃ¡ registros de resÃ­duos de embalagem.",
    kalibrasyonNewBtn: "Novo dispositivo",
    kalibrasyonListBtn: "Lista",
    kalibrasyonCsvBtn: "Baixar CSV",
    calibrationSummary: "Resumo da calibraÃ§Ã£o",
    calibrationDevices: "Dispositivos sujeitos a calibraÃ§Ã£o",
    calibrationModalTitle: "Dispositivo para calibraÃ§Ã£o",
    filterStatus: "Estado:",
    filterDepartment: "Departamento:",
    btnWordExport: "Exportar para Word",
    btnPrint: "Imprimir PDF",
    chartProdWaste: "ComparaÃ§Ã£o ProduÃ§Ã£o - Passagens - ResÃ­duos",
    chartEmpty: "Os grÃ¡ficos aparecerÃ£o quando dados forem inseridos",
    chartProdWasteNote: "ComparaÃ§Ã£o mensal de produÃ§Ã£o, passagens pela catraca e porÃ§Ãµes descartadas",
    chartStudentCount: "NÃºmero de estudantes que usam o serviÃ§o de alimentaÃ§Ã£o",
    yearTotal: "Total anual",
    chartStudentNote: "Total mensal de passagens diÃ¡rias de estudantes",
    chartStaffTotal: "Pessoal acadÃªmico e administrativo + SKS",
    chartStaffNote: "Total do pessoal acadÃªmico e administrativo (Catraca - Estudantes) e do pessoal SKS de alimentaÃ§Ã£o",
    chartMonthlyProd: "ProduÃ§Ã£o mensal de refeiÃ§Ãµes",
    chartMonthlyProdNote: "Total mensal do nÃºmero diÃ¡rio de refeiÃ§Ãµes produzidas",
    chartMonthlyTurnstile: "Passagens mensais pela catraca",
    chartTurnstileNote: "Estudantes + pessoal + passagens externas",
    chartMonthlyWaste: "Quantidade mensal de resÃ­duos (kg)",
    chartMonthlyWasteNote: "Total mensal de resÃ­duos diÃ¡rios (kg)",
    chartMonthlyWastePortion: "Quantidade mensal de resÃ­duos (porÃ§Ãµes)",
    chartWastePortionNote: "Total mensal de porÃ§Ãµes descartadas diariamente",
    chartDiff: "DiferenÃ§a entre produÃ§Ã£o e passagens",
    chartDiffNote: "DiferenÃ§a entre refeiÃ§Ãµes produzidas e passagens pela catraca",
    chartWasteRatio: "ResÃ­duos % das refeiÃ§Ãµes produzidas",
    yearAverage: "MÃ©dia anual",
    chartWasteRatioNote: "Percentual das refeiÃ§Ãµes produzidas que se tornam resÃ­duos",
    chartWastePerPerson: "ResÃ­duos por pessoa (kg/pessoa)",
    chartWastePerPersonNote: "ResÃ­duos mÃ©dios por pessoa que entra no refeitÃ³rio",
    chartMonthlyTemp: "Temperaturas mÃ©dias mensais dos depÃ³sitos (Â°C)",
    chartTempEmpty: "Os grÃ¡ficos aparecerÃ£o quando registros de temperatura forem inseridos",
    chartTempNote: "Temperatura mÃ©dia mensal de cada depÃ³sito",
    yearlyPdfBtn: "Imprimir PDF",
    yearlyTotalProd: "ComparaÃ§Ã£o da produÃ§Ã£o total",
    yearlyTotalProdNote: "Total anual - Ano 1 vs Ano 2 (porÃ§Ãµes)",
    yearlyTotalBen: "Total de beneficiÃ¡rios do serviÃ§o de alimentaÃ§Ã£o",
    yearlyTotalBenNote: "Total anual - Ano 1 vs Ano 2 (total de pessoas)",
    yearlyStudentComp: "ComparaÃ§Ã£o de estudantes beneficiÃ¡rios",
    yearlyStudentNote: "Total anual - Ano 1 vs Ano 2 (estudantes)",
    yearlyWasteComp: "ComparaÃ§Ã£o de resÃ­duos (kg)",
    yearlyWasteNote: "Total anual - Ano 1 vs Ano 2 (kg)",
    yearlyMonthlyProd: "ComparaÃ§Ã£o mensal da produÃ§Ã£o",
    yearlyMonthlyProdNote: "Ano 1 vs Ano 2 - refeiÃ§Ãµes produzidas (porÃ§Ãµes)",
    yearlyMonthlyTurnstile: "ComparaÃ§Ã£o mensal de passagens pela catraca",
    yearlyMonthlyTurnstileNote: "Ano 1 vs Ano 2 - quantidade de passagens pela catraca",
    yearlyMonthlyStudent: "ComparaÃ§Ã£o mensal de passagens de estudantes",
    yearlyMonthlyStudentNote: "Ano 1 vs Ano 2 - quantidade de passagens de estudantes",
    yearlyMonthlyWaste: "ComparaÃ§Ã£o mensal de resÃ­duos (kg)",
    yearlyMonthlyWasteNote: "Ano 1 vs Ano 2 - quantidade de resÃ­duos (kg)",
    yearlyWasteListTitle: "Lista anual de resÃ­duos",
    spendingRatesTitle: "Taxas de despesa por pessoa (Estudantes, Pessoal e RefeiÃ§Ãµes)",
    spendingStudentRate: "Valor de despesa por estudante (TL)",
    btnSaveStudentRate: "Salvar valor estudantes",
    spendingStaffRate: "Valor de despesa por membro do pessoal (TL)",
    btnSaveStaffRate: "Salvar valor pessoal",
    spendingMealRate: "Valor de despesa por refeiÃ§Ã£o (TL)",
    btnSaveMealRate: "Salvar valor refeiÃ§Ãµes",
    spendingDesc: "Despesa de estudantes = NÂº estudantes Ã— Valor por estudante",
    spendingStudentTitle: "Despesa de estudantes (TL)",
    spendingChartEmpty: "Os grÃ¡ficos aparecerÃ£o quando registros forem inseridos",
    spendingStudentNote: "Despesa de estudantes (TL) = NÂº estudantes Ã— Valor por estudante",
    spendingStaffTitle: "Despesa do pessoal (TL)",
    spendingStaffNote: "Despesa do pessoal (TL) = NÂº pessoal Ã— Valor por membro do pessoal",
    spendingMealTitle: "Despesa de refeiÃ§Ãµes (TL)",
    spendingMealNote: "Despesa de refeiÃ§Ãµes (TL) = RefeiÃ§Ãµes produzidas Ã— Valor por refeiÃ§Ã£o",
    spendingTableTitle: "Tabela de cÃ¡lculo de despesas",
    syncTitle: "SincronizaÃ§Ã£o Supabase",
    syncCloseBtn: "Fechar",
    modalNewRecord: "Adicionar novo registro",
    formDate: "Data",
    formProducedCount: "NÃºmero de refeiÃ§Ãµes produzidas",
    formTurnstileCount: "NÃºmero de passagens pela catraca",
    formStudentCount: "NÃºmero de estudantes",
    formFoodType: "Tipo de refeiÃ§Ã£o",
    formAutoCalc: "CÃ¡lculos automÃ¡ticos",
    badgeAutomatic: "AutomÃ¡tico",
    badgeFixed: "Fixo",
    badgeAutoEditable: "AutomÃ¡tico + EditÃ¡vel",
    btnCancel: "Cancelar",
    entryFormSubmit: "Salvar",
    formReceiptNo: "NÂº de recibo",
    formOilType: "Tipo de Ã³leo",
    formAmountLt: "Quantidade (litros)",
    formNote: "Nota",
    formWasteType: "Tipo de resÃ­duo",
    formAmount: "Quantidade",
    formDeviceName: "Nome do dispositivo",
    formBrandModel: "Marca-Modelo",
    formSerialNo: "NÃºmero de sÃ©rie",
    formStatus: "Estado",
    formVerification: "VerificaÃ§Ã£o",
    formLastCalibration: "Ãšltima calibraÃ§Ã£o",
    formNextCalibration: "PrÃ³xima calibraÃ§Ã£o",
    formLocation: "LocalizaÃ§Ã£o/Departamento",
    formResponsible: "Pessoa responsÃ¡vel",
    btnSave: "Salvar",
    btnAdd: "Adicionar",
    btnClose: "Fechar",
    qrTitle: "CÃ³digo QR",
    qrHint: "Imprima o cÃ³digo QR para pendurar nas portas dos depÃ³sitos.",
    adminTitle: "Painel de administraÃ§Ã£o",
    adminReAuthText: "Por favor, insira sua senha de administrador para acessar o painel.",
    adminPassword: "Senha de administrador",
    btnVerify: "Verificar",
    adminSessionRole: "FunÃ§Ã£o da sessÃ£o",
    adminLastLogin: "Ãšltimo login",
    adminAuthMethod: "MÃ©todo de autenticaÃ§Ã£o",
    adminStorage: "Armazenamento de senhas",
    adminDataSource: "Fonte de dados",
    adminUserMgmt: "GestÃ£o de usuÃ¡rios",
    adminUserMgmtDesc: "Adicione, edite ou exclua usuÃ¡rios.",
    adminAddUser: "Adicionar novo usuÃ¡rio",
    adminUsername: "Nome de usuÃ¡rio",
    adminDisplayName: "Nome exibido",
    adminPasswordLabel: "Senha",
    adminRole: "FunÃ§Ã£o",
    adminAddUserBtn: "Adicionar usuÃ¡rio",
    adminRolePerms: "ConfiguraÃ§Ãµes de permissÃµes por funÃ§Ã£o",
    adminRolePermsDesc: "Configure quais abas cada funÃ§Ã£o pode visualizar.",
    adminSecurity: "SeguranÃ§a da sessÃ£o",
    adminSecurityDesc: "A sessÃ£o serÃ¡ encerrada se nÃ£o houver atividade durante o perÃ­odo especificado.",
    adminInactivityTimeout: "Tempo limite de inatividade",
    adminLogsTitle: "Registros de atividade",
    adminLogsDesc: "Login/logout de usuÃ¡rios e operaÃ§Ãµes de registros",
    btnRefresh: "Atualizar",
    adminSaveBtn: "Salvar configuraÃ§Ãµes",
    adminFooterNote: "As senhas sÃ£o armazenadas permanentemente no servidor.",
    adminCloseBtn: "Fechar",
    logFilterDelete: "ExclusÃ£o",
    logFilterAddUser: "Adicionar usuÃ¡rio",
    logFilterDeleteUser: "Excluir usuÃ¡rio",
    adminRefreshBtn: "Atualizar",
    manualTitle: "Manual do usuÃ¡rio",
    manualSubtitle: "Sistema de controle de produÃ§Ã£o, consumo e resÃ­duos do refeitÃ³rio",
    compDataType: "Tipo de dado",
    compLastWeek: "Semana passada",
    compThisWeek: "Esta semana",
    compLastMonth: "MÃªs passado",
    compThisMonth: "Este mÃªs",
    compLastYear: "Ano passado",
    compThisYear: "Este ano",
    compDiff: "DiferenÃ§a",
    compTotalWaste: "ResÃ­duos totais (kg)",
    compTotalProduction: "ProduÃ§Ã£o total",
    compTurnstilePasses: "Passagens catraca",
    compStudentCount: "NÃºmero de estudantes",
    compWastePerPerson: "ResÃ­duos por pessoa (g)",
    monthlyCompDesc: "ComparaÃ§Ã£o deste mÃªs com o mÃªs passado. â†‘ aumento, â†“ diminuiÃ§Ã£o. Uma diminuiÃ§Ã£o (â†“) nos resÃ­duos e resÃ­duos por pessoa Ã© boa.",
    yearlyCompDesc: "ComparaÃ§Ã£o deste ano (ano atÃ© o momento) com o mesmo perÃ­odo do ano passado. â†‘ aumento, â†“ diminuiÃ§Ã£o. Uma diminuiÃ§Ã£o (â†“) nos resÃ­duos e resÃ­duos por pessoa Ã© boa.",
    monthNames: ["Janeiro","Fevereiro","MarÃ§o","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"],
    haccpColDate: "Data",
    haccpColTime: "Hora",
    haccpColDepot: "Nome do depÃ³sito",
    haccpColTemp: "Temperatura (Â°C)",
    haccpColHumidity: "Umidade (%)",
    haccpColNote: "Nota",
    haccpColAction: "AÃ§Ã£o",
    dayNames: ["Segunda-feira", "TerÃ§a-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"],
    menuVariety: "Variedade",
    menuVariety1: "1Âª Variedade",
    menuVariety2: "2Âª Variedade",
    menuVariety3: "3Âª Variedade",
    menuVariety4: "4Âª Variedade",
    menuVariety5: "5Âª Variedade",
    menuPersonCount: "NÃºmero de pessoas",
    stockDeductionList: "Lista de deduÃ§Ã£o de estoque",
    total: "Total",
    inVarieties: "variedades",
    person: "pessoa",
    weeklyGrandTotal: "Total semanal",
    dailyAverage: "MÃ©dia diÃ¡ria",
    avgPerPerson: "MÃ©dia por pessoa",
    totalPersonDays: "Total pessoas/dias",
    colDay: "Dia",
    colDate: "Data",
    colPerson: "Pessoa",
    dailyMaterialCost: "Custo diÃ¡rio de materiais",
    perPerson: "Por pessoa",
    ingredients: "Ingredientes",
    perPersonGram: "(gramas por pessoa)",
    colIngredient: "Ingrediente",
    colPerPerson: "/pessoa",
    colUnit: "Unidade",
    addIngredient: "+ Adicionar ingrediente",
    foodName: "Nome do prato",
    allergen: "AlÃ©rgeno",
    recipePerPerson: "Receita (por pessoa)",
    devices: "dispositivos",
    chartMonthlyProduction: "Produção mensal (pax)",
    chartMonthlyPasses: "Passagens mensais (pax)",
    chartLastYearWaste: "Desperdício do ano passado (porções)",
    chartMonthlyWasteKg: "Resíduos mensais (kg)",
    chartMonthlyMealCount: "Quantidade mensal de refeições",
    chartMonthlyWasteRate: "Taxa de resíduos mensal %",
    chartMonthlyStudent: "Quantidade mensual de estudantes",
    chartWastePerPersonLabel: "Resíduos por pessoa (kg/pessoa)",
    maliTablo: "Tabela Financeira",
    maliTabloSubtitle: "Resumo semanal de custos de materiais",
    maliUnitPriceMissing: "preÃ§o unitÃ¡rio do material nÃ£o definido",
    maliUnitPriceHint: "Pode definir na aba de PreÃ§os UnitÃ¡rios",
    weeklyTotal: "TOTAL SEMANAL",
    categoryDistribution: "DistribuiÃ§Ã£o por categoria",
    weeklyTotalList: "Lista semanal de necessidades totais",
    totalCost: "Custo total",
    catMeat: "Produtos cÃ¡rneos",
    catDairy: "Produtos lÃ¡cteos",
    catLegumes: "Leguminosas secas",
    catSpices: "Especiarias",
    catVegetable: "Legumes e Frutas",
    catOther: "Outros",
    month1: "Janeiro", month2: "Fevereiro", month3: "MarÃ§o", month4: "Abril",
    month5: "Maio", month6: "Junho", month7: "Julho", month8: "Agosto",
    month9: "Setembro", month10: "Outubro", month11: "Novembro", month12: "Dezembro",
    menuListTitle: "LISTA DO MENU",
    totalDevices: "Total de dispositivos",
    statusWorking: "Funcional",
    statusDefective: "Defeituoso",
    statusMaintenance: "ManutenÃ§Ã£o necessÃ¡ria",
    statusScrap: "A ser descartado",
    calibrationValid: "CalibraÃ§Ã£o vÃ¡lida",
    calibrationApproaching: "CalibraÃ§Ã£o aproximando (30 dias)",
    differentDepartments: "Diferentes departamentos",
    statusApproaching: "Aproximando",
    statusExpired: "Expirado",
    statusNotDone: "NÃ£o realizado",
    statusValid: "VÃ¡lido",
    noDeviceFound: "Nenhum dispositivo encontrado com estes critÃ©rios.",
    noDeviceRecord: "Nenhum registro de dispositivo de calibraÃ§Ã£o inserido.",
    deviceCount: "dispositivos",
    deviceCountSuffix: " dispositivos",
    editDeviceTitle: "Editar dispositivo de calibraÃ§Ã£o",
    newDeviceTitle: "Novo dispositivo de calibraÃ§Ã£o",
    kpiBeneficiary: "BeneficiÃ¡rios: ",
    kpiNoRecordToday: "Sem registro hoje",
    kpiAlertsCount: "alertas",
    kpiAllValuesOk: "Todos os valores estÃ£o dentro da faixa",
    kpiDeviceInAlarm: "dispositivos em alarme",
    kpiApproaching: "aproximando",
    kpiAllCalibrationsValid: "Todas as calibraÃ§Ãµes sÃ£o vÃ¡lidas",
    filterAll: "Todos",
    colDeviceName: "Nome do dispositivo",
    colBrandModel: "Marca-Modelo",
    colSerialNo: "NÃºmero de sÃ©rie",
    colDeviceStatus: "Estado do dispositivo",
    colCalibration: "CalibraÃ§Ã£o",
    colLastCalibration: "Ãšltima calibraÃ§Ã£o",
    colNextCalibration: "PrÃ³xima",
    colDepartment: "Departamento",
    colResponsible: "ResponsÃ¡vel",
    colNote: "Nota",
    colAction: "AÃ§Ã£o",
    unitPriceList: "Lista de preços unitários",
    registeredProducts: "Produtos registrados",
    totalAmount: "Valor total",
    avgUnitPrice: "Preço unitário médio",
    selectedYear: "Ano selecionado",
    duplicateWarning: "produtos com registros duplicados encontrados. Os cálculos de preços podem conter erros.",
    cleanDuplicates: "Limpar um por um",
    colProductName: "Nome do produto",
    colUnitPrice: "Preço unitário (₺)",
    colUnitEquals: "1 Unidade =",
    colYear: "Ano",
    noProductsThisYear: "Nenhum produto adicionado para este ano ainda.",
    btnEdit: "Editar",
    btnDelete: "Excluir",
    pageLabel: "Página",
    totalProductsLabel: "Total",
    totalProductsSuffix: " produtos",
    priceYearNote: "Os preços são por ano. Correspondência: O nome do material é automaticamente normalizado.",
    btnAddNewProduct: "+ Novo produto",
    btnDownloadCSV: "Baixar CSV",
    btnUploadCSV: "Carregar CSV",
    clickToSelectYear: "Clique para selecionar o ano",
    selectYear: "Selecionar ano",
    dataInfoRecord: "registros",
    dataInfoProduction: "produÃ§Ã£o",
    dataInfoWaste: "resÃ­duos",
    portion: "porÃ§Ãµes",
    abnormalDays: "dias anormais",
    noRecordsToDisplay: "Sem registros para exibir.",
    colYearLabel: "Ano",
    avgPortion400: "400 g",
    recordsNot400: "registros â‰  400",
    gram: " g",
    personLabel: "Pessoa",
    last7RecordsPrev7: "Ãºltimos 7 registros / 7 anteriores",
    tempAppropriate: "Adequado",
    tempLow: "Baixo",
    tempHigh: "Alto",
    lowerLimit: "Limite inferior: ",
    upperLimit: "Limite superior: ",
    unknownDepo: "Desconhecido",
    tempMin: "MÃ­n: ",
    tempAvg: "MÃ©d: ",
    tempMax: "MÃ¡x: ",
    humidity: "Umidade: ",
    depot: "CÃ¢mara",
    selectedCount: " selecionados",
    pageRecords: "PÃ¡gina ",
    recordCount: " registros)",
    tempRecordsTitle: "Registros de temperatura de cÃ¢mara fria",
    dateRangeLabel: " | Data:",
    allDepots: "Todas as cÃ¢maras",
    colTime: "Hora",
    colDepot: "CÃ¢mara",
    colTemperature: "Temperatura",
    colStatus: "Estado",
    depotTempRecordTitle: "Registro de temperatura",
    formDate: "Data",
    formTime: "Hora",
    formDepotName: "Nome da cÃ¢mara",
    formTemperature: "Temperatura (Â°C)",
    tempPlaceholder: "0.0 (pode ficar vazio)",
    formHumidity: "Umidade (%)",
    formNoteOptional: "Opcional",
    deleteConfirm: "Tem certeza de que deseja excluir este registro?",
    deleteSelectedConfirm: "Tem certeza de que deseja excluir ",
    deleteSelectedConfirmSuffix: " registros selecionados?",
    tempHistory: " HistÃ³rico de temperatura",
    weeklyAvgTempNote: "Valores mÃ©dios semanais de temperatura â€” com linhas de limite superior e inferior",
    upperLimitLabel: "Limite superior (",
    lowerLimitLabel: "Limite inferior (",
    totalRecordCount: "Total de registros",
    totalWasteOil: "Total Ã³leo usado",
    avgAmountPerRecord: "MÃ©d. quantidade / registro",
    highestAmount: "Quantidade mais alta",
    lowestAmount: "Quantidade mais baixa",
    oilTypeCount: "Tipos de Ã³leo",
    yearTotalSuffix: " Total",
    startDate: "InÃ­cio",
    endDate: "Fim",
    typeLabel: "Tipo: ",
    yearLabel: "Ano: ",
    activeFilterLabel: "Filtro ativo: ",
    noFilterMessage: "Sem filtro â€” exibindo todos os registros de Ã³leo usado.",
    noWasteOilRecord: "Nenhum registro de Ã³leo usado inserido.",
    noMatchingFilterRecord: "Nenhum registro encontrado para estes critÃ©rios.",
    editWasteOilRecord: "Editar registro de Ã³leo usado",
    newWasteOilRecord: "Novo registro de Ã³leo usado",
    wasteOilChartLabel: "Ã“leo usado",
    previousYearLabel: "Ano anterior",
    undefinedType: "NÃ£o especificado",
    totalWastePackaging: "Total resÃ­duos de embalagem",
    wasteTypeCount: "Tipos de resÃ­duos",
    noWastePackagingRecord: "Nenhum registro de resÃ­duos de embalagem inserido.",
    noMatchingFilterPackage: "Nenhum registro encontrado para estes critÃ©rios.",
    noFilterMessagePackaging: "Sem filtro â€” exibindo todos os registros de resÃ­duos de embalagem.",
    editWastePackagingRecord: "Editar registro de resÃ­duos de embalagem",
    newWastePackagingRecord: "Novo registro de resÃ­duos de embalagem",
    wastePackagingChartLabel: "ResÃ­duos de embalagem",
    chartDetailEmpty: "Nenhum registro encontrado para este perÃ­odo.",
    chartClose: "Fechar",
    chartColProduction: "ProduÃ§Ã£o",
    chartColPasses: "Passagens",
    chartColWaste: "ResÃ­duos",
    chartColStudent: "Estudantes",
    chartColFoodType: "Tipo de refeiÃ§Ã£o",
    chartProductionVsTurnstile: "DiferenÃ§a entre produÃ§Ã£o e passagens no catraca",
    chartStaffTotal: "Pessoal acadÃªmico + administrativo + SKS",
    yearFilterLabel: "Ano:",
    monthFilterLabel: "MÃªs:",
    chartSelectYear: "Selecionar",
    year1Label: "Ano 1:",
    year2Label: "Ano 2:",
    noComparison: "Sem comparaÃ§Ã£o",
    newLabel: "Novo",
    foodTypeLabel: "Tipo de refeiÃ§Ã£o",
    productionLabel: " ProduÃ§Ã£o",
    wasteKgLabel: " ResÃ­duos (kg)",
    wasteGrPortionLabel: " ResÃ­duos (g/porÃ§Ã£o)",
    diffKgLabel: "DiferenÃ§a (kg)",
    totalRow: "TOTAL",
    registeredRate: "Taxa salva: ",
    unsavedChanges: " (alteraÃ§Ãµes nÃ£o salvas)",
    kpiTotalStudentSpending: "Gasto total estudantes",
    kpiTotalStaffSpending: "Gasto total pessoal",
    kpiAvgMonthlyStudentSpending: "Gasto mÃ©d. mensal estudantes",
    kpiAvgMonthlyStaffSpending: "Gasto mÃ©d. mensal pessoal",
    kpiTotalStudents: "Total estudantes",
    kpiTotalStaff: "Total pessoal",
    kpiHighestStudentMonth: "MÃªs mais alto estudantes",
    kpiHighestStaffMonth: "MÃªs mais alto pessoal",
    kpiTotalMealSpending: "Gasto total refeiÃ§Ãµes",
    kpiAvgMonthlyMealSpending: "Gasto mÃ©d. mensal refeiÃ§Ãµes",
    kpiTotalMealsProduced: "Total refeiÃ§Ãµes produzidas",
    kpiHighestMealMonth: "MÃªs mais alto refeiÃ§Ãµes",
    chartStudentSpending: "Gasto estudantes (â‚º)",
    chartStaffSpending: "Gasto pessoal (â‚º)",
    chartMealSpending: "Gasto refeiÃ§Ãµes (â‚º)",
    noRecordsYet: "Sem registros ainda.",
    invalidRate: "Por favor insira uma taxa vÃ¡lida!",
    rateSaved: "Taxa salva: ",
    menuStatusDraft: "Rascunho",
    menuStatusPending: "Aguardando aprovaÃ§Ã£o",
    menuStatusApproved: "Aprovado",
    menuStatusRejected: "Rejeitado",
    menuApprove: "Aprovar cardÃ¡pio",
    menuApproveDisabled: "O cardÃ¡pio ainda nÃ£o foi enviado para aprovaÃ§Ã£o. Quando o nutricionista clicar em \"Enviar para aprovaÃ§Ã£o\", vocÃª poderÃ¡ aprovar aqui.",
    menuReject: "Rejeitar cardÃ¡pio com justificativa",
    menuRejectDisabled: "O cardÃ¡pio ainda nÃ£o foi enviado para aprovaÃ§Ã£o. Quando o nutricionista clicar em \"Enviar para aprovaÃ§Ã£o\", vocÃª poderÃ¡ rejeitar aqui.",
    menuPendingCount: " cardÃ¡pios aguardando aprovaÃ§Ã£o. VÃ¡ Ã  semana pendente para aprovar.",
    menuNotApproved: "O cardÃ¡pio desta semana ainda nÃ£o foi aprovado pelo engenheiro de alimentos.",
    menuRejected: "Este cardÃ¡pio foi rejeitado",
    menuRejectedSuffix: ". O nutricionista pode corrigir e reenviar.",
    menuAwaitingApproval: "Este cardÃ¡pio aguarda aprovaÃ§Ã£o. SerÃ¡ marcado como \"nÃ£o aprovado\" na lista de produÃ§Ã£o.",
    noteLabel: "Nota ",
    deleteNote: "Excluir esta nota",
    addNote: "Adicionar nova nota",
    mealPickerTitle: "Selecionar refeiÃ§Ã£o",
    clearLabel: "ğŸ—‘ Limpar",
    searchMealPlaceholder: "Pesquisar refeiÃ§Ã£o...",
    noMatchingMeal: "Nenhuma refeiÃ§Ã£o correspondente encontrada.",
    varietyLabel: " Variedade: ",
    addRecord: "Adicionar novo registro",
    editRecord: "Editar registro",
    btnUpdate: "Atualizar",
    recordAdded: "Registro adicionado com sucesso.",
    recordUpdated: "Registro atualizado com sucesso.",
    recordDeleted: "Registro excluÃ­do.",
    allRecordsDeleted: "Todos os registros excluÃ­dos.",
    selectedRecordsDeleted: "Registros selecionados excluÃ­dos.",
    noRecordToDelete: "Nenhum registro para excluir.",
    noSelectedRecord: "Nenhum registro selecionado.",
    deleteAllConfirm: "Tem certeza de que deseja excluir TODOS os registros?\nEsta aÃ§Ã£o nÃ£o pode ser desfeita!",
    deleteFoodConfirm: "Tem certeza de que deseja excluir este alimento?",
    selected: " selecionados",
    negMeals: "A quantidade de refeiÃ§Ãµes produzidas nÃ£o pode ser negativa.",
    negTurnstile: "A quantidade de catracas nÃ£o pode ser negativa.",
    negStaff: "A quantidade de pessoal nÃ£o pode ser negativa.",
    negPortion: "A quantidade de porÃ§Ãµes nÃ£o pode ser negativa.",
    negStudent: "A quantidade de estudantes nÃ£o pode ser negativa.",
    unsavedConfirm: "VocÃª tem alteraÃ§Ãµes nÃ£o salvas. Tem certeza de que deseja fechar?",
    selectUser: "Por favor selecione um usuÃ¡rio.",
    wrongCredentials: "Nome de usuÃ¡rio ou senha incorretos.",
    tooManyAttempts: "Muitas tentativas. Por favor aguarde.",
    editable: "EditÃ¡vel",
    fixed: "Fixo",
    menuSentForApproval: "CardÃ¡pio enviado para aprovaÃ§Ã£o. Aguardando aprovaÃ§Ã£o do engenheiro de alimentos/admin.",
    menuApproved: "CardÃ¡pio aprovado.",
    menuRejectedMsg: "CardÃ¡pio rejeitado com justificativa.",
    menuDraftSaved: "CardÃ¡pio salvo como rascunho.",
    menuCleared: "CardÃ¡pio limpo.",
    monthShort1: "Jan",
    monthShort2: "Fev",
    monthShort3: "Mar",
    monthShort4: "Abr",
    monthShort5: "Mai",
    monthShort6: "Jun",
    monthShort7: "Jul",
    monthShort8: "Ago",
    monthShort9: "Set",
    monthShort10: "Out",
    monthShort11: "Nov",
    monthShort12: "Dez"
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
    chartMonthlyTemp: "Oylik o'rtacha ombor haroratlari (Â°C)",
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
    spendingDesc: "Talaba xarajati = Talabalar soni Ã— Talaba boshiga miqdor",
    spendingStudentTitle: "Talaba xarajat miqdori (TL)",
    spendingChartEmpty: "Yozuvlar kiritilganda grafikalar ko'rsatiladi",
    spendingStudentNote: "Talaba xarajati (TL) = Talabalar soni Ã— Talaba boshiga xarajat miqdori",
    spendingStaffTitle: "Xodim xarajat miqdori (TL)",
    spendingStaffNote: "Xodim xarajati (TL) = Xodimlar soni Ã— Xodim boshiga xarajat miqdori",
    spendingMealTitle: "Ovqat xarajat miqdori (TL)",
    spendingMealNote: "Ovqat xarajati (TL) = Ishlab chiqarilgan ovqat soni Ã— Ovqat boshiga xarajat miqdori",
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
    monthlyCompDesc: "Joriy oy o'tgan oy bilan solishtirilmoqda. â†‘ o'sish, â†“ kamayish. Chiqindi va kishi boshiga chiqindining kamayishi (â†“) yaxshi.",
    yearlyCompDesc: "Joriy yil (yil boshidan bugunga) o'tgan yilning shu davri bilan solishtirilmoqda. â†‘ o'sish, â†“ kamayish. Chiqindi va kishi boshiga chiqindining kamayishi (â†“) yaxshi.",
    monthNames: ["Yanvar","Fevral","Mart","Aprel","May","Iyun","Iyul","Avgust","Sentabr","Oktabr","Noyabr","Dekabr"],
    haccpColDate: "Sana",
    haccpColTime: "Vaqt",
    haccpColDepot: "Ombor nomi",
    haccpColTemp: "Harorat (Â°C)",
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
    chartMonthlyProduction: "Oylik ishlab chiqarish (kishi)",
    chartMonthlyPasses: "Oylik o'tish (kishi)",
    chartLastYearWaste: "O'tgab yil chiqindi (porsiyalar)",
    chartMonthlyWasteKg: "Oylik chiqindi (kg)",
    chartMonthlyMealCount: "Oylik ovqat soni",
    chartMonthlyWasteRate: "Oylik chiqindi nisbati %",
    chartMonthlyStudent: "Oylik talaba soni",
    chartWastePerPersonLabel: "Kishi boshiga chiqindi (kg/kishi)",
    maliTablo: "Moliyaviy Jadval",
    maliTabloSubtitle: "Haftalik material xarajatlari xulosasi",
    maliUnitPriceMissing: "materialning birlik narxi belgilanmagan",
    maliUnitPriceHint: "Birlik narxlari bo'limidan belgilashingiz mumkin",
    weeklyTotal: "HAFTALIK JAMI",
    categoryDistribution: "Kategoriya taqsimoti",
    weeklyTotalList: "Haftalik umumiy ehtiyojlar ro'yxati",
    totalCost: "Umumiy xarajat",
    catMeat: "Go'sht mahsulotlari",
    catDairy: "Sut mahsulotlari",
    catLegumes: "Quru dukkaklilar",
    catSpices: "Ziravorlar",
    catVegetable: "Sabzavot va mevalar",
    catOther: "Boshqalar",
    month1: "Yanvar", month2: "Fevral", month3: "Mart", month4: "Aprel",
    month5: "May", month6: "Iyun", month7: "Iyul", month8: "Avgust",
    month9: "Sentabr", month10: "Oktabr", month11: "Noyabr", month12: "Dekabr",
    menuListTitle: "MENYU RO'YXATI",
    totalDevices: "Jami qurilmalar",
    statusWorking: "Ishlayapti",
    statusDefective: "Buzyongan",
    statusMaintenance: "Texnik talab qilinadi",
    statusScrap: "Chiqindiga chiqariladi",
    calibrationValid: "Kalibrlash amal qiladi",
    calibrationApproaching: "Kalibrlash yaqinlashmoqda (30 kun)",
    differentDepartments: "Turli bo'limlar",
    statusApproaching: "Yaqinlashmoqda",
    statusExpired: "Muddati tugadi",
    statusNotDone: "Bajarilmadi",
    statusValid: "Amal qiladi",
    noDeviceFound: "Ushbu filtrlash mezonlariga mos qurilmalar topilmadi.",
    noDeviceRecord: "Hali kalibrlashga taalluqli qurilma kiritilmagan.",
    deviceCount: "qurilma",
    deviceCountSuffix: " qurilma",
    editDeviceTitle: "Kalibrlash qurilmasini tahrirlash",
    newDeviceTitle: "Yangi kalibrlash qurilmasi",
    kpiBeneficiary: "Foydalanuvchilar: ",
    kpiNoRecordToday: "Bugun yozuv yo'q",
    kpiAlertsCount: "ogohlantirishlar",
    kpiAllValuesOk: "Barcha qiymatlar mos",
    kpiDeviceInAlarm: "qurilmalar signal berayotgan",
    kpiApproaching: "yaqinlashmoqda",
    kpiAllCalibrationsValid: "Barcha kalibrlashlar amal qiladi",
    filterAll: "Barchasi",
    colDeviceName: "Qurilma nomi",
    colBrandModel: "Brend-Model",
    colSerialNo: "Seriya raqami",
    colDeviceStatus: "Qurilma holati",
    colCalibration: "Kalibrlash",
    colLastCalibration: "Oxirgi kalibrlash",
    colNextCalibration: "Keyingi",
    colDepartment: "Bo'lim",
    colResponsible: "Mas'ul",
    colNote: "Eslatma",
    colAction: "Amal",
    unitPriceList: "Birlik narxlari ro'yxati",
    registeredProducts: "Ro'yxatdan o'tgan mahsulotlar",
    totalAmount: "Umumiy summa",
    avgUnitPrice: "O'rtacha birlik narxi",
    selectedYear: "Tanlangan yil",
    duplicateWarning: "takroriy yozuvlar topilgan mahsulotlar. Narx hisoblashlarida xatolik bo'lishi mumkin.",
    cleanDuplicates: "Bittalab tozalash",
    colProductName: "Mahsulot nomi",
    colUnitPrice: "Birlik narxi (₺)",
    colUnitEquals: "1 Birlik =",
    colYear: "Yil",
    noProductsThisYear: "Ushbu yil uchun hali mahsulot qo'shilmagan.",
    btnEdit: "Tahrirlash",
    btnDelete: "O'chirish",
    pageLabel: "Sahifa",
    totalProductsLabel: "Jami",
    totalProductsSuffix: " mahsulot",
    priceYearNote: "Narxlar yil bo'yicha. Moslashtirish: Material nomi avtomatik normalizatsiya qilinadi.",
    btnAddNewProduct: "+ Yangi mahsulot",
    btnDownloadCSV: "CSV yuklab olish",
    btnUploadCSV: "CSV yuklash",
    clickToSelectYear: "Yil tanlash uchun bosing",
    selectYear: "Yil tanlash",
    dataInfoRecord: "yozuvlar",
    dataInfoProduction: "ishlab chiqarish",
    dataInfoWaste: "chiqindilar",
    portion: "porsiyalar",
    abnormalDays: "anormal kunlar",
    noRecordsToDisplay: "Ko'rsatiladigan yozuv topilmadi.",
    colYearLabel: "Yil",
    avgPortion400: "400 gr",
    recordsNot400: "yozuvlar 400 emas",
    gram: " gr",
    personLabel: "Kishi",
    last7RecordsPrev7: "oxirgi 7 yozuv / oldingi 7",
    tempAppropriate: "Mos",
    tempLow: "Past",
    tempHigh: "Yuqori",
    lowerLimit: "Pastki chegarasi: ",
    upperLimit: "Yuqori chegarasi: ",
    unknownDepo: "Noma'lum",
    tempMin: "Min: ",
    tempAvg: "O'rt: ",
    tempMax: "Maks: ",
    humidity: "Namlik: ",
    depot: "Xona",
    selectedCount: " tanlangan",
    pageRecords: "Sahifa ",
    recordCount: " yozuv)",
    tempRecordsTitle: "Sovutish xonalari harorat yozuvlari",
    dateRangeLabel: " | Sana:",
    allDepots: "Barcha xonalar",
    colTime: "Vaqt",
    colDepot: "Xona",
    colTemperature: "Harorat",
    colStatus: "Holat",
    depotTempRecordTitle: "Xona harorat yozuvi",
    formDate: "Sana",
    formTime: "Vaqt",
    formDepotName: "Xona nomi",
    formTemperature: "Harorat (Â°C)",
    tempPlaceholder: "0.0 (bo'sh qoldirish mumkin)",
    formHumidity: "Namlik (%)",
    formNoteOptional: "Ixtiyoriy",
    deleteConfirm: "Ushbu yozuvni o'chirishga ishonchingiz komilmi?",
    deleteSelectedConfirm: "Tanlangan ",
    deleteSelectedConfirmSuffix: " yozuvlarni o'chirishga ishonchingiz komilmi?",
    tempHistory: " Harorat tarixi",
    weeklyAvgTempNote: "Haftalik o'rtacha harorat qiymatlari â€” pastki va yuqori chegara chiziqlari bilan",
    upperLimitLabel: "Yuqori chegara (",
    lowerLimitLabel: "Pastki chegara (",
    totalRecordCount: "Jami yozuvlar",
    totalWasteOil: "Jami ishlatilgan moy",
    avgAmountPerRecord: "O'rt. miqdor / yozuv",
    highestAmount: "Eng yuqori miqdor",
    lowestAmount: "Eng past miqdor",
    oilTypeCount: "Moy turlari soni",
    yearTotalSuffix: " Jami",
    startDate: "Boshlanish",
    endDate: "Tugash",
    typeLabel: "Turi: ",
    yearLabel: "Yil: ",
    activeFilterLabel: "Faol filter: ",
    noFilterMessage: "Filtrlashsiz â€” barcha ishlatilgan moy yozuvlari ko'rsatilmoqda.",
    noWasteOilRecord: "Hali ishlatilgan moy yozuvi kiritilmagan.",
    noMatchingFilterRecord: "Ushbu filtr mezonlariga mos yozuv topilmadi.",
    editWasteOilRecord: "Ishlatilgan moy yozuvini tahrirlash",
    newWasteOilRecord: "Yangi ishlatilgan moy yozuvi",
    wasteOilChartLabel: "Ishlatilgan moy",
    previousYearLabel: "Oldingi yil",
    undefinedType: "Aniqlanmagan",
    totalWastePackaging: "Jami qadoqlash chiqindilari",
    wasteTypeCount: "Chiqindi turlari soni",
    noWastePackagingRecord: "Hali qadoqlash chiqindisi yozuvi kiritilmagan.",
    noMatchingFilterPackage: "Ushbu filtr mezonlariga mos yozuv topilmadi.",
    noFilterMessagePackaging: "Filtrlashsiz â€” barcha qadoqlash chiqindisi yozuvlari ko'rsatilmoqda.",
    editWastePackagingRecord: "Qadoqlash chiqindisi yozuvini tahrirlash",
    newWastePackagingRecord: "Yangi qadoqlash chiqindisi yozuvi",
    wastePackagingChartLabel: "Qadoqlash chiqindilari",
    chartDetailEmpty: "Ushbu davr uchun yozuv topilmadi.",
    chartClose: "Yopish",
    chartColProduction: "Ishlab chiqarish",
    chartColPasses: "O'tishlar",
    chartColWaste: "Chiqindilar",
    chartColStudent: "Talabalar",
    chartColFoodType: "Ovqat turi",
    chartProductionVsTurnstile: "Ishlab chiqarish va shlyuz o'tishi orasidagi farq",
    chartStaffTotal: "Oliy ta'lim + ma'muriy + SKS xodimlari",
    yearFilterLabel: "Yil:",
    monthFilterLabel: "Oy:",
    chartSelectYear: "Tanlash",
    year1Label: "1-yil:",
    year2Label: "2-yil:",
    noComparison: "Taqqoslash yo'q",
    newLabel: "Yangi",
    foodTypeLabel: "Ovqat turi",
    productionLabel: " Ishlab chiqarish",
    wasteKgLabel: " Chiqindilar (kg)",
    wasteGrPortionLabel: " Chiqindilar (gr/porsiya)",
    diffKgLabel: "Farq (kg)",
    totalRow: "JAMI",
    registeredRate: "Saqlangan stavka: ",
    unsavedChanges: " (saqlanmagan o'zgarishlar)",
    kpiTotalStudentSpending: "Jami talaba xarajatlari",
    kpiTotalStaffSpending: "Jami xodim xarajatlari",
    kpiAvgMonthlyStudentSpending: "O'rt. oylik talaba xarajatlari",
    kpiAvgMonthlyStaffSpending: "O'rt. oylik xodim xarajatlari",
    kpiTotalStudents: "Jami talabalar",
    kpiTotalStaff: "Jami xodimlar",
    kpiHighestStudentMonth: "Eng yuqori talaba oy",
    kpiHighestStaffMonth: "Eng yuqori xodim oy",
    kpiTotalMealSpending: "Jami ovqat xarajatlari",
    kpiAvgMonthlyMealSpending: "O'rt. oylik ovqat xarajatlari",
    kpiTotalMealsProduced: "Jami ishlab chiqarilgan ovqatlar",
    kpiHighestMealMonth: "Eng yuqori ovqat oy",
    chartStudentSpending: "Talaba xarajatlari (â‚º)",
    chartStaffSpending: "Xodim xarajatlari (â‚º)",
    chartMealSpending: "Ovqat xarajatlari (â‚º)",
    noRecordsYet: "Hali yozuvlar yo'q.",
    invalidRate: "Iltimos, yaroqli stavka kiriting!",
    rateSaved: "Stavka saqlandi: ",
    menuStatusDraft: "Qoralama",
    menuStatusPending: "Tasdiq kutilmoqda",
    menuStatusApproved: "Tasdiqlangan",
    menuStatusRejected: "Rad etilgan",
    menuApprove: "Menyuni tasdiqlash",
    menuApproveDisabled: "Menyu hali tasdiqqa yuborilmagan. Dietolog \"Tasdiqqa yuborish\" tugmasini bosganida, bu yerdan tasdiqlashingiz mumkin.",
    menuReject: "Menyuni asoslab rad etish",
    menuRejectDisabled: "Menyu hali tasdiqqa yuborilmagan. Dietolog \"Tasdiqqa yuborish\" tugmasini bosganida, bu yerdan rad etishingiz mumkin.",
    menuPendingCount: " hafta menyusi tasdiq kutilmoqda. Kutilayotgan haftaga o'tib tasdiqlashingiz mumkin.",
    menuNotApproved: "Ushbu hafta menyusi hali oziq-ovqat muhandisi tomonidan tasdiqlanmagan.",
    menuRejected: "Ushbu menyu rad etilgan",
    menuRejectedSuffix: ". Dietolog tuzatib qayta yuborishi mumkin.",
    menuAwaitingApproval: "Ushbu menyu tasdiq kutilmoqda. Tasdiqlanmasdan ishlab chiqarish ro'yxatida \"tasdiqlanmagan\" deb belgilanadi.",
    noteLabel: "Eslatma ",
    deleteNote: "Ushbu eslatmani o'chirish",
    addNote: "Yangi eslatma qo'shish",
    mealPickerTitle: "Ovqat tanlash",
    clearLabel: "ğŸ—‘ Tozalash",
    searchMealPlaceholder: "Ovqat qidirish...",
    noMatchingMeal: "Mos ovqat topilmadi.",
    varietyLabel: " Turi: ",
    addRecord: "Yangi yozuv qo'shish",
    editRecord: "Yozuvni tahrirlash",
    btnUpdate: "Yangilash",
    recordAdded: "Yozuv muvaffaqiyatli qo'shildi.",
    recordUpdated: "Yozuv muvaffaqiyatli yangilandi.",
    recordDeleted: "Yozuv o'chirildi.",
    allRecordsDeleted: "Barcha yozuvlar o'chirildi.",
    selectedRecordsDeleted: "Tanlangan yozuvlar o'chirildi.",
    noRecordToDelete: "O'chirish uchun yozuv yo'q.",
    noSelectedRecord: "Hech qanday yozuv tanlanmagan.",
    deleteAllConfirm: "BARCHA yozuvlarni o'chirishga ishonchingiz komilmi?\nBu amal bekor qilib bo'lmaydi!",
    deleteFoodConfirm: "Ushbu ovqatni o'chirishga ishonchingiz komilmi?",
    selected: " tanlangan",
    negMeals: "Ishlab chiqarilgan ovqat soni manfiy bo'lishi mumkin emas.",
    negTurnstile: "Shlyuz o'tishi soni manfiy bo'lishi mumkin emas.",
    negStaff: "Xodimlar soni manfiy bo'lishi mumkin emas.",
    negPortion: "Porsiya miqdori manfiy bo'lishi mumkin emas.",
    negStudent: "Talabalar soni manfiy bo'lishi mumkin emas.",
    unsavedConfirm: "Saqlanmagan o'zgarishlar mavjud. Yopishga ishonchingiz komilmi?",
    selectUser: "Iltimos, foydalanuvchini tanlang.",
    wrongCredentials: "Foydalanuvchi nomi yoki parol noto'g'ri.",
    tooManyAttempts: "Juda ko'p urinishlar. Iltimos kuting.",
    editable: "Tahrirlash mumkin",
    fixed: "O'zgarmas",
    menuSentForApproval: "Menyu tasdiqqa yuborildi. Oziq-ovqat muhandisi/ma'muriy tasdiq kutilmoqda.",
    menuApproved: "Menyu tasdiqlandi.",
    menuRejectedMsg: "Menyu asoslab rad etildi.",
    menuDraftSaved: "Menyu qoralama sifatida saqlandi.",
    menuCleared: "Menyu tozalandi.",
    monthShort1: "Yan",
    monthShort2: "Fev",
    monthShort3: "Mar",
    monthShort4: "Apr",
    monthShort5: "May",
    monthShort6: "Iyun",
    monthShort7: "Iyul",
    monthShort8: "Avg",
    monthShort9: "Sen",
    monthShort10: "Okt",
    monthShort11: "Noy",
    monthShort12: "Dek"
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
    document.documentElement.classList.add('lang-ar');
  } else {
    document.documentElement.classList.remove('lang-ar');
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
  renderAll();
  renderMenu();
  renderHarcamaMenu();
  renderBirimFiyatlar();
}

function t(key) {
  var dict = I18N[currentLang] || I18N['tr'];
  return dict[key] || I18N['tr'][key] || key;
}

var CATEGORY_I18N = {
  'Et ÃœrÃ¼nleri': 'catMeat', 'SÃ¼t ÃœrÃ¼nleri': 'catDairy', 'Kuru Bakliyat': 'catLegumes',
  'Baharatlar': 'catSpices', 'Sebze ve Meyve': 'catVegetable', 'DiÄŸer': 'catOther'
};
function tCategory(name) {
  var key = CATEGORY_I18N[name];
  return key ? t(key) : name;
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
    ? 'KÄ±rÅŸehir Ahi Evran Ãœniversitesi - BHYS'
    : 'KÄ±rÅŸehir Ahi Evran University - NSMS';
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




