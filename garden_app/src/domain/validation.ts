/**
 * Dependency-free runtime validation for everything the gardener creates.
 *
 * Used when loading records from local storage (one bad record must never
 * take down the whole garden) and when importing backups. Validators return
 * cleaned values: unknown properties are dropped, optional fields that are
 * invalid cause a failure rather than being silently changed.
 */
import { isClimateZone } from './climate';
import { isISODate } from './dates';
import { isAustralianState } from './location';
import { LIFECYCLES, PLANT_CATEGORIES, SUN_NEEDS, SUPPORT_NEEDS, type PlantCategory } from './plantTypes';
import type {
  AppSettings,
  CustomPlant,
  GardenArea,
  GardenLocation,
  GardenProfile,
  JournalEntry,
  Observation,
  Planting,
  PlantingEvent,
  PlantingPhoto,
  PropertyLocation,
  ReminderPreferences,
  SuccessionBatch,
  SuccessionPlan,
  TaskResponse,
  WishListItem,
  Month,
  StartMethod,
} from './types';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export class ValidationError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class R {
  constructor(private o: Record<string, unknown>, private path: string) {}
  /** Own keys and raw values, for maps keyed by data (e.g. climate zone → window). */
  entries(): [string, unknown][] {
    return Object.entries(this.o);
  }
  /** Path of this object, for error messages from custom parsers. */
  at(k: string): string {
    return `${this.path}.${k}`;
  }
  private fail(k: string, msg: string): never {
    throw new ValidationError(`${this.path}.${k}: ${msg}`);
  }
  has(k: string) {
    return this.o[k] !== undefined && this.o[k] !== null;
  }
  str(k: string, opt?: false, max?: number): string;
  str(k: string, opt: true, max?: number): string | undefined;
  str(k: string, opt = false, max = 5000): string | undefined {
    const v = this.o[k];
    if (v === undefined || v === null) return opt ? undefined : this.fail(k, 'required');
    if (typeof v !== 'string') return this.fail(k, 'must be text');
    if (v.length > max) return this.fail(k, `longer than ${max} characters`);
    return v;
  }
  id(k: string): string {
    const v = this.str(k, false, 200);
    if (!v.trim()) this.fail(k, 'must not be empty');
    return v;
  }
  num(k: string, opt?: false, min?: number, max?: number, int?: boolean): number;
  num(k: string, opt: true, min?: number, max?: number, int?: boolean): number | undefined;
  num(k: string, opt = false, min = -Infinity, max = Infinity, int = false): number | undefined {
    const v = this.o[k];
    if (v === undefined || v === null) return opt ? undefined : this.fail(k, 'required');
    if (typeof v !== 'number' || !Number.isFinite(v)) return this.fail(k, 'must be a number');
    if (v < min || v > max) return this.fail(k, `must be between ${min} and ${max}`);
    if (int && !Number.isInteger(v)) return this.fail(k, 'must be a whole number');
    return v;
  }
  bool(k: string, opt?: false): boolean;
  bool(k: string, opt: true): boolean | undefined;
  bool(k: string, opt = false): boolean | undefined {
    const v = this.o[k];
    if (v === undefined || v === null) return opt ? undefined : this.fail(k, 'required');
    if (typeof v !== 'boolean') return this.fail(k, 'must be true/false');
    return v;
  }
  date(k: string, opt?: false): string;
  date(k: string, opt: true): string | undefined;
  date(k: string, opt = false): string | undefined {
    const v = this.o[k];
    if (v === undefined || v === null) return opt ? undefined : this.fail(k, 'required');
    if (!isISODate(v)) return this.fail(k, 'must be a date (YYYY-MM-DD)');
    return v;
  }
  dateTime(k: string, opt?: false): string;
  dateTime(k: string, opt: true): string | undefined;
  dateTime(k: string, opt = false): string | undefined {
    const v = this.o[k];
    if (v === undefined || v === null) return opt ? undefined : this.fail(k, 'required');
    if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) return this.fail(k, 'must be a timestamp');
    return v;
  }
  oneOf<T extends string>(k: string, values: readonly T[], opt?: false): T;
  oneOf<T extends string>(k: string, values: readonly T[], opt: true): T | undefined;
  oneOf<T extends string>(k: string, values: readonly T[], opt = false): T | undefined {
    const v = this.o[k];
    if (v === undefined || v === null) return opt ? undefined : this.fail(k, 'required');
    if (typeof v !== 'string' || !values.includes(v as T)) return this.fail(k, `must be one of ${values.join(', ')}`);
    return v as T;
  }
  arr<T>(k: string, each: (v: unknown, path: string) => T, opt = false, max = 10000): T[] {
    const v = this.o[k];
    if (v === undefined || v === null) {
      if (opt) return [];
      return this.fail(k, 'required');
    }
    if (!Array.isArray(v)) return this.fail(k, 'must be a list');
    if (v.length > max) return this.fail(k, `more than ${max} items`);
    return v.map((x, i) => each(x, `${this.path}.${k}[${i}]`));
  }
  obj(k: string, opt = false): R | undefined {
    const v = this.o[k];
    if (v === undefined || v === null) return opt ? undefined : this.fail(k, 'required');
    if (!isObj(v)) return this.fail(k, 'must be an object');
    return new R(v, `${this.path}.${k}`);
  }
}

