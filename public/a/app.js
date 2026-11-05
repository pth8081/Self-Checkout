// Web quản trị BRG Scan & Checkout (chuỗi + chi nhánh).
import { html, render, useState, useEffect, useMemo, useCallback, useRoute, go, toast, Toasts, Header, Drawer, Icon, Logo, Spinner, OfflineBar, Field, registerSW, ErrorBox } from '/shared/lib.js';
import { api, S, store, ROLE_VI } from '/a/common.js';
import { Overview, Stores, Integrations, Reports, Users, Audit } from '/a/pages-chain.js';
import { GuideList, GuideDoc } from '/a/guides.js';
import { Today, Transactions, TxDetail, PosOrders, Plans, RandomCheck, Reconcile, Unknown } from '/a/pages-store.js';

const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/a/admin.css'; document.head.appendChild(link);

const TOKEN_KEY = 'brg_a_token', STORE_KEY = 'brg_a_store';

const PAGE_TITLES = {
  overview: 'Tổng quan chuỗi', stores: 'Chi nhánh & tính năng', integrations: 'Tích hợp', reports: 'Báo cáo', users: 'Tài khoản & phân quyền', audit: 'Nhật ký',
  today: 'Hôm nay', transactions: 'Giao dịch', 'pos-orders': 'Đơn POS', plans: 'Nhân viên & ca', 'random-check': 'Kiểm tra ngẫu nhiên', reconcile: 'Đối soát', 'unknown-barcodes': 'Mã không tìm thấy',
  'huong-dan': 'Hướng dẫn nghiệp vụ', 'huong-dan-he-thong': 'Hướng dẫn hệ thống'
};
const CHAIN_ONLY = ['overview', 'integrations'];

function navItems(me, storeName) {
  const chain = me.role === 'chain_admin';
  const guides = [{ group: 'Hướng dẫn' }, { id: 'huong-dan', label: 'Hướng dẫn nghiệp vụ', icon: 'docok' }, { id: 'huong-dan-he-thong', label: 'Hướng dẫn hệ thống', icon: 'settings' }];
  const branch = [
    { id: 'today', label: 'Hôm nay', icon: 'home' }, { id: 'transactions', label: 'Giao dịch', icon: 'receipt' }, { id: 'pos-orders', label: 'Đơn POS', icon: 'card' },
    { id: 'plans', label: 'Nhân viên & ca', icon: 'calendar' }, { id: 'random-check', label: 'Kiểm tra ngẫu nhiên', icon: 'shield' },
    { id: 'reconcile', label: 'Đối soát', icon: 'cash' }, { id: 'unknown-barcodes', label: 'Mã không tìm thấy', icon: 'barcode' }
  ];
  if (chain) return [
    { id: 'overview', label: 'Tổng quan', icon: 'chart' }, { id: 'stores', label: 'Chi nhánh', icon: 'store' }, { id: 'integrations', label: 'Tích hợp', icon: 'link' },
    { id: 'reports', label: 'Báo cáo', icon: 'doc' }, { id: 'users', label: 'Tài khoản & phân quyền', icon: 'users' }, { id: 'audit', label: 'Nhật ký', icon: 'list' },
    { group: `Chi nhánh đang xem${storeName ? `: ${storeName}` : ''}` }, ...branch, ...guides
  ];
  return [
    { group: storeName || 'Chi nhánh' }, ...branch,
    { group: 'Quản lý' }, { id: 'stores', label: 'Cấu hình chi nhánh', icon: 'store' }, { id: 'reports', label: 'Báo cáo', icon: 'doc' }, { id: 'users', label: 'Tài khoản', icon: 'users' }, { id: 'audit', label: 'Nhật ký', icon: 'list' }, ...guides
  ];
}

