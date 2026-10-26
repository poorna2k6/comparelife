import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { endDate } from '../src/dates.js';

test('end dates', () => {
  assert.equal(endDate('2026-01-01', 'week'), '2026-01-07');
  assert.equal(endDate('2026-01-01', 'month'), '2026-01-31');
  assert.equal(endDate('2026-01-31', 'month'), '2026-02-27');
  assert.equal(endDate('2026-01-01', 'year'), '2026-12-31');
});

const basic = { title: 'Jan steps', preset: 'steps', period: 'week', start: '2026-01-01', stake: 100, cutoff: 50, currency: '₹' };
const ledgerSum = (t, id) => t.app.db.prepare('SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE challenge_id = ?').get(id).s;

test('full flow: create, join, pay, log, settle, payouts reconcile the ledger to zero', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const [a, b, c, d] = await Promise.all(['Asha', 'Ben', 'Chitra', 'Dev'].map(ctx.signup));
  const made = await a.call('POST', '/api/challenges', basic);
  assert.equal(made.status, 200);
  const id = made.body.id;
  for (const u of [b, c, d]) assert.equal((await u.call('POST', '/api/join', { code: made.body.code })).status, 200);

  assert.equal((await b.call('POST', `/api/challenges/${id}/entries`, { value: 10 })).status, 403, 'unpaid cannot log');
  assert.equal((await b.call('POST', `/api/challenges/${id}/members/${c.id}/paid`, { paid: true })).status, 403, 'only organiser confirms');
  for (const u of [b, c, d]) assert.equal((await a.call('POST', `/api/challenges/${id}/members/${u.id}/paid`, { paid: true })).status, 200);
  assert.equal(ledgerSum(ctx, id), 40000);

  ctx.state.day = '2026-01-03';
  const log = (u, v, date) => u.call('POST', `/api/challenges/${id}/entries`, { value: v, date });
  assert.equal((await log(a, 70000, '2026-01-01')).status, 200);
  assert.equal((await log(b, 40000, '2026-01-02')).status, 200);
  assert.equal((await log(c, 30000, '2026-01-02')).status, 200);   // 30000/70000 < 50% -> loses
  assert.equal((await log(d, 10, '2026-01-03')).status, 200);       // loses
  assert.equal((await log(a, 1, '2025-12-31')).status, 400);

  assert.equal((await a.call('POST', `/api/challenges/${id}/finalize`, {})).status, 400, 'not before end');
  ctx.state.day = '2026-01-08';
  assert.equal((await b.call('POST', `/api/challenges/${id}/finalize`, {})).status, 403);
  assert.equal((await a.call('POST', `/api/challenges/${id}/finalize`, {})).status, 200);
  assert.equal((await a.call('POST', `/api/challenges/${id}/finalize`, {})).status, 400, 'settle once');

  let done = (await a.call('GET', `/api/challenges/${id}`)).body;
  assert.equal(done.status, 'settled');
  assert.equal(done.reconciled, false, 'payouts not yet sent');
  const by = Object.fromEntries(done.board.map((x) => [x.name, x]));
  assert.equal(by.Asha.qualified, true);
  assert.equal(by.Chitra.qualified, false);
  assert.equal(by.Dev.payout, 0);
  assert.equal(done.board.reduce((s, x) => s + x.payout, 0), 40000);

  // organiser sends the payout to each winner; the pot must drain to exactly zero
  for (const u of [b, c, d]) await a.call('POST', `/api/challenges/${id}/payouts/${u.id}/sent`, { sent: true });
  assert.equal((await a.call('POST', `/api/challenges/${id}/payouts/${a.id}/sent`, { sent: true })).status, 400);
  done = (await a.call('GET', `/api/challenges/${id}`)).body;
  assert.equal(done.held, 0);
  assert.equal(done.reconciled, true);
  assert.equal((await log(a, 5, '2026-01-04')).status, 400, 'locked after settlement');
  // non-organisers never see the books
  assert.equal((await b.call('GET', `/api/challenges/${id}`)).body.held, undefined);
  assert.equal((await b.call('GET', `/api/challenges/${id}/audit`)).status, 403);
  const trail = (await a.call('GET', `/api/challenges/${id}/audit`)).body.map((r) => r.action);
  for (const action of ['challenge.create', 'challenge.join', 'payment.confirm', 'entry.add', 'challenge.settle', 'payout.sent']) assert.ok(trail.includes(action), action);
});

