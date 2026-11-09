import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS store_config (
  store_id TEXT PRIMARY KEY REFERENCES stores(id),
  pay_cash INTEGER NOT NULL DEFAULT 1,
  pay_qr INTEGER NOT NULL DEFAULT 1,
  pay_online INTEGER NOT NULL DEFAULT 0,
  qr_provider TEXT NOT NULL DEFAULT 'self',
  random_check_rate REAL NOT NULL DEFAULT 0.1,
  rate_first_time REAL NOT NULL DEFAULT 0.2,
  rate_high_value REAL NOT NULL DEFAULT 0.25,
  high_value_threshold INTEGER NOT NULL DEFAULT 500000,
  bank_bin TEXT DEFAULT '', bank_name TEXT DEFAULT '', bank_account TEXT DEFAULT '', bank_holder TEXT DEFAULT '',
  pos_stale_minutes INTEGER NOT NULL DEFAULT 5,
  payment_source TEXT NOT NULL DEFAULT 'manual',
  guard_check INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY, store_id TEXT REFERENCES stores(id), name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('chain_admin','branch_admin','cashier','gate','cashier_gate')),
  email TEXT, pin_hash TEXT, pw_hash TEXT, totp_secret TEXT,
  active INTEGER NOT NULL DEFAULT 1, failed INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pos_products (
  store_id TEXT NOT NULL, sku TEXT NOT NULL, barcode TEXT NOT NULL, name TEXT NOT NULL,
  price INTEGER NOT NULL, stock INTEGER NOT NULL, unit TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1, age_restricted INTEGER NOT NULL DEFAULT 0,
  promo_min_qty INTEGER NOT NULL DEFAULT 0, promo_off INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL, PRIMARY KEY (store_id, sku)
);
CREATE TABLE IF NOT EXISTS product_cache (
  store_id TEXT NOT NULL, sku TEXT NOT NULL, barcode TEXT NOT NULL, name TEXT NOT NULL,
  price INTEGER NOT NULL, stock INTEGER NOT NULL, unit TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1, age_restricted INTEGER NOT NULL DEFAULT 0,
  promo_min_qty INTEGER NOT NULL DEFAULT 0, promo_off INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL, PRIMARY KEY (store_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_cache_barcode ON product_cache(store_id, barcode);
CREATE TABLE IF NOT EXISTS scan_sessions (
  id TEXT PRIMARY KEY, store_id TEXT NOT NULL, device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', started_at TEXT NOT NULL, locked_at TEXT,
  ended_at TEXT, last_activity TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON scan_sessions(device_id, status);
CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES scan_sessions(id),
  sku TEXT NOT NULL, barcode TEXT NOT NULL, name TEXT NOT NULL, unit_price INTEGER NOT NULL,
  qty INTEGER NOT NULL, promo_min_qty INTEGER NOT NULL DEFAULT 0, promo_off INTEGER NOT NULL DEFAULT 0,
  age_restricted INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL,
  UNIQUE (session_id, sku)
);
CREATE TABLE IF NOT EXISTS processed_ops (
  session_id TEXT NOT NULL, op_id TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY (session_id, op_id)
);
CREATE TABLE IF NOT EXISTS scan_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, store_id TEXT NOT NULL,
  type TEXT NOT NULL, barcode TEXT, detail TEXT, ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS unknown_barcodes (
  store_id TEXT NOT NULL, barcode TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1,
  last_seen TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', PRIMARY KEY (store_id, barcode)
);
CREATE TABLE IF NOT EXISTS counters (
  store_id TEXT NOT NULL, name TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (store_id, name)
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, store_id TEXT NOT NULL, device_id TEXT NOT NULL,
  cart_code TEXT NOT NULL, transfer_content TEXT NOT NULL,
  subtotal INTEGER NOT NULL, discount INTEGER NOT NULL, total INTEGER NOT NULL,
  method TEXT NOT NULL, status TEXT NOT NULL,
  check_required INTEGER NOT NULL DEFAULT 0, check_done INTEGER NOT NULL DEFAULT 0,
  exit_status TEXT NOT NULL DEFAULT 'none', extra_due INTEGER NOT NULL DEFAULT 0,
  items_json TEXT NOT NULL, item_count INTEGER NOT NULL, age_restricted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, paid_at TEXT, exited_at TEXT, exited_by TEXT, exited_gate TEXT,
  receipt_expires_at TEXT, rating INTEGER, void_reason TEXT, voided_at TEXT, voided_by TEXT,
  pos_order_ref TEXT, pos_status TEXT, pos_claimed_at TEXT, pos_cashier TEXT, pos_terminal TEXT,
  pos_amount INTEGER, pos_invoice_no TEXT, buyer_json TEXT, guard_skipped INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tx_store_status ON transactions(store_id, status);
CREATE INDEX IF NOT EXISTS idx_tx_store_code ON transactions(store_id, cart_code);
CREATE INDEX IF NOT EXISTS idx_tx_device ON transactions(device_id);
CREATE INDEX IF NOT EXISTS idx_tx_session ON transactions(session_id);
-- Hoàn trả một phần sau thanh toán (DS Smart POS báo). Mỗi lần hoàn có mã riêng để báo lại không bị ghi trùng.
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT NOT NULL, ref TEXT NOT NULL, amount INTEGER NOT NULL,
  method TEXT NOT NULL, reason TEXT, lines_json TEXT, created_at TEXT NOT NULL, UNIQUE (transaction_id, ref)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT NOT NULL REFERENCES transactions(id),
  store_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'main', method TEXT NOT NULL, amount INTEGER NOT NULL,
  cash_received INTEGER, change_given INTEGER, collected_by TEXT NOT NULL, shift_id INTEGER,
  collected_at TEXT NOT NULL, provider TEXT, provider_ref TEXT, confirmations TEXT, voided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_store_time ON payments(store_id, collected_at);
CREATE TABLE IF NOT EXISTS exit_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT NOT NULL REFERENCES transactions(id),
  store_id TEXT NOT NULL, staff_id TEXT NOT NULL, place TEXT NOT NULL DEFAULT 'gate',
  result TEXT NOT NULL, kind TEXT, sku TEXT, amount INTEGER, note TEXT, action TEXT,
  lines TEXT, created_at TEXT NOT NULL, resolution TEXT, resolved_by TEXT, resolved_at TEXT, resolve_note TEXT
);
CREATE TABLE IF NOT EXISTS gate_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL, staff_id TEXT NOT NULL,
  transaction_id TEXT, outcome TEXT NOT NULL, detail TEXT, ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL, staff_id TEXT NOT NULL,
  kind TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
  system_cash INTEGER, counted_cash INTEGER, diff INTEGER, note TEXT
);
CREATE TABLE IF NOT EXISTS shift_plans (
  store_id TEXT NOT NULL, staff_id TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL,
  PRIMARY KEY (store_id, staff_id, date)
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT NOT NULL, type TEXT NOT NULL,
  email TEXT, tax_code TEXT, company_name TEXT, address TEXT, status TEXT NOT NULL,
  number TEXT, error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_tx ON invoices(transaction_id);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, store_id TEXT,
  actor_type TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL, entity TEXT, entity_id TEXT, data TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_store ON audit_events(store_id, ts);
CREATE TABLE IF NOT EXISTS device_emails (
  device_id TEXT NOT NULL, email TEXT NOT NULL, verified_at TEXT NOT NULL, PRIMARY KEY (device_id, email)
);
CREATE TABLE IF NOT EXISTS identity_codes (
  device_id TEXT NOT NULL, email TEXT NOT NULL, code TEXT NOT NULL, expires_at TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, email)
);
CREATE TABLE IF NOT EXISTS statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL, date TEXT NOT NULL,
  lines TEXT NOT NULL, uploaded_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS integration_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL,
  store_id TEXT, active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL, last_used_at TEXT
);
`;

/** Thêm cột còn thiếu cho CSDL tạo từ phiên bản cũ (CREATE TABLE IF NOT EXISTS không tự thêm cột). */
const MIGRATIONS = [
  ['transactions', 'extra_qty', 'INTEGER NOT NULL DEFAULT 0'], ['transactions', 'extra_value', 'INTEGER NOT NULL DEFAULT 0'], ['transactions', 'less_qty', 'INTEGER NOT NULL DEFAULT 0'],
  ['transactions', 'pos_draft_json', 'TEXT'],
  ['transactions', 'bill_email', 'TEXT'], ['transactions', 'bill_email_status', 'TEXT'], ['transactions', 'bill_email_tries', 'INTEGER NOT NULL DEFAULT 0'],
  ['transactions', 'bill_email_error', 'TEXT'], ['transactions', 'bill_email_at', 'TEXT'],
  ['transactions', 'pos_bill_json', 'TEXT'], ['transactions', 'pos_invoice_url', 'TEXT'],
  ['store_config', 'checkout_mode', "TEXT NOT NULL DEFAULT 'basket'"],
  ['stores', 'pos_code', "TEXT NOT NULL DEFAULT ''"],
  ['store_config', 'payment_source', "TEXT NOT NULL DEFAULT 'manual'"], ['store_config', 'guard_check', 'INTEGER NOT NULL DEFAULT 1'],
  ['transactions', 'pos_order_ref', 'TEXT'], ['transactions', 'pos_status', 'TEXT'], ['transactions', 'pos_claimed_at', 'TEXT'],
  ['transactions', 'pos_cashier', 'TEXT'], ['transactions', 'pos_terminal', 'TEXT'], ['transactions', 'pos_amount', 'INTEGER'],
  ['transactions', 'pos_invoice_no', 'TEXT'], ['transactions', 'buyer_json', 'TEXT'], ['transactions', 'guard_skipped', 'INTEGER NOT NULL DEFAULT 0']
];
function migrate(db) {
  for (const [table, col, def] of MIGRATIONS) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_tx_pos_ref ON transactions(pos_order_ref)');
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_pos_code ON stores(pos_code) WHERE pos_code <> ''");
}

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000'); // chờ tối đa 5 giây khi tiến trình khác đang ghi
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  // Mọi giao dịch CSDL bắt đầu bằng khoá ghi (BEGIN IMMEDIATE). Giao dịch "trì hoãn" mặc định đọc trước rồi mới xin khoá ghi,
  // nên khi có tiến trình khác vừa ghi xong sẽ báo "database is locked" ngay, không chờ busy_timeout.
  const txn = db.transaction.bind(db);
  db.transaction = (fn) => { const t = txn(fn); const f = (...a) => t.immediate(...a); f.immediate = t.immediate; return f; };
  return db;
}

export const getSetting = (db, key, fallback = null) => {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : fallback;
};
export const setSetting = (db, key, value) =>
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(value));

/** Tăng bộ đếm theo chi nhánh, trả về giá trị mới. */
export function nextCounter(db, storeId, name) {
  db.prepare(`INSERT INTO counters(store_id,name,value) VALUES(?,?,1)
    ON CONFLICT(store_id,name) DO UPDATE SET value = value + 1`).run(storeId, name);
  return db.prepare('SELECT value FROM counters WHERE store_id=? AND name=?').get(storeId, name).value;
}
