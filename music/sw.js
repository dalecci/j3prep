// Offline support: the whole app works with no signal on stage.
const VERSION = 'wll-v1';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './theory.js', './fretboard.js', './lines.js',
  './board.js', './audio.js', './ai.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('wll-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameApp = url.origin === location.origin && url.pathname.startsWith(new URL('./', self.registration.scope).pathname);
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameApp && !font) return;
  // stale-while-revalidate: instant from cache, refreshed in the background
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: sameApp });
      const net = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
