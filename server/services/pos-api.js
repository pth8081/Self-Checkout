// API cho phần mềm Dsmart POS gọi vào BRG Scan & Checkout (Dsmart POS là bên gọi):
//   1. Dsmart POS quét mã giỏ hàng của khách và "nhận" giỏ (lấy danh sách mặt hàng để tự nhập vào đơn Dsmart POS).
//   2. Dsmart POS báo đơn đã thanh toán, BRG tự xác nhận và cho khách ra (thu ngân không phải xác nhận lại).
//   3. Dsmart POS báo đơn đã hủy.
// Mọi lời gọi đều idempotent theo mã đơn Dsmart POS (posOrderRef), gọi lại không tạo trùng.
import { getSetting, setSetting } from '../db.js';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { nowIso, bad, notFound, conflict, forbidden, money } from '../util.js';
import { audit } from './audit.js';
import { getStoreConfig, txView, markExited } from './core.js';
import { sendBillEmailBg } from './bill-email.js';
import { extraOf, linksOf } from './bill.js';

export const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex');
export function newKey() {
  const raw = `brgpos_${crypto.randomBytes(24).toString('base64url')}`;
  return { raw, prefix: raw.slice(0, 14), hash: hashKey(raw) };
}

export const POS_METHODS = ['cash', 'qr_transfer', 'card', 'ewallet', 'other'];
const REF = /^[A-Za-z0-9._:/-]{1,64}$/;
const MAX_AMOUNT = 2_000_000_000; // trần số tiền một lần báo thanh toán (2 tỷ đồng): chặn số quá lớn làm hỏng báo cáo

const byCode = (db, code) => db.prepare('SELECT * FROM transactions WHERE cart_code = ? ORDER BY created_at DESC LIMIT 1').get(String(code || '').trim().toUpperCase());
// Mã đơn Dsmart (posOrderRef) chỉ duy nhất trong phạm vi MỘT cửa hàng: nhiều cửa hàng có thể cùng gửi HD0001. Luôn tra kèm chi nhánh khi biết (từ giỏ hoặc từ khóa API gắn chi nhánh).
const byRef = (db, ref, storeId) => (storeId
  ? db.prepare('SELECT * FROM transactions WHERE pos_order_ref = ? AND store_id = ? ORDER BY created_at DESC LIMIT 1').get(String(ref || ''), storeId)
  : oneRef(db, String(ref || '')));
/** Khóa không gắn chi nhánh mà mã đơn có ở nhiều cửa hàng thì không đoán: trả lỗi để POS gọi theo mã giỏ (có mã điểm). */
function oneRef(db, ref) {
  const rows = db.prepare('SELECT * FROM transactions WHERE pos_order_ref = ? ORDER BY created_at DESC LIMIT 2').all(ref);
  if (rows.length > 1 && rows[0].store_id !== rows[1].store_id) throw conflict('AMBIGUOUS_REF', 'Mã đơn này có ở nhiều cửa hàng, hãy gọi theo mã giỏ (/baskets/{mã giỏ}/...)');
  return rows[0];
}
function inScope(scope, tx) { if (scope.storeId && scope.storeId !== tx.store_id) throw forbidden('STORE_FORBIDDEN', 'Khóa API này không dùng cho chi nhánh của giỏ hàng'); }

/** Dữ liệu giỏ hàng trả cho Dsmart POS: các mặt hàng đã chốt giá (Dsmart POS tự tính lại theo giá và khuyến mãi của Dsmart POS). */
export function cartForPos(tx) {
  const items = JSON.parse(tx.items_json).map((i) => ({
    sku: i.sku, barcode: i.barcode, name: i.name, qty: i.qty, unitPrice: i.price, discount: i.discount || 0, lineTotal: i.price * i.qty - (i.discount || 0)
  }));
  return {
    code: tx.cart_code, transactionId: tx.id, storeId: tx.store_id, status: tx.status, posStatus: tx.pos_status, posOrderRef: tx.pos_order_ref,
    subtotal: tx.subtotal, discount: tx.discount, total: tx.total, itemCount: tx.item_count, ageRestricted: !!tx.age_restricted,
    buyer: tx.buyer_json ? JSON.parse(tx.buyer_json) : null, createdAt: tx.created_at, items
  };
}

export function previewCart(ctx, scope, code) {
  const tx = byCode(ctx.db, code);
  if (!tx) throw notFound('CART_NOT_FOUND', 'Không tìm thấy giỏ hàng với mã này');
  inScope(scope, tx);
  return cartForPos(tx);
}

export function claimCart(ctx, scope, code, body = {}) {
  const { db } = ctx;
  const ref = String(body.posOrderRef || '');
  if (!REF.test(ref)) throw bad('BAD_ORDER_REF', 'posOrderRef bắt buộc, tối đa 64 ký tự (chữ, số, . _ : / -)');
  const tx = byCode(db, code);
  if (!tx) throw notFound('CART_NOT_FOUND', 'Không tìm thấy giỏ hàng với mã này');
  inScope(scope, tx);
  if (getStoreConfig(db, tx.store_id).cfg.payment_source !== 'pos') throw conflict('POS_MODE_OFF', 'Chi nhánh này chưa bật chế độ thu tiền qua Dsmart POS');
  if (tx.pos_order_ref === ref) return { claimed: true, duplicate: true, cart: cartForPos(tx) }; // gọi lại cùng mã đơn
  const other = byRef(db, ref, tx.store_id);
  if (other && other.id !== tx.id) throw conflict('REF_IN_USE', 'Mã đơn Dsmart POS này đã gắn với giỏ hàng khác');
  if (!['awaiting_counter', 'handed_off'].includes(tx.status)) throw conflict('NOT_PAYABLE', `Giỏ hàng đang ở trạng thái "${tx.status}", không nhận được`, { status: tx.status });
  if (tx.pos_status === 'claimed') throw conflict('ALREADY_CLAIMED', 'Giỏ hàng đã được đơn Dsmart POS khác nhận', { posOrderRef: tx.pos_order_ref });
  db.transaction(() => {
    db.prepare(`UPDATE transactions SET pos_order_ref=?, pos_status='claimed', pos_claimed_at=?, pos_cashier=?, pos_terminal=? WHERE id=?`)
      .run(ref, nowIso(), body.cashier ? String(body.cashier).slice(0, 40) : null, body.terminal ? String(body.terminal).slice(0, 40) : null, tx.id);
    audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `Dsmart POS:${scope.name}`, action: 'pos.claimed', entity: 'transaction', entityId: tx.id,
      data: { posOrderRef: ref, cashier: body.cashier, terminal: body.terminal } });
  })();
  return { claimed: true, duplicate: false, cart: cartForPos(db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id)) };
}

