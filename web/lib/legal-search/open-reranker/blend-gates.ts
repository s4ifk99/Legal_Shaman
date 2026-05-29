import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";
import {
  detectFundingIntent,
  fundingIntentBoostsLegalAid,
} from "@/lib/legal-search/funding-intent";
import type { RerankSearchOptions } from "@/lib/legal-search/rerank";
import {
  classifyTaxonomySignal,
} from "@/lib/legal-search/vague-query-rescue";
import {
  queryCapabilitySignals,
} from "@/lib/provider-intelligence/provider-capability-ranker";

/** Taxonomy / funding gates — reranker cannot override weak relevance or funding safety. */
export function rerankerInfluenceGate(
  r: SearchResult,
  parsed: ParsedQuery,
  opts?: RerankSearchOptions & { urgentIntent?: boolean },
): number {
  let gate = 1;

  const vagueMode = Boolean(opts?.vagueQueryMode && opts?.vagueRescuePlan);
  if (vagueMode && opts?.vagueRescuePlan) {
    const signal = classifyTaxonomySignal(r, opts.vagueRescuePlan);
    if (signal === "none") return 0;
    if (signal === "related") gate = Math.min(gate, 0.55);
    else if (signal === "category" || signal === "legal_aid") gate = Math.min(gate, 0.75);
  }

  const slug = parsed.practiceAreaSlug?.toLowerCase();
  if (slug && r.scores.practiceArea < 0.15) return 0;
  if (slug && r.scores.practiceArea < 0.35) gate = Math.min(gate, 0.45);
  else if (slug && r.scores.practiceArea < 0.55) gate = Math.min(gate, 0.7);

  const fundingIntent = parsed.fundingIntent ?? detectFundingIntent(parsed.semanticQuery);
  if (fundingIntentBoostsLegalAid(fundingIntent)) {
    if (r.source !== "legal_aid" && r.scores.practiceArea < 0.45) {
      gate = Math.min(gate, 0.35);
    }
  }

  if (opts?.urgentIntent) {
    const caps = queryCapabilitySignals(parsed.semanticQuery, parsed);
    const raw = r.raw as { urgencyCapabilities?: string[] } | null;
    const hasUrgency = (raw?.urgencyCapabilities ?? []).some((c) =>
      caps.urgency.includes(c),
    );
    if (!hasUrgency && r.scores.practiceArea < 0.5) {
      gate = Math.min(gate, 0.5);
    }
  }

  return gate;
}
