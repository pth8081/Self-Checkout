import { nowIso, unauthorized } from '../util.js';
import { hashKey, previewCart, claimCart, orderStatus, orderPaid, orderCancelled, basketPaid, basketCancelled, basketStatus, basketRefund } from '../services/pos-api.js';

/** API cho POS gọi. Xác thực bằng khoá API (Authorization: Bearer <khoá> hoặc X-Api-Key). Chỉ dùng qua HTTPS. */
export default async function posRoutes(app) {
  const { db } = app.ctx;
  const ctx = app.ctx;

  app.addHook('preHandler', async (req) => {
    const h = req.headers.authorization || '';
    const key = h.startsWith('Bearer ') ? h.slice(7).trim() : req.headers['x-api-key'];
    if (!key) throw unauthorized('NO_API_KEY', 'Thiếu khoá API (Authorization: Bearer <khoá>)');
    const row = db.prepare('SELECT * FROM integration_keys WHERE key_hash = ? AND active = 1').get(hashKey(String(key)));
    if (!row) throw unauthorized('BAD_API_KEY', 'Khoá API không đúng hoặc đã bị thu hồi');
    db.prepare('UPDATE integration_keys SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
    req.scope = { keyId: row.id, name: row.name, storeId: row.store_id };
  });

  app.get('/v1/health', async (req) => ({ ok: true, key: req.scope.name, storeScope: req.scope.storeId || 'all' }));
  app.get('/v1/carts/:code', async (req) => ({ cart: previewCart(ctx, req.scope, req.params.code) }));
  app.post('/v1/carts/:code/claim', async (req) => claimCart(ctx, req.scope, req.params.code, req.body || {}));
  // Giỏ QR: POS báo theo mã giỏ có trong mã QR
  app.get('/v1/baskets/:code', async (req) => basketStatus(ctx, req.scope, req.params.code));
  app.post('/v1/baskets/:code/paid', async (req) => basketPaid(ctx, req.scope, req.params.code, req.body || {}));
  app.post('/v1/baskets/:code/refund', async (req) => basketRefund(ctx, req.scope, req.params.code, req.body || {}));
  app.post('/v1/baskets/:code/cancelled', async (req) => basketCancelled(ctx, req.scope, req.params.code, req.body || {}));
  app.get('/v1/orders/:ref', async (req) => orderStatus(ctx, req.scope, req.params.ref));
  app.post('/v1/orders/:ref/paid', async (req) => orderPaid(ctx, req.scope, req.params.ref, req.body || {}));
  app.post('/v1/orders/:ref/cancelled', async (req) => orderCancelled(ctx, req.scope, req.params.ref, req.body || {}));
}
