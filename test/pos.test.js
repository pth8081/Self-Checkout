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

test('khóa API: bắt buộc, thu hồi được, mỗi khóa giới hạn theo chi nhánh, chi nhánh không tạo được', async () => {
  const app = await makeApp();
  const { admin, key } = await setup(app, { posMode: false });
  assert.equal((await call(app, 'GET', `${POS}/health`)).status, 401);
  // chuẩn dùng trong tài liệu: header X-Api-Key (Authorization: Bearer vẫn nhận để tương thích)
  const viaHeader = await app.inject({ method: 'GET', url: `${POS}/health`, headers: { 'x-api-key': key } });
  assert.equal(viaHeader.statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: `${POS}/health`, headers: { 'x-api-key': 'sai-khoa' } })).statusCode, 401);
  assert.equal((await pos(app, 'sai-khoa', 'GET', '/health')).body.error, 'BAD_API_KEY');
  const h = await pos(app, key, 'GET', '/health');
  assert.equal(h.status, 200);
  assert.equal(h.body.storeScope, 'Q7');
  const list = await call(app, 'GET', '/api/a/pos/keys', { token: admin });
  assert.ok(!JSON.stringify(list.body).includes(key), 'danh sách không lộ khóa');
  assert.equal(list.body.keys[0].prefix, key.slice(0, 14));
  const q7 = (await adminLogin(app, 'QT0007')).body.token;
  assert.equal((await call(app, 'POST', '/api/a/pos/keys', { token: q7, body: { name: 'x' } })).status, 403);
  assert.equal((await call(app, 'DELETE', `/api/a/pos/keys/${list.body.keys[0].id}`, { token: admin })).status, 200);
  assert.equal((await pos(app, key, 'GET', '/health')).status, 401);
  await app.close();
});

test('đổi sang thu tiền qua POS cần khóa API và không còn giỏ chờ thu; chi nhánh không tự đổi được', async () => {
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

test('chế độ POS: khách chỉ chọn thanh toán tại quầy, thu tiền thủ công bị chặn, kiểm tra hóa đơn công ty', async () => {
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
  // khách thấy trạng thái, không sửa/mở khóa được
  const sess = await call(app, 'GET', `/api/c/sessions/${id}`);
  assert.equal(sess.body.session.transaction.posStatus, 'claimed');
  assert.equal((await call(app, 'POST', `/api/c/sessions/${id}/unlock`)).body.error, 'CLAIMED');
  assert.equal((await call(app, 'POST', `/api/c/sessions/${id}/abandon`)).body.error, 'CLAIMED');
  await app.close();
});

test('khóa API theo chi nhánh không nhận được giỏ chi nhánh khác', async () => {
  const app = await makeApp();
  const { admin } = await setup(app);
  const k = await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS TD', storeId: 'TD' } });
  const { tx } = await lockCart(app);
  const r = await pos(app, k.body.key, 'GET', `/carts/${tx.code}`);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'STORE_FORBIDDEN');
  await app.close();
});

test('POS báo đã thanh toán: tự xác nhận, có QR ra cổng, số hóa đơn, báo lại không thu trùng, lệch tiền được ghi', async () => {
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

test('POS báo hủy: trước khi thu thì nhả giỏ cho khách; sau khi thu thì hủy theo POS; báo lại không lỗi', async () => {
  const app = await makeApp();
  const { key } = await setup(app);
  // 1. hủy trước khi thanh toán
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
  // 2. hủy sau khi thanh toán, khách chưa ra cổng: QR mất hiệu lực
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

test('POS hủy sau khi khách đã ra cổng: ghi nhận, loại khỏi doanh thu, không báo lỗi', async () => {
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

test('công cụ giả lập POS trong trang quản trị chạy đủ luồng (không cần khóa API)', async () => {
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

test('giỏ QR: khóa giỏ không hỏi cách trả, QR chứa mã vạch và số lượng, gửi lại cùng mã giỏ thì trả kết quả cũ', async () => {
  const { decodeBasket } = await import('../public/shared/basket.js');
  const app = await makeApp({ basket: true });
  const chain = (await adminLogin(app)).body.token;
  await call(app, 'PUT', '/api/a/stores/Q7', { token: chain, body: { posCode: 'SP-0107' } });
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const id = s.body.session.id;
  const bc = (sku) => barcodeOf(app, 'Q7', sku);
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [
    { id: 'a', type: 'scan', barcode: bc('SUA01') }, { id: 'b', type: 'scan', barcode: bc('SUA01') }, { id: 'c', type: 'scan', barcode: bc('MI01') }] } });
  // luồng cũ bị khóa
  assert.equal((await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash' } })).status, 409);
  const r = await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: 'Q7-LM3K2AB' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // QR chuẩn là dạng ngắn: chỉ mã điểm và mã giỏ
  const q = decodeBasket(r.body.transaction.basketQr);
  assert.equal(q.ok, true);
  assert.equal(q.point, 'SP-0107'); assert.equal(q.ref, 'Q7-LM3K2AB');
  assert.ok(r.body.transaction.basketQr.length < 60);
  assert.ok(!r.body.transaction.basketQr.includes(bc('SUA01')));
  // Dsmart POS lấy danh sách hàng qua API theo mã giỏ, bắt buộc kèm mã điểm
  const chainKey = (await call(app, 'POST', '/api/a/pos/keys', { token: chain, body: { name: 'POS' } })).body.key;
  const g = await pos(app, chainKey, 'GET', `/baskets/${q.ref}?pointCode=SP-0107`);
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.status, 'awaiting_counter'); assert.equal(g.body.pointCode, 'SP-0107');
  assert.deepEqual(g.body.items.map((i) => [i.barcode, i.qty]), [[bc('SUA01'), 2], [bc('MI01'), 1]]);
  assert.equal(g.body.itemCount, 3); assert.equal(g.body.total, r.body.transaction.total);
  assert.equal((await pos(app, chainKey, 'GET', `/baskets/${q.ref}`)).body.error, 'POINT_REQUIRED');
  assert.equal((await pos(app, chainKey, 'GET', `/baskets/${q.ref}?pointCode=SP-9999`)).body.error, 'POINT_MISMATCH');
  assert.equal((await pos(app, chainKey, 'GET', `/baskets/Q7-KHONGCO23?pointCode=SP-0107`)).body.error, 'BASKET_NOT_FOUND');
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

test('mã QR giỏ: chỉ có mã điểm và mã giỏ, sai chữ ký hoặc sai định dạng thì từ chối', async () => {
  const { encodeBasketShort, decodeBasket } = await import('../public/shared/basket.js');
  const sh = encodeBasketShort({ point: 'SP-0107', ref: 'Q7-ABCDEFGH', at: 1700000000000 });
  assert.match(sh, /^BRG2\|SP-0107\|Q7-ABCDEFGH\|1700000000\|[0-9A-F]{4}$/);
  assert.deepEqual({ ...decodeBasket(sh) }, { ok: true, point: 'SP-0107', ref: 'Q7-ABCDEFGH', at: 1700000000000 });
  assert.equal(decodeBasket(sh.replace('Q7-', 'Q8-')).error, 'CRC');
  assert.equal(decodeBasket('hello').error, 'FORMAT');
  // dạng cũ có danh sách mặt hàng (BRG1) không còn dùng
  assert.equal(decodeBasket('BRG1|SP-0107|Q7-LM3K2AB|1793845800|8936036123456*2|T1000|0000').ok, false);
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
  const early = await pos(app, key, 'POST', `/baskets/${code}/paid`, { posOrderRef: 'POS-1', pointCode: 'SP-Q7', amount: 1000, method: 'cash' });
  assert.equal(early.status, 404);
  assert.equal(early.body.error, 'BASKET_NOT_FOUND');
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: code } })).body.transaction;
  const body = { posOrderRef: 'POS-1', pointCode: 'SP-Q7', amount: tx.total - 2000, method: 'qr_transfer', cashier: 'Lan',
    lines: [{ barcode: '1', name: 'Sữa tươi 1L', qty: 1, unitPrice: 29000, discount: 0, lineTotal: 29000 }, { name: 'Mì tôm', qty: 1, unitPrice: 4800, discount: 2000, lineTotal: 2800 }] };
  // dữ liệu sai bị từ chối
  assert.equal((await pos(app, key, 'POST', `/baskets/${code}/paid`, { ...body, lines: [{ name: '', qty: 1 }] })).status, 400);
  assert.equal((await pos(app, key, 'POST', `/baskets/${code}/paid`, { ...body, posOrderRef: undefined })).status, 400);
  const ok = await pos(app, key, 'POST', `/baskets/${code}/paid`, body);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.duplicate, false);
  // POS thử lại (ví dụ không nhận được phản hồi): không thu hai lần
  const retry = await pos(app, key, 'POST', `/baskets/${code}/paid`, body);
  assert.equal(retry.body.duplicate, true);
  assert.equal(app.ctx.db.prepare('SELECT COUNT(*) n FROM payments').get().n, 1);
  // đơn POS khác cho cùng giỏ: từ chối
  assert.equal((await pos(app, key, 'POST', `/baskets/${code}/paid`, { ...body, posOrderRef: 'POS-2' })).status, 409);
  const st = await pos(app, key, 'GET', `/baskets/${code}?pointCode=SP-Q7`);
  assert.equal(st.body.status, 'paid'); assert.equal(st.body.billStored, true);
  // khách thấy hoàn tất, xem bill thật
  const sv = await call(app, 'GET', `/api/c/sessions/${id}`);
  assert.equal(sv.body.session.transaction.status, 'paid');
  assert.equal(sv.body.session.transaction.bill.source, 'pos');
  const bill = (await call(app, 'GET', `/api/c/transactions/${tx.id}/bill`)).body.bill;
  assert.equal(bill.provisional, false);
  assert.equal(bill.total, tx.total - 2000);
  assert.equal(bill.posOrderRef, 'POS-1');
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
  await pos(app, key, 'POST', `/baskets/Q7-ZZZZ2345/paid`, { posOrderRef: 'P9', pointCode: 'SP-Q7', amount: tx.total, method: 'cash' });
  assert.equal((await call(app, 'GET', `/api/c/transactions/${tx.id}/bill`)).body.bill.provisional, true);
  await pos(app, key, 'POST', `/baskets/Q7-ZZZZ2345/paid`, { posOrderRef: 'P9', pointCode: 'SP-Q7', amount: tx.total, method: 'cash', lines: [{ name: 'Sữa tươi 1L', qty: 1, unitPrice: tx.total, discount: 0, lineTotal: tx.total }] });
  assert.equal((await call(app, 'GET', `/api/c/transactions/${tx.id}/bill`)).body.bill.provisional, false);
  await app.close();
});

test('mã điểm là khóa: POS gửi sai hoặc thiếu mã điểm thì bị từ chối, không ghi thanh toán; cửa hàng chưa có mã điểm thì không tạo được giỏ QR', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  await call(app, 'POST', `/api/c/sessions/${s.body.session.id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: barcodeOf(app, 'Q7', 'SUA01') }] } });
  const tx = (await call(app, 'POST', `/api/c/sessions/${s.body.session.id}/basket`, { body: { ref: 'Q7-POINT234' } })).body.transaction;
  const base = { posOrderRef: 'P1', amount: tx.total, method: 'cash' };
  const missing = await pos(app, key, 'POST', '/baskets/Q7-POINT234/paid', base);
  assert.equal(missing.status, 400); assert.equal(missing.body.error, 'POINT_REQUIRED');
  const wrong = await pos(app, key, 'POST', '/baskets/Q7-POINT234/paid', { ...base, pointCode: 'SP-Q1' });
  assert.equal(wrong.status, 409); assert.equal(wrong.body.error, 'POINT_MISMATCH');
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-POINT234/cancelled', { posOrderRef: 'P1', pointCode: 'SP-Q1' })).status, 409);
  assert.equal(app.ctx.db.prepare('SELECT COUNT(*) n FROM payments').get().n, 0);
  assert.equal(app.ctx.db.prepare('SELECT status FROM transactions WHERE id=?').get(tx.id).status, 'awaiting_counter');
  // đúng mã điểm (không phân biệt hoa thường) thì nhận
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-POINT234/paid', { ...base, pointCode: 'sp-q7' })).status, 200);
  // cửa hàng chưa có mã điểm: không tạo được giỏ QR
  app.ctx.db.prepare(`UPDATE stores SET pos_code = '' WHERE id = 'Q7'`).run();
  const s2 = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' }, device: 'other-1234567890abcdef' });
  await call(app, 'POST', `/api/c/sessions/${s2.body.session.id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: barcodeOf(app, 'Q7', 'MI01') }] }, device: 'other-1234567890abcdef' });
  const nope = await call(app, 'POST', `/api/c/sessions/${s2.body.session.id}/basket`, { body: { ref: 'Q7-NOPOINT23' }, device: 'other-1234567890abcdef' });
  assert.equal(nope.status, 409); assert.equal(nope.body.error, 'NO_POS_CODE');
  // không bật được chi nhánh khi chưa có mã điểm; không xóa được mã điểm khi đang bật
  app.ctx.db.prepare(`UPDATE stores SET enabled = 0 WHERE id = 'Q7'`).run();
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7', { token: admin, body: { enabled: true } })).body.error, 'NO_POS_CODE');
  await app.close();
});

