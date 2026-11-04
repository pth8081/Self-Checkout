# 08. Lộ trình & rủi ro

**Trạng thái:** Nháp

## 1. Lộ trình

| Giai đoạn | Phạm vi | Thời gian dự kiến | Tiêu chí hoàn thành |
|-----------|---------|------------------|---------------------|
| 1 — Thí điểm 2–3 chi nhánh | Xây đủ kiến trúc multi-tenant cho cả chuỗi; chỉ bật Scan & Go qua cờ cho 2–3 chi nhánh | 2–4 tuần vận hành thí điểm, sau khi hoàn thành code | Gian lận trong ngưỡng chấp nhận, đồng bộ POS ổn định, khách phản hồi tích cực |
| 2 — Nhân rộng | Bật cho các chi nhánh còn lại bằng cùng cờ, không phát triển lại | Theo tốc độ bật dần sau khi GĐ1 đạt | Toàn bộ chi nhánh ổn định, báo cáo toàn chuỗi đầy đủ |
| 3 — Chống thất thoát nâng cao (tuỳ chọn) | Cân thông minh / camera AI cho chi nhánh rủi ro cao | Sau 2–3 tháng dữ liệu vận hành | Quyết định đầu tư theo số liệu |

TODO: chuyển thành mốc có ngày (M0 khảo sát POS → M1 khung kỹ thuật & thử camera → M2 thanh toán + hoá đơn → M3 thí điểm …) khi chốt đội ngũ.

Ngưỡng định lượng cho "tiêu chí hoàn thành" của GĐ1 chưa có (xem [09 · G-10](09-phan-tich-khoang-trong.md)).

## 2. Rủi ro

| Mã | Rủi ro | Mức | Giảm thiểu |
|----|--------|-----|-----------|
| R1 | POS không có API thời gian thực | Cao nếu xảy ra | Lớp đồng bộ linh hoạt; khảo sát kỹ thuật POS sớm |
| R2 | Gian lận vượt dự kiến khi thí điểm | Trung bình | Bắt đầu với tỷ lệ kiểm tra cao, giảm dần theo dữ liệu |
| R3 | Khách chưa quen tự quét | Trung bình | Hướng dẫn trực quan trong app; nhân viên hỗ trợ tại chỗ |
| R4 | Đăng ký merchant cổng thanh toán lâu | Trung bình | Làm song song với phát triển |

## 3. Rủi ro bổ sung đề xuất (PWA & vận hành)

| Mã | Rủi ro | Mức | Giảm thiểu |
|----|--------|-----|-----------|
| R5 | Quét mã trên iPhone/Android đời thấp chậm hoặc kém | Cao | Thử nghiệm sớm trên thiết bị thật; thư viện giải mã dự phòng; nhập tay mã |
| R6 | Link QR mở trong webview (Zalo/Facebook) bị chặn camera | Trung bình | Phát hiện webview + hướng dẫn mở bằng trình duyệt |
| R7 | Mất dữ liệu cục bộ do trình duyệt xoá | Trung bình | Lưu bền + đồng bộ giỏ lên backend khi có mạng |
| R8 | Chất lượng mạng trong siêu thị kém (kệ kim loại, tầng hầm) | Trung bình | Khảo sát sóng; thiết kế offline (PWA-03) |
| R9 | Giá thay đổi giữa lúc quét và lúc thanh toán | Thấp–TB | Quy tắc giá chốt (G-03) |
| R10 | Quy định dữ liệu cá nhân / hoá đơn | Trung bình | Rà soát pháp lý trước thí điểm |
