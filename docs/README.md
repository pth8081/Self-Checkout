# Bộ tài liệu Scan & Go (PWA)

Cách đọc: đi từ trên xuống. Mỗi tài liệu có **trạng thái** (`Nháp` / `Cần xác nhận` / `Đã chốt`) ở đầu file. Mục `TODO` là phần còn thiếu so với tài liệu gốc.

| # | Tài liệu | Nội dung | Trạng thái |
|---|----------|----------|-----------|
| 01 | [Tổng quan & phạm vi](01-tong-quan-pham-vi.md) | Mục tiêu, trong/ngoài phạm vi, vai trò | Nháp |
| 02 | [Yêu cầu chức năng](02-yeu-cau-chuc-nang.md) | User story có mã `FR-*`, tiêu chí chấp nhận | Nháp |
| 03 | [Yêu cầu phi chức năng](03-yeu-cau-phi-chuc-nang.md) | Hiệu năng, bảo mật, offline, audit | Cần xác nhận |
| 04 | [Kiến trúc hệ thống](04-kien-truc-he-thong.md) | Backend trung tâm, 4 tích hợp, multi-tenant | Nháp |
| 05 | [Kiến trúc PWA](05-kien-truc-pwa.md) | Service worker, offline, quét mã, cài đặt, giới hạn iOS | Nháp (mới) |
| 06 | [Mô hình dữ liệu](06-mo-hinh-du-lieu.md) | Thực thể, quan hệ, `storeId` | Nháp |
| 07 | [Tích hợp & chống thất thoát](07-tich-hop-chong-that-thoat.md) | POS/ERP, thanh toán, hoá đơn, các lớp kiểm soát | Nháp |
| 08 | [Lộ trình & rủi ro](08-lo-trinh-rui-ro.md) | 3 giai đoạn, rủi ro | Nháp |
| 09 | [Phân tích khoảng trống & câu hỏi mở](09-phan-tich-khoang-trong.md) | Điểm tài liệu gốc chưa nói, quyết định cần chốt | **Đọc đầu tiên** |
| — | [Thuật ngữ](thuat-ngu.md) | | |
| — | [ADR](adr/0000-mau.md) | Mẫu ghi quyết định kiến trúc | |

## Quy ước

- Mã yêu cầu: `FR-CUS-xx` (khách), `FR-GATE-xx` (cổng ra), `FR-ADM-xx` (quản trị), `NFR-xx` (phi chức năng), `PWA-xx` (riêng PWA).
- Tài liệu gốc gọi chung các giá trị chưa rõ là "cần xác nhận"; ở đây chúng được gom về mục `Q-xx` trong [09](09-phan-tich-khoang-trong.md).
- Quyết định kiến trúc quan trọng ghi bằng ADR trong `adr/`.
