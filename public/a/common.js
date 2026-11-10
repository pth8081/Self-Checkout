// Thành phần và tiện ích dùng chung của web quản trị.
import { html, useState, useRef, useEffect, createApi, Icon, Pill, Banner, toast, fmt, todayStr, ErrorBox, Loading, Empty, Confirm } from '/shared/lib.js';

export const S = { token: null, onLogout: null };
export const api = createApi({
  base: '/api/a',
  headers: () => (S.token ? { Authorization: `Bearer ${S.token}` } : {}),
  onUnauthorized: () => S.onLogout?.()
});

export const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* bỏ qua */ } }
};

// ---------- Từ điển tiếng Việt ----------
export const ROLE_VI = { chain_admin: 'Quản trị chuỗi', branch_admin: 'Quản trị chi nhánh', cashier: 'Thu ngân', gate: 'Kiểm soát cổng', cashier_gate: 'Thu ngân kiêm cổng' };
export const STAFF_ROLES = ['cashier', 'gate', 'cashier_gate'];
export const TX_STATUS = {
  awaiting_counter: ['Chờ thu tiền', 'warn'], paid: ['Đã thu tiền', 'ok'], voided: ['Đã hủy', 'err'], cancelled: ['Đã hủy giỏ', ''],
  locked: ['Đã khóa giỏ', 'info'], active: ['Đang mua', 'info']
};
export const EXIT_STATUS = { none: ['Chưa ra cổng', ''], checking: ['Đang kiểm tra', 'warn'], held: ['Chờ quản lý', 'err'], exited: ['Đã ra cổng', 'ok'] };
export const POS_STATUS = { claimed: ['Đã nhận', 'info'], paid: ['Đã thanh toán', 'ok'], cancelled: ['Đã hủy', 'err'] };
export const posPill = (s) => { const [t, tone] = POS_STATUS[s] || [s || '–', '']; return html`<${Pill} tone=${tone}>${t}<//>`; };
export const PAY_SOURCE = { manual: 'Tự thu trong BRG', pos: 'Qua Dsmart POS' };
/** Cấu hình của một chi nhánh (từ danh sách chi nhánh đã gộp cấu hình ở app.js). */
export const cfgOf = (stores, id) => stores?.find((s) => s.id === id)?.config || {};
export const isPos = (cfg) => cfg?.paymentSource === 'pos' || cfg?.checkoutMode === 'basket'; // giỏ QR cũng là Dsmart POS thu tiền
export const noGuard = (cfg) => cfg?.guardCheck === false || cfg?.checkoutMode === 'basket'; // giỏ QR cho Dsmart POS cũng không có bước cổng ra
/** Người thu: khoản thu do Dsmart POS ghi có dạng "Dsmart POS:tên" -> "Dsmart POS (tên)". */
export const payerLabel = (by) => (String(by || '').startsWith('Dsmart POS:') ? `Dsmart POS (${by.slice(4)})` : by);
export const BIN_NOTE = 'Ví dụ 970436 (Vietcombank), 970415 (VietinBank), 970418 (BIDV)';
export const SHIFT_VI = { sang: 'Sáng', chieu: 'Chiều' };

export const txPill = (s) => { const [t, tone] = TX_STATUS[s] || [s, '']; return html`<${Pill} tone=${tone}>${t}<//>`; };
export const exitPill = (s) => { const [t, tone] = EXIT_STATUS[s] || [s, '']; return html`<${Pill} tone=${tone}>${t}<//>`; };

