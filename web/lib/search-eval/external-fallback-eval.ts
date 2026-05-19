import { ruleBasedParse } from "@/lib/legal-search/query-rules";
import {
  buildFallbackSearchContext,
  selectFallbackSources,
  shouldTriggerExternalFallback,
} from "@/lib/legal-search/external-fallback/fallback-router";
import { runExternalFallback } from "@/lib/legal-search/external-fallback/web-search-client";
import { verifyExternalFallbackResult, externalCopyPassesSafety } from "@/lib/legal-search/external-fallback/verification";
import { normaliseTrustedSourceHit } from "@/lib/legal-search/external-fallback/result-normaliser";
import { TRUSTED_SOURCES } from "@/lib/legal-search/external-fallback/trusted-sources";
import { emptyScores } from "@/lib/legal-search/ranking";
import type { SearchResult } from "@/lib/legal-search/types";
import type { FundingRoute } from "@/lib/legal-search/triage/types";

function mockInternal(over: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "int:1",
    source: "legal_aid",
    title: "Internal Firm",
    practiceAreas: ["Housing"],
    categories: [],
    raw: { entityType: "legal_aid_provider" },
    scores: emptyScores({ final: 0.2 }),
    explanation: "Matches your search criteria.",
    ...over,
  };
}

function baseInput(over: Partial<Parameters<typeof shouldTriggerExternalFallback>[0]> = {}) {
  const merged = over.mergedQuery ?? "legal aid housing London";
  const parsed = ruleBasedParse(merged);
  return {
    internalResults: [],
    sections: [] as { kind: FundingRoute; results: SearchResult[] }[],
    fundingRoutes: ["legal_aid", "pro_bono", "private"] as FundingRoute[],
    fundingPreference: "legal_aid" as const,
    mergedQuery: merged,
    parsed,
    sraAvailable: true,
    ...over,
  };
}

export async function runExternalFallbackEval(): Promise<number> {
  process.env.EXTERNAL_FALLBACK_SKIP_HEAD = "1";
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL external-fallback: ${msg}`);
    failed++;
  };

  const zero = shouldTriggerExternalFallback(baseInput({ internalResults: [] }));
  if (!zero.trigger) fail("zero internal should trigger fallback");

  const laPayload = await runExternalFallback(
    baseInput({
      mergedQuery: "legal aid housing eviction London",
      fundingPreference: "legal_aid",
      fundingRoutes: ["legal_aid", "pro_bono", "private"],
    }),
  );
  if (!laPayload.triggered) fail("legal aid path should trigger");
  if (!laPayload.results.some((r) => r.source === "govuk_legal_aid")) {
    fail("legal aid should include GOV.UK");
  }

  const pbPayload = await runExternalFallback(
    baseInput({
      mergedQuery: "pro bono employment advice",
      fundingPreference: "pro_bono",
      fundingRoutes: ["pro_bono", "legal_aid", "private"],
    }),
  );
  if (!pbPayload.results.some((r) => r.source === "lawworks" || r.source === "advocate")) {
    fail("pro bono should include LawWorks or Advocate");
  }

  const privPayload = await runExternalFallback(
    baseInput({
      mergedQuery: "private solicitor divorce Manchester",
      fundingPreference: "private",
      fundingRoutes: ["private", "pro_bono", "legal_aid"],
      sraAvailable: false,
    }),
  );
  if (!privPayload.triggered) fail("SRA unavailable + private should trigger");
  if (
    !privPayload.results.some(
      (r) => r.source === "law_society" || r.source === "sra_register",
    )
  ) {
    fail("private should include Law Society or SRA register");
  }

  const internalIds = new Set([mockInternal().id]);
  if (laPayload.results.some((r) => internalIds.has(r.id))) {
    fail("external results must not reuse internal ids");
  }
  if (!laPayload.results.every((r) => r.id.startsWith("ext:"))) {
    fail("external ids should be prefixed ext:");
  }

  const bad = normaliseTrustedSourceHit(TRUSTED_SOURCES[0]!, buildFallbackSearchContext(baseInput()), 0);
  bad.description = "This firm offers legal aid and is SRA regulated. You should call them now.";
  const verified = verifyExternalFallbackResult(bad);
  if (verified.regulatedStatus === "sra_regulated") {
    fail("must not invent SRA regulation on gov.uk hit");
  }
  if (verified.fundingType === "legal_aid" && verified.source !== "govuk_legal_aid") {
    /* ok */
  }
  if (!externalCopyPassesSafety("You must sue them immediately.")) {
    /* ok */
  } else {
    fail("unsafe advice copy should fail");
  }

  const ctx = buildFallbackSearchContext(
    baseInput({ fundingPreference: "legal_aid", fundingRoutes: ["legal_aid"] }),
  );
  const sources = selectFallbackSources(ctx, ["zero_internal_results"]);
  if (!sources.length) fail("should select at least one source");

  if (failed === 0) console.info("external-fallback eval OK");
  return failed;
}
