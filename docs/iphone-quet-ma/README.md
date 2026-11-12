# Quét mã bằng camera trên Safari iPhone

Rút ra từ ứng dụng BRG Scan & Checkout. Thư viện giải mã: **@zxing/library 0.21.3** (file `zxing.min.js`, tự chứa, không cần Internet).

## Chạy thử
1. Đặt cả thư mục lên một máy chủ **HTTPS** (iPhone không cấp camera cho HTTP thường; `localhost` thì được).
2. Mở `demo.html` bằng Safari trên iPhone, bấm "Quét mã vạch" hoặc "Quét QR", cho phép camera.

## Vì sao ứng dụng khác thường "không quét ra mã" trên iPhone (kiểm tra theo thứ tự)
1. **Không phải HTTPS** -> `getUserMedia` không tồn tại hoặc bị từ chối.
2. **Thiếu `playsinline`/`muted` trên thẻ `<video>`** -> video bật toàn màn hình hoặc không phát.
3. **Gọi camera không từ thao tác chạm** -> iOS chặn phát video tự động. Luôn có nút "Bật camera".
4. **Dùng `BarcodeDetector`** -> Safari iOS không có API này. Phải giải mã bằng thư viện (ZXing) trên khung hình lấy từ canvas.
5. **Giải mã trên ảnh quá lớn hoặc quá nhỏ** -> thu về rộng tối đa khoảng 960 px, giải mã mỗi ~120 ms.
6. **Bật mọi định dạng mã** -> chậm và đọc nhầm. Chỉ bật định dạng cần: `POSSIBLE_FORMATS`.
7. **Không bật `TRY_HARDER`** -> mã nhỏ, hơi mờ đọc kém.
8. **Camera trước** -> dùng `facingMode: { ideal: 'environment' }`.
9. **Trong WebView của ứng dụng iOS (WKWebView)** -> cần `NSCameraUsageDescription` trong Info.plist, `allowsInlineMediaPlayback = true`, `mediaTypesRequiringUserActionForPlayback = []`; iOS dưới 14.3 WKWebView không có camera.
10. **Đèn flash** -> Safari iPhone thường không hỗ trợ bật đèn qua trình duyệt.

## Luồng xử lý
camera (getUserMedia) -> `<video>` -> vẽ khung hình lên `<canvas>` (<= 960px) -> LuminanceSource (xám) -> HybridBinarizer -> MultiFormatReader (TRY_HARDER) -> text -> bỏ trùng 2 giây -> onScan.

Ghi chú: bản này chưa được thử trên iPhone thật trong phiên làm việc của tôi; đoạn mã gốc đang chạy trong ứng dụng BRG.
