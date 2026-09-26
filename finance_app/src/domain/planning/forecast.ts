import { ISODate, addDays, addMonths, diffDays, formatDate, parts, daysInMonth, endOfMonth, toDayNumber } from '../dates';
import { Cents, formatMoney, roundCents } from '../money';
import { FREQUENCY_LABEL, Frequency } from '../periods';
import { occurrences, nthOccurrence } from '../schedule';
import { RepaymentFrequency } from './loans';

/**
 * Cash-flow forecasting engine.
 *
 * A forecast is a day-by-day projection of cash from a starting balance, using streams of
 * income and spending, one-off events, term-deposit maturities, an optional mortgage (with
 * the offset account modelled as the cash balance) and stated assumptions (inflation, wage
 * growth, interest and return rates). Scenarios are lists of changes applied on top of the
 * same assumptions — historical data is never altered.
 *
 * Everything returned is a projection under the assumptions entered, not a prediction.
 */

export type StreamKind =
  | 'employment' | 'business' | 'investment-income' | 'government' | 'super-income' | 'other-income'
  | 'bill' | 'living' | 'loan-repayment' | 'investment-contribution' | 'other-expense';

export const INCOME_KINDS: StreamKind[] = ['employment', 'business', 'investment-income', 'government', 'super-income', 'other-income'];

export interface Stream {
  id: string;
  name: string;
  direction: 'in' | 'out';
  kind: StreamKind;
  /** Always positive; direction gives the sign. */
  amountCents: Cents;
  frequency: Frequency;
  startDate: ISODate;
  endDate?: ISODate | null;
  /** Annual growth; defaults to wage growth (employment) or inflation (spending). */
  growthPercent?: number | null;
  /** Where the figure came from, shown in "How was this calculated?". */
  source?: string;
}

export interface ForecastMortgage {
  balanceCents: Cents;
  annualRatePercent: number;
  repaymentCents: Cents;
  frequency: RepaymentFrequency;
  firstRepaymentDate: ISODate;
  /** When true the projected cash balance sits in the offset account. */
  offsetIsCash: boolean;
}

export interface ForecastAssumptions {
  startDate: ISODate;
  months: number;
  startingCashCents: Cents;
  startingCashAsOf: ISODate | null;
  startingCashNote: string;
  inflationPercent: number;
  wageGrowthPercent: number;
  savingsInterestPercent: number;
  investmentReturnPercent: number;
  startingInvestmentsCents: Cents;
  streams: Stream[];
  oneOffs: { id: string; date: ISODate; amountCents: Cents; label: string }[];
  termDeposits: { id: string; label: string; maturityDate: ISODate; principalCents: Cents; maturityValueCents: Cents }[];
  mortgage?: ForecastMortgage | null;
  lowBalanceThresholdCents: Cents;
}

export type ScenarioChange =
  | { type: 'stop-income'; date: ISODate; streamIds?: string[]; kinds?: StreamKind[] }
  | { type: 'change-income'; date: ISODate; streamIds?: string[]; kinds?: StreamKind[]; percentChange?: number; newAmountCents?: Cents }
  | { type: 'change-expenses'; date: ISODate; percentChange: number; streamIds?: string[]; kinds?: StreamKind[] }
  | { type: 'one-off'; date: ISODate; amountCents: Cents; label: string }
  | { type: 'add-stream'; stream: Stream }
  | { type: 'mortgage-rate'; date: ISODate; annualRatePercent: number }
  | { type: 'mortgage-repayment'; date: ISODate; repaymentCents: Cents }
  | { type: 'savings-rate'; date: ISODate; annualRatePercent: number };

export interface Scenario {
  id: string;
  name: string;
  description?: string | null;
  changes: ScenarioChange[];
  overrides?: Partial<Pick<ForecastAssumptions, 'inflationPercent' | 'wageGrowthPercent' | 'savingsInterestPercent' | 'investmentReturnPercent' | 'months'>>;
}

export interface ForecastPoint {
  date: ISODate;
  cashCents: Cents;
  investmentsCents: Cents;
  termDepositsCents: Cents;
  mortgageCents: Cents;
  /** Cash + investments + term deposits − mortgage (other assets are not included). */
  netPositionCents: Cents;
}

