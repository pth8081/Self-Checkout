# 14. Phương án: giỏ hàng tự vào Dsmart POS, thu tiền và hóa đơn tại Dsmart POS

**Trạng thái:** Đã chọn hướng và làm phần máy chủ. Khách hàng trả lời: Dsmart POS chưa có API nhưng **BRG cung cấp API để Dsmart POS gọi** (Dsmart POS quét mã giỏ rồi gọi BRG lấy mặt hàng), Dsmart POS sẽ **báo thanh toán thành công về BRG và BRG tự xác nhận** (thu ngân không kiểm nữa), việc **hủy đơn do Dsmart POS làm** (và báo về BRG), và khách hàng có **môi trường thử**. Nghĩa là thay vì "BRG đẩy đơn vào Dsmart POS" (phương án 1 bên dưới), ta làm theo hướng **Dsmart POS kéo giỏ từ BRG**. Tài liệu cho nhà cung cấp Dsmart POS: [api-pos.md](api-pos.md). Hướng dẫn cho quản trị: mục "Kết nối Dsmart POS" trong web quản trị. Phân tích ban đầu giữ lại bên dưới để tham khảo.

## Yêu cầu

Khách quét hàng và khóa giỏ; thu ngân quét mã giỏ hàng thì các mặt hàng **tự nhập vào Dsmart POS** để tính tiền. Thu tiền (QR, tiền mặt) và hóa đơn điện tử dùng của Dsmart POS. Quy trình xác nhận của thu ngân và bảo vệ cổng ra **giữ nguyên**.

## Ba phương án

| | 1. Đẩy đơn qua API (khuyến nghị nếu Dsmart POS có API) | 2. Cầu nối tại quầy tự nhập | 3. Nhập đơn bằng file hoặc mã |
|-|-|-|-|
| Cách làm | BRG gọi API Dsmart POS tạo đơn khi thu ngân quét mã; thu ngân thu tiền trên Dsmart POS | Chương trình trên máy thu ngân tự gõ mã vạch và số lượng vào Dsmart POS | BRG xuất file Dsmart POS nhập được, hoặc Dsmart POS có ô đọc mã giỏ |
| Dsmart POS cần | API tạo đơn, trạng thái thanh toán, hủy đơn, môi trường thử | Ô nhập mã vạch ổn định | Chức năng nhập đơn hoặc tiện ích mở rộng |
| Ưu | Chắc chắn, Dsmart POS tính giá, tiền, hóa đơn | Làm được với Dsmart POS cũ | Không cần API đầy đủ |
| Rủi ro | Phụ thuộc chất lượng API; đơn tạo mà không thanh toán phải tự hủy | Mong manh khi Dsmart POS đổi giao diện; không biết chắc đã thanh toán | Thêm thao tác thu ngân; khó lấy trạng thái thanh toán |

Phương án 0 (hiện tại: BRG tự thu tiền, thu ngân tick xác nhận) là dự phòng cho cả ba, chọn theo từng chi nhánh.

## Luồng đề xuất (phương án 1)

1. Khách khóa giỏ, chọn "Thanh toán tại quầy" (bỏ màn QR chuyển khoản của BRG), nhận mã giỏ hàng.
2. Thu ngân quét mã. BRG tạo đơn trên Dsmart POS (mã giao dịch làm khóa chống trùng). Dsmart POS trả số đơn, giá và khuyến mãi Dsmart POS tính, tổng tiền.
3. Thu ngân thấy đơn đã nhập, so tổng Dsmart POS với tạm tính. Thu tiền trên Dsmart POS; Dsmart POS xuất hóa đơn điện tử.
4. Dsmart POS báo đã thanh toán (kèm cách trả, số hóa đơn). Nút xác nhận của BRG bật lên.
5. Thu ngân đối chiếu rồi bấm xác nhận (giữ nguyên). Khách nhận QR biên nhận và số hóa đơn.
6. Bảo vệ quét QR, kiểm tra ngẫu nhiên: không đổi.

## Giữ, đổi, bỏ

- **Giữ:** quét và giỏ của khách, QR biên nhận ký dùng một lần, cổng ra, kiểm tra ngẫu nhiên, chênh lệch, thu bổ sung, quản lý duyệt, ca, nhật ký, báo cáo, phân quyền.
- **Đổi hoặc thêm:** chế độ thu tiền "Dsmart POS" theo từng chi nhánh; thu ngân thấy đơn Dsmart POS và trạng thái; xác nhận chỉ bật khi Dsmart POS báo đã thanh toán; khách nhập thông tin hóa đơn công ty trước khi khóa giỏ; trang quản trị có trạng thái Dsmart POS, đơn đẩy lỗi, đơn treo, đối soát BRG và Dsmart POS.
- **Bỏ trong chế độ Dsmart POS:** BRG xuất hóa đơn (Dsmart POS xuất, BRG nhận số hóa đơn), tick 3 điều kiện chuyển khoản, đối soát sao kê trong BRG.

