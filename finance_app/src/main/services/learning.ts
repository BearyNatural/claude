import { Ctx, getSettings, json, str } from './core';
import { buildLines, PdfTextPage, splitAccountSections } from '../../domain/import/pdfStatement';
import {
  combine, Combined, Doc, examplesFrom, Example, FieldSpec, Fingerprint, LayoutField, learnLayoutFields, ModelData, MODEL_MIN_DOCUMENTS,
  MODEL_MIN_FIELD_EXAMPLES, NONE, readDocument, SAME_LAYOUT, similarity, trainModel,
} from '../../domain/learning/documentLearning';

/**
 * Stores and uses what Geranium learns from the documents a person confirms: learned layouts and
 * the on-device model (see domain/learning/documentLearning.ts). Everything stays in the person's
 * encrypted database; nothing is shared, and both parts can be switched off or forgotten in Settings.
 */

export type LearnKind = 'payslip' | 'statement';

export const FIELD_SPECS: Record<LearnKind, FieldSpec[]> = {
  payslip: [
    { name: 'gross', kind: 'money', label: 'gross pay' },
    { name: 'allowances', kind: 'money', label: 'allowances' },
    { name: 'salarySacrifice', kind: 'money', label: 'salary sacrifice' },
    { name: 'payg', kind: 'money', label: 'tax withheld' },
    { name: 'employerSuper', kind: 'money', label: 'employer super' },
    { name: 'net', kind: 'money', label: 'net pay' },
    { name: 'payDate', kind: 'date', label: 'pay date' },
    { name: 'periodStart', kind: 'date', label: 'period start' },
    { name: 'periodEnd', kind: 'date', label: 'period end' },
    { name: 'employer', kind: 'constant', label: 'employer' },
  ],
  statement: [
    { name: 'opening', kind: 'money', label: 'opening balance' },
    { name: 'closing', kind: 'money', label: 'closing balance' },
  ],
};

const KIND_LABEL: Record<LearnKind, string> = { payslip: 'Payslip', statement: 'Statement' };
/** Training uses the most recent confirmed documents of each kind. */
const MAX_TRAINING_DOCUMENTS = 300;

export function docFromPages(pages: PdfTextPage[]): Doc {
  return readDocument(buildLines(pages), pages);
}

/** One document per account section, matching parsePdfStatements' statements one for one. */
export function statementDocs(pages: PdfTextPage[]): Doc[] {
  return splitAccountSections(buildLines(pages)).map((lines) => readDocument(lines, pages));
}

interface LayoutRow { id: string; kind: LearnKind; name: string; fingerprint: Fingerprint; fields: Record<string, LayoutField>; documents: number; createdAt: string; updatedAt: string; lastUsedAt: string | null }

function layouts(ctx: Ctx, kind?: LearnKind): LayoutRow[] {
  return ctx.db.all(`SELECT * FROM learned_layouts ${kind ? 'WHERE kind = ?' : ''} ORDER BY updated_at DESC`, kind ? [kind] : []).map((r) => ({
    id: String(r.id), kind: r.kind as LearnKind, name: String(r.name), fingerprint: json<Fingerprint>(r.fingerprint, { abn: null, labels: [] }),
    fields: json<Record<string, LayoutField>>(r.fields, {}), documents: Number(r.documents), createdAt: String(r.created_at), updatedAt: String(r.updated_at), lastUsedAt: str(r.last_used_at),
  }));
}

function bestLayout(ctx: Ctx, kind: LearnKind, fp: Fingerprint): LayoutRow | null {
  let best: LayoutRow | null = null;
  let bestSim = SAME_LAYOUT;
  for (const l of layouts(ctx, kind)) {
    const sim = similarity(l.fingerprint, fp);
    if (sim >= bestSim) { best = l; bestSim = sim; }
  }
  return best;
}

function loadModel(ctx: Ctx, kind: LearnKind): ModelData | null {
  const v = ctx.db.scalar<string>('SELECT model FROM learning_models WHERE kind = ?', [kind]);
  return v ? json<ModelData | null>(v, null) : null;
}

export interface Learned extends Combined {
  /** The learned layout used, if any. */
  layout: { name: string; documents: number; updatedAt: string } | null;
}

/** Read a document's fields with what has been learned: a learned layout, then the model, then the built-in rules. */
export function applyLearning(ctx: Ctx, kind: LearnKind, doc: Doc, rules: Record<string, number | string | null>): Learned {
  const s = getSettings(ctx).documentLearning;
  const layout = s.layouts ? bestLayout(ctx, kind, doc.fingerprint) : null;
  const model = s.model ? loadModel(ctx, kind) : null;
  const r = combine(doc, FIELD_SPECS[kind], rules, layout?.fields ?? null, model, { signed: kind === 'statement' });
  const used = layout && Object.values(r.sources).includes('layout');
  if (used) ctx.db.run('UPDATE learned_layouts SET last_used_at = ? WHERE id = ?', [ctx.now(), layout.id]);
  return { ...r, layout: used ? { name: layout.name, documents: layout.documents, updatedAt: layout.updatedAt } : null };
}

