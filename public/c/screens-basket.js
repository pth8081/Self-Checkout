// Chế độ giỏ QR: khách bấm Thanh toán, điện thoại hiện mã QR chứa mã vạch và số lượng từng món để thu ngân quét vào POS.
// Mã QR được tạo và lưu ngay trên máy nên vẫn hiện khi mất mạng, tắt điện thoại hoặc tắt trình duyệt.
import { html, useState, useEffect, Header, Icon, QR, Banner, Pill, Spinner, go, fmt, toast, useRoute } from '/shared/lib.js';
import { editBasket, finishBasket, syncBasket, refreshSession } from './store.js';

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
        ${paid ? html`<div class="ico-tile green lg"><${Icon} name="check"/></div><${Pill} tone="ok"><${Icon} name="check" size=${14}/>Đã thanh toán<//><h1>Cảm ơn bạn đã mua sắm</h1>`
          : html`<${Pill} tone="warn"><span class="dot"></span>Chờ thu ngân quét mã<//><h1>Đưa mã này cho thu ngân quét vào máy tính tiền</h1>`}
      </div>
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
