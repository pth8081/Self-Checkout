# Lịch sử phiên bản

Quy tắc đánh số: `chính.phụ`. Số sau chạy từ 0 đến 9, qua 9 thì số trước tăng 1 và số sau về 0 (1.0, 1.1 ... 1.9, 2.0 ... 2.9, 3.0 ...). Tăng bằng `npm run version:bump -- "ghi chú"`.

## 1.0 (2026-11-09)

- Bản đầu tiên đưa đi thử với Dsmart POS: khách quét hàng bằng điện thoại, mã QR ngắn (mã điểm và mã giỏ), Dsmart POS lấy danh sách mặt hàng qua API rồi tính tiền và báo thanh toán về.
- Bill, email, PDF, hoàn trả, hủy, hàng lấy thừa, giỏ hết hạn, giữ dữ liệu và xóa dữ liệu theo yêu cầu của khách.
