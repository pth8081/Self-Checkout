// Khách lấy thêm hàng ở quầy: điện thoại thấy thông báo thu ngân đã cập nhật đơn, và khi thanh toán xong thấy đơn thực mua.
const {chromium}=require('playwright');
const BASE=process.env.BASE||'http://localhost:3400';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,url,body,headers={}){const r=await fetch(BASE+url,{method,headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};}
(async()=>{
 const fails=[];const ok=(n,c)=>{console.log(c?'OK  ':'FAIL',n);if(!c)fails.push(n)};
 const adm=(await api('POST','/api/a/login',{account:'QT0001',password:'Admin@123'})).body.token;const AH={authorization:'Bearer '+adm};
 await api('PUT','/api/a/stores/Q7',{posCode:'SP-0107'},AH);
 const key=(await api('POST','/api/a/pos/keys',{name:'POS'},AH)).body.key;const PH={authorization:'Bearer '+key};
 const prods=(await api('GET','/api/a/dev/pos-products?storeId=Q7',null,AH)).body.products;
 const br=await chromium.launch();const ctx=await br.newContext({viewport:{width:390,height:800}});const p=await ctx.newPage();
 await p.goto(BASE+'/c/?s=Q7');await sleep(900);const dev=JSON.parse(await p.evaluate(()=>localStorage.getItem('brg.device')));const h={'x-device-id':dev};
 const sid=(await api('POST','/api/c/sessions',{storeId:'Q7'},h)).body.session.id;
 await api('POST',`/api/c/sessions/${sid}/ops`,{ops:[{id:'1',type:'scan',barcode:prods[0].barcode}]},h);
 await p.reload();await sleep(900);await p.evaluate(()=>location.hash='#/cart');await sleep(600);
 await p.click('.bar-bottom .btn.primary');await p.waitForURL(/#\/basket/);await sleep(1500);
 const code=await p.innerText('.code');
 const l0={barcode:prods[0].barcode,qty:1,lineTotal:prods[0].price};const l1={barcode:prods[1].barcode,qty:2,lineTotal:prods[1].price*2};
 const up=await api('POST',`/api/pos/v1/baskets/${code}/update`,{pointCode:'SP-0107',posOrderRef:'POS-MORE-1',lines:[l0,l1]},PH);
 ok('POS báo đơn đang tính',up.status===200&&up.body.differsFromPhone===true);
 await p.waitForSelector('text=Thu ngân đã cập nhật đơn tại quầy',{timeout:15000}).catch(()=>{});
 ok('điện thoại báo thu ngân đã cập nhật đơn',await p.isVisible('text=Thu ngân đã cập nhật đơn tại quầy'));
 ok('hiện mặt hàng được thêm',(await p.innerText('body')).includes('Thêm 2'));
 await api('POST',`/api/pos/v1/baskets/${code}/paid`,{pointCode:'SP-0107',posOrderRef:'POS-MORE-1',amount:l0.lineTotal+l1.lineTotal,method:'cash',lines:[l0,l1]},PH);
 await p.waitForSelector('text=Đơn ở quầy khác giỏ bạn đã quét',{timeout:20000}).catch(()=>{});
 ok('sau thanh toán hiện đơn ở quầy khác giỏ đã quét',await p.isVisible('text=Đơn ở quầy khác giỏ bạn đã quét'));
 ok('hiện số mặt hàng thực mua',(await p.innerText('body')).includes('Thực mua · 3 mặt hàng'));
 await br.close();
 console.log(fails.length?'FAILS: '+JSON.stringify(fails):'FAILS: []');process.exit(fails.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
