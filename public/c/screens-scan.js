// Quét sản phẩm và giỏ hàng: M08 quét, M09 vừa quét, M10 lỗi mã, M11 nhập tay, M12–M15 giỏ hàng.
import { html, useState, useEffect, useRef, Header, Icon, Scanner, Sheet, Banner, Pill, Spinner, Empty, Confirm, Keypad, go, fmt, toast, useOnline } from '/shared/lib.js';
import { api, scan, setQty, removeItem, cartView, dismissIssue, makeBasket } from './store.js';

export function Help({ onClose }) {
  return html`<${Sheet} onClose=${onClose}>
    <h2>Cần giúp?</h2>
    <div class="stack">
      <div class="row" style="align-items:flex-start"><${Icon} name="barcode"/><div><b>Mã vạch không quét được?</b><div class="small muted">Giữ sản phẩm ổn định, đủ sáng, cách camera khoảng 15–20 cm. Bật đèn flash nếu thiếu sáng. Hoặc chọn Nhập mã và gõ dãy số dưới mã vạch.</div></div></div>
      <div class="row" style="align-items:flex-start"><${Icon} name="user"/><div><b>Cần nhân viên?</b><div class="small muted">Hãy vẫy nhân viên gần nhất hoặc đến quầy Scan & Checkout. Nhân viên sẽ hỗ trợ bạn ngay.</div></div></div>
    </div>
    <button class="btn primary" onClick=${onClose}>Đã hiểu</button><//>`;
}

