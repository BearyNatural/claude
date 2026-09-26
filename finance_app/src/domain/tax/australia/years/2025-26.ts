import { TaxYearRules } from '../types';
import { common, residentBrackets } from './shared';

export const FY_2025_26: TaxYearRules = {
  ...common('2025-26'),
  residentRates: { value: residentBrackets(0.16), status: 'published', sourceIds: ['ato-resident-rates'] },
  medicare: { value: { rate: 0.02, singleLower: 28011, singleUpper: 35013, phaseInRate: 0.1 }, status: 'published', sourceIds: ['ato-medicare-low-income-2026'] },
  studyLoan: {
    // First year of the marginal repayment system.
    value: { kind: 'marginal', nilTo: 67000, tiers: [{ over: 67000, base: 0, rate: 0.15 }, { over: 125000, base: 8700, rate: 0.17 }], flatFrom: 179286, flatRate: 0.1 },
    status: 'published',
    sourceIds: ['ato-study-loans'],
  },
  superannuation: { value: { concessionalCap: 30000, nonConcessionalCap: 120000, superGuaranteeRatePercent: 12 }, status: 'published', sourceIds: ['ato-super-caps', 'ato-super-guarantee'] },
  notes: [],
};
