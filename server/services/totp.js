// TOTP (RFC 6238) bằng crypto của Node, không cần thư viện ngoài.
import crypto from 'node:crypto';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function randomSecret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHA[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function decodeBase32(s) {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const i = ALPHA.indexOf(c);
    if (i < 0) throw new Error('Base32 không hợp lệ');
    bits += i.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function hotp(secret, counter, digits = 6) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', decodeBase32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}

export const totpNow = (secret, time = Date.now()) => hotp(secret, Math.floor(time / 30000));

/** Cho phép lệch ±1 bước (30 giây) để bù đồng hồ. */
export function verifyTotp(secret, code, time = Date.now()) {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(time / 30000);
  for (const d of [-1, 0, 1]) {
    const expected = hotp(secret, step + d);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return true;
  }
  return false;
}

export const otpauthUri = (secret, account, issuer = 'BRG Scan & Checkout') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
