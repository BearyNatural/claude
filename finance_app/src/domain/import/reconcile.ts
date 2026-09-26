import { Cents, formatMoney } from '../money';
import { formatDate } from '../dates';
import { ParsedTransaction } from './types';

/**
 * Statement reconciliation: opening balance + transactions should equal the closing balance.
 * When it doesn't, list the most likely causes so the user knows where to look.
 */

export type ReconciliationStatus = 'reconciled' | 'difference' | 'not-verifiable' | 'no-balances';

export interface ReconciliationResult {
  status: ReconciliationStatus;
  openingCents: Cents | null;
  movementCents: Cents;
  expectedClosingCents: Cents | null;
  closingCents: Cents | null;
  differenceCents: Cents | null;
  message: string;
  hints: string[];
  /** Indexes (into the transaction list) worth checking first. */
  suspectIndexes: number[];
}

export interface ReconcileInput {
  openingCents: Cents | null | undefined;
  closingCents: Cents | null | undefined;
  openingDerived?: boolean;
  transactions: Pick<ParsedTransaction, 'date' | 'amountCents' | 'description' | 'balanceCents' | 'issues'>[];
}

export function reconcile(input: ReconcileInput): ReconciliationResult {
  const txs = input.transactions;
  const movement = txs.reduce((a, t) => a + t.amountCents, 0);
  let opening = input.openingCents ?? null;
  let closing = input.closingCents ?? null;
  const hints: string[] = [];
  const suspects = new Set<number>();

  // A running balance column can stand in for printed opening/closing balances.
  let fromRunningBalance = false;
  if ((opening === null || closing === null) && txs.length && txs.every((t) => t.balanceCents != null)) {
    const sorted = txs.map((t, i) => ({ t, i }));
    const first = sorted[0].t;
    const last = sorted[sorted.length - 1].t;
    // Works for oldest-first lists; newest-first lists are handled by checking both ways.
    const ascOpening = (first.balanceCents as number) - first.amountCents;
    const descOpening = (last.balanceCents as number) - last.amountCents;
    if (opening === null && closing === null) {
      if (ascOpening + movement === last.balanceCents) {
        opening = ascOpening;
        closing = last.balanceCents as number;
        fromRunningBalance = true;
      } else if (descOpening + movement === first.balanceCents) {
        opening = descOpening;
        closing = first.balanceCents as number;
        fromRunningBalance = true;
      }
    }
  }

  if (opening === null || closing === null) {
    return {
      status: 'no-balances',
      openingCents: opening,
      movementCents: movement,
      expectedClosingCents: null,
      closingCents: closing,
      differenceCents: null,
      message: 'This statement does not include both an opening and a closing balance, so it cannot be reconciled.',
      hints: ['You can enter the balances printed on your statement to check this import.'],
      suspectIndexes: [],
    };
  }

  const expected = opening + movement;
  const difference = closing - expected;

  txs.forEach((t, i) => {
    if (t.issues.some((s) => /running balance/i.test(s))) suspects.add(i);
  });

  if (input.openingDerived) {
    return {
      status: 'not-verifiable',
      openingCents: opening,
      movementCents: movement,
      expectedClosingCents: expected,
      closingCents: closing,
      differenceCents: difference,
      message: 'The opening balance was calculated from the closing balance, so this file cannot be independently reconciled. Compare the closing balance with your statement.',
      hints: [],
      suspectIndexes: [...suspects],
    };
  }

  if (difference === 0) {
    return {
      status: 'reconciled',
      openingCents: opening,
      movementCents: movement,
      expectedClosingCents: expected,
      closingCents: closing,
      differenceCents: 0,
      message: fromRunningBalance
        ? 'Statement reconciled successfully using the running balance column.'
        : 'Statement reconciled successfully.',
      hints: [],
      suspectIndexes: [...suspects],
    };
  }

  const absDiff = Math.abs(difference);
  // Missing transaction: a transaction of exactly the difference is absent.
  hints.push(
    difference < 0
      ? `A money-out transaction of ${formatMoney(absDiff)} may be missing from the import.`
      : `A money-in transaction of ${formatMoney(absDiff)} may be missing from the import.`,
  );
  // Duplicated transaction: an imported transaction equal to −difference appears twice.
  const counts = new Map<string, number[]>();
  txs.forEach((t, i) => {
    const k = `${t.date}|${t.amountCents}`;
    counts.set(k, [...(counts.get(k) ?? []), i]);
  });
  txs.forEach((t, i) => {
    if (t.amountCents === -difference) {
      const same = counts.get(`${t.date}|${t.amountCents}`) ?? [];
      if (same.length > 1) {
        hints.push(`"${t.description}" on ${formatDate(t.date)} (${formatMoney(t.amountCents)}) appears more than once — one may be a duplicate.`);
        same.forEach((x) => suspects.add(x));
      } else {
        hints.push(`"${t.description}" on ${formatDate(t.date)} (${formatMoney(t.amountCents)}) matches the difference — check it is not included twice or should not be there.`);
        suspects.add(i);
      }
    }
    // Wrong sign: flipping a transaction changes the movement by twice its amount.
    if (difference % 2 === 0 && t.amountCents === -difference / 2 && t.amountCents !== 0) {
      hints.push(`"${t.description}" on ${formatDate(t.date)} may be money ${t.amountCents < 0 ? 'in' : 'out'} rather than money ${t.amountCents < 0 ? 'out' : 'in'} (debit/credit read the wrong way).`);
      suspects.add(i);
    }
  });
  if (suspects.size && txs.some((t) => t.issues.some((s) => /running balance/i.test(s)))) {
    hints.push('Rows where the running balance does not move by the transaction amount are highlighted — the problem is usually at or just before the first of them.');
  }
  hints.push('If this came from a PDF, compare the highlighted rows with the statement — text extraction can misread amounts.');

  return {
    status: 'difference',
    openingCents: opening,
    movementCents: movement,
    expectedClosingCents: expected,
    closingCents: closing,
    differenceCents: difference,
    message: `Difference: ${formatMoney(absDiff)}. Opening balance plus transactions does not equal the closing balance.`,
    hints,
    suspectIndexes: [...suspects].sort((a, b) => a - b),
  };
}
