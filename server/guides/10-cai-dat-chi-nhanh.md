---
title: Cài đặt một chi nhánh mới
summary: Các bước đưa một chi nhánh vào dùng Scan & Checkout, từ tạo chi nhánh, đồng bộ dữ liệu, ngân hàng, nhân sự đến thử và bật.
group: he-thong
order: 10
access: chain
---

# Cài đặt một chi nhánh mới

Chỉ **quản trị chuỗi** thực hiện. Làm lần lượt các bước; hệ thống không cho bật chi nhánh nếu thiếu dữ liệu sản phẩm hoặc chưa có cách thanh toán dùng được.

```flow
title: Đưa một chi nhánh vào dùng
direction: down
a[Thêm chi nhánh, mã và tên]
b[Đồng bộ giá và tồn kho từ POS]
c[Nhập tài khoản ngân hàng nhận tiền, hoặc tạo khoá API cho POS]
d[Chọn cách thu tiền và có bảo vệ hay không]
e[Tạo tài khoản và xếp ca nhân viên]
f[Đặt tỷ lệ kiểm tra ngẫu nhiên]
g[In mã QR dán ở cổng vào]
h[Chạy thử trọn quy trình bằng giao dịch thật nhỏ]
i{Mọi bước đều đúng?}
j([Bật Scan & Checkout cho chi nhánh])
a --> b
b --> c
c --> d
d --> e
e --> f
f --> g
g --> h
h --> i
i -- Đúng --> j
i -- Còn lỗi --> b
```

## Các bước chi tiết

1. **Thêm chi nhánh** (Chi nhánh và tính năng, **Thêm chi nhánh**): nhập **mã** (1 đến 6 chữ hoa hoặc số, ví dụ `Q7`, không đổi được sau này vì nằm trong mã giỏ và mã QR) và **tên**. Chi nhánh mới ở trạng thái **tắt**.
2. **Đồng bộ dữ liệu sản phẩm** (Tích hợp, **Đồng bộ ngay**): cần có sản phẩm của chi nhánh trong hệ thống thì mới bật được. Kiểm tra độ trễ đồng bộ và số mã vạch không khớp.
3. **Tài khoản ngân hàng nhận tiền** (chỉ cần khi tự thu bằng chuyển khoản; Tích hợp, thẻ Chuyển khoản QR): nhập **mã ngân hàng (BIN, 6 chữ số)**, tên ngân hàng, **số tài khoản**, chủ tài khoản. Sai thông tin này thì khách chuyển nhầm tài khoản, nên kiểm tra kỹ và chuyển thử một khoản nhỏ.
4. **Chọn cách thu tiền** (cột "Thu tiền"):
   - **Tự thu trong BRG:** bật Tiền mặt và/hoặc Chuyển khoản QR. Cột Online đang khoá, ghi "Sắp có".
   - **Qua POS:** cần đã tạo **khoá API cho POS** (mục Tích hợp, thẻ "POS gọi vào BRG") và không còn giỏ chờ thu ở chi nhánh. Gửi nhà cung cấp POS tài liệu API, địa chỉ API và khoá. Khi chuyển sang POS, hai công tắc Tiền mặt, Chuyển khoản QR mờ đi vì không dùng.
5. **Chọn có bảo vệ ở cổng ra hay không** (cột "Bảo vệ cổng ra"): chi nhánh không có người ở cổng thì **tắt**. Khi tắt: không có QR ra cổng, không kiểm tra ngẫu nhiên, thanh toán xong khách ra luôn. Cân nhắc biện pháp bù (xem hướng dẫn "Điểm cần chốt").
6. **Tạo tài khoản nhân viên** (Tài khoản và phân quyền): gán đúng vai trò và chi nhánh, đặt PIN 4 đến 6 chữ số. Đảm bảo có người làm thu ngân và người làm cổng ra. **Xếp ca** (Nhân viên và ca) và xử lý các cảnh báo thiếu người.
7. **Đặt tỷ lệ kiểm tra ngẫu nhiên** (bỏ qua nếu tắt bảo vệ) (Kiểm tra ngẫu nhiên). Khi thí điểm nên đặt cao.
8. **In mã QR dán ở cổng vào** (Chi nhánh và tính năng, **Mã QR dán cổng vào**): hiện QR của đường dẫn `.../c/?s=<MÃ>` kèm nút sao chép link và nút in. Dán ở cổng vào, nơi khách dễ quét.
9. **Chạy thử trọn quy trình:** dùng điện thoại thật quét vài món, khoá giỏ, thu bằng tiền mặt và bằng chuyển khoản (số tiền nhỏ), quét QR ở cổng, thử một lần kiểm tra ngẫu nhiên, kết thúc ca và đối soát. Dùng chi nhánh còn **tắt** thì khách thật chưa vào được; khi thử, bật chi nhánh trong giờ thử rồi tắt lại nếu chưa sẵn sàng.
10. **Bật Scan & Checkout** cho chi nhánh. Từ lúc này khách quét mã QR cổng vào là mua sắm được.

> **Lưu ý:** Tắt một chi nhánh bất kỳ lúc nào (ví dụ khi sự cố) không ảnh hưởng chi nhánh khác. Khách mở link của chi nhánh đang tắt sẽ thấy thông báo "Chi nhánh này chưa có Scan & Checkout".

## Lộ trình bật dần

Theo kế hoạch: bật thí điểm **2 đến 3 chi nhánh**, theo dõi chênh lệch, đối soát, phản hồi khách trong vài tuần, rồi nhân rộng bằng cùng cờ cấu hình, không cần lập trình lại.

## Danh sách kiểm tra trước khi bật

- [ ] Dữ liệu sản phẩm đã đồng bộ, không có cảnh báo POS chậm
- [ ] Tài khoản ngân hàng đúng, đã thử chuyển thật
- [ ] Có thu ngân và cổng ra cho mọi ca dự kiến
- [ ] Nhân viên đã được hướng dẫn quy trình thu tiền và kiểm tra
- [ ] Mã QR cổng vào đã dán, đã quét thử bằng nhiều dòng điện thoại
- [ ] Quy trình dự phòng (quầy thường) đã thông báo cho nhân viên
- [ ] Các mục "Điểm cần chốt" mức cao đã có quyết định
