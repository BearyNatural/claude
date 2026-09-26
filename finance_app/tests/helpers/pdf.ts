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
