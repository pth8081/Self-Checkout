# 12. Hướng dẫn nghiệp vụ trong ứng dụng

**Trạng thái:** Nháp. Nội dung đang chờ các quyết định ở mục "Điểm cần chốt" (xem [09](09-phan-tich-khoang-trong.md) và tài liệu cùng tên trong ứng dụng).

Tài liệu quy trình cho vận hành nằm **trong web quản trị** (`/a/`, nhóm "Hướng dẫn"), chỉ người đã đăng nhập quản trị mới xem được. Máy chủ kiểm tra quyền ở API `GET /api/a/guides`, khách và nhân viên quầy hoặc cổng không đọc được.

## Nội dung

| Nhóm | Tài liệu | Ai xem |
|------|----------|--------|
| Hướng dẫn nghiệp vụ | Tổng quan nghiệp vụ; Quy trình mua sắm của khách; Quy trình thanh toán; Thu ngân và ca làm việc; Cổng ra và kiểm tra ngẫu nhiên; Quản lý, đối soát và hủy giao dịch; Tình huống ngoại lệ; Vai trò và trách nhiệm | Mọi quản trị viên |
| Hướng dẫn nghiệp vụ | **Điểm cần chốt** (15 quyết định chưa có quy định) | Quản trị chuỗi |
| Hướng dẫn hệ thống | Tài khoản và bảo mật | Mọi quản trị viên |
| Hướng dẫn hệ thống | Cài đặt một chi nhánh mới; Dữ liệu, nhật ký và tích hợp | Quản trị chuỗi |

Mỗi tài liệu có sơ đồ tuần tự hoặc lưu đồ (tổng quan, mua sắm, thanh toán tiền mặt và chuyển khoản, xử lý chuyển khoản sai, ca làm việc, kết quả ở cổng ra, kiểm tra ngẫu nhiên và chênh lệch, đối soát cuối ngày, đưa chi nhánh vào dùng).

## Cách sửa tài liệu

Tài liệu là file Markdown trong `server/guides/`, đọc lại mỗi lần mở (sửa file là có hiệu lực ngay, không cần khởi động lại). Mỗi file bắt đầu bằng phần thông tin:

```
---
title: Tên tài liệu
summary: Một câu mô tả
group: nghiep-vu        # nghiep-vu hoặc he-thong
order: 10               # thứ tự hiển thị
access: all             # all = mọi quản trị viên, chain = chỉ quản trị chuỗi
---
```

Nên bắt đầu nội dung từ `##`, vì tiêu đề trang đã hiện ở đầu. Tên file chỉ gồm chữ thường, số và dấu gạch ngang (`01-tong-quan.md`); file có tên bắt đầu bằng `_` bị bỏ qua. Bảng, danh sách, in đậm, liên kết `[chữ](#/huong-dan/ten-file)` đều dùng được. Khung lưu ý: dòng đầu của trích dẫn là `> **Lưu ý:**` (xanh), `> **Cần xác nhận:**` (vàng) hoặc `> **Quan trọng:**` (đỏ).

### Sơ đồ tuần tự (khối ` ```seq `)

```
title: Tên sơ đồ
actors: Khách | Thu ngân | Hệ thống
Khách -> Thu ngân: Mũi tên liền
Thu ngân --> Khách: Mũi tên nét đứt
Thu ngân -> Thu ngân: Tự tham chiếu
note over Thu ngân, Hệ thống: Ghi chú trải qua nhiều cột
== Tên giai đoạn ==
```

### Lưu đồ và sơ đồ trạng thái (khối ` ```flow `)

```
title: Tên sơ đồ
direction: down            # hoặc right
a[Ô chữ nhật]
b{Câu hỏi}
c([Ô bo tròn])
a --> b
b -- Có --> c
b -- Không --> a           # quay lại tạo vòng lặp, vẽ tự động
```

Nút khai báo bằng `id[Chữ]`, `id{Chữ}`, `id([Chữ])`, `id((Chữ))` (id chỉ gồm chữ, số, `_`). Mũi tên: `a --> b`, `a -- nhãn --> b`, `a -.-> b` (nét đứt). Nhãn nên tránh dấu ngoặc đơn. Cú pháp sai sẽ hiện khung báo lỗi kèm số dòng, phần còn lại của trang vẫn dùng được.

## Giới hạn

Sơ đồ rộng hơn khung đọc thì co lại hoặc cuộn ngang (trên điện thoại hầu hết sơ đồ tuần tự nhiều cột phải cuộn). Chưa hỗ trợ ảnh, danh sách công việc và HTML thô trong tài liệu.
