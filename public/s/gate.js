// Màn hình cổng ra, kiểm tra ngẫu nhiên, xử lý chênh lệch và ca chờ quản lý.
import { html, useState, useEffect, Icon, Scanner, Banner, Pill, Field, Sheet, Spinner, Empty, Loading, ErrorBox, fmt, go, toast, usePoll, useAsync } from '/shared/lib.js';
import { api, flash, useBusy, beep, enc, Top, Page, BottomBar, NeedShift, Denied, Tick, Fetching, useTx, txStatus } from '/s/common.js';

const GATE_KEY = 'brg.s.gate';
const getGate = () => { try { return localStorage.getItem(GATE_KEY) || 'Cổng 1'; } catch { return 'Cổng 1'; } };
const setGate = (g) => { try { localStorage.setItem(GATE_KEY, g); } catch { /* bỏ qua */ } };
const OUT = { valid: 'Hợp lệ', check_required: 'Cần kiểm tra', used: 'Đã dùng', unpaid: 'Chưa thanh toán', invalid: 'Không hợp lệ', expired: 'Hết hạn', not_receipt: 'Không phải biên nhận', held: 'Chờ quản lý', denied: 'Bị từ chối', extra_due: 'Còn thu thêm' };

// ============================== N08 Quét QR ra cổng ==============================
export function GateScan({ c }) {
  const [raw, setRaw] = useState('');
  const [status, setStatus] = useState('');
  const [gate, setG] = useState(getGate());
  const [busy, run] = useBusy();
  const [hist, setHist] = useState(null);
  const [showHist, setShowHist] = useState(false);
  usePoll(async () => setHist(await api.get('/gate/history')), 8000, []);
  if (!c.user.canGate) return html`<${Denied} c=${c}/>`;
  const scan = (text) => {
    const v = String(text || '').trim();
    if (!v) return;
    return run(async () => {
      const res = await api.post('/gate/scan', { raw: v, gate });
      flash.gate = { res, raw: v };
      setStatus(res.outcome === 'valid' ? 'ok' : 'err');
      beep(res.outcome === 'valid');
      go('/cong/ket-qua');
    }, () => { setStatus('err'); beep(false); setTimeout(() => setStatus(''), 1200); return false; });
  };
  return html`<${Top} c=${c} title="Kiểm tra cổng ra" sub=${gate} right=${html`<button class="btn sm soft" onClick=${() => setShowHist(true)}><${Icon} name="clock" size=${18}/> Lịch sử</button>`}/><${Page}>
    <${NeedShift} c=${c}/>
    <div class="row"><div class="ico-tile green"><${Icon} name="users"/></div><div class="grow"><div class="small muted">Khách đã qua cổng trong ca</div><div class="b" style="font-size:24px">${hist ? hist.passed : '…'}</div></div>
</div>
    <div class="seg" role="group" aria-label="Chọn cổng">${['Cổng 1', 'Cổng 2'].map((g) => html`<button key=${g} aria-pressed=${gate === g} onClick=${() => { setG(g); setGate(g); }}>${g}</button>`)}</div>
    <${Scanner} kind="qr" onScan=${scan} paused=${busy} status=${status} hint="Đưa QR biên nhận của khách vào khung"/>
    <div class="card tight"><${Field} label="Hoặc dán / nhập chuỗi QR biên nhận" hint="Chuỗi bắt đầu bằng R1.">
      <div class="row"><input class="input" value=${raw} placeholder="R1.…" autocomplete="off" autocapitalize="off" spellcheck=${false} aria-label="Chuỗi QR biên nhận"
        onInput=${(e) => setRaw(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && scan(raw)}/>
      <button class="btn primary" style="width:auto;flex:none" disabled=${busy || !raw.trim()} onClick=${() => scan(raw)}>${busy ? html`<${Spinner} sm/>` : 'Kiểm tra'}</button></div><//></div>
    ${showHist && html`<${Sheet} onClose=${() => setShowHist(false)}><h2>Lịch sử quét cổng</h2>
      ${!hist ? html`<${Loading}/>` : hist.scans.length ? html`<div class="list">${hist.scans.slice(0, 30).map((s) => html`<div class="item" key=${s.id}>
        <div class="grow"><div class="b">${s.transactionId || 'Không rõ giao dịch'}</div><div class="small muted">${fmt.time(s.ts)} · ${s.staffId}</div></div>
        <${Pill} tone=${s.outcome === 'valid' ? 'ok' : s.outcome === 'check_required' || s.outcome === 'extra_due' || s.outcome === 'held' ? 'warn' : 'err'}>${OUT[s.outcome] || s.outcome}<//></div>`)}</div>`
        : html`<div class="muted center">Chưa có lượt quét nào.</div>`}
      <button class="btn line" onClick=${() => setShowHist(false)}>Đóng</button><//>`}
  <//>`;
}

