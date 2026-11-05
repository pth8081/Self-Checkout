---
title: Tình huống ngoại lệ
summary: Bảng xử lý các tình huống thường gặp ở cửa hàng, ghi rõ việc nào ứng dụng đã hỗ trợ và việc nào phải xử lý thủ công.
group: nghiep-vu
order: 70
access: all
---

# Tình huống ngoại lệ

Cột **Ứng dụng** cho biết việc đó có công cụ trong ứng dụng hay phải xử lý ngoài hệ thống:
**Có** = đã hỗ trợ, **Một phần** = hỗ trợ một phần, **Thủ công** = chưa có chức năng, xử lý ngoài ứng dụng và ghi chú lại.

## Khi khách mua sắm

| Tình huống | Cách xử lý | Ứng dụng |
|-----------|-----------|---------|
| Camera không quét được mã | Nhập mã tay: gõ dãy số dưới mã vạch. Mã quá mờ thì nhờ nhân viên hỗ trợ | Có |
| Camera bị chặn | Làm theo hướng dẫn trên màn hình để bật quyền camera. Mở link trong Zalo hoặc Facebook thì chuyển sang Safari hoặc Chrome | Có |
| Mã báo "chưa có trong hệ thống" | Nhờ nhân viên hỗ trợ. Mã được ghi vào danh sách **Mã không tìm thấy** để bổ sung vào POS. Khách có thể mua món đó ở quầy thường | Một phần |
| Hàng bán theo cân, hàng tươi không mã cố định | Chưa hỗ trợ. Khách mua ở quầy thường | Thủ công |
| Khách mất mạng giữa chừng | Giỏ lưu trên máy, quét tiếp được, tự đồng bộ khi có mạng. Thanh toán cần có mạng | Có |
| Giá hoặc tồn kho đổi lúc khoá giỏ | Khách xem thay đổi và đồng ý, hoặc quay lại giỏ | Có |
| Khách tải lại trang, đóng trình duyệt | Mở lại link, chọn tiếp tục giỏ cũ (trong 6 giờ) | Có |
| Khách dùng điện thoại cũ, không có camera dùng được | Nhập mã tay, hoặc mua ở quầy thường | Một phần |

## Tại quầy thu tiền

| Tình huống | Cách xử lý | Ứng dụng |
|-----------|-----------|---------|
| Khách đổi ý, không mua | Thu ngân **huỷ giỏ** kèm lý do, giỏ mở lại cho khách | Có |
| Khách muốn bớt món sau khi khoá giỏ, chưa trả | Khách bấm **Quay lại sửa giỏ hàng** (hoặc thu ngân huỷ giỏ), sửa rồi khoá lại. Mã giỏ mới | Có |
| Màn hình điện thoại khách chói hoặc nứt | Nhập tay mã giỏ `GH-...` | Có |
| Khách bỏ đi sau khi khoá giỏ, giỏ nằm mãi trong hàng đợi | Thu ngân huỷ giỏ cũ khi dọn hàng đợi | Một phần |
| Khách trả chuyển khoản nhưng chưa thấy tiền | Chờ, kiểm tra lại, không xác nhận. Quá lâu thì trả tiền mặt hoặc báo quản lý | Một phần |
| Chuyển sai số tiền hoặc sai nội dung | Xem "Quy trình thanh toán", mục chuyển khoản có vấn đề | Một phần |
| Thu ngân bấm nhầm xác nhận | Quản lý **huỷ giao dịch** nếu khách chưa ra cổng. Nếu khách đã ra, ghi chú và xử lý khi đối soát | Một phần |
| Tiền mặt cuối ca lệch | Ghi lý do khi kết thúc ca. Quản lý xác minh ở mục Đối soát | Có |
| Có hàng giới hạn độ tuổi | Thu ngân xem giấy tờ trước khi thu | Một phần |
| Khách xin hoá đơn công ty | Khách nhập mã số thuế trong app, chỉ trong ngày mua | Có |
| Hoá đơn điện tử bị lỗi | Không chặn khách. Hệ thống thử lại. Quản trị bấm **Thử lại hoá đơn treo** | Có |
| Hoàn tiền, trả hàng sau khi đã trả | Chưa hỗ trợ. Quản lý huỷ giao dịch (nếu khách chưa ra cổng), hoàn tiền ngoài hệ thống | Thủ công |

