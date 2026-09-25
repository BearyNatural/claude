/**
 * Optional street-address search for the garden map, using OpenStreetMap's
 * Nominatim service (free, no account; data © OpenStreetMap contributors, ODbL).
 * Only the typed search text is sent, and only when the gardener presses Search.
 * Usage policy: occasional single searches with an identifying User-Agent —
 * https://operations.osmfoundation.org/policies/nominatim/
 */

export interface AddressResult {
  label: string;
  lat: number;
  lon: number;
}

export type HeaderFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const ADDRESS_SEARCH_ATTRIBUTION = 'Address search © OpenStreetMap contributors (Nominatim)';

export function buildAddressSearchUrl(query: string): string {
  const params = new URLSearchParams({ q: query.trim(), countrycodes: 'au', format: 'jsonv2', limit: '5' });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

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
    out.push({ label, lat, lon });
  }
  return out;
}

export async function searchAddress(query: string, fetchImpl: HeaderFetch): Promise<AddressResult[]> {
  if (query.trim().length < 4) return [];
  const res = await fetchImpl(buildAddressSearchUrl(query), { headers: { 'User-Agent': 'SowBySeason (personal garden planning app)', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Address search failed (${res.status})`);
  return parseAddressResults(await res.json());
}
