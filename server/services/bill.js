// Bill (hoá đơn bán hàng) cho khách xem và tải PDF. Bill thật lấy từ POS; chưa có thì dùng tạm tính của BRG và ghi rõ.
import fs from 'node:fs';
import PDFDocument from 'pdfkit';

const FONT = new URL('../assets/fonts/', import.meta.url);
const font = (n) => fs.readFileSync(new URL(n, FONT));

const METHOD = { cash: 'Tiền mặt', qr_transfer: 'Chuyển khoản', card: 'Thẻ', ewallet: 'Ví điện tử', pos: 'Tại quầy', basket: 'Tại quầy' };

export function billOf(ctx, tx) {
  const { db } = ctx;
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(tx.store_id);
  const posLines = tx.pos_bill_json ? JSON.parse(tx.pos_bill_json) : null;
  const items = posLines || JSON.parse(tx.items_json).map((i) => ({ barcode: i.barcode, name: i.name, qty: i.qty, unitPrice: i.price, discount: i.discount || 0, lineTotal: i.price * i.qty - (i.discount || 0) }));
  const total = tx.pos_amount ?? tx.total;
  return {
    id: tx.id, code: tx.cart_code, storeName: store?.name || tx.store_id, storeAddress: store?.address || '',
    paidAt: tx.paid_at, method: tx.method, methodLabel: METHOD[tx.method] || tx.method, cashier: tx.pos_cashier || null,
    lines: items, discount: items.reduce((a, l) => a + (l.discount || 0), 0), total,
    invoiceNo: tx.pos_invoice_no || null, invoiceUrl: tx.pos_invoice_url || null,
    provisional: !posLines // true: chưa có bill thật từ POS, đây là tạm tính của BRG
  };
}

const vnd = (n) => `${Math.round(n).toLocaleString('vi-VN')}₫`;
const when = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) : '');

/** Vẽ bill thành PDF khổ hẹp (như phiếu in), trả về Buffer. */
export function billPdf(b) {
  const W = 300, M = 18;
  const height = 230 + b.lines.length * 34 + (b.invoiceUrl ? 28 : 0) + (b.provisional ? 30 : 0);
  const doc = new PDFDocument({ size: [W, height], margin: M, info: { Title: `Bill ${b.code}`, Author: 'BRG Self Checkout' } });
  doc.registerFont('r', font('DejaVuSans.ttf')); doc.registerFont('b', font('DejaVuSans-Bold.ttf'));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const inner = W - M * 2;
  const rule = () => { doc.moveTo(M, doc.y + 2).lineTo(W - M, doc.y + 2).dash(2, { space: 2 }).strokeColor('#999').stroke().undash(); doc.moveDown(0.6); };
  const row = (l, r, bold) => { const y = doc.y; doc.font(bold ? 'b' : 'r').text(l, M, y, { width: inner - 90 }); doc.font(bold ? 'b' : 'r').text(r, W - M - 90, y, { width: 90, align: 'right' }); };

  doc.font('b').fontSize(13).text('BRG Self Checkout', { align: 'center' });
  doc.font('r').fontSize(9).text(b.storeName, { align: 'center' });
  if (b.storeAddress) doc.text(b.storeAddress, { align: 'center' });
  doc.moveDown(0.6); rule();
  doc.fontSize(8.5).font('r');
  doc.text(`Mã giỏ: ${b.code}`); doc.text(`Thời gian: ${when(b.paidAt)}`); doc.text(`Hình thức: ${b.methodLabel}${b.cashier ? ` · Thu ngân ${b.cashier}` : ''}`);
  if (b.invoiceNo) doc.text(`Hoá đơn điện tử: ${b.invoiceNo}`);
  doc.moveDown(0.4); rule();
  for (const l of b.lines) {
    doc.fontSize(9).font('r').text(l.name, M, doc.y, { width: inner });
    doc.fontSize(8.5).fillColor('#555'); row(`${l.qty} × ${vnd(l.unitPrice)}${l.discount ? ` (giảm ${vnd(l.discount)})` : ''}`, vnd(l.lineTotal)); doc.fillColor('#000'); doc.moveDown(0.4);
  }
  rule();
  doc.fontSize(9);
  if (b.discount) { row('Khuyến mãi', `−${vnd(b.discount)}`); doc.moveDown(0.3); }
  doc.fontSize(11); row('Tổng thanh toán', vnd(b.total), true);
  doc.moveDown(0.8);
  if (b.invoiceUrl) { doc.fontSize(7.5).font('r').fillColor('#1c5fa8').text(`Hoá đơn điện tử: ${b.invoiceUrl}`, M, doc.y, { width: inner, link: b.invoiceUrl }); doc.fillColor('#000'); doc.moveDown(0.4); }
  if (b.provisional) doc.fontSize(7.5).font('r').fillColor('#9a5b00').text('Đây là tạm tính của ứng dụng, chưa có bill chính thức từ máy tính tiền. Số tiền thực trả theo hoá đơn của cửa hàng.', M, doc.y, { width: inner }).fillColor('#000');
  doc.moveDown(0.4).fontSize(8).font('r').text('Cảm ơn quý khách', { align: 'center' });
  doc.end();
  return done;
}
