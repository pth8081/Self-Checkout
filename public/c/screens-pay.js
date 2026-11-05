// Thanh toán và sau mua: M16 chọn cách trả, M17 chuyển khoản QR, M18 chờ nhân viên, M19 QR biên nhận,
// M20 kiểm tra ngẫu nhiên, M21 hoàn tất, M22 hoá đơn, M25 lịch sử, M26 chi tiết đơn.
import { html, useState, useEffect, useRef, Header, Icon, QR, Banner, Pill, Spinner, Loading, ErrorBox, Empty, Field, Switch, Sheet, Confirm, go, fmt, toast, usePoll, useAsync, copyText, ApiError } from '/shared/lib.js';
import { api, lock, unlock, cartView, refreshSession, resetSession, getState, setState, local, deviceId } from './store.js';
import { ChangesSheet } from './screens-scan.js';

const METHODS = [
  { id: 'cash', icon: 'cash', title: 'Tiền mặt tại quầy', text: 'Đưa mã giỏ hàng cho nhân viên', key: 'cash' },
  { id: 'qr_transfer', icon: 'qr', title: 'Chuyển khoản QR', text: 'Quét bằng app ngân hàng bất kỳ', key: 'qrTransfer' }
];

export function PayMethod({ s, store }) {
  const cart = cartView(s);
  const avail = METHODS.filter((m) => store.payment[m.key]);
  const [method, setMethod] = useState(s.session?.transaction?.method || avail[0]?.id || 'cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [changes, setChanges] = useState(null);

  async function proceed(accept = false) {
    setBusy(true); setError(null);
    try {
      await lock(method, accept);
      setChanges(null);
      go(method === 'qr_transfer' ? '/transfer' : '/wait', true);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CHANGED') setChanges(e.data.changes);
      else setError(e);
    } finally { setBusy(false); }
  }
  return html`<div style="display:flex;flex-direction:column;flex:1">
    <${Header} onBack=${() => go('/cart')} title="Thanh toán"/>
    <div class="page pad-b">
      <div class="card flat"><div class="row"><div class="grow"><div class="small muted">Số tiền cần trả</div><div class="num" style="font-size:34px;font-weight:800;letter-spacing:-.02em">${fmt.money(cart.total)}</div></div>
        <div class="small muted" style="text-align:right">${cart.itemCount} món<br/><button class="btn txt auto" style="min-height:28px;padding:0" onClick=${() => go('/cart')}>Xem giỏ</button></div></div></div>
      <b>Chọn cách thanh toán</b>
      <div class="stack">
        ${METHODS.map((m) => { const on = store.payment[m.key]; return html`<button class=${`option ${method === m.id ? 'on' : ''} ${on ? '' : 'off'}`} disabled=${!on} aria-pressed=${method === m.id} onClick=${() => setMethod(m.id)}>
          <div class="ico-tile"><${Icon} name=${m.icon}/></div><div class="grow"><b>${m.title}</b><div class="small muted">${on ? m.text : 'Chi nhánh này chưa nhận cách trả này'}</div></div><span class="radio"></span></button>`; })}
        <div class="option off" aria-disabled="true"><div class="ico-tile" style="background:var(--surface);color:var(--muted)"><${Icon} name="card"/></div><div class="grow"><b>Ví, VNPay, thẻ</b><div class="small muted">Thanh toán tự động</div></div><${Pill} tone="warn">Sắp có<//></div>
      </div>
      ${!avail.length && html`<${Banner} tone="err" icon="alert">Chi nhánh chưa bật cách thanh toán nào. Vui lòng đến quầy thanh toán thường.<//>`}
      ${error && html`<${ErrorBox} error=${error}/>`}
    </div>
    <div class="bar-bottom"><div class="in"><button class="btn primary" disabled=${busy || !avail.length} onClick=${() => proceed(false)}>${busy ? html`<${Spinner} sm/>` : 'Tiếp tục'}</button>
      <div class="xs muted center">Giỏ hàng sẽ khoá khi bạn bấm tiếp tục</div></div></div>
    ${changes && html`<${ChangesSheet} changes=${changes} busy=${busy} onAccept=${() => proceed(true)} onBack=${() => { setChanges(null); go('/cart'); refreshSession(); }}/>`}
  </div>`;
}

function Row({ k, v, copy }) {
  return html`<div class="row"><span class="muted grow">${k}</span><b class="num" style="text-align:right;word-break:break-all">${v}</b>${copy && html`<button class="iconbtn" style="width:36px;height:36px;border-radius:12px" onClick=${() => copyText(copy)} aria-label=${`Sao chép ${k}`}><${Icon} name="copy" size=${16}/></button>`}</div>`;
}

export function Transfer({ s }) {
  const tx = s.session?.transaction;
  const [busy, setBusy] = useState(false);
  usePoll(() => refreshSession(), 3000, []);
  if (!tx || !tx.transfer) return html`<div class="page"><${Loading}/></div>`;
  const t = tx.transfer;
  async function back() { setBusy(true); try { await unlock(); go('/pay', true); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } }
  return html`<div style="display:flex;flex-direction:column;flex:1">
    <${Header} onBack=${back} title="Chuyển khoản"/>
    <div class="page pad-b">
      <div class="qrbox"><${QR} text=${t.payload} label="Mã QR chuyển khoản"/></div>
      <p class="small muted center">Quét bằng app ngân hàng. Số tiền và nội dung đã điền sẵn, hãy giữ nguyên, không sửa.</p>
      <div class="card flat stack small" style="gap:10px">
        <${Row} k="Ngân hàng" v=${t.bankName || '—'}/><${Row} k="Số tài khoản" v=${t.account} copy=${t.account}/>
        <${Row} k="Chủ tài khoản" v=${t.holder || '—'}/><${Row} k="Số tiền" v=${fmt.money(t.amount)} copy=${String(t.amount)}/>
        <${Row} k="Nội dung" v=${t.content} copy=${t.content}/>
      </div>
    </div>
    <div class="bar-bottom"><div class="in"><button class="btn primary" onClick=${() => go('/wait')}>Tôi đã chuyển khoản</button>
      <button class="btn txt" disabled=${busy} onClick=${back}>Đổi cách thanh toán</button></div></div></div>`;
}

export function Wait({ s }) {
  const tx = s.session?.transaction;
  const [busy, setBusy] = useState(null);
  usePoll(() => refreshSession(), 2000, []);
  if (!tx) return html`<div class="page"><${Loading}/></div>`;
  async function undo(to) { setBusy(to); try { await unlock(); go(to, true); } catch (e) { toast(e.message, 'err'); } finally { setBusy(null); } }
  const transfer = tx.method === 'qr_transfer';
  return html`<div style="display:flex;flex-direction:column;flex:1">
    <${Header} title="Thanh toán"/>
    <div class="page pad-b" style="gap:14px">
      <div class="center stack" style="align-items:center"><${Pill} tone="warn"><span class="dot"></span>Đang chờ nhân viên xác nhận<//><h1>Đưa mã này cho nhân viên tại quầy</h1></div>
      <div class="qrbox"><${QR} text=${tx.code} label="Mã giỏ hàng"/><div class="code">${tx.code}</div></div>
      <div class="card flat tight row"><div class="grow"><div class="small muted">Cần thanh toán</div><b class="num" style="font-size:20px">${fmt.money(tx.total + tx.extraDue)}</b></div><${Pill} tone="brand">${fmt.method(tx.method)}<//></div>
      ${transfer && html`<button class="btn soft" onClick=${() => go('/transfer')}><${Icon} name="qr"/>Xem lại QR chuyển khoản</button>`}
      <ol class="stack small" style="padding:0;list-style:none;gap:10px">
        ${['Nhân viên quét mã và đối chiếu giỏ hàng', transfer ? 'Bạn chuyển khoản, nhân viên kiểm tra tiền đã vào tài khoản' : 'Bạn trả tiền, nhân viên xác nhận', 'Màn hình tự hiện mã QR để ra cổng'].map((t, i) => html`<li class="row" style="align-items:flex-start"><span class="avatar" style="width:26px;height:26px;font-size:12px">${i + 1}</span><span>${t}</span></li>`)}
      </ol>
    </div>
    <div class="bar-bottom"><div class="in"><button class="btn" disabled=${!!busy} onClick=${() => undo('/pay')}>${busy === '/pay' ? html`<${Spinner} sm/>` : 'Đổi cách thanh toán'}</button>
      <button class="btn txt" disabled=${!!busy} onClick=${() => undo('/cart')}>Quay lại sửa giỏ hàng</button></div></div></div>`;
}

function useWakeLock() {
  useEffect(() => {
    let lock = null, off = false;
    const get = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* không bắt buộc */ } };
    get();
    const vis = () => { if (document.visibilityState === 'visible' && !off) get(); };
    document.addEventListener('visibilitychange', vis);
    return () => { off = true; document.removeEventListener('visibilitychange', vis); try { lock?.release(); } catch { /* bỏ qua */ } };
  }, []);
}

function CheckingView({ tx }) {
  const { data } = useAsync(() => api.get(`/history/${tx.id}`), [tx.id]);
  const [all, setAll] = useState(false);
  const items = data?.transaction?.items || [];
  const shown = all ? items : items.slice(0, 3);
  return html`<div style="display:flex;flex-direction:column;flex:1"><${Header} title="Kiểm tra giỏ hàng"/>
    <div class="page" style="gap:16px">
      <div class="center stack" style="align-items:center"><div class="ico-tile warn lg"><${Icon} name="shield"/></div>
        <h1>${tx.exitStatus === 'denied' ? 'Vui lòng gặp quản lý' : tx.exitStatus === 'held' ? 'Nhân viên đang xử lý' : 'Bạn được chọn kiểm tra ngẫu nhiên'}</h1>
        <p class="muted" style="max-width:36ch">${tx.exitStatus === 'denied' ? 'Quản lý cần trao đổi thêm về giỏ hàng của bạn. Xin lỗi vì sự bất tiện.' : tx.exitStatus === 'held' ? 'Quản lý sẽ đến hỗ trợ bạn ngay. Vui lòng đợi tại cổng.' : 'Nhân viên sẽ cùng bạn đối chiếu giỏ hàng. Việc này chỉ mất khoảng một phút.'}</p></div>
      <div class="card"><div class="row"><b class="grow">Giỏ hàng đã thanh toán</b><span class="muted small">${tx.itemCount} món</span></div>
        <div class="list">${shown.map((i) => html`<div class="item"><${Icon} name="check" class="" /><div class="grow small">${i.name}</div><b class="num small">× ${i.qty}</b></div>`)}</div>
        ${items.length > 3 && html`<button class="btn txt" onClick=${() => setAll(!all)}>${all ? 'Thu gọn' : `Xem đầy đủ (${items.length} dòng)`}</button>`}</div>
      ${tx.extraDue > 0 && html`<${Banner} tone="brand" icon="info" title=${`Cần thanh toán thêm ${fmt.money(tx.extraDue)}`}>Nhân viên sẽ hướng dẫn bạn thanh toán bổ sung.<//>`}
    </div></div>`;
}

export function Receipt({ s, store, onDone }) {
  useWakeLock();
  const live = s.session?.transaction;
  const cached = getState().receipt?.tx;
  const tx = live?.status === 'paid' ? live : cached && (!live || live.id === cached.id) ? cached : null;
  usePoll(() => refreshSession(), 2500, []);
  useEffect(() => { if (tx?.exitStatus === 'exited') onDone(); }, [tx?.exitStatus]);
  if (!tx || !tx.receipt) return html`<div class="page"><${Loading}/></div>`;
  if (['checking', 'held', 'denied'].includes(tx.exitStatus)) return html`<${CheckingView} tx=${tx}/>`;
  const offline = !s.online;
  return html`<div style="display:flex;flex-direction:column;flex:1">
    <${Header} title="Mã ra cổng"/>
    <div class="page pad-b" style="gap:14px">
      ${offline && html`<${Banner} icon="wifioff">Mất kết nối. Mã QR đã được lưu trên máy nên vẫn dùng được.<//>`}
      <div class="center stack" style="align-items:center"><${Pill} tone="ok"><${Icon} name="check" size=${14}/>Đã thanh toán ${fmt.money(tx.total)}<//><h1>Đưa mã này cho nhân viên ở cổng</h1></div>
      ${tx.extraDue > 0 && html`<${Banner} tone="brand" icon="info" title=${`Còn khoản thu bổ sung ${fmt.money(tx.extraDue)}`}>Hãy đến quầy Self Checkout và đưa mã giỏ hàng <b class="num">${tx.code}</b>.<//>`}
      <div class="qrbox"><${QR} text=${tx.receipt.token} label="Mã QR biên nhận"/><div class="code">${tx.id}</div></div>
      <div class="small muted center">Mã dùng một lần · hiệu lực đến ${fmt.time(tx.receipt.expiresAt)}${tx.receipt.expired ? ' (đã hết hạn, hãy gặp nhân viên)' : ''}</div>
    </div>
    <div class="bar-bottom"><div class="in">
      <div class="grid2"><button class="btn" onClick=${() => go(`/order/${tx.id}`)}><${Icon} name="bag"/>Các món đã mua</button><button class="btn" onClick=${() => go(`/invoice/${tx.id}`)}><${Icon} name="mail"/>Hoá đơn</button></div></div></div>
  </div>`;
}

export function Done({ s, onClose }) {
  const tx = s.session?.transaction || getState().receipt?.tx;
  const [stars, setStars] = useState(tx?.rating || 0);
  async function rate(n) {
    setStars(n);
    try { await api.post(`/transactions/${tx.id}/rating`, { stars: n }); toast('Cảm ơn bạn đã đánh giá', 'ok'); } catch (e) { toast(e.message, 'err'); }
  }
  return html`<div style="display:flex;flex-direction:column;flex:1"><${Header} title="Hoàn tất"/>
    <div class="page" style="align-items:center;text-align:center;justify-content:center;gap:20px">
      <div class="ico-tile green lg"><${Icon} name="check"/></div>
      <h1>Cảm ơn bạn đã mua sắm!</h1>
      <p class="muted">Hoá đơn điện tử ${tx?.invoice?.email ? `đã gửi về ${tx.invoice.email}` : 'có thể nhận qua email trong mục Hoá đơn'}.</p>
      ${tx && html`<div class="stack" style="align-items:center"><b class="small">Trải nghiệm hôm nay thế nào?</b>
        <div class="row" style="justify-content:center;gap:6px" role="radiogroup" aria-label="Đánh giá">${[1, 2, 3, 4, 5].map((n) => html`<button class="iconbtn" style=${`background:transparent;color:${n <= stars ? 'var(--orange)' : 'var(--line)'}`} role="radio" aria-checked=${n <= stars} aria-label=${`${n} sao`} onClick=${() => rate(n)}><svg class="ic" viewBox="0 0 24 24" style=${`width:34px;height:34px;fill:${n <= stars ? 'currentColor' : 'none'}`}><path d="M12 4l2.4 5 5.6.7-4.1 3.8 1.1 5.5L12 16.3 7 19l1.1-5.5L4 9.7 9.6 9z"/></svg></button>`)}</div></div>`}
    </div>
    <div class="bar-bottom"><div class="in">${tx && html`<button class="btn primary" onClick=${() => go(`/invoice/${tx.id}`)}>Xem hoá đơn</button>`}<button class="btn txt" onClick=${onClose}>Đóng</button></div></div></div>`;
}

export function Invoice({ id }) {
  const { data, error, loading, reload } = useAsync(() => api.get(`/history/${id}`), [id]);
  const [email, setEmail] = useState(local.get('brg.email', '') || '');
  const [company, setCompany] = useState(false);
  const [f, setF] = useState({ taxCode: '', name: '', address: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (loading) return html`<div class="page"><${Loading}/></div>`;
  if (error) return html`<div class="page"><${Header} onBack=${() => history.back()} title="Hoá đơn điện tử"/><${ErrorBox} error=${error} retry=${reload}/></div>`;
  const tx = data.transaction, inv = tx.invoice;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit() {
    setBusy(true); setErr(null);
    try {
      await api.post(`/transactions/${id}/invoice`, { email, company: company ? { taxCode: f.taxCode, name: f.name, address: f.address } : undefined });
      local.set('brg.email', email);
      toast(company ? 'Đã xuất hoá đơn công ty' : 'Đã lưu email nhận hoá đơn', 'ok'); reload();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const field = (code) => err?.code === code ? err.message : null;
  return html`<div style="display:flex;flex-direction:column;flex:1"><${Header} onBack=${() => history.back()} title="Hoá đơn điện tử"/>
    <div class="page pad-b">
      <div class="card flat tight row"><div class="ico-tile"><${Icon} name="receipt"/></div><div class="grow"><b>${tx.id}</b><div class="small muted">${fmt.when(tx.paidAt)} · ${fmt.money(tx.total)}</div></div>
        ${inv ? html`<${Pill} tone=${inv.status === 'issued' ? 'ok' : 'warn'}>${inv.status === 'issued' ? 'Đã xuất' : 'Đang xuất'}<//>` : html`<${Pill}>Chưa có<//>`}</div>
      ${inv?.number && html`<div class="small muted">Số hoá đơn: <b class="num">${inv.number}</b> · ${inv.type === 'company' ? 'hoá đơn công ty' : 'hoá đơn bán lẻ'}${inv.email ? ` · gửi về ${inv.email}` : ''}</div>`}
      <${Field} label="Email nhận hoá đơn" error=${field('BAD_EMAIL')}><input class="input" type="email" inputmode="email" autocomplete="email" placeholder="ten@email.com" value=${email} onInput=${(e) => setEmail(e.target.value)}/><//>
      <div class="row"><div class="grow"><b>Xuất hoá đơn cho công ty</b><div class="small muted">Điền mã số thuế. Chỉ xuất được trong ngày phát sinh giao dịch.</div></div><${Switch} checked=${company} onChange=${setCompany} label="Xuất hoá đơn cho công ty"/></div>
      ${company && html`<div class="stack">
        <${Field} label="Mã số thuế" error=${field('BAD_TAX_CODE')}><input class="input num" inputmode="numeric" placeholder="0312345678" value=${f.taxCode} onInput=${set('taxCode')}/><//>
        <${Field} label="Tên công ty"><input class="input" autocomplete="organization" value=${f.name} onInput=${set('name')}/><//>
        <${Field} label="Địa chỉ" error=${field('COMPANY_INFO_REQUIRED') || field('INVOICE_WINDOW_CLOSED')}><input class="input" autocomplete="street-address" value=${f.address} onInput=${set('address')}/><//></div>`}
      ${err && !['BAD_EMAIL', 'BAD_TAX_CODE', 'COMPANY_INFO_REQUIRED', 'INVOICE_WINDOW_CLOSED'].includes(err.code) && html`<${ErrorBox} error=${err}/>`}
    </div>
    <div class="bar-bottom"><div class="in"><button class="btn primary" disabled=${busy || !email} onClick=${submit}>${busy ? html`<${Spinner} sm/>` : company ? 'Xuất hoá đơn công ty' : 'Lưu email nhận hoá đơn'}</button></div></div></div>`;
}

function LinkEmail({ onClose, onLinked }) {
  const [email, setEmail] = useState(local.get('brg.email', '') || '');
  const [step, setStep] = useState('email');
  const [code, setCode] = useState('');
  const [dev, setDev] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function send() {
    setBusy(true); setErr(null);
    try { const r = await api.post('/identity/request', { email }); setDev(r.devCode || null); setStep('code'); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setErr(null);
    try { await api.post('/identity/verify', { email, code }); local.set('brg.email', email); toast('Đã liên kết, lịch sử mua sắm đã cập nhật', 'ok'); onLinked(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return html`<${Sheet} onClose=${onClose}>
    <h2>Xem lịch sử trên máy khác</h2>
    ${step === 'email' ? html`<p class="muted small">Nhập email, chúng tôi gửi mã xác nhận 6 số. Sau khi xác nhận, các thiết bị dùng cùng email sẽ thấy chung lịch sử mua sắm.</p>
      <${Field} label="Email"><input class="input" type="email" inputmode="email" autocomplete="email" value=${email} onInput=${(e) => setEmail(e.target.value)}/><//>
      ${err && html`<div class="errtext">${err.message}</div>`}
      <button class="btn primary" disabled=${busy || !email} onClick=${send}>${busy ? html`<${Spinner} sm/>` : 'Gửi mã xác nhận'}</button>`
    : html`<p class="muted small">Đã gửi mã đến <b>${email}</b>. Mã có hiệu lực 10 phút.</p>
      ${dev && html`<${Banner} tone="info" icon="info">Môi trường thử: mã là <b class="num">${dev}</b>.<//>`}
      <${Field} label="Mã xác nhận"><input class="input big num" inputmode="numeric" maxlength="6" value=${code} onInput=${(e) => setCode(fmt.digits(e.target.value))}/><//>
      ${err && html`<div class="errtext">${err.message}</div>`}
      <button class="btn primary" disabled=${busy || code.length !== 6} onClick=${verify}>${busy ? html`<${Spinner} sm/>` : 'Xác nhận'}</button>`}
    <button class="btn txt" onClick=${onClose}>Để sau</button><//>`;
}

export function History() {
  const { data, error, loading, reload } = useAsync(() => api.get('/history'), []);
  const [link, setLink] = useState(false);
  return html`<div style="display:flex;flex-direction:column;flex:1"><${Header} onBack=${() => go('/')} title="Lịch sử mua sắm"/>
    <div class="page pad-b">
      ${loading && html`<${Loading}/>`}${error && html`<${ErrorBox} error=${error} retry=${reload}/>`}
      ${data && html`
        <${Banner} tone="brand" icon="shield">${data.linkedEmails.length ? `Đang liên kết với ${data.linkedEmails.join(', ')}.` : 'Đang lưu trên máy này. Thêm email để xem cả trên máy khác.'}<//>
        ${!data.orders.length ? html`<${Empty} icon="receipt" title="Chưa có đơn hàng" text="Các đơn đã thanh toán sẽ hiện ở đây."/>`
          : html`<div class="card" style="padding:4px 16px"><div class="list">${data.orders.map((o) => html`
            <button class="item" style="background:none;border:0;width:100%;text-align:left" onClick=${() => go(`/order/${o.id}`)}>
              <div class="grow"><b>${fmt.when(o.paidAt)}</b><div class="small muted">${o.storeName} · ${o.itemCount} món · ${fmt.method(o.method)}</div></div>
              <div style="text-align:right"><b class="num">${fmt.money(o.total)}</b><div>${o.exitStatus === 'exited' ? html`<${Pill} tone="ok">Đã ra cổng<//>` : html`<${Pill} tone="warn">Chưa ra cổng<//>`}</div></div></button>`)}</div></div>`}`}
    </div>
    <div class="bar-bottom"><div class="in"><button class="btn" onClick=${() => setLink(true)}><${Icon} name="mail"/>Xem trên máy khác</button></div></div>
    ${link && html`<${LinkEmail} onClose=${() => setLink(false)} onLinked=${() => { setLink(false); reload(); }}/>`}
  </div>`;
}

export function Order({ id }) {
  const { data, error, loading, reload } = useAsync(() => api.get(`/history/${id}`), [id]);
  if (loading) return html`<div class="page"><${Loading}/></div>`;
  if (error) return html`<div class="page"><${Header} onBack=${() => history.back()} title="Đơn hàng"/><${ErrorBox} error=${error} retry=${reload}/></div>`;
  const tx = data.transaction;
  const items = tx.items || [];
  const showQr = tx.exitStatus !== 'exited' && tx.receipt && !tx.receipt.expired;
  return html`<div style="display:flex;flex-direction:column;flex:1"><${Header} onBack=${() => history.back()} title=${`Đơn ${tx.id}`} sub=${`${fmt.when(tx.paidAt)} · ${data.storeName || ''}`}/>
    <div class="page pad-b">
      <div class="row"><${Pill} tone=${tx.exitStatus === 'exited' ? 'ok' : 'warn'}>${tx.exitStatus === 'exited' ? 'Đã ra cổng' : 'Chưa ra cổng'}<//><${Pill} tone="brand">${fmt.method(tx.method)}<//></div>
      ${showQr && html`<div class="qrbox"><${QR} text=${tx.receipt.token} label="Mã QR biên nhận"/><div class="code">${tx.id}</div></div>`}
      <div class="card" style="padding:8px 16px"><div class="list">${items.map((i) => html`<div class="item"><div class="tile" style=${`--h:${fmt.tone(i.sku.length * 13)}`}>${i.name.slice(0, 1)}</div>
        <div class="grow"><div class="name">${i.name}</div><div class="small muted num">${fmt.money(i.price)} × ${i.qty}</div></div><b class="num">${fmt.money(i.price * i.qty - (i.discount || 0))}</b></div>`)}</div></div>
      <div class="card flat"><div class="sum num"><div><span class="muted">Tạm tính</span><span>${fmt.money(tx.subtotal)}</span></div>${tx.discount > 0 && html`<div><span class="muted">Khuyến mãi</span><span style="color:var(--ok)">−${fmt.money(tx.discount)}</span></div>`}<div class="tot"><span>Đã trả</span><span>${fmt.money(tx.total)}</span></div></div></div>
    </div>
    <div class="bar-bottom"><div class="in"><button class="btn" onClick=${() => go(`/invoice/${tx.id}`)}><${Icon} name="mail"/>${tx.invoice ? 'Hoá đơn điện tử' : 'Yêu cầu hoá đơn'}</button></div></div></div>`;
}
void resetSession; void setState; void deviceId; void Confirm;
