import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export async function startApp({ env = {}, now, clock } = {}) {
  const state = { day: '2026-01-01', ms: Date.parse('2026-01-01T00:00:00Z') };
  const mails = [];
  const app = createApp({
    config: loadConfig({ DB_PATH: ':memory:', ALLOW_REAL_MONEY: 'true', ...env }),
    log: { debug() {}, info() {}, warn() {}, error: (m, f) => console.error(m, f) },
    now: now ?? (() => state.day),
    clock: clock ?? (() => state.ms),
    mailer: { send: async (m) => { mails.push(m); } },
  });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  // A tiny client with its own cookie jar, i.e. one browser.
  const client = () => {
    let sid = '';
    const call = async (method, path, body, headers = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', 'x-requested-with': 'fitpot', ...(sid && { cookie: `sid=${sid}` }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.getSetCookie?.().find((c) => c.startsWith('sid='));
      if (set) sid = set.split(';')[0].slice(4);
      return { status: res.status, body: await res.json().catch(() => null), headers: res.headers, set };
    };
    return { call, get sid() { return sid; } };
  };
  const signup = async (name) => {
    const c = client();
    const r = await c.call('POST', '/api/register', { name, email: `${name.toLowerCase()}@example.com`, password: 'password1' });
    if (r.status !== 200) throw new Error('signup failed: ' + JSON.stringify(r.body));
    return Object.assign(c, { id: r.body.id, name });
  };
  return { app, state, mails, base, client, signup, stop: () => app.close() };
}
