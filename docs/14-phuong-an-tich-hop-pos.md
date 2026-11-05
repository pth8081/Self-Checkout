# 14. Phương án: giỏ hàng tự vào POS, thu tiền và hoá đơn tại POS

**Trạng thái:** Đã chọn hướng và làm phần máy chủ. Khách hàng trả lời: POS chưa có API nhưng **BRG cung cấp API để POS gọi** (POS quét mã giỏ rồi gọi BRG lấy món), POS sẽ **báo thanh toán thành công về BRG và BRG tự xác nhận** (thu ngân không kiểm nữa), việc **huỷ đơn do POS làm** (và báo về BRG), và khách hàng có **môi trường thử**. Nghĩa là thay vì "BRG đẩy đơn vào POS" (phương án 1 bên dưới), ta làm theo hướng **POS kéo giỏ từ BRG**. Tài liệu cho nhà cung cấp POS: [api-pos.md](api-pos.md). Hướng dẫn cho quản trị: mục "Kết nối POS" trong web quản trị. Phân tích ban đầu giữ lại bên dưới để tham khảo.

## Yêu cầu

Khách quét hàng và khoá giỏ; thu ngân quét mã giỏ hàng thì các món **tự nhập vào POS** để tính tiền. Thu tiền (QR, tiền mặt) và hoá đơn điện tử dùng của POS. Quy trình xác nhận của thu ngân và bảo vệ cổng ra **giữ nguyên**.

## Ba phương án

| | 1. Đẩy đơn qua API (khuyến nghị nếu POS có API) | 2. Cầu nối tại quầy tự nhập | 3. Nhập đơn bằng file hoặc mã |
|-|-|-|-|
| Cách làm | BRG gọi API POS tạo đơn khi thu ngân quét mã; thu ngân thu tiền trên POS | Chương trình trên máy thu ngân tự gõ mã vạch và số lượng vào POS | BRG xuất file POS nhập được, hoặc POS có ô đọc mã giỏ |
| POS cần | API tạo đơn, trạng thái thanh toán, huỷ đơn, môi trường thử | Ô nhập mã vạch ổn định | Chức năng nhập đơn hoặc tiện ích mở rộng |
| Ưu | Chắc chắn, POS tính giá, tiền, hoá đơn | Làm được với POS cũ | Không cần API đầy đủ |
| Rủi ro | Phụ thuộc chất lượng API; đơn tạo mà không thanh toán phải tự huỷ | Mong manh khi POS đổi giao diện; không biết chắc đã thanh toán | Thêm thao tác thu ngân; khó lấy trạng thái thanh toán |

Phương án 0 (hiện tại: BRG tự thu tiền, thu ngân tick xác nhận) là dự phòng cho cả ba, chọn theo từng chi nhánh.

## Luồng đề xuất (phương án 1)

1. Khách khoá giỏ, chọn "Thanh toán tại quầy" (bỏ màn QR chuyển khoản của BRG), nhận mã giỏ hàng.
2. Thu ngân quét mã. BRG tạo đơn trên POS (mã giao dịch làm khoá chống trùng). POS trả số đơn, giá và khuyến mãi POS tính, tổng tiền.
3. Thu ngân thấy đơn đã nhập, so tổng POS với tạm tính. Thu tiền trên POS; POS xuất hoá đơn điện tử.
4. POS báo đã thanh toán (kèm cách trả, số hoá đơn). Nút xác nhận của BRG bật lên.
5. Thu ngân đối chiếu rồi bấm xác nhận (giữ nguyên). Khách nhận QR biên nhận và số hoá đơn.
6. Bảo vệ quét QR, kiểm tra ngẫu nhiên: không đổi.

## Giữ, đổi, bỏ

- **Giữ:** quét và giỏ của khách, QR biên nhận ký dùng một lần, cổng ra, kiểm tra ngẫu nhiên, chênh lệch, thu bổ sung, quản lý duyệt, ca, nhật ký, báo cáo, phân quyền.
- **Đổi hoặc thêm:** chế độ thu tiền "POS" theo từng chi nhánh; thu ngân thấy đơn POS và trạng thái; xác nhận chỉ bật khi POS báo đã thanh toán; khách nhập thông tin hoá đơn công ty trước khi khoá giỏ; trang quản trị có trạng thái POS, đơn đẩy lỗi, đơn treo, đối soát BRG và POS.
- **Bỏ trong chế độ POS:** BRG xuất hoá đơn (POS xuất, BRG nhận số hoá đơn), tick 3 điều kiện chuyển khoản, đối soát sao kê trong BRG.

