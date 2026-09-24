/**
 * Australian location logic: postcode → state, state → timezone,
 * offline locality search, coordinate rounding and climate-zone inference.
 *
 * Precise GPS is never required. When coordinates are stored they are rounded
 * to 2 decimal places (roughly 1 km), which is plenty for weather and climate
 * but does not pinpoint a home.
 */
import { CLIMATE_ZONES } from './climate';
import type { AustralianState, ClimateZoneId, FrostRisk, GardenLocation } from './types';

export interface Locality {
  name: string;
  postcode: string;
  state: AustralianState;
  lat: number;
  lon: number;
  zone: ClimateZoneId;
  frost: FrostRisk;
  /** True where a cited gardening reference names this town as an example of the zone. */
  zoneFromReference?: boolean;
}

export const STATES: { id: AustralianState; name: string }[] = [
  { id: 'ACT', name: 'Australian Capital Territory' },
  { id: 'NSW', name: 'New South Wales' },
  { id: 'NT', name: 'Northern Territory' },
  { id: 'QLD', name: 'Queensland' },
  { id: 'SA', name: 'South Australia' },
  { id: 'TAS', name: 'Tasmania' },
  { id: 'VIC', name: 'Victoria' },
  { id: 'WA', name: 'Western Australia' },
];

export function isAustralianState(v: unknown): v is AustralianState {
  return typeof v === 'string' && STATES.some((s) => s.id === v);
}

/** Normalise user input to a 4-digit postcode string, or null. */
export function normalisePostcode(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 3) return `0${digits}`; // NT postcodes are often written without the leading 0
  if (digits.length === 4) return digits;
  return null;
}

/**
 * Australia Post postcode ranges (geographic delivery postcodes plus PO box ranges).
 * Returns null for numbers outside any Australian range.
 */
export function stateForPostcode(postcode: string): AustralianState | null {
  const pc = normalisePostcode(postcode);
  if (!pc) return null;
  const n = Number(pc);
  if ((n >= 200 && n <= 299) || (n >= 2600 && n <= 2618) || (n >= 2900 && n <= 2920)) return 'ACT';
  if (n >= 800 && n <= 999) return 'NT';
  if ((n >= 1000 && n <= 2599) || (n >= 2619 && n <= 2899) || (n >= 2921 && n <= 2999)) return 'NSW';
  if ((n >= 3000 && n <= 3999) || (n >= 8000 && n <= 8999)) return 'VIC';
  if ((n >= 4000 && n <= 4999) || (n >= 9000 && n <= 9999)) return 'QLD';
  if (n >= 5000 && n <= 5999) return 'SA';
  if (n >= 6000 && n <= 6999) return 'WA';
  if (n >= 7000 && n <= 7999) return 'TAS';
  return null;
}

/**
 * IANA timezone for a state. Broken Hill (2880) keeps South Australian time.
 * Queensland has no daylight saving; its timezone reflects that.
 */
export function timezoneFor(state: AustralianState, postcode?: string): string {
  if (postcode && normalisePostcode(postcode) === '2880') return 'Australia/Broken_Hill';
  switch (state) {
    case 'QLD':
      return 'Australia/Brisbane';
    case 'NSW':
    case 'ACT':
      return 'Australia/Sydney';
    case 'VIC':
      return 'Australia/Melbourne';
    case 'TAS':
      return 'Australia/Hobart';
    case 'SA':
      return 'Australia/Adelaide';
    case 'WA':
      return 'Australia/Perth';
    case 'NT':
      return 'Australia/Darwin';
  }
}

export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Offline search by suburb/town name or postcode. */
export function searchLocalities(localities: readonly Locality[], query: string, limit = 12): Locality[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const pc = normalisePostcode(q);
  const scored: { l: Locality; score: number }[] = [];
  for (const l of localities) {
    const name = l.name.toLowerCase();
    let score = 0;
    if (pc && /^\d+$/.test(q.replace(/\s/g, ''))) {
      if (l.postcode === pc) score = 100;
      else if (l.postcode.startsWith(q)) score = 60;
    } else if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 50;
    if (score > 0) scored.push({ l, score });
  }
  scored.sort((a, b) => b.score - a.score || a.l.name.localeCompare(b.l.name));
  return scored.slice(0, limit).map((s) => s.l);
}

export type InferenceConfidence = 'high' | 'medium' | 'low';

