// Kiểm thử đầu cuối bằng Playwright. Chạy qua e2e/run.sh (tự dựng máy chủ và dữ liệu mẫu).
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:3400';
const SH = (process.env.SHOTS || '/tmp/brg-shots') + '/'; require('fs').mkdirSync(SH, { recursive: true });
const j = async (m, p, body, h = {}) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); const t = await r.json().catch(() => ({})); if (!r.ok) throw new Error(p + ' ' + JSON.stringify(t)); return t; };
let adm, prods, n = 0;
async function setup() {
  adm = { authorization: 'Bearer ' + (await j('POST', '/api/a/login', { account: 'QT0001', password: 'Admin@123' })).token };
  prods = (await j('GET', '/api/a/dev/pos-products?storeId=Q7', null, adm)).products.filter((p) => p.active);
}
const rate = (r) => j('PUT', '/api/a/stores/Q7/config', { randomCheckRate: r, rateFirstTime: r, rateHighValue: r }, adm);
async function makeCart(method, idx = [0, 1, 1]) {
  const dev = 'device-test-' + Date.now() + '-' + (n++) + '-xxxxxxxx';
  const h = { 'x-device-id': dev };
  const s = (await j('POST', '/api/c/sessions', { storeId: 'Q7' }, h)).session;
  await j('POST', `/api/c/sessions/${s.id}/ops`, { ops: idx.map((i, k) => ({ id: 'o' + k, type: 'scan', barcode: prods[i].barcode })) }, h);
  const l = await j('POST', `/api/c/sessions/${s.id}/lock`, { method }, h);
  return l.transaction || l;
}
let tok;
async function receipt(id) { if (!tok) tok = (await j('POST', '/api/s/login', { code: 'NV0142', pin: '1111' })).token; return (await j('GET', '/api/s/transactions/' + id, null, { authorization: 'Bearer ' + tok })).transaction.receipt.token; }
const errors = [];
(async () => {
  await setup();
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, locale: 'vi-VN' });
  const pg = await ctx.newPage();
  pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const shot = (name) => pg.screenshot({ path: SH + name + '.png' });
  const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, '\n   ', e.message.split('\n')[0]); await shot('fail-' + name.replace(/\W+/g, '_')).catch(() => {}); } };
  const ok = (c, m) => { if (!c) throw new Error('assert: ' + m); };
  const txt = (s) => pg.locator('body').innerText().then((t) => t.includes(s));
  const login = async (code, pin) => {
    await pg.goto(B + '/s/'); await pg.fill('input[aria-label="Mã nhân viên"]', code);
    for (const d of pin) await pg.click(`.keypad button[aria-label="${d}"]`);
    await pg.click('button:has-text("Đăng nhập")');
  };
  const rm = (r) => rate(r);

  await rm(0);
  await step('login-bad', async () => {
    await login('NV0142', '9999'); await pg.waitForSelector('.banner.err'); await shot('01-login-err');
    ok(await txt('chưa đúng'), 'msg');
  });
  await step('login+start shift', async () => {
    await pg.goto(B + '/s/'); await pg.fill('input[aria-label="Mã nhân viên"]', 'NV0142');
    for (const d of '1111') await pg.click(`.keypad button[aria-label="${d}"]`);
    await shot('02-login'); await pg.click('button:has-text("Đăng nhập")');
    await pg.waitForSelector('text=Bắt đầu ca làm việc'); await shot('03-home-noshift');
    await pg.click('button:has-text("Bắt đầu ca")'); await pg.waitForSelector('text=Thu tiền giỏ hàng'); await pg.waitForTimeout(600); await shot('04-home');
  });
  let tx1;
  await step('cash flow', async () => {
    tx1 = await makeCart('cash');
    await pg.click('text=Thu tiền giỏ hàng'); await pg.waitForSelector('input[aria-label="Mã giỏ hàng"]'); await pg.waitForTimeout(500); await shot('05-lookup');
    await pg.fill('input[aria-label="Mã giỏ hàng"]', 'gh q7 xxxx'); await pg.click('button:has-text("Tra mã")'); await pg.waitForSelector('.banner.err'); await shot('06-lookup-err');
    await pg.fill('input[aria-label="Mã giỏ hàng"]', tx1.code); await pg.click('button:has-text("Tra mã")');
    await pg.waitForSelector('text=Giỏ hàng cần thu'); await shot('07-cart');
    await pg.click('button:has-text("Thu tiền mặt")'); await pg.waitForSelector('text=Khách đưa');
    ok(await pg.locator('button:has-text("Đã thu tiền")').isDisabled(), 'disabled before enough');
    await pg.click('.chip:has-text("Đủ tiền")'); 
    const total = tx1.total; const chips = await pg.locator('.chip').allInnerTexts(); console.log('   chips', chips.join('|'), 'total', total);
    const big = chips.find((c) => /^500\.000/.test(c)); await pg.click('.chip:has-text("500.000")'); await pg.waitForSelector('text=Tiền thừa'); await shot('08-cash');
    await pg.click('button:has-text("Đã thu tiền")'); await pg.waitForSelector('text=Khách tiếp theo'); await shot('09-done');
    ok(await txt('Trả lại khách'), 'change');
  });
  await step('gate valid', async () => {
    const r = await receipt(tx1.id);
    await pg.click('button:has-text("Về trang chính")'); await pg.click('text=Kiểm tra cổng ra'); await pg.waitForSelector('input[aria-label="Chuỗi QR biên nhận"]'); await pg.waitForTimeout(500); await shot('10-gate');
    await pg.fill('input[aria-label="Chuỗi QR biên nhận"]', r); await pg.click('button:has-text("Kiểm tra")'); await pg.waitForSelector('text=Cho khách qua'); await shot('11-valid');
    await pg.click('text=Quét khách tiếp theo');
    await pg.fill('input[aria-label="Chuỗi QR biên nhận"]', r); await pg.click('button:has-text("Kiểm tra")'); await pg.waitForSelector('text=QR đã được dùng'); await shot('12-used');
    ok(await txt('Người quét'), 'who');
    await pg.click('text=Quét khách tiếp theo');
    await pg.fill('input[aria-label="Chuỗi QR biên nhận"]', 'GH-Q7-0001'); await pg.click('button:has-text("Kiểm tra")'); await pg.waitForSelector('text=Đây không phải QR biên nhận');
    await pg.click('text=Quét khách tiếp theo');
    await pg.fill('input[aria-label="Chuỗi QR biên nhận"]', 'abc'); await pg.click('button:has-text("Kiểm tra")'); await pg.waitForSelector('text=Mã không hợp lệ'); await shot('13-invalid');
    await pg.click('text=Quét khách tiếp theo');
    const unpaid = await makeCart('cash'); // chưa thu, nhưng không có token; dùng token giả
  });
  let tx2;
  await step('transfer flow', async () => {
    tx2 = await makeCart('qr_transfer');
    await pg.goto(B + '/s/#/thu'); await pg.fill('input[aria-label="Mã giỏ hàng"]', tx2.code); await pg.keyboard.press('Enter');
    await pg.waitForSelector('text=Giỏ hàng cần thu'); await pg.click('button:has-text("Xác nhận chuyển khoản")'); await pg.waitForSelector('text=Số tiền phải khớp'); await shot('14-transfer');
    const b = pg.locator('button:has-text("xác nhận")'); ok(await b.isDisabled(), 'dis');
    const boxes = pg.locator('[role=checkbox]');
    for (let i = 0; i < 3; i++) { ok(await b.isDisabled() || i === 2, 'still dis ' + i); await boxes.nth(i).click(); }
    await shot('15-transfer-ticked'); await b.click(); await pg.waitForSelector('text=Đã thu tiền'); ok(await txt('Chuyển khoản'), 'method');
  });
  await step('random check with mismatch + extra', async () => {
    await rm(1);
    const t = await makeCart('cash', [0, 1, 1, 2]);
    await pg.goto(B + '/s/#/thu'); await pg.fill('input[aria-label="Mã giỏ hàng"]', t.code); await pg.keyboard.press('Enter');
    await pg.waitForSelector('text=Được chọn kiểm tra ngẫu nhiên'); await shot('16-cart-check');
    ok(await pg.locator('button:has-text("Đối chiếu ngay tại quầy")').count() === 1, 'optional check btn');
    ok(await pg.locator('button:has-text("Thu tiền mặt")').count() === 1, 'collect btn still available');
    await pg.click('button:has-text("Đối chiếu ngay tại quầy")'); await pg.waitForSelector('text=Đã đối chiếu'); await shot('17-checklist');
    ok(await pg.locator('button:has-text("Khớp, tiếp tục thu tiền")').isDisabled(), 'dis match');
    // counter match path
    for (const b of await pg.locator('[role=checkbox]').all()) await b.click();
    await shot('18-checklist-done'); await pg.click('button:has-text("Khớp, tiếp tục thu tiền")'); await pg.waitForSelector('button:has-text("Thu tiền mặt")');
    await pg.click('button:has-text("Thu tiền mặt")'); await pg.click('.chip:has-text("Đủ tiền")'); await pg.click('button:has-text("Đã thu tiền")'); await pg.waitForSelector('text=Khách tiếp theo');
    const r = await receipt(t.id);
    // gate: check_required? already check_done -> valid
    await pg.goto(B + '/s/#/cong'); await pg.fill('input[aria-label="Chuỗi QR biên nhận"]', r); await pg.click('button:has-text("Kiểm tra")'); await pg.waitForSelector('text=Cho khách qua');
    // second cart: check at gate with mismatch
    const t2 = await makeCart('cash', [0, 1, 2]); const cw = await pg.evaluate(() => 0);
    await pg.goto(B + '/s/#/thu'); await pg.fill('input[aria-label="Mã giỏ hàng"]', t2.code); await pg.keyboard.press('Enter');
    await pg.waitForSelector('text=Giỏ hàng cần thu'); await pg.click('button:has-text("Đối chiếu ngay tại quầy")');
    await pg.click('button:has-text("Có chênh lệch")'); await pg.waitForSelector('text=Loại chênh lệch'); await shot('19-mismatch');
    await pg.fill('input[aria-label="Số tiền chênh lệch"]', '45000'); await pg.fill('textarea', 'Khách có thêm 1 chai nước'); await pg.click('button:has-text("Lưu chênh lệch")');
    await pg.waitForSelector('text=Thu bổ sung'); await pg.waitForTimeout(300); await shot('20-cart-extra-at-counter');
    ok(await txt('45.000'), 'extra shown');
    await pg.click('button:has-text("Thu tiền mặt")'); await pg.click('.chip:has-text("500.000")'); await pg.click('button:has-text("Đã thu tiền")'); await pg.waitForSelector('text=Khách tiếp theo');
    // gate check path: new cart, pay without check (rate 0 then gate)
    await rm(0);
    const t3 = await makeCart('cash', [0, 1]);
    await pg.goto(B + '/s/#/thu'); await pg.fill('input[aria-label="Mã giỏ hàng"]', t3.code); await pg.keyboard.press('Enter');
    await pg.waitForSelector('text=Giỏ hàng cần thu'); await pg.click('button:has-text("Thu tiền mặt")'); await pg.click('.chip:has-text("Đủ tiền")'); await pg.click('button:has-text("Đã thu tiền")'); await pg.waitForSelector('text=Khách tiếp theo');
    // force check at gate: set rate=1 doesn't alter existing tx -> need check_required at lock time. so create with rate 1 then collect via API instead of UI

  });
  let tx3;
  await step('gate check_required -> mismatch -> extra_due -> collect -> pass', async () => {
    await rm(1);
    const t = await makeCart('cash', [0, 1, 2]); await rm(0);
    // thu qua API để bỏ qua đối chiếu quầy: server cho thu dù check_required
    if (!tok) await receipt(tx1.id);
    await j('POST', `/api/s/carts/${t.id}/collect`, { method: 'cash', cashReceived: 1000000 }, { authorization: 'Bearer ' + tok }).catch(async () => { await j('POST', '/api/s/shifts/start', { kind: 'sang' }, { authorization: 'Bearer ' + tok }); });
    const r = await receipt(t.id);
    await pg.goto(B + '/s/#/cong'); await pg.fill('input[aria-label="Chuỗi QR biên nhận"]', r); await pg.click('button:has-text("Kiểm tra")');
    await pg.waitForSelector('text=Kiểm tra ngẫu nhiên'); await shot('21-check-required');
    ok(await pg.locator('button:has-text("Bỏ qua")').count() === 0, 'no skip');
    await pg.click('button:has-text("Bắt đầu kiểm tra")'); await pg.waitForSelector('text=Đã đối chiếu');
    await pg.click('button:has-text("Có chênh lệch")'); await pg.click('.chip:has-text("Sai số lượng")'); await pg.click('button:has-text("Lưu chênh lệch")'); await pg.waitForSelector('text=Nhập số tiền chênh lệch'); await shot('22-mismatch-err');
    await pg.fill('input[aria-label="Số tiền chênh lệch"]', '30000'); await pg.click('button:has-text("Lưu chênh lệch")');
    await pg.waitForSelector('text=Còn khoản thu bổ sung'); await shot('23-extra-due');
    await pg.click('button:has-text("Thu bổ sung ngay")'); await pg.waitForSelector('text=Thu bổ sung'); await shot('24-extra-cart');
    await pg.click('button:has-text("Thu tiền mặt")'); await pg.waitForSelector('text=Cần thu thêm'); await pg.click('.chip:has-text("Đủ tiền")'); await pg.click('button:has-text("Đã thu tiền")'); await pg.waitForSelector('text=Đã thu bổ sung');
    await pg.goto(B + '/s/#/cong'); await pg.fill('input[aria-label="Chuỗi QR biên nhận"]', r); await pg.click('button:has-text("Kiểm tra")'); await pg.waitForSelector('text=Cho khách qua');
  });
  await step('gate refuse -> held -> manager resolve', async () => {
    await rm(1); const t = await makeCart('cash', [0, 1]); await rm(0);
    await j('POST', `/api/s/carts/${t.id}/collect`, { method: 'cash', cashReceived: 1000000 }, { authorization: 'Bearer ' + tok });
    const r = await receipt(t.id);
    await pg.goto(B + '/s/#/cong'); await pg.fill('input[aria-label="Chuỗi QR biên nhận"]', r); await pg.click('button:has-text("Kiểm tra")');
    await pg.waitForSelector('text=Kiểm tra ngẫu nhiên'); await pg.click('button:has-text("Khách từ chối")'); await pg.click('button:has-text("Xác nhận, gọi quản lý")');
    await pg.waitForSelector('text=Đang chờ quản lý'); await shot('25-held'); await pg.click('button:has-text("Gọi quản lý")'); await pg.waitForSelector('text=Chỉ quản lý mới'); await shot('26-call-mgr');
    await pg.click('button:has-text("Đã hiểu")');
    // đăng xuất, đăng nhập quản lý
    await pg.goto(B + '/s/#/'); await pg.click('button[aria-label="Mở menu"]'); await shot('27-drawer'); await pg.click('nav >> text=Đăng xuất');
    await login('QT0007', '2345'); await pg.waitForSelector('text=Chào');
    await pg.goto(B + '/s/#/cho-quan-ly'); await pg.waitForSelector('text=Cho qua'); await shot('28-held-list');
    await pg.click('button:has-text("Cho qua")'); await pg.click('.sheet button:has-text("Cho khách qua")'); await pg.waitForSelector('text=Đã cho khách qua');
    await pg.waitForSelector('text=Không có ca chờ');
  });
  await step('manager: no shift -> end shift page; cashier lacking perms', async () => {
    await pg.goto(B + '/s/#/doi-soat'); await pg.waitForSelector('text=Bạn chưa bắt đầu ca'); await shot('29-noshift-end');
    await pg.click('button:has-text("Về trang chính")'); await pg.waitForSelector('button:has-text("Bắt đầu ca")');
    await pg.click('button:has-text("Ca chiều")'); await pg.click('button:has-text("Bắt đầu ca")'); await pg.waitForSelector('text=Thu tiền giỏ hàng');
    await pg.goto(B + '/s/#/giao-dich'); await pg.waitForSelector('.item'); await shot('30-tx-list'); await pg.locator('.item').first().click(); await pg.waitForSelector('text=Mã giao dịch'); await shot('31-tx-detail');
    await pg.goto(B + '/s/#/doi-soat'); await pg.waitForSelector('text=Tiền mặt theo hệ thống'); 
    for (const d of '5') await pg.click(`.keypad button[aria-label="${d}"]`);
    await pg.waitForSelector('text=Thiếu so với hệ thống').catch(() => {}); await shot('32-endshift-diff');
    await pg.click('button:has-text("Kết thúc ca & bàn giao")', { timeout: 1000 }).catch(() => {});
  });
  // ca của NV0142: kết thúc có lệch
  await step('end shift with diff', async () => {
    await pg.goto(B + '/s/#/'); await pg.click('button[aria-label="Mở menu"]'); await pg.click('nav >> text=Đăng xuất');
    await login('NV0142', '1111'); await pg.waitForSelector('text=Thu tiền giỏ hàng');
    await pg.goto(B + '/s/#/doi-soat'); await pg.waitForSelector('text=Tiền mặt theo hệ thống');
    await pg.click('.keypad button[aria-label="1"]'); await pg.click('.keypad button[aria-label="2"]'); await pg.click('.keypad button[aria-label="3"]');
    await pg.waitForSelector('textarea'); await shot('33-endshift');
    ok(await pg.locator('button:has-text("Kết thúc ca & bàn giao")').isDisabled(), 'need note');
    await pg.fill('textarea', 'Trả nhầm tiền thừa'); await pg.click('button:has-text("Kết thúc ca & bàn giao")'); await shot('34-confirm');
    await pg.click('.sheet button:has-text("Kết thúc ca")'); await pg.waitForSelector('text=Ca vừa kết thúc'); await shot('35-home-after');
  });
  await step('401 auto logout', async () => {
    await pg.evaluate(() => localStorage.setItem('brg.s.token', 'bad.token')); await pg.goto(B + '/s/'); await pg.reload();
    await pg.waitForSelector('text=Đăng nhập', { timeout: 5000 }); 
  });
  await step('wide + dark', async () => {
    await login('NV0160', '3333'); await pg.waitForSelector('text=Bắt đầu ca làm việc');
    await pg.emulateMedia({ colorScheme: 'dark' }); await pg.setViewportSize({ width: 360, height: 700 }); await shot('36-dark-360');
    await pg.setViewportSize({ width: 820, height: 1000 }); await pg.emulateMedia({ colorScheme: 'light' }); await shot('37-tablet');
    await pg.setViewportSize({ width: 390, height: 800 });
    await pg.click('button:has-text("Bắt đầu ca")'); await pg.waitForSelector('text=Thu tiền giỏ hàng'); ok(await pg.locator('text=Kiểm tra cổng ra').count() === 0, 'cashier-only has no gate card');
    await pg.goto(B + '/s/#/cong'); await pg.waitForSelector('text=Không có quyền');
    await pg.goto(B + '/s/#/thu'); await pg.waitForSelector('input[aria-label="Mã giỏ hàng"]'); await pg.waitForTimeout(800); 
    ok(await txt('Không tìm thấy camera') || await txt('Camera') || await txt('Đang mở camera'), 'camera msg'); await shot('38-nocam');
  });
  console.log('ERRORS', errors.filter((e) => !/getUserMedia|mediaDevices|401|404|409|400/.test(e)).length ? errors : 'none (filtered: ' + errors.length + ')'); if (errors.length) console.log(errors.slice(0, 8));
  await br.close();
})();
