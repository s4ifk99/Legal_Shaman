import { getOptionalPrismaClient } from "@/lib/db/prisma";
import { warnCrawlReviewDatasourceUnavailable } from "@/lib/provider-crawler/crawl-review-log";
import {
  explainReviewQueries,
  loadTableRowCounts,
  type ExplainPlanRow,
} from "@/lib/provider-intelligence-crawler-v2/crawl-v2-review-aggregate";
import {
  V2_REVIEW_INDEX_RECOMMENDATIONS,
  V2_REVIEW_QUERY_CATALOG,
  type V2ReviewQuerySpec,
} from "@/lib/provider-intelligence-crawler-v2/crawl-v2-review-queries";
import {
  computeV2CrawlReviewHealth,
  loadProviderContactReview,
  loadProviderEnrichmentReview,
  loadProviderPracticeAreaReview,
  loadProviderReviewSignalReview,
  loadProviderWebsiteReview,
  loadTableReview,
  topSlowestQueries,
  type V2ReviewLoadResult,
  type V2ReviewQueryDebug,
} from "@/lib/provider-intelligence-crawler-v2/crawl-v2-review-datasource";

export type V2ReviewTableSummary = {
  ok: boolean;
  error?: string;
  unavailable?: boolean;
  fallbackFromEnrichments?: boolean;
  pending: number;
  autoApproved: number;
  approved: number;
  rejected: number;
  total: number;
  samples: unknown[];
};

export type RejectionReasonCounts = {
  regulatory_url: number;
  synthetic_generated_domain: number;
  directory_url: number;
  low_confidence: number;
  other: number;
};

export type V2CrawlReviewOutput = {
  event: "providers_crawl_v2_review";
  ok: boolean;
  degraded: boolean;
  rejectionReasonCounts: RejectionReasonCounts | null;
  queryDiagnostics: V2ReviewQueryDebug[];
  slowestQueries: V2ReviewQueryDebug[];
  tableRowCounts?: Record<string, number>;
  indexRecommendations?: typeof V2_REVIEW_INDEX_RECOMMENDATIONS;
  queryCatalog?: V2ReviewQuerySpec[];
  explainPlans?: ExplainPlanRow[];
  dataSources: {
    providerWebsites: { ok: boolean; error?: string; unavailable?: boolean };
    providerContacts: { ok: boolean; error?: string; unavailable?: boolean };
    providerPracticeAreas: { ok: boolean; error?: string; unavailable?: boolean };
    providerReviewSignals: { ok: boolean; error?: string; unavailable?: boolean };
    providerEnrichments: { ok: boolean; error?: string };
  };
  websites: V2ReviewTableSummary;
  contacts: V2ReviewTableSummary;
  practiceAreas: V2ReviewTableSummary;
  reviewSignals: V2ReviewTableSummary;
  enrichments: V2ReviewTableSummary;
};

function toTableSummary(result: V2ReviewLoadResult): V2ReviewTableSummary {
  return {
    ok: result.ok,
    error: result.error,
    unavailable: result.unavailable,
    fallbackFromEnrichments: result.fallbackFromEnrichments,
    pending: result.pending,
    autoApproved: result.autoApproved,
    approved: result.approved,
    rejected: result.rejected,
    total: result.total,
    samples: result.samples,
  };
}

function classifyRejectionReason(
  policyReason: string | null,
  provenanceNote: string | null,
): keyof RejectionReasonCounts {
  const blob = `${policyReason ?? ""} ${provenanceNote ?? ""}`.toLowerCase();
  if (blob.includes("synthetic") || blob.includes("synthetic_generated")) {
    return "synthetic_generated_domain";
  }
  if (blob.includes("regulatory") || blob.includes("directory_only")) {
    return "regulatory_url";
  }
  if (blob.includes("directory") || blob.includes("yell.com") || blob.includes("find-open")) {
    return "directory_url";
  }
  if (
    blob.includes("low_confidence") ||
    blob.includes("below_moderation") ||
    blob.includes("confidence_too_low")
  ) {
    return "low_confidence";
  }
  return "other";
}

async function loadRejectionReasonCounts(): Promise<RejectionReasonCounts | null> {
  try {
    const db = getOptionalPrismaClient();
    const counts: RejectionReasonCounts = {
      regulatory_url: 0,
      synthetic_generated_domain: 0,
      directory_url: 0,
      low_confidence: 0,
      other: 0,
    };

    const enrichments = await db.providerEnrichment.findMany({
      where: { status: "rejected" },
      select: { policyReason: true, provenanceNote: true },
      take: 2000,
      orderBy: { updatedAt: "desc" },
    });

    for (const row of enrichments) {
      const key = classifyRejectionReason(row.policyReason, row.provenanceNote);
      counts[key]++;
    }

    return counts;
  } catch (e) {
    warnCrawlReviewDatasourceUnavailable("rejectionReasonCounts", e);
    return null;
  }
}

