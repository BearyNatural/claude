/**
 * Catalogue access, validation and search.
 *
 * Search understands plain-language queries such as "tomatoes", "fruit trees",
 * "things I can plant now", "shade tolerant", "suitable for pots",
 * "subtropical vegetables", "fast-growing vegetables", "plants for a trellis"
 * and "pollinator plants" by turning recognised phrases into filters and
 * matching any remaining words against names and aliases.
 */
import { ZONE_IDS } from './climate';
import type { PlantCategory, PlantRecord, SourceRef } from './plantTypes';
import type { ClimateZoneId, ISODate } from './types';
import { inWindow, normaliseMonths, primaryWindow } from './windows';

export interface Catalogue {
  all: PlantRecord[];
  byId: Map<string, PlantRecord>;
}

export function createCatalogue(plants: readonly PlantRecord[]): Catalogue {
  const byId = new Map<string, PlantRecord>();
  for (const p of plants) byId.set(p.id, p);
  return { all: [...plants], byId };
}

/**
 * The catalogue the app uses: the bundled plants, overridden or extended by a
 * downloaded plant list update, plus the gardener's own plants. Rebuilt in
 * place so every holder of the object sees the change.
 */
export function rebuildCatalogue(cat: Catalogue, bundled: readonly PlantRecord[], updates: readonly PlantRecord[], yours: readonly PlantRecord[]): void {
  const byId = new Map<string, PlantRecord>();
  for (const p of bundled) byId.set(p.id, p);
  for (const p of updates) byId.set(p.id, { ...p, origin: 'update' });
  for (const p of yours) byId.set(p.id, p);
  cat.byId.clear();
  for (const [k, v] of byId) cat.byId.set(k, v);
  cat.all.splice(0, cat.all.length, ...byId.values());
}

export function getPlant(cat: Catalogue, id: string): PlantRecord | undefined {
  return cat.byId.get(id);
}

// ---------------------------------------------------------------------------
// Validation (run in tests so bad data never ships)
// ---------------------------------------------------------------------------

