#!/bin/bash
# Cập nhật phiên bản trên máy chủ chạy PM2. Chạy từ thư mục ứng dụng: bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
echo "1/5 Sao lưu CSDL trước khi cập nhật"; npm run backup
echo "2/5 Lấy mã mới"; git pull --ff-only
echo "3/5 Cài thư viện"; npm ci --omit=dev
echo "4/5 Tạo lại service worker"; npm run build:sw
echo "5/5 Khởi động lại (tắt gọn rồi chạy lại, mất khoảng 1 đến 2 giây)"
pm2 restart brg-self-checkout --update-env
sleep 3
PORT_=$(grep -E '^PORT=' .env | cut -d= -f2); PORT_=${PORT_:-3000}
curl -fsS "http://127.0.0.1:${PORT_}/api/health" && echo && echo "Xong."
