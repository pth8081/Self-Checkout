// Tạo tự động bởi scripts/build-sw.js, không sửa tay.
const VERSION = '955246d2a993';
const CACHE = 'brg-a-' + VERSION;
const SHELL = [
 "/a/",
 "/a/admin.css",
 "/a/app.js",
 "/a/common.js",
 "/a/guide-diagram.js",
 "/a/guide-render.js",
 "/a/guides.js",
 "/a/index.html",
 "/a/manifest.webmanifest",
 "/a/pages-chain.js",
 "/a/pages-store.js",
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
  e.waitUntil((async () => {
    // Có cache của bản cũ mà chưa có dấu 'brg-ui2-a' nghĩa là trang đang mở thuộc bản cũ (trước khi có thông báo cập nhật), không tự hiện được nút "Cập nhật ngay".
    // Chỉ lần chuyển này: tự kích hoạt bản mới ngay (không để bản cũ giữ chỗ), người dùng mở lại hoặc tải lại trang là chạy bản mới. Từ sau đó bản mới chờ (waiting) tới khi người dùng bấm "Cập nhật ngay" (xem registerSW trong shared/lib.js).
    const keys = await caches.keys();
    const legacy = keys.some((k) => k.startsWith('brg-a-')) && !keys.includes('brg-ui2-a');
    await (await caches.open(CACHE)).addAll(SHELL);
    if (legacy) { await caches.open('brg-ui2-a'); self.skipWaiting(); }
    else await caches.open('brg-ui2-a');
  })());
});
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter((k) => k.startsWith('brg-a-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // API luôn đi mạng
  if (req.mode === 'navigate') {
    // Mở trang: ưu tiên mạng, mất mạng thì dùng bản đã lưu.
    e.respondWith(fetch(req).catch(() => caches.match('/a/')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
