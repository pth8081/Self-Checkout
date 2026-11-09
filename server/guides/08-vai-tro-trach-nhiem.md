---
title: Vai trò và trách nhiệm
summary: Ai được làm gì trong hệ thống, ai chịu trách nhiệm cho từng bước kiểm soát và nguyên tắc tách biệt nhiệm vụ.
group: nghiep-vu
order: 80
access: all
---

# Vai trò và trách nhiệm

> **Luồng hiện hành là "Giỏ QR cho DS Smart POS"** (bật sẵn cho mọi chi nhánh): khách quét mặt hàng, bấm Thanh toán, điện thoại hiện mã QR chứa mã vạch và số lượng; thu ngân quét mã vào DS Smart POS, DS Smart POS tạo đơn, tính tiền và báo thanh toán về BRG. Không còn bước thu tiền trong BRG, cổng ra và kiểm tra ngẫu nhiên. Nội dung dưới đây mô tả **luồng cũ**, hiện bị khoá và chỉ dùng khi quản trị chuỗi tắt công tắc "Giỏ QR cho DS Smart POS" ở trang Chi nhánh. Xem thêm bài "Kết nối DS Smart POS".

## Ai làm được gì

| Việc | Khách | Thu ngân | Cổng ra | Quản lý chi nhánh | Quản trị chuỗi |
|------|:----:|:--------:|:-------:|:-----------------:|:--------------:|
| Quét mặt hàng, khoá giỏ, xem lịch sử của mình | ✓ | | | | |
| Thu tiền, xác nhận chuyển khoản | | ✓ | | | |
| Huỷ giỏ chờ thu | | ✓ | | | |
| Quét QR ra cổng, kiểm tra ngẫu nhiên, ghi chênh lệch | | | ✓ | | |
| Cho qua hoặc từ chối ca bị giữ | | | | ✓ | ✓ |
| Huỷ giao dịch đã thu | | | | ✓ | ✓ |
| Xem báo cáo, giao dịch, đối soát của chi nhánh | | | | ✓ | ✓ |
| Xếp ca, tài khoản nhân viên chi nhánh | | | | ✓ | ✓ |
| Đặt tỷ lệ kiểm tra ngẫu nhiên | | | | ✓ | ✓ |
| Bật hoặc tắt chi nhánh và cách thanh toán | | | | | ✓ |
| Cấu hình ngân hàng nhận tiền, tích hợp | | | | | ✓ |
| Báo cáo toàn chuỗi, tạo quản trị viên | | | | | ✓ |

Nhân viên có vai trò **thu ngân + cổng ra** làm được cả hai cột.

Ở chi nhánh **thu tiền qua DS Smart POS**, công việc của thu ngân diễn ra trên **DS Smart POS** (do nhà cung cấp DS Smart POS phân quyền), không phải trong BRG; app nhân viên của BRG chỉ còn việc ở cổng ra và của quản lý. Ở chi nhánh **không có bảo vệ**, không có việc ở cổng ra. Chỉ **quản trị chuỗi** đổi được cách thu tiền, bật hoặc tắt bước bảo vệ, tạo và thu hồi **khoá API cho DS Smart POS**. Khoá API cho phép DS Smart POS xác nhận thanh toán thay thu ngân, nên **giữ bí mật như mật khẩu** và thu hồi ngay khi nghi lộ. Quản lý đăng nhập app nhân viên bằng PIN cũng làm được các việc của thu ngân, cổng ra và quản lý.

## Tách biệt nhiệm vụ

Các nguyên tắc kiểm soát nội bộ mà ứng dụng hỗ trợ:

- **Người thu tiền không phải người huỷ.** Thu ngân thu và xác nhận; chỉ quản lý huỷ giao dịch đã thu.
- **Người kiểm tra không phải người thu** (khi có đủ người): nhân viên cổng ra kiểm tra hàng, thu ngân thu tiền.
- **Người đối soát không phải người thu.** Quản lý đối soát tiền mặt và chuyển khoản, không phải thu ngân tự đối soát cho mình.
- **Kiểm tra ngẫu nhiên do hệ thống chọn**, không ai chọn hoặc bỏ qua được.
- **Mọi thao tác có tên người làm** (mã nhân viên), giờ, và được ghi nhật ký không sửa xoá.

> **Cần xác nhận:** Với chi nhánh ít người (một nhân viên vừa thu vừa kiểm tra), nguyên tắc "người kiểm tra không phải người thu" không đạt được. Cần quy định bù (ví dụ quản lý đối soát chặt hơn, tăng tỷ lệ kiểm tra).

## Trách nhiệm theo bước

| Bước | Người chịu trách nhiệm | Cách kiểm soát |
|------|------------------------|----------------|
| Giá và tồn kho đúng | Bộ phận DS Smart POS và hàng hoá | Cảnh báo DS Smart POS chậm, đối chiếu lại giá lúc khoá giỏ, danh sách mã không tìm thấy |
| Giỏ hàng khớp hàng thật | Nhân viên cổng ra (và thu ngân khi đối chiếu sớm) | Kiểm tra ngẫu nhiên, nhật ký chênh lệch |
| Tiền mặt thu đủ | Thu ngân | Số khách đưa, tiền thừa, đối soát cuối ca |
| Tiền chuyển khoản đã vào | Thu ngân xác nhận, quản lý đối soát | 3 ô tick, đối soát sao kê hằng ngày |
| Chỉ người đã trả mới ra | Nhân viên cổng ra | QR một lần, ký bởi máy chủ, nhật ký quét |
| Cho phép ngoại lệ | Quản lý chi nhánh | Ghi lý do, nhật ký |
| Cấu hình, quyền truy cập | Quản trị chuỗi | Xác thực 2 bước, nhật ký |

## Quy tắc cá nhân cho nhân viên

- Mỗi người dùng **tài khoản và PIN của riêng mình**. Không cho mượn, không ghi PIN ở nơi người khác thấy.
- Đăng xuất khi rời máy.
- Báo ngay cho quản lý khi nghi PIN bị lộ.
- Sai PIN 5 lần liên tiếp, tài khoản bị khoá tạm 15 phút. Quản lý có thể mở khoá và đặt lại PIN.
