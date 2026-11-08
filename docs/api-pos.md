# API cho phần mềm POS gọi vào BRG Scan & Checkout

Tài liệu cho **nhà cung cấp POS**. Phiên bản API: `v1`.

## 1. Bối cảnh và luồng

Khách tự quét hàng bằng điện thoại và khoá giỏ. Điện thoại khách hiện **mã QR chứa mã giỏ hàng** dạng `GH-Q7-10001` (QR chỉ chứa đúng chuỗi này, văn bản thuần). Thu ngân quét mã đó **ngay trong POS**. Với mỗi lần quét, POS gọi API của BRG Scan & Checkout để lấy danh sách mặt hàng, tự nhập vào đơn, thu tiền trên POS (QR, tiền mặt, thẻ...), rồi báo kết quả về BRG Scan & Checkout. **BRG Scan & Checkout tự xác nhận khi POS báo đã thanh toán**, khách nhận mã ra cổng hoặc ra luôn; thu ngân không phải thao tác thêm trên BRG Scan & Checkout.

```
Khách          POS (thu ngân)                 BRG Scan & Checkout
  │ đưa mã GH-Q7-10001 │                         │
  │───────────────────►│ POST /carts/{mã}/claim  │
  │                    │────────────────────────►│ trả danh sách mặt hàng
  │                    │◄────────────────────────│
  │                    │ tạo đơn, thu tiền, xuất hoá đơn
  │                    │ POST /orders/{mã đơn}/paid
  │                    │────────────────────────►│ tự xác nhận, mở khoá cho khách
  │◄───────── (màn hình khách tự chuyển sang "đã thanh toán")
```

Nếu thu ngân huỷ đơn trên POS, POS gọi `POST /orders/{mã đơn}/cancelled`.

Điều kiện: chi nhánh đã bật **chế độ thu tiền qua POS** trong web quản trị của BRG Scan & Checkout, và POS có **khoá API**.

## 2. Quy ước chung

| | |
|---|---|
| Địa chỉ cơ sở | `https://scan.hcrc.vn/api/pos/v1` (**bắt buộc HTTPS** ở môi trường thật) |
| Định dạng | JSON UTF-8, `Content-Type: application/json` |
| Tiền | **Số nguyên, đơn vị đồng** (VND), ví dụ `112800` |
| Thời gian | ISO 8601, ví dụ `2026-11-05T09:30:00+07:00` |
| Xác thực | Header `Authorization: Bearer <khoá API>` (hoặc `X-Api-Key: <khoá>`) |
| Khoá API | Do quản trị chuỗi của khách hàng tạo ở web quản trị (mục Tích hợp), chỉ hiện **một lần**, có thể giới hạn theo chi nhánh, thu hồi được. Khoá bắt đầu bằng `brgpos_` |
| Lỗi | HTTP 4xx kèm JSON `{ "error": "MÃ_LỖI", "message": "Mô tả tiếng Việt", ... }` |

**Idempotent:** mọi lời gọi ghi (`claim`, `paid`, `cancelled`) đều an toàn khi **gọi lại cùng `posOrderRef`** (ví dụ do mất mạng, hết thời gian chờ). Gọi lại không tạo trùng, trả về kết quả như lần đầu kèm `"duplicate": true`. POS nên **thử lại** khi gặp lỗi mạng hoặc 5xx.

`posOrderRef` là **mã đơn của POS**, do POS đặt, duy nhất, tối đa 64 ký tự gồm chữ, số và `. _ : / -`. BRG Scan & Checkout dùng mã này để nhận ra các lời gọi sau của cùng một đơn.

## 3. Các lời gọi

### 3.1 Kiểm tra kết nối

`GET /health`

```json
{ "ok": true, "key": "Tên khoá", "storeScope": "all" }
```

`storeScope` là `all` hoặc mã chi nhánh nếu khoá bị giới hạn.

### 3.2 Xem trước giỏ hàng (không nhận)

`GET /carts/{mã giỏ}`

