// Tăng phiên bản theo quy tắc 1.0 ... 1.9, 2.0 ... và ghi một dòng vào CHANGELOG.md.
// Dùng: npm run version:bump -- "Mô tả ngắn thay đổi"
import { readFileSync, writeFileSync } from 'node:fs';
import { nextVersion } from '../server/version.js';

const pkgPath = new URL('../package.json', import.meta.url);
const logPath = new URL('../CHANGELOG.md', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const cur = String(pkg.version).replace(/\.0$/, '');
const next = nextVersion(cur);
const note = process.argv.slice(2).join(' ').trim() || '(chưa ghi chú)';
pkg.version = `${next}.0`;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
const date = new Date().toISOString().slice(0, 10);
const log = readFileSync(logPath, 'utf8');
const i = log.indexOf('\n## ');
writeFileSync(logPath, i < 0 ? `${log.trimEnd()}\n\n## ${next} (${date})\n\n- ${note}\n` : `${log.slice(0, i)}\n## ${next} (${date})\n\n- ${note}\n${log.slice(i)}`);
console.log(`Phiên bản ${cur} -> ${next}`);
