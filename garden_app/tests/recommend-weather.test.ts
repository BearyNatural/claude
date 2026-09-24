/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PLANTS } from '../src/data/plants';
import { buildPlantNow, recommendPlant, type RecommendContext } from '../src/domain/recommend';
import type { ClimateZoneId, FrostRisk } from '../src/domain/types';
import { assessWeather, describeSoilTemperature, weatherFreshness } from '../src/domain/weather';
import { area, getPlant, mildWeather, noWeather, plant, planting, snapshot } from './helpers';

function ctx(zone: ClimateZoneId, today: string, over: Partial<RecommendContext> = {}): RecommendContext {
  return {
    today,
    zone,
    frostRisk: 'light' as FrostRisk,
    weather: noWeather(today),
    goals: ['fresh-veg'],
    timeBudget: '2to4',
    householdSize: 3,
    plantings: [],
    areas: [],
    wishlistPlantIds: new Set(),
    getPlant,
    ...over,
  };
}

describe('climate-zone recommendations', () => {
  it('gives different advice for Brisbane, Hobart, Darwin, Perth and inland Queensland in July', () => {
    const today = '2026-07-15';
    const tomato = plant('tomato');
    assert.equal(recommendPlant(tomato, ctx('tropical', today, { frostRisk: 'none' })).category, 'great'); // Darwin dry season
    assert.equal(recommendPlant(tomato, ctx('subtropical', today)).category, 'soon'); // Brisbane: from August
    assert.equal(recommendPlant(tomato, ctx('warm-temperate', today)).category, 'soon'); // Perth: from August
    assert.equal(recommendPlant(tomato, ctx('cool-temperate', today, { frostRisk: 'moderate' })).category, 'outside'); // Hobart
    // Inland QLD (e.g. Charleville): arid windows are broad, but winter frost makes tender crops a wait.
    const inland = recommendPlant(tomato, ctx('arid', today, { frostRisk: 'moderate' }));
    assert.equal(inland.category, 'wait');
    assert.ok(inland.reasons.some((r) => r.kind === 'frost' && /frost/.test(r.text)));
  });

  it('does not produce identical advice across zones', () => {
    const today = '2026-09-24';
    const cats = (z: ClimateZoneId) => PLANTS.map((p) => recommendPlant(p, ctx(z, today)).category).join(',');
    assert.notEqual(cats('subtropical'), cats('cool-temperate'));
    assert.notEqual(cats('tropical'), cats('subtropical'));
    assert.notEqual(cats('warm-temperate'), cats('arid'));
  });

  it('always explains its recommendation', () => {
    for (const p of PLANTS) {
      const r = recommendPlant(p, ctx('subtropical', '2026-09-24'));
      assert.ok(r.reasons.length > 0, `${p.id} has no reasons`);
      assert.ok(r.headline.length > 0);
    }
  });

  it('asks for a location when no zone is known', () => {
    const r = recommendPlant(plant('carrot'), { ...ctx('subtropical', '2026-09-24'), zone: null });
    assert.equal(r.category, 'unknown');
    assert.match(r.reasons[0].text, /location/i);
  });

  it('marks plants unsuited to a climate', () => {
    const r = recommendPlant(plant('mango'), ctx('cool-temperate', '2026-09-24'));
    assert.equal(r.category, 'outside');
    assert.equal(r.reasons[0].kind, 'climate');
  });

  it('says so when no sourced window exists rather than guessing', () => {
    const r = recommendPlant(plant('fig'), ctx('subtropical', '2026-09-24'));
    assert.equal(r.category, 'unknown');
    assert.match(r.reasons[0].text, /don't have a sourced planting window/);
  });

  it('flags the end of a window as "can plant" rather than "great"', () => {
    // Subtropical carrots: Feb–Nov. Mid-November is near the close.
    const r = recommendPlant(plant('carrot'), ctx('subtropical', '2026-11-20'));
    assert.equal(r.category, 'can');
  });

  it('boosts goal matches and the wish list, and notes low-maintenance conflicts', () => {
    const base = recommendPlant(plant('basil'), ctx('subtropical', '2026-09-24'));
    const withGoal = recommendPlant(plant('basil'), ctx('subtropical', '2026-09-24', { goals: ['herbs'], wishlistPlantIds: new Set(['basil']) }));
    assert.ok(withGoal.score > base.score);
    assert.ok(withGoal.onWishlist);
    const lowMaint = recommendPlant(plant('tomato'), ctx('subtropical', '2026-09-24', { goals: ['low-maintenance'] }));
    assert.ok(lowMaint.reasons.some((r) => r.kind === 'time' && r.tone === 'caution'));
  });

  it('suggests the next succession batch when the last sowing is old enough', () => {
    const plantings = [planting({ plantId: 'carrot', plantedDate: '2026-08-20', stage: 'seedling' })];
    const r = recommendPlant(plant('carrot'), ctx('subtropical', '2026-09-24', { plantings }));
    assert.equal(r.successionDue, true);
    assert.match(r.headline, /next sowing/);
    const recent = [planting({ plantId: 'carrot', plantedDate: '2026-09-20', stage: 'seed' })];
    const r2 = recommendPlant(plant('carrot'), ctx('subtropical', '2026-09-24', { plantings: recent }));
    assert.equal(r2.successionDue, false);
    assert.ok(r2.reasons.some((x) => /next batch would be due/.test(x.text)));
  });

  it('notices when the garden has no room', () => {
    const bed = area({ lengthM: 1, widthM: 1 });
    const full = [planting({ plantId: 'pumpkin', areaId: bed.id, quantity: 2, stage: 'established' })];
    const r = recommendPlant(plant('zucchini'), ctx('subtropical', '2026-09-24', { areas: [bed], plantings: full }));
    assert.ok(r.reasons.some((x) => x.kind === 'space'));
  });

  it('groups results into the five categories in order', () => {
    const g = buildPlantNow(PLANTS, ctx('subtropical', '2026-09-24'));
    const order = g.groups.map((x) => x.category);
    const expected = ['great', 'can', 'soon', 'wait', 'outside', 'unknown'].filter((c) => order.includes(c as never));
    assert.deepEqual(order, expected);
  });
});

describe('weather-aware refinement', () => {
  const today = '2026-09-24';
  const now = new Date('2026-09-24T00:00:00Z');

  it('treats weather as fresh, stale or unavailable — never silently current', () => {
    assert.equal(weatherFreshness(snapshot(today, [{}], { fetchedAt: '2026-09-23T23:00:00Z' }), now), 'fresh');
    assert.equal(weatherFreshness(snapshot(today, [{}], { fetchedAt: '2026-09-23T14:00:00Z' }), now), 'stale');
    assert.equal(weatherFreshness(snapshot(today, [{}], { fetchedAt: '2026-09-21T00:00:00Z' }), now), 'unavailable');
    assert.equal(weatherFreshness(null, now), 'unavailable');
  });

  it('adds a caveat to advice based on stale forecasts', () => {
    const stale = assessWeather(snapshot(today, Array(7).fill({}), { fetchedAt: '2026-09-23T14:00:00Z' }), today, now);
    assert.equal(stale.freshness, 'stale');
    assert.match(stale.caveat!, /10 hours ago/);
    const r = recommendPlant(plant('bean-bush'), ctx('subtropical', today, { weather: stale }));
    assert.ok(r.reasons.some((x) => /hours ago/.test(x.text)));
  });

  it('falls back to seasonal advice when weather is unavailable', () => {
    const w = noWeather(today);
    assert.equal(w.seasonalOnly, true);
    const r = recommendPlant(plant('bean-bush'), ctx('subtropical', today, { weather: w }));
    assert.equal(r.category, 'great');
    assert.ok(r.reasons.some((x) => /seasonal timing only/.test(x.text)));
  });

  it('ignores forecast days in the past', () => {
    const w = assessWeather(snapshot('2026-09-20', [{ minC: 0 }, { minC: 0 }, {}, {}, {}, {}, {}, {}, {}, {}]), today, now);
    assert.deepEqual(w.frostDays, []);
  });

  it('holds back frost-tender crops when frost is forecast', () => {
    const w = assessWeather(snapshot(today, [{}, { minC: 1 }, {}, {}, {}, {}, {}]), today, now);
    const r = recommendPlant(plant('bean-bush'), ctx('subtropical', today, { weather: w }));
    assert.equal(r.category, 'wait');
    assert.ok(r.reasons.some((x) => x.kind === 'frost' && /1°C/.test(x.text)));
    // Hardy crops are unaffected by the frost check.
    const peas = recommendPlant(plant('broad-bean'), ctx('warm-temperate', '2026-05-10', { weather: assessWeather(snapshot('2026-05-10', [{ minC: 1 }]), '2026-05-10', new Date('2026-05-10T00:00:00Z')) }));
    assert.notEqual(peas.category, 'wait');
  });

  it('warns about bolting when warm weather is approaching (coriander)', () => {
    const w = assessWeather(snapshot(today, [{ maxC: 31 }, { maxC: 32 }, {}, {}, {}, {}, {}]), today, now);
    const r = recommendPlant(plant('coriander'), ctx('subtropical', today, { weather: w }));
    assert.equal(r.category, 'wait');
    assert.ok(r.reasons.some((x) => /bolting/.test(x.text)));
  });

  it('gives a positive weather explanation when conditions suit', () => {
    const r = recommendPlant(plant('bean-bush'), ctx('subtropical', today, { weather: mildWeather(today, 20) }));
    assert.equal(r.category, 'great');
    assert.ok(r.reasons.some((x) => /no frost is forecast/.test(x.text)));
    assert.ok(r.reasons.some((x) => x.kind === 'soil' && /Modelled soil temperature \(20°C\)/.test(x.text)));
  });

  it('uses modelled soil temperature for germination and never substitutes air temperature', () => {
    const cold = recommendPlant(plant('bean-bush'), ctx('subtropical', today, { weather: mildWeather(today, 12) }));
    assert.equal(cold.category, 'wait');
    assert.ok(cold.reasons.some((x) => x.kind === 'soil' && /below the roughly 16°C/.test(x.text)));
    // With air temps of 26°C but no soil data, the app must say soil temperature is unavailable.
    const noSoil = mildWeather(today);
    assert.equal(noSoil.soilTempC, undefined);
    assert.match(describeSoilTemperature(noSoil), /not available/);
    const r = recommendPlant(plant('bean-bush'), ctx('subtropical', today, { weather: noSoil }));
    assert.ok(r.reasons.some((x) => x.kind === 'soil' && /isn't available/.test(x.text)));
  });

  it('suggests seed trays when soil is too cold for a crop that can be raised indoors', () => {
    const r = recommendPlant(plant('lettuce'), ctx('subtropical', today, { weather: mildWeather(today, 1) }));
    assert.equal(r.suggestedMethod, 'seed-tray');
  });

  it('demotes direct sowing before heavy rain and very hot weather', () => {
    const rain = assessWeather(snapshot(today, [{}, { precipitationMm: 40 }, {}, {}, {}, {}, {}]), today, now);
    const r = recommendPlant(plant('carrot'), ctx('subtropical', today, { weather: rain }));
    assert.equal(r.category, 'can');
    assert.ok(r.reasons.some((x) => x.kind === 'rain' && /40 mm/.test(x.text)));
    const heat = assessWeather(snapshot(today, [{}, { maxC: 38 }, {}, {}, {}, {}, {}]), today, now);
    const h = recommendPlant(plant('bean-bush'), ctx('subtropical', today, { weather: heat }));
    assert.equal(h.category, 'can');
    assert.ok(h.reasons.some((x) => x.kind === 'heat'));
  });
});

describe('heat nuance', () => {
  it('only notes heat for heat-loving crops, but holds back heat-sensitive ones', () => {
    const today = '2026-09-24';
    const w = assessWeather(snapshot(today, [{}, {}, { maxC: 36 }, {}, {}, {}, {}]), today, new Date('2026-09-24T00:00:00Z'));
    const corn = recommendPlant(plant('sweet-corn'), ctx('subtropical', today, { weather: w }));
    assert.equal(corn.category, 'great');
    assert.ok(corn.reasons.some((x) => x.kind === 'heat' && x.tone === 'neutral'));
    const beans = recommendPlant(plant('bean-bush'), ctx('subtropical', today, { weather: w }));
    assert.equal(beans.category, 'can');
    // Heat a week away doesn't affect today's advice.
    const later = assessWeather(snapshot(today, [{}, {}, {}, {}, {}, { maxC: 37 }, {}]), today, new Date('2026-09-24T00:00:00Z'));
    assert.equal(recommendPlant(plant('bean-bush'), ctx('subtropical', today, { weather: later })).category, 'great');
  });
});
