/**
 * Deterministic checks for the unified legal search layer (no network).
 * Run: cd web && npm run search:eval
 */
import "./load-dotenv";

import { ruleBasedParse } from "../lib/legal-search/query-rules";
import { EVAL_QUERIES } from "../lib/legal-search/eval/test-cases";
import type { ParsedQuery, SearchResult } from "../lib/legal-search/types";
import { emptyScores, rankSearchResults, sortByFinalScore } from "../lib/legal-search/ranking";
import {
  EMPLOYMENT_LONDON_MATCHES,
  mockLawyerMatchNoCoords,
  mockLawyerMatchWithCoords,
  mockOrgMatchInvalidCoords,
} from "../lib/legal-search/eval/matcher-map-cases";
import {
  buildMatcherMapMarkers,
  countMissingMatcherCoordinates,
} from "../lib/search/map-results";
import { isValidUkCoordinate } from "../lib/search/location";
import { stripSearchDebugPayload } from "../lib/legal-search/search-diagnostics-types";
import {
  boostedWeakVsExact,
  capBehaviouralBoostWorks,
  irrelevantGetsNoBoost,
  maxBoostFractionRespected,
  relevanceGateWorks,
  SearchEventInputSchema,
} from "../lib/search-events/eval/behavioural-boost-cases";
import { validateSearchEventBusinessRules } from "../lib/search-events/types";
import {
  mockClarifyPayloadWithDebug,
  mockMatcherPayloadWithDebug,
  mockResultDebug,
} from "../lib/legal-search/eval/search-diagnostics-cases";
import { runVagueQueryRescueEval } from "../lib/legal-search/eval/vague-query-rescue-cases";
import { runTaxonomyProjectionEval } from "../lib/search-index/eval/taxonomy-projection-cases";
import { runTriageEval, runTriageFundingQaEval } from "../lib/search-eval/triage-eval";
import { runExternalFallbackEval } from "../lib/search-eval/external-fallback-eval";
import { runFundingIntentEval } from "../lib/search-eval/funding-intent-eval";
import { runOrchestrationPolicyEval } from "../lib/search-eval/orchestration-policy-eval";
import { runProviderIntelligenceEval } from "../lib/search-eval/provider-intelligence-eval";
import { runProviderCrawlerEval } from "../lib/search-eval/provider-crawler-eval";
import { runProviderEnrichmentLadderEval } from "../lib/search-eval/provider-enrichment-ladder-eval";
import { runProviderOsintEval } from "../lib/search-eval/provider-osint-eval";
import { runProviderAutoApprovalEval } from "../lib/search-eval/provider-auto-approval-eval";
import { runSourceBalanceEval } from "../lib/search-eval/source-balance-eval";
import { runSraPracticeAreaProjectionEval } from "../lib/sra/practice-area-projection-eval";
import { runOpenRerankerEval } from "../lib/legal-search/eval/open-reranker-cases";
import {
  ADMIN_SESSION_COOKIE,
  computeAdminSessionToken,
  requireAdminApiRequest,
} from "../lib/admin/auth";
import { runOpsEval } from "../lib/search-eval/ops-eval";

/** Same banned-shape check as `explanations.ts` (keep eval importable without server-only chain). */
const DIR_EXPLANATION_BANNED = /\b(best|guarantee|will win|should\s|must\s|legal advice)\b/i;

function buildListingExplanationLike(
  r: SearchResult,
  parsed: ParsedQuery,
  sources: string[],
): string {
  const parts: string[] = [];
  if (parsed.practiceAreaSlug && r.practiceAreas.length) {
    parts.push(`relates to ${r.practiceAreas[0]}`);
  }
  if (r.location?.city) parts.push(`based in ${r.location.city}`);
  if (sources.includes("semantic") && sources.includes("lexical")) parts.push("keyword and topic match");
  else if (sources.includes("semantic")) parts.push("similar topic");
  else parts.push("keyword match");
  return parts.length ? `Matches your search: ${parts.join(", ")}.` : "Matches your search criteria.";
}

