/* =============================================
   ATIK KONTROL YÖNETİM SİSTEMİ - APP LOGIC
   ============================================= */

'use strict';

// ─── STATE ───────────────────────────────────────────────────────────────────
let records = [];
let editingId = null;
let filteredRecords = [];
let yemeklerCache = [];

// ─── SUPABASE ────────────────────────────────────────────────────────────────
const SUPABASE_URL = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.supabaseUrl : '';
const SUPABASE_ANON_KEY = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.supabaseAnonKey : '';
var supabaseClient = null;
try {
  if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (_) {}

// ─── REMOTE PASSWORD HASH CACHE ──────────────────────────────────────────────
let remoteHashes = { adminHash: null, viewerHash: null };

async function syncPasswordHashesFromRemote() {
  try {
    if (!supabaseClient) return;
    var { data, error } = await supabaseClient.from('config').select('key,value').in('key', ['admin_hash','viewer_hash']);
    if (error) return;
    data.forEach(function(r) {
      if (r.key === 'admin_hash') remoteHashes.adminHash = r.value;
      if (r.key === 'viewer_hash') remoteHashes.viewerHash = r.value;
    });
  } catch (_) {}
}

async function syncUsersFromSupabase() {
  try {
    if (!supabaseClient) return false;
    var { data, error } = await supabaseClient.from('config').select('value').eq('key', 'users_list').single();
    if (error || !data || !data.value) return false;
    var users = JSON.parse(data.value);
    if (Array.isArray(users) && users.length > 0) {
      APP_CONFIG.users = users;
      try { localStorage.setItem('atik_kontrol_users', JSON.stringify(users)); } catch (_) {}
      return true;
    }
    return false;
  } catch (_) { return false; }
}

async function saveUsersToSupabase(users) {
  try {
    if (!supabaseClient) return false;
    var json = JSON.stringify(users);
    var { error } = await supabaseClient.from('config').upsert(
      { key: 'users_list', value: json, last_modified: new Date().toISOString() },
      { onConflict: 'key' }
    );
    if (error) throw error;
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
function getAvailableYears() {
  const years = new Set();
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
const ROLE_VIEWER = 'viewer';

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function getAdminHash() {
  if (remoteHashes.adminHash) return remoteHashes.adminHash;
  const cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
  if (cfg.users && Array.isArray(cfg.users)) {
    const adminUser = cfg.users.find(u => u.role === ROLE_ADMIN);
    if (adminUser) return adminUser.passwordHash;
  }
  return '';
}

function getViewerHash() {
  if (remoteHashes.viewerHash) return remoteHashes.viewerHash;
  return '';
}

function getRole() {
  return sessionStorage.getItem('atik_kontrol_role') || ROLE_VIEWER;
}

function isAdminSessionValid() {
  if (getRole() !== ROLE_ADMIN) return false;
  const storedHash = sessionStorage.getItem('atik_kontrol_admin_hash_proof');
  if (!storedHash) return false;
  const loginTime = parseInt(sessionStorage.getItem('atik_kontrol_login_time') || '0');
  if (Date.now() - loginTime > 3600000) { // 1 saat oturum süresi
    sessionStorage.removeItem('atik_kontrol_admin_hash_proof');
    sessionStorage.removeItem('atik_kontrol_login_time');
    return false;
  }
  // Yeni sistem: users listesinden admin hash'lerini kontrol et
  const cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
  if (cfg.users && Array.isArray(cfg.users)) {
    const adminHashes = cfg.users.filter(u => u.role === ROLE_ADMIN).map(u => u.passwordHash);
    if (adminHashes.includes(storedHash)) return true;
  }
  // Eski sistem: adminHash ile kontrol
  const adminHashes = remoteHashes.adminHash ? [remoteHashes.adminHash] : [];
  return adminHashes.includes(storedHash);
}

function requireAdmin() {
  var role = getRole();
  if (role === ROLE_ADMIN || role === ROLE_DEPO) return true;
  if (!isAdminSessionValid()) {
    if (sessionStorage.getItem('atik_kontrol_role') === ROLE_ADMIN) {
      showToast('Oturum süresi doldu veya geçersiz. Lütfen tekrar giriş yapın.', 'error');
      sessionStorage.removeItem('atik_kontrol_role');
      sessionStorage.removeItem('atik_kontrol_admin_hash_proof');
      location.reload();
    } else {
      showToast('Bu işlem için admin yetkisi gerekli.', 'error');
    }
    return false;
  }
  return true;
}

async function doLogin() {
  const usernameSelect = document.getElementById('loginUsername');
  const input = document.getElementById('loginPassword');
  const error = document.getElementById('loginError');
  const username = usernameSelect.value;
  const inputHash = await sha256(input.value);
  
  if (!username) {
    error.textContent = 'Lütfen kullanıcı seçin!';
    error.style.display = 'block';
    return;
  }
  
  let role = null;
  let displayName = '';
  const cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
  
  // Yeni sistem: users listesinden kontrol
  if (cfg.users && Array.isArray(cfg.users)) {
    const user = cfg.users.find(u => u.username === username && u.passwordHash === inputHash);
    if (user) {
      role = user.role;
      displayName = user.displayName;
    }
  }
  
  // Eski sistem: admin/viewer hash'lerinden kontrol (geriye uyumluluk)
  if (!role) {
    const adminHashes = remoteHashes.adminHash ? [remoteHashes.adminHash] : [];
    const viewerHashes = remoteHashes.viewerHash ? [remoteHashes.viewerHash] : [];
    if (adminHashes.includes(inputHash)) { role = ROLE_ADMIN; displayName = 'Admin'; }
    else if (viewerHashes.includes(inputHash)) { role = ROLE_VIEWER; displayName = 'Görüntüleme'; }
  }

  if (role) {
    sessionStorage.setItem('atik_kontrol_role', role);
    sessionStorage.setItem('atik_kontrol_display_name', displayName);
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
  } else {
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
}

function renderAdminPanelBtn() {
  const btn = document.getElementById('adminPanelBtn');
  if (!btn) return;
  btn.style.display = getRole() === ROLE_ADMIN ? '' : 'none';
}

function openAdminPanel() {
  if (getRole() !== ROLE_ADMIN) {
    showToast('Bu işlem için admin yetkisi gerekli.', 'error');
    return;
  }
  // Güvenlik: admin şifresini tekrar sor
  document.getElementById('apReAuthContainer').style.display = 'block';
  document.getElementById('apPanelBody').style.display = 'none';
  document.getElementById('apReAuthPw').value = '';
  document.getElementById('apReAuthError').style.display = 'none';
  document.getElementById('apReAuthError').textContent = '';
  document.getElementById('apError').style.display = 'none';
  document.getElementById('apError').textContent = '';
  document.getElementById('apSuccess').style.display = 'none';
  document.getElementById('apSuccess').textContent = '';

  var settings = getViewerSettings();
  document.getElementById('apEditAllowed').checked = settings.editAllowed;
  document.getElementById('apShowExport').checked = settings.showExportBtn;
  document.getElementById('apShowSync').checked = settings.showSyncBtn;
  document.getElementById('apShowActions').checked = settings.showActions;
  var tabKeys = Object.keys(settings.tabs);
  tabKeys.forEach(function(key) {
    var cb = document.getElementById('apTab_' + key);
    if (cb) cb.checked = settings.tabs[key];
  });

  // Oturum bilgilerini göster
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
  document.getElementById('apStorageInfo').textContent = supabaseClient ? 'Supabase + Yerel' : 'Yerel (tarayıcı)';

  document.getElementById('adminPanelModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

async function apReAuth() {
  const pw = document.getElementById('apReAuthPw').value;
  const hash = await sha256(pw);
  const errorEl = document.getElementById('apReAuthError');
  if (hash === getAdminHash()) {
    document.getElementById('apReAuthContainer').style.display = 'none';
    document.getElementById('apPanelBody').style.display = 'block';
    errorEl.style.display = 'none';
    document.getElementById('apHarcamaOran').value = getOgrenciBasiHarcamaOrani();
    apRenderUserList();
  } else {
    errorEl.textContent = 'Admin şifresi yanlış!';
    errorEl.style.display = 'block';
    document.getElementById('apReAuthPw').value = '';
    document.getElementById('apReAuthPw').focus();
  }
}

function apKaydetHarcamaOrani() {
  const val = parseFloat(document.getElementById('apHarcamaOran').value);
  if (isNaN(val) || val <= 0) {
    document.getElementById('apHarcamaOranSuccess').textContent = 'Geçerli bir oran girin!';
    document.getElementById('apHarcamaOranSuccess').style.color = '#ef4444';
    document.getElementById('apHarcamaOranSuccess').style.display = 'block';
    return;
  }
  setOgrenciBasiHarcamaOrani(val);
  document.getElementById('apHarcamaOranSuccess').textContent = 'Oran kaydedildi: ' + val.toFixed(2) + ' ₺';
  document.getElementById('apHarcamaOranSuccess').style.color = '#22c55e';
  document.getElementById('apHarcamaOranSuccess').style.display = 'block';
  setTimeout(function() {
    document.getElementById('apHarcamaOranSuccess').style.display = 'none';
  }, 3000);
}

function closeAdminPanel() {
  document.getElementById('adminPanelModal').classList.remove('open');
  document.body.style.overflow = '';
}

function doLogout() {
  // Tüm veriyi temizle (sekme bazlı sessionStorage)
  var keysToKeep = ['atik_kontrol_theme', 'atik_kontrol_accent', 'atik_kontrol_viewer_settings', 'haccp_depo_adlari'];
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
  const errorEl = document.getElementById('apError');
  const successEl = document.getElementById('apSuccess');
  errorEl.style.display = 'none';
  successEl.style.display = 'none';

  var settings = getViewerSettings();
  settings.editAllowed = document.getElementById('apEditAllowed').checked;
  settings.showExportBtn = document.getElementById('apShowExport').checked;
  settings.showSyncBtn = document.getElementById('apShowSync').checked;
  settings.showActions = document.getElementById('apShowActions').checked;
  var tabKeys = Object.keys(settings.tabs);
  tabKeys.forEach(function(key) {
    var cb = document.getElementById('apTab_' + key);
    if (cb) settings.tabs[key] = cb.checked;
  });
  localStorage.setItem('atik_kontrol_viewer_settings', JSON.stringify(settings));

  successEl.textContent = 'Ayarlar güncellendi.';
  successEl.style.display = 'block';
  showToast('Ayarlar kaydedildi.', 'success');
  applyRolePermissions();
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
    var roleLabel = roleLabels[user.role] || user.role;
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
}

function apEditUser(index) {
  if (getRole() !== ROLE_ADMIN) return;
  var users = getUsers();
  var user = users[index];
  if (!user) return;

  var roleLabels = { admin: 'Admin', diyetisyen: 'Diyetisyen', depo: 'Depo Sorumlusu', asci: 'Aşçı' };

  var container = document.getElementById('apUserList');
  var html = '<div style="background:var(--bg-card);border:2px solid var(--accent);border-radius:8px;padding:0.75rem">';
  html += '<div style="font-size:0.85rem;font-weight:600;color:var(--accent);margin-bottom:0.5rem">Kullanıcıyı Düzenle</div>';
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
  ['admin','diyetisyen','depo','asci'].forEach(function(r) {
    html += '<option value="' + r + '"' + (user.role === r ? ' selected' : '') + '>' + (roleLabels[r] || r) + '</option>';
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
}

function getViewerSettings() {
  try {
    const saved = localStorage.getItem('atik_kontrol_viewer_settings');
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return {
    editAllowed: false,
    tabs: { dashboard: true, menu: true, records: true, report: true, haccp: true, yag: true, ambalaj: true, charts: true },
    showExportBtn: false,
    showSyncBtn: false,
    showActions: false
  };
}

function applyViewerRestrictions() {
  if (getRole() !== ROLE_ADMIN) {
    const settings = getViewerSettings();
    Object.keys(settings.tabs).forEach(function(key) {
      var btn = document.getElementById('tab-' + key);
      if (btn) btn.style.display = settings.tabs[key] ? '' : 'none';
    });
    var actionBtn = document.querySelector('.sidebar-nav .tab-btn[onclick*="openModal"]');
    if (actionBtn) actionBtn.style.display = settings.showActions ? '' : 'none';
    var exportBtn = document.querySelector('.sidebar-actions .tab-btn[onclick*="exportData"]');
    if (exportBtn) exportBtn.style.display = settings.showExportBtn ? '' : 'none';
    var syncBtn = document.querySelector('.sidebar-actions .tab-btn[onclick*="syncAllToSupabase"]');
    if (syncBtn) syncBtn.style.display = settings.showSyncBtn ? '' : 'none';
    var pullBtn = document.querySelector('.sidebar-actions .tab-btn[onclick*="syncAllFromSupabase"]');
    if (pullBtn) pullBtn.style.display = settings.showSyncBtn ? '' : 'none';
    if (!settings.editAllowed) {
      document.querySelectorAll('.menu-table textarea, .menu-table input, .note-input, .kisi-input, #haccpForm textarea, #haccpForm input, #haccpForm select, #entryForm input, #entryForm select, #entryForm textarea, #yagForm input, #yagForm select, #ambalajForm input, #ambalajForm select').forEach(function(el) {
        el.readOnly = true; el.disabled = true; el.style.opacity = '0.7';
      });
      document.querySelectorAll('[contenteditable]').forEach(function(el) { el.removeAttribute('contenteditable'); });
      document.querySelectorAll('.btn-primary[onclick*="openModal"], .btn-primary[onclick*="openHaccpModal"], .btn-primary[onclick*="openYagModal"], .btn-primary[onclick*="openAmbalajModal"]').forEach(function(el) { el.style.display = 'none'; });
    }
  }
}

function applyRolePermissions() {
  var role = getRole();
  // Tüm sekmeleri başlangıçta göster
  document.querySelectorAll('.tab-btn').forEach(function(btn) { btn.style.display = ''; });
  
  if (role === ROLE_ADMIN) {
    // Admin: her şeye erişebilir
    return;
  }
  
  // Diyetisyen: menü ve rapor sekmeleri, diğerleri gizli
  if (role === ROLE_DIYETISYEN) {
    var allowedTabs = ['menu', 'report', 'charts'];
    var allowedSidebar = [];
    document.querySelectorAll('.sidebar-nav .tab-btn').forEach(function(btn) {
      var tabId = btn.id.replace('tab-', '');
      var onclick = btn.getAttribute('onclick') || '';
      if (allowedTabs.indexOf(tabId) === -1) btn.style.display = 'none';
    });
    document.querySelectorAll('.sidebar-actions .tab-btn').forEach(function(btn) {
      var onclick = btn.getAttribute('onclick') || '';
      var allowed = false;
      allowedSidebar.forEach(function(s) { if (onclick.includes(s)) allowed = true; });
      if (!allowed) btn.style.display = 'none';
    });
    document.querySelectorAll('.btn-primary[onclick*="openModal"], .btn-primary[onclick*="openHaccpModal"], .btn-primary[onclick*="openYagModal"], .btn-primary[onclick*="openAmbalajModal"]').forEach(function(el) { el.style.display = 'none'; });
    // Menü: üretim bölümünü devre dışı bırak
    document.querySelectorAll('#productionSection, #weeklyTotalSection').forEach(function(el) { el.style.display = 'none'; });
    // Menü: "Yemek Listesi" butonunu gizle
    document.querySelectorAll('.btn-ghost[onclick*="openYemekModal"]').forEach(function(el) { el.style.display = 'none'; });
    // Menü: yemek seçme ve not yazma alanlarını aktif et (applyViewerRestrictions devre dışı bırakmış olabilir)
    for (var ci = 0; ci < 5; ci++) {
      for (var di = 0; di < 5; di++) {
        var ta = document.getElementById('m' + ci + '_' + di);
        if (ta) { ta.readOnly = false; ta.disabled = false; ta.style.opacity = ''; }
      }
    }
    document.querySelectorAll('.note-input').forEach(function(el) { el.readOnly = false; el.disabled = false; el.style.opacity = ''; });
    // Kişi sayısını aktif et
    document.querySelectorAll('.kisi-input').forEach(function(el) { el.readOnly = false; el.disabled = false; el.style.opacity = ''; });
  }
  
  // Depo: admin gibi tüm sekmelere erişir, ama admin panelini ve CSV/JSON/yükleme butonlarını görmez; sadece PDF indirir
  if (role === ROLE_DEPO) {
    // Tüm sekmeler açık (admin gibi)
    // Admin panelini gizle
    document.getElementById('adminPanelBtn').style.display = 'none';
    // Sidebar'dan Dışa Aktar, Supabase'e Yedekle ve Supabase'ten Çek butonlarını gizle
    document.querySelectorAll('.sidebar-actions .tab-btn').forEach(function(btn) {
      var onclick = btn.getAttribute('onclick') || '';
      if (onclick.includes('exportData') || onclick.includes('syncAllToSupabase') || onclick.includes('syncAllFromSupabase')) btn.style.display = 'none';
    });
    // CSV/JSON/yükleme butonlarını gizle, PDF butonlarını koru
    document.querySelectorAll('button[onclick]').forEach(function(btn) {
      var onclick = btn.getAttribute('onclick') || '';
      if (onclick.includes('triggerImport') || onclick.includes('exportDataCSV') ||
          onclick.includes('exportHaccpCSV') || onclick.includes('haccpFileInput') ||
          onclick.includes('yemekCSVUpload') || onclick.includes('exportDataJSON') ||
          onclick.includes('exportDataSettings') || onclick.includes('importFullBackup') ||
          onclick.includes('importBackupInput')) {
        btn.style.display = 'none';
      }
    });
    // HACCP, yağ, ambalaj ekleme butonlarını geri aç
    document.querySelectorAll('.btn-primary[onclick*="openModal"], .btn-primary[onclick*="openHaccpModal"], .btn-primary[onclick*="openYagModal"], .btn-primary[onclick*="openAmbalajModal"]').forEach(function(el) { el.style.display = ''; });
    // HACCP form alanlarını aktif et
    document.querySelectorAll('#haccpForm textarea, #haccpForm input, #haccpForm select').forEach(function(el) { el.readOnly = false; el.disabled = false; el.style.opacity = ''; });
  }
  
  // Aşçı: sadece menü, üretim bölümünü göster
  if (role === ROLE_ASCI) {
    var allowedTabs = ['menu'];
    document.querySelectorAll('.sidebar-nav .tab-btn').forEach(function(btn) {
      var tabId = btn.id.replace('tab-', '');
      if (allowedTabs.indexOf(tabId) === -1) btn.style.display = 'none';
    });
    document.querySelectorAll('.sidebar-actions .tab-btn').forEach(function(btn) { btn.style.display = 'none'; });
    // Menü: "Yemek Listesi" butonunu gizle
    document.querySelectorAll('.btn-ghost[onclick*="openYemekModal"]').forEach(function(el) { el.style.display = 'none'; });
    // Hücrelere tıklama ile yemek seçicisini kapat (showMenuMealPicker içinde ROLE_ASCI kontrolü var)
    for (var ci = 0; ci < 5; ci++) {
      for (var di = 0; di < 5; di++) {
        var ta = document.getElementById('m' + ci + '_' + di);
        if (ta) { ta.style.cursor = 'default'; }
      }
    }
    document.querySelectorAll('.note-input').forEach(function(el) { el.readOnly = false; el.disabled = false; el.style.opacity = ''; });
    document.querySelectorAll('.kisi-input').forEach(function(el) { el.readOnly = false; el.disabled = false; el.style.opacity = ''; });
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
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadUsersFromStorage();
  populateLoginUsers();
  document.getElementById('loginPassword').focus();
  await syncPasswordHashesFromRemote().catch(function(){});
  await syncUsersFromSupabase().catch(function(){}).then(function() { populateLoginUsers(); });
  var existingRole = sessionStorage.getItem('atik_kontrol_role');
  if (existingRole) {
    document.getElementById('loginOverlay').classList.add('hidden');
    document.body.setAttribute('data-role', existingRole);
    var displayName = sessionStorage.getItem('atik_kontrol_display_name') || (existingRole === ROLE_ADMIN ? 'Admin' : 'Görüntüleme');
    document.getElementById('roleBadge').textContent = displayName;
    renderAdminPanelBtn();
    applyRolePermissions();
  } else {
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
  renderAll();
  drawAllCharts();
  await restoreActiveTab();

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

// ─── AUTO POLL (3 dk) & INACTIVITY LOCK (10 dk) ──────────────────────────────
let pollInterval = null;
let inactivityTimer = null;
const POLL_INTERVAL = 180000;
const INACTIVITY_TIMEOUT = 300000;

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
  if (getRole()) {
    inactivityTimer = setTimeout(lockScreen, INACTIVITY_TIMEOUT);
  }
}

function lockScreen() {
  stopPolling();
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
function getOgrenciBasiHarcamaOrani() {
  var val = localStorage.getItem('ogrenci_basi_harcama_orani');
  return val !== null ? parseFloat(val) : 70.37;
}
function setOgrenciBasiHarcamaOrani(val) {
  localStorage.setItem('ogrenci_basi_harcama_orani', String(val));
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
function exportHaccpCSV() {
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
        not: r.not_ || ''
      }; });
      saveAmbalajData();
      renderAmbalajTable();
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
    showToast('Supabase\'e yedeklendi: ' + (toastMsg.join(', ') || 'güncel veri yok'), 'success');
  } catch (err) {
    showToast('Supabase hatası: ' + err.message, 'error');
  }
}

async function syncAllFromSupabase() { if (!requireAdmin()) return;
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
    showToast('Supabase\'ten alındı: ' + (toastMsg.join(', ') || 'veri yok'), 'success');
  } catch (err) {
    showToast('Supabase hatası: ' + err.message, 'error');
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
  const list = loadHaccpDepoAdlari().filter(n => n !== name);
  saveHaccpDepoAdlari(list);
  delete depoLimitleriCache[name];
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

  // batch bar
  var batchBar = document.getElementById('haccpBatchBar');
  var batchCount = document.getElementById('haccpBatchCount');
  if (haccpSelectedIds.size > 0) {
    batchBar.style.display = 'flex';
    batchCount.textContent = haccpSelectedIds.size + ' seçili';
  } else {
    batchBar.style.display = 'none';
  }

  // header checkbox state
  var allSelected = pageRecords.every(function(r) { return haccpSelectedIds.has(r.id); });

  tbody.innerHTML = pageRecords.map(r => {
    var checked = haccpSelectedIds.has(r.id) ? ' checked' : '';
    const depoAd = r.depoAd || ('Depo ' + r.depoNo);
    const durum = sicaklikDurum(r.sicaklik, depoAd);
    return `<tr>
      <td><input type="checkbox" class="haccp-select-chk" data-id="${r.id}"${checked} onchange="haccpToggleSelect(${r.id})" style="cursor:pointer"></td>
      <td>${formatTarihTR(r.tarih)}</td>
      <td>${r.saat || '—'}</td>
      <td>${depoAd}</td>
      <td class="${durum.cls}"><strong>${r.sicaklik != null && !isNaN(r.sicaklik) ? Number(r.sicaklik).toLocaleString('tr-TR', {minimumFractionDigits:1,maximumFractionDigits:1}) : '—'}</strong></td>
      <td>${r.nem != null && r.nem !== '' && !isNaN(r.nem) ? Number(r.nem).toLocaleString('tr-TR', {minimumFractionDigits:0,maximumFractionDigits:1}) : '—'}</td>
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

  // update header checkbox
  var headerChk = document.getElementById('haccpSelectAllChk');
  if (headerChk) headerChk.checked = allSelected;

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

function haccpToggleSelect(id) {
  if (haccpSelectedIds.has(id)) haccpSelectedIds.delete(id);
  else haccpSelectedIds.add(id);
  renderHaccpSicaklik();
}

function haccpToggleSelectAll(checked) {
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

async function haccpDeleteSelected() { if (!requireAdmin()) return;
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
  if (!requireAdmin()) return;
  e.preventDefault();
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

async function deleteHaccpRecord(type, id) { if (!requireAdmin()) return;
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
  const labels = { dashboard: 'Panel', menu: 'Haftalık Menü', records: 'Kayıtlar', charts: 'Grafikler', report: 'Rapor', haccp: 'Gıda Güvenliği', yag: 'Atık Yağ', ambalaj: 'Ambalaj Atıkları' };
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
  document.getElementById('fHarcama').value = (rec.harcama_tutari || 0).toFixed(2);
  autoCalc();
  autoCalcHarcama();
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

function autoCalcHarcama() {
  const ogrenci = parseInt(document.getElementById('fOgrenci').value) || 0;
  const oran = getOgrenciBasiHarcamaOrani();
  const harcama = ogrenci * oran;
  document.getElementById('fHarcama').value = harcama.toFixed(2);
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
  if (!requireAdmin()) return;
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
    const atik = Math.max(0, (yemek - fire - toplam) * porsiyon / 1000);
    const harcama_tutari = ogrenci * getOgrenciBasiHarcamaOrani();

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
    } else {
      records.push(rec);
      showToast('Yeni kayıt başarıyla eklendi.', 'success');
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
async function deleteRecord(id) { if (!requireAdmin()) return;
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
        // Delimiter detection: comma or semicolon
        const firstLine = lines[0];
        const delim = firstLine.includes(';') ? ';' : ',';
        const headers = firstLine.split(delim).map(h => h.replace(/^"|"$/g, '').trim());
        const fieldMap = {
          'Tarih': 'tarih', 'Üretilen Yemek Sayısı': 'yemek', 'Üretilen Yemek': 'yemek',
          '%10 Fire': 'fire', '%10 fire': 'fire', 'Fire': 'fire',
          'Turnike Geçiş Sayısı': 'turnike', 'Turnike Geçiş': 'turnike', 'Turnike': 'turnike',
          'Yemekhanede Çalışan Personel Sayısı': 'personel', 'Pers. Sayısı': 'personel',
          'Toplam Geçiş': 'toplam', 'Toplam Geçiş Sayısı': 'toplam', 'Toplam': 'toplam',
          'Porsiyon Miktarı (gr)': 'porsiyon', 'Porsiyon (gr)': 'porsiyon', 'Porsiyon': 'porsiyon',
          'Atık Miktarı (kg)': 'atik', 'Atık (kg)': 'atik', 'Atık': 'atik',
          'Yemek Hiz. Yar. Öğr. Sayısı': 'ogrenci', 'Öğrenci Sayısı': 'ogrenci',
          'Yemek Türü': 'yemek_adi', 'Yemek Adı': 'yemek_adi',
          'Harcama Tutarı (₺)': 'harcama_tutari', 'Harcama Tutarı': 'harcama_tutari',
          'tarih': 'tarih', 'yemek': 'yemek', 'fire': 'fire', 'turnike': 'turnike',
          'personel': 'personel', 'toplam': 'toplam', 'porsiyon': 'porsiyon',
          'atik': 'atik', 'ogrenci': 'ogrenci', 'harcama_tutari': 'harcama_tutari', 'yemek_adi': 'yemek_adi'
        };
        function parseNum(v) {
          if (!v) return 0;
          v = String(v).trim().replace(/"/g, '');
          return Number(v.replace(',', '.')) || 0;
        }
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(delim).map(v => v.replace(/^"|"$/g, '').trim());
          const row = {};
          headers.forEach((h, idx) => {
            const field = fieldMap[h] || h;
            row[field] = vals[idx] || '';
          });
          if (row.tarih) {
            row.tarih = normalizeDate(row.tarih);
            row.id = Date.now() + i;
            row.yemek = parseNum(row.yemek);
            row.fire = parseNum(row.fire);
            row.turnike = parseNum(row.turnike);
            row.personel = parseNum(row.personel);
            row.toplam = parseNum(row.toplam);
            row.porsiyon = parseNum(row.porsiyon);
            row.atik = parseNum(row.atik);
            row.ogrenci = parseNum(row.ogrenci);
            row.harcama_tutari = parseNum(row.harcama_tutari);
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

function exportDataCSV() {
  if (records.length === 0) { showToast('Dışa aktarılacak kayıt yok.', 'error'); return; }
  var headers = ['Tarih','Üretilen Yemek Sayısı','%10 Fire','Turnike Geçiş Sayısı','Yemekhanede Çalışan Personel Sayısı','Toplam Geçiş','Porsiyon Miktarı (gr)','Atık Miktarı (kg)','Yemek Hiz. Yar. Öğr. Sayısı','Harcama Tutarı (₺)','Yemek Adı'];
  var rows = records.map(function(r) { return [
    r.tarih || '', r.yemek || 0, r.fire || 0, r.turnike || 0, r.personel || 0,
    r.toplam || 0, r.porsiyon || 0, r.atik || 0, r.ogrenci || 0, r.harcama_tutari || 0, (r.yemek_adi || '').replace(/"/g,'""')
  ]; });
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

function exportDataSettings() {
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
  renderTodaySummary();
  renderDataInfo();
  renderLastRecordsTable();
  renderRecordsTable();
  renderReport();
  renderSparklines();
  renderComparison();
  renderWeeklyComparison();
  renderAnomalies();
  renderHaccp();
  renderYagTable();
  renderAmbalajTable();
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

  badge.textContent = (thisMon.getDate()+'/'+(thisMon.getMonth()+1)) + ' - ' + (thisSun.getDate()+'/'+(thisSun.getMonth()+1)) + ' vs ' + (lastMon.getDate()+'/'+(lastMon.getMonth()+1)) + ' - ' + (lastSun.getDate()+'/'+(lastSun.getMonth()+1));

  var items = [
    { label: 'Toplam Atık (kg)', val: thisAtik, prev: lastAtik, unit: ' kg', lower: true, decimals: 1 },
    { label: 'Toplam Üretim', val: thisYemek, prev: lastYemek, unit: '', lower: false, decimals: 0 },
    { label: 'Kişi Başı Atık (gr)', val: thisKisiAtik, prev: lastKisiAtik, unit: ' gr', lower: true, decimals: 2 },
  ];

  grid.innerHTML = items.map(function(it) {
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

function renderAnomalies() {
  const card = document.getElementById('anomalyCard');
  const grid = document.getElementById('anomalyGrid');
  const badge = document.getElementById('anomalyBadge');
  if (!card || records.length < 5) { if (card) card.style.display = 'none'; return; }

  var values = records.map(function(r) { return r.atik || 0; });
  var mean = values.reduce(function(s, v) { return s + v; }, 0) / values.length;
  var stddev = Math.sqrt(values.reduce(function(s, v) { return s + (v - mean) * (v - mean); }, 0) / values.length);
  var threshold = mean + 1.5 * stddev;

  var anomalies = records.filter(function(r) { return (r.atik || 0) > threshold; });
  anomalies.sort(function(a, b) { return a.tarih < b.tarih ? 1 : -1; });

  if (anomalies.length === 0) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  badge.textContent = anomalies.length + ' anormal gün';

  var header = '<div class="anomaly-header">'
    + '<span style="width:28px;flex-shrink:0"></span>'
    + '<span style="min-width:90px;text-align:center">Tarih</span>'
    + '<span style="min-width:90px">Atık</span>'
    + '<span style="min-width:70px;text-align:center">Fark</span>'
    + '<span style="margin-left:auto">Yemek</span>'
    + '</div>';

  grid.innerHTML = header + anomalies.map(function(r) {
    var pctAbove = mean > 0 ? ((r.atik - mean) / mean) * 100 : 0;
    return '<div class="anomaly-item">'
      + '<span class="anomaly-icon">⚠</span>'
      + '<span class="anomaly-date">' + displayDate(r.tarih) + '</span>'
      + '<span style="font-weight:700;font-size:1.05rem;min-width:90px">' + (r.atik || 0).toFixed(1) + ' kg</span>'
      + '<span style="color:var(--text-muted);font-size:0.78rem;min-width:70px;text-align:center">+' + pctAbove.toFixed(0) + '%</span>'
      + '<span style="color:var(--text-muted);margin-left:auto;font-size:0.85rem">' + (r.yemek_adi || '—') + '</span>'
      + '</div>';
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
  const dateStr = displayDate(r.tarih);

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
    <td class="td-harcama">${Number(r.harcama_tutari || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺</td>
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
          const birimLabel = birim === 'gr' ? ' gr' : birim === 'ml' ? ' ml' : birim === 'lt' ? ' lt' : ' ' + birim;
          html += `<div class="prod-ing"><span class="prod-num">${idx + 1}.</span><span class="prod-name">${escapeHtml(ing.malzeme.trim())} <span class="prod-kisi-birim">(${miktarKisi}${birimLabel})</span></span><span class="prod-sep">—</span><span class="prod-qty">${fmt(total, birim)}</span></div>`;
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
      if (!agg[key]) agg[key] = { ad: ing.malzeme.trim(), birim, total: 0, miktarKisi: miktarKisi, birimLabel: birim === 'gr' ? ' gr' : birim === 'ml' ? ' ml' : birim === 'lt' ? ' lt' : ' ' + birim };
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
        return `<div class="weekly-total-item"><span class="weekly-total-num">${idx + 1}.</span><span class="weekly-total-name">${escapeHtml(e.ad)} <span class="prod-kisi-birim">(${e.miktarKisi}${e.birimLabel})</span></span><span class="weekly-total-sep">—</span><span class="weekly-total-qty">${fmtTotal(total, e.birim)}</span></div>`;
      }).filter(Boolean).join('')}</div>
    </div>
  </div>`;
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
  document.getElementById('yemekModal').classList.add('open');
  document.getElementById('yemekSearchInput').value = '';
  editingYemekId = null;
  document.getElementById('yemekFormContainer').style.display = 'none';
  renderYemekListesi();
  // Background'da Supabase'ten taze veri çek (cache güncelle)
  syncDishesFromSupabase().then(updated => { if (updated) renderYemekListesi(); });
}
function closeYemekModal() {
  document.getElementById('yemekModal').classList.remove('open');
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
  const days = GUNLER.map((gun, i) => {
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
    if (e.target.id && e.target.id.startsWith('m') && e.target.id.includes('_')) {
      activeDishTextarea = e.target;
      showDishDropdown(e.target);
      autoResizeTextarea(e.target);
    }
  });

  document.addEventListener('input', function(e) {
    if (e.target.id && e.target.id.startsWith('m') && e.target.id.includes('_')) {
      autoResizeTextarea(e.target);
    }
    if (e.target === activeDishTextarea) {
      showDishDropdown(e.target);
    }
    if (e.target.id && e.target.id.startsWith('m') && e.target.id.includes('_')) {
      refreshMenuProduction();
    }
  });

  function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  }

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
  const totalHarcama = records.reduce((s,r) => s+(r.harcama_tutari||0), 0);
  const atikValues = records.map(r => r.atik || 0);
  const maxAtik = Math.max(...atikValues);
  const minAtik = Math.min(...atikValues);
  const maxAtikRec = records.find(r => (r.atik||0) === maxAtik);
  const minAtikRec = records.find(r => (r.atik||0) === minAtik);
  const maxAtikDate = maxAtikRec ? displayDate(maxAtikRec.tarih) : '';
  const minAtikDate = minAtikRec ? displayDate(minAtikRec.tarih) : '';

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
  document.getElementById('rTotalGecis').textContent = totalGecis.toLocaleString('tr-TR');
  document.getElementById('rAvgPorsiyon').textContent = avgPorsiyon.toFixed(0) + ' gr';
  document.getElementById('rMaxWeekGecis').innerHTML = maxWeekLabel !== '—' ? `${maxWeekLabel} <br><span style="font-size:0.9rem;opacity:0.8;font-weight:normal">(${maxWeekVal.toLocaleString('tr-TR')} Geçiş)</span>` : '—';
  document.getElementById('rTotalAtik').textContent = totalAtik.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' kg';
  document.getElementById('rAvgAtik').textContent = (totalAtik / n).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' kg';
  document.getElementById('rTotalOgrenci').textContent = totalOgrenci.toLocaleString('tr-TR');
  document.getElementById('rTotalHarcama').textContent = totalHarcama.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ₺';
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

const chartInstances = new Map();
const chartValueLabelPlugin = {
  id: 'valueLabels',
  afterDraw(chart) {
    if (!chart.options.plugins.valueLabels) return;
    const pos = chart.options.plugins.valueLabelsPosition || 'above';
    const ctx = chart.ctx;
      chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      meta.data.forEach((bar, idx) => {
        const val = ds.data[idx];
        if (val === undefined || val === null || isNaN(val)) return;
        if (pos === 'inside') {
          ctx.fillStyle = '#000000';
          ctx.font = 'bold 11px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText((val >= 100 ? Math.round(val) : val.toFixed(1)).toString(), bar.x, bar.y + bar.height / 2);
        } else {
          ctx.fillStyle = chart.options.plugins?.legend?.labels?.color || '#334155';
          ctx.font = 'bold 11px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const display = val >= 100 ? Math.round(val).toString() : val >= 10 ? val.toFixed(1) : val.toFixed(2);
          ctx.fillText(display, bar.x, bar.y - 7);
        }
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
    const y = new Date(r.tarih + 'T12:00:00').getFullYear();
    return y === Number(chartYearFilter);
  });

  const emptyIds = ['chartAtikEmpty','chartYemekEmpty','chartTurnikeEmpty','chartAylikEmpty','chartFarkEmpty','chartAtikOranEmpty','chartOgrenciEmpty','chartKarbonEmpty','chartAtikPerKisiEmpty','chartHaftalikGecisEmpty','chartHaccpAylikEmpty','chartHarcamaEmpty'];
  const canvasIds = ['canvasAtik','canvasYemek','canvasTurnike','canvasAylik','canvasFark','canvasAtikOran','canvasOgrenci','canvasKarbon','canvasAtikPerKisi','canvasHaftalikGecis','canvasHaccpAylik','canvasHarcama'];

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
      monthlyData[monthKey] = { yemek: 0, toplam: 0, atik: 0, turnike: 0, ogrenci: 0, harcama: 0 };
    }
    monthlyData[monthKey].yemek += r.yemek;
    monthlyData[monthKey].toplam += r.toplam;
    monthlyData[monthKey].atik += r.atik;
    monthlyData[monthKey].turnike += r.turnike;
    monthlyData[monthKey].ogrenci += r.ogrenci;
    monthlyData[monthKey].harcama += (r.harcama_tutari || 0);
  });

  const chartYears = [Number(chartYearFilter)];
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
  try { makeChart('canvasAtik', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'atik')), color: '#f97316', label: 'Aylik Atik (kg)' }], { onClick: clickHandler }); } catch(e) { console.warn('chartAtik error:', e); }
  try { makeChart('canvasYemek', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'yemek')), color: '#6366f1', label: 'Aylik Uretim Sayisi' }], { onClick: clickHandler }); } catch(e) { console.warn('chartYemek error:', e); }
  try { makeChart('canvasTurnike', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'toplam')), color: '#10b981', label: 'Aylik Turnike Gecisi' }], { onClick: clickHandler }); } catch(e) { console.warn('chartTurnike error:', e); }

  const prevYearAtik = allMonthLabels.map(m => {
    const [ay, yil] = m.split('/');
    return getMonthVal(ay + '/' + (parseInt(yil) - 1), 'atik');
  });
  const hasPrevYear = prevYearAtik.some(v => v > 0);
  const aylikSets = [
    { data: allMonthLabels.map(m => getMonthVal(m, 'yemek')), color: '#6366f1', label: 'Aylik Uretim' },
    { data: allMonthLabels.map(m => getMonthVal(m, 'toplam')), color: '#22d3ee', label: 'Aylik Gecis' },
    { data: allMonthLabels.map(m => getMonthVal(m, 'atik')), color: '#f59e0b', label: 'Aylik Atik (kg)' },
  ];
  if (hasPrevYear) aylikSets.push({ data: prevYearAtik, color: '#f59e0b', label: 'Gecen Yil Atik (kg)', dashed: true });
  try { makeChart('canvasAylik', allMonthLabels, aylikSets, { onClick: clickHandler, type: 'bar' }); } catch(e) { console.warn('chartAylik error:', e); }

  const farkData = allMonthLabels.map(m => getMonthVal(m, 'yemek') - getMonthVal(m, 'toplam'));
  try { makeChart('canvasFark', allMonthLabels, [{ data: farkData, color: '#8b5cf6', label: 'Uretim ile Turnike Gecisi Arasindaki Fark' }], { onClick: clickHandler }); } catch(e) { console.warn('chartFark error:', e); }

  const aylikOran = allMonthLabels.map(m => {
    const y = getMonthVal(m, 'yemek'), a = getMonthVal(m, 'atik');
    return y > 0 ? (a / y * 100) : 0;
  });
  try { makeChart('canvasAtikOran', allMonthLabels, [{ data: aylikOran, color: '#a855f7', label: 'Aylik Atik Orani %' }], { onClick: clickHandler }); } catch(e) { console.warn('chartAtikOran error:', e); }
  try { makeChart('canvasOgrenci', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'ogrenci')), color: '#a855f7', label: 'Aylik Ogrenci Sayisi' }], { onClick: clickHandler }); } catch(e) { console.warn('chartOgrenci error:', e); }
  try { makeChart('canvasHarcama', allMonthLabels, [{ data: allMonthLabels.map(m => getMonthVal(m, 'harcama')), color: '#14b8a6', label: 'Aylik Harcama Tutari (₺)' }], { onClick: clickHandler }); } catch(e) { console.warn('chartHarcama error:', e); }

  const karbonData = allMonthLabels.map(m => getMonthVal(m, 'atik') * 2.5);
  try { makeChart('canvasKarbon', allMonthLabels, [{ data: karbonData, color: '#22c55e', label: 'Karbon Ayak Izi (kg CO2)' }], { onClick: clickHandler }); } catch(e) { console.warn('chartKarbon error:', e); }

  const atikPerKisi = allMonthLabels.map(m => {
    const t = getMonthVal(m, 'toplam'), a = getMonthVal(m, 'atik');
    return t > 0 ? a / t : 0;
  });
  try { makeChart('canvasAtikPerKisi', allMonthLabels, [{ data: atikPerKisi, color: '#d946ef', label: 'Kisi Basi Atik (kg/kisi)' }], { onClick: clickHandler }); } catch(e) { console.warn('chartAtikPerKisi error:', e); }

  // Weekly
  const weeklyData = {};
  sorted.forEach(r => {
    const d = new Date(r.tarih + 'T12:00:00');
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
    try { makeChart('canvasHaftalikGecis', weekLabels, [{ data: weekValues, color: '#0ea5e9', label: 'Haftalik Gecis' }], { onClick: clickHandler }); } catch(e) { console.warn('chartHaftalikGecis error:', e); }
  }

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
    var depoRenkPaleti = ['#6366f1', '#f97316', '#10b981', '#a855f7', '#22d3ee', '#f59e0b', '#ef4444', '#d946ef'];
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
    try { makeChart('canvasHaccpAylik', aylikAyLabels, aylikDatasets, { type: 'bar', showValues: true }); } catch(e) { console.warn('chartHaccpAylik error:', e); }
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
        <thead><tr><th>Tarih</th><th>Üretim</th><th>Geçiş</th><th>Atık</th><th>Öğrenci</th><th>Harcama</th><th>Yemek Türü</th></tr></thead>
        <tbody>${records.slice(0, 100).map(r => `<tr>
          <td>${displayDate(r.tarih)}</td>
          <td>${r.yemek || '—'}</td>
          <td>${r.toplam || '—'}</td>
          <td>${(r.atik||0).toFixed(1)}</td>
          <td>${r.ogrenci || '—'}</td>
          <td>${Number(r.harcama_tutari || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺</td>
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
        return `<td><div class="menu-cell-pick" id="m${ci}_${di}" data-ci="${ci}" data-di="${di}" style="min-height:60px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:0.85rem;cursor:pointer;white-space:pre-wrap;word-break:break-word;overflow:hidden">${val || '<span style="color:var(--text-muted);opacity:0.5">' + escapeHtml(label) + '</span>'}</div></td>`;
      }).join('')}
    </tr>`;
  }).join('') + `<tr>
    <td><strong>Kişi Sayısı</strong></td>
    ${days.map((d, di) => {
      return `<td><input type="number" class="kisi-input" id="mk_${di}" value="${Number(d.data.kisi) || 0}" min="0" placeholder="0" oninput="refreshMenuProduction()" /></td>`;
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
    tr.innerHTML = `<td><strong>Not ${ni + 1}</strong>
      <button class="btn btn-ghost btn-sm" onclick="removeNoteRow(${ni})" title="Bu notu sil" style="font-size:0.8rem;padding:0 0.3rem;line-height:1;margin-left:4px;color:var(--accent-red);${visibleNoteCount <= 1 ? 'display:none' : ''}">−</button>
    </td>
      ${days.map((d, di) => {
        const val = escapeHtml((d.data.notlar && d.data.notlar[ni]) || '');
        return `<td><textarea class="note-input" id="mn_${ni}_${di}" rows="1" placeholder="...">${val}</textarea></td>`;
      }).join('')}`;
    tbody.appendChild(tr);
  }
  // + butonu satırı
  let addRow = document.createElement('tr');
  addRow.id = 'noteAddRow';
  addRow.innerHTML = `<td style="vertical-align:middle">
    <button class="btn btn-ghost btn-sm" onclick="addNoteRow()" title="Yeni not ekle" style="font-size:1.1rem;padding:0.2rem 0.6rem;line-height:1">+</button>
  </td>
  ${days.map(() => `<td></td>`).join('')}`;
  tbody.appendChild(addRow);
  // yemek seçici: çeşit hücrelerine tıklayınca liste aç
  for (let ci = 0; ci < 5; ci++) {
    for (let di = 0; di < 5; di++) {
      const cell = document.getElementById('m' + ci + '_' + di);
      if (cell) cell.addEventListener('click', showMenuMealPicker);
    }
  }
  renderProduction(weekKey, weekData, days);
  applyViewerRestrictions();
  applyRolePermissions();
}

let _pickerCi = 0, _pickerDi = 0;

async function showMenuMealPicker(e) {
  if (getRole() === ROLE_ASCI) return;
  const cell = e.currentTarget;
  if (!cell) return;
  const id = cell.id;
  const m = id.match(/^m(\d)_(\d)$/);
  if (!m) return;
  _pickerCi = parseInt(m[1]);
  _pickerDi = parseInt(m[2]);
  let list = loadYemekler();
  if (!list.length) {
    await syncDishesFromSupabase();
    list = loadYemekler();
  }
  if (!list.length) { showToast('Yemek listesi boş. Önce Yemek Listesi\'ne CSV yükleyin.', 'warning'); return; }
  const mevcut = cell.textContent.trim().split('\n')[0];
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
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('mealPickerOverlay').style.display='none'">✕</button>
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

function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
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

async function saveWeeklyMenu() {
  var role = getRole();
  if (role !== ROLE_ADMIN && role !== ROLE_DIYETISYEN && role !== ROLE_ASCI) { showToast('Bu işlem için yetkiniz yok.', 'error'); return; }
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
      yemekler.push(el ? el.textContent : '');
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

function addNoteRow() {
  const ni = window._menuNoteCount || 1;
  const tbody = document.getElementById('menuTbody');
  const tr = document.createElement('tr');
  tr.id = 'noteRow_' + ni;
  tr.innerHTML = `<td><strong>Not ${ni + 1}</strong>
    <button class="btn btn-ghost btn-sm" onclick="removeNoteRow(${ni})" title="Bu notu sil" style="font-size:0.8rem;padding:0 0.3rem;line-height:1;margin-left:4px;color:var(--accent-red)">−</button>
  </td>
    ${GUNLER.map((_, di) => `<td><textarea class="note-input" id="mn_${ni}_${di}" rows="1" placeholder="..."></textarea></td>`).join('')}`;
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
    GUNLER.forEach((_, di) => {
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

function clearWeeklyMenu() { if (!requireAdmin()) return;
  if (!confirm('Bu haftanın menüsünü temizlemek istediğinize emin misiniz?')) return;
  const monday = getWeekStartDate(menuWeekOffset);
  GUNLER.forEach((_, i) => {
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
      GUNLER.forEach((gun, i) => {
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
      GUNLER.forEach((_, i) => {
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

function renderYagTable() {
  const tbody = document.getElementById('yagTbody');
  const table = document.getElementById('yagTable');
  const empty = document.getElementById('emptyStateYag');
  const badge = document.getElementById('yagBadge');

  badge.textContent = yagRecords.length + ' kayıt';

  if (yagRecords.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    drawYagChart();
    return;
  }

  let filtered = [...yagRecords];
  var yagTarihBas = document.getElementById('yagTarihBas');
  var yagTarihBit = document.getElementById('yagTarihBit');
  if (yagTarihBas && yagTarihBas.value) filtered = filtered.filter(function(r) { return r.tarih >= yagTarihBas.value; });
  if (yagTarihBit && yagTarihBit.value) filtered = filtered.filter(function(r) { return r.tarih <= yagTarihBit.value; });
  var yagTurFilter = document.getElementById('yagTurFilter');
  if (yagTurFilter && yagTurFilter.value) filtered = filtered.filter(function(r) { return r.tur === yagTurFilter.value; });

  if (filtered.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = 'Bu filtreleme kriterlerine uygun kayıt bulunamadı.';
    drawYagChart();
    return;
  }
  empty.querySelector('p').textContent = 'Henüz atık yağ kaydı girilmemiş.';

  empty.style.display = 'none';
  table.style.display = 'table';

  const sorted = filtered.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  const totalPages = Math.ceil(sorted.length / YAG_PAGE_SIZE);
  if (yagPage >= totalPages) yagPage = Math.max(0, totalPages - 1);
  const start = yagPage * YAG_PAGE_SIZE;
  const pageItems = sorted.slice(start, start + YAG_PAGE_SIZE);

  tbody.innerHTML = pageItems.map(r => {
    const dateStr = displayDate(r.tarih);
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

  drawYagChart();
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
  if (!requireAdmin()) return;
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
  syncYagSilent();
  closeYagModal();
}

function editYagRecord(id) { openYagModal(id); }

async function deleteYagRecord(id) {
  if (!requireAdmin()) return;
  if (!confirm('Bu atık yağ kaydını silmek istediğinize emin misiniz?')) return;
  yagRecords = yagRecords.filter(r => r.id !== id);
  saveYagData();
  if (supabaseClient) {
    try { await supabaseClient.from('yag_records').delete().eq('id', id); } catch (_) {}
  }
  renderYagTable();
  syncYagSilent();
  showToast('Atık yağ kaydı silindi.', 'success');
}

let yagChartInstance = null;
let yagChartYear = String(new Date().getFullYear());

function drawYagChart() {
  var canvas = document.getElementById('canvasYag');
  var empty = document.getElementById('chartYagEmpty');
  var yearContainer = document.getElementById('yagChartYears');
  if (!canvas || !empty) return;

  // build year filter
  var years = {};
  yagRecords.forEach(function(r) {
    if (!r.tarih) return;
    var y = r.tarih.slice(0, 4);
    if (y) years[y] = true;
  });
  var yearList = Object.keys(years).sort();
  if (yearList.length === 0) { empty.style.display = 'block'; canvas.style.display = 'none'; return; }
  if (yearList.indexOf(yagChartYear) === -1 && yagChartYear !== '') {
    yagChartYear = yearList[yearList.length - 1];
  }
  if (yearContainer) {
    var html = '<select onchange="yagChartYear=this.value;drawYagChart()" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;background:var(--bg-card);color:var(--text)">';
    html += '<option value=""' + (yagChartYear === '' ? ' selected' : '') + '>Tümü</option>';
    yearList.forEach(function(y) {
      var sel = yagChartYear === y ? ' selected' : '';
      html += '<option value="' + y + '"' + sel + '>' + y + '</option>';
    });
    html += '</select>';
    yearContainer.innerHTML = html;
  }

  var monthly = {};
  yagRecords.forEach(function(r) {
    if (!r.tarih) return;
    if (yagChartYear !== '' && r.tarih.slice(0, 4) !== yagChartYear) return;
    var mk = r.tarih.slice(5, 7) + '/' + r.tarih.slice(0, 4);
    monthly[mk] = (monthly[mk] || 0) + (Number(r.miktar) || 0);
  });
  var labels = Object.keys(monthly).sort(function(a, b) {
    var pa = a.split('/'), pb = b.split('/');
    return pa[1] !== pb[1] ? pa[1] - pb[1] : pa[0] - pb[0];
  });
  var values = labels.map(function(k) { return monthly[k]; });

  if (labels.length === 0) { empty.style.display = 'block'; canvas.style.display = 'none'; return; }
  empty.style.display = 'none';
  canvas.style.display = 'block';

  // size canvas
  var parent = canvas.parentElement;
  var w = Math.min(parent.offsetWidth || 400, parent.clientWidth || 400);
  canvas.style.width = w + 'px';
  canvas.style.height = '160px';
  var ctx = canvas.getContext('2d');

  // destroy old
  if (yagChartInstance) { yagChartInstance.destroy(); yagChartInstance = null; }

  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var textColor = isDark ? '#e2e8f0' : '#1e293b';
  var gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  yagChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Atık Yağ (lt)',
        data: values,
        backgroundColor: '#f97316',
        borderRadius: 4,
        barPercentage: 0.7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        valueLabels: true,
        valueLabelsPosition: 'inside',
        tooltip: {
          backgroundColor: '#000',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 1,
          callbacks: {
            label: function(ctx) { return ctx.parsed.y.toFixed(1) + ' lt'; }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: textColor, font: { size: 10 } },
          grid: { color: gridColor }
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
          var idx = active[0].index;
          var label = labels[idx];
          var parts = label.split('/');
          if (parts.length === 2) {
            var ay = parseInt(parts[0]), yil = parseInt(parts[1]);
            if (!isNaN(ay) && !isNaN(yil)) {
              var filtered = yagRecords.filter(function(r) {
                if (!r.tarih) return false;
                var d = new Date(r.tarih + 'T12:00:00');
                return !isNaN(d) && d.getMonth() + 1 === ay && d.getFullYear() === yil;
              });
              if (filtered.length > 0) showChartDetailModal(label + ' Atık Yağ', filtered);
            }
          }
        }
      }
    },
    plugins: [chartValueLabelPlugin]
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
});

function saveAmbalajData() {
  try { sessionStorage.setItem(AMBALAJ_STORAGE_KEY, JSON.stringify(ambalajRecords)); } catch (_) {}
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
    drawAmbalajChart();
    return;
  }

  let filtered = [...ambalajRecords];
  var ambalajTarihBas = document.getElementById('ambalajTarihBas');
  var ambalajTarihBit = document.getElementById('ambalajTarihBit');
  if (ambalajTarihBas && ambalajTarihBas.value) filtered = filtered.filter(function(r) { return r.tarih >= ambalajTarihBas.value; });
  if (ambalajTarihBit && ambalajTarihBit.value) filtered = filtered.filter(function(r) { return r.tarih <= ambalajTarihBit.value; });
  var ambalajTurFilter = document.getElementById('ambalajTurFilter');
  if (ambalajTurFilter && ambalajTurFilter.value) filtered = filtered.filter(function(r) { return r.tur === ambalajTurFilter.value; });

  if (filtered.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = 'Bu filtreleme kriterlerine uygun kayıt bulunamadı.';
    drawAmbalajChart();
    return;
  }
  empty.querySelector('p').textContent = 'Henüz ambalaj atığı kaydı girilmemiş.';

  empty.style.display = 'none';
  table.style.display = 'table';

  const sorted = filtered.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  const totalPages = Math.ceil(sorted.length / AMBALAJ_PAGE_SIZE);
  if (ambalajPage >= totalPages) ambalajPage = Math.max(0, totalPages - 1);
  const start = ambalajPage * AMBALAJ_PAGE_SIZE;
  const pageItems = sorted.slice(start, start + AMBALAJ_PAGE_SIZE);

  tbody.innerHTML = pageItems.map(r => {
    const dateStr = displayDate(r.tarih);
    return `<tr>
      <td>${dateStr}</td>
      <td>${escapeHtml(r.tur || '—')}</td>
      <td>${(r.miktar || 0) < 1 ? (r.miktar || 0).toFixed(3) : (r.miktar || 0).toFixed(1)} <span style="font-size:0.7rem;color:var(--text-muted)">kg</span></td>
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

  drawAmbalajChart();
}

