// SmartPay hosted checkout; see https://docs.starltd.net/smartpay/getting-started/errors/
const cfg = {
  apiUrl: (process.env.SMARTPAY_API_URL || 'https://devapi.smartpay.co.il/v1').trim().replace(/\/+$/, ''),
  cuid: process.env.SMARTPAY_CUID?.trim(),
  secret: process.env.SMARTPAY_SECRET_KEY?.trim(),
  pageUuid: process.env.SMARTPAY_PAGE_UUID?.trim(),
};
export const missingConfiguration = () => [['SMARTPAY_CUID',cfg.cuid],['SMARTPAY_SECRET_KEY',cfg.secret],['SMARTPAY_PAGE_UUID',cfg.pageUuid]].filter(([,v])=>!v).map(([k])=>k);
export const configured = () => missingConfiguration().length === 0;
export const mode = () => {try{return new URL(cfg.apiUrl).hostname==='devapi.smartpay.co.il'?'sandbox':'production';}catch{return 'invalid';}};

// Only selected error metadata is logged. Never log bodies, headers, HTML, card
// objects, checkout URLs, customer_details, or the full provider response.
function diagnostics(http,data,path,body,format='json') {
  const protectedValues=[cfg.cuid,cfg.secret,cfg.pageUuid,Buffer.from(`${cfg.cuid}:${cfg.secret}`).toString('base64')];
  function collect(v){if(typeof v==='string'&&v.length>=3)protectedValues.push(v);else if(v&&typeof v==='object')Object.values(v).forEach(collect);}
  collect(body);
  const clean=value=>{
    if(typeof value!=='string'&&typeof value!=='number')return '';
    let text=String(value);
    for(const raw of protectedValues.filter(Boolean).sort((a,b)=>b.length-a.length)){
      for(const secret of [raw,encodeURIComponent(raw),Buffer.from(raw).toString('base64')])text=text.split(secret).join('[redacted]');
    }
    return text.replace(/<[^>]*>/g,' ').replace(/https?:\/\/\S+/gi,'[url]')
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email]')
      .replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi,'[id]')
      .replace(/\+?\d[\d ()-]{6,}\d/g,'[number]')
      .replace(/\b[A-Za-z0-9_+/=-]{24,}\b/g,'[token]')
      .replace(/[\r\n\t\u0000-\u001f]/g,' ').slice(0,350);
  };
  const issues=[];
  if(data?.errors&&typeof data.errors==='object')for(const [field,error]of Object.entries(data.errors).slice(0,8)){
    const name=/^[a-z][a-z0-9_.\[\]]{0,63}$/i.test(field)?field:'unknown';
    // The documented shape is errors[field].message. Ignore unrelated properties.
    const message=typeof error==='string'?error:error?.message;
    issues.push({field:name,message:clean(message)||'Validation failed'});
  }
  return {http,endpoint:path,mode:mode(),format,status:['succeeded','failed'].includes(data?.status)?data.status:'unknown',description:clean(data?.status_full_description),issues};
}
function failure(code,message,provider){return Object.assign(new Error(message),{status:502,code,provider});}

async function call(path,body){
  let url;
  try{url=new URL(cfg.apiUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/v1'))throw Error();}
  catch{throw failure('SMARTPAY_CONFIG','כתובת SmartPay בשרת אינה תקינה. נדרשת כתובת HTTPS המסתיימת ב־/v1.',{endpoint:path,mode:mode()});}
  let r;
  try{
    r=await fetch(cfg.apiUrl+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(`${cfg.cuid}:${cfg.secret}`).toString('base64')},body:JSON.stringify(body||{})});
  }catch(e){throw failure(e.name==='TimeoutError'?'SMARTPAY_TIMEOUT':'SMARTPAY_NETWORK','אין כרגע חיבור תקין בין השרת ל־SmartPay. נסה שוב בעוד רגע.',{endpoint:path,mode:mode()});}
  let data,format='json';
  try{data=await r.json();if(!data||typeof data!=='object'||Array.isArray(data))throw Error();}catch{data={};format='non-json';}
  const provider=diagnostics(r.status,data,path,body,format);
  if(r.status===401)throw failure('SMARTPAY_AUTH','פרטי SmartPay לא אושרו. בדוק התאמה בין סביבת הסליקה לפרטי החשבון.',provider);
  if(r.status===403)throw failure('SMARTPAY_FORBIDDEN','SmartPay חסם את הגישה לחשבון. יש לבדוק הרשאות חשבון או הגבלת כתובת IP.',provider);
  if(r.status===404)throw failure('SMARTPAY_ENDPOINT','כתובת השירות של SmartPay לא נמצאה. בדוק את SMARTPAY_API_URL.',provider);
  if(r.status===429)throw failure('SMARTPAY_RATE_LIMIT','SmartPay מגביל בקשות כרגע. המתן מעט ונסה שוב.',provider);
  if(r.status>=500)throw failure('SMARTPAY_UNAVAILABLE','SmartPay אינו זמין כרגע. נסה שוב בעוד רגע.',provider);
  if(format!=='json')throw failure('SMARTPAY_RESPONSE','SmartPay החזיר תשובה לא צפויה. יש לבדוק את כתובת השירות והחיבור.',provider);
  return {http:r.status,data,provider};
}
export async function createCheckoutPage({amount,orderId,baseUrl,description}){
  // Checkout prefill requires name, email AND phone. Collect these on the hosted
  // page; the app keeps its recovery email in the local purchase session.
  // Contract: https://docs.starltd.net/streamline.yaml (/checkout/pages).
  const body={page_uuid:cfg.pageUuid,amount,currency:'ils',success_url:`${baseUrl}/pay/success`,fail_url:`${baseUrl}/pay/fail`,cancel_url:`${baseUrl}/pay/cancel`,ipn_url:`${baseUrl}/api/webhooks/smartpay`,default_language:'he',expired_at_minutes:30,show_customer_fields:true,values:{moreinfo1:orderId,...(description?{extra_data:{description}}:{})}};
  const {http,data,provider}=await call('/checkout/pages',body);
  if(http<200||http>=300||data.status!=='succeeded'||typeof data.url!=='string'||!data.url){
    const field=provider.issues[0]?.field;
    let message='SmartPay לא אישר יצירת דף תשלום. פרטי האבחון זמינים למפעיל האתר לפי מזהה הבדיקה.';
    if(field==='page_uuid')message='SmartPay דחה את מזהה דף התשלום. בדוק שהדף שייך לאותו חשבון ובאותה סביבת סליקה.';
    else if(field)message='SmartPay דחה נתונים בבקשת התשלום. פרטי השדות זמינים למפעיל האתר לפי מזהה הבדיקה.';
    throw failure('SMARTPAY_CHECKOUT',message,provider);
  }
  let url;try{url=new URL(data.url);if(url.protocol!=='https:'||url.username||url.password)throw Error();}
  catch{throw failure('SMARTPAY_CHECKOUT_URL','SmartPay לא החזיר כתובת תשלום תקינה.',provider);}
  return {url:url.href};
}
export async function getChargeByOrder(orderId){
  const {http,data}=await call('/charges/get',{moreinfo1:orderId});
  // /charges/get returns a Transaction directly; charge callbacks may wrap it.
  const tx=data.transaction&&typeof data.transaction==='object'?data.transaction:data;
  const paid=http>=200&&http<300&&data.status==='succeeded'&&tx.operation_status==='succeeded';
  return {paid,failed:tx.operation_status==='failed',amount:Number(tx.amount),transactionId:tx.tuid||data.transaction_id||tx.id||null,orderId:tx.moreinfo1};
}
