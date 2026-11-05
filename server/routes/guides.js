// Tài liệu hướng dẫn cho quản trị viên: đọc file Markdown trong server/guides (hoặc GUIDES_DIR).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { notFound } from '../util.js';

const ID_RE = /^[a-z0-9-]+$/;
const GROUPS = ['nghiep-vu', 'he-thong'];
const ACCESS = ['all', 'chain'];

export const guidesDir = () => process.env.GUIDES_DIR || path.join(config.root, 'server', 'guides');

/** Tách front matter đơn giản (khoá: giá trị). Trả null nếu không hợp lệ. */
export function parseGuide(text) {
  const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!src.startsWith('---\n')) return null;
  const end = src.indexOf('\n---', 4);
  if (end < 0) return null;
  const after = src.slice(end + 4);
  if (after && !after.startsWith('\n')) return null;
  const meta = {};
  for (const line of src.slice(4, end).split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) return null;
    let v = m[2].replace(/\s+#.*$/, '').trim();
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    meta[m[1]] = v;
  }
  if (!meta.title) return null;
  const group = meta.group || 'nghiep-vu', access = meta.access || 'all';
  if (!GROUPS.includes(group) || !ACCESS.includes(access)) return null;
  const order = meta.order === undefined || meta.order === '' ? 100 : Number(meta.order);
  if (!Number.isFinite(order)) return null;
  return { title: meta.title, summary: meta.summary || '', group, order, access, body: after.replace(/^\n+/, '') };
}

function loadGuide(id) {
  if (!ID_RE.test(id)) return null;
  const file = path.join(guidesDir(), `${id}.md`);
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    const g = parseGuide(fs.readFileSync(file, 'utf8'));
    return g && { id, ...g, updatedAt: st.mtime.toISOString() };
  } catch { return null; }
}

function listGuides() {
  let names = [];
  try { names = fs.readdirSync(guidesDir()); } catch { return []; }
  return names.filter((n) => n.endsWith('.md') && ID_RE.test(n.slice(0, -3)))
    .map((n) => loadGuide(n.slice(0, -3))).filter(Boolean)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
}

const visible = (user, g) => g.access === 'all' || user.role === 'chain_admin';

/** Đăng ký trong vùng đã xác thực quản trị. */
export function registerGuides(s) {
  s.get('/guides', async (req) => ({
    guides: listGuides().filter((g) => visible(req.user, g))
      .map(({ id, title, summary, group, order, access, updatedAt }) => ({ id, title, summary, group, order, access, updatedAt }))
  }));
  s.get('/guides/:id', async (req) => {
    const g = loadGuide(String(req.params.id));
    if (!g || !visible(req.user, g)) throw notFound('GUIDE_NOT_FOUND', 'Không tìm thấy tài liệu');
    return { id: g.id, title: g.title, summary: g.summary, group: g.group, updatedAt: g.updatedAt, body: g.body };
  });
}
