// PM2: chạy MỘT tiến trình ở chế độ fork (khuyến nghị). Xem docs/13-trien-khai.md để biết vì sao không dùng cluster.
module.exports = {
  apps: [{
    name: 'brg-self-checkout',
    script: 'server/index.js',
    exec_mode: 'fork',
    instances: 1,
    node_args: '--env-file=.env',
    env: { NODE_ENV: 'production' },
    max_memory_restart: '500M',
    kill_timeout: 10000, // đủ để máy chủ tắt gọn (nó tự thoát sau tối đa 8 giây)
    autorestart: true,
    time: true
  }]
};
