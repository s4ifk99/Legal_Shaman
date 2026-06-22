import type { FundingIntent } from "@/lib/legal-search/funding-intent";
import { fundingIntentBoostsLegalAid, fundingIntentPrefersPrivateSources } from "@/lib/legal-search/funding-intent";
import type { SearchResult } from "@/lib/legal-search/types";

export type SourceDiversityTier =
  | "curated"
  | "lawyer_firm"
  | "sra"
  | "pro_bono"
  | "legal_aid";

export type SourceDiversityDebug = {
  fundingIntent: FundingIntent;
  sourceDiversityApplied: boolean;
  sourceCaps: { maxLegalAidInTopK: number; topK: number };
  preDiversificationSourceCounts: Record<string, number>;
  postDiversificationSourceCounts: Record<string, number>;
  legalAidBoostApplied: boolean;
  legalAidBoostReason: string;
};

const DEFAULT_TOP_K = 10;
const DEFAULT_MAX_LEGAL_AID_SHARE = 0.35;
const DEFAULT_MAX_SINGLE_TIER_SHARE = 0.7;

const GENERIC_LAWYER_QUERY =
  /\b(solicitor|solicitors|lawyer|lawyers|barrister|attorney|law firm|law firms)\b/i;

function isGenericLawyerQuery(text: string): boolean {
  return GENERIC_LAWYER_QUERY.test(text);
}

function maxSingleTierInTopK(topK: number): number {
  const env = Number(process.env.SOURCE_DIVERSITY_MAX_TIER_SHARE);
  const share = Number.isFinite(env) && env > 0 && env <= 1 ? env : DEFAULT_MAX_SINGLE_TIER_SHARE;
  return Math.max(1, Math.floor(topK * share));
}

function entityTypeOf(r: SearchResult): string {
  const raw = r.raw as { entityType?: string } | null;
  return String(raw?.entityType ?? "");
}

export function sourceDiversityTier(r: SearchResult): SourceDiversityTier {
  const et = entityTypeOf(r);
  if (r.source === "curated_listing") return "curated";
  if (
    et === "pro_bono_organisation" ||
    et === "advice_charity" ||
    et === "university_law_clinic"
  ) {
    return "pro_bono";
  }
  if (
    r.source === "legal_aid" ||
    et === "legal_aid_provider" ||
    et === "law_centre" ||
    (r.raw as { legalAid?: boolean })?.legalAid === true
  ) {
    return "legal_aid";
  }
  if (r.source === "sra" || et === "sra_organisation") return "sra";
  if (r.source === "lawyer" || r.source === "firm" || et === "lawyer" || et === "firm") {
    return "lawyer_firm";
  }
  return "sra";
}

function isLegalAidTier(tier: SourceDiversityTier): boolean {
  return tier === "legal_aid";
}

function isPrivateFacingTier(tier: SourceDiversityTier): boolean {
  return tier === "curated" || tier === "lawyer_firm" || tier === "sra";
}

function countBySource(results: SearchResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r.source] = (counts[r.source] ?? 0) + 1;
  }
  return counts;
}

function countByTier(results: SearchResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) {
    const tier = sourceDiversityTier(r);
    counts[tier] = (counts[tier] ?? 0) + 1;
  }
  return counts;
}

function poolHasMultipleTiers(results: SearchResult[]): boolean {
  const tiers = new Set(results.map((r) => sourceDiversityTier(r)));
  return tiers.size > 1;
}

function canAddToCappedTop(
  r: SearchResult,
  top: SearchResult[],
  maxLegalAidInTopK: number,
  maxPerTier: number,
): boolean {
  const tier = sourceDiversityTier(r);
  const tierCount = top.filter((x) => sourceDiversityTier(x) === tier).length;
  if (tier === "legal_aid" && tierCount >= maxLegalAidInTopK) return false;
  if (tier !== "legal_aid" && tierCount >= maxPerTier) return false;
  return true;
}

