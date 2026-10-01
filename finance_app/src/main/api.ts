import { z } from 'zod';
import { AppState } from './app/state';
import * as core from './services/core';
import * as tx from './services/transactions';
import * as imp from './services/imports';
import * as ins from './services/insights';
import * as bud from './services/budgeting';
import * as plan from './services/planning';
import * as tax from './services/taxes';
import * as docs from './services/documents';
import * as out from './services/output';
import { networkLog } from './net';
import { GoogleTokens, revoke, signIn, validAccessToken } from './google/oauth';
import { writeWorkbookToGoogle } from './google/sheets';
import { workbookToXlsx } from '../domain/output/xlsx';
import { compoundGrowth } from '../domain/planning/compound';
import { simulateLoan, simulateDebts } from '../domain/planning/loans';
import { projectGoal } from '../domain/planning/goals';
import { runForecast, Scenario } from '../domain/planning/forecast';
import { FREQUENCIES, PERIOD_KIND_LABEL, PeriodKind } from '../domain/periods';
import { ACCOUNT_TYPE_LABEL, AccountType } from '../domain/accounts';
import { INCOME_TYPE_LABEL, IncomeType } from '../domain/categorise/categories';
import { financialYearOf, fyRange } from '../domain/dates';
import { DOCUMENT_KIND_LABEL } from './services/documents';
import { reportToSheet } from './services/output';
import { toCsv } from '../domain/output/csv';

/** Things only the Electron shell can do (dialogs, opening files). Injected so the API is testable. */
export interface Platform {
  openFile(opts: { title: string; filters: { name: string; extensions: string[] }[] }): Promise<{ name: string; bytes: Uint8Array } | null>;
  saveFile(opts: { title: string; defaultName: string; filters: { name: string; extensions: string[] }[] }, content: Uint8Array | string): Promise<string | null>;
  chooseFolder(title: string): Promise<string | null>;
  writeFiles(folder: string, files: { path: string; content: Uint8Array | string }[]): Promise<void>;
  openPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openDocument(fileName: string, bytes: Uint8Array): Promise<void>;
}

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date');
const fy = z.string().regex(/^\d{4}-\d{2}$/, 'Expected a financial year');
const cents = z.number().int().refine(Number.isSafeInteger);
const id = z.string().min(1).max(100);
const range = z.object({ start: iso, end: iso });
const freq = z.enum(FREQUENCIES as [string, ...string[]]);
const accountType = z.enum(Object.keys(ACCOUNT_TYPE_LABEL) as [AccountType, ...AccountType[]]);
const incomeType = z.enum(Object.keys(INCOME_TYPE_LABEL) as [IncomeType, ...IncomeType[]]);
const periodKind = z.enum(Object.keys(PERIOD_KIND_LABEL) as [PeriodKind, ...PeriodKind[]]);
const valueSource = z.enum(['imported', 'manual', 'calculated', 'estimated', 'forecast']);
const nullableStr = z.string().max(2000).nullable().optional();

const streamSchema = z.object({
  id: z.string(), name: z.string().max(200), direction: z.enum(['in', 'out']),
  kind: z.enum(['employment', 'business', 'investment-income', 'government', 'super-income', 'other-income', 'bill', 'living', 'loan-repayment', 'investment-contribution', 'other-expense']),
  amountCents: cents.nonnegative(), frequency: freq, startDate: iso, endDate: iso.nullable().optional(), growthPercent: z.number().nullable().optional(), source: z.string().optional(),
});
const changeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stop-income'), date: iso, streamIds: z.array(z.string()).optional(), kinds: z.array(z.string()).optional() }),
  z.object({ type: z.literal('change-income'), date: iso, streamIds: z.array(z.string()).optional(), kinds: z.array(z.string()).optional(), percentChange: z.number().optional(), newAmountCents: cents.optional() }),
  z.object({ type: z.literal('change-expenses'), date: iso, percentChange: z.number(), streamIds: z.array(z.string()).optional(), kinds: z.array(z.string()).optional() }),
  z.object({ type: z.literal('one-off'), date: iso, amountCents: cents, label: z.string().max(200) }),
  z.object({ type: z.literal('add-stream'), stream: streamSchema }),
  z.object({ type: z.literal('mortgage-rate'), date: iso, annualRatePercent: z.number().min(0).max(40) }),
  z.object({ type: z.literal('mortgage-repayment'), date: iso, repaymentCents: cents.nonnegative() }),
  z.object({ type: z.literal('savings-rate'), date: iso, annualRatePercent: z.number().min(0).max(40) }),
]);
const scenarioSchema = z.object({
  id: z.string(), name: z.string().max(200), description: z.string().max(2000).nullable().optional(), changes: z.array(changeSchema),
  overrides: z.object({ inflationPercent: z.number(), wageGrowthPercent: z.number(), savingsInterestPercent: z.number(), investmentReturnPercent: z.number(), months: z.number().int().min(1).max(600) }).partial().optional(),
});
const assumptionsSchema = z.object({
  startDate: iso, months: z.number().int().min(1).max(600), startingCashCents: cents, startingCashAsOf: iso.nullable(), startingCashNote: z.string(),
  inflationPercent: z.number().min(-20).max(50), wageGrowthPercent: z.number().min(-50).max(50), savingsInterestPercent: z.number().min(0).max(40),
  investmentReturnPercent: z.number().min(-50).max(50), startingInvestmentsCents: cents, streams: z.array(streamSchema),
  oneOffs: z.array(z.object({ id: z.string(), date: iso, amountCents: cents, label: z.string().max(200) })),
  termDeposits: z.array(z.object({ id: z.string(), label: z.string(), maturityDate: iso, principalCents: cents, maturityValueCents: cents })),
  mortgage: z.object({ balanceCents: cents, annualRatePercent: z.number(), repaymentCents: cents, frequency: z.enum(['weekly', 'fortnightly', 'monthly']), firstRepaymentDate: iso, offsetIsCash: z.boolean() }).nullable().optional(),
  lowBalanceThresholdCents: cents,
});
const txPatch = z.object({
  categoryId: z.string().nullable().optional(), payee: nullableStr, cleanDescription: z.string().max(500).optional(), notes: nullableStr,
  incomeType: incomeType.nullable().optional(), taxClass: z.enum(['none', 'deductible', 'business-income', 'private']).nullable().optional(),
  businessUse: z.enum(['personal', 'business', 'mixed']).nullable().optional(), businessPercent: z.number().min(0).max(100).nullable().optional(),
  gstClass: z.enum(['taxable', 'gst-free', 'input-taxed', 'not-reportable']).nullable().optional(), gstCents: cents.nullable().optional(),
  isOneOff: z.boolean().optional(), tags: z.array(z.string().max(50)).max(30).optional(), date: iso.optional(), amountCents: cents.optional(),
});
const ruleSchema = z.object({
  id: z.string().optional(), name: nullableStr, field: z.enum(['description', 'payee']), matchType: z.enum(['contains', 'word', 'starts-with', 'equals', 'wildcard', 'regex']),
  pattern: z.string().min(1).max(200), direction: z.enum(['in', 'out', 'any']).optional(), amountMinCents: cents.nullable().optional(), amountMaxCents: cents.nullable().optional(),
  accountId: z.string().nullable().optional(), categoryId: z.string().nullable().optional(), incomeType: incomeType.nullable().optional(), payee: nullableStr,
  taxClass: nullableStr, businessUse: z.enum(['personal', 'business', 'mixed']).nullable().optional(), businessPercent: z.number().min(0).max(100).nullable().optional(),
  tags: z.array(z.string()).optional(), priority: z.number().int().default(0), enabled: z.boolean().default(true),
});
const none = z.object({}).strict().optional();