export function orderStatus(ctx, scope, ref) {
  const tx = byRef(ctx.db, ref, scope.storeId || undefined);
  if (!tx) throw notFound('ORDER_NOT_FOUND', 'Không tìm thấy đơn Dsmart POS này');
  inScope(scope, tx);
  return { posOrderRef: tx.pos_order_ref, code: tx.cart_code, transactionId: tx.id, status: tx.status, posStatus: tx.pos_status, total: tx.total,
    paidAmount: tx.pos_amount, exitStatus: tx.exit_status, guardCheck: !tx.guard_skipped };
}

/** Bill thật của Dsmart POS: danh sách dòng đã tính giá và khuyến mãi. Lúc thanh toán chưa có hóa đơn điện tử nên không có số hóa đơn. */
/** Tên mặt hàng theo mã hàng: ưu tiên giỏ khách, rồi bảng sản phẩm, không có thì dùng chính mã hàng. */
function lineNamer(db, tx) {
  const names = new Map(JSON.parse(tx.items_json).map((it) => [String(it.barcode), it.name]));
  const cached = db.prepare('SELECT name FROM product_cache WHERE store_id = ? AND barcode = ?');
  return (barcode) => names.get(barcode) || cached.get(tx.store_id, barcode)?.name || barcode;
}

/**
 * Tra một dòng do Dsmart POS gửi (theo `sku` = SKU_ID, hoặc `barcode`) về mặt hàng của BRG: ưu tiên giỏ khách, rồi bảng giá lưu sẵn.
 * Dsmart POS không có giá bán thực nên chỉ cần gửi SKU_ID và số lượng; đơn giá ở đây chỉ là giá BRG đã biết để hiện bill.
 */
function itemResolver(db, tx) {
  const cart = JSON.parse(tx.items_json);
  const cache = db.prepare('SELECT sku, barcode, name, price FROM product_cache WHERE store_id = ? AND (sku = ? OR barcode = ?)');
  return (key) => {
    const k = String(key);
    const c = cart.find((i) => String(i.sku) === k || String(i.barcode) === k);
    if (c) return { sku: c.sku, barcode: String(c.barcode), name: c.name, price: c.noPrice ? 0 : c.price, known: true };
    const r = cache.get(tx.store_id, k, k);
    if (r) return { sku: r.sku, barcode: String(r.barcode), name: r.name, price: r.price, known: true };
    return { sku: k, barcode: k, name: k, price: 0, known: false };
  };
}
/** Thử lần lượt sku, barcode (và tên nếu cho phép) cho tới khi gặp mặt hàng BRG đã biết. */
function findLine(find, l, byName = false) {
  const keys = [l?.sku, l?.barcode, byName ? l?.name : null].filter(Boolean).map((k) => String(k).trim().slice(0, 64));
  for (const k of keys) { const it = find(k); if (it.known) return it; }
  return find(keys[0]);
}
const lineKey = (l, byName = false) => (l?.sku ? String(l.sku).trim().slice(0, 64) : l?.barcode ? String(l.barcode).trim().slice(0, 64) : byName && l?.name ? String(l.name).trim().slice(0, 64) : '');

function cleanBill(body, db, tx) {
  let lines = null;
  if (body.lines !== undefined && body.lines !== null) {
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 300) throw bad('BAD_LINES', 'lines là danh sách 1 đến 300 dòng');
    // Mỗi dòng bắt buộc: sku (SKU_ID) hoặc barcode, và số lượng. Đơn giá, giảm giá, thành tiền KHÔNG bắt buộc: bỏ trống thì BRG tạm tính theo giá BRG đã biết.
    const find = itemResolver(db, tx);
    lines = body.lines.map((l, i) => {
      const key = lineKey(l, true);
      const qty = Number(l?.qty);
      const optInt = (v) => v === undefined || v === null || (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= MAX_AMOUNT);
      if (!key || !(qty > 0 && qty < 100000) || !optInt(l?.lineTotal) || !optInt(l?.discount) || !optInt(l?.unitPrice)) {
        throw bad('BAD_LINES', `Dòng ${i + 1} không hợp lệ: cần sku (SKU_ID) hoặc barcode, qty > 0; unitPrice, discount, lineTotal nếu gửi phải là số nguyên đồng`);
      }
      const it = findLine(find, l, true);
      const name = String(l?.name || '').trim().slice(0, 200) || it.name;
      const discount = Number(l?.discount ?? 0);
      const hasTotal = l?.lineTotal !== undefined && l?.lineTotal !== null;
      const unitPrice = l?.unitPrice !== undefined && l?.unitPrice !== null ? Number(l.unitPrice) : hasTotal ? Math.round((Number(l.lineTotal) + discount) / qty) : it.price;
      const lineTotal = hasTotal ? Number(l.lineTotal) : Math.max(0, Math.round(unitPrice * qty) - discount);
      return { sku: it.sku, barcode: it.barcode, name, qty, unitPrice, discount, lineTotal, estimated: !hasTotal };
    });
  }
  return { lines };
}


