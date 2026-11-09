---
title: Tổng quan nghiệp vụ
summary: BRG Scan & Checkout là gì, ai làm gì, các nguyên tắc kiểm soát và luồng từ lúc khách vào cửa hàng đến lúc ra cổng.
group: nghiep-vu
order: 10
access: all
---

# Tổng quan nghiệp vụ

> **Cách vận hành hiện nay (Giỏ QR cho Dsmart POS):**
> 1. Khách mở link QR ở cổng vào, quét mã vạch từng mặt hàng bằng điện thoại và thấy **tạm tính** theo giá của đúng chi nhánh.
> 2. Khách bấm **Thanh toán**: điện thoại gửi giỏ lên máy chủ rồi hiện **mã QR ngắn** chỉ chứa mã điểm và mã giỏ; Dsmart POS lấy danh sách mặt hàng bằng API. Nếu lúc đó điện thoại mất mạng, nó hiện mã đầy đủ dự phòng để thu ngân vẫn quét được.
> 3. Thu ngân **quét mã QR vào phần mềm Dsmart POS**. Dsmart POS tạo đơn, tính giá và khuyến mãi, thu tiền, xuất hoá đơn. Thu ngân không quét từng mặt hàng, khách không đứng chờ.
> 4. Dsmart POS **tự báo thanh toán về BRG** (thử lại khi mạng lỗi). Màn hình khách chuyển sang "Đã hoàn thành thanh toán", khách xem bill và tải PDF.
>
> Không có thanh toán trên web, không có bước bảo vệ cổng ra, BRG không quản lý tồn kho. Phần còn lại của bài này mô tả luồng cũ, đang khoá, để dùng lại sau.

BRG Scan & Checkout cho khách **tự quét mã vạch từng mặt hàng bằng điện thoại**, xem giỏ hàng và tổng tiền ngay, rồi **thanh toán tại quầy Scan & Checkout** và ra cổng bằng **mã QR biên nhận**. Nhân viên không phải quét từng mặt hàng, chỉ đối chiếu giỏ, thu tiền và kiểm tra.

> **Lưu ý:** Giai đoạn 1 chưa có thanh toán online trong BRG. Mỗi chi nhánh chọn **một trong hai cách thu tiền** (xem bên dưới). Ví điện tử, VNPay, thẻ sẽ bật sau bằng cấu hình, hoặc dùng sẵn trên Dsmart POS ở chế độ thu tiền qua Dsmart POS.

## Hai cách thu tiền và tuỳ chọn bảo vệ

Quản trị chuỗi chọn cho **từng chi nhánh**:

| Cài đặt | Lựa chọn | Hệ quả |
|---------|----------|--------|
| **Thu tiền** | **Tự thu trong BRG** (mặc định) | Khách trả **tiền mặt** hoặc **chuyển khoản QR** tại quầy, **thu ngân xác nhận** trong app nhân viên |
| | **Qua Dsmart POS** | Thu ngân quét mã giỏ **trong phần mềm Dsmart POS**. Dsmart POS lấy mặt hàng từ BRG qua API, thu tiền (QR, tiền mặt, thẻ), phát hành hoá đơn điện tử và **báo thanh toán về BRG; BRG tự xác nhận**, thu ngân không thao tác thêm trong BRG |
| **Bảo vệ cổng ra** | **Bật** (mặc định) | Khách nhận QR ra cổng, bảo vệ quét, có kiểm tra ngẫu nhiên |
| | **Tắt** (chi nhánh không có bảo vệ) | Thanh toán xong khách **ra luôn**, **không có QR ra cổng**, không có kiểm tra ngẫu nhiên |

Hai cài đặt độc lập, nên có bốn tổ hợp. Các hướng dẫn nghiệp vụ mô tả luồng **mặc định** (tự thu, có bảo vệ) và có mục riêng cho **chế độ Dsmart POS** và **chi nhánh không có bảo vệ**.

## Các bên tham gia

