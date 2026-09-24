/**
 * Planting-window arithmetic.
 *
 * Windows are stored as sets of calendar months per climate zone (the
 * granularity Australian planting guides publish). Windows can wrap across the
 * year end (e.g. Nov–Feb), so all logic here works on a circular calendar.
 */
import { addDays, endOfMonth, makeDate, monthOf, yearOf, diffDays } from './dates';
import type { PlantRecord, ZoneWindow } from './plantTypes';
import type { ClimateZoneId, ISODate, Month, StartMethod } from './types';

export type WindowKind = 'sow' | 'plant';

export function normaliseMonths(months: readonly number[] | undefined): Month[] {
  if (!months) return [];
  const set = new Set<number>();
  for (const m of months) if (Number.isInteger(m) && m >= 1 && m <= 12) set.add(m);
  return [...set].sort((a, b) => a - b) as Month[];
}

const nextMonth = (m: number): Month => ((m % 12) + 1) as Month;
const prevMonth = (m: number): Month => (((m + 10) % 12) + 1) as Month;

/**
 * Split months into contiguous circular runs, e.g. [1,2,11,12] → [[11,12,1,2]].
 */
export function monthRuns(months: readonly number[]): Month[][] {
  const ms = normaliseMonths(months);
  if (ms.length === 0) return [];
  if (ms.length === 12) return [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]];
  const set = new Set(ms);
  const runs: Month[][] = [];
  for (const m of ms) {
    if (set.has(prevMonth(m))) continue; // not a run start
    const run: Month[] = [m];
    let n = nextMonth(m);
    while (set.has(n)) {
      run.push(n);
      n = nextMonth(n);
    }
    runs.push(run);
  }
  return runs;
}

/** Human description like "Sep – Feb" or "Mar – May, Aug". */
export function describeMonths(months: readonly number[] | undefined): string {
  const runs = monthRuns(months ?? []);
  if (runs.length === 0) return 'Not recorded';
  if (runs.length === 1 && runs[0].length === 12) return 'All year';
  const short = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return runs
    .map((r) => (r.length === 1 ? short[r[0] - 1] : `${short[r[0] - 1]} – ${short[r[r.length - 1] - 1]}`))
    .join(', ');
}

export interface WindowPosition {
  inWindow: boolean;
  allYear: boolean;
  /** Where in the current run today falls (only when inWindow). */
  phase?: 'opening' | 'middle' | 'closing';
  /** Last day of the current contiguous run (only when inWindow and not all-year). */
  closesOn?: ISODate;
  daysUntilClose?: number;
  /** First day of the next run (only when !inWindow). */
  opensOn?: ISODate;
  daysUntilOpen?: number;
}

/** First day of the next month (after `date`) that is in the set. */
function nextOpening(months: Set<number>, date: ISODate): ISODate | null {
  let y = yearOf(date);
  let m = monthOf(date);
  for (let i = 0; i < 12; i++) {
    m = nextMonth(m);
    if (m === 1) y += 1;
    if (months.has(m)) return makeDate(y, m, 1);
  }
  return null;
}

export function windowPosition(monthsIn: readonly number[] | undefined, date: ISODate): WindowPosition {
  const months = normaliseMonths(monthsIn);
  if (months.length === 0) return { inWindow: false, allYear: false };
  if (months.length === 12) return { inWindow: true, allYear: true, phase: 'middle' };
  const set = new Set<number>(months);
  const m = monthOf(date);
  if (set.has(m)) {
    // Walk forward to the end of the run.
    let endY = yearOf(date);
    let endM = m;
    let runLen = 1;
    let posFromStart = 0;
    while (set.has(nextMonth(endM))) {
      endM = nextMonth(endM);
      if (endM === 1) endY += 1;
      runLen++;
    }
    let s = m;
    while (set.has(prevMonth(s))) {
      s = prevMonth(s);
      posFromStart++;
      runLen++;
    }
    const closesOn = endOfMonth(makeDate(endY, endM, 1));
    const daysUntilClose = diffDays(date, closesOn);
    let phase: WindowPosition['phase'] = 'middle';
    if (runLen === 1) phase = daysUntilClose <= 14 ? 'closing' : 'opening';
    else if (posFromStart === 0) phase = 'opening';
    else if (endM === m) phase = 'closing';
    return { inWindow: true, allYear: false, phase, closesOn, daysUntilClose };
  }
  const opensOn = nextOpening(set, date);
  return {
    inWindow: false,
    allYear: false,
    opensOn: opensOn ?? undefined,
    daysUntilOpen: opensOn ? diffDays(date, opensOn) : undefined,
  };
}

/** Is `date` inside the window? */
export function inWindow(months: readonly number[] | undefined, date: ISODate): boolean {
  return windowPosition(months, date).inWindow;
}

/**
 * The last date on which sowing is still inside the current window, or null
 * when the date is outside the window. For all-year windows returns
 * `date + horizonDays` so callers always get a finite limit.
 */
export function windowEndFrom(months: readonly number[] | undefined, date: ISODate, horizonDays = 365): ISODate | null {
  const pos = windowPosition(months, date);
  if (!pos.inWindow) return null;
  if (pos.allYear) return addDays(date, horizonDays);
  return pos.closesOn ?? null;
}

export function zoneWindow(plant: PlantRecord, zone: ClimateZoneId | null): ZoneWindow | undefined {
  if (!zone) return undefined;
  return plant.windows[zone];
}

/** Which kind of window applies to a start method. */
export function windowKindFor(method: StartMethod): WindowKind {
  return method === 'direct-sow' || method === 'seed-tray' ? 'sow' : 'plant';
}

/**
 * The months relevant for starting this plant in this zone. Prefers sowing
 * windows for seed-grown crops and planting windows for trees/tubers/runners.
 */
export function primaryWindow(
  plant: PlantRecord,
  zone: ClimateZoneId | null,
): { kind: WindowKind; months: Month[]; sourceId: string } | null {
  const w = zoneWindow(plant, zone);
  if (!w) return null;
  const preferSow = plant.startMethods[0] === 'direct-sow' || plant.startMethods[0] === 'seed-tray';
  const sow = normaliseMonths(w.sow);
  const plantM = normaliseMonths(w.plant);
  if (preferSow && sow.length) return { kind: 'sow', months: sow, sourceId: w.sourceId };
  if (plantM.length) return { kind: 'plant', months: plantM, sourceId: w.sourceId };
  if (sow.length) return { kind: 'sow', months: sow, sourceId: w.sourceId };
  return null;
}
