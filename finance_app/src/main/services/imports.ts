import { Ctx, UserError, addBalance, getSettings, json, str, recordChange, bool, listCategories } from './core';
import { makeCategoriser, toDTOs } from './transactions';
import { sha256 } from '../crypto/crypto';
import { extractPdfText } from '../import/pdfExtract';
import { ISODate, addDays } from '../../domain/dates';
import { isLiability, AccountType } from '../../domain/accounts';
import { ColumnKind, ColumnMapping, applyMapping, detectMapping, mappingFromKinds, mappingKinds, readDelimited } from '../../domain/import/csv';
import { DateFormat } from '../../domain/import/dateFormats';
import { isOfx, parseOfx } from '../../domain/import/ofx';
import { isQif, parseQif } from '../../domain/import/qif';
import { readSpreadsheet, SheetTable } from '../../domain/import/spreadsheet';
import { PdfTextPage, parsePdfStatement } from '../../domain/import/pdfStatement';
import { ImportFormat, ParsedStatement, lowestConfidence } from '../../domain/import/types';
import { findDuplicates } from '../../domain/import/duplicates';
import { reconcile } from '../../domain/import/reconcile';
import { cleanDescription, guessPayee } from '../../domain/categorise/clean';
import { findTransferPairs } from '../../domain/transfers';
import { ImportPreviewRow, ImportSession, ReconciliationDTO, TransactionDTO } from '../../shared/types';
import { DocumentStore, addDocument } from './documents';

/* ------------------------------ sessions ------------------------------ */

interface Session {
  id: string;
  fileName: string;
  bytes: Uint8Array;
  sha256: string;
  format: ImportFormat;
  sheets: SheetTable[];
  selectedSheet: string | null;
  rows: string[][] | null;
  mapping: ColumnMapping | null;
  detection: ReturnType<typeof detectMapping> | null;
  statements: ParsedStatement[];
  pdfPages: PdfTextPage[] | null;
  profileId: string | null;
  needsMapping: boolean;
  createdAt: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 60 * 60 * 1000;

function prune() {
  const now = Date.now();
  for (const [k, s] of sessions) if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(k);
}

function session(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new UserError('This import has expired. Please choose the file again.');
  return s;
}

export function discardImport(id: string): void {
  sessions.delete(id);
}

/** Keep the original statement file (encrypted) as a source record linked to the import. */
export function keepSourceFile(ctx: Ctx, store: DocumentStore, sessionId: string): string {
  const s = session(sessionId);
  return addDocument(ctx, store, { fileName: s.fileName, bytes: s.bytes, kind: 'bank-statement', notes: 'Original file kept at import' });
}

export function detectFormat(fileName: string, bytes: Uint8Array): ImportFormat {
  const head = Buffer.from(bytes.subarray(0, 2048)).toString('latin1');
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (head.startsWith('%PDF')) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx';
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'xls';
  if (isOfx(head)) return ext === 'qfx' ? 'qfx' : 'ofx';
  if (isQif(head)) return 'qif';
  if (['xlsx', 'xls'].includes(ext)) return ext as ImportFormat;
  return 'csv';
}

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // Fall back to Windows-1252 when the file is clearly not UTF-8 (common for older bank exports).
  if (utf8.includes('�')) return new TextDecoder('windows-1252').decode(bytes);
  return utf8;
}

function findProfile(ctx: Ctx, signature: string, format: ImportFormat) {
  const r = ctx.db.get('SELECT * FROM import_profiles WHERE signature = ? AND format IN (?, ?) ORDER BY last_used_at DESC', [signature, format, format === 'csv' ? 'xlsx' : 'csv']);
  return r ? { id: String(r.id), name: String(r.name), mapping: json<ColumnMapping | null>(r.mapping, null), accountId: str(r.account_id) } : null;
}