async function runAdminAuthEval(): Promise<number> {
  let failed = 0;
  const env = process.env as Record<string, string | undefined>;
  const prev = { node: env.NODE_ENV, secret: env.ADMIN_SECRET };

  try {
    env.NODE_ENV = "development";
    delete env.ADMIN_SECRET;
    const allowDev = await requireAdminApiRequest(new Request("http://localhost/api/admin/search-quality"));
    if (allowDev !== null) {
      console.error(
        "FAIL admin API should allow unauthenticated access when NODE_ENV=development and ADMIN_SECRET unset",
      );
      failed++;
    }

    env.NODE_ENV = "production";
    env.ADMIN_SECRET = "eval-admin-secret";

    const denyProd = await requireAdminApiRequest(new Request("http://localhost/api/admin/search-quality"));
    if (!denyProd || denyProd.status !== 401) {
      console.error("FAIL admin API should return 401 without auth when ADMIN_SECRET is set in production");
      failed++;
    }

    const badHeader = await requireAdminApiRequest(
      new Request("http://x", { headers: { "x-admin-secret": "wrong" } }),
    );
    if (!badHeader || badHeader.status !== 401) {
      console.error("FAIL admin API should reject wrong x-admin-secret");
      failed++;
    }

    const okHeader = await requireAdminApiRequest(
      new Request("http://x", { headers: { "x-admin-secret": "eval-admin-secret" } }),
    );
    if (okHeader !== null) {
      console.error("FAIL admin API should accept matching x-admin-secret");
      failed++;
    }

    const tok = await computeAdminSessionToken("eval-admin-secret");
    const okCookie = await requireAdminApiRequest(
      new Request("http://x", { headers: { cookie: `${ADMIN_SESSION_COOKIE}=${tok}` } }),
    );
    if (okCookie !== null) {
      console.error("FAIL admin API should accept valid admin_session cookie");
      failed++;
    }

    delete env.ADMIN_SECRET;
    const mis = await requireAdminApiRequest(new Request("http://x"));
    if (!mis || mis.status !== 503) {
      console.error("FAIL admin API should return 503 when production and ADMIN_SECRET missing");
      failed++;
    }
  } finally {
    env.NODE_ENV = prev.node;
    if (prev.secret === undefined) delete env.ADMIN_SECRET;
    else env.ADMIN_SECRET = prev.secret;
  }

  return failed;
}


function mockResult(over: Partial<SearchResult>): SearchResult {
  return {
    id: "1",
    source: "curated_listing",
    title: "Test Firm",
    practiceAreas: ["Employment"],
    categories: ["Test"],
    raw: { sources: ["lexical"] },
    scores: emptyScores({ final: 0.5 }),
    explanation: "",
    ...over,
  };
}

