import { TaxYearRules } from './types';
import { FY_2024_25 } from './years/2024-25';
import { FY_2025_26 } from './years/2025-26';
import { FY_2026_27 } from './years/2026-27';
import { FY_2027_28 } from './years/2027-28';

/*
 * Registry of versioned tax rules — one file per financial year in ./years.
 * When the ATO publishes new figures, add or update that year's file, record the
 * source and review date in sources.ts, and add tests.
 */
export const RULES: Record<string, TaxYearRules> = {
  '2024-25': FY_2024_25,
  '2025-26': FY_2025_26,
  '2026-27': FY_2026_27,
  '2027-28': FY_2027_28,
};

export const SUPPORTED_YEARS = Object.keys(RULES).sort();

/**
 * Rules for a financial year. Years after the latest supported year fall back to the latest
 * rules with every component marked provisional; earlier years are not supported.
 */
export function rulesFor(fy: string): { rules: TaxYearRules; fallbackFrom: string | null } | null {
  if (RULES[fy]) return { rules: RULES[fy], fallbackFrom: null };
  const latest = SUPPORTED_YEARS[SUPPORTED_YEARS.length - 1];
  if (fy > latest) {
    const base = RULES[latest];
    const note = `Rules for ${fy} are not available; ${latest} rules are used.`;
    return {
      rules: {
        ...base,
        fy,
        residentRates: { ...base.residentRates, status: 'provisional', note },
        medicare: { ...base.medicare, status: 'provisional', note },
        lito: { ...base.lito, status: 'provisional', note },
        studyLoan: { ...base.studyLoan, status: 'provisional', note },
        superannuation: { ...base.superannuation, status: 'provisional', note },
        notes: [`Tax rules for ${fy} are not in this version. The ${latest} rules are used, so this estimate is less reliable.`],
      },
      fallbackFrom: latest,
    };
  }
  return null;
}
