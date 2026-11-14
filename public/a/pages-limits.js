// Cấu hình thời gian và giới hạn giỏ hàng: giá trị chung cho toàn chuỗi + ghi đè riêng từng chi nhánh.
import { html, useState, useAsync, Switch } from '/shared/lib.js';
import { api, PageHead, Async, Banner, useBusy } from '/a/common.js';

const ORDER = ['lockedMinutes', 'receiptMinutes', 'idleHours', 'maxShopHours', 'maxItems', 'maxQty'];
const DESC = {
  lockedMinutes: 'Sau khi khách bấm "Thanh toán", mã QR giỏ hàng chờ thu ngân tối đa bao lâu. Quá hạn mà chưa thanh toán: mã QR hết hạn, giỏ tự giải phóng trả lại cho khách. Dsmart POS báo thanh toán muộn vẫn được ghi nhận.',
  receiptMinutes: 'Sau khi thanh toán xong, khách còn dùng được mã QR ra cổng (chi nhánh có cổng ra) bao lâu. Hết hạn: mã ra cổng vô hiệu.',
  idleHours: 'Khách mở giỏ nhưng không quét, không bấm gì trong khoảng này thì giỏ bỏ quên tự giải phóng.',
  maxShopHours: 'Tính từ lúc khách bắt đầu giỏ, dù vẫn đang quét. Hết hạn: không quét thêm được, khách cần thanh toán hoặc bắt đầu giỏ mới. Đặt 0 nếu không giới hạn.',
  maxItems: 'Số mã hàng khác nhau tối đa trong một giỏ. Vượt thì app báo khách thanh toán giỏ này rồi quét giỏ mới.',
  maxQty: 'Số lượng tối đa của mỗi mã hàng trong giỏ.'
};
const dec = (v) => String(v).replace('.', ',');
const show = (v, f) => (v === undefined || v === null || v === '' ? '' : Number(v) === 0 && f.min === 0 ? 'Không giới hạn' : `${dec(v)} ${f.unit}`);

function GlobalCard({ d, chain, onSaved }) {
  const [vals, setVals] = useState(() => Object.fromEntries(ORDER.map((k) => [k, String(d.global[k])])));
  const [busy, run] = useBusy();
  const save = () => run(async () => { await api.put('/cart-limits', { values: Object.fromEntries(ORDER.map((k) => [k, vals[k]])) }); await onSaved(); }, 'Đã lưu cấu hình chung');
  const reset = () => run(async () => { await api.put('/cart-limits', { values: Object.fromEntries(ORDER.map((k) => [k, null])) }); await onSaved(); setVals(Object.fromEntries(ORDER.map((k) => [k, String(d.defaults[k])]))); }, 'Đã khôi phục mặc định');
  return html`<div class="card" id="limits-global">
    <div class="cardhead"><div class="grow"><h2>Cấu hình chung cho toàn bộ siêu thị</h2><div class="small muted">Áp dụng cho mọi siêu thị chưa có cấu hình riêng. Thay đổi có hiệu lực ngay cho giỏ mới.</div></div></div>
    ${ORDER.map((k, i) => { const f = d.fields[k]; return html`<div class="field" key=${k}>
      <label for=${`lim-${k}`}><b>${i + 1}. ${f.label}</b></label><div class="small muted" style="margin-bottom:6px">${DESC[k]}</div>
      <div class="row"><input id=${`lim-${k}`} class="input" style="max-width:140px;text-align:right;font-weight:700" inputmode="decimal" disabled=${!chain || busy} value=${vals[k]} onInput=${(e) => setVals({ ...vals, [k]: e.target.value })}/>
        <span class="muted">${f.unit}</span><span class="small muted">Mặc định ${show(d.defaults[k], f)} · cho phép ${dec(f.min)} đến ${dec(f.max)} ${f.unit}</span></div></div>`; })}
    ${chain && html`<div class="row" style="margin-top:8px"><button class="btn primary" disabled=${busy} onClick=${save}>Lưu cấu hình chung</button><button class="btn line" disabled=${busy} onClick=${reset}>Khôi phục mặc định</button></div>`}
  </div>`;
}

