import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';
import { publicSettings, saveSettings, SECURE_MODES, TLS_MODES, explainMailError } from '../services/mailer.js';
import { PORTAL_KEY, PORTAL_PLACEHOLDERS } from '../services/bill.js';
import { HttpError, bad, notFound, forbidden, conflict, nowIso, localDate, sqlLocalDate, money, normCode, unauthorized } from '../util.js';
import { authenticate, sign, hashSecret, verifySecret, checkLocked, recordFail, recordOk, isManager } from '../auth.js';
import { verifyTotp, randomSecret, otpauthUri } from '../services/totp.js';
import { audit } from '../services/audit.js';
import { retryPendingInvoices } from '../services/invoice.js';
import { getStoreConfig, txView, voidTransaction, resolveHeld, shiftStats, markExited } from '../services/core.js';
import { newKey, previewCart, claimCart, orderPaid, orderCancelled, orderStatus } from '../services/pos-api.js';
import { userView } from './staff.js';
import { registerGuides } from './guides.js';

const ROLES = ['chain_admin', 'branch_admin', 'cashier', 'gate', 'cashier_gate'];
const STAFF_ROLES = ['cashier', 'gate', 'cashier_gate'];
const PERMISSIONS = [
  { feature: 'Bật/tắt chi nhánh, tích hợp, cách thanh toán', chain_admin: true, branch_admin: false, cashier: false, gate: false },
  { feature: 'Báo cáo toàn chuỗi', chain_admin: true, branch_admin: false, cashier: false, gate: false },
  { feature: 'Báo cáo, ca, tỷ lệ kiểm tra của chi nhánh', chain_admin: true, branch_admin: true, cashier: false, gate: false },
  { feature: 'Huỷ giao dịch, xử lý ca chờ quản lý', chain_admin: true, branch_admin: true, cashier: false, gate: false },
  { feature: 'Thu tiền', chain_admin: false, branch_admin: false, cashier: true, gate: false },
  { feature: 'Quét QR ra cổng, kiểm tra ngẫu nhiên', chain_admin: false, branch_admin: false, cashier: false, gate: true }
];

const rate = (v, name) => {
  const n = Number(v);
  if (!(n >= 0 && n <= 1)) throw bad('BAD_RATE', `${name} phải từ 0% đến 100%`);
  return n;
};

