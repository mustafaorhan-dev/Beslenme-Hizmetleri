/* =============================================
   ATIK KONTROL - SERVICE WORKER
   Build no, kayit URL'inden okunur (sw.js?b=NNN);
   config.js'teki APP_CONFIG.build degistiginde tarayici
   yeni SW kurar ve onbellek tazelenir.
   Ag varsa her zaman agdan (no-cache), yoksa onbellekten.
   ============================================= */

const BUILD = new URL(self.location.href).searchParams.get('b') || '1';
const CACHE = 'atik-kontrol-b' + BUILD;

/* index.html, style.css ve app.js surumsuz istenir (tek surum kaynagi
   config.js oldugundan ?v= kullanilmaz). logo.gif surumsuz istenir.
   Hepsi no-cache ile onbellege yazilir; cevrimdisiyken guncel kopya calisir. */
const URLS = [
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'config.js',
  'logo.gif'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.all(
      URLS.map(u =>
        fetch(u, { cache: 'no-cache' })
          .then(r => { if (r && r.ok) return c.put(u, r); })
          .catch(() => {})
      )
    ))
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
  // Network-first: cevrimiciyken her zaman guncel dosyalar alinir
  // (ayni kaynak isteklerde HTTP onbellek atlanir), cevrimdisiyse
  // onbellekteki kopya kullanilir.
  const sameOrigin = new URL(e.request.url).origin === self.location.origin;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      try {
        const network = await fetch(e.request, sameOrigin ? { cache: 'no-cache' } : undefined);
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
