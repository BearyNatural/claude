import { ISODate, formatDate } from '../dates';
import { Cents } from '../money';
import { Cell, Sheet, Workbook, date, formula, money, pct, ref, sheetRef } from './workbook';

/**
 * Builders for the worksheets Paperbark can generate. Where it makes sense the cells are
 * real formulas (totals, differences, SUMIFS over the Transactions sheet) so the workbook
 * keeps working when the user edits it.
 */

export interface TxRow {
  date: ISODate;
  account: string;
  description: string;
  payee: string;
  category: string;
  group: string;
  amountCents: Cents;
  type: 'Income' | 'Expense' | 'Transfer';
  incomeType: string;
  tags: string;
  business: string;
  notes: string;
}

export const TX_SHEET = 'Transactions';
/** Column positions on the Transactions sheet (used by SUMIFS elsewhere). */
export const TX_COL = { date: 0, account: 1, description: 2, payee: 3, category: 4, group: 5, amount: 6, type: 7, incomeType: 8, tags: 9, business: 10, notes: 11 };

export function transactionsSheet(rows: TxRow[]): Sheet {
  return {
    name: TX_SHEET,
    freezeHeader: true,
    columns: [
      { header: 'Date', format: 'date', width: 12 }, { header: 'Account', width: 20 }, { header: 'Description', width: 40 },
      { header: 'Payee', width: 20 }, { header: 'Category', width: 22 }, { header: 'Group', width: 18 },
      { header: 'Amount', format: 'currency', width: 14 }, { header: 'Type', width: 10 }, { header: 'Income type', width: 16 },
      { header: 'Tags', width: 16 }, { header: 'Business use', width: 14 }, { header: 'Notes', width: 30 },
    ],
    rows: rows.map((r) => [date(r.date), r.account, r.description, r.payee, r.category, r.group, money(r.amountCents), r.type, r.incomeType, r.tags, r.business, r.notes]),
    notes: ['Amounts: money in is positive, money out is negative. Transfers between your own accounts are marked "Transfer" and excluded from income and spending totals.'],
  };
}

function txRange(col: number, rowsCount: number): string {
  const last = Math.max(2, rowsCount + 1);
  return `${sheetRef(TX_SHEET)}!${ref(col, 2, true)}:${ref(col, last, true)}`;
}

/** Totals by group/category computed live from the Transactions sheet. */
export function spendingByCategorySheet(categories: { group: string; category: string }[], txCount: number): Sheet {
  const amt = txRange(TX_COL.amount, txCount);
  const cat = txRange(TX_COL.category, txCount);
  const typ = txRange(TX_COL.type, txCount);
  const rows: Cell[][] = categories.map((c, i) => {
    const r = i + 2;
    return [c.group, c.category, formula(`-SUMIFS(${amt},${cat},${ref(1, r)},${typ},"Expense")`, 'currency'), formula(`IF(SUM($C$2:$C$${categories.length + 1})=0,0,${ref(2, r)}/SUM($C$2:$C$${categories.length + 1}))`, 'percent')];
  });
  rows.push(['Total', '', formula(`SUM(C2:C${categories.length + 1})`, 'currency'), null]);
  return {
    name: 'Expenses',
    freezeHeader: true,
    columns: [{ header: 'Group', width: 20 }, { header: 'Category', width: 26 }, { header: 'Spent', format: 'currency', width: 14 }, { header: 'Share', format: 'percent', width: 10 }],
    rows,
    notes: ['Expenses are SUMIFS formulas over the Transactions sheet, so they update if you edit or add transactions there.'],
  };
}

export function incomeSheet(sources: { label: string; incomeType: string }[], txCount: number): Sheet {
  const amt = txRange(TX_COL.amount, txCount);
  const it = txRange(TX_COL.incomeType, txCount);
  const typ = txRange(TX_COL.type, txCount);
  const rows: Cell[][] = sources.map((s, i) => [s.label, formula(`SUMIFS(${amt},${it},${ref(0, i + 2)},${typ},"Income")`, 'currency')]);
  rows.push(['Total', formula(`SUM(B2:B${sources.length + 1})`, 'currency')]);
  return {
    name: 'Income',
    columns: [{ header: 'Income type', width: 28 }, { header: 'Received (net, as deposited)', format: 'currency', width: 22 }],
    rows,
    notes: ['Salary deposits are net pay. Gross pay and tax withheld come from payslips (see the Tax Estimate sheet).'],
  };
}

