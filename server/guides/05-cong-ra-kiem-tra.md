---
title: Cổng ra và kiểm tra ngẫu nhiên
summary: Cách nhân viên cổng ra quét QR biên nhận, các kết quả có thể gặp, kiểm tra ngẫu nhiên, xử lý chênh lệch và khách từ chối.
group: nghiep-vu
order: 50
access: all
---

# Cổng ra và kiểm tra ngẫu nhiên

Nhân viên cổng ra dùng **app nhân viên** (điện thoại hoặc máy cầm tay). Mục đích: chỉ cho qua người **đã thanh toán**, mỗi QR **một lần**, và kiểm tra hàng thật với một tỷ lệ khách do hệ thống chọn.

## Quét QR biên nhận

Mở mục **Kiểm tra cổng ra**, chọn cổng (Cổng 1 hoặc Cổng 2), quét QR trên điện thoại khách. Không quét được thì dán hoặc nhập chuỗi QR vào ô bên dưới. Kết quả hiện **toàn màn hình, đổi màu** để nhìn một lần là biết:

```flow
title: Kết quả khi quét QR ở cổng
direction: right
a[Quét QR biên nhận]
b{Kết quả}
c([Xanh: Cho khách qua])
d[Cam: Được chọn kiểm tra ngẫu nhiên]
e[Cam: Còn khoản thu bổ sung]
f[Đỏ: Không cho qua]
g[Cam: Đang chờ quản lý]
a --> b
b -- Hợp lệ --> c
b -- Cần kiểm tra --> d
b -- Còn nợ --> e
b -- Có vấn đề --> f
b -- Bị giữ --> g
```

| Kết quả | Màu | Ý nghĩa | Việc cần làm |
|---------|-----|---------|--------------|
| **Hợp lệ, cho qua** | Xanh | Đã thanh toán, QR chưa dùng, còn hạn, không cần kiểm tra | Cho khách qua. Hệ thống đánh dấu QR đã dùng ngay |
| **Cần kiểm tra giỏ hàng** | Cam | Giao dịch hợp lệ nhưng được chọn kiểm tra ngẫu nhiên | Bắt đầu kiểm tra (xem bên dưới) |
| **Còn khoản thu bổ sung** | Cam | Lần kiểm tra trước ghi chênh lệch cần thu thêm | Mời khách quay lại quầy thu bổ sung, rồi quét lại |
| **Đang chờ quản lý** | Cam | Giao dịch bị giữ để quản lý quyết định | Mời khách đợi, gọi quản lý |
| **Không cho qua** (đã dùng) | Đỏ | QR này đã được quét, hiện giờ và người quét | Không cho qua, gọi quản lý. Có thể QR bị chụp lại |
| **Không cho qua** (chưa thanh toán) | Đỏ | Mã chưa được thu tiền | Mời khách về quầy thanh toán |
| **Không cho qua** (hết hạn) | Đỏ | QR quá hạn hiệu lực | Gọi quản lý |
| **Không cho qua** (không hợp lệ) | Đỏ | Mã sai, bị sửa, đã bị huỷ, hoặc không thuộc chi nhánh này | Không cho qua, gọi quản lý |
| **Không phải biên nhận** | Đỏ | Khách đưa nhầm **mã giỏ hàng** (`GH-...`) thay vì QR biên nhận | Hướng dẫn khách mở màn "Mã ra cổng" sau khi đã thanh toán |
| **Không cho qua** (quản lý từ chối) | Đỏ | Quản lý đã từ chối cho qua | Mời khách gặp quản lý |

> **Quan trọng:** Mọi lần quét, **kể cả bị từ chối**, đều được ghi lại (người quét, giờ, kết quả). Không có cách "cho qua tay" bằng ứng dụng, nên không cho khách ra khi kết quả màu đỏ.

## Cách hệ thống chọn khách để kiểm tra

Quyết định được đưa ra **khi khách khoá giỏ**, bởi hệ thống, không phải nhân viên:

- Mỗi chi nhánh có **tỷ lệ kiểm tra mặc định** (mẫu: 10%, tức khoảng 1 trong 10 khách).
- Nếu khách **dùng lần đầu** trên thiết bị này, tỷ lệ nâng lên mức riêng (mẫu: 20%).
- Nếu giỏ có giá trị **từ ngưỡng giá trị cao** trở lên (mẫu: 500.000₫), tỷ lệ nâng lên mức riêng (mẫu: 25%).
- Khi nhiều điều kiện cùng đúng, áp dụng **mức cao nhất**, không cộng dồn.
- Quản lý chi nhánh đặt các tỷ lệ này ở mục **Kiểm tra ngẫu nhiên** của web quản trị.

> **Lưu ý:** Nên bắt đầu với tỷ lệ cao khi thí điểm rồi giảm dần theo số liệu chênh lệch thực tế (xem "Quản lý, đối soát và huỷ giao dịch").

## Quy trình kiểm tra

Thực hiện ở **cổng ra**, hoặc sớm hơn ngay **tại quầy** nếu thu ngân muốn đối chiếu lúc khách còn đứng đó. Giao dịch chỉ kiểm tra **một lần**.

```seq
title: Kiểm tra ngẫu nhiên tại cổng ra
actors: Khách | Nhân viên cổng | Hệ thống
Khách -> Nhân viên cổng: Đưa QR biên nhận
Nhân viên cổng -> Hệ thống: Quét QR
Hệ thống --> Nhân viên cổng: Cần kiểm tra, danh sách món và số lượng
Hệ thống --> Khách: Hiện thông báo được chọn kiểm tra
Nhân viên cổng -> Nhân viên cổng: Đối chiếu từng dòng với hàng thật
note over Nhân viên cổng, Hệ thống: Tick từng dòng, không xem giá
Nhân viên cổng -> Hệ thống: Khớp, cho qua
Hệ thống --> Nhân viên cổng: Cho khách qua, QR đã dùng
```

