// Bump this when web assets change to avoid stale cache in iOS WebView
const CACHE_NAME = 'dm-manager-v57';
const ASSETS = ['./index.html', './i18n.js', './icon.svg', './manifest.json'];

function cacheFreshResponse(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(c => c.put(request, copy)).catch(() => {});
  }
  return response;
}

function networkFirstHtml(request) {
  return fetch(request)
    .then(res => cacheFreshResponse(request, res))
    .catch(() => caches.match(request));
}

function cacheFirstAsset(request) {
  return caches.match(request).then(cached => cached || fetch(request));
}

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
  // Web版で古い index.html が残るとクリック処理も古いままになるため、画面本体はネットワーク優先。
  const networkFirstAppShell = e.request.mode === 'navigate' || path.endsWith('/index.html') || path.endsWith('/');
  // 文言はキャッシュ古いとキーがそのまま出るので、JSはネットワーク優先
  const networkFirstJs = path.endsWith('.js');
  e.respondWith(
    (networkFirstAppShell
      ? networkFirstHtml(e.request)
      : networkFirstJs
      ? fetch(e.request)
          .then(res => cacheFreshResponse(e.request, res))
          .catch(() => caches.match(e.request))
      : cacheFirstAsset(e.request))
  );
});
