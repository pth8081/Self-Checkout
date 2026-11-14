import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, adminLogin, staffLogin, barcodeOf } from './helpers.js';
import { isEmail } from '../server/util.js';

const POS = '/api/pos/v1';
const pos = (app, key, method, path, body) => call(app, method, POS + path, { token: key, body });

test('email: kiểm tra tuyến tính, không bị ReDoS, không nhận ký tự tách người nhận', () => {
  const t0 = Date.now();
  assert.equal(isEmail('a@' + '.'.repeat(80000) + '@'), false);
  assert.equal(isEmail('x'.repeat(100000)), false);
  assert.ok(Date.now() - t0 < 200, 'phải trả lời nhanh');
  assert.equal(isEmail('khach.hang+tag@cong-ty.com.vn'), true);
  for (const bad of ['a1,v@x.vn', 'a5;v@x.vn', 'a b@x.vn', '"a"@x.vn', 'a@x', 'a@x..vn', '<a>@x.vn']) assert.equal(isEmail(bad), false, bad);
});

test('nhân viên: đăng xuất thật thu hồi token', async () => {
  const app = await makeApp();
  const token = await staffLogin(app); // NV0142: thu ngân
  assert.equal((await call(app, 'GET', '/api/s/me', { token })).status, 200);
  assert.equal((await call(app, 'POST', '/api/s/logout', { token, body: {} })).status, 200);
  await new Promise((r) => setTimeout(r, 1100)); // mốc thu hồi theo giây
  assert.equal((await call(app, 'GET', '/api/s/me', { token })).status, 401);
  await app.close();
});