function collectQueryDiagnostics(...sections: V2ReviewLoadResult[]): V2ReviewQueryDebug[] {
  return sections.flatMap((s) => s.queryDebug);
}

export type V2CrawlReviewOptions = {
  /** Run EXPLAIN ANALYZE, row counts, and emit full query catalog. */
  audit?: boolean;
};

export async function loadV2CrawlReview(
  options: V2CrawlReviewOptions = {},
): Promise<V2CrawlReviewOutput> {
  const db = getOptionalPrismaClient();

  // Sequential loads avoid Prisma connection-pool saturation (was 5×4 parallel counts).
  const websitesRaw = await loadTableReview("providerWebsite", loadProviderWebsiteReview);
  const contactsRaw = await loadTableReview("providerContact", loadProviderContactReview);
  const practiceAreasRaw = await loadTableReview(
    "providerPracticeArea",
    loadProviderPracticeAreaReview,
  );
  const reviewSignalsRaw = await loadTableReview(
    "providerReviewSignal",
    loadProviderReviewSignalReview,
  );
  const enrichmentsRaw = await loadProviderEnrichmentReview(db);

  const websites = toTableSummary(websitesRaw);
  const contacts = toTableSummary(contactsRaw);
  const practiceAreas = toTableSummary(practiceAreasRaw);
  const reviewSignals = toTableSummary(reviewSignalsRaw);
  const enrichments = toTableSummary(enrichmentsRaw);

  const queryDiagnostics = collectQueryDiagnostics(
    websitesRaw,
    contactsRaw,
    practiceAreasRaw,
    reviewSignalsRaw,
    enrichmentsRaw,
  );

  const { ok, degraded } = computeV2CrawlReviewHealth({
    enrichmentsOk: enrichments.ok,
    optionalSourcesOk: [websites.ok, contacts.ok, practiceAreas.ok, reviewSignals.ok],
  });

  const dataSources = {
    providerWebsites: {
      ok: websites.ok,
      ...(websites.error ? { error: websites.error } : {}),
      ...(websites.unavailable ? { unavailable: true } : {}),
    },
    providerContacts: {
      ok: contacts.ok,
      ...(contacts.error ? { error: contacts.error } : {}),
      ...(contacts.unavailable ? { unavailable: true } : {}),
    },
    providerPracticeAreas: {
      ok: practiceAreas.ok,
      ...(practiceAreas.error ? { error: practiceAreas.error } : {}),
      ...(practiceAreas.unavailable ? { unavailable: true } : {}),
    },
    providerReviewSignals: {
      ok: reviewSignals.ok,
      ...(reviewSignals.error ? { error: reviewSignals.error } : {}),
      ...(reviewSignals.unavailable ? { unavailable: true } : {}),
    },
    providerEnrichments: {
      ok: enrichments.ok,
      ...(enrichments.error ? { error: enrichments.error } : {}),
    },
  };

  const rejectionReasonCounts = await loadRejectionReasonCounts();

  let tableRowCounts: Record<string, number> | undefined;
  let explainPlans: ExplainPlanRow[] | undefined;
  if (options.audit) {
    try {
      tableRowCounts = await loadTableRowCounts(db);
    } catch (e) {
      warnCrawlReviewDatasourceUnavailable("tableRowCounts", e);
    }
    try {
      explainPlans = await explainReviewQueries(db);
    } catch (e) {
      warnCrawlReviewDatasourceUnavailable("explainReviewQueries", e);
    }
  }

  return {
    event: "providers_crawl_v2_review",
    ok,
    degraded,
    rejectionReasonCounts,
    queryDiagnostics,
    slowestQueries: topSlowestQueries(queryDiagnostics),
    ...(options.audit
      ? {
          tableRowCounts,
          indexRecommendations: V2_REVIEW_INDEX_RECOMMENDATIONS,
          queryCatalog: V2_REVIEW_QUERY_CATALOG,
          explainPlans,
        }
      : {}),
    dataSources,
    websites,
    contacts,
    practiceAreas,
    reviewSignals,
    enrichments,
  };
}

export function v2CrawlReviewExitCode(output: V2CrawlReviewOutput): number {
  return output.ok ? 0 : 1;
}

export { computeV2CrawlReviewHealth };
