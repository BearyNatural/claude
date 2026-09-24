/**
 * Small builders that keep the catalogue readable and traceable to sources.
 */
import type { GerminationData, ZoneWindow, ZoneWindows } from '../../domain/plantTypes';
import type { ClimateZoneId, Month } from '../../domain/types';
import { GA_WINDOWS } from '../gaWindows.generated';

const MONTHS: Record<string, Month> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse month specs as written in Australian sowing charts:
 * "Sep-Feb", "Mar-Apr, Aug-Nov", "All year", "Oct". Wraps across the year end.
 */
export function months(spec: string): Month[] {
  const s = spec.trim().toLowerCase();
  if (!s || s === '-' || s === '—') return [];
  if (s === 'all year') return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const out = new Set<Month>();
  for (const part of s.split(',')) {
    const [a, b] = part.split('-').map((x) => MONTHS[x.trim().slice(0, 3)]);
    if (!a) throw new Error(`Bad month spec: ${spec}`);
    if (!b) {
      out.add(a);
      continue;
    }
    let m = a;
    for (let i = 0; i < 12; i++) {
      out.add(m);
      if (m === b) break;
      m = ((m % 12) + 1) as Month;
    }
  }
  return [...out].sort((x, y) => x - y);
}

type Override = Partial<Record<ClimateZoneId, ZoneWindow | null>>;

/**
 * Windows from the Gardening Australia dataset (as sowing/planting months),
 * with optional per-zone overrides (null removes a zone).
 */
export function gaWindows(id: string, kind: 'sow' | 'plant' = 'sow', overrides: Override = {}): ZoneWindows {
  const ga = GA_WINDOWS[id];
  if (!ga) throw new Error(`No Gardening Australia windows for ${id}`);
  const out: ZoneWindows = {};
  for (const [zone, ms] of Object.entries(ga) as [ClimateZoneId, Month[]][]) {
    out[zone] = { [kind]: ms, sourceId: 'ga-vegie-guide' };
  }
  for (const [zone, w] of Object.entries(overrides) as [ClimateZoneId, ZoneWindow | null][]) {
    if (w === null) delete out[zone];
    else out[zone] = w;
  }
  return out;
}

/**
 * Windows from The Seed Collection chart columns (Cool, Temperate,
 * Subtropical, Tropical). No arid column exists in that chart.
 */
export function scWindows(
  cool: string,
  temperate: string,
  subtropical: string,
  tropical: string,
  kind: 'sow' | 'plant' = 'sow',
): ZoneWindows {
  const mk = (spec: string): ZoneWindow | undefined => {
    const ms = months(spec);
    return ms.length ? { [kind]: ms, sourceId: 'seed-collection-chart' } : undefined;
  };
  const out: ZoneWindows = {};
  const pairs: [ClimateZoneId, string][] = [
    ['cool-temperate', cool],
    ['warm-temperate', temperate],
    ['subtropical', subtropical],
    ['tropical', tropical],
  ];
  for (const [z, spec] of pairs) {
    const w = mk(spec);
    if (w) out[z] = w;
  }
  return out;
}

/** Germination soil temperatures from OSU Extension (°F converted to °C). */
const OSU: Record<string, Omit<GerminationData, 'days' | 'sourceIds'>> = {
  asparagus: { soilTempMinC: 10, soilTempOptimumC: [16, 29], soilTempMaxC: 35 },
  bean: { soilTempMinC: 16, soilTempOptimumC: [16, 29], soilTempMaxC: 35 },
  beet: { soilTempMinC: 4, soilTempOptimumC: [10, 29], soilTempMaxC: 35 },
  cabbage: { soilTempMinC: 4, soilTempOptimumC: [7, 29], soilTempMaxC: 38 },
  carrot: { soilTempMinC: 4, soilTempOptimumC: [7, 29], soilTempMaxC: 35 },
  cauliflower: { soilTempMinC: 4, soilTempOptimumC: [7, 29], soilTempMaxC: 38 },
  chard: { soilTempMinC: 4, soilTempOptimumC: [10, 29], soilTempMaxC: 35 },
  corn: { soilTempMinC: 10, soilTempOptimumC: [16, 35], soilTempMaxC: 41 },
  cucumber: { soilTempMinC: 16, soilTempOptimumC: [16, 35], soilTempMaxC: 41 },
  eggplant: { soilTempMinC: 16, soilTempOptimumC: [24, 32], soilTempMaxC: 35 },
  lettuce: { soilTempMinC: 2, soilTempOptimumC: [4, 27], soilTempMaxC: 35 },
  onion: { soilTempMinC: 2, soilTempOptimumC: [10, 35], soilTempMaxC: 35 },
  parsley: { soilTempMinC: 4, soilTempOptimumC: [10, 29], soilTempMaxC: 32 },
  pea: { soilTempMinC: 4, soilTempOptimumC: [4, 24], soilTempMaxC: 29 },
  pepper: { soilTempMinC: 16, soilTempOptimumC: [18, 35], soilTempMaxC: 35 },
  pumpkin: { soilTempMinC: 16, soilTempOptimumC: [21, 32], soilTempMaxC: 38 },
  radish: { soilTempMinC: 4, soilTempOptimumC: [7, 32], soilTempMaxC: 35 },
  spinach: { soilTempMinC: 2, soilTempOptimumC: [7, 24], soilTempMaxC: 29 },
  squash: { soilTempMinC: 16, soilTempOptimumC: [21, 35], soilTempMaxC: 38 },
  tomato: { soilTempMinC: 10, soilTempOptimumC: [16, 29], soilTempMaxC: 35 },
};

export function germination(osuKey: keyof typeof OSU | null, days?: [number, number]): GerminationData {
  const base = osuKey ? OSU[osuKey] : {};
  const sourceIds: string[] = [];
  if (osuKey) sourceIds.push('osu-soil-temp');
  if (days) sourceIds.push('seed-collection-chart');
  return { ...base, days, sourceIds };
}

export const TODAY_REVIEW = '2026-09-24';
