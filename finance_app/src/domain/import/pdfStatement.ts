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

export function buildLines(pages: PdfTextPage[]): Line[] {
  const lines: Line[] = [];
  for (const page of pages) {
    const items = page.items.filter((i) => i.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
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
        if (prev && gap < Math.max(charW * 1.6, 3.5)) {
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
  if (has('date') && (has('debit') || has('credit') || has('amount') || has('balance'))) return { roles, columns };
  return null;
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

export function parsePdfStatement(pages: PdfTextPage[], opts: PdfParseOptions = {}): ParsedStatement {
  const st = emptyStatement('pdf');
  const totalItems = pages.reduce((a, p) => a + p.items.filter((i) => i.str.trim()).length, 0);
  if (pages.length > 0 && totalItems < pages.length * 5) {
    st.ocrRequired = true;
    st.confidence = 'low';
    st.warnings.push(
      'This PDF appears to be a scanned image with no text layer. Reading it would need OCR (text recognition), which this version does not include. ' +
      'Please import a CSV or OFX export of the same statement, or enter the transactions manually.',
    );
    return st;
  }

  const lines = buildLines(pages);
  const allText = lines.map((l) => l.text).join('\n');
  const period = findStatementPeriod(allText);
  if (period) {
    st.periodStart = period.start;
    st.periodEnd = period.end;
  } else {
    st.warnings.push('No statement period was found. Dates without a year were given the most likely year — please check them.');
  }
  const acct = findAccountNumber(allText);
  st.account = { number: acct.number, bsb: acct.bsb, name: findAccountName(lines) };
  // Balances are stored in the app's convention: money owed on a card or loan is negative.
  const liability = opts.balanceMeaning === 'liability';
  const conv = (v: number | null) => (v === null ? null : liability ? -v : v);
  st.openingBalanceCents = conv(findLabelledBalance(lines, /opening(\s+account)?\s+balance|balance\s+brought\s+forward|previous\s+balance/i));
  st.closingBalanceCents = conv(findLabelledBalance(lines, /closing(\s+account)?\s+balance|balance\s+carried\s+forward|new\s+balance/i));
  const fallbackYear = opts.fallbackYear ?? (period ? parts(period.end).y : new Date().getFullYear());

  let header: HeaderColumns | null = null;
  let prevBalance: number | null = st.openingBalanceCents ?? null;
  let lastTx: ParsedTransaction | null = null;
  let lastDate: ISODate | null = null;
  let inTable = false;
  let headerLinesLeft = 0;
  // Statements that print money out with a minus sign ("-52.00") show money in without one.
  const explicitSigns = lines.some((l) => l.cells.some((c) => isMoneyToken(c.text) && /^\s*[-(]|-\s*$/.test(c.text)));

  for (const line of lines) {
    const h = detectHeader(line);
    if (h) {
      header = h;
      inTable = true;
      lastTx = null;
      headerLinesLeft = 2;
      continue;
    }
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
      continue;
    }
    const ld = leadingDate(line);
    // Amount cells: money tokens after the date/description.
    const moneyCells = line.cells.filter((c, i) => i > 0 || !ld ? isMoneyToken(c.text) : false);
    if (!ld && moneyCells.length === 0) {
      // Continuation of the previous description (wrapped text).
      if (lastTx && inTable && line.text.length < 120 && !/^(page|statement|account|bsb)\b/i.test(line.text)) {
        lastTx.description = `${lastTx.description} ${line.text.replace(/\s{2,}/g, ' ')}`.trim();
      }
      continue;
    }
    if (!ld && !inTable) continue;
    if (moneyCells.length === 0) continue;

    const issues: string[] = [];
    let confidence: Confidence = 'high';
    let date: ISODate | null = null;
    if (ld) {
      const r = resolveYear(ld.token, period, fallbackYear);
      date = r.date;
      if (r.inferred && !period) {
        confidence = 'medium';
        issues.push('The year was not printed on this row and was inferred');
      }
    } else if (lastDate) {
      date = lastDate;
      confidence = 'medium';
      issues.push('No date on this row; the date from the line above was used');
    }
    if (!date) {
      st.rejectedRows.push({ sourceRow: line.page, reason: 'Date could not be read', raw: line.text });
      continue;
    }

    // Description: text cells that are not the date or money.
    const descParts: string[] = [];
    if (ld?.rest) descParts.push(ld.rest);
    line.cells.forEach((c, i) => {
      if (i === 0 && ld) return;
      if (isMoneyToken(c.text)) return;
      if (parseRowDate(c.text) && descParts.length === 0 && i === 1) return; // processing date column
      descParts.push(c.text);
    });
    const description = descParts.join(' ').replace(/\s+/g, ' ').trim();

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
      raw: `page ${line.page}: ${line.text}`,
    };
    st.transactions.push(tx);
    lastTx = tx;
    lastDate = date;
  }

  if (!header) st.warnings.push('No column headings (Debit / Credit / Balance) were recognised. Please check money in and out carefully.');
  if (st.transactions.length === 0) st.warnings.push('No transactions could be read from this PDF.');
  if (st.openingBalanceCents == null || st.closingBalanceCents == null) {
    st.warnings.push('Opening and closing balances were not both found, so the statement cannot be reconciled automatically.');
  }
  finaliseStatement(st);
  // PDF extraction is never "high" overall: the user always reviews it.
  st.confidence = lowestConfidence([st.confidence, 'medium']);
  return st;
}

/** Quick check used to decide if a text column in a PDF-derived table holds dates. */
export function looksLikeDates(values: string[]): boolean {
  return detectDateFormat(values) !== null;
}
