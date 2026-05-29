import { extractPhonesFromText } from "@/lib/provider-enrichment/contact-extractor";
import { isValidUkPhoneValue } from "@/lib/provider-crawler/extract-contact";
import { applyApprovedEnrichmentsToDocument } from "@/lib/provider-enrichment/apply-approved-enrichments";
import {
  scoreOfficialDomain,
  websiteNeedsReviewFromDomain,
  OFFICIAL_DOMAIN_AUTO_APPROVE,
} from "@/lib/provider-osint/official-domain-scoring";
import { discoverFromSraRegister } from "@/lib/provider-osint/website-discovery";
import {
  validateWebsiteCandidate,
  validateEnrichmentCandidateStrict,
} from "@/lib/provider-enrichment-ladder/enrichment-validator";
import { slugsFromPageUrl } from "@/lib/provider-enrichment-ladder/practice-page-discovery";
import type { LegalEntityDocument } from "@/lib/search-index/types";

function minimalDoc(overrides: Partial<LegalEntityDocument> = {}): LegalEntityDocument {
  return {
    id: "sra:999",
    entityType: "sra_organisation",
    title: "Smith & Jones Solicitors LLP",
    description: "",
    practiceAreas: [],
    categories: [],
    subIssues: [],
    searchText: "",
    expandedSearchText: "",
    source: "sra",
    legalAid: false,
    authorityScore: 0.78,
    profileCompletenessScore: 0.2,
    rawSourceId: "999",
    updatedAt: Date.now(),
    ...overrides,
  };
}

const CASES: { id: string; check: () => boolean }[] = [
  {
    id: "no-hallucinated-contact",
    check: () =>
      !validateEnrichmentCandidateStrict({
        entityId: "sra:1",
        entityType: "sra_organisation",
        fieldName: "email",
        extractedValue: "fake@invented.example",
        confidence: 0.99,
        sourceType: "provider_website",
        extractionMethod: "regex",
      }).valid,
  },
  {
    id: "official-domain-high-confidence",
    check: () => {
      const d = scoreOfficialDomain(
        "https://www.smithjones-solicitors.co.uk",
        "Smith & Jones Solicitors LLP",
        { postcode: "EC1A 1BB" },
      );
      return d.score >= 0.7 && !d.isDirectory;
    },
  },
  {
    id: "uncertain-website-to-review",
    check: () => {
      const d = scoreOfficialDomain("https://www.yelp.com/biz/smith", "Smith Solicitors");
      return websiteNeedsReviewFromDomain(d) && d.isDirectory;
    },
  },
  {
    id: "yelp-discovery-needs-review",
    check: () => {
      const c = discoverFromSraRegister(
        minimalDoc({
          searchText: "Smith https://www.yelp.com/biz/smith-solicitors",
        }),
      );
      return !c || c.needsReview;
    },
  },
  {
    id: "phone-normalized-e164",
    check: () => {
      const phones = extractPhonesFromText("Call us on 020 7946 0958", { officialPage: true });
      return phones.length > 0 && phones[0].e164.startsWith("+44");
    },
  },
  {
    id: "invalid-phone-rejected",
    check: () => !isValidUkPhoneValue("+440000000000"),
  },
  {
    id: "practice-url-taxonomy",
    check: () =>
      slugsFromPageUrl("https://firm.example/family-law/divorce").some((h) => h.slug === "family"),
  },
  {
    id: "approved-enrichment-index",
    check: () => {
      const doc = minimalDoc();
      const out = applyApprovedEnrichmentsToDocument(doc, [
        {
          id: "a1",
          entityId: doc.id,
          entityType: doc.entityType,
          fieldName: "practiceAreaSlugs",
          extractedValue: "employment,family",
          confidence: 0.9,
          sourceUrl: "https://www.example.co.uk/services",
          sourceType: "provider_website",
          extractionMethod: "html_parse",
          status: "approved",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      return (out.practiceAreaSlugs?.length ?? 0) >= 2;
    },
  },
  {
    id: "unapproved-hidden-from-index",
    check: () => {
      const doc = minimalDoc();
      const out = applyApprovedEnrichmentsToDocument(doc, [
        {
          id: "p1",
          entityId: doc.id,
          entityType: doc.entityType,
          fieldName: "website",
          extractedValue: "https://should-not-show.example",
          confidence: 0.6,
          sourceUrl: "https://yelp.com/x",
          sourceType: "external_directory",
          extractionMethod: "html_parse",
          status: "pending_review",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      return !out.website;
    },
  },
  {
    id: "sra-website-valid-provenance",
    check: () => {
      const c = discoverFromSraRegister(
        minimalDoc({ searchText: "Firm https://www.smithjoneslaw.co.uk" }),
      );
      return (
        Boolean(c) &&
        validateWebsiteCandidate({
          url: c!.url,
          confidence: c!.confidence,
          sourceType: "sra_register",
          sourceUrl: c!.sourceUrl,
          provenanceNote: c!.provenanceNote,
          needsReview: c!.needsReview,
        }).valid &&
        c!.confidence <= 1
      );
    },
  },
  {
    id: "auto-approve-threshold-sane",
    check: () => OFFICIAL_DOMAIN_AUTO_APPROVE >= 0.85 && OFFICIAL_DOMAIN_AUTO_APPROVE <= 0.95,
  },
];

export function runProviderOsintEval(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  for (const c of CASES) {
    try {
      if (c.check()) passed++;
      else {
        failed++;
        console.error(`provider-osint eval FAIL: ${c.id}`);
      }
    } catch (e) {
      failed++;
      console.error(`provider-osint eval ERROR: ${c.id}`, e);
    }
  }
  if (failed === 0) console.info("provider OSINT eval OK");
  return { passed, failed };
}
