/**
 * Household food-production planning.
 *
 * Quantities are *planning estimates* derived from each plant's production
 * profile (data), the household size, the gardener's goals and available time.
 * Crops are deliberately NOT all multiplied by household size:
 *   - single-harvest crops (carrots) scale per person, per sowing batch
 *   - repeat-harvest crops (zucchini) often have a fixed base and a low cap
 *   - long-lived producers (fruit trees) use a household base, never per person
 */
import type { PlantRecord, ProductionStyle } from './plantTypes';
import type { GardeningGoal, Range, TimeBudget } from './types';

export type ProductionLevel = 'some' | 'supplement' | 'maximise';

export const LEVEL_FACTOR: Record<ProductionLevel, number> = {
  some: 0.6,
  supplement: 1,
  maximise: 1.5,
};

/** Factor applied to medium/high-maintenance crops for limited time budgets. */
export const TIME_FACTOR: Record<TimeBudget, number> = {
  lt1: 0.5,
  '1to2': 0.75,
  '2to4': 1,
  '4to8': 1,
  '8plus': 1,
};

export function productionLevelFromGoals(goals: readonly GardeningGoal[]): ProductionLevel {
  if (goals.includes('maximise') || goals.includes('self-sufficiency')) return 'maximise';
  if (goals.includes('supplement')) return 'supplement';
  return 'some';
}

export interface QuantityInput {
  householdSize: number;
  level: ProductionLevel;
  timeBudget: TimeBudget;
}

export interface QuantityEstimate {
  /** Suggested plants per sowing batch (or total for long-lived crops). */
  range: Range;
  unit: string;
  style: ProductionStyle;
  /** Plain-language explanation of how the estimate was made. */
  explanation: string;
  /** Always true — rendered as "approximately" in the UI. */
  isEstimate: true;
  capped: boolean;
}

/** Round to sensible gardening numbers: exact below 10, then nearest 5. */
export function roundPlants(n: number): number {
  if (n <= 0) return 0;
  if (n < 10) return Math.max(1, Math.round(n));
  return Math.round(n / 5) * 5;
}

export function estimateQuantity(plant: PlantRecord, input: QuantityInput): QuantityEstimate {
  const p = plant.production;
  const people = Math.max(1, Math.min(20, Math.round(input.householdSize || 1)));
  const base = p.householdBase ?? [0, 0];
  const per = p.plantsPerPerson ?? [0, 0];
  const level = p.style === 'long-lived' ? 1 : LEVEL_FACTOR[input.level];
  const time = p.maintenance === 'low' ? 1 : TIME_FACTOR[input.timeBudget];
  let lo = (base[0] + per[0] * people) * level * time;
  let hi = (base[1] + per[1] * people) * level * time;
  let capped = false;
  const cap = p.maxPlantsPerHousehold;
  if (cap !== undefined) {
    if (hi > cap) {
      hi = cap;
      capped = true;
    }
    if (lo > cap) lo = cap;
  }
  let rLo = roundPlants(lo);
  let rHi = roundPlants(hi);
  if (rLo === 0) rLo = 1;
  if (rHi < rLo) rHi = rLo;
  const unit = p.unit ?? 'plants';

  const parts: string[] = [];
  switch (p.style) {
    case 'single-harvest':
      parts.push(`Each ${singularUnit(unit)} is harvested once, so this is sized for one batch for ${people === 1 ? 'one person' : `${people} people`}.`);
      if (p.successionIntervalDays) parts.push('Smaller, repeated sowings give a steadier supply than one big planting.');
      break;
    case 'repeat-harvest':
      parts.push('Each plant keeps producing for weeks, so fewer plants go a long way.');
      break;
    case 'cut-and-come-again':
      parts.push('You pick leaves as you need them and plants keep regrowing.');
      break;
    case 'long-lived':
      parts.push('A long-lived plant — the number doesn\'t grow with household size.');
      break;
  }
  if (capped) parts.push(`More than about ${cap} rarely helps a home garden.`);
  if (time < 1) parts.push('Scaled down to suit the time you have available.');
  parts.push('This is a planning estimate — germination, weather, pests, soil and variety all change the result.');

  return { range: [rLo, rHi], unit, style: p.style, explanation: parts.join(' '), isEstimate: true, capped };
}

function singularUnit(unit: string): string {
  const first = unit.split(' ')[0];
  return first.endsWith('ies') ? `${first.slice(0, -3)}y` : first.endsWith('s') ? first.slice(0, -1) : first;
}

export function formatRange(r: Range, unit?: string): string {
  const txt = r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`;
  if (!unit) return `approximately ${txt}`;
  const u = r[0] === 1 && r[1] === 1 ? unit.replace(/^(\S+)/, (w) => singularUnit(w)) : unit;
  return `approximately ${txt} ${u}`;
}

export function midpoint(r: Range): number {
  return (r[0] + r[1]) / 2;
}
