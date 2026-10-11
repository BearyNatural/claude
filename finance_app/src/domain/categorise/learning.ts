import { Confidence } from '../import/types';
import { IncomeType } from './categories';
import { fineMerchantKey, isGenericWord, matchText, merchantKey, nameTokens } from './clean';
import { Rule, RuleSubject, bestRule } from './rules';

/**
 * Learning from the user's corrections — always visible and always with consent.
 *
 * - When the user re-categorises the same merchant the same way repeatedly, suggest a rule
 *   ("Always categorise transactions containing WOOLWORTHS as Groceries?").
 * - The rule is only created when the user agrees, unless they turned on automatic learning.
 * - Past manual categorisations also inform suggestions for new transactions (medium confidence).
 */

export interface CategoryCorrection {
  description: string;
  fromCategoryId: string | null;
  toCategoryId: string;
  at: string;
  /** The transaction's amount: money in and money out are learned separately. */
  amountCents?: number;
}

export interface RuleSuggestion {
  key: string;
  pattern: string;
  categoryId: string;
  count: number;
  examples: string[];
  /** Money in or money out — a rule learned from salary deposits never applies to purchases. */
  direction: 'in' | 'out' | 'any';
}

const directionOf = (amountCents?: number): 'in' | 'out' | 'any' => (amountCents === undefined || amountCents === 0 ? 'any' : amountCents > 0 ? 'in' : 'out');

/**
 * The name the descriptions start with in common, up to its second meaningful word: "BIGRIVER H G"
 * (initials kept), "BIGRIVER MKTPLC", "CORNER BUTCHER" — not the suburb that follows.
 */
function commonName(descriptions: string[]): string {
  const lists = descriptions.map((d) => nameTokens(d));
  const out: string[] = [];
  let meaningful = 0;
  for (let i = 0; i < 4 && meaningful < 2; i++) {
    const w = lists[0]?.[i];
    if (!w || lists.some((l) => l[i] !== w)) break;
    out.push(w);
    if (w.length >= 3 && !isGenericWord(w)) meaningful++;
  }
  while (out.length > 1 && isGenericWord(out[out.length - 1])) out.pop();
  return out.join(' ');
}

export function suggestRules(
  corrections: CategoryCorrection[],
  rules: Rule[],
  opts: { threshold?: number; dismissedKeys?: string[] } = {},
): RuleSuggestion[] {
  const threshold = opts.threshold ?? 2;
  const dismissed = new Set(opts.dismissedKeys ?? []);
  const byKey = new Map<string, CategoryCorrection[]>();
  for (const c of corrections) {
    const k = merchantKey(c.description);
    if (!k || k.length < 3) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), c]);
  }
  const out: RuleSuggestion[] = [];
  for (const [, all] of byKey) {
    // Money in and money out are separate: "BIGRIVER" deposits are pay, "BIGRIVER" purchases are shopping.
    for (const direction of ['in', 'out', 'any'] as const) {
      const list = all.filter((c) => directionOf(c.amountCents) === direction);
      if (!list.length) continue;
      const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at));
      for (const categoryId of new Set(sorted.map((c) => c.toCategoryId))) {
        const agreeing = sorted.filter((c) => c.toCategoryId === categoryId);
        if (agreeing.length < threshold) continue;
        // The rule uses as much of the name as these transactions share ("BIGRIVER H G", not just "BIGRIVER").
        const pattern = commonName(agreeing.map((c) => c.description)) || merchantKey(agreeing[0].description);
        if (pattern.length < 3) continue;
        // Only suggest when the most recent corrections this rule would cover agree.
        const covered = sorted.filter((c) => matchText(c.description).includes(pattern));
        if (covered.slice(-threshold).some((c) => c.toCategoryId !== categoryId)) continue;
        if (dismissed.has(`${pattern}→${categoryId}`)) continue;
        const opposite = direction === 'in' ? 'out' : direction === 'out' ? 'in' : null;
        const already = rules.some((r) => r.enabled && r.source !== 'default' && r.categoryId === categoryId && pattern.includes(r.pattern.toUpperCase()) && (r.direction ?? 'any') !== opposite);
        if (already) continue;
        out.push({ key: pattern, pattern, categoryId, direction, count: agreeing.length, examples: [...new Set(agreeing.map((c) => c.description))].slice(0, 3) });
      }
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

