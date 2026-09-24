/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOCALITIES } from '../src/data/localities';
import { PLANTS } from '../src/data/plants';
import { SOURCES } from '../src/data/sources';
import { parseQuery, searchByText, validateCatalogue } from '../src/domain/catalogue';
import {
  inferClimateFromCoordinates,
  inferClimateFromPostcode,
  normalisePostcode,
  roundCoordinate,
  searchLocalities,
  stateForPostcode,
  timezoneFor,
} from '../src/domain/location';
import { catalogue } from './helpers';

describe('Australian location handling', () => {
  it('maps postcodes to states, including ACT and NT edge cases', () => {
    assert.equal(stateForPostcode('4000'), 'QLD');
    assert.equal(stateForPostcode('2600'), 'ACT');
    assert.equal(stateForPostcode('2620'), 'NSW'); // Queanbeyan
    assert.equal(stateForPostcode('2913'), 'ACT');
    assert.equal(stateForPostcode('0800'), 'NT');
    assert.equal(stateForPostcode('800'), 'NT');
    assert.equal(stateForPostcode('7000'), 'TAS');
    assert.equal(stateForPostcode('6000'), 'WA');
    assert.equal(stateForPostcode('5000'), 'SA');
    assert.equal(stateForPostcode('3000'), 'VIC');
    assert.equal(stateForPostcode('12345'), null);
    assert.equal(stateForPostcode('abc'), null);
  });

  it('normalises postcodes and handles Broken Hill\'s timezone', () => {
    assert.equal(normalisePostcode(' 4 0 0 0 '), '4000');
    assert.equal(normalisePostcode('870'), '0870');
    assert.equal(timezoneFor('NSW', '2880'), 'Australia/Broken_Hill');
    assert.equal(timezoneFor('QLD'), 'Australia/Brisbane');
    assert.equal(timezoneFor('WA'), 'Australia/Perth');
  });

  it('never keeps precise coordinates', () => {
    assert.equal(roundCoordinate(-27.470123456), -27.47);
    assert.equal(roundCoordinate(153.028888), 153.03);
  });

  it('searches the offline list by name or postcode', () => {
    assert.equal(searchLocalities(LOCALITIES, 'hobart')[0].name, 'Hobart');
    assert.equal(searchLocalities(LOCALITIES, '4350')[0].name, 'Toowoomba');
    assert.equal(searchLocalities(LOCALITIES, '').length, 0);
  });

  it('suggests different zones for Brisbane, Hobart, Darwin, Perth and inland Queensland', () => {
    const zone = (pc: string) => inferClimateFromPostcode(LOCALITIES, pc)!.zone;
    assert.equal(zone('4000'), 'subtropical');
    assert.equal(zone('7000'), 'cool-temperate');
    assert.equal(zone('0800'), 'tropical');
    assert.equal(zone('6000'), 'warm-temperate');
    assert.equal(zone('4730'), 'arid'); // Longreach
  });

  it('marks postcode-only guesses as low confidence', () => {
    const inf = inferClimateFromPostcode(LOCALITIES, '4152')!; // not in the list
    assert.equal(inf.confidence, 'low');
    assert.match(inf.reason, /check/i);
  });

  it('infers from coordinates and warns about elevation', () => {
    const near = inferClimateFromCoordinates(LOCALITIES, -27.5, 153.0)!;
    assert.equal(near.zone, 'subtropical');
    assert.equal(near.confidence, 'high');
    const high = inferClimateFromCoordinates(LOCALITIES, -27.4, 152.4, 700, 'QLD')!;
    assert.match(high.reason, /above sea level/);
  });

  it('has sensible reference data', () => {
    const keys = new Set<string>();
    for (const l of LOCALITIES) {
      assert.equal(stateForPostcode(l.postcode), l.state, `${l.name} postcode/state mismatch`);
      assert.ok(l.lat < -9 && l.lat > -44, `${l.name} latitude`);
      assert.ok(l.lon > 112 && l.lon < 154, `${l.name} longitude`);
      const k = `${l.name}-${l.postcode}`;
      assert.ok(!keys.has(k), `duplicate ${k}`);
      keys.add(k);
    }
  });
});

