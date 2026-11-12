import { buildApp } from './app.js';
import { config } from './config.js';
import { retryPendingInvoices } from './services/invoice.js';
import { sweepStaleCarts } from './services/core.js';
import { runRetention } from './services/retention.js';
import { retryBillEmails } from './services/bill-email.js';

// TRUST_PROXY=1 khi chạy sau Nginx để ghi đúng địa chỉ IP khách trong nhật ký.
// Chỉ tin X-Forwarded-For do proxy NẰM TRONG danh sách này gửi tới (mặc định khi TRUST_PROXY=1: Nginx chạy cùng máy, địa chỉ loopback).
// Proxy ở máy khác: TRUST_PROXY=172.16.70.5 (nhiều địa chỉ ngăn bằng dấu phẩy). Không dùng `true` (tin mọi chặng) vì khách tự thêm X-Forwarded-For giả để đổi IP.
function trustedProxies() {
  const v = (process.env.TRUST_PROXY || '').trim();
  if (!v || v === '0') return false;
  if (v === '1' || v === 'true') return ['127.0.0.1', '::1'];
  return v.split(',').map((x) => x.trim()).filter(Boolean);
}
const app = buildApp({ logger: { level: process.env.LOG_LEVEL || 'info' }, trustProxy: trustedProxies() });
const { db, pos } = app.ctx;

// Công việc nền chỉ nên chạy ở MỘT tiến trình. RUN_JOBS=0 để tắt ở tiến trình phụ (nếu có).
let timers = [];
if (process.env.RUN_JOBS !== '0') {
  // Đồng bộ giá/tồn kho định kỳ từ Dsmart POS vào bộ nhớ đệm.
  const syncEvery = Number(process.env.POS_SYNC_SECONDS || 60) * 1000;
  const tick = () => { try { pos.syncAll(); } catch (e) { app.log.error(e, 'Đồng bộ Dsmart POS lỗi'); } };
  tick();
  timers.push(setInterval(tick, syncEvery));
  // Thử lại hóa đơn điện tử còn treo.
  timers.push(setInterval(() => retryPendingInvoices(db, app.ctx.invoicer).catch((e) => app.log.error(e)), 120_000));
  // Thử lại gửi bill qua email khi lần đầu lỗi.
  timers.push(setInterval(() => retryBillEmails(app.ctx).catch((e) => app.log.error(e)), 120_000));
  // Dọn giỏ bỏ quên mỗi phút: giỏ đã bấm Thanh toán quá LOCKED_TTL_MINUTES (mặc định 30) thì hủy đơn;
  // giỏ đang quét quá CART_TTL_HOURS (mặc định 3) không thao tác thì đóng.
  const sweep = () => { try { const n = sweepStaleCarts(app.ctx, { activeHours: Number(process.env.CART_TTL_HOURS || 3), lockedMinutes: Number(process.env.LOCKED_TTL_MINUTES || 30) }); if (n) app.log.info({ n }, 'Đã dọn giỏ bỏ quên'); } catch (e) { app.log.error(e); } };
  timers.push(setInterval(sweep, 60_000));
  // Giữ dữ liệu có thời hạn: xóa thông tin cá nhân và nhật ký quá hạn (cấu hình ở trang quản trị). Chạy lúc khởi động và mỗi 6 giờ.
  const retain = () => { try { const r = runRetention(app.ctx); const n = Object.values(r.done).reduce((a, b) => a + b, 0); if (n) app.log.info(r.done, 'Đã dọn dữ liệu quá hạn'); } catch (e) { app.log.error(e, 'Dọn dữ liệu quá hạn lỗi'); } };
  setTimeout(retain, 60_000).unref?.();
  timers.push(setInterval(retain, 6 * 3600_000));
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
