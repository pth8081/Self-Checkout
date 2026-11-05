import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, adminLogin, staffLogin, barcodeOf, DEVICE } from './helpers.js';

const POS = '/api/pos/v1';

async function setup(app, { posMode = true, store = 'Q7' } = {}) {
  const admin = (await adminLogin(app)).body.token;
  const k = await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS thử', storeId: store } });
  assert.equal(k.status, 200, JSON.stringify(k.body));
  if (posMode) {
    const c = await call(app, 'PUT', `/api/a/stores/${store}/config`, { token: admin, body: { paymentSource: 'pos' } });
    assert.equal(c.status, 200, JSON.stringify(c.body));
  }
  return { admin, key: k.body.key };
}
async function lockCart(app, { method = 'pos', items = [['SUA01', 2], ['MI01', 1]], device = DEVICE, store = 'Q7', buyer } = {}) {
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: store }, device });
  const id = s.body.session.id;
  const ops = items.flatMap(([sku, n], i) => Array.from({ length: n }, (_, j) => ({ id: `${sku}-${i}-${j}`, type: 'scan', barcode: barcodeOf(app, store, sku) })));
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops }, device });
  const l = await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method, buyer }, device });
  return { id, lock: l, tx: l.body.transaction, device };
}
const pos = (app, key, method, path, body) => call(app, method, POS + path, { token: key, body });

test('khoá API: bắt buộc, thu hồi được, mỗi khoá giới hạn theo chi nhánh, chi nhánh không tạo được', async () => {
  const app = await makeApp();
  const { admin, key } = await setup(app, { posMode: false });
  assert.equal((await call(app, 'GET', `${POS}/health`)).status, 401);
  assert.equal((await pos(app, 'sai-khoa', 'GET', '/health')).body.error, 'BAD_API_KEY');
  const h = await pos(app, key, 'GET', '/health');
  assert.equal(h.status, 200);
  assert.equal(h.body.storeScope, 'Q7');
  const list = await call(app, 'GET', '/api/a/pos/keys', { token: admin });
  assert.ok(!JSON.stringify(list.body).includes(key), 'danh sách không lộ khoá');
  assert.equal(list.body.keys[0].prefix, key.slice(0, 14));
  const q7 = (await adminLogin(app, 'QT0007')).body.token;
  assert.equal((await call(app, 'POST', '/api/a/pos/keys', { token: q7, body: { name: 'x' } })).status, 403);
  assert.equal((await call(app, 'DELETE', `/api/a/pos/keys/${list.body.keys[0].id}`, { token: admin })).status, 200);
  assert.equal((await pos(app, key, 'GET', '/health')).status, 401);
  await app.close();
});

test('đổi sang thu tiền qua POS cần khoá API và không còn giỏ chờ thu; chi nhánh không tự đổi được', async () => {
  const app = await makeApp();
  const admin = (await adminLogin(app)).body.token;
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7/config', { token: admin, body: { paymentSource: 'pos' } })).body.error, 'NO_POS_KEY');
  await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } });
  const { id } = await lockCart(app, { method: 'cash' });
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7/config', { token: admin, body: { paymentSource: 'pos' } })).body.error, 'CARTS_PENDING');
  await call(app, 'POST', `/api/c/sessions/${id}/unlock`);
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7/config', { token: admin, body: { paymentSource: 'pos' } })).status, 200);
  const q7 = (await adminLogin(app, 'QT0007')).body.token;
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7/config', { token: q7, body: { paymentSource: 'manual' } })).status, 403);
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7/config', { token: q7, body: { guardCheck: false } })).status, 403);
  await app.close();
});

