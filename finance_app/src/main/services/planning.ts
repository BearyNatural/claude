import { Ctx, UserError, analysisTransactions, categoryMap, getSettings, json, listAccounts, num, str, recordChange } from './core';
import { recurringList } from './insights';
import { listBills } from './budgeting';
import { ISODate, addDays, addMonths, diffDays, formatDate, isValidDate, minDate } from '../../domain/dates';
import { Cents, formatMoney, roundCents } from '../../domain/money';
import { Frequency } from '../../domain/periods';
import { CASH_TYPES } from '../../domain/accounts';
import { Goal, GoalType, projectGoal } from '../../domain/planning/goals';
import { LoanInput, RepaymentFrequency, compareLoanResults, minimumRepayment, offsetAnnualEffect, simulateDebts, simulateLoan, PayoffOrder } from '../../domain/planning/loans';
import { TermDeposit, tdLadder, tdSchedule } from '../../domain/planning/termDeposits';
import { ForecastAssumptions, Scenario, ScenarioChange, Stream, compareScenarios, runForecast, scenarioTemplates } from '../../domain/planning/forecast';
import { merchantKey } from '../../domain/categorise/clean';
import { allocations, dataCoverage } from '../../domain/analysis';
import { occurrences } from '../../domain/schedule';

/* ------------------------------ goals ------------------------------ */

function goalFromRow(r: Record<string, unknown>): Goal & { linkedAccountId: string | null } {
  return {
    id: String(r.id), name: String(r.name), type: r.type as GoalType, targetCents: Number(r.target_cents), currentCents: Number(r.current_cents),
    targetDate: str(r.target_date), contributionCents: Number(r.contribution_cents), contributionFrequency: r.contribution_frequency as Frequency,
    annualRatePercent: Number(r.rate_percent), oneOffs: json(r.one_offs, []), linkedAccountId: str(r.linked_account_id),
  };
}

export function listGoals(ctx: Ctx) {
  const accounts = new Map(listAccounts(ctx).map((a) => [a.id, a]));
  return ctx.db.all('SELECT * FROM goals ORDER BY created_at').map((r) => {
    const g = goalFromRow(r);
    // A goal linked to an account uses that account's latest known balance as its current amount.
    const acc = g.linkedAccountId ? accounts.get(g.linkedAccountId) : undefined;
    const current = acc?.balance ? Math.max(0, acc.balance.balanceCents) : g.currentCents;
    const goal = { ...g, currentCents: current };
    return { ...goal, currentSource: acc?.balance ? `${acc.name}: ${acc.balance.label}` : 'Entered by you', projection: projectGoal(goal, ctx.today()) };
  });
}

export function saveGoal(ctx: Ctx, g: Goal & { linkedAccountId?: string | null }): string {
  if (!g.name.trim()) throw new UserError('Give the goal a name.');
  if (g.targetCents <= 0) throw new UserError('Enter a target amount.');
  if (g.targetDate && !isValidDate(g.targetDate)) throw new UserError('The target date is not valid.');
  if (g.annualRatePercent < -50 || g.annualRatePercent > 50) throw new UserError('Enter an interest assumption between -50% and 50%.');
  const id = g.id || ctx.id();
  ctx.db.run(`INSERT INTO goals(id, name, type, target_cents, current_cents, target_date, contribution_cents, contribution_frequency, rate_percent, one_offs, linked_account_id, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, target_cents=excluded.target_cents, current_cents=excluded.current_cents,
      target_date=excluded.target_date, contribution_cents=excluded.contribution_cents, contribution_frequency=excluded.contribution_frequency,
      rate_percent=excluded.rate_percent, one_offs=excluded.one_offs, linked_account_id=excluded.linked_account_id`,
    [id, g.name.trim(), g.type, g.targetCents, g.currentCents, g.targetDate ?? null, g.contributionCents, g.contributionFrequency, g.annualRatePercent, JSON.stringify(g.oneOffs ?? []), g.linkedAccountId ?? null, ctx.now()]);
  ctx.changed('goals');
  return id;
}

export function deleteGoal(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM goals WHERE id = ?', [id]);
  ctx.changed('goals');
}

