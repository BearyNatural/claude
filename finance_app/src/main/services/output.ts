import { Ctx, UserError, categoryMap, listAccounts, listCategories, getSettings } from './core';
import { listTransactions } from './transactions';
import { budgetReport, listBills, listBudgets, listSinkingFunds } from './budgeting';
import { listGoals, listLoans, listTermDeposits, modelLoan, buildAssumptions, runScenarios, listScenarios } from './planning';
import { basPreparation, investmentsOverview, listPayslips, listTaxEntries, superOverview, taxEstimate, taxRulesInfo, buildTaxInput } from './taxes';
import { costOfLiving, netWorth, recurringList, spendingSummary, subscriptions } from './insights';
import { listDocuments } from './documents';
import { ISODate, formatDate, formatMonth, fyRange, fyDisplay, financialYearOf } from '../../domain/dates';
import { Cents } from '../../domain/money';
import { FREQUENCY_LABEL, PERIODS_PER_YEAR, DateRange } from '../../domain/periods';
import { INCOME_TYPE_LABEL } from '../../domain/categorise/categories';
import { ACCOUNT_TYPE_LABEL, VALUE_SOURCE_LABEL } from '../../domain/accounts';
import { Cell, Sheet, Workbook, date, money, pct } from '../../domain/output/workbook';
import {
  TxRow, billsSheet, budgetVsActualSheet, dashboardSheet, forecastSheet, goalsSheet, holdingsSheet, incomeSheet, loanSheet,
  scenariosSheet, simpleSheet, spendingByCategorySheet, taxSheet, termDepositsSheet, transactionsSheet,
} from '../../domain/output/sheets';
import { toCsv, CsvValue } from '../../domain/output/csv';
import { runForecast } from '../../domain/planning/forecast';

export const WORKBOOK_SHEETS = [
  'Dashboard', 'Accounts', 'Transactions', 'Income', 'Expenses', 'Budget vs Actual', 'Bills', 'Savings Goals', 'Mortgage', 'Debt',
  'Term Deposits', 'Investments', 'Super', 'Tax Estimate', 'Forecast', 'Scenarios',
] as const;
export type WorkbookSheetName = (typeof WORKBOOK_SHEETS)[number];

export interface WorkbookOptions {
  sheets?: WorkbookSheetName[];
  range: DateRange;
  fy?: string;
  title?: string;
}

function txRows(ctx: Ctx, range: DateRange): TxRow[] {
  const cats = listCategories(ctx, true);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const top = (id: string | null) => {
    let c = id ? byId.get(id) : undefined;
    let guard = 0;
    while (c?.parentId && guard++ < 10) c = byId.get(c.parentId);
    return c?.name ?? '';
  };
  const out: TxRow[] = [];
  for (const t of listTransactions(ctx, { status: 'posted', from: range.start, to: range.end, limit: 1_000_000, sort: 'date-asc' }).rows) {
    const kind = (catId: string | null, amt: number) => (t.isTransfer ? 'Transfer' : catId && byId.get(catId)?.kind === 'income' ? 'Income' : catId && byId.get(catId)?.kind === 'expense' ? 'Expense' : amt > 0 ? 'Income' : 'Expense') as TxRow['type'];
    const base = {
      date: t.date, account: t.accountName, description: t.cleanDescription, payee: t.payee ?? '', incomeType: t.incomeType ? INCOME_TYPE_LABEL[t.incomeType] : '',
      tags: t.tags.join(' '), business: t.businessUse === 'mixed' ? `Mixed (${t.businessPercent ?? 0}% business)` : t.businessUse ?? '', notes: t.notes ?? '',
    };
    if (t.splits.length) {
      for (const s of t.splits) out.push({ ...base, category: s.categoryName ?? 'Uncategorised', group: top(s.categoryId), amountCents: s.amountCents, type: kind(s.categoryId, s.amountCents), notes: `${base.notes} [part of split ${(t.amountCents / 100).toFixed(2)}]`.trim() });
    } else {
      out.push({ ...base, category: t.categoryName ?? 'Uncategorised', group: top(t.categoryId), amountCents: t.amountCents, type: kind(t.categoryId, t.amountCents) });
    }
  }
  return out;
}