export type EventKind = StreamKind | 'one-off' | 'td-maturity' | 'savings-interest' | 'mortgage-repayment';

export interface ForecastEvent {
  date: ISODate;
  label: string;
  amountCents: Cents;
  kind: EventKind;
  cashAfterCents: Cents;
}

export interface ForecastResult {
  points: ForecastPoint[];
  events: ForecastEvent[];
  lowest: { date: ISODate; cashCents: Cents };
  firstBelowZero: ISODate | null;
  firstBelowThreshold: ISODate | null;
  end: ForecastPoint;
  endDate: ISODate;
  totals: { incomeCents: Cents; spendingCents: Cents; savingsInterestCents: Cents; mortgageInterestCents: Cents; investmentGrowthCents: Cents };
  mortgagePayoffDate: ISODate | null;
  assumptions: string[];
  summary: string;
}

interface Adjust {
  date: ISODate;
  factor?: number;
  newAmount?: Cents;
  stop?: boolean;
}

function selects(stream: Stream, ids?: string[], kinds?: StreamKind[], defaultKinds?: StreamKind[]): boolean {
  if (ids && ids.length) return ids.includes(stream.id);
  if (kinds && kinds.length) return kinds.includes(stream.kind);
  return defaultKinds ? defaultKinds.includes(stream.kind) : true;
}

function isChargeDay(date: ISODate, anchorDay: number): boolean {
  const { y, m, d } = parts(date);
  return d === Math.min(anchorDay, daysInMonth(y, m));
}

export function applyScenario(base: ForecastAssumptions, scenario?: Scenario | null): ForecastAssumptions {
  if (!scenario) return base;
  const a: ForecastAssumptions = { ...base, ...scenario.overrides, streams: [...base.streams], oneOffs: [...base.oneOffs] };
  for (const c of scenario.changes) {
    if (c.type === 'add-stream') a.streams.push(c.stream);
    if (c.type === 'one-off') a.oneOffs.push({ id: `scenario-${a.oneOffs.length}`, date: c.date, amountCents: c.amountCents, label: c.label });
  }
  return a;
}

