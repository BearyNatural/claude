import { describe, expect, it } from 'vitest';
import { testCtx } from '../helpers/ctx';
import { makePdf, superStatementLayout } from '../helpers/pdf';
import { getSettings, listAccounts, saveAccount, seedDefaults, updateSettings } from '@main/services/core';
import { commitImport, openImport, previewImport } from '@main/services/imports';
import { spendingSummary, dashboard } from '@main/services/insights';
import { superOverview, taxEstimate } from '@main/services/taxes';
import { listTransactions } from '@main/services/transactions';
import { superCategoryFor } from '@domain/categorise/superannuation';
import { bestRule, defaultRules } from '@domain/categorise/rules';

describe('super categories', () => {
  it('follows the statement column first, then the wording', () => {
    expect(superCategoryFor('ACME PTY LTD', 100000, 'Employer SG')?.categoryId).toBe('super.employer-sg');
    expect(superCategoryFor('ACME PTY LTD', 100000, 'Employer additional')?.categoryId).toBe('super.employer-additional');
    expect(superCategoryFor('Contribution', 100000, 'Member before-tax')?.categoryId).toBe('super.personal-before-tax');
    expect(superCategoryFor('Contribution', 100000, 'Member after-tax')?.categoryId).toBe('super.personal-after-tax');
    expect(superCategoryFor('Investment returns', 850000)?.categoryId).toBe('super.returns');
    expect(superCategoryFor('Flat administration fees', -5200)?.categoryId).toBe('super.fees');
    expect(superCategoryFor('Tax benefit – Flat administration fees', 780)?.categoryId).toBe('super.tax');
    expect(superCategoryFor('Government contribution tax', -44258)?.categoryId).toBe('super.tax');
    expect(superCategoryFor('Insurance premium – death cover', -3000)?.categoryId).toBe('super.insurance');
    expect(superCategoryFor('Rollover in from another fund', 500000)?.categoryId).toBe('super.rollovers');
    const employer = superCategoryFor('NEW EMPLOYER PTY LTD', 40000);
    expect(employer).toMatchObject({ categoryId: 'super.employer-sg', confidence: 'medium' });
    expect(superCategoryFor('Something else', -100)).toBeNull();
  });

  it('only treats "Services Australia" as a government payment at the start of a description', () => {
    const rules = defaultRules();
    expect(bestRule(rules, { description: 'EXAMPLE WEB SERVICES AUSTRALIA PTY LTD', amountCents: 50000 })?.rule.categoryId).not.toBe('income.government');
    expect(bestRule(rules, { description: 'SERVICES AUSTRALIA CENTRELINK 123', amountCents: 50000 })?.rule.categoryId).toBe('income.government');
  });
});

describe('a super fund statement imported into a super account', () => {
  it('uses super categories and keeps super out of household income, spending and personal tax', async () => {
    const ctx = await testCtx('2026-09-27');
    const everyday = saveAccount(ctx, { name: 'Everyday', type: 'transaction' });
    const fund = saveAccount(ctx, { name: 'My super', type: 'superannuation' });
    const before = { tax: taxEstimate(ctx, '2025-26'), spending: spendingSummary(ctx, { start: '2025-07-01', end: '2026-06-30' }) };

    const s = await openImport(ctx, 'super-statement.pdf', await makePdf([superStatementLayout()]));
    const p = previewImport(ctx, s.sessionId, 0, fund);
    expect(p.rows.map((r) => r.suggestedCategoryId)).toEqual([
      'super.employer-sg', 'super.employer-sg', 'super.employer-sg', 'super.personal-after-tax',
      'super.returns', 'super.fees', 'super.fees', 'super.tax', 'super.tax', 'super.tax',
    ]);
    expect(p.reconciliation.status).toBe('reconciled');
    const r = commitImport(ctx, { sessionId: s.sessionId, statementIndex: 0, accountId: fund, rows: p.rows.map((x) => ({ index: x.index, include: true })) });
    expect(r.added + r.staged).toBe(10); // PDF rows wait in the Review inbox by default
    // Approve everything that waited in the inbox (as a user would after checking).
    ctx.db.run("UPDATE transactions SET status = 'posted' WHERE account_id = ?", [fund]);
    expect(listTransactions(ctx, { accountId: fund }).rows).toHaveLength(10);

    // Not household income or spending, and not in the personal tax estimate.
    const after = { tax: taxEstimate(ctx, '2025-26'), spending: spendingSummary(ctx, { start: '2025-07-01', end: '2026-06-30' }) };
    expect(after.spending.totals.incomeCents).toBe(before.spending.totals.incomeCents);
    expect(after.spending.totals.expenseCents).toBe(before.spending.totals.expenseCents);
    expect(after.tax.taxableIncomeCents).toBe(before.tax.taxableIncomeCents);
    expect(after.tax.totalLiabilityCents).toBe(before.tax.totalLiabilityCents);
    expect(after.tax.paygWithheldCents).toBe(before.tax.paygWithheldCents); // tax inside the fund is not PAYG
    expect(dashboard(ctx, 'month').totals.incomeCents).toBe(0);
    expect(everyday).toBeTruthy();

    // The Super screen picks up the imported statement.
    const sup = superOverview(ctx, '2025-26');
    expect(sup.summary.employerCents).toBe(295050);
    expect(sup.summary.nonConcessionalCents).toBe(200000);
    expect(sup.summary.concessionalTotalCents).toBe(295050);
    expect(sup.summary.earningsCents).toBe(850000);
    expect(sup.summary.feesCents).toBe(14840);
    expect(sup.summary.fundTaxCents).toBe(44258 - 780 - 1446);
    expect(sup.history.map((h) => h.balanceCents)).toContain(11288178);
  });
});