export function dashboardSheet(periodLabel: string, txCount: number, balances: { account: string; balanceCents: Cents; source: string; date: ISODate | null }[]): Sheet {
  const amt = txRange(TX_COL.amount, txCount);
  const typ = txRange(TX_COL.type, txCount);
  const rows: Cell[][] = [
    ['Period', periodLabel, null, null],
    ['Income', formula(`SUMIFS(${amt},${typ},"Income")`, 'currency'), null, null],
    ['Expenses', formula(`-SUMIFS(${amt},${typ},"Expense")`, 'currency'), null, null],
    ['Net cash flow', formula('B3-B4', 'currency'), null, null],
    ['Savings rate', formula('IF(B3=0,0,(B3-B4)/B3)', 'percent'), null, null],
    [null, null, null, null],
    ['Account', 'Balance', 'How it is known', 'As at'],
    ...balances.map((b) => [b.account, money(b.balanceCents), b.source, date(b.date)] as Cell[]),
  ];
  return {
    name: 'Dashboard',
    columns: [{ header: 'Summary', width: 26 }, { header: 'Value', format: 'currency', width: 16 }, { header: '', width: 20 }, { header: '', format: 'date', width: 14 }],
    rows,
    notes: ['Balances are the latest known values with their dates — they are not live bank balances.'],
  };
}

export function budgetVsActualSheet(title: string, rows: { category: string; budgetCents: Cents; actualCents: Cents }[]): Sheet {
  const out: Cell[][] = rows.map((r, i) => {
    const n = i + 2;
    return [r.category, money(r.budgetCents), money(r.actualCents), formula(`B${n}-C${n}`, 'currency'), formula(`IF(B${n}=0,"",C${n}/B${n})`, 'percent')];
  });
  const last = rows.length + 1;
  out.push(['Total', formula(`SUM(B2:B${last})`, 'currency'), formula(`SUM(C2:C${last})`, 'currency'), formula(`B${last + 1}-C${last + 1}`, 'currency'), formula(`IF(B${last + 1}=0,"",C${last + 1}/B${last + 1})`, 'percent')]);
  return {
    name: 'Budget vs Actual',
    freezeHeader: true,
    columns: [{ header: 'Category', width: 26 }, { header: 'Budget', format: 'currency', width: 14 }, { header: 'Actual', format: 'currency', width: 14 }, { header: 'Difference (budget − actual)', format: 'currency', width: 24 }, { header: 'Used', format: 'percent', width: 10 }],
    rows: out,
    notes: [`${title}. A positive difference means spending was below the amount allocated.`],
  };
}

export function billsSheet(rows: { name: string; amountCents: Cents; frequency: string; perYear: number; nextDue: ISODate; account: string; autoPay: boolean }[]): Sheet {
  const out: Cell[][] = rows.map((r, i) => {
    const n = i + 2;
    return [r.name, money(r.amountCents), r.frequency, r.perYear, formula(`B${n}*D${n}`, 'currency'), formula(`E${n}/52`, 'currency'), formula(`E${n}/26`, 'currency'), formula(`E${n}/12`, 'currency'), date(r.nextDue), r.account, r.autoPay ? 'Yes' : 'No'];
  });
  const last = rows.length + 1;
  out.push(['Total', null, null, null, formula(`SUM(E2:E${last})`, 'currency'), formula(`SUM(F2:F${last})`, 'currency'), formula(`SUM(G2:G${last})`, 'currency'), formula(`SUM(H2:H${last})`, 'currency'), null, null, null]);
  return {
    name: 'Bills',
    freezeHeader: true,
    columns: [
      { header: 'Bill', width: 26 }, { header: 'Amount', format: 'currency' }, { header: 'Frequency' }, { header: 'Times a year', format: 'number' },
      { header: 'Per year', format: 'currency' }, { header: 'Per week', format: 'currency' }, { header: 'Per fortnight', format: 'currency' }, { header: 'Per month', format: 'currency' },
      { header: 'Next due', format: 'date' }, { header: 'Paid from', width: 18 }, { header: 'Automatic' },
    ],
    rows: out,
    notes: ['Per week / fortnight / month are planning amounts (the yearly cost spread evenly), not actual payments.'],
  };
}

