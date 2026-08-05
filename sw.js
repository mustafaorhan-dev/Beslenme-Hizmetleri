const CACHE = 'atik-kontrol-v13';
const URLS = ['index.html', 'style.css', 'app.js', 'manifest.json', 'config.js'];

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
