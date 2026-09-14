import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// File-backed SQLite. Keep DATA_DIR on a persistent volume when using containers.
export function openStore(directory) {
  const dir = path.resolve(directory);
  fs.mkdirSync(dir, {recursive:true, mode:0o700});
  const db = new DatabaseSync(path.join(dir, 'cubesolve.sqlite'));
  db.exec(`
    PRAGMA busy_timeout=5000;
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS purchases (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id),
      email TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS purchases_email ON purchases(email);
  `);
  const normalizeEmail = email => String(email || '').trim().toLowerCase();
  const read = id => {
    const row = db.prepare('SELECT data FROM sessions WHERE id=?').get(id);
    return row ? JSON.parse(row.data) : null;
  };
  return {
    getSession: read,
    createSession(id, data) {
      db.prepare('INSERT INTO sessions(id,data) VALUES(?,?)').run(id, JSON.stringify({...data, email:normalizeEmail(data.email)}));
    },
    purchasesFor(email) {
      return db.prepare('SELECT data FROM purchases WHERE email=? ORDER BY rowid DESC').all(normalizeEmail(email)).map(row=>JSON.parse(row.data));
    },
    markPaid(id, txId, unlock) {
      // One transaction makes payment confirmation and the recoverable purchase inseparable.
      // A duplicate webhook/poll cannot create a second purchase or extend its expiry.
      db.exec('BEGIN IMMEDIATE');
      try {
        const session = read(id);
        if (!session || session.status === 'paid') { db.exec('COMMIT'); return session; }
        session.status='paid'; session.txId=txId || null; session.unlock=unlock; session.paidAt=Date.now();
        db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(session),id);
        const purchase={plan:session.plan,cubeId:session.cubeId,txId:session.txId,at:session.paidAt,unlock};
        db.prepare('INSERT INTO purchases(session_id,email,data) VALUES(?,?,?)').run(id,session.email,JSON.stringify(purchase));
        db.exec('COMMIT');
        return session;
      } catch(error) { db.exec('ROLLBACK'); throw error; }
    },
    signingSecret(configured) {
      // Persist the first key so restarts without an env override preserve tokens.
      const candidate=configured || crypto.randomBytes(32).toString('hex');
      db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('unlock_secret',?)").run(candidate);
      const saved=db.prepare("SELECT value FROM settings WHERE key='unlock_secret'").get().value;
      if(configured && configured!==saved) throw new Error('UNLOCK_SECRET differs from the persisted key; explicit key migration is required.');
      return saved;
    },
    close() { db.close(); }
  };
}
