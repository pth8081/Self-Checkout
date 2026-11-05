// Khách mất mạng, tắt trình duyệt hoặc bị xoá bộ nhớ trang khi đang chờ thu ngân.
const {chromium}=require('playwright');
const BASE=process.env.BASE||'http://localhost:3400';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,url,body,headers={}){const r=await fetch(BASE+url,{method,headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};}
(async()=>{
 const fails=[];const ok=(n,c)=>{console.log(c?'OK  ':'FAIL',n);if(!c)fails.push(n)};
 const adm=(await api('POST','/api/a/login',{account:'QT0001',password:'Admin@123'})).body.token;
 const prods=(await api('GET','/api/a/dev/pos-products?storeId=Q7',null,{authorization:'Bearer '+adm})).body.products;
 const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const ctx=await b.newContext({viewport:{width:390,height:800},permissions:['camera']});let p=await ctx.newPage();
 await p.goto(BASE+'/c/?s=Q7');await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await sleep(800);
 await p.click('text=Bắt đầu mua sắm');await p.click('text=Bỏ qua');await p.waitForURL(/#\/scan/);
 // nhập tay một món rồi khoá giỏ bằng tiền mặt
 const bc=prods.find(x=>x.name.startsWith('Sữa')).barcode;
 const dev=await p.evaluate(()=>JSON.parse(localStorage.getItem('brg.device')));
 const h={'x-device-id':dev};
 const sid=(await api('POST','/api/c/sessions',{storeId:'Q7'},h)).body.session.id;
 await api('POST',`/api/c/sessions/${sid}/ops`,{ops:[{id:'o1',type:'scan',barcode:bc}]},h);
 await p.reload();await sleep(800);await p.evaluate(()=>{location.hash='#/pay'});await sleep(500);
 await p.click('.bar-bottom .btn.primary');await p.waitForURL(/#\/wait/);
 const code=await p.innerText('.code');ok('có mã giỏ',/^GH-/.test(code));
 // 1. mất mạng rồi tải lại
 await ctx.setOffline(true);await p.reload().catch(()=>{});await sleep(1200);
 ok('mất mạng + tải lại: vẫn thấy mã giỏ',(await p.innerText('body')).includes(code));
 await ctx.setOffline(false);
 // 2. tắt hẳn tab, mở lại bằng link cửa hàng
 await p.close();p=await ctx.newPage();await p.goto(BASE+'/c/?s=Q7');await sleep(1500);
 ok('đóng tab, mở lại: về màn chờ với cùng mã',(await p.innerText('body')).includes(code));
 // 3. xoá bộ nhớ trang nhưng còn cookie
 await p.evaluate(()=>localStorage.clear());await p.close();p=await ctx.newPage();await p.goto(BASE+'/c/?s=Q7');await sleep(1500);
 ok('xoá localStorage: giỏ vẫn khôi phục theo cookie',(await p.innerText('body')).includes(code)||(await p.innerText('body')).includes('giỏ hàng đang dở'));
 await b.close();
 console.log(fails.length?'FAILS: '+JSON.stringify(fails):'FAILS: []');process.exit(fails.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
