// Tạo mã QR chuyển khoản (VietQR/EMVCo) và token QR biên nhận.
import crypto from 'node:crypto';
import { config } from '../config.js';

const tlv = (tag, value) => tag + String(value.length).padStart(2, '0') + value;

export function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Bỏ dấu tiếng Việt và ký tự lạ, vì nội dung chuyển khoản chỉ chấp nhận ASCII. */
export const asciiContent = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, '').slice(0, 25);

/**
 * Payload QR chuyển khoản liên ngân hàng nhanh 247 có sẵn số tiền và nội dung.
 * bin: mã ngân hàng (6 số), account: số tài khoản nhận.
 */
export function vietQrPayload({ bin, account, amount, content }) {
  if (!/^\d{6}$/.test(bin || '')) throw new Error('Mã ngân hàng (BIN) phải gồm 6 chữ số');
  if (!/^\d{4,19}$/.test(account || '')) throw new Error('Số tài khoản không hợp lệ');
  const consumer = tlv('00', bin) + tlv('01', account);
  const merchant = tlv('00', 'A000000727') + tlv('01', consumer) + tlv('02', 'QRIBFTTA');
  let s = tlv('00', '01') + tlv('01', '12') + tlv('38', merchant) + tlv('53', '704');
  if (amount > 0) s += tlv('54', String(Math.round(amount)));
  s += tlv('58', 'VN');
  if (content) s += tlv('62', tlv('08', asciiContent(content)));
  s += '6304';
  return s + crc16(s);
}

// ---- Token QR biên nhận: R1.<txId>.<hết hạn (giây)>.<chữ ký> ----
const mac = (data) => crypto.createHmac('sha256', config.secret).update(data).digest('base64url').slice(0, 22);

export function makeReceiptToken(txId, expiresAtIso) {
  const exp = Math.floor(new Date(expiresAtIso).getTime() / 1000);
  const body = `R1.${txId}.${exp}`;
  return `${body}.${mac(body)}`;
}

// ---- Link xem bill không cần đăng nhập (gửi trong email): B1.<txId>.<chữ ký>, hết hạn sau BILL_LINK_DAYS ngày (mặc định 180) ----
export const makeBillToken = (txId) => `B1.${txId}.${mac(`B1.${txId}`)}`;
export function parseBillToken(raw) {
  const m = /^B1\.([A-Z0-9-]+)\.([A-Za-z0-9_-]{22})$/.exec(String(raw || '').trim());
  if (!m) return null;
  const a = Buffer.from(mac(`B1.${m[1]}`)), b = Buffer.from(m[2]);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? { txId: m[1] } : null;
}

export function parseReceiptToken(raw) {
  const m = /^R1\.([A-Z0-9-]+)\.(\d+)\.([A-Za-z0-9_-]{22})$/.exec(String(raw || '').trim());
  if (!m) return null;
  const body = `R1.${m[1]}.${m[2]}`;
  const a = Buffer.from(mac(body)), b = Buffer.from(m[3]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { txId: m[1], exp: Number(m[2]) };
}
