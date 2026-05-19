import {
  MAX_BEHAVIOURAL_FRACTION,
  applyBehaviouralBoostToFinal,
  capBehaviouralBoostDelta,
  computeBehaviouralBoostDelta,
  isRelevantEnoughForBehaviouralBoost,
  signalStrength,
} from "@/lib/search-events/behavioural-boost";
import { SearchEventInputSchema } from "@/lib/search-events/types";

export const HIGH_POPULARITY_SIGNAL = {
  ctr: 0.9,
  contactRate: 0.8,
  confidence: 1,
};

export function exactMatchBaseScore(): number {
  return 0.85;
}

export function weakIrrelevantBaseScore(): number {
  return 0.25;
}

export { MAX_BEHAVIOURAL_FRACTION, signalStrength, SearchEventInputSchema };

export function boostedWeakVsExact(): {
  exactFinal: number;
  weakBoosted: number;
} {
  const exactBase = exactMatchBaseScore();
  const weakBase = weakIrrelevantBaseScore();
  const weakBoosted = applyBehaviouralBoostToFinal(
    weakBase,
    computeBehaviouralBoostDelta(weakBase, HIGH_POPULARITY_SIGNAL, {
      practiceArea: 0.1,
      keyword: 0.05,
    }),
  );
  const exactFinal = exactMatchBaseScore();
  return { exactFinal, weakBoosted };
}

export function maxBoostFractionRespected(): boolean {
  const base = 0.5;
  const delta = computeBehaviouralBoostDelta(base, HIGH_POPULARITY_SIGNAL, {
    practiceArea: 1,
    keyword: 0.9,
  });
  return delta <= base * MAX_BEHAVIOURAL_FRACTION + 1e-6;
}

export function irrelevantGetsNoBoost(): boolean {
  return (
    computeBehaviouralBoostDelta(0.5, HIGH_POPULARITY_SIGNAL, {
      practiceArea: 0.1,
      keyword: 0.05,
    }) === 0
  );
}

export function capBehaviouralBoostWorks(): boolean {
  const base = 0.4;
  const capped = capBehaviouralBoostDelta(base, 0.5);
  return capped === base * MAX_BEHAVIOURAL_FRACTION;
}

export function relevanceGateWorks(): boolean {
  return (
    isRelevantEnoughForBehaviouralBoost({ practiceArea: 0.5, keyword: 0.1 }) &&
    !isRelevantEnoughForBehaviouralBoost({ practiceArea: 0.2, keyword: 0.1 })
  );
}
