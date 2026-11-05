# 01. Tổng quan & phạm vi

**Trạng thái:** Nháp

## 1. Bối cảnh

Chuỗi siêu thị triển khai **BRG Self Checkout** (mô hình Scan & Go) cho toàn hệ thống. Khách dùng điện thoại của mình, mở qua trình duyệt (PWA), quét mã vạch khi mua sắm, thấy giỏ hàng và tổng tiền theo thời gian thực, rồi thanh toán và ra cổng bằng mã QR biên nhận.

**Giai đoạn 1** (mục tiêu dùng được trong khoảng 2 tháng): khách tự quét hàng, **trả tiền mặt hoặc chuyển khoản QR tại quầy, nhân viên xác nhận**. Thanh toán online chưa triển khai, nhưng giao diện giữ chỗ và bật bằng cờ cấu hình (xem D-02).

## 2. Mục tiêu kinh doanh

| Mã | Mục tiêu | Chỉ số đo (TODO: chốt số) |
|----|----------|---------------------------|
| G1 | Giảm thời gian chờ ở quầy, nhất là giờ cao điểm | Thời gian từ vào cổng đến ra cổng; % khách dùng Self Checkout |
| G2 | Giảm thu ngân cố định, chuyển sang hỗ trợ khách | Số giờ công thu ngân/chi nhánh |
| G3 | Thu thập dữ liệu hành vi (quét nhưng không mua, thời gian mua sắm) | Có đủ sự kiện phân tích (xem [06](06-mo-hinh-du-lieu.md) mục 6) |
| G4 | Lợi thế cạnh tranh về trải nghiệm | Điểm hài lòng khách |

Ghi chú: ở giai đoạn 1 quầy vẫn có người (thu tiền và kiểm tra). Mục tiêu G1 đạt qua việc nhân viên không phải quét từng món, G2 chỉ đạt rõ rệt khi có thanh toán tự động.

## 3. Phạm vi

**Trong phạm vi giai đoạn 1**

1. PWA khách hàng trên trình duyệt di động hiện đại, không cần cài app.
2. PWA nhân viên: thu tiền tại quầy và kiểm tra cổng ra.
3. Web quản trị cho chi nhánh và toàn chuỗi.
4. Multi-tenant cho toàn chuỗi ngay từ đầu; bật/tắt theo cờ tính năng từng chi nhánh, và từng cách thanh toán.
5. Tích hợp POS/ERP: đọc giá, tồn kho (đã có API cập nhật gần real-time).
6. Thanh toán **tiền mặt** và **chuyển khoản QR** do nhân viên xác nhận.
7. Hoá đơn điện tử tự động.
8. Kiểm soát cổng ra bằng QR biên nhận + kiểm tra ngẫu nhiên thủ công.

**Chuẩn bị sẵn nhưng chưa bật**

- Thanh toán online: ví, VNPay, thẻ. Giao diện hiện mờ "Sắp có". Mã QR từ nhà cung cấp (có xác nhận tự động) thay thế được QR do app tự tạo (xem [ADR-0002](adr/0002-qr-chuyen-khoan-thay-duoc.md)).

**Ngoài phạm vi (giai đoạn này)**

1. Cân thông minh, camera AI.
2. App native iOS/Android.
3. Khách hàng thân thiết (cần xác nhận riêng, Q-10).
4. Đồng bộ ngược dữ liệu về POS. POS vẫn là nguồn chân lý. Xem G-05: giao dịch Self Checkout vào kế toán và tồn kho bằng cách nào vẫn cần chốt.

## 4. Vai trò

| Vai trò | Giao diện | Việc chính | Màn hình |
|---------|-----------|-----------|----------|
| Khách hàng | PWA khách | Vào cửa hàng, quét sản phẩm, giỏ hàng, chọn cách trả, nhận QR ra cổng | M01–M26 |
| Nhân viên quầy / cổng | PWA nhân viên (điện thoại hoặc máy cầm tay) | Quét mã giỏ hàng và thu tiền; quét QR ra cổng; kiểm tra ngẫu nhiên; xử lý chênh lệch | N01–N14 |
| Quản trị viên chi nhánh | Web quản trị | Giao dịch trong ngày, ca nhân viên, tỷ lệ kiểm tra, đối soát tiền | A06–A11 |
| Quản trị viên chuỗi | Web quản trị | Bật/tắt chi nhánh và cách thanh toán, tích hợp, báo cáo toàn chuỗi, phân quyền | A01–A05, A12 |

Cấu trúc ứng dụng: PWA khách, PWA nhân viên và web quản trị tách riêng (xem [05](05-kien-truc-pwa.md) mục 2).

## 5. Giả định

- A1: Khách có điện thoại có camera và trình duyệt hiện đại (Safari iOS ≥ TODO, Chrome Android ≥ TODO).
- A2: Có mạng trong cửa hàng; mất mạng của khách chỉ tạm thời. Quầy và cổng ra có mạng (xem G-09).
- A3: Mã vạch sản phẩm có trong dữ liệu POS.
- A4: POS là nguồn giá và tồn kho, API cập nhật gần real-time đã có.
- A5: Nhân viên xác nhận thanh toán thủ công là chấp nhận được về mặt vận hành và kiểm soát tiền (xem rủi ro R11).
