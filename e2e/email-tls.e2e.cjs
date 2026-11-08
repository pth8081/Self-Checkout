// Quản trị cấu hình email cho máy chủ SMTP dùng SSL/TLS cổng riêng với chứng chỉ tự ký (không có CA công cộng).
const {chromium}=require('playwright');const {execFileSync}=require('child_process');const fs=require('fs');const os=require('os');const path=require('path');const tls=require('tls');
const BASE=process.env.BASE||'http://localhost:3400';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const fails=[];const ok=(n,c)=>{console.log(c?'OK  ':'FAIL',n);if(!c)fails.push(n)};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brg-e2e-cert-'));
 try{execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',dir+'/k.pem','-out',dir+'/c.pem','-days','2','-subj','/CN=mail.internal','-addext','subjectAltName=DNS:mail.internal'],{stdio:'ignore'});}catch{console.log('Bỏ qua: không có openssl');process.exit(0);}
 const got=[];
 const server=tls.createServer({key:fs.readFileSync(dir+'/k.pem'),cert:fs.readFileSync(dir+'/c.pem')},sock=>{let data=false,buf='';sock.write('220 mail.internal\r\n');
  sock.on('data',d=>{buf+=d.toString('utf8');if(data){if(buf.includes('\r\n.\r\n')){got.push(buf);buf='';data=false;sock.write('250 OK\r\n');}return;}
   let i;while((i=buf.indexOf('\r\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+2);if(/^EHLO|^HELO/i.test(l))sock.write('250-mail.internal\r\n250 8BITMIME\r\n');else if(/^DATA/i.test(l)){sock.write('354 go\r\n');data=true;break;}else if(/^QUIT/i.test(l)){sock.write('221 bye\r\n');sock.end();}else sock.write('250 OK\r\n');}});sock.on('error',()=>{});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 const br=await chromium.launch();const ctx=await br.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});const a=await ctx.newPage();
 await a.goto(BASE+'/a/');await a.fill('[aria-label="Tài khoản hoặc email"]','QT0001');await a.fill('[aria-label="Mật khẩu"]','Admin@123');await a.click('button[type=submit]');await a.waitForSelector('main');
 await a.evaluate(()=>location.hash='#/integrations');await sleep(1200);
 await a.fill('[aria-label="Máy chủ SMTP"]','127.0.0.1');await a.fill('[aria-label="Cổng SMTP"]',String(port));
 await a.selectOption('[aria-label="Kiểu bảo mật"]','ssl');await a.fill('[aria-label="Địa chỉ người gửi"]','no-reply@congty.vn');
 ok('kiểu bảo mật không tự đổi cổng',(await a.inputValue('[aria-label="Cổng SMTP"]'))===String(port));
 await a.click('text=Lưu cấu hình');await sleep(800);
 await a.fill('#mail-test','it@congty.vn');await a.click('button:has-text("Gửi thử")');await sleep(2500);
 ok('chứng chỉ tự ký bị từ chối kèm hướng dẫn',(await a.innerText('body')).includes('chứng chỉ tự ký')||(await a.innerText('body')).includes('CA nội bộ'));
 await a.selectOption('[aria-label="Kiểm tra chứng chỉ"]','ca');await sleep(300);
 await a.setInputFiles('#ca-file',dir+'/c.pem');await sleep(500);
 await a.fill('[aria-label="Tên máy chủ trong chứng chỉ"]','mail.internal');
 await a.click('text=Lưu cấu hình');await sleep(1200);
 ok('hiện thông tin chứng chỉ đã nạp',(await a.innerText('body')).includes('mail.internal')&&(await a.innerText('body')).includes('SHA-256'));
 await a.fill('#mail-test','it@congty.vn');await a.click('button:has-text("Gửi thử")');await sleep(2500);
 ok('nạp chứng chỉ rồi gửi thử được',got.length===1);
 await a.locator('.card:has-text("Email gửi cho khách")').first().screenshot({path:'/tmp/brg-shots/email-tls.png'}).catch(()=>{});
 await br.close();server.close();fs.rmSync(dir,{recursive:true,force:true});
 console.log(fails.length?'FAILS: '+JSON.stringify(fails):'FAILS: []');process.exit(fails.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
