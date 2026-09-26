import { ISODate, addDays, addMonths, diffDays, formatDate, parts, daysInMonth, makeDate } from '../dates';
import { Cents, formatMoney, roundCents } from '../money';
import { FREQUENCY_LABEL, PERIODS_PER_YEAR } from '../periods';
import { nthOccurrence } from '../schedule';

/**
 * Mortgage and loan modelling, including Australian offset accounts.
 *
 * Method (the common Australian lender approach): interest accrues daily on
 * (loan balance − offset balance) at the annual rate ÷ 365 and is charged monthly;
 * repayments reduce the balance on their due dates. All results are "under these
 * assumptions" — future rates are not predicted.
 */

export type RepaymentFrequency = 'weekly' | 'fortnightly' | 'monthly';

export interface LoanInput {
  principalCents: Cents;
  annualRatePercent: number;
  startDate: ISODate;
  repaymentFrequency: RepaymentFrequency;
  /** If omitted, the minimum repayment for `remainingTermMonths` is used. */
  repaymentCents?: Cents | null;
  remainingTermMonths?: number | null;
  firstRepaymentDate?: ISODate | null;
  extraRepaymentCents?: Cents;
  lumpSums?: { date: ISODate; amountCents: Cents }[];
  rateChanges?: { date: ISODate; annualRatePercent: number }[];
  offset?: {
    balanceCents: Cents;
    /** Added to the offset balance each month (can be negative). */
    monthlyChangeCents?: Cents;
    /** Set the offset balance to a new value from a date. */
    changes?: { date: ISODate; balanceCents: Cents }[];
  } | null;
  maxYears?: number;
}

export interface LoanYear {
  year: number;
  endDate: ISODate;
  openingCents: Cents;
  interestCents: Cents;
  principalCents: Cents;
  closingCents: Cents;
  offsetCents: Cents;
}

export interface LoanResult {
  repaymentCents: Cents;
  payoffDate: ISODate | null;
  months: number | null;
  totalInterestCents: Cents;
  totalRepaidCents: Cents;
  neverRepaid: boolean;
  years: LoanYear[];
  monthlyBalances: { date: ISODate; balanceCents: Cents; offsetCents: Cents }[];
  assumptions: string[];
  explanation: string;
}

/** Standard amortising repayment for a term (rate ÷ periods per year). */
export function minimumRepayment(principalCents: Cents, annualRatePercent: number, termMonths: number, frequency: RepaymentFrequency): Cents {
  const ppy = PERIODS_PER_YEAR[frequency];
  const n = Math.max(1, Math.round((termMonths / 12) * ppy));
  const i = annualRatePercent / 100 / ppy;
  if (i === 0) return Math.ceil(principalCents / n);
  return Math.ceil((principalCents * i) / (1 - Math.pow(1 + i, -n)));
}

function isChargeDay(date: ISODate, anchorDay: number): boolean {
  const { y, m, d } = parts(date);
  return d === Math.min(anchorDay, daysInMonth(y, m));
}

