import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface PdfText {
  text: string;
  x: number;
  y: number;
  /** Right-align at x instead of left-align. */
  right?: boolean;
  size?: number;
}

/** Build a simple text PDF for tests (fictional statements only). */
export async function makePdf(pages: PdfText[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const items of pages) {
    const page = doc.addPage([595, 842]);
    for (const it of items) {
      const size = it.size ?? 9;
      const x = it.right ? it.x - font.widthOfTextAtSize(it.text, size) : it.x;
      page.drawText(it.text, { x, y: it.y, size, font, color: rgb(0, 0, 0) });
    }
  }
  return doc.save();
}

/** A PDF with only a drawn shape — behaves like a scanned statement with no text layer. */
export async function makeImageOnlyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 50, y: 50, width: 400, height: 600, color: rgb(0.9, 0.9, 0.9) });
  return doc.save();
}

export interface StatementRow {
  date: string;
  desc: string;
  debit?: string;
  credit?: string;
  balance: string;
  wrap?: string;
}

/** Lays out a statement with Date / Transaction details / Debit / Credit / Balance columns. */
export function statementLayout(opts: {
  title?: string;
  period?: string;
  opening?: string;
  closing?: string;
  rows: StatementRow[];
  withHeader?: boolean;
}): PdfText[] {
  const items: PdfText[] = [];
  let y = 800;
  items.push({ text: opts.title ?? 'Example Bank', x: 50, y, size: 14 });
  y -= 20;
  items.push({ text: 'Everyday Account', x: 50, y });
  y -= 14;
  items.push({ text: 'BSB 062-000 Account number 1234 5678', x: 50, y });
  y -= 14;
  if (opts.period) items.push({ text: `Statement period ${opts.period}`, x: 50, y });
  y -= 14;
  if (opts.opening) {
    items.push({ text: 'Opening balance', x: 50, y });
    items.push({ text: opts.opening, x: 550, y, right: true });
  }
  y -= 14;
  if (opts.closing) {
    items.push({ text: 'Closing balance', x: 50, y });
    items.push({ text: opts.closing, x: 550, y, right: true });
  }
  y -= 30;
  if (opts.withHeader !== false) {
    items.push({ text: 'Date', x: 50, y });
    items.push({ text: 'Transaction details', x: 110, y });
    items.push({ text: 'Debit', x: 400, y, right: true });
    items.push({ text: 'Credit', x: 470, y, right: true });
    items.push({ text: 'Balance', x: 550, y, right: true });
    y -= 16;
  }
  for (const r of opts.rows) {
    items.push({ text: r.date, x: 50, y });
    items.push({ text: r.desc, x: 110, y });
    if (r.debit) items.push({ text: r.debit, x: 400, y, right: true });
    if (r.credit) items.push({ text: r.credit, x: 470, y, right: true });
    items.push({ text: r.balance, x: 550, y, right: true });
    y -= 13;
    if (r.wrap) {
      items.push({ text: r.wrap, x: 110, y });
      y -= 13;
    }
  }
  items.push({ text: 'Page 1 of 1', x: 270, y: 30 });
  return items;
}

export const AUGUST_ROWS: StatementRow[] = [
  { date: '02 Aug', desc: 'WOOLWORTHS 1234 PETRIE', debit: '126.43', balance: '6,383.57' },
  { date: '03 Aug', desc: 'PAYROLL EXAMPLE PTY LTD', credit: '4,102.17', balance: '10,485.74' },
  { date: '04 Aug', desc: 'EFTPOS 8837', debit: '82.20', balance: '10,403.54', wrap: 'CARD XX1234 VALUE DATE 03/08' },
  { date: '10 Aug', desc: 'TRANSFER TO SAVINGS', debit: '4,000.00', balance: '6,403.54' },
  { date: '15 Aug', desc: 'POWERCO ENERGY BPAY', debit: '412.60', balance: '5,990.94' },
  { date: '20 Aug', desc: 'INTEREST CREDIT', credit: '1.23', balance: '5,992.17' },
  { date: '28 Aug', desc: 'HOME LOAN REPAYMENT', debit: '303.37', balance: '5,688.80' },
];

/**
 * A fictional super fund statement laid out like a real one: contributions split into
 * Employer SG / Employer additional / Member before-tax / Member after-tax columns plus a Total,
 * opening and closing balance rows, and period totals (fees, tax) printed without dates.
 */
