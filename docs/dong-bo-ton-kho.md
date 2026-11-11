# Đồng bộ tồn kho từ API đối tác

BRG Scan & Checkout lấy tồn kho của tất cả siêu thị từ **API tồn kho của đối tác** (`GET /api/v1/reports/ton-kho/run`, xác thực `X-API-Key`), ghép với chi nhánh bằng **`maDiem` = mã điểm** của chi nhánh, và lưu vào bảng `stock_levels`.

## Cấu hình (Quản trị chuỗi, trang Tích hợp, thẻ "Tồn kho (API đối tác)")

| Mục | Ý nghĩa |
|-----|---------|
| Địa chỉ API | Chỉ địa chỉ, không kèm `?page=...`. Ví dụ `https://api.hcrc.vn/api/v1/reports/ton-kho/run` |
| Khóa API | Lưu mã hóa, không hiện lại. **Đối tác phải đăng ký địa chỉ IP của máy chủ BRG** cho khóa này (nếu không sẽ báo 403) |
| Chu kỳ đồng bộ | 15 đến 1440 phút (dữ liệu đối tác cập nhật mỗi 15 phút, khuyến nghị 15 đến 30) |
| Số dòng mỗi trang | 50 đến 1000 |
| Thời gian chờ mỗi trang | 5 đến 120 giây |

## Cách đồng bộ

- API **có phân trang**: BRG gọi `page=1,2,3...` (kèm `fields=maHang,maVach,tenHang,soLuongTon,maDiem,capNhatLuc`) cho tới khi số dòng trả về ít hơn số dòng mỗi trang.
- Dòng có `maDiem` chưa gán cho chi nhánh nào thì bỏ qua và liệt kê ở kết quả (để nhập mã điểm cho đúng).
- Chỉ ghi dòng có thay đổi. Mặt hàng không còn trong dữ liệu đối tác (ở các chi nhánh có xuất hiện lần này) bị bỏ khỏi bảng. Lần lỗi giữa chừng thì **không xóa gì**, dữ liệu cũ giữ nguyên.
- Gặp `429` thì chờ theo `Retry-After` và thử lại tối đa 3 lần.
- Chạy tự động theo chu kỳ (công việc nền, kiểm tra mỗi phút) hoặc bấm **Đồng bộ ngay**.
- Tồn kho này hiện dùng để báo "còn hàng / hết hàng" khi khách tra mặt hàng. Việc bán hàng và số tiền vẫn do Dsmart POS quyết định.

## Cách kiểm tra đã đồng bộ đúng

1. **Kiểm tra kết nối**: lấy 5 dòng đầu, báo thiếu cột bắt buộc (`maHang`, `soLuongTon`, `maDiem`) và cho biết mã điểm nào ghép được chi nhánh nào.
2. **Kết quả đồng bộ gần nhất**: thành công hay lỗi, số dòng đọc, số trang, số dòng ghép được, chưa ghép, ghi mới hoặc đổi, không đổi, bỏ; thời điểm đối tác chốt số liệu (`capNhatLuc`); mã điểm chưa ghép.
3. **Bảng theo chi nhánh**: số mã hàng có tồn, số mã hết hàng, đối tác chốt lúc, BRG đồng bộ lúc.
4. **Đối chiếu một mặt hàng**: nhập mã hàng hoặc mã vạch để xem tồn ở từng chi nhánh, so với dữ liệu của đối tác.

Dữ liệu giữa hai lần đồng bộ có độ trễ tối đa bằng chu kỳ cộng 15 phút của đối tác.
