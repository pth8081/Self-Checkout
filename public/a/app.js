// Web quản trị BRG Scan & Checkout (chuỗi + chi nhánh).
import { html, render, useState, useEffect, useMemo, useCallback, useRoute, go, toast, Toasts, Header, Drawer, Icon, Logo, Spinner, OfflineBar, Field, registerSW, ErrorBox, QR, copyText, fmt } from '/shared/lib.js';
import { api, S, store, ROLE_VI, passkeyGet, Banner } from '/a/common.js';
import { Overview, Stores, Integrations, Reports, Users, Audit } from '/a/pages-chain.js';
import { GuideList, GuideDoc } from '/a/guides.js';
import { Today, Transactions, TxDetail, PosOrders, Plans, RandomCheck, Reconcile, Unknown } from '/a/pages-store.js';

const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/a/admin.css'; document.head.appendChild(link);

const TOKEN_KEY = 'brg_a_token', STORE_KEY = 'brg_a_store';

const PAGE_TITLES = {
  overview: 'Tổng quan chuỗi', stores: 'Chi nhánh & tính năng', integrations: 'Tích hợp', reports: 'Báo cáo', users: 'Tài khoản & phân quyền', audit: 'Nhật ký',
  today: 'Hôm nay', transactions: 'Giao dịch', 'pos-orders': 'Đơn Dsmart POS', plans: 'Nhân viên & ca', 'random-check': 'Kiểm tra ngẫu nhiên', reconcile: 'Đối soát', 'unknown-barcodes': 'Mã không tìm thấy',
  'huong-dan': 'Hướng dẫn nghiệp vụ', 'huong-dan-he-thong': 'Hướng dẫn hệ thống'
};
const CHAIN_ONLY = ['overview', 'integrations'];

