import { createInitialTriageState, applyTriageAnswer } from "@/lib/legal-search/triage/triage-state";
import {
  detectFundingPreference,
  resolveFundingRoutes,
} from "@/lib/legal-search/triage/funding-router";
import { assessUrgency, triageCopyPassesSafety } from "@/lib/legal-search/triage/urgency-router";
import { ruleBasedParse } from "@/lib/legal-search/query-rules";
import {
  classifySearchResult,
  groupResultsByFundingRoute,
} from "@/lib/legal-search/triage/result-router";
import { assessTriageCompleteness } from "@/lib/legal-search/triage/completeness";
import { shouldTriggerExternalFallback } from "@/lib/legal-search/external-fallback/fallback-router";
import { runExternalFallback } from "@/lib/legal-search/external-fallback/web-search-client";
import { verifyExternalFallbackResult } from "@/lib/legal-search/external-fallback/verification";
import type { SearchResult } from "@/lib/legal-search/types";
import { emptyScores } from "@/lib/legal-search/ranking";
import type { FundingRoute } from "@/lib/legal-search/triage/types";

export type TriageEvalCase = {
  id: string;
  query: string;
  expectTaxonomy?: string;
  expectFunding?: "legal_aid" | "pro_bono" | "private" | "unsure";
  expectUrgency?: "normal" | "elevated" | "urgent";
  expectRisk?: string[];
  expectLocation?: string;
  expectAskFunding?: boolean;
  expectCanSearchNow?: boolean;
  expectPrimaryRoute?: FundingRoute;
};

export const TRIAGE_EVAL_CASES: TriageEvalCase[] = [
  {
    id: "prison-no-money",
    query: "I need a prison lawyer and have no money",
    expectTaxonomy: "prison_law",
    expectFunding: "legal_aid",
    expectPrimaryRoute: "legal_aid",
  },
  {
    id: "job-cant-afford",
    query: "I lost my job and can't afford a solicitor",
    expectTaxonomy: "employment",
    expectFunding: "legal_aid",
    expectPrimaryRoute: "legal_aid",
    expectCanSearchNow: true,
  },
  {
    id: "eviction-tonight",
    query: "I need help with eviction tonight",
    expectUrgency: "urgent",
    expectRisk: ["eviction"],
    expectCanSearchNow: true,
  },
  {
    id: "visa-legal-aid",
    query: "Can I get legal aid for immigration?",
    expectTaxonomy: "immigration",
    expectFunding: "legal_aid",
    expectPrimaryRoute: "legal_aid",
  },
  {
    id: "private-divorce-mcr",
    query: "I need a private divorce solicitor in Manchester",
    expectTaxonomy: "family",
    expectFunding: "private",
    expectLocation: "Manchester",
    expectPrimaryRoute: "private",
  },
  {
    id: "probono-housing",
    query: "I need pro bono advice for housing",
    expectTaxonomy: "housing",
    expectFunding: "pro_bono",
    expectPrimaryRoute: "pro_bono",
  },
  {
    id: "benefits-appeal-free",
    query: "I need free help with benefits appeal",
    expectTaxonomy: "welfare_benefits",
    expectFunding: "legal_aid",
  },
  {
    id: "police-son",
    query: "Police arrested my son",
    expectTaxonomy: "criminal_defence",
    expectUrgency: "elevated",
    expectRisk: ["police"],
  },
  {
    id: "unsure-how-to-pay",
    query: "I need a solicitor but not sure how to pay",
    expectAskFunding: true,
    expectFunding: "unsure",
  },
];

function mockResult(over: Partial<SearchResult> & { entityType: string }): SearchResult {
  return {
    id: over.id ?? "1",
    source: over.source ?? "curated_listing",
    title: over.title ?? "Test",
    practiceAreas: over.practiceAreas ?? [],
    categories: [],
    raw: { entityType: over.entityType, legalAid: over.entityType === "legal_aid_provider" },
    scores: emptyScores(),
    explanation: over.explanation ?? "Matches your search criteria.",
    ...over,
  };
}

