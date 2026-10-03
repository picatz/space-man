// Space Man 2.0 service worker.
// Bump VERSION in the same commit as any asset change or clients keep the old build.
const VERSION = 'v3.25.3';
// 'sm2-app-' marks a complete, versioned app shell. Workers before v3.3 used
// 'sm2-shell-' and served ./src/ cache-first next to a network-first page, which
// paired a fresh index.html with stale scripts after a deploy.
const APP_SCOPE = new URL('./', self.location.href || self.location.origin + '/').pathname;
const CACHE_PREFIX = 'sm2-app-' + encodeURIComponent(APP_SCOPE) + '-';
const SHELL_CACHE = CACHE_PREFIX + VERSION;
const isLegacyCache = (key) => /^sm2-(?:app|shell)-v\d/.test(key);
const LEGACY_PREFIX = 'sm2-shell-';

// Everything the game loads. tests/platform.test.cjs fails if index.html or
// manifest.json references a file that is missing here (or listed but absent).
const SHELL = [
  './',
  './index.html',
  './src/space-theme.css',
  './src/expedition.css',
  './src/expedition.js',
  './src/build.js',
  './src/contracts.js',
  './src/save-schema.js',
  './src/input-snapshot.js',
  './src/course.js',
  './src/worldgen.js',
  './src/enemies.js',
  './src/powerups.js',
  './src/art.js',
  './src/anim.js',
  './src/arena.js',
  './src/arena-online.js',
  './src/arena-room.js',
  './src/arena-ui.js',
  './src/race.js',
  './src/race-online.js',
  './src/race-room.js',
  './src/render3d.js',
  './src/race-camera.js',
  './src/race-track-mesh.js',
  './src/race-scene.js',
  './src/race-presentation.js',
  './src/race-view.js',
  './src/race-audio.js',
  './src/race-ui.js',
  './src/callsigns.js',
  './src/crew.js',
  './src/relay-directory.js',
  './src/qr.js',
  './src/netsmooth.js',
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

// ONE BUILD PER PAGE. The page and every script it runs come from the same
// versioned cache, so a player can never end up on a mix of old and new files:
//  - install downloads the whole shell for this VERSION into its own cache,
//    atomically (addAll fails as a unit; cache:'reload' skips the HTTP cache);
//  - pages are served from that cache — instantly, offline or on a plane's
//    Wi-Fi alike; the network is never on the critical path of a launch;
//  - a new deploy installs beside it and waits; the page posts 'skipWaiting' at
//    a safe moment (title or run-over card, never in a room) and reloads, and
//    the reload is served wholly by the new cache.
// The earlier network-first design could pair a fresh index.html with cached
// scripts whenever the connection dropped between the two requests.

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    // A legacy cache-first worker is replaced at once — left in control it would
    // keep pairing new pages with stale scripts. Otherwise a new build waits.
    if ((await caches.keys()).some((k) => k.startsWith(LEGACY_PREFIX))) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Only a fully installed build ever activates, so dropping the others is safe.
    for (const key of await caches.keys()) {
      if (key !== SHELL_CACHE && (key.startsWith(CACHE_PREFIX) || isLegacyCache(key))) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Preview snapshots are network-only and must never receive the production shell.
  if (req.method !== 'GET' || url.origin !== self.location.origin
      || !url.pathname.startsWith(APP_SCOPE) || url.pathname === APP_SCOPE + 'pr'
      || url.pathname.startsWith(APP_SCOPE + 'pr/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Navigations (any query or #fragment: invites, challenges, the daily) all
    // launch the same shell page.
    const hit = req.mode === 'navigate'
      ? (await cache.match('./index.html')) || (await cache.match('./'))
      : await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    // Not in this build's shell (a file outside it, or storage the browser
    // evicted): the network, remembered for next time when it's our own file.
    // (Fetch events only reach a worker whose install completed, so the shell
    // itself is always whole here.)
    const res = await fetch(req.mode === 'navigate' ? req.url : req, req.mode === 'navigate' ? { credentials: 'same-origin' } : undefined);
    if (res.ok && res.type === 'basic' && req.mode !== 'navigate') {
      const copy = res.clone();
      e.waitUntil(cache.put(req, copy));
    }
    return res;
  })());
});
