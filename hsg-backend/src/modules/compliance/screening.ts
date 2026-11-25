/**
 * Pure name-screening helpers (no database). Used by ComplianceService.screenName and unit-tested directly.
 *
 * Matching rule (PRD "Compliance gates"): case-insensitive, exact OR token-set match, and the country must match.
 *  1. normaliseName: lowercase, strip punctuation, collapse spaces, drop company suffixes (ltd, limited, llc ...).
 *  2. exact: the normalised strings are equal.
 *  3. token_set: every watchlist token appears in the name (watchlist ⊆ name),
 *     or the Jaccard similarity of the two token sets is >= 0.8.
 */

/** Legal-form words that do not identify the party and are ignored when comparing names. */
const SUFFIXES = new Set([
  'ltd', 'limited', 'llc', 'co', 'company', 'inc', 'incorporated', 'corp', 'corporation',
  'sa', 'bv', 'plc', 'gmbh', 'ag', 'nv', 'srl', 'spa', 'pte', 'pty', 'lp', 'llp',
]);

export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation -> space ("Co.,Ltd" -> "co  ltd")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !SUFFIXES.has(t))
    .join(' ');
}

export function tokens(normalised: string): Set<string> {
  return new Set(normalised.split(' ').filter(Boolean));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export const JACCARD_THRESHOLD = 0.8;

/** Returns the match method, or null if the two names do not match. Country is checked separately. */
export function nameMatch(candidate: string, listed: string): 'exact' | 'token_set' | null {
  const a = normaliseName(candidate);
  const b = normaliseName(listed);
  if (!a || !b) return null;
  if (a === b) return 'exact';
  const ta = tokens(a);
  const tb = tokens(b);
  // Watchlist tokens all present in the candidate name (e.g. "Volga Trading" inside "Volga Trading Shenzhen").
  const subset = [...tb].every((t) => ta.has(t));
  if (subset || jaccard(ta, tb) >= JACCARD_THRESHOLD) return 'token_set';
  return null;
}

export function sameCountry(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}
