// Đổi mã tài khoản (tên đăng nhập) của một nhân viên hoặc quản trị. Cập nhật cả nhật ký, ca làm, giao dịch liên quan.
//   npm run rename-account -- --from QT0002 --to ANHDP
// Sau khi đổi, người đó đăng nhập bằng mã mới (phiên đang đăng nhập bị hết hiệu lực, đăng nhập lại).
import '../scripts/load-env.js';
import { config } from './config.js';
import { openDb } from './db.js';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const from = String(arg('from') || '').toUpperCase();
const to = String(arg('to') || '').toUpperCase();
if (!from || !to) { console.error('Cách dùng: npm run rename-account -- --from MÃ_CŨ --to MÃ_MỚI'); process.exit(1); }
if (!/^[A-Z0-9]{3,10}$/.test(to)) { console.error('Mã mới gồm 3–10 chữ hoa hoặc số (không dấu, không dấu chấm).'); process.exit(1); }
const db = openDb(config.db);
if (!db.prepare('SELECT 1 FROM staff WHERE id = ?').get(from)) { console.error(`Không có tài khoản ${from}.`); process.exit(1); }
if (from === to) { console.error('Mã mới trùng mã cũ.'); process.exit(1); }
if (db.prepare('SELECT 1 FROM staff WHERE id = ?').get(to)) { console.error(`Mã ${to} đã có người dùng.`); process.exit(1); }

// Cột lưu mã tài khoản (khớp đúng nguyên giá trị mới đổi, không đụng các giá trị khác như "Dsmart POS:...").
const COLS = [['shifts', 'staff_id'], ['shift_plans', 'staff_id'], ['gate_scans', 'staff_id'], ['exit_checks', 'staff_id'], ['exit_checks', 'resolved_by'],
  ['transactions', 'exited_by'], ['transactions', 'voided_by'], ['payments', 'collected_by'], ['statements', 'uploaded_by'],
  ['integration_keys', 'created_by'], ['audit_events', 'actor_id'], ['staff', 'id']];
let n = 0;
db.transaction(() => {
  for (const [t, c] of COLS) n += db.prepare(`UPDATE ${t} SET ${c} = ? WHERE ${c} = ?`).run(to, from).changes;
})();
console.log(`Đã đổi ${from} thành ${to} (${n} dòng dữ liệu được cập nhật). Đăng nhập bằng mã ${to}.`);
