import { Ctx, UserError, analysisTransactions, bool, categoryMap, num, str, recordChange } from './core';
import { periodOptions } from './insights';
import { ISODate, addMonths, addDays, isValidDate } from '../../domain/dates';
import { Frequency, periodContaining, PeriodKind, FREQUENCIES, DateRange } from '../../domain/periods';
import { Budget, BudgetMethod, advanceBill, budgetVsActual, findBillPayment, proposeBudget, sinkingFundPlan, Bill, SinkingFund } from '../../domain/budget';
import { BillDTO } from '../../shared/types';

/* ------------------------------ budgets ------------------------------ */

function loadBudget(ctx: Ctx, id: string): Budget {
  const b = ctx.db.get('SELECT * FROM budgets WHERE id = ?', [id]);
  if (!b) throw new UserError('That budget no longer exists.');
  return {
    id: String(b.id),
    name: String(b.name),
    method: b.method as BudgetMethod,
    frequency: b.frequency as Frequency,
    basisStart: str(b.basis_start),
    basisEnd: str(b.basis_end),
    lines: ctx.db.all('SELECT * FROM budget_lines WHERE budget_id = ?', [id]).map((l) => ({ categoryId: String(l.category_id), amountCents: Number(l.amount_cents), basisCents: num(l.basis_cents), note: str(l.note) })),
  };
}

export function listBudgets(ctx: Ctx) {
  return ctx.db.all('SELECT * FROM budgets ORDER BY is_active DESC, created_at DESC').map((b) => ({ ...loadBudget(ctx, String(b.id)), isActive: bool(b.is_active), createdAt: String(b.created_at) }));
}

/** Expense categories that had spending in the basis period (used to propose a historical budget). */
function spentCategories(ctx: Ctx, basis: DateRange, level: 'top' | 'leaf'): string[] {
  const cats = categoryMap(ctx);
  const ids = new Set<string>();
  for (const t of analysisTransactions(ctx, basis.start, basis.end)) {
    if (t.isTransfer) continue;
    for (const a of t.splits?.length ? t.splits : [{ categoryId: t.categoryId, amountCents: t.amountCents }]) {
      if (!a.categoryId || a.amountCents >= 0) continue;
      let id: string | null = a.categoryId;
      if (level === 'top') while (id && cats.get(id)?.parentId) id = cats.get(id)!.parentId;
      if (id && cats.get(id)?.kind === 'expense') ids.add(id);
    }
  }
  return [...ids];
}

export function proposeLines(ctx: Ctx, frequency: Frequency, basis: DateRange, level: 'top' | 'leaf') {
  const cats = categoryMap(ctx);
  const txs = analysisTransactions(ctx, basis.start, basis.end);
  const p = proposeBudget(txs, basis, cats, frequency, spentCategories(ctx, basis, level));
  return { ...p, lines: p.lines.map((l) => ({ ...l, categoryName: cats.get(l.categoryId)?.name ?? l.categoryId })) };
}

export interface BudgetInput {
  id?: string;
  name: string;
  method: BudgetMethod;
  frequency: Frequency;
  basisStart?: ISODate | null;
  basisEnd?: ISODate | null;
  lines: { categoryId: string; amountCents: number; basisCents?: number | null; note?: string | null }[];
  makeActive?: boolean;
}

export function saveBudget(ctx: Ctx, b: BudgetInput): string {
  if (!b.name.trim()) throw new UserError('Give the budget a name.');
  if (!FREQUENCIES.includes(b.frequency)) throw new UserError('Choose a budget period.');
  if (b.lines.some((l) => l.amountCents < 0)) throw new UserError('Budget amounts cannot be negative.');
  const seen = new Set<string>();
  for (const l of b.lines) {
    if (seen.has(l.categoryId)) throw new UserError('Each category can appear only once in a budget.');
    seen.add(l.categoryId);
  }
  const id = b.id ?? ctx.id();
  ctx.db.tx(() => {
    if (b.makeActive !== false) ctx.db.run('UPDATE budgets SET is_active = 0');
    ctx.db.run(`INSERT INTO budgets(id, name, method, frequency, basis_start, basis_end, is_active, created_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, method=excluded.method, frequency=excluded.frequency, basis_start=excluded.basis_start, basis_end=excluded.basis_end, is_active=excluded.is_active`,
      [id, b.name.trim(), b.method, b.frequency, b.basisStart ?? null, b.basisEnd ?? null, b.makeActive === false ? 0 : 1, ctx.now()]);
    ctx.db.run('DELETE FROM budget_lines WHERE budget_id = ?', [id]);
    for (const l of b.lines) ctx.db.run('INSERT INTO budget_lines(id, budget_id, category_id, amount_cents, basis_cents, note) VALUES(?,?,?,?,?,?)', [ctx.id(), id, l.categoryId, l.amountCents, l.basisCents ?? null, l.note ?? null]);
    recordChange(ctx, 'budget', id, 'saved', null, `${b.lines.length} lines`, 'Saved by you');
  });
  ctx.changed('budgets');
  return id;
}

