import { buildLines, PdfTextItem, PdfTextPage } from './pdfStatement';

/**
 * Reads an ATO-format "Employee share scheme statement" (NAT 75282) — the year-end statement an
 * employer gives for shares or rights received under an employee share scheme. Only the amounts
 * that go into the tax return are read:
 *   D  discount from taxed-upfront schemes, eligible for the reduction
 *   E  discount from taxed-upfront schemes, not eligible for the reduction
 *   F  discount from deferral schemes (taxed in the year of the deferred taxing point)
 *   C  TFN amounts withheld from discounts
 * The statement also shows the employee's TFN; it is deliberately not read or stored.
 */

export interface EssStatement {
  /** Financial year the statement is for, e.g. "2024-25". */
  fy: string | null;
  employerName: string | null;
  employerAbn: string | null;
  taxedUpfrontReductionCents: number;
  taxedUpfrontCents: number;
  deferralCents: number;
  tfnWithheldCents: number;
  /** Labels that were found on the statement (D, E, F, C). */
  found: string[];
  warnings: string[];
}

export function isEssStatement(pages: PdfTextPage[]): boolean {
  const text = pages.flatMap((p) => p.items.map((i) => i.str)).join(' ');
  return /employee\s+share\s+scheme\s+statement/i.test(text);
}

const AMOUNT = /^\$?\s*\d[\d,]*(\.\d{1,2})?$/;

function amountNear(items: PdfTextItem[], label: PdfTextItem): number | null {
  const candidates = items
    .filter((i) => i !== label && i.x > label.x && i.x - label.x < 160 && Math.abs(i.y - label.y) <= 6 && AMOUNT.test(i.str.trim()))
    .sort((a, b) => Math.abs(a.y - label.y) - Math.abs(b.y - label.y) || a.x - b.x);
  if (!candidates.length) return null;
  return Math.round(Number(candidates[0].str.replace(/[$,\s]/g, '')) * 100);
}

export function parseEssStatement(pages: PdfTextPage[]): EssStatement {
  const out: EssStatement = { fy: null, employerName: null, employerAbn: null, taxedUpfrontReductionCents: 0, taxedUpfrontCents: 0, deferralCents: 0, tfnWithheldCents: 0, found: [], warnings: [] };
  const page = pages[0];
  if (!page) return out;
  const items = page.items.filter((i) => i.str.trim() !== '');
  const fields: [string, keyof Pick<EssStatement, 'taxedUpfrontReductionCents' | 'taxedUpfrontCents' | 'deferralCents' | 'tfnWithheldCents'>][] = [
    ['D', 'taxedUpfrontReductionCents'], ['E', 'taxedUpfrontCents'], ['F', 'deferralCents'], ['C', 'tfnWithheldCents'],
  ];
  for (const [letter, key] of fields) {
    // The label is printed in the left margin as "D $" (or "D" then "$").
    const label = items.find((i) => new RegExp(`^${letter}(\\s*\\$)?$`).test(i.str.trim()) && i.x < page.width / 2);
    if (!label) continue;
    out.found.push(letter);
    out[key] = amountNear(items, label) ?? 0;
  }
  const lines = buildLines(pages.slice(0, 1)).map((l) => l.text);
  const text = lines.join('\n');
  const year = text.match(/year\s+ending\s+(?:30\s+June|June\s+30)\s*,?\s*(\d{4})/i);
  if (year) {
    const y = Number(year[1]);
    out.fy = `${y - 1}-${String(y).slice(2)}`;
  } else {
    out.warnings.push('The income year was not found on the statement. Choose it before saving.');
  }
  for (const l of lines) {
    const name = l.match(/^Employer\s+name\s*:?\s+(.+)$/i);
    if (name) out.employerName = name[1].replace(/\s{2,}/g, ' ').trim();
    const abn = l.match(/^Employer\s+ABN\s*:?\s+([\d ]{11,14})/i);
    if (abn) out.employerAbn = abn[1].replace(/\s/g, '');
  }
  if (out.found.length === 0) out.warnings.push('No amounts (labels D, E, F or C) were found. Check the statement and type the amounts in.');
  return out;
}