export interface ClimateInference {
  zone: ClimateZoneId;
  frost: FrostRisk;
  confidence: InferenceConfidence;
  reason: string;
  nearest?: Locality;
  distanceKm?: number;
}

const FROST_ORDER: FrostRisk[] = ['none', 'light', 'moderate', 'heavy'];

function bumpFrost(f: FrostRisk, steps: number): FrostRisk {
  const i = FROST_ORDER.indexOf(f);
  if (i < 0) return f;
  return FROST_ORDER[Math.min(FROST_ORDER.length - 1, i + steps)];
}

/**
 * Suggest a climate zone from approximate coordinates by finding the nearest
 * reference locality. Elevation (when known, e.g. from a geocoder) raises the
 * frost estimate and adds a note, because inland/high sites are colder than
 * the nearest reference town may suggest.
 */
export function inferClimateFromCoordinates(
  localities: readonly Locality[],
  lat: number,
  lon: number,
  elevationM?: number,
  state?: AustralianState,
): ClimateInference | null {
  const pool = state ? localities.filter((l) => l.state === state) : localities;
  const candidates = pool.length > 0 ? pool : localities;
  let best: Locality | undefined;
  let bestD = Infinity;
  for (const l of candidates) {
    const d = haversineKm(lat, lon, l.lat, l.lon);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  if (!best) return null;
  const km = Math.round(bestD);
  const confidence: InferenceConfidence = bestD <= 30 ? 'high' : bestD <= 120 ? 'medium' : 'low';
  let frost = best.frost;
  let reason = `Nearest reference town is ${best.name} (${km} km away), which is usually classed as ${CLIMATE_ZONES[best.zone].name.toLowerCase()}.`;
  if (elevationM !== undefined && elevationM >= 600 && best.zone !== 'cool-temperate') {
    frost = bumpFrost(frost, 1);
    reason += ` Your area is about ${Math.round(elevationM)} m above sea level, so it may be cooler and frostier than the zone suggests — consider "cool temperate" if you get regular frosts.`;
  }
  if (confidence === 'low') reason += ' This is a rough guess — please check it.';
  return { zone: best.zone, frost, confidence, reason, nearest: best, distanceKm: km };
}

/**
 * Suggest a zone from a postcode alone (offline): exact match first, otherwise
 * the numerically-closest reference postcode in the same state. Postcodes are
 * only loosely geographic, so this is always "low" confidence.
 */
export function inferClimateFromPostcode(localities: readonly Locality[], postcode: string): ClimateInference | null {
  const pc = normalisePostcode(postcode);
  if (!pc) return null;
  const exact = localities.find((l) => l.postcode === pc);
  if (exact) {
    return {
      zone: exact.zone,
      frost: exact.frost,
      confidence: 'high',
      reason: `${exact.name} (${pc}) is usually classed as ${CLIMATE_ZONES[exact.zone].name.toLowerCase()}.`,
      nearest: exact,
      distanceKm: 0,
    };
  }
  const state = stateForPostcode(pc);
  if (!state) return null;
  const n = Number(pc);
  let best: Locality | undefined;
  let bestGap = Infinity;
  for (const l of localities) {
    if (l.state !== state) continue;
    const gap = Math.abs(Number(l.postcode) - n);
    if (gap < bestGap) {
      bestGap = gap;
      best = l;
    }
  }
  if (!best) return null;
  return {
    zone: best.zone,
    frost: best.frost,
    confidence: 'low',
    reason: `We couldn't find ${pc} in the offline list, so this guess is based on a nearby postcode (${best.name}). Please check it — or search for your suburb while online.`,
    nearest: best,
  };
}

/** Build a GardenLocation from an offline locality match. */
export function locationFromLocality(l: Locality): GardenLocation {
  return {
    postcode: l.postcode,
    suburb: l.name,
    state: l.state,
    timezone: timezoneFor(l.state, l.postcode),
    approxLatitude: roundCoordinate(l.lat),
    approxLongitude: roundCoordinate(l.lon),
    suggestedZone: l.zone,
    suggestedZoneReason: `${l.name} is usually classed as ${CLIMATE_ZONES[l.zone].name.toLowerCase()}.`,
    suggestedFrostRisk: l.frost,
    source: 'offline-list',
  };
}

export function describeLocation(loc: GardenLocation | undefined | null): string {
  if (!loc) return 'Location not set';
  const parts = [loc.suburb, loc.state, loc.postcode].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Location set manually';
}
