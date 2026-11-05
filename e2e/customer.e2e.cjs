// Kiểm thử đầu cuối bằng Playwright. Chạy qua e2e/run.sh (tự dựng máy chủ và dữ liệu mẫu).
const {chromium}=require('playwright');require('fs').mkdirSync('/tmp/brg-shots',{recursive:true});
const BASE=process.env.BASE||'http://localhost:3400';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,url,body,headers={}){const r=await fetch(BASE+url,{method,headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};}
(async()=>{
 const adm=(await api('POST','/api/a/login',{account:'QT0001',password:'Admin@123'})).body.token;const AH={authorization:'Bearer '+adm};
 const prods=(await api('GET','/api/a/dev/pos-products?storeId=Q7',null,AH)).body.products;
 const P=n=>prods.find(x=>x.name.startsWith(n));
 const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const ctx=await b.newContext({viewport:{width:390,height:800},permissions:['camera']});const p=await ctx.newPage();const errs=[];
 p.on('pageerror',e=>errs.push('PAGEERR '+e.message));p.on('console',m=>{if(m.type()==='error')errs.push('console '+m.text())});
 const shot=n=>p.screenshot({path:`/tmp/brg-shots/c-${n}.png`});
 await p.goto(BASE+'/c/?s=Q7');await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await sleep(800);console.log('controlled by SW',await p.evaluate(()=>!!navigator.serviceWorker.controller));await p.click('text=Bắt đầu mua sắm');await p.click('text=Bỏ qua');await p.waitForURL(/#\/scan/);
 const scan=bc=>p.evaluate(async(bc)=>{const m=await import('/c/store.js');return m.scan(bc)},bc);
 // 1. quét online
 let r=await scan(P('Trứng').barcode);console.log('online scan ok',r.ok);
 // 2. mất mạng: quét tiếp, giỏ lưu trên máy
 await ctx.setOffline(true);await sleep(300);
 r=await scan(P('Mì ăn liền tôm').barcode);console.log('offline scan pending',r.pending===true);
 await p.goto(BASE+'/c/#/cart').catch(()=>{});await p.evaluate(()=>{location.hash='#/cart'});await sleep(500);
 console.log('offline banner',await p.isVisible('text=Mất kết nối'),'pending row',await p.isVisible('text=Chờ đồng bộ để lấy tên và giá'),'pay disabled',await p.isDisabled('.bar-bottom .btn.primary'));
 await shot('15-offline-cart');
 // tải lại trang khi vẫn mất mạng: giỏ còn
 await p.reload().catch(()=>{});await sleep(1200);
 console.log('after reload offline body has Trứng:',(await p.innerText('body')).includes('Trứng'));
 // 3. có mạng lại: tự đồng bộ
 await ctx.setOffline(false);await p.evaluate(()=>dispatchEvent(new Event('online')));await sleep(1500);
 console.log('synced, mì in cart:',(await p.innerText('body')).includes('Mì ăn liền'),'still pending:',await p.isVisible('text=Chờ đồng bộ để lấy tên và giá'));
 // 4. giá đổi trước khi khoá giỏ
 await api('POST','/api/a/dev/pos-product',{storeId:'Q7',sku:'TRU01',price:41000},AH);
 await p.evaluate(()=>{location.hash='#/pay'});await sleep(600);
 await p.click('.bar-bottom .btn.primary');await p.waitForSelector('text=Có thay đổi trong giỏ hàng');await shot('16-changes');
 await p.click('text=Đồng ý và tiếp tục');await p.waitForURL(/#\/wait/);console.log('price change accepted -> wait');
 await shot('17-wait-cash');
 // 5. thu tiền + kiểm tra ngẫu nhiên (ép chọn)
 const code=await p.innerText('.code');const st=(await api('POST','/api/s/login',{code:'NV0142',pin:'1111'})).body.token;const H={authorization:'Bearer '+st};
 await api('POST','/api/s/shifts/start',{kind:'sang'},H);
 const tx=(await api('GET','/api/s/carts/lookup?code='+code,null,H)).body.transaction;
 await api('POST',`/api/s/carts/${tx.id}/collect`,{method:'cash',cashReceived:500000},H);
 await p.waitForSelector('text=Đưa mã này cho nhân viên ở cổng');
 await api('PUT','/api/a/stores/Q7/config',{randomCheckRate:1},AH);
 // 6. tắt mạng sau khi thanh toán: QR vẫn hiện
 await ctx.setOffline(true);await sleep(300);await p.evaluate(()=>dispatchEvent(new Event('offline')));await sleep(500);
 console.log('receipt visible offline',await p.isVisible('.qrbox'),'banner',await p.isVisible('text=Mất kết nối'));await shot('18-receipt-offline');
 await ctx.setOffline(false);await p.evaluate(()=>dispatchEvent(new Event('online')));
 // 7. cổng quét -> kiểm tra ngẫu nhiên (đặt tỷ lệ 1 sau khi khoá giỏ nên cờ chưa bật; ép trực tiếp bằng DB không có, dùng API checks)
 const tok=await p.evaluate(()=>JSON.parse(localStorage.getItem('brg.c.v1')).session.transaction.receipt.token);
 const gate=(await api('POST','/api/s/login',{code:'NV0157',pin:'2222'})).body.token;const GH={authorization:'Bearer '+gate};
 let g=await api('POST','/api/s/gate/scan',{raw:tok},GH);console.log('gate outcome',g.body.outcome);
 await p.waitForSelector('text=Cảm ơn bạn đã mua sắm',{timeout:8000});console.log('customer sees done');
 // 8. lịch sử + liên kết email
 await p.click('text=Đóng');await sleep(500);await p.evaluate(()=>{location.hash='#/history'});await sleep(800);await shot('19-history');
 await p.click('text=Xem trên máy khác');await p.fill('input[type=email]','khach@example.com');await p.click('.sheet .btn.primary');await p.waitForSelector('text=Môi trường thử',{timeout:5000});await shot('20-link');
 const dev=await p.innerText('.banner.info b');await p.fill('input.big',dev);await p.click('.sheet .btn.primary');await sleep(800);
 console.log('linked banner',await p.isVisible('text=khach@example.com'));
 await p.click('.item >> nth=0');await p.waitForSelector('text=Đã trả');await shot('21-order');
 console.log('errors',JSON.stringify(errs));await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
