import { ISODate, diffDays, fyRange, formatDate } from '../dates';
import { Cents, formatMoney } from '../money';

/**
 * Payslips hold the gross/taxable figures and tax withheld that a bank deposit (net pay)
 * cannot show. A deposit is linked to its payslip rather than treated as taxable income.
 */
export interface Payslip {
  id: string;
  employer: string;
  payDate: ISODate;
  periodStart?: ISODate | null;
  periodEnd?: ISODate | null;
  /** Total gross pay, including allowances. */
  grossCents: Cents;
  allowancesCents: Cents;
  /** Pre-tax salary sacrifice to super (reduces taxable pay). */
  salarySacrificeCents: Cents;
  /** Defaults to gross − salary sacrifice when not entered. */
  taxableCents?: Cents | null;
  paygCents: Cents;
  employerSuperCents: Cents;
  /** After-tax deductions (e.g. union fees, novated lease post-tax). */
  deductionsCents: Cents;
  netCents: Cents;
  linkedTransactionId?: string | null;
}

export function taxablePay(p: Payslip): Cents {
  return p.taxableCents ?? p.grossCents - p.salarySacrificeCents;
}

export function payslipIssues(p: Payslip): string[] {
  const issues: string[] = [];
  const expectedNet = p.grossCents - p.salarySacrificeCents - p.paygCents - p.deductionsCents;
  if (Math.abs(expectedNet - p.netCents) > 1) {
    issues.push(`Net pay ${formatMoney(p.netCents)} does not equal gross ${formatMoney(p.grossCents)} less salary sacrifice, tax withheld and deductions (${formatMoney(expectedNet)}). Difference: ${formatMoney(Math.abs(expectedNet - p.netCents))}.`);
  }
  if (p.paygCents > p.grossCents) issues.push('Tax withheld is more than gross pay.');
  if (p.periodStart && p.periodEnd && p.periodStart > p.periodEnd) issues.push('The pay period ends before it starts.');
  return issues;
}

/** Find the bank deposit matching a payslip's net pay (same amount within a few days of pay day). */
export function matchPayslipDeposit(p: Payslip, deposits: { id: string; date: ISODate; amountCents: Cents; description: string }[], windowDays = 4): { id: string; exactDate: boolean } | null {
  const cands = deposits
    .filter((d) => d.amountCents === p.netCents && Math.abs(diffDays(p.payDate, d.date)) <= windowDays)
    .sort((a, b) => Math.abs(diffDays(p.payDate, a.date)) - Math.abs(diffDays(p.payDate, b.date)));
  if (!cands.length) return null;
  return { id: cands[0].id, exactDate: cands[0].date === p.payDate };
}

export interface PayslipTotals {
  count: number;
  grossCents: Cents;
  taxableCents: Cents;
  allowancesCents: Cents;
  paygCents: Cents;
  employerSuperCents: Cents;
  salarySacrificeCents: Cents;
  netCents: Cents;
  employers: string[];
  firstPayDate: ISODate | null;
  lastPayDate: ISODate | null;
  explanation: string;
}

/** Totals for a financial year, by pay date (the ATO counts income when paid). */
export function payslipTotals(payslips: Payslip[], fy: string): PayslipTotals {
  const { start, end } = fyRange(fy);
  const inYear = payslips.filter((p) => p.payDate >= start && p.payDate <= end).sort((a, b) => a.payDate.localeCompare(b.payDate));
  const sum = (f: (p: Payslip) => number) => inYear.reduce((a, p) => a + f(p), 0);
  const totals = {
    count: inYear.length,
    grossCents: sum((p) => p.grossCents),
    taxableCents: sum(taxablePay),
    allowancesCents: sum((p) => p.allowancesCents),
    paygCents: sum((p) => p.paygCents),
    employerSuperCents: sum((p) => p.employerSuperCents),
    salarySacrificeCents: sum((p) => p.salarySacrificeCents),
    netCents: sum((p) => p.netCents),
    employers: [...new Set(inYear.map((p) => p.employer))],
    firstPayDate: inYear[0]?.payDate ?? null,
    lastPayDate: inYear[inYear.length - 1]?.payDate ?? null,
  };
  return {
    ...totals,
    explanation: inYear.length
      ? `${inYear.length} payslip${inYear.length === 1 ? '' : 's'} paid between ${formatDate(totals.firstPayDate)} and ${formatDate(totals.lastPayDate)}: taxable pay ${formatMoney(totals.taxableCents)}, tax withheld ${formatMoney(totals.paygCents)}.`
      : 'No payslips recorded for this financial year.',
  };
}