export interface HistoryEntry {
  description: string;
  categoryId: string;
  amountCents?: number;
}

export interface CategorySuggestion {
  categoryId: string | null;
  incomeType: IncomeType | null;
  ruleId: string | null;
  source: 'rule' | 'history' | 'none';
  confidence: Confidence;
  explanation: string;
  /** Other categories this could plausibly be (for the review inbox). */
  alternatives: string[];
}

/**
 * Suggest a category for a transaction using rules first, then the user's own history.
 * `history` should contain transactions the user categorised by hand.
 */
export function suggestCategory(subject: RuleSubject, rules: Rule[], history: HistoryEntry[]): CategorySuggestion {
  const match = bestRule(rules, subject);
  // Earlier choices for money going the same way (in or out) and, first, for the same name
  // ("BIGRIVER H G"); only then for names sharing the first word ("BIGRIVER …").
  const dir = Math.sign(subject.amountCents);
  const sameWay = history.filter((h) => h.amountCents === undefined || dir === 0 || h.amountCents === 0 || Math.sign(h.amountCents) === dir);
  const fine = fineMerchantKey(subject.description);
  let key = fine;
  let past = sameWay.filter((h) => fineMerchantKey(h.description) === fine);
  const exact = past.length > 0;
  if (!exact) {
    key = merchantKey(subject.description);
    past = sameWay.filter((h) => merchantKey(h.description) === key);
  }
  const counts = new Map<string, number>();
  for (const h of past) counts.set(h.categoryId, (counts.get(h.categoryId) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  if (match && match.rule.categoryId) {
    const alternatives = ranked.map(([c]) => c).filter((c) => c !== match.rule.categoryId);
    // A built-in rule that disagrees with the user's own past choices for this same name is not trusted.
    const conflicts = match.rule.source === 'default' && exact && ranked.length > 0 && ranked[0][0] !== match.rule.categoryId;
    if (conflicts) {
      return {
        categoryId: ranked[0][0],
        incomeType: null,
        ruleId: null,
        source: 'history',
        confidence: 'low',
        explanation: `You previously categorised "${key}" differently from the built-in rule — please choose.`,
        alternatives: [match.rule.categoryId, ...alternatives.filter((a) => a !== ranked[0][0])],
      };
    }
    return {
      categoryId: match.rule.categoryId,
      incomeType: match.rule.incomeType ?? null,
      ruleId: match.rule.id,
      source: 'rule',
      confidence: match.rule.source === 'default' ? 'medium' : 'high',
      explanation: match.explanation,
      alternatives,
    };
  }
  if (ranked.length === 1 || (ranked.length > 1 && ranked[0][1] >= 2 * ranked[1][1])) {
    return {
      categoryId: ranked[0][0],
      incomeType: null,
      ruleId: null,
      source: 'history',
      // Only the first word matched ("BIGRIVER …"): it could be a different business, so it is checked.
      confidence: exact ? 'medium' : 'low',
      explanation: exact
        ? `You categorised ${ranked[0][1]} earlier "${key}" transaction${ranked[0][1] > 1 ? 's' : ''} this way.`
        : `A business whose name also starts "${key}" was categorised this way — check it is the same business.`,
      alternatives: ranked.slice(1).map(([c]) => c),
    };
  }
  if (ranked.length > 1) {
    return {
      categoryId: null,
      incomeType: null,
      ruleId: null,
      source: 'none',
      confidence: 'low',
      explanation: `Earlier "${key}" transactions were put in ${ranked.length} different categories.`,
      alternatives: ranked.map(([c]) => c),
    };
  }
  return { categoryId: null, incomeType: null, ruleId: null, source: 'none', confidence: 'low', explanation: 'No rule or earlier transaction matched.', alternatives: [] };
}
