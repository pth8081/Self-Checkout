// Phần dùng chung của PWA nhân viên: gọi API, trạng thái phiên, thành phần giao diện nhỏ.
import { html, createApi, toast, useState, useRef, useCallback, useEffect, useAsync, Header, Icon, Banner, Pill, Keypad, Loading, ErrorBox, Empty, fmt, go } from '/shared/lib.js';

const TK = 'brg.s.token';
let token = null;
try { token = localStorage.getItem(TK); } catch { /* bỏ qua */ }
export const getToken = () => token;
export const setToken = (t) => {
  token = t;
  try { t ? localStorage.setItem(TK, t) : localStorage.removeItem(TK); } catch { /* bỏ qua */ }
};
let onUnauth = () => {};
export const setOnUnauth = (f) => { onUnauth = f; };
const rawApi = createApi({
  base: '/api/s',
  headers: () => (token ? { Authorization: `Bearer ${token}` } : {}),
  onUnauthorized: () => { if (token) onUnauth(); }
});

/** Cờ chi nhánh: pos = thu tiền qua Dsmart POS, guard = có bước kiểm tra của bảo vệ ở cổng ra. */
export const flagsOf = (store) => ({ pos: store?.paymentSource === 'pos', guard: store?.guardCheck !== false });
export const POS_TEXT = 'Chi nhánh này thu tiền trên máy tính tiền (Dsmart POS). Thu ngân quét mã giỏ hàng của khách trong phần mềm Dsmart POS. Hệ thống tự xác nhận khi Dsmart POS báo đã thanh toán.';
export const GUARD_TEXT = 'Chi nhánh này không dùng bước kiểm tra của bảo vệ. Khách thanh toán xong là ra luôn, không có mã QR ra cổng.';
const FLAG_MSG = { POS_MODE: 'Chi nhánh đã chuyển sang thu tiền trên Dsmart POS. Thu ngân quét mã giỏ hàng trong phần mềm Dsmart POS.', GUARD_DISABLED: 'Chi nhánh không còn dùng bước kiểm tra của bảo vệ ở cổng ra.' };
let onFlagChange = () => {};
export const setOnFlagChange = (f) => { onFlagChange = f; };
let lastFlagAt = 0;
function guarded(fn) {
  return async (...a) => {
    try { return await fn(...a); }
    catch (e) {
      if (FLAG_MSG[e?.code]) {
        e.message = FLAG_MSG[e.code]; e.flagHandled = true;
        if (Date.now() - lastFlagAt > 1500) { lastFlagAt = Date.now(); onFlagChange(e); }
      }
      throw e;
    }
  };
}
export const api = { get: guarded(rawApi.get), post: guarded(rawApi.post), put: guarded(rawApi.put), del: guarded(rawApi.del), download: rawApi.download };

/** Trạng thái chuyển giữa các màn hình (kết quả cổng, màn "Đã thu", ca vừa kết thúc). */
export const flash = { done: null, gate: null, lastShift: null, denied: new Set() };

/** Chống bấm đúp: run(fn) chỉ chạy một lần tại một thời điểm, lỗi hiện thành thông báo. */
export function useBusy() {
  const [busy, set] = useState(false);
  const lock = useRef(false);
  const run = useCallback(async (fn, onError) => {
    if (lock.current) return undefined;
    lock.current = true; set(true);
    try { return await fn(); }
    catch (e) {
      if (e?.flagHandled) return undefined;
      if (onError && onError(e) === true) return undefined;
      toast(e?.message || 'Có lỗi xảy ra, vui lòng thử lại', 'err');
      return undefined;
    } finally { lock.current = false; set(false); }
  }, []);
  return [busy, run];
}

export function beep(ok = true) {
  try {
    navigator.vibrate?.(ok ? 60 : [80, 60, 80]);
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    const ac = new A(), o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = ok ? 880 : 300; g.gain.value = 0.05; o.connect(g); g.connect(ac.destination);
    o.start(); setTimeout(() => { o.stop(); ac.close(); }, ok ? 120 : 280);
  } catch { /* không bắt buộc */ }
}

export const enc = encodeURIComponent;

/** Thanh tiêu đề: trang chính có nút menu, trang con có nút quay lại. */
export function Top({ c, title, sub, back, right }) {
  return html`<${Header} title=${title} sub=${sub} right=${right} onBack=${back ? () => (typeof back === 'string' ? go(back) : history.length > 1 ? history.back() : go('/')) : null} onMenu=${back ? null : c.openMenu}/>`;
}

