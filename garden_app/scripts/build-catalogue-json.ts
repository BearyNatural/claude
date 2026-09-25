// Builds the published plant list (catalogue.json) from the bundled catalogue,
// for the public BearyNatural/sow-by-season-plant-data repository. Installed
// apps download it to get new or corrected plants between releases.
// Run: npx tsx scripts/build-catalogue-json.ts <output-file>
// Refuses to write anything if the data wouldn't pass the app's own checks.
import { writeFileSync } from 'node:fs';
import { CATALOGUE_VERSION, PLANTS } from '../src/data/plants';
import { SOURCES } from '../src/data/sources';
import { validateCatalogue } from '../src/domain/catalogue';
import { buildCatalogueFeed, parseCatalogueFeed } from '../src/domain/catalogueUpdate';

const out = process.argv[2];
if (!out) {
  console.error('Usage: npx tsx scripts/build-catalogue-json.ts <output-file>');
  process.exit(1);
}

const problems = validateCatalogue(PLANTS, SOURCES);
if (problems.length) {
  console.error(`Catalogue has problems:\n${problems.join('\n')}`);
  process.exit(1);
}

// Leave out app-only sources (the gardener's own notes), and anything unused.
const used = new Set<string>();
for (const p of PLANTS) {
  for (const w of Object.values(p.windows)) if (w) used.add(w.sourceId);
  for (const ids of [p.germination?.sourceIds, p.timing?.sourceIds, p.climate.sourceIds, p.site.sourceIds, p.spacing?.sourceIds, p.feeding?.sourceIds]) for (const id of ids ?? []) used.add(id);
  used.add(p.production.sourceId);
}
const sources = Object.fromEntries(Object.entries(SOURCES).filter(([id]) => used.has(id)));

const feed = buildCatalogueFeed(PLANTS, sources, CATALOGUE_VERSION, new Date());
// Round-trip through the app's own parser: every plant must survive.
const check = parseCatalogueFeed(JSON.parse(JSON.stringify(feed)), CATALOGUE_VERSION, {});
if (!check.ok || check.feed.plants.length !== PLANTS.length || check.feed.skipped) {
  console.error(`The feed would not be fully accepted by the app: ${check.ok ? `${check.feed.skipped} entries skipped` : check.message}`);
  process.exit(1);
}
writeFileSync(out, `${JSON.stringify(feed, null, 1)}\n`);
console.log(`Wrote ${out}: plant list ${CATALOGUE_VERSION}, ${PLANTS.length} plants, ${Object.keys(sources).length} sources.`);
