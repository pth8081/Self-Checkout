// Kiểm tra mã vạch (EAN-13, EAN-8, UPC-A) và tạo các biến thể để tra cứu.
function checkDigitOk(digits) {
  const nums = digits.split('').map(Number);
  const check = nums.pop();
  let sum = 0;
  nums.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

/** Trả về { ok, code, variants } hoặc { ok:false } khi chắc chắn là mã đọc sai. */
export function normalizeBarcode(raw) {
  const code = String(raw ?? '').trim().replace(/\s+/g, '');
  if (!code || code.length > 32 || !/^[0-9A-Za-z-]+$/.test(code)) return { ok: false, code };
  if (/^\d+$/.test(code) && [8, 12, 13].includes(code.length) && !checkDigitOk(code)) return { ok: false, code };
  const variants = [code];
  if (code.length === 12) variants.push('0' + code);
  if (code.length === 13 && code.startsWith('0')) variants.push(code.slice(1));
  if (code.length === 14 && code.startsWith('0')) variants.push(code.slice(1));
  return { ok: true, code, variants };
}

/** Dùng cho dữ liệu mẫu: tạo EAN-13 hợp lệ từ 12 số đầu. */
export function ean13(first12) {
  const nums = first12.split('').map(Number);
  let sum = 0;
  nums.slice().reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return first12 + ((10 - (sum % 10)) % 10);
}
