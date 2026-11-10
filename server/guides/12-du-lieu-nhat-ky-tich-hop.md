---
title: Dữ liệu, nhật ký và tích hợp
summary: Dữ liệu sản phẩm từ Dsmart POS, hóa đơn điện tử, nhật ký truy vết, sao lưu và các sự cố hệ thống thường gặp. Chỉ quản trị chuỗi xem.
group: he-thong
order: 30
access: chain
---

# Dữ liệu, nhật ký và tích hợp

## Link hóa đơn điện tử và link giao dịch

**Dsmart POS phát hành hóa đơn điện tử** và gửi link về cùng lúc báo thanh toán: link **hóa đơn điện tử** và link **chi tiết giao dịch** của khách. Bạn **không cần cấu hình gì** ở trang này. Từ đó hai nút **Xem hóa đơn điện tử** và **Xem chi tiết giao dịch** tự hiện ở: màn hình sau thanh toán, màn bill, đơn trong lịch sử, email bill và bill PDF. Giao dịch nào Dsmart POS chưa gửi link thì nút chưa hiện; khi Dsmart POS gửi bổ sung (hóa đơn phát hành chậm) nút tự xuất hiện.

Quản trị xem hai link trong **chi tiết giao dịch** (thẻ "Hóa đơn điện tử và giao dịch"). Link sai (không phải `https://`) bị bỏ qua nhưng vẫn ghi nhận thanh toán; nếu khách báo không thấy nút, hãy nhờ đơn vị Dsmart POS kiểm tra link họ gửi.

## Email gửi cho khách

Khách **không phải đăng nhập**. Hệ thống nhận ra khách bằng mã thiết bị lưu trong trình duyệt. Email dùng cho hai việc:

- **Bill:** khách để lại email ở màn mã QR (không bắt buộc). Khi Dsmart POS báo thanh toán, hệ thống gửi bill kèm PDF và link xem bill. Gửi lỗi thì tự thử lại tối đa 5 lần trong 24 giờ.
- **Xem lịch sử trên máy khác:** khách nhập email, nhận mã xác nhận 6 số, nhập mã để xem các đơn đã mua.

Cấu hình ở trang **Tích hợp**, thẻ **Email gửi cho khách** (chỉ quản trị chuỗi): máy chủ SMTP, cổng, kiểu bảo mật, tài khoản, mật khẩu, địa chỉ người gửi. Bấm **Lưu**, rồi **Gửi thử** tới email của bạn. Mật khẩu được mã hóa khi lưu và không hiện lại. Nên dùng một tài khoản email riêng chỉ để gửi thư tự động; với Gmail hoặc Microsoft 365 dùng mật khẩu ứng dụng. Muốn email có link xem bill trên web, đặt `PUBLIC_URL` trong file `.env` của máy chủ.

**Máy chủ email dùng chứng chỉ tự ký hoặc CA nội bộ (không có CA công cộng):** kiểu bảo mật (SSL/TLS cổng 465 hay STARTTLS) và cách kiểm tra chứng chỉ là hai lựa chọn **độc lập**. Chọn kiểu bảo mật theo máy chủ của bạn, rồi ở mục **Kiểm tra chứng chỉ của máy chủ email** chọn "Chứng chỉ tự ký hoặc CA nội bộ", chọn tệp chứng chỉ (`.crt`, `.pem`) của máy chủ email hoặc của CA nội bộ. Kết nối vẫn mã hóa và vẫn kiểm tra đúng máy chủ đó. Nếu tên trong chứng chỉ khác địa chỉ máy chủ (ví dụ bạn nhập địa chỉ IP), điền thêm **Tên máy chủ trong chứng chỉ**. Chỉ chọn "Không kiểm tra chứng chỉ" khi chưa có chứng chỉ để nạp, vì cách này kém an toàn. Khi Gửi thử lỗi, thông báo cho biết cần sửa gì (chứng chỉ tự ký, sai tên máy chủ, sai kiểu bảo mật, sai mật khẩu).

Chưa cấu hình email thì khách vẫn thanh toán và xem bill trong ứng dụng bình thường, chỉ không nhận được email.

## Dữ liệu sản phẩm từ Dsmart POS

- Giá, tồn kho, khuyến mãi, trạng thái bán đến từ **Dsmart POS** (nguồn gốc). BRG Scan & Checkout giữ một **bản sao** để quét nhanh và đồng bộ định kỳ.
- Khi khách khóa giỏ, hệ thống **hỏi lại Dsmart POS** giá và tồn kho hiện tại của từng mặt hàng, để chặn trường hợp giá đổi giữa lúc quét và lúc thanh toán.
- Mục **Tích hợp** hiện cho từng chi nhánh: lần đồng bộ gần nhất, **độ trễ**, **ngưỡng cảnh báo** (sửa được, tính bằng phút), số mã vạch không khớp. Quá ngưỡng thì Tổng quan hiện cảnh báo.
- Nút **Đồng bộ ngay** kéo dữ liệu mới ngay lập tức.

> **Lưu ý:** Khi chưa nối API giá theo chi nhánh, giá lấy từ **bảng giá nhập bằng file CSV** (lệnh `npm run import-products`) và không tự cập nhật. Khi nối API giá thật, quy trình trên giữ nguyên. Chi tiết kỹ thuật ở tài liệu dự án (docs/11).

## Hóa đơn điện tử

