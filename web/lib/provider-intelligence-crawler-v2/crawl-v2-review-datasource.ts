import type { PrismaClient } from "@prisma/client";

import { getOptionalPrismaClient } from "@/lib/db/prisma";
import {
  formatFullCrawlReviewDatasourceError,
  warnCrawlReviewDatasourceUnavailable,
} from "@/lib/provider-crawler/crawl-review-log";
import {
  aggregateStatusCounts,
  ENRICHMENT_REVIEW_FIELDS,
  type AggregateTable,
  type StatusCounts,
} from "@/lib/provider-intelligence-crawler-v2/crawl-v2-review-aggregate";
import {
  pendingSamplesSpec,
  statusGroupBySpec,
  V2_REVIEW_PENDING_STATUSES,
} from "@/lib/provider-intelligence-crawler-v2/crawl-v2-review-queries";

export type V2ReviewQueryDebug = {
  tableName: string;
  queryType: "count" | "groupBy" | "findMany" | "aggregate";
  whereClause: Record<string, unknown>;
  selectClause?: string[] | Record<string, boolean>;
  take?: number;
  orderBy?: Record<string, unknown>;
  sql?: string;
  parameters?: Record<string, unknown>;
  queryElapsedMs: number;
  rowsLoaded: number;
  timeout: boolean;
  /** Full error text (never truncated). */
  error?: string;
};

export type V2ReviewLoadResult = {
  ok: boolean;
  error?: string;
  unavailable?: boolean;
  fallbackFromEnrichments?: boolean;
  pending: number;
  autoApproved: number;
  approved: number;
  rejected: number;
  total: number;
  samples: unknown[];
  queryDebug: V2ReviewQueryDebug[];
};

export const V2_REVIEW_QUERY_TIMEOUT_MS = Number(
  process.env.PROVIDER_CRAWL_V2_REVIEW_QUERY_TIMEOUT_MS ?? "30000",
);

export function v2ReviewQueryTimeoutError(timeoutMs: number): Error {
  return Object.assign(
    new Error(`crawl v2 review query timed out after ${timeoutMs}ms`),
    { code: "ETIMEDOUT" },
  );
}

