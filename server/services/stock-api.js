// Đồng bộ tồn kho từ API tồn kho của đối tác: GET <url>?page=&pageSize=&fields=..., header X-API-Key.
// API trả tồn của TẤT CẢ siêu thị, có phân trang: gọi lặp tăng dần `page` cho tới khi số dòng ít hơn `pageSize`.
// Mỗi dòng ghép với chi nhánh BRG theo `maDiem` = mã điểm của chi nhánh. Kết quả lưu vào bảng stock_levels.
import { getSetting, setSetting } from '../db.js';
import { nowIso } from '../util.js';
import { encryptSecret, decryptSecret } from './mailer.js';

export const STOCK_KEY = 'stock_api';
export const STOCK_LAST_KEY = 'stock_api_last';
const FIELDS = 'maHang,maVach,tenHang,soLuongTon,maDiem,capNhatLuc';
const REQUIRED = ['maHang', 'soLuongTon', 'maDiem'];
const MAX_PAGES = 1000;

export function stockConfig(db) {
  const s = getSetting(db, STOCK_KEY, {});
  return { enabled: !!s.enabled, url: s.url || '', hasKey: !!s.keyEnc, pageSize: Number(s.pageSize) || 1000, intervalMin: Number(s.intervalMin) || 30, timeoutSec: Number(s.timeoutSec) || 30, pauseMs: s.pauseMs === undefined ? 300 : Number(s.pauseMs) };
}

export function saveStockConfig(db, b = {}) {
  const cur = getSetting(db, STOCK_KEY, {});
  const next = { ...cur };
  if (b.url !== undefined) {
    const url = String(b.url).trim();
    if (url) {
      let u; try { u = new URL(url); } catch { return { error: 'Địa chỉ API không hợp lệ' }; }
      const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
      if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return { error: 'Địa chỉ API phải bắt đầu bằng https://' };
      if (u.search) return { error: 'Chỉ nhập địa chỉ, không kèm ?page=... (hệ thống tự thêm)' };
    }
    next.url = url;
  }
  if (typeof b.key === 'string' && b.key.trim()) next.keyEnc = encryptSecret(b.key.trim());
  if (b.pageSize !== undefined) { const v = Number(b.pageSize); if (!Number.isInteger(v) || v < 50 || v > 1000) return { error: 'Số dòng mỗi trang từ 50 đến 1000' }; next.pageSize = v; }
  if (b.intervalMin !== undefined) { const v = Number(b.intervalMin); if (!Number.isInteger(v) || v < 15 || v > 1440) return { error: 'Chu kỳ đồng bộ từ 15 đến 1440 phút (dữ liệu đối tác cập nhật mỗi 15 phút)' }; next.intervalMin = v; }
  if (b.pauseMs !== undefined) { const v = Number(b.pauseMs); if (!Number.isInteger(v) || v < 0 || v > 10000) return { error: 'Thời gian nghỉ giữa các trang từ 0 đến 10000 mili giây' }; next.pauseMs = v; }
  if (b.timeoutSec !== undefined) { const v = Number(b.timeoutSec); if (!(v >= 5 && v <= 120)) return { error: 'Thời gian chờ mỗi trang từ 5 đến 120 giây' }; next.timeoutSec = v; }
  if (b.enabled !== undefined) {
    if (b.enabled && (!next.url || !next.keyEnc)) return { error: 'Cần nhập địa chỉ API và khóa API trước khi bật' };
    next.enabled = !!b.enabled;
  }
  setSetting(db, STOCK_KEY, next);
  return { config: stockConfig(db) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yieldLoop = () => new Promise((r) => setImmediate(r));

/** Gọi một trang. Trả { rows, columns } hoặc ném lỗi có `.message` tiếng Việt. */
async function fetchPage(cfg, key, page, pageSize, fetchImpl, fields = FIELDS) {
  const url = new URL(cfg.url);
  url.searchParams.set('page', String(page)); url.searchParams.set('pageSize', String(pageSize));
  if (fields) url.searchParams.set('fields', fields);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), cfg.timeoutSec * 1000);
  try {
    const r = await fetchImpl(url, { headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) {
      const body = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
      const detail = body ? ` Đối tác trả: ${body}` : '';
      const msg = r.status === 401 ? 'API tồn kho từ chối khóa (401): khóa sai, bị thu hồi, hoặc đã vượt giới hạn số lần gọi mỗi phút.'
        : r.status === 403 ? 'API tồn kho từ chối (403): địa chỉ IP của máy chủ BRG chưa được đối tác đăng ký, hoặc khóa chưa có quyền báo cáo tồn kho.'
        : r.status === 400 ? 'API tồn kho báo tham số sai (400), có thể tên cột trong fields không đúng.'
        : r.status === 429 ? 'API tồn kho báo gọi quá nhiều (429).'
        : `API tồn kho lỗi HTTP ${r.status}.`;
      const e = new Error(msg + detail); e.status = r.status; e.retryAfter = r.status === 429 ? (Number(r.headers.get('retry-after')) || 0) : undefined;
      throw e;
    }
    const j = await r.json();
    if (!j || !Array.isArray(j.rows)) throw new Error('API tồn kho trả dữ liệu không đúng dạng (thiếu rows)');
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`API tồn kho không trả lời trong ${cfg.timeoutSec} giây`);
    if (e.message && /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(`${e.message} ${e.cause?.code || ''}`)) throw new Error(`Không kết nối được API tồn kho (${e.cause?.code || e.message})`);
    throw e;
  } finally { clearTimeout(t); }
}

