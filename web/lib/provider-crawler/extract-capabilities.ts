import { extractCapabilityEnrichments } from "@/lib/provider-enrichment/capability-extractor";
import type { CrawlSourceType, ExtractedFieldCandidate } from "@/lib/provider-crawler/types";
import { crawlConfidenceForSource } from "@/lib/provider-crawler/provenance";
import type { CapabilityExtractionSource } from "@/lib/provider-intelligence/capability-extractor";

function mapSource(sourceType: CrawlSourceType): CapabilityExtractionSource {
  switch (sourceType) {
    case "govuk_legal_aid":
      return "legal_aid_categories";
    case "law_society":
      return "law_society_page";
    case "sra_register":
      return "sra_description";
    case "curated_source":
      return "curated_metadata";
    case "external_directory":
      return "external_directory";
    default:
      return "website_page";
  }
}

/**
 * Extract practice areas and capability slugs from page text (pattern-based; never invents).
 */
export function extractCapabilityFieldsFromText(
  text: string,
  ctx: {
    entityId: string;
    entityType: string;
    sourceUrl?: string;
    sourceType: CrawlSourceType;
    practiceAreas?: string[];
    legalAid?: boolean;
  },
): ExtractedFieldCandidate[] {
  const source = mapSource(ctx.sourceType);
  const enrichments = extractCapabilityEnrichments(
    ctx.entityId,
    ctx.entityType,
    text,
    source,
    ctx.sourceUrl,
  );

  const out: ExtractedFieldCandidate[] = enrichments.map((e) => ({
    entityId: e.entityId,
    entityType: e.entityType,
    fieldName: e.fieldName as ExtractedFieldCandidate["fieldName"],
    extractedValue: e.extractedValue,
    confidence: crawlConfidenceForSource(e.sourceType as CrawlSourceType, e.confidence),
    sourceUrl: e.sourceUrl,
    sourceType: ctx.sourceType,
    extractionMethod: "capability_patterns",
    extractedAt: new Date(),
  }));

  if (ctx.practiceAreas?.length) {
    const joined = [...new Set(ctx.practiceAreas)].join(", ");
    if (joined) {
      out.push({
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        fieldName: "practice_areas",
        extractedValue: joined,
        confidence: crawlConfidenceForSource(ctx.sourceType, 0.85),
        sourceUrl: ctx.sourceUrl,
        sourceType: ctx.sourceType,
        extractionMethod: "structured_field",
        extractedAt: new Date(),
      });
    }
  }

  return out;
}
