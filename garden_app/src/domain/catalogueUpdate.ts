/**
 * Plant list updates published between app releases (see
 * scripts/build-catalogue-json.ts and the garden_app-plant-data workflow).
 *
 * The feed is untrusted input: its format must match, it must not be older
 * than the catalogue built into the app, and every plant and source is
 * validated individually — bad entries are dropped, never half-used.
 */
import { validateCatalogue } from './catalogue';
import type { PlantRecord, SourceRef } from './plantTypes';
import { validatePlantRecord, validateSourceRef } from './plantValidation';

export const CATALOGUE_FEED_FORMAT = 'sow-by-season-catalogue';
/** The feed layout this app understands. A newer layout is ignored until the app is updated. */
export const CATALOGUE_FEED_VERSION = 1;
const MAX_PLANTS = 3000;
const MAX_SOURCES = 1000;

export interface CatalogueFeed {
  format: typeof CATALOGUE_FEED_FORMAT;
  formatVersion: typeof CATALOGUE_FEED_VERSION;
  /** Same scheme as CATALOGUE_VERSION, e.g. "2026.09.3". */
  catalogueVersion: string;
  generatedAt: string;
  plants: PlantRecord[];
  sources: SourceRef[];
}

export interface ParsedFeed {
  catalogueVersion: string;
  generatedAt?: string;
  plants: PlantRecord[];
  sources: Record<string, SourceRef>;
  /** Plants or sources left out because they failed validation. */
  skipped: number;
}

export type FeedResult = { ok: true; feed: ParsedFeed } | { ok: false; reason: 'not-a-feed' | 'newer-format' | 'older' | 'empty'; message: string };

/** Compare "2026.09.3"-style versions numerically; missing parts count as 0. */
export function compareCatalogueVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseCatalogueFeed(json: unknown, bundledVersion: string, bundledSources: Record<string, SourceRef>): FeedResult {
  if (!isObj(json) || json.format !== CATALOGUE_FEED_FORMAT) return { ok: false, reason: 'not-a-feed', message: 'Not a Sow by Season plant list.' };
  if (json.formatVersion !== CATALOGUE_FEED_VERSION) return { ok: false, reason: 'newer-format', message: 'The plant list needs a newer version of the app.' };
  const version = typeof json.catalogueVersion === 'string' && /^\d{4}\.\d{1,2}\.\d{1,4}$/.test(json.catalogueVersion) ? json.catalogueVersion : null;
  if (!version) return { ok: false, reason: 'not-a-feed', message: 'The plant list has no valid version.' };
  if (compareCatalogueVersions(version, bundledVersion) < 0) return { ok: false, reason: 'older', message: 'The app already has a newer plant list.' };
  let skipped = 0;

  const sources: Record<string, SourceRef> = {};
  for (const raw of Array.isArray(json.sources) ? json.sources.slice(0, MAX_SOURCES) : []) {
    const r = validateSourceRef(raw);
    if (r.ok) sources[r.value.id] = r.value;
    else skipped++;
  }

  const seen = new Set<string>();
  let plants: PlantRecord[] = [];
  for (const raw of Array.isArray(json.plants) ? json.plants.slice(0, MAX_PLANTS) : []) {
    const r = validatePlantRecord(raw);
    if (r.ok && !seen.has(r.value.id)) {
      seen.add(r.value.id);
      plants.push(r.value);
    } else skipped++;
  }

  // Semantic checks (known sources, sane ranges) against bundled + feed sources.
  const problems = validateCatalogue(plants, { ...bundledSources, ...sources });
  const bad = new Set(plants.map((p) => p.id).filter((id) => problems.some((msg) => msg.startsWith(`${id}:`))));
  if (bad.size) {
    skipped += bad.size;
    plants = plants.filter((p) => !bad.has(p.id));
  }
  if (!plants.length) return { ok: false, reason: 'empty', message: 'The plant list had no usable plants.' };
  return {
    ok: true,
    feed: { catalogueVersion: version, generatedAt: typeof json.generatedAt === 'string' ? json.generatedAt.slice(0, 40) : undefined, plants, sources, skipped },
  };
}

export function buildCatalogueFeed(plants: readonly PlantRecord[], sources: Record<string, SourceRef>, catalogueVersion: string, now: Date): CatalogueFeed {
  return {
    format: CATALOGUE_FEED_FORMAT,
    formatVersion: CATALOGUE_FEED_VERSION,
    catalogueVersion,
    generatedAt: now.toISOString(),
    plants: [...plants],
    sources: Object.values(sources),
  };
}
