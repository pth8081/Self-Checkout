import crypto from 'node:crypto';
import { config } from './config.js';

export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
export const randomCode = (n = 6) => {
  let s = '';
  while (s.length < n) s += crypto.randomInt(0, 10);
  return s;
};

/** Ngày theo giờ Việt Nam (YYYY-MM-DD) của một mốc thời gian ISO. */
export function localDate(iso = nowIso()) {
  const d = new Date(new Date(iso).getTime() + config.tzOffsetHours * 3600_000);
  return d.toISOString().slice(0, 10);
}

/** Biểu thức SQLite đổi cột thời gian UTC sang ngày giờ Việt Nam. */
export const sqlLocalDate = (col) => `date(${col}, '+${config.tzOffsetHours} hours')`;

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const bad = (code, message, extra) => new HttpError(400, code, message, extra);
export const notFound = (code = 'NOT_FOUND', message = 'Không tìm thấy') => new HttpError(404, code, message);
export const forbidden = (code = 'FORBIDDEN', message = 'Không có quyền thực hiện') => new HttpError(403, code, message);
export const conflict = (code, message, extra) => new HttpError(409, code, message, extra);
export const unauthorized = (code = 'UNAUTHORIZED', message = 'Cần đăng nhập') => new HttpError(401, code, message);

export const money = (n) => Math.round(Number(n) || 0);
export const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
