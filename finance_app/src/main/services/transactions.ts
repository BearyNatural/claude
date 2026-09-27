import { Ctx, UserError, bool, categoryMap, json, listCategories, num, recordChange, str, getSettings } from './core';
import { Row } from '../db/database';
import { ISODate, addDays, isValidDate } from '../../domain/dates';
import { Cents } from '../../domain/money';
import { cleanDescription, guessPayee, merchantKey } from '../../domain/categorise/clean';
import { Rule, RuleSubject, validateRegex, describeRule } from '../../domain/categorise/rules';
import { CategoryCorrection, HistoryEntry, RuleSuggestion, suggestCategory, suggestRules } from '../../domain/categorise/learning';
import { IncomeType, INCOME_CATEGORY_FOR_TYPE } from '../../domain/categorise/categories';
import { findTransferPairs, TransferSuggestion } from '../../domain/transfers';
import { matchesSearch, parseSearch, SearchableTx } from '../../domain/search';
import { HistoryDTO, TransactionDTO, TaxClass, SplitDTO } from '../../shared/types';

/* ------------------------------ mapping ------------------------------ */

function loadTags(ctx: Ctx, ids: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  if (!ids.length) return m;
  const rows = ctx.db.all(`SELECT tt.transaction_id, g.name FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.transaction_id IN (${ids.map(() => '?').join(',')})`, ids);
  for (const r of rows) m.set(String(r.transaction_id), [...(m.get(String(r.transaction_id)) ?? []), String(r.name)]);
  return m;
}

function loadSplits(ctx: Ctx, ids: string[], names: Map<string, string>): Map<string, SplitDTO[]> {
  const m = new Map<string, SplitDTO[]>();
  if (!ids.length) return m;
  const rows = ctx.db.all(`SELECT * FROM transaction_splits WHERE transaction_id IN (${ids.map(() => '?').join(',')})`, ids);
  for (const r of rows) {
    const cat = str(r.category_id);
    m.set(String(r.transaction_id), [...(m.get(String(r.transaction_id)) ?? []), { id: String(r.id), categoryId: cat, categoryName: cat ? names.get(cat) ?? null : null, amountCents: Number(r.amount_cents), note: str(r.note) }]);
  }
  return m;
}

export function toDTOs(ctx: Ctx, rows: Row[]): TransactionDTO[] {
  const cats = listCategories(ctx, true);
  const names = new Map(cats.map((c) => [c.id, c.name]));
  const paths = new Map(cats.map((c) => [c.id, c.path]));
  const accounts = new Map(ctx.db.all('SELECT id, name FROM accounts').map((a) => [String(a.id), String(a.name)]));
  const ids = rows.map((r) => String(r.id));
  const tags = loadTags(ctx, ids);
  const splits = loadSplits(ctx, ids, names);
  const docs = new Map<string, number>();
  if (ids.length) {
    for (const d of ctx.db.all(`SELECT entity_id, COUNT(*) AS n FROM document_links WHERE entity = 'transaction' AND entity_id IN (${ids.map(() => '?').join(',')}) GROUP BY entity_id`, ids)) {
      docs.set(String(d.entity_id), Number(d.n));
    }
  }
  return rows.map((r) => {
    const cat = str(r.category_id);
    return {
      id: String(r.id),
      accountId: String(r.account_id),
      accountName: accounts.get(String(r.account_id)) ?? 'Unknown account',
      date: String(r.date),
      processingDate: str(r.processing_date),
      amountCents: Number(r.amount_cents),
      originalDescription: String(r.original_description),
      cleanDescription: String(r.clean_description),
      payee: str(r.payee),
      categoryId: cat,
      categoryName: cat ? names.get(cat) ?? null : null,
      categoryPath: cat ? paths.get(cat) ?? null : null,
      categorySource: str(r.category_source),
      categoryExplanation: str(r.category_explanation),
      ruleId: str(r.rule_id),
      isTransfer: bool(r.is_transfer),
      transferId: str(r.transfer_id),
      incomeType: (r.income_type as IncomeType) ?? null,
      taxClass: (r.tax_class as TaxClass) ?? null,
      businessUse: (r.business_use as TransactionDTO['businessUse']) ?? null,
      businessPercent: num(r.business_percent),
      gstClass: (r.gst_class as TransactionDTO['gstClass']) ?? null,
      gstCents: num(r.gst_cents),
      isOneOff: bool(r.is_one_off),
      notes: str(r.notes),
      tags: tags.get(String(r.id)) ?? [],
      splits: splits.get(String(r.id)) ?? [],
      importId: str(r.import_id),
      status: r.status as TransactionDTO['status'],
      reviewReasons: json<string[]>(r.review_reasons, []),
      confidence: (r.confidence as TransactionDTO['confidence']) ?? null,
      duplicateOf: str(r.duplicate_of),
      balanceCents: num(r.balance_cents),
      externalId: str(r.external_id),
      reference: str(r.reference),
      documentCount: docs.get(String(r.id)) ?? 0,
      userModified: bool(r.user_modified),
      originalData: json(r.original_data, null),
    };
  });
}

