import { buildApp } from '../server/app.js';
import { seed } from '../server/seed.js';
import { createBridge } from '../server/mssql/bridge.js';

// Chạy toàn bộ kiểm thử trên SQL Server: TEST_DB=mssql MSSQL_SERVER=... MSSQL_USER=... MSSQL_PASSWORD=... npm test
// Mỗi lần makeApp tạo một CSDL riêng (brg_t_<ngẫu nhiên>) và xóa khi app.close().
process.env.REQUIRE_ADMIN_2FA ??= '0'; // các kiểm thử cũ đăng nhập quản trị không có 2 bước và mã hình; kiểm thử riêng bật lại
process.env.REQUIRE_CAPTCHA ??= '0';
const TEST_MSSQL = process.env.TEST_DB === 'mssql';
function mssqlCfg(database) {
  const e = process.env;
  return { driver: 'mssql', server: e.MSSQL_SERVER || '127.0.0.1', port: Number(e.MSSQL_PORT || 1433), database, user: e.MSSQL_USER || 'sa', password: e.MSSQL_PASSWORD,
    encrypt: e.MSSQL_ENCRYPT !== '0', trustServerCertificate: e.MSSQL_TRUST_CERT !== '0', requestTimeoutSec: 60, connectTimeoutSec: 15 };
}
function adminSql(text) { const b = createBridge(mssqlCfg('master')); try { b.call(text); } finally { b.close(); } }

export async function makeApp({ rng = () => 0.99, demo = false, basket = false, mailer } = {}) {
  let dbSpec = ':memory:', dbName = null;
  if (TEST_MSSQL) { dbName = `brg_t_${Math.random().toString(36).slice(2, 10)}`; adminSql(`CREATE DATABASE ${dbName} COLLATE Vietnamese_100_CI_AS`); dbSpec = mssqlCfg(dbName); }
  const app = buildApp({ dbFile: dbSpec, rng, mailer });
  if (dbName) {
    const close = app.close.bind(app);
    app.close = async (...a) => { const r = await close(...a); try { adminSql(`ALTER DATABASE ${dbName} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${dbName}`); } catch { /* bỏ qua */ } return r; };
  }
  seed(app.ctx.db, { demo });
  // Các kiểm thử cũ chạy luồng cổ điển (thu tại quầy, cổng ra). Chế độ giỏ QR bật bằng { basket: true }.
  if (!basket) app.ctx.db.prepare(`UPDATE store_config SET checkout_mode = 'classic'`).run();
  else app.ctx.db.prepare(`UPDATE stores SET pos_code = 'SP-' || id`).run(); // chế độ giỏ QR bắt buộc có mã điểm
  await app.ready();
  return app;
}

export const DEVICE = 'dev-1234567890abcdef';
export const call = (app, method, url, { body, token, device = DEVICE } = {}) =>
  app.inject({ method, url, payload: body, headers: { 'x-device-id': device, ...(token ? { authorization: `Bearer ${token}` } : {}) } })
    .then((r) => ({ status: r.statusCode, body: /json/.test(r.headers['content-type'] || '') ? JSON.parse(r.body) : null, raw: r }));

export async function staffLogin(app, code = 'NV0142', pin = '1111') {
  const r = await call(app, 'POST', '/api/s/login', { body: { code, pin } });
  return r.body.token;
}
export async function adminLogin(app, account = 'QT0001', password = 'Admin@123', totp) {
  const r = await call(app, 'POST', '/api/a/login', { body: { account, password, totp } });
  return r;
}
export const barcodeOf = (app, store, sku) => app.ctx.db.prepare('SELECT barcode FROM pos_products WHERE store_id=? AND sku=?').get(store, sku).barcode;
