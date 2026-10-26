// Structured JSON logs, one object per line (easy to ship to any log platform).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export function createLogger(level = 'info', sink = (line) => process.stdout.write(line + '\n')) {
  const min = LEVELS[level] ?? 20;
  const emit = (lvl, msg, fields) => {
    if (LEVELS[lvl] < min) return;
    sink(JSON.stringify({ t: new Date().toISOString(), level: lvl, msg, ...fields }));
  };
  return Object.fromEntries(['debug', 'info', 'warn', 'error'].map((l) => [l, (msg, f) => emit(l, msg, f)]));
}