/** Build a workbook with only the relevant sheets (empty sections are left out). */
export function buildWorkbook(ctx: Ctx, opts: WorkbookOptions): Workbook {
  const want = new Set<WorkbookSheetName>(opts.sheets?.length ? opts.sheets : WORKBOOK_SHEETS);
  const fy = opts.fy ?? financialYearOf(ctx.today());
  const sheets: Sheet[] = [];
  const rows = txRows(ctx, opts.range);
  const accounts = listAccounts(ctx).filter((a) => a.status !== 'archived');
  const periodLabel = `${formatDate(opts.range.start)} – ${formatDate(opts.range.end)}`;

  if (want.has('Dashboard')) sheets.push(dashboardSheet(periodLabel, rows.length, accounts.map((a) => ({ account: a.name, balanceCents: a.balance?.balanceCents ?? 0, source: a.balance ? VALUE_SOURCE_LABEL[a.balance.source] : 'No balance yet', date: a.balance?.date ?? null }))));
  if (want.has('Accounts') && accounts.length) {
    sheets.push(simpleSheet('Accounts', [{ header: 'Account', width: 24 }, { header: 'Type', width: 22 }, { header: 'Institution', width: 18 }, { header: 'Status' }, { header: 'Balance', format: 'currency' }, { header: 'How it is known', width: 18 }, { header: 'As at', format: 'date' }],
      accounts.map((a) => [a.name, ACCOUNT_TYPE_LABEL[a.type], a.institution ?? '', a.status, a.balance ? money(a.balance.balanceCents) : null, a.balance ? VALUE_SOURCE_LABEL[a.balance.source] : 'No balance yet', date(a.balance?.date)]),
      ['Balances are the latest known values, each with its date. They are not live bank balances.']));
  }
  if (want.has('Transactions') && rows.length) sheets.push(transactionsSheet(rows));
  if (want.has('Income') && rows.some((r) => r.type === 'Income')) {
    const types = [...new Set(rows.filter((r) => r.type === 'Income').map((r) => r.incomeType || ''))];
    sheets.push(incomeSheet(types.map((t) => ({ label: t || '(not classified)', incomeType: t })), rows.length));
  }
  if (want.has('Expenses') && rows.some((r) => r.type === 'Expense')) {
    const pairs = [...new Map(rows.filter((r) => r.type === 'Expense').map((r) => [`${r.group}|${r.category}`, { group: r.group, category: r.category }])).values()].sort((a, b) => a.group.localeCompare(b.group) || a.category.localeCompare(b.category));
    sheets.push(spendingByCategorySheet(pairs, rows.length));
  }
  if (want.has('Budget vs Actual')) {
    const active = listBudgets(ctx).find((b) => b.isActive);
    if (active) {
      const rep = budgetReport(ctx, active.id);
      sheets.push(budgetVsActualSheet(`${active.name} — ${rep.period.label}`, rep.rows.map((r) => ({ category: r.name, budgetCents: r.budgetCents, actualCents: r.actualCents }))));
    }
  }
  if (want.has('Bills')) {
    const bills = listBills(ctx).filter((b) => b.active);
    const accNames = new Map(accounts.map((a) => [a.id, a.name]));
    if (bills.length) sheets.push(billsSheet(bills.map((b) => ({ name: b.name, amountCents: b.amountCents, frequency: FREQUENCY_LABEL[b.frequency], perYear: PERIODS_PER_YEAR[b.frequency], nextDue: b.nextDue, account: b.accountId ? accNames.get(b.accountId) ?? '' : '', autoPay: b.autoPay }))));
    const funds = listSinkingFunds(ctx);
    if (funds.length) {
      sheets.push(simpleSheet('Sinking Funds', [{ header: 'Expense', width: 24 }, { header: 'Needed', format: 'currency' }, { header: 'Set aside', format: 'currency' }, { header: 'Due', format: 'date' }, { header: 'Remaining', format: 'currency' }, { header: 'Per week', format: 'currency' }, { header: 'Per fortnight', format: 'currency' }, { header: 'Per month', format: 'currency' }],
        funds.map((f, i) => [f.name, money(f.targetCents), money(f.savedCents), date(f.dueDate), { formula: `MAX(0,B${i + 2}-C${i + 2})`, format: 'currency' }, money(f.plan.perWeekCents), money(f.plan.perFortnightCents), money(f.plan.perMonthCents)] as Cell[]),
        ['Amounts per week, fortnight and month are the remaining amount divided by the periods left before the due date.']));
    }
  }
  if (want.has('Savings Goals')) {
    const goals = listGoals(ctx);
    if (goals.length) sheets.push(goalsSheet(goals.map((g) => ({ name: g.name, targetCents: g.targetCents, currentCents: g.currentCents, targetDate: g.targetDate ?? null, contributionCents: g.contributionCents, frequency: FREQUENCY_LABEL[g.contributionFrequency], ratePercent: g.annualRatePercent, projectedDate: g.projection.projectedDate }))));
  }
  const loans = listLoans(ctx);
  if (want.has('Mortgage')) {
    for (const l of loans.filter((x) => x.kind === 'mortgage')) {
      const m = modelLoan(ctx, l.id);
      sheets.push(loanSheet(loans.filter((x) => x.kind === 'mortgage').length > 1 ? l.name : 'Mortgage', { principalCents: l.balanceCents, ratePercent: l.ratePercent, repaymentCents: m.result.repaymentCents, frequency: FREQUENCY_LABEL[l.frequency], offsetCents: m.offsetCents, payoffDate: m.result.payoffDate, totalInterestCents: m.result.totalInterestCents }, m.result.years, ['Under the stated assumptions — rates may change.', ...m.result.assumptions]));
    }
  }
  if (want.has('Debt')) {
    const debts = loans.filter((x) => x.kind !== 'mortgage');
    if (debts.length) {
      sheets.push(simpleSheet('Debt', [{ header: 'Debt', width: 24 }, { header: 'Balance', format: 'currency' }, { header: 'Rate', format: 'percent' }, { header: 'Repayment', format: 'currency' }, { header: 'Frequency' }, { header: 'Estimated payoff', format: 'date' }, { header: 'Estimated interest', format: 'currency' }],
        debts.map((d) => {
          const m = modelLoan(ctx, d.id);
          return [d.name, money(d.balanceCents), pct(d.ratePercent / 100), money(m.result.repaymentCents), FREQUENCY_LABEL[d.frequency], date(m.result.payoffDate), money(m.result.totalInterestCents)] as Cell[];
        }), ['Payoff estimates assume the rate and repayment stay as entered.']));
    }
  }
  if (want.has('Term Deposits')) {
    const tds = listTermDeposits(ctx).deposits.filter((t) => t.status === 'active');
    if (tds.length) sheets.push(termDepositsSheet(tds.map((t) => ({ institution: t.institution, principalCents: t.principalCents, start: t.startDate, maturity: t.maturityDate, ratePercent: t.annualRatePercent, interestCents: t.schedule.totalInterestCents, maturityValueCents: t.schedule.maturityValueCents, frequency: t.interestFrequency }))));
  }
  if (want.has('Investments')) {
    const inv = investmentsOverview(ctx, fy);
    if (inv.holdings.length) sheets.push(holdingsSheet(inv.holdings.map((h) => ({ code: h.security.code, name: h.security.name, quantity: h.quantity, costCents: h.costBaseCents, valueCents: h.valueCents, valuationDate: h.valuationDate }))));
    if (inv.dividends.length) {
      const codes = new Map(inv.securities.map((s) => [s.id, s.code]));
      sheets.push(simpleSheet('Dividends', [{ header: 'Paid', format: 'date' }, { header: 'Code' }, { header: 'Cash', format: 'currency' }, { header: 'Franked', format: 'currency' }, { header: 'Unfranked', format: 'currency' }, { header: 'Franking credits', format: 'currency' }, { header: 'From statement' }],
        inv.dividends.map((d) => [date(d.paymentDate), codes.get(d.securityId) ?? '', money(d.cashCents), money(d.frankedCents), money(d.unfrankedCents), money(d.frankingCreditsCents), d.fromStatement ? 'Yes' : 'No'] as Cell[]),
        ['Franking credits are only shown where a dividend statement was entered.']));
    }
  }
  if (want.has('Super')) {
    const sup = superOverview(ctx, fy);
    if (sup.entries.length) {
      sheets.push(simpleSheet('Super', [{ header: 'Date', format: 'date' }, { header: 'Type', width: 30 }, { header: 'Amount', format: 'currency' }],
        sup.entries.map((e) => [date(e.date), e.kind, money(e.amountCents)] as Cell[]), sup.summary.notes));
    }
  }
  if (want.has('Tax Estimate')) {
    const est = taxEstimate(ctx, fy);
    const info = taxRulesInfo(fy);
    if (est.supported && info) {
      sheets.push(taxSheet(fyDisplay(fy), [...est.income.map((l) => ({ label: l.label, amountCents: l.amountCents })), ...est.steps.map((s) => ({ label: s.label, amountCents: s.amountCents }))], est.taxableIncomeCents, info.brackets, est.disclaimer, est.sources.map((s) => `${s.title} (${s.url}, reviewed ${s.reviewed})`)));
    }
  }
  if (want.has('Forecast') || want.has('Scenarios')) {
    const built = buildAssumptions(ctx, 24);
    if (want.has('Forecast')) sheets.push(forecastSheet('Forecast', runForecast(built.assumptions).points, [...built.provenance, ...built.warnings]));
    if (want.has('Scenarios')) {
      const ids = listScenarios(ctx).scenarios.map((s) => s.id);
      if (ids.length) {
        const res = runScenarios(ctx, built.assumptions, ids);
        sheets.push(scenariosSheet(res.comparison.map((c) => ({ name: c.name, endCashCents: c.endCashCents, lowestCashCents: c.lowestCashCents, lowestDate: c.lowestDate, positiveUntil: c.cashPositiveUntil, sentence: c.sentence }))));
      }
    }
  }
  return { title: opts.title ?? `Geranium — ${periodLabel}`, createdAt: ctx.today(), sheets };
}