function suggestAccount(ctx: Ctx, st: ParsedStatement, profileAccount: string | null): string | null {
  if (profileAccount && ctx.db.get("SELECT id FROM accounts WHERE id = ? AND status <> 'archived'", [profileAccount])) return profileAccount;
  const num = st.account?.number?.replace(/\D/g, '');
  if (num && num.length >= 4) {
    const last4 = num.slice(-4);
    const r = ctx.db.get("SELECT id FROM accounts WHERE number_masked LIKE ? AND status <> 'archived'", [`%${last4}`]);
    if (r) return String(r.id);
  }
  return null;
}

function summarise(ctx: Ctx, s: Session): ImportSession {
  const profile = s.profileId ? ctx.db.get('SELECT id, name, account_id FROM import_profiles WHERE id = ?', [s.profileId]) : null;
  const prior = ctx.db.get('SELECT id, imported_at FROM imports WHERE file_sha256 = ? ORDER BY imported_at DESC', [s.sha256]);
  return {
    sessionId: s.id,
    fileName: s.fileName,
    format: s.format,
    sheetNames: s.sheets.map((x) => x.name),
    selectedSheet: s.selectedSheet,
    needsMapping: !!s.rows && (s.needsMapping || s.statements.length === 0),
    mapping: s.mapping,
    mappingQuestions: s.detection?.questions ?? [],
    mappingNotes: s.detection?.notes ?? [],
    headers: s.detection?.headers ?? [],
    sampleRows: s.detection?.sampleRows ?? [],
    profileMatch: profile ? { id: String(profile.id), name: String(profile.name) } : null,
    statements: s.statements.map((st, index) => ({
      index,
      accountHint: st.account ?? null,
      periodStart: st.periodStart ?? null,
      periodEnd: st.periodEnd ?? null,
      openingBalanceCents: st.openingBalanceCents ?? null,
      closingBalanceCents: st.closingBalanceCents ?? null,
      openingBalanceDerived: !!st.openingBalanceDerived,
      warnings: st.warnings,
      rejectedRows: st.rejectedRows,
      ocrRequired: !!st.ocrRequired,
      confidence: st.confidence,
      suggestedAccountId: suggestAccount(ctx, st, profile ? str(profile.account_id) : null),
      transactionCount: st.transactions.length,
    })),
    alreadyImported: prior ? { importId: String(prior.id), importedAt: String(prior.imported_at) } : null,
  };
}

function useTable(ctx: Ctx, s: Session, rows: string[][]) {
  s.rows = rows;
  s.detection = detectMapping(rows);
  const profile = findProfile(ctx, s.detection.signature, s.format);
  s.statements = [];
  if (profile?.mapping) {
    s.profileId = profile.id;
    s.mapping = profile.mapping;
    s.needsMapping = false;
  } else {
    s.profileId = null;
    s.mapping = s.detection.mapping;
    // Unknown layouts are always shown on the mapping screen when something needs confirming.
    s.needsMapping = !s.mapping || s.detection.questions.length > 0;
  }
  if (s.mapping) s.statements = [applyMapping(rows, s.mapping, s.format)];
}

/** Read a chosen file and work out what it contains. Nothing is saved yet. */
export async function openImport(ctx: Ctx, fileName: string, bytes: Uint8Array): Promise<ImportSession> {
  prune();
  if (bytes.byteLength === 0) throw new UserError('This file is empty.');
  if (bytes.byteLength > 50 * 1024 * 1024) throw new UserError('This file is larger than 50 MB. Please split it or export a shorter date range.');
  const format = detectFormat(fileName, bytes);
  const s: Session = {
    id: ctx.id(), fileName, bytes, sha256: sha256(bytes), format, sheets: [], selectedSheet: null, rows: null, mapping: null,
    detection: null, statements: [], pdfPages: null, profileId: null, needsMapping: false, createdAt: Date.now(),
  };
  switch (format) {
    case 'ofx':
    case 'qfx':
      s.statements = parseOfx(decodeText(bytes), format);
      break;
    case 'qif':
      s.statements = parseQif(decodeText(bytes));
      break;
    case 'pdf': {
      const { pages } = await extractPdfText(bytes);
      s.pdfPages = pages;
      s.statements = [parsePdfStatement(pages)];
      break;
    }
    case 'xlsx':
    case 'xls': {
      s.sheets = readSpreadsheet(bytes);
      if (!s.sheets.length) throw new UserError('No data was found in this spreadsheet.');
      s.selectedSheet = s.sheets[0].name;
      useTable(ctx, s, s.sheets[0].rows);
      break;
    }
    default: {
      const rows = readDelimited(decodeText(bytes));
      if (rows.length < 1) throw new UserError('No rows were found in this file.');
      useTable(ctx, s, rows);
    }
  }
  sessions.set(s.id, s);
  return summarise(ctx, s);
}

