/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backupFileName, createBackup, CURRENT_SCHEMA_VERSION, fnv1a, serialiseBackup, stableStringify } from '../src/domain/backup/format';
import { parseBackup } from '../src/domain/backup/restore';
import { emptyGardenData, type GardenData } from '../src/domain/types';
import { GardenRepository } from '../src/services/storage/gardenRepository';
import { MemoryStore } from '../src/services/storage/keyValueStore';
import { buildForecastUrl, parseForecast } from '../src/services/weather/openMeteo';
import { WeatherService } from '../src/services/weather/weatherService';
import { area, NOW_ISO, planting, profile } from './helpers';

function sampleData(): GardenData {
  const d = emptyGardenData();
  const bed = area({ id: 'bed1' });
  d.profile = profile();
  d.areas = [bed];
  d.plantings = [
    planting({ id: 'p1', plantId: 'tomato', areaIds: ['bed1'], startMethod: 'seedling', plantedDate: '2026-09-02', dateAccuracy: 'approx-week', events: [{ id: 'e1', type: 'transplanted', date: '2026-09-02' }] }),
    planting({ id: 'p2', plantId: 'carrot', areaIds: ['bed1'] }),
  ];
  d.journal = [{ id: 'j1', date: '2026-09-18', text: 'first flowers appeared', plantingId: 'p1', createdAt: NOW_ISO }];
  d.wishlist = [{ id: 'w1', plantId: 'garlic', addedAt: NOW_ISO }];
  d.successionPlans = [
    { id: 's1', plantId: 'carrot', intervalDays: 21, defaultBatchQuantity: 20, status: 'active', batches: [{ index: 0, plannedDate: '2026-09-24', quantity: 20, status: 'planned' }], notes: [], createdAt: NOW_ISO, updatedAt: NOW_ISO },
  ];
  d.taskResponses = [{ taskId: 'thin:p2', status: 'done', at: NOW_ISO }];
  d.observations = [{ id: 'o1', kind: 'soil-moisture', value: 23, unit: '%', at: NOW_ISO, source: 'sensor', deviceId: 'probe-1', areaId: 'bed1' }];
  return d;
}

const backupText = (d = sampleData()) => serialiseBackup(createBackup(d, { now: new Date(NOW_ISO), appVersion: '1.0.0', catalogueVersion: '2026.09.1' }));

describe('backup format', () => {
  it('uses a clear, dated filename', () => {
    assert.equal(backupFileName('2026-09-24'), 'SowBySeason-Backup-2026-09-24.json');
  });

  it('round-trips all user data', () => {
    const d = sampleData();
    const r = parseBackup(backupText(d));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.data, d);
    assert.deepEqual(r.skipped, []);
    assert.equal(r.counts.plantings, 2);
  });

  it('does not include the static plant catalogue or weather', () => {
    const text = backupText();
    assert.doesNotMatch(text, /botanicalName|daysToMaturity|temperature_2m/);
    assert.ok(text.includes(`"schemaVersion": ${CURRENT_SCHEMA_VERSION}`));
    assert.match(text, /"format": "sow-by-season-backup"/);
  });

  it('computes a stable checksum regardless of key order', () => {
    assert.equal(fnv1a(stableStringify({ a: 1, b: [1, 2] })), fnv1a(stableStringify({ b: [1, 2], a: 1 })));
  });
});

