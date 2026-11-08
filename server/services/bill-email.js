// Gửi bill về email khách: kèm bản PDF và link xem lại. Lỗi thì giữ trạng thái để thử lại.
import { config } from '../config.js';
import { nowIso } from '../util.js';
import { audit } from './audit.js';
import { billOf, billPdf } from './bill.js';
import { makeBillToken } from './qr.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const vnd = (n) => `${Math.round(n).toLocaleString('vi-VN')}₫`;

export const billLink = (txId) => (config.publicUrl ? `${config.publicUrl}/c/#/bill-link/${makeBillToken(txId)}` : null);

function content(b, link) {
  const rows = b.lines.map((l) => `<tr><td style="padding:4px 8px">${esc(l.name)}<br><span style="color:#777;font-size:12px">${l.qty} × ${vnd(l.unitPrice)}${l.discount ? ` (giảm ${vnd(l.discount)})` : ''}</span></td><td style="padding:4px 8px;text-align:right">${vnd(l.lineTotal)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px"><h2 style="margin:0 0 4px">BRG Scan &amp; Checkout</h2><p style="margin:0 0 12px;color:#555">${esc(b.storeName)} · mã giỏ ${esc(b.code)}</p>
<table style="width:100%;border-collapse:collapse;border-top:1px solid #ddd">${rows}</table>
${b.adjustment ? `<p style="margin:4px 8px">Điều chỉnh theo hoá đơn: ${b.adjustment < 0 ? '−' : '+'}${vnd(Math.abs(b.adjustment))}</p>` : ''}<p style="font-size:16px"><b>Tổng thanh toán: ${vnd(b.total)}</b></p>${b.invoicePortalUrl ? `<p><a href="${esc(b.invoicePortalUrl)}"><b>Khai báo hoá đơn điện tử</b></a></p>` : ''}${link ? `<p><a href="${esc(link)}">Xem bill trên web</a></p>` : ''}<p style="color:#777;font-size:12px">Bill PDF đính kèm email này.${b.provisional ? ' Đây là tạm tính, chưa có bill chính thức từ máy tính tiền.' : ''}</p></div>`;
  const text = `BRG Scan & Checkout\n${b.storeName} · mã giỏ ${b.code}\n\n${b.lines.map((l) => `${l.name}: ${l.qty} x ${vnd(l.unitPrice)} = ${vnd(l.lineTotal)}`).join('\n')}${b.adjustment ? `\nĐiều chỉnh theo hoá đơn: ${b.adjustment < 0 ? '-' : '+'}${vnd(Math.abs(b.adjustment))}` : ''}\n\nTổng thanh toán: ${vnd(b.total)}\n${b.invoicePortalUrl ? `Khai báo hoá đơn điện tử: ${b.invoicePortalUrl}\n` : ''}${link ? `Xem bill: ${link}\n` : ''}`;
  return { html, text };
}

/** Gửi bill của giao dịch đã thanh toán tới `bill_email`. Không ném lỗi: ghi trạng thái để thử lại. */
export async function sendBillEmail(ctx, txId) {
  const { db, mailer } = ctx;
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId);
  if (!tx || tx.status !== 'paid' || !tx.bill_email || tx.bill_email_status === 'sent') return;
  if (!mailer.enabled()) return;
  // nhận việc nguyên tử để hai lần gọi cùng lúc không gửi trùng
  const claim = db.prepare(`UPDATE transactions SET bill_email_status='sending', bill_email_tries = bill_email_tries + 1 WHERE id = ? AND (bill_email_status IS NULL OR bill_email_status IN ('pending','failed'))`).run(txId);
  if (!claim.changes) return;
  try {
    const b = billOf(ctx, tx);
    const { html, text } = content(b, billLink(tx.id));
    await mailer.send({ to: tx.bill_email, subject: `Bill mua hàng ${b.storeName} (${b.code})`, text, html,
      attachments: [{ filename: `bill-${b.code}.pdf`, content: await billPdf(b), contentType: 'application/pdf' }] });
    db.prepare(`UPDATE transactions SET bill_email_status='sent', bill_email_at=?, bill_email_error=NULL WHERE id=?`).run(nowIso(), txId);
    audit(db, { storeId: tx.store_id, actorType: 'system', action: 'bill.emailed', entity: 'transaction', entityId: txId });
  } catch (e) {
    db.prepare(`UPDATE transactions SET bill_email_status='failed', bill_email_error=? WHERE id=?`).run(String(e.message).slice(0, 200), txId);
    audit(db, { storeId: tx.store_id, actorType: 'system', action: 'bill.email_failed', entity: 'transaction', entityId: txId, data: { error: String(e.message).slice(0, 200) } });
  }
}

/** Chạy nền và theo dõi để kiểm thử đợi được. */
export function sendBillEmailBg(ctx, txId) {
  const p = sendBillEmail(ctx, txId).finally(() => ctx.bg.delete(p));
  ctx.bg.add(p);
  return p;
}

/** Thử lại các bill chưa gửi được (tối đa 5 lần, trong 24 giờ). */
export async function retryBillEmails(ctx) {
  if (!ctx.mailer.enabled()) return 0;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = ctx.db.prepare(`SELECT id FROM transactions WHERE status='paid' AND bill_email IS NOT NULL AND bill_email_status IN ('pending','failed') AND bill_email_tries < 5 AND paid_at >= ?`).all(since);
  for (const r of rows) await sendBillEmail(ctx, r.id);
  return rows.length;
}
