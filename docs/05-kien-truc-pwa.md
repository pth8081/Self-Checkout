# 05. Kiến trúc PWA

**Trạng thái:** Nháp (mục mới, tài liệu gốc chỉ nói "PWA, không cần cài đặt"). Đây là phần quyết định tính khả thi của yêu cầu quét mã và offline.

## 1. Yêu cầu riêng cho PWA

| Mã | Yêu cầu | Liên quan |
|----|---------|-----------|
| PWA-01 | Chạy trên HTTPS; xin quyền camera (`getUserMedia`) có màn hình giải thích trước khi bật hộp thoại hệ thống | FR-CUS-02 |
| PWA-02 | Quét mã vạch trong trình duyệt: ưu tiên `BarcodeDetector` nếu có, **bắt buộc có phương án dự phòng bằng thư viện giải mã (WASM/JS)** | NFR-01 |
| PWA-03 | Giỏ hàng lưu cục bộ (IndexedDB), mỗi thao tác là một sự kiện có `clientEventId`, đồng bộ lại idempotent | FR-CUS-09, NFR-06 |
| PWA-04 | Service worker cache "app shell" để mở nhanh và mở được khi mất mạng; **không cache** API giá/tồn kho như dữ liệu đúng | |
| PWA-05 | Hiển thị rõ trạng thái mạng và trạng thái đồng bộ ("đã lưu trên máy" / "đã đồng bộ") | NFR-06 |
| PWA-06 | Sau thanh toán, lưu QR biên nhận cục bộ để hiển thị được khi mất mạng | FR-CUS-07 |
| PWA-07 | Có `manifest` và cho phép "Thêm vào màn hình chính" nhưng **không bắt buộc** cài đặt | |
| PWA-08 | Cập nhật phiên bản không làm hỏng phiên mua sắm đang chạy (cập nhật khi hết phiên / hỏi người dùng) | |
| PWA-09 | Khóa màn hình ngủ khi đang quét (Wake Lock nếu hỗ trợ) | |
| PWA-10 | Ma trận trình duyệt hỗ trợ tối thiểu, có kiểm thử trên thiết bị thật | NFR-14 |

## 2. Cấu trúc ứng dụng (quyết định cần chốt)

| Phương án | Ưu | Nhược |
|-----------|----|-------|
| A. 1 PWA, nhiều vùng (`/c` khách, `/g` cổng, `/admin`) | Ít repo, dùng chung thành phần | Bundle khách phải tách chặt để nhẹ; phạm vi service worker lẫn lộn |
| B. **PWA khách** + **PWA nhân viên** + **web quản trị** tách riêng | Khách nhẹ nhất; quyền & cache tách rõ | Nhiều dự án hơn |

**Quyết định (thiết kế hiện tại): B.** PWA khách (URL công khai qua link/QR), PWA nhân viên (đăng nhập bằng mã nhân viên + PIN, dùng trên điện thoại hoặc máy cầm tay), web quản trị (máy tính, vẫn dùng được trên điện thoại). Ghi thành ADR khi bắt đầu code.

## 3. Danh sách màn hình (khung)

Danh sách đầy đủ 52 màn hình ở [10](10-man-hinh.md); bản vẽ ở [thiet-ke/man-hinh.html](thiet-ke/man-hinh.html).

**Khách (M01–M26):** Chào/nhận diện chi nhánh → Hướng dẫn nhanh → Quét → Giỏ hàng → Chọn cách trả → Chuyển khoản QR hoặc mã giỏ hàng → QR biên nhận → Hóa đơn.
**Nhân viên (N01–N14):** Đăng nhập → Quét mã giỏ hàng và thu tiền → Quét QR ra cổng → Kiểm tra ngẫu nhiên → Ghi chênh lệch → Đối soát cuối ca.
**Quản trị (A01–A12):** Tổng quan, chi nhánh và cờ tính năng, tích hợp, báo cáo, phân quyền; trong ngày, truy vết, ca, tỷ lệ kiểm tra, đối soát, mã không tìm thấy.

TODO: wireframe, luồng lỗi (không có quyền camera, mã không đọc được, hết mạng, thanh toán thất bại).

## 4. Giới hạn nền tảng cần kiểm chứng sớm (rủi ro kỹ thuật)

| Vấn đề | Tác động | Hướng xử lý (TODO kiểm chứng) |
|--------|----------|-------------------------------|
| Safari iOS không đủ hỗ trợ `BarcodeDetector` | Quét chậm/không quét được nếu chỉ dùng API gốc | Thư viện giải mã dự phòng; thử độ trễ trên iPhone cũ |
| Background Sync không có trên iOS | Không tự đồng bộ nền | Đồng bộ khi mở lại app / có mạng trở lại (foreground) |
| Trình duyệt có thể xóa dữ liệu cục bộ khi thiếu bộ nhớ hoặc ít dùng (đặc biệt iOS) | Mất giỏ | Xin lưu trữ bền (`storage.persist`), giỏ cũng ghi lên backend khi có mạng |
| Trình duyệt trong app (Zalo, Facebook, camera hệ điều hành mở link) có thể chặn camera/service worker | Link QR mở trong webview bị lỗi | Phát hiện webview, hướng dẫn mở bằng Safari/Chrome |
| GĐ1: khách đổi app giữa chừng (mở app ngân hàng để chuyển khoản) rồi quay lại | Mất ngữ cảnh trang | Trạng thái giỏ và giao dịch lưu ở backend; mở lại thì vào M07/M18 |
| GĐ2: thanh toán ví chuyển sang app khác rồi quay lại | Mất ngữ cảnh trang | Trạng thái giao dịch lưu ở backend; trang kết quả tra theo `transactionId` |
| Camera tối/mờ, mã vạch nhàu | Nhiều lần quét thất bại | Đèn flash (`torch` nếu có), nhập tay mã, hướng dẫn |

## 5. Hiệu năng PWA (TODO đặt ngân sách)

Ngân sách dung lượng bundle trang khách, thời gian vào trang trên 4G, thời gian mở camera đến khi sẵn sàng quét.

## 6. Bảo mật phía client

Không lưu bí mật trong client; phiên khách là token ngắn hạn gắn `sessionId`/`storeId`; QR biên nhận do server ký, client chỉ hiển thị (NFR-12).
