import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ean13 } from '../server/services/barcode.js';
const SUA = ean13('893603612345'), MI = ean13('012345678901'); // EAN-13 hợp lệ
const BAD = SUA.slice(0, 12) + ((Number(SUA[12]) + 1) % 10);

test('bảng giá trên điện thoại: chuẩn hóa mã, tra biến thể, 304 giữ nguyên, bản mới thay bảng cũ', async () => {
  const calls = [];
  let etag = '"v1"'; let items = [[SUA, 'SUA01', 'Sữa tươi 1L', 29000, 31000, 0, 0, 0], [MI, 'MI01', 'Mì ly', 12500, 0, 0, 3, 1000]];
  globalThis.fetch = async (url, init) => {
    calls.push(init.headers['If-None-Match'] || '');
    if (init.headers['If-None-Match'] === etag) return { status: 304, ok: false, headers: { get: () => etag } };
    return { status: 200, ok: true, headers: { get: () => etag }, json: async () => ({ items }) };
  };
  const { normalizeLocal, catalogLookup, syncCatalog, catalogInfo } = await import('../public/c/catalog.js');
  // mã sai chữ số kiểm tra bị chặn ngay trên máy
  assert.equal(normalizeLocal(BAD).ok, false);
  assert.equal(normalizeLocal(SUA).ok, true);
  assert.equal(catalogLookup(SUA), null, 'chưa có bảng');
  assert.equal(await syncCatalog('Q7', { force: true }), true);
  assert.equal(catalogInfo().count, 2);
  const it = catalogLookup(SUA);
  assert.equal(it.name, 'Sữa tươi 1L'); assert.equal(it.price, 29000); assert.equal(it.listPrice, 31000);
  assert.equal(catalogLookup(MI.slice(1))?.sku, 'MI01', 'mã 12 số khớp biến thể thêm số 0 ở đầu'); // 0123456789012 <-> 123456789012
  assert.equal(await syncCatalog('Q7', { force: true }), false); // 304: giữ nguyên
  assert.equal(calls.at(-1), '"v1"');
  etag = '"v2"'; items = [[SUA, 'SUA01', 'Sữa tươi 1L', 30000, 0, 0, 0, 0]];
  assert.equal(await syncCatalog('Q7', { force: true }), true);
  assert.equal(catalogInfo().count, 1);
  assert.equal(catalogLookup(SUA).price, 30000);
  assert.equal(catalogLookup(MI), null, 'mặt hàng đã bị gỡ khỏi bảng');
});
