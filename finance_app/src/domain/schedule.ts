import { ISODate, addDays, addMonths, diffDays, parts } from './dates';
import { Frequency } from './periods';

/** A repeating date schedule, e.g. "fortnightly from 2026-07-03" or "monthly on the 31st". */
export interface Recurrence {
  frequency: Frequency;
  /** First occurrence. Later occurrences are calculated from this date so month-end days never drift. */
  anchor: ISODate;
  /** Optional last date (inclusive). */
  until?: ISODate | null;
}

function monthsStep(f: Frequency): number | null {
  switch (f) {
    case 'monthly': return 1;
    case 'quarterly': return 3;
    case 'six-monthly': return 6;
    case 'annually': return 12;
    default: return null;
  }
}

function daysStep(f: Frequency): number | null {
  switch (f) {
    case 'daily': return 1;
    case 'weekly': return 7;
    case 'fortnightly': return 14;
    case 'four-weekly': return 28;
    default: return null;
  }
}

/** The k-th occurrence (k = 0 is the anchor). */
export function nthOccurrence(r: Recurrence, k: number): ISODate {
  const ms = monthsStep(r.frequency);
  if (ms !== null) return addMonths(r.anchor, ms * k, parts(r.anchor).d);
  return addDays(r.anchor, (daysStep(r.frequency) as number) * k);
}

/** All occurrences within [from, to] (inclusive). */
export function occurrences(r: Recurrence, from: ISODate, to: ISODate, limit = 20000): ISODate[] {
  const out: ISODate[] = [];
  const last = r.until && r.until < to ? r.until : to;
  if (last < from) return out;
  // Jump close to `from` instead of iterating from the anchor.
  let k = 0;
  if (from > r.anchor) {
    const ds = daysStep(r.frequency);
    if (ds !== null) k = Math.max(0, Math.floor(diffDays(r.anchor, from) / ds) - 1);
    else {
      const ms = monthsStep(r.frequency) as number;
      const a = parts(r.anchor);
      const f = parts(from);
      k = Math.max(0, Math.floor(((f.y - a.y) * 12 + (f.m - a.m)) / ms) - 1);
    }
  }
  for (let n = 0; n < limit; n++, k++) {
    const d = nthOccurrence(r, k);
    if (d > last) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** The first occurrence on or after `date`, or null if the schedule has ended. */
export function nextOccurrence(r: Recurrence, onOrAfter: ISODate): ISODate | null {
  const horizon = addMonths(onOrAfter, 13);
  const occ = occurrences(r, onOrAfter, horizon, 500);
  return occ[0] ?? null;
}

/** The last occurrence strictly before `date`. */
export function previousOccurrence(r: Recurrence, before: ISODate): ISODate | null {
  const occ = occurrences(r, addMonths(before, -13), addDays(before, -1), 1000);
  return occ.length ? occ[occ.length - 1] : null;
}

/** Number of occurrences in [from, to]. */
export function countOccurrences(r: Recurrence, from: ISODate, to: ISODate): number {
  return occurrences(r, from, to).length;
}
