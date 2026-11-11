// Chế độ giỏ QR: khách bấm Thanh toán, điện thoại hiện mã QR ngắn (mã điểm và mã giỏ), Dsmart POS lấy danh sách mặt hàng bằng API, để thu ngân quét vào Dsmart POS.
// Mã QR được tạo và lưu ngay trên máy nên vẫn hiện khi mất mạng, tắt điện thoại hoặc tắt trình duyệt.
import { html, useState, useEffect, Header, Icon, QR, Banner, Pill, Spinner, ErrorBox, Loading, Confirm, go, fmt, toast, useAsync } from '/shared/lib.js';
import { setBasket, editBasket, finishBasket, syncBasket, refreshSession, loadBill, cachedBill, downloadBillPdf, setBillEmail, loadPublicBill, downloadPublicBillPdf, local, EMAIL_RE } from './store.js';

/** Thông báo khác biệt giữa giỏ khách đã quét và đơn thu ngân tính ở quầy (thêm, bớt, đổi số lượng). */
function DiffNotice({ diff, title, footer }) {
  if (!diff || diff.same) return null;
  const rows = [
    ...diff.added.map((x) => ({ k: 'a', t: x.name, d: `Thêm ${x.qty}` })),
    ...diff.removed.map((x) => ({ k: 'r', t: x.name, d: `Bớt ${x.qty}` })),
    ...diff.changed.map((x) => ({ k: 'c', t: x.name, d: `Số lượng ${x.from} thành ${x.to}` }))];
  return html`<${Banner} tone="warn" icon="info" title=${title}>
    <div class="stack" style="gap:4px;margin-top:4px">${rows.map((r, i) => html`<div class="row" key=${i} style="justify-content:space-between;gap:8px"><span>${r.t}</span><b class="num" style="white-space:nowrap">${r.d}</b></div>`)}</div>
    ${footer && html`<div class="small" style="margin-top:6px">${footer}</div>`}<//>`;
}

