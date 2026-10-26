import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

test('cookie is HttpOnly + SameSite=Strict; mutations need the CSRF header', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const c = ctx.client();
  const r = await c.call('POST', '/api/register', { name: 'Sam', email: 'sam@example.com', password: 'password1' });
  assert.match(r.set, /HttpOnly/); assert.match(r.set, /SameSite=Strict/);
  assert.equal(r.body.token, undefined, 'session token never in the JSON body');
  const noHeader = await fetch(ctx.base + '/api/logout', { method: 'POST', headers: { cookie: `sid=${c.sid}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403);
  assert.equal((await c.call('GET', '/api/me')).status, 200);
});

test('security headers and static hardening', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const res = await fetch(ctx.base + '/');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('x-request-id'));
  for (const p of ['/..%2fserver.js', '/../package.json', '/src/db.js', '/%2e%2e/package.json', '/data/fitpot.db'])
    assert.equal((await fetch(ctx.base + p)).status, 404, p);
  assert.equal((await fetch(ctx.base + '/healthz')).status, 200);
  assert.equal((await fetch(ctx.base + '/readyz')).status, 200);
});

test('logout revokes the session server-side; sessions expire', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const a = await ctx.signup('Tia');
  const stolen = a.sid;
  assert.equal((await a.call('POST', '/api/logout', {})).status, 200);
  const replay = await fetch(ctx.base + '/api/me', { headers: { cookie: `sid=${stolen}` } });
  assert.equal(replay.status, 401);
  const b = await ctx.signup('Uma');
  ctx.state.ms += 31 * 86_400_000;
  assert.equal((await b.call('GET', '/api/me')).status, 401, 'expired after 30 days');
});

test('session tokens are stored hashed', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const a = await ctx.signup('Vic');
  const rows = ctx.app.db.prepare('SELECT id_hash FROM sessions').all();
  assert.ok(rows.length && rows.every((r) => r.id_hash !== a.sid && r.id_hash.length === 64));
});

test('login is throttled and does not reveal which accounts exist', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  await ctx.signup('Wes');
  const c = ctx.client();
  const wrongPass = await c.call('POST', '/api/login', { name: 'Wes', password: 'nope-nope' });
  const noUser = await c.call('POST', '/api/login', { name: 'Ghost', password: 'nope-nope' });
  assert.equal(wrongPass.body.error, noUser.body.error);
  let last;
  for (let i = 0; i < 10; i++) last = await c.call('POST', '/api/login', { name: 'Wes', password: 'bad-bad-bad' });
  assert.equal(last.status, 429);
  assert.equal((await c.call('POST', '/api/login', { name: 'Wes', password: 'password1' })).status, 429, 'locked even for the right password');
});

test('password reset: single-use, expires, signs out other sessions', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const a = await ctx.signup('Xan');
  const c = ctx.client();
  assert.equal((await c.call('POST', '/api/password/forgot', { email: 'nobody@example.com' })).status, 200);
  assert.equal(ctx.mails.length, 0, 'no mail, same response');
  await c.call('POST', '/api/password/forgot', { email: 'xan@example.com' });
  const token = /reset\/(\w+)/.exec(ctx.mails[0].text)[1];
  assert.equal((await c.call('POST', '/api/password/reset', { token, password: 'short' })).status, 400);
  assert.equal((await c.call('POST', '/api/password/reset', { token, password: 'brand-new-pass' })).status, 200);
  assert.equal((await c.call('POST', '/api/password/reset', { token, password: 'another-pass-1' })).status, 400, 'single use');
  assert.equal((await a.call('GET', '/api/me')).status, 401, 'old session revoked');
  assert.equal((await ctx.client().call('POST', '/api/login', { name: 'Xan', password: 'brand-new-pass' })).status, 200);
  await c.call('POST', '/api/password/forgot', { email: 'xan@example.com' });
  const t2 = /reset\/(\w+)/.exec(ctx.mails[1].text)[1];
  ctx.state.ms += 2 * 3_600_000;
  assert.equal((await c.call('POST', '/api/password/reset', { token: t2, password: 'yet-another-1' })).status, 400, 'expired');
});

test('ledger and audit log are append-only at the database level', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const a = await ctx.signup('Yan');
  await a.call('POST', '/api/challenges', { title: 'Ledger', preset: 'steps', period: 'week', stake: 10, cutoff: 50 });
  for (const sql of ['UPDATE ledger SET amount = 0', 'DELETE FROM ledger', 'UPDATE audit_log SET action = 1', 'DELETE FROM audit_log'])
    assert.throws(() => ctx.app.db.exec(sql), /append-only/, sql);
});

test('oversized and malformed bodies are rejected cleanly', async (t) => {
  const ctx = await startApp(); t.after(ctx.stop);
  const h = { 'content-type': 'application/json', 'x-requested-with': 'fitpot' };
  assert.equal((await fetch(ctx.base + '/api/login', { method: 'POST', headers: h, body: '{nope' })).status, 400);
  assert.equal((await fetch(ctx.base + '/api/login', { method: 'POST', headers: h, body: JSON.stringify({ name: 'x'.repeat(60_000) }) })).status, 400);
});