/* ------------------------------ loans ------------------------------ */

export type LoanKind = 'mortgage' | 'personal-loan' | 'car-loan' | 'credit-card' | 'other-debt';

export interface LoanRecord {
  id: string;
  accountId: string | null;
  name: string;
  kind: LoanKind;
  balanceCents: Cents;
  ratePercent: number;
  repaymentCents: Cents | null;
  frequency: RepaymentFrequency;
  remainingTermMonths: number | null;
  offsetAccountId: string | null;
  extraRepaymentCents: Cents;
  asOf: ISODate;
  rateChanges: { date: ISODate; annualRatePercent: number }[];
  notes: string | null;
}

function loanFromRow(r: Record<string, unknown>): LoanRecord {
  return {
    id: String(r.id), accountId: str(r.account_id), name: String(r.name), kind: r.kind as LoanKind, balanceCents: Number(r.balance_cents),
    ratePercent: Number(r.rate_percent), repaymentCents: num(r.repayment_cents), frequency: r.frequency as RepaymentFrequency,
    remainingTermMonths: num(r.remaining_term_months), offsetAccountId: str(r.offset_account_id), extraRepaymentCents: Number(r.extra_repayment_cents ?? 0),
    asOf: String(r.as_of), rateChanges: json(r.rate_changes, []), notes: str(r.notes),
  };
}

export function listLoans(ctx: Ctx): LoanRecord[] {
  return ctx.db.all("SELECT * FROM loans ORDER BY CASE kind WHEN 'mortgage' THEN 0 ELSE 1 END, name").map(loanFromRow);
}

export function saveLoan(ctx: Ctx, l: Omit<LoanRecord, 'id'> & { id?: string }): string {
  if (!l.name.trim()) throw new UserError('Give the loan a name.');
  if (l.balanceCents <= 0) throw new UserError('Enter the current balance owed.');
  if (l.ratePercent < 0 || l.ratePercent > 60) throw new UserError('Enter an interest rate between 0% and 60%.');
  if (!l.repaymentCents && !l.remainingTermMonths) throw new UserError('Enter the repayment amount or the remaining term.');
  const id = l.id ?? ctx.id();
  ctx.db.run(`INSERT INTO loans(id, account_id, name, kind, balance_cents, rate_percent, repayment_cents, frequency, remaining_term_months, offset_account_id,
      extra_repayment_cents, as_of, rate_changes, notes, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id, name=excluded.name, kind=excluded.kind, balance_cents=excluded.balance_cents,
      rate_percent=excluded.rate_percent, repayment_cents=excluded.repayment_cents, frequency=excluded.frequency, remaining_term_months=excluded.remaining_term_months,
      offset_account_id=excluded.offset_account_id, extra_repayment_cents=excluded.extra_repayment_cents, as_of=excluded.as_of, rate_changes=excluded.rate_changes, notes=excluded.notes`,
    [id, l.accountId, l.name.trim(), l.kind, l.balanceCents, l.ratePercent, l.repaymentCents, l.frequency, l.remainingTermMonths, l.offsetAccountId, l.extraRepaymentCents, l.asOf, JSON.stringify(l.rateChanges ?? []), l.notes, ctx.now()]);
  recordChange(ctx, 'loan', id, 'saved', null, `${formatMoney(l.balanceCents)} at ${l.ratePercent}%`, 'Saved by you');
  ctx.changed('loans');
  return id;
}

export function deleteLoan(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM loans WHERE id = ?', [id]);
  ctx.changed('loans');
}

function offsetBalance(ctx: Ctx, loan: LoanRecord): { cents: Cents; label: string } | null {
  if (!loan.offsetAccountId) return null;
  const acc = listAccounts(ctx).find((a) => a.id === loan.offsetAccountId);
  if (!acc?.balance) return { cents: 0, label: 'Offset account has no balance yet' };
  return { cents: Math.max(0, acc.balance.balanceCents), label: `${acc.name} — ${acc.balance.label}` };
}

export interface LoanModelOptions {
  extraRepaymentCents?: number;
  offsetCents?: number | null;
  offsetMonthlyChangeCents?: number;
  lumpSums?: { date: ISODate; amountCents: number }[];
  rateChanges?: { date: ISODate; annualRatePercent: number }[];
}

