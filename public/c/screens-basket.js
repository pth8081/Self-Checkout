// Chế độ giỏ QR: khách bấm Thanh toán, điện thoại hiện mã QR chứa mã vạch và số lượng từng món để thu ngân quét vào POS.
// Mã QR được tạo và lưu ngay trên máy nên vẫn hiện khi mất mạng, tắt điện thoại hoặc tắt trình duyệt.
import { html, useState, useEffect, Header, Icon, QR, Banner, Pill, Spinner, ErrorBox, Loading, go, fmt, toast, useAsync } from '/shared/lib.js';
import { editBasket, finishBasket, syncBasket, refreshSession, loadBill, cachedBill, downloadBillPdf } from './store.js';

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
        <button class="btn line" disabled=${!!busy} onClick=${act('pdf', () => downloadBillPdf(tx.id, tx.code))}>${busy === 'pdf' ? html`<${Spinner} sm/>` : html`<${Icon} name="download"/>Tải bill PDF`}</button></div>`}
      ${!paid && html`<div class="qrbox"><${QR} text=${b.qr} ecc=${long ? 'L' : 'M'} label="Mã QR giỏ hàng"/><div class="code">${b.ref}</div></div>`}
      <div class="card flat tight"><div class="row"><div class="grow"><div class="small muted">Tạm tính · ${b.count} món</div>
        <b class="num" style="font-size:22px">${fmt.money(tx?.posAmount ?? b.total)}</b></div></div>
        <div class="xs muted">${paid ? 'Số tiền đã thanh toán theo máy tính tiền' : 'Số tiền cuối cùng do máy tính tiền tính theo giá và khuyến mãi tại cửa hàng'}</div></div>
      ${!b.synced && html`<${Banner} tone="brand" icon="info">${navigator.onLine ? 'Đang lưu giỏ lên hệ thống…' : 'Đang mất mạng. Mã QR vẫn dùng được, thu ngân vẫn quét được.'}<//>`}
      ${b.pending > 0 && html`<${Banner} tone="warn" icon="alert">${b.pending} món quét lúc mất mạng chưa có giá trong tạm tính. Thu ngân vẫn tính đủ.<//>`}
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
export function Bill({ id }) {
  const { data, error, loading, reload } = useAsync(() => loadBill(id), [id]);
  const [busy, setBusy] = useState(false);
  const b = data || cachedBill(id);
  if (loading && !b) return html`<div class="page"><${Loading}/></div>`;
  if (!b) return html`<div class="page"><${Header} onBack=${() => history.back()} title="Bill"/><${ErrorBox} error=${error} retry=${reload}/></div>`;
  return html`<div style="display:flex;flex-direction:column;flex:1"><${Header} onBack=${() => history.back()} title="Bill" sub=${`${fmt.when(b.paidAt)} · ${b.storeName}`}/>
    <div class="page pad-b" style="gap:14px">
      <div class="row wrap"><${Pill} tone=${b.provisional ? 'warn' : 'ok'}>${b.provisional ? 'Tạm tính' : 'Bill từ máy tính tiền'}<//><${Pill} tone="brand">${b.methodLabel}<//>${b.invoiceNo && html`<${Pill}>HĐ ${b.invoiceNo}<//>`}</div>
      ${b.provisional && html`<${Banner} tone="warn" icon="info">Đây là tạm tính của ứng dụng, chưa nhận được bill chính thức từ máy tính tiền. Số tiền thực trả theo hoá đơn của cửa hàng.<//>`}
      <div class="card" style="padding:8px 16px"><div class="list">${b.lines.map((l, i) => html`<div class="item" key=${i}>
        <div class="grow"><div class="name">${l.name}</div><div class="small muted num">${fmt.money(l.unitPrice)} × ${l.qty}${l.discount ? ` · giảm ${fmt.money(l.discount)}` : ''}</div></div>
        <b class="num">${fmt.money(l.lineTotal)}</b></div>`)}</div></div>
      <div class="card flat"><div class="sum num">${b.discount > 0 && html`<div><span class="muted">Khuyến mãi</span><span style="color:var(--ok)">−${fmt.money(b.discount)}</span></div>`}
        <div class="tot"><span>Tổng thanh toán</span><span>${fmt.money(b.total)}</span></div></div></div>
      <div class="small muted">Mã giỏ ${b.code}${b.cashier ? ` · Thu ngân ${b.cashier}` : ''}</div>
      ${b.invoiceUrl && html`<a class="btn line" href=${b.invoiceUrl} target="_blank" rel="noopener"><${Icon} name="mail"/>Xem hoá đơn điện tử</a>`}
    </div>
    <div class="bar-bottom"><div class="in"><button class="btn primary" disabled=${busy} onClick=${async () => { setBusy(true); try { await downloadBillPdf(b.id, b.code); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } }}>${busy ? html`<${Spinner} sm/>` : html`<${Icon} name="download"/>Tải bill PDF`}</button></div></div></div>`;
}
