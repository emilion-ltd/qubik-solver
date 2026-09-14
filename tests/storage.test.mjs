import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/storage.js';

const moduleURL=new URL('../server/storage.js',import.meta.url).href;
test('paid and pending sessions, purchases and signing key survive a process exit', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'cube-restart-'));
  try {
    const child=spawnSync(process.execPath,['--input-type=module','-e',`
      import {openStore} from ${JSON.stringify(moduleURL)};
      const s=openStore(${JSON.stringify(dir)});
      s.signingSecret('test-secret');
      s.createSession('paid',{plan:'single',cubeId:'cube1',email:' Buyer@Example.com ',status:'pending'});
      s.createSession('pending',{plan:'unlimited',email:'buyer@example.com',status:'pending'});
      s.markPaid('paid','tx1',{plan:'single',cubeId:'cube1',exp:123456,token:'signed'});
      process.exit(0); // Deliberately no close/checkpoint: recover committed WAL on restart.
    `],{encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);
    const s=openStore(dir);
    try {
      assert.equal(s.signingSecret(),'test-secret');
      assert.throws(()=>s.signingSecret('changed-key'),/migration/);
      assert.equal(s.getSession('paid').status,'paid');
      assert.equal(s.getSession('pending').status,'pending');
      const list=s.purchasesFor(' BUYER@example.COM ');
      assert.equal(list.length,1);
      assert.equal(list[0].unlock.token,'signed');
      assert.equal(list[0].unlock.exp,123456);
      s.markPaid('paid','tx1',{token:'must-not-replace',exp:999999});
      assert.equal(s.purchasesFor('buyer@example.com').length,1);
      assert.equal(s.getSession('paid').unlock.token,'signed');
      assert.equal(s.markPaid('missing','tx',{}),null);
    } finally {s.close();}
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('purchase insertion failure rolls payment status back atomically', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'cube-rollback-'));
  const s=openStore(dir), raw=new DatabaseSync(path.join(dir,'cubesolve.sqlite'));
  try {
    s.createSession('id',{plan:'single',cubeId:'cube',email:'a@example.com',status:'pending'});
    raw.exec("CREATE TRIGGER fail_purchase BEFORE INSERT ON purchases BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
    assert.throws(()=>s.markPaid('id','tx',{token:'abc'}),/test rollback/);
    assert.equal(s.getSession('id').status,'pending');
    assert.equal(s.purchasesFor('a@example.com').length,0);
    raw.exec('DROP TRIGGER fail_purchase');
    s.markPaid('id','tx',{token:'abc'});
    assert.equal(s.purchasesFor('a@example.com').length,1);
  } finally {raw.close();s.close();rmSync(dir,{recursive:true,force:true});}
});
test('independent connections do not duplicate purchases', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'cube-connections-'));
  const a=openStore(dir),b=openStore(dir);
  try {
    a.createSession('id',{email:'a@example.com',plan:'unlimited',status:'pending'});
    a.markPaid('id','tx',{token:'first'});
    b.markPaid('id','tx',{token:'second'});
    assert.equal(b.purchasesFor('a@example.com').length,1);
    assert.equal(b.getSession('id').unlock.token,'first');
  } finally {a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
test('corrupt database is never silently replaced with an empty database', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'cube-corrupt-'));
  try {
    writeFileSync(path.join(dir,'cubesolve.sqlite'),'not a sqlite database');
    assert.throws(()=>openStore(dir));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
