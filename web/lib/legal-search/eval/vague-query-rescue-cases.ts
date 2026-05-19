import { ruleBasedParse } from "@/lib/legal-search/query-rules";
import { emptyScores } from "@/lib/legal-search/ranking";
import type { SearchResult } from "@/lib/legal-search/types";
import {
  buildVagueQueryRescuePlan,
  buildVagueRefinementPrompt,
  buildTaxonomyFallbackNotice,
  classifyTaxonomySignal,
  detectVagueLegalQuery,
  filterVagueRescueResults,
  getTaxonomyMatch,
  rescuePlanFromQueryText,
  resultHasTaxonomySignal,
  shouldTriggerTaxonomyZeroResultRescue,
} from "@/lib/legal-search/vague-query-rescue";
import { taxonomyFallbackQuery } from "@/lib/search-index/taxonomy-projection";

export const VAGUE_EVAL_QUERIES = [
  "i need a prison lawyer",
  "employment advice",
  "family lawyer",
  "housing help",
  "immigration problem",
  "legal aid",
  "need help",
] as const;

export const PRISON_RESCUE_EVAL_QUERIES = [
  "prison lawyer",
  "parole lawyer",
  "recall to prison",
  "prisoner rights",
  "HMP adjudication",
] as const;

function mockResult(over: Partial<SearchResult>): SearchResult {
  return {
    id: "x",
    source: "curated_listing",
    title: "Test",
    practiceAreas: [],
    categories: [],
    raw: {},
    scores: emptyScores({ final: 0.5 }),
    explanation: "",
    ...over,
  };
}

export function runVagueQueryRescueEval(): { failed: number; messages: string[] } {
  const messages: string[] = [];
  let failed = 0;
  const fail = (msg: string) => {
    messages.push(`FAIL ${msg}`);
    failed++;
  };

  const broadQueries = VAGUE_EVAL_QUERIES.filter((q) => q !== "need help");
  for (const query of broadQueries) {
    const parsed = ruleBasedParse(query);
    if (!getTaxonomyMatch(parsed)) {
      fail(`taxonomy match expected: "${query}"`);
      continue;
    }
    if (!detectVagueLegalQuery(parsed)) {
      fail(`should detect vague query: "${query}"`);
    }
    const plan = buildVagueQueryRescuePlan(parsed);
    if (!plan || plan.retrievalQueries.length < 3) {
      fail(`rescue plan too thin: "${query}"`);
    }
    const prompt = buildVagueRefinementPrompt(parsed, plan);
    if (!prompt.includes(plan?.canonicalName ?? "___")) {
      fail(`refinement prompt missing canonical name: "${query}"`);
    }
  }

  const needHelp = ruleBasedParse("need help");
  if (detectVagueLegalQuery(needHelp)) {
    fail('"need help" must not trigger vague rescue (should clarify)');
  }
  if (needHelp.queryConfidence !== "low") {
    fail('"need help" should have low query confidence');
  }

  const prisonPlan = rescuePlanFromQueryText(
    "i need a prison lawyer",
    ruleBasedParse("i need a prison lawyer"),
  );
  if (!prisonPlan) {
    fail("prison lawyer rescue plan");
  } else {
    const criminalOnly = mockResult({
      id: "crim",
      title: "General Criminal Defence LLP",
      practiceAreas: ["Criminal Defence"],
      description: "General crime and motoring",
    });
    if (resultHasTaxonomySignal(criminalOnly, prisonPlan)) {
      fail("criminal defence without prison signals must be rejected");
    }
    const criminalPrison = mockResult({
      id: "crim2",
      title: "Prison Law Unit",
      practiceAreas: ["Criminal Defence"],
      description: "Parole board and licence recall",
    });
    if (!resultHasTaxonomySignal(criminalPrison, prisonPlan)) {
      fail("criminal defence with prison signals should be allowed");
    }
    const prisonSignal = classifyTaxonomySignal(criminalPrison, prisonPlan);
    if (prisonSignal !== "related" && prisonSignal !== "alias" && prisonSignal !== "canonical") {
      fail(`prison-linked criminal result should classify as related signal, got ${prisonSignal}`);
    }
  }

  const employmentPlan = rescuePlanFromQueryText(
    "employment advice",
    ruleBasedParse("employment advice"),
  );
  if (!employmentPlan) {
    fail("employment advice rescue plan");
  } else {
    const employmentHit = mockResult({
      id: "emp",
      title: "Workplace Law",
      practiceAreas: ["Employment Law"],
      description: "Unfair dismissal and redundancy",
    });
    if (!resultHasTaxonomySignal(employmentHit, employmentPlan)) {
      fail("employment listing should match employment advice without subissue");
    }
  }

  for (const query of PRISON_RESCUE_EVAL_QUERIES) {
    const parsed = ruleBasedParse(query);
    const plan = buildVagueQueryRescuePlan(parsed);
    if (!getTaxonomyMatch(parsed)) {
      fail(`prison-related query should match taxonomy: "${query}"`);
    }
    if (
      parsed.taxonomySlug === "prison_law" &&
      !plan?.zeroResultFallbackQuery.includes("prison")
    ) {
      fail(`prison_law fallback query missing for "${query}"`);
    }
    if (shouldTriggerTaxonomyZeroResultRescue(parsed, 0) && !getTaxonomyMatch(parsed)) {
      fail(`zero-result rescue should require taxonomy: "${query}"`);
    }
  }

  const prisonNotice = buildTaxonomyFallbackNotice(
    prisonPlan ?? buildVagueQueryRescuePlan(ruleBasedParse("prison lawyer"))!,
  );
  if (!prisonNotice?.includes("Prison Law")) {
    fail("prison fallback notice should mention limited Prison Law listings");
  }

  const fb = taxonomyFallbackQuery("prison_law");
  if (!fb.split(" ").some((w) => w.length > 3)) {
    fail("prison_law taxonomy fallback query empty");
  }

  const projectedHit = mockResult({
    id: "proj",
    title: "PAS",
    practiceAreas: ["Criminal Defence", "Prison Law"],
    raw: { practiceAreaSlugs: ["prison_law"], taxonomyProjectionMatches: ["criminal_defence_prison_text"] },
  });
  if (prisonPlan && !resultHasTaxonomySignal(projectedHit, prisonPlan)) {
    fail("projected prison_law slug should count as taxonomy signal");
  }

  if (employmentPlan && prisonPlan) {
    const irrelevant = mockResult({
      id: "wills",
      title: "Wills and Probate Co",
      practiceAreas: ["Wills and probate"],
      description: "estate planning",
    });
    const filtered = filterVagueRescueResults([irrelevant], employmentPlan);
    if (filtered.length > 0) {
      fail("irrelevant probate result must be filtered for employment vague query");
    }
  }

  return { failed, messages };
}
