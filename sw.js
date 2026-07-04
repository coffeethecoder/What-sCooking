// Minimal service worker — just enough to make the app installable
// as a home-screen icon. It doesn't cache anything special right now,
// so the app always loads the latest version from the network.

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request));
});