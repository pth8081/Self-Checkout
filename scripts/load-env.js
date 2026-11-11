// Nạp file .env (nếu có) vào process.env cho các script, không ghi đè biến đã đặt sẵn.
// Nhập module này TRƯỚC khi nhập server/config.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    const q = /^(['"])(.*?)\1(\s+#.*)?$/.exec(v);
    v = q ? q[2] : v.replace(/\s+#.*$/, ''); // giống --env-file: bỏ ghi chú sau dấu # (VD: MSSQL_TRUST_CERT=1   # ghi chú)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
