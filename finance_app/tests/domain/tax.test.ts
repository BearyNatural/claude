import { describe, expect, it } from 'vitest';
import { emptyTaxInput, estimateTax, incomeTax, lowIncomeTaxOffset, medicareLevy, studyLoanRepayment, TAX_DISCLAIMER } from '@domain/tax/australia/estimator';
import { RULES, rulesFor, SUPPORTED_YEARS } from '@domain/tax/australia/rules';
import { capitalGains, discountEligible } from '@domain/tax/cgt';
import { basQuarters, basSummary, BAS_DISCLAIMER } from '@domain/tax/gst';
import { matchPayslipDeposit, payslipIssues, payslipTotals, Payslip } from '@domain/tax/payslips';

const r = (fy: string) => RULES[fy];

describe('tax rules are versioned by financial year', () => {
  it('supports several years with sources and review dates', () => {
    expect(SUPPORTED_YEARS).toEqual(['2024-25', '2025-26', '2026-27', '2027-28']);
    for (const fy of SUPPORTED_YEARS) {
      const rules = r(fy);
      expect(rules.lastReviewed).toBe('2026-09-27');
      for (const c of [rules.residentRates, rules.medicare, rules.lito, rules.studyLoan, rules.superannuation, rules.gst, rules.cgt]) {
        expect(c.sourceIds.length).toBeGreaterThan(0);
        for (const id of c.sourceIds) expect(rules.sources[id]?.url).toMatch(/^https:\/\/www\.ato\.gov\.au\//);
      }
    }
  });

  it('marks unpublished figures as provisional and falls back for later years', () => {
    expect(r('2026-27').medicare.status).toBe('provisional');
    expect(r('2027-28').residentRates.status).toBe('legislated');
    const later = rulesFor('2028-29')!;
    expect(later.fallbackFrom).toBe('2027-28');
    expect(later.rules.residentRates.status).toBe('provisional');
    expect(rulesFor('2019-20')).toBeNull();
  });
});

describe('tax components', () => {
  it('applies each year’s resident rates (ATO table values)', () => {
    expect(incomeTax(45000, r('2025-26').residentRates.value)).toBe(428800);
    expect(incomeTax(135000, r('2025-26').residentRates.value)).toBe(3128800);
    expect(incomeTax(190000, r('2025-26').residentRates.value)).toBe(5163800);
    expect(incomeTax(45000, r('2026-27').residentRates.value)).toBe(402000);
    expect(incomeTax(190000, r('2026-27').residentRates.value)).toBe(5137000);
    expect(incomeTax(45000, r('2027-28').residentRates.value)).toBe(375200);
    expect(incomeTax(18200, r('2025-26').residentRates.value)).toBe(0);
  });

  it('calculates the low income tax offset', () => {
    const l = r('2025-26').lito.value;
    expect(lowIncomeTaxOffset(30000, l)).toBe(70000);
    expect(lowIncomeTaxOffset(45000, l)).toBe(32500);
    expect(lowIncomeTaxOffset(50000, l)).toBe(25000);
    expect(lowIncomeTaxOffset(66667, l)).toBe(0);
  });

  it('phases in the Medicare levy (ATO example: $29,000 → $98.90 in 2025–26)', () => {
    const m = r('2025-26').medicare.value;
    expect(medicareLevy(28011, m)).toBe(0);
    expect(medicareLevy(29000, m)).toBe(9890);
    expect(medicareLevy(90000, m)).toBe(180000);
  });

  it('calculates study-loan repayments (ATO worked examples)', () => {
    expect(studyLoanRepayment(86380, r('2026-27').studyLoan.value)).toBe(252780);
    expect(studyLoanRepayment(137064, r('2026-27').studyLoan.value)).toBe(1027699);
    expect(studyLoanRepayment(99736, r('2024-25').studyLoan.value)).toBe(548548);
    expect(studyLoanRepayment(67000, r('2025-26').studyLoan.value)).toBe(0);
    expect(studyLoanRepayment(200000, r('2025-26').studyLoan.value)).toBe(2000000);
  });
});

describe('tax estimates', () => {
  it('salary only, with PAYG withheld', () => {
    const e = estimateTax({ ...emptyTaxInput('2025-26'), employmentGrossCents: 9000000, paygWithheldCents: 1960000 });
    expect(e.taxableIncomeCents).toBe(9000000);
    expect(e.grossTaxCents).toBe(1778800);
    expect(e.litoCents).toBe(0);
    expect(e.medicareLevyCents).toBe(180000);
    expect(e.totalLiabilityCents).toBe(1958800);
    expect(e.balanceCents).toBe(-1200);
    expect(e.marginalRatePercent).toBe(32);
    expect(e.summary).toMatch(/Estimated overpayment of about \$12 for 2025–26, based on the records currently available/);
    expect(e.disclaimer).toBe(TAX_DISCLAIMER);
  });

  it('low income: offset cannot go below zero', () => {
    const e = estimateTax({ ...emptyTaxInput('2025-26'), employmentGrossCents: 2000000 });
    expect(e.grossTaxCents).toBe(28800);
    expect(e.litoCents).toBe(28800);
    expect(e.netIncomeTaxCents).toBe(0);
    expect(e.medicareLevyCents).toBe(0);
  });

  it('salary plus contracting with no tax withheld', () => {
    const e = estimateTax({ ...emptyTaxInput('2026-27'), employmentGrossCents: 8000000, paygWithheldCents: 1600000, businessIncomeCents: 2000000, businessExpensesCents: 300000 });
    expect(e.income.find((l) => l.key === 'business')?.amountCents).toBe(1700000);
    expect(e.taxableIncomeCents).toBe(9700000);
    expect(e.grossTaxCents).toBe(incomeTax(97000, r('2026-27').residentRates.value));
    expect(e.balanceCents).toBeGreaterThan(0);
    expect(e.summary).toMatch(/^Estimated remaining tax of about/);
  });

  it('sole trader with a loss is not netted against other income', () => {
    const e = estimateTax({ ...emptyTaxInput('2025-26'), employmentGrossCents: 6000000, businessIncomeCents: 500000, businessExpensesCents: 900000 });
    expect(e.taxableIncomeCents).toBe(6000000);
    expect(e.warnings.join(' ')).toMatch(/non-commercial loss/);
  });

  it('includes interest, dividends and refundable franking credits', () => {
    const e = estimateTax({ ...emptyTaxInput('2025-26'), employmentGrossCents: 3000000, interestCents: 50000, dividendsFrankedCents: 70000, frankingCreditsCents: 30000 });
    expect(e.assessableIncomeCents).toBe(3000000 + 50000 + 70000 + 30000);
    expect(e.frankingOffsetCents).toBe(30000);
    // Franking credits are refundable, so the result can be an overpayment with no tax withheld.
    const low = estimateTax({ ...emptyTaxInput('2025-26'), dividendsFrankedCents: 70000, frankingCreditsCents: 30000 });
    expect(low.balanceCents).toBe(-30000);
  });

  it('gives different results for different financial years', () => {
    const base = { employmentGrossCents: 9000000 };
    const y1 = estimateTax({ ...emptyTaxInput('2025-26'), ...base });
    const y2 = estimateTax({ ...emptyTaxInput('2026-27'), ...base });
    const y3 = estimateTax({ ...emptyTaxInput('2027-28'), ...base });
    expect(y1.grossTaxCents - y2.grossTaxCents).toBe(26800);
    expect(y2.grossTaxCents - y3.grossTaxCents).toBe(26800);
    expect(y2.notes.join(' ')).toMatch(/2026–27 low-income thresholds had not been published/);
    expect(y3.notes.join(' ')).toMatch(/14% rate from 1 July 2027 is law/);
  });

  it('adds study-loan repayments including reportable super', () => {
    const e = estimateTax({ ...emptyTaxInput('2026-27'), employmentGrossCents: 11845000, reportableSuperCents: 1861400, hasStudyLoan: true });
    expect(e.studyLoanRepaymentCents).toBe(1027699);
  });

  it('refuses to guess CGT without cost bases and flags missing payslips', () => {
    const e = estimateTax({ ...emptyTaxInput('2025-26'), netCapitalGainCents: null });
    expect(e.warnings).toContain('CGT estimate unavailable until cost-base information is provided.');
    expect(e.notes.join(' ')).toMatch(/net amounts and cannot be used as taxable income/);
    expect(estimateTax(emptyTaxInput('2019-20')).supported).toBe(false);
  });
});

describe('capital gains', () => {
  it('applies the 12-month rule excluding acquisition and event days', () => {
    expect(discountEligible('2025-07-01', '2026-07-01')).toBe(false);
    expect(discountEligible('2025-07-01', '2026-07-02')).toBe(true);
  });

  it('matches parcels FIFO, applies losses then the discount', () => {
    const parcels = [
      { id: 'p1', securityId: 'ABC', acquiredDate: '2024-01-10', quantity: 100, costCents: 100000 },
      { id: 'p2', securityId: 'ABC', acquiredDate: '2025-12-01', quantity: 100, costCents: 200000 },
      { id: 'p3', securityId: 'XYZ', acquiredDate: '2025-08-01', quantity: 50, costCents: 500000 },
    ];
    const disposals = [
      { id: 'd1', securityId: 'ABC', date: '2026-03-01', quantity: 150, proceedsCents: 450000 },
      { id: 'd2', securityId: 'XYZ', date: '2026-04-01', quantity: 50, proceedsCents: 400000 },
    ];
    const res = capitalGains(parcels, disposals, '2025-26');
    // p1: 100 units cost 1,000 → proceeds 3,000 → gain 2,000 (discountable)
    // p2: 50 units cost 1,000 → proceeds 1,500 → gain 500 (not held 12 months)
    // XYZ: loss 1,000
    expect(res.events.map((e) => [e.parcelId, e.gainCents, e.discountEligible])).toEqual([['p1', 200000, true], ['p2', 50000, false], ['p3', -100000, false]]);
    // Loss wipes the $500 non-discount gain first, then $500 of the discountable gain; $1,500 × 50% = $750.
    expect(res.netCapitalGainCents).toBe(75000);
    expect(res.discountCents).toBe(75000);
  });

  it('reports unavailable when a cost base is missing', () => {
    const res = capitalGains([{ id: 'p', securityId: 'A', acquiredDate: '2020-01-01', quantity: 10, costCents: null }], [{ id: 'd', securityId: 'A', date: '2026-01-01', quantity: 10, proceedsCents: 100000 }], '2025-26');
    expect(res.netCapitalGainCents).toBeNull();
    expect(res.explanation).toBe('CGT estimate unavailable until cost-base information is provided.');
    const noParcel = capitalGains([], [{ id: 'd', securityId: 'A', date: '2026-01-01', quantity: 10, proceedsCents: 100000 }], '2025-26');
    expect(noParcel.missing[0]).toMatch(/No purchase record/);
  });
});

describe('GST and BAS preparation', () => {
  const txs = [
    { id: 's1', date: '2026-07-10', amountCents: 110000, gstClass: 'taxable' as const, businessPercent: 100 },
    { id: 's2', date: '2026-08-10', amountCents: 50000, gstClass: 'gst-free' as const, businessPercent: 100 },
    { id: 'p1', date: '2026-08-12', amountCents: -22000, gstClass: 'taxable' as const, businessPercent: 100 },
    { id: 'p2', date: '2026-09-01', amountCents: -11000, gstClass: 'taxable' as const, businessPercent: 40 },
    { id: 'p3', date: '2026-09-02', amountCents: -5000, gstClass: 'gst-free' as const, businessPercent: 100 },
    { id: 'x', date: '2026-09-03', amountCents: -99999, gstClass: 'not-reportable' as const, businessPercent: 0 },
    { id: 'late', date: '2026-10-01', amountCents: 110000, gstClass: 'taxable' as const, businessPercent: 100 },
  ];
  const q1 = basQuarters('2026-27')[0];

  it('summarises G1, 1A and 1B for a registered business', () => {
    expect(q1).toMatchObject({ start: '2026-07-01', end: '2026-09-30', label: 'Jul–Sep 2026' });
    const s = basSummary(txs, q1, true);
    expect(s.g1TotalSalesCents).toBe(160000);
    expect(s.gstOnSales1ACents).toBe(10000);
    expect(s.gstOnPurchases1BCents).toBe(2000 + 400);
    expect(s.netGstCents).toBe(10000 - 2400);
    expect(s.disclaimer).toBe(BAS_DISCLAIMER);
  });

  it('calculates nothing for someone not registered', () => {
    const s = basSummary(txs, q1, false);
    expect(s.gstOnSales1ACents).toBe(0);
    expect(s.notes[0]).toMatch(/not marked yourself as GST registered/);
  });
});

describe('payslips', () => {
  const slip: Payslip = { id: 'p', employer: 'Example Pty Ltd', payDate: '2026-09-17', grossCents: 346154, allowancesCents: 0, salarySacrificeCents: 20000, paygCents: 70000, employerSuperCents: 41538, deductionsCents: 1500, netCents: 254654 };

  it('checks net pay adds up and links the bank deposit', () => {
    expect(payslipIssues(slip)).toEqual([]);
    expect(payslipIssues({ ...slip, netCents: 250000 })[0]).toMatch(/Difference: \$46\.54/);
    const m = matchPayslipDeposit(slip, [
      { id: 'a', date: '2026-09-18', amountCents: 254654, description: 'PAYROLL' },
      { id: 'b', date: '2026-09-17', amountCents: 999, description: 'OTHER' },
    ]);
    expect(m).toEqual({ id: 'a', exactDate: false });
  });

  it('totals a financial year by pay date', () => {
    const t = payslipTotals([slip, { ...slip, id: 'q', payDate: '2026-06-30' }], '2026-27');
    expect(t.count).toBe(1);
    expect(t.taxableCents).toBe(326154);
    expect(t.paygCents).toBe(70000);
  });
});
