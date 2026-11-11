// Thư viện SQL Server (tedious) dùng Promise.withResolvers, chỉ có từ Node 22. Bổ sung cho Node 20.
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve, reject;
    const promise = new this((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}
