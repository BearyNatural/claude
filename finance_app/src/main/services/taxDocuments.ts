import { Ctx, UserError } from './core';
import { extractPdfText } from '../import/pdfExtract';
import { isEssStatement, parseEssStatement, EssStatement } from '../../domain/import/essStatement';
import { parsePayslip, PayslipRead } from '../../domain/import/payslip';
import { ISODate } from '../../domain/dates';
import { DocumentStore, addDocument, linkDocument } from './documents';
import { TaxEntryKind } from './taxes';

/**
 * Tax documents read from PDFs: employee share scheme statements and payslips. Reading never
 * saves anything — the figures are shown for checking first. The chosen file is held in memory
 * (briefly, for one file at a time) so a copy can be kept with the saved records if asked.
 */

const held = new Map<string, { fileName: string; bytes: Uint8Array; at: number }>();
const HOLD_MS = 30 * 60 * 1000;

function hold(ctx: Ctx, fileName: string, bytes: Uint8Array): string {
  const now = Date.now();
  for (const [k, v] of held) if (now - v.at > HOLD_MS) held.delete(k);
  const token = ctx.id();
  held.set(token, { fileName, bytes, at: now });
  return token;
}

function keep(ctx: Ctx, store: DocumentStore, token: string | null | undefined, kind: 'payslip' | 'other', notes: string): string | null {
  const f = token ? held.get(token) : undefined;
  if (!f) return null;
  held.delete(token!);
  return addDocument(ctx, store, { fileName: f.fileName, bytes: f.bytes, kind, notes });
}

async function pdfPages(bytes: Uint8Array) {
  const { pages } = await extractPdfText(bytes);
  const items = pages.reduce((a, p) => a + p.items.filter((i) => i.str.trim()).length, 0);
  if (items < 5) throw new UserError('This PDF has no readable text (it may be a scanned image), so the figures cannot be read. Enter them by hand instead.');
  return pages;
}

/* ------------------------------ employee share schemes ------------------------------ */

export async function readEssStatement(ctx: Ctx, fileName: string, bytes: Uint8Array): Promise<EssStatement & { token: string; fileName: string }> {
  const pages = await pdfPages(bytes);
  if (!isEssStatement(pages)) {
    throw new UserError('This does not look like an employee share scheme statement (the ATO-format year-end statement from your employer). Enter the amounts on the Deductions & other records tab instead.');
  }
  return { ...parseEssStatement(pages), token: hold(ctx, fileName, bytes), fileName };
}

export interface EssInput {
  fy: string;
  employer: string;
  taxedUpfrontReductionCents: number;
  taxedUpfrontCents: number;
  deferralCents: number;
  tfnWithheldCents: number;
  date?: ISODate | null;
  token?: string | null;
  keepFile?: boolean;
}

const ESS_LINES: [keyof Pick<EssInput, 'taxedUpfrontReductionCents' | 'taxedUpfrontCents' | 'deferralCents' | 'tfnWithheldCents'>, TaxEntryKind, string][] = [
  ['taxedUpfrontReductionCents', 'ess-taxed-upfront-reduction', 'D'],
  ['taxedUpfrontCents', 'ess-taxed-upfront', 'E'],
  ['deferralCents', 'ess-deferral', 'F'],
  ['tfnWithheldCents', 'ess-tfn-withheld', 'C'],
];

/** Save the amounts from one statement as tax records. Saving the same employer's statement again replaces it. */
export function saveEssStatement(ctx: Ctx, store: DocumentStore | null, e: EssInput): { saved: number } {
  if (!/^\d{4}-\d{2}$/.test(e.fy)) throw new UserError('Choose the income year the statement is for.');
  const employer = e.employer.trim() || 'Employer';
  const prefix = `Employee share scheme – ${employer}`;
  const now = ctx.now();
  let saved = 0;
  const ids: string[] = [];
  ctx.db.tx(() => {
    ctx.db.run(`DELETE FROM tax_entries WHERE fy = ? AND kind LIKE 'ess-%' AND description IN (${ESS_LINES.map(() => '?').join(',')})`, [e.fy, ...ESS_LINES.map(([, , l]) => `${prefix} (${l})`)]);
    for (const [key, kind, letter] of ESS_LINES) {
      const cents = e[key];
      if (!Number.isSafeInteger(cents) || cents < 0) throw new UserError('Amounts cannot be negative.');
      if (cents === 0) continue;
      const id = ctx.id();
      ctx.db.run('INSERT INTO tax_entries(id, fy, kind, description, amount_cents, date, created_at) VALUES(?,?,?,?,?,?,?)', [id, e.fy, kind, `${prefix} (${letter})`, cents, e.date ?? null, now]);
      ids.push(id);
      saved++;
    }
  });
  if (e.keepFile && store) {
    const doc = keep(ctx, store, e.token, 'other', `Employee share scheme statement ${e.fy}`);
    if (doc) for (const id of ids) linkDocument(ctx, doc, 'tax-entry', id);
  }
  ctx.changed('tax');
  return { saved };
}

/* ------------------------------ payslips ------------------------------ */

export async function readPayslip(ctx: Ctx, fileName: string, bytes: Uint8Array): Promise<PayslipRead & { token: string; fileName: string }> {
  const pages = await pdfPages(bytes);
  return { ...parsePayslip(pages), token: hold(ctx, fileName, bytes), fileName };
}

/** Keep the payslip file that was read, linked to the saved payslip. */
export function keepPayslipFile(ctx: Ctx, store: DocumentStore, token: string, payslipId: string): void {
  const doc = keep(ctx, store, token, 'payslip', 'Payslip read at entry');
  if (doc) linkDocument(ctx, doc, 'payslip', payslipId);
}
