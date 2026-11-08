# 13. Hướng dẫn triển khai

**Trạng thái:** Nháp. Các lệnh cài đặt, chạy PM2, sao lưu và khôi phục đã chạy thử từ một bản chép sạch của mã nguồn. Cấu hình Nginx và systemd **chưa chạy thử** (môi trường dựng tài liệu không có Nginx), hãy kiểm tra bằng `nginx -t` trước khi dùng.

## 1. Chạy kiểu fork hay cluster?

**Khuyến nghị: kiểu fork, một tiến trình** (PM2 `exec_mode: fork`, `instances: 1`).

- **Fork** là một tiến trình Node duy nhất xử lý mọi yêu cầu.
- **Cluster** là nhiều tiến trình Node cùng nghe một cổng, hệ điều hành chia yêu cầu cho chúng.

### Vì sao chọn fork

1. **Đủ sức cho nhu cầu này.** Đo trên máy thử 4 nhân (máy tạo tải chạy cùng máy, nên số thật thường tốt hơn):

   | Cách chạy | Khách quét cùng lúc | Yêu cầu mỗi giây | Độ trễ trung vị / p95 | Lỗi |
   |-----------|--------------------:|-----------------:|----------------------:|----:|
   | 1 tiến trình | 100 | khoảng 2.000 | 23 ms / 50 ms | 0 |
   | 1 tiến trình | 300 | khoảng 2.000 | 115 ms / 221 ms | 0 |
   | 2 tiến trình dùng chung CSDL | 200 | khoảng 2.500 | 49 ms / 108 ms | 0 |

   Một khách đang mua sắm chỉ gửi vài yêu cầu mỗi chục giây, nên một tiến trình phục vụ được **hàng nghìn khách cùng lúc**. Chạy `npm run loadtest` (xem mục 8) trên máy chủ thật để có số của riêng bạn, trước khi mở rộng.
2. **Cluster hầu như không tăng thêm sức chịu tải.** Dữ liệu nằm trong một file SQLite, mọi lần ghi phải xếp hàng, nên thêm tiến trình chỉ tăng khoảng 25% trong phép đo trên (điểm nghẽn là việc ghi, không phải CPU Node).
3. **Cluster thêm rủi ro:** công việc nền (đồng bộ POS mỗi phút, thử lại hoá đơn) sẽ chạy ở **mọi** tiến trình. Ứng dụng đã được làm an toàn khi chạy trùng (hoá đơn được "nhận việc" nguyên tử nên không xuất trùng; giao dịch CSDL dùng khoá ghi ngay từ đầu), nhưng vẫn là việc thừa và khó theo dõi.
4. **Đơn giản hơn để vận hành:** một tiến trình, một nhật ký, một nơi để khởi động lại.

Khi nào cân nhắc nhiều tiến trình hoặc nhiều máy: xem mục 9.

## 2. Mô hình triển khai

```
Khách, nhân viên, quản trị
        │  HTTPS (cổng 443)
        ▼
   Nginx  ── chứng chỉ Let's Encrypt, nén, giới hạn tần suất đăng nhập
        │  http://127.0.0.1:3000
        ▼
   Node.js (PM2, fork, 1 tiến trình)  ── công việc nền: đồng bộ POS, thử lại hoá đơn
        │
        ▼
   File SQLite (/var/lib/brg/brg.db)  ── sao lưu hằng giờ + đẩy ra máy khác mỗi đêm
```

Cấu hình tối thiểu cho một chuỗi vài chục chi nhánh thí điểm: **2 vCPU, 2 GB RAM**, ổ đĩa SSD. Tiến trình Node dùng khoảng 30 MB RAM lúc mới chạy (chưa đo lúc đông khách). Dung lượng CSDL tăng theo số giao dịch; hãy đo cả hai sau tuần thí điểm đầu tiên.

## 3. Chuẩn bị

