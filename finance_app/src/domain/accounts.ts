import { ISODate, diffDays, formatDate, eachMonthStart, endOfMonth } from './dates';
import { Cents } from './money';

/** Account types, whether each is an asset or liability, and balance freshness/provenance. */

export type AccountType =
  | 'transaction' | 'savings' | 'high-interest-savings' | 'offset' | 'credit-card' | 'mortgage'
  | 'personal-loan' | 'car-loan' | 'other-debt' | 'brokerage-cash' | 'brokerage' | 'superannuation'
  | 'term-deposit' | 'cash' | 'property' | 'vehicle' | 'other-asset' | 'other-liability';

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  transaction: 'Transaction account',
  savings: 'Savings account',
  'high-interest-savings': 'High-interest savings',
  offset: 'Offset account',
  'credit-card': 'Credit card',
  mortgage: 'Mortgage',
  'personal-loan': 'Personal loan',
  'car-loan': 'Car loan',
  'other-debt': 'Other debt',
  'brokerage-cash': 'Brokerage cash account',
  brokerage: 'Brokerage investment account',
  superannuation: 'Superannuation',
  'term-deposit': 'Term deposit',
  cash: 'Cash',
  property: 'Property (manual value)',
  vehicle: 'Vehicle (manual value)',
  'other-asset': 'Other asset',
  'other-liability': 'Other liability',
};

export const LIABILITY_TYPES: AccountType[] = ['credit-card', 'mortgage', 'personal-loan', 'car-loan', 'other-debt', 'other-liability'];
/** Accounts whose balances count as spendable cash in forecasts. */
export const CASH_TYPES: AccountType[] = ['transaction', 'savings', 'high-interest-savings', 'offset', 'cash', 'brokerage-cash'];
/** Where money moved in counts as "saved" on the dashboard. */
export const SAVINGS_TYPES: AccountType[] = ['savings', 'high-interest-savings', 'offset', 'term-deposit', 'brokerage-cash', 'brokerage', 'superannuation'];
export const INVESTMENT_TYPES: AccountType[] = ['brokerage', 'superannuation'];

export function isLiability(t: AccountType): boolean {
  return LIABILITY_TYPES.includes(t);
}

export type ValueSource = 'imported' | 'manual' | 'calculated' | 'estimated' | 'forecast';

export const VALUE_SOURCE_LABEL: Record<ValueSource, string> = {
  imported: 'Imported balance',
  manual: 'Entered manually',
  calculated: 'Calculated',
  estimated: 'Estimated',
  forecast: 'Forecast',
};

export interface BalancePoint {
  accountId: string;
  date: ISODate;
  balanceCents: Cents;
  source: ValueSource;
  note?: string | null;
}

export interface KnownBalance extends BalancePoint {
  ageDays: number;
  stale: boolean;
  label: string;
}

/**
 * The latest known balance for an account and how it is known. A statement balance followed
 * by later imported transactions becomes a *calculated* balance dated at the last transaction.
 * Nothing here is live: every figure carries its date.
 */
export function latestBalance(
  accountId: string,
  snapshots: BalancePoint[],
  transactions: { date: ISODate; amountCents: Cents }[],
  today: ISODate,
  staleAfterDays = 31,
): KnownBalance | null {
  const snap = snapshots.filter((s) => s.accountId === accountId).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!snap) return null;
  const after = transactions.filter((t) => t.date > snap.date);
  let point: BalancePoint = snap;
  if (after.length && snap.source !== 'estimated') {
    const last = after.reduce((m, t) => (t.date > m ? t.date : m), snap.date);
    point = {
      accountId,
      date: last,
      balanceCents: snap.balanceCents + after.reduce((a, t) => a + t.amountCents, 0),
      source: 'calculated',
      note: `${formatDate(snap.date)} ${snap.source === 'manual' ? 'entered' : 'statement'} balance plus ${after.length} later transaction${after.length === 1 ? '' : 's'}`,
    };
  }
  const age = diffDays(point.date, today);
  return {
    ...point,
    ageDays: age,
    stale: age > staleAfterDays,
    label: `${VALUE_SOURCE_LABEL[point.source]} · ${age <= 0 ? 'as at today' : `last updated ${formatDate(point.date)}`}`,
  };
}

export interface NetWorthLine {
  accountId: string;
  name: string;
  type: AccountType;
  balance: KnownBalance | null;
}

export interface NetWorth {
  assets: NetWorthLine[];
  liabilities: NetWorthLine[];
  totalAssetsCents: Cents;
  totalLiabilitiesCents: Cents;
  netCents: Cents;
  oldestDate: ISODate | null;
  notes: string[];
}

/** Liabilities are stored as negative balances; totals report them as positive amounts owed. */
export function netWorth(lines: NetWorthLine[]): NetWorth {
  const assets = lines.filter((l) => !isLiability(l.type));
  const liabilities = lines.filter((l) => isLiability(l.type));
  const ta = assets.reduce((a, l) => a + (l.balance?.balanceCents ?? 0), 0);
  const tl = liabilities.reduce((a, l) => a + Math.abs(l.balance?.balanceCents ?? 0), 0);
  const dated = lines.filter((l) => l.balance).map((l) => l.balance!.date).sort();
  const notes: string[] = [];
  const missing = lines.filter((l) => !l.balance);
  if (missing.length) notes.push(`${missing.length} account${missing.length === 1 ? ' has' : 's have'} no balance yet and ${missing.length === 1 ? 'is' : 'are'} counted as $0: ${missing.map((m) => m.name).join(', ')}.`);
  const stale = lines.filter((l) => l.balance?.stale);
  if (stale.length) notes.push(`${stale.length} balance${stale.length === 1 ? ' is' : 's are'} more than a month old.`);
  const est = lines.filter((l) => l.balance && (l.balance.source === 'estimated' || l.balance.source === 'manual'));
  if (est.length) notes.push(`${est.length} value${est.length === 1 ? ' was' : 's were'} entered or estimated by you (for example property or vehicles).`);
  return { assets, liabilities, totalAssetsCents: ta, totalLiabilitiesCents: tl, netCents: ta - tl, oldestDate: dated[0] ?? null, notes };
}

/** Month-end net position using the last known balance of each account at that date. */
/**
 * Month-end net worth from the last known value of each account. `accountsMissing` counts
 * accounts with no known value yet at that date, so callers can avoid showing a jump that
 * only reflects an account's first recorded value.
 */
export function netWorthHistory(accounts: { id: string; type: AccountType }[], points: BalancePoint[], from: ISODate, to: ISODate): { date: ISODate; netCents: Cents; assetsCents: Cents; liabilitiesCents: Cents; accountsMissing: number }[] {
  const byAcc = new Map<string, BalancePoint[]>();
  for (const p of points) byAcc.set(p.accountId, [...(byAcc.get(p.accountId) ?? []), p]);
  for (const list of byAcc.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return eachMonthStart(from, to).map((m) => {
    const date = endOfMonth(m) > to ? to : endOfMonth(m);
    let assets = 0, liabilities = 0, missing = 0;
    for (const a of accounts) {
      const list = byAcc.get(a.id) ?? [];
      let last: BalancePoint | undefined;
      for (const p of list) if (p.date <= date) last = p;
      if (!last) { missing += 1; continue; }
      if (isLiability(a.type)) liabilities += Math.abs(last.balanceCents);
      else assets += last.balanceCents;
    }
    return { date, netCents: assets - liabilities, assetsCents: assets, liabilitiesCents: liabilities, accountsMissing: missing };
  });
}
