import { Cell, CellFormat, Sheet, Workbook, colLetter, safeSheetName } from '../../domain/output/workbook';
import { aboutSheet } from '../../domain/output/sheets';
import { guardedFetch } from '../net';

/**
 * Renders the shared workbook model into Google Sheets API requests. Formulas are sent as
 * formulas (USER_ENTERED), so the spreadsheet keeps calculating on its own. Text that looks
 * like a formula is sent as plain text.
 */

type SheetsValue = string | number | boolean | null;

export function cellToSheetsValue(c: Cell): SheetsValue {
  if (c === null || c === undefined) return null;
  if (typeof c === 'string') return /^[=+\-@]/.test(c) ? `'${c}` : c;
  if (typeof c === 'number' || typeof c === 'boolean') return c;
  if ('formula' in c) return `=${c.formula}`;
  if ('date' in c) return c.date; // ISO dates are parsed as dates with USER_ENTERED
  return c.value;
}

const PATTERN: Partial<Record<CellFormat, { type: string; pattern: string }>> = {
  currency: { type: 'CURRENCY', pattern: '"$"#,##0.00' },
  date: { type: 'DATE', pattern: 'dd mmm yyyy' },
  percent: { type: 'PERCENT', pattern: '0.00%' },
  number: { type: 'NUMBER', pattern: '#,##0.00' },
  integer: { type: 'NUMBER', pattern: '#,##0' },
};

export interface SheetsPlan {
  titles: string[];
  values: { range: string; values: SheetsValue[][] }[];
  formatRequests: (sheetIdByTitle: Map<string, number>) => unknown[];
}

function quote(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function planWorkbook(wb: Workbook): SheetsPlan {
  const sheets: Sheet[] = [aboutSheet(wb), ...wb.sheets];
  const used = new Set<string>();
  const titles = sheets.map((s) => {
    let t = safeSheetName(s.name);
    let k = 2;
    while (used.has(t.toLowerCase())) t = `${safeSheetName(s.name).slice(0, 28)} ${k++}`;
    used.add(t.toLowerCase());
    return t;
  });
  const values = sheets.map((s, i) => ({
    range: `${quote(titles[i])}!A1`,
    values: [s.columns.map((c) => c.header), ...s.rows.map((r) => r.map(cellToSheetsValue))],
  }));
  const formatRequests = (ids: Map<string, number>) => {
    const reqs: unknown[] = [];
    sheets.forEach((s, i) => {
      const sheetId = ids.get(titles[i]);
      if (sheetId === undefined) return;
      reqs.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.94, green: 0.93, blue: 0.9 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } });
      if (s.freezeHeader) reqs.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
      s.columns.forEach((c, ci) => {
        reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: ci, endIndex: ci + 1 }, properties: { pixelSize: Math.round((c.width ?? 14) * 7.5) }, fields: 'pixelSize' } });
        const p = c.format ? PATTERN[c.format] : undefined;
        if (p) reqs.push({ repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: s.rows.length + 1, startColumnIndex: ci, endColumnIndex: ci + 1 }, cell: { userEnteredFormat: { numberFormat: p } }, fields: 'userEnteredFormat.numberFormat' } });
      });
      // Cells that carry their own format (e.g. formulas in a text column).
      s.rows.forEach((row, ri) => row.forEach((cell, ci) => {
        const f = cell && typeof cell === 'object' && 'format' in cell ? cell.format : cell && typeof cell === 'object' && 'date' in cell ? 'date' : undefined;
        const p = f && f !== s.columns[ci]?.format ? PATTERN[f as CellFormat] : undefined;
        if (p) reqs.push({ repeatCell: { range: { sheetId, startRowIndex: ri + 1, endRowIndex: ri + 2, startColumnIndex: ci, endColumnIndex: ci + 1 }, cell: { userEnteredFormat: { numberFormat: p } }, fields: 'userEnteredFormat.numberFormat' } });
      }));
    });
    return reqs;
  };
  return { titles, values, formatRequests };
}

async function api<T>(token: string, method: string, url: string, body: unknown, purpose: string): Promise<T> {
  const res = await guardedFetch(url, { method, purpose, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const msg = (() => { try { return (JSON.parse(text) as { error?: { message?: string } }).error?.message; } catch { return null; } })();
    throw new Error(`Google Sheets returned an error (${res.status})${msg ? `: ${msg}` : ''}.`);
  }
  return (await res.json()) as T;
}

interface SpreadsheetMeta {
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheets: { properties: { sheetId: number; title: string } }[];
}

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Create a new spreadsheet (snapshot) or refresh one this app created earlier (managed). */
export async function writeWorkbookToGoogle(token: string, wb: Workbook, existingId: string | null): Promise<{ spreadsheetId: string; url: string }> {
  const plan = planWorkbook(wb);
  let meta: SpreadsheetMeta;
  if (!existingId) {
    meta = await api<SpreadsheetMeta>(token, 'POST', BASE, { properties: { title: wb.title, locale: 'en_AU' }, sheets: plan.titles.map((title) => ({ properties: { title } })) }, 'Create spreadsheet');
  } else {
    meta = await api<SpreadsheetMeta>(token, 'GET', `${BASE}/${encodeURIComponent(existingId)}?fields=spreadsheetId,spreadsheetUrl,sheets.properties`, undefined, 'Read managed spreadsheet layout');
    const have = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
    const add = plan.titles.filter((t) => !have.has(t)).map((title) => ({ addSheet: { properties: { title } } }));
    if (add.length) await api(token, 'POST', `${BASE}/${existingId}:batchUpdate`, { requests: add }, 'Add sheets');
    meta = await api<SpreadsheetMeta>(token, 'GET', `${BASE}/${encodeURIComponent(existingId)}?fields=spreadsheetId,spreadsheetUrl,sheets.properties`, undefined, 'Read managed spreadsheet layout');
    const remove = meta.sheets.filter((s) => !plan.titles.includes(s.properties.title)).map((s) => ({ deleteSheet: { sheetId: s.properties.sheetId } }));
    if (remove.length) await api(token, 'POST', `${BASE}/${existingId}:batchUpdate`, { requests: remove }, 'Remove old sheets');
    await api(token, 'POST', `${BASE}/${existingId}/values:batchClear`, { ranges: plan.titles.map((t) => quote(t)) }, 'Clear managed sheets');
    meta = await api<SpreadsheetMeta>(token, 'GET', `${BASE}/${encodeURIComponent(existingId)}?fields=spreadsheetId,spreadsheetUrl,sheets.properties`, undefined, 'Read managed spreadsheet layout');
  }
  await api(token, 'POST', `${BASE}/${meta.spreadsheetId}/values:batchUpdate`, { valueInputOption: 'USER_ENTERED', data: plan.values }, 'Write values');
  const ids = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const reqs = plan.formatRequests(ids);
  for (let i = 0; i < reqs.length; i += 500) {
    await api(token, 'POST', `${BASE}/${meta.spreadsheetId}:batchUpdate`, { requests: reqs.slice(i, i + 500) }, 'Format sheets');
  }
  return { spreadsheetId: meta.spreadsheetId, url: meta.spreadsheetUrl };
}
