# 09. Quyết định, khoảng trống & câu hỏi mở

**Trạng thái:** Cần xác nhận — đọc tài liệu này trước khi chốt thiết kế.

Phần A là các quyết định đã chốt với khách hàng trong quá trình dựng khung. Phần B là câu hỏi mở của tài liệu gốc (có cập nhật). Phần C là các điểm tài liệu gốc chưa đề cập hoặc còn mâu thuẫn.

## A. Quyết định đã chốt

| Mã | Quyết định | Ngày | Ảnh hưởng |
|----|-----------|------|-----------|
| D-01 | Tên sản phẩm là **BRG Scan & Checkout** | 2026-11-04 | Giao diện, tài liệu |
| D-02 | Giai đoạn 1 thanh toán **tiền mặt và chuyển khoản QR tại quầy, nhân viên xác nhận**. Thanh toán online (ví, VNPay, thẻ) giữ chỗ trong giao diện, hiện mờ, bật bằng cờ cấu hình theo chi nhánh | 2026-11-04 | 02, 04, 07, 08; [ADR-0001](adr/0001-thanh-toan-thu-cong-giai-doan-1.md) |
| D-03 | QR chuyển khoản do **app tự tạo** cho từng giao dịch (số tiền + nội dung là mã giao dịch); thiết kế để thay bằng QR lấy từ nhà cung cấp mà không đổi giao diện khách | 2026-11-04 | 04 mục 3, 07; [ADR-0002](adr/0002-qr-chuyen-khoan-thay-duoc.md) |
| D-04 | Đã có **API tồn kho của tất cả siêu thị, cập nhật gần real-time** | 2026-11-04 | 07 mục 1; Q-01 được trả lời một phần |
| D-05 | Nhân viên dùng **PWA riêng** (đăng nhập) cho thu tiền và cổng ra; quản trị là web riêng. **Đề xuất, chưa chốt:** GĐ1 quầy và cổng cần có mạng (không xác nhận offline) | 2026-11-04 | 05 mục 2; G-09 |
| D-06 | Mục tiêu thời gian: dùng được trong khoảng **2 tháng** (chưa xác nhận khả thi) | 2026-11-04 | 08 |
| D-07 | Xây trọn ứng dụng (khách, thu ngân, cổng ra, quản trị) trước; các tích hợp (POS, hoá đơn, thanh toán online) xử lý lần lượt sau, hiện dùng bản giả lập | 2026-11-05 | [11](11-ung-dung.md) |
| D-08 | Giao diện theo mẫu HCRC: tông cam, phông Inter, nút bo tròn, biểu tượng túi xanh có nụ cười, menu bên nét mảnh | 2026-11-05 | public/shared |
| D-09 | Kiểm tra ngẫu nhiên do máy chủ bốc khi khoá giỏ; làm ở cổng ra, nhân viên quầy có thể đối chiếu sớm tại quầy; không có nút bỏ qua | 2026-11-05 | 02, 07 |
| D-10 | **Thu tiền qua POS (theo từng chi nhánh):** POS quét mã giỏ, gọi API của BRG lấy mặt hàng, thu tiền và xuất hoá đơn trên POS, rồi báo thanh toán về BRG; BRG **tự xác nhận**, thu ngân không xác nhận nữa. Huỷ đơn do POS làm và báo về. Giữ chế độ tự thu trong BRG làm dự phòng | 2026-11-05 | [api-pos](api-pos.md), 14 |
| D-11 | **Bỏ bước bảo vệ (theo từng chi nhánh):** chi nhánh không có bảo vệ tắt bước kiểm tra ở cổng: không QR ra cổng, không kiểm tra ngẫu nhiên, thanh toán xong khách ra luôn | 2026-11-05 | 02, 05 |
| D-12 | **Thu hẹp nghiệp vụ: giỏ QR cho POS.** Khách quét mặt hàng, thấy tạm tính theo giá đúng chi nhánh, bấm Thanh toán thì hiện **mã QR chứa mã vạch và số lượng**; thu ngân quét vào POS, POS tạo đơn và **tính lại giá**, thu tiền, xuất hoá đơn. Không thanh toán trên web, không bước bảo vệ, BRG không quản lý tồn kho. Mã QR tạo và lưu trên điện thoại nên không mất khi mất mạng hoặc tắt trình duyệt. Các luồng cũ (thu tiền trong BRG, cổng ra, kiểm tra ngẫu nhiên) **khoá, giữ lại để dùng sau** | 2026-11-05 | [api-qr-gio-hang](api-qr-gio-hang.md), [api-gia-chi-nhanh](api-gia-chi-nhanh.md) |
| D-13 | **Khách không đăng nhập.** Ứng dụng nhận ra khách bằng mã thiết bị ngẫu nhiên lưu trong trình duyệt và cookie. Khách để lại email (không bắt buộc) để nhận bill kèm PDF và link xem bill ngay khi POS báo thanh toán; email cũng dùng để xem lịch sử trên máy khác bằng mã xác nhận. Email gửi qua SMTP do quản trị chuỗi cấu hình trong trang Tích hợp | 2026-11-08 | [11](11-ung-dung.md) |

