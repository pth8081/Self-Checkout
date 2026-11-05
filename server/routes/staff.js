import { bad, notFound, nowIso, unauthorized } from '../util.js';
import { authenticate, sign, verifySecret, checkLocked, recordFail, recordOk, canCash, canGate, isManager } from '../auth.js';
import {
  storeView, activeShift, shiftStats, startShift, endShift, findCart, queue, collectPayment, cancelCart,
  txView, gateScan, recordCheck, resolveHeld, gateHistory
} from '../services/core.js';

export const userView = (u) => ({
  id: u.id, name: u.name, role: u.role, storeId: u.store_id, email: u.email, active: !!u.active,
  hasTotp: !!u.totp_secret, canCash: canCash(u), canGate: canGate(u), isManager: isManager(u)
});

export default async function staffRoutes(app) {
  const ctx = app.ctx;
  const { db } = ctx;

  app.post('/login', async (req) => {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const pin = String(req.body?.pin || '');
    const user = db.prepare('SELECT * FROM staff WHERE id = ?').get(code);
    if (!user || !user.active || !user.pin_hash) throw unauthorized('BAD_LOGIN', 'Mã nhân viên hoặc PIN chưa đúng');
    checkLocked(user);
    if (!verifySecret(pin, user.pin_hash)) {
      recordFail(db, user);
      throw unauthorized('BAD_LOGIN', 'Mã nhân viên hoặc PIN chưa đúng');
    }
    if (!user.store_id) throw unauthorized('NO_STORE', 'Tài khoản này không thuộc chi nhánh nào, hãy dùng trang quản trị');
    recordOk(db, user);
    return { token: sign({ uid: user.id, kind: 'staff' }), user: userView(user), store: storeView(db, user.store_id) };
  });

  app.register(async (s) => {
    s.addHook('preHandler', authenticate(db, 'staff'));
    s.addHook('preHandler', async (req) => { if (!req.user.store_id) throw bad('NO_STORE', 'Tài khoản không thuộc chi nhánh nào'); });

    s.get('/me', async (req) => {
      const sh = activeShift(db, req.user.id);
      return { user: userView(req.user), store: storeView(db, req.user.store_id), shift: sh ? { ...sh, stats: shiftStats(db, sh) } : null };
    });

    // ---- Ca ----
    s.post('/shifts/start', async (req) => {
      const sh = startShift(ctx, req.user, req.body?.kind);
      return { shift: { ...sh, stats: shiftStats(db, sh) } };
    });
    s.get('/shifts/current', async (req) => {
      const sh = activeShift(db, req.user.id);
      return { shift: sh ? { ...sh, stats: shiftStats(db, sh) } : null };
    });
    s.post('/shifts/end', async (req) => ({ shift: endShift(ctx, req.user, req.body || {}) }));

    // ---- Thu ngân ----
    s.get('/queue', async (req) => ({ carts: queue(ctx, req.user) }));
    s.get('/carts/lookup', async (req) => {
      const tx = findCart(ctx, req.user, req.query.code);
      return { transaction: txView(ctx, tx, { staff: true }) };
    });
    s.post('/carts/:id/collect', async (req) => collectPayment(ctx, req.user, req.params.id, req.body || {}));
    s.post('/carts/:id/cancel', async (req) => { cancelCart(ctx, req.user, req.params.id, req.body?.reason); return { ok: true }; });

    // ---- Kiểm tra ngẫu nhiên & cổng ra ----
    s.post('/gate/scan', async (req) => gateScan(ctx, req.user, req.body?.raw, req.body?.gate));
    s.post('/checks', async (req) => recordCheck(ctx, req.user, req.body || {}));
    s.post('/transactions/:id/resolve', async (req) => resolveHeld(ctx, req.user, req.params.id, req.body || {}));
    s.get('/gate/history', async (req) => {
      const sh = activeShift(db, req.user.id);
      const rows = gateHistory(ctx, req.user, 60);
      const todayCount = db.prepare(`SELECT COUNT(*) n FROM gate_scans WHERE store_id = ? AND outcome = 'valid' AND ts >= ?`)
        .get(req.user.store_id, sh?.started_at || new Date(Date.now() - 12 * 3600_000).toISOString()).n;
      return { passed: todayCount, scans: rows.map((r) => ({ id: r.id, outcome: r.outcome, transactionId: r.transaction_id, ts: r.ts, staffId: r.staff_id })) };
    });
    s.get('/transactions/:id', async (req) => {
      const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND store_id = ?').get(req.params.id, req.user.store_id);
      if (!tx) throw notFound('CART_NOT_FOUND', 'Không tìm thấy giao dịch');
      return { transaction: txView(ctx, tx, { staff: true }) };
    });
    s.get('/transactions', async (req) => {
      const rows = db.prepare(`SELECT * FROM transactions WHERE store_id = ? AND status IN ('paid','awaiting_counter') AND created_at >= ? ORDER BY created_at DESC LIMIT 40`)
        .all(req.user.store_id, new Date(Date.now() - 12 * 3600_000).toISOString());
      return { transactions: rows.map((t) => txView(ctx, t)) };
    });
  });
  void nowIso;
}
