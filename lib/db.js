import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass_hash TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS challenges (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      metric TEXT NOT NULL, unit TEXT NOT NULL, period TEXT NOT NULL,
      start TEXT NOT NULL, end TEXT NOT NULL,
      stake INTEGER NOT NULL, currency TEXT NOT NULL,
      cutoff INTEGER NOT NULL, share_mode TEXT NOT NULL,
      daily_max INTEGER, pay_info TEXT NOT NULL DEFAULT '',
      finalized_at TEXT, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS members (
      challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      paid INTEGER NOT NULL DEFAULT 0, joined TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (challenge_id, user_id));
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY,
      challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      date TEXT NOT NULL, value INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS entries_c ON entries(challenge_id, user_id);
    CREATE TABLE IF NOT EXISTS payouts (
      challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL, total INTEGER NOT NULL, qualified INTEGER NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (challenge_id, user_id));
  `);
  return db;
}
