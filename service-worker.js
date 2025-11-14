const CACHE_NAME = 'esa-cache-v12.1';
const OFFLINE_URL = './index.html';
const urlsToCache = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing v12.1...');
  self.skipWaiting(); // Activate worker immediately
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell');
      return cache.addAll(urlsToCache).catch(err => {
        console.warn('[Service Worker] Cache addAll failed:', err);
        // Continue even if some resources fail to cache
        return Promise.resolve();
      });
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating v12.1...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name.startsWith('esa-cache-'))
          .map((name) => {
            console.log('[Service Worker] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  
  // Take control of all pages immediately
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Don't cache Firebase, API calls, or external CDN live requests
  if (
    url.origin.includes('firebase') ||
    url.origin.includes('google') ||
    url.origin.includes('yahoo') ||
    url.origin.includes('workers.dev') ||
    request.method !== 'GET'
  ) {
    // Network only for these requests
    event.respondWith(
  fetch(request).catch(() => caches.match(request))
);
return;

  }
  
  // Cache-first strategy for app resources
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        console.log('[Service Worker] Serving from cache:', request.url);
        return cachedResponse;
      }
      
      // Not in cache, fetch from network
      return fetch(request)
        .then((networkResponse) => {
          // Only cache successful responses
          if (
            !networkResponse ||
            networkResponse.status !== 200 ||
            networkResponse.type !== 'basic'
          ) {
            return networkResponse;
          }
          
          // Clone and cache the response
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
            console.log('[Service Worker] Cached new resource:', request.url);
          });
          
          return networkResponse;
        })
        .catch((error) => {
          console.error('[Service Worker] Fetch failed:', error);
          
          // Return offline page for navigation requests
          if (request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
          
          // For other requests, return a generic error response
          return new Response('Offline - resource not available', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
              'Content-Type': 'text/plain'
            })
          });
        });
    })
  );
});

// Listen for messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => caches.delete(name))
        );
      }).then(() => {
        console.log('[Service Worker] All caches cleared');
      })
    );
  }
});

// Background sync for offline data (future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-analysis') {
    console.log('[Service Worker] Background sync triggered');
    event.waitUntil(
      // Could trigger cloud sync here
      Promise.resolve()
    );
  }
});

console.log('[Service Worker] v12.1 loaded');
