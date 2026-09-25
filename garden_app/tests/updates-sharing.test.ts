/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CustomPlant } from '../src/domain/types';
import { customToPlantRecord } from '../src/domain/customPlants';
import { validateCustomPlant, validateSettings } from '../src/domain/validation';
import { submitSuggestion, suggestionIssue, suggestionPayload } from '../src/services/plants/plantSuggestions';
import { MemoryStore } from '../src/services/storage/keyValueStore';
import { AppUpdates, compareVersions, parseAppRelease, UPDATE_CHECK_INTERVAL_MS } from '../src/services/updates/appUpdates';
import { GardenRepository } from '../src/services/storage/gardenRepository';
import { WeatherService } from '../src/services/weather/weatherService';
import { GardenStore } from '../src/state/gardenStore';
import { NOW_ISO, profile } from './helpers';

const NOW = new Date(NOW_ISO);
const RELEASE = { version: '1.7.0', url: 'https://github.com/BearyNatural/claude/releases/tag/garden_app-v1.7.0-build20' };

describe('new version notice', () => {
  it('only offers newer releases with a link to this app\'s own release pages', () => {
    assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
    assert.deepEqual(parseAppRelease(RELEASE, '1.6.0')?.version, '1.7.0');
    assert.equal(parseAppRelease(RELEASE, '1.7.0'), null, 'same version');
    assert.equal(parseAppRelease(RELEASE, '1.8.0'), null, 'older');
    assert.equal(parseAppRelease({ ...RELEASE, url: 'https://evil.example/app.apk' }, '1.6.0'), null, 'links elsewhere are ignored');
    assert.equal(parseAppRelease({ version: 'latest', url: RELEASE.url }, '1.6.0'), null);
  });

  it('checks at most daily with the read-only token, and remembers what it found', async () => {
    let calls = 0;
    const kv = new MemoryStore();
    const svc = new AppUpdates(kv, '1.6.0', { now: () => NOW, token: 't', fetch: async () => { calls++; return { ok: true, status: 200, json: async () => RELEASE }; } });
    assert.equal((await svc.check())?.version, '1.7.0');
    assert.equal((await svc.check())?.version, '1.7.0');
    assert.equal(calls, 1);
    const noToken = new AppUpdates(new MemoryStore(), '1.6.0', { now: () => NOW, fetch: async () => { calls++; return { ok: true, status: 200, json: async () => RELEASE }; } });
    assert.equal(await noToken.check(true), null);
    assert.equal(calls, 1, 'no request without a token');
  });

  it('checks again after a day, or only after a week when set to weekly', async () => {
    let now = NOW;
    let calls = 0;
    const svc = new AppUpdates(new MemoryStore(), '1.6.0', { now: () => now, token: 't', fetch: async () => { calls++; return { ok: true, status: 200, json: async () => RELEASE }; } });
    await svc.check(false, UPDATE_CHECK_INTERVAL_MS.weekly);
    now = new Date(NOW.getTime() + 2 * 86_400_000);
    await svc.check(false, UPDATE_CHECK_INTERVAL_MS.weekly);
    assert.equal(calls, 1, 'weekly: not again after two days');
    await svc.check(false, UPDATE_CHECK_INTERVAL_MS.daily);
    assert.equal(calls, 2, 'daily: checks again after two days');
  });

  it('announces each new version by notification only once', async () => {
    const svc = new AppUpdates(new MemoryStore(), '1.6.0', { now: () => NOW, token: 't', fetch: async () => ({ ok: true, status: 200, json: async () => RELEASE }) });
    assert.equal(await svc.shouldNotify('1.7.0'), true);
    assert.equal(await svc.shouldNotify('1.7.0'), false);
    assert.equal(await svc.shouldNotify('1.8.0'), true);
  });
});

const PLANT: CustomPlant = {
  id: 'custom_abc',
  commonName: 'Lilly pilly',
  botanicalName: 'Syzygium australe',
  familyName: 'Myrtaceae',
  categories: ['native', 'tree'],
  lifecycle: 'perennial',
  startMethods: ['tree'],
  plantMonths: [9, 10],
  notes: 'Hedges well.',
  share: { status: 'pending' },
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
};

