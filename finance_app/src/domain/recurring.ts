import { ISODate, addDays, addMonths, diffDays, parts } from './dates';
import { Cents, roundCents } from './money';
import { FREQUENCY_DAYS, Frequency, PERIODS_PER_YEAR } from './periods';
import { merchantKey } from './categorise/clean';
import { Confidence } from './import/types';

/**
 * Detects likely recurring transactions (salary, rent, bills, subscriptions) from history.
 * Results are suggestions for the user to confirm — nothing is assumed recurring on its own.
 */

export interface RecurringInputTx {
  id: string;
  date: ISODate;
  amountCents: Cents;
  description: string;
  categoryId?: string | null;
  accountId?: string | null;
}

export interface RecurringCandidate {
  key: string;
  name: string;
  direction: 'in' | 'out';
  frequency: Frequency;
  typicalAmountCents: Cents;
  averageAmountCents: Cents;
  amountVaries: boolean;
  occurrences: number;
  firstDate: ISODate;
  lastDate: ISODate;
  nextExpected: ISODate;
  annualCostCents: Cents;
  categoryId: string | null;
  accountId: string | null;
  confidence: Confidence;
  transactionIds: string[];
  looksLikeSubscription: boolean;
  explanation: string;
}

const BANDS: { f: Frequency; min: number; max: number }[] = [
  { f: 'weekly', min: 6, max: 8 },
  { f: 'fortnightly', min: 13, max: 15 },
  { f: 'four-weekly', min: 27, max: 29 },
  { f: 'monthly', min: 26, max: 35 },
  { f: 'quarterly', min: 84, max: 98 },
  { f: 'six-monthly', min: 172, max: 193 },
  { f: 'annually', min: 350, max: 380 },
];

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function classifyInterval(days: number): Frequency | null {
  // Four-weekly and monthly overlap: exactly 28 days is four-weekly, otherwise monthly.
  if (days >= 27.5 && days <= 28.5) return 'four-weekly';
  for (const b of BANDS) if (b.f !== 'four-weekly' && days >= b.min && days <= b.max) return b.f;
  return null;
}

export function nextAfter(last: ISODate, f: Frequency, anchorDay?: number): ISODate {
  switch (f) {
    case 'monthly': return addMonths(last, 1, anchorDay);
    case 'quarterly': return addMonths(last, 3, anchorDay);
    case 'six-monthly': return addMonths(last, 6, anchorDay);
    case 'annually': return addMonths(last, 12, anchorDay);
    default: return addDays(last, Math.round(FREQUENCY_DAYS[f]));
  }
}

const SUBSCRIPTION_CATEGORIES = /^subscriptions/;

export function detectRecurring(txs: RecurringInputTx[], today: ISODate): RecurringCandidate[] {
  const groups = new Map<string, RecurringInputTx[]>();
  for (const t of txs) {
    if (t.amountCents === 0) continue;
    const dir = t.amountCents < 0 ? 'out' : 'in';
    const key = `${dir}:${merchantKey(t.description)}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: RecurringCandidate[] = [];
  for (const [gkey, list] of groups) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    // Same-day repeats (e.g. two coffees) are merged for interval purposes.
    const dates = [...new Set(sorted.map((t) => t.date))];
    if (dates.length < 2) continue;
    const gaps = dates.slice(1).map((d, i) => diffDays(dates[i], d));
    const med = median(gaps);
    const freq = classifyInterval(med);
    if (!freq) continue;
    // Annual needs 2 occurrences; everything else needs at least 3.
    if (freq !== 'annually' && freq !== 'six-monthly' && dates.length < 3) continue;
    const band = BANDS.find((b) => b.f === freq)!;
    const regular = gaps.filter((g) => g >= band.min - 2 && g <= band.max + 2).length / gaps.length;
    if (regular < 0.6) continue;

    const amounts = sorted.map((t) => Math.abs(t.amountCents));
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const typical = median(amounts);
    const spread = Math.max(...amounts) - Math.min(...amounts);
    const amountVaries = spread > Math.max(100, typical * 0.05);
    const cv = Math.sqrt(amounts.reduce((a, v) => a + (v - avg) ** 2, 0) / amounts.length) / (avg || 1);
    // Too variable to be a single recurring item (e.g. groceries at the same shop every week).
    if (cv > 0.35) continue;

    const last = dates[dates.length - 1];
    const anchorDay = ['monthly', 'quarterly', 'six-monthly', 'annually'].includes(freq) ? parts(dates[0]).d : undefined;
    let next = nextAfter(last, freq, anchorDay);
    let guard = 0;
    while (next < today && guard++ < 400) next = nextAfter(next, freq, anchorDay);
    // A series that has stopped (no payment for 2+ cycles) is not suggested.
    if (diffDays(last, today) > FREQUENCY_DAYS[freq] * 2.5) continue;

    const cats = new Map<string, number>();
    for (const t of sorted) if (t.categoryId) cats.set(t.categoryId, (cats.get(t.categoryId) ?? 0) + 1);
    const categoryId = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const accounts = new Map<string, number>();
    for (const t of sorted) if (t.accountId) accounts.set(t.accountId, (accounts.get(t.accountId) ?? 0) + 1);
    const accountId = [...accounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const direction = gkey.startsWith('out') ? 'out' : 'in';
    const confidence: Confidence = regular >= 0.9 && !amountVaries && dates.length >= 4 ? 'high' : regular >= 0.75 ? 'medium' : 'low';
    const looksLikeSubscription = direction === 'out' && !amountVaries && (
      (categoryId ? SUBSCRIPTION_CATEGORIES.test(categoryId) : false) ||
      (['monthly', 'annually', 'four-weekly'].includes(freq) && typical < 20000)
    );
    out.push({
      key: gkey,
      name: merchantKey(sorted[sorted.length - 1].description),
      direction,
      frequency: freq,
      typicalAmountCents: roundCents(typical),
      averageAmountCents: roundCents(avg),
      amountVaries,
      occurrences: sorted.length,
      firstDate: dates[0],
      lastDate: last,
      nextExpected: next,
      annualCostCents: roundCents(avg * PERIODS_PER_YEAR[freq]),
      categoryId,
      accountId,
      confidence,
      transactionIds: sorted.map((t) => t.id),
      looksLikeSubscription,
      explanation: `${dates.length} payments, usually ${Math.round(med)} days apart (${Math.round(regular * 100)}% of gaps fit ${freq}).` +
        (amountVaries ? ' The amount varies.' : ' The amount is steady.'),
    });
  }
  return out.sort((a, b) => b.annualCostCents - a.annualCostCents);
}
