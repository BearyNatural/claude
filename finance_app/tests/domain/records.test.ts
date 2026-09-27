import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { dividendTotals, frankingCreditFor, holdings, parcelsAndDisposals, tradeValueCents } from '@domain/investments';
import { capitalGains } from '@domain/tax/cgt';
import { projectSuper, superYearSummary } from '@domain/superannuation';
import { latestBalance, netWorth, netWorthHistory } from '@domain/accounts';
import { matchesSearch, parseSearch } from '@domain/search';
import { toCsv, csvEscape } from '@domain/output/csv';
import { workbookToXlsx } from '@domain/output/xlsx';
import { budgetVsActualSheet, spendingByCategorySheet, taxSheet, transactionsSheet, loanSheet } from '@domain/output/sheets';

describe('investments', () => {
  const secs = [{ id: 'VAS', code: 'VAS', name: 'Example Index Fund', kind: 'etf' as const }];
  const trades = [
    { id: 'b1', securityId: 'VAS', date: '2024-03-01', type: 'buy' as const, quantity: 100, unitPriceCents: 9000, brokerageCents: 995 },
    { id: 'b2', securityId: 'VAS', date: '2025-03-01', type: 'buy' as const, quantity: 50, unitPriceCents: 10000, brokerageCents: 995 },
    { id: 's1', securityId: 'VAS', date: '2026-02-01', type: 'sell' as const, quantity: 120, unitPriceCents: 11000, brokerageCents: 995 },
  ];

  it('values trades including brokerage', () => {
    expect(tradeValueCents(trades[0])).toBe(900995);
    expect(tradeValueCents(trades[2])).toBe(1320000 - 995);
  });

  it('works out remaining holdings with FIFO cost and dated manual valuations', () => {
    const h = holdings(secs, trades, [{ securityId: 'VAS', date: '2026-09-01', unitPriceCents: 11500 }], '2026-09-27');
    expect(h[0].quantity).toBe(30);
    expect(h[0].costBaseCents).toBe(Math.round((500995 * 30) / 50));
    expect(h[0].valueCents).toBe(345000);
    expect(h[0].valuationSource).toBe('manual');
  });

  it('feeds the CGT calculation', () => {
    const { parcels, disposals } = parcelsAndDisposals(trades);
    const res = capitalGains(parcels, disposals, '2025-26');
    expect(res.events).toHaveLength(2);
    expect(res.netCapitalGainCents).not.toBeNull();
  });

  it('only counts franking credits from dividend statements', () => {
    const t = dividendTotals([
      { id: 'd1', securityId: 'VAS', paymentDate: '2025-10-01', cashCents: 70000, frankedCents: 70000, unfrankedCents: 0, frankingCreditsCents: 30000, fromStatement: true },
      { id: 'd2', securityId: 'VAS', paymentDate: '2026-04-01', cashCents: 50000, frankedCents: 0, unfrankedCents: 0, frankingCreditsCents: 0, fromStatement: false },
    ], '2025-26');
    expect(t.frankingCreditsCents).toBe(30000);
    expect(t.unfrankedCents).toBe(50000);
    expect(t.explanation).toMatch(/never inferred from cash received/);
    expect(frankingCreditFor(70000)).toBe(30000);
  });
});

describe('superannuation', () => {
  it('summarises contributions against caps for information', () => {
    const s = superYearSummary([
      { id: '1', accountId: 's', date: '2026-08-01', kind: 'employer', amountCents: 250000 },
      { id: '2', accountId: 's', date: '2026-09-01', kind: 'salary-sacrifice', amountCents: 100000 },
      { id: '3', accountId: 's', date: '2026-09-01', kind: 'fees', amountCents: -2000 },
    ], '2026-27');
    expect(s.concessionalTotalCents).toBe(350000);
    expect(s.concessionalCapCents).toBe(3250000);
    expect(s.feesCents).toBe(2000);
    expect(s.notes[0]).toMatch(/information only/);
  });

  it('projects with the user’s own assumptions', () => {
    const p = projectSuper({ startingBalanceCents: 10000000, annualConcessionalCents: 1200000, contributionsTaxPercent: 15, annualNonConcessionalCents: 0, returnPercent: 0, annualFeesCents: 0, years: 2, contributionGrowthPercent: 0 });
    expect(p.finalCents).toBe(10000000 + 2 * 1020000);
    expect(p.assumptions.join(' ')).toMatch(/not advice/);
  });
});