export function superStatementLayout(): PdfText[] {
  const items: PdfText[] = [
    { text: 'Member number: 000111222', x: 47, y: 790 },
    { text: 'Your transaction summary', x: 47, y: 760, size: 14 },
    { text: "Here's details of the transactions on your account from 1 July 2025 to 30 June 2026.", x: 47, y: 740 },
    { text: 'Date', x: 47, y: 700 }, { text: 'Description', x: 108, y: 700 },
    { text: 'Employer', x: 340, y: 700, right: true }, { text: 'Employer', x: 391, y: 700, right: true },
    { text: 'Member', x: 442, y: 700, right: true }, { text: 'Member', x: 493, y: 700, right: true }, { text: 'Total', x: 549, y: 700, right: true },
    { text: 'SG ($)', x: 340, y: 689, right: true }, { text: 'additional', x: 391, y: 689, right: true },
    { text: 'before-tax', x: 442, y: 689, right: true }, { text: 'after-tax', x: 493, y: 689, right: true }, { text: '($)', x: 549, y: 689, right: true },
    { text: '($)', x: 391, y: 678, right: true }, { text: '($)', x: 442, y: 678, right: true }, { text: '($)', x: 493, y: 678, right: true },
  ];
  const row = (y: number, date: string | null, desc: string, col: number | null, amount: string) => {
    if (date) items.push({ text: date, x: 47, y });
    items.push({ text: desc, x: 108, y });
    if (col) items.push({ text: amount, x: col, y, right: true });
    items.push({ text: amount, x: 549, y, right: true });
  };
  row(660, '01/07/2025', 'Opening account balance', null, '100,000.00');
  row(645, '08/07/2025', 'EXAMPLE HEALTH PTY LTD', 340, '1,000.00');
  row(630, '08/08/2025', 'EXAMPLE HEALTH PTY LTD', 340, '1,000.00');
  row(615, '08/09/2025', 'EXAMPLE HEALTH PTY LTD', 340, '950.50');
  row(600, '15/10/2025', 'BPAY PERSONAL CONTRIBUTION', 493, '2,000.00');
  row(585, '30/06/2026', 'Investment returns', null, '8,500.00');
  items.push({ text: '1', x: 196, y: 573, size: 6 });
  row(570, null, 'Flat administration fees', null, '-52.00');
  row(555, null, 'Asset-based administration fees', null, '-96.40');
  row(540, null, 'Tax benefit – Flat administration fees', null, '7.80');
  row(525, null, 'Tax benefit – Asset-based administration fees', null, '14.46');
  row(510, null, 'Government contribution tax', null, '-442.58');
  row(495, '30/06/2026', 'Closing account balance', null, '112,881.78');
  items.push({ text: '1', x: 43, y: 480, size: 6 });
  items.push({ text: 'Flat administration fees of $1 per week are deducted on the last Friday of each month.', x: 47, y: 478, size: 7 });
  items.push({ text: 'pro-rated based on the number of Fridays in the month.', x: 47, y: 468, size: 7 });
  return items;
}

/**
 * A fictional statement that lists several accounts in one PDF, laid out the way some Australian
 * banks do it: a summary table, then a section per account ("Account name:", "Account: <number>"),
 * each with its own headings, opening and closing balance rows. It includes the awkward parts of
 * real statements: shaded rows printed twice, rows whose amount wraps onto the next line, "REF:"
 * lines, notes with no money, a date split over two lines, mailing codes in the margin, and a
 * number in the description area of a loan ("INT SAVED BY BALANCE OFFSET").
 */
