import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { createLogger } from './log.js';
import { openDb } from './db.js';
import { createService } from './service.js';
import { createLimiter } from './ratelimit.js';
import { createConsoleMailer } from './mailer.js';
import { buildRoutes } from './routes.js';
import { createHttp } from './http.js';
import { today } from './dates.js';

const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');

/** Wires everything together. Overridable pieces (config, clock, logger) make it testable. */
export function createApp({ config = loadConfig(), log = createLogger(config.logLevel), now = today, clock = Date.now, mailer } = {}) {
  const db = openDb(config.dbPath, log);
  const service = createService({ db, config, mailer: mailer ?? createConsoleMailer(log), now, clock });
  const limiter = createLimiter();
  const server = createHttp({ config, log, limiter, routes: buildRoutes(service), publicDir: PUBLIC.replace(/\/$/, ''), service });
  const close = () => new Promise((resolve) => { limiter.stop(); server.close(() => { db.close(); resolve(); }); server.closeIdleConnections?.(); });
  return { server, db, service, config, log, close };
}