export default async function adminRoutes(app) {
  const ctx = app.ctx;
  const { db } = ctx;

  // ---------------- Đăng nhập (mật khẩu + mã xác thực 2 bước nếu đã bật) ----------------
  app.post('/login', async (req) => {
    const account = String(req.body?.account || '').trim();
    const user = db.prepare('SELECT * FROM staff WHERE (id = ? COLLATE NOCASE OR email = ? COLLATE NOCASE)').get(account, account);
    const fail = () => unauthorized('BAD_LOGIN', 'Tài khoản hoặc mật khẩu chưa đúng');
    if (!user || !user.active || !user.pw_hash || !isManager(user)) throw fail();
    checkLocked(user);
    if (!verifySecret(String(req.body?.password || ''), user.pw_hash)) { recordFail(db, user); throw fail(); }
    if (user.totp_secret) {
      if (!req.body?.totp) throw unauthorized('TOTP_REQUIRED', 'Nhập mã xác thực 6 số từ app xác thực');
      if (!verifyTotp(user.totp_secret, req.body.totp)) { recordFail(db, user); throw unauthorized('BAD_TOTP', 'Mã xác thực chưa đúng'); }
    }
    recordOk(db, user);
    audit(db, { storeId: user.store_id, actorType: 'admin', actorId: user.id, action: 'admin.login' });
    return { token: sign({ uid: user.id, kind: 'admin' }, 8), user: userView(user) };
  });

  app.register(async (s) => {
    s.addHook('preHandler', authenticate(db, 'admin'));

    const chainOnly = (req) => { if (req.user.role !== 'chain_admin') throw forbidden('CHAIN_ONLY', 'Chỉ quản trị chuỗi mới thực hiện được'); };
    /** Chi nhánh đang xem: quản trị chi nhánh bị khoá ở chi nhánh của mình. */
    const storeOf = (req) => {
      const id = req.user.role === 'branch_admin' ? req.user.store_id : String(req.query?.storeId || req.body?.storeId || '').toUpperCase();
      if (!id) throw bad('STORE_REQUIRED', 'Chọn chi nhánh');
      getStoreConfig(db, id);
      return id;
    };
    const txScoped = (req) => {
      const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
      if (!tx || (req.user.role === 'branch_admin' && tx.store_id !== req.user.store_id)) throw notFound('TX_NOT_FOUND', 'Không tìm thấy giao dịch');
      return tx;
    };

    registerGuides(s);

    s.get('/me', async (req) => ({
      user: userView(req.user), permissions: PERMISSIONS,
      stores: db.prepare('SELECT id, name, enabled FROM stores ORDER BY name').all()
        .filter((x) => req.user.role === 'chain_admin' || x.id === req.user.store_id).map((x) => ({ ...x, enabled: !!x.enabled }))
    }));

    // ---------------- Thống kê dùng chung ----------------
    const dayStats = (storeId, date) => {
      const w = storeId ? 'AND p.store_id = ?' : '';
      const a = storeId ? [date, storeId] : [date];
      const p = db.prepare(`SELECT COUNT(CASE WHEN kind='main' THEN 1 END) tx, COALESCE(SUM(amount),0) revenue,
        COALESCE(SUM(CASE WHEN method='cash' THEN amount END),0) cash, COALESCE(SUM(CASE WHEN method='qr_transfer' THEN amount END),0) transfer,
        COALESCE(SUM(CASE WHEN method NOT IN ('cash','qr_transfer') THEN amount END),0) other
        FROM payments p WHERE voided_at IS NULL AND ${sqlLocalDate('collected_at')} = ? ${w}`).get(...a);
      const w2 = storeId ? 'AND store_id = ?' : '';
      const c = db.prepare(`SELECT COUNT(*) checks, COALESCE(SUM(result='mismatch'),0) mismatches FROM exit_checks WHERE ${sqlLocalDate('created_at')} = ? ${w2}`).get(...a);
      return { ...p, checks: c.checks, mismatches: c.mismatches };
    };
    const lagMinutes = (storeId) => {
      const t = ctx.pos.lastSync(storeId);
      return t ? Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000)) : null;
    };

    // ---------------- A01 Tổng quan chuỗi ----------------
    s.get('/overview', async (req) => {
      chainOnly(req);
      const date = String(req.query.date || localDate());
      const total = dayStats(null, date);
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = localDate(new Date(new Date(`${date}T12:00:00Z`).getTime() - i * 86400_000).toISOString());
        days.push({ date: d, revenue: dayStats(null, d).revenue });
      }
      const stores = db.prepare('SELECT s.*, c.pos_stale_minutes stale FROM stores s JOIN store_config c ON c.store_id = s.id ORDER BY s.name').all().map((st) => {
        const d = dayStats(st.id, date); const lag = lagMinutes(st.id);
        return { id: st.id, name: st.name, enabled: !!st.enabled, tx: d.tx, revenue: d.revenue,
          mismatchRate: d.tx ? d.mismatches / d.tx : null, posLagMinutes: lag, posStale: lag != null && lag > st.stale, staleLimit: st.stale };
      });
      const enabled = stores.filter((x) => x.enabled).length;
      return {
        date,
        tiles: { transactions: total.tx, revenue: total.revenue, mismatchRate: total.tx ? total.mismatches / total.tx : 0, enabledStores: enabled, totalStores: stores.length },
        revenue7: days, stores,
        alerts: {
          stalePos: stores.filter((x) => x.enabled && x.posStale).map((x) => ({ id: x.id, name: x.name, lag: x.posLagMinutes, limit: x.staleLimit })),
          pendingInvoices: db.prepare(`SELECT COUNT(*) n FROM invoices WHERE status='pending'`).get().n,
          held: db.prepare(`SELECT COUNT(*) n FROM transactions WHERE exit_status='held'`).get().n
        }
      };
    });

    // ---------------- A02/A03 Chi nhánh & cấu hình ----------------
    const storeRow = (st) => {
      const c = db.prepare('SELECT * FROM store_config WHERE store_id = ?').get(st.id);
      return {
        id: st.id, name: st.name, address: st.address, enabled: !!st.enabled, posCode: st.pos_code,
        config: { payCash: !!c.pay_cash, payQr: !!c.pay_qr, payOnline: !!c.pay_online, qrProvider: c.qr_provider,
          randomCheckRate: c.random_check_rate, rateFirstTime: c.rate_first_time, rateHighValue: c.rate_high_value, highValueThreshold: c.high_value_threshold,
          bank: { bin: c.bank_bin, name: c.bank_name, account: c.bank_account, holder: c.bank_holder }, posStaleMinutes: c.pos_stale_minutes,
          paymentSource: c.payment_source, guardCheck: !!c.guard_check, checkoutMode: c.checkout_mode }
      };
    };
    s.get('/stores', async (req) => ({
      stores: db.prepare('SELECT * FROM stores ORDER BY name').all().filter((x) => req.user.role === 'chain_admin' || x.id === req.user.store_id).map(storeRow)
    }));
    // Mã điểm: mã của chi nhánh trong hệ thống giá/POS, để BRG gọi đúng cửa hàng.
    const cleanPosCode = (v, selfId) => {
      const c = String(v ?? '').trim();
      if (!c) return '';
      if (!/^[A-Za-z0-9_.\-/]{1,40}$/.test(c)) throw bad('BAD_POS_CODE', 'Mã điểm gồm chữ, số, dấu - _ . / tối đa 40 ký tự');
      const dup = db.prepare('SELECT id FROM stores WHERE lower(pos_code) = lower(?) AND id <> ?').get(c, selfId || '');
      if (dup) throw conflict('DUPLICATE_POS_CODE', `Mã điểm này đã gán cho chi nhánh ${dup.id}`);
      return c;
    };
    s.post('/stores', async (req) => {
      chainOnly(req);
      const id = String(req.body?.id || '').trim().toUpperCase();
      const name = String(req.body?.name || '').trim();
      if (!/^[A-Z0-9]{1,6}$/.test(id)) throw bad('BAD_ID', 'Mã chi nhánh gồm 1–6 chữ hoa hoặc số');
      if (!name) throw bad('NAME_REQUIRED', 'Nhập tên chi nhánh');
      if (db.prepare('SELECT 1 FROM stores WHERE id = ?').get(id)) throw conflict('DUPLICATE', 'Mã chi nhánh đã tồn tại');
      const posCode = cleanPosCode(req.body?.posCode, id);
      db.transaction(() => {
        db.prepare('INSERT INTO stores(id,name,address,enabled,created_at,pos_code) VALUES(?,?,?,0,?,?)').run(id, name, String(req.body?.address || ''), nowIso(), posCode);
        db.prepare('INSERT INTO store_config(store_id) VALUES(?)').run(id);
        audit(db, { storeId: id, actorType: 'admin', actorId: req.user.id, action: 'store.created', entity: 'store', entityId: id });
      })();
      return { store: storeRow(db.prepare('SELECT * FROM stores WHERE id = ?').get(id)) };
    });
    s.put('/stores/:id', async (req) => {
      const id = String(req.params.id).toUpperCase();
      const st = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
      if (!st) throw notFound('STORE_NOT_FOUND', 'Không tìm thấy chi nhánh');
      if (req.user.role === 'branch_admin' && id !== req.user.store_id) throw forbidden();
      const b = req.body || {};
      if (b.enabled !== undefined || b.posCode !== undefined) chainOnly(req);
      const posCode = b.posCode === undefined ? st.pos_code : cleanPosCode(b.posCode, id);
      if (!posCode && st.enabled && (b.enabled === undefined || b.enabled) && db.prepare("SELECT 1 FROM store_config WHERE store_id = ? AND checkout_mode = 'basket'").get(id)) throw conflict('NO_POS_CODE', 'Chi nhánh đang bật nên không được xoá Mã điểm. Hãy tắt chi nhánh trước');
      if (b.enabled === true) {
        const c = db.prepare('SELECT * FROM store_config WHERE store_id = ?').get(id);
        if (c.checkout_mode !== 'basket' && c.payment_source !== 'pos' && !c.pay_cash && !(c.pay_qr && c.bank_bin && c.bank_account)) throw conflict('NO_PAYMENT', 'Hãy bật ít nhất một cách thanh toán dùng được trước khi bật chi nhánh');
        if (!db.prepare('SELECT 1 FROM product_cache WHERE store_id = ? LIMIT 1').get(id)) throw conflict('NO_PRODUCTS', 'Chi nhánh chưa có dữ liệu sản phẩm, hãy đồng bộ POS trước');
        if (c.checkout_mode === 'basket' && !posCode) throw conflict('NO_POS_CODE', 'Hãy nhập Mã điểm của chi nhánh (mã trong hệ thống giá và POS) trước khi bật');
      }
      db.prepare('UPDATE stores SET name = ?, address = ?, enabled = ?, pos_code = ? WHERE id = ?')
        .run(b.name?.trim() || st.name, b.address ?? st.address, b.enabled === undefined ? st.enabled : (b.enabled ? 1 : 0), posCode, id);
      audit(db, { storeId: id, actorType: 'admin', actorId: req.user.id, action: 'store.updated', entity: 'store', entityId: id, data: b });
      return { store: storeRow(db.prepare('SELECT * FROM stores WHERE id = ?').get(id)) };
    });
    s.put('/stores/:id/config', async (req) => {
      const id = String(req.params.id).toUpperCase();
      getStoreConfig(db, id);
      const b = req.body || {};
      const branchFields = ['randomCheckRate', 'rateFirstTime', 'rateHighValue', 'highValueThreshold'];
      if (req.user.role === 'branch_admin') {
        if (id !== req.user.store_id) throw forbidden();
        if (Object.keys(b).some((k) => !branchFields.includes(k))) throw forbidden('CHAIN_ONLY', 'Quản trị chi nhánh chỉ đổi được tỷ lệ kiểm tra ngẫu nhiên');
      }
      const cur = db.prepare('SELECT * FROM store_config WHERE store_id = ?').get(id);
      const n = { ...cur };
      if (b.payCash !== undefined) n.pay_cash = b.payCash ? 1 : 0;
      if (b.payQr !== undefined) n.pay_qr = b.payQr ? 1 : 0;
      if (b.payOnline) throw bad('NOT_AVAILABLE', 'Thanh toán online chưa được tích hợp nên chưa bật được');
      if (b.qrProvider !== undefined) {
        if (b.qrProvider !== 'self') throw bad('NOT_CONFIGURED', 'QR từ nhà cung cấp chưa được cấu hình nên chưa chọn được');
        n.qr_provider = 'self';
      }
      if (b.randomCheckRate !== undefined) n.random_check_rate = rate(b.randomCheckRate, 'Tỷ lệ kiểm tra mặc định');
      if (b.rateFirstTime !== undefined) n.rate_first_time = rate(b.rateFirstTime, 'Tỷ lệ khách lần đầu');
      if (b.rateHighValue !== undefined) n.rate_high_value = rate(b.rateHighValue, 'Tỷ lệ giỏ giá trị cao');
      if (b.highValueThreshold !== undefined) {
        const t = money(b.highValueThreshold);
        if (!(t >= 0)) throw bad('BAD_AMOUNT', 'Ngưỡng giá trị không hợp lệ');
        n.high_value_threshold = t;
      }
      if (b.posStaleMinutes !== undefined) {
        const m = Math.floor(Number(b.posStaleMinutes));
        if (!(m >= 1 && m <= 1440)) throw bad('BAD_STALE', 'Ngưỡng cảnh báo từ 1 đến 1440 phút');
        n.pos_stale_minutes = m;
      }
      if (b.paymentSource !== undefined) {
        if (!['manual', 'pos'].includes(b.paymentSource)) throw bad('BAD_SOURCE', 'Nguồn thu tiền chỉ có manual hoặc pos');
        if (b.paymentSource === 'pos' && !db.prepare('SELECT 1 FROM integration_keys WHERE active = 1 AND (store_id IS NULL OR store_id = ?)').get(id)) {
          throw conflict('NO_POS_KEY', 'Chưa có khoá API cho POS dùng được ở chi nhánh này. Hãy tạo khoá ở mục Tích hợp trước');
        }
        if (b.paymentSource !== cur.payment_source) {
          const pend = db.prepare(`SELECT COUNT(*) n FROM transactions WHERE store_id = ? AND status = 'awaiting_counter'`).get(id).n;
          if (pend) throw conflict('CARTS_PENDING', `Còn ${pend} giỏ đang chờ thu. Hãy thu hoặc huỷ hết rồi mới đổi cách thu tiền`);
        }
        n.payment_source = b.paymentSource;
      }
      if (b.guardCheck !== undefined) n.guard_check = b.guardCheck ? 1 : 0;
      if (b.checkoutMode !== undefined) {
        if (!['basket', 'classic'].includes(b.checkoutMode)) throw bad('BAD_MODE', 'Chế độ chỉ có basket hoặc classic');
        if (b.checkoutMode !== cur.checkout_mode) {
          const pend = db.prepare(`SELECT COUNT(*) n FROM transactions WHERE store_id = ? AND status = 'awaiting_counter'`).get(id).n;
          if (pend) throw conflict('CARTS_PENDING', `Còn ${pend} giỏ đang chờ. Hãy xử lý hết rồi mới đổi chế độ`);
        }
        n.checkout_mode = b.checkoutMode;
      }
      if (b.bank) {
        const k = b.bank;
        if (k.bin !== undefined && k.bin !== '' && !/^\d{6}$/.test(k.bin)) throw bad('BAD_BIN', 'Mã ngân hàng (BIN) gồm 6 chữ số');
        if (k.account !== undefined && k.account !== '' && !/^\d{4,19}$/.test(k.account)) throw bad('BAD_ACCOUNT', 'Số tài khoản gồm 4–19 chữ số');
        n.bank_bin = k.bin ?? cur.bank_bin; n.bank_name = k.name ?? cur.bank_name; n.bank_account = k.account ?? cur.bank_account; n.bank_holder = k.holder ?? cur.bank_holder;
      }
      if (n.pay_qr && (!n.bank_bin || !n.bank_account) && b.payQr) throw bad('BANK_REQUIRED', 'Nhập ngân hàng và số tài khoản nhận trước khi bật chuyển khoản QR');
      db.prepare(`UPDATE store_config SET pay_cash=?,pay_qr=?,pay_online=0,qr_provider=?,random_check_rate=?,rate_first_time=?,rate_high_value=?,
        high_value_threshold=?,bank_bin=?,bank_name=?,bank_account=?,bank_holder=?,pos_stale_minutes=?,payment_source=?,guard_check=?,checkout_mode=? WHERE store_id=?`)
        .run(n.pay_cash, n.pay_qr, n.qr_provider, n.random_check_rate, n.rate_first_time, n.rate_high_value, n.high_value_threshold,
          n.bank_bin, n.bank_name, n.bank_account, n.bank_holder, n.pos_stale_minutes, n.payment_source, n.guard_check, n.checkout_mode, id);
      // Tắt bước bảo vệ: những khách đã thanh toán mà chưa ra cổng coi như đã ra (không còn ai quét QR).
      if (cur.guard_check && !n.guard_check) {
        for (const t of db.prepare(`SELECT * FROM transactions WHERE store_id = ? AND status = 'paid' AND exit_status != 'exited'`).all(id)) markExited(db, t, { id: 'SYSTEM' }, 'Tắt bước bảo vệ');
      }
      audit(db, { storeId: id, actorType: 'admin', actorId: req.user.id, action: 'store.config_updated', entity: 'store', entityId: id, data: b });
      return { store: storeRow(db.prepare('SELECT * FROM stores WHERE id = ?').get(id)) };
    });

    // ---------------- Link khai báo hoá đơn điện tử của nhà cung cấp ----------------
    s.get('/integrations/invoice-portal', async (req) => { chainOnly(req); return { url: getSetting(db, PORTAL_KEY, {}).url || '', placeholders: PORTAL_PLACEHOLDERS }; });
    s.put('/integrations/invoice-portal', async (req) => {
      chainOnly(req);
      const url = String(req.body?.url ?? '').trim();
      if (url) {
        if (url.length > 600 || !/^https:\/\/[^\s]+$/.test(url)) throw bad('BAD_URL', 'Link phải bắt đầu bằng https:// và không có khoảng trắng');
        const sample = Object.keys(PORTAL_PLACEHOLDERS).reduce((u, k) => u.split(k).join('X'), url);
        try { new URL(sample); } catch { throw bad('BAD_URL', 'Link không hợp lệ'); }
        const unknown = (url.match(/\{[^}]*\}/g) || []).filter((k) => !PORTAL_PLACEHOLDERS[k]);
        if (unknown.length) throw bad('BAD_PLACEHOLDER', `Ký hiệu không có: ${unknown.join(' ')}. Chỉ dùng ${Object.keys(PORTAL_PLACEHOLDERS).join(' ')}`);
      }
      setSetting(db, PORTAL_KEY, { url });
      audit(db, { actorType: 'admin', actorId: req.user.id, action: 'invoice_portal.saved', entity: 'settings', entityId: PORTAL_KEY, data: { url } });
      return { url };
    });

    // ---------------- Email (gửi mã xác nhận và bill cho khách) ----------------
    s.get('/integrations/email', async (req) => { chainOnly(req); return { email: publicSettings(db), secureModes: SECURE_MODES, tlsModes: TLS_MODES, publicUrl: config.publicUrl || null }; });
    s.put('/integrations/email', async (req) => {
      chainOnly(req);
      let r;
      try { r = saveSettings(db, req.body || {}); } catch (e) { if (/^(BAD_|CA_REQUIRED)/.test(e.code || '')) throw bad(e.code, e.message); throw e; }
      audit(db, { actorType: 'admin', actorId: req.user.id, action: 'email.config_saved', entity: 'settings', entityId: 'email', data: { host: r.host, port: r.port, secure: r.secure, user: r.user, from: r.from, tlsMode: r.tlsMode, caFingerprint: r.ca?.fingerprint || null } });
      return { email: r };
    });
    s.post('/integrations/email/test', async (req) => {
      chainOnly(req);
      const to = String(req.body?.to || '').trim();
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw bad('BAD_EMAIL', 'Nhập email nhận thử');
      if (!ctx.mailer.enabled()) throw conflict('EMAIL_NOT_CONFIGURED', 'Hãy lưu máy chủ SMTP và địa chỉ người gửi trước');
      try {
        await ctx.mailer.send({ to, subject: 'Email thử từ BRG Scan & Checkout', text: 'Nếu bạn đọc được email này thì cấu hình gửi email đã đúng.', html: '<p>Nếu bạn đọc được email này thì cấu hình gửi email của <b>BRG Scan &amp; Checkout</b> đã đúng.</p>' });
      } catch (e) {
        audit(db, { actorType: 'admin', actorId: req.user.id, action: 'email.test_failed', entity: 'settings', entityId: 'email', data: { error: String(e.message).slice(0, 200) } });
        throw new HttpError(502, 'EMAIL_TEST_FAILED', `Gửi thử không được. ${explainMailError(e)}`);
      }
      audit(db, { actorType: 'admin', actorId: req.user.id, action: 'email.test_sent', entity: 'settings', entityId: 'email', data: { to } });
      return { ok: true };
    });

    // ---------------- Tích hợp ----------------
    s.get('/integrations', async (req) => {
      chainOnly(req);
      const einv = getSetting(db, 'einvoice', {});
      return {
        pos: {
          adapter: ctx.pos.name, connected: true,
          stores: db.prepare('SELECT s.id, s.name, s.pos_code, c.pos_stale_minutes stale FROM stores s JOIN store_config c ON c.store_id = s.id ORDER BY s.name').all().map((st) => {
            const lag = lagMinutes(st.id);
            const unknown = db.prepare(`SELECT COUNT(*) n FROM unknown_barcodes WHERE store_id = ? AND status != 'resolved' AND last_seen >= ?`).get(st.id, new Date(Date.now() - 86400_000).toISOString()).n;
            return { id: st.id, name: st.name, lastSync: ctx.pos.lastSync(st.id), lagMinutes: lag, stale: lag != null && lag > st.stale, staleLimit: st.stale, unknownBarcodes: unknown, posCode: st.pos_code };
          })
        },
        einvoice: { provider: ctx.invoicer.name, configured: ctx.invoicer.name !== 'mock', failNext: !!einv.failNext,
          pending: db.prepare(`SELECT COUNT(*) n FROM invoices WHERE status='pending'`).get().n, issued: db.prepare(`SELECT COUNT(*) n FROM invoices WHERE status='issued'`).get().n },
        transfer: { qrProvider: 'self', providerAvailable: false },
        posApi: (() => {
          const since = new Date(Date.now() - 86400_000).toISOString();
          const n = (w) => db.prepare(`SELECT COUNT(*) n FROM transactions WHERE pos_order_ref IS NOT NULL AND pos_claimed_at >= ? ${w}`).get(since).n;
          return { keys: db.prepare('SELECT COUNT(*) n FROM integration_keys WHERE active = 1').get().n, lastUsedAt: db.prepare('SELECT MAX(last_used_at) t FROM integration_keys').get().t,
            last24h: { claimed: n(''), paid: n(`AND pos_status = 'paid'`), cancelled: n(`AND pos_status = 'cancelled'`), differs: n(`AND pos_amount IS NOT NULL AND pos_amount != total`), waiting: n(`AND pos_status = 'claimed'`) } };
        })(),
        isProd: config.isProd,
        hasClassicStores: !!db.prepare(`SELECT 1 FROM store_config WHERE checkout_mode = 'classic' LIMIT 1`).get(), // luồng cũ đang khoá: chỉ khi còn chi nhánh dùng mới hiện thẻ chuyển khoản QR và hoá đơn của BRG
        // Nguồn giá: bảng giá nhập bằng CSV (bản giả lập chạy trên chính bảng này) cho tới khi nối API giá thật.
        priceSource: ctx.pos.name === 'mock' ? 'csv' : ctx.pos.name,
        note: ctx.pos.name !== 'mock' ? null
          : config.isProd ? 'Giá và khuyến mãi đang lấy từ bảng giá nhập bằng file CSV (npm run import-products). Chưa nối API giá theo chi nhánh nên giá không tự cập nhật.'
          : 'POS và hoá đơn điện tử đang chạy bản giả lập. Gắn hệ thống thật bằng cách viết adapter tương ứng (xem docs/07).'
      };
    });
    s.post('/integrations/pos/sync', async (req) => {
      chainOnly(req);
      const id = req.body?.storeId ? String(req.body.storeId).toUpperCase() : null;
      const r = id ? [ctx.pos.sync(id)] : ctx.pos.syncAll();
      audit(db, { actorType: 'admin', actorId: req.user.id, action: 'pos.sync', data: { storeId: id } });
      return { results: r };
    });
    s.post('/integrations/invoices/retry', async (req) => { chainOnly(req); return retryPendingInvoices(db, ctx.invoicer); });

    // ---------------- Khoá API cho POS gọi vào ----------------
    s.get('/pos/keys', async (req) => {
      chainOnly(req);
      return { keys: db.prepare('SELECT id, name, prefix, store_id, active, created_by, created_at, last_used_at FROM integration_keys ORDER BY id DESC').all()
        .map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, storeId: k.store_id, active: !!k.active, createdBy: k.created_by, createdAt: k.created_at, lastUsedAt: k.last_used_at })) };
    });
    s.post('/pos/keys', async (req) => {
      chainOnly(req);
      const name = String(req.body?.name || '').trim();
      if (!name) throw bad('NAME_REQUIRED', 'Đặt tên cho khoá (ví dụ tên phần mềm POS)');
      const storeId = req.body?.storeId ? String(req.body.storeId).toUpperCase() : null;
      if (storeId) getStoreConfig(db, storeId);
      const k = newKey();
      const r = db.prepare('INSERT INTO integration_keys(name,key_hash,prefix,store_id,created_by,created_at) VALUES(?,?,?,?,?,?)').run(name.slice(0, 60), k.hash, k.prefix, storeId, req.user.id, nowIso());
      audit(db, { storeId, actorType: 'admin', actorId: req.user.id, action: 'pos.key_created', entity: 'integration_key', entityId: String(r.lastInsertRowid), data: { name } });
      return { id: r.lastInsertRowid, key: k.raw, prefix: k.prefix, note: 'Khoá chỉ hiện một lần, hãy chép và gửi cho nhà cung cấp POS' };
    });
    s.delete('/pos/keys/:id', async (req) => {
      chainOnly(req);
      const r = db.prepare('UPDATE integration_keys SET active = 0 WHERE id = ?').run(Number(req.params.id));
      if (!r.changes) throw notFound('KEY_NOT_FOUND', 'Không tìm thấy khoá');
      audit(db, { actorType: 'admin', actorId: req.user.id, action: 'pos.key_revoked', entity: 'integration_key', entityId: String(req.params.id) });
      return { ok: true };
    });
    s.get('/pos/orders', async (req) => {
      const storeId = storeOf(req);
      const where = ['store_id = ?', 'pos_order_ref IS NOT NULL']; const args = [storeId];
      if (req.query.status) { where.push('pos_status = ?'); args.push(String(req.query.status)); }
      const rows = db.prepare(`SELECT * FROM transactions WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`).all(...args);
      return { orders: rows.map((t) => ({ transactionId: t.id, code: t.cart_code, posOrderRef: t.pos_order_ref, posStatus: t.pos_status, status: t.status, brgTotal: t.total, posAmount: t.pos_amount,
        differs: t.pos_amount != null && t.pos_amount !== t.total, invoiceNo: t.pos_invoice_no, cashier: t.pos_cashier, terminal: t.pos_terminal, claimedAt: t.pos_claimed_at, paidAt: t.paid_at, exitStatus: t.exit_status })) };
    });

    // Giải cứu khách khi POS đã nhận giỏ nhưng không báo kết quả (POS sập giữa chừng): quản lý nhả giỏ về cho khách.
    // Nếu sau đó POS vẫn báo "đã thanh toán" cho đơn này thì BRG từ chối (ORDER_CANCELLED) và cần đối soát tay.
    s.post('/pos/orders/:id/release', async (req) => {
      const tx = txScoped(req);
      if (tx.status !== 'awaiting_counter' || tx.pos_status !== 'claimed') throw conflict('NOT_CLAIMED', 'Chỉ nhả được giỏ đã được POS nhận mà chưa thanh toán');
      const reason = String(req.body?.reason || '').trim();
      if (!reason) throw bad('REASON_REQUIRED', 'Hãy nhập lý do nhả giỏ');
      db.transaction(() => {
        db.prepare(`UPDATE transactions SET status='cancelled', pos_status='cancelled' WHERE id = ?`).run(tx.id);
        db.prepare(`UPDATE scan_sessions SET status='active', last_activity = ? WHERE id = ?`).run(nowIso(), tx.session_id);
        audit(db, { storeId: tx.store_id, actorType: 'admin', actorId: req.user.id, action: 'pos.released', entity: 'transaction', entityId: tx.id, data: { reason, posOrderRef: tx.pos_order_ref } });
      })();
      return { ok: true };
    });

    // Công cụ thử nghiệm: giả lập POS đổi giá/tồn kho (không có khi chạy production).
    s.post('/dev/pos-product', async (req) => {
      chainOnly(req);
      if (config.isProd) throw forbidden('DEV_ONLY', 'Chỉ dùng ở môi trường thử');
      const b = req.body || {};
      const id = String(b.storeId || '').toUpperCase();
      const row = db.prepare('SELECT * FROM pos_products WHERE store_id = ? AND sku = ?').get(id, String(b.sku || ''));
      if (!row) throw notFound('PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm trong POS giả lập');
      db.prepare('UPDATE pos_products SET price=?, stock=?, active=?, updated_at=? WHERE store_id=? AND sku=?')
        .run(b.price ?? row.price, b.stock ?? row.stock, b.active === undefined ? row.active : (b.active ? 1 : 0), nowIso(), id, row.sku);
      if (b.sync) ctx.pos.sync(id);
      return { ok: true };
    });
    // Công cụ thử nghiệm: đóng vai POS gọi API (nhận giỏ, báo thanh toán, báo huỷ) mà không cần khoá API.
    s.post('/dev/pos-simulate', async (req) => {
      chainOnly(req);
      if (config.isProd) throw forbidden('DEV_ONLY', 'Chỉ dùng ở môi trường thử');
      const b = req.body || {};
      const scope = { keyId: 0, name: 'Giả lập POS', storeId: null };
      const ref = String(b.ref || '');
      switch (b.action) {
        case 'preview': return { result: previewCart(ctx, scope, b.code) };
        case 'claim': return claimCart(ctx, scope, b.code, { posOrderRef: ref, cashier: b.cashier, terminal: b.terminal });
        case 'paid': return orderPaid(ctx, scope, ref, { amount: Number(b.amount), method: b.method, invoiceNo: b.invoiceNo, cashier: b.cashier });
        case 'cancelled': return orderCancelled(ctx, scope, ref, { reason: b.reason });
        case 'status': return orderStatus(ctx, scope, ref);
        default: throw bad('BAD_ACTION', 'action phải là preview, claim, paid, cancelled hoặc status');
      }
    });
    s.get('/dev/pos-products', async (req) => {
      chainOnly(req);
      if (config.isProd) throw forbidden('DEV_ONLY', 'Chỉ dùng ở môi trường thử');
      return { products: db.prepare('SELECT sku, barcode, name, price, stock, active FROM pos_products WHERE store_id = ? ORDER BY name').all(storeOf(req)) };
    });

    // ---------------- A04 Báo cáo ----------------
    const buildReport = (req) => {
      const from = String(req.query.from || localDate(new Date(Date.now() - 6 * 86400_000).toISOString()));
      const to = String(req.query.to || localDate());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw bad('BAD_RANGE', 'Khoảng ngày không hợp lệ');
      if ((new Date(to) - new Date(from)) / 86400_000 > 92) throw bad('RANGE_TOO_LONG', 'Chọn tối đa 93 ngày');
      let storeId = null;
      if (req.user.role === 'branch_admin') storeId = req.user.store_id;
      else if (req.query.storeId && req.query.storeId !== 'all') storeId = String(req.query.storeId).toUpperCase();
      const rows = [];
      for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86400_000)) {
        const date = d.toISOString().slice(0, 10);
        rows.push({ date, ...dayStats(storeId, date) });
      }
      const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
      const totals = { tx: sum('tx'), revenue: sum('revenue'), cash: sum('cash'), transfer: sum('transfer'), other: sum('other'), checks: sum('checks'), mismatches: sum('mismatches') };
      totals.mismatchRate = totals.tx ? totals.mismatches / totals.tx : 0;
      return { from, to, storeId, rows, totals };
    };
    s.get('/reports', async (req) => buildReport(req));
    s.get('/reports.csv', async (req, reply) => {
      const r = buildReport(req);
      const lines = ['Ngày,Giao dịch,Doanh thu,Tiền mặt,Chuyển khoản,Khác,Lượt kiểm tra,Chênh lệch'];
      for (const x of r.rows) lines.push([x.date, x.tx, x.revenue, x.cash, x.transfer, x.other, x.checks, x.mismatches].join(','));
      lines.push(['Tổng', r.totals.tx, r.totals.revenue, r.totals.cash, r.totals.transfer, r.totals.other, r.totals.checks, r.totals.mismatches].join(','));
      reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="bao-cao-${r.from}-${r.to}.csv"`);
      return '﻿' + lines.join('\r\n');
    });

    // ---------------- A05 Tài khoản & phân quyền ----------------
    const strongPassword = (p) => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
    const validPin = (p) => /^\d{4,6}$/.test(String(p || ''));
    const userScoped = (req) => {
      const u = db.prepare('SELECT * FROM staff WHERE id = ?').get(String(req.params.id).toUpperCase());
      if (!u) throw notFound('USER_NOT_FOUND', 'Không tìm thấy tài khoản');
      if (req.user.role === 'branch_admin' && (u.store_id !== req.user.store_id || !STAFF_ROLES.includes(u.role))) throw forbidden();
      return u;
    };
    s.get('/users', async (req) => {
      const rows = req.user.role === 'branch_admin'
        ? db.prepare('SELECT * FROM staff WHERE store_id = ? ORDER BY id').all(req.user.store_id)
        : db.prepare('SELECT * FROM staff ORDER BY id').all();
      return { users: rows.map(userView), permissions: PERMISSIONS };
    });
    s.post('/users', async (req) => {
      const b = req.body || {};
      const role = b.role;
      if (!ROLES.includes(role)) throw bad('BAD_ROLE', 'Vai trò không hợp lệ');
      let storeId = b.storeId ? String(b.storeId).toUpperCase() : null;
      if (req.user.role === 'branch_admin') {
        if (!STAFF_ROLES.includes(role)) throw forbidden('CHAIN_ONLY', 'Chỉ quản trị chuỗi tạo được quản trị viên');
        storeId = req.user.store_id;
      }
      if (role !== 'chain_admin') { if (!storeId) throw bad('STORE_REQUIRED', 'Chọn chi nhánh cho tài khoản này'); getStoreConfig(db, storeId); } else storeId = null;
      if (!String(b.name || '').trim()) throw bad('NAME_REQUIRED', 'Nhập họ tên');
      const isAdminRole = role === 'chain_admin' || role === 'branch_admin';
      // PIN dùng để vào app nhân viên: bắt buộc với nhân viên, tuỳ chọn với quản trị.
      if ((!isAdminRole || b.pin) && !validPin(b.pin)) throw bad('BAD_PIN', 'PIN gồm 4–6 chữ số');
      if (isAdminRole && !strongPassword(b.password)) throw bad('WEAK_PASSWORD', 'Mật khẩu tối thiểu 8 ký tự, có cả chữ và số');
      let id = String(b.id || '').trim().toUpperCase();
      if (!id) {
        const prefix = isAdminRole ? 'QT' : 'NV';
        const max = db.prepare(`SELECT id FROM staff WHERE id LIKE ? ORDER BY id DESC LIMIT 1`).get(`${prefix}%`);
        id = prefix + String((max ? parseInt(max.id.slice(2), 10) || 0 : 0) + 1).padStart(4, '0');
      }
      if (!/^[A-Z0-9]{3,10}$/.test(id)) throw bad('BAD_ID', 'Mã tài khoản gồm 3–10 chữ hoa hoặc số');
      if (db.prepare('SELECT 1 FROM staff WHERE id = ?').get(id)) throw conflict('DUPLICATE', 'Mã tài khoản đã tồn tại');
      db.prepare(`INSERT INTO staff(id,store_id,name,role,email,pin_hash,pw_hash,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .run(id, storeId, b.name.trim(), role, b.email || null, b.pin ? hashSecret(b.pin) : null, isAdminRole ? hashSecret(b.password) : null, nowIso());
      audit(db, { storeId, actorType: 'admin', actorId: req.user.id, action: 'user.created', entity: 'user', entityId: id, data: { role } });
      return { user: userView(db.prepare('SELECT * FROM staff WHERE id = ?').get(id)) };
    });
    s.put('/users/:id', async (req) => {
      const u = userScoped(req);
      const b = req.body || {};
      if (u.id === req.user.id && b.active === false) throw conflict('SELF_LOCK', 'Không thể tự khoá tài khoản của mình');
      let role = u.role;
      if (b.role !== undefined) {
        if (!ROLES.includes(b.role)) throw bad('BAD_ROLE', 'Vai trò không hợp lệ');
        if (req.user.role === 'branch_admin' && !STAFF_ROLES.includes(b.role)) throw forbidden();
        role = b.role;
      }
      db.prepare('UPDATE staff SET name=?, email=?, role=?, active=?, failed=0, locked_until=CASE WHEN ? = 1 THEN NULL ELSE locked_until END WHERE id=?')
        .run(b.name?.trim() || u.name, b.email ?? u.email, role, b.active === undefined ? u.active : (b.active ? 1 : 0), b.active ? 1 : 0, u.id);
      audit(db, { storeId: u.store_id, actorType: 'admin', actorId: req.user.id, action: 'user.updated', entity: 'user', entityId: u.id, data: { role: b.role, active: b.active } });
      return { user: userView(db.prepare('SELECT * FROM staff WHERE id = ?').get(u.id)) };
    });
    s.post('/users/:id/reset-pin', async (req) => {
      const u = userScoped(req);
      if (!validPin(req.body?.pin)) throw bad('BAD_PIN', 'PIN gồm 4–6 chữ số');
      db.prepare('UPDATE staff SET pin_hash = ?, failed = 0, locked_until = NULL WHERE id = ?').run(hashSecret(req.body.pin), u.id);
      audit(db, { storeId: u.store_id, actorType: 'admin', actorId: req.user.id, action: 'user.pin_reset', entity: 'user', entityId: u.id });
      return { ok: true };
    });
    s.post('/users/:id/reset-password', async (req) => {
      chainOnly(req);
      const u = userScoped(req);
      if (!strongPassword(req.body?.password)) throw bad('WEAK_PASSWORD', 'Mật khẩu tối thiểu 8 ký tự, có cả chữ và số');
      db.prepare('UPDATE staff SET pw_hash = ?, failed = 0, locked_until = NULL WHERE id = ?').run(hashSecret(req.body.password), u.id);
      audit(db, { storeId: u.store_id, actorType: 'admin', actorId: req.user.id, action: 'user.password_reset', entity: 'user', entityId: u.id });
      return { ok: true };
    });
    // Bật/tắt xác thực 2 bước. Chỉ chính chủ hoặc quản trị chuỗi.
    s.post('/users/:id/totp', async (req) => {
      const u = userScoped(req);
      if (u.id !== req.user.id && req.user.role !== 'chain_admin') throw forbidden();
      if (!isManager(u)) throw bad('NOT_ADMIN', 'Chỉ tài khoản quản trị mới dùng xác thực 2 bước');
      if (req.body?.enable === false) {
        db.prepare('UPDATE staff SET totp_secret = NULL WHERE id = ?').run(u.id);
        audit(db, { storeId: u.store_id, actorType: 'admin', actorId: req.user.id, action: 'user.totp_off', entity: 'user', entityId: u.id });
        return { enabled: false };
      }
      const secret = randomSecret();
      db.prepare('UPDATE staff SET totp_secret = ? WHERE id = ?').run(secret, u.id);
      audit(db, { storeId: u.store_id, actorType: 'admin', actorId: req.user.id, action: 'user.totp_on', entity: 'user', entityId: u.id });
      return { enabled: true, secret, uri: otpauthUri(secret, u.email || u.id) };
    });

    // ---------------- A06 Trong ngày ----------------
    s.get('/today', async (req) => {
      const storeId = storeOf(req);
      const date = localDate();
      const d = dayStats(storeId, date);
      const recent = db.prepare(`SELECT * FROM transactions WHERE store_id = ? AND status IN ('paid','awaiting_counter') ORDER BY created_at DESC LIMIT 12`).all(storeId)
        .map((t) => txView(ctx, t));
      const inStore = db.prepare(`SELECT COUNT(*) n FROM scan_sessions WHERE store_id = ? AND status IN ('active','locked') AND last_activity >= ?`)
        .get(storeId, new Date(Date.now() - 2 * 3600_000).toISOString()).n;
      return { date, storeId, tiles: { transactions: d.tx, revenue: d.revenue, cash: d.cash, transfer: d.transfer, other: d.other, checks: d.checks, mismatches: d.mismatches }, inStore, recent,
        waiting: db.prepare(`SELECT COUNT(*) n FROM transactions WHERE store_id = ? AND status='awaiting_counter'`).get(storeId).n,
        held: db.prepare(`SELECT COUNT(*) n FROM transactions WHERE store_id = ? AND exit_status='held'`).get(storeId).n };
    });

    // ---------------- Giao dịch & truy vết (A07) ----------------
    s.get('/transactions', async (req) => {
      const storeId = storeOf(req);
      const where = ['store_id = ?']; const args = [storeId];
      if (req.query.date) { where.push(`${sqlLocalDate('created_at')} = ?`); args.push(String(req.query.date)); }
      if (req.query.status) { where.push('status = ?'); args.push(String(req.query.status)); }
      if (req.query.exit) { where.push('exit_status = ?'); args.push(String(req.query.exit)); }
      const q = normCode(req.query.q);
      if (q) { where.push(`REPLACE(REPLACE(UPPER(id || cart_code || transfer_content), '-', ''), ' ', '') LIKE ?`); args.push(`%${q}%`); }
      const rows = db.prepare(`SELECT * FROM transactions WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`).all(...args);
      return { transactions: rows.map((t) => txView(ctx, t)) };
    });
    s.get('/transactions/:id', async (req) => {
      const tx = txScoped(req);
      const payments = db.prepare('SELECT * FROM payments WHERE transaction_id = ? ORDER BY id').all(tx.id);
      const checks = db.prepare('SELECT * FROM exit_checks WHERE transaction_id = ? ORDER BY id').all(tx.id);
      const invoices = db.prepare('SELECT id,type,email,tax_code,company_name,status,number,error,created_at FROM invoices WHERE transaction_id = ? ORDER BY id').all(tx.id);
      const scans = db.prepare(`SELECT type, COUNT(*) n, MIN(ts) first, MAX(ts) last FROM scan_events WHERE session_id = ? GROUP BY type`).all(tx.session_id);
      const started = db.prepare(`SELECT ts FROM scan_events WHERE session_id = ? AND type='session_started'`).get(tx.session_id);
      const events = [];
      if (started) events.push({ ts: started.ts, tone: 'info', text: 'Khách bắt đầu phiên mua sắm' });
      const sc = scans.find((x) => x.type === 'scan'), rm = scans.find((x) => x.type === 'remove'), qy = scans.find((x) => x.type === 'qty'), fl = scans.find((x) => x.type === 'scan_fail');
      if (sc) events.push({ ts: sc.last, tone: 'info', text: `Quét ${sc.n} lần, giữ ${tx.item_count} mặt hàng${rm ? `, xoá ${rm.n} lần` : ''}${qy ? `, sửa số lượng ${qy.n} lần` : ''}${fl ? `, ${fl.n} lần quét lỗi` : ''}` });
      for (const a of db.prepare(`SELECT * FROM audit_events WHERE entity='transaction' AND entity_id = ? ORDER BY id`).all(tx.id)) {
        const d = a.data ? JSON.parse(a.data) : {};
        const who = a.actor_id?.startsWith('POS:') ? `POS (${a.actor_id.slice(4)})` : a.actor_type === 'staff' ? `NV ${a.actor_id}` : a.actor_type === 'admin' ? `Quản trị ${a.actor_id}` : a.actor_type === 'customer' ? 'Khách' : 'Hệ thống';
        const map = {
          'cart.locked': ['info', `Khoá giỏ, chọn ${d.method === 'cash' ? 'tiền mặt' : 'chuyển khoản'}, ${d.total?.toLocaleString('vi-VN')}₫`],
          'cart.unlocked': ['info', 'Khách quay lại sửa giỏ hàng'],
          'cart.cancelled': ['warn', `Nhân viên huỷ giỏ chờ thu${d.reason ? `: ${d.reason}` : ''}`],
          'payment.collected': ['ok', d.source === 'pos'
            ? `${who} báo đã thanh toán ${d.amount?.toLocaleString('vi-VN')}₫ (${({ cash: 'tiền mặt', qr_transfer: 'chuyển khoản', card: 'thẻ', ewallet: 'ví điện tử' })[d.method] || 'cách khác'})${d.invoiceNo ? `, hoá đơn ${d.invoiceNo}` : ''}`
            : `${who} thu ${d.method === 'cash' ? `tiền mặt${d.cashReceived ? `, khách đưa ${d.cashReceived.toLocaleString('vi-VN')}₫, thối ${d.change?.toLocaleString('vi-VN')}₫` : ''}` : 'chuyển khoản (đã đối chiếu)'}`],
          'pos.paid_after_cancel': ['warn', `POS báo đã thu ${d.amount?.toLocaleString('vi-VN')}₫ sau khi khách sửa giỏ (giỏ cũ đã bị khách huỷ trên điện thoại)`],
          'pos.claimed': ['info', `${who} nhận giỏ vào đơn POS ${d.posOrderRef}${d.cashier ? `, thu ngân ${d.cashier}` : ''}`],
          'pos.amount_differs': ['warn', `Số tiền POS ${d.posAmount?.toLocaleString('vi-VN')}₫ khác tạm tính ${d.brgTotal?.toLocaleString('vi-VN')}₫`],
          'pos.released': ['warn', `${who} nhả giỏ vì POS không báo kết quả: ${d.reason}`],
          'pos.cancel_after_exit': ['warn', `POS huỷ đơn sau khi khách đã ra: ${d.reason}`],
          'payment.extra_collected': ['ok', `${who} thu bổ sung ${d.amount?.toLocaleString('vi-VN')}₫`],
          'invoice.issued': ['ok', `Hoá đơn điện tử ${d.number} (${d.type === 'company' ? 'công ty' : 'bán lẻ'})`],
          'invoice.failed': ['warn', `Xuất hoá đơn lỗi: ${d.error}`],
          'gate.check_required': ['warn', `${who} quét QR ở cổng, được chọn kiểm tra ngẫu nhiên`],
          'check.match': ['ok', `${who} kiểm tra ngẫu nhiên: khớp`],
          'check.mismatch': ['warn', `${who} kiểm tra ngẫu nhiên: chênh lệch${d.amount ? ` ${d.amount.toLocaleString('vi-VN')}₫` : ''}${d.note ? ` (${d.note})` : ''}`],
          'check.resolved_allow': ['ok', `${who} duyệt cho qua${d.note ? `: ${d.note}` : ''}`],
          'check.resolved_deny': ['warn', `${who} từ chối cho qua${d.note ? `: ${d.note}` : ''}`],
          'gate.exited': ['ok', a.actor_id === 'SYSTEM' ? `Hệ thống ghi nhận khách ra (${d.gate || 'không có bảo vệ'})` : `${who} quét QR ở ${d.gate || 'cổng ra'}, cho qua`],
          'transaction.voided': ['warn', `${who} huỷ giao dịch: ${d.reason}`]
        };
        const m = map[a.action]; events.push({ ts: a.ts, tone: m?.[0] || 'info', text: m?.[1] || a.action });
      }
      events.sort((a, b) => a.ts.localeCompare(b.ts));
      return {
        transaction: txView(ctx, tx, { staff: true }), events, voidReason: tx.void_reason,
        payments: payments.map((p) => ({ id: p.id, kind: p.kind, method: p.method, amount: p.amount, cashReceived: p.cash_received, change: p.change_given, by: p.collected_by, at: p.collected_at, voided: !!p.voided_at })),
        checks: checks.map((c) => ({ id: c.id, place: c.place, result: c.result, kind: c.kind, amount: c.amount, note: c.note, action: c.action, by: c.staff_id, at: c.created_at, resolution: c.resolution, resolvedBy: c.resolved_by })),
        invoices
      };
    });
    s.post('/transactions/:id/void', async (req) => { const tx = txScoped(req); voidTransaction(ctx, req.user, tx.id, req.body?.reason); return { ok: true }; });
    s.post('/transactions/:id/resolve', async (req) => { const tx = txScoped(req); return resolveHeld(ctx, req.user, tx.id, req.body || {}); });

    // ---------------- A08 Nhân viên & ca ----------------
    s.get('/plans', async (req) => {
      const storeId = storeOf(req);
      const start = String(req.query.weekStart || '');
      let monday;
      if (/^\d{4}-\d{2}-\d{2}$/.test(start)) monday = new Date(`${start}T00:00:00Z`);
      else { const t = new Date(`${localDate()}T00:00:00Z`); monday = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400_000); }
      const days = [...Array(7)].map((_, i) => new Date(monday.getTime() + i * 86400_000).toISOString().slice(0, 10));
      const staff = db.prepare(`SELECT * FROM staff WHERE store_id = ? AND role IN ('cashier','gate','cashier_gate') AND active = 1 ORDER BY id`).all(storeId);
      const plans = db.prepare('SELECT * FROM shift_plans WHERE store_id = ? AND date BETWEEN ? AND ?').all(storeId, days[0], days[6]);
      const today = localDate();
      const cfgPlan = getStoreConfig(db, storeId).cfg;
      const posMode = cfgPlan.payment_source === 'pos', guardOn = !!cfgPlan.guard_check; // POS: thu ngân làm trên POS; không bảo vệ: không cần người ở cổng
      const warnings = [];
      for (const date of days) {
        if (date < today) continue;
        for (const kind of ['sang', 'chieu']) {
          const who = plans.filter((p) => p.date === date && p.kind === kind).map((p) => staff.find((u) => u.id === p.staff_id)).filter(Boolean);
          if (!posMode && !who.some((u) => u.role === 'cashier' || u.role === 'cashier_gate')) warnings.push({ date, kind, missing: 'cashier' });
          if (guardOn && !who.some((u) => u.role === 'gate' || u.role === 'cashier_gate')) warnings.push({ date, kind, missing: 'gate' });
        }
      }
      return { storeId, days, staff: staff.map(userView), plans: plans.map((p) => ({ staffId: p.staff_id, date: p.date, kind: p.kind })), warnings };
    });
    s.put('/plans', async (req) => {
      const storeId = storeOf(req);
      const { staffId, date, kind } = req.body || {};
      const u = db.prepare('SELECT * FROM staff WHERE id = ? AND store_id = ?').get(String(staffId || ''), storeId);
      if (!u) throw notFound('USER_NOT_FOUND', 'Nhân viên không thuộc chi nhánh này');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw bad('BAD_DATE', 'Ngày không hợp lệ');
      if (kind === null || kind === undefined || kind === '') db.prepare('DELETE FROM shift_plans WHERE store_id=? AND staff_id=? AND date=?').run(storeId, u.id, date);
      else {
        if (!['sang', 'chieu'].includes(kind)) throw bad('BAD_KIND', 'Ca không hợp lệ');
        db.prepare('INSERT INTO shift_plans(store_id,staff_id,date,kind) VALUES(?,?,?,?) ON CONFLICT(store_id,staff_id,date) DO UPDATE SET kind=excluded.kind').run(storeId, u.id, date, kind);
      }
      return { ok: true };
    });

    // ---------------- A09 Kiểm tra ngẫu nhiên ----------------
    s.get('/random-check', async (req) => {
      const storeId = storeOf(req);
      const st = storeRow(db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId));
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();
      const c = db.prepare(`SELECT COUNT(*) checks, COALESCE(SUM(result='mismatch'),0) mismatches FROM exit_checks WHERE store_id = ? AND created_at >= ?`).get(storeId, since);
      const tx = db.prepare(`SELECT COUNT(*) n FROM transactions WHERE store_id = ? AND status='paid' AND paid_at >= ?`).get(storeId, since).n;
      return { storeId, rules: { rate: st.config.randomCheckRate, firstTime: st.config.rateFirstTime, highValue: st.config.rateHighValue, threshold: st.config.highValueThreshold },
        last7: { transactions: tx, checks: c.checks, mismatches: c.mismatches, mismatchRate: c.checks ? c.mismatches / c.checks : 0 } };
    });

    // ---------------- A10 Đối soát ----------------
    const reconcile = (storeId, date) => {
      const shifts = db.prepare(`SELECT sh.*, st.name FROM shifts sh JOIN staff st ON st.id = sh.staff_id WHERE sh.store_id = ? AND ${sqlLocalDate('sh.started_at')} = ? ORDER BY sh.started_at`).all(storeId, date)
        .map((sh) => {
          const live = !sh.ended_at; const stats = shiftStats(db, sh);
          return { id: sh.id, staffId: sh.staff_id, name: sh.name, kind: sh.kind, startedAt: sh.started_at, endedAt: sh.ended_at, open: live,
            systemCash: live ? stats.cash : sh.system_cash, countedCash: sh.counted_cash, diff: sh.diff, note: sh.note };
        });
      const sys = db.prepare(`SELECT p.amount, t.transfer_content content, t.id FROM payments p JOIN transactions t ON t.id = p.transaction_id
        WHERE p.store_id = ? AND p.method = 'qr_transfer' AND p.voided_at IS NULL AND ${sqlLocalDate('p.collected_at')} = ? ORDER BY p.id`).all(storeId, date);
      const stmt = db.prepare('SELECT * FROM statements WHERE store_id = ? AND date = ? ORDER BY id DESC LIMIT 1').get(storeId, date);
      const lines = stmt ? JSON.parse(stmt.lines) : null;
      let transfer = { systemTotal: sys.reduce((a, x) => a + x.amount, 0), count: sys.length, statement: null };
      if (lines) {
        const used = new Set(); const matched = []; const onlySystem = [];
        for (const p of sys) {
          const key = normCode(p.content);
          const i = lines.findIndex((l, idx) => !used.has(idx) && money(l.amount) === p.amount && normCode(l.content).includes(key));
          if (i >= 0) { used.add(i); matched.push(p); } else onlySystem.push(p);
        }
        const onlyStatement = lines.filter((_, idx) => !used.has(idx));
        transfer.statement = { uploadedAt: stmt.created_at, total: lines.reduce((a, l) => a + money(l.amount), 0), lines: lines.length, matched: matched.length, onlySystem, onlyStatement };
      }
      return { storeId, date, shifts, transfer };
    };
    s.get('/reconcile', async (req) => reconcile(storeOf(req), String(req.query.date || localDate())));
    s.post('/reconcile/statement', async (req) => {
      const storeId = storeOf(req);
      const date = String(req.body?.date || localDate());
      const raw = req.body?.lines;
      if (!Array.isArray(raw) || !raw.length || raw.length > 5000) throw bad('BAD_STATEMENT', 'Sao kê không hợp lệ');
      const lines = raw.map((l) => ({ amount: money(l.amount), content: String(l.content || '').slice(0, 200) })).filter((l) => l.amount > 0);
      db.prepare('INSERT INTO statements(store_id,date,lines,uploaded_by,created_at) VALUES(?,?,?,?,?)').run(storeId, date, JSON.stringify(lines), req.user.id, nowIso());
      audit(db, { storeId, actorType: 'admin', actorId: req.user.id, action: 'statement.uploaded', data: { date, lines: lines.length } });
      return reconcile(storeId, date);
    });

    // ---------------- A11 Mã quét không tìm thấy ----------------
    s.get('/unknown-barcodes', async (req) => {
      const storeId = storeOf(req);
      const status = req.query.status ? String(req.query.status) : null;
      const rows = db.prepare(`SELECT * FROM unknown_barcodes WHERE store_id = ? ${status ? 'AND status = ?' : "AND status != 'resolved'"} ORDER BY count DESC, last_seen DESC LIMIT 200`)
        .all(...(status ? [storeId, status] : [storeId]));
      return { items: rows.map((r) => ({ barcode: r.barcode, count: r.count, lastSeen: r.last_seen, status: r.status })) };
    });
    s.put('/unknown-barcodes', async (req) => {
      const storeId = storeOf(req);
      const status = req.body?.status;
      if (!['new', 'reported', 'resolved'].includes(status)) throw bad('BAD_STATUS', 'Trạng thái không hợp lệ');
      const r = db.prepare('UPDATE unknown_barcodes SET status = ? WHERE store_id = ? AND barcode = ?').run(status, storeId, String(req.body?.barcode || ''));
      if (!r.changes) throw notFound();
      return { ok: true };
    });

    // ---------------- Nhật ký ----------------
    s.get('/audit', async (req) => {
      const storeId = req.user.role === 'branch_admin' ? req.user.store_id : (req.query.storeId ? String(req.query.storeId).toUpperCase() : null);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
      const rows = storeId ? db.prepare('SELECT * FROM audit_events WHERE store_id = ? ORDER BY id DESC LIMIT ?').all(storeId, limit)
        : db.prepare('SELECT * FROM audit_events ORDER BY id DESC LIMIT ?').all(limit);
      return { events: rows.map((r) => ({ id: r.id, ts: r.ts, storeId: r.store_id, actorType: r.actor_type, actorId: r.actor_id, action: r.action, entity: r.entity, entityId: r.entity_id, data: r.data ? JSON.parse(r.data) : null })) };
    });
  });
}