Trả giỏ như ở 3.3 nhưng **không** gắn vào đơn POS. Dùng để hiển thị trước khi nhận, hoặc kiểm tra trạng thái.

### 3.3 Nhận giỏ hàng

`POST /carts/{mã giỏ}/claim`

```json
{ "posOrderRef": "A-20481", "cashier": "thu01", "terminal": "Q1" }
```

`posOrderRef` bắt buộc. `cashier` (mã hoặc tên thu ngân) và `terminal` (quầy) tuỳ chọn, chỉ để ghi nhật ký.

Thành công (HTTP 200):

```json
{
  "claimed": true,
  "duplicate": false,
  "cart": {
    "code": "GH-Q7-10001",
    "transactionId": "SG-Q7-10001",
    "storeId": "Q7",
    "status": "awaiting_counter",
    "posStatus": "claimed",
    "posOrderRef": "A-20481",
    "subtotal": 62800,
    "discount": 0,
    "total": 62800,
    "itemCount": 3,
    "ageRestricted": false,
    "buyer": { "email": "khach@example.com" },
    "createdAt": "2026-11-05T02:28:58.551Z",
    "items": [
      { "sku": "SUA02", "barcode": "8930040001373", "name": "Sữa chua uống men sống (lốc 4)",
        "qty": 2, "unitPrice": 29000, "discount": 0, "lineTotal": 58000 },
      { "sku": "MI01", "barcode": "8930040002745", "name": "Mì ăn liền tôm chua cay (gói)",
        "qty": 1, "unitPrice": 4800, "discount": 0, "lineTotal": 4800 }
    ]
  }
}
```

Cách dùng dữ liệu:

- **`items`**: mỗi dòng có `barcode` và `sku` của POS (BRG Scan & Checkout lấy giá từ chính POS, nên mã khớp), `qty` và giá đã chốt lúc khách khoá giỏ. Nếu BRG Scan & Checkout và POS dùng chung một nguồn giá theo chi nhánh (xem [api-gia-chi-nhanh](api-gia-chi-nhanh.md)) thì POS dùng đúng giá trong `items`; nếu không, POS tính lại theo quy tắc của POS. Dù cách nào, số tiền POS thu mới là số tiền thật (xem 3.5).
- **`total`** chỉ là **tạm tính** của BRG Scan & Checkout, để đối chiếu.
- **`buyer`**: thông tin người mua nếu khách nhập trước khi khoá giỏ. Có `email` thì gửi hoá đơn về đó. Có thêm `taxCode`, `companyName`, `address` thì khách muốn **hoá đơn công ty**: POS xuất hoá đơn với các thông tin này. `null` nếu khách không nhập (xuất hoá đơn bán lẻ).
- **`ageRestricted`**: giỏ có hàng giới hạn độ tuổi (rượu, bia, thuốc lá); thu ngân cần kiểm tra giấy tờ.

Sau khi nhận, **khách không sửa được giỏ** nữa. Giỏ giữ đến khi POS báo thanh toán hoặc huỷ.

### 3.4 Hỏi trạng thái đơn

`GET /orders/{posOrderRef}`

```json
{
  "posOrderRef": "A-20481", "code": "GH-Q7-10001", "transactionId": "SG-Q7-10001",
  "status": "paid", "posStatus": "paid", "total": 62800, "paidAmount": 60800,
  "exitStatus": "none", "guardCheck": true
}
```

### 3.5 Báo đã thanh toán

`POST /orders/{posOrderRef}/paid`

```json
{
  "amount": 60800,
  "method": "qr_transfer",
  "invoiceNo": "HD0001234",
  "cashier": "thu01",
  "terminal": "Q1",
  "paidAt": "2026-11-05T09:31:12+07:00"
}
```

