import { ISODate, fyRange, fyDisplay } from './dates';
import { Cents, formatMoney, roundCents } from './money';
import { rulesFor } from './tax/australia/rules';

/**
 * Superannuation tracking from statements and a projection using the user's own assumptions.
 * No fund, investment option or contribution strategy is recommended.
 */

export type SuperEntryKind =
  | 'balance' | 'employer' | 'salary-sacrifice' | 'personal-concessional' | 'non-concessional'
  | 'fees' | 'insurance' | 'earnings' | 'contributions-tax' | 'withdrawal';

export const SUPER_KIND_LABEL: Record<SuperEntryKind, string> = {
  balance: 'Balance (from statement)',
  employer: 'Employer contributions',
  'salary-sacrifice': 'Salary sacrifice',
  'personal-concessional': 'Personal contributions (claimed as deduction)',
  'non-concessional': 'Non-concessional contributions',
  fees: 'Fees',
  insurance: 'Insurance premiums',
  earnings: 'Investment earnings',
  'contributions-tax': 'Contributions tax',
  withdrawal: 'Withdrawals',
};

export interface SuperEntry {
  id: string;
  accountId: string;
  date: ISODate;
  kind: SuperEntryKind;
  amountCents: Cents;
}

export interface SuperYearSummary {
  fy: string;
  employerCents: Cents;
  salarySacrificeCents: Cents;
  personalConcessionalCents: Cents;
  concessionalTotalCents: Cents;
  nonConcessionalCents: Cents;
  feesCents: Cents;
  insuranceCents: Cents;
  earningsCents: Cents;
  /** Tax deducted inside the fund (contributions tax etc.), less tax benefits on fees. Not personal tax. */
  fundTaxCents: Cents;
  concessionalCapCents: Cents | null;
  nonConcessionalCapCents: Cents | null;
  capStatus: string | null;
  notes: string[];
}

export function superYearSummary(entries: SuperEntry[], fy: string): SuperYearSummary {
  const { start, end } = fyRange(fy);
  const inYear = entries.filter((e) => e.date >= start && e.date <= end);
  const sum = (k: SuperEntryKind) => inYear.filter((e) => e.kind === k).reduce((a, e) => a + Math.abs(e.amountCents), 0);
  const employer = sum('employer');
  const ss = sum('salary-sacrifice');
  const pc = sum('personal-concessional');
  const rules = rulesFor(fy);
  const caps = rules?.rules.superannuation;
  const notes = [
    'Contribution caps are shown for information only. Whether a cap applies to you (for example carry-forward of unused concessional cap, or the bring-forward rule) depends on your circumstances.',
  ];
  if (caps?.note) notes.push(caps.note);
  return {
    fy,
    employerCents: employer,
    salarySacrificeCents: ss,
    personalConcessionalCents: pc,
    concessionalTotalCents: employer + ss + pc,
    nonConcessionalCents: sum('non-concessional'),
    feesCents: sum('fees'),
    insuranceCents: sum('insurance'),
    earningsCents: inYear.filter((e) => e.kind === 'earnings').reduce((a, e) => a + e.amountCents, 0),
    fundTaxCents: inYear.filter((e) => e.kind === 'contributions-tax').reduce((a, e) => a + e.amountCents, 0),
    concessionalCapCents: caps ? caps.value.concessionalCap * 100 : null,
    nonConcessionalCapCents: caps ? caps.value.nonConcessionalCap * 100 : null,
    capStatus: caps ? `${fyDisplay(fy)} caps: ${caps.status}` : null,
    notes,
  };
}

export function superBalanceHistory(entries: SuperEntry[], accountId?: string): { date: ISODate; balanceCents: Cents }[] {
  // One point per account per date (a statement balance can arrive both typed in and imported).
  const byKey = new Map<string, SuperEntry>();
  for (const e of entries) if (e.kind === 'balance' && (!accountId || e.accountId === accountId)) byKey.set(`${e.accountId}|${e.date}`, e);
  const perDate = new Map<ISODate, Cents>();
  for (const e of byKey.values()) perDate.set(e.date, (perDate.get(e.date) ?? 0) + e.amountCents);
  return [...perDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, balanceCents]) => ({ date, balanceCents }));
}

export interface SuperProjectionInput {
  startingBalanceCents: Cents;
  /** Before-tax contributions each year (employer + salary sacrifice). */
  annualConcessionalCents: Cents;
  /** Tax on concessional contributions (%), commonly 15. */
  contributionsTaxPercent: number;
  annualNonConcessionalCents: Cents;
  /** Assumed net return after investment fees (% p.a.). */
  returnPercent: number;
  annualFeesCents: Cents;
  years: number;
  /** Contributions grow each year by this (%), e.g. wage growth. */
  contributionGrowthPercent: number;
}

export function projectSuper(input: SuperProjectionInput): { years: { year: number; balanceCents: Cents; contributionsCents: Cents; earningsCents: Cents }[]; finalCents: Cents; assumptions: string[] } {
  let bal = input.startingBalanceCents;
  let conc = input.annualConcessionalCents;
  let nonc = input.annualNonConcessionalCents;
  const years: { year: number; balanceCents: Cents; contributionsCents: Cents; earningsCents: Cents }[] = [];
  for (let y = 1; y <= input.years; y++) {
    const netContrib = conc * (1 - input.contributionsTaxPercent / 100) + nonc;
    // Contributions arrive through the year: on average half a year of returns.
    const earnings = bal * (input.returnPercent / 100) + netContrib * (input.returnPercent / 100) / 2;
    bal = bal + netContrib + earnings - input.annualFeesCents;
    years.push({ year: y, balanceCents: roundCents(bal), contributionsCents: roundCents(netContrib), earningsCents: roundCents(earnings) });
    conc *= 1 + input.contributionGrowthPercent / 100;
    nonc *= 1 + input.contributionGrowthPercent / 100;
  }
  return {
    years,
    finalCents: roundCents(bal),
    assumptions: [
      `Starting balance ${formatMoney(input.startingBalanceCents)}`,
      `Before-tax contributions ${formatMoney(input.annualConcessionalCents)} a year, less ${input.contributionsTaxPercent}% contributions tax, growing ${input.contributionGrowthPercent}% a year`,
      `After-tax contributions ${formatMoney(input.annualNonConcessionalCents)} a year`,
      `Assumed return ${input.returnPercent}% a year after investment fees; admin fees ${formatMoney(input.annualFeesCents)} a year`,
      'Your own assumptions — not a prediction of fund performance, and not advice about funds, options or contributions',
    ],
  };
}
