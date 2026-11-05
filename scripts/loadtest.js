// Thử tải đơn giản: nhiều "khách" cùng quét món. Dùng để ước lượng sức chịu tải của MỘT tiến trình.
//   BASE=http://localhost:3000 STORE=Q7 CLIENTS=100 SECONDS=15 npm run loadtest
// Cần chi nhánh đã bật và có dữ liệu sản phẩm (xem README). Tạo nhiều phiên thử, không dùng ở máy chủ thật đang bán hàng.
const BASE = process.env.BASE || 'http://localhost:3000';
const STORE = process.env.STORE || 'Q7';
const CLIENTS = Number(process.env.CLIENTS || 100);
const SECONDS = Number(process.env.SECONDS || 15);
const barcodes = (process.env.BARCODES || '').split(',').filter(Boolean);

const lat = []; let ok = 0, fail = 0;
async function call(method, url, body, headers) {
  const t = performance.now();
  try {
    const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    lat.push(performance.now() - t);
    r.ok ? ok++ : fail++;
    return { status: r.status, j };
  } catch { fail++; return { status: 0 }; }
}
if (!barcodes.length) { console.error('Truyền BARCODES=mã1,mã2,... (mã vạch có trong chi nhánh).'); process.exit(1); }

const end = Date.now() + SECONDS * 1000;
async function customer(i) {
  const h = { 'x-device-id': `load${String(i).padStart(6, '0')}${Math.random().toString(36).slice(2, 12)}` };
  while (Date.now() < end) {
    const s = await call('POST', '/api/c/sessions', { storeId: STORE, fresh: true }, h);
    if (s.status !== 200) { await new Promise((r) => setTimeout(r, 200)); continue; }
    const id = s.j.session.id;
    for (let k = 0; k < 8 && Date.now() < end; k++) {
      await call('POST', `/api/c/sessions/${id}/ops`, { ops: [{ id: `${i}-${k}-${Date.now()}`, type: 'scan', barcode: barcodes[(i + k) % barcodes.length] }] }, h);
      await call('GET', `/api/c/sessions/${id}`, null, h);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: CLIENTS }, (_, i) => customer(i)));
lat.sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]?.toFixed(0);
console.log(`${CLIENTS} khách cùng lúc, ${((Date.now() - t0) / 1000).toFixed(0)} giây: ${ok} yêu cầu thành công, ${fail} lỗi, ${(ok / ((Date.now() - t0) / 1000)).toFixed(0)} yêu cầu/giây`);
console.log(`Độ trễ: trung vị ${q(0.5)} ms, p95 ${q(0.95)} ms, p99 ${q(0.99)} ms, lớn nhất ${lat[lat.length - 1]?.toFixed(0)} ms`);
