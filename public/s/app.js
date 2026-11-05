// PWA nhân viên BRG Scan & Checkout: thu ngân + kiểm soát cổng ra.
import { html, render, useState, useEffect, useCallback, useRoute, go, Drawer, Toasts, OfflineBar, registerSW, toast, Loading, ErrorBox } from '/shared/lib.js';
import { api, getToken, setToken, setOnUnauth, setOnFlagChange, CSS, roleName, enc, flagsOf, Unavailable } from '/s/common.js';
import { Login, Home, Lookup, QueueScreen, Cart, Cash, Transfer, Done, Transactions, TxDetail, EndShift } from '/s/screens.js';
import { GateScan, GateResult, CheckList, Mismatch, HeldList } from '/s/gate.js';

const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

function Router({ c, route }) {
  const seg = route.path.split('/').filter(Boolean).map(decodeURIComponent);
  const q = route.query;
  const f = flagsOf(c.store);
  if (f.pos && ['thu', 'hang-doi', 'gio', 'da-thu'].includes(seg[0])) return html`<${Unavailable} c=${c} kind="pos"/>`;
  if (!f.guard && ['cong', 'doi-chieu', 'chenh-lech', 'cho-quan-ly'].includes(seg[0])) return html`<${Unavailable} c=${c} kind="guard"/>`;
  switch (seg[0]) {
    case undefined: return html`<${Home} c=${c}/>`;
    case 'thu': return html`<${Lookup} c=${c}/>`;
    case 'hang-doi': return html`<${QueueScreen} c=${c}/>`;
    case 'gio':
      if (seg[2] === 'tien-mat') return html`<${Cash} key=${seg[1]} c=${c} id=${seg[1]}/>`;
      if (seg[2] === 'chuyen-khoan') return html`<${Transfer} key=${seg[1]} c=${c} id=${seg[1]}/>`;
      return html`<${Cart} key=${seg[1]} c=${c} id=${seg[1]}/>`;
    case 'da-thu': return html`<${Done} c=${c}/>`;
    case 'cong': return seg[1] === 'ket-qua' ? html`<${GateResult} c=${c}/>` : html`<${GateScan} c=${c}/>`;
    case 'doi-chieu': return html`<${CheckList} key=${seg[1]} c=${c} id=${seg[1]} place=${q.place === 'counter' ? 'counter' : 'gate'}/>`;
    case 'chenh-lech': return html`<${Mismatch} key=${seg[1]} c=${c} id=${seg[1]} place=${q.place === 'counter' ? 'counter' : 'gate'}/>`;
    case 'giao-dich': return seg[1] ? html`<${TxDetail} key=${seg[1]} c=${c} id=${seg[1]}/>` : html`<${Transactions} c=${c}/>`;
    case 'cho-quan-ly': return html`<${HeldList} c=${c}/>`;
    case 'doi-soat': return html`<${EndShift} c=${c}/>`;
    default: return html`<${Home} c=${c}/>`;
  }
}

const NAV_ACTIVE = { undefined: 'home', thu: 'thu', gio: 'thu', 'hang-doi': 'queue', cong: 'cong', 'giao-dich': 'tx', 'cho-quan-ly': 'held', 'doi-soat': 'end' };

function App() {
  const route = useRoute();
  const [auth, setAuth] = useState(null);
  const [shift, setShift] = useState(null);
  const [boot, setBoot] = useState(getToken() ? 'loading' : 'none');
  const [menu, setMenu] = useState(false);
  const logout = useCallback(() => { setToken(null); setAuth(null); setShift(null); setMenu(false); history.replaceState(null, '', '#/'); }, []);
  const loadMe = useCallback(() => {
    setBoot('loading');
    api.get('/me').then((r) => { setAuth({ user: r.user, store: r.store }); setShift(r.shift); setBoot('ok'); })
      .catch((e) => { if (e.status === 401) { setToken(null); setBoot('none'); } else setBoot(e); });
  }, []);
  // Làm mới thông tin chi nhánh (cờ POS / bảo vệ) mà không hiện màn tải.
  const refreshMe = useCallback(() => api.get('/me').then((r) => setAuth((a) => (a ? { user: r.user, store: r.store } : a))).catch(() => {}), []);
  useEffect(() => {
    setOnFlagChange((e) => { toast(e.message, 'err'); refreshMe(); go('/', true); });
    const vis = () => { if (document.visibilityState === 'visible' && getToken()) refreshMe(); };
    document.addEventListener('visibilitychange', vis);
    addEventListener('focus', vis);
    return () => { document.removeEventListener('visibilitychange', vis); removeEventListener('focus', vis); };
  }, []);
  useEffect(() => {
    setOnUnauth(() => { toast('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại', 'err'); logout(); setBoot('none'); });
    if (getToken()) loadMe();
  }, []);
  const refreshShift = useCallback(() => api.get('/shifts/current').then((r) => setShift(r.shift)).catch(() => {}), []);

  let body;
  if (boot === 'loading') body = html`<div class="login"><${Loading}/></div>`;
  else if (boot !== 'ok' && boot !== 'none') body = html`<div class="login"><div class="card"><${ErrorBox} error=${boot} retry=${loadMe}/></div></div>`;
  else if (!auth || boot === 'none') body = html`<${Login} onLogin=${(r) => { setAuth({ user: r.user, store: r.store }); setBoot('ok'); api.get('/shifts/current').then((s) => setShift(s.shift)).catch(() => {}); history.replaceState(null, '', '#/'); }}/>`;
  else {
    const { user, store } = auth;
    const c = { user, store, shift, setShift, refreshShift, refreshMe, logout, openMenu: () => setMenu(true) };
    const f = flagsOf(store);
    const items = [
      { id: 'home', icon: 'home', label: 'Trang chính' },
      !f.pos && user.canCash && { id: 'thu', icon: 'cash', label: 'Thu tiền' },
      !f.pos && user.canCash && { id: 'queue', icon: 'list', label: 'Hàng đợi' },
      f.guard && user.canGate && { id: 'cong', icon: 'shield', label: 'Kiểm tra cổng ra' },
      (f.guard || !f.pos || user.isManager) && { id: 'tx', icon: 'receipt', label: 'Giao dịch gần đây' },
      f.guard && user.isManager && { id: 'held', icon: 'alert', label: 'Chờ quản lý' },
      { id: 'end', icon: 'docok', label: f.pos ? 'Kết thúc ca' : 'Đối soát ca' },
      { id: 'logout', icon: 'logout', label: 'Đăng xuất' }
    ].filter(Boolean);
    const routes = { home: '/', thu: '/thu', queue: '/hang-doi', cong: '/cong', tx: '/giao-dich', held: '/cho-quan-ly', end: '/doi-soat' };
    const active = NAV_ACTIVE[route.path.split('/').filter(Boolean)[0]];
    body = html`<${OfflineBar}/><${Router} c=${c} route=${route}/>
      <${Drawer} open=${menu} onClose=${() => setMenu(false)} items=${items} active=${active} user=${user} sub=${`${roleName(user)} · ${store.name}`}
        onSelect=${(id) => (id === 'logout' ? logout() : go(routes[id]))} onLogout=${logout}/>`;
  }
  return html`${body}<${Toasts}/>`;
}

render(html`<${App}/>`, document.getElementById('app'));
registerSW('/s/sw.js', '/s/');
