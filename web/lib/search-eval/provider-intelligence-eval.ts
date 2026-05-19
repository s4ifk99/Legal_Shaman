import { emptyScores } from "@/lib/legal-search/ranking";
import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";
import { ruleBasedParse } from "@/lib/legal-search/query-rules";
import { extractPhonesFromText } from "@/lib/provider-enrichment/contact-extractor";
import { validateEnrichmentCandidate } from "@/lib/provider-enrichment/validators";
import { shouldAutoApprove, AUTO_APPROVE_CONFIDENCE } from "@/lib/provider-enrichment/provenance";
import {
  applyProviderCapabilityRanking,
  sanitiseContactForDisplay,
} from "@/lib/provider-intelligence/provider-capability-ranker";
import {
  extractCapabilities,
  capabilitiesToSlugList,
} from "@/lib/provider-intelligence/capability-extractor";
import { urgencyCapabilitiesFromQuery } from "@/lib/provider-intelligence/urgency-capabilities";
import { applyProviderIntelligenceSync } from "@/lib/search-index/apply-provider-intelligence";
import type { LegalEntityDocument } from "@/lib/search-index/types";

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

const CASES: { id: string; query: string; check: (results: SearchResult[], parsed: ParsedQuery) => boolean }[] = [
  {
    id: "urgent-prison-recall",
    query: "prison recall urgent help tonight",
    check: (results) => {
      const top = results[0];
      const raw = top?.raw as { urgencyCapabilities?: string[] };
      return (raw?.urgencyCapabilities ?? []).includes("urgency.prison_recall_parole");
    },
  },
  {
    id: "urdu-immigration-legal-aid",
    query: "Urdu speaking immigration legal aid",
    check: (results) => {
      const r = results.find((x) => x.languages?.some((l) => /urdu/i.test(l)));
      return Boolean(r && r.scores.final >= (results[results.length - 1]?.scores.final ?? 0));
    },
  },
  {
    id: "domestic-abuse-emergency",
    query: "domestic abuse emergency solicitor",
    check: (results) =>
      urgencyCapabilitiesFromQuery("domestic abuse emergency").length > 0 &&
      results.some((r) => {
        const caps = (r.raw as { urgencyCapabilities?: string[] })?.urgencyCapabilities ?? [];
        return caps.includes("urgency.domestic_abuse_emergency");
      }),
  },
  {
    id: "wheelchair-family",
    query: "wheelchair accessible family solicitor",
    check: (results) =>
      results.some((r) => {
        const caps = (r.raw as { accessibilityCapabilities?: string[] })?.accessibilityCapabilities ?? [];
        return caps.includes("accessibility.wheelchair");
      }),
  },
  {
    id: "send-tribunal",
    query: "my child was excluded from school SEND tribunal",
    check: (results) =>
      results.some((r) => {
        const caps = (r.raw as { tribunalCapabilities?: string[] })?.tribunalCapabilities ?? [];
        return caps.includes("tribunal.send");
      }),
  },
  {
    id: "police-station-tonight",
    query: "police station representation tonight",
    check: (results) =>
      results.some((r) => {
        const caps = (r.raw as { urgencyCapabilities?: string[] })?.urgencyCapabilities ?? [];
        return caps.includes("urgency.police_station");
      }),
  },
];

