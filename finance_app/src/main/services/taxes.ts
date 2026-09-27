import { Ctx, UserError, bool, getSettings, num, str, listAccounts, recordChange } from './core';
import { ISODate, financialYearOf, fyRange, fyDisplay, formatDate, addDays, diffDays, isValidDate } from '../../domain/dates';
import { Cents, formatMoney, parseMoney, roundCents } from '../../domain/money';
import { Payslip, matchPayslipDeposit, payslipIssues, payslipTotals } from '../../domain/tax/payslips';
import { TaxInput, emptyTaxInput, estimateTax } from '../../domain/tax/australia/estimator';
import { rulesFor, SUPPORTED_YEARS } from '../../domain/tax/australia/rules';
import { basQuarters, basSummary, gstIncluded, gstTurnoverNote, GstTx } from '../../domain/tax/gst';
import { capitalGains } from '../../domain/tax/cgt';
import { Dividend, Security, Trade, Valuation, dividendTotals, holdings, parcelsAndDisposals, SecurityKind } from '../../domain/investments';
import { SuperEntry, SuperEntryKind, projectSuper, superBalanceHistory, superYearSummary, SuperProjectionInput } from '../../domain/superannuation';
import { readDelimited } from '../../domain/import/csv';
import { detectDateFormat, parseDateAs } from '../../domain/import/dateFormats';

/* ------------------------------ payslips ------------------------------ */

function payslipFromRow(r: Record<string, unknown>): Payslip {
  return {
    id: String(r.id), employer: String(r.employer), payDate: String(r.pay_date), periodStart: str(r.period_start), periodEnd: str(r.period_end),
    grossCents: Number(r.gross_cents), allowancesCents: Number(r.allowances_cents), salarySacrificeCents: Number(r.salary_sacrifice_cents),
    taxableCents: num(r.taxable_cents), paygCents: Number(r.payg_cents), employerSuperCents: Number(r.employer_super_cents),
    deductionsCents: Number(r.deductions_cents), netCents: Number(r.net_cents), linkedTransactionId: str(r.transaction_id),
  };
}

export function listPayslips(ctx: Ctx, fy?: string) {
  const range = fy ? fyRange(fy) : null;
  const rows = range ? ctx.db.all('SELECT * FROM payslips WHERE pay_date BETWEEN ? AND ? ORDER BY pay_date DESC', [range.start, range.end]) : ctx.db.all('SELECT * FROM payslips ORDER BY pay_date DESC');
  return rows.map(payslipFromRow).map((p) => ({ ...p, issues: payslipIssues(p) }));
}

export function savePayslip(ctx: Ctx, p: Payslip): { id: string; issues: string[]; linkedTransactionId: string | null } {
  if (!p.employer.trim()) throw new UserError('Enter the employer.');
  if (!isValidDate(p.payDate)) throw new UserError('Enter the pay date.');
  if (p.grossCents <= 0) throw new UserError('Enter gross pay.');
  const id = p.id || ctx.id();
  let linked = p.linkedTransactionId ?? null;
  if (!linked) {
    const deposits = ctx.db.all("SELECT id, date, amount_cents, original_description FROM transactions WHERE amount_cents = ? AND date BETWEEN ? AND ? AND payslip_id IS NULL", [p.netCents, addDays(p.payDate, -4), addDays(p.payDate, 4)])
      .map((t) => ({ id: String(t.id), date: String(t.date), amountCents: Number(t.amount_cents), description: String(t.original_description) }));
    linked = matchPayslipDeposit(p, deposits)?.id ?? null;
  }
  ctx.db.tx(() => {
    ctx.db.run(`INSERT INTO payslips(id, employer, pay_date, period_start, period_end, gross_cents, allowances_cents, salary_sacrifice_cents, taxable_cents, payg_cents,
        employer_super_cents, deductions_cents, net_cents, transaction_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET employer=excluded.employer, pay_date=excluded.pay_date, period_start=excluded.period_start, period_end=excluded.period_end,
        gross_cents=excluded.gross_cents, allowances_cents=excluded.allowances_cents, salary_sacrifice_cents=excluded.salary_sacrifice_cents, taxable_cents=excluded.taxable_cents,
        payg_cents=excluded.payg_cents, employer_super_cents=excluded.employer_super_cents, deductions_cents=excluded.deductions_cents, net_cents=excluded.net_cents, transaction_id=excluded.transaction_id`,
      [id, p.employer.trim(), p.payDate, p.periodStart ?? null, p.periodEnd ?? null, p.grossCents, p.allowancesCents, p.salarySacrificeCents, p.taxableCents ?? null, p.paygCents,
        p.employerSuperCents, p.deductionsCents, p.netCents, linked, ctx.now()]);
    if (linked) {
      ctx.db.run('UPDATE transactions SET payslip_id = ?, income_type = COALESCE(income_type, ?) WHERE id = ?', [id, 'salary', linked]);
      recordChange(ctx, 'transaction', linked, 'payslip', null, `${p.employer} payslip ${formatDate(p.payDate)}`, 'Linked to payslip (net pay matches)');
    }
  });
  ctx.changed('payslips');
  return { id, issues: payslipIssues({ ...p, id }), linkedTransactionId: linked };
}

