import { Cents } from '../money';
import { IncomeType } from './categories';
import { cleanDescription } from './clean';

/**
 * Transparent, deterministic categorisation rules.
 *
 * Every suggestion names the rule that produced it, and every rule is visible,
 * editable and removable. User rules win over learned rules, which win over the
 * built-in defaults.
 */

export type MatchType = 'contains' | 'word' | 'starts-with' | 'equals' | 'wildcard' | 'regex';
export type RuleSource = 'user' | 'learned' | 'default';
export type BusinessUse = 'personal' | 'business' | 'mixed';

export interface Rule {
  id: string;
  name?: string | null;
  field: 'description' | 'payee';
  matchType: MatchType;
  pattern: string;
  direction?: 'in' | 'out' | 'any';
  amountMinCents?: Cents | null;
  amountMaxCents?: Cents | null;
  accountId?: string | null;
  categoryId?: string | null;
  incomeType?: IncomeType | null;
  payee?: string | null;
  taxClass?: string | null;
  businessUse?: BusinessUse | null;
  businessPercent?: number | null;
  tags?: string[];
  source: RuleSource;
  priority: number;
  enabled: boolean;
}

export interface RuleSubject {
  description: string;
  payee?: string | null;
  amountCents: Cents;
  accountId?: string | null;
  /** The statement column an amount was printed in (e.g. "Employer SG" on a super statement). */
  sourceColumn?: string | null;
}

export interface RuleMatch {
  rule: Rule;
  explanation: string;
}

const SOURCE_RANK: Record<RuleSource, number> = { user: 3, learned: 2, default: 1 };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reject user regular expressions that could take a very long time to run
 * (nested quantifiers such as "(a+)+") or that are unreasonably long.
 */
export function validateRegex(pattern: string): string | null {
  if (pattern.length > 200) return 'Pattern is too long (200 characters maximum).';
  if (/\([^)]*[+*}][^)]*\)\s*[+*{]/.test(pattern)) return 'Nested repetition like (a+)+ is not allowed because it can be very slow.';
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, 'i'); // nosemgrep: detect-non-literal-regexp — validated above, length-limited
  } catch {
    return 'This is not a valid regular expression.';
  }
  return null;
}

const compiled = new Map<string, RegExp | null>();

function toRegex(rule: Pick<Rule, 'matchType' | 'pattern'>): RegExp | null {
  const key = `${rule.matchType}\u0000${rule.pattern}`;
  if (compiled.has(key)) return compiled.get(key) ?? null;
  let re: RegExp | null = null;
  const p = rule.pattern.trim();
  if (p) {
    switch (rule.matchType) {
      case 'contains':
        // Very short patterns ("BP", "ATO") only match whole words to avoid false positives.
        re = new RegExp(p.length <= 3 ? `(^|[^A-Z0-9])${escapeRegex(p)}([^A-Z0-9]|$)` : escapeRegex(p), 'i'); // nosemgrep
        break;
      case 'word':
        re = new RegExp(`(^|[^A-Z0-9])${escapeRegex(p)}([^A-Z0-9]|$)`, 'i'); // nosemgrep
        break;
      case 'starts-with':
        re = new RegExp(`^${escapeRegex(p)}`, 'i'); // nosemgrep
        break;
      case 'equals':
        re = new RegExp(`^${escapeRegex(p)}$`, 'i'); // nosemgrep
        break;
      case 'wildcard':
        re = new RegExp(`^${p.split('*').map(escapeRegex).join('.*')}$`, 'i'); // nosemgrep
        break;
      case 'regex':
        re = validateRegex(p) ? null : new RegExp(p, 'i'); // nosemgrep
        break;
    }
  }
  compiled.set(key, re);
  return re;
}

export function ruleMatches(rule: Rule, subject: RuleSubject): boolean {
  if (!rule.enabled) return false;
  if (rule.accountId && subject.accountId && rule.accountId !== subject.accountId) return false;
  if (rule.accountId && !subject.accountId) return false;
  const dir = rule.direction ?? 'any';
  if (dir === 'in' && subject.amountCents <= 0) return false;
  if (dir === 'out' && subject.amountCents >= 0) return false;
  const abs = Math.abs(subject.amountCents);
  if (rule.amountMinCents != null && abs < rule.amountMinCents) return false;
  if (rule.amountMaxCents != null && abs > rule.amountMaxCents) return false;
  const re = toRegex(rule);
  if (!re) return false;
  if (rule.field === 'payee') return !!subject.payee && re.test(subject.payee);
  return re.test(subject.description) || re.test(cleanDescription(subject.description));
}

