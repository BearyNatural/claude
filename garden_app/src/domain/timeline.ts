/**
 * Planting timelines: estimated biological milestones that are progressively
 * replaced by the gardener's real observations.
 *
 * All estimates are ranges. Uncertain planting dates ("sometime around early
 * September") widen the ranges. When an actual milestone is recorded, later
 * estimates shift by the difference between what was expected and what
 * actually happened.
 */
import { addDays, diffDays, formatApproxRange, formatDay } from './dates';
import type { PlantRecord } from './plantTypes';
import type { GrowthStage, ISODate, JournalEntry, Planting, PlantingEventType } from './types';

export type MilestoneKind = 'germination' | 'transplant' | 'flowering' | 'first-harvest' | 'harvest-end' | 'first-crop';

export interface TimelineItem {
  key: string;
  kind: MilestoneKind | 'start' | 'journal' | 'event';
  label: string;
  date: ISODate;
  endDate?: ISODate;
  status: 'actual' | 'estimated' | 'journal';
  detail?: string;
}

export interface Timeline {
  items: TimelineItem[];
  estimatedStage: GrowthStage;
  /** The next upcoming estimated milestone, if any. */
  next?: TimelineItem;
  /** Extra ± days applied because the planting date is approximate. */
  uncertaintyDays: number;
}

const ACCURACY_DAYS = { exact: 0, 'approx-week': 7, 'approx-month': 15 } as const;

const ACTUAL_FOR: Partial<Record<MilestoneKind, PlantingEventType[]>> = {
  germination: ['germinated'],
  transplant: ['transplanted'],
  flowering: ['first-flower'],
  'first-harvest': ['first-harvest', 'harvest'],
};

const MILESTONE_LABELS: Record<MilestoneKind, string> = {
  germination: 'Germination',
  transplant: 'Ready to transplant',
  flowering: 'Flowering',
  'first-harvest': 'First harvest',
  'harvest-end': 'Harvest period ends',
  'first-crop': 'First meaningful crop',
};

const EVENT_LABELS: Record<PlantingEventType, string> = {
  sown: 'Seed sown',
  planted: 'Planted',
  germinated: 'Germinated',
  transplanted: 'Transplanted',
  'first-flower': 'First flowers',
  'fruit-set': 'Fruit set',
  'first-harvest': 'First harvest',
  harvest: 'Harvest',
  finished: 'Finished',
  removed: 'Removed',
  failed: 'Failed',
  'stage-change': 'Stage updated',
};

function mid(a: ISODate, b: ISODate): ISODate {
  return addDays(a, Math.round(diffDays(a, b) / 2));
}

/** Days to subtract from "from sowing" figures when a seedling was bought. */
function seedlingHeadStart(plant: PlantRecord): number {
  const t = plant.timing?.daysToTransplant;
  return t ? Math.round((t[0] + t[1]) / 2) : 35;
}

