// Màn hình thu ngân, ca làm việc và giao dịch của PWA nhân viên.
import { html, useState, useEffect, useRef, Icon, Logo, Scanner, Banner, Pill, Field, Sheet, Confirm, Spinner, Empty, Loading, ErrorBox,
  fmt, go, toast, usePoll, useAsync, Keypad, copyText } from '/shared/lib.js';
import { api, setToken, flash, useBusy, beep, enc, Top, Page, BottomBar, NeedShift, Denied, Tick, MoneyPad, QueueList, Fetching, useTx, txStatus, roleName, flagsOf } from '/s/common.js';

// ============================== N01 Đăng nhập ==============================
export function Login({ onLogin }) {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, run] = useBusy();
  const canGo = code.trim().length >= 3 && pin.length >= 4;
  const submit = () => {
    if (!canGo) return;
    setErr('');
    run(async () => {
      const r = await api.post('/login', { code: code.trim(), pin });
      setToken(r.token);
      onLogin(r);
    }, (e) => { setErr(e.message); setPin(''); return true; });
  };
  return html`<div class="login"><div class="card">
    <div class="stack center" style="align-items:center;gap:8px"><${Logo} size=${56}/><h1>BRG Nhân viên</h1><p class="muted">Đăng nhập để thu tiền và kiểm tra cổng ra</p></div>
    ${err && html`<${Banner} tone="err" icon="alert">${err}<//>`}
    <${Field} label="Mã nhân viên"><input class="input" autocomplete="username" autocapitalize="characters" autocorrect="off" spellcheck=${false} placeholder="Ví dụ NV0142"
      value=${code} onInput=${(e) => setCode(e.target.value.toUpperCase())} onKeyDown=${(e) => e.key === 'Enter' && submit()} aria-label="Mã nhân viên"/><//>
    <${Field} label="PIN">
      <div class="dots" role="status" aria-label=${`Đã nhập ${pin.length} số`}>${pin ? [...pin].map((_, i) => html`<i key=${i}></i>`) : html`<span>Nhập PIN bằng bàn phím số</span>`}</div><//>
    <${Keypad} onKey=${(k) => setPin((p) => (k === '⌫' ? p.slice(0, -1) : p.length < 8 ? p + k : p))}/>
    <button class="btn primary" disabled=${!canGo || busy} onClick=${submit}>${busy ? html`<${Spinner} sm/>` : 'Đăng nhập'}</button>
  </div></div>`;
}

// ============================== N02 Trang chính ==============================
export function Home({ c }) {
  const { user, store, shift } = c;
  const [kind, setKind] = useState(new Date().getHours() < 12 ? 'sang' : 'chieu');
  const [busy, run] = useBusy();
  const [queueN, setQueueN] = useState(null);
  const f = flagsOf(store);
  usePoll(async () => {
    c.refreshMe();
    if (!c.shift) return;
    const [s, q] = await Promise.all([api.get('/shifts/current'), user.canCash && !f.pos ? api.get('/queue') : Promise.resolve(null)]);
    c.setShift(s.shift);
    if (q) setQueueN(q.carts.length);
  }, 4000, [!!shift, f.pos]);
  const hour = new Date().getHours();
  const hi = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const start = () => run(async () => {
    const r = await api.post('/shifts/start', { kind });
    flash.lastShift = null;
    c.setShift(r.shift);
    toast('Đã bắt đầu ca', 'ok');
  });
  const st = shift?.stats;
  const last = flash.lastShift;
  return html`<${Top} c=${c}/><${Page}>
    <div class="stack" style="gap:4px"><h1>${hi}, ${user.name}</h1><div class="muted">${store.name} · ${roleName(user)}</div></div>
    ${!shift ? html`
      ${last && html`<div class="card"><div class="row"><div class="ico-tile green"><${Icon} name="docok"/></div><div class="grow"><h2>Ca vừa kết thúc</h2><div class="small muted">Bàn giao lúc ${fmt.time(last.ended_at)}</div></div></div>
        <div class="sum"><div><span>Giao dịch</span><b>${last.stats.transactions}</b></div>${!f.pos && html`<div><span>Tiền mặt hệ thống</span><b class="num">${fmt.money(last.system_cash)}</b></div>
        <div><span>Tiền mặt đếm thực tế</span><b class="num">${fmt.money(last.counted_cash)}</b></div>
        <div><span>Chênh lệch</span><b class="num" style=${`color:var(${last.diff === 0 ? '--ok' : '--err'})`}>${last.diff > 0 ? '+' : ''}${fmt.money(last.diff)}</b></div>
        <div><span>Chuyển khoản</span><b class="num">${fmt.money(last.stats.transfer)}</b></div>`}</div></div>`}
      <div class="card"><div class="row"><div class="ico-tile"><${Icon} name="clock"/></div><div class="grow"><h2>Bắt đầu ca làm việc</h2><div class="small muted">${f.pos && !f.guard ? 'Chọn ca rồi bắt đầu ca làm việc.' : f.pos ? 'Chọn ca rồi bắt đầu để kiểm tra cổng ra.' : !f.guard ? 'Chọn ca rồi bắt đầu để thu tiền.' : 'Chọn ca rồi bắt đầu để thu tiền và kiểm tra cổng ra.'}</div></div></div>
        <div class="seg" role="group" aria-label="Chọn ca"><button aria-pressed=${kind === 'sang'} onClick=${() => setKind('sang')}>Ca sáng</button><button aria-pressed=${kind === 'chieu'} onClick=${() => setKind('chieu')}>Ca chiều</button></div>
        <button class="btn primary" disabled=${busy} onClick=${start}>${busy ? html`<${Spinner} sm/>` : 'Bắt đầu ca'}</button></div>`
    : html`
      <div class="row"><${Pill} tone="ok"><span class="dot"></span> ${shift.kind === 'sang' ? 'Ca sáng' : 'Ca chiều'}<//><span class="small muted">từ ${fmt.time(shift.started_at)}</span></div>
      ${f.pos && !f.guard ? html`<${Banner} tone="info" icon="info" title="Không cần dùng ứng dụng này cho thu tiền hay cổng ra">Chi nhánh dùng POS và không có bảo vệ: bạn không cần dùng ứng dụng này cho việc thu tiền hay cổng ra. Thu ngân quét mã giỏ hàng của khách trong phần mềm POS, hệ thống tự xác nhận khi POS báo đã thanh toán.<//>`
        : f.pos ? html`<${Banner} tone="info" icon="info" title="Thu tiền trên máy tính tiền (POS)">Thu ngân quét mã giỏ hàng của khách trong phần mềm POS. Hệ thống tự xác nhận khi POS báo đã thanh toán.<//>`
        : !f.guard ? html`<${Banner} tone="info" icon="info" title="Không có bước kiểm tra của bảo vệ">Khách thanh toán xong là ra luôn, không có mã QR ra cổng.<//>` : null}
      <div class="stack">
        ${!f.pos && user.canCash && html`<button class="actcard main" onClick=${() => go('/thu')}><div class="ico-tile"><${Icon} name="cash" size=${28}/></div>
          <div class="grow"><div class="t">Thu tiền giỏ hàng</div><div class="small muted">${queueN === null ? 'Đang tải hàng đợi…' : queueN ? `${queueN} khách đang chờ` : 'Chưa có khách chờ'}</div></div>
          ${queueN > 0 && html`<span class="pill" style="background:#fff;color:var(--orange-ink);font-size:16px;padding:6px 14px">${queueN}</span>`}<${Icon} name="chev"/></button>`}
        ${f.guard && user.canGate && html`<button class="actcard" onClick=${() => go('/cong')}><div class="ico-tile green"><${Icon} name="shield" size=${28}/></div>
          <div class="grow"><div class="t">Kiểm tra cổng ra</div><div class="small muted">Quét QR biên nhận của khách</div></div><${Icon} name="chev"/></button>`}
      </div>
      <div><h3 style="margin-bottom:8px">Trong ca này</h3><div class="tiles">
        <div class="tilebox"><span class="k">Giao dịch</span><span class="v">${st?.transactions ?? 0}</span></div>
        ${f.guard && html`<div class="tilebox"><span class="k">Kiểm tra ngẫu nhiên</span><span class="v">${st?.checks ?? 0}${st?.mismatches ? html`<span class="small muted" style="font-weight:600"> · ${st.mismatches} lệch</span>` : ''}</span></div>`}
        ${!f.pos && html`<div class="tilebox"><span class="k">Tiền mặt</span><span class="v">${fmt.money(st?.cash)}</span></div>
        <div class="tilebox"><span class="k">Chuyển khoản</span><span class="v">${fmt.money(st?.transfer)}</span></div>`}</div></div>
      ${user.isManager && (f.pos || !f.guard) && html`<button class="btn line" onClick=${() => go('/giao-dich')}><${Icon} name="receipt"/> Giao dịch gần đây</button>`}
      <button class="btn line" onClick=${() => go('/doi-soat')}><${Icon} name="docok"/> ${f.pos ? 'Kết thúc ca' : 'Đối soát & kết thúc ca'}</button>`}
  <//>`;
}

