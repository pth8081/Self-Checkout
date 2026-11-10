// Màn hình vào cửa hàng: M01 chào, M02 hướng dẫn, M03 xin quyền camera, M04 camera bị chặn,
// M05 chi nhánh chưa bật, M06 mở trong app khác, M07 giỏ đang dở.
import { html, useState, useEffect, Header, Icon, Logo, Banner, Pill, Spinner, Loading, ErrorBox, go, fmt, useAsync, Sheet, toast } from '/shared/lib.js';
import { api, openSession, resetSession, loadStore, setState, local } from './store.js';

export const isWebview = () => /(Zalo|FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Messenger|TikTok|Snapchat)/i.test(navigator.userAgent);

// Nút "Thêm vào màn hình chính" khi trình duyệt cho phép.
let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });

export function Welcome({ store, onStart, busy, error }) {
  const [canInstall, setCanInstall] = useState(!!installEvt);
  useEffect(() => { const f = () => setCanInstall(true); addEventListener('beforeinstallprompt', f); return () => removeEventListener('beforeinstallprompt', f); }, []);
  return html`<div style="display:flex;flex-direction:column;flex:1">
    <${Header}/>
    <div class="page pad-b">
      <div class="stack-lg" style="margin-top:8px">
        <h1 style="font-size:30px">Mua sắm không phải xếp hàng</h1>
        <p class="muted">${store.basket ? 'Quét mã từng mặt hàng, bấm thanh toán để hiện mã QR, đưa thu ngân quét vào máy tính tiền. Không phải đứng chờ quét từng mặt hàng.' : html`Quét mã từng mặt hàng, ${store.payment?.pos ? 'thanh toán tại quầy' : 'chọn cách thanh toán'} rồi ${store.guardCheck === false ? 'ra về' : 'ra cổng bằng mã QR'}. Không cần cài ứng dụng.`}</p>
      </div>
      <div class="card">
        <div class="row"><div class="ico-tile"><${Icon} name="store"/></div>
          <div class="grow"><div class="b" style="font-size:17px">${store.name}</div><div class="small muted">${store.address || ''}</div></div></div>
        <${Pill} tone="ok"><span class="dot"></span>Scan & Checkout đang hoạt động<//>
      </div>
      ${store.basket && !store.pointCode && html`<${Banner} tone="warn" icon="alert" title="Cửa hàng chưa sẵn sàng">Cửa hàng chưa được gán Mã điểm nên chưa thanh toán được. Hãy báo nhân viên.<//>`}
      ${error && html`<${ErrorBox} error=${error}/>`}
      <div class="stack" style="margin-top:4px">
        ${[['scan', 'Quét mã vạch từng mặt hàng bằng camera'], ['cash', store.basket ? 'Thu ngân quét một mã QR là có đủ mặt hàng, không quét từng mặt hàng' : store.payment?.pos ? 'Thanh toán tại quầy, thu ngân quét mã giỏ hàng' : 'Trả tiền mặt hoặc chuyển khoản tại quầy'], ['qr', store.basket ? 'Mã QR lưu trên điện thoại, mất mạng vẫn dùng được' : store.guardCheck === false ? 'Thanh toán xong là ra về' : 'Nhận mã QR để ra cổng']].map(([ic, t]) => html`
          <div class="row"><div class="ico-tile" style="width:40px;height:40px;border-radius:14px"><${Icon} name=${ic}/></div><div>${t}</div></div>`)}
      </div>
      <div class="row wrap" style="justify-content:center;gap:4px">
        <button class="btn txt auto" onClick=${() => go('/history')}><${Icon} name="receipt"/>Lịch sử mua sắm</button>
        ${canInstall && html`<button class="btn txt auto" onClick=${async () => { installEvt?.prompt(); installEvt = null; setCanInstall(false); }}><${Icon} name="download"/>Thêm vào màn hình chính</button>`}
      </div>
    </div>
    <div class="bar-bottom"><div class="in">
      <button class="btn primary" disabled=${busy} onClick=${onStart}>${busy ? html`<${Spinner} sm/>` : 'Bắt đầu mua sắm'}</button>
      <div class="xs muted center">Tiếp tục nghĩa là bạn đồng ý để chúng tôi lưu giỏ hàng và lịch sử mua trên thiết bị này. Ứng dụng không chụp hay lưu ảnh từ camera.</div>
    </div></div>
  </div>`;
}

const STEPS = [
  { icon: 'barcode', title: 'Quét mã vạch từng mặt hàng', text: 'Đưa mã vạch trên sản phẩm vào khung camera. Mặt hàng được thêm vào giỏ ngay.' },
  { icon: 'bag', title: 'Kiểm tra giỏ hàng', text: 'Xem lại mặt hàng, số lượng và tổng tiền. Sửa hoặc bỏ mặt hàng trước khi thanh toán.' },
  { icon: 'qr', title: 'Thanh toán và ra cổng', text: 'Trả tiền tại quầy, rồi ra về theo hướng dẫn trên màn hình (có thể là mã QR đưa nhân viên ở cổng).' }
];
export function Guide({ onDone }) {
  const [i, setI] = useState(0);
  const s = STEPS[i], last = i === STEPS.length - 1;
  return html`<div style="display:flex;flex-direction:column;flex:1">
    <header class="hdr"><div class="brand"><${Logo}/><span>BRG Scan & Checkout</span></div><button class="btn txt auto" onClick=${onDone}>Bỏ qua</button></header>
    <div class="page" style="align-items:center;justify-content:center;text-align:center;gap:20px">
      <div class="ico-tile lg" style="width:160px;height:160px;border-radius:48px"><${Icon} name=${s.icon} size=${72}/></div>
      <h1>${s.title}</h1><p class="muted" style="max-width:34ch">${s.text}</p>
      <div class="row" style="justify-content:center;gap:6px" aria-label=${`Bước ${i + 1} trên ${STEPS.length}`}>${STEPS.map((_, k) => html`<span style=${`height:8px;border-radius:4px;background:${k === i ? 'var(--orange)' : 'var(--line)'};width:${k === i ? 24 : 8}px;transition:width .2s`}></span>`)}</div>
    </div>
    <div class="bar-bottom"><div class="in"><button class="btn primary" onClick=${() => (last ? onDone() : setI(i + 1))}>${last ? 'Bắt đầu quét' : 'Tiếp tục'}</button></div></div>
  </div>`;
}

export function CameraPermission({ onAllow, onManual }) {
  return html`<div style="display:flex;flex-direction:column;flex:1">
    <${Header} onBack=${() => go('/')} title="Quyền camera"/>
    <div class="page" style="align-items:center;text-align:center;gap:20px;justify-content:center">
      <div class="ico-tile lg"><${Icon} name="camera"/></div>
      <h1>Cho phép dùng camera</h1>
      <p class="muted" style="max-width:34ch">Camera chỉ dùng để đọc mã vạch trên sản phẩm. Ứng dụng không chụp và không lưu ảnh hay video.</p>
      <div class="card flat tight row" style="text-align:left"><${Icon} name="shield" class="" /><span class="small">Hình ảnh được xử lý ngay trên máy của bạn.</span></div>
    </div>
    <div class="bar-bottom"><div class="in"><button class="btn primary" onClick=${onAllow}>Cho phép camera</button><button class="btn txt" onClick=${onManual}>Nhập mã bằng tay</button></div></div>
  </div>`;
}

export function CameraBlocked({ onRetry, onManual }) {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const steps = ios
    ? ['Chạm biểu tượng aA ở thanh địa chỉ Safari.', 'Chọn Cài đặt trang web, rồi Camera.', 'Chọn Cho phép và tải lại trang.']
    : ['Chạm biểu tượng khóa cạnh thanh địa chỉ.', 'Chọn Quyền, rồi Camera.', 'Chọn Cho phép và tải lại trang.'];
  return html`<div style="display:flex;flex-direction:column;flex:1">
    <${Header} onBack=${() => go('/cart')} title="Camera đang bị chặn"/>
    <div class="page">
      <div class="ico-tile warn lg" style="width:72px;height:72px;border-radius:24px"><${Icon} name="camera"/></div>
      <h1>Camera đang bị chặn</h1>
      <p class="muted">Bật lại quyền camera cho trang này để tiếp tục quét.</p>
      <ol class="stack" style="padding:0;list-style:none;gap:14px;margin:8px 0">${steps.map((t, i) => html`<li class="row" style="align-items:flex-start"><span class="avatar" style="width:30px;height:30px;font-size:14px">${i + 1}</span><span>${t}</span></li>`)}</ol>
    </div>
    <div class="bar-bottom"><div class="in"><button class="btn primary" onClick=${onRetry}>Tôi đã bật, thử lại</button><button class="btn" onClick=${onManual}>Nhập mã bằng tay</button></div></div>
  </div>`;
}

export function StoreDisabled({ store }) {
  return html`<div style="display:flex;flex-direction:column;flex:1"><${Header}/>
    <div class="page" style="align-items:center;text-align:center;justify-content:center;gap:20px">
      <div class="ico-tile warn lg"><${Icon} name="store"/></div>
      <h1>Chi nhánh này chưa có Scan & Checkout</h1>
      <p class="muted" style="max-width:36ch">${store?.name ? `${store.name} chưa bật tính năng này.` : 'Chi nhánh chưa bật tính năng này.'} Bạn vẫn mua sắm bình thường và thanh toán tại quầy.</p>
    </div>
    <div class="bar-bottom"><div class="in"><button class="btn primary" onClick=${() => go('/stores')}>Xem chi nhánh đang hỗ trợ</button></div></div></div>`;
}

export function Stores() {
  const { data, error, loading, reload } = useAsync(() => api.get('/stores'), []);
  return html`<div style="display:flex;flex-direction:column;flex:1"><${Header} onBack=${() => go('/')} title="Chọn chi nhánh"/>
    <div class="page">
      ${loading && html`<${Loading}/>`}${error && html`<${ErrorBox} error=${error} retry=${reload}/>`}
      ${data && html`<p class="muted">Quét mã QR dán ở cổng vào để vào đúng chi nhánh. Hoặc chọn chi nhánh bên dưới.</p>
      <div class="stack">${data.stores.map((s) => html`
        <button class=${`option ${s.enabled ? '' : 'off'}`} disabled=${!s.enabled} onClick=${() => { local.set('brg.pending-store', s.id); location.href = `/c/?s=${s.id}`; }}>
          <div class="ico-tile"><${Icon} name="store"/></div>
          <div class="grow"><div class="b">${s.name}</div><div class="small muted">${s.address || ''}</div></div>
          ${s.enabled ? html`<${Icon} name="chev"/>` : html`<${Pill}>Sắp có<//>`}
        </button>`)}</div>`}
    </div></div>`;
}

export function WebviewNotice({ onContinue }) {
  const link = location.href;
  return html`<div style="display:flex;flex-direction:column;flex:1"><${Header}/>
    <div class="page">
      <div class="ico-tile warn lg" style="width:72px;height:72px;border-radius:24px"><${Icon} name="globe"/></div>
      <h1>Mở bằng trình duyệt để quét mã</h1>
      <p class="muted">Trình duyệt trong Zalo hoặc Facebook không cho dùng camera ổn định.</p>
      <ol class="stack" style="padding:0;list-style:none;gap:14px">
        <li class="row" style="align-items:flex-start"><span class="avatar" style="width:30px;height:30px;font-size:14px">1</span><span>Chạm nút <b>⋯</b> ở góc màn hình.</span></li>
        <li class="row" style="align-items:flex-start"><span class="avatar" style="width:30px;height:30px;font-size:14px">2</span><span>Chọn <b>Mở bằng trình duyệt</b> (Safari hoặc Chrome).</span></li>
      </ol>
    </div>
    <div class="bar-bottom"><div class="in">
      <button class="btn primary" onClick=${async () => { try { await navigator.clipboard.writeText(link); toast('Đã sao chép liên kết', 'ok'); } catch { toast('Hãy chọn và sao chép liên kết trên thanh địa chỉ'); } }}><${Icon} name="copy"/>Sao chép liên kết</button>
      <button class="btn txt" onClick=${onContinue}>Vẫn tiếp tục ở đây</button>
    </div></div></div>`;
}

export function Resume({ session, store, onContinue, onFresh, busy }) {
  const items = session.items.reduce((a, i) => a + i.qty, 0);
  const locked = session.status === 'locked';
  return html`<div style="display:flex;flex-direction:column;flex:1"><${Header}/>
    <div class="page" style="align-items:center;text-align:center;justify-content:center;gap:20px">
      <div class="ico-tile lg"><${Icon} name="bag"/></div>
      <h1>Bạn có giỏ hàng đang dở</h1>
      <p class="muted">${items} mặt hàng · ${fmt.money(session.total)}<br/>Bắt đầu lúc ${fmt.time(session.startedAt)} tại ${store.name}.</p>
      ${locked && html`<${Banner} tone="brand" icon="info">Giỏ này đã chuyển sang bước thanh toán.<//>`}
    </div>
    <div class="bar-bottom"><div class="in">
      <button class="btn primary" onClick=${onContinue}>Tiếp tục mua sắm</button>
      <button class="btn line" disabled=${busy} onClick=${onFresh}>Bắt đầu giỏ mới</button>
    </div></div></div>`;
}
