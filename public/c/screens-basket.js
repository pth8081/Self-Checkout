// Chế độ giỏ QR: khách bấm Thanh toán, điện thoại hiện mã QR chứa mã vạch và số lượng từng mặt hàng để thu ngân quét vào POS.
// Mã QR được tạo và lưu ngay trên máy nên vẫn hiện khi mất mạng, tắt điện thoại hoặc tắt trình duyệt.
import { html, useState, useEffect, Header, Icon, QR, Banner, Pill, Spinner, ErrorBox, Loading, go, fmt, toast, useAsync } from '/shared/lib.js';
import { editBasket, finishBasket, syncBasket, refreshSession, loadBill, cachedBill, downloadBillPdf, setBillEmail, loadPublicBill, downloadPublicBillPdf, local, EMAIL_RE } from './store.js';

/** Ô nhập email nhận bill. Trước khi thanh toán: lưu để gửi khi POS báo xong. Sau thanh toán: gửi ngay. */
function EmailBox({ txId, paid, status, masked, initial }) {
  const [v, setV] = useState(initial || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const ok = EMAIL_RE.test(v.trim());
  const submit = async () => {
    setBusy(true); setMsg('');
    try { const r = await setBillEmail(v, txId); setMsg(r === 'sending' ? 'Đang gửi bill, kiểm tra hộp thư trong ít phút' : 'Đã lưu. Bill sẽ gửi về email này khi thanh toán xong'); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  if (paid && masked && status === 'sent') return html`<div class="card flat tight small row" style="gap:8px"><${Icon} name="mail" size=${18}/><span>Đã gửi bill tới <b>${masked}</b></span></div>`;
  return html`<div class="card flat tight stack" style="gap:8px">
    <label class="small b" for="bill-email">${paid ? 'Gửi bill về email' : 'Nhận bill qua email (không bắt buộc)'}</label>
    ${masked && html`<div class="xs muted">${status === 'sent' ? '' : paid ? `Đang gửi bill tới ${masked}` : `Sẽ gửi tới ${masked}`}</div>`}
    <div class="row" style="gap:8px"><input id="bill-email" class="input grow" type="email" inputmode="email" autocomplete="email" placeholder="ten@email.com" value=${v} onInput=${(e) => setV(e.target.value)}/>
      <button class="btn line auto" disabled=${busy || !ok} onClick=${submit}>${busy ? html`<${Spinner} sm/>` : paid ? 'Gửi' : 'Lưu'}</button></div>
    ${msg && html`<div class="xs muted" role="status">${msg}</div>`}</div>`;
}

export function Basket({ s, store }) {
  const b = s.basket;
  const tx = s.session?.transaction;
  const [busy, setBusy] = useState('');
  // Tự hỏi máy chủ vài giây một lần (nếu POS báo đã thanh toán thì hiện), và gửi lại khi có mạng.
  useEffect(() => {
    const t = setInterval(() => { if (navigator.onLine && s.session) { syncBasket().then(() => refreshSession()).catch(() => {}); } }, 6000);
    return () => clearInterval(t);
  }, [!!s.session]);
  if (!b) return null;
  const paid = tx?.status === 'paid';
  const long = b.qr.length > 900;
  const act = (name, fn) => async () => { setBusy(name); try { await fn(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  return html`<div style="display:flex;flex-direction:column;flex:1">
    <${Header} title="Thanh toán"/>
    <div class="page pad-b" style="gap:14px">
      <div class="center stack" style="align-items:center">
        ${paid ? html`<div class="ico-tile green lg"><${Icon} name="check"/></div><${Pill} tone="ok"><${Icon} name="check" size=${14}/>Đã hoàn thành thanh toán<//><h1>Cảm ơn bạn đã mua sắm</h1>`
          : html`<${Pill} tone="warn"><span class="dot"></span>Chờ thu ngân quét mã<//><h1>Đưa mã này cho thu ngân quét vào máy tính tiền</h1>`}
      </div>
      ${paid && html`<div class="stack" style="gap:8px"><button class="btn primary" onClick=${() => go(`/bill/${tx.id}`)}><${Icon} name="receipt"/>Xem bill</button>
        ${tx.invoicePortalUrl && html`<a class="btn" href=${tx.invoicePortalUrl} target="_blank" rel="noopener"><${Icon} name="mail"/>Khai báo hoá đơn điện tử</a>`}
        <button class="btn line" disabled=${!!busy} onClick=${act('pdf', () => downloadBillPdf(tx.id, tx.code))}>${busy === 'pdf' ? html`<${Spinner} sm/>` : html`<${Icon} name="download"/>Tải bill PDF`}</button></div>`}
      ${!paid && html`<div class="qrbox"><${QR} text=${b.qr} ecc=${long ? 'L' : 'M'} label="Mã QR giỏ hàng"/><div class="code">${b.ref}</div></div>`}
      <div class="card flat tight"><div class="row"><div class="grow"><div class="small muted">Tạm tính · ${b.count} mặt hàng</div>
        <b class="num" style="font-size:22px">${fmt.money(tx?.posAmount ?? b.total)}</b></div></div>
        <div class="xs muted">${paid ? 'Số tiền đã thanh toán theo máy tính tiền' : 'Số tiền cuối cùng do máy tính tiền tính theo giá và khuyến mãi tại cửa hàng'}</div></div>
      ${store.emailEnabled && html`<${EmailBox} key=${paid ? 'p' : 'u'} txId=${tx?.id} paid=${paid} status=${tx?.billEmailStatus} masked=${tx?.billEmail} initial=${b.email || local.get('brg.c.email', '')}/>`}
      ${!b.synced && html`<${Banner} tone="brand" icon="info">${navigator.onLine ? 'Đang lưu giỏ lên hệ thống…' : 'Đang mất mạng. Mã QR vẫn dùng được, thu ngân vẫn quét được.'}<//>`}
      ${b.pending > 0 && html`<${Banner} tone="warn" icon="alert">${b.pending} mặt hàng quét lúc mất mạng chưa có giá trong tạm tính. Thu ngân vẫn tính đủ.<//>`}
      ${b.error && html`<${Banner} tone="warn" icon="alert">${b.error}<//>`}
      ${!paid && html`<ol class="stack small" style="padding:0;list-style:none;gap:10px">
        <li class="row" style="align-items:flex-start"><span class="avatar" style="width:26px;height:26px;font-size:12px">1</span><span>Thu ngân quét mã QR này, đơn hiện sẵn trên máy tính tiền</span></li>
        <li class="row" style="align-items:flex-start"><span class="avatar" style="width:26px;height:26px;font-size:12px">2</span><span>Thanh toán ngay tại quầy</span></li></ol>
      <div class="small muted center">Mã được lưu trên điện thoại. Mất mạng, tắt máy hay tắt trình duyệt, mở lại link cửa hàng là thấy lại.</div>`}
    </div>
    <div class="bar-bottom"><div class="in">
      <button class="btn primary" disabled=${!!busy} onClick=${act('done', async () => { await finishBasket(); go('/', true); })}>${busy === 'done' ? html`<${Spinner} sm/>` : paid ? 'Xong' : 'Đã thanh toán xong'}</button>
      ${!paid && html`<button class="btn line" disabled=${!!busy} onClick=${act('edit', async () => { await editBasket(); go('/cart', true); })}>${busy === 'edit' ? html`<${Spinner} sm/>` : 'Sửa giỏ hàng'}</button>`}
    </div></div></div>`;
}

/** Màn hình bill: bill thật từ POS (nếu POS đã gửi) hoặc tạm tính của BRG, kèm tải PDF. */
export function Bill({ id, token }) {
  const { data, error, loading, reload } = useAsync(() => (token ? loadPublicBill(token) : loadBill(id)), [id, token]);
  const [busy, setBusy] = useState(false);
  const b = data || (token ? null : cachedBill(id));
  if (loading && !b) return html`<div class="page"><${Loading}/></div>`;
  if (!b) return html`<div class="page"><${Header} onBack=${() => history.back()} title="Bill"/><${ErrorBox} error=${error} retry=${reload}/></div>`;
  return html`<div style="display:flex;flex-direction:column;flex:1"><${Header} onBack=${token ? undefined : () => history.back()} title="Bill" sub=${`${fmt.when(b.paidAt)} · ${b.storeName}`}/>
    <div class="page pad-b" style="gap:14px">
      <div class="row wrap"><${Pill} tone=${b.provisional ? 'warn' : 'ok'}>${b.provisional ? 'Tạm tính' : 'Bill từ máy tính tiền'}<//><${Pill} tone="brand">${b.methodLabel}<//></div>
      ${b.provisional && html`<${Banner} tone="warn" icon="info">Đây là tạm tính của ứng dụng, chưa nhận được bill chính thức từ máy tính tiền. Số tiền thực trả theo hoá đơn của cửa hàng.<//>`}
      <div class="card" style="padding:8px 16px"><div class="list">${b.lines.map((l, i) => html`<div class="item" key=${i}>
        <div class="grow"><div class="name">${l.name}</div><div class="small muted num">${fmt.money(l.unitPrice)} × ${l.qty}${l.discount ? ` · giảm ${fmt.money(l.discount)}` : ''}</div></div>
        <b class="num">${fmt.money(l.lineTotal)}</b></div>`)}</div></div>
      <div class="card flat"><div class="sum num">${b.discount > 0 && html`<div><span class="muted">Khuyến mãi</span><span style="color:var(--ok)">−${fmt.money(b.discount)}</span></div>`}
        ${b.adjustment ? html`<div><span class="muted">Điều chỉnh theo hoá đơn</span><span>${b.adjustment < 0 ? '−' : '+'}${fmt.money(Math.abs(b.adjustment))}</span></div>` : null}
        <div class="tot"><span>Tổng thanh toán</span><span>${fmt.money(b.total)}</span></div></div></div>
      <div class="small muted">Mã giỏ ${b.code}${b.cashier ? ` · Thu ngân ${b.cashier}` : ''}</div>
      ${b.invoicePortalUrl && html`<a class="btn primary" href=${b.invoicePortalUrl} target="_blank" rel="noopener"><${Icon} name="receipt"/>Khai báo hoá đơn điện tử</a>`}
    </div>
    <div class="bar-bottom"><div class="in"><button class="btn primary" disabled=${busy} onClick=${async () => { setBusy(true); try { await (token ? downloadPublicBillPdf(token, b.code) : downloadBillPdf(b.id, b.code)); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } }}>${busy ? html`<${Spinner} sm/>` : html`<${Icon} name="download"/>Tải bill PDF`}</button></div></div></div>`;
}