/** A loan under the stored details plus optional what-ifs, and the comparisons that explain them. */
export function modelLoan(ctx: Ctx, loanId: string, opts: LoanModelOptions = {}) {
  const loan = listLoans(ctx).find((l) => l.id === loanId);
  if (!loan) throw new UserError('That loan no longer exists.');
  const off = offsetBalance(ctx, loan);
  const start = ctx.today() > loan.asOf ? ctx.today() : loan.asOf;
  const base: LoanInput = {
    principalCents: loan.balanceCents,
    annualRatePercent: loan.ratePercent,
    startDate: loan.asOf,
    repaymentFrequency: loan.frequency,
    repaymentCents: loan.repaymentCents,
    remainingTermMonths: loan.remainingTermMonths,
    extraRepaymentCents: loan.extraRepaymentCents,
    rateChanges: loan.rateChanges,
    offset: off ? { balanceCents: off.cents } : null,
  };
  const scenario: LoanInput = {
    ...base,
    extraRepaymentCents: opts.extraRepaymentCents ?? base.extraRepaymentCents,
    offset: opts.offsetCents !== undefined && opts.offsetCents !== null ? { balanceCents: opts.offsetCents, monthlyChangeCents: opts.offsetMonthlyChangeCents } : base.offset && opts.offsetMonthlyChangeCents ? { ...base.offset, monthlyChangeCents: opts.offsetMonthlyChangeCents } : base.offset,
    lumpSums: opts.lumpSums ?? [],
    rateChanges: opts.rateChanges ?? base.rateChanges,
  };
  const current = simulateLoan(scenario);
  const noOffset = simulateLoan({ ...scenario, offset: null });
  const noExtra = simulateLoan({ ...scenario, extraRepaymentCents: 0, lumpSums: [] });
  const ratePlus1 = simulateLoan({ ...scenario, rateChanges: [{ date: addMonths(start, 1), annualRatePercent: loan.ratePercent + 1 }] });
  const rateMinus1 = simulateLoan({ ...scenario, rateChanges: [{ date: addMonths(start, 1), annualRatePercent: Math.max(0, loan.ratePercent - 1) }] });
  const offsetNow = scenario.offset ? offsetAnnualEffect(loan.balanceCents, scenario.offset.balanceCents, loan.ratePercent) : null;
  const staleNote = diffDays(loan.asOf, ctx.today()) > 45 ? `The loan balance was entered as at ${formatDate(loan.asOf)} — update it for a more current picture.` : null;
  return {
    loan,
    offsetSource: off?.label ?? null,
    offsetCents: scenario.offset?.balanceCents ?? 0,
    result: current,
    comparisons: [
      scenario.offset ? { label: 'Without the offset', ...compareLoanResults(noOffset, current, 'With the offset') } : null,
      (scenario.extraRepaymentCents || scenario.lumpSums?.length) ? { label: 'Without extra repayments', ...compareLoanResults(noExtra, current, 'With the extra repayments') } : null,
      { label: 'Rate 1 percentage point higher', ...compareLoanResults(current, ratePlus1, `If the rate were ${loan.ratePercent + 1}% from next month`) },
      { label: 'Rate 1 percentage point lower', ...compareLoanResults(current, rateMinus1, `If the rate were ${Math.max(0, loan.ratePercent - 1)}% from next month`) },
    ].filter(Boolean),
    offsetEffect: offsetNow,
    minimumRepaymentCents: loan.remainingTermMonths ? minimumRepayment(loan.balanceCents, loan.ratePercent, loan.remainingTermMonths, loan.frequency) : null,
    staleNote,
  };
}

export function debtOverview(ctx: Ctx, order: PayoffOrder = 'as-listed', extraMonthlyCents = 0) {
  const debts = listLoans(ctx).filter((l) => l.kind !== 'mortgage').map((l) => ({
    id: l.id, name: l.name, balanceCents: l.balanceCents, annualRatePercent: l.ratePercent,
    monthlyPaymentCents: roundCents(((l.repaymentCents ?? minimumRepayment(l.balanceCents, l.ratePercent, l.remainingTermMonths ?? 60, 'monthly')) * { weekly: 52, fortnightly: 26, monthly: 12 }[l.frequency]) / 12),
  }));
  return { debts, result: simulateDebts(debts, ctx.today(), order, extraMonthlyCents) };
}

