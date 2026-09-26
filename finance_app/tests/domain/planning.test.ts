import { describe, expect, it } from 'vitest';
import { compoundGrowth } from '@domain/planning/compound';
import { projectGoal } from '@domain/planning/goals';
import { compareLoanResults, minimumRepayment, offsetAnnualEffect, simulateDebts, simulateLoan } from '@domain/planning/loans';
import { tdLadder, tdSchedule } from '@domain/planning/termDeposits';
import { ForecastAssumptions, compareScenarios, runForecast, scenarioTemplates } from '@domain/planning/forecast';

describe('compound growth', () => {
  it('matches the textbook formula for monthly contributions and compounding', () => {
    const r = compoundGrowth({ openingCents: 1000000, contributionCents: 50000, contributionFrequency: 'monthly', annualRatePercent: 5, compounding: 'monthly', years: 10 });
    const i = 0.05 / 12;
    const n = 120;
    const expected = 1000000 * Math.pow(1 + i, n) + 50000 * ((Math.pow(1 + i, n) - 1) / i);
    expect(r.finalCents).toBe(Math.round(expected));
    expect(r.totalContributionsCents).toBe(6000000);
    expect(r.growthCents).toBe(r.finalCents - 1000000 - 6000000);
    expect(r.years).toHaveLength(10);
    expect(r.assumptions.join(' ')).toMatch(/not a guaranteed return/);
  });

  it('handles zero interest and annual compounding with monthly contributions', () => {
    expect(compoundGrowth({ openingCents: 100, contributionCents: 100, contributionFrequency: 'weekly', annualRatePercent: 0, compounding: 'annually', years: 1 }).finalCents).toBe(100 + 5200);
    const r = compoundGrowth({ openingCents: 1000000, contributionCents: 0, contributionFrequency: 'monthly', annualRatePercent: 6, compounding: 'annually', years: 2 });
    expect(r.finalCents).toBe(Math.round(1000000 * 1.06 * 1.06));
  });
});

describe('savings goals', () => {
  it('projects a completion date and the contribution needed by a target date', () => {
    const p = projectGoal({ id: 'g', name: 'Holiday', type: 'holiday', targetCents: 600000, currentCents: 100000, contributionCents: 50000, contributionFrequency: 'monthly', annualRatePercent: 0, targetDate: '2027-03-27' }, '2026-09-27');
    expect(p.remainingCents).toBe(500000);
    expect(p.periodsNeeded).toBe(10);
    expect(p.projectedDate).toBe('2027-07-27');
    expect(p.requiredContributionCents).toBe(Math.ceil(500000 / 6));
    expect(p.reachesTargetByDate).toBe(false);
    expect(p.explanation).toMatch(/would reach \$6,000\.00 around 27 Jul 2027/);
  });

  it('reports when a goal cannot be reached', () => {
    const p = projectGoal({ id: 'g', name: 'x', type: 'custom', targetCents: 100000, currentCents: 0, contributionCents: 0, contributionFrequency: 'monthly', annualRatePercent: 0 }, '2026-09-27');
    expect(p.projectedDate).toBeNull();
  });
});

