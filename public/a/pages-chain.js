// Các trang quản trị: tổng quan, chi nhánh, tích hợp, báo cáo, tài khoản, nhật ký.
import { html, useState, useEffect, useMemo, useAsync, fmt, go, toast, Sheet, Switch, Field, Spinner, QR, copyText, saveBlob, todayStr } from '/shared/lib.js';
import { api, S, passkeyCreate, ROLE_VI, STAFF_ROLES, BIN_NOTE, PAY_SOURCE, isPos, noGuard, cfgOf, PageHead, Tile, Async, BarChart, StoreBar, useBusy, useDebounced, dm, addDays, actionLabel, ACTOR_VI, auditDetail, Icon, Pill, Banner, Empty, Confirm, ErrorBox } from '/a/common.js';

// ============================== A01 Tổng quan chuỗi ==============================
export function Overview({ stores, setStoreId }) {
  const st = useAsync(() => api.get('/overview'), []);
  return html`<div class="stack-lg">
    <${PageHead} title="Tổng quan chuỗi" sub=${st.data ? `Hôm nay, ${fmt.dateFull(st.data.date)}` : ' '}>
      <button class="btn sm line" onClick=${st.reload} disabled=${st.loading}><${Icon} name="refresh" size=${18}/>Làm mới</button><//>
    <${Async} state=${st}>${(d) => {
      const al = d.alerts, warns = [];
      for (const s of al.stalePos) warns.push(html`<${Banner} key=${s.id} title=${`Dữ liệu Dsmart POS của ${s.name} đang chậm`}>Lần đồng bộ cuối cách đây ${s.lag} phút (ngưỡng cảnh báo ${s.limit} phút).<//>`);
      if (al.pendingInvoices > 0) warns.push(html`<${Banner} key="inv" icon="receipt" title=${`${al.pendingInvoices} hóa đơn điện tử đang treo`}>Vào mục Tích hợp để thử xuất lại.<//>`);
      if (al.held > 0) warns.push(html`<${Banner} key="held" tone="err" title=${`${al.held} ca đang chờ quản lý xử lý`}>Khách đang chờ ở cổng. Mở chi nhánh để cho qua hoặc từ chối.<//>`);
      return html`
      <div class="tiles">
        <${Tile} k="Giao dịch hôm nay" v=${fmt.num(d.tiles.transactions)}/>
        <${Tile} k="Doanh thu hôm nay" v=${fmt.money(d.tiles.revenue)}/>
        <${Tile} k="Tỷ lệ chênh lệch" v=${fmt.pct(d.tiles.mismatchRate)}/>
        <${Tile} k="Chi nhánh đang bật" v=${`${d.tiles.enabledStores}/${d.tiles.totalStores}`}/>
      </div>
      ${warns.length > 0 && html`<div class="stack">${warns}</div>`}
      <div class="card"><h2>Doanh thu 7 ngày</h2>
        <${BarChart} data=${d.revenue7.map((x) => ({ label: dm(x.date), value: x.revenue, hl: x.date === d.date }))} title="Doanh thu 7 ngày gần nhất"/></div>
      <div class="card"><h2>Chi nhánh</h2>
        <div class="tblwrap"><table class="tbl"><thead><tr><th>Chi nhánh</th><th>Trạng thái</th><th class="r">Giao dịch</th><th class="r">Doanh thu</th><th class="r">Tỷ lệ lệch</th><th>Độ trễ Dsmart POS</th></tr></thead>
          <tbody>${d.stores.map((s) => html`<tr class="click" key=${s.id} tabindex="0" onClick=${() => { setStoreId(s.id); go('/today'); }} onKeyDown=${(e) => e.key === 'Enter' && (setStoreId(s.id), go('/today'))}>
            <td><b>${s.name}</b><div class="sub">${s.id}</div>${(isPos(cfgOf(stores, s.id)) || noGuard(cfgOf(stores, s.id))) && html`<div class="tags">${isPos(cfgOf(stores, s.id)) && html`<span class="tag">Dsmart POS</span>`}${noGuard(cfgOf(stores, s.id)) && html`<span class="tag warn">Không bảo vệ</span>`}</div>`}</td>
            <td>${s.enabled ? html`<${Pill} tone="ok">Đang bật<//>` : html`<${Pill}>Đang tắt<//>`}</td>
            <td class="r">${fmt.num(s.tx)}</td><td class="r">${fmt.money(s.revenue)}</td>
            <td class="r">${s.mismatchRate == null ? '–' : fmt.pct(s.mismatchRate)}</td>
            <td>${s.posLagMinutes == null ? html`<${Pill}>Chưa đồng bộ<//>` : s.posStale ? html`<${Pill} tone="warn">Chậm ${s.posLagMinutes} phút<//>` : html`<span>${s.posLagMinutes} phút</span>`}</td></tr>`)}</tbody></table></div>
        <div class="hint">Bấm vào một dòng để xem chi tiết chi nhánh đó.</div></div>`;
    }}<//></div>`;
}

// ============================== A02 Chi nhánh & tính năng ==============================
function GateQr({ s, onClose }) {
  const url = `${location.origin}/c/?s=${s.id}`;
  return html`<${Sheet} center onClose=${onClose}>
    <h2>Mã QR dán ở cổng vào</h2>
    <p class="muted">Khách quét mã này bằng camera điện thoại để mở Scan & Go đúng chi nhánh <b>${s.name}</b>.</p>
    <div class="qrbox qrbig"><${QR} text=${url} label=${`Mã QR vào chi nhánh ${s.name}`}/><div class="code">${s.id}</div></div>
    <div class="field"><label>Đường dẫn</label><input class="input" readonly value=${url} onFocus=${(e) => e.target.select()} aria-label="Đường dẫn chi nhánh"/></div>
    <div class="grid2"><button class="btn line" onClick=${() => copyText(url)}><${Icon} name="copy"/>Sao chép link</button><button class="btn primary" onClick=${() => window.print()}><${Icon} name="doc"/>In</button></div>
    <button class="btn txt" onClick=${onClose}>Đóng</button>
    <div class="print-only"><h1>${s.name}</h1><${QR} text=${url} label="Mã QR"/><p>Quét mã để mua sắm tự phục vụ · ${s.id}</p></div>
  <//>`;
}

function AddStore({ onClose, onDone }) {
  const [f, setF] = useState({ id: '', name: '', address: '', posCode: '' });
  const [busy, run] = useBusy();
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: k === 'id' ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') : e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!f.id) return setErr('Nhập mã chi nhánh (1–6 chữ hoặc số)');
    if (!f.name.trim()) return setErr('Nhập tên chi nhánh');
    const r = await run(async () => { try { return await api.post('/stores', f); } catch (x) { setErr(x.message); throw x; } }, 'Đã thêm chi nhánh');
    if (r) { onDone(); onClose(); }
  };
  return html`<${Sheet} center onClose=${onClose}><form class="stack" onSubmit=${submit}>
    <h2>Thêm chi nhánh</h2>
    <${Field} label="Mã chi nhánh" hint="1–6 chữ hoa hoặc số, dùng trong đường dẫn và mã giỏ hàng"><input class="input" maxlength="6" value=${f.id} onInput=${set('id')} autofocus aria-label="Mã chi nhánh"/><//>
    <${Field} label="Tên chi nhánh"><input class="input" value=${f.name} onInput=${set('name')} aria-label="Tên chi nhánh"/><//>
    <${Field} label="Địa chỉ"><input class="input" value=${f.address} onInput=${set('address')} aria-label="Địa chỉ"/><//>
    <${Field} label="Mã điểm (hệ thống giá/POS)" hint="Mã của siêu thị này trong hệ thống giá, để gọi đúng cửa hàng. Bắt buộc phải có trước khi bật chi nhánh. Có thể nhập sau ở mục Tích hợp"><input class="input" maxlength="40" value=${f.posCode} onInput=${set('posCode')} aria-label="Mã điểm"/><//>
    ${err && html`<div class="errtext" role="alert">${err}</div>`}
    <p class="hint">Chi nhánh mới ở trạng thái tắt. Hãy nhập thông tin thanh toán, đồng bộ Dsmart POS rồi mới bật.</p>
    <button class="btn primary" type="submit" disabled=${busy}>${busy ? html`<${Spinner} sm/>` : 'Thêm chi nhánh'}</button>
    <button class="btn txt" type="button" onClick=${onClose}>Hủy</button></form><//>`;
}

const ST_STATUS = { new: ['Sẽ thêm', 'ok'], update: ['Sẽ cập nhật', 'ok'], same: ['Không đổi', ''], bad: ['Dòng sai', 'err'], dup: ['Lặp trong file', 'err'], clash: ['Trùng mã điểm', 'err'] };
const downloadCsv = (r) => saveBlob(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }), r.filename);

// ---- Nhập chi nhánh từ file CSV: chọn file, xem trước, áp dụng ----
function ImportStores({ onClose, onDone }) {
  const [text, setText] = useState('');
  const [fname, setFname] = useState('');
  const [pv, setPv] = useState(null);
  const [err, setErr] = useState('');
  const [busy, run] = useBusy();
  const pick = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setErr(''); setPv(null); setFname(file.name);
    try {
      const t = await file.text(); setText(t);
      await run(async () => { try { setPv(await api.post('/stores/import/preview', { text: t })); } catch (x) { setErr(x.message); throw x; } });
    } catch (x) { setErr(x.message || 'Không đọc được file'); }
  };
  const apply = async () => {
    const r = await run(async () => { try { return await api.post('/stores/import/apply', { text }); } catch (x) { setErr(x.message); throw x; } }, null);
    if (r) { toast(`Đã thêm ${r.created}, cập nhật ${r.updated} chi nhánh`, 'ok'); onDone(); onClose(); }
  };
  const sm = pv?.summary;
  return html`<${Sheet} center wide onClose=${onClose}><div class="stack">
    <h2>Nhập chi nhánh từ file</h2>
    <p class="small muted">File CSV (UTF-8, Excel lưu được) có các cột: Mã chi nhánh, Tên chi nhánh, Địa chỉ, Mã điểm. Mã chi nhánh chưa có thì thêm mới (ở trạng thái tắt), đã có thì cập nhật tên, địa chỉ, mã điểm; ô để trống thì giữ nguyên. Chưa có file thì bấm "Tải file mẫu".</p>
    <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" onChange=${pick} aria-label="Chọn file chi nhánh"/>${fname && html`<span class="small muted">${fname}</span>`}
    ${err && html`<div class="errtext" role="alert">${err}</div>`}
    ${pv && html`<div class="small">Đọc ${sm.total} dòng: ${['new', 'update', 'same', 'bad', 'dup', 'clash'].filter((k) => sm[k]).map((k) => `${sm[k]} ${ST_STATUS[k][0].toLowerCase()}`).join(', ')}.</div>
      <div class="tblwrap" style="max-height:280px;overflow:auto"><table class="tbl"><thead><tr><th>Dòng</th><th>Mã</th><th>Tên</th><th>Mã điểm</th><th>Kết quả</th></tr></thead>
        <tbody>${pv.rows.slice(0, 300).map((r) => html`<tr key=${r.line}><td>${r.line}</td><td><b>${r.id || '–'}</b></td><td>${r.name ?? r.storeName ?? '–'}</td><td>${r.posCode || '–'}</td>
          <td><${Pill} tone=${ST_STATUS[r.status][1]}>${ST_STATUS[r.status][0]}<//>${r.note ? html` <span class="xs muted">${r.note}</span>` : ''}</td></tr>`)}</tbody></table></div>
      ${pv.rows.length > 300 && html`<div class="xs muted">Chỉ hiện 300 dòng đầu, khi áp dụng sẽ xử lý toàn bộ file.</div>`}
      <button class="btn primary" disabled=${busy || !(sm.new || sm.update)} onClick=${apply}>${busy ? html`<${Spinner} sm/>` : `Áp dụng: thêm ${sm.new || 0}, cập nhật ${sm.update || 0}`}</button>
      ${(sm.bad || sm.dup || sm.clash) ? html`<div class="xs muted">Dòng sai, lặp hoặc trùng mã điểm sẽ được bỏ qua.</div>` : ''}`}
    <button class="btn txt" type="button" onClick=${onClose}>Đóng</button></div><//>`;
}

