/**
 * Optional street-address search for the garden map (free, no account; data
 * © OpenStreetMap contributors, ODbL). Only the typed search text is sent, and
 * only when the gardener presses Find address.
 *
 * Photon (photon.komoot.io) is tried first: Nominatim rejects requests from
 * Android's built-in HTTP client, whose User-Agent the app can't change.
 * Nominatim is the fallback (fine on the web and iOS). Both are used for
 * occasional single searches only.
 * House numbers aren't mapped everywhere in Australia, so a result may only
 * be the street — `exact` says which.
 */

export interface AddressResult {
  label: string;
  lat: number;
  lon: number;
  /** True when the result is the house/building itself rather than just the street or suburb. */
  exact: boolean;
}

export type HeaderFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const ADDRESS_SEARCH_ATTRIBUTION = 'Address search © OpenStreetMap contributors (Photon by Komoot, Nominatim)';

const HEADERS = { 'User-Agent': 'SowBySeason (personal garden planning app)', Accept: 'application/json' };
/** Roughly mainland Australia and Tasmania: west, south, east, north. */
const AU_BBOX = '112,-44,154,-10';

export function buildPhotonUrl(query: string, near?: { lat: number; lon: number }): string {
  const params = new URLSearchParams({ q: query.trim(), limit: '6', lang: 'en', bbox: AU_BBOX });
  if (near) {
    params.set('lat', near.lat.toFixed(2));
    params.set('lon', near.lon.toFixed(2));
  }
  return `https://photon.komoot.io/api/?${params.toString()}`;
}

export function buildAddressSearchUrl(query: string): string {
  const params = new URLSearchParams({ q: query.trim(), countrycodes: 'au', format: 'jsonv2', limit: '5' });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

/** Photon GeoJSON → results (Australian ones only). */
export function parsePhotonResults(json: unknown): AddressResult[] {
  const features = (json as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: AddressResult[] = [];
  for (const f of features) {
    const props = (f as { properties?: Record<string, unknown> })?.properties ?? {};
    const coords = (f as { geometry?: { coordinates?: unknown[] } })?.geometry?.coordinates;
    if (!Array.isArray(coords)) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (props.countrycode && props.countrycode !== 'AU') continue;
    const str = (k: string) => (typeof props[k] === 'string' && props[k] ? (props[k] as string) : undefined);
    const house = str('housenumber');
    const street = str('street');
    const name = str('name');
    const first = house && street ? `${house} ${street}` : name && street && name !== street ? `${name}, ${street}` : name ?? street;
    const locality = str('district') ?? str('locality') ?? str('city');
    const label = [first, locality, [str('state'), str('postcode')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (!label) continue;
    out.push({ label, lat, lon, exact: !!house });
  }
  return out;
}

/** Nominatim JSON → results. */
export function parseAddressResults(json: unknown): AddressResult[] {
  if (!Array.isArray(json)) return [];
  const out: AddressResult[] = [];
  for (const r of json) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const lat = Number(o.lat);
    const lon = Number(o.lon);
    const label = typeof o.display_name === 'string' ? o.display_name.replace(/, Australia$/, '') : '';
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ label, lat, lon, exact: ['house', 'building'].includes(String(o.addresstype ?? '')) });
  }
  return out;
}

/**
 * Try Photon, then Nominatim. Throws only when neither could be reached, so
 * "nothing found" and "offline" can be told apart.
 */
export async function searchAddress(query: string, fetchImpl: HeaderFetch, near?: { lat: number; lon: number }): Promise<AddressResult[]> {
  if (query.trim().length < 4) return [];
  let reached = false;
  try {
    const res = await fetchImpl(buildPhotonUrl(query, near), { headers: HEADERS });
    if (res.ok) {
      reached = true;
      const r = parsePhotonResults(await res.json());
      if (r.length) return r;
    }
  } catch {
    // try Nominatim
  }
  try {
    const res = await fetchImpl(buildAddressSearchUrl(query), { headers: HEADERS });
    if (res.ok) return parseAddressResults(await res.json());
  } catch {
    // reported below
  }
  if (reached) return [];
  throw new Error('Address search is unavailable');
}
