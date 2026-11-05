import { config } from '../config.js';
import { HttpError, bad, notFound, forbidden, conflict, nowIso, localDate, randomCode } from '../util.js';
import {
  getStoreConfig, storeView, createOrResumeSession, sessionView, applyOps, lockSession, unlockSession, abandonSession, txView
} from '../services/core.js';
import { issueInvoice } from '../services/invoice.js';
import { audit } from '../services/audit.js';
import { normalizeBarcode } from '../services/barcode.js';
import { promoLabel } from '../services/pricing.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export default async function customerRoutes(app) {
  const ctx = app.ctx;
  const { db } = ctx;

  // Khách không đăng nhập: mỗi thiết bị có một mã ngẫu nhiên dài do trình duyệt tạo và giữ bí mật.
  app.addHook('preHandler', async (req) => {
    const id = req.headers['x-device-id'];
    if (req.url.includes('/store') && req.method === 'GET') { req.deviceId = typeof id === 'string' ? id : ''; return; }
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw bad('NO_DEVICE', 'Thiếu mã thiết bị');
    req.deviceId = id;
  });

  const session = (req) => {
    const s = db.prepare('SELECT * FROM scan_sessions WHERE id = ?').get(req.params.id);
    if (!s || s.device_id !== req.deviceId) throw notFound('SESSION_NOT_FOUND', 'Không tìm thấy phiên mua sắm');
    return s;
  };

  const deviceIds = (deviceId) => {
    const emails = db.prepare('SELECT email FROM device_emails WHERE device_id = ?').all(deviceId).map((r) => r.email);
    const ids = new Set([deviceId]);
    for (const e of emails) for (const r of db.prepare('SELECT device_id FROM device_emails WHERE email = ?').all(e)) ids.add(r.device_id);
    return [...ids];
  };
  const ownTx = (req) => {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
    if (!tx || !deviceIds(req.deviceId).includes(tx.device_id)) throw notFound('TX_NOT_FOUND', 'Không tìm thấy đơn hàng');
    return tx;
  };

  // ---- Chi nhánh ----
  app.get('/stores', async () => ({
    stores: db.prepare('SELECT id, name, address, enabled FROM stores ORDER BY name').all().map((s) => ({ ...s, enabled: !!s.enabled }))
  }));
  app.get('/store/:id', async (req) => storeView(db, String(req.params.id).toUpperCase()));

  // Tra cứu sản phẩm theo mã (màn nhập mã bằng tay): chỉ trả thông tin công khai, không thêm vào giỏ.
  app.get('/products/lookup', async (req) => {
    const storeId = String(req.query.storeId || '').toUpperCase();
    getStoreConfig(db, storeId);
    const n = normalizeBarcode(req.query.barcode);
    if (!n.ok) return { found: false, invalid: true };
    const p = ctx.pos.lookup(storeId, n.variants);
    if (!p) return { found: false };
    return { found: true, product: { name: p.name, barcode: p.barcode, price: p.price, unit: p.unit, active: !!p.active, inStock: p.stock > 0,
      promo: promoLabel(p.promo_min_qty, p.promo_off) } };
  });

  // ---- Phiên mua sắm ----
  app.post('/sessions', async (req) => {
    const storeId = String(req.body?.storeId || '').toUpperCase();
    if (req.body?.fresh) {
      const old = db.prepare(`SELECT * FROM scan_sessions WHERE device_id = ? AND store_id = ? AND status IN ('active','locked') ORDER BY started_at DESC`).all(req.deviceId, storeId);
      for (const o of old) { try { abandonSession(ctx, o); } catch { /* đã kết thúc */ } }
    }
    return createOrResumeSession(ctx, storeId, req.deviceId);
  });
  app.get('/sessions/:id', async (req) => ({ session: sessionView(ctx, session(req).id) }));
  app.post('/sessions/:id/ops', async (req) => {
    const s = session(req);
    const results = applyOps(ctx, s, req.body?.ops);
    return { session: sessionView(ctx, s.id), results };
  });
  app.post('/sessions/:id/lock', async (req) => {
    const s = session(req);
    const transaction = lockSession(ctx, s, { method: req.body?.method, acceptChanges: !!req.body?.acceptChanges, buyer: req.body?.buyer });
    return { session: sessionView(ctx, s.id), transaction };
  });
  app.post('/sessions/:id/unlock', async (req) => {
    const s = session(req);
    unlockSession(ctx, s);
    return { session: sessionView(ctx, s.id) };
  });
  app.post('/sessions/:id/abandon', async (req) => { abandonSession(ctx, session(req)); return { ok: true }; });

  // ---- Hoá đơn & đánh giá ----
  app.post('/transactions/:id/invoice', async (req) => {
    const tx = ownTx(req);
    if (tx.status !== 'paid') throw conflict('NOT_PAID', 'Đơn hàng chưa thanh toán');
    const email = String(req.body?.email || '').trim();
    const company = req.body?.company;
    if (email && !EMAIL.test(email)) throw bad('BAD_EMAIL', 'Email không hợp lệ');
    if (company) {
      if (localDate(tx.paid_at) !== localDate()) throw conflict('INVOICE_WINDOW_CLOSED', 'Chỉ xuất được hoá đơn công ty trong ngày phát sinh giao dịch');
      const taxCode = String(company.taxCode || '').replace(/\s/g, '');
      if (!/^\d{10}(-\d{3})?$/.test(taxCode)) throw bad('BAD_TAX_CODE', 'Mã số thuế gồm 10 chữ số (hoặc 13 số có chi nhánh)');
      if (!String(company.name || '').trim() || !String(company.address || '').trim()) throw bad('COMPANY_INFO_REQUIRED', 'Nhập đủ tên công ty và địa chỉ');
      if (!EMAIL.test(email)) throw bad('BAD_EMAIL', 'Nhập email để nhận hoá đơn công ty');
      db.prepare(`UPDATE invoices SET status='replaced' WHERE transaction_id = ? AND type='retail' AND status IN ('issued','pending')`).run(tx.id);
      await issueInvoice(db, ctx.invoicer, tx, { email, taxCode, companyName: company.name.trim(), address: company.address.trim() });
    } else {
      if (!EMAIL.test(email)) throw bad('BAD_EMAIL', 'Email không hợp lệ');
      const inv = db.prepare(`SELECT * FROM invoices WHERE transaction_id = ? AND status != 'replaced' ORDER BY id DESC LIMIT 1`).get(tx.id);
      if (inv) db.prepare('UPDATE invoices SET email = ? WHERE id = ?').run(email, inv.id);
      else await issueInvoice(db, ctx.invoicer, tx, { email });
    }
    audit(db, { storeId: tx.store_id, actorType: 'customer', actorId: req.deviceId.slice(0, 8), action: company ? 'invoice.company_requested' : 'invoice.email_set', entity: 'transaction', entityId: tx.id });
    return { transaction: txView(ctx, tx) };
  });

  app.post('/transactions/:id/rating', async (req) => {
    const tx = ownTx(req);
    const stars = Math.floor(Number(req.body?.stars));
    if (!(stars >= 1 && stars <= 5)) throw bad('BAD_RATING', 'Điểm đánh giá từ 1 đến 5');
    if (tx.status !== 'paid') throw conflict('NOT_PAID', 'Đơn hàng chưa thanh toán');
    db.prepare('UPDATE transactions SET rating = ? WHERE id = ?').run(stars, tx.id);
    return { ok: true };
  });

  // ---- Lịch sử ----
  app.get('/history', async (req) => {
    const ids = deviceIds(req.deviceId);
    const rows = db.prepare(`SELECT t.*, s.name store_name FROM transactions t JOIN stores s ON s.id = t.store_id
      WHERE t.device_id IN (${ids.map(() => '?').join(',')}) AND t.status = 'paid' ORDER BY t.paid_at DESC LIMIT 100`).all(...ids);
    return {
      linkedEmails: db.prepare('SELECT email FROM device_emails WHERE device_id = ?').all(req.deviceId).map((r) => r.email),
      orders: rows.map((t) => ({ id: t.id, storeId: t.store_id, storeName: t.store_name, paidAt: t.paid_at, itemCount: t.item_count, total: t.total, posAmount: t.pos_amount, guardCheck: !t.guard_skipped, method: t.method, exitStatus: t.exit_status }))
    };
  });
  app.get('/history/:id', async (req) => {
    const tx = ownTx(req);
    const store = db.prepare('SELECT name FROM stores WHERE id = ?').get(tx.store_id);
    return { transaction: txView(ctx, tx, { staff: true }), storeName: store?.name };
  });
  app.get('/transactions/:id', async (req) => ({ transaction: txView(ctx, ownTx(req)) }));

  // ---- Xem lịch sử trên máy khác bằng email ----
  app.post('/identity/request', async (req) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw bad('BAD_EMAIL', 'Email không hợp lệ');
    const prev = db.prepare('SELECT expires_at FROM identity_codes WHERE device_id = ? AND email = ?').get(req.deviceId, email);
    if (prev && new Date(prev.expires_at).getTime() - 9 * 60_000 > Date.now()) throw new HttpError(429, 'TOO_SOON', 'Vui lòng đợi một phút trước khi gửi lại mã');
    const code = randomCode(6);
    db.prepare(`INSERT INTO identity_codes(device_id,email,code,expires_at,tries) VALUES(?,?,?,?,0)
      ON CONFLICT(device_id,email) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at, tries=0`)
      .run(req.deviceId, email, code, new Date(Date.now() + 10 * 60_000).toISOString());
    // Chưa nối dịch vụ gửi email: ở môi trường thử trả mã về để kiểm tra, production chỉ ghi log máy chủ.
    if (!config.isProd) return { sent: true, devCode: code };
    app.log.warn({ email }, 'Chưa cấu hình gửi email xác nhận');
    return { sent: true };
  });
  app.post('/identity/verify', async (req) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const row = db.prepare('SELECT * FROM identity_codes WHERE device_id = ? AND email = ?').get(req.deviceId, email);
    if (!row || row.expires_at < nowIso()) throw bad('CODE_EXPIRED', 'Mã đã hết hạn, hãy gửi lại');
    if (row.tries >= 5) throw bad('CODE_LOCKED', 'Nhập sai quá nhiều lần, hãy gửi lại mã');
    if (row.code !== String(req.body?.code || '').trim()) {
      db.prepare('UPDATE identity_codes SET tries = tries + 1 WHERE device_id = ? AND email = ?').run(req.deviceId, email);
      throw bad('CODE_WRONG', 'Mã chưa đúng');
    }
    db.prepare('DELETE FROM identity_codes WHERE device_id = ? AND email = ?').run(req.deviceId, email);
    db.prepare('INSERT OR REPLACE INTO device_emails(device_id,email,verified_at) VALUES(?,?,?)').run(req.deviceId, email, nowIso());
    return { linked: true, email };
  });
  void forbidden;
}
