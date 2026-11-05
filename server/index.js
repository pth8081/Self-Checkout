import { buildApp } from './app.js';
import { config } from './config.js';
import { getSetting } from './db.js';

const app = buildApp({ logger: { level: 'info' } });
const { db, pos } = app.ctx;

// Đồng bộ giá/tồn kho định kỳ từ POS vào bộ nhớ đệm (mỗi 60 giây ở bản giả lập).
const syncEvery = Number(process.env.POS_SYNC_SECONDS || 60) * 1000;
const tick = () => { try { pos.syncAll(); } catch (e) { app.log.error(e, 'Đồng bộ POS lỗi'); } };
tick();
const timer = setInterval(tick, syncEvery);
timer.unref();

// Thử lại hoá đơn điện tử còn treo.
import('./services/invoice.js').then(({ retryPendingInvoices }) => {
  const t = setInterval(() => retryPendingInvoices(db, app.ctx.invoicer).catch((e) => app.log.error(e)), 120_000);
  t.unref();
});

const stores = db.prepare('SELECT COUNT(*) n FROM stores').get().n;
if (!stores) app.log.warn('Chưa có dữ liệu. Chạy "npm run seed" để tạo dữ liệu mẫu.');
void getSetting;

app.listen({ port: config.port, host: config.host }).catch((e) => { app.log.error(e); process.exit(1); });
