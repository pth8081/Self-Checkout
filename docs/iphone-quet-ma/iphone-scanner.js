/**
 * Quét mã vạch / QR bằng camera trên Safari iPhone (iOS) — không cần thư viện giao diện, chỉ cần zxing.min.js.
 * Rút ra từ ứng dụng BRG Scan & Checkout (public/shared/lib.js, hàm Scanner).
 *
 * Cách dùng:
 *   <script src="zxing.min.js"></script>          // @zxing/library 0.21.3 (UMD, tạo biến toàn cục ZXing)
 *   <script src="iphone-scanner.js"></script>
 *   <video id="cam" playsinline muted autoplay></video>
 *   const s = new PhoneScanner(document.getElementById('cam'), { kind: 'barcode', onScan: (text) => console.log(text) });
 *   button.onclick = () => s.start();             // PHẢI gọi trong sự kiện chạm của người dùng trên iOS
 *   s.stop();
 *
 * Điều kiện bắt buộc trên iPhone:
 *   1. Trang chạy bằng HTTPS (hoặc localhost). HTTP thường thì Safari không cấp camera.
 *   2. Thẻ <video> có thuộc tính playsinline (và muted). Thiếu playsinline, iOS đẩy video ra toàn màn hình.
 *   3. Chỉ gọi getUserMedia sau thao tác chạm của người dùng (nên có nút "Bật camera").
 *   4. Trong PWA/WKWebView phải cấp quyền camera (WKWebView: NSCameraUsageDescription trong Info.plist).
 */
class PhoneScanner {
  /**
   * @param {HTMLVideoElement} video
   * @param {{kind?: 'barcode'|'qr', onScan: (text:string)=>void, onState?: (state:string, err?:any)=>void,
   *          intervalMs?: number, maxWidth?: number, dedupeMs?: number}} opts
   */
  constructor(video, opts) {
    this.video = video;
    this.kind = opts.kind || 'barcode';
    this.onScan = opts.onScan;
    this.onState = opts.onState || (() => {});
    this.intervalMs = opts.intervalMs || 120; // khoảng cách giữa hai lần giải mã
    this.maxWidth = opts.maxWidth || 960;     // thu nhỏ khung hình trước khi giải mã cho nhanh
    this.dedupeMs = opts.dedupeMs || 2000;    // cùng một mã trong khoảng này chỉ báo một lần
    this.stream = null; this.timer = 0; this.stopped = true; this.last = { text: '', at: 0 };
  }

  async start() {
    this.stopped = false;
    if (!window.isSecureContext && location.hostname !== 'localhost') return this.onState('insecure');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return this.onState('nocamera');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, // camera sau, 720p
      });
    } catch (e) {
      const n = e && e.name;
      return this.onState(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'nocamera' : 'error', e);
    }
    if (this.stopped) { this._release(); return; }
    const v = this.video;
    v.srcObject = this.stream;
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.muted = true;
    try { await v.play(); } catch (e) { /* iOS chặn autoplay: sẽ phát khi người dùng chạm */ }
    this.onState('running');

    const Z = window.ZXing; // @zxing/library
    const names = this.kind === 'qr' ? ['QR_CODE'] : ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'ITF'];
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, names.map((f) => Z.BarcodeFormat[f])); // chỉ bật định dạng cần: nhanh hơn, ít đọc nhầm
    hints.set(Z.DecodeHintType.TRY_HARDER, true);                                       // đọc kỹ hơn (chậm hơn một chút)
    const reader = new Z.MultiFormatReader(); reader.setHints(hints);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const loop = () => {
      if (this.stopped) return;
      if (v.readyState >= 2 && v.videoWidth) {
        const w = Math.min(v.videoWidth, this.maxWidth), h = Math.round(w * v.videoHeight / v.videoWidth);
        canvas.width = w; canvas.height = h;
        ctx.drawImage(v, 0, 0, w, h);                                   // chụp khung hình hiện tại
        try {
          const src = new Z.HTMLCanvasElementLuminanceSource(canvas);   // ảnh xám
          const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(src));   // nhị phân hóa thích nghi (chịu ánh sáng không đều)
          this._emit(reader.decode(bmp).getText());
        } catch (e) { /* NotFoundException: khung này chưa có mã, bỏ qua */ }
      }
      this.timer = setTimeout(() => requestAnimationFrame(loop), this.intervalMs);
    };
    loop();
    document.addEventListener('visibilitychange', this._onVis = () => { if (document.hidden) this.stop(); });
  }

  _emit(text) {
    const now = Date.now();
    if (!text || (text === this.last.text && now - this.last.at < this.dedupeMs)) return;
    this.last = { text, at: now };
    if (navigator.vibrate) navigator.vibrate(40); // iOS Safari không hỗ trợ rung, bỏ qua im lặng
    this.onScan(text);
  }

  _release() { if (this.stream) this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }

  stop() {
    this.stopped = true; clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this._onVis);
    this._release();
    this.video.srcObject = null;
  }
}
if (typeof window !== 'undefined') window.PhoneScanner = PhoneScanner;
