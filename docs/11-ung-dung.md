# 11. Ứng dụng đã xây và cách gắn tích hợp thật

**Trạng thái:** ứng dụng đầy đủ chức năng cho khách, thu ngân, nhân viên cổng ra và quản trị; DS Smart POS, hoá đơn điện tử và thanh toán online chạy bản giả lập hoặc chưa có. Cách chạy xem [README](../README.md).

## 1. Đã làm

| Phần | Màn hình (docs/10) | Ghi chú |
|------|--------------------|---------|
| PWA khách `/c/` | M01–M22, M25–M26; M23–M24 chưa dùng (online) | Quét bằng `BarcodeDetector`, nếu thiếu dùng ZXing (Safari iOS). Giỏ lưu trên máy, quét tiếp khi mất mạng, tự đồng bộ. QR biên nhận lưu để xem khi mất mạng |
| PWA nhân viên `/s/` | N01–N14 + menu, hàng đợi, giao dịch gần đây, "Chờ quản lý" | Thu tiền mặt (tính tiền thừa), xác nhận chuyển khoản (3 ô tick), quét QR ra cổng, kiểm tra ngẫu nhiên, chênh lệch, thu bổ sung, kết thúc ca có đối soát |
| Web quản trị `/a/` | A01–A12 + giao dịch, nhật ký | Đăng nhập kèm xác thực 2 bước (TOTP), phân quyền chuỗi/chi nhánh, báo cáo + CSV, đối soát sao kê, mã QR dán cổng vào cho từng chi nhánh |
| Máy chủ | toàn bộ API | Phiên khách theo mã thiết bị, QR biên nhận ký HMAC dùng một lần, khoá tài khoản khi sai nhiều lần, nhật ký bất biến |

Điểm khác với bản vẽ ban đầu: kiểm tra ngẫu nhiên do máy chủ bốc khi khoá giỏ; nhân viên **có thể** đối chiếu ngay tại quầy (tuỳ chọn) hoặc để cổng ra kiểm tra, không có nút bỏ qua ở cổng. Khi quản lý từ chối, giao dịch sang trạng thái `denied` và quản lý đổi được quyết định sau đó.

## 2. Quy tắc nghiệp vụ chính (đã có kiểm thử)

- Giá chốt lúc quét; khi khoá giỏ, hệ thống đối chiếu lại với DS Smart POS. Giá, khuyến mãi hoặc ngừng bán đổi thì khách phải đồng ý (M15) mới khoá được. **Tồn kho không bị kiểm tra** (quyết định 2026-11-05): DS Smart POS tự xử lý tồn kho khi bán.
- Khoá giỏ sinh `GH-<chi nhánh>-<số>` (mã giỏ) và nội dung chuyển khoản `SG <chi nhánh> <số>`. Chỉ nhân viên đúng chi nhánh tra được.
- Thu tiền cần nhân viên đã bắt đầu ca. Chuyển khoản chỉ xác nhận khi đủ 3 điều kiện (số tiền, nội dung, tiền đã vào). Tiền mặt ghi số khách đưa và tiền thừa.
- QR biên nhận `R1.<mã>.<hạn>.<chữ ký>` chỉ hợp lệ khi đã thu tiền, chưa hết hạn, chưa dùng, chưa bị huỷ; quét thành công là đánh dấu đã dùng ngay.
- Kết thúc ca: tiền mặt đếm thực tế so với hệ thống; lệch thì bắt buộc ghi lý do.
- Huỷ giao dịch đã thu: chỉ quản lý, bắt buộc lý do, chưa ra cổng; QR trở nên vô hiệu, hoá đơn đã xuất chuyển sang "yêu cầu huỷ".
- Mọi thao tác quan trọng ghi `audit_events` (truy vết ở A07, nhật ký ở trang quản trị).

## 2a. Giỏ QR cho DS Smart POS (hướng chính)

Từ 2026-11-05 chế độ mặc định của chi nhánh là **giỏ QR** (`checkout_mode = basket`). Khách quét mặt hàng, bấm Thanh toán, điện thoại hiện mã QR chứa mã vạch và số lượng ([api-qr-gio-hang](api-qr-gio-hang.md)); DS Smart POS quét, tạo đơn, tính lại giá, thu tiền. Chế độ này bật sẵn thu tiền qua DS Smart POS và tắt bước cổng ra; luồng cũ bị khoá, không xoá: quản trị chuỗi tắt công tắc "Giỏ QR cho DS Smart POS" ở A02 để dùng lại (không còn giỏ chờ). Tồn kho không dùng. Hoá đơn điện tử do DS Smart POS và nhà cung cấp xử lý; khách khai báo ở **link của nhà cung cấp** do quản trị cấu hình (trang Tích hợp), nút hiện trên màn hình sau thanh toán, bill, lịch sử, email và PDF. **Mã điểm là khoá bảo vệ:** chi nhánh phải có mã điểm mới bật được; DS Smart POS từ chối mã QR có mã điểm sai, và API báo thanh toán bắt buộc gửi `pointCode` đúng (sai thì 409 `POINT_MISMATCH`).