export function multiAccountStatementPages(): PdfText[][] {
  const p1: PdfText[] = [];
  const p2: PdfText[] = [];
  const header = (items: PdfText[], y: number) => items.push(
    { text: 'Date', x: 55, y }, { text: 'Description', x: 92, y },
    { text: 'Debits', x: 396, y, right: true }, { text: 'Credits', x: 462, y, right: true }, { text: 'Balance', x: 539, y, right: true },
  );
  const row = (items: PdfText[], y: number, date: string | null, desc: string | null, money: { debit?: string; credit?: string; balance?: string } = {}, twice = false) => {
    const add = (t: PdfText) => { items.push(t); if (twice) items.push({ ...t }); };
    if (date) add({ text: date, x: 55, y });
    if (desc) add({ text: desc, x: 92, y });
    if (money.debit) add({ text: money.debit, x: 396, y, right: true });
    if (money.credit) add({ text: money.credit, x: 462, y, right: true });
    if (money.balance) add({ text: money.balance, x: 539, y, right: true });
  };
  const section = (items: PdfText[], y: number, name: string, product: string, number: string) => {
    items.push({ text: `Account name: ${name}`, x: 55, y });
    items.push({ text: `Product name: ${product}`, x: 55, y: y - 14 });
    items.push({ text: 'Statement period: 1 JAN 2026 To 30 JUN 2026', x: 55, y: y - 28 });
    items.push({ text: `Account: ${number} EXAMPLE PERSON`, x: 55, y: y - 42 }, { text: 'TFN Known: Y', x: 425, y: y - 42 });
  };
  const pageHeader = (items: PdfText[]) => items.push(
    { text: 'Example Mutual Bank', x: 176, y: 800, size: 12 }, { text: 'Customer number: 900001', x: 404, y: 784 }, { text: 'BSB: 999-001', x: 404, y: 772 },
  );

  pageHeader(p1);
  p1.push({ text: 'My statement', x: 55, y: 740, size: 12 });
  p1.push({ text: '11112222 Everyday', x: 60, y: 712 }, { text: '$100.00', x: 396, y: 712, right: true }, { text: '$335.00', x: 539, y: 712, right: true });
  p1.push({ text: '33334444 Savings', x: 60, y: 700 }, { text: '$1,000.00', x: 396, y: 700, right: true }, { text: '$302.10', x: 539, y: 700, right: true });
  section(p1, 660, 'Everyday', 'Everyday Access', '11112222');
  header(p1, 600);
  row(p1, 588, '1 Jan', 'OPENING BALANCE', { balance: '100.00' });
  row(p1, 576, '5 Jan', 'Card Purchase EXAMPLE GROCER');
  row(p1, 566, null, '040126', { debit: '25.50', balance: '74.50' });
  row(p1, 554, '10 Jan', 'Fast Pymt In', { credit: '500.00', balance: '574.50' }, true);
  row(p1, 542, '10 Jan', 'REF:Birthday gift', {}, true);
  row(p1, 530, '12 Jan', 'TXN INITIATED BY-900001 TRANSFER TO 999001 33334444');
  row(p1, 520, null, 'EXAMPLE PERSON', { debit: '300.00', balance: '274.50' });
  row(p1, 508, '1 Feb', 'FREE TXNS UNLIMITED');
  row(p1, 496, '20', 'From: EXAMPLE PERSON REF: rent share');
  row(p1, 486, 'Feb', null, { credit: '60.00', balance: '334.50' });
  p1.push({ text: 'E-900/S-123/I-456', x: 28, y: 473, size: 6 });
  row(p1, 474, '25 Feb', 'Interest Paid', { credit: '0.50', balance: '335.00' });
  row(p1, 462, '30 Jun', 'CLOSING BALANCE', { balance: '335.00' }, true);
  section(p1, 420, 'Savings', 'Example eSaver', '33334444');
  header(p1, 360);
  row(p1, 348, '1 Jan', 'OPENING BALANCE', { balance: '1,000.00' });
  row(p1, 336, '12 Jan', 'From: EXAMPLE PERSON', { credit: '300.00', balance: '1,300.00' });
  p1.push({ text: '1 of 2', x: 545, y: 25 });

  pageHeader(p2);
  header(p2, 700);
  row(p2, 688, '31 Jan', 'Interest Paid', { credit: '2.10', balance: '1,302.10' });
  row(p2, 676, '3 Feb', 'Fast Pymt Out', { debit: '1,000.00', balance: '302.10' });
  row(p2, 664, '3 Feb', 'REF:Holiday fund');
  row(p2, 652, '30 Jun', 'CLOSING BALANCE', { balance: '302.10' });
  section(p2, 610, 'Home Loan', 'Example Variable OO P&I', '55556666');
  p2.push({ text: 'CURRENT INTEREST RATE', x: 57, y: 552 }, { text: '6.00% P.A.', x: 170, y: 552 });
  header(p2, 536);
  row(p2, 524, '1 Jan', 'OPENING BALANCE', { balance: '50,000.00' });
  row(p2, 512, '31 Jan', 'INT SAVED BY BALANCE OFFSET');
  p2.push({ text: '123.45', x: 231, y: 512 });
  row(p2, 500, '31 Jan', 'Interest Charged', { debit: '240.00', balance: '50,240.00' });
  row(p2, 488, '14 Feb', 'Auto Payment', { credit: '1,000.00', balance: '49,240.00' });
  row(p2, 476, '4 Mar', 'RATE CHANGED FM 6.00 % TO 5.75 %');
  row(p2, 464, '30 Jun', 'CLOSING BALANCE', { balance: '49,240.00' });
  p2.push({ text: '2 of 2', x: 545, y: 25 });
  return [p1, p2];
}