/** Thẻ trượt lên sau mỗi lần quét. */
function ScanSheet({ result, onClose, onManual, onHelp }) {
  if (result.kind === 'pending') {
    return html`<div class="overlay" style="background:transparent;pointer-events:none"><div class="sheet" style="pointer-events:auto">
      <${Pill} tone="warn"><${Icon} name="wifioff" size=${14}/>Đã lưu trên máy<//>
      <p>Mã <b class="num">${result.barcode}</b> sẽ được thêm vào giỏ và cập nhật giá khi có mạng.</p>
      <button class="btn primary" onClick=${onClose}>Quét mặt hàng tiếp theo</button></div></div>`;
  }
  if (result.kind === 'error') {
    const titles = { NOT_FOUND: 'Không tìm thấy sản phẩm', INVALID_BARCODE: 'Không đọc được mã vạch', INACTIVE: 'Sản phẩm đang ngừng bán', OUT_OF_STOCK: 'Sản phẩm đã hết hàng', CART_FULL: 'Giỏ đã đầy' };
    return html`<div class="overlay" style="background:transparent;pointer-events:none"><div class="sheet" style="pointer-events:auto">
      <div class="row"><div class="ico-tile err"><${Icon} name="alert"/></div><div class="grow"><b style="font-size:17px">${titles[result.code] || 'Không thêm được sản phẩm'}</b>${result.barcode && html`<div class="small muted num">Mã ${result.barcode}</div>`}</div></div>
      <p class="muted">${result.message}${result.code === 'NOT_FOUND' ? '. Bạn có thể thử lại hoặc gọi nhân viên hỗ trợ.' : ''}</p>
      <button class="btn primary" onClick=${onClose}>Quét lại</button>
      <div class="grid2"><button class="btn" onClick=${onManual}><${Icon} name="kbd"/>Nhập mã tay</button><button class="btn" onClick=${onHelp}><${Icon} name="phone"/>Gọi nhân viên</button></div>
    </div></div>`;
  }
  const it = result.item;
  return html`<div class="overlay" style="background:transparent;pointer-events:none"><div class="sheet" style="pointer-events:auto">
    <${Pill} tone="ok"><${Icon} name="check" size=${14}/>Đã thêm vào giỏ<//>
    <div class="row"><div class="tile" style=${`--h:${fmt.tone(it.sku.length * 13)};width:56px;height:56px`}>${it.name.slice(0, 1)}</div>
      <div class="grow"><b>${it.name}</b><div class="muted small num">${unitText(it)}</div></div>
      <div class="stepper"><button onClick=${() => result.dec(it)} aria-label="Giảm"><${Icon} name="minus" size=${16}/></button><span class="num">${result.qty ?? it.qty}</span><button onClick=${() => result.inc(it)} aria-label="Tăng"><${Icon} name="plus" size=${16}/></button></div></div>
    ${it.ageRestricted && html`<${Banner} icon="info">Sản phẩm giới hạn độ tuổi. Nhân viên sẽ kiểm tra giấy tờ khi thanh toán.<//>`}
    <div class="row"><span class="muted grow">Tổng giỏ hàng · ${result.count} mặt hàng</span><b class="num" style="font-size:18px">${fmt.money(result.total)}</b></div>
    <button class="btn primary" onClick=${onClose}>Quét mặt hàng tiếp theo</button></div></div>`;
}

export function Scan({ s, store, onBlocked }) {
  const cart = cartView(s);
  const [sheet, setSheet] = useState(null);
  const [status, setStatus] = useState('');
  const [help, setHelp] = useState(false);
  const busy = useRef(false);
  const timer = useRef(0);
  const online = useOnline();

  async function onScanText(text) {
    if (busy.current) return;
    busy.current = true; clearTimeout(timer.current);
    try {
      const r = await scan(text);
      if (r.pending) { setStatus('ok'); setSheet({ kind: 'pending', barcode: text }); }
      else if (r.ok) { setStatus('ok'); setSheet({ kind: 'ok', item: r.item }); }
      else { setStatus('err'); setSheet({ kind: 'error', ...r, barcode: r.barcode || text }); }
    } catch (e) { setStatus('err'); setSheet({ kind: 'error', code: 'ERR', message: e.message, barcode: text }); }
    setTimeout(() => setStatus(''), 700);
    if (!sheet || true) timer.current = setTimeout(() => setSheet((x) => (x && x.kind === 'error' ? x : null)), 3500);
    busy.current = false;
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  // Thẻ vừa quét luôn phản ánh số lượng hiện tại trong giỏ.
  const live = sheet && sheet.kind === 'ok' ? (() => {
    const it = cart.items.find((x) => x.sku === sheet.item.sku);
    return { ...sheet, qty: it?.qty ?? 0, count: cart.itemCount, total: cart.total,
      inc: (i) => { clearTimeout(timer.current); setQty(i.id, (it?.qty || 0) + 1).then((r) => r.ok === false && toast(r.message)); },
      dec: (i) => { clearTimeout(timer.current); setQty(i.id, Math.max(0, (it?.qty || 1) - 1)); if ((it?.qty || 1) <= 1) setSheet(null); } };
  })() : sheet;

  return html`<div style="position:fixed;inset:0;background:#0d1418;display:flex;flex-direction:column">
    <${Scanner} fill kind="barcode" status=${status} onScan=${onScanText} onState=${(st) => st === 'denied' && onBlocked()} hint=${!sheet && 'Đưa mã vạch vào khung'}/>
    <div style="position:relative;z-index:2;display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px">
      <button class="iconbtn" style="background:rgba(255,255,255,.18);color:#fff" onClick=${() => go('/cart')} aria-label="Đóng"><${Icon} name="x"/></button>
      <div class="row" style="background:rgba(255,255,255,.18);color:#fff;border-radius:999px;padding:8px 14px;font-weight:600;font-size:14px;min-width:0;flex:1;backdrop-filter:blur(6px)"><span class="dot" style=${`color:${online ? '#4BE08D' : '#FFB020'}`}></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${store.name}${online ? '' : ' · mất mạng'}</span></div>
    </div>
    <div style="flex:1"></div>
    <div style="position:relative;z-index:2;padding:0 12px calc(12px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:10px">
      <div class="row" style="justify-content:center">
        <button class="btn auto sm" style="background:rgba(255,255,255,.18);color:#fff;backdrop-filter:blur(6px)" onClick=${() => go('/manual')}><${Icon} name="kbd" size=${16}/>Nhập mã</button>
        <button class="btn auto sm" style="background:rgba(255,255,255,.18);color:#fff;backdrop-filter:blur(6px)" onClick=${() => setHelp(true)}><${Icon} name="info" size=${16}/>Cần giúp</button>
      </div>
      <button class="row" style="background:#fff;color:#1F2430;border:0;border-radius:20px;padding:10px 10px 10px 16px;text-align:left" onClick=${() => go('/cart')}>
        <${Icon} name="bag"/><div class="grow"><b class="num" style="font-size:17px;display:block">${fmt.money(cart.total)}</b><span class="xs" style="color:#6B7280">${cart.itemCount} mặt hàng trong giỏ${cart.pendingCount ? ` · ${cart.pendingCount} chờ đồng bộ` : ''}</span></div>
        <span class="btn primary sm auto">Xem giỏ <${Icon} name="chev" size=${16}/></span></button>
    </div>
    ${live && html`<${ScanSheet} result=${live} onClose=${() => { setSheet(null); }} onManual=${() => go('/manual')} onHelp=${() => setHelp(true)}/>`}
    ${help && html`<${Help} onClose=${() => setHelp(false)}/>`}
  </div>`;
}

export function Manual({ s, store }) {
  const [code, setCode] = useState('');
  const [found, setFound] = useState(null); // {found, product, invalid}
  const [busy, setBusy] = useState(false);
  const cart = cartView(s);
  useEffect(() => {
    setFound(null);
    if (code.length < 8) return;
    let off = false;
    const t = setTimeout(async () => {
      try { const r = await api.get(`/products/lookup?storeId=${store.id}&barcode=${code}`); if (!off) setFound(r); } catch { if (!off) setFound({ error: true }); }
    }, 250);
    return () => { off = true; clearTimeout(t); };
  }, [code]);
  const key = (k) => setCode((c) => (k === '⌫' ? c.slice(0, -1) : c.length < 14 ? c + k : c));
  const grouped = code.replace(/(\d{4})(?=\d)/g, '$1 ');
  async function add() {
    setBusy(true);
    try {
      const r = await scan(code);
      if (r.pending) { toast('Đã lưu trên máy, sẽ cập nhật khi có mạng', 'ok'); setCode(''); }
      else if (r.ok) { toast(`Đã thêm ${r.item.name}`, 'ok'); setCode(''); }
      else toast(r.message || 'Không thêm được sản phẩm', 'err');
    } finally { setBusy(false); }
  }
  const p = found?.product;
  return html`<div style="display:flex;flex-direction:column;flex:1">
    <${Header} onBack=${() => history.length > 1 ? history.back() : go('/scan')} title="Nhập mã vạch"/>
    <div class="page" style="gap:14px">
      <p class="muted">Nhập dãy số in dưới mã vạch (thường 8 hoặc 13 chữ số).</p>
      <div class="field"><label>Mã vạch</label><div class="input big" style="display:flex;align-items:center;letter-spacing:.04em" aria-live="polite">${grouped || html`<span class="muted" style="font-weight:500;font-size:18px">Gõ mã vạch</span>`}</div></div>
      ${found?.invalid && html`<div class="errtext">Mã này không hợp lệ, hãy kiểm tra lại các chữ số.</div>`}
      ${found && found.found === false && !found.invalid && html`<div class="errtext">Sản phẩm chưa có trong hệ thống của chi nhánh.</div>`}
      ${p && html`<div class="card flat tight row"><div class="tile" style=${`--h:${fmt.tone(p.name.length * 7)}`}>${p.name.slice(0, 1)}</div>
        <div class="grow"><b>${p.name}</b><div class="small muted">${fmt.money(p.price)}${p.promo ? ` · ${p.promo}` : ''}${!p.active ? ' · ngừng bán' : !p.inStock ? ' · hết hàng' : ''}</div></div>
        ${p.active && p.inStock ? html`<${Icon} name="check" class="" />` : html`<${Pill} tone="err">Không bán được<//>`}</div>`}
      <${Keypad} onKey=${key}/>
    </div>
    <div class="bar-bottom"><div class="in">
      <button class="btn primary" disabled=${busy || !(p && p.active && p.inStock)} onClick=${add}>${busy ? html`<${Spinner} sm/>` : 'Thêm vào giỏ'}</button>
      <button class="btn txt" onClick=${() => go('/cart')}>Xong, xem giỏ (${cart.itemCount} mặt hàng)</button>
    </div></div></div>`;
}

/** Đơn giá một mặt hàng: giá gốc gạch ngang kèm giá khuyến mại (khi API giá báo), hoặc "chưa có giá". */
const unitText = (it) => (it.noPrice ? html`<span>Chưa có giá, thu ngân sẽ tính</span>`
  : it.listPrice ? html`<s style="opacity:.7">${fmt.money(it.listPrice)}</s> <b style="color:var(--ok)">${fmt.money(it.price)}</b> <${Pill} tone="ok">Khuyến mại<//>${it.promo ? ` · ${it.promo}` : ''}`
  : html`${fmt.money(it.price)}${it.promo ? ` · ${it.promo}` : ''}`);

const REASONS = { price: 'Giá thay đổi', stock: 'Số lượng còn lại thay đổi', inactive: 'Ngừng bán', promo: 'Khuyến mãi thay đổi' };
export function ChangesSheet({ changes, onAccept, onBack, busy }) {
  return html`<${Sheet} onClose=${onBack}>
    <div class="row"><div class="ico-tile warn"><${Icon} name="alert"/></div><div class="grow"><b style="font-size:17px">Có thay đổi trong giỏ hàng</b><div class="small muted">Cập nhật mới nhất từ cửa hàng</div></div></div>
    <div class="card flat stack">${changes.map((c) => html`<div class="row"><div class="grow"><b>${c.name}</b><div class="small muted">${REASONS[c.type]}</div></div>
      <div style="text-align:right" class="num">${c.type === 'price' ? html`<s class="muted small">${fmt.money(c.old)}</s><br/><b>${fmt.money(c.new)}</b>` : c.type === 'stock' ? html`<${Pill} tone="warn">${c.old} → ${c.new}<//>` : c.type === 'inactive' ? html`<${Pill} tone="err">Bỏ khỏi giỏ<//>` : html`<${Pill} tone="warn">Cập nhật<//>`}</div></div>`)}</div>
    <button class="btn primary" disabled=${busy} onClick=${onAccept}>${busy ? html`<${Spinner} sm/>` : 'Đồng ý và tiếp tục'}</button>
    <button class="btn txt" onClick=${onBack}>Quay lại giỏ hàng</button><//>`;
}

export function Cart({ s, store }) {
  const cart = cartView(s);
  const online = useOnline();
  const [confirm, setConfirm] = useState(null); // item cần xóa
  const [busy, setBusy] = useState(false);
  const empty = !cart.items.length && !cart.pendingCount;
  const canPay = (store.basket ? cart.items.length + cart.pendingCount > 0 : online && cart.items.length > 0 && !s.syncing);

  async function change(it, qty) {
    const r = await setQty(it.id, qty);
    if (r.ok === false) toast(r.message || 'Không đổi được số lượng', 'err');
  }
  return html`<div style="display:flex;flex-direction:column;flex:1">
    <${Header} onBack=${() => go('/scan')} title="Giỏ hàng" sub=${`${cart.itemCount + cart.pendingCount} mặt hàng`}
      right=${s.syncing ? html`<${Spinner} sm/>` : s.queue.length ? html`<${Pill} tone="warn">Chờ đồng bộ<//>` : html`<${Pill} tone="ok"><span class="dot"></span>Đã đồng bộ<//>`}/>
    <div class="page pad-b">
      ${!online && html`<${Banner} icon="wifioff" title="Mất kết nối">Giỏ hàng đã được lưu trên máy. Bạn vẫn quét tiếp được. Hệ thống tự đồng bộ khi có mạng.<//>`}
      ${s.issues.map((i) => html`<${Banner} tone="err" icon="alert" title=${i.code === 'NOT_FOUND' ? 'Có sản phẩm không có trong hệ thống' : 'Không thêm được một sản phẩm'}>
        <span class="num">Mã ${i.barcode}</span>${i.name ? ` · ${i.name}` : ''}. ${i.message}.<br/><button class="btn sm line" style="margin-top:8px" onClick=${() => dismissIssue(i.id)}>Đã biết</button><//>`)}
      ${cart.items.some((x) => x.noPrice) && html`<${Banner} tone="warn" icon="alert" title=${`${cart.items.filter((x) => x.noPrice).length} mặt hàng chưa tra được giá`}>Hệ thống giá đang bận hoặc chưa có giá của mặt hàng này. Bạn vẫn thanh toán bình thường, thu ngân tính đủ tại quầy.<//>`}
      ${cart.ageRestricted && html`<${Banner} icon="info" title="Có sản phẩm giới hạn độ tuổi">Nhân viên sẽ kiểm tra giấy tờ khi bạn thanh toán.<//>`}
      ${empty ? html`<${Empty} icon="bag" title="Giỏ hàng đang trống" text="Quét mã vạch của sản phẩm đầu tiên để bắt đầu."><button class="btn primary auto" style="margin-top:8px;padding:0 28px" onClick=${() => go('/scan')}><${Icon} name="camera"/>Mở camera quét</button><//>` : html`
        <div class="card" style="padding:8px 16px"><div class="list">
          ${cart.items.map((it) => html`<div class="item" key=${it.id} style="align-items:flex-start">
            <div class="tile" style=${`--h:${fmt.tone(it.sku.length * 13)}`}>${it.name.slice(0, 1)}</div>
            <div class="grow stack" style="gap:8px">
              <div class="row" style="align-items:flex-start"><div class="grow name">${it.name}</div>${it.noPrice ? html`<${Pill} tone="warn">Chưa có giá<//>` : html`<div class="b num">${fmt.money(it.lineTotal)}</div>`}</div>
              <div class="row"><div class="grow small muted num">${unitText(it)}</div>
                <div class="stepper"><button onClick=${() => (it.qty <= 1 ? setConfirm(it) : change(it, it.qty - 1))} aria-label=${`Giảm ${it.name}`}><${Icon} name=${it.qty <= 1 ? 'trash' : 'minus'} size=${16}/></button><span class="num">${it.qty}</span><button onClick=${() => change(it, it.qty + 1)} aria-label=${`Tăng ${it.name}`}><${Icon} name="plus" size=${16}/></button></div></div></div></div>`)}
          ${cart.pending.map((p) => html`<div class="item"><div class="tile" style="--h:40"><${Icon} name="clock" size=${18}/></div><div class="grow"><div class="name num">Mã ${p.barcode}</div><div class="small muted">Chờ đồng bộ để lấy tên và giá</div></div><${Pill} tone="warn">× ${p.qty}<//></div>`)}
        </div></div>
        <div class="card flat"><div class="sum num">
          <div><span class="muted">Tạm tính${cart.pendingCount ? ' (chưa gồm mặt hàng chờ đồng bộ)' : ''}</span><span>${fmt.money(cart.subtotal)}</span></div>
          ${cart.discount > 0 && html`<div><span class="muted">Khuyến mãi</span><span style="color:var(--ok)">−${fmt.money(cart.discount)}</span></div>`}
          <div class="tot"><span>Tổng cộng</span><span>${fmt.money(cart.total)}</span></div></div></div>`}
    </div>
    ${!empty && html`<div class="bar-bottom"><div class="in" style="flex-direction:row">
      <button class="btn line" style="width:auto;padding:0 20px" onClick=${() => go('/scan')}>Quét thêm</button>
      <button class="btn primary" disabled=${!canPay} onClick=${() => { if (store.basket) { try { makeBasket(); go('/basket'); } catch (e) { toast(e.message, 'err'); } } else go('/pay'); }}>${store.basket || online ? `Thanh toán ${fmt.money(cart.total)}` : 'Cần có mạng để thanh toán'}</button></div></div>`}
    ${confirm && html`<${Confirm} title="Bỏ sản phẩm này?" text=${confirm.name} ok="Bỏ khỏi giỏ" danger busy=${busy} onCancel=${() => setConfirm(null)}
      onOk=${async () => { setBusy(true); try { await removeItem(confirm.id); } finally { setBusy(false); setConfirm(null); } }}/>`}
  </div>`;
}