function openAmbalajModal(id) {
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
    document.getElementById('afMiktar').value = rec.miktar || '';
    document.getElementById('afNot').value = rec.not || '';
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
  if (!requireAdmin()) return;
  e.preventDefault();

  var rawMiktar = parseFloat(document.getElementById('afMiktar').value) || 0;
  if (ambalajBirim === 'g') rawMiktar = rawMiktar / 1000;

  const rec = {
    id: editingAmbalajId || Date.now(),
    tarih: document.getElementById('afTarih').value,
    tur: document.getElementById('afTur').value,
    miktar: rawMiktar,
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
  syncAmbalajSilent();
  closeAmbalajModal();
}

function editAmbalajRecord(id) { openAmbalajModal(id); }

async function deleteAmbalajRecord(id) {
  if (!requireAdmin()) return;
  if (!confirm('Bu ambalaj atığı kaydını silmek istediğinize emin misiniz?')) return;
  ambalajRecords = ambalajRecords.filter(r => r.id !== id);
  saveAmbalajData();
  if (supabaseClient) {
    try { await supabaseClient.from('ambalaj_records').delete().eq('id', id); } catch (_) {}
  }
  renderAmbalajTable();
  syncAmbalajSilent();
  showToast('Ambalaj atığı kaydı silindi.', 'success');
}

let ambalajChartInstance = null;
let ambalajChartYear = String(new Date().getFullYear());

function drawAmbalajChart() {
  var canvas = document.getElementById('canvasAmbalaj');
  var empty = document.getElementById('chartAmbalajEmpty');
  var yearContainer = document.getElementById('ambalajChartYears');
  if (!canvas || !empty) return;

  var years = {};
  ambalajRecords.forEach(function(r) {
    if (!r.tarih) return;
    var y = r.tarih.slice(0, 4);
    if (y) years[y] = true;
  });
  var yearList = Object.keys(years).sort();
  if (yearList.length === 0) { empty.style.display = 'block'; canvas.style.display = 'none'; return; }
  if (yearList.indexOf(ambalajChartYear) === -1 && ambalajChartYear !== '') {
    ambalajChartYear = yearList[yearList.length - 1];
  }
  if (yearContainer) {
    var html = '<select onchange="ambalajChartYear=this.value;drawAmbalajChart()" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;background:var(--bg-card);color:var(--text)">';
    html += '<option value=""' + (ambalajChartYear === '' ? ' selected' : '') + '>Tümü</option>';
    yearList.forEach(function(y) {
      var sel = ambalajChartYear === y ? ' selected' : '';
      html += '<option value="' + y + '"' + sel + '>' + y + '</option>';
    });
    html += '</select>';
    yearContainer.innerHTML = html;
  }

  var monthly = {};
  ambalajRecords.forEach(function(r) {
    if (!r.tarih) return;
    if (ambalajChartYear !== '' && r.tarih.slice(0, 4) !== ambalajChartYear) return;
    var mk = r.tarih.slice(5, 7) + '/' + r.tarih.slice(0, 4);
    monthly[mk] = (monthly[mk] || 0) + (Number(r.miktar) || 0);
  });
  var labels = Object.keys(monthly).sort(function(a, b) {
    var pa = a.split('/'), pb = b.split('/');
    return pa[1] !== pb[1] ? pa[1] - pb[1] : pa[0] - pb[0];
  });
  var values = labels.map(function(k) { return monthly[k]; });

  if (labels.length === 0) { empty.style.display = 'block'; canvas.style.display = 'none'; return; }
  empty.style.display = 'none';
  canvas.style.display = 'block';

  var parent = canvas.parentElement;
  var w = Math.min(parent.offsetWidth || 400, parent.clientWidth || 400);
  canvas.style.width = w + 'px';
  canvas.style.height = '160px';
  var ctx = canvas.getContext('2d');

  if (ambalajChartInstance) { ambalajChartInstance.destroy(); ambalajChartInstance = null; }

  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var textColor = isDark ? '#e2e8f0' : '#1e293b';
  var gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  ambalajChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Ambalaj Atığı (kg)',
        data: values,
        backgroundColor: '#10b981',
        borderRadius: 4,
        barPercentage: 0.7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        valueLabels: true,
        valueLabelsPosition: 'inside',
        tooltip: {
          backgroundColor: '#000',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 1,
          callbacks: {
            label: function(ctx) { return ctx.parsed.y.toFixed(3) + ' kg'; }
          }
        }
      },
      scales: {
        x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
        y: { beginAtZero: true, ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } }
      },
      onClick: function(e) {
        var active = ambalajChartInstance.getElementsAtEventForMode(e, 'index', { intersect: true }, false);
        if (active.length > 0) {
          var idx = active[0].index;
          var label = labels[idx];
          var parts = label.split('/');
          if (parts.length === 2) {
            var ay = parseInt(parts[0]), yil = parseInt(parts[1]);
            if (!isNaN(ay) && !isNaN(yil)) {
              var filtered = ambalajRecords.filter(function(r) {
                if (!r.tarih) return false;
                var d = new Date(r.tarih + 'T12:00:00');
                return !isNaN(d) && d.getMonth() + 1 === ay && d.getFullYear() === yil;
              });
              if (filtered.length > 0) showChartDetailModal(label + ' Ambalaj Atığı', filtered);
            }
          }
        }
      }
    },
    plugins: [chartValueLabelPlugin]
  });
}

