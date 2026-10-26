import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { openDb } from './lib/db.js';
import { settle } from './lib/settle.js';
import { isDate, today, addDays, endDate, daysBetween } from './lib/dates.js';

const PRESETS = {
  steps: { metric: 'Steps', unit: 'steps' },
  calories: { metric: 'Calories burned', unit: 'kcal' },
  workout: { metric: 'Workout minutes', unit: 'min' },
  distance: { metric: 'Distance', unit: 'km' },
};
const CURRENCIES = ['₹', '$', '€', '£'];
const PERIODS = ['week', 'month', 'year'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

const hashPw = (pw) => { const s = randomBytes(16); return s.toString('hex') + ':' + scryptSync(pw, s, 32).toString('hex'); };
const checkPw = (pw, stored) => {
  const [s, h] = stored.split(':');
  const a = scryptSync(pw, Buffer.from(s, 'hex'), 32), b = Buffer.from(h, 'hex');
  return timingSafeEqual(a, b);
};
const money = (v) => Math.round(Number(v) * 100);   // 12.5 -> 1250
const hundredths = (v) => Math.round(Number(v) * 100);

export function createApp({ dbPath = './data/fitpot.db', now = today } = {}) {
  const db = openDb(dbPath);
  const q = (sql) => db.prepare(sql);

  const user = (req) => {
    const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
    const row = m && q('SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(m[1]);
    if (!row) throw new HttpError(401, 'Please log in');
    return row;
  };
  const newSession = (id) => {
    const token = randomBytes(24).toString('hex');
    q('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, id);
    return token;
  };

  const status = (c) => {
    const t = now();
    if (c.finalized_at) return 'settled';
    if (t < c.start) return 'upcoming';
    if (t <= c.end) return 'active';
    return 'ended';
  };

  function getChallenge(id, uid) {
    const c = q('SELECT * FROM challenges WHERE id = ?').get(id);
    const me = c && q('SELECT paid FROM members WHERE challenge_id = ? AND user_id = ?').get(id, uid);
    if (!c || !me) throw new HttpError(404, 'Challenge not found');
    return c;
  }

  // Full picture of a challenge: standings + what would be paid out right now.
  function detail(c, uid) {
    const members = q(`
      SELECT m.user_id AS id, u.name, m.paid,
             COALESCE((SELECT SUM(value) FROM entries e WHERE e.challenge_id = m.challenge_id AND e.user_id = m.user_id), 0) AS total
      FROM members m JOIN users u ON u.id = m.user_id WHERE m.challenge_id = ? ORDER BY u.name`).all(c.id);
    const paid = members.filter((m) => m.paid);
    const s = settle({ members: paid.map(({ id, total }) => ({ id, total })), stake: c.stake, cutoff: c.cutoff, mode: c.share_mode });
    const res = new Map(s.results.map((r) => [r.id, r]));
    const sent = new Map(q('SELECT user_id, sent FROM payouts WHERE challenge_id = ?').all(c.id).map((p) => [p.user_id, p.sent]));
    const board = members.map((m) => ({
      id: m.id, name: m.name, paid: !!m.paid, total: m.total,
      ...(res.get(m.id) || { percentOfTop: null, qualified: null, bonus: 0, payout: 0, net: 0 }),
      sent: !!sent.get(m.id),
    })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const t = now();
    return {
      id: c.id, code: c.code, title: c.title, metric: c.metric, unit: c.unit, period: c.period,
      start: c.start, end: c.end, stake: c.stake, currency: c.currency, cutoff: c.cutoff,
      shareMode: c.share_mode, dailyMax: c.daily_max, payInfo: c.pay_info,
      status: status(c), joinable: t <= c.start, owner: c.owner_id, isOwner: c.owner_id === uid,
      daysLeft: Math.max(0, daysBetween(t, c.end) + 1), totalDays: daysBetween(c.start, c.end) + 1,
      pot: s.pot, threshold: s.threshold, top: s.top, forfeited: s.forfeited,
      board,
    };
  }

  const routes = [];
  const route = (method, pattern, fn) =>
    routes.push({ method, re: new RegExp('^' + pattern.replace(/:\w+/g, '(\\d+)') + '$'), fn });

  route('POST', '/api/register', (req, _p, body) => {
    const name = String(body.name || '').trim();
    if (!/^[\p{L}\p{N} _.-]{2,24}$/u.test(name)) throw bad('Name must be 2-24 letters/numbers');
    if (String(body.password || '').length < 6) throw bad('Password must be at least 6 characters');
    if (q('SELECT 1 FROM users WHERE name = ?').get(name)) throw new HttpError(409, 'That name is taken');
    const { lastInsertRowid } = q('INSERT INTO users (name, pass_hash) VALUES (?, ?)').run(name, hashPw(body.password));
    return { token: newSession(Number(lastInsertRowid)), name };
  });

  route('POST', '/api/login', (req, _p, body) => {
    const u = q('SELECT * FROM users WHERE name = ?').get(String(body.name || '').trim());
    if (!u || !checkPw(String(body.password || ''), u.pass_hash)) throw new HttpError(401, 'Wrong name or password');
    return { token: newSession(u.id), name: u.name };
  });

  route('GET', '/api/me', (req) => user(req));

  route('GET', '/api/challenges', (req) => {
    const u = user(req);
    const rows = q(`SELECT c.* FROM challenges c JOIN members m ON m.challenge_id = c.id
                    WHERE m.user_id = ? ORDER BY c.start DESC`).all(u.id);
    return rows.map((c) => {
      const d = detail(c, u.id);
      const mine = d.board.find((b) => b.id === u.id);
      return { id: d.id, title: d.title, status: d.status, start: d.start, end: d.end, stake: d.stake,
               currency: d.currency, metric: d.metric, unit: d.unit, pot: d.pot, members: d.board.length,
               myTotal: mine.total, myQualified: mine.qualified, myPaid: mine.paid };
    });
  });

  route('POST', '/api/challenges', (req, _p, body) => {
    const u = user(req);
    const title = String(body.title || '').trim();
    if (title.length < 3 || title.length > 60) throw bad('Title must be 3-60 characters');
    let metric, unit;
    if (PRESETS[body.preset]) ({ metric, unit } = PRESETS[body.preset]);
    else {
      metric = String(body.metric || '').trim(); unit = String(body.unit || '').trim();
      if (!metric || !unit || metric.length > 30 || unit.length > 12) throw bad('Give your custom metric a name and a unit');
    }
    if (!PERIODS.includes(body.period)) throw bad('Duration must be week, month or year');
    const start = body.start || now();
    if (!isDate(start)) throw bad('Invalid start date');
    if (start < addDays(now(), -1)) throw bad('Start date cannot be in the past');
    const stake = money(body.stake);
    if (!Number.isFinite(stake) || stake < 0 || stake > 100_000_000) throw bad('Invalid entry amount');
    const cutoff = Number(body.cutoff);
    if (!Number.isInteger(cutoff) || cutoff < 0 || cutoff > 100) throw bad('Cutoff must be a whole number from 0 to 100');
    const currency = CURRENCIES.includes(body.currency) ? body.currency : '₹';
    const shareMode = body.shareMode === 'equal' ? 'equal' : 'proportional';
    const dailyMax = body.dailyMax ? hundredths(body.dailyMax) : null;
    if (dailyMax !== null && !(dailyMax > 0)) throw bad('Invalid daily maximum');
    const end = endDate(start, body.period);
    const code = randomBytes(4).toString('hex').toUpperCase();
    const r = q(`INSERT INTO challenges (code, title, owner_id, metric, unit, period, start, end, stake, currency, cutoff, share_mode, daily_max, pay_info)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(code, title, u.id, metric, unit, body.period, start, end, stake, currency, cutoff, shareMode, dailyMax, String(body.payInfo || '').slice(0, 200));
    // The organiser holds the pot, so their own stake is trusted as paid.
    q('INSERT INTO members (challenge_id, user_id, paid) VALUES (?, ?, 1)').run(r.lastInsertRowid, u.id);
    return { id: Number(r.lastInsertRowid), code };
  });

  route('POST', '/api/join', (req, _p, body) => {
    const u = user(req);
    const c = q('SELECT * FROM challenges WHERE code = ?').get(String(body.code || '').trim().toUpperCase());
    if (!c) throw new HttpError(404, 'No challenge with that code');
    if (now() > c.start) throw bad('This challenge has already started - joining is closed');
    q('INSERT OR IGNORE INTO members (challenge_id, user_id, paid) VALUES (?, ?, 0)').run(c.id, u.id);
    return { id: c.id };
  });

  route('GET', '/api/challenges/:id', (req, [id]) => {
    const u = user(req);
    return detail(getChallenge(id, u.id), u.id);
  });

  route('GET', '/api/challenges/:id/entries', (req, [id]) => {
    const u = user(req);
    getChallenge(id, u.id);
    return q(`SELECT e.id, e.user_id AS userId, u.name, e.date, e.value, e.note FROM entries e
              JOIN users u ON u.id = e.user_id WHERE e.challenge_id = ? ORDER BY e.date DESC, e.id DESC LIMIT 200`).all(id);
  });

  route('POST', '/api/challenges/:id/entries', (req, [id], body) => {
    const u = user(req);
    const c = getChallenge(id, u.id);
    const me = q('SELECT paid FROM members WHERE challenge_id = ? AND user_id = ?').get(id, u.id);
    if (!me.paid) throw new HttpError(403, 'Your entry fee has not been confirmed yet - ask the organiser');
    if (c.finalized_at) throw bad('This challenge is settled');
    const date = body.date || now();
    if (!isDate(date)) throw bad('Invalid date');
    if (date < c.start || date > c.end) throw bad(`Date must be between ${c.start} and ${c.end}`);
    if (date > addDays(now(), 1)) throw bad('You cannot log the future');
    const value = hundredths(body.value);
    if (!Number.isFinite(value) || value <= 0 || value > 100_000_000) throw bad('Enter a positive number');
    if (c.daily_max) {
      const day = q('SELECT COALESCE(SUM(value),0) AS s FROM entries WHERE challenge_id=? AND user_id=? AND date=?').get(id, u.id, date).s;
      if (day + value > c.daily_max) throw bad(`Daily maximum for this challenge is ${c.daily_max / 100} ${c.unit}`);
    }
    q('INSERT INTO entries (challenge_id, user_id, date, value, note) VALUES (?,?,?,?,?)')
      .run(id, u.id, date, value, String(body.note || '').slice(0, 120));
    return { ok: true };
  });

  route('DELETE', '/api/entries/:id', (req, [id]) => {
    const u = user(req);
    const e = q('SELECT e.*, c.finalized_at, c.owner_id FROM entries e JOIN challenges c ON c.id = e.challenge_id WHERE e.id = ?').get(id);
    if (!e || (e.user_id !== u.id && e.owner_id !== u.id)) throw new HttpError(404, 'Entry not found');
    if (e.finalized_at) throw bad('This challenge is settled');
    q('DELETE FROM entries WHERE id = ?').run(id);
    return { ok: true };
  });

  route('POST', '/api/challenges/:id/members/:uid/paid', (req, [id, uid], body) => {
    const u = user(req);
    const c = getChallenge(id, u.id);
    if (c.owner_id !== u.id) throw new HttpError(403, 'Only the organiser can confirm payments');
    if (c.finalized_at) throw bad('This challenge is settled');
    q('UPDATE members SET paid = ? WHERE challenge_id = ? AND user_id = ?').run(body.paid ? 1 : 0, id, uid);
    return { ok: true };
  });

  route('POST', '/api/challenges/:id/finalize', (req, [id]) => {
    const u = user(req);
    const c = getChallenge(id, u.id);
    if (c.owner_id !== u.id) throw new HttpError(403, 'Only the organiser can settle');
    if (c.finalized_at) throw bad('Already settled');
    if (now() <= c.end) throw bad(`The challenge runs until ${c.end}`);
    const d = detail(c, u.id);
    db.exec('BEGIN');
    try {
      const ins = q('INSERT INTO payouts (challenge_id, user_id, amount, total, qualified, sent) VALUES (?,?,?,?,?,?)');
      for (const b of d.board.filter((x) => x.paid))
        ins.run(c.id, b.id, b.payout, b.total, b.qualified ? 1 : 0, b.id === c.owner_id ? 1 : 0);
      q("UPDATE challenges SET finalized_at = datetime('now') WHERE id = ?").run(c.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { ok: true };
  });

  route('POST', '/api/challenges/:id/payouts/:uid/sent', (req, [id, uid], body) => {
    const u = user(req);
    const c = getChallenge(id, u.id);
    if (c.owner_id !== u.id) throw new HttpError(403, 'Only the organiser marks payouts as sent');
    q('UPDATE payouts SET sent = ? WHERE challenge_id = ? AND user_id = ?').run(body.sent ? 1 : 0, id, uid);
    return { ok: true };
  });

  const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const r of routes) {
          const m = r.method === req.method && r.re.exec(url.pathname);
          if (!m) continue;
          let body = {};
          if (req.method !== 'GET' && req.method !== 'DELETE') {
            let raw = '';
            for await (const chunk of req) { raw += chunk; if (raw.length > 50_000) throw bad('Request too large'); }
            try { body = raw ? JSON.parse(raw) : {}; } catch { throw bad('Invalid JSON'); }
          }
          return send(200, r.fn(req, m.slice(1).map(Number), body));
        }
        throw new HttpError(404, 'Not found');
      }
      const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
      const file = join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC) || !TYPES[extname(file)]) throw new HttpError(404, 'Not found');
      send(200, await readFile(file), TYPES[extname(file)]);
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      if (e.code === 'ENOENT') return send(404, { error: 'Not found' });
      console.error(e);
      send(500, { error: 'Something went wrong' });
    }
  }

  return { server: createServer(handler), db };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp({ dbPath: process.env.DB_PATH || './data/fitpot.db' }).server.listen(port, () =>
    console.log(`FitPot running on http://localhost:${port}`));
}