// ============================== N03 Quét mã giỏ hàng + hàng đợi ==============================
export function Lookup({ c }) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [busy, run] = useBusy();
  const [carts, setCarts] = useState(null);
  const [qerr, setQerr] = useState(null);
  usePoll(async () => { try { setCarts((await api.get('/queue')).carts); setQerr(null); } catch (e) { setQerr(e); } }, 4000, []);
  if (!c.user.canCash) return html`<${Denied} c=${c}/>`;
  const look = (raw) => {
    const v = String(raw || '').trim();
    if (!v) return;
    setErr('');
    return run(async () => {
      const r = await api.get(`/carts/lookup?code=${enc(v)}`);
      setStatus('ok'); beep(true);
      go(`/gio/${enc(r.transaction.id)}`);
    }, (e) => { setStatus('err'); beep(false); setErr(e.message); setTimeout(() => setStatus(''), 1200); return true; });
  };
  return html`<${Top} c=${c} title="Thu tiền" sub="Quét mã giỏ hàng của khách"/><${Page}>
    <${NeedShift} c=${c}/>
    <${Scanner} kind="qr" onScan=${look} paused=${busy} status=${status} hint="Đưa mã giỏ hàng trên màn hình khách vào khung"/>
    ${err && html`<${Banner} tone="err" icon="alert">${err}<//>`}
    <div class="card tight"><${Field} label="Hoặc nhập mã giỏ hàng bằng tay" hint="Ví dụ GH-Q7-0384">
      <div class="row"><input class="input" style="text-transform:uppercase" value=${code} placeholder="GH-Q7-0384" autocapitalize="characters" autocomplete="off" aria-label="Mã giỏ hàng"
        onInput=${(e) => setCode(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && look(code)}/>
      <button class="btn auto primary" style="width:auto;flex:none" disabled=${busy || !code.trim()} onClick=${() => look(code)}>${busy ? html`<${Spinner} sm/>` : 'Tra mã'}</button></div><//></div>
    <div class="row"><h2 class="grow">Hàng đợi</h2>${carts && html`<${Pill} tone=${carts.length ? 'warn' : ''}>${carts.length} khách<//>`}</div>
    ${qerr && !carts ? html`<${ErrorBox} error=${qerr}/>` : !carts ? html`<${Loading}/>` : carts.length ? html`<${QueueList} carts=${carts}/>` : html`<div class="muted center" style="padding:12px 0">Chưa có khách nào chờ thu tiền.</div>`}
  <//>`;
}

