// Bộ hiển thị Markdown (tập con) và vẽ sơ đồ SVG cho trang Hướng dẫn.
// Không dùng innerHTML: nội dung được phân tích thành cây rồi dựng bằng Preact (chữ được escape tự động).
import { html, h, useState, useEffect, useMemo, Icon } from '/shared/lib.js';
import { DiagramError, parseSeq, layoutSeq, parseFlow, layoutFlow, setMeasure } from '/a/guide-diagram.js';

// ---- Đo chữ bằng canvas theo phông thật ----
if (typeof document !== 'undefined') {
  let ctx = null;
  setMeasure((text, size, weight) => {
    ctx = ctx || document.createElement('canvas').getContext('2d');
    ctx.font = `${weight} ${size}px Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif`;
    return ctx.measureText(text).width;
  });
}
/** Đổi giá trị khi phông Inter tải xong để vẽ lại sơ đồ với số đo đúng. */
function useFontsTick() {
  const [t, setT] = useState(0);
  useEffect(() => {
    let off = false;
    const fs = document.fonts;
    if (!fs?.load) return undefined;
    Promise.all([fs.load('13px Inter', 'Việt ơ ư'), fs.load('600 13px Inter', 'Việt ơ ư'), fs.load('500 13px Inter', 'Việt ơ ư')]).then(() => fs.ready).then(() => { if (!off) setT(1); }).catch(() => {});
    return () => { off = true; };
  }, []);
  return t;
}

// ============================== Phân tích Markdown ==============================
export function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'muc';
}
/** Bỏ ký hiệu định dạng để lấy chữ thuần (cho mục lục và id). */
export function plainText(s) {
  return String(s).replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`([^`]*)`/g, '$1').replace(/\*\*|\*/g, '').replace(/\\(.)/g, '$1').trim();
}

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w-]*)\s*.*$/;
const HEADING = /^(#{1,4})\s+(.*?)\s*#*\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TSEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const CALLOUT = /^\*\*(Lưu ý|Cần xác nhận|Quan trọng)\s*:?\s*\*\*\s*:?\s*(.*)$/i;
const TONES = { 'lưu ý': ['info', 'Lưu ý'], 'cần xác nhận': ['warn', 'Cần xác nhận'], 'quan trọng': ['err', 'Quan trọng'] };

const splitRow = (line) => {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
};
const isTableStart = (lines, i) => lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && TSEP.test(lines[i + 1]) && splitRow(lines[i]).length >= 1;

function buildList(items, j, indent) {
  const list = { type: 'list', ordered: items[j].ordered, start: items[j].num, items: [] };
  while (j < items.length && items[j].indent >= indent) {
    if (items[j].indent > indent) {
      const [sub, nj] = buildList(items, j, items[j].indent);
      (list.items[list.items.length - 1] || list.items[list.items.push({ text: '', children: [] }) - 1]).children.push(sub); j = nj; continue;
    }
    if (items[j].ordered !== list.ordered) break; // đổi kiểu danh sách ở cùng cấp: bắt đầu danh sách mới
    const it = { text: items[j].text, children: [] }; list.items.push(it); j++;
    if (j < items.length && items[j].indent > indent) { const [sub, nj] = buildList(items, j, items[j].indent); it.children.push(sub); j = nj; }
  }
  return [list, j];
}

function parseBlocks(lines, ctx, top) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = FENCE.exec(line)) && (m[1][0] === '`' || m[1][0] === '~')) {
      const fence = m[1], lang = m[2].toLowerCase(), start = i + 1, body = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence) && lines[i].trim().replace(new RegExp(`^\\${fence[0]}+`), '').trim() === '')) body.push(lines[i++]);
      i++; // dòng đóng
      if (lang === 'seq' || lang === 'flow') blocks.push({ type: 'diagram', kind: lang, src: body.join('\n'), line: start });
      else blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }
    if ((m = HEADING.exec(line))) {
      const level = m[1].length, text = m[2];
      let id = slugify(plainText(text)); const n = ctx.ids.get(id) || 0; ctx.ids.set(id, n + 1); if (n) id = `${id}-${n + 1}`;
      blocks.push({ type: 'heading', level, text, id });
      if (top && (level === 2 || level === 3)) ctx.toc.push({ level, text: plainText(text), id });
      i++; continue;
    }
    if (HR.test(line) && !LI.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
    if (/^\s*>/.test(line)) {
      const inner = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) inner.push(lines[i++].replace(/^\s*> ?/, ''));
      const firstIdx = inner.findIndex((l) => l.trim());
      const cm = firstIdx >= 0 ? CALLOUT.exec(inner[firstIdx].trim()) : null;
      if (cm) {
        const [tone, title] = TONES[cm[1].toLowerCase()];
        inner[firstIdx] = cm[2];
        blocks.push({ type: 'callout', tone, title, children: parseBlocks(inner, ctx, false) });
      } else blocks.push({ type: 'quote', children: parseBlocks(inner, ctx, false) });
      continue;
    }
    if (LI.test(line)) {
      const items = [];
      while (i < lines.length) {
        const l = lines[i], lm = LI.exec(l);
        if (lm) { items.push({ indent: lm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(lm[2]), num: parseInt(lm[2], 10), text: lm[3].trim() }); i++; continue; }
        if (!l.trim()) { let k = i; while (k < lines.length && !lines[k].trim()) k++; if (k < lines.length && LI.test(lines[k])) { i = k; continue; } break; }
        if (/^\s+\S/.test(l) && items.length && !FENCE.test(l)) { items[items.length - 1].text += ` ${l.trim()}`; i++; continue; }
        break;
      }
      let j = 0;
      while (j < items.length) { const [list, nj] = buildList(items, j, items[j].indent); blocks.push(list); j = nj; }
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      blocks.push({ type: 'table', head, aligns, rows });
      continue;
    }
    // Đoạn văn
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !/^\s*>/.test(lines[i]) && !LI.test(lines[i]) && !(HR.test(lines[i])) && !isTableStart(lines, i)) para.push(lines[i++].trim());
    blocks.push({ type: 'p', text: para.join(' ') });
  }
  return blocks;
}

