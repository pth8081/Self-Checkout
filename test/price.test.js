import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeApp, call, adminLogin, barcodeOf } from './helpers.js';
import { clearPriceMemory } from '../server/services/price-api.js';

const POS = '/api/pos/v1';
const pos = (app, key, method, path, body) => call(app, method, POS + path, { token: key, body });

/** Máy chủ giá giả của đối tác: nhớ các lần gọi và trả theo bảng `table` (mã vạch -> dữ liệu), `mode` điều khiển lỗi. */
async function partner(table) {
  const calls = [];
  const st = { mode: 'ok', calls };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    calls.push({ maVach: u.searchParams.get('maVach'), maDiem: u.searchParams.get('maDiem'), key: req.headers['x-api-key'] });
    if (st.mode === 'down') { res.writeHead(500); return res.end('{}'); }
    if (st.mode === 'slow') return; // không trả lời: để hết thời gian chờ
    if (st.mode === 'auth') { res.writeHead(401); return res.end('{}'); }
    const row = table[u.searchParams.get('maVach')];
    if (!row) { res.writeHead(404); return res.end('{"error":"NOT_FOUND"}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ reportId: 'gia-ban', ...row }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  srv.unref();
  st.url = `http://127.0.0.1:${srv.address().port}/api/v1/reports/gia-ban/run`;
  st.close = () => { srv.closeAllConnections?.(); return new Promise((r) => srv.close(r)); };
  return st;
}

const MILK = { maHang: '2003330491', tenHang: 'Sữa tươi TH True Milk 1L', maVach: '8934696001589', giaThuong: 24000, giaKhuyenMai: 21500, coKhuyenMai: true, capNhatLuc: '2026-11-10T09:00:18.000Z' };
const NOODLE = { maHang: '2003330500', tenHang: 'Mì hảo hảo', maVach: '8934563138165', giaThuong: 4500, giaKhuyenMai: null, coKhuyenMai: false, capNhatLuc: '2026-11-10T09:00:18.000Z' };

async function setup(table, extra = {}) {
  clearPriceMemory();
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const p = await partner(table);
  const put = await call(app, 'PUT', '/api/a/integrations/price-api', { token: admin, body: { url: p.url, key: 'khoa-thu', enabled: true, timeoutSec: 1, cacheMin: 5, ...extra } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  return { app, admin, p, sid: s.body.session.id };
}
const scan = (app, sid, barcode, id = 'o' + Math.random().toString(36).slice(2)) =>
  call(app, 'POST', `/api/c/sessions/${sid}/ops`, { body: { ops: [{ id, type: 'scan', barcode }] } });

test('cấu hình API giá: chỉ https (trừ máy nội bộ), phải có khóa mới bật được, khóa không lộ ra', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const put = (body, token = admin) => call(app, 'PUT', '/api/a/integrations/price-api', { token, body });
  assert.equal((await put({ url: 'http://api.hcrc.vn/x' })).body.error, 'BAD_PRICE_API');
  assert.equal((await put({ url: 'https://api.hcrc.vn/x?maVach=1' })).body.error, 'BAD_PRICE_API');
  assert.equal((await put({ enabled: true })).body.error, 'BAD_PRICE_API'); // chưa có địa chỉ và khóa
  assert.equal((await put({ url: 'https://api.hcrc.vn/api/v1/reports/gia-ban/run', key: 'bi-mat-123', enabled: true })).status, 200);
  const g = await call(app, 'GET', '/api/a/integrations/price-api', { token: admin });
  assert.equal(g.body.config.hasKey, true); assert.ok(!JSON.stringify(g.body).includes('bi-mat-123'));
  assert.equal((await put({ url: 'https://api.hcrc.vn/api/v1/reports/gia-ban/run' })).body.config.hasKey, true); // bỏ trống khóa thì giữ khóa cũ
  const q7 = (await adminLogin(app, 'QT0007')).body.token;
  assert.equal((await put({ enabled: false }, q7)).status, 403);
  await app.close();
});

test('quét mã vạch chưa có trong bộ nhớ: tra API giá theo maVach và maDiem, giá khuyến mại hiện kèm giá gốc, lần sau dùng giá đã lưu', async () => {
  const { app, p, sid } = await setup({ [MILK.maVach]: MILK, [NOODLE.maVach]: NOODLE });
  const r = await scan(app, sid, MILK.maVach);
  const it = r.body.results[0];
  assert.equal(it.ok, true, JSON.stringify(it));
  assert.equal(it.item.name, MILK.tenHang); assert.equal(it.item.price, 21500); assert.equal(it.item.listPrice, 24000); assert.equal(it.item.noPrice, false);
  assert.deepEqual(p.calls.map((c) => [c.maVach, c.maDiem, c.key]), [[MILK.maVach, 'SP-Q7', 'khoa-thu']]);
  await scan(app, sid, MILK.maVach); // lần hai: giá còn mới, không gọi lại
  assert.equal(p.calls.length, 1);
  const v = (await call(app, 'GET', `/api/c/sessions/${sid}`)).body.session;
  assert.equal(v.items[0].qty, 2); assert.equal(v.total, 43000);
  // hàng không khuyến mại: giá thường, không có giá gạch
  const n = (await scan(app, sid, NOODLE.maVach)).body.results[0].item;
  assert.equal(n.price, 4500); assert.equal(n.listPrice, null);
  await app.close(); await p.close();
});

test('API giá báo 404: mặt hàng vẫn vào giỏ ở dạng "chưa có giá", không tính vào tạm tính, ghi vào Mã không tìm thấy; Dsmart POS nhận mã vạch và số lượng', async () => {
  const { app, admin, p, sid } = await setup({ [MILK.maVach]: MILK });
  await scan(app, sid, MILK.maVach);
  const lonely = '8930000000008'; // hợp lệ về chữ số kiểm tra? dùng mã bất kỳ đã qua kiểm tra
  const ean = (await import('../server/services/barcode.js')).ean13('893000000000');
  const r = (await scan(app, sid, ean)).body.results[0];
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.item.noPrice, true); assert.equal(r.item.price, 0);
  const v = (await call(app, 'GET', `/api/c/sessions/${sid}`)).body.session;
  assert.equal(v.items.length, 2); assert.equal(v.total, 21500); // hàng chưa có giá không cộng tiền
  assert.ok(app.ctx.db.prepare('SELECT 1 FROM unknown_barcodes WHERE barcode = ?').get(ean));
  void lonely;
  // khóa giỏ và Dsmart POS lấy hàng
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const tx = (await call(app, 'POST', `/api/c/sessions/${sid}/basket`, { body: { ref: 'Q7-PRICE2345' } })).body.transaction;
  const g = await pos(app, key, 'GET', `/baskets/Q7-PRICE2345?pointCode=SP-Q7`);
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const np = g.body.items.find((i) => i.barcode === ean);
  assert.equal(np.qty, 1); assert.equal(np.unitPrice, null); assert.equal(np.name, null);
  assert.equal(g.body.items.find((i) => i.barcode === MILK.maVach).unitPrice, 21500);
  assert.equal(tx.total, 21500);
  await app.close(); await p.close();
});

test('API giá lỗi hoặc quá chậm: dùng giá đã lưu nếu có, chưa có thì "chưa có giá"; khóa sai báo cho quản trị', async () => {
  const { app, admin, p, sid } = await setup({ [MILK.maVach]: MILK, [NOODLE.maVach]: NOODLE }, { cacheMin: 1 });
  await scan(app, sid, MILK.maVach);
  p.mode = 'down';
  // giá cũ đã lưu quá hạn: API lỗi thì vẫn dùng giá đã lưu
  app.ctx.db.prepare(`UPDATE product_cache SET synced_at = ?`).run(new Date(Date.now() - 10 * 60_000).toISOString());
  const a = (await scan(app, sid, MILK.maVach)).body.results[0];
  assert.equal(a.ok, true); assert.equal(a.item.price, 21500); assert.equal(a.item.noPrice, false);
  // chưa có giá nào đã lưu: chưa có giá
  const b = (await scan(app, sid, NOODLE.maVach)).body.results[0];
  assert.equal(b.item.noPrice, true);
  // hết thời gian chờ (1 giây)
  clearPriceMemory(); p.mode = 'slow';
  const t0 = Date.now();
  const c = (await scan(app, sid, NOODLE.maVach, 'slow1')).body.results[0];
  assert.equal(c.ok, true); assert.ok(Date.now() - t0 < 3000);
  assert.equal(c.item.noPrice, true);
  // khóa sai
  clearPriceMemory(); p.mode = 'auth';
  await scan(app, sid, NOODLE.maVach, 'auth1');
  const g = await call(app, 'GET', '/api/a/integrations/price-api', { token: admin });
  assert.equal(g.body.lastError.code, 'AUTH');
  await app.close(); await p.close();
});

test('kiểm tra thử trong trang Tích hợp: tra giá theo chi nhánh và mã vạch, không cần quét', async () => {
  const { app, admin, p } = await setup({ [MILK.maVach]: MILK });
  const ok = await call(app, 'POST', '/api/a/integrations/price-api/test', { token: admin, body: { storeId: 'Q7', barcode: MILK.maVach } });
  assert.equal(ok.status, 200); assert.equal(ok.body.status, 'ok'); assert.equal(ok.body.row.price, 21500); assert.equal(ok.body.maDiem, 'SP-Q7');
  const nf = await call(app, 'POST', '/api/a/integrations/price-api/test', { token: admin, body: { storeId: 'Q7', barcode: '1234567890128' } });
  assert.equal(nf.body.status, 'notfound');
  await app.close(); await p.close();
});

test('nhập file mã điểm: xem trước, ghép chi nhánh theo mã hoặc tên, báo dòng lỗi, lưu danh sách và chặn mã điểm ngoài danh sách', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const stores = app.ctx.db.prepare('SELECT id, name FROM stores ORDER BY id').all();
  const [s1, s2] = stores;
  const csv = ['maDiem;maChiNhanh;tenDiem',
    `001;${s1.id};Điểm 1`,
    `002;;${s2.name.toUpperCase()}`,   // ghép theo tên, không phân biệt hoa thường
    '003;KHONGCO;Điểm lạ',             // chưa ghép được chi nhánh
    '001;' + s2.id + ';Trùng',          // mã điểm lặp
    'bad code!;' + s1.id + ';x'].join('\n');
  const pv = await call(app, 'POST', '/api/a/pos-points/preview', { token: admin, body: { text: csv } });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  const by = Object.fromEntries(pv.body.rows.map((r) => [r.line, r.status]));
  assert.deepEqual(by, { 2: 'ok', 3: 'ok', 4: 'nomatch', 5: 'dup', 6: 'bad' });
  assert.equal(pv.body.rows[1].storeId, s2.id);
  // xem trước không đổi gì
  assert.equal(app.ctx.db.prepare('SELECT pos_code FROM stores WHERE id = ?').get(s1.id).pos_code, 'SP-' + s1.id);
  const ap = await call(app, 'POST', '/api/a/pos-points/apply', { token: admin, body: { text: csv } });
  assert.equal(ap.status, 200); assert.equal(ap.body.assigned, 2); assert.equal(ap.body.saved, 3);
  assert.equal(app.ctx.db.prepare('SELECT pos_code FROM stores WHERE id = ?').get(s1.id).pos_code, '001');
  assert.equal(app.ctx.db.prepare('SELECT pos_code FROM stores WHERE id = ?').get(s2.id).pos_code, '002');
  const list = (await call(app, 'GET', '/api/a/pos-points', { token: admin })).body;
  assert.equal(list.total, 3); assert.equal(list.matched, 2);
  // chạy lại: không còn gì đổi
  const again = await call(app, 'POST', '/api/a/pos-points/preview', { token: admin, body: { text: csv } });
  assert.equal(again.body.summary.same, 2);
  // đã có danh sách thì mã điểm nhập tay phải nằm trong danh sách
  assert.equal((await call(app, 'PUT', `/api/a/stores/${s1.id}`, { token: admin, body: { posCode: 'XYZ-999' } })).body.error, 'POS_CODE_NOT_IN_LIST');
  assert.equal((await call(app, 'PUT', `/api/a/stores/${s1.id}`, { token: admin, body: { posCode: '003' } })).status, 200);
  // file không có cột mã điểm, và chỉ quản trị chuỗi dùng được
  assert.equal((await call(app, 'POST', '/api/a/pos-points/preview', { token: admin, body: { text: 'ten,dia chi\nA,B' } })).body.error, 'BAD_FILE');
  const q7 = (await adminLogin(app, 'QT0007')).body.token;
  assert.equal((await call(app, 'POST', '/api/a/pos-points/preview', { token: q7, body: { text: csv } })).status, 403);
  await app.close();
});