describe('balances and net worth', () => {
  it('turns a statement balance plus later transactions into a dated calculated balance', () => {
    const b = latestBalance('a', [{ accountId: 'a', date: '2026-08-31', balanceCents: 100000, source: 'imported' }], [{ date: '2026-09-05', amountCents: -2000 }, { date: '2026-09-19', amountCents: 50000 }], '2026-09-27');
    expect(b).toMatchObject({ balanceCents: 148000, source: 'calculated', date: '2026-09-19', ageDays: 8, stale: false });
    expect(b?.label).toBe('Calculated · last updated 19 Sep 2026');
    const old = latestBalance('a', [{ accountId: 'a', date: '2026-06-30', balanceCents: 1, source: 'imported' }], [], '2026-09-27');
    expect(old?.stale).toBe(true);
  });

  it('adds assets and liabilities with notes about missing and manual values', () => {
    const nw = netWorth([
      { accountId: 'a', name: 'Everyday', type: 'transaction', balance: { accountId: 'a', date: '2026-09-19', balanceCents: 500000, source: 'imported', ageDays: 8, stale: false, label: '' } },
      { accountId: 'h', name: 'Home', type: 'property', balance: { accountId: 'h', date: '2026-01-01', balanceCents: 80000000, source: 'estimated', ageDays: 269, stale: true, label: '' } },
      { accountId: 'm', name: 'Mortgage', type: 'mortgage', balance: { accountId: 'm', date: '2026-09-01', balanceCents: -45000000, source: 'imported', ageDays: 26, stale: false, label: '' } },
      { accountId: 'c', name: 'Card', type: 'credit-card', balance: null },
    ]);
    expect(nw.totalAssetsCents).toBe(80500000);
    expect(nw.totalLiabilitiesCents).toBe(45000000);
    expect(nw.netCents).toBe(35500000);
    expect(nw.notes.join(' ')).toMatch(/Card/);
    expect(nw.notes.join(' ')).toMatch(/entered or estimated/);
  });

  it('builds a month-end history from known balances', () => {
    const h = netWorthHistory([{ id: 'a', type: 'savings' }, { id: 'm', type: 'mortgage' }], [
      { accountId: 'a', date: '2026-07-15', balanceCents: 1000, source: 'imported' },
      { accountId: 'm', date: '2026-07-01', balanceCents: -500, source: 'imported' },
      { accountId: 'a', date: '2026-08-20', balanceCents: 3000, source: 'imported' },
    ], '2026-07-01', '2026-08-31');
    expect(h.map((x) => x.netCents)).toEqual([500, 2500]);
    expect(h.map((x) => x.accountsMissing)).toEqual([0, 0]);
    const early = netWorthHistory([{ id: 'a', type: 'savings' }, { id: 'm', type: 'mortgage' }], [{ accountId: 'a', date: '2026-07-15', balanceCents: 1000, source: 'imported' }], '2026-07-01', '2026-07-31');
    expect(early[0].accountsMissing).toBe(1);
  });
});

describe('search', () => {
  const today = '2026-09-27';
  const cats = ['Electricity', 'Groceries', 'Dividends & distributions'];

  it('understands the example questions', () => {
    const a = parseSearch('Show all electricity payments during the last three years.', today, cats);
    expect(a.filter.categoryNames).toEqual(['Electricity']);
    expect(a.filter.from).toBe('2023-09-27');
    expect(a.filter.text).toEqual([]);
    const b = parseSearch('Show transactions over $500.', today, cats);
    expect(b.filter.minAbsCents).toBe(50000);
    expect(b.chips).toContain('Amount over $500.00');
    const c = parseSearch('Show all Woolworths transactions.', today, cats);
    expect(c.filter.text).toEqual(['Woolworths']);
    const d = parseSearch('Show all deductible business expenses marked for FY2026–27.', today, cats);
    expect(d.filter).toMatchObject({ deductible: true, business: true, direction: 'out', from: '2026-07-01', to: '2027-06-30' });
    const e = parseSearch('Show dividend income this financial year.', today, cats);
    expect(e.filter.incomeTypes).toContain('dividends');
    expect(e.filter.direction).toBe('in');
    expect(e.filter.from).toBe('2026-07-01');
    const f = parseSearch('Show every transaction tagged "property".', today, cats);
    expect(f.filter.tags).toEqual(['property']);
  });

  it('filters transactions', () => {
    const { filter } = parseSearch('woolworths over $100 last 6 months', today, cats);
    const tx = { date: '2026-09-01', amountCents: -12643, description: 'WOOLWORTHS 1234', accountName: 'Everyday', tags: [] };
    expect(matchesSearch(tx, filter)).toBe(true);
    expect(matchesSearch({ ...tx, amountCents: -5000 }, filter)).toBe(false);
    expect(matchesSearch({ ...tx, date: '2026-01-01' }, filter)).toBe(false);
  });
});

