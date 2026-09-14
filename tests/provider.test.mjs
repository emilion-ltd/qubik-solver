import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SMARTPAY_CUID=' test-cuid ';process.env.SMARTPAY_SECRET_KEY=' test-secret ';process.env.SMARTPAY_PAGE_UUID=' test-page ';
const provider=await import('../server/smartpay.js');
test('SmartPay request contract and fail-closed charge verification',async()=>{
 const original=globalThis.fetch;const calls=[];let reply,status=200;
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(reply),{status,headers:{'Content-Type':'application/json'}});};
 try{
  reply={status:'succeeded',url:'https://checkout.example/iframe/id'};
  await provider.createCheckoutPage({amount:790,orderId:'order',baseUrl:'https://cube.example',email:'test@example.com'});
  const req=JSON.parse(calls[0].options.body);assert.equal(req.amount,790);assert.equal(req.currency,'ils');assert.equal(req.values.moreinfo1,'order');assert.equal(req.ipn_url,'https://cube.example/api/webhooks/smartpay');assert.equal(req.page_uuid,'test-page');
  assert.equal(calls[0].options.headers.Authorization,'Basic '+Buffer.from('test-cuid:test-secret').toString('base64'));
  reply={status:'succeeded',transaction_id:'tx',transaction:{operation_status:'succeeded',amount:790,moreinfo1:'order'}};
  assert.equal((await provider.getChargeByOrder('order')).paid,true);
  reply={status:'succeeded',transaction_id:'tx',transaction:{amount:790}};assert.equal((await provider.getChargeByOrder('order')).paid,false);
  reply={status:'failed',transaction:{operation_status:'failed'}};status=402;assert.equal((await provider.getChargeByOrder('order')).paid,false);
  status=401;await assert.rejects(provider.createCheckoutPage({amount:790,orderId:'order',baseUrl:'https://cube.example'}),e=>e.code==='SMARTPAY_AUTH');
 }finally{globalThis.fetch=original;}
});

test('checkout exposes structured, redacted provider diagnostics across error shapes',async()=>{
 const original=globalThis.fetch;
 const input={amount:790,orderId:'order-private-123',baseUrl:'https://cube.example',email:'buyer@example.com',description:'Customer-specific description'};
 const cases=[
  {http:400,data:{status:'failed',errors:{page_uuid:{success:false,message:'Required Field'}}},code:'SMARTPAY_CHECKOUT',field:'page_uuid'},
  {http:400,data:{status:'failed',errors:{amount:{success:false,message:'Too low'}}},code:'SMARTPAY_CHECKOUT',field:'amount'},
  {http:200,data:{status:'failed',status_full_description:'Page is disabled'},code:'SMARTPAY_CHECKOUT'},
  {http:200,data:{status:'succeeded'},code:'SMARTPAY_CHECKOUT'},
  {http:403,data:{status:'failed'},code:'SMARTPAY_FORBIDDEN'},
  {http:404,data:{status:'failed'},code:'SMARTPAY_ENDPOINT'},
  {http:429,data:{status:'failed'},code:'SMARTPAY_RATE_LIMIT'},
  {http:503,data:'<html>private gateway response</html>',raw:true,code:'SMARTPAY_UNAVAILABLE'},
  {http:200,data:'<html>private gateway response</html>',raw:true,code:'SMARTPAY_RESPONSE'},
  {http:200,data:{status:'succeeded',url:'javascript:alert(1)'},code:'SMARTPAY_CHECKOUT_URL'},
 ];
 try{
  for(const fixture of cases){
   globalThis.fetch=async()=>new Response(fixture.raw?fixture.data:JSON.stringify(fixture.data),{status:fixture.http});
   await assert.rejects(provider.createCheckoutPage(input),e=>{
    assert.equal(e.code,fixture.code);assert.equal(e.provider.http,fixture.http);assert.equal(e.provider.endpoint,'/checkout/pages');
    if(fixture.field)assert.equal(e.provider.issues[0].field,fixture.field);
    assert.ok(!JSON.stringify(e.provider).includes('private gateway response'));return true;
   });
  }
  const leaked='test-secret test-cuid test-page buyer@example.com order-private-123 '+Buffer.from('test-cuid:test-secret').toString('base64');
  globalThis.fetch=async()=>new Response(JSON.stringify({status:'failed',status_full_description:leaked,errors:{page_uuid:{message:leaked,value:'DO NOT LOG ME'}},customer_details:{name:'DO NOT LOG ME'},Authorization:'DO NOT LOG ME'}),{status:400});
  await assert.rejects(provider.createCheckoutPage(input),e=>{
   const log=JSON.stringify(e.provider);
   for(const value of ['test-secret','test-cuid','test-page','buyer@example.com','order-private-123','DO NOT LOG ME'])assert.ok(!log.includes(value),value);
   assert.ok(log.includes('[redacted]'));assert.ok(!e.message.includes(leaked));return true;
  });
  globalThis.fetch=async()=>{throw Object.assign(new Error('secret network detail'),{name:'TimeoutError'});};
  await assert.rejects(provider.createCheckoutPage(input),e=>e.code==='SMARTPAY_TIMEOUT'&&!e.message.includes('secret network detail'));
 }finally{globalThis.fetch=original;}
});
