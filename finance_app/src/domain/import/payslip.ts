import { parseMoney } from '../money';
import { ISODate } from '../dates';
import { buildLines, findStatementPeriod, isMoneyToken, PdfTextPage } from './pdfStatement';
import { parseDateAs } from './dateFormats';

/**
 * Reads the figures from a payslip PDF so the payslip form can be filled in for checking.
 * Payslips have no standard layout, so this looks for the usual labels ("Gross pay", "PAYG tax",
 * "Net pay", "Superannuation"…) and takes the amount for this pay — not the year-to-date column.
 * Nothing is saved until the person has checked the figures on the form.
 */

export interface PayslipRead {
  employer: string | null;
  payDate: ISODate | null;
  periodStart: ISODate | null;
  periodEnd: ISODate | null;
  grossCents: number | null;
  allowancesCents: number | null;
  salarySacrificeCents: number | null;
  paygCents: number | null;
  employerSuperCents: number | null;
  deductionsCents: number | null;
  netCents: number | null;
  /** Fields that were read from the file. */
  found: string[];
  warnings: string[];
}

type Field = 'gross' | 'allowances' | 'salarySacrifice' | 'payg' | 'employerSuper' | 'deductions' | 'net';

// Checked in this order on each line; the first field a label matches wins.
const LABELS: [Field, RegExp][] = [
  ['salarySacrifice', /salary\s*sacrifice|pre[\s-]?tax\s+(super|deduction)/i],
  ['net', /^(total\s+)?net(\s+(pay|payment|wages|income|amount|salary))?(\s+(paid|deposited))?\b|^take[\s-]?home(\s+pay)?\b|^amount\s+(paid|deposited|banked)\b|^(bank|eft)\s+(deposit|payment)s?\b/i],
  ['gross', /^(total\s+)?gross(\s+(pay|earnings|wages|income|payments?|salary))?\b|^total\s+(earnings|payments?|pay)\b/i],
  ['payg', /^(total\s+)?(payg(w)?(\s+(tax|withholding|withheld))?|income\s+tax|tax\s+withheld|withholding\s+tax|tax)\b(?!\s*(able|file|code|scale|free))/i],
  ['employerSuper', /^(employer\s+)?super(annuation)?(\s+(guarantee|contributions?|sgc?|employer))?\b|^SGC?\b|^super\s+guarantee/i],
  ['allowances', /^(total\s+)?allowances?\b/i],
  ['deductions', /^(total\s+)?(post[\s-]?tax|after[\s-]?tax)\s+deductions?\b/i],
];

const FIELD_NAME: Record<Field, string> = {
  gross: 'gross pay', allowances: 'allowances', salarySacrifice: 'salary sacrifice', payg: 'tax withheld', employerSuper: 'employer super', deductions: 'after-tax deductions', net: 'net pay',
};

const DATE = String.raw`(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|\d{4}-\d{2}-\d{2})`;

function anyDate(s: string): ISODate | null {
  const t = s.trim().replace(/(\d)(st|nd|rd|th)/, '$1').replace(',', '');
  return parseDateAs(t, 'DMY') ?? parseDateAs(t, 'D-MON-Y') ?? parseDateAs(t, 'YMD');
}

