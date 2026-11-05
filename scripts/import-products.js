// Nhập sản phẩm và giá của chi nhánh từ file CSV vào nguồn giá (dùng khi chưa có API giá thật, hoặc để thử).
// Dùng: npm run import-products -- <file.csv> [--replace]
// Cột (dòng đầu là tên cột, dấu phẩy hoặc chấm phẩy): store, sku, barcode, name, price, unit, active, age_restricted, promo_min_qty, promo_off, stock
//   store: mã chi nhánh BRG (ví dụ Q7). price, promo_off: đồng. active, age_restricted: 1 hoặc 0 (mặc định 1 và 0).
// --replace: xoá sản phẩm cũ của các chi nhánh có trong file trước khi nhập.
import fs from 'node:fs';
import './load-env.js';
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';

const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('Dùng: npm run import-products -- <file.csv> [--replace]'); process.exit(1); }
const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
const lines = text.split(/\r?\n/).filter((l) => l.trim());
const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
const split = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
const head = split(lines[0]).map((h) => h.toLowerCase());
for (const need of ['store', 'sku', 'barcode', 'name', 'price']) if (!head.includes(need)) { console.error(`Thiếu cột "${need}"`); process.exit(1); }
const db = openDb(config.dbFile);
const stores = new Set(db.prepare('SELECT id FROM stores').all().map((r) => r.id));
const now = new Date().toISOString();
const rows = []; const errors = [];
lines.slice(1).forEach((l, i) => {
  const c = Object.fromEntries(split(l).map((v, k) => [head[k], v]));
  const store = String(c.store || '').toUpperCase(), price = Number(c.price);
  if (!stores.has(store)) return errors.push(`Dòng ${i + 2}: chi nhánh "${c.store}" chưa có trong BRG`);
  if (!c.sku || !/^\d{6,14}$/.test(c.barcode || '') || !c.name || !Number.isInteger(price) || price < 0) return errors.push(`Dòng ${i + 2}: sku, barcode (6–14 số), name, price (số nguyên) chưa đúng`);
  rows.push({ store, sku: c.sku, barcode: c.barcode, name: c.name, price, unit: c.unit || '', active: c.active === '0' ? 0 : 1, age: c.age_restricted === '1' ? 1 : 0,
    pmq: Number(c.promo_min_qty) || 0, poff: Number(c.promo_off) || 0, stock: Number(c.stock) || 0 });
});
if (errors.length) { console.error(errors.slice(0, 20).join('\n')); if (errors.length > 20) console.error(`… và ${errors.length - 20} lỗi khác`); console.error('Không nhập gì. Hãy sửa file rồi chạy lại.'); process.exit(1); }
db.transaction(() => {
  if (process.argv.includes('--replace')) for (const s of new Set(rows.map((r) => r.store))) { db.prepare('DELETE FROM pos_products WHERE store_id = ?').run(s); db.prepare('DELETE FROM product_cache WHERE store_id = ?').run(s); }
  const up = db.prepare(`INSERT INTO pos_products(store_id,sku,barcode,name,price,stock,unit,active,age_restricted,promo_min_qty,promo_off,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(store_id,sku) DO UPDATE SET barcode=excluded.barcode,name=excluded.name,price=excluded.price,stock=excluded.stock,unit=excluded.unit,active=excluded.active,age_restricted=excluded.age_restricted,promo_min_qty=excluded.promo_min_qty,promo_off=excluded.promo_off,updated_at=excluded.updated_at`);
  for (const r of rows) up.run(r.store, r.sku, r.barcode, r.name, r.price, r.stock, r.unit, r.active, r.age, r.pmq, r.poff, now);
})();
console.log(`Đã nhập ${rows.length} sản phẩm cho ${new Set(rows.map((r) => r.store)).size} chi nhánh. Máy chủ đồng bộ vào bộ nhớ đệm trong vòng 1 phút (hoặc bấm "Đồng bộ ngay" ở mục Tích hợp).`);
