// smartpay.js — the only server file that talks to SmartPay (Star Networks).
// Flow: hosted checkout pages — we create a page session, the customer pays on
// SmartPay's page (iframe), SmartPay POSTs an IPN and we verify with /charges/get.
// Docs: https://docs.starltd.net/smartpay
const cfg = {
  apiUrl: (process.env.SMARTPAY_API_URL || 'https://devapi.smartpay.co.il/v1').replace(/\/+$/, ''),
  cuid: process.env.SMARTPAY_CUID?.trim(),
  secret: process.env.SMARTPAY_SECRET_KEY?.trim(),
  pageUuid: process.env.SMARTPAY_PAGE_UUID?.trim(),
};

export const missingConfiguration = () => [['SMARTPAY_CUID',cfg.cuid],['SMARTPAY_SECRET_KEY',cfg.secret],['SMARTPAY_PAGE_UUID',cfg.pageUuid]].filter(([,v])=>!v).map(([k])=>k);
export const configured = () => missingConfiguration().length === 0;
export const mode = () => cfg.apiUrl.includes('devapi.smartpay.co.il') ? 'sandbox' : 'production';

// Every SmartPay operation is POST + JSON with HTTP Basic auth (CUID:secret).
async function call(path, body) {
  const r = await fetch(cfg.apiUrl + path, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${cfg.cuid}:${cfg.secret}`).toString('base64'),
    },
    body: JSON.stringify(body || {}),
  });
  if (r.status === 401) throw Object.assign(new Error('פרטי SmartPay לא אושרו. בדוק התאמה בין סביבת הסליקה לפרטי החשבון.'),{status:502,code:'SMARTPAY_AUTH'}); // 401 body is plain text, not JSON
  const data = await r.json().catch(() => ({}));
  return { http: r.status, data };
}

/** Create a hosted checkout-page session. `amount` in agorot. Returns { url } to embed/redirect. */
export async function createCheckoutPage({ amount, orderId, baseUrl, email, description }) {
  const { http, data } = await call('/checkout/pages', {
    page_uuid: cfg.pageUuid,
    amount,
    currency: 'ils',
    success_url: `${baseUrl}/pay/success`,
    fail_url: `${baseUrl}/pay/fail`,
    cancel_url: `${baseUrl}/pay/cancel`,
    ipn_url: `${baseUrl}/api/webhooks/smartpay`,
    default_language: 'he',
    expired_at_minutes: 30,
    ...(email ? { customer_details: { email } } : {}),
    values: { moreinfo1: orderId, ...(description ? { extra_data: description } : {}) },
  });
  // HTTP 200 alone doesn't mean success — must also check the status field.
  if (http < 200 || http >= 300 || data.status !== 'succeeded' || !data.url) {
    throw Object.assign(new Error('SmartPay לא אישר יצירת דף תשלום. בדוק את הגדרת דף התשלום והחשבון.'),{status:502,code:'SMARTPAY_CHECKOUT'});
  }
  const url = new URL(data.url);
  if(url.protocol !== 'https:') throw new Error('Insecure checkout URL');
  return { url: url.href };
}

/** Look up the transaction for one of our orders (moreinfo1). Source of truth for "was it paid". */
export async function getChargeByOrder(orderId) {
  const { http, data } = await call('/charges/get', { moreinfo1: orderId });
  // A found-but-declined transaction comes back as HTTP 402 with operation_status "failed".
  const tx = data.transaction || {};
  const paid = http >= 200 && http < 300 && data.status === 'succeeded'
    && tx.operation_status === 'succeeded';
  return { paid, failed: tx.operation_status === 'failed', amount: Number(tx.amount), transactionId: data.transaction_id || tx.id || null, orderId: tx.moreinfo1 };
}
