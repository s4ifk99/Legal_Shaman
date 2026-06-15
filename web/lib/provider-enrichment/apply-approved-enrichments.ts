import { computeProviderCompletenessScore } from "@/lib/provider-enrichment-ladder/provider-completeness-score";
import { isWeakProvider } from "@/lib/provider-enrichment-ladder/weak-provider-detector";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Merge approved/auto_approved enrichment rows onto a legal entity document. */
export function applyApprovedEnrichmentsToDocument(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[],
): LegalEntityDocument {
  const forEntity = enrichments.filter((e) => e.entityId === doc.id);
  if (!forEntity.length) return doc;

  let next = { ...doc };
  let enrichmentStatus = doc.enrichmentStatus ?? "none";
  let contactSource = doc.contactSource;
  let contactConfidence = doc.contactConfidence;

  for (const e of forEntity) {
    if (e.status !== "approved" && e.status !== "auto_approved") continue;

    switch (e.fieldName) {
      case "phone":
        next.phone = e.extractedValue;
        contactSource = e.sourceType;
        contactConfidence = e.confidence;
        enrichmentStatus = e.status === "auto_approved" ? "auto_approved" : "approved";
        break;
      case "email":
        next.email = e.extractedValue;
        break;
      case "website":
        next.website = e.extractedValue;
        break;
      case "contactPageUrl":
        next.contactPageUrl = e.extractedValue;
        break;
      case "openingHours":
        next.openingHours = e.extractedValue;
        break;
      case "address":
        next.address = e.extractedValue;
        break;
      case "practiceAreaSlugs": {
        const slugs = parseList(e.extractedValue);
        next.practiceAreaSlugs = [...new Set([...(next.practiceAreaSlugs ?? []), ...slugs])];
        break;
      }
      case "capabilities":
        next.capabilities = parseList(e.extractedValue);
        break;
      case "fundingCapabilities":
        next.fundingCapabilities = parseList(e.extractedValue);
        break;
      case "urgencyCapabilities":
        next.urgencyCapabilities = parseList(e.extractedValue);
        break;
      case "accessibilityCapabilities":
        next.accessibilityCapabilities = parseList(e.extractedValue);
        break;
      case "languages":
        next.languages = [...new Set([...(next.languages ?? []), ...parseList(e.extractedValue)])];
        break;
      case "tribunalCapabilities":
        next.tribunalCapabilities = parseList(e.extractedValue);
        break;
      default:
        break;
    }
  }

  const approvedOnly = forEntity.filter(
    (e) => e.status === "approved" || e.status === "auto_approved",
  );

  return {
    ...next,
    enrichmentStatus,
    contactSource,
    contactConfidence,
    providerCompletenessScore: computeProviderCompletenessScore(next, approvedOnly),
    weakProvider: isWeakProvider(next, approvedOnly),
  };
}

export function buildEnrichmentIndexMap(
  enrichments: ProviderEnrichment[],
): Map<string, ProviderEnrichment[]> {
  const map = new Map<string, ProviderEnrichment[]>();
  for (const e of enrichments) {
    const list = map.get(e.entityId) ?? [];
    list.push(e);
    map.set(e.entityId, list);
  }
  return map;
}
