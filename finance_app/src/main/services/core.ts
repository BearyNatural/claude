import { randomUUID } from 'node:crypto';
import { AppDatabase, Row } from '../db/database';
import { ISODate, localToday } from '../../domain/dates';
import { AccountType, BalancePoint, latestBalance, ValueSource } from '../../domain/accounts';
import { flattenCategories } from '../../domain/categorise/categories';
import { defaultRules } from '../../domain/categorise/rules';
import { AnalysisTx, CategoryInfo, CategoryMap } from '../../domain/analysis';
import { AccountDTO, AppSettings, CategoryDTO } from '../../shared/types';

/** Everything a service needs. Created once per unlocked database. */
export interface Ctx {
  db: AppDatabase;
  today(): ISODate;
  now(): string;
  id(): string;
  isDemo: boolean;
  /** Tell the UI data changed (so open screens refresh). */
  changed(area: string): void;
}

export function makeCtx(db: AppDatabase, opts: { isDemo?: boolean; today?: () => ISODate; changed?: (area: string) => void } = {}): Ctx {
  return {
    db,
    today: opts.today ?? (() => localToday()),
    now: () => new Date().toISOString(),
    id: () => randomUUID(),
    isDemo: !!opts.isDemo,
    changed: opts.changed ?? (() => undefined),
  };
}

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

/* ------------------------------ JSON helpers ------------------------------ */

export function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined || v === '') return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
}

export const bool = (v: unknown) => v === 1 || v === true || v === '1';
export const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
export const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/* ------------------------------ settings ------------------------------ */

export const DEFAULT_SETTINGS: AppSettings = {
  onboardingComplete: false,
  analysisPeriods: ['week', 'month'],
  fortnightAnchor: null,
  weekStartsOn: 1,
  incomeKinds: [],
  gstRegistered: false,
  hasStudyLoan: false,
  medicareExempt: false,
  autoLearnRules: false,
  learningThreshold: 2,
  theme: 'system',
  highContrast: false,
  textScale: 1,
  privacyModeDefault: false,
  autoLock: { enabled: false, idleMinutes: 10, onSleep: true, onMinimise: false, maxSessionMinutes: null },
  notifications: {
    enabled: false,
    preferredTime: '09:00',
    allowRepeat: false,
    showAmounts: false,
    types: {
      bills: { enabled: true, daysBefore: 3 },
      termDeposits: { enabled: true, daysBefore: 14 },
      taxReview: { enabled: true, daysBefore: 0 },
      insurance: { enabled: true, daysBefore: 14 },
      goals: { enabled: false, daysBefore: 0 },
      backup: { enabled: true, daysBefore: 30 },
      mortgage: { enabled: false, daysBefore: 2 },
      annualExpense: { enabled: true, daysBefore: 21 },
    },
  },
  lastBackupAt: null,
  dashboardSections: ['period', 'accounts', 'upcoming', 'spending', 'budget', 'goals', 'warnings'].map((id) => ({ id, visible: true })),
  forecast: { inflationPercent: 3, wageGrowthPercent: 0, savingsInterestPercent: 4.2, investmentReturnPercent: 5, lowBalanceThresholdCents: 100000 },
  staging: { lowConfidence: true, duplicates: true, transfers: true, allPdf: true },
  googleClientId: null,
};

export function getSettings(ctx: Ctx): AppSettings {
  const rows = ctx.db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const stored: Partial<AppSettings> = {};
  for (const r of rows) (stored as Record<string, unknown>)[r.key] = json(r.value, null);
  const s = { ...DEFAULT_SETTINGS, ...stored } as AppSettings;
  s.notifications = { ...DEFAULT_SETTINGS.notifications, ...(stored.notifications ?? {}), types: { ...DEFAULT_SETTINGS.notifications.types, ...(stored.notifications?.types ?? {}) } };
  s.autoLock = { ...DEFAULT_SETTINGS.autoLock, ...(stored.autoLock ?? {}) };
  s.forecast = { ...DEFAULT_SETTINGS.forecast, ...(stored.forecast ?? {}) };
  s.staging = { ...DEFAULT_SETTINGS.staging, ...(stored.staging ?? {}) };
  return s;
}

export function updateSettings(ctx: Ctx, patch: Partial<AppSettings>): AppSettings {
  ctx.db.tx(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      ctx.db.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)]);
    }
  });
  ctx.changed('settings');
  return getSettings(ctx);
}

/** Private key/value storage (not part of AppSettings, e.g. OAuth tokens). */
export function getSecretValue<T>(ctx: Ctx, key: string): T | null {
  const v = ctx.db.scalar<string>('SELECT value FROM meta WHERE key = ?', [`private.${key}`]);
  return v ? json<T | null>(v, null) : null;
}

