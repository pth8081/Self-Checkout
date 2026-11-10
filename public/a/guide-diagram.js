// Phân tích và bố trí sơ đồ cho trang Hướng dẫn: sơ đồ tuần tự (seq) và lưu đồ (flow).
// Toàn bộ là hàm thuần (không phụ thuộc trình duyệt) nên kiểm thử được bằng Node.
// Kết quả bố trí là mô hình hình học đơn giản; guide-render.js chuyển nó thành SVG.

export class DiagramError extends Error {
  constructor(line, message) { super(message); this.line = line; }
}

// ---------------------------------------------------------------- Đo chữ
const NARROW = new Set('iljtfr.,:;!|\'` ()[]{}-/\\I1'.split(''));
const WIDE = new Set('mwMW@%'.split(''));
/** Ước lượng khi không có canvas (Node). Phông Inter: trung bình khoảng 0,56 em. */
function estimate(text, size, weight) {
  let w = 0;
  for (const ch of String(text)) w += NARROW.has(ch) ? 0.3 : WIDE.has(ch) ? 0.86 : /[A-ZĐ]/.test(ch) ? 0.68 : 0.56;
  return w * size * (weight >= 600 ? 1.05 : 1);
}
let measureImpl = estimate;
/** Cho phép thay hàm đo (trình duyệt dùng canvas để chính xác theo phông thật). */
export function setMeasure(fn) { measureImpl = fn || estimate; }
const SAFETY = 1.04;
export const textWidth = (text, size = 13, weight = 400) => measureImpl(text, size, weight) * SAFETY;

/** Xuống dòng theo chiều rộng tối đa; từ quá dài thì cắt theo ký tự. Hỗ trợ <br> hoặc \n. */
export function wrapText(text, maxW, size = 13, weight = 400) {
  const out = [];
  for (const para of String(text).split(/<br\s*\/?>|\\n|\n/i)) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    let cur = '';
    const push = () => { if (cur) out.push(cur); cur = ''; };
    for (let w of words) {
      while (textWidth(w, size, weight) > maxW && w.length > 1) { // từ dài hơn cả dòng
        let k = w.length - 1;
        while (k > 1 && textWidth(w.slice(0, k), size, weight) > maxW) k--;
        push(); out.push(w.slice(0, k)); w = w.slice(k);
      }
      const t = cur ? `${cur} ${w}` : w;
      if (cur && textWidth(t, size, weight) > maxW) { push(); cur = w; } else cur = t;
    }
    push();
  }
  return out.length ? out : [''];
}
const maxLineW = (lines, size, weight) => Math.max(0, ...lines.map((l) => textWidth(l, size, weight)));

// ---------------------------------------------------------------- Sơ đồ tuần tự: phân tích
const SEQ_MSG = /^([^:]+?)\s*(-->|->)\s*([^:]+?)\s*(?::\s*(.*))?$/;
const SEQ_NOTE = /^note\s+over\s+([^:]+?)\s*:\s*(.*)$/i;
const SEQ_DIV = /^==\s*(.*?)\s*==$/;