export function Stores({ me, reloadStores, setStoreId }) {
  const chain = me.role === 'chain_admin';
  const st = useAsync(() => api.get('/stores'), []);
  const [busyKey, setBusyKey] = useState('');
  const [msg, setMsg] = useState(null); // { code, message, store }
  const [qr, setQr] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [compact, setCompactRaw] = useState(() => { try { return localStorage.getItem('brg_a_compact') !== '0'; } catch { return true; } }); // mặc định thu gọn
  const setCompact = (v) => { setCompactRaw(v); try { localStorage.setItem('brg_a_compact', v ? '1' : '0'); } catch { /* bỏ qua */ } };
  const [q, setQ] = useState('');
  const [ask, setAsk] = useState(null); // { kind: 'source'|'guard', s, value }
  const refresh = async () => { await st.reload(); reloadStores(); };
  const file = async (path) => { try { downloadCsv(await api.get(path)); } catch (x) { toast(x.message || 'Không tải được file', 'err'); } };
  const toggle = async (key, path, body, okMsg = 'Đã lưu') => {
    if (busyKey) return false;
    setBusyKey(key); setMsg(null);
    try { await api.put(path, body); toast(okMsg, 'ok'); await refresh(); return true; }
    catch (e) { setMsg({ code: e.code, message: e.message }); toast(e.message, 'err'); return false; }
    finally { setBusyKey(''); }
  };
  const confirmAsk = async () => {
    const a = ask;
    const path = `/stores/${a.s.id}/config`;
    const ok = a.kind === 'source' ? await toggle(`${a.s.id}src`, path, { paymentSource: a.value }, a.value === 'pos' ? 'Đã chuyển sang thu tiền qua Dsmart POS' : 'Đã chuyển về tự thu trong BRG')
      : await toggle(`${a.s.id}guard`, path, { guardCheck: a.value }, a.value ? 'Đã bật bảo vệ cổng ra' : 'Đã tắt bảo vệ cổng ra');
    setAsk(null);
    return ok;
  };
  const onGuard = (s, v) => {
    if (!v) return setAsk({ kind: 'guard', s, value: false });
    toggle(`${s.id}guard`, `/stores/${s.id}/config`, { guardCheck: true }, 'Đã bật bảo vệ cổng ra. Áp dụng cho các giao dịch mới.');
  };
  return html`<div class="stack-lg">
    <${PageHead} title="Chi nhánh & tính năng" sub=${chain ? 'Bật hoặc tắt Scan & Checkout, cách thu tiền, bảo vệ cổng ra và từng cách thanh toán cho từng chi nhánh. Thay đổi có hiệu lực ngay.' : 'Cấu hình hiện tại của chi nhánh. Chỉ quản trị chuỗi mới được thay đổi.'}>
      ${chain && html`<button class="btn sm line" onClick=${() => setImporting(true)}>Nhập file</button>
      <button class="btn sm line" onClick=${() => file('/stores/export')}>Xuất file</button>
      <button class="btn sm line" onClick=${() => file('/stores/template')}>Tải file mẫu</button>
      <button class="btn sm primary" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${18}/>Thêm chi nhánh</button>`}<//>
    ${!chain && html`<${Banner} tone="info" icon="lock" title="Chỉ xem">Các nút bên dưới bị khóa. Hãy nhờ quản trị chuỗi nếu cần đổi cách thu tiền hoặc bảo vệ cổng ra.<//>`}
    ${msg && html`<${Banner} tone="err" title="Chưa lưu được"><span role="alert">${msg.message}</span>
      ${msg.code === 'NO_POS_KEY' && html`<div style="margin-top:8px"><button class="btn sm line" onClick=${() => go('/integrations')}><${Icon} name="link" size=${18}/>Đi tới mục Tích hợp để tạo khóa</button></div>`}
      ${msg.code === 'CARTS_PENDING' && html`<div style="margin-top:8px"><button class="btn sm line" onClick=${() => { if (msg.storeId) setStoreId(msg.storeId); go('/transactions'); }}>Xem giao dịch</button></div>`}<//>`}
    <${Async} state=${st}>${(d) => html`<div class="card">
      <div class="toolbar" style="margin-bottom:10px"><input class="input sm grow" style="max-width:340px;min-width:min(240px,100%);flex:1 1 240px" type="search" placeholder="Tìm chi nhánh theo tên, mã, địa chỉ, mã điểm" aria-label="Tìm chi nhánh" value=${q} onInput=${(e) => setQ(e.target.value)}/>
        <span class="small muted">${(() => { const n = q.trim() ? d.stores.filter((s) => `${s.name} ${s.id} ${s.address || ''} ${s.posCode || ''}`.toLowerCase().includes(q.trim().toLowerCase())).length : d.stores.length; return `${n}/${d.stores.length} chi nhánh`; })()}</span>
        <span class="grow"></span><label class="row small" style="gap:8px"><${Switch} checked=${compact} label="Thu gọn bảng" onChange=${setCompact}/>Thu gọn</label></div>
      <div class="tblwrap"><table class=${`tbl ${compact ? 'compact' : ''}`}>
      <thead><tr><th>Chi nhánh</th><th class="tc">Scan & Checkout</th><th class="tc">Giỏ QR cho Dsmart POS</th><th>Thu tiền</th><th class="tc">Tiền mặt</th><th class="tc">Chuyển khoản QR</th><th class="tc">Bảo vệ cổng ra</th><th class="tc col-online">Online</th></tr></thead>
      <tbody>${(q.trim() ? d.stores.filter((s) => `${s.name} ${s.id} ${s.address || ''} ${s.posCode || ''}`.toLowerCase().includes(q.trim().toLowerCase())) : d.stores).map((s) => {
        const basket = s.config.checkoutMode === 'basket'; // giỏ QR: Dsmart POS thu tiền, không bảo vệ; các luồng cũ bị khóa
        const pos = isPos(s.config) || basket;
        const dis = !chain || !!busyKey;
        const sw = (key, checked, path, body, label, extra = {}) => html`<${Switch} checked=${checked} disabled=${dis || extra.off} label=${`${label} ${s.name}`} onChange=${(v) => toggle(`${s.id}${key}`, path, body(v))}/>`;
        const mute = (node) => (pos ? html`<span class="soon">${node}<span class="soonlbl">Dùng Dsmart POS</span></span>` : node);
        return html`<tr key=${s.id}><td><div class="storecell"><div class="grow"><b>${s.name}</b><div class="sub">${s.id}${s.posCode ? ` · ${s.posCode}` : ''}${compact ? '' : ` · ${s.address || 'Chưa có địa chỉ'}`}</div></div>
            <button class="btn sm line qrbtn" onClick=${() => setQr(s)} title="Mã QR dán cổng vào" aria-label=${`Mã QR dán cổng vào ${s.name}`}><${Icon} name="qr" size=${18}/><span class="qrlbl">Mã QR</span></button></div></td>
          <td class="tc">${sw('e', s.enabled, `/stores/${s.id}`, (v) => ({ enabled: v }), 'Bật Scan & Checkout')}</td>
          <td class="tc">${sw('m', basket, `/stores/${s.id}/config`, (v) => ({ checkoutMode: v ? 'basket' : 'classic' }), 'Giỏ QR cho Dsmart POS')}</td>
          <td><select class="input sm" style="width:auto;min-width:175px" value=${basket ? 'pos' : (s.config.paymentSource || 'manual')} disabled=${dis || basket} aria-label=${`Thu tiền ${s.name}`}
            onChange=${(e) => { const v = e.target.value; e.target.value = s.config.paymentSource || 'manual'; if (v !== (s.config.paymentSource || 'manual')) { setMsg(null); setAsk({ kind: 'source', s, value: v }); } }}>
            ${Object.entries(PAY_SOURCE).map(([k, l]) => html`<option value=${k} key=${k}>${l}</option>`)}</select>
            ${!chain && html`<div class="xs muted" style="margin-top:4px"><${Icon} name="lock" size=${12}/> Chỉ quản trị chuỗi đổi</div>`}</td>
          <td class="tc">${mute(sw('c', s.config.payCash, `/stores/${s.id}/config`, (v) => ({ payCash: v }), 'Tiền mặt', { off: pos }))}</td>
          <td class="tc">${mute(sw('q', s.config.payQr, `/stores/${s.id}/config`, (v) => ({ payQr: v }), 'Chuyển khoản QR', { off: pos }))}</td>
          <td class="tc"><${Switch} checked=${!basket && s.config.guardCheck !== false} disabled=${dis || basket} label=${`Bảo vệ cổng ra ${s.name}`} onChange=${(v) => onGuard(s, v)}/></td>
          <td class="tc col-online"><span class="soon"><${Switch} checked=${false} disabled=${true} label=${`Thanh toán online ${s.name}`} onChange=${() => {}}/><span class="soonlbl">Sắp có</span></span></td></tr>`;
      })}</tbody></table></div>
      <div class="hint"><b>Giỏ QR cho Dsmart POS</b> (đang dùng): khách bấm thanh toán, điện thoại hiện mã QR ngắn (mã điểm và mã giỏ), thu ngân quét vào Dsmart POS, Dsmart POS lấy danh sách mặt hàng bằng API. Dsmart POS tạo đơn, tính tiền, thu tiền. Các cột bên phải (thu tiền trong BRG, bảo vệ cổng ra) bị khóa và dùng lại được nếu tắt chế độ này.</div>
      <div class="hint">Chi nhánh chỉ bật được khi có ít nhất một cách thanh toán dùng được và đã có dữ liệu sản phẩm từ Dsmart POS. Đổi cách thu tiền cần có khóa API cho Dsmart POS (mục Tích hợp) và không còn giỏ chờ thu.</div></div>`}<//>
    ${ask && ask.kind === 'source' && html`<${Confirm} title=${ask.value === 'pos' ? `Chuyển ${ask.s.name} sang thu tiền qua Dsmart POS?` : `Chuyển ${ask.s.name} về tự thu trong BRG?`}
      text=${ask.value === 'pos' ? 'Khách chọn "Thanh toán tại quầy" và nhận mã giỏ hàng. Thu ngân quét mã trong phần mềm Dsmart POS, thu tiền trên Dsmart POS (QR, tiền mặt, hóa đơn điện tử do Dsmart POS xuất). Dsmart POS báo về BRG và BRG tự xác nhận. Tiền mặt và chuyển khoản QR trong BRG tạm dừng.' : 'Khách chọn tiền mặt hoặc chuyển khoản QR, thu ngân xác nhận thu tiền trong ứng dụng thu ngân của BRG. Dsmart POS không còn nhận giỏ hàng nữa.'}
      ok=${ask.value === 'pos' ? 'Chuyển sang Dsmart POS' : 'Chuyển về BRG'} cancel="Giữ nguyên" busy=${!!busyKey} onOk=${confirmAsk} onCancel=${() => setAsk(null)}/>`}
    ${ask && ask.kind === 'guard' && html`<${Confirm} title=${`Tắt bảo vệ cổng ra ở ${ask.s.name}?`} danger ok="Tắt bảo vệ" cancel="Giữ bật" busy=${!!busyKey} onOk=${confirmAsk} onCancel=${() => setAsk(null)}>
      <ul class="bullets"><li>Không còn mã QR ra cổng và không kiểm tra ngẫu nhiên.</li><li>Thu tiền xong, khách ra luôn.</li><li>Khách đã thanh toán mà chưa ra cổng được coi như đã ra.</li></ul>
      <p class="small muted">Bật lại sau này sẽ chỉ áp dụng cho các giao dịch mới.</p><//>`}
    ${qr && html`<${GateQr} s=${qr} onClose=${() => setQr(null)}/>`}
    ${adding && html`<${AddStore} onClose=${() => setAdding(false)} onDone=${refresh}/>`}
    ${importing && html`<${ImportStores} onClose=${() => setImporting(false)} onDone=${refresh}/>`}
  </div>`;
}

// ============================== A03 Tích hợp ==============================
function PosCard({ d, reload }) {
  const [busy, run] = useBusy();
  const [vals, setVals] = useState({});
  const [codes, setCodes] = useState({});
  const sync = (id) => run(async () => { const r = await api.post('/integrations/pos/sync', id ? { storeId: id } : {}); await reload(); return r; }, id ? 'Đã đồng bộ Dsmart POS' : 'Đã đồng bộ tất cả chi nhánh');
  const saveCode = (s) => run(async () => { await api.put(`/stores/${s.id}`, { posCode: (codes[s.id] ?? '').trim() }); await reload(); }, 'Đã lưu mã điểm');
  const saveLimit = (s) => run(async () => { await api.put(`/stores/${s.id}/config`, { posStaleMinutes: Number(vals[s.id]) }); await reload(); }, 'Đã lưu ngưỡng cảnh báo');
  return html`<div class="card">
    <div class="cardhead"><div class="ico-tile"><${Icon} name="barcode"/></div><div class="grow"><h2>Dsmart POS (giá & tồn kho)</h2>
      <div class="small muted">Nguồn giá: ${d.pos.adapter === 'mock' ? (d.isProd ? 'bảng giá nhập bằng file CSV' : 'Dsmart POS giả lập') : d.pos.adapter}</div></div>
      <${Pill} tone="ok"><span class="dot"></span>Đã kết nối<//>
      <button class="btn sm primary" disabled=${busy} onClick=${() => sync(null)}><${Icon} name="refresh" size=${18}/>Đồng bộ tất cả</button></div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Chi nhánh</th><th>Mã điểm (hệ thống giá)</th><th>Đồng bộ gần nhất</th><th>Độ trễ</th><th>Ngưỡng cảnh báo (phút)</th><th class="r">Mã vạch không khớp (24 giờ)</th><th></th></tr></thead>
      <tbody>${d.pos.stores.map((s) => {
        const v = vals[s.id] ?? s.staleLimit;
        const code = codes[s.id] ?? s.posCode ?? '';
        return html`<tr key=${s.id}><td><b>${s.name}</b><div class="sub">${s.id}</div></td>
          <td><div class="row"><input class="input sm" maxlength="40" value=${code} placeholder="Chưa nhập" aria-label=${`Mã điểm ${s.name}`} onInput=${(e) => setCodes({ ...codes, [s.id]: e.target.value })}/>
            <button class="btn sm line" disabled=${busy || code.trim() === (s.posCode || '')} onClick=${() => saveCode(s)}>Lưu</button></div></td>
          <td>${s.lastSync ? fmt.when(s.lastSync) : 'Chưa đồng bộ'}</td>
          <td>${s.lagMinutes == null ? '–' : s.stale ? html`<${Pill} tone="warn">Chậm ${s.lagMinutes} phút<//>` : `${s.lagMinutes} phút`}</td>
          <td><div class="row"><input class="input sm num-in" type="number" min="1" max="1440" value=${v} aria-label=${`Ngưỡng cảnh báo ${s.name}`} onInput=${(e) => setVals({ ...vals, [s.id]: e.target.value })}/>
            <button class="btn sm line" disabled=${busy || Number(v) === s.staleLimit} onClick=${() => saveLimit(s)}>Lưu</button></div></td>
          <td class="r">${s.unknownBarcodes}</td>
          <td><button class="btn sm soft" disabled=${busy} onClick=${() => sync(s.id)} aria-label=${`Đồng bộ ngay ${s.name}`}>Đồng bộ ngay</button></td></tr>`;
      })}</tbody></table></div></div>`;
}

function TransferCard({ stores }) {
  const [id, setId] = useState(stores[0]?.id || '');
  const st = useAsync(() => api.get('/stores'), []);
  const s = st.data?.stores.find((x) => x.id === id);
  const [f, setF] = useState(null);
  const [busy, run] = useBusy();
  const [err, setErr] = useState('');
  useEffect(() => { if (s) setF({ bin: s.config.bank.bin || '', name: s.config.bank.name || '', account: s.config.bank.account || '', holder: s.config.bank.holder || '' }); setErr(''); }, [id, st.data]);
  const set = (k, digits) => (e) => setF({ ...f, [k]: digits ? e.target.value.replace(/\D/g, '') : e.target.value });
  const save = async (e) => {
    e.preventDefault(); setErr('');
    if (f.bin && !/^\d{6}$/.test(f.bin)) return setErr('Mã ngân hàng (BIN) gồm đúng 6 chữ số');
    if (f.account && !/^\d{4,19}$/.test(f.account)) return setErr('Số tài khoản gồm 4–19 chữ số');
    const r = await run(async () => { try { await api.put(`/stores/${id}/config`, { bank: f }); } catch (x) { setErr(x.message); throw x; } await st.reload(); }, 'Đã lưu thông tin ngân hàng');
    return r;
  };
  return html`<div class="card">
    <div class="cardhead"><div class="ico-tile green"><${Icon} name="qr"/></div><div class="grow"><h2>Chuyển khoản QR</h2><div class="small muted">Tài khoản nhận tiền hiển thị cho khách và nhân viên đối chiếu</div></div></div>
    <div class="stack">
      <div class="label">Cách tạo QR chuyển khoản</div>
      <div class="option on" role="radio" aria-checked="true"><${Icon} name="qr"/><div class="grow"><div class="b">App tự tạo</div><div class="small muted">Dựng mã VietQR từ tài khoản bên dưới. Đang sử dụng.</div></div><span class="radio"></span></div>
      <div class="option off" role="radio" aria-checked="false" aria-disabled="true"><${Icon} name="link"/><div class="grow"><div class="b">Lấy từ nhà cung cấp</div><div class="small muted">Chưa cấu hình nhà cung cấp nên chưa chọn được.</div></div><span class="radio"></span></div>
    </div>
    <hr class="divider"/>
    <div class="toolbar"><div class="field grow"><label for="tf-store">Chi nhánh</label><select id="tf-store" class="input" value=${id} onChange=${(e) => setId(e.target.value)}>${stores.map((x) => html`<option value=${x.id} key=${x.id}>${x.name}</option>`)}</select></div></div>
    ${!f ? html`<${Spinner}/>` : html`<form class="stack" onSubmit=${save}><div class="formgrid c2">
      <${Field} label="Mã ngân hàng (BIN, 6 số)" hint=${BIN_NOTE}><input class="input" inputmode="numeric" maxlength="6" value=${f.bin} onInput=${set('bin', true)} aria-label="Mã ngân hàng BIN"/><//>
      <${Field} label="Tên ngân hàng"><input class="input" value=${f.name} onInput=${set('name')} aria-label="Tên ngân hàng"/><//>
      <${Field} label="Số tài khoản"><input class="input" inputmode="numeric" maxlength="19" value=${f.account} onInput=${set('account', true)} aria-label="Số tài khoản"/><//>
      <${Field} label="Chủ tài khoản" hint="Viết hoa, không dấu như trên ngân hàng"><input class="input" value=${f.holder} onInput=${set('holder')} aria-label="Chủ tài khoản"/><//></div>
      ${err && html`<div class="errtext" role="alert">${err}</div>`}
      <div class="row"><button class="btn primary auto" type="submit" disabled=${busy}>${busy ? html`<${Spinner} sm/>` : 'Lưu thông tin ngân hàng'}</button></div>
      <div class="hint">Khách sẽ thấy: ${f.name || 'Ngân hàng'} · ${f.account || 'số tài khoản'} · ${f.holder || 'chủ tài khoản'}. Mã QR được dựng theo từng giỏ hàng khi khách chọn chuyển khoản.</div></form>`}
  </div>`;
}

function InvoiceCard({ d, reload }) {
  const [busy, run] = useBusy();
  const retry = () => run(async () => { const r = await api.post('/integrations/invoices/retry'); await reload(); toast(r.tried ? `Đã thử ${r.tried} hóa đơn, xuất được ${r.issued}` : 'Không có hóa đơn nào đang treo', 'ok'); }, null);
  return html`<div class="card">
    <div class="cardhead"><div class="ico-tile"><${Icon} name="receipt"/></div><div class="grow"><h2>Hóa đơn điện tử</h2><div class="small muted">Nhà cung cấp: ${d.einvoice.provider === 'mock' ? 'Giả lập (chưa nối nhà cung cấp thật)' : d.einvoice.provider}</div></div>
      ${d.einvoice.configured ? html`<${Pill} tone="ok">Đã cấu hình<//>` : html`<${Pill} tone="warn">Bản giả lập<//>`}</div>
    <div class="grid2"><${Tile} k="Đã xuất" v=${fmt.num(d.einvoice.issued)}/><${Tile} k="Đang treo" v=${fmt.num(d.einvoice.pending)} tone=${d.einvoice.pending ? 'warn' : ''}/></div>
    <div class="row"><button class="btn line auto" disabled=${busy || !d.einvoice.pending} onClick=${retry}>${busy ? html`<${Spinner} sm/>` : html`<${Icon} name="refresh" size=${18}/>Thử lại hóa đơn treo`}</button></div>
  </div>`;
}

function NewKey({ stores, onClose, onDone }) {
  const [name, setName] = useState('');
  const [sid, setSid] = useState('');
  const [err, setErr] = useState('');
  const [made, setMade] = useState(null);
  const [busy, run] = useBusy();
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!name.trim()) return setErr('Đặt tên cho khóa (ví dụ tên phần mềm Dsmart POS)');
    const r = await run(async () => { try { return await api.post('/pos/keys', { name: name.trim(), storeId: sid || undefined }); } catch (x) { setErr(x.message); throw x; } }, null);
    if (r) { setMade(r); onDone(); }
  };
  if (made) return html`<${Sheet} center><div class="stack">
    <h2>Khóa API đã tạo</h2>
    <${Banner} tone="" title="Khóa chỉ hiện một lần">Hãy sao chép và gửi cho nhà cung cấp Dsmart POS ngay. Đóng hộp này là không xem lại được; nếu mất, hãy thu hồi và tạo khóa mới.<//>
    <div class="secret" id="new-key" aria-label="Khóa API đầy đủ">${made.key}</div>
    <button class="btn line" onClick=${() => copyText(made.key)}><${Icon} name="copy"/>Sao chép khóa</button>
    <button class="btn primary" onClick=${onClose}>Tôi đã lưu khóa</button></div><//>`;
  return html`<${Sheet} center onClose=${onClose}><form class="stack" onSubmit=${submit}>
    <h2>Tạo khóa API cho Dsmart POS</h2>
    <${Field} label="Tên khóa" hint="Ví dụ: KiotViet quầy Q7"><input class="input" value=${name} maxlength="60" onInput=${(e) => setName(e.target.value)} autofocus aria-label="Tên khóa"/><//>
    <${Field} label="Phạm vi" hint="Khóa theo chi nhánh chỉ nhận được giỏ hàng của chi nhánh đó"><select class="input" value=${sid} onChange=${(e) => setSid(e.target.value)} aria-label="Phạm vi khóa"><option value="">Tất cả chi nhánh</option>${stores.map((s) => html`<option value=${s.id} key=${s.id}>${s.name}</option>`)}</select><//>
    ${!sid && html`<${Banner} tone="warn" icon="alert" title="Khóa dùng cho mọi chi nhánh">Nếu khóa này bị lộ, người khác báo thanh toán được cho bất kỳ cửa hàng nào. Nên tạo mỗi chi nhánh một khóa riêng (chọn chi nhánh ở mục Phạm vi).<//>`}
    ${err && html`<div class="errtext" role="alert">${err}</div>`}
    <button class="btn primary" type="submit" disabled=${busy}>${busy ? html`<${Spinner} sm/>` : 'Tạo khóa'}</button>
    <button class="btn txt" type="button" onClick=${onClose}>Hủy</button></form><//>`;
}

function PosApiCard({ d, stores, reload }) {
  const keys = useAsync(() => api.get('/pos/keys'), []);
  const guides = useAsync(() => api.get('/guides').catch(() => ({ guides: [] })), []);
  const [adding, setAdding] = useState(false);
  const [revoke, setRevoke] = useState(null);
  const [busy, run] = useBusy();
  const base = `${location.origin}/api/pos/v1`;
  const a = d.posApi || { keys: 0, last24h: {} };
  const t = a.last24h || {};
  const hasGuide = (guides.data?.guides || []).some((g) => g.id === '13-ket-noi-pos');
  const sname = (id) => (id ? stores.find((x) => x.id === id)?.name || id : 'Tất cả chi nhánh');
  const doRevoke = async () => { const r = await run(async () => { // api.del của thư viện chung gửi Content-Type json với thân rỗng nên Fastify từ chối (400); gọi trực tiếp không kèm Content-Type.
      const res = await fetch(`/api/a/pos/keys/${revoke.id}`, { method: 'DELETE', headers: S.token ? { Authorization: `Bearer ${S.token}` } : {} });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Không thu hồi được khóa'); await keys.reload(); await reload(); }, 'Đã thu hồi khóa'); if (r) setRevoke(null); };
  return html`<div class="card" id="pos-api">
    <div class="cardhead"><div class="ico-tile green"><${Icon} name="link"/></div><div class="grow"><h2>Dsmart POS gọi vào BRG</h2>
      <div class="small muted">Phần mềm Dsmart POS dùng khóa API để nhận giỏ hàng, báo đã thanh toán hoặc báo hủy. BRG tự xác nhận khi Dsmart POS báo.</div></div>
      <button class="btn sm primary" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${18}/>Tạo khóa</button></div>
    <div class="field"><label for="pos-base">Địa chỉ API cơ sở</label><div class="row"><input id="pos-base" class="input grow" readonly value=${base} onFocus=${(e) => e.target.select()}/>
      <button class="btn sm line" onClick=${() => copyText(base)} aria-label="Sao chép địa chỉ API"><${Icon} name="copy" size=${18}/>Sao chép</button></div></div>
    <div class="tiles">
      <${Tile} k="Đã nhận giỏ (24 giờ)" v=${fmt.num(t.claimed)}/><${Tile} k="Đã thanh toán" v=${fmt.num(t.paid)}/><${Tile} k="Đã hủy" v=${fmt.num(t.cancelled)}/>
      <${Tile} k="Lệch tiền" v=${fmt.num(t.differs)} tone=${t.differs ? 'err' : ''}/><${Tile} k="Đang chờ thanh toán" v=${fmt.num(t.waiting)} tone=${t.waiting ? 'warn' : ''}/></div>
    <${Async} state=${keys}>${(k) => k.keys.length === 0 ? html`<div class="muted">Chưa có khóa API nào. Bấm "Tạo khóa" để cấp cho nhà cung cấp Dsmart POS.</div>` : html`
      <div class="tblwrap"><table class="tbl"><thead><tr><th>Tên</th><th>Tiền tố khóa</th><th>Phạm vi</th><th>Dùng gần nhất</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>${k.keys.map((x) => html`<tr key=${x.id} class=${x.active ? '' : 'dim'}><td><b>${x.name}</b><div class="sub">Tạo ${fmt.when(x.createdAt)}${x.createdBy ? ` · ${x.createdBy}` : ''}</div></td>
          <td><code>${x.prefix}…</code></td><td>${sname(x.storeId)}</td><td>${x.lastUsedAt ? fmt.when(x.lastUsedAt) : 'Chưa dùng'}</td>
          <td>${x.active ? html`<${Pill} tone="ok">Đang dùng<//>` : html`<${Pill}>Đã thu hồi<//>`}</td>
          <td>${x.active && html`<button class="btn sm danger-line" onClick=${() => setRevoke(x)} aria-label=${`Thu hồi khóa ${x.name}`}>Thu hồi</button>`}</td></tr>`)}</tbody></table></div>`}<//>
    <div class="hint">${hasGuide ? html`Xem hướng dẫn <a href="#/huong-dan/13-ket-noi-pos">Kết nối Dsmart POS</a> trong mục Hướng dẫn hệ thống.` : 'Hướng dẫn "Kết nối Dsmart POS" sẽ có trong mục Hướng dẫn hệ thống.'} Bật chế độ thu tiền qua Dsmart POS cho từng chi nhánh ở mục Chi nhánh.</div>
    ${adding && html`<${NewKey} stores=${stores} onClose=${() => setAdding(false)} onDone=${() => { keys.reload(); reload(); }}/>`}
    ${revoke && html`<${Confirm} title="Thu hồi khóa này?" text=${`Khóa "${revoke.name}" sẽ ngừng dùng được ngay. Dsmart POS đang dùng khóa này sẽ không gọi được vào BRG nữa. Không thể hoàn tác.`} ok="Thu hồi" cancel="Giữ lại" danger busy=${busy} onOk=${doRevoke} onCancel=${() => setRevoke(null)}/>`}
  </div>`;
}

function PosLinkCard() {
  const cur = useAsync(() => api.get('/pos/links'), []);
  const [v, setV] = useState(null);
  const [busy, run] = useBusy();
  const val = v ?? cur.data?.transactionUrlTemplate ?? '';
  const save = () => run(async () => { await api.put('/pos/links', { transactionUrlTemplate: val.trim() }); await cur.reload(); setV(null); }, 'Đã lưu mẫu link');
  return html`<div class="card" id="pos-links">
    <div class="cardhead"><div class="ico-tile green"><${Icon} name="link"/></div><div class="grow"><h2>Link chi tiết giao dịch</h2>
      <div class="small muted">Dsmart POS không cần gửi link giao dịch: BRG tự dựng từ mã đơn theo mẫu dưới đây. Để trống nếu Dsmart POS tự gửi.</div></div></div>
    <${Field} label="Mẫu link (bắt buộc https và có {posOrderRef})"><input class="input" value=${val} placeholder="https://dsmart.vn/giao-dich/{posOrderRef}" onInput=${(e) => setV(e.target.value)}/><//>
    <div class="row"><button class="btn primary" disabled=${busy || v === null} onClick=${save}>Lưu</button></div>
  </div>`;
}

const SIM_METHODS = [['cash', 'Tiền mặt'], ['qr_transfer', 'Chuyển khoản QR'], ['card', 'Thẻ'], ['ewallet', 'Ví điện tử'], ['other', 'Khác']];
const newRef = () => `POS-${Date.now().toString(36).toUpperCase()}`;
function PosSimCard() {
  const [f, setF] = useState({ code: '', ref: newRef(), amount: '', method: 'cash', invoiceNo: '', cashier: 'Thu ngân thử' });
  const [res, setRes] = useState(null); // { action, ok, data }
  const [busy, run] = useBusy();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const call = (action) => run(async () => {
    const body = { action, code: f.code.trim() || undefined, ref: f.ref.trim() || undefined, cashier: f.cashier || undefined };
    if (action === 'paid') Object.assign(body, { amount: Number(f.amount), method: f.method });
    try {
      const r = await api.post('/dev/pos-simulate', body);
      setRes({ action, ok: true, data: r });
      const total = r.cart?.total ?? r.result?.total;
      if (total != null && !f.amount) setF((x) => ({ ...x, amount: String(total) }));
    } catch (x) { setRes({ action, ok: false, data: x.data && Object.keys(x.data).length ? x.data : { error: x.code, message: x.message }, message: x.message }); }
  });
  const LABEL = { preview: 'Xem trước', claim: 'Nhận giỏ', paid: 'Báo đã thanh toán', cancelled: 'Báo hủy', status: 'Hỏi trạng thái' };
  return html`<div class="card"><div class="cardhead"><div class="ico-tile warn"><${Icon} name="card"/></div><div class="grow"><h2>Giả lập Dsmart POS</h2><div class="small muted">Đóng vai phần mềm Dsmart POS gọi API của BRG (không cần khóa). Chi nhánh phải ở chế độ thu tiền qua Dsmart POS.</div></div></div>
    <div class="formgrid c2">
      <${Field} label="Mã giỏ hàng" hint="Khách thấy mã này sau khi chọn Thanh toán tại quầy"><input class="input" value=${f.code} onInput=${set('code')} placeholder="Ví dụ SG-Q7-0001" aria-label="Mã giỏ hàng"/><//>
      <${Field} label="Mã đơn Dsmart POS"><div class="row"><input class="input grow" value=${f.ref} onInput=${set('ref')} aria-label="Mã đơn Dsmart POS"/><button class="btn sm line" type="button" onClick=${() => setF({ ...f, ref: newRef() })}>Mã mới</button></div><//>
      <${Field} label="Số tiền Dsmart POS (₫)"><input class="input" type="number" min="0" value=${f.amount} onInput=${set('amount')} aria-label="Số tiền Dsmart POS"/><//>
      <${Field} label="Cách trả"><select class="input" value=${f.method} onChange=${set('method')} aria-label="Cách trả">${SIM_METHODS.map(([k, l]) => html`<option value=${k} key=${k}>${l}</option>`)}</select><//>
      <${Field} label="Thu ngân"><input class="input" value=${f.cashier} onInput=${set('cashier')} aria-label="Thu ngân Dsmart POS"/><//></div>
    <div class="row wrap">${Object.entries(LABEL).map(([k, l]) => html`<button key=${k} class=${`btn sm ${k === 'claim' || k === 'paid' ? 'primary' : 'line'} auto`} disabled=${busy} onClick=${() => call(k)}>${l}</button>`)}</div>
    ${res && html`<div class="stack" id="sim-result"><${Banner} tone=${res.ok ? 'ok' : 'err'} icon=${res.ok ? 'check' : 'alert'} title=${`${LABEL[res.action]}: ${res.ok ? 'thành công' : 'bị từ chối'}`}>${res.ok ? (res.data.duplicate ? 'Đã nhận trước đó (gọi lại cùng mã đơn).' : 'BRG đã xử lý yêu cầu.') : html`<span role="alert">${res.message}${res.data?.error ? ` (${res.data.error})` : ''}</span>`}<//>
      <pre class="jsonbox">${JSON.stringify(res.data)}</pre></div>`}</div>`;
}

function DevTools({ stores }) {
  const [id, setId] = useState(stores[0]?.id || '');
  const st = useAsync(() => api.get(`/dev/pos-products?storeId=${id}`), [id]);
  const [sku, setSku] = useState('');
  const [f, setF] = useState({ price: '', stock: '', active: true });
  const [busy, run] = useBusy();
  const list = st.data?.products || [];
  useEffect(() => { if (list.length && !list.find((p) => p.sku === sku)) setSku(list[0].sku); }, [st.data]);
  const cur = list.find((p) => p.sku === sku);
  useEffect(() => { if (cur) setF({ price: String(cur.price), stock: String(cur.stock), active: !!cur.active }); }, [sku, st.data]);
  if (st.error && !st.data && ['DEV_ONLY', 'FORBIDDEN'].includes(st.error.code || '') || st.error?.status === 403) return null;
  const apply = () => run(async () => { await api.post('/dev/pos-product', { storeId: id, sku, price: Number(f.price), stock: Number(f.stock), active: f.active, sync: true }); await st.reload(); }, 'Dsmart POS giả lập đã đổi và đồng bộ xong');
  return html`<div class="stack-lg"><div class="card"><div class="cardhead"><div class="ico-tile warn"><${Icon} name="settings"/></div><div class="grow"><h2>Công cụ thử nghiệm</h2><div class="small muted">Chỉ có ở môi trường thử: giả lập Dsmart POS đổi giá, tồn kho, ngừng bán rồi đồng bộ ngay.</div></div></div>
    <div class="formgrid c2">
      <${Field} label="Chi nhánh"><select class="input" value=${id} onChange=${(e) => setId(e.target.value)} aria-label="Chi nhánh thử nghiệm">${stores.map((x) => html`<option value=${x.id} key=${x.id}>${x.name}</option>`)}</select><//>
      <${Field} label="Sản phẩm"><select class="input" value=${sku} onChange=${(e) => setSku(e.target.value)} aria-label="Sản phẩm thử nghiệm">${list.map((p) => html`<option value=${p.sku} key=${p.sku}>${p.name}${p.active ? '' : ' (ngừng bán)'}</option>`)}</select><//>
      <${Field} label="Giá (₫)"><input class="input" type="number" min="0" value=${f.price} onInput=${(e) => setF({ ...f, price: e.target.value })} aria-label="Giá"/><//>
      <${Field} label="Tồn kho"><input class="input" type="number" min="0" value=${f.stock} onInput=${(e) => setF({ ...f, stock: e.target.value })} aria-label="Tồn kho"/><//></div>
    <div class="row"><${Switch} checked=${f.active} onChange=${(v) => setF({ ...f, active: v })} label="Đang bán"/><span>${f.active ? 'Đang bán' : 'Ngừng bán'}</span><button class="btn primary auto end" disabled=${busy || !cur} onClick=${apply}>${busy ? html`<${Spinner} sm/>` : 'Áp dụng & đồng bộ'}</button></div>
    ${cur && html`<div class="hint">Mã vạch ${cur.barcode} · mã hàng ${cur.sku}</div>`}</div><${PosSimCard}/></div>`;
}


// ---- API giá bán của đối tác: tra giá theo mã vạch khi khách quét ----
function PriceApiCard({ stores }) {
  const st = useAsync(() => api.get('/integrations/price-api'), []);
  const [f, setF] = useState(null);
  const [busy, run] = useBusy();
  const [err, setErr] = useState('');
  const [t, setT] = useState({ storeId: '', barcode: '' });
  const [res, setRes] = useState(null);
  const d = st.data;
  useEffect(() => { if (d && f === null) setF({ url: d.config.url, key: '', timeoutSec: String(d.config.timeoutSec), cacheMin: String(d.config.cacheMin), enabled: d.config.enabled }); }, [d]);
  useEffect(() => { if (stores?.length && !t.storeId) setT((x) => ({ ...x, storeId: (stores.find((x) => x.posCode) || stores[0]).id })); }, [stores]);
  if (!d || f === null) return html`<div class="card"><${Spinner}/></div>`;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (extra = {}) => run(async () => {
    setErr('');
    try { await api.put('/integrations/price-api', { url: f.url, key: f.key || undefined, timeoutSec: f.timeoutSec, cacheMin: f.cacheMin, enabled: f.enabled, ...extra }); setF(null); await st.reload(); }
    catch (x) { setErr(x.message); throw x; }
  }, 'Đã lưu cấu hình API giá');
  const test = () => run(async () => { setRes(null); setRes(await api.post('/integrations/price-api/test', { storeId: t.storeId, barcode: t.barcode })); });
  const le = d.lastError;
  return html`<div class="card">
    <div class="cardhead"><div class="ico-tile"><${Icon} name="barcode"/></div><div class="grow"><h2>API giá bán (đối tác)</h2>
      <div class="small muted">Khi khách quét mã vạch, hệ thống tra giá theo <code>maVach</code> và <code>maDiem</code> (mã điểm của chi nhánh). Giá hiện trên điện thoại là tạm tính, số tiền cuối do Dsmart POS tính lại.</div>
      ${d.config.enabled ? html`<${Pill} tone="ok"><span class="dot"></span>Đang dùng<//>` : html`<${Pill} tone="warn">Chưa bật<//>`}</div></div>
    <div class="two">
      <${Field} label="Địa chỉ API" hint="Chỉ nhập địa chỉ, không kèm ?maVach=... Ví dụ https://api.hcrc.vn/api/v1/reports/gia-ban/run"><input class="input" value=${f.url} onInput=${set('url')}/><//>
      <${Field} label="Khóa API (X-API-Key)" hint=${d.config.hasKey ? 'Đã lưu khóa. Bỏ trống để giữ khóa cũ, nhập mới để thay' : 'Chưa có khóa'}><input class="input" type="password" autocomplete="off" value=${f.key} placeholder=${d.config.hasKey ? '••••••••••••' : ''} onInput=${set('key')}/><//>
      <${Field} label="Thời gian chờ mỗi lần tra (giây)" hint="Quá thời gian thì dùng giá đã lưu, chưa có thì hiện Chưa có giá"><input class="input" inputmode="numeric" value=${f.timeoutSec} onInput=${set('timeoutSec')}/><//>
      <${Field} label="Giữ giá đã tra (phút)" hint="Trong thời gian này mọi khách quét cùng mặt hàng không gọi lại API"><input class="input" inputmode="numeric" value=${f.cacheMin} onInput=${set('cacheMin')}/><//></div>
    <div class="row" style="margin:6px 0"><${Switch} checked=${f.enabled} label="Dùng API giá để tra giá khi khách quét" onChange=${(v) => setF({ ...f, enabled: v })}/><span>Dùng API giá để tra giá khi khách quét</span></div>
    ${err && html`<div class="errtext" role="alert">${err}</div>`}
    ${le && html`<${Banner} tone="warn" icon="alert" title="Lần tra giá lỗi gần nhất">${fmt.dateTime(le.at)}: ${le.message}<//>`}
    <div class="card flat" style="margin:12px 0;padding:12px 16px"><b>Kiểm tra thử</b>
      <div class="row wrap" style="gap:8px;margin:8px 0">
        <select class="input" style="max-width:240px" value=${t.storeId} onChange=${(e) => setT({ ...t, storeId: e.target.value })}>${(stores || []).map((x) => html`<option value=${x.id} key=${x.id}>${x.name} (${x.posCode || 'chưa có mã điểm'})</option>`)}</select>
        <input class="input" style="max-width:220px" placeholder="Mã vạch" inputmode="numeric" value=${t.barcode} onInput=${(e) => setT({ ...t, barcode: e.target.value })}/>
        <button class="btn primary sm" disabled=${busy || !t.barcode.trim()} onClick=${test}>Tra giá</button></div>
      ${res && (res.status === 'ok' ? html`<div class="small num" style="line-height:1.7">Mã hàng <b>${res.row.sku}</b> · ${res.row.name}<br/>Giá thường <b>${fmt.money(res.row.list_price)}</b>${res.row.price !== res.row.list_price ? html` · Giá khuyến mại <b style="color:var(--ok)">${fmt.money(res.row.price)}</b>` : ''} · mã điểm ${res.maDiem}</div>`
        : res.status === 'notfound' ? html`<div class="small">Không có giá cho mã vạch này ở mã điểm ${res.maDiem}.</div>` : html`<div class="small errtext">${res.message}</div>`)}</div>
    <div class="row wrap" style="gap:8px"><button class="btn primary sm" disabled=${busy} onClick=${() => save()}>Lưu</button></div></div>`;
}

const PT_STATUS = { ok: ['Sẽ gán', 'ok'], same: ['Đã đúng', ''], nomatch: ['Chưa ghép', 'warn'], dup: ['Lặp trong file', 'err'], bad: ['Mã không hợp lệ', 'err'], clash: ['Trùng chi nhánh', 'err'] };
// ---- Mã điểm của hệ thống giá: nhập từ file, ghép với chi nhánh ----
function PointsCard({ onChanged }) {
  const st = useAsync(() => api.get('/pos-points'), []);
  const [text, setText] = useState('');
  const [fname, setFname] = useState('');
  const [pv, setPv] = useState(null);
  const [busy, run] = useBusy();
  const [err, setErr] = useState('');
  const d = st.data;
  const pick = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setErr(''); setPv(null); setFname(file.name);
    try { const t = await file.text(); setText(t); await run(async () => { try { setPv(await api.post('/pos-points/preview', { text: t })); } catch (x) { setErr(x.message); throw x; } }); }
    catch (x) { setErr(x.message || 'Không đọc được file'); }
  };
  const apply = () => run(async () => {
    try { const r = await api.post('/pos-points/apply', { text }); setPv(null); setText(''); setFname(''); await st.reload(); onChanged?.(); toast(`Đã lưu ${r.saved} mã điểm, gán cho ${r.assigned} chi nhánh`, 'ok'); }
    catch (x) { setErr(x.message); throw x; }
  });
  const sm = pv?.summary;
  return html`<div class="card">
    <div class="cardhead"><div class="ico-tile"><${Icon} name="store"/></div><div class="grow"><h2>Mã điểm (file của đối tác)</h2>
      <div class="small muted">Nhập file danh sách mã điểm giống bên đối tác để ghép với chi nhánh. Mã điểm này dùng để tra giá và đối chiếu với Dsmart POS. File CSV hoặc TXT (UTF-8), dòng đầu là tên cột: <code>maDiem</code> (bắt buộc), <code>maChiNhanh</code> hoặc <code>tenDiem</code> để ghép chi nhánh.</div>
      ${d ? html`<${Pill} tone=${d.total ? 'ok' : 'warn'}>${d.total ? `${d.total} mã điểm, ${d.matched} đã ghép chi nhánh` : 'Chưa nhập file'}<//>` : ''}</div></div>
    <div class="row wrap" style="gap:8px;margin:8px 0"><input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" onChange=${pick} aria-label="Chọn file mã điểm"/>${fname && html`<span class="small muted">${fname}</span>`}</div>
    ${err && html`<div class="errtext" role="alert">${err}</div>`}
    ${pv && html`<div class="small" style="margin:8px 0">Đọc ${sm.total} dòng: ${['ok', 'same', 'nomatch', 'dup', 'bad', 'clash'].filter((k) => sm[k]).map((k) => `${sm[k]} ${PT_STATUS[k][0].toLowerCase()}`).join(', ')}.</div>
      <div class="tblwrap" style="max-height:320px;overflow:auto"><table class="tbl"><thead><tr><th>Dòng</th><th>Mã điểm</th><th>Tên trong file</th><th>Chi nhánh BRG</th><th>Kết quả</th></tr></thead>
        <tbody>${pv.rows.slice(0, 300).map((r) => html`<tr key=${r.line}><td>${r.line}</td><td><b>${r.code}</b></td><td>${r.name || r.storeRef || '–'}</td><td>${r.storeName ? `${r.storeName} (${r.storeId})` : '–'}</td>
          <td><${Pill} tone=${PT_STATUS[r.status][1]}>${PT_STATUS[r.status][0]}<//>${r.note ? html` <span class="xs muted">${r.note}</span>` : ''}</td></tr>`)}</tbody></table></div>
      ${pv.rows.length > 300 && html`<div class="xs muted">Chỉ hiện 300 dòng đầu, khi áp dụng sẽ xử lý toàn bộ file.</div>`}
      <div class="row wrap" style="margin-top:12px;gap:8px"><button class="btn primary sm" disabled=${busy || !(sm.ok || sm.nomatch || sm.same)} onClick=${apply}>Áp dụng ${sm.ok || 0} chi nhánh và lưu ${(sm.ok || 0) + (sm.same || 0) + (sm.nomatch || 0)} mã điểm</button>
        <button class="btn line sm" disabled=${busy} onClick=${() => { setPv(null); setText(''); setFname(''); }}>Bỏ</button></div>`}
    ${d && d.rows.length > 0 && !pv && html`<details style="margin-top:8px"><summary class="small b">Danh sách mã điểm đã nhập (${d.total})</summary>
      <div class="tblwrap" style="max-height:260px;overflow:auto;margin-top:8px"><table class="tbl"><thead><tr><th>Mã điểm</th><th>Tên</th><th>Chi nhánh BRG</th></tr></thead><tbody>${d.rows.map((r) => html`<tr key=${r.code}><td><b>${r.code}</b></td><td>${r.name || '–'}</td><td>${r.storeName ? `${r.storeName} (${r.storeId})` : html`<span class="muted">chưa ghép</span>`}</td></tr>`)}</tbody></table></div></details>`}</div>`;
}

// ---- Giữ dữ liệu: xóa thông tin cá nhân và nhật ký cũ ----
function RetentionCard() {
  const st = useAsync(() => api.get('/integrations/retention'), []);
  const [f, setF] = useState(null);
  const [busy, run] = useBusy();
  const [err, setErr] = useState('');
  const d = st.data;
  useEffect(() => { if (d && f === null) setF({ piiMonths: String(d.config.piiMonths), logDays: String(d.config.logDays), auditMonths: String(d.config.auditMonths) }); }, [d]);
  if (!d || f === null) return html`<div class="card"><${Spinner}/></div>`;
  const dirty = ['piiMonths', 'logDays', 'auditMonths'].some((k) => String(d.config[k]) !== String(f[k]).trim());
  const save = () => run(async () => {
    setErr('');
    try { await api.put('/integrations/retention', { piiMonths: f.piiMonths, logDays: f.logDays, auditMonths: f.auditMonths }); await st.reload(); }
    catch (x) { setErr(x.message); throw x; }
  }, 'Đã lưu thời hạn giữ dữ liệu');
  const runNow = () => run(async () => { await api.post('/integrations/retention/run', {}); await st.reload(); }, 'Đã dọn xong');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const last = d.last;
  const sum = last && Object.values(last.done).reduce((a, b) => a + b, 0);
  return html`<div class="card">
    <div class="cardhead"><div class="ico-tile"><${Icon} name="shield"/></div><div class="grow"><h2>Giữ dữ liệu</h2>
      <div class="small muted">Hệ thống tự xóa thông tin cá nhân của khách và nhật ký cũ. Đơn, số tiền, các dòng hàng, bill và hoàn trả được giữ nguyên nên doanh thu và đối soát không đổi. Chạy mỗi 6 giờ.</div></div></div>
    <${Field} label="Thông tin cá nhân của khách (tháng)" hint="Email nhận bill, thông tin xuất hóa đơn công ty, email đã xác minh, mã thiết bị gắn với đơn. Tính từ lúc thanh toán. Khuyến nghị 12. Nhập 0 để giữ mãi"><input class="input" inputmode="numeric" value=${f.piiMonths} onInput=${set('piiMonths')}/><//>
    <${Field} label="Nhật ký kỹ thuật (ngày)" hint="Nhật ký quét, chi tiết giỏ đã kết thúc, lần quét ở cổng. Khuyến nghị 90. Nhập 0 để giữ mãi"><input class="input" inputmode="numeric" value=${f.logDays} onInput=${set('logDays')}/><//>
    <${Field} label="Nhật ký thao tác (tháng)" hint="Ai làm gì, lúc nào. Khuyến nghị 24. Nhập 0 để giữ mãi"><input class="input" inputmode="numeric" value=${f.auditMonths} onInput=${set('auditMonths')}/><//>
    ${err && html`<div class="errtext" role="alert">${err}</div>`}
    ${last && html`<div class="small muted" style="margin-top:8px">Lần dọn gần nhất: ${fmt.dateTime(last.at)}. ${sum ? `Đã xử lý ${last.done.piiTransactions} đơn (xóa thông tin cá nhân), ${last.done.deviceEmails} email thiết bị, ${last.done.logs} dòng nhật ký, ${last.done.sessions} giỏ cũ, ${last.done.audit} dòng nhật ký thao tác.` : 'Không có gì quá hạn.'}</div>`}
    <div class="row wrap" style="margin-top:12px;gap:8px"><button class="btn primary sm" disabled=${busy || !dirty} onClick=${save}>Lưu</button>
      <button class="btn line sm" disabled=${busy} onClick=${runNow}>Dọn ngay</button></div></div>`;
}

// ---- Xóa dữ liệu cá nhân theo yêu cầu của khách ----
function EraseCard() {
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [found, setFound] = useState(null);
  const [ask, setAsk] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState('');
  const [busy, run] = useBusy();
  const c = found?.counts;
  const total = c ? c.transactions + c.transactionsByDevice + c.invoices + c.verifiedEmails + c.pendingCodes : 0;
  const find = () => run(async () => {
    setErr(''); setDone(null);
    try { setFound(await api.post('/privacy/erase-preview', { email })); } catch (x) { setFound(null); setErr(x.message); throw x; }
  });
  const erase = () => run(async () => {
    try { const r = await api.post('/privacy/erase', { email, confirm: email, note: note.trim() || undefined }); setDone(r.done); setFound(null); setAsk(false); setEmail(''); setNote(''); }
    catch (x) { setErr(x.message); setAsk(false); throw x; }
  }, 'Đã xóa dữ liệu cá nhân của khách');
  return html`<div class="card">
    <div class="cardhead"><div class="ico-tile"><${Icon} name="shield"/></div><div class="grow"><h2>Xóa dữ liệu theo yêu cầu của khách</h2>
      <div class="small muted">Khách yêu cầu xóa dữ liệu cá nhân thì nhập email của khách. Hệ thống xóa email, thông tin xuất hóa đơn công ty và liên kết thiết bị. Đơn, số tiền, bill và doanh thu giữ nguyên. Không hoàn tác được.</div></div></div>
    <${Field} label="Email của khách"><input class="input" type="email" inputmode="email" value=${email} onInput=${(e) => { setEmail(e.target.value); setFound(null); setDone(null); }}/><//>
    <${Field} label="Ghi chú (không bắt buộc)" hint="Ví dụ mã yêu cầu hoặc ngày khách liên hệ. Lưu vào nhật ký thao tác"><input class="input" value=${note} onInput=${(e) => setNote(e.target.value)}/><//>
    ${err && html`<div class="errtext" role="alert">${err}</div>`}
    ${c && html`<div class="small" style="margin-top:8px">${total ? html`Tìm thấy: <b>${c.transactions}</b> đơn có email này, <b>${c.transactionsByDevice}</b> đơn từ thiết bị đã xác minh email này, <b>${c.invoices}</b> thông tin xuất hóa đơn, <b>${c.verifiedEmails}</b> liên kết email đã xác minh.` : 'Không tìm thấy dữ liệu nào gắn với email này.'}</div>`}
    ${done && html`<${Banner} tone="ok" icon="check">Đã xóa. ${done.transactions} đơn, ${done.transactionsByDevice} đơn theo thiết bị, ${done.invoices} thông tin xuất hóa đơn.<//>`}
    <div class="row wrap" style="margin-top:12px;gap:8px"><button class="btn line sm" disabled=${busy || !email.trim()} onClick=${find}>Tìm dữ liệu</button>
      <button class="btn danger-line sm" disabled=${busy || !total} onClick=${() => setAsk(true)}>Xóa dữ liệu</button></div>
    ${ask && html`<${Confirm} title="Xóa dữ liệu cá nhân của khách này?" danger ok="Xóa vĩnh viễn" cancel="Không xóa" busy=${busy} onOk=${erase} onCancel=${() => setAsk(false)}>
      Email <b>${email}</b> và các thông tin gắn với khách này sẽ bị xóa, không khôi phục được. Bill khách đã nhận qua email và hóa đơn ở nhà cung cấp hóa đơn không bị thu hồi.<//>`}</div>`;
}

// ---- Email: gửi mã xác nhận xem lịch sử và bill về email khách ----
function EmailCard() {
  const st = useAsync(() => api.get('/integrations/email'), []);
  const [f, setF] = useState(null);
  const [testTo, setTestTo] = useState('');
  const [busy, run] = useBusy();
  const [err, setErr] = useState('');
  const d = st.data;
  useEffect(() => { if (d && !f) setF({ ...d.email, pass: '', caPem: '' }); }, [d]);
  if (!d || !f) return html`<div class="card"><${Spinner}/></div>`;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => run(async () => {
    setErr('');
    try { const r = await api.put('/integrations/email', { host: f.host, port: Number(f.port), secure: f.secure, user: f.user, from: f.from, fromName: f.fromName, pass: f.pass, tlsMode: f.tlsMode, servername: f.servername, caPem: f.caPem }); setF({ ...r.email, pass: '', caPem: '' }); await st.reload(); }
    catch (x) { setErr(x.message); throw x; }
  }, 'Đã lưu cấu hình email');
  const test = () => run(async () => {
    setErr('');
    try { await api.post('/integrations/email/test', { to: testTo }); }
    catch (x) { setErr(x.message); throw x; }
  }, `Đã gửi email thử tới ${testTo}`);
  return html`<div class="card">
    <div class="cardhead"><div class="ico-tile"><${Icon} name="mail"/></div><div class="grow"><h2>Email gửi cho khách</h2>
      <div class="small muted">Gửi mã xác nhận xem lịch sử trên máy khác và gửi bill (kèm PDF) về email khách.</div></div>
      ${d.email.configured ? html`<${Pill} tone="ok"><span class="dot"></span>Đã cấu hình<//>` : html`<${Pill} tone="warn">Chưa cấu hình<//>`}</div>
    ${!d.publicUrl && html`<${Banner} tone="warn" icon="alert" title="Chưa đặt địa chỉ công khai">Biến <code>PUBLIC_URL</code> trong file <code>.env</code> chưa có nên email chưa có link xem bill trên web. Bill PDF vẫn đính kèm.<//>`}
    <div class="grid2" style="margin-top:12px">
      <${Field} label="Máy chủ SMTP" hint="Ví dụ smtp.congty.vn"><input class="input" value=${f.host} onInput=${set('host')} aria-label="Máy chủ SMTP"/><//>
      <${Field} label="Cổng"><input class="input" type="number" value=${f.port} onInput=${set('port')} aria-label="Cổng SMTP"/><//>
      <${Field} label="Bảo mật"><select class="input" value=${f.secure} onChange=${set('secure')} aria-label="Kiểu bảo mật">${Object.entries(d.secureModes).map(([k, v]) => html`<option value=${k} key=${k}>${v}</option>`)}</select><//>
      <${Field} label="Tài khoản đăng nhập SMTP"><input class="input" value=${f.user} onInput=${set('user')} autocomplete="off" aria-label="Tài khoản SMTP"/><//>
      <${Field} label="Mật khẩu" hint=${f.hasPassword ? 'Đã lưu. Để trống nếu không đổi' : 'Chưa có'}><input class="input" type="password" value=${f.pass} onInput=${set('pass')} autocomplete="new-password" aria-label="Mật khẩu SMTP"/><//>
      <${Field} label="Địa chỉ người gửi" hint="Email hiện ở dòng Từ"><input class="input" value=${f.from} onInput=${set('from')} aria-label="Địa chỉ người gửi"/><//>
      <${Field} label="Tên người gửi"><input class="input" value=${f.fromName} onInput=${set('fromName')} placeholder="BRG Scan & Checkout" aria-label="Tên người gửi"/><//>
    </div>
    <div class="stack" style="margin-top:14px;gap:10px">
      <${Field} label="Kiểm tra chứng chỉ của máy chủ email" hint="Chọn độc lập với kiểu bảo mật ở trên: máy chủ có thể chạy SSL/TLS cổng 465 nhưng dùng chứng chỉ tự ký, không do CA công cộng cấp">
        <select class="input" value=${f.tlsMode} onChange=${set('tlsMode')} aria-label="Kiểm tra chứng chỉ">${Object.entries(d.tlsModes).map(([k, v]) => html`<option value=${k} key=${k}>${v}</option>`)}</select><//>
      ${f.tlsMode === 'ca' && html`<div class="card flat stack" style="gap:10px">
        ${d.email.hasCa && d.email.ca ? html`<div class="small"><b>Chứng chỉ đang tin cậy</b><br/>${d.email.ca.subject}${d.email.ca.selfSigned ? ' (tự ký)' : ''}<br/>Hết hạn: ${d.email.ca.validTo}${d.email.ca.expired ? ' (ĐÃ HẾT HẠN)' : ''}<br/><span class="xs muted" style="word-break:break-all">SHA-256: ${d.email.ca.fingerprint}</span></div>` : html`<div class="small muted">Chưa nạp chứng chỉ.</div>`}
        <div class="field"><label for="ca-file">Chọn tệp chứng chỉ (.crt, .pem, .cer)</label><input id="ca-file" class="input" type="file" accept=".crt,.pem,.cer,.cert" onChange=${async (e) => { const file = e.target.files?.[0]; if (file) setF({ ...f, caPem: await file.text() }); }}/></div>
        <div class="field"><label for="ca-pem">Hoặc dán nội dung chứng chỉ (PEM)</label><textarea id="ca-pem" class="input" rows="5" spellcheck="false" placeholder="-----BEGIN CERTIFICATE-----" value=${f.caPem} onInput=${set('caPem')} style="font-family:monospace;font-size:12px"></textarea></div>
        <${Field} label="Tên máy chủ trong chứng chỉ (không bắt buộc)" hint="Điền khi tên trong chứng chỉ (CN hoặc SAN) khác máy chủ SMTP ở trên, ví dụ khi dùng địa chỉ IP"><input class="input" value=${f.servername} onInput=${set('servername')} aria-label="Tên máy chủ trong chứng chỉ"/><//>
        <div class="hint">Nạp chứng chỉ của chính máy chủ email (nếu tự ký) hoặc chứng chỉ gốc của CA nội bộ. Kết nối vẫn mã hóa và vẫn kiểm tra đúng máy chủ này, an toàn hơn bỏ qua kiểm tra.</div></div>`}
      ${f.tlsMode === 'insecure' && html`<${Banner} tone="warn" icon="alert" title="Kém an toàn">Không kiểm tra chứng chỉ thì kết nối vẫn mã hóa nhưng không bảo đảm đang nói chuyện đúng máy chủ email. Chỉ nên dùng khi chưa có chứng chỉ để nạp.<//>`}
    </div>
    ${err && html`<div class="errtext" role="alert">${err}</div>`}
    <div class="row wrap" style="margin-top:12px;gap:8px"><button class="btn primary sm" disabled=${busy} onClick=${save}>Lưu cấu hình</button></div>
    <div class="row wrap" style="margin-top:14px;gap:8px;align-items:flex-end">
      <div class="field grow"><label for="mail-test">Gửi email thử tới</label><input id="mail-test" class="input" type="email" value=${testTo} onInput=${(e) => setTestTo(e.target.value)} placeholder="email của bạn"/></div>
      <button class="btn line sm" disabled=${busy || !testTo || !d.email.configured} onClick=${test}>Gửi thử</button></div>
    <div class="hint">Mật khẩu được mã hóa khi lưu và không hiện lại. Nên dùng một tài khoản email riêng chỉ để gửi thư tự động. Với Gmail hoặc Microsoft 365 hãy dùng mật khẩu ứng dụng.</div></div>`;
}

export function Integrations({ stores, reloadStores }) {
  const st = useAsync(() => api.get('/integrations'), []);
  return html`<div class="stack-lg"><${PageHead} title="Tích hợp" sub="Giám sát và cấu hình Dsmart POS, chuyển khoản QR và hóa đơn điện tử."/>
    <${Async} state=${st}>${(d) => html`
      ${d.note && html`<${Banner} tone=${d.isProd ? 'warn' : 'info'} icon="info" title=${d.isProd ? 'Nguồn giá: file CSV' : 'Đang chạy bản giả lập'}>${d.note}<//>`}
      <${PosCard} d=${d} reload=${async () => { await st.reload(); reloadStores?.(); }}/>
      <${PosApiCard} d=${d} stores=${stores} reload=${st.reload}/>
      <${PosLinkCard}/>
      <${PointsCard} onChanged=${reloadStores}/>
      <${PriceApiCard} stores=${stores}/>
      <${EmailCard}/>
      <${RetentionCard}/>
      <${EraseCard}/>
      ${d.hasClassicStores && html`<div class="two"><${TransferCard} stores=${stores}/><${InvoiceCard} d=${d} reload=${st.reload}/></div>`}
      ${!d.isProd && html`<${DevTools} stores=${stores}/>`}`}<//></div>`;
}

// ============================== A04 Báo cáo ==============================
export function Reports({ me, stores }) {
  const chain = me.role === 'chain_admin';
  const [to, setTo] = useState(todayStr());
  const [from, setFrom] = useState(addDays(todayStr(), -6));
  const [sid, setSid] = useState('all');
  const st = useAsync(() => api.get(`/reports?from=${from}&to=${to}${chain ? `&storeId=${sid}` : ''}`), [from, to, sid]);
  const [busy, run] = useBusy();
  const quick = (n) => { setTo(todayStr()); setFrom(addDays(todayStr(), -(n - 1))); };
  const exp = () => run(async () => { const b = await api.download(`/reports.csv?from=${from}&to=${to}${chain ? `&storeId=${sid}` : ''}`); saveBlob(b, `bao-cao-${from}-${to}.csv`); }, 'Đã tải file báo cáo');
  const days = Math.round((new Date(to) - new Date(from)) / 86400_000) + 1;
  return html`<div class="stack-lg"><${PageHead} title="Báo cáo" sub=${chain ? 'Tổng hợp theo ngày, toàn chuỗi hoặc từng chi nhánh' : 'Tổng hợp theo ngày của chi nhánh'}>
      <button class="btn sm primary" disabled=${busy || !st.data} onClick=${exp}><${Icon} name="download" size=${18}/>Xuất Excel</button><//>
    <div class="card tight"><div class="toolbar">
      <div class="field"><label for="r-from">Từ ngày</label><input id="r-from" class="input" type="date" value=${from} max=${to} onChange=${(e) => e.target.value && setFrom(e.target.value)}/></div>
      <div class="field"><label for="r-to">Đến ngày</label><input id="r-to" class="input" type="date" value=${to} min=${from} onChange=${(e) => e.target.value && setTo(e.target.value)}/></div>
      <div class="chips"><button class=${`chip ${days === 7 && to === todayStr() ? 'on' : ''}`} onClick=${() => quick(7)}>7 ngày</button><button class=${`chip ${days === 30 && to === todayStr() ? 'on' : ''}`} onClick=${() => quick(30)}>30 ngày</button></div>
      ${chain && html`<div class="field"><label for="r-store">Chi nhánh</label><select id="r-store" class="input" value=${sid} onChange=${(e) => setSid(e.target.value)}><option value="all">Toàn chuỗi</option>${stores.map((s) => html`<option value=${s.id} key=${s.id}>${s.name}</option>`)}</select></div>`}
    </div></div>
    <${Async} state=${st}>${(d) => {
      const sel = chain ? sid : me.storeId;
      const ng = sel === 'all' ? stores.length > 0 && stores.every((x) => noGuard(x.config)) : noGuard(cfgOf(stores, sel));
      const NA = html`<span class="muted">Không áp dụng</span>`;
      const other = d.totals.other > 0;
      return html`
      <div class="tiles"><${Tile} k="Giao dịch" v=${fmt.num(d.totals.tx)}/><${Tile} k="Doanh thu" v=${fmt.money(d.totals.revenue)}/>${other && html`<${Tile} k="Thu khác (thẻ, ví…)" v=${fmt.money(d.totals.other)}/>`}
        ${ng ? html`<${Tile} k="Giao dịch có hàng thêm" v=${fmt.num(d.totals.extraTx)}/><${Tile} k="Tỷ lệ có hàng thêm" v=${fmt.pct(d.totals.extraRate)}/><${Tile} k="Giá trị hàng thêm" v=${fmt.money(d.totals.extraValue)}/>` : html`<${Tile} k="Lượt kiểm tra" v=${fmt.num(d.totals.checks)}/><${Tile} k="Chênh lệch" v=${fmt.num(d.totals.mismatches)}/><${Tile} k="Tỷ lệ chênh lệch" v=${fmt.pct(d.totals.mismatchRate)}/>`}</div>
      <div class="card"><h2>Doanh thu theo ngày</h2><${BarChart} data=${d.rows.map((r) => ({ label: dm(r.date), value: r.revenue, hl: r.date === todayStr() }))}/></div>
      <div class="card"><h2>Chi tiết theo ngày</h2><div class="tblwrap"><table class="tbl"><thead><tr><th>Ngày</th><th class="r">Giao dịch</th><th class="r">Doanh thu</th><th class="r">Tiền mặt</th><th class="r">Chuyển khoản</th>${other && html`<th class="r">Khác</th>`}${ng ? html`<th class="r">Có hàng thêm</th><th class="r">Giá trị hàng thêm</th>` : html`<th class="r">Lượt kiểm tra</th><th class="r">Chênh lệch</th>`}</tr></thead>
        <tbody>${d.rows.map((r) => html`<tr key=${r.date}><td>${fmt.dateFull(`${r.date}T12:00:00Z`)}</td><td class="r">${fmt.num(r.tx)}</td><td class="r">${fmt.money(r.revenue)}</td><td class="r">${fmt.money(r.cash)}</td><td class="r">${fmt.money(r.transfer)}</td>${other && html`<td class="r">${fmt.money(r.other)}</td>`}${ng ? html`<td class="r">${fmt.num(r.extraTx)}</td><td class="r">${fmt.money(r.extraValue)}</td>` : html`<td class="r">${fmt.num(r.checks)}</td><td class="r">${fmt.num(r.mismatches)}</td>`}</tr>`)}</tbody>
        <tfoot><tr><td>Tổng</td><td class="r">${fmt.num(d.totals.tx)}</td><td class="r">${fmt.money(d.totals.revenue)}</td><td class="r">${fmt.money(d.totals.cash)}</td><td class="r">${fmt.money(d.totals.transfer)}</td>${other && html`<td class="r">${fmt.money(d.totals.other)}</td>`}<td class="r">${ng ? '–' : fmt.num(d.totals.checks)}</td><td class="r">${ng ? '–' : fmt.num(d.totals.mismatches)}</td></tr></tfoot></table></div>
        <div class="hint">${ng ? 'Chi nhánh này không dùng bảo vệ ở cổng ra nên không có kiểm tra ngẫu nhiên (Không áp dụng).' : `Tỷ lệ chênh lệch = số lần chênh lệch / số giao dịch trong kỳ: ${fmt.pct(d.totals.mismatchRate)}.`}${other ? ' "Khác" là tiền thu bằng thẻ, ví điện tử… do Dsmart POS ghi nhận.' : ''}</div></div>`;
    }}<//></div>`;
}

// ============================== A05 Tài khoản & phân quyền ==============================
const strongPw = (p) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

function AddUser({ me, stores, onClose, onDone }) {
  const chain = me.role === 'chain_admin';
  const roles = chain ? ['cashier', 'gate', 'cashier_gate', 'branch_admin', 'chain_admin'] : STAFF_ROLES;
  const [f, setF] = useState({ role: 'cashier', name: '', email: '', username: '', storeId: me.storeId || stores[0]?.id || '', pin: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, run] = useBusy();
  const set = (k, digits) => (e) => setF({ ...f, [k]: digits ? e.target.value.replace(/\D/g, '') : e.target.value });
  const isAdm = f.role === 'chain_admin' || f.role === 'branch_admin';
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!f.name.trim()) return setErr('Nhập họ tên');
    if (!/^\d{4,6}$/.test(f.pin)) return setErr('PIN gồm 4–6 chữ số');
    if (isAdm && !strongPw(f.password)) return setErr('Mật khẩu tối thiểu 8 ký tự, có cả chữ và số');
    const body = { role: f.role, name: f.name, pin: f.pin, email: f.email || undefined, username: f.username.trim() || undefined, storeId: f.role === 'chain_admin' ? undefined : f.storeId };
    if (isAdm) body.password = f.password;
    const r = await run(async () => { try { return await api.post('/users', body); } catch (x) { setErr(x.message); throw x; } }, null);
    if (r) { toast(`Đã tạo tài khoản ${r.user.id}`, 'ok'); onDone(); onClose(); }
  };
  return html`<${Sheet} center onClose=${onClose}><form class="stack" onSubmit=${submit}>
    <h2>Thêm tài khoản</h2>
    <${Field} label="Vai trò"><select class="input" value=${f.role} onChange=${set('role')} aria-label="Vai trò">${roles.map((r) => html`<option value=${r} key=${r}>${ROLE_VI[r]}</option>`)}</select><//>
    <${Field} label="Họ tên"><input class="input" value=${f.name} onInput=${set('name')} aria-label="Họ tên" autofocus/><//>
    ${f.role !== 'chain_admin' && chain && html`<${Field} label="Chi nhánh"><select class="input" value=${f.storeId} onChange=${set('storeId')} aria-label="Chi nhánh">${stores.map((s) => html`<option value=${s.id} key=${s.id}>${s.name}</option>`)}</select><//>`}
    ${isAdm && chain && html`<${Field} label="Tên đăng nhập (tùy chọn)" hint="Dạng anh.dp: chữ thường không dấu, số, dấu chấm, gạch dưới. Không nhập thì đăng nhập bằng mã tài khoản hoặc email"><input class="input" value=${f.username} onInput=${set('username')} aria-label="Tên đăng nhập" autocapitalize="none" autocomplete="off"/><//>`}
    ${isAdm && html`<${Field} label="Email (dùng để đăng nhập quản trị)"><input class="input" type="email" value=${f.email} onInput=${set('email')} aria-label="Email"/><//>`}
    <${Field} label="Mã PIN (4–6 số)" hint=${isAdm ? 'PIN dùng cho ứng dụng nhân viên' : 'Nhân viên dùng PIN để đăng nhập ứng dụng thu ngân và cổng'}><input class="input" inputmode="numeric" type="password" autocomplete="new-password" maxlength="6" value=${f.pin} onInput=${set('pin', true)} aria-label="Mã PIN"/><//>
    ${isAdm && html`<${Field} label="Mật khẩu (tối thiểu 8 ký tự, có chữ và số)"><input class="input" type="password" autocomplete="new-password" value=${f.password} onInput=${set('password')} aria-label="Mật khẩu"/><//>`}
    <div class="hint">Mã tài khoản được tạo tự động (${isAdm ? 'QT' : 'NV'}xxxx).</div>
    ${err && html`<div class="errtext" role="alert">${err}</div>`}
    <button class="btn primary" type="submit" disabled=${busy}>${busy ? html`<${Spinner} sm/>` : 'Tạo tài khoản'}</button>
    <button class="btn txt" type="button" onClick=${onClose}>Hủy</button></form><//>`;
}

function ManageUser({ me, u, storeName, onClose, onDone, onMe }) {
  const [busy, run] = useBusy();
  const [mode, setMode] = useState(''); // '', pin, pw, lock, totp-off
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const [secret, setSecret] = useState(null);
  const self = u.id === me.id;
  const isAdm = u.role === 'chain_admin' || u.role === 'branch_admin';
  const chain = me.role === 'chain_admin';
  const done = async () => { await onDone(); };
  const doLock = async () => { const r = await run(async () => { await api.put(`/users/${u.id}`, { active: !u.active }); await done(); }, u.active ? 'Đã khóa tài khoản' : 'Đã mở khóa tài khoản'); if (r) onClose(); };
  const doPin = async (e) => { e.preventDefault(); setErr(''); if (!/^\d{4,6}$/.test(val)) return setErr('PIN gồm 4–6 chữ số');
    const r = await run(async () => { try { await api.post(`/users/${u.id}/reset-pin`, { pin: val }); } catch (x) { setErr(x.message); throw x; } }, 'Đã đặt lại PIN'); if (r) onClose(); };
  const doUsername = async (e) => { e.preventDefault(); setErr('');
    const r = await run(async () => { try { await api.put(`/users/${u.id}`, { username: val.trim() }); await done(); } catch (x) { setErr(x.message); throw x; } }, 'Đã lưu tên đăng nhập'); if (r) onClose(); };
  const doPw = async (e) => { e.preventDefault(); setErr(''); if (!strongPw(val)) return setErr('Mật khẩu tối thiểu 8 ký tự, có cả chữ và số');
    const r = await run(async () => { try { await api.post(`/users/${u.id}/reset-password`, { password: val }); } catch (x) { setErr(x.message); throw x; } }, 'Đã đặt lại mật khẩu'); if (r) onClose(); };
  // Xác thực 2 bước: bắt đầu (chính chủ đang bật thì cần mã hiện tại) -> hiện QR -> nhập mã 6 số để xác nhận
  const totpBegin = async (e) => {
    e?.preventDefault(); setErr('');
    const needCode = self && u.hasTotp;
    if (needCode && !/^\d{6}$/.test(val)) return setErr('Nhập mã 6 số hiện tại trong app xác thực');
    const r = await run(async () => { try { return await api.post(`/users/${u.id}/totp/begin`, needCode ? { currentCode: val } : {}); } catch (x) { setErr(x.message); throw x; } }, null);
    if (r) { setSecret(r); setVal(''); setMode('totp-enroll'); }
  };
  const totpConfirm = async (e) => {
    e.preventDefault(); setErr('');
    if (!/^\d{6}$/.test(val)) return setErr('Mã xác thực gồm 6 chữ số');
    const r = await run(async () => { try { await api.post(`/users/${u.id}/totp/confirm`, { confirmToken: secret.confirmToken, code: val }); await done(); if (self) onMe({ ...me, hasTotp: true }); return true; } catch (x) { setErr(x.message); throw x; } }, u.hasTotp ? 'Đã đổi thiết bị xác thực 2 bước' : 'Đã bật xác thực 2 bước');
    if (r) { setSecret(null); onClose(); }
  };
  const totpOff = async (e) => {
    e?.preventDefault(); setErr('');
    const needCode = self && u.hasTotp;
    if (needCode && !/^\d{6}$/.test(val)) return setErr('Nhập mã 6 số hiện tại trong app xác thực');
    const r = await run(async () => { try { await api.post(`/users/${u.id}/totp`, { enable: false, code: needCode ? val : undefined }); await done(); if (self) onMe({ ...me, hasTotp: false }); return true; } catch (x) { setErr(x.message); throw x; } }, 'Đã gỡ xác thực 2 bước');
    if (r) onClose();
  };
  // Vân tay / khuôn mặt (passkey)
  const [keys, setKeys] = useState(null);
  const loadKeys = async () => { try { setKeys((await api.get(`/users/${u.id}/passkeys`)).passkeys); } catch (x) { setErr(x.message); setKeys([]); } };
  const addKey = async () => {
    setErr('');
    if (!window.PublicKeyCredential) return setErr('Trình duyệt này không hỗ trợ đăng nhập bằng vân tay hoặc khuôn mặt. Cần mở bằng https và trình duyệt mới.');
    const r = await run(async () => {
      try {
        const o = await api.post('/passkeys/options', {});
        const cred = await passkeyCreate(o.options);
        return await api.post('/passkeys/register', { challengeToken: o.challengeToken, credential: cred, name: val.trim() || undefined });
      } catch (x) { setErr(x.name === 'NotAllowedError' ? 'Đã hủy hoặc hết thời gian chờ xác minh trên thiết bị' : (x.message || 'Không đăng ký được')); throw x; }
    }, 'Đã thêm thiết bị đăng nhập bằng vân tay / khuôn mặt');
    if (r) { setKeys(r.passkeys); setVal(''); }
  };
  const delKey = async (id) => { await run(async () => { try { await api.del(`/users/${u.id}/passkeys/${id}`); } catch (x) { setErr(x.message); throw x; } await loadKeys(); }, 'Đã gỡ thiết bị'); };
  useEffect(() => { if (u.auto && !u.hasTotp) totpBegin(); }, []);
  return html`<${Sheet} center onClose=${onClose}><div class="stack">
    <div class="row"><div class="avatar">${u.name.slice(0, 1).toUpperCase()}</div><div class="grow"><h2>${u.name}</h2><div class="small muted">${u.id}${u.username ? ` · ${u.username}` : ''} · ${ROLE_VI[u.role]}${storeName ? ` · ${storeName}` : ''}</div></div></div>
    ${mode === '' && html`<div class="stack">
      ${!self && html`<button class="btn line" onClick=${() => setMode('lock')}><${Icon} name="lock"/>${u.active ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}</button>`}
      <button class="btn line" onClick=${() => { setMode('pin'); setVal(''); setErr(''); }}><${Icon} name="kbd"/>Đặt lại mã PIN</button>
      ${chain && isAdm && html`<button class="btn line" onClick=${() => { setMode('username'); setVal(u.username || ''); setErr(''); }}><${Icon} name="kbd"/>Đổi tên đăng nhập</button>`}
      ${chain && isAdm && html`<button class="btn line" onClick=${() => { setMode('pw'); setVal(''); setErr(''); }}><${Icon} name="lock"/>Đặt lại mật khẩu</button>`}
      ${isAdm && (self || chain) && html`<button class="btn line" onClick=${() => { setVal(''); setErr(''); if (u.hasTotp && self) setMode('totp-change'); else totpBegin(); }}><${Icon} name="shield"/>${u.hasTotp ? 'Đổi thiết bị xác thực 2 bước' : 'Bật xác thực 2 bước'}</button>`}
      ${isAdm && (self || chain) && u.hasTotp && html`<button class="btn line" onClick=${() => { setVal(''); setErr(''); setMode('totp-off'); }}><${Icon} name="shield"/>Gỡ xác thực 2 bước</button>`}
      ${isAdm && (self || chain) && html`<button class="btn line" onClick=${() => { setVal(''); setErr(''); setMode('passkeys'); loadKeys(); }}><${Icon} name="kbd"/>Vân tay / khuôn mặt</button>`}
      <button class="btn txt" onClick=${onClose}>Đóng</button></div>`}
    ${mode === 'lock' && html`<div class="stack"><p class="muted">${u.active ? `${u.name} sẽ không đăng nhập được cho đến khi mở khóa.` : `${u.name} sẽ đăng nhập lại được.`}</p>
      <button class=${`btn ${u.active ? 'danger' : 'primary'}`} disabled=${busy} onClick=${doLock}>${u.active ? 'Khóa tài khoản' : 'Mở khóa'}</button><button class="btn txt" onClick=${() => setMode('')}>Quay lại</button></div>`}
    ${mode === 'pin' && html`<form class="stack" onSubmit=${doPin}><${Field} label="Mã PIN mới (4–6 số)" error=${err}><input class="input" inputmode="numeric" type="password" autocomplete="new-password" maxlength="6" value=${val} onInput=${(e) => setVal(e.target.value.replace(/\D/g, ''))} aria-label="Mã PIN mới" autofocus/><//>
      <button class="btn primary" type="submit" disabled=${busy}>Đặt lại PIN</button><button class="btn txt" type="button" onClick=${() => setMode('')}>Quay lại</button></form>`}
    ${mode === 'username' && html`<form class="stack" onSubmit=${doUsername}><${Field} label="Tên đăng nhập" error=${err} hint="Dạng anh.dp: chữ thường không dấu, số, dấu chấm, gạch dưới, gạch ngang (3–40 ký tự). Để trống nếu muốn bỏ tên đăng nhập"><input class="input" value=${val} onInput=${(e) => setVal(e.target.value)} aria-label="Tên đăng nhập" autocapitalize="none" autocomplete="off" autofocus/><//>
      <button class="btn primary" type="submit" disabled=${busy}>Lưu tên đăng nhập</button><button class="btn txt" type="button" onClick=${() => setMode('')}>Quay lại</button></form>`}
    ${mode === 'pw' && html`<form class="stack" onSubmit=${doPw}><${Field} label="Mật khẩu mới" error=${err} hint="Tối thiểu 8 ký tự, có chữ và số"><input class="input" type="password" autocomplete="new-password" value=${val} onInput=${(e) => setVal(e.target.value)} aria-label="Mật khẩu mới" autofocus/><//>
      <button class="btn primary" type="submit" disabled=${busy}>Đặt lại mật khẩu</button><button class="btn txt" type="button" onClick=${() => setMode('')}>Quay lại</button></form>`}
    ${mode === 'totp-change' && html`<form class="stack" onSubmit=${totpBegin}><p class="muted">Để đổi sang điện thoại hoặc app xác thực mới, nhập mã 6 số đang hiện trong app xác thực hiện tại.</p>
      <${Field} label="Mã 6 số hiện tại" error=${err}><input class="input big" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value=${val} onInput=${(e) => setVal(e.target.value.replace(/\D/g, ''))} aria-label="Mã 6 số hiện tại" autofocus/><//>
      <button class="btn primary" type="submit" disabled=${busy}>Tiếp tục</button><button class="btn txt" type="button" onClick=${() => setMode('')}>Quay lại</button></form>`}
    ${mode === 'totp-enroll' && secret && html`<form class="stack" onSubmit=${totpConfirm}>
      <${Banner} tone="" title="Quét mã bằng app xác thực mới">Quét QR hoặc nhập mã bí mật, rồi nhập mã 6 số đang hiện trong app để xác nhận. Chỉ sau khi xác nhận thì thiết bị mới có hiệu lực, mã cũ (nếu có) mới ngừng dùng được.<//>
      <div class="qrbox qrbig"><${QR} text=${secret.uri} label="Mã QR thiết lập xác thực 2 bước"/></div>
      <div class="field"><label>Hoặc nhập mã bí mật thủ công</label><div class="secret" id="totp-secret">${secret.secret}</div></div>
      <button class="btn line sm" type="button" onClick=${() => copyText(secret.secret)}><${Icon} name="copy"/>Sao chép mã bí mật</button>
      <${Field} label="Mã 6 số trong app" error=${err}><input class="input big" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value=${val} onInput=${(e) => setVal(e.target.value.replace(/\D/g, ''))} aria-label="Mã xác thực" autofocus/><//>
      <button class="btn primary" type="submit" disabled=${busy}>Xác nhận</button><button class="btn txt" type="button" onClick=${() => { setSecret(null); setMode(''); setErr(''); }}>Hủy</button></form>`}
    ${mode === 'totp-off' && html`<form class="stack" onSubmit=${totpOff}><p class="muted">Sau khi gỡ, ${self ? 'bạn' : u.name} chỉ cần mật khẩu để đăng nhập quản trị. Nên giữ xác thực 2 bước vì tài khoản này xem được doanh thu và tiền thu. Nếu hệ thống đang bắt buộc xác thực 2 bước (Chính sách bảo mật) thì cần tắt chính sách trước.</p>
      ${self && u.hasTotp && html`<${Field} label="Mã 6 số hiện tại" error=${err}><input class="input big" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value=${val} onInput=${(e) => setVal(e.target.value.replace(/\D/g, ''))} aria-label="Mã 6 số hiện tại" autofocus/><//>`}
      ${(!self || !u.hasTotp) && err && html`<div class="errtext" role="alert">${err}</div>`}
      <button class="btn danger" type="submit" disabled=${busy}>Gỡ xác thực 2 bước</button><button class="btn txt" type="button" onClick=${() => setMode('')}>Quay lại</button></form>`}
    ${mode === 'passkeys' && html`<div class="stack"><p class="muted">Đăng nhập nhanh bằng vân tay, khuôn mặt hoặc mã khóa màn hình của thiết bị, không cần mật khẩu. Mỗi thiết bị cần đăng ký một lần ngay trên thiết bị đó (cần mở bằng https).</p>
      ${keys === null ? html`<${Spinner}/>` : keys.length ? html`<div class="stack" style="gap:8px">${keys.map((k) => html`<div class="row" key=${k.id} style="gap:8px"><div class="grow"><b>${k.name}</b><div class="xs muted">Thêm ${fmt.dateTime(k.createdAt)}${k.lastUsedAt ? ` · dùng gần nhất ${fmt.dateTime(k.lastUsedAt)}` : ' · chưa dùng'}</div></div>
        <button class="btn sm line" disabled=${busy} onClick=${() => delKey(k.id)} aria-label=${`Gỡ ${k.name}`}>Gỡ</button></div>`)}</div>` : html`<div class="small muted">Chưa có thiết bị nào.</div>`}
      ${self && html`<${Field} label="Tên thiết bị (tùy chọn)"><input class="input" value=${val} onInput=${(e) => setVal(e.target.value)} placeholder="Ví dụ: iPhone của Anh" aria-label="Tên thiết bị"/><//>
        <button class="btn primary" disabled=${busy} onClick=${addKey}>Thêm thiết bị này (vân tay / khuôn mặt)</button>`}
      ${!self && html`<div class="small muted">Thiết bị chỉ do chính chủ thêm trên thiết bị của họ. Quản trị chuỗi gỡ được khi mất thiết bị.</div>`}
      ${err && html`<div class="errtext" role="alert">${err}</div>`}
      <button class="btn txt" onClick=${() => { setMode(''); setErr(''); }}>Quay lại</button></div>`}
  </div><//>`;
}

// ---- Chính sách bảo mật đăng nhập (quản trị chuỗi) ----
function SecurityPolicyCard() {
  const st = useAsync(() => api.get('/security'), []);
  const [busy, run] = useBusy();
  const d = st.data?.policy;
  if (!d) return html`<div class="card"><${Spinner}/></div>`;
  const set = (k, v) => run(async () => { await api.put('/security', { [k]: v }); await st.reload(); }, 'Đã lưu chính sách bảo mật');
  return html`<div class="card"><div class="cardhead"><div class="ico-tile green"><${Icon} name="lock"/></div><div class="grow"><h2>Chính sách bảo mật đăng nhập</h2>
    <div class="small muted">Áp dụng cho mọi tài khoản quản trị. Đăng nhập bằng vân tay / khuôn mặt (passkey) đã gồm xác minh người dùng nên không cần mã hình và mã 2 bước.</div></div></div>
    <div class="row" style="margin:8px 0"><${Switch} checked=${d.require2fa} label="Bắt buộc xác thực 2 bước" onChange=${(v) => set('require2fa', v)}/><span><b>Bắt buộc xác thực 2 bước</b><div class="xs muted">Bật: tài khoản chưa có 2 bước phải thiết lập ngay khi đăng nhập, và không ai gỡ được 2 bước. Tắt: ai cũng gỡ hoặc không dùng 2 bước được.</div></span></div>
    <div class="row" style="margin:8px 0"><${Switch} checked=${d.requireCaptcha} label="Bắt buộc mã hình 4 số khi đăng nhập" onChange=${(v) => set('requireCaptcha', v)}/><span><b>Bắt buộc mã hình 4 số khi đăng nhập</b><div class="xs muted">Hạn chế chương trình tự dò mật khẩu. Mỗi hình chỉ thử được một lần.</div></span></div>
    <div class="row" style="margin:8px 0"><${Switch} checked=${d.singleSession} label="Mỗi tài khoản chỉ đăng nhập một thiết bị" onChange=${(v) => set('singleSession', v)}/><span><b>Mỗi tài khoản chỉ đăng nhập một thiết bị</b><div class="xs muted">Bật: đăng nhập ở thiết bị mới phải xác nhận và sẽ đăng xuất thiết bị đang dùng. Tắt: nhiều thiết bị dùng cùng lúc được.</div></span></div>
    <div class="row" style="margin:8px 0"><${Switch} checked=${d.requireReauth} label="Nhập lại mật khẩu cho thao tác nhạy cảm" onChange=${(v) => set('requireReauth', v)}/><span><b>Nhập lại mật khẩu cho thao tác nhạy cảm</b><div class="xs muted">Bật: tạo quản trị, cấp hoặc thu hồi khóa POS, đặt lại mật khẩu người khác, đổi cấu hình tích hợp và chính sách bảo mật đều hỏi lại mật khẩu của bạn, để phiên bị đánh cắp không đủ chiếm quyền.</div></span></div></div>`;
}

export function Users({ me, stores, onMe }) {
  const st = useAsync(() => api.get('/users'), []);
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState(null);
  const sname = (id) => stores.find((s) => s.id === id)?.name || (id ? id : 'Toàn chuỗi');
  const mine = st.data?.users.find((u) => u.id === me.id);
  return html`<div class="stack-lg"><${PageHead} title="Tài khoản & phân quyền" sub=${me.role === 'chain_admin' ? 'Quản lý quản trị viên và nhân viên của cả chuỗi' : 'Quản lý nhân viên của chi nhánh'}>
      <button class="btn sm primary" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${18}/>Thêm tài khoản</button><//>
    ${me.role === 'chain_admin' && html`<${SecurityPolicyCard}/>`}
    <div class="card"><div class="cardhead"><div class="ico-tile green"><${Icon} name="shield"/></div><div class="grow"><h2>Bảo mật đăng nhập của tôi</h2>
      <div class="small muted">${me.hasTotp ? 'Đang bật: khi đăng nhập cần thêm mã 6 số từ app xác thực.' : 'Chưa bật. Nên bật vì tài khoản quản trị xem được doanh thu và tiền thu.'}</div></div>
      <${Pill} tone=${me.hasTotp ? 'ok' : 'warn'}>${me.hasTotp ? 'Đã bật' : 'Chưa bật'}<//>
      ${mine && !me.hasTotp && html`<button class="btn sm primary" onClick=${() => setSel({ ...mine, auto: true })}>Bật xác thực 2 bước</button>`}
      ${mine && html`<button class="btn sm line" onClick=${() => setSel(mine)}>Quản lý bảo mật</button>`}</div></div>
    <${Async} state=${st}>${(d) => html`
      <div class="card"><h2>Tài khoản</h2><div class="tblwrap"><table class="tbl"><thead><tr><th>Mã</th><th>Họ tên</th><th>Vai trò</th><th>Chi nhánh</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>${d.users.map((u) => html`<tr key=${u.id} class=${u.active ? '' : 'dim'}><td><b>${u.id}</b></td><td>${u.name}${u.username && html`<div class="sub">${u.username}</div>`}${u.email && html`<div class="sub">${u.email}</div>`}</td><td>${ROLE_VI[u.role] || u.role}</td><td>${sname(u.storeId)}</td>
          <td>${u.active ? html`<${Pill} tone="ok">Hoạt động<//>` : html`<${Pill} tone="err">Đã khóa<//>`} ${u.hasTotp && html`<${Pill} tone="info">2FA<//>`}</td>
          <td><button class="btn sm line" onClick=${() => setSel(u)} aria-label=${`Quản lý ${u.name}`}>Quản lý</button></td></tr>`)}</tbody></table></div></div>
      <div class="card"><h2>Phân quyền theo vai trò</h2><div class="tblwrap"><table class="tbl"><thead><tr><th>Chức năng</th><th class="tc">Quản trị chuỗi</th><th class="tc">Quản trị chi nhánh</th><th class="tc">Thu ngân</th><th class="tc">Cổng</th></tr></thead>
        <tbody>${d.permissions.map((p) => html`<tr key=${p.feature}><td class="wrap">${p.feature}</td>${['chain_admin', 'branch_admin', 'cashier', 'gate'].map((r) => html`<td class="tc" key=${r}>${p[r] ? html`<span class="check" aria-label="Được phép">✓</span>` : html`<span class="dash" aria-label="Không">–</span>`}</td>`)}</tr>`)}</tbody></table></div>
        <div class="hint">Vai trò "Thu ngân kiêm cổng" có quyền của cả thu ngân và cổng.</div></div>`}<//>
    ${adding && html`<${AddUser} me=${me} stores=${stores} onClose=${() => setAdding(false)} onDone=${st.reload}/>`}
    ${sel && html`<${ManageUser} me=${me} u=${sel} storeName=${sel.storeId ? sname(sel.storeId) : ''} onClose=${() => setSel(null)} onDone=${st.reload} onMe=${onMe}/>`}
  </div>`;
}

// ============================== Nhật ký ==============================
export function Audit({ me, stores }) {
  const chain = me.role === 'chain_admin';
  const [sid, setSid] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const st = useAsync(() => api.get(`/audit?limit=200${chain && sid ? `&storeId=${sid}` : ''}`), [sid]);
  const rows = useMemo(() => {
    const evs = st.data?.events || [];
    const n = dq.trim().toLowerCase();
    return evs.filter((e) => (!kind || e.actorType === kind) && (!n || `${actionLabel(e.action)} ${e.action} ${e.actorId || ''} ${e.entityId || ''}`.toLowerCase().includes(n)));
  }, [st.data, kind, dq]);
  return html`<div class="stack-lg"><${PageHead} title="Nhật ký" sub="Các thao tác gần đây, mới nhất ở trên cùng">
      <button class="btn sm line" onClick=${st.reload} disabled=${st.loading}><${Icon} name="refresh" size=${18}/>Làm mới</button><//>
    <div class="card tight"><div class="toolbar">
      ${chain && html`<div class="field"><label for="a-store">Chi nhánh</label><select id="a-store" class="input" value=${sid} onChange=${(e) => setSid(e.target.value)}><option value="">Tất cả</option>${stores.map((s) => html`<option value=${s.id} key=${s.id}>${s.name}</option>`)}</select></div>`}
      <div class="field"><label for="a-kind">Người thực hiện</label><select id="a-kind" class="input" value=${kind} onChange=${(e) => setKind(e.target.value)}><option value="">Tất cả</option>${Object.entries(ACTOR_VI).map(([k, v]) => html`<option value=${k} key=${k}>${v}</option>`)}</select></div>
      <div class="field grow"><label for="a-q">Tìm</label><input id="a-q" class="input" placeholder="Hành động, mã nhân viên, mã giao dịch" value=${q} onInput=${(e) => setQ(e.target.value)}/></div></div></div>
    <${Async} state=${st}>${() => rows.length === 0 ? html`<${Empty} icon="doc" title="Không có sự kiện phù hợp" text="Thử đổi bộ lọc."/>` : html`
      <div class="card"><div class="tblwrap"><table class="tbl"><thead><tr><th>Thời gian</th><th>Hành động</th><th>Người thực hiện</th><th>Chi nhánh</th><th>Chi tiết</th></tr></thead>
        <tbody>${rows.map((e) => html`<tr key=${e.id}><td>${fmt.dateTime(e.ts)}</td><td><b>${actionLabel(e.action)}</b>${actionLabel(e.action) === e.action ? '' : html`<div class="sub">${e.action}</div>`}</td>
          <td>${ACTOR_VI[e.actorType] || e.actorType}${e.actorId ? ` · ${e.actorId}` : ''}</td><td>${e.storeId || '–'}</td><td class="wrap">${e.entityId ? html`<span class="sub">${e.entity} ${e.entityId}</span> ` : ''}${auditDetail(e)}</td></tr>`)}</tbody></table></div></div>`}<//></div>`;
}
