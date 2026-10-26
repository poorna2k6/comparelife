import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { endDate } from '../lib/dates.js';

let clock = '2026-01-01';
const { server, db } = createApp({ dbPath: ':memory:', now: () => clock });
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); db.close(); });

const call = async (method, path, body, token) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const signup = async (name) => (await call('POST', '/api/register', { name, password: 'secret1' })).body;

test('end dates', () => {
  assert.equal(endDate('2026-01-01', 'week'), '2026-01-07');
  assert.equal(endDate('2026-01-01', 'month'), '2026-01-31');
  assert.equal(endDate('2026-01-31', 'month'), '2026-02-27');
  assert.equal(endDate('2026-01-01', 'year'), '2026-12-31');
});

test('full flow: create, join, pay, log, settle', async () => {
  const [a, b, c, d] = await Promise.all(['Asha', 'Ben', 'Chitra', 'Dev'].map(signup));
  const made = await call('POST', '/api/challenges', { title: 'Jan steps', preset: 'steps', period: 'week', start: '2026-01-01', stake: 100, cutoff: 50, currency: '₹' }, a.token);
  assert.equal(made.status, 200);
  const id = made.body.id;
  for (const u of [b, c, d]) assert.equal((await call('POST', '/api/join', { code: made.body.code }, u.token)).status, 200);

  // unpaid members cannot log
  assert.equal((await call('POST', `/api/challenges/${id}/entries`, { value: 10 }, b.token)).status, 403);
  const det = (await call('GET', `/api/challenges/${id}`, null, a.token)).body;
  for (const m of det.board.filter((x) => x.name !== 'Asha'))
    await call('POST', `/api/challenges/${id}/members/${m.id}/paid`, { paid: true }, a.token);
  // non-organiser cannot confirm payments
  assert.equal((await call('POST', `/api/challenges/${id}/members/${det.board[0].id}/paid`, { paid: true }, b.token)).status, 403);

  clock = '2026-01-03';
  const log = (u, v, date) => call('POST', `/api/challenges/${id}/entries`, { value: v, date }, u.token);
  assert.equal((await log(a, 70000, '2026-01-01')).status, 200);
  assert.equal((await log(b, 40000, '2026-01-02')).status, 200);
  assert.equal((await log(c, 30000, '2026-01-02')).status, 200);   // 30000/70000 < 50% -> loses
  assert.equal((await log(d, 10, '2026-01-03')).status, 200);       // loses
  assert.equal((await log(a, 1, '2025-12-31')).status, 400);        // outside window

  // cannot settle before it ends
  assert.equal((await call('POST', `/api/challenges/${id}/finalize`, {}, a.token)).status, 400);
  clock = '2026-01-08';
  assert.equal((await call('POST', `/api/challenges/${id}/finalize`, {}, b.token)).status, 403);
  assert.equal((await call('POST', `/api/challenges/${id}/finalize`, {}, a.token)).status, 200);

  const done = (await call('GET', `/api/challenges/${id}`, null, c.token)).body;
  assert.equal(done.status, 'settled');
  assert.equal(done.pot, 40000);
  const by = Object.fromEntries(done.board.map((x) => [x.name, x]));
  assert.equal(by.Asha.qualified, true);
  assert.equal(by.Chitra.qualified, false);
  assert.equal(by.Dev.payout, 0);
  assert.equal(done.board.reduce((s, x) => s + x.payout, 0), 40000);
  assert.equal((await log(a, 5, '2026-01-04')).status, 400);        // locked after settlement
});

test('outsiders cannot see a challenge; joining closes after start', async () => {
  clock = '2026-02-01';
  const [a, z] = await Promise.all(['Eve', 'Zed'].map(signup));
  const made = await call('POST', '/api/challenges', { title: 'Feb run', metric: 'Pushups', unit: 'reps', period: 'month', start: '2026-02-01', stake: 50, cutoff: 60 }, a.token);
  assert.equal((await call('GET', `/api/challenges/${made.body.id}`, null, z.token)).status, 404);
  clock = '2026-02-02';
  assert.equal((await call('POST', '/api/join', { code: made.body.code }, z.token)).status, 400);
});

test('validation and auth', async () => {
  assert.equal((await call('GET', '/api/challenges')).status, 401);
  assert.equal((await call('POST', '/api/login', { name: 'nobody', password: 'x' })).status, 401);
  const u = await signup('Val');
  assert.equal((await call('POST', '/api/challenges', { title: 'x', preset: 'steps', period: 'week', stake: 10, cutoff: 50 }, u.token)).status, 400);
  assert.equal((await call('POST', '/api/challenges', { title: 'Good title', preset: 'steps', period: 'week', stake: 10, cutoff: 150 }, u.token)).status, 400);
  assert.equal((await call('POST', '/api/challenges', { title: 'Good title', preset: 'steps', period: 'decade', stake: 10, cutoff: 50 }, u.token)).status, 400);
});