Lợi ích thêm: giao dịch Self Checkout **tự vào POS** (tồn kho, doanh thu, kế toán), giải quyết khoảng trống G-05 và mục 10, 11 trong "Điểm cần chốt".

## Quyết định nghiệp vụ mới

| Vấn đề | Đề xuất |
|--------|---------|
| Giá POS khác tạm tính | POS là chuẩn; hiện chênh lệch cho thu ngân, cập nhật số tiền cho khách, ghi nhật ký |
| Đơn POS tạo mà khách bỏ đi | Chỉ tạo đơn khi thu ngân quét; tự huỷ đơn treo sau thời gian ngắn (ví dụ 15 phút); huỷ ở POS khi thu ngân huỷ giỏ |
| Ai giữ sự thật "đã thu tiền" | POS; BRG phát QR sau khi POS báo đã thanh toán **và** thu ngân xác nhận |
| Tiền mặt và két | Két do POS đối soát; màn đối soát tiền mặt của BRG chỉ tham khảo hoặc bỏ. Cần chốt |
| Hoá đơn công ty | Khách nhập mã số thuế trước khi khoá giỏ, gửi cùng đơn |
| POS mất kết nối | Thu thủ công như hiện nay, cần quản lý duyệt, đánh dấu để nhập bù vào POS; hoặc tạm dừng Self Checkout |
| Hoàn tiền, trả hàng | Làm trên POS; BRG hiện trạng thái |
| Đối soát mỗi ngày | So từng giao dịch BRG với đơn POS (có đơn, đúng số tiền, đã thanh toán) |

## Cần hỏi bên POS

1. Tên và phiên bản POS; chạy tại quầy hay đám mây.
2. API tạo đơn (hoặc đơn treo, nháp) từ bên ngoài, nhận món theo mã vạch hoặc SKU và số lượng.
3. API hoặc thông báo khi đơn đã thanh toán hoặc huỷ; trả về cách trả, số tiền, **số hoá đơn điện tử**.
4. Huỷ đơn từ bên ngoài; đơn treo có tự hết hạn không.
5. Gán đơn cho máy hoặc thu ngân cụ thể, hay thu ngân tìm đơn bằng số.
6. POS có tự tính lại giá và khuyến mãi (khuyến mãi theo hoá đơn, giảm theo thành viên, làm tròn).
7. Nhận thông tin xuất hoá đơn công ty cùng đơn.
8. Môi trường thử, tài liệu, khoá truy cập, giới hạn gọi; đánh dấu đơn đến từ "Self Checkout".
9. Nếu không có API: POS có nhập đơn từ file, có cho viết tiện ích, hay chỉ có giao diện bán hàng.

## Các bước

A. Hỏi bên POS, chọn phương án. B. Viết lớp kết nối POS (tạo đơn, hỏi trạng thái, huỷ) và thử trên môi trường thử, gồm các tình huống lệch giá, mất kết nối, trùng đơn. C. Sửa app thu ngân, app khách, trang quản trị và hướng dẫn nghiệp vụ. D. Thí điểm ở một quầy, so BRG với POS mỗi ngày rồi mở rộng. Công sức: phương án 1 vài tuần sau khi có tài liệu API và môi trường thử (ước lượng, chưa xác nhận).

## Chỗ cắm trong mã hiện tại

Điểm gắn là một lớp kết nối POS mới bên cạnh `server/services/pos.js` (hiện chỉ đọc giá, tồn kho): `createOrder(giao dịch)`, `getOrder(mã đơn)`, `cancelOrder(mã đơn)`, kèm tuyến nhận thông báo từ POS, và các cột lưu mã đơn POS, trạng thái POS, tổng POS, số hoá đơn POS trên giao dịch. Cờ cấu hình `paymentSource` (`manual` hoặc `pos`) theo từng chi nhánh quyết định dùng luồng nào.
