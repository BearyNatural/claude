import { Confidence } from '../import/types';

/**
 * Categories for transactions inside a superannuation account, from a super fund's statement.
 * Rules, not guesses: the statement's own column ("Employer SG", "Member after-tax"…) decides
 * contributions; the wording decides returns, fees, tax, insurance, rollovers and withdrawals.
 * Everything here is kept apart from household income and spending and from the personal tax
 * estimate (tax inside a fund is not PAYG and fund earnings are not personal income).
 */

export interface SuperCategoryResult {
  categoryId: string;
  confidence: Confidence;
  explanation: string;
}

const COLUMN_RULES: [RegExp, string, string][] = [
  [/employer\s*(additional|voluntary|extra)|salary\s*sacrifice/i, 'super.employer-additional', 'Employer additional / salary sacrifice'],
  [/employer|\bSG\b|super(annuation)?\s*guarantee/i, 'super.employer-sg', 'Employer (Super Guarantee)'],
  [/(member|personal)\s*(before[\s-]*tax|concessional|deductible)|before[\s-]*tax/i, 'super.personal-before-tax', 'Member before-tax'],
  [/(member|personal)\s*(after[\s-]*tax|non[\s-]*concessional)|after[\s-]*tax|non[\s-]*concessional/i, 'super.personal-after-tax', 'Member after-tax'],
  [/government|co[\s-]*contribution|LISTO|low\s*income/i, 'super.government', 'Government contribution'],
];

// Order matters: "Tax benefit – Flat administration fees" is tax, not a fee.
const DESCRIPTION_RULES: [RegExp, string, string][] = [
  [/\btax\b|tax\s*benefit|\bLISTO\b|division\s*293/i, 'super.tax', 'tax in the fund'],
  [/investment\s*(return|earning)s?|\bearnings\b|net\s*return|crediting\s*rate|interest\s*(credited|earned)/i, 'super.returns', 'investment returns'],
  [/insurance|premium|\bTPD\b|death\s*cover|income\s*protection|life\s*cover/i, 'super.insurance', 'insurance'],
  [/\bfees?\b|administration|admin\b|management\s*cost|cost\s*recovery/i, 'super.fees', 'fees'],
  [/roll[\s-]*(over|in|out)|transfer\s*(in|out|from|to)\s*(another\s*)?(fund|super)/i, 'super.rollovers', 'rollover between funds'],
  [/withdraw|benefit\s*payment|lump\s*sum|pension\s*payment|release\s*authority|first\s*home\s*super\s*saver|\bFHSS\b/i, 'super.withdrawals', 'withdrawal'],
  [/co[\s-]*contribution|low\s*income\s*super/i, 'super.government', 'government contribution'],
  [/super(annuation)?\s*guarantee|\bSGC?\b|employer\s*contribution/i, 'super.employer-sg', 'employer contribution'],
  [/salary\s*sacrifice/i, 'super.employer-additional', 'salary sacrifice'],
  [/personal\s*contribution|member\s*contribution|voluntary\s*contribution/i, 'super.personal-after-tax', 'personal contribution'],
];

const COMPANY = /\b(PTY|LTD|LIMITED|P\/L|INC|CORP(ORATION)?|GROUP|HOLDINGS|SERVICES)\b/i;

export function superCategoryFor(description: string, amountCents: number, sourceColumn?: string | null): SuperCategoryResult | null {
  if (sourceColumn) {
    for (const [re, categoryId, label] of COLUMN_RULES) {
      if (re.test(sourceColumn)) {
        return { categoryId, confidence: 'high', explanation: `Super statement: the amount is in the “${sourceColumn}” column (${label}).` };
      }
    }
  }
  for (const [re, categoryId, label] of DESCRIPTION_RULES) {
    if (re.test(description)) {
      return { categoryId, confidence: 'high', explanation: `Super statement: “${description}” reads as ${label}.` };
    }
  }
  if (amountCents > 0 && COMPANY.test(description)) {
    return {
      categoryId: 'super.employer-sg',
      confidence: 'medium',
      explanation: `Super statement: a payment in from “${description}” looks like an employer contribution. Change it if it was salary sacrifice or a personal contribution.`,
    };
  }
  return null;
}

/** Super category → the kind of entry the Super screen totals (for contribution caps and the year summary). */
export const SUPER_CATEGORY_ENTRY_KIND: Record<string, 'employer' | 'salary-sacrifice' | 'personal-concessional' | 'non-concessional' | 'fees' | 'insurance' | 'earnings' | 'contributions-tax' | 'withdrawal' | null> = {
  'super.employer-sg': 'employer',
  'super.employer-additional': 'salary-sacrifice',
  'super.personal-before-tax': 'personal-concessional',
  'super.personal-after-tax': 'non-concessional',
  'super.government': null,
  'super.returns': 'earnings',
  'super.fees': 'fees',
  'super.insurance': 'insurance',
  'super.tax': 'contributions-tax',
  'super.rollovers': null,
  'super.withdrawals': 'withdrawal',
};
