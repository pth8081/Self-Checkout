// Hủy đơn: POS hủy trước khi thu tiền (khách được báo và sửa giỏ), POS hủy sau khi thu tiền (khách thấy đơn đã hủy).
const {chromium}=require('playwright');
const BASE=process.env.BASE||'http://localhost:3400';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,url,body,headers={}){const r=await fetch(BASE+url,{method,headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};}
(async()=>{
 const fails=[];const ok=(n,c)=>{console.log(c?'OK  ':'FAIL',n);if(!c)fails.push(n)};
 const adm=(await api('POST','/api/a/login',{account:'QT0001',password:'Admin@123'})).body.token;const AH={authorization:'Bearer '+adm};
 await api('PUT','/api/a/stores/Q7',{posCode:'SP-0107'},AH);
 const key=(await api('POST','/api/a/pos/keys',{name:'POS'},AH)).body.key;const PH={authorization:'Bearer '+key};
 const prods=(await api('GET','/api/a/dev/pos-products?storeId=Q7',null,AH)).body.products;
 const br=await chromium.launch();
 async function toBasket(){const ctx=await br.newContext({viewport:{width:390,height:800}});const p=await ctx.newPage();
  await p.goto(BASE+'/c/?s=Q7');await sleep(900);const dev=JSON.parse(await p.evaluate(()=>localStorage.getItem('brg.device')));const h={'x-device-id':dev};
  const sid=(await api('POST','/api/c/sessions',{storeId:'Q7'},h)).body.session.id;
  await api('POST',`/api/c/sessions/${sid}/ops`,{ops:[{id:'1',type:'scan',barcode:prods[0].barcode}]},h);
  await p.reload();await sleep(900);await p.evaluate(()=>location.hash='#/cart');await sleep(600);
  await p.click('.bar-bottom .btn.primary');await p.waitForURL(/#\/basket/);await sleep(1500);
  return {p,code:await p.innerText('.code')};}
 // 1. POS hủy trước khi thu tiền
 let {p,code}=await toBasket();
 const c1=await api('POST',`/api/pos/v1/baskets/${code}/cancelled`,{pointCode:'SP-0107',posOrderRef:'POS-X1',reason:'Khách đổi ý'},PH);
 ok('POS hủy đơn thành công',c1.status===200&&c1.body.status==='cancelled');
 await p.waitForURL(/#\/cart/,{timeout:15000}).catch(()=>{});
 ok('điện thoại về giỏ hàng để sửa',/#\/cart/.test(p.url()));
 ok('giỏ hàng còn nguyên',(await p.innerText('body')).includes('Thanh toán'));
 // 2. POS hủy sau khi đã thu tiền
 ({p,code}=await toBasket());
 await api('POST',`/api/pos/v1/baskets/${code}/paid`,{pointCode:'SP-0107',posOrderRef:'POS-X2',amount:12000,method:'cash'},PH);
 await p.waitForSelector('text=Đã hoàn thành thanh toán',{timeout:20000});
 const c2=await api('POST',`/api/pos/v1/baskets/${code}/cancelled`,{pointCode:'SP-0107',posOrderRef:'POS-X2',reason:'Hoàn tiền'},PH);
 ok('POS hủy sau thanh toán thành công',c2.status===200&&c2.body.status==='voided');
 await p.waitForSelector('text=Đơn này đã được hủy',{timeout:20000}).catch(()=>{});
 ok('khách thấy đơn đã hủy',await p.isVisible('text=Đơn này đã được hủy'));
 await br.close();
 console.log(fails.length?'FAILS: '+JSON.stringify(fails):'FAILS: []');process.exit(fails.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
