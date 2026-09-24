import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { seasonFor, southernSeason, tropicalSeason } from '../src/domain/climate';
import {
  addDays,
  describeOffset,
  diffDays,
  endOfMonth,
  formatApproxRange,
  isISODate,
  nextWeekday,
  todayInTimeZone,
  weekdayOf,
} from '../src/domain/dates';
import { weekKey } from '../src/domain/tasks';
import { describeMonths, monthRuns, windowEndFrom, windowPosition } from '../src/domain/windows';

describe('timezone and date handling', () => {
  it('uses the gardener\'s timezone, not UTC, for "today"', () => {
    const t = new Date('2026-09-24T15:00:00Z'); // 1am Friday in Brisbane, 11pm Thursday in Perth
    assert.equal(todayInTimeZone('Australia/Brisbane', t), '2026-09-25');
    assert.equal(todayInTimeZone('Australia/Perth', t), '2026-09-24');
    assert.equal(todayInTimeZone('Australia/Darwin', t), '2026-09-25'); // UTC+9:30 → 00:30
  });

  it('handles daylight saving differences between Sydney and Brisbane', () => {
    // DST starts in NSW on Sunday 4 October 2026 (UTC+11). Queensland stays at UTC+10.
    const t = new Date('2026-10-04T13:30:00Z');
    assert.equal(todayInTimeZone('Australia/Sydney', t), '2026-10-05');
    assert.equal(todayInTimeZone('Australia/Brisbane', t), '2026-10-04');
  });

  it('falls back safely for an unknown timezone', () => {
    assert.equal(todayInTimeZone('Not/AZone', new Date('2026-09-24T05:00:00Z')), '2026-09-24');
  });

  it('does date arithmetic across month, year and leap-year boundaries', () => {
    assert.equal(addDays('2026-12-30', 5), '2027-01-04');
    assert.equal(addDays('2027-01-02', -5), '2026-12-28');
    assert.equal(diffDays('2028-02-28', '2028-03-01'), 2); // 2028 is a leap year
    assert.equal(diffDays('2026-02-28', '2026-03-01'), 1);
    assert.equal(diffDays('2026-12-25', '2027-01-08'), 14);
    assert.equal(endOfMonth('2028-02-10'), '2028-02-29');
  });

  it('validates ISO dates strictly', () => {
    assert.equal(isISODate('2026-02-29'), false);
    assert.equal(isISODate('2028-02-29'), true);
    assert.equal(isISODate('2026-13-01'), false);
    assert.equal(isISODate('26-1-1'), false);
  });

  it('finds the next gardening day, including across the year end', () => {
    assert.equal(weekdayOf('2026-09-24'), 4); // Thursday
    assert.equal(nextWeekday('2026-09-24', [6]), '2026-09-26');
    assert.equal(nextWeekday('2026-12-31', [6]), '2027-01-02');
    assert.equal(nextWeekday('2026-09-26', [6]), '2026-09-26');
    assert.equal(nextWeekday('2026-09-26', [6], false), '2026-10-03');
    assert.equal(nextWeekday('2026-09-26', []), null);
  });

  it('buckets weeks from Monday, even across years', () => {
    assert.equal(weekKey('2026-09-24'), '2026-09-21');
    assert.equal(weekKey('2027-01-01'), '2026-12-28');
    assert.equal(weekKey('2026-09-27'), '2026-09-21'); // Sunday belongs to the week starting Monday
  });

  it('describes estimates in honest, approximate language', () => {
    assert.equal(formatApproxRange('2026-10-22', '2026-10-30'), 'late October');
    assert.equal(formatApproxRange('2026-10-12', '2026-10-28'), 'mid to late October');
    assert.equal(formatApproxRange('2026-10-25', '2026-11-05'), 'late October – early November');
    assert.equal(describeOffset(42), 'in about 6 weeks');
  });
});

describe('Australian seasons', () => {
  it('uses Southern Hemisphere meteorological seasons', () => {
    assert.equal(southernSeason(12), 'summer');
    assert.equal(southernSeason(1), 'summer');
    assert.equal(southernSeason(2), 'summer');
    assert.equal(southernSeason(3), 'autumn');
    assert.equal(southernSeason(5), 'autumn');
    assert.equal(southernSeason(6), 'winter');
    assert.equal(southernSeason(8), 'winter');
    assert.equal(southernSeason(9), 'spring');
    assert.equal(southernSeason(11), 'spring');
  });

  it('uses wet/dry seasons in the tropics', () => {
    assert.equal(tropicalSeason(11), 'wet');
    assert.equal(tropicalSeason(4), 'wet');
    assert.equal(tropicalSeason(5), 'dry');
    assert.equal(tropicalSeason(10), 'dry');
    assert.equal(seasonFor('2026-01-15', 'tropical').label, 'Wet season');
    assert.equal(seasonFor('2026-01-15', 'cool-temperate').label, 'Summer');
    assert.equal(seasonFor('2026-09-24', 'subtropical').label, 'Spring');
  });
});

describe('planting windows', () => {
  it('splits windows into runs that wrap across the year end', () => {
    assert.deepEqual(monthRuns([1, 2, 11, 12]), [[11, 12, 1, 2]]);
    assert.deepEqual(monthRuns([3, 4, 5, 8, 9]), [[3, 4, 5], [8, 9]]);
    assert.equal(describeMonths([1, 2, 11, 12]), 'Nov – Feb');
    assert.equal(describeMonths([3, 4, 5, 8]), 'Mar – May, Aug');
    assert.equal(describeMonths([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'All year');
    assert.equal(describeMonths([]), 'Not recorded');
  });

  it('knows when a summer window that crosses the new year closes', () => {
    const pos = windowPosition([11, 12, 1, 2], '2026-12-15');
    assert.equal(pos.inWindow, true);
    assert.equal(pos.closesOn, '2027-02-28');
    assert.equal(pos.phase, 'middle');
    assert.equal(windowPosition([11, 12, 1, 2], '2027-02-20').phase, 'closing');
    assert.equal(windowPosition([11, 12, 1, 2], '2026-11-03').phase, 'opening');
    assert.equal(windowEndFrom([11, 12, 1, 2], '2027-01-10'), '2027-02-28');
  });

  it('knows when the next window opens, including next year', () => {
    const pos = windowPosition([11, 12, 1, 2], '2026-10-10');
    assert.equal(pos.inWindow, false);
    assert.equal(pos.opensOn, '2026-11-01');
    assert.equal(pos.daysUntilOpen, 22);
    const pos2 = windowPosition([3, 4], '2026-09-24');
    assert.equal(pos2.opensOn, '2027-03-01');
  });

  it('treats all-year windows as always open with a finite horizon', () => {
    const pos = windowPosition([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], '2026-09-24');
    assert.equal(pos.inWindow, true);
    assert.equal(pos.allYear, true);
    assert.equal(windowEndFrom([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], '2026-09-24', 30), '2026-10-24');
  });
});
