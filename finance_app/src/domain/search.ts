import { ISODate, addDays, addMonths, addYears, financialYearOf, fyRange, fyDisplay, formatDate, isValidDate, makeDate, parts, previousFy, startOfMonth, endOfMonth } from './dates';
import { Cents, formatMoney, parseMoney } from './money';
import { IncomeType } from './categorise/categories';

/**
 * Deterministic search: turns a plain-English query into explicit filters and shows the user
 * exactly how it was understood (as "chips"). No AI is involved.
 */

export interface SearchFilter {
  text: string[];
  categoryNames: string[];
  accountNames: string[];
  tags: string[];
  minAbsCents?: Cents;
  maxAbsCents?: Cents;
  direction?: 'in' | 'out';
  from?: ISODate;
  to?: ISODate;
  incomeTypes: IncomeType[];
  deductible?: boolean;
  business?: boolean;
  oneOff?: boolean;
  uncategorised?: boolean;
}

export interface ParsedSearch {
  filter: SearchFilter;
  chips: string[];
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const STOP = new Set(['show', 'me', 'all', 'every', 'the', 'a', 'an', 'of', 'for', 'during', 'in', 'on', 'with', 'marked', 'transactions', 'transaction', 'payments', 'payment', 'items', 'my', 'and', 'from', 'to', 'that', 'were', 'was', 'is', 'are', 'list', 'find', 'any']);

const INCOME_WORDS: [RegExp, IncomeType[]][] = [
  [/\bdividends?\b/i, ['dividends', 'managed-fund-distribution', 'trust-distribution']],
  [/\binterest\b/i, ['interest', 'term-deposit-interest']],
  [/\b(salary|wages?|pay)\b/i, ['salary', 'wages']],
  [/\bcontract(or|ing)?\b/i, ['contractor']],
  [/\bsole[- ]trader\b/i, ['sole-trader']],
  [/\brental\b/i, ['rental']],
  [/\bgovernment\b|\bcentrelink\b/i, ['government']],
];

function amountAfter(s: string): Cents | null {
  const p = parseMoney(s.replace(/k$/i, '000'));
  return p ? Math.abs(p.cents) : null;
}

export function parseSearch(query: string, today: ISODate, categoryNames: string[] = [], accountNames: string[] = []): ParsedSearch {
  const f: SearchFilter = { text: [], categoryNames: [], accountNames: [], tags: [], incomeTypes: [] };
  const chips: string[] = [];
  let q = ` ${query.replace(/[“”]/g, '"').replace(/[–—]/g, '-')} `;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = q.match(re);
    if (m) {
      fn(m);
      q = q.replace(re, ' ');
      return true;
    }
    return false;
  };