1. Bấm **Bắt đầu kiểm tra**. Không có nút bỏ qua.
2. Đối chiếu hàng thật khách mang theo với **danh sách số lượng** (không hiện giá, để tập trung đếm). **Tick từng dòng** khi đã thấy đúng hàng.
3. **Khớp hết:** bấm **Khớp, cho qua**. Hệ thống ghi nhận và cho khách qua.
4. **Có chênh lệch:** bấm **Có chênh lệch** (xem bên dưới).

### Khi có chênh lệch

Chọn:
- **Loại:** có hàng chưa quét, sai số lượng, hoặc khác.
- **Sản phẩm** liên quan, **số tiền chênh lệch** (số nguyên, đồng), **ghi chú** ngắn gọn.
- **Cách xử lý:**
  - **Khách thanh toán bổ sung:** khoản được cộng thành nợ của giao dịch. Mời khách quay lại quầy, thu ngân thu thêm (tiền mặt hoặc chuyển khoản), rồi nhân viên cổng **quét lại** QR để cho qua.
  - **Báo quản lý:** giao dịch bị giữ, khách chưa được qua cho đến khi quản lý quyết định.

```flow
title: Xử lý khi kiểm tra có chênh lệch
direction: down
a[Ghi chênh lệch: loại, sản phẩm, số tiền, ghi chú]
b{Cách xử lý}
c[Khách quay lại quầy]
d[Thu ngân thu bổ sung]
e[Nhân viên cổng quét lại QR]
f([Cho khách qua])
g[Giao dịch bị giữ]
h[Quản lý xem chi tiết, nói chuyện với khách]
i{Quyết định}
j([Khách gặp quản lý, giao dịch ở trạng thái từ chối])
a --> b
b -- Thu bổ sung --> c
c --> d
d --> e
e --> f
b -- Báo quản lý --> g
g --> h
h --> i
i -- Cho qua --> f
i -- Từ chối --> j
```

### Khách từ chối kiểm tra

Chọn **Khách từ chối, gọi quản lý**. Giao dịch được ghi lại và **bị giữ** chờ quản lý. Nhân viên **không** tự quyết định cho qua.

## Quản lý xử lý ca bị giữ

Quản lý (đăng nhập app nhân viên hoặc web quản trị) mở mục **Chờ quản lý**:
- Xem **lý do** và ghi chú của lần kiểm tra (ví dụ khách từ chối, chênh lệch gì), và mở xem danh sách món.
- Chọn **Cho qua** (kèm ghi chú) hoặc **Từ chối** (kèm ghi chú).
- Sau khi **từ chối**, giao dịch ở trạng thái "bị từ chối". Quản lý vẫn **đổi được quyết định** sau đó (ví dụ khách đã giải quyết xong).
- Nếu **cho qua** và không còn khoản bổ sung, khách được ghi nhận là đã ra cổng.

> **Lưu ý:** Chỉ quản lý chi nhánh hoặc quản trị chuỗi được duyệt hoặc từ chối. Nhân viên thường nhận thông báo "gọi quản lý".

## Khách nhìn thấy gì

- Khi được chọn kiểm tra, màn hình khách hiện **"Bạn được chọn kiểm tra ngẫu nhiên"**, giải thích lời lẽ trung tính (chỉ mất khoảng một phút) và danh sách món để khách đối chiếu cùng.
- Khi bị giữ chờ quản lý: **"Nhân viên đang xử lý"**. Khi bị từ chối: **"Vui lòng gặp quản lý"**.
- Khi hoàn tất: **"Cảm ơn bạn đã mua sắm"** và đánh giá nhanh một chạm (bỏ qua được).

## Chi nhánh không có bảo vệ

Chi nhánh không có người ở cổng ra được quản trị chuỗi **tắt bước bảo vệ** (Chi nhánh và tính năng, cột "Bảo vệ cổng ra"). Khi tắt:

- Thanh toán xong khách **ra luôn**. Giao dịch được tự ghi nhận là đã ra (do hệ thống, không có người quét).
- **Không có mã QR ra cổng.** Màn hình khách chuyển thẳng sang "Cảm ơn bạn", không hiện mã.
- **Không có kiểm tra ngẫu nhiên** (hệ thống không bốc giỏ nào, vì việc kiểm tra thuộc bước ở cổng).
- App nhân viên ẩn mục Kiểm tra cổng ra; máy chủ từ chối quét QR ở cổng.
- Khi **tắt** cho chi nhánh đang chạy: các khách đã thanh toán mà chưa ra cổng được coi là **đã ra**. Khi **bật lại**: chỉ áp dụng cho giao dịch mới.

> **Quan trọng:** Tắt bảo vệ nghĩa là **không còn lớp kiểm soát hàng ở cổng**. Cần có biện pháp bù: tỷ lệ thất thoát được theo dõi qua đối soát tồn kho, camera, hoặc nhân viên quầy chủ động xem giỏ (đối chiếu) với khách giá trị cao. Xem "Điểm cần chốt".

## Danh sách kiểm tra cho nhân viên cổng ra

- Đã chọn đúng cổng (Cổng 1 hoặc Cổng 2) để nhật ký ghi đúng.
- Không cho qua khi kết quả màu đỏ hoặc cam, trừ khi đã xử lý xong theo hướng dẫn.
- Khi kiểm tra: đếm hàng thật, không bỏ dòng nào, ghi chú chênh lệch rõ ràng, không tranh cãi với khách mà gọi quản lý.
- Lời lẽ nhã nhặn: kiểm tra ngẫu nhiên là quy trình chung, không phải nghi ngờ cá nhân.