export function reader(v: unknown, path: string): R {
  if (!isObj(v)) throw new ValidationError(`${path}: must be an object`);
  return new R(v, path);
}

export function run<T>(fn: () => T): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Removes undefined keys so stored JSON stays tidy. */
export function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

const WEEKDAY = (v: unknown, p: string) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 6) throw new ValidationError(`${p}: must be a weekday 0–6`);
  return v as 0 | 1 | 2 | 3 | 4 | 5 | 6;
};
export const STRING = (max = 200) => (v: unknown, p: string) => {
  if (typeof v !== 'string' || v.length > max) throw new ValidationError(`${p}: must be text`);
  return v;
};

const ZONES = ['tropical', 'subtropical', 'warm-temperate', 'cool-temperate', 'arid'] as const;
const FROST = ['none', 'light', 'moderate', 'heavy', 'unknown'] as const;
const STAGES = ['planned', 'seed', 'germinating', 'seedling', 'transplanted', 'established', 'flowering', 'fruiting', 'harvesting', 'dormant', 'finished', 'removed', 'failed'] as const;
export const METHODS = ['direct-sow', 'seed-tray', 'seedling', 'cutting', 'tuber', 'clove-or-bulb', 'runner-or-crown', 'tree'] as const;
const EVENT_TYPES = ['sown', 'planted', 'germinated', 'transplanted', 'first-flower', 'fruit-set', 'first-harvest', 'harvest', 'finished', 'removed', 'failed', 'stage-change'] as const;
const AREA_TYPES = ['vegetable-bed', 'raised-bed', 'in-ground', 'pot', 'large-container', 'greenhouse', 'orchard', 'food-forest', 'herb-garden', 'balcony', 'trellis', 'seed-starting'] as const;
const GOALS = ['fresh-veg', 'supplement', 'maximise', 'herbs', 'fruit', 'flowers', 'pollinators', 'native', 'low-maintenance', 'learning', 'self-sufficiency'] as const;
const OBS_KINDS = ['soil-moisture', 'soil-temperature', 'air-temperature', 'rainfall', 'humidity', 'tank-level', 'harvest-weight'] as const;

function parseLocation(r: R): GardenLocation {
  const state = r.str('state', true);
  if (state !== undefined && !isAustralianState(state)) throw new ValidationError('location.state: unknown state');
  const zone = (k: string) => {
    const z = r.str(k, true);
    if (z !== undefined && !isClimateZone(z)) throw new ValidationError(`location.${k}: unknown climate zone`);
    return z as GardenLocation['suggestedZone'];
  };
  return clean({
    postcode: r.str('postcode', true, 10),
    suburb: r.str('suburb', true, 120),
    state: state as GardenLocation['state'],
    timezone: r.str('timezone', false, 64),
    approxLatitude: r.num('approxLatitude', true, -45, -9),
    approxLongitude: r.num('approxLongitude', true, 112, 155),
    suggestedZone: zone('suggestedZone'),
    suggestedZoneReason: r.str('suggestedZoneReason', true, 1000),
    overrideZone: zone('overrideZone'),
    suggestedFrostRisk: r.oneOf('suggestedFrostRisk', FROST, true),
    overrideFrostRisk: r.oneOf('overrideFrostRisk', FROST, true),
    source: r.oneOf('source', ['offline-list', 'online-geocoder', 'manual'] as const),
  });
}

