import { Cents, formatMoney, roundCents } from '../money';
import { FREQUENCY_LABEL, Frequency, PERIODS_PER_YEAR } from '../periods';

/**
 * Compound growth under stated assumptions. Returns are never guaranteed; the result
 * separates money contributed from estimated growth so the assumption's effect is visible.
 */

export interface CompoundInput {
  openingCents: Cents;
  contributionCents: Cents;
  contributionFrequency: Frequency;
  /** Assumed annual interest or return, e.g. 4.5 for 4.5% p.a. May be zero or negative. */
  annualRatePercent: number;
  compounding: Frequency;
  years: number;
  /** Contributions at the start or end of each period (default end). */
  timing?: 'start' | 'end';
  /** Optional yearly increase in the contribution amount (%). */
  contributionIncreasePercent?: number;
}

export interface CompoundYear {
  year: number;
  contributedCents: Cents;
  growthCents: Cents;
  balanceCents: Cents;
}

export interface CompoundResult {
  finalCents: Cents;
  openingCents: Cents;
  totalContributionsCents: Cents;
  growthCents: Cents;
  periodicRate: number;
  periods: number;
  years: CompoundYear[];
  assumptions: string[];
  explanation: string;
}

/** Equivalent rate per contribution period for a nominal annual rate compounded m times a year. */
export function equivalentPeriodicRate(annualRatePercent: number, compounding: Frequency, contributionFrequency: Frequency): number {
  const r = annualRatePercent / 100;
  const m = PERIODS_PER_YEAR[compounding];
  const k = PERIODS_PER_YEAR[contributionFrequency];
  if (r === 0) return 0;
  return Math.pow(1 + r / m, m / k) - 1;
}

export function compoundGrowth(input: CompoundInput): CompoundResult {
  const k = PERIODS_PER_YEAR[input.contributionFrequency];
  const i = equivalentPeriodicRate(input.annualRatePercent, input.compounding, input.contributionFrequency);
  const n = Math.max(0, Math.round(input.years * k));
  const timing = input.timing ?? 'end';
  let balance = input.openingCents;
  let contributed = 0;
  let contribution = input.contributionCents;
  const years: CompoundYear[] = [];
  let yearContrib = 0;
  let yearStartBalance = balance;
  for (let p = 1; p <= n; p++) {
    if (timing === 'start') {
      balance += contribution;
      balance *= 1 + i;
    } else {
      balance *= 1 + i;
      balance += contribution;
    }
    contributed += contribution;
    yearContrib += contribution;
    if (p % k === 0 || p === n) {
      const bal = roundCents(balance);
      years.push({ year: Math.ceil(p / k), contributedCents: roundCents(yearContrib), growthCents: roundCents(bal - yearStartBalance - yearContrib), balanceCents: bal });
      yearStartBalance = bal;
      yearContrib = 0;
      if (input.contributionIncreasePercent) contribution = contribution * (1 + input.contributionIncreasePercent / 100);
    }
  }
  const finalCents = roundCents(balance);
  const totalContributions = roundCents(contributed);
  const growth = finalCents - input.openingCents - totalContributions;
  const assumptions = [
    `Starting amount: ${formatMoney(input.openingCents)}`,
    `Contribution: ${formatMoney(input.contributionCents)} ${FREQUENCY_LABEL[input.contributionFrequency].toLowerCase()} (${timing === 'start' ? 'start' : 'end'} of each period)` +
      (input.contributionIncreasePercent ? `, increasing ${input.contributionIncreasePercent}% a year` : ''),
    `Assumed rate: ${input.annualRatePercent}% a year, compounded ${FREQUENCY_LABEL[input.compounding].toLowerCase()} — an assumption, not a guaranteed return`,
    `Duration: ${input.years} year${input.years === 1 ? '' : 's'}`,
  ];
  return {
    finalCents,
    openingCents: input.openingCents,
    totalContributionsCents: totalContributions,
    growthCents: growth,
    periodicRate: i,
    periods: n,
    years,
    assumptions,
    explanation:
      `Each ${FREQUENCY_LABEL[input.contributionFrequency].toLowerCase()} period the balance grows by ${(i * 100).toFixed(4)}% ` +
      `(the ${input.annualRatePercent}% annual rate converted to this period with ${FREQUENCY_LABEL[input.compounding].toLowerCase()} compounding), ` +
      `then the contribution is added. Over ${n} periods: ${formatMoney(totalContributions)} contributed and ${formatMoney(growth)} estimated growth.`,
  };
}
