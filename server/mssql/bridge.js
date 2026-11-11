// Cầu nối đồng bộ tới SQL Server. Thư viện SQL Server chỉ chạy bất đồng bộ, còn mã ứng dụng được viết cho CSDL đồng bộ
// (mỗi thao tác CSDL xong ngay, không xen kẽ với yêu cầu khác). Cầu nối giữ nguyên cách gọi đó: câu lệnh được gửi cho một luồng
// phụ giữ đúng một kết nối, luồng chính chờ kết quả bằng Atomics.wait. Mọi câu lệnh chạy tuần tự trên một kết nối, giống SQLite.
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export function createBridge(cfg) {
  const sab = new SharedArrayBuffer(4);
  const flag = new Int32Array(sab);
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(fileURLToPath(new URL('./worker.js', import.meta.url)), { workerData: { cfg, sab, port: port2 }, transferList: [port2] });
  worker.on('error', (e) => { console.error('Luồng SQL Server lỗi:', e); });
  worker.unref(); port1.unref();
  const waitMs = ((cfg.requestTimeoutSec || 30) + (cfg.connectTimeoutSec || 15) + 5) * 1000;
  let dead = null;
  worker.on('exit', (c) => { dead = new Error(`Luồng SQL Server đã dừng (mã ${c})`); });

  return {
    /** Chạy một lô lệnh T-SQL, trả { rows, changes, lastId }. Ném lỗi nếu SQL Server báo lỗi. */
    call(text, params = [], wantId = false) {
      if (dead) throw dead;
      Atomics.store(flag, 0, 0);
      worker.postMessage({ text, params, wantId });
      const w = Atomics.wait(flag, 0, 0, waitMs);
      if (w === 'timed-out') throw new Error('SQL Server không trả lời kịp (quá thời gian chờ)');
      const m = receiveMessageOnPort(port1);
      if (!m) throw new Error('Không nhận được kết quả từ SQL Server');
      const r = m.message;
      if (!r.ok) { const e = new Error(r.error.message); Object.assign(e, { code: r.error.code, number: r.error.number, mssql: true }); throw e; }
      return r;
    },
    close() { try { worker.terminate(); } catch { /* đã dừng */ } }
  };
}
