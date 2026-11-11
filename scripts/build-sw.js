// Sinh service worker cho từng ứng dụng (c, s, a): danh sách file cần lưu sẵn + phiên bản theo nội dung.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});

for (const app of ['c', 's', 'a']) {
  const files = [...walk(path.join(pub, 'shared')), ...walk(path.join(pub, app))]
    .filter((f) => !f.endsWith('sw.js') && !f.endsWith('.map') && !f.includes('/icons/icon-maskable'))
    .sort();
  const hash = crypto.createHash('sha1');
  for (const f of files) hash.update(f).update(fs.readFileSync(f));
  const urls = files.map((f) => '/' + path.relative(pub, f).split(path.sep).join('/'));
  const shell = `/${app}/`;
  const src = `// Tạo tự động bởi scripts/build-sw.js, không sửa tay.
const VERSION = '${hash.digest('hex').slice(0, 12)}';
const CACHE = 'brg-${app}-' + VERSION;
const SHELL = ${JSON.stringify([shell, ...urls], null, 1)};

self.addEventListener('install', (e) => {
  // Không tự thay bản đang chạy: bản mới chờ (waiting) tới khi người dùng bấm "Cập nhật ngay" trên thông báo (xem registerSW trong shared/lib.js).
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('brg-${app}-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // API luôn đi mạng
  if (req.mode === 'navigate') {
    // Mở trang: ưu tiên mạng, mất mạng thì dùng bản đã lưu.
    e.respondWith(fetch(req).catch(() => caches.match('${shell}')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
`;
  fs.writeFileSync(path.join(pub, app, 'sw.js'), src);
  console.log(`sw.js cho /${app}/: ${urls.length} file, phiên bản ${src.match(/VERSION = '(\w+)'/)[1]}`);
}