/** A fictional employee share scheme statement in the ATO layout (NAT 75282). */
export function essStatement(values: { d: string; e: string; f: string; c: string }, year = '2026'): PdfText[] {
  return [
    { text: 'Employee share scheme statement', x: 273, y: 783, size: 14 },
    { text: 'Employee summary for year ending June 30', x: 274, y: 769 }, { text: year, x: 510, y: 769 },
    { text: 'Full name', x: 37, y: 721 }, { text: 'PERSON, Example', x: 43, y: 704 },
    { text: 'Employee tax file number/ABN', x: 37, y: 569 }, { text: 'TFN', x: 48, y: 540 }, { text: '000000000', x: 105, y: 540 },
    { text: 'Taxed upfront scheme – eligible for reduction', x: 37, y: 477 },
    { text: 'D $', x: 48, y: 429 }, { text: values.d, x: 103, y: 429 },
    { text: 'Taxed upfront scheme – not eligible for reduction', x: 36, y: 405 },
    { text: 'E $', x: 48, y: 343 }, { text: values.e, x: 103, y: 343 },
    { text: 'Discount from deferral schemes', x: 37, y: 303 },
    { text: values.f, x: 103, y: 270 }, { text: 'F $', x: 48, y: 269 },
    { text: 'TFN amounts withheld from discounts (total includes cents)', x: 37, y: 229 },
    { text: 'C $', x: 48, y: 195 }, { text: values.c, x: 103, y: 195 },
    { text: 'Employer details', x: 43, y: 165 },
    { text: 'Employer ABN', x: 51, y: 132 }, { text: '12345678901', x: 141, y: 132 },
    { text: 'Employer Name', x: 51, y: 107 }, { text: 'Example Software Pty Ltd', x: 141, y: 107 },
  ];
}

/** A fictional payslip with "This pay" and "YTD" columns. */
export function payslipWithYtd(): PdfText[] {
  return [
    { text: 'Example Health Pty Ltd', x: 50, y: 800, size: 12 }, { text: 'ABN 12 345 678 901', x: 50, y: 786 },
    { text: 'Pay period: 01/09/2026 to 14/09/2026', x: 50, y: 760 }, { text: 'Payment date: 17/09/2026', x: 330, y: 760 },
    { text: 'Description', x: 50, y: 730 }, { text: 'This pay', x: 400, y: 730, right: true }, { text: 'YTD', x: 520, y: 730, right: true },
    { text: 'Ordinary hours', x: 50, y: 716 }, { text: '3,200.00', x: 400, y: 716, right: true }, { text: '19,200.00', x: 520, y: 716, right: true },
    { text: 'Laundry allowance', x: 50, y: 702 }, { text: '20.00', x: 400, y: 702, right: true }, { text: '120.00', x: 520, y: 702, right: true },
    { text: 'Gross pay', x: 50, y: 688 }, { text: '3,220.00', x: 400, y: 688, right: true }, { text: '19,320.00', x: 520, y: 688, right: true },
    { text: 'Salary sacrifice super', x: 50, y: 674 }, { text: '100.00', x: 400, y: 674, right: true }, { text: '600.00', x: 520, y: 674, right: true },
    { text: 'PAYG tax', x: 50, y: 660 }, { text: '612.00', x: 400, y: 660, right: true }, { text: '3,672.00', x: 520, y: 660, right: true },
    { text: 'Union fees', x: 50, y: 646 }, { text: '25.00', x: 400, y: 646, right: true }, { text: '150.00', x: 520, y: 646, right: true },
    { text: 'Net pay', x: 50, y: 632 }, { text: '2,483.00', x: 400, y: 632, right: true }, { text: '14,898.00', x: 520, y: 632, right: true },
    { text: 'Superannuation guarantee', x: 50, y: 610 }, { text: '384.00', x: 400, y: 610, right: true }, { text: '2,304.00', x: 520, y: 610, right: true },
    { text: 'Tax file number provided', x: 50, y: 590 },
  ];
}

/** A fictional payslip whose totals are laid out as columns. */
export function payslipColumns(): PdfText[] {
  return [
    { text: 'Employer: Example Cafe Pty Ltd', x: 50, y: 800 },
    { text: 'Period ending 30 September 2026', x: 50, y: 784 }, { text: 'Date paid: 2 October 2026', x: 330, y: 784 },
    { text: 'Gross Pay', x: 60, y: 740 }, { text: 'Tax', x: 200, y: 740 }, { text: 'Super', x: 320, y: 740 }, { text: 'Net Pay', x: 450, y: 740 },
    { text: '$1,000.00', x: 60, y: 726 }, { text: '$120.00', x: 200, y: 726 }, { text: '$120.00', x: 320, y: 726 }, { text: '$880.00', x: 450, y: 726 },
  ];
}
