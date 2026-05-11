// Bump this when web assets change to avoid stale cache in iOS WebView
const CACHE_NAME = 'dm-manager-v7';
const ASSETS = ['./index.html', './i18n.js', './icon.svg', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const path = url.pathname || '';
  // 文言はキャッシュ古いとキーがそのまま出るので、JSはネットワーク優先
  const networkFirstJs = path.endsWith('.js');
  e.respondWith(
    (networkFirstJs
      ? fetch(e.request)
          .then(res => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then(c => c.put(e.request, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => caches.match(e.request))
      : caches.match(e.request).then(cached => cached || fetch(e.request)))
  );
});
