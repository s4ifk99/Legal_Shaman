import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { EnrichmentSourceType } from "@/lib/provider-enrichment/types";
import { extractCapabilityEnrichments } from "@/lib/provider-enrichment/capability-extractor";
import {
  extractEmailFromText,
  extractPhonesFromText,
  extractWebsiteFromText,
} from "@/lib/provider-enrichment/contact-extractor";
import { fetchApprovedSourcePage, isAllowedEnrichmentUrl } from "@/lib/provider-enrichment/source-fetcher";
import { submitEnrichmentCandidate } from "@/lib/provider-enrichment/review-queue";
import type { EnrichmentRunStats } from "@/lib/provider-enrichment/types";
import {
  capabilitiesToSlugList,
  extractCapabilities,
} from "@/lib/provider-intelligence/capability-extractor";
import { splitCapabilitiesByCategory } from "@/lib/provider-intelligence/capability-taxonomy";

export type EnrichmentMode = "contacts" | "capabilities" | "all";

function missingContactFields(doc: LegalEntityDocument): string[] {
  const missing: string[] = [];
  if (!doc.phone) missing.push("phone");
  if (!doc.email) missing.push("email");
  if (!doc.website) missing.push("website");
  return missing;
}

function sourceTypeForDoc(doc: LegalEntityDocument): EnrichmentSourceType {
  if (doc.legalAid || doc.entityType === "legal_aid_provider") return "govuk_legal_aid";
  if (doc.entityType === "sra_organisation") return "sra_register";
  if (doc.source === "curated" || doc.entityType.includes("law_centre")) return "curated_source";
  return "provider_website";
}

export async function enrichProviderDocument(
  doc: LegalEntityDocument,
  mode: EnrichmentMode,
): Promise<EnrichmentRunStats> {
  const stats: EnrichmentRunStats = {
    scanned: 1,
    candidates: 0,
    autoApproved: 0,
    pendingReview: 0,
    rejected: 0,
    skipped: 0,
    errors: [],
  };

  const missing = missingContactFields(doc);
  if (mode !== "capabilities" && !missing.length) {
    stats.skipped++;
    return stats;
  }

  const sourceUrl = doc.website ?? doc.profileUrl;
  const sourceType = sourceTypeForDoc(doc);

  if (mode !== "contacts") {
    const inferred = extractCapabilities({
      text: `${doc.title}\n${doc.description}\n${doc.searchText}`,
      practiceAreas: doc.practiceAreas,
      languages: doc.languages,
      legalAid: doc.legalAid,
      freeConsultation: doc.freeConsultation,
      source: doc.legalAid ? "legal_aid_categories" : "profile_description",
    });
    if (inferred.length) {
      const caps = extractCapabilityEnrichments(
        doc.id,
        doc.entityType,
        doc.searchText,
        doc.legalAid ? "legal_aid_categories" : "profile_description",
      );
      for (const c of caps) {
        stats.candidates++;
        const res = await submitEnrichmentCandidate(c);
        if (res.status === "auto_approved") stats.autoApproved++;
        else if (res.status === "pending_review") stats.pendingReview++;
        else stats.rejected++;
      }
    }
  }

  if (mode === "capabilities" || !missing.includes("phone")) {
    return stats;
  }

  let pageText = `${doc.title}\n${doc.description}`;
  if (sourceUrl && isAllowedEnrichmentUrl(sourceUrl)) {
    const page = await fetchApprovedSourcePage(sourceUrl);
    if (page) pageText = `${pageText}\n${page.text}`;
  }

  if (missing.includes("phone")) {
    const phones = extractPhonesFromText(pageText, { officialPage: Boolean(sourceUrl) });
    const best = phones[0];
    if (best) {
      stats.candidates++;
      const res = await submitEnrichmentCandidate({
        entityId: doc.id,
        entityType: doc.entityType,
        fieldName: "phone",
        extractedValue: best.e164,
        confidence: best.confidence,
        sourceUrl,
        sourceType,
        extractionMethod: "libphonenumber",
        provenanceNote: best.evidence,
      });
      if (res.status === "auto_approved") stats.autoApproved++;
      else if (res.status === "pending_review") stats.pendingReview++;
      else stats.rejected++;
    }
  }

  if (missing.includes("email")) {
    const email = extractEmailFromText(pageText);
    if (email) {
      stats.candidates++;
      const res = await submitEnrichmentCandidate({
        entityId: doc.id,
        entityType: doc.entityType,
        fieldName: "email",
        extractedValue: email.email,
        confidence: email.confidence,
        sourceUrl,
        sourceType,
        extractionMethod: "regex",
      });
      if (res.status === "auto_approved") stats.autoApproved++;
      else if (res.status === "pending_review") stats.pendingReview++;
      else stats.rejected++;
    }
  }

  if (missing.includes("website") && sourceUrl) {
    stats.candidates++;
    const res = await submitEnrichmentCandidate({
      entityId: doc.id,
      entityType: doc.entityType,
      fieldName: "website",
      extractedValue: sourceUrl,
      confidence: 0.9,
      sourceUrl,
      sourceType,
      extractionMethod: "structured_field",
    });
    if (res.status === "auto_approved") stats.autoApproved++;
    else if (res.status === "pending_review") stats.pendingReview++;
  }

  return stats;
}

/** Apply structured inference (no web fetch) directly onto index document. */
export function inferCapabilitiesOnDocument(doc: LegalEntityDocument): LegalEntityDocument {
  const extracted = extractCapabilities({
    text: `${doc.title}\n${doc.description}\n${doc.searchText}`,
    practiceAreas: doc.practiceAreas,
    languages: doc.languages,
    legalAid: doc.legalAid,
    freeConsultation: doc.freeConsultation,
    consultationOptions: doc.consultationOptions,
    source: doc.legalAid ? "legal_aid_categories" : "profile_description",
  });
  const slugs = capabilitiesToSlugList(extracted);
  const split = splitCapabilitiesByCategory(slugs);

  let enrichmentStatus = doc.enrichmentStatus ?? "none";
  if (doc.phone || doc.email) {
    enrichmentStatus = "structured";
  }

  return {
    ...doc,
    capabilities: split.capabilities,
    fundingCapabilities: split.fundingCapabilities,
    urgencyCapabilities: split.urgencyCapabilities,
    accessibilityCapabilities: split.accessibilityCapabilities,
    tribunalCapabilities: split.tribunalCapabilities,
    languages: [...new Set([...(doc.languages ?? []), ...split.languages])],
    remoteConsultation:
      doc.remoteConsultation ||
      split.accessibilityCapabilities.includes("accessibility.remote_consultation"),
    enrichmentStatus,
    contactSource: doc.contactSource ?? (doc.phone ? "structured_db" : undefined),
    contactConfidence: doc.contactConfidence ?? (doc.phone ? 0.95 : undefined),
  };
}
