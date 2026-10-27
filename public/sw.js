// Lets CivicLens be installed as an app. Pages always come from the network (so every deploy shows up
// at once); the last copy of the start page is only used when the phone is offline. API calls, photos
// and sign-in are never touched.
const CACHE = 'civiclens-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/')));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.mode !== 'navigate' || new URL(request.url).pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && new URL(request.url).pathname === '/') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/', copy));
        }
        return response;
      })
      .catch(() => caches.match('/'))
  );
});
