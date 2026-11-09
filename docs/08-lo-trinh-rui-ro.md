# 08. Lộ trình & rủi ro

**Trạng thái:** Nháp

## 1. Lộ trình

Mục tiêu của khách hàng: **dùng được trong khoảng 2 tháng**. Chưa xác nhận khả thi, vì chưa biết đội ngũ và tình trạng tài liệu API Dsmart POS. Cắt giảm phạm vi bằng thanh toán thủ công (D-02) là để đạt mục tiêu này.

| Giai đoạn | Phạm vi | Thời gian dự kiến | Tiêu chí hoàn thành |
|-----------|---------|------------------|---------------------|
| 1 — Thí điểm 2–3 chi nhánh | PWA khách + PWA nhân viên + web quản trị; thanh toán tiền mặt và chuyển khoản QR do nhân viên xác nhận; multi-tenant cho cả chuỗi, chỉ bật 2–3 chi nhánh qua cờ | Mục tiêu 2 tháng để dùng được, rồi 2–4 tuần vận hành thí điểm | Gian lận trong ngưỡng chấp nhận, đồng bộ Dsmart POS ổn định, đối soát tiền khớp, khách phản hồi tích cực (cần đặt số, G-10) |
| 1.5 — Thanh toán tự động (thử) | Bật QR từ nhà cung cấp (hoặc ví, VNPay) ở một chi nhánh bằng cờ; so sánh với cách thủ công | Làm song song, khi tích hợp xong | Tự xác nhận đúng, đối soát khớp, không tăng khiếu nại |
| 2 — Nhân rộng | Bật cho các chi nhánh còn lại qua cùng cờ, không phát triển lại; có thể thêm cổng vật lý quét QR | Theo tốc độ bật dần sau khi GĐ1 đạt | Toàn bộ chi nhánh ổn định, báo cáo toàn chuỗi đầy đủ |
| 3 — Chống thất thoát nâng cao (tuỳ chọn) | Cân thông minh / camera AI cho chi nhánh rủi ro cao | Sau 2–3 tháng dữ liệu vận hành | Quyết định đầu tư theo số liệu |

Trình tự kỹ thuật đề xuất cho giai đoạn 1 (TODO gắn ngày khi chốt đội ngũ):
1. Khảo sát API Dsmart POS và **kiểm chứng quét mã vạch trên điện thoại thật** (iPhone, Android đời thấp). Đây là rủi ro lớn nhất.
2. Kiểm chứng QR chuyển khoản tự tạo với ngân hàng của công ty.
3. Khung kỹ thuật, đồng bộ sản phẩm, PWA khách (quét, giỏ, khoá giỏ).
4. PWA nhân viên (thu tiền, cổng ra, kiểm tra ngẫu nhiên), hoá đơn điện tử.
5. Web quản trị (cờ chi nhánh, báo cáo, đối soát).
6. Thí điểm.

## 2. Rủi ro

| Mã | Rủi ro | Mức | Giảm thiểu |
|----|--------|-----|-----------|
| R1 | Dsmart POS không có API thời gian thực | Thấp (đã có API gần real-time) | Vẫn thiết kế lớp đồng bộ linh hoạt; kiểm tra thực tế độ trễ |
| R2 | Gian lận vượt dự kiến khi thí điểm | Trung bình | Bắt đầu với tỷ lệ kiểm tra cao, giảm dần theo dữ liệu |
| R3 | Khách chưa quen tự quét | Trung bình | Hướng dẫn trong app (M02); nhân viên hỗ trợ tại chỗ |
| R4 | Đăng ký merchant cổng thanh toán lâu | Thấp ở GĐ1 (không cần), Trung bình ở GĐ1.5 | Làm song song với phát triển |

### Rủi ro bổ sung (PWA & vận hành)

| Mã | Rủi ro | Mức | Giảm thiểu |
|----|--------|-----|-----------|
| R5 | Quét mã trên iPhone/Android đời thấp chậm hoặc kém | Cao | Thử nghiệm sớm trên thiết bị thật; thư viện giải mã dự phòng; nhập tay mã (M11) |
| R6 | Link QR mở trong webview (Zalo/Facebook) bị chặn camera | Trung bình | Phát hiện webview, hướng dẫn mở bằng trình duyệt (M06) |
| R7 | Mất dữ liệu cục bộ do trình duyệt xoá | Trung bình | Lưu bền + đồng bộ giỏ lên backend khi có mạng |
| R8 | Chất lượng mạng trong siêu thị kém (kệ kim loại, tầng hầm) | Trung bình | Khảo sát sóng; thiết kế offline (PWA-03); quầy và cổng cần mạng ổn định |
| R9 | Giá thay đổi giữa lúc quét và lúc thanh toán | Thấp–TB | Kiểm tra lại khi khoá giỏ, khách đồng ý (M15) |
| R10 | Quy định dữ liệu cá nhân / hoá đơn | Trung bình | Rà soát pháp lý trước thí điểm |
| R11 | **Xác nhận thu tiền thủ công**: nhân viên bấm nhầm hoặc gian lận (nhận tiền mặt không ghi, xác nhận chuyển khoản chưa vào) | Trung bình–Cao | Ghi người, thời điểm, không sửa/xoá; đối soát tiền mặt theo ca và chuyển khoản với sao kê hằng ngày (A10); ba ô tick bắt buộc (N06); quy trình bàn giao ca |
| R12 | QR chuyển khoản tự tạo không quét được trên một số app ngân hàng, hoặc ngân hàng đổi nội dung | Trung bình | Kiểm chứng sớm với nhiều ngân hàng; giữ thông tin số tài khoản để nhập tay (M17) |
| R13 | Quầy thu tiền thành điểm nghẽn giờ cao điểm | Trung bình | Đo thời gian mỗi khách; thêm nhân viên thu tiền; đẩy nhanh GĐ1.5 |
