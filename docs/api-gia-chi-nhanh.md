# API giá và sản phẩm theo chi nhánh (cho BRG Scan & Checkout đọc)

**Mục đích:** khi khách quét mã vạch, BRG Scan & Checkout phải hiện đúng tên và giá **của chi nhánh khách đang đứng**. Hệ thống của bạn là nguồn giá; BRG Scan & Checkout chỉ đọc, không ghi.

Phần này tách khỏi [api-pos](api-pos.md) (Dsmart POS gọi vào BRG Scan & Checkout). Ở đây là BRG Scan & Checkout gọi ra.

## 1. Nguyên tắc

- Giá luôn tra theo cặp **(chi nhánh, mã vạch)**. Cùng mã vạch ở hai chi nhánh có thể khác giá.
- Giá BRG Scan & Checkout hiện cho khách và giá Dsmart POS thu **nên cùng một nguồn**. Khi đó giá khớp, không cần Dsmart POS tính lại; Dsmart POS chỉ cần dựng đơn từ danh sách BRG Scan & Checkout gửi và thu đúng số tiền đó.
- BRG Scan & Checkout tra giá hai lần: lúc khách quét, và lúc khách khóa giỏ (để phát hiện giá vừa đổi). Vì vậy API cần trả lời nhanh.
- BRG Scan & Checkout không dùng tồn kho (Dsmart POS tự xử lý). Trường tồn kho có hay không đều được.

## 2. Hai lệnh cần có

### 2.1 Tra theo mã vạch (dùng khi khách quét, và khi khóa giỏ)

`POST /products/lookup`

```json
{ "storeId": "Q7", "barcodes": ["8936036123456", "8934567890123"] }
```

Trả về, mỗi mã vạch tìm thấy là một phần tử (mã không có thì không xuất hiện):

```json
{
  "storeId": "Q7",
  "asOf": "2026-11-05T09:30:12+07:00",
  "items": [
    { "sku": "SUA01", "barcode": "8936036123456", "name": "Sữa tươi 1L", "unit": "hộp",
      "price": 29000, "active": true, "ageRestricted": false,
      "promo": { "minQty": 2, "offPerUnit": 2000 } }
  ]
}
```

| Trường | Ý nghĩa |
|--------|---------|
| `sku` | Mã sản phẩm trong hệ thống của bạn. Dsmart POS dùng mã này để dựng đơn |
| `price` | Giá bán lẻ **đang áp dụng tại chi nhánh**, VND, số nguyên, đã gồm thuế |
| `active` | `false` nếu ngừng bán tại chi nhánh |
| `ageRestricted` | `true` với rượu, thuốc lá… (thu ngân sẽ kiểm tra ở quầy) |
| `promo` | Khuyến mãi đang chạy, `null` nếu không. Hiện BRG Scan & Checkout hiểu dạng "mua từ N mặt hàng, giảm X đồng mỗi mặt hàng" |

Một mã vạch ứng với một `sku`. Một `sku` có thể có nhiều mã vạch: trả cùng `sku` cho từng mã.

### 2.2 Lấy toàn bộ bảng giá của chi nhánh (đồng bộ định kỳ)

`GET /stores/{storeId}/products?updatedSince=<thời điểm>&page=<n>`

Trả danh sách như 2.1, có phân trang và `updatedSince` để chỉ lấy dòng thay đổi. BRG Scan & Checkout dùng để giữ bản sao tra nhanh và đồng bộ mỗi phút.

### 2.3 Tính giá cả giỏ theo khuyến mãi (nên có, để tạm tính khớp Dsmart POS)

Giá từng mặt hàng chưa đủ để ra đúng số tiền khi có khuyến mãi phụ thuộc cả giỏ (combo, mua kèm, tổng tiền, theo giờ, chương trình theo chi nhánh). Cách chính xác nhất là **để chính bộ tính giá của hệ thống/POS tính**, BRG Scan & Checkout chỉ gọi.

`POST /quote`

```json
{ "storeId": "SP-0107", "items": [ { "barcode": "8936036123456", "qty": 2 }, { "barcode": "8934567890123", "qty": 1 } ] }
```

Trả về:

