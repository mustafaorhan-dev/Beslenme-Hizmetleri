/* =============================================
   GÜVENLİK MODÜLÜ - BHYS
   XSS, input validation ve güvenli DOM yardımcıları
   ============================================= */

'use strict';

// ─── HTML ESCAPE (XSS koruması) ──────────────────────────────────────────────
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Güvenli innerHTML ataması: tüm interpolasyonları escape eder.
// Kullanım: safeHtml(element, '<b>' + escapeHtml(name) + '</b>')
function safeSetHtml(el, html) {
  if (!el) return;
  el.innerHTML = html;
}

// ─── INPUT VALIDATION ────────────────────────────────────────────────────────
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function sanitizeText(input, maxLen) {
  var s = String(input == null ? '' : input).trim();
  if (typeof maxLen === 'number' && maxLen > 0 && s.length > maxLen) {
    s = s.slice(0, maxLen);
  }
  return s;
}

// Sayısal güvenli parse (NaN/Infinity koruması)
function safeNumber(val, fallback) {
  var n = Number(val);
  if (!isFinite(n)) return (typeof fallback === 'number' ? fallback : 0);
  return n;
}

// ─── GÜVENLİ window.open/print yardımcıları ─────────────────────────────────
function safePrintHtml(win, title, bodyHtml) {
  if (!win) return;
  try {
    win.document.open();
    win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' +
      escapeHtml(title) + '</title></head><body>' + bodyHtml + '</body></html>');
    win.document.close();
  } catch (_) {}
}

// ─── GLOBAL ERROR GUARD ──────────────────────────────────────────────────────
window.addEventListener('error', function (e) {
  try { console.error('BHYS runtime error:', e.message, e.filename, e.lineno); } catch (_) {}
});

window.addEventListener('unhandledrejection', function (e) {
  try { console.error('BHYS unhandled rejection:', e.reason); } catch (_) {}
});

// Export (global zaten fonksiyon bildirimleriyle global)
window.escapeHtml = escapeHtml;
window.safeSetHtml = safeSetHtml;
window.isValidEmail = isValidEmail;
window.sanitizeText = sanitizeText;
window.safeNumber = safeNumber;