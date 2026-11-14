// Trang Chi nhánh & tính năng: lọc theo Scan & Checkout và Giỏ QR cho Dsmart POS.
const {chromium}=require('playwright');
const BASE=process.env.BASE||'http://localhost:3400';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,url,body,headers={}){const r=await fetch(BASE+url,{method,headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};}
const fails=[];const ok=(n,c)=>{console.log((c?'OK   ':'FAIL ')+n);if(!c)fails.push(n);};
(async()=>{
 const adm=(await api('POST','/api/a/login',{account:'QT0001',password:'Admin@123'})).body.token;const AH={authorization:'Bearer '+adm};
 const stores=(await api('GET','/api/a/stores',null,AH)).body.stores;
 const off=stores[1].id; await api('PUT',`/api/a/stores/${off}`,{enabled:false},AH); // một chi nhánh chưa bật Scan & Checkout
 const now=(await api('GET','/api/a/stores',null,AH)).body.stores;const total=now.length;const nOff=now.filter(s=>!s.enabled).length;const nOn=total-nOff;
 const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1280,height:1000}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto(BASE+'/a/');await p.waitForSelector('form');await p.fill('[aria-label="Tài khoản hoặc email"]','QT0001');await p.fill('[aria-label="Mật khẩu"]','Admin@123');await p.click('button[type=submit]');await sleep(1500);
 await p.evaluate(()=>{location.hash='#/stores'});await sleep(1500);
 const count=async()=>(await p.textContent('text=/\\d+\\/\\d+ chi nhánh/')).trim();
 ok('mặc định hiện tất cả chi nhánh',(await count())===`${total}/${total} chi nhánh`);
 await p.selectOption('[aria-label="Lọc theo Scan & Checkout"]','off');await sleep(300);
 ok('lọc "Chưa bật" Scan & Checkout: chỉ còn chi nhánh đã tắt',(await count())===`${nOff}/${total} chi nhánh`);
 await p.selectOption('[aria-label="Lọc theo Scan & Checkout"]','on');await sleep(300);
 ok('lọc "Đã bật" Scan & Checkout',(await count())===`${nOn}/${total} chi nhánh`);
 await p.selectOption('[aria-label="Lọc theo Scan & Checkout"]','all');
 await p.selectOption('[aria-label="Lọc theo Giỏ QR cho Dsmart POS"]','on');await sleep(300);
 const on=await count();
 await p.selectOption('[aria-label="Lọc theo Giỏ QR cho Dsmart POS"]','off');await sleep(300);
 const offc=await count();
 const n1=Number(on.split('/')[0]),n2=Number(offc.split('/')[0]);
 ok('lọc Giỏ QR Dsmart POS: bật + chưa bật = tổng số chi nhánh',n1+n2===total);
 ok('không lỗi JS',errs.length===0);if(errs.length)console.log(errs);
 await b.close();
 console.log(fails.length?'FAILS: '+JSON.stringify(fails):'FAILS: []');process.exit(fails.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