/** Ô nhập email nhận bill. Trước khi thanh toán: lưu để gửi khi Dsmart POS báo xong. Sau thanh toán: gửi ngay. */
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
  const [askMore, setAskMore] = useState(false);
  // Tự hỏi máy chủ vài giây một lần (nếu Dsmart POS báo đã thanh toán thì hiện), và gửi lại khi có mạng.
  useEffect(() => {
    const t = setInterval(() => { if (navigator.onLine && s.session) { syncBasket().then(() => refreshSession()).catch(() => {}); } }, 3000);
    return () => clearInterval(t);
  }, [!!s.session]);
  // Thu ngân hủy đơn trên Dsmart POS trước khi thu tiền: máy chủ trả giỏ về trạng thái đang quét. Báo khách và cho sửa giỏ.
  useEffect(() => {
    if (b?.synced && s.session?.status === 'active' && !tx) {
      toast(s.session.releasedReason === 'expired' ? 'Mã QR đã hết hạn vì quá 30 phút chưa thanh toán. Giỏ của bạn vẫn còn, bấm Thanh toán để tạo mã mới' : 'Thu ngân đã hủy đơn. Bạn có thể sửa giỏ rồi thanh toán lại');
      setBasket(null); go('/cart', true);
    }
  }, [b?.synced, s.session?.status, !!tx]);
  if (!b) return null;
  const voided = tx?.status === 'voided';
  const paid = tx?.status === 'paid';
  // Mã QR chỉ có mã điểm và mã giỏ, hiện khi máy chủ đã nhận giỏ. Chưa gửi được giỏ (mất mạng) thì chờ, có mạng lại mã tự hiện.
  const qrText = b.synced && b.qrShort ? b.qrShort : '';
  const offline = s.online === false || !navigator.onLine;
  const act = (name, fn) => async () => { setBusy(name); try { await fn(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  return html`<div style="display:flex;flex-direction:column;flex:1">
    <${Header} title="Thanh toán"/>
    <div class="page pad-b" style="gap:14px">
      <div class="center stack" style="align-items:center">
        ${voided ? html`<div class="ico-tile lg"><${Icon} name="alert"/></div><${Pill} tone="warn">Đơn đã hủy<//><h1>Đơn này đã được hủy</h1><p class="muted">Cửa hàng đã hủy đơn (ví dụ hoàn tiền hoặc trả hàng). Nếu cần hỗ trợ, hãy hỏi thu ngân.</p>`
          : paid ? html`<div class="ico-tile green lg"><${Icon} name="check"/></div><${Pill} tone="ok"><${Icon} name="check" size=${14}/>Đã hoàn thành thanh toán<//><h1>Cảm ơn bạn đã mua sắm</h1>`
          : html`<${Pill} tone="warn"><span class="dot"></span>Chờ thu ngân quét mã<//><h1>Đưa mã này cho thu ngân quét vào máy tính tiền</h1>`}
      </div>
      ${paid && html`<div class="stack" style="gap:8px"><button class="btn primary" onClick=${() => go(`/bill/${tx.id}`)}><${Icon} name="receipt"/>Xem bill</button>
        ${tx.invoiceUrl && html`<a class="btn" href=${tx.invoiceUrl} target="_blank" rel="noopener"><${Icon} name="receipt"/>Xem hóa đơn điện tử</a>`}
        ${tx.transactionUrl && html`<a class="btn line" href=${tx.transactionUrl} target="_blank" rel="noopener"><${Icon} name="link"/>Xem chi tiết giao dịch</a>`}
        <button class="btn line" disabled=${!!busy} onClick=${act('pdf', () => downloadBillPdf(tx.id, tx.code))}>${busy === 'pdf' ? html`<${Spinner} sm/>` : html`<${Icon} name="download"/>Tải bill PDF`}</button></div>`}
      ${!paid && !voided && tx?.posDraft && html`<${DiffNotice} diff=${tx.posDraft.diff} title="Thu ngân đã cập nhật đơn tại quầy" footer=${html`Đơn tại quầy: ${tx.posDraft.itemCount} mặt hàng, tạm tính <span style="font-weight:700">${fmt.money(tx.posDraft.total)}</span>. Số tiền cuối cùng theo máy tính tiền.`}/>`}
      ${!paid && !voided && html`<div class="qrbox">${qrText ? html`<${QR} text=${qrText} ecc="M" label="Mã QR giỏ hàng"/>` : offline
        ? html`<div class="stack center" style="min-height:200px;justify-content:center;gap:8px"><${Icon} name="wifioff" size=${36}/><b>Chưa có mạng</b><span class="muted small">Cần có mạng để tạo mã QR thanh toán. Có mạng lại mã sẽ tự hiện.</span></div>`
        : html`<div class="row" style="justify-content:center;min-height:200px;gap:8px"><${Spinner}/><span class="muted">Đang tạo mã…</span></div>`}<div class="code">${b.ref}</div></div>`}
      <div class="card flat tight"><div class="row"><div class="grow"><div class="small muted">${paid && tx?.posItemCount != null ? 'Thực mua' : 'Tạm tính'} · ${paid && tx?.posItemCount != null ? tx.posItemCount : b.count} mặt hàng</div>
        <b class="num" style="font-size:22px">${fmt.money(tx?.posAmount ?? b.total)}</b></div></div>
        <div class="xs muted">${paid && tx?.refundTotal > 0 ? `Đã hoàn trả ${fmt.money(tx.refundTotal)}. Thực thanh toán ${fmt.money((tx.posAmount ?? b.total) - tx.refundTotal)}` : paid ? 'Số tiền đã thanh toán theo máy tính tiền' : 'Thu ngân đối chiếu số mặt hàng này với hàng trong túi. Số tiền cuối cùng do máy tính tiền tính theo giá và khuyến mãi'}</div></div>
      ${paid && tx?.cartDiff && html`<${DiffNotice} diff=${tx.cartDiff} title="Đơn ở quầy khác giỏ bạn đã quét" footer="Thu ngân đã điều chỉnh ở quầy. Số tiền và bill theo đơn tại quầy."/>`}
      ${store.emailEnabled && html`<${EmailBox} key=${paid ? 'p' : 'u'} txId=${tx?.id} paid=${paid} status=${tx?.billEmailStatus} masked=${tx?.billEmail} initial=${b.email || local.get('brg.c.email', '')}/>`}
      ${!b.synced && html`<${Banner} tone="brand" icon="info">${navigator.onLine ? 'Đang lưu giỏ lên hệ thống…' : 'Đang mất mạng nên chưa gửi được giỏ lên hệ thống. Mã QR sẽ hiện khi có mạng.'}<//>`}
      ${b.pending > 0 && html`<${Banner} tone="warn" icon="alert">${b.pending} mặt hàng quét lúc mất mạng chưa có giá trong tạm tính. Thu ngân vẫn tính đủ.<//>`}
      ${b.error && html`<${Banner} tone="warn" icon="alert">${b.error}<//>`}
      ${!paid && !voided && html`<ol class="stack small" style="padding:0;list-style:none;gap:10px">
        <li class="row" style="align-items:flex-start"><span class="avatar" style="width:26px;height:26px;font-size:12px">1</span><span>Thu ngân quét mã QR này, đơn hiện sẵn trên máy tính tiền</span></li>
        <li class="row" style="align-items:flex-start"><span class="avatar" style="width:26px;height:26px;font-size:12px">2</span><span>Thanh toán ngay tại quầy</span></li></ol>
      <div class="small muted center">Mã được lưu trên điện thoại. Mất mạng, tắt máy hay tắt trình duyệt, mở lại link cửa hàng là thấy lại.</div>`}
    </div>
    <div class="bar-bottom"><div class="in">
      <button class="btn primary" disabled=${!!busy || (!paid && !voided)} onClick=${act('done', async () => { await finishBasket(); go('/', true); })}>${busy === 'done' ? html`<${Spinner} sm/>` : paid || voided ? 'Xong' : html`<${Spinner} sm/>Chờ thu ngân xác nhận thanh toán`}</button>
      ${!paid && !voided && html`<div class="xs muted center">Nút Xong sẽ sáng khi Dsmart POS báo thanh toán thành công. Màn hình tự cập nhật.</div>`}
      ${!paid && !voided && html`<button class="btn line" disabled=${!!busy} onClick=${() => setAskMore(true)}><${Icon} name="bag"/>Tiếp tục mua sắm</button>`}
    </div></div>
    ${askMore && html`<${Confirm} title="Tiếp tục mua sắm?" ok="Tiếp tục mua sắm" cancel="Ở lại màn hình thanh toán" busy=${busy === 'edit'}
      onOk=${act('edit', async () => { try { await editBasket(); setAskMore(false); go('/scan', true); } catch (e) { setAskMore(false); throw e; } })} onCancel=${() => setAskMore(false)}>
      <p class="muted small">Giỏ hàng của bạn được giữ nguyên, bạn quét thêm rồi bấm Thanh toán lại để lấy mã QR mới. Mã QR hiện tại sẽ không còn dùng được. Nếu thu ngân đã quét mã này, hãy báo thu ngân hủy đơn trên máy tính tiền.</p><//>`}
    </div>`;
}

/** Màn hình bill: bill thật từ Dsmart POS (nếu Dsmart POS đã gửi) hoặc tạm tính của BRG, kèm tải PDF. */
export function Bill({ id, token }) {
  const { data, error, loading, reload } = useAsync(() => (token ? loadPublicBill(token) : loadBill(id)), [id, token]);
  const [busy, setBusy] = useState(false);
  const b = data || (token ? null : cachedBill(id));
  if (loading && !b) return html`<div class="page"><${Loading}/></div>`;
  if (!b) return html`<div class="page"><${Header} onBack=${() => history.back()} title="Bill"/><${ErrorBox} error=${error} retry=${reload}/></div>`;
  return html`<div style="display:flex;flex-direction:column;flex:1"><${Header} onBack=${token ? undefined : () => history.back()} title="Bill" sub=${`${fmt.when(b.paidAt)} · ${b.storeName}`}/>
    <div class="page pad-b" style="gap:14px">
      <div class="row wrap"><${Pill} tone=${b.provisional ? 'warn' : 'ok'}>${b.provisional ? 'Tạm tính' : 'Bill từ máy tính tiền'}<//><${Pill} tone="brand">${b.methodLabel}<//></div>
      ${b.provisional && html`<${Banner} tone="warn" icon="info">Đây là tạm tính của ứng dụng, chưa nhận được bill chính thức từ máy tính tiền. Số tiền thực trả theo hóa đơn của cửa hàng.<//>`}
      <div class="card" style="padding:8px 16px"><div class="list">${b.lines.map((l, i) => html`<div class="item" key=${i}>
        <div class="grow"><div class="name">${l.name}</div><div class="small muted num">${fmt.money(l.unitPrice)} × ${l.qty}${l.discount ? ` · giảm ${fmt.money(l.discount)}` : ''}</div></div>
        <b class="num">${fmt.money(l.lineTotal)}</b></div>`)}</div></div>
      <div class="card flat"><div class="sum num">${b.discount > 0 && html`<div><span class="muted">Khuyến mãi</span><span style="color:var(--ok)">−${fmt.money(b.discount)}</span></div>`}
        ${b.adjustment ? html`<div><span class="muted">Điều chỉnh theo hóa đơn</span><span>${b.adjustment < 0 ? '−' : '+'}${fmt.money(Math.abs(b.adjustment))}</span></div>` : null}
        <div class="tot"><span>Tổng thanh toán</span><span>${fmt.money(b.total)}</span></div>
        ${b.refundTotal > 0 && html`<div><span class="muted">Đã hoàn trả</span><span style="color:var(--ok)">−${fmt.money(b.refundTotal)}</span></div><div class="tot"><span>Thực thanh toán</span><span>${fmt.money(b.netTotal)}</span></div>`}</div></div>
      ${b.refunds?.length > 0 && html`<div class="card" style="padding:8px 16px"><div class="small b" style="padding:8px 0">Mặt hàng đã hoàn trả</div><div class="list">${b.refunds.flatMap((r) => (r.lines.length ? r.lines : [{ name: r.reason || 'Hoàn trả', qty: '', amount: r.amount }])).map((l, i) => html`<div class="item" key=${i}><div class="grow"><div class="name">${l.name}</div>${l.qty ? html`<div class="small muted num">× ${l.qty}</div>` : null}</div><b class="num">−${fmt.money(l.amount)}</b></div>`)}</div></div>`}
      <div class="small muted">Mã giỏ ${b.code}${b.cashier ? ` · Thu ngân ${b.cashier}` : ''}</div>
      ${b.invoiceUrl && html`<a class="btn primary" href=${b.invoiceUrl} target="_blank" rel="noopener"><${Icon} name="receipt"/>Xem hóa đơn điện tử</a>`}
      ${b.transactionUrl && html`<a class="btn line" href=${b.transactionUrl} target="_blank" rel="noopener"><${Icon} name="link"/>Xem chi tiết giao dịch</a>`}
    </div>
    <div class="bar-bottom"><div class="in"><button class="btn primary" disabled=${busy} onClick=${async () => { setBusy(true); try { await (token ? downloadPublicBillPdf(token, b.code) : downloadBillPdf(b.id, b.code)); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } }}>${busy ? html`<${Spinner} sm/>` : html`<${Icon} name="download"/>Tải bill PDF`}</button></div></div></div>`;
}
