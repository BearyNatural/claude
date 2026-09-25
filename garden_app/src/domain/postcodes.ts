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

const STATE_WORDS: [string, AustralianState][] = [
  ['australian capital territory', 'ACT'],
  ['new south wales', 'NSW'],
  ['northern territory', 'NT'],
  ['south australia', 'SA'],
  ['western australia', 'WA'],
  ['queensland', 'QLD'],
  ['tasmania', 'TAS'],
  ['victoria', 'VIC'],
  ['qld', 'QLD'],
  ['nsw', 'NSW'],
  ['vic', 'VIC'],
  ['tas', 'TAS'],
  ['act', 'ACT'],
  ['sa', 'SA'],
  ['wa', 'WA'],
  ['nt', 'NT'],
];

const tidy = (t: string) => ` ${t.replace(/\s+/g, ' ').trim()} `;

export interface PlaceQuery {
  /** Words that may name the place (state, postcode and "Australia" removed). */
  words: string[];
  state?: AustralianState;
  postcode?: string;
}

/**
 * Understands what people type into a place search — "Bray Park Qld",
 * "Bray Park, QLD 4500", even a full street address — by pulling out a
 * postcode and a state at the end and keeping the rest as place words.
 */
export function parsePlaceQuery(query: string): PlaceQuery {
  let text = ` ${query.toLowerCase().replace(/[.,;/()]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  let postcode: string | undefined;
  let state: AustralianState | undefined;
  const pcMatch = text.match(/ (\d{4}) (?=(?:[a-z ]*)$)/);
  if (pcMatch && /[a-z]/.test(text)) {
    postcode = pcMatch[1];
    text = tidy(text.replace(pcMatch[0], ' '));
  }
  text = tidy(text.replace(/ australia $/, ' '));
  for (const [word, st] of STATE_WORDS) {
    const re = new RegExp(` ${word} $`);
    if (re.test(text) && text.trim() !== word) {
      state = st;
      text = tidy(text.replace(re, ' '));
      break;
    }
  }
  if (!postcode) {
    const tail = text.match(/ (\d{4}) $/);
    if (tail && /[a-z]/.test(text)) {
      postcode = tail[1];
      text = text.replace(/ \d{4} $/, ' ');
    }
  }
  return { words: text.trim().split(' ').filter(Boolean), state, postcode };
}

/**
 * Place search for free text. A plain postcode or name uses the normal search;
 * otherwise the longest run of words at the end that exactly names a suburb
 * wins ("41 Francis Road Bray Park" → Bray Park), narrowed by any state or
 * postcode given. Street numbers and names are never kept.
 */
export function findPlaces(places: readonly PostcodePlace[], query: string, limit = 12): PostcodePlace[] {
  const q = parsePlaceQuery(query);
  const narrow = (list: PostcodePlace[]) => {
    let out = list;
    if (q.postcode && out.some((p) => p.postcode === q.postcode)) out = out.filter((p) => p.postcode === q.postcode);
    if (q.state && out.some((p) => p.state === q.state)) out = out.filter((p) => p.state === q.state);
    return out;
  };
  if (!q.words.length) return q.postcode ? searchPostcodePlaces(places, q.postcode, limit) : [];
  for (let i = 0; i < q.words.length; i++) {
    const phrase = q.words.slice(i).join(' ');
    if (/^\d+$/.test(phrase)) break;
    const exact = places.filter((p) => p.name.toLowerCase() === phrase);
    if (exact.length) return narrow(exact).slice(0, limit);
  }
  return narrow(searchPostcodePlaces(places, q.words.join(' '), limit * 4)).slice(0, limit);
}