export function roleName(u) {
  return { cashier: 'Thu ngân', gate: 'Cổng ra', cashier_gate: 'Thu ngân + cổng ra', branch_admin: 'Quản lý chi nhánh', chain_admin: 'Quản lý chuỗi' }[u?.role] || 'Nhân viên';
}

export function txStatus(t) {
  if (t.guardCheck === false && t.status === 'paid' && t.extraDue <= 0) return { text: 'Đã thu tiền', tone: 'ok' };
  if (t.exitStatus === 'held') return { text: 'Chờ quản lý', tone: 'err' };
  if (t.exitStatus === 'exited') return { text: 'Đã ra cổng', tone: 'ok' };
  if (t.status === 'awaiting_counter') return { text: 'Chờ thu tiền', tone: 'warn' };
  if (t.status === 'paid' && t.extraDue > 0) return { text: 'Còn thu bổ sung', tone: 'warn' };
  if (t.status === 'paid') return { text: t.exitStatus === 'checking' ? 'Đang kiểm tra' : 'Đã thu tiền', tone: t.exitStatus === 'checking' ? 'info' : 'brand' };
  if (t.status === 'cancelled') return { text: 'Đã huỷ', tone: '' };
  if (t.status === 'voided') return { text: 'Đã huỷ thu', tone: 'err' };
  return { text: t.status, tone: '' };
}

/** Tải giao dịch (kèm danh sách mặt hàng) theo mã nội bộ. */
export function useTx(id) {
  return useAsync(async () => (await api.get(`/transactions/${enc(id)}`)).transaction, [id]);
}

export function Page({ children, bottom, wide }) {
  return html`<main class=${`page ${bottom ? 'pad-b' : ''} ${wide ? 'wide' : ''}`}>${children}</main>`;
}
export const BottomBar = ({ children }) => html`<div class="bar-bottom"><div class="in">${children}</div></div>`;

/** Báo chưa bắt đầu ca. */
export function NeedShift({ c }) {
  if (c.shift) return null;
  return html`<${Banner} tone="err" icon="clock" title="Bạn chưa bắt đầu ca">Hãy bắt đầu ca ở trang chính trước khi thu tiền.
    <div style="margin-top:8px"><button class="btn sm line" onClick=${() => go('/')}>Về trang chính</button></div><//>`;
}

/** Màn thông báo khi chức năng không dùng ở chi nhánh này (vào bằng địa chỉ cũ). */
export function Unavailable({ c, kind }) {
  const pos = kind === 'pos';
  return html`<${Top} c=${c} title=${pos ? 'Thu tiền qua Dsmart POS' : 'Không có bước cổng ra'} back="/"/><${Page}>
    <${Empty} icon=${pos ? 'cash' : 'shield'} title=${pos ? 'Thu tiền trên máy tính tiền' : 'Không cần kiểm tra cổng ra'} text=${pos ? POS_TEXT : GUARD_TEXT}>
      ${pos && html`<p class="small muted">Nếu Dsmart POS bị lỗi và cần thu thủ công, hãy báo quản lý chuyển chi nhánh về chế độ thủ công trong web quản trị.</p>`}
      <button class="btn primary" onClick=${() => go('/')}>Về trang chính</button><//><//>`;
}

export function Denied({ c, text }) {
  return html`<${Top} c=${c} title="Không có quyền"/><${Page}><${Banner} tone="err" title="Tài khoản chưa được phân quyền">${text || 'Hãy hỏi quản lý để được cấp quyền cho chức năng này.'}<//><//>`;
}

export function Tick({ on, onChange, children }) {
  return html`<button type="button" role="checkbox" aria-checked=${!!on} class=${`tick ${on ? 'on' : ''}`} onClick=${() => onChange(!on)}>
    <span class="box">${on && html`<${Icon} name="check"/>`}</span><span class="grow">${children}</span></button>`;
}

/** Ô số tiền kèm bàn phím số (đặt vào chuỗi chữ số). */
export function digitsKey(v, k, max = 10) {
  if (k === '⌫') return v.slice(0, -1);
  if (v.length >= max) return v;
  if (v === '' && k === '0') return v;
  return v + k;
}
export function MoneyPad({ value, onChange, max = 10 }) {
  return html`<${Keypad} onKey=${(k) => onChange(digitsKey(value, k, max))}/>`;
}

