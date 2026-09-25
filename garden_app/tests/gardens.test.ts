/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBackup, fnv1a, serialiseBackup, stableStringify } from '../src/domain/backup/format';
import { parseBackup } from '../src/domain/backup/restore';
import { activeGarden, allGardens, HOME_GARDEN, scopeToGarden } from '../src/domain/gardens';
import { validateGarden } from '../src/domain/validation';
import { GardenRepository } from '../src/services/storage/gardenRepository';
import { MemoryStore } from '../src/services/storage/keyValueStore';
import { WeatherService } from '../src/services/weather/weatherService';
import { GardenStore } from '../src/state/gardenStore';
import { NOW_ISO, profile } from './helpers';

const NOW = new Date(NOW_ISO);
const HOBART = { suburb: 'Hobart', state: 'TAS' as const, postcode: '7000', timezone: 'Australia/Hobart', approxLatitude: -42.88, approxLongitude: 147.33, suggestedZone: 'cool-temperate' as const, source: 'offline-list' as const };

async function makeStore(fetched: string[] = []) {
  const kv = new MemoryStore();
  const weather = new WeatherService(kv, {
    fetch: async (url) => {
      fetched.push(url);
      return { ok: true, status: 200, json: async () => ({ daily: { time: ['2026-09-24'], temperature_2m_max: [20], temperature_2m_min: [8], precipitation_sum: [0] } }) };
    },
    now: () => NOW,
  });
  const store = new GardenStore(new GardenRepository(kv, () => NOW), weather, () => NOW);
  await store.init();
  const { createdAt: _c, updatedAt: _u, id: _i, ...p } = profile({ gardenName: 'Strathpine' });
  await store.saveProfile(p);
  return store;
}

const planting = (plantId: string) => ({ plantId, quantity: 2, startMethod: 'seedling' as const, plantedDate: '2026-09-20', dateAccuracy: 'exact' as const, stage: 'transplanted' as const, stageIsManual: false });

describe('several gardens', () => {
  it('starts with just the home garden, named from the profile', async () => {
    const store = await makeStore();
    const gardens = allGardens(store.state.data);
    assert.deepEqual(gardens.map((g) => [g.id, g.name, g.isHome]), [[HOME_GARDEN, 'Strathpine', true]]);
  });

  it('keeps each garden\'s areas, plantings and notes apart, and new records go to the garden shown', async () => {
    const store = await makeStore();
    await store.savePlanting(planting('tomato'));
    const plot = await store.saveGarden({ name: 'Community plot', location: HOBART });
    await store.setActiveGarden(plot.id);
    assert.equal(activeGarden(store.state.data)?.name, 'Community plot');
    await store.saveArea({ name: 'Plot 12', type: 'vegetable-bed' });
    await store.savePlanting(planting('garlic'));
    await store.addJournal('Mulched the plot', '2026-09-24');

    const home = scopeToGarden(store.state.data, HOME_GARDEN);
    const other = scopeToGarden(store.state.data, plot.id);
    assert.deepEqual(home.plantings.map((p) => p.plantId), ['tomato']);
    assert.deepEqual(other.plantings.map((p) => p.plantId), ['garlic']);
    assert.equal(other.areas.length, 1);
    assert.equal(home.areas.length, 0);
    assert.equal(other.journal.length, 1);

    // Editing a record doesn't move it to the garden currently shown.
    await store.setActiveGarden(HOME_GARDEN);
    const garlic = store.state.data.plantings.find((p) => p.plantId === 'garlic')!;
    await store.savePlanting({ ...garlic, quantity: 30 });
    assert.equal(store.state.data.plantings.find((p) => p.id === garlic.id)?.gardenId, plot.id);
  });

  it('uses the shown garden\'s location for weather and the day, without touching the home profile', async () => {
    const fetched: string[] = [];
    const store = await makeStore(fetched);
    const homeLocation = store.state.data.profile!.location;
    const plot = await store.saveGarden({ name: 'Hobart', location: HOBART });
    await store.setActiveGarden(plot.id);
    await store.refreshWeather(true);
    assert.ok(fetched.some((u) => u.includes('latitude=-42.88') && u.includes('Australia%2FHobart')));
    assert.deepEqual(store.state.data.profile!.location, homeLocation);
    await store.setProperty({ lat: -42.8812, lon: 147.3301, label: 'Plot' });
    assert.equal(store.state.data.gardens[0].property?.label, 'Plot');
    assert.equal(store.state.data.profile!.property, undefined);
  });

  it('only removes a garden once it is empty, and never the home garden', async () => {
    const store = await makeStore();
    const plot = await store.saveGarden({ name: 'Plot', location: HOBART });
    await store.setActiveGarden(plot.id);
    const pl = await store.savePlanting(planting('garlic'));
    const refused = await store.deleteGarden(plot.id);
    assert.equal(refused.ok, false);
    await store.deletePlanting(pl.id);
    assert.deepEqual(await store.deleteGarden(plot.id), { ok: true });
    assert.equal(activeGarden(store.state.data)?.id, HOME_GARDEN, 'falls back to home');
    assert.equal((await store.deleteGarden(HOME_GARDEN)).ok, false);
  });

  it('backs up every garden, and restores records of a missing garden into home', async () => {
    const store = await makeStore();
    const plot = await store.saveGarden({ name: 'Plot', location: HOBART });
    await store.setActiveGarden(plot.id);
    await store.savePlanting(planting('garlic'));
    const r = parseBackup(serialiseBackup(createBackup(store.exportData(), { now: NOW, appVersion: 'test' })));
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.data.gardens.length, 1);
    assert.equal(r.data.plantings[0].gardenId, plot.id);
    assert.equal(r.data.settings.activeGardenId, plot.id);

    const data = { ...store.exportData(), gardens: [], settings: { ...store.exportData().settings } };
    const doc = { format: 'sow-by-season-backup', schemaVersion: 6, createdAt: NOW_ISO, app: { name: 'Sow by Season', version: 'test' }, checksum: fnv1a(stableStringify(data)), data };
    const orphan = parseBackup(JSON.stringify(doc));
    assert.ok(orphan.ok);
    if (!orphan.ok) return;
    assert.equal(orphan.data.plantings[0].gardenId, undefined);
    assert.equal(orphan.data.settings.activeGardenId, undefined);
    assert.ok(orphan.warnings.some((w) => /home garden/.test(w)));
  });

  it('validates gardens and reserves the home id', () => {
    const g = { id: 'gdn_1', name: 'Plot', location: HOBART, createdAt: NOW_ISO, updatedAt: NOW_ISO };
    assert.ok(validateGarden(g).ok);
    assert.equal(validateGarden({ ...g, id: 'home' }).ok, false);
  });
});
