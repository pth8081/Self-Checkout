---
title: Quy trình thanh toán
summary: Khoá giỏ, thu tiền mặt, thu chuyển khoản QR, đổi cách trả, xử lý chuyển khoản sai và hoá đơn điện tử.
group: nghiep-vu
order: 30
access: all
---

# Quy trình thanh toán tại quầy

Ở giai đoạn 1, khách **không tự thanh toán trên điện thoại**. Khách chọn cách trả, nhận mã giỏ hàng, đến **quầy Self Checkout**, và **thu ngân xác nhận** đã thu. Chỉ sau xác nhận đó khách mới có QR để ra cổng.

## Các bước chung

1. Khách bấm **Thanh toán** trong giỏ, chọn **Tiền mặt tại quầy** hoặc **Chuyển khoản QR**, bấm **Tiếp tục**.
2. Hệ thống kiểm tra lại giá, khuyến mãi, tồn kho với POS (khách đồng ý nếu có thay đổi), **khoá giỏ** và sinh:
   - **Mã giỏ hàng** dạng `GH-Q7-10003` (hiện cả dạng QR).
   - **Nội dung chuyển khoản** dạng `SG Q7 10003` (dùng khi trả bằng chuyển khoản).
3. Khách đến quầy, đưa **mã giỏ hàng** cho thu ngân.
4. Thu ngân quét mã (hoặc nhập tay, hoặc chọn trong **hàng đợi**), kiểm tra giỏ, thu tiền, bấm xác nhận.
5. Màn hình khách **tự chuyển** sang **QR biên nhận**. Hệ thống tự xuất hoá đơn điện tử bán lẻ.

## Trả tiền mặt

```seq
title: Thanh toán tiền mặt
actors: Khách | Thu ngân | Hệ thống
Khách -> Thu ngân: Đưa mã giỏ hàng
Thu ngân -> Hệ thống: Quét mã, mở giỏ
Hệ thống --> Thu ngân: Danh sách món, tổng cần thu
Khách -> Thu ngân: Đưa tiền mặt
Thu ngân -> Thu ngân: Nhập số khách đưa, xem tiền thừa
Thu ngân -> Khách: Trả tiền thừa
Thu ngân -> Hệ thống: Bấm Đã thu tiền
Hệ thống --> Khách: Hiện QR biên nhận
Hệ thống -> Hệ thống: Ghi người thu, giờ, xuất hoá đơn
```

- Thu ngân nhập **số tiền khách đưa**. Hệ thống tính **tiền thừa**. Không cho xác nhận khi khách đưa chưa đủ.
- Số tiền mặt ghi nhận là **số cần thu** (không phải số khách đưa), và được cộng vào tiền mặt hệ thống của ca.

## Trả chuyển khoản QR

```seq
title: Thanh toán chuyển khoản QR
actors: Khách | Thu ngân | Ngân hàng | Hệ thống
Khách -> Hệ thống: Chọn chuyển khoản
Hệ thống --> Khách: QR có sẵn số tiền và nội dung
Khách -> Ngân hàng: Quét QR bằng app ngân hàng, chuyển
Khách -> Thu ngân: Đưa mã giỏ hàng
Thu ngân -> Hệ thống: Quét mã, mở giỏ
Thu ngân -> Ngân hàng: Xem thông báo tiền vào
Thu ngân -> Thu ngân: Đối chiếu số tiền, nội dung, tiền đã vào
Thu ngân -> Hệ thống: Tick đủ 3 ô, bấm xác nhận
Hệ thống --> Khách: Hiện QR biên nhận
```

QR chuyển khoản do ứng dụng tự tạo, đã điền sẵn **số tài khoản nhận, số tiền và nội dung**. Khách quét bằng app ngân hàng bất kỳ và giữ nguyên số tiền, nội dung.

### Ba điều kiện bắt buộc trước khi xác nhận

Nút xác nhận chỉ bấm được khi thu ngân đã tick cả ba:

1. **Số tiền đúng:** khớp đúng số cần thu hiển thị.
2. **Nội dung đúng mã giao dịch:** nội dung chuyển khoản chứa mã `SG ...` của giỏ này.
3. **Tiền đã vào tài khoản của công ty:** thấy trong app ngân hàng hoặc thông báo của ngân hàng, **không** dựa vào ảnh chụp màn hình trên điện thoại khách.

> **Quan trọng:** Ảnh chụp màn hình chuyển khoản rất dễ làm giả. Chỉ xác nhận khi chính thu ngân thấy tiền đã vào tài khoản công ty.

## Đổi cách thanh toán