export function QueueScreen({ c }) {
  const [carts, setCarts] = useState(null);
  const [err, setErr] = useState(null);
  usePoll(async () => { try { setCarts((await api.get('/queue')).carts); setErr(null); } catch (e) { setErr(e); } }, 4000, []);
  if (!c.user.canCash) return html`<${Denied} c=${c}/>`;
  return html`<${Top} c=${c} title="Hàng đợi" sub="Tự cập nhật mỗi vài giây"/><${Page}>
    ${err && !carts ? html`<${ErrorBox} error=${err}/>` : !carts ? html`<${Loading}/>`
      : carts.length ? html`<${QueueList} carts=${carts}/>` : html`<${Empty} icon="users" title="Chưa có khách chờ" text="Khi khách khoá giỏ hàng và chọn thanh toán tại quầy, giỏ sẽ hiện ở đây."/>`}
  <//>`;
}

// ============================== N04 Giỏ hàng cần thu ==============================
const CANCEL_REASONS = ['Khách đổi ý, không mua nữa', 'Khách muốn sửa giỏ hàng', 'Giá hoặc sản phẩm sai', 'Lý do khác'];
export function modeOf(tx) {
  if (tx.status === 'awaiting_counter') return 'main';
  if (tx.status === 'paid' && tx.extraDue > 0) return 'extra';
  return 'none';
}
export const amountOf = (tx) => (tx.status === 'awaiting_counter' ? tx.total + tx.extraDue : tx.extraDue);

