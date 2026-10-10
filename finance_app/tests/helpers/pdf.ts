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
