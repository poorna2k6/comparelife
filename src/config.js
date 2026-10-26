// All runtime configuration comes from the environment (12-factor).
const bool = (v, d) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(v));
const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const cfg = {
    production,
    port: int(env.PORT, 3000),
    dbPath: env.DB_PATH || './data/fitpot.db',
    appUrl: (env.APP_URL || `http://localhost:${int(env.PORT, 3000)}`).replace(/\/$/, ''),
    trustProxy: bool(env.TRUST_PROXY, false),          // honour X-Forwarded-For (set behind a load balancer)
    cookieSecure: bool(env.COOKIE_SECURE, production),
    sessionDays: int(env.SESSION_DAYS, 30),
    // Compliance switch: with real money off, entry fees are forced to 0 (points/bragging-rights mode).
    allowRealMoney: bool(env.ALLOW_REAL_MONEY, !production),
    maxStakeMinor: int(env.MAX_STAKE_MINOR, 10_000_00),
    minParticipants: int(env.MIN_PARTICIPANTS, 2),
    logLevel: env.LOG_LEVEL || (production ? 'info' : 'info'),
  };
  if (production && cfg.appUrl.startsWith('http://localhost')) throw new Error('APP_URL must be set in production');
  return cfg;
}
