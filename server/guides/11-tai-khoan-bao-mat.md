---
title: Tài khoản và bảo mật
summary: Tạo và quản lý tài khoản, PIN, mật khẩu, xác thực 2 bước, khóa tài khoản và thời hạn đăng nhập.
group: he-thong
order: 20
access: all
---

# Tài khoản và bảo mật

## Loại tài khoản

| Vai trò | Đăng nhập ở đâu | Bằng gì |
|---------|-----------------|---------|
| Thu ngân, cổng ra, thu ngân + cổng ra | App nhân viên `/s/` | Mã nhân viên và **PIN** 4 đến 6 chữ số |
| Quản lý chi nhánh | Web quản trị `/a/` (và app nhân viên nếu có PIN) | Tài khoản hoặc email và **mật khẩu**, kèm **mã xác thực 2 bước** nếu đã bật |
| Quản trị chuỗi | Web quản trị `/a/` | Như trên |

Khách **không có tài khoản**. Giỏ hàng và lịch sử gắn với thiết bị; khách có thể liên kết email (nhận mã xác nhận) để xem lịch sử trên máy khác.

## Tạo và quản lý tài khoản

Mục **Tài khoản và phân quyền**:

- **Thêm tài khoản:** chọn vai trò và chi nhánh, nhập họ tên, PIN (nhân viên) hoặc mật khẩu (quản trị). Quản lý chi nhánh chỉ tạo được **nhân viên** của chi nhánh mình; quản lý và quản trị chuỗi do quản trị chuỗi tạo.
- **Khóa hoặc mở khóa:** khi nhân viên nghỉ việc hoặc nghi ngờ lộ tài khoản. Tài khoản bị khóa không đăng nhập được và token đang dùng bị từ chối ngay.
- **Đặt lại PIN:** khi nhân viên quên PIN, hoặc sau khi bị khóa tạm. Quản trị chuỗi **đặt lại mật khẩu** quản trị.
- Không xóa tài khoản, để giữ nguyên dấu vết trong nhật ký. Muốn ngừng dùng thì khóa.
- Không tự khóa được tài khoản của chính mình.

**Quy tắc mật khẩu và PIN**
- PIN: 4 đến 6 chữ số, mỗi người một PIN. Tránh PIN dễ đoán (1234, ngày sinh).
- Mật khẩu quản trị: tối thiểu 8 ký tự, có cả chữ và số.
- Hệ thống chỉ lưu bản **băm** của PIN và mật khẩu, không ai xem lại được.

## Xác thực 2 bước (quản trị)

Quản trị viên xem được doanh thu và tiền thu nên nên **bật xác thực 2 bước**:

1. Mở **Tài khoản và phân quyền**, chọn bật xác thực 2 bước cho tài khoản của mình.
2. Quét **mã QR** bằng app xác thực trên điện thoại (Google Authenticator, Microsoft Authenticator, Authy...), hoặc nhập **mã bí mật** bằng tay.
3. Từ lần sau, đăng nhập cần thêm **mã 6 chữ số** trong app.

> **Quan trọng:** Mã bí mật chỉ hiện **một lần** khi bật. Hãy lưu lại ở nơi an toàn. Nếu mất điện thoại, quản trị chuỗi khác tắt hoặc bật lại xác thực 2 bước cho tài khoản đó.

## Khóa tạm và hết phiên

- Sai PIN hoặc mật khẩu hoặc mã xác thực **5 lần liên tiếp** thì tài khoản bị **khóa tạm 15 phút**. Quản lý có thể mở khóa và đặt lại ngay.
- Phiên đăng nhập app nhân viên kéo dài khoảng **12 giờ**, web quản trị khoảng **8 giờ**; sau đó phải đăng nhập lại.
- Khi tài khoản bị khóa giữa chừng, lần thao tác kế tiếp tự đăng xuất.

## Phạm vi dữ liệu

- Quản lý chi nhánh **chỉ thấy** dữ liệu của chi nhánh mình (giao dịch, ca, nhân viên, báo cáo). Máy chủ ép sẵn, thay tham số trên đường dẫn cũng không xem được chi nhánh khác.
- Nhân viên chỉ thao tác trên giao dịch của chi nhánh mình.
- Mọi lần đăng nhập quản trị, đổi cấu hình, tạo hoặc khóa tài khoản đều được **ghi nhật ký**.

## Giữ dữ liệu cá nhân

Trang **Tích hợp > Giữ dữ liệu** (quản trị chuỗi) đặt thời hạn lưu. Hệ thống tự dọn mỗi 6 giờ, hoặc bấm **Dọn ngay**:

- **Thông tin cá nhân của khách** (email nhận bill, thông tin xuất hóa đơn công ty, email đã xác minh, mã thiết bị gắn với đơn): mặc định xóa sau **12 tháng** kể từ lúc thanh toán. Đơn, số tiền, dòng hàng, bill và hoàn trả được giữ nguyên nên doanh thu và đối soát không đổi.
- **Nhật ký kỹ thuật** (nhật ký quét, chi tiết giỏ đã kết thúc, lần quét ở cổng): mặc định **90 ngày**.
- **Nhật ký thao tác** (ai làm gì): mặc định **24 tháng**.
- Nhập `0` để giữ mãi mục đó. Sau thời hạn, khách không còn xem lại được bill cũ trong lịch sử trên điện thoại. Bản sao lưu vẫn chứa dữ liệu trước khi xóa, nên cần giới hạn số bản sao lưu giữ lại.

### Khách yêu cầu xóa dữ liệu

Vào **Tích hợp > Xóa dữ liệu theo yêu cầu của khách** (quản trị chuỗi), nhập email của khách, bấm **Tìm dữ liệu** để xem số bản ghi, rồi **Xóa dữ liệu** và xác nhận. Hệ thống xóa email, thông tin xuất hóa đơn công ty và liên kết thiết bị của khách; đơn, số tiền, bill và doanh thu giữ nguyên. Việc này **không hoàn tác được**, bill khách đã nhận qua email và hóa đơn ở nhà cung cấp hóa đơn không bị thu hồi. Hãy ghi chú mã yêu cầu để truy vết; nhật ký chỉ lưu dấu vết băm của email.

## Thực hành tốt

- Mỗi người một tài khoản, **không dùng chung**.
- Nhân viên nghỉ việc: khóa tài khoản **ngay trong ngày**.
- Rà soát danh sách tài khoản định kỳ, khóa tài khoản không còn dùng.
- Đăng nhập web quản trị trên thiết bị tin cậy, đăng xuất khi xong.
