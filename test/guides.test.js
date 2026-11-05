import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApp, call, adminLogin, staffLogin } from './helpers.js';
import { parseGuide } from '../server/routes/guides.js';
import { parseSeq, layoutSeq, parseFlow, layoutFlow, DiagramError } from '../public/a/guide-diagram.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'guides');
let prev;
before(() => { prev = process.env.GUIDES_DIR; process.env.GUIDES_DIR = FIX; });
after(() => { if (prev === undefined) delete process.env.GUIDES_DIR; else process.env.GUIDES_DIR = prev; });

test('tài liệu hướng dẫn: cần đăng nhập quản trị, token nhân viên bị từ chối', async () => {
  const app = await makeApp();
  assert.equal((await call(app, 'GET', '/api/a/guides')).status, 401);
  assert.equal((await call(app, 'GET', '/api/a/guides/tong-quan')).status, 401);
  const staff = await staffLogin(app);
  assert.equal((await call(app, 'GET', '/api/a/guides', { token: staff })).status, 401);
  assert.equal((await call(app, 'GET', '/api/a/guides/tong-quan', { token: staff })).status, 401);
  await app.close();
});

test('quản trị chuỗi thấy hết, quản trị chi nhánh không thấy tài liệu chỉ dành cho chuỗi', async () => {
  const app = await makeApp();
  const chain = (await adminLogin(app, 'QT0001')).body.token;
  const branch = (await adminLogin(app, 'QT0007')).body.token;
  const c = await call(app, 'GET', '/api/a/guides', { token: chain });
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.guides.map((g) => g.id), ['chi-chuoi', 'tong-quan', 'he-thong', 'so-do-kho'], 'sắp xếp theo order');
  assert.equal(c.body.guides[1].title, 'Tổng quan nghiệp vụ');
  assert.equal(c.body.guides[1].group, 'nghiep-vu');
  assert.equal(c.body.guides[0].access, 'chain');
  assert.ok(c.body.guides[0].updatedAt);
  const b = await call(app, 'GET', '/api/a/guides', { token: branch });
  assert.deepEqual(b.body.guides.map((g) => g.id), ['tong-quan', 'he-thong', 'so-do-kho']);
  const d = await call(app, 'GET', '/api/a/guides/tong-quan', { token: branch });
  assert.equal(d.status, 200);
  assert.ok(d.body.body.startsWith('# Tổng quan nghiệp vụ'), 'đã bỏ front matter');
  assert.ok(!d.body.body.includes('access: all'));
  const hidden = await call(app, 'GET', '/api/a/guides/chi-chuoi', { token: branch });
  assert.equal(hidden.status, 404);
  assert.equal(hidden.body.error, 'GUIDE_NOT_FOUND');
  assert.equal((await call(app, 'GET', '/api/a/guides/chi-chuoi', { token: chain })).status, 200);
  assert.equal((await call(app, 'GET', '/api/a/guides/khong-co', { token: chain })).body.error, 'GUIDE_NOT_FOUND');
  await app.close();
});

test('id chứa ../ hoặc không hợp lệ bị từ chối; file sai định dạng bị bỏ qua', async () => {
  const app = await makeApp();
  const t = (await adminLogin(app, 'QT0001')).body.token;
  for (const id of ['..%2Fguides.test', '..%2F..%2Fpackage.json', '%2E%2E%2Fx', 'a%2Fb', 'Tong-Quan', '_nhap', 'khong-fm', 'nhom-sai', 'thieu-tieu-de', 'khong-dong', 'Viet-Hoa', 'a.b']) {
    const r = await call(app, 'GET', `/api/a/guides/${id}`, { token: t });
    assert.equal(r.status, 404, id);
  }
  const ids = (await call(app, 'GET', '/api/a/guides', { token: t })).body.guides.map((g) => g.id);
  for (const bad of ['_nhap', 'khong-fm', 'nhom-sai', 'thieu-tieu-de', 'khong-dong']) assert.ok(!ids.includes(bad), bad);
  await app.close();
});

test('bộ phân tích front matter', () => {
  const g = parseGuide('---\r\ntitle: "A: b"\r\norder: 3   # ghi chú\r\naccess: chain\r\n---\r\n\r\nNội dung\r\n');
  assert.equal(g.title, 'A: b'); assert.equal(g.order, 3); assert.equal(g.access, 'chain'); assert.equal(g.group, 'nghiep-vu');
  assert.equal(g.body, 'Nội dung\n');
  assert.equal(parseGuide('title: x'), null);
  assert.equal(parseGuide('---\ntitle: x\norder: abc\n---\n'), null);
  assert.equal(parseGuide('---\ntitle: x\naccess: nobody\n---\n'), null);
});

test('sơ đồ seq: phân tích và bố trí; lỗi có số dòng', () => {
  const m = parseSeq('title: T\nactors: A | B | C\n# bỏ qua\nA -> B: một\nB --> A: hai\nC -> C: tự\nnote over A, C: ghi chú\n== Giai đoạn ==\nA -> C');
  assert.equal(m.title, 'T'); assert.deepEqual(m.actors, ['A', 'B', 'C']);
  assert.deepEqual(m.items.map((i) => i.type), ['msg', 'msg', 'msg', 'note', 'divider', 'msg']);
  assert.equal(m.items[1].dashed, true);
  const lay = layoutSeq(m);
  assert.ok(lay.width > 200 && lay.height > 150);
  assert.equal(lay.arrows.map((a) => a.num).join(), '1,2,3,4');
  assert.equal(layoutSeq(parseSeq('numbered: false\nA -> B: x')).arrows[0].num, null);
  assert.throws(() => parseSeq('actors: A | B\nA -> B: ok\nA ~~ B'), (e) => e instanceof DiagramError && e.line === 3);
  assert.throws(() => parseSeq('actors: A | B\nA -> Z: x'), (e) => e.line === 2);
});

test('lưu đồ flow: hình, mũi tên có nhãn, chu trình, nhóm, lỗi', () => {
  const m = parseFlow('direction: right\na[A]\nb{B}\nc([C])\nd((D))\na --> b\nb -- Có --> c\nb -.-> d\nd --> a\nsubgraph Nhóm\n  e[E]\nend\nc --> e --> a');
  assert.equal(m.direction, 'right');
  assert.deepEqual(m.nodes.map((n) => n.shape), ['rect', 'diamond', 'pill', 'circle', 'rect']);
  assert.equal(m.edges.find((e) => e.label === 'Có').to, 'c');
  assert.equal(m.edges.filter((e) => e.dashed).length, 1);
  assert.equal(m.nodes[4].group, 0);
  const lay = layoutFlow(m);
  assert.equal(lay.nodes.length, 5); assert.equal(lay.edges.length, 6); assert.equal(lay.groups.length, 1);
  assert.ok(lay.edges.every((e) => e.d.startsWith('M')));
  const inline = parseFlow('a[Một] --> b[Hai]');
  assert.equal(inline.nodes.length, 2);
  assert.throws(() => parseFlow('a[Một]\na --> zzz'), (e) => e instanceof DiagramError && e.line === 2);
  assert.throws(() => parseFlow('a[Một]\nsubgraph X\nb[B]'), (e) => e.line === 2);
  assert.throws(() => parseFlow('direction: up\na[A]'), (e) => e.line === 1);
});
