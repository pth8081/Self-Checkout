// API cho phần mềm POS gọi vào BRG Scan & Checkout (POS là bên gọi):
//   1. POS quét mã giỏ hàng của khách và "nhận" giỏ (lấy danh sách mặt hàng để tự nhập vào đơn POS).
//   2. POS báo đơn đã thanh toán, BRG tự xác nhận và cho khách ra (thu ngân không phải xác nhận lại).
//   3. POS báo đơn đã huỷ.
// Mọi lời gọi đều idempotent theo mã đơn POS (posOrderRef), gọi lại không tạo trùng.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { nowIso, bad, notFound, conflict, forbidden, money } from '../util.js';
import { audit } from './audit.js';
import { getStoreConfig, txView, markExited } from './core.js';
import { sendBillEmailBg } from './bill-email.js';

export const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex');
export function newKey() {
  const raw = `brgpos_${crypto.randomBytes(24).toString('base64url')}`;
  return { raw, prefix: raw.slice(0, 14), hash: hashKey(raw) };
}

export const POS_METHODS = ['cash', 'qr_transfer', 'card', 'ewallet', 'other'];
const REF = /^[A-Za-z0-9._:/-]{1,64}$/;

const byCode = (db, code) => db.prepare('SELECT * FROM transactions WHERE cart_code = ? ORDER BY created_at DESC LIMIT 1').get(String(code || '').trim().toUpperCase());
const byRef = (db, ref) => db.prepare('SELECT * FROM transactions WHERE pos_order_ref = ? ORDER BY created_at DESC LIMIT 1').get(String(ref || ''));
function inScope(scope, tx) { if (scope.storeId && scope.storeId !== tx.store_id) throw forbidden('STORE_FORBIDDEN', 'Khoá API này không dùng cho chi nhánh của giỏ hàng'); }

/** Dữ liệu giỏ hàng trả cho POS: các mặt hàng đã chốt giá (POS tự tính lại theo giá và khuyến mãi của POS). */
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
  if (getStoreConfig(db, tx.store_id).cfg.payment_source !== 'pos') throw conflict('POS_MODE_OFF', 'Chi nhánh này chưa bật chế độ thu tiền qua POS');
  if (tx.pos_order_ref === ref) return { claimed: true, duplicate: true, cart: cartForPos(tx) }; // gọi lại cùng mã đơn
  const other = byRef(db, ref);
  if (other && other.id !== tx.id) throw conflict('REF_IN_USE', 'Mã đơn POS này đã gắn với giỏ hàng khác', { transactionId: other.id });
  if (!['awaiting_counter', 'handed_off'].includes(tx.status)) throw conflict('NOT_PAYABLE', `Giỏ hàng đang ở trạng thái "${tx.status}", không nhận được`, { status: tx.status });
  if (tx.pos_status === 'claimed') throw conflict('ALREADY_CLAIMED', 'Giỏ hàng đã được đơn POS khác nhận', { posOrderRef: tx.pos_order_ref });
  db.transaction(() => {
    db.prepare(`UPDATE transactions SET pos_order_ref=?, pos_status='claimed', pos_claimed_at=?, pos_cashier=?, pos_terminal=? WHERE id=?`)
      .run(ref, nowIso(), body.cashier ? String(body.cashier).slice(0, 40) : null, body.terminal ? String(body.terminal).slice(0, 40) : null, tx.id);
    audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `POS:${scope.name}`, action: 'pos.claimed', entity: 'transaction', entityId: tx.id,
      data: { posOrderRef: ref, cashier: body.cashier, terminal: body.terminal } });
  })();
  return { claimed: true, duplicate: false, cart: cartForPos(db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id)) };
}

export function orderStatus(ctx, scope, ref) {
  const tx = byRef(ctx.db, ref);
  if (!tx) throw notFound('ORDER_NOT_FOUND', 'Không tìm thấy đơn POS này');
  inScope(scope, tx);
  return { posOrderRef: tx.pos_order_ref, code: tx.cart_code, transactionId: tx.id, status: tx.status, posStatus: tx.pos_status, total: tx.total,
    paidAmount: tx.pos_amount, exitStatus: tx.exit_status, guardCheck: !tx.guard_skipped };
}

