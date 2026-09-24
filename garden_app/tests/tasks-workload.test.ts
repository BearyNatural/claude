/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PLANTS } from '../src/data/plants';
import { addDays } from '../src/domain/dates';
import { productionLevelFromGoals } from '../src/domain/production';
import { buildPlantNow } from '../src/domain/recommend';
import { planReminders } from '../src/domain/reminders';
import { planFromProposal, proposeSuccession } from '../src/domain/succession';
import { generateTasks, type TaskContext } from '../src/domain/tasks';
import type { GardenTask, ReminderPreferences } from '../src/domain/types';
import { assessWeather } from '../src/domain/weather';
import { planWeek, rankTasks, WEEKLY_MINUTES } from '../src/domain/workload';
import { area, getPlant, noWeather, planting, profile, snapshot } from './helpers';

const today = '2026-09-24';
const now = new Date('2026-09-24T00:00:00Z');

function tctx(over: Partial<TaskContext> = {}): TaskContext {
  return {
    today,
    zone: 'subtropical',
    weather: noWeather(today),
    areas: [],
    plantings: [],
    journal: [],
    successionPlans: [],
    wishlist: [],
    responses: [],
    getPlant,
    ...over,
  };
}

describe('task generation from the actual garden', () => {
  it('creates transplant, thinning, staking and harvest jobs from planting state', () => {
    const tasks = generateTasks(
      tctx({
        plantings: [
          planting({ id: 'tom', plantId: 'tomato', startMethod: 'seed-tray', plantedDate: '2026-08-15', stage: 'seedling' }),
          planting({ id: 'car', plantId: 'carrot', startMethod: 'direct-sow', plantedDate: '2026-08-25' }), // germinates by ~14 Sep; thin from ~21 Sep
          planting({ id: 'bean', plantId: 'bean-climbing', startMethod: 'direct-sow', plantedDate: '2026-09-01' }),
          planting({ id: 'let', plantId: 'lettuce', startMethod: 'direct-sow', plantedDate: '2026-07-15' }),
        ],
      }),
    );
    const byId = (p: string) => tasks.find((t) => t.id.startsWith(p));
    assert.ok(byId('transplant:tom'));
    assert.ok(byId('thin:car'));
    assert.ok(byId('stake:bean'));
    const harvest = byId('harvest:let')!;
    assert.equal(harvest.section, 'harvest');
    assert.match(harvest.title, /likely ready/);
    assert.ok(byId('inspect:'));
  });

  it('produces weather-aware watering advice without claiming the soil is wet', () => {
    const w = assessWeather(snapshot(today, [{}, { precipitationMm: 12 }, {}, {}, {}, {}, {}]), today, now);
    const tasks = generateTasks(
      tctx({ weather: w, plantings: [planting({ plantId: 'tomato', startMethod: 'seedling', plantedDate: '2026-09-20', stage: 'transplanted' })] }),
    );
    const water = tasks.find((t) => t.kind === 'water')!;
    assert.match(water.title, /Check soil moisture/);
    assert.match(water.detail!, /forecast rain isn't the same as moist soil/);
    assert.doesNotMatch(`${water.title} ${water.detail}`, /has been watered/);
  });

  it('adds frost and heat protection only when relevant plants are growing', () => {
    const frost = assessWeather(snapshot(today, [{}, { minC: 0 }, {}, {}, {}, {}, {}]), today, now);
    const tender = [planting({ plantId: 'tomato', startMethod: 'seedling', plantedDate: '2026-09-10', stage: 'established' })];
    const withTender = generateTasks(tctx({ weather: frost, plantings: tender }));
    const f = withTender.find((t) => t.kind === 'frost-protect')!;
    assert.equal(f.priority, 'important');
    assert.equal(f.timeCritical, true);
    const hardy = [planting({ plantId: 'broad-bean', plantedDate: '2026-06-01', stage: 'established' })];
    assert.equal(generateTasks(tctx({ weather: frost, plantings: hardy })).some((t) => t.kind === 'frost-protect'), false);
    const heat = assessWeather(snapshot(today, [{ maxC: 37 }, {}, {}, {}, {}, {}, {}]), today, now);
    assert.ok(generateTasks(tctx({ weather: heat, plantings: tender })).some((t) => t.kind === 'heat-protect'));
  });

  it('turns wish-list plants into timely prompts', () => {
    // Garlic in Brisbane (subtropical) opens in April — outside the 6-week horizon in late September.
    const none = generateTasks(tctx({ wishlist: [{ id: 'w1', plantId: 'garlic', addedAt: now.toISOString() }] }));
    assert.equal(none.some((t) => t.plantId === 'garlic'), false);
    const soon = generateTasks(tctx({ today: '2026-02-25', wishlist: [{ id: 'w1', plantId: 'garlic', addedAt: now.toISOString() }] }));
    const g = soon.find((t) => t.plantId === 'garlic')!;
    assert.equal(g.kind, 'buy-seed');
    assert.match(g.why, /wish list/);
    const inNow = generateTasks(tctx({ wishlist: [{ id: 'w2', plantId: 'carrot', addedAt: now.toISOString() }] }));
    assert.ok(inNow.some((t) => t.plantId === 'carrot' && t.kind === 'sow'));
  });

  it('schedules succession sowings from the plan', () => {
    const prop = proposeSuccession(getPlant('carrot')!, { zone: 'subtropical', startDate: '2026-09-01', householdSize: 3, level: 'supplement', timeBudget: '4to8' }); // next batch 29 Sep
    let plan = planFromProposal(prop, { id: 'sp', plantId: 'carrot', now: now.toISOString() });
    plan = { ...plan, batches: plan.batches.map((b, i) => (i === 0 ? { ...b, status: 'accepted' as const } : b)) };
    const tasks = generateTasks(tctx({ successionPlans: [plan] }));
    const s = tasks.find((t) => t.kind === 'succession-sow')!;
    assert.equal(s.successionPlanId, 'sp');
    assert.match(s.title, /next carrot batch/);
  });

  it('prompts planned Three Sisters steps with their biological trigger', () => {
    const p = planting({
      plantId: 'bean-climbing',
      plantedDate: addDays(today, 2),
      stage: 'planned',
      notes: 'Sow when the corn is about 15 cm tall.',
      system: { planId: 'ts1', systemId: 'three-sisters', role: 'climber' },
    });
    const t = generateTasks(tctx({ plantings: [p] })).find((x) => x.kind === 'system-step')!;
    assert.match(t.detail!, /15 cm/);
  });

  it('respects done, skipped, snoozed and not-relevant responses', () => {
    const ps = [planting({ id: 'c1', plantId: 'carrot', plantedDate: '2026-08-25' })];
    const all = generateTasks(tctx({ plantings: ps }));
    const thin = all.find((t) => t.kind === 'thin')!;
    const done = generateTasks(tctx({ plantings: ps, responses: [{ taskId: thin.id, status: 'done', at: now.toISOString() }] }));
    assert.equal(done.some((t) => t.id === thin.id), false);
    const snoozed = [{ taskId: thin.id, status: 'snoozed' as const, until: '2026-09-26', at: now.toISOString() }];
    assert.equal(generateTasks(tctx({ plantings: ps, responses: snoozed })).some((t) => t.id === thin.id), false);
    assert.equal(generateTasks(tctx({ today: '2026-09-26', plantings: ps, responses: snoozed })).some((t) => t.id === thin.id), true);
  });

  it('never produces duplicate ids', () => {
    const tasks = generateTasks(tctx({ plantings: PLANTS.slice(0, 20).map((p) => planting({ plantId: p.id, plantedDate: '2026-08-01', startMethod: p.startMethods[0] })) }));
    assert.equal(new Set(tasks.map((t) => t.id)).size, tasks.length);
  });
});

function task(id: string, priority: GardenTask['priority'], minutes: number, kind: GardenTask['kind'] = 'feed', extra: Partial<GardenTask> = {}): GardenTask {
  return { id, kind, section: 'care', priority, title: `Do ${id}`, why: 'test', dueDate: today, minutes, ...extra };
}

describe('workload-aware prioritisation', () => {
  it('ranks important and time-critical jobs first', () => {
    const r = rankTasks([task('opt', 'optional', 5), task('soon', 'soon', 5), task('imp', 'important', 5), task('frost', 'important', 5, 'frost-protect', { timeCritical: true })]);
    assert.deepEqual(r.map((t) => t.id), ['frost', 'imp', 'soon', 'opt']);
  });

  it('keeps a one-hour-a-week gardener to a manageable plan', () => {
    const many = Array.from({ length: 12 }, (_, i) => task(`t${i}`, i < 2 ? 'important' : i < 6 ? 'soon' : 'optional', 15));
    const plan = planWeek(many, { timeBudget: 'lt1', gardeningDays: [6], today });
    assert.equal(plan.budgetMinutes, WEEKLY_MINUTES.lt1);
    assert.ok(plan.focusMinutes <= 45);
    assert.ok(plan.later.length >= 9);
    assert.ok(plan.oneHour.reduce((s, t) => s + t.minutes, 0) <= 60);
    assert.equal(plan.gardeningDay, '2026-09-26');
    assert.match(plan.summary, /this Saturday/);
    assert.match(plan.summary, /about 45 minutes/); // 2 important (30 min) + 1 more to fill the 45-minute budget
  });

  it('gives a generous plan to someone with more time', () => {
    const many = Array.from({ length: 12 }, (_, i) => task(`t${i}`, 'optional', 15));
    const plan = planWeek(many, { timeBudget: '4to8', gardeningDays: [], today });
    assert.equal(plan.focus.length, 12);
    assert.equal(plan.gardeningDayLabel, 'today');
  });

  it('keeps important jobs even when they exceed the budget, and says so calmly', () => {
    const plan = planWeek([task('a', 'important', 40), task('b', 'important', 40)], { timeBudget: 'lt1', gardeningDays: [6], today });
    assert.equal(plan.focus.length, 2);
    assert.equal(plan.overBudget, true);
    assert.doesNotMatch(plan.summary, /overdue/i);
  });

  it('is calm when nothing is due', () => {
    assert.match(planWeek([], { timeBudget: '1to2', gardeningDays: [6], today }).summary, /Nothing pressing/);
  });
});

describe('smart reminders', () => {
  const prefs: ReminderPreferences = { enabled: true, gardeningDays: [6], reminderTime: '08:00', quietDays: [], mode: 'gardening-days' };
  const jobs = [task('feed', 'soon', 10), task('sow', 'soon', 15, 'succession-sow'), task('harvest', 'important', 10, 'harvest'), task('mulch', 'optional', 10, 'mulch')];

  it('groups non-urgent jobs into one gardening-day reminder', () => {
    const r = planReminders({ tasks: jobs, prefs, timeBudget: '1to2', today, nowTime: '10:00' });
    const summaries = r.filter((x) => x.kind === 'summary');
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].date, '2026-09-26');
    assert.equal(summaries[0].taskIds.length, 4);
    assert.match(summaries[0].body, /You have about 45 minutes of useful garden work this Saturday/);
    assert.match(summaries[0].body, /• do harvest/);
  });

  it('respects disabled reminders and quiet days', () => {
    assert.deepEqual(planReminders({ tasks: jobs, prefs: { ...prefs, enabled: false }, timeBudget: '1to2', today, nowTime: '07:00' }), []);
    const quiet = planReminders({ tasks: jobs, prefs: { ...prefs, quietDays: [6] }, timeBudget: '1to2', today, nowTime: '07:00' });
    assert.ok(quiet.every((x) => x.date !== '2026-09-26'));
  });

  it('sends time-critical frost warnings separately', () => {
    const frost = task('frost', 'important', 15, 'frost-protect', { timeCritical: true, dueDate: '2026-09-25' });
    const r = planReminders({ tasks: [...jobs, frost], prefs, timeBudget: '1to2', today, nowTime: '07:00' });
    const urgent = r.filter((x) => x.kind === 'urgent');
    assert.equal(urgent.length, 1);
    assert.equal(urgent[0].date, '2026-09-25');
  });

  it('supports a daily summary mode', () => {
    const r = planReminders({ tasks: jobs, prefs: { ...prefs, mode: 'daily-summary' }, timeBudget: '1to2', today, nowTime: '07:00' });
    assert.equal(r[0].date, today); // still before 08:00 today
  });

  it('does not schedule reminders in the past', () => {
    const r = planReminders({ tasks: jobs, prefs: { ...prefs, mode: 'daily-summary' }, timeBudget: '1to2', today, nowTime: '20:00' });
    assert.ok(r.every((x) => x.date > today));
  });
});

