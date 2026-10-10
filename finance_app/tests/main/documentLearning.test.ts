import { describe, expect, it } from 'vitest';
import { testCtx } from '../helpers/ctx';
import { makePdf, payslipFamily, slipValues, multiAccountStatementPages, PdfText } from '../helpers/pdf';
import { extractPdfText } from '@main/import/pdfExtract';
import { readDocument, learnLayoutFields, resolveAnchor, examplesFrom, trainModel, modelPredictions, similarity, SAME_LAYOUT, MODEL_MIN_DOCUMENTS } from '@domain/learning/documentLearning';
import { buildLines } from '@domain/import/pdfStatement';
import { FIELD_SPECS, learningOverview, forgetModel } from '@main/services/learning';
import { readPayslip, payslipSaved } from '@main/services/taxDocuments';
import { saveAccount, updateSettings } from '@main/services/core';
import { commitImport, openImport, previewImport } from '@main/services/imports';

const cents = (s: string) => Math.round(Number(s.replace(/,/g, '')) * 100);
const iso = (d: string) => `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
const confirmed = (v: ReturnType<typeof slipValues>, employer = 'Example Employer') => ({
  gross: cents(v.gross), allowances: 0, salarySacrifice: 0, payg: cents(v.tax), employerSuper: cents(v.superAmt), net: cents(v.net),
  payDate: iso(v.paid), periodStart: iso(v.start), periodEnd: iso(v.end), employer,
});
async function doc(items: PdfText[]) {
  const { pages } = await extractPdfText(await makePdf([items]));
  return readDocument(buildLines(pages), pages);
}
const save = (v: ReturnType<typeof slipValues>, employer = 'Example Logistics Pty Ltd') => ({
  employer, payDate: iso(v.paid), periodStart: iso(v.start), periodEnd: iso(v.end), grossCents: cents(v.gross), allowancesCents: 0, salarySacrificeCents: 0,
  paygCents: cents(v.tax), employerSuperCents: cents(v.superAmt), netCents: cents(v.net),
});

describe('learned layouts', () => {
  it('recognise the same layout and read new figures from where the old ones were', async () => {
    const first = await doc(payslipFamily('totals', slipValues(1)));
    const next = await doc(payslipFamily('totals', slipValues(2), -6));
    const other = await doc(payslipFamily('rows', slipValues(3)));
    expect(similarity(first.fingerprint, next.fingerprint)).toBeGreaterThanOrEqual(SAME_LAYOUT);
    expect(similarity(first.fingerprint, other.fingerprint)).toBeLessThan(SAME_LAYOUT);

    const fields = learnLayoutFields(first, FIELD_SPECS.payslip, confirmed(slipValues(1)));
    expect(Object.keys(fields)).toEqual(expect.arrayContaining(['gross', 'payg', 'employerSuper', 'net', 'payDate', 'periodStart', 'periodEnd', 'employer']));
    const read = (name: string, kind: 'money' | 'date') => {
      const f = fields[name];
      const c = 'anchor' in f ? resolveAnchor(next, kind, f.anchor) : null;
      return kind === 'money' ? c?.cents : c?.date;
    };
    const v2 = slipValues(2);
    expect(read('employerSuper', 'money')).toBe(cents(v2.superAmt));
    expect(read('payg', 'money')).toBe(cents(v2.tax));
    expect(read('net', 'money')).toBe(cents(v2.net));
    expect(read('periodEnd', 'date')).toBe(iso(v2.end));
    expect(read('payDate', 'date')).toBe(iso(v2.paid));
  });
});

describe('the on-device model', () => {
  it('learns from confirmed documents and finds the figures on a layout it has not seen', async () => {
    const examples = [];
    let documents = 0;
    for (let n = 0; n < 8; n++) {
      for (const style of ['rows', 'grid'] as const) {
        const v = slipValues(n);
        examples.push(...examplesFrom(await doc(payslipFamily(style, v, n % 3)), FIELD_SPECS.payslip, confirmed(v)));
        documents++;
      }
    }
    const fields = FIELD_SPECS.payslip.filter((f) => f.kind !== 'constant').map((f) => f.name);
    const model = trainModel(examples, fields, documents, '2026-10-11T00:00:00Z');
    const v = slipValues(20);
    const unseen = await doc(payslipFamily('totals', v));
    const p = modelPredictions(model, unseen, FIELD_SPECS.payslip);
    // Words learned in other layouts carry over: "Gross", "Net", and "contribution" for super.
    expect(p.gross?.candidate.cents).toBe(cents(v.gross));
    expect(p.net?.candidate.cents).toBe(cents(v.net));
    expect(p.employerSuper?.candidate.cents).toBe(cents(v.superAmt));
    // Once it has seen this layout too, it reads every figure on it.
    for (let n = 0; n < 4; n++) {
      const w = slipValues(30 + n);
      examples.push(...examplesFrom(await doc(payslipFamily('totals', w, n)), FIELD_SPECS.payslip, confirmed(w)));
    }
    const wider = trainModel(examples, fields, documents + 4, '2026-10-11T00:00:00Z');
    const q = modelPredictions(wider, unseen, FIELD_SPECS.payslip);
    expect([q.gross?.candidate.cents, q.payg?.candidate.cents, q.net?.candidate.cents, q.employerSuper?.candidate.cents]).toEqual([cents(v.gross), cents(v.tax), cents(v.net), cents(v.superAmt)]);
    expect([q.periodStart?.candidate.date, q.periodEnd?.candidate.date, q.payDate?.candidate.date]).toEqual([iso(v.start), iso(v.end), iso(v.paid)]);
    // Too few documents: the model is not used yet.
    expect(modelPredictions({ ...model, documents: MODEL_MIN_DOCUMENTS - 1 }, unseen, FIELD_SPECS.payslip)).toEqual({});
  });
});

describe('learning from payslips you confirm', () => {
  it('learns a figure the built-in rules miss, and uses it on the next payslip', async () => {
    const ctx = await testCtx('2026-10-11');
    const v1 = slipValues(1);
    const first = await readPayslip(ctx, 'one.pdf', await makePdf([payslipFamily('totals', v1)]));
    expect(first.employerSuperCents).toBeNull(); // "Company contribution (CC)" isn't a label the rules know
    payslipSaved(ctx, null, first.token, 'slip-1', save(v1), false); // the person typed the super in
    const v2 = slipValues(2);
    const next = await readPayslip(ctx, 'two.pdf', await makePdf([payslipFamily('totals', v2)]));
    expect(next.employerSuperCents).toBe(cents(v2.superAmt));
    expect(next.sources.employerSuper).toBe('layout');
    expect(next.learnedNote).toMatch(/learned from your earlier Example Logistics Pty Ltd payslip/);
    const o = learningOverview(ctx);
    expect(o.layouts).toHaveLength(1);
    expect(o.layouts[0].fields).toContain('employer super');
    expect(o.models.find((m) => m.kind === 'payslip')?.documents).toBe(1);
  });

  it('learns nothing when both switches are off, and can forget the model', async () => {
    const ctx = await testCtx('2026-10-11');
    updateSettings(ctx, { documentLearning: { layouts: false, model: false } });
    const v1 = slipValues(1);
    const first = await readPayslip(ctx, 'one.pdf', await makePdf([payslipFamily('totals', v1)]));
    payslipSaved(ctx, null, first.token, 'slip-1', save(v1), false);
    expect(learningOverview(ctx).layouts).toHaveLength(0);
    expect(learningOverview(ctx).models.every((m) => m.documents === 0)).toBe(true);
    updateSettings(ctx, { documentLearning: { layouts: false, model: true } });
    const second = await readPayslip(ctx, 'two.pdf', await makePdf([payslipFamily('totals', slipValues(2))]));
    payslipSaved(ctx, null, second.token, 'slip-2', save(slipValues(2)), false);
    expect(learningOverview(ctx).models.find((m) => m.kind === 'payslip')?.documents).toBe(1);
    forgetModel(ctx);
    expect(learningOverview(ctx).models.every((m) => m.documents === 0)).toBe(true);
  });
});

/** A fictional statement whose opening balance is worded in a way the built-in reader doesn't know. */
function oddStatement(opening: string, rows: [string, string, string, string][], closing: string): PdfText[] {
  const items: PdfText[] = [
    { text: 'Example Credit Co-op', x: 50, y: 800, size: 14 },
    { text: 'Account number 9988 7766', x: 50, y: 780 },
    { text: 'Statement period 1 March 2026 to 31 March 2026', x: 50, y: 766 },
    { text: 'Starting figure', x: 50, y: 740 }, { text: opening, x: 550, y: 740, right: true },
    { text: 'Closing balance', x: 50, y: 726 }, { text: closing, x: 550, y: 726, right: true },
    { text: 'Date', x: 50, y: 700 }, { text: 'Transaction details', x: 110, y: 700 },
    { text: 'Debit', x: 400, y: 700, right: true }, { text: 'Credit', x: 470, y: 700, right: true }, { text: 'Balance', x: 550, y: 700, right: true },
  ];
  rows.forEach(([date, desc, amount, balance], i) => {
    const y = 684 - i * 13;
    items.push({ text: date, x: 50, y }, { text: desc, x: 110, y }, { text: amount.replace('-', ''), x: amount.startsWith('-') ? 400 : 470, y, right: true }, { text: balance, x: 550, y, right: true });
  });
  return items;
}

describe('learning from statements that balance', () => {
  it('learns where an unusual opening balance is printed', async () => {
    const ctx = await testCtx('2026-10-11');
    const acc = saveAccount(ctx, { name: 'Co-op', type: 'transaction', number: '99887766' });
    const s1 = await openImport(ctx, 'march.pdf', await makePdf([oddStatement('1,000.00', [['03 Mar', 'SHOP', '-50.00', '950.00'], ['10 Mar', 'PAY', '200.00', '1,150.00']], '1,150.00')]));
    expect(s1.statements[0].openingBalanceCents).toBeNull(); // the reader didn't recognise "Starting figure"
    const p1 = previewImport(ctx, s1.sessionId, 0, acc, { openingCents: 100000, closingCents: 115000 });
    commitImport(ctx, { sessionId: s1.sessionId, statementIndex: 0, accountId: acc, openingCents: 100000, closingCents: 115000, rows: p1.rows.map((r) => ({ index: r.index, include: true })) });
    expect(learningOverview(ctx).layouts.map((l) => l.kind)).toEqual(['statement']);

    const s2 = await openImport(ctx, 'april.pdf', await makePdf([oddStatement('1,150.00', [['02 Apr', 'SHOP', '-25.00', '1,125.00']], '1,125.00')]));
    expect(s2.statements[0].openingBalanceCents).toBe(115000);
    expect(previewImport(ctx, s2.sessionId, 0, acc).reconciliation.status).toBe('reconciled');
  });

  it('shows loan balances as owed on the review screen', async () => {
    const ctx = await testCtx('2026-07-20');
    const loan = saveAccount(ctx, { name: 'Home loan', type: 'mortgage', number: '55556666' });
    const s = await openImport(ctx, 'statement.pdf', await makePdf(multiAccountStatementPages()));
    const p = previewImport(ctx, s.sessionId, 2, loan);
    expect(p.balances).toMatchObject({ openingCents: -5000000, closingCents: -4924000 });
    expect(p.reconciliation.status).toBe('reconciled');
  });
});