export function Cart({ c, id }) {
  const st = useTx(id);
  const [method, setMethod] = useState(null);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [other, setOther] = useState('');
  const [busy, run] = useBusy();
  const tx = st.data;
  const pay = c.store.payment;
  const guardOn = flagsOf(c.store).guard;
  useEffect(() => {
    if (tx && !method) setMethod(tx.method === 'qr_transfer' && pay.qrTransfer ? 'qr_transfer' : pay.cash ? 'cash' : 'qr_transfer');
  }, [tx]);
  if (!c.user.canCash) return html`<${Denied} c=${c}/>`;
  if (!tx) return html`<${Top} c=${c} title="Giỏ hàng" back="/thu"/><${Page}><${Fetching} st=${st}/><//>`;
  const mode = modeOf(tx), amount = amountOf(tx), held = tx.exitStatus === 'held';
  const flagged = guardOn && mode === 'main' && tx.checkRequired; // được chọn kiểm tra ngẫu nhiên
  const doCancel = () => run(async () => {
    const text = reason === 'Lý do khác' ? (other.trim() || 'Lý do khác') : reason;
    await api.post(`/carts/${enc(tx.id)}/cancel`, { reason: text });
    toast('Đã huỷ giỏ hàng', 'ok');
    setCancel(false);
    go('/thu', true);
  }, (e) => { setCancel(false); toast(e.message, 'err'); st.reload(); return true; });
  const items = tx.items || [];
  const s = txStatus(tx);
  return html`<${Top} c=${c} title=${mode === 'extra' ? 'Thu bổ sung' : 'Giỏ hàng cần thu'} sub=${tx.code} back="/thu"/><${Page} bottom>
    <${NeedShift} c=${c}/>
    <div class="row wrap"><${Pill} tone=${s.tone}>${s.text}<//><${Pill}>Khách chọn: ${fmt.method(tx.method)}<//><span class="small muted end">${fmt.time(tx.createdAt)}</span></div>
    ${held && guardOn && html`<${Banner} tone="err" icon="alert" title="Đang chờ quản lý xử lý">Chưa thu tiền được cho tới khi quản lý quyết định.<//>`}
    ${flagged && html`<${Banner} tone="warn" icon="eye" title="Được chọn kiểm tra ngẫu nhiên">Có thể đối chiếu hàng thật ngay tại quầy, hoặc để nhân viên cổng ra kiểm tra khi khách ra.<//>`}
    ${tx.ageRestricted && html`<${Banner} tone="warn" icon="user" title="Có hàng giới hạn độ tuổi">Hãy kiểm tra giấy tờ của khách trước khi thu tiền.<//>`}
    ${mode === 'none' && !held && html`<${Banner} tone="info" icon="info" title="Không có khoản nào cần thu">${tx.status === 'paid' ? 'Giao dịch này đã thu tiền đầy đủ.' : 'Giao dịch này không thu tiền được.'}<//>`}
    <div class="card">
      <h2>${items.length} loại · ${tx.itemCount} sản phẩm</h2>
      <div class="list">${items.map((i, n) => html`<div class="item" key=${n}>
        <div class="tile" style=${`--h:${fmt.tone(n + 3)}`}>${i.qty}×</div>
        <div class="grow"><div class="name">${i.name}</div><div class="small muted">${fmt.money(i.price)} × ${i.qty}${i.discount ? ` · giảm ${fmt.money(i.discount)}` : ''}${i.ageRestricted ? ' · 18+' : ''}</div></div>
        <div class="b num">${fmt.money(i.price * i.qty - (i.discount || 0))}</div></div>`)}</div>
      <div class="sum"><div><span>Tạm tính</span><span class="num">${fmt.money(tx.subtotal)}</span></div>
        ${tx.discount > 0 && html`<div><span>Khuyến mãi</span><span class="num" style="color:var(--ok)">−${fmt.money(tx.discount)}</span></div>`}
        ${mode === 'main' && tx.extraDue > 0 && html`<div><span>Thu bổ sung (chênh lệch)</span><span class="num">${fmt.money(tx.extraDue)}</span></div>`}
        <div class="tot"><span>${mode === 'extra' ? 'Cần thu thêm' : 'Cần thu'}</span><span class="num">${fmt.money(amount)}</span></div></div>
    </div>
    ${mode !== 'none' && !held && html`<div class="card tight"><div class="label">Cách trả (khách có thể đổi)</div>
      <div class="seg" role="group" aria-label="Cách trả"><button aria-pressed=${method === 'cash'} disabled=${!pay.cash} onClick=${() => setMethod('cash')}>Tiền mặt</button>
        <button aria-pressed=${method === 'qr_transfer'} disabled=${!pay.qrTransfer} onClick=${() => setMethod('qr_transfer')}>Chuyển khoản</button></div></div>`}
    ${mode === 'main' && !held && html`<button class="btn danger-line" onClick=${() => setCancel(true)}>Huỷ giỏ hàng</button>`}
  <//>
  ${mode !== 'none' && !held && html`<${BottomBar}>
    <button class="btn primary" disabled=${!c.shift || !method} onClick=${() => go(`/gio/${enc(tx.id)}/${method === 'cash' ? 'tien-mat' : 'chuyen-khoan'}`)}>
        ${method === 'cash' ? 'Thu tiền mặt' : 'Xác nhận chuyển khoản'} · ${fmt.money(amount)}</button>
    ${flagged && html`<button class="btn line" onClick=${() => go(`/doi-chieu/${enc(tx.id)}?place=counter`)}><${Icon} name="eye"/> Đối chiếu ngay tại quầy</button>`}<//>`}
  ${held && guardOn && c.user.isManager && html`<${BottomBar}><button class="btn primary" onClick=${() => go('/cho-quan-ly')}>Xử lý ca chờ quản lý</button><//>`}
  ${cancel && html`<${Sheet} onClose=${() => setCancel(false)}><h2>Huỷ giỏ ${tx.code}?</h2><p class="muted">Giỏ sẽ mở lại trên điện thoại của khách để họ sửa hoặc thanh toán lại.</p>
    <div class="stack" style="gap:8px">${CANCEL_REASONS.map((r) => html`<button key=${r} class=${`option ${reason === r ? 'on' : ''}`} onClick=${() => setReason(r)}>${r}<span class="radio"></span></button>`)}</div>
    ${reason === 'Lý do khác' && html`<input class="input" placeholder="Ghi lý do" value=${other} onInput=${(e) => setOther(e.target.value)} aria-label="Lý do huỷ"/>`}
    <button class="btn danger" disabled=${busy} onClick=${doCancel}>${busy ? html`<${Spinner} sm/>` : 'Huỷ giỏ hàng'}</button><button class="btn txt" onClick=${() => setCancel(false)}>Quay lại</button><//>`}`;
}

async function collect(c, tx, body, run, st) {
  return run(async () => {
    const amount = amountOf(tx), kind = modeOf(tx) === 'extra' ? 'extra' : 'main';
    const r = await api.post(`/carts/${enc(tx.id)}/collect`, body);
    flash.done = { tx: r.transaction, amount: r.amount ?? amount, change: r.change, kind: r.kind || kind, method: body.method, at: new Date().toISOString(), staff: c.user.name };
    c.refreshShift();
    beep(true);
    go('/da-thu', true);
  }, (e) => {
    if (['HELD', 'NOT_COLLECTABLE', 'NO_SHIFT'].includes(e.code)) { toast(e.message, 'err'); go(`/gio/${enc(tx.id)}`, true); return true; }
    return false;
  });
}

// ============================== N05 Thu tiền mặt ==============================
export function Cash({ c, id }) {
  const st = useTx(id);
  const [recv, setRecv] = useState('');
  const [busy, run] = useBusy();
  if (!c.user.canCash) return html`<${Denied} c=${c}/>`;
  const tx = st.data;
  if (!tx) return html`<${Top} c=${c} title="Thu tiền mặt" back=${`/gio/${enc(id)}`}/><${Page}><${Fetching} st=${st}/><//>`;
  const amount = amountOf(tx), got = Number(recv || 0), ok = got >= amount && amount > 0;
  const chips = [...new Set([50000, 100000, 200000, 500000].filter((d) => d >= amount))];
  return html`<${Top} c=${c} title="Thu tiền mặt" sub=${tx.code} back=${`/gio/${enc(id)}`}/><${Page} bottom>
    <${NeedShift} c=${c}/>
    ${modeOf(tx) === 'none' && html`<${Banner} tone="info" icon="info">Giao dịch này không còn khoản nào cần thu.<//>`}
    <div class="amountbox"><span class="label">${modeOf(tx) === 'extra' ? 'Cần thu thêm' : 'Số tiền cần thu'}</span><span class="bigamt">${fmt.money(amount)}</span></div>
    <div class="amountbox in"><span class="label">Khách đưa</span><span class="bigamt" aria-live="polite">${recv ? fmt.money(got) : html`<span class="muted">0₫</span>`}</span></div>
    ${recv ? (ok ? html`<div class="change"><div class="label" style="color:inherit">Tiền thừa trả khách</div><div class="bigamt">${fmt.money(got - amount)}</div></div>`
      : html`<div class="change short"><div class="label" style="color:inherit">Còn thiếu</div><div class="bigamt">${fmt.money(amount - got)}</div></div>`) : null}
    <div class="chips"><button class=${`chip ${got === amount && recv ? 'on' : ''}`} onClick=${() => setRecv(String(amount))}>Đủ tiền</button>
      ${chips.map((d) => html`<button key=${d} class=${`chip ${got === d ? 'on' : ''}`} onClick=${() => setRecv(String(d))}>${fmt.num(d)}</button>`)}
      <button class="chip" onClick=${() => setRecv('')}>Xoá</button></div>
    <${MoneyPad} value=${recv} onChange=${setRecv} max=${9}/>
  <//>
  <${BottomBar}><button class="btn primary" disabled=${!ok || busy || !c.shift} onClick=${() => collect(c, tx, { method: 'cash', cashReceived: got }, run)}>${busy ? html`<${Spinner} sm/>` : 'Đã thu tiền'}</button><//>`;
}