test('cancel before start refunds everyone; fewer than minimum participants is refunded at settle', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const [a, b] = await Promise.all(['Eve', 'Fay'].map(ctx.signup));
  const m1 = (await a.call('POST', '/api/challenges', { ...basic, start: '2026-01-05' })).body;
  await b.call('POST', '/api/join', { code: m1.code });
  await a.call('POST', `/api/challenges/${m1.id}/members/${b.id}/paid`, { paid: true });
  assert.equal((await a.call('POST', `/api/challenges/${m1.id}/members/${b.id}/paid`, { paid: false })).status, 200, 'can un-confirm before start');
  await a.call('POST', `/api/challenges/${m1.id}/members/${b.id}/paid`, { paid: true });
  assert.equal((await b.call('POST', `/api/challenges/${m1.id}/cancel`, {})).status, 403);
  assert.equal((await a.call('POST', `/api/challenges/${m1.id}/cancel`, {})).status, 200);
  const cancelled = (await a.call('GET', `/api/challenges/${m1.id}`)).body;
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.board.map((x) => [x.payout, x.payoutKind]), [[10000, 'refund'], [10000, 'refund']]);
  assert.equal((await b.call('POST', '/api/join', { code: m1.code })).status, 400);
  await a.call('POST', `/api/challenges/${m1.id}/payouts/${b.id}/sent`, { sent: true });
  assert.equal(ledgerSum(ctx, m1.id), 0);

  // solo challenge: the lone participant can't "lose" to nobody
  const m2 = (await a.call('POST', '/api/challenges', { ...basic, title: 'Solo run', start: '2026-01-01' })).body;
  await a.call('POST', `/api/challenges/${m2.id}/entries`, { value: 5, date: '2026-01-01' });
  ctx.state.day = '2026-01-09';
  await a.call('POST', `/api/challenges/${m2.id}/finalize`, {});
  const solo = (await a.call('GET', `/api/challenges/${m2.id}`)).body;
  assert.equal(solo.board[0].payout, 10000);
  assert.equal(solo.board[0].payoutKind, 'refund');
  assert.equal(ledgerSum(ctx, m2.id), 0);
});

test('un-confirming is blocked once the challenge starts', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const [a, b] = await Promise.all(['Gus', 'Hal'].map(ctx.signup));
  const m = (await a.call('POST', '/api/challenges', basic)).body;
  await b.call('POST', '/api/join', { code: m.code });
  await a.call('POST', `/api/challenges/${m.id}/members/${b.id}/paid`, { paid: true });
  ctx.state.day = '2026-01-02';
  assert.equal((await a.call('POST', `/api/challenges/${m.id}/members/${b.id}/paid`, { paid: false })).status, 400);
  assert.equal((await a.call('POST', `/api/challenges/${m.id}/cancel`, {})).status, 400);
});