- Máy chủ Linux (Ubuntu 22.04 trở lên hoặc tương đương), có quyền `sudo`.
- **Node.js 20.6 trở lên** (đã thử trên 22). Thư viện SQLite dùng bản dựng sẵn cho các nền tảng phổ biến; nếu không có bản dựng sẵn, cài thêm `build-essential` và `python3`.
- Một **tên miền** trỏ về máy chủ (ví dụ `self.congty.vn`) và cổng 80, 443 mở. **Bắt buộc HTTPS** vì trình duyệt chỉ cho dùng camera trên HTTPS.
- Tài khoản ngân hàng nhận tiền, nhà cung cấp POS và hoá đơn (có thể gắn sau, xem [11](11-ung-dung.md)).

## 4. Cài đặt từng bước

### 4.1 Tài khoản hệ thống và thư mục

```bash
sudo useradd --system --create-home --shell /bin/bash brg
sudo mkdir -p /opt/brg-self-checkout /var/lib/brg /var/backups/brg
sudo chown -R brg:brg /opt/brg-self-checkout /var/lib/brg /var/backups/brg
```

### 4.2 Lấy mã và cài thư viện

```bash
sudo -iu brg
git clone <địa-chỉ-kho-mã> /opt/brg-self-checkout
cd /opt/brg-self-checkout
git checkout <nhánh-hoặc-thẻ-phát-hành>
npm ci --omit=dev
```

`--omit=dev` bỏ các thư viện chỉ dùng khi phát triển; giao diện không cần bước build (thư viện giao diện đã nằm sẵn trong `public/shared/vendor`).

### 4.3 Cấu hình

```bash
cp .env.example .env
chmod 600 .env
openssl rand -hex 32        # chép kết quả vào APP_SECRET trong .env
nano .env
```

Bảng biến môi trường:

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `NODE_ENV` | | Đặt `production`. Khi đó **`APP_SECRET` bắt buộc**, công cụ thử nghiệm bị tắt, không chạy được `seed` |
| `APP_SECRET` | | Khoá ký đăng nhập và QR biên nhận. Giữ bí mật, sao lưu riêng. Đổi khoá làm mọi QR chưa dùng mất hiệu lực và mọi người phải đăng nhập lại |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | Đặt `HOST=127.0.0.1` để chỉ Nginx truy cập được |
| `TRUST_PROXY` | | `1` khi chạy sau Nginx |
| `DB_FILE` | `data/brg.db` | Đường dẫn file CSDL. Đặt ngoài thư mục mã nguồn, ví dụ `/var/lib/brg/brg.db` |
| `RECEIPT_TTL_MIN` | `180` | Thời hạn QR biên nhận (phút). Chỉ dùng ở luồng cũ có bảo vệ cổng ra |
| `PUBLIC_URL` | | Địa chỉ công khai, ví dụ `https://scan.congty.vn`. Dùng làm link xem bill trong email. Không đặt thì email vẫn gửi (kèm PDF) nhưng không có link |
| `CART_TTL_HOURS` | `12` | Giỏ bị bỏ quên quá số giờ này thì được dọn tự động (giỏ POS đã nhận thì giữ) |
| `POS_SYNC_SECONDS` | `60` | Chu kỳ đồng bộ POS |
| `RUN_JOBS` | bật | `0` để tắt công việc nền ở một tiến trình (chỉ khi chạy nhiều tiến trình) |
| `LOG_LEVEL` | `info` | `warn` để giảm nhật ký |
| `BACKUP_DIR`, `BACKUP_KEEP` | `data/backups`, `14` | Nơi lưu và số bản sao lưu giữ lại |

### 4.4 Tạo quản trị chuỗi đầu tiên

```bash
npm run create-admin -- --id QT0001 --name "Quản trị chuỗi" --password "MậtKhẩuMạnh123"
```

