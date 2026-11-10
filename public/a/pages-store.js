// Các trang theo chi nhánh: hôm nay, giao dịch, truy vết, ca làm, kiểm tra ngẫu nhiên, đối soát, mã không tìm thấy.
import { html, useState, useEffect, useRef, useAsync, usePoll, fmt, go, toast, Sheet, Field, Spinner, Header, todayStr } from '/shared/lib.js';
import { api, ROLE_VI, SHIFT_VI, PageHead, Tile, Async, StoreBar, useBusy, useDebounced, addDays, dm, dayName, txPill, exitPill, posPill, cfgOf, isPos, noGuard, payerLabel, Icon, Pill, Banner, Empty, Confirm, ErrorBox, Loading } from '/a/common.js';

const sq = (storeId, extra = '') => `storeId=${encodeURIComponent(storeId)}${extra}`;

function TxTable({ list, empty, hideExit }) {
  if (!list.length) return html`<${Empty} icon="receipt" title=${empty || 'Chưa có giao dịch'} text="Giao dịch sẽ hiện ở đây khi khách bắt đầu thanh toán."/>`;
  return html`<div class="tblwrap"><table class="tbl"><thead><tr><th>Mã giỏ hàng</th><th>Thời gian</th><th class="r">Số mặt hàng</th><th class="r" title="Đã thanh toán: số tiền Dsmart POS thu. Chưa thanh toán: tạm tính">Tổng tiền</th><th>Hình thức</th><th>Trạng thái</th>${!hideExit && html`<th>Cổng ra</th>`}</tr></thead>
    <tbody>${list.map((t) => html`<tr class="click" key=${t.id} tabindex="0" onClick=${() => go(`/transactions/${t.id}`)} onKeyDown=${(e) => e.key === 'Enter' && go(`/transactions/${t.id}`)}>
      <td><b>${t.code}</b></td><td>${fmt.when(t.createdAt)}</td><td class="r">${t.itemCount}</td><td class="r">${fmt.money(t.status === 'paid' && t.posAmount != null ? t.posAmount : t.total)}${t.status !== 'paid' && t.status !== 'cancelled' ? html`<div class="xs muted">tạm tính</div>` : null}</td><td>${fmt.method(t.method)}</td><td>${txPill(t.status)}</td>
      ${!hideExit && html`<td>${t.status === 'paid' || t.exitStatus !== 'none' ? exitPill(t.exitStatus) : html`<span class="muted">–</span>`}</td>`}</tr>`)}</tbody></table></div>`;
}

// ============================== A06 Hôm nay ==============================
export function Today({ ctx }) {
  const { storeId } = ctx;
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [upd, setUpd] = useState(null);
  const load = async () => { try { setD(await api.get(`/today?${sq(storeId)}`)); setErr(null); setUpd(new Date().toISOString()); } catch (e) { setErr(e); throw e; } };
  usePoll(load, 10000, [storeId]);
  const ng = noGuard(cfgOf(ctx.stores, storeId));
  const NA = html`<span class="muted">Không áp dụng</span>`;
  return html`<div class="stack-lg"><${PageHead} title="Hôm nay" sub=${upd ? `Tự cập nhật mỗi 10 giây · lần cuối ${fmt.time(upd)}` : 'Đang tải'}><//>
    <${StoreBar} ...${ctx}/>
    ${err && !d && html`<${ErrorBox} error=${err} retry=${load}/>`}
    ${!d && !err && html`<${Loading}/>`}
    ${d && html`
      ${!ng && d.held > 0 && html`<${Banner} tone="err" title=${`${d.held} ca đang chờ quản lý`}>Mở giao dịch tương ứng để cho qua hoặc từ chối.<//>`}
      <div class="tiles">
        <${Tile} k="Giao dịch" v=${fmt.num(d.tiles.transactions)}/><${Tile} k="Doanh thu" v=${fmt.money(d.tiles.revenue)}/>
        <${Tile} k="Tiền mặt" v=${fmt.money(d.tiles.cash)}/><${Tile} k="Chuyển khoản" v=${fmt.money(d.tiles.transfer)}/>
        ${d.tiles.other > 0 && html`<${Tile} k="Khác (thẻ, ví…)" v=${fmt.money(d.tiles.other)}/>`}
        ${ng ? html`<${Tile} k="Có hàng thêm ở quầy" v=${fmt.num(d.tiles.extraTx)} tone=${d.tiles.extraTx ? 'warn' : ''}/><${Tile} k="Giá trị hàng thêm" v=${fmt.money(d.tiles.extraValue)}/>` : html`<${Tile} k="Lượt kiểm tra" v=${fmt.num(d.tiles.checks)}/><${Tile} k="Chênh lệch" v=${fmt.num(d.tiles.mismatches)}/>`}</div>
      <div class="tiles">
        <${Tile} k="Đang mua sắm" v=${fmt.num(d.inStore)}/><${Tile} k=${isPos(cfgOf(ctx.stores, storeId)) ? 'Giỏ chờ Dsmart POS thu' : 'Giỏ chờ thu'} v=${fmt.num(d.waiting)} tone=${d.waiting ? 'warn' : ''}/>
        ${!ng && html`<${Tile} k="Ca chờ quản lý" v=${fmt.num(d.held)} tone=${d.held ? 'err' : ''}/>`}</div>
      <div class="card"><h2>Giao dịch gần đây</h2><${TxTable} hideExit=${ng} list=${d.recent} empty="Hôm nay chưa có giao dịch"/></div>`}
  </div>`;
}

