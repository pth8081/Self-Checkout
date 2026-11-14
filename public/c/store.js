// Trạng thái PWA khách: mã thiết bị, phiên mua sắm, hàng đợi thao tác khi mất mạng, đồng bộ.
// Giỏ hàng luôn lưu trên máy (localStorage) và đồng bộ lên máy chủ khi có mạng.
import { createApi, useState, useEffect, toast } from '/shared/lib.js';
import { makeBasketRef } from '/shared/basket.js';
import { catalogLookup, normalizeLocal, loadCatalog, watchCatalog, onCatalogChange } from './catalog.js';

// ---------- Lưu trữ cục bộ (có thể bị chặn, nên luôn bọc try/catch) ----------
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bộ nhớ đầy hoặc bị chặn */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* bỏ qua */ } }
};
export const local = LS;

// Mã thiết bị là bí mật nên chỉ dùng nguồn ngẫu nhiên mật mã (randomUUID, hoặc getRandomValues khi trang không ở HTTPS); không dùng Math.random.
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')).slice(0, 32);

// Mã thiết bị: bí mật ngẫu nhiên, đóng vai "chìa khóa" cho phiên và lịch sử của khách.
export const deviceId = (() => {
  let id = LS.get('brg.device');
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) { id = uid() + uid().slice(0, 8); LS.set('brg.device', id); }
  return id;
})();
try { navigator.storage?.persist?.(); } catch { /* không bắt buộc */ }

export const api = createApi({ base: '/api/c', headers: () => ({ 'x-device-id': deviceId }) });

// ---------- Trạng thái toàn cục ----------
const saved = LS.get('brg.c.v1', {}) || {};
let state = {
  storeCode: saved.storeCode || null,
  store: saved.store || null,        // thông tin chi nhánh (tên, cách thanh toán)
  session: saved.session || null,    // bản nhìn phiên từ máy chủ
  queue: saved.queue || [],          // thao tác chưa gửi được
  issues: [],                        // lỗi phát hiện khi đồng bộ nền
  receipt: saved.receipt || null,    // bản lưu QR biên nhận để xem khi mất mạng
  basket: saved.basket || null,      // giỏ QR đưa cho Dsmart POS: lưu trên máy để mở lại được khi mất mạng hoặc tắt trình duyệt
  online: navigator.onLine,
  syncing: false,
  booted: false
};
const subs = new Set();
function persist() {
  LS.set('brg.c.v1', { storeCode: state.storeCode, store: state.store, session: state.session, queue: state.queue, receipt: state.receipt, basket: state.basket });
}
export function setState(patch) {
  state = { ...state, ...patch };
  persist();
  subs.forEach((f) => f(state));
}
export const getState = () => state;
export function useStore() {
  const [s, set] = useState(state);
  useEffect(() => { subs.add(set); set(state); return () => subs.delete(set); }, []);
  return s;
}

// ---------- Tính giỏ hàng (cộng thao tác đang chờ đồng bộ) ----------
const lineDiscount = (it) => (it.promoMin && it.promoOff ? Math.floor(it.qty / it.promoMin) * it.promoOff : 0);

