import { ISODate, diffDays } from '../dates';
import { Cents } from '../money';

/**
 * Duplicate detection for re-imported or overlapping statements.
 *
 * Principles:
 *  - A matching institution transaction ID (OFX FITID) is conclusive.
 *  - Otherwise evidence is scored: date, description, running balance and reference.
 *    Same amount alone is never enough.
 *  - Each existing transaction can only "use up" one incoming transaction, so two genuine
 *    identical coffees on the same day are both kept when only one was imported before.
 *  - Uncertain matches are sent to the Review Inbox for the user to decide.
 */

export interface DuplicateCandidate {
  id: string;
  date: ISODate;
  processingDate?: ISODate | null;
  amountCents: Cents;
  description: string;
  externalId?: string | null;
  balanceCents?: Cents | null;
  reference?: string | null;
}

export interface IncomingForDuplicateCheck {
  date: ISODate;
  processingDate?: ISODate | null;
  amountCents: Cents;
  description: string;
  externalId?: string | null;
  balanceCents?: Cents | null;
  reference?: string | null;
}

export type DuplicateStatus = 'new' | 'duplicate' | 'possible-duplicate';

export interface DuplicateResult {
  status: DuplicateStatus;
  matchId: string | null;
  score: number;
  reasons: string[];
}

export function normaliseForMatch(desc: string): string {
  return desc
    .toUpperCase()
    .replace(/\b(CARD|VISA|EFTPOS|PURCHASE|DEBIT|CREDIT|VALUE DATE|AUS|AU|NS|XX\d+|\d{4,})\b/g, ' ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(normaliseForMatch(s).split(' ').filter((t) => t.length > 1));
}

export function descriptionSimilarity(a: string, b: string): number {
  const na = normaliseForMatch(a);
  const nb = normaliseForMatch(b);
  if (na === nb) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

function dayGap(a: IncomingForDuplicateCheck, b: DuplicateCandidate): number {
  const options = [
    Math.abs(diffDays(a.date, b.date)),
    a.processingDate ? Math.abs(diffDays(a.processingDate, b.date)) : Infinity,
    b.processingDate ? Math.abs(diffDays(a.date, b.processingDate)) : Infinity,
    a.processingDate && b.processingDate ? Math.abs(diffDays(a.processingDate, b.processingDate)) : Infinity,
  ];
  return Math.min(...options);
}

export function scorePair(a: IncomingForDuplicateCheck, b: DuplicateCandidate): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  if (a.amountCents !== b.amountCents) return { score: 0, reasons };
  if (a.externalId && b.externalId) {
    return a.externalId === b.externalId
      ? { score: 1, reasons: ['Same transaction ID from the bank'] }
      : { score: 0, reasons: ['Different transaction IDs from the bank'] };
  }
  const gap = dayGap(a, b);
  if (gap > 4) return { score: 0, reasons };
  let score = 0;
  reasons.push('Same amount');
  if (gap === 0) {
    score += 0.4;
    reasons.push('same date');
  } else if (gap === 1) {
    score += 0.3;
    reasons.push('dates 1 day apart');
  } else {
    score += 0.15;
    reasons.push(`dates ${gap} days apart`);
  }
  const sim = descriptionSimilarity(a.description, b.description);
  if (sim === 1) {
    score += 0.4;
    reasons.push('same description');
  } else if (sim >= 0.5) {
    score += 0.25;
    reasons.push('similar description');
  } else {
    reasons.push('different description');
  }
  if (a.balanceCents != null && b.balanceCents != null) {
    if (a.balanceCents === b.balanceCents) {
      score += 0.3;
      reasons.push('same running balance');
    } else {
      score -= 0.5;
      reasons.push('different running balance');
    }
  }
  if (a.reference && b.reference) {
    if (a.reference === b.reference) {
      score += 0.2;
      reasons.push('same reference');
    } else {
      score -= 0.3;
      reasons.push('different reference');
    }
  }
  return { score: Math.max(0, Math.min(1, score)), reasons };
}

export const DUPLICATE_THRESHOLD = 0.75;
export const POSSIBLE_THRESHOLD = 0.4;

export function findDuplicates(incoming: IncomingForDuplicateCheck[], existing: DuplicateCandidate[]): DuplicateResult[] {
  const results: DuplicateResult[] = incoming.map(() => ({ status: 'new', matchId: null, score: 0, reasons: [] }));
  // All plausible pairs, best first, matched one-to-one.
  const pairs: { i: number; j: number; score: number; reasons: string[] }[] = [];
  const byAmount = new Map<number, number[]>();
  existing.forEach((e, j) => {
    const list = byAmount.get(e.amountCents) ?? [];
    list.push(j);
    byAmount.set(e.amountCents, list);
  });
  incoming.forEach((a, i) => {
    for (const j of byAmount.get(a.amountCents) ?? []) {
      const { score, reasons } = scorePair(a, existing[j]);
      if (score >= POSSIBLE_THRESHOLD) pairs.push({ i, j, score, reasons });
    }
  });
  pairs.sort((x, y) => y.score - x.score || x.i - y.i);
  const usedIncoming = new Set<number>();
  const usedExisting = new Set<number>();
  for (const p of pairs) {
    if (usedIncoming.has(p.i) || usedExisting.has(p.j)) continue;
    usedIncoming.add(p.i);
    usedExisting.add(p.j);
    results[p.i] = {
      status: p.score >= DUPLICATE_THRESHOLD ? 'duplicate' : 'possible-duplicate',
      matchId: existing[p.j].id,
      score: p.score,
      reasons: p.reasons,
    };
  }
  // Note identical rows inside the incoming file: they are kept, just pointed out.
  const seen = new Map<string, number>();
  incoming.forEach((a, i) => {
    const key = `${a.date}|${a.amountCents}|${normaliseForMatch(a.description)}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1 && results[i].status === 'new') {
      results[i].reasons.push('Another transaction in this file has the same date, amount and description — both are kept');
    }
  });
  return results;
}