async function main() {
  let failed = 0;
  for (const row of EVAL_QUERIES) {
    const p = ruleBasedParse(row.query);
    if (row.expectPracticeHint && p.practiceAreaSlug !== row.expectPracticeHint) {
      console.error(
        `FAIL practice hint: "${row.query}" → got ${p.practiceAreaSlug ?? "null"}, want ${row.expectPracticeHint}`,
      );
      failed++;
    }
  }

  const parsed: ParsedQuery = ruleBasedParse("divorce in London");
  const ex = buildListingExplanationLike(
    mockResult({ title: "Family Law Co", location: { city: "London" } }),
    parsed,
    ["lexical"],
  );
  if (DIR_EXPLANATION_BANNED.test(ex)) {
    console.error("FAIL explanation guard:", ex);
    failed++;
  }

  const ranked = sortByFinalScore(
    rankSearchResults(
      [
        mockResult({ id: "a", title: "General practice", description: "general" }),
        mockResult({
          id: "b",
          title: "Divorce and family",
          description: "divorce solicitors family law London",
        }),
      ],
      parsed,
    ),
  );
  if (ranked[0]?.id !== "b") {
    console.error("FAIL ranking order");
    failed++;
  }

  const withCoords = [mockLawyerMatchWithCoords()];
  const markersOk = buildMatcherMapMarkers(withCoords);
  if (markersOk.length !== 1 || markersOk[0]?.entityId !== "lawyer-1") {
    console.error("FAIL matcher markers from valid coords");
    failed++;
  }

  const noCoords = [mockLawyerMatchNoCoords(), mockLawyerMatchWithCoords()];
  const markersPartial = buildMatcherMapMarkers(noCoords);
  if (markersPartial.length !== 1 || countMissingMatcherCoordinates(noCoords) !== 1) {
    console.error("FAIL matcher missing coordinate count");
    failed++;
  }

  const invalid = [mockOrgMatchInvalidCoords()];
  if (buildMatcherMapMarkers(invalid).length !== 0) {
    console.error("FAIL invalid coords must not produce markers");
    failed++;
  }

  if (!isValidUkCoordinate(51.5, -0.12) || isValidUkCoordinate(0, 0)) {
    console.error("FAIL UK coordinate validation");
    failed++;
  }

  const clarifyPayload = { kind: "clarify" as const, question: "Which area?", disclaimer: "x" };
  if ("markers" in clarifyPayload) {
    console.error("FAIL clarify response must not include markers");
    failed++;
  }

  const employmentMarkers = buildMatcherMapMarkers(EMPLOYMENT_LONDON_MATCHES);
  if (employmentMarkers.length < 1) {
    console.error('FAIL "employment advice in London" fixture should produce map markers');
    failed++;
  }

  const debugFixture = mockMatcherPayloadWithDebug();
  const stripped = stripSearchDebugPayload(debugFixture);
  if (stripped.searchDebug || stripped.results?.some((r) => "debug" in r && r.debug)) {
    console.error("FAIL stripSearchDebugPayload should remove searchDebug and per-result debug");
    failed++;
  }
  if (!debugFixture.searchDebug || !debugFixture.results[0]?.debug) {
    console.error("FAIL debug fixture should include searchDebug and result debug");
    failed++;
  }

  const breakdown = mockResultDebug().scoreBreakdown;
  if (!("total" in breakdown) || Object.keys(breakdown).length < 2) {
    console.error("FAIL result debug score breakdown should include multiple keys");
    failed++;
  }

  const clarifyDebug = mockClarifyPayloadWithDebug();
  if (!clarifyDebug.searchDebug?.clarificationDecision) {
    console.error("FAIL clarify debug should include clarificationDecision");
    failed++;
  }
  if ("markers" in clarifyDebug) {
    console.error("FAIL clarify payload must not include markers");
    failed++;
  }
  const clarifyStripped = stripSearchDebugPayload(clarifyDebug);
  if (clarifyStripped.searchDebug) {
    console.error("FAIL clarify strip should remove searchDebug");
    failed++;
  }

  const sourceCounts = debugFixture.searchDebug?.resultCountsBySource ?? {};
  if (Object.keys(sourceCounts).length < 1) {
    console.error("FAIL searchDebug should include resultCountsBySource");
    failed++;
  }

  if (!maxBoostFractionRespected()) {
    console.error("FAIL behavioural boost must respect MAX_BEHAVIOURAL_FRACTION cap");
    failed++;
  }
  if (!capBehaviouralBoostWorks()) {
    console.error("FAIL capBehaviouralBoostDelta");
    failed++;
  }
  if (!irrelevantGetsNoBoost()) {
    console.error("FAIL irrelevant results must not receive behavioural boost");
    failed++;
  }
  if (!relevanceGateWorks()) {
    console.error("FAIL relevance gate for behavioural boost");
    failed++;
  }
  const popularityVsExact = boostedWeakVsExact();
  if (popularityVsExact.weakBoosted >= popularityVsExact.exactFinal) {
    console.error("FAIL popularity must not outrank exact topical match");
    failed++;
  }

  const badEvent = SearchEventInputSchema.safeParse({
    sessionId: "short",
    eventType: "result_click",
    page: "directory",
  });
  if (badEvent.success) {
    console.error("FAIL malformed search event should be rejected");
    failed++;
  }
  const missingResultParsed = SearchEventInputSchema.safeParse({
    sessionId: "valid-session-id-12345",
    eventType: "result_click",
    page: "directory",
  });
  if (
    missingResultParsed.success &&
    !validateSearchEventBusinessRules(missingResultParsed.data)
  ) {
    console.error("FAIL result_click without resultId must be rejected by business rules");
    failed++;
  }

  const vagueEval = runVagueQueryRescueEval();
  for (const msg of vagueEval.messages) console.error(msg);
  failed += vagueEval.failed;

  const projectionEval = runTaxonomyProjectionEval();
  for (const msg of projectionEval.messages) console.error(msg);
  failed += projectionEval.failed;

  failed += runFundingIntentEval();

  failed += runOrchestrationPolicyEval();

  failed += runProviderIntelligenceEval();

  failed += runProviderCrawlerEval();

  const ladderEval = runProviderEnrichmentLadderEval();
  failed += ladderEval.failed;

  const osintEval = runProviderOsintEval();
  failed += osintEval.failed;

  const autoApprovalEval = runProviderAutoApprovalEval();
  failed += autoApprovalEval.failed;

  failed += runSourceBalanceEval();

  failed += runSraPracticeAreaProjectionEval();

  const openRerankEval = runOpenRerankerEval();
  for (const msg of openRerankEval.messages) console.error(msg);
  failed += openRerankEval.failed;

  failed += runTriageEval();

  failed += await runTriageFundingQaEval();

  failed += await runExternalFallbackEval();

  failed += await runAdminAuthEval();

  failed += await runOpsEval();

  const { runOptionalPrismaEvalWithStub } = await import("./search-eval-optional-prisma-runner");
  failed += await runOptionalPrismaEvalWithStub();

  console.log(failed === 0 ? "search:eval OK" : `search:eval FAILED (${failed} checks)`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
