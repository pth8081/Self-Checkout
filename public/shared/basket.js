// Định dạng mã QR "giỏ hàng" đưa cho phần mềm Dsmart POS quét. Dùng chung cho điện thoại khách và máy chủ.
//
// Mã QR rất ngắn, chỉ có mã điểm và mã giỏ. Danh sách mặt hàng (mã vạch, số lượng) KHÔNG nằm trong mã QR:
// Dsmart POS lấy bằng API GET /api/pos/v1/baskets/<mã giỏ>?pointCode=<mã điểm>.
//   BRG2|<mã điểm>|<mã giỏ>|<giờ unix giây>|<CRC16>
//
// CRC16 (CCITT-FALSE, hex hoa 4 ký tự) tính trên toàn bộ chuỗi đứng trước dấu | cuối cùng.

export function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export const BASKET_PREFIX_SHORT = 'BRG2';

/** Mã giỏ do điện thoại tự sinh nên tạo được cả khi mất mạng. Ví dụ Q7-LM3K2AB. */
export function makeBasketRef(storeId, now = Date.now(), rnd = Math.random) {
  const t = Math.floor(now / 1000).toString(36).toUpperCase().slice(-5);
  const r = Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rnd() * 32)]).join('');
  return `${String(storeId).toUpperCase()}-${t}${r}`;
}

/** Mã QR: chỉ mã điểm, mã giỏ và giờ tạo. */
export function encodeBasketShort({ point, ref, at = Date.now() }) {
  const body = `${BASKET_PREFIX_SHORT}|${point}|${ref}|${Math.floor(at / 1000)}`;
  return `${body}|${crc16(body)}`;
}

/** Trả { ok, point, ref, at } hoặc { ok:false, error }. Dsmart POS dùng cùng quy tắc này. */
export function decodeBasket(text) {
  const s = String(text || '').trim();
  const cut = s.lastIndexOf('|');
  if (cut < 0) return { ok: false, error: 'FORMAT' };
  const body = s.slice(0, cut);
  if (crc16(body) !== s.slice(cut + 1).toUpperCase()) return { ok: false, error: 'CRC' };
  const parts = body.split('|');
  const [prefix, point, ref, at] = parts;
  if (prefix !== BASKET_PREFIX_SHORT || parts.length !== 4 || !point || !ref || !/^\d+$/.test(at || '')) return { ok: false, error: 'FORMAT' };
  return { ok: true, point, ref, at: Number(at) * 1000 };
}
