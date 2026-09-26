import { ISODate, addDays, diffDays, formatDate, formatMonth, eachMonthStart, endOfMonth, maxDate, minDate, startOfMonth } from './dates';
import { Cents, formatMoney, roundCents } from './money';
import { DateRange, Frequency, PERIODS_PER_YEAR, lengthInDays, intersect, PER_LABEL } from './periods';
import { CategoryKind, CategoryNature, IncomeType } from './categorise/categories';

/**
 * Historical analysis. Everything here works on posted (approved) transactions only and
 * returns the basis of each figure so the UI can answer "How was this calculated?".
 */

export interface AnalysisTx {
  id: string;
  accountId: string;
  date: ISODate;
  amountCents: Cents;
  description: string;
  categoryId: string | null;
  /** Transfers between the user's own accounts are excluded from spending and income. */
  isTransfer: boolean;
  isOneOff?: boolean;
  incomeType?: IncomeType | null;
  splits?: { categoryId: string | null; amountCents: Cents }[];
  tags?: string[];
}

export interface CategoryInfo {
  id: string;
  name: string;
  parentId: string | null;
  kind: CategoryKind;
  nature: CategoryNature | null;
}

export type CategoryMap = Map<string, CategoryInfo>;

export interface Basis {
  transactionCount: number;
  from: ISODate;
  to: ISODate;
  days: number;
  description: string;
}

/** A transaction's category allocations (split transactions have several). */
export function allocations(tx: AnalysisTx): { categoryId: string | null; amountCents: Cents }[] {
  if (tx.splits && tx.splits.length) return tx.splits;
  return [{ categoryId: tx.categoryId, amountCents: tx.amountCents }];
}

export function topLevelId(categoryId: string | null, cats: CategoryMap): string | null {
  let id = categoryId;
  let guard = 0;
  while (id && cats.get(id)?.parentId && guard++ < 10) id = cats.get(id)!.parentId;
  return id;
}

function kindOf(categoryId: string | null, cats: CategoryMap, amount: Cents): CategoryKind {
  if (categoryId && cats.get(categoryId)) return cats.get(categoryId)!.kind;
  return amount >= 0 ? 'income' : 'expense';
}

function inRange(d: ISODate, r: DateRange) {
  return d >= r.start && d <= r.end;
}

export interface PeriodTotals {
  incomeCents: Cents;
  expenseCents: Cents;
  /** Money moved into savings/investments (savings-kind categories and transfers into saving accounts). */
  savingsCents: Cents;
  netCashFlowCents: Cents;
  transactionCount: number;
}

/**
 * Income, spending and net cash flow for a period.
 * Expenses are reported as positive numbers; refunds within an expense category reduce spending.
 */
export function periodTotals(txs: AnalysisTx[], range: DateRange, cats: CategoryMap, savingsAccountIds: Set<string> = new Set()): PeriodTotals {
  let income = 0;
  let expense = 0;
  let savings = 0;
  let count = 0;
  for (const tx of txs) {
    if (!inRange(tx.date, range)) continue;
    count++;
    if (tx.isTransfer) {
      if (savingsAccountIds.has(tx.accountId)) savings += tx.amountCents;
      continue;
    }
    for (const a of allocations(tx)) {
      const kind = kindOf(a.categoryId, cats, a.amountCents);
      if (kind === 'income') income += a.amountCents;
      else if (kind === 'expense') expense -= a.amountCents;
      else if (kind === 'savings' || kind === 'investment') savings -= a.amountCents;
    }
  }
  return { incomeCents: income, expenseCents: expense, savingsCents: savings, netCashFlowCents: income - expense, transactionCount: count };
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  kind: CategoryKind;
  nature: CategoryNature | null;
  /** Positive = money spent (expense) or received (income). */
  totalCents: Cents;
  transactionCount: number;
  oneOffCents: Cents;
}