/** Giỏ hàng để hiển thị: bản từ máy chủ + thao tác chưa gửi (đổi số lượng, xóa) + mặt hàng quét khi mất mạng. */
export function cartView(s) {
  const server = s.session?.items || [];
  const over = new Map(); // itemId -> qty mới
  const pending = new Map(); // barcode -> số lần quét chờ đồng bộ
  for (const op of s.queue) {
    if (op.type === 'setQty') over.set(op.itemId, op.qty);
    else if (op.type === 'remove') over.set(op.itemId, 0);
    else if (op.type === 'scan') pending.set(op.barcode, (pending.get(op.barcode) || 0) + 1);
  }
  const items = server.map((it) => ({ ...it, qty: over.has(it.id) ? over.get(it.id) : it.qty }))
    .filter((it) => it.qty > 0)
    .map((it) => {
      const d = lineDiscount(it);
      return { ...it, discount: d, lineTotal: it.price * it.qty - d };
    });
  const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0);
  const discount = items.reduce((a, i) => a + i.discount, 0);
  // Mặt hàng quét khi chưa gửi được: có trong bảng giá lưu trên máy thì tính giá TẠM TÍNH ngay (máy chủ tính lại khi đồng bộ); không có thì chờ máy chủ.
  const pendingList = [...pending.entries()].map(([barcode, qty]) => {
    const c = catalogLookup(barcode);
    if (!c) return { barcode, qty, known: false };
    const d = lineDiscount({ qty, promoMin: c.promoMin, promoOff: c.promoOff });
    return { barcode, qty, known: true, estimated: true, sku: c.sku, name: c.name, price: c.price, listPrice: c.listPrice, discount: d, lineTotal: c.price * qty - d };
  });
  const estSub = pendingList.reduce((a, p) => a + (p.known ? p.price * p.qty : 0), 0);
  const estDisc = pendingList.reduce((a, p) => a + (p.known ? p.discount : 0), 0);
  return {
    items, pending: pendingList,
    pendingCount: pendingList.reduce((a, p) => a + p.qty, 0),
    unknownCount: pendingList.reduce((a, p) => a + (p.known ? 0 : p.qty), 0), // chưa có giá trong tạm tính
    itemCount: items.reduce((a, i) => a + i.qty, 0),
    subtotal: subtotal + estSub, discount: discount + estDisc, total: subtotal + estSub - discount - estDisc,
    ageRestricted: items.some((i) => i.ageRestricted)
  };
}

// ---------- Cửa hàng & phiên ----------
export async function loadStore(code) {
  const store = await api.get(`/store/${encodeURIComponent(code)}`);
  setState({ storeCode: store.id, store });
  loadCatalog(store.id); // bảng mã hàng + giá lưu trên máy: nạp bản đã lưu rồi cập nhật nếu có bản mới
  return store;
}

export function setStoreCode(code) {
  const c = String(code || '').toUpperCase();
  if (c && c !== state.storeCode) setState({ storeCode: c, store: null, session: null, queue: [], issues: [] });
}

/** Mở (hoặc nối lại) phiên mua sắm. Trả về { resumed } để màn hình hỏi khách. */
export async function openSession({ fresh = false } = {}) {
  const r = await api.post('/sessions', { storeId: state.storeCode, fresh });
  setState({ session: r.session, queue: fresh ? [] : state.queue, issues: [] });
  return r;
}

export function resetSession() { setState({ session: null, queue: [], issues: [] }); }

export async function refreshSession() {
  if (!state.session) {
    // Mất dữ liệu trang (iOS xóa bộ nhớ, đổi trình duyệt cùng cookie): hỏi máy chủ xem còn giỏ đang dở không.
    if (!state.storeCode) return null;
    try {
      const r = await api.get(`/sessions/current?storeId=${encodeURIComponent(state.storeCode)}`);
      if (!r.session || ['abandoned', 'exited'].includes(r.session.status)) return null;
      setState({ session: r.session, online: true });
      if (r.session.transaction?.status === 'paid') saveReceipt(r.session.transaction);
      adoptBasket(r.session);
      return { session: r.session, ended: false };
    } catch { return null; }
  }
  try {
    const r = await api.get(`/sessions/${state.session.id}`);
    const ended = ['abandoned', 'exited'].includes(r.session.status) || (r.session.status === 'paid' && r.session.transaction?.exitStatus === 'exited');
    setState({ session: r.session, online: true });
    if (r.session.transaction?.status === 'paid') saveReceipt(r.session.transaction);
    adoptBasket(r.session);
    return { session: r.session, ended };
  } catch (e) {
    if (e.status === 0) { setState({ online: false }); return null; }
    if (e.code === 'SESSION_NOT_FOUND') { setState({ session: null, queue: [] }); return null; }
    throw e;
  }
}

