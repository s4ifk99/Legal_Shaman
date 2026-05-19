import {
  DEFAULT_FUNDING_ROUTE_ORDER,
  decideOrchestration,
  locationBlocksSearch,
  pickLowConfidenceQuestion,
  resolveFundingRouteOrder,
  userExplicitlyWantsPrivate,
} from "@/lib/legal-search/orchestration/search-agent-policy";
import { sourceProvenanceLabel } from "@/lib/legal-search/orchestration/source-provenance";
import {
  shouldStartFreshSession,
  shouldSuggestReusePreviousFilters,
} from "@/lib/legal-search/orchestration/session-context";
import { createInitialTriageState } from "@/lib/legal-search/triage/triage-state";
import { assessTriageCompleteness } from "@/lib/legal-search/triage/completeness";
import { resolveFundingRoutes } from "@/lib/legal-search/triage/funding-router";
import { ruleBasedParse } from "@/lib/legal-search/query-rules";
import { emptyScores } from "@/lib/legal-search/ranking";
import type { SearchResult } from "@/lib/legal-search/types";

export function runOrchestrationPolicyEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL orchestration-policy: ${msg}`);
    failed++;
  };

  if (resolveFundingRouteOrder("unsure")[0] !== "pro_bono") {
    fail("unsure funding should prioritize pro_bono first");
  }
  if (JSON.stringify(DEFAULT_FUNDING_ROUTE_ORDER) !== JSON.stringify(["pro_bono", "legal_aid", "private"])) {
    fail("DEFAULT_FUNDING_ROUTE_ORDER mismatch");
  }
  if (resolveFundingRouteOrder("private")[0] !== "private") {
    fail("private preference should prioritize private");
  }
  if (!userExplicitlyWantsPrivate("I need a private solicitor in Manchester")) {
    fail("private intent detection");
  }
  if (locationBlocksSearch()) {
    fail("location must not block search");
  }
  if (!shouldStartFreshSession("new issue")) {
    fail("sessions should start fresh by default");
  }
  if (!shouldSuggestReusePreviousFilters({ taxonomySlug: "family", fundingPreference: "legal_aid" })) {
    fail("should suggest reuse when prior filters exist");
  }

  const vague = "help me with something legal";
  const parsed = ruleBasedParse(vague);
  const state = createInitialTriageState(vague, "orch-eval");
  const decision = decideOrchestration(state, parsed);
  if (!decision.showResultsNow || decision.shouldAskBeforeSearch) {
    fail("low-confidence vague query should search without blocking");
  }
  const completeness = assessTriageCompleteness(state, parsed);
  if (!completeness.canSearchNow) {
    fail("low-confidence completeness should allow search");
  }
  const q = pickLowConfidenceQuestion(state, parsed);
  if (q?.field !== "emergencyDanger") {
    fail("low-confidence should ask emergency danger first");
  }

  const routes = resolveFundingRoutes(createInitialTriageState("I need a lawyer", "r2"));
  if (routes[0] !== "pro_bono") {
    fail(`generic lawyer default route: got ${routes[0]}`);
  }

  const laResult: SearchResult = {
    id: "1",
    source: "legal_aid",
    title: "Test LA",
    practiceAreas: [],
    categories: [],
    raw: { entityType: "legal_aid_provider" },
    scores: emptyScores(),
    explanation: "x",
  };
  if (sourceProvenanceLabel(laResult) !== "GOV.UK legal aid data") {
    fail(`legal aid provenance: ${sourceProvenanceLabel(laResult)}`);
  }

  const sraResult: SearchResult = {
    ...laResult,
    id: "2",
    source: "sra",
    raw: { entityType: "sra_organisation" },
  };
  if (sourceProvenanceLabel(sraResult) !== "SRA-regulated organisation") {
    fail("SRA provenance label");
  }

  if (failed === 0) console.info("orchestration policy eval OK");
  return failed;
}
