import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError, bad, notFound } from './errors.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
};
const MAX_BODY = 50_000;

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
};

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createHttp({ config, log, limiter, routes, publicDir, service }) {
  const compiled = routes.map((r) => ({ ...r, re: new RegExp('^' + r.path.replace(/:\w+/g, '(\\d+)') + '$') }));

  const clientIp = (req) =>
    (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';

  const cookie = (name, value, maxAge) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.cookieSecure ? '; Secure' : ''}`;

  async function readBody(req) {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > MAX_BODY) throw bad('Request too large'); }
    try { return raw ? JSON.parse(raw) : {}; } catch { throw bad('Invalid JSON'); }
  }

  async function handler(req, res) {
    const started = process.hrtime.bigint();
    const id = randomUUID();
    const ip = clientIp(req);
    const url = new URL(req.url, 'http://x');
    const extra = [];                                       // Set-Cookie values
    let userId;
    const send = (status, data, type = 'application/json', headers = {}) => {
      res.writeHead(status, { ...SECURITY_HEADERS, ...(config.production && { 'strict-transport-security': 'max-age=31536000; includeSubDomains' }),
        'content-type': type, 'cache-control': 'no-store', 'x-request-id': id, ...(extra.length && { 'set-cookie': extra }), ...headers });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };

    try {
      if (url.pathname === '/healthz') return send(200, { ok: true });
      if (url.pathname === '/readyz') { service.health(); return send(200, { ok: true }); }

      if (url.pathname.startsWith('/api/')) {
        if (!limiter.hit(`ip:${ip}`, 300, 60_000)) throw new HttpError(429, 'Too many requests - slow down');
        const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
        // CSRF: cookies are SameSite=Strict, and mutations must carry a custom header,
        // which a cross-site form or <img> cannot send and which forces a CORS preflight we never grant.
        if (unsafe && req.headers['x-requested-with'] !== 'fitpot') throw new HttpError(403, 'Missing required header');
        const route = compiled.find((r) => r.method === req.method && r.re.test(url.pathname));
        if (!route) throw notFound();
        const params = route.re.exec(url.pathname).slice(1).map(Number);
        const token = parseCookies(req.headers.cookie).sid;
        const ctx = {
          ip, params, token,
          body: unsafe ? await readBody(req) : {},
          user() {
            const u = service.userForToken(token);
            if (!u) throw new HttpError(401, 'Please log in');
            userId = u.id;
            return u;
          },
          setSession: (t, maxAge) => extra.push(cookie('sid', t, maxAge)),
          clearSession: () => extra.push(cookie('sid', '', 0)),
          limit: (key, max, windowMs) => { if (!limiter.hit(key, max, windowMs)) throw new HttpError(429, 'Too many attempts - try again later'); },
          clearLimit: (key) => limiter.reset(key),
        };
        return send(200, await route.handler(ctx));
      }

      let rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
      const file = join(publicDir, rel);
      if (!file.startsWith(publicDir + sep) || !TYPES[extname(file)]) throw notFound();
      return send(200, await readFile(file), TYPES[extname(file)], { 'cache-control': 'no-cache' });
    } catch (e) {
      if (e.code === 'ENOENT') e = notFound();
      if (e instanceof HttpError) { send(e.status, { error: e.message }); }
      else { log.error('unhandled error', { id, err: e.stack || String(e) }); send(500, { error: 'Something went wrong', requestId: id }); }
    } finally {
      if (url.pathname !== '/healthz')
        log.info('request', { id, method: req.method, path: url.pathname, status: res.statusCode, ms: Number(process.hrtime.bigint() - started) / 1e6 | 0, user: userId, ip });
    }
  }

  return createServer(handler);
}
