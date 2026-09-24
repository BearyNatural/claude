/**
 * Safe backup import: validate → identify → version check → migrate →
 * validate every record → produce a preview. Nothing is written here; the
 * storage layer applies a validated backup atomically after the gardener
 * confirms (see services/storage/gardenRepository.ts).
 */
import { emptyGardenData, type GardenData } from '../types';
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
} from '../validation';
import { BACKUP_FORMAT, CURRENT_SCHEMA_VERSION, fnv1a, MIN_SUPPORTED_SCHEMA_VERSION, stableStringify } from './format';
import { migrate } from './migrations';

export type ImportErrorCode = 'empty' | 'too-large' | 'not-json' | 'not-sow-by-season' | 'bad-version' | 'too-new' | 'too-old' | 'corrupt' | 'no-data';

export interface ImportError {
  ok: false;
  code: ImportErrorCode;
  message: string;
}

export interface SkippedRecord {
  collection: string;
  index: number;
  reason: string;
}

export interface ImportPreview {
  ok: true;
  data: GardenData;
  schemaVersion: number;
  migratedFrom?: number;
  migrations: string[];
  createdAt?: string;
  appVersion?: string;
  counts: Record<string, number>;
  skipped: SkippedRecord[];
  warnings: string[];
}

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

const fail = (code: ImportErrorCode, message: string): ImportError => ({ ok: false, code, message });

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function collect<T>(name: string, raw: unknown, validate: (v: unknown) => Result<T>, skipped: SkippedRecord[]): T[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    skipped.push({ collection: name, index: -1, reason: 'was not a list' });
    return [];
  }
  const out: T[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const r = validate(item);
    if (!r.ok) {
      skipped.push({ collection: name, index: i, reason: r.error });
      return;
    }
    const id = (r.value as { id?: string; taskId?: string }).id ?? (r.value as { taskId?: string }).taskId;
    if (id && name !== 'taskResponses' && seen.has(id)) {
      skipped.push({ collection: name, index: i, reason: `duplicate id ${id}` });
      return;
    }
    if (id) seen.add(id);
    out.push(r.value);
  });
  return out;
}

export function parseBackup(text: string): ImportPreview | ImportError {
  if (!text || !text.trim()) return fail('empty', 'The file is empty.');
  if (text.length > MAX_BACKUP_BYTES) return fail('too-large', 'The file is too large to be a Sow by Season backup.');
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return fail('not-json', 'This file could not be read. It may be damaged or not a backup file.');
  }
  if (!isObj(doc) || doc.format !== BACKUP_FORMAT) {
    return fail('not-sow-by-season', 'This doesn\'t look like a Sow by Season backup.');
  }
  const v = doc.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v)) return fail('bad-version', 'The backup\'s version information is missing or invalid.');
  if (v > CURRENT_SCHEMA_VERSION) return fail('too-new', 'This backup was made by a newer version of Sow by Season. Please update the app, then try again.');
  if (v < MIN_SUPPORTED_SCHEMA_VERSION) return fail('too-old', 'This backup is from a version that is no longer supported.');
  if (!isObj(doc.data)) return fail('no-data', 'The backup contains no garden data.');

  // Integrity check (v2+). Done on the stored data before migration.
  const warnings: string[] = [];
  if (v >= 2) {
    if (typeof doc.checksum === 'string') {
      if (fnv1a(stableStringify(doc.data)) !== doc.checksum) {
        return fail('corrupt', 'The backup failed its integrity check — it may have been damaged or edited. Nothing was changed.');
      }
    } else {
      warnings.push('This backup has no integrity checksum, so damage can\'t be ruled out.');
    }
  }

  let migrated: Json = doc;
  let migrations: string[] = [];
  if (v < CURRENT_SCHEMA_VERSION) {
    try {
      const m = migrate(doc, v, CURRENT_SCHEMA_VERSION);
      migrated = m.doc;
      migrations = m.applied;
    } catch (e) {
      return fail('corrupt', `The backup could not be upgraded: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const d = migrated.data as Json;
  const skipped: SkippedRecord[] = [];
  const data = emptyGardenData();
  if (d.profile !== undefined && d.profile !== null) {
    const r = validateProfile(d.profile);
    if (r.ok) data.profile = r.value;
    else skipped.push({ collection: 'profile', index: 0, reason: r.error });
  }
  if (d.settings !== undefined) {
    const r = validateSettings(d.settings);
    if (r.ok) data.settings = r.value;
    else skipped.push({ collection: 'settings', index: 0, reason: r.error });
  }
  data.areas = collect('areas', d.areas, validateArea, skipped);
  data.plantings = collect('plantings', d.plantings, validatePlanting, skipped);
  data.journal = collect('journal', d.journal, validateJournal, skipped);
  data.wishlist = collect('wishlist', d.wishlist, validateWish, skipped);
  data.successionPlans = collect('successionPlans', d.successionPlans, validateSuccessionPlan, skipped);
  data.taskResponses = collect('taskResponses', d.taskResponses, validateTaskResponse, skipped);
  data.observations = collect('observations', d.observations, validateObservation, skipped);

  // Referential tidy-up: dangling area references are cleared, not fatal.
  const areaIds = new Set(data.areas.map((a) => a.id));
  let dangling = 0;
  data.plantings = data.plantings.map((p) => {
    if (p.areaId && !areaIds.has(p.areaId)) {
      dangling++;
      const { areaId: _drop, ...rest } = p;
      return rest;
    }
    return p;
  });
  if (dangling) warnings.push(`${dangling} planting${dangling > 1 ? 's referred' : ' referred'} to a garden area that isn't in the backup; they'll be shown without an area.`);
  if (skipped.length) warnings.push(`${skipped.length} record${skipped.length > 1 ? 's' : ''} could not be read and will be left out.`);
  if (!data.profile) warnings.push('The backup has no Garden Profile; you\'ll be asked to set one up after restoring.');

  const counts = {
    areas: data.areas.length,
    plantings: data.plantings.length,
    journal: data.journal.length,
    wishlist: data.wishlist.length,
    successionPlans: data.successionPlans.length,
  };
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (total === 0 && !data.profile) return fail('no-data', 'The backup contains no readable garden data. Nothing was changed.');

  return {
    ok: true,
    data,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    migratedFrom: v < CURRENT_SCHEMA_VERSION ? v : undefined,
    migrations,
    createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : undefined,
    appVersion: isObj(doc.app) && typeof doc.app.version === 'string' ? doc.app.version : undefined,
    counts,
    skipped,
    warnings,
  };
}