/** Trả về { blocks, toc } từ văn bản Markdown. */
export function parseMarkdown(src) {
  const ctx = { ids: new Map(), toc: [] };
  const lines = String(src).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  return { blocks: parseBlocks(lines, ctx, true), toc: ctx.toc };
}

// ============================== Chữ trong dòng ==============================
const SAFE_URL = /^(https?:\/\/[^\s<>"]+|#\/[^\s<>"]*)$/i;
function matchBracket(s, i, open, close) {
  let d = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === '\\') { k++; continue; }
    if (s[k] === open) d++; else if (s[k] === close && --d === 0) return k;
  }
  return -1;
}
export function inline(s) {
  const out = [];
  let buf = '', i = 0;
  const flush = () => { if (buf) { out.push(buf); buf = ''; } };
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!|>~]/.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i) { flush(); out.push(h('code', { class: 'gd-icode' }, s.slice(i + 1, j))); i = j + 1; continue; }
    }
    if (c === '[') {
      const k = matchBracket(s, i, '[', ']');
      if (k > 0 && s[k + 1] === '(') {
        const e = matchBracket(s, k + 1, '(', ')');
        if (e > 0) {
          const label = s.slice(i + 1, k), url = s.slice(k + 2, e).trim();
          flush();
          if (SAFE_URL.test(url)) {
            const ext = /^https?:/i.test(url);
            out.push(h('a', { href: url, ...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, ...inline(label)));
          } else out.push(...inline(label));
          i = e + 1; continue;
        }
      }
    }
    if (c === '*' && s[i + 1] === '*') {
      const j = s.indexOf('**', i + 2);
      if (j > i + 2) { flush(); out.push(h('strong', null, ...inline(s.slice(i + 2, j)))); i = j + 2; continue; }
    } else if (c === '*') {
      let j = i + 1;
      while (j < s.length && !(s[j] === '*' && s[j + 1] !== '*' && s[j - 1] !== '*' && s[j - 1] !== '\\')) j++;
      if (j < s.length && j > i + 1 && s[i + 1] !== ' ') { flush(); out.push(h('em', null, ...inline(s.slice(i + 1, j)))); i = j + 1; continue; }
    }
    buf += c; i++;
  }
  flush();
  return out;
}

