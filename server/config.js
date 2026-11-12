// Cấu hình chạy. Mọi giá trị nhạy cảm lấy từ biến môi trường.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Chỉ chạy ở chế độ phát triển khi nói rõ (BRG_DEV=1, hoặc đang chạy kiểm thử). Mọi trường hợp khác là production: bắt buộc có khóa bí mật riêng,
// tắt công cụ thử (/dev/*), không trả mã xác nhận email ra màn hình, cookie có cờ Secure. Không còn "quên đặt NODE_ENV thì thành chế độ thử".
const DEV_SECRET = 'dev-only-secret-change-me';
const devMode = process.env.BRG_DEV === '1' || !!process.env.NODE_TEST_CONTEXT;
const isProd = !devMode;

if (isProd) {
  const s = process.env.APP_SECRET;
  if (!s || s === DEV_SECRET) throw new Error('APP_SECRET là bắt buộc (chuỗi ngẫu nhiên dài, tạo bằng: openssl rand -hex 32). Chạy thử trên máy phát triển thì đặt BRG_DEV=1.');
  if (s.length < 32) throw new Error('APP_SECRET phải dài ít nhất 32 ký tự (openssl rand -hex 32). Khóa ngắn dò ra được và ký giả được mọi token. Đổi khóa thì mọi phiên đăng nhập và QR chưa dùng mất hiệu lực.');
}

// CSDL: mặc định SQLite (một file). DB_DRIVER=mssql để dùng SQL Server (xem hướng dẫn triển khai).
const env = process.env;
export const dbDriver = (env.DB_DRIVER || 'sqlite').toLowerCase();
if (!['sqlite', 'mssql'].includes(dbDriver)) throw new Error('DB_DRIVER chỉ nhận sqlite hoặc mssql');
const mssql = dbDriver === 'mssql' ? {
  driver: 'mssql', server: env.MSSQL_SERVER, port: Number(env.MSSQL_PORT || 1433), database: env.MSSQL_DATABASE || 'brg',
  user: env.MSSQL_USER, password: env.MSSQL_PASSWORD,
  encrypt: env.MSSQL_ENCRYPT !== '0', trustServerCertificate: env.MSSQL_TRUST_CERT === '1',
  requestTimeoutSec: Number(env.MSSQL_REQUEST_TIMEOUT || 30), connectTimeoutSec: Number(env.MSSQL_CONNECT_TIMEOUT || 15)
} : null;
if (mssql && (!mssql.server || !mssql.user || !mssql.password)) throw new Error('DB_DRIVER=mssql cần MSSQL_SERVER, MSSQL_USER và MSSQL_PASSWORD');

export const config = {
  root,
  isProd,
  devMode,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || (isProd ? '127.0.0.1' : '0.0.0.0'), // production mặc định chỉ nghe nội bộ (đứng sau Nginx); muốn nghe ngoài thì đặt HOST rõ ràng
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'brg.db'),
  dbDriver,
  db: mssql || (process.env.DB_FILE || path.join(root, 'data', 'brg.db')), // đối số cho openDb
  publicDir: path.join(root, 'public'),
  // Khóa ký token đăng nhập và QR biên nhận.
  secret: process.env.APP_SECRET || DEV_SECRET,
  tzOffsetHours: 7, // Việt Nam, không có giờ mùa hè
  receiptTtlMinutes: Number(process.env.RECEIPT_TTL_MIN || 180),
  // Số mặt hàng khác nhau tối đa trong một giỏ (giới hạn hợp lý cho một lần đi chợ; mã QR luôn ngắn nên không phụ thuộc số này).
  maxCartItems: Number(process.env.MAX_CART_ITEMS || 200),
  sessionResumeHours: 6,
  authTokenHours: 12,
  maxPinFails: 5,
  lockMinutes: 15,
  // Địa chỉ công khai của hệ thống (dùng làm link trong email), ví dụ https://scan.hcrc.vn
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, '')
};
