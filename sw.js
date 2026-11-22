const SHELL = 'kibiji-shell-v1', TILES = 'kibiji-tiles-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'course.js', 'manifest.webmanifest',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname === 'cyberjapandata.gsi.go.jp') {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request.url); if (hit) return hit;
      const res = await fetch(e.request.url, { mode: 'no-cors' });
      if (res && (res.ok || res.type === 'opaque')) c.put(e.request.url, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin === location.origin) {
    // network-first for app files (so updates arrive), cache fallback offline
    e.respondWith(fetch(e.request).then(res => { const cp = res.clone(); caches.open(SHELL).then(c => c.put(e.request, cp)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
