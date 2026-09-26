import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { applyMapping, detectMapping, mappingFromKinds, mappingKinds, readDelimited } from '@domain/import/csv';
import { detectDateFormat, parseDateAs, excelSerialToDate } from '@domain/import/dateFormats';
import { parseOfx, isOfx } from '@domain/import/ofx';
import { parseQif } from '@domain/import/qif';
import { readSpreadsheet } from '@domain/import/spreadsheet';
import { findDuplicates } from '@domain/import/duplicates';
import { reconcile } from '@domain/import/reconcile';

// All data below is fictional.

describe('date format detection', () => {
  it('prefers day-first for ambiguous Australian dates and says so', () => {
    const d = detectDateFormat(['01/08/2026', '02/08/2026', '03/08/2026']);
    expect(d?.format).toBe('DMY');
    expect(d?.confidence).toBe('medium');
    expect(d?.note).toBeTruthy();
  });

  it('is certain when a day is above 12', () => {
    expect(detectDateFormat(['13/08/2026', '02/08/2026'])).toMatchObject({ format: 'DMY', confidence: 'high' });
    expect(detectDateFormat(['08/13/2026', '08/02/2026'])?.format).toBe('MDY');
  });

  it('reads other common layouts', () => {
    expect(parseDateAs('2 Aug 2026', 'D-MON-Y')).toBe('2026-08-02');
    expect(parseDateAs('02-Aug-26', 'D-MON-Y')).toBe('2026-08-02');
    expect(parseDateAs('Aug 2, 2026', 'MON-D-Y')).toBe('2026-08-02');
    expect(parseDateAs('2026-08-02T10:00:00', 'YMD')).toBe('2026-08-02');
    expect(parseDateAs('02/08/2026 14:05', 'DMY')).toBe('2026-08-02');
    expect(parseDateAs('31/02/2026', 'DMY')).toBeNull();
    expect(excelSerialToDate(46236)).toBe('2026-08-02');
  });
});

