import { Ctx, UserError, analysisTransactions, balancePoints, bool, categoryMap, getSettings, listAccounts, num, str, recordChange } from './core';
import { inbox } from './imports';
import { ruleSuggestions, transferSuggestions } from './transactions';
import { ISODate, addDays, addMonths, diffDays, formatDate, startOfMonth, endOfMonth, eachMonthStart, formatMonth } from '../../domain/dates';
import { Cents, formatMoney } from '../../domain/money';
import { DateRange, Frequency, PeriodKind, periodContaining, previousPeriod, samePeriodLastYear, PERIODS_PER_YEAR } from '../../domain/periods';
import {
  AccountCoverage, averages, categoryTotals, comparePeriods, dataCoverage, incomeBySource, missingDataWarnings, periodTotals,
  savingsRate, spendingAverages, trueCostOfLiving, withDescendants, allocations,
} from '../../domain/analysis';
import { detectRecurring, RecurringCandidate } from '../../domain/recurring';
import { SAVINGS_TYPES, netWorth as computeNetWorth, netWorthHistory, AccountType } from '../../domain/accounts';
import { merchantKey } from '../../domain/categorise/clean';
import { nextOccurrence, occurrences } from '../../domain/schedule';

function savingsAccountIds(ctx: Ctx): Set<string> {
  return new Set(listAccounts(ctx).filter((a) => SAVINGS_TYPES.includes(a.type)).map((a) => a.id));
}

export function periodOptions(ctx: Ctx) {
  const s = getSettings(ctx);
  return { fortnightAnchor: s.fortnightAnchor ?? undefined, weekStartsOn: s.weekStartsOn };
}

/* ------------------------------ recurring ------------------------------ */

export interface RecurringDTO {
  id: string | null;
  key: string;
  name: string;
  direction: 'in' | 'out';
  frequency: Frequency;
  amountCents: Cents;
  amountVaries: boolean;
  annualCents: Cents;
  lastSeen: ISODate | null;
  nextExpected: ISODate | null;
  /** The first expected date after `lastSeen` that passed without a matching payment. */
  missedSince: ISODate | null;
  categoryId: string | null;
  categoryName: string | null;
  accountId: string | null;
  isSubscription: boolean;
  status: 'suggested' | 'confirmed';
  confidence: string;
  occurrences: number;
  explanation: string;
}

export function recurringList(ctx: Ctx): { confirmed: RecurringDTO[]; suggested: RecurringDTO[] } {
  const cats = categoryMap(ctx);
  const saved = ctx.db.all('SELECT * FROM recurring');
  const savedKeys = new Map(saved.map((r) => [String(r.match_key), r]));
  const txs = analysisTransactions(ctx, addMonths(ctx.today(), -18)).filter((t) => !t.isTransfer);
  const found = detectRecurring(txs.map((t) => ({ id: t.id, date: t.date, amountCents: t.amountCents, description: t.description, categoryId: t.categoryId, accountId: t.accountId })), ctx.today());
  const foundByKey = new Map(found.map((f) => [f.key, f]));
  const toDTO = (f: RecurringCandidate | null, r: Record<string, unknown> | null): RecurringDTO => {
    const categoryId = str(r?.category_id) ?? f?.categoryId ?? null;
    const freq = (r?.frequency as Frequency) ?? f!.frequency;
    const amount = num(r?.amount_cents) ?? f!.typicalAmountCents;
    const lastSeen = f?.lastDate ?? str(r?.last_seen);
    const dueAfterLast = lastSeen ? nextOccurrence({ frequency: freq, anchor: lastSeen }, addDays(lastSeen, 1)) : null;
    return {
      id: r ? String(r.id) : null,
      key: String(r?.match_key ?? f!.key),
      name: String(r?.name ?? f!.name),
      direction: (r?.direction as 'in' | 'out') ?? f!.direction,
      frequency: freq,
      amountCents: amount,
      amountVaries: r ? bool(r.amount_varies) : f!.amountVaries,
      annualCents: Math.round(amount * PERIODS_PER_YEAR[freq]),
      lastSeen,
      missedSince: dueAfterLast && dueAfterLast < addDays(ctx.today(), -3) ? dueAfterLast : null,
      nextExpected: f?.nextExpected ?? (r?.next_expected ? nextOccurrence({ frequency: freq, anchor: String(r.next_expected) }, ctx.today()) : null),
      categoryId,
      categoryName: categoryId ? cats.get(categoryId)?.name ?? null : null,
      accountId: str(r?.account_id) ?? f?.accountId ?? null,
      isSubscription: r ? bool(r.is_subscription) : f!.looksLikeSubscription,
      status: r ? 'confirmed' : 'suggested',
      confidence: f?.confidence ?? 'confirmed',
      occurrences: f?.occurrences ?? 0,
      explanation: f?.explanation ?? 'Confirmed by you.',
    };
  };
  const confirmed = saved.filter((r) => r.status === 'confirmed').map((r) => toDTO(foundByKey.get(String(r.match_key)) ?? null, r));
  const suggested = found.filter((f) => !savedKeys.has(f.key)).map((f) => toDTO(f, null));
  return { confirmed, suggested };
}