/** Link hóa đơn điện tử và link giao dịch Dsmart POS gửi kèm. Chỉ nhận https, tối đa 600 ký tự, không khoảng trắng. */
const POSLINK_KEY = 'pos_links';
/** Mẫu link giao dịch: BRG tự dựng link từ posOrderRef khi Dsmart POS không gửi transactionUrl. Ví dụ https://dsmart.vn/giao-dich/{posOrderRef} */
export const posLinkConfig = (db) => ({ transactionUrlTemplate: getSetting(db, POSLINK_KEY, {}).transactionUrlTemplate || '' });
export function savePosLinkConfig(db, b = {}) {
  const t = String(b.transactionUrlTemplate ?? '').trim();
  if (t && (!/^https:\/\/[^\s{}]+\{posOrderRef\}[^\s{}]*$/.test(t) || t.length > 300)) return { error: 'Mẫu link phải bắt đầu bằng https://, chứa {posOrderRef} đúng một lần, không có khoảng trắng, tối đa 300 ký tự' };
  setSetting(db, POSLINK_KEY, { transactionUrlTemplate: t });
  return { config: posLinkConfig(db) };
}
const LINK_RE = /^https:\/\/[^\s]{1,590}$/;
// Ký tự điều khiển, chữ ẩn/đảo chiều (bidi, zero-width), dấu nháy, ngoặc nhọn, gạch chéo ngược và ký tự @ sau phần tên miền giả (userinfo) đều bị từ chối.
const LINK_BAD = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff"'<>\\`{}|^]/;
function safeUrl(u) {
  if (!LINK_RE.test(u) || u.length > 600 || LINK_BAD.test(u)) return false;
  try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password && x.hostname.includes('.'); } catch { return false; }
}
function cleanLinks(body, strict = false) {
  const out = {}; const warnings = [];
  for (const k of ['invoiceUrl', 'transactionUrl']) {
    const v = body?.[k];
    if (v === undefined || v === null || v === '') continue;
    const u = String(v).trim();
    if (safeUrl(u)) out[k] = u;
    else if (strict) throw bad('BAD_URL', `${k} phải bắt đầu bằng https://, không có khoảng trắng, không có ký tự lạ, không chứa user@, tối đa 600 ký tự`);
    else warnings.push(`${k} bị bỏ qua: phải bắt đầu bằng https://, không có khoảng trắng, tối đa 600 ký tự`);
  }
  return { links: out, warnings };
}
function saveLinks(db, txId, links) {
  const sets = []; const vals = [];
  if (links.invoiceUrl) { sets.push('pos_invoice_url = ?'); vals.push(links.invoiceUrl); }
  if (links.transactionUrl) { sets.push('pos_transaction_url = ?'); vals.push(links.transactionUrl); }
  if (sets.length) db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...vals, txId);
}