function m<S extends z.ZodTypeAny, R>(schema: S, handler: (input: z.output<S>) => R | Promise<R>) {
  return { schema, handler };
}

type Deps = { state: AppState; platform: Platform; today?: () => string };

export function buildRegistry({ state, platform }: Deps) {
  const ctx = () => state.requireCtx();
  const store = () => state.requireDocs();
  const googleClient = () => {
    const c = ctx();
    const clientId = core.getSettings(c).googleClientId ?? process.env.GERANIUM_GOOGLE_CLIENT_ID ?? null;
    const secret = core.getSecretValue<string>(c, 'google.clientSecret') ?? process.env.GERANIUM_GOOGLE_CLIENT_SECRET ?? null;
    return { clientId: clientId ?? '', clientSecret: secret };
  };

  return {
    /* ---------- app & security ---------- */
    'app.status': m(none, () => state.status()),
    'app.initialise': m(z.object({ password: z.object({ secret: z.string().max(200), kind: z.enum(['password', 'pin']) }).nullable().optional() }), async (i) => { await state.initialise(i.password ?? undefined); return state.status(); }),
    'app.unlock': m(z.object({ secret: z.string().max(200).optional() }), async (i) => { await state.unlock(i.secret); return state.status(); }),
    'app.lock': m(none, () => { state.lock(); return state.status(); }),
    'app.enterDemo': m(none, async () => { await state.enterDemo(); return state.status(); }),
    'app.exitDemo': m(none, () => { state.exitDemo(); return state.status(); }),
    'app.networkLog': m(none, () => networkLog()),
    'app.openDataFolder': m(none, () => platform.openPath(state.dataDir)),
    'security.setPassword': m(z.object({ secret: z.string().max(200), kind: z.enum(['password', 'pin']) }), async (i) => { await state.setPassword(i.secret, i.kind); return state.status(); }),
    'security.removePassword': m(z.object({ secret: z.string().max(200) }), async (i) => { await state.removePassword(i.secret); return state.status(); }),
    'security.createRecoveryKey': m(none, async () => {
      const key = await state.createRecoveryKey();
      return { key, createdAt: state.status().recoveryCreatedAt };
    }),
    'security.removeRecoveryKey': m(none, () => { state.removeRecoveryKey(); return state.status(); }),
    'security.saveRecoveryKey': m(z.object({ text: z.string().max(4000) }), (i) =>
      platform.saveFile({ title: 'Save your recovery key', defaultName: 'Geranium recovery key.txt', filters: [{ name: 'Text file', extensions: ['txt'] }] }, i.text)),
    'app.recover': m(z.object({ key: z.string().max(100), secret: z.string().max(200), kind: z.enum(['password', 'pin']) }), async (i) => { await state.recover(i.key, i.secret, i.kind); return state.status(); }),

    /* ---------- settings ---------- */
    'settings.get': m(none, () => core.getSettings(ctx())),
    'settings.update': m(z.record(z.string(), z.unknown()), (patch) => core.updateSettings(ctx(), patch as never)),

    /* ---------- accounts & categories ---------- */
    'accounts.list': m(none, () => core.listAccounts(ctx())),
    'accounts.save': m(z.object({
      id: z.string().optional(), name: z.string().min(1).max(100), type: accountType, institution: nullableStr, number: nullableStr, bsb: nullableStr,
      status: z.enum(['active', 'closed', 'archived']).optional(), interestRate: z.number().min(0).max(60).nullable().optional(), creditLimitCents: cents.nullable().optional(),
      linkedAccountId: z.string().nullable().optional(), notes: nullableStr,
      openingBalance: z.object({ date: iso, balanceCents: cents, source: valueSource }).nullable().optional(),
    }), (a) => core.saveAccount(ctx(), a as core.AccountInput)),
    'accounts.delete': m(z.object({ id }), (i) => core.deleteAccount(ctx(), i.id)),
    'accounts.balances': m(z.object({ accountId: id }), (i) => ctx().db.all('SELECT * FROM balance_snapshots WHERE account_id = ? ORDER BY date DESC', [i.accountId]).map((r) => ({ id: String(r.id), date: String(r.date), balanceCents: Number(r.balance_cents), source: String(r.source), note: r.note ? String(r.note) : null }))),
    'accounts.addBalance': m(z.object({ accountId: id, date: iso, balanceCents: cents, source: valueSource, note: nullableStr }), (i) => core.addBalance(ctx(), i.accountId, i.date, i.balanceCents, i.source, i.note ?? null)),
    'accounts.deleteBalance': m(z.object({ id }), (i) => core.deleteBalance(ctx(), i.id)),
    'categories.list': m(z.object({ includeArchived: z.boolean().optional() }).optional(), (i) => core.listCategories(ctx(), i?.includeArchived)),
    'categories.save': m(z.object({ id: z.string().optional(), name: z.string().min(1).max(80), parentId: z.string().nullable(), kind: z.enum(['expense', 'income', 'transfer', 'savings', 'investment']), nature: z.enum(['fixed', 'variable', 'discretionary']).nullable() }), (c) => core.saveCategory(ctx(), c)),
    'categories.remove': m(z.object({ id }), (i) => core.removeCategory(ctx(), i.id)),
    'categories.restore': m(z.object({ id }), (i) => core.restoreCategory(ctx(), i.id)),

    /* ---------- transactions ---------- */
    'transactions.list': m(z.object({
      status: z.enum(['posted', 'staged']).optional(), accountId: z.string().nullable().optional(), categoryId: z.string().nullable().optional(), from: iso.nullable().optional(), to: iso.nullable().optional(),
      search: z.string().max(300).nullable().optional(), limit: z.number().int().min(1).max(5000).optional(), offset: z.number().int().min(0).optional(),
      sort: z.enum(['date-desc', 'date-asc', 'amount-asc', 'amount-desc']).optional(),
    }), (q) => tx.listTransactions(ctx(), q)),
    'transactions.get': m(z.object({ id }), (i) => ({ transaction: tx.getTransaction(ctx(), i.id), history: tx.transactionHistory(ctx(), i.id), documents: docs.listDocuments(ctx(), 'transaction', i.id) })),
    'transactions.update': m(z.object({ id, patch: txPatch }), (i) => tx.updateTransaction(ctx(), i.id, i.patch)),
    'transactions.bulkUpdate': m(z.object({ ids: z.array(id).min(1).max(5000), patch: txPatch }), (i) => tx.bulkUpdate(ctx(), i.ids, i.patch)),
    'transactions.setSplits': m(z.object({ id, parts: z.array(z.object({ categoryId: z.string().nullable(), amountCents: cents, note: nullableStr })).max(20) }), (i) => tx.setSplits(ctx(), i.id, i.parts)),
    'transactions.addManual': m(z.object({ accountId: id, date: iso, amountCents: cents, description: z.string().min(1).max(300), categoryId: z.string().nullable().optional(), notes: nullableStr }), (i) => tx.addManualTransaction(ctx(), i)),
    'transactions.delete': m(z.object({ id }), (i) => tx.deleteTransaction(ctx(), i.id)),
    'transactions.tags': m(none, () => tx.listTags(ctx())),

    'rules.list': m(none, () => tx.listRules(ctx())),
    'rules.save': m(ruleSchema, (r) => tx.createRule(ctx(), { ...r, source: 'user' } as never)),
    'rules.setEnabled': m(z.object({ id, enabled: z.boolean() }), (i) => tx.setRuleEnabled(ctx(), i.id, i.enabled)),
    'rules.delete': m(z.object({ id }), (i) => tx.deleteRule(ctx(), i.id)),
    'rules.apply': m(z.object({ onlyUncategorised: z.boolean().optional(), ruleId: z.string().optional() }), (i) => tx.applyRules(ctx(), i)),
    'rules.suggestions': m(none, () => tx.ruleSuggestions(ctx())),
    'rules.acceptSuggestion': m(z.object({ pattern: z.string().min(1).max(200), categoryId: id, applyToExisting: z.boolean() }), (i) => tx.acceptRuleSuggestion(ctx(), i.pattern, i.categoryId, i.applyToExisting)),
    'rules.dismissSuggestion': m(z.object({ key: z.string(), categoryId: id }), (i) => tx.dismissRuleSuggestion(ctx(), i.key, i.categoryId)),

    'transfers.suggestions': m(none, () => tx.transferSuggestions(ctx())),
    'transfers.link': m(z.object({ outId: id, inId: id.nullable(), note: nullableStr }), (i) => tx.linkTransfer(ctx(), i.outId, i.inId, i.note ?? null)),
    'transfers.unlink': m(z.object({ transferId: id }), (i) => tx.unlinkTransfer(ctx(), i.transferId)),
    'transfers.dismiss': m(z.object({ outId: id, inId: id }), (i) => tx.dismissTransferSuggestion(ctx(), i.outId, i.inId)),

    /* ---------- import ---------- */
    'imports.chooseFile': m(none, async () => {
      const f = await platform.openFile({ title: 'Choose a statement or export to import', filters: [{ name: 'Statements and exports', extensions: ['csv', 'txt', 'ofx', 'qfx', 'qif', 'xlsx', 'xls', 'pdf'] }] });
      if (!f) return null;
      return imp.openImport(ctx(), f.name, f.bytes);
    }),
    'imports.chooseSheet': m(z.object({ sessionId: id, sheet: z.string() }), (i) => imp.chooseSheet(ctx(), i.sessionId, i.sheet)),
    'imports.mappingKinds': m(z.object({ sessionId: id }), (i) => imp.currentMappingKinds(i.sessionId)),
    'imports.applyMapping': m(z.object({
      sessionId: id, kinds: z.array(z.enum(['date', 'processing-date', 'description', 'amount', 'debit', 'credit', 'indicator', 'balance', 'reference', 'account', 'payee', 'category', 'ignore'])),
      headerRow: z.number().int().min(0).nullable(), firstDataRow: z.number().int().min(0), dateFormat: z.enum(['YMD', 'DMY', 'MDY', 'D-MON-Y', 'MON-D-Y', 'YYYYMMDD']), positiveIsCredit: z.boolean(),
    }), (i) => imp.applyImportMapping(ctx(), i.sessionId, i)),
    'imports.preview': m(z.object({ sessionId: id, statementIndex: z.number().int().min(0), accountId: id, openingCents: cents.nullable().optional(), closingCents: cents.nullable().optional() }),
      (i) => imp.previewImport(ctx(), i.sessionId, i.statementIndex, i.accountId, { openingCents: i.openingCents ?? null, closingCents: i.closingCents ?? null })),
    'imports.commit': m(z.object({
      sessionId: id, statementIndex: z.number().int().min(0), accountId: id, keepSourceFile: z.boolean(), saveProfileName: z.string().max(100).nullable().optional(),
      openingCents: cents.nullable().optional(), closingCents: cents.nullable().optional(),
      rows: z.array(z.object({ index: z.number().int(), include: z.boolean(), categoryId: z.string().nullable().optional(), amountCents: cents.optional(), date: iso.optional(), description: z.string().max(500).optional(), forceStage: z.boolean().optional() })),
    }), (i) => {
      let docId: string | null = null;
      if (i.keepSourceFile && !state.demo) docId = imp.keepSourceFile(ctx(), store(), i.sessionId);
      return imp.commitImport(ctx(), { ...i, sourceDocumentId: docId });
    }),
    'imports.discard': m(z.object({ sessionId: id }), (i) => imp.discardImport(i.sessionId)),
    'imports.list': m(none, () => imp.listImports(ctx())),
    'imports.reconcile': m(z.object({ importId: id, openingCents: cents.nullable(), closingCents: cents.nullable() }), (i) => imp.reReconcile(ctx(), i.importId, i.openingCents, i.closingCents)),
    'imports.undo': m(z.object({ importId: id }), (i) => imp.undoImport(ctx(), i.importId)),
    'imports.profiles': m(none, () => imp.listProfiles(ctx())),
    'imports.deleteProfile': m(z.object({ id }), (i) => imp.deleteProfile(ctx(), i.id)),
    'inbox.list': m(none, () => imp.inbox(ctx())),
    'inbox.approve': m(z.object({ ids: z.array(id).max(5000), categoryId: z.string().nullable().optional() }), (i) => imp.approveStaged(ctx(), i.ids, i.categoryId)),
    'inbox.approveObvious': m(none, () => imp.approveObvious(ctx())),
    'inbox.reject': m(z.object({ ids: z.array(id).max(5000) }), (i) => imp.rejectStaged(ctx(), i.ids)),

    /* ---------- insights ---------- */
    'insights.dashboard': m(z.object({ kind: periodKind.optional() }).optional(), (i) => ins.dashboard(ctx(), i?.kind)),
    'insights.spending': m(z.object({ range, level: z.enum(['top', 'leaf']).optional() }), (i) => ins.spendingSummary(ctx(), i.range, i.level)),
    'insights.category': m(z.object({ categoryId: id, range }), (i) => ins.categoryDetail(ctx(), i.categoryId, i.range)),
    'insights.costOfLiving': m(z.object({ range }), (i) => ins.costOfLiving(ctx(), i.range)),
    'insights.comparison': m(z.object({ kind: z.enum(['month-vs-previous', 'month-vs-last-year', 'quarter-vs-previous', 'fy-vs-previous', 'rolling-12-vs-previous']), anchor: iso.optional() }), (i) => ins.comparison(ctx(), i.kind, i.anchor)),
    'insights.warnings': m(none, () => ins.dataWarnings(ctx())),
    'insights.netWorth': m(none, () => ins.netWorth(ctx())),
    'insights.upcoming': m(z.object({ days: z.number().int().min(1).max(400) }), (i) => ins.upcoming(ctx(), i.days)),
    'recurring.list': m(none, () => ins.recurringList(ctx())),
    'recurring.confirm': m(z.object({ key: z.string(), name: z.string().max(200), direction: z.enum(['in', 'out']), frequency: freq, amountCents: cents, amountVaries: z.boolean(), nextExpected: iso.nullable(), lastSeen: iso.nullable(), categoryId: z.string().nullable(), accountId: z.string().nullable(), isSubscription: z.boolean() }), (i) => ins.confirmRecurring(ctx(), i as never)),
    'recurring.dismiss': m(z.object({ key: z.string(), name: z.string() }), (i) => ins.dismissRecurring(ctx(), i.key, i.name)),
    'recurring.remove': m(z.object({ id }), (i) => ins.removeRecurring(ctx(), i.id)),
    'recurring.subscriptions': m(none, () => ins.subscriptions(ctx())),

    /* ---------- budgeting ---------- */
    'budgets.list': m(none, () => bud.listBudgets(ctx())),
    'budgets.propose': m(z.object({ frequency: freq, basis: range, level: z.enum(['top', 'leaf']) }), (i) => bud.proposeLines(ctx(), i.frequency as never, i.basis, i.level)),
    'budgets.save': m(z.object({ id: z.string().optional(), name: z.string().min(1).max(100), method: z.enum(['historical', 'manual', 'hybrid']), frequency: freq, basisStart: iso.nullable().optional(), basisEnd: iso.nullable().optional(), lines: z.array(z.object({ categoryId: id, amountCents: cents.nonnegative(), basisCents: cents.nullable().optional(), note: nullableStr })), makeActive: z.boolean().optional() }), (b) => bud.saveBudget(ctx(), b as never)),
    'budgets.delete': m(z.object({ id }), (i) => bud.deleteBudget(ctx(), i.id)),
    'budgets.report': m(z.object({ budgetId: id, kind: periodKind.optional(), anchor: iso.optional() }), (i) => bud.budgetReport(ctx(), i.budgetId, i.kind, i.anchor)),
    'bills.list': m(none, () => bud.listBills(ctx())),
    'bills.save': m(z.object({ id: z.string().optional(), name: z.string().min(1).max(100), amountCents: cents.positive(), frequency: freq, nextDue: iso, categoryId: z.string().nullable(), accountId: z.string().nullable(), autoPay: z.boolean(), reminderDays: z.number().int().min(0).max(90), reminderEnabled: z.boolean(), active: z.boolean(), matchText: nullableStr.transform((v) => v ?? null), notes: nullableStr.transform((v) => v ?? null) }), (b) => bud.saveBill(ctx(), b as never)),
    'bills.delete': m(z.object({ id }), (i) => bud.deleteBill(ctx(), i.id)),
    'bills.markPaid': m(z.object({ id, transactionId: z.string().nullable().optional() }), (i) => bud.markBillPaid(ctx(), i.id, i.transactionId)),
    'sinking.list': m(none, () => bud.listSinkingFunds(ctx())),
    'sinking.save': m(z.object({ id: z.string(), name: z.string().min(1).max(100), targetCents: cents.positive(), savedCents: cents.nonnegative(), dueDate: iso, categoryId: z.string().nullable().optional(), repeat: freq.nullable().optional(), notes: nullableStr }), (f) => bud.saveSinkingFund(ctx(), f as never)),
    'sinking.delete': m(z.object({ id }), (i) => bud.deleteSinkingFund(ctx(), i.id)),
    'sinking.complete': m(z.object({ id }), (i) => bud.completeSinkingFund(ctx(), i.id)),

    /* ---------- planning ---------- */
    'goals.list': m(none, () => plan.listGoals(ctx())),
    'goals.save': m(z.object({ id: z.string(), name: z.string().min(1).max(100), type: z.enum(['emergency-fund', 'property', 'land', 'holiday', 'vehicle', 'renovation', 'retirement', 'custom']), targetCents: cents.positive(), currentCents: cents.nonnegative(), targetDate: iso.nullable().optional(), contributionCents: cents.nonnegative(), contributionFrequency: freq, annualRatePercent: z.number().min(-50).max(50), oneOffs: z.array(z.object({ date: iso, amountCents: cents })).optional(), linkedAccountId: z.string().nullable().optional() }), (g) => plan.saveGoal(ctx(), g as never)),
    'goals.delete': m(z.object({ id }), (i) => plan.deleteGoal(ctx(), i.id)),
    'loans.list': m(none, () => plan.listLoans(ctx())),
    'loans.save': m(z.object({ id: z.string().optional(), accountId: z.string().nullable(), name: z.string().min(1).max(100), kind: z.enum(['mortgage', 'personal-loan', 'car-loan', 'credit-card', 'other-debt']), balanceCents: cents.positive(), ratePercent: z.number().min(0).max(60), repaymentCents: cents.positive().nullable(), frequency: z.enum(['weekly', 'fortnightly', 'monthly']), remainingTermMonths: z.number().int().min(1).max(600).nullable(), offsetAccountId: z.string().nullable(), extraRepaymentCents: cents.nonnegative(), asOf: iso, rateChanges: z.array(z.object({ date: iso, annualRatePercent: z.number().min(0).max(60) })), notes: nullableStr.transform((v) => v ?? null) }), (l) => plan.saveLoan(ctx(), l as never)),
    'loans.delete': m(z.object({ id }), (i) => plan.deleteLoan(ctx(), i.id)),
    'loans.model': m(z.object({ id, extraRepaymentCents: cents.nonnegative().optional(), offsetCents: cents.nonnegative().nullable().optional(), offsetMonthlyChangeCents: cents.optional(), lumpSums: z.array(z.object({ date: iso, amountCents: cents.positive() })).optional(), rateChanges: z.array(z.object({ date: iso, annualRatePercent: z.number().min(0).max(60) })).optional() }), (i) => plan.modelLoan(ctx(), i.id, i)),
    'loans.debts': m(z.object({ order: z.enum(['as-listed', 'highest-rate-first', 'smallest-balance-first']), extraMonthlyCents: cents.nonnegative() }), (i) => plan.debtOverview(ctx(), i.order, i.extraMonthlyCents)),
    'termDeposits.list': m(none, () => plan.listTermDeposits(ctx())),
    'termDeposits.save': m(z.object({ id: z.string(), institution: z.string().min(1).max(100), name: nullableStr, principalCents: cents.positive(), startDate: iso, maturityDate: iso, annualRatePercent: z.number().min(0).max(30), interestFrequency: z.enum(['at-maturity', 'monthly', 'quarterly', 'annually']), interestHandling: z.enum(['compound', 'paid-out']), interestDestination: nullableStr, notes: nullableStr, status: z.enum(['active', 'matured', 'closed']).optional(), reminderDays: z.number().int().min(0).max(90).optional(), accountId: z.string().nullable().optional() }), (t) => plan.saveTermDeposit(ctx(), t as never)),
    'termDeposits.delete': m(z.object({ id }), (i) => plan.deleteTermDeposit(ctx(), i.id)),

    'calculators.compound': m(z.object({ openingCents: cents.nonnegative(), contributionCents: cents, contributionFrequency: freq, annualRatePercent: z.number().min(-50).max(50), compounding: freq, years: z.number().min(0).max(100), timing: z.enum(['start', 'end']).optional(), contributionIncreasePercent: z.number().min(-20).max(50).optional() }), (i) => compoundGrowth(i as never)),
    'calculators.loan': m(z.object({ principalCents: cents.positive(), annualRatePercent: z.number().min(0).max(60), startDate: iso, repaymentFrequency: z.enum(['weekly', 'fortnightly', 'monthly']), repaymentCents: cents.positive().nullable().optional(), remainingTermMonths: z.number().int().min(1).max(600).nullable().optional(), extraRepaymentCents: cents.nonnegative().optional(), offset: z.object({ balanceCents: cents.nonnegative(), monthlyChangeCents: cents.optional() }).nullable().optional(), lumpSums: z.array(z.object({ date: iso, amountCents: cents.positive() })).optional(), rateChanges: z.array(z.object({ date: iso, annualRatePercent: z.number().min(0).max(60) })).optional() }), (i) => simulateLoan(i as never)),
    'calculators.debts': m(z.object({ debts: z.array(z.object({ id: z.string(), name: z.string(), balanceCents: cents.positive(), annualRatePercent: z.number().min(0).max(80), monthlyPaymentCents: cents.positive() })).max(20), order: z.enum(['as-listed', 'highest-rate-first', 'smallest-balance-first']), extraMonthlyCents: cents.nonnegative(), startDate: iso }), (i) => simulateDebts(i.debts, i.startDate, i.order, i.extraMonthlyCents)),
    'calculators.goal': m(z.object({ goal: z.object({ id: z.string(), name: z.string(), type: z.string(), targetCents: cents.positive(), currentCents: cents.nonnegative(), targetDate: iso.nullable().optional(), contributionCents: cents.nonnegative(), contributionFrequency: freq, annualRatePercent: z.number() }), today: iso }), (i) => projectGoal(i.goal as never, i.today)),
    'calculators.super': m(z.object({ startingBalanceCents: cents.nonnegative(), annualConcessionalCents: cents.nonnegative(), contributionsTaxPercent: z.number().min(0).max(50), annualNonConcessionalCents: cents.nonnegative(), returnPercent: z.number().min(-20).max(30), annualFeesCents: cents.nonnegative(), years: z.number().int().min(1).max(60), contributionGrowthPercent: z.number().min(-10).max(20) }), (i) => tax.superProjection(i)),

    'forecast.assumptions': m(z.object({ months: z.number().int().min(1).max(600) }), (i) => plan.buildAssumptions(ctx(), i.months)),
    'forecast.run': m(z.object({ assumptions: assumptionsSchema, scenario: scenarioSchema.nullable().optional() }), (i) => runForecast(i.assumptions as never, (i.scenario ?? null) as Scenario | null)),
    'forecast.calendar': m(z.object({ days: z.number().int().min(7).max(400) }), (i) => plan.cashflowCalendar(ctx(), i.days)),
    'scenarios.list': m(none, () => plan.listScenarios(ctx())),
    'scenarios.save': m(scenarioSchema, (s) => plan.saveScenario(ctx(), s as never)),
    'scenarios.duplicate': m(z.object({ id }), (i) => plan.duplicateScenario(ctx(), i.id)),
    'scenarios.delete': m(z.object({ id }), (i) => plan.deleteScenario(ctx(), i.id)),
    'scenarios.run': m(z.object({ assumptions: assumptionsSchema, ids: z.array(id).max(10), extra: z.array(scenarioSchema).max(5).optional() }), (i) => plan.runScenarios(ctx(), i.assumptions as never, i.ids, (i.extra ?? []) as never)),
    'scenarios.snapshots': m(none, () => plan.listSnapshots(ctx())),
    'scenarios.saveSnapshot': m(z.object({ assumptions: assumptionsSchema, scenarioId: z.string().nullable(), name: z.string().max(200) }), (i) => plan.saveSnapshot(ctx(), i.assumptions as never, i.scenarioId, i.name)),
    'scenarios.deleteSnapshot': m(z.object({ id }), (i) => plan.deleteSnapshot(ctx(), i.id)),
    'scenarios.compareSnapshots': m(z.object({ a: id, b: id }), (i) => plan.compareSnapshots(ctx(), i.a, i.b)),

    /* ---------- tax, investments, super ---------- */
    'tax.estimate': m(z.object({ fy }), (i) => tax.taxEstimate(ctx(), i.fy)),
    'tax.rules': m(z.object({ fy }), (i) => tax.taxRulesInfo(i.fy)),
    'tax.currentFy': m(none, () => financialYearOf(ctx().today())),
    'tax.bas': m(z.object({ fy, quarter: z.number().int().min(0).max(3) }), (i) => tax.basPreparation(ctx(), i.fy, i.quarter)),
    'payslips.list': m(z.object({ fy: fy.optional() }).optional(), (i) => tax.listPayslips(ctx(), i?.fy)),
    'payslips.save': m(z.object({ id: z.string(), employer: z.string().min(1).max(100), payDate: iso, periodStart: iso.nullable().optional(), periodEnd: iso.nullable().optional(), grossCents: cents.positive(), allowancesCents: cents.nonnegative(), salarySacrificeCents: cents.nonnegative(), taxableCents: cents.nullable().optional(), paygCents: cents.nonnegative(), employerSuperCents: cents.nonnegative(), deductionsCents: cents.nonnegative(), netCents: cents.nonnegative(), linkedTransactionId: z.string().nullable().optional() }), (p) => tax.savePayslip(ctx(), p as never)),
    'payslips.delete': m(z.object({ id }), (i) => tax.deletePayslip(ctx(), i.id)),
    'taxEntries.list': m(z.object({ fy }), (i) => tax.listTaxEntries(ctx(), i.fy)),
    'taxEntries.save': m(z.object({ id: z.string().optional(), fy, kind: z.enum(['deduction', 'payg-instalment', 'other-income', 'payg-withheld-other', 'reportable-super']), description: z.string().min(1).max(300), amountCents: cents.positive(), date: iso.nullable().optional() }), (e) => tax.saveTaxEntry(ctx(), e)),
    'taxEntries.delete': m(z.object({ id }), (i) => tax.deleteTaxEntry(ctx(), i.id)),
    'investments.overview': m(z.object({ fy: fy.optional() }).optional(), (i) => tax.investmentsOverview(ctx(), i?.fy)),
    'investments.saveSecurity': m(z.object({ id: z.string().optional(), code: z.string().min(1).max(20), name: z.string().max(200), kind: z.enum(['share', 'etf', 'managed-fund', 'other']) }), (s) => tax.saveSecurity(ctx(), s)),
    'investments.saveTrade': m(z.object({ id: z.string(), securityId: id, accountId: z.string().nullable().optional(), date: iso, type: z.enum(['buy', 'sell']), quantity: z.number().positive(), unitPriceCents: z.number().nonnegative(), brokerageCents: cents.nonnegative(), costUnknown: z.boolean().optional(), notes: nullableStr }), (t) => tax.saveTrade(ctx(), t as never)),
    'investments.deleteTrade': m(z.object({ id }), (i) => tax.deleteTrade(ctx(), i.id)),
    'investments.saveDividend': m(z.object({ id: z.string(), securityId: id, paymentDate: iso, cashCents: cents.nonnegative(), frankedCents: cents.nonnegative(), unfrankedCents: cents.nonnegative(), frankingCreditsCents: cents.nonnegative(), withholdingCents: cents.nonnegative().optional(), reinvested: z.boolean().optional(), fromStatement: z.boolean(), transactionId: z.string().nullable().optional() }), (d) => tax.saveDividend(ctx(), d as never)),
    'investments.deleteDividend': m(z.object({ id }), (i) => tax.deleteDividend(ctx(), i.id)),
    'investments.saveValuation': m(z.object({ securityId: id, date: iso, unitPriceCents: z.number().nonnegative() }), (v) => tax.saveValuation(ctx(), v)),
    'investments.chooseTradesCsv': m(none, async () => {
      const f = await platform.openFile({ title: 'Choose a broker trade history (CSV)', filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] });
      return f ? tax.previewTradesCsv(ctx(), new TextDecoder().decode(f.bytes)) : null;
    }),
    'investments.commitTrades': m(z.object({ rows: z.array(z.object({ date: iso, code: z.string().min(1).max(20), type: z.enum(['buy', 'sell']), quantity: z.number().positive(), unitPriceCents: z.number().nonnegative(), brokerageCents: cents.nonnegative() })), accountId: z.string().nullable() }), (i) => tax.commitTrades(ctx(), i.rows, i.accountId)),
    'super.overview': m(z.object({ fy: fy.optional() }).optional(), (i) => tax.superOverview(ctx(), i?.fy)),
    'super.saveEntry': m(z.object({ id: z.string(), accountId: id, date: iso, kind: z.enum(['balance', 'employer', 'salary-sacrifice', 'personal-concessional', 'non-concessional', 'fees', 'insurance', 'earnings', 'contributions-tax', 'withdrawal']), amountCents: cents }), (e) => tax.saveSuperEntry(ctx(), e)),
    'super.deleteEntry': m(z.object({ id }), (i) => tax.deleteSuperEntry(ctx(), i.id)),

    /* ---------- documents ---------- */
    'documents.list': m(z.object({ entity: z.string().optional(), entityId: z.string().optional() }).optional(), (i) => docs.listDocuments(ctx(), i?.entity, i?.entityId)),
    'documents.kinds': m(none, () => DOCUMENT_KIND_LABEL),
    'documents.attach': m(z.object({ kind: z.enum(Object.keys(DOCUMENT_KIND_LABEL) as [docs.DocumentKind, ...docs.DocumentKind[]]), link: z.object({ entity: z.string(), entityId: id }).nullable().optional(), notes: nullableStr }), async (i) => {
      if (state.demo) throw new core.UserError('Documents cannot be attached in demo mode.');
      const f = await platform.openFile({ title: 'Choose a document to attach', filters: [{ name: 'Documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'heic', 'webp', 'csv', 'txt', 'xlsx', 'xls', 'docx', 'doc', 'ofx', 'qfx', 'qif'] }] });
      if (!f) return null;
      return docs.addDocument(ctx(), store(), { fileName: f.name, bytes: f.bytes, kind: i.kind, notes: i.notes ?? null, link: i.link ?? null });
    }),
    'documents.update': m(z.object({ id, kind: z.string().optional(), notes: nullableStr, fileName: z.string().max(200).optional() }), (i) => docs.updateDocument(ctx(), i.id, i as never)),
    'documents.link': m(z.object({ id, entity: z.string(), entityId: id }), (i) => docs.linkDocument(ctx(), i.id, i.entity, i.entityId)),
    'documents.unlink': m(z.object({ id, entity: z.string(), entityId: id }), (i) => docs.unlinkDocument(ctx(), i.id, i.entity, i.entityId)),
    'documents.delete': m(z.object({ id }), (i) => docs.deleteDocument(ctx(), store(), i.id)),
    'documents.open': m(z.object({ id }), async (i) => { const d = docs.readDocument(ctx(), store(), i.id); await platform.openDocument(d.fileName, d.bytes); }),
    'documents.saveCopy': m(z.object({ id }), async (i) => { const d = docs.readDocument(ctx(), store(), i.id); return platform.saveFile({ title: 'Save a copy', defaultName: d.fileName, filters: [] }, d.bytes); }),

    /* ---------- output ---------- */
    'output.sheetNames': m(none, () => out.WORKBOOK_SHEETS),
    'output.exportXlsx': m(z.object({ range, fy: fy.optional(), sheets: z.array(z.string()).optional(), openAfter: z.boolean().optional() }), async (i) => {
      const wb = out.buildWorkbook(ctx(), { range: i.range, fy: i.fy, sheets: i.sheets as out.WorkbookSheetName[] });
      const path = await platform.saveFile({ title: 'Save Excel workbook', defaultName: `Geranium ${i.range.start} to ${i.range.end}.xlsx`, filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }] }, workbookToXlsx(wb));
      if (path && i.openAfter) await platform.openPath(path);
      return path;
    }),
    'output.exportCsv': m(z.object({ kind: z.enum(['transactions', 'categories', 'rules', 'budgets', 'bills', 'income', 'goals', 'forecast', 'accounts', 'payslips']), range }), (i) =>
      platform.saveFile({ title: 'Save CSV', defaultName: `geranium-${i.kind}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] }, out.exportCsv(ctx(), i.kind, i.range))),
    'output.report': m(z.object({ kind: z.string(), range, fy: fy.optional() }), (i) => out.report(ctx(), i.kind as out.ReportKind, i.range, i.fy)),
    'output.exportReport': m(z.object({ kind: z.string(), range, fy: fy.optional(), format: z.enum(['csv', 'xlsx']) }), async (i) => {
      const r = out.report(ctx(), i.kind as out.ReportKind, i.range, i.fy);
      if (i.format === 'csv') return platform.saveFile({ title: 'Save report', defaultName: `${r.title}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] }, toCsv(r.columns.map((c) => c.header), r.rows));
      return platform.saveFile({ title: 'Save report', defaultName: `${r.title}.xlsx`, filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }] }, workbookToXlsx({ title: r.title, createdAt: ctx().today(), sheets: [reportToSheet(r)] }));
    }),
    'output.accountantPackage': m(z.object({ fy, include: z.array(z.string()), includeDocuments: z.boolean() }), async (i) => {
      const folder = await platform.chooseFolder('Choose a folder for the accountant package');
      if (!folder) return null;
      const files = out.accountantPackage(ctx(), i.fy, { include: [...i.include, ...(i.includeDocuments ? ['documents'] : [])] });
      const wb = out.buildWorkbook(ctx(), { range: fyRange(i.fy), fy: i.fy, sheets: ['Income', 'Expenses', 'Transactions', 'Tax Estimate', 'Investments', 'Super'] });
      files.push({ path: `tax-records-${i.fy}.xlsx`, content: workbookToXlsx(wb) });
      if (i.includeDocuments && !state.demo) {
        const { start, end } = fyRange(i.fy);
        for (const d of docs.listDocuments(ctx())) {
          if (d.createdAt.slice(0, 10) < start && !d.links.some((l) => l.label.slice(0, 10) >= start && l.label.slice(0, 10) <= end)) continue;
          const r = docs.readDocument(ctx(), store(), d.id);
          files.push({ path: `documents/${d.id.slice(0, 8)}-${r.fileName.replace(/[\\/:*?"<>|]/g, '_')}`, content: r.bytes });
        }
      }
      const target = `${folder}/Geranium accountant package ${i.fy}`;
      await platform.writeFiles(target, files);
      return { folder: target, files: files.map((f) => f.path) };
    }),

    /* ---------- Google Sheets ---------- */
    'google.status': m(none, () => {
      const c = ctx();
      const tokens = core.getSecretValue<GoogleTokens>(c, 'google.tokens');
      const client = googleClient();
      return {
        configured: !!client.clientId,
        connected: !!tokens,
        clientId: client.clientId || null,
        exports: c.db.all("SELECT * FROM exports WHERE target = 'google' ORDER BY updated_at DESC").map((r) => ({ id: String(r.id), name: String(r.name), url: String(r.url), managed: !!r.managed, updatedAt: String(r.updated_at), externalId: String(r.external_id) })),
      };
    }),
    'google.setClient': m(z.object({ clientId: z.string().max(300), clientSecret: z.string().max(300).nullable() }), (i) => {
      const c = ctx();
      core.updateSettings(c, { googleClientId: i.clientId.trim() || null });
      core.setSecretValue(c, 'google.clientSecret', i.clientSecret?.trim() || null);
    }),
    'google.connect': m(none, async () => {
      if (state.demo) throw new core.UserError('Google Sheets is not available in demo mode. Use Excel export to try the spreadsheet output.');
      const tokens = await signIn(googleClient(), (url) => platform.openExternal(url));
      core.setSecretValue(ctx(), 'google.tokens', tokens);
      return true;
    }),
    'google.disconnect': m(none, async () => {
      const c = ctx();
      const tokens = core.getSecretValue<GoogleTokens>(c, 'google.tokens');
      if (tokens) await revoke(tokens);
      core.setSecretValue(c, 'google.tokens', null);
    }),
    'google.export': m(z.object({ range, fy: fy.optional(), sheets: z.array(z.string()).optional(), mode: z.enum(['snapshot', 'managed']), managedId: z.string().nullable().optional(), name: z.string().max(200).optional() }), async (i) => {
      const c = ctx();
      let tokens = core.getSecretValue<GoogleTokens>(c, 'google.tokens');
      if (!tokens) throw new core.UserError('Connect Google Sheets first.');
      tokens = await validAccessToken(googleClient(), tokens);
      core.setSecretValue(c, 'google.tokens', tokens);
      let existing: string | null = null;
      if (i.mode === 'managed' && i.managedId) {
        // Only ever update a spreadsheet this app created and recorded as managed.
        const row = c.db.get("SELECT external_id FROM exports WHERE id = ? AND target = 'google' AND managed = 1", [i.managedId]);
        if (!row) throw new core.UserError('That spreadsheet was not created by Geranium as a managed workbook, so it will not be changed.');
        existing = String(row.external_id);
      }
      const wb = out.buildWorkbook(c, { range: i.range, fy: i.fy, sheets: i.sheets as out.WorkbookSheetName[], title: i.name });
      const res = await writeWorkbookToGoogle(tokens.accessToken, wb, existing);
      const now = c.now();
      if (existing) c.db.run('UPDATE exports SET updated_at = ?, url = ? WHERE id = ?', [now, res.url, i.managedId!]);
      else c.db.run('INSERT INTO exports(id, target, name, external_id, url, managed, sheets, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)', [c.id(), 'google', wb.title, res.spreadsheetId, res.url, i.mode === 'managed' ? 1 : 0, JSON.stringify(wb.sheets.map((s) => s.name)), now, now]);
      return res;
    }),
    'google.forgetExport': m(z.object({ id }), (i) => { ctx().db.run('DELETE FROM exports WHERE id = ?', [i.id]); }),
    'google.openExport': m(z.object({ url: z.string().url() }), (i) => {
      if (!/^https:\/\/docs\.google\.com\//.test(i.url)) throw new core.UserError('Only Google Sheets links can be opened here.');
      return platform.openExternal(i.url);
    }),

    /* ---------- backup ---------- */
    'backup.create': m(z.object({ password: z.string().min(8).max(200) }), async (i) => {
      const { bytes, counts } = await state.backupTo(i.password);
      const date = new Date().toISOString().slice(0, 10);
      const path = await platform.saveFile({ title: 'Save encrypted backup', defaultName: `Geranium backup ${date}.geranium-backup`, filters: [{ name: 'Geranium backup', extensions: ['geranium-backup'] }] }, bytes);
      return path ? { path, counts } : null;
    }),
    'backup.choose': m(none, async () => {
      const f = await platform.openFile({ title: 'Choose a Geranium backup', filters: [{ name: 'Geranium backup', extensions: ['geranium-backup', 'pbbackup'] }] });
      if (!f) return null;
      pendingRestore = f.bytes;
      return { fileName: f.name, ...state.inspectBackup(f.bytes) };
    }),
    'backup.restore': m(z.object({ password: z.string().max(200) }), async (i) => {
      if (!pendingRestore) throw new core.UserError('Choose a backup file first.');
      const r = await state.restoreFrom(pendingRestore, i.password);
      pendingRestore = null;
      return r;
    }),
  };
}