function buildExportHTML() {
  var gunler = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
  var cesitler = ['1. Çeşit', '2. Çeşit', '3. Çeşit', '4. Çeşit', '5. Çeşit'];
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
  tableData.push({ label: 'Kişi Sayısı', cells: kisiCells });
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
  var normBirim = function(b) {
    var s = (b || 'gr').toLowerCase().replace(/\s/g, '');
    if (/^g(ram|rams|ramaj)?$/.test(s)) return 'gr';
    if (/^l(itre|itr)?$/.test(s)) return 'lt';
    if (/^m(l|ili(litre)?)?$/.test(s)) return 'ml';
    return s;
  };
  var fmt = function(total, birim) {
    if (total <= 0) return '—';
    if (birim === 'gr') return total >= 1000 ? (Math.round(total / 10) / 100) + ' kg' : Math.round(total) + ' gr';
    if (birim === 'ml') return total >= 1000 ? (Math.round(total / 10) / 100) + ' lt' : Math.round(total) + ' ml';
    if (birim === 'lt') return (Math.round(total * 100) / 100) + ' lt';
    return Math.round(total) + ' ' + birim;
  };

  // Per-day production rows
  var prodDaysHtml = '';
  var weekAgg = {}; // for weekly total
  for (var di = 0; di < 5; di++) {
    var kisi = kisiVals[di];
    var dayCesitler = '';
    var dayHasAny = false;
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
        ingHtml += '<div class="ping"><span class="pn">' + escapeHtml(ing.malzeme.trim()) + '</span><span class="pq">' + fmt(total, birim) + '</span></div>';
        // accumulate for weekly total
        var key = ing.malzeme.trim().toLowerCase() + '|' + birim;
        if (!weekAgg[key]) weekAgg[key] = { ad: ing.malzeme.trim(), birim: birim, total: 0 };
        weekAgg[key].total += total;
      });
      dayCesitler += '<div class="pcol"><div class="pces">' + escapeHtml(ci + 1 + '. Çeşit: ' + name) + '</div>' + ingHtml + '</div>';
    }
    if (dayHasAny) {
      prodDaysHtml += '<div class="pday"><div class="phd"><span class="plab">' + gunler[di] + '</span><span class="pkisi">' + kisi + ' kişi</span></div><div class="pbd"><div class="prow">' + dayCesitler + '</div></div></div>';
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
    '.pces{font-weight:700;font-size:10px;margin-bottom:1px;padding-bottom:1px;border-bottom:1px solid #ddd;color:#333}' +
    '.ping{font-size:9px;line-height:1.4;color:#555;display:flex;gap:2px}' +
    '.pn{flex:1}.pq{text-align:right;font-weight:600;color:#333;white-space:nowrap}' +
    '.wcard{border:1px solid #ddd;border-radius:3px;overflow:hidden}' +
    '.whd{padding:3px 6px;background:#f5f5f5;border-bottom:1px solid #ddd;font-size:12px;font-weight:700;color:#333}' +
    '.wbd{padding:3px 6px}' +
    '.wit{display:flex;gap:6px;font-size:9px;line-height:1.5;padding:1px 0;border-bottom:1px solid #f0f0f0}' +
    '.wn{color:#333}.wq{font-weight:600;color:#333;white-space:nowrap;margin-left:auto}' +
    '.fot{text-align:center;font-size:8px;color:#aaa;margin-top:8px;padding-top:3px;border-top:1px solid #ddd}' +
    '</style>';

  // Title + Menu table (must fit on 1 page)
  html += '<h1>Haftalık Menü Listesi</h1><div class="sub">' + escapeHtml(weekLabel) + '</div>';
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

  html += '<div class="fot">Yemekhane Menü ve Atık Yönetim Sistemi</div>';
  html += '</div>';
  return html;
}