| Vai trò | Dùng gì | Việc chính |
|---------|---------|-----------|
| Khách hàng | Điện thoại, mở đường dẫn từ mã QR dán ở cổng vào | Quét mặt hàng, kiểm tra giỏ, chọn cách trả, đưa mã giỏ hàng cho thu ngân, đưa QR biên nhận ở cổng |
| Thu ngân | App nhân viên `/s/` | Bắt đầu ca, quét mã giỏ, đối chiếu giỏ, thu tiền mặt hoặc xác nhận chuyển khoản, kết thúc ca và đối soát tiền mặt |
| Nhân viên cổng ra | App nhân viên `/s/` | Quét QR biên nhận, thực hiện kiểm tra ngẫu nhiên, ghi chênh lệch |
| Quản lý chi nhánh | Web quản trị `/a/` và app nhân viên | Xem giao dịch trong ngày, xếp ca, đặt tỷ lệ kiểm tra, xử lý ca bị giữ, đối soát, huỷ giao dịch khi cần |
| Quản trị chuỗi | Web quản trị `/a/` | Bật hoặc tắt chi nhánh và cách thanh toán, cấu hình ngân hàng, tích hợp, tài khoản, báo cáo toàn chuỗi |
| Hệ thống | Máy chủ | Tra giá và tồn kho từ Dsmart POS, tính tổng, sinh mã, ký QR, ghi nhật ký |

Một nhân viên có thể vừa là thu ngân vừa làm cổng ra (vai trò "thu ngân + cổng ra"), thường ở chi nhánh ít người.

## Luồng tổng quát

```seq
title: Từ lúc vào cửa hàng đến lúc ra cổng
actors: Khách | Hệ thống | Thu ngân | Cổng ra
Khách -> Hệ thống: Quét mã QR ở cổng vào, mở ứng dụng
Hệ thống --> Khách: Nhận diện chi nhánh, tạo giỏ hàng
Khách -> Hệ thống: Quét mã vạch từng mặt hàng
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

1. **Dsmart POS là nguồn giá và tồn kho.** BRG Scan & Checkout không tự nhập giá. Giá khách thấy lúc quét có thể bị đối chiếu lại khi khoá giỏ, và khách phải đồng ý nếu giá đổi.
2. **Giá chốt khi khoá giỏ.** Sau khi khoá, không sửa được giỏ, trừ khi khách (hoặc thu ngân) mở khoá và quay lại bước quét.
3. **Khách không tự xác nhận đã thanh toán.** Ở chế độ tự thu, chỉ thu ngân xác nhận (ghi rõ người thu, cách thu, giờ). Ở chế độ Dsmart POS, Dsmart POS báo thanh toán thành công và BRG tự xác nhận (ghi rõ nguồn Dsmart POS, cách trả, số tiền, số hoá đơn).
4. **QR biên nhận dùng một lần.** Quét hợp lệ ở cổng là bị đánh dấu đã dùng ngay. Chụp lại ảnh QR để vào lần hai sẽ bị chặn.
5. **Không sửa, không xoá.** Thanh toán và nhật ký chỉ được thêm. Sai sót được xử lý bằng thao tác huỷ có lý do và người duyệt, vẫn để lại dấu vết.
6. **Kiểm tra ngẫu nhiên do hệ thống chọn**, không phải nhân viên. Không có nút bỏ qua.
7. **Mỗi chi nhánh bật tắt độc lập.** Tắt một chi nhánh khi có sự cố không ảnh hưởng chi nhánh khác.

## Luồng khi thu tiền qua Dsmart POS

```seq
title: Chế độ thu tiền qua POS
actors: Khách | POS | Hệ thống BRG | Cổng ra
Khách -> Hệ thống BRG: Khoá giỏ, nhận mã giỏ hàng
Khách -> POS: Đưa mã, thu ngân quét trong POS
POS -> Hệ thống BRG: Nhận giỏ bằng mã giỏ hàng
Hệ thống BRG --> POS: Danh sách mặt hàng
POS -> POS: Tạo đơn, thu tiền, phát hành hoá đơn
POS -> Hệ thống BRG: Báo đã thanh toán (mã hàng, số lượng, thành tiền, tổng tiền)
Hệ thống BRG --> Khách: Tự xác nhận, hiện QR ra cổng hoặc cho ra luôn
== Ra cổng nếu có bảo vệ ==
Khách -> Cổng ra: Đưa QR biên nhận
Cổng ra -> Hệ thống BRG: Quét QR
Hệ thống BRG --> Cổng ra: Cho qua hoặc cần kiểm tra
```

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
