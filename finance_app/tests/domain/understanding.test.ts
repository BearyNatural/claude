import { describe, expect, it } from 'vitest';
import { bestRule, defaultRules, ruleMatches, validateRegex, Rule } from '@domain/categorise/rules';
import { cleanDescription, guessPayee, merchantKey } from '@domain/categorise/clean';
import { suggestRules, suggestCategory } from '@domain/categorise/learning';
import { flattenCategories } from '@domain/categorise/categories';
import { findTransferPairs } from '@domain/transfers';
import { detectRecurring, classifyInterval } from '@domain/recurring';
import {
  AnalysisTx, CategoryMap, categoryTotals, comparePeriods, missingDataWarnings, periodTotals, spendingAverages,
  spreadCost, trueCostOfLiving, dataCoverage,
} from '@domain/analysis';
import { budgetVsActual, proposeBudget, sinkingFundPlan, upcomingBills, advanceBill, findBillPayment, Bill } from '@domain/budget';
import { addDays } from '@domain/dates';

function catMap(): CategoryMap {
  const m: CategoryMap = new Map();
  for (const c of flattenCategories()) m.set(c.key, { id: c.key, name: c.name, parentId: c.parentKey, kind: c.kind, nature: c.nature });
  return m;
}

const rules = defaultRules();

describe('description cleaning', () => {
  it('removes card noise but keeps the merchant', () => {
    expect(cleanDescription('VISA PURCHASE WOOLWORTHS 1234 PETRIE QLD AU Card xx1234 Value Date: 01/08/2026')).toBe('WOOLWORTHS 1234 PETRIE QLD');
    expect(cleanDescription('SQ *CORNER CAFE BRISBANE')).toBe('CORNER CAFE BRISBANE');
    expect(merchantKey('WOOLWORTHS 1234 PETRIE')).toBe('WOOLWORTHS');
    expect(merchantKey('WOOLWORTHS 5678 CHERMSIDE')).toBe('WOOLWORTHS');
    expect(merchantKey('NETFLIX.COM MELBOURNE')).toBe('NETFLIX');
    expect(guessPayee('EFTPOS PURCHASE BUNNINGS 123456 NORTH LAKES')).toBe('Bunnings');
    expect(guessPayee('SPOTIFY P092324')).toBe('Spotify');
    expect(guessPayee('7-ELEVEN 2291 KALLANGUR')).toBe('7-Eleven');
  });
});

describe('rules', () => {
  const subject = (description: string, amountCents = -1000) => ({ description, amountCents });

  it('categorises common Australian merchants with an explanation', () => {
    expect(bestRule(rules, subject('WOOLWORTHS 1234 PETRIE'))?.rule.categoryId).toBe('food.groceries');
    expect(bestRule(rules, subject('AGL SALES PTY LTD'))?.rule.categoryId).toBe('utilities.electricity');
    expect(bestRule(rules, subject('SPOTIFY P0123'))?.rule.categoryId).toBe('subscriptions.streaming');
    expect(bestRule(rules, subject('COLES EXPRESS 1234'))?.rule.categoryId).toBe('transport.fuel');
    expect(bestRule(rules, subject('UBER *EATS HELP.UBER.COM'))?.rule.categoryId).toBe('food.takeaway');
    expect(bestRule(rules, subject('AUTO & GENERAL PAYROLL', 410217))?.rule).toMatchObject({ categoryId: 'income.salary', incomeType: 'salary' });
    expect(bestRule(rules, subject('BANK INTEREST', 123))?.rule.incomeType).toBe('interest');
    expect(bestRule(rules, subject('BHP DIVIDEND', 5000))?.rule.incomeType).toBe('dividends');
    expect(bestRule(rules, subject('WOOLWORTHS 1234'))?.explanation).toMatch(/built-in rule: Description contains "WOOLWORTHS"/);
  });

  it('matches short patterns only as whole words', () => {
    expect(bestRule(rules, subject('BP NORTH LAKES'))?.rule.categoryId).toBe('transport.fuel');
    expect(bestRule(rules, subject('BPAY BILL PAYMENT'))?.rule.categoryId).not.toBe('transport.fuel');
    expect(bestRule(rules, subject('BRIGADE KITCHEN'))?.rule.categoryId).not.toBe('food.groceries');
  });

  it('respects direction', () => {
    expect(bestRule(rules, subject('ATO PAYMENT', -50000))?.rule.categoryId).toBe('taxes');
    expect(bestRule(rules, subject('ATO 012345', 120000))?.rule.categoryId).toBe('income.refunds');
  });

  it('lets user rules win over built-in rules', () => {
    const mine: Rule = { id: 'u1', field: 'description', matchType: 'contains', pattern: 'WOOLWORTHS', categoryId: 'shopping.household', source: 'user', priority: 0, enabled: true };
    const m = bestRule([...rules, mine], subject('WOOLWORTHS 1234'));
    expect(m?.rule.id).toBe('u1');
    expect(m?.explanation).toMatch(/your rule/);
    expect(ruleMatches({ ...mine, enabled: false }, subject('WOOLWORTHS'))).toBe(false);
  });

  it('supports amount and account conditions', () => {
    const r: Rule = { id: 'u2', field: 'description', matchType: 'wildcard', pattern: 'TRANSFER*SAVINGS', amountMinCents: 50000, accountId: 'acc1', categoryId: 'savings.contributions', source: 'user', priority: 0, enabled: true };
    expect(ruleMatches(r, { description: 'TRANSFER TO SAVINGS', amountCents: -100000, accountId: 'acc1' })).toBe(true);
    expect(ruleMatches(r, { description: 'TRANSFER TO SAVINGS', amountCents: -1000, accountId: 'acc1' })).toBe(false);
    expect(ruleMatches(r, { description: 'TRANSFER TO SAVINGS', amountCents: -100000, accountId: 'acc2' })).toBe(false);
  });

  it('refuses slow or invalid regular expressions', () => {
    expect(validateRegex('(a+)+$')).toMatch(/Nested/);
    expect(validateRegex('[unclosed')).toMatch(/not a valid/);
    expect(validateRegex('^AGL\\s+(SALES|ENERGY)')).toBeNull();
  });
});

