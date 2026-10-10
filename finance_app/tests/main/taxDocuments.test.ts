import { describe, expect, it } from 'vitest';
import { testCtx } from '../helpers/ctx';
import { makePdf, essStatement, payslipWithYtd, payslipColumns } from '../helpers/pdf';
import { extractPdfText } from '@main/import/pdfExtract';
import { parseEssStatement, isEssStatement } from '@domain/import/essStatement';
import { parsePayslip } from '@domain/import/payslip';
import { emptyTaxInput, estimateTax } from '@domain/tax/australia/estimator';
import { readEssStatement, saveEssStatement, readPayslip } from '@main/services/taxDocuments';
import { listTaxEntries, taxEstimate } from '@main/services/taxes';

describe('employee share scheme statements', () => {
  it('reads labels D, E, F and C, the year and the employer — not the TFN', async () => {
    const { pages } = await extractPdfText(await makePdf([essStatement({ d: '0', e: '0', f: '1500', c: '0' })]));
    expect(isEssStatement(pages)).toBe(true);
    const r = parseEssStatement(pages);
    expect(r).toMatchObject({ fy: '2025-26', employerName: 'Example Software Pty Ltd', employerAbn: '12345678901', taxedUpfrontReductionCents: 0, taxedUpfrontCents: 0, deferralCents: 150000, tfnWithheldCents: 0 });
    expect(r.found).toEqual(['D', 'E', 'F', 'C']);
    expect(JSON.stringify(r)).not.toContain('000000000');
  });

  it('adds the discounts to the tax estimate, with the reduction and the TFN credit', async () => {
    const ctx = await testCtx('2026-08-01');
    const before = taxEstimate(ctx, '2025-26');
    const read = await readEssStatement(ctx, 'ess.pdf', await makePdf([essStatement({ d: '800', e: '0', f: '1500', c: '100.50' })]));
    expect(saveEssStatement(ctx, null, { fy: read.fy!, employer: read.employerName!, taxedUpfrontReductionCents: read.taxedUpfrontReductionCents, taxedUpfrontCents: read.taxedUpfrontCents, deferralCents: read.deferralCents, tfnWithheldCents: read.tfnWithheldCents }).saved).toBe(3);
    // Saving the same statement again replaces it rather than doubling it.
    saveEssStatement(ctx, null, { fy: '2025-26', employer: 'Example Software Pty Ltd', taxedUpfrontReductionCents: 80000, taxedUpfrontCents: 0, deferralCents: 150000, tfnWithheldCents: 10050 });
    expect(listTaxEntries(ctx, '2025-26').map((e) => e.kind).sort()).toEqual(['ess-deferral', 'ess-taxed-upfront-reduction', 'ess-tfn-withheld']);
    const after = taxEstimate(ctx, '2025-26');
    const line = after.income.find((l) => l.key === 'ess');
    expect(line?.amountCents).toBe(150000); // $800 (D) is fully reduced; $1,500 (F) is taxed
    expect(after.taxableIncomeCents - before.taxableIncomeCents).toBe(150000);
    expect(after.essTfnWithheldCents).toBe(10050);
    expect(after.steps.find((s) => s.key === 'ess-tfn')?.amountCents).toBe(-10050);
    expect(after.balanceCents).toBe(after.totalLiabilityCents - after.paygWithheldCents - after.paygInstalmentsCents - 10050);
  });

  it('does not give the reduction above $180,000', () => {
    const input = { ...emptyTaxInput('2025-26'), employmentGrossCents: 20000000, essTaxedUpfrontReductionCents: 80000 };
    expect(estimateTax(input).income.find((l) => l.key === 'ess')?.amountCents).toBe(80000);
    const low = { ...emptyTaxInput('2025-26'), employmentGrossCents: 6000000, essTaxedUpfrontReductionCents: 150000 };
    expect(estimateTax(low).income.find((l) => l.key === 'ess')?.amountCents).toBe(50000); // only $1,000 comes off
  });

  it('refuses a PDF that is not a share scheme statement', async () => {
    const ctx = await testCtx();
    await expect(readEssStatement(ctx, 'payslip.pdf', await makePdf([payslipWithYtd()]))).rejects.toThrow(/does not look like/);
  });
});

describe('payslip PDFs', () => {
  it('reads this pay, not the year-to-date column', async () => {
    const { pages } = await extractPdfText(await makePdf([payslipWithYtd()]));
    const r = parsePayslip(pages);
    expect(r).toMatchObject({
      employer: 'Example Health Pty Ltd', payDate: '2026-09-17', periodStart: '2026-09-01', periodEnd: '2026-09-14',
      grossCents: 322000, allowancesCents: 2000, salarySacrificeCents: 10000, paygCents: 61200, employerSuperCents: 38400, netCents: 248300,
      deductionsCents: 2500, // gross − salary sacrifice − tax − net
    });
    expect(r.warnings.some((w) => /year-to-date/i.test(w))).toBe(true);
  });

  it('reads totals laid out as columns', async () => {
    const ctx = await testCtx();
    const r = await readPayslip(ctx, 'slip.pdf', await makePdf([payslipColumns()]));
    expect(r).toMatchObject({ employer: 'Example Cafe Pty Ltd', payDate: '2026-10-02', periodEnd: '2026-09-30', grossCents: 100000, paygCents: 12000, employerSuperCents: 12000, netCents: 88000, deductionsCents: 0 });
    expect(r.token).toBeTruthy();
    expect(r.warnings).toEqual([]);
  });

  it('says what it could not find', async () => {
    const { pages } = await extractPdfText(await makePdf([[{ text: 'Example Pty Ltd', x: 50, y: 800 }, { text: 'Hours worked', x: 50, y: 780 }, { text: '38', x: 300, y: 780 }, { text: 'Some other text here', x: 50, y: 760 }, { text: 'More text', x: 50, y: 740 }]]));
    const r = parsePayslip(pages);
    expect(r.grossCents).toBeNull();
    expect(r.warnings[0]).toMatch(/gross pay, tax withheld, net pay/);
  });
});
