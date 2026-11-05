# Mã QR giỏ hàng cho phần mềm POS

**Mục đích:** khách tự quét hàng bằng điện thoại, bấm Thanh toán, điện thoại hiện **một mã QR chứa toàn bộ món (mã vạch và số lượng)**. Thu ngân quét mã này vào POS, POS tạo đơn, **tính lại giá và khuyến mãi theo hệ thống của POS**, thu tiền. Thu ngân không quét từng món, khách không đứng chờ.

POS **không cần gọi API của BRG**. Mọi thứ POS cần nằm trong mã QR. Nhờ vậy POS dùng được cả khi mạng chập chờn.

## 1. Định dạng

Một chuỗi văn bản ASCII, các phần ngăn bằng `|`:

```
BRG1|<mã điểm>|<mã giỏ>|<giờ>|<mã vạch>*<số lượng>,<mã vạch>*<số lượng>,...|T<tạm tính>|<CRC16>
```

Ví dụ:

```
BRG1|SP-0107|Q7-LM3K2AB|1762330000|8936036123456*2,8934567890123*1|T95000|3F2A
```

| Phần | Ý nghĩa |
|------|---------|
| `BRG1` | Nhận dạng và phiên bản. Chuỗi không bắt đầu bằng `BRG1|` thì không phải mã của BRG |
| mã điểm | Mã siêu thị trong hệ thống giá và POS (do quản trị nhập cho từng chi nhánh). POS nên **kiểm tra trùng với điểm bán của máy POS đang dùng**, khác thì báo thu ngân |
| mã giỏ | Mã định danh giỏ, duy nhất. POS **lưu mã này để không tạo đơn hai lần** nếu mã bị quét lại |
| giờ | Giờ tạo giỏ, giây Unix |
| món | Mã vạch và số lượng. Cùng mã vạch đã được gộp thành một dòng. Số lượng 1 đến 999 |
| `T` | **Tạm tính** do BRG tính (VND). Chỉ để đối chiếu, không dùng làm số tiền thu |
| CRC16 | CRC16-CCITT (đa thức 0x1021, khởi tạo 0xFFFF), viết hoa 4 ký tự hex, tính trên toàn bộ chuỗi đứng trước dấu `|` cuối cùng |

## 2. POS cần làm

1. Quét QR, kiểm tra tiền tố `BRG1|` và CRC16. Sai thì báo "Mã không hợp lệ, nhờ khách tạo lại".
2. Kiểm tra mã điểm đúng cửa hàng.
3. Kiểm tra mã giỏ chưa dùng. Đã dùng thì báo "Giỏ này đã được tạo đơn" và cho thu ngân mở lại đơn cũ.
4. Với mỗi dòng, tìm sản phẩm theo mã vạch, thêm vào đơn đúng số lượng. Mã vạch không có trong POS thì báo thu ngân để xử lý tại chỗ.
5. POS tính giá và khuyến mãi theo quy tắc của POS. Số tiền thu là số tiền của POS.
6. Thu tiền, xuất hoá đơn như đơn thường. POS tự trừ tồn kho. **BRG không quản lý tồn kho.**

## 3. Báo kết quả về BRG (không bắt buộc)

BRG vẫn nhận báo thanh toán và huỷ theo [api-pos.md](api-pos.md), lấy **mã giỏ** làm mã tra. Làm phần này thì màn hình khách tự chuyển sang "Đã thanh toán", và BRG ghi số tiền thật, số hoá đơn. Không làm thì khách tự bấm "Đã thanh toán xong" trên điện thoại.

## 4. Mã QR còn khi khách mất mạng

Điện thoại tạo mã QR ngay trên máy và lưu lại. Mất mạng, tắt điện thoại hoặc tắt trình duyệt, khách mở lại link cửa hàng là thấy lại cùng mã. Khi khách sửa giỏ rồi bấm Thanh toán lại, mã giỏ **đổi**; mã cũ không còn đúng.

## 5. Thử

Khi chưa có POS, dùng mã QR ví dụ ở mục 1 hoặc xem mã trong trang Thanh toán của ứng dụng. Mã mẫu có thể kiểm bằng hàm `decodeBasket` trong `public/shared/basket.js` (JavaScript, không phụ thuộc thư viện), cùng quy tắc với POS.