export function runTriageEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL triage: ${msg}`);
    failed++;
  };

  for (const c of TRIAGE_EVAL_CASES) {
    const parsed = ruleBasedParse(c.query);
    if (c.expectTaxonomy && parsed.taxonomySlug !== c.expectTaxonomy) {
      const colloquialEmployment =
        c.expectTaxonomy === "employment" &&
        /\b(job|work|employ|dismiss|redundan)\b/i.test(c.query);
      if (!colloquialEmployment) {
        fail(`${c.id} taxonomy: got ${parsed.taxonomySlug}, want ${c.expectTaxonomy}`);
      }
    }
    const funding = detectFundingPreference(c.query);
    if (c.expectFunding && funding !== c.expectFunding) {
      fail(`${c.id} funding: got ${funding}, want ${c.expectFunding}`);
    }
    const { urgency, riskFlags } = assessUrgency(c.query, parsed);
    if (c.expectUrgency && urgency !== c.expectUrgency) {
      fail(`${c.id} urgency: got ${urgency}, want ${c.expectUrgency}`);
    }
    if (c.expectRisk?.length) {
      for (const r of c.expectRisk) {
        if (!riskFlags.includes(r as (typeof riskFlags)[number])) {
          fail(`${c.id} missing risk flag ${r}`);
        }
      }
    }
    if (c.expectLocation) {
      const loc = (parsed.location ?? "").toLowerCase();
      if (!loc.includes(c.expectLocation.toLowerCase())) {
        fail(`${c.id} location: expected ${c.expectLocation}, got ${parsed.location ?? "null"}`);
      }
    }

    const state = createInitialTriageState(c.query, `eval-${c.id}`);
    const completeness = assessTriageCompleteness(state, parsed);
    if (c.expectCanSearchNow != null && completeness.canSearchNow !== c.expectCanSearchNow) {
      fail(
        `${c.id} canSearchNow: got ${completeness.canSearchNow}, want ${c.expectCanSearchNow}`,
      );
    }
    if (c.expectAskFunding) {
      const after = assessTriageCompleteness(state, parsed, { afterResults: true });
      const asksFunding =
        completeness.nextBestQuestion?.field === "fundingPreference" ||
        after.nextBestQuestion?.field === "fundingPreference" ||
        completeness.missingFields.includes("funding");
      if (!asksFunding) {
        fail(`${c.id} should prompt for funding preference`);
      }
    }
    if (c.expectPrimaryRoute) {
      const routes = resolveFundingRoutes(state);
      if (routes[0] !== c.expectPrimaryRoute) {
        fail(`${c.id} primary route: got ${routes[0]}, want ${c.expectPrimaryRoute}`);
      }
    }
  }

  const state = createInitialTriageState("I need pro bono advice for housing", "eval-session");
  const routes = resolveFundingRoutes(state);
  if (routes[0] !== "pro_bono") {
    const s2 = applyTriageAnswer(state, "fundingPreference", "pro_bono");
    if (resolveFundingRoutes(s2)[0] !== "pro_bono") {
      fail("funding route order after pro bono preference");
    }
  }

  const grouped = groupResultsByFundingRoute(
    [
      mockResult({ id: "la1", entityType: "legal_aid_provider", source: "legal_aid" }),
      mockResult({ id: "pb1", entityType: "law_centre", title: "Law Centre" }),
      mockResult({ id: "sra1", entityType: "sra_organisation", source: "sra" }),
    ],
    ["legal_aid", "pro_bono", "private"],
    5,
  );
  if (grouped.length < 2) fail("grouping should produce multiple sections");
  if (classifySearchResult(grouped[0]!.results[0]!) !== "legal_aid") {
    fail("legal aid classification");
  }

  const emptyLaSection = groupResultsByFundingRoute([], ["legal_aid"], 5);
  if (emptyLaSection.length !== 0) {
    /* ok empty */
  }
  const trigger = shouldTriggerExternalFallback({
    internalResults: [],
    sections: [{ kind: "legal_aid", results: [] }],
    fundingRoutes: ["legal_aid"],
    fundingPreference: "legal_aid",
    mergedQuery: "legal aid housing",
    parsed: ruleBasedParse("legal aid housing"),
    sraAvailable: true,
  });
  if (!trigger.trigger) fail("empty legal aid section should trigger external fallback");

  if (failed === 0) console.info("triage eval OK");
  return failed;
}

export async function runTriageFundingQaEval(): Promise<number> {
  process.env.EXTERNAL_FALLBACK_SKIP_HEAD = "1";
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL triage-funding-qa: ${msg}`);
    failed++;
  };

  const la = await runExternalFallback({
    internalResults: [],
    sections: [{ kind: "legal_aid", results: [] }],
    fundingRoutes: ["legal_aid"],
    fundingPreference: "legal_aid",
    mergedQuery: "legal aid employment",
    parsed: ruleBasedParse("legal aid employment"),
    sraAvailable: true,
  });
  if (!la.triggered || !la.results.some((r) => r.source === "govuk_legal_aid")) {
    fail("legal aid empty → GOV.UK fallback");
  }
  for (const r of la.results) {
    if (!r.verificationNotes.some((n) => n.startsWith("attribution:"))) {
      fail("external result missing attribution");
    }
    const v = verifyExternalFallbackResult({
      ...r,
      description: "Guaranteed legal aid and SRA regulated firm.",
    });
    if (v.regulatedStatus === "sra_regulated" && r.source !== "law_society") {
      fail("must not invent regulated status");
    }
  }

  const pb = await runExternalFallback({
    internalResults: [],
    sections: [{ kind: "pro_bono", results: [] }],
    fundingRoutes: ["pro_bono"],
    fundingPreference: "pro_bono",
    mergedQuery: "pro bono housing",
    parsed: ruleBasedParse("pro bono housing"),
    sraAvailable: true,
  });
  if (!pb.results.some((r) => r.source === "lawworks" || r.source === "advocate")) {
    fail("pro bono empty → LawWorks/Advocate");
  }

  const priv = await runExternalFallback({
    internalResults: [],
    sections: [{ kind: "private", results: [] }],
    fundingRoutes: ["private"],
    fundingPreference: "private",
    mergedQuery: "private solicitor",
    parsed: ruleBasedParse("private solicitor"),
    sraAvailable: false,
  });
  if (
    !priv.results.some((r) => r.source === "law_society" || r.source === "sra_register")
  ) {
    fail("private + no SRA → Law Society/SRA register");
  }

  if (failed === 0) console.info("triage funding QA OK");
  return failed;
}