// ============================== Giao dịch ==============================
export function Transactions({ ctx }) {
  const { storeId } = ctx;
  const [date, setDate] = useState(todayStr());
  const [status, setStatus] = useState('');
  const [exit, setExit] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const ng = noGuard(cfgOf(ctx.stores, storeId));
  const st = useAsync(() => api.get(`/transactions?${sq(storeId)}${date ? `&date=${date}` : ''}${status ? `&status=${status}` : ''}${exit ? `&exit=${exit}` : ''}${dq.trim() ? `&q=${encodeURIComponent(dq.trim().replace(/^gh/i, 'SG'))}` : ''}`), [storeId, date, status, exit, dq]);
  return html`<div class="stack-lg"><${PageHead} title="Giao dịch" sub="Bấm vào một giao dịch để truy vết từ lúc quét đến lúc ra cổng"/>
    <${StoreBar} ...${ctx}/>
    <div class="card tight"><div class="toolbar">
      <div class="field"><label for="t-date">Ngày</label><input id="t-date" class="input" type="date" value=${date} onChange=${(e) => setDate(e.target.value)}/></div>
      <div class="field"><label for="t-st">Trạng thái</label><select id="t-st" class="input" value=${status} onChange=${(e) => setStatus(e.target.value)}><option value="">Tất cả</option><option value="paid">Đã thu tiền</option><option value="awaiting_counter">Chờ thu tiền</option><option value="voided">Đã huỷ</option></select></div>
      ${!ng && html`<div class="field"><label for="t-ex">Cổng ra</label><select id="t-ex" class="input" value=${exit} onChange=${(e) => setExit(e.target.value)}><option value="">Tất cả</option><option value="exited">Đã ra cổng</option><option value="checking">Đang kiểm tra</option><option value="held">Chờ quản lý</option><option value="none">Chưa ra cổng</option></select></div>`}
      <div class="field grow"><label for="t-q">Tìm mã giỏ hàng</label><input id="t-q" class="input" placeholder="Ví dụ GH-Q7-0012" value=${q} onInput=${(e) => setQ(e.target.value)}/></div>
      ${date && html`<button class="btn sm line" onClick=${() => setDate('')}>Tất cả các ngày</button>`}</div></div>
    <${Async} state=${st}>${(d) => html`<div class="card"><${TxTable} hideExit=${ng} list=${d.transactions} empty="Không có giao dịch phù hợp"/>${d.transactions.length >= 200 && html`<div class="hint">Chỉ hiện 200 giao dịch mới nhất. Hãy lọc theo ngày để thu hẹp.</div>`}</div>`}<//></div>`;
}

// ============================== A07 Truy vết ==============================
function VoidDialog({ tx, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, run] = useBusy();
  const ok = async () => {
    if (!reason.trim()) return setErr('Hãy nhập lý do huỷ');
    const r = await run(async () => { try { await api.post(`/transactions/${tx.id}/void`, { reason: reason.trim() }); } catch (x) { setErr(x.message); throw x; } }, 'Đã huỷ giao dịch');
    if (r) { onDone(); onClose(); }
  };
  return html`<${Confirm} title="Huỷ giao dịch này?" text=${`Giao dịch ${tx.code} (${fmt.money(tx.total)}) sẽ bị huỷ và khoản thu được trừ khỏi doanh thu. Không thể hoàn tác.`} ok="Huỷ giao dịch" cancel="Giữ lại" danger busy=${busy} onOk=${ok} onCancel=${onClose}>
    <${Field} label="Lý do huỷ (bắt buộc)" error=${err}><textarea class=${`input ${err ? 'err' : ''}`} value=${reason} onInput=${(e) => setReason(e.target.value)} aria-label="Lý do huỷ" autofocus></textarea><//><//>`;
}

/** Dsmart POS đã nhận giỏ mà quá 10 phút chưa báo kết quả. */
export const WAIT_LONG_MS = 10 * 60_000;
export const waitedLong = (posStatus, claimedAt) => posStatus === 'claimed' && !!claimedAt && Date.now() - new Date(claimedAt).getTime() > WAIT_LONG_MS;

function ReleaseDialog({ order, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, run] = useBusy();
  const ok = async () => {
    if (!reason.trim()) return setErr('Hãy nhập lý do nhả giỏ');
    const r = await run(async () => { try { await api.post(`/pos/orders/${encodeURIComponent(order.transactionId)}/release`, { reason: reason.trim() }); } catch (x) { setErr(x.message); throw x; } }, 'Đã nhả giỏ hàng');
    if (r) { onDone(); onClose(); }
  };
  return html`<${Confirm} title=${`Nhả giỏ ${order.code}?`} text="Giỏ hàng quay lại trạng thái chờ thu để thu bằng cách khác. Nếu sau đó Dsmart POS vẫn báo đã thanh toán đơn này thì BRG sẽ từ chối và bạn phải đối soát tay với Dsmart POS." ok="Nhả giỏ" cancel="Giữ nguyên" danger busy=${busy} onOk=${ok} onCancel=${onClose}>
    <${Field} label="Lý do (bắt buộc)" error=${err}><textarea class=${`input ${err ? 'err' : ''}`} value=${reason} onInput=${(e) => setReason(e.target.value)} aria-label="Lý do nhả giỏ" placeholder="Ví dụ: Dsmart POS bị sập, khách thanh toán lại ở quầy" autofocus></textarea><//><//>`;
}