export function deletePayslip(ctx: Ctx, id: string): void {
  ctx.db.tx(() => {
    ctx.db.run('UPDATE transactions SET payslip_id = NULL WHERE payslip_id = ?', [id]);
    ctx.db.run('DELETE FROM payslips WHERE id = ?', [id]);
  });
  ctx.changed('payslips');
}

/* ------------------------------ tax entries ------------------------------ */

export type TaxEntryKind = 'deduction' | 'payg-instalment' | 'other-income' | 'payg-withheld-other' | 'reportable-super';

export function listTaxEntries(ctx: Ctx, fy: string) {
  return ctx.db.all('SELECT * FROM tax_entries WHERE fy = ? ORDER BY date, created_at', [fy]).map((r) => ({
    id: String(r.id), fy: String(r.fy), kind: r.kind as TaxEntryKind, description: String(r.description), amountCents: Number(r.amount_cents), date: str(r.date), transactionId: str(r.transaction_id),
  }));
}

export function saveTaxEntry(ctx: Ctx, e: { id?: string; fy: string; kind: TaxEntryKind; description: string; amountCents: number; date?: ISODate | null }): string {
  if (!/^\d{4}-\d{2}$/.test(e.fy)) throw new UserError('Choose a financial year.');
  if (!e.description.trim()) throw new UserError('Describe this entry.');
  if (e.amountCents <= 0) throw new UserError('Enter a positive amount.');
  const id = e.id ?? ctx.id();
  ctx.db.run(`INSERT INTO tax_entries(id, fy, kind, description, amount_cents, date, created_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET fy=excluded.fy, kind=excluded.kind, description=excluded.description, amount_cents=excluded.amount_cents, date=excluded.date`,
    [id, e.fy, e.kind, e.description.trim(), e.amountCents, e.date ?? null, ctx.now()]);
  ctx.changed('tax');
  return id;
}

export function deleteTaxEntry(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM tax_entries WHERE id = ?', [id]);
  ctx.changed('tax');
}

/* ------------------------------ building the estimate ------------------------------ */

export interface TaxSourceLine {
  label: string;
  amountCents: Cents;
  basis: string;
}

function gstPart(r: Record<string, unknown>, registered: boolean): Cents {
  if (!registered || r.gst_class !== 'taxable') return 0;
  return r.gst_cents !== null && r.gst_cents !== undefined ? Math.abs(Number(r.gst_cents)) : gstIncluded(Math.abs(Number(r.amount_cents)));
}

