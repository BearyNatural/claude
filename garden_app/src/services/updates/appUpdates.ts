/**
 * "A new version is available" for the phone app. Each release publishes a
 * small app-version.json (version + release link) to the private plant data
 * repository; the app reads it with the same read-only token as the plant list,
 * at most once a day. Installing is up to the gardener: Android only installs
 * apps from outside the Play Store when the person taps Install.
 */
import type { KeyValueStore } from '../storage/keyValueStore';
import type { HeaderFetch } from '../catalogue/catalogueUpdates';

export const APP_VERSION_URL = 'https://api.github.com/repos/BearyNatural/sow-by-season-plant-data/contents/app-version.json';
const CHECKED_KEY = 'sbs:meta:appUpdateCheckedAt';
const CACHE_KEY = 'sbs:cache:appUpdate';
const NOTIFIED_KEY = 'sbs:meta:appUpdateNotified';
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long to wait between online checks, from Garden Profile › General. */
export const UPDATE_CHECK_INTERVAL_MS = { daily: DAY_MS, weekly: 7 * DAY_MS } as const;

export interface AppRelease {
  version: string;
  /** Web page to download the new version from (the release page). */
  url: string;
  publishedAt?: string;
}

/** Compare "1.10.2"-style versions numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Only a well-formed, newer release with a link to this app's own release pages is offered. */
export function parseAppRelease(json: unknown, current: string): AppRelease | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const version = typeof o.version === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(o.version) ? o.version : null;
  const url = typeof o.url === 'string' && /^https:\/\/github\.com\/BearyNatural\/claude\/releases\/[\w./-]+$/.test(o.url) ? o.url : null;
  if (!version || !url || compareVersions(version, current) <= 0) return null;
  return { version, url, publishedAt: typeof o.publishedAt === 'string' ? o.publishedAt.slice(0, 40) : undefined };
}

export class AppUpdates {
  constructor(
    private store: KeyValueStore,
    private currentVersion: string,
    private deps: { fetch: HeaderFetch; now: () => Date; token?: string },
  ) {}

  /** A newer release, if one is known (checking online at most once per interval — daily by default). */
  async check(force = false, intervalMs: number = DAY_MS): Promise<AppRelease | null> {
    const cached = await this.cached();
    if (!this.deps.token) return cached;
    const last = await this.store.getItem(CHECKED_KEY).catch(() => null);
    if (!force && last && this.deps.now().getTime() - Date.parse(last) < intervalMs) return cached;
    try {
      const res = await this.deps.fetch(APP_VERSION_URL, {
        headers: { Authorization: `Bearer ${this.deps.token}`, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      await this.store.setItem(CHECKED_KEY, this.deps.now().toISOString()).catch(() => undefined);
      if (!res.ok) return cached;
      const release = parseAppRelease(await res.json(), this.currentVersion);
      if (release) await this.store.setItem(CACHE_KEY, JSON.stringify(release)).catch(() => undefined);
      else await this.store.removeItem(CACHE_KEY).catch(() => undefined);
      return release;
    } catch {
      return cached;
    }
  }

  /** True the first time it's asked about a version, so each new version is announced by notification once. */
  async shouldNotify(version: string): Promise<boolean> {
    const done = await this.store.getItem(NOTIFIED_KEY).catch(() => null);
    if (done === version) return false;
    await this.store.setItem(NOTIFIED_KEY, version).catch(() => undefined);
    return true;
  }

  private async cached(): Promise<AppRelease | null> {
    try {
      const raw = await this.store.getItem(CACHE_KEY);
      return raw ? parseAppRelease(JSON.parse(raw), this.currentVersion) : null;
    } catch {
      return null;
    }
  }
}
