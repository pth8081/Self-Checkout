// Gửi email qua máy chủ SMTP của công ty. Cấu hình do quản trị chuỗi nhập ở trang Tích hợp, lưu trong CSDL.
// Mật khẩu SMTP được mã hoá bằng khoá dẫn xuất từ APP_SECRET và không bao giờ trả lại cho trình duyệt.
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
export const SECURE_MODES = { ssl: 'SSL/TLS (thường cổng 465)', starttls: 'STARTTLS (thường cổng 587)', none: 'Không mã hoá (cổng 25)' };

/** Bản cấu hình an toàn để hiện cho quản trị (không có mật khẩu). */
export function publicSettings(db) {
  const s = getSetting(db, KEY, {});
  return { configured: !!(s.host && s.from), host: s.host || '', port: s.port || 587, secure: s.secure || 'starttls', user: s.user || '', hasPassword: !!s.passEnc, from: s.from || '', fromName: s.fromName || '' };
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
  const next = { host, port, secure, user: String(b.user ?? cur.user ?? '').trim(), from, fromName: String(b.fromName ?? cur.fromName ?? '').trim().slice(0, 80),
    passEnc: cur.passEnc };
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