// ============================== N09–N11 Kết quả quét ==============================
const VIEWS = {
  valid: { cls: 'ok', icon: 'check', title: 'Cho khách qua', text: 'Hợp lệ. Đã ghi nhận khách ra cổng.' },
  check_required: { cls: 'warn', icon: 'eye', title: 'Kiểm tra ngẫu nhiên', text: 'Khách được chọn đối chiếu hàng thật với giỏ hàng trước khi ra.' },
  used: { cls: 'err', icon: 'x', title: 'QR đã được dùng', text: 'Không cho qua. Biên nhận này đã ra cổng trước đó.' },
  unpaid: { cls: 'err', icon: 'x', title: 'Chưa thanh toán', text: 'Không cho qua. Mời khách đến quầy thu ngân.' },
  invalid: { cls: 'err', icon: 'x', title: 'Mã không hợp lệ', text: 'Không cho qua. Mời khách mở lại QR biên nhận.' },
  expired: { cls: 'err', icon: 'clock', title: 'QR đã hết hạn', text: 'Không cho qua. Mời khách gặp thu ngân để được hỗ trợ.' },
  not_receipt: { cls: 'warn', icon: 'alert', title: 'Đây không phải QR biên nhận', text: 'Mã giỏ hàng dùng để thu tiền. Hãy yêu cầu khách mở QR biên nhận sau khi đã thanh toán.' },
  held: { cls: 'warn', icon: 'alert', title: 'Đang chờ quản lý', text: 'Không cho qua cho tới khi quản lý quyết định.' },
  denied: { cls: 'err', icon: 'x', title: 'Không cho qua', text: 'Quản lý đã từ chối. Mời khách gặp quản lý.' },
  extra_due: { cls: 'warn', icon: 'cash', title: 'Còn khoản thu bổ sung', text: 'Không cho qua. Khách cần thanh toán thêm tại quầy, sau đó quét lại QR.' }
};

