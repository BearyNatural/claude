import { beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testCtx } from '../helpers/ctx';
import { Ctx, listAccounts, updateSettings } from '@main/services/core';
import { seedDemo } from '@main/demo/demoData';
import { comparison, costOfLiving, dashboard, dataWarnings, netWorth, recurringList, spendingSummary, subscriptions, categoryDetail } from '@main/services/insights';
import { budgetReport, listBills, listBudgets, listSinkingFunds, markBillPaid } from '@main/services/budgeting';
import { buildAssumptions, cashflowCalendar, compareSnapshots, listGoals, listLoans, listScenarios, listSnapshots, listTermDeposits, modelLoan, runScenarios, saveSnapshot, debtOverview } from '@main/services/planning';
import { basPreparation, investmentsOverview, listPayslips, superOverview, taxEstimate, taxRulesInfo } from '@main/services/taxes';
import { accountantPackage, buildWorkbook, exportCsv, report, ReportKind } from '@main/services/output';
import { inbox, listImports } from '@main/services/imports';
import { listTransactions, ruleSuggestions } from '@main/services/transactions';
import { dueReminders, markRemindersSent } from '@main/services/reminders';
import { createBackup, openBackup, BackupPasswordError, BackupDamagedError } from '@main/services/backup';
import { DocumentStore, addDocument, readDocument } from '@main/services/documents';
import { workbookToXlsx } from '@domain/output/xlsx';
import { planWorkbook } from '@main/google/sheets';
import { randomKey } from '@main/crypto/crypto';

let ctx: Ctx;
const today = '2026-09-27';

beforeAll(async () => {
  ctx = await testCtx(today);
  seedDemo(ctx);
}, 60000);

describe('demo household data', () => {
  it('creates accounts with dated, imported balances', () => {
    const accounts = listAccounts(ctx);
    expect(accounts.length).toBeGreaterThanOrEqual(10);
    const everyday = accounts.find((a) => a.name === 'Everyday')!;
    expect(everyday.balance?.source).toBe('imported');
    expect(everyday.balance?.date).toBe('2026-09-19');
    expect(everyday.transactionCount).toBeGreaterThan(500);
    const home = accounts.find((a) => a.type === 'property')!;
    expect(home.balance?.source).toBe('estimated');
  });

  it('reconciles every statement', () => {
    const imports = listImports(ctx);
    expect(imports.length).toBeGreaterThan(50);
    expect(imports.every((i) => i.reconciliation?.status === 'reconciled')).toBe(true);
  });

  it('leaves a few items in the review inbox and a rule suggestion', () => {
    expect(inbox(ctx).count).toBe(2);
    expect(ruleSuggestions(ctx).some((s) => s.pattern === 'CORNER')).toBe(true);
  });

  it('warns about missing credit-card statements', () => {
    const w = dataWarnings(ctx).map((x) => x.message).join(' ');
    expect(w).toMatch(/No credit-card statements have been imported for Rewards credit card after/);
  });
});

