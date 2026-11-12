// Đăng nhập bằng vân tay / khuôn mặt (Passkey, WebAuthn) tự cài, không cần thư viện ngoài.
// Hỗ trợ khóa ES256 (P-256) và RS256. Bắt buộc người dùng xác minh sinh trắc học hoặc mã PIN thiết bị (cờ UV). Không kiểm chứng chứng thực
// phần cứng (attestation): chỉ cần khóa công khai do thiết bị tạo ra.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { sign, verify } from '../auth.js';

const b64u = (b) => Buffer.from(b).toString('base64url');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
export const credHash = (credIdB64u) => sha256(Buffer.from(String(credIdB64u), 'base64url')).toString('hex');

// ---- CBOR tối thiểu (số nguyên, chuỗi byte, chuỗi, mảng, bản đồ, true/false/null) ----
export function cborDecode(buf, start = 0) {
  let o = start;
  // Giới hạn chống đầu vào độc hại làm treo máy chủ: tối đa 8 tầng lồng nhau, 128 phần tử mỗi mảng/bản đồ, và độ dài khai báo không vượt dữ liệu thật.
  const item = (depth = 0) => {
    if (depth > 8 || o >= buf.length) throw new Error('CBOR không hợp lệ');
    const first = buf[o++]; const mt = first >> 5, ai = first & 31;
    let v;
    if (ai < 24) v = ai;
    else if (ai === 24) v = buf[o++];
    else if (ai === 25) { v = buf.readUInt16BE(o); o += 2; }
    else if (ai === 26) { v = buf.readUInt32BE(o); o += 4; }
    else if (ai === 27) { v = Number(buf.readBigUInt64BE(o)); o += 8; }
    else throw new Error('CBOR không hỗ trợ');
    if ((mt === 2 || mt === 3) && o + v > buf.length) throw new Error('CBOR không hợp lệ');
    if ((mt === 4 || mt === 5) && v > 128) throw new Error('CBOR không hợp lệ');
    switch (mt) {
      case 0: return v;
      case 1: return -1 - v;
      case 2: { const r = buf.subarray(o, o + v); o += v; return r; }
      case 3: { const r = buf.toString('utf8', o, o + v); o += v; return r; }
      case 4: { const a = []; for (let i = 0; i < v; i++) a.push(item(depth + 1)); return a; }
      case 5: { const m = new Map(); for (let i = 0; i < v; i++) { const k = item(depth + 1); m.set(k, item(depth + 1)); } return m; }
      case 7: if (ai === 20) return false; if (ai === 21) return true; if (ai === 22 || ai === 23) return null; throw new Error('CBOR không hỗ trợ');
      default: throw new Error('CBOR không hỗ trợ');
    }
  };
  const value = item();
  return { value, end: o };
}

/** Khóa công khai COSE -> JWK. */
function coseToJwk(m) {
  const kty = m.get(1), alg = m.get(3);
  if (kty === 2 && alg === -7 && m.get(-1) === 1) return { alg, jwk: { kty: 'EC', crv: 'P-256', x: b64u(m.get(-2)), y: b64u(m.get(-3)) } };
  if (kty === 3 && alg === -257) return { alg, jwk: { kty: 'RSA', n: b64u(m.get(-1)), e: b64u(m.get(-2)) } };
  throw new Error('Thiết bị dùng loại khóa chưa hỗ trợ (chỉ ES256, RS256)');
}

/** Địa chỉ web đang dùng: PUBLIC_URL nếu có, không thì lấy từ Origin của trình duyệt. */
export function relyingParty(req) {
  let origin = config.publicUrl;
  if (!origin) origin = String(req.headers.origin || '');
  let u; try { u = new URL(origin); } catch { throw Object.assign(new Error('Không xác định được địa chỉ web (đặt PUBLIC_URL)'), { code: 'NO_ORIGIN' }); }
  return { rpId: u.hostname, origin: u.origin };
}

const challengeToken = (payload) => sign({ kind: 'webauthn', ...payload }, 5 / 60);
const spent = new Map();
function spend(n) { const now = Date.now(); for (const [k, e] of spent) if (e < now) spent.delete(k); if (spent.has(n)) return false; spent.set(n, now + 6 * 60_000); return true; }

export function registrationOptions(req, user, existing) {
  const { rpId } = relyingParty(req);
  const ch = crypto.randomBytes(32).toString('base64url');
  const n = crypto.randomBytes(8).toString('hex');
  return {
    challengeToken: challengeToken({ p: 'reg', uid: user.id, ch, n }),
    options: {
      challenge: ch, rp: { name: 'BRG Scan & Checkout', id: rpId }, timeout: 120000, attestation: 'none',
      user: { id: b64u(Buffer.from(user.id)), name: user.username || user.id, displayName: user.name },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      excludeCredentials: existing.map((id) => ({ type: 'public-key', id }))
    }
  };
}

