// Mã xác thực 4 số dạng hình (SVG) cho trang đăng nhập quản trị. Không lưu trạng thái: đáp án nằm trong mã ký (HMAC) hết hạn sau 5 phút,
// và mỗi mã chỉ dùng một lần (kể cả khi nhập sai) nên không thử đi thử lại trên cùng một hình được.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { sign, verify } from '../auth.js';

const used = new Map(); // nonce -> hết hạn (ms)
const mac = (nonce, code) => crypto.createHmac('sha256', config.secret).update(`captcha:${nonce}:${code}`).digest('hex');

function svgOf(code) {
  const r = (a, b) => a + Math.random() * (b - a);
  const colors = ['#1e3a8a', '#7c2d12', '#14532d', '#581c87', '#0f172a'];
  const digits = [...code].map((d, i) => {
    const x = 22 + i * 28 + r(-3, 3), y = 34 + r(-4, 4), rot = r(-22, 22), c = colors[Math.floor(Math.random() * colors.length)];
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${Math.round(r(26, 32))}" font-weight="700" font-family="Verdana,Arial,sans-serif" fill="${c}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${d}</text>`;
  }).join('');
  const lines = Array.from({ length: 6 }, () => `<path d="M${r(0, 150).toFixed(0)} ${r(0, 48).toFixed(0)} Q${r(0, 150).toFixed(0)} ${r(0, 48).toFixed(0)} ${r(0, 150).toFixed(0)} ${r(0, 48).toFixed(0)}" stroke="${colors[Math.floor(Math.random() * colors.length)]}" stroke-opacity=".35" stroke-width="1.2" fill="none"/>`).join('');
  const dots = Array.from({ length: 26 }, () => `<circle cx="${r(0, 150).toFixed(0)}" cy="${r(0, 48).toFixed(0)}" r="${r(0.6, 1.4).toFixed(1)}" fill="#475569" fill-opacity=".5"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 48" width="150" height="48"><rect width="150" height="48" rx="8" fill="#f1f5f9"/>${lines}${digits}${dots}</svg>`;
}

/** Tạo mã mới: { id (mã ký), svg }. Đáp án chỉ nằm trong `id` dưới dạng băm có khóa. */
export function newCaptcha() {
  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const n = crypto.randomBytes(9).toString('hex');
  return { id: sign({ kind: 'captcha', n, h: mac(n, code) }, 5 / 60), svg: svgOf(code) };
}

/** Kiểm tra đáp án. Mỗi mã chỉ được thử một lần. */
export function checkCaptcha(id, answer) {
  const now = Date.now();
  for (const [k, exp] of used) if (exp < now) used.delete(k);
  const p = verify(String(id || ''));
  if (!p || p.kind !== 'captcha' || used.has(p.n)) return false;
  used.set(p.n, now + 6 * 60_000);
  const code = String(answer ?? '').trim();
  if (!/^\d{4}$/.test(code)) return false;
  const a = Buffer.from(mac(p.n, code)), b = Buffer.from(p.h);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