export function GateResult({ c }) {
  const g = flash.gate;
  const [busy, run] = useBusy();
  const [callMgr, setCallMgr] = useState(false);
  const [refuse, setRefuse] = useState(false);
  const [, bump] = useState(0);
  useEffect(() => { if (!g) go('/cong', true); }, []);
  if (!g) return null;
  const { res } = g;
  const v = VIEWS[res.outcome] || VIEWS.invalid;
  const tx = res.transaction;
  const next = () => { flash.gate = null; go('/cong', true); };
  const doRefuse = () => run(async () => {
    await api.post('/checks', { transactionId: tx.id, result: 'mismatch', kind: 'refused', note: 'Khách từ chối kiểm tra', action: 'call_manager', place: 'gate', gate: getGate() });
    flash.gate = { res: { outcome: 'held', reason: 'Khách từ chối kiểm tra, đang chờ quản lý', transaction: tx } };
    setRefuse(false); bump((n) => n + 1);
  }, (e) => { setRefuse(false); toast(e.message, 'err'); return true; });
  return html`<div class=${`result ${v.cls}`}><div class="big"><${Icon} name=${v.icon}/></div>
    <h1>${v.title}</h1>${res.reason && res.outcome !== 'valid' && res.outcome !== 'used' && res.reason !== v.title && html`<p><b>${res.reason}</b></p>`}<p>${v.text}</p>
    ${res.outcome === 'extra_due' && res.amount > 0 && html`<div class="xl">${fmt.money(res.amount)}</div>`}
    ${tx && html`<div class="glass"><div><span>Giỏ hàng</span><b>${tx.code || tx.id}</b></div>
      ${tx.itemCount != null && html`<div><span>Số sản phẩm</span><b>${tx.itemCount}</b></div>`}
      ${res.outcome === 'valid' && tx.paidAt && html`<div><span>Thanh toán lúc</span><b>${fmt.time(tx.paidAt)} · ${fmt.method(tx.method)}</b></div>`}
      ${res.outcome === 'used' && html`<div><span>Đã dùng lúc</span><b>${fmt.time(res.usedAt)}</b></div><div><span>Người quét</span><b>${res.usedBy || '—'}</b></div>${res.gate ? html`<div><span>Cổng</span><b>${res.gate}</b></div>` : ''}`}</div>`}
    ${res.outcome === 'check_required' && res.items && html`<p>${res.items.reduce((a, i) => a + i.qty, 0)} sản phẩm cần đối chiếu</p>`}
    <div class="actions">
      ${res.outcome === 'check_required' && html`<button class="btn" onClick=${() => go(`/doi-chieu/${enc(tx.id)}?place=gate`)}>Bắt đầu kiểm tra</button>
        <button class="btn ghost" onClick=${() => setRefuse(true)}>Khách từ chối · gọi quản lý</button>`}
      ${res.outcome === 'held' && html`<button class="btn" onClick=${() => (c.user.isManager ? go('/cho-quan-ly') : setCallMgr(true))}>Gọi quản lý</button>`}
      ${res.outcome === 'extra_due' && tx && (c.user.canCash ? html`<button class="btn" onClick=${() => go(`/gio/${enc(tx.id)}`)}>Thu bổ sung ngay</button>` : html`<p><b>Đưa khách tới quầy thu ngân để thanh toán thêm.</b></p>`)}
      ${res.outcome !== 'check_required' && html`<button class=${`btn ${['held', 'extra_due'].includes(res.outcome) ? 'ghost' : ''}`} onClick=${next}>Quét khách tiếp theo</button>`}
    </div>
    ${callMgr && html`<${Sheet} onClose=${() => setCallMgr(false)}><h2>Gọi quản lý</h2><p class="muted">Chỉ quản lý mới cho khách qua hoặc từ chối được. Hãy gọi quản lý chi nhánh đến cổng. Quản lý đăng nhập ứng dụng này, vào mục "Chờ quản lý" để xử lý giao dịch ${tx?.code || ''}.</p><button class="btn primary" onClick=${() => setCallMgr(false)}>Đã hiểu</button><//>`}
    ${refuse && html`<${Sheet} center onClose=${() => setRefuse(false)}><h2>Khách từ chối kiểm tra?</h2><p class="muted">Giao dịch sẽ chuyển sang trạng thái chờ quản lý. Khách chưa được qua cổng.</p>
      <button class="btn danger" disabled=${busy} onClick=${doRefuse}>${busy ? html`<${Spinner} sm/>` : 'Xác nhận, gọi quản lý'}</button><button class="btn txt" onClick=${() => setRefuse(false)}>Quay lại</button><//>`}
  </div>`;
}

// ============================== N12 Đối chiếu giỏ hàng ==============================
export function CheckList({ c, id, place }) {
  const st = useTx(id);
  const [ticks, setTicks] = useState({});
  const [busy, run] = useBusy();
  if (!c.user.canGate && !c.user.canCash) return html`<${Denied} c=${c}/>`;
  const tx = st.data;
  const back = place === 'counter' ? `/gio/${enc(id)}` : '/cong';
  if (!tx) return html`<${Top} c=${c} title="Đối chiếu giỏ hàng" back=${back}/><${Page}><${Fetching} st=${st}/><//>`;
  const items = tx.items || [];
  const done = items.filter((_, i) => ticks[i]).length, all = items.length > 0 && done === items.length;
  const match = () => run(async () => {
    const r = await api.post('/checks', { transactionId: tx.id, result: 'match', lines: items.map((i) => ({ sku: i.sku, qty: i.qty, checked: true })), place, gate: getGate() });
    beep(true);
    if (place === 'counter') { toast('Đối chiếu khớp, tiếp tục thu tiền', 'ok'); go(`/gio/${enc(tx.id)}`, true); }
    else if (r.exited) { flash.gate = { res: { outcome: 'valid', transaction: r.transaction } }; go('/cong/ket-qua', true); }
    else { flash.gate = { res: { outcome: 'extra_due', reason: 'Còn khoản thu bổ sung', amount: r.transaction.extraDue, transaction: r.transaction } }; go('/cong/ket-qua', true); }
  }, (e) => { if (e.code === 'ALREADY_CHECKED' || e.code === 'NOT_CHECKABLE') { toast(e.message, 'err'); go(back, true); return true; } return false; });
  return html`<${Top} c=${c} title="Đối chiếu giỏ hàng" sub=${`${tx.code} · ${place === 'counter' ? 'tại quầy' : 'tại cổng'}`} back=${back}/><${Page} bottom>
    <${Banner} tone="brand" icon="eye">Đối chiếu hàng thật trong túi với danh sách. Chạm từng dòng khi đã thấy đủ số lượng.<//>
    <div class="stack" style="gap:6px"><div class="row"><b class="grow">Đã đối chiếu</b><b class="num">${done}/${items.length}</b></div><div class="progress" role="progressbar" aria-valuenow=${done} aria-valuemax=${items.length}><i style=${`width:${items.length ? (done / items.length) * 100 : 0}%`}></i></div></div>
    <div class="stack" style="gap:8px">${items.map((i, n) => html`<${Tick} key=${n} on=${!!ticks[n]} onChange=${(v) => setTicks({ ...ticks, [n]: v })}><span class="name" style="font-weight:600">${i.name}</span><//>`)}</div>
  <//>
  <${BottomBar}><button class="btn primary" disabled=${!all || busy} onClick=${match}>${busy ? html`<${Spinner} sm/>` : place === 'counter' ? 'Khớp, tiếp tục thu tiền' : 'Khớp, cho qua'}</button>
    <button class="btn line" disabled=${busy} onClick=${() => go(`/chenh-lech/${enc(tx.id)}?place=${place}`)}>Có chênh lệch</button><//>`;
}

