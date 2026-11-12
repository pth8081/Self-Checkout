// Lõi nghiệp vụ: phiên mua sắm, khóa giỏ, thu tiền, cổng ra, kiểm tra ngẫu nhiên, ca làm việc.
// Mọi hàm nhận ctx = { db, pos, invoicer, rng } để dễ kiểm thử.
import { config } from '../config.js';
import { nextCounter } from '../db.js';
import { nowIso, uuid, bad, notFound, conflict, forbidden, money, normCode, localDate } from '../util.js';
import { totals, itemCount, lineDiscount, promoLabel } from './pricing.js';
import { normalizeBarcode } from './barcode.js';
import { vietQrPayload, makeReceiptToken, parseReceiptToken } from './qr.js';
import { audit } from './audit.js';
import { issueInvoice } from './invoice.js';
import { linksOf, cartDiffOf, diffLines } from './bill.js';
import { canCash, canGate, isManager } from '../auth.js';
import { encodeBasketShort, makeBasketRef } from '../../public/shared/basket.js';

const maskEmail = (e) => (e ? e.replace(/^(.).*(@.*)$/, '$1***$2') : null);

// ====================== Chi nhánh ======================
export function getStoreConfig(db, storeId) {
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
  if (!store) throw notFound('STORE_NOT_FOUND', 'Không tìm thấy chi nhánh');
  const raw = db.prepare('SELECT * FROM store_config WHERE store_id = ?').get(storeId);
  // Chế độ "giỏ QR cho Dsmart POS": Dsmart POS thu tiền, không có bước bảo vệ. Các luồng cũ (thu tại quầy, cổng ra) bị khóa, không xóa.
  const cfg = raw.checkout_mode === 'basket' ? { ...raw, payment_source: 'pos', guard_check: 0 } : raw;
  return { store, cfg };
}

export function storeView(db, storeId) {
  const { store, cfg } = getStoreConfig(db, storeId);
  const bankOk = !!(cfg.bank_bin && cfg.bank_account);
  const pos = cfg.payment_source === 'pos'; // thu tiền tại Dsmart POS: khách chỉ có một lựa chọn "thanh toán tại quầy"
  return {
    id: store.id, name: store.name, address: store.address, enabled: !!store.enabled,
    paymentSource: cfg.payment_source, guardCheck: !!cfg.guard_check,
    basket: cfg.checkout_mode === 'basket', pointCode: store.pos_code || '', maxCartItems: config.maxCartItems,
    payment: { cash: !pos && !!cfg.pay_cash, qrTransfer: !pos && !!cfg.pay_qr && bankOk, pos, online: false /* chưa tích hợp */ }
  };
}

// ====================== Phiên mua sắm & giỏ hàng ======================
const itemsOf = (db, sessionId) => db.prepare('SELECT * FROM cart_items WHERE session_id = ? ORDER BY id').all(sessionId);

function itemView(it) {
  const discount = lineDiscount(it);
  return {
    id: it.id, sku: it.sku, barcode: it.barcode, name: it.name, price: it.unit_price, qty: it.qty,
    listPrice: it.list_price && it.list_price > it.unit_price ? it.list_price : null, noPrice: !!it.no_price,
    lineTotal: it.unit_price * it.qty - discount, discount, ageRestricted: !!it.age_restricted,
    promo: promoLabel(it.promo_min_qty, it.promo_off), promoMin: it.promo_min_qty, promoOff: it.promo_off
  };
}

export function sessionView(ctx, sessionId) {
  const { db } = ctx;
  const s = db.prepare('SELECT * FROM scan_sessions WHERE id = ?').get(sessionId);
  if (!s) throw notFound('SESSION_NOT_FOUND', 'Không tìm thấy phiên mua sắm');
  const items = itemsOf(db, sessionId);
  const t = totals(items);
  const tx = db.prepare(`SELECT * FROM transactions WHERE session_id = ? AND status IN ('awaiting_counter','paid','voided') ORDER BY created_at DESC LIMIT 1`).get(sessionId);
  return {
    id: s.id, storeId: s.store_id, status: s.status, startedAt: s.started_at,
    items: items.map(itemView), itemCount: itemCount(items), ...t,
    ageRestricted: items.some((i) => i.age_restricted),
    transaction: tx ? txView(ctx, tx) : null,
    // Đơn vừa bị hủy và giỏ được trả lại cho khách: 'expired' (quá hạn không thanh toán) hoặc null
    releasedReason: tx ? null : (db.prepare(`SELECT cancel_reason r FROM transactions WHERE session_id = ? AND status = 'cancelled' ORDER BY created_at DESC LIMIT 1`).get(sessionId)?.r ?? null)
  };
}

export function createOrResumeSession(ctx, storeId, deviceId) {
  const { db } = ctx;
  const { store } = getStoreConfig(db, storeId);
  if (!store.enabled) throw conflict('STORE_DISABLED', 'Chi nhánh này chưa bật Scan & Checkout');
  const since = new Date(Date.now() - config.sessionResumeHours * 3600_000).toISOString();
  const existing = db.prepare(`SELECT * FROM scan_sessions WHERE device_id = ? AND store_id = ? AND status IN ('active','locked')
    AND last_activity >= ? ORDER BY started_at DESC LIMIT 1`).get(deviceId, storeId, since);
  if (existing) return { session: sessionView(ctx, existing.id), resumed: itemsOf(db, existing.id).length > 0 };
  const id = uuid(), ts = nowIso();
  db.prepare('INSERT INTO scan_sessions(id,store_id,device_id,status,started_at,last_activity) VALUES(?,?,?,?,?,?)')
    .run(id, storeId, deviceId, 'active', ts, ts);
  db.prepare('INSERT INTO scan_events(session_id,store_id,type,ts) VALUES(?,?,?,?)').run(id, storeId, 'session_started', ts);
  return { session: sessionView(ctx, id), resumed: false };
}

