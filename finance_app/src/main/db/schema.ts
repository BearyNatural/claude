import { AppDatabase } from './database';

/**
 * Schema versioning. Each migration moves the database forward one version and must never
 * drop financial records. Before migrating an existing database, the caller makes an
 * encrypted copy so the previous version can be restored.
 */

export interface Migration {
  version: number;
  description: string;
  up: (db: AppDatabase) => void;
}

const V1 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, institution TEXT, number_masked TEXT, bsb TEXT,
  status TEXT NOT NULL DEFAULT 'active', interest_rate REAL, credit_limit_cents INTEGER, linked_account_id TEXT,
  notes TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE balance_snapshots (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, date TEXT NOT NULL,
  balance_cents INTEGER NOT NULL, source TEXT NOT NULL, import_id TEXT, note TEXT, created_at TEXT NOT NULL
);
CREATE INDEX ix_snap_account ON balance_snapshots(account_id, date);

CREATE TABLE categories (
  id TEXT PRIMARY KEY, parent_id TEXT REFERENCES categories(id), name TEXT NOT NULL, kind TEXT NOT NULL, nature TEXT,
  is_default INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE import_profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, format TEXT NOT NULL, signature TEXT NOT NULL, mapping TEXT NOT NULL,
  account_id TEXT, created_at TEXT NOT NULL, last_used_at TEXT
);
CREATE TABLE imports (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), file_name TEXT NOT NULL, file_sha256 TEXT NOT NULL,
  format TEXT NOT NULL, profile_id TEXT, document_id TEXT, imported_at TEXT NOT NULL, period_start TEXT, period_end TEXT,
  opening_balance_cents INTEGER, closing_balance_cents INTEGER, reconciliation TEXT, row_count INTEGER NOT NULL DEFAULT 0,
  added_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0, staged_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0, rejected TEXT, warnings TEXT, ocr_required INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), date TEXT NOT NULL, processing_date TEXT,
  amount_cents INTEGER NOT NULL, original_description TEXT NOT NULL, clean_description TEXT NOT NULL, payee TEXT,
  category_id TEXT REFERENCES categories(id), category_source TEXT, rule_id TEXT, category_explanation TEXT,
  is_transfer INTEGER NOT NULL DEFAULT 0, transfer_id TEXT, income_type TEXT, tax_class TEXT,
  business_use TEXT, business_percent REAL, gst_class TEXT, gst_cents INTEGER, is_one_off INTEGER NOT NULL DEFAULT 0,
  notes TEXT, import_id TEXT, source_row INTEGER, external_id TEXT, reference TEXT, balance_cents INTEGER,
  original_data TEXT, status TEXT NOT NULL DEFAULT 'posted', review_reasons TEXT, confidence TEXT, duplicate_of TEXT,
  recurring_id TEXT, payslip_id TEXT, user_modified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX ix_tx_account_date ON transactions(account_id, date);
CREATE INDEX ix_tx_date ON transactions(date);
CREATE INDEX ix_tx_status ON transactions(status);
CREATE INDEX ix_tx_external ON transactions(account_id, external_id);

CREATE TABLE transaction_splits (
  id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id), amount_cents INTEGER NOT NULL, note TEXT
);
CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
CREATE TABLE transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (transaction_id, tag_id)
);
CREATE TABLE transfers (
  id TEXT PRIMARY KEY, out_tx_id TEXT NOT NULL, in_tx_id TEXT, status TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL
);

