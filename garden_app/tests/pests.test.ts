/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FERTILISER_PROFILES, fertiliserProfileFor, MAPPED_PLANT_IDS } from '../src/data/fertilisers';
import { PLANT_PROBLEMS } from '../src/data/pests';
import { PLANTS } from '../src/data/plants';
import { SOURCES } from '../src/data/sources';
import { createBackup, CURRENT_SCHEMA_VERSION, serialiseBackup } from '../src/domain/backup/format';
import { parseBackup } from '../src/domain/backup/restore';
import { customToPlantRecord } from '../src/domain/customPlants';
import { addDays } from '../src/domain/dates';
import { problemsFor, remedyPlan, searchProblems } from '../src/domain/pests';
import { mergeGardenData } from '../src/domain/sync';
import { generateTasks } from '../src/domain/tasks';
import { emptyGardenData, photoFilesIn, type PestReport } from '../src/domain/types';
import { GardenRepository } from '../src/services/storage/gardenRepository';
import { MemoryStore } from '../src/services/storage/keyValueStore';
import { WeatherService } from '../src/services/weather/weatherService';
import { GardenStore } from '../src/state/gardenStore';
import { getPlant, noWeather, NOW_ISO, planting } from './helpers';

const NOW = new Date(NOW_ISO);
const today = NOW_ISO.slice(0, 10);
const plant = (id: string) => PLANTS.find((p) => p.id === id)!;

describe('pest & problem guide', () => {
  it('cites a known source for every problem and remedy', () => {
    for (const p of PLANT_PROBLEMS) {
      for (const id of [...p.sourceIds, ...p.remedies.flatMap((r) => r.sourceIds)]) assert.ok(SOURCES[id], `${p.id} cites unknown source ${id}`);
      assert.ok(p.remedies.length > 0, `${p.id} has remedies`);
    }
    assert.equal(new Set(PLANT_PROBLEMS.map((p) => p.id)).size, PLANT_PROBLEMS.length, 'ids are unique');
  });

  it('always puts natural steps first and any chemical last', () => {
    for (const p of PLANT_PROBLEMS) {
      const plan = remedyPlan(p);
      assert.notEqual(plan[0].step, 'chemical', `${p.id} starts with a chemical`);
      const firstChem = plan.findIndex((r) => r.step === 'chemical');
      if (firstChem >= 0) assert.ok(plan.slice(firstChem).every((r) => r.step === 'chemical'), `${p.id}: nothing comes after the chemical step`);
      for (const r of plan.filter((x) => x.step === 'chemical')) assert.doesNotMatch(r.text, /®|™/, 'no brand names');
    }
  });

  it('suggests the problems each plant actually gets', () => {
    const tomato = problemsFor(plant('tomato'), PLANT_PROBLEMS).map((p) => p.id);
    for (const id of ['blossom-end-rot', 'tomato-grub', 'early-blight', 'fruit-fly']) assert.ok(tomato.includes(id), `tomato: ${id}`);
    const cabbage = problemsFor(plant('cabbage'), PLANT_PROBLEMS).map((p) => p.id);
    assert.ok(cabbage.includes('cabbage-white-butterfly') && cabbage.includes('diamondback-moth'));
    assert.ok(!cabbage.includes('blossom-end-rot'));
    assert.equal(problemsFor(plant('tomato'), PLANT_PROBLEMS)[0].affects.plantIds?.includes('tomato'), true, 'plant-specific problems come first');
    assert.deepEqual(searchProblems('white powder', PLANT_PROBLEMS).map((p) => p.id), ['powdery-mildew']);
  });
});