export function chooseSheet(ctx: Ctx, sessionId: string, sheet: string): ImportSession {
  const s = session(sessionId);
  const t = s.sheets.find((x) => x.name === sheet);
  if (!t) throw new UserError('That worksheet was not found.');
  s.selectedSheet = sheet;
  useTable(ctx, s, t.rows);
  return summarise(ctx, s);
}

export interface MappingInput {
  kinds: ColumnKind[];
  headerRow: number | null;
  firstDataRow: number;
  dateFormat: DateFormat;
  positiveIsCredit: boolean;
}

/** Apply the column mapping chosen or confirmed on the mapping screen. */
export function applyImportMapping(ctx: Ctx, sessionId: string, input: MappingInput): ImportSession {
  const s = session(sessionId);
  if (!s.rows) throw new UserError('This file does not use a column mapping.');
  const mapping = mappingFromKinds(input.kinds, { headerRow: input.headerRow, firstDataRow: input.firstDataRow, dateFormat: input.dateFormat, positiveIsCredit: input.positiveIsCredit });
  const st = applyMapping(s.rows, mapping, s.format);
  if (st.transactions.length === 0) throw new UserError('No transactions could be read with this mapping. Check the date and amount columns.');
  s.mapping = mapping;
  s.statements = [st];
  s.needsMapping = false;
  return summarise(ctx, s);
}

export function currentMappingKinds(sessionId: string): ColumnKind[] {
  const s = session(sessionId);
  if (!s.mapping || !s.detection) return [];
  return mappingKinds(s.mapping, s.detection.columnCount);
}

/* ------------------------------ preview ------------------------------ */

function statementFor(ctx: Ctx, s: Session, index: number, accountId: string): ParsedStatement {
  const acc = ctx.db.get('SELECT type FROM accounts WHERE id = ?', [accountId]);
  if (!acc) throw new UserError('Choose which account this statement belongs to.');
  if (s.format === 'pdf' && s.pdfPages) {
    // Card and loan statements print the amount owed as the balance.
    return parsePdfStatement(s.pdfPages, { balanceMeaning: isLiability(acc.type as AccountType) ? 'liability' : 'asset' });
  }
  const st = s.statements[index];
  if (!st) throw new UserError('That statement was not found in the file.');
  return st;
}

export interface PreviewResult {
  rows: ImportPreviewRow[];
  reconciliation: ReconciliationDTO;
  counts: { total: number; duplicates: number; possibleDuplicates: number; toStage: number; toPost: number; lowConfidence: number };
}

