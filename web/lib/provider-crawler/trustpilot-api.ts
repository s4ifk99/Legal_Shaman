import type { ExtractedFieldCandidate } from "@/lib/provider-crawler/types";
import { crawlConfidenceForSource } from "@/lib/provider-crawler/provenance";

export type TrustpilotApiConfig = {
  apiKey: string;
  businessUnitId?: string;
};

/** Trustpilot HTML scraping is disabled; use official API only when configured. */
export const TRUSTPILOT_SCRAPE_ENABLED = false;

export function isTrustpilotApiConfigured(): boolean {
  return Boolean(process.env.TRUSTPILOT_API_KEY?.trim());
}

export function getTrustpilotConfig(): TrustpilotApiConfig | null {
  const apiKey = process.env.TRUSTPILOT_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    businessUnitId: process.env.TRUSTPILOT_BUSINESS_UNIT_ID?.trim(),
  };
}

/**
 * Fetch aggregate rating via Trustpilot Business API (no page scraping).
 * Does not store full review bodies — aggregate signals only.
 */
export async function fetchTrustpilotAggregate(
  businessUnitId: string,
  ctx: { entityId: string; entityType: string; profileUrl?: string },
): Promise<ExtractedFieldCandidate[]> {
  const config = getTrustpilotConfig();
  if (!config) return [];

  const id = businessUnitId || config.businessUnitId;
  if (!id) return [];

  if (process.env.PROVIDER_CRAWL_SKIP_FETCH === "1") return [];

  try {
    const res = await fetch(
      `https://api.trustpilot.com/v1/business-units/${encodeURIComponent(id)}`,
      {
        headers: {
          apikey: config.apiKey,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return [];

    const data = (await res.json()) as {
      score?: { trustScore?: number };
      numberOfReviews?: { total?: number };
      links?: { profileUrl?: string };
    };

    const out: ExtractedFieldCandidate[] = [];
    const extractedAt = new Date();
    const profileUrl = ctx.profileUrl ?? data.links?.profileUrl;

    if (profileUrl) {
      out.push({
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        fieldName: "trustpilot_profile_url",
        extractedValue: profileUrl,
        confidence: crawlConfidenceForSource("trustpilot_api", 0.95),
        sourceUrl: profileUrl,
        sourceType: "trustpilot_api",
        extractionMethod: "trustpilot_api",
        reviewCategory: "review_signal",
        extractedAt,
      });
    }

    const score = data.score?.trustScore;
    if (typeof score === "number" && score >= 0 && score <= 5) {
      out.push({
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        fieldName: "review_aggregate_rating",
        extractedValue: String(score),
        confidence: crawlConfidenceForSource("trustpilot_api", 0.95),
        sourceUrl: profileUrl,
        sourceType: "trustpilot_api",
        extractionMethod: "trustpilot_api",
        reviewCategory: "review_signal",
        provenanceNote: "trustpilot_api_aggregate",
        extractedAt,
      });
    }

    const total = data.numberOfReviews?.total;
    if (typeof total === "number" && total >= 0) {
      out.push({
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        fieldName: "review_count",
        extractedValue: String(total),
        confidence: crawlConfidenceForSource("trustpilot_api", 0.95),
        sourceUrl: profileUrl,
        sourceType: "trustpilot_api",
        extractionMethod: "trustpilot_api",
        reviewCategory: "review_signal",
        extractedAt,
      });
    }

    return out;
  } catch {
    return [];
  }
}

/** Store profile URL + existing aggregate from structured data only (no scrape). */
export function trustpilotFieldsFromStructured(
  ctx: {
    entityId: string;
    entityType: string;
    profileUrl?: string;
    rating?: number;
    reviewCount?: number;
  },
): ExtractedFieldCandidate[] {
  const out: ExtractedFieldCandidate[] = [];
  const extractedAt = new Date();

  if (ctx.profileUrl && /trustpilot\.com/i.test(ctx.profileUrl)) {
    out.push({
      entityId: ctx.entityId,
      entityType: ctx.entityType,
      fieldName: "trustpilot_profile_url",
      extractedValue: ctx.profileUrl,
      confidence: crawlConfidenceForSource("manual_approved", 0.9),
      sourceUrl: ctx.profileUrl,
      sourceType: "manual_approved",
      extractionMethod: "structured_field",
      reviewCategory: "review_signal",
      extractedAt,
    });
  }

  if (typeof ctx.rating === "number") {
    out.push({
      entityId: ctx.entityId,
      entityType: ctx.entityType,
      fieldName: "review_aggregate_rating",
      extractedValue: String(ctx.rating),
      confidence: crawlConfidenceForSource("structured_db", 0.9),
      sourceType: "structured_db",
      extractionMethod: "structured_field",
      reviewCategory: "review_signal",
      extractedAt,
    });
  }

  if (typeof ctx.reviewCount === "number") {
    out.push({
      entityId: ctx.entityId,
      entityType: ctx.entityType,
      fieldName: "review_count",
      extractedValue: String(ctx.reviewCount),
      confidence: crawlConfidenceForSource("structured_db", 0.9),
      sourceType: "structured_db",
      extractionMethod: "structured_field",
      reviewCategory: "review_signal",
      extractedAt,
    });
  }

  return out;
}