export function deleteBudget(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM budgets WHERE id = ?', [id]);
  ctx.changed('budgets');
}

const FREQ_TO_PERIOD: Partial<Record<Frequency, PeriodKind>> = { weekly: 'week', fortnightly: 'fortnight', monthly: 'month', quarterly: 'quarter', 'six-monthly': 'half-year', annually: 'financial-year' };

export function budgetReport(ctx: Ctx, budgetId: string, viewKind?: PeriodKind, anchor?: ISODate) {
  const budget = loadBudget(ctx, budgetId);
  const opts = periodOptions(ctx);
  const natural = FREQ_TO_PERIOD[budget.frequency] ?? 'month';
  const kind = viewKind ?? natural;
  const period = periodContaining(kind, anchor ?? ctx.today(), opts);
  const txs = analysisTransactions(ctx, period.start, period.end);
  const r = budgetVsActual(budget, txs, period, categoryMap(ctx), { today: ctx.today(), periodMatchesFrequency: kind === natural });
  return {
    budget,
    period,
    ...r,
    scaled: kind !== natural,
    note: kind !== natural ? `Budget amounts are ${budget.frequency} and have been scaled to this ${kind} by the number of days.` : null,
  };
}

/* ------------------------------ bills ------------------------------ */

function billFromRow(r: Record<string, unknown>): BillDTO {
  return {
    id: String(r.id), name: String(r.name), amountCents: Number(r.amount_cents), frequency: r.frequency as Frequency, nextDue: String(r.next_due),
    categoryId: str(r.category_id), accountId: str(r.account_id), autoPay: bool(r.auto_pay), reminderDays: Number(r.reminder_days),
    reminderEnabled: bool(r.reminder_enabled), active: bool(r.active), matchText: str(r.match_text), notes: str(r.notes),
  };
}

export function listBills(ctx: Ctx): (BillDTO & { suggestedPayment: { id: string; date: ISODate; amountCents: number; description: string } | null })[] {
  const bills = ctx.db.all('SELECT * FROM bills ORDER BY active DESC, next_due').map(billFromRow);
  const recent = ctx.db.all("SELECT id, date, amount_cents, original_description FROM transactions WHERE status = 'posted' AND date >= ? AND amount_cents < 0", [addDays(ctx.today(), -60)])
    .map((t) => ({ id: String(t.id), date: String(t.date), amountCents: Number(t.amount_cents), description: String(t.original_description) }));
  return bills.map((b) => {
    const m = b.active && b.nextDue <= addDays(ctx.today(), 7) ? findBillPayment(b as Bill, recent) : null;
    const tx = m ? recent.find((t) => t.id === m.id) ?? null : null;
    return { ...b, suggestedPayment: tx };
  });
}