describe('learning from corrections', () => {
  it('suggests a rule after repeated identical corrections', () => {
    const corrections = [
      { description: 'WOOLWORTHS PETRIE', fromCategoryId: 'other.uncategorised', toCategoryId: 'food.groceries', at: '2026-09-01' },
      { description: 'WOOLWORTHS 5678 CHERMSIDE', fromCategoryId: null, toCategoryId: 'food.groceries', at: '2026-09-08' },
    ];
    const s = suggestRules(corrections, []);
    expect(s).toEqual([expect.objectContaining({ pattern: 'WOOLWORTHS', categoryId: 'food.groceries', count: 2 })]);
    expect(suggestRules(corrections, [], { dismissedKeys: ['WOOLWORTHS→food.groceries'] })).toEqual([]);
    expect(suggestRules(corrections.slice(0, 1), [])).toEqual([]);
  });

  it('does not suggest when recent corrections disagree', () => {
    const corrections = [
      { description: 'KMART 1', fromCategoryId: null, toCategoryId: 'shopping.household', at: '2026-09-01' },
      { description: 'KMART 2', fromCategoryId: null, toCategoryId: 'shopping.household', at: '2026-09-02' },
      { description: 'KMART 3', fromCategoryId: null, toCategoryId: 'shopping.clothing', at: '2026-09-03' },
    ];
    expect(suggestRules(corrections, [])).toEqual([]);
  });

  it('uses past manual choices and flags conflicts with built-in rules', () => {
    const fromHistory = suggestCategory({ description: 'LOCAL BUTCHER 22', amountCents: -3000 }, rules, [{ description: 'LOCAL BUTCHER 11', categoryId: 'food.groceries' }]);
    expect(fromHistory).toMatchObject({ categoryId: 'food.groceries', source: 'history', confidence: 'medium' });
    const conflict = suggestCategory({ description: 'KMART 44', amountCents: -3000 }, rules, [{ description: 'KMART 12', categoryId: 'children.clothing' }]);
    expect(conflict.confidence).toBe('low');
    expect(conflict.categoryId).toBe('children.clothing');
    const none = suggestCategory({ description: 'XYZZY 1', amountCents: -3000 }, rules, []);
    expect(none).toMatchObject({ categoryId: null, confidence: 'low' });
  });
});