/** Phân tích văn bản ```seq. Ném DiagramError(line, thông báo) khi sai. */
export function parseSeq(src) {
  const m = { kind: 'seq', title: '', actors: [], numbered: true, items: [] };
  let declared = false;
  const lines = String(src).replace(/\r/g, '').split('\n');
  const known = (name, ln) => {
    if (m.actors.includes(name)) return name;
    if (declared) throw new DiagramError(ln, `Chưa khai báo "${name}" trong dòng actors`);
    m.actors.push(name); return name;
  };
  lines.forEach((raw, i) => {
    const ln = i + 1, line = raw.trim();
    if (!line || line.startsWith('#')) return;
    let x;
    if ((x = /^title\s*:\s*(.*)$/i.exec(line))) { m.title = x[1].trim(); return; }
    if ((x = /^numbered\s*:\s*(.*)$/i.exec(line))) {
      const v = x[1].trim().toLowerCase();
      if (!['true', 'false', 'có', 'không'].includes(v)) throw new DiagramError(ln, 'numbered chỉ nhận true hoặc false');
      m.numbered = v === 'true' || v === 'có'; return;
    }
    if ((x = /^actors\s*:\s*(.*)$/i.exec(line))) {
      if (declared || m.items.length) throw new DiagramError(ln, 'Dòng actors phải đặt một lần, trước các bước');
      const names = x[1].split('|').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
      if (!names.length) throw new DiagramError(ln, 'Dòng actors chưa có tên nào (phân cách bằng dấu |)');
      if (new Set(names).size !== names.length) throw new DiagramError(ln, 'Tên trong actors bị trùng');
      m.actors = names; declared = true; return;
    }
    if ((x = SEQ_DIV.exec(line))) { m.items.push({ type: 'divider', text: x[1], line: ln }); return; }
    if ((x = SEQ_NOTE.exec(line))) {
      const names = x[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
      if (!names.length || names.length > 2) throw new DiagramError(ln, 'note over cần một hoặc hai người, ví dụ: note over A, B: chữ');
      const idx = names.map((n) => m.actors.indexOf(known(n, ln)));
      m.items.push({ type: 'note', from: Math.min(...idx), to: Math.max(...idx), text: x[2], line: ln }); return;
    }
    if ((x = SEQ_MSG.exec(line)) && !/^note\b/i.test(line)) {
      const a = known(x[1].trim().replace(/\s+/g, ' '), ln), b = known(x[3].trim().replace(/\s+/g, ' '), ln);
      m.items.push({ type: 'msg', from: m.actors.indexOf(a), to: m.actors.indexOf(b), dashed: x[2] === '-->', text: (x[4] || '').trim(), line: ln }); return;
    }
    throw new DiagramError(ln, `Không hiểu dòng: "${line.length > 60 ? `${line.slice(0, 57)}…` : line}"`);
  });
  if (!m.actors.length) throw new DiagramError(1, 'Sơ đồ chưa có người tham gia nào');
  if (!m.items.length) throw new DiagramError(1, 'Sơ đồ chưa có bước nào');
  // Các chỉ số có thể đã lệch nếu actors tự thêm trong lúc phân tích: tính lại theo tên.
  return m;
}

// ---------------------------------------------------------------- Sơ đồ tuần tự: bố trí
const SQ = { fs: 13, lh: 16, labelWrap: 210, selfWrap: 150, loopW: 36, loopH: 24, pad: 18 };

export function layoutSeq(m) {
  const n = m.actors.length, fs = SQ.fs, lh = SQ.lh;
  // Hộp người tham gia
  const boxes = m.actors.map((name) => {
    const lines = wrapText(name, 130, fs, 600);
    return { lines, w: Math.max(96, Math.ceil(maxLineW(lines, fs, 600)) + 28), h: lines.length * lh + 18 };
  });
  const boxH = Math.max(...boxes.map((b) => b.h));
  // Khoảng cách giữa các cột đủ cho nhãn dài nhất bắc qua chúng
  const gaps = Array.from({ length: Math.max(0, n - 1) }, (_, i) => Math.max(140, (boxes[i].w + boxes[i + 1].w) / 2 + 28));
  const prep = m.items.map((it) => {
    if (it.type === 'msg') {
      const self = it.from === it.to;
      const lines = wrapText(it.text, self ? SQ.selfWrap : SQ.labelWrap, fs);
      return { ...it, self, lines: it.text ? lines : [], lw: it.text ? maxLineW(lines, fs) : 0 };
    }
    return { ...it };
  });
  const spans = prep.filter((it) => it.type === 'msg' && !it.self).map((it) => ({ lo: Math.min(it.from, it.to), hi: Math.max(it.from, it.to), need: it.lw + 44 }));
  spans.sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo));
  for (const s of spans) {
    let cur = 0; for (let i = s.lo; i < s.hi; i++) cur += gaps[i];
    if (cur < s.need) { const add = (s.need - cur) / (s.hi - s.lo); for (let i = s.lo; i < s.hi; i++) gaps[i] += add; }
  }
  for (const it of prep) if (it.type === 'msg' && it.self && it.from < n - 1) gaps[it.from] = Math.max(gaps[it.from], SQ.loopW + it.lw + 36);
  const xs = [0]; for (let i = 0; i < n - 1; i++) xs.push(xs[i] + gaps[i]);

  // Các dòng
  let y = boxH + 22;
  const arrows = [], notes = [], dividers = [], labels = [];
  let step = 0;
  const ext = { minX: xs[0] - boxes[0].w / 2, maxX: xs[n - 1] + boxes[n - 1].w / 2 };
  const grow = (a, b) => { ext.minX = Math.min(ext.minX, a); ext.maxX = Math.max(ext.maxX, b); };
  for (let i = 0; i < n; i++) grow(xs[i] - boxes[i].w / 2, xs[i] + boxes[i].w / 2);
  for (const it of prep) {
    if (it.type === 'msg') {
      const num = m.numbered ? ++step : null;
      const lblH = it.lines.length * lh;
      if (it.self) {
        const x = xs[it.from], y0 = y + 6 + Math.max(0, (lblH - SQ.loopH) / 2);
        const labelTop = y + 6 + Math.max(0, (SQ.loopH - lblH) / 2);
        arrows.push({ self: true, dashed: it.dashed, x1: x, x2: x + SQ.loopW, y: y0, y2: y0 + SQ.loopH, num, numX: x + 15, numY: y0 });
        if (lblH) { labels.push({ lines: it.lines, x: x + SQ.loopW + 8, top: labelTop, anchor: 'start' }); grow(x, x + SQ.loopW + 8 + it.lw); }
        else grow(x, x + SQ.loopW + 4);
        y += 6 + Math.max(SQ.loopH, lblH) + 16;
      } else {
        const ay = y + 8 + lblH + (lblH ? 4 : 0);
        const x1 = xs[it.from], x2 = xs[it.to], dir = x2 > x1 ? 1 : -1;
        arrows.push({ x1, x2, y: ay, dashed: it.dashed, dir, num, numX: x1 + dir * 15, numY: ay });
        if (lblH) labels.push({ lines: it.lines, x: (x1 + x2) / 2, top: y + 8, anchor: 'middle' });
        y = ay + 18;
      }
    } else if (it.type === 'note') {
      const xa = xs[it.from], xb = xs[it.to];
      let bw, bx;
      if (it.from === it.to) {
        const lines = wrapText(it.text, 230, fs);
        bw = Math.max(120, Math.ceil(maxLineW(lines, fs)) + 28); bx = xa - bw / 2; it.lines = lines;
      } else {
        bw = xb - xa + 90; bx = xa - 45;
        it.lines = wrapText(it.text, bw - 28, fs);
      }
      const bh = it.lines.length * lh + 16;
      notes.push({ x: bx, y: y + 4, w: bw, h: bh, lines: it.lines });
      grow(bx, bx + bw);
      y += bh + 18;
    } else if (it.type === 'divider') {
      const tw = it.text ? Math.ceil(textWidth(it.text, fs, 600)) + 28 : 0;
      dividers.push({ y: y + 18, text: it.text, tw });
      y += 40;
    }
  }
  const bottomBoxY = y + 4;
  const pad = SQ.pad;
  const minX = ext.minX - pad, maxX = ext.maxX + pad;
  const width = Math.ceil(maxX - minX), height = Math.ceil(bottomBoxY + boxH + pad * 1.2);
  const cx = (xs[0] + xs[n - 1]) / 2;
  return {
    kind: 'seq', width, height, viewBox: [Math.floor(minX), -pad * 0.3, width, height],
    actors: m.actors.map((name, i) => ({ x: xs[i], w: boxes[i].w, h: boxH, lines: boxes[i].lines })),
    topY: 0, bottomY: bottomBoxY, lifeY1: boxH, lifeY2: bottomBoxY,
    arrows, notes, labels, dividers: dividers.map((d) => ({ ...d, x1: minX + 4, x2: maxX - 4, cx })), lh, fs
  };
}