describe('insights', () => {
  it('builds the dashboard', () => {
    const d = dashboard(ctx);
    expect(d.period.label).toMatch(/Week|2026/);
    expect(d.trend).toHaveLength(12);
    expect(d.upcoming.length).toBeGreaterThan(0);
    expect(d.freshnessNote).toMatch(/Figures include transactions imported up to \d\d Sep 2026/);
    // Imports end before this week starts, so the dashboard shows the latest week with data.
    expect(d.totals.transactionCount).toBeGreaterThan(0);
    expect(d.periodNote).toMatch(/latest period with imported transactions/);
    const m = dashboard(ctx, 'month');
    expect(m.totals.incomeCents).toBeGreaterThan(0);
    // September is only covered to the last import, so it is compared with the same days of August.
    expect(m.comparisonLabel).toMatch(/^the same point in Aug 2026 \(1 Aug–\d+ Aug\)$/);
  });

  it('analyses spending with provenance', () => {
    const s = spendingSummary(ctx, { start: '2025-07-01', end: '2026-06-30' });
    const food = s.rows.find((r) => r.categoryId === 'food')!;
    expect(food.perWeekCents).toBeGreaterThan(15000);
    expect(food.basis.description).toMatch(/categorised as Food between 1 July 2025 and 30 June 2026/);
    expect(s.partial).toBe(false);
    const g = categoryDetail(ctx, 'food.groceries', { start: '2025-07-01', end: '2026-06-30' });
    expect(g.months).toHaveLength(12);
  });

  it('works out true cost of living, comparisons, recurring payments and subscriptions', () => {
    const c = costOfLiving(ctx, { start: '2025-07-01', end: '2026-06-30' });
    const rego = c.items.find((i) => i.categoryId === 'transport.registration')!;
    expect(rego.annualCents).toBe(96000);
    expect(rego.regularity).toBe('irregular');
    expect(c.excludedOneOffCents).toBeGreaterThan(0);
    const cmp = comparison(ctx, 'fy-vs-previous');
    expect(cmp.rows.length).toBeGreaterThan(5);
    expect(cmp.inProgress).toMatch(/still in progress/);
    const rec = recurringList(ctx);
    expect(rec.confirmed.some((r) => /^Payroll/.test(r.name) && r.frequency === 'fortnightly')).toBe(true);
    expect(subscriptions(ctx).items.some((s) => /^Netflix/.test(s.name))).toBe(true);
    const spotify = rec.confirmed.find((r) => /^Spotify/.test(r.name))!;
    expect(spotify.name).toBe('Spotify');
    expect(spotify.missedSince).not.toBeNull(); // the demo's last Spotify payment is more than a month old
    expect(rec.confirmed.find((r) => /^Netflix/.test(r.name))!.missedSince).toBeNull();
  });

  it('adds up net worth with every value dated', () => {
    const n = netWorth(ctx);
    expect(n.totalAssetsCents).toBeGreaterThan(n.totalLiabilitiesCents);
    expect(n.history.length).toBeGreaterThan(12);
    expect(n.history.every((h) => h.accountsMissing === 0)).toBe(true);
    // No month-to-month jump bigger than 10% once every account has a value.
    for (let i = 1; i < n.history.length; i++) expect(Math.abs(n.history[i].netCents - n.history[i - 1].netCents)).toBeLessThan(Math.abs(n.history[i - 1].netCents) * 0.1);
    expect(n.notes.join(' ')).toMatch(/entered or estimated/);
  });
});

describe('budgeting and planning', () => {
  it('reports budget vs actual and bills', () => {
    const b = listBudgets(ctx)[0];
    const r = budgetReport(ctx, b.id, 'month', '2026-08-15');
    expect(r.rows.length).toBeGreaterThan(5);
    expect(r.rows.every((x) => /allocated|no amount allocated/.test(x.sentence))).toBe(true);
    const bills = listBills(ctx);
    expect(bills).toHaveLength(7);
    const paid = markBillPaid(ctx, bills[0].id);
    expect(paid.nextDue > bills[0].nextDue).toBe(true);
    expect(listSinkingFunds(ctx)[0].plan.perWeekCents).toBeGreaterThan(0);
  });

  it('projects goals, loans with offset, debts and term deposits', () => {
    const goals = listGoals(ctx);
    const ef = goals.find((g) => g.name === 'Emergency fund')!;
    expect(ef.currentSource).toMatch(/Bonus Saver/);
    const mortgage = listLoans(ctx).find((l) => l.kind === 'mortgage')!;
    const m = modelLoan(ctx, mortgage.id);
    expect(m.result.payoffDate).not.toBeNull();
    expect(m.offsetSource).toMatch(/Home loan offset/);
    expect(m.comparisons[0]?.label).toBe('Without the offset');
    expect(debtOverview(ctx).result.debts[0].months).toBeGreaterThan(0);
    const td = listTermDeposits(ctx);
    expect(td.ladder).toHaveLength(3);
  });

  it('builds forecast assumptions from real data and runs scenarios', () => {
    const b = buildAssumptions(ctx, 24);
    expect(b.assumptions.streams.some((s) => s.kind === 'employment')).toBe(true);
    expect(b.assumptions.streams.some((s) => s.id === 'living')).toBe(true);
    expect(b.assumptions.mortgage?.offsetIsCash).toBe(true);
    expect(b.provenance[0]).toMatch(/Starting cash = latest known balances/);
    const { scenarios } = listScenarios(ctx);
    const r = runScenarios(ctx, b.assumptions, scenarios.map((s) => s.id));
    expect(r.comparison).toHaveLength(4);
    expect(r.comparison.map((c) => c.sentence).join(' ')).not.toMatch(/better|best|should/i);
    const cal = cashflowCalendar(ctx, 90);
    expect(cal.sentence).toMatch(/^Based on currently scheduled items, projected cash balance falls to approximately/);
    const snapId = saveSnapshot(ctx, b.assumptions, scenarios[0].id, 'Second look');
    const first = listSnapshots(ctx).find((s) => s.id !== snapId)!;
    const c = compareSnapshots(ctx, first.id, snapId);
    expect(c.outcome).toHaveLength(3);
  });
});