export function orderPaid(ctx, scope, ref, body = {}, storeId) {
  const { db } = ctx;
  const tx = byRef(db, ref, storeId ?? (scope.storeId || undefined));
  if (!tx) throw notFound('ORDER_NOT_FOUND', 'Chưa nhận đơn Dsmart POS này. Hãy gọi "nhận giỏ hàng" trước');
  inScope(scope, tx);
  const { links, warnings } = cleanLinks(body);
  const result = (dup) => ({ ok: true, duplicate: dup, ...(warnings.length ? { warnings } : {}), transactionId: tx.id, status: 'paid', guardCheck: !tx.guard_skipped,
    exitStatus: db.prepare('SELECT exit_status FROM transactions WHERE id = ?').get(tx.id).exit_status, amountMatches: money(tx.pos_amount) === tx.total });
  if (tx.status === 'paid') {
    // Báo lại: không tạo thêm khoản thu, nhưng nhận bill nếu lần trước chưa gửi.
    if (Number.isInteger(body.amount) && tx.pos_amount != null && body.amount !== tx.pos_amount) throw conflict('PAID_MISMATCH', 'Đơn này đã được báo thanh toán với số tiền khác. Không ghi đè', { amount: tx.pos_amount });
    const { lines } = cleanBill(body, db, tx);
    if (lines && !tx.pos_bill_json) {
      const x = extraOf(JSON.parse(tx.items_json), lines);
      db.prepare('UPDATE transactions SET pos_bill_json = ?, extra_qty = ?, extra_value = ?, less_qty = ? WHERE id = ?').run(JSON.stringify(lines), x.extraQty, x.extraValue, x.lessQty, tx.id);
    }
    saveLinks(db, tx.id, links); // báo lại kèm link (hoặc link mới hơn): cập nhật
    return result(true);
  }
  // Khách có thể sửa giỏ (giỏ bị hủy phía điện thoại) trong lúc Dsmart POS đã quét mã QR cũ và thu tiền. Tiền đã thu là thật nên vẫn ghi nhận.
  // Chỉ từ chối khi chính Dsmart POS đã hủy đơn này hoặc đơn đã bị hủy sau thanh toán.
  // Giỏ bị khách sửa hoặc quản trị "nhả giỏ" trong lúc thu ngân đã thu tiền: tiền thu là thật nên vẫn ghi nhận. Chỉ từ chối khi chính Dsmart POS đã hủy.
  const released = tx.status === 'cancelled' && !!db.prepare("SELECT 1 FROM audit_events WHERE entity_id = ? AND action = 'pos.released'").get(tx.id);
  const late = tx.status === 'cancelled' && tx.method === 'basket' && (tx.pos_status !== 'cancelled' || released);
  if (tx.status === 'voided' || (tx.status === 'cancelled' && !late)) throw conflict('ORDER_CANCELLED', 'Đơn này đã bị hủy');
  if (!late && !['awaiting_counter', 'handed_off'].includes(tx.status)) throw conflict('NOT_PAYABLE', 'Đơn không ở trạng thái chờ thanh toán');
  const amount = body.amount;
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) throw bad('BAD_AMOUNT', `amount là số nguyên dương, đơn vị đồng, tối đa ${MAX_AMOUNT.toLocaleString('vi-VN')}`);
  // Một giỏ có thể thanh toán bằng NHIỀU hình thức: gửi `payments: [{ method, amount }, ...]` (tổng amount phải bằng `amount`). Không gửi thì dùng `method` như cũ.
  let pays;
  if (body.payments !== undefined && body.payments !== null) {
    if (!Array.isArray(body.payments) || body.payments.length < 1 || body.payments.length > 6) throw bad('BAD_PAYMENTS', 'payments là danh sách từ 1 đến 6 hình thức thanh toán');
    pays = body.payments.map((p, i) => {
      if (!POS_METHODS.includes(p?.method) || !Number.isInteger(p?.amount) || p.amount <= 0 || p.amount > MAX_AMOUNT) throw bad('BAD_PAYMENTS', `Dòng ${i + 1} của payments cần method (${POS_METHODS.join(', ')}) và amount là số nguyên dương`);
      return { method: p.method, amount: p.amount };
    });
    if (pays.reduce((a, p) => a + p.amount, 0) !== amount) throw bad('BAD_PAYMENTS', 'Tổng amount của payments phải bằng amount');
  } else {
    if (!POS_METHODS.includes(body.method)) throw bad('BAD_METHOD', `method phải là một trong: ${POS_METHODS.join(', ')} (hoặc gửi payments khi thanh toán nhiều hình thức)`);
    pays = [{ method: body.method, amount }];
  }
  const txMethod = pays.length === 1 ? pays[0].method : 'mixed';
  const invoiceNo = body.invoiceNo ? String(body.invoiceNo).slice(0, 64) : null;
  const { lines } = cleanBill(body, db, tx);
  const xtra = lines ? extraOf(JSON.parse(tx.items_json), lines) : { extraQty: 0, extraValue: 0, lessQty: 0 };
  const cashier = body.cashier ? String(body.cashier).slice(0, 40) : tx.pos_cashier;
  const ts = nowIso();
  const differs = amount !== tx.total;
  db.transaction(() => {
    const exp = new Date(Date.now() + config.receiptTtlMinutes * 60000).toISOString();
    for (const pm of pays) {
      db.prepare(`INSERT INTO payments(transaction_id,store_id,kind,method,amount,collected_by,collected_at,provider,provider_ref,confirmations)
        VALUES(?,?,'main',?,?,?,?,'pos',?,?)`).run(tx.id, tx.store_id, pm.method, pm.amount, `Dsmart POS:${cashier || scope.name}`, ts, ref,
        JSON.stringify({ paidAt: body.paidAt || null, terminal: body.terminal || tx.pos_terminal || null, note: body.note || null }));
    }
    db.prepare(`UPDATE transactions SET status='paid', method=?, paid_at=?, receipt_expires_at=?, extra_due=0, pos_status='paid', pos_amount=?,
      pos_invoice_no=?, pos_cashier=?, pos_bill_json=?, extra_qty=?, extra_value=?, less_qty=? WHERE id=?`).run(txMethod, ts, exp, amount, invoiceNo, cashier || null, lines ? JSON.stringify(lines) : null, xtra.extraQty, xtra.extraValue, xtra.lessQty, tx.id);
    if (!links.transactionUrl) { const t = posLinkConfig(db).transactionUrlTemplate; if (t) links.transactionUrl = t.replace('{posOrderRef}', encodeURIComponent(ref)); } // BRG tự dựng link giao dịch từ mã đơn
    saveLinks(db, tx.id, links);
    if (!late) db.prepare(`UPDATE scan_sessions SET status='paid', ended_at=? WHERE id=?`).run(ts, tx.session_id); // giỏ đã bị khách sửa: phiên có thể đang giữ giỏ mới, không đụng tới
    if (late) audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `Dsmart POS:${scope.name}`, action: 'pos.paid_after_cancel', entity: 'transaction', entityId: tx.id, data: { amount, posOrderRef: ref } });
    if (invoiceNo) {
      const buyer = tx.buyer_json ? JSON.parse(tx.buyer_json) : {};
      db.prepare(`INSERT INTO invoices(transaction_id,type,email,tax_code,company_name,address,status,number,created_at) VALUES(?,?,?,?,?,?,'issued',?,?)`)
        .run(tx.id, buyer.taxCode ? 'company' : 'retail', buyer.email || null, buyer.taxCode || null, buyer.companyName || null, buyer.address || null, invoiceNo, ts);
    }
    audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `Dsmart POS:${scope.name}`, action: 'payment.collected', entity: 'transaction', entityId: tx.id,
      data: { source: 'pos', method: txMethod, payments: pays.length > 1 ? pays : undefined, amount, posOrderRef: ref, invoiceNo, cashier } });
    if (differs) audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `Dsmart POS:${scope.name}`, action: 'pos.amount_differs', entity: 'transaction', entityId: tx.id, data: { brgTotal: tx.total, posAmount: amount, suspicious: amount < tx.total * 0.5 || amount > tx.total * 2 + 100000 } });
    if (tx.guard_skipped) {
      if (late) db.prepare(`UPDATE transactions SET exit_status='exited', exited_at=?, exited_by='SYSTEM', exited_gate='Không có bảo vệ' WHERE id=?`).run(ts, tx.id);
      else markExited(db, db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id), { id: 'SYSTEM' }, 'Không có bảo vệ');
    }
  })();
  if (tx.bill_email) { db.prepare("UPDATE transactions SET bill_email_status='pending' WHERE id=? AND bill_email_status IS NULL").run(tx.id); sendBillEmailBg(ctx, tx.id); }
  return result(false);
}

