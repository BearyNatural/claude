/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBackup, CURRENT_SCHEMA_VERSION, serialiseBackup } from '../src/domain/backup/format';
import { parseBackup } from '../src/domain/backup/restore';
import { DELETION_DAYS, mergeGardenData } from '../src/domain/sync';
import { emptyGardenData, type GardenData } from '../src/domain/types';
import { GardenRepository } from '../src/services/storage/gardenRepository';
import { MemoryStore } from '../src/services/storage/keyValueStore';
import { WeatherService } from '../src/services/weather/weatherService';
import { GardenStore } from '../src/state/gardenStore';
import { area, NOW_ISO, planting, profile } from './helpers';

const NOW = new Date(NOW_ISO);
const T1 = '2026-09-20T00:00:00.000Z';
const T2 = '2026-09-21T00:00:00.000Z';
const T3 = '2026-09-22T00:00:00.000Z';

function garden(patch: Partial<GardenData> = {}): GardenData {
  return { ...emptyGardenData(), profile: profile(), ...patch };
}

describe('syncing a garden between devices', () => {
  it('keeps what was added on either device', () => {
    const phone = garden({ areas: [area({ id: 'bed', updatedAt: T1 })] });
    const computer = garden({ plantings: [planting({ id: 'tom', plantId: 'tomato', updatedAt: T2 })] });
    const { data, summary } = mergeGardenData(phone, computer, NOW);
    assert.deepEqual(data.areas.map((a) => a.id), ['bed']);
    assert.deepEqual(data.plantings.map((p) => p.id), ['tom']);
    assert.equal(summary.fromRemote, 1);
    assert.equal(summary.remoteNeedsUpdate, true, 'the computer is missing the bed');
  });

  it('takes the most recent change when both devices changed the same record', () => {
    const phone = garden({ areas: [area({ id: 'bed', name: 'Old name', updatedAt: T1 })] });
    const computer = garden({ areas: [area({ id: 'bed', name: 'New name', updatedAt: T2 })] });
    assert.equal(mergeGardenData(phone, computer, NOW).data.areas[0].name, 'New name');
    assert.equal(mergeGardenData(computer, phone, NOW).data.areas[0].name, 'New name');
  });

  it('removes a record deleted on the other device instead of bringing it back', () => {
    const phone = garden({ plantings: [planting({ id: 'tom', plantId: 'tomato', updatedAt: T1 })] });
    const computer = garden({ deletions: [{ id: 'plantings:tom', collection: 'plantings', recordId: 'tom', at: T2 }] });
    const { data, summary } = mergeGardenData(phone, computer, NOW);
    assert.equal(data.plantings.length, 0);
    assert.equal(summary.deletedHere, 1);
    assert.equal(data.deletions.length, 1, 'the deletion is kept so other devices learn about it');
  });

  it('keeps a record that was changed after it was deleted elsewhere', () => {
    const phone = garden({ plantings: [planting({ id: 'tom', plantId: 'tomato', updatedAt: T3 })] });
    const computer = garden({ deletions: [{ id: 'plantings:tom', collection: 'plantings', recordId: 'tom', at: T2 }] });
    assert.equal(mergeGardenData(phone, computer, NOW).data.plantings.length, 1);
  });

  it('follows the newest shared settings but keeps this device\'s own', () => {
    const phone = garden({ settings: { ...emptyGardenData().settings, weatherEnabled: true, activeGardenId: 'plot', updatedAt: T1 } });
    const computer = garden({ settings: { ...emptyGardenData().settings, weatherEnabled: false, activeGardenId: undefined, updatedAt: T2 } });
    const s = mergeGardenData(phone, computer, NOW).data.settings;
    assert.equal(s.weatherEnabled, false);
    assert.equal(s.activeGardenId, 'plot', 'which garden is shown stays per device');
  });

  it('keeps one wish-list entry when the same plant was wished for on both devices', () => {
    const phone = garden({ wishlist: [{ id: 'w1', plantId: 'garlic', addedAt: T1 }] });
    const computer = garden({ wishlist: [{ id: 'w2', plantId: 'garlic', addedAt: T2 }] });
    assert.deepEqual(mergeGardenData(phone, computer, NOW).data.wishlist.map((w) => w.id), ['w1']);
  });

  it('forgets deletions once every device has had time to sync', () => {
    const old = new Date(NOW.getTime() - (DELETION_DAYS + 1) * 86_400_000).toISOString();
    const phone = garden({ deletions: [{ id: 'journal:j1', collection: 'journal', recordId: 'j1', at: old }] });
    assert.equal(mergeGardenData(phone, garden(), NOW).data.deletions.length, 0);
  });

  it('changes nothing when both sides already match', () => {
    const g = garden({ areas: [area({ id: 'bed', updatedAt: T1 })], deletions: [{ id: 'journal:j1', collection: 'journal', recordId: 'j1', at: T2 }] });
    const first = mergeGardenData(g, g, NOW);
    assert.deepEqual(first.summary, { fromRemote: 0, deletedHere: 0, remoteNeedsUpdate: false });
  });

  it('records deletions as they happen and carries them in backups', async () => {
    const kv = new MemoryStore();
    const store = new GardenStore(new GardenRepository(kv, () => NOW), new WeatherService(kv, { fetch: async () => { throw new Error('offline'); }, now: () => NOW }), () => NOW);
    await store.init();
    const { createdAt: _c, updatedAt: _u, id: _i, ...p } = profile();
    await store.saveProfile(p);
    const bed = await store.saveArea({ name: 'Bed', type: 'raised-bed' } as never);
    await store.deleteArea(bed.id);
    assert.deepEqual(store.state.data.deletions.map((d) => d.id), [`areas:${bed.id}`]);
    const text = serialiseBackup(createBackup(store.exportData(), { now: NOW, appVersion: 'test' }));
    const parsed = parseBackup(text);
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal(parsed.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(parsed.data.deletions.length, 1);
    const reloaded = await new GardenRepository(kv, () => NOW).load();
    assert.equal(reloaded.data.deletions.length, 1, 'deletions are saved on the device too');
  });

  it('timestamps shared settings for sync, but not device-only ones', async () => {
    const kv = new MemoryStore();
    const store = new GardenStore(new GardenRepository(kv, () => NOW), new WeatherService(kv, { fetch: async () => { throw new Error('offline'); }, now: () => NOW }), () => NOW);
    await store.init();
    await store.saveSettings({ lastBackupAt: NOW_ISO });
    assert.equal(store.state.data.settings.updatedAt, undefined);
    await store.saveSettings({ weatherEnabled: false });
    assert.equal(store.state.data.settings.updatedAt, NOW_ISO);
  });
});
