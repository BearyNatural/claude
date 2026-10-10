import { Ctx, UserError, getSecretValue, setSecretValue } from './core';
import { extractPdfText } from '../import/pdfExtract';
import { isEssStatement, parseEssStatement, EssStatement } from '../../domain/import/essStatement';
import { formatAbn, parsePayslip, PayslipRead } from '../../domain/import/payslip';
import { ISODate } from '../../domain/dates';
import { DocumentStore, addDocument, linkDocument } from './documents';
import { applyLearning, docFromPages, FIELD_SPECS, learnFrom } from './learning';
import type { Doc, Source } from '../../domain/learning/documentLearning';
import { TaxEntryKind } from './taxes';

/**
 * Tax documents read from PDFs: employee share scheme statements and payslips. Reading never
 * saves anything — the figures are shown for checking first. The chosen file is held in memory
 * (briefly, for one file at a time) so a copy can be kept with the saved records if asked.
 */

const held = new Map<string, { fileName: string; bytes: Uint8Array; at: number; abn?: string | null; doc?: Doc }>();
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

/** Employer names typed in for payslips that only print the employer's ABN, by ABN. */
const EMPLOYERS_KEY = 'payslipEmployersByAbn';

const PAYSLIP_FIELD_NAME: Record<string, string> = { gross: 'gross pay', payg: 'tax withheld', net: 'net pay' };

export type PayslipReadResult = PayslipRead & {
  token: string;
  fileName: string;
  /** How each field was found: a learned layout, the on-device model, or the built-in rules. */
  sources: Record<string, Source>;
  /** Said when a learned layout was used. */
  learnedNote: string | null;
};

export async function readPayslip(ctx: Ctx, fileName: string, bytes: Uint8Array): Promise<PayslipReadResult> {
  const pages = await pdfPages(bytes);
  const r = parsePayslip(pages);
  const remembered = r.employerAbn ? getSecretValue<Record<string, string>>(ctx, EMPLOYERS_KEY)?.[r.employerAbn] : undefined;
  if (!r.employer && remembered) r.employer = remembered;

  // What has been learned from earlier payslips comes before the built-in rules.
  const doc = docFromPages(pages);
  const learned = applyLearning(ctx, 'payslip', doc, {
    gross: r.grossCents, allowances: r.allowancesCents, salarySacrifice: r.salarySacrificeCents, payg: r.paygCents, employerSuper: r.employerSuperCents,
    net: r.netCents, payDate: r.payDate, periodStart: r.periodStart, periodEnd: r.periodEnd, employer: r.employer,
  });
  const v = learned.values;
  const money = (k: string) => (v[k] === null || v[k] === undefined ? null : Number(v[k]));
  const date = (k: string) => (v[k] ? String(v[k]) : null);
  Object.assign(r, {
    grossCents: money('gross'), allowancesCents: money('allowances'), salarySacrificeCents: money('salarySacrifice'), paygCents: money('payg'),
    employerSuperCents: money('employerSuper'), netCents: money('net'), payDate: date('payDate'), periodStart: date('periodStart'), periodEnd: date('periodEnd'),
    employer: v.employer ? String(v.employer) : null,
  });
  if (r.grossCents !== null && r.netCents !== null && r.paygCents !== null) {
    r.deductionsCents = Math.max(0, r.grossCents - (r.salarySacrificeCents ?? 0) - r.paygCents - r.netCents);
  }

  // Warnings follow the final figures.
  r.warnings = r.warnings.filter((w) => !/^(Not found on the payslip|The pay date was not found|The employer's name)/.test(w));
  const missing = ['gross', 'payg', 'net'].filter((k) => v[k] === null || v[k] === undefined).map((k) => PAYSLIP_FIELD_NAME[k]);
  if (!r.employer) {
    r.warnings.unshift(`The employer's name is not printed on this payslip${r.employerAbn ? ` (ABN ${formatAbn(r.employerAbn)}). Type it in — Geranium will remember it for this employer's next payslip` : '. Type it in'}.`);
  } else if (remembered && learned.sources.employer === 'rules' && r.employer === remembered) {
    r.warnings.unshift(`The employer's name isn't printed on this payslip; “${remembered}” was filled in from an earlier payslip with ABN ${formatAbn(r.employerAbn!)}.`);
  }
  if (missing.length) r.warnings.push(`Not found on the payslip: ${missing.join(', ')}. Type ${missing.length === 1 ? 'it' : 'them'} in from the payslip.`);
  if (!r.payDate) r.warnings.push('The pay date was not found. Enter it before saving.');
  const sourceNames = Object.keys(learned.sources).filter((k) => learned.sources[k] !== 'rules').map((k) => FIELD_SPECS.payslip.find((f) => f.name === k)?.label ?? k);
  r.found = [...new Set([...r.found, ...sourceNames])];

  const token = hold(ctx, fileName, bytes);
  Object.assign(held.get(token)!, { abn: r.employerAbn, doc });
  return {
    ...r, token, fileName, sources: learned.sources,
    learnedNote: learned.layout ? `Read using the layout Geranium learned from your earlier ${learned.layout.name} payslip${learned.layout.documents === 1 ? '' : 's'} (${learned.layout.documents}).` : null,
  };
}

export interface ConfirmedPayslip {
  employer: string; payDate: string; periodStart?: string | null; periodEnd?: string | null; grossCents: number; allowancesCents: number;
  salarySacrificeCents: number; paygCents: number; employerSuperCents: number; netCents: number;
}

/**
 * After a payslip that was read from a file is saved: learn from the confirmed figures (its layout
 * and the on-device model, as switched on in Settings), remember the employer by ABN, and keep the
 * file if asked.
 */
export function payslipSaved(ctx: Ctx, store: DocumentStore | null, token: string, payslipId: string, p: ConfirmedPayslip, keepFile: boolean): void {
  const f = held.get(token);
  if (!f) return;
  const employer = p.employer.trim();
  if (f.abn && employer) setSecretValue(ctx, EMPLOYERS_KEY, { ...(getSecretValue<Record<string, string>>(ctx, EMPLOYERS_KEY) ?? {}), [f.abn]: employer });
  if (f.doc) {
    learnFrom(ctx, 'payslip', f.doc, {
      gross: p.grossCents, allowances: p.allowancesCents, salarySacrifice: p.salarySacrificeCents, payg: p.paygCents, employerSuper: p.employerSuperCents,
      net: p.netCents, payDate: p.payDate, periodStart: p.periodStart ?? null, periodEnd: p.periodEnd ?? null, employer,
    }, employer);
  }
  if (keepFile && store) {
    const doc = keep(ctx, store, token, 'payslip', 'Payslip read at entry');
    if (doc) linkDocument(ctx, doc, 'payslip', payslipId);
  }
}
