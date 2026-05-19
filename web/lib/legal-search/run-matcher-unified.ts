import "server-only";

import { runAgent } from "@/lib/agent/workflow";
import { parseQuery, overlayExtractionOnParsed } from "@/lib/legal-search/query-understanding";
import { enrichParsedQueryWithTaxonomy } from "@/lib/legal/taxonomy";
import { applyVagueParsedQueryUx, detectVagueLegalQuery } from "@/lib/legal-search/vague-query-rescue";
import type { AgentInput, AgentResult } from "@/lib/agent/types";
import type { ParsedQuery } from "@/lib/legal-search/types";

export type MatcherUnifiedResponse = AgentResult & {
  parsedQuery: ParsedQuery;
};

/**
 * Runs the existing lawyer matcher agent, then attaches a unified ParsedQuery
 * derived from extraction (matches) or from standalone parsing (clarify).
 */
export async function runMatcherUnified(input: AgentInput): Promise<MatcherUnifiedResponse> {
  let taxonomyParsed = await parseQuery(input.query);
  if (detectVagueLegalQuery(taxonomyParsed)) {
    taxonomyParsed = applyVagueParsedQueryUx(taxonomyParsed);
  }
  const result = await runAgent(input, { preParsed: taxonomyParsed });
  let parsedQuery =
    result.kind === "matches"
      ? enrichParsedQueryWithTaxonomy(overlayExtractionOnParsed(result.extracted, input.query, taxonomyParsed))
      : taxonomyParsed;
  if (detectVagueLegalQuery(parsedQuery)) {
    parsedQuery = applyVagueParsedQueryUx(parsedQuery);
  }
  return { ...result, parsedQuery };
}
