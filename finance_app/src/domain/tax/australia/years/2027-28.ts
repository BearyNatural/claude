import { TaxYearRules } from '../types';
import { HELP_2026_27, common, residentBrackets } from './shared';

export const FY_2027_28: TaxYearRules = {
  ...common('2027-28'),
  residentRates: {
    value: residentBrackets(0.14),
    status: 'legislated',
    sourceIds: ['ato-new-tax-cuts'],
    note: 'The 14% rate from 1 July 2027 is law but the ATO had not yet published a 2027–28 rates table. Bracket thresholds are assumed unchanged.',
  },
  medicare: {
    value: { rate: 0.02, singleLower: 28011, singleUpper: 35013, phaseInRate: 0.1 },
    status: 'provisional',
    sourceIds: ['ato-medicare-low-income-2026'],
    note: 'Low-income thresholds for 2027–28 are not yet known; the latest published (2025–26) thresholds are used.',
  },
  studyLoan: {
    value: HELP_2026_27,
    status: 'provisional',
    sourceIds: ['ato-study-loans'],
    note: '2027–28 study-loan thresholds are not yet published; 2026–27 thresholds are used.',
  },
  superannuation: {
    value: { concessionalCap: 32500, nonConcessionalCap: 130000, superGuaranteeRatePercent: 12 },
    status: 'provisional',
    sourceIds: ['ato-super-caps', 'ato-super-guarantee'],
    note: 'Contribution caps for 2027–28 are not yet published; 2026–27 caps are shown. The 12% super guarantee applies from 1 July 2025 onwards.',
  },
  notes: [],
};
