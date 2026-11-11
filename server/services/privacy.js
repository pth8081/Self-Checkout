// Xóa dữ liệu cá nhân theo yêu cầu của một khách (tìm theo email). Không xóa đơn, số tiền, dòng hàng, bill, hoàn trả:
// các số liệu bán hàng giữ nguyên, chỉ gỡ phần nhận dạng được người.
import { createHash } from 'node:crypto';
import { audit } from './audit.js';
import { nowIso } from '../util.js';

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const norm = (e) => String(e || '').trim().toLowerCase();

function scope(db, email) {
  // Ứng viên: email nhận bill trùng, hoặc chuỗi "email":"..." nằm trong thông tin người mua (LIKE không phân biệt hoa thường); lọc lại chính xác bằng JS
  const cand = db.prepare(`SELECT id, bill_email, buyer_json FROM transactions WHERE LOWER(bill_email) = ? OR buyer_json LIKE ?`).all(email, `%"email":"%${email.replace(/[%_[\]]/g, '_')}%"%`);
  const buyerMail = (j) => { try { return String(JSON.parse(j)?.email || '').toLowerCase(); } catch { return ''; } };
  const byEmail = cand.filter((r) => String(r.bill_email || '').toLowerCase() === email || buyerMail(r.buyer_json) === email).map((r) => r.id);
  const devices = db.prepare('SELECT DISTINCT device_id FROM device_emails WHERE LOWER(email) = ?').all(email).map((r) => r.device_id);
  const ph = (n) => devices.map(() => '?').join(',') || "''";
  const byDevice = devices.length ? db.prepare(`SELECT id FROM transactions WHERE device_id IN (${ph()}) AND device_id != '-'`).all(...devices).map((r) => r.id) : [];
  const sessions = devices.length ? db.prepare(`SELECT COUNT(*) n FROM scan_sessions WHERE device_id IN (${ph()}) AND device_id != '-'`).get(...devices).n : 0;
  const invoices = db.prepare(`SELECT id FROM invoices WHERE LOWER(email) = ? OR transaction_id IN (${byEmail.map(() => '?').join(',') || "''"})`).all(email, ...byEmail).map((r) => r.id);
  const codes = db.prepare('SELECT COUNT(*) n FROM identity_codes WHERE LOWER(email) = ?').get(email).n;
  const emails = db.prepare('SELECT COUNT(*) n FROM device_emails WHERE LOWER(email) = ?').get(email).n;
  return { byEmail, devices, byDevice, sessions, invoices, codes, emails };
}

/** Xem trước: có bao nhiêu bản ghi sẽ bị xóa trắng. Không thay đổi gì. */
export function previewErase(ctx, rawEmail) {
  const email = norm(rawEmail);
  if (!EMAIL_RE.test(email)) return { error: 'Email không hợp lệ' };
  const s = scope(ctx.db, email);
  return { counts: { transactions: s.byEmail.length, devices: s.devices.length, transactionsByDevice: s.byDevice.length, sessions: s.sessions, invoices: s.invoices.length, verifiedEmails: s.emails, pendingCodes: s.codes } };
}

/** Thực hiện xóa. Ghi nhật ký thao tác (chỉ lưu dấu vết băm của email, không lưu email). */
export function eraseCustomer(ctx, rawEmail, { actor, note } = {}) {
  const { db } = ctx;
  const email = norm(rawEmail);
  if (!EMAIL_RE.test(email)) return { error: 'Email không hợp lệ' };
  const s = scope(db, email);
  const at = nowIso();
  db.transaction(() => {
    const wipeTx = db.prepare(`UPDATE transactions SET buyer_json = NULL, bill_email = NULL, bill_email_error = NULL, device_id = '-', pii_purged_at = COALESCE(pii_purged_at, ?) WHERE id = ?`);
    for (const id of s.byEmail) wipeTx.run(at, id);
    const wipeInv = db.prepare('UPDATE invoices SET email = NULL, tax_code = NULL, company_name = NULL, address = NULL WHERE id = ?');
    for (const id of s.invoices) wipeInv.run(id);
    if (s.devices.length) {
      const ph = s.devices.map(() => '?').join(',');
      db.prepare(`UPDATE transactions SET device_id = '-' WHERE device_id IN (${ph})`).run(...s.devices);
      db.prepare(`UPDATE scan_sessions SET device_id = '-' WHERE device_id IN (${ph}) AND status NOT IN ('active','locked')`).run(...s.devices);
    }
    db.prepare('DELETE FROM device_emails WHERE LOWER(email) = ?').run(email);
    db.prepare('DELETE FROM identity_codes WHERE LOWER(email) = ?').run(email);
    audit(db, { actorType: 'admin', actorId: actor ?? null, action: 'privacy.erase', entity: 'customer', entityId: createHash('sha256').update(email).digest('hex').slice(0, 12),
      data: { transactions: s.byEmail.length, transactionsByDevice: s.byDevice.length, devices: s.devices.length, invoices: s.invoices.length, note: note ? String(note).slice(0, 200) : undefined } });
  })();
  return { done: { transactions: s.byEmail.length, transactionsByDevice: s.byDevice.length, devices: s.devices.length, invoices: s.invoices.length, verifiedEmails: s.emails } };
}
