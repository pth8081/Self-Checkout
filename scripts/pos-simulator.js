// Đóng vai POS gọi API của BRG Scan & Checkout, để thử và để nhà cung cấp POS đối chiếu cách gọi.
//   node scripts/pos-simulator.js --base http://localhost:3000 --key brgpos_xxx <lệnh> [đối số]
// Lệnh:
//   health
//   preview <mã giỏ>                      xem giỏ, không nhận
//   claim <mã giỏ> --ref <mã đơn POS> [--cashier thu01] [--terminal Q1]
//   status <mã đơn POS>
//   paid <mã đơn POS> --amount 112800 --method cash|qr_transfer|card|ewallet|other [--invoice HD0001] [--cashier thu01]
//   cancelled <mã đơn POS> [--reason "Khách đổi ý"]
// Giỏ QR (cách dùng hiện nay): POS báo theo mã giỏ có trong mã QR của khách.
//   basket-status <mã giỏ>
//   basket-paid <mã giỏ> --point <mã điểm> --ref <mã đơn POS> --amount 112800 --method cash|qr_transfer|card|ewallet
//                         [--cashier thu01] [--terminal Q1]
//   basket-cancelled <mã giỏ> --point <mã điểm> --ref <mã đơn POS> [--reason "Khách đổi ý"]
// Biến môi trường thay cho tham số: BASE, KEY.
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const base = (opt('base') || process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const key = opt('key') || process.env.KEY;
const [cmd, arg] = pos;
if (!key || !cmd) { console.error('Cách dùng: node scripts/pos-simulator.js --base <địa chỉ> --key <khoá API> <health|preview|claim|status|paid|cancelled> [đối số]. Xem phần đầu file.'); process.exit(2); }

const routes = {
  health: () => ['GET', '/health'],
  preview: () => ['GET', `/carts/${encodeURIComponent(arg)}`],
  claim: () => ['POST', `/carts/${encodeURIComponent(arg)}/claim`, { posOrderRef: opt('ref'), cashier: opt('cashier'), terminal: opt('terminal') }],
  status: () => ['GET', `/orders/${encodeURIComponent(arg)}`],
  paid: () => ['POST', `/orders/${encodeURIComponent(arg)}/paid`, { amount: Number(opt('amount')), method: opt('method', 'cash'), invoiceNo: opt('invoice'), cashier: opt('cashier') }],
  cancelled: () => ['POST', `/orders/${encodeURIComponent(arg)}/cancelled`, { reason: opt('reason') }],
  'basket-status': () => ['GET', `/baskets/${encodeURIComponent(arg)}`],
  'basket-paid': () => ['POST', `/baskets/${encodeURIComponent(arg)}/paid`, { pointCode: opt('point'), posOrderRef: opt('ref'), amount: Number(opt('amount')), method: opt('method', 'cash'), cashier: opt('cashier'), terminal: opt('terminal') }],
  'basket-cancelled': () => ['POST', `/baskets/${encodeURIComponent(arg)}/cancelled`, { pointCode: opt('point'), posOrderRef: opt('ref'), reason: opt('reason') }]
};
if (!routes[cmd]) { console.error(`Lệnh không có: ${cmd}`); process.exit(2); }
const [method, path, body] = routes[cmd]();
const res = await fetch(`${base}/api/pos/v1${path}`, {
  method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch { console.log(text); }
process.exit(res.ok ? 0 : 1);