describe('CSV and XLSX output', () => {
  it('escapes CSV and neutralises formula injection', () => {
    expect(csvEscape('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvEscape('-12 shop')).toBe("'-12 shop");
    expect(csvEscape(-12.5)).toBe('-12.5');
    expect(csvEscape('a,b')).toBe('"a,b"');
    const csv = toCsv(['Date', 'Amount'], [['2026-09-01', -126.43]]);
    expect(csv).toBe('﻿Date,Amount\r\n2026-09-01,-126.43\r\n');
  });

  it('writes an XLSX workbook with values, dates and formulas that other programs can read', () => {
    const tx = transactionsSheet([
      { date: '2026-09-01', account: 'Everyday', description: 'WOOLWORTHS', payee: 'Woolworths', category: 'Groceries', group: 'Food', amountCents: -12643, type: 'Expense', incomeType: '', tags: '', business: 'Personal', notes: '' },
      { date: '2026-09-03', account: 'Everyday', description: 'PAYROLL', payee: 'Employer', category: 'Salary & wages', group: 'Income', amountCents: 410217, type: 'Income', incomeType: 'Salary', tags: '', business: '', notes: '' },
    ]);
    const exp = spendingByCategorySheet([{ group: 'Food', category: 'Groceries' }], 2);
    const bva = budgetVsActualSheet('September 2026', [{ category: 'Groceries', budgetCents: 90000, actualCents: 84200 }]);
    const tax = taxSheet('2026–27', [{ label: 'Salary', amountCents: 9000000 }], 9000000, [{ over: 18200, rate: 0.15 }, { over: 45000, rate: 0.3 }, { over: 135000, rate: 0.37 }, { over: 190000, rate: 0.45 }], 'Estimate only', []);
    const loan = loanSheet('Mortgage', { principalCents: 50000000, ratePercent: 6, repaymentCents: 299776, frequency: 'Monthly', offsetCents: 0, payoffDate: '2056-10-01', totalInterestCents: 1 }, [{ year: 1, endDate: '2027-09-30', openingCents: 50000000, interestCents: 2990000, principalCents: 600000, closingCents: 49400000 }], []);
    const bytes = workbookToXlsx({ title: 'Test workbook', createdAt: '2026-09-27', sheets: [tx, exp, bva, tax, loan] });
    // Formula cells carry no cached value (the workbook recalculates on open), so read stubs too.
    const wb = XLSX.read(bytes, { type: 'array', cellFormula: true, cellNF: true, sheetStubs: true });
    expect(wb.SheetNames).toEqual(['About', 'Transactions', 'Expenses', 'Budget vs Actual', 'Tax Estimate', 'Mortgage']);
    const t = wb.Sheets.Transactions;
    expect(t.A1.v).toBe('Date');
    expect(t.A2.v).toBe(46266); // 1 Sep 2026 as an Excel serial date
    expect(t.A2.z).toBe('dd mmm yyyy');
    expect(t.G2.v).toBe(-126.43);
    expect(wb.Sheets.Expenses.C2.f).toBe('-SUMIFS(Transactions!$G$2:$G$3,Transactions!$E$2:$E$3,B2,Transactions!$H$2:$H$3,"Expense")');
    expect(wb.Sheets['Budget vs Actual'].D2.f).toBe('B2-C2');
    expect(wb.Sheets['Budget vs Actual'].B3.f).toBe('SUM(B2:B2)');
    const taxWs = wb.Sheets['Tax Estimate'];
    expect(taxWs.B4.v).toBe(90000);
    expect(taxWs.B10.f).toBe('SUMPRODUCT((B4>A6:A9)*(B4-A6:A9)*C6:C9)');
    expect(wb.Sheets.Mortgage.B6.f).toBe('PMT(B3/12,360,-(B2-B5))');
    expect(wb.Sheets.Mortgage.E11.f).toBe('C11-F11');
  });
});
