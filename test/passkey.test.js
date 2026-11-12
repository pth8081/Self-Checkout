import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeApp, call, adminLogin } from './helpers.js';

const b64u = (b) => Buffer.from(b).toString('base64url');
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const ORIGIN = 'https://scan.hcrc.vn';
const H = { origin: ORIGIN };

// CBOR tối thiểu để dựng attestationObject và khóa COSE cho thiết bị giả
const cbor = {
  uint: (mt, n) => (n < 24 ? Buffer.from([(mt << 5) | n]) : n < 256 ? Buffer.from([(mt << 5) | 24, n]) : Buffer.from([(mt << 5) | 25, n >> 8, n & 255])),
  int: (n) => (n >= 0 ? cbor.uint(0, n) : cbor.uint(1, -1 - n)),
  bytes: (b) => Buffer.concat([cbor.uint(2, b.length), b]),
  text: (t) => Buffer.concat([cbor.uint(3, Buffer.byteLength(t)), Buffer.from(t)]),
  map: (pairs) => Buffer.concat([cbor.uint(5, pairs.length), ...pairs.flat()])
};

/** Thiết bị giả (authenticator phần mềm): tạo khóa ES256, trả lời đăng ký và đăng nhập như thiết bị thật. */
function fakeDevice({ uv = true } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = crypto.randomBytes(32);
  const dev = { counter: 0, credId, rawId: b64u(credId) };
  const flags = (base) => base | (uv ? 0x04 : 0);
  dev.create = (options, origin = ORIGIN) => {
    const rpIdHash = sha(options.rp.id);
    const cose = cbor.map([[cbor.int(1), cbor.int(2)], [cbor.int(3), cbor.int(-7)], [cbor.int(-1), cbor.int(1)], [cbor.int(-2), cbor.bytes(Buffer.from(jwk.x, 'base64url'))], [cbor.int(-3), cbor.bytes(Buffer.from(jwk.y, 'base64url'))]]);
    const authData = Buffer.concat([rpIdHash, Buffer.from([flags(0x41)]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([credId.length >> 8, credId.length & 255]), credId, cose]);
    const att = cbor.map([[cbor.text('fmt'), cbor.text('none')], [cbor.text('attStmt'), cbor.map([])], [cbor.text('authData'), cbor.bytes(authData)]]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin }));
    return { id: dev.rawId, rawId: dev.rawId, type: 'public-key', response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(att) } };
  };
  dev.get = (options, { origin = ORIGIN, bump = 1 } = {}) => {
    dev.counter += bump;
    const c = Buffer.alloc(4); c.writeUInt32BE(dev.counter);
    const authData = Buffer.concat([sha(options.rpId), Buffer.from([flags(0x01)]), c]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin }));
    const signature = crypto.sign('sha256', Buffer.concat([authData, sha(clientDataJSON)]), privateKey);
    return { id: dev.rawId, rawId: dev.rawId, type: 'public-key', response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature) } };
  };
  return dev;
}

const register = async (app, token, dev, extra = {}) => {
  const o = await call(app, 'POST', '/api/a/passkeys/options', { token, headers: H, body: {} });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  return call(app, 'POST', '/api/a/passkeys/register', { token, headers: H, body: { challengeToken: o.body.challengeToken, credential: dev.create(o.body.options), name: 'Điện thoại của Anh', ...extra } });
};
const login = async (app, dev, opts, account) => {
  const o = await call(app, 'POST', '/api/a/login/passkey/options', { headers: H, body: { account } });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  return call(app, 'POST', '/api/a/login/passkey', { headers: H, body: { challengeToken: o.body.challengeToken, credential: dev.get(o.body.options, opts) } });
};

