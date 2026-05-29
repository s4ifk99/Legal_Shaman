import { extractPhonesFromText } from "@/lib/provider-enrichment/contact-extractor";
import { isValidUkPhoneValue } from "@/lib/provider-crawler/extract-contact";
import { extractCapabilityFieldsFromText } from "@/lib/provider-crawler/extract-capabilities";
import { normalizePracticeAreas } from "@/lib/provider-crawler/practice-area-normalizer";
import { crawlConfidenceForSource } from "@/lib/provider-crawler/provenance";
import type { ExtractedFieldCandidate } from "@/lib/provider-crawler/types";
import type { StructuredDirectoryMatch } from "@/lib/provider-osint/types";
import type { LegalEntityDocument } from "@/lib/search-index/types";

function fieldCandidate(
  doc: LegalEntityDocument,
  match: StructuredDirectoryMatch,
  fieldName: ExtractedFieldCandidate["fieldName"],
  value: string,
  extractionMethod: ExtractedFieldCandidate["extractionMethod"],
  extractionConfidence: number,
): ExtractedFieldCandidate {
  return {
    entityId: doc.id,
    entityType: doc.entityType,
    fieldName,
    extractedValue: value,
    confidence: crawlConfidenceForSource(match.sourceType, extractionConfidence),
    sourceUrl: match.sourceUrl,
    sourceType: match.sourceType,
    extractionMethod,
    provenanceNote: match.provenanceNote,
    extractedAt: new Date(),
  };
}

/**
 * Build review-queue candidates from an approved structured directory match.
 * Never invents values — only fields present on the matched record.
 */
export function extractFieldsFromStructuredMatch(
  doc: LegalEntityDocument,
  match: StructuredDirectoryMatch,
): ExtractedFieldCandidate[] {
  const out: ExtractedFieldCandidate[] = [];
  const extractedAt = new Date();

  if (match.phone?.trim()) {
    const phones = extractPhonesFromText(match.phone, { officialPage: true });
    const best = phones.find((p) => isValidUkPhoneValue(p.e164));
    if (best) {
      out.push({
        entityId: doc.id,
        entityType: doc.entityType,
        fieldName: "phone",
        extractedValue: best.e164,
        confidence: crawlConfidenceForSource(match.sourceType, best.confidence),
        sourceUrl: match.sourceUrl,
        sourceType: match.sourceType,
        extractionMethod: "libphonenumber",
        provenanceNote: `${match.provenanceNote} | evidence: ${best.evidence}`,
        extractedAt,
      });
    }
  }

  if (match.email?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(match.email)) {
    out.push(
      fieldCandidate(doc, match, "email", match.email.toLowerCase(), "structured_field", 0.9),
    );
  }

  if (match.website?.trim()) {
    out.push(
      fieldCandidate(doc, match, "website", match.website, "structured_field", match.confidence),
    );
  }

  if (match.address?.trim()) {
    out.push(
      fieldCandidate(doc, match, "address", match.address.trim(), "structured_field", 0.85),
    );
  }

  if (match.openingHours?.trim()) {
    out.push(
      fieldCandidate(
        doc,
        match,
        "opening_hours",
        match.openingHours.trim(),
        "structured_field",
        0.8,
      ),
    );
  }

  if (match.practiceAreas?.length) {
    const raw = match.practiceAreas.join(", ");
    const normalized = normalizePracticeAreas(raw);
    if (normalized.canonicalSlugs.length) {
      out.push(
        fieldCandidate(
          doc,
          match,
          "practice_areas",
          normalized.canonicalSlugs.join(","),
          "structured_field",
          normalized.taxonomyConfidence || 0.85,
        ),
      );
    } else if (raw) {
      out.push(
        fieldCandidate(doc, match, "practice_areas", raw, "structured_field", 0.72),
      );
    }
  }

  const capText = [
    match.title,
    ...(match.practiceAreas ?? []),
    match.legalAid ? "legal aid" : "",
    match.freeConsultation ? "pro bono free consultation" : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (capText) {
    out.push(
      ...extractCapabilityFieldsFromText(capText, {
        entityId: doc.id,
        entityType: doc.entityType,
        sourceUrl: match.sourceUrl,
        sourceType: match.sourceType,
        practiceAreas: match.practiceAreas,
        legalAid: match.legalAid,
      }),
    );
  }

  return out;
}
