// Thời gian và giới hạn giỏ hàng: cấu hình chung cho toàn chuỗi, ghi đè riêng từng chi nhánh (để trống = dùng giá trị chung).
// Thứ tự ưu tiên: ghi đè của chi nhánh > cấu hình chung > mặc định (biến môi trường cũ vẫn dùng làm mặc định).
import { getSetting, setSetting } from '../db.js';

export const LIMITS_KEY = 'cart_limits';
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

/** key -> { label, unit, min, max, def, int } (def lấy từ biến môi trường cũ để không đổi hành vi hiện có). */
export const FIELDS = {
  lockedMinutes: { label: 'Hạn chờ thanh toán tại quầy', unit: 'phút', min: 5, max: 240, def: num(process.env.LOCKED_TTL_MINUTES, 30), int: true },
  receiptMinutes: { label: 'Hạn giữ sau khi đã thanh toán', unit: 'phút', min: 10, max: 1440, def: num(process.env.RECEIPT_TTL_MIN, 180), int: true },
  idleHours: { label: 'Hạn không thao tác khi đang quét hàng', unit: 'giờ', min: 0.5, max: 24, def: num(process.env.CART_TTL_HOURS, 3), int: false },
  maxShopHours: { label: 'Thời gian tối đa một lần mua sắm (0 = không giới hạn)', unit: 'giờ', min: 0, max: 24, def: 0, int: false },
  maxItems: { label: 'Số mã hàng khác nhau tối đa trong một giỏ', unit: 'mã', min: 10, max: 500, def: num(process.env.MAX_CART_ITEMS, 200), int: true },
  maxQty: { label: 'Số lượng tối đa mỗi mã hàng', unit: 'cái', min: 1, max: 999, def: 99, int: true }
};
export const FIELD_KEYS = Object.keys(FIELDS);
export const DEFAULTS = Object.fromEntries(FIELD_KEYS.map((k) => [k, FIELDS[k].def]));

const read = (db) => { const s = getSetting(db, LIMITS_KEY, {}); return { global: s.global || {}, stores: s.stores || {} }; };

/** Giá trị đang áp dụng cho một chi nhánh. `base` cho phép ghi đè mặc định (dùng trong kiểm thử). */
export function limitsFor(db, storeId, base = {}) {
  const s = read(db);
  const out = {};
  for (const k of FIELD_KEYS) {
    const v = s.stores?.[storeId]?.[k] ?? s.global?.[k] ?? base[k] ?? FIELDS[k].def;
    out[k] = Number(v);
  }
  return out;
}

function clean(patch) {
  const out = {}; const clear = [];
  for (const [k, v] of Object.entries(patch || {})) {
    const f = FIELDS[k];
    if (!f) return { error: `Không có mục cấu hình "${k}"` };
    if (v === null || v === '') { clear.push(k); continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < f.min || n > f.max || (f.int && !Number.isInteger(n))) return { error: `${f.label}: nhập ${f.int ? 'số nguyên' : 'số'} từ ${f.min} đến ${f.max} ${f.unit}` };
    out[k] = f.int ? n : Math.round(n * 100) / 100;
  }
  return { set: out, clear };
}

export function limitsConfig(db) {
  const s = read(db);
  return { fields: FIELDS, defaults: DEFAULTS, global: { ...DEFAULTS, ...s.global }, stores: s.stores };
}

/** Lưu cấu hình chung. Giá trị rỗng/null = quay về mặc định. */
export function saveGlobal(db, patch) {
  const c = clean(patch); if (c.error) return c;
  const s = read(db);
  const g = { ...s.global, ...c.set }; for (const k of c.clear) delete g[k];
  setSetting(db, LIMITS_KEY, { global: g, stores: s.stores });
  return { ok: true, before: s.global, after: g };
}

/** Lưu ghi đè cho một chi nhánh. Giá trị rỗng/null = dùng giá trị chung; patch = null xóa hết ghi đè. */
export function saveStore(db, storeId, patch) {
  const s = read(db);
  const before = s.stores[storeId] || {};
  if (patch === null) { delete s.stores[storeId]; setSetting(db, LIMITS_KEY, { global: s.global, stores: s.stores }); return { ok: true, before, after: {} }; }
  const c = clean(patch); if (c.error) return c;
  const o = { ...before, ...c.set }; for (const k of c.clear) delete o[k];
  if (Object.keys(o).length) s.stores[storeId] = o; else delete s.stores[storeId];
  setSetting(db, LIMITS_KEY, { global: s.global, stores: s.stores });
  return { ok: true, before, after: o };
}
