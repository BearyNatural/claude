/**
 * Default category tree. Keys are stable identifiers ("housing.mortgage") so rules,
 * budgets and reports keep working if the user renames a category.
 */
/**
 * `super`: money inside a superannuation fund (employer contributions, returns, fees, tax in the
 * fund). It is kept apart from household income and spending, and from the personal tax estimate.
 */
export type CategoryKind = 'expense' | 'income' | 'transfer' | 'savings' | 'investment' | 'super';
/** Used for cost-of-living analysis: fixed bills vs day-to-day vs optional spending. */
export type CategoryNature = 'fixed' | 'variable' | 'discretionary';

export interface CategorySeed {
  key: string;
  name: string;
  kind: CategoryKind;
  nature?: CategoryNature;
  children?: CategorySeed[];
}

const e = (key: string, name: string, nature: CategoryNature, children?: CategorySeed[]): CategorySeed => ({
  key, name, kind: 'expense', nature, children,
});

export const DEFAULT_CATEGORIES: CategorySeed[] = [
  e('housing', 'Housing', 'fixed', [
    e('housing.mortgage', 'Mortgage', 'fixed'),
    e('housing.rent', 'Rent', 'fixed'),
    e('housing.rates', 'Council rates', 'fixed'),
    e('housing.body-corporate', 'Body corporate', 'fixed'),
    e('housing.insurance', 'Home insurance', 'fixed'),
    e('housing.maintenance', 'Maintenance', 'variable'),
    e('housing.renovations', 'Renovations', 'discretionary'),
  ]),
  e('utilities', 'Utilities', 'fixed', [
    e('utilities.electricity', 'Electricity', 'fixed'),
    e('utilities.water', 'Water', 'fixed'),
    e('utilities.gas', 'Gas', 'fixed'),
    e('utilities.internet', 'Internet', 'fixed'),
    e('utilities.mobile', 'Mobile phone', 'fixed'),
  ]),
  e('food', 'Food', 'variable', [
    e('food.groceries', 'Groceries', 'variable'),
    e('food.takeaway', 'Takeaway', 'discretionary'),
    e('food.restaurants', 'Restaurants & cafes', 'discretionary'),
  ]),
  e('transport', 'Transport', 'variable', [
    e('transport.fuel', 'Fuel', 'variable'),
    e('transport.registration', 'Registration', 'fixed'),
    e('transport.insurance', 'Car insurance', 'fixed'),
    e('transport.servicing', 'Servicing', 'variable'),
    e('transport.repairs', 'Repairs', 'variable'),
    e('transport.public', 'Public transport', 'variable'),
    e('transport.parking', 'Parking', 'variable'),
    e('transport.tolls', 'Tolls', 'variable'),
    e('transport.rideshare', 'Taxi & rideshare', 'discretionary'),
  ]),
  e('health', 'Health', 'variable', [
    e('health.medical', 'Doctor & medical', 'variable'),
    e('health.pharmacy', 'Pharmacy', 'variable'),
    e('health.dental', 'Dental', 'variable'),
    e('health.optical', 'Optical', 'variable'),
    e('health.insurance', 'Health insurance', 'fixed'),
    e('health.fitness', 'Fitness', 'discretionary'),
  ]),
  e('education', 'Education', 'fixed', [
    e('education.school-fees', 'School fees', 'fixed'),
    e('education.courses', 'Courses & training', 'variable'),
    e('education.supplies', 'Books & supplies', 'variable'),
  ]),
  e('children', 'Children', 'variable', [
    e('children.childcare', 'Childcare', 'fixed'),
    e('children.activities', 'Activities & sport', 'discretionary'),
    e('children.clothing', 'Clothing', 'variable'),
  ]),
  e('pets', 'Pets', 'variable', [
    e('pets.food', 'Pet food', 'variable'),
    e('pets.vet', 'Vet', 'variable'),
    e('pets.insurance', 'Pet insurance', 'fixed'),
  ]),
  e('entertainment', 'Entertainment', 'discretionary', [
    e('entertainment.events', 'Events & outings', 'discretionary'),
    e('entertainment.hobbies', 'Hobbies', 'discretionary'),
    e('entertainment.alcohol', 'Alcohol', 'discretionary'),
  ]),
  e('subscriptions', 'Subscriptions', 'fixed', [
    e('subscriptions.streaming', 'Streaming', 'discretionary'),
    e('subscriptions.software', 'Software', 'fixed'),
    e('subscriptions.memberships', 'Memberships', 'fixed'),
    e('subscriptions.cloud', 'Cloud storage', 'fixed'),
    e('subscriptions.news', 'News & magazines', 'discretionary'),
  ]),
  e('shopping', 'Shopping', 'discretionary', [
    e('shopping.clothing', 'Clothing', 'discretionary'),
    e('shopping.household', 'Household', 'variable'),
    e('shopping.electronics', 'Electronics', 'discretionary'),
    e('shopping.gifts', 'Gifts', 'discretionary'),
    e('shopping.general', 'General', 'discretionary'),
  ]),
  e('personal', 'Personal care', 'discretionary', [
    e('personal.hair-beauty', 'Hair & beauty', 'discretionary'),
  ]),
  e('travel', 'Travel', 'discretionary', [
    e('travel.flights', 'Flights', 'discretionary'),
    e('travel.accommodation', 'Accommodation', 'discretionary'),
    e('travel.holiday', 'Holiday spending', 'discretionary'),
  ]),
  e('insurance', 'Insurance', 'fixed', [
    e('insurance.life', 'Life insurance', 'fixed'),
    e('insurance.income-protection', 'Income protection', 'fixed'),
    e('insurance.other', 'Other insurance', 'fixed'),
  ]),
  e('fees', 'Fees & interest charged', 'variable', [
    e('fees.bank', 'Bank fees', 'variable'),
    e('fees.interest', 'Interest charged', 'variable'),
  ]),
  e('giving', 'Donations', 'discretionary'),
  e('taxes', 'Taxes', 'fixed', [
    e('taxes.income-tax', 'Income tax payments', 'fixed'),
    e('taxes.payg-instalments', 'PAYG instalments', 'fixed'),
    e('taxes.gst', 'GST / BAS payments', 'fixed'),
  ]),
  e('business', 'Business', 'variable', [
    e('business.supplies', 'Business supplies', 'variable'),
    e('business.software', 'Business software', 'fixed'),
    e('business.travel', 'Business travel', 'variable'),
    e('business.professional', 'Professional fees', 'variable'),
    e('business.other', 'Other business expenses', 'variable'),
  ]),
  { key: 'savings', name: 'Savings', kind: 'savings', children: [
    { key: 'savings.contributions', name: 'Savings contributions', kind: 'savings' },
  ] },
  { key: 'investments', name: 'Investments', kind: 'investment', children: [
    { key: 'investments.shares', name: 'Share & fund purchases', kind: 'investment' },
    { key: 'investments.super', name: 'Personal super contributions', kind: 'investment' },
  ] },
  { key: 'income', name: 'Income', kind: 'income', children: [
    { key: 'income.salary', name: 'Salary & wages', kind: 'income' },
    { key: 'income.contractor', name: 'Contractor income', kind: 'income' },
    { key: 'income.sole-trader', name: 'Sole-trader income', kind: 'income' },
    { key: 'income.business', name: 'Business income', kind: 'income' },
    { key: 'income.interest', name: 'Interest', kind: 'income' },
    { key: 'income.dividends', name: 'Dividends & distributions', kind: 'income' },
    { key: 'income.rental', name: 'Rental income', kind: 'income' },
    { key: 'income.government', name: 'Government payments', kind: 'income' },
    { key: 'income.refunds', name: 'Refunds', kind: 'income' },
    { key: 'income.other', name: 'Other income', kind: 'income' },
  ] },
  { key: 'super', name: 'Superannuation', kind: 'super', children: [
    { key: 'super.employer-sg', name: 'Employer contributions (Super Guarantee)', kind: 'super' },
    { key: 'super.employer-additional', name: 'Employer additional & salary sacrifice', kind: 'super' },
    { key: 'super.personal-before-tax', name: 'Personal contributions (before tax)', kind: 'super' },
    { key: 'super.personal-after-tax', name: 'Personal contributions (after tax)', kind: 'super' },
    { key: 'super.government', name: 'Government contributions (co-contribution, LISTO)', kind: 'super' },
    { key: 'super.returns', name: 'Investment returns', kind: 'super' },
    { key: 'super.fees', name: 'Fees', kind: 'super' },
    { key: 'super.insurance', name: 'Insurance premiums', kind: 'super' },
    { key: 'super.tax', name: 'Tax in the fund (contributions tax, tax benefits)', kind: 'super' },
    { key: 'super.rollovers', name: 'Rollovers & transfers between funds', kind: 'super' },
    { key: 'super.withdrawals', name: 'Withdrawals & benefit payments', kind: 'super' },
  ] },
  { key: 'transfers', name: 'Transfers', kind: 'transfer', children: [
    { key: 'transfers.internal', name: 'Between my accounts', kind: 'transfer' },
    { key: 'transfers.card-payment', name: 'Credit card payment', kind: 'transfer' },
    { key: 'transfers.loan-repayment', name: 'Loan repayment (to tracked loan)', kind: 'transfer' },
  ] },
  e('other', 'Other', 'variable', [
    e('other.cash', 'Cash withdrawals', 'variable'),
    e('other.uncategorised', 'Uncategorised', 'variable'),
  ]),
];

