import type { PrismaClient } from "@prisma/client";

import {
  ENRICHMENT_REVIEW_FIELDS,
  V2_REVIEW_PENDING_STATUSES,
} from "@/lib/provider-intelligence-crawler-v2/crawl-v2-review-queries";

export type StatusCounts = {
  pending: number;
  autoApproved: number;
  approved: number;
  rejected: number;
  total: number;
};

export type StatusAggregateQuery = {
  /** Prisma API description (no raw SQL). */
  sql: string;
  parameters: Record<string, unknown>;
};

type V2StatusGroupRow = { status: string; _count: { _all: number } };

function countsFromGroupByRows(rows: V2StatusGroupRow[]): StatusCounts {
  let pending = 0;
  let autoApproved = 0;
  let approved = 0;
  let rejected = 0;
  const pendingSet = new Set(V2_REVIEW_PENDING_STATUSES);

  for (const row of rows) {
    const n = row._count._all;
    if (pendingSet.has(row.status)) pending += n;
    else if (row.status === "auto_approved") autoApproved += n;
    else if (row.status === "approved") approved += n;
    else if (row.status === "rejected") rejected += n;
  }

  return {
    pending,
    autoApproved,
    approved,
    rejected,
    total: pending + autoApproved + approved + rejected,
  };
}

export type AggregateTable =
  | "provider_websites"
  | "provider_contacts"
  | "provider_practice_areas"
  | "provider_review_signals"
  | "provider_enrichments";

/** Status counts via Prisma groupBy (avoids $queryRaw parsing issues). */
export async function aggregateStatusCounts(
  db: PrismaClient,
  tableName: AggregateTable,
  fieldFilter?: { fieldNames: readonly string[] },
): Promise<{
  counts: StatusCounts;
  groupRowCount: number;
  query: StatusAggregateQuery;
}> {
  const { rows, query } = await loadStatusGroupByRows(db, tableName, fieldFilter);

  return {
    counts: countsFromGroupByRows(rows),
    groupRowCount: rows.length,
    query,
  };
}

async function loadStatusGroupByRows(
  db: PrismaClient,
  tableName: AggregateTable,
  fieldFilter?: { fieldNames: readonly string[] },
): Promise<{ rows: V2StatusGroupRow[]; query: StatusAggregateQuery }> {
  if (tableName === "provider_enrichments" && fieldFilter?.fieldNames.length) {
    const fieldNames = [...fieldFilter.fieldNames];
    const rows = await db.providerEnrichment.groupBy({
      by: ["status"],
      where: { fieldName: { in: fieldNames } },
      _count: { _all: true },
    });
    return {
      rows,
      query: {
        sql: "providerEnrichment.groupBy({ by: ['status'], where: { fieldName: { in: $fieldNames } }, _count: { _all: true } })",
        parameters: { fieldNames },
      },
    };
  }

  switch (tableName) {
    case "provider_websites": {
      const rows = await db.providerWebsite.groupBy({
        by: ["status"],
        _count: { _all: true },
      });
      return {
        rows,
        query: {
          sql: "providerWebsite.groupBy({ by: ['status'], _count: { _all: true } })",
          parameters: {},
        },
      };
    }
    case "provider_contacts": {
      const rows = await db.providerContact.groupBy({
        by: ["status"],
        _count: { _all: true },
      });
      return {
        rows,
        query: {
          sql: "providerContact.groupBy({ by: ['status'], _count: { _all: true } })",
          parameters: {},
        },
      };
    }
    case "provider_practice_areas": {
      const rows = await db.providerPracticeArea.groupBy({
        by: ["status"],
        _count: { _all: true },
      });
      return {
        rows,
        query: {
          sql: "providerPracticeArea.groupBy({ by: ['status'], _count: { _all: true } })",
          parameters: {},
        },
      };
    }
    case "provider_review_signals": {
      const rows = await db.providerReviewSignal.groupBy({
        by: ["status"],
        _count: { _all: true },
      });
      return {
        rows,
        query: {
          sql: "providerReviewSignal.groupBy({ by: ['status'], _count: { _all: true } })",
          parameters: {},
        },
      };
    }
    case "provider_enrichments": {
      const rows = await db.providerEnrichment.groupBy({
        by: ["status"],
        _count: { _all: true },
      });
      return {
        rows,
        query: {
          sql: "providerEnrichment.groupBy({ by: ['status'], _count: { _all: true } })",
          parameters: {},
        },
      };
    }
  }
}