/** First `topK` slots respect tier caps; overflow keeps original order after the capped head. */
function capTopKResults(
  ordered: SearchResult[],
  topK: number,
  maxLegalAidInTopK: number,
  maxPerTier: number,
): SearchResult[] {
  const top: SearchResult[] = [];
  const deferred: SearchResult[] = [];
  const seen = new Set<string>();

  for (const r of ordered) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (top.length < topK && canAddToCappedTop(r, top, maxLegalAidInTopK, maxPerTier)) {
      top.push(r);
    } else {
      deferred.push(r);
    }
  }

  return [...top, ...deferred];
}

function tierPriorityForIntent(intent: FundingIntent, tier: SourceDiversityTier): number {
  if (fundingIntentBoostsLegalAid(intent)) {
    const order: SourceDiversityTier[] = [
      "legal_aid",
      "pro_bono",
      "curated",
      "lawyer_firm",
      "sra",
    ];
    return order.indexOf(tier);
  }
  const genericOrder: SourceDiversityTier[] = [
    "curated",
    "lawyer_firm",
    "sra",
    "pro_bono",
    "legal_aid",
  ];
  return genericOrder.indexOf(tier);
}

/**
 * Re-order ranked results so legal_aid cannot dominate generic lawyer queries.
 */
export function applySourceDiversity(
  sortedResults: SearchResult[],
  fundingIntent: FundingIntent,
  opts?: { topK?: number; maxLegalAidShare?: number; query?: string },
): { results: SearchResult[]; debug: SourceDiversityDebug } {
  const topK = opts?.topK ?? DEFAULT_TOP_K;
  const maxShare = opts?.maxLegalAidShare ?? DEFAULT_MAX_LEGAL_AID_SHARE;
  const maxLegalAidInTopK = Math.max(1, Math.ceil(topK * maxShare));

  const preCounts = countBySource(sortedResults.slice(0, topK));

  const boostLegalAid = fundingIntentBoostsLegalAid(fundingIntent);
  const preferPrivate = fundingIntentPrefersPrivateSources(fundingIntent);

  let legalAidBoostReason = "generic query — legal aid not boosted in authority";
  if (boostLegalAid) {
    legalAidBoostReason = "query signals legal aid or free help — legal aid sources may rank higher";
  } else if (fundingIntent === "private") {
    legalAidBoostReason = "query signals private solicitor — legal aid deprioritised";
  }

  const isGenericUnspecified = fundingIntent === "private_or_unspecified";

  if (!preferPrivate && !boostLegalAid && !isGenericUnspecified) {
    return {
      results: sortedResults,
      debug: {
        fundingIntent,
        sourceDiversityApplied: false,
        sourceCaps: { maxLegalAidInTopK, topK },
        preDiversificationSourceCounts: preCounts,
        postDiversificationSourceCounts: preCounts,
        legalAidBoostApplied: boostLegalAid,
        legalAidBoostReason,
      },
    };
  }

  if (isGenericUnspecified && !boostLegalAid && !poolHasMultipleTiers(sortedResults.slice(0, topK * 2))) {
    return {
      results: sortedResults,
      debug: {
        fundingIntent,
        sourceDiversityApplied: false,
        sourceCaps: { maxLegalAidInTopK, topK },
        preDiversificationSourceCounts: preCounts,
        postDiversificationSourceCounts: preCounts,
        legalAidBoostApplied: false,
        legalAidBoostReason: `${legalAidBoostReason}; single source tier in pool — not fabricating alternatives`,
      },
    };
  }

  const head = sortedResults.slice(0, Math.max(topK * 3, topK));
  const tail = sortedResults.slice(head.length);

  if (isGenericUnspecified && !boostLegalAid) {
    const genericTierOrder: SourceDiversityTier[] = isGenericLawyerQuery(opts?.query ?? "")
      ? ["sra", "lawyer_firm", "curated", "pro_bono", "legal_aid"]
      : ["pro_bono", "legal_aid", "curated", "lawyer_firm", "sra"];
    const byTier = new Map<SourceDiversityTier, SearchResult[]>();
    for (const r of head) {
      const tier = sourceDiversityTier(r);
      const list = byTier.get(tier) ?? [];
      list.push(r);
      byTier.set(tier, list);
    }
    const maxPerTier = maxSingleTierInTopK(topK);
    const diversified: SearchResult[] = [];
    const seen = new Set<string>();
    while (diversified.length < topK) {
      let added = false;
      for (const tier of genericTierOrder) {
        const bucket = byTier.get(tier);
        if (!bucket?.length) continue;
        const tierUsed = diversified.filter((x) => sourceDiversityTier(x) === tier).length;
        if (tier === "legal_aid" && tierUsed >= maxLegalAidInTopK) continue;
        if (tier !== "legal_aid" && tierUsed >= maxPerTier) continue;
        const next = bucket.shift()!;
        if (seen.has(next.id)) continue;
        seen.add(next.id);
        diversified.push(next);
        added = true;
        if (diversified.length >= topK) break;
      }
      if (!added) break;
    }
    for (const r of head) {
      if (diversified.length >= topK) break;
      if (seen.has(r.id)) continue;
      const tier = sourceDiversityTier(r);
      const tierUsed = diversified.filter((x) => sourceDiversityTier(x) === tier).length;
      if (tier === "legal_aid" && tierUsed >= maxLegalAidInTopK) continue;
      if (tier !== "legal_aid" && tierUsed >= maxPerTier) continue;
      seen.add(r.id);
      diversified.push(r);
    }
    const diversifiedIds = new Set(diversified.map((r) => r.id));
    const laDeferred: SearchResult[] = [];
    const nonLaRemainder: SearchResult[] = [];
    for (const r of [...head.filter((x) => !diversifiedIds.has(x.id)), ...tail]) {
      if (sourceDiversityTier(r) === "legal_aid") laDeferred.push(r);
      else nonLaRemainder.push(r);
    }
    const topBand = capTopKResults(diversified, topK, maxLegalAidInTopK, maxPerTier).slice(0, topK);
    const merged = [...topBand, ...nonLaRemainder, ...laDeferred];
    const postCounts = countBySource(merged.slice(0, topK));
    return {
      results: merged,
      debug: {
        fundingIntent,
        sourceDiversityApplied: true,
        sourceCaps: { maxLegalAidInTopK, topK },
        preDiversificationSourceCounts: preCounts,
        postDiversificationSourceCounts: postCounts,
        legalAidBoostApplied: false,
        legalAidBoostReason: `${legalAidBoostReason}; generic interleave (pro_bono→legal_aid→private)`,
      },
    };
  }

  if (boostLegalAid) {
    const byTier = new Map<SourceDiversityTier, SearchResult[]>();
    for (const r of head) {
      const tier = sourceDiversityTier(r);
      const list = byTier.get(tier) ?? [];
      list.push(r);
      byTier.set(tier, list);
    }
    const tiers: SourceDiversityTier[] = [
      "legal_aid",
      "pro_bono",
      "curated",
      "lawyer_firm",
      "sra",
    ];
    const diversified: SearchResult[] = [];
    const seen = new Set<string>();
    while (diversified.length < topK) {
      let added = false;
      for (const tier of tiers) {
        const bucket = byTier.get(tier);
        if (!bucket?.length) continue;
        const next = bucket.shift()!;
        if (seen.has(next.id)) continue;
        seen.add(next.id);
        diversified.push(next);
        added = true;
        if (diversified.length >= topK) break;
      }
      if (!added) break;
    }
    for (const r of head) {
      if (diversified.length >= topK) break;
      if (!seen.has(r.id)) diversified.push(r);
    }
    const merged = [...diversified, ...head.filter((r) => !seen.has(r.id)), ...tail];
    const postCounts = countBySource(merged.slice(0, topK));
    return {
      results: merged,
      debug: {
        fundingIntent,
        sourceDiversityApplied: true,
        sourceCaps: { maxLegalAidInTopK, topK },
        preDiversificationSourceCounts: preCounts,
        postDiversificationSourceCounts: postCounts,
        legalAidBoostApplied: true,
        legalAidBoostReason,
      },
    };
  }

  const legalAid: SearchResult[] = [];
  const privateFacing: SearchResult[] = [];
  const other: SearchResult[] = [];

  for (const r of head) {
    const tier = sourceDiversityTier(r);
    if (isLegalAidTier(tier)) legalAid.push(r);
    else if (isPrivateFacingTier(tier)) privateFacing.push(r);
    else other.push(r);
  }

  privateFacing.sort(
    (a, b) =>
      tierPriorityForIntent(fundingIntent, sourceDiversityTier(a)) -
        tierPriorityForIntent(fundingIntent, sourceDiversityTier(b)) ||
      b.scores.final - a.scores.final,
  );

  const diversified: SearchResult[] = [];
  let laUsed = 0;
  let pi = 0;
  let li = 0;
  let oi = 0;

  while (diversified.length < topK && (pi < privateFacing.length || li < legalAid.length || oi < other.length)) {
    let progressed = false;
    if (pi < privateFacing.length) {
      diversified.push(privateFacing[pi]!);
      pi++;
      progressed = true;
    }
    if (diversified.length >= topK) break;
    if (li < legalAid.length && laUsed < maxLegalAidInTopK) {
      diversified.push(legalAid[li]!);
      li++;
      laUsed++;
      progressed = true;
    }
    if (diversified.length >= topK) break;
    if (oi < other.length) {
      diversified.push(other[oi]!);
      oi++;
      progressed = true;
    }
    if (!progressed) break;
  }

  const deferredLegalAid = legalAid.slice(li);
  const seen = new Set<string>();
  const appendUnique = (list: SearchResult[], out: SearchResult[]) => {
    for (const r of list) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  };
  const merged: SearchResult[] = [];
  appendUnique(diversified, merged);
  while (merged.length < topK) {
    let filled = false;
    if (pi < privateFacing.length) {
      appendUnique([privateFacing[pi]!], merged);
      pi++;
      filled = true;
    }
    if (merged.length >= topK) break;
    if (oi < other.length) {
      appendUnique([other[oi]!], merged);
      oi++;
      filled = true;
    }
    if (!filled) break;
  }
  appendUnique(privateFacing.slice(pi), merged);
  appendUnique(other.slice(oi), merged);
  appendUnique(deferredLegalAid, merged);
  appendUnique(tail, merged);

  const seenTop = new Set<string>();
  const cappedTop: SearchResult[] = [];
  const laCountIn = () => cappedTop.filter((x) => x.source === "legal_aid").length;

  for (const r of merged) {
    if (cappedTop.length >= topK) break;
    if (r.source === "legal_aid" && laCountIn() >= maxLegalAidInTopK) continue;
    if (seenTop.has(r.id)) continue;
    seenTop.add(r.id);
    cappedTop.push(r);
  }
  if (cappedTop.length < topK) {
    for (const r of merged) {
      if (cappedTop.length >= topK) break;
      if (seenTop.has(r.id)) continue;
      if (r.source === "legal_aid" && laCountIn() >= maxLegalAidInTopK) continue;
      seenTop.add(r.id);
      cappedTop.push(r);
    }
  }
  const mergedOut = [...cappedTop, ...merged.filter((r) => !seenTop.has(r.id))];

  const postCounts = countBySource(mergedOut.slice(0, topK));
  const laBefore = preCounts.legal_aid ?? 0;
  const laAfter = postCounts.legal_aid ?? 0;

  return {
    results: mergedOut,
    debug: {
      fundingIntent,
      sourceDiversityApplied: laBefore > maxLegalAidInTopK && laAfter <= maxLegalAidInTopK,
      sourceCaps: { maxLegalAidInTopK, topK },
      preDiversificationSourceCounts: preCounts,
      postDiversificationSourceCounts: postCounts,
      legalAidBoostApplied: false,
      legalAidBoostReason: `${legalAidBoostReason}; capped legal_aid in top ${topK} to ${maxLegalAidInTopK}`,
    },
  };
}

export function isPrivateFacingSearchHit(hit: { source: string; entityType?: string }): boolean {
  const src = hit.source.toLowerCase();
  const et = (hit.entityType ?? "").toLowerCase();
  if (src === "legal_aid" || et.includes("legal_aid")) return false;
  return (
    src === "curated_listing" ||
    src === "lawyer" ||
    src === "firm" ||
    src === "sra" ||
    et.includes("sra") ||
    et === "lawyer" ||
    et === "firm"
  );
}
