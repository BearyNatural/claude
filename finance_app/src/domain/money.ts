/**
 * Money is stored and calculated as integer cents (AUD) everywhere in the app.
 * Floating point is only used inside calculations (interest, averages) and is
 * rounded back to cents at clearly defined points.
 */
export type Cents = number;

/** Round a (possibly fractional) cents value to whole cents, half away from zero. */
export function roundCents(value: number): Cents {
  if (!Number.isFinite(value)) throw new Error('Cannot round a non-finite amount');
  const sign = value < 0 ? -1 : 1;
  // The small epsilon protects values like 12.4999999999 that are really 12.5.
  return sign * Math.round(Math.abs(value) + 1e-9) || 0;
}

export function dollarsToCents(dollars: number): Cents {
  return roundCents(dollars * 100);
}

export function centsToDollars(cents: Cents): number {
  return cents / 100;
}

/**
 * Parse a money string exactly (no floating point) into cents.
 * Accepts: "$1,234.56", "-1234.5", "(12.00)", "12.00 CR", "12.00DR", "+5", "1 234,56"? (no: AU uses '.' decimals),
 * "12.00-" (trailing minus), "−12.00" (unicode minus).
 * Returns null when the text is empty or not a recognisable amount.
 * CR/DR suffixes are reported via `indicator` so the caller can decide the sign convention.
 */
export function parseMoney(input: string | number | null | undefined): { cents: Cents; indicator: 'CR' | 'DR' | null } | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return { cents: dollarsToCents(input), indicator: null };
  }
  let s = String(input).trim();
  if (!s || s === '-' || s === '--') return null;
  s = s.replace(/[−‒–—]/g, '-'); // unicode minus/dashes
  let negative = false;
  let indicator: 'CR' | 'DR' | null = null;

  const ind = s.match(/\s*(CR|DR|Cr|Dr|cr|dr)\.?$/);
  if (ind) {
    indicator = ind[1].toUpperCase() as 'CR' | 'DR';
    s = s.slice(0, ind.index).trim();
  }
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }
  s = s.replace(/^(AUD|A\$|AU\$)\s*/i, '').replace(/^\$\s*/, '').replace(/\s*(AUD)$/i, '');
  if (s.startsWith('-')) {
    // "$-12.00"
    negative = !negative;
    s = s.slice(1).trim();
  }
  s = s.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  let cents = parseInt(whole || '0', 10) * 100;
  if (frac.length === 0) {
    // nothing
  } else if (frac.length === 1) {
    cents += parseInt(frac, 10) * 10;
  } else if (frac.length === 2) {
    cents += parseInt(frac, 10);
  } else {
    // More than 2 decimals: round half away from zero on the third digit.
    const two = parseInt(frac.slice(0, 2), 10);
    const rest = parseInt(frac[2], 10);
    cents += two + (rest >= 5 ? 1 : 0);
  }
  if (!Number.isSafeInteger(cents)) return null;
  return { cents: negative ? -cents : cents, indicator };
}

export interface FormatMoneyOptions {
  /** Show "+" for positive amounts. */
  signed?: boolean;
  /** Omit cents (rounded to whole dollars). */
  wholeDollars?: boolean;
  /** Use "−$1.00" style (default) or "($1.00)". */
  negativeStyle?: 'minus' | 'parentheses';
}

export function formatMoney(cents: Cents, opts: FormatMoneyOptions = {}): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  let body: string;
  if (opts.wholeDollars) {
    body = Math.round(abs / 100).toLocaleString('en-AU');
  } else {
    const dollars = Math.floor(abs / 100);
    const c = abs % 100;
    body = `${dollars.toLocaleString('en-AU')}.${String(c).padStart(2, '0')}`;
  }
  if (negative) return opts.negativeStyle === 'parentheses' ? `($${body})` : `-$${body}`;
  if (opts.signed && cents > 0) return `+$${body}`;
  return `$${body}`;
}

/**
 * Split an amount into parts proportional to weights so the parts always add up exactly
 * (largest-remainder method). Used for split transactions and business/private allocation.
 */
export function allocate(total: Cents, weights: number[]): Cents[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('Allocation weights must add up to more than zero');
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / sum);
  const floors = raw.map(Math.floor);
  let remainder = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors.map((f) => sign * f || 0);
}

export function sumCents(values: Iterable<Cents>): Cents {
  let t = 0;
  for (const v of values) t += v;
  return t;
}

/** Percentage (0–100) of a total, rounded to cents. */
export function percentOf(total: Cents, percent: number): Cents {
  return roundCents((total * percent) / 100);
}
