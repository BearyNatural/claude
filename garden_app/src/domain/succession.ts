/**
 * Succession planting.
 *
 * Instead of one large sowing, suitable crops are sown in smaller batches at
 * intervals while the regional planting window remains open. Batch size comes
 * from the household production model; interval and number of batches adapt
 * to the gardener's goals, time and space. The gardener can accept, postpone,
 * skip, resize or stop — and future batches are recalculated.
 */
import { addDays, diffDays, formatDay } from './dates';
import type { PlantRecord } from './plantTypes';
import { estimateQuantity, type ProductionLevel } from './production';
import { footprintPerPlantM2 } from './space';
import type { ClimateZoneId, ISODate, SuccessionBatch, SuccessionPlan, TimeBudget } from './types';
import { primaryWindow, windowEndFrom, windowPosition } from './windows';

export interface SuccessionContext {
  zone: ClimateZoneId | null;
  startDate: ISODate;
  householdSize: number;
  level: ProductionLevel;
  timeBudget: TimeBudget;
  /** Free space in the chosen area (m²), when known. */
  freeAreaM2?: number | null;
  /** Safety limits. */
  maxBatches?: number;
  horizonDays?: number;
}

export interface SuccessionProposal {
  suitable: boolean;
  reason?: string;
  intervalDays: number;
  batchQuantity: number;
  unit: string;
  batches: { date: ISODate; quantity: number }[];
  windowEnd?: ISODate;
  notes: string[];
}

export const MAX_BATCHES_BY_TIME: Record<TimeBudget, number> = {
  lt1: 3,
  '1to2': 4,
  '2to4': 6,
  '4to8': 8,
  '8plus': 10,
};

export function isSuccessionSuited(plant: PlantRecord): boolean {
  return plant.production.successionIntervalDays !== undefined && plant.production.style !== 'long-lived';
}

/** Choose an interval in whole days from the plant's range. */
export function chooseInterval(plant: PlantRecord, level: ProductionLevel, time: TimeBudget): number {
  const r = plant.production.successionIntervalDays;
  if (!r) return 0;
  const [a, b] = r;
  if (time === 'lt1' || time === '1to2') return b; // fewer, less frequent sowings
  if (level === 'maximise') return a;
  const mid = (a + b) / 2;
  // Prefer whole weeks when the range allows — easier to remember.
  const weeks = Math.round(mid / 7) * 7;
  return weeks >= a && weeks <= b ? weeks : Math.round(mid);
}

export function proposeSuccession(plant: PlantRecord, ctx: SuccessionContext): SuccessionProposal {
  const unit = plant.production.unit ?? 'plants';
  const base: SuccessionProposal = { suitable: false, intervalDays: 0, batchQuantity: 0, unit, batches: [], notes: [] };
  if (!isSuccessionSuited(plant)) {
    return { ...base, reason: `${plant.commonName} isn't usually succession planted — one planting crops for a long time.` };
  }
  const win = primaryWindow(plant, ctx.zone);
  if (!win) return { ...base, reason: `No planting window is recorded for ${plant.commonName} in your climate zone yet.` };
  const pos = windowPosition(win.months, ctx.startDate);
  if (!pos.inWindow) {
    const when = pos.opensOn ? ` It opens around ${formatDay(pos.opensOn, ctx.startDate)}.` : '';
    return { ...base, reason: `The recommended window for ${plant.commonName} in your area isn't open yet.${when}` };
  }
  const windowEnd = windowEndFrom(win.months, ctx.startDate, ctx.horizonDays ?? 180)!;
  const interval = chooseInterval(plant, ctx.level, ctx.timeBudget);
  const est = estimateQuantity(plant, { householdSize: ctx.householdSize, level: ctx.level, timeBudget: ctx.timeBudget });
  let qty = Math.max(1, Math.round((est.range[0] + est.range[1]) / 2));
  const notes: string[] = [];

  const fp = footprintPerPlantM2(plant);
  if (ctx.freeAreaM2 !== undefined && ctx.freeAreaM2 !== null && fp) {
    const fit = Math.floor((ctx.freeAreaM2 * 1.1) / fp);
    if (fit <= 0) {
      return { ...base, reason: 'The chosen area looks full at the moment. Free up space or choose another area.' };
    }
    if (fit < qty) {
      notes.push(`Batch reduced from about ${qty} to ${fit} to fit the free space in this area.`);
      qty = fit;
    }
  }

  const maxBatches = Math.min(ctx.maxBatches ?? 12, MAX_BATCHES_BY_TIME[ctx.timeBudget]);
  const horizon = addDays(ctx.startDate, ctx.horizonDays ?? 180);
  const batches: { date: ISODate; quantity: number }[] = [];
  let d = ctx.startDate;
  while (d <= windowEnd && d <= horizon && batches.length < maxBatches) {
    batches.push({ date: d, quantity: qty });
    d = addDays(d, interval);
  }
  const last = batches[batches.length - 1];
  if (batches.length === maxBatches && d <= windowEnd) {
    notes.push(`Limited to ${maxBatches} sowings to keep the workload manageable for the time you have.`);
  } else if (!pos.allYear) {
    notes.push(`Last sowing around ${formatDay(last.date, ctx.startDate)} — the recommended window for your area closes at the end of ${formatDay(windowEnd, ctx.startDate).split(' ').slice(1).join(' ')}.`);
  }
  notes.push(`Sow about ${qty} ${unit} every ${describeInterval(interval)}. These are planning estimates; adjust to suit your harvest.`);
  return { suitable: true, intervalDays: interval, batchQuantity: qty, unit, batches, windowEnd, notes };
}