describe('tax, investments and super', () => {
  it('estimates tax from payslips and records with sources', () => {
    const e = taxEstimate(ctx, '2025-26');
    expect(e.supported).toBe(true);
    expect(e.income.find((l) => l.key === 'employment')!.amountCents).toBe(26 * 486372);
    expect(e.paygWithheldCents).toBe(26 * (486372 - 375145));
    expect(e.income.find((l) => l.key === 'franking')?.amountCents).toBe(18660 + 16333);
    expect(e.income.find((l) => l.key === 'business')?.amountCents).toBeGreaterThan(0);
    expect(e.sources.length).toBeGreaterThan(2);
    expect(e.disclaimer).toMatch(/not an ATO assessment/);
    expect(listPayslips(ctx, '2025-26').every((p) => p.linkedTransactionId)).toBe(true);
    expect(taxRulesInfo('2026-27')?.components.find((c) => c.name.startsWith('Medicare'))?.status).toBe('provisional');
  });

  it('prepares a BAS view only when GST registered', () => {
    expect(basPreparation(ctx, '2025-26', 0).summary.registered).toBe(false);
    updateSettings(ctx, { gstRegistered: true });
    expect(basPreparation(ctx, '2025-26', 0).summary.disclaimer).toBe('Preparation summary only — verify before lodgment.');
    updateSettings(ctx, { gstRegistered: false });
  });

  it('shows holdings, dividends, CGT and super', () => {
    const inv = investmentsOverview(ctx, '2025-26');
    expect(inv.holdings.find((h) => h.security.code === 'BHP')?.quantity).toBe(120);
    expect(inv.capitalGains.netCapitalGainCents).toBeGreaterThan(0);
    expect(inv.dividendTotals.frankingCreditsCents).toBe(18660 + 16333);
    const sup = superOverview(ctx, '2025-26');
    expect(sup.history).toHaveLength(5);
  });
});

describe('output', () => {
  it('builds a workbook with the relevant sheets that Excel-compatible readers can open', () => {
    const wb = buildWorkbook(ctx, { range: { start: '2025-07-01', end: '2026-06-30' }, fy: '2025-26' });
    const names = wb.sheets.map((s) => s.name);
    for (const n of ['Dashboard', 'Accounts', 'Transactions', 'Income', 'Expenses', 'Budget vs Actual', 'Bills', 'Savings Goals', 'Mortgage', 'Debt', 'Term Deposits', 'Investments', 'Super', 'Tax Estimate', 'Forecast', 'Scenarios']) {
      expect(names).toContain(n);
    }
    const bytes = workbookToXlsx(wb);
    const read = XLSX.read(bytes, { type: 'array', sheetStubs: true });
    expect(read.SheetNames[0]).toBe('About');
    const plan = planWorkbook(wb);
    expect(plan.titles[0]).toBe('About');
    expect(plan.values.find((v) => v.range.startsWith("'Budget vs Actual'"))!.values[1][3]).toBe('=B2-C2');
  });

  it('exports CSVs and every report', () => {
    const csv = exportCsv(ctx, 'transactions', { start: '2026-08-01', end: '2026-08-31' });
    expect(csv.split('\r\n').length).toBeGreaterThan(20);
    const kinds: ReportKind[] = ['cash-flow', 'cost-of-living', 'spending-categories', 'recurring', 'subscriptions', 'income-by-source', 'savings-rate', 'business-summary', 'gst-summary', 'tax-estimate', 'mortgage-progress', 'debt', 'investment-income', 'interest-income', 'term-deposits', 'net-worth', 'annual-expenditure'];
    for (const k of kinds) {
      const r = report(ctx, k, { start: '2025-07-01', end: '2026-06-30' }, '2025-26');
      expect(r.title.length).toBeGreaterThan(3);
    }
    const rolling = report(ctx, 'cash-flow', { start: '2025-09-28', end: '2026-09-27' });
    expect(rolling.rows[0][0]).toBe('Sep 2025 (28 Sep–30 Sep, part month)');
    expect(rolling.rows[1][0]).toBe('Oct 2025');
    const pkg = accountantPackage(ctx, '2025-26', { include: ['income', 'business', 'tax-categories', 'gst', 'dividends', 'interest', 'transactions', 'documents-index'] });
    expect(pkg.map((f) => f.path)).toContain('README.txt');
    expect(pkg.find((f) => f.path === 'README.txt')!.content).toMatch(/not a tax return/);
  });

  it('works out reminders without amounts unless allowed', () => {
    updateSettings(ctx, { notifications: { ...dashboardSettings(), enabled: true } });
    const r = dueReminders(ctx, { date: today, time: '09:30' });
    expect(r.some((x) => x.type === 'backup')).toBe(true);
    expect(r.every((x) => !/\$/.test(x.body))).toBe(true);
    expect(dueReminders(ctx, { date: today, time: '08:00' })).toEqual([]);
    markRemindersSent(ctx, r.map((x) => x.key));
    expect(dueReminders(ctx, { date: today, time: '09:30' })).toEqual([]);
  });
});