/* ------------------------------ term deposits ------------------------------ */

function tdFromRow(r: Record<string, unknown>): TermDeposit & { status: string; reminderDays: number; accountId: string | null } {
  return {
    id: String(r.id), institution: String(r.institution), name: str(r.name), principalCents: Number(r.principal_cents), startDate: String(r.start_date),
    maturityDate: String(r.maturity_date), annualRatePercent: Number(r.rate_percent), interestFrequency: r.interest_frequency as TermDeposit['interestFrequency'],
    interestHandling: r.interest_handling as TermDeposit['interestHandling'], interestDestination: str(r.interest_destination), notes: str(r.notes),
    status: String(r.status), reminderDays: Number(r.reminder_days), accountId: str(r.account_id),
  };
}

export function listTermDeposits(ctx: Ctx) {
  const tds = ctx.db.all('SELECT * FROM term_deposits ORDER BY maturity_date').map(tdFromRow);
  const active = tds.filter((t) => t.status === 'active');
  return {
    deposits: tds.map((t) => ({ ...t, schedule: tdSchedule(t), daysToMaturity: diffDays(ctx.today(), t.maturityDate) })),
    ladder: tdLadder(active, ctx.today()),
    totalPrincipalCents: active.reduce((a, t) => a + t.principalCents, 0),
  };
}

export function saveTermDeposit(ctx: Ctx, t: TermDeposit & { status?: string; reminderDays?: number; accountId?: string | null }): string {
  if (!t.institution.trim()) throw new UserError('Enter the institution.');
  if (t.principalCents <= 0) throw new UserError('Enter the amount deposited.');
  if (!isValidDate(t.startDate) || !isValidDate(t.maturityDate) || t.maturityDate <= t.startDate) throw new UserError('The maturity date must be after the start date.');
  const id = t.id || ctx.id();
  ctx.db.run(`INSERT INTO term_deposits(id, institution, name, principal_cents, start_date, maturity_date, rate_percent, interest_frequency, interest_handling,
      interest_destination, account_id, status, reminder_days, notes, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET institution=excluded.institution, name=excluded.name, principal_cents=excluded.principal_cents, start_date=excluded.start_date,
      maturity_date=excluded.maturity_date, rate_percent=excluded.rate_percent, interest_frequency=excluded.interest_frequency, interest_handling=excluded.interest_handling,
      interest_destination=excluded.interest_destination, account_id=excluded.account_id, status=excluded.status, reminder_days=excluded.reminder_days, notes=excluded.notes`,
    [id, t.institution.trim(), t.name ?? null, t.principalCents, t.startDate, t.maturityDate, t.annualRatePercent, t.interestFrequency, t.interestHandling,
      t.interestDestination ?? null, t.accountId ?? null, t.status ?? 'active', t.reminderDays ?? 14, t.notes ?? null, ctx.now()]);
  ctx.changed('termDeposits');
  return id;
}

export function deleteTermDeposit(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM term_deposits WHERE id = ?', [id]);
  ctx.changed('termDeposits');
}

/* ------------------------------ forecast assumptions ------------------------------ */

export interface BuiltAssumptions {
  assumptions: ForecastAssumptions;
  provenance: string[];
  warnings: string[];
}

/**
 * Build forecast assumptions from the user's actual data: latest known balances, confirmed
 * recurring income and bills, loans, term deposits, and average everyday spending.
 * Every figure says where it came from.
 */