function parseReminders(r: R): ReminderPreferences {
  return {
    enabled: r.bool('enabled'),
    gardeningDays: r.arr('gardeningDays', WEEKDAY, true, 7),
    reminderTime: r.str('reminderTime', false, 5),
    quietDays: r.arr('quietDays', WEEKDAY, true, 7),
    mode: r.oneOf('mode', ['daily-summary', 'gardening-days', 'weekly'] as const),
  };
}

const LATLON = (v: unknown, p: string) => {
  const r = reader(v, p);
  return { lat: r.num('lat', false, -90, 90), lon: r.num('lon', false, -180, 180) };
};

function parseProperty(r: R | undefined): PropertyLocation | undefined {
  if (!r) return undefined;
  return clean({ lat: r.num('lat', false, -90, 90), lon: r.num('lon', false, -180, 180), label: r.str('label', true, 300), zoom: r.num('zoom', true, 1, 22) });
}

export function validateProfile(v: unknown): Result<GardenProfile> {
  return run(() => {
    const r = reader(v, 'profile');
    return clean({
      id: 'profile' as const,
      gardenName: r.str('gardenName', true, 120),
      location: parseLocation(r.obj('location')!),
      householdSize: r.num('householdSize', false, 1, 50, true),
      timeBudget: r.oneOf('timeBudget', ['lt1', '1to2', '2to4', '4to8', '8plus'] as const),
      goals: r.arr('goals', (g, p) => {
        if (typeof g !== 'string' || !(GOALS as readonly string[]).includes(g)) throw new ValidationError(`${p}: unknown goal`);
        return g as (typeof GOALS)[number];
      }, true, 20),
      reminders: parseReminders(r.obj('reminders')!),
      property: parseProperty(r.obj('property', true)),
      onboardingComplete: r.bool('onboardingComplete'),
      createdAt: r.dateTime('createdAt'),
      updatedAt: r.dateTime('updatedAt'),
    });
  });
}

export function validateSettings(v: unknown): Result<AppSettings> {
  return run(() => {
    const r = reader(v, 'settings');
    return clean({
      id: 'settings' as const,
      weatherEnabled: r.bool('weatherEnabled'),
      lastBackupAt: r.dateTime('lastBackupAt', true),
      hiddenPlantIds: r.arr('hiddenPlantIds', STRING(100), true, 1000),
      plantListUpdates: r.bool('plantListUpdates', true),
    });
  });
}

export function validateArea(v: unknown): Result<GardenArea> {
  return run(() => {
    const r = reader(v, 'area');
    const c = r.obj('container', true);
    return clean({
      id: r.id('id'),
      name: r.str('name', false, 120),
      type: r.oneOf('type', AREA_TYPES),
      lengthM: r.num('lengthM', true, 0, 10000),
      widthM: r.num('widthM', true, 0, 10000),
      usableAreaM2: r.num('usableAreaM2', true, 0, 1_000_000),
      sunHours: r.num('sunHours', true, 0, 24),
      soilType: r.oneOf('soilType', ['sandy', 'loam', 'clay', 'potting-mix', 'raised-bed-mix', 'unknown'] as const, true),
      drainage: r.oneOf('drainage', ['fast', 'normal', 'stays-wet', 'unknown'] as const, true),
      soilObservations: r.has('soilObservations')
        ? r.arr('soilObservations', (x, p) => {
            const vals = ['compacted', 'hydrophobic', 'rocky', 'high-organic', 'low-organic'];
            if (typeof x !== 'string' || !vals.includes(x)) throw new ValidationError(`${p}: unknown soil observation`);
            return x as 'compacted';
          }, true, 10)
        : undefined,
      irrigation: r.oneOf('irrigation', ['none', 'hand', 'drip', 'sprinkler', 'wicking', 'unknown'] as const, true),
      container: c
        ? clean({ volumeL: c.num('volumeL', true, 0, 100000), diameterCm: c.num('diameterCm', true, 0, 10000), depthCm: c.num('depthCm', true, 0, 10000) })
        : undefined,
      outline: r.has('outline') ? r.arr('outline', LATLON, true, 200) : undefined,
      notes: r.str('notes', true, 5000),
      archived: r.bool('archived', true),
      createdAt: r.dateTime('createdAt'),
      updatedAt: r.dateTime('updatedAt'),
    });
  });
}

