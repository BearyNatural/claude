/**
 * Australian climate zones and seasons.
 *
 * Zone definitions follow the five broad zones commonly used by Australian
 * gardening references (see docs/adr/0004-climate-zones.md). We use:
 *   tropical, subtropical, warm-temperate, cool-temperate, arid (incl. semi-arid)
 * Gardening Australia's "Temperate" zone maps to warm-temperate and its "Cool"
 * zone maps to cool-temperate.
 */
import { monthOf } from './dates';
import type { ClimateZoneId, FrostRisk, GardenLocation, ISODate, Month } from './types';

export interface ClimateZoneInfo {
  id: ClimateZoneId;
  name: string;
  shortDescription: string;
  examples: string[];
  typicalFrost: FrostRisk;
}

export const CLIMATE_ZONES: Record<ClimateZoneId, ClimateZoneInfo> = {
  tropical: {
    id: 'tropical',
    name: 'Tropical',
    shortDescription: 'Hot, humid wet season and a warm dry season. Frost does not occur.',
    examples: ['Darwin', 'Cairns', 'Townsville', 'Broome'],
    typicalFrost: 'none',
  },
  subtropical: {
    id: 'subtropical',
    name: 'Subtropical',
    shortDescription: 'Warm, humid summers with reliable summer rain and mild winters. Frost is rare near the coast.',
    examples: ['Brisbane', 'Gold Coast', 'Sunshine Coast', 'Mackay', 'Coffs Harbour'],
    typicalFrost: 'light',
  },
  'warm-temperate': {
    id: 'warm-temperate',
    name: 'Warm temperate',
    shortDescription: 'Four distinct seasons with cool winters. Light frost inland; usually none on the coast.',
    examples: ['Sydney', 'Perth', 'Adelaide', 'Newcastle', 'Toowoomba'],
    typicalFrost: 'light',
  },
  'cool-temperate': {
    id: 'cool-temperate',
    name: 'Cool temperate',
    shortDescription: 'Cold winters with frost (heavy in some areas, snow at altitude) and warm to hot summers.',
    examples: ['Melbourne', 'Canberra', 'Hobart', 'Launceston', 'Ballarat'],
    typicalFrost: 'moderate',
  },
  arid: {
    id: 'arid',
    name: 'Arid / semi-arid',
    shortDescription: 'Very hot, dry summers with high evaporation. Winters range from mild to frosty.',
    examples: ['Alice Springs', 'Mildura', 'Dubbo', 'Wagga Wagga', 'Kalgoorlie'],
    typicalFrost: 'moderate',
  },
};

export const ZONE_IDS: ClimateZoneId[] = ['tropical', 'subtropical', 'warm-temperate', 'cool-temperate', 'arid'];

export function isClimateZone(v: unknown): v is ClimateZoneId {
  return typeof v === 'string' && (ZONE_IDS as string[]).includes(v);
}

/** The zone actually used for advice: the gardener's override wins. */
export function effectiveZone(location: GardenLocation | undefined | null): ClimateZoneId | null {
  if (!location) return null;
  return location.overrideZone ?? location.suggestedZone ?? null;
}

export function effectiveFrostRisk(location: GardenLocation | undefined | null): FrostRisk {
  if (!location) return 'unknown';
  const zone = effectiveZone(location);
  return location.overrideFrostRisk ?? location.suggestedFrostRisk ?? (zone ? CLIMATE_ZONES[zone].typicalFrost : 'unknown');
}

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export type TemperateSeason = 'summer' | 'autumn' | 'winter' | 'spring';
export type TropicalSeason = 'wet' | 'dry';

export interface SeasonInfo {
  /** Southern-Hemisphere meteorological season (always given). */
  season: TemperateSeason;
  /** For the tropics, the wet/dry season which matters more for gardening. */
  tropicalSeason?: TropicalSeason;
  label: string;
}

/**
 * Australian (Southern Hemisphere) meteorological seasons:
 * summer Dec–Feb, autumn Mar–May, winter Jun–Aug, spring Sep–Nov.
 */
export function southernSeason(month: Month): TemperateSeason {
  if (month === 12 || month === 1 || month === 2) return 'summer';
  if (month >= 3 && month <= 5) return 'autumn';
  if (month >= 6 && month <= 8) return 'winter';
  return 'spring';
}

/** Northern Australian wet season is broadly November–April (BoM convention). */
export function tropicalSeason(month: Month): TropicalSeason {
  return month >= 11 || month <= 4 ? 'wet' : 'dry';
}

export function seasonFor(date: ISODate, zone: ClimateZoneId | null): SeasonInfo {
  const m = monthOf(date);
  const season = southernSeason(m);
  const cap = season[0].toUpperCase() + season.slice(1);
  if (zone === 'tropical') {
    const t = tropicalSeason(m);
    return { season, tropicalSeason: t, label: t === 'wet' ? 'Wet season' : 'Dry season' };
  }
  return { season, label: cap };
}
