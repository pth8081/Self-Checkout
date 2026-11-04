# Thuật ngữ

| Thuật ngữ | Nghĩa |
|-----------|-------|
| Scan & Go | Mô hình khách tự quét và thanh toán, không qua quầy thu ngân |
| PWA | Progressive Web App — web chạy như app, có service worker, manifest, hỗ trợ offline |
| Service worker | Script nền trong trình duyệt, chặn request, cache, hỗ trợ offline |
| Giỏ hàng ảo | Danh sách sản phẩm quét trong một `ScanSession`, chưa thanh toán |
| QR biên nhận | Mã QR duy nhất sau thanh toán, xuất trình tại cổng ra |
| Cổng ra | Điểm kiểm soát cuối, nơi nhân viên quét QR và kiểm tra ngẫu nhiên |
| Kiểm tra ngẫu nhiên | Đối chiếu giỏ thật với giỏ ảo theo tỷ lệ cấu hình |
| POS/ERP | Hệ thống bán hàng/quản trị hiện có, nguồn chân lý về giá & tồn kho |
| `storeId` | Khoá chi nhánh, phân vùng multi-tenant |
| Cờ tính năng | Công tắc bật/tắt Scan & Go theo chi nhánh |
| Idempotent | Gửi lặp cùng một yêu cầu cho kết quả như gửi một lần |
| MST | Mã số thuế |
