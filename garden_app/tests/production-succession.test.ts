/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateQuantity, productionLevelFromGoals, roundPlants } from '../src/domain/production';
import {
  acceptBatch,
  chooseInterval,
  planFromProposal,
  postponeBatch,
  proposeSuccession,
  recalculate,
  setBatchQuantity,
  skipBatch,
  stopPlan,
  type SuccessionContext,
} from '../src/domain/succession';
import { plant } from './helpers';

const q = (id: string, householdSize: number, level: 'some' | 'supplement' | 'maximise' = 'supplement', timeBudget: '2to4' | 'lt1' | '8plus' = '2to4') =>
  estimateQuantity(plant(id), { householdSize, level, timeBudget });

describe('household production model', () => {
  it('scales single-harvest crops with household size', () => {
    const one = q('carrot', 1);
    const four = q('carrot', 4);
    assert.ok(four.range[0] > one.range[0] * 3);
    assert.equal(four.style, 'single-harvest');
  });

  it('matches the brief\'s example of ~20–30 carrots per batch for a modest household', () => {
    const r = q('carrot', 4, 'some').range;
    assert.ok(r[0] >= 15 && r[1] <= 35, `got ${r}`);
  });

  it('does not multiply prolific repeat-harvest crops by household size', () => {
    const one = q('zucchini', 1);
    const six = q('zucchini', 6, 'maximise');
    assert.ok(one.range[0] >= 1);
    assert.ok(six.range[1] <= 4, 'zucchini capped');
    assert.equal(six.capped, true);
  });

  it('never scales a fruit tree by household size', () => {
    assert.deepEqual(q('lemon', 1).range, [1, 1]);
    assert.deepEqual(q('lemon', 8, 'maximise').range, [1, 1]);
    assert.match(q('lemon', 8).explanation, /doesn't grow with household size/);
  });

  it('keeps herbs to a few plants', () => {
    const r = q('parsley', 5, 'maximise').range;
    assert.ok(r[1] <= 8);
  });

  it('treats cut-and-come-again greens differently from single-harvest roots', () => {
    const lettuce = q('lettuce', 4);
    const carrot = q('carrot', 4);
    assert.equal(lettuce.style, 'cut-and-come-again');
    assert.ok(lettuce.range[1] < carrot.range[0]);
  });

  it('reduces high-maintenance crops for very limited time, but not easy ones', () => {
    assert.ok(q('tomato', 4, 'supplement', 'lt1').range[1] < q('tomato', 4, 'supplement', '2to4').range[1]);
    assert.deepEqual(q('radish', 4, 'supplement', 'lt1').range, q('radish', 4, 'supplement', '2to4').range);
  });

  it('always labels quantities as estimates', () => {
    const e = q('carrot', 2);
    assert.equal(e.isEstimate, true);
    assert.match(e.explanation, /planning estimate/);
  });

  it('derives production level from goals', () => {
    assert.equal(productionLevelFromGoals(['self-sufficiency']), 'maximise');
    assert.equal(productionLevelFromGoals(['supplement', 'herbs']), 'supplement');
    assert.equal(productionLevelFromGoals(['herbs']), 'some');
  });

  it('rounds to gardening-friendly numbers', () => {
    assert.equal(roundPlants(0.4), 1);
    assert.equal(roundPlants(7.4), 7);
    assert.equal(roundPlants(23), 25);
  });
});

describe('succession planting', () => {
  const base: SuccessionContext = {
    zone: 'subtropical',
    startDate: '2026-09-24',
    householdSize: 3,
    level: 'supplement',
    timeBudget: '1to2',
  };

  it('plans repeated carrot sowings that stop when the regional window closes', () => {
    const p = proposeSuccession(plant('carrot'), base);
    assert.equal(p.suitable, true);
    assert.equal(p.intervalDays, 28); // limited time → the longer interval
    assert.deepEqual(p.batches.map((b) => b.date), ['2026-09-24', '2026-10-22', '2026-11-19']);
    assert.equal(p.windowEnd, '2026-11-30'); // subtropical carrots Feb–Nov
    assert.ok(p.notes.some((n) => /window for your area closes/.test(n)));
    assert.ok(p.batches.every((b) => b.quantity === p.batchQuantity));
  });

  it('continues across the new year for summer windows (Hobart lettuce)', () => {
    const p = proposeSuccession(plant('lettuce'), { ...base, zone: 'cool-temperate', startDate: '2026-11-20', timeBudget: '4to8' });
    assert.equal(p.suitable, true);
    assert.ok(p.batches.some((b) => b.date.startsWith('2027-')));
    assert.ok(p.batches.every((b) => b.date <= '2027-04-30'));
  });

  it('limits the number of sowings for gardeners with little time', () => {
    const p = proposeSuccession(plant('radish'), { ...base, timeBudget: 'lt1' });
    assert.ok(p.batches.length <= 3);
    assert.ok(p.notes.some((n) => /manageable/.test(n)));
  });

  it('uses shorter intervals for gardeners maximising production', () => {
    assert.equal(chooseInterval(plant('carrot'), 'maximise', '4to8'), 21);
    assert.equal(chooseInterval(plant('carrot'), 'supplement', 'lt1'), 28);
  });

  it('shrinks batches to fit the available space', () => {
    // Carrot footprint ≈ 3 cm × 25 cm = 0.0075 m²; 0.1 m² (+10% tolerance) fits about 14.
    const p = proposeSuccession(plant('carrot'), { ...base, freeAreaM2: 0.1 });
    assert.equal(p.batchQuantity, 14);
    assert.ok(p.notes.some((n) => /fit the free space/.test(n)));
    const none = proposeSuccession(plant('carrot'), { ...base, freeAreaM2: 0 });
    assert.equal(none.suitable, false);
  });

  it('declines crops that are not succession planted, or outside their window', () => {
    assert.equal(proposeSuccession(plant('lemon'), base).suitable, false);
    const garlic = proposeSuccession(plant('garlic'), base);
    assert.equal(garlic.suitable, false);
    const outside = proposeSuccession(plant('carrot'), { ...base, startDate: '2026-12-10' });
    assert.equal(outside.suitable, false);
    assert.match(outside.reason!, /isn't open yet/);
  });

  const ctx = { zone: 'subtropical' as const, plant: plant('carrot'), now: '2026-09-24T00:00:00Z' };
  const fresh = () => planFromProposal(proposeSuccession(plant('carrot'), base), { id: 'sp1', plantId: 'carrot', now: ctx.now });

  it('accepting a batch on a different day re-anchors later batches', () => {
    const plan = acceptBatch(fresh(), 0, 'pl-x', '2026-09-28', ctx);
    assert.equal(plan.batches[0].status, 'accepted');
    assert.equal(plan.batches[0].plantingId, 'pl-x');
    assert.equal(plan.batches[1].plannedDate, '2026-10-26');
    assert.ok(plan.batches.every((b) => b.plannedDate <= '2026-11-30'));
  });

  it('postponing drops batches that would fall after the window', () => {
    const plan = postponeBatch(fresh(), 1, 14, ctx);
    assert.equal(plan.batches[1].plannedDate, '2026-11-05');
    assert.ok(!plan.batches.some((b) => b.plannedDate > '2026-11-30'));
    assert.ok(plan.notes.some((n) => /removed because/.test(n)));
  });

  it('skipping keeps the plan going from the skipped date', () => {
    const plan = skipBatch(fresh(), 0, ctx);
    assert.equal(plan.batches[0].status, 'skipped');
    assert.equal(plan.batches[1].plannedDate, '2026-10-22');
  });

  it('changing quantity can apply to future batches, and survives recalculation', () => {
    let plan = setBatchQuantity(fresh(), 1, 12, true, ctx.now);
    assert.equal(plan.defaultBatchQuantity, 12);
    assert.equal(plan.batches[2].quantity, 12);
    plan = setBatchQuantity(plan, 2, 30, false, ctx.now);
    plan = recalculate(plan, ctx);
    assert.equal(plan.batches[2].quantity, 30);
  });

  it('stopping removes future sowings but keeps history', () => {
    const accepted = acceptBatch(fresh(), 0, 'pl-1', '2026-09-24', ctx);
    const stopped = stopPlan(accepted, ctx.now);
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.batches.length, 1);
    assert.equal(stopped.batches[0].status, 'accepted');
    // Stopped plans are not recalculated back to life.
    assert.equal(recalculate(stopped, ctx).batches.length, 1);
  });

  it('completes the plan once every batch has been acted on', () => {
    let plan = fresh();
    for (const b of [...plan.batches]) plan = skipBatch(plan, plan.batches.find((x) => x.plannedDate === b.plannedDate && x.status === 'planned')?.index ?? b.index, ctx);
    assert.equal(plan.status, 'completed');
  });
});

import { formatRange } from '../src/domain/production';
describe('quantity wording', () => {
  it('uses singular units for exactly one', () => {
    assert.equal(formatRange([1, 1], 'plants'), 'approximately 1 plant');
    assert.equal(formatRange([1, 1], 'trees'), 'approximately 1 tree');
    assert.equal(formatRange([10, 15], 'carrots (after thinning)'), 'approximately 10–15 carrots (after thinning)');
  });
});
