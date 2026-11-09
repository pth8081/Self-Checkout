---
title: Dữ liệu, nhật ký và tích hợp
summary: Dữ liệu sản phẩm từ Dsmart POS, hoá đơn điện tử, nhật ký truy vết, sao lưu và các sự cố hệ thống thường gặp. Chỉ quản trị chuỗi xem.
group: he-thong
order: 30
access: chain
---

# Dữ liệu, nhật ký và tích hợp

## Link khai báo hoá đơn điện tử

Lúc thanh toán **chưa có hoá đơn điện tử và chưa có số hoá đơn**. Khách tự khai báo thông tin xuất hoá đơn trên trang của **nhà cung cấp hoá đơn điện tử**, không nhập trong ứng dụng này. Bạn cấu hình link đó một lần ở trang **Tích hợp**, thẻ **Link khai báo hoá đơn điện tử** (chỉ quản trị chuỗi). Từ đó nút **Khai báo hoá đơn điện tử** tự hiện ở: màn hình sau thanh toán, màn bill, đơn trong lịch sử, email bill và bill PDF, và mở đúng link bạn nhập. Để trống link thì nút không hiện.

Link phải bắt đầu bằng `https://`. Nếu trang nhà cung cấp cần mã tra cứu, chèn các ký hiệu sau, hệ thống thay bằng thông tin của từng giao dịch: `{code}` mã giỏ hàng, `{posOrderRef}` mã đơn (mã bill) trên Dsmart POS, `{amount}` tổng tiền, `{storeCode}` mã chi nhánh, `{posCode}` mã điểm. Ví dụ `https://hoadon.nhacungcap.vn/khai-bao?ma={code}&so={posOrderRef}`. Trang hiện ví dụ link thật để bạn bấm thử trước khi lưu.

## Email gửi cho khách

Khách **không phải đăng nhập**. Hệ thống nhận ra khách bằng mã thiết bị lưu trong trình duyệt. Email dùng cho hai việc:

- **Bill:** khách để lại email ở màn mã QR (không bắt buộc). Khi Dsmart POS báo thanh toán, hệ thống gửi bill kèm PDF và link xem bill. Gửi lỗi thì tự thử lại tối đa 5 lần trong 24 giờ.
- **Xem lịch sử trên máy khác:** khách nhập email, nhận mã xác nhận 6 số, nhập mã để xem các đơn đã mua.

Cấu hình ở trang **Tích hợp**, thẻ **Email gửi cho khách** (chỉ quản trị chuỗi): máy chủ SMTP, cổng, kiểu bảo mật, tài khoản, mật khẩu, địa chỉ người gửi. Bấm **Lưu**, rồi **Gửi thử** tới email của bạn. Mật khẩu được mã hoá khi lưu và không hiện lại. Nên dùng một tài khoản email riêng chỉ để gửi thư tự động; với Gmail hoặc Microsoft 365 dùng mật khẩu ứng dụng. Muốn email có link xem bill trên web, đặt `PUBLIC_URL` trong file `.env` của máy chủ.

**Máy chủ email dùng chứng chỉ tự ký hoặc CA nội bộ (không có CA công cộng):** kiểu bảo mật (SSL/TLS cổng 465 hay STARTTLS) và cách kiểm tra chứng chỉ là hai lựa chọn **độc lập**. Chọn kiểu bảo mật theo máy chủ của bạn, rồi ở mục **Kiểm tra chứng chỉ của máy chủ email** chọn "Chứng chỉ tự ký hoặc CA nội bộ", chọn tệp chứng chỉ (`.crt`, `.pem`) của máy chủ email hoặc của CA nội bộ. Kết nối vẫn mã hoá và vẫn kiểm tra đúng máy chủ đó. Nếu tên trong chứng chỉ khác địa chỉ máy chủ (ví dụ bạn nhập địa chỉ IP), điền thêm **Tên máy chủ trong chứng chỉ**. Chỉ chọn "Không kiểm tra chứng chỉ" khi chưa có chứng chỉ để nạp, vì cách này kém an toàn. Khi Gửi thử lỗi, thông báo cho biết cần sửa gì (chứng chỉ tự ký, sai tên máy chủ, sai kiểu bảo mật, sai mật khẩu).

Chưa cấu hình email thì khách vẫn thanh toán và xem bill trong ứng dụng bình thường, chỉ không nhận được email.

## Dữ liệu sản phẩm từ Dsmart POS

- Giá, tồn kho, khuyến mãi, trạng thái bán đến từ **Dsmart POS** (nguồn gốc). BRG Scan & Checkout giữ một **bản sao** để quét nhanh và đồng bộ định kỳ.
- Khi khách khoá giỏ, hệ thống **hỏi lại Dsmart POS** giá và tồn kho hiện tại của từng mặt hàng, để chặn trường hợp giá đổi giữa lúc quét và lúc thanh toán.
- Mục **Tích hợp** hiện cho từng chi nhánh: lần đồng bộ gần nhất, **độ trễ**, **ngưỡng cảnh báo** (sửa được, tính bằng phút), số mã vạch không khớp. Quá ngưỡng thì Tổng quan hiện cảnh báo.
- Nút **Đồng bộ ngay** kéo dữ liệu mới ngay lập tức.

> **Lưu ý:** Khi chưa nối API giá theo chi nhánh, giá lấy từ **bảng giá nhập bằng file CSV** (lệnh `npm run import-products`) và không tự cập nhật. Khi nối API giá thật, quy trình trên giữ nguyên. Chi tiết kỹ thuật ở tài liệu dự án (docs/11).

