// Echo — minimal offline app-shell cache.
// Bump CACHE_NAME whenever index.html changes so old clients pick up updates
// instead of getting stuck on a stale cached version.
const CACHE_NAME = 'echo-shell-v3';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for the app shell so updates show up quickly when online;
// falls back to cache when offline. Third-party CDN scripts (React, fonts)
// are left to the browser's normal HTTP cache rather than intercepted here.
//
// IMPORTANT: only GET requests are cacheable — the Cache API throws if you
// call cache.put() on a POST/PUT/etc request. Every serverless function call
// (checkout, cancellation, webhooks-adjacent client calls) is a POST, so
// without these guards this handler was silently breaking those requests —
// the function itself would run fine server-side, but the browser never
// got a valid response back, which is what caused the JSON parse errors.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return; // let POST/etc pass straight through, uncached
  if (url.pathname.startsWith('/.netlify/functions/')) return; // API calls are never cached, regardless of method

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Daily reminder / re-engagement pushes arrive here — sent by the
// send-daily-reminder scheduled function via the Web Push protocol.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) {}

  const title = payload.title || 'Echo';
  const options = {
    body: payload.body || "Take a minute to check in with yourself today.",
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: payload.url || './' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(clients.openWindow(targetUrl));
});

