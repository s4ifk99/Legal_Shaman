import { detectWeakReasons, isWeakProvider } from "@/lib/provider-enrichment-ladder/weak-provider-detector";
import { discoverFromSraFields } from "@/lib/provider-enrichment-ladder/official-website-discovery";
import {
  validateWebsiteCandidate,
  validateEnrichmentCandidateStrict,
} from "@/lib/provider-enrichment-ladder/enrichment-validator";
import { isValidUkPhoneValue } from "@/lib/provider-crawler/extract-contact";
import { slugsFromPageUrl } from "@/lib/provider-enrichment-ladder/practice-page-discovery";
import { applyApprovedEnrichmentsToDocument } from "@/lib/provider-enrichment/apply-approved-enrichments";
import type { LegalEntityDocument } from "@/lib/search-index/types";

function minimalSraDoc(overrides: Partial<LegalEntityDocument> = {}): LegalEntityDocument {
  return {
    id: "sra:123",
    entityType: "sra_organisation",
    title: "Example LLP",
    description: "Test",
    practiceAreas: [],
    categories: [],
    subIssues: [],
    searchText: "Example LLP short",
    expandedSearchText: "",
    source: "sra",
    legalAid: false,
    authorityScore: 0.78,
    profileCompletenessScore: 0.3,
    rawSourceId: "123",
    updatedAt: Date.now(),
    ...overrides,
  };
}

const CASES: { id: string; check: () => boolean | Promise<boolean> }[] = [
  {
    id: "weak-detection",
    check: () => {
      const reasons = detectWeakReasons(minimalSraDoc());
      return reasons.includes("no_phone") && reasons.includes("no_practice_area_slugs");
    },
  },
  {
    id: "weak-flag",
    check: () => isWeakProvider(minimalSraDoc()),
  },
  {
    id: "website-from-sra-text",
    check: async () => {
      const c = await discoverFromSraFields(
        minimalSraDoc({ searchText: "Example LLP https://www.example-llp.co.uk" }),
      );
      return Boolean(c?.url.includes("example-llp.co.uk") && validateWebsiteCandidate(c!).valid);
    },
  },
  {
    id: "no-invented-website",
    check: () =>
      !validateWebsiteCandidate({
        url: "https://invented.example",
        confidence: 0.99,
        sourceType: "provider_website",
        sourceUrl: "",
        provenanceNote: "",
        needsReview: true,
      }).valid,
  },
  {
    id: "uk-phone-validation",
    check: () =>
      isValidUkPhoneValue("+442012345678") && !isValidUkPhoneValue("+440000000000"),
  },
  {
    id: "practice-url-slug",
    check: () =>
      slugsFromPageUrl("https://firm.example/employment-law").some((h) => h.slug === "employment"),
  },
  {
    id: "approved-enrichment-on-index",
    check: () => {
      const doc = minimalSraDoc();
      const out = applyApprovedEnrichmentsToDocument(doc, [
        {
          id: "1",
          entityId: doc.id,
          entityType: doc.entityType,
          fieldName: "phone",
          extractedValue: "+442012345678",
          confidence: 0.95,
          sourceUrl: "https://www.example-llp.co.uk/contact",
          sourceType: "provider_website",
          extractionMethod: "libphonenumber",
          status: "approved",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      return out.phone === "+442012345678";
    },
  },
  {
    id: "pending-enrichment-hidden",
    check: () => {
      const doc = minimalSraDoc();
      const out = applyApprovedEnrichmentsToDocument(doc, [
        {
          id: "2",
          entityId: doc.id,
          entityType: doc.entityType,
          fieldName: "phone",
          extractedValue: "+449999999999",
          confidence: 0.5,
          sourceUrl: "https://evil.example",
          sourceType: "external_directory",
          extractionMethod: "regex",
          status: "pending_review",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      return out.phone === undefined;
    },
  },
  {
    id: "strict-contact-provenance",
    check: () =>
      !validateEnrichmentCandidateStrict({
        entityId: "sra:1",
        entityType: "sra_organisation",
        fieldName: "phone",
        extractedValue: "+442012345678",
        confidence: 0.9,
        sourceType: "provider_website",
        extractionMethod: "libphonenumber",
      }).valid,
  },
];

export async function runProviderEnrichmentLadderEval(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  for (const c of CASES) {
    try {
      if (await c.check()) passed++;
      else {
        failed++;
        console.error(`provider-enrichment-ladder eval FAIL: ${c.id}`);
      }
    } catch (e) {
      failed++;
      console.error(`provider-enrichment-ladder eval ERROR: ${c.id}`, e);
    }
  }
  if (failed === 0) console.info("provider enrichment ladder eval OK");
  return { passed, failed };
}
