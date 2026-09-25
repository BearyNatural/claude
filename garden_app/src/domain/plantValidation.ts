/**
 * Strict structural validation of plant records and sources that arrive from
 * outside the app build (downloaded plant list updates). Everything is treated
 * as untrusted: unknown fields are dropped, text is length-limited, numbers are
 * range-checked, and a record that fails is skipped rather than half-used.
 * The bundled catalogue passes this too (checked in tests).
 */
import { ZONE_IDS } from './climate';
import {
  LIFECYCLES,
  PLANT_CATEGORIES,
  PLANT_FAMILIES,
  PRODUCTION_STYLES,
  REVIEW_STATUSES,
  SOURCE_KINDS,
  SUN_NEEDS,
  SUPPORT_NEEDS,
  WATER_NEEDS,
  type PlantRecord,
  type SourceRef,
  type ZoneWindow,
  type ZoneWindows,
} from './plantTypes';
import type { ClimateZoneId, Month, Range } from './types';
import { clean, METHODS, reader, run, STRING, ValidationError, type R, type Result } from './validation';

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

function month(v: unknown, p: string): Month {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 12) throw new ValidationError(`${p}: must be a month 1–12`);
  return v as Month;
}

function range(r: R, k: string, min = 0, max = 1_000_000): Range | undefined {
  if (!r.has(k)) return undefined;
  const [a, b] = r.arr(k, (v, p) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ValidationError(`${p}: out of range`);
    return v;
  }, false, 2);
  if (a === undefined || b === undefined || a > b) throw new ValidationError(`${r.at(k)}: must be [low, high]`);
  return [a, b];
}

function sourceId(v: unknown, p: string): string {
  if (typeof v !== 'string' || !SOURCE_ID.test(v)) throw new ValidationError(`${p}: invalid source id`);
  return v;
}

const sourceIds = (r: R, k = 'sourceIds') => r.arr(k, sourceId, false, 20);

function zoneMonths(r: R, k: string): Partial<Record<ClimateZoneId, Month[]>> | undefined {
  const o = r.obj(k, true);
  if (!o) return undefined;
  const out: Partial<Record<ClimateZoneId, Month[]>> = {};
  for (const [zone] of o.entries()) {
    if (!ZONE_IDS.includes(zone as ClimateZoneId)) throw new ValidationError(`${o.at(zone)}: unknown climate zone`);
    out[zone as ClimateZoneId] = o.arr(zone, month, false, 12);
  }
  return out;
}

function windows(r: R): ZoneWindows {
  const o = r.obj('windows')!;
  const out: ZoneWindows = {};
  for (const [zone] of o.entries()) {
    if (!ZONE_IDS.includes(zone as ClimateZoneId)) throw new ValidationError(`${o.at(zone)}: unknown climate zone`);
    const w = o.obj(zone)!;
    const zw: ZoneWindow = clean({
      sow: w.has('sow') ? w.arr('sow', month, false, 12) : undefined,
      plant: w.has('plant') ? w.arr('plant', month, false, 12) : undefined,
      sourceId: sourceId(w.str('sourceId', false, 80), w.at('sourceId')),
      note: w.str('note', true, 500),
    });
    out[zone as ClimateZoneId] = zw;
  }
  return out;
}

