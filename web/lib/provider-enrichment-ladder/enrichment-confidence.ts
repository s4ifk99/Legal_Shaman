import type { EnrichmentSourceType } from "@/lib/provider-enrichment/types";
import { confidenceForSource } from "@/lib/provider-enrichment/provenance";

export type ConfidenceContext = {
  sourceType: EnrichmentSourceType;
  extractionConfidence: number;
  /** e.g. services_page_title, nav_item, url_slug */
  signal?: string;
};

const SIGNAL_BOOST: Record<string, number> = {
  structured_field: 0.08,
  services_page_title: 0.06,
  nav_item: 0.05,
  repeated_phrase: 0.04,
  url_slug: 0.07,
  schema_org: 0.09,
  sra_register: 0.05,
  law_society_profile: 0.04,
};

export function ladderConfidence(ctx: ConfidenceContext): number {
  const base = confidenceForSource(ctx.sourceType, ctx.extractionConfidence);
  const boost = ctx.signal ? (SIGNAL_BOOST[ctx.signal] ?? 0) : 0;
  return Math.min(1, Math.round((base + boost) * 100) / 100);
}

/** Website discovery must meet this to skip manual review (unless directory host). */
export const WEBSITE_AUTO_APPROVE_THRESHOLD = 0.9;
export const WEBSITE_REVIEW_THRESHOLD = 0.65;

export function websiteNeedsReview(confidence: number, isDirectoryHost: boolean): boolean {
  if (isDirectoryHost) return true;
  return confidence < WEBSITE_AUTO_APPROVE_THRESHOLD;
}