export function validateCatalogue(plants: readonly PlantRecord[], sources: Record<string, SourceRef>): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const checkSource = (plant: string, where: string, id: string) => {
    if (!sources[id]) problems.push(`${plant}: ${where} references unknown source "${id}"`);
  };
  const checkRange = (plant: string, where: string, r?: [number, number]) => {
    if (!r) return;
    if (!Number.isFinite(r[0]) || !Number.isFinite(r[1]) || r[0] > r[1] || r[0] < 0) {
      problems.push(`${plant}: ${where} has an invalid range [${r.join(', ')}]`);
    }
  };
  for (const p of plants) {
    if (ids.has(p.id)) problems.push(`Duplicate plant id ${p.id}`);
    ids.add(p.id);
    if (!p.commonName) problems.push(`${p.id}: missing commonName`);
    if (p.categories.length === 0) problems.push(`${p.id}: needs at least one category`);
    if (p.startMethods.length === 0) problems.push(`${p.id}: needs at least one start method`);
    for (const [zone, w] of Object.entries(p.windows)) {
      if (!ZONE_IDS.includes(zone as ClimateZoneId)) problems.push(`${p.id}: unknown zone ${zone}`);
      if (!w) continue;
      checkSource(p.id, `windows.${zone}`, w.sourceId);
      for (const k of ['sow', 'plant'] as const) {
        const ms = w[k];
        if (ms && normaliseMonths(ms).length !== ms.length) problems.push(`${p.id}: windows.${zone}.${k} has invalid months`);
      }
    }
    for (const id of p.germination?.sourceIds ?? []) checkSource(p.id, 'germination', id);
    for (const id of p.timing?.sourceIds ?? []) checkSource(p.id, 'timing', id);
    for (const id of p.climate.sourceIds) checkSource(p.id, 'climate', id);
    for (const id of p.site.sourceIds) checkSource(p.id, 'site', id);
    for (const id of p.spacing?.sourceIds ?? []) checkSource(p.id, 'spacing', id);
    for (const id of p.feeding?.sourceIds ?? []) checkSource(p.id, 'feeding', id);
    checkSource(p.id, 'production', p.production.sourceId);
    checkRange(p.id, 'germination.days', p.germination?.days);
    checkRange(p.id, 'timing.daysToMaturity', p.timing?.daysToMaturity);
    checkRange(p.id, 'timing.daysToTransplant', p.timing?.daysToTransplant);
    checkRange(p.id, 'timing.daysToFlower', p.timing?.daysToFlower);
    checkRange(p.id, 'spacing.plantCm', p.spacing?.plantCm);
    checkRange(p.id, 'spacing.rowCm', p.spacing?.rowCm);
    checkRange(p.id, 'production.plantsPerPerson', p.production.plantsPerPerson);
    checkRange(p.id, 'production.householdBase', p.production.householdBase);
    checkRange(p.id, 'production.successionIntervalDays', p.production.successionIntervalDays);
    const g = p.germination;
    if (g?.soilTempMinC !== undefined && g.soilTempMaxC !== undefined && g.soilTempMinC > g.soilTempMaxC) {
      problems.push(`${p.id}: germination min temp above max`);
    }
    if (p.site.soilPh) checkRange(p.id, 'site.soilPh', p.site.soilPh);
    if (!p.production.plantsPerPerson && !p.production.householdBase) {
      problems.push(`${p.id}: production profile needs plantsPerPerson or householdBase`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface PlantFilters {
  text: string;
  categories: PlantCategory[];
  zone?: ClimateZoneId;
  plantableNow?: boolean;
  containers?: boolean;
  shadeTolerant?: boolean;
  trellis?: boolean;
  fastGrowing?: boolean;
  pollinator?: boolean;
  lowMaintenance?: boolean;
  frostHardy?: boolean;
  perennial?: boolean;
}

export interface SearchContext {
  zone: ClimateZoneId | null;
  today: ISODate;
}

export interface SearchResult {
  plant: PlantRecord;
  /** Short explanations of why the plant matched a filter. */
  matched: string[];
}

interface PhraseRule {
  re: RegExp;
  apply: (f: PlantFilters) => void;
}

const ZONE_WORDS: [RegExp, ClimateZoneId][] = [
  [/\btropical\b/, 'tropical'],
  [/\bsub-?tropical\b/, 'subtropical'],
  [/\bcool[- ]temperate\b|\bcool climate\b|\bcold climate\b/, 'cool-temperate'],
  [/\bwarm[- ]temperate\b|\btemperate\b/, 'warm-temperate'],
  [/\b(semi-)?arid\b|\bdesert\b|\binland\b/, 'arid'],
];

const PHRASES: PhraseRule[] = [
  { re: /\b(things|what|plants?)?\s*(i|we)?\s*(can|to)\s+(plant|sow|grow)\s+now\b|\bplant(able)? now\b|\bin season\b/, apply: (f) => (f.plantableNow = true) },
  { re: /\b(suitable for |for |in )?(pots?|containers?|balcon(y|ies))\b/, apply: (f) => (f.containers = true) },
  { re: /\bshade[- ]?(tolerant|loving)?\b|\bpart[- ]shade\b/, apply: (f) => (f.shadeTolerant = true) },
  { re: /\b(for a |on a )?trellis(es)?\b|\bclimb(ing|ers?)\b|\bvertical\b/, apply: (f) => (f.trellis = true) },
  { re: /\bfast[- ]?(growing)?\b|\bquick\b/, apply: (f) => (f.fastGrowing = true) },
  { re: /\bpollinators?\b|\bbees?\b|\bbee[- ]friendly\b|\bbeneficial insects?\b/, apply: (f) => (f.pollinator = true) },
  { re: /\blow[- ]maintenance\b|\beasy\b|\bbeginners?\b/, apply: (f) => (f.lowMaintenance = true) },
  { re: /\bfrost[- ](hardy|tolerant)\b/, apply: (f) => (f.frostHardy = true) },
  { re: /\bperennials?\b/, apply: (f) => (f.perennial = true) },
  { re: /\bfruit trees?\b/, apply: (f) => pushUnique(f.categories, 'tree', 'fruit') },
  { re: /\bvegetables?\b|\bveg(gies|ies)?\b/, apply: (f) => pushUnique(f.categories, 'vegetable') },
  { re: /\bherbs?\b/, apply: (f) => pushUnique(f.categories, 'herb') },
  { re: /\bfruits?\b/, apply: (f) => pushUnique(f.categories, 'fruit') },
  { re: /\bflowers?\b/, apply: (f) => pushUnique(f.categories, 'flower') },
  { re: /\bnatives?\b/, apply: (f) => pushUnique(f.categories, 'native') },
  { re: /\btrees?\b/, apply: (f) => pushUnique(f.categories, 'tree') },
  { re: /\bgreen manure\b|\bcover crops?\b/, apply: (f) => pushUnique(f.categories, 'green-manure') },
];

const STOP = new Set(['the', 'a', 'an', 'for', 'to', 'in', 'of', 'and', 'plants', 'plant', 'that', 'are', 'my', 'good', 'suitable', 'grow', 'growing', 'with', 'things', 'some', 'which', 'what', 'i', 'can']);

function pushUnique<T>(arr: T[], ...items: T[]) {
  for (const i of items) if (!arr.includes(i)) arr.push(i);
}

/** Turn free text into structured filters plus leftover name words. */
export function parseQuery(query: string): PlantFilters {
  let q = ` ${query.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')} `;
  const f: PlantFilters = { text: '', categories: [] };
  for (const [re, zone] of ZONE_WORDS) {
    if (re.test(q)) {
      f.zone = zone;
      q = q.replace(re, ' ');
      break;
    }
  }
  for (const rule of PHRASES) {
    if (rule.re.test(q)) {
      rule.apply(f);
      q = q.replace(rule.re, ' ');
    }
  }
  f.text = q
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(' ');
  return f;
}

/** Simple singularisation so "tomatoes" finds "tomato", "cherries" finds "cherry". */
export function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (word.endsWith('ches') || word.endsWith('shes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function nameScore(plant: PlantRecord, text: string): number {
  if (!text) return 1;
  const words = text.split(/\s+/).map(singular);
  const hay = [plant.commonName, plant.botanicalName ?? '', ...plant.aliases, plant.family ?? '']
    .map((s) => s.toLowerCase());
  let score = 0;
  for (const w of words) {
    let best = 0;
    for (const h of hay) {
      const hs = h.split(/[\s/(),-]+/).map(singular);
      if (h === w || singular(h) === w) best = Math.max(best, 10);
      else if (hs.includes(w)) best = Math.max(best, 6);
      else if (h.includes(w)) best = Math.max(best, 3);
    }
    if (best === 0) return 0; // every remaining word must match something
    score += best;
  }
  return score;
}

export function isFastGrowing(p: PlantRecord): boolean {
  return p.tags.includes('fast-growing') || (p.timing?.daysToMaturity !== undefined && p.timing.daysToMaturity[1] <= 60);
}

export function isShadeTolerant(p: PlantRecord): boolean {
  return p.tags.includes('shade-tolerant') || p.site.sun !== 'full-sun';
}

export function searchPlants(cat: Catalogue, filters: PlantFilters, ctx: SearchContext): SearchResult[] {
  const results: { r: SearchResult; score: number }[] = [];
  const zone = filters.zone ?? ctx.zone;
  for (const plant of cat.all) {
    const matched: string[] = [];
    const s = nameScore(plant, filters.text);
    if (s === 0) continue;
    if (filters.categories.length && !filters.categories.every((c) => plant.categories.includes(c))) continue;
    if (filters.zone) {
      const inZone = plant.windows[filters.zone] !== undefined || plant.climate.suitableZones?.includes(filters.zone);
      if (!inZone) continue;
      matched.push(`Has planting information for ${filters.zone.replace('-', ' ')} areas`);
    }
    if (filters.plantableNow) {
      const w = primaryWindow(plant, zone);
      if (!w || !inWindow(w.months, ctx.today)) continue;
      matched.push('In its planting window now');
    }
    if (filters.containers) {
      if (plant.container.suitable !== true) continue;
      matched.push(plant.container.minVolumeL ? `Suits pots (about ${plant.container.minVolumeL} L or larger)` : 'Suits pots');
    }
    if (filters.shadeTolerant) {
      if (!isShadeTolerant(plant)) continue;
      matched.push('Tolerates some shade');
    }
    if (filters.trellis) {
      if (plant.support !== 'trellis') continue;
      matched.push('Grows on a trellis');
    }
    if (filters.fastGrowing) {
      if (!isFastGrowing(plant)) continue;
      matched.push('Fast growing');
    }
    if (filters.pollinator) {
      if (!(plant.categories.includes('pollinator') || plant.tags.includes('pollinator'))) continue;
      matched.push('Attracts pollinators');
    }
    if (filters.lowMaintenance) {
      if (plant.production.maintenance !== 'low') continue;
      matched.push('Low maintenance');
    }
    if (filters.frostHardy) {
      if (plant.climate.frost !== 'hardy') continue;
      matched.push('Frost hardy');
    }
    if (filters.perennial) {
      if (plant.lifecycle !== 'perennial') continue;
      matched.push('Perennial');
    }
    results.push({ r: { plant, matched }, score: s });
  }
  results.sort((a, b) => b.score - a.score || a.r.plant.commonName.localeCompare(b.r.plant.commonName));
  return results.map((x) => x.r);
}

/** Convenience: parse and search in one step. */
export function searchByText(cat: Catalogue, query: string, ctx: SearchContext): SearchResult[] {
  return searchPlants(cat, parseQuery(query), ctx);
}