// ============================== N13 Ghi chênh lệch ==============================
const KINDS = [['unscanned', 'Có hàng chưa quét'], ['qty', 'Sai số lượng'], ['other', 'Khác']];
export function Mismatch({ c, id, place }) {
  const st = useTx(id);
  const [kind, setKind] = useState('unscanned');
  const [sku, setSku] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [action, setAction] = useState('collect_extra');
  const [errs, setErrs] = useState({});
  const [busy, run] = useBusy();
  if (!c.user.canGate && !c.user.canCash) return html`<${Denied} c=${c}/>`;
  const tx = st.data;
  const back = place === 'counter' ? `/doi-chieu/${enc(id)}?place=counter` : `/doi-chieu/${enc(id)}?place=gate`;
  if (!tx) return html`<${Top} c=${c} title="Ghi chênh lệch" back=${back}/><${Page}><${Fetching} st=${st}/><//>`;
  const submit = () => {
    const e = {};
    if (action === 'collect_extra' && !(Number(amount) > 0)) e.amount = 'Nhập số tiền chênh lệch cần thu thêm';
    if (kind === 'other' && !note.trim()) e.note = 'Hãy ghi chú nội dung chênh lệch';
    setErrs(e);
    if (Object.keys(e).length) return;
    run(async () => {
      const r = await api.post('/checks', { transactionId: tx.id, result: 'mismatch', kind, sku: sku || null, amount: action === 'collect_extra' ? Number(amount) : undefined, note: note.trim(), action, place, gate: getGate() });
      const t = r.transaction;
      if (place === 'counter') {
        toast(action === 'collect_extra' ? 'Đã ghi khoản thu bổ sung, tiếp tục thu tiền' : 'Đã báo quản lý', 'ok');
        go(`/gio/${enc(tx.id)}`, true);
      } else {
        flash.gate = action === 'collect_extra'
          ? { res: { outcome: 'extra_due', reason: 'Đã ghi chênh lệch. Hướng dẫn khách tới quầy thu ngân thanh toán thêm, rồi quét lại QR biên nhận.', amount: t.extraDue, transaction: t } }
          : { res: { outcome: 'held', reason: 'Đã báo quản lý xử lý chênh lệch', transaction: t } };
        go('/cong/ket-qua', true);
      }
    }, (e) => { if (['ALREADY_CHECKED', 'NOT_CHECKABLE'].includes(e.code)) { toast(e.message, 'err'); go(place === 'counter' ? `/gio/${enc(id)}` : '/cong', true); return true; } return false; });
  };
  return html`<${Top} c=${c} title="Ghi chênh lệch" sub=${tx.code} back=${back}/><${Page} bottom>
    <${Field} label="Loại chênh lệch"><div class="chips">${KINDS.map(([k, t]) => html`<button key=${k} class=${`chip ${kind === k ? 'on' : ''}`} onClick=${() => setKind(k)}>${t}</button>`)}</div><//>
    <${Field} label="Sản phẩm liên quan"><select class="input" value=${sku} onChange=${(e) => setSku(e.target.value)} aria-label="Sản phẩm liên quan">
      <option value="">${kind === 'unscanned' ? 'Hàng không có trong giỏ' : 'Không chọn'}</option>${(tx.items || []).map((i) => html`<option key=${i.sku} value=${i.sku}>${i.name}</option>`)}</select><//>
    <${Field} label=${`Số tiền chênh lệch (₫)${action === 'collect_extra' ? '' : ' - không bắt buộc'}`} error=${errs.amount} hint="Giá trị hàng chưa thanh toán, nhập số nguyên VNĐ">
      <input class=${`input big ${errs.amount ? 'err' : ''}`} inputmode="numeric" value=${amount ? fmt.num(amount) : ''} placeholder="0" aria-label="Số tiền chênh lệch"
        onInput=${(e) => { setAmount(e.target.value.replace(/\D/g, '').slice(0, 9)); setErrs({ ...errs, amount: '' }); }}/><//>
    <${Field} label=${kind === 'other' ? 'Ghi chú (bắt buộc)' : 'Ghi chú'} error=${errs.note}><textarea class=${`input ${errs.note ? 'err' : ''}`} placeholder="Mô tả ngắn điều đã thấy" value=${note} onInput=${(e) => { setNote(e.target.value); setErrs({ ...errs, note: '' }); }}></textarea><//>
    <${Field} label="Cách xử lý"><div class="stack" style="gap:8px">
      <button class=${`option ${action === 'collect_extra' ? 'on' : ''}`} onClick=${() => setAction('collect_extra')}><div><div class="b">Khách thanh toán bổ sung</div><div class="small muted">${place === 'counter' ? 'Cộng vào số tiền cần thu hiện tại' : 'Thu ngân thu thêm rồi quét lại QR'}</div></div><span class="radio"></span></button>
      <button class=${`option ${action === 'call_manager' ? 'on' : ''}`} onClick=${() => setAction('call_manager')}><div><div class="b">Báo quản lý</div><div class="small muted">Giữ giao dịch, chờ quản lý quyết định</div></div><span class="radio"></span></button></div><//>
  <//>
  <${BottomBar}><button class="btn primary" disabled=${busy} onClick=${submit}>${busy ? html`<${Spinner} sm/>` : 'Lưu chênh lệch'}</button><//>`;
}