function parseEvent(v: unknown, p: string): PlantingEvent {
  const r = reader(v, p);
  return clean({
    id: r.id('id'),
    type: r.oneOf('type', EVENT_TYPES),
    date: r.date('date'),
    stage: r.oneOf('stage', STAGES, true),
    note: r.str('note', true, 2000),
  });
}

/** `areaIds`, or the single `areaId` saved by earlier versions. Duplicates are dropped; none → undefined. */
function plantingAreaIds(r: R): string[] | undefined {
  const ids = r.arr('areaIds', STRING(200), true, 50);
  const legacy = r.str('areaId', true, 200);
  const all = [...new Set([...ids, ...(legacy ? [legacy] : [])])];
  return all.length ? all : undefined;
}

export function validatePlanting(v: unknown): Result<Planting> {
  return run(() => {
    const r = reader(v, 'planting');
    const s = r.obj('system', true);
    return clean({
      id: r.id('id'),
      plantId: r.id('plantId'),
      variety: r.str('variety', true, 120),
      quantity: r.num('quantity', false, 0, 100000),
      areaIds: plantingAreaIds(r),
      startMethod: r.oneOf('startMethod', METHODS),
      plantedDate: r.date('plantedDate'),
      dateAccuracy: r.oneOf('dateAccuracy', ['exact', 'approx-week', 'approx-month'] as const),
      stage: r.oneOf('stage', STAGES),
      stageIsManual: r.bool('stageIsManual'),
      events: r.arr('events', parseEvent, true, 2000),
      successionPlanId: r.str('successionPlanId', true, 200),
      system: s ? { planId: s.id('planId'), systemId: s.id('systemId'), role: s.str('role', false, 60) } : undefined,
      notes: r.str('notes', true, 5000),
      photos: r.has('photos') ? r.arr('photos', parsePhoto, true, 500) : undefined,
      createdAt: r.dateTime('createdAt'),
      updatedAt: r.dateTime('updatedAt'),
    });
  });
}

/** Photo file names are generated by the app: letters, digits, _ and - with an image extension. */
const PHOTO_FILE = /^[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp)$/;

function parsePhoto(v: unknown, p: string): PlantingPhoto {
  const r = reader(v, p);
  const file = r.str('file', false, 100);
  if (!PHOTO_FILE.test(file)) throw new ValidationError(`${p}.file: not a valid photo file name`);
  return clean({ id: r.id('id'), file, takenAt: r.dateTime('takenAt'), caption: r.str('caption', true, 500) });
}

export function validateJournal(v: unknown): Result<JournalEntry> {
  return run(() => {
    const r = reader(v, 'journal');
    return clean({
      id: r.id('id'),
      date: r.date('date'),
      text: r.str('text', false, 5000),
      plantingId: r.str('plantingId', true, 200),
      areaId: r.str('areaId', true, 200),
      createdAt: r.dateTime('createdAt'),
    });
  });
}

export function validateWish(v: unknown): Result<WishListItem> {
  return run(() => {
    const r = reader(v, 'wishlist');
    return clean({ id: r.id('id'), plantId: r.id('plantId'), note: r.str('note', true, 1000), addedAt: r.dateTime('addedAt') });
  });
}

