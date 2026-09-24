/**
 * Local-first, resilient garden storage.
 *
 * Layout (all keys prefixed "sbs:"):
 *   sbs:meta:generation            → active data generation, e.g. "3"
 *   sbs:g3:profile                 → { v, d: GardenProfile }
 *   sbs:g3:settings                → { v, d: AppSettings }
 *   sbs:g3:<collection>:<id>       → { v, d: record }
 *   sbs:quarantine:<ts>:<key>      → raw value of a record that failed to parse
 *
 * Design goals
 *  - One record per key: a single corrupt record is quarantined and reported;
 *    it never prevents the rest of the garden from loading.
 *  - Restore is atomic: a complete new generation is written and verified
 *    before a single-key pointer flip makes it active. If anything fails
 *    first, the new generation is discarded and current data is untouched.
 *  - Writes are serialised through a queue to avoid interleaving.
 */
import { CURRENT_SCHEMA_VERSION } from '../../domain/backup/format';
import {
  DEFAULT_SETTINGS,
  emptyGardenData,
  type AppSettings,
  type GardenArea,
  type GardenData,
  type GardenProfile,
  type JournalEntry,
  type Observation,
  type Planting,
  type SuccessionPlan,
  type TaskResponse,
  type WishListItem,
} from '../../domain/types';
import {
  validateArea,
  validateJournal,
  validateObservation,
  validatePlanting,
  validateProfile,
  validateSettings,
  validateSuccessionPlan,
  validateTaskResponse,
  validateWish,
  type Result,
} from '../../domain/validation';
import type { KeyValueStore } from './keyValueStore';

export type CollectionName = 'areas' | 'plantings' | 'journal' | 'wishlist' | 'successionPlans' | 'taskResponses' | 'observations';

export interface CollectionTypes {
  areas: GardenArea;
  plantings: Planting;
  journal: JournalEntry;
  wishlist: WishListItem;
  successionPlans: SuccessionPlan;
  taskResponses: TaskResponse;
  observations: Observation;
}

const VALIDATORS: { [K in CollectionName]: (v: unknown) => Result<CollectionTypes[K]> } = {
  areas: validateArea,
  plantings: validatePlanting,
  journal: validateJournal,
  wishlist: validateWish,
  successionPlans: validateSuccessionPlan,
  taskResponses: validateTaskResponse,
  observations: validateObservation,
};

export const COLLECTIONS = Object.keys(VALIDATORS) as CollectionName[];

const GEN_KEY = 'sbs:meta:generation';
const QUARANTINE = 'sbs:quarantine:';

function recordId<K extends CollectionName>(c: K, r: CollectionTypes[K]): string {
  return c === 'taskResponses' ? (r as TaskResponse).taskId : (r as { id: string }).id;
}

export interface LoadProblem {
  key: string;
  reason: string;
  quarantinedAs?: string;
}

export interface LoadResult {
  data: GardenData;
  problems: LoadProblem[];
}

