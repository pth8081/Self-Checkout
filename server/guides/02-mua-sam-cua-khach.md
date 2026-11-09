---
title: Quy trình mua sắm của khách
summary: Từng bước khách vào cửa hàng, quét mặt hàng, xem giỏ, xử lý lỗi và khoá giỏ để thanh toán.
group: nghiep-vu
order: 20
access: all
---

# Quy trình mua sắm của khách

> **Bước thanh toán hiện nay:** khách bấm **Thanh toán** là thấy ngay mã QR để đưa thu ngân (không chọn cách trả, không nhập thông tin). Có thể **Sửa giỏ hàng** để quét thêm, mã QR cũ sẽ không còn dùng. Sau khi Dsmart POS báo xong, màn hình hiện "Đã hoàn thành thanh toán" kèm **Xem bill** và **Tải bill PDF**; bill xem lại được ở Lịch sử. Nếu Dsmart POS chậm báo, khách bấm "Đã thanh toán xong" để kết thúc.

## Các bước

1. **Vào cửa hàng.** Khách dùng camera điện thoại quét **mã QR dán ở cổng vào** (đường dẫn dạng `/c/?s=Q7`). Ứng dụng tự nhận ra chi nhánh, khách không phải chọn. Không cần cài ứng dụng.
2. **Bắt đầu mua sắm.** Lần đầu có màn hướng dẫn 3 bước (bỏ qua được) và màn xin quyền camera. Camera chỉ dùng để đọc mã vạch, không chụp và không lưu ảnh.
3. **Quét từng mặt hàng.** Đưa mã vạch vào khung. Mỗi lần quét thành công hiện thẻ "Đã thêm vào giỏ" với tên, giá, số lượng và tổng giỏ. Khách chỉnh số lượng ngay trên thẻ.
4. **Nhập mã tay** khi mã mờ, nhàu hoặc camera không đọc được: gõ dãy số dưới mã vạch, thấy sản phẩm rồi mới thêm.
5. **Kiểm tra giỏ hàng.** Xem tên, giá, số lượng, khuyến mãi, tổng. Tăng giảm số lượng, bỏ mặt hàng.
6. **Chọn cách thanh toán** (tiền mặt hoặc chuyển khoản QR) và khoá giỏ. Từ đây hệ thống tạo **mã giỏ hàng** để đưa cho thu ngân.

## Khi quét một mã vạch

```flow
title: Điều gì xảy ra khi khách quét một mã
direction: down
a[Khách quét một mã]
b{Mã đọc đúng?}
c{Có trong hệ thống?}
d{Đang bán và còn hàng?}
e([Thêm vào giỏ, cập nhật tổng])
f[Báo: không đọc được, quét lại]
g[Báo: chưa có trong hệ thống, ghi vào danh sách mã lạ]
h[Báo: ngừng bán]
a --> b
b -- Có --> c
b -- Không --> f
c -- Có --> d
c -- Không --> g
d -- Có --> e
d -- Không --> h
f --> a
g --> a
h --> a
```

- **Không đọc được:** mã sai chữ số kiểm tra. Khách quét lại hoặc nhập tay.
- **Chưa có trong hệ thống:** sản phẩm không có ở Dsmart POS của chi nhánh. Mã được ghi vào mục **Mã không tìm thấy** của quản trị để bộ phận hàng hoá xử lý. Khách được hướng dẫn gọi nhân viên.
- **Ngừng bán:** không thêm vào giỏ. Tồn kho không bị kiểm tra, Dsmart POS xử lý khi thu ngân quét giỏ.
- **Vượt tồn kho:** không cho tăng số lượng quá tồn kho hiện có.

## Giá thay đổi trước khi khoá giỏ

Lúc bấm thanh toán, hệ thống hỏi lại Dsmart POS giá, khuyến mãi và tồn kho của từng mặt hàng. Nếu có khác biệt, khách thấy màn **"Có thay đổi trong giỏ hàng"** liệt kê mặt hàng nào đổi giá, còn bao nhiêu, hoặc bị bỏ vì ngừng bán. Khách phải **đồng ý** mới khoá được giỏ, hoặc quay lại giỏ để xem.

> **Quan trọng:** Đây là cách tránh tranh chấp "giá trên điện thoại khác giá ở quầy". Tổng tiền cuối cùng luôn là tổng đã khách đồng ý.

## Mất mạng khi đang mua sắm

```seq
title: Khách mất mạng giữa chừng
actors: Khách | Ứng dụng | Máy chủ
Khách -> Ứng dụng: Quét mặt hàng
Ứng dụng -> Máy chủ: Gửi thao tác
Máy chủ --> Ứng dụng: Tên, giá
== Mất mạng ==
Khách -> Ứng dụng: Quét tiếp
Ứng dụng -> Ứng dụng: Lưu thao tác trên máy
Ứng dụng --> Khách: Đã lưu trên máy, chờ đồng bộ
== Có mạng lại ==
Ứng dụng -> Máy chủ: Gửi lại các thao tác theo thứ tự
Máy chủ --> Ứng dụng: Kết quả từng mặt hàng
```

- Giỏ hàng lưu **trên điện thoại**, không mất khi mất mạng hoặc tải lại trang.
- Mặt hàng quét lúc mất mạng hiện là "chờ đồng bộ" (chưa có tên và giá), tự cập nhật khi có mạng.
- **Thanh toán cần có mạng.** Nút thanh toán bị khoá khi mất mạng.
- Gửi lại thao tác không bị tính trùng.

## Giỏ hàng dang dở

Nếu khách tải lại trang hoặc quay lại sau một lúc, ứng dụng nhận ra giỏ cũ (trong **6 giờ** kể từ thao tác cuối) và hỏi: **tiếp tục mua sắm** hay **bắt đầu giỏ mới**. Chọn giỏ mới sẽ bỏ giỏ cũ.

## Hàng giới hạn độ tuổi

Rượu, bia, thuốc lá được đánh dấu giới hạn độ tuổi theo dữ liệu Dsmart POS. Khách vẫn quét được; giỏ hiện lưu ý, và **thu ngân phải kiểm tra giấy tờ** trước khi thu tiền (ứng dụng thu ngân hiện cảnh báo).

> **Cần xác nhận:** Hiện ứng dụng chỉ cảnh báo, chưa ghi lại việc thu ngân đã kiểm tra giấy tờ. Xem mục "Điểm cần chốt".

## Quy tắc quan trọng cho khách và nhân viên hỗ trợ

- Mỗi điện thoại có một giỏ đang mở cho mỗi chi nhánh.
- Khi giỏ đã khoá, khách **không sửa được** giỏ nữa. Muốn sửa, chọn "Quay lại sửa giỏ hàng" (giỏ mở lại, mã giỏ cũ mất hiệu lực, sẽ có mã mới khi khoá lại).
- Trình duyệt trong Zalo, Facebook thường chặn camera. Ứng dụng nhận ra và hướng dẫn mở bằng Safari hoặc Chrome.
