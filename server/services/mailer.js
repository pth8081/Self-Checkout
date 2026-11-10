// Gửi email qua máy chủ SMTP của công ty. Cấu hình do quản trị chuỗi nhập ở trang Tích hợp, lưu trong CSDL.
// Mật khẩu SMTP được mã hóa bằng khóa dẫn xuất từ APP_SECRET và không bao giờ trả lại cho trình duyệt.
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';

const key = () => crypto.createHash('sha256').update(`smtp:${config.secret}`).digest();
export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
export function decryptSecret(blob) {
  try {
    const [iv, tag, enc] = String(blob).split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return ''; }
}

const KEY = 'email';
/** Cách kiểm tra chứng chỉ TLS của máy chủ email. Độc lập với kiểu bảo mật (SSL/TLS cổng 465 hay STARTTLS). */
export const TLS_MODES = {
  verify: 'Chứng chỉ do CA công cộng cấp (mặc định)',
  ca: 'Chứng chỉ tự ký hoặc CA nội bộ: tin cậy chứng chỉ tôi nạp (khuyến nghị)',
  insecure: 'Không kiểm tra chứng chỉ (kém an toàn)'
};
const PEM = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;
/** Đọc thông tin chứng chỉ đã nạp để quản trị đối chiếu. Trả null nếu không đọc được. */
export function certInfo(pem) {
  try {
    const c = new crypto.X509Certificate(pem);
    return { subject: c.subject.replace(/\n/g, ', '), issuer: c.issuer.replace(/\n/g, ', '), validTo: c.validTo, fingerprint: c.fingerprint256, selfSigned: c.subject === c.issuer, expired: new Date(c.validTo).getTime() < Date.now() };
  } catch { return null; }
}
export const SECURE_MODES = { ssl: 'SSL/TLS (thường cổng 465)', starttls: 'STARTTLS (thường cổng 587)', none: 'Không mã hóa (cổng 25)' };

/** Bản cấu hình an toàn để hiện cho quản trị (không có mật khẩu). */
export function publicSettings(db) {
  const s = getSetting(db, KEY, {});
  return { configured: !!(s.host && s.from), host: s.host || '', port: s.port || 587, secure: s.secure || 'starttls', user: s.user || '', hasPassword: !!s.passEnc, from: s.from || '', fromName: s.fromName || '',
    tlsMode: s.tlsMode || 'verify', servername: s.servername || '', hasCa: !!s.caPem, ca: s.caPem ? certInfo(s.caPem) : null };
}

export function saveSettings(db, b) {
  const cur = getSetting(db, KEY, {});
  const host = String(b.host ?? cur.host ?? '').trim();
  const port = Number(b.port ?? cur.port ?? 587);
  const secure = String(b.secure ?? cur.secure ?? 'starttls');
  const from = String(b.from ?? cur.from ?? '').trim();
  if (host && !/^[A-Za-z0-9.-]{1,253}$/.test(host)) throw Object.assign(new Error('Máy chủ SMTP không hợp lệ'), { code: 'BAD_HOST' });
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error('Cổng không hợp lệ'), { code: 'BAD_PORT' });
  if (!SECURE_MODES[secure]) throw Object.assign(new Error('Kiểu bảo mật không hợp lệ'), { code: 'BAD_SECURE' });
  if (from && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)) throw Object.assign(new Error('Địa chỉ người gửi không hợp lệ'), { code: 'BAD_FROM' });
  const tlsMode = String(b.tlsMode ?? cur.tlsMode ?? 'verify');
  if (!TLS_MODES[tlsMode]) throw Object.assign(new Error('Kiểu kiểm tra chứng chỉ không hợp lệ'), { code: 'BAD_TLS' });
  const servername = String(b.servername ?? cur.servername ?? '').trim();
  if (servername && !/^[A-Za-z0-9.-]{1,253}$/.test(servername)) throw Object.assign(new Error('Tên máy chủ trong chứng chỉ không hợp lệ'), { code: 'BAD_SERVERNAME' });
  let caPem = cur.caPem;
  if (typeof b.caPem === 'string' && b.caPem.trim() !== '') {
    const pem = b.caPem.trim();
    if (pem.length > 40_000 || !PEM.test(pem) || !certInfo(pem)) throw Object.assign(new Error('Nội dung chứng chỉ không đọc được. Cần định dạng PEM (-----BEGIN CERTIFICATE-----)'), { code: 'BAD_CA' });
    caPem = pem;
  }
  if (b.clearCa === true) caPem = undefined;
  if (tlsMode === 'ca' && !caPem) throw Object.assign(new Error('Hãy nạp chứng chỉ (tệp .crt hoặc .pem) của máy chủ email hoặc CA nội bộ'), { code: 'CA_REQUIRED' });
  const next = { host, port, secure, user: String(b.user ?? cur.user ?? '').trim(), from, fromName: String(b.fromName ?? cur.fromName ?? '').trim().slice(0, 80),
    passEnc: cur.passEnc, tlsMode, servername: servername || undefined, caPem };
  if (typeof b.pass === 'string' && b.pass !== '') next.passEnc = encryptSecret(b.pass);
  if (b.clearPassword === true) delete next.passEnc;
  setSetting(db, KEY, next);
  return publicSettings(db);
}

