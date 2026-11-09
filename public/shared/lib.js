// Thư viện giao diện dùng chung cho PWA khách, nhân viên và quản trị.
// Dùng Preact + htm (không cần bước build). Bản đồ import khai báo trong từng index.html.
import { h, render, Fragment } from 'preact';
import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'preact/hooks';
import htm from 'htm';
import qrcode from './vendor/qrcode.js';

export const html = htm.bind(h);
export { h, render, Fragment, useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect };

// ============================== Định dạng ==============================
const nf = new Intl.NumberFormat('vi-VN');
export const fmt = {
  money: (n) => `${nf.format(Math.round(Number(n) || 0))}₫`,
  num: (n) => nf.format(Number(n) || 0),
  pct: (r, d = 1) => `${((Number(r) || 0) * 100).toFixed(d).replace('.', ',').replace(/,0$/, '')}%`,
  time: (iso) => (iso ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''),
  date: (iso) => (iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) : ''),
  dateFull: (iso) => (iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''),
  dateTime: (iso) => (iso ? `${fmt.date(iso)} ${fmt.time(iso)}` : ''),
  /** "Hôm nay 18:47" hoặc "02/11 17:20" */
  when: (iso) => {
    if (!iso) return '';
    const d = new Date(iso), n = new Date();
    return d.toDateString() === n.toDateString() ? `Hôm nay ${fmt.time(iso)}` : `${fmt.date(iso)} ${fmt.time(iso)}`;
  },
  ago: (iso) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s} giây trước`;
    if (s < 3600) return `${Math.round(s / 60)} phút trước`;
    return `${Math.round(s / 3600)} giờ trước`;
  },
  digits: (s) => String(s ?? '').replace(/\D/g, ''),
  method: (m) => ({ cash: 'Tiền mặt', qr_transfer: 'Chuyển khoản', card: 'Thẻ', ewallet: 'Ví điện tử', other: 'Khác', pos: 'Tại quầy (Dsmart POS)', basket: 'Giỏ QR (tại quầy)', online: 'Thanh toán online' }[m] || m),
  tone: (i) => (i * 47) % 360
};
export const todayStr = () => { const d = new Date(Date.now() + 7 * 3600_000); return d.toISOString().slice(0, 10); };

// ============================== Biểu tượng (nét mảnh) ==============================
const P = {
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  flash: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  kbd: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  wifioff: '<path d="M3 3l18 18M5 10a10 10 0 0 1 4-2.5M10 5.2A14 14 0 0 1 22 10M8.5 13.5a6 6 0 0 1 3-1.6M16 13.5a6 6 0 0 0-1.4-1M12 18v.01"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5L16 9.5"/>',
  store: '<path d="M4 9l1-5h14l1 5M4 9v11h16V9M4 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 4 0"/>',
  barcode: '<path d="M4 6v12M7 6v12M11 6v12M14 6v12M18 6v12M20 6v12"/>',
  chev: '<path d="M9 6l6 6-6 6"/>', chevl: '<path d="M15 6l-6 6 6 6"/>', chevd: '<path d="M6 9l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  phone: '<path d="M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  star: '<path d="M12 4l2.4 5 5.6.7-4.1 3.8 1.1 5.5L12 16.3 7 19l1.1-5.5L4 9.7 9.6 9z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
  list: '<path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 19a6.5 6.5 0 0 0-3-5.5"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  doc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  docok: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 12.5l2.2 2.2L15 10"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/>',
  qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h3v3M20 14v.01M14 20h.01M17 20h3v-3"/>',
  cash: '<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 12h.01M17.5 12h.01"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  building: '<rect x="4" y="3" width="10" height="18" rx="1"/><path d="M14 9h6v12h-6M8 7h2M8 11h2M8 15h2"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>'
};
export function Icon({ name, size, class: cls = '' }) {
  const s = size ? { width: size, height: size } : null;
  return html`<svg class=${`ic ${cls}`} style=${s} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: P[name] || '' }}></svg>`;
}

/** Biểu tượng BRG: túi xanh có nụ cười, quai cam. */
export function Logo({ size = 36 }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 64 64" role="img" aria-label="BRG Scan & Checkout"><path d="M22 27V21a10 10 0 0 1 20 0v6" fill="none" stroke="#F07F1A" stroke-width="6" stroke-linecap="round"/><rect x="9" y="24" width="46" height="34" rx="11" fill="#43A047"/><path d="M23 40q9 10 18 0" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/></svg>`;
}