/** Bill thật của POS: danh sách dòng đã tính giá và khuyến mãi. Lúc thanh toán chưa có hoá đơn điện tử nên không có số hoá đơn. */
/** Tên mặt hàng theo mã hàng: ưu tiên giỏ khách, rồi bảng sản phẩm, không có thì dùng chính mã hàng. */
function lineNamer(db, tx) {
  const names = new Map(JSON.parse(tx.items_json).map((it) => [String(it.barcode), it.name]));
  const cached = db.prepare('SELECT name FROM product_cache WHERE store_id = ? AND barcode = ?');
  return (barcode) => names.get(barcode) || cached.get(tx.store_id, barcode)?.name || barcode;
}

function cleanBill(body, db, tx) {
  let lines = null;
  if (body.lines !== undefined && body.lines !== null) {
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 300) throw bad('BAD_LINES', 'lines là danh sách 1 đến 300 dòng');
    // Mỗi dòng bắt buộc: mã hàng (barcode) hoặc tên, số lượng, thành tiền. Tên và đơn giá bỏ trống thì hệ thống tự điền.
    const nameOf = lineNamer(db, tx);
    lines = body.lines.map((l, i) => {
      const barcode = l?.barcode ? String(l.barcode).trim().slice(0, 32) : null;
      let name = String(l?.name || '').trim().slice(0, 200);
      const qty = Number(l?.qty);
      const lineTotal = Number(l?.lineTotal), discount = Number(l?.discount ?? 0);
      if ((!barcode && !name) || !(qty > 0 && qty < 100000) || ![lineTotal, discount].every((x) => Number.isInteger(x) && x >= 0)
        || (l?.unitPrice !== undefined && l?.unitPrice !== null && !(Number.isInteger(Number(l.unitPrice)) && Number(l.unitPrice) >= 0))) {
        throw bad('BAD_LINES', `Dòng ${i + 1} không hợp lệ: cần barcode (mã hàng) hoặc name, qty > 0, lineTotal (số nguyên đồng); unitPrice và discount nếu có phải là số nguyên đồng`);
      }
      if (!name) name = nameOf(barcode);
      const unitPrice = l?.unitPrice !== undefined && l?.unitPrice !== null ? Number(l.unitPrice) : Math.round((lineTotal + discount) / qty);
      return { barcode, name, qty, unitPrice, discount, lineTotal };
    });
  }
  return { lines };
}

