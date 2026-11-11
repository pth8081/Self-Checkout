import { createMailer } from './services/mailer.js';
import { appVersion } from './version.js';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { openDb } from './db.js';
import { HttpError } from './util.js';
import { createMockPos } from './services/pos.js';
import { createMockInvoicer } from './services/invoice.js';
import customerRoutes from './routes/customer.js';
import staffRoutes from './routes/staff.js';
import adminRoutes from './routes/admin.js';
import posRoutes from './routes/pos.js';

/** Dựng ứng dụng. Tham số cho phép thay CSDL, RNG, adapter khi kiểm thử. */
export function buildApp({ dbFile = config.db, rng = Math.random, logger = false, pos, invoicer, mailer, trustProxy = false } = {}) {
  const db = openDb(dbFile);
  // Dọn cấu hình của tính năng đồng bộ tồn kho đã gỡ (có thể còn khóa API đã mã hóa trong bảng cấu hình của bản 2.1 đến 2.9).
  try { db.prepare("DELETE FROM settings WHERE key IN ('stock_api', 'stock_api_last')").run(); } catch { /* bỏ qua */ }
  const ctx = { db, rng };
  ctx.pos = pos || createMockPos(db);
  ctx.invoicer = invoicer || createMockInvoicer(db);
  ctx.mailer = mailer || createMailer(db);
  ctx.bg = new Set(); // việc nền đang chạy (gửi email), để tắt máy chủ hoặc kiểm thử đợi cho xong

  const app = Fastify({ logger, bodyLimit: 1_000_000, trustProxy });
  app.decorate('ctx', ctx);

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra });
    if (err.validation || err.statusCode === 400) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Dữ liệu gửi lên không hợp lệ' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'ERROR', message: err.message });
    req.log.error(err);
    if (process.env.BRG_DEBUG) console.error('[BRG_DEBUG]', req.method, req.url, err?.message);
    return reply.code(500).send({ error: 'SERVER_ERROR', message: 'Có lỗi hệ thống, vui lòng thử lại' });
  });

  app.register(customerRoutes, { prefix: '/api/c' });
  app.register(staffRoutes, { prefix: '/api/s' });
  app.register(adminRoutes, { prefix: '/api/a' });
  app.register(posRoutes, { prefix: '/api/pos' });
  // Kiểm tra tình trạng cho giám sát và reverse proxy: 200 khi máy chủ và CSDL đều ổn.
  app.get('/api/health', async (req, reply) => {
    try { db.prepare('SELECT 1').get(); return { ok: true, version: appVersion(), db: db.kind || 'sqlite', uptime: Math.round(process.uptime()) }; }
    catch { return reply.code(503).send({ ok: false }); }
  });

  app.register(fastifyStatic, { root: config.publicDir, prefix: '/', index: ['index.html'], wildcard: false, decorateReply: false,
    setHeaders(res, p) {
      // Service worker phải luôn tải mới để cập nhật được.
      if (p.endsWith('sw.js')) res.header('Cache-Control', 'no-cache');
    } });
  app.addHook('onClose', async () => { await Promise.allSettled([...ctx.bg]); db.close(); });
  return app;
}
