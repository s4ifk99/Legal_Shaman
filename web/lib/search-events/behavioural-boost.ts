/** Max additive boost as a fraction of the base relevance score (5–10% spec). */
export const MAX_BEHAVIOURAL_FRACTION = 0.08;

export type RankingSignalLite = {
  ctr: number;
  contactRate: number;
  confidence: number;
};

export type RelevanceScores = {
  practiceArea: number;
  keyword: number;
};

/** Popularity must not move irrelevant rows — require minimum topical match. */
export function isRelevantEnoughForBehaviouralBoost(scores: RelevanceScores): boolean {
  return scores.practiceArea >= 0.45 || scores.keyword >= 0.22;
}

/**
 * Raw boost strength in [0, 1] from aggregated signals.
 * Contact intent weighted above passive clicks.
 */
export function signalStrength(signal: RankingSignalLite): number {
  const ctr = clamp01(signal.ctr);
  const contactRate = clamp01(signal.contactRate);
  const confidence = clamp01(signal.confidence);
  return clamp01((0.35 * ctr + 0.65 * contactRate) * confidence);
}

/** Cap boost so it cannot exceed MAX_BEHAVIOURAL_FRACTION of base score. */
export function capBehaviouralBoostDelta(baseScore: number, rawBoost: number): number {
  const base = clamp01(baseScore);
  const cap = base * MAX_BEHAVIOURAL_FRACTION;
  return Math.min(Math.max(0, rawBoost), cap);
}

export function computeBehaviouralBoostDelta(
  baseScore: number,
  signal: RankingSignalLite | undefined,
  relevance: RelevanceScores,
): number {
  if (!signal || !isRelevantEnoughForBehaviouralBoost(relevance)) return 0;
  const strength = signalStrength(signal);
  const raw = baseScore * strength * MAX_BEHAVIOURAL_FRACTION;
  return capBehaviouralBoostDelta(baseScore, raw);
}

export function applyBehaviouralBoostToFinal(
  baseFinal: number,
  boostDelta: number,
): number {
  return clamp01(baseFinal + boostDelta);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