export function orderPaid(ctx, scope, ref, body = {}) {
  const { db } = ctx;
  const tx = byRef(db, ref);
  if (!tx) throw notFound('ORDER_NOT_FOUND', 'Chưa nhận đơn POS này. Hãy gọi "nhận giỏ hàng" trước');
  inScope(scope, tx);
  const result = (dup) => ({ ok: true, duplicate: dup, transactionId: tx.id, status: 'paid', guardCheck: !tx.guard_skipped,
    exitStatus: db.prepare('SELECT exit_status FROM transactions WHERE id = ?').get(tx.id).exit_status, amountMatches: money(tx.pos_amount) === tx.total });
  if (tx.status === 'paid') {
    // Báo lại: không tạo thêm khoản thu, nhưng nhận bill nếu lần trước chưa gửi.
    const { lines } = cleanBill(body, db, tx);
    if (lines && !tx.pos_bill_json) db.prepare('UPDATE transactions SET pos_bill_json = ? WHERE id = ?').run(JSON.stringify(lines), tx.id);
    return result(true);
  }
  // Khách có thể sửa giỏ (giỏ bị huỷ phía điện thoại) trong lúc POS đã quét mã QR cũ và thu tiền. Tiền đã thu là thật nên vẫn ghi nhận.
  // Chỉ từ chối khi chính POS đã huỷ đơn này hoặc đơn đã bị huỷ sau thanh toán.
  const late = tx.status === 'cancelled' && tx.method === 'basket' && tx.pos_status !== 'cancelled';
  if (tx.status === 'voided' || (tx.status === 'cancelled' && !late)) throw conflict('ORDER_CANCELLED', 'Đơn này đã bị huỷ');
  if (!late && !['awaiting_counter', 'handed_off'].includes(tx.status)) throw conflict('NOT_PAYABLE', 'Đơn không ở trạng thái chờ thanh toán');
  const amount = body.amount;
  if (!Number.isInteger(amount) || amount <= 0) throw bad('BAD_AMOUNT', 'amount là số nguyên dương, đơn vị đồng');
  if (!POS_METHODS.includes(body.method)) throw bad('BAD_METHOD', `method phải là một trong: ${POS_METHODS.join(', ')}`);
  const invoiceNo = body.invoiceNo ? String(body.invoiceNo).slice(0, 64) : null;
  const { lines } = cleanBill(body, db, tx);
  const cashier = body.cashier ? String(body.cashier).slice(0, 40) : tx.pos_cashier;
  const ts = nowIso();
  const differs = amount !== tx.total;
  db.transaction(() => {
    const exp = new Date(Date.now() + config.receiptTtlMinutes * 60000).toISOString();
    db.prepare(`INSERT INTO payments(transaction_id,store_id,kind,method,amount,collected_by,collected_at,provider,provider_ref,confirmations)
      VALUES(?,?,'main',?,?,?,?,'pos',?,?)`).run(tx.id, tx.store_id, body.method, amount, `POS:${cashier || scope.name}`, ts, ref,
      JSON.stringify({ paidAt: body.paidAt || null, terminal: body.terminal || tx.pos_terminal || null, note: body.note || null }));
    db.prepare(`UPDATE transactions SET status='paid', method=?, paid_at=?, receipt_expires_at=?, extra_due=0, pos_status='paid', pos_amount=?,
      pos_invoice_no=?, pos_cashier=?, pos_bill_json=? WHERE id=?`).run(body.method, ts, exp, amount, invoiceNo, cashier || null, lines ? JSON.stringify(lines) : null, tx.id);
    if (!late) db.prepare(`UPDATE scan_sessions SET status='paid', ended_at=? WHERE id=?`).run(ts, tx.session_id); // giỏ đã bị khách sửa: phiên có thể đang giữ giỏ mới, không đụng tới
    if (late) audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `POS:${scope.name}`, action: 'pos.paid_after_cancel', entity: 'transaction', entityId: tx.id, data: { amount, posOrderRef: ref } });
    if (invoiceNo) {
      const buyer = tx.buyer_json ? JSON.parse(tx.buyer_json) : {};
      db.prepare(`INSERT INTO invoices(transaction_id,type,email,tax_code,company_name,address,status,number,created_at) VALUES(?,?,?,?,?,?,'issued',?,?)`)
        .run(tx.id, buyer.taxCode ? 'company' : 'retail', buyer.email || null, buyer.taxCode || null, buyer.companyName || null, buyer.address || null, invoiceNo, ts);
    }
    audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `POS:${scope.name}`, action: 'payment.collected', entity: 'transaction', entityId: tx.id,
      data: { source: 'pos', method: body.method, amount, posOrderRef: ref, invoiceNo, cashier } });
    if (differs) audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `POS:${scope.name}`, action: 'pos.amount_differs', entity: 'transaction', entityId: tx.id, data: { brgTotal: tx.total, posAmount: amount } });
    if (tx.guard_skipped) {
      if (late) db.prepare(`UPDATE transactions SET exit_status='exited', exited_at=?, exited_by='SYSTEM', exited_gate='Không có bảo vệ' WHERE id=?`).run(ts, tx.id);
      else markExited(db, db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id), { id: 'SYSTEM' }, 'Không có bảo vệ');
    }
  })();
  if (tx.bill_email) { db.prepare("UPDATE transactions SET bill_email_status='pending' WHERE id=? AND bill_email_status IS NULL").run(tx.id); sendBillEmailBg(ctx, tx.id); }
  return result(false);
}