export function buildTaxInput(ctx: Ctx, fy: string): { input: TaxInput; lines: TaxSourceLine[]; warnings: string[] } {
  const s = getSettings(ctx);
  const { start, end } = fyRange(fy);
  const input = emptyTaxInput(fy);
  input.hasStudyLoan = s.hasStudyLoan;
  input.medicareExempt = s.medicareExempt;
  const lines: TaxSourceLine[] = [];
  const warnings: string[] = [];

  const slips = payslipTotals(listPayslips(ctx), fy);
  input.employmentGrossCents = slips.taxableCents - slips.allowancesCents;
  input.allowancesCents = slips.allowancesCents;
  input.paygWithheldCents = slips.paygCents;
  input.reportableSuperCents = slips.salarySacrificeCents;
  lines.push({ label: 'Payslips', amountCents: slips.taxableCents, basis: slips.explanation });
  const salaryDeposits = ctx.db.scalar<number>("SELECT COALESCE(SUM(amount_cents),0) FROM transactions WHERE status='posted' AND income_type IN ('salary','wages') AND date BETWEEN ? AND ?", [start, end]) ?? 0;
  const unlinked = ctx.db.scalar<number>("SELECT COUNT(*) FROM transactions WHERE status='posted' AND income_type IN ('salary','wages') AND payslip_id IS NULL AND date BETWEEN ? AND ?", [start, end]) ?? 0;
  if (salaryDeposits > 0 && slips.count === 0) warnings.push(`Salary deposits of ${formatMoney(salaryDeposits)} were found, but no payslips are entered for ${fyDisplay(fy)}. Deposits are net pay, so employment income and tax withheld are not included until payslips (or an income statement summary) are entered.`);
  else if (unlinked > 0) warnings.push(`${unlinked} salary deposit(s) in ${fyDisplay(fy)} are not linked to a payslip. Check that every pay is entered.`);

  const txRows = ctx.db.all("SELECT * FROM transactions WHERE status = 'posted' AND is_transfer = 0 AND date BETWEEN ? AND ?", [start, end]);
  // Business / contractor income: GST-exclusive when registered; never assumed to be profit.
  let bizIncome = 0, bizCount = 0, bizExp = 0, bizExpCount = 0, interest = 0, interestCount = 0, other = 0, deductions = 0, deductionCount = 0, instal = 0, gov = 0;
  for (const r of txRows) {
    const amt = Number(r.amount_cents);
    const type = str(r.income_type);
    if (amt > 0 && (type === 'contractor' || type === 'sole-trader' || type === 'business')) {
      bizIncome += amt - gstPart(r, s.gstRegistered);
      bizCount++;
    } else if (amt > 0 && (type === 'interest' || type === 'term-deposit-interest')) {
      interest += amt;
      interestCount++;
    } else if (amt > 0 && (type === 'rental' || type === 'trust-distribution' || type === 'managed-fund-distribution' || type === 'other')) {
      other += amt;
    } else if (amt > 0 && type === 'government') {
      gov += amt;
    }
    if (amt < 0 && (r.business_use === 'business' || r.business_use === 'mixed')) {
      const pct = r.business_use === 'business' ? 100 : Number(r.business_percent ?? 0);
      const exGst = Math.abs(amt) - gstPart(r, s.gstRegistered);
      bizExp += roundCents((exGst * pct) / 100);
      bizExpCount++;
    } else if (amt < 0 && r.tax_class === 'deductible') {
      deductions += Math.abs(amt);
      deductionCount++;
    }
    if (amt < 0 && r.category_id === 'taxes.payg-instalments') instal += Math.abs(amt);
  }
  input.businessIncomeCents = bizIncome;
  input.businessExpensesCents = bizExp;
  input.interestCents = interest;
  if (bizCount || bizExpCount) lines.push({ label: 'Business / contractor', amountCents: bizIncome - bizExp, basis: `${bizCount} payment(s) received classified as contractor, sole-trader or business income${s.gstRegistered ? ' (GST removed)' : ''}, less the business share of ${bizExpCount} expense(s).` });
  if (interestCount) lines.push({ label: 'Interest', amountCents: interest, basis: `${interestCount} interest credit(s) classified as interest income.` });
  if (gov) warnings.push(`Government payments of ${formatMoney(gov)} are not included automatically — some are taxable and some are not. Add taxable amounts as "Other income" entries.`);

  const entries = listTaxEntries(ctx, fy);
  const sum = (k: TaxEntryKind) => entries.filter((e) => e.kind === k).reduce((a, e) => a + e.amountCents, 0);
  input.otherIncomeCents = other + sum('other-income');
  input.deductionsCents = deductions + sum('deduction');
  input.paygInstalmentsCents = instal + sum('payg-instalment');
  input.paygWithheldCents += sum('payg-withheld-other');
  input.reportableSuperCents += sum('reportable-super');
  if (deductionCount || sum('deduction')) lines.push({ label: 'Deductions', amountCents: input.deductionsCents, basis: `${deductionCount} transaction(s) marked tax deductible plus ${entries.filter((e) => e.kind === 'deduction').length} deduction(s) you entered.` });
  if (input.paygInstalmentsCents) lines.push({ label: 'PAYG instalments', amountCents: input.paygInstalmentsCents, basis: 'Payments categorised as PAYG instalments plus instalments you entered.' });

  const divs = dividendTotals(listDividends(ctx), fy);
  input.dividendsFrankedCents = divs.frankedCents;
  input.dividendsUnfrankedCents = divs.unfrankedCents;
  input.frankingCreditsCents = divs.frankingCreditsCents;
  const unmatchedDivTx = txRows.filter((r) => Number(r.amount_cents) > 0 && ['dividends'].includes(String(r.income_type)) && !ctx.db.get('SELECT id FROM dividends WHERE transaction_id = ?', [String(r.id)]));
  if (unmatchedDivTx.length && divs.count === 0) {
    const cash = unmatchedDivTx.reduce((a, r) => a + Number(r.amount_cents), 0);
    input.dividendsUnfrankedCents += cash;
    warnings.push(`${unmatchedDivTx.length} dividend deposit(s) (${formatMoney(cash)}) have no dividend statement entered. The cash is included, but franking credits are not — enter the statements on the Investments screen.`);
  }
  if (divs.count) lines.push({ label: 'Dividends', amountCents: divs.cashCents, basis: divs.explanation });

  const { parcels, disposals } = parcelsAndDisposals(listTrades(ctx));
  const cgt = capitalGains(parcels, disposals, fy);
  input.netCapitalGainCents = cgt.events.length ? cgt.netCapitalGainCents : 0;
  if (cgt.events.length) lines.push({ label: 'Capital gains', amountCents: cgt.netCapitalGainCents ?? 0, basis: cgt.explanation });
  return { input, lines, warnings };
}

