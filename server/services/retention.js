// Giữ dữ liệu có thời hạn: xoá thông tin cá nhân của khách và dữ liệu kỹ thuật cũ, GIỮ số liệu bán hàng.
//
// - Thông tin cá nhân (email nhận bill, thông tin xuất hoá đơn công ty, email đã xác minh của thiết bị, mã thiết bị gắn với đơn)
//   bị xoá sau `piiMonths` tháng kể từ lúc thanh toán (hoặc tạo đơn nếu chưa thanh toán). Đơn, số tiền, các dòng hàng, bill
//   và hoàn trả vẫn giữ nguyên nên doanh thu và đối soát không đổi.
// - Dữ liệu kỹ thuật (nhật ký quét, hàng chờ đồng bộ, chi tiết giỏ, lần quét ở cổng) xoá sau `logDays` ngày.
// - Nhật ký thao tác xoá sau `auditMonths` tháng. 0 nghĩa là giữ mãi.
import { getSetting, setSetting } from '../db.js';
import { audit } from './audit.js';
import { nowIso } from '../util.js';

export const RETENTION_KEY = 'retention';
export const RETENTION_DEFAULTS = { piiMonths: 12, logDays: 90, auditMonths: 24 };
const FINAL = `('paid','cancelled','voided')`;

export function retentionConfig(db) {
  const s = getSetting(db, RETENTION_KEY, {});
  const pick = (k) => (Number.isInteger(s[k]) && s[k] >= 0 ? s[k] : RETENTION_DEFAULTS[k]);
  return { piiMonths: pick('piiMonths'), logDays: pick('logDays'), auditMonths: pick('auditMonths') };
}

export function validateRetention(b) {
  const out = {};
  const lim = { piiMonths: [1, 120], logDays: [7, 3650], auditMonths: [6, 120] };
  for (const [k, [lo, hi]] of Object.entries(lim)) {
    if (b?.[k] === undefined || b[k] === null || b[k] === '') continue;
    const v = Number(b[k]);
    if (v === 0) { out[k] = 0; continue; } // 0 = giữ mãi
    if (!Number.isInteger(v) || v < lo || v > hi) return { error: `${k} phải từ ${lo} đến ${hi}, hoặc 0 để giữ mãi` };
    out[k] = v;
  }
  return { value: out };
}

const monthsAgo = (now, m) => { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString(); };
const daysAgo = (now, n) => new Date(now - n * 86400_000).toISOString();

/** Chạy một lượt dọn. An toàn khi chạy nhiều lần. Trả số dòng đã xử lý theo từng loại. */
export function runRetention(ctx, now = Date.now()) {
  const { db } = ctx;
  const cfg = retentionConfig(db);
  const done = { piiTransactions: 0, invoices: 0, deviceEmails: 0, identityCodes: 0, logs: 0, sessions: 0, audit: 0 };
  db.transaction(() => {
    if (cfg.piiMonths > 0) {
      const cut = monthsAgo(now, cfg.piiMonths);
      const ids = db.prepare(`SELECT id FROM transactions WHERE status IN ${FINAL} AND pii_purged_at IS NULL AND COALESCE(paid_at, created_at) < ?
        AND (buyer_json IS NOT NULL OR bill_email IS NOT NULL OR bill_email_error IS NOT NULL OR device_id != '-')`).all(cut).map((r) => r.id);
      const upTx = db.prepare(`UPDATE transactions SET buyer_json = NULL, bill_email = NULL, bill_email_error = NULL, device_id = '-', pii_purged_at = ? WHERE id = ?`);
      const upInv = db.prepare(`UPDATE invoices SET email = NULL, tax_code = NULL, company_name = NULL, address = NULL WHERE transaction_id = ? AND (email IS NOT NULL OR tax_code IS NOT NULL OR company_name IS NOT NULL OR address IS NOT NULL)`);
      const at = nowIso();
      for (const id of ids) { upTx.run(at, id); done.invoices += upInv.run(id).changes; }
      done.piiTransactions = ids.length;
      done.deviceEmails = db.prepare('DELETE FROM device_emails WHERE verified_at < ?').run(cut).changes;
    }
    done.identityCodes = db.prepare('DELETE FROM identity_codes WHERE expires_at < ?').run(daysAgo(now, 1)).changes;
    if (cfg.logDays > 0) {
      const cut = daysAgo(now, cfg.logDays);
      done.logs += db.prepare('DELETE FROM scan_events WHERE ts < ?').run(cut).changes;
      done.logs += db.prepare('DELETE FROM gate_scans WHERE ts < ?').run(cut).changes;
      // Phiên đã kết thúc từ lâu: bỏ chi tiết giỏ và hàng chờ đồng bộ. Hàng đã mua vẫn nằm trong đơn (items_json) và bill.
      const old = db.prepare(`SELECT id FROM scan_sessions WHERE status NOT IN ('active','locked') AND COALESCE(ended_at, last_activity) < ?`).all(cut).map((r) => r.id);
      const dc = db.prepare('DELETE FROM cart_items WHERE session_id = ?'), dp = db.prepare('DELETE FROM processed_ops WHERE session_id = ?');
      for (const id of old) { dc.run(id); dp.run(id); }
      done.sessions = old.length;
    }
    if (cfg.auditMonths > 0) done.audit = db.prepare('DELETE FROM audit_events WHERE ts < ?').run(monthsAgo(now, cfg.auditMonths)).changes;
  })();
  const total = Object.values(done).reduce((a, b) => a + b, 0);
  const result = { at: nowIso(), config: cfg, done };
  setSetting(db, 'retention_last', result);
  if (total) audit(db, { actorType: 'system', actorId: 'SYSTEM', action: 'retention.run', entity: 'settings', entityId: RETENTION_KEY, data: done });
  return result;
}