export function confirmRecurring(ctx: Ctx, input: { key: string; name: string; direction: 'in' | 'out'; frequency: Frequency; amountCents: number; amountVaries: boolean; nextExpected: ISODate | null; lastSeen: ISODate | null; categoryId: string | null; accountId: string | null; isSubscription: boolean }): string {
  const existing = ctx.db.get('SELECT id FROM recurring WHERE match_key = ?', [input.key]);
  const id = existing ? String(existing.id) : ctx.id();
  ctx.db.run(`INSERT INTO recurring(id, name, match_key, direction, frequency, amount_cents, amount_varies, next_expected, last_seen, category_id, account_id, is_subscription, status, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'confirmed', ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, frequency=excluded.frequency, amount_cents=excluded.amount_cents, amount_varies=excluded.amount_varies,
      next_expected=excluded.next_expected, category_id=excluded.category_id, account_id=excluded.account_id, is_subscription=excluded.is_subscription, status='confirmed'`,
    [id, input.name, input.key, input.direction, input.frequency, Math.abs(input.amountCents), input.amountVaries ? 1 : 0, input.nextExpected, input.lastSeen, input.categoryId, input.accountId, input.isSubscription ? 1 : 0, ctx.now()]);
  recordChange(ctx, 'recurring', id, 'confirmed', null, `${input.name} ${input.frequency}`, 'Confirmed by you');
  ctx.changed('recurring');
  return id;
}

/** "Not recurring" — remembered so the same suggestion does not come back. */
export function dismissRecurring(ctx: Ctx, key: string, name: string): void {
  const existing = ctx.db.get('SELECT id FROM recurring WHERE match_key = ?', [key]);
  if (existing) ctx.db.run("UPDATE recurring SET status = 'dismissed' WHERE id = ?", [String(existing.id)]);
  else ctx.db.run("INSERT INTO recurring(id, name, match_key, direction, frequency, amount_cents, status, created_at) VALUES(?,?,?, 'out', 'monthly', 0, 'dismissed', ?)", [ctx.id(), name, key, ctx.now()]);
  ctx.changed('recurring');
}

export function removeRecurring(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM recurring WHERE id = ?', [id]);
  ctx.changed('recurring');
}

export function subscriptions(ctx: Ctx) {
  const { confirmed, suggested } = recurringList(ctx);
  const subs = [...confirmed.filter((r) => r.isSubscription), ...suggested.filter((r) => r.isSubscription && r.direction === 'out')];
  const annual = subs.filter((s) => s.status === 'confirmed').reduce((a, s) => a + s.annualCents, 0);
  return {
    items: subs.sort((a, b) => b.annualCents - a.annualCents),
    confirmedAnnualCents: annual,
    note: 'Regular payments detected from your transactions. This list is for visibility only.',
  };
}

/* ------------------------------ upcoming items ------------------------------ */

export interface UpcomingItem {
  date: ISODate;
  label: string;
  amountCents: Cents;
  kind: 'bill' | 'recurring-in' | 'recurring-out' | 'term-deposit' | 'loan' | 'sinking-fund';
  daysUntil: number;
  source: string;
}

