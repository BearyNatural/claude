import { describe, expect, it } from 'vitest';
import { testCtx } from '../helpers/ctx';
import { makePdf, multiAccountStatementPages, statementLayout, AUGUST_ROWS } from '../helpers/pdf';
import { extractPdfText } from '@main/import/pdfExtract';
import { parsePdfStatements, accountTypeFromName } from '@domain/import/pdfStatement';
import { saveAccount, listAccounts } from '@main/services/core';
import { commitImport, commitImportAll, importSession, openImport, previewImport } from '@main/services/imports';
import { listTransactions } from '@main/services/transactions';

const sum = (xs: { amountCents: number }[]) => xs.reduce((a, t) => a + t.amountCents, 0);

describe('a PDF statement that lists several accounts', () => {
  it('splits into one statement per account and reads each one', async () => {
    const { pages } = await extractPdfText(await makePdf(multiAccountStatementPages()));
    const sts = parsePdfStatements(pages, { balanceMeaning: 'asset' });
    expect(sts.map((s) => s.account?.number)).toEqual(['11112222', '33334444', '55556666']);
    expect(sts.map((s) => s.account?.name)).toEqual(['Everyday', 'Savings', 'Home Loan']);
    expect(sts.map((s) => s.account?.type)).toEqual(['transaction', 'savings', 'mortgage']);
    expect(sts.every((s) => s.periodStart === '2026-01-01' && s.periodEnd === '2026-06-30')).toBe(true);
    expect(sts[0].account?.bsb).toBe('999-001');

    const [everyday, savings] = sts;
    expect(everyday.transactions.map((t) => [t.date, t.amountCents])).toEqual([
      ['2026-01-05', -2550], ['2026-01-10', 50000], ['2026-01-12', -30000], ['2026-02-20', 6000], ['2026-02-25', 50],
    ]);
    // The amount on the next line joins the dated line above it; REF lines join their transaction.
    expect(everyday.transactions[0].description).toBe('Card Purchase EXAMPLE GROCER 040126');
    expect(everyday.transactions[1].description).toBe('Fast Pymt In REF:Birthday gift');
    expect(everyday.transactions[2].description).toBe('TXN INITIATED BY-900001 TRANSFER TO 999001 33334444 EXAMPLE PERSON');
    expect(everyday.transactions[3].description).toBe('From: EXAMPLE PERSON REF: rent share');
    expect(everyday.transactions.every((t) => t.confidence === 'high' && t.issues.length === 0)).toBe(true);
    expect([everyday.openingBalanceCents, everyday.closingBalanceCents]).toEqual([10000, 33500]);
    expect(everyday.closingBalanceCents! - everyday.openingBalanceCents!).toBe(sum(everyday.transactions));

    // The savings account continues on page 2 under repeated headings.
    expect(savings.transactions.map((t) => t.amountCents)).toEqual([30000, 210, -100000]);
    expect(savings.transactions[2].description).toBe('Fast Pymt Out REF:Holiday fund');
    expect(savings.closingBalanceCents! - savings.openingBalanceCents!).toBe(sum(savings.transactions));
  });

  it('reads the loan section as money owed, ignoring notes and "interest saved" lines', async () => {
    const { pages } = await extractPdfText(await makePdf(multiAccountStatementPages()));
    const loan = parsePdfStatements(pages, { balanceMeaning: 'liability' })[2];
    expect(loan.transactions.map((t) => [t.description, t.amountCents])).toEqual([['Interest Charged', -24000], ['Auto Payment', 100000]]);
    expect([loan.openingBalanceCents, loan.closingBalanceCents]).toEqual([-5000000, -4924000]);
    expect(loan.transactions.every((t) => t.issues.length === 0)).toBe(true);
  });

  it('still reads a single-account statement as one statement', async () => {
    const { pages } = await extractPdfText(await makePdf([statementLayout({ period: '1 August 2026 to 31 August 2026', opening: '6,510.00', closing: '5,688.80', rows: AUGUST_ROWS })]));
    const sts = parsePdfStatements(pages);
    expect(sts).toHaveLength(1);
    expect(sts[0].transactions).toHaveLength(7);
  });

  it('guesses account types from product names', () => {
    expect(accountTypeFromName('Mortgage Freedom')).toBe('offset');
    expect(accountTypeFromName('Home Loan Accelerate Var OO P&I')).toBe('mortgage');
    expect(accountTypeFromName('Rainy day eSaver Flexi')).toBe('savings');
    expect(accountTypeFromName('Joint Everyday')).toBe('transaction');
    expect(accountTypeFromName('Something')).toBeNull();
  });
});