const qtyOf = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; };

/** Kiểm tra kết nối: lấy vài dòng đầu, báo thiếu cột, và ghép mã điểm với chi nhánh. Không ghi dữ liệu. */
export async function testStockApi(db, fetchImpl = fetch) {
  const s = getSetting(db, STOCK_KEY, {}); const cfg = stockConfig(db);
  if (!s.url || !s.keyEnc) return { ok: false, message: 'Chưa nhập địa chỉ API và khóa API' };
  const t0 = Date.now();
  try {
    const j = await fetchPage(cfg, decryptSecret(s.keyEnc), 1, 5, fetchImpl, null);
    const have = new Set((j.columns || []).map((c) => c.key));
    const first = j.rows[0] || {};
    const missing = REQUIRED.filter((k) => !(have.has(k) || k in first));
    const stores = new Map(db.prepare('SELECT id, name, pos_code FROM stores WHERE pos_code <> \'\'').all().map((x) => [x.pos_code.toLowerCase(), x]));
    return { ok: !missing.length, ms: Date.now() - t0, columns: [...have], missing, sample: j.rows.slice(0, 5).map((r) => ({ maHang: r.maHang, maVach: r.maVach ?? null, tenHang: r.tenHang, soLuongTon: r.soLuongTon, maDiem: r.maDiem, tenSieuThi: r.tenSieuThi, store: stores.get(String(r.maDiem).toLowerCase())?.name || null })),
      message: missing.length ? `Thiếu cột bắt buộc: ${missing.join(', ')}` : 'Kết nối được, dữ liệu đúng dạng' };
  } catch (e) { return { ok: false, ms: Date.now() - t0, message: e.message }; }
}

let running = false;
export const isStockSyncing = () => running;

/**
 * Đồng bộ toàn bộ tồn kho. Chỉ ghi dòng thay đổi (đọc tồn hiện có của từng chi nhánh rồi so), ghi theo từng trang và nhường vòng lặp giữa các trang
 * để không làm đứng ứng dụng. Thành công thì xóa dòng cũ không còn trong dữ liệu đối tác (của các chi nhánh có trong lần này).
 */