// ============================== A12 Đăng nhập ==============================
function Login({ onLogin, notice }) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr('');
    if (!account.trim() || !password) return setErr('Nhập tài khoản và mật khẩu');
    if (needTotp && !/^\d{6}$/.test(totp)) return setErr('Mã xác thực gồm 6 chữ số');
    setBusy(true);
    try {
      const r = await api.post('/login', { account: account.trim(), password, totp: needTotp ? totp : undefined });
      await onLogin(r.token);
    } catch (x) {
      if (x.code === 'TOTP_REQUIRED') { setNeedTotp(true); setErr(''); }
      else if (x.code === 'BAD_TOTP') { setErr(x.message); setTotp(''); }
      else if (x.code === 'LOCKED') setErr(x.message || 'Tài khoản bị khoá tạm vì nhập sai nhiều lần. Hãy thử lại sau ít phút.');
      else if (x.code === 'BAD_LOGIN') { setErr(x.message || 'Tài khoản hoặc mật khẩu chưa đúng'); setNeedTotp(false); }
      else setErr(x.message);
    } finally { setBusy(false); }
  };
  return html`<div class="login"><form class="card" onSubmit=${submit} noValidate>
    <div class="row"><${Logo} size=${44}/><div><h1 style="font-size:22px">Quản trị BRG</h1><div class="small muted">Scan & Checkout · chuỗi và chi nhánh</div></div></div>
    ${notice && html`<div class="banner" role="status">${notice}</div>`}
    <${Field} label="Tài khoản hoặc email"><input class="input" name="username" autocomplete="username" autocapitalize="off" value=${account} onInput=${(e) => setAccount(e.target.value)} aria-label="Tài khoản hoặc email" autofocus disabled=${needTotp}/><//>
    <${Field} label="Mật khẩu"><input class="input" type="password" name="password" autocomplete="current-password" value=${password} onInput=${(e) => setPassword(e.target.value)} aria-label="Mật khẩu" disabled=${needTotp}/><//>
    ${needTotp && html`<${Field} label="Mã xác thực 6 số" hint="Mở app xác thực (Google Authenticator, Authy…) và nhập mã hiện tại"><input class="input big" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value=${totp} onInput=${(e) => setTotp(e.target.value.replace(/\D/g, ''))} aria-label="Mã xác thực 6 số" autofocus/><//>`}
    ${err && html`<div class="banner err" role="alert"><${Icon} name="alert"/><div class="grow">${err}</div></div>`}
    <button class="btn primary" type="submit" disabled=${busy}>${busy ? html`<${Spinner} sm/>` : needTotp ? 'Xác nhận' : 'Đăng nhập'}</button>
    ${needTotp && html`<button class="btn txt" type="button" onClick=${() => { setNeedTotp(false); setTotp(''); setErr(''); }}>Quay lại</button>`}
    <div class="hint">Sai nhiều lần liên tiếp sẽ bị khoá tạm. Mọi lần đăng nhập đều được ghi lại.</div>
  </form></div>`;
}

// ============================== Khung ứng dụng ==============================
function Sidebar({ items, active, onSelect, me, onLogout }) {
  return html`<aside class="side" aria-label="Menu chính">
    <div class="brandrow"><${Logo}/><div>BRG Scan & Checkout<small>${ROLE_VI[me.role]}</small></div></div>
    ${items.map((it) => it.group ? html`<div class="label" key=${it.group}>${it.group}</div>`
      : html`<button key=${it.id} class=${`navitem ${active === it.id ? 'on' : ''}`} aria-current=${active === it.id ? 'page' : undefined} onClick=${() => onSelect(it.id)}><${Icon} name=${it.icon}/><span class="grow">${it.label}</span></button>`)}
    <div class="me"><div class="avatar">${(me.name || '?').slice(0, 1).toUpperCase()}</div><div class="grow"><div class="b">${me.name}</div><div class="small muted">${me.id}</div></div>
      <button class="iconbtn" onClick=${onLogout} aria-label="Đăng xuất"><${Icon} name="logout"/></button></div></aside>`;
}

function Shell({ session, setSession, reloadStores, logout }) {
  const { me, stores } = session;
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const [guideGroup, setGuideGroup] = useState(null);
  const chain = me.role === 'chain_admin';
  const [storeId, setStoreIdRaw] = useState(() => {
    if (!chain) return me.storeId;
    const saved = store.get(STORE_KEY);
    return stores.find((s) => s.id === saved)?.id || stores.find((s) => s.id === 'Q7')?.id || stores.find((s) => s.enabled)?.id || stores[0]?.id || '';
  });
  const setStoreId = useCallback((id) => { setStoreIdRaw(id); store.set(STORE_KEY, id); }, []);
  const seg = route.path.split('/').filter(Boolean);
  const page = seg[0] || '';
  const home = chain ? 'overview' : 'today';
  useEffect(() => { if (!page || (!chain && CHAIN_ONLY.includes(page)) || !PAGE_TITLES[page]) go(`/${home}`, true); }, [page, chain]);
  useEffect(() => { window.scrollTo?.(0, 0); }, [page, seg[1]]);
  const storeName = stores.find((s) => s.id === storeId)?.name;
  const items = useMemo(() => navItems(me, storeName), [me.role, storeName]);
  const ctx = { me, stores, storeId, setStoreId };
  const onSelect = (id) => go(`/${id}`);
  let view = null;
  switch (page) {
    case 'overview': view = chain && html`<${Overview} stores=${stores} setStoreId=${setStoreId}/>`; break;
    case 'stores': view = html`<${Stores} me=${me} reloadStores=${reloadStores} setStoreId=${setStoreId}/>`; break;
    case 'integrations': view = chain && html`<${Integrations} stores=${stores}/>`; break;
    case 'reports': view = html`<${Reports} me=${me} stores=${stores}/>`; break;
    case 'users': view = html`<${Users} me=${me} stores=${stores} onMe=${(u) => setSession({ ...session, me: u })}/>`; break;
    case 'audit': view = html`<${Audit} me=${me} stores=${stores}/>`; break;
    case 'today': view = html`<${Today} key=${storeId} ctx=${ctx}/>`; break;
    case 'transactions': view = seg[1] ? html`<${TxDetail} key=${seg[1]} ctx=${ctx} id=${decodeURIComponent(seg[1])}/>` : html`<${Transactions} key=${storeId} ctx=${ctx}/>`; break;
    case 'pos-orders': view = html`<${PosOrders} key=${storeId} ctx=${ctx}/>`; break;
    case 'plans': view = html`<${Plans} key=${storeId} ctx=${ctx}/>`; break;
    case 'random-check': view = html`<${RandomCheck} key=${storeId} ctx=${ctx}/>`; break;
    case 'reconcile': view = html`<${Reconcile} key=${storeId} ctx=${ctx}/>`; break;
    case 'unknown-barcodes': view = html`<${Unknown} key=${storeId} ctx=${ctx}/>`; break;
    case 'huong-dan': view = seg[1] ? html`<${GuideDoc} key=${seg[1]} id=${decodeURIComponent(seg[1])} query=${route.query} onGroup=${setGuideGroup}/>` : html`<${GuideList} group="nghiep-vu"/>`; break;
    case 'huong-dan-he-thong': view = html`<${GuideList} group="he-thong"/>`; break;
    default: view = null;
  }
  const activeNav = page === 'huong-dan' && seg[1] && guideGroup === 'he-thong' ? 'huong-dan-he-thong' : page;
  const isStorePage = ['today', 'transactions', 'pos-orders', 'plans', 'random-check', 'reconcile', 'unknown-barcodes'].includes(page);
  return html`<div class="shell">
    <${Sidebar} items=${items} active=${activeNav} onSelect=${onSelect} me=${me} onLogout=${logout}/>
    <div class="mainarea">
      <div class="mobile-only"><${Header} title=${PAGE_TITLES[page] || 'Quản trị'} sub=${isStorePage && storeName ? storeName : undefined} onMenu=${() => setMenu(true)}/></div>
      <${OfflineBar}/>
      <main class="page wide" id="main">${view}</main>
    </div>
    <${Drawer} open=${menu} onClose=${() => setMenu(false)} items=${items} active=${activeNav} onSelect=${onSelect} user=${me} sub=${`${ROLE_VI[me.role]} · ${me.id}`} onLogout=${logout}/>
  </div>`;
}

function App() {
  const [session, setSession] = useState(null);
  const [boot, setBoot] = useState(!!store.get(TOKEN_KEY));
  const [notice, setNotice] = useState('');
  const [bootErr, setBootErr] = useState(null);

  const logout = useCallback((msg) => {
    S.token = null; store.set(TOKEN_KEY, null); setSession(null); setBoot(false);
    setNotice(typeof msg === 'string' ? msg : '');
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
  }, []);
  S.onLogout = () => logout('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');

  const loadMe = useCallback(async () => {
    const [r, cfg] = await Promise.all([api.get('/me'), api.get('/stores').catch(() => ({ stores: [] }))]);
    const byId = Object.fromEntries(cfg.stores.map((x) => [x.id, x]));
    // Gộp cấu hình (thu tiền qua POS, bảo vệ cổng ra) vào danh sách chi nhánh để các trang dùng chung.
    setSession({ me: r.user, stores: r.stores.map((x) => ({ ...x, address: byId[x.id]?.address, config: byId[x.id]?.config || {} })), permissions: r.permissions });
  }, []);
  const start = useCallback(async () => {
    const t = store.get(TOKEN_KEY);
    if (!t) return setBoot(false);
    S.token = t; setBootErr(null);
    try { await loadMe(); } catch (e) { if (e.status === 401) { /* onUnauthorized đã xử lý */ } else setBootErr(e); }
    setBoot(false);
  }, []);
  useEffect(() => { start(); }, []);

  const onLogin = async (token) => {
    S.token = token; store.set(TOKEN_KEY, token); setNotice('');
    await loadMe();
    go('/', true);
  };
  const reloadStores = useCallback(async () => { try { await loadMe(); } catch { /* bỏ qua */ } }, []);

  if (boot) return html`<div class="login"><${Spinner}/></div><${Toasts}/>`;
  if (bootErr && !session) return html`<div class="login"><div class="card"><${ErrorBox} error=${bootErr} retry=${start}/><button class="btn line" onClick=${() => logout()}>Đăng nhập lại</button></div></div>`;
  if (!session) return html`<${Login} onLogin=${onLogin} notice=${notice}/><${Toasts}/><${OfflineBar}/>`;
  return html`<${Shell} session=${session} setSession=${setSession} reloadStores=${reloadStores} logout=${() => logout()}/><${Toasts}/>`;
}

render(html`<${App}/>`, document.getElementById('app'));
registerSW('/a/sw.js', '/a/');
