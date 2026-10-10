import { Cents, formatMoney, roundCents } from '../../money';
import { fyDisplay } from '../../dates';
import { Bracket, RuleStatus, SourceRef, StudyLoanRule, TaxYearRules } from './types';
import { rulesFor } from './rules';

/**
 * Australian resident individual income-tax ESTIMATE.
 * This is not tax preparation software, an ATO assessment or tax advice. It works only
 * from the records entered or imported, and says clearly what it does not cover.
 */

export const TAX_DISCLAIMER =
  'This is an estimate based on the information currently entered or imported. It is not an ATO assessment or tax advice.';

export interface TaxInput {
  fy: string;
  employmentGrossCents: Cents;
  allowancesCents: Cents;
  paygWithheldCents: Cents;
  /** Reportable employer super (e.g. salary sacrifice) — only used for study-loan repayment income. */
  reportableSuperCents: Cents;
  businessIncomeCents: Cents;
  businessExpensesCents: Cents;
  interestCents: Cents;
  dividendsFrankedCents: Cents;
  dividendsUnfrankedCents: Cents;
  frankingCreditsCents: Cents;
  otherIncomeCents: Cents;
  /** Net capital gain after losses and discount; null when cost-base records are incomplete. */
  netCapitalGainCents: Cents | null;
  deductionsCents: Cents;
  paygInstalmentsCents: Cents;
  hasStudyLoan: boolean;
  medicareExempt?: boolean;
  /** Employee share scheme statement label D: taxed-upfront discount, eligible for the $1,000 reduction. */
  essTaxedUpfrontReductionCents?: Cents;
  /** Label E: taxed-upfront discount, not eligible for the reduction. */
  essTaxedUpfrontCents?: Cents;
  /** Label F: discount from deferral schemes (taxed in the year of the deferred taxing point). */
  essDeferralCents?: Cents;
  /** Label C: TFN amounts withheld from discounts — a credit, like tax withheld. */
  essTfnWithheldCents?: Cents;
}

/** The employee share scheme reduction: up to $1,000 off taxed-upfront discounts (label D) when income is $180,000 or less. */
export const ESS_REDUCTION_CENTS = 100000;
export const ESS_REDUCTION_INCOME_LIMIT = 180000;

export interface TaxLine {
  key: string;
  label: string;
  amountCents: Cents;
  explanation: string;
  status?: RuleStatus;
}

export interface TaxEstimate {
  fy: string;
  supported: boolean;
  income: TaxLine[];
  assessableIncomeCents: Cents;
  deductionsCents: Cents;
  taxableIncomeCents: Cents;
  grossTaxCents: Cents;
  litoCents: Cents;
  netIncomeTaxCents: Cents;
  medicareLevyCents: Cents;
  studyLoanRepaymentCents: Cents;
  frankingOffsetCents: Cents;
  totalLiabilityCents: Cents;
  paygWithheldCents: Cents;
  paygInstalmentsCents: Cents;
  /** TFN amounts withheld from employee share scheme discounts (label C). */
  essTfnWithheldCents: Cents;
  /** Positive: estimated tax still to pay. Negative: estimated overpayment (possible refund). */
  balanceCents: Cents;
  marginalRatePercent: number;
  steps: TaxLine[];
  warnings: string[];
  notes: string[];
  sources: SourceRef[];
  disclaimer: string;
  summary: string;
}

/* ------------------------------ components ------------------------------ */

/** Income tax on whole-dollar taxable income using marginal brackets. */
export function incomeTax(taxableDollars: number, brackets: Bracket[]): Cents {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const lo = brackets[i].over;
    const hi = i + 1 < brackets.length ? brackets[i + 1].over : Infinity;
    if (taxableDollars > lo) tax += (Math.min(taxableDollars, hi) - lo) * brackets[i].rate;
  }
  return roundCents(tax * 100);
}

export function marginalRate(taxableDollars: number, brackets: Bracket[]): number {
  let rate = 0;
  for (const b of brackets) if (taxableDollars > b.over) rate = b.rate;
  return rate;
}

export function lowIncomeTaxOffset(taxableDollars: number, l: TaxYearRules['lito']['value']): Cents {
  let v: number;
  if (taxableDollars <= l.fullTo) v = l.max;
  else if (taxableDollars <= l.secondFrom) v = l.max - (taxableDollars - l.fullTo) * l.firstTaper;
  else if (taxableDollars <= l.cutOut) v = l.secondBase - (taxableDollars - l.secondFrom) * l.secondTaper;
  else v = 0;
  return roundCents(Math.max(0, v) * 100);
}

