import { Ctx, getSecretValue, getSettings, setSecretValue, updateSettings } from './core';
import { LatestRelease, newerThan } from '../../domain/updates';

/**
 * Checking for a newer version of Geranium: at most once a day unless asked, only when the
 * person has it switched on (Settings › Preferences › About & updates). The check itself is
 * done by the platform: the desktop app reads GitHub's public release list, the browser version
 * reads the website's version.json. Nothing about the person or their data is sent.
 */

export interface UpdateSource {
  /** 'download' for the desktop app; 'reload' for the browser version (the website already has it). */
  kind: 'download' | 'reload';
  fetchLatest(): Promise<LatestRelease | null>;
}

export interface UpdateStatus {
  current: string;
  enabled: boolean;
  kind: 'download' | 'reload';
  /** A newer version, if one is known. */
  latest: LatestRelease | null;
  /** The person closed the banner for this version. */
  dismissed: boolean;
  checkedAt: string | null;
  error: string | null;
}

const KEY = 'updateCheck';
const DAY_MS = 24 * 60 * 60 * 1000;

interface Cached { checkedAt: string; latest: LatestRelease | null; error: string | null }

export async function updateStatus(ctx: Ctx, current: string, source: UpdateSource | null, opts: { force?: boolean } = {}): Promise<UpdateStatus> {
  const s = getSettings(ctx).updates;
  let cached = getSecretValue<Cached>(ctx, KEY);
  const due = !cached || Date.now() - Date.parse(cached.checkedAt) >= DAY_MS;
  if (source && (s.check || opts.force) && (due || opts.force)) {
    try {
      cached = { checkedAt: new Date().toISOString(), latest: await source.fetchLatest(), error: null };
    } catch {
      cached = { checkedAt: new Date().toISOString(), latest: cached?.latest ?? null, error: 'Geranium could not reach the update service. It will try again later.' };
    }
    setSecretValue(ctx, KEY, cached);
  }
  const latest = s.check || opts.force ? newerThan(cached?.latest ?? null, current) : null;
  return {
    current,
    enabled: s.check,
    kind: source?.kind ?? 'download',
    latest,
    dismissed: !!latest && s.dismissedVersion === latest.version,
    checkedAt: cached?.checkedAt ?? null,
    error: cached?.error ?? null,
  };
}

/** Hide the banner for this version (a newer one shows it again). */
export function dismissUpdate(ctx: Ctx, version: string): void {
  const s = getSettings(ctx).updates;
  updateSettings(ctx, { updates: { ...s, dismissedVersion: version } });
}
