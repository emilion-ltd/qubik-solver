(() => {
  const install=document.getElementById('install-app'), update=document.getElementById('update-app'), status=document.getElementById('pwa-status');
  let prompt=null, waiting=null, refreshing=false;
  const online=() => {
    status.hidden=navigator.onLine;
    status.textContent='אין חיבור לרשת. הזנה והדרכה לשכבה הראשונה זמינות לאחר טעינה ראשונה; המשך בתשלום ושחזור דורשים חיבור.';
  };
  online(); window.addEventListener('online',online); window.addEventListener('offline',online);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt=event; install.hidden=false; });
  install.onclick=async () => {
    if(!prompt) return;
    const current=prompt; prompt=null; install.hidden=true;
    try { await current.prompt(); await current.userChoice; } catch (_) {}
  };
  window.addEventListener('appinstalled', () => { install.hidden=true; prompt=null; });
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches && navigator.onLine) {
    status.hidden=false; status.textContent='להתקנה באייפון: פתח ב־Safari, לחץ על שיתוף ואז הוסף למסך הבית.';
  }
  if(!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if(refreshing) location.reload(); });
  navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).then(reg => {
    const ready=() => { if(reg.waiting && navigator.serviceWorker.controller) { waiting=reg.waiting; update.hidden=false; } };
    ready();
    document.addEventListener('visibilitychange',()=>{if(!document.hidden && navigator.onLine)reg.update().catch(()=>{});});
    reg.addEventListener('updatefound', () => {
      const installing=reg.installing;
      installing?.addEventListener('statechange',ready);
    });
  }).catch(() => { status.hidden=false; status.textContent='ההתקנה לשימוש ללא רשת לא הושלמה. אפשר להמשיך ברשת ולנסות שוב ברענון.'; });
  update.onclick=() => {
    if(!waiting) return;
    if(!confirm('העדכון ירענן את האפליקציה. במהלך פתרון, יש להזין מחדש את המצב הפיזי הנוכחי של הקובייה. לעדכן עכשיו?')) return;
    refreshing=true; waiting.postMessage('SKIP_WAITING');
  };
})();
