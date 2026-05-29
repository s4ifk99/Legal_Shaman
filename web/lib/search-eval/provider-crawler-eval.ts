import { emptyScores } from "@/lib/legal-search/ranking";
import type { SearchResult } from "@/lib/legal-search/types";
import {
  extractContactFieldsFromText,
  isValidUkPhoneValue,
} from "@/lib/provider-crawler/extract-contact";
import { isAllowedCrawlUrl } from "@/lib/provider-crawler/fetcher";
import { isPathAllowedByRules, pathDisallowed } from "@/lib/provider-crawler/robots";
import {
  TRUSTPILOT_SCRAPE_ENABLED,
  isTrustpilotApiConfigured,
  trustpilotFieldsFromStructured,
} from "@/lib/provider-crawler/trustpilot-api";
import {
  confidencePct,
  confidenceTier,
  isIdenticalToApproved,
  normalizeForDedup,
  valuesMatch,
} from "@/lib/provider-crawler/admin-review";
import {
  canonicalSlugDedupKey,
  normalizePracticeAreas,
} from "@/lib/provider-crawler/practice-area-normalizer";
import { shouldAutoApproveCrawlField } from "@/lib/provider-crawler/provenance";
import {
  applyProviderCapabilityRanking,
  sanitiseContactForDisplay,
} from "@/lib/provider-intelligence/provider-capability-ranker";
import { ruleBasedParse } from "@/lib/legal-search/query-rules";
import {
  capabilitiesToSlugList,
  extractCapabilities,
} from "@/lib/provider-intelligence/capability-extractor";

function mockResult(over: Partial<SearchResult> & { id: string }): SearchResult {
  const { id, ...rest } = over;
  return {
    id,
    source: rest.source ?? "curated_listing",
    title: rest.title ?? "Test Provider",
    practiceAreas: rest.practiceAreas ?? ["Immigration"],
    categories: [],
    raw: rest.raw ?? {},
    scores: rest.scores ?? emptyScores({ final: 0.5 }),
    explanation: "test",
    languages: rest.languages ?? [],
    contact: rest.contact,
    ...rest,
  };
}

