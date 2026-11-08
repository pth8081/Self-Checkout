// Giỏ QR cho POS: quét, bấm thanh toán, QR chứa mặt hàng; mất mạng, tắt tab, xoá bộ nhớ trang đều không mất mã.
const {chromium}=require('playwright');
const BASE=process.env.BASE||'http://localhost:3400';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,url,body,headers={}){const r=await fetch(BASE+url,{method,headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};}
// Máy chủ SMTP giả: nhận thư và lưu lại để kiểm tra.
const net=require('net');const mails=[];
const smtp=net.createServer(sock=>{let data=false,buf='';sock.write('220 sink ESMTP\r\n');
 sock.on('data',d=>{buf+=d.toString('utf8');
  if(data){ if(buf.includes('\r\n.\r\n')){ mails.push(buf);buf='';data=false;sock.write('250 OK queued\r\n'); } return; }
  let i;while((i=buf.indexOf('\r\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+2);
   if(/^EHLO|^HELO/i.test(line))sock.write('250-sink\r\n250 8BITMIME\r\n');
   else if(/^MAIL|^RCPT|^RSET|^NOOP/i.test(line))sock.write('250 OK\r\n');
   else if(/^DATA/i.test(line)){sock.write('354 go\r\n');data=true;if(buf.includes('\r\n.\r\n')){mails.push(buf);buf='';data=false;sock.write('250 OK queued\r\n');}break;}
   else if(/^QUIT/i.test(line)){sock.write('221 bye\r\n');sock.end();}else sock.write('250 OK\r\n');}});});
(async()=>{
 await new Promise(r=>smtp.listen(2525,'127.0.0.1',r));
 const fails=[];const ok=(n,c)=>{console.log(c?'OK  ':'FAIL',n);if(!c)fails.push(n)};
 const adm=(await api('POST','/api/a/login',{account:'QT0001',password:'Admin@123'})).body.token;const AH={authorization:'Bearer '+adm};
 await api('PUT','/api/a/stores/Q7',{posCode:'SP-0107'},AH);
 const cfgMail=await api('PUT','/api/a/integrations/email',{host:'127.0.0.1',port:2525,secure:'none',from:'no-reply@congty.vn',fromName:'BRG Scan & Checkout'},AH);ok('cấu hình email',cfgMail.status===200);
 const portal=await api('PUT','/api/a/integrations/invoice-portal',{url:'https://hoadon.nhacungcap.vn/khai-bao?ma={code}&so={invoiceNo}'},AH);ok('cấu hình link khai báo hoá đơn',portal.status===200);
 const tmail=await api('POST','/api/a/integrations/email/test',{to:'it@congty.vn'},AH);ok('gửi email thử qua SMTP giả',tmail.status===200&&mails.length===1);
 const prods=(await api('GET','/api/a/dev/pos-products?storeId=Q7',null,AH)).body.products;
 const P=n=>prods.find(x=>x.name.startsWith(n));
 const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const ctx=await b.newContext({viewport:{width:390,height:800},permissions:['camera']});let p=await ctx.newPage();const errs=[];
 p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
 await p.goto(BASE+'/c/?s=Q7');await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await sleep(800);
 await p.click('text=Bắt đầu mua sắm');await p.click('text=Bỏ qua');await p.waitForURL(/#\/scan/);
 // quét 2 sữa + 1 mì qua API của chính phiên này (camera giả không đọc được mã cụ thể)
 const dev=await p.evaluate(()=>JSON.parse(localStorage.getItem('brg.device')));const h={'x-device-id':dev};
 const sid=(await api('POST','/api/c/sessions',{storeId:'Q7'},h)).body.session.id;
 await api('POST',`/api/c/sessions/${sid}/ops`,{ops:[{id:'1',type:'scan',barcode:P('Sữa').barcode},{id:'2',type:'scan',barcode:P('Sữa').barcode},{id:'3',type:'scan',barcode:P('Mì').barcode}]},h);
 await p.reload();await sleep(900);await p.evaluate(()=>{location.hash='#/cart'});await sleep(500);
 const btn=await p.innerText('.bar-bottom .btn.primary');ok('nút Thanh toán có số tiền',/Thanh toán/.test(btn));
 await p.click('.bar-bottom .btn.primary');await p.waitForURL(/#\/basket/);await sleep(800);
 ok('hiện mã giỏ',/^Q7-/.test(await p.innerText('.code')));
 const qrText=async pg=>pg.evaluate(()=>JSON.parse(localStorage.getItem('brg.c.v1')).basket.qr);
 const qr=await qrText(p);ok('QR có mã vạch và số lượng',qr.startsWith('BRG1|SP-0107|Q7-')&&qr.includes(P('Sữa').barcode+'*2')&&qr.includes(P('Mì').barcode+'*1'));
 ok('không có màn chọn cách thanh toán',!(await p.innerText('body')).includes('Tiền mặt tại quầy'));
 // 1. mất mạng + tải lại
 await ctx.setOffline(true);await p.reload().catch(()=>{});await sleep(1200);
 ok('mất mạng + tải lại: vẫn thấy QR',await p.isVisible('.qrbox')&&(await qrText(p))===qr);
 await ctx.setOffline(false);
 // 2. đóng tab, mở lại
 await p.close();p=await ctx.newPage();await p.goto(BASE+'/c/?s=Q7');await sleep(1500);
 ok('đóng tab, mở lại: về màn QR',await p.isVisible('.qrbox'));
 // 3. xoá bộ nhớ trang (cookie còn) -> máy chủ trả lại QR
 await p.evaluate(()=>localStorage.clear());await p.close();p=await ctx.newPage();await p.goto(BASE+'/c/?s=Q7');await sleep(1800);
 ok('xoá localStorage: QR khôi phục từ máy chủ',await p.isVisible('.qrbox'));
 ok('QR khôi phục giống bản đầu',(await qrText(p))===qr);
 // 4. sửa giỏ rồi thanh toán lại: mã giỏ mới
 await p.click('text=Sửa giỏ hàng');await p.waitForURL(/#\/cart/);await sleep(500);
 await p.click('.bar-bottom .btn.primary');await p.waitForURL(/#\/basket/);await sleep(800);
 ok('mã giỏ mới sau khi sửa',(await p.innerText('.code'))!==qr.split('|')[2]);
 // 4b. khách để lại email nhận bill
 ok('có ô email nhận bill',await p.isVisible('#bill-email'));
 await p.fill('#bill-email','khach@example.com');await p.click('text=Lưu');await sleep(1500);
 // 5. POS báo thanh toán kèm bill thật -> khách thấy hoàn thành, xem bill, tải PDF
 const key=(await api('POST','/api/a/pos/keys',{name:'POS e2e'},AH)).body.key;const code=await p.innerText('.code');
 await sleep(1500); // chờ giỏ đồng bộ lên máy chủ
 const total=await p.evaluate(()=>JSON.parse(localStorage.getItem('brg.c.v1')).basket.total);
 const paid=await api('POST',`/api/pos/v1/baskets/${code}/paid`,{posOrderRef:'POS-E2E-1',pointCode:'SP-0107',amount:total,method:'cash',invoiceNo:'C26-9',cashier:'Lan',lines:[{name:'Sữa tươi 1L',qty:2,unitPrice:Math.round(total/2),discount:0,lineTotal:total}]},{authorization:'Bearer '+key});
 ok('POS báo thanh toán thành công',paid.status===200);
 await p.waitForSelector('text=Đã hoàn thành thanh toán',{timeout:15000}).catch(()=>{});
 ok('khách thấy "Đã hoàn thành thanh toán"',await p.isVisible('text=Đã hoàn thành thanh toán'));
 const lk=await p.getAttribute('a:has-text("Khai báo hoá đơn điện tử")','href');
 ok('nút khai báo hoá đơn mở đúng link đã cấu hình',!!lk&&lk.startsWith('https://hoadon.nhacungcap.vn/khai-bao?ma=Q7-')&&lk.includes('so=C26-9'));
 for(let i=0;i<20&&mails.length<2;i++)await sleep(500);
 ok('bill được gửi về email khách (có PDF)',mails.length>=2&&/khach@example\.com/.test(mails[1])&&/application\/pdf/.test(mails[1]));
 const rawMail=(mails[1]||'').replace(/=\r\n/g,'').replace(/=3D/g,'=');
 const linkM=/(http:\/\/localhost:3400\/c\/#\/bill-link\/B1\.[A-Za-z0-9._-]+)/.exec(rawMail);
 ok('email có link xem bill',!!linkM);
 if(linkM){const c2=await b.newContext({viewport:{width:390,height:800}});const q=await c2.newPage();await q.goto(linkM[1]);await sleep(1800);
  ok('mở link bill từ email (máy lạ, không đăng nhập)',(await q.innerText('body')).includes('Sữa tươi 1L')&&(await q.innerText('body')).includes('C26-9'));await c2.close();}
 ok('email có link khai báo hoá đơn',(mails[1]||'').replace(/=\r\n/g,'').replace(/=3D/g,'=').includes('hoadon.nhacungcap.vn/khai-bao'));
 await p.click('text=Xem bill');await p.waitForURL(/#\/bill\//);await sleep(800);
 ok('bill có nút khai báo hoá đơn',await p.isVisible('a:has-text("Khai báo hoá đơn điện tử")'));
 ok('bill hiện dòng và tổng',(await p.innerText('body')).includes('Sữa tươi 1L')&&(await p.innerText('body')).includes('Bill từ máy tính tiền'));
 const [dl]=await Promise.all([p.waitForEvent('download',{timeout:8000}).catch(()=>null),p.click('text=Tải bill PDF')]);
 ok('tải được bill PDF',!!dl&&/\.pdf$/.test(dl.suggestedFilename()));
 await p.goBack();await sleep(500);
 // 6. xong
 await p.click('.bar-bottom >> text=Xong');await sleep(900);
 ok('xong: về trang đầu',!(await p.isVisible('.qrbox')));
 ok('không lỗi JS',errs.length===0);if(errs.length)console.log(errs);
 await b.close();
 console.log(fails.length?'FAILS: '+JSON.stringify(fails):'FAILS: []');process.exit(fails.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
