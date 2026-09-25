/**
 * Downloads plant list updates published between app releases, from the
 * private repository BearyNatural/sow-by-season-plant-data (plant data only),
 * via the GitHub API with a read-only token for that one repository. The token
 * is supplied at build time (EXPO_PUBLIC_PLANT_DATA_TOKEN, from the
 * PLANT_DATA_READ_TOKEN Actions secret) — never stored in the source.
 * Checked at most once a day (or when asked), cached for offline use, and
 * validated before use (see domain/catalogueUpdate.ts). Nothing about the
 * garden is sent.
 */
import { parseCatalogueFeed, type ParsedFeed } from '../../domain/catalogueUpdate';
import type { SourceRef } from '../../domain/plantTypes';
import type { KeyValueStore } from '../storage/keyValueStore';

export type HeaderFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const CATALOGUE_FEED_URL = 'https://api.github.com/repos/BearyNatural/sow-by-season-plant-data/contents/catalogue.json';
const CACHE_KEY = 'sbs:cache:catalogue';
const CHECKED_KEY = 'sbs:meta:catalogueCheckedAt';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;

export interface CheckResult {
  /** The newest usable plant list (just downloaded, or the cached one). */
  feed: ParsedFeed | null;
  checked: boolean;
  error?: string;
}

export class CatalogueUpdates {
  constructor(
    private store: KeyValueStore,
    private bundled: { version: string; sources: Record<string, SourceRef> },
    private deps: { fetch: HeaderFetch; now: () => Date; token?: string; url?: string },
  ) {}

  async cached(): Promise<ParsedFeed | null> {
    try {
      const raw = await this.store.getItem(CACHE_KEY);
      if (!raw) return null;
      const r = parseCatalogueFeed(JSON.parse(raw), this.bundled.version, this.bundled.sources);
      return r.ok ? r.feed : null;
    } catch {
      return null;
    }
  }

  async lastCheckedAt(): Promise<string | null> {
    return this.store.getItem(CHECKED_KEY).catch(() => null);
  }

  async check(force = false): Promise<CheckResult> {
    const cached = await this.cached();
    if (!this.deps.token) return { feed: cached, checked: false, error: 'Plant list updates aren\'t set up in this copy of the app. New plants arrive with app updates.' };
    const last = await this.lastCheckedAt();
    if (!force && last && this.deps.now().getTime() - Date.parse(last) < DAY_MS) return { feed: cached, checked: false };
    let text: string;
    try {
      const res = await this.deps.fetch(this.deps.url ?? CATALOGUE_FEED_URL, {
        headers: { Authorization: `Bearer ${this.deps.token}`, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return { feed: cached, checked: true, error: 'Plant list updates need renewing (the app\'s access has expired). The current plant list is still used.' };
      }
      if (!res.ok) return { feed: cached, checked: true, error: `The plant list couldn't be downloaded (${res.status}).` };
      const json = await res.json();
      text = JSON.stringify(json);
      if (text.length > MAX_BYTES) return { feed: cached, checked: true, error: 'The plant list download was unexpectedly large and was ignored.' };
      const r = parseCatalogueFeed(json, this.bundled.version, this.bundled.sources);
      await this.store.setItem(CHECKED_KEY, this.deps.now().toISOString()).catch(() => undefined);
      if (!r.ok) return { feed: cached, checked: true, error: r.reason === 'older' ? undefined : r.message };
      await this.store.setItem(CACHE_KEY, text).catch(() => undefined);
      return { feed: r.feed, checked: true };
    } catch {
      return { feed: cached, checked: true, error: 'Couldn\'t check for plant list updates (you may be offline).' };
    }
  }

  async clear(): Promise<void> {
    await this.store.removeItem(CACHE_KEY).catch(() => undefined);
    await this.store.removeItem(CHECKED_KEY).catch(() => undefined);
  }
}
