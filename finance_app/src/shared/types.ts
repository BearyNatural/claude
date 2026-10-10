import type { ISODate } from '../domain/dates';
import type { Cents } from '../domain/money';
import type { AccountType, KnownBalance } from '../domain/accounts';
import type { CategoryKind, CategoryNature, IncomeType } from '../domain/categorise/categories';
import type { Confidence, ImportFormat } from '../domain/import/types';
import type { Frequency, PeriodKind } from '../domain/periods';
import type { BusinessUse } from '../domain/categorise/rules';
import type { GstClass } from '../domain/tax/gst';

/** Data shapes passed between the main process and the UI. */

export interface AccountDTO {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  numberMasked: string | null;
  bsb: string | null;
  status: 'active' | 'closed' | 'archived';
  interestRate: number | null;
  creditLimitCents: Cents | null;
  linkedAccountId: string | null;
  notes: string | null;
  sortOrder: number;
  balance: KnownBalance | null;
  lastImportDate: ISODate | null;
  lastStatementEnd: ISODate | null;
  transactionCount: number;
}

export interface CategoryDTO {
  id: string;
  parentId: string | null;
  name: string;
  kind: CategoryKind;
  nature: CategoryNature | null;
  isDefault: boolean;
  archived: boolean;
  path: string;
}

export interface SplitDTO {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  amountCents: Cents;
  note: string | null;
}

export type TaxClass = 'none' | 'deductible' | 'business-income' | 'private';

export interface TransactionDTO {
  id: string;
  accountId: string;
  accountName: string;
  date: ISODate;
  processingDate: ISODate | null;
  amountCents: Cents;
  originalDescription: string;
  cleanDescription: string;
  payee: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryPath: string | null;
  categorySource: string | null;
  categoryExplanation: string | null;
  ruleId: string | null;
  isTransfer: boolean;
  transferId: string | null;
  incomeType: IncomeType | null;
  taxClass: TaxClass | null;
  businessUse: BusinessUse | null;
  businessPercent: number | null;
  gstClass: GstClass | null;
  gstCents: Cents | null;
  isOneOff: boolean;
  notes: string | null;
  tags: string[];
  splits: SplitDTO[];
  importId: string | null;
  status: 'posted' | 'staged';
  reviewReasons: string[];
  confidence: Confidence | null;
  duplicateOf: string | null;
  balanceCents: Cents | null;
  externalId: string | null;
  reference: string | null;
  documentCount: number;
  userModified: boolean;
  originalData: unknown;
}

export interface HistoryDTO {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  createdAt: string;
}

export interface NotificationPrefs {
  enabled: boolean;
  preferredTime: string;
  allowRepeat: boolean;
  showAmounts: boolean;
  types: Record<ReminderType, { enabled: boolean; daysBefore: number }>;
}

export type ReminderType = 'bills' | 'termDeposits' | 'taxReview' | 'insurance' | 'goals' | 'backup' | 'mortgage' | 'annualExpense';

export interface AutoLockPrefs {
  enabled: boolean;
  idleMinutes: number;
  onSleep: boolean;
  onMinimise: boolean;
  maxSessionMinutes: number | null;
}

export interface ForecastDefaults {
  inflationPercent: number;
  wageGrowthPercent: number;
  savingsInterestPercent: number;
  investmentReturnPercent: number;
  lowBalanceThresholdCents: Cents;
}

export interface AppSettings {
  onboardingComplete: boolean;
  analysisPeriods: PeriodKind[];
  fortnightAnchor: ISODate | null;
  weekStartsOn: 1 | 7;
  incomeKinds: string[];
  gstRegistered: boolean;
  hasStudyLoan: boolean;
  medicareExempt: boolean;
  autoLearnRules: boolean;
  learningThreshold: number;
  theme: 'system' | 'light' | 'dark';
  /** The picture behind the content. */
  background: 'geraniums' | 'field' | 'plain';
  highContrast: boolean;
  textScale: number;
  privacyModeDefault: boolean;
  autoLock: AutoLockPrefs;
  notifications: NotificationPrefs;
  lastBackupAt: string | null;
  dashboardSections: { id: string; visible: boolean }[];
  forecast: ForecastDefaults;
  staging: { lowConfidence: boolean; duplicates: boolean; transfers: boolean; allPdf: boolean };
  googleClientId: string | null;
}

export interface ImportPreviewRow {
  index: number;
  date: ISODate;
  processingDate: ISODate | null;
  amountCents: Cents;
  description: string;
  balanceCents: Cents | null;
  confidence: Confidence;
  issues: string[];
  duplicate: { status: 'new' | 'duplicate' | 'possible-duplicate'; matchId: string | null; reasons: string[] };
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  categoryConfidence: Confidence;
  categoryExplanation: string;
  include: boolean;
  willStage: boolean;
  stageReasons: string[];
}

export interface ImportSession {
  sessionId: string;
  fileName: string;
  format: ImportFormat;
  sheetNames: string[];
  selectedSheet: string | null;
  needsMapping: boolean;
  mapping: unknown | null;
  mappingQuestions: string[];
  mappingNotes: string[];
  headers: string[];
  sampleRows: string[][];
  profileMatch: { id: string; name: string } | null;
  statements: {
    index: number;
    accountHint: { number?: string | null; name?: string | null; type?: string | null; institution?: string | null; bsb?: string | null } | null;
    periodStart: ISODate | null;
    periodEnd: ISODate | null;
    openingBalanceCents: Cents | null;
    closingBalanceCents: Cents | null;
    openingBalanceDerived: boolean;
    warnings: string[];
    rejectedRows: { sourceRow: number; reason: string; raw: string }[];
    ocrRequired: boolean;
    confidence: Confidence;
    suggestedAccountId: string | null;
    transactionCount: number;
    /** The account this statement was already imported into, for files that hold several accounts. */
    importedInto: string | null;
  }[];
  alreadyImported: { importId: string; importedAt: string } | null;
}

export interface ReconciliationDTO {
  status: 'reconciled' | 'difference' | 'not-verifiable' | 'no-balances';
  openingCents: Cents | null;
  movementCents: Cents;
  expectedClosingCents: Cents | null;
  closingCents: Cents | null;
  differenceCents: Cents | null;
  message: string;
  hints: string[];
  suspectIndexes: number[];
}

export interface BillDTO {
  id: string;
  name: string;
  amountCents: Cents;
  frequency: Frequency;
  nextDue: ISODate;
  categoryId: string | null;
  accountId: string | null;
  autoPay: boolean;
  reminderDays: number;
  reminderEnabled: boolean;
  active: boolean;
  matchText: string | null;
  notes: string | null;
}

export type DataStatus = 'actual' | 'imported' | 'user-entered' | 'inferred' | 'forecast' | 'estimate' | 'hypothetical' | 'calculated';

/** A number with its provenance, for "How was this calculated?". */
export interface Figure {
  valueCents: Cents;
  status: DataStatus;
  asOf?: ISODate | null;
  explanation: string;
}