export function taxEstimate(ctx: Ctx, fy: string) {
  const built = buildTaxInput(ctx, fy);
  const e = estimateTax(built.input);
  const { start, end } = fyRange(fy);
  const today = ctx.today();
  const partYear: string[] = [];
  if (today >= start && today < end) {
    const months = Math.max(1, Math.round((diffDays(start, today) + 1) / 30.44));
    partYear.push(`${fyDisplay(fy)} is still in progress (about ${months} of 12 months). This estimate only covers income recorded so far. Tax withheld from pay is worked out as if the pay continued all year, so a part-year estimate often shows an overpayment that will shrink as the year goes on.`);
  } else if (today < start) {
    partYear.push(`${fyDisplay(fy)} has not started yet, so there are no records for it.`);
  }
  return { ...e, sourceLines: built.lines, warnings: [...partYear, ...built.warnings, ...e.warnings], supportedYears: SUPPORTED_YEARS, currentFy: financialYearOf(today), partYear: partYear.length > 0 };
}

export function taxRulesInfo(fy: string) {
  const r = rulesFor(fy);
  if (!r) return null;
  const rules = r.rules;
  return {
    fy,
    fallbackFrom: r.fallbackFrom,
    components: [
      { name: 'Resident tax rates', status: rules.residentRates.status, note: rules.residentRates.note ?? null, sources: rules.residentRates.sourceIds.map((i) => rules.sources[i]) },
      { name: 'Medicare levy (single low-income thresholds)', status: rules.medicare.status, note: rules.medicare.note ?? null, sources: rules.medicare.sourceIds.map((i) => rules.sources[i]) },
      { name: 'Low income tax offset', status: rules.lito.status, note: rules.lito.note ?? null, sources: rules.lito.sourceIds.map((i) => rules.sources[i]) },
      { name: 'Study and training loan repayments', status: rules.studyLoan.status, note: rules.studyLoan.note ?? null, sources: rules.studyLoan.sourceIds.map((i) => rules.sources[i]) },
      { name: 'Super contribution caps and guarantee', status: rules.superannuation.status, note: rules.superannuation.note ?? null, sources: rules.superannuation.sourceIds.map((i) => rules.sources[i]) },
      { name: 'GST', status: rules.gst.status, note: null, sources: rules.gst.sourceIds.map((i) => rules.sources[i]) },
      { name: 'CGT discount', status: rules.cgt.status, note: null, sources: rules.cgt.sourceIds.map((i) => rules.sources[i]) },
    ],
    brackets: rules.residentRates.value,
    lastReviewed: rules.lastReviewed,
  };
}

/* ------------------------------ GST / BAS ------------------------------ */