// ============================== QR ==============================
/** Vẽ mã QR thành SVG (dùng cho QR biên nhận, mã giỏ hàng, QR chuyển khoản). */
export function QR({ text, label = 'Mã QR', ecc = 'M' }) {
  const svg = useMemo(() => {
    try {
      const q = qrcode(0, ecc); q.addData(String(text || ' ')); q.make();
      const n = q.getModuleCount(); const m = 2; let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
      return `<svg viewBox="0 0 ${n + m * 2} ${n + m * 2}" shape-rendering="crispEdges" role="img" aria-label="${label}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#0b0f14"/></svg>`;
    } catch { return ''; }
  }, [text, ecc]);
  return html`<div class="qr" dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
}

// ============================== Gọi API ==============================
export class ApiError extends Error {
  constructor(status, code, message, data) { super(message); this.status = status; this.code = code; this.data = data || {}; }
}

/** Tạo client gọi API. headers() trả về header bổ sung (token, mã thiết bị). */
export function createApi({ base, headers = () => ({}), onUnauthorized }) {
  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers() }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Không kết nối được máy chủ. Hãy kiểm tra mạng.');
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => ({})) : null;
    if (!res.ok) {
      if (res.status === 401 && onUnauthorized && !['BAD_LOGIN', 'LOCKED', 'TOTP_REQUIRED', 'BAD_TOTP'].includes(data?.error)) onUnauthorized(data);
      throw new ApiError(res.status, data?.error || 'ERROR', data?.message || 'Có lỗi xảy ra, vui lòng thử lại', data);
    }
    return data ?? res;
  }
  return {
    get: (p) => request('GET', p), post: (p, b = {}) => request('POST', p, b), put: (p, b = {}) => request('PUT', p, b), del: (p) => request('DELETE', p),
    /** Tải file (CSV) có kèm token. */
    async download(path) {
      const res = await fetch(base + path, { headers: headers() });
      if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Không tải được file');
      return res.blob();
    }
  };
}

// ============================== Hook tiện ích ==============================
export function useOnline() {
  const [on, set] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => set(true), b = () => set(false);
    addEventListener('online', a); addEventListener('offline', b);
    return () => { removeEventListener('online', a); removeEventListener('offline', b); };
  }, []);
  return on;
}

/** Điều hướng bằng hash: #/duong-dan?tham-so */
export function useRoute() {
  const parse = () => {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs = ''] = raw.split('?');
    return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
  };
  const [r, set] = useState(parse);
  useEffect(() => { const f = () => set(parse()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
}
export const go = (path, replace = false) => { if (replace) history.replaceState(null, '', `#${path}`), dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = path; };

export function usePoll(fn, ms, deps = []) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    let stop = false, t;
    const tick = async () => { try { await ref.current(); } catch { /* bỏ qua, lần sau thử lại */ } if (!stop) t = setTimeout(tick, ms); };
    tick();
    return () => { stop = true; clearTimeout(t); };
  }, deps);
}

