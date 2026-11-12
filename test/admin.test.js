import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, adminLogin } from './helpers.js';
import { totpNow } from '../server/services/totp.js';
import { vietQrPayload, crc16 } from '../server/services/qr.js';

test('đăng nhập quản trị: sai mật khẩu, khóa tạm sau 5 lần, nhân viên không vào được', async () => {
  const app = await makeApp();
  assert.equal((await adminLogin(app, 'NV0142', 'x')).status, 401);
  assert.equal((await adminLogin(app, 'QT0001', 'sai')).body.error, 'BAD_LOGIN');
  for (let i = 0; i < 4; i++) await adminLogin(app, 'QT0001', 'sai');
  const locked = await adminLogin(app, 'QT0001', 'Admin@123');
  assert.equal(locked.body.error, 'LOCKED');
  await app.close();
});

test('xác thực 2 bước: bật (2 bước có xác nhận) rồi phải nhập mã mới đăng nhập được', async () => {
  const app = await makeApp();
  const token = (await adminLogin(app)).body.token;
  const on = await call(app, 'POST', '/api/a/users/QT0001/totp/begin', { token, body: {} });
  assert.equal(on.status, 200);
  assert.equal((await call(app, 'POST', '/api/a/users/QT0001/totp/confirm', { token, body: { confirmToken: on.body.confirmToken, code: '000000' } })).body.error, 'BAD_TOTP');
  app.ctx.db.prepare('UPDATE staff SET totp_last = NULL').run(); // các thử nghiệm dùng lại mã trong cùng 30 giây: bỏ qua chống dùng lại (kiểm thử riêng bên dưới)
  assert.equal((await call(app, 'POST', '/api/a/users/QT0001/totp/confirm', { token, body: { confirmToken: on.body.confirmToken, code: totpNow(on.body.secret) } })).status, 200);
  const need = await adminLogin(app);
  assert.equal(need.body.totpRequired, true);
  assert.ok(need.body.stepToken && !need.body.token);
  assert.equal((await adminLogin(app, 'QT0001', 'Admin@123', '000000')).body.error, 'BAD_TOTP');
  assert.equal((await call(app, 'POST', '/api/a/login/totp', { body: { stepToken: need.body.stepToken, code: '000000' } })).body.error, 'BAD_TOTP');
  app.ctx.db.prepare('UPDATE staff SET totp_last = NULL').run(); // các thử nghiệm dùng lại mã trong cùng 30 giây: bỏ qua chống dùng lại (kiểm thử riêng bên dưới)
  const step2 = await call(app, 'POST', '/api/a/login/totp', { body: { stepToken: need.body.stepToken, code: totpNow(on.body.secret) } });
  assert.equal(step2.status, 200); assert.ok(step2.body.token);
  app.ctx.db.prepare('UPDATE staff SET totp_last = NULL').run(); // các thử nghiệm dùng lại mã trong cùng 30 giây: bỏ qua chống dùng lại (kiểm thử riêng bên dưới)
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

test('mã điểm của chi nhánh: nhập, không trùng, chỉ quản trị chuỗi đổi', async () => {
  const app = await makeApp();
  const chain = (await adminLogin(app)).body.token;
  const q7 = (await adminLogin(app, 'QT0007')).body.token;
  let r = await call(app, 'PUT', '/api/a/stores/Q7', { token: chain, body: { posCode: 'SP-0107' } });
  assert.equal(r.body.store.posCode, 'SP-0107');
  r = await call(app, 'PUT', '/api/a/stores/Q1', { token: chain, body: { posCode: 'sp-0107' } });
  assert.equal(r.status, 409);
  r = await call(app, 'PUT', '/api/a/stores/Q7', { token: chain, body: { posCode: 'có dấu' } });
  assert.equal(r.status, 400);
  r = await call(app, 'PUT', '/api/a/stores/Q7', { token: q7, body: { posCode: 'X1' } });
  assert.equal(r.status, 403);
  r = await call(app, 'POST', '/api/a/stores', { token: chain, body: { id: 'NEW1', name: 'Mới', posCode: 'SP-9' } });
  assert.equal(r.body.store.posCode, 'SP-9');
  const i = await call(app, 'GET', '/api/a/integrations', { token: chain });
  assert.equal(i.body.pos.stores.find((s) => s.id === 'Q7').posCode, 'SP-0107');
  await app.close();
});

test('tên đăng nhập kiểu AD (anh.dp): đặt được, đăng nhập bằng tên, mã hoặc email; trùng và sai định dạng bị từ chối; chỉ quản trị chuỗi đổi', async () => {
  const app = await makeApp();
  const admin = (await adminLogin(app)).body.token;
  const mk = (extra) => call(app, 'POST', '/api/a/users', { token: admin, body: { role: 'chain_admin', name: 'Anh DP', password: 'Matkhau123', pin: '1234', ...extra } });
  assert.equal((await mk({ username: 'Anh DP' })).body.error, 'BAD_USERNAME');
  const ok = await mk({ username: 'Anh.DP', email: 'anh@congty.vn' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.user.username, 'anh.dp');
  const id = ok.body.user.id;
  for (const acct of ['anh.dp', 'ANH.DP', id, 'anh@congty.vn']) assert.equal((await call(app, 'POST', '/api/a/login', { body: { account: acct, password: 'Matkhau123' } })).status, 200, acct);
  assert.equal((await mk({ username: 'anh.dp' })).body.error, 'USERNAME_TAKEN');
  assert.equal((await mk({ username: id.toLowerCase() })).body.error, 'USERNAME_TAKEN');
  const ch = await call(app, 'PUT', `/api/a/users/${id}`, { token: admin, body: { username: 'dp.anh' } });
  assert.equal(ch.body.user.username, 'dp.anh');
  assert.equal((await call(app, 'POST', '/api/a/login', { body: { account: 'anh.dp', password: 'Matkhau123' } })).status, 401);
  assert.equal((await call(app, 'PUT', `/api/a/users/${id}`, { token: admin, body: { username: '' } })).body.user.username, null);
  await app.close();
});

test('bắt buộc xác thực 2 bước: đăng nhập lần đầu phải thiết lập, sai mã không vào được, lần sau cần mã, không tắt được', async () => {
  process.env.REQUIRE_ADMIN_2FA = '1';
  try {
    const app = await makeApp();
    const first = await call(app, 'POST', '/api/a/login', { body: { account: 'QT0001', password: 'Admin@123' } });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.mfaSetup, true);
    assert.ok(first.body.secret && first.body.uri.startsWith('otpauth://') && first.body.confirmToken);
    assert.equal(first.body.token, undefined); // chưa có phiên đăng nhập
    const bad = await call(app, 'POST', '/api/a/login/2fa-confirm', { body: { confirmToken: first.body.confirmToken, code: '000000' } });
    assert.equal(bad.body.error, 'BAD_TOTP');
    assert.equal((await call(app, 'POST', '/api/a/login/2fa-confirm', { body: { confirmToken: 'rac', code: '123456' } })).status, 401);
    app.ctx.db.prepare('UPDATE staff SET totp_last = NULL').run(); // các thử nghiệm dùng lại mã trong cùng 30 giây: bỏ qua chống dùng lại (kiểm thử riêng bên dưới)
    const ok = await call(app, 'POST', '/api/a/login/2fa-confirm', { body: { confirmToken: first.body.confirmToken, code: totpNow(first.body.secret) } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.token);
    // lần sau: cần mã
    const next = await call(app, 'POST', '/api/a/login', { body: { account: 'QT0001', password: 'Admin@123' } });
    assert.equal(next.body.totpRequired, true);
    app.ctx.db.prepare('UPDATE staff SET totp_last = NULL').run(); // các thử nghiệm dùng lại mã trong cùng 30 giây: bỏ qua chống dùng lại (kiểm thử riêng bên dưới)
    const in2 = await call(app, 'POST', '/api/a/login', { body: { account: 'QT0001', password: 'Admin@123', totp: totpNow(first.body.secret) } });
    assert.equal(in2.status, 200);
    // không tắt được; xác nhận lại với mã thiết lập cũ thì báo đã bật
    const off = await call(app, 'POST', '/api/a/users/QT0001/totp', { token: in2.body.token, body: { enable: false } });
    assert.equal(off.body.error, 'TOTP_REQUIRED');
    app.ctx.db.prepare('UPDATE staff SET totp_last = NULL').run(); // các thử nghiệm dùng lại mã trong cùng 30 giây: bỏ qua chống dùng lại (kiểm thử riêng bên dưới)
    assert.equal((await call(app, 'POST', '/api/a/login/2fa-confirm', { body: { confirmToken: first.body.confirmToken, code: totpNow(first.body.secret) } })).body.error, 'ALREADY_2FA');
    await app.close();
  } finally { process.env.REQUIRE_ADMIN_2FA = '0'; }
});

test('chi nhánh: tải file mẫu, xuất file, nhập file (xem trước rồi áp dụng), dòng sai và mã điểm trùng bị chặn, chỉ quản trị chuỗi', async () => {
  const app = await makeApp();
  const admin = (await adminLogin(app)).body.token;
  const tpl = await call(app, 'GET', '/api/a/stores/template', { token: admin });
  assert.equal(tpl.status, 200);
  assert.match(tpl.body.csv, /Mã chi nhánh,Tên chi nhánh,Địa chỉ,Mã điểm/);
  const exp = await call(app, 'GET', '/api/a/stores/export', { token: admin });
  assert.match(exp.body.csv, /Q7,/);
  // file mẫu nhập lại được
  const pv0 = await call(app, 'POST', '/api/a/stores/import/preview', { token: admin, body: { text: tpl.body.csv } });
  assert.equal(pv0.status, 200, JSON.stringify(pv0.body));
  const csv = ['Mã chi nhánh;Tên chi nhánh;Địa chỉ;Mã điểm', 'ZZ1;Chi nhánh Z1;1 Đường A;SP-ZZ1', 'zz2;Chi nhánh Z2;;SP-ZZ2', 'ZZ3;;;', 'Q7;Quận 7 mới;;', 'ZZ1;Lặp;;', 'ZZ4;Chi nhánh Z4;;SP-ZZ1', 'ABCDEFGH;Dài;;'].join('\n');
  const pv = await call(app, 'POST', '/api/a/stores/import/preview', { token: admin, body: { text: csv } });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  const st = Object.fromEntries(pv.body.rows.map((r) => [r.line, r.status]));
  assert.deepEqual([st[2], st[3], st[4], st[5], st[6], st[7], st[8]], ['new', 'new', 'bad', 'update', 'dup', 'clash', 'bad']);
  const ap = await call(app, 'POST', '/api/a/stores/import/apply', { token: admin, body: { text: csv } });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.equal(ap.body.created, 2); assert.equal(ap.body.updated, 1);
  const list = (await call(app, 'GET', '/api/a/stores', { token: admin })).body.stores;
  const zz1 = list.find((s) => s.id === 'ZZ1');
  assert.ok(zz1 && zz1.enabled === false && zz1.posCode === 'SP-ZZ1');
  assert.equal(list.find((s) => s.id === 'Q7').name, 'Quận 7 mới');
  assert.equal((await call(app, 'POST', '/api/a/stores/import/preview', { token: admin, body: { text: 'a,b\n1,2' } })).body.error, 'BAD_FILE');
  const exp2 = await call(app, 'GET', '/api/a/stores/export', { token: admin });
  assert.match(exp2.body.csv, /ZZ2,Chi nhánh Z2/);
  await app.close();
});

test('mã hình 4 số (captcha): bắt buộc, dùng một lần, sai thì không thử được mật khẩu; tắt được bằng chính sách', async () => {
  process.env.REQUIRE_CAPTCHA = '1';
  try {
    const app = await makeApp();
    const { checkCaptcha } = await import('../server/services/captcha.js');
    const cap = await call(app, 'GET', '/api/a/captcha');
    assert.equal(cap.status, 200);
    assert.match(cap.body.svg, /^<svg/);
    assert.ok(cap.body.id);
    const body = { account: 'QT0001', password: 'Admin@123' };
    assert.equal((await call(app, 'POST', '/api/a/login', { body })).body.error, 'BAD_CAPTCHA'); // thiếu mã hình
    assert.equal((await call(app, 'POST', '/api/a/login', { body: { ...body, captchaId: cap.body.id, captcha: 'abcd' } })).body.error, 'BAD_CAPTCHA');
    // đáp án chỉ nằm trong mã ký dưới dạng băm có khóa: dò bằng khóa máy chủ để lấy đáp án cho kiểm thử
    const { newCaptcha } = await import('../server/services/captcha.js');
    const known = newCaptcha();
    const crypto = await import('node:crypto');
    const { config } = await import('../server/config.js');
    const payload = JSON.parse(Buffer.from(known.id.split('.')[0], 'base64url').toString());
    let answer = null;
    for (let n = 0; n < 10000; n++) { const code = String(n).padStart(4, '0'); if (crypto.createHmac('sha256', config.secret).update(`captcha:${payload.n}:${code}`).digest('hex') === payload.h) { answer = code; break; } }
    assert.ok(answer);
    const good = await call(app, 'POST', '/api/a/login', { body: { ...body, captchaId: known.id, captcha: answer } });
    assert.equal(good.status, 200, JSON.stringify(good.body));
    assert.equal(checkCaptcha(known.id, answer), false); // dùng một lần
    assert.equal((await call(app, 'POST', '/api/a/login', { body: { ...body, captchaId: known.id, captcha: answer } })).body.error, 'BAD_CAPTCHA');
    // quản trị chuỗi tắt yêu cầu mã hình
    const tok = good.body.token;
    assert.equal((await call(app, 'PUT', '/api/a/security', { token: tok, body: { requireCaptcha: false } })).body.policy.requireCaptcha, false);
    assert.equal((await call(app, 'POST', '/api/a/login', { body })).status, 200);
    await app.close();
  } finally { process.env.REQUIRE_CAPTCHA = '0'; }
});

test('đổi và gỡ xác thực 2 bước: chính chủ phải nhập mã hiện tại; đang bắt buộc thì không gỡ được cho tới khi tắt chính sách', async () => {
  const app = await makeApp();
  const t = (await adminLogin(app)).body.token;
  const enroll = async (token, extra = {}) => {
    const b = await call(app, 'POST', '/api/a/users/QT0001/totp/begin', { token, body: extra });
    if (b.status !== 200) return b;
    const { secret, confirmToken } = b.body;
    app.ctx.db.prepare('UPDATE staff SET totp_last = NULL').run(); // các thử nghiệm dùng lại mã trong cùng 30 giây: bỏ qua chống dùng lại (kiểm thử riêng bên dưới)
    const c = await call(app, 'POST', '/api/a/users/QT0001/totp/confirm', { token, body: { confirmToken, code: totpNow(secret) } });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    return { status: 200, secret };
  };
  const first = await enroll(t);
  // đổi thiết bị: thiếu hoặc sai mã hiện tại thì từ chối
  assert.equal((await call(app, 'POST', '/api/a/users/QT0001/totp/begin', { token: t, body: {} })).body.error, 'BAD_TOTP');
  assert.equal((await call(app, 'POST', '/api/a/users/QT0001/totp/begin', { token: t, body: { currentCode: '000000' } })).body.error, 'BAD_TOTP');
  app.ctx.db.prepare('UPDATE staff SET totp_last = NULL').run(); // các thử nghiệm dùng lại mã trong cùng 30 giây: bỏ qua chống dùng lại (kiểm thử riêng bên dưới)
  const second = await enroll(t, { currentCode: totpNow(first.secret) });
  assert.notEqual(second.secret, first.secret);
  // mã của thiết bị cũ không còn dùng được
  app.ctx.db.prepare('UPDATE staff SET totp_last = NULL').run(); // các thử nghiệm dùng lại mã trong cùng 30 giây: bỏ qua chống dùng lại (kiểm thử riêng bên dưới)
  assert.equal((await adminLogin(app, 'QT0001', 'Admin@123', totpNow(first.secret))).body.error, 'BAD_TOTP');
  app.ctx.db.prepare('UPDATE staff SET totp_last = NULL').run(); // các thử nghiệm dùng lại mã trong cùng 30 giây: bỏ qua chống dùng lại (kiểm thử riêng bên dưới)
  assert.equal((await adminLogin(app, 'QT0001', 'Admin@123', totpNow(second.secret))).status, 200);
  // chính sách đang bắt buộc thì không gỡ được
  assert.equal((await call(app, 'PUT', '/api/a/security', { token: t, body: { require2fa: true } })).body.policy.require2fa, true);
  app.ctx.db.prepare('UPDATE staff SET totp_last = NULL').run(); // các thử nghiệm dùng lại mã trong cùng 30 giây: bỏ qua chống dùng lại (kiểm thử riêng bên dưới)
  assert.equal((await call(app, 'POST', '/api/a/users/QT0001/totp', { token: t, body: { enable: false, code: totpNow(second.secret) } })).body.error, 'TOTP_REQUIRED');
  await call(app, 'PUT', '/api/a/security', { token: t, body: { require2fa: false } });
  assert.equal((await call(app, 'POST', '/api/a/users/QT0001/totp', { token: t, body: { enable: false } })).body.error, 'BAD_TOTP'); // chính chủ cần mã
  app.ctx.db.prepare('UPDATE staff SET totp_last = NULL').run(); // các thử nghiệm dùng lại mã trong cùng 30 giây: bỏ qua chống dùng lại (kiểm thử riêng bên dưới)
  assert.equal((await call(app, 'POST', '/api/a/users/QT0001/totp', { token: t, body: { enable: false, code: totpNow(second.secret) } })).body.enabled, false);
  assert.equal((await adminLogin(app)).status, 200);
  assert.equal((await call(app, 'PUT', '/api/a/security', { token: (await adminLogin(app, 'QT0007')).body.token, body: { require2fa: true } })).status, 403);
  await app.close();
});

test('một phiên đăng nhập tại một thời điểm: đăng nhập lần hai phải xác nhận, xác nhận thì phiên cũ bị đăng xuất; đăng xuất, quá hạn nhàn rỗi và tắt chính sách thì không hỏi', async () => {
  process.env.SINGLE_SESSION = '1';
  try {
    const app = await makeApp();
    const A = await adminLogin(app);
    assert.equal(A.status, 200); const tokA = A.body.token;
    assert.equal((await call(app, 'GET', '/api/a/overview', { token: tokA })).status, 200);
    // thiết bị thứ hai: chưa được cấp phiên, phải xác nhận
    const B = await call(app, 'POST', '/api/a/login', { body: { account: 'QT0001', password: 'Admin@123' }, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36' } });
    assert.equal(B.status, 200, JSON.stringify(B.body));
    assert.equal(B.body.sessionConflict, true);
    assert.ok(B.body.takeoverToken && !B.body.token);
    assert.ok(B.body.other.device);
    assert.equal((await call(app, 'GET', '/api/a/overview', { token: tokA })).status, 200); // phiên cũ vẫn dùng được cho tới khi xác nhận
    assert.equal((await call(app, 'POST', '/api/a/login/takeover', { body: { takeoverToken: 'rac' } })).status, 401);
    const T = await call(app, 'POST', '/api/a/login/takeover', { body: { takeoverToken: B.body.takeoverToken } });
    assert.equal(T.status, 200, JSON.stringify(T.body)); const tokB = T.body.token;
    assert.ok(tokB);
    assert.equal((await call(app, 'POST', '/api/a/login/takeover', { body: { takeoverToken: B.body.takeoverToken } })).status, 401); // dùng một lần
    const old = await call(app, 'GET', '/api/a/overview', { token: tokA });
    assert.equal(old.status, 401); assert.equal(old.body.error, 'SESSION_REPLACED');
    assert.equal((await call(app, 'GET', '/api/a/overview', { token: tokB })).status, 200);
    // đăng xuất chủ động thì lần sau vào thẳng
    assert.equal((await call(app, 'POST', '/api/a/logout', { token: tokB })).status, 200);
    const C = await adminLogin(app); assert.ok(C.body.token && !C.body.sessionConflict);
    // phiên nhàn rỗi quá hạn thì không hỏi
    app.ctx.db.prepare("UPDATE staff SET session_seen = '2020-01-01T00:00:00.000Z' WHERE id = 'QT0001'").run();
    const D = await adminLogin(app); assert.ok(D.body.token && !D.body.sessionConflict);
    // tắt chính sách thì nhiều thiết bị cùng vào được
    await call(app, 'PUT', '/api/a/security', { token: D.body.token, body: { singleSession: false } });
    const E = await adminLogin(app); assert.ok(E.body.token);
    assert.equal((await call(app, 'GET', '/api/a/overview', { token: D.body.token })).status, 200);
    await app.close();
  } finally { process.env.SINGLE_SESSION = '0'; }
});

test('giới hạn tốc độ trong ứng dụng: đăng nhập sai nhiều lần từ một IP bị chặn 429, IP khác không ảnh hưởng; X-Forwarded-For giả không đổi được IP khi chỉ tin một chặng', async () => {
  const app = await makeApp({ rateLimit: true, trustProxy: ['127.0.0.1'] });
  const login = (xff, remote) => app.inject({ method: 'POST', url: '/api/s/login', payload: { code: 'NV0142', pin: '9999' }, remoteAddress: remote, headers: xff ? { 'x-forwarded-for': xff } : {} });
  // IP 10.0.0.5 đứng sau proxy 127.0.0.1; khách tự thêm XFF giả ở đầu, proxy thật nối IP thật ở cuối
  let last;
  for (let i = 0; i < 22; i++) last = await login(`6.6.${i}.1, 10.0.0.5`, '127.0.0.1');
  assert.equal(last.statusCode, 429, 'giả XFF để đổi IP không được');
  assert.ok(Number(last.headers['retry-after']) >= 1);
  assert.equal((await login('10.0.0.9', '127.0.0.1')).statusCode, 401); // IP khác vẫn dùng được (sai PIN nhưng không bị 429)
  await app.close();
});

test('tài khoản quản trị không đăng nhập được bằng PIN ở app nhân viên khi đang bắt buộc 2 bước', async () => {
  process.env.REQUIRE_ADMIN_2FA = '1';
  try {
    const app = await makeApp();
    const r = await call(app, 'POST', '/api/s/login', { body: { code: 'QT0007', pin: '2345' } });
    assert.equal(r.status, 401); assert.equal(r.body.error, 'USE_ADMIN');
    const ok = await call(app, 'POST', '/api/s/login', { body: { code: 'NV0142', pin: '1111' } });
    assert.equal(ok.status, 200);
    await app.close();
  } finally { process.env.REQUIRE_ADMIN_2FA = '0'; }
});

test('mã 2 bước: khóa lưu dạng mã hóa trong CSDL (bản thô cũ được nâng cấp), mỗi mã chỉ dùng một lần', async () => {
  const app = await makeApp();
  const t = (await adminLogin(app)).body.token;
  const b = await call(app, 'POST', '/api/a/users/QT0001/totp/begin', { token: t, body: {} });
  const secret = b.body.secret;
  const code = totpNow(secret);
  assert.equal((await call(app, 'POST', '/api/a/users/QT0001/totp/confirm', { token: t, body: { confirmToken: b.body.confirmToken, code } })).status, 200);
  const stored = app.ctx.db.prepare("SELECT totp_secret FROM staff WHERE id='QT0001'").get().totp_secret;
  assert.ok(stored.startsWith('enc1:') && !stored.includes(secret), 'khóa 2 bước phải được mã hóa');
  // mã vừa dùng để xác nhận không dùng lại được để đăng nhập
  const again = await adminLogin(app, 'QT0001', 'Admin@123', code);
  assert.equal(again.body.error, 'BAD_TOTP');
  // mã của bước kế tiếp dùng được một lần, lần hai bị từ chối
  const next = totpNow(secret, Date.now() + 30000);
  assert.equal((await adminLogin(app, 'QT0001', 'Admin@123', next)).status, 200);
  assert.equal((await adminLogin(app, 'QT0001', 'Admin@123', next)).body.error, 'BAD_TOTP');
  // bản lưu thô cũ vẫn đăng nhập được và được nâng cấp sang mã hóa
  app.ctx.db.prepare("UPDATE staff SET totp_secret = ?, totp_last = NULL WHERE id='QT0001'").run(secret);
  assert.equal((await adminLogin(app, 'QT0001', 'Admin@123', totpNow(secret))).status, 200);
  assert.ok(app.ctx.db.prepare("SELECT totp_secret FROM staff WHERE id='QT0001'").get().totp_secret.startsWith('enc1:'));
  await app.close();
});

test('thu hồi phiên: đổi mật khẩu, đổi vai trò hoặc đặt lại PIN làm token cũ hết hiệu lực dù tắt chính sách một phiên', async () => {
  const app = await makeApp();
  await call(app, 'PUT', '/api/a/security', { token: (await adminLogin(app)).body.token, body: { singleSession: false } });
  const chain = (await adminLogin(app)).body.token;
  const mk = await call(app, 'POST', '/api/a/users', { token: chain, body: { role: 'branch_admin', name: 'QL Q7', storeId: 'Q7', password: 'Matkhau123', pin: '2468' } });
  const id = mk.body.user.id;
  const t1 = (await adminLogin(app, id, 'Matkhau123')).body.token;
  assert.equal((await call(app, 'GET', '/api/a/me', { token: t1 })).status, 200);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal((await call(app, 'POST', `/api/a/users/${id}/reset-password`, { token: chain, body: { password: 'Matkhau456' } })).status, 200);
  const old = await call(app, 'GET', '/api/a/me', { token: t1 });
  assert.equal(old.status, 401); assert.equal(old.body.error, 'SESSION_REVOKED');
  const t2 = (await adminLogin(app, id, 'Matkhau456')).body.token; // đăng nhập lại bình thường
  assert.equal((await call(app, 'GET', '/api/a/me', { token: t2 })).status, 200);
  await new Promise((r) => setTimeout(r, 15));
  await call(app, 'PUT', `/api/a/users/${id}`, { token: chain, body: { role: 'cashier' } }); // hạ vai trò
  assert.ok([401, 403].includes((await call(app, 'GET', '/api/a/me', { token: t2 })).status)); // không còn quyền quản trị
  await app.close();
});
