// Sao lưu CSDL SQLite an toàn khi máy chủ đang chạy (dùng API sao lưu trực tuyến của SQLite),
// kiểm tra toàn vẹn bản sao, và chỉ giữ lại các bản mới nhất.
//   npm run backup            (BACKUP_DIR, BACKUP_KEEP, DB_FILE đổi được bằng biến môi trường)
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import './load-env.js';
import { config } from '../server/config.js';

const dir = process.env.BACKUP_DIR || path.join(path.dirname(config.dbFile), 'backups');
const keep = Math.max(1, Number(process.env.BACKUP_KEEP || 14));
if (!fs.existsSync(config.dbFile)) { console.error(`Không thấy CSDL: ${config.dbFile}`); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date(Date.now() + config.tzOffsetHours * 3600_000).toISOString().replace(/[-:T]/g, '').slice(0, 12);
const dest = path.join(dir, `brg-${stamp.slice(0, 8)}-${stamp.slice(8, 12)}.db`);
const src = new Database(config.dbFile, { readonly: true, fileMustExist: true });
try {
  await src.backup(dest);
} finally { src.close(); }

const chk = new Database(dest);
chk.pragma('journal_mode = DELETE'); // bản sao là một file duy nhất, không kèm -wal/-shm
const res = chk.pragma('integrity_check', { simple: true });
const stores = chk.prepare('SELECT COUNT(*) n FROM stores').get().n;
chk.close();
if (res !== 'ok') { fs.rmSync(dest, { force: true }); console.error(`Bản sao hỏng (${res}), đã xóa.`); process.exit(1); }

const files = fs.readdirSync(dir).filter((f) => /^brg-\d{8}-\d{4}\.db$/.test(f)).sort();
for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(dir, f));
console.log(`Đã sao lưu ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB, ${stores} chi nhánh). Còn ${Math.min(files.length, keep)} bản.`);
