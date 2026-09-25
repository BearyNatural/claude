/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyGardenData } from '../src/domain/types';
import { GardenRepository } from '../src/services/storage/gardenRepository';
import { MemoryStore } from '../src/services/storage/keyValueStore';
import { WeatherService } from '../src/services/weather/weatherService';
import { GardenStore } from '../src/state/gardenStore';
import { profile } from './helpers';

const NOW = new Date('2026-09-24T00:00:00Z'); // 10am in Brisbane

async function makeStore(online = false) {
  const kv = new MemoryStore();
  const repo = new GardenRepository(kv, () => NOW);
  const weather = new WeatherService(kv, {
    fetch: async () => {
      if (!online) throw new Error('offline');
      return { ok: true, status: 200, json: async () => ({ daily: { time: ['2026-09-24'], temperature_2m_max: [25], temperature_2m_min: [14], precipitation_sum: [0] } }) };
    },
    now: () => NOW,
  });
  const store = new GardenStore(repo, weather, () => NOW);
  await store.init();
  return { store, kv, repo };
}

describe('garden store (actions wire domain + storage)', () => {
  it('starts empty and works offline', async () => {
    const { store } = await makeStore();
    assert.equal(store.state.status, 'ready');
    assert.equal(store.state.data.profile, null);
    const { createdAt: _c, updatedAt: _u, id: _i, ...p } = profile();
    await store.saveProfile(p);
    assert.equal(store.today(), '2026-09-24');
    await store.refreshWeather(true); // saveProfile starts this in the background
    assert.equal(store.state.weather.snapshot, null);
    assert.match(store.state.weather.error ?? '', /offline|reach/i);
  });

  it('persists plantings and records events that update the stage', async () => {
    const { store, repo } = await makeStore();
    const p = await store.savePlanting({ plantId: 'tomato', quantity: 2, startMethod: 'seedling', plantedDate: '2026-09-02', dateAccuracy: 'approx-week', stage: 'transplanted', stageIsManual: false });
    assert.equal(p.events[0].type, 'planted');
    await store.addEvent(p.id, 'first-flower', '2026-09-18', 'first flowers appeared');
    const saved = store.state.data.plantings.find((x) => x.id === p.id)!;
    assert.equal(saved.stage, 'flowering');
    assert.equal(saved.events.length, 2);
    const reloaded = await repo.load();
    assert.equal(reloaded.data.plantings[0].events.length, 2);
    await store.addEvent(p.id, 'failed', '2026-09-20');
    assert.equal(store.state.data.plantings[0].stageIsManual, true);
  });

  it('toggles the wish list and records task responses', async () => {
    const { store } = await makeStore();
    await store.toggleWish('garlic');
    assert.equal(store.isWished('garlic'), true);
    await store.toggleWish('garlic');
    assert.equal(store.isWished('garlic'), false);
    await store.respondToTask('inspect:2026-09-21', 'snoozed', '2026-09-26');
    assert.equal(store.state.data.taskResponses[0].status, 'snoozed');
    await store.respondToTask('inspect:2026-09-21', 'done');
    assert.equal(store.state.data.taskResponses.length, 1);
    assert.equal(store.state.data.taskResponses[0].status, 'done');
  });

  it('creates a succession plan and accepting a batch creates a real planting', async () => {
    const { store } = await makeStore();
    const { createdAt: _c, updatedAt: _u, id: _i, ...p } = profile();
    await store.saveProfile(p);
    const plan = await store.createSuccessionPlan('carrot', undefined, '2026-09-24', null);
    assert.ok(plan.batches.length >= 2);
    await store.acceptSuccessionBatch(plan.id, 0, '2026-09-24');
    const pl = store.state.data.plantings.find((x) => x.successionPlanId === plan.id)!;
    assert.equal(pl.plantId, 'carrot');
    const updated = store.state.data.successionPlans[0];
    assert.equal(updated.batches[0].status, 'accepted');
    assert.equal(updated.batches[0].plantingId, pl.id);
    await store.stopSuccession(plan.id);
    assert.equal(store.state.data.successionPlans[0].status, 'stopped');
  });

  it('refuses succession for crops that don\'t suit it, with the reason', async () => {
    const { store } = await makeStore();
    const { createdAt: _c, updatedAt: _u, id: _i, ...p } = profile();
    await store.saveProfile(p);
    await assert.rejects(store.createSuccessionPlan('lemon', undefined, '2026-09-24', null), /isn't usually succession planted/);
  });

  it('starts a Three Sisters planting with sequenced, planned later steps', async () => {
    const { store } = await makeStore();
    const { createdAt: _c, updatedAt: _u, id: _i, ...p } = profile();
    await store.saveProfile(p);
    await store.startThreeSisters({ startDate: '2026-09-24', mounds: 3, cornAlreadySown: true });
    const ps = store.state.data.plantings;
    const corn = ps.find((x) => x.plantId === 'sweet-corn')!;
    const beans = ps.find((x) => x.plantId === 'bean-climbing')!;
    const pumpkin = ps.find((x) => x.plantId === 'pumpkin')!;
    assert.equal(corn.stage, 'seed');
    assert.equal(corn.quantity, 18);
    assert.equal(beans.stage, 'planned');
    assert.ok(beans.plantedDate > corn.plantedDate);
    assert.match(beans.notes!, /15 cm/);
    assert.equal(pumpkin.system!.role, 'groundcover');
    await store.markStarted(beans.id, '2026-10-10');
    const b2 = store.state.data.plantings.find((x) => x.id === beans.id)!;
    assert.equal(b2.stage, 'seed');
    assert.equal(b2.plantedDate, '2026-10-10');
  });

  it('removing an area keeps plantings but unlinks them', async () => {
    const { store } = await makeStore();
    const a = await store.saveArea({ name: 'Bed', type: 'raised-bed', lengthM: 2, widthM: 1 });
    await store.savePlanting({ plantId: 'lettuce', quantity: 4, areaIds: [a.id], startMethod: 'seedling', plantedDate: '2026-09-20', dateAccuracy: 'exact', stage: 'transplanted', stageIsManual: false });
    await store.deleteArea(a.id);
    assert.equal(store.state.data.areas.length, 0);
    assert.equal(store.state.data.plantings[0].areaIds, undefined);
  });

  it('restores and deletes all data', async () => {
    const { store, kv } = await makeStore();
    const d = emptyGardenData();
    d.profile = profile({ householdSize: 6 });
    await store.restore(d);
    assert.equal(store.state.data.profile!.householdSize, 6);
    await store.deleteAllData();
    assert.equal(store.state.data.profile, null);
    assert.equal([...kv.map.keys()].filter((k) => k.startsWith('sbs:g')).length, 0);
  });
});
