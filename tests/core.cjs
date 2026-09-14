const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..');
const context = vm.createContext({});
const c = vm.runInContext(fs.readFileSync(path.join(root,'cube-core.js'),'utf8')+';CubeCore', context);
const solved = 'WWWWWWWWWRRRRRRRRRGGGGGGGGGYYYYYYYYYOOOOOOOOOBBBBBBBBB'.split('');
const corners = [[8,9,20],[6,18,38],[0,36,47],[2,45,11],[29,26,15],[27,44,24],[33,53,42],[35,17,51]];
let seed=2341;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
let state=solved.slice(), checks=0;
for(let n=0;n<300;n++){
  state=c.apply(state,c.MOVES[Object.keys(c.MOVES)[Math.floor(random()*18)]]);
  assert.equal(c.inspect(state).valid,true);checks++;
  for(const ids of corners) for(let d=1;d<=2;d++){
    const bad=state.slice();ids.forEach((i,k)=>bad[i]=state[ids[(k+d)%3]]);
    const r=c.inspect(bad);assert.equal(r.kind,'corner-twist');checks++;
    r.idx.forEach((i,k)=>bad[i]=r.fix[k]);
    assert.equal(c.inspect(bad).valid,true);checks++;
  }
  const bad=state.slice();[bad[5],bad[10]]=[bad[10],bad[5]];
  assert.equal(c.inspect(bad).kind,'edge-flip');checks++;
}
for(const bad of [null,[],Array(54).fill('?'),Array(54).fill('W'),solved.slice(1)]) assert.equal(c.inspect(bad).valid,false);
const mirrored=solved.slice();[mirrored[9],mirrored[20]]=[mirrored[20],mirrored[9]];
assert.equal(c.inspect(mirrored).kind,'input');
const swapped=solved.slice();[swapped[10],swapped[19]]=[swapped[19],swapped[10]];
assert.equal(c.inspect(swapped).kind,'parity');
for(const alg of ['', 'R', "R U R' U'", "F2 U L R' F2 L' R U F2", "R U2 B' L F2 D R2 B U' L2"]){
  const input=c.apply(solved,c.algPerm(alg)), result=c.solve(input);
  assert.ok(!result.error,result.error);
  let end=input;
  for(const move of result.steps.flatMap(s=>s.moves)) end=c.apply(end,c.MOVES[move]);
  assert.equal(end.join(''),solved.join(''));
}
for(const name of ['cube-core.js','solver-worker.js','pwa.js','sw.js']) new vm.Script(fs.readFileSync(path.join(root,name),'utf8'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
for(const icon of manifest.icons){
  const png=fs.readFileSync(path.join(root,icon.src));
  assert.equal(png.readUInt32BE(16),parseInt(icon.sizes));
  assert.equal(png.readUInt32BE(20),parseInt(icon.sizes));
}
console.log(checks+' invariant checks, malformed inputs, parity, chirality, 5 solver replays, JS syntax and icons passed.');
