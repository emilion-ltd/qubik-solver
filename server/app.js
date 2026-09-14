import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {createSEO} from './seo.js';
import CubeCore from './cube-engine.cjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cubeID=state=>crypto.createHash('sha256').update(state.join('')).digest('hex');
const legacyID=state=>{let h=5381;for(const c of state.join(''))h=((h<<5)+h+c.charCodeAt(0))>>>0;return h.toString(36);};
const normalize=email=>typeof email==='string'?email.trim().toLowerCase():'';
const validEmail=email=>email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createApp({store,provider,secret,baseURL,prices={single:7.90,unlimited:24.90},solve=solveInWorker}) {
  const app=express(); app.disable('x-powered-by');app.use(express.json({limit:'16kb'}));
  const origin=new URL(baseURL).origin;
  if(!Object.values(prices).every(n=>Number.isFinite(n)&&n>0)||prices.unlimited<prices.single)throw new Error('Invalid payment prices');
  const seo=createSEO(fs.readFileSync(path.join(root,'index.html'),'utf8'),baseURL);
  app.get('/',(_,res)=>res.type('html').send(seo.html));
  app.get('/index.html',(_,res)=>res.redirect(301,'/'));
  // This route is deliberately outside the service-worker's cached shell.
  app.get('/update',(_,res)=>res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex'}).type('html').send(`<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>עדכון CubeSolve</title></head>
<body style="font-family:Arial;background:#1c2230;color:white;max-width:520px;margin:40px auto;padding:20px"><h1>עדכון האפליקציה</h1><p>הממשק השמור במכשיר אינו תואם לשרת. העדכון שומר רכישות, קודי שחזור וצבעים שמורים.</p><p>אם כבר סובבת את הקובייה, לאחר העדכון יש להזין את המצב הנוכחי שלה. התקדמות הסיבובים אינה נשמרת.</p><button id="update" style="padding:16px;font-size:18px">עדכן ופתח את CubeSolve</button><p id="status" role="status"></p>
<script>
document.getElementById('update').onclick=async function(){
 this.disabled=true;const status=document.getElementById('status');status.textContent='מעדכן…';
 try{
  if('serviceWorker' in navigator){
   const registrations=await navigator.serviceWorker.getRegistrations();
   for(const r of registrations){const workers=[r.active,r.waiting,r.installing].filter(Boolean);if(r.scope===new URL('./',location.href).href && workers.some(w=>new URL(w.scriptURL).pathname==='/sw.js'))await r.unregister();}
  }
  if('caches' in window){for(const name of await caches.keys())if(name.startsWith('cubesolve-'))await caches.delete(name);}
  location.replace('/?updated='+Date.now());
 }catch(error){status.textContent='העדכון לא הושלם. נסה שוב עם חיבור לרשת.';this.disabled=false;}
};
</script></body></html>`));
  for(const file of ['cube-core.js','solver-worker.js','payment-client.js','pwa.js','sw.js','manifest.webmanifest']) app.get('/'+file,(_,res)=>{
    if(file==='sw.js')res.set('Cache-Control','no-cache');res.sendFile(path.join(root,file));
  });
  app.use('/icons',express.static(path.join(root,'icons')));
  app.get('/robots.txt',(_,res)=>res.type('text/plain').send(seo.robots));
  app.get('/sitemap.xml',(_,res)=>seo.sitemap?res.type('application/xml').send(seo.sitemap):res.status(503).send('Set PUBLIC_BASE_URL'));
  app.use('/api',(_,res,next)=>{res.set('Cache-Control','no-store');next();});
  app.get('/api/health',(_,res)=>res.json({ok:true,service:'cubesolve-api'}));
  const config=(_,res)=>res.json({live:provider.configured(),prices,missing:provider.missingConfiguration?.()||[],mode:provider.mode?.()||'unknown',clientVersion:2,updateURL:'/update'});
  app.get('/api/config',config);app.post('/api/config',config);
  const wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
  // Bound expensive requests. Do not trust arbitrary X-Forwarded-For headers.
  const buckets=new Map();
  const limit=(req,res,next)=>{
    const key=req.ip,now=Date.now();let b=buckets.get(key);
    if(!b||b.until<now){b={count:0,until:now+60000};buckets.set(key,b);}
    if(buckets.size>10000)for(const [k,v]of buckets)if(v.until<now)buckets.delete(k);
    if(++b.count>30)return res.status(429).json({error:'יותר מדי בקשות. המתן דקה ונסה שוב.'});next();
  };
  function sign(payload){const body=Buffer.from(JSON.stringify(payload)).toString('base64url');return body+'.'+crypto.createHmac('sha256',secret).update(body).digest('base64url');}
  function authorize(token,state){
    if(typeof token!=='string'||token.length>4096)return null;
    const parts=token.split('.');if(parts.length!==2)return null;
    const [body,mac]=parts,good=crypto.createHmac('sha256',secret).update(body).digest('base64url');
    if(Buffer.byteLength(mac)!==Buffer.byteLength(good)||!crypto.timingSafeEqual(Buffer.from(mac),Buffer.from(good)))return null;
    let claims;try{claims=JSON.parse(Buffer.from(body,'base64url').toString());}catch{return null;}
    if(!claims||!['single','unlimited'].includes(claims.plan)||!Number.isFinite(claims.exp)||(claims.exp&&claims.exp<=Date.now()))return null;
    const purchase=store.purchaseForToken(token);if(!purchase)return null;
    if(state&&claims.plan==='single'&&claims.cubeId!==cubeID(state)&&claims.cubeId!==legacyID(state))return null;
    return {purchase,unlock:{...claims,token}};
  }
  function validState(state){if(!CubeCore.inspect(state).valid)throw fail(400,'מצב הקובייה אינו תקין. בדוק את הצבעים.');}
  async function confirm(id){
    let s=store.getSession(id);if(!s||s.status==='paid')return s;
    const tx=await provider.getChargeByOrder(id);
    // Fail closed: missing amount/status/transaction identity never grants access.
    if(tx.paid&&Number.isSafeInteger(tx.amount)&&tx.amount===s.agorot&&tx.transactionId&&(!tx.orderId||tx.orderId===id)){
      const claims={plan:s.plan,cubeId:s.plan==='single'?s.cubeId:null,exp:s.plan==='single'?Date.now()+7*864e5:0};
      s=store.markPaid(id,tx.transactionId,{...claims,token:sign(claims)});
    }
    return {...s,providerFailed:!!tx.failed};
  }
  app.post('/api/checkout/session',limit,wrap(async(req,res)=>{
    const {plan,state,token}=req.body||{},email=normalize(req.body?.email);
    if(!Object.hasOwn(prices,plan))throw fail(400,'תוכנית לא מוכרת');
    if(!validEmail(email))throw fail(400,'נדרש אימייל תקין');
    if(!Object.hasOwn(req.body||{},'state'))throw Object.assign(fail(426,'האפליקציה במכשיר אינה מעודכנת. אין בעיה בצבעים: פתח את כתובת האתר עם ‎/update בסוף כדי לעדכן, ואז נסה שוב.'),{code:'CLIENT_UPDATE_REQUIRED'});
    validState(state);if(!provider.configured())throw fail(503,'הסליקה אינה מוגדרת בשרת');
    const prior=authorize(token),credit=plan==='unlimited'&&prior?.purchase.email===email&&prior.unlock.plan==='single';
    const amount=+(prices[plan]-(credit?prices.single:0)).toFixed(2),agorot=Math.round(amount*100),id=crypto.randomUUID();
    const cubeId=cubeID(state);
    // Persist before contacting the provider: callbacks can arrive before the HTTP response.
    store.createSession(id,{plan,cubeId,email,amount,agorot,status:'pending',createdAt:Date.now()});
    const page=await provider.createCheckoutPage({amount:agorot,orderId:id,baseUrl:origin,email,description:plan==='single'?'CubeSolve — פתרון אחד':'CubeSolve — ללא הגבלה'});
    res.json({id,amount,cubeId,payUrl:page.url});
  }));
  app.post('/api/checkout/status',limit,wrap(async(req,res)=>{
    const id=req.body?.sessionId;if(typeof id!=='string'||!store.getSession(id))throw fail(404,'סשן תשלום לא נמצא');
    const s=await confirm(id);res.json(s.status==='paid'?{paid:true,unlock:s.unlock}:{paid:false,failed:s.providerFailed});
  }));
  app.post('/api/webhooks/smartpay',wrap(async(req,res)=>{
    const id=req.body?.transaction?.moreinfo1;
    if(typeof id==='string'&&store.getSession(id)&&req.body?.status==='succeeded')await confirm(id);
    res.sendStatus(200);
  }));
  app.post('/api/unlock/verify',limit,(req,res)=>{
    const a=authorize(req.body?.token);if(!a)return res.status(401).json({ok:false,error:'ההרשאה אינה תקפה. יש לשחזר את הרכישה.'});
    res.json({ok:true,unlock:a.unlock});
  });
  app.post('/api/restore',limit,(req,res)=>{
    // A recovery code is the signed purchase token, not an email address alone.
    const a=authorize(req.body?.recoveryCode);
    if(!a||a.purchase.email!==normalize(req.body?.email))return res.status(401).json({error:'האימייל או קוד השחזור אינם תואמים רכישה פעילה.'});
    res.json({unlock:a.unlock});
  });
  let active=0;
  app.post('/api/solve/full',limit,wrap(async(req,res)=>{
    const {state,token}=req.body||{};validState(state);
    if(!authorize(token,state))throw fail(403,'נדרשת רכישה תקפה לקובייה הזו.');
    if(active>=2)throw fail(503,'הפותר עמוס כרגע. נסה שוב בעוד רגע.');
    active++;try{const result=await solve(state);if(result.error)throw fail(422,result.error);res.json(result);}finally{active--;}
  }));
  for(const [name,title]of [['success','בודקים את אישור התשלום…'],['fail','התשלום לא אושר'],['cancel','התשלום בוטל']]){
    const signal=name==='success'?'done':name;
    app.get('/pay/'+name,(_,res)=>res.set('Cache-Control','no-store').type('html').send(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body><h1>${title}</h1><p>אפשר לחזור לאפליקציה. הגישה נפתחת רק לאחר אישור מהשרת.</p><a href="/">חזרה לאפליקציה</a><script>parent.postMessage('smartpay:${signal}',${JSON.stringify(origin).replace(/</g,'\\u003c')})</script></body></html>`));
  }
  app.use((error,req,res,next)=>{
    console.error('request failed',req.method,req.path,error.code||error.status||'internal');
    res.status(error.status||502).json({error:error.status?error.message:'לא ניתן להשלים את הבקשה כרגע. נסה שוב.',code:error.code||'REQUEST_FAILED'});
  });
  return app;
}
function solveInWorker(state){return new Promise((resolve,reject)=>{
  const w=new Worker(new URL('./solve-worker.cjs',import.meta.url),{workerData:state});
  const timer=setTimeout(()=>{w.terminate();reject(fail(503,'החישוב ארך זמן רב מדי. נסה שוב.'));},45000);
  w.once('message',r=>{clearTimeout(timer);w.terminate();resolve(r);});
  w.once('error',e=>{clearTimeout(timer);reject(e);});
  w.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(fail(503,'החישוב הופסק. נסה שוב.'));});
});}
