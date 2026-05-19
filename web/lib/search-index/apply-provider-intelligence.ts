import {
  applyApprovedEnrichmentsToDocument,
  buildEnrichmentIndexMap,
} from "@/lib/provider-enrichment/apply-approved-enrichments";
import { inferCapabilitiesOnDocument } from "@/lib/provider-enrichment/enrichment-engine";
import { loadAllApprovedEnrichments } from "@/lib/provider-enrichment/review-queue";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import { projectAndApplySraPracticeAreas } from "@/lib/sra/practice-area-projection";
import { applyTaxonomyProjection } from "@/lib/search-index/taxonomy-projection";

let cachedEnrichments: Awaited<ReturnType<typeof loadAllApprovedEnrichments>> | null = null;

export async function loadEnrichmentCache(): Promise<void> {
  cachedEnrichments = await loadAllApprovedEnrichments();
}

export function clearEnrichmentCache(): void {
  cachedEnrichments = null;
}

/** Infer capabilities + merge approved enrichments for indexing. */
export async function applyProviderIntelligence(
  doc: LegalEntityDocument,
): Promise<LegalEntityDocument> {
  let enriched = inferCapabilitiesOnDocument(doc);
  const rows = cachedEnrichments ?? (await loadAllApprovedEnrichments());
  if (!cachedEnrichments) cachedEnrichments = rows;
  const map = buildEnrichmentIndexMap(rows);
  enriched = applyApprovedEnrichmentsToDocument(enriched, map.get(doc.id) ?? []);
  if (enriched.entityType === "sra_organisation") {
    projectAndApplySraPracticeAreas(enriched);
    applyTaxonomyProjection(enriched);
  }
  return enriched;
}

export function applyProviderIntelligenceSync(
  doc: LegalEntityDocument,
  enrichments: Parameters<typeof applyApprovedEnrichmentsToDocument>[1],
): LegalEntityDocument {
  let enriched = inferCapabilitiesOnDocument(doc);
  enriched = applyApprovedEnrichmentsToDocument(enriched, enrichments);
  if (enriched.entityType === "sra_organisation") {
    projectAndApplySraPracticeAreas(enriched);
    applyTaxonomyProjection(enriched);
  }
  return enriched;
}