| Trường | Bắt buộc | Ý nghĩa |
|--------|:--------:|---------|
| `amount` | có | Số tiền POS **thực thu**, số nguyên dương. Có thể khác `total` tạm tính (khuyến mãi theo hoá đơn, làm tròn). BRG Scan & Checkout **chấp nhận** và ghi nhận số tiền này, đánh dấu để báo cáo nếu lệch |
| `method` | có | `cash`, `qr_transfer`, `card`, `ewallet` hoặc `other` |
| `invoiceNo` | nên có | Số hoá đơn điện tử POS đã phát hành, để hiện cho khách và đối soát |
| `cashier`, `terminal`, `paidAt` | không | Ghi nhật ký |

Thành công (HTTP 200):

```json
{ "ok": true, "duplicate": false, "transactionId": "SG-Q7-10001", "status": "paid",
  "guardCheck": true, "exitStatus": "none", "amountMatches": false }
```

Khi nhận lời gọi này BRG Scan & Checkout **tự xác nhận**: ghi khoản thu, lưu số hoá đơn, và (nếu chi nhánh có bảo vệ) cấp mã QR ra cổng cho khách; (nếu chi nhánh không có bảo vệ) cho khách ra luôn (`exitStatus: "exited"`). Gọi lại với cùng `posOrderRef` là an toàn.

**Chỉ gọi khi tiền thật sự đã thu xong** (POS đã xác nhận thanh toán, ví dụ tiền QR đã về). Đây là bước quyết định khách được ra.

### 3.6 Báo huỷ đơn

`POST /orders/{posOrderRef}/cancelled`

```json
{ "reason": "Khách đổi ý" }
```

| Tình huống | Kết quả |
|-----------|---------|
| Đơn **chưa thanh toán** | Giỏ được **nhả về cho khách** (khách sửa giỏ rồi khoá lại sẽ ra mã giỏ mới). `{ "ok": true, "status": "cancelled", "cartReleased": true }` |
| Đơn **đã thanh toán**, khách chưa ra cổng | Giao dịch bị huỷ theo POS: QR ra cổng mất hiệu lực, khoản thu không tính vào doanh thu của BRG Scan & Checkout, hoá đơn chuyển "yêu cầu huỷ". `{ "ok": true, "status": "voided", "alreadyExited": false }` |
| Đơn **đã thanh toán**, khách đã ra | Ghi nhận huỷ theo POS (không tính doanh thu), `alreadyExited: true`. BRG Scan & Checkout không thể thu hồi hàng; việc xử lý do cửa hàng |
| Đã huỷ từ trước | `{ "ok": true, "duplicate": true, ... }` |

## 4. Trạng thái

| `status` của giỏ | Ý nghĩa |
|------------------|---------|
| `awaiting_counter` | Khách đã khoá giỏ, chờ thanh toán |
| `paid` | POS đã báo thanh toán |
| `cancelled` | Đã huỷ trước khi thanh toán |
| `voided` | Đã huỷ sau khi thanh toán |

`posStatus`: `null` (chưa nhận), `claimed` (POS đã nhận), `paid`, `cancelled`.

## 5. Mã lỗi

| HTTP | `error` | Ý nghĩa và cách xử lý |
|-----:|---------|----------------------|
| 400 | `BAD_ORDER_REF` | Thiếu hoặc sai `posOrderRef` |
| 400 | `BAD_AMOUNT` | `amount` không phải số nguyên dương |
| 400 | `BAD_METHOD` | `method` không thuộc danh sách |
| 401 | `NO_API_KEY`, `BAD_API_KEY` | Thiếu, sai hoặc đã thu hồi khoá API |
| 403 | `STORE_FORBIDDEN` | Khoá không dùng được cho chi nhánh của giỏ này |
| 404 | `CART_NOT_FOUND` | Không có giỏ với mã này (quét nhầm mã, hoặc giỏ cũ) |
| 404 | `ORDER_NOT_FOUND` | Chưa nhận đơn POS này, hãy gọi `claim` trước |
| 409 | `POS_MODE_OFF` | Chi nhánh chưa bật chế độ thu tiền qua POS |
| 409 | `NOT_PAYABLE` | Giỏ không còn chờ thanh toán (đã thanh toán, đã huỷ, khách đã sửa giỏ); `status` hiện kèm theo |
| 409 | `ALREADY_CLAIMED` | Giỏ đã được đơn POS khác nhận (`posOrderRef` kèm theo) |
| 409 | `REF_IN_USE` | `posOrderRef` này đã gắn với giỏ khác |
| 409 | `ORDER_CANCELLED` | Đơn đã bị huỷ, không báo thanh toán được |

