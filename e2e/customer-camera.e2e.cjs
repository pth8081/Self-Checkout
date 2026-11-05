// Kiểm thử đầu cuối bằng Playwright. Chạy qua e2e/run.sh (tự dựng máy chủ và dữ liệu mẫu).
const {chromium}=require('playwright');require('fs').mkdirSync('/tmp/brg-shots',{recursive:true});const fs=require('fs');
const BASE=process.env.BASE||'http://localhost:3400';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const L=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G=['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const R=['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const PAR=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
function ean(code){const d=code.split('').map(Number);let s='101';const par=PAR[d[0]];
 for(let i=1;i<=6;i++)s+=(par[i-1]==='L'?L:G)[d[i]];s+='01010';for(let i=7;i<=12;i++)s+=R[d[i]];return s+'101';}
(async()=>{
 const adm=await (await fetch(BASE+'/api/a/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:'QT0001',password:'Admin@123'})})).json();
 const prods=(await (await fetch(BASE+'/api/a/dev/pos-products?storeId=Q7',{headers:{authorization:'Bearer '+adm.token}})).json()).products;
 const code=prods.find(x=>x.name.startsWith('Sữa tươi')).barcode;console.log('barcode',code);
 const b0=await chromium.launch();const pg=await b0.newPage({viewport:{width:640,height:480}});
 const bits=ean(code);const mod=5;
 await pg.setContent(`<body style="margin:0;background:#fff"><canvas id=c width=640 height=480></canvas></body>`);
 await pg.evaluate(([bits,mod])=>{const c=document.getElementById('c').getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,640,480);c.fillStyle='#000';const x0=Math.floor((640-bits.length*mod)/2);
  for(let i=0;i<bits.length;i++) if(bits[i]==='1') c.fillRect(x0+i*mod,150,mod,180);},[bits,mod]);
 const jpg=await pg.screenshot({type:'jpeg',quality:90,clip:{x:0,y:0,width:640,height:480}});await b0.close();
 const frames=[];for(let i=0;i<30;i++)frames.push(jpg);fs.writeFileSync('/tmp/brg-shots/ean.mjpeg',Buffer.concat(frames));
 const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-video-capture=/tmp/brg-shots/ean.mjpeg']});
 const ctx=await b.newContext({viewport:{width:390,height:800},permissions:['camera']});const p=await ctx.newPage();const errs=[];
 p.on('pageerror',e=>errs.push('PAGEERR '+e.message));p.on('console',m=>{if(m.type()==='error')errs.push('console '+m.text())});
 await p.goto(BASE+'/c/?s=Q7');await p.click('text=Bắt đầu mua sắm');await p.click('text=Bỏ qua');await p.waitForURL(/#\/scan/);
 try{await p.waitForSelector('text=Đã thêm vào giỏ',{timeout:15000});console.log('DECODED OK');}catch(e){console.log('NOT DECODED');}
 await sleep(600);await p.screenshot({path:'/tmp/brg-shots/c-scan-ok.png'});
 console.log('usingBarcodeDetector',await p.evaluate(()=>'BarcodeDetector' in window));
 console.log('cart count text',await p.innerText('button.row b').catch(()=>'?'));
 console.log('errors',JSON.stringify(errs));await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
