// Tra giá bán theo mã vạch từ API giá của đối tác (BRGMART): GET <url>?maVach=<mã vạch>&maDiem=<mã điểm>, header X-API-Key.
// Kết quả được lưu vào product_cache (giữ vài phút) để nhiều khách cùng quét một mặt hàng chỉ gọi API một lần.
import { getSetting, setSetting } from '../db.js';
import { nowIso } from '../util.js';
import { encryptSecret, decryptSecret } from './mailer.js';
import { safeFetch, assertHostAllowed, NetBlocked } from './net-guard.js';

export const PRICE_KEY = 'price_api';
export const PRICE_DEFAULTS = { enabled: false, url: '', timeoutSec: 3, cacheMin: 5 };

export function priceConfig(db) {
  const s = getSetting(db, PRICE_KEY, {});
  return { enabled: !!s.enabled, url: s.url || '', hasKey: !!s.keyEnc, timeoutSec: Number(s.timeoutSec) || PRICE_DEFAULTS.timeoutSec, cacheMin: Number(s.cacheMin) || PRICE_DEFAULTS.cacheMin };
}

/** Kiểm tra và lưu cấu hình. Khóa API chỉ ghi khi gửi giá trị mới (bỏ trống thì giữ khóa cũ). */
export function savePriceConfig(db, b = {}) {
  const cur = getSetting(db, PRICE_KEY, {});
  const next = { ...cur };
  if (b.url !== undefined) {
    const url = String(b.url).trim();
    if (url) {
      let u; try { u = new URL(url); } catch { return { error: 'Địa chỉ API không hợp lệ' }; }
      const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
      if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return { error: 'Địa chỉ API phải bắt đầu bằng https://' };
      if (u.search) return { error: 'Chỉ nhập địa chỉ, không kèm ?maVach=... (hệ thống tự thêm)' };
      if (u.username || u.password) return { error: 'Địa chỉ không được chứa tên đăng nhập hoặc mật khẩu' };
      try { assertHostAllowed(u.hostname.replace(/^\[|\]$/g, '')); } catch (e) { return { error: e.message }; }
    }
    next.url = url;
  }
  if (typeof b.key === 'string' && b.key.trim()) next.keyEnc = encryptSecret(b.key.trim());
  if (b.timeoutSec !== undefined) { const v = Number(b.timeoutSec); if (!(v >= 1 && v <= 15)) return { error: 'Thời gian chờ từ 1 đến 15 giây' }; next.timeoutSec = v; }
  if (b.cacheMin !== undefined) { const v = Number(b.cacheMin); if (!(v >= 1 && v <= 60)) return { error: 'Thời gian giữ giá từ 1 đến 60 phút' }; next.cacheMin = v; }
  if (b.enabled !== undefined) {
    if (b.enabled && (!next.url || !next.keyEnc)) return { error: 'Cần nhập địa chỉ API và khóa API trước khi bật' };
    next.enabled = !!b.enabled;
  }
  setSetting(db, PRICE_KEY, next);
  return { config: priceConfig(db) };
}

const inflight = new Map();   // store|mã vạch -> Promise (gộp các lần quét cùng lúc)
const negative = new Map();   // store|mã vạch -> hết hạn (nhớ ngắn kết quả 404 để không gọi dồn)
const NEG_MS = 60_000;

const int = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : NaN));

/** Gọi API một lần. Trả { status: 'ok', row } | { status: 'notfound' } | { status: 'error', code, message }. */
export async function callPriceApi(db, maDiem, maVach, fetchImpl = safeFetch) {
  const s = getSetting(db, PRICE_KEY, {});
  const c = priceConfig(db);
  if (!s.url || !s.keyEnc) return { status: 'error', code: 'NOT_CONFIGURED', message: 'Chưa cấu hình API giá' };
  const url = new URL(s.url); url.searchParams.set('maVach', maVach); url.searchParams.set('maDiem', maDiem);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), c.timeoutSec * 1000);
  try {
    const r = await fetchImpl(url, { headers: { 'X-API-Key': decryptSecret(s.keyEnc), Accept: 'application/json' }, signal: ctl.signal });
    if (r.status >= 300 && r.status < 400) return { status: 'error', code: 'REDIRECT', message: 'API giá trả chuyển hướng, không được theo (hãy nhập đúng địa chỉ cuối cùng)' };
    if (r.status === 404) return { status: 'notfound' };
    if (r.status === 401 || r.status === 403) return { status: 'error', code: 'AUTH', message: `API giá từ chối khóa (HTTP ${r.status})` };
    if (r.status === 429) return { status: 'error', code: 'RATE', message: 'API giá báo gọi quá nhiều (429)' };
    if (!r.ok) return { status: 'error', code: 'HTTP', message: `API giá lỗi HTTP ${r.status}` };
    const j = await r.json();
    const thuong = int(j.giaThuong), km = int(j.giaKhuyenMai);
    if (j.maHang == null || thuong == null || Number.isNaN(thuong) || Number.isNaN(km)) return { status: 'error', code: 'BAD_DATA', message: 'API giá trả dữ liệu không đúng dạng' };
    const promo = j.coKhuyenMai === true && km != null;
    return { status: 'ok', row: { sku: String(j.maHang), barcode: String(j.maVach || maVach), name: String(j.tenHang || maVach).slice(0, 200), price: promo ? km : thuong, list_price: thuong, updatedAt: j.capNhatLuc || null } };
  } catch (e) {
    if (e instanceof NetBlocked) return { status: 'error', code: 'BLOCKED', message: e.message };
    return { status: 'error', code: e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', message: e.name === 'AbortError' ? `API giá không trả lời trong ${c.timeoutSec} giây` : 'Không kết nối được API giá' };
  } finally { clearTimeout(t); }
}

