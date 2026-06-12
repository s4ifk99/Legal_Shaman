import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";
import { approveAndPersistV2Candidate } from "@/lib/provider-intelligence-crawler-v2/persist";
import type { CrawlerV2RunStats, V2ExtractionCandidate } from "@/lib/provider-intelligence-crawler-v2/types";
import type { EnrichmentSourceType } from "@/lib/provider-enrichment/types";

export async function runReviewEnrichmentEngine(
  doc: LegalEntityDocument,
  _enrichments: ProviderEnrichment[],
  crawlRunId: string,
): Promise<CrawlerV2RunStats> {
  const stats: CrawlerV2RunStats = {
    candidatesSubmitted: 0,
    autoApproved: 0,
    pendingReview: 0,
    rejected: 0,
    errors: [],
  };

  const { fetchTrustpilotAggregate, getTrustpilotConfig } = await import(
    "@/lib/provider-crawler/trustpilot-api"
  );
  const config = getTrustpilotConfig();
  if (!config?.businessUnitId) return stats;

  const fields = await fetchTrustpilotAggregate(config.businessUnitId, {
    entityId: doc.id,
    entityType: doc.entityType,
  });

  const rows: V2ExtractionCandidate[] = fields.map((f) => ({
    entityId: doc.id,
    entityType: doc.entityType,
    fieldName: f.fieldName,
    extractedValue: f.extractedValue,
    confidence: f.confidence,
    sourceType: f.sourceType as EnrichmentSourceType,
    sourceUrl: f.sourceUrl,
    extractionMethod: f.extractionMethod,
    reviewCategory: "review_signal",
    signalType: f.fieldName,
  }));

  for (const c of rows) {
    stats.candidatesSubmitted++;
    const { approval } = await approveAndPersistV2Candidate(crawlRunId, c);
    if (approval.status === "auto_approved") stats.autoApproved++;
    else if (approval.status === "rejected") stats.rejected++;
    else stats.pendingReview++;
  }

  return stats;
}