test('chế độ POS: khách chỉ chọn thanh toán tại quầy, thu tiền thủ công bị chặn, kiểm tra hoá đơn công ty', async () => {
  const app = await makeApp();
  await setup(app);
  const view = await call(app, 'GET', '/api/c/store/Q7');
  assert.equal(view.body.paymentSource, 'pos');
  assert.deepEqual([view.body.payment.pos, view.body.payment.cash, view.body.payment.qrTransfer], [true, false, false]);
  assert.equal((await lockCart(app, { method: 'cash' })).lock.status, 400);
  const bad = await lockCart(app, { buyer: { taxCode: '123', companyName: 'A', address: 'B', email: 'a@b.vn' }, device: 'device-bad-mst-0123456789' });
  assert.equal(bad.lock.body.error, 'BAD_TAX_CODE');
  const { tx, id } = await lockCart(app, { buyer: { taxCode: '0312345678', companyName: 'Công ty Ánh Dương', address: 'Quận 7', email: 'kt@congty.vn' }, device: 'device-good-mst-0123456789' });
  assert.equal(tx.method, 'pos');
  assert.equal(tx.buyer.taxCode, '0312345678');
  void id;
  const staff = await staffLogin(app);
  await call(app, 'POST', '/api/s/shifts/start', { token: staff, body: { kind: 'sang' } });
  const c = await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 500000 } });
  assert.equal(c.body.error, 'POS_MODE');
  await app.close();
});

test('POS nhận giỏ: xem trước, nhận, gọi lại cùng mã đơn, mã đơn khác bị từ chối, khách không sửa được giỏ', async () => {
  const app = await makeApp();
  const { key } = await setup(app);
  const { tx, id } = await lockCart(app, { buyer: { email: 'khach@example.com' } });
  assert.equal((await pos(app, key, 'GET', '/carts/GH-Q7-9999')).body.error, 'CART_NOT_FOUND');
  const pre = await pos(app, key, 'GET', `/carts/${tx.code}`);
  assert.equal(pre.body.cart.items.length, 2);
  assert.equal(pre.body.cart.posStatus, null);
  assert.equal(pre.body.cart.buyer.email, 'khach@example.com');
  assert.equal((await pos(app, key, 'POST', `/carts/${tx.code}/claim`, {})).body.error, 'BAD_ORDER_REF');
  const claim = await pos(app, key, 'POST', `/carts/${tx.code}/claim`, { posOrderRef: 'A-20481', cashier: 'thu01', terminal: 'Q1' });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(claim.body.cart.total, 60800); // 2 sữa (69.000 − 13.000 khuyến mãi) + 1 mì 4.800
  assert.equal(claim.body.cart.discount, 13000);
  assert.equal(claim.body.cart.items[0].barcode, barcodeOf(app, 'Q7', 'SUA01'));
  assert.equal((await pos(app, key, 'POST', `/carts/${tx.code}/claim`, { posOrderRef: 'A-20481' })).body.duplicate, true);
  assert.equal((await pos(app, key, 'POST', `/carts/${tx.code}/claim`, { posOrderRef: 'A-99999' })).body.error, 'ALREADY_CLAIMED');
  // khách thấy trạng thái, không sửa/mở khoá được
  const sess = await call(app, 'GET', `/api/c/sessions/${id}`);
  assert.equal(sess.body.session.transaction.posStatus, 'claimed');
  assert.equal((await call(app, 'POST', `/api/c/sessions/${id}/unlock`)).body.error, 'CLAIMED');
  assert.equal((await call(app, 'POST', `/api/c/sessions/${id}/abandon`)).body.error, 'CLAIMED');
  await app.close();
});

test('khoá API theo chi nhánh không nhận được giỏ chi nhánh khác', async () => {
  const app = await makeApp();
  const { admin } = await setup(app);
  const k = await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS TD', storeId: 'TD' } });
  const { tx } = await lockCart(app);
  const r = await pos(app, k.body.key, 'GET', `/carts/${tx.code}`);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'STORE_FORBIDDEN');
  await app.close();
});