export async function runStockSync(ctx, { fetchImpl = fetch, trigger = 'manual', sleepImpl = sleep } = {}) {
  const { db } = ctx;
  if (running) return { ok: false, busy: true, message: 'Đang đồng bộ, chờ lần này xong' };
  const s = getSetting(db, STOCK_KEY, {}); const cfg = stockConfig(db);
  if (!s.url || !s.keyEnc) return { ok: false, message: 'Chưa nhập địa chỉ API và khóa API' };
  running = true;
  const startedAt = nowIso(); const t0 = Date.now();
  const res = { startedAt, trigger, ok: false, pages: 0, rows: 0, matched: 0, unmatched: 0, unmatchedCodes: [], written: 0, unchanged: 0, removed: 0, stores: 0, sourceAt: null, error: null };
  const stores0 = new Map(db.prepare("SELECT id, pos_code FROM stores WHERE pos_code <> ''").all().map((x) => [x.pos_code.toLowerCase(), x.id]));
  const unmatched = new Set();
  const codeCount = new Map(); // maDiem -> số dòng (để biết đối tác trả những mã điểm nào)
  try {
    const key = decryptSecret(s.keyEnc);
    const stores = new Map(db.prepare("SELECT id, pos_code FROM stores WHERE pos_code <> ''").all().map((x) => [x.pos_code.toLowerCase(), x.id]));
    const existing = new Map(); // storeId -> Map(sku -> {qty, barcode})
    const loadStore = (id) => { if (!existing.has(id)) existing.set(id, new Map(db.prepare('SELECT sku, qty, barcode, name FROM stock_levels WHERE store_id = ?').all(id).map((r) => [r.sku, r]))); return existing.get(id); };
    const seen = new Map(); // storeId -> Set(sku)
    const upd = db.prepare('UPDATE stock_levels SET barcode = ?, name = ?, qty = ?, source_at = ?, synced_at = ? WHERE store_id = ? AND sku = ?');
    const ins = db.prepare('INSERT INTO stock_levels(store_id,sku,barcode,name,qty,source_at,synced_at) VALUES(?,?,?,?,?,?,?)');
    for (let page = 1; page <= MAX_PAGES; page++) {
      let j;
      for (let attempt = 0; ; attempt++) {
        try { j = await fetchPage(cfg, key, page, cfg.pageSize, fetchImpl); break; }
        catch (e) {
          // 429, hoặc 401/5xx giữa chừng (sau khi các trang trước đã được nhận: nhiều khả năng vượt giới hạn tần suất hay lỗi tạm): chờ rồi thử lại
          const transient = e.status === 429 || (e.status === 401 && page > 1) || (e.status >= 500 && e.status < 600);
          if (transient && attempt < 3) { await sleepImpl((e.retryAfter ? Math.min(60, Math.max(1, e.retryAfter)) : e.status === 401 ? 20 : 3) * 1000); continue; }
          e.page = page; throw e;
        }
      }
      if (cfg.pauseMs && page > 1) await sleepImpl(cfg.pauseMs);
      if (page === 1 && j.rows.length) { const miss = REQUIRED.filter((k) => !(k in j.rows[0])); if (miss.length) throw new Error(`Dữ liệu thiếu cột bắt buộc: ${miss.join(', ')}`); }
      res.pages = page; res.rows += j.rows.length;
      const ts = nowIso();
      db.transaction(() => {
        for (const r of j.rows) {
          const code = String(r.maDiem ?? '');
          if (codeCount.size < 500 || codeCount.has(code)) codeCount.set(code, (codeCount.get(code) || 0) + 1);
          const sid = stores.get(code.toLowerCase());
          const sku = String(r.maHang ?? '');
          const qty = qtyOf(r.soLuongTon);
          if (!sid) { unmatched.add(String(r.maDiem ?? '')); res.unmatched++; continue; }
          if (!sku || qty === null) continue;
          res.matched++;
          const cur = loadStore(sid); const was = cur.get(sku);
          if (!seen.has(sid)) seen.set(sid, new Set()); seen.get(sid).add(sku);
          if (r.capNhatLuc && (!res.sourceAt || String(r.capNhatLuc) > res.sourceAt)) res.sourceAt = String(r.capNhatLuc);
          const barcode = r.maVach ? String(r.maVach) : null, name = r.tenHang ? String(r.tenHang).slice(0, 200) : null;
          if (!was) { ins.run(sid, sku, barcode, name, qty, r.capNhatLuc || null, ts); res.written++; }
          else if (was.qty !== qty || (was.barcode || null) !== barcode || (was.name || null) !== name) { upd.run(barcode, name, qty, r.capNhatLuc || null, ts, sid, sku); res.written++; }
          else res.unchanged++;
        }
      })();
      await yieldLoop();
      if (j.rows.length < cfg.pageSize) break;
      if (page === MAX_PAGES) throw new Error('Quá nhiều trang (hơn 1.000), dừng để tránh vòng lặp vô hạn');
    }
    // Hoàn tất toàn bộ các trang: bỏ dòng không còn trong dữ liệu đối tác (chỉ ở chi nhánh có xuất hiện lần này).
    res.stores = seen.size;
    const del = db.prepare('DELETE FROM stock_levels WHERE store_id = ? AND sku = ?');
    db.transaction(() => { for (const [sid, ids] of seen) for (const sku of existing.get(sid).keys()) if (!ids.has(sku)) { del.run(sid, sku); res.removed++; } })();
    res.ok = true;
  } catch (e) { res.error = (e.page ? `Trang ${e.page}: ` : '') + (e.message || String(e)); res.failedPage = e.page || null; res.httpStatus = e.status || null; }
  finally { running = false; }
  res.unmatchedCodes = [...unmatched].slice(0, 30);
  res.seenCodes = codeCount.size;
  res.topCodes = [...codeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([code, n]) => ({ code, rows: n, matched: stores0.has(code.toLowerCase()) }));
  res.ms = Date.now() - t0; res.finishedAt = nowIso();
  setSetting(db, STOCK_LAST_KEY, res);
  if (!res.ok) ctx.stockError = { at: res.finishedAt, message: res.error };
  else ctx.stockError = null;
  return res;
}