// ---------------------------------------------------------------- Lưu đồ: phân tích
const NODE_RE = /([A-Za-z0-9_]+)(?:\(\[(.*?)\]\)|\(\((.*?)\)\)|\[(.*?)\]|\{(.*?)\})?/y;
const EDGE_RES = [
  [/-\.\s+(.+?)\s+\.->/y, 'dot'], [/-\.->/y, 'dot0'], [/-->\|(.+?)\|/y, 'pipe'],
  [/--\s+(.+?)\s+-->/y, 'lab'], [/-->/y, 'plain']
];

/** Phân tích văn bản ```flow. Ném DiagramError(line, thông báo) khi sai. */
export function parseFlow(src) {
  const m = { kind: 'flow', title: '', direction: 'down', nodes: [], edges: [], groups: [] };
  const byId = new Map();
  let cur = null;
  const lines = String(src).replace(/\r/g, '').split('\n');
  const define = (id, shape, text, ln) => {
    let n = byId.get(id);
    if (!n) { n = { id, shape: 'rect', text: id, defined: false, group: null, line: ln }; byId.set(id, n); m.nodes.push(n); }
    if (shape) { n.shape = shape; n.text = text.trim() || id; n.defined = true; }
    if (cur && n.group == null) n.group = cur;
    return n;
  };
  const readNode = (s, pos, ln) => {
    NODE_RE.lastIndex = pos;
    const r = NODE_RE.exec(s);
    if (!r) throw new DiagramError(ln, `Không đọc được nút ở "${s.slice(pos, pos + 24)}"`);
    let shape = null, text = '';
    if (r[2] !== undefined) { shape = 'pill'; text = r[2]; } else if (r[3] !== undefined) { shape = 'circle'; text = r[3]; }
    else if (r[4] !== undefined) { shape = 'rect'; text = r[4]; } else if (r[5] !== undefined) { shape = 'diamond'; text = r[5]; }
    return { id: r[1], shape, text, end: NODE_RE.lastIndex };
  };
  const pendingRefs = [];
  lines.forEach((raw, i) => {
    const ln = i + 1, line = raw.replace(/\s+#\s.*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('%%')) return;
    let x;
    if ((x = /^title\s*:\s*(.*)$/i.exec(line))) { m.title = x[1].trim(); return; }
    if ((x = /^direction\s*:\s*(\S+)$/i.exec(line))) {
      const d = x[1].toLowerCase();
      if (!['down', 'right'].includes(d)) throw new DiagramError(ln, 'direction chỉ nhận down hoặc right');
      m.direction = d; return;
    }
    if ((x = /^subgraph\s+(.+)$/i.exec(line))) {
      if (cur) throw new DiagramError(ln, 'Chưa hỗ trợ subgraph lồng nhau');
      cur = { name: x[1].trim().replace(/^\[(.*)\]$/, '$1'), line: ln }; m.groups.push(cur); return;
    }
    if (/^end$/i.test(line)) {
      if (!cur) throw new DiagramError(ln, '"end" không có subgraph tương ứng');
      cur = null; return;
    }
    // Chuỗi nút và mũi tên
    let pos = 0, prev = null;
    const first = readNode(line, 0, ln);
    prev = first; pos = first.end;
    const refNode = (r) => { if (r.shape) define(r.id, r.shape, r.text, ln); else pendingRefs.push({ id: r.id, line: ln, group: cur }); return r.id; };
    let fromId = refNode(first);
    for (;;) {
      while (line[pos] === ' ') pos++;
      if (pos >= line.length) break;
      let hit = null;
      for (const [re, kind] of EDGE_RES) { re.lastIndex = pos; const r = re.exec(line); if (r) { hit = { r, kind }; break; } }
      if (!hit) throw new DiagramError(ln, `Không hiểu "${line.slice(pos, pos + 24)}": cần mũi tên --> , -- nhãn --> hoặc -.->`);
      pos = EDGE_RES.find(([, k]) => k === hit.kind)[0].lastIndex;
      while (line[pos] === ' ') pos++;
      if (pos >= line.length) throw new DiagramError(ln, 'Mũi tên chưa có nút đích');
      const nx = readNode(line, pos, ln); pos = nx.end;
      const toId = refNode(nx);
      const dashed = hit.kind === 'dot' || hit.kind === 'dot0';
      const label = ['dot', 'pipe', 'lab'].includes(hit.kind) ? hit.r[1].trim() : '';
      m.edges.push({ from: fromId, to: toId, label, dashed, line: ln });
      fromId = toId; prev = nx;
    }
    void prev;
  });
  if (cur) throw new DiagramError(cur.line, `subgraph "${cur.name}" chưa có "end"`);
  for (const r of pendingRefs) {
    const n = byId.get(r.id);
    if (!n || !n.defined) throw new DiagramError(r.line, `Nút "${r.id}" chưa được khai báo (ví dụ ${r.id}[Chữ])`);
    if (r.group && n.group == null) n.group = r.group;
  }
  if (!m.nodes.length) throw new DiagramError(1, 'Lưu đồ chưa có nút nào');
  m.groups.forEach((g, gi) => { g.index = gi; });
  for (const n of m.nodes) n.group = n.group ? n.group.index ?? m.groups.indexOf(n.group) : null;
  m.groups.forEach((g) => { if (!m.nodes.some((n) => n.group === g.index)) g.empty = true; });
  return m;
}

// ---------------------------------------------------------------- Lưu đồ: bố trí
const FL = { fs: 13.5, lh: 17, nodeWrap: 180, diaWrap: 120, lblFs: 12, lblWrap: 130, lblLH: 14, nodeSep: 40 };

function sizeNode(n) {
  const wrap = n.shape === 'diamond' ? FL.diaWrap : n.shape === 'circle' ? 100 : FL.nodeWrap;
  const lines = wrapText(n.text, wrap, FL.fs, 500);
  const tw = Math.ceil(maxLineW(lines, FL.fs, 500)), th = lines.length * FL.lh;
  let w, h;
  if (n.shape === 'diamond') { w = Math.max(116, Math.ceil(tw * 1.8 + 36)); h = Math.max(66, Math.ceil(th * 1.8 + 28)); }
  else if (n.shape === 'circle') { w = h = Math.max(54, Math.ceil(Math.hypot(tw, th) + 18)); }
  else if (n.shape === 'pill') { w = Math.max(96, tw + 44); h = Math.max(42, th + 22); }
  else { w = Math.max(96, tw + 32); h = Math.max(42, th + 22); }
  return { lines, w, h };
}

/** Nửa chiều cao / rộng của hình tại độ lệch `off` (tọa độ thực, tâm là gốc). */
function halfY(n, off) {
  const a = Math.abs(off);
  switch (n.shape) {
    case 'diamond': return (n.h / 2) * Math.max(0, 1 - a / (n.w / 2));
    case 'circle': return Math.sqrt(Math.max(0, (n.w / 2) ** 2 - a * a));
    case 'pill': { const r = n.h / 2, flat = n.w / 2 - r; return a <= flat ? r : Math.sqrt(Math.max(0, r * r - (a - flat) ** 2)); }
    default: return n.h / 2;
  }
}
function halfX(n, off) {
  const a = Math.abs(off);
  switch (n.shape) {
    case 'diamond': return (n.w / 2) * Math.max(0, 1 - a / (n.h / 2));
    case 'circle': return Math.sqrt(Math.max(0, (n.w / 2) ** 2 - a * a));
    case 'pill': { const r = n.h / 2; return n.w / 2 - r + Math.sqrt(Math.max(0, r * r - a * a)); }
    default: return n.w / 2;
  }
}
/** Điểm trên viền hình theo hướng N/S/E/W và độ lệch vuông góc `off`. */
function boundary(n, dir, off) {
  switch (dir) {
    case 'N': return { x: n.cx + off, y: n.cy - halfY(n, off) };
    case 'S': return { x: n.cx + off, y: n.cy + halfY(n, off) };
    case 'E': return { x: n.cx + halfX(n, off), y: n.cy + off };
    default: return { x: n.cx - halfX(n, off), y: n.cy + off };
  }
}

/** Đường gấp khúc bo góc. */
function roundedPath(pts, r = 12) {
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 1) { d += `L${f(b.x)},${f(b.y)}`; continue; }
    const p1 = { x: b.x + ((a.x - b.x) / l1) * rr, y: b.y + ((a.y - b.y) / l1) * rr };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * rr, y: b.y + ((c.y - b.y) / l2) * rr };
    d += `L${f(p1.x)},${f(p1.y)}Q${f(b.x)},${f(b.y)} ${f(p2.x)},${f(p2.y)}`;
  }
  const z = pts[pts.length - 1];
  return `${d}L${f(z.x)},${f(z.y)}`;
}
const f = (v) => Math.round(v * 10) / 10;

