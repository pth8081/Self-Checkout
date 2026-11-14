// Giới hạn tốc độ trong ứng dụng (không cần thư viện ngoài), tính theo địa chỉ IP (req.ip, đã xử lý TRUST_PROXY).
// Đếm trong bộ nhớ của tiến trình (ứng dụng chạy một tiến trình). Vượt giới hạn trả 429 kèm Retry-After.
export function createLimiter() {
  const buckets = new Map(); // khóa -> { n, reset }
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k); }, 60_000);
  sweep.unref?.();
  return {
    /** Ghi một lượt; trả { ok, retryAfter (giây) }. */
    hit(key, limit, windowMs) {
      const now = Date.now();
      let b = buckets.get(key);
      if (!b || b.reset <= now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
      b.n += 1;
      return { ok: b.n <= limit, retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000)) };
    },
    /** Đếm số lượt hiện tại mà không ghi thêm. */
    peek(key) { const b = buckets.get(key); return b && b.reset > Date.now() ? b.n : 0; },
    clear() { buckets.clear(); },
    get size() { return buckets.size; }
  };
}

const MIN = 60_000, HOUR = 3_600_000;
// Đường dẫn quan trọng nhất: đăng nhập (dò mật khẩu, PIN, mã 2 bước, passkey), mã hình, mã xác nhận email, gửi bill qua email, tạo giỏ/khóa giỏ.
export const DEFAULT_RULES = [
  { name: 'login', test: (r, p) => r.method === 'POST' && /^\/api\/(a|s)\/login(\/|$)/.test(p), limit: 20, windowMs: MIN },
  { name: 'captcha', test: (r, p) => r.method === 'GET' && p === '/api/a/captcha', limit: 60, windowMs: MIN },
  { name: 'identity-request', test: (r, p) => r.method === 'POST' && p === '/api/c/identity/request', limit: 5, windowMs: HOUR },
  { name: 'identity-verify', test: (r, p) => r.method === 'POST' && p === '/api/c/identity/verify', limit: 20, windowMs: HOUR },
  { name: 'bill-email', test: (r, p) => r.method === 'POST' && /^\/api\/c\/transactions\/[^/]+\/bill-email$/.test(p), limit: 10, windowMs: HOUR },
  { name: 'basket', test: (r, p) => r.method === 'POST' && /^\/api\/c\/sessions\/[^/]+\/(basket|lock)$/.test(p), limit: 60, windowMs: MIN },
  { name: 'session-new', test: (r, p) => r.method === 'POST' && p === '/api/c/sessions', limit: 120, windowMs: MIN },
  { name: 'lookup', test: (r, p) => r.method === 'GET' && p === '/api/c/products/lookup', limit: 240, windowMs: MIN },
  { name: 'customer', test: (r, p) => p.startsWith('/api/c/'), limit: 1500, windowMs: MIN }, // nhiều khách dùng chung một IP (Wi-Fi cửa hàng, mạng di động)
  { name: 'pos', test: (r, p) => p.startsWith('/api/pos/'), limit: 3000, windowMs: MIN }
];

export function registerRateLimit(app, limiter, rules = DEFAULT_RULES) {
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    for (const rule of rules) {
      if (!rule.test(req, path)) continue;
      const r = limiter.hit(`${rule.name}|${req.ip}`, rule.limit, rule.windowMs);
      if (!r.ok) {
        reply.code(429).header('Retry-After', String(r.retryAfter)).send({ error: 'RATE_LIMITED', message: `Thao tác quá nhiều lần, hãy thử lại sau ${r.retryAfter > 90 ? Math.ceil(r.retryAfter / 60) + ' phút' : r.retryAfter + ' giây'}` });
        return reply;
      }
    }
  });
}
