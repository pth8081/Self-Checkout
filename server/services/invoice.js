// Adapter hóa đơn điện tử. Bản giả lập luôn thành công (trừ khi bật failNext để thử lỗi).
// Khi nối nhà cung cấp thật: viết adapter có hàm issue(tx, buyer) trả { number } hoặc ném lỗi.
import { nowIso, localDate } from '../util.js';
import { nextCounter, getSetting, setSetting } from '../db.js';
import { audit } from './audit.js';

export function createMockInvoicer(db) {
  return {
    name: 'mock',
    async issue(tx, buyer) {
      const cfg = getSetting(db, 'einvoice', {});
      if (cfg.failNext) { setSetting(db, 'einvoice', { ...cfg, failNext: false }); throw new Error('Nhà cung cấp hóa đơn không phản hồi (giả lập)'); }
      const seq = nextCounter(db, tx.store_id, 'invoice');
      return { number: `HD${localDate().replace(/-/g, '')}-${tx.store_id}-${String(seq).padStart(5, '0')}` };
    }
  };
}

/** Xuất hóa đơn cho giao dịch; lỗi thì giữ trạng thái pending để thử lại. */
export async function issueInvoice(db, invoicer, tx, buyer = {}) {
  const type = buyer.taxCode ? 'company' : 'retail';
  const info = db.prepare(`INSERT INTO invoices(transaction_id,type,email,tax_code,company_name,address,status,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(tx.id, type, buyer.email || null, buyer.taxCode || null, buyer.companyName || null,
      buyer.address || null, 'pending', nowIso());
  const id = info.lastInsertRowid;
  try {
    const { number } = await invoicer.issue(tx, buyer);
    db.prepare('UPDATE invoices SET status=?, number=?, error=NULL WHERE id=?').run('issued', number, id);
    audit(db, { storeId: tx.store_id, actorType: 'system', action: 'invoice.issued', entity: 'transaction', entityId: tx.id, data: { number, type } });
  } catch (e) {
    db.prepare('UPDATE invoices SET status=?, error=? WHERE id=?').run('pending', String(e.message), id);
    audit(db, { storeId: tx.store_id, actorType: 'system', action: 'invoice.failed', entity: 'transaction', entityId: tx.id, data: { error: e.message } });
  }
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
}

/** Thử lại các hóa đơn còn pending. */
export async function retryPendingInvoices(db, invoicer) {
  // Chỉ lấy hóa đơn treo đã quá 30 giây (không chen vào hóa đơn đang xuất) và "nhận việc" bằng cập nhật
  // nguyên tử, để hai tiến trình chạy cùng lúc không xuất trùng một hóa đơn.
  const cutoff = new Date(Date.now() - 30_000).toISOString();
  const rows = db.prepare(`SELECT i.*, t.store_id FROM invoices i JOIN transactions t ON t.id = i.transaction_id WHERE i.status='pending' AND i.created_at < ?`).all(cutoff);
  let ok = 0;
  for (const r of rows) {
    if (db.prepare(`UPDATE invoices SET status='retrying' WHERE id = ? AND status='pending'`).run(r.id).changes !== 1) continue;
    try {
      const { number } = await invoicer.issue({ id: r.transaction_id, store_id: r.store_id }, { taxCode: r.tax_code, email: r.email });
      db.prepare('UPDATE invoices SET status=?, number=?, error=NULL WHERE id=?').run('issued', number, r.id);
      ok++;
    } catch (e) { db.prepare(`UPDATE invoices SET status='pending', error=? WHERE id=?`).run(String(e.message), r.id); }
  }
  return { tried: rows.length, issued: ok };
}
