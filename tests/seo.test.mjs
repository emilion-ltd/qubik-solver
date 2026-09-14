import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSEO} from '../server/seo.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('public metadata uses one absolute HTTPS canonical and share image',()=>{
  const seo=createSEO(html,'https://cube.example');
  assert.match(seo.html,/<link rel="canonical" href="https:\/\/cube.example\/">/);
  assert.match(seo.html,/property="og:image" content="https:\/\/cube.example\/icons\/icon-512.png"/);
  assert.ok(seo.robots.includes('Sitemap: https://cube.example/sitemap.xml'));
  assert.ok(seo.sitemap.includes('<loc>https://cube.example/</loc>'));
  assert.equal((seo.html.match(/<link rel="canonical"/g)||[]).length,1);
  for(const m of seo.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  assert.ok(seo.html.includes('<h1'));
  assert.ok(seo.html.includes('id="faq"'));
});
test('development origins are not advertised for indexing',()=>{
  for(const url of [undefined,'http://localhost:3000','https://localhost']){
    const seo=createSEO(html,url);
    assert.equal(seo.sitemap,null);
    assert.ok(seo.html.includes('noindex,nofollow'));
    assert.equal(seo.robots,'User-agent: *\nDisallow: /\n');
  }
});
test('reject production URLs containing paths or credentials',()=>{
  for(const url of ['https://cube.example/subpath','https://user:pass@cube.example','https://cube.example/?x=1'])
    assert.throws(()=>createSEO(html,url));
});
