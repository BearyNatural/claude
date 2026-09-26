import * as XLSX from 'xlsx';
import { excelSerialToDate } from './dateFormats';

/**
 * XLS / XLSX reading. Each worksheet becomes rows of text cells so the same
 * column-mapping wizard as CSV can be used. Date cells are converted to ISO dates
 * ("2026-08-02") so they are never misread as day/month numbers.
 */
export interface SheetTable {
  name: string;
  rows: string[][];
}

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'n') {
    const fmt = typeof cell.z === 'string' ? cell.z : '';
    if (fmt && XLSX.SSF.is_date(fmt)) {
      return excelSerialToDate(cell.v as number) ?? String(cell.v);
    }
    // Avoid binary floating noise such as 126.42999999999999.
    return String(Number((cell.v as number).toFixed(6)));
  }
  if (cell.t === 'd' && cell.v instanceof Date) {
    const d = cell.v;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  return String(cell.w ?? cell.v).trim();
}

export function readSpreadsheet(data: Uint8Array): SheetTable[] {
  // Formulas are read as their cached values only; nothing in the file is executed.
  const wb = XLSX.read(data, { type: 'array', cellDates: false, cellNF: true, cellFormula: false, cellHTML: false, WTF: false });
  const out: SheetTable[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows: string[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        row.push(cellText(ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined));
      }
      // Trim trailing empty cells.
      while (row.length && row[row.length - 1] === '') row.pop();
      rows.push(row);
    }
    const nonEmpty = rows.filter((r) => r.some((c) => c !== ''));
    if (nonEmpty.length) out.push({ name, rows: nonEmpty });
  }
  return out;
}