export function orderCancelled(ctx, scope, ref, body = {}, storeId) {
  const { db } = ctx;
  const tx = byRef(db, ref, storeId ?? (scope.storeId || undefined));
  if (!tx) throw notFound('ORDER_NOT_FOUND', 'Không tìm thấy đơn Dsmart POS này');
  inScope(scope, tx);
  const reason = String(body.reason || 'Dsmart POS hủy đơn').slice(0, 200);
  if (tx.status === 'cancelled' || tx.status === 'voided') return { ok: true, duplicate: true, status: tx.status };
  const ts = nowIso();
  if (tx.status === 'handed_off') {
    db.prepare(`UPDATE transactions SET status='cancelled', pos_status='cancelled' WHERE id=?`).run(tx.id);
    return { ok: true, status: 'cancelled' };
  }
  if (tx.status === 'awaiting_counter') {
    // Chưa thu tiền: nhả giỏ để khách sửa hoặc khóa lại.
    db.transaction(() => {
      db.prepare(`UPDATE transactions SET status='cancelled', pos_status='cancelled' WHERE id=?`).run(tx.id);
      db.prepare(`UPDATE scan_sessions SET status='active', last_activity=? WHERE id=?`).run(ts, tx.session_id);
      audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `Dsmart POS:${scope.name}`, action: 'cart.cancelled', entity: 'transaction', entityId: tx.id, data: { reason, posOrderRef: ref } });
    })();
    return { ok: true, status: 'cancelled', cartReleased: true };
  }
  if (tx.status === 'paid') {
    // Đã thu: Dsmart POS là nguồn đúng, nên hủy theo Dsmart POS (QR mất hiệu lực, không tính doanh thu, hóa đơn chuyển yêu cầu hủy).
    const exited = tx.exit_status === 'exited';
    db.transaction(() => {
      db.prepare(`UPDATE transactions SET status='voided', pos_status='cancelled', void_reason=?, voided_at=?, voided_by=? WHERE id=?`).run(`Dsmart POS hủy: ${reason}`, ts, `Dsmart POS:${scope.name}`, tx.id);
      db.prepare('UPDATE payments SET voided_at = ? WHERE transaction_id = ? AND voided_at IS NULL').run(ts, tx.id);
      db.prepare(`UPDATE invoices SET status = CASE WHEN status='issued' THEN 'cancel_requested' ELSE 'cancelled' END WHERE transaction_id = ?`).run(tx.id);
      if (!exited) db.prepare(`UPDATE scan_sessions SET status='abandoned' WHERE id=?`).run(tx.session_id);
      audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `Dsmart POS:${scope.name}`, action: 'transaction.voided', entity: 'transaction', entityId: tx.id, data: { reason, source: 'pos', alreadyExited: exited } });
      if (exited) audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `Dsmart POS:${scope.name}`, action: 'pos.cancel_after_exit', entity: 'transaction', entityId: tx.id, data: { reason } });
    })();
    return { ok: true, status: 'voided', alreadyExited: exited };
  }
  throw conflict('NOT_CANCELLABLE', 'Đơn không ở trạng thái hủy được');
}

export { txView };

// ====================== Chế độ giỏ QR: Dsmart POS báo theo mã giỏ ======================
/**
 * Dsmart POS không gọi "nhận giỏ" trước (mã QR đã chứa mặt hàng), nên kết quả được báo thẳng theo mã giỏ.
 * `posOrderRef` (mã đơn bên Dsmart POS) bắt buộc và là khóa chống trùng. Chưa thấy giỏ (điện thoại chưa đồng bộ vì mất mạng)
 * thì trả 404 BASKET_NOT_FOUND, Dsmart POS thử lại sau.
 */
