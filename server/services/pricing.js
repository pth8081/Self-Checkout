import { money } from '../util.js';

/** Mỗi nhóm đủ `promo_min_qty` mặt hàng thì giảm `promo_off`. */
export function lineDiscount(it) {
  if (!it.promo_min_qty || !it.promo_off) return 0;
  return Math.floor(it.qty / it.promo_min_qty) * it.promo_off;
}

export function totals(items) {
  const subtotal = items.reduce((s, it) => s + it.unit_price * it.qty, 0);
  const discount = items.reduce((s, it) => s + lineDiscount(it), 0);
  return { subtotal: money(subtotal), discount: money(discount), total: money(subtotal - discount) };
}

export const itemCount = (items) => items.reduce((s, it) => s + it.qty, 0);

const nf = new Intl.NumberFormat('vi-VN');
/** Nhãn khuyến mãi dễ đọc, ví dụ "Mua 2 giảm 13.000₫". */
export const promoLabel = (min, off) => (min && off ? `Mua ${min} giảm ${nf.format(off)}₫` : null);
