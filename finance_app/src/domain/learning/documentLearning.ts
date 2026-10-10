import { parseMoney } from '../money';
import { ISODate } from '../dates';
import { parseDateAs } from '../import/dateFormats';
import { isMoneyToken, PdfTextPage } from '../import/pdfStatement';
import { ytdZones } from '../import/payslip';

/**
 * Learning from the person's own documents, on their own device. Two parts:
 *
 * 1. Learned layouts (rules-based). When a document read from a file is confirmed, each confirmed
 *    figure is found in the document and remembered by what surrounds it — the label beside it,
 *    the heading above it, the words before it in the same cell. The next document with the same
 *    layout (same headings; for payslips, the same employer ABN) is read the same way.
 *
 * 2. A small machine-learning model (multinomial logistic regression) trained only on the
 *    documents the person has confirmed. Every number and date on a page is described by the
 *    words around it and where it sits, and the model learns which descriptions mean "gross pay",
 *    "tax withheld" and so on. It helps with layouts that have no learned layout yet.
 *
 * Nothing here talks to a network; the caller stores layouts, examples and the model in the
 * person's encrypted database.
 */

export type FieldKind = 'money' | 'date' | 'constant';
export interface FieldSpec { name: string; kind: FieldKind; label: string }

interface Cell { text: string; x0: number; x1: number }
export interface DocLine { page: number; y: number; cells: Cell[]; text: string }

/** A number or date on the page that could be the value of a field. */
export interface Candidate {
  /** Position in document order. */
  index: number;
  kind: 'money' | 'date';
  /** Signed amount as printed (DR / minus / brackets negative). */
  cents?: number;
  date?: ISODate;
  /** What surrounds it (normalised words). */
  lab: string;
  inp: string;
  hd: string;
  sec: string;
  sub: number;
  ytd: boolean;
  features: string[];
}

export interface Fingerprint { abn: string | null; labels: string[] }

export interface Doc { lines: DocLine[]; candidates: Candidate[]; fingerprint: Fingerprint }

/** Where a field's value was found, so the same place can be found in the next document. */
export interface Anchor { lab: string; inp: string; hd: string; sec: string; sub: number; ytd: boolean; order: number }

export type LayoutField = { anchor: Anchor } | { constant: string };

export interface ModelData {
  classes: string[];
  weights: Record<string, number[]>;
  bias: number[];
  /** Confirmed documents the model was trained on, and how many times each field was seen. */
  documents: number;
  positives: Record<string, number>;
  trainedAt: string;
}

export interface Example { features: string[]; label: string }

export const NONE = '_none';
/** The model is only used once it has been trained on this many confirmed documents… */
export const MODEL_MIN_DOCUMENTS = 5;
/** …and only for fields it has seen at least this many times. */
export const MODEL_MIN_FIELD_EXAMPLES = 3;
/** Probability needed to fill a field the built-in rules missed, and to overrule them. */
export const MODEL_FILL_P = 0.55;
export const MODEL_OVERRULE_P = 0.85;

/* ------------------------------ reading a document ------------------------------ */

const words = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ' ').split(' ').filter((w) => w.length >= 2 && w.length <= 20);
const norm = (s: string) => words(s).join(' ');
const hasLetters = (s: string) => /[a-z]{2}/i.test(s);

const MONEY_IN_TEXT = /\(?-?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\)?(?:\s?(?:CR|DR))?|\(?-?\$?\s?\d+\.\d{2}\)?(?:\s?(?:CR|DR))?/gi;
const DATE_IN_TEXT = /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?[\s-]+[A-Za-z]{3,9}\.?,?[\s-]+\d{4}|\d{4}-\d{2}-\d{2}/g;

function toDate(s: string): ISODate | null {
  const t = s.trim().replace(/(\d)(st|nd|rd|th)/, '$1').replace(',', '');
  return parseDateAs(t, 'DMY') ?? parseDateAs(t, 'D-MON-Y') ?? parseDateAs(t, 'YMD');
}

function signedCents(s: string): number | null {
  const p = parseMoney(s.trim());
  if (!p) return null;
  return p.indicator === 'DR' ? -Math.abs(p.cents) : p.cents;
}