/** Chuẩn hóa thông tin người mua (hóa đơn công ty) khách nhập trước khi khóa giỏ. */
export function cleanBuyer(b) {
  if (!b || typeof b !== 'object') return null;
  const email = String(b.email || '').trim();
  const out = {};
  if (email) {
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) throw bad('BAD_EMAIL', 'Email không hợp lệ');
    out.email = email;
  }
  if (b.taxCode || b.companyName || b.address) {
    const taxCode = String(b.taxCode || '').replace(/\s/g, '');
    if (!/^\d{10}(-\d{3})?$/.test(taxCode)) throw bad('BAD_TAX_CODE', 'Mã số thuế gồm 10 chữ số (hoặc 13 số có chi nhánh)');
    if (!String(b.companyName || '').trim() || !String(b.address || '').trim()) throw bad('COMPANY_INFO_REQUIRED', 'Nhập đủ tên công ty và địa chỉ');
    if (!out.email) throw bad('BAD_EMAIL', 'Nhập email để nhận hóa đơn công ty');
    Object.assign(out, { taxCode, companyName: String(b.companyName).trim().slice(0, 200), address: String(b.address).trim().slice(0, 300) });
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/**
 * Dọn giỏ bỏ quên. Hai hạn khác nhau:
 * - Giỏ đang quét (chưa bấm Thanh toán): `activeHours` giờ không có thao tác thì đóng (phiên "bỏ quên").
 * - Giỏ QR đã bấm Thanh toán mà quá `lockedMinutes` phút chưa được thanh toán: HUỶ ĐƠN (mã QR hết hạn, lý do "expired"),
 *   nhưng GIỮ giỏ hàng, trả về trạng thái đang quét để khách tạo mã mới; giỏ đó rồi lại theo hạn `activeHours`.
 *   Mốc tính là lần cuối có động thái: lúc bấm Thanh toán, lúc Dsmart POS nhận giỏ hoặc cập nhật đơn.
 * Nếu Dsmart POS vẫn báo thanh toán sau khi đơn hết hạn thì hệ thống vẫn nhận (tiền đã thu thật).
 * Giỏ kiểu cũ (có bước cổng ra) giữ cách xử lý cũ: theo `activeHours`.
 */
export function sweepStaleCarts(ctx, { activeHours = 3, lockedMinutes = 30 } = {}) {
  const { db } = ctx;
  let n = 0;
  const lockedCut = new Date(Date.now() - lockedMinutes * 60_000).toISOString();
  const locked = db.prepare(`SELECT t.id txId, t.store_id, t.session_id, t.pos_claimed_at, s.last_activity FROM transactions t JOIN scan_sessions s ON s.id = t.session_id
    WHERE t.method = 'basket' AND t.status = 'awaiting_counter' AND s.status = 'locked'`).all();
  for (const r of locked) {
    const last = [r.last_activity, r.pos_claimed_at].filter(Boolean).sort().pop();
    if (last >= lockedCut) continue;
    const ts = nowIso();
    db.transaction(() => {
      db.prepare(`UPDATE transactions SET status='cancelled', cancel_reason='expired' WHERE id=? AND status='awaiting_counter'`).run(r.txId);
      db.prepare(`UPDATE scan_sessions SET status='active', last_activity=? WHERE id=?`).run(ts, r.session_id);
      db.prepare('INSERT INTO scan_events(session_id,store_id,type,detail,ts) VALUES(?,?,?,?,?)').run(r.session_id, r.store_id, 'basket_expired', `${lockedMinutes} phút`, ts);
      audit(db, { storeId: r.store_id, actorType: 'system', actorId: 'SYSTEM', action: 'cart.expired', entity: 'transaction', entityId: r.txId, data: { lockedMinutes } });
    })();
    n++;
  }
  const cutoff = new Date(Date.now() - activeHours * 3600_000).toISOString();
  const rows = db.prepare(`SELECT * FROM scan_sessions WHERE status IN ('active','locked') AND last_activity < ?`).all(cutoff);
  for (const s of rows) { try { abandonSession(ctx, s); n++; } catch { /* Dsmart POS đang xử lý: để nguyên */ } }
  return n;
}

/** Bỏ phiên cũ để bắt đầu giỏ mới (khách chọn "Bắt đầu giỏ mới"). */
export function abandonSession(ctx, session) {
  const { db } = ctx;
  if (session.status === 'locked') {
    if (db.prepare(`SELECT 1 FROM transactions WHERE session_id=? AND status='awaiting_counter' AND pos_status='claimed'`).get(session.id)) throw conflict('CLAIMED', 'Thu ngân đang xử lý đơn trên máy tính tiền');
    db.prepare(`UPDATE transactions SET status='cancelled' WHERE session_id=? AND status='awaiting_counter'`).run(session.id);
  } else if (session.status !== 'active') throw conflict('SESSION_CLOSED', 'Phiên này đã kết thúc');
  db.prepare(`UPDATE scan_sessions SET status='abandoned', ended_at=? WHERE id=?`).run(nowIso(), session.id);
  db.prepare('INSERT INTO scan_events(session_id,store_id,type,ts) VALUES(?,?,?,?)').run(session.id, session.store_id, 'abandoned', nowIso());
}

function logScan(db, session, type, barcode, detail) {
  db.prepare('INSERT INTO scan_events(session_id,store_id,type,barcode,detail,ts) VALUES(?,?,?,?,?,?)')
    .run(session.id, session.store_id, type, barcode ?? null, detail ?? null, nowIso());
}

function recordUnknown(db, storeId, barcode) {
  db.prepare(`INSERT INTO unknown_barcodes(store_id,barcode,count,last_seen,status) VALUES(?,?,1,?, 'new')
    ON CONFLICT(store_id,barcode) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen,
      status = CASE WHEN status = 'resolved' THEN 'new' ELSE status END`).run(storeId, barcode, nowIso());
}

function runOp(ctx, session, op, prices) {
  const { db, pos } = ctx;
  if (op.type === 'scan') {
    const n = normalizeBarcode(op.barcode);
    if (!n.ok) { logScan(db, session, 'scan_fail', n.code, 'invalid'); return { ok: false, code: 'INVALID_BARCODE', message: 'Không đọc được mã vạch, hãy quét lại' }; }
    let p = pos.lookup(session.store_id, n.variants);
    // API giá bật mà không tra được giá (hết thời gian, lỗi, hoặc chưa có giá): vẫn cho vào giỏ ở dạng "chưa có giá" để thu ngân tính đủ
    const why = prices?.get(n.code);
    if (!p && (why === 'notfound' || why === 'error')) {
      if (why === 'notfound') recordUnknown(db, session.store_id, n.code);
      const sku = `NB-${n.code}`;
      p = { sku, barcode: n.code, name: `Mã vạch ${n.code}`, price: 0, list_price: null, active: 1, age_restricted: 0, promo_min_qty: 0, promo_off: 0, no_price: 1 };
    }
    if (!p) { recordUnknown(db, session.store_id, n.code); logScan(db, session, 'scan_fail', n.code, 'not_found'); return { ok: false, code: 'NOT_FOUND', barcode: n.code, message: 'Sản phẩm chưa có trong hệ thống của chi nhánh' }; }
    if (!p.active) { logScan(db, session, 'scan_fail', n.code, 'inactive'); return { ok: false, code: 'INACTIVE', barcode: n.code, name: p.name, message: 'Sản phẩm này đang ngừng bán' }; }
    const cur = db.prepare('SELECT * FROM cart_items WHERE session_id = ? AND sku = ?').get(session.id, p.sku);
    if (!cur && db.prepare('SELECT COUNT(*) n FROM cart_items WHERE session_id = ?').get(session.id).n >= config.maxCartItems) {
      return { ok: false, code: 'CART_FULL', barcode: n.code, name: p.name, message: `Giỏ đã đủ ${config.maxCartItems} mặt hàng khác nhau. Hãy thanh toán giỏ này, rồi quét giỏ mới cho phần còn lại` };
    }
    const want = (cur?.qty || 0) + 1;
    if (want > 99) return { ok: false, code: 'BAD_QTY', message: 'Số lượng tối đa mỗi mặt hàng là 99' };
    if (cur) db.prepare('UPDATE cart_items SET qty = ? WHERE id = ?').run(want, cur.id);
    else db.prepare(`INSERT INTO cart_items(session_id,sku,barcode,name,unit_price,qty,promo_min_qty,promo_off,age_restricted,added_at,list_price,no_price)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(session.id, p.sku, p.barcode, p.name, p.price, 1, p.promo_min_qty, p.promo_off, p.age_restricted, nowIso(), p.list_price ?? null, p.no_price ? 1 : 0);
    logScan(db, session, 'scan', n.code);
    const item = itemView(db.prepare('SELECT * FROM cart_items WHERE session_id = ? AND sku = ?').get(session.id, p.sku));
    return { ok: true, item };
  }
  if (op.type === 'setQty') {
    const it = db.prepare('SELECT * FROM cart_items WHERE id = ? AND session_id = ?').get(Number(op.itemId), session.id);
    if (!it) return { ok: false, code: 'ITEM_NOT_FOUND', message: 'Sản phẩm không còn trong giỏ' };
    const qty = Math.floor(Number(op.qty));
    if (!Number.isFinite(qty) || qty < 0 || qty > 99) return { ok: false, code: 'BAD_QTY', message: 'Số lượng không hợp lệ' };
    if (qty === 0) { db.prepare('DELETE FROM cart_items WHERE id = ?').run(it.id); logScan(db, session, 'remove', it.barcode); return { ok: true }; }
    db.prepare('UPDATE cart_items SET qty = ? WHERE id = ?').run(qty, it.id);
    logScan(db, session, 'qty', it.barcode, String(qty));
    return { ok: true };
  }
  if (op.type === 'remove') {
    const it = db.prepare('SELECT * FROM cart_items WHERE id = ? AND session_id = ?').get(Number(op.itemId), session.id);
    if (it) { db.prepare('DELETE FROM cart_items WHERE id = ?').run(it.id); logScan(db, session, 'remove', it.barcode); }
    return { ok: true };
  }
  return { ok: false, code: 'BAD_OP', message: 'Thao tác không hợp lệ' };
}

/** Áp dụng lô thao tác (quét, đổi số lượng, xóa). Mỗi thao tác có id nên gửi lại không bị trùng. */
export function applyOps(ctx, session, ops, prices) {
  const { db } = ctx;
  if (session.status !== 'active') throw conflict('SESSION_LOCKED', 'Giỏ hàng đã khóa, hãy quay lại giỏ để sửa');
  if (!Array.isArray(ops) || ops.length > 100) throw bad('BAD_OPS', 'Danh sách thao tác không hợp lệ');
  const results = [];
  db.transaction(() => {
    for (const op of ops) {
      const opId = String(op.id || '');
      if (!opId) { results.push({ id: opId, ok: false, code: 'BAD_OP' }); continue; }
      const done = db.prepare('SELECT result FROM processed_ops WHERE session_id = ? AND op_id = ?').get(session.id, opId);
      if (done) { results.push({ ...JSON.parse(done.result), id: opId, duplicate: true }); continue; }
      const r = { ...runOp(ctx, session, op, prices), id: opId };
      db.prepare('INSERT INTO processed_ops(session_id,op_id,result) VALUES(?,?,?)').run(session.id, opId, JSON.stringify(r));
      results.push(r);
    }
    db.prepare('UPDATE scan_sessions SET last_activity = ? WHERE id = ?').run(nowIso(), session.id);
  })();
  return results;
}

// ====================== Khóa giỏ & giao dịch ======================
function bankInfo(cfg) {
  return { bin: cfg.bank_bin, name: cfg.bank_name, account: cfg.bank_account, holder: cfg.bank_holder };
}

export function txView(ctx, tx, { staff = false } = {}) {
  const { db } = ctx;
  const { cfg } = getStoreConfig(db, tx.store_id);
  const now = nowIso();
  const paid = tx.status === 'paid';
  const expired = tx.receipt_expires_at && tx.receipt_expires_at < now;
  const inv = db.prepare(`SELECT * FROM invoices WHERE transaction_id = ? AND status != 'replaced' ORDER BY id DESC LIMIT 1`).get(tx.id);
  const v = {
    id: tx.id, code: tx.cart_code, status: tx.status, method: tx.method, storeId: tx.store_id,
    subtotal: tx.subtotal, discount: tx.discount, total: tx.total, itemCount: tx.item_count,
    transferContent: tx.transfer_content, exitStatus: tx.exit_status, extraDue: tx.extra_due,
    createdAt: tx.created_at, paidAt: tx.paid_at, exitedAt: tx.exited_at, cancelReason: tx.cancel_reason || null,
    checkRequired: !!tx.check_required && !tx.check_done, checkDone: !!tx.check_done,
    ageRestricted: !!tx.age_restricted, rating: tx.rating,
    paymentSource: cfg.payment_source, guardCheck: !tx.guard_skipped,
    posStatus: tx.pos_status, posOrderRef: tx.pos_order_ref, posAmount: tx.pos_amount, posInvoiceNo: tx.pos_invoice_no,
    posClaimedAt: tx.pos_claimed_at, posCashier: tx.pos_cashier, posTerminal: tx.pos_terminal,
    buyer: tx.buyer_json ? JSON.parse(tx.buyer_json) : null,
    ...(tx.status === 'paid' ? linksOf(tx) : { invoiceUrl: null, transactionUrl: null }),
    // Đơn Dsmart POS thực mua (sau khi thanh toán) và đơn Dsmart POS đang tính (trước khi thanh toán) so với giỏ khách quét
    cartDiff: tx.status === 'paid' ? cartDiffOf(tx) : null,
    posItemCount: tx.status === 'paid' && tx.pos_bill_json ? JSON.parse(tx.pos_bill_json).reduce((a, l) => a + l.qty, 0) : null,
    posDraft: tx.status === 'awaiting_counter' && tx.pos_draft_json ? (() => { const d = JSON.parse(tx.pos_draft_json); return { total: d.amount, itemCount: d.lines.reduce((a, l) => a + l.qty, 0), at: d.at, diff: diffLines(JSON.parse(tx.items_json), d.lines) }; })() : null,
    refundTotal: tx.status === 'paid' ? db.prepare('SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE transaction_id = ?').get(tx.id).s : 0,
    billEmail: maskEmail(tx.bill_email), billEmailStatus: tx.bill_email_status || null,
    bill: tx.status === 'paid' ? { source: tx.pos_bill_json ? 'pos' : 'brg', total: tx.pos_amount ?? tx.total } : null,
    // Chi nhánh không có bảo vệ: khách ra thẳng, không có mã QR ra cổng.
    receipt: paid && !tx.guard_skipped ? { token: makeReceiptToken(tx.id, tx.receipt_expires_at), expiresAt: tx.receipt_expires_at, expired: !!expired } : null,
    invoice: inv ? { type: inv.type, status: inv.status, number: inv.number, email: inv.email } : null
  };
  if (tx.method === 'basket') {
    const st = db.prepare('SELECT pos_code FROM stores WHERE id = ?').get(tx.store_id);
    v.basketQr = encodeBasketShort({ point: st?.pos_code || '', ref: tx.cart_code, at: Date.parse(tx.created_at) }); // dạng ngắn: Dsmart POS lấy danh sách hàng qua API
  }
  if (tx.status === 'awaiting_counter' && tx.method === 'qr_transfer' && cfg.bank_bin && cfg.bank_account) {
    const b = bankInfo(cfg);
    v.transfer = {
      bankName: b.name, account: b.account, holder: b.holder, amount: tx.total + tx.extra_due, content: tx.transfer_content,
      payload: vietQrPayload({ bin: b.bin, account: b.account, amount: tx.total + tx.extra_due, content: tx.transfer_content })
    };
  }
  if (staff) {
    v.items = JSON.parse(tx.items_json);
    const c = db.prepare('SELECT * FROM exit_checks WHERE transaction_id = ? ORDER BY id DESC LIMIT 1').get(tx.id);
    if (c) v.lastCheck = { result: c.result, kind: c.kind, amount: c.amount, note: c.note, action: c.action, place: c.place, by: c.staff_id, at: c.created_at, resolution: c.resolution };
  }
  return v;
}

function freshnessChanges(ctx, session, items) {
  const cur = ctx.pos.current(session.store_id, items.map((i) => i.sku));
  const changes = [];
  for (const it of items) {
    const c = cur.get(it.sku);
    if (!c || !c.active) { changes.push({ sku: it.sku, name: it.name, type: 'inactive' }); continue; }
    if (c.price !== it.unit_price) changes.push({ sku: it.sku, name: it.name, type: 'price', old: it.unit_price, new: c.price });
    if (c.promo_min_qty !== it.promo_min_qty || c.promo_off !== it.promo_off) changes.push({ sku: it.sku, name: it.name, type: 'promo' });
  }
  return { changes, cur };
}

function drawCheck(ctx, session, cfg, total) {
  const { db, rng } = ctx;
  if (!cfg.guard_check) return false; // không có bảo vệ thì không có bước kiểm tra ngẫu nhiên ở cổng
  let rate = cfg.random_check_rate;
  const prev = db.prepare(`SELECT 1 FROM transactions WHERE device_id = ? AND status = 'paid' LIMIT 1`).get(session.device_id);
  if (!prev) rate = Math.max(rate, cfg.rate_first_time);
  if (total >= cfg.high_value_threshold) rate = Math.max(rate, cfg.rate_high_value);
  // Kết quả bốc thăm cố định cho mỗi phiên: mở khóa rồi khóa lại giỏ không bốc lại được (nếu không, khách lặp lại tới khi trúng "không bị kiểm tra").
  let roll = session.check_roll;
  if (roll === null || roll === undefined) { roll = rng(); db.prepare('UPDATE scan_sessions SET check_roll = ? WHERE id = ?').run(roll, session.id); }
  return roll < rate;
}

export function lockSession(ctx, session, { method, acceptChanges = false, buyer = null }) {
  const { db } = ctx;
  const { store, cfg } = getStoreConfig(db, session.store_id);
  if (!store.enabled) throw conflict('STORE_DISABLED', 'Chi nhánh này chưa bật Scan & Checkout');
  if (cfg.checkout_mode === 'basket') throw conflict('BASKET_MODE', 'Chi nhánh dùng giỏ QR cho Dsmart POS, không dùng luồng thanh toán này');
  const posMode = cfg.payment_source === 'pos';
  if (posMode) {
    if (method && method !== 'pos') throw bad('METHOD_UNAVAILABLE', 'Chi nhánh thu tiền tại quầy qua máy tính tiền');
    method = 'pos';
  } else {
    if (!['cash', 'qr_transfer'].includes(method)) throw bad('METHOD_UNAVAILABLE', 'Cách thanh toán này chưa được hỗ trợ');
    if (method === 'cash' && !cfg.pay_cash) throw bad('METHOD_UNAVAILABLE', 'Chi nhánh không nhận tiền mặt');
    if (method === 'qr_transfer') {
      if (!cfg.pay_qr) throw bad('METHOD_UNAVAILABLE', 'Chi nhánh không nhận chuyển khoản QR');
      if (!cfg.bank_bin || !cfg.bank_account) throw conflict('BANK_NOT_CONFIGURED', 'Chi nhánh chưa cấu hình tài khoản nhận chuyển khoản');
    }
  }
  const buyerJson = posMode ? cleanBuyer(buyer) : null;
  // Đang khóa: chỉ đổi cách trả
  if (session.status === 'locked') {
    const tx = db.prepare(`SELECT * FROM transactions WHERE session_id = ? AND status = 'awaiting_counter'`).get(session.id);
    if (!tx) throw conflict('SESSION_CLOSED', 'Phiên này đã kết thúc');
    if (tx.pos_status === 'claimed') throw conflict('CLAIMED', 'Thu ngân đang xử lý đơn trên máy tính tiền, chưa đổi được');
    db.prepare('UPDATE transactions SET method = ?, buyer_json = COALESCE(?, buyer_json) WHERE id = ?').run(method, buyerJson, tx.id);
    return txView(ctx, { ...tx, method });
  }
  if (session.status !== 'active') throw conflict('SESSION_CLOSED', 'Phiên này đã kết thúc');

  const items = itemsOf(db, session.id);
  if (!items.length) throw bad('EMPTY_CART', 'Giỏ hàng đang trống');
  const { changes, cur } = freshnessChanges(ctx, session, items);
  if (changes.length && !acceptChanges) throw conflict('CHANGED', 'Giá hoặc khuyến mãi vừa thay đổi', { changes });

  return db.transaction(() => {
    for (const it of items) {
      const c = cur.get(it.sku);
      if (!c || !c.active) { db.prepare('DELETE FROM cart_items WHERE id = ?').run(it.id); continue; }
      const qty = it.qty;
      db.prepare('UPDATE cart_items SET unit_price=?, promo_min_qty=?, promo_off=?, name=?, qty=? WHERE id=?')
        .run(c.price, c.promo_min_qty, c.promo_off, c.name, qty, it.id);
    }
    const fresh = itemsOf(db, session.id);
    if (!fresh.length) throw bad('EMPTY_CART', 'Giỏ hàng đang trống');
    const t = totals(fresh);
    const seq = nextCounter(db, session.store_id, 'tx');
    const num = String(seq).padStart(4, '0');
    const id = `SG-${session.store_id}-${num}`;
    const snapshot = fresh.map((i) => ({ sku: i.sku, barcode: i.barcode, name: i.name, price: i.unit_price, qty: i.qty, discount: lineDiscount(i), ageRestricted: !!i.age_restricted }));
    const check = drawCheck(ctx, session, cfg, t.total);
    const ts = nowIso();
    db.prepare(`INSERT INTO transactions(id,session_id,store_id,device_id,cart_code,transfer_content,subtotal,discount,total,method,status,
      check_required,items_json,item_count,age_restricted,created_at,buyer_json,guard_skipped) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, session.id, session.store_id, session.device_id, `GH-${session.store_id}-${num}`, `SG ${session.store_id} ${num}`,
        t.subtotal, t.discount, t.total, method, 'awaiting_counter', check ? 1 : 0, JSON.stringify(snapshot),
        itemCount(fresh), fresh.some((i) => i.age_restricted) ? 1 : 0, ts, buyerJson, cfg.guard_check ? 0 : 1);
    db.prepare(`UPDATE scan_sessions SET status='locked', locked_at=?, last_activity=? WHERE id=?`).run(ts, ts, session.id);
    logScan(db, session, 'cart_locked', null, id);
    audit(db, { storeId: session.store_id, actorType: 'customer', actorId: session.device_id.slice(0, 8), action: 'cart.locked', entity: 'transaction', entityId: id,
      data: { total: t.total, method, items: fresh.length, checkRequired: check, changes: changes.length } });
    return txView(ctx, db.prepare('SELECT * FROM transactions WHERE id = ?').get(id));
  })();
}