export function buildTimeline(planting: Planting, plant: PlantRecord | undefined, journal: readonly JournalEntry[], today: ISODate): Timeline {
  const unc = ACCURACY_DAYS[planting.dateAccuracy] ?? 0;
  const items: TimelineItem[] = [];
  const start = planting.plantedDate;
  const approx = unc > 0 ? ' (approximate date)' : '';
  const seedStart = planting.startMethod === 'direct-sow' || planting.startMethod === 'seed-tray';
  items.push({
    key: 'start',
    kind: 'start',
    label: seedStart ? 'Seed sown' : planting.startMethod === 'seedling' ? 'Seedling planted' : 'Planted',
    date: start,
    status: planting.stage === 'planned' ? 'estimated' : 'actual',
    detail: planting.stage === 'planned' ? 'Planned' : approx.trim() || undefined,
  });

  for (const e of planting.events) {
    if (e.type === 'sown' || e.type === 'planted') continue; // represented by start
    items.push({ key: `ev-${e.id}`, kind: 'event', label: EVENT_LABELS[e.type], date: e.date, status: 'actual', detail: e.note });
  }
  for (const j of journal) {
    if (j.plantingId !== planting.id) continue;
    items.push({ key: `j-${j.id}`, kind: 'journal', label: j.text, date: j.date, status: 'journal' });
  }

  if (plant && planting.stage !== 'planned') {
    const t = plant.timing;
    // Offsets for flowering/maturity depend on what the data counts from:
    //  - basis 'sowing': a bought seedling already has a head start;
    //  - basis 'transplant': seed raised in trays still needs to reach transplant size.
    const basis = t?.basis ?? 'sowing';
    const growthShift =
      basis === 'transplant'
        ? planting.startMethod === 'seed-tray' || planting.startMethod === 'direct-sow'
          ? seedlingHeadStart(plant)
          : 0
        : planting.startMethod === 'seedling'
          ? -seedlingHeadStart(plant)
          : 0;
    let shift = 0;
    const actualDate = (kind: MilestoneKind): ISODate | undefined => {
      const types = ACTUAL_FOR[kind];
      if (!types) return undefined;
      const ev = planting.events.filter((e) => types.includes(e.type)).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
      return ev?.date;
    };
    const milestone = (kind: MilestoneKind, range: [number, number] | undefined, growth: boolean) => {
      if (!range) return;
      const off = growth ? growthShift : 0;
      const lo = range[0] + off + shift;
      const hi = range[1] + off + shift;
      if (hi < 0) return; // already past before planting (e.g. germination for a bought seedling)
      const from = addDays(start, Math.max(0, lo) - unc);
      const to = addDays(start, Math.max(0, hi) + unc);
      const actual = actualDate(kind);
      if (actual) {
        shift += diffDays(mid(from, to), actual);
        return; // the actual event is already in items
      }
      items.push({
        key: `est-${kind}`,
        kind,
        label: `${MILESTONE_LABELS[kind]} (estimated)`,
        date: from,
        endDate: to,
        status: 'estimated',
        detail: `Likely ${formatApproxRange(from, to)}`,
      });
    };

    if (seedStart) milestone('germination', plant.germination?.days, false);
    if (planting.startMethod === 'seed-tray') milestone('transplant', t?.daysToTransplant, false);
    milestone('flowering', t?.daysToFlower, true);
    milestone('first-harvest', t?.daysToMaturity, true);
    const fh = items.find((i) => i.kind === 'first-harvest');
    const fhActual = actualDate('first-harvest');
    const hw = plant.production.harvestWindowDays;
    if (hw && (fh || fhActual) && plant.production.style !== 'long-lived') {
      const e1 = addDays(fhActual ?? fh!.date, hw[0]);
      const e2 = addDays(fhActual ?? fh!.endDate ?? fh!.date, hw[1]);
      items.push({
        key: 'est-harvest-end',
        kind: 'harvest-end',
        label: 'Productive period ends (estimated)',
        date: e1,
        endDate: e2,
        status: 'estimated',
        detail: `Harvests likely continue until ${formatApproxRange(e1, e2)}`,
      });
    }
    if (t?.yearsToFirstCrop) {
      const from = addDays(start, Math.round(t.yearsToFirstCrop[0] * 365));
      const to = addDays(start, Math.round(t.yearsToFirstCrop[1] * 365));
      items.push({
        key: 'est-first-crop',
        kind: 'first-crop',
        label: 'First meaningful crop (estimated)',
        date: from,
        endDate: to,
        status: 'estimated',
        detail: `Typically ${t.yearsToFirstCrop[0]}–${t.yearsToFirstCrop[1]} years after planting`,
      });
    }
  }

  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.status === 'actual' ? -1 : 1));
  // "Next" = the first estimate whose likely (middle) date is still ahead.
  const next = items.find((i) => i.status === 'estimated' && i.kind !== 'start' && mid(i.date, i.endDate ?? i.date) >= today);
  return { items, estimatedStage: estimateStage(planting, items, today), next, uncertaintyDays: unc };
}

/** Estimate the growth stage from timeline items and actual events. */
export function estimateStage(planting: Planting, items: readonly TimelineItem[], today: ISODate): GrowthStage {
  if (planting.stageIsManual) return planting.stage;
  if (planting.stage === 'planned' || today < planting.plantedDate) return 'planned';
  const reached = (kind: MilestoneKind) => {
    const it = items.find((i) => i.kind === kind && i.status === 'estimated');
    if (it) return today >= mid(it.date, it.endDate ?? it.date);
    return false;
  };
  const happened = (t: PlantingEventType) => planting.events.some((e) => e.type === t && e.date <= today);
  if (happened('finished')) return 'finished';
  if (happened('first-harvest') || happened('harvest') || reached('first-harvest')) return 'harvesting';
  if (happened('fruit-set')) return 'fruiting';
  if (happened('first-flower') || reached('flowering')) return 'flowering';
  if (happened('transplanted')) {
    const tr = planting.events.find((e) => e.type === 'transplanted')!;
    return diffDays(tr.date, today) < 14 ? 'transplanted' : 'established';
  }
  const seedStart = planting.startMethod === 'direct-sow' || planting.startMethod === 'seed-tray';
  if (!seedStart) return diffDays(planting.plantedDate, today) < 14 ? 'transplanted' : 'established';
  if (happened('germinated') || reached('germination')) {
    return diffDays(planting.plantedDate, today) < 35 ? 'seedling' : 'established';
  }
  return diffDays(planting.plantedDate, today) <= 3 ? 'seed' : 'germinating';
}

export const STAGE_LABELS: Record<GrowthStage, string> = {
  planned: 'Planned',
  seed: 'Seed sown',
  germinating: 'Germinating',
  seedling: 'Seedling',
  transplanted: 'Recently transplanted',
  established: 'Established',
  flowering: 'Flowering',
  fruiting: 'Fruiting',
  harvesting: 'Harvesting',
  dormant: 'Dormant',
  finished: 'Finished',
  removed: 'Removed',
  failed: 'Failed',
};

/** Short, honest status line like "Likely flowering — first harvest likely mid to late November". */
export function describeProgress(tl: Timeline): string {
  const stage = STAGE_LABELS[tl.estimatedStage];
  if (!tl.next) return stage;
  const when = tl.next.endDate ? formatApproxRange(tl.next.date, tl.next.endDate) : formatDay(tl.next.date);
  return `${stage} · ${tl.next.label.replace(' (estimated)', '').toLowerCase()} likely ${when}`;
}