describe('sharing plants with the plant list (opt-in)', () => {
  it('sends only plant details, notes and the climate zone', () => {
    const p = suggestionPayload(PLANT, 'subtropical', '1.6.0');
    assert.deepEqual(Object.keys(p).sort(), ['appVersion', 'climateZone', 'formatVersion', 'kind', 'plant']);
    const sent = JSON.stringify(p);
    for (const notSent of ['custom_abc', 'share', 'createdAt', 'pending']) assert.ok(!sent.includes(notSent), notSent);
    const issue = suggestionIssue(PLANT, 'subtropical', '1.6.0');
    assert.match(issue.title, /Lilly pilly \(Syzygium australe\)/);
    assert.match(issue.body, /Unverified/);
    assert.deepEqual(issue.labels, ['plant-suggestion']);
  });

  it('files a suggestion with the token, and refuses without one', async () => {
    let sent: { url: string; auth?: string; body: string } | null = null;
    const ref = await submitSuggestion(PLANT, 'subtropical', {
      token: 'tok',
      appVersion: '1.6.0',
      fetch: async (url, init) => {
        sent = { url, auth: init.headers.Authorization, body: init.body };
        return { ok: true, status: 201, json: async () => ({ number: 42 }) };
      },
    });
    assert.equal(ref, 42);
    assert.match(sent!.url, /sow-by-season-plant-data\/issues$/);
    assert.equal(sent!.auth, 'Bearer tok');
    await assert.rejects(submitSuggestion(PLANT, null, { appVersion: '1', fetch: async () => ({ ok: true, status: 201, json: async () => ({}) }) }));
  });

  it('keeps an opted-in plant pending while offline and sends it later', async () => {
    let online = false;
    const sentNames: string[] = [];
    const kv = new MemoryStore();
    const store = new GardenStore(new GardenRepository(kv, () => NOW), new WeatherService(kv, { fetch: async () => { throw new Error('offline'); }, now: () => NOW }), () => NOW, undefined, null, null, async (c) => {
      if (!online) throw new Error('offline');
      sentNames.push(c.commonName);
      return 7;
    });
    await store.init();
    const { createdAt: _c, updatedAt: _u, id: _i, ...p } = profile();
    await store.saveProfile(p);
    const { id: _id, createdAt: _cr, updatedAt: _up, ...input } = PLANT;
    const saved = await store.saveCustomPlant(input);
    await store.sendPendingShares();
    assert.equal(store.state.data.customPlants[0].share?.status, 'pending');
    online = true;
    await store.sendPendingShares();
    const after = store.state.data.customPlants.find((c) => c.id === saved.id)!;
    assert.deepEqual([after.share?.status, after.share?.ref], ['shared', 7]);
    assert.deepEqual(sentNames, ['Lilly pilly']);
    await store.sendPendingShares();
    assert.equal(sentNames.length, 1, 'sent once only');
    assert.ok(validateCustomPlant(after).ok, 'share status is stored validly');
  });

  it('says why a share failed when the plant list inbox refuses it, and keeps it valid', async () => {
    const kv = new MemoryStore();
    const refuse = () => submitSuggestion(PLANT, 'subtropical', { fetch: async () => ({ ok: false, status: 403, json: async () => ({}) }), token: 't', appVersion: 'test' });
    const store = new GardenStore(new GardenRepository(kv, () => NOW), new WeatherService(kv, { fetch: async () => { throw new Error('offline'); }, now: () => NOW }), () => NOW, undefined, null, null, () => refuse());
    await store.init();
    const { id: _id, createdAt: _cr, updatedAt: _up, ...input } = PLANT;
    await store.saveCustomPlant(input);
    await store.sendPendingShares();
    const c = store.state.data.customPlants[0];
    assert.equal(c.share?.status, 'pending');
    assert.match(c.share?.lastError ?? '', /isn't allowed to share/);
    assert.ok(validateCustomPlant(c).ok);
  });

  it('keeps unanswered details of your own plants unknown instead of guessing', () => {
    const { lifecycle: _l, sun: _s, support: _su, ...rest } = PLANT;
    const plain = { ...rest, startMethods: [], plantMonths: [9, 10] } as CustomPlant;
    const v = validateCustomPlant(plain);
    assert.ok(v.ok);
    if (!v.ok) return;
    assert.equal(v.value.lifecycle, undefined);
    const rec = customToPlantRecord(v.value);
    assert.equal(rec.site.minSunHours, undefined, 'no sun warnings from a guess');
    assert.ok(rec.windows.subtropical?.plant && !rec.windows.subtropical.sow, 'months without a start method count as planting, not sowing');
  });

  it('remembers the gardener\'s defaults for photo backups and sharing', () => {
    const v = validateSettings({ id: 'settings', weatherEnabled: true, hiddenPlantIds: [], backupPhotos: false, sharePlants: true });
    assert.ok(v.ok && v.value.backupPhotos === false && v.value.sharePlants === true);
  });

  it('never shares a plant that wasn\'t opted in', async () => {
    let calls = 0;
    const kv = new MemoryStore();
    const store = new GardenStore(new GardenRepository(kv, () => NOW), new WeatherService(kv, { fetch: async () => { throw new Error('offline'); }, now: () => NOW }), () => NOW, undefined, null, null, async () => { calls++; return 1; });
    await store.init();
    const { id: _id, createdAt: _cr, updatedAt: _up, share: _s, ...input } = PLANT;
    await store.saveCustomPlant(input);
    await store.sendPendingShares();
    assert.equal(calls, 0);
  });
});