/**
 * Learn from a document the person has just confirmed (saved). Updates or creates its learned
 * layout and retrains the model, as switched on in Settings.
 */
export function learnFrom(ctx: Ctx, kind: LearnKind, doc: Doc, confirmed: Record<string, number | string | null | undefined>, name: string): void {
  const s = getSettings(ctx).documentLearning;
  const specs = FIELD_SPECS[kind];
  const now = ctx.now();
  let layoutId: string | null = null;
  ctx.db.tx(() => {
    if (s.layouts) {
      const fields = learnLayoutFields(doc, specs, confirmed);
      if (Object.keys(fields).some((k) => 'anchor' in fields[k])) {
        const existing = bestLayout(ctx, kind, doc.fingerprint);
        if (existing) {
          layoutId = existing.id;
          ctx.db.run('UPDATE learned_layouts SET name = ?, fingerprint = ?, fields = ?, documents = documents + 1, updated_at = ? WHERE id = ?',
            [name || existing.name, JSON.stringify(doc.fingerprint), JSON.stringify({ ...existing.fields, ...fields }), now, existing.id]);
        } else {
          layoutId = ctx.id();
          ctx.db.run('INSERT INTO learned_layouts(id, kind, name, fingerprint, fields, documents, created_at, updated_at) VALUES(?,?,?,?,?,1,?,?)',
            [layoutId, kind, name || KIND_LABEL[kind], JSON.stringify(doc.fingerprint), JSON.stringify(fields), now, now]);
        }
      }
    }
    if (s.model) {
      const ex = examplesFrom(doc, specs, confirmed);
      if (ex.some((e) => e.label !== NONE)) {
        ctx.db.run('INSERT INTO learning_examples(id, kind, layout_id, examples, created_at) VALUES(?,?,?,?,?)', [ctx.id(), kind, layoutId, JSON.stringify(ex), now]);
        retrain(ctx, kind);
      }
    }
  });
  ctx.changed('learning');
}

function retrain(ctx: Ctx, kind: LearnKind): void {
  const docs = ctx.db.all('SELECT examples FROM learning_examples WHERE kind = ? ORDER BY created_at DESC LIMIT ?', [kind, MAX_TRAINING_DOCUMENTS]);
  if (!docs.length) { ctx.db.run('DELETE FROM learning_models WHERE kind = ?', [kind]); return; }
  const examples = docs.flatMap((r) => json<Example[]>(r.examples, []));
  const fields = FIELD_SPECS[kind].filter((f) => f.kind !== 'constant').map((f) => f.name);
  const model = trainModel(examples, fields, docs.length, ctx.now());
  ctx.db.run('INSERT INTO learning_models(kind, model, trained_at) VALUES(?,?,?) ON CONFLICT(kind) DO UPDATE SET model = excluded.model, trained_at = excluded.trained_at',
    [kind, JSON.stringify(model), model.trainedAt]);
}

/* ------------------------------ Settings › Imports ------------------------------ */

export function learningOverview(ctx: Ctx) {
  const labels = (kind: LearnKind) => new Map(FIELD_SPECS[kind].map((f) => [f.name, f.label]));
  return {
    settings: getSettings(ctx).documentLearning,
    minDocuments: MODEL_MIN_DOCUMENTS,
    layouts: layouts(ctx).map((l) => ({
      id: l.id, kind: l.kind, kindLabel: KIND_LABEL[l.kind], name: l.name, documents: l.documents, createdAt: l.createdAt, updatedAt: l.updatedAt, lastUsedAt: l.lastUsedAt,
      fields: Object.keys(l.fields).map((k) => labels(l.kind).get(k) ?? k),
    })),
    models: (Object.keys(FIELD_SPECS) as LearnKind[]).map((kind) => {
      const m = loadModel(ctx, kind);
      const documents = Number(ctx.db.scalar('SELECT COUNT(*) FROM learning_examples WHERE kind = ?', [kind]) ?? 0);
      return {
        kind, kindLabel: KIND_LABEL[kind], documents, trainedAt: m?.trainedAt ?? null, ready: !!m && m.documents >= MODEL_MIN_DOCUMENTS,
        fields: FIELD_SPECS[kind].filter((f) => f.kind !== 'constant').map((f) => ({ label: f.label, examples: m?.positives[f.name] ?? 0, ready: (m?.positives[f.name] ?? 0) >= MODEL_MIN_FIELD_EXAMPLES })),
      };
    }),
  };
}

export function deleteLayout(ctx: Ctx, id: string): void {
  ctx.db.run('DELETE FROM learned_layouts WHERE id = ?', [id]);
  ctx.changed('learning');
}

/** Forget what the model has learned (its training examples and the model itself). */
export function forgetModel(ctx: Ctx): void {
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM learning_examples');
    ctx.db.run('DELETE FROM learning_models');
  });
  ctx.changed('learning');
}
