const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const root=path.join(__dirname,'..'),dir=mkdtempSync(path.join(tmpdir(),'cube-browser-'));
  const server=spawn(process.execPath,['index.js'],{cwd:path.join(root,'server'),env:{...process.env,PORT:'3187',PUBLIC_BASE_URL:'http://localhost:3187',DATA_DIR:dir},stdio:'inherit'});
  let browser;
  try{
    for(let i=0;i<100;i++){try{if((await fetch('http://localhost:3187')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext(),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://localhost:3187');
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    assert.equal(await page.locator('h1').count(),1);
    await page.locator('#go-manual').click();
    await page.evaluate(()=>{
      facelets='WWWWWWWWWRRRRRRRRRGGGGGGGGGYYYYYYYYYOOOOOOOOOBBBBBBBBB'.split('');
      const ids=[8,9,20],old=facelets.slice();ids.forEach((i,k)=>facelets[i]=old[ids[(k+1)%3]]);
      paintNet();
    });
    await page.locator('#solve-btn').click();
    assert.equal(await page.locator('.diag').count(),3);
    assert.ok((await page.locator('#errs').innerText()).includes('אי אפשר לדעת בוודאות'));
    await page.locator('#errs button').click();
    assert.equal(await page.locator('#s-review').isVisible(),true);
    await page.locator('#solve-btn').click();
    await page.locator('#s-solve').waitFor({state:'visible'});
    assert.equal(await page.locator('#notation').innerText(),'פתור!');
    await page.locator('#solve-home').click();
    await context.setOffline(true);
    await page.reload();
    await page.locator('#go-manual').click();
    await page.evaluate(()=>{
      facelets=CubeCore.apply('WWWWWWWWWRRRRRRRRRGGGGGGGGGYYYYYYYYYOOOOOOOOOBBBBBBBBB'.split(''),CubeCore.MOVES.R);
      paintNet();
    });
    await page.locator('#solve-btn').click();
    await page.locator('#s-solve').waitFor({state:'visible'});
    assert.ok((await page.locator('#cnt').innerText()).includes('מתוך'));
    assert.deepEqual(errors,[]);
    console.log('Browser smoke passed: page, service worker, corner guidance, confirm, worker solve and offline reload/solve.');
  }finally{
    if(browser)await browser.close();
    server.kill('SIGTERM');
    await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});
    rmSync(dir,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