function save(db, storeId, row) {
  db.prepare(`INSERT INTO product_cache(store_id,sku,barcode,name,price,list_price,stock,unit,active,age_restricted,promo_min_qty,promo_off,synced_at)
    VALUES(?,?,?,?,?,?,999999,'',1,0,0,0,?)
    ON CONFLICT(store_id,sku) DO UPDATE SET barcode=excluded.barcode,name=excluded.name,price=excluded.price,list_price=excluded.list_price,
      stock=999999,active=1,promo_min_qty=0,promo_off=0,synced_at=excluded.synced_at`).run(storeId, row.sku, row.barcode, row.name, row.price, row.list_price, nowIso());
}

/**
 * Bảo đảm bộ nhớ giá có mã vạch này trước khi xử lý thao tác quét. Trả 'fresh' (đã có giá còn mới), 'fetched' (vừa tra xong),
 * 'stale' (API lỗi, dùng giá cũ đã lưu), 'notfound' (API báo không có giá), 'error' (API lỗi và chưa có giá nào đã lưu).
 */
export async function ensurePrice(ctx, storeId, variants, fetchImpl) {
  const { db } = ctx;
  const c = priceConfig(db);
  if (!c.enabled) return 'off';
  const store = db.prepare('SELECT pos_code FROM stores WHERE id = ?').get(storeId);
  if (!store?.pos_code) return 'error';
  const cut = new Date(Date.now() - c.cacheMin * 60_000).toISOString();
  const cached = (() => { for (const v of variants) { const r = db.prepare('SELECT synced_at FROM product_cache WHERE store_id = ? AND barcode = ?').get(storeId, v); if (r) return r; } return null; })();
  if (cached && cached.synced_at >= cut) return 'fresh';
  const key = `${storeId}|${variants[0]}`;
  if (negative.get(key) > Date.now()) return 'notfound';
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    let last = { status: 'notfound' };
    for (const v of variants) {
      const r = await callPriceApi(db, store.pos_code, v, fetchImpl);
      if (r.status === 'ok') { save(db, storeId, r.row); return 'fetched'; }
      last = r;
      if (r.status === 'error') break; // lỗi hệ thống: không thử biến thể khác
    }
    if (last.status === 'notfound') { negative.set(key, Date.now() + NEG_MS); return 'notfound'; }
    ctx.priceError = { at: nowIso(), code: last.code, message: last.message };
    return cached ? 'stale' : 'error';
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Chuẩn bị giá cho một lô thao tác quét (chạy trước khi xử lý lô). Trả Map mã vạch -> kết quả. */
export async function prefetchPrices(ctx, session, ops, normalize, fetchImpl) {
  const out = new Map();
  if (!priceConfig(ctx.db).enabled) return out;
  const todo = new Map();
  for (const op of Array.isArray(ops) ? ops : []) {
    if (op?.type !== 'scan') continue;
    const n = normalize(op.barcode);
    if (n.ok && !todo.has(n.code)) todo.set(n.code, n.variants);
  }
  const list = [...todo.entries()];
  for (let i = 0; i < list.length; i += 5) {
    await Promise.all(list.slice(i, i + 5).map(async ([code, variants]) => { out.set(code, await ensurePrice(ctx, session.store_id, variants, fetchImpl)); }));
  }
  return out;
}

export const clearPriceMemory = () => { negative.clear(); inflight.clear(); };