// ============================== N06 Xác nhận chuyển khoản ==============================
export function Transfer({ c, id }) {
  const st = useTx(id);
  const [t, setT] = useState({ amount: false, content: false, received: false });
  const [busy, run] = useBusy();
  if (!c.user.canCash) return html`<${Denied} c=${c}/>`;
  const tx = st.data;
  if (!tx) return html`<${Top} c=${c} title="Xác nhận chuyển khoản" back=${`/gio/${enc(id)}`}/><${Page}><${Fetching} st=${st}/><//>`;
  const amount = amountOf(tx), all = t.amount && t.content && t.received;
  return html`<${Top} c=${c} title="Xác nhận chuyển khoản" sub=${tx.code} back=${`/gio/${enc(id)}`}/><${Page} bottom>
    <${NeedShift} c=${c}/>
    <${Banner} tone="err" icon="alert" title="Không xác nhận theo ảnh chụp màn hình của khách">Hãy mở ứng dụng ngân hàng hoặc sao kê của công ty và kiểm tra tiền đã thật sự vào tài khoản.<//>
    <div class="amountbox"><span class="label">Số tiền phải khớp</span><span class="bigamt">${fmt.money(amount)}</span></div>
    <div class="amountbox"><span class="label">Nội dung phải có</span><span class="bigtxt">${tx.transferContent}</span>
      <div style="margin-top:8px"><button class="btn sm line" onClick=${() => copyText(tx.transferContent)}><${Icon} name="copy" size=${18}/> Sao chép nội dung</button></div></div>
    ${tx.transfer && html`<div class="small muted">Tài khoản nhận: ${tx.transfer.bankName} · ${tx.transfer.account} · ${tx.transfer.holder}</div>`}
    <div class="stack" style="gap:8px">
      <${Tick} on=${t.amount} onChange=${(v) => setT({ ...t, amount: v })}>Số tiền đúng: ${fmt.money(amount)}<//>
      <${Tick} on=${t.content} onChange=${(v) => setT({ ...t, content: v })}>Nội dung đúng mã giao dịch<//>
      <${Tick} on=${t.received} onChange=${(v) => setT({ ...t, received: v })}>Tiền đã vào tài khoản của công ty<//></div>
  <//>
  <${BottomBar}><button class="btn primary" disabled=${!all || busy || !c.shift} onClick=${() => collect(c, tx, { method: 'qr_transfer', confirm: { amount: true, content: true, received: true } }, run)}>${busy ? html`<${Spinner} sm/>` : 'Đã nhận tiền, xác nhận'}</button><//>`;
}

