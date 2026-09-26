/**
 * Description cleaning. The original imported description is never changed; these
 * functions derive a readable description, a payee guess and a grouping key.
 */

const PREFIXES = [
  /^(visa|mastercard|eftpos|debit\s+card|card)\s+(purchase|debit|payment|transaction)\s*[-:]?\s*/i,
  /^(visa|mastercard|eftpos)\s+/i,
  /^pos\s+(authorisation|authorization|purchase)\s*/i,
  /^(direct\s+debit|direct\s+credit|dd|dc)\s+\d*\s*/i,
  /^(internet|online|mobile)\s+(banking\s+)?(transfer|payment|bpay)\s*[-:]?\s*/i,
  /^(osko|npp)\s+(payment|deposit|transfer)\s*/i,
  /^(depositmobile|deposit|withdrawal)\s*[-:]\s*/i,
  /^(sq|sp|lsp|zlr|pp|ls)\s*\*\s*/i, // Square, Shopify, Lightspeed, PayPal-style merchant prefixes
  /^paypal\s*\*\s*/i,
];

const NOISE = [
  /\bcard\s*(no\.?|number)?\s*x+\d{2,4}\b/gi,
  /\bx{2,}\d{2,4}\b/gi,
  /\bvalue\s+date:?\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?/gi,
  /\b(receipt|rcpt|ref|reference|trace)\s*(no\.?|number|#)?:?\s*\d+\b/gi,
  /\bauth(orisation)?\s*(no\.?|code)?:?\s*\d+\b/gi,
  /\b(aus|au|aud)\s*$/gi,
  /\s+-\s*$/g,
];

export function cleanDescription(original: string): string {
  let s = (original ?? '').replace(/\s+/g, ' ').trim();
  for (const p of PREFIXES) s = s.replace(p, '');
  for (const n of NOISE) s = s.replace(n, ' ');
  s = s.replace(/\s+/g, ' ').replace(/^[-:,\s]+|[-:,\s]+$/g, '').trim();
  return s || (original ?? '').trim();
}

const GENERIC = new Set(['THE', 'AND', 'OF', 'PTY', 'LTD', 'LIMITED', 'CO', 'INC', 'COM', 'WWW', 'AU', 'AUS', 'AUD', 'NSW', 'QLD', 'VIC', 'WA', 'SA', 'TAS', 'ACT', 'NT']);

/** A stable, uppercase grouping key such as "WOOLWORTHS" or "NETFLIX". */
export function merchantKey(description: string): string {
  const clean = cleanDescription(description)
    .toUpperCase()
    .replace(/\.COM(\.AU)?/g, ' ')
    .replace(/[^A-Z& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = clean.split(' ').filter((w) => w.length > 1 && !GENERIC.has(w));
  if (words.length === 0) return clean || description.toUpperCase().trim();
  if (words[0].length >= 5 || words.length === 1) return words[0];
  return words.slice(0, 2).join(' ');
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Qld|Nsw|Vic|Act|Nt|Wa|Sa|Tas)\b/g, (m) => m.toUpperCase())
    .replace(/\bBp\b/, 'BP')
    .replace(/\bAgl\b/, 'AGL');
}

/** A readable payee guess: store numbers and locations removed ("Woolworths"). */
export function guessPayee(description: string): string {
  const clean = cleanDescription(description);
  // Stop at the first store number or long digit run.
  const cut = clean.split(/\s+\d{2,}\b|\s{2,}/)[0] ?? clean;
  const words = cut.split(' ').slice(0, 4).join(' ');
  return titleCase(words.replace(/[*#]+/g, ' ').replace(/\s+/g, ' ').trim()) || titleCase(clean);
}