export function TxDetail({ ctx, id }) {
  const st = useAsync(() => api.get(`/transactions/${encodeURIComponent(id)}`), [id]);
  const [po, setPo] = useState(null);
  const [releasing, setReleasing] = useState(false);
  const t0 = st.data?.transaction;
  const loadPo = async () => {
    if (!t0?.posOrderRef) return setPo(null);
    try { const r = await api.get(`/pos/orders?storeId=${encodeURIComponent(t0.storeId)}`); setPo(r.orders.find((o) => o.transactionId === t0.id) || null); } catch { setPo(null); }
  };
  useEffect(() => { loadPo(); }, [t0?.id, t0?.posStatus, t0?.status]);
  const [voiding, setVoiding] = useState(false);
  const [resolve, setResolve] = useState(null);
  const [note, setNote] = useState('');
  const [busy, run] = useBusy();
  const decide = async (decision) => {
    const r = await run(async () => api.post(`/transactions/${id}/resolve`, { decision, note: note.trim() || undefined }), decision === 'allow' ? 'Đã cho khách qua' : 'Đã từ chối cho qua');
    if (r) { setResolve(null); setNote(''); st.reload(); }
  };
  return html`<div class="stack-lg">
    <${Async} state=${st}>${(d) => {
      const t = d.transaction, gd = t.guardCheck !== false, canVoid = t.status === 'paid' && t.exitStatus !== 'exited', held = gd && (t.exitStatus === 'held' || t.exitStatus === 'denied');
      return html`
      <div class="pagehead"><button class="iconbtn" onClick=${() => go('/transactions')} aria-label="Quay lại danh sách"><${Icon} name="chevl"/></button>
        <div style="flex:1;min-width:200px"><h1>Giao dịch ${t.code}</h1><div class="sub">${t.id} · ${fmt.dateTime(t.createdAt)}</div></div>
        <div class="row wrap">${txPill(t.status)} ${gd && (t.status === 'paid' || t.exitStatus !== 'none') && exitPill(t.exitStatus)}${!gd && html`<${Pill}>Không qua bảo vệ<//>`}</div></div>
      ${held && html`<${Banner} tone="err" title="Khách đang chờ quản lý xử lý ở cổng">
        <div class="stack" style="margin-top:8px"><div class="small">Chênh lệch khi kiểm tra ngẫu nhiên. Cho qua nếu đã đối chiếu xong, hoặc từ chối để khách quay lại quầy.</div>
        <div class="row wrap"><button class="btn sm ok" onClick=${() => setResolve('allow')}>Cho qua</button><button class="btn sm danger-line" onClick=${() => setResolve('deny')}>Từ chối</button></div></div><//>`}
      ${t.status === 'voided' && html`<${Banner} tone="err" icon="x" title="Giao dịch đã bị huỷ">Lý do: ${d.voidReason || '(không ghi)'}<//>`}
      <div class="two wide-l">
        <div class="stack-lg">
          <div class="card"><h2>Tóm tắt</h2><div class="kv">
            <span>Hình thức</span><span>${fmt.method(t.method)}</span>
            <span>Tạm tính</span><span>${fmt.money(t.subtotal)}</span><span>Giảm giá</span><span>${fmt.money(t.discount)}</span>
            <span>Tổng tiền</span><span>${fmt.money(t.total)}</span>${t.extraDue > 0 && html`<span>Còn phải thu thêm</span><span>${fmt.money(t.extraDue)}</span>`}
            <span>Nội dung chuyển khoản</span><span>${t.transferContent}</span>
            <span>Thu lúc</span><span>${t.paidAt ? fmt.dateTime(t.paidAt) : '–'}</span>${gd && html`<span>Ra cổng lúc</span><span>${t.exitedAt ? fmt.dateTime(t.exitedAt) : '–'}</span>`}
            ${t.ageRestricted && html`<span>Hàng giới hạn độ tuổi</span><span>Có</span>`}${t.rating != null && html`<span>Khách đánh giá</span><span>${t.rating}/5</span>`}</div></div>
          ${t.posOrderRef && html`<div class="card" id="pos-block"><div class="cardhead"><h2>Thu qua Dsmart POS</h2>${posPill(t.posStatus)}${waitedLong(t.posStatus, po?.claimedAt) && html`<${Pill} tone="warn">Chờ lâu<//>`}</div>
            <div class="kv"><span>Mã đơn Dsmart POS</span><span>${t.posOrderRef}</span>
              <span>Số tiền BRG</span><span>${fmt.money(t.total)}</span>
              <span>Số tiền Dsmart POS</span><span class=${t.posAmount != null && t.posAmount !== t.total ? 'differs' : ''}>${t.posAmount != null ? fmt.money(t.posAmount) : 'Chưa báo'}</span>
              <span>Thu ngân / quầy</span><span>${po ? [po.cashier, po.terminal].filter(Boolean).join(' / ') || '–' : '–'}</span>
              ${po?.claimedAt && html`<span>Dsmart POS nhận giỏ lúc</span><span>${fmt.dateTime(po.claimedAt)}</span>`}</div>
            ${t.posAmount != null && t.posAmount !== t.total && html`<${Banner} tone="err" title="Số tiền Dsmart POS lệch với BRG">Dsmart POS báo ${fmt.money(t.posAmount)}, BRG tính ${fmt.money(t.total)} (${t.posAmount > t.total ? 'Dsmart POS thu nhiều hơn' : 'Dsmart POS thu ít hơn'} ${fmt.money(Math.abs(t.posAmount - t.total))}). Hãy đối chiếu với đơn trên Dsmart POS.<//>`}
            ${waitedLong(t.posStatus, po?.claimedAt) && html`<div class="stack"><div class="small muted">Dsmart POS đã nhận giỏ hơn 10 phút nhưng chưa báo kết quả. Nếu Dsmart POS gặp sự cố, bạn có thể nhả giỏ để thu lại.</div><button class="btn sm danger-line auto" onClick=${() => setReleasing(true)}>Nhả giỏ</button></div>`}</div>`}
          ${d.transaction?.cancelReason === 'expired' && html`<div class="card"><h2>Mã QR hết hạn</h2><div class="small muted">Khách bấm Thanh toán nhưng quá thời hạn (mặc định 30 phút) chưa thanh toán nên hệ thống tự huỷ đơn. Giỏ hàng của khách vẫn được giữ để tạo mã mới. Nếu Dsmart POS báo thanh toán sau đó, hệ thống vẫn ghi nhận.</div></div>`}
          ${d.cartDiff && !d.cartDiff.same && html`<div class="card"><h2>Khác với giỏ khách quét</h2><div class="small muted" style="margin-bottom:8px">Đơn Dsmart POS khác giỏ trên điện thoại khách: thu ngân đã bớt, thêm hoặc đổi số lượng ở quầy. Đơn Dsmart POS là bản đúng.</div>
            ${d.cartDiff.removed.map((x, i) => html`<div class="item" key=${'r' + i}><div class="grow"><div class="name">${x.name}</div><div class="small muted">Khách quét ${x.qty}, Dsmart POS không có</div></div><${Pill} tone="warn">Bớt<//></div>`)}
            ${d.cartDiff.changed.map((x, i) => html`<div class="item" key=${'c' + i}><div class="grow"><div class="name">${x.name}</div><div class="small muted">Khách quét ${x.from}, Dsmart POS tính ${x.to}</div></div><${Pill} tone="warn">Đổi số lượng<//></div>`)}
            ${d.cartDiff.added.map((x, i) => html`<div class="item" key=${'a' + i}><div class="grow"><div class="name">${x.name}</div><div class="small muted">Dsmart POS thêm ${x.qty}, khách không quét</div></div><${Pill} tone="brand">Thêm<//></div>`)}</div>`}
          ${(d.transaction?.invoiceUrl || d.transaction?.transactionUrl) && html`<div class="card"><h2>Hoá đơn điện tử và giao dịch</h2><div class="small muted" style="margin-bottom:8px">Link do Dsmart POS gửi kèm khi báo thanh toán. Khách mở được từ màn hình sau thanh toán, bill và email.</div>
            ${d.transaction.invoiceUrl && html`<div class="item"><div class="grow"><div class="name">Hoá đơn điện tử</div><div class="small"><a href=${d.transaction.invoiceUrl} target="_blank" rel="noopener" style="word-break:break-all">${d.transaction.invoiceUrl}</a></div></div></div>`}
            ${d.transaction.transactionUrl && html`<div class="item"><div class="grow"><div class="name">Chi tiết giao dịch</div><div class="small"><a href=${d.transaction.transactionUrl} target="_blank" rel="noopener" style="word-break:break-all">${d.transaction.transactionUrl}</a></div></div></div>`}</div>`}
          ${d.refunds?.length > 0 && html`<div class="card"><h2>Hoàn trả</h2>${d.refunds.map((r, i) => html`<div class="item" key=${i}><div class="grow"><div class="name">−${fmt.money(r.amount)}${r.reason ? ` · ${r.reason}` : ''}</div><div class="small muted">${fmt.dateTime(r.at)} · mã ${r.ref}${r.lines.length ? ` · ${r.lines.map((l) => `${l.name}${l.qty ? ` × ${l.qty}` : ''}`).join(', ')}` : ''}</div></div></div>`)}</div>`}
          <div class="card"><h2>Mặt hàng (${t.itemCount})</h2><div class="tblwrap"><table class="tbl"><thead><tr><th>Sản phẩm</th><th class="r">Đơn giá</th><th class="r">SL</th><th class="r">Thành tiền</th></tr></thead>
            <tbody>${(t.items || []).map((i, k) => html`<tr key=${k}><td class="wrap"><b>${i.name}</b><div class="sub">${i.sku}${i.ageRestricted ? ' · hạn chế độ tuổi' : ''}</div></td><td class="r">${fmt.money(i.price ?? i.unit_price)}</td><td class="r">${i.qty}</td><td class="r">${fmt.money((i.price ?? i.unit_price) * i.qty - (i.discount || 0))}${i.discount ? html`<div class="sub">giảm ${fmt.money(i.discount)}</div>` : ''}</td></tr>`)}</tbody></table></div></div>
        </div>
        <div class="stack-lg">
          <div class="card"><h2>Dòng thời gian</h2>${d.events.length ? html`<div class="tl wide">${d.events.map((e, k) => html`<div key=${k}><span class="muted xs num">${fmt.time(e.ts)}</span><span class=${`pt ${e.tone === 'warn' ? 'warn' : e.tone === 'ok' ? 'ok' : e.tone === 'info' ? 'info' : e.tone === 'err' ? 'err' : ''}`}></span><span>${e.text}<div class="xs muted">${fmt.date(e.ts)}</div></span></div>`)}</div>` : html`<div class="muted">Chưa có sự kiện</div>`}</div>
          <div class="card"><h2>Thanh toán</h2>${d.payments.length ? d.payments.map((p) => html`<div class="item" key=${p.id}><div class="grow"><div class="name">${fmt.method(p.method)}${p.kind === 'extra' ? ' (thu bổ sung)' : p.kind === 'refund' ? ' (hoàn trả)' : ''}</div><div class="small muted">${fmt.dateTime(p.at)} · ${payerLabel(p.by)}${p.cashReceived ? ` · khách đưa ${fmt.money(p.cashReceived)}, thối ${fmt.money(p.change)}` : ''}</div></div><div class="b">${fmt.money(p.amount)}</div>${p.voided && html`<${Pill} tone="err">Đã huỷ<//>`}</div>`) : html`<div class="muted">Chưa thu tiền</div>`}</div>
          ${gd && html`<div class="card"><h2>Kiểm tra ngẫu nhiên</h2>${d.checks.length ? d.checks.map((c) => html`<div class="item" key=${c.id}><div class="grow"><div class="name">${c.result === 'match' ? 'Khớp' : c.result === 'mismatch' ? 'Chênh lệch' : c.result}${c.amount ? ` · ${fmt.money(c.amount)}` : ''}</div><div class="small muted">${fmt.dateTime(c.at)} · NV ${c.by}${c.note ? ` · ${c.note}` : ''}${c.resolution ? ` · ${c.resolution === 'allow' ? 'đã cho qua' : 'đã từ chối'}${c.resolvedBy ? ` bởi ${c.resolvedBy}` : ''}` : ''}</div></div></div>`) : html`<div class="muted">${t.checkRequired ? 'Đang chờ kiểm tra' : 'Không bị chọn kiểm tra'}</div>`}</div>`}
          <div class="card"><h2>Hoá đơn điện tử</h2>${d.invoices.length ? d.invoices.map((v) => html`<div class="item" key=${v.id}><div class="grow"><div class="name">${v.type === 'company' ? 'Hoá đơn công ty' : 'Hoá đơn bán lẻ'}${v.number ? ` · ${v.number}` : ''}</div><div class="small muted">${v.email || v.tax_code || ''}${v.error ? ` · ${v.error}` : ''}</div></div><${Pill} tone=${v.status === 'issued' ? 'ok' : v.status === 'pending' ? 'warn' : ''}>${({ issued: 'Đã xuất', pending: 'Đang treo', cancelled: 'Đã huỷ', cancel_requested: 'Chờ huỷ', replaced: 'Đã thay thế' })[v.status] || v.status}<//></div>`) : html`<div class="muted">${t.method === 'basket' ? 'Hoá đơn điện tử không phát hành lúc thanh toán. Khách tự khai báo qua link của nhà cung cấp.' : 'Khách không yêu cầu hoá đơn'}</div>`}</div>
          ${canVoid && html`<div class="card"><h2>Hành động quản lý</h2><p class="small muted">${gd ? 'Huỷ khi thu nhầm hoặc khách trả hàng trước khi ra cổng.' : 'Huỷ khi thu nhầm hoặc khách trả hàng.'}</p>${t.posOrderRef && html`<${Banner} tone="info" icon="info">Giao dịch này thu qua Dsmart POS. Huỷ ở đây chỉ trừ trong BRG, bạn cần huỷ cả đơn trên Dsmart POS.<//>`}<button class="btn danger-line" onClick=${() => setVoiding(true)}><${Icon} name="trash"/>Huỷ giao dịch</button></div>`}
        </div>
      </div>
      ${releasing && po && html`<${ReleaseDialog} order=${po} onClose=${() => setReleasing(false)} onDone=${() => { st.reload(); loadPo(); }}/>`}
      ${voiding && html`<${VoidDialog} tx=${t} onClose=${() => setVoiding(false)} onDone=${st.reload}/>`}
      ${resolve && html`<${Confirm} title=${resolve === 'allow' ? 'Cho khách qua cổng?' : 'Từ chối cho qua?'} text=${resolve === 'allow' ? 'Khách sẽ được ghi nhận ra cổng.' : 'Khách sẽ phải quay lại quầy để xử lý chênh lệch.'} ok=${resolve === 'allow' ? 'Cho qua' : 'Từ chối'} danger=${resolve === 'deny'} busy=${busy} onOk=${() => decide(resolve)} onCancel=${() => setResolve(null)}>
        <${Field} label="Ghi chú (không bắt buộc)"><input class="input" value=${note} onInput=${(e) => setNote(e.target.value)} aria-label="Ghi chú"/><//><//>`}`;
    }}<//></div>`;
}

// ============================== Đơn Dsmart POS ==============================
export function PosOrders({ ctx }) {
  const { storeId, me } = ctx;
  const cfg = cfgOf(ctx.stores, storeId);
  const [status, setStatus] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [upd, setUpd] = useState(null);
  const [rel, setRel] = useState(null);
  const load = async () => { try { setD(await api.get(`/pos/orders?${sq(storeId)}${status ? `&status=${status}` : ''}`)); setErr(null); setUpd(new Date().toISOString()); } catch (e) { setErr(e); throw e; } };
  usePoll(load, 10000, [storeId, status]);
  const orders = d?.orders || [];
  const differs = orders.filter((o) => o.differs).length;
  const longWait = orders.filter((o) => waitedLong(o.posStatus, o.claimedAt)).length;
  const FILTERS = [['', 'Tất cả'], ['claimed', 'Đã nhận'], ['paid', 'Đã thanh toán'], ['cancelled', 'Đã huỷ']];
  return html`<div class="stack-lg"><${PageHead} title="Đơn Dsmart POS" sub=${upd ? `Đơn thu tiền qua phần mềm Dsmart POS · tự cập nhật mỗi 10 giây · lần cuối ${fmt.time(upd)}` : 'Đang tải'}><//>
    <${StoreBar} ...${ctx}/>
    ${!isPos(cfg) && html`<${Banner} tone="info" icon="info" title="Chi nhánh này chưa thu tiền qua Dsmart POS">
      Hiện chi nhánh tự thu trong BRG. Để dùng Dsmart POS: tạo khoá API cho Dsmart POS ở mục Tích hợp, rồi đổi "Thu tiền" sang "Qua Dsmart POS" ở mục Chi nhánh & tính năng${me?.role === 'chain_admin' ? '' : ' (nhờ quản trị chuỗi)'}.
      ${me?.role === 'chain_admin' && html`<div class="row wrap" style="margin-top:8px"><button class="btn sm line" onClick=${() => go('/integrations')}>Tới Tích hợp</button><button class="btn sm line" onClick=${() => go('/stores')}>Tới Chi nhánh</button></div>`}<//>`}
    ${differs > 0 && html`<${Banner} tone="err" title=${`${differs} đơn lệch tiền`}>Số tiền Dsmart POS khác tổng BRG. Mở đơn để đối chiếu với Dsmart POS.<//>`}
    ${longWait > 0 && html`<${Banner} title=${`${longWait} đơn chờ lâu`}>Dsmart POS đã nhận giỏ hơn 10 phút mà chưa báo kết quả. Nếu Dsmart POS gặp sự cố, mở đơn hoặc bấm "Nhả giỏ" để thu lại.<//>`}
    <div class="card tight"><div class="toolbar"><div class="chips" role="group" aria-label="Lọc trạng thái">${FILTERS.map(([k, l]) => html`<button key=${k} class=${`chip ${status === k ? 'on' : ''}`} aria-pressed=${status === k} onClick=${() => setStatus(k)}>${l}</button>`)}</div></div></div>
    ${err && !d && html`<${ErrorBox} error=${err} retry=${load}/>`}
    ${!d && !err && html`<${Loading}/>`}
    ${d && (orders.length === 0 ? html`<${Empty} icon="card" title="Chưa có đơn Dsmart POS" text="Đơn sẽ hiện ở đây khi Dsmart POS nhận giỏ hàng của khách."/>` : html`
      <div class="card"><div class="tblwrap"><table class="tbl" id="pos-orders"><thead><tr><th>Giờ nhận</th><th>Mã giỏ</th><th>Mã đơn Dsmart POS</th><th>Trạng thái</th><th class="r">Tổng BRG</th><th class="r">Số tiền Dsmart POS</th><th>Thu ngân / quầy</th><th></th></tr></thead>
        <tbody>${orders.map((o) => {
          const long = waitedLong(o.posStatus, o.claimedAt);
          return html`<tr class=${`click ${o.differs ? 'differs' : ''}`} key=${o.transactionId} tabindex="0" onClick=${() => go(`/transactions/${o.transactionId}`)} onKeyDown=${(e) => e.key === 'Enter' && go(`/transactions/${o.transactionId}`)}>
            <td>${fmt.when(o.claimedAt)}</td><td><b>${o.code}</b></td><td>${o.posOrderRef}</td>
            <td>${posPill(o.posStatus)} ${long && html`<${Pill} tone="warn">Chờ lâu<//>`}</td>
            <td class="r">${fmt.money(o.brgTotal)}</td>
            <td class="r">${o.posAmount == null ? html`<span class="muted">–</span>` : o.differs ? html`<span class="differs-amt">${fmt.money(o.posAmount)}</span><div class="xs differs-amt">Lệch ${o.posAmount > o.brgTotal ? '+' : '−'}${fmt.money(Math.abs(o.posAmount - o.brgTotal))}</div>` : fmt.money(o.posAmount)}</td>
            <td>${[o.cashier, o.terminal].filter(Boolean).join(' / ') || html`<span class="muted">–</span>`}</td>
            <td>${long && html`<button class="btn sm danger-line" onClick=${(e) => { e.stopPropagation(); setRel(o); }}>Nhả giỏ</button>`}</td></tr>`;
        })}</tbody></table></div>
        ${orders.length >= 200 && html`<div class="hint">Chỉ hiện 200 đơn mới nhất.</div>`}</div>`)}
    ${rel && html`<${ReleaseDialog} order=${rel} onClose=${() => setRel(null)} onDone=${load}/>`}
  </div>`;
}

// ============================== A08 Nhân viên & ca ==============================
export function Plans({ ctx }) {
  const { storeId } = ctx;
  const [ws, setWs] = useState('');
  const st = useAsync(() => api.get(`/plans?${sq(storeId)}${ws ? `&weekStart=${ws}` : ''}`), [storeId, ws]);
  const [pick, setPick] = useState(null);
  const [busy, run] = useBusy();
  const set = async (kind) => {
    const p = pick;
    const r = await run(async () => { await api.put(`/plans?${sq(storeId)}`, { staffId: p.staff.id, date: p.date, kind }); await st.reload(); }, 'Đã lưu ca');
    if (r) setPick(null);
  };
  const cfg = cfgOf(ctx.stores, storeId), ng = noGuard(cfg), pm = isPos(cfg);
  const d = st.data;
  const today = todayStr();
  return html`<div class="stack-lg"><${PageHead} title="Nhân viên & ca" sub=${`Phân ca theo tuần. ${pm && ng ? 'Chi nhánh thu tiền qua Dsmart POS và không dùng cổng ra nên không bắt buộc thu ngân hay người ở cổng.' : pm ? 'Mỗi ca nên có ít nhất một người ở cổng (thu tiền do Dsmart POS lo).' : ng ? 'Mỗi ca nên có ít nhất một thu ngân (chi nhánh không dùng cổng ra).' : 'Mỗi ca nên có ít nhất một thu ngân và một người ở cổng.'}`}/>
    <${StoreBar} ...${ctx}/>
    <${Async} state=${st}>${(d0) => { const d = { ...d0, warnings: d0.warnings.filter((w) => (w.missing === 'gate' ? !ng : !pm)) }; return html`
      ${d.warnings.length > 0 && html`<${Banner} title=${`${d.warnings.length} ca còn thiếu người`}><ul style="margin:6px 0 0;padding-left:18px">${d.warnings.map((w, i) => html`<li key=${i}>${dayName(w.date)} ${dm(w.date)}, ca ${SHIFT_VI[w.kind]}: thiếu ${w.missing === 'cashier' ? 'thu ngân' : 'người ở cổng'}</li>`)}</ul><//>`}
      <div class="card"><div class="cardhead"><h2>Tuần ${dm(d.days[0])} – ${dm(d.days[6])}</h2>
        <div class="row"><button class="iconbtn" onClick=${() => setWs(addDays(d.days[0], -7))} aria-label="Tuần trước"><${Icon} name="chevl"/></button><button class="btn sm line" onClick=${() => setWs('')}>Tuần này</button><button class="iconbtn" onClick=${() => setWs(addDays(d.days[0], 7))} aria-label="Tuần sau"><${Icon} name="chev"/></button></div></div>
        ${d.staff.length === 0 ? html`<${Empty} icon="users" title="Chưa có nhân viên" text="Thêm nhân viên ở mục Tài khoản & phân quyền."/>` : html`
        <div class="tblwrap"><table class="tbl plan"><thead><tr><th>Nhân viên</th>${d.days.map((x) => html`<th key=${x} class=${x === today ? 'today' : ''}>${dayName(x)}<div class="xs">${dm(x)}</div></th>`)}</tr></thead>
          <tbody>${d.staff.map((u) => html`<tr key=${u.id}><td><b>${u.name}</b><div class="sub">${u.id} · ${ROLE_VI[u.role]}</div></td>
            ${d.days.map((x) => { const p = d.plans.find((y) => y.staffId === u.id && y.date === x); const k = p?.kind;
              return html`<td key=${x}><button class=${`cell ${k || ''}`} onClick=${() => setPick({ staff: u, date: x, kind: k })} aria-label=${`${u.name} ${dm(x)}: ${k ? SHIFT_VI[k] : 'Nghỉ'}`}>${k ? SHIFT_VI[k] : 'Nghỉ'}</button></td>`; })}</tr>`)}</tbody></table></div>`}
        <div class="hint">Bấm vào một ô để chọn ca Sáng, ca Chiều hoặc Nghỉ. Thay đổi lưu ngay.</div></div>`; }}<//>
    ${pick && html`<${Sheet} center onClose=${() => setPick(null)}><h2>${pick.staff.name}</h2><div class="muted">${dayName(pick.date)} ${dm(pick.date)}</div>
      <div class="stack">${[['sang', 'Ca sáng'], ['chieu', 'Ca chiều'], [null, 'Nghỉ']].map(([k, l]) => html`<button key=${l} class=${`option ${(pick.kind || null) === k ? 'on' : ''}`} disabled=${busy} onClick=${() => set(k)}><span class="b">${l}</span><span class="radio"></span></button>`)}</div>
      <button class="btn txt" onClick=${() => setPick(null)}>Đóng</button><//>`}
  </div>`;
}

// ============================== A09 Kiểm tra ngẫu nhiên ==============================
function RateSlider({ label, hint, value, onChange, disabled }) {
  const pct = Math.round(value * 100);
  return html`<div class="stack" style="gap:6px"><div class="row"><div class="grow"><div class="b">${label}</div>${hint && html`<div class="small muted">${hint}</div>`}</div><div class="rangeval">${pct}%</div></div>
    <input class="range" type="range" min="0" max="100" step="1" value=${pct} onInput=${(e) => onChange(Number(e.target.value) / 100)} aria-label=${label} disabled=${disabled}/></div>`;
}
export function RandomCheck({ ctx }) {
  const { storeId } = ctx;
  const st = useAsync(() => api.get(`/random-check?${sq(storeId)}`), [storeId]);
  const [f, setF] = useState(null);
  const [busy, run] = useBusy();
  useEffect(() => { if (st.data) setF({ randomCheckRate: st.data.rules.rate, rateFirstTime: st.data.rules.firstTime, rateHighValue: st.data.rules.highValue, highValueThreshold: st.data.rules.threshold }); }, [st.data]);
  const save = () => run(async () => { await api.put(`/stores/${storeId}/config`, { ...f, highValueThreshold: Number(f.highValueThreshold) || 0 }); await st.reload(); }, 'Đã lưu tỷ lệ kiểm tra');
  const ng = noGuard(cfgOf(ctx.stores, storeId));
  const dirty = st.data && f && (f.randomCheckRate !== st.data.rules.rate || f.rateFirstTime !== st.data.rules.firstTime || f.rateHighValue !== st.data.rules.highValue || Number(f.highValueThreshold) !== st.data.rules.threshold);
  return html`<div class="stack-lg"><${PageHead} title="Kiểm tra ngẫu nhiên" sub="Tỷ lệ khách bị gọi kiểm tra giỏ hàng khi qua cổng"/>
    <${StoreBar} ...${ctx}/>
    ${ng && html`<${Banner} tone="info" icon="info" title="Không có kiểm tra ngẫu nhiên">Chi nhánh này không dùng bảo vệ ở cổng ra, nên không có kiểm tra ngẫu nhiên. Bạn vẫn xem được số liệu cũ bên dưới.<//>`}
    <${Async} state=${st}>${(d) => f && html`<div class="two">
      <div class="card"><h2>Tỷ lệ kiểm tra</h2>
        <${RateSlider} label="Tỷ lệ mặc định" hint="Áp dụng cho mọi giỏ hàng" value=${f.randomCheckRate} onChange=${(v) => setF({ ...f, randomCheckRate: v })} disabled=${ng}/>
        <${RateSlider} label="Khách lần đầu" hint="Khách chưa từng mua bằng Scan & Go" value=${f.rateFirstTime} onChange=${(v) => setF({ ...f, rateFirstTime: v })} disabled=${ng}/>
        <${RateSlider} label="Giỏ hàng giá trị cao" hint="Áp dụng khi giỏ từ ngưỡng bên dưới" value=${f.rateHighValue} onChange=${(v) => setF({ ...f, rateHighValue: v })} disabled=${ng}/>
        <${Field} label="Ngưỡng giỏ giá trị cao (₫)"><input class="input num" type="number" min="0" step="10000" value=${f.highValueThreshold} onInput=${(e) => setF({ ...f, highValueThreshold: e.target.value })} aria-label="Ngưỡng giỏ giá trị cao" disabled=${ng}/><//>
        <button class="btn primary" disabled=${busy || !dirty || ng} onClick=${save}>${busy ? html`<${Spinner} sm/>` : 'Lưu thay đổi'}</button>
        <${Banner} tone="brand" icon="info" title="Gợi ý">Bắt đầu với tỷ lệ cao (20–30%) trong vài tuần đầu, theo dõi chênh lệch rồi giảm dần khi tỷ lệ chênh lệch thấp.<//></div>
      <div class="card"><h2>7 ngày gần nhất</h2><div class="tiles">
        <${Tile} k="Giao dịch đã thu" v=${fmt.num(d.last7.transactions)}/><${Tile} k="Lượt kiểm tra" v=${fmt.num(d.last7.checks)}/>
        <${Tile} k="Chênh lệch" v=${fmt.num(d.last7.mismatches)}/><${Tile} k="Tỷ lệ chênh lệch" v=${fmt.pct(d.last7.mismatchRate)}/></div>
        <div class="hint">Tỷ lệ chênh lệch = số lần chênh lệch / số lượt kiểm tra. Tỷ lệ thực tế lượt kiểm tra trên giao dịch: ${d.last7.transactions ? fmt.pct(d.last7.checks / d.last7.transactions) : '–'}.</div></div></div>`}<//></div>`;
}

// ============================== A10 Đối soát ==============================
/** Phân tích CSV sao kê: hai cột (số tiền, nội dung), chấp nhận , ; hoặc tab, bỏ dòng tiêu đề. */
export function parseStatement(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { lines: [], skipped: 0 };
  const first = lines[0];
  const delim = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const split = (line) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === delim && !q) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur); return out.map((x) => x.trim());
  };
  const num = (s) => {
    let t = String(s).replace(/[₫đĐ\s]|VND|vnd/g, '');
    if (!/^[+-]?[\d.,]+$/.test(t) || !/\d/.test(t)) return null;
    t = t.replace(/^\+/, '');
    t = t.replace(/[.,]\d{1,2}$/, (m) => (/^[.,]0+$/.test(m) ? '' : m)); // phần thập phân .00
    t = t.replace(/[.,](?=\d{3}(\D|$))/g, ''); // dấu ngăn cách nghìn
    const v = Math.round(Number(t.replace(',', '.')));
    return Number.isFinite(v) ? v : null;
  };
  const out = []; let skipped = 0;
  for (const l of lines) {
    const p = split(l);
    let a = num(p[0] ?? ''), content = p.slice(1).join(delim === ';' || delim === '\t' ? ' ' : ', ');
    if (a == null && p.length > 1 && num(p[1]) != null) { a = num(p[1]); content = [p[0], ...p.slice(2)].join(' '); }
    if (a == null) { skipped++; continue; }
    out.push({ amount: a, content: content.trim() });
  }
  return { lines: out, skipped };
}

export function Reconcile({ ctx }) {
  const { storeId } = ctx;
  const [date, setDate] = useState(todayStr());
  const st = useAsync(() => api.get(`/reconcile?${sq(storeId, `&date=${date}`)}`), [storeId, date]);
  const [text, setText] = useState('');
  const [busy, run] = useBusy();
  const file = useRef(null);
  const parsed = parseStatement(text);
  const posMode = isPos(cfgOf(ctx.stores, storeId));
  const pos = useAsync(() => (posMode ? api.get(`/pos/orders?${sq(storeId)}`) : Promise.resolve(null)), [storeId, posMode]);
  const onFile = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setText(await f.text()); } catch { toast('Không đọc được file', 'err'); } e.target.value = ''; };
  const upload = () => run(async () => { await api.post(`/reconcile/statement?${sq(storeId)}`, { date, lines: parsed.lines }); await st.reload(); setText(''); }, 'Đã đối chiếu sao kê');
  return html`<div class="stack-lg"><${PageHead} title="Đối soát" sub="Tiền mặt theo ca và chuyển khoản so với sao kê ngân hàng"/>
    <${StoreBar} ...${ctx}/>
    <div class="card tight"><div class="toolbar"><div class="field"><label for="rc-date">Ngày</label><input id="rc-date" class="input" type="date" value=${date} onChange=${(e) => e.target.value && setDate(e.target.value)}/></div></div></div>
    ${posMode && html`<${Banner} tone="info" icon="info" title="Thu tiền qua Dsmart POS">Tiền thu qua Dsmart POS được đối soát ở Dsmart POS. Dưới đây là đối chiếu từng đơn BRG với Dsmart POS.
      ${pos.data && (() => { const bad = pos.data.orders.filter((o) => o.differs); return bad.length === 0 ? html`<div class="small" style="margin-top:6px">Không có đơn Dsmart POS nào lệch tiền.</div>` : html`<div class="tblwrap" style="margin-top:8px" id="pos-differs"><table class="tbl"><thead><tr><th>Mã giỏ</th><th>Mã đơn Dsmart POS</th><th class="r">Tổng BRG</th><th class="r">Số tiền Dsmart POS</th><th class="r">Lệch</th></tr></thead>
        <tbody>${bad.map((o) => html`<tr class="click differs" key=${o.transactionId} onClick=${() => go(`/transactions/${o.transactionId}`)}><td><b>${o.code}</b></td><td>${o.posOrderRef}</td><td class="r">${fmt.money(o.brgTotal)}</td><td class="r differs-amt">${fmt.money(o.posAmount)}</td><td class="r differs-amt">${o.posAmount > o.brgTotal ? '+' : '−'}${fmt.money(Math.abs(o.posAmount - o.brgTotal))}</td></tr>`)}</tbody></table></div>`; })()}<//>`}
    <${Async} state=${st}>${(d) => html`
      <div class="card"><h2>Ca làm trong ngày</h2>${d.shifts.length === 0 ? html`<div class="muted">Không có ca nào trong ngày này.</div>` : html`<div class="tblwrap"><table class="tbl"><thead><tr><th>Nhân viên</th><th>Ca</th><th>Giờ</th><th class="r">Tiền mặt hệ thống</th><th class="r">Đếm thực tế</th><th class="r">Chênh lệch</th><th>Ghi chú</th></tr></thead>
        <tbody>${d.shifts.map((s) => html`<tr key=${s.id}><td><b>${s.name}</b><div class="sub">${s.staffId}</div></td><td>${SHIFT_VI[s.kind] || s.kind}</td>
          <td>${fmt.time(s.startedAt)} – ${s.open ? html`<${Pill} tone="info">Đang mở<//>` : fmt.time(s.endedAt)}</td>
          <td class="r">${fmt.money(s.systemCash)}</td><td class="r">${s.countedCash == null ? '–' : fmt.money(s.countedCash)}</td>
          <td class="r">${s.diff == null ? '–' : s.diff === 0 ? html`<${Pill} tone="ok">Khớp<//>` : html`<${Pill} tone="err">${s.diff > 0 ? '+' : ''}${fmt.money(s.diff)}<//>`}</td><td class="wrap">${s.note || ''}</td></tr>`)}</tbody></table></div>`}</div>
      <div class="card"><h2>Chuyển khoản</h2><div class="grid2"><${Tile} k="Tổng theo hệ thống" v=${fmt.money(d.transfer.systemTotal)}/><${Tile} k="Số giao dịch" v=${fmt.num(d.transfer.count)}/></div>
        <hr class="divider"/>
        <div class="b">Tải lên sao kê ngân hàng</div>
        <div class="small muted">Dán nội dung CSV hoặc chọn file. Mỗi dòng gồm hai cột: số tiền, nội dung chuyển khoản. Dấu phân cách có thể là phẩy hoặc chấm phẩy; dòng tiêu đề tự bỏ qua.</div>
        <textarea class="input textarea-mono" placeholder=${'Số tiền,Nội dung\n125000,SG Q7 0003 thanh toan'} value=${text} onInput=${(e) => setText(e.target.value)} aria-label="Nội dung sao kê CSV"></textarea>
        <div class="row wrap"><input ref=${file} type="file" accept=".csv,.txt,text/csv,text/plain" class="hide" onChange=${onFile} aria-label="Chọn file sao kê"/>
          <button class="btn sm line" onClick=${() => file.current?.click()}><${Icon} name="download" size=${18}/>Chọn file CSV</button>
          ${text && html`<span class="small muted">Đọc được <b>${parsed.lines.length}</b> dòng, tổng ${fmt.money(parsed.lines.reduce((a, l) => a + l.amount, 0))}${parsed.skipped ? `, bỏ qua ${parsed.skipped} dòng` : ''}</span>`}
          <button class="btn sm primary end" disabled=${busy || !parsed.lines.length} onClick=${upload}>${busy ? html`<${Spinner} sm/>` : 'Đối chiếu'}</button></div>
        ${d.transfer.statement && html`<${Statement} s=${d.transfer.statement} sys=${d.transfer.systemTotal}/>`}
      </div>`}<//></div>`;
}

function Statement({ s, sys }) {
  const clean = s.onlySystem.length === 0 && s.onlyStatement.length === 0;
  return html`<div class="stack" id="stmt-result"><hr class="divider"/>
    <div class="row wrap"><div class="b">Kết quả đối chiếu</div><span class="small muted">Tải lên lúc ${fmt.dateTime(s.uploadedAt)}</span></div>
    ${clean ? html`<${Banner} tone="ok" icon="check" title="Khớp hoàn toàn">Tất cả ${s.matched} giao dịch chuyển khoản khớp với sao kê.<//>` : html`<${Banner} title="Có chênh lệch cần kiểm tra">Khớp ${s.matched} giao dịch. Hệ thống có ${s.onlySystem.length} giao dịch không thấy trong sao kê, sao kê có ${s.onlyStatement.length} dòng không có trong hệ thống.<//>`}
    <div class="tiles"><${Tile} k="Tổng sao kê" v=${fmt.money(s.total)}/><${Tile} k="Tổng hệ thống" v=${fmt.money(sys)}/><${Tile} k="Dòng sao kê" v=${fmt.num(s.lines)}/><${Tile} k="Khớp" v=${fmt.num(s.matched)}/></div>
    ${s.onlySystem.length > 0 && html`<div><div class="b" style="margin-bottom:6px">Chỉ có ở hệ thống (${s.onlySystem.length})</div><div class="tblwrap"><table class="tbl"><thead><tr><th>Giao dịch</th><th>Nội dung</th><th class="r">Số tiền</th></tr></thead><tbody>${s.onlySystem.map((x) => html`<tr key=${x.id} class="click" onClick=${() => go(`/transactions/${x.id}`)}><td>${x.id}</td><td>${x.content}</td><td class="r">${fmt.money(x.amount)}</td></tr>`)}</tbody></table></div></div>`}
    ${s.onlyStatement.length > 0 && html`<div><div class="b" style="margin-bottom:6px">Chỉ có ở sao kê (${s.onlyStatement.length})</div><div class="tblwrap"><table class="tbl"><thead><tr><th>Nội dung</th><th class="r">Số tiền</th></tr></thead><tbody>${s.onlyStatement.map((x, i) => html`<tr key=${i}><td class="wrap">${x.content || '(trống)'}</td><td class="r">${fmt.money(x.amount)}</td></tr>`)}</tbody></table></div></div>`}
  </div>`;
}

// ============================== A11 Mã quét không tìm thấy ==============================
const UB = { new: ['Mới', 'warn'], reported: ['Đã báo Dsmart POS', 'info'], resolved: ['Đã xử lý', 'ok'] };
export function Unknown({ ctx }) {
  const { storeId } = ctx;
  const [status, setStatus] = useState('');
  const st = useAsync(() => api.get(`/unknown-barcodes?${sq(storeId)}${status ? `&status=${status}` : ''}`), [storeId, status]);
  const [key, setKey] = useState('');
  const change = async (barcode, v) => {
    if (key) return; setKey(barcode);
    try { await api.put(`/unknown-barcodes?${sq(storeId)}`, { barcode, status: v }); toast('Đã cập nhật', 'ok'); await st.reload(); } catch (e) { toast(e.message, 'err'); } finally { setKey(''); }
  };
  return html`<div class="stack-lg"><${PageHead} title="Mã quét không tìm thấy" sub="Mã vạch khách quét nhưng không có trong dữ liệu Dsmart POS. Báo bộ phận hàng hoá để bổ sung."/>
    <${StoreBar} ...${ctx}/>
    <div class="card tight"><div class="toolbar"><div class="field"><label for="u-st">Hiển thị</label><select id="u-st" class="input" value=${status} onChange=${(e) => setStatus(e.target.value)}><option value="">Chưa xử lý xong</option><option value="new">Mới</option><option value="reported">Đã báo Dsmart POS</option><option value="resolved">Đã xử lý</option></select></div></div></div>
    <${Async} state=${st}>${(d) => d.items.length === 0 ? html`<${Empty} icon="barcode" title="Không có mã nào" text="Chưa có mã vạch lạ trong nhóm này."/>` : html`<div class="card"><div class="tblwrap"><table class="tbl"><thead><tr><th>Mã vạch</th><th class="r">Số lần quét</th><th>Lần cuối</th><th>Trạng thái</th></tr></thead>
      <tbody>${d.items.map((i) => html`<tr key=${i.barcode}><td><b>${i.barcode}</b></td><td class="r">${i.count}</td><td>${fmt.when(i.lastSeen)}</td>
        <td><select class="input sm" style="width:auto" value=${i.status} disabled=${!!key} onChange=${(e) => change(i.barcode, e.target.value)} aria-label=${`Trạng thái mã ${i.barcode}`}>${Object.entries(UB).map(([k, [l]]) => html`<option value=${k} key=${k}>${l}</option>`)}</select></td></tr>`)}</tbody></table></div></div>`}<//></div>`;
}
