/* =============================================
   ATIK KONTROL - SERVICE WORKER
   Ag Yuklemeler: ag varsa her zaman agdan, yoksa
   onbellekten. Yeni surum CACHE/VER ile hemen gecerli
   olur; skipWaiting + clients.claim acik sekmeleri de
   guncelleyen sekilde tutar.
   ============================================= */

const CACHE = 'atik-kontrol-v99';
const VER = '92';

/* index.html dogrudan istenir; style.css ve app.js
   ?v=VER ile istenir, onbellege de AYNI surumle yazilir
   (fetch handler e.request'i birebir eslestirir, bu yuzden
   surumlu istek onbellekte birebir bulunmalidir).
   logo.gif surumsuz istenir, bu yuzden surumsuz yazilir. */
const URLS = [
  'index.html',
  'style.css?v=' + VER,
  'app.js?v=' + VER,
  'manifest.json',
  'config.js',
  'logo.gif'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(URLS))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Network-first: cevrimiciyken her zaman guncel dosyalar alinir,
  // cevrimdisiyse onbellekteki kopya kullanilir.
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      try {
        const network = await fetch(e.request);
        try { if (network && (network.ok || network.type === 'opaque')) cache.put(e.request, network.clone()); } catch (_) {}
        return network;
      } catch (_) {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        return fetch(e.request);
      }
    })
  );
});
