import { getOptionalPrismaClient } from "@/lib/db/prisma";
import { warnCrawlReviewDatasourceUnavailable } from "@/lib/provider-crawler/crawl-review-log";
import {
  gatePracticeAreaLabelOrSlug,
  PRACTICE_AREA_TAXONOMY_REJECT_REASON,
} from "@/lib/provider-intelligence-crawler-v2/practice-area-taxonomy-gate";

export type CleanupBadPracticeAreasOptions = {
  dryRun?: boolean;
  limit?: number;
};

export type CleanupBadPracticeAreasResult = {
  event: "providers_cleanup_bad_practice_areas";
  ok: boolean;
  dryRun: boolean;
  scanned: number;
  rejected: number;
  providerPracticeAreasRejected: number;
  providerEnrichmentsRejected: number;
  samples: { id: string; label: string; slug: string | null; entityId: string; reason: string }[];
};

const ACTIVE_STATUSES = ["pending_review", "audit_review", "auto_approved", "approved"] as const;

export async function runCleanupBadPracticeAreas(
  opts: CleanupBadPracticeAreasOptions = {},
): Promise<CleanupBadPracticeAreasResult> {
  const dryRun = opts.dryRun ?? false;
  const limit = opts.limit ?? 50_000;
  const db = getOptionalPrismaClient();

  const result: CleanupBadPracticeAreasResult = {
    event: "providers_cleanup_bad_practice_areas",
    ok: true,
    dryRun,
    scanned: 0,
    rejected: 0,
    providerPracticeAreasRejected: 0,
    providerEnrichmentsRejected: 0,
    samples: [],
  };

  try {
    const rows = await db.providerPracticeArea.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] } },
      select: { id: true, entityId: true, label: true, slug: true, status: true },
      take: limit,
      orderBy: { updatedAt: "desc" },
    });

    for (const row of rows) {
      result.scanned++;
      const gate = gatePracticeAreaLabelOrSlug(row.label, row.slug);
      if (gate.allowed) continue;

      const reason = `${PRACTICE_AREA_TAXONOMY_REJECT_REASON}:${gate.reason}`;
      if (result.samples.length < 25) {
        result.samples.push({
          id: row.id,
          label: row.label,
          slug: row.slug,
          entityId: row.entityId,
          reason,
        });
      }

      if (!dryRun) {
        await db.providerPracticeArea.update({
          where: { id: row.id },
          data: {
            status: "rejected",
            updatedAt: new Date(),
          },
        });
      }
      result.providerPracticeAreasRejected++;
      result.rejected++;
    }

    const enrichments = await db.providerEnrichment.findMany({
      where: {
        status: { in: [...ACTIVE_STATUSES] },
        fieldName: { in: ["practiceAreaSlugs", "practice_areas"] },
      },
      select: {
        id: true,
        entityId: true,
        fieldName: true,
        extractedValue: true,
      },
      take: limit,
      orderBy: { updatedAt: "desc" },
    });

    for (const row of enrichments) {
      result.scanned++;
      const gate = gatePracticeAreaLabelOrSlug(row.extractedValue, row.extractedValue);
      if (gate.allowed) continue;

      const reason = `${PRACTICE_AREA_TAXONOMY_REJECT_REASON}:${gate.reason}`;
      if (!dryRun) {
        await db.providerEnrichment.update({
          where: { id: row.id },
          data: {
            status: "rejected",
            policyDecision: "reject",
            policyReason: reason,
            updatedAt: new Date(),
          },
        });
      }
      result.providerEnrichmentsRejected++;
      result.rejected++;
    }
  } catch (e) {
    warnCrawlReviewDatasourceUnavailable("cleanupBadPracticeAreas", e);
    result.ok = false;
  }

  return result;
}
