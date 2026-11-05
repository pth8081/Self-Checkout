# API giá và sản phẩm theo chi nhánh (cho BRG đọc)

**Mục đích:** khi khách quét mã vạch, BRG phải hiện đúng tên và giá **của chi nhánh khách đang đứng**. Hệ thống của bạn là nguồn giá; BRG chỉ đọc, không ghi.

Phần này tách khỏi [api-pos](api-pos.md) (POS gọi vào BRG). Ở đây là BRG gọi ra.

## 1. Nguyên tắc

- Giá luôn tra theo cặp **(chi nhánh, mã vạch)**. Cùng mã vạch ở hai chi nhánh có thể khác giá.
- Giá BRG hiện cho khách và giá POS thu **nên cùng một nguồn**. Khi đó giá khớp, không cần POS tính lại; POS chỉ cần dựng đơn từ danh sách BRG gửi và thu đúng số tiền đó.
- BRG tra giá hai lần: lúc khách quét, và lúc khách khoá giỏ (để phát hiện giá vừa đổi). Vì vậy API cần trả lời nhanh.
- BRG không dùng tồn kho (POS tự xử lý). Trường tồn kho có hay không đều được.

## 2. Hai lệnh cần có

### 2.1 Tra theo mã vạch (dùng khi khách quét, và khi khoá giỏ)

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
| `sku` | Mã sản phẩm trong hệ thống của bạn. POS dùng mã này để dựng đơn |
| `price` | Giá bán lẻ **đang áp dụng tại chi nhánh**, VND, số nguyên, đã gồm thuế |
| `active` | `false` nếu ngừng bán tại chi nhánh |
| `ageRestricted` | `true` với rượu, thuốc lá… (thu ngân sẽ kiểm tra ở quầy) |
| `promo` | Khuyến mãi đang chạy, `null` nếu không. Hiện BRG hiểu dạng "mua từ N món, giảm X đồng mỗi món" |

Một mã vạch ứng với một `sku`. Một `sku` có thể có nhiều mã vạch: trả cùng `sku` cho từng mã.

### 2.2 Lấy toàn bộ bảng giá của chi nhánh (đồng bộ định kỳ)

`GET /stores/{storeId}/products?updatedSince=<thời điểm>&page=<n>`

Trả danh sách như 2.1, có phân trang và `updatedSince` để chỉ lấy dòng thay đổi. BRG dùng để giữ bản sao tra nhanh và đồng bộ mỗi phút.

## 3. Yêu cầu chung

- Xác thực bằng khoá API trong header (BRG cấp chỗ để lưu khoá), HTTPS.
- Thời gian trả lời lúc tra mã vạch: dưới 300 ms cho tới 10 mã vạch một lần.
- Giới hạn gọi: BRG gọi đồng bộ mỗi phút cho từng chi nhánh và tra từng mã khi khách quét. Cho biết giới hạn của bạn để BRG điều chỉnh.
- `asOf` cho biết dữ liệu tính tới lúc nào.
- Lỗi dùng mã HTTP chuẩn và thân JSON `{ "error": "MÃ", "message": "…" }`. Chi nhánh không tồn tại trả 404.

## 4. Cần bạn xác nhận

1. API này có trả **giá theo từng chi nhánh** không (hay theo nhóm giá)?
2. Giá trả về đã là **giá khách thực trả** (đã gồm giá khuyến mãi)? Hay khuyến mãi tách riêng?
3. Khuyến mãi phức tạp hơn "mua N giảm X" (combo, tặng kèm, theo giờ)? Nếu có, nói rõ để BRG hoặc POS xử lý.
4. Hàng bán theo cân/ký có mã riêng hay mã chứa giá/khối lượng?
5. Cùng nguồn này POS cũng dùng để tính tiền không? Nếu cùng nguồn thì POS không cần tính lại.

## 5. Phía BRG sẽ làm khi có API

Viết adapter thay cho bản giả lập (`server/services/pos.js`), theo giao diện trong [11](11-ung-dung.md) mục 3: `sync`, `lookup`, `current`, `lastSync`. Giỏ vẫn khoá giá lúc quét và kiểm tra lại lúc khoá giỏ; không đổi gì ở giao diện khách.
