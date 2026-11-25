/**
 * Provider scoring for the MATCH step (PRD "Rules the build must hold > Saga", step 3).
 *
 *   score = 0.5 * rateScore + 0.3 * reliability + 0.2 * headroomScore
 *
 * - rateScore: the provider's NGN-per-USD rate, normalised across the candidates so the CHEAPEST
 *   provider scores 1 and the most expensive scores 0 (all equal -> everyone scores 1).
 * - reliability: the provider's 0..1 payout success probability, used as is.
 * - headroomScore: how many times over the provider could pay this amount (capacity / amount),
 *   capped at HEADROOM_CAP and divided by the cap, so it is also 0..1. A provider that can only
 *   just cover the payment scores low; one with lots of spare capacity scores high.
 *
 * Kept as a pure function (no database) so it is easy to test and to explain.
 */
export const WEIGHTS = { rate: 0.5, reliability: 0.3, headroom: 0.2 } as const;
export const HEADROOM_CAP = 10;

export interface Candidate {
  id: string;
  name: string;
  rate: string; // "1580.00"
  capacityUsd: bigint; // cents
  reliability: number; // 0..1
}

export interface ScoredCandidate<T extends Candidate = Candidate> {
  provider: T;
  score: number;
  parts: { rate: number; reliability: number; headroom: number };
}

/** Returns candidates that can cover `usdCents`, best score first. */
export function rankProviders<T extends Candidate>(candidates: T[], usdCents: bigint): ScoredCandidate<T>[] {
  // Only providers with enough capacity for the whole payment are eligible.
  const eligible = candidates.filter((c) => c.capacityUsd >= usdCents && usdCents > 0n);
  if (eligible.length === 0) return [];

  const rates = eligible.map((c) => Number(c.rate));
  const minRate = Math.min(...rates);
  const maxRate = Math.max(...rates);

  const scored = eligible.map((provider) => {
    const r = Number(provider.rate);
    // Lower rate is better for the SME: cheapest -> 1, dearest -> 0.
    const rate = maxRate === minRate ? 1 : (maxRate - r) / (maxRate - minRate);
    const reliability = Math.max(0, Math.min(1, provider.reliability));
    // capacity / amount, capped, then scaled to 0..1.
    const times = Number(provider.capacityUsd) / Number(usdCents);
    const headroom = Math.min(times, HEADROOM_CAP) / HEADROOM_CAP;
    const score = WEIGHTS.rate * rate + WEIGHTS.reliability * reliability + WEIGHTS.headroom * headroom;
    return { provider, score: Math.round(score * 10_000) / 10_000, parts: { rate, reliability, headroom } };
  });

  // Highest score first; ties go to the cheaper rate, then by name so the order is deterministic.
  scored.sort((a, b) => b.score - a.score || Number(a.provider.rate) - Number(b.provider.rate) || a.provider.name.localeCompare(b.provider.name));
  return scored;
}