- **Khách đổi:** ở màn chờ, chọn **Đổi cách thanh toán**. Giỏ được mở khoá, khách chọn lại. Mã giỏ hàng cũ mất hiệu lực, có mã mới khi khoá lại.
- **Thu ngân đổi:** khi mở giỏ, thu ngân chọn lại Tiền mặt hoặc Chuyển khoản trước khi xác nhận (ví dụ khách định chuyển khoản nhưng đổi sang tiền mặt).

## Khi chuyển khoản có vấn đề

```flow
title: Xử lý khi thu ngân chưa thấy khoản chuyển đúng
direction: down
a[Khách nói đã chuyển khoản]
b{Thu ngân thấy tiền vào tài khoản?}
c{Số tiền và nội dung đúng?}
d([Tick đủ 3 ô, xác nhận])
e[Đợi một lúc, kiểm tra lại, cho khách xem lại QR]
f{Vẫn chưa thấy tiền?}
g[Đề nghị trả tiền mặt hoặc để quản lý xử lý]
h[Xử lý theo từng trường hợp bên dưới]
a --> b
b -- Có --> c
b -- Chưa --> e
c -- Đúng --> d
c -- Sai --> h
e --> f
f -- Đã thấy --> c
f -- Vẫn chưa --> g
```

| Tình huống | Cách xử lý đề xuất | Ghi chú |
|-----------|--------------------|---------|
| Chưa thấy tiền vào | Chờ ngắn, kiểm tra lại. Không xác nhận. Nếu vẫn chưa thấy, khách trả tiền mặt hoặc để quản lý xử lý | Có thể do chậm báo của ngân hàng |
| Chuyển **thiếu** tiền | Không xác nhận. Khách chuyển bù phần thiếu rồi thu ngân kiểm tra tổng, hoặc trả phần còn lại bằng tiền mặt | Cần chốt cách ghi nhận thanh toán gộp (xem Điểm cần chốt) |
| Chuyển **dư** tiền | Hoàn lại phần dư cho khách ngoài hệ thống, báo quản lý ghi nhận | Ứng dụng chưa có chức năng hoàn tiền |
| **Sai nội dung** hoặc quên nội dung | Không tick "nội dung đúng". Báo quản lý đối chiếu (tên người chuyển, số tiền, giờ) rồi quyết định | Cần chốt quy định |
| Chuyển nhầm tài khoản khác | Không xác nhận. Hướng dẫn khách tự liên hệ ngân hàng | Công ty không nhận được tiền |

> **Cần xác nhận:** Các cách xử lý chuyển khoản sai ở trên là đề xuất, chưa có chính sách chính thức. Xem mục "Điểm cần chốt".

## Thu bổ sung

Khi kiểm tra ngẫu nhiên phát hiện khách còn hàng chưa quét, nhân viên ghi **chênh lệch** và chọn **thu bổ sung**. Khoản này:

- Nếu ghi **trước** khi thu tiền (kiểm tra tại quầy): được **cộng vào số cần thu** trong cùng một lần thanh toán.
- Nếu ghi **sau** khi đã thu (kiểm tra ở cổng): thu ngân thu thêm riêng, bằng tiền mặt hoặc chuyển khoản, rồi nhân viên cổng quét lại QR để cho qua.

Xem thêm "Cổng ra và kiểm tra ngẫu nhiên".

## Hoá đơn điện tử

- Khi thu tiền xong, hệ thống **tự xuất hoá đơn bán lẻ** cho giao dịch (không cần khách làm gì).
- Khách có thể **nhập email** để nhận hoá đơn, hoặc **xin hoá đơn công ty** (mã số thuế, tên, địa chỉ, email). Hoá đơn công ty **thay thế** hoá đơn bán lẻ và **chỉ xuất được trong ngày** phát sinh giao dịch.
- Nếu nhà cung cấp hoá đơn lỗi, giao dịch **vẫn hoàn tất**, khách vẫn ra cổng. Hoá đơn ở trạng thái **đang chờ**, hệ thống tự thử lại khoảng 2 phút một lần, quản trị có nút **Thử lại hoá đơn treo**.

> **Lưu ý:** Hiện hoá đơn điện tử chạy bản giả lập. Khi nối nhà cung cấp thật, cần chốt: POS hay BRG Self Checkout là bên xuất hoá đơn, để không xuất trùng.

## Các trạng thái và nơi xem

| Việc cần xem | Ở đâu |
|--------------|-------|
| Giỏ nào đang chờ thu | App nhân viên, mục Hàng đợi |
| Một giao dịch đã đi qua những bước nào, ai làm | Web quản trị, Giao dịch, chi tiết giao dịch |
| Tiền mặt và chuyển khoản trong ngày | Web quản trị, Hôm nay và Đối soát |