export function medicareLevy(taxableDollars: number, m: TaxYearRules['medicare']['value']): Cents {
  if (taxableDollars <= m.singleLower) return 0;
  const full = taxableDollars * m.rate;
  const phased = (taxableDollars - m.singleLower) * m.phaseInRate;
  return roundCents(Math.min(full, phased) * 100);
}

export function studyLoanRepayment(repaymentIncomeDollars: number, rule: StudyLoanRule): Cents {
  if (rule.kind === 'percentage-of-income') {
    let rate = 0;
    for (const t of rule.thresholds) if (repaymentIncomeDollars >= t.from) rate = t.rate;
    return roundCents(repaymentIncomeDollars * rate * 100);
  }
  if (repaymentIncomeDollars <= rule.nilTo) return 0;
  if (repaymentIncomeDollars >= rule.flatFrom) return roundCents(repaymentIncomeDollars * rule.flatRate * 100);
  let tier = rule.tiers[0];
  for (const t of rule.tiers) if (repaymentIncomeDollars > t.over) tier = t;
  return roundCents((tier.base + (repaymentIncomeDollars - tier.over) * tier.rate) * 100);
}

/* ------------------------------ estimate ------------------------------ */

const OMISSIONS =
  'Not included: Medicare levy surcharge, private health insurance rebate, seniors and pensioners tax offset and other offsets, ' +
  'family-income Medicare reductions, non-resident and working-holiday rates, reportable fringe benefits, and non-commercial loss rules.';

