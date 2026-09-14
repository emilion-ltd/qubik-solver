// smartpay.js — the only server file that talks to SmartPay. Fill the TODOs from the API docs.
const cfg = {
  apiUrl: process.env.SMARTPAY_API_URL,
  apiKey: process.env.SMARTPAY_API_KEY,
  terminalId: process.env.SMARTPAY_TERMINAL_ID,
};

/** Create a hosted-fields session / client token for the browser SDK (if the API requires one). */
export async function createSession({ amount, currency, description, orderId }) {
  if (!cfg.apiUrl) return { clientToken: null, dev: true };
  // TODO: replace with the real "create session / init hosted fields" request from the docs
  const r = await fetch(`${cfg.apiUrl}/…`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ terminal: cfg.terminalId, amount, currency, description, orderId }),
  });
  if (!r.ok) throw new Error('smartpay session failed: ' + (await r.text()));
  const data = await r.json();
  return { clientToken: data.token /* TODO field name */ };
}

/** Charge a one-time payment token produced by the hosted fields. Returns {ok, transactionId, raw}. */
export async function charge({ paymentToken, amount, currency, description, orderId, email }) {
  if (!cfg.apiUrl) throw new Error('SmartPay is not configured');
  // TODO: replace with the real "charge / sale with token" request from the docs
  const r = await fetch(`${cfg.apiUrl}/…`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ terminal: cfg.terminalId, token: paymentToken, amount, currency, description, orderId, email }),
  });
  const data = await r.json().catch(() => ({}));
  const ok = r.ok && /* TODO: success condition per docs, e.g. */ data.status === 'approved';
  return { ok, transactionId: data.transactionId /* TODO */, raw: data };
}
