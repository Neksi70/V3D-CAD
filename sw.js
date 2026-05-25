const CACHE = 'volme3d-occt-v1';
const OCCT_FILES = ['/volme3d-occt.js', '/volme3d-occt.wasm'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(OCCT_FILES)));
  self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (OCCT_FILES.some(f => e.request.url.includes(f))) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
