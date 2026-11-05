import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, staffLogin, barcodeOf, DEVICE } from './helpers.js';
import { parseReceiptToken } from '../server/services/qr.js';
import { ean13 } from '../server/services/barcode.js';

async function newCart(app, items, device = DEVICE) {
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' }, device });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const id = s.body.session.id;
  const ops = items.flatMap(([sku, n], i) => Array.from({ length: n }, (_, j) => ({ id: `op-${sku}-${i}-${j}`, type: 'scan', barcode: barcodeOf(app, 'Q7', sku) })));
  const r = await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops }, device });
  assert.equal(r.status, 200);
  return { id, r };
}

test('quét sản phẩm, tính khuyến mãi và tổng tiền', async () => {
  const app = await makeApp();
  const { r } = await newCart(app, [['SUA01', 2], ['MI01', 5], ['TRU01', 1], ['NUOC01', 2], ['DAU01', 1]]);
  const s = r.body.session;
  assert.equal(s.itemCount, 11);
  assert.equal(s.subtotal, 195000);
  assert.equal(s.discount, 13000);
  assert.equal(s.total, 182000);
  await app.close();
});

test('mã sai, không có trong hệ thống, ngừng bán, hết hàng', async () => {
  const app = await makeApp();
  const s = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'Q7' } });
  const id = s.body.session.id;
  const scan = async (barcode, opId) => (await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: opId, type: 'scan', barcode }] } })).body.results[0];
  assert.equal((await scan('8936036123450', 'a')).code, 'INVALID_BARCODE'); // sai chữ số kiểm tra
  assert.equal((await scan(ean13('893999999999'), 'b')).code, 'NOT_FOUND');
  assert.equal((await scan(barcodeOf(app, 'Q7', 'NGUNG01'), 'c')).code, 'INACTIVE');
  assert.equal((await scan(barcodeOf(app, 'Q7', 'HET01'), 'd')).code, 'OUT_OF_STOCK');
  const unknown = app.ctx.db.prepare('SELECT * FROM unknown_barcodes WHERE store_id=?').all('Q7');
  assert.equal(unknown.length, 1);
  await app.close();
});

test('thao tác gửi lại không bị tính trùng (idempotent)', async () => {
  const app = await makeApp();
  const { id } = await newCart(app, [['MI01', 1]]);
  const op = { id: 'same-op', type: 'scan', barcode: barcodeOf(app, 'Q7', 'MI01') };
  await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [op] } });
  const r = await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [op] } });
  assert.equal(r.body.results[0].duplicate, true);
  assert.equal(r.body.session.items[0].qty, 2);
  await app.close();
});

test('khách khác không đọc được phiên của mình', async () => {
  const app = await makeApp();
  const { id } = await newCart(app, [['MI01', 1]]);
  const r = await call(app, 'GET', `/api/c/sessions/${id}`, { device: 'another-device-0123456789' });
  assert.equal(r.status, 404);
  await app.close();
});

test('luồng đầy đủ: khoá giỏ, thu tiền mặt, QR biên nhận, qua cổng, QR chỉ dùng một lần', async () => {
  const app = await makeApp();
  const { id } = await newCart(app, [['SUA01', 2], ['DAU01', 1]]);
  const lock = await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash' } });
  assert.equal(lock.status, 200, JSON.stringify(lock.body));
  const tx = lock.body.transaction;
  assert.match(tx.code, /^GH-Q7-\d{4}$/);
  assert.equal(tx.status, 'awaiting_counter');
  assert.equal(tx.receipt, null, 'chưa thanh toán thì chưa có QR biên nhận');

  const staff = await staffLogin(app);
  // Chưa bắt đầu ca thì không thu được
  let c = await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 500000 } });
  assert.equal(c.body.error, 'NO_SHIFT');
  await call(app, 'POST', '/api/s/shifts/start', { token: staff, body: { kind: 'sang' } });

  const find = await call(app, 'GET', `/api/s/carts/lookup?code=gh-q7-${tx.code.slice(-4)}`, { token: staff });
  assert.equal(find.body.transaction.id, tx.id);
  assert.equal(find.body.transaction.items.length, 2);

  c = await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 10000 } });
  assert.equal(c.body.error, 'CASH_SHORT');
  c = await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 200000 } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.change, 200000 - tx.total);
  // Thu hai lần bị chặn
  c = await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 200000 } });
  assert.equal(c.body.error, 'NOT_COLLECTABLE');

  const st = await call(app, 'GET', `/api/c/sessions/${id}`);
  const receipt = st.body.session.transaction.receipt;
  assert.ok(receipt.token.startsWith('R1.'));
  assert.equal(parseReceiptToken(receipt.token).txId, tx.id);
  assert.equal(st.body.session.transaction.invoice.status, 'issued');

  const gate = await staffLogin(app, 'NV0157', '2222');
  const g1 = await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: receipt.token } });
  assert.equal(g1.body.outcome, 'valid');
  const g2 = await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: receipt.token } });
  assert.equal(g2.body.outcome, 'used');
  await app.close();
});

