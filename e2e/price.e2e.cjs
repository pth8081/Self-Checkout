// API giá của đối tác + file mã điểm: nhập file ở trang Tích hợp, cấu hình API giá, khách quét thấy giá gạch + "chưa có giá".
const {chromium}=require('playwright');const http=require('http');const fs=require('fs');
const BASE=process.env.BASE||'http://localhost:3400';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,url,body,headers={}){const r=await fetch(BASE+url,{method,headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>({}))};}
const fails=[];const ok=(n,c)=>{console.log((c?'OK   ':'FAIL ')+n);if(!c)fails.push(n);};
const MILK={maHang:'2003330491',tenHang:'Sữa tươi TH True Milk 1L',maVach:'8934696001589',giaThuong:24000,giaKhuyenMai:21500,coKhuyenMai:true};
const calls=[];
const partner=http.createServer((req,res)=>{const u=new URL(req.url,'http://x');calls.push({v:u.searchParams.get('maVach'),d:u.searchParams.get('maDiem'),k:req.headers['x-api-key']});
 if(u.searchParams.get('maVach')===MILK.maVach){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(MILK));}
 res.writeHead(404);res.end('{}');});
(async()=>{
 await new Promise(r=>partner.listen(0,'127.0.0.1',r));const purl=`http://127.0.0.1:${partner.address().port}/api/v1/reports/gia-ban/run`;
 const adm=(await api('POST','/api/a/login',{account:'QT0001',password:'Admin@123'})).body.token;const AH={authorization:'Bearer '+adm};
 const stores=(await api('GET','/api/a/stores',null,AH)).body.stores;const q7=stores.find(s=>s.id==='Q7');
 const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1280,height:1000}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto(BASE+'/a/');await p.waitForSelector('form');await p.fill('[aria-label="Tài khoản hoặc email"]','QT0001');await p.fill('[aria-label="Mật khẩu"]','Admin@123');await p.click('button[type=submit]');await sleep(1500);
 await p.evaluate(()=>{location.hash='#/integrations'});await sleep(1500);
 // 1. file mã điểm
 fs.writeFileSync('/tmp/brg-points.csv',`maDiem;maChiNhanh;tenDiem\n001;Q7;Điểm Quận 7\n002;;${stores.find(s=>s.id!=='Q7').name};\n003;XYZ;Điểm khác\n`);
 await p.setInputFiles('input[type=file]','/tmp/brg-points.csv');await sleep(1500);
 ok('xem trước file mã điểm: hiện bảng và kết quả ghép',await p.isVisible('text=Sẽ gán')&&await p.isVisible('text=Chưa ghép'));
 await p.click('button:has-text("Áp dụng")');await sleep(1500);
 ok('áp dụng: hiện số mã điểm đã nhập',await p.isVisible('text=3 mã điểm'));
 const st2=(await api('GET','/api/a/stores',null,AH)).body.stores;
 ok('chi nhánh Q7 nhận mã điểm 001 từ file',st2.find(s=>s.id==='Q7').posCode==='001');
 // 2. cấu hình API giá qua giao diện
 const put=await api('PUT','/api/a/integrations/price-api',{url:purl,key:'khoa-e2e',enabled:true,timeoutSec:2,cacheMin:5},AH);ok('lưu cấu hình API giá',put.status===200);
 await p.reload();await sleep(1500);
 ok('thẻ API giá hiện Đang dùng',await p.isVisible('text=Đang dùng'));
 // 3. khách quét: giá khuyến mại + chưa có giá
 await api('PUT','/api/a/stores/Q7',{enabled:true},AH);
 const c=await ctx.newPage();c.on('pageerror',e=>errs.push(e.message));
 await c.goto(BASE+'/c/?s=Q7');await c.evaluate(()=>navigator.serviceWorker.ready).catch(()=>{});await c.reload();await sleep(800);
 await c.click('text=Bắt đầu mua sắm');await c.click('text=Bỏ qua').catch(()=>{});await sleep(800);
 const dev=await c.evaluate(()=>JSON.parse(localStorage.getItem('brg.device')));const h={'x-device-id':dev};
 const sid=(await api('POST','/api/c/sessions',{storeId:'Q7'},h)).body.session.id;
 const r=await api('POST',`/api/c/sessions/${sid}/ops`,{ops:[{id:'1',type:'scan',barcode:MILK.maVach},{id:'2',type:'scan',barcode:'8934563138165'}]},h);
 ok('API giá được gọi đúng maVach, maDiem và khóa',calls.some(x=>x.v===MILK.maVach&&x.d==='001'&&x.k==='khoa-e2e'));
 ok('quét hàng có khuyến mại: giá 21.500',r.body.results[0].item&&r.body.results[0].item.price===21500&&r.body.results[0].item.listPrice===24000);
 ok('hàng không có giá vẫn vào giỏ',r.body.results[1].item&&r.body.results[1].item.noPrice===true);
 await c.evaluate(()=>localStorage.removeItem('brg.c.v1'));await c.goto(BASE+'/c/?s=Q7');await sleep(1500);
 if(await c.isVisible('text=Bắt đầu mua sắm')){await c.click('text=Bắt đầu mua sắm');await c.click('text=Bỏ qua').catch(()=>{});await sleep(800);}
 await c.evaluate(()=>{location.hash='#/cart'});await sleep(1000);
 ok('giỏ hiện giá gốc gạch và nhãn Khuyến mại',await c.isVisible('s:has-text("24.000")')&&await c.isVisible('text=Khuyến mại'));
 ok('giỏ hiện cảnh báo mặt hàng chưa có giá',await c.isVisible('text=chưa tra được giá')&&await c.isVisible('text=Chưa có giá'));
 ok('không lỗi JS',errs.length===0);if(errs.length)console.log(errs);
 await b.close();partner.close();
 console.log(fails.length?'FAILS: '+JSON.stringify(fails):'FAILS: []');process.exit(fails.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
