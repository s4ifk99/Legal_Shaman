import { computeIndexQualityScore } from "@/lib/search-index/index-quality-score";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";

const WEIGHTS = {
  approvedPhone: 0.16,
  approvedEmailOrForm: 0.12,
  website: 0.12,
  practiceAreaSlugs: 0.18,
  capabilities: 0.12,
  addressGeocode: 0.12,
  provenanceFresh: 0.08,
  reviewApproved: 0.1,
};

function hasApprovedField(
  enrichments: ProviderEnrichment[],
  fieldName: string,
): boolean {
  return enrichments.some(
    (e) =>
      e.fieldName === fieldName &&
      (e.status === "approved" || e.status === "auto_approved"),
  );
}

/** 0–1 provider profile completeness (approved + structured). */
export function computeProviderCompletenessScore(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[] = [],
): number {
  let score = 0;

  if (doc.phone?.trim() || hasApprovedField(enrichments, "phone")) {
    score += WEIGHTS.approvedPhone;
  }
  if (
    doc.email?.trim() ||
    hasApprovedField(enrichments, "email") ||
    hasApprovedField(enrichments, "contactPageUrl")
  ) {
    score += WEIGHTS.approvedEmailOrForm;
  }
  if (doc.website?.trim() || hasApprovedField(enrichments, "website")) {
    score += WEIGHTS.website;
  }
  if ((doc.practiceAreaSlugs?.length ?? 0) > 0 || hasApprovedField(enrichments, "practiceAreaSlugs")) {
    score += WEIGHTS.practiceAreaSlugs;
  }

  const capCount =
    (doc.capabilities?.length ?? 0) +
    (doc.fundingCapabilities?.length ?? 0) +
    (doc.urgencyCapabilities?.length ?? 0);
  if (capCount > 0 || hasApprovedField(enrichments, "capabilities")) {
    score += WEIGHTS.capabilities;
  }

  if (doc.locationPoint || (doc.postcode?.trim() && doc.city?.trim())) {
    score += WEIGHTS.addressGeocode;
  }

  const approved = enrichments.filter(
    (e) => e.status === "approved" || e.status === "auto_approved",
  );
  if (approved.length > 0) {
    const avgConf =
      approved.reduce((s, e) => s + e.confidence, 0) / approved.length;
    score += WEIGHTS.provenanceFresh * avgConf;
    score += WEIGHTS.reviewApproved * Math.min(1, approved.length / 4);
  } else if (doc.enrichmentStatus === "structured" || doc.enrichmentStatus === "approved") {
    score += WEIGHTS.reviewApproved * 0.5;
  }

  const indexQ = doc.indexQualityScore ?? computeIndexQualityScore(doc);
  if (score < 0.3 && indexQ > 0.5) {
    score = Math.max(score, indexQ * 0.35);
  }

  return Math.min(1, Math.round(score * 100) / 100);
}
