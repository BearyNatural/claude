/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMPANIONS } from '../src/data/companions';
import { PLANTS } from '../src/data/plants';
import { THREE_SISTERS } from '../src/data/systems';
import { areaCompanionNotes, companionsFor } from '../src/domain/companions';
import { rotationWarnings } from '../src/domain/rotation';
import { areaUsage, checkFit, containerCheck, overcrowdingWarning, sunCheck } from '../src/domain/space';
import { planSystem } from '../src/domain/systems';
import { buildTimeline, describeProgress } from '../src/domain/timeline';
import { area, getPlant, plant, planting } from './helpers';

describe('Three Sisters planting system', () => {
  it('sequences beans and squash after the corn is established', () => {
    const r = planSystem(THREE_SISTERS, '2026-09-24', 'subtropical', getPlant);
    assert.equal(r.ok, true);
    const [corn, beans, squash] = ['support', 'climber', 'groundcover'].map((role) => r.steps.find((s) => s.role === role)!);
    assert.equal(corn.suggested, '2026-09-24');
    assert.equal(beans.earliest, '2026-10-08');
    assert.equal(beans.latest, '2026-10-15');
    assert.ok(beans.suggested > corn.suggested, 'beans must not be sown with the corn');
    assert.match(beans.trigger!, /15 cm/);
    assert.ok(squash.suggested > corn.suggested);
    assert.equal(r.steps[0].role, 'support');
  });

  it('explains each member\'s function', () => {
    const r = planSystem(THREE_SISTERS, '2026-09-24', 'subtropical', getPlant);
    const beans = r.steps.find((s) => s.role === 'climber')!;
    assert.ok(beans.functions.some((f) => /legume/i.test(f)));
    assert.ok(r.steps.find((s) => s.role === 'groundcover')!.functions.some((f) => /soil/.test(f)));
  });

  it('warns when a later step would fall outside its window (late start in Hobart)', () => {
    const r = planSystem(THREE_SISTERS, '2026-11-25', 'cool-temperate', getPlant);
    assert.equal(r.ok, false);
    assert.ok(r.warnings.some((w) => /Pumpkin/.test(w)));
  });

  it('works in cool areas when started at the right time', () => {
    const r = planSystem(THREE_SISTERS, '2026-10-15', 'cool-temperate', getPlant);
    assert.equal(r.ok, true);
  });
});

describe('companion planting', () => {
  it('lists companions with reasons and evidence levels', () => {
    const tomato = companionsFor(plant('tomato'), PLANTS, COMPANIONS);
    const basil = tomato.find((c) => c.other.id === 'basil')!;
    assert.equal(basil.relation.effect, 'beneficial');
    assert.equal(basil.relation.evidence, 'traditional');
    const potato = tomato.find((c) => c.other.id === 'potato')!;
    assert.equal(potato.relation.effect, 'avoid');
    assert.ok(potato.relation.reasons.includes('shared-pests'));
    // Beneficial listed before avoid.
    assert.equal(tomato[0].relation.effect, 'beneficial');
  });

  it('never presents folklore as established', () => {
    for (const r of COMPANIONS) {
      assert.ok(r.note.length > 20, `${r.id} needs an explanation`);
      assert.ok(r.reasons.length > 0);
      if (r.reasons.length === 1 && r.reasons[0] === 'traditional') assert.equal(r.evidence, 'traditional', r.id);
    }
    const corn = COMPANIONS.find((r) => r.id === 'corn-climbing-bean')!;
    assert.match(corn.note, /later crops/); // nitrogen nuance
  });

  it('expands category relationships (pollinator plants help cucurbits)', () => {
    const zucchini = companionsFor(plant('zucchini'), PLANTS, COMPANIONS).map((c) => c.other.id);
    assert.ok(zucchini.includes('borage'));
    assert.ok(zucchini.includes('lavender'));
  });

  it('finds relationships between plants growing in the same area', () => {
    const bed = area();
    const ps = [
      planting({ plantId: 'tomato', areaIds: [bed.id], stage: 'established' }),
      planting({ plantId: 'potato', areaIds: [bed.id], stage: 'established' }),
      planting({ plantId: 'basil', areaIds: [bed.id], stage: 'established' }),
      planting({ plantId: 'carrot', areaIds: ['other'], stage: 'established' }),
    ];
    const notes = areaCompanionNotes(bed.id, ps, getPlant, COMPANIONS);
    const ids = notes.map((n) => n.relation.id).sort();
    assert.deepEqual(ids, ['potato-tomato', 'tomato-basil']);
  });
});