test('entries: daily cap, flagging, deletion permissions', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const [a, b, z] = await Promise.all(['Ivy', 'Jay', 'Kim'].map(ctx.signup));
  const m = (await a.call('POST', '/api/challenges', { ...basic, dailyMax: 20000 })).body;
  await b.call('POST', '/api/join', { code: m.code });
  await a.call('POST', `/api/challenges/${m.id}/members/${b.id}/paid`, { paid: true });
  assert.equal((await b.call('POST', `/api/challenges/${m.id}/entries`, { value: 25000 })).status, 400, 'over daily max');
  assert.equal((await b.call('POST', `/api/challenges/${m.id}/entries`, { value: 15000 })).status, 200);
  assert.equal((await b.call('POST', `/api/challenges/${m.id}/entries`, { value: 6000 })).status, 400, 'cumulative cap');
  const e = (await a.call('GET', `/api/challenges/${m.id}/entries`)).body[0];
  assert.equal((await b.call('POST', `/api/entries/${e.id}/flag`, {})).status, 400, 'cannot flag own');
  assert.equal((await a.call('POST', `/api/entries/${e.id}/flag`, {})).status, 200);
  assert.equal((await a.call('GET', `/api/challenges/${m.id}/entries`)).body[0].flags, 1);
  assert.equal((await z.call('DELETE', `/api/entries/${e.id}`)).status, 404, 'outsider');
  assert.equal((await a.call('DELETE', `/api/entries/${e.id}`)).status, 200, 'organiser can remove');
  assert.ok((await a.call('GET', `/api/challenges/${m.id}/audit`)).body.some((r) => r.action === 'entry.delete'));
});

test('privacy and access control', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const [a, z] = await Promise.all(['Lou', 'Max'].map(ctx.signup));
  const m = (await a.call('POST', '/api/challenges', { ...basic, start: '2026-02-01' })).body;
  assert.equal((await z.call('GET', `/api/challenges/${m.id}`)).status, 404);
  assert.equal((await z.call('GET', `/api/challenges/${m.id}/entries`)).status, 404);
  ctx.state.day = '2026-02-02';
  assert.equal((await z.call('POST', '/api/join', { code: m.code })).status, 400, 'closed after start');
  const anon = ctx.client();
  assert.equal((await anon.call('GET', '/api/challenges')).status, 401);
  assert.ok(!JSON.stringify((await a.call('GET', `/api/challenges/${m.id}`)).body).includes('example.com'), 'emails never exposed');
});

test('real money can be switched off', async (t) => {
  const ctx = await startApp({ env: { ALLOW_REAL_MONEY: 'false' } }); t.after(ctx.stop);
  const a = await ctx.signup('Ned');
  assert.equal((await a.call('POST', '/api/challenges', basic)).status, 400);
  assert.equal((await a.call('POST', '/api/challenges', { ...basic, stake: 0 })).status, 200);
});

test('validation', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const u = await ctx.signup('Val');
  for (const patch of [{ title: 'x' }, { cutoff: 150 }, { cutoff: 1.5 }, { period: 'decade' }, { stake: -5 }, { stake: 1e9 }, { start: '2025-01-01' }, { start: 'nope' }, { preset: 'x', metric: '', unit: '' }])
    assert.equal((await u.call('POST', '/api/challenges', { ...basic, ...patch })).status, 400, JSON.stringify(patch));
});

test('account export and deletion', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const [a, b] = await Promise.all(['Opal', 'Pete'].map(ctx.signup));
  const m = (await a.call('POST', '/api/challenges', basic)).body;
  assert.equal((await a.call('POST', '/api/me/delete', { password: 'password1' })).status, 400, 'organiser of an open challenge');
  await a.call('POST', `/api/challenges/${m.id}/cancel`, {}).catch(() => {});
  const exp = (await b.call('GET', '/api/me/export')).body;
  assert.equal(exp.user.name, 'Pete');
  assert.equal((await b.call('POST', '/api/me/delete', { password: 'wrong-pass' })).status, 403);
  assert.equal((await b.call('POST', '/api/me/delete', { password: 'password1' })).status, 200);
  assert.equal((await b.call('GET', '/api/me')).status, 401);
  assert.equal((await ctx.client().call('POST', '/api/login', { name: 'Pete', password: 'password1' })).status, 401);
  assert.equal(ctx.app.db.prepare('SELECT email FROM users WHERE id = ?').get(b.id).email, null);
});
