import { describe, expect, it } from 'vitest';
import { extractPdfText } from '@main/import/pdfExtract';
import { parsePdfStatement, findStatementPeriod } from '@domain/import/pdfStatement';
import { reconcile } from '@domain/import/reconcile';
import { AUGUST_ROWS, makeImageOnlyPdf, makePdf, statementLayout } from '../helpers/pdf';

async function parse(items: Parameters<typeof makePdf>[0], opts = {}) {
  const pdf = await makePdf(items);
  const { pages } = await extractPdfText(pdf);
  return parsePdfStatement(pages, opts);
}

describe('PDF statement import', () => {
  it('extracts period, balances and transactions and reconciles', async () => {
    const st = await parse([statementLayout({
      period: '1 August 2026 to 31 August 2026', opening: '$6,510.00', closing: '$5,688.80', rows: AUGUST_ROWS,
    })]);
    expect(st.periodStart).toBe('2026-08-01');
    expect(st.periodEnd).toBe('2026-08-31');
    expect(st.openingBalanceCents).toBe(651000);
    expect(st.closingBalanceCents).toBe(568880);
    expect(st.account?.number).toBe('12345678');
    expect(st.transactions.map((t) => [t.date, t.amountCents])).toEqual([
      ['2026-08-02', -12643], ['2026-08-03', 410217], ['2026-08-04', -8220], ['2026-08-10', -400000],
      ['2026-08-15', -41260], ['2026-08-20', 123], ['2026-08-28', -30337],
    ]);
    // Wrapped description lines are joined to the transaction above.
    expect(st.transactions[2].description).toBe('EFTPOS 8837 CARD XX1234 VALUE DATE 03/08');
    expect(st.transactions.every((t) => t.confidence === 'high')).toBe(true);
    // PDF imports are never marked high confidence overall — the user always reviews them.
    expect(st.confidence).toBe('medium');
    const r = reconcile({ openingCents: st.openingBalanceCents, closingCents: st.closingBalanceCents, transactions: st.transactions });
    expect(r.status).toBe('reconciled');
  });

  it('flags a misread row through the running balance', async () => {
    const rows = AUGUST_ROWS.map((r) => (r.desc === 'POWERCO ENERGY BPAY' ? { ...r, debit: '421.60' } : r));
    const st = await parse([statementLayout({ period: '1 August 2026 to 31 August 2026', opening: '$6,510.00', closing: '$5,688.80', rows })]);
    const energy = st.transactions.find((t) => t.description.startsWith('POWERCO'))!;
    expect(energy.confidence).not.toBe('high');
    expect(energy.issues.join(' ')).toMatch(/running balance/i);
    const r = reconcile({ openingCents: st.openingBalanceCents, closingCents: st.closingBalanceCents, transactions: st.transactions });
    expect(r.status).toBe('difference');
    expect(r.differenceCents).toBe(900);
  });

  it('uses the balance to decide money in/out when there are no column headings', async () => {
    const rows = AUGUST_ROWS.slice(0, 3).map((r) => ({ date: r.date, desc: r.desc, debit: r.debit ?? r.credit, balance: r.balance }));
    const st = await parse([statementLayout({ period: '1 August 2026 to 31 August 2026', opening: '$6,510.00', rows, withHeader: false })]);
    expect(st.transactions.map((t) => t.amountCents)).toEqual([-12643, 410217, -8220]);
    expect(st.warnings.join(' ')).toMatch(/No column headings/);
  });

  it('treats card statement balances as amounts owed', async () => {
    const rows = [
      { date: '05 Sep', desc: 'BOOKSHOP', debit: '25.00', balance: '525.00' },
      { date: '09 Sep', desc: 'PAYMENT THANK YOU', credit: '500.00', balance: '25.00' },
    ];
    const st = await parse([statementLayout({ period: '1 September 2026 to 30 September 2026', opening: '$500.00', closing: '$25.00', rows })], { balanceMeaning: 'liability' });
    expect(st.openingBalanceCents).toBe(-50000);
    expect(st.transactions.map((t) => t.amountCents)).toEqual([-2500, 50000]);
    expect(reconcile({ openingCents: st.openingBalanceCents, closingCents: st.closingBalanceCents, transactions: st.transactions }).status).toBe('reconciled');
  });

  it('recognises a scanned PDF and does not invent data', async () => {
    const { pages } = await extractPdfText(await makeImageOnlyPdf());
    const st = parsePdfStatement(pages);
    expect(st.ocrRequired).toBe(true);
    expect(st.transactions).toHaveLength(0);
    expect(st.confidence).toBe('low');
    expect(st.warnings[0]).toMatch(/scanned/);
  });

  it('rejects files that are not PDFs', async () => {
    await expect(extractPdfText(new TextEncoder().encode('not a pdf'))).rejects.toThrow(/could not be opened/);
  });

  it('finds statement periods written different ways', () => {
    expect(findStatementPeriod('Period: 01/07/2026 - 31/07/2026')).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    expect(findStatementPeriod('1 August – 31 August 2026')).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    expect(findStatementPeriod('15 December – 14 January 2027')).toEqual({ start: '2026-12-15', end: '2027-01-14' });
  });
});
