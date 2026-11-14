# Lịch sử phiên bản

Quy tắc đánh số: `chính.phụ`. Số sau chạy từ 0 đến 9, qua 9 thì số trước tăng 1 và số sau về 0 (1.0, 1.1 ... 1.9, 2.0 ... 2.9, 3.0 ...). Tăng bằng `npm run version:bump -- "ghi chú"`.

## 4.8 (2026-11-14)

- Trang Chi nhánh: lọc theo trạng thái Scan & Checkout và Giỏ QR cho Dsmart POS

## 4.7 (2026-11-14)

- Tra giá theo cả 3 mã đối tác ánh xạ: maHang, maVach, dsMaVach

## 4.6 (2026-11-14)

- Tra giá chỉ theo maVach và maDiem như đối tác xác nhận (bỏ thử maHang)

## 4.5 (2026-11-14)

- Tra giá bằng maHang chỉ là lần thử phụ: lỗi ở lần thử phụ không báo lỗi hệ thống giá

## 4.4 (2026-11-14)

- Tra giá theo cả maVach và maHang (mã nội bộ in trên nhãn hàng)

## 4.3 (2026-11-14)

- Bỏ đồng bộ bảng mã hàng và giá về trình duyệt khách hàng (hoàn lại bản 4.1); giá luôn tra trực tiếp từ máy chủ

## 4.2 (2026-11-14)

- App khách tự cập nhật ngầm (không hỏi) khi giỏ trống

## 4.1 (2026-11-14)

- Bảng mã hàng và giá lưu trên điện thoại khách: tra giá tức thì, giá tạm tính khi mất mạng

## 4.0 (2026-11-13)

- Ràng buộc UNIQUE (cửa hàng, mã đơn Dsmart POS) ở tầng CSDL, kiểm tra dữ liệu trùng khi khởi động

## 3.9 (2026-11-12)

- Rà soát an ninh vòng 2: passkey cần nhập lại mật khẩu, chống ReDoS email, đăng xuất nhân viên thu hồi token, siết hoàn trả/link/mã đơn, cấu hình mặc định an toàn hơn

## 3.8 (2026-11-12)

- Làm rõ API Dsmart POS: thanh toán nhiều hình thức, hoàn theo sku, mẫu link giao dịch

## 3.7 (2026-11-12)

- Xử lý việc bảo mật còn tồn: nhập lại mật khẩu cho thao tác nhạy cảm, link bill có hạn 180 ngày, luôn còn quản trị chuỗi, kiểm tra email nhân viên, quản trị chi nhánh tự quản lý passkey và 2 bước, cảnh báo khóa POS dùng cho mọi chi nhánh; cập nhật tài liệu tích hợp POS

## 3.6 (2026-11-12)

- Bảo mật đợt 3: CSP và header chống nhúng khung, giới hạn CBOR, bỏ thời gian phản hồi trong kiểm tra API giá, dọn mã thừa (21 ảnh PNG, dòng void, currency), 4 thư viện giao diện chuyển sang devDependencies, cập nhật hướng dẫn triển khai và Nginx mẫu

## 3.5 (2026-11-12)

- Bảo mật đợt 2: mã đơn Dsmart theo cửa hàng, mã giỏ có mã chi nhánh và ngẫu nhiên mật mã, trần số tiền, ghi nhận thanh toán đến sau khi nhả giỏ, bốc thăm kiểm tra cố định, mã hóa và chống dùng lại mã 2 bước, thu hồi token khi đổi mật khẩu/PIN/vai trò, giới hạn gửi mã và bill theo email

## 3.4 (2026-11-12)

- Bảo mật đợt 1: sửa lỗ hổng bỏ qua mã thiết bị (đọc đơn khách đã xóa), bắt buộc APP_SECRET riêng (chỉ BRG_DEV=1 mới chạy thử), chống SSRF cho API giá và SMTP, giới hạn tốc độ trong ứng dụng, trustProxy an toàn, quản trị không vào bằng PIN, chống đo thời gian liệt kê tài khoản, seed/backup/.gitignore an toàn hơn

## 3.3 (2026-11-11)

- Responsive điện thoại: bảng tự xếp thành thẻ trên màn hình hẹp (quản trị, nhân viên, khách), nút không bị bóp chữ; khách thấy thanh toán thành công nhanh hơn (3 giây)

## 3.2 (2026-11-11)

- Trang Chi nhánh trên điện thoại: ô tìm kiếm rộng đủ dùng

## 3.1 (2026-11-11)

- Giao diện luôn sáng trên điện thoại (không đổi sang nền tối theo chế độ tối): khách, nhân viên, quản trị; màn quét hàng dùng nút trắng, khung quét màu cam

## 3.0 (2026-11-11)

- Gỡ hẳn tính năng đồng bộ tồn kho từ API đối tác (không dùng đến): bỏ thẻ cấu hình, API, công việc nền, bảng stock_levels; tự xóa cấu hình và khóa API đã lưu

## 2.9 (2026-11-11)

- Hiện số phiên bản trên web (đăng nhập, menu quản trị, màn khách, đăng nhập nhân viên); bản cũ trước 2.3 tự được thay ngay để thông báo cập nhật hoạt động; nút Đã thanh toán xong chỉ sáng khi Dsmart POS báo thanh toán; đồng bộ tồn kho hiện rõ lỗi theo trang, mã điểm đối tác trả về, tự thử lại khi 401 giữa chừng, nghỉ giữa các trang

## 2.8 (2026-11-11)

- Trang Chi nhánh: chế độ Thu gọn (mặc định), tìm kiếm, nút Mã QR ngay cạnh tên chi nhánh, cột tên cố định khi cuộn ngang

## 2.7 (2026-11-11)

- Sửa trang Tích hợp: danh sách chi nhánh ở ô Kiểm tra thử hiện đúng mã điểm đã nhập, và tự cập nhật sau khi nhập file mã điểm

## 2.6 (2026-11-11)

- Trang Tích hợp: thẻ Tồn kho (API đối tác) đặt ngay dưới thẻ Dsmart POS và có chỉ dẫn

## 2.5 (2026-11-11)

- Mỗi tài khoản quản trị chỉ đăng nhập một thiết bị: đăng nhập mới phải xác nhận và đăng xuất thiết bị đang dùng; bật tắt ở Chính sách bảo mật

## 2.4 (2026-11-11)

- Nút đăng nhập vân tay / Face ID luôn hiện; nếu trình duyệt hoặc địa chỉ http không hỗ trợ thì báo rõ lý do

## 2.3 (2026-11-11)

- Thông báo có phiên bản mới trên trình duyệt (khách, nhân viên, quản trị): kiểm tra định kỳ, nút Cập nhật ngay / Để sau, không tự tải lại trang

## 2.2 (2026-11-11)

- Bảo mật đăng nhập quản trị: mã hình 4 số, đổi/gỡ xác thực 2 bước có xác nhận, chính sách bắt buộc bật tắt được, đăng nhập bằng vân tay / khuôn mặt (passkey WebAuthn)

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
