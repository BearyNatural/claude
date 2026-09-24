/**
 * Garden task generation — "What should I do this week?"
 *
 * Tasks are derived from the actual garden (plantings, their estimated or
 * recorded stages, succession plans, planting-system steps, wish list) and
 * refined by the forecast. Task ids are deterministic so the gardener's
 * responses (done / skip / snooze / not relevant) persist across regeneration.
 *
 * Tone rules: no "overdue" pile-ups. Missed optional tasks simply fade out of
 * their window; important ones are phrased as "still worth doing".
 */
import { addDays, describeOffset, diffDays, formatDay, monthOf, weekdayOf } from './dates';
import type { PlantRecord } from './plantTypes';
import { isActive } from './space';
import { nextPlannedBatch } from './succession';
import { buildTimeline, type Timeline } from './timeline';
import type {
  ClimateZoneId,
  GardenArea,
  GardenTask,
  ISODate,
  JournalEntry,
  Planting,
  SuccessionPlan,
  TaskResponse,
  WishListItem,
} from './types';
import { WEATHER_THRESHOLDS, type WeatherAssessment } from './weather';
import { primaryWindow, windowPosition } from './windows';

export interface TaskContext {
  today: ISODate;
  zone: ClimateZoneId | null;
  weather: WeatherAssessment;
  areas: GardenArea[];
  plantings: Planting[];
  journal: JournalEntry[];
  successionPlans: SuccessionPlan[];
  wishlist: WishListItem[];
  responses: TaskResponse[];
  getPlant: (id: string) => PlantRecord | undefined;
}

/** Rough minutes per task — BearyNatural planning heuristics. */
export const TASK_MINUTES = {
  sowBase: 10,
  sowPerPlant: 0.3,
  transplantBase: 5,
  transplantPerPlant: 1,
  thin: 10,
  water: 10,
  feed: 10,
  mulch: 15,
  stake: 15,
  hill: 15,
  harvest: 10,
  frost: 15,
  heat: 10,
  rain: 5,
  inspect: 15,
  prepareBed: 45,
  buySeed: 10,
} as const;

/** Monday of the week containing `date` — used to bucket weekly tasks. */
export function weekKey(date: ISODate): ISODate {
  const wd = weekdayOf(date); // 0 Sun..6 Sat
  const back = (wd + 6) % 7;
  return addDays(date, -back);
}

function sowMinutes(qty: number): number {
  return Math.min(30, Math.round(TASK_MINUTES.sowBase + TASK_MINUTES.sowPerPlant * qty));
}

function lower(p: PlantRecord): string {
  return p.commonName.toLowerCase();
}

function areaName(ctx: TaskContext, id?: string): string {
  const a = id ? ctx.areas.find((x) => x.id === id) : undefined;
  return a ? ` in ${a.name}` : '';
}

/** Latest response per task id. */
export function responseIndex(responses: readonly TaskResponse[]): Map<string, TaskResponse> {
  const m = new Map<string, TaskResponse>();
  for (const r of responses) {
    const prev = m.get(r.taskId);
    if (!prev || prev.at <= r.at) m.set(r.taskId, r);
  }
  return m;
}

export function isHiddenByResponse(task: GardenTask, r: TaskResponse | undefined, today: ISODate): boolean {
  if (!r) return false;
  if (r.status === 'snoozed') return !!r.until && today < r.until;
  return true; // done, skipped, irrelevant
}

const PRIORITY_RANK = { important: 0, soon: 1, optional: 2 } as const;

