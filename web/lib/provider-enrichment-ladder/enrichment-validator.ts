import { validateEnrichmentCandidate } from "@/lib/provider-enrichment/validators";
import { isValidUkPhoneValue } from "@/lib/provider-crawler/extract-contact";
import type { EnrichmentCandidate } from "@/lib/provider-enrichment/types";
import type { ExtractedFieldCandidate } from "@/lib/provider-crawler/types";
import { isRegulatoryOrDirectoryUrl } from "@/lib/provider-enrichment/regulatory-url-filter";
import type { WebsiteDiscoveryCandidate } from "@/lib/provider-enrichment-ladder/types";

export type ValidationResult = { valid: boolean; reason?: string };

export function validateWebsiteCandidate(c: WebsiteDiscoveryCandidate): ValidationResult {
  if (!c.url?.trim()) return { valid: false, reason: "empty_url" };
  if (!/^https?:\/\//i.test(c.url)) return { valid: false, reason: "not_http" };
  if (isRegulatoryOrDirectoryUrl(c.url)) {
    return { valid: false, reason: "regulatory_url_not_provider_website" };
  }
  if (c.confidence < 0.5) return { valid: false, reason: "confidence_too_low" };
  if (!c.sourceUrl?.trim()) return { valid: false, reason: "missing_provenance_url" };
  if (!c.provenanceNote?.trim()) return { valid: false, reason: "missing_provenance_note" };
  try {
    const host = new URL(c.url).hostname;
    if (/example\.(com|org)|localhost/i.test(host)) {
      return { valid: false, reason: "placeholder_host" };
    }
  } catch {
    return { valid: false, reason: "invalid_url" };
  }
  return { valid: true };
}

export function validateExtractedField(c: ExtractedFieldCandidate): ValidationResult {
  if (!c.extractedValue?.trim()) return { valid: false, reason: "empty" };
  if (!c.sourceUrl?.trim() && c.fieldName !== "capabilities") {
    return { valid: false, reason: "missing_source_url" };
  }
  if (c.confidence < 0 || c.confidence > 1) {
    return { valid: false, reason: "confidence_out_of_range" };
  }
  if (c.fieldName === "phone" && !isValidUkPhoneValue(c.extractedValue)) {
    return { valid: false, reason: "invalid_uk_phone" };
  }
  return { valid: true };
}

export function validateEnrichmentCandidateStrict(
  c: EnrichmentCandidate,
): ValidationResult {
  const base = validateEnrichmentCandidate(c);
  if (!base.valid) return base;
  if (!c.sourceUrl?.trim() && ["phone", "email", "website"].includes(c.fieldName)) {
    return { valid: false, reason: "missing_source_url" };
  }
  if (!c.provenanceNote?.trim() && c.fieldName === "website") {
    return { valid: false, reason: "missing_provenance_note" };
  }
  return { valid: true };
}

/** Never persist without provenance — hard gate. */
export function assertHasProvenance(
  sourceUrl: string | undefined,
  provenanceNote: string | undefined,
): ValidationResult {
  if (!sourceUrl?.trim()) return { valid: false, reason: "no_source_url" };
  if (!provenanceNote?.trim()) return { valid: false, reason: "no_provenance_note" };
  return { valid: true };
}
