---
title: Kết nối POS
summary: Cách bật chế độ thu tiền qua POS cho chi nhánh, tạo khoá API cho nhà cung cấp POS, thử, theo dõi và xử lý sự cố. Chỉ quản trị chuỗi xem.
group: he-thong
order: 40
access: chain
---

# Kết nối POS

> **Cách làm chính hiện nay là Giỏ QR cho POS.** Khách bấm thanh toán, điện thoại hiện một mã QR chứa mã vạch và số lượng từng mặt hàng. Thu ngân quét mã vào POS, POS tạo đơn, tính lại giá và thu tiền. POS không cần gọi API của BRG. Công tắc "Giỏ QR cho POS" ở trang Chi nhánh, bật sẵn cho mọi chi nhánh; tắt đi thì quay lại các luồng cũ bên dưới. Mỗi chi nhánh cần nhập **Mã điểm** (mục Tích hợp) để mã QR khớp với điểm bán trên POS. Đặc tả cho nhà cung cấp POS: `docs/api-qr-gio-hang.md`.

Ở chế độ này, **thu ngân quét mã giỏ hàng ngay trong phần mềm POS**. POS gọi API của BRG để lấy mặt hàng, tính tiền, thu tiền (QR, tiền mặt, thẻ), phát hành hoá đơn điện tử, rồi **báo thanh toán về BRG**. BRG tự xác nhận và cho khách ra. Nhà cung cấp POS làm phần gọi API theo tài liệu `docs/api-pos.md` của dự án.

```flow
title: Đưa một chi nhánh sang thu tiền qua POS
direction: down
a[Nhà cung cấp POS dựng xong phần gọi API]
b[Tạo khoá API cho POS ở mục Tích hợp]
c[Gửi nhà cung cấp: tài liệu API, địa chỉ API, khoá]
d[Chạy thử trên bản thử với Giả lập POS và POS thật]
e{Đúng hết các tình huống?}
f[Chuyển chi nhánh thí điểm sang Qua POS]
g[Theo dõi Đơn POS mỗi ngày, đối soát với POS]
h([Mở rộng các chi nhánh khác])
a --> b
b --> c
c --> d
d --> e
e -- Chưa --> d
e -- Đúng --> f
f --> g
g --> h
```

## Các bước

1. **Tạo khoá API** (Tích hợp, thẻ "POS gọi vào BRG", **Tạo khoá**): đặt tên theo phần mềm POS, chọn **một chi nhánh** (khoá chỉ dùng cho chi nhánh đó) hoặc **tất cả**. Khoá **chỉ hiện một lần**: chép ngay và gửi cho nhà cung cấp POS qua kênh an toàn. Khoá có giá trị như mật khẩu vì POS dùng nó để xác nhận thanh toán.
2. **Gửi nhà cung cấp POS:** tài liệu API (`docs/api-pos.md`), **địa chỉ API** (hiện sẵn trong thẻ, dạng `https://<tên miền>/api/pos/v1`), và khoá.
3. **Thử trên bản thử** (không thử trên máy chủ đang bán hàng thật):
   - Trong khối **Công cụ thử nghiệm**, dùng **Giả lập POS** để đóng vai POS: dán mã giỏ, nhận giỏ, báo thanh toán, báo huỷ. Nhờ đó xem trước khách và quản trị sẽ thấy gì.
   - Nhà cung cấp POS thử bằng POS thật, đối chiếu kết quả với Giả lập. Các tình huống cần thử: giá khác tạm tính, thanh toán bằng QR, tiền mặt, thẻ, huỷ trước và sau khi thanh toán, gọi lại cùng mã đơn, mất mạng giữa chừng, hoá đơn công ty.
4. **Chuyển chi nhánh sang "Qua POS"** (Chi nhánh và tính năng, cột "Thu tiền"). Điều kiện: đã có khoá API dùng được, và **không còn giỏ chờ thu** ở chi nhánh. Nên làm ngoài giờ bán hàng đông.
5. **Thí điểm một quầy**, theo dõi trang **Đơn POS** và so với báo cáo bán hàng của POS mỗi ngày trước khi mở rộng.

## Theo dõi hằng ngày

Trang **Đơn POS** (mỗi chi nhánh) hiện từng đơn và trạng thái. Chú ý:

- **Lệch tiền:** số POS khác tạm tính của BRG. Thường do khuyến mãi theo hoá đơn hoặc làm tròn; lệch lớn hoặc lặp lại thì báo nhà cung cấp POS.
- **Chờ lâu:** POS đã nhận giỏ nhưng quá 10 phút chưa báo kết quả. Hỏi thu ngân; nếu POS sập thì bấm **Nhả giỏ** (ghi lý do) để khách không bị kẹt.
- **Đã huỷ sau khi khách ra:** xác minh với POS.
- Thẻ "POS gọi vào BRG" ở mục Tích hợp hiện thống kê 24 giờ và lần dùng gần nhất của từng khoá. Khoá lâu không dùng ở chi nhánh đang chạy là dấu hiệu POS không gọi được.

## Khoá API

- **Thu hồi** ngay khi nghi lộ (nút Thu hồi): POS dùng khoá đó sẽ bị từ chối ngay. Tạo khoá mới và gửi lại cho nhà cung cấp.
- Mỗi nhà cung cấp hoặc mỗi chi nhánh một khoá riêng để thu hồi từng cái mà không ảnh hưởng nơi khác.
- Khoá chỉ nên nằm trên máy chủ hoặc dịch vụ trung gian của POS. Mọi lần tạo, thu hồi khoá đều ghi nhật ký.

## Khi POS gặp sự cố

| Tình huống | Việc cần làm |
|-----------|--------------|
| POS nhận giỏ, không báo kết quả, khách chờ | Quản lý **Nhả giỏ** ở Đơn POS (ghi lý do) |
| POS ngừng hoạt động lâu | Chuyển chi nhánh về **Tự thu trong BRG** (Chi nhánh và tính năng). Cần hết giỏ chờ thu: xử lý hoặc nhả các giỏ còn lại trước. Thu ngân dùng app nhân viên của BRG như quy trình thủ công. Khi POS ổn, chuyển lại |
| POS báo thanh toán cho đơn đã bị nhả giỏ | BRG từ chối. Đối soát tay: kiểm tra khách đã nhận hàng chưa, xử lý với thu ngân và POS |
| Nhà cung cấp POS đổi hệ thống | Tạo khoá mới, thử lại bằng Giả lập POS trước khi bật |

> **Lưu ý:** Ở chế độ POS, BRG tin thông báo của POS có khoá hợp lệ. Vì vậy **đối soát mỗi ngày giữa đơn BRG và báo cáo POS** và bảo mật khoá API là hai việc kiểm soát quan trọng nhất.

## Danh sách kiểm tra trước khi bật cho khách thật

- [ ] Nhà cung cấp POS đã thử đủ tình huống ở bản thử và được xác nhận
- [ ] Khoá API riêng cho chi nhánh, đã gửi qua kênh an toàn, không nằm trong ứng dụng ở thiết bị người dùng
- [ ] Máy chủ BRG dùng HTTPS hợp lệ (POS gọi qua Internet)
- [ ] Quản lý chi nhánh biết cách **Nhả giỏ** và biết số liên hệ của nhà cung cấp POS
- [ ] Đã quyết cách đối soát hằng ngày giữa BRG và POS và người phụ trách
- [ ] Đã quyết các mục "Điểm cần chốt" mức cao về POS (đơn bị bỏ quên, đối soát, lệch tiền)