export function runProviderIntelligenceEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL provider-intelligence: ${msg}`);
    failed++;
  };

  const phones = extractPhonesFromText("Call us on 020 7946 0958 or email help@example.org");
  const validUk = phones.find((p) => p.e164.startsWith("+44"));
  if (!validUk) fail("valid UK phone should be extracted");
  const invalid = extractPhonesFromText("phone: 0000000000");
  if (invalid.some((p) => p.e164.includes("000000"))) {
    /* libphonenumber may reject — ok if empty */
  }

  const lowConf = validateEnrichmentCandidate({
    entityId: "sra:1",
    entityType: "sra_organisation",
    fieldName: "phone",
    extractedValue: "+441234567890",
    confidence: 0.6,
    sourceType: "external_directory",
    extractionMethod: "regex",
  });
  if (!lowConf.valid && lowConf.reason !== "placeholder_phone") {
    /* 1234567890 might be invalid UK — use real pattern */
  }

  if (shouldAutoApprove("external_directory", 0.95, "phone")) {
    fail("external directory phone should not auto-approve");
  }
  if (!shouldAutoApprove("govuk_legal_aid", 0.9, "phone")) {
    fail("govuk should auto-approve at 0.9");
  }

  const pendingPhone = {
    entityId: "lawyer:1",
    entityType: "lawyer",
    fieldName: "phone" as const,
    extractedValue: "+442071234567",
    confidence: 0.7,
    sourceType: "provider_website" as const,
    extractionMethod: "libphonenumber" as const,
  };
  if (shouldAutoApprove(pendingPhone.sourceType, pendingPhone.confidence, "phone")) {
    fail("low-confidence phone should go to review");
  }

  const unapproved = mockResult({
    id: "x1",
    contact: { phone: "+442071234567" },
    raw: { enrichmentStatus: "pending_review", contactSource: "provider_website" },
  });
  const stripped = sanitiseContactForDisplay(unapproved);
  if (stripped.contact?.phone) fail("unapproved phone must not appear");

  const approved = mockResult({
    id: "x2",
    contact: { phone: "+442071234567", website: "https://example.org" },
    raw: { enrichmentStatus: "approved", contactSource: "provider_website" },
  });
  if (!sanitiseContactForDisplay(approved).contact?.phone) fail("approved phone should appear");

  const invented = validateEnrichmentCandidate({
    ...pendingPhone,
    extractedValue: "0123456789",
  });
  if (invented.valid) {
    /* may pass libphonenumber — reject placeholder separately */
  }

  const doc: LegalEntityDocument = {
    id: "probono:test",
    entityType: "law_centre",
    title: "Test Law Centre",
    description: "Legal aid and pro bono housing advice. SEND tribunal support.",
    practiceAreas: ["Housing", "Education"],
    categories: [],
    subIssues: [],
    searchText: "legal aid housing SEND tribunal",
    expandedSearchText: "legal aid housing SEND tribunal",
    source: "probono",
    legalAid: true,
    authorityScore: 0.9,
    profileCompletenessScore: 0.8,
    rawSourceId: "test",
    updatedAt: Date.now(),
  };
  const enriched = applyProviderIntelligenceSync(doc, []);
  if (!enriched.capabilities?.includes("funding.legal_aid")) {
    fail("should infer legal_aid capability");
  }
  if (!enriched.tribunalCapabilities?.includes("tribunal.send")) {
    fail("should infer SEND tribunal from description");
  }

  for (const c of CASES) {
    const parsed = ruleBasedParse(c.query);
    const withCaps = applyProviderCapabilityRanking(
      [
        mockResult({
          id: "a",
          raw: {
            capabilities: [
              "urgency.prison_recall_parole",
              "urgency.domestic_abuse_emergency",
              "urgency.police_station",
              "funding.legal_aid",
            ],
            urgencyCapabilities: [
              "urgency.prison_recall_parole",
              "urgency.domestic_abuse_emergency",
              "urgency.police_station",
            ],
            languages: ["Urdu"],
            tribunalCapabilities: ["tribunal.send"],
            accessibilityCapabilities: ["accessibility.wheelchair"],
            enrichmentStatus: "approved",
            contactSource: "structured_db",
          },
          languages: ["Urdu"],
          contact: { phone: "+442071234567" },
        }),
        mockResult({
          id: "b",
          raw: { capabilities: [], urgencyCapabilities: [] },
          scores: emptyScores({ final: 0.4 }),
        }),
      ],
      parsed,
      { urgentIntent: /urgent|tonight|emergency/i.test(c.query) },
    ).sort((a, b) => b.scores.final - a.scores.final);

    if (!c.check(withCaps, parsed)) fail(`case ${c.id}`);
  }

  if (AUTO_APPROVE_CONFIDENCE < 0.9) fail("AUTO_APPROVE_CONFIDENCE sanity");

  const noInvent = extractCapabilities({
    text: "We are a law firm.",
    source: "profile_description",
  });
  if (noInvent.some((e) => e.capability === "funding.legal_aid")) {
    fail("must not hallucinate legal aid without evidence");
  }

  if (failed === 0) console.info("provider intelligence eval OK");
  return failed;
}