function parseBatch(v: unknown, p: string): SuccessionBatch {
  const r = reader(v, p);
  return clean({
    index: r.num('index', false, 0, 1000, true),
    plannedDate: r.date('plannedDate'),
    quantity: r.num('quantity', false, 0, 100000),
    status: r.oneOf('status', ['planned', 'accepted', 'skipped'] as const),
    plantingId: r.str('plantingId', true, 200),
    quantityIsManual: r.bool('quantityIsManual', true),
  });
}

export function validateSuccessionPlan(v: unknown): Result<SuccessionPlan> {
  return run(() => {
    const r = reader(v, 'successionPlan');
    return clean({
      id: r.id('id'),
      plantId: r.id('plantId'),
      areaId: r.str('areaId', true, 200),
      intervalDays: r.num('intervalDays', false, 1, 365, true),
      defaultBatchQuantity: r.num('defaultBatchQuantity', false, 0, 100000),
      status: r.oneOf('status', ['active', 'stopped', 'completed'] as const),
      batches: r.arr('batches', parseBatch, true, 200),
      notes: r.arr('notes', STRING(1000), true, 50),
      createdAt: r.dateTime('createdAt'),
      updatedAt: r.dateTime('updatedAt'),
    });
  });
}

export function validateTaskResponse(v: unknown): Result<TaskResponse> {
  return run(() => {
    const r = reader(v, 'taskResponse');
    return clean({
      taskId: r.id('taskId'),
      status: r.oneOf('status', ['done', 'skipped', 'snoozed', 'irrelevant'] as const),
      until: r.date('until', true),
      at: r.dateTime('at'),
    });
  });
}

export function validateCustomPlant(v: unknown): Result<CustomPlant> {
  return run(() => {
    const r = reader(v, 'customPlant');
    const id = r.id('id');
    if (!/^custom_[A-Za-z0-9_-]{1,100}$/.test(id)) throw new ValidationError('customPlant.id: must start with custom_');
    return clean({
      id,
      commonName: r.str('commonName', false, 80),
      botanicalName: r.str('botanicalName', true, 120),
      familyName: r.str('familyName', true, 80),
      alaGuid: r.str('alaGuid', true, 300),
      categories: r.arr('categories', (c, p) => {
        if (typeof c !== 'string' || !(PLANT_CATEGORIES as readonly string[]).includes(c)) throw new ValidationError(`${p}: unknown category`);
        return c as PlantCategory;
      }, true, 11),
      lifecycle: r.oneOf('lifecycle', LIFECYCLES),
      startMethods: r.arr('startMethods', (m, p) => {
        if (typeof m !== 'string' || !(METHODS as readonly string[]).includes(m)) throw new ValidationError(`${p}: unknown start method`);
        return m as StartMethod;
      }, true, 8),
      plantMonths: r.has('plantMonths')
        ? r.arr('plantMonths', (m, p) => {
            if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > 12) throw new ValidationError(`${p}: must be a month 1–12`);
            return m as Month;
          }, true, 12)
        : undefined,
      sun: r.oneOf('sun', SUN_NEEDS, true),
      frost: r.oneOf('frost', ['tender', 'half-hardy', 'hardy'] as const, true),
      support: r.oneOf('support', SUPPORT_NEEDS, true),
      potOk: r.bool('potOk', true),
      notes: r.str('notes', true, 2000),
      createdAt: r.dateTime('createdAt'),
      updatedAt: r.dateTime('updatedAt'),
    });
  });
}

export function validateObservation(v: unknown): Result<Observation> {
  return run(() => {
    const r = reader(v, 'observation');
    return clean({
      id: r.id('id'),
      kind: r.oneOf('kind', OBS_KINDS),
      value: r.num('value'),
      unit: r.str('unit', false, 20),
      at: r.dateTime('at'),
      source: r.oneOf('source', ['manual', 'sensor', 'weather-service'] as const),
      deviceId: r.str('deviceId', true, 200),
      areaId: r.str('areaId', true, 200),
      plantingId: r.str('plantingId', true, 200),
      note: r.str('note', true, 2000),
    });
  });
}

export { ZONES as ZONE_VALUES };
