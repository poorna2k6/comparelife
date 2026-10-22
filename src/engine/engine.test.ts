import { describe, expect, it } from "vitest";
import { comparePlaces } from "./compare";
import { projectRetirement } from "./retirement";
import type { Metric } from "./types";

const m = (value: number, unit = "USD"): Metric => ({
  key: "k", value, unit, year: 2023, sourceId: "s", sourceUrl: "u", level: "country",
});

describe("comparePlaces", () => {
  it("does not invent values for missing data", () => {
    const rows = comparePlaces(
      { label: "A", metrics: { x: m(100) } },
      { label: "B", metrics: {} },
    );
    expect(rows[0].b).toBeUndefined();
    expect(rows[0].pctDiff).toBeUndefined();
  });
  it("refuses to diff mismatched units", () => {
    const rows = comparePlaces(
      { label: "A", metrics: { x: m(100, "USD") } },
      { label: "B", metrics: { x: m(50, "EUR") } },
    );
    expect(rows[0].pctDiff).toBeUndefined();
  });
  it("computes pct difference", () => {
    const rows = comparePlaces(
      { label: "A", metrics: { x: m(100) } },
      { label: "B", metrics: { x: m(150) } },
    );
    expect(rows[0].pctDiff).toBeCloseTo(0.5);
  });
});

describe("projectRetirement", () => {
  const base = {
    currentAge: 60, retireAge: 65, savings: 0, annualContribution: 0,
    annualSpending: 10000, statePension: 0, planToAge: 85, realReturn: 0,
  };
  it("zero return: runs out when balance / need is exhausted", () => {
    const r = projectRetirement({ ...base, savings: 100000 });
    expect(r.depletedAtAge).toBe(75);
    expect(r.sufficient).toBe(false);
  });
  it("state pension covering spending is always sufficient", () => {
    expect(projectRetirement({ ...base, statePension: 10000 }).sufficient).toBe(true);
  });
});
