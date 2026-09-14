const {chromium}=require('playwright');
const {mkdtempSync,rmSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
(async()=>{
 const {createApp}=await import('../server/app.js'),{openStore}=await import('../server/storage.js');
 const dir=mkdtempSync(path.join(tmpdir(),'cube-update-')),store=openStore(dir);
 const app=createApp({store,provider:{configured:()=>false},secret:'test',baseURL:'http://localhost:3000'});
 let deployed=false,browser;
 const oldWorker=`self.addEventListener('install',e=>e.waitUntil(caches.open('cubesolve-old').then(c=>c.add('/'))));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(new URL(e.request.url).pathname==='/')e.respondWith(caches.open('cubesolve-old').then(async c=>(await c.match('/'))||fetch(e.request)));});`;
 const server=http.createServer((req,res)=>{
  if(!deployed&&req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<h1>Old version</h1><script>navigator.serviceWorker.register("/sw.js")</script>');}
  if(!deployed&&req.url==='/sw.js'){res.setHeader('Content-Type','application/javascript');return res.end(oldWorker);}
  app(req,res);
 }).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.goto(url);await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
  await page.evaluate(()=>{localStorage.setItem('cube_unlock','{"token":"keep-me"}');localStorage.setItem('cubesolve-draft','saved-colors');});
  deployed=true;await page.reload();assert.equal(await page.locator('h1').innerText(),'Old version');
  await page.goto(url+'/update');await page.locator('#update').click();await page.waitForURL(/updated=/);
  await page.locator('#go-manual').waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('cube_unlock')),'{"token":"keep-me"}');
  assert.equal(await page.evaluate(()=>localStorage.getItem('cubesolve-draft')),'saved-colors');
  assert.equal(await page.locator('#recovery-input').count(),1);
  console.log('Cached old client upgraded successfully; purchase credential and draft preserved.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