describe('plant catalogue', () => {
  it('passes data validation (sources exist, ranges sane, ids unique)', () => {
    assert.deepEqual(validateCatalogue(PLANTS, SOURCES), []);
  });

  it('contains the required starter crops and representative perennials, trees and flowers', () => {
    const required = [
      'tomato', 'cherry-tomato', 'capsicum', 'chilli', 'zucchini', 'pumpkin', 'cucumber', 'carrot', 'radish', 'beetroot',
      'lettuce', 'spinach', 'silverbeet', 'bean-bush', 'bean-climbing', 'pea', 'sweet-corn', 'potato', 'sweet-potato',
      'onion', 'garlic', 'spring-onion', 'broccoli', 'cauliflower', 'cabbage', 'basil', 'parsley', 'coriander', 'rosemary',
      'thyme', 'mint', 'strawberry', 'passionfruit',
    ];
    for (const id of required) assert.ok(catalogue.byId.has(id), `missing ${id}`);
    assert.ok(PLANTS.some((p) => p.categories.includes('tree') && p.categories.includes('fruit')));
    assert.ok(PLANTS.some((p) => p.categories.includes('pollinator') && p.categories.includes('flower')));
    assert.ok(PLANTS.some((p) => p.categories.includes('native')));
    assert.ok(PLANTS.some((p) => p.categories.includes('green-manure')));
  });

  it('stores unknown rather than inventing windows where no source was found', () => {
    assert.deepEqual(catalogue.byId.get('fig')!.windows, {});
    assert.equal(catalogue.byId.get('coriander')!.windows['cool-temperate']!.sourceId, 'seed-collection-chart');
    // Every window cites a registered source.
    for (const p of PLANTS) for (const w of Object.values(p.windows)) assert.ok(SOURCES[w!.sourceId]);
  });

  it('distinguishes production styles through data', () => {
    const style = (id: string) => catalogue.byId.get(id)!.production.style;
    assert.equal(style('carrot'), 'single-harvest');
    assert.equal(style('radish'), 'single-harvest');
    assert.equal(style('beetroot'), 'single-harvest');
    assert.equal(style('tomato'), 'repeat-harvest');
    assert.equal(style('capsicum'), 'repeat-harvest');
    assert.equal(style('zucchini'), 'repeat-harvest');
    assert.equal(style('lettuce'), 'cut-and-come-again');
    assert.equal(style('spinach'), 'cut-and-come-again');
    assert.equal(style('lemon'), 'long-lived');
    assert.equal(style('rosemary'), 'long-lived');
  });
});

describe('plant search', () => {
  const ctx = { zone: 'subtropical' as const, today: '2026-09-24' };
  const ids = (q: string) => searchByText(catalogue, q, ctx).map((r) => r.plant.id);

  it('finds plurals and aliases', () => {
    assert.deepEqual(ids('tomatoes').slice(0, 2).sort(), ['cherry-tomato', 'tomato']);
    assert.ok(ids('courgette').includes('zucchini'));
    assert.ok(ids('swiss chard').includes('silverbeet'));
  });

  it('understands descriptive queries', () => {
    assert.deepEqual(ids('fruit trees').sort(), ['fig', 'lemon', 'mango']);
    assert.ok(ids('plants for a trellis').includes('bean-climbing'));
    assert.ok(!ids('plants for a trellis').includes('carrot'));
    assert.ok(ids('pollinator plants').includes('borage'));
    assert.ok(ids('shade tolerant').includes('lettuce'));
    assert.ok(!ids('shade tolerant').includes('tomato'));
    assert.ok(ids('suitable for pots').includes('strawberry'));
    assert.ok(!ids('suitable for pots').includes('pumpkin'));
    const fast = ids('fast-growing vegetables');
    assert.ok(fast.includes('radish'));
    assert.ok(!fast.includes('onion'));
    assert.ok(!fast.includes('basil')); // not a vegetable
  });

  it('parses zone words and "plant now"', () => {
    const f = parseQuery('subtropical vegetables');
    assert.equal(f.zone, 'subtropical');
    assert.deepEqual(f.categories, ['vegetable']);
    assert.equal(parseQuery('cool temperate herbs').zone, 'cool-temperate');
    const now = ids('things I can plant now');
    assert.ok(now.includes('tomato')); // subtropical, September
    assert.ok(!now.includes('garlic')); // subtropical garlic is Apr–Jul
  });
});