export function buildAssumptions(ctx: Ctx, months = 12): BuiltAssumptions {
  const s = getSettings(ctx);
  const today = ctx.today();
  const accounts = listAccounts(ctx).filter((a) => a.status === 'active');
  const cashAccounts = accounts.filter((a) => CASH_TYPES.includes(a.type));
  const withBal = cashAccounts.filter((a) => a.balance);
  const warnings: string[] = [];
  const provenance: string[] = [];
  const startingCash = withBal.reduce((a, x) => a + x.balance!.balanceCents, 0);
  const asOf = withBal.length ? minDate(...withBal.map((a) => a.balance!.date)) : null;
  const missing = cashAccounts.filter((a) => !a.balance);
  if (missing.length) warnings.push(`No balance is known for ${missing.map((m) => m.name).join(', ')}, so ${missing.length === 1 ? 'it is' : 'they are'} counted as $0.`);
  if (asOf && diffDays(asOf, today) > 31) warnings.push(`Some starting balances are from ${formatDate(asOf)}. The forecast starts from those figures, not live balances.`);
  const cashNote = withBal.map((a) => `${a.name} ${formatMoney(a.balance!.balanceCents)} (${a.balance!.label})`).join('; ');
  provenance.push(`Starting cash = latest known balances: ${cashNote || 'none'}.`);

  const streams: Stream[] = [];
  const { confirmed, suggested } = recurringList(ctx);
  const incomeSeries = [...confirmed.filter((r) => r.direction === 'in'), ...suggested.filter((r) => r.direction === 'in' && r.confidence === 'high')];
  for (const r of incomeSeries) {
    if (!r.nextExpected) continue;
    const isWage = r.categoryId === 'income.salary' || /PAYROLL|SALARY|WAGE/i.test(r.name);
    streams.push({
      id: `rec-${r.key}`, name: r.name, direction: 'in', kind: isWage ? 'employment' : r.categoryId === 'income.government' ? 'government' : r.categoryId === 'income.dividends' || r.categoryId === 'income.interest' ? 'investment-income' : 'other-income',
      amountCents: r.amountCents, frequency: r.frequency, startDate: r.nextExpected,
      source: `${r.status === 'confirmed' ? 'Confirmed' : 'Detected (not yet confirmed)'} ${r.frequency} deposit, usually ${formatMoney(r.amountCents)} (net, as deposited)`,
    });
  }
  if (!incomeSeries.length) warnings.push('No regular income has been confirmed yet. Confirm your pay on the Recurring screen, or add income to the forecast.');

  const bills = listBills(ctx).filter((b) => b.active);
  const covered = new Set<string>();
  for (const b of bills) {
    streams.push({ id: `bill-${b.id}`, name: b.name, direction: 'out', kind: 'bill', amountCents: b.amountCents, frequency: b.frequency, startDate: b.nextDue < today ? today : b.nextDue, source: 'Bill you entered' });
    covered.add(merchantKey(b.matchText || b.name));
  }
  for (const r of confirmed.filter((x) => x.direction === 'out' && x.nextExpected)) {
    if (covered.has(r.key.replace(/^out:/, '')) || bills.some((b) => b.name.toUpperCase() === r.name.toUpperCase())) continue;
    streams.push({ id: `rec-${r.key}`, name: r.name, direction: 'out', kind: 'bill', amountCents: r.amountCents, frequency: r.frequency, startDate: r.nextExpected!, source: `Confirmed ${r.frequency} payment` });
    covered.add(r.key.replace(/^out:/, ''));
  }

  const loans = listLoans(ctx);
  const mortgage = loans.find((l) => l.kind === 'mortgage');
  let forecastMortgage: ForecastAssumptions['mortgage'] = null;
  if (mortgage) {
    const repayment = mortgage.repaymentCents ?? minimumRepayment(mortgage.balanceCents, mortgage.ratePercent, mortgage.remainingTermMonths ?? 300, mortgage.frequency);
    const first = occurrences({ frequency: mortgage.frequency, anchor: mortgage.asOf }, addDays(today, 1), addMonths(today, 2))[0] ?? addMonths(today, 1);
    const offsetIsCash = !!mortgage.offsetAccountId && cashAccounts.some((a) => a.id === mortgage.offsetAccountId);
    forecastMortgage = { balanceCents: mortgage.balanceCents, annualRatePercent: mortgage.ratePercent, repaymentCents: repayment + mortgage.extraRepaymentCents, frequency: mortgage.frequency, firstRepaymentDate: first, offsetIsCash };
    provenance.push(`Mortgage "${mortgage.name}": ${formatMoney(mortgage.balanceCents)} as at ${formatDate(mortgage.asOf)} at ${mortgage.ratePercent}%.${offsetIsCash ? ' Your cash balance is treated as sitting in the offset account.' : ''}`);
  }
  for (const l of loans.filter((x) => x.kind !== 'mortgage')) {
    const repayment = l.repaymentCents ?? minimumRepayment(l.balanceCents, l.ratePercent, l.remainingTermMonths ?? 60, l.frequency);
    streams.push({ id: `loan-${l.id}`, name: `${l.name} repayment`, direction: 'out', kind: 'loan-repayment', amountCents: repayment, frequency: l.frequency, startDate: addDays(today, 7), growthPercent: 0, source: 'Loan you entered' });
  }

  // Everyday spending: the last six months of spending not already covered above.
  const since = addMonths(today, -6);
  const txs = analysisTransactions(ctx, since, today);
  const cov = dataCoverage(txs, { start: since, end: today });
  const cats = categoryMap(ctx);
  if (cov) {
    let total = 0;
    let count = 0;
    for (const t of txs) {
      if (t.isTransfer || t.isOneOff) continue;
      if (covered.has(merchantKey(t.description))) continue;
      for (const a of allocations(t)) {
        const kind = a.categoryId ? cats.get(a.categoryId)?.kind : a.amountCents < 0 ? 'expense' : 'income';
        if (kind !== 'expense') continue;
        if (mortgage && a.categoryId === 'housing.mortgage') continue;
        if (a.categoryId?.startsWith('taxes')) continue;
        total -= a.amountCents;
        count++;
      }
    }
    const days = diffDays(cov.start, cov.end) + 1;
    if (days >= 28 && total > 0) {
      const weekly = roundCents((total / days) * 7);
      streams.push({ id: 'living', name: 'Everyday spending (historical average)', direction: 'out', kind: 'living', amountCents: weekly, frequency: 'weekly', startDate: today,
        source: `Average of ${count} transactions from ${formatDate(cov.start)} to ${formatDate(cov.end)} (${days} days), excluding bills, loan repayments, transfers and one-offs already listed` });
    } else {
      warnings.push('Less than four weeks of spending history is available, so everyday spending is not included. Add it manually or import more history.');
    }
  } else {
    warnings.push('No spending history is available for the last six months, so everyday spending is not included.');
  }

  const tds = listTermDeposits(ctx).deposits.filter((t) => t.status === 'active' && t.maturityDate >= today);
  const brokerage = accounts.filter((a) => a.type === 'brokerage' && a.balance);
  const assumptions: ForecastAssumptions = {
    startDate: today,
    months,
    startingCashCents: startingCash,
    startingCashAsOf: asOf,
    startingCashNote: missing.length ? `${missing.length} cash account(s) have no balance and count as $0.` : '',
    inflationPercent: s.forecast.inflationPercent,
    wageGrowthPercent: s.forecast.wageGrowthPercent,
    savingsInterestPercent: s.forecast.savingsInterestPercent,
    investmentReturnPercent: s.forecast.investmentReturnPercent,
    startingInvestmentsCents: brokerage.reduce((a, x) => a + x.balance!.balanceCents, 0),
    streams,
    oneOffs: [],
    termDeposits: tds.map((t) => ({ id: t.id, label: `${t.institution}${t.name ? ` ${t.name}` : ''}`, maturityDate: t.maturityDate, principalCents: t.principalCents, maturityValueCents: t.schedule.maturityValueCents })),
    mortgage: forecastMortgage,
    lowBalanceThresholdCents: s.forecast.lowBalanceThresholdCents,
  };
  return { assumptions, provenance, warnings };
}

