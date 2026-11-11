// Dịch câu lệnh SQL viết cho SQLite sang T-SQL (SQL Server). Chỉ hỗ trợ đúng các dạng câu lệnh ứng dụng đang dùng;
// gặp dạng chưa biết thì ném lỗi rõ ràng thay vì chạy sai.

/** Đi qua câu lệnh, gọi `fn(ch, i)` cho mỗi ký tự NGOÀI chuỗi '...' và bỏ qua chuỗi. fn trả về chuỗi thay thế hoặc undefined để giữ nguyên. */
function scan(sql, fn) {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") { let j = i + 1; while (j < sql.length) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; } j++; } out += sql.slice(i, j + 1); i = j; continue; }
    const r = fn(ch, i);
    if (r === undefined) out += ch; else { out += r.text; i += r.skip ?? 0; }
  }
  return out;
}

/** Tìm dấu ngoặc đóng tương ứng với ngoặc mở ở vị trí `open` (bỏ qua nội dung chuỗi). */
function closeParen(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { i++; while (i < s.length) { if (s[i] === "'") { if (s[i + 1] === "'") { i += 2; continue; } break; } i++; } continue; }
    if (c === '(') d++; else if (c === ')') { d--; if (d === 0) return i; }
  }
  return -1;
}

/** Tách theo dấu phẩy ở mức ngoài cùng. */
function splitTop(s) {
  const parts = []; let d = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { let j = i + 1; while (j < s.length) { if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } break; } j++; } cur += s.slice(i, j + 1); i = j; continue; }
    if (c === '(') d++; else if (c === ')') d--;
    if (c === ',' && d === 0) { parts.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const q = (id) => (/^key$/i.test(id) ? `[${id}]` : id);

/** date(<biểu thức>, '+7 hours') -> ngày theo giờ Việt Nam (chuỗi yyyy-mm-dd) */
function dateFn(s) {
  let out = '', i = 0;
  const re = /\bdate\s*\(/gi;
  let m;
  while ((m = re.exec(s))) {
    const open = m.index + m[0].length - 1;
    const end = closeParen(s, open);
    if (end < 0) break;
    const args = splitTop(s.slice(open + 1, end));
    if (args.length === 2 && /^'\+7 hours'$/i.test(args[1])) {
      out += s.slice(i, m.index) + `CONVERT(varchar(10), DATEADD(hour, 7, CAST(${args[0]} AS datetimeoffset)), 23)`;
      i = end + 1; re.lastIndex = end + 1;
    }
  }
  return out + s.slice(i);
}

/** Đổi LIMIT n ở cuối câu SELECT thành TOP (n) ngay sau SELECT đầu tiên. */
function limitToTop(s) {
  const m = /\s+LIMIT\s+(\d+|@p\d+)\s*$/i.exec(s);
  if (!m) return s;
  const body = s.slice(0, m.index);
  const top = `TOP (${m[1]})`;
  const sel = /\bSELECT\s+(DISTINCT\s+)?/i.exec(body);
  if (!sel) throw new Error('LIMIT không dùng được với câu lệnh này: ' + s);
  return body.slice(0, sel.index) + `SELECT ${sel[1] || ''}${top} ` + body.slice(sel.index + sel[0].length);
}

/** INSERT ... ON CONFLICT(keys) DO UPDATE SET ... -> UPDATE ... ; IF @@ROWCOUNT = 0 INSERT ... */
function upsert(s) {
  const m = /^\s*INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(/i.exec(s);
  if (!m) throw new Error('ON CONFLICT chỉ hỗ trợ dạng INSERT ... VALUES(...): ' + s);
  const open = m[0].length - 1;
  const end = closeParen(s, open);
  const vals = splitTop(s.slice(open + 1, end));
  const cols = m[2].split(',').map((c) => c.trim());
  if (vals.length !== cols.length) throw new Error('Số cột và số giá trị không khớp: ' + s);
  const tail = s.slice(end + 1);
  const c = /^\s*ON\s+CONFLICT\s*\(([^)]*)\)\s*DO\s+UPDATE\s+SET\s+([\s\S]*)$/i.exec(tail);
  if (!c) throw new Error('Chỉ hỗ trợ ON CONFLICT(...) DO UPDATE SET: ' + s);
  const keys = c[1].split(',').map((k) => k.trim());
  const bare = (x) => x.replace(/[[\]]/g, '').toLowerCase();
  const val = (col) => { const k = cols.findIndex((x) => bare(x) === bare(col)); if (k < 0) throw new Error('Không thấy cột ' + col); return vals[k]; };
  const set = c[2].replace(/\bexcluded\.(\[?\w+\]?)/gi, (_, col) => val(col.replace(/[[\]]/g, '')));
  const where = keys.map((k) => `${k} = ${val(k.replace(/[[\]]/g, ''))}`).join(' AND ');
  return `UPDATE ${m[1]} SET ${set} WHERE ${where}; IF @@ROWCOUNT = 0 INSERT INTO ${m[1]}(${m[2]}) VALUES(${vals.join(',')})`;
}

/** Dịch một câu lệnh SQLite sang T-SQL. Trả { text, nparams }. */
export function toTsql(sql) {
  let n = 0;
  let s = scan(String(sql), (ch, i) => {
    if (ch === '?') return { text: `@p${++n}` };
    if (ch === '|' && sql[i + 1] === '|') return { text: '+', skip: 1 };
    return undefined;
  });
  // tên cột trùng từ khóa của T-SQL
  s = scanWords(s, q);
  if (/\bINSERT\s+OR\s+(REPLACE|IGNORE)\b/i.test(s)) throw new Error('Dùng INSERT ... ON CONFLICT thay cho INSERT OR: ' + sql);
  s = s.replace(/\s+COLLATE\s+NOCASE\b/gi, ''); // CSDL SQL Server đã không phân biệt hoa thường
  s = dateFn(s);
  s = s.replace(/\s+/g, ' ').trim();
  if (/\bON\s+CONFLICT\b/i.test(s)) s = upsert(s);
  else s = limitToTop(s);
  if (/\bLIMIT\b/i.test(s)) throw new Error('LIMIT chưa dịch được: ' + sql);
  return { text: s, nparams: n };
}

/** Thay các từ (ngoài chuỗi) bằng fn(từ). */
function scanWords(s, fn) {
  let out = '', i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'") { let j = i + 1; while (j < s.length) { if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } break; } j++; } out += s.slice(i, j + 1); i = j + 1; continue; }
    if (/[A-Za-z_]/.test(ch)) { let j = i; while (j < s.length && /\w/.test(s[j])) j++; const w = s.slice(i, j); out += (s[i - 1] === '@' || s[i - 1] === '[' ) ? w : fn(w); i = j; continue; }
    out += ch; i++;
  }
  return out;
}

// ============================ Lược đồ (CREATE TABLE) ============================
/** Tách các câu lệnh theo dấu ; ngoài cùng. */
function statements(sql) { return splitStatements(sql); }
function splitStatements(sql) {
  const out = []; let cur = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") { let j = i + 1; while (j < sql.length) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; } j++; } cur += sql.slice(i, j + 1); i = j; continue; }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const KEY_WIDTH = 128;
const WIDTH = { email: 320 };

/**
 * Chuyển lược đồ SQLite (SCHEMA + MIGRATIONS + các lệnh tạo chỉ mục) sang danh sách lệnh T-SQL.
 * Cột nằm trong khóa chính, UNIQUE, chỉ mục hoặc khóa ngoại dùng NVARCHAR(128) (giới hạn khóa của SQL Server), cột khác NVARCHAR(MAX).
 */
export function schemaToTsql(schema, migrations, extraIndexes = []) {
  const stmts = statements(schema);
  const keyCols = new Set();
  const addKeys = (list) => list.split(',').map((c) => c.trim().replace(/\s+(ASC|DESC)$/i, '').toLowerCase()).forEach((c) => keyCols.add(c));
  for (const st of [...stmts, ...extraIndexes]) {
    let m = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?\w+\s+ON\s+\w+\s*\(([^)]*)\)/i.exec(st);
    if (m) addKeys(m[1]);
  }
  const tables = [];
  for (const st of stmts) {
    const m = /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(([\s\S]*)\)$/i.exec(st);
    if (!m) continue;
    const defs = splitTop(m[2]);
    tables.push({ name: m[1], defs });
    for (const d of defs) {
      const pk = /^(?:PRIMARY\s+KEY|UNIQUE)\s*\(([^)]*)\)/i.exec(d);
      if (pk) { addKeys(pk[1]); continue; }
      const col = /^(\w+)\s+(\w+)([\s\S]*)$/.exec(d);
      if (!col) continue;
      if (/\b(PRIMARY\s+KEY|UNIQUE)\b/i.test(col[3])) keyCols.add(col[1].toLowerCase());
      const ref = /REFERENCES\s+(\w+)\s*\((\w+)\)/i.exec(col[3]);
      if (ref) { keyCols.add(col[1].toLowerCase()); keyCols.add(ref[2].toLowerCase()); }
    }
  }
  const type = (name, t) => {
    const T = t.toUpperCase();
    if (T === 'INTEGER') return 'BIGINT';
    if (T === 'REAL') return 'FLOAT';
    if (T === 'TEXT') return keyCols.has(name.toLowerCase()) ? `NVARCHAR(${WIDTH[name.toLowerCase()] || KEY_WIDTH})` : 'NVARCHAR(MAX)';
    return T;
  };
  const out = [];
  for (const t of tables) {
    const cols = t.defs.map((d) => {
      if (/^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)\b/i.test(d)) return d.replace(/\(([^)]*)\)/, (_, list) => `(${list.split(',').map((c) => q(c.trim())).join(', ')})`);
      const m = /^(\w+)\s+(\w+)([\s\S]*)$/.exec(d);
      let rest = m[3];
      if (/INTEGER/i.test(m[2]) && /PRIMARY\s+KEY\s+AUTOINCREMENT/i.test(rest)) return `${q(m[1])} BIGINT IDENTITY(1,1) PRIMARY KEY${rest.replace(/\s*PRIMARY\s+KEY\s+AUTOINCREMENT/i, '')}`;
      rest = rest.replace(/REFERENCES\s+(\w+)\s*\((\w+)\)/i, 'REFERENCES $1($2)');
      return `${q(m[1])} ${type(m[1], m[2])}${rest}`;
    });
    out.push(`IF OBJECT_ID(N'${t.name}', N'U') IS NULL CREATE TABLE ${t.name} (${cols.join(', ')})`);
  }
  for (const st of stmts) {
    const m = /^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]*)\)([\s\S]*)$/i.exec(st);
    if (m) out.push(indexSql(m[1], m[2], m[3], m[4], m[5]));
  }
  for (const [table, col, def] of migrations) {
    const m = /^(\w+)([\s\S]*)$/.exec(def);
    out.push(`IF COL_LENGTH(N'${table}', N'${col}') IS NULL ALTER TABLE ${table} ADD ${q(col)} ${type(col, m[1])}${m[2]}`);
  }
  for (const st of extraIndexes) {
    const m = /^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]*)\)([\s\S]*)$/i.exec(st);
    if (m) out.push(indexSql(m[1], m[2], m[3], m[4], m[5]));
  }
  return out;
}

function indexSql(unique, name, table, cols, tail) {
  return `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'${name}' AND object_id = OBJECT_ID(N'${table}')) CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${table}(${cols})${tail || ''}`;
}