test('QR giả hoặc sửa chữ ký bị từ chối; mã giỏ hàng không dùng để ra cổng', async () => {
  const app = await makeApp();
  const gate = await staffLogin(app, 'NV0157', '2222');
  const bad = await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: 'R1.SG-Q7-0001.9999999999.AAAAAAAAAAAAAAAAAAAAAA' } });
  assert.equal(bad.body.outcome, 'invalid');
  const cart = await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: 'GH-Q7-0001' } });
  assert.equal(cart.body.outcome, 'not_receipt');
  await app.close();
});

test('chuyển khoản QR: có payload VietQR, phải tick đủ 3 điều kiện', async () => {
  const app = await makeApp();
  const { id } = await newCart(app, [['MI01', 3]]);
  const lock = await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'qr_transfer' } });
  const tx = lock.body.transaction;
  assert.equal(tx.transfer.amount, 14400);
  assert.match(tx.transfer.payload, /^000201010212.*5303704540514400.*6304[0-9A-F]{4}$/);
  assert.equal(tx.transfer.content, tx.transferContent);
  const staff = await staffLogin(app);
  await call(app, 'POST', '/api/s/shifts/start', { token: staff, body: { kind: 'sang' } });
  let c = await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'qr_transfer', confirm: { amount: true, content: true, received: false } } });
  assert.equal(c.body.error, 'CONFIRM_REQUIRED');
  c = await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'qr_transfer', confirm: { amount: true, content: true, received: true } } });
  assert.equal(c.status, 200);
  await app.close();
});

test('giá đổi giữa lúc quét và khoá giỏ: phải báo và khách đồng ý', async () => {
  const app = await makeApp();
  const { id } = await newCart(app, [['TRU01', 1], ['NUOC01', 2]]);
  app.ctx.db.prepare(`UPDATE pos_products SET price = 41000 WHERE store_id='Q7' AND sku='TRU01'`).run();
  app.ctx.db.prepare(`UPDATE pos_products SET stock = 1 WHERE store_id='Q7' AND sku='NUOC01'`).run();
  const r = await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'CHANGED');
  assert.deepEqual(r.body.changes.map((x) => x.type).sort(), ['price', 'stock']);
  const ok = await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash', acceptChanges: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.session.items.find((i) => i.sku === 'TRU01').price, 41000);
  assert.equal(ok.body.session.items.find((i) => i.sku === 'NUOC01').qty, 1);
  await app.close();
});

test('sửa giỏ sau khi khoá bị chặn; mở khoá thì sửa được', async () => {
  const app = await makeApp();
  const { id } = await newCart(app, [['MI01', 1]]);
  await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash' } });
  let r = await call(app, 'POST', `/api/c/sessions/${id}/ops`, { body: { ops: [{ id: 'x1', type: 'scan', barcode: barcodeOf(app, 'Q7', 'MI01') }] } });
  assert.equal(r.body.error, 'SESSION_LOCKED');
  r = await call(app, 'POST', `/api/c/sessions/${id}/unlock`);
  assert.equal(r.status, 200);
  assert.equal(r.body.session.status, 'active');
  await app.close();
});