export function previewImport(ctx: Ctx, sessionId: string, statementIndex: number, accountId: string, balances?: { openingCents: number | null; closingCents: number | null }): PreviewResult {
  const s = session(sessionId);
  const st = statementFor(ctx, s, statementIndex, accountId);
  const settings = getSettings(ctx);
  const txs = st.transactions;
  if (!txs.length) {
    return { rows: [], reconciliation: reconcile({ openingCents: null, closingCents: null, transactions: [] }), counts: { total: 0, duplicates: 0, possibleDuplicates: 0, toStage: 0, toPost: 0, lowConfidence: 0 } };
  }
  const dates = txs.map((t) => t.date).sort();
  const existing = ctx.db.all('SELECT id, date, processing_date, amount_cents, original_description, external_id, balance_cents, reference FROM transactions WHERE account_id = ? AND date BETWEEN ? AND ?',
    [accountId, addDays(dates[0], -5), addDays(dates[dates.length - 1], 5)]).map((r) => ({
    id: String(r.id), date: String(r.date), processingDate: str(r.processing_date), amountCents: Number(r.amount_cents), description: String(r.original_description),
    externalId: str(r.external_id), balanceCents: r.balance_cents === null ? null : Number(r.balance_cents), reference: str(r.reference),
  }));
  const dups = findDuplicates(txs, existing);
  const categoriser = makeCategoriser(ctx);
  const names = new Map(listCategories(ctx, true).map((c) => [c.id, c.name]));

  // Possible transfers: matching opposite amounts in other accounts around the same dates.
  const others = ctx.db.all('SELECT id, account_id, date, amount_cents, original_description, category_id FROM transactions WHERE account_id <> ? AND is_transfer = 0 AND date BETWEEN ? AND ?',
    [accountId, addDays(dates[0], -4), addDays(dates[dates.length - 1], 4)]);
  const pairs = findTransferPairs([
    ...txs.map((t, i) => ({ id: `new:${i}`, accountId, date: t.date, amountCents: t.amountCents, description: t.description })),
    ...others.map((r) => ({ id: String(r.id), accountId: String(r.account_id), date: String(r.date), amountCents: Number(r.amount_cents), description: String(r.original_description), isTransferCategory: String(r.category_id ?? '').startsWith('transfers') })),
  ]);
  const transferNew = new Set(pairs.flatMap((p) => [p.outId, p.inId]).filter((x) => x.startsWith('new:')));

  const rows: ImportPreviewRow[] = txs.map((t, i) => {
    const cat = categoriser.suggest({ description: t.description, amountCents: t.amountCents, accountId });
    const d = dups[i];
    const stageReasons: string[] = [];
    if (settings.staging.lowConfidence && t.confidence !== 'high') stageReasons.push(...(t.issues.length ? t.issues : ['The file reader was not fully sure about this row']));
    if (st.ocrRequired) stageReasons.push('Read with text recognition (OCR) — please check');
    if (settings.staging.allPdf && s.format === 'pdf' && !stageReasons.length) stageReasons.push('Read from a PDF statement — please confirm');
    if (settings.staging.duplicates && d.status === 'possible-duplicate') stageReasons.push(`Possible duplicate of a transaction already imported (${d.reasons.join(', ')})`);
    if (settings.staging.transfers && transferNew.has(`new:${i}`)) stageReasons.push('Could be a transfer between your own accounts');
    if (settings.staging.lowConfidence && cat.confidence === 'low') stageReasons.push(cat.alternatives.length > 1 ? 'Could belong to several categories' : 'No confident category');
    return {
      index: i,
      date: t.date,
      processingDate: t.processingDate ?? null,
      amountCents: t.amountCents,
      description: t.description,
      balanceCents: t.balanceCents ?? null,
      confidence: t.confidence,
      issues: t.issues,
      duplicate: { status: d.status, matchId: d.matchId, reasons: d.reasons },
      suggestedCategoryId: cat.categoryId,
      suggestedCategoryName: cat.categoryId ? names.get(cat.categoryId) ?? null : null,
      categoryConfidence: cat.confidence,
      categoryExplanation: cat.explanation,
      include: d.status !== 'duplicate',
      willStage: stageReasons.length > 0,
      stageReasons,
    };
  });
  const rec = reconcile({
    openingCents: balances?.openingCents ?? st.openingBalanceCents,
    closingCents: balances?.closingCents ?? st.closingBalanceCents,
    openingDerived: balances?.openingCents != null ? false : st.openingBalanceDerived,
    transactions: txs,
  });
  return {
    rows,
    reconciliation: rec,
    counts: {
      total: rows.length,
      duplicates: rows.filter((r) => r.duplicate.status === 'duplicate').length,
      possibleDuplicates: rows.filter((r) => r.duplicate.status === 'possible-duplicate').length,
      toStage: rows.filter((r) => r.include && r.willStage).length,
      toPost: rows.filter((r) => r.include && !r.willStage).length,
      lowConfidence: rows.filter((r) => r.confidence !== 'high').length,
    },
  };
}

