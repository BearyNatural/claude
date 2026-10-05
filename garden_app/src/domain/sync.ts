/**
 * Merging two copies of a garden — this device's and the one saved in the
 * gardener's cloud storage by another device — record by record.
 *
 * Rules
 *  - A record on only one side is kept (it was added there).
 *  - A record on both sides: the most recently changed copy wins (ties keep
 *    this device's copy).
 *  - A deletion on either side removes the record, unless the record was
 *    changed after it was deleted (then the change wins and it comes back).
 *  - Settings shared between devices follow the newest change; device-only
 *    ones (which garden is shown, last backup time) stay as they are here.
 *  - Deletions are remembered for DELETION_DAYS, long enough for every device
 *    to have synced, then forgotten.
 *  - The same plant wished for on both devices is kept once.
 */
import type { Deletion, GardenData, AppSettings } from './types';

export const DELETION_DAYS = 180;

const COLLECTIONS = ['areas', 'plantings', 'journal', 'wishlist', 'successionPlans', 'taskResponses', 'observations', 'customPlants', 'gardens', 'pestReports'] as const;
type SyncCollection = (typeof COLLECTIONS)[number];

/** Settings that belong to one device and are never synced. */
export const DEVICE_ONLY_SETTINGS: (keyof AppSettings)[] = ['id', 'updatedAt', 'lastBackupAt', 'activeGardenId'];

type AnyRecord = { id?: string; taskId?: string; updatedAt?: string; createdAt?: string; addedAt?: string; at?: string };

const keyOf = (r: AnyRecord) => r.id ?? r.taskId ?? '';
/** When a record last changed; records that are never edited use when they were made. */
const versionOf = (r: AnyRecord) => r.updatedAt ?? r.createdAt ?? r.addedAt ?? r.at ?? '';

export interface MergeSummary {
  /** Records that came from the other device (new or newer there). */
  fromRemote: number;
  /** Records removed here because they were deleted on the other device. */
  deletedHere: number;
  /** Whether the other device is missing anything this device has (so the cloud copy should be updated). */
  remoteNeedsUpdate: boolean;
}

export function mergeGardenData(local: GardenData, remote: GardenData, now: Date): { data: GardenData; summary: MergeSummary } {
  const cutoff = new Date(now.getTime() - DELETION_DAYS * 86_400_000).toISOString();
  const deletions = mergeDeletions(local.deletions ?? [], remote.deletions ?? [], cutoff);
  const deletedAt = new Map(deletions.map((d) => [d.id, d.at]));
  let fromRemote = 0;
  let deletedHere = 0;
  let remoteNeedsUpdate = deletions.length !== (remote.deletions ?? []).filter((d) => d.at >= cutoff).length;

  const merged = { ...local, deletions } as GardenData;
  for (const c of COLLECTIONS) {
    const mine = new Map((local[c] as AnyRecord[]).map((r) => [keyOf(r), r]));
    const theirs = new Map(((remote[c] ?? []) as AnyRecord[]).map((r) => [keyOf(r), r]));
    const out: AnyRecord[] = [];
    for (const k of new Set([...mine.keys(), ...theirs.keys()])) {
      const a = mine.get(k);
      const b = theirs.get(k);
      const pick = !a ? b! : !b ? a : versionOf(b) > versionOf(a) ? b : a;
      const gone = deletedAt.get(`${c}:${k}`);
      if (gone && gone >= versionOf(pick)) {
        if (a) deletedHere++;
        if (b) remoteNeedsUpdate = true;
        continue;
      }
      if (pick !== a) fromRemote++;
      if (pick !== b && (!b || versionOf(pick) !== versionOf(b))) remoteNeedsUpdate = true;
      out.push(pick);
    }
    (merged as unknown as Record<SyncCollection, AnyRecord[]>)[c] = c === 'wishlist' ? onePerPlant(out as { plantId: string; addedAt: string }[]) : out;
  }

  // Profile: newest wins.
  if (local.profile || remote.profile) {
    const a = local.profile;
    const b = remote.profile;
    const pick = !a ? b : !b ? a : b.updatedAt > a.updatedAt ? b : a;
    if (pick !== a) fromRemote++;
    if (pick !== b) remoteNeedsUpdate = true;
    merged.profile = pick ?? null;
  }

  // Settings: shared ones from whichever changed last; device-only ones from here.
  const ls = local.settings;
  const rs = remote.settings;
  if (rs && (rs.updatedAt ?? '') > (ls.updatedAt ?? '')) {
    const keep = Object.fromEntries(DEVICE_ONLY_SETTINGS.filter((k) => k !== 'updatedAt').map((k) => [k, ls[k]]));
    merged.settings = { ...rs, ...keep, id: 'settings' } as AppSettings;
    fromRemote++;
  } else if ((ls.updatedAt ?? '') > (rs?.updatedAt ?? '')) {
    remoteNeedsUpdate = true;
  }

  for (const c of COLLECTIONS) (merged[c] as AnyRecord[]).sort((x, y) => (versionOf(x) < versionOf(y) ? 1 : -1));
  return { data: merged, summary: { fromRemote, deletedHere, remoteNeedsUpdate } };
}

function mergeDeletions(a: Deletion[], b: Deletion[], cutoff: string): Deletion[] {
  const out = new Map<string, Deletion>();
  for (const d of [...a, ...b]) {
    if (d.at < cutoff) continue;
    const prev = out.get(d.id);
    if (!prev || d.at > prev.at) out.set(d.id, d);
  }
  return [...out.values()];
}

function onePerPlant<T extends { plantId: string; addedAt: string }>(items: T[]): T[] {
  const first = new Map<string, T>();
  for (const w of items) {
    const prev = first.get(w.plantId);
    if (!prev || w.addedAt < prev.addedAt) first.set(w.plantId, w);
  }
  return [...first.values()];
}