export function describeInterval(days: number): string {
  if (days % 7 === 0) {
    const w = days / 7;
    return w === 1 ? 'week' : `${w} weeks`;
  }
  return `${days} days`;
}

// ---------------------------------------------------------------------------
// Stored plan operations (pure: each returns a new plan)
// ---------------------------------------------------------------------------

export function planFromProposal(
  proposal: SuccessionProposal,
  meta: { id: string; plantId: string; areaId?: string; now: string },
): SuccessionPlan {
  return {
    id: meta.id,
    plantId: meta.plantId,
    areaId: meta.areaId,
    intervalDays: proposal.intervalDays,
    defaultBatchQuantity: proposal.batchQuantity,
    status: 'active',
    batches: proposal.batches.map((b, i) => ({ index: i, plannedDate: b.date, quantity: b.quantity, status: 'planned' })),
    notes: proposal.notes,
    createdAt: meta.now,
    updatedAt: meta.now,
  };
}

function touch(plan: SuccessionPlan, now: string, batches: SuccessionBatch[], extra: Partial<SuccessionPlan> = {}): SuccessionPlan {
  const reindexed = batches
    .slice()
    .sort((a, b) => (a.plannedDate < b.plannedDate ? -1 : a.plannedDate > b.plannedDate ? 1 : a.index - b.index))
    .map((b, i) => ({ ...b, index: i }));
  const hasPlanned = reindexed.some((b) => b.status === 'planned');
  const status = extra.status ?? (plan.status === 'active' && !hasPlanned ? 'completed' : plan.status);
  return { ...plan, ...extra, status, batches: reindexed, updatedAt: now };
}

export interface RecalcContext {
  zone: ClimateZoneId | null;
  plant: PlantRecord;
  now: string;
  horizonDays?: number;
  maxBatches?: number;
}

/**
 * Rebuild future "planned" batches from the latest acted-on batch (accepted
 * or skipped), keeping the interval and default quantity. Manual quantities
 * on surviving batch positions are preserved.
 */
