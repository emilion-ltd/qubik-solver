importScripts('./cube-core.js');
self.onmessage = event => {
  try { self.postMessage(CubeCore.solve(event.data)); }
  catch (error) { self.postMessage({error:'אירעה שגיאה בחישוב. בדוק את הצבעים ונסה שוב.'}); }
};