describe('CSV import', () => {
  it('handles a headerless export with signed amounts and a running balance', () => {
    const csv = [
      '02/08/2026,"-126.43","WOOLWORTHS 1234 PETRIE QLD","+6383.57"',
      '03/08/2026,"+4102.17","PAYROLL EXAMPLE PTY LTD","+10485.74"',
      '04/08/2026,"-82.20","EFTPOS 8837 UNKNOWN","+10403.54"',
    ].join('\n');
    const rows = readDelimited(csv);
    const det = detectMapping(rows);
    expect(det.mapping).not.toBeNull();
    const m = det.mapping!;
    expect(m.headerRow).toBeNull();
    expect(m.date).toBe(0);
    expect(m.amount).toBe(1);
    expect(m.description).toEqual([2]);
    expect(m.balance).toBe(3);
    expect(det.questions.some((q) => /no column headings/i.test(q))).toBe(true);
    const st = applyMapping(rows, m);
    expect(st.transactions.map((t) => t.amountCents)).toEqual([-12643, 410217, -8220]);
    expect(st.transactions[0].description).toBe('WOOLWORTHS 1234 PETRIE QLD');
    expect(st.transactions.every((t) => t.confidence === 'high')).toBe(true);
  });

  it('handles separate debit and credit columns with a preamble', () => {
    const csv = [
      'Example Bank Everyday Account',
      'Account,062-000 1234 5678',
      '',
      'Date,Description,Debit,Credit,Balance',
      '01/08/2026,Opening balance,,,6510.00',
      '02/08/2026,WOOLWORTHS 1234,126.43,,6383.57',
      '03/08/2026,PAYROLL EXAMPLE,,"4,102.17",10485.74',
      'Total,,126.43,4102.17,',
    ].join('\r\n');
    const rows = readDelimited(csv);
    const det = detectMapping(rows);
    const m = det.mapping!;
    expect(m.amountMode).toBe('debit-credit');
    expect(rows[m.headerRow!][0]).toBe('Date');
    const st = applyMapping(rows, m);
    // "Opening balance" has no amount and is rejected rather than imported; "Total" is skipped silently.
    expect(st.transactions.map((t) => t.amountCents)).toEqual([-12643, 410217]);
    expect(st.rejectedRows).toHaveLength(1);
    expect(st.rejectedRows[0].reason).toMatch(/No amount/);
  });

  it('reads amounts with a DR/CR column', () => {
    const csv = [
      'Transaction Date,Details,Amount,Type,Balance',
      '05/09/2026,COFFEE CART,4.50,DR,995.50',
      '06/09/2026,REFUND STORE,20.00,CR,1015.50',
    ].join('\n');
    const rows = readDelimited(csv);
    const det = detectMapping(rows);
    expect(det.mapping?.amountMode).toBe('amount-with-indicator');
    const st = applyMapping(rows, det.mapping!);
    expect(st.transactions.map((t) => t.amountCents)).toEqual([-450, 2000]);
  });

  it('works out that positive card amounts are money out from the balance', () => {
    const csv = [
      'Date,Description,Amount,Balance',
      '01/09/2026,BOOKSHOP,25.00,-525.00',
      '02/09/2026,PETROL,60.00,-585.00',
      '03/09/2026,GROCER,40.00,-625.00',
    ].join('\n');
    const rows = readDelimited(csv);
    const det = detectMapping(rows);
    expect(det.mapping?.positiveIsCredit).toBe(false);
    const st = applyMapping(rows, det.mapping!);
    expect(st.transactions.map((t) => t.amountCents)).toEqual([-2500, -6000, -4000]);
  });

  it('asks when all amounts are positive and nothing settles the direction', () => {
    const rows = readDelimited('Date,Description,Amount\n01/09/2026,BOOKSHOP,25.00\n02/09/2026,PETROL,60.00');
    const det = detectMapping(rows);
    expect(det.questions.some((q) => /money out/i.test(q))).toBe(true);
    expect(det.confidence).toBe('low');
  });

  it('rejects malformed rows instead of guessing and flags balance breaks', () => {
    const csv = [
      'Date,Description,Amount,Balance',
      '01/09/2026,SHOP A,-10.00,90.00',
      'not a date,SHOP B,-5.00,85.00',
      '03/09/2026,SHOP C,abc,85.00',
      '04/09/2026,SHOP D,-20.00,60.00',
    ].join('\n');
    const rows = readDelimited(csv);
    const st = applyMapping(rows, detectMapping(rows).mapping!);
    expect(st.transactions).toHaveLength(2);
    expect(st.rejectedRows.map((r) => r.sourceRow)).toEqual([3, 4]);
    // 90 → 60 is a $30 move but the row says $20: flagged, not silently accepted.
    expect(st.transactions[1].issues.join(' ')).toMatch(/running balance/i);
    expect(st.transactions[1].confidence).toBe('medium');
    expect(st.warnings.join(' ')).toMatch(/could not be read/);
  });

  it('keeps the original row for provenance', () => {
    const rows = readDelimited('Date,Description,Amount\n01/09/2026,"SHOP, WITH COMMA",-10.00');
    const st = applyMapping(rows, detectMapping(rows).mapping!);
    expect(st.transactions[0].raw).toEqual({ Date: '01/09/2026', Description: 'SHOP, WITH COMMA', Amount: '-10.00' });
  });

  it('round-trips a mapping edited on the mapping screen', () => {
    const rows = readDelimited('Date,Processed,Narrative,Amount,Balance\n01/09/2026,02/09/2026,SHOP,-10.00,90.00');
    const det = detectMapping(rows);
    const kinds = mappingKinds(det.mapping!, det.columnCount);
    expect(kinds).toEqual(['date', 'processing-date', 'description', 'amount', 'balance']);
    const rebuilt = mappingFromKinds(kinds, { headerRow: 0, firstDataRow: 1, dateFormat: 'DMY' });
    const st = applyMapping(rows, rebuilt);
    expect(st.transactions[0]).toMatchObject({ date: '2026-09-01', processingDate: '2026-09-02', amountCents: -1000 });
    expect(() => mappingFromKinds(['ignore', 'description', 'amount'], { headerRow: 0, firstDataRow: 1, dateFormat: 'DMY' })).toThrow(/date/);
  });

  it('produces the same signature for the same export layout', () => {
    const a = detectMapping(readDelimited('Date,Description,Amount\n01/09/2026,A,-1.00'));
    const b = detectMapping(readDelimited('Date,Description,Amount\n05/10/2026,B,-2.00'));
    expect(a.signature).toBe(b.signature);
  });
});

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260901120000<LANGUAGE>ENG<FI><ORG>Example Bank</FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STMTRS>
<CURDEF>AUD
<BANKACCTFROM><BANKID>062000<ACCTID>12345678<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260801<DTEND>20260831
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260802120000[+10:AEST]<TRNAMT>-126.43<FITID>AUG-0001<NAME>WOOLWORTHS 1234<MEMO>PETRIE QLD</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260803<TRNAMT>4102.17<FITID>AUG-0002<NAME>PAYROLL EXAMPLE &amp; CO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260805<DTUSER>20260804<TRNAMT>-82.20<FITID>AUG-0003<NAME>EFTPOS 8837</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>10403.54<DTASOF>20260831</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const OFX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>AUD</CURDEF>
<CCACCTFROM><ACCTID>4000XXXXXXXX1234</ACCTID></CCACCTFROM>
<BANKTRANLIST><DTSTART>20260901</DTSTART><DTEND>20260930</DTEND>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260910</DTPOSTED><TRNAMT>-15.99</TRNAMT><FITID>CC1</FITID><NAME>STREAMING SERVICE</NAME></STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>-515.99</BALAMT><DTASOF>20260930</DTASOF></LEDGERBAL>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

