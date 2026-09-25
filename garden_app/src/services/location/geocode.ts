/**
 * Location lookup: offline reference list first, optional online search via
 * the Open-Meteo geocoding API (Australian results only). Online results are
 * converted to rounded coordinates; no device GPS is used.
 */
import { LOCALITIES } from '../../data/localities';
import { postcodePlaces } from '../../data/postcodes';
import { postcodeCentre, searchPostcodePlaces, type PostcodePlace } from '../../domain/postcodes';
import {
  inferClimateFromCoordinates,
  locationFromLocality,
  normalisePostcode,
  roundCoordinate,
  searchLocalities,
  stateForPostcode,
  timezoneFor,
} from '../../domain/location';
import type { AustralianState, GardenLocation } from '../../domain/types';
import type { FetchLike } from '../weather/openMeteo';

export interface LocationCandidate {
  key: string;
  label: string;
  sublabel: string;
  source: 'offline-list' | 'online-geocoder';
  location: GardenLocation;
}

const STATE_NAMES: Record<string, AustralianState> = {
  'australian capital territory': 'ACT',
  'new south wales': 'NSW',
  'northern territory': 'NT',
  queensland: 'QLD',
  'south australia': 'SA',
  tasmania: 'TAS',
  victoria: 'VIC',
  'western australia': 'WA',
};

/** A suburb from the full postcode table, with its climate inferred from the nearest reference town. */
export function locationFromPostcodePlace(p: PostcodePlace): GardenLocation {
  const inf = inferClimateFromCoordinates(LOCALITIES, p.lat, p.lon, undefined, p.state);
  return {
    suburb: p.name,
    state: p.state,
    postcode: p.postcode,
    timezone: timezoneFor(p.state, p.postcode),
    approxLatitude: roundCoordinate(p.lat),
    approxLongitude: roundCoordinate(p.lon),
    suggestedZone: inf?.zone,
    suggestedZoneReason: inf?.reason,
    suggestedFrostRisk: inf?.frost,
    source: 'offline-list',
  };
}

/**
 * Offline search: the curated reference towns first (their climate zones are
 * checked against gardening references), then every other suburb/postcode.
 */
export function offlineCandidates(query: string, limit = 12): LocationCandidate[] {
  const ref = searchLocalities(LOCALITIES, query).map((l) => ({
    key: `off-${l.postcode}-${l.name}`,
    label: l.name,
    sublabel: `${l.state} ${l.postcode}`,
    source: 'offline-list' as const,
    location: locationFromLocality(l),
  }));
  const seen = new Set(ref.map((c) => `${c.label.toLowerCase()}|${c.location.postcode}`));
  const more = searchPostcodePlaces(postcodePlaces(), query, limit)
    .filter((p) => !seen.has(`${p.name.toLowerCase()}|${p.postcode}`))
    .map((p) => ({
      key: `pc-${p.postcode}-${p.name}`,
      label: p.name,
      sublabel: `${p.state} ${p.postcode}`,
      source: 'offline-list' as const,
      location: locationFromPostcodePlace(p),
    }));
  // A full postcode lists its own suburbs ahead of reference towns with nearby postcodes.
  const pc = /^\d{3,4}$/.test(query.trim()) ? normalisePostcode(query) : null;
  const exact = pc ? [...ref, ...more].filter((c) => c.location.postcode === pc) : [];
  const rest = [...ref, ...more].filter((c) => !exact.includes(c));
  return [...exact, ...rest].slice(0, limit);
}

/** Approximate coordinates for a postcode, for locations saved without them (e.g. set manually). */
export function coordinatesForPostcode(postcode: string | undefined): { lat: number; lon: number } | null {
  if (!postcode) return null;
  const c = postcodeCentre(postcodePlaces(), postcode);
  return c ? { lat: c.lat, lon: c.lon } : null;
}

export async function onlineCandidates(query: string, fetchImpl: FetchLike): Promise<LocationCandidate[]> {
  const q = query.trim();
  // Open-Meteo searches place names only; postcodes are covered by the offline table.
  if (q.length < 3 || /^\d+$/.test(q)) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=en&countryCode=AU&format=json`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Location search failed (${res.status})`);
  const json = (await res.json()) as { results?: Record<string, unknown>[] };
  const out: LocationCandidate[] = [];
  for (const r of json.results ?? []) {
    const lat = typeof r.latitude === 'number' ? r.latitude : NaN;
    const lon = typeof r.longitude === 'number' ? r.longitude : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = String(r.name ?? '');
    const state = STATE_NAMES[String(r.admin1 ?? '').toLowerCase()];
    const postcodes = Array.isArray(r.postcodes) ? (r.postcodes as unknown[]).map(String) : [];
    const pcFromQuery = normalisePostcode(q);
    const postcode = pcFromQuery && postcodes.includes(pcFromQuery) ? pcFromQuery : postcodes[0];
    const st = state ?? (postcode ? stateForPostcode(postcode) ?? undefined : undefined);
    const elevation = typeof r.elevation === 'number' ? r.elevation : undefined;
    const inf = inferClimateFromCoordinates(LOCALITIES, lat, lon, elevation, st);
    const tz = typeof r.timezone === 'string' && r.timezone.startsWith('Australia/') ? r.timezone : st ? timezoneFor(st, postcode) : 'Australia/Sydney';
    out.push({
      key: `on-${r.id ?? `${name}-${lat}`}`,
      label: name,
      sublabel: [st, postcode].filter(Boolean).join(' '),
      source: 'online-geocoder',
      location: {
        suburb: name,
        state: st,
        postcode,
        timezone: tz,
        approxLatitude: roundCoordinate(lat),
        approxLongitude: roundCoordinate(lon),
        suggestedZone: inf?.zone,
        suggestedZoneReason: inf?.reason,
        suggestedFrostRisk: inf?.frost,
        source: 'online-geocoder',
      },
    });
  }
  return out;
}