/* ------------------------------ commit ------------------------------ */

export interface CommitInput {
  sessionId: string;
  statementIndex: number;
  accountId: string;
  rows: { index: number; include: boolean; categoryId?: string | null; amountCents?: number; date?: ISODate; description?: string; forceStage?: boolean }[];
  saveProfileName?: string | null;
  sourceDocumentId?: string | null;
  openingCents?: number | null;
  closingCents?: number | null;
}

export interface CommitResult {
  importId: string;
  added: number;
  staged: number;
  skippedDuplicates: number;
  rejectedRows: number;
  reconciliation: ReconciliationDTO;
}

export function commitImport(ctx: Ctx, input: CommitInput): CommitResult {
  const s = session(input.sessionId);
  const st = statementFor(ctx, s, input.statementIndex, input.accountId);
  const preview = previewImport(ctx, input.sessionId, input.statementIndex, input.accountId, { openingCents: input.openingCents ?? null, closingCents: input.closingCents ?? null });
  const decisions = new Map(input.rows.map((r) => [r.index, r]));
  const importId = ctx.id();
  const now = ctx.now();
  const categoriser = makeCategoriser(ctx);
  let added = 0, staged = 0, skipped = 0;

  // Corrections made on the review screen are applied before reconciling.
  const finalTx = st.transactions.map((t, i) => {
    const d = decisions.get(i);
    return { ...t, amountCents: d?.amountCents ?? t.amountCents, date: d?.date ?? t.date, description: d?.description ?? t.description };
  });
  const included = finalTx.filter((_, i) => decisions.get(i)?.include ?? preview.rows[i].include);
  const rec = reconcile({
    openingCents: input.openingCents ?? st.openingBalanceCents,
    closingCents: input.closingCents ?? st.closingBalanceCents,
    openingDerived: input.openingCents != null ? false : st.openingBalanceDerived,
    // Reconcile against everything on the statement, including rows already imported earlier.
    transactions: finalTx,
  });

  ctx.db.tx(() => {
    let profileId = s.profileId;
    if (input.saveProfileName && s.mapping) {
      const sig = s.detection?.signature ?? '';
      profileId = profileId ?? ctx.id();
      ctx.db.run(`INSERT INTO import_profiles(id, name, format, signature, mapping, account_id, created_at, last_used_at) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, mapping = excluded.mapping, account_id = excluded.account_id, last_used_at = excluded.last_used_at`,
        [profileId, input.saveProfileName.trim(), s.format === 'xls' || s.format === 'xlsx' ? 'xlsx' : 'csv', sig, JSON.stringify(s.mapping), input.accountId, now, now]);
    } else if (profileId) {
      ctx.db.run('UPDATE import_profiles SET last_used_at = ? WHERE id = ?', [now, profileId]);
    }
    ctx.db.run(`INSERT INTO imports(id, account_id, file_name, file_sha256, format, profile_id, document_id, imported_at, period_start, period_end,
        opening_balance_cents, closing_balance_cents, reconciliation, row_count, rejected_count, rejected, warnings, ocr_required)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [importId, input.accountId, s.fileName, s.sha256, s.format, profileId, input.sourceDocumentId ?? null, now, st.periodStart ?? null, st.periodEnd ?? null,
        rec.openingCents, rec.closingCents, JSON.stringify(rec), st.transactions.length, st.rejectedRows.length, JSON.stringify(st.rejectedRows), JSON.stringify(st.warnings), st.ocrRequired ? 1 : 0]);
    if (input.sourceDocumentId) ctx.db.run("INSERT OR IGNORE INTO document_links(document_id, entity, entity_id) VALUES(?, 'import', ?)", [input.sourceDocumentId, importId]);

    st.transactions.forEach((orig, i) => {
      const p = preview.rows[i];
      const d = decisions.get(i);
      const include = d?.include ?? p.include;
      if (!include) {
        if (p.duplicate.status === 'duplicate') skipped++;
        return;
      }
      const t = finalTx[i];
      const corrected = !!d && (d.amountCents !== undefined || d.date !== undefined || d.description !== undefined);
      const reasons = [...p.stageReasons];
      if (p.duplicate.status === 'duplicate') reasons.push('You chose to keep this even though it matches a transaction already imported');
      if (d?.forceStage && !reasons.length) reasons.push('You chose to review this later');
      const userCat = d?.categoryId !== undefined;
      const categoryId = userCat ? d!.categoryId ?? null : p.suggestedCategoryId;
      // A category chosen on the review screen resolves the "no confident category" reason.
      const finalReasons = userCat && categoryId ? reasons.filter((r) => !/category/i.test(r)) : reasons;
      const status = finalReasons.length ? 'staged' : 'posted';
      const cat = categoriser.suggest({ description: t.description, amountCents: t.amountCents, accountId: input.accountId });
      const id = ctx.id();
      ctx.db.run(`INSERT INTO transactions(id, account_id, date, processing_date, amount_cents, original_description, clean_description, payee, category_id,
          category_source, rule_id, category_explanation, income_type, import_id, source_row, external_id, reference, balance_cents, original_data, status,
          review_reasons, confidence, duplicate_of, user_modified, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, input.accountId, t.date, t.processingDate ?? null, t.amountCents, orig.description, cleanDescription(t.description), orig.payee ?? guessPayee(t.description), categoryId,
          userCat ? 'user' : categoryId ? cat.source : null, userCat ? null : cat.ruleId, userCat ? 'Categorised by you during import' : categoryId ? cat.explanation : null,
          userCat ? null : cat.incomeType, importId, orig.sourceRow, orig.externalId ?? null, orig.reference ?? null, orig.balanceCents ?? null,
          JSON.stringify({ row: orig.raw, file: s.fileName, format: s.format }), status, JSON.stringify(finalReasons), t.confidence,
          p.duplicate.matchId, corrected ? 1 : 0, now, now]);
      if (corrected) {
        if (d!.amountCents !== undefined && d!.amountCents !== orig.amountCents) recordChange(ctx, 'transaction', id, 'amountCents', orig.amountCents, d!.amountCents, 'Corrected on the import review screen');
        if (d!.date !== undefined && d!.date !== orig.date) recordChange(ctx, 'transaction', id, 'date', orig.date, d!.date, 'Corrected on the import review screen');
        if (d!.description !== undefined && d!.description !== orig.description) recordChange(ctx, 'transaction', id, 'description', orig.description, d!.description, 'Corrected on the import review screen');
      }
      recordChange(ctx, 'transaction', id, 'categoryId', null, categoryId ? ctx.db.scalar('SELECT name FROM categories WHERE id = ?', [categoryId]) : 'Uncategorised', userCat ? 'Chosen during import' : `Imported as: ${cat.explanation}`);
      if (cat.ruleId && !userCat) ctx.db.run('UPDATE rules SET hit_count = hit_count + 1 WHERE id = ?', [cat.ruleId]);
      if (status === 'staged') staged++;
      else added++;
    });
    if (rec.closingCents !== null && st.periodEnd) {
      addBalance(ctx, input.accountId, st.periodEnd, rec.closingCents, 'imported', rec.status === 'reconciled' ? 'Statement closing balance (reconciled)' : 'Statement closing balance', importId);
    } else {
      const last = [...included].reverse().find((t) => t.balanceCents != null);
      if (last) addBalance(ctx, input.accountId, last.date, last.balanceCents as number, 'imported', 'Running balance on the last imported row', importId);
    }
    ctx.db.run('UPDATE imports SET added_count = ?, staged_count = ?, duplicate_count = ? WHERE id = ?', [added, staged, skipped, importId]);
  });
  sessions.delete(input.sessionId);
  ctx.changed('transactions');
  ctx.changed('accounts');
  return { importId, added, staged, skippedDuplicates: skipped, rejectedRows: st.rejectedRows.length, reconciliation: rec };
}

