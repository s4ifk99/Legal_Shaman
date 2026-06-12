import type { PrismaClient } from "@prisma/client";

import { getOptionalPrismaClient } from "@/lib/db/prisma";
import type { PendingExtractedField } from "@/lib/provider-crawler/review-queue";
import type { ReviewCategory } from "@/lib/provider-crawler/types";
import {
  formatCrawlReviewDatasourceError,
  warnCrawlReviewDatasourceUnavailable,
} from "@/lib/provider-crawler/crawl-review-log";

export type CrawlReviewDatasourceStatus =
  | { ok: true; rowsLoaded: number }
  | { ok: false; error: string };

export type CrawlReviewPendingLoadResult =
  | { ok: true; pending: PendingExtractedField[] }
  | { ok: false; error: string };

const FIELD_ORDER: Record<string, number> = {
  phone: 10,
  email: 20,
  website: 30,
  contact_page: 35,
  address: 40,
  opening_hours: 45,
  practice_areas: 50,
  capabilities: 55,
  tribunalCapabilities: 56,
  languages: 57,
  fundingCapabilities: 60,
  urgencyCapabilities: 65,
  accessibilityCapabilities: 70,
  testimonial_snippet: 80,
  review_aggregate_rating: 90,
  review_count: 91,
  trustpilot_profile_url: 92,
};

export async function fetchPendingExtractedFieldsFromDb(
  db: PrismaClient,
  limit: number,
  reviewCategory?: ReviewCategory,
): Promise<PendingExtractedField[]> {
  const rows = await db.providerExtractedField.findMany({
    where: {
      status: { in: ["pending_review", "audit_review"] },
      ...(reviewCategory ? { reviewCategory } : {}),
    },
    orderBy: [{ extractedAt: "desc" }, { createdAt: "desc" }],
    take: Math.min(limit * 3, 2000),
  });

  const mapped = rows.map((r) => ({
    id: r.id,
    entityId: r.entityId,
    entityType: r.entityType,
    fieldName: r.fieldName,
    extractedValue: r.extractedValue,
    confidence: r.confidence,
    sourceUrl: r.sourceUrl ?? undefined,
    sourceType: r.sourceType,
    extractionMethod: r.extractionMethod,
    reviewCategory: r.reviewCategory,
    status: r.status,
    extractedAt: r.extractedAt.toISOString(),
    provenanceNote: r.provenanceNote ?? undefined,
  }));

  mapped.sort(
    (a, b) =>
      (FIELD_ORDER[a.fieldName] ?? 99) - (FIELD_ORDER[b.fieldName] ?? 99) ||
      b.confidence - a.confidence ||
      new Date(b.extractedAt).getTime() - new Date(a.extractedAt).getTime(),
  );

  return mapped.slice(0, limit);
}

export async function loadPendingExtractedFieldsSafe(
  limit: number,
  reviewCategory?: ReviewCategory,
): Promise<CrawlReviewPendingLoadResult> {
  try {
    const pending = await fetchPendingExtractedFieldsFromDb(
      getOptionalPrismaClient(),
      limit,
      reviewCategory,
    );
    return { ok: true, pending };
  } catch (e) {
    warnCrawlReviewDatasourceUnavailable("providerExtractedField", e);
    return { ok: false, error: formatCrawlReviewDatasourceError(e) };
  }
}