export async function withV2ReviewQueryTimeout<T>(
  promise: Promise<T>,
  timeoutMs = V2_REVIEW_QUERY_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(v2ReviewQueryTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function emptySummary(error?: string): V2ReviewLoadResult {
  return {
    ok: false,
    error,
    pending: 0,
    autoApproved: 0,
    approved: 0,
    rejected: 0,
    total: 0,
    samples: [],
    queryDebug: [],
  };
}

async function runQuery<T>(
  spec: Omit<
    V2ReviewQueryDebug,
    "queryElapsedMs" | "rowsLoaded" | "timeout" | "error"
  >,
  fn: () => Promise<T>,
  countRows: (result: T) => number,
): Promise<{ result: T | null; debug: V2ReviewQueryDebug }> {
  const started = Date.now();
  try {
    const result = await withV2ReviewQueryTimeout(fn());
    return {
      result,
      debug: {
        ...spec,
        queryElapsedMs: Date.now() - started,
        rowsLoaded: countRows(result),
        timeout: false,
      },
    };
  } catch (e) {
    const timeout =
      (e as { code?: string }).code === "ETIMEDOUT" ||
      (e instanceof Error && e.message.includes("timed out"));
    const fullError = formatFullCrawlReviewDatasourceError(e);
    console.error(
      JSON.stringify({
        event: "crawl_v2_review_query_failed",
        tableName: spec.tableName,
        queryType: spec.queryType,
        sql: spec.sql,
        parameters: spec.parameters,
        whereClause: spec.whereClause,
        error: fullError,
      }),
    );
    return {
      result: null,
      debug: {
        ...spec,
        queryElapsedMs: Date.now() - started,
        rowsLoaded: 0,
        timeout,
        error: fullError,
      },
    };
  }
}

async function loadStatusAggregate(
  db: PrismaClient,
  tableName: AggregateTable,
  debugTableName: string,
  fieldNames?: readonly string[],
): Promise<{ counts: StatusCounts | null; debug: V2ReviewQueryDebug }> {
  const spec = statusGroupBySpec(
    debugTableName,
    fieldNames?.length
      ? `field_name IN (${fieldNames.map((f) => `'${f}'`).join(", ")})`
      : "",
  );

  const run = await runQuery(
    {
      tableName: spec.tableName,
      queryType: spec.queryType,
      whereClause: spec.whereClause,
      sql: spec.sqlEquivalent,
      parameters: fieldNames?.length ? { fieldNames: [...fieldNames] } : {},
    },
    async () => {
      const result = await aggregateStatusCounts(
        db,
        tableName,
        fieldNames?.length ? { fieldNames } : undefined,
      );
      return result;
    },
    (result) => result.groupRowCount,
  );

  if (run.debug.error || !run.result) {
    return { counts: null, debug: run.debug };
  }

  const debug: V2ReviewQueryDebug = {
    ...run.debug,
    sql: run.result.query.sql,
    parameters: run.result.query.parameters,
  };

  return { counts: run.result.counts, debug };
}

async function loadPendingSamples(
  db: PrismaClient,
  tableName: string,
  loader: () => Promise<unknown[]>,
  selectFields: string[],
  extraWhere?: Record<string, unknown>,
): Promise<{ samples: unknown[]; debug: V2ReviewQueryDebug }> {
  const spec = pendingSamplesSpec(tableName, selectFields, extraWhere);
  const prismaCall = `findMany({ where: ${JSON.stringify(spec.whereClause)}, select: [...], orderBy: ${JSON.stringify(spec.orderBy)}, take: ${spec.take} })`;
  const run = await runQuery(
    {
      tableName: spec.tableName,
      queryType: spec.queryType,
      whereClause: spec.whereClause,
      selectClause: spec.selectClause,
      take: spec.take,
      orderBy: spec.orderBy,
      sql: `${tableName}.${prismaCall}`,
      parameters: spec.whereClause,
    },
    loader,
    (rows) => rows.length,
  );

  return {
    samples: run.result ?? [],
    debug: run.debug,
  };
}

export async function loadProviderWebsiteReview(
  db: PrismaClient,
): Promise<V2ReviewLoadResult> {
  const aggregate = await loadStatusAggregate(db, "provider_websites", "provider_websites");
  const debugs = [aggregate.debug];

  if (!aggregate.counts) {
    return { ...emptySummary(aggregate.debug.error), queryDebug: debugs };
  }

  const samples = await loadPendingSamples(
    db,
    "provider_websites",
    () =>
      db.providerWebsite.findMany({
        where: { status: { in: [...V2_REVIEW_PENDING_STATUSES] } },
        select: {
          id: true,
          entityId: true,
          url: true,
          status: true,
          confidence: true,
          createdAt: true,
        },
        orderBy: { confidence: "desc" },
        take: 10,
      }),
    ["id", "entityId", "url", "status", "confidence", "createdAt"],
  );
  debugs.push(samples.debug);

  return {
    ok: true,
    pending: aggregate.counts.pending,
    autoApproved: aggregate.counts.autoApproved,
    approved: aggregate.counts.approved,
    rejected: aggregate.counts.rejected,
    total: aggregate.counts.total,
    samples: (samples.samples as { entityId: string; url: string; confidence: number; status: string }[]).map(
      (r) => ({
        entityId: r.entityId,
        url: r.url,
        confidence: r.confidence,
        status: r.status,
      }),
    ),
    queryDebug: debugs,
  };
}

export async function loadProviderContactReview(
  db: PrismaClient,
): Promise<V2ReviewLoadResult> {
  const aggregate = await loadStatusAggregate(db, "provider_contacts", "provider_contacts");
  const debugs = [aggregate.debug];
  if (!aggregate.counts) {
    return { ...emptySummary(aggregate.debug.error), queryDebug: debugs };
  }

  const samples = await loadPendingSamples(
    db,
    "provider_contacts",
    () =>
      db.providerContact.findMany({
        where: { status: { in: [...V2_REVIEW_PENDING_STATUSES] } },
        select: {
          id: true,
          entityId: true,
          fieldName: true,
          value: true,
          status: true,
          confidence: true,
          createdAt: true,
        },
        orderBy: { confidence: "desc" },
        take: 10,
      }),
    ["id", "entityId", "fieldName", "value", "status", "confidence", "createdAt"],
  );
  debugs.push(samples.debug);

  return {
    ok: true,
    pending: aggregate.counts.pending,
    autoApproved: aggregate.counts.autoApproved,
    approved: aggregate.counts.approved,
    rejected: aggregate.counts.rejected,
    total: aggregate.counts.total,
    samples: (samples.samples as { entityId: string; fieldName: string; value: string; confidence: number; status: string }[]).map(
      (r) => ({
        entityId: r.entityId,
        fieldName: r.fieldName,
        value: r.value,
        confidence: r.confidence,
        status: r.status,
      }),
    ),
    queryDebug: debugs,
  };
}

export async function loadEnrichmentFieldReview(
  db: PrismaClient,
  fieldName: string,
): Promise<V2ReviewLoadResult> {
  const aggregate = await loadStatusAggregate(
    db,
    "provider_enrichments",
    `provider_enrichments_${fieldName}`,
    [fieldName],
  );
  const debugs = [aggregate.debug];
  if (!aggregate.counts) {
    return { ...emptySummary(aggregate.debug.error), queryDebug: debugs };
  }

  const samples = await loadPendingSamples(
    db,
    `provider_enrichments_${fieldName}`,
    () =>
      db.providerEnrichment.findMany({
        where: {
          fieldName,
          status: { in: [...V2_REVIEW_PENDING_STATUSES] },
        },
        select: {
          id: true,
          entityId: true,
          extractedValue: true,
          status: true,
          confidence: true,
          createdAt: true,
        },
        orderBy: { confidence: "desc" },
        take: 10,
      }),
    ["id", "entityId", "extractedValue", "status", "confidence", "createdAt"],
    { fieldName },
  );
  debugs.push(samples.debug);

  return {
    ok: true,
    pending: aggregate.counts.pending,
    autoApproved: aggregate.counts.autoApproved,
    approved: aggregate.counts.approved,
    rejected: aggregate.counts.rejected,
    total: aggregate.counts.total,
    samples: (samples.samples as { entityId: string; extractedValue: string; confidence: number; status: string }[]).map(
      (r) => ({
        entityId: r.entityId,
        fieldName,
        extractedValue: r.extractedValue,
        confidence: r.confidence,
        status: r.status,
      }),
    ),
    queryDebug: debugs,
  };
}

export async function loadProviderPracticeAreaReview(
  db: PrismaClient,
): Promise<V2ReviewLoadResult> {
  const aggregate = await loadStatusAggregate(
    db,
    "provider_practice_areas",
    "provider_practice_areas",
  );
  const debugs = [aggregate.debug];
  if (!aggregate.counts) {
    return { ...emptySummary(aggregate.debug.error), queryDebug: debugs };
  }

  const samples = await loadPendingSamples(
    db,
    "provider_practice_areas",
    () =>
      db.providerPracticeArea.findMany({
        where: { status: { in: [...V2_REVIEW_PENDING_STATUSES] } },
        select: {
          id: true,
          entityId: true,
          label: true,
          slug: true,
          status: true,
          confidence: true,
          createdAt: true,
        },
        orderBy: { confidence: "desc" },
        take: 10,
      }),
    ["id", "entityId", "label", "slug", "status", "confidence", "createdAt"],
  );
  debugs.push(samples.debug);

  return {
    ok: true,
    pending: aggregate.counts.pending,
    autoApproved: aggregate.counts.autoApproved,
    approved: aggregate.counts.approved,
    rejected: aggregate.counts.rejected,
    total: aggregate.counts.total,
    samples: (samples.samples as { entityId: string; label: string; slug: string | null; confidence: number; status: string }[]).map(
      (r) => ({
        entityId: r.entityId,
        label: r.label,
        slug: r.slug,
        confidence: r.confidence,
        status: r.status,
      }),
    ),
    queryDebug: debugs,
  };
}

export async function loadProviderReviewSignalReview(
  db: PrismaClient,
): Promise<V2ReviewLoadResult> {
  const aggregate = await loadStatusAggregate(
    db,
    "provider_review_signals",
    "provider_review_signals",
  );
  const debugs = [aggregate.debug];
  if (!aggregate.counts) {
    return { ...emptySummary(aggregate.debug.error), queryDebug: debugs };
  }

  const samples = await loadPendingSamples(
    db,
    "provider_review_signals",
    () =>
      db.providerReviewSignal.findMany({
        where: { status: { in: [...V2_REVIEW_PENDING_STATUSES] } },
        select: {
          id: true,
          entityId: true,
          signalType: true,
          value: true,
          status: true,
          confidence: true,
          createdAt: true,
        },
        orderBy: { confidence: "desc" },
        take: 10,
      }),
    ["id", "entityId", "signalType", "value", "status", "confidence", "createdAt"],
  );
  debugs.push(samples.debug);

  return {
    ok: true,
    pending: aggregate.counts.pending,
    autoApproved: aggregate.counts.autoApproved,
    approved: aggregate.counts.approved,
    rejected: aggregate.counts.rejected,
    total: aggregate.counts.total,
    samples: (samples.samples as { entityId: string; signalType: string; value: string; confidence: number; status: string }[]).map(
      (r) => ({
        entityId: r.entityId,
        signalType: r.signalType,
        value: r.value,
        confidence: r.confidence,
        status: r.status,
      }),
    ),
    queryDebug: debugs,
  };
}

export async function loadProviderEnrichmentReview(
  db: PrismaClient,
): Promise<V2ReviewLoadResult> {
  const aggregate = await loadStatusAggregate(
    db,
    "provider_enrichments",
    "provider_enrichments",
    ENRICHMENT_REVIEW_FIELDS,
  );
  const debugs = [aggregate.debug];
  if (!aggregate.counts) {
    return { ...emptySummary(aggregate.debug.error), queryDebug: debugs };
  }

  const samples = await loadPendingSamples(
    db,
    "provider_enrichments",
    () =>
      db.providerEnrichment.findMany({
        where: {
          status: { in: [...V2_REVIEW_PENDING_STATUSES] },
          fieldName: { in: [...ENRICHMENT_REVIEW_FIELDS] },
        },
        select: {
          id: true,
          entityId: true,
          fieldName: true,
          extractedValue: true,
          status: true,
          confidence: true,
          createdAt: true,
        },
        orderBy: { confidence: "desc" },
        take: 10,
      }),
    ["id", "entityId", "fieldName", "extractedValue", "status", "confidence", "createdAt"],
    { fieldName: { in: [...ENRICHMENT_REVIEW_FIELDS] } },
  );
  debugs.push(samples.debug);

  return {
    ok: true,
    pending: aggregate.counts.pending,
    autoApproved: aggregate.counts.autoApproved,
    approved: aggregate.counts.approved,
    rejected: aggregate.counts.rejected,
    total: aggregate.counts.total,
    samples: (samples.samples as { entityId: string; fieldName: string; extractedValue: string; confidence: number; status: string }[]).map(
      (r) => ({
        entityId: r.entityId,
        fieldName: r.fieldName,
        extractedValue: r.extractedValue,
        confidence: r.confidence,
        status: r.status,
      }),
    ),
    queryDebug: debugs,
  };
}

export async function loadTableReview(
  source: string,
  loader: (db: PrismaClient) => Promise<V2ReviewLoadResult>,
): Promise<V2ReviewLoadResult> {
  const db = getOptionalPrismaClient();
  try {
    return await loader(db);
  } catch (e) {
    const fullError = formatFullCrawlReviewDatasourceError(e);
    console.error(
      JSON.stringify({
        event: "crawl_v2_review_datasource_failed",
        source,
        error: fullError,
      }),
    );
    warnCrawlReviewDatasourceUnavailable(source, e);
    return { ...emptySummary(fullError), unavailable: true };
  }
}

/** @deprecated Use loadTableReview — enrichment fallback removed. */
export async function loadOptionalTableReview(
  source: string,
  loader: (db: PrismaClient) => Promise<V2ReviewLoadResult>,
  _enrichmentFallback?: (db: PrismaClient) => Promise<V2ReviewLoadResult>,
): Promise<V2ReviewLoadResult> {
  return loadTableReview(source, loader);
}

export function computeV2CrawlReviewHealth(args: {
  enrichmentsOk: boolean;
  optionalSourcesOk: boolean[];
}): { ok: boolean; degraded: boolean } {
  const ok = args.enrichmentsOk;
  const degraded = !ok || args.optionalSourcesOk.some((v) => !v);
  return { ok, degraded };
}

export function topSlowestQueries(
  debugs: V2ReviewQueryDebug[],
  limit = 5,
): V2ReviewQueryDebug[] {
  return [...debugs].sort((a, b) => b.queryElapsedMs - a.queryElapsedMs).slice(0, limit);
}
