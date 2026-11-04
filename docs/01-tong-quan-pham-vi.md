# 01. Tổng quan & phạm vi

**Trạng thái:** Nháp

## 1. Bối cảnh

Chuỗi siêu thị triển khai **Scan & Go** cho toàn hệ thống. Khách dùng điện thoại của mình, mở qua trình duyệt (PWA), quét mã vạch khi mua sắm, thấy giỏ hàng và tổng tiền theo thời gian thực, thanh toán trên điện thoại, rồi ra cổng bằng mã QR biên nhận.

## 2. Mục tiêu kinh doanh

| Mã | Mục tiêu | Chỉ số đo (TODO: chốt số) |
|----|----------|---------------------------|
| G1 | Giảm thời gian chờ ở quầy, nhất là giờ cao điểm | Thời gian từ vào cổng đến ra cổng; % khách dùng Scan & Go |
| G2 | Giảm thu ngân cố định, chuyển sang hỗ trợ khách | Số giờ công thu ngân/chi nhánh |
| G3 | Thu thập dữ liệu hành vi (quét nhưng không mua, thời gian mua sắm) | Có đủ sự kiện phân tích (xem mục 6 của [06](06-mo-hinh-du-lieu.md)) |
| G4 | Lợi thế cạnh tranh về trải nghiệm | Điểm hài lòng khách |

## 3. Phạm vi

**Trong phạm vi**

1. PWA khách hàng trên trình duyệt di động hiện đại, không cần cài app.
2. Multi-tenant cho toàn chuỗi ngay từ đầu; bật/tắt theo cờ tính năng từng chi nhánh.
3. Tích hợp POS/ERP: đồng bộ sản phẩm, giá, tồn kho.
4. Tối thiểu 1 cổng thanh toán ở giai đoạn đầu, mở rộng sau.
5. Hoá đơn điện tử tự động.
6. Kiểm soát cổng ra bằng QR biên nhận + kiểm tra ngẫu nhiên thủ công.
7. Trang quản trị chi nhánh và toàn chuỗi.

**Ngoài phạm vi (giai đoạn này)**

1. Cân thông minh, camera AI.
2. App native iOS/Android.
3. Khách hàng thân thiết (cần xác nhận riêng, xem Q-10).
4. Đồng bộ ngược về POS — POS là nguồn chân lý duy nhất.

> Lưu ý: "đồng bộ ngược về POS" là ngoài phạm vi, nhưng xem [09 · G-05](09-phan-tich-khoang-trong.md): kế toán, tồn kho và đối soát thanh toán vẫn cần một đường ghi nhận giao dịch Scan & Go vào hệ thống hiện có.

## 4. Vai trò

| Vai trò | Giao diện | Việc chính |
|---------|-----------|-----------|
| Khách hàng | PWA khách | Vào cửa hàng, quét sản phẩm, giỏ hàng, thanh toán, nhận QR biên nhận |
| Nhân viên kiểm soát cổng | PWA nhân viên (thiết bị cầm tay) | Quét QR biên nhận, kiểm tra ngẫu nhiên, xử lý chênh lệch |
| Quản trị viên chi nhánh | Web quản trị | Báo cáo chi nhánh, ca nhân viên, tỷ lệ kiểm tra ngẫu nhiên |
| Quản trị viên chuỗi | Web quản trị | Bật/tắt chi nhánh, báo cáo chuỗi, cấu hình tích hợp, phân quyền |

Quyết định hướng PWA: ba giao diện (khách, nhân viên, quản trị) có thể là **một PWA nhiều route** hoặc **hai PWA** (khách tách riêng vì cần nhẹ và public). Xem [05](05-kien-truc-pwa.md) mục 2.

## 5. Giả định

- A1: Khách có điện thoại có camera và trình duyệt hiện đại (Safari iOS ≥ TODO, Chrome Android ≥ TODO).
- A2: Có mạng trong cửa hàng (Wi-Fi hoặc 4G/5G); mất mạng chỉ tạm thời.
- A3: Mã vạch sản phẩm có trong dữ liệu POS.
- A4: POS vẫn là nguồn giá/tồn kho.
