import { ISODate, diffDays } from './dates';
import { Cents } from './money';
import { Confidence } from './import/types';

/**
 * Finds pairs of transactions that are one internal transfer between the user's own
 * accounts: -$1,000 from the transaction account and +$1,000 into savings are one
 * movement, not $1,000 spending plus $1,000 income.
 */

export interface TransferTx {
  id: string;
  accountId: string;
  date: ISODate;
  amountCents: Cents;
  description: string;
  isTransferCategory?: boolean;
}

export interface TransferSuggestion {
  outId: string;
  inId: string;
  amountCents: Cents;
  score: number;
  confidence: Confidence;
  reasons: string[];
}

const TRANSFER_WORDS = /\b(TRANSFER|TFR|XFER|INTERNET\s+BANKING|OSKO|PAYID|PAYMENT\s+(THANK\s*YOU|RECEIVED)|TO\s+SAVINGS|FROM\s+SAVINGS|TO\s+OFFSET|LOAN\s+REPAYMENT|HOME\s+LOAN|CREDIT\s+CARD|SWEEP|BPAY)\b/i;

export function findTransferPairs(txs: TransferTx[], opts: { maxDays?: number } = {}): TransferSuggestion[] {
  const maxDays = opts.maxDays ?? 3;
  const outs = txs.filter((t) => t.amountCents < 0);
  const ins = txs.filter((t) => t.amountCents > 0);
  const byAmount = new Map<number, TransferTx[]>();
  for (const t of ins) byAmount.set(t.amountCents, [...(byAmount.get(t.amountCents) ?? []), t]);

  const pairs: TransferSuggestion[] = [];
  for (const o of outs) {
    const cands = (byAmount.get(-o.amountCents) ?? []).filter((i) => i.accountId !== o.accountId && Math.abs(diffDays(o.date, i.date)) <= maxDays);
    for (const i of cands) {
      const reasons = ['Same amount out of one account and into another'];
      let score = 0.45;
      const gap = Math.abs(diffDays(o.date, i.date));
      if (gap === 0) {
        score += 0.2;
        reasons.push('same day');
      } else if (gap === 1) {
        score += 0.15;
        reasons.push('1 day apart');
      } else {
        score += 0.05;
        reasons.push(`${gap} days apart`);
      }
      const words = TRANSFER_WORDS.test(o.description) || TRANSFER_WORDS.test(i.description);
      if (words) {
        score += 0.25;
        reasons.push('description mentions a transfer or payment');
      }
      if (o.isTransferCategory || i.isTransferCategory) {
        score += 0.1;
        reasons.push('already categorised as a transfer');
      }
      if (cands.length > 1) {
        score -= 0.15;
        reasons.push(`${cands.length} possible matching deposits`);
      }
      pairs.push({ outId: o.id, inId: i.id, amountCents: -o.amountCents, score: Math.min(1, score), confidence: 'low', reasons });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedOut = new Set<string>();
  const usedIn = new Set<string>();
  const out: TransferSuggestion[] = [];
  for (const p of pairs) {
    if (usedOut.has(p.outId) || usedIn.has(p.inId)) continue;
    usedOut.add(p.outId);
    usedIn.add(p.inId);
    p.confidence = p.score >= 0.8 ? 'high' : p.score >= 0.6 ? 'medium' : 'low';
    out.push(p);
  }
  return out;
}
