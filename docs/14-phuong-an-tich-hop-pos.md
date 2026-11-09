# 14. Phương án: giỏ hàng tự vào DS Smart POS, thu tiền và hoá đơn tại DS Smart POS

**Trạng thái:** Đã chọn hướng và làm phần máy chủ. Khách hàng trả lời: DS Smart POS chưa có API nhưng **BRG cung cấp API để DS Smart POS gọi** (DS Smart POS quét mã giỏ rồi gọi BRG lấy mặt hàng), DS Smart POS sẽ **báo thanh toán thành công về BRG và BRG tự xác nhận** (thu ngân không kiểm nữa), việc **huỷ đơn do DS Smart POS làm** (và báo về BRG), và khách hàng có **môi trường thử**. Nghĩa là thay vì "BRG đẩy đơn vào DS Smart POS" (phương án 1 bên dưới), ta làm theo hướng **DS Smart POS kéo giỏ từ BRG**. Tài liệu cho nhà cung cấp DS Smart POS: [api-pos.md](api-pos.md). Hướng dẫn cho quản trị: mục "Kết nối DS Smart POS" trong web quản trị. Phân tích ban đầu giữ lại bên dưới để tham khảo.

## Yêu cầu

Khách quét hàng và khoá giỏ; thu ngân quét mã giỏ hàng thì các mặt hàng **tự nhập vào DS Smart POS** để tính tiền. Thu tiền (QR, tiền mặt) và hoá đơn điện tử dùng của DS Smart POS. Quy trình xác nhận của thu ngân và bảo vệ cổng ra **giữ nguyên**.

## Ba phương án

| | 1. Đẩy đơn qua API (khuyến nghị nếu DS Smart POS có API) | 2. Cầu nối tại quầy tự nhập | 3. Nhập đơn bằng file hoặc mã |
|-|-|-|-|
| Cách làm | BRG gọi API DS Smart POS tạo đơn khi thu ngân quét mã; thu ngân thu tiền trên DS Smart POS | Chương trình trên máy thu ngân tự gõ mã vạch và số lượng vào DS Smart POS | BRG xuất file DS Smart POS nhập được, hoặc DS Smart POS có ô đọc mã giỏ |
| DS Smart POS cần | API tạo đơn, trạng thái thanh toán, huỷ đơn, môi trường thử | Ô nhập mã vạch ổn định | Chức năng nhập đơn hoặc tiện ích mở rộng |
| Ưu | Chắc chắn, DS Smart POS tính giá, tiền, hoá đơn | Làm được với DS Smart POS cũ | Không cần API đầy đủ |
| Rủi ro | Phụ thuộc chất lượng API; đơn tạo mà không thanh toán phải tự huỷ | Mong manh khi DS Smart POS đổi giao diện; không biết chắc đã thanh toán | Thêm thao tác thu ngân; khó lấy trạng thái thanh toán |

Phương án 0 (hiện tại: BRG tự thu tiền, thu ngân tick xác nhận) là dự phòng cho cả ba, chọn theo từng chi nhánh.

## Luồng đề xuất (phương án 1)

1. Khách khoá giỏ, chọn "Thanh toán tại quầy" (bỏ màn QR chuyển khoản của BRG), nhận mã giỏ hàng.
2. Thu ngân quét mã. BRG tạo đơn trên DS Smart POS (mã giao dịch làm khoá chống trùng). DS Smart POS trả số đơn, giá và khuyến mãi DS Smart POS tính, tổng tiền.
3. Thu ngân thấy đơn đã nhập, so tổng DS Smart POS với tạm tính. Thu tiền trên DS Smart POS; DS Smart POS xuất hoá đơn điện tử.
4. DS Smart POS báo đã thanh toán (kèm cách trả, số hoá đơn). Nút xác nhận của BRG bật lên.
5. Thu ngân đối chiếu rồi bấm xác nhận (giữ nguyên). Khách nhận QR biên nhận và số hoá đơn.
6. Bảo vệ quét QR, kiểm tra ngẫu nhiên: không đổi.

## Giữ, đổi, bỏ

- **Giữ:** quét và giỏ của khách, QR biên nhận ký dùng một lần, cổng ra, kiểm tra ngẫu nhiên, chênh lệch, thu bổ sung, quản lý duyệt, ca, nhật ký, báo cáo, phân quyền.
- **Đổi hoặc thêm:** chế độ thu tiền "DS Smart POS" theo từng chi nhánh; thu ngân thấy đơn DS Smart POS và trạng thái; xác nhận chỉ bật khi DS Smart POS báo đã thanh toán; khách nhập thông tin hoá đơn công ty trước khi khoá giỏ; trang quản trị có trạng thái DS Smart POS, đơn đẩy lỗi, đơn treo, đối soát BRG và DS Smart POS.
- **Bỏ trong chế độ DS Smart POS:** BRG xuất hoá đơn (DS Smart POS xuất, BRG nhận số hoá đơn), tick 3 điều kiện chuyển khoản, đối soát sao kê trong BRG.