export function setSecretValue(ctx: Ctx, key: string, value: unknown): void {
  if (value === null || value === undefined) ctx.db.run('DELETE FROM meta WHERE key = ?', [`private.${key}`]);
  else ctx.db.run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [`private.${key}`, JSON.stringify(value)]);
}

/* ------------------------------ seeding ------------------------------ */

/** Default categories and built-in rules. Safe to run repeatedly (only adds missing rows). */
export function seedDefaults(ctx: Ctx): void {
  ctx.db.tx(() => {
    flattenCategories().forEach((c, i) => {
      ctx.db.run('INSERT OR IGNORE INTO categories(id, parent_id, name, kind, nature, is_default, sort_order) VALUES(?,?,?,?,?,1,?)', [c.key, c.parentKey, c.name, c.kind, c.nature, i]);
    });
    for (const r of defaultRules()) {
      ctx.db.run(
        `INSERT OR IGNORE INTO rules(id, name, field, match_type, pattern, direction, category_id, income_type, source, priority, enabled, created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,1,?)`,
        [r.id, null, r.field, r.matchType, r.pattern, r.direction ?? 'any', r.categoryId ?? null, r.incomeType ?? null, 'default', r.priority, ctx.now()],
      );
    }
    ctx.db.run("INSERT OR IGNORE INTO meta(key, value) VALUES('created_at', ?)", [ctx.now()]);
  });
}

/* ------------------------------ history ------------------------------ */

export function recordChange(ctx: Ctx, entity: string, entityId: string, field: string, oldValue: unknown, newValue: unknown, reason: string | null): void {
  const o = oldValue === undefined || oldValue === null ? null : String(oldValue);
  const n = newValue === undefined || newValue === null ? null : String(newValue);
  if (o === n) return;
  ctx.db.run('INSERT INTO change_history(id, entity, entity_id, field, old_value, new_value, reason, created_at) VALUES(?,?,?,?,?,?,?,?)', [ctx.id(), entity, entityId, field, o, n, reason, ctx.now()]);
}

/* ------------------------------ categories ------------------------------ */

export function listCategories(ctx: Ctx, includeArchived = false): CategoryDTO[] {
  const rows = ctx.db.all('SELECT * FROM categories ORDER BY sort_order, name');
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const path = (r: Row): string => {
    const parent = r.parent_id ? byId.get(String(r.parent_id)) : undefined;
    return parent ? `${path(parent)} › ${r.name}` : String(r.name);
  };
  return rows
    .filter((r) => includeArchived || !bool(r.archived))
    .map((r) => ({
      id: String(r.id),
      parentId: str(r.parent_id),
      name: String(r.name),
      kind: r.kind as CategoryDTO['kind'],
      nature: (r.nature as CategoryDTO['nature']) ?? null,
      isDefault: bool(r.is_default),
      archived: bool(r.archived),
      path: path(r),
    }));
}

export function categoryMap(ctx: Ctx): CategoryMap {
  const m: CategoryMap = new Map();
  for (const c of listCategories(ctx, true)) m.set(c.id, { id: c.id, name: c.name, parentId: c.parentId, kind: c.kind, nature: c.nature } satisfies CategoryInfo);
  return m;
}

export function saveCategory(ctx: Ctx, c: { id?: string; name: string; parentId: string | null; kind: CategoryDTO['kind']; nature: CategoryDTO['nature'] }): string {
  const name = c.name.trim();
  if (!name) throw new UserError('A category needs a name.');
  if (c.parentId && !ctx.db.get('SELECT id FROM categories WHERE id = ?', [c.parentId])) throw new UserError('The parent category no longer exists.');
  if (c.id) {
    if (c.parentId === c.id) throw new UserError('A category cannot be its own parent.');
    ctx.db.run('UPDATE categories SET name = ?, parent_id = ?, kind = ?, nature = ? WHERE id = ?', [name, c.parentId, c.kind, c.nature, c.id]);
    ctx.changed('categories');
    return c.id;
  }
  const id = ctx.id();
  const order = (ctx.db.scalar<number>('SELECT MAX(sort_order) FROM categories') ?? 0) + 1;
  ctx.db.run('INSERT INTO categories(id, parent_id, name, kind, nature, is_default, sort_order) VALUES(?,?,?,?,?,0,?)', [id, c.parentId, name, c.kind, c.nature, order]);
  ctx.changed('categories');
  return id;
}

