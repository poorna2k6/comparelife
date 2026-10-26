// Dates are 'YYYY-MM-DD' strings; arithmetic is done in UTC to avoid DST drift.
const toDate = (s) => new Date(s + 'T00:00:00Z');
const fmt = (d) => d.toISOString().slice(0, 10);

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(toDate(s)) === s;
export const today = () => fmt(new Date());
export const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };

// Inclusive last day of a week / month / year challenge.
export function endDate(start, period) {
  const d = toDate(start);
  if (period === 'week') return addDays(start, 6);
  const day = d.getUTCDate();
  if (period === 'month') d.setUTCMonth(d.getUTCMonth() + 1, 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1, d.getUTCMonth(), 1);
  // clamp (Jan 31 + 1 month -> Feb 28/29), then step back to the inclusive end
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return addDays(fmt(d), -1);
}

export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
