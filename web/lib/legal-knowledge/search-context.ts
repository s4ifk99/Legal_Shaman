import "server-only";

import type { ParsedQuery } from "@/lib/legal-search/types";
import { parseQuery } from "@/lib/legal-search/query-understanding";
import { ruleBasedParse } from "@/lib/legal-search/query-rules";
import type { LegalIssueResolution } from "@/lib/legal/taxonomy";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";
import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";

import { classifyLegalIssue } from "./classify";
import type { ClassificationFusion } from "./classify-fusion";
import { fuseRuleAndLlmClassification } from "./classify-fusion";
import {
  classifyLegalIssueWithLlm,
  shouldTriggerLlmClassification,
  type LlmLegalClassification,
} from "./classify-llm";
import { satnavLlmEachStageEnabled } from "./route-llm-config";
import { searchRouteMode } from "./route-types";
import type { IssueClassification, LegalSearchRequest } from "./types";
import { processSearchQuery } from "@/lib/legal-search/query-limits";

export type LegalSearchContext = {
  query: string;
  location?: string;
  jurisdiction: string;
  includeDirectory: boolean;
  parsedQuery: ParsedQuery;
  resolution: LegalIssueResolution | null;
  classification: IssueClassification;
  llmClassification: LlmLegalClassification | null;
  fusion: ClassificationFusion;
};

function classificationFromFusion(
  query: string,
  fusion: ClassificationFusion,
  base: IssueClassification,
): IssueClassification {
  if (!fusion.taxonomySlug) return base;

  const entry = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === fusion.taxonomySlug);
  return {
    ...base,
    area: entry?.canonicalName ?? fusion.canonicalName ?? base.area,
    subArea: fusion.taxonomySlug,
    specificIssue: fusion.specificIssue ?? base.specificIssue,
    urgency: base.urgency,
  };
}

export async function buildLegalSearchContext(
  input: LegalSearchRequest,
): Promise<LegalSearchContext> {
  const query = processSearchQuery(input.query);
  const parsedQuery = await parseQuery(query);
  const resolution = resolveLegalIssueFromQuery(query);
  const baseClassification = classifyLegalIssue(query);

  let llmClassification: LlmLegalClassification | null = null;
  const satnavLlmPipeline =
    searchRouteMode() === "satnav" && satnavLlmEachStageEnabled();
  // Long posts / Vercel: skip LLM classify — unless satnav LLM-each-stage is on.
  const allowLlmClassify =
    satnavLlmPipeline ||
    (shouldTriggerLlmClassification(resolution) &&
      query.length <= 400 &&
      process.env.VERCEL !== "1");
  if (allowLlmClassify) {
    try {
      llmClassification = await Promise.race([
        classifyLegalIssueWithLlm(query, resolution),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
      ]);
    } catch {
      llmClassification = null;
    }
  }

  const fusion = fuseRuleAndLlmClassification({
    query,
    ruleResolution: resolution,
    llm: llmClassification,
  });

  const classification = classificationFromFusion(query, fusion, baseClassification);

  return {
    query,
    location: input.location,
    jurisdiction: input.jurisdiction?.trim() || "England and Wales",
    includeDirectory: input.includeDirectory !== false,
    parsedQuery,
    resolution,
    classification,
    llmClassification,
    fusion,
  };
}

/** Deterministic context for offline eval (no LLM classification). */
export function buildEvalSearchContext(query: string): LegalSearchContext {
  const trimmed = processSearchQuery(query);
  const parsedQuery = ruleBasedParse(trimmed);
  const resolution = resolveLegalIssueFromQuery(trimmed);
  const baseClassification = classifyLegalIssue(trimmed);
  const fusion = fuseRuleAndLlmClassification({
    query: trimmed,
    ruleResolution: resolution,
    llm: null,
  });
  const classification = classificationFromFusion(trimmed, fusion, baseClassification);

  return {
    query: trimmed,
    jurisdiction: "England and Wales",
    includeDirectory: true,
    parsedQuery,
    resolution,
    classification,
    llmClassification: null,
    fusion,
  };
}