export class GardenRepository {
  private gen: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private store: KeyValueStore, private now: () => Date = () => new Date()) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async generation(): Promise<number> {
    if (this.gen !== null) return this.gen;
    const raw = await this.store.getItem(GEN_KEY);
    const n = raw ? Number(raw) : NaN;
    this.gen = Number.isInteger(n) && n > 0 ? n : 1;
    if (!raw) await this.store.setItem(GEN_KEY, String(this.gen));
    return this.gen;
  }

  private prefix(gen: number) {
    return `sbs:g${gen}:`;
  }

  private wrap(d: unknown): string {
    return JSON.stringify({ v: CURRENT_SCHEMA_VERSION, d });
  }

  private unwrap(raw: string): unknown {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'd' in parsed) return (parsed as { d: unknown }).d;
    return parsed;
  }

  async load(): Promise<LoadResult> {
    return this.enqueue(async () => {
      const gen = await this.generation();
      const prefix = this.prefix(gen);
      const keys = await this.store.getAllKeys();
      // Clean up generations left behind by an interrupted restore.
      const orphans = keys.filter((k) => /^sbs:g\d+:/.test(k) && !k.startsWith(prefix));
      if (orphans.length) await this.store.multiRemove(orphans);
      const mine = keys.filter((k) => k.startsWith(prefix));
      const pairs = await this.store.multiGet(mine);
      const data = emptyGardenData();
      const problems: LoadProblem[] = [];
      const bad: [string, string, string][] = [];
      for (const [key, raw] of pairs) {
        if (raw === null) continue;
        const rest = key.slice(prefix.length);
        let value: unknown;
        try {
          value = this.unwrap(raw);
        } catch {
          bad.push([key, raw, 'Could not be read (damaged data)']);
          continue;
        }
        if (rest === 'profile') {
          const r = validateProfile(value);
          if (r.ok) data.profile = r.value;
          else bad.push([key, raw, r.error]);
          continue;
        }
        if (rest === 'settings') {
          const r = validateSettings(value);
          if (r.ok) data.settings = r.value;
          else bad.push([key, raw, r.error]);
          continue;
        }
        const colon = rest.indexOf(':');
        const c = rest.slice(0, colon) as CollectionName;
        if (!(c in VALIDATORS)) continue; // unknown future collection: leave untouched
        const r = VALIDATORS[c](value);
        if (r.ok) (data[c] as unknown[]).push(r.value);
        else bad.push([key, raw, r.error]);
      }
      const stamp = this.now().toISOString();
      for (const [key, raw, reason] of bad) {
        const qKey = `${QUARANTINE}${stamp}:${key}`;
        try {
          await this.store.setItem(qKey, raw);
          await this.store.removeItem(key);
          problems.push({ key, reason, quarantinedAs: qKey });
        } catch {
          problems.push({ key, reason });
        }
      }
      data.plantings.sort((a, b) => (a.plantedDate < b.plantedDate ? 1 : -1));
      data.journal.sort((a, b) => (a.date < b.date ? 1 : -1));
      return { data, problems };
    });
  }

  async saveProfile(p: GardenProfile): Promise<void> {
    const r = validateProfile(p);
    if (!r.ok) throw new Error(`Profile not saved: ${r.error}`);
    return this.enqueue(async () => this.store.setItem(`${this.prefix(await this.generation())}profile`, this.wrap(r.value)));
  }

  async saveSettings(s: AppSettings): Promise<void> {
    const r = validateSettings(s);
    if (!r.ok) throw new Error(`Settings not saved: ${r.error}`);
    return this.enqueue(async () => this.store.setItem(`${this.prefix(await this.generation())}settings`, this.wrap(r.value)));
  }

  async put<K extends CollectionName>(c: K, record: CollectionTypes[K]): Promise<CollectionTypes[K]> {
    const r = VALIDATORS[c](record);
    if (!r.ok) throw new Error(`Not saved: ${r.error}`);
    const value = r.value;
    await this.enqueue(async () =>
      this.store.setItem(`${this.prefix(await this.generation())}${c}:${recordId(c, value)}`, this.wrap(value)),
    );
    return value;
  }

  async remove(c: CollectionName, id: string): Promise<void> {
    return this.enqueue(async () => this.store.removeItem(`${this.prefix(await this.generation())}${c}:${id}`));
  }

  async quarantineCount(): Promise<number> {
    const keys = await this.store.getAllKeys();
    return keys.filter((k) => k.startsWith(QUARANTINE)).length;
  }

  /**
   * Atomically replace all garden data (used by restore and "delete all").
   * Validates everything first; writes a new generation; verifies it; flips
   * the pointer; then removes the old generation.
   */
  async replaceAll(next: GardenData): Promise<void> {
    // Validate up front so we never begin a write we'd have to abandon.
    const pairs: [string, string][] = [];
    const nextGenPlaceholder = '__GEN__';
    if (next.profile) {
      const r = validateProfile(next.profile);
      if (!r.ok) throw new Error(`Restore aborted: ${r.error}`);
      pairs.push([`${nextGenPlaceholder}profile`, this.wrap(r.value)]);
    }
    const s = validateSettings(next.settings ?? DEFAULT_SETTINGS);
    if (!s.ok) throw new Error(`Restore aborted: ${s.error}`);
    pairs.push([`${nextGenPlaceholder}settings`, this.wrap(s.value)]);
    for (const c of COLLECTIONS) {
      for (const rec of next[c] as unknown[]) {
        const r = VALIDATORS[c](rec);
        if (!r.ok) throw new Error(`Restore aborted: ${r.error}`);
        pairs.push([`${nextGenPlaceholder}${c}:${recordId(c, r.value as never)}`, this.wrap(r.value)]);
      }
    }
    return this.enqueue(async () => {
      const current = await this.generation();
      const target = current + 1;
      const prefix = this.prefix(target);
      const keyed = pairs.map(([k, v]) => [k.replace(nextGenPlaceholder, prefix), v] as const);
      try {
        await this.store.multiSet(keyed);
        // Verify the new generation is complete before activating it.
        const written = (await this.store.getAllKeys()).filter((k) => k.startsWith(prefix));
        if (written.length !== keyed.length) throw new Error('Verification failed: not all records were written.');
        await this.store.setItem(GEN_KEY, String(target));
      } catch (e) {
        const partial = (await this.store.getAllKeys()).filter((k) => k.startsWith(prefix));
        await this.store.multiRemove(partial).catch(() => undefined);
        throw e instanceof Error ? e : new Error(String(e));
      }
      this.gen = target;
      const old = (await this.store.getAllKeys()).filter((k) => k.startsWith(this.prefix(current)));
      await this.store.multiRemove(old).catch(() => undefined); // best effort; load() also cleans up
    });
  }

  /** Remove every Sow by Season key, including caches and quarantine. */
  async deleteEverything(): Promise<void> {
    return this.enqueue(async () => {
      const keys = (await this.store.getAllKeys()).filter((k) => k.startsWith('sbs:'));
      await this.store.multiRemove(keys);
      this.gen = null;
    });
  }
}
