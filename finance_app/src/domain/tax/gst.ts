import { ISODate, addDays, addMonths, formatDate, fyRange, parts } from '../dates';
import { Cents, formatMoney, roundCents } from '../money';
import { DateRange } from '../periods';

/**
 * GST and a Simpler BAS preparation summary (G1, 1A, 1B) for users who say they are
 * GST registered. Nothing is lodged. Sole traders are not assumed to be registered.
 */

export type GstClass = 'taxable' | 'gst-free' | 'input-taxed' | 'not-reportable';

export const GST_CLASS_LABEL: Record<GstClass, string> = {
  taxable: 'Taxable (includes GST)',
  'gst-free': 'GST-free',
  'input-taxed': 'Input-taxed',
  'not-reportable': 'Not a GST item (e.g. wages, private, transfers)',
};

export const BAS_DISCLAIMER = 'Preparation summary only — verify before lodgment.';

export interface GstTx {
  id: string;
  date: ISODate;
  /** Positive = sale/income received, negative = purchase/expense paid. */
  amountCents: Cents;
  gstClass: GstClass;
  /** Explicit GST amount recorded (e.g. from a tax invoice); otherwise calculated as 1/11. */
  gstCents?: Cents | null;
  /** Whether `amountCents` includes GST (default true — bank transactions include GST). */
  includesGst?: boolean;
  /** Business-use percentage for purchases (0–100). */
  businessPercent: number;
}

export function gstIncluded(amountCents: Cents): Cents {
  return roundCents(amountCents / 11);
}

export function gstOnTop(amountCents: Cents, rate = 0.1): Cents {
  return roundCents(amountCents * rate);
}

export interface BasSummary {
  range: DateRange;
  registered: boolean;
  g1TotalSalesCents: Cents;
  gstOnSales1ACents: Cents;
  gstOnPurchases1BCents: Cents;
  netGstCents: Cents;
  salesCount: number;
  purchaseCount: number;
  unclassifiedCount: number;
  notes: string[];
  disclaimer: string;
}

function gstComponent(t: GstTx): Cents {
  if (t.gstClass !== 'taxable') return 0;
  if (t.gstCents != null) return Math.abs(t.gstCents);
  const abs = Math.abs(t.amountCents);
  return t.includesGst === false ? gstOnTop(abs) : gstIncluded(abs);
}

/**
 * G1 is reported GST-inclusive (including GST-free sales); 1A is GST on taxable sales;
 * 1B is the GST credit on the business portion of taxable purchases.
 */
export function basSummary(txs: GstTx[], range: DateRange, registered: boolean, unclassifiedCount = 0): BasSummary {
  let g1 = 0, a1 = 0, b1 = 0, sales = 0, purchases = 0;
  const notes: string[] = [];
  if (!registered) {
    notes.push('You have not marked yourself as GST registered, so no GST amounts are calculated.');
  } else {
    for (const t of txs) {
      if (t.date < range.start || t.date > range.end || t.gstClass === 'not-reportable') continue;
      const gst = gstComponent(t);
      if (t.amountCents > 0) {
        if (t.gstClass === 'input-taxed') continue; // input-taxed sales are not reported at G1 on Simpler BAS
        g1 += t.includesGst === false ? t.amountCents + gst : t.amountCents;
        a1 += gst;
        sales++;
      } else if (t.amountCents < 0) {
        if (t.gstClass !== 'taxable') continue;
        b1 += roundCents((gst * Math.max(0, Math.min(100, t.businessPercent))) / 100);
        purchases++;
      }
    }
    notes.push('G1 is shown including GST and includes GST-free sales.');
    notes.push('GST on purchases (1B) only counts the business-use share of each purchase and assumes you hold valid tax invoices where required.');
    notes.push('Amounts are on a cash basis (when money was received or paid).');
  }
  if (unclassifiedCount) notes.push(`${unclassifiedCount} business transaction(s) in this period have no GST classification and are not included.`);
  return {
    range,
    registered,
    g1TotalSalesCents: g1,
    gstOnSales1ACents: a1,
    gstOnPurchases1BCents: b1,
    netGstCents: a1 - b1,
    salesCount: sales,
    purchaseCount: purchases,
    unclassifiedCount,
    notes,
    disclaimer: BAS_DISCLAIMER,
  };
}

/** BAS quarters of a financial year: Jul–Sep, Oct–Dec, Jan–Mar, Apr–Jun. */
export function basQuarters(fy: string): (DateRange & { label: string })[] {
  const { start } = fyRange(fy);
  return [0, 1, 2, 3].map((q) => {
    const s = addMonths(start, q * 3);
    const e = addDays(addMonths(s, 3), -1);
    const names = ['Jul–Sep', 'Oct–Dec', 'Jan–Mar', 'Apr–Jun'];
    return { start: s, end: e, label: `${names[q]} ${parts(e).y}` };
  });
}

/** Informational: GST turnover over the last 12 months vs the registration threshold. */
export function gstTurnoverNote(salesExGstCents: Cents, thresholdDollars: number, asOf: ISODate): string {
  return `Business income recorded in the 12 months to ${formatDate(asOf)} is ${formatMoney(salesExGstCents)} (excluding any GST). The GST registration threshold is $${thresholdDollars.toLocaleString('en-AU')} of GST turnover. Registration rules have exceptions (for example taxi and ride-sourcing drivers must register regardless of turnover) — check the ATO guidance or ask your tax agent.`;
}