/** transportFactory(options) cho phép kiểm thử thay bằng bản giả. */
export function createMailer(db, { transportFactory = (o) => nodemailer.createTransport(o) } = {}) {
  const cfg = () => getSetting(db, KEY, {});
  const options = (s) => ({
    host: s.host, port: s.port, secure: s.secure === 'ssl', requireTLS: s.secure === 'starttls', ignoreTLS: s.secure === 'none',
    auth: s.user ? { user: s.user, pass: s.passEnc ? decryptSecret(s.passEnc) : '' } : undefined,
    tls: { rejectUnauthorized: s.tlsMode !== 'insecure', ca: s.tlsMode === 'ca' && s.caPem ? s.caPem : undefined, servername: s.servername || undefined },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000
  });
  return {
    enabled: () => { const s = cfg(); return !!(s.host && s.from); },
    /** Gửi một email. Ném lỗi nếu chưa cấu hình hoặc máy chủ SMTP từ chối. */
    async send({ to, subject, text, html, attachments }) {
      const s = cfg();
      if (!(s.host && s.from)) throw Object.assign(new Error('Chưa cấu hình email'), { code: 'EMAIL_NOT_CONFIGURED' });
      const t = transportFactory(options(s));
      return t.sendMail({ from: s.fromName ? { name: s.fromName, address: s.from } : s.from, to, subject, text, html, attachments });
    }
  };
}

/** Giải thích lỗi gửi email bằng tiếng Việt để quản trị biết cần sửa gì. */
export function explainMailError(e) {
  const c = e?.code, msg = String(e?.message || '');
  if (['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT'].includes(c) || /self[- ]signed|unable to verify/i.test(msg))
    return 'Máy chủ email dùng chứng chỉ tự ký hoặc CA nội bộ nên chưa được tin cậy. Chọn "Chứng chỉ tự ký hoặc CA nội bộ" rồi nạp chứng chỉ của máy chủ email.';
  if (c === 'ERR_TLS_CERT_ALTNAME_INVALID' || /altnames|hostname.*match/i.test(msg))
    return 'Chứng chỉ không khớp với tên hoặc địa chỉ máy chủ. Điền "Tên máy chủ trong chứng chỉ" đúng như trong chứng chỉ (CN hoặc SAN), hoặc dùng đúng tên đó làm máy chủ SMTP.';
  if (c === 'CERT_HAS_EXPIRED' || /certificate has expired/i.test(msg)) return 'Chứng chỉ của máy chủ email đã hết hạn.';
  if (c === 'EAUTH' || /Invalid login|authentication/i.test(msg)) return 'Máy chủ email từ chối tài khoản hoặc mật khẩu.';
  if (/wrong version number|packet length too long/i.test(msg)) return 'Sai kiểu bảo mật. Cổng 465 thường dùng "SSL/TLS", cổng 587 thường dùng "STARTTLS".';
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ESOCKET'].includes(c) || /timeout/i.test(msg)) return `Không kết nối được tới máy chủ email (${c || 'lỗi mạng'}). Kiểm tra địa chỉ, cổng và tường lửa.`;
  return msg.slice(0, 160);
}