export function saveBill(ctx: Ctx, b: Omit<BillDTO, 'id'> & { id?: string }): string {
  if (!b.name.trim()) throw new UserError('Give the bill a name.');
  if (!isValidDate(b.nextDue)) throw new UserError('Enter the next due date.');
  if (b.amountCents <= 0) throw new UserError('Enter the expected amount.');
  const id = b.id ?? ctx.id();
  ctx.db.run(`INSERT INTO bills(id, name, amount_cents, frequency, next_due, category_id, account_id, auto_pay, reminder_days, reminder_enabled, active, match_text, notes, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, amount_cents=excluded.amount_cents, frequency=excluded.frequency, next_due=excluded.next_due,
      category_id=excluded.category_id, account_id=excluded.account_id, auto_pay=excluded.auto_pay, reminder_days=excluded.reminder_days,
      reminder_enabled=excluded.reminder_enabled, active=excluded.active, match_text=excluded.match_text, notes=excluded.notes`,
    [id, b.name.trim(), b.amountCents, b.frequency, b.nextDue, b.categoryId, b.accountId, b.autoPay ? 1 : 0, b.reminderDays, b.reminderEnabled ? 1 : 0, b.active ? 1 : 0, b.matchText, b.notes, ctx.now()]);
  ctx.changed('bills');
  return id;
}

export function deleteBill(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM bills WHERE id = ?', [id]);
  ctx.changed('bills');
}

/** Mark the current due date as paid and move to the next one. */
export function markBillPaid(ctx: Ctx, id: string, transactionId?: string | null): BillDTO {
  const r = ctx.db.get('SELECT * FROM bills WHERE id = ?', [id]);
  if (!r) throw new UserError('That bill no longer exists.');
  const bill = billFromRow(r);
  const next = advanceBill(bill as Bill);
  ctx.db.run('UPDATE bills SET next_due = ? WHERE id = ?', [next, id]);
  recordChange(ctx, 'bill', id, 'paid', bill.nextDue, next, transactionId ? `Paid (matched to a transaction)` : 'Marked paid by you');
  if (transactionId) ctx.db.run('UPDATE transactions SET notes = COALESCE(notes, ?) WHERE id = ?', [`Payment of bill: ${bill.name}`, transactionId]);
  ctx.changed('bills');
  return billFromRow(ctx.db.get('SELECT * FROM bills WHERE id = ?', [id])!);
}

/* ------------------------------ sinking funds ------------------------------ */

export function listSinkingFunds(ctx: Ctx) {
  return ctx.db.all('SELECT * FROM sinking_funds ORDER BY due_date').map((r) => {
    const f: SinkingFund = { id: String(r.id), name: String(r.name), targetCents: Number(r.target_cents), savedCents: Number(r.saved_cents), dueDate: String(r.due_date), categoryId: str(r.category_id), repeat: (r.repeat as Frequency) ?? null };
    return { ...f, notes: str(r.notes), plan: sinkingFundPlan(f, ctx.today()) };
  });
}

export function saveSinkingFund(ctx: Ctx, f: SinkingFund & { notes?: string | null }): string {
  if (!f.name.trim()) throw new UserError('Give this a name.');
  if (f.targetCents <= 0) throw new UserError('Enter the amount needed.');
  if (!isValidDate(f.dueDate)) throw new UserError('Enter the date it is needed by.');
  const id = f.id || ctx.id();
  ctx.db.run(`INSERT INTO sinking_funds(id, name, target_cents, saved_cents, due_date, category_id, repeat, notes, created_at) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, target_cents=excluded.target_cents, saved_cents=excluded.saved_cents, due_date=excluded.due_date,
      category_id=excluded.category_id, repeat=excluded.repeat, notes=excluded.notes`,
    [id, f.name.trim(), f.targetCents, Math.max(0, f.savedCents), f.dueDate, f.categoryId ?? null, f.repeat ?? null, f.notes ?? null, ctx.now()]);
  ctx.changed('sinking');
  return id;
}

export function deleteSinkingFund(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM sinking_funds WHERE id = ?', [id]);
  ctx.changed('sinking');
}

/** After the expense is paid: reset the saved amount and roll a repeating fund to its next date. */
export function completeSinkingFund(ctx: Ctx, id: string): void {
  const r = ctx.db.get('SELECT * FROM sinking_funds WHERE id = ?', [id]);
  if (!r) return;
  if (r.repeat) {
    const months = { annually: 12, 'six-monthly': 6, quarterly: 3, monthly: 1 }[String(r.repeat)] ?? 12;
    ctx.db.run('UPDATE sinking_funds SET saved_cents = 0, due_date = ? WHERE id = ?', [addMonths(String(r.due_date), months), id]);
  } else {
    ctx.db.run('DELETE FROM sinking_funds WHERE id = ?', [id]);
  }
  ctx.changed('sinking');
}