describe('garden space and site checks', () => {
  it('notices four zucchini will not fit in a 1 × 1 m bed', () => {
    const bed = area({ lengthM: 1, widthM: 1 });
    const r = checkFit(bed, plant('zucchini'), 4, [], getPlant);
    assert.equal(r.fits, false);
    assert.match(r.message!, /unlikely to fit comfortably/);
    assert.ok(r.maxThatFits! >= 1 && r.maxThatFits! < 4);
  });

  it('accepts a sensible carrot sowing in a 4 × 1 m bed', () => {
    assert.equal(checkFit(area(), plant('carrot'), 30, [], getPlant).fits, true);
  });

  it('works when only rough information is known', () => {
    const vague = area({ lengthM: undefined, widthM: undefined, sunHours: undefined });
    assert.equal(checkFit(vague, plant('carrot'), 30, [], getPlant).fits, null);
    assert.equal(sunCheck(vague, plant('tomato')), null);
  });

  it('reports overcrowding in an existing area', () => {
    const bed = area({ lengthM: 1, widthM: 1 });
    const ps = [planting({ plantId: 'zucchini', areaIds: [bed.id], quantity: 4, stage: 'established' })];
    assert.ok(areaUsage(bed, ps, getPlant).ratio! > 1);
    assert.match(overcrowdingWarning(bed, ps, getPlant)!, /capacity/);
  });

  it('checks sun and container size', () => {
    const shady = area({ sunHours: 3 });
    assert.match(sunCheck(shady, plant('tomato'))!, /at least 6 hours/);
    assert.equal(sunCheck(shady, plant('mint')), null);
    const pot = area({ type: 'pot', container: { volumeL: 10 }, lengthM: undefined, widthM: undefined });
    assert.match(containerCheck(pot, plant('tomato'))!, /30 L/);
    assert.match(containerCheck(pot, plant('pumpkin'))!, /not well suited/);
  });
});

describe('crop rotation groundwork', () => {
  it('warns when a related crop grew in the same area within a year', () => {
    const bed = area();
    const past = [planting({ plantId: 'potato', areaIds: [bed.id], plantedDate: '2026-03-01', stage: 'finished' })];
    const w = rotationWarnings(plant('tomato'), bed.id, past, getPlant, '2026-09-24');
    assert.equal(w.length, 1);
    assert.match(w[0].message, /nightshade/);
    assert.equal(rotationWarnings(plant('bean-bush'), bed.id, past, getPlant, '2026-09-24').length, 0);
    assert.equal(rotationWarnings(plant('tomato'), 'elsewhere', past, getPlant, '2026-09-24').length, 0);
    const old = [planting({ plantId: 'potato', areaIds: [bed.id], plantedDate: '2025-01-01', stage: 'finished' })];
    assert.equal(rotationWarnings(plant('tomato'), bed.id, old, getPlant, '2026-09-24').length, 0);
  });
});

describe('planting timelines', () => {
  const today = '2026-09-24';

  it('estimates germination, transplanting, flowering and harvest for a tomato sown in a tray', () => {
    const p = planting({ plantId: 'tomato', startMethod: 'seed-tray', plantedDate: '2026-09-02' });
    const tl = buildTimeline(p, plant('tomato'), [], today);
    const kinds = tl.items.map((i) => i.kind);
    for (const k of ['start', 'germination', 'transplant', 'flowering', 'first-harvest', 'harvest-end']) assert.ok(kinds.includes(k as never), k);
    const germ = tl.items.find((i) => i.kind === 'germination')!;
    assert.equal(germ.date, '2026-09-12');
    assert.equal(germ.endDate, '2026-09-22');
    assert.equal(germ.status, 'estimated');
    assert.match(germ.label, /estimated/);
  });

  it('replaces estimates with real observations and shifts later estimates', () => {
    const base = planting({ plantId: 'tomato', startMethod: 'seed-tray', plantedDate: '2026-09-02' });
    const withActual = { ...base, events: [{ id: 'e1', type: 'germinated' as const, date: '2026-09-09' }] };
    const a = buildTimeline(base, plant('tomato'), [], today);
    const b = buildTimeline(withActual, plant('tomato'), [], today);
    assert.equal(b.items.find((i) => i.kind === 'germination'), undefined);
    assert.ok(b.items.some((i) => i.label === 'Germinated' && i.status === 'actual'));
    const tA = a.items.find((i) => i.kind === 'transplant')!;
    const tB = b.items.find((i) => i.kind === 'transplant')!;
    assert.ok(tB.date < tA.date, 'earlier germination should bring transplanting forward');
  });

  it('widens estimates when the planting date is approximate ("sometime around early September")', () => {
    const exact = buildTimeline(planting({ plantId: 'tomato', startMethod: 'seedling', plantedDate: '2026-09-05' }), plant('tomato'), [], today);
    const approx = buildTimeline(planting({ plantId: 'tomato', startMethod: 'seedling', plantedDate: '2026-09-05', dateAccuracy: 'approx-month' }), plant('tomato'), [], today);
    const e = exact.items.find((i) => i.kind === 'first-harvest')!;
    const a = approx.items.find((i) => i.kind === 'first-harvest')!;
    assert.ok(a.date < e.date && a.endDate! > e.endDate!);
    assert.equal(approx.uncertaintyDays, 15);
  });

  it('gives bought seedlings a head start', () => {
    const seed = buildTimeline(planting({ plantId: 'tomato', startMethod: 'seed-tray', plantedDate: '2026-09-01' }), plant('tomato'), [], today);
    const seedling = buildTimeline(planting({ plantId: 'tomato', startMethod: 'seedling', plantedDate: '2026-09-01' }), plant('tomato'), [], today);
    assert.ok(seedling.items.find((i) => i.kind === 'first-harvest')!.date < seed.items.find((i) => i.kind === 'first-harvest')!.date);
    assert.equal(seedling.items.find((i) => i.kind === 'germination'), undefined);
  });

  it('includes journal notes in the timeline', () => {
    const p = planting({ plantId: 'tomato', startMethod: 'seedling', plantedDate: '2026-09-01' });
    const tl = buildTimeline(p, plant('tomato'), [{ id: 'j1', date: '2026-09-18', text: 'first flowers appeared', plantingId: p.id, createdAt: '2026-09-18T00:00:00Z' }], today);
    assert.ok(tl.items.some((i) => i.status === 'journal' && i.label === 'first flowers appeared'));
  });

  it('estimates growth stage and respects manual stages', () => {
    const p = planting({ plantId: 'lettuce', startMethod: 'direct-sow', plantedDate: '2026-07-01' });
    assert.equal(buildTimeline(p, plant('lettuce'), [], today).estimatedStage, 'harvesting');
    const manual = { ...p, stage: 'failed' as const, stageIsManual: true };
    assert.equal(buildTimeline(manual, plant('lettuce'), [], today).estimatedStage, 'failed');
    const justSown = planting({ plantId: 'carrot', plantedDate: '2026-09-23' });
    assert.equal(buildTimeline(justSown, plant('carrot'), [], today).estimatedStage, 'seed');
  });

  it('handles perennial trees with years to first crop', () => {
    const p = planting({ plantId: 'lemon', startMethod: 'tree', plantedDate: '2026-09-01' });
    const tl = buildTimeline(p, plant('lemon'), [], today);
    const fc = tl.items.find((i) => i.kind === 'first-crop')!;
    assert.ok(fc.date.startsWith('2028'));
    assert.match(describeProgress(tl), /likely/);
  });

  it('does not produce made-up milestones when data is missing', () => {
    const p = planting({ plantId: 'fig', startMethod: 'tree', plantedDate: '2026-09-01' });
    const tl = buildTimeline(p, plant('fig'), [], today);
    assert.deepEqual(tl.items.map((i) => i.kind), ['start']);
  });
});