**Không** chạy `npm run seed:demo` ở máy chủ thật: dữ liệu mẫu có mật khẩu công khai. Sau khi đăng nhập `/a/`: bật xác thực 2 bước ngay, thêm chi nhánh, nhập tài khoản ngân hàng nhận tiền, tạo nhân viên (xem hướng dẫn "Cài đặt một chi nhánh mới" trong web quản trị).

### 4.5 Chạy bằng PM2 (kiểu fork)

```bash
sudo npm install -g pm2
cd /opt/brg-self-checkout
pm2 start ecosystem.config.cjs      # 1 tiến trình, fork, tự khởi động lại khi lỗi
pm2 save
pm2 startup                         # chạy lệnh sudo mà nó in ra để tự chạy khi khởi động máy
pm2 install pm2-logrotate           # xoay vòng nhật ký, tránh đầy ổ đĩa
curl http://127.0.0.1:3000/api/health      # phải trả {"ok":true,...}
```

Cách thay thế: dùng **systemd** thay PM2 với `deploy/brg.service.example` (cũng một tiến trình).

> **Không** đổi `exec_mode` thành `cluster` và không tăng `instances` khi chưa đọc mục 9.

### 4.6 Nginx và HTTPS

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/brg
sudo nano /etc/nginx/sites-available/brg        # đổi self.example.com thành tên miền thật
sudo ln -s /etc/nginx/sites-available/brg /etc/nginx/sites-enabled/brg
sudo certbot --nginx -d self.congty.vn           # cấp chứng chỉ và tự gia hạn
sudo nginx -t && sudo systemctl reload nginx
```

Cấu hình mẫu gồm: chuyển HTTP sang HTTPS, `Permissions-Policy: camera=(self)`, nén, giới hạn khoảng 10 lần đăng nhập mỗi phút cho mỗi IP (chống dò PIN và mật khẩu; ứng dụng còn khoá tài khoản 15 phút sau 5 lần sai).

Tường lửa chỉ mở 22, 80, 443:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

### 4.7 Kiểm tra sau cài đặt

1. `https://self.congty.vn/api/health` trả `{"ok":true}`.
2. Mở `https://self.congty.vn/a/`, đăng nhập quản trị, thấy Tổng quan.
3. Trong Chi nhánh và tính năng, bấm **Mã QR dán cổng vào** của một chi nhánh, quét bằng điện thoại: mở được trang khách bằng HTTPS và hỏi quyền camera.
4. Làm tiếp mục 4.8 (nhập chi nhánh, mã điểm, sản phẩm, khoá POS), rồi thử trọn quy trình: khách quét, bấm Thanh toán, POS quét mã QR và báo thanh toán.
5. Chạy `npm run backup` và kiểm tra có file mới trong `BACKUP_DIR`.

### 4.8 Nhập chi nhánh, sản phẩm và khoá cho POS (lần đầu)

1. Đăng nhập `/a/` bằng tài khoản vừa tạo, bật xác thực 2 bước.
2. **Chi nhánh:** thêm từng chi nhánh, nhập **Mã điểm** (mã siêu thị trong hệ thống giá và POS).
3. **Sản phẩm và giá:** khi chưa có API giá thật, nhập từ file CSV:
   `npm run import-products -- docs/mau/san-pham-mau.csv` (xem file mẫu để biết các cột; thêm `--replace` để thay toàn bộ sản phẩm của chi nhánh). Khi API giá thật có, bước này không còn dùng.