export async function loadTableRowCounts(db: PrismaClient): Promise<Record<string, number>> {
  const [provider_websites, provider_contacts, provider_practice_areas, provider_review_signals, provider_enrichments] =
    await Promise.all([
      db.providerWebsite.count(),
      db.providerContact.count(),
      db.providerPracticeArea.count(),
      db.providerReviewSignal.count(),
      db.providerEnrichment.count(),
    ]);

  return {
    provider_websites,
    provider_contacts,
    provider_practice_areas,
    provider_review_signals,
    provider_enrichments,
  };
}

export type ExplainPlanRow = {
  queryName: string;
  sql: string;
  plan: string;
  explainElapsedMs: number;
};

export async function explainReviewQueries(db: PrismaClient): Promise<ExplainPlanRow[]> {
  const plans: ExplainPlanRow[] = [];

  const queries: { name: string; sql: string }[] = [
    {
      name: "provider_websites_status_groupby",
      sql: "SELECT status, COUNT(*) FROM provider_websites GROUP BY status",
    },
    {
      name: "provider_websites_pending_samples",
      sql: "SELECT id, entity_id, url, status, confidence FROM provider_websites WHERE status IN ('pending_review','audit_review') ORDER BY confidence DESC LIMIT 10",
    },
    {
      name: "provider_contacts_status_groupby",
      sql: "SELECT status, COUNT(*) FROM provider_contacts GROUP BY status",
    },
    {
      name: "provider_contacts_pending_samples",
      sql: "SELECT id, entity_id, field_name, value, status, confidence FROM provider_contacts WHERE status IN ('pending_review','audit_review') ORDER BY confidence DESC LIMIT 10",
    },
    {
      name: "provider_practice_areas_status_groupby",
      sql: "SELECT status, COUNT(*) FROM provider_practice_areas GROUP BY status",
    },
    {
      name: "provider_review_signals_status_groupby",
      sql: "SELECT status, COUNT(*) FROM provider_review_signals GROUP BY status",
    },
    {
      name: "provider_enrichments_status_groupby",
      sql: "SELECT status, COUNT(*) FROM provider_enrichments GROUP BY status",
    },
    {
      name: "provider_enrichments_field_status_groupby",
      sql: "SELECT status, COUNT(*) FROM provider_enrichments WHERE field_name IN ('website','phone','email','practiceAreaSlugs','contactPageUrl') GROUP BY status",
    },
    {
      name: "provider_enrichments_pending_samples",
      sql: "SELECT id, entity_id, field_name, extracted_value, confidence FROM provider_enrichments WHERE status IN ('pending_review','audit_review') AND field_name IN ('website','phone','email','practiceAreaSlugs','contactPageUrl') ORDER BY confidence DESC LIMIT 10",
    },
  ];

  for (const q of queries) {
    const started = Date.now();
    try {
      const result = await db.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${q.sql}`,
      );
      plans.push({
        queryName: q.name,
        sql: q.sql,
        plan: result.map((r) => r["QUERY PLAN"]).join("\n"),
        explainElapsedMs: Date.now() - started,
      });
    } catch (e) {
      plans.push({
        queryName: q.name,
        sql: q.sql,
        plan: e instanceof Error ? e.stack ?? e.message : String(e),
        explainElapsedMs: Date.now() - started,
      });
    }
  }

  return plans;
}

export { ENRICHMENT_REVIEW_FIELDS };