const bucket = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(v * n)));

export function readDocument(lines: DocLine[], pages: Pick<PdfTextPage, 'pageNumber' | 'width' | 'height'>[]): Doc {
  const size = new Map(pages.map((p) => [p.pageNumber, p]));
  const zones = ytdZones(lines as never);
  const inYtd = (c: Cell, l: DocLine) => zones.some((z) => z.page === l.page && l.y <= z.top && l.y >= z.bottom && c.x1 > z.x0 && c.x0 < z.x1);
  const isTextCell = (c: Cell) => hasLetters(c.text) && !isMoneyToken(c.text);

  const raw: Omit<Candidate, 'features' | 'index'>[] = [];
  const extra: { pos: string; x: number; y: number }[] = [];
  lines.forEach((l, li) => {
    const found: { ci: number; sub: number; kind: 'money' | 'date'; cents?: number; date?: ISODate; prefix: string }[] = [];
    l.cells.forEach((c, ci) => {
      if (isMoneyToken(c.text)) {
        const cents = signedCents(c.text);
        if (cents) found.push({ ci, sub: 0, kind: 'money', cents, prefix: '' });
        return;
      }
      const whole = toDate(c.text);
      if (whole) { found.push({ ci, sub: 0, kind: 'date', date: whole, prefix: '' }); return; }
      let sub = 0;
      for (const m of c.text.matchAll(DATE_IN_TEXT)) {
        const d = toDate(m[0]);
        if (d) found.push({ ci, sub: sub++, kind: 'date', date: d, prefix: c.text.slice(0, m.index) });
      }
      sub = 0;
      for (const m of c.text.replace(DATE_IN_TEXT, ' ').matchAll(MONEY_IN_TEXT)) {
        const cents = signedCents(m[0]);
        if (cents) found.push({ ci, sub: sub++, kind: 'money', cents, prefix: c.text.slice(0, c.text.indexOf(m[0].trim())) });
      }
    });
    found.forEach((f, k) => {
      const cell = l.cells[f.ci];
      // The label: the nearest text cell to the left on the same line.
      let lab = '';
      for (let j = f.ci - 1; j >= 0; j--) if (isTextCell(l.cells[j])) { lab = norm(l.cells[j].text); break; }
      // The heading: the nearest text cell above in the same column.
      let hd = '';
      for (let j = li - 1; j >= 0 && j >= li - 6; j--) {
        const up = lines[j];
        if (up.page !== l.page || up.y - l.y > 80) break;
        const h = up.cells.find((u) => isTextCell(u) && u.x1 > cell.x0 - 15 && u.x0 < cell.x1 + 15);
        if (h) { hd = norm(h.text); break; }
      }
      // The section: the nearest line above that is a single title.
      let sec = '';
      for (let j = li - 1; j >= 0 && j >= li - 30; j--) {
        const up = lines[j];
        if (up.page !== l.page) break;
        if (up.cells.length === 1 && isTextCell(up.cells[0])) { sec = norm(up.cells[0].text); break; }
      }
      raw.push({ kind: f.kind, cents: f.cents, date: f.date, lab, inp: norm(f.prefix), hd, sec, sub: f.sub, ytd: inYtd(cell, l) });
      const p = size.get(l.page);
      extra.push({
        pos: found.length === 1 ? 'only' : k === 0 ? 'first' : k === found.length - 1 ? 'last' : 'mid',
        x: p ? (cell.x0 + cell.x1) / 2 / p.width : 0.5,
        y: p ? 1 - l.y / p.height : 0.5,
      });
    });
  });

  // How large an amount is compared with the others on the page (gross and net are among the largest).
  const amounts = raw.filter((r) => r.kind === 'money').map((r) => Math.abs(r.cents!)).sort((a, b) => b - a);
  const candidates: Candidate[] = raw.map((r, i) => {
    const f = [`type:${r.kind}`, `pos:${extra[i].pos}`, `x:${bucket(extra[i].x, 5)}`, `y:${bucket(extra[i].y, 5)}`, `sub:${Math.min(r.sub, 2)}`];
    if (r.ytd) f.push('ytd');
    if (r.kind === 'money') {
      if (r.cents! < 0) f.push('neg');
      const rank = amounts.indexOf(Math.abs(r.cents!));
      f.push(`rank:${rank === 0 ? 0 : rank < 3 ? 1 : rank < 8 ? 2 : 3}`);
    }
    for (const [p, s] of [['lab', r.lab], ['inp', r.inp], ['hd', r.hd], ['sec', r.sec]] as const) {
      if (!s) { f.push(`${p}:-`); continue; }
      f.push(`${p}=${s}`);
      for (const w of s.split(' ')) {
        f.push(`${p}:${w}`);
        // The same word means much the same whether it is a label, a heading or in the same cell
        // ("Tax" beside a figure in one layout, above it in another), which lets the model carry
        // what it learned to layouts it hasn't seen.
        if (p !== 'sec') f.push(`w:${w}`);
      }
    }
    return { ...r, index: i, features: [...new Set(f)] };
  });

  // Fingerprint: the headings and labels on lines with no amounts or dates (the layout, not the content).
  const labels = new Set<string>();
  const valueLines = new Set<number>();
  const hasDate = new RegExp(DATE_IN_TEXT.source);
  lines.forEach((l, li) => { if (l.cells.some((c) => isMoneyToken(c.text) || hasDate.test(c.text))) valueLines.add(li); });
  lines.forEach((l, li) => {
    if (valueLines.has(li)) return;
    for (const c of l.cells) {
      if (/\d/.test(c.text)) continue;
      const n = norm(c.text);
      if (n.length >= 3 && n.length <= 40) labels.add(n);
    }
  });
  const abn = lines.map((l) => l.text).join('\n').match(/\bABN\b\)?\s*:?\s*(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})/i);
  return { lines, candidates, fingerprint: { abn: abn ? abn[1].replace(/\s/g, '') : null, labels: [...labels].sort().slice(0, 200) } };
}

