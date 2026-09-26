import Papa from 'papaparse';
import { parseMoney } from '../money';
import { DateFormat, detectDateFormat, parseDateAs } from './dateFormats';
import { Confidence, ParsedStatement, ParsedTransaction, emptyStatement, lowestConfidence, ImportFormat } from './types';

/**
 * CSV (and spreadsheet) import.
 *
 * 1. `readDelimited` turns text into rows of cells.
 * 2. `detectMapping` works out which column holds what, and lists anything it is unsure of.
 * 3. The user confirms or corrects the mapping on the mapping screen (and can save it as a profile).
 * 4. `applyMapping` produces transactions, rejecting rows it can't read rather than guessing.
 */

export type AmountMode = 'single' | 'debit-credit' | 'amount-with-indicator';

export interface ColumnMapping {
  headerRow: number | null;
  firstDataRow: number;
  date: number;
  dateFormat: DateFormat;
  processingDate?: number | null;
  description: number[];
  amountMode: AmountMode;
  amount?: number | null;
  /** For a single amount column: true when positive numbers are money in (the usual bank convention). */
  positiveIsCredit?: boolean;
  debit?: number | null;
  credit?: number | null;
  indicator?: number | null;
  balance?: number | null;
  reference?: number | null;
  account?: number | null;
  payee?: number | null;
  category?: number | null;
}

export type ColumnKind =
  | 'date' | 'processing-date' | 'description' | 'amount' | 'debit' | 'credit' | 'indicator'
  | 'balance' | 'reference' | 'account' | 'payee' | 'category' | 'ignore';

export interface MappingDetection {
  mapping: ColumnMapping | null;
  headers: string[];
  columnCount: number;
  /** Plain-language questions the user must answer before importing. */
  questions: string[];
  notes: string[];
  confidence: Confidence;
  signature: string;
  sampleRows: string[][];
}

export function readDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy' });
  return (result.data as string[][]).map((row) => row.map((c) => (c ?? '').toString().trim()));
}

/* ------------------------------ header keywords ------------------------------ */