3b. **Email:** ở mục **Tích hợp**, thẻ "Email gửi cho khách", nhập máy chủ SMTP của công ty (máy chủ, cổng, kiểu bảo mật, tài khoản, mật khẩu, địa chỉ người gửi), bấm Lưu rồi "Gửi thử". Dùng để gửi mã xác nhận xem lịch sử trên máy khác và gửi bill về email khách. Máy chủ email dùng chứng chỉ tự ký hoặc CA nội bộ: chọn "Chứng chỉ tự ký hoặc CA nội bộ" ở mục kiểm tra chứng chỉ và nạp tệp chứng chỉ (kiểu bảo mật SSL/TLS cổng 465 vẫn giữ nguyên, không bị đổi). Mật khẩu được mã hoá khi lưu, không hiện lại.
4. Mục **Tích hợp:** bấm "Đồng bộ ngay" cho từng chi nhánh, tạo **khoá API cho POS** (chỉ hiện một lần, lưu lại), gửi cho đơn vị POS cùng `docs/api-qr-gio-hang.md`.
5. Trang **Chi nhánh:** bật Scan & Checkout cho chi nhánh. Mặc định chi nhánh dùng chế độ **Giỏ QR cho POS**.
6. Dùng điện thoại quét mã QR cổng vào (nút "Mã QR dán cổng vào"), quét thử vài mặt hàng, bấm Thanh toán và để POS quét thử.

Các tệp phông cho bill PDF nằm sẵn trong `server/assets/fonts`; `npm ci --omit=dev` đã cài thư viện tạo PDF.

## 5. Cập nhật phiên bản

```bash
cd /opt/brg-self-checkout
bash deploy/update.sh
```

Script này: sao lưu CSDL, `git pull --ff-only`, `npm ci --omit=dev`, tạo lại service worker (`npm run build:sw`), khởi động lại bằng PM2, kiểm tra `/api/health`.

- Khi khởi động lại, ứng dụng **tắt gọn**: ngừng nhận yêu cầu mới, chờ yêu cầu đang chạy xong rồi thoát (tối đa 8 giây), PM2 bật lại ngay. Gián đoạn khoảng 1 đến 2 giây. Khách đang quét không mất giỏ (giỏ lưu trên điện thoại và gửi lại được); nhân viên thao tác lại nếu đúng lúc đó gặp lỗi mạng.
- Nên cập nhật ngoài giờ bán hàng đông.
- **Cấu trúc CSDL:** khi khởi động, ứng dụng tự tạo bảng còn thiếu và tự **thêm cột mới** vào bảng đang có (không xoá hay đổi dữ liệu cũ). Vẫn luôn sao lưu trước khi cập nhật (script đã làm).
- **Quay lại bản cũ:** `git checkout <bản-cũ>`, `npm ci --omit=dev`, `npm run build:sw`, `pm2 restart brg-self-checkout`. Nếu bản mới đã đổi cấu trúc CSDL thì khôi phục thêm bản sao lưu (mục 6).

## 6. Sao lưu và khôi phục

**Dữ liệu cần giữ:** file CSDL (giao dịch, thanh toán, nhật ký, tài khoản) và file `.env` (đặc biệt `APP_SECRET`). Bản sao lưu CSDL chứa **dữ liệu cá nhân** (email khách, nhật ký), cần bảo vệ và mã hoá khi chép ra ngoài.

**Sao lưu tự động** (không cần dừng ứng dụng):

```bash
crontab -e     # dán nội dung từ deploy/backup.cron.example
```

`npm run backup` dùng cơ chế sao lưu trực tuyến của SQLite, kiểm tra toàn vẹn bản sao, giữ `BACKUP_KEEP` bản mới nhất. Mỗi bản là một file duy nhất `brg-YYYYMMDD-HHMM.db`. Khuyến nghị: **mỗi giờ** trên máy, **mỗi đêm** chép sang máy khác (ví dụ `rsync`, hoặc dịch vụ lưu trữ đám mây có mã hoá).

**Khôi phục:**

```bash
pm2 stop brg-self-checkout
cp /var/lib/brg/brg.db /var/lib/brg/brg.db.hong        # giữ lại bản đang hỏng để điều tra
rm -f /var/lib/brg/brg.db-wal /var/lib/brg/brg.db-shm
cp /var/backups/brg/brg-20261105-0840.db /var/lib/brg/brg.db
pm2 start brg-self-checkout
curl http://127.0.0.1:3000/api/health
```

