// Adapter Dsmart POS. Hiện dùng bản giả lập đọc bảng pos_products (đóng vai hệ thống Dsmart POS thật).
// Khi nối Dsmart POS thật: viết adapter khác có cùng giao diện và chọn trong settings.pos.adapter.
import { nowIso } from '../util.js';

export function createMockPos(db) {
  const copy = db.prepare(`INSERT INTO product_cache
    (store_id,sku,barcode,name,price,stock,unit,active,age_restricted,promo_min_qty,promo_off,synced_at)
    SELECT store_id,sku,barcode,name,price,stock,unit,active,age_restricted,promo_min_qty,promo_off,? FROM pos_products WHERE store_id = ?
    ON CONFLICT(store_id,sku) DO UPDATE SET barcode=excluded.barcode,name=excluded.name,price=excluded.price,stock=excluded.stock,
      unit=excluded.unit,active=excluded.active,age_restricted=excluded.age_restricted,promo_min_qty=excluded.promo_min_qty,
      promo_off=excluded.promo_off,synced_at=excluded.synced_at`);

  return {
    name: 'mock',
    /** Đồng bộ giá/tồn kho một chi nhánh từ Dsmart POS vào bộ nhớ đệm. */
    sync(storeId) {
      const ts = nowIso();
      const r = copy.run(ts, storeId);
      return { storeId, synced: r.changes, at: ts };
    },
    syncAll() {
      return db.prepare('SELECT id FROM stores').all().map((s) => this.sync(s.id));
    },
    /** Tra theo mã vạch trong bộ nhớ đệm (nhanh, dùng khi quét). */
    lookup(storeId, variants) {
      const q = db.prepare('SELECT * FROM product_cache WHERE store_id = ? AND barcode = ?');
      for (const v of variants) {
        const row = q.get(storeId, v);
        if (row) return row;
      }
      return null;
    },
    /** Giá/tồn kho hiện tại từ nguồn Dsmart POS (dùng khi khoá giỏ để kiểm tra lại). */
    current(storeId, skus) {
      const q = db.prepare('SELECT * FROM pos_products WHERE store_id = ? AND sku = ?');
      const map = new Map();
      for (const sku of skus) { const r = q.get(storeId, sku); if (r) map.set(sku, r); }
      return map;
    },
    lastSync(storeId) {
      return db.prepare('SELECT MAX(synced_at) t FROM product_cache WHERE store_id = ?').get(storeId).t;
    }
  };
}