export interface FlatCategory {
  key: string;
  name: string;
  kind: CategoryKind;
  nature: CategoryNature | null;
  parentKey: string | null;
}

export function flattenCategories(seeds: CategorySeed[] = DEFAULT_CATEGORIES, parentKey: string | null = null): FlatCategory[] {
  const out: FlatCategory[] = [];
  for (const s of seeds) {
    out.push({ key: s.key, name: s.name, kind: s.kind, nature: s.nature ?? null, parentKey });
    if (s.children) out.push(...flattenCategories(s.children, s.key));
  }
  return out;
}

/** Income types used for tax classification and income reports. */
export type IncomeType =
  | 'salary' | 'wages' | 'contractor' | 'sole-trader' | 'business' | 'interest' | 'term-deposit-interest'
  | 'dividends' | 'managed-fund-distribution' | 'trust-distribution' | 'rental' | 'government'
  | 'refund' | 'other';

export const INCOME_TYPE_LABEL: Record<IncomeType, string> = {
  salary: 'Salary',
  wages: 'Wages',
  contractor: 'Contractor income',
  'sole-trader': 'Sole-trader income',
  business: 'Business income',
  interest: 'Bank interest',
  'term-deposit-interest': 'Term-deposit interest',
  dividends: 'Dividends',
  'managed-fund-distribution': 'Managed-fund distributions',
  'trust-distribution': 'Trust distributions',
  rental: 'Rental income',
  government: 'Government payments',
  refund: 'Refunds',
  other: 'Other income',
};

/** Income types that are not assessable income on their own (e.g. a refund of spending). */
export const NON_ASSESSABLE_INCOME: IncomeType[] = ['refund'];

export const INCOME_CATEGORY_FOR_TYPE: Record<IncomeType, string> = {
  salary: 'income.salary',
  wages: 'income.salary',
  contractor: 'income.contractor',
  'sole-trader': 'income.sole-trader',
  business: 'income.business',
  interest: 'income.interest',
  'term-deposit-interest': 'income.interest',
  dividends: 'income.dividends',
  'managed-fund-distribution': 'income.dividends',
  'trust-distribution': 'income.dividends',
  rental: 'income.rental',
  government: 'income.government',
  refund: 'income.refunds',
  other: 'income.other',
};
