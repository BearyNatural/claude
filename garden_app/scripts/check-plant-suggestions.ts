// Automatic first checks on plant suggestions shared from the app (issues
// labelled "plant-suggestion" in BearyNatural/australian_plant_data).
// For each unchecked suggestion: validate the details, look for a plant that's
// already in the list, confirm the botanical name with the Atlas of Living
// Australia, then comment and label it. It never changes the plant list —
// adding a plant always needs a person to verify it against reliable sources.
// Run: PLANT_DATA_TOKEN=… npx tsx scripts/check-plant-suggestions.ts
import { PLANTS } from '../src/data/plants';
import { validateCustomPlant } from '../src/domain/validation';
import { parseAlaResults } from '../src/services/plants/alaNames';

const REPO = 'BearyNatural/australian_plant_data';
const token = process.env.PLANT_DATA_TOKEN;
if (!token) {
  console.error('PLANT_DATA_TOKEN is not set.');
  process.exit(1);
}
const gh = (path: string, init: RequestInit = {}) =>
  fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

interface Issue { number: number; title: string; body: string | null; labels: { name: string }[] }

async function main() {
  const res = await gh('/issues?state=open&labels=plant-suggestion&per_page=50');
  if (!res.ok) throw new Error(`Couldn't list suggestions (HTTP ${res.status}) — does the token have Issues access?`);
  const issues = ((await res.json()) as Issue[]).filter((i) => !i.labels.some((l) => ['checked', 'needs-info'].includes(l.name)));
  console.log(`${issues.length} new suggestion(s).`);
  for (const issue of issues) {
    const notes: string[] = [];
    const labels: string[] = [];
    const json = issue.body?.match(/```json\s*([\s\S]*?)```/)?.[1];
    let plant: Record<string, unknown> | null = null;
    let zone: string | undefined;
    try {
      const doc = JSON.parse(json ?? 'null');
      if (doc?.kind === 'sow-by-season-plant-suggestion' && doc.plant && typeof doc.plant === 'object') {
        plant = doc.plant;
        zone = typeof doc.climateZone === 'string' ? doc.climateZone : undefined;
      }
    } catch {
      plant = null;
    }
    if (!plant) {
      notes.push('❌ The suggestion details could not be read.');
      labels.push('needs-info');
    } else {
      const check = validateCustomPlant({ ...plant, id: 'custom_check', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      if (!check.ok) {
        notes.push(`❌ The details aren't in the expected shape: ${check.error}`);
        labels.push('needs-info');
      } else {
        const p = check.value;
        notes.push(`✅ Details read: **${p.commonName}**${p.botanicalName ? ` (_${p.botanicalName}_${p.familyName ? `, ${p.familyName}` : ''})` : ''} · ${p.categories.join(', ') || 'no type given'} · ${p.lifecycle ?? 'lifecycle not given'}${p.plantMonths?.length ? ` · plants in months ${p.plantMonths.join(', ')}${zone ? ` (${zone})` : ''}` : ''}.`);
        const dup = PLANTS.find((x) =>
          [x.commonName, ...x.aliases].some((n) => norm(n) === norm(p.commonName)) || (p.botanicalName && norm(x.botanicalName) === norm(p.botanicalName)),
        );
        if (dup) {
          notes.push(`⚠️ Possibly already in the plant list as **${dup.commonName}** (\`${dup.id}\`). It may be a variety — consider adding it as a cultivar there.`);
          labels.push('possible-duplicate');
        }
        if (p.botanicalName) {
          try {
            const r = await fetch(`https://api.ala.org.au/species/search?${new URLSearchParams({ q: p.botanicalName, pageSize: '10', fq: 'idxtype:TAXON' })}`);
            const names = r.ok ? parseAlaResults(await r.json()) : [];
            const hit = names.find((n) => norm(n.scientificName) === norm(p.botanicalName));
            notes.push(hit ? `✅ Botanical name confirmed by the Atlas of Living Australia${hit.family ? ` (family ${hit.family})` : ''}.` : '⚠️ The botanical name wasn\'t found as an accepted name in the Atlas of Living Australia — check spelling, or it may be a cultivar or hybrid.');
          } catch {
            notes.push('⚠️ The Atlas of Living Australia couldn\'t be reached to check the botanical name.');
          }
        } else {
          notes.push('ℹ️ No botanical name given.');
        }
        labels.push('checked');
      }
    }
    notes.push('', '**Next:** verify the growing details against reliable Australian sources before adding this plant (with its sources) to the plant list. Nothing has been added automatically.');
    await gh(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: notes.join('\n') }) });
    await gh(`/issues/${issue.number}/labels`, { method: 'POST', body: JSON.stringify({ labels }) });
    console.log(`#${issue.number}: ${labels.join(', ')}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