## Tại cổng ra

| Tình huống | Cách xử lý | Ứng dụng |
|-----------|-----------|---------|
| Khách đưa **mã giỏ hàng** thay vì QR biên nhận | Hướng dẫn mở màn "Mã ra cổng" (xuất hiện sau khi đã thu tiền) | Có |
| QR báo **đã dùng** | Không cho qua, gọi quản lý. Xem lịch sử quét ở truy vết giao dịch (ai, giờ nào, cổng nào) | Có |
| QR báo **chưa thanh toán** | Mời khách về quầy | Có |
| QR **hết hạn** (quá thời hạn hiệu lực) | Gọi quản lý xác minh. Chưa có cách cấp lại QR trong ứng dụng | Thủ công |
| Khách hết pin hoặc mất điện thoại sau khi đã trả | Chưa có cách cho qua bằng mã giao dịch ở cổng. Quản lý tra giao dịch ở web quản trị, xác minh (tên, giờ, số tiền, hoá đơn) rồi quyết định, ghi chú lại | Thủ công |
| Khách từ chối kiểm tra ngẫu nhiên | Chọn "Khách từ chối, gọi quản lý" | Có |
| Kiểm tra phát hiện hàng chưa tính tiền | Ghi chênh lệch, thu bổ sung hoặc báo quản lý | Có |
| Điện thoại khách không hiện được QR do mạng | QR đã lưu trên máy nên vẫn hiện được khi mất mạng | Có |

> **Cần xác nhận:** Hai dòng "Thủ công" ở cổng ra (QR hết hạn, khách mất điện thoại) là rủi ro vận hành thực tế. Đề xuất bổ sung chức năng cho qua thủ công có quản lý duyệt và ghi lý do. Xem "Điểm cần chốt".

## Sự cố hệ thống

| Tình huống | Cách xử lý | Ứng dụng |
|-----------|-----------|---------|
| Mất mạng tại quầy hoặc cổng ra (app nhân viên cần mạng) | Tạm dừng Self Checkout ở chi nhánh (quản trị chuỗi tắt chi nhánh), chuyển khách sang quầy thường. Giỏ đã khoá nhưng chưa thu thì thu ở quầy thường | Một phần |
| POS đồng bộ chậm hoặc sai giá | Tổng quan hiện cảnh báo khi dữ liệu chậm quá ngưỡng. Việc đối chiếu lại giá lúc khoá giỏ giúp chặn sai giá. Báo bộ phận POS | Có |
| Hoá đơn treo nhiều | Kiểm tra kết nối nhà cung cấp, bấm thử lại, báo bộ phận kế toán | Có |
| Thiếu nhân viên ca (không có thu ngân hoặc cổng ra) | Lịch ca hiện cảnh báo. Điều người hỗ trợ hoặc tạm tắt chi nhánh | Có |
| Máy cầm tay hỏng | Dùng điện thoại khác đăng nhập app nhân viên bằng tài khoản của mình | Có |
| Nghi ngờ tài khoản bị lộ | Quản lý khoá tài khoản và đặt lại PIN. Quản trị chuỗi đặt lại mật khẩu | Có |

## Nguyên tắc chung khi gặp tình huống chưa có hướng dẫn

1. **Không cho qua nếu chưa chắc** đã thanh toán. Hỏi quản lý.
2. Không xác nhận thu tiền khi chưa tận mắt thấy tiền (tiền mặt) hoặc thấy tiền vào tài khoản (chuyển khoản).
3. **Ghi chú lại** mọi xử lý ngoài ứng dụng (ghi trong lý do huỷ, ghi chú ca, hoặc sổ của chi nhánh) để đối soát cuối ngày.
4. Giữ thái độ lịch sự với khách. Ứng dụng nhằm giảm xếp hàng, không phải để nghi ngờ khách.