/* ------------------------------ learned layouts ------------------------------ */

export function similarity(a: Fingerprint, b: Fingerprint): number {
  const A = new Set(a.labels);
  const B = new Set(b.labels);
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  const j = union ? inter / union : 0;
  if (a.abn && b.abn) return a.abn === b.abn ? Math.min(1, j + 0.35) : j * 0.5;
  return j;
}

/** Same layout: mostly the same headings (an ABN match counts for a lot on payslips). */
export const SAME_LAYOUT = 0.55;

function sameValue(c: Candidate, kind: FieldKind, value: number | string): boolean {
  if (kind === 'money') return c.kind === 'money' && Math.abs(c.cents!) === Math.abs(value as number);
  if (kind === 'date') return c.kind === 'date' && c.date === value;
  return false;
}

const anchorOf = (c: Candidate, doc: Doc): Anchor => {
  const twins = doc.candidates.filter((d) => d.kind === c.kind && d.lab === c.lab && d.inp === c.inp && d.hd === c.hd && d.ytd === c.ytd);
  return { lab: c.lab, inp: c.inp, hd: c.hd, sec: c.sec, sub: c.sub, ytd: c.ytd, order: Math.max(0, twins.indexOf(c)) };
};

/** Find where a confirmed value sits. Prefers this-pay figures with a label over year-to-date copies. */
export function locate(doc: Doc, spec: FieldSpec, value: number | string): Candidate | null {
  if (spec.kind === 'constant') return null;
  if (spec.kind === 'money' && (value as number) === 0) return null;
  const matches = doc.candidates.filter((c) => sameValue(c, spec.kind, value));
  if (!matches.length) return null;
  return [...matches].sort((a, b) => Number(a.ytd) - Number(b.ytd) || Number(!(a.lab || a.inp || a.hd)) - Number(!(b.lab || b.inp || b.hd)) || a.index - b.index)[0];
}

export function learnLayoutFields(doc: Doc, specs: FieldSpec[], confirmed: Record<string, number | string | null | undefined>): Record<string, LayoutField> {
  const out: Record<string, LayoutField> = {};
  for (const spec of specs) {
    const v = confirmed[spec.name];
    if (v === null || v === undefined || v === '') continue;
    if (spec.kind === 'constant') { out[spec.name] = { constant: String(v).trim() }; continue; }
    const c = locate(doc, spec, v);
    if (c) out[spec.name] = { anchor: anchorOf(c, doc) };
  }
  return out;
}