export function categoryTotals(
  txs: AnalysisTx[],
  range: DateRange,
  cats: CategoryMap,
  opts: { level?: 'top' | 'leaf'; includeOneOffs?: boolean; kinds?: CategoryKind[] } = {},
): CategoryTotal[] {
  const level = opts.level ?? 'top';
  const kinds = opts.kinds ?? ['expense'];
  const map = new Map<string, CategoryTotal>();
  for (const tx of txs) {
    if (tx.isTransfer || !inRange(tx.date, range)) continue;
    for (const a of allocations(tx)) {
      const kind = kindOf(a.categoryId, cats, a.amountCents);
      if (!kinds.includes(kind)) continue;
      if (tx.isOneOff && opts.includeOneOffs === false) continue;
      const id = level === 'top' ? topLevelId(a.categoryId, cats) : a.categoryId;
      const key = id ?? '__uncategorised';
      const info = id ? cats.get(id) : undefined;
      const entry = map.get(key) ?? {
        categoryId: id, name: info?.name ?? 'Uncategorised', kind, nature: info?.nature ?? null,
        totalCents: 0, transactionCount: 0, oneOffCents: 0,
      };
      const signed = kind === 'income' ? a.amountCents : -a.amountCents;
      entry.totalCents += signed;
      entry.transactionCount++;
      if (tx.isOneOff) entry.oneOffCents += signed;
      map.set(key, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.totalCents - a.totalCents);
}

/** All descendant category ids (including itself). */
export function withDescendants(categoryId: string, cats: CategoryMap): Set<string> {
  const out = new Set([categoryId]);
  let added = true;
  while (added) {
    added = false;
    for (const c of cats.values()) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        added = true;
      }
    }
  }
  return out;
}

export interface Averages {
  totalCents: Cents;
  perDay: Cents;
  perWeek: Cents;
  perFortnight: Cents;
  perMonth: Cents;
  perQuarter: Cents;
  perYear: Cents;
  basis: Basis;
}

/**
 * Average spending over a range: total ÷ days represented, scaled to each period.
 * `range` should already be limited to dates the imported data actually covers.
 */
export function averages(total: Cents, range: DateRange, count: number, label: string): Averages {
  const days = Math.max(1, lengthInDays(range));
  const perDay = total / days;
  return {
    totalCents: total,
    perDay: roundCents(perDay),
    perWeek: roundCents(perDay * 7),
    perFortnight: roundCents(perDay * 14),
    perMonth: roundCents((perDay * 365.25) / 12),
    perQuarter: roundCents((perDay * 365.25) / 4),
    perYear: roundCents(perDay * 365.25),
    basis: {
      transactionCount: count,
      from: range.start,
      to: range.end,
      days,
      description: `Calculated from ${count} transaction${count === 1 ? '' : 's'} ${label} between ${formatDate(range.start, { long: true })} and ${formatDate(range.end, { long: true })} (${days} days, ${(days / 7).toFixed(1)} weeks). Average per week = total ÷ number of weeks represented.`,
    },
  };
}

export function spendingAverages(txs: AnalysisTx[], range: DateRange, cats: CategoryMap, categoryId?: string, includeOneOffs = true): Averages {
  const ids = categoryId ? withDescendants(categoryId, cats) : null;
  let total = 0;
  let count = 0;
  for (const tx of txs) {
    if (tx.isTransfer || !inRange(tx.date, range)) continue;
    if (tx.isOneOff && !includeOneOffs) continue;
    let counted = false;
    for (const a of allocations(tx)) {
      if (kindOf(a.categoryId, cats, a.amountCents) !== 'expense') continue;
      if (ids && (!a.categoryId || !ids.has(a.categoryId))) continue;
      total -= a.amountCents;
      counted = true;
    }
    if (counted) count++;
  }
  const label = categoryId ? `categorised as ${cats.get(categoryId)?.name ?? 'this category'}` : 'of spending (excluding transfers between your accounts)';
  return averages(total, range, count, label);
}

/* ------------------------------ true cost of living ------------------------------ */