describe('OFX / QFX import', () => {
  it('reads OFX 1.x SGML with unclosed tags', () => {
    expect(isOfx(OFX_SGML)).toBe(true);
    const [st] = parseOfx(OFX_SGML);
    expect(st.account).toMatchObject({ number: '12345678', institution: 'Example Bank' });
    expect(st.periodStart).toBe('2026-08-01');
    expect(st.transactions).toHaveLength(3);
    expect(st.transactions[0]).toMatchObject({ date: '2026-08-02', amountCents: -12643, externalId: 'AUG-0001', description: 'WOOLWORTHS 1234 — PETRIE QLD' });
    expect(st.transactions[1].description).toBe('PAYROLL EXAMPLE & CO');
    // DTUSER is the purchase date; DTPOSTED becomes the processing date.
    expect(st.transactions[2]).toMatchObject({ date: '2026-08-04', processingDate: '2026-08-05' });
    expect(st.closingBalanceCents).toBe(1040354);
    expect(st.openingBalanceCents).toBe(651000);
    expect(st.openingBalanceDerived).toBe(true);
  });

  it('reads OFX 2.x XML credit-card statements', () => {
    const [st] = parseOfx(OFX_XML, 'qfx');
    expect(st.format).toBe('qfx');
    expect(st.account?.type).toBe('CREDITCARD');
    expect(st.transactions[0].amountCents).toBe(-1599);
  });

  it('refuses investment-only OFX with a helpful message', () => {
    expect(() => parseOfx('<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1></OFX>')).toThrow(/investment/);
  });
});

describe('QIF import', () => {
  it('reads bank records and resolves day-first dates', () => {
    const qif = ['!Type:Bank', 'D13/08/2026', 'T-126.43', 'PWOOLWORTHS', 'LGroceries', '^', 'D14/08/2026', 'T4,102.17', 'PPAYROLL', 'MFortnightly pay', '^'].join('\n');
    const [st] = parseQif(qif);
    expect(st.transactions).toEqual([
      expect.objectContaining({ date: '2026-08-13', amountCents: -12643, payee: 'WOOLWORTHS', categoryHint: 'Groceries', confidence: 'high' }),
      expect.objectContaining({ date: '2026-08-14', amountCents: 410217, description: 'PAYROLL — Fortnightly pay' }),
    ]);
  });

  it("handles Quicken-style apostrophe years and flags ambiguity", () => {
    const qif = ['!Type:CCard', "D8/ 2'26", 'U-10.00', 'PSHOP', '^'].join('\n');
    const [st] = parseQif(qif);
    expect(st.transactions[0].date).toBe('2026-02-08');
    expect(st.transactions[0].confidence).toBe('medium');
    expect(st.warnings.join(' ')).toMatch(/day-first/i);
  });
});

describe('spreadsheet import', () => {
  it('reads XLSX with real date cells and numbers', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Date', 'Description', 'Amount', 'Balance'],
      [new Date(Date.UTC(2026, 7, 2)), 'WOOLWORTHS', -126.43, 6383.57],
      [new Date(Date.UTC(2026, 7, 3)), 'PAYROLL', 4102.17, 10485.74],
    ], { cellDates: false });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const [sheet] = readSpreadsheet(new Uint8Array(buf));
    expect(sheet.name).toBe('Transactions');
    expect(sheet.rows[1]).toEqual(['2026-08-02', 'WOOLWORTHS', '-126.43', '6383.57']);
    const det = detectMapping(sheet.rows);
    const st = applyMapping(sheet.rows, det.mapping!, 'xlsx');
    expect(st.transactions.map((t) => [t.date, t.amountCents])).toEqual([['2026-08-02', -12643], ['2026-08-03', 410217]]);
  });

  it('reads legacy XLS', () => {
    const ws = XLSX.utils.aoa_to_sheet([['Date', 'Narrative', 'Amount'], ['02/08/2026', 'SHOP', '-5.00']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xls' }) as ArrayBuffer;
    const [sheet] = readSpreadsheet(new Uint8Array(buf));
    expect(sheet.rows[1]).toEqual(['02/08/2026', 'SHOP', '-5.00']);
  });
});

