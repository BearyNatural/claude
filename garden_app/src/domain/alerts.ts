/**
 * Weather alerts sent while the app is closed (Android background check):
 * frost, extreme heat or heavy rain today or tomorrow, per garden. Each alert
 * has a stable key so the same warning is never sent twice.
 */
import { addDays, formatDay } from './dates';
import type { ISODate } from './types';
import type { WeatherAssessment } from './weather';

export interface WeatherAlert {
  /** e.g. "home:frost:2026-09-26" — used to send each alert once. */
  key: string;
  title: string;
  body: string;
}

export function weatherAlerts(w: WeatherAssessment, today: ISODate, garden: { id: string; name: string }): WeatherAlert[] {
  if (w.seasonalOnly) return [];
  const soon = new Set([today, addDays(today, 1)]);
  const when = (d: ISODate) => (d === today ? 'today' : 'tomorrow');
  const day = (d: ISODate) => w.upcoming.find((x) => x.date === d);
  const out: WeatherAlert[] = [];
  const frost = w.frostDays.find((d) => soon.has(d));
  if (frost) {
    const min = day(frost)?.minC;
    out.push({
      key: `${garden.id}:frost:${frost}`,
      title: `Frost risk ${when(frost)} — ${garden.name}`,
      body: `Forecast low ${min !== undefined ? `${Math.round(min)}°C` : 'near freezing'} (${formatDay(frost)}). Cover or move tender seedlings and pots, and water in the morning rather than the evening.`,
    });
  }
  const heat = w.heatDays.find((d) => soon.has(d));
  if (heat) {
    const max = day(heat)?.maxC;
    out.push({
      key: `${garden.id}:heat:${heat}`,
      title: `Hot day ${when(heat)} — ${garden.name}`,
      body: `Forecast high ${max !== undefined ? `${Math.round(max)}°C` : 'above 35°C'} (${formatDay(heat)}). Water deeply early in the day, mulch, and shade seedlings and pots.`,
    });
  }
  const rain = w.heavyRainDays.find((d) => soon.has(d));
  if (rain) {
    const mm = day(rain)?.precipitationMm;
    out.push({
      key: `${garden.id}:rain:${rain}`,
      title: `Heavy rain ${when(rain)} — ${garden.name}`,
      body: `About ${mm !== undefined ? `${Math.round(mm)} mm` : 'heavy rain'} forecast (${formatDay(rain)}). Hold off watering and feeding, check drainage, and protect seedlings from being washed out.`,
    });
  }
  return out;
}