Với 409 `NOT_PAYABLE` khi nhận giỏ: báo thu ngân giỏ này không còn dùng được, mời khách tạo lại giỏ.

## 6. Quy tắc quan trọng

1. **POS là nguồn đúng về giá, khuyến mãi và tiền thu.** BRG Scan & Checkout chỉ cung cấp danh sách mặt hàng; số tiền cuối là `amount` POS báo.
2. **Báo `paid` đúng một lần cho mỗi đơn**, sau khi tiền thực sự đã thu. Gọi lại an toàn.
3. **Hoá đơn điện tử do POS phát hành.** BRG Scan & Checkout không xuất hoá đơn ở chi nhánh dùng POS; BRG Scan & Checkout chỉ lưu số hoá đơn POS gửi để hiện cho khách.
4. **Hoàn tiền, trả hàng làm trên POS**, rồi POS báo `cancelled` để BRG Scan & Checkout đồng bộ.
5. Khi POS mất kết nối với BRG Scan & Checkout, thu ngân có thể vẫn bán bình thường trên POS; khi kết nối lại POS gọi `claim` rồi `paid` (hoặc chỉ `paid` nếu đã nhận). Quản lý có thể chuyển chi nhánh về chế độ thu thủ công trong thời gian sự cố (xem hướng dẫn của BRG Scan & Checkout).
6. Gọi API từ **máy chủ hoặc dịch vụ trung gian của POS**, không để khoá API trong ứng dụng chạy ở thiết bị người dùng cuối nếu tránh được.

## 7. Thử nhanh bằng dòng lệnh

```bash
KEY=brgpos_...                       # khoá do quản trị cấp
BASE=https://scan.hcrc.vn

curl -s $BASE/api/pos/v1/health -H "Authorization: Bearer $KEY"
curl -s $BASE/api/pos/v1/carts/GH-Q7-10001/claim -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' -d '{"posOrderRef":"A-20481","cashier":"thu01","terminal":"Q1"}'
curl -s $BASE/api/pos/v1/orders/A-20481/paid -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' -d '{"amount":60800,"method":"qr_transfer","invoiceNo":"HD0001234"}'
```

Có sẵn công cụ giả lập POS: `node scripts/pos-simulator.js --base $BASE --key $KEY claim GH-Q7-10001 --ref A-20481` (xem phần đầu file để biết các lệnh `preview`, `paid`, `cancelled`, `status`).

## 8. Môi trường thử

Khách hàng sẽ cấp một bản BRG Scan & Checkout riêng để thử, kèm khoá API và chi nhánh đã bật chế độ POS. Trong bản thử, quản trị viên có thể tạo giỏ hàng mẫu bằng điện thoại và dùng khung "Giả lập POS" để so sánh kết quả với hệ thống của bạn.

## 9. Điều cần thống nhất với nhà cung cấp POS

- POS đọc mã giỏ từ QR bằng cách nào (máy quét mã cắm vào máy tính tiền, camera), và thu ngân thao tác ở đâu để gọi `claim`.
- Thời gian chờ và cơ chế thử lại khi gọi API (đề nghị hết thời gian 5 đến 10 giây, thử lại tối đa vài lần cách quãng).
- POS có gửi `paid` ngay khi thanh toán xong hay sau khi xuất hoá đơn (nên gửi sau khi có số hoá đơn để BRG Scan & Checkout lưu cùng lúc).
- Cách POS xử lý đơn treo không được thanh toán (huỷ tự động sau bao lâu và gọi `cancelled`).
