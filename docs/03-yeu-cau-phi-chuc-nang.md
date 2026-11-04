# 03. Yêu cầu phi chức năng

**Trạng thái:** Cần xác nhận (nhiều số liệu chưa có).

| Mã | Hạng mục | Yêu cầu | Cách kiểm chứng (TODO) | Còn thiếu |
|----|----------|---------|------------------------|-----------|
| NFR-01 | Hiệu năng quét | Nhận diện mã vạch < 1 s ở ánh sáng siêu thị tiêu chuẩn | Bộ test thiết bị thật (iOS/Android, máy tầm thấp) | Danh sách thiết bị chuẩn; định nghĩa "ánh sáng tiêu chuẩn" (lux) |
| NFR-02 | API | < 500 ms cho tra cứu sản phẩm/giỏ ở tải bình thường | Load test p95 | Định nghĩa "tải bình thường" |
| NFR-03 | Đồng thời | Tất cả chi nhánh chạy cùng lúc | Load test theo mô hình bên dưới | **Số chi nhánh × khách đồng thời cao điểm** (Q-03) |
| NFR-04 | Bảo mật thanh toán | Theo chuẩn của cổng thanh toán; không lưu thẻ | Rà soát thiết kế, không có PAN trong log/DB | Cổng thanh toán nào (Q-02) |
| NFR-05 | Hoá đơn điện tử | Mọi giao dịch xuất hoá đơn hợp lệ theo quy định | Đối soát số giao dịch = số hoá đơn | Nhà cung cấp (Q-04) |
| NFR-06 | Offline tạm thời | Giỏ lưu cục bộ, đồng bộ lại; backend gián đoạn thì báo rõ, không lỗi âm thầm | Test chế độ máy bay, mạng chập chờn | Xem [05](05-kien-truc-pwa.md) |
| NFR-07 | Audit log | Lưu toàn bộ phiên quét, giao dịch, lượt kiểm tra | Truy vết 1 giao dịch từ đầu đến cuối | **Thời gian lưu tối thiểu** (Q-06) |
| NFR-08 | Mở rộng | Multi-tenant theo `storeId`; thêm chi nhánh không đổi kiến trúc | Thêm chi nhánh giả lập chỉ bằng cấu hình | |

## Bổ sung đề xuất (tài liệu gốc chưa có — xem [09](09-phan-tich-khoang-trong.md))

| Mã | Hạng mục | Gợi ý nội dung |
|----|----------|---------------|
| NFR-09 | Bảo mật dữ liệu cá nhân | Tuân thủ quy định bảo vệ dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP): đồng ý thu thập, mục đích, thời hạn lưu |
| NFR-10 | Phân quyền & tách dữ liệu | Quản trị chi nhánh chỉ thấy `storeId` của mình; kiểm thử chống truy cập chéo chi nhánh |
| NFR-11 | Khả dụng | Mục tiêu uptime (đặc biệt giờ mở cửa), RTO/RPO |
| NFR-12 | Chống gian lận QR | QR biên nhận ký số, dùng một lần, có hạn |
| NFR-13 | Truy cập được | Cỡ chữ, tương phản, hướng dẫn tiếng Việt rõ ràng, dùng một tay |
| NFR-14 | Tương thích | Ma trận trình duyệt/thiết bị hỗ trợ (xem PWA-10) |
| NFR-15 | Khả năng quan sát | Log, metric, cảnh báo cho độ trễ đồng bộ POS và tỷ lệ lỗi thanh toán |

## Mô hình ước lượng tải (điền khi có số)

```
đồng_thời_cao_điểm = Σ_chi_nhánh ( khách_trong_cửa_hàng_cao_điểm × % dùng_Scan&Go )
quét/giây          = đồng_thời × (số_món_trung_bình / thời_gian_mua_sắm)
```

TODO: chi nhánh = ?, khách cao điểm/chi nhánh = ?, % dùng Scan & Go = ?, món/giỏ = ?, phút/lượt = ?