test('POS báo đã thanh toán: tự xác nhận, có QR ra cổng, số hoá đơn, báo lại không thu trùng, lệch tiền được ghi', async () => {
  const app = await makeApp();
  const { key, admin } = await setup(app);
  const { tx, id } = await lockCart(app);
  assert.equal((await pos(app, key, 'POST', '/orders/A-1/paid', { amount: 1, method: 'cash' })).body.error, 'ORDER_NOT_FOUND');
  await pos(app, key, 'POST', `/carts/${tx.code}/claim`, { posOrderRef: 'A-1', cashier: 'thu01' });
  assert.equal((await pos(app, key, 'POST', '/orders/A-1/paid', { amount: 'abc', method: 'cash' })).body.error, 'BAD_AMOUNT');
  assert.equal((await pos(app, key, 'POST', '/orders/A-1/paid', { amount: 1000, method: 'bitcoin' })).body.error, 'BAD_METHOD');
  const paid = await pos(app, key, 'POST', '/orders/A-1/paid', { amount: tx.total - 2000, method: 'qr_transfer', invoiceNo: 'HD0001234', cashier: 'thu01' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.amountMatches, false);
  assert.equal(paid.body.guardCheck, true);
  const again = await pos(app, key, 'POST', '/orders/A-1/paid', { amount: tx.total - 2000, method: 'qr_transfer' });
  assert.equal(again.body.duplicate, true);
  assert.equal(app.ctx.db.prepare('SELECT COUNT(*) n FROM payments WHERE transaction_id = ?').get(tx.id).n, 1);
  const sess = (await call(app, 'GET', `/api/c/sessions/${id}`)).body.session;
  assert.equal(sess.transaction.status, 'paid');
  assert.equal(sess.transaction.method, 'qr_transfer');
  assert.equal(sess.transaction.posInvoiceNo, 'HD0001234');
  assert.equal(sess.transaction.invoice.number, 'HD0001234');
  assert.ok(sess.transaction.receipt.token.startsWith('R1.'));
  // doanh thu tính theo số tiền POS
  assert.equal(app.ctx.db.prepare('SELECT amount FROM payments WHERE transaction_id = ?').get(tx.id).amount, tx.total - 2000);
  const orders = await call(app, 'GET', '/api/a/pos/orders?storeId=Q7', { token: admin });
  assert.equal(orders.body.orders[0].differs, true);
  assert.ok(app.ctx.db.prepare(`SELECT 1 FROM audit_events WHERE action='pos.amount_differs'`).get());
  // bảo vệ quét như cũ
  const gate = await staffLogin(app, 'NV0157', '2222');
  assert.equal((await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: sess.transaction.receipt.token } })).body.outcome, 'valid');
  await app.close();
});

test('POS báo huỷ: trước khi thu thì nhả giỏ cho khách; sau khi thu thì huỷ theo POS; báo lại không lỗi', async () => {
  const app = await makeApp();
  const { key } = await setup(app);
  // 1. huỷ trước khi thanh toán
  const a = await lockCart(app);
  await pos(app, key, 'POST', `/carts/${a.tx.code}/claim`, { posOrderRef: 'B-1' });
  const c1 = await pos(app, key, 'POST', '/orders/B-1/cancelled', { reason: 'Khách đổi ý' });
  assert.equal(c1.body.cartReleased, true);
  assert.equal((await pos(app, key, 'POST', '/orders/B-1/cancelled', {})).body.duplicate, true);
  const sess = (await call(app, 'GET', `/api/c/sessions/${a.id}`, { device: a.device })).body.session;
  assert.equal(sess.status, 'active', 'khách sửa được giỏ lại');
  assert.equal((await pos(app, key, 'POST', `/carts/${a.tx.code}/claim`, { posOrderRef: 'B-2' })).body.error, 'NOT_PAYABLE');
  const relock = await call(app, 'POST', `/api/c/sessions/${a.id}/lock`, { body: { method: 'pos' }, device: a.device });
  assert.equal(relock.status, 200);
  assert.notEqual(relock.body.transaction.code, a.tx.code);
  // 2. huỷ sau khi thanh toán, khách chưa ra cổng: QR mất hiệu lực
  const b = await lockCart(app, { device: 'device-second-0123456789' });
  await pos(app, key, 'POST', `/carts/${b.tx.code}/claim`, { posOrderRef: 'C-1' });
  await pos(app, key, 'POST', '/orders/C-1/paid', { amount: b.tx.total, method: 'cash' });
  const token = (await call(app, 'GET', `/api/c/sessions/${b.id}`, { device: b.device })).body.session.transaction.receipt.token;
  const c2 = await pos(app, key, 'POST', '/orders/C-1/cancelled', { reason: 'Hoàn tiền' });
  assert.equal(c2.body.status, 'voided');
  assert.equal(c2.body.alreadyExited, false);
  const gate = await staffLogin(app, 'NV0157', '2222');
  assert.equal((await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: token } })).body.outcome, 'invalid');
  assert.equal(app.ctx.db.prepare('SELECT voided_at FROM payments WHERE transaction_id = ?').get(b.tx.id).voided_at !== null, true);
  await app.close();
});

