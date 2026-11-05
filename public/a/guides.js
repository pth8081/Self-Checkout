// Trang Hướng dẫn trong web quản trị: danh sách tài liệu theo nhóm và trình đọc có mục lục.
import { html, useState, useEffect, useMemo, useAsync, fmt } from '/shared/lib.js';
import { api, PageHead, Async, Icon, Pill, Empty } from '/a/common.js';
import { parseMarkdown, plainText, Markdown, jumpTo } from '/a/guide-render.js';

export const GUIDE_GROUPS = {
  'nghiep-vu': { title: 'Hướng dẫn nghiệp vụ', path: 'huong-dan', icon: 'docok', sub: 'Quy trình mua sắm, thanh toán, cổng ra và đối soát, giải thích từng bước.' },
  'he-thong': { title: 'Hướng dẫn hệ thống', path: 'huong-dan-he-thong', icon: 'settings', sub: 'Cấu hình, tích hợp và vận hành hệ thống.' }
};

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

function useMedia(q) {
  const [on, setOn] = useState(() => matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q), f = () => setOn(m.matches); f(); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, [q]);
  return on;
}

// ============================== Danh sách ==============================
export function GuideList({ group }) {
  const g = GUIDE_GROUPS[group];
  const st = useAsync(() => api.get('/guides'), []);
  const [q, setQ] = useState('');
  return html`<div class="stack-lg">
    <${PageHead} title=${g.title} sub=${g.sub}/>
    <${Async} state=${st}>${(d) => {
      const all = d.guides.filter((x) => x.group === group);
      const nq = norm(q).trim();
      const list = nq ? all.filter((x) => norm(`${x.title} ${x.summary}`).includes(nq)) : all;
      if (!all.length) return html`<div class="card"><${Empty} icon=${g.icon} title="Chưa có tài liệu" text="Nhóm này hiện chưa có tài liệu nào dành cho bạn."/></div>`;
      return html`
        <div class="guide-search"><${Icon} name="search"/><input class="input" type="search" placeholder="Tìm theo tiêu đề hoặc mô tả" aria-label="Tìm tài liệu" value=${q} onInput=${(e) => setQ(e.target.value)}/></div>
        ${list.length === 0 ? html`<div class="card"><${Empty} icon="search" title="Không có tài liệu phù hợp" text=${`Không thấy tài liệu nào khớp với "${q}".`}><button class="btn sm line" onClick=${() => setQ('')}>Xoá tìm kiếm</button><//></div>`
        : html`<div class="guide-grid">${list.map((x, i) => html`<a class="card guide-card" key=${x.id} href=${`#/huong-dan/${x.id}`}>
          <div class="row"><div class="ico-tile"><${Icon} name=${g.icon}/></div><div class="grow"><h2>${x.title}</h2></div><${Icon} name="chev" class="muted"/></div>
          ${x.summary && html`<p class="muted">${x.summary}</p>`}
          <div class="row wrap small muted"><span>Cập nhật ${fmt.dateFull(x.updatedAt)}</span>${x.access === 'chain' && html`<${Pill} tone="brand">Chỉ quản trị chuỗi<//>`}</div></a>`)}</div>`}`;
    }}<//></div>`;
}

// ============================== Mục lục ==============================
function TocList({ toc, active, onPick }) {
  return html`<ol class="guide-toclist">${toc.map((t) => html`<li key=${t.id} class=${`l${t.level} ${active === t.id ? 'on' : ''}`}>
    <a href=${`#${t.id}`} aria-current=${active === t.id ? 'location' : undefined} onClick=${(e) => { jumpTo(t.id, e); onPick?.(); }}>${t.text}</a></li>`)}</ol>`;
}

function useActiveHeading(toc) {
  const [active, setActive] = useState('');
  useEffect(() => {
    if (!toc.length) return undefined;
    let raf = 0;
    const calc = () => {
      raf = 0;
      let cur = '';
      for (const t of toc) { const el = document.getElementById(t.id); if (el && el.getBoundingClientRect().top <= 110) cur = t.id; }
      setActive(cur);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(calc); };
    calc(); addEventListener('scroll', on, { passive: true }); addEventListener('resize', on);
    return () => { removeEventListener('scroll', on); removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); };
  }, [toc]);
  return active;
}

