/**
 * Open-Meteo weather client (https://open-meteo.com).
 *
 * Why Open-Meteo: no account or API key for non-commercial use, Australian
 * coverage (including BoM ACCESS model input), daily forecasts and modelled
 * soil temperature at several depths. Commercial releases must use a paid
 * plan: set EXPO_PUBLIC_OPEN_METEO_API_KEY and the client switches to the
 * customer endpoint.
 *
 * Only rounded coordinates (≈1 km) and the timezone are sent.
 */
import type { DailyForecast, SoilTemperatureDay, WeatherSnapshot } from '../../domain/weather';

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class WeatherError extends Error {
  constructor(message: string, readonly code: 'offline' | 'http' | 'bad-response' | 'timeout') {
    super(message);
  }
}

export interface OpenMeteoConfig {
  apiKey?: string;
  timeoutMs?: number;
}

export function buildForecastUrl(lat: number, lon: number, timezone: string, cfg: OpenMeteoConfig = {}): string {
  const base = cfg.apiKey ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast';
  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    current: 'temperature_2m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
    hourly: 'soil_temperature_6cm',
    timezone,
    forecast_days: '7',
  });
  if (cfg.apiKey) params.set('apikey', cfg.apiKey);
  return `${base}?${params.toString()}`;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Parse an Open-Meteo JSON response into a WeatherSnapshot. Throws WeatherError on unusable data. */
export function parseForecast(json: unknown, fetchedAt: Date, lat: number, lon: number, timezone: string): WeatherSnapshot {
  if (!json || typeof json !== 'object') throw new WeatherError('Empty weather response', 'bad-response');
  const j = json as Record<string, any>;
  const daily = j.daily;
  if (!daily || !Array.isArray(daily.time)) throw new WeatherError('Weather response has no daily forecast', 'bad-response');
  const days: DailyForecast[] = daily.time
    .map((date: unknown, i: number) => ({
      date: String(date),
      maxC: num(daily.temperature_2m_max?.[i]),
      minC: num(daily.temperature_2m_min?.[i]),
      precipitationMm: num(daily.precipitation_sum?.[i]),
      precipitationProbability: num(daily.precipitation_probability_max?.[i]),
    }))
    .filter((d: DailyForecast) => /^\d{4}-\d{2}-\d{2}$/.test(d.date));
  if (days.length === 0) throw new WeatherError('Weather response has no usable days', 'bad-response');

  let soil: WeatherSnapshot['soil'];
  const hourly = j.hourly;
  if (hourly && Array.isArray(hourly.time) && Array.isArray(hourly.soil_temperature_6cm)) {
    const sums = new Map<string, { s: number; n: number }>();
    hourly.time.forEach((t: unknown, i: number) => {
      const v = num(hourly.soil_temperature_6cm[i]);
      if (v === undefined || typeof t !== 'string') return;
      const date = t.slice(0, 10);
      const acc = sums.get(date) ?? { s: 0, n: 0 };
      acc.s += v;
      acc.n += 1;
      sums.set(date, acc);
    });
    const sd: SoilTemperatureDay[] = [...sums.entries()]
      .filter(([, a]) => a.n >= 12) // need most of the day to call it a daily mean
      .map(([date, a]) => ({ date, meanC: Math.round((a.s / a.n) * 10) / 10 }));
    if (sd.length) soil = { depthCm: 6, kind: 'modelled', days: sd };
  }

  const cur = j.current;
  const curTemp = num(cur?.temperature_2m);
  return {
    provider: 'open-meteo',
    fetchedAt: fetchedAt.toISOString(),
    latitude: lat,
    longitude: lon,
    timezone,
    current: curTemp !== undefined ? { temperatureC: curTemp, observedAt: fetchedAt.toISOString() } : undefined,
    daily: days,
    soil,
  };
}

export async function fetchForecast(
  lat: number,
  lon: number,
  timezone: string,
  deps: { fetch: FetchLike; now: () => Date; config?: OpenMeteoConfig },
): Promise<WeatherSnapshot> {
  const url = buildForecastUrl(lat, lon, timezone, deps.config);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), deps.config?.timeoutMs ?? 12000) : undefined;
  let res;
  try {
    res = await deps.fetch(url, { signal: controller?.signal });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new WeatherError(aborted ? 'The weather service took too long to respond.' : 'Could not reach the weather service. You may be offline.', aborted ? 'timeout' : 'offline');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok) throw new WeatherError(`The weather service returned an error (${res.status}).`, 'http');
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new WeatherError('The weather service sent an unreadable response.', 'bad-response');
  }
  return parseForecast(json, deps.now(), lat, lon, timezone);
}
