import { describe, expect, it } from 'vitest';
import { testCtx, enc } from '../helpers/ctx';
import { saveAccount, listAccounts } from '@main/services/core';
import { applyImportMapping, approveObvious, approveStaged, commitImport, currentMappingKinds, inbox, listImports, openImport, previewImport, rejectStaged, undoImport } from '@main/services/imports';
import { acceptRuleSuggestion, getTransaction, linkTransfer, listTransactions, ruleSuggestions, setSplits, transactionHistory, transferSuggestions, updateTransaction, applyRules, listRules } from '@main/services/transactions';
import { AUGUST_ROWS, makePdf, statementLayout } from '../helpers/pdf';

const CSV = [
  'Date,Description,Debit,Credit,Balance',
  '02/08/2026,WOOLWORTHS 1234 PETRIE,126.43,,6383.57',
  '03/08/2026,PAYROLL EXAMPLE PTY LTD,,"4,102.17",10485.74',
  '04/08/2026,LOCAL BAKERY 22,82.20,,10403.54',
  '10/08/2026,TRANSFER TO SAVINGS,"4,000.00",,6403.54',
  '15/08/2026,AGL SALES PTY LTD,412.60,,5990.94',
].join('\n');

async function importCsv(ctx: Awaited<ReturnType<typeof testCtx>>, accountId: string, text = CSV, name = 'august.csv') {
  const s = await openImport(ctx, name, enc(text));
  const kinds = currentMappingKinds(s.sessionId);
  const p = previewImport(ctx, s.sessionId, 0, accountId);
  const r = commitImport(ctx, { sessionId: s.sessionId, statementIndex: 0, accountId, rows: p.rows.map((x) => ({ index: x.index, include: x.include })), saveProfileName: 'Example Bank export' });
  return { s, p, r, kinds };
}

