import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { tx } from './db.js';
import { settle } from './settle.js';
import { isDate, today, addDays, endDate, daysBetween } from './dates.js';
import { HttpError, bad, forbidden, notFound } from './errors.js';
import { manualProvider } from './payments.js';

const PRESETS = {
  steps: { metric: 'Steps', unit: 'steps' },
  calories: { metric: 'Calories burned', unit: 'kcal' },
  workout: { metric: 'Workout minutes', unit: 'min' },
  distance: { metric: 'Distance', unit: 'km' },
};
const CURRENCIES = ['₹', '$', '€', '£'];
const PERIODS = ['week', 'month', 'year'];
const sha = (s) => createHash('sha256').update(s).digest('hex');
const minor = (v) => Math.round(Number(v) * 100);          // 12.5 -> 1250 (money and hundredths-of-unit)
const iso = (ms) => new Date(ms).toISOString();

const hashPw = (pw) => { const s = randomBytes(16); return `${s.toString('hex')}:${scryptSync(pw, s, 32).toString('hex')}`; };
const checkPw = (pw, stored) => {
  const [s, h] = String(stored).split(':');
  if (!s || !h) return false;
  return timingSafeEqual(scryptSync(pw, Buffer.from(s, 'hex'), 32), Buffer.from(h, 'hex'));
};
const DUMMY_HASH = hashPw('not-a-real-password');          // equalises timing for unknown users

