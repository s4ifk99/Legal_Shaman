import { getOptionalPrismaClient } from "@/lib/db/prisma";
import { warnCrawlReviewDatasourceUnavailable } from "@/lib/provider-crawler/crawl-review-log";
import { enrichFirmNameSeedFromPostgres } from "@/lib/provider-osint/firm-name-seed";
import {
  isObviouslySyntheticGeneratedUrl,
  isSyntheticWebsiteUrl,
  SYNTHETIC_REJECT_REASON,
} from "@/lib/provider-osint/synthetic-domain";
import type { LegalEntityDocument } from "@/lib/search-index/types";

export type CleanupSyntheticWebsitesOptions = {
  dryRun?: boolean;
  limit?: number;
};

export type CleanupSyntheticWebsitesResult = {
  event: "providers_cleanup_synthetic_websites";
  ok: boolean;
  dryRun: boolean;
  scanned: number;
  rejected: number;
  providerWebsitesRejected: number;
  providerEnrichmentsRejected: number;
  relatedCapabilityRowsRejected: number;
  samples: { id: string; url: string; entityId: string; fieldName?: string }[];
};

const ACTIVE_STATUSES = ["pending_review", "audit_review", "auto_approved"] as const;

async function isSyntheticForEntity(
  url: string,
  entityId: string,
  entityType: string,
): Promise<boolean> {
  const obvious = isObviouslySyntheticGeneratedUrl(url);
  if (obvious.synthetic) return true;

  const doc: LegalEntityDocument = {
    id: entityId,
    entityType: entityType as LegalEntityDocument["entityType"],
    title: "",
    description: "",
    practiceAreas: [],
    categories: [],
    subIssues: [],
    searchText: "",
    expandedSearchText: "",
    source: "sra",
    legalAid: false,
    authorityScore: 0,
    profileCompletenessScore: 0,
    rawSourceId: entityId,
    updatedAt: Date.now(),
  };

  const seed = await enrichFirmNameSeedFromPostgres(doc);
  if (!seed) return obvious.synthetic;

  return isSyntheticWebsiteUrl(url, seed.primaryName, {
    sraId: seed.sraId,
    postcode: seed.postcode,
    city: seed.city,
  });
}

export async function runCleanupSyntheticWebsites(
  opts: CleanupSyntheticWebsitesOptions = {},
): Promise<CleanupSyntheticWebsitesResult> {
  const dryRun = opts.dryRun ?? false;
  const limit = opts.limit ?? 10_000;

  const result: CleanupSyntheticWebsitesResult = {
    event: "providers_cleanup_synthetic_websites",
    ok: true,
    dryRun,
    scanned: 0,
    rejected: 0,
    providerWebsitesRejected: 0,
    providerEnrichmentsRejected: 0,
    relatedCapabilityRowsRejected: 0,
    samples: [],
  };

  try {
    const db = getOptionalPrismaClient();
    const [v2Rows, enrichmentRows] = await Promise.all([
      db.providerWebsite.findMany({
        where: { status: { in: [...ACTIVE_STATUSES] } },
        take: limit,
        select: { id: true, url: true, entityId: true, entityType: true, status: true },
      }),
      db.providerEnrichment.findMany({
        where: { status: { in: [...ACTIVE_STATUSES] } },
        take: limit,
        select: {
          id: true,
          extractedValue: true,
          sourceUrl: true,
          entityId: true,
          entityType: true,
          fieldName: true,
          status: true,
        },
      }),
    ]);

    const v2Bad: typeof v2Rows = [];
    for (const row of v2Rows) {
      if (await isSyntheticForEntity(row.url, row.entityId, row.entityType)) {
        v2Bad.push(row);
      }
    }

    const syntheticUrls = new Set<string>();
    const enrichmentBad: typeof enrichmentRows = [];

    for (const row of enrichmentRows) {
      const checkUrl =
        row.fieldName === "website" ? row.extractedValue : (row.sourceUrl ?? "");
      if (!checkUrl?.trim()) continue;

      const obvious = isObviouslySyntheticGeneratedUrl(checkUrl);
      let bad = obvious.synthetic;
      if (!bad) {
        bad = await isSyntheticForEntity(checkUrl, row.entityId, row.entityType);
      }
      if (!bad) continue;

      enrichmentBad.push(row);
      if (row.fieldName === "website") {
        syntheticUrls.add(checkUrl.trim().toLowerCase().replace(/\/$/, ""));
      }
      if (row.sourceUrl) {
        syntheticUrls.add(row.sourceUrl.trim().toLowerCase().replace(/\/$/, ""));
      }
    }

    for (const row of enrichmentRows) {
      if (enrichmentBad.some((b) => b.id === row.id)) continue;
      if (row.fieldName === "website") continue;
      const src = row.sourceUrl?.trim().toLowerCase().replace(/\/$/, "") ?? "";
      if (!src || !syntheticUrls.has(src)) continue;
      enrichmentBad.push(row);
    }

    result.scanned = v2Bad.length + enrichmentBad.length;

    for (const row of [...v2Bad.slice(0, 5), ...enrichmentBad.slice(0, 10)]) {
      if (result.samples.length >= 15) break;
      result.samples.push({
        id: row.id,
        url: "url" in row ? row.url : row.extractedValue,
        entityId: row.entityId,
        fieldName: "fieldName" in row ? row.fieldName : undefined,
      });
    }

    if (dryRun) {
      result.rejected = result.scanned;
      result.providerWebsitesRejected = v2Bad.length;
      result.providerEnrichmentsRejected = enrichmentBad.filter((r) => r.fieldName === "website")
        .length;
      result.relatedCapabilityRowsRejected = enrichmentBad.filter(
        (r) => r.fieldName !== "website",
      ).length;
      return result;
    }

    for (const row of v2Bad) {
      await db.providerWebsite.update({
        where: { id: row.id },
        data: { status: "rejected", updatedAt: new Date() },
      });
      result.providerWebsitesRejected++;
      result.rejected++;
    }

    for (const row of enrichmentBad) {
      await db.providerEnrichment.update({
        where: { id: row.id },
        data: {
          status: "rejected",
          policyReason: SYNTHETIC_REJECT_REASON,
          provenanceNote: `synthetic_cleanup:${(row.fieldName === "website" ? row.extractedValue : row.sourceUrl)?.slice(0, 120)}`,
          updatedAt: new Date(),
        },
      });
      if (row.fieldName === "website") {
        result.providerEnrichmentsRejected++;
      } else {
        result.relatedCapabilityRowsRejected++;
      }
      result.rejected++;
    }
  } catch (e) {
    warnCrawlReviewDatasourceUnavailable("cleanupSyntheticWebsites", e);
    return { ...result, ok: false };
  }

  return result;
}

export function cleanupSyntheticWebsitesExitCode(result: CleanupSyntheticWebsitesResult): number {
  return result.ok ? 0 : 1;
}
