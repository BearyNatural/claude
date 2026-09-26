import { describe, expect, it } from 'vitest';
import { allocate, formatMoney, parseMoney, roundCents } from '@domain/money';
import {
  addDays, addMonths, diffDays, financialYearOf, fyRange, formatDate, isValidDate, startOfWeek, weekday, diffMonths,
} from '@domain/dates';
import {
  convertFrequency, periodContaining, periodsBetween, previousPeriod, samePeriodLastYear, coverageFraction,
} from '@domain/periods';
import { nextOccurrence, occurrences } from '@domain/schedule';

describe('money', () => {
  it('parses common bank amount formats exactly', () => {
    expect(parseMoney('$1,234.56')?.cents).toBe(123456);
    expect(parseMoney('-1234.5')?.cents).toBe(-123450);
    expect(parseMoney('(12.00)')?.cents).toBe(-1200);
    expect(parseMoney('12.00-')?.cents).toBe(-1200);
    expect(parseMoney('+5')?.cents).toBe(500);
    expect(parseMoney('$-82.20')?.cents).toBe(-8220);
    expect(parseMoney('−82.20')?.cents).toBe(-8220);
    expect(parseMoney('0.1')?.cents).toBe(10);
    expect(parseMoney('1.005')?.cents).toBe(101);
    expect(parseMoney('AUD 99.95')?.cents).toBe(9995);
  });

  it('reports CR/DR indicators separately', () => {
    expect(parseMoney('126.43 DR')).toEqual({ cents: 12643, indicator: 'DR' });
    expect(parseMoney('4,102.17CR')).toEqual({ cents: 410217, indicator: 'CR' });
  });

  it('rejects text that is not an amount', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('-')).toBeNull();
    expect(parseMoney('12.3.4')).toBeNull();
  });

  it('formats cents for display', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(-8220)).toBe('-$82.20');
    expect(formatMoney(5, { signed: true })).toBe('+$0.05');
    expect(formatMoney(-1200, { negativeStyle: 'parentheses' })).toBe('($12.00)');
    expect(formatMoney(8349999, { wholeDollars: true })).toBe('$83,500');
  });

  it('rounds half away from zero', () => {
    expect(roundCents(12.5)).toBe(13);
    expect(roundCents(-12.5)).toBe(-13);
    expect(roundCents(12.4999999999)).toBe(13);
    expect(roundCents(-0.2)).toBe(0);
  });

  it('allocates splits that add up exactly', () => {
    const parts = allocate(24000, [90, 80, 70]);
    expect(parts).toEqual([9000, 8000, 7000]);
    const thirds = allocate(10000, [1, 1, 1]);
    expect(thirds.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(thirds).toEqual([3334, 3333, 3333]);
    const neg = allocate(-10001, [40, 60]);
    expect(neg.reduce((a, b) => a + b, 0)).toBe(-10001);
  });
});

describe('dates', () => {
  it('does day arithmetic without time zone drift', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
    expect(addDays('2026-10-04', 1)).toBe('2026-10-05'); // AU daylight saving start
  });

  it('clamps month ends and keeps an anchor day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });

  it('counts whole months', () => {
    expect(diffMonths('2026-01-15', '2026-03-14')).toBe(1);
    expect(diffMonths('2026-01-15', '2026-03-15')).toBe(2);
    expect(diffMonths('2026-01-31', '2026-02-28')).toBe(1);
  });

  it('knows Australian financial years', () => {
    expect(financialYearOf('2026-06-30')).toBe('2025-26');
    expect(financialYearOf('2026-07-01')).toBe('2026-27');
    expect(fyRange('2026-27')).toEqual({ start: '2026-07-01', end: '2027-06-30' });
  });

  it('validates and formats', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(formatDate('2026-08-02')).toBe('02 Aug 2026');
    expect(formatDate('2026-09-14', { long: true })).toBe('14 September 2026');
    expect(weekday('2026-09-27')).toBe(7);
    expect(startOfWeek('2026-09-27')).toBe('2026-09-21');
  });
});

describe('periods', () => {
  it('converts annual costs into planning amounts', () => {
    expect(convertFrequency(96000, 'annually', 'monthly')).toBe(8000);
    expect(convertFrequency(96000, 'annually', 'fortnightly')).toBe(3692);
    expect(convertFrequency(96000, 'annually', 'weekly')).toBe(1846);
    expect(convertFrequency(2300, 'weekly', 'annually')).toBe(119600);
  });

  it('finds the containing period for each kind', () => {
    expect(periodContaining('month', '2026-09-27')).toMatchObject({ start: '2026-09-01', end: '2026-09-30' });
    expect(periodContaining('quarter', '2026-08-10')).toMatchObject({ start: '2026-07-01', end: '2026-09-30' });
    expect(periodContaining('financial-year', '2026-03-01')).toMatchObject({ start: '2025-07-01', end: '2026-06-30' });
    expect(periodContaining('half-year', '2026-08-10')).toMatchObject({ start: '2026-07-01', end: '2026-12-31' });
    expect(periodContaining('rolling-12-months', '2026-09-27')).toMatchObject({ start: '2025-09-28', end: '2026-09-27' });
    const f = periodContaining('fortnight', '2026-09-27', { fortnightAnchor: '2026-09-17' });
    expect(f).toMatchObject({ start: '2026-09-17', end: '2026-09-30' });
    const before = periodContaining('fortnight', '2026-09-16', { fortnightAnchor: '2026-09-17' });
    expect(before).toMatchObject({ start: '2026-09-03', end: '2026-09-16' });
  });

  it('steps to previous and same-period-last-year', () => {
    const sep = periodContaining('month', '2026-09-10');
    expect(previousPeriod(sep)).toMatchObject({ start: '2026-08-01', end: '2026-08-31' });
    expect(samePeriodLastYear(sep)).toMatchObject({ start: '2025-09-01', end: '2025-09-30' });
    const fy = periodContaining('financial-year', '2026-09-10');
    expect(previousPeriod(fy)).toMatchObject({ start: '2025-07-01', end: '2026-06-30' });
  });

  it('lists periods and measures partial coverage', () => {
    const months = periodsBetween('month', '2026-01-15', '2026-04-02');
    expect(months.map((m) => m.start)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
    const sep = periodContaining('month', '2026-09-10');
    expect(coverageFraction(sep, { start: '2026-09-01', end: '2026-09-15' })).toBeCloseTo(0.5);
  });
});

describe('schedules', () => {
  it('generates fortnightly occurrences', () => {
    const r = { frequency: 'fortnightly' as const, anchor: '2026-07-02' };
    expect(occurrences(r, '2026-07-01', '2026-08-15')).toEqual(['2026-07-02', '2026-07-16', '2026-07-30', '2026-08-13']);
  });

  it('keeps monthly schedules on the 31st where possible', () => {
    const r = { frequency: 'monthly' as const, anchor: '2026-01-31' };
    expect(occurrences(r, '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
    ]);
  });

  it('respects an end date and finds the next occurrence', () => {
    const r = { frequency: 'quarterly' as const, anchor: '2026-02-15', until: '2026-12-31' };
    expect(occurrences(r, '2026-01-01', '2027-12-31')).toEqual(['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15']);
    expect(nextOccurrence(r, '2026-09-27')).toBe('2026-11-15');
    expect(nextOccurrence(r, '2026-11-16')).toBeNull();
  });
});
