/**
 * Offline Australian postcode/suburb lookup over the compact GeoNames table
 * (src/data/postcodes.generated.ts). Pure functions: the data string is passed
 * in so tests can use a small fixture.
 */
import { isAustralianState, normalisePostcode, roundCoordinate } from './location';
import type { AustralianState } from './types';

export interface PostcodePlace {
  name: string;
  postcode: string;
  state: AustralianState;
  lat: number;
  lon: number;
}

/** Parse "<postcode>|<state>|<name>:<lat×100>:<lon×100>;…" lines. Malformed lines are skipped. */
export function parsePostcodeData(data: string): PostcodePlace[] {
  const out: PostcodePlace[] = [];
  for (const line of data.split('\n')) {
    const [postcode, state, rest] = line.split('|');
    if (!postcode || !/^\d{4}$/.test(postcode) || !isAustralianState(state) || !rest) continue;
    for (const item of rest.split(';')) {
      const [name, la, lo] = item.split(':');
      const lat = Number(la) / 100;
      const lon = Number(lo) / 100;
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      out.push({ name, postcode, state, lat, lon });
    }
  }
  return out;
}

/**
 * Search by postcode (every place in it; a partial postcode matches by prefix)
 * or by suburb name (exact, then starts-with, then contains).
 */
export function searchPostcodePlaces(places: readonly PostcodePlace[], query: string, limit = 12): PostcodePlace[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const digits = q.replace(/\s/g, '');
  const scored: { p: PostcodePlace; score: number }[] = [];
  if (/^\d+$/.test(digits)) {
    const pc = normalisePostcode(digits);
    if (digits.length < 3) return [];
    for (const p of places) {
      if (pc && p.postcode === pc) scored.push({ p, score: 100 });
      else if (p.postcode.startsWith(digits)) scored.push({ p, score: 60 });
    }
  } else {
    if (q.length < 2) return [];
    for (const p of places) {
      const name = p.name.toLowerCase();
      const score = name === q ? 100 : name.startsWith(q) ? 80 : name.includes(q) ? 50 : 0;
      if (score) scored.push({ p, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name) || a.p.postcode.localeCompare(b.p.postcode));
  return scored.slice(0, limit).map((s) => s.p);
}

/** Approximate centre of a postcode (mean of its places), rounded like all stored coordinates. */
export function postcodeCentre(places: readonly PostcodePlace[], postcode: string): { lat: number; lon: number; state: AustralianState } | null {
  const pc = normalisePostcode(postcode);
  if (!pc) return null;
  const inPc = places.filter((p) => p.postcode === pc);
  if (!inPc.length) return null;
  const lat = inPc.reduce((s, p) => s + p.lat, 0) / inPc.length;
  const lon = inPc.reduce((s, p) => s + p.lon, 0) / inPc.length;
  return { lat: roundCoordinate(lat), lon: roundCoordinate(lon), state: inPc[0].state };
}
