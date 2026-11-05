---
title: Thu ngân và ca làm việc
summary: Việc của thu ngân trong một ca, từ bắt đầu ca, xử lý từng khách đến kết thúc ca và đối soát tiền mặt.
group: nghiep-vu
order: 40
access: all
---

# Thu ngân và ca làm việc

> **Luồng hiện hành là "Giỏ QR cho POS"** (bật sẵn cho mọi chi nhánh): khách quét mặt hàng, bấm Thanh toán, điện thoại hiện mã QR chứa mã vạch và số lượng; thu ngân quét mã vào POS, POS tạo đơn, tính tiền và báo thanh toán về BRG. Không còn bước thu tiền trong BRG, cổng ra và kiểm tra ngẫu nhiên. Nội dung dưới đây mô tả **luồng cũ**, hiện bị khoá và chỉ dùng khi quản trị chuỗi tắt công tắc "Giỏ QR cho POS" ở trang Chi nhánh. Xem thêm bài "Kết nối POS".

> **Lưu ý:** Hướng dẫn này cho chi nhánh **tự thu trong BRG**. Ở chi nhánh **thu tiền qua POS**, thu ngân làm việc hoàn toàn trên POS: quét mã giỏ trong POS, thu tiền, và hệ thống tự xác nhận. Các chức năng thu tiền trong app nhân viên (quét mã giỏ, hàng đợi, thu tiền mặt, xác nhận chuyển khoản, thu bổ sung, đối soát tiền mặt cuối ca) được **ẩn**; tiền mặt do POS đối soát theo ca của POS.

## Vòng đời một ca

```flow
title: Một ca của thu ngân
direction: down
a([Đăng nhập app nhân viên])
b[Chọn ca Sáng hoặc Chiều, bắt đầu ca]
c[Xử lý từng giỏ chờ thu]
d{Hết ca?}
e[Đếm tiền mặt thực tế]
f{Khớp với hệ thống?}
g[Nhập lý do chênh lệch]
h([Kết thúc ca, bàn giao tiền])
a --> b
b --> c
c --> d
d -- Chưa --> c
d -- Rồi --> e
e --> f
f -- Khớp --> h
f -- Lệch --> g
g --> h
```

- **Phải bắt đầu ca trước khi thu tiền.** Mọi khoản thu được gắn với ca đang mở của nhân viên đó.
- Mỗi nhân viên một tài khoản và một PIN riêng. **Không dùng chung** tài khoản hay PIN.
- Ca chỉ là nhãn Sáng hoặc Chiều để đối soát và xếp lịch; thời gian ca tính từ lúc bắt đầu đến lúc kết thúc.

## Xử lý một khách

1. **Tìm giỏ:** quét mã giỏ hàng trên điện thoại khách, hoặc nhập tay mã `GH-...` (khi màn hình chói hoặc nứt), hoặc chọn trong **Hàng đợi** (giỏ chờ lâu nhất ở trên).
2. **Đối chiếu giỏ:** xem danh sách mặt hàng, số lượng, tổng. Chú ý hai cảnh báo:
   - **Có hàng giới hạn độ tuổi:** kiểm tra giấy tờ của khách trước khi thu.
   - **Được chọn kiểm tra ngẫu nhiên:** có thể đối chiếu hàng thật ngay tại quầy (nút **Đối chiếu ngay tại quầy**), hoặc để nhân viên cổng ra kiểm tra.
3. **Chọn cách trả** (mặc định theo khách chọn, có thể đổi), rồi thu:
   - **Tiền mặt:** nhập số khách đưa, trả tiền thừa, bấm **Đã thu tiền**.
   - **Chuyển khoản:** đối chiếu thông báo ngân hàng, tick đủ 3 ô, bấm **Xác nhận đã nhận tiền**.
4. Màn hình báo **Đã thu**. Khách đã thấy QR biên nhận. Bấm **Khách tiếp theo**.

### Các thao tác khác tại quầy

| Việc | Cách làm | Hệ quả |
|------|---------|--------|
| Khách đổi ý, không mua nữa | **Huỷ giỏ hàng** kèm lý do | Giỏ mở lại trên điện thoại khách để sửa hoặc trả lại |
| Thu khoản bổ sung | Tìm lại giỏ, màn **Thu bổ sung** | Cộng vào tiền của ca |
| Giỏ bị giữ chờ quản lý | Không thu được | Chờ quản lý quyết định |

> **Lưu ý:** Thu ngân **không** huỷ được giao dịch đã thu tiền. Việc đó chỉ quản lý làm được, bắt buộc có lý do.

## Kết thúc ca và đối soát tiền mặt

1. Bấm **Đối soát và kết thúc ca**.
2. Đếm **tiền mặt thực tế** trong két thuộc ca của mình, nhập vào.
3. Hệ thống so với **tiền mặt hệ thống** (tổng các khoản đã thu bằng tiền mặt trong ca, không tính khoản đã bị huỷ).
4. Nếu **lệch**, bắt buộc **ghi lý do** mới kết thúc được ca. Ca lệch hiện ở mục Đối soát của quản lý.
5. Bàn giao tiền theo quy định nội bộ của chi nhánh.

Tiền **chuyển khoản không đếm** ở bước này. Chuyển khoản được quản lý đối chiếu với sao kê ngân hàng (xem "Quản lý, đối soát và huỷ giao dịch").

> **Cần xác nhận:** Chưa có quy định ngưỡng lệch chấp nhận được và ai duyệt khi lệch lớn. Xem "Điểm cần chốt".

## Danh sách kiểm tra cho thu ngân

**Đầu ca**
- Đăng nhập bằng đúng tài khoản của mình, bắt đầu ca.
- Kiểm tra két và tiền lẻ.
- Mở sẵn app ngân hàng (hoặc loa báo tiền) để đối chiếu chuyển khoản.

**Mỗi khách**
- Đúng giỏ (đối chiếu mã, số mặt hàng, tổng).
- Hàng giới hạn độ tuổi: đã xem giấy tờ.
- Chuyển khoản: tận mắt thấy tiền vào tài khoản công ty, đúng số tiền, đúng nội dung.
- Trả đúng tiền thừa.

**Cuối ca**
- Đếm tiền mặt, nhập đúng số thực tế, ghi lý do nếu lệch.
- Bàn giao tiền và đăng xuất.
