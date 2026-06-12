import { confidenceForSource } from "@/lib/provider-enrichment/provenance";
import { ladderConfidence } from "@/lib/provider-enrichment-ladder/enrichment-confidence";
import type { EnrichmentSourceType } from "@/lib/provider-enrichment/types";

/** v2 auto-approve threshold for phone, website, email. */
export const V2_AUTO_APPROVE_THRESHOLD = 0.95;

export const V2_AUTO_APPROVE_CONTACT_FIELDS = new Set(["phone", "email", "website"]);

export type ConfidenceSignals = {
  sourceType: EnrichmentSourceType;
  rawConfidence?: number;
  officialPage?: boolean;
  structuredField?: boolean;
  multiSourceAgree?: boolean;
};

/**
 * Unified confidence score (0–1) combining source priors and extraction signals.
 */
export function computeV2Confidence(signals: ConfidenceSignals): number {
  const base = signals.rawConfidence ?? 0.75;
  const fromSource = confidenceForSource(signals.sourceType, base);
  const ladder = ladderConfidence({
    sourceType: signals.sourceType,
    extractionConfidence: fromSource,
    signal: signals.structuredField
      ? "structured_field"
      : signals.officialPage
        ? "services_page_title"
        : undefined,
  });
  let score = ladder;
  if (signals.multiSourceAgree) score = Math.min(1, score + 0.04);
  return Math.round(score * 1000) / 1000;
}

export function qualifiesV2AutoApprove(fieldName: string, confidence: number): boolean {
  return V2_AUTO_APPROVE_CONTACT_FIELDS.has(fieldName) && confidence >= V2_AUTO_APPROVE_THRESHOLD;
}
