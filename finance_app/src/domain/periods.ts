import {
  ISODate, addDays, addMonths, diffDays, endOfMonth, endOfQuarter, financialYearOf, fyRange, makeDate, parts,
  startOfMonth, startOfQuarter, startOfWeek, toDayNumber, formatDate, formatMonth, fyDisplay,
} from './dates';
import { Cents, roundCents } from './money';

/** How often something happens (a bill, salary, a budget period). */
export type Frequency =
  | 'daily' | 'weekly' | 'fortnightly' | 'four-weekly' | 'monthly'
  | 'quarterly' | 'six-monthly' | 'annually';

export const FREQUENCIES: Frequency[] = [
  'daily', 'weekly', 'fortnightly', 'four-weekly', 'monthly', 'quarterly', 'six-monthly', 'annually',
];

/**
 * Periods per year used when converting between frequencies.
 * Weekly = 52 and fortnightly = 26 so that $960 a year is $18.46 a week and
 * $36.92 a fortnight (the common Australian planning convention).
 */
export const PERIODS_PER_YEAR: Record<Frequency, number> = {
  daily: 365,
  weekly: 52,
  fortnightly: 26,
  'four-weekly': 13,
  monthly: 12,
  quarterly: 4,
  'six-monthly': 2,
  annually: 1,
};

/** Average length in days (used for interval detection and pro-rating). */
export const FREQUENCY_DAYS: Record<Frequency, number> = {
  daily: 1,
  weekly: 7,
  fortnightly: 14,
  'four-weekly': 28,
  monthly: 365.25 / 12,
  quarterly: 365.25 / 4,
  'six-monthly': 365.25 / 2,
  annually: 365.25,
};

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  'four-weekly': 'Every 4 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  'six-monthly': 'Six-monthly',
  annually: 'Annually',
};

export const PER_LABEL: Record<Frequency, string> = {
  daily: 'per day',
  weekly: 'per week',
  fortnightly: 'per fortnight',
  'four-weekly': 'per 4 weeks',
  monthly: 'per month',
  quarterly: 'per quarter',
  'six-monthly': 'per half-year',
  annually: 'per year',
};

/** Convert an amount paid at one frequency into the equivalent at another. */
export function convertFrequency(amount: Cents, from: Frequency, to: Frequency): Cents {
  if (from === to) return amount;
  return roundCents((amount * PERIODS_PER_YEAR[from]) / PERIODS_PER_YEAR[to]);
}

export function annualise(amount: Cents, from: Frequency): Cents {
  return roundCents(amount * PERIODS_PER_YEAR[from]);
}

/* ----------------------------- Analysis periods ----------------------------- */

export type PeriodKind =
  | 'day' | 'week' | 'fortnight' | 'month' | 'quarter' | 'half-year'
  | 'financial-year' | 'calendar-year' | 'rolling-12-months' | 'custom';

export const PERIOD_KIND_LABEL: Record<PeriodKind, string> = {
  day: 'Day',
  week: 'Week',
  fortnight: 'Fortnight',
  month: 'Month',
  quarter: 'Quarter',
  'half-year': 'Six months',
  'financial-year': 'Financial year',
  'calendar-year': 'Calendar year',
  'rolling-12-months': 'Rolling 12 months',
  custom: 'Custom period',
};

export interface DateRange {
  start: ISODate;
  end: ISODate;
}

export interface Period extends DateRange {
  kind: PeriodKind;
  label: string;
}

export interface PeriodOptions {
  /** Any date that starts a fortnight (e.g. a payday). Defaults to Monday 5 Jan 2026. */
  fortnightAnchor?: ISODate;
  weekStartsOn?: 1 | 7;
}

const DEFAULT_FORTNIGHT_ANCHOR = '2026-01-05';