export interface CostItem {
  categoryId: string | null;
  name: string;
  nature: CategoryNature | null;
  /** Actual cash spent in the analysed range. */
  actualCents: Cents;
  /** Spread-out planning equivalents (not real transactions). */
  annualCents: Cents;
  perWeekCents: Cents;
  perFortnightCents: Cents;
  perMonthCents: Cents;
  regularity: 'regular' | 'irregular';
  transactionCount: number;
  oneOffCents: Cents;
}

export interface CostOfLiving {
  range: DateRange;
  months: number;
  items: CostItem[];
  total: { annualCents: Cents; perWeekCents: Cents; perFortnightCents: Cents; perMonthCents: Cents };
  excludedOneOffCents: Cents;
  basis: string;
}

/**
 * True cost of living: annual and irregular costs spread into weekly/fortnightly/monthly
 * planning amounts. One-off transactions are excluded (and reported separately).
 * The real transactions are not changed — this is a planning view.
 */
export function trueCostOfLiving(txs: AnalysisTx[], range: DateRange, cats: CategoryMap): CostOfLiving {
  const days = lengthInDays(range);
  // A range that is already a year (365/366 days) is not rescaled.
  const yearFactor = Math.abs(days - 365.5) <= 1 ? 1 : 365.25 / days;
  const items: CostItem[] = [];
  let excluded = 0;
  const totals = categoryTotals(txs, range, cats, { level: 'leaf', includeOneOffs: true });
  // Month-by-month totals decide whether a category is regular or lumpy.
  const monthsInRange = eachMonthStart(range.start, range.end);
  const monthly = monthsInRange.map((m) => {
    const r = intersect({ start: m, end: endOfMonth(m) }, range);
    const byCat = new Map<string, number>();
    if (r) for (const x of categoryTotals(txs, r, cats, { level: 'leaf', includeOneOffs: false })) byCat.set(x.categoryId ?? '__u', x.totalCents);
    return byCat;
  });
  for (const t of totals) {
    const recurringTotal = t.totalCents - t.oneOffCents;
    excluded += t.oneOffCents;
    if (recurringTotal <= 0) continue;
    const activeMonths = monthly.filter((m) => (m.get(t.categoryId ?? '__u') ?? 0) > 0).length;
    const regularity = monthsInRange.length >= 3 && activeMonths / monthsInRange.length < 0.6 ? 'irregular' : 'regular';
    const annual = roundCents(recurringTotal * yearFactor);
    items.push({
      categoryId: t.categoryId,
      name: t.name,
      nature: t.nature,
      actualCents: t.totalCents,
      annualCents: annual,
      perWeekCents: roundCents(annual / PERIODS_PER_YEAR.weekly),
      perFortnightCents: roundCents(annual / PERIODS_PER_YEAR.fortnightly),
      perMonthCents: roundCents(annual / PERIODS_PER_YEAR.monthly),
      regularity,
      transactionCount: t.transactionCount,
      oneOffCents: t.oneOffCents,
    });
  }
  items.sort((a, b) => b.annualCents - a.annualCents);
  const annual = items.reduce((a, i) => a + i.annualCents, 0);
  return {
    range,
    months: Math.round((days / 30.44) * 10) / 10,
    items,
    total: {
      annualCents: annual,
      perWeekCents: roundCents(annual / 52),
      perFortnightCents: roundCents(annual / 26),
      perMonthCents: roundCents(annual / 12),
    },
    excludedOneOffCents: excluded,
    basis: `Spending between ${formatDate(range.start)} and ${formatDate(range.end)} (${days} days), scaled to a year (× ${yearFactor.toFixed(3)}), then divided by 52, 26 or 12. One-off transactions (${formatMoney(excluded)}) are left out. These are planning amounts, not actual transactions.`,
  };
}