const ACTION_VI = {
  'admin.login': () => 'Đăng nhập quản trị',
  'staff.login': () => 'Nhân viên đăng nhập',
  'cart.locked': () => 'Khách khóa giỏ hàng để thanh toán',
  'cart.unlocked': () => 'Khách mở lại giỏ để sửa',
  'cart.cancelled': () => 'Hủy giỏ chờ thu',
  'cart.expired': (d) => `Mã QR hết hạn${d?.lockedMinutes ? ` (quá ${d.lockedMinutes} phút chưa thanh toán)` : ''}, hủy đơn`,
  'retention.run': (d) => `Tự dọn dữ liệu quá hạn (${d?.piiTransactions || 0} đơn xóa thông tin cá nhân)`,
  'retention.run_manual': () => 'Quản trị bấm Dọn ngay dữ liệu quá hạn',
  'retention.config_saved': () => 'Đổi thời hạn giữ dữ liệu',
  'privacy.erase': (d) => `Xóa dữ liệu cá nhân theo yêu cầu của khách (${d?.transactions || 0} đơn có email, ${d?.transactionsByDevice || 0} đơn theo thiết bị)${d?.note ? `. Ghi chú: ${d.note}` : ''}`,
  'payment.collected': () => 'Thu tiền',
  'payment.extra_collected': () => 'Thu tiền bổ sung',
  'gate.check_required': () => 'Cổng chọn kiểm tra ngẫu nhiên',
  'gate.exited': () => 'Khách ra cổng',
  'check.match': () => 'Kiểm tra ngẫu nhiên: khớp',
  'check.mismatch': () => 'Kiểm tra ngẫu nhiên: chênh lệch',
  'check.resolved_allow': () => 'Quản lý cho qua',
  'check.resolved_deny': () => 'Quản lý từ chối cho qua',
  'invoice.issued': () => 'Xuất hóa đơn điện tử',
  'invoice.failed': () => 'Xuất hóa đơn điện tử lỗi',
  'pos.sync': () => 'Đồng bộ dữ liệu Dsmart POS',
  'pos.key_created': () => 'Tạo khóa API cho Dsmart POS',
  'pos.key_revoked': () => 'Thu hồi khóa API của Dsmart POS',
  'pos.claimed': () => 'Dsmart POS nhận giỏ hàng',
  'pos.released': () => 'Quản lý nhả giỏ khỏi Dsmart POS',
  'pos.amount_differs': () => 'Số tiền Dsmart POS lệch với BRG',
  'pos.cancel_after_exit': () => 'Dsmart POS báo hủy sau khi khách đã ra',
  'shift.started': () => 'Bắt đầu ca',
  'shift.ended': () => 'Kết thúc ca',
  'statement.uploaded': () => 'Tải lên sao kê ngân hàng',
  'store.config_updated': () => 'Đổi cấu hình chi nhánh',
  'store.created': () => 'Thêm chi nhánh',
  'store.updated': () => 'Cập nhật chi nhánh',
  'transaction.voided': () => 'Hủy giao dịch',
  'user.created': () => 'Tạo tài khoản',
  'user.updated': () => 'Cập nhật tài khoản',
  'user.pin_reset': () => 'Đặt lại mã PIN',
  'user.password_reset': () => 'Đặt lại mật khẩu',
  'user.totp_on': () => 'Bật xác thực 2 bước',
  'user.totp_off': () => 'Tắt xác thực 2 bước'
};
export const actionLabel = (a) => (ACTION_VI[a] ? ACTION_VI[a]() : a);
export const ACTOR_VI = { admin: 'Quản trị', staff: 'Nhân viên', customer: 'Khách', system: 'Hệ thống' };

/** Mô tả ngắn các dữ liệu kèm theo sự kiện nhật ký. */
export function auditDetail(ev) {
  const d = ev.data; if (!d || typeof d !== 'object') return '';
  const p = [];
  if (d.reason) p.push(`Lý do: ${d.reason}`);
  if (d.note) p.push(`Ghi chú: ${d.note}`);
  if (d.method) p.push(fmt.method(d.method));
  if (d.total != null) p.push(fmt.money(d.total));
  if (d.amount != null) p.push(fmt.money(d.amount));
  if (d.role) p.push(ROLE_VI[d.role] || d.role);
  if (d.active === true) p.push('Mở khóa');
  if (d.active === false) p.push('Khóa');
  if (d.enabled === true) p.push('Bật');
  if (d.enabled === false && ev.action.startsWith('store')) p.push('Tắt');
  if (d.payCash !== undefined) p.push(`Tiền mặt: ${d.payCash ? 'bật' : 'tắt'}`);
  if (d.payQr !== undefined) p.push(`Chuyển khoản: ${d.payQr ? 'bật' : 'tắt'}`);
  if (d.randomCheckRate !== undefined) p.push(`Tỷ lệ kiểm tra: ${fmt.pct(d.randomCheckRate)}`);
  if (d.paymentSource !== undefined) p.push(`Thu tiền: ${PAY_SOURCE[d.paymentSource] || d.paymentSource}`);
  if (d.guardCheck !== undefined) p.push(`Bảo vệ cổng ra: ${d.guardCheck ? 'bật' : 'tắt'}`);
  if (d.name && ev.action.startsWith('pos.key')) p.push(`Khóa: ${d.name}`);
  if (d.bank) p.push('Cập nhật thông tin ngân hàng');
  if (d.posStaleMinutes !== undefined) p.push(`Ngưỡng Dsmart POS: ${d.posStaleMinutes} phút`);
  if (d.date) p.push(`Ngày ${d.date}`);
  if (d.lines != null) p.push(`${d.lines} dòng`);
  if (d.number) p.push(`Số ${d.number}`);
  if (d.error) p.push(d.error);
  if (d.diff != null) p.push(`Lệch ${fmt.money(d.diff)}`);
  return p.join(' · ');
}

