import { buildApp } from './app.js';
import { config } from './config.js';
import { retryPendingInvoices } from './services/invoice.js';
import { sweepStaleCarts } from './services/core.js';
import { retryBillEmails } from './services/bill-email.js';

// TRUST_PROXY=1 khi chạy sau Nginx để ghi đúng địa chỉ IP khách trong nhật ký.
const app = buildApp({ logger: { level: process.env.LOG_LEVEL || 'info' }, trustProxy: process.env.TRUST_PROXY === '1' });
const { db, pos } = app.ctx;

// Công việc nền chỉ nên chạy ở MỘT tiến trình. RUN_JOBS=0 để tắt ở tiến trình phụ (nếu có).
let timers = [];
if (process.env.RUN_JOBS !== '0') {
  // Đồng bộ giá/tồn kho định kỳ từ Dsmart POS vào bộ nhớ đệm.
  const syncEvery = Number(process.env.POS_SYNC_SECONDS || 60) * 1000;
  const tick = () => { try { pos.syncAll(); } catch (e) { app.log.error(e, 'Đồng bộ Dsmart POS lỗi'); } };
  tick();
  timers.push(setInterval(tick, syncEvery));
  // Thử lại hoá đơn điện tử còn treo.
  timers.push(setInterval(() => retryPendingInvoices(db, app.ctx.invoicer).catch((e) => app.log.error(e)), 120_000));
  // Thử lại gửi bill qua email khi lần đầu lỗi.
  timers.push(setInterval(() => retryBillEmails(app.ctx).catch((e) => app.log.error(e)), 120_000));
  // Dọn giỏ bị bỏ quên mỗi giờ.
  const sweep = () => { try { const n = sweepStaleCarts(app.ctx, Number(process.env.CART_TTL_HOURS || 12)); if (n) app.log.info({ n }, 'Đã dọn giỏ bỏ quên'); } catch (e) { app.log.error(e); } };
  timers.push(setInterval(sweep, 3600_000));
} else app.log.info('RUN_JOBS=0: tiến trình này không chạy công việc nền');

if (!db.prepare('SELECT COUNT(*) n FROM stores').get().n) {
  app.log.warn('Chưa có dữ liệu. Tạo quản trị đầu tiên bằng "npm run create-admin" rồi thêm chi nhánh trong web quản trị.');
}

// Tắt gọn: ngừng nhận yêu cầu mới, đợi yêu cầu đang chạy xong, đóng CSDL rồi thoát.
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Đang tắt máy chủ');
  timers.forEach(clearInterval);
  const force = setTimeout(() => { app.log.error('Quá thời gian chờ, thoát ngay'); process.exit(1); }, 8000);
  force.unref();
  try { await app.close(); process.exit(0); } catch (e) { app.log.error(e); process.exit(1); }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.listen({ port: config.port, host: config.host }).catch((e) => { app.log.error(e); process.exit(1); });