/** Planning amount for a single known cost, e.g. $960 annual registration → $18.46/week. */
export function spreadCost(amountCents: Cents, frequency: Frequency): { annualCents: Cents; perWeekCents: Cents; perFortnightCents: Cents; perMonthCents: Cents } {
  const annual = roundCents(amountCents * PERIODS_PER_YEAR[frequency]);
  return {
    annualCents: annual,
    perWeekCents: roundCents(annual / 52),
    perFortnightCents: roundCents(annual / 26),
    perMonthCents: roundCents(annual / 12),
  };
}

/* ------------------------------ comparisons ------------------------------ */

export interface ComparisonRow {
  categoryId: string | null;
  name: string;
  aCents: Cents;
  bCents: Cents;
  differenceCents: Cents;
  sentence: string;
}

export interface Comparison {
  a: DateRange & { label: string };
  b: DateRange & { label: string };
  rows: ComparisonRow[];
  totals: { aCents: Cents; bCents: Cents; differenceCents: Cents };
  oneOffs: { a: AnalysisTx[]; b: AnalysisTx[] };
  largest: { a: AnalysisTx[]; b: AnalysisTx[] };
}

/** Neutral wording: describes the difference, never judges it. */
export function describeDifference(name: string, a: Cents, b: Cents, aLabel: string, bLabel: string): string {
  const d = a - b;
  if (d === 0) return `${name} was the same in ${aLabel} and ${bLabel}.`;
  return `${name} was ${formatMoney(Math.abs(d))} ${d > 0 ? 'higher' : 'lower'} in ${aLabel} than in ${bLabel}.`;
}

export function comparePeriods(
  txs: AnalysisTx[],
  a: DateRange & { label: string },
  b: DateRange & { label: string },
  cats: CategoryMap,
): Comparison {
  const ta = categoryTotals(txs, a, cats);
  const tb = categoryTotals(txs, b, cats);
  const keys = new Set([...ta, ...tb].map((t) => t.categoryId ?? '__u'));
  const rows: ComparisonRow[] = [];
  for (const k of keys) {
    const x = ta.find((t) => (t.categoryId ?? '__u') === k);
    const y = tb.find((t) => (t.categoryId ?? '__u') === k);
    const name = x?.name ?? y?.name ?? 'Uncategorised';
    const av = x?.totalCents ?? 0;
    const bv = y?.totalCents ?? 0;
    rows.push({ categoryId: x?.categoryId ?? y?.categoryId ?? null, name, aCents: av, bCents: bv, differenceCents: av - bv, sentence: describeDifference(name, av, bv, a.label, b.label) });
  }
  rows.sort((p, q) => Math.abs(q.differenceCents) - Math.abs(p.differenceCents));
  const spendIn = (r: DateRange) => txs.filter((t) => !t.isTransfer && inRange(t.date, r) && t.amountCents < 0 && kindOf(t.categoryId, cats, t.amountCents) === 'expense');
  const largest = (r: DateRange) => [...spendIn(r)].sort((p, q) => p.amountCents - q.amountCents).slice(0, 5);
  const sumA = rows.reduce((s, r) => s + r.aCents, 0);
  const sumB = rows.reduce((s, r) => s + r.bCents, 0);
  return {
    a, b, rows,
    totals: { aCents: sumA, bCents: sumB, differenceCents: sumA - sumB },
    oneOffs: { a: spendIn(a).filter((t) => t.isOneOff), b: spendIn(b).filter((t) => t.isOneOff) },
    largest: { a: largest(a), b: largest(b) },
  };
}

/* ------------------------------ income ------------------------------ */

export function incomeBySource(txs: AnalysisTx[], range: DateRange, cats: CategoryMap): { incomeType: IncomeType | 'unclassified'; totalCents: Cents; count: number }[] {
  const map = new Map<string, { totalCents: number; count: number }>();
  for (const tx of txs) {
    if (tx.isTransfer || !inRange(tx.date, range) || tx.amountCents <= 0) continue;
    if (kindOf(tx.categoryId, cats, tx.amountCents) !== 'income') continue;
    const k = tx.incomeType ?? 'unclassified';
    const e = map.get(k) ?? { totalCents: 0, count: 0 };
    e.totalCents += tx.amountCents;
    e.count++;
    map.set(k, e);
  }
  return [...map.entries()].map(([incomeType, v]) => ({ incomeType: incomeType as IncomeType, ...v })).sort((a, b) => b.totalCents - a.totalCents);
}

