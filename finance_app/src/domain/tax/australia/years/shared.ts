import { Bracket, StudyLoanRule, TaxYearRules } from '../types';
import { SOURCES } from '../sources';

export const LITO = { max: 700, fullTo: 37500, firstTaper: 0.05, secondFrom: 45000, secondBase: 325, secondTaper: 0.015, cutOut: 66667 };
const GST = { rate: 0.1, registrationThreshold: 75000 };
const CGT = { individualDiscount: 0.5, minimumOwnershipMonths: 12 };

/** Resident brackets since 2024–25; only the lowest rate has changed since. */
export const residentBrackets = (lowRate: number): Bracket[] => [
  { over: 18200, rate: lowRate },
  { over: 45000, rate: 0.3 },
  { over: 135000, rate: 0.37 },
  { over: 190000, rate: 0.45 },
];

export const HELP_2026_27: StudyLoanRule = {
  kind: 'marginal',
  nilTo: 69528,
  tiers: [{ over: 69528, base: 0, rate: 0.15 }, { over: 129717, base: 9028, rate: 0.17 }],
  flatFrom: 186051,
  flatRate: 0.1,
};

export function common(fy: string): Pick<TaxYearRules, 'fy' | 'lastReviewed' | 'gst' | 'cgt' | 'lito' | 'sources'> {
  return {
    fy,
    lastReviewed: '2026-09-27',
    gst: { value: GST, status: 'published', sourceIds: ['ato-gst-registration', 'ato-simpler-bas'] },
    cgt: { value: CGT, status: 'published', sourceIds: ['ato-cgt-discount'] },
    lito: { value: LITO, status: 'published', sourceIds: ['ato-lito'] },
    sources: SOURCES,
  };
}
