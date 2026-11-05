import { buildApp } from '../server/app.js';
import { seed } from '../server/seed.js';

export async function makeApp({ rng = () => 0.99, demo = false, basket = false } = {}) {
  const app = buildApp({ dbFile: ':memory:', rng });
  seed(app.ctx.db, { demo });
  // Các kiểm thử cũ chạy luồng cổ điển (thu tại quầy, cổng ra). Chế độ giỏ QR bật bằng { basket: true }.
  if (!basket) app.ctx.db.prepare(`UPDATE store_config SET checkout_mode = 'classic'`).run();
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
