/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fnv1a, stableStringify } from '../src/domain/backup/format';
import { parseBackup } from '../src/domain/backup/restore';
import { areaNames, newPotName, quantityInArea } from '../src/domain/plantingAreas';
import { parsePostcodeData, postcodeCentre, searchPostcodePlaces } from '../src/domain/postcodes';
import { areaUsage } from '../src/domain/space';
import { validatePlanting } from '../src/domain/validation';
import { coordinatesForPostcode, offlineCandidates, onlineCandidates } from '../src/services/location/geocode';
import { GardenRepository } from '../src/services/storage/gardenRepository';
import { MemoryStore } from '../src/services/storage/keyValueStore';
import { WeatherService } from '../src/services/weather/weatherService';
import { GardenStore } from '../src/state/gardenStore';
import { area, getPlant, NOW_ISO, planting, profile } from './helpers';

const FIXTURE = ['4500|QLD|Brendale:-2732:15298;Strathpine:-2730:15299', '7000|TAS|Hobart:-4288:14733', 'bad line', '9999|XX|Nowhere:0:0'].join('\n');

describe('offline postcodes and suburbs', () => {
  const places = parsePostcodeData(FIXTURE);

  it('parses the compact table and skips malformed lines', () => {
    assert.equal(places.length, 3);
    assert.deepEqual(places[0], { name: 'Brendale', postcode: '4500', state: 'QLD', lat: -27.32, lon: 152.98 });
  });

  it('finds every suburb in a postcode, and suburbs by name', () => {
    assert.deepEqual(searchPostcodePlaces(places, '4500').map((p) => p.name), ['Brendale', 'Strathpine']);
    assert.deepEqual(searchPostcodePlaces(places, 'strath').map((p) => p.name), ['Strathpine']);
    assert.equal(searchPostcodePlaces(places, '45').length, 0); // too short to be useful
  });

  it('gives an approximate postcode centre', () => {
    assert.deepEqual(postcodeCentre(places, '4500'), { lat: -27.31, lon: 152.99, state: 'QLD' });
    assert.equal(postcodeCentre(places, '1234'), null);
  });

  it('covers postcodes missing from the reference town list (e.g. 4500) with coordinates and a climate', () => {
    const r = offlineCandidates('4500');
    assert.ok(r.length >= 5);
    assert.ok(r.every((c) => c.location.postcode === '4500' && c.location.state === 'QLD'));
    assert.ok(r.some((c) => c.label === 'Strathpine'));
    assert.ok(r.every((c) => c.location.approxLatitude !== undefined && c.location.suggestedZone === 'subtropical'));
    assert.ok(!r.some((c) => / Dc$/.test(c.label)), 'postal-only names are dropped');
  });

  it('still lists curated reference towns first for name searches', () => {
    assert.equal(offlineCandidates('toowoomba')[0].label, 'Toowoomba');
  });

  it('does not send bare postcodes to the online place search (it only knows names)', async () => {
    let called = false;
    const r = await onlineCandidates('4500', async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; });
    assert.deepEqual(r, []);
    assert.equal(called, false);
  });

  it('maps a postcode to rounded coordinates', () => {
    const c = coordinatesForPostcode('4500')!;
    assert.ok(Math.abs(c.lat + 27.3) < 0.1 && Math.abs(c.lon - 152.95) < 0.1);
    assert.equal(coordinatesForPostcode('9999'), null);
    assert.equal(coordinatesForPostcode(undefined), null);
  });
});

