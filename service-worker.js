// Space Man 2.0 service worker.
// Bump VERSION in the same commit as any asset change or clients keep the old build.
const VERSION = 'v3.11.0';
// 'sm2-app-' marks the network-first generation. Workers before it used
// 'sm2-shell-' and served ./src/ cache-first, which paired a fresh index.html
// with stale scripts after a deploy (split builds break Run Together).
const SHELL_CACHE = `sm2-app-${VERSION}`;
const LEGACY_PREFIX = 'sm2-shell-';

const SHELL = [
  './',
  './index.html',
  './src/contracts.js',
  './src/save-schema.js',
  './src/input-snapshot.js',
  './src/course.js',
  './src/art.js',
  './src/anim.js',
  './src/callsigns.js',
  './src/relay-directory.js',
  './src/qr.js',
  './src/net.js',
  './manifest.json',
  './favicon.png',
  './screenshots/gameplay-wide.png',
  './screenshots/gameplay-portrait.png',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // cache:'reload' bypasses the HTTP cache so a VERSION bump can never
    // precache a stale copy served under GitHub Pages' max-age=600.
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    // Newer builds wait: the page posts 'skipWaiting' at a safe moment (title or
    // death card) and reloads. A legacy cache-first worker is replaced at once —
    // left in control it would keep pairing new pages with stale scripts.
    if ((await caches.keys()).some((k) => k.startsWith(LEGACY_PREFIX))) await self.skipWaiting();
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
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Navigations: network-first so updates land, cache fallback for offline.
  // Revalidate past the HTTP cache like scripts do, or a host max-age can hand
  // back a stale page that then loads the fresh scripts (a split build again).
  // A navigate-mode Request can't take an init, so fetch by URL.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
        if (res.ok) {
          const cache = await caches.open(SHELL_CACHE);
          // Refresh both navigation keys so an offline launch at start_url
          // './' can't resurrect the stale install-time copy.
          cache.put('./index.html', res.clone());
          cache.put('./', res.clone());
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

  const store = (res) => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.put(req, copy)));
    }
    return res;
  };

  // Images carry no code, so a stale one can't split a build: cache-first.
  if (req.destination === 'image') {
    e.respondWith((async () => (await caches.match(req, { ignoreSearch: true })) || store(await fetch(req)))());
    return;
  }

  // Scripts, manifest, everything else same-origin: network-first, revalidated
  // past the HTTP cache, so a new index.html always runs against the scripts it
  // shipped with. Success refreshes the cache; the cache serves offline play.
  e.respondWith((async () => {
    try {
      return store(await fetch(req, { cache: 'no-cache' }));
    } catch (err) {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      throw err;
    }
  })());
});