// ============================== Dựng khối ==============================
function jumpTo(id, e) {
  e?.preventDefault();
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  try { const base = location.hash.split('?')[0]; history.replaceState(null, '', `${base}?h=${id}`); } catch { /* bỏ qua */ }
}
export { jumpTo };

function List({ b }) {
  const Tag = b.ordered ? 'ol' : 'ul';
  return h(Tag, { class: 'gd-list', ...(b.ordered && b.start > 1 ? { start: b.start } : {}) },
    ...b.items.map((it, k) => h('li', { key: k }, ...inline(it.text), ...it.children.map((c, n) => h(List, { b: c, key: n })))));
}

function Block({ b }) {
  switch (b.type) {
    case 'p': return h('p', null, ...inline(b.text));
    case 'heading': return h(`h${b.level}`, { id: b.id, class: 'gd-h' }, ...inline(b.text));
    case 'hr': return h('hr', { class: 'gd-hr' });
    case 'code': return h('pre', { class: 'gd-code', tabindex: 0 }, h('code', null, b.text));
    case 'list': return h(List, { b });
    case 'quote': return h('blockquote', { class: 'gd-quote' }, ...b.children.map((c, k) => h(Block, { b: c, key: k })));
    case 'callout': return html`<div class=${`banner ${b.tone} gd-callout`} role="note"><${Icon} name=${b.tone === 'info' ? 'info' : 'alert'}/>
      <div class="grow"><b>${b.title}</b>${b.children.map((c, k) => h(Block, { b: c, key: k }))}</div></div>`;
    case 'table': return html`<div class="tblwrap gd-tbl" tabindex="0"><table class="tbl gd-table"><thead><tr>${b.head.map((c, k) => html`<th key=${k} style=${b.aligns[k] ? `text-align:${b.aligns[k]}` : ''}>${inline(c)}</th>`)}</tr></thead>
      <tbody>${b.rows.map((r, n) => html`<tr key=${n}>${b.head.map((_, k) => html`<td key=${k} style=${b.aligns[k] ? `text-align:${b.aligns[k]}` : ''}>${inline(r[k] ?? '')}</td>`)}</tr>`)}</tbody></table></div>`;
    case 'diagram': return h(Diagram, { kind: b.kind, src: b.src });
    default: return null;
  }
}

/** Hiển thị kết quả của parseMarkdown. */
export function Markdown({ doc }) {
  return html`<div class="gd-md">${doc.blocks.map((b, k) => h(Block, { b, key: k }))}</div>`;
}

// ============================== Sơ đồ SVG ==============================
const fx = (v) => Math.round(v * 10) / 10;
function Tspans({ lines, x, top, lh, anchor = 'middle', cls = '', weight }) {
  return h('text', { class: cls, 'text-anchor': anchor, ...(weight ? { 'font-weight': weight } : {}) },
    ...lines.map((t, i) => h('tspan', { key: i, x: fx(x), y: fx(top + (i + 0.5) * lh + 4.6) }, t)));
}
const Head = ({ x, y, dx, dy, cls }) => {
  const bx = x - dx * 10, by = y - dy * 10, nx = -dy * 5, ny = dx * 5;
  return h('polygon', { class: cls, points: `${fx(x)},${fx(y)} ${fx(bx + nx)},${fx(by + ny)} ${fx(bx - nx)},${fx(by - ny)}` });
};
const svgStyle = (w) => `width:100%;min-width:${Math.round(w * 0.8)}px;max-width:${Math.round(w)}px;height:auto`;