/** Archive rather than delete when a category has been used, so history stays intact. */
export function removeCategory(ctx: Ctx, id: string): { archived: boolean } {
  const used = (ctx.db.scalar<number>('SELECT COUNT(*) FROM transactions WHERE category_id = ?', [id]) ?? 0)
    + (ctx.db.scalar<number>('SELECT COUNT(*) FROM transaction_splits WHERE category_id = ?', [id]) ?? 0)
    + (ctx.db.scalar<number>('SELECT COUNT(*) FROM categories WHERE parent_id = ?', [id]) ?? 0);
  if (used > 0) {
    ctx.db.run('UPDATE categories SET archived = 1 WHERE id = ?', [id]);
    ctx.changed('categories');
    return { archived: true };
  }
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM budget_lines WHERE category_id = ?', [id]);
    ctx.db.run('UPDATE rules SET enabled = 0 WHERE category_id = ?', [id]);
    ctx.db.run('DELETE FROM categories WHERE id = ?', [id]);
  });
  ctx.changed('categories');
  return { archived: false };
}

export function restoreCategory(ctx: Ctx, id: string): void {
  ctx.db.run('UPDATE categories SET archived = 0 WHERE id = ?', [id]);
  ctx.changed('categories');
}

/* ------------------------------ accounts & balances ------------------------------ */

export function balancePoints(ctx: Ctx, accountId?: string): BalancePoint[] {
  const rows = accountId
    ? ctx.db.all('SELECT * FROM balance_snapshots WHERE account_id = ? ORDER BY date', [accountId])
    : ctx.db.all('SELECT * FROM balance_snapshots ORDER BY date');
  return rows.map((r) => ({ accountId: String(r.account_id), date: String(r.date), balanceCents: Number(r.balance_cents), source: r.source as ValueSource, note: str(r.note) }));
}

export function accountBalance(ctx: Ctx, accountId: string) {
  const snaps = balancePoints(ctx, accountId);
  const last = snaps[snaps.length - 1];
  const txs = last
    ? ctx.db.all<{ date: string; amount_cents: number }>("SELECT date, amount_cents FROM transactions WHERE account_id = ? AND status = 'posted' AND date > ?", [accountId, last.date])
    : [];
  return latestBalance(accountId, snaps, txs.map((t) => ({ date: t.date, amountCents: t.amount_cents })), ctx.today());
}

export function listAccounts(ctx: Ctx, includeArchived = true): AccountDTO[] {
  const rows = ctx.db.all(`SELECT a.*,
      (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id AND t.status = 'posted') AS tx_count,
      (SELECT MAX(imported_at) FROM imports i WHERE i.account_id = a.id) AS last_import,
      (SELECT MAX(period_end) FROM imports i WHERE i.account_id = a.id) AS last_period_end
    FROM accounts a ORDER BY a.sort_order, a.name`);
  return rows
    .filter((r) => includeArchived || r.status !== 'archived')
    .map((r) => ({
      id: String(r.id),
      name: String(r.name),
      type: r.type as AccountType,
      institution: str(r.institution),
      numberMasked: str(r.number_masked),
      bsb: str(r.bsb),
      status: r.status as AccountDTO['status'],
      interestRate: num(r.interest_rate),
      creditLimitCents: num(r.credit_limit_cents),
      linkedAccountId: str(r.linked_account_id),
      notes: str(r.notes),
      sortOrder: Number(r.sort_order ?? 0),
      balance: accountBalance(ctx, String(r.id)),
      lastImportDate: r.last_import ? String(r.last_import).slice(0, 10) : null,
      lastStatementEnd: str(r.last_period_end),
      transactionCount: Number(r.tx_count ?? 0),
    }));
}

export function maskAccountNumber(n: string | null | undefined): string | null {
  if (!n) return null;
  const digits = n.replace(/\s|-/g, '');
  return digits.length <= 4 ? digits : `••${digits.slice(-4)}`;
}

export interface AccountInput {
  id?: string;
  name: string;
  type: AccountType;
  institution?: string | null;
  number?: string | null;
  bsb?: string | null;
  status?: AccountDTO['status'];
  interestRate?: number | null;
  creditLimitCents?: number | null;
  linkedAccountId?: string | null;
  notes?: string | null;
  openingBalance?: { date: ISODate; balanceCents: number; source: ValueSource } | null;
}