/** useAsync: chạy hàm bất đồng bộ khi deps đổi, trả { data, error, loading, reload }. */
export function useAsync(fn, deps = []) {
  const [st, set] = useState({ data: null, error: null, loading: true });
  const n = useRef(0);
  const run = useCallback(async () => {
    const id = ++n.current;
    set((s) => ({ ...s, loading: true }));
    try { const data = await fn(); if (id === n.current) set({ data, error: null, loading: false }); }
    catch (error) { if (id === n.current) set({ data: null, error, loading: false }); }
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...st, reload: run };
}

// ============================== Thông báo nhanh ==============================
let toastSet = null;
export function toast(text, kind = '') {
  if (!toastSet) return;
  const id = Math.random();
  toastSet((l) => [...l, { id, text, kind }]);
  setTimeout(() => toastSet((l) => l.filter((x) => x.id !== id)), 3200);
}
export function Toasts() {
  const [list, set] = useState([]);
  useEffect(() => { toastSet = set; return () => { toastSet = null; }; }, []);
  return html`<div class="toasts" role="status" aria-live="polite">${list.map((t) => html`<div class=${`toast ${t.kind}`} key=${t.id}>${t.text}</div>`)}</div>`;
}

// ============================== Thành phần giao diện ==============================
export const Spinner = ({ sm }) => html`<div class=${`spinner ${sm ? 'sm' : ''}`} role="progressbar" aria-label="Đang tải"></div>`;
export const Loading = ({ text = 'Đang tải…' }) => html`<div class="stack center" style="align-items:center;padding:48px 0"><${Spinner}/><div class="muted">${text}</div></div>`;
export const ErrorBox = ({ error, retry }) => html`<div class="banner err"><${Icon} name="alert"/><div class="grow"><b>${error?.message || 'Có lỗi xảy ra'}</b>${retry && html`<button class="btn sm line" style="margin-top:8px" onClick=${retry}>Thử lại</button>`}</div></div>`;
export const Empty = ({ icon = 'doc', title, text, children }) => html`<div class="stack center" style="align-items:center;padding:40px 16px"><div class="ico-tile lg"><${Icon} name=${icon}/></div><h2>${title}</h2>${text && html`<p class="muted" style="max-width:36ch">${text}</p>`}${children}</div>`;
export const Pill = ({ tone = '', children }) => html`<span class=${`pill ${tone}`}>${children}</span>`;
export const Banner = ({ tone = '', icon = 'alert', title, children }) => html`<div class=${`banner ${tone}`}><${Icon} name=${icon}/><div class="grow">${title && html`<b>${title}</b>`}${children}</div></div>`;

export function Field({ label, hint, error, children }) {
  return html`<div class="field">${label && html`<label>${label}</label>`}${children}${error ? html`<div class="errtext">${error}</div>` : hint && html`<div class="hint">${hint}</div>`}</div>`;
}

export function Switch({ checked, onChange, disabled, label }) {
  return html`<button type="button" role="switch" class="switch" aria-checked=${!!checked} aria-label=${label} disabled=${disabled} onClick=${() => onChange(!checked)}></button>`;
}

/** Lớp phủ dạng thẻ trượt từ dưới (hoặc hộp giữa màn hình). */
export function Sheet({ onClose, center, children }) {
  useEffect(() => { const f = (e) => e.key === 'Escape' && onClose?.(); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);
  return html`<div class=${`overlay ${center ? 'center' : ''}`} onClick=${(e) => e.target === e.currentTarget && onClose?.()}><div class="sheet" role="dialog" aria-modal="true">${children}</div></div>`;
}

/** Hộp xác nhận dựng sẵn trong trang (trình duyệt không dùng confirm()). */
export function Confirm({ title, text, ok = 'Xác nhận', cancel = 'Quay lại', danger, busy, onOk, onCancel, children }) {
  return html`<${Sheet} center onClose=${onCancel}><h2>${title}</h2>${text && html`<p class="muted">${text}</p>`}${children}
    <div class="stack"><button class=${`btn ${danger ? 'danger' : 'primary'}`} disabled=${busy} onClick=${onOk}>${busy ? html`<${Spinner} sm/>` : ok}</button><button class="btn txt" onClick=${onCancel}>${cancel}</button></div><//>`;
}

/** Menu bên, giống kiểu ứng dụng nội bộ: biểu tượng nét mảnh, mục đang chọn tô cam nhạt. */
export function Drawer({ open, onClose, items, active, onSelect, user, sub, onLogout }) {
  if (!open) return null;
  return html`<div><div class="drawer-bg" onClick=${onClose}></div>
    <nav class="drawer" aria-label="Menu">
      <div class="row" style="padding:6px 6px 14px"><${Logo}/><b style="font-size:20px">BRG Scan & Checkout</b><button class="iconbtn end" onClick=${onClose} aria-label="Đóng menu"><${Icon} name="x"/></button></div>
      <div class="stack" style="gap:4px">${items.map((it) => it.group
        ? html`<div class="label" style="padding:14px 16px 4px">${it.group}</div>`
        : html`<button class=${`navitem ${active === it.id ? 'on' : ''}`} onClick=${() => { onSelect(it.id); onClose(); }}><${Icon} name=${it.icon}/><span class="grow">${it.label}</span>${it.badge ? html`<${Pill} tone="warn">${it.badge}<//>` : null}</button>`)}</div>
      <div class="me"><div class="avatar">${(user?.name || '?').slice(0, 1).toUpperCase()}</div><div class="grow"><div class="b">${user?.name}</div><div class="small muted">${sub}</div></div>
        <button class="iconbtn" onClick=${onLogout} aria-label="Đăng xuất"><${Icon} name="logout"/></button></div>
    </nav></div>`;
}

/** Thanh tiêu đề: logo + tên hoặc nút quay lại + tiêu đề. */
export function Header({ title, onBack, onMenu, right, sub }) {
  return html`<header class="hdr">
    ${onBack ? html`<button class="iconbtn" onClick=${onBack} aria-label="Quay lại"><${Icon} name="chevl"/></button>` : html`<${Logo}/>`}
    ${title ? html`<div class="title">${title}${sub && html`<div class="small muted" style="font-weight:500">${sub}</div>`}</div>` : html`<div class="brand"><span>BRG Scan & Checkout</span></div>`}
    ${right}${onMenu && html`<button class="iconbtn" onClick=${onMenu} aria-label="Mở menu"><${Icon} name="menu"/></button>`}
  </header>`;
}

export const OfflineBar = () => (useOnline() ? null : html`<div class="offline-bar" role="alert">Mất kết nối. Một số chức năng tạm thời không dùng được.</div>`);

/** Bàn phím số cho PIN và số tiền. */
export function Keypad({ onKey }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  return html`<div class="keypad">${keys.map((k) => k ? html`<button type="button" onClick=${() => onKey(k)} aria-label=${k === '⌫' ? 'Xoá' : k}>${k}</button>` : html`<span></span>`)}</div>`;
}

/** Tải một file ra máy (dùng với blob từ api.download). */
export function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export const copyText = async (t) => { try { await navigator.clipboard.writeText(t); toast('Đã sao chép', 'ok'); } catch { toast('Không sao chép được, hãy chọn và sao chép thủ công'); } };

// ============================== Quét mã bằng camera ==============================
let zxingPromise;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  zxingPromise ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = '/shared/vendor/zxing.min.js';
    s.onload = () => res(window.ZXing); s.onerror = () => rej(new Error('Không tải được bộ giải mã dự phòng')); document.head.appendChild(s);
  });
  return zxingPromise;
}