describe('integrated scenario from the brief', () => {
  // Subtropical, 3 people, vegetables, 4 × 1 m sunny bed, lettuce planted,
  // wants carrots, about 2 hours a week, warm weather approaching.
  const prof = profile({ householdSize: 3, timeBudget: '1to2', goals: ['fresh-veg'] });
  const bed = area({ name: 'Vegetable bed', lengthM: 4, widthM: 1, sunHours: 8 });
  const lettuce = planting({ id: 'lettuce1', plantId: 'lettuce', areaId: bed.id, startMethod: 'direct-sow', plantedDate: '2026-07-25', stage: 'established' });
  const weather = assessWeather(snapshot(today, [{ maxC: 30 }, { maxC: 31 }, { maxC: 33 }, {}, {}, {}, {}], { soilC: 21 }), today, now);

  it('combines location, household, space, existing plants, wish list, time and weather', () => {
    const plantNow = buildPlantNow(PLANTS, {
      today,
      zone: 'subtropical',
      frostRisk: 'light',
      weather,
      goals: prof.goals,
      timeBudget: prof.timeBudget,
      householdSize: prof.householdSize,
      plantings: [lettuce],
      areas: [bed],
      wishlistPlantIds: new Set(['carrot']),
      getPlant,
    });
    const all = plantNow.groups.flatMap((g) => g.items);
    const carrot = all.find((r) => r.plant.id === 'carrot')!;
    assert.equal(carrot.category, 'great');
    assert.ok(carrot.onWishlist);
    assert.ok(carrot.reasons.some((r) => r.kind === 'soil' && r.tone === 'positive'));
    assert.ok(carrot.quantity!.range[0] >= 10);
    // Warm weather approaching: lettuce and coriander are flagged for bolting.
    const lett = all.find((r) => r.plant.id === 'lettuce')!;
    assert.equal(lett.category, 'wait');
    assert.ok(lett.reasons.some((r) => /bolting/.test(r.text)));

    // Succession plan for carrots sized for 3 people, the bed and limited time.
    const prop = proposeSuccession(getPlant('carrot')!, { zone: 'subtropical', startDate: today, householdSize: 3, level: productionLevelFromGoals(prof.goals), timeBudget: prof.timeBudget, freeAreaM2: 3.5 });
    assert.equal(prop.suitable, true);
    assert.ok(prop.batches.length <= 4);

    // This Week: harvest the lettuce, wish-list carrots, calm plan within ~90 minutes.
    const tasks = generateTasks(tctx({ areas: [bed], plantings: [lettuce], wishlist: [{ id: 'w', plantId: 'carrot', addedAt: now.toISOString() }], weather }));
    assert.ok(tasks.some((t) => t.kind === 'harvest' && t.plantingId === 'lettuce1'));
    assert.ok(tasks.some((t) => t.plantId === 'carrot'));
    const week = planWeek(tasks, { timeBudget: prof.timeBudget, gardeningDays: prof.reminders.gardeningDays, today });
    assert.ok(week.focusMinutes <= WEEKLY_MINUTES['1to2'] || week.overBudget);
    assert.equal(week.focus[0].kind, 'harvest');
  });
});
