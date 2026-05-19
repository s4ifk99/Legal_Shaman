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

  return {
    ...next,
    enrichmentStatus,
    contactSource,
    contactConfidence,
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