describe('restore safety', () => {
  it('rejects empty, non-JSON and truncated files', () => {
    assert.equal((parseBackup('') as { code: string }).code, 'empty');
    assert.equal((parseBackup('hello') as { code: string }).code, 'not-json');
    const text = backupText();
    assert.equal((parseBackup(text.slice(0, text.length / 2)) as { code: string }).code, 'not-json');
  });

  it('rejects files that are not Sow by Season backups', () => {
    assert.equal((parseBackup('{"format":"something-else","schemaVersion":2,"data":{}}') as { code: string }).code, 'not-sow-by-season');
    assert.equal((parseBackup('[1,2,3]') as { code: string }).code, 'not-sow-by-season');
  });

  it('rejects backups from newer app versions and unknown versions', () => {
    const doc = JSON.parse(backupText());
    assert.equal((parseBackup(JSON.stringify({ ...doc, schemaVersion: 99 })) as { code: string }).code, 'too-new');
    assert.equal((parseBackup(JSON.stringify({ ...doc, schemaVersion: '2' })) as { code: string }).code, 'bad-version');
    assert.equal((parseBackup(JSON.stringify({ ...doc, schemaVersion: 0 })) as { code: string }).code, 'too-old');
  });

  it('detects edited or damaged data via the checksum', () => {
    const doc = JSON.parse(backupText());
    doc.data.plantings[0].quantity = 999;
    const r = parseBackup(JSON.stringify(doc));
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, 'corrupt');
  });

  it('skips individual bad records with a clear warning instead of failing the whole garden', () => {
    const d = sampleData() as unknown as { plantings: unknown[] };
    d.plantings.push({ id: 'bad', plantId: 'tomato', quantity: 'lots' });
    const doc = createBackup(d as unknown as GardenData, { now: new Date(NOW_ISO), appVersion: '1.0.0' });
    const r = parseBackup(JSON.stringify(doc));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.data.plantings.length, 2);
    assert.equal(r.skipped.length, 1);
    assert.match(r.skipped[0].reason, /quantity/);
    assert.ok(r.warnings.some((w) => /could not be read/.test(w)));
  });

  it('clears dangling area references rather than failing', () => {
    const d = sampleData();
    d.areas = [];
    const r = parseBackup(backupText(d));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.data.plantings[0].areaIds, undefined);
      assert.ok(r.warnings.some((w) => /garden area/.test(w)));
    }
  });

  it('migrates schema v1 backups', () => {
    const v1 = {
      format: 'sow-by-season-backup',
      schemaVersion: 1,
      createdAt: '2026-05-01T00:00:00Z',
      data: {
        profile: {
          id: 'profile',
          location: { suburb: 'Hobart', state: 'TAS', postcode: '7000', timezone: 'Australia/Hobart', climateZone: 'cool-temperate' },
          household: 2,
          hoursPerWeek: 3,
          goals: ['herbs'],
          reminders: { enabled: false, gardeningDays: [0], reminderTime: '09:00', quietDays: [], mode: 'weekly' },
          onboardingComplete: true,
          createdAt: '2026-05-01T00:00:00Z',
          updatedAt: '2026-05-01T00:00:00Z',
        },
        plantings: [{ id: 'x1', plantId: 'garlic', quantity: 30, startMethod: 'clove-or-bulb', datePlanted: '2026-04-10', stage: 'established', createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' }],
      },
    };
    const r = parseBackup(JSON.stringify(v1));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.migratedFrom, 1);
    assert.deepEqual(r.migrations, Array.from({ length: CURRENT_SCHEMA_VERSION - 1 }, (_, i) => `v${i + 1} → v${i + 2}`));
    assert.equal(r.data.profile!.location.overrideZone, 'cool-temperate');
    assert.equal(r.data.profile!.householdSize, 2);
    assert.equal(r.data.profile!.timeBudget, '2to4');
    assert.equal(r.data.plantings[0].plantedDate, '2026-04-10');
    assert.equal(r.data.plantings[0].dateAccuracy, 'exact');
  });

  it('refuses a backup with nothing readable in it', () => {
    const r = parseBackup(JSON.stringify({ format: 'sow-by-season-backup', schemaVersion: 1, data: { plantings: 'nope' } }));
    assert.equal(r.ok, false);
  });
});

