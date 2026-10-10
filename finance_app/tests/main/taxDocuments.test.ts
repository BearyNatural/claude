import { describe, expect, it } from 'vitest';
import { testCtx } from '../helpers/ctx';
import { makePdf, essStatement, payslipWithYtd, payslipColumns, payslipSideBySideYtd, payslipColumnSummary, payslipTotalsColumn } from '../helpers/pdf';
import { extractPdfText } from '@main/import/pdfExtract';
import { parseEssStatement, isEssStatement } from '@domain/import/essStatement';
import { parsePayslip } from '@domain/import/payslip';
import { emptyTaxInput, estimateTax } from '@domain/tax/australia/estimator';
import { readEssStatement, saveEssStatement, readPayslip, payslipSaved } from '@main/services/taxDocuments';
import { listTaxEntries, taxEstimate } from '@main/services/taxes';
import { updateSettings } from '@main/services/core';

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

  it('reads a "Year To Date | This Period" summary and a separate super contributions table', async () => {
    const { pages } = await extractPdfText(await makePdf([payslipSideBySideYtd()]));
    const r = parsePayslip(pages);
    expect(r).toMatchObject({
      employer: null, employerAbn: '12345678901', payDate: '2026-07-30', periodStart: '2026-07-01', periodEnd: '2026-07-31',
      grossCents: 250000, paygCents: 45000, employerSuperCents: 28750, netCents: 205000, deductionsCents: 0,
    });
    expect(r.warnings[0]).toMatch(/not printed on this payslip \(ABN 12 345 678 901\)/);
  });

  it('reads dates under column headings, allowances beside the earnings and a summary row above a YTD table', async () => {
    const { pages } = await extractPdfText(await makePdf([payslipColumnSummary()]));
    expect(parsePayslip(pages)).toMatchObject({
      employer: 'Example Consulting Pty Ltd', payDate: '2026-10-28', periodStart: '2026-10-01', periodEnd: '2026-10-31',
      grossCents: 202500, allowancesCents: 2500, paygCents: 30000, employerSuperCents: 24000, netCents: 172500, deductionsCents: 0,
    });
  });

  it('reads a Totals column, "EmpER SGC" and dates like 08-JUN-2026', async () => {
    const { pages } = await extractPdfText(await makePdf([payslipTotalsColumn()]));
    expect(parsePayslip(pages)).toMatchObject({
      employer: 'Example Insurance Holdings Pty Ltd', payDate: '2026-06-25', periodStart: '2026-06-08', periodEnd: '2026-06-21',
      grossCents: 300000, allowancesCents: 0, paygCents: 60000, employerSuperCents: 36000, netCents: 240000, deductionsCents: 0,
    });
  });

  it('remembers an employer name for payslips that only print the ABN', async () => {
    const ctx = await testCtx();
    const bytes = await makePdf([payslipSideBySideYtd()]);
    const first = await readPayslip(ctx, 'july.pdf', bytes);
    expect(first.employer).toBeNull();
    payslipSaved(ctx, null, first.token, 'slip-1', { employer: 'Example Web Company Pty Ltd', payDate: '2026-07-30', grossCents: 250000, allowancesCents: 0, salarySacrificeCents: 0, paygCents: 45000, employerSuperCents: 28750, netCents: 205000 }, false);
    const next = await readPayslip(ctx, 'august.pdf', bytes);
    expect(next.employer).toBe('Example Web Company Pty Ltd');
    expect(next.warnings.some((w) => /not printed on this payslip/.test(w))).toBe(false);
    // With layout learning switched off, the name still comes back from the ABN.
    updateSettings(ctx, { documentLearning: { layouts: false, model: false } });
    const plain = await readPayslip(ctx, 'august.pdf', bytes);
    expect(plain.employer).toBe('Example Web Company Pty Ltd');
    expect(plain.warnings[0]).toMatch(/filled in from an earlier payslip/);
  });
});