describe('import pipeline', () => {
  it('imports a CSV, categorises, stages uncertain rows and records the closing balance', async () => {
    const ctx = await testCtx();
    const everyday = saveAccount(ctx, { name: 'Everyday', type: 'transaction', number: '062000 12345678' });
    const { s, p, r, kinds } = await importCsv(ctx, everyday);
    expect(s.format).toBe('csv');
    expect(s.needsMapping).toBe(false);
    expect(kinds).toEqual(['date', 'description', 'debit', 'credit', 'balance']);
    expect(p.counts.total).toBe(5);
    expect(p.rows[0]).toMatchObject({ suggestedCategoryId: 'food.groceries', categoryConfidence: 'medium' });
    // Every row is either posted or staged for review; none are lost.
    expect(r.added + r.staged).toBe(5);
    const posted = listTransactions(ctx, { status: 'posted' });
    const woolies = posted.rows.find((t) => t.originalDescription.startsWith('WOOLWORTHS'))!;
    expect(woolies.categoryName).toBe('Groceries');
    expect(woolies.categoryExplanation).toMatch(/built-in rule/);
    expect(woolies.originalData).toMatchObject({ row: { Description: 'WOOLWORTHS 1234 PETRIE' } });
    const acc = listAccounts(ctx).find((a) => a.id === everyday)!;
    expect(acc.balance).toMatchObject({ balanceCents: 599094, source: 'imported', date: '2026-08-15' });
    expect(listImports(ctx)[0]).toMatchObject({ added: r.added, staged: r.staged });
  });

  it('recognises the same export next time with a saved profile and skips duplicates', async () => {
    const ctx = await testCtx();
    const everyday = saveAccount(ctx, { name: 'Everyday', type: 'transaction' });
    await importCsv(ctx, everyday);
    const again = await openImport(ctx, 'august-again.csv', enc(CSV + '\n20/08/2026,INTEREST CREDIT,,1.23,5992.17'));
    expect(again.profileMatch?.name).toBe('Example Bank export');
    const p = previewImport(ctx, again.sessionId, 0, everyday);
    expect(p.counts.duplicates).toBe(5);
    const r = commitImport(ctx, { sessionId: again.sessionId, statementIndex: 0, accountId: everyday, rows: p.rows.map((x) => ({ index: x.index, include: x.include })) });
    expect(r.skippedDuplicates).toBe(5);
    expect(r.added + r.staged).toBe(1);
    const same = await openImport(ctx, 'august.csv', enc(CSV));
    expect(same.alreadyImported).not.toBeNull();
  });

  it('reconciles a PDF statement and stages its rows for review', async () => {
    const ctx = await testCtx();
    const everyday = saveAccount(ctx, { name: 'Everyday', type: 'transaction', number: '1234 5678' });
    const pdf = await makePdf([statementLayout({ period: '1 August 2026 to 31 August 2026', opening: '$6,510.00', closing: '$5,688.80', rows: AUGUST_ROWS })]);
    const s = await openImport(ctx, 'statement.pdf', pdf);
    expect(s.format).toBe('pdf');
    expect(s.statements[0].suggestedAccountId).toBe(everyday);
    const p = previewImport(ctx, s.sessionId, 0, everyday);
    expect(p.reconciliation.status).toBe('reconciled');
    expect(p.rows.every((r) => r.willStage)).toBe(true);
    const r = commitImport(ctx, { sessionId: s.sessionId, statementIndex: 0, accountId: everyday, rows: p.rows.map((x) => ({ index: x.index, include: true })) });
    expect(r.staged).toBe(7);
    expect(inbox(ctx).count).toBe(7);
    // Posted-only analysis is not affected until the rows are approved.
    expect(listTransactions(ctx, { status: 'posted' }).total).toBe(0);
    const obvious = approveObvious(ctx);
    expect(obvious.approved).toBeGreaterThan(0);
    const left = inbox(ctx).rows;
    approveStaged(ctx, left.slice(0, 1).map((x) => x.id), 'other.uncategorised');
    rejectStaged(ctx, left.slice(1).map((x) => x.id));
    expect(inbox(ctx).count).toBe(0);
  });

  it('lets the user correct rows before import and keeps the correction history', async () => {
    const ctx = await testCtx();
    const everyday = saveAccount(ctx, { name: 'Everyday', type: 'transaction' });
    const s = await openImport(ctx, 'a.csv', enc(CSV));
    const p = previewImport(ctx, s.sessionId, 0, everyday);
    commitImport(ctx, { sessionId: s.sessionId, statementIndex: 0, accountId: everyday, rows: p.rows.map((x) => ({ index: x.index, include: true, ...(x.index === 2 ? { amountCents: -8200, categoryId: 'food.restaurants' } : {}) })) });
    const bakery = listTransactions(ctx, { status: 'posted', search: 'bakery' }).rows[0] ?? inbox(ctx).rows.find((t) => t.originalDescription.includes('BAKERY'))!;
    expect(bakery.amountCents).toBe(-8200);
    expect(bakery.categorySource).toBe('user');
    const h = transactionHistory(ctx, bakery.id);
    expect(h.find((x) => x.field === 'amountCents')).toMatchObject({ oldValue: '-8220', newValue: '-8200', reason: 'Corrected on the import review screen' });
  });

  it('asks for a mapping when columns are unclear, and applies it', async () => {
    const ctx = await testCtx();
    const acc = saveAccount(ctx, { name: 'Card', type: 'credit-card' });
    const s = await openImport(ctx, 'odd.csv', enc('When,What,How much\n01/09/2026,BOOKSHOP,25.00\n02/09/2026,PETROL,60.00'));
    expect(s.mappingQuestions.some((q) => /money out/.test(q))).toBe(true);
    const applied = applyImportMapping(ctx, s.sessionId, { kinds: ['date', 'description', 'amount'], headerRow: 0, firstDataRow: 1, dateFormat: 'DMY', positiveIsCredit: false });
    expect(applied.statements[0].transactionCount).toBe(2);
    const p = previewImport(ctx, s.sessionId, 0, acc);
    expect(p.rows.map((r) => r.amountCents)).toEqual([-2500, -6000]);
  });

  it('undoes an import completely', async () => {
    const ctx = await testCtx();
    const everyday = saveAccount(ctx, { name: 'Everyday', type: 'transaction' });
    const { r } = await importCsv(ctx, everyday);
    expect(undoImport(ctx, r.importId).removed).toBe(5);
    expect(listTransactions(ctx, { status: 'posted' }).total).toBe(0);
    expect(listAccounts(ctx)[0].balance).toBeNull();
  });
});