function navItems(me, storeName) {
  const chain = me.role === 'chain_admin';
  const guides = [{ group: 'Hướng dẫn' }, { id: 'huong-dan', label: 'Hướng dẫn nghiệp vụ', icon: 'docok' }, { id: 'huong-dan-he-thong', label: 'Hướng dẫn hệ thống', icon: 'settings' }];
  const branch = [
    { id: 'today', label: 'Hôm nay', icon: 'home' }, { id: 'transactions', label: 'Giao dịch', icon: 'receipt' }, { id: 'pos-orders', label: 'Đơn Dsmart POS', icon: 'card' },
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
  const [step, setStep] = useState(null); // { stepToken }: đã đúng mật khẩu, chờ mã xác thực 2 bước
  const [setup, setSetup] = useState(null); // { secret, uri, confirmToken }: lần đầu đăng nhập phải thiết lập xác thực 2 bước
  const [conflict, setConflict] = useState(null); // { takeoverToken, other }: tài khoản đang đăng nhập ở thiết bị khác, chờ người dùng đồng ý
  const [cap, setCap] = useState(null); // { required, id, svg }
  const [capText, setCapText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const loadCap = async () => { try { setCap(await api.get('/captcha')); setCapText(''); } catch { setCap({ required: false }); } };
  useEffect(() => { loadCap(); }, []);
  const capSrc = cap?.svg ? `data:image/svg+xml;utf8,${encodeURIComponent(cap.svg)}` : '';
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr('');
    if (step) {
      if (!/^\d{6}$/.test(totp)) return setErr('Mã xác thực gồm 6 chữ số');
      setBusy(true);
      try { const r = await api.post('/login/totp', { stepToken: step.stepToken, code: totp }); if (r.sessionConflict) { setConflict(r); return; } await onLogin(r.token); }
      catch (x) {
        if (x.code === 'EXPIRED') { setStep(null); setTotp(''); setPassword(''); setErr(x.message); loadCap(); }
        else { setErr(x.message); setTotp(''); }
      } finally { setBusy(false); }
      return;
    }
    if (!account.trim() || !password) return setErr('Nhập tài khoản và mật khẩu');
    if (cap?.required && !/^\d{4}$/.test(capText.trim())) return setErr('Nhập 4 số trong hình');
    setBusy(true);
    try {
      const r = await api.post('/login', { account: account.trim(), password, captchaId: cap?.required ? cap.id : undefined, captcha: cap?.required ? capText.trim() : undefined });
      if (r.mfaSetup) { setSetup(r); setTotp(''); return; }
      if (r.totpRequired) { setStep(r); setTotp(''); return; }
      if (r.sessionConflict) { setConflict(r); return; }
      await onLogin(r.token);
    } catch (x) {
      setErr(x.code === 'LOCKED' ? (x.message || 'Tài khoản bị khóa tạm vì nhập sai nhiều lần. Hãy thử lại sau ít phút.') : (x.message || 'Đăng nhập không thành công'));
      loadCap(); // mỗi hình chỉ thử một lần
    } finally { setBusy(false); }
  };
  const confirm2fa = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr('');
    if (!/^\d{6}$/.test(totp)) return setErr('Mã xác thực gồm 6 chữ số');
    setBusy(true);
    try { const r = await api.post('/login/2fa-confirm', { confirmToken: setup.confirmToken, code: totp }); if (r.sessionConflict) { setConflict(r); return; } await onLogin(r.token); }
    catch (x) {
      if (x.code === 'EXPIRED' || x.code === 'ALREADY_2FA') { setSetup(null); setTotp(''); setPassword(''); setErr(x.message); loadCap(); }
      else { setErr(x.message); setTotp(''); }
    } finally { setBusy(false); }
  };
  const passkey = async () => {
    if (busy) return;
    setErr('');
    if (!window.PublicKeyCredential) return setErr(location.protocol !== 'https:' && location.hostname !== 'localhost' ? 'Đăng nhập bằng vân tay / khuôn mặt chỉ dùng được khi mở trang bằng https (địa chỉ hiện tại là http).' : 'Trình duyệt này không hỗ trợ đăng nhập bằng vân tay / khuôn mặt. Hãy dùng Chrome, Safari, Edge bản mới.');
    setBusy(true);
    try {
      const o = await api.post('/login/passkey/options', { account: account.trim() || undefined });
      const cred = await passkeyGet(o.options);
      const r = await api.post('/login/passkey', { challengeToken: o.challengeToken, credential: cred });
      if (r.sessionConflict) { setConflict(r); return; }
      await onLogin(r.token);
    } catch (x) {
      setErr(x.name === 'NotAllowedError' ? 'Đã hủy hoặc hết thời gian chờ xác minh trên thiết bị' : (x.message || 'Đăng nhập bằng thiết bị không thành công'));
    } finally { setBusy(false); }
  };
  const takeover = async () => {
    if (busy) return;
    setErr(''); setBusy(true);
    try { const r = await api.post('/login/takeover', { takeoverToken: conflict.takeoverToken }); await onLogin(r.token); }
    catch (x) { setConflict(null); setStep(null); setSetup(null); setPassword(''); setErr(x.message || 'Phiên xác nhận đã hết hạn, hãy đăng nhập lại'); loadCap(); }
    finally { setBusy(false); }
  };
  if (conflict) return html`<div class="login"><div class="card">
    <div class="row"><${Logo} size=${44}/><div><h1 style="font-size:22px">Tài khoản đang đăng nhập ở nơi khác</h1></div></div>
    <${Banner} tone="warn" icon="alert" title="Đang có một thiết bị đăng nhập tài khoản này">
      <div class="small" style="line-height:1.7">Thiết bị: <b>${conflict.other.device}</b>${conflict.other.ip ? ` (địa chỉ ${conflict.other.ip})` : ''}<br/>${conflict.other.since ? html`Đăng nhập lúc: <b>${fmt.dateTime(conflict.other.since)}</b><br/>` : ''}${conflict.other.lastSeen ? html`Hoạt động gần nhất: <b>${fmt.dateTime(conflict.other.lastSeen)}</b>` : ''}</div><//>
    <p class="muted">Mỗi tài khoản chỉ đăng nhập ở một thiết bị tại một thời điểm. Bấm <b>Đồng ý</b> để đăng nhập ở đây và <b>đăng xuất thiết bị kia</b>.</p>
    ${err && html`<div class="banner err" role="alert"><${Icon} name="alert"/><div class="grow">${err}</div></div>`}
    <button class="btn primary" type="button" disabled=${busy} onClick=${takeover}>${busy ? html`<${Spinner} sm/>` : 'Đồng ý, đăng nhập ở đây'}</button>
    <button class="btn txt" type="button" onClick=${() => { setConflict(null); setStep(null); setSetup(null); setPassword(''); setTotp(''); setErr(''); loadCap(); }}>Hủy</button>
  </div></div>`;
  if (setup) return html`<div class="login"><form class="card" onSubmit=${confirm2fa} noValidate>
    <div class="row"><${Logo} size=${44}/><div><h1 style="font-size:22px">Thiết lập xác thực 2 bước</h1><div class="small muted">Bắt buộc với tài khoản quản trị</div></div></div>
    <div class="small">1. Cài app xác thực trên điện thoại (Google Authenticator, Microsoft Authenticator, Authy…).<br/>2. Quét mã QR bên dưới, hoặc nhập mã bí mật thủ công.<br/>3. Nhập mã 6 số hiện trong app để hoàn tất.</div>
    <div class="qrbox qrbig" style="margin:8px auto"><${QR} text=${setup.uri} label="Mã QR thiết lập xác thực 2 bước"/></div>
    <div class="field"><label>Mã bí mật (nhập thủ công)</label><div class="secret">${setup.secret}</div></div>
    <button class="btn line sm" type="button" onClick=${() => copyText(setup.secret)}>Sao chép mã bí mật</button>
    <${Field} label="Mã 6 số trong app"><input class="input big" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value=${totp} onInput=${(e) => setTotp(e.target.value.replace(/\D/g, ''))} aria-label="Mã xác thực" autofocus/><//>
    ${err && html`<div class="banner err" role="alert"><${Icon} name="alert"/><div class="grow">${err}</div></div>`}
    <button class="btn primary" type="submit" disabled=${busy}>${busy ? html`<${Spinner} sm/>` : 'Xác nhận và đăng nhập'}</button>
    <button class="btn txt" type="button" onClick=${() => { setSetup(null); setTotp(''); setErr(''); setPassword(''); loadCap(); }}>Quay lại</button>
    <div class="hint">Mã bí mật chỉ hiện ở màn hình này. Hãy lưu lại trước khi xác nhận. Mất điện thoại thì nhờ quản trị chuỗi khác đặt lại.</div>
  </form></div>`;
  return html`<div class="login"><form class="card" onSubmit=${submit} noValidate>
    <div class="row"><${Logo} size=${44}/><div><h1 style="font-size:22px">Quản trị BRG</h1><div class="small muted">Scan & Checkout · chuỗi và chi nhánh</div></div></div>
    ${notice && html`<div class="banner" role="status">${notice}</div>`}
    <${Field} label="Tài khoản, tên đăng nhập hoặc email"><input class="input" name="username" autocomplete="username" autocapitalize="off" value=${account} onInput=${(e) => setAccount(e.target.value)} aria-label="Tài khoản hoặc email" autofocus disabled=${!!step}/><//>
    <${Field} label="Mật khẩu"><input class="input" type="password" name="password" autocomplete="current-password" value=${password} onInput=${(e) => setPassword(e.target.value)} aria-label="Mật khẩu" disabled=${!!step}/><//>
    ${!step && cap?.required && html`<${Field} label="Mã xác thực"><div class="row" style="gap:8px;align-items:stretch">
        <div class="capimg grow" role="img" aria-label="Hình chứa 4 chữ số"><img src=${capSrc} alt="" width="150" height="48"/></div>
        <button class="iconbtn" type="button" onClick=${loadCap} aria-label="Đổi hình khác"><${Icon} name="refresh"/></button></div>
      <input class="input" style="margin-top:8px" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="Nhập 4 số trong hình" value=${capText} onInput=${(e) => setCapText(e.target.value.replace(/\D/g, ''))} aria-label="Mã xác thực 4 số"/><//>`}
    ${step && html`<${Field} label="Mã xác thực 6 số" hint="Mở app xác thực (Google Authenticator, Authy…) và nhập mã hiện tại"><input class="input big" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value=${totp} onInput=${(e) => setTotp(e.target.value.replace(/\D/g, ''))} aria-label="Mã xác thực 6 số" autofocus/><//>`}
    ${err && html`<div class="banner err" role="alert"><${Icon} name="alert"/><div class="grow">${err}</div></div>`}
    <button class="btn primary" type="submit" disabled=${busy}>${busy ? html`<${Spinner} sm/>` : step ? 'Xác nhận' : 'Đăng nhập'}</button>
    ${step && html`<button class="btn txt" type="button" onClick=${() => { setStep(null); setTotp(''); setErr(''); setPassword(''); loadCap(); }}>Quay lại</button>`}
    ${!step && html`<button class="btn line" type="button" disabled=${busy} onClick=${passkey}><${Icon} name="shield"/>Đăng nhập bằng vân tay / Face ID</button>`}
    <div class="hint">Sai nhiều lần liên tiếp sẽ bị khóa tạm. Mọi lần đăng nhập đều được ghi lại.</div>
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
    if (S.token) fetch('/api/a/logout', { method: 'POST', headers: { Authorization: `Bearer ${S.token}` }, keepalive: true }).catch(() => {}); // báo máy chủ xóa phiên (không chờ)
    S.token = null; store.set(TOKEN_KEY, null); setSession(null); setBoot(false);
    setNotice(typeof msg === 'string' ? msg : '');
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
  }, []);
  S.onLogout = (data) => logout(data?.error === 'SESSION_REPLACED' ? data.message : 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');

  const loadMe = useCallback(async () => {
    const [r, cfg] = await Promise.all([api.get('/me'), api.get('/stores').catch(() => ({ stores: [] }))]);
    const byId = Object.fromEntries(cfg.stores.map((x) => [x.id, x]));
    // Gộp cấu hình (thu tiền qua Dsmart POS, bảo vệ cổng ra) vào danh sách chi nhánh để các trang dùng chung.
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
