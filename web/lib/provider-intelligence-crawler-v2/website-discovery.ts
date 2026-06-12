import { discoverOfficialWebsite } from "@/lib/provider-enrichment-ladder/official-website-discovery";
import { runLadderForProvider } from "@/lib/provider-enrichment-ladder/extraction-runner";
import {
  classifyWebsiteDiscoveryAttempt,
  emptyWebsiteDiscoveryDiagnostics,
} from "@/lib/provider-osint/website-discovery";
import { enrichFirmNameSeedFromPostgres } from "@/lib/provider-osint/firm-name-seed";
import type { FirmWebsiteDiscoveryTrace } from "@/lib/provider-osint/search-website-discovery";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";
import { computeV2Confidence } from "@/lib/provider-intelligence-crawler-v2/confidence";
import { approveAndPersistV2Candidate } from "@/lib/provider-intelligence-crawler-v2/persist";
import type {
  V2ExtractionCandidate,
  WebsiteDiscoveryRunStats,
} from "@/lib/provider-intelligence-crawler-v2/types";

export type WebsiteDiscoveryDebugRow = FirmWebsiteDiscoveryTrace;

export async function discoverWebsiteCandidates(
  doc: LegalEntityDocument,
  metrics?: import("@/lib/provider-osint/website-discovery").WebsiteDiscoveryDiagnostics,
  trace?: FirmWebsiteDiscoveryTrace,
): Promise<V2ExtractionCandidate[]> {
  const found = await discoverOfficialWebsite(doc, { metrics, trace });
  if (!found?.url) return [];

  const seed = await enrichFirmNameSeedFromPostgres(doc);

  const typeMatch = found.provenanceNote?.match(/candidateType=([a-z_]+)/);
  const candidateType = typeMatch?.[1] as V2ExtractionCandidate["websiteCandidateType"];

  const confidence = computeV2Confidence({
    sourceType: found.sourceType,
    rawConfidence: found.confidence,
    structuredField: found.sourceType === "sra_register",
  });

  return [
    {
      entityId: doc.id,
      entityType: doc.entityType,
      fieldName: "website",
      extractedValue: found.url,
      confidence,
      sourceType: found.sourceType,
      sourceUrl: found.sourceUrl,
      extractionMethod: "website_discovery",
      provenanceNote: found.provenanceNote,
      websiteCandidateType: candidateType,
      firmNameUsed: seed?.primaryName ?? doc.displayName ?? doc.title,
    },
  ];
}

export async function runWebsiteDiscoveryEngine(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[],
  crawlRunId: string,
  opts?: { debugTrace?: FirmWebsiteDiscoveryTrace },
): Promise<WebsiteDiscoveryRunStats> {
  const stats: WebsiteDiscoveryRunStats = {
    ...emptyWebsiteDiscoveryDiagnostics(),
    candidatesSubmitted: 0,
    autoApproved: 0,
    pendingReview: 0,
    rejected: 0,
    errors: [],
  };

  const attempt = classifyWebsiteDiscoveryAttempt(doc);
  if (attempt.regulatoryRejected) stats.regulatoryRejected++;
  if (attempt.directoryRejected) stats.directoryRejected++;
  if (attempt.syntheticRejected) stats.rejectedSynthetic++;

  const discoveryMetrics = emptyWebsiteDiscoveryDiagnostics();
  const candidates = await discoverWebsiteCandidates(doc, discoveryMetrics, opts?.debugTrace);
  if (candidates.length) stats.candidatesFound += candidates.length;

  stats.firmNamesUsed += discoveryMetrics.firmNamesUsed;
  stats.searchQueriesBuilt += discoveryMetrics.searchQueriesBuilt;
  stats.searchResultsSeen += discoveryMetrics.searchResultsSeen;
  stats.candidatesVerified += discoveryMetrics.candidatesVerified;
  stats.candidatesCollected += discoveryMetrics.candidatesCollected;
  stats.candidatesRejected += discoveryMetrics.candidatesRejected;
  stats.rejectedSynthetic += discoveryMetrics.rejectedSynthetic;
  stats.rejectedUnverified += discoveryMetrics.rejectedUnverified;

  if (opts?.debugTrace) {
    opts.debugTrace.candidatesCollected = discoveryMetrics.candidatesCollected;
    opts.debugTrace.candidatesVerified = discoveryMetrics.candidatesVerified;
    opts.debugTrace.candidatesRejected = discoveryMetrics.candidatesRejected;
  }

  for (const c of candidates) {
    stats.candidatesSubmitted++;
    try {
      const { approval } = await approveAndPersistV2Candidate(crawlRunId, c);
      if (opts?.debugTrace) {
        opts.debugTrace.finalDecision = `${approval.status}:${approval.policyReason}`;
      }
      if (approval.status === "auto_approved") {
        stats.autoApproved++;
      } else if (approval.status === "rejected") {
        stats.rejected++;
        if (approval.policyReason === "regulatory_url_not_provider_website") {
          stats.regulatoryRejected++;
        } else if (approval.policyReason?.includes("synthetic")) {
          stats.rejectedSynthetic++;
        } else if (
          approval.policyReason === "below_moderation_threshold" ||
          approval.policyReason === "heuristic_guess_not_persisted"
        ) {
          stats.rejectedUnverified++;
        }
      } else {
        stats.pendingReview++;
      }
    } catch (e) {
      stats.errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (!candidates.length && !attempt.regulatoryRejected && !attempt.syntheticRejected) {
    stats.noCandidate++;
    if (opts?.debugTrace) {
      opts.debugTrace.noCandidate = true;
      opts.debugTrace.finalDecision =
        opts.debugTrace.finalDecision ?? `no_candidate:${opts.debugTrace.rejectReason ?? "none_found"}`;
    }
  }

  if (opts?.debugTrace && candidates[0]) {
    const t = opts.debugTrace;
    t.candidateUrl = candidates[0].extractedValue;
    t.confidence = candidates[0].confidence;
    t.candidateType = candidates[0].websiteCandidateType;
    t.noCandidate = false;
  }

  try {
    const ladder = await runLadderForProvider(doc, enrichments, "discover_website");
    stats.autoApproved += ladder.autoApproved;
    stats.pendingReview += ladder.pendingReview;
    stats.rejected += ladder.rejected;
  } catch (e) {
    stats.errors.push(`ladder: ${e instanceof Error ? e.message : String(e)}`);
  }

  return stats;
}

export function emptyWebsiteDiscoveryRunStats(): WebsiteDiscoveryRunStats {
  return {
    ...emptyWebsiteDiscoveryDiagnostics(),
    candidatesSubmitted: 0,
    autoApproved: 0,
    pendingReview: 0,
    rejected: 0,
    errors: [],
  };
}
