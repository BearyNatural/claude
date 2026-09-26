import { TaxYearRules } from '../types';
import { common, residentBrackets } from './shared';

export const FY_2024_25: TaxYearRules = {
  ...common('2024-25'),
  residentRates: { value: residentBrackets(0.16), status: 'published', sourceIds: ['ato-resident-rates'] },
  medicare: { value: { rate: 0.02, singleLower: 27222, singleUpper: 34027, phaseInRate: 0.1 }, status: 'published', sourceIds: ['ato-medicare-low-income-2025'] },
  studyLoan: {
    value: {
      kind: 'percentage-of-income',
      thresholds: [
        { from: 54435, rate: 0.01 }, { from: 62851, rate: 0.02 }, { from: 66621, rate: 0.025 }, { from: 70619, rate: 0.03 },
        { from: 74856, rate: 0.035 }, { from: 79347, rate: 0.04 }, { from: 84108, rate: 0.045 }, { from: 89155, rate: 0.05 },
        { from: 94504, rate: 0.055 }, { from: 100175, rate: 0.06 }, { from: 106186, rate: 0.065 }, { from: 112557, rate: 0.07 },
        { from: 119310, rate: 0.075 }, { from: 126468, rate: 0.08 }, { from: 134057, rate: 0.085 }, { from: 142101, rate: 0.09 },
        { from: 150627, rate: 0.095 }, { from: 159664, rate: 0.1 },
      ],
    },
    status: 'published',
    sourceIds: ['ato-study-loans'],
  },
  superannuation: { value: { concessionalCap: 30000, nonConcessionalCap: 120000, superGuaranteeRatePercent: 11.5 }, status: 'published', sourceIds: ['ato-super-caps', 'ato-super-guarantee'] },
  notes: [],
};