/* ------------------------------ listing & search ------------------------------ */

export interface TxQuery {
  status?: 'posted' | 'staged';
  accountId?: string | null;
  categoryId?: string | null;
  from?: ISODate | null;
  to?: ISODate | null;
  search?: string | null;
  limit?: number;
  offset?: number;
  sort?: 'date-desc' | 'date-asc' | 'amount-asc' | 'amount-desc';
}

export function listTransactions(ctx: Ctx, q: TxQuery): { rows: TransactionDTO[]; total: number; chips: string[]; totalAmountCents: Cents } {
  const where: string[] = ['t.status = ?'];
  const params: (string | number)[] = [q.status ?? 'posted'];
  if (q.accountId) { where.push('t.account_id = ?'); params.push(q.accountId); }
  if (q.from) { where.push('t.date >= ?'); params.push(q.from); }
  if (q.to) { where.push('t.date <= ?'); params.push(q.to); }
  if (q.categoryId) {
    where.push('(t.category_id IN (WITH RECURSIVE d(id) AS (SELECT ? UNION ALL SELECT c.id FROM categories c JOIN d ON c.parent_id = d.id) SELECT id FROM d) OR t.id IN (SELECT transaction_id FROM transaction_splits WHERE category_id = ?))');
    params.push(q.categoryId, q.categoryId);
  }
  const order = { 'date-desc': 't.date DESC, t.created_at DESC', 'date-asc': 't.date ASC, t.created_at ASC', 'amount-asc': 't.amount_cents ASC', 'amount-desc': 't.amount_cents DESC' }[q.sort ?? 'date-desc'];
  let rows = ctx.db.all(`SELECT t.* FROM transactions t WHERE ${where.join(' AND ')} ORDER BY ${order}`, params);
  let chips: string[] = [];
  if (q.search && q.search.trim()) {
    const cats = listCategories(ctx, true);
    const accounts = ctx.db.all('SELECT name FROM accounts').map((a) => String(a.name));
    const parsed = parseSearch(q.search, ctx.today(), cats.map((c) => c.name), accounts);
    chips = parsed.chips;
    const dtos = toDTOs(ctx, rows);
    const byId = new Map(cats.map((c) => [c.id, c]));
    const ancestors = (id: string | null): string[] => {
      const out: string[] = [];
      let cur = id ? byId.get(id) : undefined;
      let guard = 0;
      while (cur && guard++ < 10) {
        out.push(cur.name);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return out;
    };
    const keep = new Set(
      dtos
        .filter((d) => {
          const s: SearchableTx = {
            date: d.date, amountCents: d.amountCents, description: `${d.originalDescription} ${d.cleanDescription}`, payee: d.payee, notes: d.notes,
            categoryName: d.categoryName, categoryPath: [...ancestors(d.categoryId), ...d.splits.flatMap((s) => ancestors(s.categoryId))],
            accountName: d.accountName, tags: d.tags, incomeType: d.incomeType, taxClass: d.taxClass, businessUse: d.businessUse, isOneOff: d.isOneOff, categoryId: d.categoryId,
          };
          return matchesSearch(s, parsed.filter);
        })
        .map((d) => d.id),
    );
    rows = rows.filter((r) => keep.has(String(r.id)));
  }
  const total = rows.length;
  const totalAmount = rows.reduce((a, r) => a + Number(r.amount_cents), 0);
  const page = rows.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 200));
  return { rows: toDTOs(ctx, page), total, chips, totalAmountCents: totalAmount };
}

