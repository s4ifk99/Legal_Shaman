import type { EnrichmentSourceType } from "@/lib/provider-enrichment/types";

/** Source priority (1 = highest trust). */
export const SOURCE_PRIORITY: Record<EnrichmentSourceType, number> = {
  structured_db: 1,
  govuk_legal_aid: 2,
  manual_approved: 2,
  provider_website: 3,
  law_society: 4,
  sra_register: 5,
  curated_source: 6,
  trustpilot_api: 6,
  external_directory: 7,
  yell: 8,
};

export const AUTO_APPROVE_CONFIDENCE = 0.92;
export const REVIEW_THRESHOLD = 0.75;

export function confidenceForSource(
  sourceType: EnrichmentSourceType,
  extractionConfidence: number,
): number {
  const priorityBoost = (8 - SOURCE_PRIORITY[sourceType]) * 0.01;
  return Math.min(1, extractionConfidence * 0.92 + priorityBoost);
}

export function shouldAutoApprove(
  sourceType: EnrichmentSourceType,
  confidence: number,
  fieldName: string,
): boolean {
  if (fieldName === "phone" && sourceType === "external_directory") return false;
  if (sourceType === "structured_db" || sourceType === "govuk_legal_aid") {
    return confidence >= 0.85;
  }
  if (sourceType === "curated_source" && confidence >= AUTO_APPROVE_CONFIDENCE) {
    return true;
  }
  return confidence >= AUTO_APPROVE_CONFIDENCE && SOURCE_PRIORITY[sourceType] <= 4;
}

export function provenanceLabel(sourceType: EnrichmentSourceType): string {
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
      return "external signposting source";
    case "trustpilot_api":
      return "Trustpilot official API";
    case "yell":
      return "Yell business listing";
    case "manual_approved":
      return "manually approved source";
    default:
      return sourceType;
  }
}
