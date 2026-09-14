const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
(async()=>{
 const {createApp}=await import('../server/app.js'),{openStore}=await import('../server/storage.js');
 const dir=mkdtempSync(path.join(tmpdir(),'cube-payment-ui-')),store=openStore(dir),transactions=new Map();let configured=false,order;
 const provider={configured:()=>configured,mode:()=> 'sandbox',createCheckoutPage:async o=>{order=o;return {url:'https://checkout.example/'+o.orderId};},getChargeByOrder:async id=>transactions.get(id)||{paid:false}};
 const server=createApp({store,provider,secret:'browser-test-secret',baseURL:'http://127.0.0.1'}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://checkout.example/**',route=>route.fulfill({contentType:'text/html',body:'<button id="mock-pay">Mock hosted payment</button>'}));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#go-manual').click();
  await page.evaluate(()=>{facelets=CubeCore.apply('WWWWWWWWWRRRRRRRRRGGGGGGGGGYYYYYYYYYOOOOOOOOOBBBBBBBBB'.split(''),CubeCore.algPerm("R U2 B' L F2 D R2 B U' L2"));paintNet();});
  await page.locator('#solve-btn').click();await page.locator('#s-solve').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>P.partial),true);
  await page.evaluate(()=>{for(const f of P.flat)P.state=CubeCore.apply(P.state,CubeCore.MOVES[f.m]);P.pos=P.flat.length;paint3D(P.cubies,P.state);render();showMove(null);});
  await page.locator('#next').click();await page.waitForFunction(()=>document.getElementById('payerr').textContent.includes('חסרות'));
  assert.equal(await page.locator('#paybtn').isVisible(),false);
  await page.locator('#pw-close').click();configured=true;await page.locator('#next').click();await page.locator('#paybtn').waitFor({state:'visible'});
  await page.locator('[data-plan="single"]').click();await page.locator('#email').fill('buyer@example.com');await page.locator('#paybtn').click();
  await page.frameLocator('#payframe').locator('#mock-pay').click();
  assert.equal(await page.evaluate(()=>P.partial),true);
  transactions.set(order.orderId,{paid:true,amount:order.amount,transactionId:'browser-tx',orderId:order.orderId});
  await page.evaluate(()=>pollStatus());await page.waitForFunction(()=>!P.partial);
  assert.equal(await page.locator('#purchase-access').isVisible(),true);assert.ok((await page.locator('#recovery-code').inputValue()).includes('.'));
  assert.deepEqual(errors,[]);
  console.log('Payment browser passed: missing config, hosted checkout, pending gate, verified payment, premium steps and recovery credential.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
