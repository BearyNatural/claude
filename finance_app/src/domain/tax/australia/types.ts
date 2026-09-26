/**
 * Versioned Australian tax rules. Each financial year has its own rules file; nothing
 * is hard-coded in the estimator. Every component records its authoritative source,
 * the date it was last reviewed, and whether it is published, legislated-but-not-yet-published
 * by the ATO, or provisional (a later year's figures are not yet known, so the latest known
 * values are used and the estimate says so).
 */
export type RuleStatus = 'published' | 'legislated' | 'provisional';

export interface SourceRef {
  title: string;
  url: string;
  /** Date the page was read when the rule was implemented or last checked (ISO). */
  reviewed: string;
  /** Page's own "last updated" date where shown. */
  pageUpdated?: string;
  covers: string;
}

export interface Component<T> {
  value: T;
  status: RuleStatus;
  sourceIds: string[];
  note?: string;
}

/** Marginal brackets: `rate` applies to each dollar above `over`. */
export interface Bracket {
  over: number;
  rate: number;
}

export type StudyLoanRule =
  | { kind: 'percentage-of-income'; thresholds: { from: number; rate: number }[] }
  | { kind: 'marginal'; nilTo: number; tiers: { over: number; base: number; rate: number }[]; flatFrom: number; flatRate: number };

export interface TaxYearRules {
  fy: string;
  lastReviewed: string;
  residentRates: Component<Bracket[]>;
  medicare: Component<{ rate: number; singleLower: number; singleUpper: number; phaseInRate: number }>;
  lito: Component<{ max: number; fullTo: number; firstTaper: number; secondFrom: number; secondBase: number; secondTaper: number; cutOut: number }>;
  studyLoan: Component<StudyLoanRule>;
  superannuation: Component<{ concessionalCap: number; nonConcessionalCap: number; superGuaranteeRatePercent: number }>;
  gst: Component<{ rate: number; registrationThreshold: number }>;
  cgt: Component<{ individualDiscount: number; minimumOwnershipMonths: number }>;
  sources: Record<string, SourceRef>;
  notes: string[];
}