/* ------------------------------ import history ------------------------------ */

export function listImports(ctx: Ctx) {
  return ctx.db.all('SELECT i.*, a.name AS account_name FROM imports i JOIN accounts a ON a.id = i.account_id ORDER BY i.imported_at DESC').map((r) => ({
    id: String(r.id),
    accountId: String(r.account_id),
    accountName: String(r.account_name),
    fileName: String(r.file_name),
    format: String(r.format),
    importedAt: String(r.imported_at),
    periodStart: str(r.period_start),
    periodEnd: str(r.period_end),
    added: Number(r.added_count),
    staged: Number(r.staged_count),
    duplicates: Number(r.duplicate_count),
    rejected: Number(r.rejected_count),
    rejectedRows: json<{ sourceRow: number; reason: string; raw: string }[]>(r.rejected, []),
    warnings: json<string[]>(r.warnings, []),
    reconciliation: json<ReconciliationDTO | null>(r.reconciliation, null),
    documentId: str(r.document_id),
    ocrRequired: bool(r.ocr_required),
  }));
}

/** Check an earlier import again, optionally with balances typed from the paper statement. */
export function reReconcile(ctx: Ctx, importId: string, openingCents: number | null, closingCents: number | null): ReconciliationDTO {
  const imp = ctx.db.get('SELECT * FROM imports WHERE id = ?', [importId]);
  if (!imp) throw new UserError('That import no longer exists.');
  const txs = ctx.db.all('SELECT date, amount_cents, original_description, balance_cents FROM transactions WHERE import_id = ? ORDER BY date, source_row', [importId]);
  const rec = reconcile({
    openingCents: openingCents ?? (imp.opening_balance_cents === null ? null : Number(imp.opening_balance_cents)),
    closingCents: closingCents ?? (imp.closing_balance_cents === null ? null : Number(imp.closing_balance_cents)),
    transactions: txs.map((t) => ({ date: String(t.date), amountCents: Number(t.amount_cents), description: String(t.original_description), balanceCents: t.balance_cents === null ? null : Number(t.balance_cents), issues: [] })),
  });
  ctx.db.run('UPDATE imports SET reconciliation = ?, opening_balance_cents = ?, closing_balance_cents = ? WHERE id = ?', [JSON.stringify(rec), rec.openingCents, rec.closingCents, importId]);
  ctx.changed('imports');
  return rec;
}

