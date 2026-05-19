export type {
  SearchEvalCase,
  SearchEvalChannel,
  SearchEvalCaseResult,
  SearchEvalAggregateMetrics,
  SearchEvalReport,
  EvalRetrievedHit,
} from "@/lib/search-eval/types";
export { SEARCH_EVAL_CASES } from "@/lib/search-eval/cases";
export {
  gradeRelevance,
  explanationPassesSafety,
  taxonomyMatchesExpected,
  precisionAtK,
  recallAtK,
  mrr,
  ndcgLiteAtK,
} from "@/lib/search-eval/metrics";
export { runSearchEval, aggregateMetrics } from "@/lib/search-eval/runner";
export type { RunSearchEvalOptions } from "@/lib/search-eval/runner";
export {
  formatConsoleSummary,
  formatMarkdownReport,
  writeSearchEvalReports,
} from "@/lib/search-eval/reporters";