// ---- Email: cấu hình SMTP, mã xác nhận, gửi bill ----
function fakeMail({ fail = 0 } = {}) {
  const sent = []; let calls = 0;
  return { sent, opts: { transportFactory: () => ({ sendMail: async (m) => { calls++; if (calls <= fail) throw new Error('SMTP từ chối'); sent.push(m); return { messageId: 'x' }; } }) } };
}
async function configureMail(app, admin) {
  return call(app, 'PUT', '/api/a/integrations/email', { token: admin, body: { host: 'smtp.congty.vn', port: 587, secure: 'starttls', user: 'bot@congty.vn', pass: 'Mật-khẩu-bí-mật', from: 'no-reply@congty.vn', fromName: 'BRG Scan & Checkout' } });
}

test('email: quản trị cấu hình SMTP, mật khẩu không bao giờ trả lại và được mã hóa trong CSDL; chỉ quản trị chuỗi; gửi thử', async () => {
  const { createMailer } = await import('../server/services/mailer.js');
  const fm = fakeMail();
  const app = await makeApp({ basket: true, mailer: undefined });
  app.ctx.mailer = createMailer(app.ctx.db, fm.opts);
  const admin = (await adminLogin(app)).body.token;
  const q7 = (await adminLogin(app, 'QT0007')).body.token;
  assert.equal((await call(app, 'GET', '/api/a/integrations/email', { token: admin })).body.email.configured, false);
  assert.equal((await call(app, 'PUT', '/api/a/integrations/email', { token: q7, body: { host: 'x.com' } })).status, 403);
  assert.equal((await call(app, 'PUT', '/api/a/integrations/email', { token: admin, body: { host: 'smtp.congty.vn', port: 99999 } })).status, 400);
  const saved = await configureMail(app, admin);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.email.configured, true);
  assert.equal(saved.body.email.hasPassword, true);
  assert.ok(!JSON.stringify(saved.body).includes('bí-mật'));
  assert.ok(!JSON.stringify((await call(app, 'GET', '/api/a/integrations/email', { token: admin })).body).includes('bí-mật'));
  const raw = app.ctx.db.prepare(`SELECT value FROM settings WHERE key='email'`).get().value;
  assert.ok(!raw.includes('bí-mật'));
  // sửa host mà không gửi mật khẩu thì giữ mật khẩu cũ
  const again = await call(app, 'PUT', '/api/a/integrations/email', { token: admin, body: { host: 'smtp2.congty.vn' } });
  assert.equal(again.body.email.hasPassword, true);
  assert.equal((await call(app, 'POST', '/api/a/integrations/email/test', { token: admin, body: { to: 'khong-hop-le' } })).status, 400);
  assert.equal((await call(app, 'POST', '/api/a/integrations/email/test', { token: admin, body: { to: 'it@congty.vn' } })).status, 200);
  assert.equal(fm.sent.length, 1);
  assert.equal(fm.sent[0].to, 'it@congty.vn');
  await app.close();
});

test('email: mã xác nhận gửi qua email khi đã cấu hình (không trả mã về trình duyệt); chưa cấu hình ở production thì báo rõ', async () => {
  const { createMailer } = await import('../server/services/mailer.js');
  const fm = fakeMail();
  const app = await makeApp();
  app.ctx.mailer = createMailer(app.ctx.db, fm.opts);
  const admin = (await adminLogin(app)).body.token;
  // chưa cấu hình, môi trường thử: trả mã để thử
  assert.ok((await call(app, 'POST', '/api/c/identity/request', { body: { email: 'khach@example.com' } })).body.devCode);
  await configureMail(app, admin);
  const r = await call(app, 'POST', '/api/c/identity/request', { body: { email: 'khach2@example.com' }, device: 'other-1234567890abcdef' });
  assert.equal(r.status, 200); assert.equal(r.body.devCode, undefined);
  assert.equal(fm.sent.length, 1);
  assert.match(fm.sent[0].text, /\b\d{6}\b/);
  const code = /\b(\d{6})\b/.exec(fm.sent[0].text)[1];
  const v = await call(app, 'POST', '/api/c/identity/verify', { body: { email: 'khach2@example.com', code }, device: 'other-1234567890abcdef' });
  assert.equal(v.body.linked, true);
  await app.close();
});

