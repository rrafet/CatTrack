/* Service worker — caches the app shell; Supabase requests always hit the network. */

const CACHE_NAME = 'cattrack-shell-v9';

const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './tw-config.js',
  './manifest.json',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/CatTrack-icon-1a.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Don't intercept cross-origin calls except the CDN libraries.
  const isOwnOrigin = url.origin === self.location.origin;
  const isCdnLib =
    url.hostname === 'cdn.tailwindcss.com' ||
    url.hostname === 'cdn.jsdelivr.net';
  if (!isOwnOrigin && !isCdnLib) return;

  // Network-first for the shell, falling back to cache when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) => cached || (request.mode === 'navigate' ? caches.match('./index.html') : undefined)
        )
      )
  );
});
