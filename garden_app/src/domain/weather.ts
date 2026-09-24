/**
 * Weather model and assessment.
 *
 * Principles:
 *  - Every snapshot carries the time it was fetched. Freshness is always
 *    computed, never assumed: fresh / stale / unavailable.
 *  - Stale forecasts are shown with their age and used only with an explicit
 *    caveat; very old data is treated as unavailable for advice.
 *  - Forecast rain is not measured soil moisture. Modelled soil temperature is
 *    labelled as modelled, and air temperature is never relabelled as soil.
 *  - Weather refines seasonal advice; it never replaces it.
 */
import { addDays, diffDays } from './dates';
import type { ISODate, ISODateTime } from './types';

export interface DailyForecast {
  date: ISODate;
  maxC?: number;
  minC?: number;
  precipitationMm?: number;
  precipitationProbability?: number;
}

export interface SoilTemperatureDay {
  date: ISODate;
  /** Daily mean of the provider's soil temperature at `depthCm`. */
  meanC: number;
}

export interface WeatherSnapshot {
  provider: string;
  fetchedAt: ISODateTime;
  /** Rounded coordinates the request was made for. */
  latitude: number;
  longitude: number;
  timezone: string;
  current?: { temperatureC: number; observedAt: ISODateTime };
  daily: DailyForecast[];
  soil?: {
    depthCm: number;
    /** 'modelled' = estimated by a weather model; 'measured' = a sensor/station. */
    kind: 'modelled' | 'measured';
    days: SoilTemperatureDay[];
  };
}

export type WeatherFreshness = 'fresh' | 'stale' | 'unavailable';

/** Thresholds (BearyNatural heuristics — see docs/ARCHITECTURE.md). */
export const WEATHER_THRESHOLDS = {
  /** Snapshots newer than this are "fresh". */
  freshHours: 3,
  /** Older than this, forecasts are not used for advice at all. */
  maxUsableHours: 48,
  /** Forecast minimum at/below this (air, 2 m) suggests frost is possible at ground level. */
  frostRiskMinC: 2,
  /** Forecast maximum at/above this is treated as extreme heat for plants. */
  extremeHeatMaxC: 35,
  /** Daily rain at/above this is "heavy" for gardening purposes. */
  heavyRainMm: 25,
  /** Rain at/above this in the next day is "meaningful" enough to check soil before watering. */
  meaningfulRainMm: 5,
} as const;

export function weatherAgeHours(snapshot: WeatherSnapshot, now: Date): number {
  const t = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(t)) return Infinity;
  return Math.max(0, (now.getTime() - t) / 3_600_000);
}

export function weatherFreshness(snapshot: WeatherSnapshot | null | undefined, now: Date): WeatherFreshness {
  if (!snapshot) return 'unavailable';
  const age = weatherAgeHours(snapshot, now);
  if (!Number.isFinite(age)) return 'unavailable';
  if (age <= WEATHER_THRESHOLDS.freshHours) return 'fresh';
  if (age <= WEATHER_THRESHOLDS.maxUsableHours) return 'stale';
  return 'unavailable';
}