function dashboardSettings() {
  return {
    enabled: false, preferredTime: '09:00', allowRepeat: false, showAmounts: false,
    types: { bills: { enabled: true, daysBefore: 3 }, termDeposits: { enabled: true, daysBefore: 14 }, taxReview: { enabled: true, daysBefore: 0 }, insurance: { enabled: true, daysBefore: 14 }, goals: { enabled: false, daysBefore: 0 }, backup: { enabled: true, daysBefore: 30 }, mortgage: { enabled: false, daysBefore: 2 }, annualExpense: { enabled: true, daysBefore: 21 } },
  };
}

describe('encrypted backup', () => {
  it('backs up and restores the database and documents, and rejects wrong passwords or damage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-backup-'));
    try {
      const store = new DocumentStore(join(dir, 'docs'), randomKey());
      const docId = addDocument(ctx, store, { fileName: 'receipt.pdf', bytes: new TextEncoder().encode('%PDF-1.4 fake receipt'), kind: 'receipt' });
      expect(readDocument(ctx, store, docId).fileName).toBe('receipt.pdf');
      const { bytes, manifest } = await createBackup(ctx.db, store, 'a long backup password', '0.1.0', 2 ** 10);
      expect(manifest.counts.transactions).toBeGreaterThan(500);
      expect(bytes.includes(Buffer.from('NORTHSIDE'))).toBe(false);
      const restored = await openBackup(bytes, 'a long backup password');
      expect(restored.manifest.documents).toHaveLength(1);
      expect(Buffer.from(restored.documents.get(docId)!).toString()).toBe('%PDF-1.4 fake receipt');
      await expect(openBackup(bytes, 'wrong password!')).rejects.toBeInstanceOf(BackupPasswordError);
      const damaged = Buffer.from(bytes);
      damaged[damaged.length - 100] ^= 0xff;
      await expect(openBackup(damaged, 'a long backup password')).rejects.toBeInstanceOf(BackupDamagedError);
      await expect(openBackup(Buffer.from('not a backup'), 'x')).rejects.toBeInstanceOf(BackupDamagedError);
      await expect(createBackup(ctx.db, store, 'short', '0.1.0', 2 ** 10)).rejects.toThrow(/at least 8/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('transactions list', () => {
  it('searches in plain English', () => {
    const r = listTransactions(ctx, { status: 'posted', search: 'electricity last three years' });
    expect(r.total).toBeGreaterThan(5);
    expect(r.chips).toContain('Category: Electricity');
    const big = listTransactions(ctx, { status: 'posted', search: 'over $2000' });
    expect(big.rows.every((t) => Math.abs(t.amountCents) > 200000)).toBe(true);
    const tagged = listTransactions(ctx, { status: 'posted', search: 'tagged "property"' });
    expect(tagged.total).toBe(1);
  });
});