export function generateTasks(ctx: TaskContext): GardenTask[] {
  const { today, weather } = ctx;
  const tasks: GardenTask[] = [];
  const wk = weekKey(today);
  const timelines = new Map<string, Timeline>();
  const active = ctx.plantings.filter((p) => isActive(p));

  const recentlyPlanted: { p: Planting; plant: PlantRecord }[] = [];
  const frostTender: { p: Planting; plant: PlantRecord }[] = [];
  const heatSensitive: { p: Planting; plant: PlantRecord }[] = [];

  for (const p of active) {
    const plant = ctx.getPlant(p.plantId);
    if (!plant) continue;
    const tl = buildTimeline(p, plant, ctx.journal, today);
    timelines.set(p.id, tl);
    const age = diffDays(p.plantedDate, today);
    if (age < 0) continue;
    const name = lower(plant);
    const where = areaName(ctx, p.areaId);
    const hasEvent = (t: string) => p.events.some((e) => e.type === t);
    const stage = tl.estimatedStage;

    // Transplant seedlings raised in trays.
    const tr = tl.items.find((i) => i.kind === 'transplant' && i.status === 'estimated');
    if (p.startMethod === 'seed-tray' && tr && !hasEvent('transplanted')) {
      const end = tr.endDate ?? tr.date;
      if (today >= addDays(tr.date, -3) && today <= addDays(end, 21)) {
        tasks.push({
          id: `transplant:${p.id}`,
          kind: 'transplant',
          section: 'plant',
          priority: today > end ? 'important' : 'soon',
          title: `Transplant ${name} seedlings`,
          short: `transplant ${name}`,
          detail: 'Harden them off for a few days first by putting the tray outside for a little longer each day.',
          why: `Sown ${describeOffset(-age)}; seedlings are likely ready ${tr.detail?.replace('Likely ', '') ?? 'about now'}.`,
          dueDate: today > tr.date ? today : tr.date,
          minutes: Math.min(40, TASK_MINUTES.transplantBase + TASK_MINUTES.transplantPerPlant * p.quantity),
          plantingId: p.id,
          plantId: plant.id,
          areaId: p.areaId,
        });
      }
    }

    // Thin direct-sown seedlings.
    const germ = tl.items.find((i) => i.kind === 'germination');
    const germEnd = hasEvent('germinated') ? p.events.find((e) => e.type === 'germinated')!.date : germ?.endDate;
    if (p.startMethod === 'direct-sow' && plant.care?.thin && germEnd) {
      if (today >= addDays(germEnd, 7) && today <= addDays(germEnd, 28)) {
        tasks.push({
          id: `thin:${p.id}`,
          kind: 'thin',
          section: 'care',
          priority: 'soon',
          title: `Thin ${name} seedlings${where}`,
          short: `thin ${name}`,
          detail: plant.spacing?.plantCm ? `Leave about ${plant.spacing.plantCm[0]}–${plant.spacing.plantCm[1]} cm between plants.` : undefined,
          why: 'Crowded seedlings compete and give smaller harvests.',
          dueDate: today,
          minutes: TASK_MINUTES.thin,
          plantingId: p.id,
          plantId: plant.id,
          areaId: p.areaId,
        });
      }
    }

    // Recently planted out (for watering / heat checks).
    const transplantedAt = p.events.find((e) => e.type === 'transplanted')?.date;
    const plantedOut = transplantedAt ?? (p.startMethod !== 'direct-sow' && p.startMethod !== 'seed-tray' ? p.plantedDate : undefined);
    if (plantedOut && diffDays(plantedOut, today) >= 0 && diffDays(plantedOut, today) <= 14) recentlyPlanted.push({ p, plant });
    if (plant.climate.frost === 'tender' && stage !== 'dormant') frostTender.push({ p, plant });
    if (age <= 42 || plant.climate.boltsInHeat) heatSensitive.push({ p, plant });

    // Harvest.
    const fh = tl.items.find((i) => i.kind === 'first-harvest');
    const he = tl.items.find((i) => i.kind === 'harvest-end');
    const harvestActual = p.events.find((e) => e.type === 'first-harvest' || e.type === 'harvest')?.date;
    const harvestStart = harvestActual ?? fh?.date;
    const harvestStop = he?.endDate ?? (fh?.endDate ? addDays(fh.endDate, 30) : undefined);
    if (harvestStart && today >= harvestStart && (!harvestStop || today <= harvestStop) && !hasEvent('finished')) {
      const repeat = plant.production.style !== 'single-harvest';
      const ripe = harvestActual || stage === 'harvesting';
      tasks.push({
        id: `harvest:${p.id}:${wk}`,
        kind: 'harvest',
        section: 'harvest',
        priority: repeat || ripe ? 'important' : 'soon',
        title: harvestActual ? `Harvest ${name}${where}` : `Check ${name} — likely ready for harvest`,
        short: `harvest ${name}`,
        detail: repeat ? 'Regular picking usually keeps plants producing.' : 'Pull a test one to check size before harvesting the rest.',
        why: harvestActual ? 'You recorded harvesting has started.' : `Estimated harvest from ${formatDay(fh!.date)} based on sowing date and typical maturity.`,
        dueDate: today,
        minutes: TASK_MINUTES.harvest,
        plantingId: p.id,
        plantId: plant.id,
        areaId: p.areaId,
      });
    }
    // Long-lived plants: seasonal harvest months.
    const hm = ctx.zone ? plant.timing?.harvestMonths?.[ctx.zone] : undefined;
    const yearsOk = !plant.timing?.yearsToFirstCrop || age >= plant.timing.yearsToFirstCrop[0] * 365;
    if (hm && yearsOk && hm.includes(monthOf(today))) {
      tasks.push({
        id: `harvest:${p.id}:${wk}`,
        kind: 'harvest',
        section: 'harvest',
        priority: 'soon',
        title: `Check ${name} for ripe fruit`,
        short: `pick ${name}`,
        why: 'This is the usual harvest season for your area.',
        dueDate: today,
        minutes: TASK_MINUTES.harvest,
        plantingId: p.id,
        plantId: plant.id,
        areaId: p.areaId,
      });
    }

    // Feeding at intervals during active growth.
    const fi = plant.feeding?.intervalDays;
    if (fi && age >= 21 && ['established', 'flowering', 'fruiting', 'harvesting', 'transplanted', 'seedling'].includes(stage)) {
      const bucket = Math.floor((age - 21) / fi);
      const due = addDays(p.plantedDate, 21 + bucket * fi);
      if (diffDays(due, today) <= 7) {
        tasks.push({
          id: `feed:${p.id}:${bucket}`,
          kind: 'feed',
          section: 'care',
          priority: plant.feeding?.level === 'heavy' ? 'soon' : 'optional',
          title: `Feed ${name}${where}`,
          short: `feed ${name}`,
          detail: plant.feeding?.notes,
          why: `${plant.commonName} is a ${plant.feeding?.level} feeder; a feed about every ${Math.round(fi / 7)} weeks during growth is typical.`,
          dueDate: due < today ? today : due,
          minutes: TASK_MINUTES.feed,
          plantingId: p.id,
          plantId: plant.id,
          areaId: p.areaId,
        });
      }
    }

    // Staking / trellis.
    if ((plant.support === 'stake' || plant.support === 'trellis' || plant.support === 'cage') && age >= 14 && age <= 45) {
      tasks.push({
        id: `stake:${p.id}`,
        kind: 'stake',
        section: 'care',
        priority: 'soon',
        title: `${plant.support === 'trellis' ? 'Set up a trellis for' : 'Stake'} ${name}${where}`,
        short: `${plant.support === 'trellis' ? 'trellis' : 'stake'} ${name}`,
        why: 'Supporting plants while young avoids damaging roots and stems later.',
        dueDate: today,
        minutes: TASK_MINUTES.stake,
        plantingId: p.id,
        plantId: plant.id,
        areaId: p.areaId,
      });
    }

    // Mulch once established.
    if (plant.care?.mulch && age >= 14 && age <= 42) {
      tasks.push({
        id: `mulch:${p.id}`,
        kind: 'mulch',
        section: 'care',
        priority: weather.heatDays.length ? 'soon' : 'optional',
        title: `Mulch around ${name}${where}`,
        short: `mulch ${name}`,
        detail: 'Keep mulch a few centimetres away from stems.',
        why: weather.heatDays.length ? 'Hot weather is forecast — mulch helps keep roots cool and moist.' : 'Mulch holds soil moisture and suppresses weeds.',
        dueDate: today,
        minutes: TASK_MINUTES.mulch,
        plantingId: p.id,
        plantId: plant.id,
        areaId: p.areaId,
      });
    }

    // Hilling (potatoes).
    if (plant.care?.hill && age >= 21 && age <= 84) {
      const bucket = Math.floor((age - 21) / 21);
      tasks.push({
        id: `hill:${p.id}:${bucket}`,
        kind: 'hill',
        section: 'care',
        priority: 'soon',
        title: `Hill up ${name}${where}`,
        short: `hill ${name}`,
        detail: 'Mound soil or compost around the stems, leaving the top leaves exposed.',
        why: 'Hilling protects developing tubers from light (which turns them green) and gives more room to form.',
        dueDate: today,
        minutes: TASK_MINUTES.hill,
        plantingId: p.id,
        plantId: plant.id,
        areaId: p.areaId,
      });
    }
  }

  // Grouped watering of recently planted seedlings — weather-aware.
  if (recentlyPlanted.length) {
    const names = [...new Set(recentlyPlanted.map((x) => lower(x.plant)))];
    const rain = weather.rainNext24hMm;
    const rainSoon = rain !== undefined && rain >= WEATHER_THRESHOLDS.meaningfulRainMm;
    const heatSoon = weather.heatDays.some((d) => diffDays(today, d) <= 2);
    tasks.push({
      id: `water-new:${today}`,
      kind: 'water',
      section: 'care',
      priority: 'important',
      title: rainSoon ? 'Check soil moisture around new plantings before watering' : heatSoon ? 'Water new plantings deeply before the heat' : 'Water recently planted seedlings',
      detail: rainSoon
        ? `Rain is forecast tomorrow (about ${Math.round(rain!)} mm). Check the soil with a finger first — forecast rain isn't the same as moist soil, and it may not fall.`
        : `Newly planted: ${names.join(', ')}.`,
      why: 'Young transplants have small root systems and dry out quickly in their first couple of weeks.',
      dueDate: today,
      minutes: TASK_MINUTES.water,
      timeCritical: true,
    });
  }

  // Frost protection.
  const frostSoon = weather.frostDays.filter((d) => diffDays(today, d) >= 0 && diffDays(today, d) <= 3);
  if (frostSoon.length && frostTender.length) {
    const d = frostSoon[0];
    const low = weather.upcoming.find((x) => x.date === d)?.minC;
    const names = [...new Set(frostTender.map((x) => lower(x.plant)))];
    tasks.push({
      id: `frost:${d}`,
      kind: 'frost-protect',
      section: 'protect',
      priority: 'important',
      title: `Protect frost-tender plants ${diffDays(today, d) <= 0 ? 'tonight' : `before ${formatDay(d)}`}`,
      detail: `Cover ${names.join(', ')} overnight (frost cloth, old sheets or upturned pots) and water the soil during the day. Remove covers in the morning.`,
      why: `Forecast low of about ${low}°C — frost is possible at ground level.${weather.caveat ? ` ${weather.caveat}` : ''}`,
      dueDate: addDays(d, -1) < today ? today : addDays(d, -1),
      minutes: TASK_MINUTES.frost,
      timeCritical: true,
    });
  }

  // Heat protection.
  const heatSoonDays = weather.heatDays.filter((d) => diffDays(today, d) >= 0 && diffDays(today, d) <= 3);
  if (heatSoonDays.length && heatSensitive.length) {
    const d = heatSoonDays[0];
    const hi = weather.upcoming.find((x) => x.date === d)?.maxC;
    const names = [...new Set(heatSensitive.map((x) => lower(x.plant)))].slice(0, 6);
    tasks.push({
      id: `heat:${d}`,
      kind: 'heat-protect',
      section: 'protect',
      priority: 'important',
      title: `Prepare for hot weather on ${formatDay(d)}`,
      detail: `Water deeply in the morning, mulch, and give temporary shade to young or sensitive plants (${names.join(', ')}). Move pots out of full afternoon sun.`,
      why: `Forecast maximum around ${hi}°C.${weather.caveat ? ` ${weather.caveat}` : ''}`,
      dueDate: addDays(d, -1) < today ? today : addDays(d, -1),
      minutes: TASK_MINUTES.heat,
      timeCritical: true,
    });
  }

  // Heavy rain.
  const rainDays = weather.heavyRainDays.filter((d) => diffDays(today, d) >= 0 && diffDays(today, d) <= 2);
  const newlySown = active.some((p) => p.startMethod === 'direct-sow' && diffDays(p.plantedDate, today) <= 14);
  const hasPots = ctx.areas.some((a) => !a.archived && (a.type === 'pot' || a.type === 'large-container' || a.type === 'balcony'));
  if (rainDays.length && (newlySown || hasPots)) {
    const d = rainDays[0];
    tasks.push({
      id: `rain:${d}`,
      kind: 'rain-check',
      section: 'protect',
      priority: 'optional',
      title: 'Heavy rain forecast — check drainage',
      detail: `${newlySown ? 'Newly sown seed can wash out; a light cover of mulch or shade cloth helps. ' : ''}${hasPots ? 'Make sure pots can drain freely.' : ''}`.trim(),
      why: `About ${Math.round(weather.upcoming.find((x) => x.date === d)?.precipitationMm ?? 25)} mm forecast ${describeOffset(diffDays(today, d))}.`,
      dueDate: today,
      minutes: TASK_MINUTES.rain,
      timeCritical: true,
    });
  }

  // Succession sowings.
  for (const plan of ctx.successionPlans) {
    const b = nextPlannedBatch(plan);
    const plant = ctx.getPlant(plan.plantId);
    if (!b || !plant) continue;
    const until = diffDays(today, b.plannedDate);
    if (until > 7) continue;
    tasks.push({
      id: `succession:${plan.id}:${b.plannedDate}`,
      kind: 'succession-sow',
      section: 'plant',
      priority: until <= 0 ? 'important' : 'soon',
      title: `Sow the next ${lower(plant)} batch (about ${b.quantity})${areaName(ctx, plan.areaId)}`,
      short: `sow the next ${lower(plant)} batch`,
      why: `Part of your succession plan — small, regular sowings give a steady supply. ${until < 0 ? 'Still worth sowing if the window is open.' : ''}`.trim(),
      dueDate: until < 0 ? today : b.plannedDate,
      minutes: sowMinutes(b.quantity),
      plantId: plant.id,
      areaId: plan.areaId,
      successionPlanId: plan.id,
      successionBatchIndex: b.index,
    });
  }

  // Planned plantings (including planting-system steps).
  for (const p of ctx.plantings) {
    if (p.stage !== 'planned') continue;
    const plant = ctx.getPlant(p.plantId);
    if (!plant) continue;
    const until = diffDays(today, p.plantedDate);
    if (until > 5 || until < -21) continue;
    const trigger = p.system ? p.notes : undefined;
    tasks.push({
      id: `planned:${p.id}`,
      kind: p.system ? 'system-step' : 'sow',
      section: 'plant',
      priority: until <= 0 ? 'important' : 'soon',
      title: `${p.startMethod === 'direct-sow' || p.startMethod === 'seed-tray' ? 'Sow' : 'Plant'} ${lower(plant)}${areaName(ctx, p.areaId)}`,
      short: `${p.startMethod === 'direct-sow' || p.startMethod === 'seed-tray' ? 'sow' : 'plant'} ${lower(plant)}`,
      detail: trigger,
      why: p.system ? 'Next step in your planting system.' : `You planned this for ${formatDay(p.plantedDate)}.`,
      dueDate: until < 0 ? today : p.plantedDate,
      minutes: sowMinutes(p.quantity),
      plantingId: p.id,
      plantId: plant.id,
      areaId: p.areaId,
    });
  }

  // Wish list.
  const growing = new Set(active.map((p) => p.plantId));
  const hasEmptyArea = ctx.areas.some((a) => !a.archived && !active.some((p) => p.areaId === a.id));
  for (const w of ctx.wishlist) {
    const plant = ctx.getPlant(w.plantId);
    if (!plant || growing.has(plant.id)) continue;
    const win = primaryWindow(plant, ctx.zone);
    if (!win) continue;
    const pos = windowPosition(win.months, today);
    if (pos.inWindow && !pos.allYear) {
      tasks.push({
        id: `wish-now:${plant.id}:${today.slice(0, 7)}`,
        kind: 'sow',
        section: 'plant',
        priority: 'optional',
        title: `${plant.commonName} from your wish list can be ${win.kind === 'sow' ? 'sown' : 'planted'} now`,
        short: `${win.kind} ${lower(plant)}`,
        why: pos.closesOn ? `The recommended period in your area runs until the end of ${formatDay(pos.closesOn).split(' ')[1]}.` : 'It is in its recommended period for your area.',
        dueDate: today,
        minutes: sowMinutes(10),
        plantId: plant.id,
      });
    } else if (!pos.inWindow && pos.daysUntilOpen !== undefined && pos.daysUntilOpen <= 42) {
      tasks.push({
        id: `wish-soon:${plant.id}:${pos.opensOn}`,
        kind: 'buy-seed',
        section: 'prepare',
        priority: 'optional',
        title: `Get ready for ${lower(plant)}`,
        short: `get ${lower(plant)} ready`,
        detail: `${plant.startMethods[0] === 'clove-or-bulb' ? 'Buy planting cloves/bulbs' : plant.startMethods[0] === 'tree' ? 'Choose a tree and a spot' : 'Buy seed or seedlings'}${hasEmptyArea ? '' : ' and plan where it will go'}.`,
        why: `${plant.commonName} is on your wish list. Your recommended planting period starts ${describeOffset(pos.daysUntilOpen)}.`,
        dueDate: today,
        minutes: TASK_MINUTES.buySeed,
        plantId: plant.id,
      });
      if (pos.daysUntilOpen <= 21 && !hasEmptyArea && ctx.areas.length > 0) {
        tasks.push({
          id: `prepare:${plant.id}:${pos.opensOn}`,
          kind: 'prepare-bed',
          section: 'prepare',
          priority: 'optional',
          title: `Prepare a space for ${lower(plant)}`,
          short: `prepare a bed for ${lower(plant)}`,
          detail: plant.amendments?.find((a) => a.kind === 'add')?.advice,
          why: 'Your garden areas are currently in use; preparing a spot now makes planting day easier.',
          dueDate: today,
          minutes: TASK_MINUTES.prepareBed,
          plantId: plant.id,
        });
      }
    }
  }

  // Weekly walk-around.
  if (active.length) {
    tasks.push({
      id: `inspect:${wk}`,
      kind: 'inspect',
      section: 'care',
      priority: 'optional',
      title: 'Walk around and check your plants',
      short: 'check your plants',
      detail: 'Look under leaves for pests, check soil moisture and note anything new in your journal.',
      why: 'Catching problems early is the easiest way to keep them small.',
      dueDate: today,
      minutes: TASK_MINUTES.inspect,
    });
  }

  // De-duplicate by id and apply the gardener's responses.
  const byId = new Map<string, GardenTask>();
  for (const t of tasks) if (!byId.has(t.id)) byId.set(t.id, t);
  const responses = responseIndex(ctx.responses);
  return [...byId.values()]
    .filter((t) => !isHiddenByResponse(t, responses.get(t.id), today))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

export const SECTION_LABELS = {
  plant: 'Plant',
  harvest: 'Harvest',
  care: 'Care',
  protect: 'Protect',
  prepare: 'Prepare',
} as const;
