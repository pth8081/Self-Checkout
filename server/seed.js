// Tạo dữ liệu mẫu để chạy thử. KHÔNG dùng ở production: tài khoản mẫu có mật khẩu công khai.
//   node server/seed.js --reset        xóa toàn bộ và tạo lại
//   node server/seed.js --reset --demo thêm lịch sử giao dịch 7 ngày để xem báo cáo
import { config } from './config.js';
import { openDb } from './db.js';
import { hashSecret } from './auth.js';
import { ean13 } from './services/barcode.js';
import { createMockPos } from './services/pos.js';
import { nowIso, localDate } from './util.js';

const PRODUCTS = [
  // sku, tên, giá gốc, đơn vị, cờ
  ['SUA01', 'Sữa tươi ít đường 1L', 34500, 'hộp', { promo: [2, 13000] }],
  ['SUA02', 'Sữa chua uống men sống (lốc 4)', 29000, 'lốc'],
  ['MI01', 'Mì ăn liền tôm chua cay (gói)', 4800, 'gói'],
  ['MI02', 'Mì ly hải sản', 12500, 'ly'],
  ['TRU01', 'Trứng gà hộp 10 quả', 38000, 'hộp'],
  ['NUOC01', 'Nước suối 500ml', 6000, 'chai'],
  ['NUOC02', 'Nước suối 1.5L', 11000, 'chai'],
  ['NUOC03', 'Nước ngọt có ga 330ml', 9500, 'lon', { promo: [3, 3000] }],
  ['DAU01', 'Dầu ăn đậu nành 1L', 52000, 'chai'],
  ['GAO01', 'Gạo thơm 5kg', 118000, 'túi'],
  ['DUONG01', 'Đường tinh luyện 1kg', 24000, 'gói'],
  ['MUOI01', 'Muối i-ốt 500g', 6500, 'gói'],
  ['NUOCMAM', 'Nước mắm cá cơm 500ml', 42000, 'chai'],
  ['TUONG01', 'Tương ớt 250g', 15500, 'chai'],
  ['BANH01', 'Bánh quy bơ 200g', 27000, 'hộp'],
  ['BANH02', 'Bánh mì sandwich lát', 21000, 'túi'],
  ['SNACK01', 'Snack khoai tây vị tự nhiên 52g', 12000, 'gói', { promo: [2, 4000] }],
  ['KEO01', 'Kẹo trái cây hỗn hợp 150g', 18500, 'gói'],
  ['CAFE01', 'Cà phê hòa tan 3 trong 1 (hộp 20)', 55000, 'hộp'],
  ['TRA01', 'Trà xanh túi lọc (hộp 25)', 32000, 'hộp'],
  ['XUC01', 'Xúc xích tiệt trùng (gói 5)', 36000, 'gói'],
  ['THIT01', 'Thịt hộp 340g', 48000, 'hộp'],
  ['CA01', 'Cá hộp sốt cà 155g', 22000, 'hộp'],
  ['RAU01', 'Rau muống đóng gói 300g', 14000, 'gói'],
  ['CHUOI01', 'Chuối tiêu đóng khay 500g', 19000, 'khay'],
  ['GIAY01', 'Giấy vệ sinh (lốc 10 cuộn)', 62000, 'lốc'],
  ['GIAY02', 'Khăn giấy hộp 180 tờ', 17000, 'hộp'],
  ['XABONG', 'Nước rửa chén 750ml', 31000, 'chai'],
  ['DAUGOI', 'Dầu gội 340g', 89000, 'chai'],
  ['KEMDANH', 'Kem đánh răng 180g', 38000, 'tuýp'],
  ['BIA01', 'Bia lon 330ml', 16500, 'lon', { age: true }],
  ['RUOU01', 'Rượu vang đỏ 750ml', 245000, 'chai', { age: true }],
  ['THUOC01', 'Thuốc lá bao 20 điếu', 32000, 'bao', { age: true }],
  ['NGUNG01', 'Bánh xốp sô-cô-la 130g (ngừng bán)', 25000, 'gói', { inactive: true }],
  ['HET01', 'Kẹo cao su bạc hà (hết hàng)', 9000, 'vỉ', { stock: 0 }]
];

const STORES = [
  { id: 'Q7', name: 'Chi nhánh Quận 7', address: 'Quận 7, TP. Hồ Chí Minh', enabled: 1, bump: 0 },
  { id: 'TD', name: 'Chi nhánh Thủ Đức', address: 'TP. Thủ Đức, TP. Hồ Chí Minh', enabled: 1, bump: 500 },
  { id: 'TB', name: 'Chi nhánh Tân Bình', address: 'Quận Tân Bình, TP. Hồ Chí Minh', enabled: 1, bump: 1000 },
  { id: 'GV', name: 'Chi nhánh Gò Vấp', address: 'Quận Gò Vấp, TP. Hồ Chí Minh', enabled: 0, bump: 500 },
  { id: 'Q1', name: 'Chi nhánh Quận 1', address: 'Quận 1, TP. Hồ Chí Minh', enabled: 0, bump: 2000 }
];