// ---------- Giỏ QR cho Dsmart POS ----------
export const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
/** Khách để lại email nhận bill: lưu trên máy và gửi lên máy chủ khi giỏ đã đồng bộ (hoặc đã thanh toán thì gửi bill ngay). */
export async function setBillEmail(email, txId) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new Error('Email chưa đúng');
  local.set('brg.c.email', e);
  if (state.basket) setState({ basket: { ...state.basket, email: e } });
  const id = txId || (state.basket?.synced ? state.session?.transaction?.id : null);
  if (id) { const r = await api.post(`/transactions/${encodeURIComponent(id)}/bill-email`, { email: e }); await refreshSession(); return r.status; }
  return 'saved';
}


/** Mặt hàng để đưa vào QR: giỏ đã đồng bộ cộng cả mặt hàng quét lúc mất mạng (chỉ cần mã vạch và số lượng). */
export function basketItems(st) {
  const v = cartView(st);
  const m = new Map();
  for (const it of v.items) m.set(it.barcode, (m.get(it.barcode) || 0) + it.qty);
  for (const p of v.pending) m.set(p.barcode, (m.get(p.barcode) || 0) + p.qty);
  return [...m].map(([barcode, qty]) => ({ barcode, qty }));
}

/** Máy chủ đã có giỏ khóa (mở lại trên trình duyệt khác, mất dữ liệu trang): lấy lại QR từ máy chủ. */
function adoptBasket(session) {
  const tx = session?.transaction;
  if (tx?.method === 'basket' && tx.basketQr && (tx.status === 'awaiting_counter' || tx.status === 'paid')) {
    const b = state.basket;
    if (!b || b.ref !== tx.code) setState({ basket: { ref: tx.code, qrShort: tx.basketQr, total: tx.total, count: tx.itemCount, pending: 0, synced: true, at: Date.parse(tx.createdAt) } });
    else if (!b.synced || b.total !== tx.total) setState({ basket: { ...b, qrShort: tx.basketQr, total: tx.total, count: tx.itemCount, pending: 0, synced: true } });
  }
}

/** Bấm Thanh toán: tạo QR ngay từ giỏ trên máy (không cần mạng), rồi đồng bộ lên máy chủ khi có thể. */
export function makeBasket() {
  const items = basketItems(state);
  if (!items.length) throw new Error('Giỏ hàng đang trống');
  const max = state.store?.maxCartItems || 60;
  if (items.length > max) throw new Error(`Giỏ có ${items.length} mặt hàng khác nhau, tối đa ${max}. Hãy bỏ bớt, thanh toán phần này rồi quét giỏ mới cho phần còn lại`);
  const v = cartView(state);
  const rememberedMail = local.get('brg.c.email', '');
  const point = state.store?.pointCode;
  if (!point) throw new Error('Cửa hàng chưa có Mã điểm nên chưa thanh toán được. Hãy báo nhân viên');
  const ref = makeBasketRef(state.storeCode);
  setState({ basket: { ref, qrShort: null, total: v.total, count: v.itemCount + v.pendingCount, pending: v.unknownCount, synced: false, at: Date.now(), error: null, email: state.store?.emailEnabled && EMAIL_RE.test(rememberedMail) ? rememberedMail : '' } });
  syncBasket();
}

let syncing = null;
export async function syncBasket() {
  if (syncing) return syncing;
  const b = state.basket;
  if (!b || b.synced || !state.session) return null;
  syncing = (async () => {
    try {
      if (state.queue.length) { const m = await flush(); if (m === null) return; }
      if (!state.basket || state.basket.ref !== b.ref) return;
      const r = await api.post(`/sessions/${state.session.id}/basket`, { ref: b.ref, email: state.basket.email || undefined });
      const tx = r.transaction;
      setState({ session: r.session, online: true, basket: { ...state.basket, synced: true, total: tx.total, count: tx.itemCount, qrShort: tx.basketQr || null, pending: 0, error: null } });
    } catch (e) {
      if (e.status === 0) { setState({ online: false }); return; }
      if (state.basket?.ref === b.ref) setState({ basket: { ...state.basket, error: e.message } });
    } finally { syncing = null; }
  })();
  return syncing;
}