  // Tags and explicit fields.
  while (take(/\b(?:tag:|#|tagged\s+)"?([\w-]+)"?/i, (m) => f.tags.push(m[1].toLowerCase())));
  while (take(/\bcategory:"?([^"]+?)"?(?=\s|$)/i, (m) => f.categoryNames.push(m[1])));
  while (take(/\baccount:"?([^"]+?)"?(?=\s|$)/i, (m) => f.accountNames.push(m[1])));

  // Amounts.
  const AMT = String.raw`(\$?\d[\d,]*(?:\.\d+)?k?)`;
  take(new RegExp(String.raw`\bbetween\s+${AMT}\s+and\s+${AMT}`, 'i'), (m) => { // nosemgrep: detect-non-literal-regexp — built from constants
    f.minAbsCents = amountAfter(m[1]) ?? undefined;
    f.maxAbsCents = amountAfter(m[2]) ?? undefined;
  });
  take(new RegExp(String.raw`(?:\bover|\babove|\bmore than|>=?)\s*${AMT}`, 'i'), (m) => (f.minAbsCents = amountAfter(m[1]) ?? undefined)); // nosemgrep
  take(new RegExp(String.raw`(?:\bunder|\bbelow|\bless than|<=?)\s*${AMT}`, 'i'), (m) => (f.maxAbsCents = amountAfter(m[1]) ?? undefined)); // nosemgrep

  // Dates.
  const fyToken = /\bfy\s*(\d{4})\s*-\s*(\d{2,4})\b/i;
  take(fyToken, (m) => {
    const fy = `${m[1]}-${m[2].slice(-2)}`;
    ({ start: f.from, end: f.to } = fyRange(fy));
    chips.push(`Financial year ${fyDisplay(fy)}`);
  });
  take(/\bthis financial year\b/i, () => {
    const fy = financialYearOf(today);
    ({ start: f.from, end: f.to } = fyRange(fy));
    chips.push(`Financial year ${fyDisplay(fy)}`);
  });
  take(/\blast financial year\b/i, () => {
    const fy = previousFy(financialYearOf(today));
    ({ start: f.from, end: f.to } = fyRange(fy));
    chips.push(`Financial year ${fyDisplay(fy)}`);
  });
  take(/\b(?:last|past|previous)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(years?|months?|weeks?|days?)\b/i, (m) => {
    const n = NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
    const unit = m[2].toLowerCase();
    f.to = today;
    f.from = unit.startsWith('year') ? addYears(today, -n) : unit.startsWith('month') ? addMonths(today, -n) : unit.startsWith('week') ? addDays(today, -7 * n) : addDays(today, -n);
  });
  take(/\bthis month\b/i, () => { f.from = startOfMonth(today); f.to = today; });
  take(/\blast month\b/i, () => { const s = addMonths(startOfMonth(today), -1); f.from = s; f.to = endOfMonth(s); });
  take(/\bthis year\b/i, () => { f.from = makeDate(parts(today).y, 1, 1); f.to = today; });
  take(/\bsince\s+(\d{4}-\d{2}-\d{2})\b/i, (m) => { if (isValidDate(m[1])) f.from = m[1]; });
  take(/\bbefore\s+(\d{4}-\d{2}-\d{2})\b/i, (m) => { if (isValidDate(m[1])) f.to = addDays(m[1], -1); });
  take(/\bin\s+((?:19|20)\d{2})\b/i, (m) => { f.from = `${m[1]}-01-01`; f.to = `${m[1]}-12-31`; });
  if (f.from && f.to && !chips.some((c) => c.startsWith('Financial year'))) chips.push(`Dates ${formatDate(f.from)} – ${formatDate(f.to)}`);

  // Meaning words.
  take(/\bdeductible\b|\btax[- ]deductible\b/i, () => { f.deductible = true; chips.push('Marked as tax deductible'); });
  take(/\bbusiness\b/i, () => { f.business = true; chips.push('Business or mixed use'); });
  take(/\bone[- ]offs?\b/i, () => { f.oneOff = true; chips.push('One-off transactions'); });
  take(/\buncategori[sz]ed\b/i, () => { f.uncategorised = true; chips.push('Uncategorised'); });
  const incomeLabels: string[] = [];
  for (const [re, types] of INCOME_WORDS) {
    const m = q.match(re);
    if (m && /\b(income|received|earned|paid to me)\b/i.test(query)) {
      q = q.replace(re, ' ');
      f.incomeTypes.push(...types);
      incomeLabels.push(m[0].toLowerCase());
      f.direction = 'in';
    }
  }
  if (incomeLabels.length) chips.push(`Income: ${incomeLabels.join(', ')}`);
  take(/\b(income|received|deposits?|credits?|money in)\b/i, () => { f.direction = 'in'; });
  take(/\b(expenses?|spending|spent|debits?|purchases?|money out|costs?)\b/i, () => { f.direction = 'out'; });
  if (f.direction && !f.incomeTypes.length) chips.push(f.direction === 'in' ? 'Money in' : 'Money out');

  // Category and account names mentioned in the remaining words (longest first).
  const lower = () => q.toLowerCase();
  for (const name of [...categoryNames].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`); // nosemgrep: detect-non-literal-regexp — escaped category name
    if (name.length >= 3 && re.test(lower())) {
      f.categoryNames.push(name);
      q = q.replace(new RegExp(re.source, 'i'), ' '); // nosemgrep
    }
  }
  for (const name of [...accountNames].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`); // nosemgrep
    if (name.length >= 3 && re.test(lower())) {
      f.accountNames.push(name);
      q = q.replace(new RegExp(re.source, 'i'), ' '); // nosemgrep
    }
  }
  for (const c of f.categoryNames) chips.push(`Category: ${c}`);
  for (const a of f.accountNames) chips.push(`Account: ${a}`);
  for (const t of f.tags) chips.push(`Tag: ${t}`);
  if (f.minAbsCents !== undefined && f.maxAbsCents !== undefined) chips.push(`Amount ${formatMoney(f.minAbsCents)} – ${formatMoney(f.maxAbsCents)}`);
  else if (f.minAbsCents !== undefined) chips.push(`Amount over ${formatMoney(f.minAbsCents)}`);
  else if (f.maxAbsCents !== undefined) chips.push(`Amount under ${formatMoney(f.maxAbsCents)}`);

  const words = q.replace(/["'.,;:!?]/g, ' ').split(/\s+/).map((w) => w.trim()).filter((w) => w && !STOP.has(w.toLowerCase()));
  if (words.length) {
    f.text = words;
    chips.push(`Text: "${words.join(' ')}"`);
  }
  return { filter: f, chips };
}

export interface SearchableTx {
  date: ISODate;
  amountCents: Cents;
  description: string;
  payee?: string | null;
  notes?: string | null;
  categoryName?: string | null;
  categoryPath?: string[];
  accountName: string;
  tags: string[];
  incomeType?: IncomeType | null;
  taxClass?: string | null;
  businessUse?: string | null;
  isOneOff?: boolean;
  categoryId?: string | null;
}

export function matchesSearch(t: SearchableTx, f: SearchFilter): boolean {
  if (f.from && t.date < f.from) return false;
  if (f.to && t.date > f.to) return false;
  const abs = Math.abs(t.amountCents);
  if (f.minAbsCents !== undefined && abs <= f.minAbsCents) return false;
  if (f.maxAbsCents !== undefined && abs > f.maxAbsCents) return false;
  if (f.direction === 'in' && t.amountCents <= 0) return false;
  if (f.direction === 'out' && t.amountCents >= 0) return false;
  if (f.tags.length && !f.tags.every((tag) => t.tags.map((x) => x.toLowerCase()).includes(tag))) return false;
  if (f.categoryNames.length) {
    const names = [t.categoryName, ...(t.categoryPath ?? [])].filter(Boolean).map((n) => n!.toLowerCase());
    if (!f.categoryNames.some((c) => names.includes(c.toLowerCase()))) return false;
  }
  if (f.accountNames.length && !f.accountNames.some((a) => a.toLowerCase() === t.accountName.toLowerCase())) return false;
  if (f.incomeTypes.length && (!t.incomeType || !f.incomeTypes.includes(t.incomeType))) return false;
  if (f.deductible && t.taxClass !== 'deductible') return false;
  if (f.business && !(t.businessUse === 'business' || t.businessUse === 'mixed')) return false;
  if (f.oneOff && !t.isOneOff) return false;
  if (f.uncategorised && t.categoryId) return false;
  if (f.text.length) {
    const hay = `${t.description} ${t.payee ?? ''} ${t.notes ?? ''} ${t.categoryName ?? ''}`.toLowerCase();
    if (!f.text.every((w) => hay.includes(w.toLowerCase()))) return false;
  }
  return true;
}
