import { getOptionalPrismaClient } from "@/lib/db/prisma";
import { warnCrawlReviewDatasourceUnavailable } from "@/lib/provider-crawler/crawl-review-log";
import {
  isRegulatoryOrDirectoryUrl,
  REGULATORY_REJECT_REASON,
  regulatoryProvenanceNote,
} from "@/lib/provider-enrichment/regulatory-url-filter";
import { canonicalWebsiteOrigin } from "@/lib/provider-enrichment/value-canonicalization";

export type ApproveWebsitesOptions = {
  limit?: number;
  minConfidence?: number;
  dryRun?: boolean;
};

export type ApproveWebsitesRow = {
  id: string;
  entityId: string;
  entityType: string;
  url: string;
  confidence: number;
  status: string;
  source: "provider_websites" | "provider_enrichments";
  action: "approve" | "reject" | "skip";
  reason?: string;
};

export type ApproveWebsitesDryRunSummary = {
  providerWebsitesPending: number;
  providerEnrichmentWebsitePending: number;
  eligible: number;
  rejectedRegulatory: number;
  first10: ApproveWebsitesRow[];
};

export type ApproveWebsitesResult = {
  event: "providers_approve_websites";
  ok: boolean;
  dryRun: boolean;
  minConfidence: number;
  scanned: number;
  approved: number;
  rejected: number;
  skipped: number;
  indexed: number;
  samples: ApproveWebsitesRow[];
  dryRunSummary?: ApproveWebsitesDryRunSummary;
};

type WebsiteRow = {
  id: string;
  entityId: string;
  entityType: string;
  url: string;
  confidence: number;
  status: string;
  sourceType: string;
  sourceUrl: string | null;
  extractionMethod: string;
  source: "provider_websites" | "provider_enrichments";
};

export function classifyWebsiteRow(
  row: { url: string; confidence: number },
  minConfidence: number,
): { action: "approve" | "reject" | "skip"; reason?: string } {
  if (isRegulatoryOrDirectoryUrl(row.url)) {
    return { action: "reject", reason: REGULATORY_REJECT_REASON };
  }
  if (!canonicalWebsiteOrigin(row.url)) {
    return { action: "reject", reason: "invalid_url" };
  }
  if (row.confidence < minConfidence) {
    return { action: "skip", reason: "below_min_confidence" };
  }
  return { action: "approve" };
}

async function loadPendingWebsiteRows(limit: number): Promise<WebsiteRow[]> {
  const db = getOptionalPrismaClient();
  const [v2Rows, enrichmentRows] = await Promise.all([
    db.providerWebsite.findMany({
      where: { status: { in: ["pending_review", "audit_review"] } },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        id: true,
        entityId: true,
        entityType: true,
        url: true,
        confidence: true,
        status: true,
        sourceType: true,
        sourceUrl: true,
        extractionMethod: true,
      },
    }),
    db.providerEnrichment.findMany({
      where: {
        fieldName: "website",
        status: "pending_review",
      },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        id: true,
        entityId: true,
        entityType: true,
        extractedValue: true,
        confidence: true,
        status: true,
        sourceType: true,
        sourceUrl: true,
        extractionMethod: true,
      },
    }),
  ]);

  const mapped: WebsiteRow[] = [
    ...v2Rows.map((r) => ({ ...r, source: "provider_websites" as const })),
    ...enrichmentRows.map((r) => ({
      id: r.id,
      entityId: r.entityId,
      entityType: r.entityType,
      url: r.extractedValue,
      confidence: r.confidence,
      status: r.status,
      sourceType: r.sourceType,
      sourceUrl: r.sourceUrl,
      extractionMethod: r.extractionMethod,
      source: "provider_enrichments" as const,
    })),
  ];

  mapped.sort((a, b) => b.confidence - a.confidence);
  return mapped.slice(0, limit);
}

export function buildApproveWebsitesDryRunSummary(
  v2Pending: number,
  enrichmentPending: number,
  rows: WebsiteRow[],
  minConfidence: number,
): ApproveWebsitesDryRunSummary {
  const decisions = rows.map((row) => ({
    row,
    decision: classifyWebsiteRow(row, minConfidence),
  }));

  const first10: ApproveWebsitesRow[] = decisions.slice(0, 10).map(({ row, decision }) => ({
    id: row.id,
    entityId: row.entityId,
    entityType: row.entityType,
    url: row.url,
    confidence: row.confidence,
    status: row.status,
    source: row.source,
    action: decision.action,
    reason: decision.reason,
  }));

  return {
    providerWebsitesPending: v2Pending,
    providerEnrichmentWebsitePending: enrichmentPending,
    eligible: decisions.filter((d) => d.decision.action === "approve").length,
    rejectedRegulatory: decisions.filter(
      (d) => d.decision.action === "reject" && d.decision.reason === REGULATORY_REJECT_REASON,
    ).length,
    first10,
  };
}