export function getTransaction(ctx: Ctx, id: string): TransactionDTO {
  const r = ctx.db.get('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!r) throw new UserError('That transaction no longer exists.');
  return toDTOs(ctx, [r])[0];
}

export function transactionHistory(ctx: Ctx, id: string): HistoryDTO[] {
  return ctx.db.all("SELECT * FROM change_history WHERE entity = 'transaction' AND entity_id = ? ORDER BY created_at", [id]).map((r) => ({
    id: String(r.id), field: String(r.field), oldValue: str(r.old_value), newValue: str(r.new_value), reason: str(r.reason), createdAt: String(r.created_at),
  }));
}

/* ------------------------------ categorisation ------------------------------ */

export function loadRules(ctx: Ctx): Rule[] {
  return ctx.db.all('SELECT * FROM rules').map((r) => ({
    id: String(r.id),
    name: str(r.name),
    field: r.field as Rule['field'],
    matchType: r.match_type as Rule['matchType'],
    pattern: String(r.pattern),
    direction: (r.direction as Rule['direction']) ?? 'any',
    amountMinCents: num(r.amount_min_cents),
    amountMaxCents: num(r.amount_max_cents),
    accountId: str(r.account_id),
    categoryId: str(r.category_id),
    incomeType: (r.income_type as IncomeType) ?? null,
    payee: str(r.payee),
    taxClass: str(r.tax_class),
    businessUse: (r.business_use as Rule['businessUse']) ?? null,
    businessPercent: num(r.business_percent),
    tags: json<string[]>(r.tags, []),
    source: r.source as Rule['source'],
    priority: Number(r.priority ?? 0),
    enabled: bool(r.enabled),
  }));
}

function userHistory(ctx: Ctx): HistoryEntry[] {
  return ctx.db.all("SELECT clean_description, category_id FROM transactions WHERE category_source = 'user' AND category_id IS NOT NULL").map((r) => ({ description: String(r.clean_description), categoryId: String(r.category_id) }));
}

export interface Categoriser {
  suggest(subject: RuleSubject): ReturnType<typeof suggestCategory> & { rule: Rule | null };
}

/** Build once per import/batch so rules and history are loaded a single time. */
export function makeCategoriser(ctx: Ctx): Categoriser {
  const rules = loadRules(ctx);
  const byId = new Map(rules.map((r) => [r.id, r]));
  const history = userHistory(ctx);
  return {
    suggest(subject) {
      const s = suggestCategory(subject, rules, history);
      return { ...s, rule: s.ruleId ? byId.get(s.ruleId) ?? null : null };
    },
  };
}

/* ------------------------------ editing ------------------------------ */

export interface TxPatch {
  categoryId?: string | null;
  payee?: string | null;
  cleanDescription?: string;
  notes?: string | null;
  incomeType?: IncomeType | null;
  taxClass?: TaxClass | null;
  businessUse?: TransactionDTO['businessUse'];
  businessPercent?: number | null;
  gstClass?: TransactionDTO['gstClass'];
  gstCents?: number | null;
  isOneOff?: boolean;
  tags?: string[];
  date?: ISODate;
  amountCents?: number;
}

const FIELD_MAP: Record<string, string> = {
  categoryId: 'category_id', payee: 'payee', cleanDescription: 'clean_description', notes: 'notes', incomeType: 'income_type',
  taxClass: 'tax_class', businessUse: 'business_use', businessPercent: 'business_percent', gstClass: 'gst_class', gstCents: 'gst_cents',
  isOneOff: 'is_one_off', date: 'date', amountCents: 'amount_cents',
};

/** Fields whose changes are kept in the local change history. */
const TRACKED = new Set(['categoryId', 'incomeType', 'taxClass', 'businessUse', 'businessPercent', 'gstClass', 'isOneOff', 'payee', 'date', 'amountCents']);

export interface UpdateResult {
  transaction: TransactionDTO;
  ruleSuggestion: RuleSuggestion | null;
  learnedRuleCreated: string | null;
}

function categoryName(ctx: Ctx, id: string | null | undefined): string | null {
  if (!id) return null;
  return ctx.db.scalar<string>('SELECT name FROM categories WHERE id = ?', [id]) ?? id;
}

export function updateTransaction(ctx: Ctx, id: string, patch: TxPatch, reason = 'Changed by you'): UpdateResult {
  const cur = ctx.db.get('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!cur) throw new UserError('That transaction no longer exists.');
  if (patch.businessPercent !== undefined && patch.businessPercent !== null && (patch.businessPercent < 0 || patch.businessPercent > 100)) {
    throw new UserError('Business use must be between 0% and 100%.');
  }
  if (patch.date !== undefined && !isValidDate(patch.date)) throw new UserError('That date is not valid.');
  // Imported amounts come from the statement and stay as imported; only manual entries can change amount.
  if (patch.amountCents !== undefined && cur.import_id && patch.amountCents !== Number(cur.amount_cents)) {
    throw new UserError('Imported amounts cannot be edited. Add a note, split the transaction, or add a manual adjustment instead.');
  }
  if (patch.categoryId) {
    const c = ctx.db.get('SELECT id FROM categories WHERE id = ?', [patch.categoryId]);
    if (!c) throw new UserError('That category no longer exists.');
  }
  let suggestion: RuleSuggestion | null = null;
  let learned: string | null = null;
  ctx.db.tx(() => {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'tags' || !(k in FIELD_MAP)) continue;
      const col = FIELD_MAP[k];
      const value = typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null);
      if (TRACKED.has(k)) {
        const oldVal = k === 'categoryId' ? categoryName(ctx, str(cur[col])) : cur[col];
        const newVal = k === 'categoryId' ? categoryName(ctx, value as string | null) : value;
        recordChange(ctx, 'transaction', id, k, oldVal, newVal, reason);
      }
      sets.push(`${col} = ?`);
      params.push(value ?? null);
    }
    if (patch.categoryId !== undefined) {
      sets.push("category_source = 'user'", 'rule_id = NULL', 'category_explanation = ?');
      params.push('Categorised by you');
      // Choosing an income category sets a matching income type when none is set.
      if (patch.incomeType === undefined && patch.categoryId?.startsWith('income.') && !cur.income_type) {
        const type = (Object.entries(INCOME_CATEGORY_FOR_TYPE).find(([, c]) => c === patch.categoryId)?.[0] ?? null) as IncomeType | null;
        if (type) { sets.push('income_type = ?'); params.push(type); }
      }
    }
    if (sets.length) {
      sets.push('user_modified = 1', 'updated_at = ?');
      params.push(ctx.now(), id);
      ctx.db.run(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    if (patch.tags) setTags(ctx, id, patch.tags);
    if (patch.categoryId && patch.categoryId !== cur.category_id) {
      const s = getSettings(ctx);
      const found = ruleSuggestionsFor(ctx, String(cur.clean_description), patch.categoryId, s.learningThreshold);
      if (found) {
        if (s.autoLearnRules) {
          learned = createRule(ctx, { field: 'description', matchType: 'contains', pattern: found.pattern, categoryId: found.categoryId, source: 'learned', direction: 'any', priority: 0, enabled: true });
          applyRules(ctx, { onlyUncategorised: true, ruleId: learned });
        } else {
          suggestion = found;
        }
      }
    }
  });
  ctx.changed('transactions');
  return { transaction: getTransaction(ctx, id), ruleSuggestion: suggestion, learnedRuleCreated: learned };
}

export function bulkUpdate(ctx: Ctx, ids: string[], patch: TxPatch): { updated: number; ruleSuggestion: RuleSuggestion | null } {
  let last: UpdateResult | null = null;
  ctx.db.tx(() => {
    for (const id of ids) last = updateTransaction(ctx, id, patch, 'Changed by you (several at once)');
  });
  return { updated: ids.length, ruleSuggestion: (last as UpdateResult | null)?.ruleSuggestion ?? null };
}

export function setTags(ctx: Ctx, txId: string, tags: string[]): void {
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  ctx.db.run('DELETE FROM transaction_tags WHERE transaction_id = ?', [txId]);
  for (const t of clean) {
    let tagId = ctx.db.scalar<string>('SELECT id FROM tags WHERE name = ?', [t]);
    if (!tagId) {
      tagId = ctx.id();
      ctx.db.run('INSERT INTO tags(id, name) VALUES(?, ?)', [tagId, t]);
    }
    ctx.db.run('INSERT OR IGNORE INTO transaction_tags(transaction_id, tag_id) VALUES(?, ?)', [txId, tagId]);
  }
}

export function listTags(ctx: Ctx): { name: string; count: number }[] {
  return ctx.db.all('SELECT g.name, COUNT(tt.transaction_id) AS n FROM tags g LEFT JOIN transaction_tags tt ON tt.tag_id = g.id GROUP BY g.id ORDER BY g.name').map((r) => ({ name: String(r.name), count: Number(r.n) }));
}

/** Split one transaction across categories. Parts must add up to the original amount. */
export function setSplits(ctx: Ctx, txId: string, parts: { categoryId: string | null; amountCents: number; note?: string | null }[]): TransactionDTO {
  const cur = ctx.db.get('SELECT amount_cents FROM transactions WHERE id = ?', [txId]);
  if (!cur) throw new UserError('That transaction no longer exists.');
  const total = Number(cur.amount_cents);
  if (parts.length === 1) throw new UserError('A split needs at least two parts. To use one category, remove the split.');
  if (parts.length) {
    const sum = parts.reduce((a, p) => a + p.amountCents, 0);
    if (sum !== total) throw new UserError(`The parts add up to ${(sum / 100).toFixed(2)} but the transaction is ${(total / 100).toFixed(2)}.`);
    if (parts.some((p) => Math.sign(p.amountCents) !== Math.sign(total) && p.amountCents !== 0)) throw new UserError('Each part must be money in or money out, the same as the transaction.');
  }
  ctx.db.tx(() => {
    const before = ctx.db.all('SELECT category_id, amount_cents FROM transaction_splits WHERE transaction_id = ?', [txId]);
    ctx.db.run('DELETE FROM transaction_splits WHERE transaction_id = ?', [txId]);
    for (const p of parts) ctx.db.run('INSERT INTO transaction_splits(id, transaction_id, category_id, amount_cents, note) VALUES(?,?,?,?,?)', [ctx.id(), txId, p.categoryId, p.amountCents, p.note ?? null]);
    const describe = (list: { category_id?: unknown; categoryId?: unknown; amount_cents?: unknown; amountCents?: unknown }[]) =>
      list.map((p) => `${categoryName(ctx, String(p.category_id ?? p.categoryId ?? '')) ?? 'Uncategorised'} ${(Number(p.amount_cents ?? p.amountCents) / 100).toFixed(2)}`).join('; ') || null;
    recordChange(ctx, 'transaction', txId, 'splits', describe(before), describe(parts), 'Split changed by you');
    ctx.db.run('UPDATE transactions SET user_modified = 1, updated_at = ? WHERE id = ?', [ctx.now(), txId]);
  });
  ctx.changed('transactions');
  return getTransaction(ctx, txId);
}

export interface ManualTxInput {
  accountId: string;
  date: ISODate;
  amountCents: number;
  description: string;
  categoryId?: string | null;
  notes?: string | null;
}

export function addManualTransaction(ctx: Ctx, t: ManualTxInput): TransactionDTO {
  if (!ctx.db.get('SELECT id FROM accounts WHERE id = ?', [t.accountId])) throw new UserError('Choose an account.');
  if (!isValidDate(t.date)) throw new UserError('Enter a valid date.');
  if (!t.description.trim()) throw new UserError('Enter a description.');
  if (!Number.isSafeInteger(t.amountCents) || t.amountCents === 0) throw new UserError('Enter an amount.');
  const id = ctx.id();
  const now = ctx.now();
  const categoriser = makeCategoriser(ctx);
  const s = t.categoryId ? null : categoriser.suggest({ description: t.description, amountCents: t.amountCents, accountId: t.accountId });
  ctx.db.run(
    `INSERT INTO transactions(id, account_id, date, amount_cents, original_description, clean_description, payee, category_id, category_source, rule_id,
      category_explanation, income_type, notes, status, confidence, original_data, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?, 'posted', 'high', ?, ?, ?)`,
    [id, t.accountId, t.date, t.amountCents, t.description.trim(), cleanDescription(t.description), guessPayee(t.description),
      t.categoryId ?? s?.categoryId ?? null, t.categoryId ? 'user' : s?.categoryId ? s.source : null, s?.ruleId ?? null,
      t.categoryId ? 'Categorised by you' : s?.explanation ?? null, s?.incomeType ?? null, t.notes ?? null, JSON.stringify({ source: 'manual entry' }), now, now],
  );
  recordChange(ctx, 'transaction', id, 'created', null, 'Entered manually', 'Manual entry');
  ctx.changed('transactions');
  return getTransaction(ctx, id);
}

export function deleteTransaction(ctx: Ctx, id: string): void {
  ctx.db.tx(() => {
    const t = ctx.db.get('SELECT transfer_id FROM transactions WHERE id = ?', [id]);
    if (t?.transfer_id) unlinkTransfer(ctx, String(t.transfer_id));
    ctx.db.run("DELETE FROM document_links WHERE entity = 'transaction' AND entity_id = ?", [id]);
    ctx.db.run('DELETE FROM transactions WHERE id = ?', [id]);
    recordChange(ctx, 'transaction', id, 'deleted', 'present', 'deleted', 'Deleted by you');
  });
  ctx.changed('transactions');
}

/* ------------------------------ rules ------------------------------ */

export function listRules(ctx: Ctx): (Rule & { description: string; hitCount: number; categoryName: string | null })[] {
  const hits = new Map(ctx.db.all('SELECT id, hit_count FROM rules').map((r) => [String(r.id), Number(r.hit_count)]));
  return loadRules(ctx)
    .map((r) => ({ ...r, description: describeRule(r), hitCount: hits.get(r.id) ?? 0, categoryName: categoryName(ctx, r.categoryId) }))
    .sort((a, b) => ({ user: 0, learned: 1, default: 2 }[a.source] - { user: 0, learned: 1, default: 2 }[b.source]) || a.pattern.localeCompare(b.pattern));
}

export function createRule(ctx: Ctx, r: Omit<Rule, 'id'> & { id?: string }): string {
  if (!r.pattern.trim()) throw new UserError('A rule needs something to match.');
  if (r.matchType === 'regex') {
    const err = validateRegex(r.pattern);
    if (err) throw new UserError(err);
  }
  if (!r.categoryId && !r.incomeType && !r.payee && !r.taxClass && !r.businessUse && !(r.tags ?? []).length) throw new UserError('A rule needs something to do — for example set a category.');
  const id = r.id ?? ctx.id();
  ctx.db.run(
    `INSERT INTO rules(id, name, field, match_type, pattern, direction, amount_min_cents, amount_max_cents, account_id, category_id, income_type, payee,
      tax_class, business_use, business_percent, tags, source, priority, enabled, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, field=excluded.field, match_type=excluded.match_type, pattern=excluded.pattern,
      direction=excluded.direction, amount_min_cents=excluded.amount_min_cents, amount_max_cents=excluded.amount_max_cents,
      account_id=excluded.account_id, category_id=excluded.category_id, income_type=excluded.income_type, payee=excluded.payee,
      tax_class=excluded.tax_class, business_use=excluded.business_use, business_percent=excluded.business_percent, tags=excluded.tags,
      priority=excluded.priority, enabled=excluded.enabled`,
    [id, r.name ?? null, r.field, r.matchType, r.pattern.trim(), r.direction ?? 'any', r.amountMinCents ?? null, r.amountMaxCents ?? null, r.accountId ?? null,
      r.categoryId ?? null, r.incomeType ?? null, r.payee ?? null, r.taxClass ?? null, r.businessUse ?? null, r.businessPercent ?? null,
      JSON.stringify(r.tags ?? []), r.source, r.priority ?? 0, r.enabled === false ? 0 : 1, ctx.now()],
  );
  recordChange(ctx, 'rule', id, 'saved', null, `${describeRule({ ...r, id } as Rule)} → ${categoryName(ctx, r.categoryId) ?? 'no category'}`, r.source === 'learned' ? 'Rule learned from your corrections' : 'Rule saved by you');
  ctx.changed('rules');
  return id;
}

export function setRuleEnabled(ctx: Ctx, id: string, enabled: boolean): void {
  ctx.db.run('UPDATE rules SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  recordChange(ctx, 'rule', id, 'enabled', !enabled, enabled, 'Changed by you');
  ctx.changed('rules');
}

export function deleteRule(ctx: Ctx, id: string): void {
  const r = ctx.db.get('SELECT source FROM rules WHERE id = ?', [id]);
  if (!r) return;
  // Built-in rules are switched off rather than deleted, so an update does not bring them back.
  if (r.source === 'default') ctx.db.run('UPDATE rules SET enabled = 0 WHERE id = ?', [id]);
  else ctx.db.run('DELETE FROM rules WHERE id = ?', [id]);
  recordChange(ctx, 'rule', id, 'deleted', 'present', r.source === 'default' ? 'disabled' : 'deleted', 'Removed by you');
  ctx.changed('rules');
}

/**
 * Re-run rules over existing transactions. Never overrides a category the user chose by hand.
 * With `onlyUncategorised`, only transactions without a category are touched.
 */
export function applyRules(ctx: Ctx, opts: { onlyUncategorised?: boolean; ruleId?: string; includeStaged?: boolean } = {}): { updated: number } {
  const categoriser = makeCategoriser(ctx);
  const rows = ctx.db.all(`SELECT id, clean_description, original_description, amount_cents, account_id, category_id, category_source, income_type FROM transactions
    WHERE (category_source IS NULL OR category_source <> 'user') AND is_transfer = 0 ${opts.includeStaged ? '' : "AND status = 'posted'"}
    ${opts.onlyUncategorised ? 'AND category_id IS NULL' : ''}`);
  let updated = 0;
  ctx.db.tx(() => {
    for (const r of rows) {
      const s = categoriser.suggest({ description: String(r.original_description), amountCents: Number(r.amount_cents), accountId: String(r.account_id) });
      if (!s.rule || !s.categoryId || (opts.ruleId && s.rule.id !== opts.ruleId)) continue;
      if (s.categoryId === r.category_id) continue;
      recordChange(ctx, 'transaction', String(r.id), 'categoryId', categoryName(ctx, str(r.category_id)), categoryName(ctx, s.categoryId), s.explanation);
      ctx.db.run(`UPDATE transactions SET category_id = ?, category_source = 'rule', rule_id = ?, category_explanation = ?, income_type = COALESCE(income_type, ?), updated_at = ? WHERE id = ?`,
        [s.categoryId, s.rule.id, s.explanation, s.incomeType, ctx.now(), String(r.id)]);
      ctx.db.run('UPDATE rules SET hit_count = hit_count + 1 WHERE id = ?', [s.rule.id]);
      updated++;
    }
  });
  if (updated) ctx.changed('transactions');
  return { updated };
}

/* ------------------------------ learning ------------------------------ */

/** One entry per transaction the user re-categorised by hand (latest change only). */
function corrections(ctx: Ctx): CategoryCorrection[] {
  return ctx.db.all(`SELECT MAX(h.created_at) AS at, t.clean_description, t.category_id FROM change_history h JOIN transactions t ON t.id = h.entity_id
    WHERE h.entity = 'transaction' AND h.field = 'categoryId' AND t.category_source = 'user' AND t.category_id IS NOT NULL
      AND (h.reason LIKE 'Changed by you%' OR h.reason LIKE 'Chosen%')
    GROUP BY t.id`).map((r) => ({
    description: String(r.clean_description), fromCategoryId: null, toCategoryId: String(r.category_id), at: String(r.at),
  }));
}

function dismissedKeys(ctx: Ctx): string[] {
  return ctx.db.all("SELECT key FROM dismissed WHERE key LIKE 'rule:%'").map((r) => String(r.key).slice(5));
}

export function ruleSuggestions(ctx: Ctx): (RuleSuggestion & { categoryName: string | null; message: string })[] {
  const s = getSettings(ctx);
  return suggestRules(corrections(ctx), loadRules(ctx), { threshold: s.learningThreshold, dismissedKeys: dismissedKeys(ctx) }).map((x) => ({
    ...x,
    categoryName: categoryName(ctx, x.categoryId),
    message: `Always categorise transactions containing "${x.pattern}" as ${categoryName(ctx, x.categoryId)}?`,
  }));
}

function ruleSuggestionsFor(ctx: Ctx, description: string, categoryId: string, threshold: number): RuleSuggestion | null {
  const key = merchantKey(description);
  const all = suggestRules(corrections(ctx), loadRules(ctx), { threshold, dismissedKeys: dismissedKeys(ctx) });
  return all.find((s) => s.key === key && s.categoryId === categoryId) ?? null;
}

export function acceptRuleSuggestion(ctx: Ctx, pattern: string, categoryId: string, applyToExisting: boolean): { ruleId: string; updated: number } {
  const ruleId = createRule(ctx, { field: 'description', matchType: 'contains', pattern, categoryId, source: 'learned', direction: 'any', priority: 0, enabled: true });
  const { updated } = applyToExisting ? applyRules(ctx, { ruleId, onlyUncategorised: false }) : { updated: 0 };
  return { ruleId, updated };
}

export function dismissRuleSuggestion(ctx: Ctx, key: string, categoryId: string): void {
  ctx.db.run('INSERT OR IGNORE INTO dismissed(key, created_at) VALUES(?, ?)', [`rule:${key}→${categoryId}`, ctx.now()]);
}

/* ------------------------------ transfers ------------------------------ */

export function transferSuggestions(ctx: Ctx, sinceDays = 400): (TransferSuggestion & { out: TransactionDTO; in: TransactionDTO })[] {
  const since = addDays(ctx.today(), -sinceDays);
  const rows = ctx.db.all(`SELECT * FROM transactions WHERE is_transfer = 0 AND transfer_id IS NULL AND date >= ? AND id NOT IN (SELECT transaction_id FROM transaction_splits)`, [since]);
  const dismissed = new Set(ctx.db.all("SELECT key FROM dismissed WHERE key LIKE 'transfer:%'").map((r) => String(r.key)));
  const pairs = findTransferPairs(rows.map((r) => ({
    id: String(r.id), accountId: String(r.account_id), date: String(r.date), amountCents: Number(r.amount_cents), description: String(r.original_description),
    isTransferCategory: String(r.category_id ?? '').startsWith('transfers'),
  }))).filter((p) => !dismissed.has(`transfer:${p.outId}:${p.inId}`));
  const byId = new Map(toDTOs(ctx, rows).map((d) => [d.id, d]));
  return pairs.map((p) => ({ ...p, out: byId.get(p.outId)!, in: byId.get(p.inId)! }));
}

export function linkTransfer(ctx: Ctx, outId: string, inId: string | null, note: string | null = null): string {
  const out = ctx.db.get('SELECT * FROM transactions WHERE id = ?', [outId]);
  const inn = inId ? ctx.db.get('SELECT * FROM transactions WHERE id = ?', [inId]) : null;
  if (!out || (inId && !inn)) throw new UserError('One of those transactions no longer exists.');
  if (inn) {
    if (Number(out.amount_cents) !== -Number(inn.amount_cents)) throw new UserError('A transfer pair must be the same amount, out of one account and into another.');
    if (out.account_id === inn.account_id) throw new UserError('Both sides of a transfer are in the same account.');
  }
  const [o, i] = Number(out.amount_cents) < 0 ? [out, inn] : [inn ?? out, inn ? out : null];
  const id = ctx.id();
  ctx.db.tx(() => {
    ctx.db.run('INSERT INTO transfers(id, out_tx_id, in_tx_id, status, note, created_at) VALUES(?,?,?,?,?,?)', [id, String(o!.id), i ? String(i.id) : null, 'confirmed', note, ctx.now()]);
    for (const t of [o, i]) {
      if (!t) continue;
      const cat = String(t.category_id ?? '').startsWith('transfers') ? String(t.category_id) : 'transfers.internal';
      recordChange(ctx, 'transaction', String(t.id), 'transfer', null, i ? 'Linked as transfer between your accounts' : 'Marked as transfer to an account not tracked here', 'Changed by you');
      ctx.db.run("UPDATE transactions SET is_transfer = 1, transfer_id = ?, category_id = ?, category_source = 'user', category_explanation = ?, updated_at = ? WHERE id = ?",
        [id, cat, 'Transfer between your own accounts (not income or spending)', ctx.now(), String(t.id)]);
    }
  });
  ctx.changed('transactions');
  return id;
}

export function unlinkTransfer(ctx: Ctx, transferId: string): void {
  const t = ctx.db.get('SELECT * FROM transfers WHERE id = ?', [transferId]);
  if (!t) return;
  ctx.db.tx(() => {
    for (const txId of [t.out_tx_id, t.in_tx_id]) {
      if (!txId) continue;
      recordChange(ctx, 'transaction', String(txId), 'transfer', 'Linked as transfer', 'Unlinked', 'Changed by you');
      ctx.db.run("UPDATE transactions SET is_transfer = 0, transfer_id = NULL, category_id = NULL, category_source = NULL, category_explanation = 'Transfer link removed — please choose a category', updated_at = ? WHERE id = ?", [ctx.now(), String(txId)]);
    }
    ctx.db.run('DELETE FROM transfers WHERE id = ?', [transferId]);
  });
  ctx.changed('transactions');
}

export function dismissTransferSuggestion(ctx: Ctx, outId: string, inId: string): void {
  ctx.db.run('INSERT OR IGNORE INTO dismissed(key, created_at) VALUES(?, ?)', [`transfer:${outId}:${inId}`, ctx.now()]);
}