export const Fetching = ({ st }) => (st.loading && !st.data ? html`<${Loading}/>` : st.error ? html`<${ErrorBox} error=${st.error} retry=${st.reload}/>` : null);

/** Danh sách hàng đợi thu tiền. */
export function QueueList({ carts }) {
  return html`<div class="stack">${carts.map((q) => html`<button key=${q.id} class="card tight qitem" onClick=${() => go(`/gio/${enc(q.id)}`)}>
    <div class="ico-tile"><${Icon} name=${q.method === 'cash' ? 'cash' : 'qr'}/></div>
    <div class="grow"><div class="b">${q.code}</div><div class="small muted">${q.itemCount} sản phẩm · ${fmt.method(q.method)} · ${fmt.ago(q.createdAt)}</div>
      ${q.checkRequired && html`<div style="margin-top:4px"><${Pill} tone="warn">Cần kiểm tra ngẫu nhiên<//></div>`}</div>
    <div class="b num">${fmt.money(q.total)}</div><${Icon} name="chev"/></button>`)}</div>`;
}

export const CSS = `
.actcard{display:flex;align-items:center;gap:16px;width:100%;text-align:left;border:1px solid color-mix(in srgb,var(--line) 60%,transparent);background:var(--card);border-radius:var(--r-card);padding:20px;box-shadow:var(--shadow);min-height:96px}
.actcard:active{transform:scale(.99)}
.actcard .t{font-size:18px;font-weight:800}
.actcard .ico-tile{width:56px;height:56px;border-radius:18px}
.actcard.main{background:var(--orange);color:var(--on-orange);border-color:transparent}
.actcard.main .ico-tile{background:rgba(255,255,255,.22);color:inherit}
.actcard.main .muted{color:inherit;opacity:.9}
.qitem{flex-direction:row;align-items:center;text-align:left;width:100%;border:1px solid color-mix(in srgb,var(--line) 60%,transparent);gap:12px}
.bigamt{font-size:44px;line-height:1.1;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;word-break:break-word}
.bigtxt{font-size:30px;line-height:1.15;font-weight:800;letter-spacing:.02em;word-break:break-word}
.amountbox{background:var(--surface);border-radius:20px;padding:14px 18px;display:flex;flex-direction:column;gap:2px}
.amountbox.in{background:var(--card);border:2px solid var(--orange)}
.change{border-radius:20px;padding:14px 18px;background:var(--ok-soft);color:var(--ok)}
.change.short{background:var(--warn-soft);color:var(--warn)}
.change .bigamt{font-size:40px}
.tick{display:flex;align-items:center;gap:14px;width:100%;text-align:left;border:1.5px solid var(--line);background:var(--card);border-radius:18px;padding:14px 16px;min-height:60px;font-weight:600}
.tick .box{width:28px;height:28px;border-radius:9px;border:2px solid var(--line);display:grid;place-items:center;flex:none;color:#fff}
.tick.on{border-color:var(--ok);background:var(--ok-soft)}
.tick.on .box{background:var(--ok);border-color:var(--ok)}
.progress{height:10px;border-radius:99px;background:var(--surface);overflow:hidden}
.progress>i{display:block;height:100%;background:var(--orange);border-radius:99px;transition:width .2s}
.qty{min-width:56px;height:44px;border-radius:14px;background:var(--surface);display:grid;place-items:center;font-weight:800;font-size:20px;padding:0 10px;flex:none}
.tick.on .qty{background:var(--card)}
.dots{display:flex;gap:10px;justify-content:center;min-height:52px;align-items:center;background:var(--surface);border-radius:16px}
.dots i{width:14px;height:14px;border-radius:50%;background:var(--ink)}
.dots span{color:var(--muted)}
.result .big.lgi{margin-top:12px}
.result .actions{margin-top:auto;display:flex;flex-direction:column;gap:10px}
.result .glass.big-n{font-size:15px}
.result .xl{font-size:44px;font-weight:800;text-align:center;font-variant-numeric:tabular-nums}
.sheet textarea.input{min-height:84px}
.scanwrap{position:relative}
.tilebox.sm .v{font-size:19px}
@media(min-width:700px){.result{align-items:center}.result>*{width:100%;max-width:520px}}
`;
