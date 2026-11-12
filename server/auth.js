import crypto from 'node:crypto';
import { config } from './config.js';
import { nowIso, unauthorized, forbidden } from './util.js';
import { getSetting } from './db.js';
import { matchTotpStep } from './services/totp.js';
import { encryptSecret, decryptSecret } from './services/mailer.js';

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
  const body = b64(JSON.stringify({ ...payload, iat: Date.now(), exp: Math.floor(Date.now() / 1000) + ttlHours * 3600 }));
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
    // Token cấp trước thời điểm thu hồi (đổi mật khẩu, PIN, vai trò) không còn hiệu lực.
    if (user.sec_epoch && (p.iat || 0) < Date.parse(user.sec_epoch)) throw unauthorized('SESSION_REVOKED', 'Thông tin đăng nhập của tài khoản vừa thay đổi, hãy đăng nhập lại.');
    if (kind === 'admin') {
      // Một phiên đăng nhập tại một thời điểm: đăng nhập ở thiết bị khác sẽ đổi mã phiên, phiên cũ bị từ chối ở lần gọi sau.
      if (securityPolicy(db).singleSession && (p.sid || null) !== (user.session_id || null)) {
        throw unauthorized('SESSION_REPLACED', 'Tài khoản vừa đăng nhập ở một thiết bị khác nên phiên này đã bị đăng xuất. Hãy đăng nhập lại nếu đó không phải bạn.');
      }
      if (user.session_id && (!user.session_seen || Date.now() - Date.parse(user.session_seen) > 60_000)) {
        const ts = nowIso(); db.prepare('UPDATE staff SET session_seen = ? WHERE id = ?').run(ts, user.id); user.session_seen = ts;
      }
    }
    req.user = user;
  };
}

/** Tên đăng nhập kiểu AD (anh.dp): chữ thường, số, dấu chấm, gạch dưới, gạch ngang; 3 đến 40 ký tự; bắt đầu bằng chữ hoặc số. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
export function cleanUsername(v) {
  const u = String(v ?? '').trim().toLowerCase();
  if (!u) return null;
  if (!USERNAME_RE.test(u)) return false;
  return u;
}
/** Tên đăng nhập đã được dùng (trùng mã tài khoản, email hoặc tên đăng nhập của người khác) thì trả true. */
export function usernameTaken(db, username, exceptId) {
  const row = db.prepare('SELECT id FROM staff WHERE (id = ? COLLATE NOCASE OR email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE) AND id <> ?').get(username, username, username, exceptId || '');
  return !!row;
}

/** Chính sách bảo mật đăng nhập quản trị. Quản trị chuỗi đổi ở trang Tài khoản; chưa đổi thì theo biến môi trường (mặc định bật cả hai). */
export function securityPolicy(db) {
  const s = getSetting(db, 'security', {});
  return {
    require2fa: typeof s.require2fa === 'boolean' ? s.require2fa : process.env.REQUIRE_ADMIN_2FA !== '0',
    requireCaptcha: typeof s.requireCaptcha === 'boolean' ? s.requireCaptcha : process.env.REQUIRE_CAPTCHA !== '0',
    singleSession: typeof s.singleSession === 'boolean' ? s.singleSession : process.env.SINGLE_SESSION !== '0'
  };
}

/** Tốn thời gian băm như khi kiểm tra mật khẩu thật, dùng khi tài khoản không tồn tại, để không đo được thời gian mà đoán ra mã tài khoản có thật. */
let DUMMY = null;
export function burnScrypt() { DUMMY ||= hashSecret('burn-' + Math.random()); verifySecret('x', DUMMY); }

// ---- Khóa bí mật 2 bước (TOTP): lưu dạng mã hóa, mỗi mã chỉ dùng một lần ----
const SEALED = 'enc1:';
/** Mã hóa khóa 2 bước trước khi lưu vào CSDL (khóa dẫn xuất từ APP_SECRET), để lộ file CSDL/sao lưu không làm lộ 2 bước. */
export const sealTotp = (secret) => SEALED + encryptSecret(secret);
/** Đọc khóa 2 bước của tài khoản (chấp nhận cả bản lưu thô cũ). */
export const totpSecretOf = (user) => (user?.totp_secret ? (user.totp_secret.startsWith(SEALED) ? decryptSecret(user.totp_secret.slice(SEALED.length)) : user.totp_secret) : '');
/**
 * Kiểm tra mã 6 số của tài khoản. Không chấp nhận lại mã (hoặc mã cũ hơn) đã dùng thành công. Bản lưu thô cũ được nâng cấp sang mã hóa khi dùng thành công.
 */
export function checkTotp(db, user, code) {
  const secret = totpSecretOf(user);
  if (!secret) return false;
  const step = matchTotpStep(secret, code);
  if (step === null) return false;
  if (user.totp_last !== null && user.totp_last !== undefined && step <= user.totp_last) return false; // mã đã dùng
  db.prepare('UPDATE staff SET totp_last = ?, totp_secret = ? WHERE id = ?').run(step, user.totp_secret.startsWith(SEALED) ? user.totp_secret : sealTotp(secret), user.id);
  user.totp_last = step;
  return true;
}

/** Thu hồi mọi phiên đang đăng nhập của tài khoản (gọi khi đổi mật khẩu, PIN, vai trò). */
export function revokeSessions(db, userId) {
  db.prepare('UPDATE staff SET sec_epoch = ?, session_id = NULL, session_seen = NULL, session_info = NULL WHERE id = ?').run(new Date().toISOString(), userId);
}