export function describeAge(hours: number): string {
  if (!Number.isFinite(hours)) return 'unknown age';
  if (hours < 1) return 'less than an hour ago';
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'} ago`;
  const d = Math.round(hours / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export interface WeatherAssessment {
  freshness: WeatherFreshness;
  ageHours: number;
  /** Plain-language caveat to append to any weather-based advice. */
  caveat?: string;
  /** Forecast days from today onward (never past days). */
  upcoming: DailyForecast[];
  frostDays: ISODate[];
  heatDays: ISODate[];
  heavyRainDays: ISODate[];
  rainNext24hMm?: number;
  rainNext48hMm?: number;
  maxNext7C?: number;
  minNext7C?: number;
  /** Current-ish modelled soil temperature (today's daily mean), when available. */
  soilTempC?: number;
  soilTempKind?: 'modelled' | 'measured';
  soilTempDepthCm?: number;
  /** True when no usable weather exists — advice must fall back to seasonal knowledge. */
  seasonalOnly: boolean;
}

/**
 * Summarise a snapshot for the recommendation engine. `today` is the
 * gardener's local date; forecast days before today are ignored.
 */
export function assessWeather(snapshot: WeatherSnapshot | null | undefined, today: ISODate, now: Date): WeatherAssessment {
  const freshness = weatherFreshness(snapshot, now);
  const ageHours = snapshot ? weatherAgeHours(snapshot, now) : Infinity;
  const empty: WeatherAssessment = {
    freshness,
    ageHours,
    upcoming: [],
    frostDays: [],
    heatDays: [],
    heavyRainDays: [],
    seasonalOnly: true,
  };
  if (!snapshot || freshness === 'unavailable') {
    return {
      ...empty,
      caveat: snapshot
        ? `The last weather update was ${describeAge(ageHours)}, which is too old to rely on. Advice is based on seasonal information only.`
        : 'Live weather is unavailable. Advice is based on seasonal information only.',
    };
  }
  const horizon = addDays(today, 7);
  const upcoming = snapshot.daily
    .filter((d) => d.date >= today && d.date < horizon)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (upcoming.length === 0) {
    return { ...empty, caveat: 'The saved forecast does not cover the coming days. Advice is based on seasonal information only.' };
  }
  const T = WEATHER_THRESHOLDS;
  const frostDays = upcoming.filter((d) => d.minC !== undefined && d.minC <= T.frostRiskMinC).map((d) => d.date);
  const heatDays = upcoming.filter((d) => d.maxC !== undefined && d.maxC >= T.extremeHeatMaxC).map((d) => d.date);
  const heavyRainDays = upcoming
    .filter((d) => d.precipitationMm !== undefined && d.precipitationMm >= T.heavyRainMm)
    .map((d) => d.date);
  const within = (n: number) => upcoming.filter((d) => diffDays(today, d.date) < n);
  const sumRain = (days: DailyForecast[]) =>
    days.some((d) => d.precipitationMm !== undefined)
      ? days.reduce((s, d) => s + (d.precipitationMm ?? 0), 0)
      : undefined;
  // Forecasts are daily totals, so "next 24 h" means tomorrow's daily total and
  // "next 48 h" means tomorrow plus the day after.
  const tomorrow = upcoming.filter((d) => diffDays(today, d.date) === 1);
  const maxes = upcoming.map((d) => d.maxC).filter((v): v is number => v !== undefined);
  const mins = upcoming.map((d) => d.minC).filter((v): v is number => v !== undefined);

  let soilTempC: number | undefined;
  if (snapshot.soil) {
    const todaySoil = snapshot.soil.days.find((d) => d.date === today) ?? snapshot.soil.days.find((d) => d.date > today);
    soilTempC = todaySoil ? Math.round(todaySoil.meanC * 10) / 10 : undefined;
  }

  return {
    freshness,
    ageHours,
    caveat: freshness === 'stale' ? `Based on a forecast from ${describeAge(ageHours)} — it may have changed.` : undefined,
    upcoming,
    frostDays,
    heatDays,
    heavyRainDays,
    rainNext24hMm: sumRain(tomorrow),
    rainNext48hMm: sumRain(within(3).filter((d) => d.date !== today)),
    maxNext7C: maxes.length ? Math.max(...maxes) : undefined,
    minNext7C: mins.length ? Math.min(...mins) : undefined,
    soilTempC,
    soilTempKind: soilTempC !== undefined ? snapshot.soil?.kind : undefined,
    soilTempDepthCm: soilTempC !== undefined ? snapshot.soil?.depthCm : undefined,
    seasonalOnly: false,
  };
}

/** Days (within the assessment) with forecast max at or above a threshold. */
export function daysAtOrAbove(a: WeatherAssessment, maxC: number, withinDays = 7, today?: ISODate): ISODate[] {
  return a.upcoming
    .filter((d) => d.maxC !== undefined && d.maxC >= maxC)
    .filter((d) => (today ? diffDays(today, d.date) < withinDays : true))
    .map((d) => d.date);
}

/** A one-line, honest description of soil temperature status. */
export function describeSoilTemperature(a: WeatherAssessment): string {
  if (a.soilTempC === undefined) {
    return 'Soil temperature is not available, so germination advice uses seasonal timing only.';
  }
  const label = a.soilTempKind === 'measured' ? 'Measured' : 'Modelled (estimated)';
  return `${label} soil temperature at about ${a.soilTempDepthCm ?? 6} cm: ${a.soilTempC}°C.`;
}
