/**
 * Seasonal calendar data: per-plant month bands for the next 12 months
 * (sowing/planting windows, expected flowering and harvest from actual
 * plantings) plus a dated list of upcoming events (succession sowings,
 * planned plantings, estimated milestones and tasks).
 */
import { addDays, diffDays, makeDate, monthOf, yearOf } from './dates';
import type { PlantRecord } from './plantTypes';
import { isActive } from './space';
import { buildTimeline } from './timeline';
import type { ClimateZoneId, GardenTask, ISODate, JournalEntry, Month, Planting, SuccessionPlan } from './types';
import { normaliseMonths } from './windows';

export interface CalendarMonth {
  key: string; // YYYY-MM
  month: Month;
  year: number;
  label: string;
}

export interface CalendarRow {
  plant: PlantRecord;
  reason: 'growing' | 'wishlist' | 'suggested';
  sow: boolean[];
  plant_: boolean[];
  flowering: boolean[];
  harvest: boolean[];
}

export interface UpcomingEvent {
  date: ISODate;
  endDate?: ISODate;
  kind: 'succession' | 'planned' | 'milestone' | 'task';
  label: string;
  estimated: boolean;
  plantingId?: string;
  planId?: string;
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function nextTwelveMonths(today: ISODate): CalendarMonth[] {
  const out: CalendarMonth[] = [];
  let y = yearOf(today);
  let m = monthOf(today) as number;
  for (let i = 0; i < 12; i++) {
    out.push({ key: `${y}-${String(m).padStart(2, '0')}`, month: m as Month, year: y, label: `${SHORT[m - 1]}${m === 1 || i === 0 ? ` ${y}` : ''}` });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function markRange(months: CalendarMonth[], from: ISODate, to: ISODate): boolean[] {
  return months.map((cm) => {
    const start = makeDate(cm.year, cm.month, 1);
    const end = addDays(makeDate(cm.month === 12 ? cm.year + 1 : cm.year, cm.month === 12 ? 1 : cm.month + 1, 1), -1);
    return from <= end && to >= start;
  });
}

function or(a: boolean[], b: boolean[]): boolean[] {
  return a.map((x, i) => x || b[i]);
}

export interface CalendarInput {
  today: ISODate;
  zone: ClimateZoneId | null;
  plantings: Planting[];
  journal: JournalEntry[];
  wishlistPlantIds: string[];
  successionPlans: SuccessionPlan[];
  tasks: GardenTask[];
  getPlant: (id: string) => PlantRecord | undefined;
  horizonDays?: number;
}

export function buildCalendar(input: CalendarInput): { months: CalendarMonth[]; rows: CalendarRow[]; upcoming: UpcomingEvent[] } {
  const months = nextTwelveMonths(input.today);
  const rows = new Map<string, CalendarRow>();
  const empty = () => months.map(() => false);
  const ensure = (plant: PlantRecord, reason: CalendarRow['reason']) => {
    let row = rows.get(plant.id);
    if (!row) {
      const w = input.zone ? plant.windows[input.zone] : undefined;
      const sowSet = new Set(normaliseMonths(w?.sow));
      const plantSet = new Set(normaliseMonths(w?.plant));
      const hm = input.zone ? new Set(plant.timing?.harvestMonths?.[input.zone] ?? []) : new Set<number>();
      row = {
        plant,
        reason,
        sow: months.map((m) => sowSet.has(m.month)),
        plant_: months.map((m) => plantSet.has(m.month)),
        flowering: empty(),
        harvest: months.map((m) => hm.has(m.month)),
      };
      rows.set(plant.id, row);
    }
    return row;
  };

  const upcoming: UpcomingEvent[] = [];
  const horizon = addDays(input.today, input.horizonDays ?? 60);

  for (const p of input.plantings) {
    const plant = input.getPlant(p.plantId);
    if (!plant) continue;
    if (p.stage === 'planned') {
      ensure(plant, 'growing');
      if (p.plantedDate <= horizon) upcoming.push({ date: p.plantedDate, kind: 'planned', label: `${p.startMethod === 'direct-sow' || p.startMethod === 'seed-tray' ? 'Sow' : 'Plant'} ${plant.commonName.toLowerCase()} (planned)`, estimated: false, plantingId: p.id });
      continue;
    }
    if (!isActive(p)) continue;
    const row = ensure(plant, 'growing');
    const tl = buildTimeline(p, plant, input.journal, input.today);
    for (const it of tl.items) {
      if (it.status !== 'estimated') continue;
      const end = it.endDate ?? it.date;
      if (it.kind === 'flowering') row.flowering = or(row.flowering, markRange(months, it.date, end));
      if (it.kind === 'first-harvest') {
        const he = tl.items.find((x) => x.kind === 'harvest-end');
        row.harvest = or(row.harvest, markRange(months, it.date, he?.endDate ?? end));
      }
      const likely = addDays(it.date, Math.round(diffDays(it.date, end) / 2));
      if (likely >= input.today && it.date <= horizon && it.kind !== 'harvest-end') {
        upcoming.push({ date: it.date, endDate: it.endDate, kind: 'milestone', label: `${plant.commonName}: ${it.label.replace(' (estimated)', '').toLowerCase()}`, estimated: true, plantingId: p.id });
      }
    }
    const harvestedActual = p.events.find((e) => e.type === 'first-harvest');
    if (harvestedActual) {
      const he = tl.items.find((x) => x.kind === 'harvest-end');
      row.harvest = or(row.harvest, markRange(months, harvestedActual.date, he?.endDate ?? addDays(harvestedActual.date, 30)));
    }
  }

  for (const id of input.wishlistPlantIds) {
    const plant = input.getPlant(id);
    if (plant) ensure(plant, 'wishlist');
  }

  for (const sp of input.successionPlans) {
    if (sp.status !== 'active') continue;
    const plant = input.getPlant(sp.plantId);
    if (!plant) continue;
    ensure(plant, 'growing');
    for (const b of sp.batches) {
      if (b.status === 'planned' && b.plannedDate <= horizon) {
        upcoming.push({ date: b.plannedDate, kind: 'succession', label: `Sow about ${b.quantity} ${plant.commonName.toLowerCase()} (succession)`, estimated: false, planId: sp.id });
      }
    }
  }

  for (const t of input.tasks) {
    if (t.kind === 'succession-sow' || t.id.startsWith('planned:')) continue; // already listed
    upcoming.push({ date: t.dueDate, kind: 'task', label: t.title, estimated: false, plantingId: t.plantingId });
  }

  upcoming.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const order = { growing: 0, wishlist: 1, suggested: 2 };
  const sortedRows = [...rows.values()].sort((a, b) => order[a.reason] - order[b.reason] || a.plant.commonName.localeCompare(b.plant.commonName));
  return { months, rows: sortedRows, upcoming };
}