export function basPreparation(ctx: Ctx, fy: string, quarter: number) {
  const s = getSettings(ctx);
  const q = basQuarters(fy)[quarter];
  if (!q) throw new UserError('Choose a quarter.');
  const rows = ctx.db.all(`SELECT * FROM transactions WHERE status = 'posted' AND is_transfer = 0 AND date BETWEEN ? AND ?
    AND (business_use IN ('business','mixed') OR income_type IN ('contractor','sole-trader','business'))`, [q.start, q.end]);
  const classified = rows.filter((r) => r.gst_class);
  const txs: GstTx[] = classified.map((r) => ({
    id: String(r.id), date: String(r.date), amountCents: Number(r.amount_cents), gstClass: r.gst_class as GstTx['gstClass'], gstCents: num(r.gst_cents),
    includesGst: true, businessPercent: r.business_use === 'mixed' ? Number(r.business_percent ?? 0) : 100,
  }));
  const summary = basSummary(txs, q, s.gstRegistered, rows.length - classified.length);
  const yearStart = addDays(ctx.today(), -365);
  const sales = ctx.db.scalar<number>("SELECT COALESCE(SUM(amount_cents),0) FROM transactions WHERE status='posted' AND amount_cents > 0 AND income_type IN ('contractor','sole-trader','business') AND date >= ?", [yearStart]) ?? 0;
  const threshold = rulesFor(fy)?.rules.gst.value.registrationThreshold ?? 75000;
  return {
    quarter: q,
    quarters: basQuarters(fy),
    summary,
    unclassified: rows.filter((r) => !r.gst_class).map((r) => ({ id: String(r.id), date: String(r.date), amountCents: Number(r.amount_cents), description: String(r.clean_description) })),
    turnoverNote: gstTurnoverNote(s.gstRegistered ? sales - gstIncluded(sales) : sales, threshold, ctx.today()),
  };
}

/* ------------------------------ investments ------------------------------ */

export function listSecurities(ctx: Ctx): Security[] {
  return ctx.db.all('SELECT * FROM securities ORDER BY code').map((r) => ({ id: String(r.id), code: String(r.code), name: String(r.name), kind: r.kind as SecurityKind }));
}

export function saveSecurity(ctx: Ctx, s: { id?: string; code: string; name: string; kind: SecurityKind }): string {
  const code = s.code.trim().toUpperCase();
  if (!code) throw new UserError('Enter the security code.');
  const existing = ctx.db.get('SELECT id FROM securities WHERE code = ?', [code]);
  const id = s.id ?? (existing ? String(existing.id) : ctx.id());
  ctx.db.run('INSERT INTO securities(id, code, name, kind) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, kind=excluded.kind', [id, code, s.name.trim() || code, s.kind]);
  ctx.changed('investments');
  return id;
}

export function listTrades(ctx: Ctx): Trade[] {
  return ctx.db.all('SELECT * FROM trades ORDER BY date').map((r) => ({
    id: String(r.id), securityId: String(r.security_id), accountId: str(r.account_id), date: String(r.date), type: r.type as Trade['type'], quantity: Number(r.quantity),
    unitPriceCents: Number(r.unit_price_cents), brokerageCents: Number(r.brokerage_cents), costUnknown: bool(r.cost_unknown), notes: str(r.notes),
  }));
}

export function saveTrade(ctx: Ctx, t: Trade): string {
  if (!isValidDate(t.date)) throw new UserError('Enter the trade date.');
  if (t.quantity <= 0) throw new UserError('Enter the number of units.');
  if (!t.costUnknown && t.unitPriceCents < 0) throw new UserError('Enter the unit price.');
  const id = t.id || ctx.id();
  ctx.db.run(`INSERT INTO trades(id, security_id, account_id, date, type, quantity, unit_price_cents, brokerage_cents, cost_unknown, notes, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET security_id=excluded.security_id, account_id=excluded.account_id, date=excluded.date, type=excluded.type, quantity=excluded.quantity,
      unit_price_cents=excluded.unit_price_cents, brokerage_cents=excluded.brokerage_cents, cost_unknown=excluded.cost_unknown, notes=excluded.notes`,
    [id, t.securityId, t.accountId ?? null, t.date, t.type, t.quantity, t.unitPriceCents, t.brokerageCents, t.costUnknown ? 1 : 0, t.notes ?? null, ctx.now()]);
  ctx.changed('investments');
  return id;
}

export function deleteTrade(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM trades WHERE id = ?', [id]);
  ctx.changed('investments');
}

