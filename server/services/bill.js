// Bill (hoá đơn bán hàng) cho khách xem và tải PDF. Bill thật lấy từ DSmart POS; chưa có thì dùng tạm tính của BRG và ghi rõ.
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { getSetting } from '../db.js';

const FONT = new URL('../assets/fonts/', import.meta.url);
const font = (n) => fs.readFileSync(new URL(n, FONT));

const METHOD = { cash: 'Tiền mặt', qr_transfer: 'Chuyển khoản', card: 'Thẻ', ewallet: 'Ví điện tử', pos: 'Tại quầy', basket: 'Tại quầy' };

/** Link khai báo hoá đơn điện tử của nhà cung cấp, do quản trị cấu hình. Thay các ký hiệu {code} {posOrderRef} {amount} {storeCode} {posCode}. Lúc thanh toán chưa có hoá đơn điện tử: khách tự khai báo ở link này, nên không có số hoá đơn. */
export const PORTAL_KEY = 'invoice_portal';
export const PORTAL_PLACEHOLDERS = { '{code}': 'mã giỏ hàng', '{posOrderRef}': 'mã đơn (mã bill) trên DSmart POS', '{amount}': 'tổng tiền thanh toán', '{storeCode}': 'mã chi nhánh', '{posCode}': 'mã điểm' };
export function portalUrl(db, tx) {
  const url = getSetting(db, PORTAL_KEY, {}).url;
  if (!url) return null;
  const store = db.prepare('SELECT pos_code FROM stores WHERE id = ?').get(tx.store_id);
  const vals = { '{code}': tx.cart_code, '{posOrderRef}': tx.pos_order_ref || '', '{amount}': String(tx.pos_amount ?? tx.total), '{storeCode}': tx.store_id, '{posCode}': store?.pos_code || '' };
  return Object.entries(vals).reduce((u, [k, v]) => u.split(k).join(encodeURIComponent(v)), url);
}

/** So giỏ khách quét với các dòng DSmart POS: mặt hàng bớt đi, thêm vào hoặc đổi số lượng. */
export function diffLines(cartItems, posLines) {
  const cart = new Map(); for (const i of cartItems) cart.set(String(i.barcode), { name: i.name, qty: i.qty });
  const pos = new Map();
  for (const l of posLines) { const k = String(l.barcode || l.name); pos.set(k, { name: l.name, qty: (pos.get(k)?.qty || 0) + l.qty }); }
  const removed = [], added = [], changed = [];
  for (const [bc, c] of cart) { const q = pos.get(bc); if (!q) removed.push({ barcode: bc, name: c.name, qty: c.qty }); else if (q.qty !== c.qty) changed.push({ barcode: bc, name: c.name, from: c.qty, to: q.qty }); }
  for (const [bc, q] of pos) if (!cart.has(bc)) added.push({ barcode: bc, name: q.name, qty: q.qty });
  return { removed, added, changed, same: !removed.length && !added.length && !changed.length };
}
/**
 * Số lượng và giá trị hàng thu ngân THÊM ở quầy so với giỏ khách quét (khách lấy mà chưa quét), và số lượng khách BỚT.
 * Giá trị hàng thêm tính theo đơn giá bình quân của dòng trong đơn DSmart POS.
 */
export function extraOf(cartItems, posLines) {
  const cart = new Map(); for (const i of cartItems) cart.set(String(i.barcode), (cart.get(String(i.barcode)) || 0) + i.qty);
  const pos = new Map();
  for (const l of posLines) { const k = String(l.barcode || l.name); const c = pos.get(k) || { qty: 0, total: 0 }; c.qty += l.qty; c.total += l.lineTotal; pos.set(k, c); }
  let extraQty = 0, extraValue = 0, lessQty = 0;
  for (const [k, p] of pos) {
    const inCart = cart.get(k) || 0, unit = p.qty ? p.total / p.qty : 0;
    if (p.qty > inCart) { extraQty += p.qty - inCart; extraValue += Math.round((p.qty - inCart) * unit); }
  }
  for (const [k, q] of cart) { const p = pos.get(k)?.qty || 0; if (q > p) lessQty += q - p; }
  return { extraQty, extraValue, lessQty };
}
/** Khác biệt giữa giỏ khách quét và đơn DSmart POS đã thanh toán (null nếu DSmart POS không gửi dòng hàng). */
export const cartDiffOf = (tx) => (tx.pos_bill_json ? diffLines(JSON.parse(tx.items_json), JSON.parse(tx.pos_bill_json)) : null);

export function billOf(ctx, tx) {
  const { db } = ctx;
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(tx.store_id);
  const posLines = tx.pos_bill_json ? JSON.parse(tx.pos_bill_json) : null;
  const items = posLines || JSON.parse(tx.items_json).map((i) => ({ barcode: i.barcode, name: i.name, qty: i.qty, unitPrice: i.price, discount: i.discount || 0, lineTotal: i.price * i.qty - (i.discount || 0) }));
  const total = tx.pos_amount ?? tx.total;
  // DSmart POS có thể giảm ở cấp hoá đơn (voucher, làm tròn...) nên tổng tiền khác tổng các dòng: hiện phần chênh để bill cộng đúng.
  const refunds = db.prepare('SELECT * FROM refunds WHERE transaction_id = ? ORDER BY id').all(tx.id).map((r) => ({ amount: r.amount, reason: r.reason, at: r.created_at, lines: r.lines_json ? JSON.parse(r.lines_json) : [] }));
  const refundTotal = refunds.reduce((a, r) => a + r.amount, 0);
  const adjustment = posLines ? total - items.reduce((a, l) => a + l.lineTotal, 0) : 0;
  return {
    id: tx.id, code: tx.cart_code, storeName: store?.name || tx.store_id, storeAddress: store?.address || '',
    paidAt: tx.paid_at, method: tx.method, methodLabel: METHOD[tx.method] || tx.method, cashier: tx.pos_cashier || null,
    refunds, refundTotal, netTotal: total - refundTotal, lines: items, discount: items.reduce((a, l) => a + (l.discount || 0), 0), adjustment, total,
    posOrderRef: tx.pos_order_ref || null, invoicePortalUrl: portalUrl(db, tx),
    provisional: !posLines // true: chưa có bill thật từ DSmart POS, đây là tạm tính của BRG
  };
}

