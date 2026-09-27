/**
 * CSV writing with proper quoting and protection against spreadsheet formula injection:
 * text that begins with = + - @ (or tab/CR) is prefixed with an apostrophe so a
 * spreadsheet program treats it as text, not a formula. Numbers are written as numbers.
 */
export type CsvValue = string | number | boolean | null | undefined;

export function csvEscape(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))];
  // UTF-8 BOM so Excel opens accented characters correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
