---
title: Sơ đồ khó
summary: Nhãn dài, nhiều cột, nhiều chu trình, chuỗi mũi tên và định nghĩa ngay trong dòng.
group: nghiep-vu
order: 30
access: all
---
## Tuần tự nhiều cột, nhãn dài

```seq
title: Thu tiền, xuất hoá đơn và đối soát cuối ngày
actors: Khách hàng | Thu ngân kiêm kiểm soát cổng | Máy chủ BRG | Hệ thống POS của chi nhánh | Ngân hàng
Khách hàng -> Máy chủ BRG: Quét từng mã vạch hàng hoá, hệ thống trả về tên, đơn giá và tổng tiền tạm tính của giỏ hàng
Máy chủ BRG -> Hệ thống POS của chi nhánh: Tra cứu giá và tồn kho
Hệ thống POS của chi nhánh --> Máy chủ BRG: Trả về giá hiện hành
Khách hàng -> Thu ngân kiêm kiểm soát cổng: Đưa mã giỏ hàng
note over Thu ngân kiêm kiểm soát cổng: Đối chiếu số tiền và chọn hình thức thanh toán, tiền mặt hoặc chuyển khoản
Thu ngân kiêm kiểm soát cổng -> Máy chủ BRG: Xác nhận đã thu đủ tiền
Máy chủ BRG -> Máy chủ BRG: Ghi nhật ký và phát hành biên nhận có hạn dùng
== Cuối ngày ==
Ngân hàng --> Máy chủ BRG: Sao kê giao dịch
Máy chủ BRG -> Hệ thống POS của chi nhánh: Đối soát
note over Khách hàng, Ngân hàng: Mọi chênh lệch được ghi lại để quản lý xem xét ngày hôm sau
```

## Lưu đồ nhiều chu trình

```flow
title: Đăng nhập và khoá tài khoản
start([Bắt đầu]) --> a[Nhập tài khoản và mật khẩu] --> b{Đúng mật khẩu?}
b -- Đúng --> c{Đã bật xác thực hai bước?}
b -- Sai --> d[Ghi nhận một lần sai]
d --> e{Đã sai năm lần liên tiếp?}
e -- Chưa --> a
e -- Rồi --> f[Khoá tạm mười lăm phút]
f --> a
c -- Có --> g[Nhập mã sáu số]
c -- Không --> h([Vào hệ thống])
g --> i{Mã đúng?}
i -- Đúng --> h
i -- Sai --> g
i -.-> d
```

## Bốn nhánh và nhãn dài

```flow
title: Chọn hình thức thanh toán
q{Khách chọn hình thức nào để thanh toán hôm nay?}
a[Tiền mặt tại quầy]
b[Chuyển khoản bằng mã QR của ngân hàng]
c[Thanh toán trực tuyến]
d[Hẹn thanh toán sau]
z([Hoàn tất])
q -- Tiền mặt, thu ngân đếm tiền trước mặt khách --> a
q -- Chuyển khoản --> b
q -- Online --> c
q -- Sau --> d
a --> z
b --> z
c --> z
d --> z
```

## Đơn giản nhất

```flow
a[Một] --> b[Hai]
```

```seq
A -> B
```
