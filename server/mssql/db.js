// CSDL SQL Server với cùng cách gọi như better-sqlite3 (prepare/get/all/run/transaction/exec), để mã ứng dụng không phải đổi.
import { toTsql, schemaToTsql } from './translate.js';
import { createBridge } from './bridge.js';

export function openMssql(cfg, { schema, migrations, extraIndexes }) {
  const bridge = createBridge(cfg);
  const cache = new Map();
  const tr = (sql) => { let t = cache.get(sql); if (!t) { t = toTsql(sql); cache.set(sql, t); } return t; };
  const args = (p) => (p.length === 1 && Array.isArray(p[0]) ? p[0] : p);
  const check = (t, p) => { if (p.length !== t.nparams) throw new Error(`Câu lệnh cần ${t.nparams} giá trị nhưng nhận ${p.length}: ${t.text.slice(0, 120)}`); };

  let depth = 0, sp = 0;
  const db = {
    kind: 'mssql',
    name: cfg.database,
    prepare(sql) {
      return {
        get(...p) { const a = args(p); const t = tr(sql); check(t, a); return bridge.call(t.text, a).rows[0]; },
        all(...p) { const a = args(p); const t = tr(sql); check(t, a); return bridge.call(t.text, a).rows; },
        run(...p) {
          const a = args(p); const t = tr(sql); check(t, a);
          const insert = /^\s*INSERT\b/i.test(sql) || /\bINSERT\s+INTO\b/i.test(t.text);
          const text = insert ? `${t.text}; SELECT SCOPE_IDENTITY() AS __id` : t.text;
          const r = bridge.call(text, a, insert);
          return { changes: r.changes, lastInsertRowid: r.lastId ?? 0 };
        }
      };
    },
    /** Chạy trực tiếp một lô T-SQL (không dịch). */
    raw(text, params = []) { return bridge.call(text, params); },
    exec(sql) { throw new Error('Dùng db.raw() với T-SQL trên SQL Server: ' + String(sql).slice(0, 80)); },
    pragma() { return []; },
    transaction(fn) {
      const f = (...a) => {
        const outer = depth === 0; const name = `sp${++sp}`;
        bridge.call(outer ? 'BEGIN TRANSACTION' : `SAVE TRANSACTION ${name}`);
        depth++;
        try {
          const r = fn(...a);
          depth--;
          if (outer) bridge.call('COMMIT TRANSACTION');
          return r;
        } catch (e) {
          depth--;
          try { bridge.call(outer ? 'IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION' : `ROLLBACK TRANSACTION ${name}`); } catch { /* kết nối đã mất */ }
          throw e;
        }
      };
      f.immediate = f; f.deferred = f; f.exclusive = f;
      return f;
    },
    close() { bridge.close(); },
    /** Xóa toàn bộ bảng rồi tạo lại (chỉ dùng khi nạp dữ liệu mẫu hoặc kiểm thử). */
    resetAll() {
      bridge.call(`DECLARE @s nvarchar(max) = N''; SELECT @s += N'ALTER TABLE ' + QUOTENAME(OBJECT_NAME(parent_object_id)) + N' DROP CONSTRAINT ' + QUOTENAME(name) + N';' FROM sys.foreign_keys; EXEC sp_executesql @s;
        SET @s = N''; SELECT @s += N'DROP TABLE ' + QUOTENAME(name) + N';' FROM sys.tables; EXEC sp_executesql @s;`);
      db.init();
    },
    init() { for (const stmt of schemaToTsql(schema, migrations, extraIndexes)) bridge.call(stmt); }
  };
  db.init();
  return db;
}