export function listDividends(ctx: Ctx): Dividend[] {
  return ctx.db.all('SELECT * FROM dividends ORDER BY payment_date').map((r) => ({
    id: String(r.id), securityId: String(r.security_id), paymentDate: String(r.payment_date), cashCents: Number(r.cash_cents), frankedCents: Number(r.franked_cents),
    unfrankedCents: Number(r.unfranked_cents), frankingCreditsCents: Number(r.franking_credits_cents), withholdingCents: Number(r.withholding_cents),
    reinvested: bool(r.reinvested), fromStatement: bool(r.from_statement), transactionId: str(r.transaction_id),
  }));
}

export function saveDividend(ctx: Ctx, d: Dividend): string {
  if (!isValidDate(d.paymentDate)) throw new UserError('Enter the payment date.');
  if (d.cashCents < 0) throw new UserError('Enter the cash amount.');
  if (d.fromStatement && d.frankedCents + d.unfrankedCents !== d.cashCents + (d.withholdingCents ?? 0)) {
    throw new UserError('Franked plus unfranked amounts should equal the dividend before any withholding — check the statement.');
  }
  const id = d.id || ctx.id();
  ctx.db.run(`INSERT INTO dividends(id, security_id, payment_date, cash_cents, franked_cents, unfranked_cents, franking_credits_cents, withholding_cents, reinvested, from_statement, transaction_id, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET security_id=excluded.security_id, payment_date=excluded.payment_date, cash_cents=excluded.cash_cents, franked_cents=excluded.franked_cents,
      unfranked_cents=excluded.unfranked_cents, franking_credits_cents=excluded.franking_credits_cents, withholding_cents=excluded.withholding_cents,
      reinvested=excluded.reinvested, from_statement=excluded.from_statement, transaction_id=excluded.transaction_id`,
    [id, d.securityId, d.paymentDate, d.cashCents, d.frankedCents, d.unfrankedCents, d.frankingCreditsCents, d.withholdingCents ?? 0, d.reinvested ? 1 : 0, d.fromStatement ? 1 : 0, d.transactionId ?? null, ctx.now()]);
  ctx.changed('investments');
  return id;
}

export function deleteDividend(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM dividends WHERE id = ?', [id]);
  ctx.changed('investments');
}

export function listValuations(ctx: Ctx): Valuation[] {
  return ctx.db.all('SELECT * FROM valuations ORDER BY date').map((r) => ({ securityId: String(r.security_id), date: String(r.date), unitPriceCents: Number(r.unit_price_cents) }));
}

export function saveValuation(ctx: Ctx, v: Valuation): void {
  if (!isValidDate(v.date) || v.unitPriceCents < 0) throw new UserError('Enter a date and unit price.');
  ctx.db.run('INSERT INTO valuations(id, security_id, date, unit_price_cents) VALUES(?,?,?,?)', [ctx.id(), v.securityId, v.date, v.unitPriceCents]);
  ctx.changed('investments');
}

export function investmentsOverview(ctx: Ctx, fy?: string) {
  const year = fy ?? financialYearOf(ctx.today());
  const securities = listSecurities(ctx);
  const trades = listTrades(ctx);
  const { parcels, disposals } = parcelsAndDisposals(trades);
  return {
    fy: year,
    securities,
    trades,
    dividends: listDividends(ctx),
    holdings: holdings(securities, trades, listValuations(ctx), ctx.today()),
    dividendTotals: dividendTotals(listDividends(ctx), year),
    capitalGains: capitalGains(parcels, disposals, year),
    note: 'Values are prices you entered, with their dates. Paperbark does not fetch prices, rate investments or suggest trades.',
  };
}

