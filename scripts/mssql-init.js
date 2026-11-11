// Tạo CSDL trên SQL Server (nếu chưa có) và kiểm tra kết nối, quyền, kiểu so sánh chuỗi.
//   node --env-file=.env scripts/mssql-init.js            (hoặc: npm run mssql:init)
// Cần DB_DRIVER=mssql và MSSQL_SERVER, MSSQL_USER, MSSQL_PASSWORD. Tài khoản cần quyền tạo CSDL khi CSDL chưa có;
// nếu CSDL đã do quản trị tạo sẵn thì chỉ cần quyền trong CSDL đó (db_owner hoặc db_datareader + db_datawriter + db_ddladmin).
import { config } from '../server/config.js';
import { createBridge } from '../server/mssql/bridge.js';

if (config.dbDriver !== 'mssql') { console.error('Đặt DB_DRIVER=mssql (và MSSQL_SERVER, MSSQL_USER, MSSQL_PASSWORD) trước.'); process.exit(1); }
const cfg = config.db;
const name = cfg.database;
if (!/^[A-Za-z0-9_]{1,100}$/.test(name)) { console.error('MSSQL_DATABASE chỉ gồm chữ, số, dấu gạch dưới.'); process.exit(1); }

const log = (ok, msg) => console.log(`${ok ? 'OK  ' : 'LỖI'} ${msg}`);
let master;
try {
  master = createBridge({ ...cfg, database: 'master' });
  const v = master.call('SELECT CAST(SERVERPROPERTY(\'ProductVersion\') AS nvarchar(50)) v, CAST(SERVERPROPERTY(\'Edition\') AS nvarchar(100)) e').rows[0];
  log(true, `Kết nối được SQL Server ${v.v} (${v.e})`);
  const has = master.call('SELECT DB_ID(@p1) id', [name]).rows[0].id;
  if (has) log(true, `CSDL ${name} đã có`);
  else {
    try { master.call(`CREATE DATABASE [${name}] COLLATE Vietnamese_100_CI_AS`); log(true, `Đã tạo CSDL ${name} (kiểu so sánh Vietnamese_100_CI_AS)`); }
    catch (e) { log(false, `Không tạo được CSDL ${name}: ${e.message}. Nhờ quản trị tạo sẵn CSDL rồi chạy lại.`); process.exit(1); }
  }
  const col = master.call('SELECT CAST(DATABASEPROPERTYEX(@p1, \'Collation\') AS nvarchar(100)) c', [name]).rows[0].c;
  if (/_CS_/.test(col)) log(false, `CSDL dùng kiểu so sánh PHÂN BIỆT hoa thường (${col}). Ứng dụng được thử với kiểu KHÔNG phân biệt (CI), nên chọn ví dụ Vietnamese_100_CI_AS.`);
  else log(true, `Kiểu so sánh chuỗi: ${col}`);
  master.close();
  const db = createBridge(cfg);
  const me = db.call('SELECT SUSER_SNAME() u, IS_MEMBER(\'db_owner\') o, IS_MEMBER(\'db_ddladmin\') d, IS_MEMBER(\'db_datawriter\') w, IS_MEMBER(\'db_datareader\') r').rows[0];
  const okPerm = me.o === 1 || (me.d === 1 && me.w === 1 && me.r === 1);
  log(okPerm, `Tài khoản ${me.u}: ${okPerm ? 'đủ quyền (đọc, ghi, tạo bảng)' : 'THIẾU quyền, cần db_owner hoặc db_datareader + db_datawriter + db_ddladmin trong CSDL ' + name}`);
  db.close();
  if (!okPerm) process.exit(1);
  console.log('Xong. Bảng sẽ tự được tạo khi chạy ứng dụng lần đầu (npm run start:prod).');
  process.exit(0);
} catch (e) { log(false, e.message); process.exit(1); }