function basketTx(ctx, scope, code, body) {
  const { db } = ctx;
  const tx = db.prepare('SELECT * FROM transactions WHERE cart_code = ? AND method = ?').get(String(code).toUpperCase(), 'basket')
    || db.prepare(`SELECT * FROM transactions WHERE cart_code = ? AND pos_order_ref IS NOT NULL`).get(String(code).toUpperCase());
  if (!tx || (scope.storeId && scope.storeId !== tx.store_id)) throw notFound('BASKET_NOT_FOUND', 'Chưa thấy giỏ này. Điện thoại khách có thể đang mất mạng, hãy thử lại sau'); // giỏ của chi nhánh khác cũng báo 404: không tiết lộ mã giỏ có thật
  // Mã điểm là khóa bảo vệ: Dsmart POS phải gửi mã điểm của CHÍNH cửa hàng mình, sai thì từ chối ngay.
  const point = String(body.pointCode || '').trim();
  if (!point) throw bad('POINT_REQUIRED', 'pointCode (mã điểm của cửa hàng Dsmart POS đang bán) là bắt buộc');
  const st = db.prepare('SELECT pos_code FROM stores WHERE id = ?').get(tx.store_id);
  if (!st?.pos_code || st.pos_code.toLowerCase() !== point.toLowerCase()) throw conflict('POINT_MISMATCH', 'Mã điểm không khớp với cửa hàng của giỏ này. Không thanh toán');
  const ref = String(body.posOrderRef || '').trim().slice(0, 64);
  if (!ref) throw bad('REF_REQUIRED', 'posOrderRef (mã đơn trên Dsmart POS) là bắt buộc');
  if (tx.pos_order_ref && tx.pos_order_ref !== ref) throw conflict('REF_IN_USE', 'Giỏ này đã gắn với đơn Dsmart POS khác', { posOrderRef: tx.pos_order_ref });
  if (!tx.pos_order_ref) {
    const other = byRef(db, ref, tx.store_id);
    if (other && other.id !== tx.id) throw conflict('REF_IN_USE', 'Mã đơn Dsmart POS này đã gắn với giỏ khác');
  }
  return { tx, ref };
}
function basketByCode(ctx, scope, code, body, claim = false) {
  const { db } = ctx;
  const { tx, ref } = basketTx(ctx, scope, code, body);
  if (claim && !tx.pos_order_ref) { // chỉ lệnh thanh toán/hủy mới được nhận giỏ; refund, invoice thì chỉ tra cứu (gọi nhầm không được khóa giỏ khách)
    db.prepare(`UPDATE transactions SET pos_order_ref=?, pos_status='claimed', pos_claimed_at=?, pos_cashier=COALESCE(?, pos_cashier), pos_terminal=COALESCE(?, pos_terminal) WHERE id=?`)
      .run(ref, nowIso(), body.cashier ? String(body.cashier).slice(0, 40) : null, body.terminal ? String(body.terminal).slice(0, 40) : null, tx.id);
  }
  return { ref, storeId: tx.store_id };
}
/** Gửi bổ sung (hoặc cập nhật) link hóa đơn điện tử và link giao dịch sau khi đã báo thanh toán, vì hóa đơn có thể phát hành chậm hơn. */
export function basketInvoice(ctx, scope, code, body = {}) {
  const { db } = ctx;
  const { ref, storeId } = basketByCode(ctx, scope, code, body);
  const tx = byRef(db, ref, storeId);
  if (!tx || tx.status !== 'paid') throw conflict('NOT_PAID', 'Đơn chưa thanh toán. Hãy báo thanh toán (paid) trước, hoặc gửi kèm link trong lệnh paid');
  const { links } = cleanLinks(body, true);
  if (!links.invoiceUrl && !links.transactionUrl) throw bad('LINK_REQUIRED', 'Cần ít nhất một trong invoiceUrl, transactionUrl');
  saveLinks(db, tx.id, links);
  audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `Dsmart POS:${scope.name}`, action: 'pos.links', entity: 'transaction', entityId: tx.id, data: { invoice: !!links.invoiceUrl, transaction: !!links.transactionUrl } });
  return { ok: true, status: 'paid', ...linksOf(db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id)) };
}
export function basketPaid(ctx, scope, code, body = {}) {
  const { ref, storeId } = basketByCode(ctx, scope, code, body, true);
  return orderPaid(ctx, scope, ref, body, storeId);
}
export function basketCancelled(ctx, scope, code, body = {}) {
  let found;
  try { found = basketByCode(ctx, scope, code, body, true); }
  catch (e) {
    // BRG chưa có giỏ này (điện thoại khách chưa gửi lên): không có gì để hủy, Dsmart POS không cần thử lại.
    if (e.code === 'BASKET_NOT_FOUND') return { ok: true, status: 'unknown', message: 'BRG Scan & Checkout chưa có giỏ này nên không có gì để hủy' };
    throw e;
  }
  return orderCancelled(ctx, scope, found.ref, body, found.storeId);
}
/**
 * Lấy giỏ theo mã giỏ trong mã QR: trạng thái và danh sách mặt hàng (mã vạch, số lượng) để Dsmart POS dựng đơn.
 * `pointCode` (mã điểm đọc từ mã QR) bắt buộc: sai cửa hàng thì từ chối, không trả hàng.
 * 404 BASKET_NOT_FOUND nghĩa là điện thoại khách chưa gửi giỏ lên (thường do mất mạng): Dsmart POS thử lại sau vài giây.
 */
export function basketStatus(ctx, scope, code, query = {}) {
  const { db } = ctx;
  const point = String(query.pointCode || '').trim();
  if (!point) throw bad('POINT_REQUIRED', 'pointCode (mã điểm trong mã QR) là bắt buộc');
  const tx = db.prepare('SELECT * FROM transactions WHERE cart_code = ? ORDER BY created_at DESC LIMIT 1').get(String(code).toUpperCase());
  if (!tx) throw notFound('BASKET_NOT_FOUND', 'Chưa thấy giỏ này. Điện thoại khách có thể đang mất mạng, hãy thử lại sau vài giây');
  inScope(scope, tx);
  const st = db.prepare('SELECT pos_code FROM stores WHERE id = ?').get(tx.store_id);
  if (!st?.pos_code || st.pos_code.toLowerCase() !== point.toLowerCase()) throw conflict('POINT_MISMATCH', 'Mã điểm không khớp với cửa hàng của giỏ này. Không thanh toán');
  const items = JSON.parse(tx.items_json).map((i, n) => ({ idx: n + 1, sku: i.noPrice ? null : i.sku, barcode: i.barcode, name: i.noPrice ? null : i.name, qty: i.qty, unitPrice: i.noPrice ? null : i.price, priced: !i.noPrice }));
  return { code: tx.cart_code, pointCode: st.pos_code, transactionId: tx.id, status: tx.status, reason: tx.cancel_reason || undefined, posOrderRef: tx.pos_order_ref,
    createdAt: tx.created_at, itemCount: tx.item_count, total: tx.total, items, paidAmount: tx.pos_amount, billStored: !!tx.pos_bill_json };
}