export async function runApproveWebsites(
  opts: ApproveWebsitesOptions,
): Promise<ApproveWebsitesResult> {
  const limit = opts.limit ?? 100;
  const minConfidence = opts.minConfidence ?? 0.95;
  const dryRun = opts.dryRun ?? false;

  const result: ApproveWebsitesResult = {
    event: "providers_approve_websites",
    ok: true,
    dryRun,
    minConfidence,
    scanned: 0,
    approved: 0,
    rejected: 0,
    skipped: 0,
    indexed: 0,
    samples: [],
  };

  let rows: WebsiteRow[] = [];
  let v2Pending = 0;
  let enrichmentPending = 0;

  try {
    const db = getOptionalPrismaClient();
    [v2Pending, enrichmentPending] = await Promise.all([
      db.providerWebsite.count({
        where: { status: { in: ["pending_review", "audit_review"] } },
      }),
      db.providerEnrichment.count({
        where: { fieldName: "website", status: "pending_review" },
      }),
    ]);
    rows = await loadPendingWebsiteRows(limit);
  } catch (e) {
    warnCrawlReviewDatasourceUnavailable("providerWebsite", e);
    return {
      ...result,
      ok: false,
    };
  }

  result.scanned = rows.length;

  if (dryRun) {
    result.dryRunSummary = buildApproveWebsitesDryRunSummary(v2Pending, enrichmentPending, rows, minConfidence);
    for (const row of rows) {
      const decision = classifyWebsiteRow(row, minConfidence);
      const sample: ApproveWebsitesRow = {
        id: row.id,
        entityId: row.entityId,
        entityType: row.entityType,
        url: row.url,
        confidence: row.confidence,
        status: row.status,
        source: row.source,
        action: decision.action,
        reason: decision.reason,
      };
      if (result.samples.length < 20) result.samples.push(sample);
      if (decision.action === "approve") result.approved++;
      else if (decision.action === "reject") result.rejected++;
      else result.skipped++;
    }
    return result;
  }

  const { enqueueProviderForIndexing } = await import("@/lib/ops/enqueue-on-approval");
  const db = getOptionalPrismaClient();

  for (const row of rows) {
    const decision = classifyWebsiteRow(row, minConfidence);
    const sample: ApproveWebsitesRow = {
      id: row.id,
      entityId: row.entityId,
      entityType: row.entityType,
      url: row.url,
      confidence: row.confidence,
      status: row.status,
      source: row.source,
      action: decision.action,
      reason: decision.reason,
    };
    if (result.samples.length < 20) result.samples.push(sample);

    if (decision.action === "skip") {
      result.skipped++;
      continue;
    }

    if (decision.action === "reject") {
      result.rejected++;
      const note = regulatoryProvenanceNote(row.url, decision.reason ?? "regulatory");
      if (row.source === "provider_websites") {
        await db.providerWebsite.update({
          where: { id: row.id },
          data: { status: "rejected", updatedAt: new Date() },
        });
      } else {
        await db.providerEnrichment.update({
          where: { id: row.id },
          data: {
            status: "rejected",
            policyReason: decision.reason ?? REGULATORY_REJECT_REASON,
            provenanceNote: note,
            updatedAt: new Date(),
          },
        });
      }
      continue;
    }

    result.approved++;
    const canonical = canonicalWebsiteOrigin(row.url) ?? row.url;

    if (row.source === "provider_websites") {
      await db.providerWebsite.update({
        where: { id: row.id },
        data: { status: "approved", updatedAt: new Date() },
      });
    } else {
      await db.providerEnrichment.update({
        where: { id: row.id },
        data: {
          status: "approved",
          policyReason: "bulk_website_approval",
          updatedAt: new Date(),
        },
      });
    }

    await db.providerEnrichment.upsert({
      where: {
        entityId_fieldName_extractedValue: {
          entityId: row.entityId,
          fieldName: "website",
          extractedValue: canonical,
        },
      },
      create: {
        entityId: row.entityId,
        entityType: row.entityType,
        fieldName: "website",
        extractedValue: canonical,
        confidence: row.confidence,
        sourceUrl: row.sourceUrl ?? canonical,
        sourceType: row.sourceType,
        extractionMethod: row.extractionMethod,
        status: "approved",
        policyDecision: "manual_review",
        policyReason: "bulk_website_approval",
        provenanceNote: "providers:approve-websites",
      },
      update: {
        status: "approved",
        confidence: row.confidence,
        policyReason: "bulk_website_approval",
        updatedAt: new Date(),
      },
    });

    await enqueueProviderForIndexing({
      entityId: row.entityId,
      entityType: row.entityType,
      reason: "website_bulk_approved",
    });
    result.indexed++;
  }

  return result;
}

export function approveWebsitesExitCode(result: ApproveWebsitesResult): number {
  return result.ok ? 0 : 1;
}