// ============================== Chờ quản lý ==============================
export function HeldList({ c }) {
  const st = useAsync(async () => (await api.get('/transactions')).transactions.filter((t) => t.exitStatus === 'held' && !flash.denied.has(t.id)), []);
  const [sel, setSel] = useState(null);
  const [decision, setDecision] = useState('allow');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, run] = useBusy();
  usePoll(async () => { if (!sel) await st.reload(); }, 10000, [!!sel]);
  if (!c.user.isManager) return html`<${Top} c=${c} title="Chờ quản lý" back="/"/><${Page}><${Empty} icon="shield" title="Cần quản lý xử lý" text="Chỉ quản lý chi nhánh mới cho khách qua hoặc từ chối. Hãy gọi quản lý đến quầy, quản lý đăng nhập ứng dụng này và vào mục Chờ quản lý."><button class="btn primary" onClick=${() => go('/')}>Về trang chính</button><//><//>`;
  const open = (t, d) => { setSel(t); setDecision(d); setNote(''); setErr(''); };
  const submit = () => {
    if (decision === 'deny' && !note.trim()) return setErr('Hãy ghi lý do từ chối');
    run(async () => {
      await api.post(`/transactions/${enc(sel.id)}/resolve`, { decision, note: note.trim() });
      if (decision === 'deny') flash.denied.add(sel.id);
      toast(decision === 'allow' ? 'Đã cho khách qua' : 'Đã từ chối', 'ok');
      setSel(null); st.reload();
    }, (e) => { if (e.code === 'MANAGER_ONLY') { setErr('Chỉ quản lý mới xử lý được. Hãy gọi quản lý đăng nhập ứng dụng này.'); return true; } if (e.code === 'NOT_HELD') { toast(e.message, 'err'); setSel(null); st.reload(); return true; } return false; });
  };
  return html`<${Top} c=${c} title="Chờ quản lý" sub="Ca cần quyết định" right=${html`<button class="iconbtn" onClick=${st.reload} aria-label="Làm mới"><${Icon} name="refresh"/></button>`}/><${Page}>
    <${Fetching} st=${st}/>
    ${st.data && (st.data.length ? st.data.map((t) => html`<div class="card" key=${t.id}>
      <div class="row"><div class="ico-tile err"><${Icon} name="alert"/></div><div class="grow"><div class="b">${t.code}</div><div class="small muted">${t.itemCount} sản phẩm · ${fmt.method(t.method)} · ${fmt.time(t.paidAt || t.createdAt)}</div></div><div class="b num">${fmt.money(t.total)}</div></div>
      <button class="btn sm line" onClick=${() => go(`/giao-dich/${enc(t.id)}`)}>Xem giỏ hàng</button>
      <div class="grid2"><button class="btn danger-line" onClick=${() => open(t, 'deny')}>Từ chối</button><button class="btn ok" onClick=${() => open(t, 'allow')}>Cho qua</button></div></div>`)
      : html`<${Empty} icon="shield" title="Không có ca chờ" text="Các giao dịch cần quản lý quyết định sẽ hiện ở đây."/>`)}
    ${sel && html`<${Sheet} onClose=${() => setSel(null)}><h2>${decision === 'allow' ? 'Cho khách qua?' : 'Từ chối cho qua?'}</h2><p class="muted">${sel.code} · ${fmt.money(sel.total)}</p>
      <${Field} label=${decision === 'deny' ? 'Lý do (bắt buộc)' : 'Ghi chú (không bắt buộc)'} error=${err}><textarea class=${`input ${err ? 'err' : ''}`} value=${note} onInput=${(e) => { setNote(e.target.value); setErr(''); }} placeholder="Ghi chú của quản lý"></textarea><//>
      <button class=${`btn ${decision === 'allow' ? 'ok' : 'danger'}`} disabled=${busy} onClick=${submit}>${busy ? html`<${Spinner} sm/>` : decision === 'allow' ? 'Cho khách qua' : 'Từ chối'}</button>
      <button class="btn txt" onClick=${() => setSel(null)}>Quay lại</button><//>`}
  <//>`;
}
