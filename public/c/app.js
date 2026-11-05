// PWA khách BRG Self Checkout: điều hướng, khởi động, chốt chặn theo trạng thái giao dịch.
import { html, render, useRoute, go, useEffect, useState, Toasts, OfflineBar, registerSW, Loading, ErrorBox, Header, toast } from '/shared/lib.js';
import { useStore, loadStore, setStoreCode, openSession, refreshSession, resetSession, getState, local, setState } from './store.js';
import { Welcome, Guide, CameraPermission, CameraBlocked, StoreDisabled, Stores, WebviewNotice, Resume, isWebview } from './screens-start.js';
import { Scan, Manual, Cart } from './screens-scan.js';
import { PayMethod, Transfer, Wait, Receipt, Done, Invoice, History, Order } from './screens-pay.js';

const FLOW = ['/scan', '/manual', '/cart', '/pay', '/transfer', '/wait'];

async function cameraGranted() {
  try { const r = await navigator.permissions?.query({ name: 'camera' }); return r?.state === 'granted'; } catch { return false; }
}

function App() {
  const s = useStore();
  const { path } = useRoute();
  const [boot, setBoot] = useState({ done: false, error: null });
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState(null);
  const tx = s.session?.transaction;

  // ---------- Khởi động ----------
  useEffect(() => {
    (async () => {
      try {
        const q = new URLSearchParams(location.search).get('s');
        if (q) { setStoreCode(q); history.replaceState(null, '', `/c/${location.hash}`); }
        const code = getState().storeCode;
        if (!code) { setBoot({ done: true }); if (!['/stores', '/history', '/order', '/invoice'].some((p) => location.hash.slice(1).startsWith(p))) go('/stores', true); return; }
        try { await loadStore(code); }
        catch (e) {
          if (e.code === 'STORE_NOT_FOUND') { setState({ storeCode: null, store: null, session: null, queue: [] }); setBoot({ done: true }); return go('/stores', true); }
          if (e.status !== 0 || !getState().store) throw e; // mất mạng nhưng đã có dữ liệu lưu: dùng tiếp
        }
        await refreshSession();
        const st = getState();
        const cur = st.session?.transaction;
        const seen = local.get('brg.c.seen', 0);
        const hasRoute = location.hash.length > 2;
        if (!st.store.enabled && !cur) go('/closed', true);
        else if (cur?.status === 'paid') go(cur.exitStatus === 'exited' ? '/done' : '/receipt', true);
        else if (cur?.status === 'awaiting_counter') go('/wait', true);
        else if (st.session?.items.length && st.session.status === 'active' && Date.now() - seen > 10 * 60_000) go('/resume', true);
        else if (!hasRoute) go('/', true);
        setBoot({ done: true });
      } catch (e) { setBoot({ done: true, error: e }); }
    })();
    const t = setInterval(() => local.set('brg.c.seen', Date.now()), 15000);
    local.set('brg.c.seen', Date.now());
    return () => clearInterval(t);
  }, []);

  // ---------- Chốt chặn điều hướng theo trạng thái ----------
  useEffect(() => {
    if (!boot.done) return;
    const inFlow = FLOW.includes(path);
    if (tx?.status === 'paid' && inFlow) go('/receipt', true);
    else if (tx?.status === 'awaiting_counter' && inFlow && !['/wait', '/transfer'].includes(path)) go(tx.method === 'qr_transfer' && path === '/pay' ? '/transfer' : '/wait', true);
    else if ((!tx || tx.status === 'voided') && ['/wait', '/transfer'].includes(path)) go(s.session ? '/cart' : '/', true);
    else if (tx?.status === 'paid' && path === '/receipt' && tx.exitStatus === 'exited') go('/done', true);
    else if (!s.session && (inFlow || path === '/receipt' || path === '/done') && !(path === '/receipt' && s.receipt)) go('/', true);
  }, [boot.done, path, tx?.status, tx?.exitStatus, !!s.session]);

  if (!boot.done) return html`<div class="page"><${Loading}/></div>`;
  if (boot.error) return html`<div class="page" style="justify-content:center"><${ErrorBox} error=${boot.error} retry=${() => location.reload()}/></div>`;

  const store = s.store;
  const needStore = (el) => (store ? el : html`<div class="page"><${Loading}/></div>`);

  async function start() {
    setBusy(true); setStartError(null);
    try {
      if (isWebview() && !local.get('brg.webview-ok')) { go('/browser'); return; }
      const r = await openSession();
      if (r.session.transaction?.status === 'awaiting_counter') return go('/wait');
      if (r.resumed) return go('/resume');
      await next();
    } catch (e) {
      if (e.code === 'STORE_DISABLED') go('/closed'); else setStartError(e);
    } finally { setBusy(false); }
  }
  async function next() {
    if (!local.get('brg.guided')) return go('/guide');
    go((await cameraGranted()) ? '/scan' : '/camera');
  }

  switch (true) {
    case path === '/stores': return html`<${Stores}/><${Toasts}/>`;
    case path === '/history': return html`<${History}/><${Toasts}/>`;
    case path.startsWith('/order/'): return html`<${Order} id=${path.slice(7)}/><${Toasts}/>`;
    case path.startsWith('/invoice/'): return html`<${Invoice} id=${path.slice(9)}/><${Toasts}/>`;
    case path === '/closed': return html`<${StoreDisabled} store=${store}/>`;
    case path === '/browser': return html`<${WebviewNotice} onContinue=${() => { local.set('brg.webview-ok', true); go('/'); }}/><${Toasts}/>`;
    case path === '/guide': return html`<${Guide} onDone=${async () => { local.set('brg.guided', true); go((await cameraGranted()) ? '/scan' : '/camera', true); }}/>`;
    case path === '/camera': return html`<${CameraPermission} onAllow=${() => go('/scan', true)} onManual=${() => go('/manual')}/>`;
    case path === '/blocked': return html`<${CameraBlocked} onRetry=${() => go('/scan', true)} onManual=${() => go('/manual')}/><${Toasts}/>`;
    case path === '/resume' && !!s.session && !!store:
      return html`<${Resume} session=${s.session} store=${store} busy=${busy}
        onContinue=${() => go(s.session.status === 'locked' ? '/wait' : '/scan', true)}
        onFresh=${async () => { setBusy(true); try { await openSession({ fresh: true }); await next(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } }}/><${Toasts}/>`;
    case path === '/scan' && !!s.session && !!store: return html`<${Scan} s=${s} store=${store} onBlocked=${() => go('/blocked', true)}/><${Toasts}/>`;
    case path === '/manual' && !!s.session && !!store: return html`<${Manual} s=${s} store=${store}/><${Toasts}/>`;
    case path === '/cart' && !!s.session && !!store: return html`<${OfflineBar}/><${Cart} s=${s} store=${store}/><${Toasts}/>`;
    case path === '/pay' && !!s.session && !!store: return html`<${OfflineBar}/><${PayMethod} s=${s} store=${store}/><${Toasts}/>`;
    case path === '/transfer' && !!s.session: return html`<${OfflineBar}/><${Transfer} s=${s}/><${Toasts}/>`;
    case path === '/wait' && !!s.session: return html`<${OfflineBar}/><${Wait} s=${s}/><${Toasts}/>`;
    case path === '/receipt': return html`<${OfflineBar}/><${Receipt} s=${s} store=${store} onDone=${() => go('/done', true)}/><${Toasts}/>`;
    case path === '/done': return html`<${Done} s=${s} onClose=${() => { resetSession(); go('/', true); }}/><${Toasts}/>`;
    case path === '/' && !store: return html`<${Stores}/>`;
    default:
      return needStore(html`<${Welcome} store=${store} busy=${busy} error=${startError} onStart=${start}/><${Toasts}/>`);
  }
}

render(html`<${App}/>`, document.getElementById('app'));
registerSW('/c/sw.js', '/c/');