/**
 * Chế độ giỏ QR: khóa giỏ để ghi nhận tạm tính theo giá của đúng chi nhánh. Không hỏi cách thanh toán.
 * `ref` do điện thoại sinh (có trong mã QR), gửi lại cùng ref thì trả kết quả cũ.
 */
export function lockBasket(ctx, session, { ref, email } = {}) {
  const { db } = ctx;
  const { store, cfg } = getStoreConfig(db, session.store_id);
  if (!store.enabled) throw conflict('STORE_DISABLED', 'Chi nhánh này chưa bật Scan & Checkout');
  if (cfg.checkout_mode !== 'basket') throw conflict('NOT_BASKET', 'Chi nhánh này không dùng giỏ QR');
  if (!store.pos_code) throw conflict('NO_POS_CODE', 'Cửa hàng chưa có Mã điểm nên chưa thanh toán được. Hãy báo nhân viên');
  const code = String(ref || '').toUpperCase();
  if (!/^[A-Z0-9]{1,6}-[A-Z0-9]{6,12}$/.test(code)) throw bad('BAD_REF', 'Mã giỏ không hợp lệ');
  // Mã giỏ phải bắt đầu bằng mã chi nhánh của chính phiên này: nhờ đó duy nhất trên toàn hệ thống, không thể tạo giỏ trùng mã ở chi nhánh khác để chen vào giỏ của người khác.
  if (code.split('-')[0] !== String(session.store_id).toUpperCase()) throw bad('BAD_REF', 'Mã giỏ không thuộc chi nhánh này');
  const same = db.prepare('SELECT * FROM transactions WHERE store_id = ? AND cart_code = ?').get(session.store_id, code);
  const mail = String(email || '').trim().toLowerCase();
  if (mail && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(mail)) throw bad('BAD_EMAIL', 'Email không hợp lệ');
  if (same) {
    if (same.session_id !== session.id) throw conflict('REF_USED', 'Mã giỏ đã dùng, hãy tạo lại');
    if (mail && !same.bill_email) db.prepare('UPDATE transactions SET bill_email = ? WHERE id = ?').run(mail, same.id);
    return txView(ctx, db.prepare('SELECT * FROM transactions WHERE id = ?').get(same.id));
  }
  if (session.status === 'locked') {
    // Khách đổi ý: bỏ giao dịch cũ chưa thu rồi khóa lại với mã mới.
    unlockSession(ctx, session);
    session = db.prepare('SELECT * FROM scan_sessions WHERE id = ?').get(session.id);
  }
  if (session.status !== 'active') throw conflict('SESSION_CLOSED', 'Phiên này đã kết thúc');
  const items = itemsOf(db, session.id);
  if (!items.length) throw bad('EMPTY_CART', 'Giỏ hàng đang trống');
  const { cur } = freshnessChanges(ctx, session, items);
  return db.transaction(() => {
    for (const it of items) {
      const c = cur.get(it.sku);
      if (c && c.active && !it.no_price) db.prepare('UPDATE cart_items SET unit_price=?, promo_min_qty=?, promo_off=?, name=? WHERE id=?').run(c.price, c.promo_min_qty, c.promo_off, c.name, it.id);
    }
    const fresh = itemsOf(db, session.id); // mặt hàng ngừng bán vẫn nằm trong giỏ để Dsmart POS quyết định
    const t = totals(fresh);
    const seq = nextCounter(db, session.store_id, 'tx');
    const id = `SG-${session.store_id}-${String(seq).padStart(4, '0')}`;
    const snapshot = fresh.map((i) => ({ sku: i.sku, barcode: i.barcode, name: i.name, price: i.unit_price, listPrice: i.list_price || null, noPrice: !!i.no_price, qty: i.qty, discount: lineDiscount(i), ageRestricted: !!i.age_restricted }));
    const ts = nowIso();
    db.prepare(`INSERT INTO transactions(id,session_id,store_id,device_id,cart_code,transfer_content,subtotal,discount,total,method,status,
      check_required,items_json,item_count,age_restricted,created_at,guard_skipped,bill_email) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, session.id, session.store_id, session.device_id, code, code, t.subtotal, t.discount, t.total, 'basket', 'awaiting_counter', 0,
        JSON.stringify(snapshot), itemCount(fresh), fresh.some((i) => i.age_restricted) ? 1 : 0, ts, 1, mail || null);
    db.prepare(`UPDATE scan_sessions SET status='locked', locked_at=?, last_activity=? WHERE id=?`).run(ts, ts, session.id);
    logScan(db, session, 'cart_locked', null, id);
    audit(db, { storeId: session.store_id, actorType: 'customer', actorId: session.device_id.slice(0, 8), action: 'basket.created', entity: 'transaction', entityId: id, data: { total: t.total, items: fresh.length, ref: code } });
    return txView(ctx, db.prepare('SELECT * FROM transactions WHERE id = ?').get(id));
  })();
}

/** Khách bấm "Đã thanh toán xong": kết thúc giỏ, giao dịch chuyển sang `handed_off` (đã chuyển Dsmart POS) nếu Dsmart POS chưa báo. */
export function finishBasket(ctx, session) {
  const { db } = ctx;
  const tx = db.prepare(`SELECT * FROM transactions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`).get(session.id);
  db.transaction(() => {
    if (tx && tx.status === 'awaiting_counter') db.prepare(`UPDATE transactions SET status='handed_off' WHERE id=?`).run(tx.id);
    db.prepare(`UPDATE scan_sessions SET status='exited', ended_at=? WHERE id=?`).run(nowIso(), session.id);
    if (tx) audit(db, { storeId: tx.store_id, actorType: 'customer', actorId: session.device_id.slice(0, 8), action: 'basket.finished', entity: 'transaction', entityId: tx.id });
  })();
}

export function unlockSession(ctx, session) {
  const { db } = ctx;
  if (session.status !== 'locked') throw conflict('NOT_LOCKED', 'Giỏ hàng chưa khóa');
  const tx = db.prepare(`SELECT * FROM transactions WHERE session_id = ? AND status = 'awaiting_counter'`).get(session.id);
  if (!tx) throw conflict('ALREADY_PAID', 'Giao dịch đã được thanh toán, không thể sửa giỏ');
  if (tx.exit_status === 'held') throw conflict('HELD', 'Giao dịch đang được quản lý xử lý');
  if (tx.pos_status === 'claimed') throw conflict('CLAIMED', 'Thu ngân đang xử lý đơn trên máy tính tiền, chưa sửa được giỏ');
  db.transaction(() => {
    db.prepare(`UPDATE transactions SET status='cancelled' WHERE id=?`).run(tx.id);
    db.prepare(`UPDATE scan_sessions SET status='active', last_activity=? WHERE id=?`).run(nowIso(), session.id);
    audit(db, { storeId: tx.store_id, actorType: 'customer', actorId: session.device_id.slice(0, 8), action: 'cart.unlocked', entity: 'transaction', entityId: tx.id });
  })();
}

// ====================== Ca làm việc ======================
export const activeShift = (db, staffId) =>
  db.prepare('SELECT * FROM shifts WHERE staff_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1').get(staffId);

export function shiftStats(db, shift) {
  const to = shift.ended_at || nowIso();
  const pay = db.prepare(`SELECT method, kind, COUNT(*) n, COALESCE(SUM(amount),0) s FROM payments
    WHERE shift_id = ? AND voided_at IS NULL GROUP BY method, kind`).all(shift.id);
  const sum = (m) => pay.filter((p) => p.method === m).reduce((a, p) => a + p.s, 0);
  const checks = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN result='mismatch' THEN 1 ELSE 0 END) mm FROM exit_checks WHERE staff_id = ? AND created_at BETWEEN ? AND ?`)
    .get(shift.staff_id, shift.started_at, to);
  const gate = db.prepare(`SELECT COUNT(*) n FROM gate_scans WHERE staff_id = ? AND outcome='valid' AND ts BETWEEN ? AND ?`)
    .get(shift.staff_id, shift.started_at, to);
  return {
    transactions: pay.filter((p) => p.kind === 'main').reduce((a, p) => a + p.n, 0),
    cash: sum('cash'), transfer: sum('qr_transfer'),
    checks: checks.n || 0, mismatches: checks.mm || 0, passedGate: gate.n || 0
  };
}

export function startShift(ctx, user, kind) {
  const { db } = ctx;
  if (!user.store_id) throw bad('NO_STORE', 'Tài khoản không thuộc chi nhánh nào');
  if (!['sang', 'chieu'].includes(kind)) throw bad('BAD_KIND', 'Ca không hợp lệ');
  const cur = activeShift(db, user.id);
  if (cur) return cur;
  const id = db.prepare('INSERT INTO shifts(store_id,staff_id,kind,started_at) VALUES(?,?,?,?)').run(user.store_id, user.id, kind, nowIso()).lastInsertRowid;
  audit(db, { storeId: user.store_id, actorType: 'staff', actorId: user.id, action: 'shift.started', entity: 'shift', entityId: String(id), data: { kind } });
  return db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
}

export function endShift(ctx, user, { countedCash, note }) {
  const { db } = ctx;
  const sh = activeShift(db, user.id);
  if (!sh) throw conflict('NO_SHIFT', 'Bạn chưa bắt đầu ca');
  const counted = money(countedCash);
  if (!Number.isFinite(counted) || counted < 0) throw bad('BAD_AMOUNT', 'Số tiền đếm thực tế không hợp lệ');
  const stats = shiftStats(db, sh);
  const diff = counted - stats.cash;
  if (diff !== 0 && !String(note || '').trim()) throw bad('NOTE_REQUIRED', 'Tiền mặt lệch, hãy ghi lý do trước khi kết thúc ca', { diff, systemCash: stats.cash });
  db.prepare('UPDATE shifts SET ended_at=?, system_cash=?, counted_cash=?, diff=?, note=? WHERE id=?')
    .run(nowIso(), stats.cash, counted, diff, note || null, sh.id);
  audit(db, { storeId: user.store_id, actorType: 'staff', actorId: user.id, action: 'shift.ended', entity: 'shift', entityId: String(sh.id), data: { systemCash: stats.cash, counted, diff, note } });
  return { ...db.prepare('SELECT * FROM shifts WHERE id = ?').get(sh.id), stats };
}

// ====================== Thu ngân ======================
export function findCart(ctx, user, codeRaw) {
  const { db } = ctx;
  const norm = normCode(codeRaw);
  if (!norm) throw bad('BAD_CODE', 'Nhập mã giỏ hàng');
  const rows = db.prepare(`SELECT * FROM transactions WHERE store_id = ? ORDER BY created_at DESC LIMIT 400`).all(user.store_id);
  const tx = rows.find((r) => normCode(r.cart_code) === norm || normCode(r.id) === norm || normCode(r.transfer_content) === norm);
  if (!tx) throw notFound('CART_NOT_FOUND', 'Không tìm thấy giỏ hàng này ở chi nhánh của bạn');
  return tx;
}

export const queue = (ctx, user) =>
  ctx.db.prepare(`SELECT * FROM transactions WHERE store_id = ? AND status = 'awaiting_counter' ORDER BY created_at`).all(user.store_id)
    .map((t) => ({ id: t.id, code: t.cart_code, total: t.total, itemCount: t.item_count, method: t.method, createdAt: t.created_at, checkRequired: !!t.check_required && !t.check_done }));

function ownTx(ctx, user, txId) {
  const tx = ctx.db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId);
  if (!tx || (user.role !== 'chain_admin' && tx.store_id !== user.store_id)) throw notFound('CART_NOT_FOUND', 'Không tìm thấy giao dịch');
  return tx;
}

export async function collectPayment(ctx, user, txId, body) {
  const { db, invoicer } = ctx;
  if (!canCash(user)) throw forbidden('NOT_CASHIER', 'Tài khoản này không được thu tiền');
  const tx = ownTx(ctx, user, txId);
  if (getStoreConfig(db, tx.store_id).cfg.payment_source === 'pos') throw conflict('POS_MODE', 'Chi nhánh thu tiền qua máy tính tiền (Dsmart POS). Thu tiền trên Dsmart POS, hệ thống tự xác nhận khi Dsmart POS báo thanh toán');
  const shift = activeShift(db, user.id);
  if (!shift) throw conflict('NO_SHIFT', 'Hãy bắt đầu ca trước khi thu tiền');
  if (tx.exit_status === 'held') throw conflict('HELD', 'Giao dịch đang chờ quản lý xử lý');
  let kind, amount;
  if (tx.status === 'awaiting_counter') { kind = 'main'; amount = tx.total + tx.extra_due; }
  else if (tx.status === 'paid' && tx.extra_due > 0) { kind = 'extra'; amount = tx.extra_due; }
  else throw conflict('NOT_COLLECTABLE', tx.status === 'paid' ? 'Giao dịch đã thu tiền rồi' : 'Giao dịch này không thu tiền được');

  const { cfg } = getStoreConfig(db, tx.store_id);
  const method = body.method;
  let cashReceived = null, change = null, confirmations = null;
  if (method === 'cash') {
    if (!cfg.pay_cash) throw bad('METHOD_UNAVAILABLE', 'Chi nhánh không nhận tiền mặt');
    cashReceived = money(body.cashReceived);
    if (!(cashReceived >= amount)) throw bad('CASH_SHORT', 'Khách đưa chưa đủ tiền', { amount, cashReceived });
    change = cashReceived - amount;
  } else if (method === 'qr_transfer') {
    if (!cfg.pay_qr) throw bad('METHOD_UNAVAILABLE', 'Chi nhánh không nhận chuyển khoản QR');
    const c = body.confirm || {};
    if (!(c.amount === true && c.content === true && c.received === true)) throw bad('CONFIRM_REQUIRED', 'Phải xác nhận đủ 3 điều kiện: số tiền, nội dung, tiền đã vào tài khoản');
    confirmations = JSON.stringify({ amount: true, content: true, received: true });
  } else throw bad('METHOD_UNAVAILABLE', 'Cách thanh toán này chưa được hỗ trợ');

  const ts = nowIso();
  db.transaction(() => {
    db.prepare(`INSERT INTO payments(transaction_id,store_id,kind,method,amount,cash_received,change_given,collected_by,shift_id,collected_at,confirmations)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(tx.id, tx.store_id, kind, method, amount, cashReceived, change, user.id, shift.id, ts, confirmations);
    if (kind === 'main') {
      const exp = new Date(Date.now() + config.receiptTtlMinutes * 60000).toISOString();
      db.prepare(`UPDATE transactions SET status='paid', method=?, paid_at=?, receipt_expires_at=?, extra_due=0 WHERE id=?`).run(method, ts, exp, tx.id);
      db.prepare(`UPDATE scan_sessions SET status='paid', ended_at=? WHERE id=?`).run(ts, tx.session_id);
    } else db.prepare('UPDATE transactions SET extra_due = 0 WHERE id = ?').run(tx.id);
    audit(db, { storeId: tx.store_id, actorType: 'staff', actorId: user.id, action: kind === 'main' ? 'payment.collected' : 'payment.extra_collected',
      entity: 'transaction', entityId: tx.id, data: { method, amount, cashReceived, change, shiftId: shift.id } });
    if (kind === 'main' && tx.guard_skipped) markExited(db, db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id), { id: 'SYSTEM' }, 'Không có bảo vệ');
  })();
  const updated = db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id);
  if (kind === 'main') await issueInvoice(db, invoicer, updated, {});
  return { transaction: txView(ctx, updated, { staff: true }), amount, change, kind };
}

export function cancelCart(ctx, user, txId, reason) {
  const { db } = ctx;
  const tx = ownTx(ctx, user, txId);
  if (!canCash(user)) throw forbidden();
  if (tx.status !== 'awaiting_counter') throw conflict('NOT_CANCELLABLE', 'Chỉ hủy được giỏ đang chờ thu tiền');
  db.transaction(() => {
    db.prepare(`UPDATE transactions SET status='cancelled' WHERE id=?`).run(tx.id);
    db.prepare(`UPDATE scan_sessions SET status='active', last_activity=? WHERE id=?`).run(nowIso(), tx.session_id);
    audit(db, { storeId: tx.store_id, actorType: 'staff', actorId: user.id, action: 'cart.cancelled', entity: 'transaction', entityId: tx.id, data: { reason } });
  })();
}

/** Hủy xác nhận thu tiền (chỉ quản lý). Dùng khi bấm nhầm hoặc phát hiện sai sót. */
export function voidTransaction(ctx, user, txId, reason) {
  const { db } = ctx;
  if (!isManager(user)) throw forbidden('MANAGER_ONLY', 'Chỉ quản lý mới hủy được giao dịch đã thu tiền');
  const tx = ownTx(ctx, user, txId);
  if (!String(reason || '').trim()) throw bad('REASON_REQUIRED', 'Hãy nhập lý do hủy');
  if (tx.status !== 'paid') throw conflict('NOT_PAID', 'Chỉ hủy được giao dịch đã thu tiền');
  if (tx.exit_status === 'exited') throw conflict('ALREADY_EXITED', 'Khách đã ra cổng, không hủy được');
  const ts = nowIso();
  db.transaction(() => {
    db.prepare(`UPDATE transactions SET status='voided', void_reason=?, voided_at=?, voided_by=? WHERE id=?`).run(reason, ts, user.id, tx.id);
    db.prepare('UPDATE payments SET voided_at = ? WHERE transaction_id = ? AND voided_at IS NULL').run(ts, tx.id);
    db.prepare(`UPDATE invoices SET status = CASE WHEN status='issued' THEN 'cancel_requested' ELSE 'cancelled' END WHERE transaction_id = ?`).run(tx.id);
    db.prepare(`UPDATE scan_sessions SET status='abandoned' WHERE id=?`).run(tx.session_id);
    audit(db, { storeId: tx.store_id, actorType: 'staff', actorId: user.id, action: 'transaction.voided', entity: 'transaction', entityId: tx.id, data: { reason } });
  })();
}

// ====================== Cổng ra & kiểm tra ngẫu nhiên ======================
function gateLog(db, user, txId, outcome, detail) {
  db.prepare('INSERT INTO gate_scans(store_id,staff_id,transaction_id,outcome,detail,ts) VALUES(?,?,?,?,?,?)')
    .run(user.store_id, user.id, txId ?? null, outcome, detail ? JSON.stringify(detail) : null, nowIso());
}

export function markExited(db, tx, user, gate) {
  const ts = nowIso();
  db.prepare(`UPDATE transactions SET exit_status='exited', exited_at=?, exited_by=?, exited_gate=? WHERE id=?`).run(ts, user.id, gate, tx.id);
  db.prepare(`UPDATE scan_sessions SET status='exited' WHERE id=?`).run(tx.session_id);
  audit(db, { storeId: tx.store_id, actorType: 'staff', actorId: user.id, action: 'gate.exited', entity: 'transaction', entityId: tx.id, data: { gate } });
}

const summary = (tx) => ({ id: tx.id, code: tx.cart_code, itemCount: tx.item_count, total: tx.total, method: tx.method, paidAt: tx.paid_at });

export function gateScan(ctx, user, raw, gate = 'Cổng 1') {
  const { db } = ctx;
  if (!canGate(user)) throw forbidden('NOT_GATE', 'Tài khoản này không được kiểm tra cổng ra');
  if (!getStoreConfig(db, user.store_id).cfg.guard_check) throw conflict('GUARD_DISABLED', 'Chi nhánh này không dùng bước kiểm tra của bảo vệ ở cổng ra');
  const text = String(raw || '').trim();
  const parsed = parseReceiptToken(text);
  const out = (outcome, extra = {}, tx = null) => {
    gateLog(db, user, tx?.id, outcome, extra.reason ? { reason: extra.reason } : null);
    return { outcome, ...extra, transaction: tx ? summary(tx) : undefined };
  };
  if (!parsed) {
    if (/^GH-/i.test(text)) return out('not_receipt', { reason: 'Đây là mã giỏ hàng, không phải QR biên nhận' });
    return out('invalid', { reason: 'Mã không hợp lệ' });
  }
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(parsed.txId);
  if (!tx || (user.role !== 'chain_admin' && tx.store_id !== user.store_id)) return out('invalid', { reason: 'Không tìm thấy giao dịch ở chi nhánh này' });
  if (tx.status === 'voided' || tx.status === 'cancelled') return out('invalid', { reason: 'Giao dịch đã bị hủy' }, tx);
  if (tx.status === 'awaiting_counter') return out('unpaid', { reason: 'Chưa thanh toán' }, tx);
  if (tx.exit_status === 'exited') return out('used', { reason: 'QR đã được dùng', usedAt: tx.exited_at, usedBy: tx.exited_by, gate: tx.exited_gate }, tx);
  if (tx.receipt_expires_at < nowIso()) return out('expired', { reason: 'QR đã hết hạn' }, tx);
  if (tx.exit_status === 'held') return out('held', { reason: 'Đang chờ quản lý xử lý' }, tx);
  if (tx.exit_status === 'denied') return out('denied', { reason: 'Quản lý không cho qua, hãy gặp quản lý' }, tx);
  if (tx.extra_due > 0) return out('extra_due', { reason: 'Còn khoản thu bổ sung', amount: tx.extra_due }, tx);
  if (tx.check_required && !tx.check_done) {
    db.prepare(`UPDATE transactions SET exit_status='checking' WHERE id=?`).run(tx.id);
    audit(db, { storeId: tx.store_id, actorType: 'staff', actorId: user.id, action: 'gate.check_required', entity: 'transaction', entityId: tx.id });
    gateLog(db, user, tx.id, 'check_required', null);
    return { outcome: 'check_required', transaction: summary(tx), items: JSON.parse(tx.items_json).map((i) => ({ sku: i.sku, name: i.name, qty: i.qty })) };
  }
  markExited(db, tx, user, gate);
  gateLog(db, user, tx.id, 'valid', null);
  return { outcome: 'valid', transaction: summary(tx) };
}

export function recordCheck(ctx, user, body) {
  const { db } = ctx;
  if (!canGate(user) && !canCash(user)) throw forbidden();
  const tx = ownTx(ctx, user, body.transactionId);
  if (!['paid', 'awaiting_counter'].includes(tx.status)) throw conflict('NOT_CHECKABLE', 'Giao dịch này không kiểm tra được');
  if (tx.check_done) throw conflict('ALREADY_CHECKED', 'Giao dịch này đã được kiểm tra');
  const place = body.place === 'counter' ? 'counter' : 'gate';
  if (place === 'gate' && !getStoreConfig(db, tx.store_id).cfg.guard_check) throw conflict('GUARD_DISABLED', 'Chi nhánh này không dùng bước kiểm tra của bảo vệ ở cổng ra');
  if (place === 'counter' && tx.status !== 'awaiting_counter') throw conflict('NOT_CHECKABLE', 'Kiểm tra tại quầy chỉ làm trước khi thu tiền');
  if (place === 'gate' && tx.status !== 'paid') throw conflict('NOT_CHECKABLE', 'Giao dịch chưa thanh toán');
  const result = body.result === 'mismatch' ? 'mismatch' : body.result === 'match' ? 'match' : null;
  if (!result) throw bad('BAD_RESULT', 'Kết quả kiểm tra không hợp lệ');
  let amount = null, action = null;
  if (result === 'mismatch') {
    action = body.action;
    if (!['collect_extra', 'call_manager'].includes(action)) throw bad('ACTION_REQUIRED', 'Chọn cách xử lý chênh lệch');
    if (action === 'collect_extra') {
      amount = money(body.amount);
      if (!(amount > 0)) throw bad('AMOUNT_REQUIRED', 'Nhập số tiền chênh lệch cần thu thêm');
    }
  }
  const ts = nowIso();
  db.transaction(() => {
    db.prepare(`INSERT INTO exit_checks(transaction_id,store_id,staff_id,place,result,kind,sku,amount,note,action,lines,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(tx.id, tx.store_id, user.id, place, result, body.kind || null, body.sku || null, amount,
      body.note || null, action, body.lines ? JSON.stringify(body.lines) : null, ts);
    db.prepare('UPDATE transactions SET check_done = 1 WHERE id = ?').run(tx.id);
    if (result === 'mismatch' && action === 'collect_extra') db.prepare('UPDATE transactions SET extra_due = extra_due + ? WHERE id = ?').run(amount, tx.id);
    if (result === 'mismatch' && action === 'call_manager') db.prepare(`UPDATE transactions SET exit_status='held' WHERE id=?`).run(tx.id);
    audit(db, { storeId: tx.store_id, actorType: 'staff', actorId: user.id, action: `check.${result}`, entity: 'transaction', entityId: tx.id,
      data: { place, kind: body.kind, amount, action, note: body.note } });
  })();
  const after = db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id);
  let exited = false;
  if (result === 'match' && place === 'gate' && after.extra_due === 0) { markExited(db, after, user, body.gate || 'Cổng 1'); exited = true; }
  return { transaction: txView(ctx, db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id), { staff: true }), exited };
}

export function resolveHeld(ctx, user, txId, { decision, note }) {
  const { db } = ctx;
  if (!isManager(user)) throw forbidden('MANAGER_ONLY', 'Chỉ quản lý mới xử lý được ca này');
  const tx = ownTx(ctx, user, txId);
  if (!['held', 'denied'].includes(tx.exit_status)) throw conflict('NOT_HELD', 'Giao dịch này không ở trạng thái chờ quản lý');
  if (!['allow', 'deny'].includes(decision)) throw bad('BAD_DECISION', 'Quyết định không hợp lệ');
  const ts = nowIso();
  db.prepare(`UPDATE exit_checks SET resolution=?, resolved_by=?, resolved_at=?, resolve_note=? WHERE id = (SELECT MAX(id) FROM exit_checks WHERE transaction_id=? AND action='call_manager')`)
    .run(decision, user.id, ts, note || null, tx.id);
  audit(db, { storeId: tx.store_id, actorType: 'staff', actorId: user.id, action: `check.resolved_${decision}`, entity: 'transaction', entityId: tx.id, data: { note } });
  if (decision === 'allow') {
    db.prepare(`UPDATE transactions SET exit_status='checking', check_done=1 WHERE id=?`).run(tx.id);
    if (tx.status === 'paid' && tx.extra_due === 0) markExited(db, db.prepare('SELECT * FROM transactions WHERE id=?').get(tx.id), user, 'Quản lý duyệt');
    return { decision, exited: tx.status === 'paid' && tx.extra_due === 0 };
  }
  db.prepare(`UPDATE transactions SET exit_status='denied' WHERE id=?`).run(tx.id);
  return { decision, exited: false };
}

export const gateHistory = (ctx, user, limit = 50) =>
  ctx.db.prepare('SELECT * FROM gate_scans WHERE store_id = ? ORDER BY id DESC LIMIT ?').all(user.store_id, limit);

export { localDate };
