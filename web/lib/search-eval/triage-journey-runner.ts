import type { TriageResponse, TriageState } from "@/lib/legal-search/triage/types";
import type { TriageQuestion } from "@/lib/legal-search/triage/types";
import {
  fundingPreferenceFromChip,
  resolveFundingRoutes,
} from "@/lib/legal-search/triage/funding-router";
import { explanationPassesSafety } from "@/lib/search-eval/metrics";
import { TRIAGE_DISCLAIMER } from "@/lib/legal-search/triage/types";
import {
  TRIAGE_JOURNEY_CASES,
  type TriageJourneyCase,
  type TriageJourneyFinalExpectations,
  type TriageJourneyTurn,
} from "@/lib/search-eval/triage-journey-cases";

export type TriageJourneyTurnResult = {
  turnIndex: number;
  userInput: string;
  responseKind: TriageResponse["kind"];
  answerField?: string;
  nextQuestionField?: string;
  internalResultCount: number;
  hasExternalFallback: boolean;
  markerCount: number;
  stateSnapshot: {
    initialQuery: string;
    mergedQuery: string;
    stepsCompleted: string[];
    sessionId: string;
  };
};

export type TriageJourneyRunResult = {
  caseId: string;
  passed: boolean;
  failures: string[];
  turns: TriageJourneyTurnResult[];
  metrics: {
    statePersistenceOk: boolean;
    noStateRestart: boolean;
    explanationSafetyOk: boolean;
  };
};

export type TriageJourneyEvalReport = {
  caseCount: number;
  passedCount: number;
  failedCount: number;
  results: TriageJourneyRunResult[];
};

function getPendingQuestion(res: TriageResponse): TriageQuestion | null {
  if (res.kind === "triage_question") return res.question;
  if (res.kind === "triage_results" && res.nextQuestion) return res.nextQuestion;
  return null;
}

