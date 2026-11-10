// Nhập danh sách mã điểm (maDiem) của hệ thống giá bên đối tác và ghép với chi nhánh BRG.
// File CSV/TSV (UTF-8), dòng đầu là tên cột (nhận nhiều cách viết). Cột bắt buộc: mã điểm. Cột để ghép chi nhánh: mã chi nhánh BRG hoặc tên.
import { nowIso } from '../util.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '');
const HEAD = {
  code: ['madiem', 'madiemban', 'diem', 'pointcode', 'poscode', 'maposcode', 'mapos', 'maphongban'],
  store: ['machinhanh', 'machinh', 'storeid', 'macn', 'macuahang', 'masieuthi', 'machinhanhbrg', 'idchinhanh'],
  name: ['tendiem', 'tenchinhanh', 'tencuahang', 'tensieuthi', 'tendiembanhang', 'ten', 'name', 'diachi']
};

/** Tách văn bản thành các dòng và ô, tự nhận dấu ngăn (tab, ; hoặc ,), hỗ trợ ô có ngoặc kép. */
export function parseTable(text) {
  const t = String(text ?? '').replace(/^﻿/, '');
  const first = t.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = ['\t', ';', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

/** Đọc file thành các dòng { line, code, storeRef, name }. Trả { error } nếu không nhận ra cột mã điểm. */
export function readPoints(text) {
  const rows = parseTable(text);
  if (!rows.length) return { error: 'File trống' };
  const heads = rows[0].map(norm);
  const find = (list) => heads.findIndex((h) => list.includes(h));
  let iCode = find(HEAD.code), iStore = find(HEAD.store), iName = find(HEAD.name), start = 1;
  if (iCode < 0) {
    // Không có dòng tên cột: coi cột 1 là mã điểm, cột 2 là mã chi nhánh hoặc tên
    if (rows[0].length >= 1 && /^[A-Za-z0-9_.\-/]{1,40}$/.test(rows[0][0]) && /\d/.test(rows[0][0])) { iCode = 0; iName = rows[0].length > 1 ? 1 : -1; iStore = -1; start = 0; }
    else return { error: 'Không thấy cột "Mã điểm" (maDiem). Dòng đầu cần có tên cột, ví dụ: maDiem, maChiNhanh, tenDiem' };
  }
  if (rows.length - start > 5000) return { error: 'File quá lớn (tối đa 5.000 dòng)' };
  const out = rows.slice(start).map((r, k) => ({ line: k + start + 1, code: r[iCode] || '', storeRef: iStore >= 0 ? r[iStore] || '' : '', name: iName >= 0 ? r[iName] || '' : '' }));
  return { rows: out, columns: { code: rows[0][iCode] ?? '(cột 1)', store: iStore >= 0 ? rows[0][iStore] : null, name: iName >= 0 ? rows[0][iName] : null } };
}

/**
 * Ghép từng dòng với chi nhánh BRG: ưu tiên mã chi nhánh trùng, rồi tên trùng (không phân biệt hoa thường, dấu), rồi chi nhánh đã đang dùng đúng mã điểm này.
 * status: ok (sẽ gán), same (đã đúng), nomatch (chưa ghép được chi nhánh, vẫn lưu vào danh sách), dup (mã điểm trùng trong file), bad (mã không hợp lệ), clash (chi nhánh đã được dòng khác gán).
 */
export function matchPoints(db, parsed) {
  const stores = db.prepare('SELECT id, name, pos_code FROM stores').all();
  const byId = new Map(stores.map((s) => [s.id.toLowerCase(), s]));
  const byName = new Map(stores.map((s) => [norm(s.name), s]));
  const byCode = new Map(stores.filter((s) => s.pos_code).map((s) => [s.pos_code.toLowerCase(), s]));
  const seen = new Set(), taken = new Map();
  const rows = parsed.rows.map((r) => {
    const code = r.code;
    const base = { line: r.line, code, name: r.name, storeRef: r.storeRef, storeId: null, storeName: null, current: null };
    if (!/^[A-Za-z0-9_.\-/]{1,40}$/.test(code)) return { ...base, status: 'bad', note: 'Mã điểm không hợp lệ (chữ, số, - _ . / tối đa 40 ký tự)' };
    if (seen.has(code.toLowerCase())) return { ...base, status: 'dup', note: 'Mã điểm lặp lại trong file' };
    seen.add(code.toLowerCase());
    const st = (r.storeRef && byId.get(r.storeRef.toLowerCase())) || (r.storeRef && byName.get(norm(r.storeRef))) || (r.name && byName.get(norm(r.name))) || byCode.get(code.toLowerCase()) || null;
    if (!st) return { ...base, status: 'nomatch', note: 'Chưa ghép được chi nhánh BRG (vẫn lưu vào danh sách mã điểm)' };
    const m = { ...base, storeId: st.id, storeName: st.name, current: st.pos_code || null };
    if (taken.has(st.id)) return { ...m, status: 'clash', note: `Chi nhánh ${st.id} đã được gán mã ${taken.get(st.id)} ở dòng trước` };
    taken.set(st.id, code);
    if ((st.pos_code || '').toLowerCase() === code.toLowerCase()) return { ...m, status: 'same' };
    return { ...m, status: 'ok', note: st.pos_code ? `Đổi mã điểm ${st.pos_code} thành ${code}` : 'Gán mã điểm mới' };
  });
  const summary = { total: rows.length };
  for (const r of rows) summary[r.status] = (summary[r.status] || 0) + 1;
  return { rows, summary };
}

/** Lưu danh sách mã điểm và gán cho chi nhánh các dòng `ok`. */
export function applyPoints(db, parsed) {
  const { rows, summary } = matchPoints(db, parsed);
  const ts = nowIso();
  let assigned = 0, saved = 0;
  db.transaction(() => {
    const up = db.prepare(`INSERT INTO price_points(ma_diem,name,store_id,imported_at) VALUES(?,?,?,?)
      ON CONFLICT(ma_diem) DO UPDATE SET name = excluded.name, store_id = excluded.store_id, imported_at = excluded.imported_at`);
    // gỡ ghép cũ của chi nhánh sẽ nhận mã mới để không vướng chỉ mục duy nhất
    for (const r of rows) if (r.status === 'ok' && r.current) db.prepare('UPDATE stores SET pos_code = ? WHERE id = ?').run('', r.storeId);
    for (const r of rows) {
      if (r.status === 'bad' || r.status === 'dup') continue;
      const gh = r.status === 'ok' || r.status === 'same' ? r.storeId : null;
      up.run(r.code, r.name || r.storeName || null, gh, ts); saved++;
      if (r.status === 'ok') { db.prepare('UPDATE stores SET pos_code = ? WHERE id = ?').run(r.code, r.storeId); assigned++; }
    }
  })();
  return { rows, summary, assigned, saved };
}
