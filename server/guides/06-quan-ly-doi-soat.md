---
title: Quản lý, đối soát và huỷ giao dịch
summary: Công việc hằng ngày của quản lý chi nhánh, đối soát tiền mặt và chuyển khoản, huỷ giao dịch, theo dõi chênh lệch và điều chỉnh tỷ lệ kiểm tra.
group: nghiep-vu
order: 60
access: all
---

# Quản lý, đối soát và huỷ giao dịch

> **Luồng hiện hành là "Giỏ QR cho POS"** (bật sẵn cho mọi chi nhánh): khách quét món, bấm Thanh toán, điện thoại hiện mã QR chứa mã vạch và số lượng; thu ngân quét mã vào POS, POS tạo đơn, tính tiền và báo thanh toán về BRG. Không còn bước thu tiền trong BRG, cổng ra và kiểm tra ngẫu nhiên. Nội dung dưới đây mô tả **luồng cũ**, hiện bị khoá và chỉ dùng khi quản trị chuỗi tắt công tắc "Giỏ QR cho POS" ở trang Chi nhánh. Xem thêm bài "Kết nối POS".

Vì ở giai đoạn 1 **người** xác nhận thu tiền, các bước kiểm soát của quản lý là phần quan trọng nhất để không thất thoát. Web quản trị cung cấp công cụ cho từng việc dưới đây.

## Việc hằng ngày của quản lý chi nhánh

| Thời điểm | Việc | Mục trong web quản trị |
|-----------|------|------------------------|
| Đầu ngày | Kiểm tra dữ liệu sản phẩm đã đồng bộ, không có cảnh báo POS chậm | Hôm nay, Tổng quan |
| Đầu ngày | Ca có đủ **thu ngân** và **cổng ra**, không có cảnh báo thiếu người | Nhân viên và ca |
| Trong ngày | Theo dõi số giỏ chờ thu, ca bị giữ, giao dịch có chênh lệch | Hôm nay |
| Trong ngày | Xử lý các ca **chờ quản lý** | Hôm nay, Giao dịch |
| Cuối ngày | **Đối soát tiền mặt** từng ca | Đối soát |
| Cuối ngày | **Đối soát chuyển khoản** với sao kê ngân hàng | Đối soát |
| Cuối ngày | Xử lý **mã vạch không tìm thấy** | Mã không tìm thấy |
| Hằng tuần | Xem báo cáo, điều chỉnh tỷ lệ kiểm tra | Báo cáo, Kiểm tra ngẫu nhiên |

## Đối soát cuối ngày

```flow
title: Đối soát cuối ngày
direction: down
a[Mở mục Đối soát, chọn ngày]
b[Xem từng ca: tiền hệ thống, tiền đếm thực tế, chênh lệch]
c{Ca nào lệch?}
d[Hỏi nhân viên, xem ghi chú lý do, mở giao dịch liên quan]
e[Tải sao kê ngân hàng trong ngày, dán hoặc chọn file CSV]
f[Hệ thống khớp theo mã giao dịch và số tiền]
g{Có dòng không khớp?}
h[Tra giao dịch chỉ có ở hệ thống hoặc chỉ có ở sao kê]
i([Ghi nhận kết quả, xử lý chênh lệch])
a --> b
b --> c
c -- Có --> d
c -- Không --> e
d --> e
e --> f
f --> g
g -- Có --> h
g -- Không --> i
h --> i
```

### Đối soát tiền mặt

- Mỗi ca hiện: nhân viên, giờ bắt đầu và kết thúc, **tiền mặt hệ thống**, **tiền mặt đếm thực tế**, **chênh lệch**, ghi chú.
- Ca **đang mở** hiện tiền hệ thống tính đến thời điểm hiện tại, chưa có số đếm.
- Ca lệch phải có lý do nhân viên ghi khi kết thúc ca. Quản lý xác minh lý do, và nếu cần mở giao dịch để xem lại.

### Đối soát chuyển khoản

1. Lấy **sao kê ngân hàng** của tài khoản nhận tiền trong ngày (dạng bảng có cột **số tiền** và **nội dung**).
2. Dán nội dung CSV hoặc chọn file CSV ở mục Đối soát. Hệ thống chấp nhận dấu phẩy hoặc chấm phẩy, số có dấu chấm ngăn cách hàng nghìn, và tự bỏ dòng tiêu đề.
3. Hệ thống khớp từng khoản chuyển khoản **đã xác nhận trong ngày** với dòng sao kê theo **mã giao dịch trong nội dung** và **số tiền**.
4. Xử lý kết quả:
   - **Chỉ có ở hệ thống:** thu ngân đã xác nhận nhưng sao kê không có khoản đó. **Nghi vấn nghiêm trọng**, cần xác minh ngay (có thể xác nhận nhầm hoặc khai gian).
   - **Chỉ có ở sao kê:** có tiền vào nhưng không có giao dịch tương ứng (khách chuyển nhưng chưa mua, chuyển dư, hoặc chuyển rồi huỷ giỏ). Cần hoàn tiền hoặc đối chiếu.

> **Quan trọng:** Đối soát chuyển khoản hằng ngày là lớp bảo vệ chính chống xác nhận sai. Đừng bỏ qua.

## Huỷ giao dịch đã thu