describe('what fertiliser to use', () => {
  it('gives every catalogue plant a fertiliser profile with sources', () => {
    for (const p of PLANTS) {
      assert.ok(MAPPED_PLANT_IDS.includes(p.id), `${p.id} has an explicit profile`);
      assert.ok(p.fertiliser && FERTILISER_PROFILES[p.fertiliser.profile as keyof typeof FERTILISER_PROFILES], `${p.id} carries its profile`);
    }
    for (const f of Object.values(FERTILISER_PROFILES)) for (const id of f.sourceIds) assert.ok(SOURCES[id], `${f.id} cites ${id}`);
  });

  it('matches the advice to the kind of plant', () => {
    assert.equal(fertiliserProfileFor(plant('tomato')).id, 'fruiting');
    assert.equal(fertiliserProfileFor(plant('carrot')).id, 'root');
    assert.match(fertiliserProfileFor(plant('carrot')).avoid ?? '', /blood and bone/i);
    assert.equal(fertiliserProfileFor(plant('pea')).id, 'legume');
    assert.equal(fertiliserProfileFor(plant('lettuce')).id, 'leafy');
    assert.equal(fertiliserProfileFor(plant('lemon')).id, 'citrus');
    assert.equal(fertiliserProfileFor(plant('blueberry')).id, 'acid');
  });

  it('falls back sensibly for your own plants', () => {
    const base = { id: 'custom_x', commonName: 'X', categories: [] as never[], startMethods: [], createdAt: NOW_ISO, updatedAt: NOW_ISO };
    assert.equal(fertiliserProfileFor(customToPlantRecord({ ...base, categories: ['native', 'flower'] } as never)).id, 'native');
    assert.equal(fertiliserProfileFor(customToPlantRecord({ ...base, familyName: 'Fabaceae', categories: ['vegetable'] } as never)).id, 'legume');
    assert.equal(fertiliserProfileFor(customToPlantRecord({ ...base, categories: ['fruit', 'tree'] } as never)).id, 'fruit-tree');
  });

  it('says what to use in the "Feed" job', () => {
    const p = planting({ id: 'tom', plantId: 'tomato', plantedDate: addDays(today, -40), stage: 'flowering' });
    const tasks = generateTasks({ today, zone: 'subtropical', weather: noWeather(today), areas: [], plantings: [p], journal: [], successionPlans: [], wishlist: [], responses: [], getPlant });
    const feed = tasks.find((t) => t.kind === 'feed');
    assert.ok(feed, 'a feed job is due');
    assert.match(feed!.detail ?? '', /potassium/i);
  });
});

describe('pest log', () => {
  function store() {
    const kv = new MemoryStore();
    const s = new GardenStore(new GardenRepository(kv, () => NOW), new WeatherService(kv, { fetch: async () => { throw new Error('offline'); }, now: () => NOW }), () => NOW);
    return { s, kv };
  }

  it('reminds you to check again, once, and Done ends it', () => {
    const report: PestReport = { id: 'pr1', plantingId: 'tom', problemId: 'aphids', seenOn: today, amount: 'lots', createdAt: NOW_ISO, updatedAt: NOW_ISO };
    const p = planting({ id: 'tom', plantId: 'tomato' });
    const ctx = { today: addDays(today, 5), zone: 'subtropical' as const, weather: noWeather(today), areas: [], plantings: [p], journal: [], successionPlans: [], wishlist: [], getPlant, pestReports: [report], problems: PLANT_PROBLEMS };
    const check = generateTasks({ ...ctx, responses: [] }).find((t) => t.kind === 'pest-check');
    assert.ok(check);
    assert.match(check!.title, /aphids on the tomato/i);
    assert.equal(check!.priority, 'important');
    const after = generateTasks({ ...ctx, responses: [{ taskId: check!.id, status: 'done', at: NOW_ISO }] });
    assert.ok(!after.some((t) => t.kind === 'pest-check'));
    const muchLater = generateTasks({ ...ctx, today: addDays(today, 90), responses: [] });
    assert.ok(!muchLater.some((t) => t.kind === 'pest-check'), 'old reports stop prompting');
  });

  it('saves reports with photos into backups, sync and deletions', async () => {
    const { s, kv } = store();
    await s.init();
    const saved = await s.savePestReport({ problemId: 'other', otherName: 'possum damage', seenOn: today, amount: 'some' });
    await s.addPestPhotos(saved.id, [{ uri: 'file://x.jpg' }]);
    const withPhoto = s.state.data.pestReports[0];
    assert.equal(withPhoto.photos?.length, 1);
    assert.deepEqual(photoFilesIn(s.state.data), [withPhoto.photos![0].file]);

    const text = serialiseBackup(createBackup(s.exportData(), { now: NOW, appVersion: 'test' }));
    const parsed = parseBackup(text);
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal(parsed.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(parsed.data.pestReports[0].otherName, 'possum damage');
    assert.equal((await new GardenRepository(kv, () => NOW).load()).data.pestReports.length, 1);

    const merged = mergeGardenData(emptyGardenData(), s.exportData(), NOW);
    assert.equal(merged.data.pestReports.length, 1, 'pest reports sync between devices');

    await s.deletePestReport(saved.id);
    assert.equal(s.state.data.pestReports.length, 0);
    assert.ok(s.state.data.deletions.some((d) => d.id === `pestReports:${saved.id}`));
  });

  it('refuses a "something else" report without saying what it is', async () => {
    const { s } = store();
    await s.init();
    await assert.rejects(() => s.savePestReport({ problemId: 'other', seenOn: today }));
  });
});
