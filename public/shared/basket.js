// Định dạng mã QR "giỏ hàng" đưa cho phần mềm DS Smart POS quét. Dùng chung cho điện thoại khách và máy chủ.
//   BRG1|<mã điểm>|<mã giỏ>|<giờ unix giây>|<mã vạch>*<số lượng>,<mã vạch>*<số lượng>...|T<tạm tính>|<CRC16>
// CRC16 (CCITT-FALSE, hex hoa 4 ký tự) tính trên toàn bộ chuỗi đứng trước dấu | cuối cùng.
// DS Smart POS chỉ cần mã vạch và số lượng để dựng đơn rồi tính giá theo hệ thống của DS Smart POS. Phần T chỉ để đối chiếu.

export function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export const BASKET_PREFIX = 'BRG1';

/** Mã giỏ do điện thoại tự sinh nên tạo được cả khi mất mạng. Ví dụ Q7-LM3K2AB. */
export function makeBasketRef(storeId, now = Date.now(), rnd = Math.random) {
  const t = Math.floor(now / 1000).toString(36).toUpperCase().slice(-5);
  const r = Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rnd() * 32)]).join('');
  return `${String(storeId).toUpperCase()}-${t}${r}`;
}

/** items: [{ barcode, qty }]. Gộp dòng trùng mã vạch. */
export function encodeBasket({ point, ref, at = Date.now(), items, total = 0 }) {
  const merged = new Map();
  for (const it of items) {
    const q = Math.floor(Number(it.qty));
    if (!it.barcode || !(q > 0)) continue;
    merged.set(String(it.barcode), (merged.get(String(it.barcode)) || 0) + q);
  }
  const lines = [...merged].map(([b, q]) => `${b}*${q}`).join(',');
  const body = `${BASKET_PREFIX}|${point}|${ref}|${Math.floor(at / 1000)}|${lines}|T${Math.max(0, Math.round(total))}`;
  return `${body}|${crc16(body)}`;
}

/** Trả { ok, point, ref, at, items, total } hoặc { ok:false, error }. DS Smart POS dùng cùng quy tắc này. */
export function decodeBasket(text) {
  const s = String(text || '').trim();
  const cut = s.lastIndexOf('|');
  if (cut < 0) return { ok: false, error: 'FORMAT' };
  const body = s.slice(0, cut);
  if (crc16(body) !== s.slice(cut + 1).toUpperCase()) return { ok: false, error: 'CRC' };
  const [prefix, point, ref, at, lines, t] = body.split('|');
  if (prefix !== BASKET_PREFIX || !point || !ref || !/^T\d+$/.test(t || '')) return { ok: false, error: 'FORMAT' };
  const items = [];
  for (const part of (lines || '').split(',')) {
    const m = /^(\d{6,14})\*(\d{1,3})$/.exec(part);
    if (!m) return { ok: false, error: 'ITEM' };
    items.push({ barcode: m[1], qty: Number(m[2]) });
  }
  if (!items.length) return { ok: false, error: 'EMPTY' };
  return { ok: true, point, ref, at: Number(at) * 1000, items, total: Number(t.slice(1)) };
}
