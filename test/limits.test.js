import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, adminLogin, barcodeOf } from './helpers.js';
import { sweepStaleCarts } from '../server/services/core.js';

const put = (app, token, url, values) => call(app, 'PUT', `/api/a/cart-limits${url}`, { token, body: { values } });
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

test('cấu hình giỏ hàng: mặc định, kiểm tra khoảng cho phép, ghi đè từng siêu thị, quyền, nhật ký', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const g = await call(app, 'GET', '/api/a/cart-limits', { token: admin });
  assert.equal(g.status, 200);
  assert.equal(g.body.global.lockedMinutes, 30); assert.equal(g.body.global.maxQty, 99); assert.equal(g.body.global.maxShopHours, 0);
  assert.equal((await put(app, admin, '', { lockedMinutes: 1 })).body.error, 'BAD_LIMITS');      // dưới mức cho phép
  assert.equal((await put(app, admin, '', { maxQty: 2.5 })).body.error, 'BAD_LIMITS');           // phải là số nguyên
  assert.equal((await put(app, admin, '', { abc: 1 })).body.error, 'BAD_LIMITS');                // mục không có
  assert.equal((await put(app, admin, '', { lockedMinutes: 45, idleHours: 1.5 })).status, 200);
  assert.equal((await call(app, 'GET', '/api/a/cart-limits', { token: admin })).body.global.lockedMinutes, 45);
  assert.equal((await put(app, admin, '/stores/Q7', { lockedMinutes: 10 })).body.stores.Q7.lockedMinutes, 10);
  assert.equal((await put(app, admin, '/stores/Q7', { lockedMinutes: null })).body.stores.Q7, undefined); // bỏ ghi đè: dùng giá trị chung
  assert.equal((await put(app, admin, '/stores/NOPE', { lockedMinutes: 10 })).status, 404);
  assert.equal((await put(app, admin, '', { lockedMinutes: null, idleHours: null })).body.global.lockedMinutes, 30); // về mặc định
  const q7 = (await adminLogin(app, 'QT0007')).body.token; // quản trị chi nhánh
  assert.equal((await put(app, q7, '', { lockedMinutes: 20 })).status, 403);
  assert.equal((await put(app, q7, '/stores/Q7', { lockedMinutes: 20 })).status, 403);
  assert.equal((await call(app, 'GET', '/api/a/cart-limits', { token: q7 })).status, 200);
  const aud = app.ctx.db.prepare("SELECT action FROM audit_events WHERE action LIKE 'limits.%'").all().map((r) => r.action);
  assert.ok(aud.includes('limits.global_saved') && aud.includes('limits.store_saved'));
  await app.close();
});

test('giới hạn quét: số lượng tối đa mỗi mã, số mã tối đa, thời gian mua sắm tối đa, đều theo từng siêu thị', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  await put(app, admin, '/stores/Q7', { maxQty: 2, maxItems: 10, maxShopHours: 1 });
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const id = s.body.session.id;
  const scan = async (sku, opId) => (await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: opId, type: 'scan', barcode: barcodeOf(app, 'Q7', sku) }] } })).body.results[0];
  assert.equal((await scan('SUA01', 'a')).ok, true);
  assert.equal((await scan('SUA01', 'b')).ok, true);
  const over = await scan('SUA01', 'c');
  assert.equal(over.ok, false); assert.equal(over.code, 'BAD_QTY'); assert.match(over.message, /tối đa mỗi mặt hàng là 2/);
  assert.equal((await call(app, 'GET', '/api/c/store/Q7')).body.maxQty, 2);
  // quá thời gian mua sắm: không quét thêm được, nhưng vẫn giảm số lượng và thanh toán được
  app.ctx.db.prepare('UPDATE scan_sessions SET started_at = ? WHERE id = ?').run(ago(61), id);
  const late = await scan('MI01', 'd');
  assert.equal(late.ok, false); assert.equal(late.code, 'SHOP_TIME_UP');
  const itemId = (await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.items[0].id;
  const dec = await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'e', type: 'setQty', itemId, qty: 1 }] } });
  assert.equal(dec.body.results[0].ok, true);
  const inc = await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'f', type: 'setQty', itemId, qty: 2 }] } });
  assert.equal(inc.body.results[0].code, 'SHOP_TIME_UP');
  // siêu thị khác không bị ảnh hưởng
  assert.equal((await call(app, 'GET', '/api/c/store/Q1')).body.maxQty, 99);
  await app.close();
});

test('hạn chờ thanh toán theo từng siêu thị: đặt 10 phút thì quá 12 phút bị hủy, siêu thị khác vẫn 30 phút; hạn giữ sau thanh toán theo cấu hình', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const db = app.ctx.db;
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const id = s.body.session.id;
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: barcodeOf(app, 'Q7', 'SUA01') }] } });
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: 'Q7-LIMIT23456' } })).body.transaction;
  db.prepare('UPDATE scan_sessions SET last_activity = ?').run(ago(12));
  assert.equal(sweepStaleCarts(app.ctx), 0); // mặc định 30 phút: chưa hết hạn
  await put(app, admin, '/stores/Q7', { lockedMinutes: 10 });
  assert.equal(sweepStaleCarts(app.ctx), 1); // riêng Q7 10 phút: hết hạn
  assert.equal(db.prepare('SELECT status, cancel_reason FROM transactions WHERE id=?').get(tx.id).cancel_reason, 'expired');
  // hạn giữ sau khi thanh toán: đặt riêng 20 phút
  await put(app, admin, '/stores/Q7', { receiptMinutes: 20 });
  const tx2 = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: 'Q7-LIMIT2ABCDE' } })).body.transaction;
  const paid = await call(app, 'POST', `${'/api/pos/v1'}/baskets/Q7-LIMIT2ABCDE/paid`, { token: key, body: { posOrderRef: 'P-LIM', pointCode: 'SP-Q7', amount: tx2.total, method: 'cash' } });
  assert.equal(paid.status, 200);
  const exp = Date.parse(db.prepare('SELECT receipt_expires_at e FROM transactions WHERE id=?').get(tx2.id).e);
  assert.ok(Math.abs(exp - (Date.now() + 20 * 60_000)) < 60_000, 'hạn giữ sau thanh toán phải là 20 phút');
  await app.close();
});
