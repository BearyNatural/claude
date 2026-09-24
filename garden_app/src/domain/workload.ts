/**
 * Workload-aware prioritisation.
 *
 * Uses the gardener's weekly time budget to choose a calm, realistic set of
 * jobs for their next gardening day, rather than an anxiety-inducing queue.
 * Time-critical jobs (frost, heat, watering new plants) stay on their date.
 */
import { formatDay, nextWeekday, WEEKDAY_NAMES, weekdayOf, diffDays } from './dates';
import type { GardenTask, ISODate, TaskKind, TimeBudget, Weekday } from './types';

/** Conservative weekly minutes for each time-budget choice (heuristic). */
export const WEEKLY_MINUTES: Record<TimeBudget, number> = {
  lt1: 45,
  '1to2': 90,
  '2to4': 180,
  '4to8': 360,
  '8plus': 600,
};

export const TIME_BUDGET_LABELS: Record<TimeBudget, string> = {
  lt1: 'Less than 1 hour',
  '1to2': '1–2 hours',
  '2to4': '2–4 hours',
  '4to8': '4–8 hours',
  '8plus': '8+ hours',
};

const KIND_WEIGHT: Record<TaskKind, number> = {
  'frost-protect': 0,
  'heat-protect': 0,
  water: 1,
  harvest: 1,
  'succession-sow': 2,
  'system-step': 2,
  transplant: 2,
  sow: 3,
  thin: 4,
  stake: 4,
  'rain-check': 4,
  feed: 5,
  hill: 5,
  prune: 5,
  mulch: 6,
  inspect: 7,
  'buy-seed': 8,
  'prepare-bed': 8,
};
const PRIORITY_RANK = { important: 0, soon: 1, optional: 2 } as const;

export function rankTasks(tasks: readonly GardenTask[]): GardenTask[] {
  return [...tasks].sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      Number(!!b.timeCritical) - Number(!!a.timeCritical) ||
      KIND_WEIGHT[a.kind] - KIND_WEIGHT[b.kind] ||
      (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0),
  );
}

/** Greedy pick within a minute budget, in rank order. */
export function pickWithin(tasks: readonly GardenTask[], minutes: number): GardenTask[] {
  const out: GardenTask[] = [];
  let used = 0;
  for (const t of rankTasks(tasks)) {
    if (used + t.minutes <= minutes) {
      out.push(t);
      used += t.minutes;
    }
  }
  return out;
}

export interface WeekPlan {
  budgetMinutes: number;
  /** Next preferred gardening day (today inclusive), or today when none are set. */
  gardeningDay: ISODate;
  gardeningDayLabel: string;
  /** Jobs that fit the budget, most useful first. */
  focus: GardenTask[];
  focusMinutes: number;
  /** Jobs that can wait for another day. */
  later: GardenTask[];
  /** Time-critical jobs that shouldn't wait for the gardening day. */
  timeCritical: GardenTask[];
  /** "If you only have one hour" shortlist. */
  oneHour: GardenTask[];
  summary: string;
  overBudget: boolean;
}

export function dayLabel(day: ISODate, today: ISODate): string {
  const d = diffDays(today, day);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 7) return `this ${WEEKDAY_NAMES[weekdayOf(day)]}`;
  return formatDay(day);
}

function joinNatural(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function roundMinutes(m: number): string {
  if (m < 60) return `${Math.max(5, Math.round(m / 5) * 5)} minutes`;
  const h = Math.round((m / 60) * 2) / 2;
  return `${h} hour${h === 1 ? '' : 's'}`;
}

export function planWeek(tasks: readonly GardenTask[], opts: { timeBudget: TimeBudget; gardeningDays: Weekday[]; today: ISODate }): WeekPlan {
  const budgetMinutes = WEEKLY_MINUTES[opts.timeBudget];
  const gardeningDay = nextWeekday(opts.today, opts.gardeningDays) ?? opts.today;
  const timeCritical = rankTasks(tasks.filter((t) => t.timeCritical));
  const rest = tasks.filter((t) => !t.timeCritical);
  const criticalMinutes = timeCritical.reduce((s, t) => s + t.minutes, 0);
  const remaining = Math.max(0, budgetMinutes - criticalMinutes);
  // Important jobs are always shown; the rest fill the remaining budget.
  const important = rest.filter((t) => t.priority === 'important');
  const importantMinutes = important.reduce((s, t) => s + t.minutes, 0);
  const others = pickWithin(rest.filter((t) => t.priority !== 'important'), Math.max(0, remaining - importantMinutes));
  const focus = rankTasks([...important, ...others]);
  const focusIds = new Set(focus.map((t) => t.id));
  const later = rankTasks(rest.filter((t) => !focusIds.has(t.id)));
  const focusMinutes = focus.reduce((s, t) => s + t.minutes, 0);
  const oneHour = pickWithin([...timeCritical, ...focus], 60);
  const label = dayLabel(gardeningDay, opts.today);

  let summary: string;
  if (focus.length === 0 && timeCritical.length === 0) {
    summary = 'Nothing pressing this week — enjoy the garden.';
  } else if (focus.length === 0) {
    summary = 'Just the time-sensitive jobs below this week.';
  } else {
    const titles = focus.slice(0, 5).map((t) => t.short ?? t.title.charAt(0).toLowerCase() + t.title.slice(1));
    summary = `You have about ${roundMinutes(focusMinutes)} of useful garden work ${label}: ${joinNatural(titles)}${focus.length > 5 ? ', and a few more' : ''}.`;
  }
  return {
    budgetMinutes,
    gardeningDay,
    gardeningDayLabel: label,
    focus,
    focusMinutes,
    later,
    timeCritical,
    oneHour,
    summary,
    overBudget: focusMinutes + criticalMinutes > budgetMinutes,
  };
}
