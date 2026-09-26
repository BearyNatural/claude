/**
 * Calendar dates are plain ISO strings ("2026-09-27") with no time or time zone.
 * All arithmetic is done on UTC day numbers so results never shift with the
 * computer's time zone or daylight saving.
 */
export type ISODate = string;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function makeDate(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isValidDate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parts(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) && y >= 1900 && y <= 2200;
}

export function parts(date: ISODate): { y: number; m: number; d: number } {
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) };
}

export function toDayNumber(date: ISODate): number {
  const { y, m, d } = parts(date);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function fromDayNumber(n: number): ISODate {
  const dt = new Date(n * 86400000);
  return makeDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + days);
}

/**
 * Add months, clamping to the end of the month (31 Jan + 1 month = 28/29 Feb).
 * `anchorDay` keeps a schedule on its original day (e.g. the 31st) instead of drifting.
 */
export function addMonths(date: ISODate, months: number, anchorDay?: number): ISODate {
  const { y, m, d } = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(anchorDay ?? d, daysInMonth(ny, nm));
  return makeDate(ny, nm, day);
}

export function addYears(date: ISODate, years: number): ISODate {
  return addMonths(date, years * 12);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** Whole months from a to b (floor), e.g. 15 Jan → 14 Mar = 1. */
export function diffMonths(a: ISODate, b: ISODate): number {
  const pa = parts(a);
  const pb = parts(b);
  let months = (pb.y - pa.y) * 12 + (pb.m - pa.m);
  if (pb.d < pa.d && pb.d !== daysInMonth(pb.y, pb.m)) months -= 1;
  return months;
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(...dates: ISODate[]): ISODate {
  return dates.reduce((a, b) => (a < b ? a : b));
}

export function maxDate(...dates: ISODate[]): ISODate {
  return dates.reduce((a, b) => (a > b ? a : b));
}

export function isBetween(date: ISODate, start: ISODate, end: ISODate): boolean {
  return date >= start && date <= end;
}

export function startOfMonth(date: ISODate): ISODate {
  return date.slice(0, 8) + '01';
}

export function endOfMonth(date: ISODate): ISODate {
  const { y, m } = parts(date);
  return makeDate(y, m, daysInMonth(y, m));
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function weekday(date: ISODate): number {
  const dow = new Date(toDayNumber(date) * 86400000).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Start of the week containing `date`. Default week starts Monday. */
export function startOfWeek(date: ISODate, weekStartsOn: 1 | 7 = 1): ISODate {
  const wd = weekday(date);
  const offset = weekStartsOn === 1 ? wd - 1 : wd % 7;
  return addDays(date, -offset);
}

export function startOfQuarter(date: ISODate): ISODate {
  const { y, m } = parts(date);
  return makeDate(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
}

export function endOfQuarter(date: ISODate): ISODate {
  return addDays(addMonths(startOfQuarter(date), 3), -1);
}

/* ---------------- Australian financial years (1 July – 30 June) ---------------- */

/** Financial-year label for a date, e.g. 2026-09-27 → "2026-27". */
export function financialYearOf(date: ISODate): string {
  const { y, m } = parts(date);
  const startYear = m >= 7 ? y : y - 1;
  return fyLabel(startYear);
}

export function fyLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function fyStartYear(fy: string): number {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`Not a financial year label: ${fy}`);
  return Number(m[1]);
}

export function fyRange(fy: string): { start: ISODate; end: ISODate } {
  const y = fyStartYear(fy);
  return { start: makeDate(y, 7, 1), end: makeDate(y + 1, 6, 30) };
}

/** "2026–27" with an en dash for display. */
export function fyDisplay(fy: string): string {
  return fy.replace('-', '–');
}

export function previousFy(fy: string): string {
  return fyLabel(fyStartYear(fy) - 1);
}

export function nextFy(fy: string): string {
  return fyLabel(fyStartYear(fy) + 1);
}

/* ---------------- Formatting ---------------- */

/** "02 Aug 2026" */
export function formatDate(date: ISODate | null | undefined, opts: { long?: boolean; noYear?: boolean } = {}): string {
  if (!date || !isValidDate(date)) return '—';
  const { y, m, d } = parts(date);
  const month = opts.long ? MONTHS_LONG[m - 1] : MONTHS_SHORT[m - 1];
  return opts.noYear ? `${d} ${month}` : `${String(d).padStart(opts.long ? 1 : 2, '0')} ${month} ${y}`;
}

export function formatMonth(date: ISODate): string {
  const { y, m } = parts(date);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

export function monthNames(): { short: string[]; long: string[] } {
  return { short: [...MONTHS_SHORT], long: [...MONTHS_LONG] };
}

/** "3 days ago", "today", "in 5 days" relative to `today`. */
export function relativeDays(date: ISODate, today: ISODate): string {
  const n = diffDays(today, date);
  if (n === 0) return 'today';
  if (n === -1) return 'yesterday';
  if (n === 1) return 'tomorrow';
  if (n < 0) {
    const a = -n;
    if (a < 60) return `${a} days ago`;
    if (a < 730) return `${Math.round(a / 30.44)} months ago`;
    return `${Math.round(a / 365.25)} years ago`;
  }
  if (n < 60) return `in ${n} days`;
  if (n < 730) return `in ${Math.round(n / 30.44)} months`;
  return `in ${Math.round(n / 365.25)} years`;
}

/** Today's date in the computer's local time zone. */
export function localToday(now: Date = new Date()): ISODate {
  return makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let n = toDayNumber(start), e = toDayNumber(end); n <= e; n++) out.push(fromDayNumber(n));
  return out;
}

export function eachMonthStart(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = startOfMonth(start); d <= end; d = addMonths(d, 1)) out.push(d);
  return out;
}
