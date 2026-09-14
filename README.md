# CubeSolve — צלם את הקוביה, ותפתור

אב־טיפוס עובד: סורק מצלמה → אישור צבעים → פותר בדפדפן → הדרכה בתלת־ממד → פייוול עם SmartPay Hosted Checkout Pages.

## מבנה
- `index.html` — כל האפליקציה (סורק, פותר, תלת־ממד, פייוול). קובץ אחד, בלי תלויות.
- `server/index.js` — API: יצירת סשן תשלום (checkout page), polling לסטטוס, IPN, טוקן פתיחה חתום, שחזור רכישה.
- `server/smartpay.js` — **הקובץ היחיד שמדבר עם SmartPay** (Basic auth, `/checkout/pages`, `/charges/get`).

## הרצה
```
cd server && npm i && cp .env.example .env && npm start
```
ואז http://localhost:3000. המצלמה עובדת רק ב־HTTPS (או localhost). בלי פרטי SmartPay ב־`.env` הפייוול נפתח במצב פיתוח עם כפתור "דמה תשלום".

## זרימת התשלום (SmartPay Hosted Checkout)
1. הלקוח מזין אימייל ולוחץ "מעבר לתשלום" → השרת יוצר checkout page ב־`POST /v1/checkout/pages` (סכום ב**אגורות**, `values.moreinfo1` = מזהה ההזמנה שלנו) ומחזיר `url`.
2. הדף המתארח נפתח ב־iframe בתוך הפייוול — פרטי כרטיס לא נוגעים בשרת שלנו.
3. בהצלחה SmartPay מפנה ל־`/pay/success` (בתוך ה־iframe, שולח postMessage) ושולחת IPN ל־`/api/webhooks/smartpay`.
4. הלקוח עושה polling ל־`/api/checkout/status`; השרת מאמת מול SmartPay ב־`/charges/get` לפי `moreinfo1` (לא סומכים על IPN לא חתום) ומחזיר טוקן פתיחה חתום. עובד גם אם ה־IPN לא הוגדר.

### הגדרה
ב־`server/.env`: `SMARTPAY_CUID`, `SMARTPAY_SECRET_KEY`, `SMARTPAY_PAGE_UUID` (מה־dashboard), `SMARTPAY_API_URL` (sandbox: `https://devapi.smartpay.co.il/v1`, production: `https://api.protected-payment.com/v1`), ו־`PUBLIC_BASE_URL` — הכתובת הציבורית של השרת (ה־IPN וה־redirect חוזרים אליה; ל־IPN בבדיקות מקומיות צריך tunnel כמו ngrok).

## מה נשאר
- להחליף את ה־Map בזיכרון ב־DB (רכישות נעלמות ב־restart).
- להוציא קבלה דרך Documents API (`/document/create`, `invoice_receipt`) אחרי תשלום מוצלח.
- לוודא שב־dashboard של SmartPay ה־IPN מופעל על ה־page.

## היגיון הפייוול
- שלבים 1–2 (צלב + פינות לבנות) חינם; הפייוול נפתח בכניסה לשלב 3, עם ספירת הסיבובים שנותרו והקוביה מטושטשת מאחור.
- שני מחירים: פתרון אחד (₪7.90, לקוביה הזו, 7 ימים) / ללא הגבלה (₪24.90). ברירת מחדל: ללא הגבלה.
- מי שקנה פתרון אחד רואה בפעם הבאה מחיר שדרוג של ההפרש בלבד.
- אירועים ל־analytics יוצאים דרך `CONFIG.track` (paywall_view, plan_select, pay_success, pay_fail, paywall_dismiss…).
- נטישה בפייוול: לחבר את `paywall_dismiss` + האימייל/טלפון ל־Doali להודעת וואטסאפ עם קוד הנחה.
