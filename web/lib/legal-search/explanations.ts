import "server-only";

import { sanitizeAdviceText } from "@/lib/guardrails/validator";
import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";
import { DIRECTORY_KEYWORD_MATCH_STRONG } from "@/lib/legal-search/ranking";
import {
  classifyTaxonomySignal,
  VAGUE_RELATED_EXPLANATION,
  type VagueQueryRescuePlan,
} from "@/lib/legal-search/vague-query-rescue";

/** Banned patterns in user-visible explanations (directory). */
const BANNED = /\b(best|guarantee|will win|should\s|must\s|legal advice)\b/i;

export function guardDirectoryExplanation(s: string): string {
  const cleaned = sanitizeAdviceText(s);
  if (BANNED.test(cleaned)) return "Matches your search criteria based on stored listing information.";
  return cleaned;
}

export function buildListingExplanation(
  r: SearchResult,
  parsed: ParsedQuery,
  sources: string[],
  vaguePlan?: VagueQueryRescuePlan,
): string {
  const parts: string[] = [];
  if (vaguePlan) {
    const signal = classifyTaxonomySignal(r, vaguePlan);
    if (signal === "related") {
      return guardDirectoryExplanation(`${VAGUE_RELATED_EXPLANATION}.`);
    }
    if (signal === "canonical" || signal === "alias") {
      parts.push(`area: ${vaguePlan.canonicalName}`);
    }
  } else if (parsed.taxonomyPrimaryLabel && r.practiceAreas.length) {
    parts.push(`area: ${parsed.taxonomyPrimaryLabel}`);
  } else if (parsed.practiceAreaSlug && r.practiceAreas.length) {
    parts.push(`relates to ${r.practiceAreas[0]}`);
  }
  if (r.location?.city) parts.push(`based in ${r.location.city}`);
  if (sources.includes("semantic") && sources.includes("lexical")) parts.push("keyword and topic match");
  else if (sources.includes("semantic")) parts.push("similar topic");
  else if ((r.scores?.keyword ?? 0) >= DIRECTORY_KEYWORD_MATCH_STRONG) parts.push("keyword match");
  else parts.push("broad directory match");
  const core = parts.length ? `Matches your search: ${parts.join(", ")}.` : "Matches your search criteria.";
  return guardDirectoryExplanation(core);
}

export function buildSraExplanation(r: SearchResult): string {
  const city = r.location?.city?.trim();
  if (city) return guardDirectoryExplanation(`SRA-listed organisation in ${city} matching your search.`);
  return guardDirectoryExplanation("SRA-listed organisation matching your search.");
}

export function attachExplanations(
  results: SearchResult[],
  parsed: ParsedQuery,
  vaguePlan?: VagueQueryRescuePlan,
): SearchResult[] {
  return results.map((r) => {
    let explanation = r.explanation;
    if (!explanation) {
      if (r.source === "sra") explanation = buildSraExplanation(r);
      else {
        const src = (r.raw as { sources?: string[] })?.sources ?? [];
        explanation = buildListingExplanation(r, parsed, src, vaguePlan);
      }
    }
    return { ...r, explanation: guardDirectoryExplanation(explanation) };
  });
}