import { buildCalendar, nextTwelveMonths } from '../src/domain/calendar';

describe('seasonal calendar', () => {
  it('shows the next 12 months across the year boundary', () => {
    const m = nextTwelveMonths('2026-09-24');
    assert.equal(m[0].key, '2026-09');
    assert.equal(m[4].key, '2027-01');
    assert.equal(m[11].key, '2027-08');
  });

  it('combines windows, expected harvests, wish list and upcoming succession sowings', () => {
    const cal = buildCalendar({
      today: '2026-09-24',
      zone: 'subtropical',
      plantings: [planting({ plantId: 'tomato', startMethod: 'seedling', plantedDate: '2026-09-10', stage: 'transplanted' })],
      journal: [],
      wishlistPlantIds: ['garlic'],
      successionPlans: [
        { id: 'sp', plantId: 'carrot', intervalDays: 28, defaultBatchQuantity: 20, status: 'active', batches: [{ index: 0, plannedDate: '2026-10-08', quantity: 20, status: 'planned' }], notes: [], createdAt: '', updatedAt: '' },
      ],
      tasks: [],
      getPlant,
    });
    const tomato = cal.rows.find((r) => r.plant.id === 'tomato')!;
    assert.equal(tomato.reason, 'growing');
    assert.ok(tomato.harvest.some(Boolean), 'expected harvest months shown');
    assert.ok(tomato.sow[0], 'September is in the subtropical tomato window');
    const garlic = cal.rows.find((r) => r.plant.id === 'garlic')!;
    assert.equal(garlic.reason, 'wishlist');
    assert.ok(garlic.plant_[7]); // April 2027 (index 7 from Sep)
    assert.ok(cal.upcoming.some((u) => u.kind === 'succession' && u.date === '2026-10-08'));
    assert.ok(cal.upcoming.every((u, i, a) => i === 0 || a[i - 1].date <= u.date));
  });
});

describe('timing basis', () => {
  it('counts transplanted crops from transplanting (seed-catalogue convention)', () => {
    const seedling = buildTimeline(planting({ plantId: 'tomato', startMethod: 'seedling', plantedDate: '2026-09-02' }), plant('tomato'), [], '2026-09-24');
    const fh = seedling.items.find((i) => i.kind === 'first-harvest')!;
    assert.ok(fh.date >= '2026-11-01', `tomato seedling first harvest ${fh.date} should not be before November`);
    const tray = buildTimeline(planting({ plantId: 'tomato', startMethod: 'seed-tray', plantedDate: '2026-09-02' }), plant('tomato'), [], '2026-09-24');
    assert.ok(tray.items.find((i) => i.kind === 'first-harvest')!.date > fh.date);
    // Direct-sown crops count from sowing.
    const carrot = buildTimeline(planting({ plantId: 'carrot', plantedDate: '2026-09-02' }), plant('carrot'), [], '2026-09-24');
    assert.equal(carrot.items.find((i) => i.kind === 'first-harvest')!.date, '2026-11-11'); // +70 days
  });
});
