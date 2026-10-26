// Fixed-window in-memory limiter. Fine for a single instance; swap for Redis when scaling out.
export function createLimiter() {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, 60_000);
  sweep.unref();
  return {
    /** Returns true if the call is allowed. */
    hit(key, max, windowMs) {
      const now = Date.now();
      let e = hits.get(key);
      if (!e || e.reset <= now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
      e.n += 1;
      return e.n <= max;
    },
    reset: (key) => hits.delete(key),
    stop: () => clearInterval(sweep),
  };
}