const H = {
  processingDate: /^(processed|processing|posting|posted|value|effective|settle(ment)?|cleared)\s*date$|^date\s*(processed|posted|cleared)$/i,
  date: /^(transaction\s*|trans\.?\s*|txn\s*|trade\s*|purchase\s*|payment\s*)?date$|^date(\s*of\s*transaction)?$|^(date\s*posted|posted)$/i,
  description: /^(transaction\s*)?(description|details|narrative|narration|particulars)$|^description\s*\d?$|^transaction$|^memo$|^desc/i,
  payee: /^(payee|merchant(\s*name)?|counterparty|recipient|paid\s*to)$/i,
  debit: /^(debit(s)?(\s*amount)?|withdrawal(s)?|money\s*out|paid\s*out|out|debit\s*\(\$?\)|dr)$/i,
  credit: /^(credit(s)?(\s*amount)?|deposit(s)?|money\s*in|paid\s*in|in|credit\s*\(\$?\)|cr)$/i,
  amount: /^((transaction|net)\s*)?amount(\s*\(aud\)|\s*aud|\s*\(\$\))?$|^value$|^amt$/i,
  balance: /^(running\s*|account\s*|closing\s*)?balance(\s*\(aud\))?$|^bal$/i,
  reference: /^(reference|ref(erence)?\s*(no|number|#)?|transaction\s*(id|reference|ref)|receipt(\s*no)?|cheque(\s*(no|number))?|serial(\s*number)?|id|bank\s*reference)$/i,
  account: /^(account|account\s*(no|number|#)|acct(\s*no)?|card(\s*(no|number))?)$/i,
  indicator: /^(dr\s*\/\s*cr|debit\s*\/\s*credit|type|transaction\s*type|d\s*\/\s*c|cr\s*\/\s*dr)$/i,
  category: /^category$/i,
};

const FOOTER = /^(total|totals|closing balance|opening balance|balance brought forward|end of statement|page \d+)/i;

const INDICATOR_VALUES = /^(dr|cr|d|c|debit|credit|db)$/i;

/* ------------------------------ column profiling ------------------------------ */

interface ColumnProfile {
  index: number;
  header: string;
  nonEmpty: number;
  dateRate: number;
  dateFormat: DateFormat | null;
  dateNote: string | null;
  dateConfidence: Confidence;
  numericRate: number;
  hasNegative: boolean;
  hasPositive: boolean;
  indicatorRate: number;
  textRate: number;
  avgLength: number;
  distinctRate: number;
}

function profileColumns(rows: string[][], headers: string[]): ColumnProfile[] {
  const width = Math.max(headers.length, ...rows.map((r) => r.length));
  const out: ColumnProfile[] = [];
  for (let c = 0; c < width; c++) {
    const vals = rows.map((r) => (r[c] ?? '').trim()).filter((v) => v !== '');
    const n = vals.length || 1;
    const det = detectDateFormat(vals, true, 0.6);
    const nums = vals.map((v) => parseMoney(v)).filter((x) => x !== null) as { cents: number }[];
    out.push({
      index: c,
      header: headers[c] ?? `Column ${c + 1}`,
      nonEmpty: vals.length,
      dateRate: det ? det.parseRate : 0,
      dateFormat: det ? det.format : null,
      dateNote: det ? det.note : null,
      dateConfidence: det ? det.confidence : 'low',
      numericRate: nums.length / n,
      hasNegative: nums.some((x) => x.cents < 0),
      hasPositive: nums.some((x) => x.cents > 0),
      indicatorRate: vals.filter((v) => INDICATOR_VALUES.test(v)).length / n,
      textRate: vals.filter((v) => /[A-Za-z]{2,}/.test(v) && parseMoney(v) === null).length / n,
      avgLength: vals.reduce((a, v) => a + v.length, 0) / n,
      distinctRate: new Set(vals).size / n,
    });
  }
  return out;
}

function looksLikeDataRow(row: string[]): boolean {
  const hasDate = row.some((c) => detectDateFormat([c]) !== null && /\d/.test(c));
  const hasNumber = row.some((c) => /\d/.test(c) && parseMoney(c) !== null);
  return hasDate && hasNumber;
}

/** Index of the header row (null when the file has no header), and where data starts. */
export function findHeaderRow(rows: string[][]): { headerRow: number | null; firstDataRow: number } {
  const limit = Math.min(rows.length, 25);
  for (let r = 0; r < limit; r++) {
    if (looksLikeDataRow(rows[r])) {
      // Data starts here; the header (if any) is the closest preceding row with the same width and mostly text.
      const prev = rows[r - 1];
      if (prev && prev.filter((c) => c && /[A-Za-z]/.test(c) && parseMoney(c) === null).length >= Math.min(2, prev.length)) {
        return { headerRow: r - 1, firstDataRow: r };
      }
      return { headerRow: null, firstDataRow: r };
    }
  }
  return { headerRow: rows.length > 1 ? 0 : null, firstDataRow: rows.length > 1 ? 1 : 0 };
}

/** Fraction of consecutive rows where balance changes by exactly the amount (either row order). */
export function runningBalanceScore(amounts: (number | null)[], balances: (number | null)[]): { score: number; order: 'ascending' | 'descending' } {
  let asc = 0;
  let desc = 0;
  let pairs = 0;
  for (let i = 1; i < amounts.length; i++) {
    const a0 = amounts[i - 1], a1 = amounts[i], b0 = balances[i - 1], b1 = balances[i];
    if (a0 === null || a1 === null || b0 === null || b1 === null) continue;
    pairs++;
    if (b1 - b0 === a1) asc++;
    if (b0 - b1 === a0) desc++;
  }
  if (pairs === 0) return { score: 0, order: 'ascending' };
  return asc >= desc ? { score: asc / pairs, order: 'ascending' } : { score: desc / pairs, order: 'descending' };
}

function cents(v: string | undefined): number | null {
  const p = parseMoney(v ?? '');
  return p ? p.cents : null;
}

export function headerSignature(headers: string[] | null, columnCount: number, profiles?: ColumnKind[]): string {
  if (headers) return 'h:' + headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).join('|');
  return `n:${columnCount}:${(profiles ?? []).join(',')}`;
}

/* ------------------------------ detection ------------------------------ */

export function detectMapping(rows: string[][]): MappingDetection {
  const questions: string[] = [];
  const notes: string[] = [];
  const { headerRow, firstDataRow } = findHeaderRow(rows);
  const headerCells = headerRow !== null ? rows[headerRow] : null;
  // Summary lines ("Total", "Closing balance") are left out when working out the columns.
  const data = rows.slice(firstDataRow).filter((r) => r.some((c) => c !== '') && !FOOTER.test(r.find((c) => c) ?? ''));
  const sample = data.slice(0, 300);
  const width = Math.max(headerCells?.length ?? 0, ...sample.map((r) => r.length), 0);
  const headers = Array.from({ length: width }, (_, i) => (headerCells?.[i] || `Column ${i + 1}`).trim());
  const profiles = profileColumns(sample, headers);
  const used = new Set<number>();
  const byHeader = (re: RegExp, filter: (p: ColumnProfile) => boolean = () => true) =>
    headerCells ? profiles.find((p) => !used.has(p.index) && re.test(p.header.trim()) && filter(p)) : undefined;

  const fieldConf: Confidence[] = [];

  // Dates: header first, then content.
  const dateCols = profiles.filter((p) => p.dateRate >= 0.6).sort((a, b) => b.dateRate - a.dateRate);
  let processing = byHeader(H.processingDate, (p) => p.dateRate >= 0.6);
  let date = byHeader(H.date, (p) => p.dateRate >= 0.6 && p !== processing);
  if (!date) date = dateCols.find((p) => p !== processing);
  if (!date && processing) {
    date = processing;
    processing = undefined;
  }
  if (!date) {
    return {
      mapping: null, headers, columnCount: width, confidence: 'low',
      questions: ['Which column contains the transaction date?'],
      notes: ['No column could be read as dates.'],
      signature: headerSignature(headerCells, width), sampleRows: sample.slice(0, 20),
    };
  }
  used.add(date.index);
  if (!processing) processing = dateCols.find((p) => !used.has(p.index));
  if (processing) used.add(processing.index);
  fieldConf.push(date.dateConfidence);
  if (date.dateNote) {
    notes.push(date.dateNote);
    if (date.dateConfidence !== 'high') questions.push(`Are dates in "${date.header}" day-first (e.g. 02/08/2026 = 2 August)?`);
  }

  // Amount columns.
  const numericCols = profiles.filter((p) => !used.has(p.index) && p.numericRate >= 0.6 && p.textRate < 0.2);
  // Mostly-empty numeric columns are typical of separate debit/credit columns.
  const numericOrSparse = profiles.filter((p) => !used.has(p.index) && p.textRate < 0.2 && p.nonEmpty > 0 && p.numericRate >= 0.9);
  let debit = byHeader(H.debit, (p) => p.textRate < 0.2);
  let credit = byHeader(H.credit, (p) => p.textRate < 0.2);
  let amount = byHeader(H.amount, (p) => p.numericRate >= 0.6);
  let balance = byHeader(H.balance, (p) => p.numericRate >= 0.6);
  const indicator = byHeader(H.indicator, (p) => p.indicatorRate >= 0.8) ?? profiles.find((p) => !used.has(p.index) && p.indicatorRate >= 0.95 && p.nonEmpty > 0);

  let amountMode: AmountMode = 'single';
  let positiveIsCredit = true;

  if (debit && credit && !amount) {
    amountMode = 'debit-credit';
    used.add(debit.index);
    used.add(credit.index);
  } else {
    if (!amount) {
      // Headerless: choose between numeric columns using the running-balance check.
      const cands = numericCols.filter((p) => p !== balance);
      if (cands.length === 1) amount = cands[0];
      else if (cands.length >= 2) {
        let best: { a: ColumnProfile; b: ColumnProfile; score: number } | null = null;
        for (const a of cands) for (const b of cands) {
          if (a === b) continue;
          const am = sample.map((r) => cents(r[a.index]));
          const bm = sample.map((r) => cents(r[b.index]));
          const s = runningBalanceScore(am, bm).score;
          if (!best || s > best.score) best = { a, b, score: s };
        }
        if (best && best.score >= 0.6) {
          amount = best.a;
          balance = balance ?? best.b;
          notes.push(`"${best.a.header}" looks like the amount and "${best.b.header}" the running balance (they agree on ${Math.round(best.score * 100)}% of rows).`);
        } else if (numericOrSparse.length >= 2 && !headerCells) {
          // Possibly separate debit/credit columns without headers.
          const sparse = numericOrSparse.filter((p) => p.nonEmpty < sample.length * 0.95);
          if (sparse.length >= 2) {
            debit = sparse[0];
            credit = sparse[1];
            amountMode = 'debit-credit';
            questions.push(`Is "${debit.header}" money out and "${credit.header}" money in?`);
          } else {
            amount = cands[0];
            questions.push(`Which column contains the amount? "${cands[0].header}" was assumed.`);
          }
        } else {
          amount = cands[0];
          questions.push(`Which column contains the amount? "${cands[0].header}" was assumed.`);
        }
      }
    }
    if (amountMode === 'single') {
      if (!amount) {
        return {
          mapping: null, headers, columnCount: width, confidence: 'low',
          questions: ['Which column contains the amount?', 'Are debits shown as negative numbers or in a separate column?'],
          notes, signature: headerSignature(headerCells, width), sampleRows: sample.slice(0, 20),
        };
      }
      used.add(amount.index);
      if (indicator && !used.has(indicator.index)) {
        amountMode = 'amount-with-indicator';
        used.add(indicator.index);
        notes.push(`Money in/out is taken from the "${indicator.header}" column.`);
      } else if (!amount.hasNegative) {
        // All amounts positive: work out direction from the balance, or ask.
        if (balance) {
          const am = sample.map((r) => cents(r[amount!.index]));
          const neg = am.map((v) => (v === null ? null : -v));
          const bm = sample.map((r) => cents(r[balance!.index]));
          const pos = runningBalanceScore(am, bm).score;
          const negScore = runningBalanceScore(neg, bm).score;
          if (negScore > pos && negScore >= 0.6) {
            positiveIsCredit = false;
            notes.push('Positive amounts reduce the balance, so they are treated as money out.');
          } else if (pos < 0.6) {
            questions.push('All amounts are positive. Are they money out (e.g. card purchases) or money in?');
            fieldConf.push('low');
          }
        } else {
          questions.push('All amounts are positive. Are they money out (e.g. card purchases) or money in?');
          fieldConf.push('low');
        }
      }
    }
  }
  if (balance) used.add(balance.index);
  if (!balance) {
    const cand = numericCols.find((p) => !used.has(p.index));
    if (cand) {
      balance = cand;
      used.add(cand.index);
    }
  }

  const reference = byHeader(H.reference);
  if (reference) used.add(reference.index);
  const account = byHeader(H.account);
  if (account) used.add(account.index);
  const payee = byHeader(H.payee, (p) => p.textRate > 0.3);
  if (payee) used.add(payee.index);
  const category = byHeader(H.category);
  if (category) used.add(category.index);

  // Description: header match first, else the longest text column(s).
  let description = profiles.filter((p) => !used.has(p.index) && headerCells && H.description.test(p.header.trim()));
  if (description.length === 0) {
    const textCols = profiles
      .filter((p) => !used.has(p.index) && p.textRate >= 0.5)
      .sort((a, b) => b.avgLength - a.avgLength);
    description = textCols.slice(0, 1);
    if (description.length === 0 && payee) description = [payee];
    if (description.length === 0) {
      questions.push('Which column contains the description?');
      fieldConf.push('low');
    } else if (!headerCells) {
      notes.push(`"${description[0].header}" is used as the description.`);
    }
  }

  const mapping: ColumnMapping = {
    headerRow,
    firstDataRow,
    date: date.index,
    dateFormat: date.dateFormat as DateFormat,
    processingDate: processing?.index ?? null,
    description: description.map((d) => d.index),
    amountMode,
    amount: amountMode === 'debit-credit' ? null : amount?.index ?? null,
    positiveIsCredit,
    debit: amountMode === 'debit-credit' ? debit?.index ?? null : null,
    credit: amountMode === 'debit-credit' ? credit?.index ?? null : null,
    indicator: amountMode === 'amount-with-indicator' ? indicator?.index ?? null : null,
    balance: balance?.index ?? null,
    reference: reference?.index ?? null,
    account: account?.index ?? null,
    payee: payee?.index ?? null,
    category: category?.index ?? null,
  };
  if (!headerCells) {
    questions.push('This file has no column headings. Please check the columns below are correct.');
  }
  const kinds = mappingKinds(mapping, width);
  return {
    mapping,
    headers,
    columnCount: width,
    questions,
    notes,
    confidence: questions.length ? lowestConfidence([...fieldConf, 'medium']) : lowestConfidence(fieldConf),
    signature: headerSignature(headerCells, width, kinds),
    sampleRows: sample.slice(0, 20),
  };
}

/** Which role each column plays under a mapping (for the mapping screen). */
export function mappingKinds(m: ColumnMapping, width: number): ColumnKind[] {
  const kinds: ColumnKind[] = Array.from({ length: width }, () => 'ignore');
  const set = (i: number | null | undefined, k: ColumnKind) => {
    if (i !== null && i !== undefined && i >= 0 && i < width) kinds[i] = k;
  };
  set(m.date, 'date');
  set(m.processingDate, 'processing-date');
  m.description.forEach((i) => set(i, 'description'));
  set(m.amount, 'amount');
  set(m.debit, 'debit');
  set(m.credit, 'credit');
  set(m.indicator, 'indicator');
  set(m.balance, 'balance');
  set(m.reference, 'reference');
  set(m.account, 'account');
  set(m.payee, 'payee');
  set(m.category, 'category');
  return kinds;
}

/** Build a mapping from per-column roles chosen on the mapping screen. */
export function mappingFromKinds(
  kinds: ColumnKind[],
  base: Pick<ColumnMapping, 'headerRow' | 'firstDataRow' | 'dateFormat'> & { positiveIsCredit?: boolean },
): ColumnMapping {
  const find = (k: ColumnKind) => {
    const i = kinds.indexOf(k);
    return i >= 0 ? i : null;
  };
  const date = find('date');
  if (date === null) throw new Error('Choose which column contains the transaction date.');
  const debit = find('debit');
  const credit = find('credit');
  const amount = find('amount');
  const indicator = find('indicator');
  let amountMode: AmountMode = 'single';
  if (amount === null && (debit !== null || credit !== null)) amountMode = 'debit-credit';
  else if (amount !== null && indicator !== null) amountMode = 'amount-with-indicator';
  if (amount === null && debit === null && credit === null) throw new Error('Choose which column contains the amount (or the debit and credit columns).');
  const description = kinds.map((k, i) => (k === 'description' ? i : -1)).filter((i) => i >= 0);
  if (description.length === 0 && find('payee') === null) throw new Error('Choose which column contains the description.');
  return {
    headerRow: base.headerRow,
    firstDataRow: base.firstDataRow,
    dateFormat: base.dateFormat,
    date,
    processingDate: find('processing-date'),
    description,
    amountMode,
    amount,
    positiveIsCredit: base.positiveIsCredit ?? true,
    debit,
    credit,
    indicator,
    balance: find('balance'),
    reference: find('reference'),
    account: find('account'),
    payee: find('payee'),
    category: find('category'),
  };
}

/* ------------------------------ applying a mapping ------------------------------ */

export function applyMapping(rows: string[][], m: ColumnMapping, format: ImportFormat = 'csv'): ParsedStatement {
  const st = emptyStatement(format);
  const headerCells = m.headerRow !== null ? rows[m.headerRow] : null;
  const colName = (i: number) => (headerCells?.[i] || `Column ${i + 1}`).trim();

  for (let r = m.firstDataRow; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c)) continue;
    const rawText = row.join(', ');
    const raw: Record<string, string> = {};
    row.forEach((c, i) => {
      raw[colName(i)] = c;
    });
    const sourceRow = r + 1;
    const issues: string[] = [];
    let confidence: Confidence = 'high';

    const dateText = row[m.date] ?? '';
    const date = parseDateAs(dateText, m.dateFormat);
    if (!date) {
      const firstText = row.find((c) => c) ?? '';
      if (FOOTER.test(firstText) || FOOTER.test(dateText)) continue; // summary lines, not transactions
      st.rejectedRows.push({ sourceRow, reason: dateText ? `Date "${dateText}" could not be read` : 'No date on this row', raw: rawText });
      continue;
    }
    let processingDate: string | null = null;
    if (m.processingDate !== null && m.processingDate !== undefined && row[m.processingDate]) {
      processingDate = parseDateAs(row[m.processingDate], m.dateFormat);
      if (!processingDate) issues.push(`Processing date "${row[m.processingDate]}" could not be read`);
    }

    let amountCents: number | null = null;
    if (m.amountMode === 'debit-credit') {
      const d = m.debit !== null && m.debit !== undefined ? parseMoney(row[m.debit]) : null;
      const c = m.credit !== null && m.credit !== undefined ? parseMoney(row[m.credit]) : null;
      if (d && d.cents !== 0 && c && c.cents !== 0) {
        issues.push('Both a debit and a credit are present on this row; the net amount was used');
        confidence = 'low';
        amountCents = Math.abs(c.cents) - Math.abs(d.cents);
      } else if (d && d.cents !== 0) amountCents = -Math.abs(d.cents);
      else if (c && c.cents !== 0) amountCents = Math.abs(c.cents);
      else if (d || c) amountCents = 0;
    } else {
      const a = m.amount !== null && m.amount !== undefined ? parseMoney(row[m.amount]) : null;
      if (a) {
        let v = a.cents;
        if (m.amountMode === 'amount-with-indicator' && m.indicator !== null && m.indicator !== undefined) {
          const ind = (row[m.indicator] ?? '').trim().toUpperCase();
          if (/^(DR|D|DEBIT|DB)$/.test(ind)) v = -Math.abs(v);
          else if (/^(CR|C|CREDIT)$/.test(ind)) v = Math.abs(v);
          else {
            issues.push(`Money in/out indicator "${row[m.indicator]}" not recognised`);
            confidence = 'low';
          }
        } else if (a.indicator) {
          v = a.indicator === 'DR' ? -Math.abs(v) : Math.abs(v);
        } else if (m.positiveIsCredit === false) {
          v = -v;
        }
        amountCents = v;
      }
    }
    if (amountCents === null) {
      st.rejectedRows.push({ sourceRow, reason: 'No amount could be read on this row', raw: rawText });
      continue;
    }

    const description = m.description
      .map((i) => row[i] ?? '')
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const payee = m.payee !== null && m.payee !== undefined ? row[m.payee] || null : null;
    if (!description && !payee) {
      issues.push('No description');
      confidence = lowestConfidence([confidence, 'medium']);
    }
    const bal = m.balance !== null && m.balance !== undefined ? parseMoney(row[m.balance]) : null;
    let balanceCents = bal ? bal.cents : null;
    if (bal && bal.indicator === 'DR') balanceCents = -Math.abs(bal.cents);

    st.transactions.push({
      sourceRow,
      date,
      processingDate,
      amountCents,
      description: description || payee || '',
      payee,
      reference: m.reference !== null && m.reference !== undefined ? row[m.reference] || null : null,
      accountRef: m.account !== null && m.account !== undefined ? row[m.account] || null : null,
      categoryHint: m.category !== null && m.category !== undefined ? row[m.category] || null : null,
      balanceCents,
      externalId: null,
      confidence,
      issues,
      raw,
    });
  }

  const balanceHeader = m.balance !== null && m.balance !== undefined && headerCells ? headerCells[m.balance] ?? '' : '';
  checkRunningBalances(st.transactions, H.balance.test(balanceHeader.trim()));
  finaliseStatement(st);
  return st;
}

/**
 * If the file has a balance column, check each row's balance moves by exactly its amount.
 * Rows that break the chain are flagged for review (they often reveal a sign or parsing error).
 */
export function checkRunningBalances(txs: ParsedTransaction[], knownRunningBalance = false): void {
  const withBal = txs.filter((t) => t.balanceCents !== null && t.balanceCents !== undefined);
  if (withBal.length < 2) return;
  const am = withBal.map((t) => t.amountCents);
  const bm = withBal.map((t) => t.balanceCents as number);
  const scored = runningBalanceScore(am, bm);
  // Unless the column is headed "Balance", only check it if it behaves like a running balance.
  if (scored.score < 0.5 && !knownRunningBalance) return;
  const order = scored.score > 0 ? scored.order : withBal[0].date <= withBal[withBal.length - 1].date ? 'ascending' : 'descending';
  for (let i = 1; i < withBal.length; i++) {
    const prev = withBal[i - 1];
    const cur = withBal[i];
    const ok = order === 'ascending'
      ? (cur.balanceCents as number) - (prev.balanceCents as number) === cur.amountCents
      : (prev.balanceCents as number) - (cur.balanceCents as number) === prev.amountCents;
    if (!ok) {
      const flagged = order === 'ascending' ? cur : prev;
      if (!flagged.issues.some((s) => s.startsWith('Running balance'))) {
        flagged.issues.push('Running balance does not change by this amount — a transaction may be missing or misread');
        flagged.confidence = lowestConfidence([flagged.confidence, 'medium']);
      }
    }
  }
}

export function finaliseStatement(st: ParsedStatement): void {
  if (st.transactions.length) {
    const dates = st.transactions.map((t) => t.date).sort();
    st.periodStart = st.periodStart ?? dates[0];
    st.periodEnd = st.periodEnd ?? dates[dates.length - 1];
  }
  if (st.rejectedRows.length) {
    st.warnings.push(`${st.rejectedRows.length} row(s) could not be read and were not imported. They are listed for review.`);
  }
  st.confidence = lowestConfidence([
    ...st.transactions.map((t) => t.confidence),
    st.rejectedRows.length ? 'medium' : 'high',
  ]);
}
