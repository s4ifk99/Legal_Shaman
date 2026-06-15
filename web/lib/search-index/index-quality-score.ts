import type { LegalEntityDocument } from "@/lib/search-index/types";

function hasText(s: string | undefined, min = 2): boolean {
  return Boolean(s && s.trim().length >= min);
}

/** 0–1 index richness score for diagnostics and weak ranking tie-break. */
export function computeIndexQualityScore(doc: LegalEntityDocument): number {
  let score = 0;
  const weights = {
    title: 0.12,
    contact: 0.14,
    location: 0.12,
    practiceArea: 0.16,
    taxonomy: 0.14,
    capabilities: 0.12,
    provenance: 0.08,
    description: 0.12,
  };

  if (hasText(doc.title, 3)) score += weights.title;
  if (hasText(doc.phone) || hasText(doc.email) || hasText(doc.website)) score += weights.contact;
  if (hasText(doc.city) || hasText(doc.postcode) || doc.locationPoint) score += weights.location;
  if ((doc.practiceAreaSlugs?.length ?? 0) > 0 || doc.practiceAreas.length > 0) {
    score += weights.practiceArea;
  }
  if ((doc.taxonomyAliases?.length ?? 0) > 0 || (doc.issueAliases?.length ?? 0) > 0) {
    score += weights.taxonomy;
  }
  const capCount =
    (doc.capabilities?.length ?? 0) +
    (doc.fundingCapabilities?.length ?? 0) +
    (doc.urgencyCapabilities?.length ?? 0) +
    (doc.tribunalCapabilities?.length ?? 0);
  if (capCount > 0 || hasText(doc.capabilitySearchText, 8)) score += weights.capabilities;
  if (hasText(doc.provenanceSearchText, 4) || hasText(doc.source)) score += weights.provenance;

  const descLen =
    (doc.description?.length ?? 0) +
    (doc.searchText?.length ?? 0) +
    (doc.userSearchText?.length ?? 0) +
    (doc.legalSearchText?.length ?? 0);
  if (descLen > 80) score += weights.description;
  else if (descLen > 20) score += weights.description * 0.5;

  return Math.min(1, Math.round(score * 100) / 100);
}