Dữ liệu phát sinh giữa bản sao lưu và lúc hỏng sẽ mất (tối đa 1 giờ nếu sao lưu hằng giờ). Giao dịch trong khoảng đó cần đối chiếu thủ công bằng sao kê ngân hàng và sổ tiền mặt. **Hãy thử khôi phục thật định kỳ** (mỗi quý) trên một máy khác để chắc bản sao lưu dùng được.

## 7. Giám sát và nhật ký

- **Theo dõi sống còn:** cho một dịch vụ giám sát (UptimeRobot, Uptime Kuma...) gọi `https://self.congty.vn/api/health` mỗi phút và báo khi lỗi. Đường dẫn này kiểm tra cả CSDL.
- **Nhật ký ứng dụng:** `pm2 logs brg-self-checkout`, mỗi dòng là JSON. Dòng `"level":50` là lỗi.
- **Cảnh báo nghiệp vụ** nằm sẵn trong web quản trị: POS đồng bộ chậm, hoá đơn treo, ca chờ quản lý (trang Tổng quan).
- **Ổ đĩa:** theo dõi dung lượng trống của `/var/lib/brg`, `/var/backups/brg` và nhật ký.
- Ghi nhớ thay đổi cấu hình và tài khoản đã có sẵn trong **Nhật ký** của web quản trị.

## 8. Thử tải trên máy chủ của bạn

```bash
# Lấy vài mã vạch có trong chi nhánh đang thử (ví dụ từ mục Tích hợp, Công cụ thử nghiệm ở môi trường thử)
BASE=https://self.congty.vn STORE=Q7 BARCODES=893...,893... CLIENTS=100 SECONDS=15 npm run loadtest
```

Công cụ tạo nhiều phiên mua sắm thử. **Không** chạy ở máy chủ đang bán hàng thật, hãy chạy ở bản thử có cùng cấu hình. Đo xong, so với mục 1 và theo dõi CPU, độ trễ p95.

## 9. Khi nào cần cluster hoặc nhiều máy

Dấu hiệu cần mở rộng (đo ở giờ cao điểm thật, không đoán):

- CPU tiến trình Node thường xuyên trên khoảng 70%, hoặc độ trễ p95 của API trên khoảng 300 ms.
- Cần **chịu lỗi** (một máy hỏng vẫn chạy), không chỉ cần nhanh.

Các mức, từ nhẹ đến nặng:

1. **Nâng cấu hình máy** (thêm CPU). Đơn giản nhất và thường đủ.
2. **Thêm tiến trình trên cùng một máy dùng chung file SQLite** (đã thử chạy được, 0 lỗi, tăng khoảng 25%): chạy tiến trình phụ với `RUN_JOBS=0` và cổng khác, để Nginx chia tải qua `upstream`. Không dùng cluster của PM2 cho việc này vì mọi tiến trình đều bật công việc nền.
3. **Nhiều máy** (chịu lỗi, tải rất lớn): **không dùng được SQLite** vì file nằm trên một máy. Cần chuyển CSDL sang **PostgreSQL**, đặt công việc nền ở một tiến trình riêng (hoặc có cơ chế chọn tiến trình chủ), rồi đặt nhiều bản ứng dụng sau bộ chia tải. Ứng dụng đã được thiết kế không lưu trạng thái trong bộ nhớ (phiên khách, khoá đăng nhập đều nằm trong CSDL), nên bước này chủ yếu là chuyển lớp CSDL (`server/db.js` và các câu lệnh SQL trong `server/services`). Đây là một đợt công việc riêng, chưa làm.
4. **Dự phòng nóng** cho SQLite (sao chép liên tục sang máy phụ, ví dụ bằng Litestream): có thể là bước trung gian, nhưng **chưa được thử** ở dự án này.

## 10. Danh sách kiểm tra trước khi mở cho khách

