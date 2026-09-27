const CACHE = 'atik-kontrol-v54';
// VER, index.html'deki ?v= degeriyle ayni olmak zorunda: fetch handler
// cevrimdisi tam URL eslestirmesi yapiyor, surum kayarsa eski dosya verilir.
const VER = '47';
const URLS = ['index.html', 'style.css?v=' + VER, 'app.js?v=' + VER, 'manifest.json', 'config.js', 'logo.gif'];

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
  // Network-first: çevrimiçiyken her zaman güncel dosyalar alınır,
  // çevrimdışıysa önbellekteki kopya kullanılır.
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
