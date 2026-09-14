const CubeCore = (() => {
  // ---------- geometry: x right, y up, z toward viewer ----------
  const POS = [], INDEX = new Map();
  const key = (p, n) => p.join(',') + '|' + n.join(',');
  for (let f = 0; f < 6; f++) for (let i = 0; i < 9; i++) {
    const r = Math.floor(i / 3), c = i % 3; let p, n;
    if (f === 0) { p = [-1 + c, 1, -1 + r]; n = [0, 1, 0]; }
    else if (f === 1) { p = [1, 1 - r, 1 - c]; n = [1, 0, 0]; }
    else if (f === 2) { p = [-1 + c, 1 - r, 1]; n = [0, 0, 1]; }
    else if (f === 3) { p = [-1 + c, -1, 1 - r]; n = [0, -1, 0]; }
    else if (f === 4) { p = [-1, 1 - r, -1 + c]; n = [-1, 0, 0]; }
    else { p = [1 - c, 1 - r, -1]; n = [0, 0, -1]; }
    POS.push({ p, n }); INDEX.set(key(p, n), POS.length - 1);
  }
  function rot(v, axis, k) {
    let [x, y, z] = v;
    for (let i = 0; i < ((k % 4) + 4) % 4; i++) {
      if (axis === 0) [x, y, z] = [x, -z, y];
      else if (axis === 1) [x, y, z] = [z, y, -x];
      else [x, y, z] = [-y, x, z];
    }
    return [x, y, z];
  }
  const FACE_AXIS = { U: [1, 1], D: [1, -1], R: [0, 1], L: [0, -1], F: [2, 1], B: [2, -1] };
  function permFor(axis, sign, k, whole) {
    const perm = Array.from({ length: 54 }, (_, i) => i);
    POS.forEach(({ p, n }, i) => {
      if (whole || p[axis] === sign) perm[INDEX.get(key(rot(p, axis, k), rot(n, axis, k)))] = i;
    });
    return perm;
  }
  const MOVES = {};
  for (const f in FACE_AXIS) {
    const [a, s] = FACE_AXIS[f];
    MOVES[f] = permFor(a, s, -s); MOVES[f + "'"] = permFor(a, s, s); MOVES[f + '2'] = permFor(a, s, 2);
  }
  const compose = (p1, p2) => p2.map(j => p1[j]);
  const algPerm = alg => alg.split(/\s+/).filter(Boolean).reduce((p, m) => compose(p, MOVES[m]), Array.from({ length: 54 }, (_, i) => i));
  function apply(s, perm) { const o = new Array(54); for (let j = 0; j < 54; j++) o[j] = s[perm[j]]; return o; }
  const inverse = m => m.endsWith("'") ? m[0] : (m.endsWith('2') ? m : m + "'");
  const faceOf = i => Math.floor(i / 9);
  const stickersAt = p => { const out = []; POS.forEach(({ p: q }, i) => { if (q[0] === p[0] && q[1] === p[1] && q[2] === p[2]) out.push(i); }); return out; };

  // ---------- validation ----------
  function centers(s) { return [s[4], s[13], s[22], s[31], s[40], s[49]]; }
  function validate(s) {
    // s: array of 54 color chars
    const errs = [];
    if (!Array.isArray(s) || s.length !== 54 || Array.from(s).some(c => !'WYGBRO'.includes(c) || typeof c !== 'string' || c.length !== 1)) return ['יש להזין בדיוק 54 משבצות בצבעי הקובייה.'];
    const heb = c => HEB[c] || c;
    const cnt = {}; s.forEach(c => cnt[c] = (cnt[c] || 0) + 1);
    const C = centers(s);
    if (new Set(C).size !== 6) errs.push('שישה מרכזים חייבים להיות בצבעים שונים');
    for (const c of C) if (cnt[c] !== 9) errs.push(`הצבע ה${heb(c)} מופיע ${cnt[c] || 0} פעמים במקום 9`);
    if (errs.length) return errs;
    // piece sets
    const want = new Set(), got = new Set();
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const idx = stickersAt([x, y, z]); if (idx.length < 2) continue;
      want.add(idx.map(i => C[faceOf(i)]).sort().join(''));
      got.add(idx.map(i => s[i]).sort().join(''));
    }
    for (const w of want) if (!got.has(w)) errs.push('חסרה חתיכה: ' + w.split('').map(heb).join('-'));
    if (errs.length) errs.push('בדרך כלל זה קורה כשפאה שלמה הוזנה מסובבת או בהיפוך — בדוק במיוחד את הפאה האחורית, העליונה והתחתונה מול סדר הצילום.');
    return errs;
  }


  // Ordered facelets define chirality as well as each piece's orientation.
  const CORNERS = [[8,9,20],[6,18,38],[0,36,47],[2,45,11],[29,26,15],[27,44,24],[33,53,42],[35,17,51]];
  const EDGES = [[5,10],[7,19],[3,37],[1,46],[32,16],[28,25],[30,43],[34,52],[23,12],[21,41],[50,39],[48,14]];
  function inspect(s) {
    const errors = validate(s);
    if (errors.length) return { valid:false, kind:'input', text:errors.join(' · '), idx:[] };
    const C = centers(s), cp=[], co=[], ep=[], eo=[];
    const homes = list => list.map(ids => ids.map(i => C[faceOf(i)]));
    const ch=homes(CORNERS), eh=homes(EDGES);
    for (const ids of CORNERS) {
      const colors=ids.map(i=>s[i]);
      const o=colors.findIndex(c=>c===C[0]||c===C[3]);
      const j=ch.findIndex(h=>o>=0 && colors[o]===h[0] && colors[(o+1)%3]===h[1] && colors[(o+2)%3]===h[2]);
      if(j<0 || cp.includes(j)) return {valid:false,kind:'input',idx:ids,text:'סדר הצבעים בפינה אינו אפשרי. השווה את המשבצות המסומנות לקובייה ובדוק את כיוון הפאות בצילום.'};
      cp.push(j);co.push(o);
    }
    for(const ids of EDGES) {
      const colors=ids.map(i=>s[i]);
      const j=eh.findIndex(h=>h.every(c=>colors.includes(c)));
      if(j<0 || ep.includes(j)) return {valid:false,kind:'input',idx:ids,text:'הוזן קצה חסר או כפול. בדוק את הצבעים מול הקובייה.'};
      ep.push(j);eo.push(colors[0]===eh[j][0]?0:1);
    }
    const parity=p=>p.reduce((n,v,i)=>n+p.slice(i+1).filter(w=>v>w).length,0)%2;
    const twist=co.reduce((a,b)=>a+b,0)%3, flip=eo.reduce((a,b)=>a+b,0)%2, swap=parity(cp)!==parity(ep);
    const issues=[];
    if(twist) issues.push('סכום כיווני הפינות אינו תקין — ייתכן שפינה סובבה במקומה');
    if(flip) issues.push('כיוון הקצוות אינו תקין — ייתכן שקצה הורכב הפוך');
    if(swap) issues.push('סדר החלקים אינו תקין — ייתכן ששני חלקים הוחלפו');
    if(!issues.length) return {valid:true,cp,co,ep,eo};
    const result={valid:false,kind:issues.length>1?'multiple':twist?'corner-twist':flip?'edge-flip':'parity',idx:[],
      text:issues.join('. ')+'. קודם בדוק שכל הצבעים והכיוון של כל פאה הוזנו נכון. מצב זה אינו מתקבל מסיבובי שכבות רגילים.'};
    if(twist && !flip && !swap) {
      const home=cp.every((v,i)=>v===i)&&ep.every((v,i)=>v===i)&&eo.every(v=>v===0);
      const nonzero=co.map((v,i)=>v?i:-1).filter(i=>i>=0);
      const slot=home&&nonzero.length===1?nonzero[0]:0;
      const idx=CORNERS[slot], current=idx.map(i=>s[i]);
      const fix=idx.map((_,k)=>current[(k+twist)%3]);
      const faces=['למעלה','ימינה','קדימה','למטה','שמאלה','אחורה'];
      result.idx=idx;result.fix=fix;
      result.text+=' אי אפשר לדעת בוודאות איזו פינה סובבה במקור. לאחר אימות ההזנה, אפשר לתקן את כיוון הפינה המסומנת כדי להחזיר את הקובייה למצב פתיר.';
      result.text+=' החזק לבן למעלה וירוק מולך. הפינה המסומנת בצבעים '+current.map(c=>HEB[c]).join('–')+
        '. סובב רק את הפינה במקומה כך שיתקבל: '+idx.map((i,k)=>faces[faceOf(i)]+': '+HEB[fix[k]]).join(' · ')+
        '. אין מדובר בסיבוב שכבה. אם החלק אינו מסתובב בקלות, אל תפעיל כוח; היעזר בהוראות היצרן. רק לאחר תיקון הקובייה לחץ על אישור.';
    } else result.text+=' לא ניתן לזהות בוודאות את החלק ששונה. תקן את ההזנה או בדוק את הרכבת הקובייה לפי הוראות היצרן, ואז צלם מחדש.';
    return result;
  }
  // ---------- solver ----------
  const ROT = { F: 'R', R: 'B', B: 'L', L: 'F', U: 'U', D: 'D' };
  const rotateAlg = (alg, k) => { for (let i = 0; i < k; i++) alg = alg.split(' ').map(m => ROT[m[0]] + m.slice(1)).join(' '); return alg; };
  const macro = (label, alg, group) => ({ label, alg, group, perm: algPerm(alg), moves: alg.split(' ') });
  const U_MACROS = [macro('U', 'U', 'U'), macro("U'", "U'", 'U'), macro('U2', 'U2', 'U')];
  const BASIC = Object.keys(MOVES).map(m => macro(m, m, m[0]));

  function makeGoal(pairs) { return s => { for (const [i, c] of pairs) if (s[i] !== c) return false; return true; }; }

  function dfsFirst(s, macros, goal, depth, path, last) {
    if (goal(s)) return path;
    if (depth === 0) return null;
    for (const m of macros) {
      if (last && m.group === last.group) continue;
      const r = dfsFirst(apply(s, m.perm), macros, goal, depth - 1, path.concat(m), m);
      if (r) return r;
    }
    return null;
  }
  function dfsAll(s, macros, goal, depth, path, last, out) {
    if (goal(s)) { out.push(path); return; }
    if (depth === 0) return;
    for (const m of macros) {
      if (last && m.group === last.group && m.group === 'U') continue;
      dfsAll(apply(s, m.perm), macros, goal, depth - 1, path.concat(m), m, out);
    }
  }
  function search(s, macros, goal, depth) {
    if (macros === BASIC) return dfsFirst(s, macros, goal, depth, [], null);
    const out = []; dfsAll(s, macros, goal, depth, [], null, out);
    if (!out.length) return null;
    return out.reduce((a, b) => (b.reduce((n, m) => n + m.moves.length, 0) < a.reduce((n, m) => n + m.moves.length, 0) ? b : a));
  }
  function solveGoal(s, goal, macros, maxd) {
    for (let d = 0; d <= maxd; d++) { const r = search(s, macros, goal, d); if (r) return r; }
    return null;
  }

  const HEB = { W: 'לבן', Y: 'צהוב', G: 'ירוק', B: 'כחול', R: 'אדום', O: 'כתום' };

  function solve(initial, opts = {}) {
    // initial: 54 chars, any color letters; returns {steps:[{phase,title,desc,alg,moves}]} or {error}
    const check = inspect(initial);
    if (!check.valid) return { error: check.text };
    let s = initial.slice();
    const C = centers(s);
    const colorName = c => HEB[c] || c;
    const pairsFor = positions => { const out = []; for (const p of positions) for (const i of stickersAt(p)) out.push([i, C[faceOf(i)]]); return out; };
    const pieceName = p => stickersAt(p).map(i => C[faceOf(i)]).sort((a, b) => 'WYGBRO'.indexOf(a) - 'WYGBRO'.indexOf(b)).map(colorName).join('-');
    const steps = [];
    const record = (phase, title, desc, algs) => steps.push({ phase, title, desc, alg: algs.map(m => m.label).join(' , '), moves: algs.flatMap(m => m.moves) });
    const done = [];
    function solvePieces(positions, macros, maxd, phase, title, descFn) {
      let remaining = positions.slice();
      while (remaining.length) {
        let found = null;
        for (let d = 0; d <= maxd && !found; d++) for (const p of remaining) {
          const r = search(s, macros, makeGoal(pairsFor(done.concat([p]))), d);
          if (r) { found = [p, r]; break; }
        }
        if (!found) throw new Error('phase ' + phase);
        const [p, r] = found;
        for (const m of r) s = apply(s, m.perm);
        record(phase, title, descFn(p), r);
        done.push(p); remaining = remaining.filter(q => q !== p);
      }
    }
    try {
      // 1. white (D) cross
      solvePieces([[0, -1, 1], [1, -1, 0], [0, -1, -1], [-1, -1, 0]], BASIC, 6, 1, 'הצלב ה' + colorName(C[3]),
        p => `הכנס את הקצה ${pieceName(p)} למקומו: ${colorName(C[3])} למטה, והצבע השני מול המרכז שלו.`);
      // 2. D corners
      const cm = U_MACROS.slice();
      for (let k = 0; k < 4; k++) {
        const base = rotateAlg("R U R' U'", k);
        for (let n = 1; n <= 5; n++) cm.push(macro('(' + base + ')×' + n, Array(n).fill(base).join(' '), 'slot' + k));
        const alt = rotateAlg("R U2 R' U' R U R'", k); cm.push(macro(alt, alt, 'slot' + k));
      }
      solvePieces([[1, -1, 1], [-1, -1, 1], [1, -1, -1], [-1, -1, -1]], cm, 3, 2, 'פינות השכבה הראשונה',
        p => `הכנס את הפינה ${pieceName(p)} למקומה: מביאים אותה מעל המקום שלה ומבצעים R U R' U' עד שהיא נכנסת (או הגרסה הקצרה R U2 R' U' R U R' כשהצבע התחתון פונה למעלה). האותיות משתנות לפי הפינה כי ממשיכים להחזיק את הקוביה באותה אחיזה.`);
      // 3. middle layer
      const mm = U_MACROS.slice();
      for (let k = 0; k < 4; k++) {
        const r = rotateAlg("U R U' R' U' F' U F", k), l = rotateAlg("U' L' U L U F U' F'", k);
        mm.push(macro('הכנסה ימינה: ' + r, r, 'mid' + k)); mm.push(macro('הכנסה שמאלה: ' + l, l, 'mid' + k));
      }
      solvePieces([[1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1]], mm, 3, 3, 'השכבה השנייה',
        p => `הכנס את הקצה ${pieceName(p)} למקומו בשכבה האמצעית: קודם מיישרים אותו למעלה מול המרכז התואם, ואז אלגוריתם הכנסה ימינה (U R U' R' U' F' U F) או שמאלה (U' L' U L U F U' F'), עם האותיות מותאמות לפאה שמולה עומד הקצה.`);
      // 4. top cross (orientation)
      const topEdges = [], topCorners = [];
      POS.forEach(({ p, n }, i) => { if (n[1] === 1) { if ((p[0] === 0) !== (p[2] === 0)) topEdges.push(i); else if (p[0] !== 0 && p[2] !== 0) topCorners.push(i); } });
      const top = colorName(C[0]);
      let r = solveGoal(s, st => topEdges.every(i => st[i] === C[0]), U_MACROS.concat([macro("F R U R' U' F'", "F R U R' U' F'", 'yc')]), 5);
      if (!r) throw new Error('phase 4');
      for (const m of r) s = apply(s, m.perm);
      if (r.length) record(4, 'הצלב ה' + top, `האלגוריתם F R U R' U' F' הופך קצוות ${top}ים כלפי מעלה. חוזרים עליו (עם סיבובי U ביניהם לכיוון הצורה) עד שנוצר צלב.`, r);
      // 5. top face
      r = solveGoal(s, st => topCorners.every(i => st[i] === C[0]), U_MACROS.concat([macro("R U R' U R U2 R'", "R U R' U R U2 R'", 'sune')]), 6);
      if (!r) throw new Error('phase 5');
      for (const m of r) s = apply(s, m.perm);
      if (r.length) record(5, 'הפאה ה' + top + 'ה', `האלגוריתם R U R' U R U2 R' (Sune) מסובב פינות. חוזרים עליו, עם סיבובי U ביניהם, עד שכל הפאה העליונה ${top}ה.`, r);
      // 6. corner permutation (up to U)
      const cornerGoal = makeGoal(pairsFor([[1, 1, 1], [-1, 1, 1], [1, 1, -1], [-1, 1, -1]]));
      const placed = st => { for (let k = 0; k < 4; k++) { if (cornerGoal(st)) return true; st = apply(st, MOVES.U); } return false; };
      r = solveGoal(s, placed, U_MACROS.concat([macro("R' F R' B2 R F' R' B2 R2", "R' F R' B2 R F' R' B2 R2", 'cp'), macro("R2 B2 R F R' B2 R F' R", "R2 B2 R F R' B2 R F' R", 'cp')]), 6);
      if (!r) throw new Error('phase 6');
      for (const m of r) s = apply(s, m.perm);
      if (r.length) record(6, 'סידור הפינות העליונות', `האלגוריתם R' F R' B2 R F' R' B2 R2 מסובב שלוש פינות עליונות במעגל בלי לקלקל את הפאה העליונה (הגרסה ההפוכה: R2 B2 R F R' B2 R F' R). אחריו כל פינה יושבת בין שני הצבעים שלה.`, r);
      // 7. edges + final U
      const solvedGoal = makeGoal(Array.from({ length: 54 }, (_, i) => [i, C[faceOf(i)]]));
      r = solveGoal(s, solvedGoal, U_MACROS.concat([macro("F2 U L R' F2 L' R U F2", "F2 U L R' F2 L' R U F2", 'ep'), macro("F2 U' L R' F2 L' R U' F2", "F2 U' L R' F2 L' R U' F2", 'ep')]), 6);
      if (!r) throw new Error('phase 7');
      for (const m of r) s = apply(s, m.perm);
      if (r.length) record(7, 'סידור הקצוות העליונים', `האלגוריתם F2 U L R' F2 L' R U F2 מסובב שלושה קצוות עליונים במעגל (הגרסה עם U' בכיוון ההפוך). אחריו נשאר רק ליישר את השכבה העליונה.`, r);
      return { steps, total: steps.reduce((n, st) => n + st.moves.length, 0) };
    } catch (e) {
      return { error: 'המצב שהוזן לא ניתן לפתרון — בדרך כלל מדבקה אחת או שתיים זוהו לא נכון (הצבעים הדומים: אדום/כתום, לבן/צהוב). השווה את התרשים לקוביה שלך ותקן את המשבצות השגויות, או צלם מחדש בתאורה טובה.' };
    }
  }

  return { POS, INDEX, MOVES, FACE_AXIS, apply, algPerm, inverse, validate, solve, inspect, diagnose: s => { const r = inspect(s); return r.valid ? null : r; }, centers, key };
})();

