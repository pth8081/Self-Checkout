// Phiên bản hệ thống dạng "chính.phụ", ví dụ 1.0, 1.1 ... 1.9, 2.0 ... 2.9, 3.0.
// Quy tắc: số sau chạy từ 0 đến 9; qua 9 thì số trước tăng 1 và số sau về 0.
// package.json giữ dạng chính.phụ.0 (npm yêu cầu 3 số), phần cuối luôn là 0.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** "1.9" -> "2.0", "2.3" -> "2.4". */
export function nextVersion(v) {
  const m = /^(\d+)\.(\d)(?:\.0)?$/.exec(String(v).trim());
  if (!m) throw new Error(`Phiên bản không hợp lệ: ${v}. Dạng đúng: 1.0 đến 1.9, 2.0 ...`);
  const major = Number(m[1]), minor = Number(m[2]);
  return minor >= 9 ? `${major + 1}.0` : `${major}.${minor + 1}`;
}

export function appVersion() {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  return String(pkg.version).replace(/\.0$/, '');
}
