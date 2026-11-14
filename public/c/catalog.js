// Bảng mã hàng + giá của chi nhánh, lưu sẵn trên điện thoại (IndexedDB) để tra tức thì và có giá tạm tính khi mất mạng.
// Giá ở đây CHỈ LÀ TẠM TÍNH; số tiền thu thật do Dsmart POS tính. Có mạng thì máy chủ vẫn là nguồn chính xác (giỏ lấy lại giá từ máy chủ).
// Tự cập nhật: khi mở app, khi có mạng trở lại, khi quay lại app sau ≥10 phút; chỉ tải lại khi máy chủ báo có bản mới (ETag).
const DB_NAME = 'brg-catalog', STORE = 'cat', MIN_GAP = 10 * 60_000;

let mem = { storeId: '', etag: '', at: 0, map: new Map() };
let getCtx = () => ({ storeId: '', deviceId: '' });
let syncing = null;
const listeners = new Set();
export const onCatalogChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach((f) => { try { f(); } catch { /* bỏ qua */ } });

export const catalogInfo = () => ({ storeId: mem.storeId, count: mem.map.size, at: mem.at });

// ---- Chuẩn hóa mã vạch giống máy chủ (server/services/barcode.js): kiểm tra số cuối và các biến thể 12/13/14 số ----
function checkDigitOk(digits) {
  const nums = digits.split('').map(Number); const check = nums.pop(); let sum = 0;
  nums.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}
export function normalizeLocal(raw) {
  const code = String(raw ?? '').trim().replace(/\s+/g, '');
  if (!code || code.length > 32 || !/^[0-9A-Za-z-]+$/.test(code)) return { ok: false, code };
  if (/^\d+$/.test(code) && [8, 12, 13].includes(code.length) && !checkDigitOk(code)) return { ok: false, code };
  const variants = [code];
  if (code.length === 12) variants.push('0' + code);
  if (code.length === 13 && code.startsWith('0')) variants.push(code.slice(1));
  if (code.length === 14 && code.startsWith('0')) variants.push(code.slice(1));
  return { ok: true, code, variants };
}

/** Tra mã vạch trong bảng trên máy. Trả null nếu chưa có bảng hoặc không có mặt hàng. */
export function catalogLookup(raw) {
  if (!mem.map.size) return null;
  const n = normalizeLocal(raw);
  if (!n.ok) return null;
  for (const v of n.variants) { const it = mem.map.get(v); if (it) return it; }
  return null;
}

// ---- IndexedDB (mọi thao tác bọc try/catch: không có IndexedDB thì chỉ dùng bộ nhớ trong phiên) ----
function idb() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function idbGet(key) { try { const d = await idb(); return await new Promise((res) => { const q = d.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch { return undefined; } }
async function idbSet(key, val) { try { const d = await idb(); await new Promise((res) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(val, key); t.oncomplete = res; t.onerror = res; t.onabort = res; }); } catch { /* bỏ qua */ } }

function build(rows) {
  const map = new Map();
  for (const r of rows) map.set(r[0], { barcode: r[0], sku: r[1], name: r[2], price: r[3], listPrice: r[4] || null, ageRestricted: !!r[5], promoMin: r[6] || 0, promoOff: r[7] || 0 });
  return map;
}

/** Nạp bảng đã lưu trên máy (nhanh, không cần mạng) rồi đồng bộ nếu có mạng. */
export async function loadCatalog(storeId) {
  if (!storeId) return;
  if (mem.storeId !== storeId) mem = { storeId, etag: '', at: 0, map: new Map() };
  if (!mem.map.size) {
    const saved = await idbGet(storeId);
    if (saved?.items?.length && mem.storeId === storeId) { mem = { storeId, etag: saved.etag || '', at: saved.at || 0, map: build(saved.items) }; notify(); }
  }
  return syncCatalog(storeId);
}

/** Hỏi máy chủ có bản mới không (ETag). 304 = giữ nguyên, 200 = thay bảng mới. Lỗi mạng thì giữ bảng cũ. */
export function syncCatalog(storeId, { force = false } = {}) {
  if (!storeId || (typeof navigator !== 'undefined' && navigator.onLine === false)) return Promise.resolve(false);
  if (!force && mem.storeId === storeId && mem.map.size && Date.now() - mem.at < MIN_GAP) return Promise.resolve(false);
  if (mem.storeId !== storeId) mem = { storeId, etag: '', at: 0, map: new Map() }; // đổi chi nhánh: bỏ bảng của chi nhánh cũ
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const { deviceId } = getCtx();
      const headers = { 'x-device-id': deviceId };
      if (mem.storeId === storeId && mem.etag && mem.map.size) headers['If-None-Match'] = mem.etag;
      const res = await fetch(`/api/c/catalog/${encodeURIComponent(storeId)}`, { headers });
      if (res.status === 304) { mem.at = Date.now(); idbSet(storeId, { etag: mem.etag, at: mem.at, items: [...mem.map.values()].map((x) => [x.barcode, x.sku, x.name, x.price, x.listPrice || 0, x.ageRestricted ? 1 : 0, x.promoMin, x.promoOff]) }); return false; }
      if (!res.ok) return false;
      const data = await res.json();
      if (!Array.isArray(data.items) || mem.storeId !== storeId) return false;
      mem = { storeId, etag: res.headers.get('etag') || '', at: Date.now(), map: build(data.items) };
      await idbSet(storeId, { etag: mem.etag, at: mem.at, items: data.items });
      notify();
      return true;
    } catch { return false; } finally { syncing = null; }
  })();
  return syncing;
}

/** Gắn các sự kiện tự cập nhật. getContext() trả { storeId, deviceId } hiện tại. */
export function watchCatalog(getContext) {
  getCtx = getContext;
  const go = (force) => { const c = getCtx(); if (c.storeId) syncCatalog(c.storeId, { force }); };
  addEventListener('online', () => go(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') go(false); });
}
