import "server-only";

import { prisma } from "@/lib/db/prisma";
import { buildProviderEvidence } from "@/lib/legal-search/evidence/provider-facts";
import { lookupPublishedPrice } from "@/lib/legal-search/evidence/published-prices";
import { REVIEW_SIGNAL_TYPES } from "@/lib/legal-search/evidence/review-signal-write";
import type { ApprovedReviewSignal } from "@/lib/legal-search/evidence/types";
import type { SearchResult } from "@/lib/legal-search/types";
import { classifySearchResult } from "@/lib/legal-search/triage/result-router";

const REVIEW_SIGNAL_TYPE_LIST = [
  REVIEW_SIGNAL_TYPES.legacyRating,
  REVIEW_SIGNAL_TYPES.legacyCount,
  REVIEW_SIGNAL_TYPES.googleRating,
  REVIEW_SIGNAL_TYPES.googleCount,
  REVIEW_SIGNAL_TYPES.trustpilotRating,
  REVIEW_SIGNAL_TYPES.trustpilotCount,
] as const;

async function loadApprovedReviewSignals(
  entityIds: string[],
): Promise<Map<string, ApprovedReviewSignal[]>> {
  const grouped = new Map<string, ApprovedReviewSignal[]>();
  if (!entityIds.length) return grouped;
  try {
    const rows = await prisma.providerReviewSignal.findMany({
      where: {
        entityId: { in: entityIds },
        status: { in: ["approved", "auto_approved"] },
        signalType: { in: [...REVIEW_SIGNAL_TYPE_LIST] },
      },
      select: {
        entityId: true,
        signalType: true,
        value: true,
        sourceUrl: true,
        sourceType: true,
        status: true,
      },
    });
    for (const row of rows) {
      const list = grouped.get(row.entityId) ?? [];
      list.push(row);
      grouped.set(row.entityId, list);
    }
  } catch {
    return grouped;
  }
  return grouped;
}

/** Adds review and cost facts. Missing signals stay low confidence. Never reads seed ratings as reviews. */
export async function attachProviderEvidence(results: SearchResult[]): Promise<SearchResult[]> {
  const signals = await loadApprovedReviewSignals(results.map((result) => result.id));
  return results.map((result) => ({
    ...result,
    providerEvidence: buildProviderEvidence({
      resultId: result.id,
      sectionKind: classifySearchResult(result),
      reviewSignals: signals.get(result.id) ?? [],
      publishedPrice: lookupPublishedPrice(result.id),
      seedRating: typeof result.rating === "number" ? result.rating : null,
    }),
  }));
}
