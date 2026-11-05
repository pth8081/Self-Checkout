import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, adminLogin } from './helpers.js';
import { totpNow } from '../server/services/totp.js';
import { vietQrPayload, crc16 } from '../server/services/qr.js';

test('đăng nhập quản trị: sai mật khẩu, khoá tạm sau 5 lần, nhân viên không vào được', async () => {
  const app = await makeApp();
  assert.equal((await adminLogin(app, 'NV0142', 'x')).status, 401);
  assert.equal((await adminLogin(app, 'QT0001', 'sai')).body.error, 'BAD_LOGIN');
  for (let i = 0; i < 4; i++) await adminLogin(app, 'QT0001', 'sai');
  const locked = await adminLogin(app, 'QT0001', 'Admin@123');
  assert.equal(locked.body.error, 'LOCKED');
  await app.close();
});

test('xác thực 2 bước: bật rồi phải nhập mã mới đăng nhập được', async () => {
  const app = await makeApp();
  const token = (await adminLogin(app)).body.token;
  const on = await call(app, 'POST', '/api/a/users/QT0001/totp', { token, body: { enable: true } });
  assert.equal(on.status, 200);
  const need = await adminLogin(app);
  assert.equal(need.body.error, 'TOTP_REQUIRED');
  assert.equal((await adminLogin(app, 'QT0001', 'Admin@123', '000000')).body.error, 'BAD_TOTP');
  const ok = await adminLogin(app, 'QT0001', 'Admin@123', totpNow(on.body.secret));
  assert.equal(ok.status, 200);
  await app.close();
});

test('quản trị chi nhánh bị giới hạn ở chi nhánh của mình', async () => {
  const app = await makeApp();
  const q7 = (await adminLogin(app, 'QT0007')).body.token;
  assert.equal((await call(app, 'GET', '/api/a/overview', { token: q7 })).status, 403);
  const t = await call(app, 'GET', '/api/a/today?storeId=TD', { token: q7 });
  assert.equal(t.body.storeId, 'Q7', 'tham số storeId bị bỏ qua, vẫn là chi nhánh của mình');
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7', { token: q7, body: { enabled: false } })).status, 403);
  assert.equal((await call(app, 'PUT', '/api/a/stores/TD/config', { token: q7, body: { randomCheckRate: 0.5 } })).status, 403);
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7/config', { token: q7, body: { payCash: false } })).status, 403);
  const ok = await call(app, 'PUT', '/api/a/stores/Q7/config', { token: q7, body: { randomCheckRate: 0.3 } });
  assert.equal(ok.body.store.config.randomCheckRate, 0.3);
  await app.close();
});

test('cấu hình: không bật được thanh toán online, QR nhà cung cấp, tỷ lệ sai', async () => {
  const app = await makeApp();
  const t = (await adminLogin(app)).body.token;
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7/config', { token: t, body: { payOnline: true } })).body.error, 'NOT_AVAILABLE');
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7/config', { token: t, body: { qrProvider: 'provider' } })).body.error, 'NOT_CONFIGURED');
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7/config', { token: t, body: { randomCheckRate: 1.5 } })).body.error, 'BAD_RATE');
  assert.equal((await call(app, 'PUT', '/api/a/stores/Q7/config', { token: t, body: { bank: { bin: '12' } } })).body.error, 'BAD_BIN');
  await app.close();
});

test('tạo chi nhánh, chỉ bật được khi có sản phẩm và cách thanh toán', async () => {
  const app = await makeApp();
  const t = (await adminLogin(app)).body.token;
  assert.equal((await call(app, 'POST', '/api/a/stores', { token: t, body: { id: 'XX', name: 'Chi nhánh X' } })).status, 200);
  assert.equal((await call(app, 'PUT', '/api/a/stores/XX', { token: t, body: { enabled: true } })).body.error, 'NO_PRODUCTS');
  await app.close();
});