function SeqSvg({ lay, label }) {
  const { actors, lh } = lay;
  const box = (a, i, y, k) => html`<g key=${`${k}${i}`}><rect class="gd-actor" x=${fx(a.x - a.w / 2)} y=${y} width=${a.w} height=${a.h} rx="12"/>
    <${Tspans} lines=${a.lines} x=${a.x} top=${y + (a.h - a.lines.length * lh) / 2} lh=${lh} cls="gd-t b" weight="600"/></g>`;
  return html`<svg class="gd-svg" viewBox=${lay.viewBox.join(' ')} style=${svgStyle(lay.width)} role="img" aria-label=${label}>
    ${actors.map((a, i) => html`<line key=${i} class="gd-life" x1=${a.x} x2=${a.x} y1=${lay.lifeY1} y2=${lay.lifeY2}/>`)}
    ${lay.dividers.map((d, i) => html`<g key=${i}><line class="gd-div" x1=${fx(d.x1)} x2=${fx(d.x2)} y1=${d.y} y2=${d.y}/>
      ${d.text && html`<rect class="gd-divbg" x=${fx(d.cx - d.tw / 2)} y=${d.y - 12} width=${d.tw} height="24" rx="12"/>
      <text class="gd-t b" x=${fx(d.cx)} y=${d.y + 4.6} text-anchor="middle" font-weight="600">${d.text}</text>`}</g>`)}
    ${lay.notes.map((n, i) => html`<g key=${i}><rect class="gd-note" x=${fx(n.x)} y=${fx(n.y)} width=${fx(n.w)} height=${fx(n.h)} rx="8"/>
      <${Tspans} lines=${n.lines} x=${n.x + n.w / 2} top=${n.y + (n.h - n.lines.length * lh) / 2} lh=${lh} cls="gd-t"/></g>`)}
    ${lay.arrows.map((a, i) => html`<g key=${i}>
      ${a.self ? html`<path class=${`gd-arrow ${a.dashed ? 'dash' : ''}`} d=${`M${a.x1},${fx(a.y)}H${a.x2}V${fx(a.y2)}H${a.x1 + 2}`} fill="none"/><${Head} x=${a.x1} y=${a.y2} dx=${-1} dy=${0} cls="gd-head"/>`
      : html`<line class=${`gd-arrow ${a.dashed ? 'dash' : ''}`} x1=${a.x1} x2=${fx(a.x2 - a.dir * 8)} y1=${fx(a.y)} y2=${fx(a.y)}/><${Head} x=${a.x2} y=${a.y} dx=${a.dir} dy=${0} cls="gd-head"/>`}
      ${a.num != null && html`<circle class="gd-num" cx=${fx(a.numX)} cy=${fx(a.numY)} r="9"/><text class="gd-numt" x=${fx(a.numX)} y=${fx(a.numY + 3.8)} text-anchor="middle">${a.num}</text>`}</g>`)}
    ${lay.labels.map((l, i) => html`<${Tspans} key=${i} lines=${l.lines} x=${l.x} top=${l.top} lh=${lh} anchor=${l.anchor} cls="gd-t"/>`)}
    ${actors.map((a, i) => box(a, i, lay.topY, 't'))}
    ${actors.map((a, i) => box(a, i, lay.bottomY, 'b'))}
  </svg>`;
}