/* ------------------------------ CSV exports ------------------------------ */

export type CsvExportKind = 'transactions' | 'categories' | 'rules' | 'budgets' | 'bills' | 'income' | 'goals' | 'forecast' | 'accounts' | 'payslips';

export function exportCsv(ctx: Ctx, kind: CsvExportKind, range: DateRange): string {
  switch (kind) {
    case 'transactions': {
      const t = listTransactions(ctx, { status: 'posted', from: range.start, to: range.end, limit: 1_000_000, sort: 'date-asc' }).rows;
      return toCsv(['Date', 'Processing date', 'Account', 'Amount', 'Original description', 'Description', 'Payee', 'Category', 'Transfer', 'Income type', 'Tax class', 'Business use', 'Business %', 'GST class', 'Tags', 'Notes', 'Split'],
        t.map((x) => [x.date, x.processingDate, x.accountName, x.amountCents / 100, x.originalDescription, x.cleanDescription, x.payee, x.categoryPath, x.isTransfer ? 'Yes' : '', x.incomeType, x.taxClass, x.businessUse, x.businessPercent, x.gstClass, x.tags.join(' '), x.notes, x.splits.map((s) => `${s.categoryName}:${(s.amountCents / 100).toFixed(2)}`).join('; ')]));
    }
    case 'categories':
      return toCsv(['Id', 'Category', 'Path', 'Type', 'Nature', 'Built-in', 'Archived'], listCategories(ctx, true).map((c) => [c.id, c.name, c.path, c.kind, c.nature, c.isDefault ? 'Yes' : '', c.archived ? 'Yes' : '']));
    case 'rules': {
      const cats = categoryMap(ctx);
      return toCsv(['Source', 'Field', 'Match', 'Pattern', 'Direction', 'Category', 'Income type', 'Enabled'], ctx.db.all('SELECT * FROM rules ORDER BY source, pattern').map((r) => [String(r.source), String(r.field), String(r.match_type), String(r.pattern), String(r.direction ?? ''), r.category_id ? cats.get(String(r.category_id))?.name ?? '' : '', String(r.income_type ?? ''), r.enabled ? 'Yes' : 'No'] as CsvValue[]));
    }
    case 'budgets': {
      const cats = categoryMap(ctx);
      return toCsv(['Budget', 'Method', 'Period', 'Category', 'Amount', 'Historical basis'], listBudgets(ctx).flatMap((b) => b.lines.map((l) => [b.name, b.method, b.frequency, cats.get(l.categoryId)?.name ?? l.categoryId, l.amountCents / 100, l.basisCents === null || l.basisCents === undefined ? '' : l.basisCents / 100] as CsvValue[])));
    }
    case 'bills':
      return toCsv(['Bill', 'Amount', 'Frequency', 'Next due', 'Automatic', 'Annual cost'], listBills(ctx).map((b) => [b.name, b.amountCents / 100, b.frequency, b.nextDue, b.autoPay ? 'Yes' : 'No', (b.amountCents * PERIODS_PER_YEAR[b.frequency]) / 100]));
    case 'income': {
      const s = spendingSummary(ctx, range);
      return toCsv(['Income type', 'Total', 'Count'], s.income.map((i) => [i.incomeType === 'unclassified' ? 'Not classified' : INCOME_TYPE_LABEL[i.incomeType], i.totalCents / 100, i.count]));
    }
    case 'goals':
      return toCsv(['Goal', 'Target', 'Saved', 'Target date', 'Contribution', 'Frequency', 'Assumed interest %', 'Projected date'], listGoals(ctx).map((g) => [g.name, g.targetCents / 100, g.currentCents / 100, g.targetDate, g.contributionCents / 100, g.contributionFrequency, g.annualRatePercent, g.projection.projectedDate]));
    case 'forecast': {
      const r = runForecast(buildAssumptions(ctx, 24).assumptions);
      return toCsv(['Date', 'Cash', 'Investments', 'Term deposits', 'Mortgage', 'Net position'], r.points.map((p) => [p.date, p.cashCents / 100, p.investmentsCents / 100, p.termDepositsCents / 100, p.mortgageCents / 100, p.netPositionCents / 100]));
    }
    case 'accounts':
      return toCsv(['Account', 'Type', 'Institution', 'Status', 'Balance', 'Balance source', 'As at'], listAccounts(ctx).map((a) => [a.name, ACCOUNT_TYPE_LABEL[a.type], a.institution, a.status, a.balance ? a.balance.balanceCents / 100 : null, a.balance ? VALUE_SOURCE_LABEL[a.balance.source] : '', a.balance?.date ?? '']));
    case 'payslips':
      return toCsv(['Employer', 'Pay date', 'Gross', 'Allowances', 'Salary sacrifice', 'Tax withheld', 'Employer super', 'Deductions', 'Net'], listPayslips(ctx).map((p) => [p.employer, p.payDate, p.grossCents / 100, p.allowancesCents / 100, p.salarySacrificeCents / 100, p.paygCents / 100, p.employerSuperCents / 100, p.deductionsCents / 100, p.netCents / 100]));
    default:
      throw new UserError('Unknown export.');
  }
}