- [ ] `NODE_ENV=production`, `APP_SECRET` ngẫu nhiên dài, `.env` quyền 600, không nằm trong git
- [ ] Chạy bằng người dùng `brg` (không phải root); `HOST=127.0.0.1`; tường lửa chỉ mở 22, 80, 443
- [ ] HTTPS hợp lệ, tự gia hạn; camera chạy được trên điện thoại thật
- [ ] Không dùng dữ liệu và tài khoản mẫu; quản trị chuỗi đã bật xác thực 2 bước
- [ ] Sao lưu chạy theo lịch, **đã thử khôi phục** một lần, có bản sao ngoài máy chủ
- [ ] Giám sát `/api/health` và có người nhận cảnh báo
- [ ] Mỗi chi nhánh đã có **Mã điểm** đúng với mã trong hệ thống giá và POS
- [ ] Đã thử trọn quy trình với giao dịch thật nhỏ: khách quét, bấm Thanh toán, POS quét mã QR, POS báo thanh toán, khách thấy bill
- [ ] POS đã thử: từ chối mã QR của cửa hàng khác (sai mã điểm), báo thanh toán trùng không thu hai lần, thử lại khi mất mạng
- [ ] Các mục "Điểm cần chốt" mức cao đã có quyết định
- [ ] Đã thử quét mã vạch trên nhiều điện thoại thật (iPhone và Android đời thấp)
- [ ] Giá: nếu còn nhập bằng file CSV (chưa có API giá thật) thì **chỉ chạy thử**, không bán hàng thật cho đến khi nối API giá (xem [api-gia-chi-nhanh](api-gia-chi-nhanh.md))

## 11. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|-----------|------------------------|------------|
| Máy chủ không khởi động, báo thiếu `APP_SECRET` | Chạy production mà chưa đặt khoá | Thêm `APP_SECRET` vào `.env`, khởi động lại với `pm2 restart ... --update-env` |
| 502 Bad Gateway từ Nginx | Ứng dụng đang tắt hoặc sai cổng | `pm2 status`, `pm2 logs`; kiểm tra `PORT` khớp với `upstream` |
| Camera không bật trên điện thoại | Trang không dùng HTTPS, hoặc mở trong trình duyệt của Zalo hoặc Facebook | Kiểm tra chứng chỉ; hướng dẫn khách mở bằng Safari hoặc Chrome |
| Khách báo "không kết nối được" nhưng `/api/health` ổn | Nginx hoặc DNS | Xem nhật ký Nginx, kiểm tra tên miền |
| Lỗi `database is locked` trong nhật ký | Có tiến trình khác giữ khoá ghi quá lâu (ví dụ sao lưu thủ công bằng `cp` lên file đang ghi) | Dùng `npm run backup`, không chép file đang chạy |
| Đĩa đầy | Nhật ký hoặc sao lưu quá nhiều | Giảm `BACKUP_KEEP`, bật `pm2-logrotate`, dọn bản cũ |
| Quên mật khẩu quản trị chuỗi duy nhất | | Quản trị chuỗi khác đặt lại; nếu không còn ai, tạo tài khoản mới bằng `npm run create-admin` với mã khác |
| Mọi QR chưa dùng báo không hợp lệ sau khi cập nhật | `APP_SECRET` bị đổi | Đặt lại đúng khoá cũ; nếu đã mất, khách cần được cấp lại QR (xem "Điểm cần chốt") |
| Đổi giờ máy chủ làm QR hết hạn sai | Đồng hồ máy chủ lệch | Bật đồng bộ giờ (`timedatectl set-ntp true`) |

## 12. Chưa có

- Dockerfile và cấu hình container (chưa được thử).
- Chế độ chịu lỗi nhiều máy (cần PostgreSQL).
- Cơ chế di chuyển cấu trúc CSDL tự động.
- Mã hoá bản sao lưu tự động (hãy mã hoá khi chép ra ngoài).
