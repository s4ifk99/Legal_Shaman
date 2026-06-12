/** Documented query shapes for providers:crawl:v2:review (audit + runtime). */

export type V2ReviewQuerySpec = {
  tableName: string;
  queryType: "count" | "groupBy" | "findMany" | "aggregate";
  whereClause: Record<string, unknown>;
  selectClause?: string[] | Record<string, boolean>;
  take?: number;
  orderBy?: Record<string, unknown>;
  sqlEquivalent: string;
};

export const V2_REVIEW_TABLES = {
  providerWebsites: "provider_websites",
  providerContacts: "provider_contacts",
  providerPracticeAreas: "provider_practice_areas",
  providerReviewSignals: "provider_review_signals",
  providerEnrichments: "provider_enrichments",
} as const;

const PENDING_STATUSES = ["pending_review", "audit_review"];

export const ENRICHMENT_REVIEW_FIELDS = [
  "website",
  "phone",
  "email",
  "practiceAreaSlugs",
  "contactPageUrl",
] as const;

export function statusGroupBySpec(tableName: string, extraWhere = ""): V2ReviewQuerySpec {
  const where = extraWhere ? `WHERE ${extraWhere}` : "";
  const prismaModel = tableNameToPrismaModel(tableName);
  return {
    tableName,
    queryType: "groupBy",
    whereClause: extraWhere ? { raw: extraWhere } : {},
    sqlEquivalent: `${prismaModel}.groupBy({ by: ['status']${extraWhere ? `, where: { ... }` : ""}, _count: { _all: true } }) /* SQL equiv: SELECT status, COUNT(*) FROM ${tableName} ${where} GROUP BY status */`,
  };
}

function tableNameToPrismaModel(tableName: string): string {
  switch (tableName) {
    case "provider_websites":
      return "providerWebsite";
    case "provider_contacts":
      return "providerContact";
    case "provider_practice_areas":
      return "providerPracticeArea";
    case "provider_review_signals":
      return "providerReviewSignal";
    case "provider_enrichments":
      return "providerEnrichment";
    default:
      return tableName;
  }
}

export function pendingSamplesSpec(
  tableName: string,
  selectFields: string[],
  extraWhere?: Record<string, unknown>,
): V2ReviewQuerySpec {
  const where = { status: { in: PENDING_STATUSES }, ...extraWhere };
  return {
    tableName: `${tableName}_pending_samples`,
    queryType: "findMany",
    whereClause: where,
    selectClause: selectFields,
    take: 10,
    orderBy: { confidence: "desc" },
    sqlEquivalent: `SELECT ${selectFields.join(", ")} FROM ${tableName} WHERE status IN ('pending_review','audit_review')${extraWhere ? " AND ..." : ""} ORDER BY confidence DESC LIMIT 10`,
  };
}

export const V2_REVIEW_QUERY_CATALOG: V2ReviewQuerySpec[] = [
  statusGroupBySpec(V2_REVIEW_TABLES.providerWebsites),
  pendingSamplesSpec(V2_REVIEW_TABLES.providerWebsites, [
    "id",
    "entity_id",
    "url",
    "status",
    "confidence",
    "created_at",
  ]),
  statusGroupBySpec(V2_REVIEW_TABLES.providerContacts),
  pendingSamplesSpec(V2_REVIEW_TABLES.providerContacts, [
    "id",
    "entity_id",
    "field_name",
    "value",
    "status",
    "confidence",
    "created_at",
  ]),
  statusGroupBySpec(V2_REVIEW_TABLES.providerPracticeAreas),
  pendingSamplesSpec(V2_REVIEW_TABLES.providerPracticeAreas, [
    "id",
    "entity_id",
    "label",
    "slug",
    "status",
    "confidence",
    "created_at",
  ]),
  statusGroupBySpec(V2_REVIEW_TABLES.providerReviewSignals),
  pendingSamplesSpec(V2_REVIEW_TABLES.providerReviewSignals, [
    "id",
    "entity_id",
    "signal_type",
    "value",
    "status",
    "confidence",
    "created_at",
  ]),
  statusGroupBySpec(
    V2_REVIEW_TABLES.providerEnrichments,
    `field_name IN (${ENRICHMENT_REVIEW_FIELDS.map((f) => `'${f}'`).join(", ")})`,
  ),
  pendingSamplesSpec(
    V2_REVIEW_TABLES.providerEnrichments,
    ["id", "entity_id", "field_name", "extracted_value", "status", "confidence", "created_at"],
    { fieldName: { in: [...ENRICHMENT_REVIEW_FIELDS] } },
  ),
];

/** Recommended indexes for review query patterns (status-only counts + pending samples). */
export const V2_REVIEW_INDEX_RECOMMENDATIONS = [
  {
    table: "provider_websites",
    columns: ["status"],
    reason: "status GROUP BY and COUNT(*) WHERE status = ? (current index is entity_id, status)",
  },
  {
    table: "provider_websites",
    columns: ["status", "confidence"],
    reason: "pending samples ORDER BY confidence DESC",
  },
  {
    table: "provider_contacts",
    columns: ["status"],
    reason: "status aggregate counts",
  },
  {
    table: "provider_contacts",
    columns: ["status", "confidence"],
    reason: "pending contact samples",
  },
  {
    table: "provider_practice_areas",
    columns: ["status"],
    reason: "status aggregate counts",
  },
  {
    table: "provider_review_signals",
    columns: ["status"],
    reason: "status aggregate counts",
  },
  {
    table: "provider_enrichments",
    columns: ["field_name", "status"],
    reason: "filtered review counts WHERE field_name IN (...)",
  },
  {
    table: "provider_enrichments",
    columns: ["status", "confidence"],
    reason: "pending enrichment samples ORDER BY confidence",
  },
];

export { PENDING_STATUSES as V2_REVIEW_PENDING_STATUSES };