/* ------------------------------ reports ------------------------------ */

export type ReportKind =
  | 'cash-flow' | 'cost-of-living' | 'spending-categories' | 'recurring' | 'subscriptions' | 'income-by-source' | 'savings-rate'
  | 'business-summary' | 'gst-summary' | 'tax-estimate' | 'mortgage-progress' | 'debt' | 'investment-income' | 'interest-income'
  | 'term-deposits' | 'net-worth' | 'annual-expenditure';

export interface ReportTable {
  title: string;
  columns: { header: string; format?: 'currency' | 'date' | 'percent' | 'text' | 'number' }[];
  rows: (string | number | null)[][];
  notes: string[];
}

export function report(ctx: Ctx, kind: ReportKind, range: DateRange, fy?: string): ReportTable {
  const year = fy ?? financialYearOf(range.end);
  const cur = (c: Cents) => c / 100;
  switch (kind) {
    case 'cash-flow':
    case 'savings-rate': {
      const months: ReportTable['rows'] = [];
      let d = range.start.slice(0, 8) + '01';
      while (d <= range.end) {
        const end = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).toISOString().slice(0, 10);
        const from = d < range.start ? range.start : d, to = end > range.end ? range.end : end;
        const s = spendingSummary(ctx, { start: from, end: to });
        const label = formatMonth(d) + (from !== d || to !== end ? ` (${formatDate(from, { noYear: true })}–${formatDate(to, { noYear: true })}, part month)` : '');
        months.push([label, cur(s.totals.incomeCents), cur(s.totals.expenseCents), cur(s.totals.netCashFlowCents), s.totals.incomeCents > 0 ? (s.totals.incomeCents - s.totals.expenseCents) / s.totals.incomeCents : null]);
        const [y, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))];
        d = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
      }
      return { title: kind === 'cash-flow' ? 'Cash flow by month' : 'Savings rate by month', columns: [{ header: 'Month' }, { header: 'Income', format: 'currency' }, { header: 'Spending', format: 'currency' }, { header: 'Net', format: 'currency' }, { header: 'Savings rate', format: 'percent' }], rows: months, notes: ['Transfers between your own accounts are not counted as income or spending.', 'Savings rate = (income − spending) ÷ income.'] };
    }
    case 'cost-of-living': {
      const c = costOfLiving(ctx, range);
      return { title: 'Household cost of living', columns: [{ header: 'Category' }, { header: 'Actual in period', format: 'currency' }, { header: 'Per year', format: 'currency' }, { header: 'Per month', format: 'currency' }, { header: 'Per fortnight', format: 'currency' }, { header: 'Per week', format: 'currency' }, { header: 'Pattern' }],
        rows: c.items.map((i) => [i.name, cur(i.actualCents), cur(i.annualCents), cur(i.perMonthCents), cur(i.perFortnightCents), cur(i.perWeekCents), i.regularity]), notes: [c.basis] };
    }
    case 'spending-categories':
    case 'annual-expenditure': {
      const s = spendingSummary(ctx, range, kind === 'annual-expenditure' ? 'leaf' : 'top');
      return { title: kind === 'annual-expenditure' ? 'Annual expenditure by category' : 'Spending by category', columns: [{ header: 'Category' }, { header: 'Total', format: 'currency' }, { header: 'Per week', format: 'currency' }, { header: 'Per month', format: 'currency' }, { header: 'Transactions', format: 'number' }, { header: 'One-offs', format: 'currency' }],
        rows: s.rows.map((r) => [r.name, cur(r.totalCents), cur(r.perWeekCents), cur(r.perMonthCents), r.transactionCount, cur(r.oneOffCents)]), notes: [s.overall.basis.description, ...(s.partial ? ['Imported data does not cover the whole period; averages use the covered dates only.'] : [])] };
    }
    case 'recurring': {
      const r = recurringList(ctx);
      return { title: 'Recurring payments and income', columns: [{ header: 'Name' }, { header: 'Direction' }, { header: 'Frequency' }, { header: 'Amount', format: 'currency' }, { header: 'Per year', format: 'currency' }, { header: 'Next expected', format: 'date' }, { header: 'Status' }],
        rows: [...r.confirmed, ...r.suggested].map((x) => [x.name, x.direction === 'in' ? 'In' : 'Out', x.frequency, cur(x.amountCents), cur(x.annualCents), x.nextExpected, x.status]), notes: ['Suggested items are detected from your transactions and not yet confirmed.'] };
    }
    case 'subscriptions': {
      const s = subscriptions(ctx);
      return { title: 'Subscriptions and regular payments', columns: [{ header: 'Name' }, { header: 'Frequency' }, { header: 'Amount', format: 'currency' }, { header: 'Per year', format: 'currency' }, { header: 'Last payment', format: 'date' }, { header: 'Next expected', format: 'date' }],
        rows: s.items.map((x) => [x.name, x.frequency, cur(x.amountCents), cur(x.annualCents), x.lastSeen, x.nextExpected]), notes: [s.note] };
    }
    case 'income-by-source':
    case 'interest-income': {
      const s = spendingSummary(ctx, range);
      const inc = kind === 'interest-income' ? s.income.filter((i) => i.incomeType === 'interest' || i.incomeType === 'term-deposit-interest') : s.income;
      return { title: kind === 'interest-income' ? 'Interest income' : 'Income by source', columns: [{ header: 'Source' }, { header: 'Received', format: 'currency' }, { header: 'Payments', format: 'number' }], rows: inc.map((i) => [i.incomeType === 'unclassified' ? 'Not classified' : INCOME_TYPE_LABEL[i.incomeType], cur(i.totalCents), i.count]), notes: ['Amounts as deposited. Salary deposits are net pay; see payslips for gross pay and tax withheld.'] };
    }
    case 'business-summary': {
      const b = buildTaxInput(ctx, year);
      return { title: `Business and contractor summary — ${fyDisplay(year)}`, columns: [{ header: 'Item' }, { header: 'Amount', format: 'currency' }], rows: [['Business / contractor income', cur(b.input.businessIncomeCents)], ['Business expenses (business share)', cur(b.input.businessExpensesCents)], ['Net', cur(b.input.businessIncomeCents - b.input.businessExpensesCents)]], notes: b.lines.filter((l) => l.label.startsWith('Business')).map((l) => l.basis) };
    }
    case 'gst-summary': {
      const s = getSettings(ctx);
      const rows = [0, 1, 2, 3].map((q) => basPreparation(ctx, year, q)).map((b) => [b.quarter.label, cur(b.summary.g1TotalSalesCents), cur(b.summary.gstOnSales1ACents), cur(b.summary.gstOnPurchases1BCents), cur(b.summary.netGstCents)]);
      return { title: `GST summary — ${fyDisplay(year)}`, columns: [{ header: 'Quarter' }, { header: 'G1 Total sales', format: 'currency' }, { header: '1A GST on sales', format: 'currency' }, { header: '1B GST on purchases', format: 'currency' }, { header: 'Net GST', format: 'currency' }], rows, notes: [s.gstRegistered ? 'Preparation summary only — verify before lodgment.' : 'You are not marked as GST registered.'] };
    }
    case 'tax-estimate': {
      const e = taxEstimate(ctx, year);
      return { title: `Estimated tax position — ${fyDisplay(year)}`, columns: [{ header: 'Item' }, { header: 'Amount', format: 'currency' }], rows: [...e.income.map((l) => [l.label, cur(l.amountCents)]), ...e.steps.map((s) => [s.label, cur(s.amountCents)]), ['Estimated balance (positive = to pay, negative = overpaid)', cur(e.balanceCents)]], notes: [e.disclaimer, ...e.warnings, ...e.notes] };
    }
    case 'mortgage-progress':
    case 'debt': {
      const loans = listLoans(ctx).filter((l) => (kind === 'debt' ? l.kind !== 'mortgage' : l.kind === 'mortgage'));
      const rows: ReportTable['rows'] = [];
      for (const l of loans) for (const y of modelLoan(ctx, l.id).result.years) rows.push([l.name, y.year, y.endDate, cur(y.openingCents), cur(y.interestCents), cur(y.principalCents), cur(y.closingCents)]);
      return { title: kind === 'debt' ? 'Debt payoff projection' : 'Mortgage progress (projected)', columns: [{ header: 'Loan' }, { header: 'Year', format: 'number' }, { header: 'Year ending', format: 'date' }, { header: 'Opening', format: 'currency' }, { header: 'Interest', format: 'currency' }, { header: 'Principal reduction', format: 'currency' }, { header: 'Closing', format: 'currency' }], rows, notes: ['Under the assumptions entered — rates and repayments may change.'] };
    }
    case 'investment-income': {
      const inv = investmentsOverview(ctx, year);
      const codes = new Map(inv.securities.map((s) => [s.id, s.code]));
      const { start, end } = fyRange(year);
      return { title: `Investment income — ${fyDisplay(year)}`, columns: [{ header: 'Paid', format: 'date' }, { header: 'Code' }, { header: 'Cash', format: 'currency' }, { header: 'Franked', format: 'currency' }, { header: 'Unfranked', format: 'currency' }, { header: 'Franking credits', format: 'currency' }],
        rows: inv.dividends.filter((d) => d.paymentDate >= start && d.paymentDate <= end).map((d) => [d.paymentDate, codes.get(d.securityId) ?? '', cur(d.cashCents), cur(d.frankedCents), cur(d.unfrankedCents), cur(d.frankingCreditsCents)]), notes: [inv.dividendTotals.explanation] };
    }
    case 'term-deposits': {
      const t = listTermDeposits(ctx);
      return { title: 'Term deposits', columns: [{ header: 'Institution' }, { header: 'Principal', format: 'currency' }, { header: 'Rate', format: 'percent' }, { header: 'Matures', format: 'date' }, { header: 'Expected interest', format: 'currency' }, { header: 'At maturity', format: 'currency' }], rows: t.deposits.map((d) => [d.institution, cur(d.principalCents), d.annualRatePercent / 100, d.maturityDate, cur(d.schedule.totalInterestCents), cur(d.schedule.maturityValueCents)]), notes: ['Based on the rates you entered.'] };
    }
    case 'net-worth': {
      const n = netWorth(ctx);
      return { title: 'Net worth', columns: [{ header: 'Account' }, { header: 'Type' }, { header: 'Value', format: 'currency' }, { header: 'How known' }, { header: 'As at', format: 'date' }],
        rows: [...n.assets, ...n.liabilities].map((l) => [l.name, ACCOUNT_TYPE_LABEL[l.type], l.balance ? cur(l.balance.balanceCents) : null, l.balance ? VALUE_SOURCE_LABEL[l.balance.source] : 'No value', l.balance?.date ?? null]), notes: [`Net worth ${(n.netCents / 100).toFixed(2)} = assets ${(n.totalAssetsCents / 100).toFixed(2)} − liabilities ${(n.totalLiabilitiesCents / 100).toFixed(2)}.`, ...n.notes] };
    }
    default:
      throw new UserError('Unknown report.');
  }
}