test('POS huỷ sau khi khách đã ra cổng: ghi nhận, loại khỏi doanh thu, không báo lỗi', async () => {
  const app = await makeApp();
  const { key } = await setup(app);
  const a = await lockCart(app);
  await pos(app, key, 'POST', `/carts/${a.tx.code}/claim`, { posOrderRef: 'D-1' });
  await pos(app, key, 'POST', '/orders/D-1/paid', { amount: a.tx.total, method: 'cash' });
  const token = (await call(app, 'GET', `/api/c/sessions/${a.id}`)).body.session.transaction.receipt.token;
  const gate = await staffLogin(app, 'NV0157', '2222');
  await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: token } });
  const r = await pos(app, key, 'POST', '/orders/D-1/cancelled', { reason: 'Trả hàng' });
  assert.equal(r.body.alreadyExited, true);
  assert.ok(app.ctx.db.prepare(`SELECT 1 FROM audit_events WHERE action='pos.cancel_after_exit'`).get());
  await app.close();
});

test('bỏ bước bảo vệ: không bốc kiểm tra, thu xong khách ra luôn, không có QR, cổng ra bị chặn', async () => {
  const app = await makeApp({ rng: () => 0 }); // bình thường sẽ luôn bị chọn kiểm tra
  const admin = (await adminLogin(app)).body.token;
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7/config', { token: admin, body: { guardCheck: false } })).body.store.config.guardCheck, false);
  assert.equal((await call(app, 'GET', '/api/c/store/Q7')).body.guardCheck, false);
  const { tx, id } = await lockCart(app, { method: 'cash' });
  assert.equal(tx.checkRequired, false, 'không có bảo vệ thì không bốc kiểm tra ngẫu nhiên');
  assert.equal(tx.guardCheck, false);
  const staff = await staffLogin(app);
  await call(app, 'POST', '/api/s/shifts/start', { token: staff, body: { kind: 'sang' } });
  const c = await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 500000 } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const t = (await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction;
  assert.equal(t.exitStatus, 'exited');
  assert.equal(t.receipt, null, 'không hiện mã QR ra cổng');
  const gate = await staffLogin(app, 'NV0157', '2222');
  assert.equal((await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: 'R1.x' } })).body.error, 'GUARD_DISABLED');
  // bật lại: giao dịch sau đó lại có bảo vệ
  await call(app, 'PUT', '/api/a/stores/Q7/config', { token: admin, body: { guardCheck: true } });
  const again = await lockCart(app, { method: 'cash', device: 'device-again-0123456789' });
  assert.equal(again.tx.guardCheck, true);
  assert.equal(again.tx.checkRequired, true);
  await app.close();
});

test('tắt bước bảo vệ: khách đã thanh toán mà chưa ra cổng được coi là đã ra', async () => {
  const app = await makeApp();
  const admin = (await adminLogin(app)).body.token;
  const { tx, id } = await lockCart(app, { method: 'cash' });
  const staff = await staffLogin(app);
  await call(app, 'POST', '/api/s/shifts/start', { token: staff, body: { kind: 'sang' } });
  await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 500000 } });
  assert.notEqual((await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction.exitStatus, 'exited');
  await call(app, 'PUT', '/api/a/stores/Q7/config', { token: admin, body: { guardCheck: false } });
  assert.equal((await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction.exitStatus, 'exited');
  await app.close();
});