describe('internal transfers', () => {
  it('pairs money out of one account with money into another', () => {
    const pairs = findTransferPairs([
      { id: 'a', accountId: 'everyday', date: '2026-09-10', amountCents: -100000, description: 'TRANSFER TO SAVINGS' },
      { id: 'b', accountId: 'savings', date: '2026-09-10', amountCents: 100000, description: 'TRANSFER FROM EVERYDAY' },
      { id: 'c', accountId: 'everyday', date: '2026-09-12', amountCents: -5000, description: 'SHOP' },
      { id: 'd', accountId: 'savings', date: '2026-09-20', amountCents: 5000, description: 'DEPOSIT' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ outId: 'a', inId: 'b', confidence: 'high' });
  });

  it('never pairs within the same account and prefers the best match', () => {
    const pairs = findTransferPairs([
      { id: 'a', accountId: 'x', date: '2026-09-10', amountCents: -2000, description: 'A' },
      { id: 'b', accountId: 'x', date: '2026-09-10', amountCents: 2000, description: 'B' },
      { id: 'c', accountId: 'card', date: '2026-09-11', amountCents: 2000, description: 'PAYMENT THANK YOU' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].inId).toBe('c');
  });
});

describe('recurring detection', () => {
  const series = (desc: string, start: string, stepDays: number, n: number, amount: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${desc}-${i}`, date: addDays(start, i * stepDays), amountCents: amount, description: `${desc} ${1000 + i}` }));

  it('classifies intervals', () => {
    expect(classifyInterval(7)).toBe('weekly');
    expect(classifyInterval(14)).toBe('fortnightly');
    expect(classifyInterval(28)).toBe('four-weekly');
    expect(classifyInterval(30.5)).toBe('monthly');
    expect(classifyInterval(91)).toBe('quarterly');
    expect(classifyInterval(365)).toBe('annually');
    expect(classifyInterval(50)).toBeNull();
  });

  it('finds salary, subscriptions and quarterly bills, and ignores irregular shopping', () => {
    const monthly = ['2026-04-15', '2026-05-15', '2026-06-15', '2026-07-15', '2026-08-15', '2026-09-15']
      .map((date, i) => ({ id: `n${i}`, date, amountCents: -2299, description: 'NETFLIX.COM', categoryId: 'subscriptions.streaming' }));
    const quarterly = ['2025-12-20', '2026-03-20', '2026-06-19', '2026-09-18']
      .map((date, i) => ({ id: `e${i}`, date, amountCents: -[41260, 38000, 45000, 43000][i], description: 'POWERCO ENERGY' }));
    const shop = [
      { id: 's1', date: '2026-08-01', amountCents: -5000, description: 'HARDWARE' },
      { id: 's2', date: '2026-08-19', amountCents: -12000, description: 'HARDWARE' },
      { id: 's3', date: '2026-09-25', amountCents: -800, description: 'HARDWARE' },
    ];
    const found = detectRecurring([...series('PAYROLL EXAMPLE', '2026-06-04', 14, 8, 410217), ...monthly, ...quarterly, ...shop], '2026-09-27');
    const byName = Object.fromEntries(found.map((f) => [f.key.split(':')[1], f]));
    expect(byName.NETFLIX.name).toBe('Netflix');
    expect(byName.PAYROLL).toMatchObject({ frequency: 'fortnightly', direction: 'in', confidence: 'high' });
    expect(byName.NETFLIX).toMatchObject({ frequency: 'monthly', nextExpected: '2026-10-15', looksLikeSubscription: true, annualCostCents: 27588 });
    expect(byName.POWERCO).toMatchObject({ frequency: 'quarterly', amountVaries: true });
    expect(byName.HARDWARE).toBeUndefined();
  });

  it('drops series that have stopped', () => {
    const old = series('GYM', '2025-01-01', 7, 10, -1500);
    expect(detectRecurring(old, '2026-09-27')).toEqual([]);
  });
});

const cats = catMap();
function tx(id: string, date: string, amount: number, categoryId: string | null, extra: Partial<AnalysisTx> = {}): AnalysisTx {
  return { id, accountId: 'everyday', date, amountCents: amount, description: id, categoryId, isTransfer: false, ...extra };
}

describe('historical analysis', () => {
  const txs: AnalysisTx[] = [
    tx('g1', '2026-07-03', -21000, 'food.groceries'),
    tx('g2', '2026-07-10', -23000, 'food.groceries'),
    tx('g3', '2026-07-17', -22000, 'food.groceries'),
    tx('g4', '2026-07-24', -24000, 'food.groceries'),
    tx('pay', '2026-07-09', 410217, 'income.salary', { incomeType: 'salary' }),
    tx('xfer', '2026-07-10', -100000, 'transfers.internal', { isTransfer: true }),
    tx('in', '2026-07-10', 100000, 'transfers.internal', { isTransfer: true, accountId: 'savings' }),
    tx('dept', '2026-07-20', -24000, null, { splits: [{ categoryId: 'food.groceries', amountCents: -9000 }, { categoryId: 'shopping.clothing', amountCents: -8000 }, { categoryId: 'shopping.household', amountCents: -7000 }] }),
    tx('tv', '2026-07-25', -150000, 'shopping.electronics', { isOneOff: true }),
    tx('rego', '2026-07-28', -96000, 'transport.registration'),
  ];
  const july = { start: '2026-07-01', end: '2026-07-31' };

  it('totals a period without counting transfers', () => {
    const t = periodTotals(txs, july, cats, new Set(['savings']));
    expect(t.incomeCents).toBe(410217);
    expect(t.expenseCents).toBe(90000 + 24000 + 150000 + 96000);
    expect(t.savingsCents).toBe(100000);
    expect(t.netCashFlowCents).toBe(410217 - 360000);
  });

  it('allocates split transactions to each category', () => {
    const totals = categoryTotals(txs, july, cats, { level: 'leaf' });
    expect(totals.find((t) => t.categoryId === 'food.groceries')?.totalCents).toBe(99000);
    expect(totals.find((t) => t.categoryId === 'shopping.clothing')?.totalCents).toBe(8000);
    const top = categoryTotals(txs, july, cats, { level: 'top' });
    expect(top.find((t) => t.categoryId === 'shopping')?.totalCents).toBe(8000 + 7000 + 150000);
  });

  it('calculates averages with a plain-language basis', () => {
    const a = spendingAverages(txs, { start: '2026-07-01', end: '2026-07-28' }, cats, 'food');
    expect(a.totalCents).toBe(99000);
    expect(a.perWeek).toBe(24750);
    expect(a.basis.transactionCount).toBe(5);
    expect(a.basis.description).toMatch(/Calculated from 5 transactions categorised as Food between 1 July 2026 and 28 July 2026/);
  });

  it('spreads annual costs into planning amounts', () => {
    expect(spreadCost(96000, 'annually')).toEqual({ annualCents: 96000, perWeekCents: 1846, perFortnightCents: 3692, perMonthCents: 8000 });
  });

  it('builds a true cost of living excluding one-offs', () => {
    const col = trueCostOfLiving(txs, { start: '2025-08-01', end: '2026-07-31' }, cats);
    const rego = col.items.find((i) => i.categoryId === 'transport.registration')!;
    expect(rego.annualCents).toBe(96000);
    expect(rego.perWeekCents).toBe(1846);
    expect(rego.regularity).toBe('irregular');
    expect(col.items.find((i) => i.categoryId === 'shopping.electronics')).toBeUndefined();
    expect(col.excludedOneOffCents).toBe(150000);
  });

  it('compares periods in neutral language and surfaces one-offs', () => {
    const aug = [...txs, tx('g5', '2026-08-05', -30000, 'food.groceries')];
    const c = comparePeriods(aug, { start: '2026-07-01', end: '2026-07-31', label: 'July' }, { start: '2026-08-01', end: '2026-08-31', label: 'August' }, cats);
    const food = c.rows.find((r) => r.categoryId === 'food')!;
    expect(food.sentence).toBe('Food was $690.00 higher in July than in August.');
    expect(c.oneOffs.a.map((t) => t.id)).toEqual(['tv']);
  });

  it('limits averages to the dates data covers', () => {
    expect(dataCoverage(txs, { start: '2026-01-01', end: '2026-12-31' })).toEqual({ start: '2026-07-03', end: '2026-07-28' });
  });

  it('warns about stale and missing data', () => {
    const w = missingDataWarnings([
      { accountId: 'cc', name: 'Credit card', type: 'credit-card', status: 'active', transactionDates: ['2026-03-05', '2026-05-20'], statementRanges: [] },
      { accountId: 'ev', name: 'Everyday', type: 'transaction', status: 'active', transactionDates: ['2026-07-02', '2026-09-20'], statementRanges: [{ start: '2026-07-01', end: '2026-07-31' }] },
    ], '2026-09-27');
    const text = w.map((x) => x.message).join(' | ');
    expect(text).toMatch(/No credit-card statements have been imported for Credit card after 20 May 2026/);
    expect(text).toMatch(/Apr 2026 is missing from Credit card/);
    expect(text).toMatch(/Aug 2026 is missing from Everyday/);
  });
});

describe('budgets', () => {
  const txs: AnalysisTx[] = [
    tx('g1', '2026-09-02', -40000, 'food.groceries'),
    tx('g2', '2026-09-16', -44200, 'food.groceries'),
    tx('f1', '2026-09-05', -34600, 'transport.fuel'),
    tx('m1', '2026-09-06', -5000, 'entertainment.events'),
  ];
  const budget = { id: 'b', name: 'Monthly', method: 'manual' as const, frequency: 'monthly' as const, lines: [
    { categoryId: 'food.groceries', amountCents: 90000 },
    { categoryId: 'transport.fuel', amountCents: 30000 },
  ] };

  it('compares budget and actual in neutral language', () => {
    const r = budgetVsActual(budget, txs, { start: '2026-09-01', end: '2026-09-30' }, cats, { periodMatchesFrequency: true });
    const g = r.rows.find((x) => x.categoryId === 'food.groceries')!;
    const f = r.rows.find((x) => x.categoryId === 'transport.fuel')!;
    expect(g).toMatchObject({ budgetCents: 90000, actualCents: 84200, differenceCents: 5800, status: 'below' });
    expect(f.sentence).toBe('Fuel was $46.00 above the amount allocated.');
    expect(r.rows.find((x) => x.categoryId === 'entertainment.events')?.inBudget).toBe(false);
    expect(r.rows.map((x) => x.sentence).join(' ')).not.toMatch(/overspent|bad|good/i);
  });

  it('pro-rates a period in progress and scales to other period lengths', () => {
    const r = budgetVsActual(budget, txs, { start: '2026-09-01', end: '2026-09-30' }, cats, { periodMatchesFrequency: true, today: '2026-09-15' });
    expect(r.elapsedFraction).toBeCloseTo(0.5);
    expect(r.rows[0].expectedToDateCents).toBe(45000);
    const week = budgetVsActual(budget, txs, { start: '2026-09-14', end: '2026-09-20' }, cats);
    expect(week.rows[0].budgetCents).toBe(Math.round(90000 * 7 / (365.25 / 12)));
  });

  it('proposes a historical budget', () => {
    const hist = [tx('a', '2026-06-01', -20000, 'food.groceries'), tx('b', '2026-06-30', -40000, 'food.groceries')];
    const p = proposeBudget(hist, { start: '2026-06-01', end: '2026-06-30' }, cats, 'monthly', ['food.groceries', 'transport.fuel']);
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0].amountCents).toBe(Math.ceil((60000 / 30) * (365.25 / 12) / 100) * 100);
  });

  it('plans sinking funds', () => {
    const p = sinkingFundPlan({ id: 's', name: 'Car registration', targetCents: 96000, savedCents: 20000, dueDate: '2027-03-27' }, '2026-09-27');
    expect(p.remainingCents).toBe(76000);
    expect(p.weeks).toBe(26);
    expect(p.perWeekCents).toBe(Math.ceil(76000 / 26));
    expect(p.perMonthCents).toBe(Math.ceil(76000 / 6));
    expect(sinkingFundPlan({ id: 's', name: 'x', targetCents: 100, savedCents: 100, dueDate: '2027-01-01' }, '2026-09-27').perWeekCents).toBe(0);
  });

  it('lists upcoming bills, advances them and spots payments', () => {
    const bill: Bill = { id: 'e', name: 'PowerCo energy', amountCents: 41260, frequency: 'quarterly', nextDue: '2026-10-15', autoPay: false, reminderDays: 5, active: true, matchText: 'POWERCO' };
    const up = upcomingBills([bill], '2026-09-27', 90);
    expect(up.map((u) => u.dueDate)).toEqual(['2026-10-15']);
    expect(advanceBill(bill)).toBe('2027-01-15');
    expect(findBillPayment(bill, [{ id: 't', date: '2026-10-14', amountCents: -41260, description: 'POWERCO ENERGY BPAY' }])?.id).toBe('t');
    expect(findBillPayment(bill, [{ id: 't', date: '2026-10-14', amountCents: -90000, description: 'POWERCO ENERGY BPAY' }])).toBeNull();
  });
});
