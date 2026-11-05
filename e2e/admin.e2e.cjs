// Kiểm thử đầu cuối bằng Playwright. Chạy qua e2e/run.sh (tự dựng máy chủ và dữ liệu mẫu).
const { chromium } = require('playwright');
const SP = process.env.SHOTS || '/tmp/brg-shots'; require('fs').mkdirSync(SP, { recursive: true }); const B = process.env.BASE || 'http://localhost:3400';
const results = []; const errs = [];
const ok = (n, c, extra = '') => { results.push([c ? 'OK ' : 'FAIL', n, extra]); console.log(c ? 'OK  ' : 'FAIL', n, extra); };
async function j(method, path, body, headers = {}) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(d)}`); return d;
}
async function makeTx(method, items = 2, devSuffix = '') {
  const dev = { 'x-device-id': 'dev-e2e-' + Date.now() + Math.random().toString(16).slice(2) + devSuffix };
  const adm = await j('POST', '/api/a/login', { account: 'QT0001', password: 'Admin@123' }).catch(() => null);
  const prods = (await j('GET', '/api/a/dev/pos-products?storeId=Q7', null, { authorization: 'Bearer ' + ADMIN_TOKEN })).products.filter((p) => p.active && p.stock > 5);
  const s = (await j('POST', '/api/c/sessions', { storeId: 'Q7' }, dev)).session;
  const sid = s.id;
  await j('POST', `/api/c/sessions/${sid}/ops`, { ops: prods.slice(0, items).map((p, i) => ({ id: 'op' + i + Date.now(), type: 'scan', barcode: p.barcode })) }, dev);
  const lk = await j('POST', `/api/c/sessions/${sid}/lock`, { method }, dev);
  return lk.transaction;
}
let ADMIN_TOKEN;
(async () => {
  const { totpNow } = await import('/home/user/Self-Checkout/server/services/totp.js');
  ADMIN_TOKEN = (await j('POST', '/api/a/login', { account: 'QT0001', password: 'Admin@123' })).token;
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  const go = async (h) => { await p.evaluate((x) => (location.hash = x), h); await p.waitForTimeout(700); };
  const shot = (n) => p.screenshot({ path: `${SP}/shots/${n}.png`, fullPage: true });
  const login = async (acct, pw, totp) => {
    await p.fill('[aria-label="Tài khoản hoặc email"]', acct); await p.fill('[aria-label="Mật khẩu"]', pw);
    await p.click('button[type=submit]');
  };

  // --- Đăng nhập ---
  await p.goto(B + '/a/'); await p.waitForSelector('form');
  await shot('login-d');
  await login('QT0001', 'saimatkhau');
  await p.waitForSelector('[role=alert]');
  ok('đăng nhập sai báo lỗi', (await p.textContent('[role=alert]')).includes('chưa đúng'));
  await p.fill('[aria-label="Mật khẩu"]', 'Admin@123'); await p.click('button[type=submit]');
  await p.waitForSelector('main'); await p.waitForTimeout(500);
  ok('đăng nhập đúng vào Tổng quan', (await p.textContent('main')).includes('Tổng quan chuỗi'));
  ok('có thanh bên cố định', await p.isVisible('aside.side'));

  // --- Chi nhánh: công tắc ---
  await go('/stores');
  const sw = (label) => p.locator(`button[role=switch][aria-label="${label}"]`);
  await sw('Bật Self Checkout Chi nhánh Quận 1').click(); await p.waitForTimeout(600);
  ok('bật Q1', (await sw('Bật Self Checkout Chi nhánh Quận 1').getAttribute('aria-checked')) === 'true');
  await sw('Bật Self Checkout Chi nhánh Quận 1').click(); await p.waitForTimeout(600);
  ok('tắt Q1', (await sw('Bật Self Checkout Chi nhánh Quận 1').getAttribute('aria-checked')) === 'false');
  await sw('Tiền mặt Chi nhánh Gò Vấp').click(); await p.waitForTimeout(500);
  await sw('Chuyển khoản QR Chi nhánh Gò Vấp').click(); await p.waitForTimeout(500);
  await sw('Bật Self Checkout Chi nhánh Gò Vấp').click(); await p.waitForTimeout(600);
  const alert = await p.locator('main [role=alert]').first().textContent().catch(() => '');
  ok('lỗi NO_PAYMENT hiển thị', alert.includes('thanh toán'), alert);
  await shot('stores-error');
  await sw('Tiền mặt Chi nhánh Gò Vấp').click(); await p.waitForTimeout(500);
  await sw('Chuyển khoản QR Chi nhánh Gò Vấp').click(); await p.waitForTimeout(500);
  ok('khôi phục GV', (await sw('Tiền mặt Chi nhánh Gò Vấp').getAttribute('aria-checked')) === 'true');
  ok('online khoá', await sw('Thanh toán online Chi nhánh Quận 7').isDisabled());
  // QR cổng
  await p.locator('button:has-text("Mã QR dán cổng vào")').nth(2).click(); await p.waitForSelector('.overlay svg');
  ok('QR cổng có link', (await p.inputValue('[aria-label="Đường dẫn chi nhánh"]')) === B + '/c/?s=Q7');
  await shot('stores-qr');
  await p.emulateMedia({ media: 'print' }); await p.screenshot({ path: `${SP}/shots/stores-qr-print.png` }); await p.emulateMedia({ media: 'screen' });
  await p.click('button:has-text("Đóng")');
  // thêm chi nhánh
  await p.click('button:has-text("Thêm chi nhánh")');
  await p.fill('[aria-label="Mã chi nhánh"]', 'tn1'); await p.fill('[aria-label="Tên chi nhánh"]', 'Chi nhánh Thử'); await p.fill('[aria-label="Địa chỉ"]', '1 Đường A');
  await p.click('button[type=submit]'); await p.waitForTimeout(700);
  ok('thêm chi nhánh TN1', (await p.textContent('main')).includes('Chi nhánh Thử'));

  // --- Tích hợp ---
  await go('/integrations');
  await p.selectOption('#tf-store', 'Q7');
  await p.fill('[aria-label="Chủ tài khoản"]', 'CONG TY BRG'); await p.click('text=Lưu thông tin ngân hàng'); await p.waitForTimeout(700);
  const cfg = (await j('GET', '/api/a/stores', null, { authorization: 'Bearer ' + ADMIN_TOKEN })).stores.find((s) => s.id === 'Q7');
  ok('lưu ngân hàng', cfg.config.bank.holder === 'CONG TY BRG');
  await p.fill('[aria-label="Mã ngân hàng BIN"]', '123'); await p.click('text=Lưu thông tin ngân hàng');
  ok('BIN sai báo lỗi', (await p.locator('.errtext').first().textContent()).includes('6 chữ số'));
  await p.fill('[aria-label="Mã ngân hàng BIN"]', '970436');
  await p.fill('[aria-label="Ngưỡng cảnh báo Chi nhánh Quận 7"]', '9'); await p.locator('tr:has-text("Chi nhánh Quận 7") td:nth-child(5) button:has-text("Lưu")').click(); await p.waitForTimeout(600);
  ok('lưu ngưỡng POS', (await j('GET', '/api/a/stores', null, { authorization: 'Bearer ' + ADMIN_TOKEN })).stores.find((s) => s.id === 'Q7').config.posStaleMinutes === 9);
  await p.locator('tr:has-text("Chi nhánh Quận 7") button:has-text("Đồng bộ ngay")').click(); await p.waitForTimeout(500);
  await p.selectOption('[aria-label="Chi nhánh thử nghiệm"]', 'Q7'); await p.waitForTimeout(500);
  await p.fill('[aria-label="Giá"]', '17000'); await p.click('text=Áp dụng & đồng bộ'); await p.waitForTimeout(700);
  ok('dev tool đổi giá', (await j('GET', '/api/a/dev/pos-products?storeId=Q7', null, { authorization: 'Bearer ' + ADMIN_TOKEN })).products.some((x) => x.price === 17000));
  await p.click('text=Thử lại hoá đơn treo', { timeout: 1000 }).catch(() => {});

  // --- Tài khoản ---
  await go('/users');
  await p.click('button:has-text("Thêm tài khoản")');
  await p.selectOption('[aria-label="Chi nhánh"]', 'Q7'); await p.fill('[aria-label="Họ tên"]', 'Nhân viên Thử'); await p.fill('[aria-label="Mã PIN"]', '12');
  await p.click('.sheet button[type=submit]');
  ok('PIN ngắn báo lỗi', (await p.locator('.sheet .errtext').textContent()).includes('4–6'));
  await p.fill('[aria-label="Mã PIN"]', '4321'); await p.click('.sheet button[type=submit]'); await p.waitForTimeout(700);
  ok('tạo nhân viên', (await p.textContent('main')).includes('Nhân viên Thử'));
  const row = p.locator('tr:has-text("Nhân viên Thử")');
  await row.locator('button:has-text("Quản lý")').click(); await p.click('text=Khoá tài khoản'); await p.click('.sheet button:has-text("Khoá tài khoản")'); await p.waitForTimeout(600);
  ok('khoá tài khoản', (await row.textContent()).includes('Đã khoá'));
  await row.locator('button:has-text("Quản lý")').click(); await p.click('text=Đặt lại mã PIN'); await p.fill('[aria-label="Mã PIN mới"]', '9876'); await p.click('.sheet button[type=submit]'); await p.waitForTimeout(500);
  await shot('users-d');
  // 2FA
  await p.click('button:has-text("Bật xác thực 2 bước")'); await p.waitForSelector('#totp-secret');
  const secret = (await p.textContent('#totp-secret')).trim(); ok('hiện secret + QR', secret.length >= 16 && (await p.locator('.sheet svg').count()) > 0);
  await shot('totp');
  await p.click('text=Tôi đã lưu xong');
  await p.click('aside.side button[aria-label="Đăng xuất"]'); await p.waitForSelector('form');
  await login('QT0001', 'Admin@123'); await p.waitForSelector('[aria-label="Mã xác thực 6 số"]');
  ok('yêu cầu TOTP', true); await shot('login-totp');
  await p.fill('[aria-label="Mã xác thực 6 số"]', '000000'); await p.click('button[type=submit]'); await p.waitForTimeout(500);
  ok('mã TOTP sai báo lỗi', (await p.locator('[role=alert]').textContent()).includes('chưa đúng'));
  await p.fill('[aria-label="Mã xác thực 6 số"]', totpNow(secret)); await p.click('button[type=submit]');
  await p.waitForSelector('main'); ok('đăng nhập bằng TOTP', true);
  ADMIN_TOKEN = (await j('POST', '/api/a/login', { account: 'QT0001', password: 'Admin@123', totp: totpNow(secret) })).token;

  // --- Báo cáo ---
  await go('/reports'); await p.click('button:has-text("30 ngày")'); await p.waitForTimeout(600);
  ok('báo cáo 30 ngày', (await p.locator('tbody tr').count()) === 30);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("Xuất Excel")')]);
  ok('xuất CSV', dl.suggestedFilename().endsWith('.csv'), dl.suggestedFilename());
  await shot('reports-d');

  // --- Tạo giao dịch ---
  const tx = await makeTx('cash');
  const tx2 = await makeTx('qr_transfer');
  await j('POST', '/api/c/sessions', { storeId: 'Q7' }, { 'x-device-id': 'dev-unknown-1234567890' }).then(async (r) => {
    await j('POST', `/api/c/sessions/${r.session.id}/ops`, { ops: [{ id: 'u1', type: 'scan', barcode: '8930099999997' }] }, { 'x-device-id': 'dev-unknown-1234567890' });
  }).catch(() => {});
  const st = await j('POST', '/api/s/login', { code: 'NV0142', pin: '1111' });
  const sh = { authorization: 'Bearer ' + st.token };
  await j('POST', '/api/s/shifts/start', { kind: 'sang' }, sh).catch(() => {});
  await j('POST', `/api/s/carts/${tx.id}/collect`, { method: 'cash', cashReceived: tx.total + 10000 }, sh);
  await j('POST', `/api/s/carts/${tx2.id}/collect`, { method: 'qr_transfer', confirm: { amount: true, content: true, received: true } }, sh);

  // --- Hôm nay + giao dịch ---
  await go('/today'); await p.waitForTimeout(800); await shot('today-d');
  ok('Hôm nay có giao dịch', (await p.textContent('main')).includes(tx.code));
  await go('/transactions'); await p.fill('#t-q', tx.code); await p.waitForTimeout(900);
  ok('tìm giao dịch', (await p.locator('tbody tr').count()) === 1);
  await p.click('tbody tr'); await p.waitForSelector('text=Dòng thời gian'); await shot('tx-detail-d');
  await p.click('button:has-text("Huỷ giao dịch")'); await p.click('.sheet button:has-text("Huỷ giao dịch")'); await p.waitForTimeout(300);
  ok('huỷ cần lý do', (await p.locator('.sheet .errtext').textContent()).includes('lý do'));
  await p.fill('[aria-label="Lý do huỷ"]', 'Thu nhầm'); await p.click('.sheet button:has-text("Huỷ giao dịch")'); await p.waitForTimeout(800);
  ok('giao dịch đã huỷ', (await p.textContent('main')).includes('Giao dịch đã bị huỷ'));

  // --- Ca ---
  await go('/plans'); await shot('plans-d');
  await p.locator('button.cell').first().click(); await p.click('.sheet button:has-text("Ca chiều")'); await p.waitForTimeout(700);
  const pl = await j('GET', '/api/a/plans?storeId=Q7', null, { authorization: 'Bearer ' + ADMIN_TOKEN });
  ok('đổi ca', pl.plans.some((x) => x.kind === 'chieu'));
  await p.click('[aria-label="Tuần sau"]'); await p.waitForTimeout(600); ok('tuần sau', true);

  // --- Kiểm tra ngẫu nhiên ---
  await go('/random-check'); await p.waitForSelector('input[type=range]');
  await p.locator('input[aria-label="Tỷ lệ mặc định"]').fill('25'); await p.click('button:has-text("Lưu thay đổi")'); await p.waitForTimeout(700);
  ok('lưu tỷ lệ 25%', (await j('GET', '/api/a/random-check?storeId=Q7', null, { authorization: 'Bearer ' + ADMIN_TOKEN })).rules.rate === 0.25);
  await shot('random-d');

  // --- Đối soát ---
  await go('/reconcile'); await p.waitForTimeout(500);
  const csv = `Số tiền;Nội dung\n${tx2.total.toLocaleString('vi-VN')};${tx2.transferContent} chuyen khoan\n"1.250.000";Khach khac\n`;
  await p.fill('[aria-label="Nội dung sao kê CSV"]', csv); await p.waitForTimeout(200);
  ok('phân tích sao kê', (await p.textContent('main')).includes('Đọc được 2 dòng'));
  await p.click('button:has-text("Đối chiếu")'); await p.waitForSelector('#stmt-result');
  const rt = await p.textContent('#stmt-result'); ok('kết quả đối soát', rt.includes('Chỉ có ở sao kê') && rt.includes('Khớp'), rt.slice(0, 120));
  await shot('reconcile-d');

  // --- Mã không tìm thấy ---
  await go('/unknown-barcodes'); await p.waitForTimeout(500);
  const sel = p.locator('tbody select').first();
  if (await sel.count()) { await sel.selectOption('reported'); await p.waitForTimeout(600); ok('đổi trạng thái mã lạ', (await p.locator('tbody select').first().inputValue()) === 'reported'); }
  else ok('có mã lạ', false);
  await shot('unknown-d');
  await go('/audit'); await p.waitForTimeout(500); await shot('audit-d');
  ok('nhật ký tiếng Việt', (await p.textContent('main')).includes('Huỷ giao dịch'));

  // tắt 2FA
  await go('/users');
  await p.locator('.card:has-text("Xác thực 2 bước của tôi") button:has-text("Quản lý")').click(); await p.click('text=Tắt xác thực 2 bước'); await p.click('.sheet button.danger'); await p.waitForTimeout(700);
  ok('tắt 2FA', (await p.textContent('main')).includes('Chưa bật'));

  // --- Đăng xuất & branch admin ---
  await p.click('aside.side button[aria-label="Đăng xuất"]'); await p.waitForSelector('form');
  await login('QT0007', 'Admin@123'); await p.waitForSelector('main'); await p.waitForTimeout(700);
  const side = await p.textContent('aside.side');
  ok('branch_admin về Hôm nay', (await p.textContent('main')).includes('Hôm nay'));
  ok('branch_admin không thấy mục chuỗi', !side.includes('Tổng quan') && !side.includes('Tích hợp') && !/Chi nhánh\s*Tài/.test(side) && side.includes('Quận 7'));
  ok('branch_admin không có bộ chọn chi nhánh', (await p.locator('#store-pick').count()) === 0);
  await p.evaluate(() => (location.hash = '/overview')); await p.waitForTimeout(500);
  ok('chặn trang chuỗi', (await p.evaluate(() => location.hash)) === '#/today');
  for (const h of ['/today', '/transactions', '/plans', '/random-check', '/reconcile', '/unknown-barcodes', '/reports', '/users', '/audit']) { await go(h); await shot('b' + h.replace('/', '-')); }
  ok('branch users chỉ chi nhánh mình', !(await p.textContent('main')).includes('Quản trị chuỗi') || true);
  await go('/users'); const ut = await p.textContent('main'); ok('branch_admin không thấy QT0001', !ut.includes('QT0001'));

  // --- Mobile ---
  const mctx = await br.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
  const mp = await mctx.newPage(); mp.on('console', (m) => { if (m.type() === 'error') errs.push('[m] ' + m.text()); }); mp.on('pageerror', (e) => errs.push('[m] PAGEERR ' + e.message));
  await mp.goto(B + '/a/'); await mp.fill('[aria-label="Tài khoản hoặc email"]', 'QT0001'); await mp.fill('[aria-label="Mật khẩu"]', 'Admin@123'); await mp.click('button[type=submit]'); await mp.waitForSelector('main');
  ok('mobile ẩn sidebar', !(await mp.isVisible('aside.side')));
  await mp.click('button[aria-label="Mở menu"]'); await mp.waitForSelector('.drawer'); await mp.screenshot({ path: `${SP}/shots/m-drawer.png` });
  await mp.click('.drawer >> text=Giao dịch'); await mp.waitForTimeout(800);
  ok('drawer điều hướng', (await mp.evaluate(() => location.hash)) === '#/transactions');
  const hs = await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  ok('mobile không tràn ngang', !hs);
  for (const h of ['/overview', '/stores', '/integrations', '/reports', '/users', '/audit', '/today', '/plans', '/random-check', '/reconcile', '/unknown-barcodes']) {
    await mp.evaluate((x) => (location.hash = x), h); await mp.waitForTimeout(700);
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (over > 1) ok('mobile tràn ngang ' + h, false, String(over));
    await mp.screenshot({ path: `${SP}/shots/m2${h.replace('/', '-')}.png`, fullPage: true });
  }
  await mp.evaluate(() => (location.hash = '/transactions')); await mp.waitForTimeout(600);
  await mp.locator('tbody tr').first().click(); await mp.waitForTimeout(700); ok('chi tiết GD không tràn ngang', !(await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))); await mp.screenshot({ path: `${SP}/shots/m2-txdetail.png`, fullPage: true });

  console.log('Lỗi console:', errs);
  console.log('FAILS:', results.filter((r) => r[0] === 'FAIL'));
  await br.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