let pendingRestore: Uint8Array | null = null;

export type Registry = ReturnType<typeof buildRegistry>;
export type ApiMethod = keyof Registry;
export type ApiInput<K extends ApiMethod> = z.input<Registry[K]['schema']>;
export type ApiOutput<K extends ApiMethod> = Awaited<ReturnType<Registry[K]['handler']>>;

/** Calls allowed while the app is locked (or before it is set up). */
export const PUBLIC_METHODS = new Set<string>(['app.status', 'app.initialise', 'app.unlock', 'app.recover', 'app.lock', 'app.enterDemo', 'app.exitDemo', 'app.networkLog']);

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export async function dispatch(registry: Registry, state: AppState, method: string, input: unknown): Promise<ApiResult<unknown>> {
  const entry = (registry as Record<string, { schema: z.ZodTypeAny; handler: (i: unknown) => unknown }>)[method];
  if (!entry) return { ok: false, error: { code: 'UNKNOWN_METHOD', message: 'Unknown request.' } };
  if (!PUBLIC_METHODS.has(method) && !state.ctx) return { ok: false, error: { code: 'LOCKED', message: 'Geranium is locked.' } };
  const parsed = entry.schema.safeParse(input ?? undefined);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: { code: 'INVALID', message: `Please check the details entered${first?.path?.length ? ` (${first.path.join('.')})` : ''}: ${first?.message ?? 'invalid'}.` } };
  }
  try {
    return { ok: true, data: await entry.handler(parsed.data) };
  } catch (e) {
    const err = e as Error;
    if (err.message === 'LOCKED') return { ok: false, error: { code: 'LOCKED', message: 'Geranium is locked.' } };
    const known = ['UserError', 'DecryptError', 'BackupPasswordError', 'BackupDamagedError', 'PdfPasswordError', 'NetworkBlockedError', 'RecoveryKeyFormatError'].includes(err.name) || err instanceof core.UserError;
    // Error messages from services are written for the user; anything unexpected gets a generic message.
    if (known || /^(Geranium|Unlock|Use a|A PIN|Too many|Incorrect|This |No |Google|Enter|Choose|Connect|That )/.test(err.message)) {
      return { ok: false, error: { code: err.name || 'ERROR', message: err.message } };
    }
    console.error(`[api] ${method} failed:`, err.name, err.message.slice(0, 200));
    return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong and this action was not completed.' } };
  }
}