/** Remove everything an import added (transactions and balances). */
export function undoImport(ctx: Ctx, importId: string): { removed: number } {
  const imp = ctx.db.get('SELECT file_name FROM imports WHERE id = ?', [importId]);
  if (!imp) throw new UserError('That import no longer exists.');
  let removed = 0;
  ctx.db.tx(() => {
    const ids = ctx.db.all('SELECT id, transfer_id FROM transactions WHERE import_id = ?', [importId]);
    for (const t of ids) {
      if (t.transfer_id) {
        ctx.db.run("UPDATE transactions SET is_transfer = 0, transfer_id = NULL, category_id = NULL, category_source = NULL WHERE transfer_id = ? AND import_id IS NOT ?", [t.transfer_id, importId]);
        ctx.db.run('DELETE FROM transfers WHERE id = ?', [t.transfer_id]);
      }
    }
    removed = ids.length;
    ctx.db.run('DELETE FROM transactions WHERE import_id = ?', [importId]);
    ctx.db.run('DELETE FROM balance_snapshots WHERE import_id = ?', [importId]);
    ctx.db.run('DELETE FROM imports WHERE id = ?', [importId]);
    recordChange(ctx, 'import', importId, 'undone', String(imp.file_name), `${removed} transactions removed`, 'Import undone by you');
  });
  ctx.changed('transactions');
  ctx.changed('accounts');
  return { removed };
}