/** Gọi định kỳ (mỗi phút): đến chu kỳ cấu hình thì đồng bộ. */
export async function runStockSyncIfDue(ctx, opts = {}) {
  const c = stockConfig(ctx.db);
  if (!c.enabled || running) return null;
  const last = getSetting(ctx.db, STOCK_LAST_KEY, null);
  if (last?.startedAt && Date.now() - Date.parse(last.startedAt) < c.intervalMin * 60_000 && !(last.ok === false && Date.now() - Date.parse(last.startedAt) > 5 * 60_000)) return null;
  return runStockSync(ctx, { ...opts, trigger: 'auto' });
}

/** Tình trạng đồng bộ: lần chạy gần nhất, và từng chi nhánh có bao nhiêu mã hàng có tồn, số liệu đối tác chốt lúc nào. */
export function stockStatus(db) {
  const rows = db.prepare(`SELECT s.id, s.name, s.pos_code, COUNT(l.sku) items, MAX(l.source_at) source_at, MAX(l.synced_at) synced_at,
    SUM(CASE WHEN l.qty <= 0 THEN 1 ELSE 0 END) out_of_stock FROM stores s LEFT JOIN stock_levels l ON l.store_id = s.id GROUP BY s.id, s.name, s.pos_code ORDER BY s.id`).all();
  return { last: getSetting(db, STOCK_LAST_KEY, null), syncing: running,
    stores: rows.map((r) => ({ id: r.id, name: r.name, posCode: r.pos_code || '', items: Number(r.items) || 0, outOfStock: Number(r.out_of_stock) || 0, sourceAt: r.source_at || null, syncedAt: r.items ? (getSetting(db, STOCK_LAST_KEY, null)?.finishedAt || r.synced_at || null) : null })) };
}

/** Tra tồn của một mã hàng hoặc mã vạch ở mọi chi nhánh (để đối chiếu với đối tác). */
export function lookupStock(db, q) {
  const k = String(q || '').trim();
  if (!k) return [];
  return db.prepare(`SELECT l.store_id storeId, s.name storeName, s.pos_code posCode, l.sku, l.barcode, l.name, l.qty, l.source_at sourceAt, l.synced_at syncedAt
    FROM stock_levels l JOIN stores s ON s.id = l.store_id WHERE l.sku = ? OR l.barcode = ? ORDER BY l.store_id`).all(k, k);
}

/** Tồn kho dùng khi quét: ưu tiên số đồng bộ từ đối tác, không có thì giữ giá trị trong bộ nhớ giá. */
export function stockOf(db, storeId, p) {
  const r = db.prepare('SELECT qty FROM stock_levels WHERE store_id = ? AND sku = ?').get(storeId, p.sku);
  return r ? r.qty : p.stock;
}
