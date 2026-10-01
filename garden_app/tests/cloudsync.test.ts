/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CloudFetch, CloudTokens } from '../src/services/cloud/providers';
import { GardenRepository } from '../src/services/storage/gardenRepository';
import { MemoryStore } from '../src/services/storage/keyValueStore';
import { WeatherService } from '../src/services/weather/weatherService';
import { CloudSyncController } from '../src/state/cloudSync';
import { GardenStore } from '../src/state/gardenStore';
import { NOW_ISO, profile } from './helpers';

const NOW = new Date(NOW_ISO);

/** A pretend Dropbox and Google Drive holding one file each. */
function fakeCloud() {
  const files: Record<string, string | undefined> = {};
  const calls: string[] = [];
  let googleId: string | undefined;
  let expiredGoogle = false;
  const res = (status: number, body: unknown = {}) => ({ ok: status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const fetchImpl: CloudFetch = async (url, init = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url.split('?')[0]}`);
    if (url.includes('/oauth2/token')) return res(200, { access_token: 'fresh', expires_in: 14400 });
    if (url.endsWith('/2/files/download')) return files.dropbox === undefined ? res(409, { error_summary: 'path/not_found' }) : res(200, files.dropbox);
    if (url.endsWith('/2/files/upload')) {
      files.dropbox = init.body;
      return res(200, {});
    }
    if (expiredGoogle && url.includes('googleapis.com')) return res(401);
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) return res(200, { files: googleId ? [{ id: googleId }] : [] });
    if (url.includes('/drive/v3/files/') && url.endsWith('alt=media')) return res(200, files.google);
    if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
      googleId = 'g1';
      files.google = String(init.body).split('\r\n')[7];
      return res(200, { id: googleId });
    }
    if (url.includes('/upload/drive/v3/files/g1')) {
      files.google = init.body;
      return res(200, { id: 'g1' });
    }
    return res(404);
  };
  return { files, calls, fetchImpl, expireGoogle: () => (expiredGoogle = true) };
}

function device(fetchImpl: CloudFetch, tokens: CloudTokens = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 }) {
  const kv = new MemoryStore();
  const garden = new GardenStore(new GardenRepository(kv, () => NOW), new WeatherService(kv, { fetch: async () => { throw new Error('offline'); }, now: () => NOW }), () => NOW);
  const sync = new CloudSyncController(garden, kv, fetchImpl, { signIn: async () => tokens, finishWebSignIn: async () => null });
  return { garden, sync, kv };
}

describe('cloud sync between the phone and the browser', () => {
  it('brings additions and deletions across through Dropbox', async () => {
    const cloud = fakeCloud();
    const phone = device(cloud.fetchImpl);
    const computer = device(cloud.fetchImpl);
    await phone.garden.init();
    await computer.garden.init();
    const { createdAt: _c, updatedAt: _u, id: _i, ...p } = profile();
    await phone.garden.saveProfile(p);
    const bed = await phone.garden.saveArea({ name: 'Front bed', type: 'raised-bed' } as never);

    await phone.sync.connect('dropbox');
    assert.ok(cloud.files.dropbox, 'the phone saved its garden to Dropbox');

    await computer.sync.connect('dropbox');
    assert.equal(computer.garden.state.data.profile?.location.suburb, p.location.suburb, 'the computer now has the phone\'s garden');
    assert.deepEqual(computer.garden.state.data.areas.map((a) => a.name), ['Front bed']);

    await computer.garden.saveArea({ name: 'Herb pots', type: 'pot' } as never);
    await computer.sync.run();
    await phone.sync.run();
    assert.deepEqual(phone.garden.state.data.areas.map((a) => a.name).sort(), ['Front bed', 'Herb pots']);

    await phone.garden.deleteArea(bed.id);
    await phone.sync.run();
    await computer.sync.run();
    assert.deepEqual(computer.garden.state.data.areas.map((a) => a.name), ['Herb pots'], 'deleted on the phone, gone on the computer');
    assert.equal(computer.sync.state.lastError, undefined);
  });

  it('renews an expired Dropbox sign-in by itself', async () => {
    const cloud = fakeCloud();
    const phone = device(cloud.fetchImpl, { accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() - 1000 });
    await phone.garden.init();
    await phone.sync.connect('dropbox');
    assert.ok(cloud.calls.some((c) => c.includes('/oauth2/token')));
    assert.equal(phone.sync.state.connection?.tokens.accessToken, 'fresh');
    assert.ok(!phone.sync.state.needsReconnect);
  });

  it('works with Google Drive, reusing the one file it created', async () => {
    const cloud = fakeCloud();
    const phone = device(cloud.fetchImpl);
    const computer = device(cloud.fetchImpl);
    await phone.garden.init();
    await computer.garden.init();
    await phone.garden.saveArea({ name: 'Back bed', type: 'in-ground' } as never);
    await phone.sync.connect('google');
    assert.equal(phone.sync.state.connection?.fileId, 'g1');
    await computer.sync.connect('google');
    assert.deepEqual(computer.garden.state.data.areas.map((a) => a.name), ['Back bed']);
    await computer.garden.saveArea({ name: 'Pots', type: 'pot' } as never);
    await computer.sync.run();
    assert.equal(cloud.calls.filter((c) => c.includes('uploadType=multipart') || c.startsWith('POST https://www.googleapis.com/upload/drive/v3/files')).length, 1, 'created once, then updated');
  });

  it('asks to reconnect when the sign-in has expired and can\'t be renewed', async () => {
    const cloud = fakeCloud();
    const browser = device(cloud.fetchImpl, { accessToken: 'a', expiresAt: Date.now() - 1000 });
    await browser.garden.init();
    await browser.sync.connect('google');
    assert.equal(browser.sync.state.needsReconnect, true);
    assert.equal(browser.sync.state.lastError, undefined);
  });

  it('remembers the connection on this device only', async () => {
    const cloud = fakeCloud();
    const phone = device(cloud.fetchImpl);
    await phone.garden.init();
    await phone.sync.connect('dropbox');
    const again = new CloudSyncController(phone.garden, phone.kv, cloud.fetchImpl, { signIn: async () => null, finishWebSignIn: async () => null });
    await again.load();
    assert.equal(again.state.connection?.provider, 'dropbox');
    assert.ok(!JSON.stringify(phone.garden.exportData()).includes('"refreshToken"'), 'tokens are never in the garden data or backups');
    await again.disconnect();
    assert.equal(await phone.kv.getItem('sbs:local:cloudSync'), null);
  });
});
