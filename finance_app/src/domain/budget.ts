import { ISODate, addDays, diffDays, formatDate } from './dates';
import { Cents, formatMoney, roundCents } from './money';
import { DateRange, FREQUENCY_DAYS, Frequency, PER_LABEL, lengthInDays } from './periods';
import { AnalysisTx, CategoryMap, allocations, spendingAverages, withDescendants } from './analysis';
import { Recurrence, nextOccurrence, occurrences } from './schedule';
import { descriptionSimilarity } from './import/duplicates';

/* ------------------------------ budgets ------------------------------ */

export type BudgetMethod = 'historical' | 'manual' | 'hybrid';

export interface BudgetLine {
  categoryId: string;
  /** Allocation per budget period. */
  amountCents: Cents;
  /** Historical average per period when the line was proposed (for reference). */
  basisCents?: Cents | null;
  note?: string | null;
}

export interface Budget {
  id: string;
  name: string;
  method: BudgetMethod;
  frequency: Frequency;
  lines: BudgetLine[];
  basisStart?: ISODate | null;
  basisEnd?: ISODate | null;
}

/**
 * Propose budget lines from historical spending: each category's average per budget period
 * over the basis range, rounded up to whole dollars. Used for "historical" and "hybrid" budgets.
 */
export function proposeBudget(
  txs: AnalysisTx[],
  basis: DateRange,
  cats: CategoryMap,
  frequency: Frequency,
  categoryIds: string[],
): { lines: BudgetLine[]; explanation: string } {
  const lines: BudgetLine[] = [];
  const periodDays = FREQUENCY_DAYS[frequency];
  for (const id of categoryIds) {
    const avg = spendingAverages(txs, basis, cats, id, false);
    const perPeriod = (avg.perDay * periodDays);
    if (perPeriod <= 0) continue;
    const rounded = Math.ceil(perPeriod / 100) * 100;
    lines.push({ categoryId: id, amountCents: rounded, basisCents: roundCents(perPeriod), note: avg.basis.description });
  }
  return {
    lines,
    explanation: `Each amount is the average spending ${PER_LABEL[frequency]} in that category between ${formatDate(basis.start)} and ${formatDate(basis.end)} (one-off transactions excluded), rounded up to the next whole dollar.`,
  };
}

export interface BudgetRow {
  categoryId: string;
  name: string;
  budgetCents: Cents;
  actualCents: Cents;
  /** budget − actual: positive means below the allocation. */
  differenceCents: Cents;
  /** Budget pro-rated to today when the period is still in progress. */
  expectedToDateCents: Cents | null;
  status: 'below' | 'above' | 'matched';
  sentence: string;
  inBudget: boolean;
}

export function neutralBudgetSentence(name: string, budget: Cents, actual: Cents): string {
  const d = actual - budget;
  if (d === 0) return `${name} matched the amount allocated.`;
  return `${name} was ${formatMoney(Math.abs(d))} ${d > 0 ? 'above' : 'below'} the amount allocated.`;
}

/** Budget amount for a period of a different length (e.g. a monthly budget shown for a week). */
export function scaleBudget(amount: Cents, frequency: Frequency, period: DateRange, periodMatchesFrequency: boolean): Cents {
  if (periodMatchesFrequency) return amount;
  return roundCents((amount * lengthInDays(period)) / FREQUENCY_DAYS[frequency]);
}

export function budgetVsActual(
  budget: Budget,
  txs: AnalysisTx[],
  period: DateRange,
  cats: CategoryMap,
  opts: { today?: ISODate; periodMatchesFrequency?: boolean } = {},
): { rows: BudgetRow[]; totals: { budgetCents: Cents; actualCents: Cents; differenceCents: Cents }; elapsedFraction: number | null } {
  const matches = opts.periodMatchesFrequency ?? false;
  const budgeted = new Set(budget.lines.map((l) => l.categoryId));
  // A line covers its category and descendants, except descendants with their own line.
  const coverage = new Map<string, Set<string>>();
  for (const l of budget.lines) {
    const ids = withDescendants(l.categoryId, cats);
    for (const other of budget.lines) {
      if (other.categoryId !== l.categoryId && ids.has(other.categoryId)) {
        for (const d of withDescendants(other.categoryId, cats)) ids.delete(d);
      }
    }
    coverage.set(l.categoryId, ids);
  }
  const actual = new Map<string, number>();
  const unbudgeted = new Map<string, number>();
  for (const tx of txs) {
    if (tx.isTransfer || tx.date < period.start || tx.date > period.end) continue;
    for (const a of allocations(tx)) {
      const info = a.categoryId ? cats.get(a.categoryId) : undefined;
      const kind = info?.kind ?? (a.amountCents >= 0 ? 'income' : 'expense');
      if (kind !== 'expense') continue;
      let found = false;
      for (const [lineId, ids] of coverage) {
        if (a.categoryId && ids.has(a.categoryId)) {
          actual.set(lineId, (actual.get(lineId) ?? 0) - a.amountCents);
          found = true;
          break;
        }
      }
      if (!found) {
        const k = a.categoryId ?? '__uncategorised';
        unbudgeted.set(k, (unbudgeted.get(k) ?? 0) - a.amountCents);
      }
    }
  }
  let elapsed: number | null = null;
  if (opts.today && opts.today >= period.start && opts.today < period.end) {
    elapsed = (diffDays(period.start, opts.today) + 1) / lengthInDays(period);
  }
  const rows: BudgetRow[] = budget.lines.map((l) => {
    const name = cats.get(l.categoryId)?.name ?? 'Unknown category';
    const b = scaleBudget(l.amountCents, budget.frequency, period, matches);
    const act = actual.get(l.categoryId) ?? 0;
    const diff = b - act;
    return {
      categoryId: l.categoryId,
      name,
      budgetCents: b,
      actualCents: act,
      differenceCents: diff,
      expectedToDateCents: elapsed !== null ? roundCents(b * elapsed) : null,
      status: diff === 0 ? 'matched' : diff > 0 ? 'below' : 'above',
      sentence: neutralBudgetSentence(name, b, act),
      inBudget: true,
    };
  });
  for (const [k, v] of unbudgeted) {
    if (v <= 0 || budgeted.has(k)) continue;
    const name = cats.get(k)?.name ?? 'Uncategorised';
    rows.push({
      categoryId: k, name, budgetCents: 0, actualCents: v, differenceCents: -v, expectedToDateCents: null, status: 'above',
      sentence: `${name} had ${formatMoney(v)} of spending with no amount allocated.`, inBudget: false,
    });
  }
  const tb = rows.reduce((s, r) => s + r.budgetCents, 0);
  const ta = rows.reduce((s, r) => s + r.actualCents, 0);
  return { rows, totals: { budgetCents: tb, actualCents: ta, differenceCents: tb - ta }, elapsedFraction: elapsed };
}

