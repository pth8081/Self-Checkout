# Thuật ngữ

| Thuật ngữ | Nghĩa |
|-----------|-------|
| BRG Self Checkout | Tên sản phẩm (D-01) |
| Scan & Go | Mô hình khách tự quét và thanh toán, không qua quầy thu ngân; tên gọi chung của mô hình |
| PWA | Progressive Web App — web chạy như app, có service worker, manifest, hỗ trợ offline |
| Service worker | Script nền trong trình duyệt, chặn request, cache, hỗ trợ offline |
| Giỏ hàng ảo | Danh sách sản phẩm quét trong một `ScanSession`, chưa thanh toán |
| Khoá giỏ | Bước khách bấm tiếp tục để thanh toán; giỏ không sửa được cho đến khi quay lại |
| Mã giỏ hàng | Mã (và QR) hiện trên máy khách để nhân viên quầy quét và thu tiền (ví dụ GH-Q7-0384) |
| QR biên nhận | Mã QR duy nhất sau khi nhân viên xác nhận thu tiền, xuất trình tại cổng ra |
| Cổng ra | Điểm kiểm soát cuối, nơi nhân viên quét QR biên nhận và kiểm tra ngẫu nhiên |
| Kiểm tra ngẫu nhiên | Đối chiếu giỏ thật với giỏ ảo theo tỷ lệ cấu hình, do máy chủ bốc |
| Quầy Self Checkout | Quầy nhân viên thu tiền và xác nhận cho khách dùng Self Checkout (GĐ1) |
| Mã giao dịch | Chuỗi duy nhất trong nội dung chuyển khoản, dùng để khớp thanh toán (ví dụ SG Q7 0384) |
| QrProvider | Thành phần tạo QR chuyển khoản: `SelfQr` (app tự tạo) hoặc `ProviderQr` (từ nhà cung cấp) |
| VietQR | Chuẩn mã QR chuyển khoản ngân hàng ở Việt Nam |
| POS/ERP | Hệ thống bán hàng/quản trị hiện có, nguồn chân lý về giá & tồn kho |
| `storeId` | Khoá chi nhánh, phân vùng multi-tenant |
| Cờ tính năng | Công tắc bật/tắt Self Checkout hoặc từng cách thanh toán theo chi nhánh |
| Đối soát | So tiền mặt đếm thực tế với hệ thống theo ca, và chuyển khoản với sao kê ngân hàng |
| Idempotent | Gửi lặp cùng một yêu cầu cho kết quả như gửi một lần |
| MST | Mã số thuế |
| GĐ1 / GĐ1.5 / GĐ2 | Giai đoạn 1 (thủ công), 1.5 (thử thanh toán tự động ở một chi nhánh), 2 (nhân rộng) |