test('kiểm tra ngẫu nhiên: khớp thì cho qua, lệch thì thu bổ sung rồi mới qua', async () => {
  const app = await makeApp({ rng: () => 0 }); // luôn bị chọn kiểm tra
  const { id } = await newCart(app, [['MI01', 2]]);
  const lock = await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash' } });
  const tx = lock.body.transaction;
  assert.equal(tx.checkRequired, true);
  const staff = await staffLogin(app);
  await call(app, 'POST', '/api/s/shifts/start', { token: staff, body: { kind: 'sang' } });
  await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 50000 } });
  const receipt = (await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction.receipt.token;

  const gate = await staffLogin(app, 'NV0157', '2222');
  const g = await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: receipt } });
  assert.equal(g.body.outcome, 'check_required');
  assert.equal((await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction.exitStatus, 'checking');

  // Chênh lệch: yêu cầu thu thêm
  let c = await call(app, 'POST', '/api/s/checks', { token: gate, body: { transactionId: tx.id, result: 'mismatch', action: 'collect_extra', amount: 20000, kind: 'missing_scan', note: 'Quên quét 1 món' } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  let g2 = await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: receipt } });
  assert.equal(g2.body.outcome, 'extra_due');
  assert.equal(g2.body.amount, 20000);
  // Người có quyền thu ngân thu bổ sung
  const extra = await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 20000 } });
  assert.equal(extra.status, 200, JSON.stringify(extra.body));
  assert.equal(extra.body.kind, 'extra');
  g2 = await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: receipt } });
  assert.equal(g2.body.outcome, 'valid');
  await app.close();
});

test('kiểm tra ngẫu nhiên: gọi quản lý, giữ khách; quản lý duyệt thì qua; nhân viên thường không duyệt được', async () => {
  const app = await makeApp({ rng: () => 0 });
  const { id } = await newCart(app, [['MI01', 1]]);
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash' } })).body.transaction;
  const staff = await staffLogin(app);
  await call(app, 'POST', '/api/s/shifts/start', { token: staff, body: { kind: 'sang' } });
  await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 10000 } });
  const receipt = (await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction.receipt.token;
  const gate = await staffLogin(app, 'NV0157', '2222');
  await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: receipt } });
  await call(app, 'POST', '/api/s/checks', { token: gate, body: { transactionId: tx.id, result: 'mismatch', action: 'call_manager', note: 'Khách từ chối' } });
  assert.equal((await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: receipt } })).body.outcome, 'held');
  const no = await call(app, 'POST', `/api/s/transactions/${tx.id}/resolve`, { token: gate, body: { decision: 'allow' } });
  assert.equal(no.status, 403);
  const mgr = await staffLogin(app, 'QT0007', '2345');
  const yes = await call(app, 'POST', `/api/s/transactions/${tx.id}/resolve`, { token: mgr, body: { decision: 'allow', note: 'Đã kiểm tra' } });
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  assert.equal(yes.body.exited, true);
  await app.close();
});

test('huỷ giao dịch đã thu: chỉ quản lý, cần lý do, QR trở nên vô hiệu', async () => {
  const app = await makeApp();
  const { id } = await newCart(app, [['MI01', 1]]);
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash' } })).body.transaction;
  const staff = await staffLogin(app);
  await call(app, 'POST', '/api/s/shifts/start', { token: staff, body: { kind: 'sang' } });
  await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 10000 } });
  const receipt = (await call(app, 'GET', `/api/c/sessions/${id}`)).body.session.transaction.receipt.token;
  const admin = (await call(app, 'POST', '/api/a/login', { body: { account: 'QT0007', password: 'Admin@123' } })).body.token;
  assert.equal((await call(app, 'POST', `/api/a/transactions/${tx.id}/void`, { token: admin, body: {} })).body.error, 'REASON_REQUIRED');
  assert.equal((await call(app, 'POST', `/api/a/transactions/${tx.id}/void`, { token: admin, body: { reason: 'Bấm nhầm' } })).status, 200);
  const gate = await staffLogin(app, 'NV0157', '2222');
  assert.equal((await call(app, 'POST', '/api/s/gate/scan', { token: gate, body: { raw: receipt } })).body.outcome, 'invalid');
  await app.close();
});