export function recalculate(plan: SuccessionPlan, ctx: RecalcContext): SuccessionPlan {
  if (plan.status === 'stopped') return plan;
  const acted = plan.batches.filter((b) => b.status !== 'planned');
  const planned = plan.batches.filter((b) => b.status === 'planned');
  const win = primaryWindow(ctx.plant, ctx.zone);
  if (!win) return touch(plan, ctx.now, acted, { notes: [...plan.notes] });
  const anchor = acted.length ? acted.reduce((m, b) => (b.plannedDate > m ? b.plannedDate : m), acted[0].plannedDate) : null;
  let next = anchor ? addDays(anchor, plan.intervalDays) : planned[0]?.plannedDate;
  if (!next) return touch(plan, ctx.now, acted);
  const endFromAnchor = windowEndFrom(win.months, anchor ?? next, ctx.horizonDays ?? 180) ?? windowEndFrom(win.months, next, ctx.horizonDays ?? 180);
  const out: SuccessionBatch[] = [...acted];
  const limit = ctx.maxBatches ?? 12;
  let i = 0;
  while (endFromAnchor && next <= endFromAnchor && out.length < limit) {
    const prior = planned[i];
    out.push({
      index: 0,
      plannedDate: next,
      quantity: prior?.quantityIsManual ? prior.quantity : plan.defaultBatchQuantity,
      quantityIsManual: prior?.quantityIsManual,
      status: 'planned',
    });
    next = addDays(next, plan.intervalDays);
    i++;
  }
  return touch(plan, ctx.now, out);
}

export function acceptBatch(plan: SuccessionPlan, index: number, plantingId: string, actualDate: ISODate, ctx: RecalcContext): SuccessionPlan {
  const batches = plan.batches.map((b) =>
    b.index === index ? { ...b, status: 'accepted' as const, plantingId, plannedDate: actualDate } : b,
  );
  return recalculate({ ...plan, batches }, ctx);
}

export function skipBatch(plan: SuccessionPlan, index: number, ctx: RecalcContext): SuccessionPlan {
  const batches = plan.batches.map((b) => (b.index === index ? { ...b, status: 'skipped' as const } : b));
  return recalculate({ ...plan, batches }, ctx);
}

/** Postpone a batch (and everything after it) by `days`; batches past the window end are dropped. */
export function postponeBatch(plan: SuccessionPlan, index: number, days: number, ctx: RecalcContext): SuccessionPlan {
  const target = plan.batches.find((b) => b.index === index);
  if (!target || target.status !== 'planned') return plan;
  const win = primaryWindow(ctx.plant, ctx.zone);
  const from = target.plannedDate;
  const shifted = plan.batches.map((b) =>
    b.status === 'planned' && b.plannedDate >= from ? { ...b, plannedDate: addDays(b.plannedDate, days) } : b,
  );
  const end = win ? windowEndFrom(win.months, from, ctx.horizonDays ?? 180) : null;
  const kept = shifted.filter((b) => b.status !== 'planned' || (end !== null && b.plannedDate <= end));
  const dropped = shifted.length - kept.length;
  const notes = dropped > 0 ? [...plan.notes, `${dropped} later sowing${dropped > 1 ? 's were' : ' was'} removed because it would fall after the planting window closes.`] : plan.notes;
  return touch(plan, ctx.now, kept, { notes });
}

export function setBatchQuantity(plan: SuccessionPlan, index: number, quantity: number, applyToFuture: boolean, now: string): SuccessionPlan {
  const q = Math.max(1, Math.round(quantity));
  const target = plan.batches.find((b) => b.index === index);
  if (!target) return plan;
  const batches = plan.batches.map((b) => {
    if (b.index === index) return { ...b, quantity: q, quantityIsManual: true };
    if (applyToFuture && b.status === 'planned' && b.plannedDate > target.plannedDate) return { ...b, quantity: q, quantityIsManual: false };
    return b;
  });
  return touch(plan, now, batches, applyToFuture ? { defaultBatchQuantity: q } : {});
}

export function stopPlan(plan: SuccessionPlan, now: string): SuccessionPlan {
  return touch(plan, now, plan.batches.filter((b) => b.status !== 'planned'), { status: 'stopped' });
}

export function nextPlannedBatch(plan: SuccessionPlan): SuccessionBatch | undefined {
  if (plan.status !== 'active') return undefined;
  return plan.batches.filter((b) => b.status === 'planned').sort((a, b) => (a.plannedDate < b.plannedDate ? -1 : 1))[0];
}

export function daysUntil(batch: SuccessionBatch, today: ISODate): number {
  return diffDays(today, batch.plannedDate);
}