test('email: bill gửi về email khách khi POS báo thanh toán (kèm PDF và link); lỗi thì thử lại, không gửi trùng; link xem bill không cần đăng nhập', async () => {
  const { createMailer } = await import('../server/services/mailer.js');
  const { retryBillEmails } = await import('../server/services/bill-email.js');
  const { config } = await import('../server/config.js');
  config.publicUrl = 'https://scan.congty.vn';
  const fm = fakeMail({ fail: 1 });
  const app = await makeApp({ basket: true });
  app.ctx.mailer = createMailer(app.ctx.db, fm.opts);
  const admin = (await adminLogin(app)).body.token;
  await configureMail(app, admin);
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const id = s.body.session.id;
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: barcodeOf(app, 'Q7', 'SUA01') }] } });
  assert.equal((await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: 'Q7-MAIL2345', email: 'sai-email' } })).status, 400);
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: 'Q7-MAIL2345', email: 'Khach@Example.com' } })).body.transaction;
  assert.equal(tx.billEmail, 'k***@example.com');
  // POS báo thanh toán: gửi lần 1 lỗi (SMTP từ chối)
  const body = { pointCode: 'SP-Q7', posOrderRef: 'P-MAIL', amount: tx.total, method: 'cash' };
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-MAIL2345/paid', body)).status, 200);
  await Promise.all([...app.ctx.bg]);
  assert.equal(fm.sent.length, 0);
  assert.equal(app.ctx.db.prepare('SELECT bill_email_status s FROM transactions WHERE id=?').get(tx.id).s, 'failed');
  // thử lại: gửi được, kèm PDF và link
  await retryBillEmails(app.ctx);
  assert.equal(fm.sent.length, 1);
  const m = fm.sent[0];
  assert.equal(m.to, 'khach@example.com');
  assert.equal(m.attachments[0].content.subarray(0, 4).toString(), '%PDF');
  const link = /https:\/\/scan\.congty\.vn\/c\/#\/bill-link\/(B1\.[A-Za-z0-9._-]+)/.exec(m.text);
  assert.ok(link);
  // thử lại lần nữa và POS báo trùng: không gửi thêm
  await retryBillEmails(app.ctx);
  await pos(app, key, 'POST', '/baskets/Q7-MAIL2345/paid', body);
  await Promise.all([...app.ctx.bg]);
  assert.equal(fm.sent.length, 1);
  // link xem bill không cần mã thiết bị; sai chữ ký thì 404
  const pub = await app.inject({ method: 'GET', url: `/api/c/bill/${link[1]}` });
  assert.equal(pub.statusCode, 200);
  assert.equal(JSON.parse(pub.body).bill.posOrderRef, 'P-MAIL');
  assert.equal((await app.inject({ method: 'GET', url: `/api/c/bill/${link[1].slice(0, -2)}xx` })).statusCode, 404);
  const pdf = await app.inject({ method: 'GET', url: `/api/c/bill/${link[1]}/pdf` });
  assert.equal(pdf.statusCode, 200); assert.equal(pdf.rawPayload.subarray(0, 4).toString(), '%PDF');
  // khách thêm email sau khi đã thanh toán: gửi ngay
  const r = await call(app, 'POST', `/api/c/transactions/${tx.id}/bill-email`, { body: { email: 'khac@example.com' } });
  assert.equal(r.body.status, 'sending');
  await Promise.all([...app.ctx.bg]);
  assert.equal(fm.sent.length, 2); assert.equal(fm.sent[1].to, 'khac@example.com');
  config.publicUrl = '';
  await app.close();
});

