/**
 * Optional name lookup for plants the gardener adds, using the Atlas of Living
 * Australia species search (free, no account). Returns names and families
 * only — ALA has no growing advice. Only the typed name is sent, and only when
 * the gardener presses "Look up".
 */
import type { FetchLike } from '../weather/openMeteo';

export interface AlaName {
  scientificName: string;
  commonName?: string;
  family?: string;
  rank?: string;
  guid?: string;
}

export function buildAlaSearchUrl(query: string): string {
  const params = new URLSearchParams({ q: query.trim(), pageSize: '20', fq: 'idxtype:TAXON' });
  return `https://api.ala.org.au/species/search?${params.toString()}`;
}

/** Accepted plant names only (the search also returns animals, fungi and synonyms). */
export function parseAlaResults(json: unknown): AlaName[] {
  const results = (json as { searchResults?: { results?: unknown[] } } | null)?.searchResults?.results;
  if (!Array.isArray(results)) return [];
  const out: AlaName[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const s = (k: string) => (typeof o[k] === 'string' && o[k] ? (o[k] as string).slice(0, 200) : undefined);
    const kingdom = s('kingdom')?.toLowerCase();
    if (kingdom !== 'plantae') continue;
    if (s('taxonomicStatus') && s('taxonomicStatus') !== 'accepted') continue;
    const scientificName = s('scientificName');
    if (!scientificName || seen.has(scientificName)) continue;
    seen.add(scientificName);
    out.push({ scientificName, commonName: s('commonNameSingle'), family: s('family'), rank: s('rank'), guid: s('guid') });
  }
  return out.slice(0, 8);
}

export async function searchAlaNames(query: string, fetchImpl: FetchLike): Promise<AlaName[]> {
  if (query.trim().length < 3) return [];
  const res = await fetchImpl(buildAlaSearchUrl(query));
  if (!res.ok) throw new Error(`Name lookup failed (${res.status})`);
  return parseAlaResults(await res.json());
}
