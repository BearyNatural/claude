/**
 * Pests and plant problems: which ones a plant is likely to get, and what to do
 * — natural steps first (prevent, remove by hand, encourage helpful insects),
 * then home-made or organic sprays, and a chemical only as a last resort.
 * Pure functions over data (src/data/pests.ts); no I/O.
 */
import { addDays } from './dates';
import type { PlantCategory, PlantFamily, PlantRecord } from './plantTypes';
import type { ISODate } from './types';

export type ProblemKind = 'insect' | 'mite' | 'snail' | 'disease' | 'disorder';

/** Order of preference: earlier steps first; 'chemical' only when the others aren't enough. */
export type RemedyStep = 'prevent' | 'by-hand' | 'helpers' | 'home-spray' | 'organic-spray' | 'chemical';

export const REMEDY_STEP_LABELS: Record<RemedyStep, string> = {
  prevent: 'Prevent it',
  'by-hand': 'Remove or block it',
  helpers: 'Bring in natural helpers',
  'home-spray': 'Home-made spray',
  'organic-spray': 'Organic product',
  chemical: 'Last resort: chemical',
};

const STEP_ORDER: RemedyStep[] = ['prevent', 'by-hand', 'helpers', 'home-spray', 'organic-spray', 'chemical'];

export interface Remedy {
  step: RemedyStep;
  text: string;
  /** Repeat every n days while the problem is active. */
  repeatDays?: number;
  /** e.g. "Don't spray above 25 °C" or "Also kills ladybirds". */
  caution?: string;
  sourceIds: string[];
}

export interface PlantProblem {
  id: string;
  name: string;
  aliases: string[];
  kind: ProblemKind;
  /** What you'd notice. */
  signs: string;
  /** Which plants it affects: any match counts. */
  affects: { plantIds?: string[]; families?: PlantFamily[]; categories?: PlantCategory[] };
  /** Days until it's worth checking again after logging it. */
  checkAgainDays: number;
  remedies: Remedy[];
  sourceIds: string[];
}

export function problemAffects(problem: PlantProblem, plant: PlantRecord): boolean {
  const a = problem.affects;
  return !!(
    a.plantIds?.includes(plant.id) ||
    (plant.family && a.families?.includes(plant.family)) ||
    a.categories?.some((c) => plant.categories.includes(c))
  );
}

/** Problems a plant commonly gets, most specific first (named plant, then family, then type). */
export function problemsFor(plant: PlantRecord, problems: readonly PlantProblem[]): PlantProblem[] {
  const rank = (p: PlantProblem) => (p.affects.plantIds?.includes(plant.id) ? 0 : plant.family && p.affects.families?.includes(plant.family) ? 1 : 2);
  return problems.filter((p) => problemAffects(p, plant)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Remedies in order of preference — natural first, chemical last. */
export function remedyPlan(problem: PlantProblem): Remedy[] {
  return [...problem.remedies].sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step));
}

/** Search problems by name or alias (for "it's not in the list"). */
export function searchProblems(query: string, problems: readonly PlantProblem[]): PlantProblem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...problems];
  return problems.filter((p) => p.name.toLowerCase().includes(q) || p.aliases.some((a) => a.toLowerCase().includes(q)));
}

/** When to look again after logging a problem on a given day. */
export function checkAgainDate(problem: PlantProblem | undefined, seen: ISODate): ISODate {
  return addDays(seen, problem?.checkAgainDays ?? 7);
}