export function runProviderCrawlerEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL provider-crawler: ${msg}`);
    failed++;
  };

  const officialPage = `
    <html><body>
    <p>Call our team on 020 7946 0958 or email contact@smithsolicitors.co.uk</p>
    <p>Visit https://smithsolicitors.co.uk/contact</p>
    </body></html>
  `;
  const contacts = extractContactFieldsFromText(officialPage, {
    entityId: "firm:1",
    entityType: "firm",
    sourceType: "provider_website",
    sourceUrl: "https://smithsolicitors.co.uk",
    officialPage: true,
  });
  const phone = contacts.find((c) => c.fieldName === "phone");
  const email = contacts.find((c) => c.fieldName === "email");
  if (!phone?.extractedValue.startsWith("+44")) fail("phone should be extracted from official page");
  if (!email?.extractedValue.includes("contact@smithsolicitors")) {
    fail("email should be extracted from contact page text");
  }
  if (!isValidUkPhoneValue(phone?.extractedValue ?? "")) fail("extracted phone should be valid UK");

  const invalid = extractContactFieldsFromText("Tel: 0000000000", {
    entityId: "firm:2",
    entityType: "firm",
    sourceType: "provider_website",
  });
  if (invalid.some((c) => c.fieldName === "phone" && c.extractedValue.includes("000000"))) {
    fail("invalid placeholder phone should be rejected");
  }

  const tpUrl = isAllowedCrawlUrl("https://www.trustpilot.com/review/example");
  if (tpUrl.allowed) fail("Trustpilot page scrape must be blocked");
  if (TRUSTPILOT_SCRAPE_ENABLED) fail("Trustpilot HTML scraping must stay disabled");
  if (isTrustpilotApiConfigured() && !process.env.TRUSTPILOT_API_KEY) {
    /* env may be set in CI */
  }

  const structuredOnly = trustpilotFieldsFromStructured({
    entityId: "firm:3",
    entityType: "firm",
    rating: 4.2,
    reviewCount: 10,
  });
  if (!structuredOnly.some((f) => f.fieldName === "review_aggregate_rating")) {
    fail("structured aggregate rating should be stored");
  }

  if (
    shouldAutoApproveCrawlField("external_directory", 0.95, "phone", "field")
  ) {
    fail("external directory phone must not auto-approve");
  }
  if (
    shouldAutoApproveCrawlField("provider_website", 0.7, "phone", "field")
  ) {
    fail("low-confidence phone should go to review");
  }

  const unapproved = mockResult({
    id: "c1",
    contact: { phone: "+442071234567", email: "pending@example.org" },
    raw: { enrichmentStatus: "pending_review", contactSource: "provider_website" },
  });
  const stripped = sanitiseContactForDisplay(unapproved);
  if (stripped.contact?.phone) fail("unapproved phone must not appear in search");
  if (stripped.contact?.email) fail("unapproved email must not appear in search");

  const approved = mockResult({
    id: "c2",
    contact: { phone: "+442071234567", email: "help@approved.org" },
    raw: { enrichmentStatus: "approved", contactSource: "provider_website" },
  });
  const shown = sanitiseContactForDisplay(approved);
  if (!shown.contact?.phone || !shown.contact?.email) {
    fail("approved contact fields should appear in search");
  }

  const invented = extractCapabilities({
    text: "We are a general law firm with no funding mentions.",
    source: "profile_description",
  });
  if (capabilitiesToSlugList(invented).includes("funding.legal_aid")) {
    fail("must not hallucinate legal aid capability");
  }

  const urgent = applyProviderCapabilityRanking(
    [
      mockResult({
        id: "u1",
        contact: { phone: "+442071234567" },
        raw: {
          enrichmentStatus: "approved",
          urgencyCapabilities: ["urgency.police_station"],
        },
      }),
      mockResult({
        id: "u2",
        raw: { enrichmentStatus: "pending_review" },
        scores: emptyScores({ final: 0.55 }),
      }),
    ],
    ruleBasedParse("police station tonight urgent"),
    { urgentIntent: true },
  );
  if (urgent[0]?.id !== "u1") fail("urgent search should prioritize approved phone provider");

  if (!pathDisallowed("/admin/private", "/admin")) fail("robots pathDisallowed should match prefix");
  if (isPathAllowedByRules("/contact", ["/admin"])) {
    /* ok */
  } else {
    fail("contact path should be allowed when /admin disallowed");
  }
  if (isPathAllowedByRules("/admin/settings", ["/admin"])) {
    fail("robots-disallowed path should be blocked");
  }

  if (confidenceTier(0.9) !== "high") fail("90% confidence should be high tier");
  if (confidenceTier(0.89) !== "medium") fail("89% confidence should be medium tier");
  if (confidenceTier(0.74) !== "low") fail("74% confidence should be low tier");
  if (confidencePct(0.876) !== 88) fail("confidencePct should round to integer percent");

  if (
    isIdenticalToApproved("practice_areas", "Family Law, Divorce", ["Family Law, Divorce"])
  ) {
    /* ok */
  } else {
    fail("identical practice area list should be hidden from review");
  }
  if (
    isIdenticalToApproved("practice_areas", "Housing Law, Debt", ["Housing Law"])
  ) {
    fail("superset practice areas should remain reviewable");
  }
  if (!valuesMatch("phone", "+44 20 7946 0958", "+442079460958")) {
    fail("phone values should match after normalisation");
  }
  const housingHomeless = normalizePracticeAreas("housing homelessness");
  if (!housingHomeless.canonicalSlugs.includes("housing")) {
    fail("housing homelessness should normalize to housing slug");
  }
  const housingLaw = normalizePracticeAreas("Housing Law");
  if (!housingLaw.canonicalSlugs.includes("housing")) {
    fail("Housing Law should normalize to housing slug");
  }
  const humanRights = normalizePracticeAreas("human rights");
  if (!humanRights.canonicalSlugs.includes("human_rights")) {
    fail("human rights should normalize to human_rights slug");
  }
  const jr = normalizePracticeAreas("Public Law and Judicial Review");
  if (!jr.canonicalSlugs.includes("judicial_review")) {
    fail("Public Law and Judicial Review should normalize to judicial_review slug");
  }
  const collapsed = normalizePracticeAreas("Housing Law, housing homelessness, Housing Law");
  if (collapsed.canonicalSlugs.length !== 1 || collapsed.canonicalSlugs[0] !== "housing") {
    fail("duplicate practice area variants should collapse to one canonical slug");
  }
  if (
    canonicalSlugDedupKey(collapsed.canonicalSlugs) !==
    canonicalSlugDedupKey(["housing", "housing"])
  ) {
    fail("canonical slug dedup key should collapse duplicates");
  }
  if (collapsed.canonicalSlugs[0] !== "housing") {
    fail("canonical slugs should be deterministically ordered");
  }
  const ordered = normalizePracticeAreas("debt, Community care, housing");
  if (ordered.canonicalSlugs.join("|") !== "community_care|debt|housing") {
    fail(`deterministic ordering failed: ${ordered.canonicalSlugs.join("|")}`);
  }
  const dupKeyA = normalizeForDedup("practice_areas", "Housing Law, housing homelessness");
  const dupKeyB = normalizeForDedup("practice_areas", "housing homelessness, Housing Law");
  if (dupKeyA !== dupKeyB) fail("practice area dedup keys should ignore order");

  if (failed === 0) console.info("provider crawler eval OK");
  return failed;
}