/**
 * Khung camera quét mã. kind: 'barcode' (mã vạch sản phẩm) | 'qr'.
 * Dùng BarcodeDetector của trình duyệt nếu có, nếu không dùng thư viện ZXing (Safari iOS).
 * onScan(text) được gọi cho mỗi mã đọc được (bỏ qua mã lặp trong 2 giây).
 */
export function Scanner({ kind = 'barcode', onScan, onState, paused = false, status = '', hint, children, fill = false }) {
  const video = useRef(null);
  const [state, setState] = useState('starting'); // starting | running | denied | nocamera | insecure | error
  const [torch, setTorch] = useState({ can: false, on: false });
  const [attempt, setAttempt] = useState(0);
  const stream = useRef(null);
  const cb = useRef(onScan); cb.current = onScan;
  const pausedRef = useRef(paused); pausedRef.current = paused;
  useEffect(() => { onState?.(state); }, [state]);

  useEffect(() => {
    let stopped = false, raf = 0, timer = 0, last = { text: '', at: 0 };
    async function start() {
      if (!window.isSecureContext && location.hostname !== 'localhost') return setState('insecure');
      if (!navigator.mediaDevices?.getUserMedia) return setState('nocamera');
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      } catch (e) {
        return setState(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError' ? 'nocamera' : 'error');
      }
      if (stopped) return stream.current.getTracks().forEach((t) => t.stop());
      const v = video.current; v.srcObject = stream.current; v.setAttribute('playsinline', ''); v.muted = true;
      try { await v.play(); } catch { /* sẽ phát khi người dùng chạm */ }
      const track = stream.current.getVideoTracks()[0];
      setTorch({ can: !!track.getCapabilities?.().torch, on: false });
      setState('running');

      const emit = (text) => {
        const now = Date.now();
        if (!text || pausedRef.current || (text === last.text && now - last.at < 2000)) return;
        last = { text, at: now };
        navigator.vibrate?.(40);
        cb.current?.(text);
      };

      const formats = kind === 'qr' ? ['qr_code'] : ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
      let detector = null;
      if ('BarcodeDetector' in window) {
        try {
          const supported = await BarcodeDetector.getSupportedFormats();
          const use = formats.filter((f) => supported.includes(f));
          if (use.length) detector = new BarcodeDetector({ formats: use });
        } catch { /* dùng ZXing */ }
      }
      if (detector) {
        const loop = async () => {
          if (stopped) return;
          try { if (v.readyState >= 2 && !pausedRef.current) { const r = await detector.detect(v); if (r[0]) emit(r[0].rawValue); } } catch { /* khung hình lỗi */ }
          timer = setTimeout(() => { raf = requestAnimationFrame(loop); }, 110);
        };
        loop();
        return;
      }
      try {
        const Z = await loadZxing();
        const hints = new Map();
        hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, (kind === 'qr' ? ['QR_CODE'] : ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'ITF']).map((f) => Z.BarcodeFormat[f]));
        hints.set(Z.DecodeHintType.TRY_HARDER, true);
        const reader = new Z.MultiFormatReader(); reader.setHints(hints);
        const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const loop = () => {
          if (stopped) return;
          if (v.readyState >= 2 && v.videoWidth && !pausedRef.current) {
            const w = Math.min(v.videoWidth, 960), hgt = Math.round(w * v.videoHeight / v.videoWidth);
            canvas.width = w; canvas.height = hgt; ctx.drawImage(v, 0, 0, w, hgt);
            try {
              const src = new Z.HTMLCanvasElementLuminanceSource(canvas);
              emit(reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(src))).getText());
            } catch { /* không có mã trong khung hình */ }
          }
          timer = setTimeout(() => { raf = requestAnimationFrame(loop); }, 120);
        };
        loop();
      } catch { setState('error'); }
    }
    start();
    return () => { stopped = true; cancelAnimationFrame(raf); clearTimeout(timer); stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  }, [kind, attempt]);

  async function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0]; if (!track) return;
    const on = !torch.on;
    try { await track.applyConstraints({ advanced: [{ torch: on }] }); setTorch({ can: true, on }); } catch { toast('Máy này không bật được đèn flash'); }
  }

  const msgs = {
    denied: ['Camera đang bị chặn', 'Hãy bật quyền camera cho trang này trong cài đặt trình duyệt rồi thử lại.'],
    nocamera: ['Không tìm thấy camera', 'Thiết bị này không có camera dùng được. Bạn có thể nhập mã bằng tay.'],
    insecure: ['Cần kết nối bảo mật (HTTPS)', 'Trình duyệt chỉ cho dùng camera trên trang HTTPS.'],
    error: ['Không mở được camera', 'Hãy thử lại hoặc nhập mã bằng tay.']
  };
  const cls = fill ? 'cam' : 'cam';
  return html`<div class=${cls} style=${fill ? 'position:absolute;inset:0;border-radius:0' : 'aspect-ratio:3/4;max-height:62vh;width:100%'}>
    <video ref=${video} autoplay playsinline muted></video>
    ${state === 'running' && html`<div class=${`reticle ${kind === 'qr' ? 'sq' : ''} ${status}`}><b></b><b></b><b></b><b></b>${!status && html`<div class="laser"></div>`}</div>`}
    ${state === 'starting' && html`<div class="msg"><${Spinner}/><div>Đang mở camera…</div></div>`}
    ${msgs[state] && html`<div class="msg"><${Icon} name="camera" size=${44}/><b style="font-size:18px">${msgs[state][0]}</b><div style="opacity:.85;max-width:30ch">${msgs[state][1]}</div>${state !== 'insecure' && html`<button class="btn soft" onClick=${() => { setState('starting'); setAttempt((n) => n + 1); }}>Thử lại</button>`}</div>`}
    ${state === 'running' && html`<div class="tools">${torch.can && html`<button class="iconbtn" onClick=${toggleTorch} aria-label="Đèn flash" aria-pressed=${torch.on}><${Icon} name="flash"/></button>`}</div>`}
    ${state === 'running' && (hint || children) && html`<div class="hintbar">${hint}${children}</div>`}
  </div>`;
}

// ============================== Service worker ==============================
export function registerSW(path, scope) {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(path, { scope }).catch(() => {});
}
