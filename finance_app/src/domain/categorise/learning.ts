import { Confidence } from '../import/types';
import { IncomeType } from './categories';
import { merchantKey } from './clean';
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
}

export interface RuleSuggestion {
  key: string;
  pattern: string;
  categoryId: string;
  count: number;
  examples: string[];
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
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at));
    const latest = sorted[sorted.length - 1].toCategoryId;
    const agreeing = sorted.filter((c) => c.toCategoryId === latest);
    // Only suggest when the most recent corrections agree.
    const recent = sorted.slice(-threshold);
    if (agreeing.length < threshold || recent.some((c) => c.toCategoryId !== latest)) continue;
    if (dismissed.has(`${key}→${latest}`)) continue;
    const already = rules.some((r) => r.enabled && r.source !== 'default' && r.categoryId === latest && key.toUpperCase().includes(r.pattern.toUpperCase()));
    if (already) continue;
    out.push({ key, pattern: key, categoryId: latest, count: agreeing.length, examples: [...new Set(agreeing.map((c) => c.description))].slice(0, 3) });
  }
  return out.sort((a, b) => b.count - a.count);
}

export interface HistoryEntry {
  description: string;
  categoryId: string;
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
  const key = merchantKey(subject.description);
  const past = history.filter((h) => merchantKey(h.description) === key);
  const counts = new Map<string, number>();
  for (const h of past) counts.set(h.categoryId, (counts.get(h.categoryId) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  if (match && match.rule.categoryId) {
    const alternatives = ranked.map(([c]) => c).filter((c) => c !== match.rule.categoryId);
    // A built-in rule that disagrees with the user's own past choices is not trusted.
    const conflicts = match.rule.source === 'default' && ranked.length > 0 && ranked[0][0] !== match.rule.categoryId;
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
      confidence: 'medium',
      explanation: `You categorised ${ranked[0][1]} earlier "${key}" transaction${ranked[0][1] > 1 ? 's' : ''} this way.`,
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
