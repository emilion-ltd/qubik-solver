# CubeSolve — צלם את הקוביה, ותפתור

אב־טיפוס עובד: סורק מצלמה → אישור צבעים → פותר בדפדפן → הדרכה בתלת־ממד → פייוול עם SmartPay Hosted Fields.

## מבנה
- `index.html` — כל האפליקציה (סורק, פותר, תלת־ממד, פייוול). קובץ אחד, בלי תלויות.
- `server/index.js` — API: יצירת סשן תשלום, חיוב, טוקן פתיחה חתום, שחזור רכישה.
- `server/smartpay.js` — **הקובץ היחיד שמדבר עם SmartPay.** יש בו 2 פונקציות עם TODO.
- ב־`index.html`, האובייקט `SmartPayClient` — **הקובץ היחיד בצד הלקוח שמדבר עם ה־SDK.** 4 TODO.

## הרצה
```
cd server && npm i && cp .env.example .env && npm start
```
ואז http://localhost:3000. המצלמה עובדת רק ב־HTTPS (או localhost). בלי הגדרות SmartPay הפייוול נפתח במצב פיתוח עם כפתור "דמה תשלום".

## מה נשאר לחבר (מהתיעוד של SmartPay)
1. `CONFIG.smartpay.sdkUrl` + `publicKey` ב־index.html.
2. `SmartPayClient.mount / tokenize / canWallet / walletPay` — 4 TODO.
3. `server/smartpay.js` — `createSession` (אם ה־SDK צריך טוקן לקוח) ו־`charge` (חיוב עם הטוקן החד־פעמי).
4. להחליף את ה־Map בזיכרון ב־DB, ולהוסיף webhook אם SmartPay שולחת אישור אסינכרוני.

## היגיון הפייוול
- שלבים 1–2 (צלב + פינות לבנות) חינם; הפייוול נפתח בכניסה לשלב 3, עם ספירת הסיבובים שנותרו והקוביה מטושטשת מאחור.
- שני מחירים: פתרון אחד (₪7.90, לקוביה הזו, 7 ימים) / ללא הגבלה (₪24.90). ברירת מחדל: ללא הגבלה.
- מי שקנה פתרון אחד רואה בפעם הבאה מחיר שדרוג של ההפרש בלבד.
- אירועים ל־analytics יוצאים דרך `CONFIG.track` (paywall_view, plan_select, pay_success, pay_fail, paywall_dismiss…).
- נטישה בפייוול: לחבר את `paywall_dismiss` + האימייל/טלפון ל־Doali להודעת וואטסאפ עם קוד הנחה.
