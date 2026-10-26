import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './migrations.js';

export function openDb(path, log) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied) VALUES (?,?,?)').run(m.id, m.name, new Date().toISOString());
      db.exec('COMMIT');
      log?.info('migration applied', { id: m.id, name: m.name });
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}

/** Run fn inside a transaction; rolls back on throw. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
