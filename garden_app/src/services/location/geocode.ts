/**
 * Location lookup: offline reference list first, optional online search via
 * the Open-Meteo geocoding API (Australian results only). Online results are
 * converted to rounded coordinates; no device GPS is used.
 */
import { LOCALITIES } from '../../data/localities';
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

export function offlineCandidates(query: string): LocationCandidate[] {
  return searchLocalities(LOCALITIES, query).map((l) => ({
    key: `off-${l.postcode}-${l.name}`,
    label: l.name,
    sublabel: `${l.state} ${l.postcode}`,
    source: 'offline-list' as const,
    location: locationFromLocality(l),
  }));
}

export async function onlineCandidates(query: string, fetchImpl: FetchLike): Promise<LocationCandidate[]> {
  const q = query.trim();
  if (q.length < 3) return [];
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