export function runForecast(base: ForecastAssumptions, scenario?: Scenario | null): ForecastResult {
  const a = applyScenario(base, scenario);
  const changes = scenario?.changes ?? [];
  const start = a.startDate;
  const end = addDays(addMonths(start, a.months), -1);

  // Per-stream adjustments from the scenario.
  const adjustments = new Map<string, Adjust[]>();
  const addAdj = (s: Stream, adj: Adjust) => adjustments.set(s.id, [...(adjustments.get(s.id) ?? []), adj]);
  for (const c of changes) {
    for (const s of a.streams) {
      if (c.type === 'stop-income' && s.direction === 'in' && selects(s, c.streamIds, c.kinds, ['employment'])) addAdj(s, { date: c.date, stop: true });
      if (c.type === 'change-income' && s.direction === 'in' && selects(s, c.streamIds, c.kinds, ['employment'])) {
        addAdj(s, { date: c.date, factor: c.percentChange !== undefined ? 1 + c.percentChange / 100 : undefined, newAmount: c.newAmountCents });
      }
      if (c.type === 'change-expenses' && s.direction === 'out' && selects(s, c.streamIds, c.kinds)) addAdj(s, { date: c.date, factor: 1 + c.percentChange / 100 });
    }
  }
  for (const list of adjustments.values()) list.sort((x, y) => x.date.localeCompare(y.date));

  // Dated cash events.
  const byDay = new Map<number, { label: string; amount: number; kind: EventKind; toInvestments?: boolean }[]>();
  const push = (date: ISODate, e: { label: string; amount: number; kind: EventKind; toInvestments?: boolean }) => {
    const k = toDayNumber(date);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  };
  for (const s of a.streams) {
    const until = s.endDate && s.endDate < end ? s.endDate : end;
    const growth = s.growthPercent ?? (s.direction === 'in' ? (s.kind === 'employment' ? a.wageGrowthPercent : 0) : a.inflationPercent);
    const adj = adjustments.get(s.id) ?? [];
    for (const d of occurrences({ frequency: s.frequency, anchor: s.startDate }, start, until)) {
      const yearsIn = Math.floor(diffDays(start, d) / 365.25);
      let amount = s.amountCents * Math.pow(1 + growth / 100, yearsIn);
      let stopped = false;
      for (const x of adj) {
        if (x.date > d) break;
        if (x.stop) stopped = true;
        if (x.newAmount !== undefined) amount = x.newAmount * Math.pow(1 + growth / 100, Math.floor(diffDays(x.date, d) / 365.25));
        if (x.factor !== undefined) amount *= x.factor;
      }
      if (stopped) continue;
      const cents = roundCents(amount);
      push(d, { label: s.name, amount: s.direction === 'in' ? cents : -cents, kind: s.kind, toInvestments: s.kind === 'investment-contribution' });
    }
  }
  for (const o of a.oneOffs) if (o.date >= start && o.date <= end) push(o.date, { label: o.label, amount: o.amountCents, kind: 'one-off' });
  for (const td of a.termDeposits) {
    if (td.maturityDate >= start && td.maturityDate <= end) push(td.maturityDate, { label: `${td.label} matures`, amount: td.maturityValueCents, kind: 'td-maturity' });
  }

  const savingsRates = changes.filter((c): c is Extract<ScenarioChange, { type: 'savings-rate' }> => c.type === 'savings-rate').sort((x, y) => x.date.localeCompare(y.date));
  const mortgageRates = changes.filter((c): c is Extract<ScenarioChange, { type: 'mortgage-rate' }> => c.type === 'mortgage-rate').sort((x, y) => x.date.localeCompare(y.date));
  const mortgageRepayments = changes.filter((c): c is Extract<ScenarioChange, { type: 'mortgage-repayment' }> => c.type === 'mortgage-repayment').sort((x, y) => x.date.localeCompare(y.date));

  let cash = a.startingCashCents;
  let investments = a.startingInvestmentsCents;
  let tdBalance = a.termDeposits.filter((t) => t.maturityDate >= start).reduce((s, t) => s + t.principalCents, 0);
  const m = a.mortgage ?? null;
  let mortgage = m ? m.balanceCents : 0;
  let mRate = m ? m.annualRatePercent : 0;
  let mRepay = m ? m.repaymentCents : 0;
  let mAccrued = 0;
  let mNextIdx = 0;
  let mNext = m ? m.firstRepaymentDate : '';
  const mAnchor = parts(start).d;
  let payoff: ISODate | null = null;
  let sRate = a.savingsInterestPercent;
  let sAccrued = 0;
  const dailyInvest = Math.pow(1 + a.investmentReturnPercent / 100, 1 / 365) - 1;

  const totals = { incomeCents: 0, spendingCents: 0, savingsInterestCents: 0, mortgageInterestCents: 0, investmentGrowthCents: 0 };
  const events: ForecastEvent[] = [];
  const points: ForecastPoint[] = [];
  let lowest = { date: start, cashCents: cash };
  let firstBelowZero: ISODate | null = cash < 0 ? start : null;
  let firstBelowThreshold: ISODate | null = cash < a.lowBalanceThresholdCents ? start : null;
  const weekly = a.months <= 12;
  let si = 0, mri = 0, mpi = 0;

  const snapshot = (date: ISODate): ForecastPoint => {
    const inv = roundCents(investments);
    return { date, cashCents: cash, investmentsCents: inv, termDepositsCents: tdBalance, mortgageCents: mortgage, netPositionCents: cash + inv + tdBalance - mortgage };
  };
  points.push(snapshot(start));

  for (let date = start; date <= end; date = addDays(date, 1)) {
    while (si < savingsRates.length && savingsRates[si].date <= date) sRate = savingsRates[si++].annualRatePercent;
    while (mri < mortgageRates.length && mortgageRates[mri].date <= date) mRate = mortgageRates[mri++].annualRatePercent;
    while (mpi < mortgageRepayments.length && mortgageRepayments[mpi].date <= date) mRepay = mortgageRepayments[mpi++].repaymentCents;

    for (const e of byDay.get(toDayNumber(date)) ?? []) {
      cash += e.amount;
      if (e.toInvestments) investments -= e.amount;
      if (e.kind === 'td-maturity') tdBalance = Math.max(0, tdBalance - a.termDeposits.filter((t) => t.maturityDate === date).reduce((s, t) => s + t.principalCents, 0));
      if (e.amount > 0 && e.kind !== 'td-maturity') totals.incomeCents += e.amount;
      if (e.amount < 0 && !e.toInvestments) totals.spendingCents -= e.amount;
      events.push({ date, label: e.label, amountCents: e.amount, kind: e.kind, cashAfterCents: cash });
    }

    if (m && mortgage > 0) {
      const offset = m.offsetIsCash ? Math.max(0, Math.min(cash, mortgage)) : 0;
      mAccrued += ((mortgage - offset) * mRate) / 100 / 365;
      if (isChargeDay(date, mAnchor)) {
        const charged = roundCents(mAccrued);
        mortgage += charged;
        totals.mortgageInterestCents += charged;
        mAccrued = 0;
      }
      if (date === mNext) {
        const pay = Math.min(mRepay, mortgage + roundCents(mAccrued));
        if (pay >= mortgage) {
          const charged = roundCents(mAccrued);
          mortgage += charged;
          totals.mortgageInterestCents += charged;
          mAccrued = 0;
        }
        mortgage -= pay;
        cash -= pay;
        totals.spendingCents += pay;
        events.push({ date, label: 'Mortgage repayment', amountCents: -pay, kind: 'mortgage-repayment', cashAfterCents: cash });
        mNextIdx++;
        mNext = nthOccurrence({ frequency: m.frequency, anchor: m.firstRepaymentDate }, mNextIdx);
        if (mortgage <= 0) {
          mortgage = 0;
          payoff = date;
        }
      }
    }

    // Assumed interest on cash that is not sitting in an offset account, credited monthly.
    if (!(m && m.offsetIsCash && mortgage > 0) && sRate > 0 && cash > 0) sAccrued += (cash * sRate) / 100 / 365;
    if (date === endOfMonth(date) && sAccrued > 0) {
      const credit = roundCents(sAccrued);
      cash += credit;
      totals.savingsInterestCents += credit;
      sAccrued = 0;
      events.push({ date, label: 'Interest on savings (assumed)', amountCents: credit, kind: 'savings-interest', cashAfterCents: cash });
    }
    if (investments > 0 && dailyInvest !== 0) {
      const g = investments * dailyInvest;
      investments += g;
      totals.investmentGrowthCents += g;
    }

    if (cash < lowest.cashCents) lowest = { date, cashCents: cash };
    if (firstBelowZero === null && cash < 0) firstBelowZero = date;
    if (firstBelowThreshold === null && cash < a.lowBalanceThresholdCents) firstBelowThreshold = date;

    const periodEnd = weekly ? diffDays(start, date) % 7 === 6 : date === endOfMonth(date);
    if (periodEnd || date === end) points.push(snapshot(date));
  }
  totals.investmentGrowthCents = roundCents(totals.investmentGrowthCents);

  const endPoint = points[points.length - 1];
  const assumptions = [
    `Starting cash ${formatMoney(a.startingCashCents)}${a.startingCashAsOf ? ` (latest known balances as at ${formatDate(a.startingCashAsOf)})` : ''}. ${a.startingCashNote}`.trim(),
    `Inflation on spending: ${a.inflationPercent}% a year; wage growth: ${a.wageGrowthPercent}% a year (applied on each anniversary of the forecast start)`,
    `Interest on cash savings: ${a.savingsInterestPercent}% a year${m?.offsetIsCash ? ' (not applied while cash sits in the mortgage offset)' : ''}`,
    `Investment return assumption: ${a.investmentReturnPercent}% a year on ${formatMoney(a.startingInvestmentsCents)} of investments`,
    ...(m ? [`Mortgage: ${formatMoney(m.balanceCents)} at ${m.annualRatePercent}%, ${FREQUENCY_LABEL[m.frequency].toLowerCase()} repayments of ${formatMoney(m.repaymentCents)}${m.offsetIsCash ? ', cash balance used as the offset' : ''}`] : []),
    ...a.streams.map((s) => `${s.direction === 'in' ? 'Income' : 'Spending'}: ${s.name} ${formatMoney(s.amountCents)} ${FREQUENCY_LABEL[s.frequency].toLowerCase()} from ${formatDate(s.startDate)}${s.endDate ? ` to ${formatDate(s.endDate)}` : ''}${s.source ? ` — ${s.source}` : ''}`),
    ...a.oneOffs.map((o) => `One-off: ${o.label} ${formatMoney(o.amountCents, { signed: true })} on ${formatDate(o.date)}`),
    ...a.termDeposits.map((t) => `Term deposit: ${t.label} ${formatMoney(t.maturityValueCents)} returns to cash on ${formatDate(t.maturityDate)}`),
  ];
  const summary = firstBelowZero
    ? `Under the assumptions entered, this scenario retains a positive cash balance until approximately ${formatDate(firstBelowZero)}.`
    : `Under the assumptions entered, the projected cash balance stays positive until ${formatDate(end)}; the lowest point is about ${formatMoney(lowest.cashCents, { wholeDollars: true })} on ${formatDate(lowest.date)}.`;

  return {
    points,
    events,
    lowest,
    firstBelowZero,
    firstBelowThreshold,
    end: endPoint,
    endDate: end,
    totals,
    mortgagePayoffDate: payoff,
    assumptions,
    summary,
  };
}