describe('local storage resilience', () => {
  it('saves and loads a garden', async () => {
    const repo = new GardenRepository(new MemoryStore());
    const d = sampleData();
    await repo.saveProfile(d.profile!);
    for (const a of d.areas) await repo.put('areas', a);
    for (const p of d.plantings) await repo.put('plantings', p);
    await repo.put('taskResponses', d.taskResponses[0]);
    const { data, problems } = await repo.load();
    assert.deepEqual(problems, []);
    assert.equal(data.plantings.length, 2);
    assert.equal(data.taskResponses[0].taskId, 'thin:p2');
    assert.equal(data.profile!.householdSize, 3);
  });

  it('refuses to save invalid records', async () => {
    const repo = new GardenRepository(new MemoryStore());
    await assert.rejects(repo.put('plantings', { ...sampleData().plantings[0], plantedDate: '24/09/2026' }), /Not saved/);
  });

  it('quarantines a corrupt record without losing the rest of the garden', async () => {
    const store = new MemoryStore();
    const repo = new GardenRepository(store);
    for (const p of sampleData().plantings) await repo.put('plantings', p);
    await store.setItem('sbs:g1:plantings:broken', '{not json');
    await store.setItem('sbs:g1:plantings:invalid', JSON.stringify({ v: 2, d: { id: 'invalid' } }));
    const fresh = new GardenRepository(store);
    const { data, problems } = await fresh.load();
    assert.equal(data.plantings.length, 2);
    assert.equal(problems.length, 2);
    assert.equal(await fresh.quarantineCount(), 2);
    // The raw data is kept aside, not destroyed.
    const kept = [...store.map.entries()].filter(([k]) => k.startsWith('sbs:quarantine:')).map(([, v]) => v);
    assert.ok(kept.includes('{not json'));
  });

  it('restores atomically: all-or-nothing', async () => {
    const store = new MemoryStore();
    const repo = new GardenRepository(store);
    const original = sampleData();
    await repo.replaceAll(original);
    const replacement = emptyGardenData();
    replacement.profile = profile({ householdSize: 5 });
    replacement.plantings = Array.from({ length: 5 }, (_, i) => planting({ id: `n${i}`, plantId: 'radish' }));

    store.failAfterWrites = 3; // fail part-way through writing the new generation
    await assert.rejects(repo.replaceAll(replacement));
    store.failAfterWrites = null;
    const afterFail = await new GardenRepository(store).load();
    assert.equal(afterFail.data.profile!.householdSize, 3, 'original data untouched');
    assert.equal(afterFail.data.plantings.length, 2);
    assert.equal([...store.map.keys()].filter((k) => k.startsWith('sbs:g3:')).length, 0, 'partial generation removed');

    await repo.replaceAll(replacement);
    const after = await new GardenRepository(store).load();
    assert.equal(after.data.profile!.householdSize, 5);
    assert.equal(after.data.plantings.length, 5);
    assert.equal(after.data.areas.length, 0);
  });

  it('validates the whole restore before writing anything', async () => {
    const store = new MemoryStore();
    const repo = new GardenRepository(store);
    await repo.replaceAll(sampleData());
    const before = new Map(store.map);
    const bad = sampleData();
    (bad.plantings[0] as { quantity: unknown }).quantity = -5;
    await assert.rejects(repo.replaceAll(bad), /Restore aborted/);
    assert.deepEqual(store.map, before);
  });

  it('cleans up generations left by an interrupted restore', async () => {
    const store = new MemoryStore();
    const repo = new GardenRepository(store);
    await repo.replaceAll(sampleData());
    await store.setItem('sbs:g9:plantings:ghost', JSON.stringify({ v: 2, d: {} }));
    await new GardenRepository(store).load();
    assert.equal(store.map.has('sbs:g9:plantings:ghost'), false);
  });

  it('can delete everything', async () => {
    const store = new MemoryStore();
    const repo = new GardenRepository(store);
    await repo.replaceAll(sampleData());
    await store.setItem('sbs:cache:weather', '{}');
    await store.setItem('other-app-key', 'keep');
    await repo.deleteEverything();
    assert.deepEqual([...store.map.keys()], ['other-app-key']);
  });
});

