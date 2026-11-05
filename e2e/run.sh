#!/bin/bash
# Chạy toàn bộ kiểm thử đầu cuối: dựng CSDL mẫu tạm, bật máy chủ cổng 3400, chạy từng kịch bản.
# Yêu cầu: Playwright cài sẵn (require('playwright') chạy được) và Chromium.
set -u
cd "$(dirname "$0")/.."
export PORT=3400 DB_FILE=/tmp/brg-e2e.db BASE=http://localhost:3400
rm -f "$DB_FILE"*
node scripts/build-sw.js >/dev/null
fresh() { rm -f "$DB_FILE"*; node server/seed.js --reset --demo ${SEEDARG:-} >/dev/null 2>&1; node server/index.js >/tmp/brg-e2e-server.log 2>&1 & SRV=$!; sleep 2.5; }
fail=0
for t in customer customer-camera staff admin resilience basket; do
  SEEDARG=--classic; [ "$t" = basket ] && SEEDARG=
  fresh
  echo "=== $t ==="
  if ! node e2e/$t.e2e.cjs; then fail=1; fi
  kill $SRV 2>/dev/null; wait $SRV 2>/dev/null
done
rm -f "$DB_FILE"*
[ $fail -eq 0 ] && echo "TẤT CẢ ĐẠT" || { echo "CÓ KỊCH BẢN LỖI"; exit 1; }