export function orderCancelled(ctx, scope, ref, body = {}) {
  const { db } = ctx;
  const tx = byRef(db, ref);
  if (!tx) throw notFound('ORDER_NOT_FOUND', 'Không tìm thấy đơn POS này');
  inScope(scope, tx);
  const reason = String(body.reason || 'POS huỷ đơn').slice(0, 200);
  if (tx.status === 'cancelled' || tx.status === 'voided') return { ok: true, duplicate: true, status: tx.status };
  const ts = nowIso();
  if (tx.status === 'handed_off') {
    db.prepare(`UPDATE transactions SET status='cancelled', pos_status='cancelled' WHERE id=?`).run(tx.id);
    return { ok: true, status: 'cancelled' };
  }
  if (tx.status === 'awaiting_counter') {
    // Chưa thu tiền: nhả giỏ để khách sửa hoặc khoá lại.
    db.transaction(() => {
      db.prepare(`UPDATE transactions SET status='cancelled', pos_status='cancelled' WHERE id=?`).run(tx.id);
      db.prepare(`UPDATE scan_sessions SET status='active', last_activity=? WHERE id=?`).run(ts, tx.session_id);
      audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `POS:${scope.name}`, action: 'cart.cancelled', entity: 'transaction', entityId: tx.id, data: { reason, posOrderRef: ref } });
    })();
    return { ok: true, status: 'cancelled', cartReleased: true };
  }
  if (tx.status === 'paid') {
    // Đã thu: POS là nguồn đúng, nên huỷ theo POS (QR mất hiệu lực, không tính doanh thu, hoá đơn chuyển yêu cầu huỷ).
    const exited = tx.exit_status === 'exited';
    db.transaction(() => {
      db.prepare(`UPDATE transactions SET status='voided', pos_status='cancelled', void_reason=?, voided_at=?, voided_by=? WHERE id=?`).run(`POS huỷ: ${reason}`, ts, `POS:${scope.name}`, tx.id);
      db.prepare('UPDATE payments SET voided_at = ? WHERE transaction_id = ? AND voided_at IS NULL').run(ts, tx.id);
      db.prepare(`UPDATE invoices SET status = CASE WHEN status='issued' THEN 'cancel_requested' ELSE 'cancelled' END WHERE transaction_id = ?`).run(tx.id);
      if (!exited) db.prepare(`UPDATE scan_sessions SET status='abandoned' WHERE id=?`).run(tx.session_id);
      audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `POS:${scope.name}`, action: 'transaction.voided', entity: 'transaction', entityId: tx.id, data: { reason, source: 'pos', alreadyExited: exited } });
      if (exited) audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `POS:${scope.name}`, action: 'pos.cancel_after_exit', entity: 'transaction', entityId: tx.id, data: { reason } });
    })();
    return { ok: true, status: 'voided', alreadyExited: exited };
  }
  throw conflict('NOT_CANCELLABLE', 'Đơn không ở trạng thái huỷ được');
}

export { txView };

// ====================== Chế độ giỏ QR: POS báo theo mã giỏ ======================
/**
 * POS không gọi "nhận giỏ" trước (mã QR đã chứa mặt hàng), nên kết quả được báo thẳng theo mã giỏ.
 * `posOrderRef` (mã đơn bên POS) bắt buộc và là khoá chống trùng. Chưa thấy giỏ (điện thoại chưa đồng bộ vì mất mạng)
 * thì trả 404 BASKET_NOT_FOUND, POS thử lại sau.
 */
