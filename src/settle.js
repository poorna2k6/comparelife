// Pure settlement engine. All money is integer minor units (paise/cents);
// all progress values are integers (hundredths of the metric unit).

// Split `amount` across `weights` with the largest-remainder method so the
// parts always sum to exactly `amount`.
export function allocate(amount, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (amount === 0 || sum === 0) return weights.map(() => 0);
  const parts = weights.map((w, i) => {
    const exact = (amount * w) / sum;
    return { i, floor: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = amount - parts.reduce((a, p) => a + p.floor, 0);
  [...parts].sort((a, b) => b.rem - a.rem || a.i - b.i).forEach((p) => {
    if (left > 0) { p.floor += 1; left -= 1; }
  });
  return parts.map((p) => p.floor);
}

/**
 * members: [{ id, total }]  paid-up participants only
 * stake:   per-person entry fee (minor units)
 * cutoff:  integer percent 0..100 of the top performer's total needed to stay in
 * mode:    'proportional' (share by achievement) | 'equal'
 */
export function settle({ members, stake, cutoff, mode = 'proportional' }) {
  const top = members.reduce((m, x) => Math.max(m, x.total), 0);
  const pot = stake * members.length;
  // total/top >= cutoff/100, in integers. With nobody having logged anything
  // (top === 0) there is no one to fall behind, so everyone is refunded.
  const qualifies = (t) => top === 0 || t * 100 >= cutoff * top;
  const winners = members.filter((m) => qualifies(m.total));
  const losers = members.filter((m) => !qualifies(m.total));
  const forfeited = stake * losers.length;

  const weights = winners.map((w) => (mode === 'equal' ? 1 : w.total));
  // If every winner is at 0 in proportional mode, fall back to equal.
  const shares = allocate(forfeited, weights.some((w) => w > 0) ? weights : weights.map(() => 1));
  const shareOf = new Map(winners.map((w, i) => [w.id, shares[i]]));

  const results = members.map((m) => {
    const qualified = qualifies(m.total);
    const bonus = qualified ? shareOf.get(m.id) : 0;
    return {
      id: m.id,
      total: m.total,
      percentOfTop: top === 0 ? 100 : Math.round((m.total / top) * 1000) / 10,
      qualified,
      bonus,
      payout: qualified ? stake + bonus : 0,
      net: qualified ? bonus : -stake,
    };
  });
  return { top, threshold: Math.ceil((cutoff * top) / 100), pot, forfeited, results };
}
