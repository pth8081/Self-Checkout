// Đặt tên đăng nhập kiểu AD (ví dụ anh.dp) cho tài khoản đã có. Mã tài khoản (QT0002...) giữ nguyên.
//   npm run set-username -- --id QT0002 --username anh.dp        (bỏ tên: --username "")
import '../scripts/load-env.js';
import { config } from './config.js';
import { openDb } from './db.js';
import { cleanUsername, usernameTaken } from './auth.js';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const id = String(arg('id') || '').toUpperCase();
const raw = arg('username');
if (!id || raw === undefined) { console.error('Cách dùng: npm run set-username -- --id QT0002 --username anh.dp'); process.exit(1); }
const username = cleanUsername(raw);
if (username === false) { console.error('Tên đăng nhập gồm 3–40 ký tự: chữ thường không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang (ví dụ anh.dp).'); process.exit(1); }
const db = openDb(config.db);
if (!db.prepare('SELECT 1 FROM staff WHERE id = ?').get(id)) { console.error(`Không có tài khoản ${id}.`); process.exit(1); }
if (username && usernameTaken(db, username, id)) { console.error(`Tên ${username} đã có người dùng (trùng mã tài khoản, email hoặc tên đăng nhập khác).`); process.exit(1); }
db.prepare('UPDATE staff SET username = ? WHERE id = ?').run(username, id);
console.log(username ? `Đã đặt tên đăng nhập ${username} cho ${id}. Đăng nhập tại /a/ bằng ${username} hoặc ${id}.` : `Đã bỏ tên đăng nhập của ${id}.`);
