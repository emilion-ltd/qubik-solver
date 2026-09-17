import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {openStore} from '../server/storage.js';
import {createApp} from '../server/app.js';
import core from '../server/cube-engine.cjs';
const state=core.apply('YYYYYYYYYOOOOOOOOOGGGGGGGGGWWWWWWWWWRRRRRRRRRBBBBBBBBB'.split(''),core.algPerm("R U R' U' F2"));
const secret='integration-secret';
function signed(p){const b=Buffer.from(JSON.stringify(p)).toString('base64url');return b+'.'+crypto.createHmac('sha256',secret).update(b).digest('base64url');}
async function fixture(){
 const dir=mkdtempSync(path.join(tmpdir(),'cube-pay-')),store=openStore(dir),transactions=new Map(),orders=[];
 const provider={configured:()=>true,mode:()=> 'sandbox',async createCheckoutPage(o){orders.push(o);assert.ok(store.getSession(o.orderId),'persist before provider');return {url:'https://checkout.example/'+o.orderId};},async getChargeByOrder(id){return transactions.get(id)||{paid:false};}};
 const app=createApp({store,provider,secret,baseURL:'http://localhost:3000'}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const post=async(route,body)=>{const r=await fetch(base+'/api'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 return {dir,store,transactions,orders,post,base,async close(){await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('payment confirmation, access control, restore and persistent purchase',async()=>{
 const f=await fixture();try{
  const config=await f.post('/config',{});assert.equal(config.body.live,true);
  const legacy=await f.post('/checkout/session',{plan:'unlimited',cubeId:'old-id',email:'buyer@example.com'});
  assert.equal(legacy.status,426);assert.equal(legacy.body.code,'CLIENT_UPDATE_REQUIRED');assert.equal(f.orders.length,0);
  const invalid=await f.post('/checkout/session',{plan:'single',state:Array(54).fill('W'),email:'buyer@example.com'});
  assert.equal(invalid.status,400);assert.equal(f.orders.length,0);
  const update=await fetch(f.base+'/update');assert.equal(update.status,200);assert.equal(update.headers.get('cache-control'),'no-store');
  const updateHTML=await update.text();assert.ok(updateHTML.includes('caches.delete'));assert.ok(!updateHTML.includes('localStorage.clear'));

  assert.equal((await fetch(f.base+'/api/health')).status,200);
  assert.equal((await fetch(f.base+'/server/cube-engine.cjs')).status,404);
  const checkout=await f.post('/checkout/session',{plan:'single',state,email:' Buyer@Example.com '});assert.equal(checkout.status,200);
  const id=checkout.body.id;assert.equal(f.orders[0].amount,790);
  assert.equal((await f.post('/checkout/status',{sessionId:id})).body.paid,false);
  assert.equal((await f.post('/solve/full',{state,token:'fake'})).status,403);
  // A forged success notification does not unlock anything.
  await f.post('/webhooks/smartpay',{status:'succeeded',transaction:{moreinfo1:id}}).catch(()=>{});
  assert.equal(f.store.getSession(id).status,'pending');
  for(const tx of [{paid:true,transactionId:'t1'},{paid:true,amount:791,transactionId:'t1'},{paid:true,amount:790},{paid:false,failed:true,amount:790,transactionId:'t1'}]){
   f.transactions.set(id,tx);assert.equal((await f.post('/checkout/status',{sessionId:id})).body.paid,false);
  }
  f.transactions.set(id,{paid:true,amount:790,transactionId:'t1',orderId:id});
  const paid=await f.post('/checkout/status',{sessionId:id});assert.equal(paid.body.paid,true);const u=paid.body.unlock;
  assert.equal((await f.post('/checkout/status',{sessionId:id})).body.unlock.token,u.token);
  assert.equal(f.store.purchasesFor('buyer@example.com').length,1);
  assert.equal((await f.post('/unlock/verify',{token:u.token})).body.ok,true);
  assert.equal((await f.post('/unlock/verify',{token:u.token+'x'})).status,401);
  assert.equal((await f.post('/restore',{email:'buyer@example.com'})).status,401);
  assert.equal((await f.post('/restore',{email:'other@example.com',recoveryCode:u.token})).status,401);
  assert.equal((await f.post('/restore',{email:'BUYER@example.com',recoveryCode:u.token})).body.unlock.token,u.token);
  const other=core.apply(state,core.MOVES.U);
  assert.equal((await f.post('/solve/full',{state:other,token:u.token})).status,403);
  const full=await f.post('/solve/full',{state,token:u.token});assert.equal(full.status,200);
  let solved=state;for(const m of full.body.steps.flatMap(s=>s.moves))solved=core.apply(solved,core.MOVES[m]);
  assert.ok(solved.every((c,i)=>c===solved[Math.floor(i/9)*9+4]));
  const reopened=openStore(f.dir);assert.equal(reopened.purchaseForToken(u.token).email,'buyer@example.com');reopened.close();
  const expiredToken=signed({plan:'unlimited',exp:Date.now()-1000,cubeId:null});
  f.store.createSession('expired',{email:'buyer@example.com',plan:'unlimited',status:'pending'});
  f.store.markPaid('expired','expired-tx',{plan:'unlimited',exp:Date.now()-1000,token:expiredToken});
  assert.equal((await f.post('/unlock/verify',{token:expiredToken})).status,401);
  // Validly signed but never purchased tokens are also rejected.
  assert.equal((await f.post('/unlock/verify',{token:signed({plan:'unlimited',exp:0,cubeId:null})})).status,401);
 }finally{await f.close();}
});
test('unlimited purchase and upgrade require proof, not knowledge of an email',async()=>{
 const f=await fixture();try{
  const c=await f.post('/checkout/session',{state,plan:'single',email:'a@example.com'});f.transactions.set(c.body.id,{paid:true,amount:790,transactionId:'single'});
  const u=(await f.post('/checkout/status',{sessionId:c.body.id})).body.unlock;
  const without=await f.post('/checkout/session',{state,plan:'unlimited',email:'a@example.com'});assert.equal(without.body.amount,24.90);
  const withProof=await f.post('/checkout/session',{state,plan:'unlimited',email:'a@example.com',token:u.token});assert.equal(withProof.body.amount,17);
  f.transactions.set(withProof.body.id,{paid:true,amount:1700,transactionId:'upgrade'});
  const unlimited=(await f.post('/checkout/status',{sessionId:withProof.body.id})).body.unlock;
  assert.equal(unlimited.plan,'unlimited');assert.equal(unlimited.exp,0);
  assert.equal((await f.post('/solve/full',{state:core.apply(state,core.MOVES.U),token:unlimited.token})).status,200);
 }finally{await f.close();}
});

test('provider diagnostics stay in operator logs and correlate with the public error',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cube-diagnostic-')),store=openStore(dir),logs=[];
 const provider={configured:()=>true,async createCheckoutPage(){throw Object.assign(new Error('Checkout declined'),{status:502,code:'SMARTPAY_CHECKOUT',provider:{http:400,status:'failed',issues:[{field:'page_uuid',message:'Required Field'}]}});}};
 const app=createApp({store,provider,secret,baseURL:'http://localhost:3000'}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const original=console.error;console.error=(...args)=>logs.push(args);
 try{
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/checkout/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,plan:'single',email:'buyer@example.com'})});
  const body=await response.json();assert.equal(response.status,502);assert.match(body.requestId,/^[0-9a-f-]{36}$/);
  assert.ok(body.error.includes(body.requestId));assert.equal(body.provider,undefined);assert.ok(!JSON.stringify(body).includes('Required Field'));
  const logged=JSON.parse(logs[0][1]);assert.equal(logged.requestId,body.requestId);assert.equal(logged.provider.issues[0].field,'page_uuid');
 }finally{console.error=original;await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('GET and POST returns render without granting access from browser claims',async()=>{
 const f=await fixture();try{
  const checkout=await f.post('/checkout/session',{plan:'unlimited',state,email:'buyer@example.com'});
  for(const name of ['success','fail','cancel'])for(const method of ['GET','POST']){
   const r=await fetch(f.base+'/pay/'+name,{method,...(method==='POST'?{headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'status=succeeded&transaction_id=forged'}:{})});
   assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
   assert.ok((await r.text()).includes('smartpay:'+({success:'done',fail:'fail',cancel:'cancel'}[name])));
  }
  assert.equal((await f.post('/checkout/status',{sessionId:checkout.body.id})).body.paid,false);
 }finally{await f.close();}
});

test('pending verification reports safe reasons without granting mismatched purchases',async()=>{
 const f=await fixture();try{
  const c=await f.post('/checkout/session',{state,plan:'unlimited',email:'debug@example.com'}),id=c.body.id;
  for(const [tx,reason]of [
   [{paid:false},'awaiting_provider'],
   [{paid:false,failed:true},'declined'],
   [{paid:true,amount:790,transactionId:'tx'},'amount_mismatch'],
   [{paid:true,amount:2490},'missing_transaction_id'],
   [{paid:true,amount:2490,transactionId:'tx',orderId:'other'},'order_mismatch']
  ]){
   f.transactions.set(id,tx);const r=await f.post('/checkout/status',{sessionId:id});
   assert.equal(r.body.paid,false);assert.equal(r.body.verification,reason);
   assert.match(r.body.checkId,/^[0-9a-f]{12}$/);assert.equal(r.body.unlock,undefined);
  }
  f.transactions.set(id,{paid:true,amount:2490,transactionId:'tx',orderId:id});
  assert.equal((await f.post('/checkout/status',{sessionId:id})).body.paid,true);
 }finally{await f.close();}
});
