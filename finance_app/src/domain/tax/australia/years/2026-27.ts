import { TaxYearRules } from '../types';
import { HELP_2026_27, common, residentBrackets } from './shared';

export const FY_2026_27: TaxYearRules = {
  ...common('2026-27'),
  // 16% → 15% from 1 July 2026.
  residentRates: { value: residentBrackets(0.15), status: 'published', sourceIds: ['ato-resident-rates', 'ato-new-tax-cuts'] },
  medicare: {
    value: { rate: 0.02, singleLower: 28011, singleUpper: 35013, phaseInRate: 0.1 },
    status: 'provisional',
    sourceIds: ['ato-medicare-low-income-2026'],
    note: 'The 2026–27 low-income thresholds had not been published when these rules were reviewed; the 2025–26 thresholds are used.',
  },
  studyLoan: { value: HELP_2026_27, status: 'published', sourceIds: ['ato-study-loans'] },
  superannuation: { value: { concessionalCap: 32500, nonConcessionalCap: 130000, superGuaranteeRatePercent: 12 }, status: 'published', sourceIds: ['ato-super-caps', 'ato-super-guarantee'] },
  notes: [],
};
