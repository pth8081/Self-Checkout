# 07. Tích hợp bên ngoài & chống thất thoát

**Trạng thái:** Nháp

## 1. DSmart POS/ERP (ưu tiên số 1)

Nguyên tắc: BRG Scan & Checkout **không** là nơi nhập liệu song song với DSmart POS.

Hiện trạng: khách hàng **đã có API tồn kho của tất cả siêu thị, cập nhật gần real-time** (D-04). Cần thêm để thiết kế chi tiết:

| Cần có | Dùng để |
|--------|---------|
| Tài liệu API (OpenAPI hoặc mô tả) và cách xác thực; môi trường thử | Viết lớp đồng bộ |
| 20–50 sản phẩm mẫu thật của một chi nhánh | Kiểm tra cách ghép dữ liệu |
| Trường mỗi sản phẩm: mã chi nhánh, SKU, mã vạch, tên, giá, tồn kho, đơn vị, trạng thái đang bán, thời điểm cập nhật | `ProductCache` |
| Cách nhận cập nhật: webhook, gọi định kỳ, hay sự kiện đẩy; tần suất và giới hạn số lần gọi | Chọn chế độ đồng bộ |
| Một SKU có nhiều mã vạch không; mã vạch có trùng giữa chi nhánh không | Khoá tra cứu |
| API có trả giá khuyến mãi không | G-03, dòng khuyến mãi ở M12 |
| Hàng cân theo ký, hàng giới hạn độ tuổi: có đánh dấu không | G-01, G-02 |

| Trường hợp | Chiến lược |
|------------|-----------|
| DSmart POS có API/webhook thời gian thực | Đồng bộ trực tiếp, `ProductCache` cập nhật ngay |
| DSmart POS chỉ xuất dữ liệu định kỳ | Đồng bộ chu kỳ ngắn (1–5 phút) + cảnh báo khi lệch quá ngưỡng (Q-12) |

Màn hình quản trị A01 và A03 hiện độ trễ đồng bộ và số mã vạch không khớp. Khi khoá giỏ, hệ thống kiểm tra lại giá và tồn kho (M15).

Ghi nhận giao dịch Scan & Checkout vào DSmart POS/kế toán/tồn kho: chưa có cơ chế, xem G-05.

## 2. Thanh toán

### Giai đoạn 1: thủ công tại quầy

| Cách trả | Quy trình | Kiểm soát |
|----------|-----------|-----------|
| Tiền mặt | Khách đưa mã giỏ hàng → nhân viên quét, đối chiếu, nhận tiền → bấm "Đã thu tiền" | Ghi người thu, thời điểm; đối soát tiền mặt theo ca (N14, A10) |
| Chuyển khoản QR | App tạo QR có sẵn số tiền và nội dung (mã giao dịch) → khách chuyển → nhân viên đối chiếu thông báo ngân hàng, tick đủ 3 điều kiện → xác nhận | Không xác nhận theo ảnh chụp màn hình; đối chiếu sao kê ngân hàng hằng ngày |

Việc cần kiểm chứng trước khi code: (a) QR do app tự dựng theo chuẩn VietQR/Napas quét được đúng số tiền và nội dung trên app của nhiều ngân hàng; (b) ngân hàng của công ty cho phép dùng tài khoản này thu tiền bán lẻ kiểu này và không cắt/đổi nội dung chuyển khoản.

### Giai đoạn 2: tự động

- **QR từ nhà cung cấp** (ví dụ VNPay, hoặc đơn vị trung gian đọc biến động số dư): backend gọi API nhận QR, nhà cung cấp gửi thông báo khi khách trả, hệ thống tự đánh dấu đã thu. Xem [ADR-0002](adr/0002-qr-chuyen-khoan-thay-duoc.md).
- **Ví, thẻ** qua cổng thanh toán có giấy phép. Không tự xử lý thông tin thẻ.
- Thay đổi bằng cấu hình: A02 (bật cách trả theo chi nhánh), A03 (chọn nguồn QR). Có thể thử nhà cung cấp ở một chi nhánh trong khi chi nhánh khác vẫn thủ công.
- Cần thiết kế khi bật: thông báo có chữ ký, idempotency, đối soát cuối ngày, hoàn tiền.
- Màn hình đã chuẩn bị: M23 (đang xử lý), M24 (thất bại).

## 3. Hoá đơn điện tử

- Dùng nhà cung cấp khách hàng đang dùng (Viettel / VNPT / MISA…, Q-04), xuất tự động sau khi nhân viên xác nhận thu tiền.
- Mặc định hoá đơn bán lẻ; khách cần hoá đơn công ty điền mã số thuế sau thanh toán (M22).
- TODO: hàng đợi thử lại, xử lý huỷ/điều chỉnh hoá đơn, xử lý khi nhân viên huỷ xác nhận thu.

## 4. Chiến lược chống thất thoát (theo lớp)

| Lớp | Giai đoạn | Chi phí | Hiệu quả |
|-----|-----------|---------|----------|
| Kiểm tra ngẫu nhiên tại cổng ra | 1 | Thấp (quy trình + công cụ hỗ trợ) | Trung bình, phụ thuộc con người |
| QR biên nhận quét ở cổng (PWA nhân viên) | 1 | Thấp (dùng điện thoại/máy cầm tay) | Cao với gian lận cơ bản; chặn chụp lại ảnh QR |
| Cổng vật lý quét QR tự động | 2 | Trung bình | Cao |
| Cân thông minh trên xe đẩy | 3 (tuỳ chọn) | Cao | Rất cao |
| Camera AI | 3 (tuỳ chọn) | Rất cao | Cao nhất |

Giai đoạn 1 dùng PWA nhân viên làm thiết bị quét tại quầy và cổng — không cần phần cứng riêng.

Ở GĐ1, vì khách phải đến quầy, nhân viên đối chiếu được hàng thật ngay khi thu tiền; điều này giúp kiểm tra ngẫu nhiên dễ hơn. Điểm yếu mới là **xác nhận thủ công**: xem R11 và NFR-16.

## 5. Kiểm tra ngẫu nhiên (khung quy trình)

1. Nhân viên cổng quét QR biên nhận; máy chủ trả kết quả hợp lệ + cờ "cần kiểm tra" theo tỷ lệ chi nhánh (N10); máy khách hiện M20.
2. Nhân viên đối chiếu giỏ thật với danh sách số lượng (N12).
3. Khớp → ghi `ExitCheck`, cho qua. Chênh lệch → thu bổ sung hoặc báo quản lý (N13), ghi lại.
4. Báo cáo: tỷ lệ chênh lệch theo chi nhánh/ca/nhân viên (A04, A09) → điều chỉnh tỷ lệ kiểm tra (bắt đầu cao, giảm dần).

Quy tắc: cờ do máy chủ bốc ngẫu nhiên (nhân viên không tự chọn, tránh thiên lệch); không có nút bỏ qua; khách từ chối thì gọi quản lý (FR-GATE-06).
