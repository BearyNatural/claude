import { ISODate, isValidDate, makeDate } from '../dates';
import { Confidence } from './types';

/**
 * Date formats seen in Australian bank, broker and super exports.
 * Australian files are day-first, so when a column is ambiguous (every day ≤ 12)
 * day-first is chosen and the choice is reported as needing confirmation.
 */
export type DateFormat =
  | 'YMD'        // 2026-08-02, 2026/08/02, 2026.08.02
  | 'DMY'        // 02/08/2026, 2-8-2026, 02.08.26
  | 'MDY'        // 08/02/2026
  | 'D-MON-Y'    // 2 Aug 2026, 02-Aug-26, 02 August 2026
  | 'MON-D-Y'    // Aug 2, 2026
  | 'YYYYMMDD';  // 20260802

export const DATE_FORMAT_LABEL: Record<DateFormat, string> = {
  YMD: 'Year-month-day (2026-08-02)',
  DMY: 'Day/month/year (02/08/2026)',
  MDY: 'Month/day/year (08/02/2026)',
  'D-MON-Y': 'Day month-name year (2 Aug 2026)',
  'MON-D-Y': 'Month-name day, year (Aug 2, 2026)',
  YYYYMMDD: 'Compact (20260802)',
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10,
  november: 11, december: 12,
};

export function monthFromName(name: string): number | null {
  return MONTHS[name.toLowerCase().replace(/\.$/, '')] ?? null;
}

function year(y: string): number {
  const n = Number(y);
  if (y.length <= 2) return n < 70 ? 2000 + n : 1900 + n;
  return n;
}

function stripTime(s: string): string {
  return s
    .trim()
    .replace(/[T\s]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(am|pm|AM|PM)?(Z|[+-]\d{2}:?\d{2})?$/, '')
    .trim();
}

function build(y: number, m: number, d: number): ISODate | null {
  const iso = makeDate(y, m, d);
  return isValidDate(iso) ? iso : null;
}

/** Parse a date string in a specific format. Returns null if it doesn't fit. */
export function parseDateAs(input: string, format: DateFormat): ISODate | null {
  const s = stripTime(String(input ?? ''));
  if (!s) return null;
  let m: RegExpMatchArray | null;
  switch (format) {
    case 'YMD':
      m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
      return m ? build(Number(m[1]), Number(m[2]), Number(m[3])) : null;
    case 'DMY':
      m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/);
      return m ? build(year(m[3]), Number(m[2]), Number(m[1])) : null;
    case 'MDY':
      m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/);
      return m ? build(year(m[3]), Number(m[1]), Number(m[2])) : null;
    case 'D-MON-Y': {
      m = s.match(/^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})(?:st|nd|rd|th)?[-/ .]+([A-Za-z]{3,9})\.?[-/ .,]+(\d{2}|\d{4})$/);
      if (!m) return null;
      const mon = monthFromName(m[2]);
      return mon ? build(year(m[3]), mon, Number(m[1])) : null;
    }
    case 'MON-D-Y': {
      m = s.match(/^([A-Za-z]{3,9})\.?[-/ ]+(\d{1,2})(?:st|nd|rd|th)?,?[-/ ]+(\d{2}|\d{4})$/);
      if (!m) return null;
      const mon = monthFromName(m[1]);
      return mon ? build(year(m[3]), mon, Number(m[2])) : null;
    }
    case 'YYYYMMDD':
      m = s.match(/^(\d{4})(\d{2})(\d{2})/);
      return m ? build(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  }
}

export interface DateDetection {
  format: DateFormat;
  /** Share of non-empty sample values that parsed (0–1). */
  parseRate: number;
  confidence: Confidence;
  /** Explanation for the user, e.g. why day-first was assumed. */
  note: string | null;
}

const ALL_FORMATS: DateFormat[] = ['YMD', 'DMY', 'MDY', 'D-MON-Y', 'MON-D-Y', 'YYYYMMDD'];

/**
 * Work out which date format a column uses from sample values.
 * Returns null if no format parses at least `minRate` of the values.
 */
export function detectDateFormat(samples: string[], preferDayFirst = true, minRate = 0.8): DateDetection | null {
  const values = samples.map((s) => String(s ?? '').trim()).filter(Boolean);
  if (values.length === 0) return null;
  const scores = ALL_FORMATS.map((format) => ({
    format,
    ok: values.filter((v) => parseDateAs(v, format) !== null).length,
  }));
  const best = Math.max(...scores.map((s) => s.ok));
  if (best / values.length < minRate) return null;
  const candidates = scores.filter((s) => s.ok === best).map((s) => s.format);

  if (candidates.length === 1) {
    const format = candidates[0];
    let note: string | null = null;
    let confidence: Confidence = 'high';
    if (format === 'MDY') {
      note = 'Dates appear to be month-first (US style) because some values have a day above 12.';
      confidence = 'medium';
    }
    return { format, parseRate: best / values.length, confidence, note };
  }
  // DMY and MDY both fit: every value has day and month ≤ 12.
  if (candidates.includes('DMY') && candidates.includes('MDY')) {
    const format: DateFormat = preferDayFirst ? 'DMY' : 'MDY';
    // Sequential days in a statement usually settle it: check which reading gives dates in order.
    const monotonic = (f: DateFormat) => {
      const parsed = values.map((v) => parseDateAs(v, f)).filter((d): d is string => !!d);
      const asc = parsed.every((d, i) => i === 0 || d >= parsed[i - 1]);
      const desc = parsed.every((d, i) => i === 0 || d <= parsed[i - 1]);
      return parsed.length > 2 && (asc || desc);
    };
    const dmyOrdered = monotonic('DMY');
    const mdyOrdered = monotonic('MDY');
    if (dmyOrdered && !mdyOrdered) {
      return { format: 'DMY', parseRate: best / values.length, confidence: 'medium', note: 'Day-first dates assumed (Australian format); the dates are in order when read this way.' };
    }
    if (mdyOrdered && !dmyOrdered) {
      return { format: 'MDY', parseRate: best / values.length, confidence: 'medium', note: 'Month-first dates assumed because the dates are only in order when read this way. Please confirm.' };
    }
    return {
      format,
      parseRate: best / values.length,
      confidence: 'medium',
      note: `Every date could be read either way (all days are 12 or less). ${preferDayFirst ? 'Day-first (Australian) format assumed' : 'Month-first format assumed'} — please confirm.`,
    };
  }
  return { format: candidates[0], parseRate: best / values.length, confidence: 'high', note: null };
}

/** Convert an Excel serial date number (1900 system) to an ISO date. */
export function excelSerialToDate(serial: number): ISODate | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  // Excel's day 60 is the fictional 29 Feb 1900; serials above it are shifted by one.
  const days = Math.floor(serial) - (serial > 59 ? 1 : 0);
  const base = Date.UTC(1899, 11, 31);
  const dt = new Date(base + days * 86400000);
  return makeDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