export function savingsRate(t: PeriodTotals): number | null {
  if (t.incomeCents <= 0) return null;
  return (t.incomeCents - t.expenseCents) / t.incomeCents;
}

/* ------------------------------ missing data ------------------------------ */

export interface AccountCoverage {
  accountId: string;
  name: string;
  type: string;
  status: 'active' | 'closed' | 'archived';
  transactionDates: ISODate[];
  statementRanges: DateRange[];
}

export interface DataWarning {
  accountId: string | null;
  severity: 'info' | 'warning';
  message: string;
}

/** Warnings about gaps and stale data, so incomplete analysis is never presented as complete. */
export function missingDataWarnings(accounts: AccountCoverage[], today: ISODate, staleDays = 45): DataWarning[] {
  const out: DataWarning[] = [];
  for (const acc of accounts) {
    if (acc.status !== 'active') continue;
    const dates = [...acc.transactionDates].sort();
    const covered = [...acc.statementRanges];
    if (dates.length === 0 && covered.length === 0) {
      if (['transaction', 'savings', 'high-interest-savings', 'offset', 'credit-card'].includes(acc.type)) {
        out.push({ accountId: acc.accountId, severity: 'info', message: `No transactions have been imported for ${acc.name} yet.` });
      }
      continue;
    }
    const last = maxDate(...dates, ...covered.map((r) => r.end));
    const first = minDate(...dates, ...covered.map((r) => r.start));
    const age = diffDays(last, today);
    if (age > staleDays) {
      const what = acc.type === 'credit-card' ? 'credit-card statements' : 'transactions';
      out.push({ accountId: acc.accountId, severity: 'warning', message: `No ${what} have been imported for ${acc.name} after ${formatDate(last)} (${age} days ago).` });
    }
    // Months with no activity and no statement coverage, between the first and last data.
    const monthSet = new Set(dates.map((d) => d.slice(0, 7)));
    const gaps: string[] = [];
    for (const m of eachMonthStart(first, last)) {
      const key = m.slice(0, 7);
      if (monthSet.has(key)) continue;
      const monthRange = { start: m, end: endOfMonth(m) };
      if (covered.some((r) => intersect(r, monthRange) && lengthInDays(intersect(r, monthRange)!) >= 20)) continue;
      if (m === startOfMonth(first) || m === startOfMonth(last)) continue;
      gaps.push(formatMonth(m));
    }
    if (gaps.length) {
      out.push({
        accountId: acc.accountId,
        severity: 'warning',
        message: `${gaps.length === 1 ? gaps[0] + ' is' : gaps.slice(0, 4).join(', ') + (gaps.length > 4 ? ` and ${gaps.length - 4} more months are` : ' are')} missing from ${acc.name}'s transaction history.`,
      });
    }
  }
  return out;
}

/**
 * The part of `requested` that imported data actually covers (first to last transaction,
 * or statement ranges when known), so averages are never diluted by months with no data.
 */
export function dataCoverage(txs: AnalysisTx[], requested: DateRange, statementRanges: DateRange[] = []): DateRange | null {
  const inside = txs.filter((t) => inRange(t.date, requested)).map((t) => t.date).sort();
  const stmt = statementRanges.map((r) => intersect(r, requested)).filter((r): r is DateRange => !!r);
  const starts = [...(inside.length ? [inside[0]] : []), ...stmt.map((r) => r.start)];
  const ends = [...(inside.length ? [inside[inside.length - 1]] : []), ...stmt.map((r) => r.end)];
  if (!starts.length) return null;
  return { start: minDate(...starts), end: maxDate(...ends) };
}

export function perLabel(f: Frequency): string {
  return PER_LABEL[f];
}
