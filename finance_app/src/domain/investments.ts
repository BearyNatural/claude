import { ISODate, fyRange, formatDate } from './dates';
import { Cents, formatMoney, roundCents } from './money';
import { Disposal, Parcel } from './tax/cgt';

/**
 * Investment records: trades, dividends (with franking) and manual valuations.
 * Descriptive only — no buy/sell suggestions, ratings or product recommendations.
 */

export type SecurityKind = 'share' | 'etf' | 'managed-fund' | 'other';

export interface Security {
  id: string;
  code: string;
  name: string;
  kind: SecurityKind;
}

export interface Trade {
  id: string;
  securityId: string;
  accountId?: string | null;
  date: ISODate;
  type: 'buy' | 'sell';
  quantity: number;
  /** Price per unit in cents (may have fractions of a cent). */
  unitPriceCents: number;
  brokerageCents: Cents;
  /** True when the purchase cost isn't known (e.g. inherited shares) — never guessed. */
  costUnknown?: boolean;
  notes?: string | null;
}

export interface Dividend {
  id: string;
  securityId: string;
  paymentDate: ISODate;
  cashCents: Cents;
  frankedCents: Cents;
  unfrankedCents: Cents;
  frankingCreditsCents: Cents;
  withholdingCents?: Cents;
  reinvested?: boolean;
  /** Whether the figures came from a dividend statement (only then are franking credits used). */
  fromStatement: boolean;
  transactionId?: string | null;
}

export interface Valuation {
  securityId: string;
  date: ISODate;
  unitPriceCents: number;
}

export function tradeValueCents(t: Trade): Cents {
  const gross = roundCents(t.quantity * t.unitPriceCents);
  return t.type === 'buy' ? gross + t.brokerageCents : gross - t.brokerageCents;
}

/** CGT parcels and disposals derived from trades. */
export function parcelsAndDisposals(trades: Trade[]): { parcels: Parcel[]; disposals: Disposal[] } {
  const parcels: Parcel[] = [];
  const disposals: Disposal[] = [];
  for (const t of trades) {
    if (t.type === 'buy') parcels.push({ id: t.id, securityId: t.securityId, acquiredDate: t.date, quantity: t.quantity, costCents: t.costUnknown ? null : tradeValueCents(t) });
    else disposals.push({ id: t.id, securityId: t.securityId, date: t.date, quantity: t.quantity, proceedsCents: tradeValueCents(t) });
  }
  return { parcels, disposals };
}

export interface Holding {
  security: Security;
  quantity: number;
  /** Cost of the units still held (FIFO); null if any remaining parcel's cost is unknown. */
  costBaseCents: Cents | null;
  valueCents: Cents | null;
  valuationDate: ISODate | null;
  valuationSource: 'manual' | null;
  unrealisedCents: Cents | null;
}

export function holdings(securities: Security[], trades: Trade[], valuations: Valuation[], asOf: ISODate): Holding[] {
  const out: Holding[] = [];
  for (const s of securities) {
    const ts = trades.filter((t) => t.securityId === s.id && t.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
    const lots: { qty: number; cost: number | null }[] = [];
    for (const t of ts) {
      if (t.type === 'buy') lots.push({ qty: t.quantity, cost: t.costUnknown ? null : tradeValueCents(t) });
      else {
        let need = t.quantity;
        for (const lot of lots) {
          if (need <= 0) break;
          if (lot.qty <= 0) continue;
          const q = Math.min(lot.qty, need);
          if (lot.cost !== null) lot.cost -= (lot.cost * q) / lot.qty;
          lot.qty -= q;
          need -= q;
        }
      }
    }
    const qty = lots.reduce((a, l) => a + l.qty, 0);
    if (qty <= 1e-9) continue;
    const open = lots.filter((l) => l.qty > 1e-9);
    const cost = open.some((l) => l.cost === null) ? null : roundCents(open.reduce((a, l) => a + (l.cost as number), 0));
    const val = valuations.filter((v) => v.securityId === s.id && v.date <= asOf).sort((a, b) => b.date.localeCompare(a.date))[0];
    const value = val ? roundCents(qty * val.unitPriceCents) : null;
    out.push({
      security: s,
      quantity: qty,
      costBaseCents: cost,
      valueCents: value,
      valuationDate: val?.date ?? null,
      valuationSource: val ? 'manual' : null,
      unrealisedCents: value !== null && cost !== null ? value - cost : null,
    });
  }
  return out;
}

export interface DividendTotals {
  count: number;
  cashCents: Cents;
  frankedCents: Cents;
  unfrankedCents: Cents;
  frankingCreditsCents: Cents;
  withoutStatementCents: Cents;
  explanation: string;
}

export function dividendTotals(dividends: Dividend[], fy: string): DividendTotals {
  const { start, end } = fyRange(fy);
  const inYear = dividends.filter((d) => d.paymentDate >= start && d.paymentDate <= end);
  const withStatement = inYear.filter((d) => d.fromStatement);
  const without = inYear.filter((d) => !d.fromStatement);
  const sum = (list: Dividend[], f: (d: Dividend) => number) => list.reduce((a, d) => a + f(d), 0);
  const noStmt = sum(without, (d) => d.cashCents);
  return {
    count: inYear.length,
    cashCents: sum(inYear, (d) => d.cashCents),
    frankedCents: sum(withStatement, (d) => d.frankedCents),
    unfrankedCents: sum(withStatement, (d) => d.unfrankedCents) + noStmt,
    frankingCreditsCents: sum(withStatement, (d) => d.frankingCreditsCents),
    withoutStatementCents: noStmt,
    explanation: without.length
      ? `${without.length} dividend payment(s) totalling ${formatMoney(noStmt)} have no dividend statement entered. They are counted as income, but no franking credits are included for them — franking credits are never inferred from cash received.`
      : `${withStatement.length} dividend statement(s) between ${formatDate(start)} and ${formatDate(end)}.`,
  };
}

/** Franking credit implied by a fully franked amount at a company tax rate — only for checking a statement. */
export function frankingCreditFor(frankedCents: Cents, companyTaxRate = 0.3): Cents {
  return roundCents((frankedCents * companyTaxRate) / (1 - companyTaxRate));
}