test('POS + không có bảo vệ: POS báo thanh toán là khách xong ngay', async () => {
  const app = await makeApp();
  const { key, admin } = await setup(app);
  await call(app, 'PUT', '/api/a/stores/Q7/config', { token: admin, body: { guardCheck: false } });
  const { tx, id } = await lockCart(app);
  await pos(app, key, 'POST', `/carts/${tx.code}/claim`, { posOrderRef: 'E-1' });
  const paid = await pos(app, key, 'POST', '/orders/E-1/paid', { amount: tx.total, method: 'ewallet', invoiceNo: 'HD9' });
  assert.equal(paid.body.exitStatus, 'exited');
  assert.equal(paid.body.guardCheck, false);
  const t = (await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction;
  assert.equal(t.receipt, null);
  assert.equal(t.method, 'ewallet');
  await app.close();
});

test('công cụ giả lập POS trong trang quản trị chạy đủ luồng (không cần khoá API)', async () => {
  const app = await makeApp();
  const { admin } = await setup(app);
  const { tx } = await lockCart(app);
  const sim = (body) => call(app, 'POST', '/api/a/dev/pos-simulate', { token: admin, body });
  assert.equal((await sim({ action: 'claim', code: tx.code, ref: 'S-1' })).body.claimed, true);
  assert.equal((await sim({ action: 'paid', ref: 'S-1', amount: tx.total, method: 'cash', invoiceNo: 'HD1' })).body.ok, true);
  assert.equal((await sim({ action: 'status', ref: 'S-1' })).body.status, 'paid');
  assert.equal((await sim({ action: 'xyz' })).status, 400);
  await app.close();
});

test('quản lý nhả giỏ khi POS nhận rồi không báo kết quả; POS báo thanh toán muộn bị từ chối', async () => {
  const app = await makeApp();
  const { key, admin } = await setup(app);
  const { tx, id } = await lockCart(app);
  assert.equal((await call(app, 'POST', `/api/a/pos/orders/${tx.id}/release`, { token: admin, body: { reason: 'x' } })).body.error, 'NOT_CLAIMED');
  await pos(app, key, 'POST', `/carts/${tx.code}/claim`, { posOrderRef: 'R-1' });
  assert.equal((await call(app, 'POST', `/api/a/pos/orders/${tx.id}/release`, { token: admin, body: {} })).body.error, 'REASON_REQUIRED');
  assert.equal((await call(app, 'POST', `/api/a/pos/orders/${tx.id}/release`, { token: admin, body: { reason: 'POS sập' } })).status, 200);
  assert.equal((await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.status, 'active');
  assert.equal((await pos(app, key, 'POST', '/orders/R-1/paid', { amount: tx.total, method: 'cash' })).body.error, 'ORDER_CANCELLED');
  await app.close();
});

test('lịch ca không cảnh báo thiếu cổng ra khi tắt bảo vệ, không cảnh báo thiếu thu ngân khi dùng POS', async () => {
  const app = await makeApp();
  const chain = (await adminLogin(app)).body.token;
  const q7 = (await adminLogin(app, 'QT0007')).body.token;
  const has = async (m) => (await call(app, 'GET', '/api/a/plans', { token: q7 })).body.warnings.some((w) => w.missing === m);
  app.ctx.db.prepare('DELETE FROM shift_plans').run();
  assert.equal(await has('gate'), true);
  await call(app, 'PUT', '/api/a/stores/Q7/config', { token: chain, body: { guardCheck: false } });
  assert.equal(await has('gate'), false);
  assert.equal(await has('cashier'), true);
  await call(app, 'POST', '/api/a/pos/keys', { token: chain, body: { name: 'POS' } });
  await call(app, 'PUT', '/api/a/stores/Q7/config', { token: chain, body: { paymentSource: 'pos' } });
  assert.equal(await has('cashier'), false);
  await app.close();
});

test('DELETE không thân gửi từ trình duyệt không bị từ chối (không gửi Content-Type khi không có thân)', async () => {
  const app = await makeApp();
  const { admin } = await setup(app, { posMode: false });
  const id = (await call(app, 'GET', '/api/a/pos/keys', { token: admin })).body.keys[0].id;
  const r = await app.inject({ method: 'DELETE', url: `/api/a/pos/keys/${id}`, headers: { authorization: `Bearer ${admin}` } });
  assert.equal(r.statusCode, 200);
  await app.close();
});

test('giỏ QR: khoá giỏ không hỏi cách trả, QR chứa mã vạch và số lượng, gửi lại cùng mã giỏ thì trả kết quả cũ', async () => {
  const { decodeBasket } = await import('../public/shared/basket.js');
  const app = await makeApp({ basket: true });
  const chain = (await adminLogin(app)).body.token;
  await call(app, 'PUT', '/api/a/stores/Q7', { token: chain, body: { posCode: 'SP-0107' } });
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const id = s.body.session.id;
  const bc = (sku) => barcodeOf(app, 'Q7', sku);
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [
    { id: 'a', type: 'scan', barcode: bc('SUA01') }, { id: 'b', type: 'scan', barcode: bc('SUA01') }, { id: 'c', type: 'scan', barcode: bc('MI01') }] } });
  // luồng cũ bị khoá
  assert.equal((await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash' } })).status, 409);
  const r = await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: 'Q7-LM3K2AB' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const q = decodeBasket(r.body.transaction.basketQr);
  assert.equal(q.ok, true);
  assert.equal(q.point, 'SP-0107');
  assert.equal(q.ref, 'Q7-LM3K2AB');
  assert.deepEqual(q.items, [{ barcode: bc('SUA01'), qty: 2 }, { barcode: bc('MI01'), qty: 1 }]);
  assert.equal(q.total, r.body.transaction.total);
  const again = await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: 'Q7-LM3K2AB' } });
  assert.equal(again.body.transaction.id, r.body.transaction.id);
  // người khác không dùng lại được mã giỏ
  const s2 = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' }, device: 'other-1234567890abcdef' });
  await call(app, 'POST', `/api/c/sessions/${s2.body.session.id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: bc('MI01') }] }, device: 'other-1234567890abcdef' });
  assert.equal((await call(app, 'POST', `/api/c/sessions/${s2.body.session.id}/basket`, { body: { ref: 'Q7-LM3K2AB' }, device: 'other-1234567890abcdef' })).status, 409);
  // POS (nếu có) vẫn nhận giỏ theo mã giỏ và báo thanh toán; khách bấm xong trước hay sau đều được
  const fin = await call(app, 'POST', `/api/c/sessions/${id}/finish`);
  assert.equal(fin.status, 200);
  assert.equal(app.ctx.db.prepare('SELECT status FROM transactions WHERE id=?').get(r.body.transaction.id).status, 'handed_off');
  await app.close();
});

test('mã QR giỏ: sai chữ ký hoặc sai định dạng thì từ chối', async () => {
  const { encodeBasket, decodeBasket } = await import('../public/shared/basket.js');
  const t = encodeBasket({ point: 'Q7', ref: 'Q7-ABCDEFGH', at: 1700000000000, items: [{ barcode: '8936036123456', qty: 2 }, { barcode: '8936036123456', qty: 1 }], total: 90000 });
  assert.deepEqual(decodeBasket(t).items, [{ barcode: '8936036123456', qty: 3 }]);
  assert.equal(decodeBasket(t.replace('*3', '*9')).error, 'CRC');
  assert.equal(decodeBasket('hello').error, 'FORMAT');
});

test('giỏ QR: POS báo thanh toán theo mã giỏ kèm bill thật; báo lại nhiều lần an toàn; khách xem bill và tải PDF', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const id = s.body.session.id;
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [
    { id: 'a', type: 'scan', barcode: barcodeOf(app, 'Q7', 'SUA01') }, { id: 'b', type: 'scan', barcode: barcodeOf(app, 'Q7', 'MI01') }] } });
  const code = 'Q7-ABCDEF2K';
  // chưa đồng bộ giỏ: POS nhận 404 và thử lại sau
  const early = await pos(app, key, 'POST', `/baskets/${code}/paid`, { posOrderRef: 'POS-1', amount: 1000, method: 'cash' });
  assert.equal(early.status, 404);
  assert.equal(early.body.error, 'BASKET_NOT_FOUND');
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: code } })).body.transaction;
  const body = { posOrderRef: 'POS-1', amount: tx.total - 2000, method: 'qr_transfer', invoiceNo: 'C26TAA-123', cashier: 'Lan',
    invoiceUrl: 'https://hddt.example.vn/tra-cuu/abc',
    lines: [{ barcode: '1', name: 'Sữa tươi 1L', qty: 1, unitPrice: 29000, discount: 0, lineTotal: 29000 }, { name: 'Mì tôm', qty: 1, unitPrice: 4800, discount: 2000, lineTotal: 2800 }] };
  // dữ liệu sai bị từ chối
  assert.equal((await pos(app, key, 'POST', `/baskets/${code}/paid`, { ...body, lines: [{ name: '', qty: 1 }] })).status, 400);
  assert.equal((await pos(app, key, 'POST', `/baskets/${code}/paid`, { ...body, posOrderRef: undefined })).status, 400);
  assert.equal((await pos(app, key, 'POST', `/baskets/${code}/paid`, { ...body, invoiceUrl: 'http://x' })).status, 400);
  const ok = await pos(app, key, 'POST', `/baskets/${code}/paid`, body);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.duplicate, false);
  // POS thử lại (ví dụ không nhận được phản hồi): không thu hai lần
  const retry = await pos(app, key, 'POST', `/baskets/${code}/paid`, body);
  assert.equal(retry.body.duplicate, true);
  assert.equal(app.ctx.db.prepare('SELECT COUNT(*) n FROM payments').get().n, 1);
  // đơn POS khác cho cùng giỏ: từ chối
  assert.equal((await pos(app, key, 'POST', `/baskets/${code}/paid`, { ...body, posOrderRef: 'POS-2' })).status, 409);
  const st = await pos(app, key, 'GET', `/baskets/${code}`);
  assert.equal(st.body.status, 'paid'); assert.equal(st.body.billStored, true);
  // khách thấy hoàn tất, xem bill thật
  const sv = await call(app, 'GET', `/api/c/sessions/${id}`);
  assert.equal(sv.body.session.transaction.status, 'paid');
  assert.equal(sv.body.session.transaction.bill.source, 'pos');
  const bill = (await call(app, 'GET', `/api/c/transactions/${tx.id}/bill`)).body.bill;
  assert.equal(bill.provisional, false);
  assert.equal(bill.total, tx.total - 2000);
  assert.equal(bill.invoiceNo, 'C26TAA-123');
  assert.equal(bill.lines.length, 2);
  const pdf = await app.inject({ method: 'GET', url: `/api/c/transactions/${tx.id}/bill.pdf`, headers: { 'x-device-id': DEVICE } });
  assert.equal(pdf.statusCode, 200);
  assert.match(pdf.headers['content-type'], /pdf/);
  assert.equal(pdf.rawPayload.subarray(0, 4).toString(), '%PDF');
  // chỉ chủ giỏ xem được
  assert.equal((await call(app, 'GET', `/api/c/transactions/${tx.id}/bill`, { device: 'stranger-1234567890abcdef' })).status, 404);
  // mở thẳng đường dẫn PDF bằng cookie thiết bị (không có header)
  const viaCookie = await app.inject({ method: 'GET', url: `/api/c/transactions/${tx.id}/bill.pdf`, headers: { cookie: `brgd=${DEVICE}` } });
  assert.equal(viaCookie.statusCode, 200);
  await app.close();
});

test('giỏ QR: POS chưa gửi bill thì bill là tạm tính; gửi bổ sung ở lần báo lại thì thành bill thật', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  await call(app, 'POST', `/api/c/sessions/${s.body.session.id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: barcodeOf(app, 'Q7', 'SUA01') }] } });
  const tx = (await call(app, 'POST', `/api/c/sessions/${s.body.session.id}/basket`, { body: { ref: 'Q7-ZZZZ2345' } })).body.transaction;
  await pos(app, key, 'POST', `/baskets/Q7-ZZZZ2345/paid`, { posOrderRef: 'P9', amount: tx.total, method: 'cash' });
  assert.equal((await call(app, 'GET', `/api/c/transactions/${tx.id}/bill`)).body.bill.provisional, true);
  await pos(app, key, 'POST', `/baskets/Q7-ZZZZ2345/paid`, { posOrderRef: 'P9', amount: tx.total, method: 'cash', lines: [{ name: 'Sữa tươi 1L', qty: 1, unitPrice: tx.total, discount: 0, lineTotal: tx.total }] });
  assert.equal((await call(app, 'GET', `/api/c/transactions/${tx.id}/bill`)).body.bill.provisional, false);
  await app.close();
});
