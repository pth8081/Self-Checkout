// Chép thư viện giao diện từ node_modules vào public/shared/vendor (không cần bước build).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'shared', 'vendor');
fs.mkdirSync(out, { recursive: true });
const nm = (p) => path.join(root, 'node_modules', p);
const copy = (from, to) => fs.copyFileSync(nm(from), path.join(out, to));

copy('preact/dist/preact.module.js', 'preact.js');
copy('preact/hooks/dist/hooks.module.js', 'preact-hooks.js');
copy('htm/dist/htm.module.js', 'htm.js');
copy('@zxing/library/umd/index.min.js', 'zxing.min.js');

// qrcode-generator là UMD/CJS: bọc thành ES module.
const qr = fs.readFileSync(nm('qrcode-generator/qrcode.js'), 'utf8');
fs.writeFileSync(path.join(out, 'qrcode.js'), `const module = { exports: {} };\nconst exports = module.exports;\n${qr}\nexport default module.exports;\n`);
// Phông Inter (tự lưu để chạy offline): chỉ lấy bộ ký tự Latin, Latin mở rộng và tiếng Việt.
const fonts = path.join(root, 'public', 'shared', 'fonts');
fs.mkdirSync(fonts, { recursive: true });
for (const f of ['latin', 'latin-ext', 'vietnamese']) {
  fs.copyFileSync(nm(`@fontsource-variable/inter/files/inter-${f}-wght-normal.woff2`), path.join(fonts, `inter-${f}.woff2`));
}
console.log('Đã chép thư viện vào', path.relative(root, out));
