---
title: Điểm cần chốt
summary: Các quyết định nghiệp vụ chưa có quy định chính thức, kèm cách ứng dụng đang xử lý và đề xuất. Chỉ quản trị chuỗi xem.
group: nghiep-vu
order: 90
access: chain
---

# Điểm cần chốt

Danh sách này gom các chỗ **quy trình chưa có quy định chính thức**. Mỗi mục ghi ứng dụng hiện làm gì và đề xuất. Sau khi chốt, ứng dụng sẽ được chỉnh theo và tài liệu được cập nhật.

> **Quan trọng:** Các mục đánh dấu **Rủi ro cao** nên chốt trước khi chạy thí điểm.

| # | Chủ đề | Ứng dụng hiện làm | Đề xuất | Mức |
|---|--------|-------------------|---------|-----|
| 1 | **Giỏ chờ thu bị bỏ quên** | Giỏ đã khoá nằm trong hàng đợi **mãi** cho đến khi thu ngân huỷ | Tự huỷ sau một thời gian (ví dụ 30 phút) và mở lại giỏ cho khách | Cao |
| 2 | **Hạn QR biên nhận** | 180 phút kể từ lúc thu tiền. Hết hạn thì cổng báo đỏ, không có cách cấp lại | Chốt thời hạn hợp lý và quy trình cấp lại có quản lý duyệt | Cao |
| 3 | **Khách mất điện thoại hoặc hết pin sau khi trả** | Cổng ra chỉ nhận QR. Quản lý tra giao dịch ở web quản trị | Thêm "cho qua thủ công" cần quản lý duyệt, bắt buộc ghi lý do, ghi nhật ký | Cao |
| 4 | **Chuyển khoản sai** (thiếu, dư, sai nội dung, quên nội dung) | Thu ngân không tick thì không xác nhận được; không ghi nhận thanh toán gộp nhiều lần | Chốt chính sách cho từng trường hợp; nếu cho chuyển bù thì bổ sung ghi nhận thanh toán gộp | Cao |
| 5 | **Hoàn tiền, trả hàng** | Quản lý huỷ giao dịch (nếu khách chưa ra). Hoàn tiền làm ngoài hệ thống, không có chứng từ trong ứng dụng | Quy trình hoàn tiền, ai duyệt, chứng từ, thời hạn; sau đó thêm chức năng ghi nhận hoàn tiền | Cao |
| 6 | **Hàng giới hạn độ tuổi** | Chỉ hiện cảnh báo cho thu ngân, không ghi lại đã kiểm tra | Bắt buộc thu ngân xác nhận "đã kiểm tra giấy tờ" mới thu được, có ghi nhật ký; hoặc loại các mặt hàng này khỏi Scan & Checkout | Cao |
| 7 | **Ngưỡng lệch tiền mặt** | Lệch bất kỳ phải ghi lý do; không có ngưỡng duyệt | Đặt ngưỡng (ví dụ lệch trên một mức cần quản lý duyệt), quy định xử lý khi lệch lặp lại | Trung bình |
| 8 | **Tỷ lệ kiểm tra ngẫu nhiên** | Mẫu 10%, khách lần đầu 20%, giỏ từ 500.000₫ là 25% (quản lý đổi được) | Chốt giá trị bắt đầu, và ngưỡng dữ liệu để giảm dần (ví dụ tỷ lệ chênh lệch dưới mức X trong Y tuần) | Trung bình |
| 9 | **Hàng bán theo cân, hàng tươi** | Chưa hỗ trợ, khách mua ở quầy thường | Chốt loại trừ ở giai đoạn 1 hay hỗ trợ mã cân động | Trung bình |
| 10 | **Ghi nhận giao dịch vào POS và kế toán** | Chế độ POS: đơn nằm ở POS nên tồn kho, doanh thu, kế toán có sẵn. Chế độ tự thu: báo cáo chỉ lấy từ dữ liệu của BRG | Với chi nhánh tự thu, chốt cơ chế (xuất file hoặc API) để gộp vào POS và kế toán | Trung bình |
| 11 | **Hoá đơn điện tử: bên nào xuất** | Giỏ QR cho POS: không có hoá đơn lúc thanh toán; khách tự khai báo qua link nhà cung cấp, BRG không xuất và không lưu số hoá đơn. Chế độ tự thu: bản giả lập của BRG | Chi nhánh nào tự thu thì chốt nhà cung cấp hoá đơn thật; chỉ để một bên xuất | Cao |
| 12 | **Thời gian lưu nhật ký và dữ liệu cá nhân** | Lưu không giới hạn | Chốt thời gian lưu theo quy định nội bộ và pháp lý (nhật ký, email khách) | Trung bình |
| 13 | **Nhân sự tối thiểu mỗi ca** | Chỉ cảnh báo thiếu thu ngân hoặc cổng ra trên lịch ca | Chốt số người tối thiểu, quy định khi thiếu người (tạm tắt Scan & Checkout) | Trung bình |
| 14 | **Sự cố mạng tại quầy hoặc cổng ra** | App nhân viên cần mạng, không có chế độ ngoại tuyến | Chốt phương án dự phòng (quầy thường, mạng dự phòng), có thể cần chế độ ngoại tuyến cho cổng ra | Trung bình |
| 15 | **Hàng giá trị cao, nghi vấn** | Chỉ tăng xác suất kiểm tra theo ngưỡng giá trị | Cân nhắc buộc kiểm tra mọi giỏ vượt một mức giá trị | Thấp |