/** Find a learned field in a new document of the same layout. */
export function resolveAnchor(doc: Doc, kind: 'money' | 'date', a: Anchor): Candidate | null {
  let best: Candidate[] = [];
  let bestScore = 0;
  for (const c of doc.candidates) {
    if (c.kind !== kind) continue;
    if (c.ytd !== a.ytd) continue;
    const strong = (a.lab && c.lab === a.lab ? 3 : 0) + (a.inp && c.inp === a.inp ? 3 : 0) + (a.hd && c.hd === a.hd ? 2 : 0);
    if (!strong) continue;
    const score = strong + (a.sec && c.sec === a.sec ? 1 : 0) + (c.sub === a.sub ? 0.5 : 0);
    if (score > bestScore) { bestScore = score; best = [c]; } else if (score === bestScore) best.push(c);
  }
  if (bestScore < 2.5 || !best.length) return null;
  return best[Math.min(a.order, best.length - 1)];
}

/* ------------------------------ the model ------------------------------ */

/** Training examples from one confirmed document: each candidate labelled with its field, or none. */
export function examplesFrom(doc: Doc, specs: FieldSpec[], confirmed: Record<string, number | string | null | undefined>): Example[] {
  const labelled = new Map<number, string>();
  const ambiguous = new Set<number>();
  for (const spec of specs) {
    const v = confirmed[spec.name];
    if (spec.kind === 'constant' || v === null || v === undefined || v === '') continue;
    const c = locate(doc, spec, v);
    if (!c) continue;
    labelled.set(c.index, spec.name);
    // Other copies of the same value (a year-to-date column on the first pay of the year) are left
    // out rather than taught as "not this field".
    for (const d of doc.candidates) if (d !== c && sameValue(d, spec.kind, v)) ambiguous.add(d.index);
  }
  return doc.candidates.filter((c) => !ambiguous.has(c.index) || labelled.has(c.index)).map((c) => ({ features: c.features, label: labelled.get(c.index) ?? NONE }));
}

/** Multinomial logistic regression, trained by gradient descent with L2 regularisation. */
export function trainModel(examples: Example[], fields: string[], documents: number, now: string): ModelData {
  const classes = [NONE, ...fields];
  const C = classes.length;
  const cls = new Map(classes.map((c, i) => [c, i]));
  const data = examples.filter((e) => cls.has(e.label)).map((e) => ({ f: e.features, y: cls.get(e.label)! }));
  const W = new Map<string, Float64Array>();
  for (const d of data) for (const f of d.f) if (!W.has(f)) W.set(f, new Float64Array(C));
  const b = new Float64Array(C);
  const positives: Record<string, number> = {};
  for (const d of data) if (d.y !== 0) positives[classes[d.y]] = (positives[classes[d.y]] ?? 0) + 1;
  // "None" outnumbers every field many times over; weigh it down so fields are still learned.
  const weight = (y: number) => (y === 0 ? 0.25 : 1);
  const N = Math.max(1, data.length);
  const lr = 0.8, l2 = 1e-4, epochs = 160;
  const z = new Float64Array(C);
  for (let e = 0; e < epochs; e++) {
    const gW = new Map<string, Float64Array>();
    const gb = new Float64Array(C);
    for (const d of data) {
      z.set(b);
      for (const f of d.f) { const w = W.get(f)!; for (let c = 0; c < C; c++) z[c] += w[c]; }
      let max = -Infinity;
      for (let c = 0; c < C; c++) max = Math.max(max, z[c]);
      let sum = 0;
      for (let c = 0; c < C; c++) { z[c] = Math.exp(z[c] - max); sum += z[c]; }
      const wt = weight(d.y);
      for (let c = 0; c < C; c++) {
        const g = wt * (z[c] / sum - (c === d.y ? 1 : 0));
        if (g === 0) continue;
        gb[c] += g;
        for (const f of d.f) { let gw = gW.get(f); if (!gw) { gw = new Float64Array(C); gW.set(f, gw); } gw[c] += g; }
      }
    }
    for (let c = 0; c < C; c++) b[c] -= (lr * gb[c]) / N;
    for (const [f, w] of W) {
      const g = gW.get(f);
      for (let c = 0; c < C; c++) w[c] -= lr * ((g ? g[c] : 0) / N + l2 * w[c]);
    }
  }
  const weights: Record<string, number[]> = {};
  for (const [f, w] of W) if (w.some((x) => Math.abs(x) > 1e-4)) weights[f] = Array.from(w, (x) => Math.round(x * 1e4) / 1e4);
  return { classes, weights, bias: Array.from(b), documents, positives, trainedAt: now };
}

