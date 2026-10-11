import { describe, expect, it } from 'vitest';
import { testCtx } from '../helpers/ctx';
import { suggestCategory, suggestRules } from '@domain/categorise/learning';
import { defaultRules } from '@domain/categorise/rules';
import { fineMerchantKey, merchantKey } from '@domain/categorise/clean';
import { saveAccount, saveCategory } from '@main/services/core';
import { addManualTransaction, createRule, repairLearnedRules, setSplits, updateTransaction, listTransactions, makeCategoriser } from '@main/services/transactions';
import { deductionItems, taxEstimate } from '@main/services/taxes';

// Fictional descriptions in the styles banks print them (BIGRIVER is a made-up company).
const PAY = 'ePayment From:BIGRIVER H G PTY L REF: 000111222 29/01/26';
const PAY_2 = 'ePayment From:BIGRIVER H G PTY L REF: 000111333 28/02/26';
const MARKETPLACE = 'Card Purchase PAYW BIGRIVER MKTPLC AU SYDNEY 120426';

describe('telling businesses with the same first word apart', () => {
  it('uses more of the name than the first word', () => {
    expect(merchantKey(PAY)).toBe('BIGRIVER');
    expect(merchantKey(MARKETPLACE)).toBe('BIGRIVER');
    expect(fineMerchantKey(PAY)).toBe('BIGRIVER H G');
    expect(fineMerchantKey(MARKETPLACE)).toBe('BIGRIVER MKTPLC SYDNEY');
  });

  it('does not suggest a salary category for a purchase from a similarly named business', () => {
    const history = [
      { description: PAY, categoryId: 'income.salary', amountCents: 500000 },
      { description: PAY_2, categoryId: 'income.salary', amountCents: 500000 },
    ];
    const rules = defaultRules();
    expect(suggestCategory({ description: MARKETPLACE, amountCents: -4599 }, rules, history).categoryId).not.toBe('income.salary');
    expect(suggestCategory({ description: 'ePayment From:BIGRIVER H G PTY L REF: 000111444 30/03/26', amountCents: 510000 }, rules, history)).toMatchObject({ categoryId: 'income.salary', source: 'history' });
  });

  it('has built-in rules for the different Amazon businesses', () => {
    const rules = defaultRules();
    expect(suggestCategory({ description: 'Card Purchase AMAZON MKTPLC AU SYDNEY 120426', amountCents: -4599 }, rules, []).categoryId).toBe('shopping.general');
    expect(suggestCategory({ description: 'AMAZON WEB SERVICES AWS.AMAZON.CO', amountCents: -1234 }, rules, []).categoryId).toBe('subscriptions.software');
    expect(suggestCategory({ description: 'AMAZON PRIME AU', amountCents: -999 }, rules, []).categoryId).toBe('subscriptions.streaming');
  });

  it('prefers earlier choices for the same name over ones for names that only share the first word', () => {
    const history = [
      { description: 'BIGRIVER MKTPLC AU SYDNEY', categoryId: 'shopping.household', amountCents: -2000 },
      { description: 'BIGRIVER MKTPLC AU SYDNEY', categoryId: 'shopping.household', amountCents: -3000 },
      { description: 'BIGRIVER CLOUD SERVICES', categoryId: 'subscriptions.cloud', amountCents: -1500 },
    ];
    expect(suggestCategory({ description: MARKETPLACE, amountCents: -4599 }, defaultRules(), history)).toMatchObject({ categoryId: 'shopping.household', confidence: 'medium' });
    // Only the first word in common: suggested, but sent for checking.
    expect(suggestCategory({ description: 'BIGRIVER BOOKS ONLINE', amountCents: -2599 }, defaultRules(), history.slice(2))).toMatchObject({ categoryId: 'subscriptions.cloud', confidence: 'low' });
  });

  it('learns separate rules for money in and money out, using the shared part of the name', () => {
    const at = (n: number) => `2026-0${n}-01T00:00:00Z`;
    const s = suggestRules([
      { description: PAY, fromCategoryId: null, toCategoryId: 'income.salary', at: at(1), amountCents: 500000 },
      { description: PAY_2, fromCategoryId: null, toCategoryId: 'income.salary', at: at(2), amountCents: 500000 },
      { description: MARKETPLACE, fromCategoryId: null, toCategoryId: 'shopping.household', at: at(3), amountCents: -2000 },
      { description: 'Card Purchase PAYW BIGRIVER MKTPLC AU SYDNEY 150526', fromCategoryId: null, toCategoryId: 'shopping.household', at: at(4), amountCents: -3500 },
    ], defaultRules());
    expect(s.map((x) => [x.pattern, x.direction, x.categoryId]).sort()).toEqual([
      ['BIGRIVER H G', 'in', 'income.salary'],
      ['BIGRIVER MKTPLC', 'out', 'shopping.household'],
    ]);
  });
});

