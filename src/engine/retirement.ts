export interface RetirementInput {
  currentAge: number;
  retireAge: number;
  savings: number;
  annualContribution: number;
  /** Annual spending in retirement, in today's money. */
  annualSpending: number;
  /** Annual state pension in today's money (from published replacement rates); 0 if none. */
  statePension: number;
  /** Age to plan funds until (from published life tables). */
  planToAge: number;
  /** Real (inflation-adjusted) annual return, e.g. a historical-range scenario. */
  realReturn: number;
}

export interface RetirementResult {
  balanceAtRetirement: number;
  /** Age at which funds run out, or undefined if they last to planToAge. */
  depletedAtAge?: number;
  fundedToAge: number;
  sufficient: boolean;
}

/** Real-terms projection. Returns are an input (scenario) — nothing is assumed here. */
export function projectRetirement(i: RetirementInput): RetirementResult {
  let balance = i.savings;
  for (let age = i.currentAge; age < i.retireAge; age++) {
    balance = balance * (1 + i.realReturn) + i.annualContribution;
  }
  const balanceAtRetirement = balance;
  const need = Math.max(0, i.annualSpending - i.statePension);

  let depletedAtAge: number | undefined;
  for (let age = i.retireAge; age < i.planToAge; age++) {
    balance = balance * (1 + i.realReturn) - need;
    if (balance < 0) {
      depletedAtAge = age;
      break;
    }
  }
  return {
    balanceAtRetirement,
    depletedAtAge,
    fundedToAge: depletedAtAge ?? i.planToAge,
    sufficient: depletedAtAge === undefined,
  };
}
