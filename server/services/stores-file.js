// Nhập, xuất danh sách chi nhánh bằng file CSV (UTF-8; Excel mở được). Cột: Mã chi nhánh, Tên chi nhánh, Địa chỉ, Mã điểm.
import { parseTable } from './points.js';
import { nowIso } from '../util.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '');
const HEAD = {
  id: ['machinhanh', 'machinh', 'macn', 'storeid', 'id', 'ma'],
  name: ['tenchinhanh', 'tenchinh', 'ten', 'name', 'tencuahang', 'tensieuthi'],
  address: ['diachi', 'address', 'dc'],
  posCode: ['madiem', 'poscode', 'pointcode', 'madiemban', 'mapos']
};
export const TEMPLATE_CSV = '﻿Mã chi nhánh,Tên chi nhánh,Địa chỉ,Mã điểm\r\nQ7,Chi nhánh Quận 7,"Quận 7, TP. Hồ Chí Minh",SP-0107\r\nTD,Chi nhánh Thủ Đức,"TP. Thủ Đức, TP. Hồ Chí Minh",SP-0113\r\n';
const csvCell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Xuất toàn bộ chi nhánh ra CSV (có BOM để Excel đọc đúng tiếng Việt). */
export function exportStores(db) {
  const rows = db.prepare('SELECT id, name, address, pos_code, enabled FROM stores ORDER BY id').all();
  const lines = [['Mã chi nhánh', 'Tên chi nhánh', 'Địa chỉ', 'Mã điểm', 'Trạng thái'], ...rows.map((r) => [r.id, r.name, r.address || '', r.pos_code || '', r.enabled ? 'Đang bật' : 'Đang tắt'])];
  return '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Đọc file thành các dòng { line, id, name, address, posCode, hasName, hasAddress, hasPos }. */
export function readStores(text) {
  const rows = parseTable(text);
  if (!rows.length) return { error: 'File trống' };
  const heads = rows[0].map(norm);
  const find = (list) => heads.findIndex((h) => list.includes(h));
  const i = { id: find(HEAD.id), name: find(HEAD.name), address: find(HEAD.address), posCode: find(HEAD.posCode) };
  if (i.id < 0) return { error: 'Không thấy cột "Mã chi nhánh". Dòng đầu cần có tên cột, hãy tải file mẫu để dùng đúng dạng' };
  if (rows.length - 1 > 2000) return { error: 'File quá lớn (tối đa 2.000 chi nhánh)' };
  const out = rows.slice(1).map((r, k) => ({
    line: k + 2, id: String(r[i.id] || '').trim().toUpperCase(),
    name: i.name >= 0 ? String(r[i.name] || '').trim() : null, address: i.address >= 0 ? String(r[i.address] || '').trim() : null, posCode: i.posCode >= 0 ? String(r[i.posCode] || '').trim() : null
  }));
  return { rows: out };
}

const POS_RE = /^[A-Za-z0-9_.\-/]{1,40}$/;
/**
 * Đối chiếu với chi nhánh đang có. status: new (sẽ thêm), update (sẽ cập nhật), same (không đổi), bad (dòng sai), dup (mã lặp trong file), clash (mã điểm trùng chi nhánh khác).
 * Cột có trong file nhưng ô để trống thì giữ nguyên giá trị cũ (không xóa).
 */
export function planStores(db, parsed) {
  const cur = new Map(db.prepare('SELECT id, name, address, pos_code FROM stores').all().map((s) => [s.id, s]));
  const posOwner = new Map([...cur.values()].filter((s) => s.pos_code).map((s) => [s.pos_code.toLowerCase(), s.id]));
  const seen = new Set(), filePos = new Map();
  const rows = parsed.rows.map((r) => {
    const out = { ...r, status: 'new', note: '' };
    const bad = (note) => { out.status = 'bad'; out.note = note; return out; };
    if (!/^[A-Z0-9]{1,6}$/.test(r.id)) return bad('Mã chi nhánh gồm 1–6 chữ hoa hoặc số');
    if (seen.has(r.id)) { out.status = 'dup'; out.note = 'Mã chi nhánh lặp trong file'; return out; }
    seen.add(r.id);
    const old = cur.get(r.id);
    if (!old && !r.name) return bad('Chi nhánh mới cần có tên');
    if (r.posCode) {
      if (!POS_RE.test(r.posCode)) return bad('Mã điểm gồm chữ, số, dấu - _ . / tối đa 40 ký tự');
      const k = r.posCode.toLowerCase();
      const other = posOwner.get(k);
      if (other && other !== r.id) { out.status = 'clash'; out.note = `Mã điểm đã gán cho chi nhánh ${other}`; return out; }
      if (filePos.has(k) && filePos.get(k) !== r.id) { out.status = 'clash'; out.note = `Mã điểm trùng với dòng của chi nhánh ${filePos.get(k)}`; return out; }
      filePos.set(k, r.id);
    }
    if (old) {
      const next = { name: r.name || old.name, address: r.address === null || r.address === '' ? old.address : r.address, pos: r.posCode || old.pos_code || '' };
      out.status = next.name === old.name && (next.address || '') === (old.address || '') && next.pos === (old.pos_code || '') ? 'same' : 'update';
      out.storeName = old.name;
    }
    return out;
  });
  const summary = { total: rows.length };
  for (const r of rows) summary[r.status] = (summary[r.status] || 0) + 1;
  return { rows, summary };
}

/** Áp dụng: thêm chi nhánh mới (ở trạng thái tắt), cập nhật tên, địa chỉ, mã điểm của chi nhánh có sẵn. Dòng sai bị bỏ qua. */
export function applyStores(db, parsed, audit, actorId) {
  const plan = planStores(db, parsed);
  let created = 0, updated = 0;
  db.transaction(() => {
    for (const r of plan.rows) {
      if (r.status === 'new') {
        db.prepare('INSERT INTO stores(id,name,address,enabled,created_at,pos_code) VALUES(?,?,?,0,?,?)').run(r.id, r.name, r.address || '', nowIso(), r.posCode || '');
        db.prepare('INSERT INTO store_config(store_id) VALUES(?)').run(r.id);
        audit(db, { storeId: r.id, actorType: 'admin', actorId, action: 'store.created', entity: 'store', entityId: r.id, data: { source: 'file' } });
        created++;
      } else if (r.status === 'update') {
        const old = db.prepare('SELECT name, address, pos_code FROM stores WHERE id = ?').get(r.id);
        db.prepare('UPDATE stores SET name = ?, address = ?, pos_code = ? WHERE id = ?')
          .run(r.name || old.name, r.address === null || r.address === '' ? old.address : r.address, r.posCode || old.pos_code || '', r.id);
        audit(db, { storeId: r.id, actorType: 'admin', actorId, action: 'store.updated', entity: 'store', entityId: r.id, data: { source: 'file' } });
        updated++;
      }
    }
  })();
  return { created, updated, skipped: plan.rows.length - created - updated, summary: plan.summary };
}
