// Cấu hình chạy. Mọi giá trị nhạy cảm lấy từ biến môi trường.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.APP_SECRET) {
  throw new Error('APP_SECRET là bắt buộc khi chạy production');
}

export const config = {
  root,
  isProd,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'brg.db'),
  publicDir: path.join(root, 'public'),
  // Khoá ký token đăng nhập và QR biên nhận.
  secret: process.env.APP_SECRET || 'dev-only-secret-change-me',
  tzOffsetHours: 7, // Việt Nam, không có giờ mùa hè
  receiptTtlMinutes: Number(process.env.RECEIPT_TTL_MIN || 180),
  sessionResumeHours: 6,
  authTokenHours: 12,
  maxPinFails: 5,
  lockMinutes: 15,
  // Địa chỉ công khai của hệ thống (dùng làm link trong email), ví dụ https://scan.hcrc.vn
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  currency: 'VND'
};
