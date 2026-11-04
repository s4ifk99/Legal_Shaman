import { prisma } from "@/lib/db/prisma";

/** Source-scoped signal types so Google, Trustpilot, and firm-site harvests can coexist. */
export const REVIEW_SIGNAL_TYPES = {
  googleRating: "google_places:review_aggregate_rating",
  googleCount: "google_places:review_count",
  googlePlaceId: "google_places:place_id",
  trustpilotRating: "trustpilot:review_aggregate_rating",
  trustpilotCount: "trustpilot:review_count",
  /** AggregateRating harvested from the firm's own website (JSON-LD / microdata). */
  siteRating: "site:review_aggregate_rating",
  siteCount: "site:review_count",
  sitePublisher: "site:review_publisher",
  /** Legacy rows from the Trustpilot-only crawler. */
  legacyRating: "review_aggregate_rating",
  legacyCount: "review_count",
} as const;

export type ReviewSignalWrite = {
  crawlRunId?: string | null;
  entityId: string;
  entityType: string;
  signalType: string;
  value: string;
  confidence: number;
  sourceType: string;
  sourceUrl?: string | null;
  extractionMethod: string;
  status: "auto_approved" | "pending_review" | "approved" | "rejected";
};

/**
 * One current value per entityId+signalType. Deletes stale values so refreshes replace scores.
 */
export async function upsertReviewSignal(row: ReviewSignalWrite): Promise<void> {
  await prisma.providerReviewSignal.deleteMany({
    where: {
      entityId: row.entityId,
      signalType: row.signalType,
      NOT: { value: row.value },
    },
  });
  await prisma.providerReviewSignal.upsert({
    where: {
      entityId_signalType_value: {
        entityId: row.entityId,
        signalType: row.signalType,
        value: row.value,
      },
    },
    create: {
      crawlRunId: row.crawlRunId ?? null,
      entityId: row.entityId,
      entityType: row.entityType,
      signalType: row.signalType,
      value: row.value,
      confidence: row.confidence,
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl ?? null,
      extractionMethod: row.extractionMethod,
      status: row.status,
    },
    update: {
      crawlRunId: row.crawlRunId ?? null,
      confidence: row.confidence,
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl ?? null,
      extractionMethod: row.extractionMethod,
      status: row.status,
      updatedAt: new Date(),
    },
  });
}

export async function writeGooglePlaceIdSignal(input: {
  crawlRunId?: string | null;
  entityId: string;
  entityType: string;
  placeId: string;
  sourceUrl?: string | null;
  status?: "auto_approved" | "pending_review";
  confidence?: number;
}): Promise<number> {
  const mapsUri =
    input.sourceUrl?.trim() ||
    `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(input.placeId)}`;
  await upsertReviewSignal({
    crawlRunId: input.crawlRunId,
    entityId: input.entityId,
    entityType: input.entityType,
    signalType: REVIEW_SIGNAL_TYPES.googlePlaceId,
    value: input.placeId,
    confidence: input.confidence ?? 0.9,
    sourceType: "google_places",
    sourceUrl: mapsUri,
    extractionMethod: "google_places",
    status: input.status ?? "auto_approved",
  });
  return 1;
}

export async function writeGoogleReviewSignals(input: {
  crawlRunId?: string | null;
  entityId: string;
  entityType: string;
  placeId: string;
  rating: number;
  reviewCount: number;
  sourceUrl: string;
  status: "auto_approved" | "pending_review";
  confidence: number;
}): Promise<number> {
  const base = {
    crawlRunId: input.crawlRunId,
    entityId: input.entityId,
    entityType: input.entityType,
    confidence: input.confidence,
    sourceType: "google_places",
    sourceUrl: input.sourceUrl,
    extractionMethod: "google_places",
    status: input.status,
  };
  await upsertReviewSignal({
    ...base,
    signalType: REVIEW_SIGNAL_TYPES.googlePlaceId,
    value: input.placeId,
  });
  await upsertReviewSignal({
    ...base,
    signalType: REVIEW_SIGNAL_TYPES.googleRating,
    value: String(input.rating),
  });
  await upsertReviewSignal({
    ...base,
    signalType: REVIEW_SIGNAL_TYPES.googleCount,
    value: String(input.reviewCount),
  });
  return 3;
}

export async function writeTrustpilotReviewSignals(input: {
  crawlRunId?: string | null;
  entityId: string;
  entityType: string;
  rating: number;
  reviewCount: number;
  sourceUrl: string;
  status: "auto_approved" | "pending_review";
  confidence: number;
}): Promise<number> {
  const base = {
    crawlRunId: input.crawlRunId,
    entityId: input.entityId,
    entityType: input.entityType,
    confidence: input.confidence,
    sourceType: "trustpilot_api",
    sourceUrl: input.sourceUrl,
    extractionMethod: "trustpilot_api",
    status: input.status,
  };
  await upsertReviewSignal({
    ...base,
    signalType: REVIEW_SIGNAL_TYPES.trustpilotRating,
    value: String(input.rating),
  });
  await upsertReviewSignal({
    ...base,
    signalType: REVIEW_SIGNAL_TYPES.trustpilotCount,
    value: String(input.reviewCount),
  });
  return 2;
}

export async function writeSiteReviewSignals(input: {
  crawlRunId?: string | null;
  entityId: string;
  entityType: string;
  rating: number;
  reviewCount: number;
  sourceUrl: string;
  publisherLabel: string;
  status: "auto_approved" | "pending_review";
  confidence: number;
}): Promise<number> {
  const base = {
    crawlRunId: input.crawlRunId,
    entityId: input.entityId,
    entityType: input.entityType,
    confidence: input.confidence,
    sourceType: "provider_website",
    sourceUrl: input.sourceUrl,
    extractionMethod: "html_parse",
    status: input.status,
  };
  await upsertReviewSignal({
    ...base,
    signalType: REVIEW_SIGNAL_TYPES.siteRating,
    value: String(input.rating),
  });
  await upsertReviewSignal({
    ...base,
    signalType: REVIEW_SIGNAL_TYPES.siteCount,
    value: String(input.reviewCount),
  });
  await upsertReviewSignal({
    ...base,
    signalType: REVIEW_SIGNAL_TYPES.sitePublisher,
    value: input.publisherLabel,
  });
  return 3;
}
