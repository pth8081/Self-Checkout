# 07. Tích hợp bên ngoài & chống thất thoát

**Trạng thái:** Nháp

## 1. POS/ERP (ưu tiên số 1)

Nguyên tắc: Scan & Go **không** là nơi nhập liệu song song với POS.

| Trường hợp | Chiến lược | Việc cần làm |
|------------|-----------|--------------|
| POS có API/webhook thời gian thực | Đồng bộ trực tiếp, `ProductCache` cập nhật ngay | Xác định điểm cuối, xác thực, tần suất, giới hạn |
| POS chỉ xuất dữ liệu định kỳ | Đồng bộ chu kỳ ngắn (ví dụ 1–5 phút) + cảnh báo khi lệch quá ngưỡng | Chốt ngưỡng lệch (Q-12); đo độ trễ thực tế |

TODO: bản đồ trường dữ liệu POS ↔ `ProductCache`; xử lý mã vạch trùng/nhiều mã cho một SKU; khuyến mãi; hàng cân; hàng ngừng bán.

## 2. Cổng thanh toán

- Qua nhà cung cấp có giấy phép (MoMo / VNPay / ZaloPay / Napas — chọn theo Q-02); không tự xử lý thông tin thẻ.
- Đăng ký merchant mất thời gian → bắt đầu song song với phát triển (rủi ro ở [08](08-lo-trinh-rui-ro.md)).
- Cần thiết kế: giao diện trừu tượng để thêm cổng thứ hai, webhook có chữ ký, idempotency, đối soát cuối ngày, hoàn tiền.

## 3. Hoá đơn điện tử

- Dùng nhà cung cấp khách hàng đang dùng (Viettel / VNPT / MISA…, Q-04), xuất tự động sau mỗi giao dịch thành công.
- TODO: thông tin người mua (bán lẻ vs có MST), hàng đợi thử lại, xử lý huỷ/điều chỉnh hoá đơn.

## 4. Chiến lược chống thất thoát (theo lớp)

| Lớp | Giai đoạn | Chi phí | Hiệu quả |
|-----|-----------|---------|----------|
| Kiểm tra ngẫu nhiên tại cổng ra | 1 | Thấp (quy trình + công cụ hỗ trợ) | Trung bình, phụ thuộc con người |
| Cổng kiểm soát quét QR biên nhận | 1–2 | Trung bình (thiết bị quét) | Cao, ngăn gian lận cơ bản |
| Cân thông minh trên xe đẩy | 3 (tuỳ chọn) | Cao | Rất cao |
| Camera AI | 3 (tuỳ chọn) | Rất cao | Cao nhất |

Giai đoạn 1 dùng PWA nhân viên trên điện thoại/máy cầm tay làm "thiết bị quét tại cổng" — không cần phần cứng riêng (TODO: xác nhận với khách hàng, G-09).

## 5. Kiểm tra ngẫu nhiên (khung quy trình)

1. Khách xuất trình QR → hệ thống trả kết quả hợp lệ + cờ "cần kiểm tra" theo tỷ lệ chi nhánh.
2. Nhân viên đối chiếu giỏ thật với giỏ ảo.
3. Khớp → ghi `ExitCheck`, cho qua. Chênh lệch → thu bổ sung hoặc báo quản lý, ghi lại.
4. Báo cáo: tỷ lệ chênh lệch theo chi nhánh/ca/nhân viên → điều chỉnh tỷ lệ kiểm tra (bắt đầu cao, giảm dần).

TODO: lệnh lấy mẫu có ngẫu nhiên thật hay do nhân viên tự chọn (tránh thiên lệch); xử lý khách từ chối kiểm tra.