describe('mortgage', () => {
  it('calculates the standard minimum repayment', () => {
    expect(minimumRepayment(50000000, 6, 360, 'monthly')).toBe(299776);
    expect(minimumRepayment(1200000, 0, 12, 'monthly')).toBe(100000);
  });

  it('repays over about the original term with daily interest', () => {
    const r = simulateLoan({ principalCents: 50000000, annualRatePercent: 6, startDate: '2026-10-01', repaymentFrequency: 'monthly', remainingTermMonths: 360 });
    expect(r.payoffDate).not.toBeNull();
    expect(r.months).toBeGreaterThanOrEqual(358);
    expect(r.months).toBeLessThanOrEqual(366);
    expect(r.totalInterestCents).toBeGreaterThan(57000000);
    expect(r.totalInterestCents).toBeLessThan(58500000);
    expect(r.explanation).toMatch(/^Under these assumptions/);
  });

  it('shows the effect of an offset and extra repayments', () => {
    const base = { principalCents: 50000000, annualRatePercent: 6, startDate: '2026-10-01', repaymentFrequency: 'monthly' as const, repaymentCents: 299776 };
    const plain = simulateLoan(base);
    const withOffset = simulateLoan({ ...base, offset: { balanceCents: 5000000 } });
    const withExtra = simulateLoan({ ...base, extraRepaymentCents: 50000 });
    expect(withOffset.totalInterestCents).toBeLessThan(plain.totalInterestCents);
    expect(withOffset.months!).toBeLessThan(plain.months!);
    expect(withExtra.months!).toBeLessThan(plain.months!);
    const cmp = compareLoanResults(plain, withOffset, 'With a $50,000 offset');
    expect(cmp.interestDifferenceCents).toBeGreaterThan(0);
    expect(cmp.sentence).toMatch(/less\), repaid about \d+ months sooner, under these assumptions\./);
    const eff = offsetAnnualEffect(50000000, 5000000, 6);
    expect(eff.differenceCents).toBe(300000);
  });

  it('supports fortnightly repayments, lump sums and rate changes', () => {
    const monthly = simulateLoan({ principalCents: 30000000, annualRatePercent: 5.9, startDate: '2026-10-01', repaymentFrequency: 'monthly', remainingTermMonths: 300 });
    const fortnightlyHalf = simulateLoan({ principalCents: 30000000, annualRatePercent: 5.9, startDate: '2026-10-01', repaymentFrequency: 'fortnightly', repaymentCents: Math.ceil(monthly.repaymentCents / 2) });
    // Half the monthly repayment every fortnight = 13 monthly repayments a year.
    expect(fortnightlyHalf.months!).toBeLessThan(monthly.months!);
    const higher = simulateLoan({ principalCents: 30000000, annualRatePercent: 5.9, startDate: '2026-10-01', repaymentFrequency: 'monthly', repaymentCents: monthly.repaymentCents, rateChanges: [{ date: '2027-01-01', annualRatePercent: 6.9 }] });
    expect(higher.totalInterestCents).toBeGreaterThan(monthly.totalInterestCents);
    const lump = simulateLoan({ principalCents: 30000000, annualRatePercent: 5.9, startDate: '2026-10-01', repaymentFrequency: 'monthly', repaymentCents: monthly.repaymentCents, lumpSums: [{ date: '2027-06-30', amountCents: 2000000 }] });
    expect(lump.totalInterestCents).toBeLessThan(monthly.totalInterestCents);
  });

  it('detects repayments that do not cover interest', () => {
    const r = simulateLoan({ principalCents: 50000000, annualRatePercent: 6, startDate: '2026-10-01', repaymentFrequency: 'monthly', repaymentCents: 100000 });
    expect(r.neverRepaid).toBe(true);
    expect(r.payoffDate).toBeNull();
  });
});

describe('other debts', () => {
  it('pays off debts and rolls payments forward in the chosen order', () => {
    const debts = [
      { id: 'cc', name: 'Card', balanceCents: 300000, annualRatePercent: 20, monthlyPaymentCents: 10000 },
      { id: 'car', name: 'Car loan', balanceCents: 1000000, annualRatePercent: 8, monthlyPaymentCents: 30000 },
    ];
    const listed = simulateDebts(debts, '2026-10-01', 'as-listed', 20000);
    const smallest = simulateDebts(debts, '2026-10-01', 'smallest-balance-first', 20000);
    expect(listed.debts.every((d) => d.months !== null)).toBe(true);
    expect(listed.debts[0].months!).toBeLessThan(listed.debts[1].months!);
    expect(smallest.totalInterestCents).toBeGreaterThan(0);
    const stuck = simulateDebts([{ id: 'x', name: 'x', balanceCents: 1000000, annualRatePercent: 24, monthlyPaymentCents: 10000 }], '2026-10-01');
    expect(stuck.debts[0].neverRepaid).toBe(true);
  });
});

