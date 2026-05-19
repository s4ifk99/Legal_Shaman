import {
  capabilitiesToSlugList,
  extractCapabilities,
  type CapabilityExtractionSource,
} from "@/lib/provider-intelligence/capability-extractor";
import { splitCapabilitiesByCategory } from "@/lib/provider-intelligence/capability-taxonomy";
import type { EnrichmentCandidate } from "@/lib/provider-enrichment/types";

export function extractCapabilityEnrichments(
  entityId: string,
  entityType: string,
  text: string,
  source: CapabilityExtractionSource,
  sourceUrl?: string,
): EnrichmentCandidate[] {
  const extracted = extractCapabilities({ text, source });
  const slugs = capabilitiesToSlugList(extracted);
  if (!slugs.length) return [];

  const split = splitCapabilitiesByCategory(slugs);
  const avgConf =
    extracted.reduce((s, e) => s + e.confidence, 0) / Math.max(1, extracted.length);

  const candidates: EnrichmentCandidate[] = [
    {
      entityId,
      entityType,
      fieldName: "capabilities",
      extractedValue: split.capabilities.join(","),
      confidence: avgConf,
      sourceUrl,
      sourceType: mapSourceToEnrichmentType(source),
      extractionMethod: "capability_patterns",
    },
  ];

  if (split.fundingCapabilities.length) {
    candidates.push({
      entityId,
      entityType,
      fieldName: "fundingCapabilities",
      extractedValue: split.fundingCapabilities.join(","),
      confidence: avgConf,
      sourceUrl,
      sourceType: mapSourceToEnrichmentType(source),
      extractionMethod: "capability_patterns",
    });
  }
  if (split.urgencyCapabilities.length) {
    candidates.push({
      entityId,
      entityType,
      fieldName: "urgencyCapabilities",
      extractedValue: split.urgencyCapabilities.join(","),
      confidence: avgConf,
      sourceUrl,
      sourceType: mapSourceToEnrichmentType(source),
      extractionMethod: "capability_patterns",
    });
  }
  if (split.accessibilityCapabilities.length) {
    candidates.push({
      entityId,
      entityType,
      fieldName: "accessibilityCapabilities",
      extractedValue: split.accessibilityCapabilities.join(","),
      confidence: avgConf,
      sourceUrl,
      sourceType: mapSourceToEnrichmentType(source),
      extractionMethod: "capability_patterns",
    });
  }
  if (split.languages.length) {
    candidates.push({
      entityId,
      entityType,
      fieldName: "languages",
      extractedValue: split.languages.join(","),
      confidence: avgConf,
      sourceUrl,
      sourceType: mapSourceToEnrichmentType(source),
      extractionMethod: "capability_patterns",
    });
  }
  if (split.tribunalCapabilities.length) {
    candidates.push({
      entityId,
      entityType,
      fieldName: "tribunalCapabilities",
      extractedValue: split.tribunalCapabilities.join(","),
      confidence: avgConf,
      sourceUrl,
      sourceType: mapSourceToEnrichmentType(source),
      extractionMethod: "capability_patterns",
    });
  }

  return candidates;
}

function mapSourceToEnrichmentType(
  source: CapabilityExtractionSource,
): EnrichmentCandidate["sourceType"] {
  switch (source) {
    case "legal_aid_categories":
      return "govuk_legal_aid";
    case "law_society_page":
      return "law_society";
    case "sra_description":
      return "sra_register";
    case "website_page":
      return "provider_website";
    case "curated_metadata":
    case "manual_tags":
      return "curated_source";
    case "external_directory":
      return "external_directory";
    default:
      return "provider_website";
  }
}
