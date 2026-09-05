const CACHE = 'ashwini-offline-v1';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add('/offline.html')));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ashwini-offline-') && key !== CACHE).map(key => caches.delete(key)))));
});
// Always request current pages; never store customer, API, cart or payment data.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match('/offline.html')) || new Response('You are offline. Please reconnect and reload.', {status:503,headers:{'Content-Type':'text/plain'}})));
});