## Hoá đơn điện tử

- Mỗi giao dịch thu tiền xong được xuất **hoá đơn bán lẻ** tự động. Khách xin **hoá đơn công ty** (trong ngày mua) thì hoá đơn công ty thay hoá đơn bán lẻ.
- Hoá đơn lỗi **không chặn** khách. Trạng thái **đang chờ**, hệ thống tự thử lại. Tổng quan hiện số hoá đơn treo; nút **Thử lại hoá đơn treo** ở mục Tích hợp.
- Giao dịch bị huỷ làm hoá đơn chuyển sang **yêu cầu huỷ**: cần xử lý với nhà cung cấp hoá đơn.

> **Lưu ý:** Ở chế độ Giỏ QR cho Dsmart POS, ứng dụng **không phát hành hoá đơn điện tử**. Dsmart POS và nhà cung cấp hoá đơn phát hành; khách khai báo ở link bạn cấu hình ở trang Tích hợp.

## Dsmart POS gọi vào BRG

Ở chi nhánh thu tiền qua Dsmart POS, **Dsmart POS gọi API của BRG** (không phải BRG gọi Dsmart POS): nhận giỏ khi thu ngân quét mã, báo thanh toán, báo huỷ. Xem hướng dẫn "Kết nối Dsmart POS". Mục **Tích hợp** có thẻ "Dsmart POS gọi vào BRG": danh sách khoá API, thống kê 24 giờ (đã nhận giỏ, đã thanh toán, đã huỷ, lệch tiền, đang chờ).

> **Lưu ý:** Dữ liệu sản phẩm (giá, tồn kho) vẫn do BRG **đọc từ Dsmart POS** theo cách ở trên; còn đơn hàng thì Dsmart POS **gọi vào BRG**. Hai chiều này độc lập.

## Nhật ký và truy vết

Mọi sự kiện quan trọng được ghi **không sửa xoá**: tạo và khoá giỏ, thu tiền, thu bổ sung, hoá đơn, quét ở cổng, kết quả kiểm tra, quyết định của quản lý, huỷ giao dịch, thay đổi cấu hình, tài khoản, đăng nhập quản trị.

- **Nhật ký** (web quản trị): xem sự kiện gần đây theo chi nhánh, tên hành động bằng tiếng Việt.
- **Truy vết giao dịch:** dòng thời gian đầy đủ cho từng giao dịch (Giao dịch, chi tiết).
- Nhật ký quét ở cổng ghi cả lần **bị từ chối**.

> **Cần xác nhận:** Chưa có quy định thời gian lưu nhật ký và dữ liệu cá nhân (email khách). Xem "Điểm cần chốt".

## Sao lưu

- Dữ liệu nằm trong **một file cơ sở dữ liệu** trên máy chủ. Cần **sao lưu định kỳ** file này (ít nhất mỗi ngày) và thử khôi phục.
- Khoá ký (`APP_SECRET`) phải được giữ bí mật và sao lưu riêng. **Đổi khoá thì mọi QR biên nhận chưa dùng mất hiệu lực** và mọi người phải đăng nhập lại.
- Môi trường thật không dùng tài khoản và dữ liệu mẫu.

## Sự cố thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|-----------|------------------------|------------|
| Tổng quan báo Dsmart POS chậm | Kết nối Dsmart POS gián đoạn, ngưỡng đặt quá thấp | Kiểm tra kết nối Dsmart POS, bấm Đồng bộ ngay, xem lại ngưỡng |
| Khách báo giá khác giá ở quầy | Dữ liệu Dsmart POS vừa đổi | Hệ thống sẽ hỏi khách đồng ý giá mới khi khoá giỏ; kiểm tra độ trễ đồng bộ |
| Nhiều mã báo "chưa có trong hệ thống" | Thiếu dữ liệu sản phẩm ở Dsmart POS | Xem mục Mã không tìm thấy, báo bộ phận hàng hoá |
| Hoá đơn treo tăng | Nhà cung cấp hoá đơn lỗi hoặc mất kết nối | Thử lại, báo kế toán |
| Không bật được chi nhánh | Thiếu dữ liệu sản phẩm hoặc chưa có cách thanh toán dùng được | Đồng bộ Dsmart POS, bật tiền mặt hoặc nhập ngân hàng cho chuyển khoản |
| Khách không quét được mã QR cổng vào | Mã in mờ, trình duyệt trong app khác | In lại mã rõ nét, hướng dẫn mở bằng Safari hoặc Chrome |
| Camera không chạy | Trang không dùng HTTPS | Kiểm tra chứng chỉ HTTPS của máy chủ |
| Nhân viên không đăng nhập được | Sai PIN nhiều lần (khoá 15 phút) hoặc tài khoản bị khoá | Quản lý mở khoá, đặt lại PIN |
| Dsmart POS báo lỗi 401 khi gọi BRG | Khoá API sai, đã thu hồi hoặc hết hạn sử dụng | Tạo khoá mới, gửi lại cho nhà cung cấp Dsmart POS, thu hồi khoá cũ |
| Khách kẹt ở màn "đã vào máy tính tiền" | Dsmart POS nhận giỏ rồi không báo kết quả | Đơn Dsmart POS, **Nhả giỏ** kèm lý do |
| Nhiều đơn lệch tiền | Khuyến mãi theo hoá đơn của Dsmart POS hoặc giá hai bên lệch | Kiểm tra đồng bộ giá, hỏi nhà cung cấp Dsmart POS về quy tắc khuyến mãi |
