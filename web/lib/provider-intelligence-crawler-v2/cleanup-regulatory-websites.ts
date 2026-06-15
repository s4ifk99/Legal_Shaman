import { getOptionalPrismaClient } from "@/lib/db/prisma";
import { warnCrawlReviewDatasourceUnavailable } from "@/lib/provider-crawler/crawl-review-log";
import {
  isRegulatoryOrDirectoryUrl,
  REGULATORY_REJECT_REASON,
  regulatoryProvenanceNote,
} from "@/lib/provider-enrichment/regulatory-url-filter";

export type CleanupRegulatoryWebsitesOptions = {
  dryRun?: boolean;
  limit?: number;
};

export type CleanupRegulatoryWebsitesResult = {
  event: "providers_cleanup_regulatory_websites";
  ok: boolean;
  dryRun: boolean;
  scanned: number;
  rejected: number;
  providerWebsitesRejected: number;
  providerEnrichmentsRejected: number;
};

export async function runCleanupRegulatoryWebsites(
  opts: CleanupRegulatoryWebsitesOptions = {},
): Promise<CleanupRegulatoryWebsitesResult> {
  const dryRun = opts.dryRun ?? false;
  const limit = opts.limit ?? 10_000;

  const result: CleanupRegulatoryWebsitesResult = {
    event: "providers_cleanup_regulatory_websites",
    ok: true,
    dryRun,
    scanned: 0,
    rejected: 0,
    providerWebsitesRejected: 0,
    providerEnrichmentsRejected: 0,
  };

  try {
    const db = getOptionalPrismaClient();
    const [v2Rows, enrichmentRows] = await Promise.all([
      db.providerWebsite.findMany({
        where: { status: { in: ["pending_review", "audit_review"] } },
        take: limit,
        select: { id: true, url: true },
      }),
      db.providerEnrichment.findMany({
        where: {
          fieldName: "website",
          status: "pending_review",
        },
        take: limit,
        select: { id: true, extractedValue: true },
      }),
    ]);

    const v2Bad = v2Rows.filter((r) => isRegulatoryOrDirectoryUrl(r.url));
    const enrichmentBad = enrichmentRows.filter((r) =>
      isRegulatoryOrDirectoryUrl(r.extractedValue),
    );

    result.scanned = v2Bad.length + enrichmentBad.length;

    if (dryRun) {
      result.rejected = result.scanned;
      result.providerWebsitesRejected = v2Bad.length;
      result.providerEnrichmentsRejected = enrichmentBad.length;
      return result;
    }

    for (const row of v2Bad) {
      await db.providerWebsite.update({
        where: { id: row.id },
        data: {
          status: "rejected",
          updatedAt: new Date(),
        },
      });
      result.providerWebsitesRejected++;
      result.rejected++;
    }

    for (const row of enrichmentBad) {
      await db.providerEnrichment.update({
        where: { id: row.id },
        data: {
          status: "rejected",
          policyReason: REGULATORY_REJECT_REASON,
          provenanceNote: regulatoryProvenanceNote(row.extractedValue, REGULATORY_REJECT_REASON),
          updatedAt: new Date(),
        },
      });
      result.providerEnrichmentsRejected++;
      result.rejected++;
    }
  } catch (e) {
    warnCrawlReviewDatasourceUnavailable("providerEnrichment", e);
    return { ...result, ok: false };
  }

  return result;
}

export function cleanupRegulatoryWebsitesExitCode(result: CleanupRegulatoryWebsitesResult): number {
  return result.ok ? 0 : 1;
}
