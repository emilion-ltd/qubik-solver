const CACHE = 'cubesolve-v4';
const ASSETS = ['./','./index.html','./cube-core.js','./solver-worker.js','./pwa.js','./payment-client.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
const urls = ASSETS.map(p => new URL(p, self.registration.scope).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(urls)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('cubesolve-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => { if(event.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request=event.request, url=new URL(request.url);
  // Only the explicit static shell is cached. Payments, API and other origins bypass this worker.
  if(request.method !== 'GET' || url.origin !== self.location.origin) return;
  url.search=''; url.hash='';
  if(!urls.includes(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached=await cache.match(url.href);
    return cached || fetch(request);
  }));
});