describe('term deposits', () => {
  const base = { id: 'a', institution: 'Example Bank', principalCents: 5000000, startDate: '2026-09-01', maturityDate: '2027-09-01', annualRatePercent: 4.5 };

  it('calculates interest paid at maturity', () => {
    const s = tdSchedule({ ...base, interestFrequency: 'at-maturity', interestHandling: 'paid-out' });
    expect(s.totalInterestCents).toBe(225000);
    expect(s.maturityValueCents).toBe(5225000);
    expect(s.termDays).toBe(365);
  });

  it('compounds or pays out monthly interest', () => {
    const paid = tdSchedule({ ...base, interestFrequency: 'monthly', interestHandling: 'paid-out' });
    const comp = tdSchedule({ ...base, interestFrequency: 'monthly', interestHandling: 'compound' });
    expect(paid.payments).toHaveLength(12);
    expect(paid.payments.slice(0, 11).every((p) => p.paidOut)).toBe(true);
    expect(paid.maturityValueCents).toBe(5000000 + paid.payments[11].interestCents);
    expect(comp.totalInterestCents).toBeGreaterThan(paid.totalInterestCents);
    expect(comp.maturityValueCents).toBe(5000000 + comp.totalInterestCents);
  });

  it('builds a maturity ladder', () => {
    const ladder = tdLadder([
      { ...base, id: 'b', maturityDate: '2027-06-01', interestFrequency: 'at-maturity', interestHandling: 'paid-out' },
      { ...base, id: 'a', maturityDate: '2027-03-01', interestFrequency: 'at-maturity', interestHandling: 'paid-out' },
    ], '2026-09-27');
    expect(ladder.map((r) => r.td.id)).toEqual(['a', 'b']);
    expect(ladder[1].cumulativeAvailableCents).toBe(ladder[0].maturityValueCents + ladder[1].maturityValueCents);
  });
});

function assumptions(over: Partial<ForecastAssumptions> = {}): ForecastAssumptions {
  return {
    startDate: '2026-10-01',
    months: 12,
    startingCashCents: 1000000,
    startingCashAsOf: '2026-09-27',
    startingCashNote: '',
    inflationPercent: 0,
    wageGrowthPercent: 0,
    savingsInterestPercent: 0,
    investmentReturnPercent: 0,
    startingInvestmentsCents: 0,
    streams: [
      { id: 'pay', name: 'Salary', direction: 'in', kind: 'employment', amountCents: 400000, frequency: 'fortnightly', startDate: '2026-10-02' },
      { id: 'living', name: 'Everyday spending', direction: 'out', kind: 'living', amountCents: 150000, frequency: 'weekly', startDate: '2026-10-01' },
      { id: 'rates', name: 'Council rates', direction: 'out', kind: 'bill', amountCents: 50000, frequency: 'quarterly', startDate: '2026-11-15' },
    ],
    oneOffs: [],
    termDeposits: [],
    mortgage: null,
    lowBalanceThresholdCents: 200000,
    ...over,
  };
}