DS Smart POS báo thanh toán theo mã giỏ (`POST /api/pos/v1/baskets/{mã}/paid`, kèm `lines`), tự thử lại 3–4 lần tới khi thành công; khách thấy "Đã hoàn thành thanh toán", xem bill và tải PDF (`pdfkit`, phông DejaVu Sans trong `server/assets/fonts`). Chưa có kết quả từ DS Smart POS thì khách bấm "Đã thanh toán xong", giao dịch ở trạng thái `handed_off`.

## 2b. Chế độ DS Smart POS và bỏ bước bảo vệ (cờ theo chi nhánh)

- **`paymentSource = pos`:** DS Smart POS gọi API `/api/pos/v1` của BRG (nhận giỏ, báo thanh toán, báo huỷ), xem [api-pos.md](api-pos.md). BRG tự xác nhận khi DS Smart POS báo thanh toán; thu tiền thủ công trong BRG bị chặn ở chi nhánh này.
- **`guardCheck = false`:** không có bước cổng ra, không bốc kiểm tra ngẫu nhiên, thanh toán xong khách ra luôn, không có QR.
- Cả hai chỉ quản trị chuỗi đổi, có ghi nhật ký. Đây là hướng DS Smart POS gọi vào BRG, **khác** với cách BRG gọi DS Smart POS để lấy giá và tồn kho ở mục 3.

## 2c. Khách mất mạng, tắt trình duyệt hoặc bị xoá dữ liệu

- **Mất mạng:** giỏ, mã giỏ và QR biên nhận lưu trên máy, tải lại vẫn thấy; thao tác quét chờ gửi khi có mạng lại.
- **Tắt trình duyệt:** mở lại link cửa hàng, giỏ đang dở (kể cả giỏ đã khoá chờ thu ngân hoặc đã thanh toán chưa ra) hiện lại theo mã thiết bị.
- **Bị xoá dữ liệu trang** (iOS xoá localStorage sau 7 ngày không dùng): máy chủ đặt thêm cookie `brgd` làm bản sao mã thiết bị; còn cookie thì giỏ vẫn tìm lại được (`GET /api/c/sessions/current`).
- **Không còn gì** (đổi trình duyệt, ứng dụng ra màn hình chính tách riêng với Safari, chế độ riêng tư): giỏ cũ không tự khôi phục. Thu ngân vẫn xử lý được nếu khách còn mã giỏ (màn chờ nhắc chụp màn hình).
- Giỏ bị bỏ quên quá 12 giờ (`CART_TTL_HOURS`) được dọn mỗi giờ; giỏ DS Smart POS đã nhận thì giữ.

## 3. Gắn DS Smart POS thật (đọc giá và tồn kho)

Bản giả lập: `server/services/pos.js` (đọc bảng `pos_products`). DS Smart POS thật thay bằng một adapter cùng giao diện, chọn trong `server/app.js` (tham số `pos` của `buildApp`, hoặc đổi nơi tạo `createMockPos`).

```js
{
  name: 'ten-pos',
  sync(storeId)            // kéo giá/tồn kho/khuyến mãi của chi nhánh vào bảng product_cache, trả { storeId, synced, at }
  syncAll()                // gọi sync cho mọi chi nhánh (chạy định kỳ ở server/index.js, mặc định 60 giây)
  lookup(storeId, variants)// tra trong product_cache theo danh sách biến thể mã vạch, trả hàng hoặc null
  current(storeId, skus)   // GIÁ/TỒN KHO HIỆN TẠI từ POS (Map sku -> hàng), dùng khi khoá giỏ để phát hiện thay đổi
  lastSync(storeId)        // thời điểm đồng bộ gần nhất (hiện ở A01, A03)
}
```

Mã điểm của từng chi nhánh (`stores.pos_code`, nhập ở A02/A03) là mã để adapter gọi đúng cửa hàng trong hệ thống giá; xem [api-gia-chi-nhanh](api-gia-chi-nhanh.md).