```json
{
  "storeId": "SP-0107",
  "asOf": "2026-11-05T09:30:12+07:00",
  "lines": [
    { "barcode": "8936036123456", "sku": "SUA01", "name": "Sữa tươi 1L", "qty": 2, "unitPrice": 29000, "discount": 0, "lineTotal": 58000, "promoNote": null },
    { "barcode": "8934567890123", "sku": "MI01", "name": "Mì tôm", "qty": 1, "unitPrice": 4800, "discount": 2000, "lineTotal": 2800, "promoNote": "Mua 2 giảm 2.000" }
  ],
  "unknown": [],
  "total": 60800
}
```

- Tính **như Dsmart POS tính cho khách không có thẻ thành viên** (khách vãng lai), cùng bảng giá và quy tắc khuyến mãi tại thời điểm gọi.
- `unknown`: các mã vạch không có trong hệ thống của chi nhánh.
- Hàng ngừng bán hoặc hết hạn khuyến mãi: trả như Dsmart POS sẽ làm khi quét.

**Cách BRG Scan & Checkout dùng:** lúc khách quét từng mặt hàng thì hiện đơn giá (từ 2.1). Khi khách bấm Thanh toán thì BRG Scan & Checkout gọi `/quote` để lấy tổng chính xác. Mất mạng hoặc API không trả lời thì BRG Scan & Checkout tính tạm theo giá thường và khuyến mãi đơn giản, ghi rõ "tạm tính, có thể chênh lệch khuyến mãi tại quầy".

## 2c. Mã điểm

Mỗi chi nhánh trong BRG Scan & Checkout có **mã điểm**: mã của siêu thị đó trong hệ thống giá của bạn. Quản trị chuỗi nhập một lần cho từng chi nhánh (khi thêm chi nhánh, hoặc ở mục Tích hợp), không trùng nhau giữa các chi nhánh. Khi khách quét QR cổng vào, BRG Scan & Checkout biết chi nhánh theo mã trong link; khi cần giá, BRG Scan & Checkout đổi sang mã điểm rồi gọi API. Vì vậy `storeId` trong hai lệnh trên là **mã điểm**, và phản hồi nên trả lại đúng mã điểm đó để BRG Scan & Checkout đối chiếu.

## 3. Yêu cầu chung

- Xác thực bằng khóa API trong header (BRG Scan & Checkout cấp chỗ để lưu khóa), HTTPS.
- Thời gian trả lời lúc tra mã vạch: dưới 300 ms cho tới 10 mã vạch một lần.
- Giới hạn gọi: BRG Scan & Checkout gọi đồng bộ mỗi phút cho từng chi nhánh và tra từng mã khi khách quét. Cho biết giới hạn của bạn để BRG Scan & Checkout điều chỉnh.
- `asOf` cho biết dữ liệu tính tới lúc nào.
- Lỗi dùng mã HTTP chuẩn và thân JSON `{ "error": "MÃ", "message": "…" }`. Chi nhánh không tồn tại trả 404.

## 4. Cần bạn xác nhận

1. API này có trả **giá theo từng chi nhánh** không (hay theo nhóm giá)?
   Mã vạch nhận vào gồm dạng nào: EAN-13, UPC-A 12 số, mã của nhà cung cấp, mã nội bộ? Một mã vạch ứng với một hay nhiều `sku`?
6. Có API **tính giá cả giỏ** (mục 2.3) không? Nếu không, cần bảng khuyến mãi và quy tắc kết hợp (ưu tiên, cộng dồn, làm tròn).
2. Giá trả về đã là **giá khách thực trả** (đã gồm giá khuyến mãi)? Hay khuyến mãi tách riêng?
3. Khuyến mãi phức tạp hơn "mua N giảm X" (combo, tặng kèm, theo giờ)? Nếu có, nói rõ để BRG Scan & Checkout hoặc Dsmart POS xử lý.
4. Hàng bán theo cân/ký có mã riêng hay mã chứa giá/khối lượng?
5. Cùng nguồn này Dsmart POS cũng dùng để tính tiền không? Nếu cùng nguồn thì Dsmart POS không cần tính lại.

## 5. Phía BRG Scan & Checkout sẽ làm khi có API

Viết adapter thay cho bản giả lập (`server/services/pos.js`), theo giao diện trong [11](11-ung-dung.md) mục 3: `sync`, `lookup`, `current`, `lastSync`. Giỏ vẫn khóa giá lúc quét và kiểm tra lại lúc khóa giỏ; không đổi gì ở giao diện khách.
