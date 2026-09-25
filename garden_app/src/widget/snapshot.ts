/**
 * The small summary shown on the Android home-screen widget. The app rebuilds
 * it whenever tasks or weather change; the widget only ever reads this, so it
 * shows instantly without loading the whole garden.
 */
import { addDays } from '../domain/dates';
import type { GardenTask, ISODate } from '../domain/types';
import type { WeatherAssessment } from '../domain/weather';

export interface WidgetSnapshot {
  v: 1;
  /** Day the summary was made for (the widget says "open the app" once it's out of date). */
  date: ISODate;
  title: string;
  subtitle: string;
  weather?: string;
  /** The most important jobs for the coming week. */
  tasks: string[];
  moreTasks: number;
  plantNow: string[];
  /** True until the gardener has set up their garden. */
  needsSetup: boolean;
}

const PRIORITY: Record<GardenTask['priority'], number> = { important: 0, soon: 1, optional: 2 };
const MAX_TASKS = 3;

export function buildWidgetSnapshot(input: {
  today: ISODate;
  hasProfile: boolean;
  seasonLabel: string;
  suburb?: string;
  zoneName?: string;
  weather: WeatherAssessment;
  tasks: readonly GardenTask[];
  plantNowNames: readonly string[];
}): WidgetSnapshot {
  if (!input.hasProfile) {
    return { v: 1, date: input.today, title: 'Sow by Season', subtitle: 'Tap to set up your garden', tasks: [], moreTasks: 0, plantNow: [], needsSetup: true };
  }
  const horizon = addDays(input.today, 7);
  const due = input.tasks
    .filter((t) => t.dueDate <= horizon)
    .slice()
    .sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  const w = input.weather;
  const day = w.seasonalOnly ? undefined : w.upcoming[0];
  let weather: string | undefined;
  if (day) {
    const range = day.minC !== undefined && day.maxC !== undefined ? `${Math.round(day.minC)}°–${Math.round(day.maxC)}°C` : undefined;
    const rain = day.precipitationMm ? `${Math.round(day.precipitationMm)} mm rain` : undefined;
    const alerts = [w.frostDays.length ? 'frost risk' : undefined, w.heatDays.length ? 'heat' : undefined, w.heavyRainDays.length ? 'heavy rain' : undefined].filter(Boolean);
    weather = [range ? `Today ${range}` : undefined, rain, alerts.length ? `⚠ ${alerts.join(', ')} this week` : undefined].filter(Boolean).join(' · ') || undefined;
  }
  return {
    v: 1,
    date: input.today,
    title: `${input.seasonLabel}${input.suburb ? ` in ${input.suburb}` : ''}`,
    subtitle: input.zoneName ?? 'Sow by Season',
    weather,
    tasks: due.slice(0, MAX_TASKS).map((t) => t.title),
    moreTasks: Math.max(0, due.length - MAX_TASKS),
    plantNow: input.plantNowNames.slice(0, 4),
    needsSetup: false,
  };
}
