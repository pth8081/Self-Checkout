// Trang Giỏ hàng: thời gian & giới hạn: cấu hình chung và ghi đè riêng từng siêu thị.
const {chromium}=require('playwright');
const BASE=process.env.BASE||'http://localhost:3400';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,url,body,headers={}){const r=await fetch(BASE+url,{method,headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};}
const fails=[];const ok=(n,c)=>{console.log((c?'OK   ':'FAIL ')+n);if(!c)fails.push(n);};
(async()=>{
 const adm=(await api('POST','/api/a/login',{account:'QT0001',password:'Admin@123'})).body.token;const AH={authorization:'Bearer '+adm};
 const stores=(await api('GET','/api/a/stores',null,AH)).body.stores;const s0=stores[0];
 const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1280,height:1100}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto(BASE+'/a/');await p.waitForSelector('form');await p.fill('[aria-label="Tài khoản hoặc email"]','QT0001');await p.fill('[aria-label="Mật khẩu"]','Admin@123');await p.click('button[type=submit]');await sleep(1500);
 await p.evaluate(()=>{location.hash='#/cart-limits'});await sleep(1500);
 ok('trang hiện cấu hình chung',await p.isVisible('text=Cấu hình chung cho toàn bộ siêu thị'));
 ok('hiện đủ 6 mục',(await p.locator('#limits-global .field').count())===6);
 await p.fill('#lim-lockedMinutes','45');await p.fill('#lim-maxQty','50');await p.click('button:has-text("Lưu cấu hình chung")');await sleep(1200);
 let g=(await api('GET','/api/a/cart-limits',null,AH)).body.global;
 ok('lưu cấu hình chung: 45 phút, 50 cái',g.lockedMinutes===45&&g.maxQty===50);
 await p.fill('#lim-lockedMinutes','1');await p.click('button:has-text("Lưu cấu hình chung")');await sleep(1000);
 g=(await api('GET','/api/a/cart-limits',null,AH)).body.global;
 ok('giá trị ngoài khoảng bị từ chối, giữ giá trị cũ',g.lockedMinutes===45);
 // ghi đè riêng một siêu thị
 await p.fill('[aria-label="Tìm siêu thị"]',s0.id);await sleep(300);
 await p.click('#limits-stores button:has-text("Sửa")');await sleep(500);
 ok('mở trình sửa riêng',await p.isVisible('#limits-store'));
 await p.click(`[aria-label="Dùng giá trị chung: Hạn chờ thanh toán tại quầy"]`);await sleep(200);
 await p.fill(`[aria-label="Hạn chờ thanh toán tại quầy của ${s0.name}"]`,'15');
 await p.click('button:has-text("Lưu cho siêu thị này")');await sleep(1200);
 const c=(await api('GET','/api/a/cart-limits',null,AH)).body;
 ok('ghi đè riêng: siêu thị này 15 phút, giá trị chung vẫn 45',c.stores[s0.id]?.lockedMinutes===15&&c.global.lockedMinutes===45);
 ok('bảng hiện ô giá trị riêng',await p.isVisible('#limits-stores >> text=15 phút'));
 // quản trị chi nhánh chỉ xem
 const q7=(await api('POST','/api/a/login',{account:'QT0007',password:'Admin@123'})).body.token;
 ok('quản trị chi nhánh không sửa được',(await api('PUT','/api/a/cart-limits',{values:{maxQty:5}},{authorization:'Bearer '+q7})).status===403);
 ok('không lỗi JS',errs.length===0);if(errs.length)console.log(errs);
 await b.close();
 console.log(fails.length?'FAILS: '+JSON.stringify(fails):'FAILS: []');process.exit(fails.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