export function goalsSheet(rows: { name: string; targetCents: Cents; currentCents: Cents; targetDate: ISODate | null; contributionCents: Cents; frequency: string; ratePercent: number; projectedDate: ISODate | null }[]): Sheet {
  return {
    name: 'Savings Goals',
    columns: [
      { header: 'Goal', width: 24 }, { header: 'Target', format: 'currency' }, { header: 'Saved', format: 'currency' }, { header: 'Remaining', format: 'currency' },
      { header: 'Progress', format: 'percent' }, { header: 'Target date', format: 'date' }, { header: 'Contribution', format: 'currency' }, { header: 'Frequency' },
      { header: 'Assumed interest', format: 'percent' }, { header: 'Projected date', format: 'date' },
    ],
    rows: rows.map((r, i) => {
      const n = i + 2;
      return [r.name, money(r.targetCents), money(r.currentCents), formula(`MAX(0,B${n}-C${n})`, 'currency'), formula(`IF(B${n}=0,1,MIN(1,C${n}/B${n}))`, 'percent'), date(r.targetDate), money(r.contributionCents), r.frequency, pct(r.ratePercent / 100), date(r.projectedDate)];
    }),
    notes: ['Projected dates assume the contribution and interest shown continue unchanged — not a guarantee.'],
  };
}

export function loanSheet(name: string, inputs: { principalCents: Cents; ratePercent: number; repaymentCents: Cents; frequency: string; offsetCents: Cents; payoffDate: ISODate | null; totalInterestCents: Cents }, years: { year: number; endDate: ISODate; openingCents: Cents; interestCents: Cents; principalCents: Cents; closingCents: Cents }[], notes: string[]): Sheet {
  const header: Cell[][] = [
    ['Loan balance', money(inputs.principalCents), null, null, null, null],
    ['Interest rate (assumed)', pct(inputs.ratePercent / 100), null, null, null, null],
    ['Repayment', money(inputs.repaymentCents), inputs.frequency, null, null, null],
    ['Offset balance', money(inputs.offsetCents), null, null, null, null],
    ['Check: monthly repayment over 30 years', formula('PMT(B3/12,360,-(B2-B5))', 'currency'), 'Standard formula, for reference', null, null, null],
    ['Estimated payoff', date(inputs.payoffDate), null, null, null, null],
    ['Estimated total interest', money(inputs.totalInterestCents), null, null, null, null],
    [null, null, null, null, null, null],
    ['Year', 'Year ending', 'Opening balance', 'Interest', 'Principal reduction', 'Closing balance'],
  ];
  const startRow = header.length + 2;
  const body: Cell[][] = years.map((y, i) => {
    const n = startRow + i;
    return [y.year, date(y.endDate), money(y.openingCents), money(y.interestCents), formula(`C${n}-F${n}`, 'currency'), money(y.closingCents)];
  });
  return {
    name,
    columns: [{ header: 'Item', width: 30 }, { header: 'Value', width: 16 }, { header: '', width: 16, format: 'currency' }, { header: '', width: 14, format: 'currency' }, { header: '', width: 18, format: 'currency' }, { header: '', width: 16, format: 'currency' }],
    rows: [...header, ...body],
    notes,
  };
}

export function termDepositsSheet(rows: { institution: string; principalCents: Cents; start: ISODate; maturity: ISODate; ratePercent: number; interestCents: Cents; maturityValueCents: Cents; frequency: string }[]): Sheet {
  return {
    name: 'Term Deposits',
    freezeHeader: true,
    columns: [
      { header: 'Institution', width: 22 }, { header: 'Principal', format: 'currency' }, { header: 'Start', format: 'date' }, { header: 'Maturity', format: 'date' },
      { header: 'Rate', format: 'percent' }, { header: 'Days', format: 'integer' }, { header: 'Simple interest check', format: 'currency' }, { header: 'Expected interest', format: 'currency' },
      { header: 'Expected at maturity', format: 'currency' }, { header: 'Interest paid' },
    ],
    rows: rows.map((r, i) => {
      const n = i + 2;
      return [r.institution, money(r.principalCents), date(r.start), date(r.maturity), pct(r.ratePercent / 100), formula(`D${n}-C${n}`, 'integer'), formula(`ROUND(B${n}*E${n}*F${n}/365,2)`, 'currency'), money(r.interestCents), money(r.maturityValueCents), r.frequency];
    }),
    notes: ['"Simple interest check" = principal × rate × days ÷ 365. Expected interest allows for compounding where interest is added to the deposit.'],
  };
}

export function holdingsSheet(rows: { code: string; name: string; quantity: number; costCents: Cents | null; valueCents: Cents | null; valuationDate: ISODate | null }[]): Sheet {
  return {
    name: 'Investments',
    columns: [
      { header: 'Code', width: 10 }, { header: 'Name', width: 28 }, { header: 'Units', format: 'number' }, { header: 'Cost base', format: 'currency' },
      { header: 'Value (manual)', format: 'currency' }, { header: 'Valued on', format: 'date' }, { header: 'Difference', format: 'currency' },
    ],
    rows: rows.map((r, i) => {
      const n = i + 2;
      return [r.code, r.name, r.quantity, r.costCents === null ? 'Unknown' : money(r.costCents), r.valueCents === null ? null : money(r.valueCents), date(r.valuationDate), formula(`IF(OR(D${n}="Unknown",E${n}=""),"",E${n}-D${n})`, 'currency')];
    }),
    notes: ['Values are prices you entered, with their dates. Paperbark does not fetch market prices.'],
  };
}

