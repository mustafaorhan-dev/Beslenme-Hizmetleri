const CACHE = 'atik-kontrol-v12';
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
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      try {
        const cached = await cache.match(e.request);
        const network = fetch(e.request).then(res => {
          try { if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone()); } catch (_) {}
          return res;
        }).catch(() => cached);
        return cached || network;
      } catch (_) {
        return fetch(e.request);
      }
    })
  );
});