describe('weather service', () => {
  const sample = {
    current: { temperature_2m: 22.4 },
    daily: {
      time: ['2026-09-24', '2026-09-25'],
      temperature_2m_max: [27, 31],
      temperature_2m_min: [15, 1],
      precipitation_sum: [0, 30],
      precipitation_probability_max: [5, 90],
    },
    hourly: {
      time: Array.from({ length: 48 }, (_, i) => `2026-09-${24 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`),
      soil_temperature_6cm: Array.from({ length: 48 }, (_, i) => (i < 24 ? 18 : null)),
    },
  };

  it('builds a request with rounded coordinates and the local timezone', () => {
    const url = buildForecastUrl(-27.471234, 153.02345, 'Australia/Brisbane');
    assert.match(url, /latitude=-27\.47&longitude=153\.02/);
    assert.match(url, /timezone=Australia%2FBrisbane/);
    assert.match(url, /soil_temperature_6cm/);
    assert.match(buildForecastUrl(-27, 153, 'Australia/Brisbane', { apiKey: 'k' }), /customer-api.*apikey=k/);
  });

  it('parses forecasts and labels soil temperature as modelled, dropping incomplete days', () => {
    const s = parseForecast(sample, new Date(NOW_ISO), -27.47, 153.03, 'Australia/Brisbane');
    assert.equal(s.fetchedAt, NOW_ISO);
    assert.equal(s.daily.length, 2);
    assert.equal(s.daily[1].minC, 1);
    assert.equal(s.soil!.kind, 'modelled');
    assert.deepEqual(s.soil!.days, [{ date: '2026-09-24', meanC: 18 }]);
    assert.equal(s.current!.temperatureC, 22.4);
  });

  it('rejects unusable responses', () => {
    assert.throws(() => parseForecast({}, new Date(), 0, 0, 'x'), /no daily forecast/);
    assert.throws(() => parseForecast(null, new Date(), 0, 0, 'x'));
  });

  it('serves cached weather with an error message when offline', async () => {
    const store = new MemoryStore();
    let online = true;
    let calls = 0;
    const fetch = async () => {
      calls++;
      if (!online) throw new Error('Network request failed');
      return { ok: true, status: 200, json: async () => sample };
    };
    let now = new Date(NOW_ISO);
    const svc = new WeatherService(store, { fetch, now: () => now });
    const first = await svc.get(-27.47, 153.03, 'Australia/Brisbane');
    assert.equal(first.fromCache, false);
    // Within an hour the cache is reused without a network call.
    now = new Date(Date.parse(NOW_ISO) + 30 * 60_000);
    await svc.get(-27.47, 153.03, 'Australia/Brisbane');
    assert.equal(calls, 1);
    online = false;
    now = new Date(Date.parse(NOW_ISO) + 5 * 3_600_000);
    const off = await svc.get(-27.47, 153.03, 'Australia/Brisbane');
    assert.equal(off.fromCache, true);
    assert.match(off.error!, /offline/);
    assert.equal(off.snapshot!.fetchedAt, NOW_ISO, 'keeps the original timestamp so it is shown as stale');
  });

  it('reports HTTP errors and does not reuse weather for a different location', async () => {
    const store = new MemoryStore();
    const svc = new WeatherService(store, { fetch: async () => ({ ok: true, status: 200, json: async () => sample }), now: () => new Date(NOW_ISO) });
    await svc.get(-27.47, 153.03, 'Australia/Brisbane');
    const broken = new WeatherService(store, { fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }), now: () => new Date(NOW_ISO) });
    const r = await broken.get(-42.88, 147.33, 'Australia/Hobart');
    assert.equal(r.snapshot, null);
    assert.match(r.error!, /503/);
  });
});