describe('duplicate detection', () => {
  const existing = [
    { id: 'a', date: '2026-08-02', amountCents: -12643, description: 'WOOLWORTHS 1234 PETRIE', balanceCents: 638357 },
    { id: 'b', date: '2026-08-05', amountCents: -450, description: 'COFFEE CART' },
    { id: 'c', date: '2026-08-10', amountCents: -2000, description: 'SHOP', externalId: 'X1' },
  ];

  it('matches re-imported rows and keeps genuinely new ones', () => {
    const res = findDuplicates([
      { date: '2026-08-02', amountCents: -12643, description: 'WOOLWORTHS 1234 PETRIE', balanceCents: 638357 },
      { date: '2026-08-05', amountCents: -450, description: 'COFFEE CART' },
      { date: '2026-08-05', amountCents: -450, description: 'COFFEE CART' },
      { date: '2026-08-06', amountCents: -999, description: 'NEW THING' },
    ], existing);
    expect(res.map((r) => r.status)).toEqual(['duplicate', 'duplicate', 'new', 'new']);
    expect(res[0].matchId).toBe('a');
    // Two identical coffees: one was already imported, the second is kept.
    expect(res[2].reasons.join(' ')).toMatch(/both are kept/);
  });

  it('uses bank transaction IDs when both sides have them', () => {
    const res = findDuplicates([
      { date: '2026-08-10', amountCents: -2000, description: 'SHOP', externalId: 'X1' },
      { date: '2026-08-10', amountCents: -2000, description: 'SHOP', externalId: 'X2' },
    ], existing);
    expect(res.map((r) => r.status)).toEqual(['duplicate', 'new']);
  });

  it('asks about weaker matches instead of deciding', () => {
    const res = findDuplicates([{ date: '2026-08-04', amountCents: -12643, description: 'WOOLWORTHS PETRIE' }], existing);
    expect(res[0].status).toBe('possible-duplicate');
  });

  it('never matches on amount alone', () => {
    const res = findDuplicates([{ date: '2026-08-02', amountCents: -12643, description: 'SOMETHING ELSE ENTIRELY', balanceCents: 1 }], existing);
    expect(res[0].status).toBe('new');
  });
});

describe('reconciliation', () => {
  const base = [
    { date: '2026-08-02', amountCents: -12643, description: 'WOOLWORTHS', balanceCents: null, issues: [] },
    { date: '2026-08-03', amountCents: 410217, description: 'PAYROLL', balanceCents: null, issues: [] },
    { date: '2026-08-04', amountCents: -8220, description: 'UNKNOWN', balanceCents: null, issues: [] },
    { date: '2026-08-10', amountCents: -400000, description: 'TRANSFER', balanceCents: null, issues: [] },
    { date: '2026-08-15', amountCents: -41260, description: 'ENERGY', balanceCents: null, issues: [] },
    { date: '2026-08-20', amountCents: 123, description: 'INTEREST', balanceCents: null, issues: [] },
    { date: '2026-08-28', amountCents: -30337, description: 'HOME LOAN', balanceCents: null, issues: [] },
  ];

  it('reconciles a balanced statement', () => {
    const r = reconcile({ openingCents: 651000, closingCents: 568880, transactions: base });
    expect(r).toMatchObject({ status: 'reconciled', movementCents: -82120, expectedClosingCents: 568880, differenceCents: 0 });
  });

  it('points to a missing transaction', () => {
    const r = reconcile({ openingCents: 651000, closingCents: 568880 - 4820, transactions: base });
    expect(r.status).toBe('difference');
    expect(r.differenceCents).toBe(-4820);
    expect(r.message).toMatch(/\$48\.20/);
    expect(r.hints[0]).toMatch(/money-out transaction of \$48\.20 may be missing/);
  });

  it('points to a duplicated transaction', () => {
    const dup = [...base, { ...base[2] }];
    const r = reconcile({ openingCents: 651000, closingCents: 568880, transactions: dup });
    expect(r.differenceCents).toBe(8220);
    expect(r.hints.join(' ')).toMatch(/appears more than once/);
    expect(r.suspectIndexes).toEqual([2, 7]);
  });

  it('points to a debit/credit sign error', () => {
    const flipped = base.map((t, i) => (i === 4 ? { ...t, amountCents: 41260 } : t));
    const r = reconcile({ openingCents: 651000, closingCents: 568880, transactions: flipped });
    expect(r.hints.join(' ')).toMatch(/ENERGY.*money in rather than money out|may be money/);
    expect(r.suspectIndexes).toContain(4);
  });

  it('uses the running balance when no printed balances exist', () => {
    const txs = [
      { date: '2026-08-02', amountCents: -1000, description: 'A', balanceCents: 9000, issues: [] },
      { date: '2026-08-03', amountCents: -2000, description: 'B', balanceCents: 7000, issues: [] },
    ];
    expect(reconcile({ openingCents: null, closingCents: null, transactions: txs })).toMatchObject({ status: 'reconciled', openingCents: 10000, closingCents: 7000 });
  });

  it('does not claim success when the opening balance was derived', () => {
    const r = reconcile({ openingCents: 100, closingCents: 50, openingDerived: true, transactions: [{ date: '2026-08-02', amountCents: -50, description: 'A', balanceCents: null, issues: [] }] });
    expect(r.status).toBe('not-verifiable');
  });
});