// ============================== N07 Đã thu ==============================
export function Done({ c }) {
  const d = flash.done;
  useEffect(() => { if (!d) go('/', true); }, []);
  if (!d) return null;
  const tx = d.tx;
  return html`<div class="result ok"><div class="big"><${Icon} name="check"/></div>
    <h1>${d.kind === 'extra' ? 'Đã thu bổ sung' : 'Đã thu tiền'}</h1>
    <div class="xl">${fmt.money(d.amount)}</div>
    ${d.method === 'cash' && d.change > 0 && html`<div class="glass" style="align-items:center;gap:2px"><span>Trả lại khách</span><span class="xl" style="font-size:38px">${fmt.money(d.change)}</span></div>`}
    <div class="glass">
      <div><span>Giỏ hàng</span><b>${tx.code}</b></div><div><span>Cách trả</span><b>${fmt.method(d.method)}</b></div>
      <div><span>Giờ thu</span><b>${fmt.time(d.at)}</b></div><div><span>Nhân viên</span><b>${d.staff}</b></div></div>
    <p>${flagsOf(c.store).guard ? 'Khách sẽ nhận QR biên nhận trên điện thoại để ra cổng.' : 'Khách đã thanh toán xong và có thể ra về, không cần qua bước kiểm tra cổng.'}</p>
    <div class="actions"><button class="btn" onClick=${() => { flash.done = null; go('/thu', true); }}>Khách tiếp theo</button>
      <button class="btn ghost" onClick=${() => { flash.done = null; go('/', true); }}>Về trang chính</button></div></div>`;
}

// ============================== Giao dịch gần đây ==============================
const POS_ST = { claimed: 'POS đang xử lý', paid: 'POS đã thu', cancelled: 'POS đã huỷ' };
export function Transactions({ c }) {
  const st = useAsync(async () => (await api.get('/transactions')).transactions, []);
  return html`<${Top} c=${c} title="Giao dịch gần đây" sub="12 giờ qua" right=${html`<button class="iconbtn" onClick=${st.reload} aria-label="Làm mới"><${Icon} name="refresh"/></button>`}/><${Page}>
    <${Fetching} st=${st}/>
    ${st.data && (st.data.length ? html`<div class="card tight"><div class="list">${st.data.map((t) => { const s = txStatus(t); return html`<button key=${t.id} class="item" style="background:none;border:0;border-bottom:1px solid var(--line);text-align:left;width:100%" onClick=${() => go(`/giao-dich/${enc(t.id)}`)}>
      <div class="grow"><div class="b">${t.code}</div><div class="small muted">${fmt.time(t.paidAt || t.createdAt)} · ${t.itemCount} sản phẩm · ${fmt.method(t.method)}</div>
        ${t.posOrderRef && html`<div class="small muted">POS: ${t.posOrderRef}${t.posInvoiceNo ? ` · HĐ ${t.posInvoiceNo}` : ''}${t.posStatus ? ` · ${POS_ST[t.posStatus] || t.posStatus}` : ''}</div>`}</div>
      <div style="text-align:right"><div class="b num">${fmt.money(t.status === 'paid' ? (t.posAmount ?? t.total) : t.total)}</div><${Pill} tone=${s.tone}>${s.text}<//></div><${Icon} name="chev"/></button>`; })}</div></div>`
      : html`<${Empty} icon="receipt" title="Chưa có giao dịch" text="Giao dịch đã thu hoặc đang chờ thu trong 12 giờ qua sẽ hiện ở đây."/>`)}
  <//>`;
}

