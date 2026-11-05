// Tạo tự động bởi scripts/build-sw.js, không sửa tay.
const VERSION = '238c673c1ca9';
const CACHE = 'brg-c-' + VERSION;
const SHELL = [
 "/c/",
 "/c/app.js",
 "/c/index.html",
 "/c/manifest.webmanifest",
 "/c/screens-basket.js",
 "/c/screens-pay.js",
 "/c/screens-scan.js",
 "/c/screens-start.js",
 "/c/store.js",
 "/shared/basket.js",
 "/shared/fonts.css",
 "/shared/fonts/inter-latin-ext.woff2",
 "/shared/fonts/inter-latin.woff2",
 "/shared/fonts/inter-vietnamese.woff2",
 "/shared/icons/icon-192.png",
 "/shared/icons/icon-512.png",
 "/shared/lib.js",
 "/shared/logo.svg",
 "/shared/ui.css",
 "/shared/vendor/htm.js",
 "/shared/vendor/preact-hooks.js",
 "/shared/vendor/preact.js",
 "/shared/vendor/qrcode.js",
 "/shared/vendor/zxing.min.js"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('brg-c-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // API luôn đi mạng
  if (req.mode === 'navigate') {
    // Mở trang: ưu tiên mạng, mất mạng thì dùng bản đã lưu.
    e.respondWith(fetch(req).catch(() => caches.match('/c/')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
