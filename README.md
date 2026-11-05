# BRG Self Checkout (PWA)

Khách tự quét mã vạch bằng điện thoại (PWA, không cần cài app), chọn cách thanh toán rồi ra cổng bằng mã QR biên nhận.
Ứng dụng gồm ba giao diện dùng chung một máy chủ:

| Giao diện | Đường dẫn | Dành cho |
|-----------|-----------|----------|
| PWA khách | `/c/?s=MÃ_CHI_NHÁNH` (mã QR dán ở cổng vào) | Khách: quét, giỏ hàng, thanh toán, QR ra cổng, hoá đơn, lịch sử |
| PWA nhân viên | `/s/` | Thu ngân (thu tiền mặt, xác nhận chuyển khoản) và nhân viên cổng ra (quét QR, kiểm tra ngẫu nhiên, chênh lệch), quản lý (xử lý ca chờ) |
| Web quản trị | `/a/` | Quản trị chuỗi và chi nhánh: báo cáo, cờ tính năng, tích hợp, tài khoản, ca, đối soát, truy vết, và **Hướng dẫn nghiệp vụ** (quy trình có sơ đồ, chỉ quản trị viên xem; nguồn ở `server/guides/`, xem [docs/12](docs/12-huong-dan-nghiep-vu.md)) |

**Giai đoạn 1:** thanh toán tiền mặt hoặc chuyển khoản QR tại quầy, nhân viên xác nhận. Thanh toán online (ví, VNPay, thẻ) giữ chỗ trong giao diện (hiện mờ "Sắp có"), bật bằng cấu hình khi đã tích hợp.
POS/ERP và hoá đơn điện tử hiện chạy **bản giả lập**; cách gắn hệ thống thật xem [docs/11-ung-dung.md](docs/11-ung-dung.md).

Tài liệu yêu cầu, kiến trúc, quyết định: [docs/](docs/README.md). Bản vẽ giao diện: [docs/thiet-ke/man-hinh.html](docs/thiet-ke/man-hinh.html).

## Chạy thử

Cần Node.js 20 trở lên (đã thử trên 22).

```bash
npm install
npm run seed:demo        # dữ liệu mẫu: 5 chi nhánh, 35 sản phẩm, 6 ngày lịch sử
npm start                # http://localhost:3000  (đổi cổng: PORT=8080 npm start)
```

Mở `http://localhost:3000/` để chọn giao diện. Camera trình duyệt chỉ chạy trên **HTTPS** hoặc `localhost`; khi thử trên điện thoại thật hãy dùng một đường hầm HTTPS hoặc triển khai sau reverse proxy có chứng chỉ.

Tài khoản **chỉ dùng thử** (tạo bởi dữ liệu mẫu, đừng dùng ở môi trường thật):

| Vai trò | Mã | PIN (app nhân viên) | Mật khẩu (web quản trị) |
|---------|----|---------------------|-------------------------|
| Quản trị chuỗi | `QT0001` | 1234 | `Admin@123` |
| Quản trị Quận 7 | `QT0007` | 2345 | `Admin@123` |
| Thu ngân + cổng ra Q7 | `NV0142` | 1111 | |
| Nhân viên cổng ra Q7 | `NV0157` | 2222 | |
| Thu ngân Q7 | `NV0160` | 3333 | |

Chi nhánh bật sẵn: `Q7`, `TD`, `TB`. Xem mã vạch mẫu: đăng nhập quản trị chuỗi, mục Tích hợp, "Công cụ thử nghiệm" (cũng đổi được giá/tồn kho để thử màn "giá vừa đổi").

## Kiểm thử

```bash
npm test        # 36 kiểm thử API (máy chủ, nghiệp vụ, phân quyền)
npm run e2e     # kiểm thử đầu cuối bằng Playwright: khách, camera, nhân viên, quản trị
```

`npm run e2e` cần Playwright và Chromium cài sẵn trong môi trường.

## Cấu trúc

```
server/            Fastify + SQLite (better-sqlite3)
  routes/          customer.js, staff.js, admin.js
  services/        core.js (nghiệp vụ), pos.js, invoice.js, qr.js (VietQR, token QR), totp.js ...
public/
  shared/          thư viện giao diện dùng chung (Preact + htm, không build), ui.css, phông, biểu tượng
  c/  s/  a/       ba ứng dụng; sw.js sinh tự động bởi scripts/build-sw.js
test/  e2e/        kiểm thử API và đầu cuối
scripts/           vendor.js (chép thư viện), build-sw.js
```

Giao diện không cần bước build: các module ES được phục vụ trực tiếp. Sau khi sửa file trong `public/`, chạy `npm run build:sw` (hoặc `npm start`, đã gọi sẵn) để service worker lấy bản mới.

## Triển khai thật

1. `APP_SECRET` (chuỗi ngẫu nhiên dài) là **bắt buộc** khi `NODE_ENV=production`; dùng để ký token đăng nhập và QR biên nhận. Đổi khoá sẽ vô hiệu mọi QR chưa dùng.
2. Không chạy `seed` ở production. Tạo quản trị đầu tiên: `npm run create-admin -- --id QT0001 --name "Quản trị chuỗi" --password "…"`, đăng nhập `/a/`, bật xác thực 2 bước, rồi thêm chi nhánh, tài khoản ngân hàng nhận tiền và nhân viên.
3. Đặt sau reverse proxy HTTPS. CSDL là một file SQLite (`DB_FILE`, mặc định `data/brg.db`); cần sao lưu định kỳ.
4. Biến môi trường khác: `PORT`, `HOST`, `DB_FILE`, `RECEIPT_TTL_MIN` (hạn QR biên nhận, mặc định 180 phút), `POS_SYNC_SECONDS`.
5. Việc còn lại trước khi mở cho khách: gắn POS thật, gắn nhà cung cấp hoá đơn điện tử, kiểm chứng QR chuyển khoản với ngân hàng, thử quét mã trên các điện thoại thật. Danh sách đầy đủ ở [docs/09](docs/09-phan-tich-khoang-trong.md) và [docs/11](docs/11-ung-dung.md).

Nguồn gốc: *Tài liệu Yêu cầu & Kiến trúc Hệ thống* (bản .docx, 04/11/2026).
