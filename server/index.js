// index.js — API for the cube solver: checkout sessions, charges, unlock tokens, restore.
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as smartpay from './smartpay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));   // serves index.html

const SECRET = process.env.UNLOCK_SECRET || 'dev-secret';
const PRICES = { single: +(process.env.PRICE_SINGLE || 7.90), unlimited: +(process.env.PRICE_UNLIMITED || 24.90) };

// In-memory stores — replace with a DB (SQLite/Postgres) before launch.
const sessions = new Map();     // id -> {plan, cubeId, amount, createdAt}
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

app.post('/api/checkout/session', async (req, res) => {
  const { plan, cubeId, email } = req.body || {};
  if (!PRICES[plan]) return res.status(400).json({ error: 'תוכנית לא מוכרת' });
  const id = crypto.randomUUID();
  const amount = priceFor(plan, email);
  try {
    const sp = await smartpay.createSession({ amount, currency: 'ILS', description: plan === 'single' ? 'CubeSolve — פתרון אחד' : 'CubeSolve — ללא הגבלה', orderId: id });
    sessions.set(id, { plan, cubeId, amount, createdAt: Date.now() });
    res.json({ id, amount, clientToken: sp.clientToken });
  } catch (e) { res.status(502).json({ error: 'לא ניתן להתחיל תשלום כרגע' }); }
});

app.post('/api/checkout/charge', async (req, res) => {
  const { sessionId, paymentToken, email, cubeId } = req.body || {};
  const s = sessions.get(sessionId);
  if (!s) return res.status(400).json({ error: 'סשן תשלום לא נמצא' });
  if (!email) return res.status(400).json({ error: 'נדרש אימייל' });
  try {
    const r = await smartpay.charge({ paymentToken, amount: s.amount, currency: 'ILS', orderId: sessionId, email,
      description: s.plan === 'single' ? 'CubeSolve — פתרון אחד' : 'CubeSolve — ללא הגבלה' });
    if (!r.ok) return res.status(402).json({ error: 'התשלום לא אושר. בדוק את פרטי הכרטיס.' });
    const list = purchases.get(email) || []; list.push({ plan: s.plan, cubeId: cubeId || s.cubeId, txId: r.transactionId, at: Date.now() }); purchases.set(email, list);
    sessions.delete(sessionId);
    res.json({ unlock: unlockFor(s.plan, cubeId || s.cubeId) });
  } catch (e) { res.status(502).json({ error: 'שגיאה מול חברת הסליקה' }); }
});

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

app.listen(process.env.PORT || 3000, () => console.log('CubeSolve API on :' + (process.env.PORT || 3000)));