## B. Câu hỏi mở từ tài liệu gốc (cập nhật)

| Mã | Câu hỏi | Ảnh hưởng | Người quyết | Trạng thái |
|----|---------|-----------|-------------|-----------|
| Q-01 | POS/ERP cụ thể là gì? Cần tài liệu API, môi trường thử, dữ liệu mẫu (xem [07](07-tich-hop-chong-that-thoat.md) mục 1) | Đồng bộ sản phẩm | | ◐ Đã có API gần real-time, chưa có tài liệu |
| Q-02 | **Đã đổi:** GĐ1 không cần cổng thanh toán. Cần biết: tài khoản công ty mở ở **ngân hàng nào**, ngân hàng có API/webhook không, và nhà cung cấp QR nào sẽ thử ở GĐ1.5 (VNPay hoặc khác) | Chuyển khoản QR, GĐ1.5 | | ☐ |
| Q-03 | Số chi nhánh thực tế & vị trí địa lý? | Hạ tầng, ước tính tải (NFR-03) | | ☐ |
| Q-04 | Nhà cung cấp hoá đơn điện tử đang dùng? | Tích hợp hoá đơn | | ☐ |
| Q-05 | Tỷ lệ kiểm tra ngẫu nhiên ban đầu (ví dụ 10%)? Thiết kế đang dùng 10% làm giá trị mẫu | FR-ADM-06, R2 | | ☐ |
| Q-06 | Thời gian lưu audit log tối thiểu (nội bộ/pháp lý)? | NFR-07, lưu trữ | | ☐ |
| Q-07 | Ngân hàng của công ty cho phép dùng tài khoản thu tiền bán lẻ kiểu chuyển khoản này không? Có cắt/đổi nội dung chuyển khoản không? | R12, ADR-0002 | | ☐ |
| Q-08 | Kế toán có yêu cầu gì về chứng từ cho tiền mặt và chuyển khoản thu qua Scan & Checkout (đối soát, hoá đơn)? | G-05, NFR-16 | | ☐ |

## C. Khoảng trống phát hiện được