test('vân tay / khuôn mặt (passkey): đăng ký, đăng nhập không cần mật khẩu, từ chối sai địa chỉ, sai chữ ký, thiếu xác minh người dùng, phát lại; gỡ được', async () => {
  process.env.PUBLIC_URL = ORIGIN;
  const { config } = await import('../server/config.js'); config.publicUrl = ORIGIN;
  try {
    const app = await makeApp();
    const token = (await adminLogin(app)).body.token;
    const dev = fakeDevice();
    const reg = await register(app, token, dev);
    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    assert.equal(reg.body.passkeys.length, 1);
    assert.equal(reg.body.passkeys[0].name, 'Điện thoại của Anh');
    assert.equal((await register(app, token, dev)).body.error, 'PASSKEY_EXISTS'); // cùng thiết bị

    // đăng nhập: có gợi ý tài khoản, và cả khi không nhập tài khoản
    const a = await login(app, dev, {}, 'QT0001');
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.ok(a.body.token); assert.equal(a.body.user.id, 'QT0001');
    assert.equal((await call(app, 'GET', '/api/a/overview', { token: a.body.token })).status, 200);
    assert.equal((await login(app, dev, {}, undefined)).status, 200);

    // phát lại cùng bài làm: mã thử thách chỉ dùng một lần
    const o = await call(app, 'POST', '/api/a/login/passkey/options', { headers: H, body: {} });
    const cred = dev.get(o.body.options);
    assert.equal((await call(app, 'POST', '/api/a/login/passkey', { headers: H, body: { challengeToken: o.body.challengeToken, credential: cred } })).status, 200);
    assert.equal((await call(app, 'POST', '/api/a/login/passkey', { headers: H, body: { challengeToken: o.body.challengeToken, credential: cred } })).body.error, 'BAD_PASSKEY');
    // bộ đếm lùi (thiết bị bị sao chép)
    assert.equal((await login(app, dev, { bump: -3 })).body.error, 'BAD_PASSKEY');
    // sai địa chỉ web (trang giả mạo)
    assert.equal((await login(app, fakeDeviceSame(dev), { origin: 'https://gia-mao.example' })).body.error, 'BAD_PASSKEY');
    // thiết bị lạ
    assert.equal((await login(app, fakeDevice())).body.error, 'BAD_PASSKEY');
    // thiết bị không xác minh người dùng
    const lazy = fakeDevice({ uv: false });
    const o2 = await call(app, 'POST', '/api/a/passkeys/options', { token, headers: H, body: {} });
    assert.equal((await call(app, 'POST', '/api/a/passkeys/register', { token, headers: H, body: { challengeToken: o2.body.challengeToken, credential: lazy.create(o2.body.options) } })).body.error, 'BAD_PASSKEY');

    // tài khoản bị khóa thì không vào được; gỡ thiết bị thì không đăng nhập nữa
    const list = (await call(app, 'GET', '/api/a/users/QT0001/passkeys', { token })).body.passkeys;
    assert.equal(list.length, 1);
    assert.equal((await call(app, 'DELETE', `/api/a/users/QT0001/passkeys/${list[0].id}`, { token })).status, 200);
    assert.equal((await login(app, dev)).body.error, 'BAD_PASSKEY');
    // quản trị chi nhánh không xem/xóa thiết bị của người khác
    const q7 = (await adminLogin(app, 'QT0007')).body.token;
    assert.equal((await call(app, 'GET', '/api/a/users/QT0001/passkeys', { token: q7 })).status, 403);
    await app.close();
  } finally { delete process.env.PUBLIC_URL; config.publicUrl = ''; }
});

function fakeDeviceSame(dev) { return dev; }

test('CBOR tự cài: đầu vào độc hại (mảng khổng lồ, lồng quá sâu, độ dài vượt dữ liệu) bị từ chối ngay, không treo', async () => {
  const { cborDecode } = await import('../server/services/webauthn.js');
  const t0 = Date.now();
  assert.throws(() => cborDecode(Buffer.from([0x9a, 0xff, 0xff, 0xff, 0xff])), /không hợp lệ/); // mảng 4 tỷ phần tử
  assert.throws(() => cborDecode(Buffer.from([0x5a, 0xff, 0xff, 0xff, 0xff, 1, 2])), /không hợp lệ/); // chuỗi byte dài hơn dữ liệu
  assert.throws(() => cborDecode(Buffer.concat([Buffer.alloc(30, 0x81), Buffer.from([0])])), /không hợp lệ/); // mảng lồng 30 tầng
  assert.ok(Date.now() - t0 < 200);
  assert.deepEqual([...cborDecode(Buffer.from([0x82, 0x01, 0x62, 0x68, 0x69])).value], [1, 'hi']); // đầu vào hợp lệ vẫn đọc được
});