Dùng khi thu ngân bấm nhầm xác nhận, hoặc khách rút lại giỏ sau khi đã trả mà chưa ra cổng.

**Điều kiện:** giao dịch **đã thu tiền** và khách **chưa ra cổng**. Chỉ **quản lý chi nhánh hoặc quản trị chuỗi** thực hiện, và **bắt buộc ghi lý do**.

**Thực hiện:** web quản trị, Giao dịch, mở giao dịch, **Huỷ giao dịch**.

**Hệ quả:**
- QR biên nhận **mất hiệu lực** ngay (quét ở cổng báo không hợp lệ).
- Các khoản thu của giao dịch bị đánh dấu huỷ, **không còn tính** vào doanh thu và tiền mặt hệ thống của ca.
- Hoá đơn đã xuất chuyển sang trạng thái **yêu cầu huỷ**, cần xử lý với nhà cung cấp hoá đơn.
- Mọi thao tác được ghi nhật ký.

> **Cần xác nhận:** Ứng dụng chưa có chức năng **hoàn tiền**. Hoàn tiền cho khách (tiền mặt hoặc chuyển khoản lại) làm ngoài hệ thống, quản lý ghi nhận bằng ghi chú huỷ. Khi khách đã ra cổng thì không huỷ được. Xem "Điểm cần chốt".

## Đơn POS và đối soát với POS

Ở chi nhánh **thu tiền qua POS**, trang **Đơn POS** (web quản trị) liệt kê mọi giỏ POS đã nhận: mã giỏ, mã đơn POS, trạng thái (đã nhận, đã thanh toán, đã huỷ), **tổng BRG so với số tiền POS**, số hoá đơn, thu ngân và quầy. Trang tự làm mới.

Việc quản lý cần làm:

| Việc | Cách làm |
|------|----------|
| **Đơn lệch tiền** (số POS khác tạm tính của BRG) | Xem nguyên nhân: khuyến mãi theo hoá đơn, làm tròn, hay sai sót. Lệch lớn hoặc lặp lại thì báo bộ phận POS |
| **Đơn chờ lâu** (POS đã nhận giỏ nhưng quá 10 phút chưa báo thanh toán) | Hỏi thu ngân. Nếu POS sập giữa chừng, bấm **Nhả giỏ** kèm lý do để khách không bị kẹt. Nhả rồi mà POS vẫn báo đã thanh toán thì BRG từ chối, phải đối soát tay |
| **Đơn đã huỷ sau khi khách ra** | Xem nhật ký và xác minh với POS, xử lý hàng hoá theo quy định của cửa hàng |
| **Đối soát cuối ngày** | So số giao dịch và số tiền BRG đã thu trong ngày với báo cáo bán hàng của POS (đơn có nguồn Self Checkout). Chênh lệch phải giải thích được |

Tiền mặt và chuyển khoản ở chế độ POS **do POS đối soát** (két theo ca của POS, sao kê theo POS). Các màn đối soát tiền mặt và sao kê trong BRG chỉ còn ý nghĩa cho chi nhánh tự thu.

## Truy vết một giao dịch

Mở **Giao dịch**, tìm theo mã giỏ (`GH-...`) hoặc mã giao dịch (`SG-...`). Trang chi tiết có **dòng thời gian**: khách bắt đầu, số lần quét, khoá giỏ, ai thu tiền và bằng cách nào (kể cả tiền khách đưa, tiền thừa), hoá đơn, quét ở cổng nào, kết quả kiểm tra, quyết định của quản lý. Dùng khi khách khiếu nại hoặc tiền lệch.

## Theo dõi và điều chỉnh tỷ lệ kiểm tra

- Mục **Kiểm tra ngẫu nhiên** hiện số liệu 7 ngày: số lượt kiểm tra, số lần phát hiện chênh lệch, tỷ lệ.
- Báo cáo hiện **tỷ lệ chênh lệch** theo ngày.
- Gợi ý vận hành: bắt đầu tỷ lệ cao khi thí điểm. Giảm dần khi tỷ lệ chênh lệch ổn định ở mức thấp và đủ dữ liệu (nên có ít nhất vài tuần). Tăng lại khi thấy chênh lệch tăng hoặc có sự cố.

> **Cần xác nhận:** Chưa có ngưỡng chính thức để quyết định tăng hoặc giảm tỷ lệ. Xem "Điểm cần chốt".

## Mã vạch không tìm thấy

Mỗi lần khách quét một mã **không có trong dữ liệu POS** của chi nhánh, mã được ghi vào danh sách này (kèm số lần quét và lần cuối). Quản lý chuyển cho bộ phận hàng hoá bổ sung vào POS, rồi đổi trạng thái: **Mới** → **Đã báo POS** → **Đã xử lý**. Danh sách cũng giúp phát hiện hàng thiếu dữ liệu.

## Báo cáo

Báo cáo theo ngày: số giao dịch, doanh thu, tiền mặt, chuyển khoản, lượt kiểm tra, chênh lệch. Xuất được **CSV** để mở bằng Excel. Quản trị chuỗi xem toàn chuỗi hoặc lọc từng chi nhánh; quản lý chi nhánh chỉ thấy chi nhánh mình.

> **Lưu ý:** Báo cáo lấy từ dữ liệu của BRG Self Checkout. Doanh thu bán ở quầy thường nằm trong POS và chưa được gộp.