/** The period of the given kind that contains `date`. */
export function periodContaining(kind: PeriodKind, date: ISODate, opts: PeriodOptions = {}): Period {
  switch (kind) {
    case 'day':
      return { kind, start: date, end: date, label: formatDate(date) };
    case 'week': {
      const start = startOfWeek(date, opts.weekStartsOn ?? 1);
      const end = addDays(start, 6);
      return { kind, start, end, label: `Week of ${formatDate(start)}` };
    }
    case 'fortnight': {
      const anchor = opts.fortnightAnchor ?? DEFAULT_FORTNIGHT_ANCHOR;
      const offset = diffDays(anchor, date);
      const k = Math.floor(offset / 14);
      const start = addDays(anchor, k * 14);
      const end = addDays(start, 13);
      return { kind, start, end, label: `${formatDate(start, { noYear: true })} – ${formatDate(end)}` };
    }
    case 'month': {
      const start = startOfMonth(date);
      return { kind, start, end: endOfMonth(date), label: formatMonth(start) };
    }
    case 'quarter': {
      const start = startOfQuarter(date);
      const { y, m } = parts(start);
      return { kind, start, end: endOfQuarter(date), label: `Q${Math.floor((m - 1) / 3) + 1} ${y} (${formatMonth(start).slice(0, 3)}–${formatMonth(addMonths(start, 2)).slice(0, 3)})` };
    }
    case 'half-year': {
      const { y, m } = parts(date);
      const start = makeDate(y, m <= 6 ? 1 : 7, 1);
      const end = m <= 6 ? makeDate(y, 6, 30) : makeDate(y, 12, 31);
      return { kind, start, end, label: m <= 6 ? `Jan–Jun ${y}` : `Jul–Dec ${y}` };
    }
    case 'financial-year': {
      const fy = financialYearOf(date);
      return { kind, ...fyRange(fy), label: `FY ${fyDisplay(fy)}` };
    }
    case 'calendar-year': {
      const { y } = parts(date);
      return { kind, start: makeDate(y, 1, 1), end: makeDate(y, 12, 31), label: String(y) };
    }
    case 'rolling-12-months': {
      const start = addDays(addMonths(date, -12), 1);
      return { kind, start, end: date, label: `12 months to ${formatDate(date)}` };
    }
    case 'custom':
      return { kind, start: date, end: date, label: formatDate(date) };
  }
}

export function customPeriod(start: ISODate, end: ISODate): Period {
  return { kind: 'custom', start, end, label: `${formatDate(start)} – ${formatDate(end)}` };
}

/** The period immediately before `p` of the same kind. */
export function previousPeriod(p: Period, opts: PeriodOptions = {}): Period {
  if (p.kind === 'custom' || p.kind === 'rolling-12-months') {
    const len = diffDays(p.start, p.end) + 1;
    const end = addDays(p.start, -1);
    const start = addDays(end, -(len - 1));
    return p.kind === 'custom' ? customPeriod(start, end) : periodContaining('rolling-12-months', end, opts);
  }
  return periodContaining(p.kind, addDays(p.start, -1), opts);
}

/** Same period one year earlier (e.g. September 2026 → September 2025). */
export function samePeriodLastYear(p: Period, opts: PeriodOptions = {}): Period {
  if (p.kind === 'custom') return customPeriod(addMonths(p.start, -12), addMonths(p.end, -12));
  return periodContaining(p.kind, addMonths(p.start, -12), opts);
}

/** All periods of a kind that overlap [start, end]. */
export function periodsBetween(kind: PeriodKind, start: ISODate, end: ISODate, opts: PeriodOptions = {}): Period[] {
  const out: Period[] = [];
  let p = periodContaining(kind, start, opts);
  let guard = 0;
  while (p.start <= end && guard++ < 10000) {
    out.push(p);
    p = periodContaining(kind, addDays(p.end, 1), opts);
  }
  return out;
}

export function lengthInDays(r: DateRange): number {
  return diffDays(r.start, r.end) + 1;
}

/** Intersection of two ranges, or null. */
export function intersect(a: DateRange, b: DateRange): DateRange | null {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return start <= end ? { start, end } : null;
}

/** Fraction (0–1) of `period` covered by `covered`. Used to flag partial periods. */
export function coverageFraction(period: DateRange, covered: DateRange | null): number {
  if (!covered) return 0;
  const i = intersect(period, covered);
  return i ? lengthInDays(i) / lengthInDays(period) : 0;
}

export function dayNumberRange(r: DateRange): [number, number] {
  return [toDayNumber(r.start), toDayNumber(r.end)];
}