export function parsePayslip(pages: PdfTextPage[]): PayslipRead {
  const out: PayslipRead = {
    employer: null, payDate: null, periodStart: null, periodEnd: null, grossCents: null, allowancesCents: null, salarySacrificeCents: null,
    paygCents: null, employerSuperCents: null, deductionsCents: null, netCents: null, found: [], warnings: [],
  };
  const lines = buildLines(pages);
  // Columns headed "YTD" / "Year to date" hold running totals for the year, not this pay.
  const ytdColumns: { x0: number; x1: number }[] = [];
  for (const l of lines) for (const c of l.cells) if (/^(ytd|year\s+to\s+date)\b/i.test(c.text) && l.cells.length > 1) ytdColumns.push({ x0: c.x0, x1: c.x1 });
  const inYtd = (c: { x0: number; x1: number }) => ytdColumns.some((y) => c.x1 > y.x0 - 25 && c.x0 < y.x1 + 25);

  const values: Partial<Record<Field, number>> = {};
  const fieldOf = (text: string) => LABELS.find(([, re]) => re.test(text))?.[0];
  // Summary rows laid out as columns: "Gross pay | Tax | Net pay" with the amounts on the line below.
  lines.forEach((l, i) => {
    const labelled = l.cells.map((c) => ({ c, field: fieldOf(c.text) })).filter((x) => x.field);
    if (labelled.length < 2 || l.cells.some((c) => isMoneyToken(c.text))) return;
    const below = lines[i + 1];
    if (!below || below.page !== l.page || l.y - below.y > 30) return;
    for (const { c, field } of labelled) {
      const mid = (c.x0 + c.x1) / 2;
      const cell = below.cells.find((m) => isMoneyToken(m.text) && Math.abs((m.x0 + m.x1) / 2 - mid) < 45 && !inYtd(m));
      const v = cell ? parseMoney(cell.text)?.cents : undefined;
      if (v !== undefined && values[field!] === undefined) values[field!] = Math.abs(v);
    }
  });
  let allowanceLines = 0;
  for (const l of lines) {
    const label = l.cells[0]?.text ?? '';
    const field = fieldOf(label);
    if (!field && /allowance/i.test(label)) {
      // Individual allowances ("Laundry allowance") are added up when there is no total line.
      const cell = l.cells.slice(1).find((c) => isMoneyToken(c.text) && !inYtd(c));
      const v = cell ? parseMoney(cell.text)?.cents : undefined;
      if (v) allowanceLines += Math.abs(v);
      continue;
    }
    if (!field || values[field] !== undefined) continue;
    // The amount for this pay: the first money cell to the right of the label that is not year-to-date.
    let amount: number | null = null;
    const inline = label.match(/(-?\$?\s?\d[\d,]*\.\d{2})\s*$/);
    if (inline) amount = parseMoney(inline[1])?.cents ?? null;
    if (amount === null) {
      const cell = l.cells.slice(1).find((c) => isMoneyToken(c.text) && !inYtd(c));
      if (cell) amount = parseMoney(cell.text)?.cents ?? null;
    }
    if (amount !== null) values[field] = Math.abs(amount);
  }
  out.grossCents = values.gross ?? null;
  out.allowancesCents = values.allowances ?? (allowanceLines || null);
  out.salarySacrificeCents = values.salarySacrifice ?? null;
  out.paygCents = values.payg ?? null;
  out.employerSuperCents = values.employerSuper ?? null;
  out.netCents = values.net ?? null;
  // After-tax deductions are whatever is left between gross and net once tax and salary sacrifice are taken out.
  if (out.grossCents !== null && out.netCents !== null && out.paygCents !== null) {
    const rest = out.grossCents - (out.salarySacrificeCents ?? 0) - out.paygCents - out.netCents;
    out.deductionsCents = rest > 0 ? rest : values.deductions ?? 0;
  } else {
    out.deductionsCents = values.deductions ?? null;
  }
  out.found = (Object.keys(values) as Field[]).map((f) => FIELD_NAME[f]);
  if (values.allowances === undefined && allowanceLines) out.found.push(FIELD_NAME.allowances);

  const text = lines.map((l) => l.text.replace(/\s{2,}/g, ' ')).join('\n');
  const paid = text.match(new RegExp(String.raw`(?:pay(?:ment)?\s+date|date\s+paid|paid\s+on|pay\s+day|payment\s+made)\s*:?\s*${DATE}`, 'i'));
  if (paid) out.payDate = anyDate(paid[1]);
  const period = text.match(new RegExp(String.raw`period\s*(?:from|start(?:ing)?|beginning)?\s*:?\s*${DATE}\s*(?:to|until|-|–|—)\s*${DATE}`, 'i')) ?? null;
  if (period) {
    out.periodStart = anyDate(period[1]);
    out.periodEnd = anyDate(period[2]);
  } else {
    const p = findStatementPeriod(text);
    if (p) { out.periodStart = p.start; out.periodEnd = p.end; }
    const start = text.match(new RegExp(String.raw`period\s+(?:start|from|beginning)\s*:?\s*${DATE}`, 'i'));
    const end = text.match(new RegExp(String.raw`period\s+(?:end(?:ing)?|to)\s*:?\s*${DATE}`, 'i'));
    if (start) out.periodStart = anyDate(start[1]);
    if (end) out.periodEnd = anyDate(end[1]);
  }
  out.payDate ??= out.periodEnd;

  for (const l of lines.slice(0, 40)) {
    const t = l.text.replace(/\s{2,}/g, ' ').trim();
    const labelled = t.match(/^(?:employer|company|business\s+name|paid\s+by)\s*:?\s+(.+)$/i);
    if (labelled) { out.employer = labelled[1].replace(/\bABN\b.*$/i, '').trim(); break; }
    if (!out.employer && /\b(PTY\.?\s*LTD|LIMITED|P\/L|PTY)\b/i.test(t) && t.length <= 80) out.employer = l.cells[0].text.replace(/\bABN\b.*$/i, '').trim();
  }

  const missing = (['gross', 'payg', 'net'] as Field[]).filter((f) => values[f] === undefined).map((f) => FIELD_NAME[f]);
  if (missing.length) out.warnings.push(`Not found on the payslip: ${missing.join(', ')}. Type ${missing.length === 1 ? 'it' : 'them'} in from the payslip.`);
  if (!out.payDate) out.warnings.push('The pay date was not found. Enter it before saving.');
  if (ytdColumns.length) out.warnings.push('Year-to-date figures on the payslip were ignored; only this pay was read.');
  return out;
}