export function taxSheet(fyLabel: string, lines: { label: string; amountCents: Cents }[], taxableCents: Cents, brackets: { over: number; rate: number }[], disclaimer: string, sources: string[]): Sheet {
  const rows: Cell[][] = lines.map((l) => [l.label, money(l.amountCents), null]);
  // Spreadsheet rows: header=1, lines 2..L+1, blank L+2, taxable income L+3, bracket header L+4, brackets from L+5.
  const bracketStart = rows.length + 5;
  rows.push([null, null, null]);
  rows.push(['Taxable income (whole dollars)', money(taxableCents), null]);
  rows.push(['Tax threshold (over)', 'Rate', 'Rate increase']);
  brackets.forEach((b, i) => {
    const n = bracketStart + i;
    rows.push([b.over, pct(b.rate), i === 0 ? formula(`B${n}`, 'percent') : formula(`B${n}-B${n - 1}`, 'percent')]);
  });
  const tiRow = bracketStart - 2;
  const first = bracketStart;
  const lastB = bracketStart + brackets.length - 1;
  rows.push(['Income tax (formula, before offsets and levies)', formula(`SUMPRODUCT((B${tiRow}>A${first}:A${lastB})*(B${tiRow}-A${first}:A${lastB})*C${first}:C${lastB})`, 'currency'), null]);
  return {
    name: 'Tax Estimate',
    columns: [{ header: `Estimated tax position — ${fyLabel}`, width: 46 }, { header: 'Amount', format: 'currency', width: 16 }, { header: '', width: 14 }],
    rows,
    notes: [disclaimer, ...sources.map((s) => `Source: ${s}`)],
  };
}

export function forecastSheet(name: string, points: { date: ISODate; cashCents: Cents; investmentsCents: Cents; termDepositsCents: Cents; mortgageCents: Cents; netPositionCents: Cents }[], assumptions: string[]): Sheet {
  return {
    name,
    freezeHeader: true,
    columns: [{ header: 'Date', format: 'date' }, { header: 'Cash', format: 'currency' }, { header: 'Investments', format: 'currency' }, { header: 'Term deposits', format: 'currency' }, { header: 'Mortgage', format: 'currency' }, { header: 'Net position', format: 'currency' }],
    rows: points.map((p, i) => {
      const n = i + 2;
      return [date(p.date), money(p.cashCents), money(p.investmentsCents), money(p.termDepositsCents), money(p.mortgageCents), formula(`B${n}+C${n}+D${n}-E${n}`, 'currency')];
    }),
    notes: ['Forecast under the assumptions below — not a prediction.', ...assumptions],
  };
}

export function scenariosSheet(rows: { name: string; endCashCents: Cents; lowestCashCents: Cents; lowestDate: ISODate; positiveUntil: ISODate | null; sentence: string }[]): Sheet {
  return {
    name: 'Scenarios',
    columns: [{ header: 'Scenario', width: 24 }, { header: 'Cash at end', format: 'currency' }, { header: 'Lowest cash', format: 'currency' }, { header: 'Lowest on', format: 'date' }, { header: 'Cash below zero from', format: 'date' }, { header: 'Summary', width: 70 }],
    rows: rows.map((r) => [r.name, money(r.endCashCents), money(r.lowestCashCents), date(r.lowestDate), date(r.positiveUntil), r.sentence]),
    notes: ['Scenarios are compared side by side. No scenario is ranked or recommended.'],
  };
}

export function simpleSheet(name: string, columns: Sheet['columns'], rows: Cell[][], notes: string[] = []): Sheet {
  return { name, columns, rows, notes, freezeHeader: true };
}

/** The first sheet: what the workbook contains, when it was made, and the disclaimers. */
export function aboutSheet(wb: Workbook): Sheet {
  const rows: Cell[][] = [
    [wb.title],
    [`Created by Paperbark on ${formatDate(wb.createdAt, { long: true })}.`],
    ['This workbook is a copy of your data. It does not update from Paperbark and does not need Paperbark to open.'],
    ['Paperbark is a tracking and planning tool, not financial or tax advice.'],
    [null],
  ];
  for (const s of wb.sheets) {
    rows.push([`${s.name}`]);
    for (const n of s.notes ?? []) rows.push([`   ${n}`]);
  }
  return { name: 'About', columns: [{ header: 'About this workbook', width: 110 }], rows };
}
