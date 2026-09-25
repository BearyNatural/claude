/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBackup, serialiseBackup } from '../src/domain/backup/format';
import { parseBackup } from '../src/domain/backup/restore';
import { validatePlanting } from '../src/domain/validation';
import { memoryPhotoFiles } from '../src/services/photos/photoFiles';
import { GardenRepository } from '../src/services/storage/gardenRepository';
import { MemoryStore } from '../src/services/storage/keyValueStore';
import { WeatherService } from '../src/services/weather/weatherService';
import { GardenStore } from '../src/state/gardenStore';
import { NOW_ISO, planting } from './helpers';

const NOW = new Date(NOW_ISO);

async function makeStore() {
  const kv = new MemoryStore();
  const files = memoryPhotoFiles();
  const store = new GardenStore(new GardenRepository(kv, () => NOW), new WeatherService(kv, { fetch: async () => { throw new Error('offline'); }, now: () => NOW }), () => NOW, files);
  await store.init();
  const p = await store.savePlanting({ plantId: 'rosemary', quantity: 1, startMethod: 'seedling', plantedDate: '2026-09-20', dateAccuracy: 'exact', stage: 'transplanted', stageIsManual: false });
  return { store, files, id: p.id };
}

describe('plant photos', () => {
  it('only accepts photo file names the app itself creates', () => {
    const ok = validatePlanting(planting({ plantId: 'fig', photos: [{ id: 'x1', file: 'ph_abc123.jpg', takenAt: NOW_ISO }] }));
    assert.ok(ok.ok);
    for (const bad of ['../secret.jpg', 'ph/abc.jpg', 'notes.txt', '']) {
      assert.equal(validatePlanting(planting({ plantId: 'fig', photos: [{ id: 'x1', file: bad, takenAt: NOW_ISO }] })).ok, false, bad);
    }
  });

  it('adds, captions and removes photos, deleting the file with it', async () => {
    const { store, files, id } = await makeStore();
    await store.addPhotos(id, [{ uri: 'file:///picked/1.jpg', width: 4000, height: 3000 }, { uri: 'file:///picked/2.jpg' }]);
    let p = store.state.data.plantings.find((x) => x.id === id)!;
    assert.equal(p.photos?.length, 2);
    assert.equal(files.files.size, 2);
    await store.setPhotoCaption(id, p.photos![0].id, '  New growth  ');
    p = store.state.data.plantings.find((x) => x.id === id)!;
    assert.equal(p.photos![0].caption, 'New growth');
    await store.removePhoto(id, p.photos![0].id);
    p = store.state.data.plantings.find((x) => x.id === id)!;
    assert.equal(p.photos?.length, 1);
    assert.equal(files.files.size, 1);
  });

  it('deletes a planting\'s photo files when the planting is deleted', async () => {
    const { store, files, id } = await makeStore();
    await store.addPhotos(id, [{ uri: 'a' }, { uri: 'b' }]);
    await store.deletePlanting(id);
    assert.equal(files.files.size, 0);
  });
});

describe('backups with photos', () => {
  it('includes photos when asked, and restores them onto the phone', async () => {
    const { store, id } = await makeStore();
    await store.addPhotos(id, [{ uri: 'a' }]);
    const photos = await store.photoFilesForBackup();
    const text = serialiseBackup(createBackup(store.exportData(), { now: NOW, appVersion: 'test', photos }));
    const r = parseBackup(text);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.counts.photos, 1);
    assert.ok(!r.warnings.some((w) => /photo/i.test(w)), r.warnings.join('; '));

    const target = await makeStore();
    target.files.writeBase64('ph_stale.jpg', 'BBBB'); // left over from before: not used by the restored garden
    await target.store.restore(r.data, r.photos);
    const file = r.data.plantings.find((p) => p.id === id)!.photos![0].file;
    assert.ok(target.files.exists(file));
    assert.equal(target.files.exists('ph_stale.jpg'), false);
  });

  it('can leave photos out, and says so when restoring', async () => {
    const { store, id } = await makeStore();
    await store.addPhotos(id, [{ uri: 'a' }]);
    const text = serialiseBackup(createBackup(store.exportData(), { now: NOW, appVersion: 'test' }));
    assert.ok(!text.includes('"attachments"'));
    const r = parseBackup(text);
    assert.ok(r.ok && r.counts.photos === 0 && r.warnings.some((w) => /without photos/.test(w)));
  });

  it('drops damaged photos without losing the garden records', async () => {
    const { store, id } = await makeStore();
    await store.addPhotos(id, [{ uri: 'a' }]);
    const doc = JSON.parse(serialiseBackup(createBackup(store.exportData(), { now: NOW, appVersion: 'test', photos: await store.photoFilesForBackup() })));
    const name = Object.keys(doc.attachments.files)[0];
    doc.attachments.files[name] = 'ZZZZ';
    const r = parseBackup(JSON.stringify(doc));
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.photos, {});
    assert.equal(r.data.plantings.length, 1);
    assert.ok(r.warnings.some((w) => /integrity check/.test(w)));
  });
});
