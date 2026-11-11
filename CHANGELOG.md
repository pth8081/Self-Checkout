# Lịch sử phiên bản

Quy tắc đánh số: `chính.phụ`. Số sau chạy từ 0 đến 9, qua 9 thì số trước tăng 1 và số sau về 0 (1.0, 1.1 ... 1.9, 2.0 ... 2.9, 3.0 ...). Tăng bằng `npm run version:bump -- "ghi chú"`.

## 2.1 (2026-11-11)

- Đồng bộ tồn kho từ API tồn kho của đối tác: cấu hình, chạy định kỳ, kiểm tra kết nối, kết quả từng lần, bảng theo chi nhánh, đối chiếu mặt hàng

## 2.0 (2026-11-11)

- Quản trị bắt buộc xác thực 2 bước khi đăng nhập (REQUIRE_ADMIN_2FA); chi nhánh: nhập file, xuất file, tải file mẫu CSV; hộp thoại không đóng khi kéo chuột ra ngoài

## 1.9 (2026-11-11)

- Tên đăng nhập kiểu AD (anh.dp) cho tài khoản quản trị: đặt ở trang Tài khoản hoặc npm run set-username; đăng nhập bằng tên, mã tài khoản hoặc email

## 1.8 (2026-11-11)

- Thêm lệnh npm run rename-account để đổi mã tài khoản (tên đăng nhập), cập nhật cả nhật ký và dữ liệu liên quan

## 1.7 (2026-11-11)

- create-admin --reset: đặt lại mật khẩu và mở khóa tài khoản quản trị đã có

## 1.6 (2026-11-11)

- Giao diện: nút tự xuống dòng khi chữ dài (hết tràn trên điện thoại nhỏ), bỏ dòng hướng dẫn thừa ở trang chủ, rút gọn nhãn nút khách

## 1.5 (2026-11-11)

- API Dsmart POS: GET giỏ thêm idx, sku (SKU_ID); update nhận changes (sku, qty, add/remove); paid chỉ cần sku và qty (không cần giá bán); tài liệu API 1.2 mô tả cấu trúc mã giỏ, nội dung giỏ, nội dung bill

## 1.4 (2026-11-11)

- Sửa nạp .env cho các lệnh (create-admin, import...): bỏ ghi chú cuối dòng như MSSQL_TRUST_CERT=1 # ghi chú

## 1.3 (2026-11-11)

- Sửa lỗi Promise.withResolvers is not a function khi dùng SQL Server trên Node 20

## 1.2 (2026-11-11)

- Hỗ trợ cơ sở dữ liệu SQL Server (DB_DRIVER=mssql, npm run mssql:init); /api/health trả thêm loại CSDL; hướng dẫn triển khai theo SQL Server

## 1.1 (2026-11-10)

- Tra giá theo mã vạch bằng API giá của đối tác; nhập file mã điểm ở trang Tích hợp; mặt hàng chưa có giá vẫn vào giỏ

## 1.0 (2026-11-09)

- Bản đầu tiên đưa đi thử với Dsmart POS: khách quét hàng bằng điện thoại, mã QR ngắn (mã điểm và mã giỏ), Dsmart POS lấy danh sách mặt hàng qua API rồi tính tiền và báo thanh toán về.
- Bill, email, PDF, hoàn trả, hủy, hàng lấy thừa, giỏ hết hạn, giữ dữ liệu và xóa dữ liệu theo yêu cầu của khách.