test('tài khoản: tạo nhân viên, trùng mã, PIN yếu, branch admin không tạo được quản trị', async () => {
  const app = await makeApp();
  const chain = (await adminLogin(app)).body.token;
  const q7 = (await adminLogin(app, 'QT0007')).body.token;
  const mk = (token, body) => call(app, 'POST', '/api/a/users', { token, body });
  assert.equal((await mk(q7, { name: 'An', role: 'cashier', pin: '12' })).body.error, 'BAD_PIN');
  const ok = await mk(q7, { name: 'An', role: 'cashier', pin: '123456' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.storeId, 'Q7');
  assert.equal((await mk(q7, { name: 'B', role: 'branch_admin', pin: '1234', password: 'Abcdef12' })).status, 403);
  assert.equal((await mk(chain, { name: 'C', role: 'branch_admin', storeId: 'TB', pin: '1234', password: 'short' })).body.error, 'WEAK_PASSWORD');
  assert.equal((await mk(chain, { id: 'NV0142', name: 'D', role: 'gate', storeId: 'Q7', pin: '1234' })).body.error, 'DUPLICATE');
  const login = await call(app, 'POST', '/api/s/login', { body: { code: ok.body.user.id, pin: '123456' } });
  assert.equal(login.status, 200);
  await app.close();
});

test('báo cáo, CSV và đối soát sao kê', async () => {
  const app = await makeApp({ demo: true });
  const t = (await adminLogin(app)).body.token;
  const ov = await call(app, 'GET', '/api/a/overview', { token: t });
  assert.equal(ov.status, 200);
  assert.equal(ov.body.revenue7.length, 7);
  assert.equal(ov.body.stores.length, 5);
  const rep = await call(app, 'GET', '/api/a/reports', { token: t });
  assert.ok(rep.body.totals.tx > 100, 'có dữ liệu mẫu 6 ngày');
  assert.equal(rep.body.rows.reduce((a, r) => a + r.revenue, 0), rep.body.totals.revenue);
  const csv = await call(app, 'GET', '/api/a/reports.csv', { token: t });
  assert.match(csv.raw.headers['content-type'], /text\/csv/);
  assert.ok(csv.raw.body.startsWith('﻿Ngày,'));

  const day = rep.body.rows.find((r) => r.transfer > 0).date;
  const tf = app.ctx.db.prepare(`SELECT p.amount, t.transfer_content c FROM payments p JOIN transactions t ON t.id=p.transaction_id WHERE p.store_id='Q7' AND p.method='qr_transfer' AND date(p.collected_at,'+7 hours')=?`).all(day);
  const lines = tf.slice(1).map((x) => ({ amount: x.amount, content: `CK ${x.c} CAM ON` }));
  lines.push({ amount: 99000, content: 'KHONG RO' });
  const rc = await call(app, 'POST', '/api/a/reconcile/statement', { token: t, body: { storeId: 'Q7', date: day, lines } });
  assert.equal(rc.status, 200, JSON.stringify(rc.body));
  assert.equal(rc.body.transfer.statement.onlySystem.length, tf.length ? 1 : 0);
  assert.equal(rc.body.transfer.statement.onlyStatement.length, 1);
  await app.close();
});

test('kế hoạch ca cảnh báo ca thiếu người', async () => {
  const app = await makeApp();
  const t = (await adminLogin(app, 'QT0007')).body.token;
  const p = await call(app, 'GET', '/api/a/plans', { token: t });
  assert.equal(p.body.days.length, 7);
  assert.ok(Array.isArray(p.body.warnings));
  const day = p.body.days[6];
  const put = await call(app, 'PUT', '/api/a/plans', { token: t, body: { staffId: 'NV0160', date: day, kind: 'chieu' } });
  assert.equal(put.status, 200);
  await app.close();
});

test('mã VietQR có CRC đúng và nội dung không dấu', () => {
  const p = vietQrPayload({ bin: '970436', account: '0123456789', amount: 182000, content: 'SG Q7 0384' });
  assert.ok(p.includes('5406182000'));
  assert.ok(p.includes('0810SG Q7 0384'));
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
  // Giá trị CRC chuẩn của chuỗi kiểm thử "123456789" theo CRC-16/CCITT-FALSE là 29B1.
  assert.equal(crc16('123456789'), '29B1');
});

test('xác nhận email để xem lịch sử trên máy khác', async () => {
  const app = await makeApp();
  const r = await call(app, 'POST', '/api/c/identity/request', { body: { email: 'khach@example.com' } });
  assert.match(r.body.devCode, /^\d{6}$/);
  assert.equal((await call(app, 'POST', '/api/c/identity/verify', { body: { email: 'khach@example.com', code: '000000' } })).body.error, 'CODE_WRONG');
  const ok = await call(app, 'POST', '/api/c/identity/verify', { body: { email: 'khach@example.com', code: r.body.devCode } });
  assert.equal(ok.body.linked, true);
  await app.close();
});

test('tìm giao dịch theo mã giỏ hàng; tạo quản trị không cần PIN', async () => {
  const app = await makeApp({ demo: true });
  const t = (await adminLogin(app)).body.token;
  const r = await call(app, 'GET', '/api/a/transactions?storeId=Q7&q=GH-Q7-D60001', { token: t });
  assert.ok(r.body.transactions.length >= 1);
  const u = await call(app, 'POST', '/api/a/users', { token: t, body: { name: 'Quản lý mới', role: 'branch_admin', storeId: 'TB', password: 'Matkhau123' } });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  await app.close();
});