function printYagList() {
  var list = yagRecords.filter(function(r) { return r.tarih; });
  var bas = document.getElementById('yagTarihBas');
  var bit = document.getElementById('yagTarihBit');
  if (bas && bas.value) list = list.filter(function(r) { return r.tarih >= bas.value; });
  if (bit && bit.value) list = list.filter(function(r) { return r.tarih <= bit.value; });
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
  html += '<div style="margin-top:6px;font-size:10px;font-weight:700;text-align:right">Toplam: ' + total.toFixed(1) + ' lt</div>';
  html += '<div style="text-align:center;font-size:8px;color:#aaa;margin-top:10px;padding-top:4px;border-top:1px solid #ddd">Atık Yağ Kayıt Listesi</div>';
  html += '</div>';
  var win = window.open('', '_blank', 'width=800,height=600');
  if (!win) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  win.document.open();
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Atık Yağ Kayıtları</title></head><body style="margin:0;background:#fff">' + html + '</body></html>');
  win.document.close();
  win.focus();
  setTimeout(function() { win.print(); }, 600);
}

function printAmbalajList() {
  var list = ambalajRecords.filter(function(r) { return r.tarih; });
  var bas = document.getElementById('ambalajTarihBas');
  var bit = document.getElementById('ambalajTarihBit');
  if (bas && bas.value) list = list.filter(function(r) { return r.tarih >= bas.value; });
  if (bit && bit.value) list = list.filter(function(r) { return r.tarih <= bit.value; });
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
    html += '<tr>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + displayDate(r.tarih) + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.tur || '—') + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + (r.miktar || 0).toFixed(1) + '</td>';
    html += '<td style="border:1px solid #ddd;padding:3px 6px">' + escapeHtml(r.not || '—') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  var total = list.reduce(function(s, r) { return s + (r.miktar || 0); }, 0);
  html += '<div style="margin-top:6px;font-size:10px;font-weight:700;text-align:right">Toplam: ' + total.toFixed(1) + ' kg</div>';
  html += '<div style="text-align:center;font-size:8px;color:#aaa;margin-top:10px;padding-top:4px;border-top:1px solid #ddd">Ambalaj Atığı Kayıt Listesi</div>';
  html += '</div>';
  var win = window.open('', '_blank', 'width=800,height=600');
  if (!win) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  win.document.open();
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ambalaj Atıkları Kayıtları</title></head><body style="margin:0;background:#fff">' + html + '</body></html>');
  win.document.close();
  win.focus();
  setTimeout(function() { win.print(); }, 600);
}

function printMenu() {
  var html = buildExportHTML();
  var win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { showToast('Pop-up engelleyiciyi kapatın.', 'error'); return; }
  win.document.open();
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Haftalık Menü</title></head><body style="margin:0;background:#fff">' + html + '</body></html>');
  win.document.close();
  win.focus();
  setTimeout(function() { win.print(); }, 800);
}






