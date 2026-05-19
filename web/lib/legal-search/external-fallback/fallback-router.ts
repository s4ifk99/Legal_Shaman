import type { FundingRoute } from "@/lib/legal-search/triage/types";
import { detectFundingPreference } from "@/lib/legal-search/triage/funding-router";
import {
  sourcesForRoutes,
  TRUSTED_SOURCES,
} from "@/lib/legal-search/external-fallback/trusted-sources";
import type {
  ExternalFallbackReason,
  FallbackSearchContext,
  FallbackTriggerInput,
} from "@/lib/legal-search/external-fallback/types";
import type { TrustedSourceDefinition } from "@/lib/legal-search/external-fallback/trusted-sources";
import {
  assessPrivateCoverage,
  queryWantsPrivateFamilyHelp,
} from "@/lib/legal-search/private-coverage";
import type { IndexBalanceReport } from "@/lib/search-index/index-balance-diagnostics";

const DEFAULT_SCORE_THRESHOLD = 0.38;
const MIN_RESULTS_FOR_COVERAGE = 2;

export function shouldTriggerExternalFallback(
  input: FallbackTriggerInput & { catalog?: IndexBalanceReport | null },
): {
  trigger: boolean;
  reasons: ExternalFallbackReason[];
} {
  const reasons: ExternalFallbackReason[] = [];
  const threshold = input.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const total = input.internalResults.length;

  if (total === 0) {
    reasons.push("zero_internal_results");
  }

  if (total > 0) {
    const topScore = Math.max(
      ...input.internalResults.map((r) => r.scores?.final ?? 0),
      0,
    );
    if (topScore < threshold) {
      reasons.push("low_internal_scores");
    }
    if (total < MIN_RESULTS_FOR_COVERAGE) {
      reasons.push("weak_coverage");
    }
  }

  const primaryRoute = input.fundingRoutes[0];
  if (primaryRoute) {
    const section = input.sections.find((s) => s.kind === primaryRoute);
    if (!section || section.results.length === 0) {
      reasons.push("empty_funding_route");
    }
  }

  const wantsPrivate =
    input.fundingPreference === "private" ||
    input.fundingPreference === "fixed_fee" ||
    /\b(solicitor|law firm|regulated|sra)\b/i.test(input.mergedQuery);

  if (!input.sraAvailable && wantsPrivate) {
    reasons.push("sra_unavailable_private_request");
  }

  if (queryWantsPrivateFamilyHelp(input.mergedQuery, input.parsed)) {
    const coverage = assessPrivateCoverage({
      query: input.mergedQuery,
      parsed: input.parsed,
      results: input.internalResults,
      catalog: input.catalog,
    });
    if (coverage.triggerPrivateExternalFallback) {
      reasons.push("missing_private_family_coverage");
    }
  }

  const trigger =
    reasons.length > 0 &&
    (reasons.includes("zero_internal_results") ||
      reasons.includes("empty_funding_route") ||
      reasons.includes("sra_unavailable_private_request") ||
      reasons.includes("missing_private_family_coverage") ||
      reasons.includes("low_internal_scores"));

  return { trigger, reasons };
}

export function selectFallbackSources(
  ctx: FallbackSearchContext,
  reasons: ExternalFallbackReason[],
): TrustedSourceDefinition[] {
  const maxSources = 5;
  const pref = ctx.fundingPreference ?? detectFundingPreference(ctx.mergedQuery);
  let routes: FundingRoute[] = [...ctx.fundingRoutes];

  if (
    reasons.includes("missing_private_family_coverage") ||
    reasons.includes("sra_unavailable_private_request")
  ) {
    const regulated = TRUSTED_SOURCES.filter(
      (s) => s.id === "law_society" || s.id === "sra_register",
    );
    return regulated.slice(0, maxSources);
  }

  if (reasons.includes("sra_unavailable_private_request")) {
    routes = ["private", "pro_bono", "legal_aid"];
  } else if (pref === "legal_aid") {
    routes = ["legal_aid", "pro_bono"];
  } else if (pref === "pro_bono") {
    routes = ["pro_bono", "legal_aid"];
  } else if (pref === "private" || pref === "fixed_fee") {
    routes = ["private", "pro_bono"];
  }

  const preferRegulated =
    reasons.includes("sra_unavailable_private_request") ||
    pref === "private" ||
    /\bregulated\b/i.test(ctx.mergedQuery);

  const sources = sourcesForRoutes(routes, {
    sraAvailable: ctx.sraAvailable,
    preferRegulated,
  });

  return sources.slice(0, maxSources);
}

export function buildFallbackSearchContext(
  input: FallbackTriggerInput,
): FallbackSearchContext {
  return {
    query: input.mergedQuery,
    mergedQuery: input.mergedQuery,
    parsed: input.parsed,
    fundingPreference: input.fundingPreference,
    fundingRoutes: input.fundingRoutes,
    location: input.parsed.location,
    postcode: input.parsed.postcode,
    taxonomySlug: input.parsed.taxonomySlug ?? null,
    sraAvailable: input.sraAvailable,
  };
}
