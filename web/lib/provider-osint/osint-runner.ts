import { persistExtractedField } from "@/lib/provider-crawler/review-queue";
import { submitEnrichmentCandidate } from "@/lib/provider-enrichment/review-queue";
import {
  isRegulatoryOrDirectoryUrl,
  REGULATORY_REJECT_REASON,
} from "@/lib/provider-enrichment/regulatory-url-filter";
import { validateExtractedField } from "@/lib/provider-enrichment-ladder/enrichment-validator";
import { validateWebsiteCandidate } from "@/lib/provider-enrichment-ladder/enrichment-validator";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";
import { extractWebsiteFromText } from "@/lib/provider-enrichment/contact-extractor";
import { matchStructuredDirectories } from "@/lib/provider-osint/structured-directory-index";
import { extractFieldsFromStructuredMatch } from "@/lib/provider-osint/structured-field-extract";
import { discoverWebsiteOsint } from "@/lib/provider-osint/website-discovery";
import type { OsintRunStats } from "@/lib/provider-osint/types";
import type { LadderExtractionStats } from "@/lib/provider-enrichment-ladder/types";

function mergeStats(target: LadderExtractionStats, osint: OsintRunStats): void {
  target.candidatesSubmitted += osint.fieldsSubmitted;
  target.pendingReview += osint.pendingReview;
  target.autoApproved += osint.autoApproved;
  target.rejected += osint.rejected;
}

/**
 * Run OSINT enrichment: structured public directories + website discovery.
 * All fields go through review queue unless auto-approved by provenance rules.
 */
export async function runOsintEnrichment(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[],
  stats: LadderExtractionStats,
  opts?: { discoverWebsite?: boolean; extractStructured?: boolean },
): Promise<{ website?: string }> {
  const osintStats: OsintRunStats = {
    structuredMatches: 0,
    websiteCandidates: 0,
    fieldsSubmitted: 0,
    pendingReview: 0,
    autoApproved: 0,
    rejected: 0,
  };

  let website =
    doc.website ?? extractWebsiteFromText(doc.searchText ?? "") ?? undefined;

  if (website && isRegulatoryOrDirectoryUrl(website)) {
    website = undefined;
  }

  const hasApprovedWebsite = enrichments.some(
    (e) =>
      e.fieldName === "website" &&
      (e.status === "approved" || e.status === "auto_approved"),
  );

  if (opts?.extractStructured !== false) {
    const matches = matchStructuredDirectories({
      title: doc.title,
      postcode: doc.postcode,
      city: doc.city,
      limit: 2,
    });
    osintStats.structuredMatches = matches.length;

    for (const match of matches) {
      const fields = extractFieldsFromStructuredMatch(doc, match);
      for (const c of fields) {
        if (c.fieldName === "website" && hasApprovedWebsite) continue;
        const valid = validateExtractedField(c);
        if (!valid.valid) {
          osintStats.rejected++;
          continue;
        }
        const res = await persistExtractedField(c);
        osintStats.fieldsSubmitted++;
        if (res.status === "pending_review") osintStats.pendingReview++;
        else if (res.status === "auto_approved") osintStats.autoApproved++;
        else osintStats.rejected++;

        if (c.fieldName === "website" && !website) {
          if (!isRegulatoryOrDirectoryUrl(c.extractedValue)) {
            website = c.extractedValue;
          }
        }
      }
    }
  }

  if (opts?.discoverWebsite !== false && !website && !hasApprovedWebsite) {
    const discovered = await discoverWebsiteOsint(doc);
    if (discovered) {
      osintStats.websiteCandidates++;
      const valid = validateWebsiteCandidate({
        url: discovered.url,
        confidence: discovered.confidence,
        sourceType: discovered.sourceType as "sra_register" | "law_society" | "provider_website" | "external_directory",
        sourceUrl: discovered.sourceUrl,
        provenanceNote: discovered.provenanceNote,
        needsReview: discovered.needsReview,
      });
      if (valid.valid) {
        const res = await submitEnrichmentCandidate({
          entityId: doc.id,
          entityType: doc.entityType,
          fieldName: "website",
          extractedValue: discovered.url,
          confidence: discovered.confidence,
          sourceUrl: discovered.sourceUrl,
          sourceType: discovered.sourceType,
          extractionMethod: "html_parse",
          provenanceNote: discovered.provenanceNote,
        });
        osintStats.fieldsSubmitted++;
        if (res.status === "pending_review") osintStats.pendingReview++;
        else if (res.status === "auto_approved") osintStats.autoApproved++;
        else {
          osintStats.rejected++;
          if (res.reason === REGULATORY_REJECT_REASON) {
            // regulatory URL — provenance only, not a firm website
          }
        }
        if (res.status !== "rejected") {
          website = discovered.url;
        }
      } else {
        osintStats.rejected++;
      }
    }
  }

  mergeStats(stats, osintStats);
  return { website };
}
