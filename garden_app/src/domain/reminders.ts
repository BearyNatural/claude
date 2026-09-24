/**
 * Reminder planning (pure). The notification service schedules the result
 * with the OS; this module decides *what* to remind and *when*.
 *
 * - Non-urgent jobs are consolidated into one message per gardening day
 *   (or a daily summary / a weekly message, per preference).
 * - Time-critical jobs (frost, heat) get their own reminder.
 * - Quiet days are respected.
 *
 * Because mobile operating systems do not guarantee background execution,
 * reminders are planned from the garden state known when the app was last
 * opened (see docs/ARCHITECTURE.md → Notifications).
 */
import { addDays, diffDays, weekdayOf } from './dates';
import type { GardenTask, ISODate, ReminderPreferences, TimeBudget } from './types';
import { dayLabel, pickWithin, rankTasks, roundMinutes, WEEKLY_MINUTES } from './workload';

export interface PlannedReminder {
  id: string;
  date: ISODate;
  /** HH:MM local time. */
  time: string;
  title: string;
  body: string;
  taskIds: string[];
  kind: 'summary' | 'urgent';
}

function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function bullets(tasks: readonly GardenTask[]): string {
  return tasks.map((t) => `• ${t.short ?? lcFirst(t.title)}`).join('\n');
}

function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

export interface ReminderInput {
  tasks: readonly GardenTask[];
  prefs: ReminderPreferences;
  timeBudget: TimeBudget;
  today: ISODate;
  /** Local HH:MM now — reminders earlier than this today are not scheduled. */
  nowTime: string;
  horizonDays?: number;
}

export function planReminders(input: ReminderInput): PlannedReminder[] {
  const { prefs, today } = input;
  if (!prefs.enabled) return [];
  const time = isValidTime(prefs.reminderTime) ? prefs.reminderTime : '08:00';
  const horizon = input.horizonDays ?? 7;
  const quiet = new Set(prefs.quietDays);
  const usable = (d: ISODate) => !quiet.has(weekdayOf(d)) && (d > today || (d === today && input.nowTime < time));
  const out: PlannedReminder[] = [];

  // Urgent, time-critical jobs.
  const urgent = input.tasks.filter((t) => t.timeCritical && t.priority === 'important' && t.kind !== 'water');
  for (const t of urgent) {
    let d = t.dueDate;
    if (!usable(d)) d = today; // try today if still ahead of reminder time
    if (!usable(d)) continue;
    out.push({ id: `urgent:${t.id}`, date: d, time, title: t.title, body: t.detail ?? t.why, taskIds: [t.id], kind: 'urgent' });
  }
  const urgentIds = new Set(urgent.map((t) => t.id));
  const normal = rankTasks(input.tasks.filter((t) => !urgentIds.has(t.id)));
  if (normal.length === 0) return out;

  const days: ISODate[] = [];
  for (let i = 0; i <= horizon; i++) {
    const d = addDays(today, i);
    if (usable(d)) days.push(d);
  }
  let reminderDays: ISODate[];
  if (prefs.mode === 'daily-summary') reminderDays = days;
  else {
    const garden = prefs.gardeningDays.length ? days.filter((d) => prefs.gardeningDays.includes(weekdayOf(d))) : [];
    const base = garden.length ? garden : days.filter((d) => weekdayOf(d) === 6).slice(0, 1); // default: Saturday
    reminderDays = prefs.mode === 'weekly' ? base.slice(0, 1) : base;
  }

  // Each job goes into the first reminder day on/after its due date.
  const perSession = prefs.mode === 'daily-summary' ? WEEKLY_MINUTES[input.timeBudget] : Math.max(30, WEEKLY_MINUTES[input.timeBudget] / Math.max(1, reminderDays.length));
  const assigned = new Set<string>();
  for (const day of reminderDays) {
    const due = normal.filter((t) => !assigned.has(t.id) && t.dueDate <= day);
    if (due.length === 0) continue;
    const chosen = pickWithin(due, perSession);
    const list = chosen.length ? chosen : due.slice(0, 1);
    list.forEach((t) => assigned.add(t.id));
    const minutes = list.reduce((s, t) => s + t.minutes, 0);
    const label = dayLabel(day, today);
    out.push({
      id: `summary:${day}`,
      date: day,
      time,
      title: diffDays(today, day) === 0 ? 'Garden jobs for today' : `Garden jobs for ${label.replace('this ', '')}`,
      body: `You have about ${roundMinutes(minutes)} of useful garden work ${label}:\n${bullets(list)}`,
      taskIds: list.map((t) => t.id),
      kind: 'summary',
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'urgent' ? -1 : 1));
}
