import { parseMoney } from '../money';
import { ISODate } from '../dates';
import { buildLines, isMoneyToken, PdfTextPage } from './pdfStatement';
import { parseDateAs } from './dateFormats';

/**
 * Reads the figures from a payslip PDF so the payslip form can be filled in for checking.
 * Payslips have no standard layout, so this looks for the usual labels ("Gross pay", "PAYG tax",
 * "Net pay", "Superannuation"…) wherever they sit on a line, and takes the amount for this pay —
 * never a year-to-date figure. Nothing is saved until the person has checked the form.
 */

export interface PayslipRead {
  employer: string | null;
  /** The employer's ABN when printed (used to remember an employer whose name isn't printed). */
  employerAbn: string | null;
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

interface Cell { text: string; x0: number; x1: number }
interface Line { page: number; y: number; cells: Cell[]; text: string }

const SUPER_WORD = /super(annuation)?|\bSGC?\b/i;
// Contributions the employee makes (salary sacrifice, personal) are not the employer's super.
const NOT_EMPLOYER_SUPER = /sacrifice|member|personal|voluntary|emp\s*ee\b|employee|pre[\s-]?tax|post[\s-]?tax|after[\s-]?tax|non[\s-]?concessional/i;

/** Label → field, with a tier: a lower tier wins ("Gross pay" over "Total earnings"). */
function fieldOf(raw: string): { field: Field; tier: number } | null {
  const t = raw.replace(/^[*•·\-–\s]+/, '').trim();
  if (!t || /^(ytd|year[\s-]+to[\s-]+date)\b/i.test(t)) return null;
  if (/salary\s*sacrifice|pre[\s-]?tax\s+(super|deductions?)/i.test(t)) return { field: 'salarySacrifice', tier: 1 };
  if (/^(total\s+)?net(\s+(pay|payment|wages|income|amount|salary))?(\s+(paid|deposited))?\b|^take[\s-]?home(\s+pay)?\b|^amount\s+(paid|deposited|banked)\b/i.test(t)) return { field: 'net', tier: 1 };
  if (/^(total\s+)?gross(\s+(pay|earnings|wages|income|payments?|salary))?\b/i.test(t)) return { field: 'gross', tier: 1 };
  if (/^total\s+(earnings|payments?|pay)\b/i.test(t)) return { field: 'gross', tier: 2 };
  if (/^(total\s+)?(payg(w)?(\s+(tax|withholding|withheld))?|income\s+tax|tax\s+withheld|withholding\s+tax|tax)\b(?!\s*(able|file|code|scale|free|ind|indicator|offset|bracket))/i.test(t)) return { field: 'payg', tier: 1 };
  if (SUPER_WORD.test(t) && !NOT_EMPLOYER_SUPER.test(t)) return { field: 'employerSuper', tier: /^(emp(lo)?(yer|er)\b|employer|super|sgc?\b)/i.test(t) ? 1 : 2 };
  if (/^(total\s+)?allowances?\b/i.test(t)) return { field: 'allowances', tier: 1 };
  if (/^(total\s+)?(post[\s-]?tax|after[\s-]?tax)\s+deductions?\b/i.test(t)) return { field: 'deductions', tier: 1 };
  return null;
}

const FIELD_NAME: Record<Field, string> = {
  gross: 'gross pay', allowances: 'allowances', salarySacrifice: 'salary sacrifice', payg: 'tax withheld', employerSuper: 'employer super', deductions: 'after-tax deductions', net: 'net pay',
};

const DATE = String.raw`(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?[\s-]+[A-Za-z]{3,9}\.?,?[\s-]+\d{4}|\d{4}-\d{2}-\d{2})`;

function anyDate(s: string): ISODate | null {
  const t = s.trim().replace(/(\d)(st|nd|rd|th)/, '$1').replace(',', '');
  return parseDateAs(t, 'DMY') ?? parseDateAs(t, 'D-MON-Y') ?? parseDateAs(t, 'YMD');
}

const isText = (c: Cell) => !isMoneyToken(c.text);

export const formatAbn = (abn: string) => abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');

/**
 * Where the year-to-date figures are. Three layouts are common:
 *  - a section titled "Year to date…" on its own line: everything below it, across the page;
 *  - "Year To Date | This Period" side by side: the left half, up to the "This Period" heading;
 *  - a "YTD" column next to a "This pay" column: that column.
 * Each zone runs down the page until the next section title.
 */
export interface Zone { page: number; top: number; bottom: number; x0: number; x1: number }

export function ytdZones(lines: Line[]): Zone[] {
  const zones: Zone[] = [];
  lines.forEach((l, i) => {
    l.cells.forEach((c) => {
      if (!/^(ytd|year[\s-]+to[\s-]+date)\b/i.test(c.text)) return;
      let bottom = l.y;
      for (let j = i + 1; j < lines.length; j++) {
        const n = lines[j];
        if (n.page !== l.page || lines[j - 1].y - n.y > 40) break;
        // A new section title: one text cell that isn't a label and isn't year-to-date.
        if (n.cells.length === 1 && isText(n.cells[0]) && !fieldOf(n.cells[0].text) && !/^(ytd|year[\s-]+to[\s-]+date)\b/i.test(n.cells[0].text)) break;
        bottom = n.y;
      }
      const thisPeriod = l.cells.find((o) => o !== c && /^(this\s+(period|pay)|current(\s+period)?|period)\b/i.test(o.text));
      let x0 = c.x0 - 25, x1 = c.x1 + 25;
      if (l.cells.length === 1) { x0 = -Infinity; x1 = Infinity; } else if (thisPeriod && thisPeriod.x0 > c.x1) { x0 = c.x0 - 10; x1 = thisPeriod.x0 - 5; }
      zones.push({ page: l.page, top: l.y + 2, bottom: bottom - 2, x0, x1 });
    });
  });
  return zones;
}

export function parsePayslip(pages: PdfTextPage[]): PayslipRead {
  const out: PayslipRead = {
    employer: null, employerAbn: null, payDate: null, periodStart: null, periodEnd: null, grossCents: null, allowancesCents: null, salarySacrificeCents: null,
    paygCents: null, employerSuperCents: null, deductionsCents: null, netCents: null, found: [], warnings: [],
  };
  const lines = buildLines(pages) as Line[];
  const zones = ytdZones(lines);
  const inYtd = (c: Cell, l: Line) => zones.some((z) => z.page === l.page && l.y <= z.top && l.y >= z.bottom && c.x1 > z.x0 && c.x0 < z.x1);

  const candidates: { field: Field; tier: number; cents: number; order: number }[] = [];
  let order = 0;
  let allowanceLines = 0;
  const amountAfter = (l: Line, i: number): number | null => {
    // The first money amount to the right of the label, before the next label, that isn't year-to-date.
    for (let k = i + 1; k < l.cells.length; k++) {
      const c = l.cells[k];
      if (isText(c) && fieldOf(c.text)) return null;
      if (isMoneyToken(c.text) && !inYtd(c, l)) return parseMoney(c.text)?.cents ?? null;
    }
    return null;
  };

  // 1. Labels followed by their amount on the same line ("Tax  600.00", "Total Gross  2,500.00").
  for (const l of lines) {
    l.cells.forEach((c, i) => {
      if (!isText(c) || inYtd(c, l)) return;
      const f = fieldOf(c.text);
      const inline = c.text.match(/(-?\$?\s?\d[\d,]*\.\d{2})\s*$/);
      const cents = inline ? parseMoney(inline[1])?.cents ?? null : amountAfter(l, i);
      if (!f) {
        // Individual allowances ("Laundry allowance") are added up when there is no total line.
        if (/allowance/i.test(c.text) && cents) allowanceLines += Math.abs(cents);
        return;
      }
      if (cents !== null) candidates.push({ field: f.field, tier: f.tier, cents: Math.abs(cents), order: order++ });
    });
  }

  // 2. Totals laid out as columns: "Gross | Tax | Net Pay" with the amounts on the line below.
  //    A super contributions table ("Company Superannuation Contributions | Nett | Tax | Gross")
  //    is not the pay summary: its amount is the employer's super.
  lines.forEach((l, i) => {
    if (l.cells.some((c) => isMoneyToken(c.text)) || l.cells.length < 2) return;
    const below = lines[i + 1];
    if (!below || below.page !== l.page || l.y - below.y > 30) return;
    if (SUPER_WORD.test(l.cells[0].text) && !NOT_EMPLOYER_SUPER.test(l.cells[0].text)) {
      const col = l.cells.find((c) => /^(gross|amount|total|contribution)/i.test(c.text));
      for (let j = i + 1; j < lines.length && lines[j].page === l.page; j++) {
        const row = lines[j];
        const money = row.cells.filter((c) => isMoneyToken(c.text) && !inYtd(c, row));
        if (!money.length || NOT_EMPLOYER_SUPER.test(row.text)) break;
        const pick = col ? money.reduce((a, b) => (Math.abs((b.x0 + b.x1) / 2 - (col.x0 + col.x1) / 2) < Math.abs((a.x0 + a.x1) / 2 - (col.x0 + col.x1) / 2) ? b : a)) : money[money.length - 1];
        const cents = parseMoney(pick.text)?.cents;
        if (cents !== undefined) candidates.push({ field: 'employerSuper', tier: 1, cents: Math.abs(cents), order: order++ });
      }
      return;
    }
    const labelled = l.cells.map((c) => ({ c, f: fieldOf(c.text) })).filter((x) => x.f && !inYtd(x.c, l));
    if (labelled.length < 2) return;
    for (const { c, f } of labelled) {
      const mid = (c.x0 + c.x1) / 2;
      const cell = below.cells.find((m) => isMoneyToken(m.text) && Math.abs((m.x0 + m.x1) / 2 - mid) < 45 && !inYtd(m, below));
      const cents = cell ? parseMoney(cell.text)?.cents : undefined;
      if (cents !== undefined) candidates.push({ field: f!.field, tier: f!.tier + 0.5, cents: Math.abs(cents), order: order++ });
    }
  });

  // Best candidate per field: lowest tier, then first on the page. Gross and net pay are never zero.
  const values: Partial<Record<Field, number>> = {};
  for (const field of Object.keys(FIELD_NAME) as Field[]) {
    const list = candidates.filter((c) => c.field === field && !((field === 'gross' || field === 'net') && c.cents === 0))
      .sort((a, b) => a.tier - b.tier || (a.cents === 0 ? 1 : 0) - (b.cents === 0 ? 1 : 0) || a.order - b.order);
    if (list.length) values[field] = list[0].cents;
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

  // Dates: after a label ("Payment Date 30 Jul 2026", "Banked: 25-JUN-2026") or under a column heading.
  const text = lines.map((l) => l.text.replace(/\s{2,}/g, ' ')).join('\n');
  const paid = text.match(new RegExp(String.raw`(?:pay(?:ment)?\s+date|date\s+paid|paid\s+on|pay\s+day|payment\s+made|banked|deposited)\s*:?\s*${DATE}`, 'i'));
  if (paid) out.payDate = anyDate(paid[1]);
  const period = text.match(new RegExp(String.raw`period\s*(?:from|start(?:ing)?|beginning|commencing)?\s*:?\s*${DATE}\s*(?:to|until|up\s+to|-|–|—)\s*${DATE}`, 'i'));
  if (period) {
    out.periodStart = anyDate(period[1]);
    out.periodEnd = anyDate(period[2]);
  } else {
    const start = text.match(new RegExp(String.raw`period\s+(?:start|from|beginning|commencing)\s*:?\s*${DATE}`, 'i'));
    const end = text.match(new RegExp(String.raw`period\s+(?:end(?:ing)?|to)\s*:?\s*${DATE}`, 'i'));
    if (start) out.periodStart = anyDate(start[1]);
    if (end) out.periodEnd = anyDate(end[1]);
  }
  const under = (heading: RegExp): ISODate | null => {
    for (let i = 0; i < lines.length; i++) {
      const h = lines[i].cells.find((c) => heading.test(c.text));
      if (!h) continue;
      const mid = (h.x0 + h.x1) / 2;
      for (let j = i + 1; j < Math.min(lines.length, i + 4) && lines[j].page === lines[i].page && lines[i].y - lines[j].y < 30; j++) {
        const c = lines[j].cells.find((d) => Math.abs((d.x0 + d.x1) / 2 - mid) < 40 && anyDate(d.text));
        if (c) return anyDate(c.text);
      }
    }
    return null;
  };
  out.payDate ??= under(/^(pay(ment)?\s+date|date\s+paid|paid\s+on|pay\s+day)$/i);
  // A single date under "Pay Period" is the end of the period ("Pay Period / Month End").
  out.periodEnd ??= under(/^(pay\s+)?period(\s+end(ing)?)?$/i);
  out.payDate ??= out.periodEnd;

  // Employer: a labelled name ("Employer: …"), otherwise the first company name on the payslip.
  for (const l of lines) {
    const t = l.text.replace(/\s{2,}/g, ' ').trim();
    const labelled = t.match(/^(?:employer(?:\s+name)?|company(?:\s+name)?|business\s+name|paid\s+by)\s*:\s*(.+)$/i) ?? t.match(/^employer\s+name\s+(.+)$/i);
    if (labelled) { out.employer = labelled[1].replace(/\s*\(?\bABN\b.*$/i, '').trim(); break; }
  }
  if (!out.employer) {
    const company = lines.flatMap((l) => l.cells).find((c) => /\b(PTY\.?\s*LTD|LIMITED|P\/L|PTY)\b/i.test(c.text) && c.text.length <= 90 && !SUPER_WORD.test(c.text));
    if (company) out.employer = company.text.replace(/\s*\(?\bABN\b.*$/i, '').trim();
  }
  const abn = text.match(/\bABN\b\)?\s*:?\s*(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})/i);
  out.employerAbn = abn ? abn[1].replace(/\s/g, '') : null;
  if (!out.employer) {
    out.warnings.push(`The employer's name is not printed on this payslip${out.employerAbn ? ` (ABN ${formatAbn(out.employerAbn)}). Type it in — Geranium will remember it for this employer's next payslip` : '. Type it in'}.`);
  }

  const missing = (['gross', 'payg', 'net'] as Field[]).filter((f) => values[f] === undefined).map((f) => FIELD_NAME[f]);
  if (missing.length) out.warnings.push(`Not found on the payslip: ${missing.join(', ')}. Type ${missing.length === 1 ? 'it' : 'them'} in from the payslip.`);
  if (!out.payDate) out.warnings.push('The pay date was not found. Enter it before saving.');
  if (zones.length) out.warnings.push('Year-to-date figures on the payslip were ignored; only this pay was read.');
  return out;
}
