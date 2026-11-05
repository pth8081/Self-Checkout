---
title: Tổng quan nghiệp vụ
summary: BRG Self Checkout là gì, ai làm gì, các nguyên tắc kiểm soát và luồng từ lúc khách vào cửa hàng đến lúc ra cổng.
group: nghiep-vu
order: 10
access: all
---

# Tổng quan nghiệp vụ

BRG Self Checkout cho khách **tự quét mã vạch từng món bằng điện thoại**, xem giỏ hàng và tổng tiền ngay, rồi **thanh toán tại quầy Self Checkout** và ra cổng bằng **mã QR biên nhận**. Nhân viên không phải quét từng món, chỉ đối chiếu giỏ, thu tiền và kiểm tra.

> **Lưu ý:** Giai đoạn 1 chưa có thanh toán online. Khách trả **tiền mặt** hoặc **chuyển khoản QR**, và **nhân viên xác nhận** đã thu. Ví điện tử, VNPay, thẻ sẽ bật sau bằng cấu hình.

## Các bên tham gia

| Vai trò | Dùng gì | Việc chính |
|---------|---------|-----------|
| Khách hàng | Điện thoại, mở đường dẫn từ mã QR dán ở cổng vào | Quét món, kiểm tra giỏ, chọn cách trả, đưa mã giỏ hàng cho thu ngân, đưa QR biên nhận ở cổng |
| Thu ngân | App nhân viên `/s/` | Bắt đầu ca, quét mã giỏ, đối chiếu giỏ, thu tiền mặt hoặc xác nhận chuyển khoản, kết thúc ca và đối soát tiền mặt |
| Nhân viên cổng ra | App nhân viên `/s/` | Quét QR biên nhận, thực hiện kiểm tra ngẫu nhiên, ghi chênh lệch |
| Quản lý chi nhánh | Web quản trị `/a/` và app nhân viên | Xem giao dịch trong ngày, xếp ca, đặt tỷ lệ kiểm tra, xử lý ca bị giữ, đối soát, huỷ giao dịch khi cần |
| Quản trị chuỗi | Web quản trị `/a/` | Bật hoặc tắt chi nhánh và cách thanh toán, cấu hình ngân hàng, tích hợp, tài khoản, báo cáo toàn chuỗi |
| Hệ thống | Máy chủ | Tra giá và tồn kho từ POS, tính tổng, sinh mã, ký QR, ghi nhật ký |

Một nhân viên có thể vừa là thu ngân vừa làm cổng ra (vai trò "thu ngân + cổng ra"), thường ở chi nhánh ít người.

## Luồng tổng quát

```seq
title: Từ lúc vào cửa hàng đến lúc ra cổng
actors: Khách | Hệ thống | Thu ngân | Cổng ra
Khách -> Hệ thống: Quét mã QR ở cổng vào, mở ứng dụng
Hệ thống --> Khách: Nhận diện chi nhánh, tạo giỏ hàng
Khách -> Hệ thống: Quét mã vạch từng món
Hệ thống --> Khách: Tên, giá, tổng tiền
Khách -> Hệ thống: Chọn cách thanh toán, khoá giỏ
Hệ thống --> Khách: Mã giỏ hàng GH-...
== Thanh toán tại quầy ==
Khách -> Thu ngân: Đưa mã giỏ hàng
Thu ngân -> Hệ thống: Quét mã, xem giỏ
Khách -> Thu ngân: Trả tiền mặt hoặc chuyển khoản
Thu ngân -> Hệ thống: Bấm xác nhận đã thu
Hệ thống --> Khách: Hiện QR biên nhận
== Ra cổng ==
Khách -> Cổng ra: Đưa QR biên nhận
Cổng ra -> Hệ thống: Quét QR
Hệ thống --> Cổng ra: Cho qua, hoặc cần kiểm tra
```

Cùng một giao dịch đi qua ba bước kiểm soát độc lập: **hệ thống** khoá giá và số lượng, **thu ngân** xác nhận tiền đã thu, **cổng ra** xác nhận QR hợp lệ và (khi được chọn) kiểm tra hàng thật.

## Nguyên tắc nghiệp vụ

1. **POS là nguồn giá và tồn kho.** BRG Self Checkout không tự nhập giá. Giá khách thấy lúc quét có thể bị đối chiếu lại khi khoá giỏ, và khách phải đồng ý nếu giá đổi.
2. **Giá chốt khi khoá giỏ.** Sau khi khoá, không sửa được giỏ, trừ khi khách (hoặc thu ngân) mở khoá và quay lại bước quét.
3. **Chỉ người có thẩm quyền mới xác nhận đã thu tiền.** Khách không tự bấm "đã thanh toán". Mỗi xác nhận ghi rõ người thu, cách thu, giờ.
4. **QR biên nhận dùng một lần.** Quét hợp lệ ở cổng là bị đánh dấu đã dùng ngay. Chụp lại ảnh QR để vào lần hai sẽ bị chặn.
5. **Không sửa, không xoá.** Thanh toán và nhật ký chỉ được thêm. Sai sót được xử lý bằng thao tác huỷ có lý do và người duyệt, vẫn để lại dấu vết.
6. **Kiểm tra ngẫu nhiên do hệ thống chọn**, không phải nhân viên. Không có nút bỏ qua.
7. **Mỗi chi nhánh bật tắt độc lập.** Tắt một chi nhánh khi có sự cố không ảnh hưởng chi nhánh khác.

## Các trạng thái của một giao dịch

```flow
title: Vòng đời giao dịch
direction: right
a([Giỏ đang quét])
b([Đã khoá giỏ, chờ thu])
c([Đã thu tiền])
d([Đã ra cổng])
e([Bị huỷ])
a --> b
b --> a
b --> c
c --> d
b --> e
c --> e
```

| Trạng thái | Ý nghĩa | Ai chuyển |
|-----------|---------|-----------|
| Giỏ đang quét | Khách đang quét, sửa giỏ | Khách |
| Đã khoá giỏ, chờ thu | Giá đã chốt, có mã giỏ hàng, đang chờ thu ngân | Khách (khoá), khách hoặc thu ngân (mở lại) |
| Đã thu tiền | Thu ngân đã xác nhận, QR biên nhận có hiệu lực | Thu ngân |
| Đã ra cổng | QR đã dùng, khách đã qua cổng | Nhân viên cổng ra, hoặc quản lý duyệt |
| Bị huỷ | Giỏ bị huỷ trước khi thu, hoặc giao dịch đã thu bị quản lý huỷ khi khách chưa ra | Thu ngân, quản lý |

## Đọc tiếp

- Quy trình mua sắm của khách, từng bước.
- Quy trình thanh toán tại quầy.
- Thu ngân và ca làm việc.
- Cổng ra và kiểm tra ngẫu nhiên.
- Quản lý, đối soát và huỷ giao dịch.
- Tình huống ngoại lệ.
- Điểm cần chốt.
