import { ISODate, addDays, formatDate } from '../dates';
import { Cents, formatMoney, roundCents } from '../money';
import { FREQUENCY_DAYS, Frequency, PER_LABEL } from '../periods';
import { nthOccurrence, occurrences } from '../schedule';
import { equivalentPeriodicRate } from './compound';

export type GoalType = 'emergency-fund' | 'property' | 'land' | 'holiday' | 'vehicle' | 'renovation' | 'retirement' | 'custom';

export const GOAL_TYPE_LABEL: Record<GoalType, string> = {
  'emergency-fund': 'Emergency fund',
  property: 'Property',
  land: 'Land',
  holiday: 'Holiday',
  vehicle: 'Vehicle',
  renovation: 'Renovation',
  retirement: 'Retirement',
  custom: 'Custom goal',
};

export interface Goal {
  id: string;
  name: string;
  type: GoalType;
  targetCents: Cents;
  currentCents: Cents;
  targetDate?: ISODate | null;
  contributionCents: Cents;
  contributionFrequency: Frequency;
  /** Assumed interest on the saved amount (% p.a., compounded monthly). */
  annualRatePercent: number;
  oneOffs?: { date: ISODate; amountCents: Cents }[];
}

export interface GoalProjection {
  remainingCents: Cents;
  progress: number;
  projectedDate: ISODate | null;
  periodsNeeded: number | null;
  contributionsToTargetCents: Cents;
  interestToTargetCents: Cents;
  requiredContributionCents: Cents | null;
  reachesTargetByDate: boolean | null;
  explanation: string;
}

const MAX_PERIODS = 100 * 365;

/**
 * Projects when a goal would be reached with the entered contributions and assumed interest,
 * and what regular contribution would reach it by the target date. Arithmetic only.
 */
export function projectGoal(g: Goal, today: ISODate): GoalProjection {
  const remaining = Math.max(0, g.targetCents - g.currentCents);
  const progress = g.targetCents > 0 ? Math.min(1, g.currentCents / g.targetCents) : 1;
  const i = equivalentPeriodicRate(g.annualRatePercent, 'monthly', g.contributionFrequency);
  const schedule = { frequency: g.contributionFrequency, anchor: today };
  const oneOffs = [...(g.oneOffs ?? [])].filter((o) => o.date >= today).sort((a, b) => a.date.localeCompare(b.date));

  let projectedDate: ISODate | null = null;
  let periods: number | null = null;
  let balance = g.currentCents;
  let contributions = 0;
  let interest = 0;
  if (remaining === 0) {
    projectedDate = today;
    periods = 0;
  } else if (g.contributionCents > 0 || i > 0 || oneOffs.length) {
    let o = 0;
    const limit = Math.min(MAX_PERIODS, Math.ceil((100 * 365.25) / FREQUENCY_DAYS[g.contributionFrequency]));
    for (let p = 1; p <= limit; p++) {
      const date = nthOccurrence(schedule, p);
      const inter = balance * i;
      interest += inter;
      balance += inter + g.contributionCents;
      contributions += g.contributionCents;
      while (o < oneOffs.length && oneOffs[o].date <= date) {
        balance += oneOffs[o].amountCents;
        contributions += oneOffs[o].amountCents;
        o++;
      }
      if (balance >= g.targetCents) {
        projectedDate = date;
        periods = p;
        break;
      }
    }
  }

  let required: Cents | null = null;
  let byDate: boolean | null = null;
  if (g.targetDate && g.targetDate > today) {
    // Number of contribution dates after today up to and including the target date.
    const contributionsBetween = (from: ISODate, to: ISODate) => occurrences(schedule, addDays(from, 1), to).length;
    const n = Math.max(1, contributionsBetween(today, g.targetDate));
    const grow = Math.pow(1 + i, n);
    const oneOffFuture = oneOffs
      .filter((x) => x.date <= g.targetDate!)
      .reduce((a, x) => a + x.amountCents * Math.pow(1 + i, contributionsBetween(x.date, g.targetDate!)), 0);
    const shortfall = g.targetCents - g.currentCents * grow - oneOffFuture;
    required = shortfall <= 0 ? 0 : Math.ceil(i === 0 ? shortfall / n : (shortfall * i) / (grow - 1));
    byDate = projectedDate !== null && projectedDate <= g.targetDate;
  }

  const per = PER_LABEL[g.contributionFrequency];
  let explanation: string;
  if (remaining === 0) explanation = 'The target amount has been reached.';
  else if (!projectedDate) explanation = `With ${formatMoney(g.contributionCents)} ${per} and ${g.annualRatePercent}% assumed interest, the target is not reached within 100 years.`;
  else explanation = `With ${formatMoney(g.contributionCents)} ${per} and ${g.annualRatePercent}% assumed interest (compounded monthly), the balance would reach ${formatMoney(g.targetCents)} around ${formatDate(projectedDate)}, after ${periods} contributions.`;
  if (required !== null && g.targetDate) explanation += ` Reaching it by ${formatDate(g.targetDate)} would take about ${formatMoney(required)} ${per} under the same assumptions.`;

  return {
    remainingCents: remaining,
    progress,
    projectedDate,
    periodsNeeded: periods,
    contributionsToTargetCents: roundCents(contributions),
    interestToTargetCents: roundCents(interest),
    requiredContributionCents: required,
    reachesTargetByDate: byDate,
    explanation,
  };
}
