import { parseMoney } from '../money';
import { ISODate, addDays, isValidDate, makeDate, parts } from '../dates';
import { monthFromName, parseDateAs, detectDateFormat } from './dateFormats';
import { Confidence, ParsedStatement, ParsedTransaction, emptyStatement, lowestConfidence } from './types';
import { finaliseStatement } from './csv';

/**
 * Reads transactions from the text layer of a PDF bank statement.
 *
 * PDF statements have no standard structure, so this works from the *positions* of
 * text on each page: it rebuilds lines, finds the column headings (Date / Description /
 * Debit / Credit / Balance), and reads rows that start with a date. Every row gets a
 * confidence rating and nothing is imported without the Import Review screen.
 */

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfTextPage {
  pageNumber: number;
  width: number;
  height: number;
  items: PdfTextItem[];
}

interface Cell {
  text: string;
  x0: number;
  x1: number;
}

interface Line {
  page: number;
  y: number;
  cells: Cell[];
  text: string;
}

/* ------------------------------ layout ------------------------------ */

/** Some statements print shaded rows twice in the same place; keep one copy of each. */
function withoutOverprint(items: PdfTextItem[]): PdfTextItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = `${i.str}|${Math.round(i.x * 2)}|${Math.round(i.y * 2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildLines(pages: PdfTextPage[]): Line[] {
  const lines: Line[] = [];
  for (const page of pages) {
    const items = withoutOverprint(page.items.filter((i) => i.str.trim() !== '')).sort((a, b) => b.y - a.y || a.x - b.x);
    const groups: PdfTextItem[][] = [];
    for (const it of items) {
      const g = groups.find((grp) => Math.abs(grp[0].y - it.y) <= Math.max(2, (grp[0].height || 8) * 0.35));
      if (g) g.push(it);
      else groups.push([it]);
    }
    for (const g of groups) {
      g.sort((a, b) => a.x - b.x);
      const cells: Cell[] = [];
      for (const it of g) {
        const prev = cells[cells.length - 1];
        const charW = it.str.length ? it.width / it.str.length : 4;
        const gap = prev ? it.x - prev.x1 : Infinity;
        // Text printed on top of other text (mailing codes in the margin) is kept as its own cell.
        const overlaps = gap < -2 && -gap > it.width * 0.5;
        if (prev && !overlaps && gap < Math.max(charW * 1.6, 3.5)) {
          prev.text += (gap > charW * 0.25 ? ' ' : '') + it.str;
          prev.x1 = it.x + it.width;
        } else {
          cells.push({ text: it.str, x0: it.x, x1: it.x + it.width });
        }
      }
      cells.forEach((c) => (c.text = c.text.replace(/\s+/g, ' ').trim()));
      lines.push({ page: page.pageNumber, y: g[0].y, cells, text: cells.map((c) => c.text).join('  ') });
    }
  }
  return lines;
}

/* ------------------------------ metadata ------------------------------ */

const LONG_DATE = String.raw`(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{2,4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})`;

function parseAnyDate(s: string): ISODate | null {
  const t = s.trim();
  return parseDateAs(t, 'D-MON-Y') ?? parseDateAs(t, 'YMD') ?? parseDateAs(t, 'DMY');
}

export function findStatementPeriod(text: string): { start: ISODate; end: ISODate } | null {
  const re = new RegExp(`${LONG_DATE}\\s*(?:to|-|–|—|until|through)\\s*${LONG_DATE}`, 'i');
  const m = text.match(re);
  if (m) {
    const start = parseAnyDate(m[1]);
    const end = parseAnyDate(m[2]);
    if (start && end && start <= end) return { start, end };
  }
  // "1 August – 31 August 2026" (year only on the end date)
  const m2 = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s*(?:to|-|–|—)\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i);
  if (m2) {
    const m1 = monthFromName(m2[2]);
    const mEnd = monthFromName(m2[4]);
    const y = Number(m2[5]);
    if (m1 && mEnd) {
      const start = makeDate(m1 > mEnd ? y - 1 : y, m1, Number(m2[1]));
      const end = makeDate(y, mEnd, Number(m2[3]));
      if (isValidDate(start) && isValidDate(end)) return { start, end };
    }
  }
  return null;
}

const MONEY_TOKEN = /^[-+(]?\$?\s?-?\d{1,3}(,\d{3})*(\.\d{2})\)?\s?(CR|DR|Cr|Dr)?-?$|^[-+(]?\$?\s?-?\d+\.\d{2}\)?\s?(CR|DR|Cr|Dr)?-?$/;

export function isMoneyToken(s: string): boolean {
  return MONEY_TOKEN.test(s.trim());
}

function lastMoneyOnLine(line: Line): number | null {
  for (let i = line.cells.length - 1; i >= 0; i--) {
    const c = line.cells[i].text;
    if (isMoneyToken(c)) {
      const p = parseMoney(c);
      if (p) return p.indicator === 'DR' ? -Math.abs(p.cents) : p.cents;
    }
  }
  return null;
}

function findLabelledBalance(lines: Line[], label: RegExp): number | null {
  for (const l of lines) {
    if (label.test(l.text)) {
      const v = lastMoneyOnLine(l);
      if (v !== null) return v;
    }
  }
  return null;
}

function findAccountNumber(text: string): { number: string | null; bsb: string | null } {
  const bsb = text.match(/BSB[:\s]*(\d{3}[-\s]?\d{3})/i);
  const acct = text.match(/Account\s*(?:number|no\.?|#)?[:\s]*((?:\d[\d\s-]{4,18}\d))/i);
  return { number: acct ? acct[1].replace(/[\s-]/g, '') : null, bsb: bsb ? bsb[1].replace(/\s/g, '-') : null };
}

function findAccountName(lines: Line[]): string | null {
  for (const l of lines.slice(0, 40)) {
    const t = l.text.replace(/\s{2,}/g, ' ').trim();
    if (/\b(account|saver|savings|offset|credit card|mastercard|visa|everyday|transaction)\b/i.test(t)
      && !/\b(number|bsb|period|balance|page|statement\s+period)\b/i.test(t) && t.length <= 60) {
      return t;
    }
  }
  return null;
}

/* ------------------------------ rows ------------------------------ */

type ColumnRole = 'date' | 'description' | 'debit' | 'credit' | 'amount' | 'balance';

interface HeaderColumns {
  roles: { role: ColumnRole; x0: number; x1: number }[];
  /** Every heading cell, including breakdown columns such as "Employer SG" on a super statement. */
  columns: { label: string; role: ColumnRole | null; x0: number; x1: number }[];
}

const HEADER_WORDS: [ColumnRole, RegExp][] = [
  ['date', /^(transaction\s+)?date$|^date$/i],
  ['description', /^(transaction\s+)?(description|details|particulars|narrative)$|^transaction$/i],
  ['debit', /^(debit(s)?|withdrawal(s)?|money\s+out|paid\s+out|debits?\s*\(\$\)|withdrawals?\s*\(\$\))$/i],
  ['credit', /^(credit(s)?|deposit(s)?|money\s+in|paid\s+in|credits?\s*\(\$\)|deposits?\s*\(\$\))$/i],
  ['amount', /^(amount|total|net\s+amount|transaction\s+amount)(\s*\(\$\))?$/i],
  ['balance', /^balance(\s*\(\$\))?$/i],
];

function detectHeader(line: Line): HeaderColumns | null {
  const roles: HeaderColumns['roles'] = [];
  const columns: HeaderColumns['columns'] = [];
  for (const c of line.cells) {
    let found: ColumnRole | null = null;
    for (const [role, re] of HEADER_WORDS) {
      if (re.test(c.text)) {
        found = role;
        roles.push({ role, x0: c.x0, x1: c.x1 });
        break;
      }
    }
    columns.push({ label: c.text, role: found, x0: c.x0, x1: c.x1 });
  }
  const has = (r: ColumnRole) => roles.some((x) => x.role === r);
  if (has('date') && (has('debit') || has('credit') || has('amount') || has('balance'))) {
    const date = roles.find((r) => r.role === 'date')!;
    // Anything printed left of the Date heading is margin text, not a column.
    return { roles, columns: columns.filter((c) => c.role || c.x0 >= date.x0 - 4) };
  }
  return null;
}

/** Where the amount columns begin: money printed left of this is part of the description ("INT SAVED 123.45"). */
function amountZoneStart(header: HeaderColumns): number {
  const date = header.roles.find((r) => r.role === 'date');
  const desc = header.roles.find((r) => r.role === 'description');
  const descEnd = (desc ?? date)?.x1 ?? -Infinity;
  const xs = header.columns
    .filter((c) => (c.role && c.role !== 'date' && c.role !== 'description') || (!c.role && c.x0 > descEnd))
    .map((c) => c.x0);
  return xs.length ? Math.min(...xs) : -Infinity;
}

/** Drop margin text (mailing codes, scanner marks) printed left of the Date column. */
function trimMargin(line: Line, header: HeaderColumns | null): Line {
  const date = header?.roles.find((r) => r.role === 'date');
  if (!date) return line;
  const cells = line.cells.filter((c) => c.x0 >= date.x0 - 4 || parseRowDate(c.text) !== null);
  if (cells.length === line.cells.length) return line;
  return { ...line, cells, text: cells.map((c) => c.text).join('  ') };
}

/** Headings split over several lines ("Employer" / "SG ($)"): add the lower words to the column above. */
function mergeHeaderLine(header: HeaderColumns, line: Line): void {
  for (const c of line.cells) {
    const col = header.columns.find((h) => c.x0 <= h.x1 + 4 && c.x1 >= h.x0 - 4);
    if (col) {
      col.label = `${col.label} ${c.text}`.trim();
      col.x0 = Math.min(col.x0, c.x0);
      col.x1 = Math.max(col.x1, c.x1);
    }
  }
}

const cleanLabel = (s: string) => s.replace(/\(\s*\$\s*\)/g, '').replace(/\s+/g, ' ').trim();

const SHORT_DATE = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]([A-Za-z]{3,9})\.?(?:[\s-](\d{2,4}))?$/;
const NUMERIC_DATE = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/;

interface DateToken {
  y: number | null;
  m: number;
  d: number;
}

function parseRowDate(s: string): DateToken | null {
  const t = s.trim();
  let m = t.match(SHORT_DATE);
  if (m) {
    const mon = monthFromName(m[2]);
    if (!mon) return null;
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    return { y, m: mon, d: Number(m[1]) };
  }
  m = t.match(NUMERIC_DATE);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    // Australian statements are day-first.
    const month = Number(m[2]);
    const day = Number(m[1]);
    if (month < 1 || month > 12) return null;
    return { y, m: month, d: day };
  }
  const iso = parseDateAs(t, 'YMD');
  if (iso) {
    const p = parts(iso);
    return { y: p.y, m: p.m, d: p.d };
  }
  return null;
}

/** Split the first cell when the date and description were merged ("02 Aug WOOLWORTHS"). */
function leadingDate(line: Line): { token: DateToken; rest: string } | null {
  const first = line.cells[0]?.text ?? '';
  const direct = parseRowDate(first);
  if (direct) return { token: direct, rest: '' };
  const m = first.match(/^(\d{1,2}(?:st|nd|rd|th)?[\s-][A-Za-z]{3,9}\.?(?:[\s-]\d{2,4})?|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\s+(.*)$/);
  if (m) {
    const t = parseRowDate(m[1]);
    if (t) return { token: t, rest: m[2] };
  }
  return null;
}

function resolveYear(tok: DateToken, period: { start: ISODate; end: ISODate } | null, fallbackYear: number): { date: ISODate | null; inferred: boolean } {
  if (tok.y) {
    const d = makeDate(tok.y, tok.m, tok.d);
    return { date: isValidDate(d) ? d : null, inferred: false };
  }
  if (period) {
    const years = [parts(period.start).y, parts(period.end).y];
    for (const y of years) {
      const d = makeDate(y, tok.m, tok.d);
      if (isValidDate(d) && d >= addDays(period.start, -10) && d <= addDays(period.end, 10)) return { date: d, inferred: true };
    }
  }
  const d = makeDate(fallbackYear, tok.m, tok.d);
  return { date: isValidDate(d) ? d : null, inferred: true };
}

const SKIP_LINE = /^(page\s+\d+|continued|statement\s+(continued|period)|total(s)?\b|transaction\s+totals|(closing|opening)(\s+account)?\s+balance|balance\s+(brought|carried)\s+forward)/i;
/** A row that states a balance rather than a transaction ("Opening account balance 100,000.00"). */
const BALANCE_ROW = /^(opening|closing)(\s+account)?\s+balance\b|^balance\s+(brought|carried)\s+forward\b|^(previous|new)\s+balance\b/i;
/** Footnote markers printed on their own line next to a row ("1", "*", "†"). */
const FOOTNOTE_MARK = /^[\d*†‡§¹²³⁴]{1,2}$/;

export interface PdfParseOptions {
  /** 'liability' for credit cards/loans where the printed balance is the amount owed. */
  balanceMeaning?: 'asset' | 'liability';
  /** Used when dates on the statement have no year and no period is printed. */
  fallbackYear?: number;
}

function scannedStatement(pages: PdfTextPage[]): ParsedStatement | null {
  const totalItems = pages.reduce((a, p) => a + p.items.filter((i) => i.str.trim()).length, 0);
  if (pages.length === 0 || totalItems >= pages.length * 5) return null;
  const st = emptyStatement('pdf');
  st.ocrRequired = true;
  st.confidence = 'low';
  st.warnings.push(
    'This PDF appears to be a scanned image with no text layer. Reading it would need OCR (text recognition), which this version does not include. ' +
    'Please import a CSV or OFX export of the same statement, or enter the transactions manually.',
  );
  return st;
}

/** Reads the whole PDF as one statement. */
export function parsePdfStatement(pages: PdfTextPage[], opts: PdfParseOptions = {}): ParsedStatement {
  return scannedStatement(pages) ?? parseLines(buildLines(pages), opts).statement;
}

/* ------------------------------ several accounts in one PDF ------------------------------ */

const ACCOUNT_NAME_LINE = /^Account\s+name\s*:\s*(.+?)\s*$/i;
const PRODUCT_NAME_LINE = /^Product\s+name\s*:\s*(.+?)\s*$/i;
const ACCOUNT_NUMBER_LINE = /^Account(?:\s+(?:number|no\.?|#))?\s*:?\s*(\d[\d -]{4,18}\d)\b/i;

/**
 * Some banks put every account in one statement: a section per
 * account, each starting "Account name: …" / "Account: 12345678". Split the lines at each new
 * account number. Statements for one account come back as a single section.
 */
export function splitAccountSections(lines: Line[]): Line[][] {
  const starts: number[] = [];
  let current: string | null = null;
  lines.forEach((l, i) => {
    const m = l.text.match(ACCOUNT_NUMBER_LINE);
    if (!m) return;
    const num = m[1].replace(/\D/g, '');
    if (num === current) return;
    current = num;
    let start = i;
    const floor = Math.max(0, i - 6, starts.length ? starts[starts.length - 1] + 1 : 0);
    for (let j = i - 1; j >= floor; j--) {
      if (ACCOUNT_NAME_LINE.test(lines[j].text)) {
        start = j;
        break;
      }
    }
    starts.push(start);
  });
  if (starts.length < 2) return [lines];
  return starts.map((s, k) => lines.slice(s, k + 1 < starts.length ? starts[k + 1] : lines.length));
}

/**
 * Reads a PDF that may hold several accounts: one statement per account section, each with its own
 * account number, period and balances, so every section can go to the matching account.
 */
export function parsePdfStatements(pages: PdfTextPage[], opts: PdfParseOptions = {}): ParsedStatement[] {
  const scanned = scannedStatement(pages);
  if (scanned) return [scanned];
  const lines = buildLines(pages);
  const sections = splitAccountSections(lines);
  if (sections.length < 2) return [parseLines(lines, opts).statement];
  const allText = lines.map((l) => l.text).join('\n');
  const doc = { period: findStatementPeriod(allText), bsb: findAccountNumber(allText).bsb };
  const out: ParsedStatement[] = [];
  let header: HeaderColumns | null = null;
  for (const section of sections) {
    // A section without its own headings uses the layout of the one before it.
    const r = parseLines(section, opts, doc, header);
    header = r.header ?? header;
    out.push(r.statement);
  }
  return out;
}

/** Guess the kind of account from a product name printed on the statement. */
export function accountTypeFromName(name: string): string | null {
  if (/offset|mortgage\s*freedom/i.test(name)) return 'offset';
  if (/home\s*loan|mortgage|var(iable)?\s+(OO|INV)|\bP&I\b|interest\s+only/i.test(name)) return 'mortgage';
  if (/credit\s*card|mastercard|visa|low\s+rate\s+card/i.test(name)) return 'credit-card';
  if (/personal\s+loan/i.test(name)) return 'personal-loan';
  if (/car\s+loan|vehicle\s+loan/i.test(name)) return 'car-loan';
  if (/term\s+deposit/i.test(name)) return 'term-deposit';
  if (/saver|savings|bonus|goal/i.test(name)) return 'savings';
  if (/everyday|access|transaction|cheque|basic|joint/i.test(name)) return 'transaction';
  return null;
}

/* ------------------------------ reading one statement ------------------------------ */

/** Narrow date columns can wrap the date itself ("20" on one line, "May" under it): join those lines. */
function joinSplitDates(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    const day = a.cells[0]?.text.match(/^(\d{1,2})$/);
    const mon = b?.cells[0]?.text.match(/^([A-Za-z]{3,9})\.?$/);
    if (day && mon && b.page === a.page && a.y - b.y < 16 && Math.abs(a.cells[0].x0 - b.cells[0].x0) < 6 && monthFromName(mon[1])) {
      const cells = [{ text: `${day[1]} ${mon[1]}`, x0: a.cells[0].x0, x1: Math.max(a.cells[0].x1, b.cells[0].x1) }, ...a.cells.slice(1), ...b.cells.slice(1)];
      out.push({ page: a.page, y: a.y, cells, text: cells.map((c) => c.text).join('  ') });
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

interface DocInfo {
  period: { start: ISODate; end: ISODate } | null;
  bsb: string | null;
}

function parseLines(lines: Line[], opts: PdfParseOptions, doc?: DocInfo, inheritedHeader: HeaderColumns | null = null): { statement: ParsedStatement; header: HeaderColumns | null } {
  const st = emptyStatement('pdf');
  const allText = lines.map((l) => l.text).join('\n');
  const period = findStatementPeriod(allText) ?? doc?.period ?? null;
  if (period) {
    st.periodStart = period.start;
    st.periodEnd = period.end;
  } else {
    st.warnings.push('No statement period was found. Dates without a year were given the most likely year — please check them.');
  }
  const acct = findAccountNumber(allText);
  const labelled = lines.map((l) => l.cells[0]?.text.match(ACCOUNT_NAME_LINE)?.[1]).find(Boolean) ?? null;
  const product = lines.map((l) => l.cells[0]?.text.match(PRODUCT_NAME_LINE)?.[1]).find(Boolean) ?? null;
  st.account = {
    number: lines.map((l) => l.text.match(ACCOUNT_NUMBER_LINE)?.[1].replace(/\D/g, '')).find(Boolean) ?? acct.number,
    bsb: acct.bsb ?? doc?.bsb ?? null,
    name: labelled ?? findAccountName(lines),
    type: accountTypeFromName([labelled, product].filter(Boolean).join(' ')),
  };
  // Balances are stored in the app's convention: money owed on a card or loan is negative.
  const liability = opts.balanceMeaning === 'liability';
  const conv = (v: number | null) => (v === null ? null : liability ? -v : v);
  st.openingBalanceCents = conv(findLabelledBalance(lines, /opening(\s+account)?\s+balance|balance\s+brought\s+forward|previous\s+balance/i));
  st.closingBalanceCents = conv(findLabelledBalance(lines, /closing(\s+account)?\s+balance|balance\s+carried\s+forward|new\s+balance/i));
  const fallbackYear = opts.fallbackYear ?? (period ? parts(period.end).y : new Date().getFullYear());

  let header: HeaderColumns | null = inheritedHeader;
  let ownHeader: HeaderColumns | null = null;
  let zone = header ? amountZoneStart(header) : -Infinity;
  let prevBalance: number | null = st.openingBalanceCents ?? null;
  let lastTx: ParsedTransaction | null = null;
  let lastDate: ISODate | null = null;
  let inTable = false;
  let headerLinesLeft = 0;
  /** A dated row whose amount is on the next line ("20 Apr TRANSFER TO …" / "SMITH 300.00 274.50"). */
  let pending: { date: ISODate; inferred: boolean; text: string; raw: string } | null = null;
  // Statements that print money out with a minus sign ("-52.00") show money in without one.
  const explicitSigns = lines.some((l) => l.cells.some((c) => isMoneyToken(c.text) && /^\s*[-(]|-\s*$/.test(c.text)));
  // A money-looking number inside the description area is part of the description.
  const isAmount = (c: Cell) => isMoneyToken(c.text) && !(header && c.x1 < zone - 10);

  for (const rawLine of joinSplitDates(lines)) {
    const h = detectHeader(rawLine);
    if (h) {
      header = h;
      ownHeader = h;
      zone = amountZoneStart(h);
      inTable = true;
      lastTx = null;
      pending = null;
      headerLinesLeft = 2;
      continue;
    }
    const line = trimMargin(rawLine, header);
    if (line.cells.length === 0) continue;
    if (FOOTNOTE_MARK.test(line.text.trim())) continue;
    if (header && headerLinesLeft > 0) {
      headerLinesLeft--;
      if (!leadingDate(line) && !line.cells.some((c) => isMoneyToken(c.text)) && line.text.length < 80) {
        mergeHeaderLine(header, line);
        continue;
      }
      headerLinesLeft = 0;
    }
    if (SKIP_LINE.test(line.text) && !leadingDate(line)) {
      lastTx = null;
      pending = null;
      continue;
    }
    const ld = leadingDate(line);
    // Amount cells: money tokens after the date/description.
    const moneyCells = line.cells.filter((c, i) => (i > 0 || !ld ? isAmount(c) : false));
    const lineText = () => {
      const t: string[] = [];
      if (ld?.rest) t.push(ld.rest);
      line.cells.forEach((c, i) => {
        if (i === 0 && ld) return;
        if (isAmount(c)) return;
        if (parseRowDate(c.text) && t.length === 0 && i === 1) return; // processing date column
        t.push(c.text);
      });
      return t.join(' ').replace(/\s+/g, ' ').trim();
    };
    if (!ld && moneyCells.length === 0) {
      // Continuation of the previous description (wrapped text).
      if (inTable && line.text.length < 120 && !/^(page|statement|account|bsb)\b/i.test(line.text)) {
        if (pending) pending.text = `${pending.text} ${lineText()}`.trim();
        else if (lastTx) lastTx.description = `${lastTx.description} ${lineText()}`.trim();
      }
      continue;
    }
    if (!ld && !inTable) continue;
    if (ld && moneyCells.length === 0) {
      if (!inTable) continue;
      const r = resolveYear(ld.token, period, fallbackYear);
      const text = lineText();
      if (!r.date || BALANCE_ROW.test(text)) {
        pending = null;
        continue;
      }
      if (/^REF\s*:/i.test(text) && lastTx && lastTx.date === r.date) {
        // A reference printed on its own dated line belongs to the transaction above it.
        lastTx.description = `${lastTx.description} ${text}`.trim();
        pending = null;
        continue;
      }
      // Either a wrapped row (the amount is on the next line) or a note with no money ("RATE CHANGED").
      pending = { date: r.date, inferred: r.inferred, text, raw: line.text };
      continue;
    }

    const issues: string[] = [];
    let confidence: Confidence = 'high';
    let date: ISODate | null = null;
    let prefix = '';
    let raw = line.text;
    if (ld) {
      const r = resolveYear(ld.token, period, fallbackYear);
      date = r.date;
      if (r.inferred && !period) {
        confidence = 'medium';
        issues.push('The year was not printed on this row and was inferred');
      }
    } else if (pending) {
      date = pending.date;
      prefix = pending.text;
      raw = `${pending.raw} / ${line.text}`;
      if (pending.inferred && !period) {
        confidence = 'medium';
        issues.push('The year was not printed on this row and was inferred');
      }
    } else if (lastDate) {
      date = lastDate;
      confidence = 'medium';
      issues.push('No date on this row; the date from the line above was used');
    }
    pending = null;
    if (!date) {
      st.rejectedRows.push({ sourceRow: line.page, reason: 'Date could not be read', raw: line.text });
      continue;
    }

    // Description: text cells that are not the date or money.
    const description = [prefix, lineText()].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

    if (BALANCE_ROW.test(description)) {
      const p = parseMoney(moneyCells[moneyCells.length - 1].text);
      if (p) {
        const v = conv(p.indicator === 'DR' ? -Math.abs(p.cents) : p.cents)!;
        if (/^(opening|previous)|brought/i.test(description)) st.openingBalanceCents ??= v;
        else st.closingBalanceCents ??= v;
        prevBalance = v;
      }
      if (/^(closing|new)|carried/i.test(description)) {
        // The table ends here; anything below is notes, not rows.
        inTable = false;
        lastTx = null;
      }
      continue;
    }
    // Assign money cells to roles.
    let debit: number | null = null;
    let credit: number | null = null;
    let signed: number | null = null;
    let balance: number | null = null;
    let sourceColumn: string | null = null;
    const assign = (c: Cell): ColumnRole | null => {
      if (!header) return null;
      const candidates = header.columns.filter((r) => r.role !== 'date' && r.role !== 'description');
      let best: { col: HeaderColumns['columns'][number]; dist: number } | null = null;
      for (const r of candidates) {
        // Amounts are usually right-aligned under their heading.
        const dist = Math.min(Math.abs(c.x1 - r.x1), Math.abs((c.x0 + c.x1) / 2 - (r.x0 + r.x1) / 2));
        if (!best || dist < best.dist) best = { col: r, dist };
      }
      if (!best || best.dist >= 60) return null;
      if (!best.col.role) {
        // A breakdown column ("Employer SG"): it explains the amount but isn't the amount.
        sourceColumn ??= cleanLabel(best.col.label);
        return null;
      }
      return best.col.role;
    };
    const unassigned: number[] = [];
    for (const c of moneyCells) {
      const p = parseMoney(c.text);
      if (!p) continue;
      let v = p.cents;
      if (p.indicator === 'DR') v = -Math.abs(v);
      const role = assign(c);
      if (role === 'debit') debit = Math.abs(v);
      else if (role === 'credit') credit = Math.abs(v);
      else if (role === 'balance') balance = liability ? -v : v;
      else if (role === 'amount') signed = p.indicator === 'CR' ? Math.abs(v) : v;
      else unassigned.push(p.indicator === 'CR' ? Math.abs(v) : v);
    }
    if (!header || (debit === null && credit === null && signed === null && balance === null)) {
      // No usable headings: last number is the balance if there are two or more.
      if (unassigned.length >= 2) {
        balance = liability ? -unassigned[unassigned.length - 1] : unassigned[unassigned.length - 1];
        signed = unassigned[unassigned.length - 2];
        if (unassigned.length > 2) {
          issues.push('Several amounts on this row; the last two were read as amount and balance');
          confidence = 'low';
        }
      } else if (unassigned.length === 1) {
        signed = unassigned[0];
      }
    }

    let amount: number | null = null;
    let signKnown = false;
    if (debit !== null || credit !== null) {
      amount = (credit ?? 0) - (debit ?? 0);
      signKnown = true;
      if (debit !== null && credit !== null) {
        issues.push('Both debit and credit amounts on one row');
        confidence = 'low';
      }
    } else if (signed !== null) {
      amount = signed;
      const cellText = moneyCells.map((c) => c.text).join(' ');
      signKnown = /-|\(|CR|DR/i.test(cellText) || (explicitSigns && balance === null);
    }

    // The running balance settles the sign when it can.
    if (balance !== null && prevBalance !== null && amount !== null) {
      const delta = balance - prevBalance;
      if (Math.abs(delta) === Math.abs(amount)) {
        if (Math.sign(delta) !== Math.sign(amount) && amount !== 0) {
          if (signKnown) {
            issues.push('The balance moved the opposite way to the amount shown; the sign was taken from the balance');
            confidence = lowestConfidence([confidence, 'medium']);
          }
          amount = delta;
        }
        signKnown = true;
      } else if (!signKnown) {
        issues.push('The running balance does not match this amount, so money in/out could not be confirmed');
        confidence = 'low';
      } else {
        issues.push('The running balance does not change by this amount — something may be missing or misread');
        confidence = lowestConfidence([confidence, 'medium']);
      }
    } else if (!signKnown && amount !== null) {
      // Without headings or a balance, a lone positive number is most often a debit on bank statements.
      amount = -Math.abs(amount);
      issues.push('Could not tell whether this was money in or out; it was assumed to be money out');
      confidence = 'low';
    }
    if (amount === null) {
      if (balance !== null) {
        // A balance-only row (e.g. an opening-balance line inside the table).
        if (/opening|brought forward/i.test(line.text) && st.openingBalanceCents == null) st.openingBalanceCents = balance;
        prevBalance = balance;
        continue;
      }
      st.rejectedRows.push({ sourceRow: line.page, reason: 'No amount could be read', raw: line.text });
      continue;
    }
    if (balance !== null) prevBalance = balance;

    const tx: ParsedTransaction = {
      sourceRow: st.transactions.length + 1,
      date,
      amountCents: amount,
      description: description || 'Unknown transaction',
      balanceCents: balance,
      externalId: null,
      reference: null,
      sourceColumn,
      confidence: description ? confidence : 'low',
      issues: description ? issues : [...issues, 'No description could be read'],
      raw: `page ${line.page}: ${raw}`,
    };
    st.transactions.push(tx);
    lastTx = tx;
    lastDate = date;
  }

  if (!header) st.warnings.push('No column headings (Debit / Credit / Balance) were recognised. Please check money in and out carefully.');
  if (st.transactions.length === 0) {
    st.warnings.push(doc ? 'There are no transactions for this account in this statement.' : 'No transactions could be read from this PDF.');
  }
  if (st.openingBalanceCents == null || st.closingBalanceCents == null) {
    st.warnings.push('Opening and closing balances were not both found, so the statement cannot be reconciled automatically.');
  }
  finaliseStatement(st);
  // PDF extraction is never "high" overall: the user always reviews it.
  st.confidence = lowestConfidence([st.confidence, 'medium']);
  return { statement: st, header: ownHeader };
}


/** Quick check used to decide if a text column in a PDF-derived table holds dates. */
export function looksLikeDates(values: string[]): boolean {
  return detectDateFormat(values) !== null;
}