/* ------------------------------ sinking funds ------------------------------ */

export interface SinkingFund {
  id: string;
  name: string;
  targetCents: Cents;
  savedCents: Cents;
  dueDate: ISODate;
  categoryId?: string | null;
  /** Repeats (e.g. annual registration) — the next target date rolls forward after it's paid. */
  repeat?: Frequency | null;
}

export interface SinkingPlan {
  remainingCents: Cents;
  daysLeft: number;
  perWeekCents: Cents;
  perFortnightCents: Cents;
  perMonthCents: Cents;
  weeks: number;
  fortnights: number;
  months: number;
  explanation: string;
}

/**
 * How much would need to be set aside each week, fortnight or month to reach the target
 * by the due date. This is arithmetic, not a recommendation.
 */
export function sinkingFundPlan(f: SinkingFund, today: ISODate): SinkingPlan {
  const remaining = Math.max(0, f.targetCents - f.savedCents);
  const daysLeft = Math.max(0, diffDays(today, f.dueDate));
  const weeks = Math.max(1, Math.ceil(daysLeft / 7));
  const fortnights = Math.max(1, Math.ceil(daysLeft / 14));
  const months = Math.max(1, Math.ceil(daysLeft / (365.25 / 12)));
  const per = (n: number) => (remaining === 0 ? 0 : Math.ceil(remaining / n));
  return {
    remainingCents: remaining,
    daysLeft,
    perWeekCents: per(weeks),
    perFortnightCents: per(fortnights),
    perMonthCents: per(months),
    weeks,
    fortnights,
    months,
    explanation: remaining === 0
      ? `The full ${formatMoney(f.targetCents)} is already set aside.`
      : `${formatMoney(remaining)} still to set aside over ${daysLeft} days until ${formatDate(f.dueDate)}: ÷ ${weeks} weeks, ÷ ${fortnights} fortnights or ÷ ${months} months (rounded up to the cent).`,
  };
}

/* ------------------------------ bills ------------------------------ */

export interface Bill {
  id: string;
  name: string;
  amountCents: Cents;
  frequency: Frequency;
  nextDue: ISODate;
  categoryId?: string | null;
  accountId?: string | null;
  autoPay: boolean;
  reminderDays: number;
  active: boolean;
  matchText?: string | null;
}

export function billRecurrence(b: Bill): Recurrence {
  return { frequency: b.frequency, anchor: b.nextDue };
}

export function billDueDates(b: Bill, from: ISODate, to: ISODate): ISODate[] {
  if (!b.active) return [];
  return occurrences(billRecurrence(b), from, to);
}

export function upcomingBills(bills: Bill[], today: ISODate, horizonDays: number): { bill: Bill; dueDate: ISODate; daysUntil: number }[] {
  const out: { bill: Bill; dueDate: ISODate; daysUntil: number }[] = [];
  for (const b of bills) {
    if (!b.active) continue;
    // A bill whose due date has passed without being marked paid is included (as overdue).
    const from = b.nextDue < today ? b.nextDue : today;
    for (const d of occurrences(billRecurrence(b), from, addDays(today, horizonDays))) {
      out.push({ bill: b, dueDate: d, daysUntil: diffDays(today, d) });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** The due date after the current one (used when a bill is marked paid). */
export function advanceBill(b: Bill): ISODate {
  return nextOccurrence(billRecurrence(b), addDays(b.nextDue, 1)) ?? b.nextDue;
}

/** Find a transaction that looks like payment of this bill near its due date. */
export function findBillPayment(b: Bill, txs: { id: string; date: ISODate; amountCents: Cents; description: string }[], windowDays = 7): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const t of txs) {
    if (t.amountCents >= 0) continue;
    const gap = Math.abs(diffDays(b.nextDue, t.date));
    if (gap > windowDays) continue;
    const amt = Math.abs(t.amountCents);
    const amountOk = Math.abs(amt - b.amountCents) <= Math.max(100, b.amountCents * 0.1);
    if (!amountOk) continue;
    const text = b.matchText || b.name;
    const sim = descriptionSimilarity(text, t.description);
    const contains = t.description.toUpperCase().includes(text.toUpperCase());
    if (sim < 0.3 && !contains) continue;
    const score = (contains ? 0.5 : sim * 0.5) + (amt === b.amountCents ? 0.3 : 0.15) + (gap <= 2 ? 0.2 : 0.1);
    if (!best || score > best.score) best = { id: t.id, score };
  }
  return best;
}