function normalizeAnswerValue(
  field: TriageQuestion["field"],
  userInput: string,
): string {
  const t = userInput.trim();
  if (field === "fundingPreference") {
    const fromChip = fundingPreferenceFromChip(t);
    if (fromChip) return fromChip;
    const lower = t.toLowerCase();
    if (/legal aid/.test(lower)) return "legal_aid";
    if (/can't afford|cannot afford|no money|afford a solicitor/.test(lower)) return "legal_aid";
    if (/pro bono|free\s*\/?\s*pro bono|free help/.test(lower)) return "pro_bono";
    if (/private/.test(lower)) return "private";
    if (/fixed fee/.test(lower)) return "fixed_fee";
    if (/not sure|unsure/.test(lower)) return "unsure";
  }
  if (field === "emergencyDanger") {
    const lower = t.toLowerCase();
    if (/^yes|immediate danger|emergency/.test(lower)) return "yes";
    if (/^no|not an emergency|not urgent/.test(lower)) return "no";
    if (/not sure|unsure/.test(lower)) return "unsure";
  }
  return t;
}

function countInternalResults(res: TriageResponse): number {
  if (res.kind !== "triage_results") return 0;
  return res.sections.reduce((n, s) => n + s.results.length, 0);
}

function allExplanations(res: TriageResponse): string[] {
  if (res.kind !== "triage_results") {
    if (res.kind === "triage_question" && res.question.prompt) return [res.question.prompt];
    return [];
  }
  const texts: string[] = [];
  for (const s of res.sections) {
    for (const r of s.results) {
      if (r.explanation) texts.push(r.explanation);
    }
  }
  if (res.externalFallback) {
    for (const e of res.externalFallback.results) {
      if (e.description) texts.push(e.description);
    }
  }
  if (res.urgentSignposting?.body) texts.push(res.urgentSignposting.body);
  if (res.urgentSignposting?.headline) texts.push(res.urgentSignposting.headline);
  for (const c of res.urgentSignposting?.emergencyContacts ?? []) {
    texts.push(`${c.label} ${c.detail}`);
  }
  return texts;
}

function taxonomyOk(
  slug: string | null | undefined,
  expected?: string,
  acceptable?: string[],
): boolean {
  if (!expected && !acceptable?.length) return true;
  if (!slug) return false;
  if (expected && slug === expected) return true;
  return Boolean(acceptable?.includes(slug));
}

/** Disclaimers and emergency signposting; block advice-like directives only. */
function journeyCopyPassesSafety(text: string): boolean {
  const t = text.trim();
  if (!t || t === TRIAGE_DISCLAIMER) return true;
  if (
    /immediate danger|call 999|emergency services|signpost/i.test(t) ||
    /cannot give legal advice|does not provide legal advice|not legal advice|cannot tell you what to do/i.test(
      t,
    )
  ) {
    return !/\b(you should|you must|we recommend|guarantee|will win)\b/i.test(t);
  }
  return explanationPassesSafety(t);
}

function mergedQuerySatisfiesIssueHeuristic(mergedQuery: string, topics?: string[]): boolean {
  if (!topics?.length) return false;
  const q = mergedQuery.toLowerCase();
  const patterns: Record<string, RegExp> = {
    employment: /\b(job|work|employ|dismiss|redundan|lost my job)\b/,
    housing: /\b(landlord|evict|housing|rent|homeless)\b/,
    prison: /\b(prison|parole|custody|inmate)\b/,
    immigration: /\b(visa|immigr|asylum|refus)\b/,
    family: /\b(divorce|separat|matrimonial)\b/,
  };
  return topics.some((topic) => patterns[topic]?.test(q));
}

function validateTurn(
  turn: TriageJourneyTurn,
  turnIndex: number,
  res: TriageResponse,
  pendingField: string | undefined,
  fail: (msg: string) => void,
): void {
  const nextQ = getPendingQuestion(res);
  const nextField = nextQ?.field;

  if (turn.expectedAnswerField && turnIndex > 0 && pendingField !== turn.expectedAnswerField) {
    fail(
      `turn ${turnIndex + 1}: answered field ${pendingField ?? "—"}, expected ${turn.expectedAnswerField}`,
    );
  }

  if (turn.expectedNextQuestionField) {
    if (res.kind === "triage_question" && nextField !== turn.expectedNextQuestionField) {
      fail(
        `turn ${turnIndex + 1}: next question field ${nextField ?? "—"}, expected ${turn.expectedNextQuestionField}`,
      );
    }
    if (
      res.kind === "triage_results" &&
      res.nextQuestion &&
      res.nextQuestion.field !== turn.expectedNextQuestionField
    ) {
      fail(
        `turn ${turnIndex + 1}: refinement field ${res.nextQuestion.field}, expected ${turn.expectedNextQuestionField}`,
      );
    }
  }

  if (turn.mustReturnResults && res.kind !== "triage_results") {
    fail(`turn ${turnIndex + 1}: expected results, got ${res.kind}`);
  }
  if (turn.mustNotReturnResults && res.kind === "triage_results") {
    fail(`turn ${turnIndex + 1}: expected no results yet, got triage_results`);
  }

  const slug =
    res.kind === "triage_results"
      ? res.parsedQuery.taxonomySlug
      : (res.parsedQuery?.taxonomySlug ?? null);
  if (turn.expectedTaxonomySlug && !taxonomyOk(slug ?? res.triageState.taxonomySlug, turn.expectedTaxonomySlug)) {
    fail(
      `turn ${turnIndex + 1}: taxonomy ${slug ?? res.triageState.taxonomySlug ?? "—"}, expected ${turn.expectedTaxonomySlug}`,
    );
  }

  if (turn.expectedUrgency && res.triageState.urgency !== turn.expectedUrgency) {
    fail(
      `turn ${turnIndex + 1}: urgency ${res.triageState.urgency}, expected ${turn.expectedUrgency}`,
    );
  }

  if (turn.expectedFundingRoute) {
    const routes = resolveFundingRoutes(res.triageState);
    if (routes[0] !== turn.expectedFundingRoute) {
      fail(
        `turn ${turnIndex + 1}: primary route ${routes[0] ?? "—"}, expected ${turn.expectedFundingRoute}`,
      );
    }
  }

  for (const text of allExplanations(res)) {
    if (!journeyCopyPassesSafety(text)) {
      fail(`turn ${turnIndex + 1}: explanation safety failed: ${text.slice(0, 80)}`);
    }
  }
}

function validateFinal(
  fin: TriageJourneyFinalExpectations,
  res: TriageResponse,
  initialQuery: string,
  firstSessionId: string,
  fail: (msg: string) => void,
): void {
  const state = res.triageState;
  if (state.initialQuery !== initialQuery) {
    fail(`final: initialQuery restarted (got "${state.initialQuery}")`);
  }
  if (state.sessionId !== firstSessionId) {
    fail("final: sessionId changed across journey");
  }

  const slug =
    res.kind === "triage_results"
      ? res.parsedQuery.taxonomySlug ?? state.taxonomySlug
      : state.taxonomySlug;

  const taxonomyRequired = Boolean(fin.taxonomySlug || fin.acceptableTaxonomySlugs?.length);
  const taxonomyFromSlug = taxonomyOk(slug, fin.taxonomySlug, fin.acceptableTaxonomySlugs);
  const taxonomyFromHeuristic =
    fin.acceptIssueHeuristic &&
    mergedQuerySatisfiesIssueHeuristic(state.mergedQuery, fin.issueHeuristicTopics);
  if (taxonomyRequired && !taxonomyFromSlug && !taxonomyFromHeuristic) {
    fail(
      `final: taxonomy ${slug ?? "—"}, expected ${fin.taxonomySlug ?? fin.acceptableTaxonomySlugs?.join("|")}`,
    );
  }

  if (fin.fundingRoute) {
    const routes = resolveFundingRoutes(state);
    if (routes[0] !== fin.fundingRoute) {
      fail(`final: primary funding route ${routes[0] ?? "—"}, expected ${fin.fundingRoute}`);
    }
  }

  if (fin.location) {
    const parsedLoc = res.kind === "triage_results" ? res.parsedQuery.location : null;
    const loc = (state.answers.location ?? parsedLoc ?? "").toString();
    const merged = state.mergedQuery.toLowerCase();
    const locNeedle = fin.location.toLowerCase();
    const inMerged =
      merged.includes(locNeedle) ||
      merged.includes(`in ${locNeedle}`);
    if (!loc.toLowerCase().includes(locNeedle) && !inMerged) {
      fail(`final: location missing ${fin.location}`);
    }
  }

  if (fin.mustAskBeforeSearch && res.kind !== "triage_question") {
    fail("final: expected clarify-before-search (triage_question)");
  }

  if (res.kind === "triage_results") {
    const internal = countInternalResults(res);
    if (fin.shouldHaveInternalResults === true && internal === 0) {
      fail("final: expected internal results");
    }
    if (fin.shouldHaveExternalFallback && !res.externalFallback?.triggered) {
      fail("final: expected external fallback section");
    }
    if (fin.shouldHaveExternalFallback === false && res.externalFallback?.triggered) {
      fail("final: unexpected external fallback");
    }
    if (fin.shouldHaveMapMarkers && res.markers.length === 0) {
      fail("final: expected map markers");
    }
    if (fin.shouldShowUrgentSignposting && !res.urgentSignposting) {
      fail("final: expected urgent signposting");
    }

    if (fin.explanationSafetyMustPass) {
      for (const text of allExplanations(res)) {
        if (!journeyCopyPassesSafety(text)) {
          fail(`final: unsafe copy: ${text.slice(0, 80)}`);
        }
      }
    }
  } else if (fin.shouldHaveInternalResults) {
    fail("final: expected triage_results");
  }
}

export async function runTriageJourney(
  journeyCase: TriageJourneyCase,
  runTriageSearch: (req: import("@/lib/legal-search/triage/run-triage-search").TriageRequest) => Promise<TriageResponse>,
): Promise<TriageJourneyRunResult> {
  const failures: string[] = [];
  const fail = (msg: string) => failures.push(`[${journeyCase.id}] ${msg}`);

  const sessionId = `journey-${journeyCase.id}-${Date.now()}`;
  let state: TriageState | null = null;
  let lastResponse: TriageResponse | null = null;
  let initialQuery = "";
  const turnResults: TriageJourneyTurnResult[] = [];
  let previousSteps: string[] = [];

  for (let i = 0; i < journeyCase.turns.length; i++) {
    const turn = journeyCase.turns[i]!;
    let pendingField: string | undefined;

    if (i === 0) {
      initialQuery = turn.userInput.trim();
      lastResponse = await runTriageSearch({
        action: "start",
        query: turn.userInput,
        sessionId,
      });
      state = lastResponse.triageState;
      previousSteps = [...state.stepsCompleted];
    } else {
      const pending = lastResponse ? getPendingQuestion(lastResponse) : null;
      if (!pending || !state) {
        fail(`turn ${i + 1}: no pending question to answer with "${turn.userInput}"`);
        break;
      }
      pendingField = pending.field;
      const value = normalizeAnswerValue(pending.field, turn.userInput);
      lastResponse = await runTriageSearch({
        action: "answer",
        sessionId,
        state,
        field: pending.field,
        value,
      });
      state = lastResponse.triageState;

      if (state.stepsCompleted.length < previousSteps.length) {
        fail(`turn ${i + 1}: stepsCompleted regressed (state restart)`);
      }
      if (!state.mergedQuery.includes(initialQuery)) {
        fail(`turn ${i + 1}: mergedQuery lost initial query`);
      }
      previousSteps = [...state.stepsCompleted];
    }

    if (!lastResponse || !state) break;

    validateTurn(turn, i, lastResponse, pendingField, fail);

    const nextQ = getPendingQuestion(lastResponse);
    turnResults.push({
      turnIndex: i,
      userInput: turn.userInput,
      responseKind: lastResponse.kind,
      answerField: pendingField,
      nextQuestionField: nextQ?.field,
      internalResultCount: countInternalResults(lastResponse),
      hasExternalFallback:
        lastResponse.kind === "triage_results" &&
        Boolean(lastResponse.externalFallback?.triggered),
      markerCount: lastResponse.kind === "triage_results" ? lastResponse.markers.length : 0,
      stateSnapshot: {
        initialQuery: state.initialQuery,
        mergedQuery: state.mergedQuery,
        stepsCompleted: [...state.stepsCompleted],
        sessionId: state.sessionId,
      },
    });
  }

  if (lastResponse) {
    validateFinal(journeyCase.finalExpectations, lastResponse, initialQuery, sessionId, fail);
  }

  const explanationSafetyOk = !failures.some((f) => f.includes("explanation safety") || f.includes("unsafe copy"));
  const noStateRestart = !failures.some(
    (f) => f.includes("restarted") || f.includes("regressed") || f.includes("lost initial"),
  );
  const statePersistenceOk =
    noStateRestart &&
    !failures.some((f) => f.includes("initialQuery") || f.includes("mergedQuery lost"));

  return {
    caseId: journeyCase.id,
    passed: failures.length === 0,
    failures,
    turns: turnResults,
    metrics: {
      statePersistenceOk: statePersistenceOk && noStateRestart,
      noStateRestart,
      explanationSafetyOk,
    },
  };
}

export async function runTriageJourneyEval(
  runTriageSearch: (req: import("@/lib/legal-search/triage/run-triage-search").TriageRequest) => Promise<TriageResponse>,
  cases = TRIAGE_JOURNEY_CASES,
): Promise<TriageJourneyEvalReport> {
  const results: TriageJourneyRunResult[] = [];
  for (const c of cases) {
    results.push(await runTriageJourney(c, runTriageSearch));
  }
  const passedCount = results.filter((r) => r.passed).length;
  return {
    caseCount: results.length,
    passedCount,
    failedCount: results.length - passedCount,
    results,
  };
}

export function formatJourneyConsoleSummary(report: TriageJourneyEvalReport): string {
  const lines: string[] = [
    "",
    "=== Triage journey eval ===",
    `Cases: ${report.caseCount}  Passed: ${report.passedCount}  Failed: ${report.failedCount}`,
    "",
  ];
  for (const r of report.results.filter((x) => !x.passed)) {
    lines.push(`[${r.caseId}]`);
    for (const f of r.failures) lines.push(`  - ${f}`);
    lines.push("");
  }
  return lines.join("\n");
}