describe('forecasting', () => {
  it('projects a steady path', () => {
    const r = runForecast(assumptions());
    // 26 pays (2 Oct 2026 … 17 Sep 2027), 53 weekly spending dates in 365 days, 4 rates instalments.
    expect(r.totals.incomeCents).toBe(26 * 400000);
    expect(r.totals.spendingCents).toBe(53 * 150000 + 4 * 50000);
    expect(r.end.cashCents).toBe(1000000 + 26 * 400000 - 53 * 150000 - 4 * 50000);
    expect(r.firstBelowZero).toBeNull();
    expect(r.summary).toMatch(/^Under the assumptions entered, the projected cash balance stays positive/);
  });

  it('models income stopping and finds when cash runs out', () => {
    const scenario = { id: 's', name: 'Career break', changes: [{ type: 'stop-income' as const, date: '2026-12-01' }] };
    const r = runForecast(assumptions(), scenario);
    expect(r.firstBelowZero).not.toBeNull();
    expect(r.summary).toMatch(/retains a positive cash balance until approximately/);
    const base = runForecast(assumptions());
    expect(runForecast(assumptions()).end.cashCents).toBe(base.end.cashCents); // scenarios never change the base
  });

  it('applies income changes, inflation and one-offs', () => {
    const cut = runForecast(assumptions(), { id: 's', name: 'Reduced hours', changes: [{ type: 'change-income', date: '2027-04-01', percentChange: -50 }] });
    const base = runForecast(assumptions());
    expect(cut.totals.incomeCents).toBeLessThan(base.totals.incomeCents);
    const inflated = runForecast(assumptions({ months: 24, inflationPercent: 10 }));
    const flat = runForecast(assumptions({ months: 24 }));
    expect(inflated.totals.spendingCents).toBeGreaterThan(flat.totals.spendingCents);
    const purchase = runForecast(assumptions(), { id: 'p', name: 'Car', changes: [{ type: 'one-off', date: '2027-01-10', amountCents: -2000000, label: 'Car' }] });
    expect(base.end.cashCents - purchase.end.cashCents).toBe(2000000);
    expect(purchase.events.find((e) => e.label === 'Car')?.amountCents).toBe(-2000000);
  });

  it('flags negative cash flow and the low point', () => {
    const r = runForecast(assumptions({ startingCashCents: 100000, streams: [{ id: 'x', name: 'Rent', direction: 'out', kind: 'bill', amountCents: 60000, frequency: 'weekly', startDate: '2026-10-05' }] }));
    expect(r.firstBelowThreshold).toBe('2026-10-01');
    expect(r.firstBelowZero).toBe('2026-10-12');
    expect(r.lowest.cashCents).toBeLessThan(0);
  });

  it('returns term deposits to cash at maturity and tracks a mortgage with offset', () => {
    const r = runForecast(assumptions({
      termDeposits: [{ id: 't', label: 'TD A', maturityDate: '2027-03-01', principalCents: 5000000, maturityValueCents: 5112000 }],
      mortgage: { balanceCents: 40000000, annualRatePercent: 6, repaymentCents: 250000, frequency: 'monthly', firstRepaymentDate: '2026-10-15', offsetIsCash: true },
    }));
    expect(r.events.find((e) => e.kind === 'td-maturity')?.amountCents).toBe(5112000);
    expect(r.end.termDepositsCents).toBe(0);
    expect(r.end.mortgageCents).toBeLessThan(40000000);
    const noOffset = runForecast(assumptions({ mortgage: { balanceCents: 40000000, annualRatePercent: 6, repaymentCents: 250000, frequency: 'monthly', firstRepaymentDate: '2026-10-15', offsetIsCash: false } }));
    expect(r.totals.mortgageInterestCents).toBeLessThan(noOffset.totals.mortgageInterestCents);
  });

  it('adds assumed savings interest and investment growth', () => {
    const r = runForecast(assumptions({ savingsInterestPercent: 4.2, investmentReturnPercent: 5, startingInvestmentsCents: 1000000 }));
    expect(r.totals.savingsInterestCents).toBeGreaterThan(0);
    expect(r.end.investmentsCents).toBeGreaterThan(1040000);
    expect(r.end.investmentsCents).toBeLessThan(1060000);
  });

  it('compares scenarios without ranking them', () => {
    const tpls = scenarioTemplates('2026-10-01', 6);
    const rows = compareScenarios(tpls.slice(0, 2).map((s) => ({ scenario: s, result: runForecast(assumptions(), s) })));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sentence).join(' ')).not.toMatch(/better|best|worse|should/i);
    expect(tpls.find((t) => t.id === 'tpl-mortgage')?.changes[0]).toMatchObject({ type: 'mortgage-rate', annualRatePercent: 7 });
  });
});