export function listProfiles(ctx: Ctx) {
  return ctx.db.all('SELECT p.*, a.name AS account_name FROM import_profiles p LEFT JOIN accounts a ON a.id = p.account_id ORDER BY p.name').map((r) => ({
    id: String(r.id), name: String(r.name), format: String(r.format), accountName: str(r.account_name), createdAt: String(r.created_at), lastUsedAt: str(r.last_used_at),
  }));
}

export function deleteProfile(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM import_profiles WHERE id = ?', [id]);
  ctx.changed('imports');
}

/* ------------------------------ review inbox ------------------------------ */

export function inbox(ctx: Ctx): { rows: TransactionDTO[]; count: number; byReason: Record<string, number> } {
  const rows = toDTOs(ctx, ctx.db.all("SELECT * FROM transactions WHERE status = 'staged' ORDER BY date DESC"));
  const byReason: Record<string, number> = {};
  for (const r of rows) for (const reason of r.reviewReasons) {
    const key = reason.startsWith('Possible duplicate') ? 'Possible duplicate' : reason.split(' (')[0];
    byReason[key] = (byReason[key] ?? 0) + 1;
  }
  return { rows, count: rows.length, byReason };
}

export function approveStaged(ctx: Ctx, ids: string[], categoryId?: string | null): { approved: number } {
  ctx.db.tx(() => {
    for (const id of ids) {
      const cur = ctx.db.get("SELECT review_reasons, category_id FROM transactions WHERE id = ? AND status = 'staged'", [id]);
      if (!cur) continue;
      if (categoryId !== undefined && categoryId !== cur.category_id) {
        recordChange(ctx, 'transaction', id, 'categoryId', ctx.db.scalar('SELECT name FROM categories WHERE id = ?', [str(cur.category_id)]), ctx.db.scalar('SELECT name FROM categories WHERE id = ?', [categoryId]), 'Chosen in the review inbox');
        ctx.db.run("UPDATE transactions SET category_id = ?, category_source = 'user', category_explanation = 'Categorised by you' WHERE id = ?", [categoryId, id]);
      }
      recordChange(ctx, 'transaction', id, 'status', 'staged', 'posted', `Approved in the review inbox (was: ${json<string[]>(cur.review_reasons, []).join('; ')})`);
      ctx.db.run("UPDATE transactions SET status = 'posted', updated_at = ? WHERE id = ?", [ctx.now(), id]);
    }
  });
  ctx.changed('transactions');
  return { approved: ids.length };
}

/** Approve everything in the inbox whose only question was about the category, where a category is now set. */
export function approveObvious(ctx: Ctx): { approved: number } {
  const ids = ctx.db.all("SELECT id, review_reasons, category_id, confidence FROM transactions WHERE status = 'staged'")
    .filter((r) => r.category_id && r.confidence === 'high' && json<string[]>(r.review_reasons, []).every((x) => /category|categories|PDF statement — please confirm/i.test(x)))
    .map((r) => String(r.id));
  return approveStaged(ctx, ids);
}

/** Staged rows the user rejects are removed — they never became part of the financial history. */
export function rejectStaged(ctx: Ctx, ids: string[]): { removed: number } {
  let removed = 0;
  ctx.db.tx(() => {
    for (const id of ids) {
      const r = ctx.db.get("SELECT import_id, original_description FROM transactions WHERE id = ? AND status = 'staged'", [id]);
      if (!r) continue;
      ctx.db.run('DELETE FROM transactions WHERE id = ?', [id]);
      recordChange(ctx, 'import', String(r.import_id ?? ''), 'rejected-row', String(r.original_description), null, 'Rejected in the review inbox');
      removed++;
    }
  });
  ctx.changed('transactions');
  return { removed };
}