export function TxDetail({ c, id }) {
  const st = useTx(id);
  const tx = st.data;
  if (!tx) return html`<${Top} c=${c} title="Chi tiết giao dịch" back="/giao-dich"/><${Page}><${Fetching} st=${st}/><//>`;
  const s = txStatus(tx);
  const f = flagsOf(c.store);
  const canExtra = !f.pos && c.user.canCash && modeOf(tx) !== 'none' && tx.exitStatus !== 'held';
  return html`<${Top} c=${c} title="Chi tiết giao dịch" sub=${tx.code} back="/giao-dich"/><${Page} bottom=${canExtra || (f.guard && tx.exitStatus === 'held' && c.user.isManager)}>
    <div class="row wrap"><${Pill} tone=${s.tone}>${s.text}<//><${Pill}>${fmt.method(tx.method)}<//>${tx.checkDone && html`<${Pill} tone="info">Đã kiểm tra<//>`}${tx.posStatus && html`<${Pill} tone=${tx.posStatus === 'paid' ? 'ok' : tx.posStatus === 'cancelled' ? '' : 'warn'}>${POS_ST[tx.posStatus] || tx.posStatus}<//>`}</div>
    ${tx.extraDue > 0 && html`<${Banner} tone="warn" icon="cash" title=${`Còn thu bổ sung ${fmt.money(tx.extraDue)}`}>Khách cần trả thêm trước khi ra cổng.<//>`}
    <div class="card"><div class="list">${(tx.items || []).map((i, n) => html`<div class="item" key=${n}><div class="tile" style=${`--h:${fmt.tone(n + 3)}`}>${i.qty}×</div>
      <div class="grow"><div class="name">${i.name}</div><div class="small muted">${fmt.money(i.price)} × ${i.qty}</div></div><div class="b num">${fmt.money(i.price * i.qty - (i.discount || 0))}</div></div>`)}</div>
      <div class="sum"><div><span>Tạm tính</span><span class="num">${fmt.money(tx.subtotal)}</span></div>${tx.discount > 0 && html`<div><span>Khuyến mãi</span><span class="num">−${fmt.money(tx.discount)}</span></div>`}
        <div class="tot"><span>Tổng</span><span class="num">${fmt.money(tx.total)}</span></div>
        ${tx.posAmount != null && html`<div><span>Đã trả (theo POS)</span><b class="num">${fmt.money(tx.posAmount)}</b></div>`}</div></div>
    ${(tx.posOrderRef || tx.posInvoiceNo) && html`<div class="card tight"><div class="label">Nguồn thu: máy tính tiền (POS)</div><div class="sum">
      ${tx.posOrderRef && html`<div><span>Đơn POS</span><b>${tx.posOrderRef}</b></div>`}${tx.posInvoiceNo && html`<div><span>Số hoá đơn</span><b>${tx.posInvoiceNo}</b></div>`}
      ${tx.posStatus && html`<div><span>Trạng thái POS</span><span>${POS_ST[tx.posStatus] || tx.posStatus}</span></div>`}</div></div>`}
    <div class="card tight"><div class="sum"><div><span>Mã giao dịch</span><b>${tx.id}</b></div><div><span>Tạo lúc</span><span>${fmt.dateTime(tx.createdAt)}</span></div>
      ${tx.paidAt && html`<div><span>Thu tiền lúc</span><span>${fmt.dateTime(tx.paidAt)}</span></div>`}${tx.guardCheck !== false && tx.exitedAt && html`<div><span>Ra cổng lúc</span><span>${fmt.dateTime(tx.exitedAt)}</span></div>`}</div></div>
  <//>
  ${canExtra && html`<${BottomBar}><button class="btn primary" onClick=${() => go(`/gio/${enc(tx.id)}`)}>${tx.status === 'paid' ? 'Thu bổ sung' : 'Mở để thu tiền'}</button><//>`}
  ${!canExtra && f.guard && tx.exitStatus === 'held' && c.user.isManager && html`<${BottomBar}><button class="btn primary" onClick=${() => go('/cho-quan-ly')}>Xử lý ca chờ quản lý</button><//>`}`;
}

// ============================== N14 Đối soát cuối ca ==============================
export function EndShift({ c }) {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, run] = useBusy();
  const st = useAsync(async () => (await api.get('/shifts/current')).shift, []);
  const shift = st.data;
  if (!shift) return html`<${Top} c=${c} title="Đối soát cuối ca" back="/"/><${Page}>${st.loading ? html`<${Loading}/>` : st.error ? html`<${ErrorBox} error=${st.error} retry=${st.reload}/>`
    : html`<${Empty} icon="clock" title="Bạn chưa bắt đầu ca" text="Không có ca nào đang mở để đối soát."><button class="btn primary" onClick=${() => go('/')}>Về trang chính</button><//>`}<//>`;
  const pos = flagsOf(c.store).pos;
  const sys = pos ? 0 : shift.stats.cash, has = pos || counted !== '', cnt = pos ? 0 : Number(counted || 0), diff = cnt - sys;
  const needNote = !pos && has && diff !== 0;
  const finish = () => {
    if (needNote && !note.trim()) { setConfirm(false); setNoteErr('Tiền mặt lệch, hãy ghi lý do trước khi kết thúc ca'); return; }
    run(async () => {
      const r = await api.post('/shifts/end', { countedCash: cnt, note: note.trim() });
      flash.lastShift = r.shift; c.setShift(null); setConfirm(false);
      toast('Đã kết thúc ca và bàn giao', 'ok');
      go('/', true);
    }, (e) => { setConfirm(false); if (e.code === 'NOTE_REQUIRED') setNoteErr(e.message); else toast(e.message, 'err'); if (e.code === 'NO_SHIFT') { c.setShift(null); go('/', true); } return true; });
  };
  return html`<${Top} c=${c} title="Đối soát cuối ca" sub=${`${shift.kind === 'sang' ? 'Ca sáng' : 'Ca chiều'} từ ${fmt.time(shift.started_at)}`} back="/"/><${Page} bottom>
    <div class="tiles"><div class="tilebox"><span class="k">Giao dịch</span><span class="v">${shift.stats.transactions}</span></div>
      ${!pos && html`<div class="tilebox"><span class="k">Chuyển khoản</span><span class="v">${fmt.money(shift.stats.transfer)}</span></div>`}</div>
    ${pos ? html`<${Banner} tone="info" icon="info" title="Tiền do POS thu">Chi nhánh thu tiền trên máy tính tiền nên không cần đếm tiền mặt khi kết thúc ca.<//>` : html`<div class="amountbox"><span class="label">Tiền mặt theo hệ thống</span><span class="bigamt">${fmt.money(sys)}</span></div>
    <div class="amountbox in"><span class="label">Tiền mặt đếm thực tế</span><span class="bigamt">${has ? fmt.money(cnt) : html`<span class="muted">Nhập số tiền đã đếm</span>`}</span></div>
    ${!pos && has && html`<div class=${`change ${diff === 0 ? '' : 'short'}`} style=${diff !== 0 ? 'background:var(--err-soft);color:var(--err)' : ''}><div class="label" style="color:inherit">${diff === 0 ? 'Khớp với hệ thống' : diff > 0 ? 'Thừa so với hệ thống' : 'Thiếu so với hệ thống'}</div><div class="bigamt">${diff > 0 ? '+' : ''}${fmt.money(diff)}</div></div>`}
    <${MoneyPad} value=${counted} onChange=${(v) => { setCounted(v); setNoteErr(''); }} max=${10}/>`}
    ${needNote && html`<${Field} label="Lý do chênh lệch (bắt buộc)" error=${noteErr}><textarea class=${`input ${noteErr ? 'err' : ''}`} placeholder="Ví dụ: trả nhầm tiền thừa 20.000₫" value=${note} onInput=${(e) => { setNote(e.target.value); setNoteErr(''); }}></textarea><//>`}
  <//>
  <${BottomBar}><button class="btn primary" disabled=${!has || busy || (needNote && !note.trim())} onClick=${() => setConfirm(true)}>Kết thúc ca & bàn giao</button><//>
  ${confirm && html`<${Confirm} title="Kết thúc ca?" text=${pos ? 'Sau khi kết thúc, bạn cần bắt đầu ca mới nếu muốn làm việc tiếp.' : `Tiền mặt đếm ${fmt.money(cnt)}, hệ thống ${fmt.money(sys)}. Sau khi kết thúc không thu tiền tiếp được nếu chưa bắt đầu ca mới.`} ok="Kết thúc ca" busy=${busy} onOk=${finish} onCancel=${() => setConfirm(false)}/>`}`;
}
