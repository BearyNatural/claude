/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOGUE_VERSION, PLANTS } from '../src/data/plants';
import { SOURCES } from '../src/data/sources';
import { createBackup, serialiseBackup } from '../src/domain/backup/format';
import { parseBackup } from '../src/domain/backup/restore';
import { buildCatalogueFeed, compareCatalogueVersions, parseCatalogueFeed } from '../src/domain/catalogueUpdate';
import { customToPlantRecord } from '../src/domain/customPlants';
import type { PlantRecord } from '../src/domain/plantTypes';
import { validatePlantRecord } from '../src/domain/plantValidation';
import { validateCustomPlant } from '../src/domain/validation';
import { CatalogueUpdates } from '../src/services/catalogue/catalogueUpdates';
import { parseAlaResults } from '../src/services/plants/alaNames';
import { GardenRepository } from '../src/services/storage/gardenRepository';
import { MemoryStore } from '../src/services/storage/keyValueStore';
import { WeatherService } from '../src/services/weather/weatherService';
import { GardenStore, getPlant } from '../src/state/gardenStore';
import { NOW_ISO } from './helpers';

const NOW = new Date(NOW_ISO);
const fig = PLANTS.find((p) => p.id === 'fig')!;

function newPlant(overrides: Partial<PlantRecord> = {}): PlantRecord {
  return { ...fig, id: 'lilly-pilly', commonName: 'Lilly pilly', aliases: ['lillypilly'], categories: ['native', 'fruit', 'tree'], ...overrides };
}

function feedJson(plants: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.parse(JSON.stringify({ ...buildCatalogueFeed([], SOURCES, '2026.10.1', NOW), plants, ...extra }));
}

describe('plant list updates (published between releases)', () => {
  it('accepts every plant built into the app', () => {
    for (const p of PLANTS) {
      const r = validatePlantRecord(JSON.parse(JSON.stringify(p)));
      assert.ok(r.ok, `${p.id}: ${r.ok ? '' : r.error}`);
    }
  });

  it('compares plant list versions numerically', () => {
    assert.ok(compareCatalogueVersions('2026.10.1', '2026.9.12') > 0);
    assert.equal(compareCatalogueVersions('2026.09.2', '2026.9.2'), 0);
    assert.ok(compareCatalogueVersions('2026.09.1', CATALOGUE_VERSION) <= 0);
  });

  it('adds new plants and corrections from a valid list', () => {
    const r = parseCatalogueFeed(feedJson([newPlant(), { ...fig, summary: 'Corrected summary.' }]), CATALOGUE_VERSION, SOURCES);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.feed.plants.map((p) => p.id), ['lilly-pilly', 'fig']);
    assert.equal(r.feed.skipped, 0);
  });

  it('refuses lists that are not ours, from a newer format, or older than the app', () => {
    const bad = (json: unknown) => {
      const r = parseCatalogueFeed(json, CATALOGUE_VERSION, SOURCES);
      return r.ok ? 'ok' : r.reason;
    };
    assert.equal(bad({ hello: 'world' }), 'not-a-feed');
    assert.equal(bad(feedJson([newPlant()], { formatVersion: 2 })), 'newer-format');
    assert.equal(bad(feedJson([newPlant()], { catalogueVersion: '2020.01.1' })), 'older');
    assert.equal(bad(feedJson([newPlant()], { catalogueVersion: 'latest' })), 'not-a-feed');
  });

  it('drops individual bad entries instead of trusting them', () => {
    const r = parseCatalogueFeed(
      feedJson([
        newPlant(),
        newPlant({ id: 'bad-month', windows: { subtropical: { plant: [13 as never], sourceId: 'general-knowledge' } } }),
        newPlant({ id: 'unknown-source', climate: { ...fig.climate, sourceIds: ['made-up'] } }),
        newPlant({ id: 'custom_sneaky' }),
        newPlant({ id: 'too-long', summary: 'x'.repeat(5000) }),
        { id: 'not-a-plant' },
      ]),
      CATALOGUE_VERSION,
      SOURCES,
    );
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.feed.plants.map((p) => p.id), ['lilly-pilly']);
    assert.equal(r.feed.skipped, 5);
  });

  it('downloads at most daily, caches for offline use, and keeps the cached list when offline', async () => {
    const kv = new MemoryStore();
    let now = NOW;
    let online = true;
    let calls = 0;
    const svc = new CatalogueUpdates(kv, { version: CATALOGUE_VERSION, sources: SOURCES }, {
      now: () => now,
      token: 'test-token',
      fetch: async () => {
        calls++;
        if (!online) throw new Error('offline');
        return { ok: true, status: 200, json: async () => feedJson([newPlant()]) };
      },
    });
    const first = await svc.check();
    assert.equal(first.feed?.plants[0].id, 'lilly-pilly');
    await svc.check();
    assert.equal(calls, 1, 'not again within a day');
    now = new Date(NOW.getTime() + 25 * 3600_000);
    online = false;
    const offline = await svc.check();
    assert.equal(calls, 2);
    assert.equal(offline.feed?.plants[0].id, 'lilly-pilly');
    assert.match(offline.error ?? '', /offline/);
  });

  it('reads the private plant list with its read-only token, and says when access needs renewing', async () => {
    const seen: (string | undefined)[] = [];
    const svc = (token: string | undefined, status: number) =>
      new CatalogueUpdates(new MemoryStore(), { version: CATALOGUE_VERSION, sources: SOURCES }, {
        now: () => NOW,
        token,
        fetch: async (_url, init) => {
          seen.push(init?.headers?.Authorization);
          return { ok: status === 200, status, json: async () => feedJson([newPlant()]) };
        },
      });
    const noToken = await svc(undefined, 200).check(true);
    assert.equal(seen.length, 0, 'no request without a token');
    assert.match(noToken.error ?? '', /aren't set up/);
    assert.equal((await svc('abc', 200).check(true)).feed?.plants[0].id, 'lilly-pilly');
    assert.equal(seen[0], 'Bearer abc');
    assert.match((await svc('expired', 401).check(true)).error ?? '', /renewing/);
  });
});