function checkClient(req, clientDataJSON, type, expectedChallenge) {
  const cd = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
  const { origin } = relyingParty(req);
  if (cd.type !== type) throw new Error('Sai loại yêu cầu');
  if (cd.challenge !== expectedChallenge) throw new Error('Sai mã thử thách');
  if (cd.origin !== origin) throw new Error('Sai địa chỉ web');
  return cd;
}
function parseAuthData(ad, rpId) {
  if (ad.length < 37) throw new Error('Dữ liệu thiết bị không hợp lệ');
  if (!ad.subarray(0, 32).equals(sha256(rpId))) throw new Error('Sai tên miền (rpId)');
  const flags = ad[32];
  if (!(flags & 0x01)) throw new Error('Thiết bị chưa xác nhận có người dùng');
  if (!(flags & 0x04)) throw new Error('Cần xác minh vân tay, khuôn mặt hoặc mã PIN của thiết bị');
  return { flags, counter: ad.readUInt32BE(33) };
}

/** Xác nhận đăng ký thiết bị mới. Trả { credentialId, hash, jwk, alg, counter }. */
export function verifyRegistration(req, body, expectedUid) {
  const t = verify(String(body?.challengeToken || ''));
  if (!t || t.kind !== 'webauthn' || t.p !== 'reg' || t.uid !== expectedUid || !spend(t.n)) throw new Error('Phiên đăng ký đã hết hạn, hãy thử lại');
  const c = body.credential?.response;
  if (!c?.clientDataJSON || !c?.attestationObject) throw new Error('Thiếu dữ liệu từ thiết bị');
  checkClient(req, c.clientDataJSON, 'webauthn.create', t.ch);
  const att = cborDecode(Buffer.from(c.attestationObject, 'base64url')).value;
  const ad = att.get('authData');
  const { rpId } = relyingParty(req);
  const { flags, counter } = parseAuthData(ad, rpId);
  if (!(flags & 0x40)) throw new Error('Thiết bị không gửi khóa');
  let o = 37 + 16;
  const len = ad.readUInt16BE(o); o += 2;
  const credId = ad.subarray(o, o + len); o += len;
  const { value: cose } = cborDecode(ad, o);
  const { alg, jwk } = coseToJwk(cose);
  const credentialId = b64u(credId);
  return { credentialId, hash: credHash(credentialId), jwk, alg, counter };
}

export function authenticationOptions(req, credentialIds) {
  const { rpId } = relyingParty(req);
  const ch = crypto.randomBytes(32).toString('base64url');
  const n = crypto.randomBytes(8).toString('hex');
  return {
    challengeToken: challengeToken({ p: 'auth', ch, n }),
    options: { challenge: ch, rpId, timeout: 120000, userVerification: 'required', ...(credentialIds?.length ? { allowCredentials: credentialIds.map((id) => ({ type: 'public-key', id })) } : {}) }
  };
}

/** Xác nhận đăng nhập. `lookup(hash)` trả bản ghi { public_key, alg, counter, ... } hoặc undefined. Trả { record, counter }. */
export function verifyAuthentication(req, body, lookup) {
  const t = verify(String(body?.challengeToken || ''));
  if (!t || t.kind !== 'webauthn' || t.p !== 'auth' || !spend(t.n)) throw new Error('Phiên đăng nhập đã hết hạn, hãy thử lại');
  const cr = body.credential;
  const r = cr?.response;
  if (!cr?.id || !r?.clientDataJSON || !r?.authenticatorData || !r?.signature) throw new Error('Thiếu dữ liệu từ thiết bị');
  const record = lookup(credHash(cr.id));
  if (!record) throw new Error('Thiết bị này chưa được đăng ký');
  checkClient(req, r.clientDataJSON, 'webauthn.get', t.ch);
  const ad = Buffer.from(r.authenticatorData, 'base64url');
  const { rpId } = relyingParty(req);
  const { counter } = parseAuthData(ad, rpId);
  const signed = Buffer.concat([ad, sha256(Buffer.from(r.clientDataJSON, 'base64url'))]);
  const key = crypto.createPublicKey({ key: JSON.parse(record.public_key), format: 'jwk' });
  const ok = crypto.verify('sha256', signed, key, Buffer.from(r.signature, 'base64url'));
  if (!ok) throw new Error('Chữ ký không đúng');
  if ((counter || record.counter) && counter <= record.counter) throw new Error('Bộ đếm của thiết bị không hợp lệ (có thể bị sao chép)');
  return { record, counter };
}
