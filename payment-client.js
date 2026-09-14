// Browser storage holds a credential, never proof that a purchase is valid.
const Unlock={
  get(){try{return JSON.parse(localStorage.getItem('cube_unlock')||'null');}catch{return null;}},
  set(u){this.memory=u;try{localStorage.setItem('cube_unlock',JSON.stringify(u));}catch{}},
  memory:null
};
const credential=()=>Unlock.memory||Unlock.get();
let plan='unlimited',session=null,pollTimer=null,live=false,polling=false,premiumLoading=false;
async function api(path,body){
  let r;
  try{r=await fetch(CONFIG.apiBase+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(path==='/solve/full'?50000:20000)});}
  catch{throw new Error('אין חיבור לשרת. בדוק את החיבור ונסה שוב.');}
  if(r.status===404)throw new Error('שרת התשלומים אינו מחובר לאתר (404). יש להפעיל את שרת האפליקציה.');
  const data=await r.json().catch(()=>null);
  if(!data)throw new Error('האתר לא החזיר תשובת API תקינה. יש לבדוק את פריסת השרת.');
  if(!r.ok){
    if(data.code==='CLIENT_UPDATE_REQUIRED'){
      let link=document.getElementById('payment-update');
      if(!link){link=document.createElement('a');link.id='payment-update';link.href='/update';link.className='btn';link.textContent='עדכן את האפליקציה';document.getElementById('payerr').after(link);}
    }
    throw Object.assign(new Error(data.error||'לא ניתן להשלים את הבקשה כרגע.'),{code:data.code,status:r.status});
  }return data;
}
function showCredential(u){
  $('purchase-access').hidden=false;
  $('access-label').textContent=u.plan==='unlimited'?'הרכישה אומתה — גישה ללא הגבלה':'הרכישה אומתה — גישה לקובייה שנרכשה עד '+new Date(u.exp).toLocaleDateString('he-IL');
  $('recovery-code').value=u.token;
}
$('copy-recovery').onclick=async()=>{try{await navigator.clipboard.writeText($('recovery-code').value);toast('קוד השחזור הועתק');}catch{$('recovery-code').select();toast('סמן והעתק את קוד השחזור');}};
async function loadPremium(){
  if(premiumLoading||!P.partial||!P.initial)return;
  const u=credential();if(!u?.token)return;
  premiumLoading=true;const initial=P.initial;
  try{
    const r=await api('/solve/full',{state:initial,token:u.token});
    if(P.initial!==initial)return;
    const flat=[];r.steps.forEach((s,si)=>s.moves.forEach(m=>flat.push({step:si,m})));
    if(P.flat.some((f,i)=>flat[i]?.m!==f.m))throw new Error('הפתרון השתנה. הזן מחדש את מצב הקובייה הנוכחי.');
    P.steps=r.steps;P.flat=flat;P.partial=false;render();showMove(null);
  }finally{premiumLoading=false;}
}
function stopPay(){if(pollTimer)clearInterval(pollTimer);pollTimer=null;session=null;$('payframe-wrap').hidden=true;$('payframe').src='about:blank';$('paybtn').hidden=!live;}
function selectPlan(p){plan=p;stopPay();document.querySelectorAll('.plan').forEach(b=>b.classList.toggle('on',b.dataset.plan===p));$('paytotal').textContent=CONFIG.prices[p].toFixed(2);}
async function openPaywall(){
  if(credential()?.token){try{await loadPremium();if(!P.partial)return;}catch(e){$('payerr').textContent=e.message;}}
  live=false;stopPay();$('pw').classList.add('on');$('payerr').textContent='בודק זמינות תשלום…';
  try{
    const c=await api('/config',{});live=c.live===true;CONFIG.prices=c.prices;
    $('p-single').textContent=c.prices.single.toFixed(2);$('p-unl').textContent=c.prices.unlimited.toFixed(2);$('p-unl-was').hidden=true;
    $('payerr').textContent=live?(c.mode==='sandbox'?'סביבת בדיקות — לא מתבצע חיוב אמיתי.':''):'חסרות הגדרות סליקה בשרת. יש לפנות לתמיכה.';
    selectPlan(plan);
  }catch(e){$('payerr').textContent=e.message;}
  $('paybtn').hidden=!live;
}
document.querySelectorAll('.plan').forEach(b=>b.onclick=()=>selectPlan(b.dataset.plan));
$('pw-close').onclick=()=>{stopPay();$('pw').classList.remove('on');};
async function grant(u){
  const verified=await api('/unlock/verify',{token:u.token});
  Unlock.set(verified.unlock);showCredential(verified.unlock);
  try{localStorage.removeItem('cube_checkout');}catch{}
  stopPay();$('pw').classList.remove('on');toast('התשלום אושר. שמור את קוד השחזור שלך.');
  if(P.initial)await loadPremium();
}
async function pollStatus(){
  if(!session||polling)return;polling=true;const id=session.id;
  try{
    const r=await api('/checkout/status',{sessionId:id});
    if(session?.id!==id)return;
    if(r.paid)await grant(r.unlock);
    else if(r.failed)$('payerr').textContent='התשלום לא אושר. אפשר לנסות שוב בדף התשלום.';
  }catch(e){$('payerr').textContent=e.message;}finally{polling=false;}
}
$('paybtn').onclick=async()=>{
  const email=$('email').value.trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){$('payerr').textContent='הזן אימייל תקין לרכישה.';return;}
  if(!P.initial){$('payerr').textContent='יש להזין קובייה לפני רכישת פתרון.';return;}
  const btn=$('paybtn');btn.disabled=true;$('payerr').textContent='פותח דף תשלום…';
  try{
    session=await api('/checkout/session',{clientVersion:2,plan,state:P.initial,email,token:credential()?.token});
    try{localStorage.setItem('cube_checkout',JSON.stringify({id:session.id}));}catch{}
    $('payframe').src=session.payUrl;$('external-checkout').href=session.payUrl;$('payframe-wrap').hidden=false;btn.hidden=true;
    $('payerr').textContent='הסכום לתשלום: ₪'+session.amount.toFixed(2);
    if(pollTimer)clearInterval(pollTimer);pollTimer=setInterval(pollStatus,5000);
  }catch(e){$('payerr').textContent=e.message;}finally{btn.disabled=false;}
};
$('restore').onclick=async()=>{
  try{const r=await api('/restore',{email:$('email').value.trim(),recoveryCode:$('recovery-input').value.trim()});await grant(r.unlock);}
  catch(e){$('payerr').textContent=e.message;}
};
window.addEventListener('message',e=>{
  if(e.origin!==location.origin||e.source!==$('payframe').contentWindow)return;
  if(e.data==='smartpay:done')pollStatus();
  if(e.data==='smartpay:fail')$('payerr').textContent='התשלום לא אושר. אפשר לנסות שוב.';
  if(e.data==='smartpay:cancel'){$('payerr').textContent='התשלום בוטל.';stopPay();}
});
// A refresh or 3DS window must not lose an already completed payment.
(async()=>{
  const u=credential();if(u?.token)try{const r=await api('/unlock/verify',{token:u.token});Unlock.set(r.unlock);showCredential(r.unlock);}catch{}
  try{const pending=JSON.parse(localStorage.getItem('cube_checkout')||'null');if(pending?.id){session=pending;await pollStatus();if(session)pollTimer=setInterval(pollStatus,5000);}}catch{}
})();