/** Hồi quy đơn điệu (PAV) có trọng số: tìm y không giảm gần nhất với mục tiêu t. */
function isotonic(t, w) {
  const blocks = [];
  t.forEach((v, i) => {
    blocks.push({ s: v * w[i], w: w[i], n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.s / a.w <= b.s / b.w) break;
      blocks.splice(blocks.length - 2, 2, { s: a.s + b.s, w: a.w + b.w, n: a.n + b.n });
    }
  });
  const out = [];
  for (const b of blocks) for (let i = 0; i < b.n; i++) out.push(b.s / b.w);
  return out;
}

export function layoutFlow(m) {
  const right = m.direction === 'right';
  const N = m.nodes.length;
  const idx = new Map(m.nodes.map((n, i) => [n.id, i]));
  const nodes = m.nodes.map((n) => { const s = sizeNode(n); return { ...n, ...s, cx: 0, cy: 0 }; });
  const edges = m.edges.map((e, k) => ({ ...e, k, u: idx.get(e.from), v: idx.get(e.to), back: false, self: false }));
  const out = nodes.map(() => []), inn = nodes.map(() => 0);
  edges.forEach((e) => { out[e.u].push(e); inn[e.v]++; });

  // 1. Phát hiện chu trình bằng DFS: cạnh quay lại tổ tiên là "back"
  const state = new Array(N).fill(0), post = [];
  const dfs = (u) => {
    state[u] = 1;
    for (const e of out[u]) {
      if (e.v === u) { e.self = true; continue; }
      if (state[e.v] === 1) e.back = true; else if (state[e.v] === 0) dfs(e.v);
    }
    state[u] = 2; post.push(u);
  };
  const roots = [...Array(N).keys()].filter((i) => inn[i] === 0 || edges.every((e) => e.v !== i || e.u === i));
  for (const r of roots) if (state[r] === 0) dfs(r);
  for (let i = 0; i < N; i++) if (state[i] === 0) dfs(i);
  const fwd = edges.filter((e) => !e.back && !e.self);

  // 2. Tầng theo đường đi dài nhất
  const layer = new Array(N).fill(0);
  for (const u of [...post].reverse()) for (const e of out[u]) if (!e.back && !e.self) layer[e.v] = Math.max(layer[e.v], layer[u] + 1);
  // Nút chỉ có cạnh đi ra: kéo xuống sát con gần nhất cho đỡ cạnh dài
  const fin = new Array(N).fill(0); fwd.forEach((e) => { fin[e.v]++; });
  for (const u of post) {
    if (fin[u] === 0) { const ch = fwd.filter((e) => e.u === u).map((e) => layer[e.v]); if (ch.length) layer[u] = Math.min(...ch) - 1; }
  }
  const L = Math.max(...layer) + 1;

  // 3. Đồ thị phân tầng có nút ảo cho cạnh bắc qua nhiều tầng
  const items = nodes.map((n, i) => ({ id: i, dummy: false, layer: layer[i], aw: right ? n.h : n.w, ah: right ? n.w : n.h, group: n.group, ups: [], downs: [] }));
  const link = (a, b) => { items[a].downs.push(b); items[b].ups.push(a); };
  const chainOf = new Map();
  for (const e of fwd) {
    const chain = [e.u];
    for (let l = layer[e.u] + 1; l < layer[e.v]; l++) {
      items.push({ id: items.length, dummy: true, layer: l, aw: 10, ah: 0, group: null, ups: [], downs: [] });
      chain.push(items.length - 1);
    }
    chain.push(e.v);
    for (let i = 0; i < chain.length - 1; i++) link(chain[i], chain[i + 1]);
    chainOf.set(e.k, chain);
  }
  // Thứ tự ban đầu: duyệt sâu theo thứ tự khai báo
  const layers = Array.from({ length: L }, () => []);
  const seen = new Set();
  const visit = (i) => { if (seen.has(i)) return; seen.add(i); layers[items[i].layer].push(i); for (const d of items[i].downs) visit(d); };
  for (const r of roots) visit(r);
  for (let i = 0; i < items.length; i++) visit(i);
  const posOf = () => { const p = new Map(); layers.forEach((ly) => ly.forEach((id, k) => p.set(id, k))); return p; };
  const crossings = () => {
    const p = posOf(); let c = 0;
    for (let l = 0; l < L - 1; l++) {
      const es = [];
      for (const a of layers[l]) for (const b of items[a].downs) es.push([p.get(a), p.get(b)]);
      for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) if ((es[i][0] - es[j][0]) * (es[i][1] - es[j][1]) < 0) c++;
    }
    return c;
  };
  const sweep = (down) => {
    const p = posOf();
    const range = down ? [...Array(L).keys()].slice(1) : [...Array(L).keys()].slice(0, -1).reverse();
    for (const l of range) {
      const key = new Map();
      layers[l].forEach((id, k) => {
        const nb = down ? items[id].ups : items[id].downs;
        key.set(id, nb.length ? nb.reduce((s, x) => s + p.get(x), 0) / nb.length : k);
      });
      const order = layers[l].map((id, k) => [id, k]).sort((a, b) => key.get(a[0]) - key.get(b[0]) || a[1] - b[1]);
      layers[l] = order.map((o) => o[0]);
      layers[l].forEach((id, k) => p.set(id, k));
    }
  };
  let best = layers.map((l) => [...l]), bestC = crossings();
  for (let it = 0; it < 12 && bestC > 0; it++) {
    sweep(it % 2 === 0); const c = crossings();
    if (c < bestC) { bestC = c; best = layers.map((l) => [...l]); }
  }
  best.forEach((l, i) => { layers[i] = l; });
  // Gom các nút cùng nhóm lại gần nhau
  if (m.groups.length) {
    for (let l = 0; l < L; l++) {
      const arr = layers[l], meanIdx = new Map();
      m.groups.forEach((g) => {
        const ks = arr.map((id, k) => (!items[id].dummy && items[id].group === g.index ? k : -1)).filter((k) => k >= 0);
        if (ks.length) meanIdx.set(g.index, ks.reduce((a, b) => a + b, 0) / ks.length);
      });
      layers[l] = arr.map((id, k) => ({ id, k, key: !items[id].dummy && items[id].group != null ? meanIdx.get(items[id].group) : k, g: !items[id].dummy && items[id].group != null ? items[id].group : -1 }))
        .sort((a, b) => a.key - b.key || a.g - b.g || a.k - b.k).map((o) => o.id);
    }
  }

  // 4. Tọa độ ngang (trục chéo tầng): xếp sát nhau rồi kéo về trung bình hàng xóm
  const gap = (a, b) => {
    let g = a.dummy && b.dummy ? 16 : a.dummy || b.dummy ? 26 : FL.nodeSep;
    if ((a.group != null || b.group != null) && a.group !== b.group) g += 26;
    return g;
  };
  const cross = new Array(items.length).fill(0);
  const place = (ly, desired) => {
    const offs = [0];
    for (let i = 1; i < ly.length; i++) offs.push(offs[i - 1] + items[ly[i - 1]].aw / 2 + items[ly[i]].aw / 2 + gap(items[ly[i - 1]], items[ly[i]]));
    const t = ly.map((id, i) => desired[i] - offs[i]);
    const w = ly.map((id) => (items[id].dummy ? 3 : 1));
    const y = isotonic(t, w);
    ly.forEach((id, i) => { cross[id] = y[i] + offs[i]; });
  };
  layers.forEach((ly) => place(ly, ly.map((_, i) => i * 100)));
  layers.forEach((ly) => { // căn giữa từng tầng quanh 0
    if (!ly.length) return;
    const mid = (cross[ly[0]] - items[ly[0]].aw / 2 + cross[ly[ly.length - 1]] + items[ly[ly.length - 1]].aw / 2) / 2;
    ly.forEach((id) => { cross[id] -= mid; });
  });
  const mean = (arr) => arr.reduce((s, x) => s + cross[x], 0) / arr.length;
  for (let it = 0; it < 10; it++) {
    const mode = it >= 6 ? 'both' : it % 2 === 0 ? 'down' : 'up';
    const order = mode === 'up' ? [...Array(L).keys()].reverse() : [...Array(L).keys()];
    for (const l of order) {
      const ly = layers[l];
      place(ly, ly.map((id) => {
        const nb = mode === 'down' ? items[id].ups : mode === 'up' ? items[id].downs : [...items[id].ups, ...items[id].downs];
        return nb.length ? mean(nb) : cross[id];
      }));
    }
  }

  // 5. Vị trí theo trục tầng: khoảng cách giữa các tầng đủ chỗ cho nhãn
  const labelInfo = new Map();
  for (const e of edges) {
    if (!e.label) continue;
    const lines = wrapText(e.label, FL.lblWrap, FL.lblFs, 500);
    labelInfo.set(e.k, { lines, w: Math.ceil(maxLineW(lines, FL.lblFs, 500)) + 14, h: lines.length * FL.lblLH + 6 });
  }
  const layerH = layers.map((ly) => Math.max(0, ...ly.map((id) => items[id].ah)));
  const rank = [];
  for (let l = 0; l < L - 1; l++) {
    let need = right ? 70 : 56;
    for (const e of fwd) {
      const li = labelInfo.get(e.k);
      if (li && layer[e.u] === l) need = Math.max(need, right ? li.w + 56 : li.h + 40);
    }
    if (m.groups.length) need += 18;
    rank.push(need);
  }
  const layerC = [];
  { let y = 0; for (let l = 0; l < L; l++) { y += layerH[l] / 2; layerC.push(y); y += layerH[l] / 2 + (rank[l] ?? 0); } }
  const toReal = (c, l) => (right ? { x: layerC[l], y: c } : { x: c, y: layerC[l] });
  nodes.forEach((n, i) => { const p = toReal(cross[i], layer[i]); n.cx = p.x; n.cy = p.y; });

  // 6. Cổng vào/ra của từng nút (không chồng nhau)
  const spread = (n, k) => {
    if (k <= 1) return () => 0;
    const usable = (n.shape === 'diamond' ? 0.5 : n.shape === 'circle' ? 0.55 : n.shape === 'pill' ? 0.8 : 0.85) * (right ? n.h : n.w);
    const sp = Math.min(n.shape === 'diamond' ? 34 : 26, usable / (k - 1));
    return (i) => (i - (k - 1) / 2) * sp;
  };
  const outDir = right ? 'E' : 'S', inDir = right ? 'W' : 'N';
  const cOf = (p) => (right ? p.y : p.x);
  const nextPt = (e, which) => { const ch = chainOf.get(e.k); const id = which === 'out' ? ch[1] : ch[ch.length - 2]; return id < N ? cross[id] : cross[id]; };
  const outPort = new Map(), inPort = new Map();
  nodes.forEach((n, i) => {
    const oe = fwd.filter((e) => e.u === i).sort((a, b) => nextPt(a, 'out') - nextPt(b, 'out') || a.k - b.k);
    const sp = spread(n, oe.length);
    oe.forEach((e, j) => outPort.set(e.k, boundary(n, outDir, sp(j))));
    const ie = fwd.filter((e) => e.v === i).sort((a, b) => nextPt(a, 'in') - nextPt(b, 'in') || a.k - b.k);
    const si = spread(n, ie.length);
    ie.forEach((e, j) => inPort.set(e.k, boundary(n, inDir, si(j))));
  });
  void cOf;

  // 7. Đường đi các cạnh xuôi
  const curve = (a, b) => (right
    ? `C${f((a.x + b.x) / 2)},${f(a.y)} ${f((a.x + b.x) / 2)},${f(b.y)} ${f(b.x)},${f(b.y)}`
    : `C${f(a.x)},${f((a.y + b.y) / 2)} ${f(b.x)},${f((a.y + b.y) / 2)} ${f(b.x)},${f(b.y)}`);
  const out_edges = [];
  const placedLabels = [];
  const labelRect = (e, cx, cy, anchor) => {
    const li = labelInfo.get(e.k); if (!li) return null;
    const r = { lines: li.lines, w: li.w, h: li.h, x: anchor === 'start' ? cx : anchor === 'end' ? cx - li.w : cx - li.w / 2, y: cy - li.h / 2, anchor };
    return r;
  };
  const hits = (a, b) => a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 1 && b.y < a.y + a.h + 1;
  const settle = (r) => {
    if (!r) return r;
    for (let tries = 0; tries < 8 && placedLabels.some((p) => hits(r, p)); tries++) { if (right) r.x += 0; r.y += r.h + 2; }
    placedLabels.push(r); return r;
  };
  for (const e of fwd) {
    const ch = chainOf.get(e.k);
    const pts = [outPort.get(e.k)];
    for (let i = 1; i < ch.length - 1; i++) { const it = items[ch[i]]; pts.push(toReal(cross[ch[i]], it.layer)); }
    pts.push(inPort.get(e.k));
    let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
    for (let i = 1; i < pts.length; i++) d += curve(pts[i - 1], pts[i]);
    const tip = pts[pts.length - 1], dir = right ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    out_edges.push({ d, dashed: e.dashed, tip, dir, label: settle(labelRect(e, mid.x, mid.y, 'middle')), pts });
  }

  // 8. Cạnh quay lại (chu trình) và vòng lặp: đi vòng bên ngoài các nút
  const backs = edges.filter((e) => e.back);
  const sideOfNode = (i, side) => { // số nút nằm ngoài về phía `side` trong cùng tầng
    const ly = layers[layer[i]].filter((id) => id < N);
    return ly.filter((id) => (side === 1 ? cross[id] > cross[i] : cross[id] < cross[i])).length;
  };
  const laneUse = { 1: [], '-1': [] };
  const real = nodes;
  const rangeExt = (l0, l1, side) => {
    let v = side === 1 ? -Infinity : Infinity;
    for (let l = l0; l <= l1; l++) for (const id of layers[l]) {
      const n = id < N ? real[id] : null;
      const lo = n ? (right ? n.cy - n.h / 2 : n.cx - n.w / 2) : (right ? cross[id] : cross[id]) - 5;
      const hi = n ? (right ? n.cy + n.h / 2 : n.cx + n.w / 2) : cross[id] + 5;
      v = side === 1 ? Math.max(v, hi) : Math.min(v, lo);
    }
    return v;
  };
  const portUse = new Map();
  const portOff = (i, dir) => { const k = `${i}${dir}`; const c = portUse.get(k) || 0; portUse.set(k, c + 1); return (c - 0) * 12; };
  backs.sort((a, b) => (layer[a.u] - layer[a.v]) - (layer[b.u] - layer[b.v]));
  for (const e of backs) {
    const u = real[e.u], v = real[e.v];
    const costR = sideOfNode(e.u, 1) + sideOfNode(e.v, 1), costL = sideOfNode(e.u, -1) + sideOfNode(e.v, -1);
    const side = costR <= costL ? 1 : -1;
    const lo = layer[e.v], hi = layer[e.u];
    const lanes = laneUse[side];
    let lane = 0; while (lanes.some((r) => r.lane === lane && !(r.hi < lo || r.lo > hi))) lane++;
    lanes.push({ lane, lo, hi });
    const ext = rangeExt(lo, hi, side);
    const dist = ext + side * (26 + lane * 22);
    const dir = right ? (side === 1 ? 'S' : 'N') : (side === 1 ? 'E' : 'W');
    const oa = portOff(e.u, dir), ob = portOff(e.v, dir);
    const A = boundary(u, dir, oa), T = boundary(v, dir, ob);
    const B = right ? { x: A.x, y: dist } : { x: dist, y: A.y }, C = right ? { x: T.x, y: dist } : { x: dist, y: T.y };
    const pts = [A, B, C, T];
    const dv = right ? { x: 0, y: side === 1 ? -1 : 1 } : { x: side === 1 ? -1 : 1, y: 0 };
    let lab = null;
    const li = labelInfo.get(e.k);
    if (li) {
      lab = right ? labelRect(e, (B.x + C.x) / 2, dist, 'middle') : labelRect(e, dist + side * 8, (B.y + C.y) / 2, side === 1 ? 'start' : 'end');
      settle(lab);
    }
    out_edges.push({ d: roundedPath(pts), dashed: e.dashed, tip: T, dir: dv, label: lab, pts });
  }
  for (const e of edges.filter((x) => x.self)) {
    const n = real[e.u];
    const dir = right ? 'S' : 'E';
    const A = boundary(n, dir, -9), T = boundary(n, dir, 9), reach = 30;
    const off = right ? { x: 0, y: reach } : { x: reach, y: 0 };
    const pts = [A, { x: A.x + off.x, y: A.y + off.y }, { x: T.x + off.x, y: T.y + off.y }, T];
    const lab = labelRect(e, right ? (A.x + T.x) / 2 : A.x + reach + 6, right ? A.y + reach + 4 + (labelInfo.get(e.k)?.h || 0) / 2 : (A.y + T.y) / 2, right ? 'middle' : 'start');
    settle(lab);
    out_edges.push({ d: roundedPath(pts, 8), dashed: e.dashed, tip: T, dir: right ? { x: 0, y: -1 } : { x: -1, y: 0 }, label: lab, pts });
  }

  // 9. Khung nhóm và hộp bao
  const groups = m.groups.filter((g) => !g.empty).map((g) => {
    const mem = nodes.filter((n) => n.group === g.index);
    const tw = Math.ceil(textWidth(g.name, 12, 700)) + 24;
    const x0 = Math.min(...mem.map((n) => n.cx - n.w / 2)) - 18, x1 = Math.max(...mem.map((n) => n.cx + n.w / 2)) + 18;
    const y0 = Math.min(...mem.map((n) => n.cy - n.h / 2)) - 32, y1 = Math.max(...mem.map((n) => n.cy + n.h / 2)) + 16;
    const w = Math.max(x1 - x0, tw);
    return { name: g.name, x: x0, y: y0, w, h: y1 - y0 };
  });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x0, y0, x1, y1) => { minX = Math.min(minX, x0); minY = Math.min(minY, y0); maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1); };
  nodes.forEach((n) => ext(n.cx - n.w / 2, n.cy - n.h / 2, n.cx + n.w / 2, n.cy + n.h / 2));
  groups.forEach((g) => ext(g.x, g.y, g.x + g.w, g.y + g.h));
  out_edges.forEach((e) => { e.pts.forEach((p) => ext(p.x, p.y, p.x, p.y)); if (e.label) ext(e.label.x, e.label.y, e.label.x + e.label.w, e.label.y + e.label.h); });
  const PAD = 16;
  const vb = [Math.floor(minX - PAD), Math.floor(minY - PAD), Math.ceil(maxX - minX + PAD * 2), Math.ceil(maxY - minY + PAD * 2)];
  return {
    kind: 'flow', width: vb[2], height: vb[3], viewBox: vb, direction: m.direction,
    nodes: nodes.map((n) => ({ id: n.id, shape: n.shape, x: n.cx - n.w / 2, y: n.cy - n.h / 2, w: n.w, h: n.h, cx: n.cx, cy: n.cy, lines: n.lines })),
    edges: out_edges, groups, lh: FL.lh, lblLH: FL.lblLH, crossings: bestC
  };
}
