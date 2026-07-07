// Space Man 2.0 service worker.
// Bump VERSION in the same commit as any asset change or clients keep the old build.
const VERSION = 'v2.0.0';
const SHELL_CACHE = `sm2-shell-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon.png',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  // Navigations: network-first so updates land, cache fallback for offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', res.clone());
        }
        return res;
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match(req, { ignoreSearch: true })) ||
               (await cache.match('./index.html')) ||
               (await cache.match('./'));
      }
    })());
    return;
  }

  // Everything else same-origin: cache-first with network backfill.
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  })());
});
