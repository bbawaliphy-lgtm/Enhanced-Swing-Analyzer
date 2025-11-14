/* service-worker.js
   Optimized PWA service worker for Enhanced Swing Analyzer
   - Network-first for navigation (index.html)
   - Cache-first (stale-while-revalidate) for assets
   - Network-only for Firebase/Google/Yahoo/workers.dev
   - Cache housekeeping + size limits
*/

const VERSION = 'v12.1';
const CACHE_NAME = `esa-cache-${VERSION}`;
const ASSET_CACHE = `esa-assets-${VERSION}`;
const OFFLINE_URL = '/index.html'; // used as fallback for navigation
const MAX_ASSET_ENTRIES = 60; // limit asset cache entries

// assets to pre-cache (static, safe)
const PRECACHE_URLS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  // Do not aggressively precache index.html to avoid staleness — we still include it as fallback below
];

// helper: trim cache to max entries
async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      const deleteCount = keys.length - maxEntries;
      for (let i = 0; i < deleteCount; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch (e) {
    console.warn('[SW] trimCache error', e);
  }
}

// helper: is external API that we shouldn't cache
function isNoCacheRequest(url) {
  try {
    const u = new URL(url);
    const origin = u.origin || '';
    return origin.includes('firebase') ||
           origin.includes('google') ||
           origin.includes('yahoo') ||
           origin.includes('workers.dev');
  } catch (e) {
    return false;
  }
}

// Install: pre-cache static assets (not index.html)
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install', VERSION);
  self.skipWaiting();
  event.waitUntil(
    caches.open(ASSET_CACHE).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('[Service Worker] Precache failed', err);
      });
    })
  );
});

// Activate: cleanup old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate', VERSION);
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map(async (name) => {
        if (![CACHE_NAME, ASSET_CACHE].includes(name) && name.startsWith('esa-')) {
          console.log('[Service Worker] Deleting old cache:', name);
          await caches.delete(name);
        }
      }));
      // Claim clients immediately so updated SW controls the page
      await self.clients.claim();
    })()
  );
});

// Fetch handler: network-first for navigation, network-only for Firebase/3rd-party APIs, cache-first for other assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const requestURL = request.url;

  // Only handle GET requests here
  if (request.method !== 'GET') {
    return; // let browser handle non-GET (POST/PUT) normally
  }

  // 1) Network-only for Firebase / Google / Yahoo / workers.dev
  if (isNoCacheRequest(requestURL)) {
    event.respondWith(
      fetch(request).catch(err => {
        // If network fails, provide a safe fallback response (JSON or text) depending on accept header
        if (request.headers.get('accept')?.includes('application/json')) {
          return new Response(JSON.stringify({ error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response('Network unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' }
        });
      })
    );
    return;
  }

  // 2) Navigation requests (pages) — network-first to avoid stale index.html
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      (async () => {
        try {
          // Try network first
          const networkResponse = await fetch(request);
          // Update fallback HTML cache for offline fallback
          const cache = await caches.open(CACHE_NAME);
          cache.put(OFFLINE_URL, networkResponse.clone()).catch(() => {});
          return networkResponse;
        } catch (err) {
          // Network failed — serve cached index.html fallback if available
          const cached = await caches.match(OFFLINE_URL);
          if (cached) return cached;
          // Try cached asset index.html under asset cache
          const cachedAsset = await caches.open(ASSET_CACHE).then(c => c.match(OFFLINE_URL));
          if (cachedAsset) return cachedAsset;
          // Final fallback: a minimal HTML response
          return new Response('<!doctype html><title>Offline</title><meta name="viewport" content="width=device-width,initial-scale=1"><h1>Offline</h1><p>The application is offline.</p>', {
            headers: { 'Content-Type': 'text/html' },
            status: 200
          });
        }
      })()
    );
    return;
  }

  // 3) Cache-first (stale-while-revalidate) for other static assets (CSS, JS, images, libs)
  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const cachedResponse = await cache.match(request);
      const networkFetch = fetch(request)
        .then(response => {
          // only cache successful 200 responses and same-origin or CORS-friendly responses
          if (response && response.status === 200) {
            cache.put(request, response.clone()).catch(() => {});
            // trim asset cache
            trimCache(ASSET_CACHE, MAX_ASSET_ENTRIES);
          }
          return response;
        })
        .catch(() => null);

      // Return cached if exists immediately, but update in background
      return cachedResponse || networkFetch.then(res => res || cachedResponse);
    })
  );
});

// Listen for messages from clients (skipWaiting, clear cache)
self.addEventListener('message', (event) => {
  if (!event.data) return;
  const { type } = event.data;
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (type === 'CLEAR_CACHE') {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        console.log('[Service Worker] All caches cleared on request');
      })()
    );
  }
});

// Background sync placeholder (app still manages queue)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-analysis') {
    event.waitUntil(
      (async () => {
        // Note: best-effort trigger; actual sync logic lives in the app
        const allClients = await clients.matchAll({ includeUncontrolled: true });
        for (const c of allClients) {
          c.postMessage({ type: 'BACKGROUND_SYNC_TRIGGERED' });
        }
      })()
    );
  }
});

console.log('[Service Worker] Loaded', VERSION);
