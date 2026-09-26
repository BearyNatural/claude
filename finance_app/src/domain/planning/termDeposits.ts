import { ISODate, addMonths, diffDays, formatDate } from '../dates';
import { Cents, formatMoney, roundCents } from '../money';

/**
 * Term-deposit interest and maturity schedules (simple interest per period on the
 * actual number of days ÷ 365, the usual Australian convention).
 */

export type TdInterestFrequency = 'at-maturity' | 'monthly' | 'quarterly' | 'annually';

export interface TermDeposit {
  id: string;
  institution: string;
  name?: string | null;
  principalCents: Cents;
  startDate: ISODate;
  maturityDate: ISODate;
  annualRatePercent: number;
  interestFrequency: TdInterestFrequency;
  /** Interest added to the deposit (compounding) or paid out to another account. */
  interestHandling: 'compound' | 'paid-out';
  interestDestination?: string | null;
  notes?: string | null;
}

export interface TdPayment {
  date: ISODate;
  interestCents: Cents;
  days: number;
  paidOut: boolean;
}

export interface TdSchedule {
  payments: TdPayment[];
  totalInterestCents: Cents;
  maturityValueCents: Cents;
  maturityDate: ISODate;
  termDays: number;
  explanation: string;
}

const STEP: Record<Exclude<TdInterestFrequency, 'at-maturity'>, number> = { monthly: 1, quarterly: 3, annually: 12 };

export function tdSchedule(td: TermDeposit): TdSchedule {
  const payments: TdPayment[] = [];
  let principal = td.principalCents;
  let total = 0;
  const dates: ISODate[] = [];
  if (td.interestFrequency === 'at-maturity') dates.push(td.maturityDate);
  else {
    for (let k = 1; ; k++) {
      const d = addMonths(td.startDate, STEP[td.interestFrequency] * k);
      if (d >= td.maturityDate) break;
      dates.push(d);
    }
    dates.push(td.maturityDate);
  }
  let prev = td.startDate;
  for (const d of dates) {
    const days = diffDays(prev, d);
    const interest = roundCents((principal * td.annualRatePercent) / 100 * (days / 365));
    total += interest;
    const isLast = d === td.maturityDate;
    const paidOut = td.interestHandling === 'paid-out' && !isLast;
    if (td.interestHandling === 'compound') principal += interest;
    payments.push({ date: d, interestCents: interest, days, paidOut });
    prev = d;
  }
  const finalInterest = payments[payments.length - 1]?.interestCents ?? 0;
  const maturityValue = td.interestHandling === 'compound' ? principal : td.principalCents + finalInterest;
  return {
    payments,
    totalInterestCents: total,
    maturityValueCents: maturityValue,
    maturityDate: td.maturityDate,
    termDays: diffDays(td.startDate, td.maturityDate),
    explanation:
      `Interest = balance × ${td.annualRatePercent}% × days ÷ 365 for each ${td.interestFrequency === 'at-maturity' ? 'term' : td.interestFrequency.replace('ly', '')} ` +
      `(${td.interestHandling === 'compound' ? 'added to the deposit' : 'paid out as it is earned'}). ` +
      `Expected at maturity on ${formatDate(td.maturityDate)}: ${formatMoney(maturityValue)}; total interest ${formatMoney(total)}. Uses the rate you entered; check your deposit confirmation.`,
  };
}

export interface LadderRung {
  td: TermDeposit;
  maturityDate: ISODate;
  principalCents: Cents;
  interestCents: Cents;
  maturityValueCents: Cents;
  /** Cash that has become available from all deposits up to and including this date. */
  cumulativeAvailableCents: Cents;
  daysUntil: number;
}

/** Maturity timeline for several term deposits. Descriptive only — no deposit is suggested. */
export function tdLadder(tds: TermDeposit[], today: ISODate): LadderRung[] {
  const rungs = tds
    .map((td) => ({ td, s: tdSchedule(td) }))
    .sort((a, b) => a.s.maturityDate.localeCompare(b.s.maturityDate));
  let cumulative = 0;
  return rungs.map(({ td, s }) => {
    const paidOutEarlier = s.payments.filter((p) => p.paidOut).reduce((a, p) => a + p.interestCents, 0);
    cumulative += s.maturityValueCents + paidOutEarlier;
    return {
      td,
      maturityDate: s.maturityDate,
      principalCents: td.principalCents,
      interestCents: s.totalInterestCents,
      maturityValueCents: s.maturityValueCents,
      cumulativeAvailableCents: cumulative,
      daysUntil: diffDays(today, s.maturityDate),
    };
  });
}