// ---------- Tiện ích ----------
export const dm = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
export const addDays = (s, n) => new Date(new Date(`${s}T12:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);
export const dayName = (s) => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(`${s}T12:00:00Z`).getUTCDay()];
export { todayStr };

/** Chạy một thao tác bất đồng bộ, chống bấm đúp, báo lỗi bằng thông báo nhanh. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async (fn, okMsg) => {
    if (lock.current) return undefined;
    lock.current = true; setBusy(true);
    try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); return r ?? true; }
    catch (e) { toast(e?.message || 'Có lỗi xảy ra', 'err'); return undefined; }
    finally { lock.current = false; setBusy(false); }
  };
  return [busy, run];
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// ---------- Thành phần ----------
export const PageHead = ({ title, sub, children }) => html`<div class="pagehead"><div style="flex:1;min-width:200px"><h1>${title}</h1>${sub && html`<div class="sub">${sub}</div>`}</div>${children}</div>`;

export const Tile = ({ k, v, tone = '', small }) => html`<div class=${`tilebox ${tone}`}><div class="k">${k}</div><div class=${`v ${small ? 'sm' : ''}`}>${v}</div></div>`;

/** Gói trạng thái tải / lỗi / trống quanh nội dung. */
export function Async({ state, children, emptyIf }) {
  if (state.loading && !state.data) return html`<${Loading}/>`;
  if (state.error && !state.data) return html`<${ErrorBox} error=${state.error} retry=${state.reload}/>`;
  if (!state.data) return null;
  return children(state.data);
}

/** Bộ chọn chi nhánh cho quản trị chuỗi; quản trị chi nhánh chỉ thấy tên chi nhánh. */
export function StoreBar({ me, stores, storeId, setStoreId }) {
  const cur = stores.find((s) => s.id === storeId);
  if (me.role !== 'chain_admin') return html`<div class="row small muted"><${Icon} name="store"/><b style="color:var(--ink)">${cur?.name || storeId}</b></div>`;
  return html`<div class="toolbar"><div class="field"><label for="store-pick">Chi nhánh đang xem</label>
    <select id="store-pick" class="input" value=${storeId} onChange=${(e) => setStoreId(e.target.value)}>${stores.map((s) => html`<option value=${s.id} key=${s.id}>${s.name}${s.enabled ? '' : ' (đang tắt)'}</option>`)}</select></div></div>`;
}

/** Biểu đồ cột SVG. data: [{label, value, hl}]; hiển thị giá trị theo triệu đồng. */
export function BarChart({ data, height = 190, title = 'Biểu đồ doanh thu' }) {
  const W = window.innerWidth < 600 ? 340 : 640, H = height, padL = 8, padR = 8, padT = 26, padB = 26;
  const max = Math.max(1, ...data.map((d) => d.value));
  const niceMax = (() => { const m = max / 1e6; const step = m <= 1 ? 0.5 : m <= 5 ? 1 : m <= 10 ? 2 : m <= 50 ? 10 : 50; return Math.ceil(m / step) * step * 1e6; })();
  const n = data.length, bw = Math.min(48, ((W - padL - padR) / n) * 0.62), slot = (W - padL - padR) / n;
  const ch = H - padT - padB;
  const every = n > 16 ? Math.ceil(n / (W < 400 ? 6 : 12)) : 1;
  const lbl = (v) => (v === 0 ? '0' : `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.', ',').replace(/,0$/, '')}`);
  return html`<div><svg class="chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${`${title}, đơn vị triệu đồng`}>
    <title>${title}</title>
    <line class="grid" x1=${padL} x2=${W - padR} y1=${H - padB} y2=${H - padB}/>
    <line class="grid" x1=${padL} x2=${W - padR} y1=${padT} y2=${padT} stroke-dasharray="3 4"/>
    ${data.map((d, i) => {
      const h = Math.max(d.value > 0 ? 3 : 0, (d.value / niceMax) * ch), x = padL + slot * i + (slot - bw) / 2, y = H - padB - h;
      return html`<g class="hit" key=${i}><title>${`${d.label}: ${fmt.money(d.value)}`}</title>
        <rect class=${`bar ${d.hl ? 'hl' : ''}`} x=${x} y=${y} width=${bw} height=${h} rx="6"/>
        ${(n <= 16 || i % every === 0) && html`<text x=${x + bw / 2} y=${H - 8} text-anchor="middle">${d.label}</text>`}
        ${(n <= 16 || d.hl) && d.value > 0 && html`<text class="val" x=${x + bw / 2} y=${y - 6} text-anchor="middle">${lbl(d.value)}</text>`}</g>`;
    })}
  </svg><div class="xs muted" style="text-align:right">Đơn vị: triệu đồng</div></div>`;
}

export { html, Icon, Pill, Banner, Empty, Confirm, ErrorBox, Loading };