/**
 * Hoàn trả một phần sau khi đã thanh toán (khách trả lại một số mặt hàng). Đơn vẫn "đã thanh toán"; khoản hoàn ghi thành
 * dòng thu âm nên doanh thu giảm đúng số tiền. Hoàn hết số tiền đã thu thì đơn thành "đã hủy".
 * `refundRef` là mã lần hoàn trên Dsmart POS: báo lại cùng mã thì không ghi trùng.
 */
export function basketRefund(ctx, scope, code, body = {}) {
  const { db } = ctx;
  const { ref, storeId } = basketByCode(ctx, scope, code, body);
  const tx = byRef(db, ref, storeId);
  if (!tx) throw conflict('NOT_REFUNDABLE', 'Chưa có đơn thanh toán với mã đơn này nên không hoàn trả được');
  if (tx.status === 'voided') throw conflict('ORDER_CANCELLED', 'Đơn này đã bị hủy');
  if (tx.status !== 'paid') throw conflict('NOT_REFUNDABLE', 'Chỉ hoàn trả được đơn đã thanh toán. Đơn chưa thu tiền thì dùng lệnh hủy');
  const refundRef = String(body.refundRef || '').trim().slice(0, 64);
  if (!refundRef) throw bad('REFUND_REF_REQUIRED', 'refundRef (mã lần hoàn trên Dsmart POS) là bắt buộc');
  const amount = body.amount;
  if (!Number.isInteger(amount) || amount <= 0) throw bad('BAD_AMOUNT', 'amount là số tiền hoàn, số nguyên dương, đơn vị đồng');
  if (body.method !== undefined && !POS_METHODS.includes(body.method)) throw bad('BAD_METHOD', `method phải là một trong: ${POS_METHODS.join(', ')}`);
  const reason = String(body.reason || 'Khách trả hàng').trim().slice(0, 200);
  const nameOf = lineNamer(db, tx);
  let lines = null;
  if (body.lines !== undefined && body.lines !== null) {
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 300) throw bad('BAD_LINES', 'lines là danh sách 1 đến 300 dòng');
    const find = itemResolver(db, tx);
    lines = body.lines.map((l, i) => {
      const key = lineKey(l, true);
      const qty = Number(l?.qty), amt = Number(l?.amount);
      if (!key || !(qty > 0 && qty < 100000) || !(Number.isInteger(amt) && amt >= 0 && amt <= MAX_AMOUNT)) throw bad('BAD_LINES', `Dòng hoàn ${i + 1} không hợp lệ: cần sku (SKU_ID) hoặc barcode, qty > 0, amount (tiền hoàn của dòng, số nguyên đồng)`);
      const it = findLine(find, l, true);
      if (!it.known) throw bad('BAD_LINES', `Dòng hoàn ${i + 1}: mặt hàng "${key}" không có trong đơn đã bán`);
      return { sku: it.sku, barcode: it.barcode, name: String(l?.name || '').trim().slice(0, 200) || it.name, qty, amount: amt };
    });
    // Không hoàn quá số lượng đã bán của từng mặt hàng (tính cả các lần hoàn trước). Mặt hàng không có trong đơn đã bán thì chỉ bị giới hạn bởi số tiền.
    const soldRows = tx.pos_bill_json ? JSON.parse(tx.pos_bill_json) : JSON.parse(tx.items_json);
    const sold = new Map(); for (const r of soldRows) sold.set(String(r.barcode ?? r.sku), (sold.get(String(r.barcode ?? r.sku)) || 0) + Number(r.qty));
    const back = new Map(); for (const r of db.prepare('SELECT lines_json FROM refunds WHERE transaction_id = ? AND lines_json IS NOT NULL').all(tx.id)) for (const l of JSON.parse(r.lines_json)) back.set(String(l.barcode ?? l.sku), (back.get(String(l.barcode ?? l.sku)) || 0) + Number(l.qty));
    const now = new Map(); for (const l of lines) now.set(String(l.barcode), (now.get(String(l.barcode)) || 0) + l.qty);
    if (lines.reduce((a, l) => a + l.amount, 0) !== amount) throw bad('BAD_LINES', 'Tổng amount của các dòng hoàn phải bằng amount của lệnh hoàn');
    for (const [k] of now) if (!sold.has(k)) throw bad('BAD_LINES', 'Có mặt hàng không nằm trong đơn đã bán');
    for (const [k, q] of now) if (q + (back.get(k) || 0) > sold.get(k) && !db.prepare('SELECT 1 FROM refunds WHERE transaction_id = ? AND ref = ?').get(tx.id, refundRef)) throw conflict('REFUND_TOO_LARGE', 'Số lượng hoàn vượt số lượng đã bán của mặt hàng này', { barcode: k });
  }
  const done = db.prepare('SELECT * FROM refunds WHERE transaction_id = ? AND ref = ?').get(tx.id, refundRef);
  const sum = () => db.prepare('SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE transaction_id = ?').get(tx.id).s;
  const view = (dup) => { const refunded = sum(); return { ok: true, duplicate: dup, transactionId: tx.id, refunded, remaining: (tx.pos_amount ?? tx.total) - refunded, status: db.prepare('SELECT status FROM transactions WHERE id = ?').get(tx.id).status }; };
  if (done) {
    if (done.amount !== amount) throw conflict('REFUND_REF_IN_USE', 'Mã lần hoàn này đã dùng với số tiền khác', { amount: done.amount });
    return view(true);
  }
  const paidAmount = tx.pos_amount ?? tx.total;
  if (amount > paidAmount - sum()) throw conflict('REFUND_TOO_LARGE', `Số tiền hoàn vượt số còn lại có thể hoàn (${(paidAmount - sum()).toLocaleString('vi-VN')}₫)`, { remaining: paidAmount - sum() });
  const ts = nowIso();
  db.transaction(() => {
    db.prepare('INSERT INTO refunds(transaction_id,ref,amount,method,reason,lines_json,created_at) VALUES(?,?,?,?,?,?,?)').run(tx.id, refundRef, amount, body.method || 'cash', reason, lines ? JSON.stringify(lines) : null, ts);
    db.prepare(`INSERT INTO payments(transaction_id,store_id,kind,method,amount,collected_by,collected_at,provider,provider_ref,confirmations)
      VALUES(?,?,'refund',?,?,?,?,'pos',?,?)`).run(tx.id, tx.store_id, body.method || 'cash', -amount, `Dsmart POS:${scope.name}`, ts, refundRef, JSON.stringify({ reason }));
    audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `Dsmart POS:${scope.name}`, action: 'payment.refunded', entity: 'transaction', entityId: tx.id, data: { amount, refundRef, reason, lines: lines?.length || 0 } });
    if (sum() >= paidAmount) {
      db.prepare(`UPDATE transactions SET status='voided', pos_status='cancelled', void_reason=?, voided_at=?, voided_by=? WHERE id=?`).run(`Dsmart POS hoàn toàn bộ: ${reason}`, ts, `Dsmart POS:${scope.name}`, tx.id);
      audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `Dsmart POS:${scope.name}`, action: 'transaction.voided', entity: 'transaction', entityId: tx.id, data: { reason, source: 'pos', fullRefund: true } });
    }
  })();
  return view(false);
}