describe('transactions', () => {
  it('learns from repeated corrections only with consent', async () => {
    const ctx = await testCtx();
    const acc = saveAccount(ctx, { name: 'Everyday', type: 'transaction' });
    const csv = 'Date,Description,Amount\n01/09/2026,CORNER STORE 11,-10.00\n08/09/2026,CORNER STORE 22,-12.00\n15/09/2026,CORNER STORE 33,-9.00';
    const s = await openImport(ctx, 'c.csv', enc(csv));
    const p = previewImport(ctx, s.sessionId, 0, acc);
    commitImport(ctx, { sessionId: s.sessionId, statementIndex: 0, accountId: acc, rows: p.rows.map((x) => ({ index: x.index, include: true })) });
    approveStaged(ctx, inbox(ctx).rows.map((t) => t.id));
    const all = listTransactions(ctx, { status: 'posted', sort: 'date-asc' }).rows;
    const first = updateTransaction(ctx, all[0].id, { categoryId: 'food.groceries' });
    expect(first.ruleSuggestion).toBeNull();
    const second = updateTransaction(ctx, all[1].id, { categoryId: 'food.groceries' });
    expect(second.ruleSuggestion).toMatchObject({ pattern: 'CORNER', categoryId: 'food.groceries' });
    expect(ruleSuggestions(ctx)[0].message).toBe('Always categorise transactions containing "CORNER" as Groceries?');
    expect(listRules(ctx).some((r) => r.source === 'learned')).toBe(false);
    const accepted = acceptRuleSuggestion(ctx, 'CORNER', 'food.groceries', true);
    expect(accepted.updated).toBe(1);
    expect(getTransaction(ctx, all[2].id).categoryName).toBe('Groceries');
    const h = transactionHistory(ctx, all[0].id).find((x) => x.field === 'categoryId' && x.reason === 'Changed by you');
    expect(h).toMatchObject({ newValue: 'Groceries' });
    // A later "apply rules" run never overrides a category chosen by hand.
    updateTransaction(ctx, all[2].id, { categoryId: 'shopping.household' });
    applyRules(ctx);
    expect(getTransaction(ctx, all[2].id).categoryName).toBe('Household');
  });

  it('splits a transaction into parts that add up exactly', async () => {
    const ctx = await testCtx();
    const acc = saveAccount(ctx, { name: 'Everyday', type: 'transaction' });
    const s = await openImport(ctx, 'd.csv', enc('Date,Description,Amount\n01/09/2026,BIG DEPARTMENT STORE,-240.00'));
    const p = previewImport(ctx, s.sessionId, 0, acc);
    commitImport(ctx, { sessionId: s.sessionId, statementIndex: 0, accountId: acc, rows: [{ index: 0, include: true, categoryId: 'shopping.general' }] });
    const t = listTransactions(ctx, { status: 'posted' }).rows[0] ?? inbox(ctx).rows[0];
    expect(() => setSplits(ctx, t.id, [{ categoryId: 'food.groceries', amountCents: -9000 }, { categoryId: 'shopping.clothing', amountCents: -8000 }])).toThrow(/add up to/);
    const split = setSplits(ctx, t.id, [{ categoryId: 'food.groceries', amountCents: -9000 }, { categoryId: 'shopping.clothing', amountCents: -8000 }, { categoryId: 'shopping.household', amountCents: -7000 }]);
    expect(split.amountCents).toBe(-24000);
    expect(split.splits.map((x) => x.categoryName)).toEqual(['Groceries', 'Clothing', 'Household']);
    void p;
  });

  it('links transfers between the user’s accounts', async () => {
    const ctx = await testCtx();
    const everyday = saveAccount(ctx, { name: 'Everyday', type: 'transaction' });
    const savings = saveAccount(ctx, { name: 'Savings', type: 'savings' });
    for (const [acc, csv] of [[everyday, 'Date,Description,Amount\n10/09/2026,TRANSFER TO SAVINGS,-1000.00'], [savings, 'Date,Description,Amount\n10/09/2026,TRANSFER FROM EVERYDAY,1000.00']] as const) {
      const s = await openImport(ctx, `${acc}.csv`, enc(csv));
      const p = previewImport(ctx, s.sessionId, 0, acc);
      commitImport(ctx, { sessionId: s.sessionId, statementIndex: 0, accountId: acc, rows: p.rows.map((x) => ({ index: x.index, include: true })) });
    }
    const sugg = transferSuggestions(ctx);
    expect(sugg).toHaveLength(1);
    expect(sugg[0].confidence).toBe('high');
    linkTransfer(ctx, sugg[0].outId, sugg[0].inId);
    const both = [getTransaction(ctx, sugg[0].outId), getTransaction(ctx, sugg[0].inId)];
    expect(both.every((t) => t.isTransfer && t.transferId)).toBe(true);
    expect(transferSuggestions(ctx)).toHaveLength(0);
  });
});