function StoreEditor({ d, store, chain, onSaved, onClose }) {
  const own = d.stores[store.id] || {};
  const [use, setUse] = useState(() => Object.fromEntries(ORDER.map((k) => [k, own[k] === undefined]))); // true = dùng giá trị chung
  const [vals, setVals] = useState(() => Object.fromEntries(ORDER.map((k) => [k, String(own[k] ?? d.global[k])])));
  const [busy, run] = useBusy();
  const save = () => run(async () => { await api.put(`/cart-limits/stores/${store.id}`, { values: Object.fromEntries(ORDER.map((k) => [k, use[k] ? null : vals[k]])) }); await onSaved(); onClose(); }, 'Đã lưu cho siêu thị này');
  const clear = () => run(async () => { await api.put(`/cart-limits/stores/${store.id}`, { values: null }); await onSaved(); onClose(); }, 'Đã xóa cấu hình riêng');
  return html`<div class="card" id="limits-store"><div class="cardhead"><div class="grow"><h2>Sửa riêng: ${store.name}</h2><div class="small muted">Bật "Dùng giá trị chung" thì ô nhập bị khóa và theo cấu hình chung.</div></div>
      <button class="btn sm line" onClick=${onClose}>Đóng</button></div>
    <div class="tblwrap"><table class="tbl"><tbody>${ORDER.map((k) => { const f = d.fields[k]; return html`<tr key=${k}><td>${f.label}</td>
      <td><label class="row small" style="gap:8px"><${Switch} checked=${use[k]} disabled=${!chain || busy} label=${`Dùng giá trị chung: ${f.label}`} onChange=${(v) => setUse({ ...use, [k]: v })}/>Dùng giá trị chung</label></td>
      <td><div class="row"><input class="input" style="max-width:110px;text-align:right;font-weight:700" inputmode="decimal" aria-label=${`${f.label} của ${store.name}`} disabled=${!chain || busy || use[k]} value=${use[k] ? String(d.global[k]) : vals[k]} onInput=${(e) => setVals({ ...vals, [k]: e.target.value })}/><span class="muted">${f.unit}</span></div></td></tr>`; })}</tbody></table></div>
    ${chain && html`<div class="row" style="margin-top:10px"><button class="btn primary" disabled=${busy} onClick=${save}>Lưu cho siêu thị này</button><button class="btn line" disabled=${busy} onClick=${clear}>Xóa cấu hình riêng</button></div>`}
  </div>`;
}

function StoresCard({ d, stores, chain, onSaved }) {
  const [q, setQ] = useState('');
  const [onlyOv, setOnlyOv] = useState(false);
  const [edit, setEdit] = useState(null);
  const list = stores.filter((s) => (!q.trim() || `${s.name} ${s.id}`.toLowerCase().includes(q.trim().toLowerCase())) && (!onlyOv || d.stores[s.id]));
  const cell = (s, k) => { const ov = d.stores[s.id]?.[k]; const f = d.fields[k]; return ov !== undefined ? html`<span style="border:1.5px solid var(--primary,#F07F1A);color:#C2410C;background:#FFF3E8;border-radius:8px;padding:2px 8px;font-weight:700">${show(ov, f)}</span>` : html`<span class="muted">${show(d.global[k], f)}</span>`; };
  return html`<div class="card" id="limits-stores">
    <div class="cardhead"><div class="grow"><h2>Theo từng siêu thị</h2><div class="small muted">Ô viền cam là giá trị riêng của siêu thị, ô xám là đang dùng giá trị chung.</div></div></div>
    <div class="toolbar" style="margin-bottom:10px"><input class="input sm grow" style="max-width:320px" type="search" placeholder="Tìm siêu thị theo tên, mã" aria-label="Tìm siêu thị" value=${q} onInput=${(e) => setQ(e.target.value)}/>
      <label class="row small" style="gap:8px"><${Switch} checked=${onlyOv} label="Chỉ hiện siêu thị có cấu hình riêng" onChange=${setOnlyOv}/>Chỉ hiện siêu thị có cấu hình riêng</label></div>
    <div class="tblwrap"><table class="tbl compact"><thead><tr><th>Siêu thị</th>${ORDER.map((k) => html`<th key=${k}>${{ lockedMinutes: 'Chờ thanh toán', receiptMinutes: 'Sau thanh toán', idleHours: 'Không thao tác', maxShopHours: 'Tối đa mua sắm', maxItems: 'Mã hàng', maxQty: 'SL / mã' }[k]}</th>`)}<th></th></tr></thead>
      <tbody>${list.map((s) => html`<tr key=${s.id}><td><b>${s.name}</b><div class="sub">${s.id}</div></td>${ORDER.map((k) => html`<td key=${k}>${cell(s, k)}</td>`)}<td><button class="btn sm line" onClick=${() => setEdit(s)}>${chain ? 'Sửa' : 'Xem'}</button></td></tr>`)}
      ${!list.length && html`<tr><td colspan="8" class="muted">Không có siêu thị nào khớp.</td></tr>`}</tbody></table></div>
    ${edit && html`<div style="margin-top:12px"><${StoreEditor} key=${edit.id} d=${d} store=${edit} chain=${chain} onSaved=${onSaved} onClose=${() => setEdit(null)}/></div>`}
  </div>`;
}

export function CartLimits({ me, stores }) {
  const chain = me.role === 'chain_admin';
  const st = useAsync(() => api.get('/cart-limits'), []);
  const mine = chain ? stores : stores.filter((s) => s.id === me.storeId || s.id === me.store_id);
  return html`<div class="stack-lg"><${PageHead} title="Giỏ hàng: thời gian và giới hạn" sub="Thời gian chờ, hạn giữ và giới hạn số lượng quét trong một giỏ. Đặt chung cho toàn chuỗi, rồi chỉnh riêng cho từng siêu thị khi cần."/>
    ${!chain && html`<${Banner} tone="info" icon="lock" title="Chỉ xem">Chỉ quản trị chuỗi mới được thay đổi cấu hình này.<//>`}
    <${Async} state=${st}>${(d) => html`${chain && html`<${GlobalCard} d=${d} chain=${chain} onSaved=${() => st.reload()}/>`}<${StoresCard} d=${d} stores=${mine} chain=${chain} onSaved=${() => st.reload()}/>`}<//></div>`;
}
