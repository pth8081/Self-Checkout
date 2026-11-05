# ADR-0002: QR chuyển khoản do app tạo, thay được bằng QR từ nhà cung cấp

- **Trạng thái:** Đã chốt hướng (D-03); chi tiết kỹ thuật cần kiểm chứng
- **Ngày:** 2026-11-04
- **Người quyết:** Khách hàng

## Bối cảnh
Khách muốn mỗi giao dịch có một mã QR chuyển khoản riêng. Khách muốn làm việc nhanh với nhà cung cấp để thử, và muốn app tự tạo QR trước, sau này có thể lấy QR do nhà cung cấp trả về. Yêu cầu liên quan: FR-PAY-02, FR-ADM-11.

## Phương án
1. **App tự dựng QR chuyển khoản** (chuẩn VietQR/Napas) từ ngân hàng, số tài khoản, số tiền, nội dung. Không cần tích hợp. Không tự biết khi khách đã trả: nhân viên xác nhận.
2. **Lấy QR từ nhà cung cấp** qua API (ví dụ VNPay hoặc đơn vị đọc biến động số dư). Tự biết khi khách đã trả nhờ thông báo từ nhà cung cấp. Cần đăng ký, khoá bí mật, môi trường thử.

## Quyết định
Cài đặt cả hai sau một giao diện chung `QrProvider.createQr(transaction)`: `SelfQr` (dùng ở GĐ1) và `ProviderQr` (GĐ1.5/GĐ2). Chọn bằng `StoreConfig.qrProvider` theo từng chi nhánh (màn A03). Nội dung chuyển khoản luôn chứa mã giao dịch duy nhất. Giao diện khách (M17) và luồng ra cổng không đổi.

Khớp thanh toán (cho `ProviderQr`): đúng số tiền, đúng nội dung chứa mã giao dịch, đúng tài khoản nhận; thông báo trùng chỉ xử lý một lần; thông báo phải có chữ ký.

## Hệ quả
- Có thể thử nhà cung cấp ở một chi nhánh, chi nhánh khác vẫn thủ công; lỗi thì tắt cờ.
- Có thể chạy hai cách song song một thời gian để đối chiếu.
- **Cần kiểm chứng trước khi code (Q-07, R12):** QR tự dựng quét được đúng tiền và nội dung trên app của nhiều ngân hàng; ngân hàng của công ty cho phép cách thu này và không cắt/đổi nội dung.