// ---------- Bill ----------
const BILLS = 'brg.c.bills';
const cachedBills = () => LS.get(BILLS, {}) || {};
export const cachedBill = (id) => cachedBills()[id] || null;
/** Lấy bill: có mạng thì lấy mới và lưu lại trên máy để xem được khi mất mạng. */
export async function loadBill(id) {
  try {
    const r = await api.get(`/transactions/${encodeURIComponent(id)}/bill`);
    const all = cachedBills(); all[id] = r.bill;
    const keys = Object.keys(all); for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete all[k];
    LS.set(BILLS, all);
    return r.bill;
  } catch (e) { const c = cachedBill(id); if (c && e.status === 0) return c; throw e; }
}
export async function loadPublicBill(token) { return (await api.get(`/bill/${encodeURIComponent(token)}`)).bill; }
export async function downloadPublicBillPdf(token, code) {
  const res = await fetch(`/api/c/bill/${encodeURIComponent(token)}/pdf`);
  if (!res.ok) throw new Error('Không tải được bill PDF');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = `bill-${code || 'bill'}.pdf`; a.rel = 'noopener'; a.target = '_blank';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
/** Tải bill PDF về máy (iOS có thể mở ra tab mới, khách dùng nút Chia sẻ để lưu). */
export async function downloadBillPdf(id, code) {
  const res = await fetch(`/api/c/transactions/${encodeURIComponent(id)}/bill.pdf`, { headers: { 'x-device-id': deviceId } });
  if (!res.ok) throw new Error(res.status === 0 ? 'Cần có mạng để tải PDF' : 'Không tải được bill PDF');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = `bill-${code || id}.pdf`; a.rel = 'noopener'; a.target = '_blank';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const setBasket = (basket) => setState({ basket });

/** Sửa giỏ: bỏ mã QR hiện tại, mở khóa giỏ trên máy chủ nếu có thể. */
export async function editBasket() {
  const synced = state.basket?.synced;
  if (synced && state.session) {
    try { await unlock(); }
    catch (e) {
      // Thu ngân đã nhận đơn, đã thanh toán hoặc quản lý đang xử lý: không rời màn hình QR được, giữ nguyên mã.
      if (['CLAIMED', 'ALREADY_PAID', 'HELD'].includes(e.code)) throw new Error(e.code === 'CLAIMED' ? 'Thu ngân đang xử lý đơn này trên máy tính tiền nên chưa tiếp tục mua sắm được. Hãy báo thu ngân hủy đơn rồi thử lại' : e.message);
      /* lỗi mạng: sẽ mở khóa khi có mạng */
    }
  }
  setState({ basket: null });
}

/** Đã thanh toán xong: kết thúc giỏ. */
export async function finishBasket() {
  const sid = state.session?.id;
  setState({ basket: null, session: null, queue: [] });
  if (sid) { try { await api.post(`/sessions/${sid}/finish`); } catch { /* máy chủ sẽ tự dọn giỏ bỏ quên */ } }
}

function saveReceipt(tx) {
  if (!tx?.receipt) return;
  setState({ receipt: { tx, storeName: state.store?.name || '', savedAt: new Date().toISOString() } });
}

// ---------- Đồng bộ thao tác ----------
let flushing = null;
let flushRetry = false;
const enqueue = (op) => setState({ queue: [...state.queue, op] });

/** Gửi toàn bộ thao tác đang chờ. Trả về Map(id -> kết quả) hoặc null nếu chưa gửi được. */
export async function flush(immediate = new Set()) {
  const r = await flushOnce(immediate);
  if (r !== 'LOCKED') return r;
  flushRetry = true;
  try { await api.post(`/sessions/${state.session.id}/unlock`); return await flushOnce(immediate); }
  catch { await refreshSession(); return new Map(); }
  finally { flushRetry = false; }
}
async function flushOnce(immediate) {
  while (flushing) await flushing.catch(() => {});
  if (!state.queue.length || !state.session) return new Map();
  const ops = [...state.queue];
  flushing = (async () => {
    setState({ syncing: true });
    try {
      const r = await api.post(`/sessions/${state.session.id}/ops`, { ops });
      const sent = new Set(ops.map((o) => o.id));
      const map = new Map(r.results.map((x) => [x.id, x]));
      const issues = [];
      for (const op of ops) {
        const res = map.get(op.id);
        if (res && !res.ok && !immediate.has(op.id) && op.type === 'scan') issues.push({ id: op.id, barcode: op.barcode, code: res.code, name: res.name, message: res.message });
      }
      setState({ queue: state.queue.filter((o) => !sent.has(o.id)), session: r.session, online: true, syncing: false, issues: [...state.issues, ...issues] });
      return map;
    } catch (e) {
      setState({ syncing: false });
      if (e.status === 0) { setState({ online: false }); return null; }
      if (e.code === 'SESSION_LOCKED' && !state.basket && !flushRetry) return 'LOCKED'; // khách đã sửa giỏ nhưng máy chủ còn khóa
      if (e.code === 'SESSION_LOCKED' || e.code === 'SESSION_NOT_FOUND') {
        setState({ queue: [] });
        await refreshSession();
        toast('Giỏ hàng đã thay đổi ở nơi khác, đã tải lại');
        return new Map();
      }
      throw e;
    } finally { flushing = null; }
  })();
  return flushing;
}

/** Quét một mã: gửi ngay nếu có mạng, mất mạng thì giữ trong hàng đợi. */
export async function scan(barcode) {
  const n = normalizeLocal(barcode);
  if (!n.ok) return { ok: false, code: 'INVALID_BARCODE', barcode: n.code || String(barcode), message: 'Không đọc được mã vạch, hãy quét lại' }; // báo ngay trên máy, không cần chờ máy chủ
  const op = { id: uid(), type: 'scan', barcode: String(barcode).trim() };
  enqueue(op);
  const map = await flush(new Set([op.id]));
  const r = map?.get(op.id);
  return r || { pending: true, ok: false };
}

export async function setQty(itemId, qty) {
  const op = { id: uid(), type: 'setQty', itemId, qty };
  enqueue(op);
  const map = await flush(new Set([op.id]));
  return map?.get(op.id) || { pending: true, ok: true };
}
export const removeItem = (itemId) => setQty(itemId, 0);

export function dismissIssue(id) { setState({ issues: state.issues.filter((i) => i.id !== id) }); }

// ---------- Khóa giỏ & thanh toán ----------
export async function lock(method, acceptChanges = false, buyer = undefined) {
  if (state.queue.length) { const m = await flush(); if (m === null) throw new Error('Cần có mạng để thanh toán'); }
  const r = await api.post(`/sessions/${state.session.id}/lock`, { method, acceptChanges, buyer });
  setState({ session: r.session });
  return r.transaction;
}
/** Thời điểm khách tự mở khóa giỏ (để phân biệt với việc thu ngân hủy đơn bên Dsmart POS). */
export let lastUnlockAt = 0;
export async function unlock() {
  lastUnlockAt = Date.now();
  const r = await api.post(`/sessions/${state.session.id}/unlock`);
  setState({ session: r.session });
}

// ---------- Theo dõi kết nối ----------
addEventListener('online', async () => { setState({ online: true }); try { await flush(); await syncBasket(); await refreshSession(); } catch { /* lần sau */ } });
addEventListener('offline', () => setState({ online: false }));
// Bảng mã hàng + giá trên máy: tự cập nhật khi có mạng/mở lại app; mở app lúc mất mạng vẫn nạp được bản đã lưu.
watchCatalog(() => ({ storeId: state.storeCode || '', deviceId }));
onCatalogChange(() => setState({ catalogAt: Date.now() }));
if (state.storeCode) loadCatalog(state.storeCode);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.session) { flush().then(() => syncBasket()).then(() => refreshSession()).catch(() => {}); }
});