/* ------------------------------ scenarios ------------------------------ */

function scenarioFromRow(r: Record<string, unknown>): Scenario & { createdAt: string; updatedAt: string } {
  return { id: String(r.id), name: String(r.name), description: str(r.description), changes: json<ScenarioChange[]>(r.changes, []), overrides: json(r.overrides, {}), createdAt: String(r.created_at), updatedAt: String(r.updated_at) };
}

export function listScenarios(ctx: Ctx) {
  const mortgage = listLoans(ctx).find((l) => l.kind === 'mortgage');
  return { scenarios: ctx.db.all('SELECT * FROM scenarios ORDER BY created_at').map(scenarioFromRow), templates: scenarioTemplates(ctx.today(), mortgage?.ratePercent ?? null) };
}

export function saveScenario(ctx: Ctx, s: Scenario): string {
  if (!s.name.trim()) throw new UserError('Give the scenario a name.');
  const id = s.id && !s.id.startsWith('tpl-') ? s.id : ctx.id();
  ctx.db.run(`INSERT INTO scenarios(id, name, description, changes, overrides, created_at, updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, changes=excluded.changes, overrides=excluded.overrides, updated_at=excluded.updated_at`,
    [id, s.name.trim(), s.description ?? null, JSON.stringify(s.changes), JSON.stringify(s.overrides ?? {}), ctx.now(), ctx.now()]);
  ctx.changed('scenarios');
  return id;
}

