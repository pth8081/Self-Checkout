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

## 3. Báo kết quả thanh toán về BRG (POS gọi tự động)

Sau khi thu tiền xong, POS **tự động** gọi BRG. BRG ghi nhận, màn hình khách chuyển sang **"Đã hoàn thành thanh toán"** và khách có nút **Xem bill** và **Tải bill PDF**. Xác thực như [api-pos.md](api-pos.md) (khoá API trong `Authorization: Bearer <khoá>`).

`POST /api/pos/v1/baskets/{mã giỏ}/paid`

```json
{
  "posOrderRef": "POS-20261105-000123",
  "amount": 93800,
  "method": "qr_transfer",
  "invoiceNo": "C26TAA-123",
  "invoiceUrl": "https://hddt.example.vn/tra-cuu/abc",
  "cashier": "Lan",
  "terminal": "QUAY-02",
  "lines": [
    { "barcode": "8936036123456", "name": "Sữa tươi 1L", "qty": 2, "unitPrice": 29000, "discount": 0, "lineTotal": 58000 },
    { "barcode": "8934567890123", "name": "Mì ăn liền tôm", "qty": 1, "unitPrice": 4800, "discount": 2000, "lineTotal": 2800 }
  ]
}
```

| Trường | Bắt buộc | Ý nghĩa |
|--------|----------|---------|
| `posOrderRef` | Có | Mã đơn trên POS. **Khoá chống trùng**: gửi lại cùng mã giỏ với cùng `posOrderRef` thì BRG không ghi lần hai |
| `amount` | Có | Số tiền thực thu, VND, số nguyên |
| `method` | Có | `cash`, `qr_transfer`, `card`, `ewallet` |
| `lines` | Nên có | Các dòng của bill POS (giá và khuyến mãi thật). Có thì khách thấy bill thật; không có thì khách thấy bản tạm tính, ghi rõ "chưa có bill chính thức" |
| `invoiceNo`, `invoiceUrl` | Nên có | Số và đường dẫn (https) tới hoá đơn điện tử của POS |
| `cashier`, `terminal` | Không | Hiện trong bill và báo cáo |

Các lệnh khác: `GET /api/pos/v1/baskets/{mã giỏ}` (trạng thái, để POS kiểm tra) và `POST .../cancelled` (POS huỷ đơn, body `posOrderRef`, `reason`).

### Quy tắc thử lại (POS thực hiện)

Mạng có thể chập chờn nên **POS phải thử lại cho tới khi BRG trả thành công**. BRG xử lý gửi trùng an toàn, nên thử lại không gây thu hai lần.

| Phản hồi của BRG | POS làm |
|------------------|---------|
| `200` (kể cả `duplicate: true`) | Thành công, dừng |
| Không có phản hồi, timeout, `5xx`, `429` | Thử lại |
| `404 BASKET_NOT_FOUND` | Thử lại: điện thoại khách có thể đang mất mạng nên giỏ chưa lên hệ thống |
| `400`, `401`, `403`, `409 REF_IN_USE`, `409 ORDER_CANCELLED` | **Không** thử lại; ghi lỗi để người quản lý xử lý |

Lịch thử lại đề xuất: lần 1 ngay lập tức, rồi sau 5 giây, 30 giây, 2 phút (tổng 4 lần). Hết 4 lần vẫn chưa được thì POS **giữ đơn trong hàng đợi và thử lại mỗi 5 phút**, tối đa 24 giờ, và báo cho quản lý cửa hàng. Gửi cùng nội dung ở mọi lần thử.

### Khi POS chưa báo được

Khách vẫn bấm được **"Đã thanh toán xong"** trên điện thoại để kết thúc giỏ. Giao dịch này BRG ghi là *đã chuyển POS, chưa được POS xác nhận*, khác với giao dịch POS đã báo. Khi POS báo muộn, BRG cập nhật thành đã thanh toán, kèm số tiền thật và bill.

### Bill khách xem và tải

- Khách xem bill ngay trong ứng dụng web, và tải bản **PDF** để lưu. Bill lưu trên điện thoại để xem lại khi mất mạng (PDF cần mạng để tải).
- Khách xem lại bill trong mục Lịch sử mua sắm.
- Hiện bill chỉ có trên ứng dụng và PDF; không in giấy.

## 4. Mã QR còn khi khách mất mạng

Điện thoại tạo mã QR ngay trên máy và lưu lại. Mất mạng, tắt điện thoại hoặc tắt trình duyệt, khách mở lại link cửa hàng là thấy lại cùng mã. Khi khách sửa giỏ rồi bấm Thanh toán lại, mã giỏ **đổi**; mã cũ không còn đúng.

## 5. Thử

Khi chưa có POS, dùng mã QR ví dụ ở mục 1 hoặc xem mã trong trang Thanh toán của ứng dụng. Mã mẫu có thể kiểm bằng hàm `decodeBasket` trong `public/shared/basket.js` (JavaScript, không phụ thuộc thư viện), cùng quy tắc với POS.
