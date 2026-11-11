// Luồng phụ giữ MỘT kết nối tới SQL Server và chạy các câu lệnh do luồng chính gửi sang. Luồng chính chờ kết quả bằng
// Atomics.wait nên mã ứng dụng vẫn gọi CSDL theo kiểu đồng bộ như với SQLite (xem bridge.js).
import { workerData, parentPort } from 'node:worker_threads';
import sql from 'mssql';

const { cfg, sab, port } = workerData;
const flag = new Int32Array(sab);
let pool = null, connecting = null;

async function connect() {
  if (pool?.connected) return pool;
  if (connecting) return connecting;
  connecting = (async () => {
    try { if (pool) await pool.close().catch(() => {}); } catch { /* bỏ qua */ }
    const p = new sql.ConnectionPool({
      server: cfg.server, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database,
      pool: { min: 1, max: 1, idleTimeoutMillis: 2147483647 },
      requestTimeout: (cfg.requestTimeoutSec || 30) * 1000, connectionTimeout: (cfg.connectTimeoutSec || 15) * 1000,
      options: { encrypt: cfg.encrypt !== false, trustServerCertificate: !!cfg.trustServerCertificate, enableArithAbort: true, useUTC: true, appName: 'BRG Scan & Checkout' }
    });
    p.on('error', () => { pool = null; });
    pool = await p.connect();
    return pool;
  })().finally(() => { connecting = null; });
  return connecting;
}

const bind = (req, v, name) => {
  if (v === null || v === undefined) return req.input(name, sql.NVarChar(4000), null);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Giá trị số không hợp lệ');
    if (Number.isInteger(v)) return req.input(name, Math.abs(v) > 2147483647 ? sql.BigInt : sql.Int, v);
    return req.input(name, sql.Float, v);
  }
  if (typeof v === 'boolean') return req.input(name, sql.Int, v ? 1 : 0);
  if (typeof v === 'bigint') return req.input(name, sql.BigInt, v);
  if (v instanceof Uint8Array) return req.input(name, sql.VarBinary(sql.MAX), Buffer.from(v));
  const s = String(v);
  return req.input(name, s.length > 4000 ? sql.NVarChar(sql.MAX) : sql.NVarChar(Math.max(1, s.length)), s);
};

/** BIGINT/DECIMAL trả về dạng chuỗi: đổi thành số (số tiền VND nằm trong giới hạn an toàn của JavaScript). */
function fixRows(rs) {
  const cols = rs.columns || {};
  const conv = Object.keys(cols).filter((k) => { const t = cols[k].type; return t === sql.BigInt || t === sql.Decimal || t === sql.Numeric || t === sql.Money; });
  if (!conv.length) return rs;
  const out = Array.from(rs, (r) => { const o = { ...r }; for (const k of conv) if (o[k] !== null && o[k] !== undefined) o[k] = Number(o[k]); return o; });
  return out;
}

async function run(msg) {
  const p = await connect();
  const req = p.request();
  (msg.params || []).forEach((v, i) => bind(req, v, `p${i + 1}`));
  // Lô không tham số chạy bằng batch (BEGIN/COMMIT qua sp_executesql bị báo lỗi 266 về số lượng giao dịch)
  const r = (msg.params || []).length ? await req.query(msg.text) : await req.batch(msg.text);
  const sets = (r.recordsets || []).map((rs) => fixRows(rs));
  let lastId = null;
  if (msg.wantId) {
    const last = sets[sets.length - 1];
    if (last && last.length === 1 && Object.prototype.hasOwnProperty.call(last[0], '__id')) { lastId = last[0].__id === null ? null : Number(last[0].__id); sets.pop(); }
  }
  const rows = sets.length ? sets[0] : [];
  const changes = (r.rowsAffected || []).reduce((a, b) => a + b, 0);
  return { rows, changes, lastId };
}

parentPort.on('message', async (msg) => {
  let res;
  try { res = { ok: true, ...(await run(msg)) }; }
  catch (e) {
    if (['ECONNCLOSED', 'ESOCKET', 'ETIMEOUT', 'ECONNRESET'].includes(e.code)) pool = null;
    res = { ok: false, error: { message: e.message, code: e.code, number: e.number ?? e.originalError?.info?.number, state: e.state } };
  }
  port.postMessage(res);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
