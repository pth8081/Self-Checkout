# ADR-0001: Giai đoạn 1 thanh toán thủ công tại quầy

- **Trạng thái:** Đã chốt (D-02)
- **Ngày:** 2026-11-04
- **Người quyết:** Khách hàng

## Bối cảnh
Cần dùng được trong khoảng 2 tháng (D-06). Các hình thức thanh toán online (ví, VNPay, thẻ) cần đăng ký merchant, tích hợp và kiểm thử kỹ nên không kịp (R4). Siêu thị hiện đã nhận tiền mặt và chuyển khoản bằng QR tĩnh. Yêu cầu liên quan: FR-CUS-06, FR-PAY-01…09.

## Phương án
1. **Chờ tích hợp online rồi mới chạy.** Không kịp, mất thời gian, rủi ro kiểm thử.
2. **Thanh toán thủ công ở GĐ1: tiền mặt và chuyển khoản QR, nhân viên xác nhận; giữ chỗ online bằng cờ cấu hình.** Nhanh, tái dùng quy trình hiện có; đổi lại phải có nhân viên ở quầy và có rủi ro xác nhận thủ công.
3. **Khách tự bấm "đã chuyển khoản" hoặc gửi ảnh chụp.** Dễ giả mạo. Loại.

## Quyết định
Chọn phương án 2. Khách tự quét hàng, đến quầy Scan & Checkout đưa mã giỏ hàng, nhân viên đối chiếu và thu tiền rồi bấm xác nhận; khách nhận QR biên nhận để ra cổng. Mỗi cách trả bật/tắt riêng theo chi nhánh. Giao diện online giữ chỗ và hiện mờ.

## Hệ quả
- Quầy vẫn có người; thời gian chờ giảm vì không phải quét từng mặt hàng (G1), nhưng giảm thu ngân (G2) chỉ rõ khi có thanh toán tự động.
- Xác nhận thủ công là điểm yếu: bắt buộc ghi người/cách/thời điểm, không sửa/xóa, đối soát tiền mặt theo ca và chuyển khoản với sao kê (NFR-16, R11, G-15).
- Cần màn hình nhân viên (N01–N14) ngay từ GĐ1.
- Bật thanh toán online sau này bằng cờ, không phải làm lại luồng (ADR-0002).