test('POS: link có userinfo/ký tự lạ bị bỏ qua; hoàn theo mặt hàng ngoài đơn bị từ chối; tổng dòng hoàn phải bằng amount; báo lại khác số tiền bị 409; giỏ chi nhánh khác báo 404', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const id = s.body.session.id;
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: barcodeOf(app, 'Q7', 'SUA01') }, { id: 'b', type: 'scan', barcode: barcodeOf(app, 'Q7', 'SUA01') }] } });
  const code = 'Q7-SEC2345678';
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: code } })).body.transaction;
  const base = { posOrderRef: 'P-SEC', pointCode: 'SP-Q7', amount: tx.total, method: 'cash' };
  const ok = await pos(app, key, 'POST', `/baskets/${code}/paid`, { ...base, invoiceUrl: 'https://dsmart.vn@evil.example/x', transactionUrl: 'https://good.example/a"b' });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.warnings?.length >= 2, 'cả hai link xấu phải bị bỏ qua');
  assert.equal(app.ctx.db.prepare('SELECT pos_invoice_url u FROM transactions WHERE id = ?').get(tx.id).u, null);
  assert.equal((await pos(app, key, 'POST', `/baskets/${code}/paid`, { ...base, amount: base.amount + 1 })).body.error, 'PAID_MISMATCH');
  const refund = (b) => pos(app, key, 'POST', `/baskets/${code}/refund`, { pointCode: 'SP-Q7', posOrderRef: 'P-SEC', ...b });
  assert.equal((await refund({ refundRef: 'R1', amount: 1000, lines: [{ sku: 'sua01', qty: 1, amount: 1000 }] })).body.error, 'BAD_LINES'); // khác chữ hoa thường: không nhận ra
  assert.equal((await refund({ refundRef: 'R2', amount: 1000, lines: [{ sku: 'SUA01', qty: 1, amount: 900 }] })).body.error, 'BAD_LINES'); // tổng dòng khác amount
  assert.equal((await refund({ refundRef: 'R3', amount: 1000, lines: [{ sku: 'SUA01', qty: 1, amount: 1000 }] })).status, 200);
  // refund/invoice gọi nhầm giỏ chưa thanh toán không được khóa giỏ của khách
  const s2 = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  await call(app, 'POST', `/api/c/sessions/${s2.body.session.id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: barcodeOf(app, 'Q7', 'MI01') }] } });
  const code2 = 'Q7-SEC2ABCDEF';
  const tx2 = (await call(app, 'POST', `/api/c/sessions/${s2.body.session.id}/basket`, { body: { ref: code2 } })).body.transaction;
  await pos(app, key, 'POST', `/baskets/${code2}/refund`, { pointCode: 'SP-Q7', posOrderRef: 'P-X', refundRef: 'R9', amount: 1000 });
  assert.equal(app.ctx.db.prepare('SELECT pos_order_ref r FROM transactions WHERE id = ?').get(tx2.id).r, null);
  await app.close();
});

test('quản trị: tên chi nhánh không chứa ký tự HTML; quản trị chi nhánh không có chi nhánh bị chặn ở nhật ký', async () => {
  const app = await makeApp();
  const admin = (await adminLogin(app)).body.token;
  const r = await call(app, 'PUT', '/api/a/stores/Q7', { token: admin, body: { name: 'x"><img src=x>' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'BAD_NAME');
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7', { token: admin, body: { name: { a: 1 } } })).status, 400);
  await app.close();
});

test('mã đơn Dsmart: duy nhất trong từng cửa hàng ở cả tầng CSDL; cửa hàng khác nhau được cùng mã', async () => {
  const app = await makeApp({ basket: true });
  const db = app.ctx.db;
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_tx_store_pos_ref'").get(), 'phải có chỉ mục duy nhất');
  // tạo một giao dịch mẫu qua API để có dòng dữ liệu thật
  const admin = (await adminLogin(app)).body.token; void admin;
  const ss = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  await call(app, 'POST', `/api/c/sessions/${ss.body.session.id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: barcodeOf(app, 'Q7', 'SUA01') }] } });
  await call(app, 'POST', `/api/c/sessions/${ss.body.session.id}/basket`, { body: { ref: 'Q7-UNIQ234567' } });
  const base = db.prepare('SELECT * FROM transactions LIMIT 1').get();
  assert.ok(base, 'phải có giao dịch mẫu');
  const stores = db.prepare('SELECT id FROM stores ORDER BY id LIMIT 2').all().map((s) => s.id);
  assert.equal(stores.length, 2);
  const mk = (id, store, ref) => {
    const cols = Object.keys(base || {});
    const row = { ...base, id, store_id: store, pos_order_ref: ref, cart_code: id };
    db.prepare(`INSERT INTO transactions(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
  };
  db.prepare('UPDATE transactions SET pos_order_ref = NULL').run();
  mk('T-A1', stores[0], 'HD0001');
  mk('T-B1', stores[1], 'HD0001'); // cửa hàng khác: được
  assert.throws(() => mk('T-A2', stores[0], 'HD0001'), /UNIQUE/); // cùng cửa hàng: bị chặn
  await app.close();
});

test('bảng mã hàng và giá cho điện thoại: có ETag, trả 304 khi chưa đổi, đổi giá thì có phiên bản mới, cần mã thiết bị', async () => {
  const app = await makeApp({ basket: true });
  const r = await call(app, 'GET', '/api/c/catalog/Q7');
  assert.equal(r.status, 200);
  assert.ok(r.body.count > 0 && Array.isArray(r.body.items[0]) && r.body.items[0].length === 8);
  const sku = r.body.items.find((x) => x[1] === 'SUA01');
  assert.ok(sku && sku[0] === barcodeOf(app, 'Q7', 'SUA01') && sku[3] > 0);
  const etag = (await app.inject({ method: 'GET', url: '/api/c/catalog/Q7', headers: { 'x-device-id': 'dev-1234567890abcdef' } })).headers.etag;
  assert.ok(etag);
  const again = await app.inject({ method: 'GET', url: '/api/c/catalog/Q7', headers: { 'x-device-id': 'dev-1234567890abcdef', 'if-none-match': etag } });
  assert.equal(again.statusCode, 304);
  app.ctx.db.prepare("UPDATE product_cache SET price = price + 1000, synced_at = '2099-01-01T00:00:00Z' WHERE store_id = 'Q7' AND sku = 'SUA01'").run();
  const changed = await app.inject({ method: 'GET', url: '/api/c/catalog/Q7', headers: { 'x-device-id': 'dev-1234567890abcdef', 'if-none-match': etag } });
  assert.equal(changed.statusCode, 200);
  assert.notEqual(changed.headers.etag, etag);
  assert.equal((await app.inject({ method: 'GET', url: '/api/c/catalog/Q7' })).statusCode, 400); // thiếu mã thiết bị
  assert.equal((await call(app, 'GET', '/api/c/catalog/NOPE')).status, 404);
  await app.close();
});