/* ------------------------------ scenario comparison ------------------------------ */

export interface ScenarioComparisonRow {
  scenarioId: string;
  name: string;
  endCashCents: Cents;
  endNetPositionCents: Cents;
  lowestCashCents: Cents;
  lowestDate: ISODate;
  cashPositiveUntil: ISODate | null;
  mortgagePayoffDate: ISODate | null;
  sentence: string;
}

/** Side-by-side outcomes. No scenario is ranked or called better. */
export function compareScenarios(results: { scenario: Scenario; result: ForecastResult }[]): ScenarioComparisonRow[] {
  return results.map(({ scenario, result }) => ({
    scenarioId: scenario.id,
    name: scenario.name,
    endCashCents: result.end.cashCents,
    endNetPositionCents: result.end.netPositionCents,
    lowestCashCents: result.lowest.cashCents,
    lowestDate: result.lowest.date,
    cashPositiveUntil: result.firstBelowZero,
    mortgagePayoffDate: result.mortgagePayoffDate,
    sentence: `${scenario.name} results in ${formatMoney(result.end.cashCents, { wholeDollars: true })} cash on ${formatDate(result.endDate)}` +
      (result.firstBelowZero ? `, with cash projected below zero from about ${formatDate(result.firstBelowZero)}` : '') + ', under the assumptions entered.',
  }));
}

