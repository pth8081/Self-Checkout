import crypto from 'node:crypto';
import { config } from './config.js';
import { nowIso, unauthorized, forbidden } from './util.js';

// ---- Mật khẩu / PIN: scrypt + salt ----
export function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(secret), salt, 32);
  return `s1$${salt.toString('hex')}$${h.toString('hex')}`;
}
export function verifySecret(secret, stored) {
  if (!stored) return false;
  const [v, saltHex, hashHex] = stored.split('$');
  if (v !== 's1') return false;
  const h = crypto.scryptSync(String(secret), Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return h.length === expected.length && crypto.timingSafeEqual(h, expected);
}

// ---- Token ký HMAC (không lưu trạng thái) ----
const b64 = (b) => Buffer.from(b).toString('base64url');
export function sign(payload, ttlHours = config.authTokenHours) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlHours * 3600 }));
  const sig = crypto.createHmac('sha256', config.secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verify(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', config.secret).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch { return null; }
}

// ---- Khóa tạm khi sai nhiều lần ----
export function checkLocked(user) {
  if (user.locked_until && user.locked_until > nowIso()) {
    const mins = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
    const e = unauthorized('LOCKED', `Tài khoản bị khóa tạm, thử lại sau ${mins} phút`);
    e.extra = { minutes: mins };
    throw e;
  }
}
export function recordFail(db, user) {
  const failed = user.failed + 1;
  if (failed >= config.maxPinFails) {
    const until = new Date(Date.now() + config.lockMinutes * 60000).toISOString();
    db.prepare('UPDATE staff SET failed = 0, locked_until = ? WHERE id = ?').run(until, user.id);
  } else {
    db.prepare('UPDATE staff SET failed = ? WHERE id = ?').run(failed, user.id);
  }
}
export const recordOk = (db, user) =>
  db.prepare('UPDATE staff SET failed = 0, locked_until = NULL WHERE id = ?').run(user.id);

// ---- Vai trò ----
export const isManager = (u) => u.role === 'branch_admin' || u.role === 'chain_admin';
export const canCash = (u) => ['cashier', 'cashier_gate', 'branch_admin', 'chain_admin'].includes(u.role);
export const canGate = (u) => ['gate', 'cashier_gate', 'branch_admin', 'chain_admin'].includes(u.role);

/** Middleware: đọc Bearer token, nạp người dùng từ DB (kiểm tra còn hoạt động). */
export function authenticate(db, kind) {
  return async (req) => {
    const h = req.headers.authorization || '';
    const p = verify(h.startsWith('Bearer ') ? h.slice(7) : '');
    if (!p || p.kind !== kind) throw unauthorized();
    const user = db.prepare('SELECT * FROM staff WHERE id = ?').get(p.uid);
    if (!user || !user.active) throw unauthorized('INACTIVE', 'Tài khoản đã bị khóa');
    if (kind === 'admin' && !isManager(user)) throw forbidden();
    req.user = user;
  };
}
