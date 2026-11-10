---
title: Tổng quan nghiệp vụ
summary: Khách tự quét hàng, thanh toán tại quầy rồi ra cổng bằng mã QR biên nhận.
group: nghiep-vu
order: 10
access: all
---
# Tổng quan nghiệp vụ

Tài liệu này mô tả **toàn bộ hành trình** của khách, từ lúc *quét mã vạch* đến khi ra cổng. Mã lệnh mẫu: `GET /api/a/guides`. Xem thêm [hướng dẫn hệ thống](#/huong-dan/he-thong) và [trang ngoài](https://example.com/trang?a=1&b=2).

> **Lưu ý:** Khách chỉ cần điện thoại, không cần cài ứng dụng.

> **Cần xác nhận:** Nhân viên thu ngân phải đối chiếu số tiền trước khi bấm xác nhận.

> **Quan trọng:** Không chia sẻ mã PIN cho bất kỳ ai.

> Một trích dẫn thường, không có tiêu đề đặc biệt.

## Quy trình tổng quát

```seq
title: Quy trình tổng quát
actors: Khách | Thu ngân | Cổng ra | Hệ thống
Khách -> Hệ thống: Quét mã vạch
Hệ thống --> Khách: Tên, giá, tổng tiền
Khách -> Thu ngân: Đưa mã giỏ hàng để thu tiền
note over Thu ngân, Hệ thống: Thu tiền và xác nhận đã nhận đủ số tiền của giỏ hàng
== Ra cổng ==
# chú thích bị bỏ qua
Khách -> Cổng ra: Đưa QR biên nhận
Cổng ra -> Cổng ra: Tự kiểm tra biên nhận còn hạn hay chưa
Cổng ra --> Khách: Cho qua
```

### Các bước chính

1. Khách quét hàng.
2. Khách khóa giỏ hàng.
   - Có thể mở lại giỏ để sửa.
   - Sau khi thu tiền thì không sửa được.
3. Thu ngân thu tiền.
4. Khách ra cổng.

- Mục không thứ tự một
- Mục hai
  1. Con có thứ tự
  2. Con thứ hai
- Mục ba có `mã` và **đậm**

## Mã vạch không đọc được

```flow
title: Mã vạch có đọc được không
direction: down
a[Khách quét mã]
b{Mã có trong hệ thống?}
c([Thêm vào giỏ])
d[Báo lỗi cho khách]
a --> b
b -- Có --> c
b -- Không --> d
d --> a
```

## Quyết định ba nhánh

```flow
title: Xử lý kết quả kiểm tra ngẫu nhiên tại cổng
x((Bắt đầu))
q{Cổng chọn kiểm tra ngẫu nhiên?}
k[Nhân viên cổng đếm lại hàng trong túi của khách và so với biên nhận]
m{Kết quả đối chiếu}
ok([Cho qua])
hold[Chuyển cho quản lý xử lý]
deny([Từ chối cho qua])
x --> q
q -- Không --> ok
q -- Có --> k
k --> m
m -- Khớp --> ok
m -- Lệch --> hold
m -.-> deny
hold -- Cho qua --> ok
hold -- Từ chối --> deny
```

## Sơ đồ ngang

```flow
direction: right
title: Vòng đời giỏ hàng
a([Đang mua]) --> b([Đã khóa giỏ])
b --> c([Đã thu tiền])
c --> d([Đã ra cổng])
b -- Mở lại để sửa --> a
b -.-> e((Hủy))
```

## Nhóm chú thích

```flow
title: Có nhóm
subgraph Tại quầy
  p[Thu tiền]
  q[In biên nhận]
end
s[Khách]
t[Cổng ra]
s --> p
p --> q
q --> t
```

## Sơ đồ không đánh số

```seq
title: Không đánh số
numbered: false
actors: A | B
A -> B: Xin chào
B --> A: Chào bạn
A -> A: Tự ghi nhớ
```

## Sơ đồ sai

```seq
title: Sơ đồ cố tình sai
actors: A | B
A -> B: hợp lệ
A ~~ B: sai cú pháp
```

```flow
a[Một]
b[Hai]
a --> zzz
```

## Bảng tham chiếu

| Vai trò | Quyền | Ghi chú |
|:--|:-:|--:|
| Thu ngân | Thu tiền | Tại quầy |
| Cổng | Quét QR | Kiểm tra ngẫu nhiên |
| Quản lý | Hủy giao dịch | Cần lý do khá dài để kiểm tra việc cuộn ngang trên màn hình hẹp của điện thoại |

---

#### Mục cấp bốn

Đoạn cuối với ký tự đặc biệt <script>alert(1)</script> và [liên kết xấu](javascript:alert(1)).

```js
const a = 1 < 2;
```
