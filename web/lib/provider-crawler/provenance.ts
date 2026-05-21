import type { CrawlSourceType, ExtractedFieldName } from "@/lib/provider-crawler/types";

/** Source priority (1 = highest trust). */
export const CRAWL_SOURCE_PRIORITY: Record<CrawlSourceType, number> = {
  structured_db: 1,
  govuk_legal_aid: 2,
  provider_website: 3,
  law_society: 4,
  sra_register: 5,
  curated_source: 6,
  trustpilot_api: 6,
  manual_approved: 2,
  external_directory: 7,
};

export const CRAWL_AUTO_APPROVE_CONFIDENCE = 0.92;
export const CRAWL_REVIEW_THRESHOLD = 0.75;

export function crawlConfidenceForSource(
  sourceType: CrawlSourceType,
  extractionConfidence: number,
): number {
  const priorityBoost = (8 - CRAWL_SOURCE_PRIORITY[sourceType]) * 0.01;
  return Math.min(1, extractionConfidence * 0.92 + priorityBoost);
}

export function shouldAutoApproveCrawlField(
  sourceType: CrawlSourceType,
  confidence: number,
  fieldName: ExtractedFieldName,
  reviewCategory: "field" | "testimonial" | "review_signal",
): boolean {
  if (reviewCategory !== "field") return false;
  if (fieldName === "phone" && sourceType === "external_directory") return false;
  if (fieldName === "email" && sourceType === "external_directory") return false;
  if (fieldName === "testimonial_snippet") return false;
  if (sourceType === "structured_db" || sourceType === "govuk_legal_aid") {
    return confidence >= 0.85;
  }
  if (sourceType === "manual_approved") return true;
  return confidence >= CRAWL_AUTO_APPROVE_CONFIDENCE && CRAWL_SOURCE_PRIORITY[sourceType] <= 4;
}

export function provenanceLabel(sourceType: CrawlSourceType): string {
  switch (sourceType) {
    case "structured_db":
      return "structured database field";
    case "govuk_legal_aid":
      return "GOV.UK legal aid data";
    case "provider_website":
      return "official provider website";
    case "law_society":
      return "Law Society directory";
    case "sra_register":
      return "SRA register";
    case "curated_source":
      return "curated directory listing";
    case "external_directory":
      return "approved external directory";
    case "trustpilot_api":
      return "Trustpilot official API";
    case "manual_approved":
      return "manually approved source";
    default:
      return sourceType;
  }
}

export function isContactField(fieldName: ExtractedFieldName): boolean {
  return fieldName === "phone" || fieldName === "email";
}