CREATE TABLE rules (
  id TEXT PRIMARY KEY, name TEXT, field TEXT NOT NULL, match_type TEXT NOT NULL, pattern TEXT NOT NULL, direction TEXT,
  amount_min_cents INTEGER, amount_max_cents INTEGER, account_id TEXT, category_id TEXT, income_type TEXT, payee TEXT,
  tax_class TEXT, business_use TEXT, business_percent REAL, tags TEXT, source TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1, hit_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE change_history (
  id TEXT PRIMARY KEY, entity TEXT NOT NULL, entity_id TEXT NOT NULL, field TEXT NOT NULL, old_value TEXT, new_value TEXT,
  reason TEXT, created_at TEXT NOT NULL
);
CREATE INDEX ix_history_entity ON change_history(entity, entity_id);
CREATE TABLE dismissed (key TEXT PRIMARY KEY, created_at TEXT NOT NULL);

CREATE TABLE recurring (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, match_key TEXT NOT NULL, direction TEXT NOT NULL, frequency TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, amount_varies INTEGER NOT NULL DEFAULT 0, next_expected TEXT, last_seen TEXT,
  category_id TEXT, account_id TEXT, is_subscription INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, amount_cents INTEGER NOT NULL, frequency TEXT NOT NULL, next_due TEXT NOT NULL,
  category_id TEXT, account_id TEXT, auto_pay INTEGER NOT NULL DEFAULT 0, reminder_days INTEGER NOT NULL DEFAULT 3,
  reminder_enabled INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, match_text TEXT, notes TEXT, created_at TEXT NOT NULL
);
CREATE TABLE budgets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, method TEXT NOT NULL, frequency TEXT NOT NULL, basis_start TEXT, basis_end TEXT,
  is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE budget_lines (
  id TEXT PRIMARY KEY, budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE, category_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, basis_cents INTEGER, note TEXT
);
CREATE TABLE sinking_funds (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, target_cents INTEGER NOT NULL, saved_cents INTEGER NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL, category_id TEXT, repeat TEXT, notes TEXT, created_at TEXT NOT NULL
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, target_cents INTEGER NOT NULL, current_cents INTEGER NOT NULL DEFAULT 0,
  target_date TEXT, contribution_cents INTEGER NOT NULL DEFAULT 0, contribution_frequency TEXT NOT NULL DEFAULT 'monthly',
  rate_percent REAL NOT NULL DEFAULT 0, one_offs TEXT, linked_account_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE scenarios (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, changes TEXT NOT NULL, overrides TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE scenario_snapshots (
  id TEXT PRIMARY KEY, scenario_id TEXT, name TEXT NOT NULL, created_at TEXT NOT NULL, assumptions TEXT NOT NULL,
  changes TEXT NOT NULL, summary TEXT NOT NULL
);
CREATE TABLE loans (
  id TEXT PRIMARY KEY, account_id TEXT, name TEXT NOT NULL, kind TEXT NOT NULL, balance_cents INTEGER NOT NULL,
  rate_percent REAL NOT NULL, repayment_cents INTEGER, frequency TEXT NOT NULL, remaining_term_months INTEGER,
  offset_account_id TEXT, extra_repayment_cents INTEGER NOT NULL DEFAULT 0, as_of TEXT NOT NULL, rate_changes TEXT,
  notes TEXT, created_at TEXT NOT NULL
);
CREATE TABLE term_deposits (
  id TEXT PRIMARY KEY, institution TEXT NOT NULL, name TEXT, principal_cents INTEGER NOT NULL, start_date TEXT NOT NULL,
  maturity_date TEXT NOT NULL, rate_percent REAL NOT NULL, interest_frequency TEXT NOT NULL, interest_handling TEXT NOT NULL,
  interest_destination TEXT, account_id TEXT, status TEXT NOT NULL DEFAULT 'active', reminder_days INTEGER NOT NULL DEFAULT 14,
  notes TEXT, created_at TEXT NOT NULL
);

CREATE TABLE payslips (
  id TEXT PRIMARY KEY, employer TEXT NOT NULL, pay_date TEXT NOT NULL, period_start TEXT, period_end TEXT,
  gross_cents INTEGER NOT NULL, allowances_cents INTEGER NOT NULL DEFAULT 0, salary_sacrifice_cents INTEGER NOT NULL DEFAULT 0,
  taxable_cents INTEGER, payg_cents INTEGER NOT NULL DEFAULT 0, employer_super_cents INTEGER NOT NULL DEFAULT 0,
  deductions_cents INTEGER NOT NULL DEFAULT 0, net_cents INTEGER NOT NULL, transaction_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE tax_entries (
  id TEXT PRIMARY KEY, fy TEXT NOT NULL, kind TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  date TEXT, transaction_id TEXT, created_at TEXT NOT NULL
);

CREATE TABLE securities (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL);
CREATE TABLE trades (
  id TEXT PRIMARY KEY, security_id TEXT NOT NULL REFERENCES securities(id), account_id TEXT, date TEXT NOT NULL, type TEXT NOT NULL,
  quantity REAL NOT NULL, unit_price_cents REAL NOT NULL, brokerage_cents INTEGER NOT NULL DEFAULT 0, cost_unknown INTEGER NOT NULL DEFAULT 0,
  notes TEXT, created_at TEXT NOT NULL
);
CREATE TABLE dividends (
  id TEXT PRIMARY KEY, security_id TEXT NOT NULL REFERENCES securities(id), payment_date TEXT NOT NULL, cash_cents INTEGER NOT NULL,
  franked_cents INTEGER NOT NULL DEFAULT 0, unfranked_cents INTEGER NOT NULL DEFAULT 0, franking_credits_cents INTEGER NOT NULL DEFAULT 0,
  withholding_cents INTEGER NOT NULL DEFAULT 0, reinvested INTEGER NOT NULL DEFAULT 0, from_statement INTEGER NOT NULL DEFAULT 0,
  transaction_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE valuations (id TEXT PRIMARY KEY, security_id TEXT NOT NULL REFERENCES securities(id), date TEXT NOT NULL, unit_price_cents REAL NOT NULL);
CREATE TABLE super_entries (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, date TEXT NOT NULL, kind TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, notes TEXT, created_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY, file_name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL, sha256 TEXT NOT NULL, kind TEXT NOT NULL,
  notes TEXT, created_at TEXT NOT NULL
);
CREATE TABLE document_links (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  PRIMARY KEY (document_id, entity, entity_id)
);

CREATE TABLE reminders_sent (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
CREATE TABLE exports (
  id TEXT PRIMARY KEY, target TEXT NOT NULL, name TEXT NOT NULL, external_id TEXT, url TEXT, managed INTEGER NOT NULL DEFAULT 0,
  sheets TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, description: 'Initial schema', up: (db) => db.exec(V1) },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function currentVersion(db: AppDatabase): number {
  const exists = db.scalar<number>("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='meta'");
  if (!exists) return 0;
  const v = db.scalar<string>("SELECT value FROM meta WHERE key = 'schema_version'");
  return v ? Number(v) : 0;
}

/**
 * Bring the database up to the current schema. `beforeMigrate` runs once, before the first
 * migration on an existing database (used to take an encrypted pre-migration copy).
 */
export function migrate(db: AppDatabase, beforeMigrate?: (fromVersion: number) => void): { from: number; to: number } {
  const from = currentVersion(db);
  if (from > SCHEMA_VERSION) {
    throw new Error(`This database uses schema version ${from}, which is newer than this version of Geranium supports (${SCHEMA_VERSION}). Please update Geranium.`);
  }
  if (from === SCHEMA_VERSION) return { from, to: from };
  if (from > 0 && beforeMigrate) beforeMigrate(from);
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    db.tx(() => {
      m.up(db);
      db.run("INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(m.version)]);
    });
  }
  return { from, to: SCHEMA_VERSION };
}