function basketTx(ctx, scope, code, body) {
  const { db } = ctx;
  const tx = db.prepare('SELECT * FROM transactions WHERE cart_code = ? AND method = ?').get(String(code).toUpperCase(), 'basket')
    || db.prepare(`SELECT * FROM transactions WHERE cart_code = ? AND pos_order_ref IS NOT NULL`).get(String(code).toUpperCase());
  if (!tx) throw notFound('BASKET_NOT_FOUND', 'Chưa thấy giỏ này. Điện thoại khách có thể đang mất mạng, hãy thử lại sau');
  inScope(scope, tx);
  // Mã điểm là khoá bảo vệ: POS phải gửi mã điểm của CHÍNH cửa hàng mình, sai thì từ chối ngay.
  const point = String(body.pointCode || '').trim();
  if (!point) throw bad('POINT_REQUIRED', 'pointCode (mã điểm của cửa hàng POS đang bán) là bắt buộc');
  const st = db.prepare('SELECT pos_code FROM stores WHERE id = ?').get(tx.store_id);
  if (!st?.pos_code || st.pos_code.toLowerCase() !== point.toLowerCase()) throw conflict('POINT_MISMATCH', 'Mã điểm không khớp với cửa hàng của giỏ này. Không thanh toán');
  const ref = String(body.posOrderRef || '').trim().slice(0, 64);
  if (!ref) throw bad('REF_REQUIRED', 'posOrderRef (mã đơn trên POS) là bắt buộc');
  if (tx.pos_order_ref && tx.pos_order_ref !== ref) throw conflict('REF_IN_USE', 'Giỏ này đã gắn với đơn POS khác', { posOrderRef: tx.pos_order_ref });
  if (!tx.pos_order_ref) {
    const other = byRef(db, ref);
    if (other && other.id !== tx.id) throw conflict('REF_IN_USE', 'Mã đơn POS này đã gắn với giỏ khác', { transactionId: other.id });
  }
  return { tx, ref };
}
function basketByCode(ctx, scope, code, body) {
  const { db } = ctx;
  const { tx, ref } = basketTx(ctx, scope, code, body);
  if (!tx.pos_order_ref) {
    db.prepare(`UPDATE transactions SET pos_order_ref=?, pos_status='claimed', pos_claimed_at=?, pos_cashier=COALESCE(?, pos_cashier), pos_terminal=COALESCE(?, pos_terminal) WHERE id=?`)
      .run(ref, nowIso(), body.cashier ? String(body.cashier).slice(0, 40) : null, body.terminal ? String(body.terminal).slice(0, 40) : null, tx.id);
  }
  return ref;
}
export const basketPaid = (ctx, scope, code, body = {}) => orderPaid(ctx, scope, basketByCode(ctx, scope, code, body), body);
export function basketCancelled(ctx, scope, code, body = {}) {
  let ref;
  try { ref = basketByCode(ctx, scope, code, body); }
  catch (e) {
    // BRG chưa có giỏ này (điện thoại khách chưa gửi lên): không có gì để huỷ, POS không cần thử lại.
    if (e.code === 'BASKET_NOT_FOUND') return { ok: true, status: 'unknown', message: 'BRG Scan & Checkout chưa có giỏ này nên không có gì để huỷ' };
    throw e;
  }
  return orderCancelled(ctx, scope, ref, body);
}
export function basketStatus(ctx, scope, code) {
  const tx = ctx.db.prepare('SELECT * FROM transactions WHERE cart_code = ?').get(String(code).toUpperCase());
  if (!tx) throw notFound('BASKET_NOT_FOUND', 'Chưa thấy giỏ này');
  inScope(scope, tx);
  return { code: tx.cart_code, transactionId: tx.id, status: tx.status, posOrderRef: tx.pos_order_ref, total: tx.total, paidAmount: tx.pos_amount, billStored: !!tx.pos_bill_json };
}

/**
 * Hoàn trả một phần sau khi đã thanh toán (khách trả lại một số mặt hàng). Đơn vẫn "đã thanh toán"; khoản hoàn ghi thành
 * dòng thu âm nên doanh thu giảm đúng số tiền. Hoàn hết số tiền đã thu thì đơn thành "đã huỷ".
 * `refundRef` là mã lần hoàn trên POS: báo lại cùng mã thì không ghi trùng.
 */
