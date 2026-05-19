import type { TrustedSourceDefinition } from "@/lib/legal-search/external-fallback/trusted-sources";
import type {
  ExternalFallbackResult,
  FallbackSearchContext,
} from "@/lib/legal-search/external-fallback/types";

export function normaliseTrustedSourceHit(
  source: TrustedSourceDefinition,
  ctx: FallbackSearchContext,
  index: number,
): ExternalFallbackResult {
  const url = source.buildSearchUrl(ctx);
  const loc = ctx.location ?? ctx.parsed.location ?? undefined;
  const practiceAreas = ctx.taxonomySlug
    ? [ctx.taxonomySlug.replace(/_/g, " ")]
    : undefined;

  return {
    id: `ext:${source.id}:${index}`,
    source: source.id,
    title: source.name,
    description: `${source.description} Source: ${source.attribution}.`,
    url,
    practiceAreas,
    location: loc ?? undefined,
    fundingType: source.fundingType,
    regulatedStatus: source.regulatedStatus,
    confidence: 0.8 - index * 0.05,
    verificationNotes: [
      "signpost_only",
      `attribution:${source.attribution}`,
      "verify_eligibility_on_source_site",
    ],
  };
}