export function estimateTax(input: TaxInput): TaxEstimate {
  const found = rulesFor(input.fy);
  const warnings: string[] = [];
  const notes: string[] = [];
  if (!found) {
    return {
      fy: input.fy, supported: false, income: [], assessableIncomeCents: 0, deductionsCents: 0, taxableIncomeCents: 0, grossTaxCents: 0, litoCents: 0,
      netIncomeTaxCents: 0, medicareLevyCents: 0, studyLoanRepaymentCents: 0, frankingOffsetCents: 0, totalLiabilityCents: 0,
      paygWithheldCents: input.paygWithheldCents, paygInstalmentsCents: input.paygInstalmentsCents, essTfnWithheldCents: input.essTfnWithheldCents ?? 0, balanceCents: 0, marginalRatePercent: 0,
      steps: [], warnings: [`Tax rules for ${fyDisplay(input.fy)} are not included in this version.`], notes: [], sources: [], disclaimer: TAX_DISCLAIMER,
      summary: `No estimate is available for ${fyDisplay(input.fy)}.`,
    };
  }
  const { rules } = found;
  notes.push(...rules.notes);
  for (const c of [rules.residentRates, rules.medicare, rules.lito, rules.studyLoan]) if (c.note) notes.push(c.note);

  const income: TaxLine[] = [];
  const add = (key: string, label: string, amountCents: Cents, explanation: string) => {
    if (amountCents !== 0) income.push({ key, label, amountCents, explanation });
  };
  add('employment', 'Salary and wages (gross)', input.employmentGrossCents, 'Gross (before tax) employment income from payslips or amounts you entered — not the net bank deposits.');
  add('allowances', 'Allowances', input.allowancesCents, 'Taxable allowances recorded on payslips.');
  const businessNet = input.businessIncomeCents - input.businessExpensesCents;
  if (input.businessIncomeCents || input.businessExpensesCents) {
    if (businessNet < 0) {
      warnings.push(`Business and contractor records show a net loss of ${formatMoney(-businessNet)}. Whether a loss can reduce other income depends on the non-commercial loss rules, so it has not been deducted — check with your tax agent.`);
      add('business', 'Business / contractor net income', 0, 'Net loss not deducted (see warnings).');
    } else {
      add('business', 'Business / contractor net income', businessNet, `${formatMoney(input.businessIncomeCents)} income less ${formatMoney(input.businessExpensesCents)} business expenses (business share only). Incoming payments are not assumed to be profit.`);
    }
  }
  add('interest', 'Interest', input.interestCents, 'Interest credited to bank accounts and term deposits in this financial year.');
  add('dividends', 'Dividends (franked and unfranked)', input.dividendsFrankedCents + input.dividendsUnfrankedCents, 'Cash dividends from dividend statements you entered.');
  add('franking', 'Franking credits (gross-up)', input.frankingCreditsCents, 'Franking credits from dividend statements are added to income and then allowed as a refundable offset. They are never inferred from cash received alone.');
  add('other', 'Other taxable income', input.otherIncomeCents, 'Other amounts you classified as taxable income.');
  if (input.netCapitalGainCents === null) {
    warnings.push('CGT estimate unavailable until cost-base information is provided.');
  } else {
    add('cgt', 'Net capital gain', input.netCapitalGainCents, 'From disposals with complete cost-base records, after capital losses and the 50% discount where eligible.');
  }

  const essD = input.essTaxedUpfrontReductionCents ?? 0;
  const essGross = essD + (input.essTaxedUpfrontCents ?? 0) + (input.essDeferralCents ?? 0);
  if (essGross) {
    // The reduction test uses income before the reduction (plus reportable super).
    const before = income.reduce((a, l) => a + l.amountCents, 0) + essGross - Math.max(0, input.deductionsCents);
    const testDollars = Math.floor(before / 100) + Math.floor(input.reportableSuperCents / 100);
    const reduction = essD > 0 && testDollars <= ESS_REDUCTION_INCOME_LIMIT ? Math.min(ESS_REDUCTION_CENTS, essD) : 0;
    const parts = [
      essD ? `${formatMoney(essD)} taxed upfront and eligible for the reduction (D)` : '',
      input.essTaxedUpfrontCents ? `${formatMoney(input.essTaxedUpfrontCents)} taxed upfront, not eligible (E)` : '',
      input.essDeferralCents ? `${formatMoney(input.essDeferralCents)} from deferral schemes (F)` : '',
    ].filter(Boolean);
    add('ess', 'Employee share scheme discounts', essGross - reduction,
      `From employee share scheme statements: ${parts.join(', ')}.${reduction ? ` Less the reduction of ${formatMoney(reduction)} (income is $${ESS_REDUCTION_INCOME_LIMIT.toLocaleString('en-AU')} or less).` : essD ? ` No reduction: income is over $${ESS_REDUCTION_INCOME_LIMIT.toLocaleString('en-AU')}.` : ''}`);
  }

  const assessable = income.reduce((a, l) => a + l.amountCents, 0);
  const deductions = Math.max(0, input.deductionsCents);
  const taxableCents = Math.max(0, assessable - deductions);
  const taxableDollars = Math.floor(taxableCents / 100); // taxable income is in whole dollars
  const grossTax = incomeTax(taxableDollars, rules.residentRates.value);
  const litoFull = lowIncomeTaxOffset(taxableDollars, rules.lito.value);
  const lito = Math.min(litoFull, grossTax); // non-refundable
  const netIncomeTax = grossTax - lito;
  const medicare = input.medicareExempt ? 0 : medicareLevy(taxableDollars, rules.medicare.value);
  const repaymentIncome = taxableDollars + Math.floor(input.reportableSuperCents / 100);
  const help = input.hasStudyLoan ? studyLoanRepayment(repaymentIncome, rules.studyLoan.value) : 0;
  const franking = input.frankingCreditsCents;
  const liability = netIncomeTax + medicare + help - franking;
  const essTfn = input.essTfnWithheldCents ?? 0;
  const balance = liability - input.paygWithheldCents - input.paygInstalmentsCents - essTfn;
  const mr = marginalRate(taxableDollars, rules.residentRates.value) + (!input.medicareExempt && taxableDollars > rules.medicare.value.singleUpper ? rules.medicare.value.rate : 0);

  const steps: TaxLine[] = [
    { key: 'assessable', label: 'Assessable income', amountCents: assessable, explanation: 'Total of the income lines above.' },
    { key: 'deductions', label: 'Deductions recorded', amountCents: -deductions, explanation: 'Deductions you recorded (including the business share of mixed expenses where not already counted as business expenses).' },
    { key: 'taxable', label: 'Estimated taxable income', amountCents: taxableDollars * 100, explanation: 'Assessable income less deductions, rounded down to whole dollars.' },
    { key: 'gross-tax', label: 'Income tax on taxable income', amountCents: grossTax, explanation: `Resident tax rates for ${fyDisplay(rules.fy)}.`, status: rules.residentRates.status },
    { key: 'lito', label: 'Less low income tax offset', amountCents: -lito, explanation: `$${rules.lito.value.max} up to $${rules.lito.value.fullTo.toLocaleString('en-AU')}, reducing to nil at $${rules.lito.value.cutOut.toLocaleString('en-AU')}. Cannot reduce tax below zero.`, status: rules.lito.status },
    { key: 'medicare', label: 'Medicare levy', amountCents: medicare, explanation: input.medicareExempt ? 'You marked yourself as exempt from the Medicare levy.' : `2% of taxable income, reduced for single low-income earners (nil up to $${rules.medicare.value.singleLower.toLocaleString('en-AU')}).`, status: rules.medicare.status },
  ];
  if (input.hasStudyLoan) steps.push({ key: 'help', label: 'Study and training loan repayment', amountCents: help, explanation: `Based on repayment income of $${repaymentIncome.toLocaleString('en-AU')} (taxable income plus reportable super). Fringe benefits, net investment losses and exempt foreign income are not included.`, status: rules.studyLoan.status });
  if (franking) steps.push({ key: 'franking', label: 'Less franking credits (refundable)', amountCents: -franking, explanation: 'Franking credits from dividend statements.' });
  steps.push({ key: 'liability', label: 'Estimated total tax', amountCents: liability, explanation: 'Income tax less offsets, plus Medicare levy and any study-loan repayment.' });
  steps.push({ key: 'payg', label: 'Less PAYG withheld', amountCents: -input.paygWithheldCents, explanation: 'Tax already withheld by employers and payers (from payslips and payment summaries you entered).' });
  if (input.paygInstalmentsCents) steps.push({ key: 'instalments', label: 'Less PAYG instalments paid', amountCents: -input.paygInstalmentsCents, explanation: 'PAYG instalments you recorded as paid for this year.' });
  if (essTfn) steps.push({ key: 'ess-tfn', label: 'Less TFN amounts withheld from share scheme discounts', amountCents: -essTfn, explanation: 'Label C on your employee share scheme statement.' });

  if (input.employmentGrossCents === 0 && input.paygWithheldCents === 0) {
    notes.push('No payslip or gross salary information is recorded for this year. Salary deposits in your bank account are net amounts and cannot be used as taxable income.');
  }
  notes.push(OMISSIONS);

  const sourceIds = new Set<string>();
  for (const c of [rules.residentRates, rules.medicare, rules.lito, rules.studyLoan, rules.cgt]) c.sourceIds.forEach((s) => sourceIds.add(s));
  const summary = balance > 0
    ? `Estimated remaining tax of about ${formatMoney(balance, { wholeDollars: true })} for ${fyDisplay(rules.fy)}, based on the records currently available.`
    : balance < 0
      ? `Estimated overpayment of about ${formatMoney(-balance, { wholeDollars: true })} for ${fyDisplay(rules.fy)}, based on the records currently available.`
      : `Tax withheld appears to match the estimated tax for ${fyDisplay(rules.fy)}, based on the records currently available.`;

  return {
    fy: input.fy,
    supported: true,
    income,
    assessableIncomeCents: assessable,
    deductionsCents: deductions,
    taxableIncomeCents: taxableDollars * 100,
    grossTaxCents: grossTax,
    litoCents: lito,
    netIncomeTaxCents: netIncomeTax,
    medicareLevyCents: medicare,
    studyLoanRepaymentCents: help,
    frankingOffsetCents: franking,
    totalLiabilityCents: liability,
    paygWithheldCents: input.paygWithheldCents,
    paygInstalmentsCents: input.paygInstalmentsCents,
    essTfnWithheldCents: essTfn,
    balanceCents: balance,
    marginalRatePercent: Math.round(mr * 1000) / 10,
    steps,
    warnings,
    notes,
    sources: [...sourceIds].map((id) => rules.sources[id]).filter(Boolean),
    disclaimer: TAX_DISCLAIMER,
    summary,
  };
}

export function emptyTaxInput(fy: string): TaxInput {
  return {
    fy, employmentGrossCents: 0, allowancesCents: 0, paygWithheldCents: 0, reportableSuperCents: 0, businessIncomeCents: 0,
    businessExpensesCents: 0, interestCents: 0, dividendsFrankedCents: 0, dividendsUnfrankedCents: 0, frankingCreditsCents: 0,
    otherIncomeCents: 0, netCapitalGainCents: 0, deductionsCents: 0, paygInstalmentsCents: 0, hasStudyLoan: false,
  };
}