/** Starter scenarios the user can duplicate and edit. They are examples, not suggestions. */
export function scenarioTemplates(today: ISODate, mortgageRatePercent?: number | null): Scenario[] {
  const in3 = addMonths(today, 3);
  const rateChange: ScenarioChange[] = mortgageRatePercent != null
    ? [{ type: 'mortgage-rate', date: addMonths(today, 1), annualRatePercent: Math.round((mortgageRatePercent + 1) * 100) / 100 }]
    : [];
  return [
    { id: 'tpl-current', name: 'Current path', description: 'Existing income and spending continue.', changes: [] },
    { id: 'tpl-career-break', name: 'Career break', description: 'Employment income stops from a date.', changes: [{ type: 'stop-income', date: in3 }] },
    { id: 'tpl-reduced-hours', name: 'Reduced hours', description: 'Employment income falls by 40% from a date.', changes: [{ type: 'change-income', date: in3, percentChange: -40 }] },
    { id: 'tpl-retirement', name: 'Retirement', description: 'Employment income stops; enter any super or investment income you want to model.', changes: [{ type: 'stop-income', date: addMonths(today, 12) }] },
    { id: 'tpl-property', name: 'Property purchase', description: 'A large amount leaves savings on a chosen date.', changes: [{ type: 'one-off', date: addMonths(today, 6), amountCents: -10000000, label: 'Property deposit and costs' }] },
    { id: 'tpl-mortgage', name: 'Mortgage rate change', description: 'The mortgage rate is one percentage point higher from next month.', changes: rateChange },
    { id: 'tpl-purchase', name: 'Major purchase', description: 'A one-off future expense.', changes: [{ type: 'one-off', date: in3, amountCents: -2500000, label: 'Major purchase' }] },
  ];
}
