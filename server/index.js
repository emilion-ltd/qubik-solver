// index.js — API for the cube solver: hosted-checkout sessions, IPN, unlock tokens, restore.
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as smartpay from './smartpay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
// Serve only the public application, never server source, tests or repository files.
const publicRoot = path.join(__dirname, '..');
for (const file of ['index.html','cube-core.js','solver-worker.js','pwa.js','sw.js','manifest.webmanifest']) {
  app.get('/' + file, (req, res) => {
    if (file === 'sw.js') res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicRoot, file));
  });
}
app.get('/', (req, res) => res.sendFile(path.join(publicRoot, 'index.html')));
app.use('/icons', express.static(path.join(publicRoot, 'icons')));

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SECRET = process.env.UNLOCK_SECRET || 'dev-secret';
const PRICES = { single: +(process.env.PRICE_SINGLE || 7.90), unlimited: +(process.env.PRICE_UNLIMITED || 24.90) };

// In-memory stores — replace with a DB (SQLite/Postgres) before launch.
const sessions = new Map();     // id -> {plan, cubeId, email, amount, agorot, status, unlock?, txId?, createdAt}
const purchases = new Map();    // email -> [{plan, cubeId, txId, at}]

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token) {
  const [body, mac] = String(token).split('.');
  const good = crypto.createHmac('sha256', SECRET).update(body || '').digest('base64url');
  if (!mac || mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  return JSON.parse(Buffer.from(body, 'base64url').toString());
}
function unlockFor(plan, cubeId) {
  const exp = plan === 'single' ? Date.now() + 7 * 864e5 : 0;
  const payload = { plan, cubeId: plan === 'single' ? cubeId : null, exp };
  return { ...payload, token: sign(payload) };
}
function priceFor(plan, email) {
  // upgrade credit: someone who bought a single solve pays only the difference for unlimited
  const prior = (purchases.get(email) || []).some(p => p.plan === 'single');
  if (plan === 'unlimited' && prior) return +(PRICES.unlimited - PRICES.single).toFixed(2);
  return PRICES[plan];
}
function markPaid(id, txId) {
  const s = sessions.get(id);
  if (!s || s.status === 'paid') return s;
  s.status = 'paid'; s.txId = txId || null;
  const list = purchases.get(s.email) || [];
  list.push({ plan: s.plan, cubeId: s.cubeId, txId: s.txId, at: Date.now() });
  purchases.set(s.email, list);
  s.unlock = unlockFor(s.plan, s.cubeId);
  return s;
}
// The IPN carries no signature, so a payment counts only after SmartPay itself confirms it.
async function confirmWithSmartPay(id) {
  const s = sessions.get(id);
  if (!s || !smartpay.configured()) return null;
  if (s.status === 'paid') return s;
  try {
    const r = await smartpay.getChargeByOrder(id);
    if (r.paid && (r.amount === undefined || +r.amount === s.agorot)) return markPaid(id, r.transactionId);
  } catch (e) { console.error('smartpay verify failed:', e.message); }
  return s;
}

app.post('/api/config', (req, res) => res.json({ live: smartpay.configured(), prices: PRICES }));

app.post('/api/checkout/session', async (req, res) => {
  const { plan, cubeId, email } = req.body || {};
  if (!PRICES[plan]) return res.status(400).json({ error: 'תוכנית לא מוכרת' });
  if (!/.+@.+\..+/.test(email || '')) return res.status(400).json({ error: 'נדרש אימייל תקין' });
  if (!smartpay.configured()) return res.status(503).json({ error: 'הסליקה עדיין לא מוגדרת בשרת' });
  const id = crypto.randomUUID();
  const amount = priceFor(plan, email);
  const agorot = Math.round(amount * 100);
  try {
    const page = await smartpay.createCheckoutPage({
      amount: agorot, orderId: id, baseUrl: BASE_URL, email,
      description: plan === 'single' ? 'CubeSolve — פתרון אחד' : 'CubeSolve — ללא הגבלה',
    });
    sessions.set(id, { plan, cubeId, email, amount, agorot, status: 'pending', createdAt: Date.now() });
    res.json({ id, amount, payUrl: page.url });
  } catch (e) {
    console.error('checkout session failed:', e.message);
    res.status(502).json({ error: 'לא ניתן להתחיל תשלום כרגע' });
  }
});

// The client polls here after opening the payment iframe; verification happens
// against SmartPay directly, so this works even if the IPN never arrives.
app.post('/api/checkout/status', async (req, res) => {
  const { sessionId } = req.body || {};
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'סשן תשלום לא נמצא' });
  if (s.status !== 'paid') await confirmWithSmartPay(sessionId);
  if (s.status === 'paid') return res.json({ paid: true, unlock: s.unlock });
  res.json({ paid: false });
});

// IPN — SmartPay POSTs here on successful payment. Must answer 200 or it retries (5x).
app.post('/api/webhooks/smartpay', async (req, res) => {
  const orderId = req.body?.transaction?.moreinfo1;
  if (orderId && sessions.has(orderId) && req.body?.status === 'succeeded') {
    await confirmWithSmartPay(orderId);
  }
  res.sendStatus(200);
});

// Landing pages for the hosted checkout's redirect (rendered inside the iframe).
const payPage = (title, msg, signal) => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:'Segoe UI',Arial,sans-serif;background:#1c2230;color:#f3f1ea;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center"><div><h2>${title}</h2><p style="color:#9aa3b5">${msg}</p></div><script>try{parent.postMessage('smartpay:${signal}','*')}catch(e){}<\/script></body></html>`;
app.get('/pay/success', (req, res) => res.send(payPage('התשלום התקבל ✔', 'רק רגע, פותחים את הפתרון…', 'done')));
app.get('/pay/fail', (req, res) => res.send(payPage('התשלום לא אושר', 'אפשר לנסות שוב עם כרטיס אחר.', 'fail')));
app.get('/pay/cancel', (req, res) => res.send(payPage('התשלום בוטל', 'אפשר לחזור ולשלם בכל שלב.', 'cancel')));

app.post('/api/restore', (req, res) => {
  const { email, cubeId } = req.body || {};
  const list = purchases.get(email) || [];
  const unl = list.find(p => p.plan === 'unlimited');
  if (unl) return res.json({ unlock: unlockFor('unlimited') });
  const single = list.find(p => p.plan === 'single' && p.cubeId === cubeId && Date.now() - p.at < 7 * 864e5);
  if (single) return res.json({ unlock: unlockFor('single', cubeId) });
  res.status(404).json({ error: 'לא נמצאה רכישה' });
});

app.post('/api/unlock/verify', (req, res) => {
  const p = verify(req.body?.token);
  if (!p || (p.exp && Date.now() > p.exp)) return res.status(401).json({ ok: false });
  res.json({ ok: true, ...p });
});

app.listen(PORT, () => console.log(`CubeSolve API on :${PORT} (SmartPay ${smartpay.configured() ? 'LIVE — ' + (process.env.SMARTPAY_API_URL || 'sandbox') : 'not configured, dev mode'})`));