| Mã | Khoảng trống | Vì sao quan trọng | Gợi ý / trạng thái |
|----|--------------|-------------------|-------|
| G-01 | **Sản phẩm bán theo cân/ký** (rau, thịt, hàng tươi) | Nhiều mặt hàng không có mã cố định theo mặt hàng | Chốt: loại trừ ở GĐ1 (tem có mã chứa giá/khối lượng) hay hỗ trợ mã cân động. **Chưa chốt** |
| G-02 | **Hàng giới hạn độ tuổi** (rượu, thuốc lá) | Yêu cầu pháp lý | Nhân viên kiểm tra ở quầy (GĐ1 có người) hoặc loại khỏi Scan & Checkout. **Chưa chốt** |
| G-03 | **Khuyến mãi / giá đặc biệt** | `ProductCache` chưa có trường khuyến mãi; M12 đang hiện dòng khuyến mãi | Hỏi POS API có trả khuyến mãi không; thực thể Promotion; M15 đã xử lý giá đổi. **Chưa chốt** |
| G-04 | **Danh tính khách** | Hoá đơn, lịch sử, dữ liệu cá nhân | Thiết kế hiện tại: khách vãng lai, không đăng nhập; lịch sử lưu trên máy (M25), xem máy khác bằng email có mã xác nhận. **Cần xác nhận** |
| G-05 | **POS là nguồn chân lý nhưng không đồng bộ ngược**: giao dịch Scan & Checkout vào kế toán, tồn kho, doanh thu chung bằng cách nào? | Tồn kho lệch, doanh thu tách rời | Chốt cơ chế ghi nhận (xuất file / API tạo đơn trên POS) hoặc chấp nhận đối soát thủ công. **Chưa chốt** (liên quan Q-08) |
| G-06 | **Hoá đơn điện tử cần thông tin người mua** | Thiếu thông tin thì không hợp lệ | Thiết kế có luồng hoá đơn công ty bằng mã số thuế sau thanh toán (M22). **Cần xác nhận với kế toán** |
| G-07 | **Trả hàng / hoàn tiền / huỷ giao dịch** | Sự cố hằng ngày; nhân viên bấm nhầm xác nhận | **Chưa có thiết kế.** Cần quy trình huỷ có quyền quản lý, để lại dấu vết |
| G-08 | **Quét ít hơn lấy** | Kiểm tra ngẫu nhiên là biện pháp chính ở GĐ1 | Dữ liệu thí điểm; QR dùng một lần; ở GĐ1 khách đến quầy nên nhân viên có thể đối chiếu |
| G-09 | **Thiết bị quầy và cổng ra; mất mạng thì sao** | Cổng là điểm nghẽn | D-05: dùng PWA nhân viên trên điện thoại/máy cầm tay; **đề xuất** cần mạng ở GĐ1 (xác nhận offline phức tạp, vẫn không biết mã đã dùng chưa) |
| G-10 | **Tiêu chí thành công GĐ1 chỉ nêu định tính** | Không biết khi nào sang GĐ2 | Đặt số: % gian lận tối đa, độ trễ đồng bộ POS, % đối soát khớp, thời gian mỗi khách ở quầy, điểm hài lòng |
| G-11 | ~~Mâu thuẫn "cổng quét QR biên nhận" GĐ 1–2~~ | | **Đã giải quyết:** QR biên nhận và quét ở cổng bằng PWA nhân viên thuộc GĐ1; cổng vật lý thuộc GĐ2 |
| G-12 | **Quyền riêng tư** | Quy định dữ liệu cá nhân; niềm tin khách | Chính sách rõ: không lưu ảnh camera (M03 đã ghi), sự kiện phân tích ẩn danh (NFR-09) |
| G-13 | **Ngôn ngữ & truy cập được** | Khách cao tuổi, đa dạng thiết bị | Mặc định tiếng Việt, cân nhắc tiếng Anh; NFR-13 |
| G-14 | **Mô hình vận hành**: ai hỗ trợ khi khách lỗi; số nhân viên quầy mỗi ca | R3, R13 | GĐ1 có nhân viên quầy và hỗ trợ. Cần mô tả quy trình và định mức |
| G-15 | **Kiểm soát tiền thu thủ công** (mới) | Nhân viên là điểm yếu duy nhất (R11) | Đối soát ca, đối soát sao kê, không sửa/xoá. Cần quy trình bàn giao ca và quy định xử lý lệch |

## D. Quyết định cần ra sớm (theo thứ tự đề nghị)

1. Kiểm chứng kỹ thuật quét mã PWA trên thiết bị thật (R5) — làm trước khi xây phần còn lại.
2. Q-01: lấy tài liệu API POS và dữ liệu mẫu; chốt G-03 (khuyến mãi) với POS.
3. Q-07 và R12: kiểm chứng QR chuyển khoản tự tạo với ngân hàng của công ty.
4. G-05 và Q-08: cách ghi nhận giao dịch vào kế toán/tồn kho, với kế toán.
5. G-01, G-02: phạm vi hàng hoá GĐ1.
6. G-04, G-06, G-12: danh tính khách, hoá đơn, quyền riêng tư.
7. G-07, G-15: quy trình huỷ giao dịch và kiểm soát tiền thu thủ công.
8. G-09: xác nhận cách xử lý khi quầy/cổng mất mạng.