Một dòng sản phẩm cần: `sku, barcode, name, price (VND, số nguyên), stock, unit, active, age_restricted, promo_min_qty, promo_off, ...`. Bảng `product_cache` là bản sao để quét nhanh; `current()` mới là nguồn để chốt giá, nên với DS Smart POS có API thời gian thực hãy gọi trực tiếp DS Smart POS trong `current()` thay vì đọc bộ nhớ đệm.

Việc cần chốt với DS Smart POS (xem [07](07-tich-hop-chong-that-thoat.md)): API đọc theo chi nhánh, xác thực, giới hạn gọi, một SKU nhiều mã vạch, khuyến mãi (hiện chỉ hỗ trợ dạng "mua N giảm X"), hàng cân theo ký, hàng giới hạn độ tuổi.

**Báo cáo và DS Smart POS:** báo cáo hiện lấy từ dữ liệu của chính hệ thống (A01, A04, xuất CSV). Ghi giao dịch Scan & Checkout về DS Smart POS/kế toán chưa làm (G-05); điểm gắn tự nhiên là cuối `collectPayment` trong `server/services/core.js`, sau khi ghi `payments`, kèm hàng đợi thử lại giống hoá đơn.

## 4. Gắn hoá đơn điện tử thật

Bản giả lập: `createMockInvoicer` trong `server/services/invoice.js`. Adapter thật cần một hàm:

```js
{ name: 'nha-cung-cap', async issue(tx, buyer) { /* gọi nhà cung cấp */ return { number: 'SỐ HOÁ ĐƠN' }; } }
```

`tx` là dòng giao dịch (có `items_json`, `total`, `store_id`…), `buyer` có `email`, `taxCode`, `companyName`, `address` khi khách xin hoá đơn công ty. Hàm ném lỗi thì hoá đơn ở trạng thái `pending`, vẫn cho khách ra cổng, và được thử lại mỗi 2 phút hoặc từ nút ở A03. Hoá đơn bán lẻ xuất ngay khi thu tiền; hoá đơn công ty thay thế hoá đơn bán lẻ, chỉ trong ngày phát sinh.

Cần chốt: nếu DS Smart POS cũng tự xuất hoá đơn khi nhận đơn, chỉ để **một bên** xuất, tránh trùng.

## 5. Thêm thanh toán online

Hiện `pay_online` luôn tắt và API cấu hình từ chối bật. Hướng làm:

1. Adapter thanh toán (tạo giao dịch, nhận thông báo có chữ ký, truy vấn trạng thái) và tuyến webhook mới, ghi `payments` với `provider`, `provider_ref`, khớp theo số tiền + mã giao dịch, xử lý trùng.
2. Trạng thái giao dịch thêm `pending_online`; màn M23/M24 đã có trong bản vẽ; PWA khách thêm lựa chọn ở M16 và chuyển sang chờ thanh toán.
3. Mở khoá ô "Online" ở A02 và nhận lựa chọn `qrProvider = provider` ở A03.
4. QR do nhà cung cấp trả về thay cho `vietQrPayload` trong `txView`; màn hình khách (M17) không đổi.

## 6. Hạn chế đã biết

- Chưa thử camera và quét mã trên điện thoại thật; đã thử bằng luồng video giả với mã EAN-13 (ZXing giải mã đúng), chưa thử BarcodeDetector gốc.
- QR chuyển khoản tự dựng theo chuẩn VietQR chưa kiểm chứng với các app ngân hàng thật; thông tin ngân hàng trong dữ liệu mẫu là giả.
- Email (mã xác nhận xem lịch sử trên máy khác, bill gửi về email khách) gửi qua máy chủ SMTP do quản trị chuỗi cấu hình ở trang Tích hợp. Chưa cấu hình thì ở môi trường thử mã trả về trong phản hồi, ở production báo rõ là chưa gửi được. Bill gửi lỗi được thử lại tối đa 5 lần trong 24 giờ.
- Chưa có: hàng bán theo cân, đặt lại mật khẩu quản trị qua email, huỷ giao dịch từ app nhân viên, giao diện quản trị tối ưu cho điện thoại, thông báo đẩy.
- Xác nhận thu tiền do người thực hiện: cần quy trình bàn giao ca và đối soát sao kê hằng ngày (A10).
- SQLite phù hợp một máy chủ. Nhiều máy chủ hoặc tải lớn cần chuyển sang PostgreSQL (lớp truy cập tập trung ở `server/db.js` và các câu lệnh SQL trong `server/services`).