test('email: máy chủ SMTP dùng chứng chỉ tự ký trên cổng SSL/TLS: kiểm tra mặc định bị từ chối, nạp chứng chỉ thì gửi được, có thể bỏ qua kiểm tra; sai tên thì có gợi ý', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path'); const tls = await import('node:tls');
  const { createMailer, saveSettings, explainMailError } = await import('../server/services/mailer.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-cert-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/k.pem`, '-out', `${dir}/c.pem`, '-days', '2', '-subj', '/CN=mail.internal', '-addext', 'subjectAltName=DNS:mail.internal'], { stdio: 'ignore' });
  } catch { t.skip('Không có openssl để tạo chứng chỉ thử'); return; }
  const key = fs.readFileSync(`${dir}/k.pem`), cert = fs.readFileSync(`${dir}/c.pem`, 'utf8');
  const got = [];
  const server = tls.createServer({ key, cert }, (sock) => {
    let data = false, buf = ''; sock.write('220 mail.internal ESMTP\r\n');
    sock.on('data', (d) => { buf += d.toString('utf8');
      if (data) { if (buf.includes('\r\n.\r\n')) { got.push(buf); buf = ''; data = false; sock.write('250 OK\r\n'); } return; }
      let i; while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^EHLO|^HELO/i.test(l)) sock.write('250-mail.internal\r\n250 8BITMIME\r\n');
        else if (/^DATA/i.test(l)) { sock.write('354 go\r\n'); data = true; break; }
        else if (/^QUIT/i.test(l)) { sock.write('221 bye\r\n'); sock.end(); } else sock.write('250 OK\r\n'); } });
    sock.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const app = await makeApp();
  const mailer = createMailer(app.ctx.db);
  const base = { host: '127.0.0.1', port, secure: 'ssl', from: 'no-reply@congty.vn' };
  const msg = { to: 'a@b.vn', subject: 'thử', text: 'xin chào' };
  try {
    // 1. kiểm tra mặc định: chứng chỉ tự ký bị từ chối, thông báo hướng dẫn nạp chứng chỉ
    saveSettings(app.ctx.db, { ...base, tlsMode: 'verify' });
    const err1 = await mailer.send(msg).then(() => null, (e) => e);
    assert.ok(err1); assert.match(explainMailError(err1), /tự ký|CA nội bộ|tên hoặc địa chỉ/);
    // 2. nạp chứng chỉ: tên máy chủ trong chứng chỉ (mail.internal) khác địa chỉ kết nối (127.0.0.1) nên cần điền tên
    saveSettings(app.ctx.db, { tlsMode: 'ca', caPem: cert });
    const err2 = await mailer.send(msg).then(() => null, (e) => e);
    assert.ok(err2); assert.match(explainMailError(err2), /khớp|tên/);
    saveSettings(app.ctx.db, { servername: 'mail.internal' });
    await mailer.send(msg);
    assert.equal(got.length, 1);
    // 3. bỏ qua kiểm tra (kém an toàn) cũng gửi được
    saveSettings(app.ctx.db, { tlsMode: 'insecure', servername: '' });
    await mailer.send(msg);
    assert.equal(got.length, 2);
    // dữ liệu nhập sai bị từ chối
    assert.throws(() => saveSettings(app.ctx.db, { tlsMode: 'ca', caPem: 'không phải chứng chỉ' }), (e) => e.code === 'BAD_CA');
    assert.throws(() => saveSettings(app.ctx.db, { tlsMode: 'abc' }), (e) => e.code === 'BAD_TLS');
    app.ctx.db.prepare(`DELETE FROM settings WHERE key='email'`).run();
    assert.throws(() => saveSettings(app.ctx.db, { ...base, tlsMode: 'ca' }), (e) => e.code === 'CA_REQUIRED');
  } finally { server.close(); await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('email: quản trị lưu chứng chỉ qua API, xem được vân tay và hạn dùng, chứng chỉ không bị lộ nội dung mật khẩu', async () => {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-cert2-'));
  let pem;
  try { execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/k.pem`, '-out', `${dir}/c.pem`, '-days', '30', '-subj', '/CN=mail.internal'], { stdio: 'ignore' }); pem = fs.readFileSync(`${dir}/c.pem`, 'utf8'); }
  catch { return; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const app = await makeApp();
  const admin = (await adminLogin(app)).body.token;
  const put = (body) => call(app, 'PUT', '/api/a/integrations/email', { token: admin, body });
  assert.equal((await put({ host: 'mail.internal', port: 465, secure: 'ssl', from: 'a@b.vn', tlsMode: 'ca' })).status, 400); // thiếu chứng chỉ
  const ok = await put({ host: 'mail.internal', port: 465, secure: 'ssl', from: 'a@b.vn', tlsMode: 'ca', caPem: pem, pass: 'bí-mật' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.email.tlsMode, 'ca'); assert.equal(ok.body.email.hasCa, true);
  assert.match(ok.body.email.ca.fingerprint, /^[0-9A-F:]{95}$/);
  assert.equal(ok.body.email.ca.selfSigned, true);
  assert.ok(!JSON.stringify(ok.body).includes('BEGIN CERTIFICATE')); // chỉ trả thông tin tóm tắt
  assert.equal((await put({ caPem: 'rác' })).status, 400);
  assert.equal((await put({ tlsMode: 'insecure' })).body.email.tlsMode, 'insecure');
  await app.close();
});

test('link hóa đơn điện tử và link giao dịch do Dsmart POS gửi kèm: hiện ở màn khách, bill, email, PDF; gửi bổ sung sau; link sai bị bỏ qua', async () => {
  const { createMailer } = await import('../server/services/mailer.js');
  const fm = fakeMail();
  const app = await makeApp({ basket: true });
  app.ctx.mailer = createMailer(app.ctx.db, fm.opts);
  const admin = (await adminLogin(app)).body.token;
  await configureMail(app, admin);
  // cấu hình link khai báo của quản trị không còn
  assert.equal((await call(app, 'PUT', '/api/a/integrations/invoice-portal', { token: admin, body: { url: 'https://x.vn' } })).status, 404);
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const mk = async (ref, email) => {
    const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' }, device: `dev-${ref}-1234567890abcdef` });
    const id = s.body.session.id;
    await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: barcodeOf(app, 'Q7', 'SUA01') }] }, device: `dev-${ref}-1234567890abcdef` });
    return { id, dev: `dev-${ref}-1234567890abcdef`, tx: (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref, email }, device: `dev-${ref}-1234567890abcdef` })).body.transaction };
  };
  const inv = 'https://hoadon.dsmart.vn/tra-cuu/ABC123', trn = 'https://dsmart.vn/gd/POS-1';
  const a = await mk('Q7-LINKS2345', 'k@example.com');
  assert.equal(a.tx.invoiceUrl, null); assert.equal(a.tx.transactionUrl, null); // chưa thanh toán thì chưa có
  const paid = await pos(app, key, 'POST', '/baskets/Q7-LINKS2345/paid', { pointCode: 'SP-Q7', posOrderRef: 'POS-1', amount: a.tx.total, method: 'cash', invoiceUrl: inv, transactionUrl: trn });
  assert.equal(paid.status, 200, JSON.stringify(paid.body)); assert.equal(paid.body.warnings, undefined);
  await Promise.all([...app.ctx.bg]);
  const bill = (await call(app, 'GET', `/api/c/transactions/${a.tx.id}/bill`, { device: a.dev })).body.bill;
  assert.equal(bill.invoiceUrl, inv); assert.equal(bill.transactionUrl, trn);
  const t = (await call(app, 'GET', `/api/c/sessions/${a.id}`, { device: a.dev })).body.session.transaction;
  assert.equal(t.invoiceUrl, inv); assert.equal(t.transactionUrl, trn);
  assert.ok(fm.sent[0].html.includes('Xem hóa đơn điện tử') && fm.sent[0].text.includes(inv) && fm.sent[0].text.includes(trn));
  const pdf = await app.inject({ method: 'GET', url: `/api/c/transactions/${a.tx.id}/bill.pdf`, headers: { 'x-device-id': a.dev } });
  assert.equal(pdf.statusCode, 200);
  // admin thấy link trong chi tiết giao dịch
  assert.equal((await call(app, 'GET', `/api/a/transactions/${a.tx.id}`, { token: admin })).body.transaction.invoiceUrl, inv);

  // link sai (không https) không chặn thanh toán, chỉ cảnh báo
  const b = await mk('Q7-LINKS3456');
  const bad = await pos(app, key, 'POST', '/baskets/Q7-LINKS3456/paid', { pointCode: 'SP-Q7', posOrderRef: 'POS-2', amount: b.tx.total, method: 'cash', invoiceUrl: 'http://khong-https.vn', transactionUrl: 'javascript:alert(1)' });
  assert.equal(bad.status, 200); assert.equal(bad.body.warnings.length, 2);
  assert.equal((await call(app, 'GET', `/api/c/transactions/${b.tx.id}/bill`, { device: b.dev })).body.bill.invoiceUrl, null);
  // hóa đơn phát hành chậm: gửi bổ sung sau bằng lệnh /invoice (bắt buộc đúng mã điểm, mã đơn; chỉ nhận https)
  const inv2 = 'https://hoadon.dsmart.vn/tra-cuu/XYZ789';
  const later = (body) => pos(app, key, 'POST', '/baskets/Q7-LINKS3456/invoice', { pointCode: 'SP-Q7', posOrderRef: 'POS-2', ...body });
  assert.equal((await later({ invoiceUrl: 'http://x.vn' })).body.error, 'BAD_URL');
  assert.equal((await later({})).body.error, 'LINK_REQUIRED');
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-LINKS3456/invoice', { pointCode: 'SP-9999', posOrderRef: 'POS-2', invoiceUrl: inv2 })).body.error, 'POINT_MISMATCH');
  const ok = await later({ invoiceUrl: inv2 });
  assert.equal(ok.status, 200); assert.equal(ok.body.invoiceUrl, inv2);
  assert.equal((await call(app, 'GET', `/api/c/transactions/${b.tx.id}/bill`, { device: b.dev })).body.bill.invoiceUrl, inv2);
  // báo thanh toán lại kèm link mới (gửi trùng) cũng cập nhật link, không ghi thu hai lần
  const dup = await pos(app, key, 'POST', '/baskets/Q7-LINKS3456/paid', { pointCode: 'SP-Q7', posOrderRef: 'POS-2', amount: b.tx.total, method: 'cash', transactionUrl: trn });
  assert.equal(dup.body.duplicate, true);
  assert.equal((await call(app, 'GET', `/api/c/transactions/${b.tx.id}/bill`, { device: b.dev })).body.bill.transactionUrl, trn);
  assert.equal(app.ctx.db.prepare('SELECT COUNT(*) n FROM payments WHERE transaction_id = ?').get(b.tx.id).n, 1);
  // đơn chưa thanh toán thì không nhận /invoice
  const c = await mk('Q7-LINKS4567');
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-LINKS4567/invoice', { pointCode: 'SP-Q7', posOrderRef: 'POS-3', invoiceUrl: inv })).body.error, 'NOT_PAID');
  await app.close();
});

test('bill: POS chỉ gửi mã hàng, số lượng, thành tiền thì hệ thống tự điền tên và đơn giá; thiếu cả mã hàng lẫn tên thì từ chối', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const bcSua = barcodeOf(app, 'Q7', 'SUA01');
  await call(app, 'POST', `/api/c/sessions/${s.body.session.id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: bcSua }, { id: 'b', type: 'scan', barcode: bcSua }] } });
  const tx = (await call(app, 'POST', `/api/c/sessions/${s.body.session.id}/basket`, { body: { ref: 'Q7-LINES234' } })).body.transaction;
  const base = { pointCode: 'SP-Q7', posOrderRef: 'P-L', amount: 50000, method: 'cash' };
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-LINES234/paid', { ...base, lines: [{ qty: 2, lineTotal: 50000 }] })).status, 400); // không có mã hàng, không có tên
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-LINES234/paid', { ...base, lines: [{ barcode: bcSua, qty: 0, lineTotal: 1 }] })).status, 400); // số lượng 0 (thành tiền không còn bắt buộc)
  const ok = await pos(app, key, 'POST', '/baskets/Q7-LINES234/paid', { ...base, lines: [{ barcode: bcSua, qty: 2, lineTotal: 50000 }, { barcode: '8930000000000', qty: 1, lineTotal: 1000, discount: 500 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const bill = (await call(app, 'GET', `/api/c/transactions/${tx.id}/bill`)).body.bill;
  assert.equal(bill.provisional, false);
  assert.equal(bill.lines[0].name.length > 3, true);       // tên lấy từ giỏ của khách
  assert.notEqual(bill.lines[0].name, bcSua);
  assert.equal(bill.lines[0].unitPrice, 25000);            // 50000 / 2
  assert.equal(bill.lines[1].name, '8930000000000');       // mã lạ: dùng mã hàng làm tên
  assert.equal(bill.lines[1].unitPrice, 1500);             // (1000 + 500) / 1
  await app.close();
});

test('bill: POS giảm giá cấp hóa đơn (tổng tiền khác tổng các dòng) thì bill hiện dòng điều chỉnh để cộng đúng', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const bc = barcodeOf(app, 'Q7', 'SUA01');
  await call(app, 'POST', `/api/c/sessions/${s.body.session.id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: bc }] } });
  const tx = (await call(app, 'POST', `/api/c/sessions/${s.body.session.id}/basket`, { body: { ref: 'Q7-ADJUST234' } })).body.transaction;
  // dòng đã trừ khuyến mãi mặt hàng (30.000 gốc, giảm 5.000) và voucher cả đơn 3.000: khách trả 22.000
  const r = await pos(app, key, 'POST', '/baskets/Q7-ADJUST234/paid', { pointCode: 'SP-Q7', posOrderRef: 'P-ADJ', amount: 22000, method: 'cash', lines: [{ barcode: bc, qty: 1, unitPrice: 30000, discount: 5000, lineTotal: 25000 }] });
  assert.equal(r.status, 200);
  const bill = (await call(app, 'GET', `/api/c/transactions/${tx.id}/bill`)).body.bill;
  assert.equal(bill.discount, 5000);
  assert.equal(bill.adjustment, -3000);
  assert.equal(bill.total, 22000);
  assert.equal(bill.lines[0].lineTotal + bill.adjustment, bill.total);
  await app.close();
});

test('giỏ tối đa số mặt hàng khác nhau: mặt hàng mới vượt mức bị từ chối, tăng số lượng mặt hàng đã có vẫn được', async () => {
  const { config } = await import('../server/config.js');
  const old = config.maxCartItems; config.maxCartItems = 2;
  try {
    const app = await makeApp({ basket: true });
    const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
    const id = s.body.session.id;
    const scan = async (sku, opId) => (await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: opId, type: 'scan', barcode: barcodeOf(app, 'Q7', sku) }] } })).body.results[0];
    assert.equal((await scan('SUA01', 'a')).ok, true);
    assert.equal((await scan('MI01', 'b')).ok, true);
    const full = await scan('TRU01', 'c');
    assert.equal(full.ok, false); assert.equal(full.code, 'CART_FULL');
    assert.equal((await scan('SUA01', 'd')).ok, true); // mặt hàng đã có: tăng số lượng
    assert.equal((await call(app, 'GET', '/api/c/store/Q7')).body.maxCartItems, 2);
    await app.close();
  } finally { config.maxCartItems = old; }
});

// ---- Hủy đơn ----
async function basketSetup(ref = 'Q7-CANCEL234', device = DEVICE) {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' }, device });
  const id = s.body.session.id;
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: barcodeOf(app, 'Q7', 'SUA01') }] }, device });
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref }, device })).body.transaction;
  return { app, admin, key, id, tx, ref };
}
const cancelBody = { pointCode: 'SP-Q7', posOrderRef: 'P-C1', reason: 'Khách đổi ý' };

test('hủy đơn: POS hủy trước khi thu tiền thì giỏ về trạng thái đang quét, khách quét lại được; POS báo thanh toán cho đơn đã hủy bị từ chối', async () => {
  const { app, key, id, tx } = await basketSetup();
  const c = await pos(app, key, 'POST', '/baskets/Q7-CANCEL234/cancelled', cancelBody);
  assert.equal(c.status, 200); assert.equal(c.body.status, 'cancelled'); assert.equal(c.body.cartReleased, true);
  const sv = (await call(app, 'GET', `/api/c/sessions/${id}`)).body.session;
  assert.equal(sv.status, 'active'); assert.equal(sv.transaction, null);          // điện thoại sẽ báo "Thu ngân đã hủy đơn"
  assert.equal(sv.items.length, 1);                                               // giỏ còn nguyên để sửa
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-CANCEL234/cancelled', cancelBody)).body.duplicate, true); // báo lại an toàn
  const late = await pos(app, key, 'POST', '/baskets/Q7-CANCEL234/paid', { pointCode: 'SP-Q7', posOrderRef: 'P-C1', amount: tx.total, method: 'cash' });
  assert.equal(late.status, 409); assert.equal(late.body.error, 'ORDER_CANCELLED');
  // khách khóa lại giỏ với mã mới, POS thu bình thường
  const tx2 = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: 'Q7-CANCEL999' } })).body.transaction;
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-CANCEL999/paid', { pointCode: 'SP-Q7', posOrderRef: 'P-C2', amount: tx2.total, method: 'cash' })).status, 200);
  await app.close();
});

test('hủy đơn: hủy sau khi đã thanh toán thì đơn thành "voided", khoản thu bị trừ khỏi doanh thu, khách thấy đơn đã hủy', async () => {
  const { app, key, id, tx } = await basketSetup();
  const pay = { pointCode: 'SP-Q7', posOrderRef: 'P-C1', amount: tx.total, method: 'cash' };
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-CANCEL234/paid', pay)).status, 200);
  const rev = () => app.ctx.db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE voided_at IS NULL').get().s;
  assert.equal(rev(), tx.total);
  const c = await pos(app, key, 'POST', '/baskets/Q7-CANCEL234/cancelled', cancelBody);
  assert.equal(c.status, 200); assert.equal(c.body.status, 'voided');
  assert.equal(rev(), 0);
  assert.equal((await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction.status, 'voided');
  assert.equal((await call(app, 'GET', `/api/c/transactions/${tx.id}/bill`)).status, 409); // không còn bill của đơn đã hủy
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-CANCEL234/cancelled', cancelBody)).body.duplicate, true);
  await app.close();
});

test('hủy đơn: khách sửa giỏ trên điện thoại sau khi POS đã quét và thu tiền thì khoản thu vẫn được ghi nhận, không làm hỏng giỏ mới của khách', async () => {
  const { app, key, id, tx } = await basketSetup();
  assert.equal((await call(app, 'POST', `/api/c/sessions/${id}/unlock`)).status, 200); // khách bấm "Sửa giỏ hàng"
  assert.equal(app.ctx.db.prepare('SELECT status FROM transactions WHERE id=?').get(tx.id).status, 'cancelled');
  // khách khóa giỏ mới (mã mới) trong lúc POS vẫn đang thu tiền theo mã QR cũ
  const tx2 = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: 'Q7-NEWBASK23' } })).body.transaction;
  const r = await pos(app, key, 'POST', '/baskets/Q7-CANCEL234/paid', { pointCode: 'SP-Q7', posOrderRef: 'P-OLD', amount: tx.total, method: 'cash' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(app.ctx.db.prepare('SELECT status FROM transactions WHERE id=?').get(tx.id).status, 'paid');
  assert.equal(app.ctx.db.prepare('SELECT COUNT(*) n FROM payments WHERE transaction_id=? AND voided_at IS NULL').get(tx.id).n, 1);
  // giỏ mới của khách vẫn nguyên
  const sv = (await call(app, 'GET', `/api/c/sessions/${id}`)).body.session;
  assert.equal(sv.status, 'locked'); assert.equal(sv.transaction.id, tx2.id);
  assert.ok(app.ctx.db.prepare(`SELECT 1 FROM audit_events WHERE action='pos.paid_after_cancel'`).get());
  await app.close();
});

test('hủy đơn: POS hủy đơn mà BRG chưa có giỏ (điện thoại đang mất mạng) thì trả 200 "unknown", POS không phải thử lại', async () => {
  const { app, key } = await basketSetup();
  const r = await pos(app, key, 'POST', '/baskets/Q7-NOTHERE234/cancelled', cancelBody);
  assert.equal(r.status, 200); assert.equal(r.body.status, 'unknown');
  await app.close();
});

test('khách quét nhiều hơn số lấy: POS chỉ gửi các dòng thực mua, báo thành công, bill và doanh thu theo POS, quản trị thấy phần bớt', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const id = s.body.session.id;
  const sua = barcodeOf(app, 'Q7', 'SUA01'), mi = barcodeOf(app, 'Q7', 'MI01');
  // khách quét 6 sữa và 4 mì = 10 mặt hàng
  const ops = [...Array(6)].map((_, i) => ({ id: `s${i}`, type: 'scan', barcode: sua })).concat([...Array(4)].map((_, i) => ({ id: `m${i}`, type: 'scan', barcode: mi })));
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops } });
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: 'Q7-LESS2345' } })).body.transaction;
  assert.equal(tx.itemCount, 10);
  // ở quầy khách chỉ lấy 5 sữa và 3 mì = 8
  const r = await pos(app, key, 'POST', '/baskets/Q7-LESS2345/paid', { pointCode: 'SP-Q7', posOrderRef: 'P-LESS', amount: 100000, method: 'cash', lines: [{ barcode: sua, qty: 5, lineTotal: 70000 }, { barcode: mi, qty: 3, lineTotal: 30000 }] });
  assert.equal(r.status, 200); assert.equal(r.body.status, 'paid');
  const bill = (await call(app, 'GET', `/api/c/transactions/${tx.id}/bill`)).body.bill;
  assert.equal(bill.lines.reduce((a, l) => a + l.qty, 0), 8);
  assert.equal(bill.total, 100000);
  assert.equal(app.ctx.db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE voided_at IS NULL').get().s, 100000);
  const d = (await call(app, 'GET', `/api/a/transactions/${tx.id}`, { token: admin })).body;
  assert.equal(d.cartDiff.same, false);
  assert.deepEqual(d.cartDiff.changed.map((x) => [x.from, x.to]).sort(), [[4, 3], [6, 5]]);
  assert.equal(d.cartDiff.removed.length, 0);
  await app.close();
});

test('hoàn trả một phần sau thanh toán: ghi khoản hoàn âm, doanh thu giảm, báo lại không ghi trùng, không hoàn quá số đã thu, hoàn hết thì đơn thành đã hủy', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const id = s.body.session.id;
  const sua = barcodeOf(app, 'Q7', 'SUA01');
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: sua }, { id: 'b', type: 'scan', barcode: sua }] } });
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: 'Q7-REFUND234' } })).body.transaction;
  const refund = (body) => pos(app, key, 'POST', '/baskets/Q7-REFUND234/refund', { pointCode: 'SP-Q7', posOrderRef: 'P-R', ...body });
  const rev = () => app.ctx.db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE voided_at IS NULL').get().s;
  // chưa thanh toán: không hoàn được
  assert.equal((await refund({ refundRef: 'R1', amount: 1000 })).status, 409);
  await pos(app, key, 'POST', '/baskets/Q7-REFUND234/paid', { pointCode: 'SP-Q7', posOrderRef: 'P-R', amount: 60000, method: 'cash', lines: [{ barcode: sua, qty: 2, lineTotal: 60000 }] });
  assert.equal(rev(), 60000);
  assert.equal((await refund({ amount: 1000 })).body.error, 'REFUND_REF_REQUIRED');
  assert.equal((await refund({ refundRef: 'R1', amount: 0 })).status, 400);
  assert.equal((await refund({ refundRef: 'R1', amount: 70000 })).body.error, 'REFUND_TOO_LARGE');
  // hoàn 1 hộp sữa, 30.000
  const r1 = await refund({ refundRef: 'R1', amount: 30000, method: 'cash', reason: 'Khách trả 1 hộp', lines: [{ barcode: sua, qty: 1, amount: 30000 }] });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.refunded, 30000); assert.equal(r1.body.remaining, 30000); assert.equal(r1.body.status, 'paid');
  assert.equal(rev(), 30000);
  // báo lại: không ghi trùng; cùng mã khác số tiền: từ chối
  assert.equal((await refund({ refundRef: 'R1', amount: 30000 })).body.duplicate, true);
  assert.equal((await refund({ refundRef: 'R1', amount: 5000 })).body.error, 'REFUND_REF_IN_USE');
  assert.equal(rev(), 30000);
  // bill: còn xem được, có phần hoàn trả và thực thanh toán
  const bill = (await call(app, 'GET', `/api/c/transactions/${tx.id}/bill`)).body.bill;
  assert.equal(bill.total, 60000); assert.equal(bill.refundTotal, 30000); assert.equal(bill.netTotal, 30000);
  assert.equal(bill.refunds[0].lines[0].name.length > 3, true);
  assert.equal((await app.inject({ method: 'GET', url: `/api/c/transactions/${tx.id}/bill.pdf`, headers: { 'x-device-id': DEVICE } })).statusCode, 200);
  assert.equal((await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction.refundTotal, 30000);
  // hoàn nốt phần còn lại: đơn thành đã hủy
  const r2 = await refund({ refundRef: 'R2', amount: 30000 });
  assert.equal(r2.body.status, 'voided'); assert.equal(r2.body.remaining, 0);
  assert.equal(rev(), 0);
  assert.equal((await refund({ refundRef: 'R3', amount: 1000 })).body.error, 'ORDER_CANCELLED');
  // sai mã điểm bị từ chối như các lệnh khác
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-REFUND234/refund', { pointCode: 'SP-Q1', posOrderRef: 'P-R', refundRef: 'R9', amount: 1 })).body.error, 'POINT_MISMATCH');
  await app.close();
});

test('khách lấy thêm hàng ở quầy: POS báo đơn đang tính để điện thoại thấy khác biệt, rồi báo thanh toán với đủ các dòng; điện thoại hiện đơn thực mua', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const id = s.body.session.id;
  const sua = barcodeOf(app, 'Q7', 'SUA01'), mi = barcodeOf(app, 'Q7', 'MI01'), tru = barcodeOf(app, 'Q7', 'TRU01');
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: sua }, { id: 'b', type: 'scan', barcode: mi }] } });
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: 'Q7-MORE23456' } })).body.transaction;
  const up = (body) => pos(app, key, 'POST', '/baskets/Q7-MORE23456/update', { pointCode: 'SP-Q7', posOrderRef: 'P-MORE', ...body });
  assert.equal((await up({})).body.error, 'BAD_LINES');
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-MORE23456/update', { posOrderRef: 'P-MORE', lines: [{ barcode: sua, qty: 1, lineTotal: 1 }] })).body.error, 'POINT_REQUIRED');
  // trước khi thanh toán: điện thoại chưa có thông báo
  assert.equal((await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction.posDraft, null);
  // thu ngân thêm 1 trứng, tăng sữa lên 2
  const r = await up({ lines: [{ barcode: sua, qty: 2, lineTotal: 58000 }, { barcode: mi, qty: 1, lineTotal: 12500 }, { barcode: tru, qty: 1, lineTotal: 38000 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.itemCount, 4); assert.equal(r.body.total, 108500); assert.equal(r.body.differsFromPhone, true);
  const t1 = (await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction;
  assert.equal(t1.status, 'awaiting_counter');
  assert.equal(t1.posDraft.itemCount, 4);
  assert.equal(t1.posDraft.diff.added.length, 1); assert.equal(t1.posDraft.diff.changed[0].to, 2);
  // khách vẫn sửa giỏ được (đơn tại quầy chưa khóa giỏ)
  // gửi cập nhật lần sau thay lần trước
  assert.equal((await up({ lines: [{ barcode: sua, qty: 1, lineTotal: 29000 }, { barcode: mi, qty: 1, lineTotal: 12500 }] })).body.differsFromPhone, false);
  await up({ lines: [{ barcode: sua, qty: 2, lineTotal: 58000 }, { barcode: mi, qty: 1, lineTotal: 12500 }, { barcode: tru, qty: 1, lineTotal: 38000 }] });
  // báo thanh toán với đơn thực mua
  const paid = await pos(app, key, 'POST', '/baskets/Q7-MORE23456/paid', { pointCode: 'SP-Q7', posOrderRef: 'P-MORE', amount: 108500, method: 'cash', lines: [{ barcode: sua, qty: 2, lineTotal: 58000 }, { barcode: mi, qty: 1, lineTotal: 12500 }, { barcode: tru, qty: 1, lineTotal: 38000 }] });
  assert.equal(paid.status, 200);
  const t2 = (await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction;
  assert.equal(t2.status, 'paid');
  assert.equal(t2.posItemCount, 4);
  assert.equal(t2.cartDiff.added[0].qty, 1);
  assert.equal(t2.posDraft, null);
  // thống kê hàng thêm: khách quét 1 sữa + 1 mì, POS tính 2 sữa + 1 mì + 1 trứng
  const row = app.ctx.db.prepare('SELECT extra_qty, extra_value, less_qty FROM transactions WHERE id = ?').get(tx.id);
  assert.equal(row.extra_qty, 2); assert.equal(row.extra_value, 29000 + 38000); assert.equal(row.less_qty, 0);
  const rep = await call(app, 'GET', '/api/a/reports', { token: admin });
  assert.equal(rep.body.totals.extraTx, 1); assert.equal(rep.body.totals.extraQty, 2); assert.equal(rep.body.totals.extraValue, 67000);
  const csv = await call(app, 'GET', '/api/a/reports.csv', { token: admin });
  assert.match(csv.raw.body, /,1,2,67000,0/);
  // sau thanh toán không cập nhật được nữa
  assert.equal((await up({ lines: [{ barcode: sua, qty: 1, lineTotal: 1 }] })).body.error, 'NOT_UPDATABLE');
  await app.close();
});

test('hết hạn: giỏ đã bấm Thanh toán quá 30 phút bị hủy đơn nhưng giữ giỏ; giỏ đang quét quá 3 giờ mới đóng; Dsmart POS báo muộn vẫn nhận', async () => {
  const { sweepStaleCarts } = await import('../server/services/core.js');
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const db = app.ctx.db;
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const sua = barcodeOf(app, 'Q7', 'SUA01');
  const newBasket = async (dev, ref) => {
    const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' }, device: dev });
    const id = s.body.session.id;
    await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: sua }] }, device: dev });
    const tx = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref }, device: dev })).body.transaction;
    return { id, tx };
  };
  const A = await newBasket('devA-1234567890abcdef', 'Q7-EXPIRE2345');
  const B = await newBasket('devB-1234567890abcdef', 'Q7-CLAIMED234');
  const C = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' }, device: 'devC-1234567890abcdef' }); // chỉ quét, chưa thanh toán
  // 20 phút: chưa hết hạn
  db.prepare('UPDATE scan_sessions SET last_activity = ?').run(ago(20));
  assert.equal(sweepStaleCarts(app.ctx), 0);
  // A quá 30 phút; B cũng cũ nhưng Dsmart POS vừa nhận giỏ
  db.prepare('UPDATE scan_sessions SET last_activity = ?').run(ago(31));
  db.prepare(`UPDATE transactions SET pos_order_ref='P-B', pos_status='claimed', pos_claimed_at=? WHERE id=?`).run(ago(5), B.tx.id);
  assert.equal(sweepStaleCarts(app.ctx), 1);
  const ta = db.prepare('SELECT status, cancel_reason FROM transactions WHERE id=?').get(A.tx.id);
  assert.equal(ta.status, 'cancelled'); assert.equal(ta.cancel_reason, 'expired');
  assert.equal(db.prepare('SELECT status FROM transactions WHERE id=?').get(B.tx.id).status, 'awaiting_counter');
  // giỏ A được giữ lại để khách tạo mã mới
  const view = (await call(app, 'GET', `/api/c/sessions/${A.id}`, { device: 'devA-1234567890abcdef' })).body.session;
  assert.equal(view.status, 'active'); assert.equal(view.items.length, 1); assert.equal(view.transaction, null); assert.equal(view.releasedReason, 'expired');
  // Dsmart POS hỏi trạng thái thấy hủy + lý do
  const st = await pos(app, key, 'GET', '/baskets/Q7-EXPIRE2345?pointCode=SP-Q7');
  assert.equal(st.body.status, 'cancelled'); assert.equal(st.body.reason, 'expired');
  // Dsmart POS báo muộn: tiền đã thu thật nên vẫn nhận
  const late = await pos(app, key, 'POST', '/baskets/Q7-EXPIRE2345/paid', { pointCode: 'SP-Q7', posOrderRef: 'P-LATE', amount: 29000, method: 'cash' });
  assert.equal(late.status, 200, JSON.stringify(late.body));
  assert.equal(db.prepare('SELECT status FROM transactions WHERE id=?').get(A.tx.id).status, 'paid');
  // giỏ chỉ quét: 2h59 còn, 3h01 đóng
  db.prepare('UPDATE scan_sessions SET last_activity = ? WHERE id = ?').run(ago(179), C.body.session.id);
  assert.equal(sweepStaleCarts(app.ctx), 0);
  db.prepare('UPDATE scan_sessions SET last_activity = ? WHERE id = ?').run(ago(181), C.body.session.id);
  assert.equal(sweepStaleCarts(app.ctx), 1);
  assert.equal(db.prepare('SELECT status FROM scan_sessions WHERE id=?').get(C.body.session.id).status, 'abandoned');
  await app.close();
});

test('giữ dữ liệu: xóa thông tin cá nhân quá hạn nhưng giữ đơn, tiền và bill; xóa nhật ký kỹ thuật cũ; cấu hình qua API', async () => {
  const { runRetention } = await import('../server/services/retention.js');
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const db = app.ctx.db;
  const sua = barcodeOf(app, 'Q7', 'SUA01');
  const mk = async (dev, ref, posRef) => {
    const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' }, device: dev });
    const id = s.body.session.id;
    await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: sua }] }, device: dev });
    const tx = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref }, device: dev })).body.transaction;
    await pos(app, key, 'POST', `/baskets/${ref}/paid`, { pointCode: 'SP-Q7', posOrderRef: posRef, amount: 29000, method: 'cash', lines: [{ barcode: sua, qty: 1, lineTotal: 29000 }] });
    return { id, tx };
  };
  const old = await mk('devOld-1234567890abcdef', 'Q7-RETOLD234', 'P-OLD');
  const fresh = await mk('devNew-1234567890abcdef', 'Q7-RETNEW234', 'P-NEW');
  const ago = (d) => new Date(Date.now() - d * 86400_000).toISOString();
  for (const t of [old.tx, fresh.tx]) db.prepare(`UPDATE transactions SET bill_email='khach@example.com', buyer_json='{"email":"khach@example.com","taxCode":"0123456789"}' WHERE id=?`).run(t.id);
  db.prepare(`INSERT INTO invoices(transaction_id,type,email,tax_code,company_name,address,status,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(old.tx.id, 'company', 'khach@example.com', '0123456789', 'Cty A', 'HN', 'issued', ago(400));
  db.prepare('UPDATE transactions SET paid_at=?, created_at=? WHERE id=?').run(ago(400), ago(400), old.tx.id); // hơn 12 tháng
  db.prepare('UPDATE transactions SET paid_at=? WHERE id=?').run(ago(30), fresh.tx.id);
  db.prepare(`INSERT INTO device_emails(device_id,email,verified_at) VALUES('devOld','khach@example.com',?)`).run(ago(400));
  db.prepare(`INSERT INTO device_emails(device_id,email,verified_at) VALUES('devNew','khac@example.com',?)`).run(ago(10));
  db.prepare(`UPDATE scan_events SET ts=? WHERE session_id=?`).run(ago(120), old.id);
  db.prepare(`UPDATE scan_sessions SET ended_at=?, last_activity=? WHERE id=?`).run(ago(120), ago(120), old.id);
  db.prepare(`INSERT INTO audit_events(ts,actor_type,action) VALUES(?,?,?)`).run(ago(800), 'system', 'x.old');
  const revenue = () => db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments').get().s;
  const before = revenue();

  const r = runRetention(app.ctx);
  assert.equal(r.done.piiTransactions, 1);
  const o = db.prepare('SELECT bill_email, buyer_json, device_id, status, total, pos_amount, pii_purged_at, items_json FROM transactions WHERE id=?').get(old.tx.id);
  assert.equal(o.bill_email, null); assert.equal(o.buyer_json, null); assert.equal(o.device_id, '-'); assert.ok(o.pii_purged_at);
  assert.equal(o.status, 'paid'); assert.equal(o.pos_amount, 29000); assert.ok(JSON.parse(o.items_json).length === 1); // đơn và hàng vẫn còn
  assert.equal(db.prepare('SELECT email, tax_code, company_name, address FROM invoices WHERE transaction_id=?').get(old.tx.id).tax_code, null);
  const n = db.prepare('SELECT bill_email, buyer_json, device_id FROM transactions WHERE id=?').get(fresh.tx.id);
  assert.equal(n.bill_email, 'khach@example.com'); assert.ok(n.buyer_json); assert.notEqual(n.device_id, '-'); // đơn mới giữ nguyên
  assert.equal(db.prepare('SELECT COUNT(*) n FROM device_emails').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM scan_events WHERE session_id=?').get(old.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cart_items WHERE session_id=?').get(old.id).n, 0);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM cart_items WHERE session_id=?').get(fresh.id).n >= 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM audit_events WHERE action='x.old'`).get().n, 0);
  assert.equal(revenue(), before); // doanh thu không đổi
  assert.equal(runRetention(app.ctx).done.piiTransactions, 0); // chạy lại không xử lý thêm

  // cấu hình qua API
  const g = await call(app, 'GET', '/api/a/integrations/retention', { token: admin });
  assert.equal(g.body.config.piiMonths, 12); assert.ok(g.body.last);
  assert.equal((await call(app, 'PUT', '/api/a/integrations/retention', { token: admin, body: { piiMonths: 3 } })).body.config.piiMonths, 3);
  assert.equal((await call(app, 'PUT', '/api/a/integrations/retention', { token: admin, body: { piiMonths: 0 } })).body.config.piiMonths, 0); // giữ mãi
  assert.equal((await call(app, 'PUT', '/api/a/integrations/retention', { token: admin, body: { logDays: 2 } })).body.error, 'BAD_RETENTION');
  // piiMonths = 0: không xóa gì
  db.prepare('UPDATE transactions SET paid_at=? WHERE id=?').run(ago(900), fresh.tx.id);
  assert.equal(runRetention(app.ctx).done.piiTransactions, 0);
  const run = await call(app, 'POST', '/api/a/integrations/retention/run', { token: admin });
  assert.equal(run.status, 200);
  await app.close();
});

test('xóa dữ liệu theo yêu cầu của khách: tìm theo email, xóa thông tin cá nhân, giữ đơn và tiền, không đụng khách khác', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const db = app.ctx.db;
  const sua = barcodeOf(app, 'Q7', 'SUA01');
  const mk = async (dev, ref, posRef) => {
    const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' }, device: dev });
    const id = s.body.session.id;
    await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: sua }] }, device: dev });
    const tx = (await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref }, device: dev })).body.transaction;
    await pos(app, key, 'POST', `/baskets/${ref}/paid`, { pointCode: 'SP-Q7', posOrderRef: posRef, amount: 29000, method: 'cash', lines: [{ barcode: sua, qty: 1, lineTotal: 29000 }] });
    return tx;
  };
  const a = await mk('devA-1234567890abcdef', 'Q7-ERASEA234', 'P-EA');
  const b = await mk('devB-1234567890abcdef', 'Q7-ERASEB234', 'P-EB');
  db.prepare(`UPDATE transactions SET bill_email='Khach.A@Example.com', buyer_json='{"email":"khach.a@example.com","taxCode":"0123456789","companyName":"Cty A"}' WHERE id=?`).run(a.id);
  db.prepare(`UPDATE transactions SET bill_email='khach.b@example.com' WHERE id=?`).run(b.id);
  db.prepare(`INSERT INTO device_emails(device_id,email,verified_at) VALUES('devA-1234567890abcdef','khach.a@example.com',?)`).run(new Date().toISOString());
  db.prepare(`INSERT INTO invoices(transaction_id,type,email,tax_code,company_name,address,status,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(a.id, 'company', 'khach.a@example.com', '0123456789', 'Cty A', 'HN', 'issued', new Date().toISOString());
  const before = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments').get().s;

  const pv = await call(app, 'POST', '/api/a/privacy/erase-preview', { token: admin, body: { email: 'KHACH.A@example.com' } });
  assert.equal(pv.body.counts.transactions, 1); assert.equal(pv.body.counts.invoices, 1); assert.equal(pv.body.counts.verifiedEmails, 1);
  assert.equal((await call(app, 'POST', '/api/a/privacy/erase-preview', { token: admin, body: { email: 'khong-hop-le' } })).body.error, 'BAD_EMAIL');
  // phải nhập lại đúng email
  assert.equal((await call(app, 'POST', '/api/a/privacy/erase', { token: admin, body: { email: 'khach.a@example.com', confirm: 'khac@example.com' } })).body.error, 'CONFIRM_MISMATCH');
  assert.ok(db.prepare('SELECT bill_email FROM transactions WHERE id=?').get(a.id).bill_email);

  const r = await call(app, 'POST', '/api/a/privacy/erase', { token: admin, body: { email: 'khach.a@example.com', confirm: 'Khach.A@example.com', note: 'Yêu cầu #12' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ta = db.prepare('SELECT bill_email, buyer_json, device_id, status, pos_amount FROM transactions WHERE id=?').get(a.id);
  assert.equal(ta.bill_email, null); assert.equal(ta.buyer_json, null); assert.equal(ta.device_id, '-');
  assert.equal(ta.status, 'paid'); assert.equal(ta.pos_amount, 29000); // đơn và tiền giữ nguyên
  const inv = db.prepare('SELECT email, tax_code, company_name, address FROM invoices WHERE transaction_id=?').get(a.id);
  assert.deepEqual(inv, { email: null, tax_code: null, company_name: null, address: null });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM device_emails').get().n, 0);
  // khách khác không bị đụng
  const tb = db.prepare('SELECT bill_email, device_id FROM transactions WHERE id=?').get(b.id);
  assert.equal(tb.bill_email, 'khach.b@example.com'); assert.notEqual(tb.device_id, '-');
  assert.equal(db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments').get().s, before);
  // nhật ký chỉ lưu dấu vết băm, không lưu email
  const ev = db.prepare(`SELECT entity_id, data FROM audit_events WHERE action='privacy.erase'`).get();
  assert.ok(ev); assert.ok(!JSON.stringify(ev).includes('khach.a')); assert.match(ev.data, /Yêu cầu #12/);
  // không còn gì để xóa
  assert.equal((await call(app, 'POST', '/api/a/privacy/erase-preview', { token: admin, body: { email: 'khach.a@example.com' } })).body.counts.transactions, 0);
  await app.close();
});

test('phiên bản: số sau chạy 0 đến 9 rồi số trước tăng, hiện trong /api/health', async () => {
  const { nextVersion, appVersion } = await import('../server/version.js');
  assert.equal(nextVersion('1.0'), '1.1'); assert.equal(nextVersion('1.8'), '1.9');
  assert.equal(nextVersion('1.9'), '2.0'); assert.equal(nextVersion('2.9'), '3.0'); assert.equal(nextVersion('9.9'), '10.0');
  assert.equal(nextVersion('1.9.0'), '2.0');
  assert.throws(() => nextVersion('1.10'));
  const app = await makeApp({ basket: true });
  const h = await call(app, 'GET', '/api/health');
  assert.equal(h.body.version, appVersion()); assert.match(h.body.version, /^\d+\.\d$/);
  await app.close();
});

test('giỏ QR: GET có idx và sku; update dạng thay đổi (sku, qty, add/remove); paid chỉ gửi sku và qty, bill tạm tính theo giá BRG và có dòng điều chỉnh', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const id = s.body.session.id;
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [
    { id: 'a', type: 'scan', barcode: barcodeOf(app, 'Q7', 'SUA01') }, { id: 'a2', type: 'scan', barcode: barcodeOf(app, 'Q7', 'SUA01') },
    { id: 'b', type: 'scan', barcode: barcodeOf(app, 'Q7', 'MI01') }] } });
  const code = 'Q7-SKU23456';
  const lk = await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: code } });
  assert.equal(lk.status, 200, JSON.stringify(lk.body));
  const g = (await pos(app, key, 'GET', `/baskets/${code}?pointCode=SP-Q7`)).body;
  assert.deepEqual(g.items.map((i) => i.idx), [1, 2]);
  assert.ok(g.items.every((i) => i.sku && i.barcode && i.priced === true));
  const sua = g.items.find((i) => i.sku === 'SUA01'), mi = g.items.find((i) => i.sku === 'MI01');
  assert.equal(sua.qty, 2);
  const base = { pointCode: 'SP-Q7', posOrderRef: 'POS-77' };
  // thay đổi: bớt 1 sữa, thêm 1 mì, thêm 1 mặt hàng chưa quét; thiếu op thì 400
  assert.equal((await pos(app, key, 'POST', `/baskets/${code}/update`, { ...base, changes: [{ sku: 'SUA01', qty: 1 }] })).status, 400);
  const up = await pos(app, key, 'POST', `/baskets/${code}/update`, { ...base, changes: [{ sku: 'SUA01', qty: 1, op: 'remove' }, { sku: 'MI01', qty: 1, op: 'add' }] });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.itemCount, 3);
  assert.equal(up.body.differsFromPhone, true);
  // paid chỉ có sku và qty
  const paid = await pos(app, key, 'POST', `/baskets/${code}/paid`, { ...base, amount: 100000, method: 'cash', lines: [{ sku: 'SUA01', qty: 1 }, { sku: 'MI01', qty: 2 }] });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const tx = (await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction;
  const bill = (await call(app, 'GET', `/api/c/transactions/${tx.id}/bill`)).body.bill;
  assert.equal(bill.provisional, false);
  assert.equal(bill.total, 100000);
  assert.equal(bill.lines.reduce((a, l) => a + l.lineTotal, 0) + bill.adjustment, 100000);
  assert.deepEqual(bill.lines.map((l) => [l.sku, l.qty]), [['SUA01', 1], ['MI01', 2]]);
  await app.close();
});

test('bảo mật nghiệp vụ: mã đơn Dsmart trùng giữa hai cửa hàng không chặn nhau; mã giỏ phải mang mã chi nhánh; số tiền quá lớn bị từ chối; thanh toán đến sau khi nhả giỏ vẫn ghi nhận; bốc thăm kiểm tra không đổi khi khóa lại', async () => {
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const key = (await call(app, 'POST', '/api/a/pos/keys', { token: admin, body: { name: 'POS' } })).body.key;
  await call(app, 'PUT', '/api/a/stores/Q7', { token: admin, body: { posCode: 'SP-Q7' } });
  await call(app, 'PUT', '/api/a/stores/Q1', { token: admin, body: { posCode: 'SP-Q1' } });
  await call(app, 'PUT', '/api/a/stores/Q1', { token: admin, body: { enabled: true } });
  const mk = async (store, code, dev) => {
    const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: store }, device: dev });
    const id = s.body.session.id;
    await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: barcodeOf(app, store, 'SUA01') }] }, device: dev });
    return { id, res: await call(app, 'POST', `/api/c/sessions/${id}/basket`, { body: { ref: code }, device: dev }) };
  };
  const DEV2 = 'second-device-0123456789abcdef';
  // mã giỏ phải bắt đầu bằng mã chi nhánh của phiên (chặn tạo giỏ trùng mã ở chi nhánh khác)
  const bad = await mk('Q7', 'ZZ-SHARED12', DEVICE); assert.equal(bad.res.status, 400); assert.equal(bad.res.body.error, 'BAD_REF');
  const a7 = await mk('Q7', 'Q7-AAAAAA23', DEVICE); assert.equal(a7.res.status, 200, JSON.stringify(a7.res.body));
  const a1 = await mk('Q1', 'Q1-BBBBBB23', DEV2); assert.equal(a1.res.status, 200, JSON.stringify(a1.res.body));
  const paid = (code, point, extra = {}) => pos(app, key, 'POST', `/baskets/${code}/paid`, { pointCode: point, posOrderRef: 'HD0001', amount: 29000, method: 'cash', ...extra });
  assert.equal((await paid('Q7-AAAAAA23', 'SP-Q7')).status, 200);
  const other = await paid('Q1-BBBBBB23', 'SP-Q1'); // cùng mã đơn HD0001 ở cửa hàng khác: vẫn ghi nhận, không lộ mã giao dịch của cửa hàng kia
  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.equal(JSON.stringify(other.body).includes('SG-Q7'), false);
  assert.equal((await paid('Q7-AAAAAA23', 'SP-Q7')).body.duplicate, true); // báo lại cùng đơn vẫn an toàn
  // số tiền: quá lớn bị từ chối
  const c = await mk('Q7', 'Q7-CCCCCC23', 'third-device-0123456789abcdef'); assert.equal(c.res.status, 200);
  assert.equal((await paid('Q7-CCCCCC23', 'SP-Q7', { posOrderRef: 'HD0002', amount: 1e300 })).status, 400);
  assert.equal((await paid('Q7-CCCCCC23', 'SP-Q7', { posOrderRef: 'HD0002', amount: 3_000_000_000 })).body.error, 'BAD_AMOUNT');
  // quản trị nhả giỏ khi Dsmart đã nhận, rồi Dsmart báo thanh toán: tiền thật đã thu nên vẫn ghi nhận
  assert.equal((await pos(app, key, 'POST', '/baskets/Q7-CCCCCC23/update', { pointCode: 'SP-Q7', posOrderRef: 'HD0002', changes: [{ sku: 'SUA01', qty: 1, op: 'add' }] })).status, 200);
  const txId = app.ctx.db.prepare("SELECT id FROM transactions WHERE cart_code='Q7-CCCCCC23'").get().id;
  const rel = await call(app, 'POST', `/api/a/pos/orders/${txId}/release`, { token: admin, body: { reason: 'Thu ngân treo máy' } });
  assert.equal(rel.status, 200, JSON.stringify(rel.body));
  const late = await paid('Q7-CCCCCC23', 'SP-Q7', { posOrderRef: 'HD0002', amount: 58000 });
  assert.equal(late.status, 200, JSON.stringify(late.body));
  assert.equal(app.ctx.db.prepare('SELECT status FROM transactions WHERE id=?').get(txId).status, 'paid');
  await app.close();
});

test('bốc thăm kiểm tra ngẫu nhiên cố định theo phiên: mở khóa rồi khóa lại không đổi kết quả (classic)', async () => {
  let n = 0;
  const app = await makeApp({ rng: () => (n++ % 2 === 0 ? 0 : 0.99) }); // lần đầu trúng kiểm tra, lần sau nếu bốc lại sẽ không trúng
  const admin = (await adminLogin(app)).body.token;
  await call(app, 'PUT', '/api/a/stores/Q7/config', { token: admin, body: { randomCheckRate: 50 } });
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const id = s.body.session.id;
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'a', type: 'scan', barcode: barcodeOf(app, 'Q7', 'SUA01') }] } });
  const first = await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash' } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const flags = [first.body.transaction.checkRequired];
  for (let i = 0; i < 4; i++) {
    await call(app, 'POST', `/api/c/sessions/${id}/unlock`);
    flags.push((await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash' } })).body.transaction.checkRequired);
  }
  assert.equal(new Set(flags).size, 1, 'kết quả bốc thăm phải giống nhau: ' + flags.join(','));
  await app.close();
});