- Mỗi giao dịch thu tiền xong được xuất **hóa đơn bán lẻ** tự động. Khách xin **hóa đơn công ty** (trong ngày mua) thì hóa đơn công ty thay hóa đơn bán lẻ.
- Hóa đơn lỗi **không chặn** khách. Trạng thái **đang chờ**, hệ thống tự thử lại. Tổng quan hiện số hóa đơn treo; nút **Thử lại hóa đơn treo** ở mục Tích hợp.
- Giao dịch bị hủy làm hóa đơn chuyển sang **yêu cầu hủy**: cần xử lý với nhà cung cấp hóa đơn.

> **Lưu ý:** Ở chế độ Giỏ QR cho Dsmart POS, ứng dụng **không phát hành hóa đơn điện tử**. Dsmart POS phát hành và gửi link kèm khi báo thanh toán.

## Dsmart POS gọi vào BRG

Ở chi nhánh thu tiền qua Dsmart POS, **Dsmart POS gọi API của BRG** (không phải BRG gọi Dsmart POS): nhận giỏ khi thu ngân quét mã, báo thanh toán, báo hủy. Xem hướng dẫn "Kết nối Dsmart POS". Mục **Tích hợp** có thẻ "Dsmart POS gọi vào BRG": danh sách khóa API, thống kê 24 giờ (đã nhận giỏ, đã thanh toán, đã hủy, lệch tiền, đang chờ).

> **Lưu ý:** Dữ liệu sản phẩm (giá, tồn kho) vẫn do BRG **đọc từ Dsmart POS** theo cách ở trên; còn đơn hàng thì Dsmart POS **gọi vào BRG**. Hai chiều này độc lập.

## Nhật ký và truy vết

Mọi sự kiện quan trọng được ghi **không sửa xóa**: tạo và khóa giỏ, thu tiền, thu bổ sung, hóa đơn, quét ở cổng, kết quả kiểm tra, quyết định của quản lý, hủy giao dịch, thay đổi cấu hình, tài khoản, đăng nhập quản trị.

- **Nhật ký** (web quản trị): xem sự kiện gần đây theo chi nhánh, tên hành động bằng tiếng Việt.
- **Truy vết giao dịch:** dòng thời gian đầy đủ cho từng giao dịch (Giao dịch, chi tiết).
- Nhật ký quét ở cổng ghi cả lần **bị từ chối**.

> **Cần xác nhận:** Chưa có quy định thời gian lưu nhật ký và dữ liệu cá nhân (email khách). Xem "Điểm cần chốt".

## Sao lưu

- Dữ liệu nằm trong **một file cơ sở dữ liệu** trên máy chủ. Cần **sao lưu định kỳ** file này (ít nhất mỗi ngày) và thử khôi phục.
- Khóa ký (`APP_SECRET`) phải được giữ bí mật và sao lưu riêng. **Đổi khóa thì mọi QR biên nhận chưa dùng mất hiệu lực** và mọi người phải đăng nhập lại.
- Môi trường thật không dùng tài khoản và dữ liệu mẫu.

## Sự cố thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|-----------|------------------------|------------|
| Tổng quan báo Dsmart POS chậm | Kết nối Dsmart POS gián đoạn, ngưỡng đặt quá thấp | Kiểm tra kết nối Dsmart POS, bấm Đồng bộ ngay, xem lại ngưỡng |
| Khách báo giá khác giá ở quầy | Dữ liệu Dsmart POS vừa đổi | Hệ thống sẽ hỏi khách đồng ý giá mới khi khóa giỏ; kiểm tra độ trễ đồng bộ |
| Nhiều mã báo "chưa có trong hệ thống" | Thiếu dữ liệu sản phẩm ở Dsmart POS | Xem mục Mã không tìm thấy, báo bộ phận hàng hóa |
| Hóa đơn treo tăng | Nhà cung cấp hóa đơn lỗi hoặc mất kết nối | Thử lại, báo kế toán |
| Không bật được chi nhánh | Thiếu dữ liệu sản phẩm hoặc chưa có cách thanh toán dùng được | Đồng bộ Dsmart POS, bật tiền mặt hoặc nhập ngân hàng cho chuyển khoản |
| Khách không quét được mã QR cổng vào | Mã in mờ, trình duyệt trong app khác | In lại mã rõ nét, hướng dẫn mở bằng Safari hoặc Chrome |
| Camera không chạy | Trang không dùng HTTPS | Kiểm tra chứng chỉ HTTPS của máy chủ |
| Nhân viên không đăng nhập được | Sai PIN nhiều lần (khóa 15 phút) hoặc tài khoản bị khóa | Quản lý mở khóa, đặt lại PIN |
| Dsmart POS báo lỗi 401 khi gọi BRG | Khóa API sai, đã thu hồi hoặc hết hạn sử dụng | Tạo khóa mới, gửi lại cho nhà cung cấp Dsmart POS, thu hồi khóa cũ |
| Khách kẹt ở màn "đã vào máy tính tiền" | Dsmart POS nhận giỏ rồi không báo kết quả | Đơn Dsmart POS, **Nhả giỏ** kèm lý do |
| Nhiều đơn lệch tiền | Khuyến mãi theo hóa đơn của Dsmart POS hoặc giá hai bên lệch | Kiểm tra đồng bộ giá, hỏi nhà cung cấp Dsmart POS về quy tắc khuyến mãi |