describe('importing a multi-account statement', () => {
  it('matches each section to the account with that number and imports them all', async () => {
    const ctx = await testCtx('2026-07-20');
    const everyday = saveAccount(ctx, { name: 'Everyday', type: 'transaction', number: '11112222' });
    const savings = saveAccount(ctx, { name: 'Savings', type: 'savings', number: '33334444' });
    const loan = saveAccount(ctx, { name: 'Home loan', type: 'mortgage', number: '55556666' });
    const s = await openImport(ctx, 'statement.pdf', await makePdf(multiAccountStatementPages()));
    expect(s.statements.map((x) => x.suggestedAccountId)).toEqual([everyday, savings, loan]);
    expect(s.statements.map((x) => x.transactionCount)).toEqual([5, 3, 2]);

    const r = commitImportAll(ctx, { sessionId: s.sessionId, items: s.statements.map((x) => ({ statementIndex: x.index, accountId: x.suggestedAccountId! })) });
    expect(r.results.map((x) => x.reconciliation.status)).toEqual(['reconciled', 'reconciled', 'reconciled']);
    expect(r.results[2].remaining).toBe(0);
    ctx.db.run("UPDATE transactions SET status = 'posted'");
    expect(listTransactions(ctx, { accountId: everyday }).rows).toHaveLength(5);
    expect(listTransactions(ctx, { accountId: savings }).rows).toHaveLength(3);
    expect(listTransactions(ctx, { accountId: loan }).rows.map((t) => t.amountCents).sort((a, b) => a - b)).toEqual([-24000, 100000]);
    const balances = new Map(listAccounts(ctx).map((a) => [a.id, a.balance?.balanceCents]));
    expect(balances.get(everyday)).toBe(33500);
    expect(balances.get(loan)).toBe(-4924000);
    // Everything is done, so the file is closed.
    expect(() => importSession(ctx, s.sessionId)).toThrow(/expired/);
  });

  it('keeps the file open while some accounts are still to be imported', async () => {
    const ctx = await testCtx('2026-07-20');
    const everyday = saveAccount(ctx, { name: 'Everyday', type: 'transaction', number: '11112222' });
    const s = await openImport(ctx, 'statement.pdf', await makePdf(multiAccountStatementPages()));
    expect(s.statements.map((x) => x.suggestedAccountId)).toEqual([everyday, null, null]);
    const p = previewImport(ctx, s.sessionId, 0, everyday);
    const r = commitImport(ctx, { sessionId: s.sessionId, statementIndex: 0, accountId: everyday, rows: p.rows.map((x) => ({ index: x.index, include: x.include })) });
    expect(r.remaining).toBe(2);
    const again = importSession(ctx, s.sessionId);
    expect(again.statements.map((x) => x.importedInto)).toEqual([everyday, null, null]);
    expect(() => commitImport(ctx, { sessionId: s.sessionId, statementIndex: 0, accountId: everyday, rows: [] })).toThrow(/already been imported/);
  });

  it('does not guess when two accounts end in the same four digits', async () => {
    const ctx = await testCtx('2026-07-20');
    saveAccount(ctx, { name: 'One', type: 'transaction', number: '99992222' });
    saveAccount(ctx, { name: 'Two', type: 'transaction', number: '11112222' });
    const s = await openImport(ctx, 'statement.pdf', await makePdf(multiAccountStatementPages()));
    expect(s.statements[0].suggestedAccountId).toBeNull();
  });
});
