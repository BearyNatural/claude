/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { outlineDimensionsM, perimeterM, polygonAreaM2, type LatLon } from '../src/domain/geometry';
import { validateArea, validateProfile } from '../src/domain/validation';
import { buildAddressSearchUrl, parseAddressResults, searchAddress } from '../src/services/location/addressSearch';
import { GardenRepository } from '../src/services/storage/gardenRepository';
import { MemoryStore } from '../src/services/storage/keyValueStore';
import { WeatherService } from '../src/services/weather/weatherService';
import { GardenStore } from '../src/state/gardenStore';
import { area, NOW_ISO, profile } from './helpers';

// A 4 m × 1.5 m bed near Strathpine, built from metre offsets.
const LAT0 = -27.3;
const LON0 = 152.99;
const M_PER_DEG_LAT = 111_195;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);
const at = (eastM: number, northM: number): LatLon => ({ lat: LAT0 + northM / M_PER_DEG_LAT, lon: LON0 + eastM / M_PER_DEG_LON });
const rotated = (deg: number, pts: [number, number][]) => {
  const r = (deg * Math.PI) / 180;
  return pts.map(([x, y]) => at(x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)));
};
const BED: [number, number][] = [[0, 0], [4, 0], [4, 1.5], [0, 1.5]];

describe('measuring outlines drawn on the map', () => {
  it('measures a rectangular bed in m²', () => {
    assert.ok(Math.abs(polygonAreaM2(rotated(0, BED)) - 6) < 0.05);
    assert.ok(Math.abs(perimeterM(rotated(0, BED)) - 11) < 0.05);
  });

  it('gives length × width whichever way the bed faces', () => {
    for (const deg of [0, 30, 72, 135]) {
      const d = outlineDimensionsM(rotated(deg, BED))!;
      assert.ok(Math.abs(d.lengthM - 4) < 0.05, `length at ${deg}°: ${d.lengthM}`);
      assert.ok(Math.abs(d.widthM - 1.5) < 0.05, `width at ${deg}°: ${d.widthM}`);
      assert.ok(Math.abs(polygonAreaM2(rotated(deg, BED)) - 6) < 0.05);
    }
  });

  it('handles irregular shapes and corners tapped in either direction', () => {
    const l: [number, number][] = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]]; // an L-shaped bed, 5 m²
    assert.ok(Math.abs(polygonAreaM2(rotated(0, l)) - 5) < 0.05);
    assert.ok(Math.abs(polygonAreaM2(rotated(0, [...l].reverse())) - 5) < 0.05);
  });

  it('needs at least three corners', () => {
    assert.equal(polygonAreaM2([at(0, 0), at(1, 0)]), 0);
    assert.equal(outlineDimensionsM([at(0, 0), at(1, 0)]), null);
  });
});

describe('address search (OpenStreetMap Nominatim)', () => {
  it('asks for Australian results only', () => {
    const u = new URL(buildAddressSearchUrl(' 12 Example St, Strathpine '));
    assert.equal(u.hostname, 'nominatim.openstreetmap.org');
    assert.equal(u.searchParams.get('countrycodes'), 'au');
    assert.equal(u.searchParams.get('q'), '12 Example St, Strathpine');
  });

  it('parses results and skips unusable ones', () => {
    const r = parseAddressResults([
      { display_name: 'Gympie Road, Brisbane, Queensland, 4500, Australia', lat: '-27.3158', lon: '152.9996' },
      { display_name: 'Broken', lat: 'x', lon: '1' },
      'nonsense',
    ]);
    assert.deepEqual(r, [{ label: 'Gympie Road, Brisbane, Queensland, 4500', lat: -27.3158, lon: 152.9996 }]);
    assert.deepEqual(parseAddressResults({ error: 'nope' }), []);
  });

  it('identifies the app and does not search for very short text', async () => {
    const seen: { url: string; ua?: string }[] = [];
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url, ua: init?.headers?.['User-Agent'] });
      return { ok: true, status: 200, json: async () => [] };
    };
    assert.deepEqual(await searchAddress('12', fetchImpl), []);
    assert.equal(seen.length, 0);
    await searchAddress('12 Example St', fetchImpl);
    assert.match(seen[0].ua ?? '', /SowBySeason/);
  });
});

describe('saving map data', () => {
  it('validates the optional property location and outlines', () => {
    const p = validateProfile({ ...profile(), property: { lat: -27.3, lon: 152.99, label: '12 Example St', zoom: 19 } });
    assert.ok(p.ok && p.value.property?.label === '12 Example St');
    assert.equal(validateProfile({ ...profile(), property: { lat: 200, lon: 0 } }).ok, false);
    const a = validateArea({ ...area(), outline: [{ lat: -27.3, lon: 152.99 }, { lat: -27.3001, lon: 152.99 }, { lat: -27.3, lon: 152.9901 }] });
    assert.ok(a.ok && a.value.outline?.length === 3);
    assert.equal(validateArea({ ...area(), outline: [{ lat: 'x', lon: 1 }] }).ok, false);
  });

  it('measures an area from its outline, and forgets map data on request while keeping sizes', async () => {
    const kv = new MemoryStore();
    const now = new Date(NOW_ISO);
    const store = new GardenStore(new GardenRepository(kv, () => now), new WeatherService(kv, { fetch: async () => { throw new Error('offline'); }, now: () => now }), () => now);
    await store.init();
    const { createdAt: _c, updatedAt: _u, id: _i, ...p } = profile();
    await store.saveProfile(p);
    await store.setProperty({ lat: -27.3, lon: 152.99, label: '12 Example St' });
    const bed = await store.saveArea({ name: 'Veg bed', type: 'vegetable-bed' });
    await store.saveAreaOutline(bed.id, rotated(30, BED));
    const measured = store.state.data.areas.find((a) => a.id === bed.id)!;
    assert.equal(measured.usableAreaM2, 6);
    assert.equal(measured.lengthM, 4);
    assert.equal(measured.widthM, 1.5);

    await store.clearMapData();
    const after = store.state.data.areas.find((a) => a.id === bed.id)!;
    assert.equal(store.state.data.profile?.property, undefined);
    assert.equal(after.outline, undefined);
    assert.equal(after.usableAreaM2, 6);
  });
});