// ============================== Trang đọc ==============================
export function GuideDoc({ id, query, onGroup }) {
  const doc = useAsync(() => api.get(`/guides/${encodeURIComponent(id)}`), [id]);
  const all = useAsync(() => api.get('/guides'), []);
  const wide = useMedia('(min-width: 1100px)');
  const parsed = useMemo(() => {
    if (!doc.data) return null;
    const p = parseMarkdown(doc.data.body), b0 = p.blocks[0];
    // Tiêu đề cấp 1 trùng tên tài liệu đã hiện ở đầu trang, bỏ để khỏi lặp.
    if (b0?.type === 'heading' && b0.level === 1 && norm(plainText(b0.text)) === norm(doc.data.title)) p.blocks = p.blocks.slice(1);
    return p;
  }, [doc.data]);
  const toc = parsed?.toc || [];
  const active = useActiveHeading(toc);
  useEffect(() => { if (doc.data) onGroup?.(doc.data.group); }, [doc.data]);
  useEffect(() => {
    if (!parsed || !query?.h) return undefined;
    const t = setTimeout(() => { const el = document.getElementById(query.h); if (el) el.scrollIntoView({ block: 'start' }); }, 60);
    return () => clearTimeout(t);
  }, [parsed, id]);

  if (doc.error && doc.error.status === 404) {
    return html`<div class="card"><${Empty} icon="doc" title="Không tìm thấy tài liệu" text="Tài liệu này không tồn tại hoặc bạn không có quyền xem."><a class="btn sm line" href="#/huong-dan">Về danh sách hướng dẫn</a><//></div>`;
  }
  return html`<${Async} state=${doc}>${(d) => {
    const g = GUIDE_GROUPS[d.group] || GUIDE_GROUPS['nghiep-vu'];
    const sibs = (all.data?.guides || []).filter((x) => x.group === d.group);
    const at = sibs.findIndex((x) => x.id === d.id);
    const prev = at > 0 ? sibs[at - 1] : null, next = at >= 0 && at < sibs.length - 1 ? sibs[at + 1] : null;
    const showToc = toc.length >= 2;
    return html`<div class="guide-doc stack-lg">
      <a class="guide-back guide-noprint" href=${`#/${g.path}`}><${Icon} name="chevl"/>${g.title}</a>
      <${PageHead} title=${d.title} sub=${d.summary}>
        <button class="btn sm line guide-noprint" onClick=${() => window.print()}><${Icon} name="doc" size=${18}/>In</button><//>
      <div class=${`guide-layout ${showToc ? 'has-toc' : ''}`}>
        ${showToc && (wide
          ? html`<nav class="guide-toc guide-noprint" aria-label="Mục lục"><div class="label">Mục lục</div><${TocList} toc=${toc} active=${active}/></nav>`
          : html`<details class="guide-tocm card tight guide-noprint"><summary><${Icon} name="list"/>Mục lục<span class="muted small">${toc.length} mục</span></summary><${TocList} toc=${toc} active=${active} onPick=${(e) => e}/></details>`)}
        <article class="card guide-article"><${Markdown} doc=${parsed}/>
          <div class="small muted guide-updated">Cập nhật lần cuối ${fmt.dateFull(d.updatedAt)}</div></article>
      </div>
      ${(prev || next) && html`<nav class="guide-pn guide-noprint" aria-label="Tài liệu trước và sau">
        ${prev ? html`<a class="card tight pn" href=${`#/huong-dan/${prev.id}`}><${Icon} name="chevl"/><div><div class="small muted">Tài liệu trước</div><b>${prev.title}</b></div></a>` : html`<span></span>`}
        ${next ? html`<a class="card tight pn r" href=${`#/huong-dan/${next.id}`}><div><div class="small muted">Tài liệu sau</div><b>${next.title}</b></div><${Icon} name="chev"/></a>` : html`<span></span>`}</nav>`}
    </div>`;
  }}<//>`;
}