/**
 * Dsmart POS báo đơn đang tính ở quầy (thu ngân thêm, bớt hoặc đổi số lượng mặt hàng) TRƯỚC khi thanh toán, để điện thoại khách thấy ngay
 * khác biệt so với giỏ đã quét. Không khóa giỏ và không thay cho lệnh báo thanh toán; gửi nhiều lần được, lần sau thay lần trước.
 */
export function basketUpdate(ctx, scope, code, body = {}) {
  const { db } = ctx;
  const { tx, ref } = basketTx(ctx, scope, code, body);
  if (tx.status !== 'awaiting_counter') throw conflict('NOT_UPDATABLE', tx.status === 'paid' ? 'Đơn đã thanh toán, không cập nhật được nữa' : 'Giỏ này không còn chờ thanh toán');
  let lines;
  if (body.changes !== undefined && body.changes !== null) {
    // Dạng thay đổi (khuyên dùng): chỉ gửi phần chênh so với giỏ khách quét: sku (SKU_ID), qty, op ('add' thêm, 'remove' bớt).
    if (!Array.isArray(body.changes) || !body.changes.length || body.changes.length > 300) throw bad('BAD_CHANGES', 'changes là danh sách 1 đến 300 dòng');
    const find = itemResolver(db, tx);
    const cur = new Map(); const order = [];
    for (const i of JSON.parse(tx.items_json)) { const k = String(i.barcode); if (!cur.has(k)) order.push(k); cur.set(k, { ...find(k), name: i.name, qty: (cur.get(k)?.qty || 0) + i.qty }); }
    body.changes.forEach((c, n) => {
      const key = lineKey(c); const q = Number(c?.qty);
      if (!key || !Number.isInteger(q) || q <= 0 || q > 99999 || !['add', 'remove'].includes(c?.op)) throw bad('BAD_CHANGES', `Dòng ${n + 1} không hợp lệ: cần sku (SKU_ID), qty là số nguyên dương, op là "add" hoặc "remove"`);
      const it = findLine(find, c);
      if (!cur.has(it.barcode)) { if (c.op === 'remove') return; cur.set(it.barcode, { ...it, qty: 0 }); order.push(it.barcode); }
      const x = cur.get(it.barcode); x.qty = Math.max(0, x.qty + (c.op === 'add' ? q : -q));
    });
    lines = order.map((k) => cur.get(k)).filter((x) => x.qty > 0)
      .map((x) => ({ sku: x.sku, barcode: x.barcode, name: x.name, qty: x.qty, unitPrice: x.price, discount: 0, lineTotal: x.price * x.qty, estimated: true }));
    if (!lines.length) throw bad('EMPTY_ORDER', 'Sau khi áp dụng thay đổi đơn không còn mặt hàng nào. Nếu hủy cả đơn hãy gọi lệnh hủy (cancelled)');
  } else {
    if (body.lines === undefined || body.lines === null) throw bad('BAD_LINES', 'Cần changes (khuyên dùng: sku, qty, op) hoặc lines (toàn bộ dòng đơn đang tính trên Dsmart POS)');
    ({ lines } = cleanBill(body, db, tx));
  }
  const sum = lines.reduce((a, l) => a + l.lineTotal, 0);
  const amount = body.amount === undefined || body.amount === null ? sum : body.amount;
  if (!Number.isInteger(amount) || amount < 0) throw bad('BAD_AMOUNT', 'amount là số nguyên đồng, không âm');
  const draft = { lines, amount, at: nowIso() };
  db.prepare(`UPDATE transactions SET pos_draft_json = ?, pos_order_ref = COALESCE(pos_order_ref, ?), pos_cashier = COALESCE(?, pos_cashier), pos_terminal = COALESCE(?, pos_terminal) WHERE id = ?`)
    .run(JSON.stringify(draft), ref, body.cashier ? String(body.cashier).slice(0, 40) : null, body.terminal ? String(body.terminal).slice(0, 40) : null, tx.id);
  db.prepare('UPDATE scan_sessions SET last_activity = ? WHERE id = ?').run(nowIso(), tx.session_id); // thu ngân đang làm việc với giỏ này: chưa coi là bỏ quên
  const view = txView(ctx, db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id));
  return { ok: true, itemCount: view.posDraft.itemCount, total: amount, differsFromPhone: !view.posDraft.diff.same };
}