describe('rules learned before this release', () => {
  it('are limited to the direction of their category, and purchases they caught are re-categorised', async () => {
    const ctx = await testCtx('2026-10-12');
    const acc = saveAccount(ctx, { name: 'Everyday', type: 'transaction' });
    const ruleId = createRule(ctx, { field: 'description', matchType: 'contains', pattern: 'BIGRIVER', categoryId: 'income.salary', source: 'learned', direction: 'any', priority: 0, enabled: true });
    const purchase = addManualTransaction(ctx, { accountId: acc, date: '2026-04-12', amountCents: -4599, description: MARKETPLACE });
    const pay = addManualTransaction(ctx, { accountId: acc, date: '2026-04-15', amountCents: 500000, description: PAY });
    ctx.db.run("UPDATE transactions SET category_id = 'income.salary', category_source = 'rule', rule_id = ? WHERE id IN (?, ?)", [ruleId, purchase.id, pay.id]);
    expect(repairLearnedRules(ctx)).toEqual({ rules: 1, recategorised: 1 });
    expect(ctx.db.scalar('SELECT direction FROM rules WHERE id = ?', [ruleId])).toBe('in');
    const rows = new Map(listTransactions(ctx, { accountId: acc }).rows.map((t) => [t.id, t.categoryId]));
    expect(rows.get(purchase.id)).toBeNull(); // left for the person to choose
    expect(rows.get(pay.id)).toBe('income.salary');
    expect(repairLearnedRules(ctx)).toEqual({ rules: 0, recategorised: 0 });
  });

  it('new learned rules are created for money in or out only', async () => {
    const ctx = await testCtx('2026-10-12');
    const acc = saveAccount(ctx, { name: 'Everyday', type: 'transaction' });
    ctx.db.run("INSERT INTO settings(key, value) VALUES('autoLearnRules', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'");
    const pays = [['2026-01-29', PAY], ['2026-02-28', PAY_2]].map(([d, desc]) => addManualTransaction(ctx, { accountId: acc, date: d, amountCents: 500000, description: desc }));
    for (const t of pays) updateTransaction(ctx, t.id, { categoryId: 'income.salary' });
    const learned = ctx.db.get("SELECT pattern, direction FROM rules WHERE source = 'learned'");
    expect(learned).toMatchObject({ pattern: 'BIGRIVER H G', direction: 'in' });
    expect(makeCategoriser(ctx).suggest({ description: MARKETPLACE, amountCents: -4599, accountId: acc }).categoryId).not.toBe('income.salary');
  });
});

describe('tax-deductible expense categories', () => {
  it('count as deductions in the tax estimate, with their tax return labels', async () => {
    const ctx = await testCtx('2026-10-12');
    const acc = saveAccount(ctx, { name: 'Everyday', type: 'transaction' });
    const before = taxEstimate(ctx, '2025-26').deductionsCents;
    addManualTransaction(ctx, { accountId: acc, date: '2025-08-02', amountCents: -4550, description: 'EXAMPLE STATIONERY CO', categoryId: 'deductions.stationery' });
    addManualTransaction(ctx, { accountId: acc, date: '2025-09-10', amountCents: -89000, description: 'SAMPLE TRAINING ACADEMY', categoryId: 'deductions.self-education' });
    // Marked "not tax-related": left out even though it is in a deduction category.
    const personal = addManualTransaction(ctx, { accountId: acc, date: '2025-09-12', amountCents: -2000, description: 'EXAMPLE STATIONERY CO', categoryId: 'deductions.stationery' });
    updateTransaction(ctx, personal.id, { taxClass: 'none' });
    // A phone bill split into a work share and a private share.
    const phone = addManualTransaction(ctx, { accountId: acc, date: '2025-10-01', amountCents: -10000, description: 'MOBILE SAMPLE TELCO' });
    setSplits(ctx, phone.id, [{ categoryId: 'deductions.phone-internet', amountCents: -4000 }, { categoryId: 'utilities.mobile', amountCents: -6000 }]);
    // A category the person added under Tax-deductible expenses.
    const custom = saveCategory(ctx, { name: 'Safety boots', parentId: 'deductions', kind: 'expense', nature: 'variable' });
    addManualTransaction(ctx, { accountId: acc, date: '2025-11-03', amountCents: -15000, description: 'WORKWEAR SAMPLE STORE', categoryId: custom });
    // Marked deductible outside these categories.
    const marked = addManualTransaction(ctx, { accountId: acc, date: '2025-12-01', amountCents: -3300, description: 'INSTITUTE OF EXAMPLE PROFESSIONALS' });
    updateTransaction(ctx, marked.id, { taxClass: 'deductible' });

    const items = deductionItems(ctx, '2025-26');
    expect(items.map((i) => [i.label, i.amountCents, i.basis])).toEqual([
      ['D5', 4550, 'category'], ['D4', 89000, 'category'], ['D5', 4000, 'split'], ['D5', 15000, 'category'], ['Other', 3300, 'marked'],
    ]);
    const e = taxEstimate(ctx, '2025-26');
    expect(e.deductionsCents - before).toBe(4550 + 89000 + 4000 + 15000 + 3300);
    expect(e.sourceLines.find((l) => l.label === 'Deductions')?.basis).toMatch(/D4 \$890\.00, D5 \$235\.50, other \$33\.00/);
  });
});
