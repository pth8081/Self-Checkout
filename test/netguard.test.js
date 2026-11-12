import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeApp, call, adminLogin } from './helpers.js';
import { ipKind, assertIpAllowed, assertHostAllowed, safeFetch, resolveAllowed, NetBlocked } from '../server/services/net-guard.js';
import { createMailer, explainMailError } from '../server/services/mailer.js';
import { callPriceApi } from '../server/services/price-api.js';

test('phân loại địa chỉ IP: loopback, metadata, riêng, công khai, IPv6 nhúng IPv4', () => {
  const k = (x) => ipKind(x);
  assert.equal(k('127.0.0.1'), 'loopback'); assert.equal(k('::1'), 'loopback'); assert.equal(k('::ffff:127.0.0.1'), 'loopback');
  assert.equal(k('169.254.169.254'), 'linklocal'); assert.equal(k('fe80::1'), 'linklocal'); assert.equal(k('::ffff:169.254.169.254'), 'linklocal');
  assert.equal(k('10.1.2.3'), 'private'); assert.equal(k('172.20.0.1'), 'private'); assert.equal(k('192.168.1.5'), 'private'); assert.equal(k('fd00::1'), 'private');
  assert.equal(k('100.64.0.1'), 'cgnat'); assert.equal(k('0.0.0.0'), 'unspecified'); assert.equal(k('224.0.0.1'), 'multicast');
  assert.equal(k('8.8.8.8'), 'public'); assert.equal(k('172.32.0.1'), 'public');
});

test('chặn địa chỉ nguy hiểm khi KHÔNG ở chế độ phát triển (metadata luôn bị chặn, nội bộ chặn được bằng OUTBOUND_BLOCK_PRIVATE)', async () => {
  const { config } = await import('../server/config.js');
  const was = config.devMode;
  try {
    config.devMode = false;
    for (const ip of ['127.0.0.1', '::1', '169.254.169.254', '0.0.0.0', 'fe80::1']) assert.throws(() => assertIpAllowed(ip), NetBlocked, ip);
    assert.doesNotThrow(() => assertIpAllowed('10.0.0.5')); // máy chủ SMTP/API nội bộ là dùng hợp lệ
    process.env.OUTBOUND_BLOCK_PRIVATE = '1';
    assert.throws(() => assertIpAllowed('10.0.0.5'), NetBlocked);
    delete process.env.OUTBOUND_BLOCK_PRIVATE;
    assert.throws(() => assertHostAllowed('localhost'), NetBlocked);
    assert.throws(() => assertHostAllowed('2130706433'), NetBlocked); // 127.0.0.1 viết dạng số
    assert.throws(() => assertHostAllowed('0x7f000001'), NetBlocked);
    process.env.OUTBOUND_ALLOWED_HOSTS = 'api.hcrc.vn';
    assert.doesNotThrow(() => assertHostAllowed('api.hcrc.vn'));
    assert.throws(() => assertHostAllowed('evil.example'), NetBlocked);
    delete process.env.OUTBOUND_ALLOWED_HOSTS;
    await assert.rejects(() => safeFetch('http://127.0.0.1:1/x'), NetBlocked);
    await assert.rejects(() => safeFetch('https://169.254.169.254/latest/meta-data'), NetBlocked);
    await assert.rejects(() => resolveAllowed('127.0.0.1'), NetBlocked);
  } finally { config.devMode = was; delete process.env.OUTBOUND_BLOCK_PRIVATE; delete process.env.OUTBOUND_ALLOWED_HOSTS; }
});

test('safeFetch: không theo chuyển hướng, giới hạn kích thước, trả đúng nội dung khi bình thường', async () => {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/redir') { res.writeHead(302, { location: '/secret' }); return res.end(); }
    if (req.url === '/big') { res.writeHead(200); return res.end('x'.repeat(2_000_000)); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":1}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const ok = await safeFetch(base + '/ok'); assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { ok: 1 });
    const rd = await safeFetch(base + '/redir'); assert.equal(rd.status, 302); assert.equal(hits.includes('/secret'), false); // không đi theo
    await assert.rejects(() => safeFetch(base + '/big', { maxBytes: 100_000 }), /quá lớn/);
  } finally { srv.closeAllConnections?.(); srv.close(); }
});

test('API giá: chuyển hướng bị từ chối, địa chỉ nội bộ bị chặn khi lưu cấu hình ngoài chế độ phát triển; SMTP không lộ nội dung phản hồi', async () => {
  const { config } = await import('../server/config.js');
  const app = await makeApp({ basket: true });
  const admin = (await adminLogin(app)).body.token;
  const was = config.devMode;
  try {
    config.devMode = false; // giả lập production cho kiểm tra cấu hình
    const put = (url) => call(app, 'PUT', '/api/a/integrations/price-api', { token: admin, body: { url, key: 'k' } });
    assert.equal((await put('https://169.254.169.254/latest/meta-data')).body.error, 'BAD_PRICE_API');
    assert.equal((await put('https://127.0.0.1/x')).body.error, 'BAD_PRICE_API');
    assert.equal((await put('https://localhost/x')).body.error, 'BAD_PRICE_API');
    assert.equal((await put('https://user:pass@api.hcrc.vn/x')).body.error, 'BAD_PRICE_API');
    assert.equal((await put('https://api.hcrc.vn/api/v1/reports/gia-ban/run')).status, 200);
    const email = (body) => call(app, 'PUT', '/api/a/integrations/email', { token: admin, body: { host: 'smtp.congty.vn', port: 587, secure: 'starttls', from: 'a@b.vn', ...body } });
    assert.equal((await email({ host: '169.254.169.254' })).status, 400);
    assert.equal((await email({ host: '2130706433' })).status, 400);
    assert.equal((await email({ port: 6379 })).status, 400); // cổng không phải SMTP
    assert.equal((await email({})).status, 200);
  } finally { config.devMode = was; }
  // lỗi gửi thư không trả nguyên nội dung máy chủ
  const leak = explainMailError(Object.assign(new Error('Invalid greeting. response=554 INTERNAL secret=abc123 hostname=db-prod-01'), { code: 'EPROTOCOL' }));
  assert.equal(/abc123|db-prod-01/.test(leak), false);
  // chuyển hướng của API giá không được theo
  const srv = http.createServer((req, res) => { if (req.url.startsWith('/secret')) { res.writeHead(200); return res.end('{"maHang":"X"}'); } res.writeHead(302, { location: '/secret' }); res.end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await call(app, 'PUT', '/api/a/integrations/price-api', { token: admin, body: { url: `http://127.0.0.1:${srv.address().port}/gia`, key: 'k', enabled: true } });
    await call(app, 'PUT', '/api/a/stores/Q7', { token: admin, body: { posCode: 'SP-0107' } });
    const r = await callPriceApi(app.ctx.db, 'SP-0107', '8934696001589');
    assert.equal(r.status, 'error'); assert.equal(r.code, 'REDIRECT');
  } finally { srv.closeAllConnections?.(); srv.close(); await app.close(); }
});
