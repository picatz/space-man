const CACHE_NAME = 'space-man-cache-v1';
const DATA_CACHE_NAME = 'space-man-data-cache-v1';

// Files to cache
const FILES_TO_CACHE = [
  '/',
  '/space-man/index.html',
  '/space-man/manifest.json',
  '/space-man/icons/icon-192x192.png',
  '/space-man/icons/icon-512x512.png',
  '/space-man/favicon.png',
  // Add any other assets like images, fonts, etc.
];

// Install Event
self.addEventListener('install', event => {
  console.log('[ServiceWorker] Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[ServiceWorker] Pre-caching offline page');
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', event => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(
        keyList.map(key => {
          if (key !== CACHE_NAME && key !== DATA_CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') {
    // Not a page navigation, bail.
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // If the response was good, clone it and store it in the cache.
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(DATA_CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(err => {
        // Network request failed, try to get it from the cache.
        return caches.match(event.request).then(response => {
          if (response) {
            return response;
          } else {
            // Optionally, return a fallback page
            return caches.match('/space-man/index.html');
          }
        });
      })
  );
});
