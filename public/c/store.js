// Trạng thái PWA khách: mã thiết bị, phiên mua sắm, hàng đợi thao tác khi mất mạng, đồng bộ.
// Giỏ hàng luôn lưu trên máy (localStorage) và đồng bộ lên máy chủ khi có mạng.
import { createApi, useState, useEffect, toast } from '/shared/lib.js';

// ---------- Lưu trữ cục bộ (có thể bị chặn, nên luôn bọc try/catch) ----------
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bộ nhớ đầy hoặc bị chặn */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* bỏ qua */ } }
};
export const local = LS;

const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 32);

// Mã thiết bị: bí mật ngẫu nhiên, đóng vai "chìa khoá" cho phiên và lịch sử của khách.
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
  online: navigator.onLine,
  syncing: false,
  booted: false
};
const subs = new Set();
function persist() {
  LS.set('brg.c.v1', { storeCode: state.storeCode, store: state.store, session: state.session, queue: state.queue, receipt: state.receipt });
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

/** Giỏ hàng để hiển thị: bản từ máy chủ + thao tác chưa gửi (đổi số lượng, xoá) + món quét khi mất mạng. */
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
  const pendingList = [...pending.entries()].map(([barcode, qty]) => ({ barcode, qty }));
  return {
    items, pending: pendingList,
    pendingCount: pendingList.reduce((a, p) => a + p.qty, 0),
    itemCount: items.reduce((a, i) => a + i.qty, 0),
    subtotal, discount, total: subtotal - discount,
    ageRestricted: items.some((i) => i.ageRestricted)
  };
}

// ---------- Cửa hàng & phiên ----------
export async function loadStore(code) {
  const store = await api.get(`/store/${encodeURIComponent(code)}`);
  setState({ storeCode: store.id, store });
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
  if (!state.session) return null;
  try {
    const r = await api.get(`/sessions/${state.session.id}`);
    const ended = ['abandoned', 'exited'].includes(r.session.status) || (r.session.status === 'paid' && r.session.transaction?.exitStatus === 'exited');
    setState({ session: r.session, online: true });
    if (r.session.transaction?.status === 'paid') saveReceipt(r.session.transaction);
    return { session: r.session, ended };
  } catch (e) {
    if (e.status === 0) { setState({ online: false }); return null; }
    if (e.code === 'SESSION_NOT_FOUND') { setState({ session: null, queue: [] }); return null; }
    throw e;
  }
}

function saveReceipt(tx) {
  if (!tx?.receipt) return;
  setState({ receipt: { tx, storeName: state.store?.name || '', savedAt: new Date().toISOString() } });
}

// ---------- Đồng bộ thao tác ----------
let flushing = null;
const enqueue = (op) => setState({ queue: [...state.queue, op] });

/** Gửi toàn bộ thao tác đang chờ. Trả về Map(id -> kết quả) hoặc null nếu chưa gửi được. */
export async function flush(immediate = new Set()) {
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

// ---------- Khoá giỏ & thanh toán ----------
export async function lock(method, acceptChanges = false, buyer = undefined) {
  if (state.queue.length) { const m = await flush(); if (m === null) throw new Error('Cần có mạng để thanh toán'); }
  const r = await api.post(`/sessions/${state.session.id}/lock`, { method, acceptChanges, buyer });
  setState({ session: r.session });
  return r.transaction;
}
/** Thời điểm khách tự mở khoá giỏ (để phân biệt với việc thu ngân huỷ đơn bên POS). */
export let lastUnlockAt = 0;
export async function unlock() {
  lastUnlockAt = Date.now();
  const r = await api.post(`/sessions/${state.session.id}/unlock`);
  setState({ session: r.session });
}

// ---------- Theo dõi kết nối ----------
addEventListener('online', async () => { setState({ online: true }); try { await flush(); await refreshSession(); } catch { /* lần sau */ } });
addEventListener('offline', () => setState({ online: false }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.session) { flush().then(() => refreshSession()).catch(() => {}); }
});