Lợi ích thêm: giao dịch Scan & Checkout **tự vào Dsmart POS** (tồn kho, doanh thu, kế toán), giải quyết khoảng trống G-05 và mục 10, 11 trong "Điểm cần chốt".

## Quyết định nghiệp vụ mới

| Vấn đề | Đề xuất |
|--------|---------|
| Giá Dsmart POS khác tạm tính | Dsmart POS là chuẩn; hiện chênh lệch cho thu ngân, cập nhật số tiền cho khách, ghi nhật ký |
| Đơn Dsmart POS tạo mà khách bỏ đi | Chỉ tạo đơn khi thu ngân quét; tự hủy đơn treo sau thời gian ngắn (ví dụ 15 phút); hủy ở Dsmart POS khi thu ngân hủy giỏ |
| Ai giữ sự thật "đã thu tiền" | Dsmart POS; BRG phát QR sau khi Dsmart POS báo đã thanh toán **và** thu ngân xác nhận |
| Tiền mặt và két | Két do Dsmart POS đối soát; màn đối soát tiền mặt của BRG chỉ tham khảo hoặc bỏ. Cần chốt |
| Hóa đơn công ty | Khách nhập mã số thuế trước khi khóa giỏ, gửi cùng đơn |
| Dsmart POS mất kết nối | Thu thủ công như hiện nay, cần quản lý duyệt, đánh dấu để nhập bù vào Dsmart POS; hoặc tạm dừng Scan & Checkout |
| Hoàn tiền, trả hàng | Làm trên Dsmart POS; BRG hiện trạng thái |
| Đối soát mỗi ngày | So từng giao dịch BRG với đơn Dsmart POS (có đơn, đúng số tiền, đã thanh toán) |

## Cần hỏi bên Dsmart POS

1. Tên và phiên bản Dsmart POS; chạy tại quầy hay đám mây.
2. API tạo đơn (hoặc đơn treo, nháp) từ bên ngoài, nhận mặt hàng theo mã vạch hoặc SKU và số lượng.
3. API hoặc thông báo khi đơn đã thanh toán hoặc hủy; trả về cách trả, số tiền, **số hóa đơn điện tử**.
4. Hủy đơn từ bên ngoài; đơn treo có tự hết hạn không.
5. Gán đơn cho máy hoặc thu ngân cụ thể, hay thu ngân tìm đơn bằng số.
6. Dsmart POS có tự tính lại giá và khuyến mãi (khuyến mãi theo hóa đơn, giảm theo thành viên, làm tròn).
7. Nhận thông tin xuất hóa đơn công ty cùng đơn.
8. Môi trường thử, tài liệu, khóa truy cập, giới hạn gọi; đánh dấu đơn đến từ "Scan & Checkout".
9. Nếu không có API: Dsmart POS có nhập đơn từ file, có cho viết tiện ích, hay chỉ có giao diện bán hàng.

## Các bước

A. Hỏi bên Dsmart POS, chọn phương án. B. Viết lớp kết nối Dsmart POS (tạo đơn, hỏi trạng thái, hủy) và thử trên môi trường thử, gồm các tình huống lệch giá, mất kết nối, trùng đơn. C. Sửa app thu ngân, app khách, trang quản trị và hướng dẫn nghiệp vụ. D. Thí điểm ở một quầy, so BRG với Dsmart POS mỗi ngày rồi mở rộng. Công sức: phương án 1 vài tuần sau khi có tài liệu API và môi trường thử (ước lượng, chưa xác nhận).

## Chỗ cắm trong mã hiện tại

Điểm gắn là một lớp kết nối Dsmart POS mới bên cạnh `server/services/pos.js` (hiện chỉ đọc giá, tồn kho): `createOrder(giao dịch)`, `getOrder(mã đơn)`, `cancelOrder(mã đơn)`, kèm tuyến nhận thông báo từ Dsmart POS, và các cột lưu mã đơn Dsmart POS, trạng thái Dsmart POS, tổng Dsmart POS, số hóa đơn Dsmart POS trên giao dịch. Cờ cấu hình `paymentSource` (`manual` hoặc `pos`) theo từng chi nhánh quyết định dùng luồng nào.
