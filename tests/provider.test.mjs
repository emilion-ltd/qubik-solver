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