describe('plantings in several garden areas', () => {
  it('shares quantity evenly for space estimates', () => {
    const a = area({ id: 'bed', lengthM: 1, widthM: 1 });
    const b = area({ id: 'pots', type: 'pot' });
    const p = planting({ plantId: 'marigold', quantity: 6, areaIds: ['bed', 'pots', 'border'], stage: 'established' });
    assert.equal(quantityInArea(p, 'bed'), 2);
    assert.equal(quantityInArea(p, 'elsewhere'), 0);
    const alone = areaUsage(a, [planting({ plantId: 'marigold', quantity: 2, areaIds: ['bed'], stage: 'established' })], getPlant);
    assert.equal(areaUsage(a, [p], getPlant).usedM2, alone.usedM2);
    assert.equal(areaNames(p, [a, { ...b, name: 'Pots' }, { ...a, id: 'border', name: 'Front border' }]), 'Back vegetable patch, Pots and Front border');
  });

  it('reads plantings saved by earlier versions with a single areaId', () => {
    const { areaIds: _drop, ...rest } = planting({ plantId: 'rosemary', areaIds: ['x'] });
    const r = validatePlanting({ ...rest, areaId: 'bed1' });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.value.areaIds, ['bed1']);
    const none = validatePlanting(rest);
    assert.ok(none.ok && none.value.areaIds === undefined);
  });

  it('migrates v2 backups (single areaId) to the multi-area format', () => {
    const data = {
      areas: [area({ id: 'bed1' })],
      plantings: [{ ...planting({ id: 'p1', plantId: 'rosemary' }), areaId: 'bed1' }],
    };
    const doc = { format: 'sow-by-season-backup', schemaVersion: 2, createdAt: NOW_ISO, app: { name: 'Sow by Season', version: '1.0.1' }, checksum: fnv1a(stableStringify(data)), data };
    const r = parseBackup(JSON.stringify(doc));
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.migrations, ['v2 → v3', 'v3 → v4']);
    assert.deepEqual(r.data.plantings[0].areaIds, ['bed1']);
  });

  it('names a new pot after the plant without clashing', () => {
    assert.equal(newPotName('Rosemary', []), 'Rosemary pot');
    assert.equal(newPotName('Rosemary', [area({ name: 'Rosemary pot' }), area({ name: 'rosemary pot 2' })]), 'Rosemary pot 3');
  });
});

const NOW = new Date(NOW_ISO);

async function makeStore(fetched: string[] = []) {
  const kv = new MemoryStore();
  const weather = new WeatherService(kv, {
    fetch: async (url) => {
      fetched.push(url);
      return { ok: true, status: 200, json: async () => ({ daily: { time: ['2026-09-24'], temperature_2m_max: [25], temperature_2m_min: [14], precipitation_sum: [0] } }) };
    },
    now: () => NOW,
  });
  const store = new GardenStore(new GardenRepository(kv, () => NOW), weather, () => NOW);
  await store.init();
  return store;
}

describe('store: areas and weather for manual locations', () => {
  it('removing an area keeps a planting in its other areas', async () => {
    const store = await makeStore();
    const bed = await store.saveArea({ name: 'Bed', type: 'vegetable-bed' });
    const pots = await store.saveArea({ name: 'Pots', type: 'pot' });
    await store.savePlanting({ plantId: 'marigold', quantity: 4, areaIds: [bed.id, pots.id], startMethod: 'seedling', plantedDate: '2026-09-20', dateAccuracy: 'exact', stage: 'transplanted', stageIsManual: false });
    await store.deleteArea(bed.id);
    assert.deepEqual(store.state.data.plantings[0].areaIds, [pots.id]);
    await store.deleteArea(pots.id);
    assert.equal(store.state.data.plantings[0].areaIds, undefined);
  });

  it('gets weather for a manually set location from its postcode', async () => {
    const fetched: string[] = [];
    const store = await makeStore(fetched);
    const { createdAt: _c, updatedAt: _u, id: _i, ...p } = profile();
    await store.saveProfile({ ...p, location: { state: 'QLD', postcode: '4500', timezone: 'Australia/Brisbane', source: 'manual' } });
    await store.refreshWeather(true);
    assert.ok(store.state.weather.snapshot);
    assert.ok(fetched.some((u) => u.includes('latitude=-27.3')));
  });

  it('says a suburb or postcode is needed when there is nothing to get weather for', async () => {
    const store = await makeStore();
    const { createdAt: _c, updatedAt: _u, id: _i, ...p } = profile();
    await store.saveProfile({ ...p, location: { state: 'QLD', timezone: 'Australia/Brisbane', source: 'manual' } });
    await store.refreshWeather(true);
    assert.equal(store.state.weather.needsLocation, true);
    assert.equal(store.state.weather.snapshot, null);
  });
});
