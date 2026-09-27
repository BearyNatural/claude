import { Ctx, saveAccount, addBalance, saveCategory, updateSettings } from '../services/core';
import { createRule, makeCategoriser, setTags, linkTransfer } from '../services/transactions';
import { confirmRecurring, recurringList } from '../services/insights';
import { saveBill, saveBudget, proposeLines, saveSinkingFund } from '../services/budgeting';
import { saveGoal, saveLoan, saveTermDeposit, saveScenario, buildAssumptions, saveSnapshot } from '../services/planning';
import { savePayslip, saveTaxEntry, saveSecurity, saveTrade, saveDividend, saveValuation, saveSuperEntry } from '../services/taxes';
import { ISODate, addDays, addMonths, endOfMonth, makeDate, parts, startOfMonth, weekday, diffDays } from '../../domain/dates';
import { cleanDescription, guessPayee } from '../../domain/categorise/clean';

/**
 * Fictional demonstration data for an Australian household. Every name, account number and
 * amount is made up. It is written to a separate demo database, never the user's own.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GenTx {
  account: string;
  date: ISODate;
  amount: number;
  desc: string;
  category?: string;
  incomeType?: string;
  oneOff?: boolean;
  business?: 'business' | 'mixed';
  businessPct?: number;
  taxClass?: string;
  tags?: string[];
  transferKey?: string;
  stage?: string[];
}

export function seedDemo(ctx: Ctx): void {
  const rand = mulberry32(20260927);
  const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const start = '2024-07-01';
  const lastImport = addDays(ctx.today(), -8);
  const cardStops = endOfMonth(addMonths(lastImport, -2)); // card statements stop two months earlier (shows a missing-data warning)

  ctx.db.tx(() => {
    updateSettings(ctx, {
      onboardingComplete: true, analysisPeriods: ['week', 'month', 'quarter'], incomeKinds: ['salary', 'contracting', 'investment'],
      fortnightAnchor: '2024-07-04', hasStudyLoan: false,
    });
    const everyday = saveAccount(ctx, { name: 'Everyday', type: 'transaction', institution: 'Example Bank', number: '063-000 1111 4821' });
    const offset = saveAccount(ctx, { name: 'Home loan offset', type: 'offset', institution: 'Example Bank', number: '1111 4822' });
    const saver = saveAccount(ctx, { name: 'Bonus Saver', type: 'high-interest-savings', institution: 'Example Bank', number: '2222 7710', interestRate: 4.5 });
    const card = saveAccount(ctx, { name: 'Rewards credit card', type: 'credit-card', institution: 'Example Card Co', number: '4000 0000 0000 9003', creditLimitCents: 1000000 });
    const mortgageAcc = saveAccount(ctx, { name: 'Home loan', type: 'mortgage', institution: 'Example Bank', number: '5555 1234' });
    const carLoanAcc = saveAccount(ctx, { name: 'Car loan', type: 'car-loan', institution: 'AutoFin (example)' });
    const broker = saveAccount(ctx, { name: 'Share trading', type: 'brokerage', institution: 'Example Broker' });
    const superAcc = saveAccount(ctx, { name: 'Alex — super', type: 'superannuation', institution: 'Example Super Fund' });
    const home = saveAccount(ctx, { name: 'Home (estimated value)', type: 'property' });
    const car = saveAccount(ctx, { name: 'Car (estimated value)', type: 'vehicle' });
    for (const [date, h, c] of [['2024-07-01', 79000000, 2600000], ['2025-07-01', 82500000, 2380000], ['2026-07-01', 86000000, 2150000]] as const) {
      addBalance(ctx, home, date, h, 'estimated', 'Your own estimate');
      addBalance(ctx, car, date, c, 'estimated', 'Your own estimate');
    }

    // A user-created category and rules, to show both are editable.
    const carLoanCat = saveCategory(ctx, { name: 'Car loan repayments', parentId: 'transport', kind: 'expense', nature: 'fixed' });
    createRule(ctx, { field: 'description', matchType: 'contains', pattern: 'AUTOFIN', categoryId: carLoanCat, source: 'user', priority: 0, enabled: true, direction: 'out' });
    createRule(ctx, { field: 'description', matchType: 'contains', pattern: 'NORTHWIND CONSULTING', categoryId: 'income.contractor', incomeType: 'contractor', source: 'user', priority: 0, enabled: true, direction: 'in' });
    createRule(ctx, { field: 'description', matchType: 'contains', pattern: 'NORTHSIDE HEALTH', categoryId: 'income.salary', incomeType: 'salary', source: 'user', priority: 0, enabled: true, direction: 'in' });

    const txs: GenTx[] = [];
    const add = (t: GenTx) => txs.push(t);
    const paydays: ISODate[] = [];

    for (let d = start; d <= lastImport; d = addDays(d, 1)) {
      const { y, m, d: day } = parts(d);
      const wd = weekday(d);
      const fyIdx = d >= '2026-07-01' ? 2 : d >= '2025-07-01' ? 1 : 0;
      // Fortnightly pay on Thursdays.
      if (diffDays('2024-07-04', d) % 14 === 0) {
        const net = [364218, 375145, 386399][fyIdx];
        add({ account: everyday, date: d, amount: net, desc: 'PAYROLL NORTHSIDE HEALTH PTY LTD' });
        paydays.push(d);
      }
      // Occasional contracting income (no tax withheld).
      if (day === 20 && m % 2 === 0) add({ account: everyday, date: d, amount: between(180000, 260000), desc: 'NORTHWIND CONSULTING INV ' + (1000 + y % 100 * 10 + m) });
      // Groceries at the weekend.
      if (wd === 6) add({ account: everyday, date: d, amount: -between(14500, 26500), desc: `${pick(['WOOLWORTHS', 'COLES', 'ALDI STORES'])} ${between(1000, 9999)} NORTH LAKES` });
      if (wd === 3 && rand() < 0.5 && d <= cardStops) add({ account: card, date: d, amount: -between(2200, 6800), desc: 'CORNER BUTCHER MANGO HILL' });
      if (wd === 2 && d <= cardStops) add({ account: card, date: d, amount: -between(450, 1450), desc: `SQ *${pick(['BEAN THERE CAFE', 'LOCAL CAFE', 'THE DAILY GRIND'])} BRISBANE` });
      if (wd === 5 && rand() < 0.7) add({ account: everyday, date: d, amount: -between(2400, 6200), desc: pick(['UBER *EATS HELP.UBER.COM', 'DOMINOS PIZZA 1234', 'MENULOG PTY LTD']) });
      if (diffDays('2024-07-02', d) % 14 === 0) add({ account: everyday, date: d, amount: -between(6800, 9600), desc: `${pick(['BP', 'AMPOL', '7-ELEVEN'])} ${between(100, 999)} NORTH LAKES` });
      if (diffDays('2024-07-05', d) % 14 === 0) add({ account: everyday, date: d, amount: -3290, desc: 'ANYTIME FITNESS NORTH LAKES' });
      if (diffDays('2024-07-08', d) % 14 === 0 && m !== 1) add({ account: everyday, date: d, amount: -12400, desc: 'OSHC NORTH LAKES STATE SCHOOL' });
      if (day === 3) add({ account: everyday, date: d, amount: -8900, desc: 'AUSSIE BROADBAND', business: 'mixed', businessPct: 40 });
      if (day === 7) add({ account: everyday, date: d, amount: -6500, desc: 'TELSTRA MOBILE' });
      if (day === 9) add({ account: everyday, date: d, amount: -28650, desc: 'BUPA HEALTH INSURANCE' });
      if (day === 11) add({ account: everyday, date: d, amount: -2299, desc: 'NETFLIX.COM' });
      if (day === 16) add({ account: everyday, date: d, amount: -1399, desc: 'SPOTIFY P0' + between(10000, 99999) });
      if (day === 12) add({ account: everyday, date: d, amount: -2500, desc: 'RED CROSS DONATION' });
      if (day === 14) add({ account: everyday, date: d, amount: -between(5500, 9800), desc: 'PETBARN NORTH LAKES' });
      if (day === 18) add({ account: everyday, date: d, amount: -290000, desc: 'HOME LOAN REPAYMENT 5555 1234', category: 'housing.mortgage' });
      if (day === 22) add({ account: everyday, date: d, amount: -48000, desc: 'AUTOFIN CAR LOAN DD' });
      if (day === 1) add({ account: saver, date: d, amount: between(4200, 6100), desc: 'CREDIT INTEREST', incomeType: 'interest' });
      if (wd === 1) {
        add({ account: everyday, date: d, amount: -15000, desc: 'TRANSFER TO BONUS SAVER', transferKey: `sv-${d}` });
        add({ account: saver, date: d, amount: 15000, desc: 'TRANSFER FROM EVERYDAY', transferKey: `sv-${d}` });
      }
      // Quarterly and annual bills.
      if (day === 15 && [1, 4, 7, 10].includes(m)) add({ account: everyday, date: d, amount: -between(38000, 52000), desc: 'AGL SALES PTY LTD BPAY' });
      if (day === 25 && [2, 5, 8, 11].includes(m)) add({ account: everyday, date: d, amount: -between(26000, 33000), desc: 'URBAN UTILITIES BPAY' });
      if (day === 28 && [2, 5, 8, 11].includes(m)) add({ account: everyday, date: d, amount: -52000, desc: 'MORETON BAY REGIONAL COUNCIL RATES' });
      if (m === 3 && day === 10) add({ account: everyday, date: d, amount: -96000, desc: 'TRANSPORT AND MAIN ROADS QLD REGO' });
      if (m === 8 && day === 5) add({ account: everyday, date: d, amount: -114000, desc: 'RACQ INSURANCE CAR POLICY', category: 'transport.insurance' });
      if (m === 11 && day === 20) add({ account: everyday, date: d, amount: -218000, desc: 'SUNCORP INSURANCE HOME POLICY', category: 'housing.insurance' });
      if (m === 5 && day === 2) add({ account: everyday, date: d, amount: -13999, desc: 'DISNEY PLUS ANNUAL' });
      if (m === 12 && day >= 8 && day <= 20 && wd === 6) add({ account: everyday, date: d, amount: -between(9000, 26000), desc: pick(['KMART NORTH LAKES', 'BIG W NORTH LAKES', 'MYER CHERMSIDE']), category: 'shopping.gifts', tags: ['christmas'] });
      if (rand() < 0.06) add({ account: everyday, date: d, amount: -between(1800, 14000), desc: pick(['BUNNINGS 1234 NORTH LAKES', 'KMART NORTH LAKES', 'CHEMIST WAREHOUSE NORTH LAKES', 'JB HI-FI NORTH LAKES', 'OFFICEWORKS NORTH LAKES']) });
      if (day === 26 && m % 3 === 0) add({ account: everyday, date: d, amount: -between(3000, 9000), desc: 'OFFICEWORKS NORTH LAKES', business: 'business', category: 'business.supplies' });
      if ([10, 1, 4, 7].includes(m) && day === 21 && d >= '2025-07-01') add({ account: everyday, date: d, amount: -60000, desc: 'ATO PAYG INSTALMENT BPAY', category: 'taxes.payg-instalments' });
      if (m === 3 && day === 23) add({ account: everyday, date: d, amount: between(7000, 9000), desc: 'VANGUARD VAS DISTRIBUTION', incomeType: 'managed-fund-distribution' });
      if (m === 9 && day === 24) add({ account: everyday, date: d, amount: 43540, desc: 'BHP GROUP DIVIDEND', incomeType: 'dividends' });
      if (m === 3 && day === 27) add({ account: everyday, date: d, amount: 38110, desc: 'BHP GROUP DIVIDEND', incomeType: 'dividends' });
    }
    // One-offs and events.
    add({ account: everyday, date: '2025-11-14', amount: -249900, desc: 'HARVEY NORMAN NORTH LAKES', oneOff: true, category: 'shopping.electronics' });
    add({ account: card, date: '2026-01-06', amount: -128000, desc: 'QANTAS AIRWAYS', category: 'travel.flights', tags: ['holiday'] });
    add({ account: card, date: '2026-01-09', amount: -96000, desc: 'AIRBNB * HMAB12345', category: 'travel.accommodation', tags: ['holiday'] });
    add({ account: everyday, date: '2025-08-19', amount: 124500, desc: 'ATO 012345678 TAX REFUND' });
    add({ account: everyday, date: '2026-04-12', amount: -48000, desc: 'NORTH LAKES VET HOSPITAL', category: 'pets.vet' });
    add({ account: everyday, date: '2026-06-02', amount: -45000, desc: 'UDEMY COURSE WORK SKILLS', taxClass: 'deductible', category: 'education.courses' });
    add({ account: everyday, date: '2026-08-08', amount: -350000, desc: 'NORTH LAKES PLUMBING HOT WATER', oneOff: true, category: 'housing.maintenance', tags: ['property'] });

    // Card payments and sweeps to/from the offset, month by month, keeping balances realistic.
    const bal = new Map<string, number>([[everyday, 420000], [offset, 6200000], [saver, 1250000], [card, -86000]]);
    for (const [acc, b] of bal) addBalance(ctx, acc, addDays(start, -1), b, 'imported', 'Opening balance (demo)');
    txs.sort((a, b) => a.date.localeCompare(b.date));
    const byDate = new Map<ISODate, GenTx[]>();
    for (const t of txs) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
    const extra: GenTx[] = [];
    for (let d = start; d <= lastImport; d = addDays(d, 1)) {
      for (const t of byDate.get(d) ?? []) bal.set(t.account, (bal.get(t.account) ?? 0) + t.amount);
      if (parts(d).d === 25 && d <= cardStops) {
        const owed = -(bal.get(card) ?? 0);
        if (owed > 0) {
          const k = `cc-${d}`;
          extra.push({ account: everyday, date: d, amount: -owed, desc: 'PAYMENT TO CARD 9003', transferKey: k, category: 'transfers.card-payment' });
          extra.push({ account: card, date: d, amount: owed, desc: 'PAYMENT THANK YOU', transferKey: k });
          bal.set(everyday, bal.get(everyday)! - owed);
          bal.set(card, 0);
        }
      }
      if (parts(d).d === 28) {
        const e = bal.get(everyday)!;
        const k = `off-${d}`;
        if (e > 350000) {
          const amt = Math.floor((e - 250000) / 10000) * 10000;
          extra.push({ account: everyday, date: d, amount: -amt, desc: 'TRANSFER TO OFFSET 4822', transferKey: k });
          extra.push({ account: offset, date: d, amount: amt, desc: 'TRANSFER FROM EVERYDAY', transferKey: k });
          bal.set(everyday, e - amt);
          bal.set(offset, bal.get(offset)! + amt);
        } else if (e < 80000) {
          const amt = 250000 - Math.floor(e / 10000) * 10000;
          extra.push({ account: offset, date: d, amount: -amt, desc: 'TRANSFER TO EVERYDAY', transferKey: k });
          extra.push({ account: everyday, date: d, amount: amt, desc: 'TRANSFER FROM OFFSET', transferKey: k });
          bal.set(everyday, e + amt);
          bal.set(offset, bal.get(offset)! - amt);
        }
      }
    }
    const all = [...txs, ...extra].sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);

    // Statement imports: one per account per month, with closing balances that reconcile.
    const categoriser = makeCategoriser(ctx);
    const running = new Map<string, number>([[everyday, 420000], [offset, 6200000], [saver, 1250000], [card, -86000]]);
    const importFor = new Map<string, string>();
    const importId = (acc: string, date: ISODate) => {
      const key = `${acc}|${date.slice(0, 7)}`;
      if (!importFor.has(key)) {
        const id = ctx.id();
        const periodStart = startOfMonth(date);
        const periodEnd = endOfMonth(date) > lastImport ? lastImport : endOfMonth(date);
        ctx.db.run(`INSERT INTO imports(id, account_id, file_name, file_sha256, format, imported_at, period_start, period_end, row_count, added_count)
          VALUES(?,?,?,?,?,?,?,?,0,0)`, [id, acc, `statement-${date.slice(0, 7)}.csv`, `demo-${key}`, 'csv', `${periodEnd}T09:00:00.000Z`, periodStart, periodEnd]);
        importFor.set(key, id);
      }
      return importFor.get(key)!;
    };
    // Every statement account gets a statement for every month, even a month with no transactions.
    for (const acc of [everyday, offset, saver, card]) {
      for (let m = startOfMonth(start); m <= lastImport; m = addMonths(m, 1)) {
        if (acc === card && m > cardStops) break;
        importId(acc, m);
      }
    }
    const transferIds = new Map<string, string[]>();
    const stagedRecent = new Set<number>();
    // Review-inbox examples: small everyday purchases (not bills or repayments, which would distort the month).
    const recent = all.map((t, i) => ({ t, i })).filter(({ t }) => t.date > addDays(lastImport, -5) && t.account === everyday && !t.transferKey && !t.category && t.amount < 0 && t.amount > -20000);
    recent.slice(0, 2).forEach(({ i }) => stagedRecent.add(i));
    const txIdByIndex: string[] = [];
    const stagedReasons = ['Possible duplicate of a transaction already imported (Same amount, dates 1 day apart, similar description)', 'Could belong to several categories'];
    let stagedCount = 0;
    all.forEach((t, i) => {
      const acc = t.account;
      running.set(acc, (running.get(acc) ?? 0) + t.amount);
      const id = ctx.id();
      txIdByIndex[i] = id;
      const s = categoriser.suggest({ description: t.desc, amountCents: t.amount, accountId: acc });
      const category = t.category ?? s.categoryId;
      const staged = stagedRecent.has(i);
      const imp = importId(acc, t.date);
      ctx.db.run(`INSERT INTO transactions(id, account_id, date, amount_cents, original_description, clean_description, payee, category_id, category_source, rule_id,
          category_explanation, income_type, is_one_off, business_use, business_percent, tax_class, import_id, balance_cents, original_data, status, review_reasons, confidence, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, acc, t.date, t.amount, t.desc, cleanDescription(t.desc), guessPayee(t.desc), category, t.category ? 'user' : s.categoryId ? s.source : null, t.category ? null : s.ruleId,
          t.category ? 'Categorised by you' : s.explanation, t.incomeType ?? s.incomeType, t.oneOff ? 1 : 0, t.business ?? null, t.businessPct ?? null, t.taxClass ?? null,
          imp, running.get(acc)!, JSON.stringify({ source: 'demo data' }), staged ? 'staged' : 'posted',
          JSON.stringify(staged ? [stagedReasons[stagedCount++ % stagedReasons.length]] : []), staged ? 'medium' : 'high', ctx.now(), ctx.now()]);
      if (t.tags) setTags(ctx, id, t.tags);
      if (t.transferKey) transferIds.set(t.transferKey, [...(transferIds.get(t.transferKey) ?? []), id]);
      ctx.db.run('UPDATE imports SET row_count = row_count + 1, added_count = added_count + 1, closing_balance_cents = ? WHERE id = ?', [running.get(acc)!, imp]);
    });
    // Statement closing balances and reconciliation.
    const openingBalances = new Map<string, number>([[everyday, 420000], [offset, 6200000], [saver, 1250000], [card, -86000]]);
    for (const [key, imp] of importFor) {
      const acc = key.split('|')[0];
      const row = ctx.db.get('SELECT period_end FROM imports WHERE id = ?', [imp])!;
      const movement = ctx.db.scalar<number>('SELECT COALESCE(SUM(amount_cents),0) FROM transactions WHERE import_id = ?', [imp]) ?? 0;
      const closing = openingBalances.get(acc)! + (ctx.db.scalar<number>('SELECT COALESCE(SUM(amount_cents),0) FROM transactions WHERE account_id = ? AND date <= ?', [acc, String(row.period_end)]) ?? 0);
      ctx.db.run('UPDATE imports SET opening_balance_cents = ?, reconciliation = ? WHERE id = ?', [closing - movement, JSON.stringify({ status: 'reconciled', openingCents: closing - movement, movementCents: movement, expectedClosingCents: closing, closingCents: closing, differenceCents: 0, message: 'Statement reconciled successfully.', hints: [], suspectIndexes: [] }), imp]);
      addBalance(ctx, acc, String(row.period_end), closing, 'imported', 'Statement closing balance (reconciled)', imp);
    }
    for (const ids of transferIds.values()) if (ids.length === 2) {
      const [a, b] = ids;
      const amtA = Number(ctx.db.scalar('SELECT amount_cents FROM transactions WHERE id = ?', [a]));
      linkTransfer(ctx, amtA < 0 ? a : b, amtA < 0 ? b : a);
    }
    // Two manual corrections so a rule suggestion appears.
    for (const t of ctx.db.all("SELECT id FROM transactions WHERE original_description LIKE 'CORNER BUTCHER%' ORDER BY date DESC LIMIT 2")) {
      ctx.db.run("UPDATE transactions SET category_id = 'food.groceries', category_source = 'user', category_explanation = 'Categorised by you' WHERE id = ?", [String(t.id)]);
      ctx.db.run("INSERT INTO change_history(id, entity, entity_id, field, old_value, new_value, reason, created_at) VALUES(?, 'transaction', ?, 'categoryId', 'Uncategorised', 'Groceries', 'Changed by you', ?)", [ctx.id(), String(t.id), ctx.now()]);
    }

    // Loans, mortgage and other balances.
    saveLoan(ctx, { accountId: mortgageAcc, name: 'Home loan', kind: 'mortgage', balanceCents: 45230000, ratePercent: 5.89, repaymentCents: 290000, frequency: 'monthly', remainingTermMonths: 312, offsetAccountId: offset, extraRepaymentCents: 0, asOf: '2026-09-18', rateChanges: [], notes: 'Variable rate (demo)' });
    for (const [date, m, c] of [['2024-06-30', 46810000, 2390000], ['2024-12-31', 46450000, 2110000], ['2025-06-30', 46080000, 1920000], ['2025-12-31', 45700000, 1730000], ['2026-06-30', 45320000, 1540000]] as const) {
      addBalance(ctx, mortgageAcc, date, -m, 'imported', 'Loan statement (demo)');
      addBalance(ctx, carLoanAcc, date, -c, 'imported', 'Loan statement (demo)');
    }
    addBalance(ctx, mortgageAcc, '2026-08-31', -45230000, 'imported', 'Loan statement (demo)');
    saveLoan(ctx, { accountId: carLoanAcc, name: 'Car loan', kind: 'car-loan', balanceCents: 1480000, ratePercent: 8.9, repaymentCents: 48000, frequency: 'monthly', remainingTermMonths: 34, offsetAccountId: null, extraRepaymentCents: 0, asOf: '2026-09-22', rateChanges: [], notes: null });
    addBalance(ctx, carLoanAcc, '2026-08-31', -1480000, 'imported', 'Loan statement (demo)');

    // Payslips linked to the pay deposits (FY2025-26 onwards).
    for (const d of paydays.filter((p) => p >= '2025-07-01')) {
      const fy2 = d >= '2026-07-01';
      const gross = fy2 ? 500962 : 486372;
      const net = fy2 ? 386399 : 375145;
      savePayslip(ctx, { id: '', employer: 'Northside Health Pty Ltd', payDate: d, periodStart: addDays(d, -13), periodEnd: d, grossCents: gross, allowancesCents: 0, salarySacrificeCents: 0, taxableCents: null, paygCents: gross - net, employerSuperCents: Math.round(gross * 0.12), deductionsCents: 0, netCents: net });
    }
    saveTaxEntry(ctx, { fy: '2025-26', kind: 'deduction', description: 'Work-related car expenses (logbook method, demo)', amountCents: 84000, date: '2026-06-30' });

    // Recurring items: confirm some, leave others as suggestions.
    for (const r of recurringList(ctx).suggested) {
      if (/PAYROLL|NETFLIX|SPOTIFY|AUSSIE|BUPA|TELSTRA|ANYTIME/i.test(r.name)) {
        confirmRecurring(ctx, { key: r.key, name: r.name, direction: r.direction, frequency: r.frequency, amountCents: r.amountCents, amountVaries: r.amountVaries, nextExpected: r.nextExpected, lastSeen: r.lastSeen, categoryId: r.categoryId, accountId: r.accountId, isSubscription: /NETFLIX|SPOTIFY/i.test(r.name) });
      }
    }

    // Bills.
    const nextQ = (months: number[], day: number) => {
      for (let k = 0; k < 14; k++) {
        const c = addMonths(startOfMonth(ctx.today()), k);
        if (months.includes(parts(c).m)) {
          const d = makeDate(parts(c).y, parts(c).m, day);
          if (d >= ctx.today()) return d;
        }
      }
      return ctx.today();
    };
    saveBill(ctx, { name: 'Electricity (AGL)', amountCents: 45000, frequency: 'quarterly', nextDue: nextQ([1, 4, 7, 10], 15), categoryId: 'utilities.electricity', accountId: everyday, autoPay: false, reminderDays: 5, reminderEnabled: true, active: true, matchText: 'AGL', notes: null });
    saveBill(ctx, { name: 'Water (Urban Utilities)', amountCents: 30000, frequency: 'quarterly', nextDue: nextQ([2, 5, 8, 11], 25), categoryId: 'utilities.water', accountId: everyday, autoPay: false, reminderDays: 5, reminderEnabled: true, active: true, matchText: 'URBAN UTILITIES', notes: null });
    saveBill(ctx, { name: 'Council rates', amountCents: 52000, frequency: 'quarterly', nextDue: nextQ([2, 5, 8, 11], 28), categoryId: 'housing.rates', accountId: everyday, autoPay: false, reminderDays: 7, reminderEnabled: true, active: true, matchText: 'MORETON BAY', notes: null });
    saveBill(ctx, { name: 'Car registration', amountCents: 96000, frequency: 'annually', nextDue: nextQ([3], 10), categoryId: 'transport.registration', accountId: everyday, autoPay: false, reminderDays: 14, reminderEnabled: true, active: true, matchText: 'MAIN ROADS', notes: null });
    saveBill(ctx, { name: 'Car insurance (RACQ)', amountCents: 114000, frequency: 'annually', nextDue: nextQ([8], 5), categoryId: 'transport.insurance', accountId: everyday, autoPay: true, reminderDays: 21, reminderEnabled: true, active: true, matchText: 'RACQ', notes: null });
    saveBill(ctx, { name: 'Home insurance (Suncorp)', amountCents: 218000, frequency: 'annually', nextDue: nextQ([11], 20), categoryId: 'housing.insurance', accountId: everyday, autoPay: false, reminderDays: 21, reminderEnabled: true, active: true, matchText: 'SUNCORP', notes: null });
    saveBill(ctx, { name: 'Health insurance (Bupa)', amountCents: 28650, frequency: 'monthly', nextDue: nextQ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 9), categoryId: 'health.insurance', accountId: everyday, autoPay: true, reminderDays: 2, reminderEnabled: false, active: true, matchText: 'BUPA', notes: null });

    // Hybrid budget from the last six months.
    const basis = { start: addMonths(startOfMonth(ctx.today()), -6), end: addDays(startOfMonth(ctx.today()), -1) };
    const proposal = proposeLines(ctx, 'monthly', basis, 'leaf');
    saveBudget(ctx, {
      name: 'Monthly household budget', method: 'hybrid', frequency: 'monthly', basisStart: basis.start, basisEnd: basis.end,
      lines: proposal.lines.filter((l) => !l.categoryId.startsWith('transfers')).map((l) => ({ categoryId: l.categoryId, amountCents: l.categoryId === 'food.groceries' ? 90000 : l.amountCents, basisCents: l.basisCents })),
    });

    saveSinkingFund(ctx, { id: '', name: 'Car registration', targetCents: 96000, savedCents: 40000, dueDate: nextQ([3], 10), categoryId: 'transport.registration', repeat: 'annually' });
    saveSinkingFund(ctx, { id: '', name: 'Christmas', targetCents: 120000, savedCents: 50000, dueDate: makeDate(parts(ctx.today()).y, 12, 15), categoryId: 'shopping.gifts', repeat: 'annually' });
    saveSinkingFund(ctx, { id: '', name: 'Home insurance', targetCents: 218000, savedCents: 150000, dueDate: nextQ([11], 20), categoryId: 'housing.insurance', repeat: 'annually' });

    saveGoal(ctx, { id: '', name: 'Emergency fund', type: 'emergency-fund', targetCents: 2000000, currentCents: 0, targetDate: null, contributionCents: 65000, contributionFrequency: 'monthly', annualRatePercent: 4.5, linkedAccountId: saver });
    saveGoal(ctx, { id: '', name: 'Japan holiday', type: 'holiday', targetCents: 800000, currentCents: 180000, targetDate: '2027-09-01', contributionCents: 30000, contributionFrequency: 'monthly', annualRatePercent: 4.5 });
    saveGoal(ctx, { id: '', name: 'Kitchen renovation', type: 'renovation', targetCents: 3000000, currentCents: 450000, targetDate: '2028-06-30', contributionCents: 50000, contributionFrequency: 'fortnightly', annualRatePercent: 0 });

    saveTermDeposit(ctx, { id: '', institution: 'Example Bank', name: '6-month TD', principalCents: 1000000, startDate: '2026-06-15', maturityDate: '2026-12-15', annualRatePercent: 4.35, interestFrequency: 'at-maturity', interestHandling: 'paid-out' });
    saveTermDeposit(ctx, { id: '', institution: 'Mutual Example', name: '9-month TD', principalCents: 1500000, startDate: '2026-06-01', maturityDate: '2027-03-01', annualRatePercent: 4.45, interestFrequency: 'at-maturity', interestHandling: 'paid-out' });
    saveTermDeposit(ctx, { id: '', institution: 'Example Bank', name: '12-month TD', principalCents: 2000000, startDate: '2026-06-20', maturityDate: '2027-06-20', annualRatePercent: 4.5, interestFrequency: 'monthly', interestHandling: 'compound' });

    // Investments with dividend statements (franking) and a disposal.
    const vas = saveSecurity(ctx, { code: 'VAS', name: 'Example Australian Shares Index ETF', kind: 'etf' });
    const bhp = saveSecurity(ctx, { code: 'BHP', name: 'BHP Group (example holding)', kind: 'share' });
    saveTrade(ctx, { id: '', securityId: vas, accountId: broker, date: '2023-11-02', type: 'buy', quantity: 60, unitPriceCents: 8805, brokerageCents: 995 });
    saveTrade(ctx, { id: '', securityId: vas, accountId: broker, date: '2025-02-14', type: 'buy', quantity: 40, unitPriceCents: 10212, brokerageCents: 995 });
    saveTrade(ctx, { id: '', securityId: bhp, accountId: broker, date: '2024-03-08', type: 'buy', quantity: 200, unitPriceCents: 4410, brokerageCents: 995 });
    saveTrade(ctx, { id: '', securityId: bhp, accountId: broker, date: '2026-02-19', type: 'sell', quantity: 80, unitPriceCents: 4675, brokerageCents: 995 });
    saveDividend(ctx, { id: '', securityId: bhp, paymentDate: '2025-09-24', cashCents: 43540, frankedCents: 43540, unfrankedCents: 0, frankingCreditsCents: 18660, fromStatement: true });
    saveDividend(ctx, { id: '', securityId: bhp, paymentDate: '2026-03-27', cashCents: 38110, frankedCents: 38110, unfrankedCents: 0, frankingCreditsCents: 16333, fromStatement: true });
    saveValuation(ctx, { securityId: vas, date: '2026-09-19', unitPriceCents: 10865 });
    saveValuation(ctx, { securityId: bhp, date: '2026-09-19', unitPriceCents: 4390 });
    addBalance(ctx, broker, '2024-06-30', 60 * 8920 + 200 * 4480, 'manual', 'Units × prices you entered');
    addBalance(ctx, broker, '2025-06-30', 100 * 9910 + 200 * 4210, 'manual', 'Units × prices you entered');
    addBalance(ctx, broker, '2026-06-30', 100 * 10610 + 120 * 4505, 'manual', 'Units × prices you entered');
    addBalance(ctx, broker, '2026-09-19', 100 * 10865 + 120 * 4390, 'manual', 'Units × prices you entered');

    // Super statements.
    for (const [date, bal] of [['2024-06-30', 10580000], ['2024-12-31', 11240000], ['2025-06-30', 11985000], ['2025-12-31', 12860000], ['2026-06-30', 13710000]] as const) {
      saveSuperEntry(ctx, { id: '', accountId: superAcc, date, kind: 'balance', amountCents: bal });
    }
    for (const q of ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-26']) {
      saveSuperEntry(ctx, { id: '', accountId: superAcc, date: q, kind: 'employer', amountCents: 377000 });
      saveSuperEntry(ctx, { id: '', accountId: superAcc, date: q, kind: 'fees', amountCents: -2400 });
      saveSuperEntry(ctx, { id: '', accountId: superAcc, date: q, kind: 'insurance', amountCents: -6100 });
    }

    // Scenarios and a saved snapshot.
    const reduce = saveScenario(ctx, { id: '', name: 'Reduced hours from February', description: 'Salary falls by 40% from 1 February next year.', changes: [{ type: 'change-income', date: makeDate(parts(ctx.today()).y + 1, 2, 1), percentChange: -40 }] });
    saveScenario(ctx, { id: '', name: 'Kitchen renovation', description: 'A $30,000 renovation paid in a year from now.', changes: [{ type: 'one-off', date: addMonths(ctx.today(), 12), amountCents: -3000000, label: 'Kitchen renovation' }] });
    saveScenario(ctx, { id: '', name: 'Rate rise of 1%', description: 'Mortgage rate one percentage point higher from next month.', changes: [{ type: 'mortgage-rate', date: addMonths(ctx.today(), 1), annualRatePercent: 6.89 }] });
    const base = buildAssumptions(ctx, 24).assumptions;
    saveSnapshot(ctx, base, reduce, 'Reduced hours plan — demo snapshot');
  });
}
