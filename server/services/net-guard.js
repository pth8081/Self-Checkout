// Chống SSRF cho mọi kết nối RA NGOÀI theo địa chỉ do quản trị cấu hình (API giá, SMTP): chặn địa chỉ nội bộ nguy hiểm, kiểm tra địa chỉ THẬT
// lúc kết nối (chống DNS rebinding), không theo chuyển hướng, giới hạn kích thước phản hồi, không trả chi tiết lỗi nội bộ.
//
// Mặc định luôn chặn: loopback (127.0.0.0/8, ::1), link-local (169.254.0.0/16 gồm dịch vụ metadata đám mây, fe80::/10), 0.0.0.0, multicast, 100.64.0.0/10 (CGNAT).
// Mạng riêng (10/8, 172.16/12, 192.168/16, fc00::/7) mặc định CHO PHÉP vì máy chủ SMTP/API nội bộ là dùng hợp lệ; đặt OUTBOUND_BLOCK_PRIVATE=1 để chặn luôn.
// OUTBOUND_ALLOWED_HOSTS=api.hcrc.vn,smtp.congty.vn (nếu đặt) chỉ cho phép đúng các tên máy chủ đó.
// Chế độ phát triển/kiểm thử (BRG_DEV=1, node --test) cho phép loopback để thử với máy chủ giả.
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { config } from '../config.js';

export class NetBlocked extends Error { constructor(msg, code = 'NET_BLOCKED') { super(msg); this.code = code; } }

const opts = () => ({
  allowLoopback: config.devMode,
  blockPrivate: process.env.OUTBOUND_BLOCK_PRIVATE === '1',
  allowed: (process.env.OUTBOUND_ALLOWED_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
});

const v4 = (ip) => ip.split('.').map(Number);
/** Phân loại địa chỉ IP: 'loopback' | 'linklocal' | 'unspecified' | 'multicast' | 'cgnat' | 'private' | 'public'. */
export function ipKind(ip) {
  let a = String(ip).toLowerCase();
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a); // IPv4 nhúng trong IPv6
  if (m) a = m[1];
  if (net.isIPv4(a)) {
    const [p, q] = v4(a);
    if (p === 127) return 'loopback';
    if (p === 0) return 'unspecified';
    if (p === 169 && q === 254) return 'linklocal';
    if (p >= 224) return 'multicast';
    if (p === 100 && q >= 64 && q <= 127) return 'cgnat';
    if (p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168)) return 'private';
    return 'public';
  }
  if (net.isIPv6(a)) {
    if (a === '::1') return 'loopback';
    if (a === '::') return 'unspecified';
    if (/^fe[89ab]/.test(a)) return 'linklocal';
    if (a.startsWith('ff')) return 'multicast';
    if (/^f[cd]/.test(a)) return 'private';
    return 'public';
  }
  return 'public';
}

/** Ném NetBlocked nếu địa chỉ IP không được phép. */
export function assertIpAllowed(ip) {
  const o = opts(); const k = ipKind(ip);
  if (k === 'public') return;
  if (k === 'loopback' && o.allowLoopback) return;
  if (k === 'private' && !o.blockPrivate) return;
  throw new NetBlocked('Địa chỉ máy chủ này không được phép (địa chỉ nội bộ hoặc đặc biệt)');
}

/** Kiểm tra tên máy chủ trước khi dùng (không cần DNS): đúng danh sách cho phép (nếu có), không phải IP bị chặn, không phải "localhost". */
export function assertHostAllowed(host) {
  const o = opts(); const h = String(host || '').toLowerCase();
  if (!h) throw new NetBlocked('Thiếu tên máy chủ');
  if (o.allowed.length && !o.allowed.includes(h)) throw new NetBlocked('Máy chủ này chưa nằm trong danh sách cho phép (OUTBOUND_ALLOWED_HOSTS)');
  if (net.isIP(h)) { assertIpAllowed(h); return; }
  if (!o.allowLoopback && (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') && false)) throw new NetBlocked('Không dùng localhost');
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) throw new NetBlocked('Địa chỉ máy chủ không hợp lệ'); // dạng số thập phân/hex của IP
}

/** `lookup` cho http(s).request / net.connect: phân giải rồi kiểm tra TỪNG địa chỉ trả về ngay lúc kết nối (chống DNS rebinding). */
export function guardedLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    try { for (const a of addrs) assertIpAllowed(a.address); } catch (e) { return cb(e); }
    if (options?.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

/** Phân giải trước và trả về MỘT địa chỉ đã được kiểm tra (dùng cho thư viện không cho gắn lookup, như nodemailer). */
export async function resolveAllowed(host) {
  assertHostAllowed(host);
  if (net.isIP(host)) return host;
  const addrs = await new Promise((res, rej) => dns.lookup(host, { all: true }, (e, a) => (e ? rej(e) : res(a))));
  for (const a of addrs) assertIpAllowed(a.address);
  return addrs[0].address;
}

/**
 * Gọi HTTP(S) an toàn, giao diện giống fetch cho phần dùng (status, ok, headers.get, json, text).
 * Không theo chuyển hướng (3xx trả về nguyên, bên gọi coi là lỗi), kiểm tra địa chỉ lúc kết nối, giới hạn kích thước phản hồi.
 */
export function safeFetch(url, { headers = {}, signal, maxBytes = 1_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); assertHostAllowed(u.hostname.replace(/^\[|\]$/g, '')); } catch (e) { return reject(e); }
    if (!['https:', 'http:'].includes(u.protocol)) return reject(new NetBlocked('Chỉ hỗ trợ http và https'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', headers, lookup: guardedLookup, agent: false }, (res) => {
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > maxBytes) { req.destroy(Object.assign(new Error('Phản hồi quá lớn'), { code: 'TOO_BIG' })); return; } chunks.push(c); });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, headers: { get: (k) => res.headers[String(k).toLowerCase()] ?? null },
          text: async () => body, json: async () => JSON.parse(body) });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (signal) { if (signal.aborted) req.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' })); else signal.addEventListener('abort', () => req.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }); }
    req.end();
  });
}
