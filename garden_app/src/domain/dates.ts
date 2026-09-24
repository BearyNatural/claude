/**
 * Calendar-date utilities.
 *
 * Gardening advice is about *local calendar days* ("sow on Saturday"), not
 * instants. We therefore represent dates as 'YYYY-MM-DD' strings in the
 * gardener's timezone and do arithmetic on them via UTC-midnight Date objects,
 * which avoids daylight-saving shifts (relevant for NSW/VIC/TAS/SA/ACT but not
 * QLD/NT/WA).
 */
import type { ISODate, Month, Weekday } from './types';

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toUTC(date: ISODate): Date {
  const m = ISO_DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid ISO date: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUTC(d: Date): ISODate {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${String(y).padStart(4, '0')}-${m}-${day}`;
}

export function makeDate(year: number, month: number, day: number): ISODate {
  return fromUTC(new Date(Date.UTC(year, month - 1, day)));
}

/** Today's date in the given IANA timezone. Falls back to UTC for unknown zones. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): ISODate {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const candidate = `${get('year')}-${get('month')}-${get('day')}`;
    if (isISODate(candidate)) return candidate;
  } catch {
    // Unknown timezone — fall through to UTC.
  }
  return fromUTC(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
}

/** Local hour (0-23) in a timezone, used to decide "this evening" vs "tomorrow". */
export function hourInTimeZone(timeZone: string, now: Date = new Date()): number {
  try {
    const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(now);
    const n = Number(h);
    if (Number.isFinite(n)) return n % 24;
  } catch {
    // ignore
  }
  return now.getUTCHours();
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return fromUTC(d);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

export function monthOf(date: ISODate): Month {
  return (toUTC(date).getUTCMonth() + 1) as Month;
}

export function yearOf(date: ISODate): number {
  return toUTC(date).getUTCFullYear();
}

export function dayOfMonth(date: ISODate): number {
  return toUTC(date).getUTCDate();
}

export function weekdayOf(date: ISODate): Weekday {
  return toUTC(date).getUTCDay() as Weekday;
}

export function startOfMonth(date: ISODate): ISODate {
  return makeDate(yearOf(date), monthOf(date), 1);
}

export function endOfMonth(date: ISODate): ISODate {
  const y = yearOf(date);
  const m = monthOf(date);
  return makeDate(y, m, daysInMonth(y, m));
}

/** The next occurrence (today inclusive) of any of the given weekdays. */
export function nextWeekday(from: ISODate, days: readonly Weekday[], includeToday = true): ISODate | null {
  if (days.length === 0) return null;
  for (let i = includeToday ? 0 : 1; i <= 7; i++) {
    const d = addDays(from, i);
    if (days.includes(weekdayOf(d))) return d;
  }
  return null;
}

/** Date range from..to inclusive. Guarded against runaway loops. */
export function eachDay(from: ISODate, to: ISODate, max = 1000): ISODate[] {
  const out: ISODate[] = [];
  let d = from;
  while (d <= to && out.length < max) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const WEEKDAY_SHORT = WEEKDAY_NAMES.map((d) => d.slice(0, 3));

export function monthName(m: number): string {
  return MONTH_NAMES[(m - 1 + 12) % 12];
}

/** "2 September" (adds the year when it differs from `relativeTo`). */
export function formatDay(date: ISODate, relativeTo?: ISODate): string {
  const base = `${dayOfMonth(date)} ${monthName(monthOf(date))}`;
  if (relativeTo && yearOf(relativeTo) !== yearOf(date)) return `${base} ${yearOf(date)}`;
  return base;
}

/** "early September", "mid October", "late November" — honest vagueness for estimates. */
export function formatApproxMonth(date: ISODate): string {
  const d = dayOfMonth(date);
  const part = d <= 10 ? 'early' : d <= 20 ? 'mid' : 'late';
  return `${part} ${monthName(monthOf(date))}`;
}

/** Describe a date range for estimates, e.g. "mid to late October" or "late October – early November". */
export function formatApproxRange(from: ISODate, to: ISODate): string {
  const a = formatApproxMonth(from);
  const b = formatApproxMonth(to);
  if (a === b) return a;
  if (monthOf(from) === monthOf(to) && yearOf(from) === yearOf(to)) {
    return `${a.split(' ')[0]} to ${b}`;
  }
  return `${a} – ${b}`;
}

/** Human description of a future offset: "today", "tomorrow", "in about 3 weeks". */
export function describeOffset(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  const abs = Math.abs(days);
  let text: string;
  if (abs < 14) text = `${abs} days`;
  else if (abs < 60) text = `${Math.round(abs / 7)} weeks`;
  else text = `${Math.round(abs / 30)} months`;
  return days > 0 ? `in about ${text}` : `about ${text} ago`;
}

export function toISODateTime(now: Date = new Date()): string {
  return now.toISOString();
}