export function createService({ db, config, mailer, now = today, clock = Date.now }) {
  const q = (sql) => db.prepare(sql);
  const provider = manualProvider;

  const audit = (actor, action, challengeId, meta = {}, ip = null) =>
    q('INSERT INTO audit_log (actor_id, action, challenge_id, meta, ip) VALUES (?,?,?,?,?)')
      .run(actor ?? null, action, challengeId ?? null, JSON.stringify(meta), ip);
  const ledger = (cid, uid, kind, amount, ref) => {
    if (amount) q('INSERT INTO ledger (challenge_id, user_id, kind, amount, ref) VALUES (?,?,?,?,?)').run(cid, uid, kind, amount, ref ?? null);
  };

  // ---------------------------------------------------------------- accounts
  function startSession(userId) {
    const token = randomBytes(32).toString('hex');
    const t = clock();
    q('INSERT INTO sessions (id_hash, user_id, created, expires_at) VALUES (?,?,?,?)')
      .run(sha(token), userId, iso(t), iso(t + config.sessionDays * 86_400_000));
    return { token, maxAgeSec: config.sessionDays * 86_400 };
  }
  const endSession = (token) => q('DELETE FROM sessions WHERE id_hash = ?').run(sha(token));
  const userForToken = (token) =>
    token ? q(`SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.id_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`).get(sha(token), iso(clock())) : null;

  function register({ name, email, password }, ip) {
    name = String(name || '').trim(); email = String(email || '').trim().toLowerCase();
    if (!/^[\p{L}\p{N} _.-]{2,24}$/u.test(name)) throw bad('Name must be 2-24 letters or numbers');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) throw bad('Enter a valid email address');
    if (String(password || '').length < 8) throw bad('Password must be at least 8 characters');
    if (password.length > 200) throw bad('Password too long');
    if (q('SELECT 1 FROM users WHERE name = ?').get(name)) throw new HttpError(409, 'That name is taken');
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'That email is already registered');
    const { lastInsertRowid } = q('INSERT INTO users (name, email, pass_hash) VALUES (?,?,?)').run(name, email, hashPw(password));
    audit(Number(lastInsertRowid), 'user.register', null, {}, ip);
    return { userId: Number(lastInsertRowid), name };
  }

  function login({ name, password }, ip) {
    const u = q('SELECT * FROM users WHERE (name = ? OR email = ?) AND deleted_at IS NULL').get(String(name || '').trim(), String(name || '').trim().toLowerCase());
    const ok = checkPw(String(password || ''), u ? u.pass_hash : DUMMY_HASH);
    if (!u || !ok) { audit(u?.id, 'user.login_failed', null, {}, ip); throw new HttpError(401, 'Wrong name or password'); }
    return { userId: u.id, name: u.name };
  }

  async function forgotPassword({ email }, ip) {
    const u = q('SELECT id, email FROM users WHERE email = ? AND deleted_at IS NULL').get(String(email || '').trim().toLowerCase());
    if (!u) return;                                            // never reveal whether an email exists
    const token = randomBytes(24).toString('hex');
    q('INSERT INTO reset_tokens (hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), u.id, iso(clock() + 3_600_000));
    audit(u.id, 'user.reset_requested', null, {}, ip);
    await mailer.send({ to: u.email, subject: 'Reset your FitPot password', text: `Open this link within one hour: ${config.appUrl}/#/reset/${token}` });
  }

  function resetPassword({ token, password }, ip) {
    if (String(password || '').length < 8) throw bad('Password must be at least 8 characters');
    const row = q('SELECT * FROM reset_tokens WHERE hash = ? AND used_at IS NULL AND expires_at > ?').get(sha(String(token || '')), iso(clock()));
    if (!row) throw bad('This reset link is invalid or has expired');
    tx(db, () => {
      q('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPw(password), row.user_id);
      q('UPDATE reset_tokens SET used_at = ? WHERE hash = ?').run(iso(clock()), row.hash);
      q('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);   // sign out everywhere
      audit(row.user_id, 'user.password_reset', null, {}, ip);
    });
  }

  function exportData(uid) {
    const u = q('SELECT id, name, email, created FROM users WHERE id = ?').get(uid);
    return {
      user: u,
      challenges: q('SELECT c.id, c.title, c.start, c.end, c.stake, c.currency FROM challenges c JOIN members m ON m.challenge_id = c.id WHERE m.user_id = ?').all(uid),
      entries: q('SELECT challenge_id, date, value, note, created FROM entries WHERE user_id = ?').all(uid),
      payments: q('SELECT challenge_id, amount, status, confirmed_at FROM payments WHERE user_id = ?').all(uid),
      payouts: q('SELECT challenge_id, kind, amount, sent FROM payouts WHERE user_id = ?').all(uid),
    };
  }

  function deleteAccount(uid, { password }, ip) {
    const u = q('SELECT * FROM users WHERE id = ?').get(uid);
    if (!checkPw(String(password || ''), u.pass_hash)) throw forbidden('Password incorrect');
    const open = q(`SELECT 1 FROM challenges c JOIN members m ON m.challenge_id = c.id
                    WHERE m.user_id = ? AND c.finalized_at IS NULL AND c.cancelled_at IS NULL
                      AND (c.owner_id = ? OR EXISTS (SELECT 1 FROM payments p WHERE p.challenge_id = c.id AND p.user_id = ? AND p.status = 'confirmed' AND p.amount > 0))`).get(uid, uid, uid);
    if (open) throw bad('You have challenges that are not settled yet. Settle or cancel them before deleting your account.');
    tx(db, () => {
      // Keep the row (ledger/audit integrity) but remove everything personal.
      q("UPDATE users SET name = ?, email = NULL, pass_hash = '!', deleted_at = ? WHERE id = ?").run(`deleted-${uid}`, iso(clock()), uid);
      q('DELETE FROM sessions WHERE user_id = ?').run(uid);
      q('DELETE FROM reset_tokens WHERE user_id = ?').run(uid);
      audit(uid, 'user.delete', null, {}, ip);
    });
  }

  // -------------------------------------------------------------- challenges
  const status = (c) => {
    const t = now();
    if (c.cancelled_at) return 'cancelled';
    if (c.finalized_at) return 'settled';
    if (t < c.start) return 'upcoming';
    if (t <= c.end) return 'active';
    return 'ended';
  };

  function load(id, uid) {
    const c = q('SELECT * FROM challenges WHERE id = ?').get(id);
    const isMember = c && q('SELECT 1 FROM members WHERE challenge_id = ? AND user_id = ?').get(id, uid);
    if (!c || !isMember) throw notFound('Challenge not found');
    return c;
  }
  const requireOwner = (c, uid) => { if (c.owner_id !== uid) throw forbidden('Only the organiser can do that'); };
  const isLocked = (c) => !!(c.finalized_at || c.cancelled_at);

  function detail(c, uid) {
    const members = q(`
      SELECT m.user_id AS id, u.name, COALESCE(p.status, 'pending') AS payment,
             COALESCE((SELECT SUM(value) FROM entries e WHERE e.challenge_id = m.challenge_id AND e.user_id = m.user_id), 0) AS total
      FROM members m JOIN users u ON u.id = m.user_id
      LEFT JOIN payments p ON p.challenge_id = m.challenge_id AND p.user_id = m.user_id
      WHERE m.challenge_id = ? ORDER BY u.name`).all(c.id);
    const paid = members.filter((m) => m.payment === 'confirmed');
    const s = settle({ members: paid.map(({ id, total }) => ({ id, total })), stake: c.stake, cutoff: c.cutoff, mode: c.share_mode });
    const res = new Map(s.results.map((r) => [r.id, r]));
    const payouts = new Map(q('SELECT * FROM payouts WHERE challenge_id = ?').all(c.id).map((p) => [p.user_id, p]));
    const st = status(c);
    const board = members.map((m) => {
      const r = res.get(m.id);
      const po = payouts.get(m.id);
      return {
        id: m.id, name: m.name, paid: m.payment === 'confirmed', payment: m.payment, total: m.total,
        percentOfTop: r?.percentOfTop ?? null, qualified: r?.qualified ?? null,
        bonus: r?.bonus ?? 0, payout: po ? po.amount : (r?.payout ?? 0),
        sent: po ? !!po.sent : false, payoutKind: po?.kind ?? null,
      };
    }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const t = now();
    const held = q('SELECT COALESCE(SUM(amount),0) AS s FROM ledger WHERE challenge_id = ?').get(c.id).s;
    return {
      id: c.id, code: c.code, title: c.title, metric: c.metric, unit: c.unit, period: c.period,
      start: c.start, end: c.end, stake: c.stake, currency: c.currency, cutoff: c.cutoff,
      shareMode: c.share_mode, dailyMax: c.daily_max, payInfo: c.pay_info,
      payment: provider.instructions(c),
      status: st, joinable: !isLocked(c) && t <= c.start, owner: c.owner_id, isOwner: c.owner_id === uid,
      daysLeft: Math.max(0, daysBetween(t, c.end) + 1), totalDays: daysBetween(c.start, c.end) + 1,
      pot: s.pot, threshold: s.threshold, top: s.top, forfeited: s.forfeited,
      minParticipants: config.minParticipants, belowMinimum: paid.length < config.minParticipants,
      ...(c.owner_id === uid ? {
        held,
        reconciled: isLocked(c) && [...payouts.values()].every((p) => p.sent) && held === 0,
      } : {}),
      board,
    };
  }

  const getDetail = (id, uid) => detail(load(id, uid), uid);

  function list(uid) {
    return q(`SELECT c.* FROM challenges c JOIN members m ON m.challenge_id = c.id WHERE m.user_id = ? ORDER BY c.start DESC`)
      .all(uid).map((c) => {
        const d = detail(c, uid);
        const mine = d.board.find((b) => b.id === uid);
        return { id: d.id, title: d.title, status: d.status, start: d.start, end: d.end, stake: d.stake, currency: d.currency,
                 metric: d.metric, unit: d.unit, pot: d.pot, members: d.board.length, myTotal: mine.total, myQualified: mine.qualified, myPaid: mine.paid };
      });
  }

  function create(uid, body, ip) {
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
    if (start > addDays(now(), 365)) throw bad('Start date is too far ahead');
    let stake = minor(body.stake ?? 0);
    if (!Number.isFinite(stake) || stake < 0) throw bad('Invalid entry amount');
    if (stake > 0 && !config.allowRealMoney) throw bad('Real-money challenges are not enabled yet. Set the entry fee to 0 to play for points.');
    if (stake > config.maxStakeMinor) throw bad(`Entry fee cannot exceed ${config.maxStakeMinor / 100}`);
    const cutoff = Number(body.cutoff);
    if (!Number.isInteger(cutoff) || cutoff < 0 || cutoff > 100) throw bad('Cutoff must be a whole number from 0 to 100');
    const dailyMax = body.dailyMax ? minor(body.dailyMax) : null;
    if (dailyMax !== null && !(dailyMax > 0)) throw bad('Invalid daily maximum');
    const code = randomBytes(4).toString('hex').toUpperCase();
    return tx(db, () => {
      const r = q(`INSERT INTO challenges (code, title, owner_id, metric, unit, period, start, end, stake, currency, cutoff, share_mode, daily_max, pay_info)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(code, title, uid, metric, unit, body.period, start, endDate(start, body.period), stake,
             CURRENCIES.includes(body.currency) ? body.currency : '₹', cutoff, body.shareMode === 'equal' ? 'equal' : 'proportional',
             dailyMax, String(body.payInfo || '').slice(0, 200));
      const id = Number(r.lastInsertRowid);
      q('INSERT INTO members (challenge_id, user_id) VALUES (?,?)').run(id, uid);
      // The organiser holds the pot, so their own stake counts as received.
      q("INSERT INTO payments (challenge_id, user_id, amount, status, confirmed_at, confirmed_by) VALUES (?,?,?,'confirmed',?,?)").run(id, uid, stake, iso(clock()), uid);
      ledger(id, uid, 'stake_in', stake, 'organiser');
      audit(uid, 'challenge.create', id, { stake, cutoff }, ip);
      return { id, code };
    });
  }

  function join(uid, code, ip) {
    const c = q('SELECT * FROM challenges WHERE code = ?').get(String(code || '').trim().toUpperCase());
    if (!c) throw notFound('No challenge with that code');
    if (isLocked(c)) throw bad('This challenge is closed');
    if (now() > c.start) throw bad('This challenge has already started - joining is closed');
    tx(db, () => {
      if (q('INSERT OR IGNORE INTO members (challenge_id, user_id) VALUES (?,?)').run(c.id, uid).changes) {
        q("INSERT INTO payments (challenge_id, user_id, amount, status, confirmed_at) VALUES (?,?,?,?,?)")
          .run(c.id, uid, c.stake, c.stake === 0 ? 'confirmed' : 'pending', c.stake === 0 ? iso(clock()) : null);
        audit(uid, 'challenge.join', c.id, {}, ip);
      }
    });
    return { id: c.id };
  }

  function confirmPayment(ownerId, cid, memberId, confirmed, ip) {
    const c = load(cid, ownerId);
    requireOwner(c, ownerId);
    if (isLocked(c)) throw bad('This challenge is closed');
    const p = q('SELECT * FROM payments WHERE challenge_id = ? AND user_id = ?').get(cid, memberId);
    if (!p) throw notFound('Member not found');
    if (memberId === c.owner_id) throw bad("The organiser's own payment cannot be changed");
    tx(db, () => {
      if (confirmed && p.status === 'pending') {
        if (now() > c.end) throw bad('This challenge is over');
        q("UPDATE payments SET status = 'confirmed', confirmed_at = ?, confirmed_by = ? WHERE id = ?").run(iso(clock()), ownerId, p.id);
        ledger(cid, memberId, 'stake_in', p.amount, `payment:${p.id}`);
        audit(ownerId, 'payment.confirm', cid, { member: memberId, amount: p.amount }, ip);
      } else if (!confirmed && p.status === 'confirmed') {
        if (now() > c.start) throw bad('Payments cannot be un-confirmed once the challenge has started');
        if (q('SELECT 1 FROM entries WHERE challenge_id = ? AND user_id = ?').get(cid, memberId)) throw bad('This member has already logged progress');
        q("UPDATE payments SET status = 'pending', confirmed_at = NULL, confirmed_by = NULL WHERE id = ?").run(p.id);
        ledger(cid, memberId, 'stake_reversal', -p.amount, `payment:${p.id}`);
        audit(ownerId, 'payment.unconfirm', cid, { member: memberId }, ip);
      }
    });
  }

  function cancel(uid, cid, ip) {
    const c = load(cid, uid);
    requireOwner(c, uid);
    if (isLocked(c)) throw bad('This challenge is already closed');
    if (now() > c.start) throw bad('A challenge that has started cannot be cancelled - let it finish and settle');
    tx(db, () => {
      q("UPDATE challenges SET cancelled_at = ? WHERE id = ?").run(iso(clock()), cid);
      q("UPDATE payments SET status = 'void' WHERE challenge_id = ? AND status = 'pending'").run(cid);
      for (const p of q("SELECT * FROM payments WHERE challenge_id = ? AND status = 'confirmed'").all(cid)) writePayout(c, p.user_id, 'refund', p.amount, 0, 1);
      audit(uid, 'challenge.cancel', cid, {}, ip);
    });
  }

  // Creates the payout row; amounts the organiser already holds themselves (or zero amounts) are settled instantly.
  function writePayout(c, uid, kind, amount, total, qualified) {
    const instant = uid === c.owner_id || amount === 0;
    q('INSERT INTO payouts (challenge_id, user_id, kind, amount, total, qualified, sent, sent_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(c.id, uid, kind, amount, total, qualified, instant ? 1 : 0, instant ? iso(clock()) : null);
    if (instant) ledger(c.id, uid, 'payout_out', -amount, `${kind}:auto`);
  }

  function finalize(uid, cid, ip) {
    const c = load(cid, uid);
    requireOwner(c, uid);
    if (isLocked(c)) throw bad('Already closed');
    if (now() <= c.end) throw bad(`The challenge runs until ${c.end}`);
    tx(db, () => {
      const d = detail(c, uid);
      const paid = d.board.filter((b) => b.paid);
      // Not enough competitors -> nobody can fairly lose: refund everyone.
      const refundAll = paid.length < config.minParticipants;
      for (const b of paid) writePayout(c, b.id, refundAll ? 'refund' : 'payout', refundAll ? c.stake : b.payout, b.total, refundAll || b.qualified ? 1 : 0);
      q('UPDATE challenges SET finalized_at = ? WHERE id = ?').run(iso(clock()), cid);
      audit(uid, 'challenge.settle', cid, { pot: d.pot, forfeited: refundAll ? 0 : d.forfeited, refundAll }, ip);
    });
  }

  function markSent(uid, cid, memberId, sent, ip) {
    const c = load(cid, uid);
    requireOwner(c, uid);
    const p = q('SELECT * FROM payouts WHERE challenge_id = ? AND user_id = ?').get(cid, memberId);
    if (!p) throw notFound('No payout for that member');
    if (p.amount === 0 || memberId === c.owner_id) throw bad('Nothing to send for this member');
    tx(db, () => {
      if (sent && !p.sent) {
        q('UPDATE payouts SET sent = 1, sent_at = ? WHERE challenge_id = ? AND user_id = ?').run(iso(clock()), cid, memberId);
        ledger(cid, memberId, 'payout_out', -p.amount, `${p.kind}:sent`);
      } else if (!sent && p.sent) {
        q('UPDATE payouts SET sent = 0, sent_at = NULL WHERE challenge_id = ? AND user_id = ?').run(cid, memberId);
        ledger(cid, memberId, 'payout_reversal', p.amount, `${p.kind}:unsent`);
      } else return;
      audit(uid, sent ? 'payout.sent' : 'payout.unsent', cid, { member: memberId, amount: p.amount }, ip);
    });
  }

  // ----------------------------------------------------------------- entries
  function addEntry(uid, cid, body, ip) {
    const c = load(cid, uid);
    if (isLocked(c)) throw bad('This challenge is closed');
    const p = q('SELECT status FROM payments WHERE challenge_id = ? AND user_id = ?').get(cid, uid);
    if (p?.status !== 'confirmed') throw forbidden('Your entry fee has not been confirmed yet - ask the organiser');
    const date = body.date || now();
    if (!isDate(date)) throw bad('Invalid date');
    if (date < c.start || date > c.end) throw bad(`Date must be between ${c.start} and ${c.end}`);
    if (date > addDays(now(), 1)) throw bad('You cannot log the future');
    const value = minor(body.value);
    if (!Number.isFinite(value) || value <= 0 || value > 100_000_000) throw bad('Enter a positive number');
    if (c.daily_max) {
      const day = q('SELECT COALESCE(SUM(value),0) AS s FROM entries WHERE challenge_id=? AND user_id=? AND date=?').get(cid, uid, date).s;
      if (day + value > c.daily_max) throw bad(`Daily maximum for this challenge is ${c.daily_max / 100} ${c.unit}`);
    }
    const note = String(body.note || '').slice(0, 120);
    const r = q('INSERT INTO entries (challenge_id, user_id, date, value, note) VALUES (?,?,?,?,?)').run(cid, uid, date, value, note);
    audit(uid, 'entry.add', cid, { entry: Number(r.lastInsertRowid), date, value }, ip);
  }

  function entryFor(id, uid) {
    const e = q('SELECT e.*, c.owner_id, c.finalized_at, c.cancelled_at FROM entries e JOIN challenges c ON c.id = e.challenge_id WHERE e.id = ?').get(id);
    if (!e || !q('SELECT 1 FROM members WHERE challenge_id = ? AND user_id = ?').get(e.challenge_id, uid)) throw notFound('Entry not found');
    return e;
  }

  function deleteEntry(uid, id, ip) {
    const e = entryFor(id, uid);
    if (e.user_id !== uid && e.owner_id !== uid) throw forbidden('You can only remove your own entries');
    if (e.finalized_at || e.cancelled_at) throw bad('This challenge is closed');
    tx(db, () => {
      q('DELETE FROM entries WHERE id = ?').run(id);
      audit(uid, 'entry.delete', e.challenge_id, { entry: id, owner: e.user_id, date: e.date, value: e.value }, ip);
    });
  }

  function flagEntry(uid, id, ip) {
    const e = entryFor(id, uid);
    if (e.user_id === uid) throw bad("You can't flag your own entry");
    if (e.finalized_at || e.cancelled_at) throw bad('This challenge is closed');
    q('INSERT OR IGNORE INTO entry_flags (entry_id, user_id) VALUES (?,?)').run(id, uid);
    audit(uid, 'entry.flag', e.challenge_id, { entry: id }, ip);
  }

  function listEntries(uid, cid) {
    load(cid, uid);
    return q(`SELECT e.id, e.user_id AS userId, u.name, e.date, e.value, e.note,
                     (SELECT COUNT(*) FROM entry_flags f WHERE f.entry_id = e.id) AS flags,
                     EXISTS (SELECT 1 FROM entry_flags f WHERE f.entry_id = e.id AND f.user_id = ?) AS flaggedByMe
              FROM entries e JOIN users u ON u.id = e.user_id WHERE e.challenge_id = ? ORDER BY e.date DESC, e.id DESC LIMIT 200`).all(uid, cid)
      .map((e) => ({ ...e, flaggedByMe: !!e.flaggedByMe }));
  }

  function listAudit(uid, cid) {
    requireOwner(load(cid, uid), uid);
    return q(`SELECT a.ts, a.action, a.meta, u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
              WHERE a.challenge_id = ? ORDER BY a.id DESC LIMIT 200`).all(cid).map((r) => ({ ...r, meta: JSON.parse(r.meta) }));
  }

  return {
    startSession, endSession, userForToken, register, login, forgotPassword, resetPassword, exportData, deleteAccount,
    list, create, join, getDetail, confirmPayment, cancel, finalize, markSent,
    addEntry, deleteEntry, flagEntry, listEntries, listAudit,
    publicConfig: () => ({ allowRealMoney: config.allowRealMoney, minParticipants: config.minParticipants, maxStake: config.maxStakeMinor / 100 }),
    health: () => { q('SELECT 1').get(); return true; },
  };
}
