import { HttpError } from './errors.js';

// Each route: { method, path, handler(ctx) }. `:param` segments are numeric ids passed in ctx.params.
export function buildRoutes(service) {
  const R = [];
  const add = (method, path, handler) => R.push({ method, path, handler });
  const login = (ctx, userId, name) => {
    const { token, maxAgeSec } = service.startSession(userId);
    ctx.setSession(token, maxAgeSec);
    return { id: userId, name };
  };

  add('GET', '/api/config', () => service.publicConfig());
  add('POST', '/api/register', (ctx) => {
    ctx.limit(`reg:${ctx.ip}`, 10, 3_600_000);
    const r = service.register(ctx.body, ctx.ip);
    return login(ctx, r.userId, r.name);
  });

  add('POST', '/api/login', (ctx) => {
    const key = `login:${ctx.ip}:${String(ctx.body.name || '').toLowerCase()}`;
    ctx.limit(key, 8, 15 * 60_000);
    const r = service.login(ctx.body, ctx.ip);
    ctx.clearLimit(key);
    return login(ctx, r.userId, r.name);
  });

  add('POST', '/api/logout', (ctx) => { if (ctx.token) service.endSession(ctx.token); ctx.clearSession(); return { ok: true }; });
  add('GET', '/api/me', (ctx) => ctx.user());

  add('POST', '/api/password/forgot', async (ctx) => {
    ctx.limit(`forgot:${ctx.ip}`, 5, 3_600_000);
    await service.forgotPassword(ctx.body, ctx.ip);
    return { ok: true };                                  // identical response whether or not the email exists
  });
  add('POST', '/api/password/reset', (ctx) => { ctx.limit(`reset:${ctx.ip}`, 10, 3_600_000); service.resetPassword(ctx.body, ctx.ip); return { ok: true }; });

  add('GET', '/api/me/export', (ctx) => service.exportData(ctx.user().id));
  add('POST', '/api/me/delete', (ctx) => {
    service.deleteAccount(ctx.user().id, ctx.body, ctx.ip);
    ctx.clearSession();
    return { ok: true };
  });

  add('GET', '/api/challenges', (ctx) => service.list(ctx.user().id));
  add('POST', '/api/challenges', (ctx) => { const u = ctx.user(); ctx.limit(`create:${u.id}`, 20, 3_600_000); return service.create(u.id, ctx.body, ctx.ip); });
  add('POST', '/api/join', (ctx) => service.join(ctx.user().id, ctx.body.code, ctx.ip));
  add('GET', '/api/challenges/:id', (ctx) => service.getDetail(ctx.params[0], ctx.user().id));
  add('GET', '/api/challenges/:id/entries', (ctx) => service.listEntries(ctx.user().id, ctx.params[0]));
  add('POST', '/api/challenges/:id/entries', (ctx) => { const u = ctx.user(); ctx.limit(`entry:${u.id}`, 120, 3_600_000); service.addEntry(u.id, ctx.params[0], ctx.body, ctx.ip); return { ok: true }; });
  add('GET', '/api/challenges/:id/audit', (ctx) => service.listAudit(ctx.user().id, ctx.params[0]));
  add('POST', '/api/challenges/:id/cancel', (ctx) => { service.cancel(ctx.user().id, ctx.params[0], ctx.ip); return { ok: true }; });
  add('POST', '/api/challenges/:id/finalize', (ctx) => { service.finalize(ctx.user().id, ctx.params[0], ctx.ip); return { ok: true }; });
  add('POST', '/api/challenges/:id/members/:uid/paid', (ctx) => { service.confirmPayment(ctx.user().id, ctx.params[0], ctx.params[1], !!ctx.body.paid, ctx.ip); return { ok: true }; });
  add('POST', '/api/challenges/:id/payouts/:uid/sent', (ctx) => { service.markSent(ctx.user().id, ctx.params[0], ctx.params[1], !!ctx.body.sent, ctx.ip); return { ok: true }; });
  add('DELETE', '/api/entries/:id', (ctx) => { service.deleteEntry(ctx.user().id, ctx.params[0], ctx.ip); return { ok: true }; });
  add('POST', '/api/entries/:id/flag', (ctx) => { service.flagEntry(ctx.user().id, ctx.params[0], ctx.ip); return { ok: true }; });

  return R;
}
