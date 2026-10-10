import { ISODate } from '../dates';
import { Cents } from '../money';

export type ImportFormat = 'csv' | 'ofx' | 'qfx' | 'qif' | 'xlsx' | 'xls' | 'pdf';

/** How sure the importer is about a value it extracted. */
export type Confidence = 'high' | 'medium' | 'low';

export interface ParsedTransaction {
  /** 1-based row/line in the source, for pointing the user back to it. */
  sourceRow: number;
  date: ISODate;
  processingDate?: ISODate | null;
  /** Negative = money out of the account, positive = money in. */
  amountCents: Cents;
  description: string;
  payee?: string | null;
  memo?: string | null;
  reference?: string | null;
  /** Stable identifier from the institution (OFX FITID) when available. */
  externalId?: string | null;
  balanceCents?: Cents | null;
  /** Account identifier printed on the row, if any. */
  accountRef?: string | null;
  /** Category supplied by the file (QIF "L" field), used only as a hint. */
  categoryHint?: string | null;
  /** The column the amount was printed in when a statement splits amounts by type (e.g. "Employer SG"). */
  sourceColumn?: string | null;
  confidence: Confidence;
  /** Plain-language notes on anything uncertain about this row. */
  issues: string[];
  /** The original row exactly as it appeared, kept forever for provenance. */
  raw: Record<string, string> | string;
}

export interface AccountHint {
  number?: string | null;
  name?: string | null;
  type?: string | null;
  institution?: string | null;
  bsb?: string | null;
}

export interface ParsedStatement {
  format: ImportFormat;
  account?: AccountHint;
  currency?: string | null;
  periodStart?: ISODate | null;
  periodEnd?: ISODate | null;
  openingBalanceCents?: Cents | null;
  closingBalanceCents?: Cents | null;
  /** True when the opening balance was worked out from other figures rather than printed on the statement. */
  openingBalanceDerived?: boolean;
  transactions: ParsedTransaction[];
  /** Rows that could not be read at all (kept so the user can see what was skipped). */
  rejectedRows: { sourceRow: number; reason: string; raw: string }[];
  warnings: string[];
  /** True when OCR was needed (scanned PDF) — never trusted without review. */
  ocrRequired?: boolean;
  /** Overall extraction confidence. */
  confidence: Confidence;
}

export function emptyStatement(format: ImportFormat): ParsedStatement {
  return { format, transactions: [], rejectedRows: [], warnings: [], confidence: 'high' };
}

export function lowestConfidence(values: Confidence[]): Confidence {
  if (values.includes('low')) return 'low';
  if (values.includes('medium')) return 'medium';
  return 'high';
}
