# 09. Phân tích khoảng trống & câu hỏi mở

**Trạng thái:** Cần xác nhận — đọc tài liệu này trước khi chốt thiết kế.

Phần A là câu hỏi mở của tài liệu gốc. Phần B là các điểm tài liệu gốc **chưa đề cập hoặc còn mâu thuẫn**, rút ra khi dựng khung; mỗi điểm cần một quyết định.

## A. Câu hỏi mở từ tài liệu gốc

| Mã | Câu hỏi | Ảnh hưởng | Người quyết | Trạng thái |
|----|---------|-----------|-------------|-----------|
| Q-01 | Phần mềm POS/ERP cụ thể là gì? Có API thời gian thực? | Kiến trúc đồng bộ (07 mục 1) | | ☐ |
| Q-02 | Cổng thanh toán ưu tiên: MoMo / VNPay / ZaloPay / khác? | Tích hợp, thời gian đăng ký merchant | | ☐ |
| Q-03 | Số chi nhánh thực tế & vị trí địa lý? | Hạ tầng, ước tính tải (NFR-03) | | ☐ |
| Q-04 | Nhà cung cấp hoá đơn điện tử đang dùng? | Tích hợp hoá đơn | | ☐ |
| Q-05 | Tỷ lệ kiểm tra ngẫu nhiên ban đầu (ví dụ 10%)? | FR-ADM-06, R2 | | ☐ |
| Q-06 | Thời gian lưu audit log tối thiểu (nội bộ/pháp lý)? | NFR-07, lưu trữ | | ☐ |

## B. Khoảng trống phát hiện được

| Mã | Khoảng trống | Vì sao quan trọng | Gợi ý |
|----|--------------|-------------------|-------|
| G-01 | **Sản phẩm bán theo cân/ký** (rau, thịt, hàng tươi). Tài liệu chỉ nói quét mã vạch | Siêu thị có nhiều mặt hàng không có mã cố định theo món; nếu bỏ qua, một phần hàng không dùng được Scan & Go | Chốt: loại trừ ở GĐ1 (quầy cân gắn tem có mã chứa giá/khối lượng) hay hỗ trợ mã cân động |
| G-02 | **Hàng giới hạn độ tuổi** (rượu, thuốc lá) | Yêu cầu pháp lý; khách tự thanh toán không có người kiểm tra | Xác thực tại cổng ra hoặc loại khỏi Scan & Go |
| G-03 | **Khuyến mãi / giá đặc biệt**: `ProductCache` không có trường khuyến mãi, nhưng FR-ADM mô tả "cấu hình khuyến mãi riêng nếu không đồng bộ từ POS" | Giá khách thấy ≠ giá thực tế → tranh chấp | Thêm thực thể Promotion; quy tắc giá chốt ở lúc quét hay lúc thanh toán |
| G-04 | **Danh tính khách**: chưa nói có đăng nhập không | Quyết định hoá đơn, chống lạm dụng, lịch sử đơn, dữ liệu cá nhân | Chế độ khách vãng lai + tuỳ chọn số điện thoại/email |
| G-05 | **"POS là nguồn chân lý" nhưng không đồng bộ ngược**. Giao dịch Scan & Go đi vào kế toán, tồn kho, báo cáo doanh thu chung bằng cách nào? | Tồn kho lệch, doanh thu tách rời, đối soát khó | Chốt cơ chế ghi nhận (xuất file / API tạo đơn trên POS) hoặc chấp nhận đối soát thủ công và nói rõ |
| G-06 | **Hoá đơn điện tử cần thông tin người mua** nhưng khách là vãng lai | Hoá đơn không hợp lệ nếu thiếu thông tin khi khách yêu cầu | Luồng "yêu cầu xuất hoá đơn có MST" sau thanh toán |
| G-07 | **Trả hàng / hoàn tiền / huỷ giao dịch** không có | Sự cố thực tế hằng ngày | Quy trình hoàn tiền qua cổng thanh toán + xử lý tại quầy dịch vụ |
| G-08 | **Quét sai / trộm "quét ít hơn lấy"**: kiểm tra ngẫu nhiên là biện pháp duy nhất ở GĐ1 | Thất thoát cao hơn dự kiến nếu tỷ lệ thấp | Dữ liệu thí điểm; chặn QR dùng lại, ghi nhận "sản phẩm lấy nhưng chưa quét" qua kiểm tra |
| G-09 | **Thiết bị tại cổng ra**: dùng điện thoại nhân viên (PWA) hay máy quét chuyên dụng? Mất mạng thì sao? | Cổng là điểm nghẽn; offline cổng khác offline khách | Chốt phần cứng GĐ1; quyết định có chế độ xác nhận offline (QR ký số) hay không |
| G-10 | **Tiêu chí thành công GĐ1 chỉ nêu định tính** ("trong ngưỡng chấp nhận", "phản hồi tích cực") | Không biết khi nào được chuyển GĐ2 | Đặt số: % gian lận tối đa, % thanh toán thành công, độ trễ đồng bộ POS, NPS |
| G-11 | **Mâu thuẫn nhỏ về giai đoạn**: "cổng quét QR biên nhận" ghi GĐ 1–2, trong khi phạm vi GĐ1 có "QR biên nhận + kiểm tra thủ công" | Lập kế hoạch thiết bị | Thống nhất: QR biên nhận thuộc GĐ1 (phần mềm); "cổng vật lý" thuộc GĐ2 |
| G-12 | **Quyền riêng tư**: thu thập hành vi (G3) và camera chỉ để quét mã | Quy định dữ liệu cá nhân; niềm tin khách | Chính sách rõ: không lưu ảnh camera, ghi sự kiện ẩn danh (NFR-09) |
| G-13 | **Ngôn ngữ & truy cập được** chưa nói | Khách cao tuổi, đa dạng thiết bị | Mặc định tiếng Việt, cân nhắc tiếng Anh; NFR-13 |
| G-14 | **Mô hình vận hành**: ai hỗ trợ khi khách lỗi? Có bắt buộc quầy hỗ trợ? | R3 | Nhân viên hỗ trợ GĐ1 (đã nêu), cần mô tả quy trình |

## C. Quyết định cần ra sớm (theo thứ tự đề nghị)

1. Q-01 + G-05: cách tích hợp POS và ghi nhận giao dịch (quyết định lớn nhất về chi phí và thời gian).
2. Kiểm chứng kỹ thuật quét mã PWA trên thiết bị thật (R5) — làm trước khi xây phần còn lại.
3. Q-02 + đăng ký merchant (R4, chạy song song).
4. G-01, G-02: phạm vi hàng hoá GĐ1.
5. G-04, G-06, G-12: danh tính, hoá đơn, quyền riêng tư.
6. G-09: thiết bị cổng ra.