export function seed(db, { demo = false } = {}) {
  const ts = nowIso();
  db.transaction(() => {
    for (const s of STORES) {
      db.prepare('INSERT INTO stores(id,name,address,enabled,created_at) VALUES(?,?,?,?,?)').run(s.id, s.name, s.address, s.enabled, ts);
      // Tài khoản ngân hàng mẫu, hãy thay bằng tài khoản thật trong trang quản trị trước khi dùng.
      db.prepare(`INSERT INTO store_config(store_id,bank_bin,bank_name,bank_account,bank_holder) VALUES(?,?,?,?,?)`)
        .run(s.id, '970436', 'Ngân hàng (mẫu)', '0123456789', 'CONG TY MAU');
      PRODUCTS.forEach(([sku, name, price, unit, f = {}], i) => {
        db.prepare(`INSERT INTO pos_products(store_id,sku,barcode,name,price,stock,unit,active,age_restricted,promo_min_qty,promo_off,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(s.id, sku, ean13('893' + String(4000000 + i * 137).padStart(9, '0')), name,
          price + (f.age ? 0 : s.bump), f.stock ?? 120, unit, f.inactive ? 0 : 1, f.age ? 1 : 0, f.promo?.[0] || 0, f.promo?.[1] || 0, ts);
      });
    }
    const addStaff = (id, store, name, role, { pin, pw, email } = {}) =>
      db.prepare('INSERT INTO staff(id,store_id,name,role,email,pin_hash,pw_hash,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, store, name, role, email || null, pin ? hashSecret(pin) : null, pw ? hashSecret(pw) : null, ts);
    addStaff('QT0001', null, 'Quản trị chuỗi', 'chain_admin', { pin: '1234', pw: 'Admin@123', email: 'chuoi@example.com' });
    addStaff('QT0007', 'Q7', 'Quản lý Quận 7', 'branch_admin', { pin: '2345', pw: 'Admin@123', email: 'q7@example.com' });
    addStaff('QT0008', 'TD', 'Quản lý Thủ Đức', 'branch_admin', { pin: '2346', pw: 'Admin@123', email: 'td@example.com' });
    addStaff('NV0142', 'Q7', 'Lan', 'cashier_gate', { pin: '1111' });
    addStaff('NV0157', 'Q7', 'Minh', 'gate', { pin: '2222' });
    addStaff('NV0160', 'Q7', 'Hà', 'cashier', { pin: '3333' });
    addStaff('NV0201', 'TD', 'Nam', 'cashier_gate', { pin: '4444' });
    addStaff('NV0301', 'TB', 'Thu', 'cashier_gate', { pin: '5555' });
    // Lịch ca tuần này cho Quận 7
    const t = new Date(`${localDate()}T00:00:00Z`);
    const monday = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400_000);
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getTime() + i * 86400_000).toISOString().slice(0, 10);
      const plan = (id, kind) => db.prepare('INSERT INTO shift_plans(store_id,staff_id,date,kind) VALUES(?,?,?,?) ON CONFLICT(store_id,staff_id,date) DO UPDATE SET kind=excluded.kind').run('Q7', id, d, kind);
      plan('NV0142', i % 2 ? 'chieu' : 'sang'); plan('NV0157', i % 2 ? 'sang' : 'chieu'); if (i % 3 !== 2) plan('NV0160', 'sang');
    }
  })();
  createMockPos(db).syncAll();
  if (demo) seedDemoHistory(db);
}

function seedDemoHistory(db) {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const ins = {
    tx: db.prepare(`INSERT INTO transactions(id,session_id,store_id,device_id,cart_code,transfer_content,subtotal,discount,total,method,status,check_required,check_done,exit_status,extra_due,items_json,item_count,age_restricted,created_at,paid_at,exited_at,exited_by,exited_gate,receipt_expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'paid',?,?, 'exited',0,?,?,0,?,?,?,?,?,?)`),
    pay: db.prepare(`INSERT INTO payments(transaction_id,store_id,kind,method,amount,cash_received,change_given,collected_by,shift_id,collected_at) VALUES(?,?,'main',?,?,?,?,?,?,?)`),
    chk: db.prepare(`INSERT INTO exit_checks(transaction_id,store_id,staff_id,place,result,kind,amount,note,action,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`),
    shift: db.prepare('INSERT INTO shifts(store_id,staff_id,kind,started_at,ended_at,system_cash,counted_cash,diff) VALUES(?,?,?,?,?,?,?,?)'),
    counter: db.prepare(`INSERT INTO counters(store_id,name,value) VALUES(?,?,?) ON CONFLICT(store_id,name) DO UPDATE SET value=excluded.value`)
  };
  const staffOf = { Q7: 'NV0142', TD: 'NV0201', TB: 'NV0301' };
  const volume = { Q7: 60, TD: 72, TB: 44 };
  db.transaction(() => {
    for (const store of ['Q7', 'TD', 'TB']) {
      const prods = db.prepare('SELECT * FROM pos_products WHERE store_id = ? AND active = 1 AND stock > 0 AND age_restricted = 0').all(store);
      let seq = 0;
      for (let back = 6; back >= 1; back--) {
        const day = new Date(Date.now() - back * 86400_000);
        const dayStart = new Date(`${localDate(day.toISOString())}T00:00:00+07:00`);
        let cashSum = 0;
        const n = Math.round(volume[store] * (0.8 + rnd() * 0.5));
        const shiftStart = new Date(dayStart.getTime() + 7 * 3600_000).toISOString();
        const shiftEnd = new Date(dayStart.getTime() + 22 * 3600_000).toISOString();
        const shiftId = db.prepare('INSERT INTO shifts(store_id,staff_id,kind,started_at) VALUES(?,?,?,?)').run(store, staffOf[store], 'sang', shiftStart).lastInsertRowid;
        for (let i = 0; i < n; i++) {
          seq++;
          const k = 1 + Math.floor(rnd() * 5), items = [];
          for (let j = 0; j < k; j++) { const p = prods[Math.floor(rnd() * prods.length)]; items.push({ sku: p.sku, barcode: p.barcode, name: p.name, price: p.price, qty: 1 + Math.floor(rnd() * 3), discount: 0 }); }
          const total = items.reduce((a, x) => a + x.price * x.qty, 0);
          const at = new Date(dayStart.getTime() + (8 + rnd() * 13) * 3600_000).toISOString();
          const method = rnd() < 0.45 ? 'cash' : 'qr_transfer';
          const num = String(seq).padStart(4, '0') ;
          const id = `SG-${store}-D${back}${num}`;
          const checked = rnd() < 0.1;
          ins.tx.run(id, `demo-${id}`, store, `demo-device-${store}-${i}`, `GH-${store}-D${back}${num}`, `SG ${store} D${back}${num}`, total, 0, total, method, checked ? 1 : 0, checked ? 1 : 0,
            JSON.stringify(items), items.reduce((a, x) => a + x.qty, 0), at, at, at, staffOf[store], 'Cổng 1', at);
          ins.pay.run(id, store, method, total, method === 'cash' ? total : null, method === 'cash' ? 0 : null, staffOf[store], shiftId, at);
          if (method === 'cash') cashSum += total;
          if (checked) {
            const mm = rnd() < 0.22;
            ins.chk.run(id, store, staffOf[store], 'gate', mm ? 'mismatch' : 'match', mm ? 'missing_scan' : null, mm ? 20000 : null, mm ? 'Quên quét 1 mặt hàng' : null, mm ? 'collect_extra' : null, at);
          }
        }
        db.prepare('UPDATE shifts SET ended_at=?, system_cash=?, counted_cash=?, diff=0 WHERE id=?').run(shiftEnd, cashSum, cashSum, shiftId);
      }
      ins.counter.run(store, 'tx', 10000);
    }
  })();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (config.isProd && !process.argv.includes('--force')) { console.error('Từ chối chạy seed ở production (thêm --force nếu thật sự muốn).'); process.exit(1); }
  if (process.argv.includes('--reset') && config.dbDriver === 'mssql' && process.env.ALLOW_DB_RESET !== '1') { console.error('Từ chối --reset trên SQL Server (xóa toàn bộ bảng). Nếu chắc chắn chạy trên CSDL thử, đặt ALLOW_DB_RESET=1.'); process.exit(1); }
  const db = openDb(config.db);
  if (process.argv.includes('--reset')) {
    if (db.kind === 'mssql') db.resetAll();
    else {
      db.pragma('foreign_keys = OFF');
      for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) db.exec(`DELETE FROM ${t.name}`);
      db.pragma('foreign_keys = ON');
    }
  }
  if (db.prepare('SELECT COUNT(*) n FROM stores').get().n) { console.error('CSDL đã có dữ liệu. Dùng --reset để tạo lại.'); process.exit(1); }
  seed(db, { demo: process.argv.includes('--demo') });
  if (process.argv.includes('--classic')) db.prepare(`UPDATE store_config SET checkout_mode = 'classic'`).run(); // luồng cũ: thu tại quầy và cổng ra
  console.log('Đã tạo dữ liệu mẫu. Tài khoản thử: xem README.');
}