async function makeStore(feed?: unknown) {
  const kv = new MemoryStore();
  const updates = new CatalogueUpdates(kv, { version: CATALOGUE_VERSION, sources: SOURCES }, {
    now: () => NOW,
    token: 'test-token',
    fetch: async () => (feed ? { ok: true, status: 200, json: async () => feed } : { ok: false, status: 404, json: async () => ({}) }),
  });
  const store = new GardenStore(new GardenRepository(kv, () => NOW), new WeatherService(kv, { fetch: async () => { throw new Error('offline'); }, now: () => NOW }), () => NOW, undefined, updates);
  await store.init();
  await store.checkPlantList(true);
  return store;
}

describe('the live plant list in the app', () => {
  it('shows plants from a downloaded update everywhere getPlant is used', async () => {
    const store = await makeStore(feedJson([newPlant()]));
    assert.equal(getPlant('lilly-pilly')?.origin, 'update');
    assert.equal(store.state.catalogueInfo.fromUpdate, true);
    assert.equal(store.state.catalogueInfo.added, 1);
    assert.ok(getPlant('tomato'), 'bundled plants stay');
  });

  it('lets the gardener add, use and remove their own plants', async () => {
    const store = await makeStore();
    const mine = await store.saveCustomPlant({ commonName: "Plumcot 'Flavor King'", categories: ['fruit', 'tree'], lifecycle: 'perennial', startMethods: ['tree'], plantMonths: [6, 7], potOk: true });
    assert.match(mine.id, /^custom_/);
    const rec = getPlant(mine.id)!;
    assert.equal(rec.origin, 'yours');
    assert.deepEqual(rec.windows.subtropical?.plant, [6, 7]);
    assert.equal(rec.container.suitable, true);
    await store.savePlanting({ plantId: mine.id, quantity: 1, startMethod: 'tree', plantedDate: '2026-07-01', dateAccuracy: 'exact', stage: 'transplanted', stageIsManual: false });
    assert.deepEqual(await store.deleteCustomPlant(mine.id), { ok: false, inUse: 1 });

    // Own plants go into backups and come back on restore.
    const r = parseBackup(serialiseBackup(createBackup(store.exportData(), { now: NOW, appVersion: 'test' })));
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.data.customPlants.length, 1);
    const other = await makeStore();
    await other.restore(r.data);
    assert.equal(getPlant(mine.id)?.commonName, "Plumcot 'Flavor King'");
  });

  it('only accepts own-plant ids the app creates, and treats seed-sown months as sowing', () => {
    const base = { commonName: 'Warrigal greens', categories: ['vegetable', 'native'], lifecycle: 'perennial', startMethods: ['direct-sow'], plantMonths: [9, 10], createdAt: NOW_ISO, updatedAt: NOW_ISO };
    assert.equal(validateCustomPlant({ ...base, id: 'tomato' }).ok, false);
    const ok = validateCustomPlant({ ...base, id: 'custom_abc' });
    assert.ok(ok.ok);
    if (ok.ok) assert.deepEqual(customToPlantRecord(ok.value).windows.arid?.sow, [9, 10]);
  });

  it('reads plant names from the Atlas of Living Australia, ignoring animals and synonyms', () => {
    const names = parseAlaResults({
      searchResults: {
        results: [
          { scientificName: 'Syzygium australe', commonNameSingle: 'Brush Cherry', family: 'Myrtaceae', kingdom: 'Plantae', taxonomicStatus: 'accepted', rank: 'species' },
          { scientificName: 'Phyllopteryx taeniolatus', commonNameSingle: 'Common Seadragon', kingdom: 'ANIMALIA', taxonomicStatus: 'accepted' },
          { scientificName: 'Eugenia australis', kingdom: 'Plantae', taxonomicStatus: 'synonym' },
        ],
      },
    });
    assert.deepEqual(names.map((n) => n.scientificName), ['Syzygium australe']);
    assert.equal(names[0].family, 'Myrtaceae');
  });
});
