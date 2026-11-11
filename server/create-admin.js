// Tạo tài khoản quản trị đầu tiên khi triển khai thật (không dùng dữ liệu mẫu).
//   Đặt lại mật khẩu tài khoản đã có: thêm --reset.
//   node server/create-admin.js --id QT0001 --name "Quản trị chuỗi" --password "MatKhauManh123"
import '../scripts/load-env.js';
import { config } from './config.js';
import { openDb } from './db.js';
import { hashSecret } from './auth.js';
import { nowIso } from './util.js';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const id = String(arg('id') || 'QT0001').toUpperCase();
const name = arg('name') || 'Quản trị chuỗi';
const password = arg('password');
const pin = arg('pin');
if (!/^[A-Z0-9]{3,10}$/.test(id)) { console.error('Mã tài khoản gồm 3–10 chữ hoa hoặc số.'); process.exit(1); }
if (!password || password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { console.error('Cần --password tối thiểu 8 ký tự, có cả chữ và số.'); process.exit(1); }
if (pin && !/^\d{4,6}$/.test(pin)) { console.error('PIN gồm 4–6 chữ số.'); process.exit(1); }
const db = openDb(config.db);
const exists = db.prepare('SELECT id, role FROM staff WHERE id = ?').get(id);
if (exists && process.argv.includes('--reset')) {
  // Đặt lại mật khẩu cho tài khoản đã có (quên mật khẩu, hoặc bị khóa tạm do nhập sai nhiều lần). Mở khóa và bật lại tài khoản.
  db.prepare('UPDATE staff SET pw_hash = ?, failed = 0, locked_until = NULL, active = 1 WHERE id = ?').run(hashSecret(password), id);
  console.log(`Đã đặt lại mật khẩu cho ${id} và mở khóa. Đăng nhập tại /a/ bằng mã tài khoản ${id}.`);
  process.exit(0);
}
if (exists) { console.error(`Tài khoản ${id} đã tồn tại. Muốn đặt lại mật khẩu, thêm --reset.`); process.exit(1); }
db.prepare('INSERT INTO staff(id,store_id,name,role,email,pin_hash,pw_hash,created_at) VALUES(?,?,?,?,?,?,?,?)')
  .run(id, null, name, 'chain_admin', arg('email') || null, pin ? hashSecret(pin) : null, hashSecret(password), nowIso());
console.log(`Đã tạo quản trị chuỗi ${id}. Hãy đăng nhập tại /a/ và bật xác thực 2 bước ngay.`);
