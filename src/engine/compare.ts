import type { Metric, Place } from "./types";

export interface ComparedRow {
  key: string;
  a?: Metric;
  b?: Metric;
  /** (b - a) / a; undefined unless both sides have data in the same unit and a != 0 */
  pctDiff?: number;
}

/** Side-by-side rows for every metric key either place has. Never fills gaps. */
export function comparePlaces(a: Place, b: Place): ComparedRow[] {
  const keys = new Set([...Object.keys(a.metrics), ...Object.keys(b.metrics)]);
  return [...keys].sort().map((key) => {
    const ma = a.metrics[key];
    const mb = b.metrics[key];
    const comparable = ma && mb && ma.unit === mb.unit && ma.value !== 0;
    return {
      key,
      a: ma,
      b: mb,
      pctDiff: comparable ? (mb.value - ma.value) / ma.value : undefined,
    };
  });
}
