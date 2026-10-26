// Append-only list of schema migrations. Never edit an applied migration; add a new one.
export const MIGRATIONS = [
  {
    id: 1,
    name: 'initial schema',
    sql: `
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT UNIQUE COLLATE NOCASE,
      pass_hash TEXT NOT NULL,
      created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT);

    CREATE TABLE sessions (
      id_hash TEXT PRIMARY KEY,                 -- sha256 of the cookie token; a DB leak can't be replayed
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created TEXT NOT NULL,
      expires_at TEXT NOT NULL);
    CREATE INDEX sessions_user ON sessions(user_id);

    CREATE TABLE reset_tokens (
      hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL, used_at TEXT);

    CREATE TABLE challenges (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      metric TEXT NOT NULL, unit TEXT NOT NULL,
      period TEXT NOT NULL CHECK (period IN ('week','month','year')),
      start TEXT NOT NULL, end TEXT NOT NULL,
      stake INTEGER NOT NULL CHECK (stake >= 0),
      currency TEXT NOT NULL,
      cutoff INTEGER NOT NULL CHECK (cutoff BETWEEN 0 AND 100),
      share_mode TEXT NOT NULL CHECK (share_mode IN ('proportional','equal')),
      daily_max INTEGER,
      pay_info TEXT NOT NULL DEFAULT '',
      finalized_at TEXT, cancelled_at TEXT,
      created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

    CREATE TABLE members (
      challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      joined TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (challenge_id, user_id));

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY,
      challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','confirmed','void')),
      provider TEXT NOT NULL DEFAULT 'manual', provider_ref TEXT,
      confirmed_at TEXT, confirmed_by INTEGER REFERENCES users(id),
      UNIQUE (challenge_id, user_id));

    CREATE TABLE entries (
      id INTEGER PRIMARY KEY,
      challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      value INTEGER NOT NULL CHECK (value > 0),   -- hundredths of the unit
      note TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX entries_c ON entries(challenge_id, user_id);

    CREATE TABLE entry_flags (
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (entry_id, user_id));

    CREATE TABLE payouts (
      challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK (kind IN ('payout','refund')),
      amount INTEGER NOT NULL, total INTEGER NOT NULL DEFAULT 0, qualified INTEGER NOT NULL DEFAULT 0,
      sent INTEGER NOT NULL DEFAULT 0, sent_at TEXT,
      PRIMARY KEY (challenge_id, user_id));

    -- Append-only money ledger from the point of view of the pot holder (the organiser).
    -- Balance = what the organiser should still be holding for this challenge.
    CREATE TABLE ledger (
      id INTEGER PRIMARY KEY,
      challenge_id INTEGER NOT NULL REFERENCES challenges(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK (kind IN ('stake_in','stake_reversal','payout_out','payout_reversal')),
      amount INTEGER NOT NULL,                    -- signed: money in is +, money out is -
      ref TEXT, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
    CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY,
      ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actor_id INTEGER, action TEXT NOT NULL, challenge_id INTEGER,
      meta TEXT NOT NULL DEFAULT '{}', ip TEXT);
    CREATE INDEX audit_c ON audit_log(challenge_id);
    CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
    CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
    `,
  },
];