export function validatePlantRecord(v: unknown): Result<PlantRecord> {
  return run(() => {
    const r = reader(v, 'plant');
    const id = r.str('id', false, 80);
    if (!ID.test(id) || id.startsWith('custom')) throw new ValidationError('plant.id: invalid');
    const germ = r.obj('germination', true);
    const timing = r.obj('timing', true);
    const climate = r.obj('climate')!;
    const site = r.obj('site')!;
    const feeding = r.obj('feeding', true);
    const spacing = r.obj('spacing', true);
    const container = r.obj('container')!;
    const care = r.obj('care', true);
    const prod = r.obj('production')!;
    const review = r.obj('review')!;
    const rawSuitable = container.entries().find(([k]) => k === 'suitable')?.[1];
    if (rawSuitable !== true && rawSuitable !== false && rawSuitable !== 'unknown') throw new ValidationError('plant.container.suitable: must be true, false or "unknown"');
    const record: PlantRecord = clean({
      id,
      commonName: r.str('commonName', false, 80),
      botanicalName: r.str('botanicalName', true, 120),
      family: r.oneOf('family', PLANT_FAMILIES, true),
      familyName: r.str('familyName', true, 80),
      aliases: r.arr('aliases', STRING(80), true, 30),
      cultivars: r.has('cultivars')
        ? r.arr('cultivars', (c, p) => {
            const cr = reader(c, p);
            return clean({ name: cr.str('name', false, 120), notes: cr.str('notes', true, 500) });
          }, true, 40)
        : undefined,
      categories: r.arr('categories', (c, p) => {
        if (typeof c !== 'string' || !(PLANT_CATEGORIES as readonly string[]).includes(c)) throw new ValidationError(`${p}: unknown category`);
        return c as PlantRecord['categories'][number];
      }, false, 11),
      lifecycle: r.oneOf('lifecycle', LIFECYCLES),
      summary: r.str('summary', false, 2000),
      startMethods: r.arr('startMethods', (m, p) => {
        if (typeof m !== 'string' || !(METHODS as readonly string[]).includes(m)) throw new ValidationError(`${p}: unknown start method`);
        return m as PlantRecord['startMethods'][number];
      }, false, 8),
      windows: windows(r),
      germination: germ
        ? clean({
            soilTempMinC: germ.num('soilTempMinC', true, -10, 50),
            soilTempOptimumC: range(germ, 'soilTempOptimumC', -10, 50),
            soilTempMaxC: germ.num('soilTempMaxC', true, -10, 60),
            days: range(germ, 'days', 0, 365),
            sourceIds: sourceIds(germ),
          })
        : undefined,
      timing: timing
        ? clean({
            basis: timing.oneOf('basis', ['sowing', 'transplant'] as const, true),
            daysToTransplant: range(timing, 'daysToTransplant', 0, 730),
            daysToMaturity: range(timing, 'daysToMaturity', 0, 3650),
            daysToFlower: range(timing, 'daysToFlower', 0, 3650),
            yearsToFirstCrop: range(timing, 'yearsToFirstCrop', 0, 50),
            floweringMonths: zoneMonths(timing, 'floweringMonths'),
            harvestMonths: zoneMonths(timing, 'harvestMonths'),
            sourceIds: sourceIds(timing),
          })
        : undefined,
      climate: clean({
        frost: climate.oneOf('frost', ['tender', 'half-hardy', 'hardy', 'unknown'] as const),
        heat: climate.oneOf('heat', ['low', 'moderate', 'high', 'unknown'] as const),
        boltsInHeat: climate.bool('boltsInHeat', true),
        boltRiskAboveC: climate.num('boltRiskAboveC', true, 0, 60),
        suitableZones: climate.has('suitableZones')
          ? climate.arr('suitableZones', (z, p) => {
              if (typeof z !== 'string' || !ZONE_IDS.includes(z as ClimateZoneId)) throw new ValidationError(`${p}: unknown zone`);
              return z as ClimateZoneId;
            }, true, 5)
          : undefined,
        sourceIds: sourceIds(climate),
      }),
      site: clean({
        sun: site.oneOf('sun', SUN_NEEDS),
        minSunHours: site.num('minSunHours', true, 0, 24),
        water: site.oneOf('water', WATER_NEEDS),
        soilPh: range(site, 'soilPh', 0, 14),
        soilNotes: site.str('soilNotes', true, 1000),
        drainage: site.oneOf('drainage', ['free-draining', 'moisture-retentive', 'tolerates-wet'] as const, true),
        sourceIds: sourceIds(site),
      }),
      feeding: feeding
        ? clean({
            level: feeding.oneOf('level', ['light', 'moderate', 'heavy'] as const),
            intervalDays: feeding.num('intervalDays', true, 1, 365),
            notes: feeding.str('notes', true, 1000),
            sourceIds: sourceIds(feeding),
          })
        : undefined,
      amendments: r.has('amendments')
        ? r.arr('amendments', (a, p) => {
            const ar = reader(a, p);
            return { kind: ar.oneOf('kind', ['add', 'avoid'] as const), advice: ar.str('advice', false, 500), reason: ar.str('reason', false, 500) };
          }, true, 20)
        : undefined,
      spacing: spacing
        ? clean({
            plantCm: range(spacing, 'plantCm', 0, 5000),
            rowCm: range(spacing, 'rowCm', 0, 5000),
            matureWidthCm: range(spacing, 'matureWidthCm', 0, 10000),
            matureHeightCm: range(spacing, 'matureHeightCm', 0, 10000),
            rootDepthCm: range(spacing, 'rootDepthCm', 0, 1000),
            sowingDepthMm: range(spacing, 'sowingDepthMm', 0, 500),
            sourceIds: sourceIds(spacing),
          })
        : undefined,
      support: r.oneOf('support', SUPPORT_NEEDS),
      container: clean({
        suitable: rawSuitable,
        minVolumeL: container.num('minVolumeL', true, 0, 10000),
        notes: container.str('notes', true, 500),
      }),
      care: care ? clean({ thin: care.bool('thin', true), mulch: care.bool('mulch', true), hill: care.bool('hill', true) }) : undefined,
      pruning: r.str('pruning', true, 1000),
      problems: r.has('problems') ? r.arr('problems', STRING(200), true, 30) : undefined,
      production: clean({
        style: prod.oneOf('style', PRODUCTION_STYLES),
        plantsPerPerson: range(prod, 'plantsPerPerson', 0, 1000),
        householdBase: range(prod, 'householdBase', 0, 1000),
        maxPlantsPerHousehold: prod.num('maxPlantsPerHousehold', true, 0, 10000),
        successionIntervalDays: range(prod, 'successionIntervalDays', 0, 365),
        harvestWindowDays: range(prod, 'harvestWindowDays', 0, 3650),
        maintenance: prod.oneOf('maintenance', ['low', 'medium', 'high'] as const),
        unit: prod.str('unit', true, 40),
        sourceId: sourceId(prod.str('sourceId', false, 80), prod.at('sourceId')),
      }),
      tags: r.arr('tags', STRING(40), true, 30),
      review: clean({
        status: review.oneOf('status', REVIEW_STATUSES),
        reviewedOn: review.date('reviewedOn'),
        notes: review.str('notes', true, 1000),
      }),
    });
    return record;
  });
}

export function validateSourceRef(v: unknown): Result<SourceRef> {
  return run(() => {
    const r = reader(v, 'source');
    const url = r.str('url', true, 500);
    if (url !== undefined && !/^https:\/\/[^\s]+$/.test(url)) throw new ValidationError('source.url: must be an https link');
    return clean({
      id: sourceId(r.str('id', false, 80), 'source.id'),
      title: r.str('title', false, 200),
      publisher: r.str('publisher', false, 200),
      url,
      accessed: r.date('accessed'),
      kind: r.oneOf('kind', SOURCE_KINDS),
      notes: r.str('notes', true, 2000),
    });
  });
}
