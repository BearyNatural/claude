import { randomBytes } from 'node:crypto';
import { AppDatabase, decryptDatabase, encryptDatabase } from './db/database';
import { migrate } from './db/schema';
import { makeCtx, seedDefaults } from './services/core';
import { seedDemo } from './demo/demoData';
import { dashboard } from './services/insights';
import { taxEstimate } from './services/taxes';
import { extractPdfText } from './import/pdfExtract';
import { readSpreadsheet } from '../domain/import/spreadsheet';
import { workbookToXlsx } from '../domain/output/xlsx';
import { money } from '../domain/output/workbook';
import { financialYearOf, localToday, previousFy } from '../domain/dates';

/**
 * `Geranium --self-test`: checks that a packaged build can load everything it needs
 * (SQLite wasm, encryption, PDF.js, SheetJS, the XLSX writer and the finance engines)
 * from inside its app archive. Uses only built-in sample data in memory; it never opens
 * the user's data folder and makes no network requests.
 */
export async function runSelfTest(): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let ok = true;
  const check = async (name: string, fn: () => Promise<string> | string) => {
    try {
      lines.push(`ok   ${name}: ${await fn()}`);
    } catch (e) {
      ok = false;
      lines.push(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await check('encrypted database', async () => {
    const db = await AppDatabase.openMemory();
    migrate(db);
    const key = randomBytes(32);
    const reopened = await AppDatabase.openMemory(decryptDatabase(encryptDatabase(db.export(), key), key));
    const tables = reopened.all("SELECT name FROM sqlite_master WHERE type = 'table'").length;
    if (tables < 10) throw new Error(`only ${tables} tables after round trip`);
    return `${tables} tables survive an AES-256-GCM round trip`;
  });

  await check('finance engines', async () => {
    const db = await AppDatabase.openMemory();
    migrate(db);
    const today = localToday();
    const ctx = makeCtx(db, { isDemo: true, today: () => today });
    seedDefaults(ctx);
    seedDemo(ctx);
    const d = dashboard(ctx, 'month');
    const t = taxEstimate(ctx, previousFy(financialYearOf(today)));
    if (d.trend.length !== 12) throw new Error('dashboard trend is incomplete');
    if (!(t.taxableIncomeCents > 0)) throw new Error('tax estimate has no income');
    return `demo data, dashboard and ${previousFy(financialYearOf(today))} tax estimate`;
  });

  await check('PDF text (PDF.js)', async () => {
    const r = await extractPdfText(samplePdf('Geranium self-test 12.34'));
    const text = r.pages.flatMap((p) => p.items.map((i) => i.str)).join(' ');
    if (!text.includes('Geranium self-test')) throw new Error(`unexpected text "${text}"`);
    return `${r.pageCount} page read`;
  });

  await check('spreadsheets (writer + SheetJS reader)', () => {
    const bytes = workbookToXlsx({
      title: 'Self-test',
      createdAt: localToday(),
      sheets: [{ name: 'Check', columns: [{ header: 'Item' }, { header: 'Amount', format: 'currency' }], rows: [['Sample', money(1234)]] }],
    });
    const back = readSpreadsheet(bytes).find((s) => s.name === 'Check');
    if (!back || back.rows[1]?.[0] !== 'Sample') throw new Error('written workbook did not read back');
    return `${bytes.length} byte workbook written and read back`;
  });

  return { ok, lines };
}

/** A minimal one-page PDF with a line of Helvetica text, built with correct xref offsets. */
export function samplePdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