describe('accounts', () => {
  it('can remove a stored account number, and editing keeps the BSB', async () => {
    const ctx = await testCtx();
    const id = saveAccount(ctx, { name: 'Everyday', type: 'transaction', number: '12345678', bsb: '063-000' });
    expect(listAccounts(ctx)[0]).toMatchObject({ numberMasked: '••5678', bsb: '063-000' });
    saveAccount(ctx, { id, name: 'Everyday account', type: 'transaction' }); // number and BSB not sent: kept
    expect(listAccounts(ctx)[0]).toMatchObject({ name: 'Everyday account', numberMasked: '••5678', bsb: '063-000' });
    saveAccount(ctx, { id, name: 'Everyday account', type: 'transaction', number: null });
    expect(listAccounts(ctx)[0].numberMasked).toBeNull();
    expect(listAccounts(ctx)[0].bsb).toBe('063-000');
  });

  it('corrects the built-in "Services Australia" rule in existing data', async () => {
    const ctx = await testCtx();
    ctx.db.run("UPDATE rules SET match_type = 'contains' WHERE source = 'default' AND pattern = 'SERVICES AUSTRALIA'");
    seedDefaults(ctx);
    expect(ctx.db.scalar("SELECT match_type FROM rules WHERE source = 'default' AND pattern = 'SERVICES AUSTRALIA'")).toBe('starts-with');
    updateSettings(ctx, { autoLearnRules: true });
    expect(getSettings(ctx).autoLearnRules).toBe(true);
  });
});

describe('super and household categories stay apart', () => {
  it('does not learn rules from super accounts or use super categories in bank accounts', async () => {
    const { updateTransaction, ruleSuggestions, makeCategoriser, addManualTransaction } = await import('@main/services/transactions');
    const ctx = await testCtx('2026-09-27');
    const bank = saveAccount(ctx, { name: 'Everyday', type: 'transaction' });
    const fund = saveAccount(ctx, { name: 'My super', type: 'superannuation' });
    const ids = ['2026-01-15', '2026-02-15', '2026-03-15'].map((date) => addManualTransaction(ctx, { accountId: fund, date, amountCents: 88000, description: 'EXAMPLE CONSULTING PTY LTD' }));
    for (const id of ids) updateTransaction(ctx, typeof id === 'string' ? id : (id as { id: string }).id, { categoryId: 'super.employer-additional' });
    expect(ruleSuggestions(ctx)).toHaveLength(0);
    const c = makeCategoriser(ctx);
    expect(c.suggest({ description: 'EXAMPLE CONSULTING PTY LTD', amountCents: 420000, accountId: bank }).categoryId ?? '').not.toMatch(/^super\./);
    expect(c.suggest({ description: 'EXAMPLE CONSULTING PTY LTD', amountCents: 88000, accountId: fund }).categoryId).toMatch(/^super\./);
  });
});
