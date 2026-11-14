# Tra giá theo mã vạch bằng API giá của đối tác (BRGMART)

Khi khách quét mã vạch, BRG Scan & Checkout tra giá bán hiện tại bằng API giá của đối tác (tài liệu của đối tác, bản 1.1). Giá trên điện thoại chỉ là **tạm tính**; số tiền cuối cùng do Dsmart POS tính lại.

## Cách hoạt động

1. Khách quét mã vạch (EAN-13).
2. BRG kiểm tra giá đã lưu của mặt hàng đó ở chi nhánh. Còn mới (mặc định 5 phút) thì dùng luôn, **không gọi API**. Nhờ vậy nhiều khách cùng quét một mặt hàng chỉ gọi API một lần.
3. Chưa có hoặc đã cũ thì gọi `GET <địa chỉ API>?maVach=<mã vạch>&maDiem=<mã điểm chi nhánh>` kèm header `X-API-Key`, chờ tối đa 3 giây (đổi được).
4. Đơn giá là `giaKhuyenMai` nếu `coKhuyenMai` là true, không thì `giaThuong`. Điện thoại hiện giá gốc gạch ngang kèm giá khuyến mại. Tên hàng lấy từ `tenHang`, nên BRG **không cần danh mục sản phẩm**.

**Mã điểm (`maDiem`)** là mã điểm đã gán cho chi nhánh trong BRG, trùng với mã điểm bên đối tác và Dsmart POS (xem phần file mã điểm).

## Khi tra giá không được

| Tình huống | BRG làm gì |
|------------|-----------|
| API không trả lời trong thời gian chờ, lỗi `5xx`, `429` | Dùng giá đã lưu gần nhất (kể cả đã cũ). Chưa có giá nào đã lưu thì thêm vào giỏ ở dạng **"Chưa có giá"** |
| `404` (chưa khai giá cho mã vạch này) | Thêm vào giỏ ở dạng "Chưa có giá" và ghi vào trang **Mã không tìm thấy** cho quản trị. Nhớ kết quả này khoảng 1 phút để không gọi dồn |
| `401`, `403` (khóa sai hoặc chưa được cấp quyền) | Như lỗi API, đồng thời hiện **cảnh báo ở trang Tích hợp** ("Lần tra giá lỗi gần nhất") |

Mặt hàng "Chưa có giá" **vẫn nằm trong giỏ**, không cộng vào tạm tính, khách vẫn thanh toán bình thường. Dsmart POS nhận mã vạch và số lượng của mặt hàng đó (`name` và `unitPrice` là `null`) và tự tính giá.

## File mã điểm (nhập ở trang Tích hợp)

Quản trị chuỗi nhập file danh sách mã điểm giống bên đối tác ở **Tích hợp > Mã điểm (file của đối tác)**. File CSV hoặc TXT (UTF-8), ngăn cột bằng `,` `;` hoặc tab, dòng đầu là tên cột:

| Cột | Bắt buộc | Ý nghĩa |
|-----|----------|---------|
| `maDiem` | **Có** | Mã điểm. Chữ, số, `- _ . /`, tối đa 40 ký tự |
| `maChiNhanh` | Không | Mã chi nhánh trong BRG (ví dụ `Q7`), dùng để ghép |
| `tenDiem` | Không | Tên điểm, dùng để ghép theo tên chi nhánh (không phân biệt hoa thường và dấu) |

```
maDiem;maChiNhanh;tenDiem
001;Q7;Chi nhánh Quận 7
002;;Chi nhánh Gò Vấp
003;;Điểm chưa có chi nhánh trên BRG
```

Các bước: chọn file, **xem trước** (mỗi dòng báo "Sẽ gán", "Đã đúng", "Chưa ghép", "Lặp trong file", "Mã không hợp lệ", "Trùng chi nhánh"), rồi bấm **Áp dụng**. Xem trước không đổi gì. Khi áp dụng:
- Dòng "Sẽ gán": gán mã điểm cho chi nhánh (đổi cả mã cũ nếu khác).
- Dòng "Chưa ghép": vẫn lưu vào danh sách mã điểm, ghép sau bằng cách nhập mã điểm ở trang Chi nhánh.
- Sau khi đã có danh sách, mã điểm nhập tay ở trang Chi nhánh phải nằm trong danh sách (sai thì báo `POS_CODE_NOT_IN_LIST`).
- Nhập lại file nhiều lần an toàn.

## Cấu hình API giá

**Tích hợp > API giá bán (đối tác)** (chỉ quản trị chuỗi):

| Mục | Ý nghĩa |
|-----|---------|
| Địa chỉ API | Chỉ địa chỉ, không kèm `?maVach=...`. Phải là `https://` (chỉ `localhost` mới được `http://`) |
| Khóa API | Gửi trong header `X-API-Key`. Lưu mã hóa, không hiện lại; bỏ trống khi lưu thì giữ khóa cũ |
| Thời gian chờ | 1 đến 15 giây, mặc định 3 |
| Giữ giá đã tra | 1 đến 60 phút, mặc định 5 |
| Dùng API giá | Công tắc bật. Cần đã có địa chỉ và khóa |
| Kiểm tra thử | Chọn chi nhánh và nhập mã vạch, bấm **Tra giá** để thấy kết quả thật và thời gian trả lời |

Khi **tắt** API giá, hệ thống quay về cách cũ (tra trong danh mục sản phẩm đã nhập, chủ yếu dùng khi chạy thử).

## Lưu ý

- Dữ liệu giá của đối tác đồng bộ 15 phút một lần, nên giá trên điện thoại có thể chậm tối đa chừng đó so với thực tế.
- API giá chỉ trả giá, **không có** cờ hàng giới hạn độ tuổi, ngừng bán, tồn kho. Các cảnh báo này không hiện khi dùng API giá; thu ngân tự kiểm tra giấy tờ.
- Khuyến mại kiểu "mua N giảm" hoặc combo không nằm trong API này. Dsmart POS vẫn tính đúng khi thu tiền.
- Hỏi đối tác thêm: giới hạn số lần gọi mỗi phút, môi trường thử, mã vạch ngoài EAN-13, hàng cân ký.