/** Broker CSV: find date, code, buy/sell, quantity, price and brokerage columns. */
export function previewTradesCsv(ctx: Ctx, text: string) {
  const rows = readDelimited(text);
  if (rows.length < 2) throw new UserError('No rows were found.');
  const header = rows[0].map((h) => h.toLowerCase());
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const col = {
    date: find(/date/), code: find(/^(code|symbol|security|ticker|asx code|stock)/), type: find(/^(type|action|buy\/sell|b\/s|side|transaction)/),
    qty: find(/(quantity|units|qty|volume)/), price: find(/(price|unit price|avg)/), brokerage: find(/(brokerage|commission|fees?)/),
  };
  const missing = Object.entries(col).filter(([k, v]) => v < 0 && k !== 'brokerage').map(([k]) => k);
  if (missing.length) throw new UserError(`Could not find these columns: ${missing.join(', ')}. Expected headings like Date, Code, Type, Quantity, Price, Brokerage.`);
  const fmt = detectDateFormat(rows.slice(1).map((r) => r[col.date]))?.format ?? 'DMY';
  const out = rows.slice(1).filter((r) => r.some(Boolean)).map((r, i) => {
    const typeText = (r[col.type] ?? '').toLowerCase();
    const type: 'buy' | 'sell' | null = /buy|b\b|purchase/.test(typeText) ? 'buy' : /sell|s\b|sale/.test(typeText) ? 'sell' : null;
    const price = parseMoney(r[col.price] ?? '');
    const brokerage = col.brokerage >= 0 ? parseMoney(r[col.brokerage] ?? '') : null;
    const qty = Number(String(r[col.qty] ?? '').replace(/,/g, ''));
    const date = parseDateAs(r[col.date] ?? '', fmt);
    const problems = [!date && 'date', !type && 'buy/sell', !(qty > 0) && 'quantity', !price && 'price'].filter(Boolean) as string[];
    return { row: i + 2, date, code: (r[col.code] ?? '').trim().toUpperCase(), type, quantity: Math.abs(qty), unitPriceCents: price ? Math.abs(price.cents) : 0, brokerageCents: brokerage ? Math.abs(brokerage.cents) : 0, problems };
  });
  return { rows: out, note: 'Check each row before importing. Rows with problems are skipped.' };
}

export function commitTrades(ctx: Ctx, rows: { date: ISODate; code: string; type: 'buy' | 'sell'; quantity: number; unitPriceCents: number; brokerageCents: number }[], accountId: string | null) {
  let added = 0;
  ctx.db.tx(() => {
    for (const r of rows) {
      const secId = saveSecurity(ctx, { code: r.code, name: r.code, kind: 'share' });
      const dup = ctx.db.get('SELECT id FROM trades WHERE security_id = ? AND date = ? AND type = ? AND quantity = ? AND unit_price_cents = ?', [secId, r.date, r.type, r.quantity, r.unitPriceCents]);
      if (dup) continue;
      saveTrade(ctx, { id: '', securityId: secId, accountId, date: r.date, type: r.type, quantity: r.quantity, unitPriceCents: r.unitPriceCents, brokerageCents: r.brokerageCents });
      added++;
    }
  });
  return { added, skipped: rows.length - added };
}

/* ------------------------------ super ------------------------------ */

export function listSuperEntries(ctx: Ctx, accountId?: string): SuperEntry[] {
  const rows = accountId ? ctx.db.all('SELECT * FROM super_entries WHERE account_id = ? ORDER BY date', [accountId]) : ctx.db.all('SELECT * FROM super_entries ORDER BY date');
  return rows.map((r) => ({ id: String(r.id), accountId: String(r.account_id), date: String(r.date), kind: r.kind as SuperEntryKind, amountCents: Number(r.amount_cents) }));
}

export function saveSuperEntry(ctx: Ctx, e: SuperEntry): string {
  if (!isValidDate(e.date)) throw new UserError('Enter a date.');
  const acc = listAccounts(ctx).find((a) => a.id === e.accountId);
  if (!acc || acc.type !== 'superannuation') throw new UserError('Choose a superannuation account.');
  const id = e.id || ctx.id();
  ctx.db.run(`INSERT INTO super_entries(id, account_id, date, kind, amount_cents, created_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET date=excluded.date, kind=excluded.kind, amount_cents=excluded.amount_cents`, [id, e.accountId, e.date, e.kind, e.amountCents, ctx.now()]);
  if (e.kind === 'balance') {
    ctx.db.run('INSERT INTO balance_snapshots(id, account_id, date, balance_cents, source, note, created_at) VALUES(?,?,?,?,?,?,?)', [ctx.id(), e.accountId, e.date, e.amountCents, 'imported', 'Super statement balance', ctx.now()]);
  }
  ctx.changed('super');
  return id;
}

export function deleteSuperEntry(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM super_entries WHERE id = ?', [id]);
  ctx.changed('super');
}

export function superOverview(ctx: Ctx, fy?: string) {
  const year = fy ?? financialYearOf(ctx.today());
  const entries = listSuperEntries(ctx);
  return {
    fy: year,
    accounts: listAccounts(ctx).filter((a) => a.type === 'superannuation'),
    entries,
    summary: superYearSummary(entries, year),
    history: superBalanceHistory(entries),
  };
}

export function superProjection(input: SuperProjectionInput) {
  return projectSuper(input);
}
