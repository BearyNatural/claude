import { ISODate } from '../dates';

/**
 * A format-neutral workbook. The XLSX writer and the Google Sheets exporter both render
 * this model, so the two outputs have the same sheets, values and formulas. Formulas use
 * functions common to Excel, LibreOffice and Google Sheets so workbooks keep working
 * without this app.
 */

export type CellFormat = 'text' | 'currency' | 'date' | 'percent' | 'number' | 'integer';

export type Cell =
  | null
  | string
  | number
  | boolean
  | { formula: string; format?: CellFormat }
  | { date: ISODate }
  | { value: number; format: CellFormat };

export interface Column {
  header: string;
  width?: number;
  format?: CellFormat;
}

export interface Sheet {
  name: string;
  columns: Column[];
  rows: Cell[][];
  /** Shown on the "About this workbook" sheet. */
  notes?: string[];
  freezeHeader?: boolean;
}

export interface Workbook {
  title: string;
  createdAt: ISODate;
  sheets: Sheet[];
}

/** 0 → A, 25 → Z, 26 → AA */
export function colLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** A1 reference; rows are 1-based spreadsheet rows. */
export function ref(col: number, row: number, abs = false): string {
  return abs ? `$${colLetter(col)}$${row}` : `${colLetter(col)}${row}`;
}

/** Sheet names are limited to 31 characters and cannot contain []:*?/\ */
export function safeSheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet';
}

/** Quote a sheet name for use in a formula: 'Budget vs Actual'!A1 */
export function sheetRef(name: string): string {
  return /^[A-Za-z0-9_]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

export function formula(f: string, format?: CellFormat): Cell {
  return { formula: f.startsWith('=') ? f.slice(1) : f, format };
}

export function money(cents: number): Cell {
  return { value: cents / 100, format: 'currency' };
}

export function pct(fraction: number): Cell {
  return { value: fraction, format: 'percent' };
}

export function date(d: ISODate | null | undefined): Cell {
  return d ? { date: d } : null;
}

/** Plain value of a cell for CSV output (formulas are exported as their formula text). */
export function cellPlain(c: Cell): string | number | boolean | null {
  if (c === null || typeof c !== 'object') return c;
  if ('formula' in c) return `=${c.formula}`;
  if ('date' in c) return c.date;
  return c.value;
}
