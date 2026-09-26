import { parseMoney } from '../money';
import { makeDate, isValidDate } from '../dates';
import { ParsedStatement, ParsedTransaction, emptyStatement, Confidence } from './types';
import { finaliseStatement } from './csv';

/**
 * QIF (Quicken Interchange Format) reader for bank, cash and credit-card sections.
 * Records are separated by "^"; each line starts with a one-letter field code.
 *
 * QIF dates have no fixed order ("02/08/2026", "8/2'26", "02-08-26"). Day-first is
 * assumed for Australian files unless a value proves otherwise.
 */

interface RawQifRecord {
  line: number;
  fields: { code: string; value: string }[];
}

function splitRecords(text: string): { type: string | null; records: RawQifRecord[] }[] {
  const sections: { type: string | null; records: RawQifRecord[] }[] = [];
  let current: { type: string | null; records: RawQifRecord[] } = { type: null, records: [] };
  let rec: RawQifRecord | null = null;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((rawLine, i) => {
    const line = rawLine.trimEnd();
    if (!line) return;
    if (line.startsWith('!')) {
      if (line.toUpperCase().startsWith('!TYPE:') || line.toUpperCase().startsWith('!ACCOUNT')) {
        if (current.records.length || current.type) sections.push(current);
        current = { type: line.slice(1).toUpperCase(), records: [] };
      }
      return;
    }
    if (line === '^') {
      if (rec) current.records.push(rec);
      rec = null;
      return;
    }
    if (!rec) rec = { line: i + 1, fields: [] };
    rec.fields.push({ code: line[0].toUpperCase(), value: line.slice(1).trim() });
  });
  if (rec) current.records.push(rec);
  sections.push(current);
  return sections.filter((s) => s.records.length);
}

interface QifDateParts { a: number; b: number; y: number }

function splitQifDate(s: string): QifDateParts | null {
  // 02/08/2026, 2/8/26, 8/ 2'26, 02-08-2026, 2026-08-02
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return { a: Number(iso[3]), b: Number(iso[2]), y: Number(iso[1]) }; // stored as D, M
  const m = s.replace(/\s+/g, '').match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.']|'\s*)(\d{2}|\d{4})$/);
  if (!m) return null;
  let y = Number(m[3]);
  if (m[3].length === 2) y = s.includes("'") ? 2000 + y : y < 70 ? 2000 + y : 1900 + y;
  return { a: Number(m[1]), b: Number(m[2]), y };
}

/** Decide day-first vs month-first across all dates in the file. */
export function qifDateOrder(values: string[], preferDayFirst = true): { dayFirst: boolean; confidence: Confidence } {
  const parts = values.map(splitQifDate).filter((p): p is QifDateParts => !!p);
  if (parts.some((p) => p.a > 12)) return { dayFirst: true, confidence: 'high' };
  if (parts.some((p) => p.b > 12)) return { dayFirst: false, confidence: 'high' };
  return { dayFirst: preferDayFirst, confidence: 'medium' };
}

function qifDate(s: string, dayFirst: boolean, isoForm: boolean): string | null {
  const p = splitQifDate(s);
  if (!p) return null;
  const d = isoForm ? p.a : dayFirst ? p.a : p.b;
  const m = isoForm ? p.b : dayFirst ? p.b : p.a;
  const out = makeDate(p.y, m, d);
  return isValidDate(out) ? out : null;
}

export function isQif(text: string): boolean {
  return /^\s*!(Type|Account|Option)/im.test(text.slice(0, 500));
}

export function parseQif(text: string, preferDayFirst = true): ParsedStatement[] {
  const sections = splitRecords(text);
  const out: ParsedStatement[] = [];
  for (const section of sections) {
    const type = section.type ?? 'TYPE:BANK';
    if (type.startsWith('TYPE:INVST')) {
      throw new Error('This QIF file contains investment transactions. Import broker history on the Investments screen instead.');
    }
    if (type.startsWith('ACCOUNT') || type.startsWith('TYPE:CAT') || type.startsWith('TYPE:CLASS') || type.startsWith('TYPE:MEMORIZED')) continue;
    const st = emptyStatement('qif');
    st.account = { type: type.replace('TYPE:', '') };
    const dates = section.records.map((r) => r.fields.find((f) => f.code === 'D')?.value ?? '');
    const order = qifDateOrder(dates, preferDayFirst);
    if (order.confidence !== 'high') {
      st.warnings.push(`Every date in this file could be read day-first or month-first. ${order.dayFirst ? 'Day-first (Australian)' : 'Month-first'} was assumed — please check the dates in the preview.`);
    }
    for (const r of section.records) {
      const get = (c: string) => r.fields.find((f) => f.code === c)?.value ?? null;
      const rawText = r.fields.map((f) => f.code + f.value).join(' | ');
      const raw: Record<string, string> = {};
      for (const f of r.fields) raw[f.code] = raw[f.code] ? raw[f.code] + ' / ' + f.value : f.value;
      const dStr = get('D');
      const isoForm = !!dStr && /^\d{4}[-/.]/.test(dStr);
      const date = dStr ? qifDate(dStr, order.dayFirst, isoForm) : null;
      const amt = parseMoney(get('T') ?? get('U') ?? '');
      if (!date || !amt) {
        st.rejectedRows.push({ sourceRow: r.line, reason: !date ? `Date "${dStr ?? ''}" could not be read` : 'No amount', raw: rawText });
        continue;
      }
      const payee = get('P');
      const memo = get('M');
      const issues: string[] = [];
      const splits = r.fields.filter((f) => f.code === 'S').length;
      if (splits) issues.push(`This transaction has ${splits} split(s) in the file; split categories are shown as hints only`);
      const tx: ParsedTransaction = {
        sourceRow: r.line,
        date,
        amountCents: amt.cents,
        description: [payee, memo && memo !== payee ? memo : null].filter(Boolean).join(' — ') || 'Transaction',
        payee,
        memo,
        reference: get('N'),
        externalId: null,
        balanceCents: null,
        categoryHint: get('L'),
        confidence: order.confidence === 'high' ? 'high' : 'medium',
        issues,
        raw,
      };
      st.transactions.push(tx);
    }
    finaliseStatement(st);
    out.push(st);
  }
  if (!out.length) throw new Error('No bank, cash or credit-card transactions were found in this QIF file.');
  return out;
}