export function probabilities(model: ModelData, features: string[]): number[] {
  const C = model.classes.length;
  const z = model.bias.slice();
  for (const f of features) { const w = model.weights[f]; if (w) for (let c = 0; c < C; c++) z[c] += w[c]; }
  const max = Math.max(...z);
  const e = z.map((v) => Math.exp(v - max));
  const s = e.reduce((a, v) => a + v, 0);
  return e.map((v) => v / s);
}

/** The model's best candidate for each field it is ready to help with (one candidate per field). */
export function modelPredictions(model: ModelData, doc: Doc, specs: FieldSpec[]): Record<string, { candidate: Candidate; p: number }> {
  const out: Record<string, { candidate: Candidate; p: number }> = {};
  if (model.documents < MODEL_MIN_DOCUMENTS) return out;
  const probs = doc.candidates.map((c) => probabilities(model, c.features));
  const options: { field: string; c: Candidate; p: number }[] = [];
  for (const spec of specs) {
    if (spec.kind === 'constant') continue;
    const ci = model.classes.indexOf(spec.name);
    if (ci < 0 || (model.positives[spec.name] ?? 0) < MODEL_MIN_FIELD_EXAMPLES) continue;
    doc.candidates.forEach((c, i) => { if (c.kind === spec.kind) options.push({ field: spec.name, c, p: probs[i][ci] }); });
  }
  const used = new Set<number>();
  for (const o of options.sort((a, b) => b.p - a.p)) {
    if (out[o.field] || used.has(o.c.index) || o.p < MODEL_FILL_P) continue;
    out[o.field] = { candidate: o.c, p: o.p };
    used.add(o.c.index);
  }
  return out;
}

/* ------------------------------ putting it together ------------------------------ */

export type Source = 'layout' | 'model' | 'rules';

export interface Combined {
  values: Record<string, number | string | null>;
  sources: Record<string, Source>;
}

const valueOf = (c: Candidate, spec: FieldSpec, signed: boolean) => (spec.kind === 'date' ? c.date! : signed ? c.cents! : Math.abs(c.cents!));

/**
 * A learned layout comes first, then the model (when it is confident), then the built-in rules.
 * The model only overrules the built-in rules when it is very sure.
 */
export function combine(doc: Doc, specs: FieldSpec[], rules: Record<string, number | string | null>, layout: Record<string, LayoutField> | null, model: ModelData | null, opts: { signed?: boolean } = {}): Combined {
  const values: Record<string, number | string | null> = { ...rules };
  const sources: Record<string, Source> = {};
  for (const k of Object.keys(rules)) if (rules[k] !== null && rules[k] !== undefined) sources[k] = 'rules';
  const predicted = model ? modelPredictions(model, doc, specs) : {};
  for (const spec of specs) {
    const lf = layout?.[spec.name];
    if (lf && 'constant' in lf) { values[spec.name] = lf.constant; sources[spec.name] = 'layout'; continue; }
    if (lf && 'anchor' in lf && spec.kind !== 'constant') {
      const c = resolveAnchor(doc, spec.kind, lf.anchor);
      if (c) { values[spec.name] = valueOf(c, spec, !!opts.signed); sources[spec.name] = 'layout'; continue; }
    }
    const m = predicted[spec.name];
    if (m && (rules[spec.name] === null || rules[spec.name] === undefined ? m.p >= MODEL_FILL_P : m.p >= MODEL_OVERRULE_P)) {
      values[spec.name] = valueOf(m.candidate, spec, !!opts.signed);
      sources[spec.name] = 'model';
    }
  }
  return { values, sources };
}
