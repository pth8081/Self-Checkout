# 10. Danh mục màn hình

**Trạng thái:** Nháp. Bản vẽ: [thiet-ke/man-hinh.html](thiet-ke/man-hinh.html) (mở bằng trình duyệt; cần mạng để tải phông chữ). Tên siêu thị, sản phẩm, giá, số liệu trong bản vẽ là dữ liệu mẫu.

Tổng cộng **49 màn hình**: 24 khách (M), 14 nhân viên (N), 11 quản trị (A).

## 1. Khách hàng — PWA khách (M01–M24)

| Mã | Màn hình | Yêu cầu |
|----|----------|---------|
| M01 | Chào & nhận diện chi nhánh | FR-CUS-01 |
| M02 | Hướng dẫn nhanh (3 bước) | FR-CUS-12 |
| M03 | Xin quyền camera | FR-CUS-02, PWA-01 |
| M04 | Camera bị chặn | FR-CUS-11 |
| M05 | Chi nhánh chưa bật | FR-CUS-01, FR-ADM-01 |
| M06 | Mở trong app khác (webview) | FR-CUS-11 |
| M07 | Quay lại giỏ đang dở | FR-CUS-09 |
| M08 | Quét mã vạch | FR-CUS-02 |
| M09 | Vừa quét xong | FR-CUS-03 |
| M10 | Mã không có trong hệ thống | FR-CUS-05 |
| M11 | Nhập mã bằng tay | FR-CUS-05 |
| M12 | Giỏ hàng | FR-CUS-03, FR-CUS-04 |
| M13 | Giỏ hàng trống | FR-CUS-04 |
| M14 | Mất mạng tạm thời | FR-CUS-09 |
| M15 | Giá hoặc tồn kho vừa đổi | FR-CUS-10 |
| M16 | Chọn cách thanh toán (tiền mặt, chuyển khoản; nhóm online mờ) | FR-CUS-06 |
| M17 | Chuyển khoản QR | FR-PAY-02 |
| M18 | Chờ nhân viên xác nhận (mã giỏ hàng) | FR-PAY-01 |
| M19 | QR biên nhận | FR-CUS-07, PWA-06 |
| M20 | Kiểm tra ngẫu nhiên (phía khách) | FR-GATE-03 |
| M21 | Hoàn tất & đánh giá | FR-CUS-08, FR-CUS-13 |
| M22 | Hoá đơn điện tử | FR-CUS-08 |
| M23 | Đang xử lý thanh toán online (GĐ2, tắt ở GĐ1) | FR-PAY-09 |
| M24 | Thanh toán online thất bại (GĐ2, tắt ở GĐ1) | FR-PAY-09 |

## 2. Nhân viên — PWA nhân viên (N01–N14)

| Mã | Màn hình | Yêu cầu |
|----|----------|---------|
| N01 | Đăng nhập nhân viên | FR-ADM-05 |
| N02 | Trang chính của ca | FR-ADM-05 |
| N03 | Quét mã giỏ hàng | FR-PAY-03 |
| N04 | Giỏ hàng cần thu | FR-PAY-03, FR-GATE-03 |
| N05 | Thu tiền mặt | FR-PAY-04 |
| N06 | Xác nhận chuyển khoản | FR-PAY-05 |
| N07 | Đã thu tiền | FR-PAY-06 |
| N08 | Quét QR ra cổng | FR-GATE-01 |
| N09 | Hợp lệ, cho qua | FR-GATE-01 |
| N10 | Được chọn kiểm tra ngẫu nhiên | FR-GATE-03, FR-GATE-06 |
| N11 | QR đã dùng / chưa thanh toán / không hợp lệ | FR-GATE-02 |
| N12 | Đối chiếu giỏ hàng | FR-GATE-03, FR-GATE-05 |
| N13 | Xử lý chênh lệch | FR-GATE-04 |
| N14 | Đối soát cuối ca | FR-PAY-07 |

## 3. Quản trị — web (A01–A11)

| Mã | Màn hình | Vai trò | Yêu cầu |
|----|----------|---------|---------|
| A01 | Tổng quan chuỗi | Chuỗi | FR-ADM-02 |
| A02 | Bật/tắt chi nhánh & cách thanh toán | Chuỗi | FR-ADM-01, FR-PAY-08 |
| A03 | Cấu hình tích hợp (POS, chuyển khoản QR, hoá đơn) | Chuỗi | FR-ADM-03, FR-ADM-11 |
| A04 | Báo cáo tổng hợp | Chuỗi | FR-ADM-02 |
| A05 | Tài khoản & phân quyền | Chuỗi | FR-ADM-07 |
| A06 | Trong ngày của chi nhánh | Chi nhánh | FR-ADM-04 |
| A07 | Truy vết một giao dịch | Chi nhánh | FR-ADM-09 |
| A08 | Nhân viên & ca | Chi nhánh | FR-ADM-05 |
| A09 | Tỷ lệ kiểm tra ngẫu nhiên | Chi nhánh | FR-ADM-06 |
| A10 | Đối soát tiền | Chi nhánh | FR-ADM-08 |
| A11 | Mã quét không tìm thấy | Chi nhánh | FR-ADM-10 |

## 4. Chưa có thiết kế

- Đăng nhập web quản trị; quên mã PIN / đặt lại.
- Huỷ giao dịch / hoàn tiền có quyền quản lý (G-07).
- Lịch sử đơn của khách (phụ thuộc G-04).
- Màn hình hướng dẫn riêng cho hàng cân, hàng giới hạn độ tuổi (G-01, G-02).
- Giao diện quản trị trên điện thoại (hiện vẽ cho màn hình máy tính).