export function reportToSheet(r: ReportTable): Sheet {
  return simpleSheet(r.title.slice(0, 31), r.columns.map((c) => ({ header: c.header, format: c.format === 'text' ? undefined : c.format, width: 18 })),
    r.rows.map((row) => row.map((v, i) => (r.columns[i]?.format === 'date' && typeof v === 'string' ? date(v) : v) as Cell)), r.notes);
}

/* ------------------------------ accountant package ------------------------------ */

export interface AccountantFile {
  path: string;
  content: string | Uint8Array;
}

/**
 * Files for an accountant or tax agent. Nothing is sent anywhere — the caller writes these to a
 * folder the user chooses. Documents are only included if the user asks.
 */
export function accountantPackage(ctx: Ctx, fy: string, opts: { include: string[] }): AccountantFile[] {
  const { start, end } = fyRange(fy);
  const range = { start, end };
  const files: AccountantFile[] = [];
  const inc = (k: string) => opts.include.includes(k);
  const est = taxEstimate(ctx, fy);
  if (inc('income')) {
    const income = report(ctx, 'income-by-source', range, fy);
    files.push({ path: 'income-summary.csv', content: toCsv(income.columns.map((c) => c.header), income.rows) });
    files.push({ path: 'payslips.csv', content: exportCsv(ctx, 'payslips', range) });
  }
  if (inc('business')) {
    const t = listTransactions(ctx, { status: 'posted', from: start, to: end, limit: 1_000_000, sort: 'date-asc' }).rows.filter((x) => x.businessUse === 'business' || x.businessUse === 'mixed' || ['contractor', 'sole-trader', 'business'].includes(x.incomeType ?? ''));
    files.push({ path: 'business-transactions.csv', content: toCsv(['Date', 'Account', 'Description', 'Amount', 'Category', 'Business use', 'Business %', 'GST class', 'Notes'], t.map((x) => [x.date, x.accountName, x.cleanDescription, x.amountCents / 100, x.categoryPath, x.businessUse, x.businessPercent, x.gstClass, x.notes])) });
  }
  if (inc('tax-categories')) {
    const t = listTransactions(ctx, { status: 'posted', from: start, to: end, limit: 1_000_000, sort: 'date-asc' }).rows.filter((x) => x.taxClass && x.taxClass !== 'none');
    files.push({ path: 'tax-classified-transactions.csv', content: toCsv(['Date', 'Description', 'Amount', 'Tax class', 'Category', 'Notes'], t.map((x) => [x.date, x.cleanDescription, x.amountCents / 100, x.taxClass, x.categoryPath, x.notes])) });
    files.push({ path: 'tax-entries.csv', content: toCsv(['Type', 'Description', 'Amount', 'Date'], listTaxEntries(ctx, fy).map((e) => [e.kind, e.description, e.amountCents / 100, e.date])) });
  }
  if (inc('gst')) {
    const g = report(ctx, 'gst-summary', range, fy);
    files.push({ path: 'gst-summary.csv', content: toCsv(g.columns.map((c) => c.header), g.rows) });
  }
  if (inc('dividends')) {
    const d = report(ctx, 'investment-income', range, fy);
    files.push({ path: 'dividends.csv', content: toCsv(d.columns.map((c) => c.header), d.rows) });
  }
  if (inc('interest')) {
    const i = report(ctx, 'interest-income', range, fy);
    files.push({ path: 'interest-income.csv', content: toCsv(i.columns.map((c) => c.header), i.rows) });
  }
  if (inc('transactions')) files.push({ path: 'all-transactions.csv', content: exportCsv(ctx, 'transactions', range) });
  if (inc('documents-index')) {
    const docs = listDocuments(ctx);
    files.push({ path: 'documents-index.csv', content: toCsv(['File', 'Kind', 'Size (bytes)', 'SHA-256', 'Linked to', 'Notes'], docs.map((d) => [d.fileName, d.kind, d.size, d.sha256, d.links.map((l) => l.label).join('; '), d.notes])) });
  }
  const t = report(ctx, 'tax-estimate', range, fy);
  files.push({ path: 'tax-estimate.csv', content: toCsv(t.columns.map((c) => c.header), t.rows) });
  files.push({
    path: 'README.txt',
    content: [
      `Records exported from Geranium for the ${fyDisplay(fy)} financial year (${formatDate(start)} to ${formatDate(end)}).`,
      `Prepared on ${formatDate(ctx.today(), { long: true })}.`,
      '',
      'These are the records entered or imported into Geranium by its user. They are not a tax return.',
      est.disclaimer,
      '',
      'Files:',
      ...files.map((f) => `  ${f.path}`),
      ...(inc('documents') ? ['  documents/ — copies of attached source documents'] : []),
      '',
      'Amounts are in Australian dollars. Money in is positive, money out is negative.',
    ].join('\r\n'),
  });
  return files;
}

export function reportRange(ctx: Ctx, fy?: string): { start: ISODate; end: ISODate } {
  return fyRange(fy ?? financialYearOf(ctx.today()));
}
