/**
 * Weather service: fetch + cache. The cache keeps the last good snapshot with
 * its fetch time so the app can show "stale" data honestly while offline.
 * Freshness decisions live in the domain (assessWeather), not here.
 */
import type { WeatherSnapshot } from '../../domain/weather';
import type { KeyValueStore } from '../storage/keyValueStore';
import { fetchForecast, WeatherError, type FetchLike, type OpenMeteoConfig } from './openMeteo';

const CACHE_KEY = 'sbs:cache:weather';

export interface WeatherResult {
  snapshot: WeatherSnapshot | null;
  /** Set when a refresh failed; snapshot may still hold older cached data. */
  error?: string;
  fromCache: boolean;
}

export class WeatherService {
  private inflight: Promise<WeatherResult> | null = null;

  constructor(
    private store: KeyValueStore,
    private deps: { fetch: FetchLike; now: () => Date; config?: OpenMeteoConfig },
  ) {}

  async cached(): Promise<WeatherSnapshot | null> {
    try {
      const raw = await this.store.getItem(CACHE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as WeatherSnapshot;
      return s && typeof s.fetchedAt === 'string' && Array.isArray(s.daily) ? s : null;
    } catch {
      return null;
    }
  }

  /**
   * Get weather for a location. Uses cache when it is younger than
   * `maxAgeMinutes` and matches the location; otherwise fetches.
   */
  async get(lat: number, lon: number, timezone: string, opts: { force?: boolean; maxAgeMinutes?: number } = {}): Promise<WeatherResult> {
    if (this.inflight) return this.inflight;
    this.inflight = this.doGet(lat, lon, timezone, opts).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doGet(lat: number, lon: number, timezone: string, opts: { force?: boolean; maxAgeMinutes?: number }): Promise<WeatherResult> {
    const cached = await this.cached();
    const sameLocation = cached && Math.abs(cached.latitude - lat) < 0.011 && Math.abs(cached.longitude - lon) < 0.011;
    const usableCache = sameLocation ? cached : null;
    const maxAge = (opts.maxAgeMinutes ?? 60) * 60_000;
    if (!opts.force && usableCache && this.deps.now().getTime() - Date.parse(usableCache.fetchedAt) < maxAge) {
      return { snapshot: usableCache, fromCache: true };
    }
    try {
      const snap = await fetchForecast(lat, lon, timezone, this.deps);
      await this.store.setItem(CACHE_KEY, JSON.stringify(snap)).catch(() => undefined);
      return { snapshot: snap, fromCache: false };
    } catch (e) {
      const msg = e instanceof WeatherError ? e.message : 'Weather could not be updated.';
      return { snapshot: usableCache, error: msg, fromCache: true };
    }
  }

  async clear(): Promise<void> {
    await this.store.removeItem(CACHE_KEY);
  }
}
