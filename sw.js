const CACHE_NAME = 'gestao-beleza-v6';
const APP_SHELL = ['./', './index.html', './styles.css', './app.js', './cadastros.js', './caixa.js', './comissoes.js', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const pathname = new URL(event.request.url).pathname;
  const isCoreFile = pathname.endsWith('/app.js') || pathname.endsWith('/index.html') || pathname.endsWith('/sw.js');
  const networkFirst = fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  });
  event.respondWith(isCoreFile ? networkFirst.catch(() => caches.match(event.request)) : caches.match(event.request).then((cached) => cached || networkFirst).catch(() => caches.match('./index.html')));
});
