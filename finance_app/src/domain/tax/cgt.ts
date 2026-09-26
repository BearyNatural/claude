import { ISODate, addYears, diffDays, formatDate, fyRange } from '../dates';
import { Cents, formatMoney, roundCents } from '../money';

/**
 * Capital gains records and a basic estimate for shares/units held by an individual.
 * Missing cost-base information is never invented: if any disposal in the year lacks it,
 * the net capital gain is reported as unavailable.
 */

export interface Parcel {
  id: string;
  securityId: string;
  acquiredDate: ISODate;
  quantity: number;
  /** Total cost including brokerage; null when unknown. */
  costCents: Cents | null;
  costBaseAdjustmentsCents?: Cents;
}

export interface Disposal {
  id: string;
  securityId: string;
  date: ISODate;
  quantity: number;
  /** Sale proceeds less brokerage. */
  proceedsCents: Cents;
  /** Specific parcels sold; first-in-first-out when omitted. */
  parcels?: { parcelId: string; quantity: number }[];
}

export interface CgtEvent {
  disposalId: string;
  parcelId: string | null;
  securityId: string;
  date: ISODate;
  quantity: number;
  proceedsCents: Cents;
  costBaseCents: Cents | null;
  gainCents: Cents | null;
  discountEligible: boolean;
  daysHeld: number | null;
  problem?: string;
}

export interface CgtResult {
  events: CgtEvent[];
  grossGainsCents: Cents;
  lossesCents: Cents;
  discountCents: Cents;
  netCapitalGainCents: Cents | null;
  carriedForwardLossCents: Cents;
  missing: string[];
  explanation: string;
}

/** At least 12 months, not counting the day acquired or the day of the CGT event. */
export function discountEligible(acquired: ISODate, eventDate: ISODate): boolean {
  return eventDate > addYears(acquired, 1);
}

export function capitalGains(parcels: Parcel[], disposals: Disposal[], fy: string, priorLossesCents = 0, discountRate = 0.5): CgtResult {
  const { start, end } = fyRange(fy);
  const remaining = new Map(parcels.map((p) => [p.id, p.quantity]));
  const events: CgtEvent[] = [];
  const missing: string[] = [];
  const sorted = [...disposals].sort((a, b) => a.date.localeCompare(b.date));

  for (const d of sorted) {
    const inYear = d.date >= start && d.date <= end;
    const available = parcels
      .filter((p) => p.securityId === d.securityId && p.acquiredDate <= d.date)
      .sort((a, b) => a.acquiredDate.localeCompare(b.acquiredDate));
    const picks: { parcel: Parcel | null; qty: number }[] = [];
    if (d.parcels && d.parcels.length) {
      for (const sel of d.parcels) picks.push({ parcel: available.find((p) => p.id === sel.parcelId) ?? null, qty: sel.quantity });
    } else {
      let need = d.quantity;
      for (const p of available) {
        if (need <= 0) break;
        const left = remaining.get(p.id) ?? 0;
        if (left <= 0) continue;
        const q = Math.min(left, need);
        picks.push({ parcel: p, qty: q });
        need -= q;
      }
      if (need > 1e-9) picks.push({ parcel: null, qty: need });
    }
    for (const { parcel, qty } of picks) {
      if (parcel) remaining.set(parcel.id, (remaining.get(parcel.id) ?? 0) - qty);
      if (!inYear) continue;
      const proceeds = roundCents((d.proceedsCents * qty) / d.quantity);
      if (!parcel || parcel.costCents === null) {
        const why = !parcel ? `No purchase record covers ${qty} of the units sold on ${formatDate(d.date)}.` : `The purchase on ${formatDate(parcel.acquiredDate)} has no cost recorded.`;
        missing.push(why);
        events.push({ disposalId: d.id, parcelId: parcel?.id ?? null, securityId: d.securityId, date: d.date, quantity: qty, proceedsCents: proceeds, costBaseCents: null, gainCents: null, discountEligible: false, daysHeld: parcel ? diffDays(parcel.acquiredDate, d.date) : null, problem: why });
        continue;
      }
      const cost = roundCents(((parcel.costCents + (parcel.costBaseAdjustmentsCents ?? 0)) * qty) / parcel.quantity);
      events.push({
        disposalId: d.id, parcelId: parcel.id, securityId: d.securityId, date: d.date, quantity: qty, proceedsCents: proceeds,
        costBaseCents: cost, gainCents: proceeds - cost, discountEligible: discountEligible(parcel.acquiredDate, d.date), daysHeld: diffDays(parcel.acquiredDate, d.date),
      });
    }
  }

  const complete = events.filter((e) => e.gainCents !== null);
  const discountable = complete.filter((e) => e.gainCents! > 0 && e.discountEligible).reduce((a, e) => a + e.gainCents!, 0);
  const other = complete.filter((e) => e.gainCents! > 0 && !e.discountEligible).reduce((a, e) => a + e.gainCents!, 0);
  const losses = complete.filter((e) => e.gainCents! < 0).reduce((a, e) => a - e.gainCents!, 0) + priorLossesCents;
  // Losses are applied to non-discountable gains first, then discountable gains (the usual order).
  let lossLeft = losses;
  const otherAfter = Math.max(0, other - lossLeft);
  lossLeft = Math.max(0, lossLeft - other);
  const discAfter = Math.max(0, discountable - lossLeft);
  lossLeft = Math.max(0, lossLeft - discountable);
  const discount = roundCents(discAfter * discountRate);
  const net = otherAfter + discAfter - discount;

  return {
    events,
    grossGainsCents: discountable + other,
    lossesCents: losses,
    discountCents: discount,
    netCapitalGainCents: missing.length ? null : net,
    carriedForwardLossCents: lossLeft,
    missing,
    explanation: missing.length
      ? 'CGT estimate unavailable until cost-base information is provided.'
      : `Capital gains ${formatMoney(discountable + other)} less capital losses ${formatMoney(losses)} (applied to gains not eligible for the discount first), less the ${discountRate * 100}% discount on gains from assets held at least 12 months (${formatMoney(discount)}) = ${formatMoney(net)}. Parcels are matched first-in-first-out unless you chose specific parcels.`,
  };
}