function specificity(rule: Rule): number {
  return (rule.pattern?.length ?? 0) + (rule.accountId ? 50 : 0) + (rule.amountMinCents != null || rule.amountMaxCents != null ? 20 : 0) + ((rule.direction ?? 'any') !== 'any' ? 5 : 0);
}

export function describeRule(rule: Rule): string {
  const how: Record<MatchType, string> = {
    contains: 'contains',
    word: 'contains the word',
    'starts-with': 'starts with',
    equals: 'is exactly',
    wildcard: 'matches',
    regex: 'matches the pattern',
  };
  const field = rule.field === 'payee' ? 'Payee' : 'Description';
  const parts = [`${field} ${how[rule.matchType]} "${rule.pattern}"`];
  if (rule.direction === 'in') parts.push('money in');
  if (rule.direction === 'out') parts.push('money out');
  if (rule.amountMinCents != null) parts.push(`at least $${(rule.amountMinCents / 100).toFixed(2)}`);
  if (rule.amountMaxCents != null) parts.push(`at most $${(rule.amountMaxCents / 100).toFixed(2)}`);
  if (rule.accountId) parts.push('in one account');
  return parts.join(', ');
}

/** The single best rule for a transaction, or null. */
export function bestRule(rules: Rule[], subject: RuleSubject): RuleMatch | null {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!ruleMatches(r, subject)) continue;
    if (!best) {
      best = r;
      continue;
    }
    const a = [SOURCE_RANK[r.source], r.priority, specificity(r)];
    const b = [SOURCE_RANK[best.source], best.priority, specificity(best)];
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        if (a[i] > b[i]) best = r;
        break;
      }
    }
  }
  if (!best) return null;
  const label = best.source === 'user' ? 'your rule' : best.source === 'learned' ? 'a rule learned from your corrections' : 'a built-in rule';
  return { rule: best, explanation: `Matched ${label}: ${describeRule(best)}` };
}

/* ------------------------------ built-in rules ------------------------------ */

type D = [pattern: string, categoryId: string, opts?: Partial<Pick<Rule, 'direction' | 'incomeType' | 'matchType' | 'priority'>>];