export function simulateLoan(input: LoanInput): LoanResult {
  const start = input.startDate;
  const term = input.remainingTermMonths ?? 300;
  const repayment = input.repaymentCents ?? minimumRepayment(input.principalCents, input.annualRatePercent, term, input.repaymentFrequency);
  const extra = input.extraRepaymentCents ?? 0;
  const firstRepayment = input.firstRepaymentDate ?? nthOccurrence({ frequency: input.repaymentFrequency, anchor: start }, 1);
  const schedule = { frequency: input.repaymentFrequency, anchor: firstRepayment };
  const rates = [...(input.rateChanges ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const lumps = [...(input.lumpSums ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const offsetChanges = [...(input.offset?.changes ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const anchorDay = parts(start).d;
  const maxDays = Math.round((input.maxYears ?? 40) * 365.25);

  let balance = input.principalCents;
  let offset = input.offset?.balanceCents ?? 0;
  let rate = input.annualRatePercent;
  let accrued = 0;
  let totalInterest = 0;
  let totalRepaid = 0;
  let nextRepayIdx = 0;
  let nextRepay = firstRepayment;
  let ri = 0, li = 0, oi = 0;
  let payoff: ISODate | null = null;

  const years: LoanYear[] = [];
  const monthly: LoanResult['monthlyBalances'] = [];
  let yearOpening = balance;
  let yearInterest = 0;
  let yearEnd = addDays(addMonths(start, 12), -1);
  let neverRepaid = false;

  for (let day = 1; day <= maxDays; day++) {
    const date = addDays(start, day);
    while (ri < rates.length && rates[ri].date <= date) rate = rates[ri++].annualRatePercent;
    while (oi < offsetChanges.length && offsetChanges[oi].date <= date) offset = offsetChanges[oi++].balanceCents;

    const effectiveOffset = Math.max(0, Math.min(offset, balance));
    accrued += ((balance - effectiveOffset) * rate) / 100 / 365;

    if (isChargeDay(date, anchorDay)) {
      const charged = roundCents(accrued);
      balance += charged;
      totalInterest += charged;
      yearInterest += charged;
      accrued = 0;
      if (input.offset?.monthlyChangeCents) offset = Math.max(0, offset + input.offset.monthlyChangeCents);
      monthly.push({ date, balanceCents: balance, offsetCents: Math.max(0, offset) });
    }
    while (li < lumps.length && lumps[li].date <= date) {
      const amt = Math.min(lumps[li++].amountCents, balance);
      balance -= amt;
      totalRepaid += amt;
    }
    if (date === nextRepay) {
      const owing = balance + roundCents(accrued);
      const pay = Math.min(repayment + extra, owing);
      if (pay >= owing) {
        // Final repayment includes interest accrued since the last charge.
        const charged = roundCents(accrued);
        totalInterest += charged;
        yearInterest += charged;
        accrued = 0;
        balance += charged;
      }
      balance -= pay;
      totalRepaid += pay;
      nextRepayIdx++;
      nextRepay = nthOccurrence(schedule, nextRepayIdx);
    }
    if (balance <= 0) {
      balance = 0;
      payoff = date;
    }
    if (date === yearEnd || payoff) {
      years.push({
        year: years.length + 1,
        endDate: date,
        openingCents: yearOpening,
        interestCents: yearInterest,
        principalCents: yearOpening - balance,
        closingCents: balance,
        offsetCents: Math.max(0, offset),
      });
      if (years.length === 1 && balance >= yearOpening && !payoff) {
        neverRepaid = true;
        break;
      }
      yearOpening = balance;
      yearInterest = 0;
      yearEnd = addDays(addMonths(start, 12 * (years.length + 1)), -1);
    }
    if (payoff) break;
  }

  const months = payoff ? Math.round(diffDays(start, payoff) / (365.25 / 12)) : null;
  const assumptions = [
    `Loan balance ${formatMoney(input.principalCents)} at ${input.annualRatePercent}% a year` +
      (rates.length ? `, changing to ${rates.map((r) => `${r.annualRatePercent}% from ${formatDate(r.date)}`).join(', ')}` : ', unchanged for the whole period'),
    `${FREQUENCY_LABEL[input.repaymentFrequency]} repayments of ${formatMoney(repayment)}` + (input.repaymentCents == null ? ` (the minimum for ${term} months)` : '') +
      (extra ? ` plus ${formatMoney(extra)} extra` : ''),
    input.offset ? `Offset balance ${formatMoney(input.offset.balanceCents)}` + (input.offset.monthlyChangeCents ? `, changing by ${formatMoney(input.offset.monthlyChangeCents)} a month` : '') + (offsetChanges.length ? ' with scheduled changes' : '') : 'No offset account',
    ...(lumps.length ? [`Lump-sum repayments: ${lumps.map((l) => `${formatMoney(l.amountCents)} on ${formatDate(l.date)}`).join(', ')}`] : []),
    'Interest calculated daily on (balance − offset) and charged monthly; fees are not included',
  ];
  let explanation: string;
  if (neverRepaid) explanation = 'Under these assumptions the repayments do not cover the interest, so the balance does not go down.';
  else if (!payoff) explanation = `Under these assumptions the loan is not repaid within ${input.maxYears ?? 40} years.`;
  else explanation = `Under these assumptions the loan would be repaid around ${formatDate(payoff)} (about ${Math.floor(months! / 12)} years ${months! % 12} months), with ${formatMoney(totalInterest)} of interest in total.`;

  return {
    repaymentCents: repayment,
    payoffDate: payoff,
    months,
    totalInterestCents: totalInterest,
    totalRepaidCents: totalRepaid,
    neverRepaid,
    years,
    monthlyBalances: monthly,
    assumptions,
    explanation,
  };
}

export interface LoanComparison {
  interestDifferenceCents: Cents;
  monthsDifference: number | null;
  sentence: string;
}

/** Neutral comparison of two loan runs (e.g. with and without offset or extra repayments). */
export function compareLoanResults(base: LoanResult, variant: LoanResult, variantLabel: string): LoanComparison {
  const diff = base.totalInterestCents - variant.totalInterestCents;
  const months = base.months !== null && variant.months !== null ? base.months - variant.months : null;
  let sentence = `${variantLabel}: total interest ${formatMoney(variant.totalInterestCents)} compared with ${formatMoney(base.totalInterestCents)}`;
  sentence += diff === 0 ? ' (no difference)' : ` (${formatMoney(Math.abs(diff))} ${diff > 0 ? 'less' : 'more'})`;
  if (months !== null && months !== 0) sentence += `, repaid about ${Math.abs(months)} month${Math.abs(months) === 1 ? '' : 's'} ${months > 0 ? 'sooner' : 'later'}`;
  return { interestDifferenceCents: diff, monthsDifference: months, sentence: sentence + ', under these assumptions.' };
}

/** Interest for one year on a balance with an offset — the simple "what the offset does" figure. */
export function offsetAnnualEffect(loanBalanceCents: Cents, offsetCents: Cents, annualRatePercent: number): { withoutOffsetCents: Cents; withOffsetCents: Cents; differenceCents: Cents; explanation: string } {
  const without = roundCents((loanBalanceCents * annualRatePercent) / 100);
  const effective = Math.max(0, loanBalanceCents - Math.min(offsetCents, loanBalanceCents));
  const withO = roundCents((effective * annualRatePercent) / 100);
  return {
    withoutOffsetCents: without,
    withOffsetCents: withO,
    differenceCents: without - withO,
    explanation: `Interest is charged on ${formatMoney(loanBalanceCents)} − ${formatMoney(Math.min(offsetCents, loanBalanceCents))} = ${formatMoney(effective)}. At ${annualRatePercent}% for a year that is about ${formatMoney(withO)} instead of ${formatMoney(without)} (before the balance falls with repayments).`,
  };
}

/* ------------------------------ other debts ------------------------------ */

export interface DebtInput {
  id: string;
  name: string;
  balanceCents: Cents;
  annualRatePercent: number;
  /** Fixed monthly payment. */
  monthlyPaymentCents: Cents;
}

export interface DebtPayoff {
  id: string;
  name: string;
  months: number | null;
  payoffDate: ISODate | null;
  totalInterestCents: Cents;
  neverRepaid: boolean;
}

export type PayoffOrder = 'as-listed' | 'highest-rate-first' | 'smallest-balance-first';

/**
 * Pays several debts monthly (interest = balance × rate ÷ 12). Each debt gets its own payment;
 * `extraMonthlyCents` goes to the first unpaid debt in the chosen order and, when a debt is
 * cleared, its payment moves to the next. The order is the user's choice — no order is suggested.
 */
export function simulateDebts(debts: DebtInput[], startDate: ISODate, order: PayoffOrder = 'as-listed', extraMonthlyCents = 0, maxMonths = 600): { debts: DebtPayoff[]; months: number | null; totalInterestCents: Cents; explanation: string } {
  const list = debts.map((d) => ({ ...d, bal: d.balanceCents, interest: 0, done: d.balanceCents <= 0, month: d.balanceCents <= 0 ? 0 : null as number | null }));
  const ordered = [...list];
  if (order === 'highest-rate-first') ordered.sort((a, b) => b.annualRatePercent - a.annualRatePercent);
  if (order === 'smallest-balance-first') ordered.sort((a, b) => a.balanceCents - b.balanceCents);
  let freed = 0;
  let m = 0;
  for (m = 1; m <= maxMonths && list.some((d) => !d.done); m++) {
    let pool = extraMonthlyCents + freed;
    for (const d of ordered) {
      if (d.done) continue;
      const interest = roundCents((d.bal * d.annualRatePercent) / 100 / 12);
      d.bal += interest;
      d.interest += interest;
      let pay = Math.min(d.monthlyPaymentCents, d.bal);
      d.bal -= pay;
      if (d.bal > 0 && pool > 0) {
        const more = Math.min(pool, d.bal);
        d.bal -= more;
        pool -= more;
        pay += more;
      }
      if (d.bal <= 0) {
        d.done = true;
        d.month = m;
        freed += d.monthlyPaymentCents;
      }
    }
    if (m === 12 && list.every((d) => d.done || d.bal >= d.balanceCents)) break;
  }
  const out: DebtPayoff[] = list.map((d) => ({
    id: d.id,
    name: d.name,
    months: d.month,
    payoffDate: d.month !== null ? addMonths(startDate, d.month) : null,
    totalInterestCents: d.interest,
    neverRepaid: d.month === null,
  }));
  const all = out.every((d) => d.months !== null) ? Math.max(...out.map((d) => d.months as number)) : null;
  const total = out.reduce((a, d) => a + d.totalInterestCents, 0);
  return {
    debts: out,
    months: all,
    totalInterestCents: total,
    explanation: `Interest each month = balance × annual rate ÷ 12. Payments are applied after interest.${extraMonthlyCents ? ` An extra ${formatMoney(extraMonthlyCents)} a month is applied in the order you chose.` : ''} Fees and rate changes are not included.`,
  };
}

/** Helper for UI date defaults. */
export function monthStart(date: ISODate): ISODate {
  const { y, m } = parts(date);
  return makeDate(y, m, 1);
}
