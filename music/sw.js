// Offline support: the whole app works with no signal on stage.
// Online: always fetch fresh files (so a page and its scripts never come from different versions).
// Offline or very slow network: fall back to the last good copy.
const VERSION = 'wll-v4';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './theory.js', './fretboard.js', './lines.js',
  './board.js', './audio.js', './ai.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('wll-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scopePath = new URL('./', self.registration.scope).pathname;
  const sameApp = url.origin === location.origin && url.pathname.startsWith(scopePath);
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameApp && !font) return;

  if (font) {
    // fonts never change: cache first
    e.respondWith(caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  // app files: network first (fresh and consistent), cache as the offline fallback
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    try {
      const res = await Promise.race([fetch(req, { cache: 'no-cache' }), timeout(4000)]);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return cache.match('./index.html');
      throw new Error('offline');
    }
  }));
});
