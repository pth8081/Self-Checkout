import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeApp, call, adminLogin, barcodeOf } from './helpers.js';

/** Máy chủ tồn kho giả của đối tác: có phân trang như tài liệu, nhớ các lần gọi, `mode` điều khiển lỗi. */
async function partner(rows) {
  const st = { rows, mode: 'ok', calls: [] };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    st.calls.push({ page: Number(u.searchParams.get('page')), pageSize: Number(u.searchParams.get('pageSize')), key: req.headers['x-api-key'], fields: u.searchParams.get('fields') });
    if (st.mode === 'forbidden') { res.writeHead(403); return res.end('{"error":"IP"}'); }
    if (st.mode === 'badshape') { res.writeHead(200); return res.end('{"nope":1}'); }
    const page = Number(u.searchParams.get('page') || 1), size = Number(u.searchParams.get('pageSize') || 200);
    const cols = ['maHang', 'maVach', 'tenHang', 'soLuongTon', 'maDiem', 'capNhatLuc'].map((key) => ({ key, label: key }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ reportId: 'ton-kho', page, pageSize: size, columns: cols, rows: st.rows.slice((page - 1) * size, page * size) }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  srv.unref();
  st.url = `http://127.0.0.1:${srv.address().port}/api/v1/reports/ton-kho/run`;
  st.close = () => { srv.closeAllConnections?.(); return new Promise((r) => srv.close(r)); };
  return st;
}
const row = (i, diem, qty) => ({ maHang: String(2000000000 + i), maVach: i % 5 ? `89300000${String(i).padStart(5, '0')}` : null, tenHang: `Hàng ${i}`, soLuongTon: qty, maDiem: diem, capNhatLuc: '2026-11-10T09:00:00.000Z' });

test('tồn kho từ API đối tác: lấy hết các trang, ghép theo mã điểm, chạy lại chỉ ghi dòng đổi, bỏ dòng không còn, báo lỗi rõ, tra đối chiếu', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  await call(app, 'PUT', '/api/a/stores/Q7', { token: admin, body: { posCode: 'SP-0107' } });
  const rows = [...Array.from({ length: 120 }, (_, i) => row(i + 1, 'SP-0107', i % 7 === 0 ? 0 : 10 + i)), row(500, 'SP-9999', 5), row(501, 'sp-0107', 3)];
  const p = await partner(rows);
  const cfg = (b) => call(app, 'PUT', '/api/a/integrations/stock-api', { token: admin, body: b });
  // cấu hình: https (trừ máy nội bộ), khóa, giới hạn
  assert.equal((await cfg({ url: 'http://example.com/x' })).body.error, 'BAD_STOCK_API');
  assert.equal((await cfg({ url: p.url + '?page=2' })).body.error, 'BAD_STOCK_API');
  assert.equal((await cfg({ pageSize: 5000 })).body.error, 'BAD_STOCK_API');
  assert.equal((await cfg({ intervalMin: 5 })).body.error, 'BAD_STOCK_API');
  assert.equal((await cfg({ enabled: true })).body.error, 'BAD_STOCK_API'); // chưa có địa chỉ và khóa
  const ok = await cfg({ url: p.url, key: 'khoa-ton', pageSize: 50, intervalMin: 30, enabled: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(JSON.stringify(ok.body).includes('khoa-ton'), false);
  // kiểm tra kết nối
  const t = await call(app, 'POST', '/api/a/integrations/stock-api/test', { token: admin });
  assert.equal(t.body.ok, true, JSON.stringify(t.body));
  assert.equal(t.body.sample[0].store, 'Chi nhánh Quận 7');
  // đồng bộ lần 1: 122 dòng, 3 trang (50, 50, 22)
  p.calls.length = 0;
  const r1 = (await call(app, 'POST', '/api/a/integrations/stock-api/run', { token: admin })).body;
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.pages, 3); assert.equal(r1.rows, 122); assert.equal(r1.matched, 121); assert.equal(r1.unmatched, 1); assert.deepEqual(r1.unmatchedCodes, ['SP-9999']);
  assert.equal(r1.written, 121);
  assert.deepEqual(p.calls.map((c) => c.page), [1, 2, 3]);
  assert.ok(p.calls.every((c) => c.key === 'khoa-ton' && c.pageSize === 50));
  let status = (await call(app, 'GET', '/api/a/integrations/stock-api', { token: admin })).body;
  const q7 = status.stores.find((s) => s.id === 'Q7');
  assert.equal(q7.items, 121); assert.equal(q7.outOfStock, 18); assert.equal(q7.sourceAt, '2026-11-10T09:00:00.000Z');
  assert.equal(status.last.ok, true);
  // lần 2: không đổi gì thì không ghi
  const r2 = (await call(app, 'POST', '/api/a/integrations/stock-api/run', { token: admin })).body;
  assert.equal(r2.written, 0); assert.equal(r2.unchanged, 121); assert.equal(r2.removed, 0);
  // lần 3: một dòng đổi số, một dòng biến mất
  rows[0].soLuongTon = 77; rows.splice(1, 1);
  const r3 = (await call(app, 'POST', '/api/a/integrations/stock-api/run', { token: admin })).body;
  assert.equal(r3.written, 1); assert.equal(r3.removed, 1);
  const look = (await call(app, 'GET', `/api/a/integrations/stock-api/lookup?q=${rows[0].maHang}`, { token: admin })).body.rows;
  assert.equal(look.length, 1); assert.equal(look[0].qty, 77); assert.equal(look[0].storeId, 'Q7');
  assert.equal((await call(app, 'GET', `/api/a/integrations/stock-api/lookup?q=${row(2, 'x', 0).maHang}`, { token: admin })).body.rows.length, 0);
  // lỗi: IP chưa đăng ký, dữ liệu sai dạng; dữ liệu cũ vẫn giữ
  p.mode = 'forbidden';
  const bad = (await call(app, 'POST', '/api/a/integrations/stock-api/run', { token: admin })).body;
  assert.equal(bad.ok, false); assert.match(bad.error, /IP/);
  status = (await call(app, 'GET', '/api/a/integrations/stock-api', { token: admin })).body;
  assert.equal(status.last.ok, false); assert.ok(status.lastError); assert.equal(status.stores.find((s) => s.id === 'Q7').items, 120);
  p.mode = 'badshape';
  assert.equal((await call(app, 'POST', '/api/a/integrations/stock-api/test', { token: admin })).body.ok, false);
  // chỉ quản trị chuỗi
  assert.equal((await call(app, 'GET', '/api/a/integrations/stock-api')).status, 401);
  await p.close();
  await app.close();
});