Lợi ích thêm: giao dịch Scan & Checkout **tự vào DS Smart POS** (tồn kho, doanh thu, kế toán), giải quyết khoảng trống G-05 và mục 10, 11 trong "Điểm cần chốt".

## Quyết định nghiệp vụ mới

| Vấn đề | Đề xuất |
|--------|---------|
| Giá DS Smart POS khác tạm tính | DS Smart POS là chuẩn; hiện chênh lệch cho thu ngân, cập nhật số tiền cho khách, ghi nhật ký |
| Đơn DS Smart POS tạo mà khách bỏ đi | Chỉ tạo đơn khi thu ngân quét; tự huỷ đơn treo sau thời gian ngắn (ví dụ 15 phút); huỷ ở DS Smart POS khi thu ngân huỷ giỏ |
| Ai giữ sự thật "đã thu tiền" | DS Smart POS; BRG phát QR sau khi DS Smart POS báo đã thanh toán **và** thu ngân xác nhận |
| Tiền mặt và két | Két do DS Smart POS đối soát; màn đối soát tiền mặt của BRG chỉ tham khảo hoặc bỏ. Cần chốt |
| Hoá đơn công ty | Khách nhập mã số thuế trước khi khoá giỏ, gửi cùng đơn |
| DS Smart POS mất kết nối | Thu thủ công như hiện nay, cần quản lý duyệt, đánh dấu để nhập bù vào DS Smart POS; hoặc tạm dừng Scan & Checkout |
| Hoàn tiền, trả hàng | Làm trên DS Smart POS; BRG hiện trạng thái |
| Đối soát mỗi ngày | So từng giao dịch BRG với đơn DS Smart POS (có đơn, đúng số tiền, đã thanh toán) |

## Cần hỏi bên DS Smart POS

1. Tên và phiên bản DS Smart POS; chạy tại quầy hay đám mây.
2. API tạo đơn (hoặc đơn treo, nháp) từ bên ngoài, nhận mặt hàng theo mã vạch hoặc SKU và số lượng.
3. API hoặc thông báo khi đơn đã thanh toán hoặc huỷ; trả về cách trả, số tiền, **số hoá đơn điện tử**.
4. Huỷ đơn từ bên ngoài; đơn treo có tự hết hạn không.
5. Gán đơn cho máy hoặc thu ngân cụ thể, hay thu ngân tìm đơn bằng số.
6. DS Smart POS có tự tính lại giá và khuyến mãi (khuyến mãi theo hoá đơn, giảm theo thành viên, làm tròn).
7. Nhận thông tin xuất hoá đơn công ty cùng đơn.
8. Môi trường thử, tài liệu, khoá truy cập, giới hạn gọi; đánh dấu đơn đến từ "Scan & Checkout".
9. Nếu không có API: DS Smart POS có nhập đơn từ file, có cho viết tiện ích, hay chỉ có giao diện bán hàng.

## Các bước

A. Hỏi bên DS Smart POS, chọn phương án. B. Viết lớp kết nối DS Smart POS (tạo đơn, hỏi trạng thái, huỷ) và thử trên môi trường thử, gồm các tình huống lệch giá, mất kết nối, trùng đơn. C. Sửa app thu ngân, app khách, trang quản trị và hướng dẫn nghiệp vụ. D. Thí điểm ở một quầy, so BRG với DS Smart POS mỗi ngày rồi mở rộng. Công sức: phương án 1 vài tuần sau khi có tài liệu API và môi trường thử (ước lượng, chưa xác nhận).

## Chỗ cắm trong mã hiện tại

Điểm gắn là một lớp kết nối DS Smart POS mới bên cạnh `server/services/pos.js` (hiện chỉ đọc giá, tồn kho): `createOrder(giao dịch)`, `getOrder(mã đơn)`, `cancelOrder(mã đơn)`, kèm tuyến nhận thông báo từ DS Smart POS, và các cột lưu mã đơn DS Smart POS, trạng thái DS Smart POS, tổng DS Smart POS, số hoá đơn DS Smart POS trên giao dịch. Cờ cấu hình `paymentSource` (`manual` hoặc `pos`) theo từng chi nhánh quyết định dùng luồng nào.