const DEFAULTS: D[] = [
  // Groceries
  ...['WOOLWORTHS', 'WOOLIES', 'COLES', 'ALDI', 'IGA', 'HARRIS FARM', 'FOODWORKS', 'DRAKES', 'FOODLAND', 'SPUDSHED', 'COSTCO'].map((p): D => [p, 'food.groceries', { direction: 'out' }]),
  // Fuel (Coles Express is a service station, so it outranks "COLES")
  ...['COLES EXPRESS', 'BP', 'AMPOL', 'CALTEX', 'SHELL', '7-ELEVEN', '7 ELEVEN', 'UNITED PETROLEUM', 'PUMA ENERGY', 'LIBERTY OIL', 'METRO PETROLEUM', 'EG FUEL', 'OTR '].map((p): D => [p.trim(), 'transport.fuel', { direction: 'out', priority: p === 'COLES EXPRESS' ? 5 : 0 }]),
  // Electricity & gas retailers
  ...['AGL', 'ORIGIN ENERGY', 'ENERGYAUSTRALIA', 'ENERGY AUSTRALIA', 'RED ENERGY', 'ALINTA', 'SIMPLY ENERGY', 'POWERSHOP', 'MOMENTUM ENERGY', 'ERGON', 'AMBER ELECTRIC', 'LUMO ENERGY', 'GLOBIRD', 'TANGO ENERGY', 'SYNERGY', 'AURORA ENERGY', 'ACTEWAGL'].map((p): D => [p, 'utilities.electricity', { direction: 'out' }]),
  // Water
  ...['URBAN UTILITIES', 'SYDNEY WATER', 'YARRA VALLEY WATER', 'SA WATER', 'WATER CORPORATION', 'UNITYWATER', 'ICON WATER', 'SOUTH EAST WATER', 'GREATER WESTERN WATER', 'HUNTER WATER', 'TASWATER'].map((p): D => [p, 'utilities.water', { direction: 'out' }]),
  // Internet & phone
  ...['AUSSIE BROADBAND', 'TPG', 'IINET', 'SUPERLOOP', 'BELONG', 'LEAPTEL', 'EXETEL', 'SPINTEL', 'DODO'].map((p): D => [p, 'utilities.internet', { direction: 'out' }]),
  ...['TELSTRA', 'OPTUS', 'VODAFONE', 'AMAYSIM', 'BOOST MOBILE', 'LEBARA', 'FELIX MOBILE', 'CIRCLES LIFE'].map((p): D => [p, 'utilities.mobile', { direction: 'out' }]),
  // Subscriptions
  ...['NETFLIX', 'SPOTIFY', 'STAN.COM', 'DISNEY PLUS', 'DISNEYPLUS', 'BINGE', 'KAYO', 'PARAMOUNT+', 'PARAMOUNT PLUS', 'YOUTUBE PREMIUM', 'YOUTUBEPREMIUM', 'APPLE MUSIC', 'AUDIBLE', 'PRIME VIDEO', 'FOXTEL'].map((p): D => [p, 'subscriptions.streaming', { direction: 'out' }]),
  ...['MICROSOFT', 'ADOBE', 'CANVA', 'OPENAI', 'CHATGPT', 'GITHUB', '1PASSWORD', 'NOTION'].map((p): D => [p, 'subscriptions.software', { direction: 'out' }]),
  ...['DROPBOX', 'GOOGLE ONE', 'GOOGLE STORAGE', 'ICLOUD'].map((p): D => [p, 'subscriptions.cloud', { direction: 'out' }]),
  ['APPLE.COM/BILL', 'subscriptions', { direction: 'out' }],
  // Food out
  ...['UBER EATS', 'UBER *EATS', 'UBEREATS', 'MENULOG', 'DOORDASH', 'DELIVEROO', 'MCDONALDS', "MCDONALD'S", 'KFC', 'HUNGRY JACKS', 'DOMINOS', "DOMINO'S", 'PIZZA HUT', 'GUZMAN', 'SUBWAY', 'OPORTO', 'RED ROOSTER', 'NANDOS', "NANDO'S"].map((p): D => [p, 'food.takeaway', { direction: 'out', priority: p.includes('EATS') ? 5 : 0 }]),
  ...['CAFE', 'COFFEE', 'RESTAURANT', 'STARBUCKS', 'GLORIA JEANS', 'BAKERY', 'GRILLD', "GRILL'D"].map((p): D => [p, 'food.restaurants', { direction: 'out' }]),
  ...['DAN MURPHY', 'BWS', 'LIQUORLAND', 'FIRST CHOICE LIQUOR', 'LIQUOR'].map((p): D => [p, 'entertainment.alcohol', { direction: 'out' }]),
  // Transport
  ...['UBER', 'DIDI', '13CABS', 'OLA CABS'].map((p): D => [p, 'transport.rideshare', { direction: 'out' }]),
  ...['TRANSLINK', 'GO CARD', 'GOCARD', 'OPAL', 'MYKI', 'PTV', 'TRANSPERTH', 'ADELAIDE METRO', 'TRANSPORT CANBERRA', 'METRO TASMANIA'].map((p): D => [p, 'transport.public', { direction: 'out' }]),
  ...['LINKT', 'E-TOLL', 'ETOLL', 'TRANSURBAN', 'CITYLINK', 'EASTLINK'].map((p): D => [p, 'transport.tolls', { direction: 'out' }]),
  ...['SECURE PARKING', 'WILSON PARKING', 'CARE PARK', 'PARKING'].map((p): D => [p, 'transport.parking', { direction: 'out' }]),
  ...['VEHICLE REGISTRATION', 'REGO', 'VICROADS', 'TRANSPORT AND MAIN ROADS', 'TMR '].map((p): D => [p.trim(), 'transport.registration', { direction: 'out', matchType: p === 'REGO' ? 'word' : 'contains' }]),
  ...['ULTRA TUNE', 'MIDAS', 'KMART TYRE', 'BOB JANE', 'BEAUREPAIRES', 'MECHANIC'].map((p): D => [p, 'transport.servicing', { direction: 'out' }]),
  // Home
  ...['BUNNINGS', 'MITRE 10', 'TOTAL TOOLS', 'HOME TIMBER'].map((p): D => [p, 'housing.maintenance', { direction: 'out' }]),
  ['COUNCIL', 'housing.rates', { direction: 'out' }],
  ['BODY CORP', 'housing.body-corporate', { direction: 'out' }],
  ['STRATA', 'housing.body-corporate', { direction: 'out' }],
  ['RENT', 'housing.rent', { direction: 'out', matchType: 'word' }],
  ...['HOME LOAN', 'MORTGAGE', 'LOAN REPAYMENT'].map((p): D => [p, 'housing.mortgage', { direction: 'out' }]),
  // Shopping
  ...['KMART', 'TARGET', 'BIG W', 'MYER', 'DAVID JONES', 'AMAZON', 'EBAY', 'CATCH.COM', 'TEMU', 'AUSTRALIA POST', 'OFFICEWORKS'].map((p): D => [p, 'shopping.general', { direction: 'out' }]),
  ...['JB HI-FI', 'JB HIFI', 'HARVEY NORMAN', 'THE GOOD GUYS', 'APPLE STORE'].map((p): D => [p, 'shopping.electronics', { direction: 'out' }]),
  ...['UNIQLO', 'COTTON ON', 'H&M', 'ZARA', 'RIVERS', 'BEST&LESS', 'BEST & LESS', 'RM WILLIAMS'].map((p): D => [p, 'shopping.clothing', { direction: 'out' }]),
  ...['IKEA', 'BED BATH', 'SPOTLIGHT', 'ADAIRS'].map((p): D => [p, 'shopping.household', { direction: 'out' }]),
  // Health
  ...['CHEMIST WAREHOUSE', 'PRICELINE', 'TERRYWHITE', 'TERRY WHITE', 'AMCAL', 'BLOOMS', 'PHARMACY', 'CHEMIST'].map((p): D => [p, 'health.pharmacy', { direction: 'out' }]),
  ...['BUPA', 'MEDIBANK', 'HCF', 'NIB', 'HBF', 'AHM', 'AUSTRALIAN UNITY', 'TEACHERS HEALTH', 'GMHBA'].map((p): D => [p, 'health.insurance', { direction: 'out' }]),
  ...['DENTAL', 'DENTIST', 'ORTHODONT'].map((p): D => [p, 'health.dental', { direction: 'out' }]),
  ...['SPECSAVERS', 'OPSM', 'OPTOMETR'].map((p): D => [p, 'health.optical', { direction: 'out' }]),
  ...['MEDICAL CENTRE', 'MEDICAL CENTER', 'PATHOLOGY', 'RADIOLOGY', 'PHYSIO', 'HOSPITAL', 'CLINIC'].map((p): D => [p, 'health.medical', { direction: 'out' }]),
  ...['ANYTIME FITNESS', 'SNAP FITNESS', 'F45', 'JETTS', 'PLUS FITNESS', 'GOODLIFE', 'FITNESS FIRST'].map((p): D => [p, 'health.fitness', { direction: 'out' }]),
  // Insurance
  ...['NRMA', 'RACQ', 'RACV', 'RAA INSURANCE', 'RAC INSURANCE', 'AAMI', 'BUDGET DIRECT', 'YOUI', 'ALLIANZ', 'SUNCORP INSURANCE', 'GIO', 'QBE', 'BINGLE', 'COLES INSURANCE', 'WOOLWORTHS INSURANCE'].map((p): D => [p, 'insurance.other', { direction: 'out', priority: p.includes('INSURANCE') ? 5 : 0 }]),
  // Pets, children, education
  ...['PETBARN', 'PET CIRCLE', 'PETSTOCK', 'PET STOCK'].map((p): D => [p, 'pets.food', { direction: 'out' }]),
  ...['VETERINARY', 'VET CLINIC', 'VET HOSPITAL', 'GREENCROSS'].map((p): D => [p, 'pets.vet', { direction: 'out' }]),
  ...['CHILDCARE', 'GOODSTART', 'EARLY LEARNING', 'OSHC', 'KINDERGARTEN'].map((p): D => [p, 'children.childcare', { direction: 'out' }]),
  ...['UDEMY', 'COURSERA', 'TAFE', 'UNIVERSITY'].map((p): D => [p, 'education.courses', { direction: 'out' }]),
  ...['SCHOOL FEE', 'COLLEGE FEE', 'GRAMMAR SCHOOL'].map((p): D => [p, 'education.school-fees', { direction: 'out' }]),
  // Travel
  ...['QANTAS', 'VIRGIN AUSTRALIA', 'JETSTAR', 'REX AIRLINES', 'BONZA'].map((p): D => [p, 'travel.flights', { direction: 'out' }]),
  ...['AIRBNB', 'BOOKING.COM', 'HOTEL', 'EXPEDIA', 'WOTIF', 'MOTEL'].map((p): D => [p, 'travel.accommodation', { direction: 'out' }]),
  // Giving
  ...['RED CROSS', 'SALVATION ARMY', 'SALVOS', 'OXFAM', 'WORLD VISION', 'UNICEF', 'DONATION', 'CHARITY'].map((p): D => [p, 'giving', { direction: 'out' }]),
  // Fees and interest charged
  ...['ACCOUNT FEE', 'MONTHLY FEE', 'ATM FEE', 'OVERSEAS TRANSACTION FEE', 'INTERNATIONAL TRANSACTION FEE', 'FOREIGN TRANSACTION FEE', 'LATE PAYMENT FEE', 'ANNUAL FEE', 'DISHONOUR FEE'].map((p): D => [p, 'fees.bank', { direction: 'out', priority: 3 }]),
  ...['INTEREST CHARGED', 'PURCHASE INTEREST', 'CASH ADVANCE INTEREST', 'DEBIT INTEREST', 'INTEREST CHARGE'].map((p): D => [p, 'fees.interest', { direction: 'out', priority: 3 }]),
  // Taxes
  ...['AUSTRALIAN TAXATION OFFICE', 'ATO', 'TAX OFFICE PAYMENTS'].map((p): D => [p, 'taxes', { direction: 'out' }]),
  // Cash
  ...['ATM WITHDRAWAL', 'CASH WITHDRAWAL', 'ATM'].map((p): D => [p, 'other.cash', { direction: 'out' }]),
  // Transfers between the user's own accounts (confirmed by transfer matching)
  ...['PAYMENT THANK YOU', 'PAYMENT THANKYOU', 'PAYMENT RECEIVED'].map((p): D => [p, 'transfers.card-payment', { direction: 'in', priority: 5 }]),
  ...['TRANSFER TO', 'TRANSFER FROM', 'TFR TO', 'TFR FROM', 'INTERNAL TRANSFER'].map((p): D => [p, 'transfers.internal', { priority: 2 }]),
  // Income
  ...['PAYROLL', 'SALARY', 'WAGES', 'PAY/SALARY'].map((p): D => [p, 'income.salary', { direction: 'in', incomeType: 'salary', priority: 4 }]),
  ...['CREDIT INTEREST', 'INTEREST PAID', 'BONUS INTEREST', 'INTEREST CREDIT', 'INTEREST EARNED'].map((p): D => [p, 'income.interest', { direction: 'in', incomeType: 'interest', priority: 4 }]),
  ['INTEREST', 'income.interest', { direction: 'in', incomeType: 'interest', matchType: 'word' }],
  ...['DIVIDEND', 'DIV PAYMENT', 'DRP', 'DISTRIBUTION'].map((p): D => [p, 'income.dividends', { direction: 'in', incomeType: p === 'DISTRIBUTION' ? 'managed-fund-distribution' : 'dividends', matchType: p === 'DRP' ? 'word' : 'contains', priority: 3 }]),
  // "Services Australia" only at the start of a description: company names such as
  // "Example Web Services Australia Pty Ltd" contain the same words.
  ...['CENTRELINK', 'SERVICES AUSTRALIA', 'DEPT VETERANS', 'CHILD CARE SUBSIDY'].map((p): D => [p, 'income.government', { direction: 'in', incomeType: 'government', priority: 3, matchType: p === 'SERVICES AUSTRALIA' ? 'starts-with' : 'contains' }]),
  ...['MEDICARE BENEFIT', 'MEDICARE REBATE', 'MEDICARE'].map((p): D => [p, 'income.refunds', { direction: 'in', incomeType: 'refund', priority: 3 }]),
  ...['AUSTRALIAN TAXATION OFFICE', 'ATO', 'TAX REFUND'].map((p): D => [p, 'income.refunds', { direction: 'in', incomeType: 'refund', priority: 3 }]),
  ['REFUND', 'income.refunds', { direction: 'in', incomeType: 'refund', priority: 1 }],
];

export function defaultRules(): Rule[] {
  return DEFAULTS.map(([pattern, categoryId, opts], i) => ({
    id: `default-${i + 1}`,
    field: 'description',
    matchType: opts?.matchType ?? 'contains',
    pattern,
    direction: opts?.direction ?? 'any',
    categoryId,
    incomeType: opts?.incomeType ?? null,
    source: 'default',
    priority: opts?.priority ?? 0,
    enabled: true,
  }));
}