export function duplicateScenario(ctx: Ctx, id: string): string {
  const r = ctx.db.get('SELECT * FROM scenarios WHERE id = ?', [id]);
  if (!r) throw new UserError('That scenario no longer exists.');
  const s = scenarioFromRow(r);
  return saveScenario(ctx, { ...s, id: '', name: `${s.name} (copy)` });
}

export function deleteScenario(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM scenarios WHERE id = ?', [id]);
  ctx.changed('scenarios');
}

export function runScenarios(ctx: Ctx, base: ForecastAssumptions, scenarioIds: string[], extra: Scenario[] = []) {
  const stored = scenarioIds.map((id) => ctx.db.get('SELECT * FROM scenarios WHERE id = ?', [id])).filter(Boolean).map((r) => scenarioFromRow(r!));
  const all: Scenario[] = [{ id: 'base', name: 'Current path', changes: [] }, ...stored, ...extra];
  const results = all.map((scenario) => ({ scenario, result: runForecast(base, scenario) }));
  return { results, comparison: compareScenarios(results) };
}

/* ------------------------------ snapshots ------------------------------ */

export function saveSnapshot(ctx: Ctx, base: ForecastAssumptions, scenarioId: string | null, name: string) {
  const scenario = scenarioId ? scenarioFromRow(ctx.db.get('SELECT * FROM scenarios WHERE id = ?', [scenarioId]) ?? (() => { throw new UserError('That scenario no longer exists.'); })()) : { id: 'base', name: 'Current path', changes: [] };
  const result = runForecast(base, scenario);
  const summary = {
    endDate: result.endDate, endCashCents: result.end.cashCents, endNetPositionCents: result.end.netPositionCents, lowest: result.lowest,
    firstBelowZero: result.firstBelowZero, mortgagePayoffDate: result.mortgagePayoffDate, summary: result.summary, assumptionsText: result.assumptions,
    points: result.points.filter((_, i) => i % Math.max(1, Math.floor(result.points.length / 60)) === 0),
  };
  const id = ctx.id();
  ctx.db.run('INSERT INTO scenario_snapshots(id, scenario_id, name, created_at, assumptions, changes, summary) VALUES(?,?,?,?,?,?,?)',
    [id, scenarioId, name.trim() || `${scenario.name} — ${formatDate(ctx.today(), { long: true })}`, ctx.now(), JSON.stringify(base), JSON.stringify(scenario.changes), JSON.stringify(summary)]);
  ctx.changed('scenarios');
  return id;
}

export function listSnapshots(ctx: Ctx) {
  return ctx.db.all('SELECT * FROM scenario_snapshots ORDER BY created_at DESC').map((r) => ({
    id: String(r.id), scenarioId: str(r.scenario_id), name: String(r.name), createdAt: String(r.created_at),
    assumptions: json<ForecastAssumptions | null>(r.assumptions, null), changes: json<ScenarioChange[]>(r.changes, []),
    summary: json<{ endDate: ISODate; endCashCents: Cents; endNetPositionCents: Cents; lowest: { date: ISODate; cashCents: Cents }; firstBelowZero: ISODate | null; mortgagePayoffDate: ISODate | null; summary: string; assumptionsText: string[]; points: { date: ISODate; cashCents: Cents }[] } | null>(r.summary, null),
  }));
}