export function basketRefund(ctx, scope, code, body = {}) {
  const { db } = ctx;
  const ref = basketByCode(ctx, scope, code, body);
  const tx = byRef(db, ref);
  if (tx.status === 'voided') throw conflict('ORDER_CANCELLED', 'Đơn này đã bị huỷ');
  if (tx.status !== 'paid') throw conflict('NOT_REFUNDABLE', 'Chỉ hoàn trả được đơn đã thanh toán. Đơn chưa thu tiền thì dùng lệnh huỷ');
  const refundRef = String(body.refundRef || '').trim().slice(0, 64);
  if (!refundRef) throw bad('REFUND_REF_REQUIRED', 'refundRef (mã lần hoàn trên POS) là bắt buộc');
  const amount = body.amount;
  if (!Number.isInteger(amount) || amount <= 0) throw bad('BAD_AMOUNT', 'amount là số tiền hoàn, số nguyên dương, đơn vị đồng');
  if (body.method !== undefined && !POS_METHODS.includes(body.method)) throw bad('BAD_METHOD', `method phải là một trong: ${POS_METHODS.join(', ')}`);
  const reason = String(body.reason || 'Khách trả hàng').trim().slice(0, 200);
  const nameOf = lineNamer(db, tx);
  let lines = null;
  if (body.lines !== undefined && body.lines !== null) {
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 300) throw bad('BAD_LINES', 'lines là danh sách 1 đến 300 dòng');
    lines = body.lines.map((l, i) => {
      const barcode = l?.barcode ? String(l.barcode).trim().slice(0, 32) : null;
      const name = String(l?.name || '').trim().slice(0, 200) || (barcode ? nameOf(barcode) : '');
      const qty = Number(l?.qty), amt = Number(l?.amount);
      if (!name || !(qty > 0 && qty < 100000) || !(Number.isInteger(amt) && amt >= 0)) throw bad('BAD_LINES', `Dòng hoàn ${i + 1} không hợp lệ: cần barcode (mã hàng), qty > 0, amount (tiền hoàn của dòng, số nguyên đồng)`);
      return { barcode, name, qty, amount: amt };
    });
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
      VALUES(?,?,'refund',?,?,?,?,'pos',?,?)`).run(tx.id, tx.store_id, body.method || 'cash', -amount, `POS:${scope.name}`, ts, refundRef, JSON.stringify({ reason }));
    audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `POS:${scope.name}`, action: 'payment.refunded', entity: 'transaction', entityId: tx.id, data: { amount, refundRef, reason, lines: lines?.length || 0 } });
    if (sum() >= paidAmount) {
      db.prepare(`UPDATE transactions SET status='voided', pos_status='cancelled', void_reason=?, voided_at=?, voided_by=? WHERE id=?`).run(`POS hoàn toàn bộ: ${reason}`, ts, `POS:${scope.name}`, tx.id);
      audit(db, { storeId: tx.store_id, actorType: 'system', actorId: `POS:${scope.name}`, action: 'transaction.voided', entity: 'transaction', entityId: tx.id, data: { reason, source: 'pos', fullRefund: true } });
    }
  })();
  return view(false);
}

/**
 * POS báo đơn đang tính ở quầy (thu ngân thêm, bớt hoặc đổi số lượng mặt hàng) TRƯỚC khi thanh toán, để điện thoại khách thấy ngay
 * khác biệt so với giỏ đã quét. Không khoá giỏ và không thay cho lệnh báo thanh toán; gửi nhiều lần được, lần sau thay lần trước.
 */
export function basketUpdate(ctx, scope, code, body = {}) {
  const { db } = ctx;
  const { tx, ref } = basketTx(ctx, scope, code, body);
  if (tx.status !== 'awaiting_counter') throw conflict('NOT_UPDATABLE', tx.status === 'paid' ? 'Đơn đã thanh toán, không cập nhật được nữa' : 'Giỏ này không còn chờ thanh toán');
  if (body.lines === undefined || body.lines === null) throw bad('BAD_LINES', 'lines là bắt buộc: danh sách các dòng đơn đang tính trên POS');
  const { lines } = cleanBill(body, db, tx);
  const sum = lines.reduce((a, l) => a + l.lineTotal, 0);
  const amount = body.amount === undefined || body.amount === null ? sum : body.amount;
  if (!Number.isInteger(amount) || amount < 0) throw bad('BAD_AMOUNT', 'amount là số nguyên đồng, không âm');
  const draft = { lines, amount, at: nowIso() };
  db.prepare(`UPDATE transactions SET pos_draft_json = ?, pos_order_ref = COALESCE(pos_order_ref, ?), pos_cashier = COALESCE(?, pos_cashier), pos_terminal = COALESCE(?, pos_terminal) WHERE id = ?`)
    .run(JSON.stringify(draft), ref, body.cashier ? String(body.cashier).slice(0, 40) : null, body.terminal ? String(body.terminal).slice(0, 40) : null, tx.id);
  const view = txView(ctx, db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id));
  return { ok: true, itemCount: view.posDraft.itemCount, total: amount, differsFromPhone: !view.posDraft.diff.same };
}
