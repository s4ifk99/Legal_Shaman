import { computeProviderCompletenessScore } from "@/lib/provider-enrichment-ladder/provider-completeness-score";
import { isWeakProvider } from "@/lib/provider-enrichment-ladder/weak-provider-detector";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";

export type ProviderContactDisplay = {
  phone?: string;
  email?: string;
  website?: string;
  contactPageUrl?: string;
  /** Internal diagnostics only — not for public UI. */
  contactEnrichmentPending?: boolean;
  provenanceLabel?: string;
};

const LAW_SOCIETY_SIGNPOST = "https://solicitors.lawsociety.org.uk/";
const SRA_SIGNPOST = "https://www.sra.org.uk/consumers/register/";

export function resolveProviderContactDisplay(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[] = [],
): ProviderContactDisplay {
  const approved = enrichments.filter(
    (e) => e.status === "approved" || e.status === "auto_approved",
  );
  const phone = doc.phone ?? approved.find((e) => e.fieldName === "phone")?.extractedValue;
  const email = doc.email ?? approved.find((e) => e.fieldName === "email")?.extractedValue;
  const website = doc.website ?? approved.find((e) => e.fieldName === "website")?.extractedValue;
  const contactPage = approved.find((e) => e.fieldName === "contactPageUrl")?.extractedValue;

  const weak = isWeakProvider(doc, enrichments);
  const provenance = approved[0]?.sourceType ?? doc.contactSource;

  return {
    phone,
    email,
    website,
    contactPageUrl: contactPage,
    contactEnrichmentPending: weak && !phone && !email,
    provenanceLabel: provenance,
  };
}

export function shouldSignpostExternalDirectory(
  results: { doc: LegalEntityDocument; enrichments?: ProviderEnrichment[] }[],
  threshold = 0.65,
): boolean {
  if (!results.length) return true;
  const weakCount = results.filter((r) =>
    isWeakProvider(r.doc, r.enrichments ?? []),
  ).length;
  return weakCount / results.length >= threshold;
}

export function externalDirectorySignpostUrls(): { lawSociety: string; sra: string } {
  return { lawSociety: LAW_SOCIETY_SIGNPOST, sra: SRA_SIGNPOST };
}

export function weakResultBoostEligible(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[],
  relevanceScore: number,
  minRelevance = 0.45,
): boolean {
  if (relevanceScore < minRelevance) return false;
  const completeness = computeProviderCompletenessScore(doc, enrichments);
  return completeness >= 0.55 && completeness < 0.85;
}