function FlowSvg({ lay, label }) {
  const { lh, lblLH } = lay;
  const shape = (n) => {
    switch (n.shape) {
      case 'diamond': return html`<polygon class="gd-n dia" points=${`${fx(n.cx)},${fx(n.y)} ${fx(n.x + n.w)},${fx(n.cy)} ${fx(n.cx)},${fx(n.y + n.h)} ${fx(n.x)},${fx(n.cy)}`}/>`;
      case 'circle': return html`<ellipse class="gd-n cir" cx=${fx(n.cx)} cy=${fx(n.cy)} rx=${fx(n.w / 2)} ry=${fx(n.h / 2)}/>`;
      case 'pill': return html`<rect class="gd-n pill" x=${fx(n.x)} y=${fx(n.y)} width=${fx(n.w)} height=${fx(n.h)} rx=${fx(n.h / 2)}/>`;
      default: return html`<rect class="gd-n" x=${fx(n.x)} y=${fx(n.y)} width=${fx(n.w)} height=${fx(n.h)} rx="10"/>`;
    }
  };
  return html`<svg class="gd-svg" viewBox=${lay.viewBox.join(' ')} style=${svgStyle(lay.width)} role="img" aria-label=${label}>
    ${lay.groups.map((g, i) => html`<g key=${i}><rect class="gd-group" x=${fx(g.x)} y=${fx(g.y)} width=${fx(g.w)} height=${fx(g.h)} rx="14"/>
      <text class="gd-gt" x=${fx(g.x + 12)} y=${fx(g.y + 19)}>${g.name}</text></g>`)}
    ${lay.edges.map((e, i) => html`<path key=${`p${i}`} class=${`gd-edge ${e.dashed ? 'dash' : ''}`} d=${e.d} fill="none"/>`)}
    ${lay.edges.map((e, i) => html`<${Head} key=${`h${i}`} x=${e.tip.x} y=${e.tip.y} dx=${e.dir.x} dy=${e.dir.y} cls="gd-head"/>`)}
    ${lay.edges.map((e, i) => e.label && html`<g key=${`l${i}`}><rect class="gd-lblbg" x=${fx(e.label.x)} y=${fx(e.label.y)} width=${fx(e.label.w)} height=${fx(e.label.h)} rx="6"/>
      <${Tspans} lines=${e.label.lines} x=${e.label.x + e.label.w / 2} top=${e.label.y + 3} lh=${lblLH} cls="gd-lbl"/></g>`)}
    ${lay.nodes.map((n) => html`<g key=${n.id}>${shape(n)}<${Tspans} lines=${n.lines} x=${n.cx} top=${n.cy - (n.lines.length * lh) / 2} lh=${lh} cls="gd-t nt"/></g>`)}
  </svg>`;
}

function DiagramError_({ err, src, kind }) {
  const bad = err.line || 0;
  return html`<div class="gd-err" role="alert">
    <div class="banner err"><${Icon} name="alert"/><div class="grow"><b>Không vẽ được sơ đồ ${kind === 'seq' ? 'tuần tự' : 'lưu đồ'}</b>${bad ? `Dòng ${bad}: ` : ''}${err.message}</div></div>
    <pre class="gd-code" tabindex="0"><code>${String(src).split('\n').map((l, i) => html`<span class=${`ln ${i + 1 === bad ? 'bad' : ''}`} key=${i}><i>${i + 1}</i>${l || ' '}</span>`)}</code></pre></div>`;
}

/** Một sơ đồ: phân tích, bố trí, vẽ. Lỗi chỉ ảnh hưởng đúng sơ đồ này. */
export function Diagram({ kind, src }) {
  const tick = useFontsTick();
  const res = useMemo(() => {
    try {
      if (kind === 'seq') { const m = parseSeq(src); return { m, lay: layoutSeq(m) }; }
      const m = parseFlow(src); return { m, lay: layoutFlow(m) };
    } catch (e) {
      return { err: e instanceof DiagramError ? e : new DiagramError(0, `Lỗi khi bố trí sơ đồ (${e.message})`) };
    }
  }, [kind, src, tick]);
  if (res.err) return h(DiagramError_, { err: res.err, src, kind });
  const title = res.m.title, label = title || (kind === 'seq' ? 'Sơ đồ tuần tự' : 'Lưu đồ');
  return html`<figure class="gd-fig">${title && html`<figcaption class="gd-cap" aria-hidden="true">${title}</figcaption>`}
    <div class="gd-scroll" tabindex="0">${kind === 'seq' ? h(SeqSvg, { lay: res.lay, label }) : h(FlowSvg, { lay: res.lay, label })}</div></figure>`;
}