const vnd = (n) => `${Math.round(n).toLocaleString('vi-VN')}₫`;
const when = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) : '');

/** Vẽ bill thành PDF khổ hẹp (như phiếu in), trả về Buffer. */
export function billPdf(b) {
  const W = 300, M = 18;
  const height = 250 + b.lines.length * 34 + (b.refundTotal ? 70 + b.refunds.reduce((a, r) => a + Math.max(1, r.lines.length), 0) * 24 : 0) + (b.invoicePortalUrl ? 40 : 0) + (b.provisional ? 30 : 0);
  const doc = new PDFDocument({ size: [W, height], margin: M, info: { Title: `Bill ${b.code}`, Author: 'BRG Scan & Checkout' } });
  doc.registerFont('r', font('DejaVuSans.ttf')); doc.registerFont('b', font('DejaVuSans-Bold.ttf'));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const inner = W - M * 2;
  const rule = () => { doc.moveTo(M, doc.y + 2).lineTo(W - M, doc.y + 2).dash(2, { space: 2 }).strokeColor('#999').stroke().undash(); doc.moveDown(0.6); };
  const row = (l, r, bold) => { const y = doc.y; doc.font(bold ? 'b' : 'r').text(l, M, y, { width: inner - 90 }); doc.font(bold ? 'b' : 'r').text(r, W - M - 90, y, { width: 90, align: 'right' }); };

  doc.font('b').fontSize(13).text('BRG Scan & Checkout', { align: 'center' });
  doc.font('r').fontSize(9).text(b.storeName, { align: 'center' });
  if (b.storeAddress) doc.text(b.storeAddress, { align: 'center' });
  doc.moveDown(0.6); rule();
  doc.fontSize(8.5).font('r');
  doc.text(`Mã giỏ: ${b.code}`); doc.text(`Thời gian: ${when(b.paidAt)}`); doc.text(`Hình thức: ${b.methodLabel}${b.cashier ? ` · Thu ngân ${b.cashier}` : ''}`);
  if (b.posOrderRef) doc.text(`Mã bill DSmart POS: ${b.posOrderRef}`);
  doc.moveDown(0.4); rule();
  for (const l of b.lines) {
    doc.fontSize(9).font('r').text(l.name, M, doc.y, { width: inner });
    doc.fontSize(8.5).fillColor('#555'); row(`${l.qty} × ${vnd(l.unitPrice)}${l.discount ? ` (giảm ${vnd(l.discount)})` : ''}`, vnd(l.lineTotal)); doc.fillColor('#000'); doc.moveDown(0.4);
  }
  rule();
  doc.fontSize(9);
  if (b.discount) { row('Khuyến mãi', `−${vnd(b.discount)}`); doc.moveDown(0.3); }
  if (b.adjustment) { row('Điều chỉnh theo hoá đơn', `${b.adjustment < 0 ? '−' : '+'}${vnd(Math.abs(b.adjustment))}`); doc.moveDown(0.3); }
  doc.fontSize(11); row('Tổng thanh toán', vnd(b.total), true);
  if (b.refundTotal) {
    doc.moveDown(0.5); doc.fontSize(9).font('b').text('Đã hoàn trả', M, doc.y);
    for (const r of b.refunds) for (const l of (r.lines.length ? r.lines : [{ name: r.reason || 'Hoàn trả', qty: '', amount: r.amount }])) { doc.fontSize(8.5).font('r').fillColor('#555'); row(`${l.name}${l.qty ? ` × ${l.qty}` : ''}`, `−${vnd(l.amount)}`); doc.fillColor('#000'); doc.moveDown(0.3); }
    doc.fontSize(11); row('Thực thanh toán', vnd(b.netTotal), true);
  }
  doc.moveDown(0.8);
  if (b.invoicePortalUrl) { doc.fontSize(7.5).font('b').fillColor('#000').text('Khai báo hoá đơn điện tử:', M, doc.y, { width: inner }); doc.font('r').fillColor('#1c5fa8').text(b.invoicePortalUrl, M, doc.y, { width: inner, link: b.invoicePortalUrl }); doc.fillColor('#000'); doc.moveDown(0.4); }
  if (b.provisional) doc.fontSize(7.5).font('r').fillColor('#9a5b00').text('Đây là tạm tính của ứng dụng, chưa có bill chính thức từ máy tính tiền. Số tiền thực trả theo hoá đơn của cửa hàng.', M, doc.y, { width: inner }).fillColor('#000');
  doc.moveDown(0.4).fontSize(8).font('r').text('Cảm ơn quý khách', { align: 'center' });
  doc.end();
  return done;
}