export function upcoming(ctx: Ctx, days = 30): UpcomingItem[] {
  const today = ctx.today();
  const end = addDays(today, days);
  const out: UpcomingItem[] = [];
  // Keys of recurring series that are already represented by a bill (so they are not listed twice).
  const billKeys = new Set<string>();
  for (const b of ctx.db.all('SELECT * FROM bills WHERE active = 1')) {
    billKeys.add(merchantKey(String(b.match_text ?? b.name)));
    const from = String(b.next_due) < today ? String(b.next_due) : today;
    for (const d of occurrences({ frequency: b.frequency as Frequency, anchor: String(b.next_due) }, from, end)) {
      out.push({ date: d, label: String(b.name), amountCents: -Number(b.amount_cents), kind: 'bill', daysUntil: diffDays(today, d), source: d < today ? 'Bill (overdue — not yet marked paid)' : 'Bill you entered' });
    }
  }
  for (const r of recurringList(ctx).confirmed) {
    if (!r.nextExpected || [...billKeys].some((k) => k && r.key.slice(r.key.indexOf(':') + 1).startsWith(k))) continue;
    for (const d of occurrences({ frequency: r.frequency, anchor: r.nextExpected }, today, end)) {
      out.push({ date: d, label: r.name, amountCents: r.direction === 'in' ? r.amountCents : -r.amountCents, kind: r.direction === 'in' ? 'recurring-in' : 'recurring-out', daysUntil: diffDays(today, d), source: `Expected ${r.frequency} payment (${r.amountVaries ? 'amount varies' : 'usual amount'})` });
    }
  }
  for (const td of ctx.db.all("SELECT * FROM term_deposits WHERE status = 'active' AND maturity_date BETWEEN ? AND ?", [today, end])) {
    out.push({ date: String(td.maturity_date), label: `Term deposit matures — ${td.institution}`, amountCents: Number(td.principal_cents), kind: 'term-deposit', daysUntil: diffDays(today, String(td.maturity_date)), source: 'Term deposit you entered (principal shown)' });
  }
  for (const l of ctx.db.all('SELECT * FROM loans WHERE repayment_cents IS NOT NULL')) {
    const anchor = String(l.as_of);
    for (const d of occurrences({ frequency: l.frequency as Frequency, anchor }, today, end)) {
      if (d === anchor) continue;
      out.push({ date: d, label: `${l.name} repayment`, amountCents: -Number(l.repayment_cents), kind: 'loan', daysUntil: diffDays(today, d), source: 'Loan repayment schedule you entered' });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}

/* ------------------------------ analysis ------------------------------ */

function coverageFor(ctx: Ctx, range: DateRange): DateRange | null {
  const txs = analysisTransactions(ctx, range.start, range.end);
  const stmts = ctx.db.all('SELECT period_start, period_end FROM imports WHERE period_start IS NOT NULL').map((r) => ({ start: String(r.period_start), end: String(r.period_end) }));
  return dataCoverage(txs, range, stmts);
}

export function spendingSummary(ctx: Ctx, range: DateRange, level: 'top' | 'leaf' = 'top') {
  const cats = categoryMap(ctx);
  const covered = coverageFor(ctx, range);
  const txs = analysisTransactions(ctx, range.start, range.end);
  const totals = categoryTotals(txs, range, cats, { level });
  const effective = covered ?? range;
  const overall = spendingAverages(txs, effective, cats);
  const rows = totals.map((t) => {
    const avg = t.categoryId ? spendingAverages(txs, effective, cats, t.categoryId) : averages(t.totalCents, effective, t.transactionCount, 'without a category');
    return { ...t, perWeekCents: avg.perWeek, perFortnightCents: avg.perFortnight, perMonthCents: avg.perMonth, perYearCents: avg.perYear, basis: avg.basis };
  });
  return {
    range,
    coveredRange: covered,
    partial: !!covered && (covered.start > range.start || covered.end < range.end),
    overall,
    rows,
    income: incomeBySource(txs, range, cats),
    totals: periodTotals(txs, range, cats, savingsAccountIds(ctx)),
  };
}

export function categoryDetail(ctx: Ctx, categoryId: string, range: DateRange) {
  const cats = categoryMap(ctx);
  if (!cats.get(categoryId)) throw new UserError('That category no longer exists.');
  const covered = coverageFor(ctx, range) ?? range;
  const txs = analysisTransactions(ctx, range.start, range.end);
  const ids = withDescendants(categoryId, cats);
  const avg = spendingAverages(txs, covered, cats, categoryId);
  const months = eachMonthStart(range.start, range.end).map((m) => {
    const r = { start: m < range.start ? range.start : m, end: endOfMonth(m) > range.end ? range.end : endOfMonth(m) };
    let total = 0;
    for (const t of txs) {
      if (t.isTransfer || t.date < r.start || t.date > r.end) continue;
      for (const a of allocations(t)) if (a.categoryId && ids.has(a.categoryId)) total -= a.amountCents;
    }
    return { month: m, label: formatMonth(m), totalCents: total };
  });
  return { category: cats.get(categoryId)!, averages: avg, months };
}

export function costOfLiving(ctx: Ctx, range: DateRange) {
  const cats = categoryMap(ctx);
  const covered = coverageFor(ctx, range) ?? range;
  return trueCostOfLiving(analysisTransactions(ctx, covered.start, covered.end), covered, cats);
}

export type ComparisonKind = 'month-vs-previous' | 'month-vs-last-year' | 'quarter-vs-previous' | 'fy-vs-previous' | 'rolling-12-vs-previous';

export function comparison(ctx: Ctx, kind: ComparisonKind, anchor?: ISODate) {
  const cats = categoryMap(ctx);
  const opts = periodOptions(ctx);
  const at = anchor ?? ctx.today();
  let a;
  let b;
  switch (kind) {
    case 'month-vs-previous': a = periodContaining('month', at, opts); b = previousPeriod(a, opts); break;
    case 'month-vs-last-year': a = periodContaining('month', at, opts); b = samePeriodLastYear(a, opts); break;
    case 'quarter-vs-previous': a = periodContaining('quarter', at, opts); b = previousPeriod(a, opts); break;
    case 'fy-vs-previous': a = periodContaining('financial-year', at, opts); b = previousPeriod(a, opts); break;
    default: a = periodContaining('rolling-12-months', at, opts); b = previousPeriod(a, opts);
  }
  const txs = analysisTransactions(ctx, b.start, a.end);
  const c = comparePeriods(txs, { ...a, label: a.label }, { ...b, label: b.label }, cats);
  const inProgress = at >= a.start && at < a.end ? `${a.label} is still in progress (${diffDays(a.start, at) + 1} of ${diffDays(a.start, a.end) + 1} days).` : null;
  return { ...c, inProgress };
}

/* ------------------------------ warnings, net worth ------------------------------ */

export function dataWarnings(ctx: Ctx) {
  const accounts = listAccounts(ctx).filter((a) => a.status === 'active' && !['property', 'vehicle', 'other-asset', 'superannuation', 'term-deposit', 'mortgage', 'personal-loan', 'car-loan', 'other-debt', 'other-liability', 'brokerage'].includes(a.type));
  const cov: AccountCoverage[] = accounts.map((a) => ({
    accountId: a.id, name: a.name, type: a.type, status: a.status,
    transactionDates: ctx.db.all("SELECT DISTINCT date FROM transactions WHERE account_id = ? AND status = 'posted'", [a.id]).map((r) => String(r.date)),
    statementRanges: ctx.db.all('SELECT period_start, period_end FROM imports WHERE account_id = ? AND period_start IS NOT NULL', [a.id]).map((r) => ({ start: String(r.period_start), end: String(r.period_end) })),
  }));
  const warnings = missingDataWarnings(cov, ctx.today());
  const uncategorised = ctx.db.scalar<number>("SELECT COUNT(*) FROM transactions WHERE status = 'posted' AND category_id IS NULL AND is_transfer = 0 AND id NOT IN (SELECT transaction_id FROM transaction_splits)") ?? 0;
  if (uncategorised) warnings.push({ accountId: null, severity: 'info', message: `${uncategorised} transaction${uncategorised === 1 ? ' has' : 's have'} no category, so category totals are incomplete.` });
  for (const a of listAccounts(ctx).filter((x) => x.status === 'active' && x.balance?.stale)) {
    warnings.push({ accountId: a.id, severity: 'info', message: `The latest known balance for ${a.name} is from ${formatDate(a.balance!.date)} — it is not a live balance.` });
  }
  return warnings;
}

export function netWorth(ctx: Ctx) {
  const accounts = listAccounts(ctx).filter((a) => a.status !== 'archived');
  const nw = computeNetWorth(accounts.map((a) => ({ accountId: a.id, name: a.name, type: a.type, balance: a.balance })));
  const points = balancePoints(ctx);
  const first = points[0]?.date;
  const full = first ? netWorthHistory(accounts.map((a) => ({ id: a.id, type: a.type as AccountType })), points, first < addMonths(ctx.today(), -36) ? addMonths(ctx.today(), -36) : first, ctx.today()) : [];
  // Start the chart at the first month where every account has a known value, so the line
  // does not jump when an account's first value appears.
  const firstComplete = full.findIndex((h) => h.accountsMissing === 0);
  const trimmed = firstComplete > 0 && full.length - firstComplete >= 2;
  const history = trimmed ? full.slice(firstComplete) : full;
  const historyNote = trimmed
    ? `Starts in ${formatMonth(history[0].date)}, the first month every account has a known value.`
    : history.some((h) => h.accountsMissing > 0)
      ? 'Some months leave out accounts that had no known value yet, so changes there can reflect a new account rather than a real change.'
      : null;
  return { ...nw, history, historyNote };
}

/* ------------------------------ dashboard ------------------------------ */

export function dashboard(ctx: Ctx, kindOverride?: PeriodKind) {
  const settings = getSettings(ctx);
  const opts = periodOptions(ctx);
  const kind = kindOverride ?? settings.analysisPeriods.find((k) => ['week', 'fortnight', 'month', 'quarter'].includes(k)) ?? 'month';
  const today = ctx.today();
  const cats = categoryMap(ctx);
  const latestTx = ctx.db.scalar<string>("SELECT MAX(date) FROM transactions WHERE status = 'posted'") ?? null;
  // When imports lag behind today, show the latest period that has transactions rather than an empty one.
  const thisPeriod = periodContaining(kind, today, opts);
  const shifted = latestTx !== null && latestTx < thisPeriod.start;
  const current = shifted ? periodContaining(kind, latestTx, opts) : thisPeriod;
  const prev = previousPeriod(current, opts);
  const yearAgo = addMonths(startOfMonth(today), -11);
  const txs = analysisTransactions(ctx, prev.start < yearAgo ? prev.start : yearAgo, today);
  const sav = savingsAccountIds(ctx);
  const totals = periodTotals(txs, current, cats, sav);
  // A period that is only partly covered (in progress, or imports stop part-way) is compared
  // with the same number of days at the start of the previous period, not the whole of it.
  const dataEnd = [today, current.end, latestTx ?? today].reduce((a, b) => (a < b ? a : b));
  const partial = dataEnd < current.end;
  const prevCompare: DateRange = partial ? { start: prev.start, end: [prev.end, addDays(prev.start, diffDays(current.start, dataEnd))].reduce((a, b) => (a < b ? a : b)) } : prev;
  const prevTotals = periodTotals(txs, prevCompare, cats, sav);
  const trend = eachMonthStart(yearAgo, today).map((m) => {
    const t = periodTotals(txs, { start: m, end: endOfMonth(m) }, cats, sav);
    return { month: m, label: formatMonth(m), incomeCents: t.incomeCents, expenseCents: t.expenseCents, partial: endOfMonth(m) > today };
  });
  const spend = categoryTotals(txs, current, cats, { level: 'top' }).slice(0, 8);
  const accounts = listAccounts(ctx).filter((a) => a.status === 'active');
  const counts = {
    inbox: inbox(ctx).count,
    ruleSuggestions: ruleSuggestions(ctx).length,
    transferSuggestions: transferSuggestions(ctx).length,
    recurringSuggestions: recurringList(ctx).suggested.length,
  };
  return {
    period: current,
    previousPeriod: prev,
    totals,
    previousTotals: prevTotals,
    comparisonLabel: partial ? `the same point in ${prev.label} (${formatDate(prevCompare.start, { noYear: true })}–${formatDate(prevCompare.end, { noYear: true })})` : prev.label,
    savingsRate: savingsRate(totals),
    trend,
    spending: spend,
    accounts,
    upcoming: upcoming(ctx, 30),
    warnings: dataWarnings(ctx),
    counts,
    latestTransactionDate: latestTx,
    periodInProgress: today < current.end,
    periodNote: shifted
      ? `Showing ${current.label}, the latest period with imported transactions (up to ${formatDate(latestTx)}). Import newer statements to see ${thisPeriod.label}.`
      : null,
    sections: settings.dashboardSections,
    freshnessNote: latestTx
      ? `Figures include transactions imported up to ${formatDate(latestTx)}.${diffDays(latestTx, today) > 7 ? ` Anything after that has not been imported yet.` : ''}`
      : 'No transactions have been imported yet.',
    sentence: totals.transactionCount === 0
      ? `No transactions recorded for ${current.label} yet.`
      : `${current.label}: ${formatMoney(totals.incomeCents)} in and ${formatMoney(totals.expenseCents)} out so far.`,
  };
}
