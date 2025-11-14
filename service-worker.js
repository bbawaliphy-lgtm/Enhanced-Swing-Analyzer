// Minimal, robust PWA Service Worker - cache app shell, network-first for external APIs
const CACHE_NAME = 'esa-cache-v1';
const OFFLINE_URL = './index.html';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// Install: pre-cache shell
self.addEventListener('install', (evt) => {
  self.skipWaiting();
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {
        // tolerate failures
        return Promise.resolve();
      });
    })
  );
});

// Activate: cleanup old caches
self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Fetch: cache-first for app shell, network-first for API requests (Yahoo proxy)
self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  const url = new URL(req.url);

  // Network-first for the Yahoo proxy or external API calls (so data isn't stale)
  if (url.hostname.includes('titir95biplab.workers.dev') || url.hostname.includes('query1.finance.yahoo.com')) {
    evt.respondWith(
      fetch(req).then(res => {
        // optionally cache but keep response direct
        return res;
      }).catch(() => {
        // fallback to cache if available
        return caches.match(req).then(r => r || new Response('Offline', {status: 503}));
      })
    );
    return;
  }

  // For navigation and app shell - cache-first
  if (req.mode === 'navigate' || req.destination === 'document' || req.url.endsWith('index.html')) {
    evt.respondWith(
      caches.match(req).then(cached => {
        return cached || fetch(req).then(network => {
          caches.open(CACHE_NAME).then(cache => cache.put(req, network.clone()));
          return network;
        }).catch(() => caches.match(OFFLINE_URL));
      })
    );
    return;
  }

  // For other GET resources - try cache, then network, then fallback
  if (req.method === 'GET') {
    evt.respondWith(
      caches.match(req).then(cached => {
        return cached || fetch(req).then(network => {
          // Only store same-origin static resources
          if (network && network.status === 200 && network.type === 'basic') {
            caches.open(CACHE_NAME).then(cache => cache.put(req, network.clone()));
          }
          return network;
        }).catch(() => new Response('Offline - resource not available', { status: 503 }));
      })
    );
    return;
  }

  // Default: network
  evt.respondWith(fetch(req));
});
