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

/** Dựng ứng dụng. Tham số cho phép thay CSDL, RNG, adapter khi kiểm thử. */
export function buildApp({ dbFile = config.dbFile, rng = Math.random, logger = false, pos, invoicer, trustProxy = false } = {}) {
  const db = openDb(dbFile);
  const ctx = { db, rng };
  ctx.pos = pos || createMockPos(db);
  ctx.invoicer = invoicer || createMockInvoicer(db);

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
    return reply.code(500).send({ error: 'SERVER_ERROR', message: 'Có lỗi hệ thống, vui lòng thử lại' });
  });

  app.register(customerRoutes, { prefix: '/api/c' });
  app.register(staffRoutes, { prefix: '/api/s' });
  app.register(adminRoutes, { prefix: '/api/a' });
  // Kiểm tra tình trạng cho giám sát và reverse proxy: 200 khi máy chủ và CSDL đều ổn.
  app.get('/api/health', async (req, reply) => {
    try { db.prepare('SELECT 1').get(); return { ok: true, uptime: Math.round(process.uptime()) }; }
    catch { return reply.code(503).send({ ok: false }); }
  });

  app.register(fastifyStatic, { root: config.publicDir, prefix: '/', index: ['index.html'], wildcard: false, decorateReply: false,
    setHeaders(res, p) {
      // Service worker phải luôn tải mới để cập nhật được.
      if (p.endsWith('sw.js')) res.header('Cache-Control', 'no-cache');
    } });
  app.addHook('onClose', async () => db.close());
  return app;
}