export function deleteSnapshot(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM scenario_snapshots WHERE id = ?', [id]);
  ctx.changed('scenarios');
}

/** What changed between two snapshots: assumptions side by side and outcomes. */
export function compareSnapshots(ctx: Ctx, aId: string, bId: string) {
  const list = listSnapshots(ctx);
  const a = list.find((x) => x.id === aId);
  const b = list.find((x) => x.id === bId);
  if (!a || !b || !a.summary || !b.summary || !a.assumptions || !b.assumptions) throw new UserError('Choose two saved snapshots.');
  const diffs: { label: string; a: string; b: string }[] = [];
  const cmp = (label: string, x: unknown, y: unknown) => {
    if (JSON.stringify(x) !== JSON.stringify(y)) diffs.push({ label, a: String(x), b: String(y) });
  };
  cmp('Starting cash', formatMoney(a.assumptions.startingCashCents), formatMoney(b.assumptions.startingCashCents));
  cmp('Inflation', `${a.assumptions.inflationPercent}%`, `${b.assumptions.inflationPercent}%`);
  cmp('Wage growth', `${a.assumptions.wageGrowthPercent}%`, `${b.assumptions.wageGrowthPercent}%`);
  cmp('Savings interest', `${a.assumptions.savingsInterestPercent}%`, `${b.assumptions.savingsInterestPercent}%`);
  cmp('Investment return', `${a.assumptions.investmentReturnPercent}%`, `${b.assumptions.investmentReturnPercent}%`);
  cmp('Forecast length', `${a.assumptions.months} months`, `${b.assumptions.months} months`);
  const streamText = (s: ForecastAssumptions) => s.streams.map((x) => `${x.name} ${formatMoney(x.amountCents)} ${x.frequency}`).sort().join('; ');
  cmp('Income and spending items', streamText(a.assumptions), streamText(b.assumptions));
  cmp('Scenario changes', a.changes.length, b.changes.length);
  return {
    a, b, assumptionDifferences: diffs,
    outcome: [
      { label: 'Cash at end', a: a.summary.endCashCents, b: b.summary.endCashCents },
      { label: 'Net position at end', a: a.summary.endNetPositionCents, b: b.summary.endNetPositionCents },
      { label: 'Lowest cash', a: a.summary.lowest.cashCents, b: b.summary.lowest.cashCents },
    ],
  };
}

/* ------------------------------ cash-flow calendar ------------------------------ */

export function cashflowCalendar(ctx: Ctx, days = 90, base?: ForecastAssumptions) {
  const built = base ? { assumptions: base, provenance: [], warnings: [] } : buildAssumptions(ctx, Math.ceil(days / 30) + 1);
  const a = { ...built.assumptions, months: Math.ceil(days / 30) + 1 };
  const r = runForecast(a);
  const end = addDays(a.startDate, days);
  const events = r.events.filter((e) => e.date <= end);
  const lowWithin = events.reduce<{ date: ISODate; cashCents: Cents } | null>((low, e) => (!low || e.cashAfterCents < low.cashCents ? { date: e.date, cashCents: e.cashAfterCents } : low), null);
  const belowThreshold = events.filter((e) => e.cashAfterCents < a.lowBalanceThresholdCents);
  return {
    startDate: a.startDate,
    endDate: end,
    startingCashCents: a.startingCashCents,
    startingCashAsOf: a.startingCashAsOf,
    events,
    daily: r.points.filter((p) => p.date <= end),
    lowest: lowWithin,
    thresholdCents: a.lowBalanceThresholdCents,
    firstBelowThreshold: belowThreshold[0]?.date ?? null,
    sentence: lowWithin
      ? `Based on currently scheduled items, projected cash balance falls to approximately ${formatMoney(lowWithin.cashCents, { wholeDollars: true })} on ${formatDate(lowWithin.date)}. This is a forecast.`
      : 'No scheduled items in this period.',
    warnings: built.warnings,
    provenance: built.provenance,
  };
}