export function saveAccount(ctx: Ctx, a: AccountInput): string {
  const name = a.name.trim();
  if (!name) throw new UserError('An account needs a name.');
  const now = ctx.now();
  const masked = a.number !== undefined ? maskAccountNumber(a.number) : undefined;
  let id = a.id;
  ctx.db.tx(() => {
    if (id) {
      const cur = ctx.db.get('SELECT * FROM accounts WHERE id = ?', [id]);
      if (!cur) throw new UserError('That account no longer exists.');
      ctx.db.run(
        `UPDATE accounts SET name=?, type=?, institution=?, number_masked=COALESCE(?, number_masked), bsb=?, status=?, interest_rate=?,
          credit_limit_cents=?, linked_account_id=?, notes=?, updated_at=? WHERE id=?`,
        [name, a.type, a.institution ?? null, masked ?? null, a.bsb ?? null, a.status ?? 'active', a.interestRate ?? null, a.creditLimitCents ?? null, a.linkedAccountId ?? null, a.notes ?? null, now, id],
      );
      if (cur.status !== (a.status ?? 'active')) recordChange(ctx, 'account', id, 'status', cur.status, a.status ?? 'active', 'User changed account status');
    } else {
      id = ctx.id();
      const order = (ctx.db.scalar<number>('SELECT MAX(sort_order) FROM accounts') ?? 0) + 1;
      ctx.db.run(
        `INSERT INTO accounts(id, name, type, institution, number_masked, bsb, status, interest_rate, credit_limit_cents, linked_account_id, notes, sort_order, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, name, a.type, a.institution ?? null, masked ?? null, a.bsb ?? null, a.status ?? 'active', a.interestRate ?? null, a.creditLimitCents ?? null, a.linkedAccountId ?? null, a.notes ?? null, order, now, now],
      );
    }
    if (a.openingBalance) addBalance(ctx, id!, a.openingBalance.date, a.openingBalance.balanceCents, a.openingBalance.source, 'Entered with the account');
  });
  ctx.changed('accounts');
  return id!;
}

export function addBalance(ctx: Ctx, accountId: string, date: ISODate, balanceCents: number, source: ValueSource, note: string | null, importId: string | null = null): string {
  const id = ctx.id();
  ctx.db.run('INSERT INTO balance_snapshots(id, account_id, date, balance_cents, source, import_id, note, created_at) VALUES(?,?,?,?,?,?,?,?)', [id, accountId, date, balanceCents, source, importId, note, ctx.now()]);
  ctx.changed('accounts');
  return id;
}

export function deleteBalance(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM balance_snapshots WHERE id = ?', [id]);
  ctx.changed('accounts');
}

/** Accounts with transactions are closed/archived, never deleted with their history. */
export function deleteAccount(ctx: Ctx, id: string): { deleted: boolean } {
  const count = ctx.db.scalar<number>('SELECT COUNT(*) FROM transactions WHERE account_id = ?', [id]) ?? 0;
  if (count > 0) throw new UserError(`This account has ${count} transactions. Close or archive it instead so its history is kept.`);
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM balance_snapshots WHERE account_id = ?', [id]);
    ctx.db.run('DELETE FROM super_entries WHERE account_id = ?', [id]);
    ctx.db.run('DELETE FROM import_profiles WHERE account_id = ?', [id]);
    ctx.db.run('DELETE FROM imports WHERE account_id = ?', [id]);
    ctx.db.run('DELETE FROM accounts WHERE id = ?', [id]);
  });
  ctx.changed('accounts');
  return { deleted: true };
}

/* ------------------------------ analysis loaders ------------------------------ */

/** Posted transactions in the shape the analysis engine uses. */
export function analysisTransactions(ctx: Ctx, from?: ISODate, to?: ISODate): AnalysisTx[] {
  const where = ["t.status = 'posted'"];
  const params: string[] = [];
  if (from) { where.push('t.date >= ?'); params.push(from); }
  if (to) { where.push('t.date <= ?'); params.push(to); }
  const rows = ctx.db.all(`SELECT t.id, t.account_id, t.date, t.amount_cents, t.clean_description, t.category_id, t.is_transfer, t.is_one_off, t.income_type
    FROM transactions t WHERE ${where.join(' AND ')} ORDER BY t.date`, params);
  const splits = ctx.db.all('SELECT transaction_id, category_id, amount_cents FROM transaction_splits');
  const byTx = new Map<string, { categoryId: string | null; amountCents: number }[]>();
  for (const s of splits) {
    const k = String(s.transaction_id);
    byTx.set(k, [...(byTx.get(k) ?? []), { categoryId: str(s.category_id), amountCents: Number(s.amount_cents) }]);
  }
  const tags = ctx.db.all('SELECT tt.transaction_id, g.name FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id');
  const tagMap = new Map<string, string[]>();
  for (const t of tags) tagMap.set(String(t.transaction_id), [...(tagMap.get(String(t.transaction_id)) ?? []), String(t.name)]);
  return rows.map((r) => ({
    id: String(r.id),
    accountId: String(r.account_id),
    date: String(r.date),
    amountCents: Number(r.amount_cents),
    description: String(r.clean_description),
    categoryId: str(r.category_id),
    isTransfer: bool(r.is_transfer),
    isOneOff: bool(r.is_one_off),
    incomeType: (r.income_type as AnalysisTx['incomeType']) ?? null,
    splits: byTx.get(String(r.id)),
    tags: tagMap.get(String(r.id)) ?? [],
  }));
}