## Bổ sung khi tích hợp POS và chi nhánh không có bảo vệ

| # | Chủ đề | Hiện tại | Đề xuất | Mức |
|---|--------|----------|---------|-----|
| 16 | **POS báo thanh toán là tự xác nhận** (không còn người xác nhận trong BRG) | BRG tin báo của POS có khoá API hợp lệ | Chốt kiểm soát khoá API (ai giữ, đổi định kỳ), đối soát BRG với POS **mỗi ngày**, cảnh báo đơn lệch | Cao |
| 17 | **Đơn POS bị bỏ quên** (POS nhận giỏ rồi không thanh toán, không huỷ) | Giỏ giữ nguyên, khách không sửa được; quản lý phải **Nhả giỏ** thủ công | Tự nhả giỏ sau một thời gian (ví dụ 15 đến 30 phút) và quy định POS gọi huỷ khi huỷ đơn treo | Cao |
| 18 | **Kiểm soát thất thoát khi không có bảo vệ** | Không có kiểm tra ngẫu nhiên, khách ra luôn | Biện pháp bù (camera, kiểm đếm tồn kho, nhân viên xem giỏ giá trị cao). Cân nhắc kiểm tra ngẫu nhiên **tại quầy** cho chi nhánh này | Cao |
| 19 | **Tiền mặt và ca ở chế độ POS** | Két và ca do POS đối soát; các màn đối soát tiền mặt trong BRG không dùng | Chốt BRG chỉ đối chiếu theo đơn, hay bỏ hẳn phần ca thu ngân ở chi nhánh dùng POS | Trung bình |
| 20 | **Số tiền POS khác BRG** | Chấp nhận số POS, đánh dấu lệch | Ngưỡng lệch cần quản lý duyệt, quy định xử lý khi lệch lặp lại | Trung bình |
| 21 | **Hoá đơn công ty** | Khách nhập trước khi khoá giỏ, gửi cho POS; không sửa được sau khi POS nhận | Quy trình khi khách quên: thu ngân nhập trên POS | Thấp |
| 22 | **Hoàn tiền sau khi khách đã ra** (ở POS) | BRG ghi nhận và loại khỏi doanh thu | Quy trình thu hồi hoặc ghi nhận thất thoát, ai chịu trách nhiệm | Trung bình |

## Cách chốt

1. Quản trị chuỗi và các quản lý chi nhánh cùng xem từng mục, chọn phương án.
2. Ghi lại quyết định (ngày, người chốt) vào nhật ký dự án.
3. Chỉnh ứng dụng theo quyết định (các mục có thể cần thêm chức năng được đánh dấu ở cột Đề xuất) và cập nhật các hướng dẫn nghiệp vụ.
