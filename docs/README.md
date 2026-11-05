# Bộ tài liệu BRG Self Checkout (PWA)

Cách đọc: đi từ trên xuống. Mỗi tài liệu có **trạng thái** (`Nháp` / `Cần xác nhận` / `Đã chốt`) ở đầu file. Mục `TODO` là phần còn thiếu.

| # | Tài liệu | Nội dung | Trạng thái |
|---|----------|----------|-----------|
| 01 | [Tổng quan & phạm vi](01-tong-quan-pham-vi.md) | Mục tiêu, trong/ngoài phạm vi, vai trò | Nháp |
| 02 | [Yêu cầu chức năng](02-yeu-cau-chuc-nang.md) | User story có mã `FR-*`, luồng thanh toán giai đoạn 1 | Nháp |
| 03 | [Yêu cầu phi chức năng](03-yeu-cau-phi-chuc-nang.md) | Hiệu năng, bảo mật, offline, audit | Cần xác nhận |
| 04 | [Kiến trúc hệ thống](04-kien-truc-he-thong.md) | Backend trung tâm, module thanh toán thay được, multi-tenant | Nháp |
| 05 | [Kiến trúc PWA](05-kien-truc-pwa.md) | Service worker, offline, quét mã, 3 giao diện, giới hạn iOS | Nháp |
| 06 | [Mô hình dữ liệu](06-mo-hinh-du-lieu.md) | Thực thể, trạng thái, `storeId` | Nháp |
| 07 | [Tích hợp & chống thất thoát](07-tich-hop-chong-that-thoat.md) | POS, thanh toán thủ công và online, hoá đơn | Nháp |
| 08 | [Lộ trình & rủi ro](08-lo-trinh-rui-ro.md) | Các giai đoạn, rủi ro | Nháp |
| 09 | [Quyết định, khoảng trống & câu hỏi mở](09-phan-tich-khoang-trong.md) | **Quyết định đã chốt** và việc cần chốt | **Đọc đầu tiên** |
| 10 | [Danh mục màn hình](10-man-hinh.md) | 52 màn hình (khách, nhân viên, quản trị) ánh xạ về yêu cầu | Nháp |
| 11 | [Ứng dụng đã xây & cách gắn tích hợp](11-ung-dung.md) | Chức năng đã làm, quy tắc, gắn POS/hoá đơn/thanh toán online, hạn chế | Mới |
| 12 | [Hướng dẫn nghiệp vụ trong ứng dụng](12-huong-dan-nghiep-vu.md) | Nội dung tài liệu quy trình cho quản trị, cách sửa, cú pháp sơ đồ | Mới |
| 13 | [Hướng dẫn triển khai](13-trien-khai.md) | Fork hay cluster, cài đặt, Nginx, PM2, sao lưu, cập nhật, giám sát, sự cố | Mới |
| — | [Bản thiết kế giao diện](thiet-ke/man-hinh.html) | Mở bằng trình duyệt để xem 52 màn hình | Nháp |
| — | [Thuật ngữ](thuat-ngu.md) | | |
| — | [ADR](adr/) | Các quyết định kiến trúc | |

## Quy ước

- Mã yêu cầu: `FR-CUS-xx` (khách), `FR-PAY-xx` (thu tiền), `FR-GATE-xx` (cổng ra), `FR-ADM-xx` (quản trị), `NFR-xx` (phi chức năng), `PWA-xx` (riêng PWA).
- Mã màn hình: `Mxx` (khách), `Nxx` (nhân viên), `Axx` (quản trị).
- Câu hỏi mở gom về `Q-xx`, khoảng trống về `G-xx`, quyết định về `D-xx` trong [09](09-phan-tich-khoang-trong.md).
- Quyết định kiến trúc quan trọng ghi bằng ADR trong `adr/`.