test('kết thúc ca: tiền mặt lệch bắt buộc ghi lý do', async () => {
  const app = await makeApp();
  const { id } = await newCart(app, [['DAU01', 1]]);
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash' } })).body.transaction;
  const staff = await staffLogin(app);
  await call(app, 'POST', '/api/s/shifts/start', { token: staff, body: { kind: 'sang' } });
  await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 100000 } });
  const cur = await call(app, 'GET', '/api/s/shifts/current', { token: staff });
  assert.equal(cur.body.shift.stats.cash, 52000);
  let r = await call(app, 'POST', '/api/s/shifts/end', { token: staff, body: { countedCash: 50000 } });
  assert.equal(r.body.error, 'NOTE_REQUIRED');
  r = await call(app, 'POST', '/api/s/shifts/end', { token: staff, body: { countedCash: 50000, note: 'Thối nhầm 2.000đ' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.shift.diff, -2000);
  await app.close();
});

test('chi nhánh chưa bật không tạo được phiên', async () => {
  const app = await makeApp();
  const r = await call(app, 'POST', '/api/c/sessions', { body: { storeId: 'GV' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'STORE_DISABLED');
  await app.close();
});

test('hoá đơn công ty: kiểm tra mã số thuế và email, thay hoá đơn bán lẻ', async () => {
  const app = await makeApp();
  const { id } = await newCart(app, [['DAU01', 1]]);
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash' } })).body.transaction;
  const staff = await staffLogin(app);
  await call(app, 'POST', '/api/s/shifts/start', { token: staff, body: { kind: 'sang' } });
  await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 100000 } });
  const bad = await call(app, 'POST', `/api/c/transactions/${tx.id}/invoice`, { body: { email: 'a@b.vn', company: { taxCode: '123', name: 'X', address: 'Y' } } });
  assert.equal(bad.body.error, 'BAD_TAX_CODE');
  const ok = await call(app, 'POST', `/api/c/transactions/${tx.id}/invoice`, { body: { email: 'ketoan@congty.vn', company: { taxCode: '0312345678', name: 'Công ty TNHH Ánh Dương', address: 'Quận 7' } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.transaction.invoice.type, 'company');
  const rows = app.ctx.db.prepare('SELECT type,status FROM invoices WHERE transaction_id=? ORDER BY id').all(tx.id);
  assert.deepEqual(rows.map((r) => `${r.type}:${r.status}`), ['retail:replaced', 'company:issued']);
  await app.close();
});

test('hoá đơn lỗi thì để pending và thử lại được', async () => {
  const app = await makeApp();
  const { setSetting } = await import('../server/db.js');
  setSetting(app.ctx.db, 'einvoice', { failNext: true });
  const { id } = await newCart(app, [['DAU01', 1]]);
  const tx = (await call(app, 'POST', `/api/c/sessions/${id}/lock`, { body: { method: 'cash' } })).body.transaction;
  const staff = await staffLogin(app);
  await call(app, 'POST', '/api/s/shifts/start', { token: staff, body: { kind: 'sang' } });
  const c = await call(app, 'POST', `/api/s/carts/${tx.id}/collect`, { token: staff, body: { method: 'cash', cashReceived: 100000 } });
  assert.equal(c.status, 200, 'thu tiền vẫn thành công dù hoá đơn lỗi');
  assert.equal(c.body.transaction.invoice.status, 'pending');
  const admin = (await call(app, 'POST', '/api/a/login', { body: { account: 'QT0001', password: 'Admin@123' } })).body.token;
  const r = await call(app, 'POST', '/api/a/integrations/invoices/retry', { token: admin });
  assert.equal(r.body.issued, 1);
  await app.close();
});
