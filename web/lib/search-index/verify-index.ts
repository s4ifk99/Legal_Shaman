import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import { legalEntitiesFields } from "@/lib/search-index/typesense-legal-entities-index";
import { typesenseServerHealth } from "@/lib/search-index/typesense-legal-entities-index";
import { collectIndexBalanceReport } from "@/lib/search-index/index-balance-diagnostics";

const REQUIRED_FIELDS = [
  "id",
  "title",
  "searchText",
  "expandedSearchText",
  "practiceAreas",
  "practiceAreaSlugs",
  "relatedPracticeAreas",
  "taxonomyAliases",
  "entityType",
  "source",
] as const;

const SAMPLE_SIZE = 120;

export type IndexVerifyRow = {
  check: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

export type IndexVerifyReport = {
  ok: boolean;
  rows: IndexVerifyRow[];
  balance?: Awaited<ReturnType<typeof collectIndexBalanceReport>>;
};

function row(check: string, status: IndexVerifyRow["status"], detail: string): IndexVerifyRow {
  return { check, status, detail };
}

function formatCountMap(map: Record<string, number>, keys?: string[]): string {
  const entries = keys
    ? keys.map((k) => [k, map[k] ?? 0] as const)
    : Object.entries(map).sort((a, b) => b[1] - a[1]);
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

export async function verifyLegalEntitiesIndex(): Promise<IndexVerifyReport> {
  const rows: IndexVerifyRow[] = [];
  const client = buildTypesenseListingsClientFromEnv();

  if (!client) {
    rows.push(row("typesense_config", "fail", "TYPESENSE_HOST and TYPESENSE_API_KEY required"));
    return { ok: false, rows };
  }

  const health = await typesenseServerHealth(client);
  rows.push(
    row(
      "typesense_health",
      health.ok ? "pass" : "fail",
      health.ok ? `ok${health.version ? ` (${health.version})` : ""}` : "unreachable",
    ),
  );
  if (!health.ok) return { ok: false, rows };

  let schemaFieldNames: string[] = [];
  let numDocuments = 0;
  try {
    const col = await client.collections(LEGAL_ENTITIES_COLLECTION).retrieve();
    numDocuments = Number((col as { num_documents?: number }).num_documents ?? 0);
    schemaFieldNames = ((col as { fields?: { name: string }[] }).fields ?? []).map((f) => f.name);
    rows.push(row("collection_exists", "pass", LEGAL_ENTITIES_COLLECTION));
  } catch {
    rows.push(row("collection_exists", "fail", `${LEGAL_ENTITIES_COLLECTION} not found`));
    return { ok: false, rows };
  }

  rows.push(
    row(
      "document_count",
      numDocuments > 0 ? "pass" : "fail",
      String(numDocuments),
    ),
  );

  const expectedFromCode = new Set(legalEntitiesFields.map((f) => f.name));
  for (const field of REQUIRED_FIELDS) {
    const inSchema = schemaFieldNames.includes(field);
    const isIdField = field === "id";
    const pass = isIdField ? true : inSchema;
    rows.push(
      row(
        `field:${field}`,
        pass ? "pass" : "fail",
        isIdField
          ? "built-in document id"
          : inSchema
            ? "present"
            : "missing from collection schema — re-run search:index after schema update",
      ),
    );
  }

  if (numDocuments === 0) {
    return { ok: false, rows };
  }

  const sample = await client
    .collections(LEGAL_ENTITIES_COLLECTION)
    .documents()
    .search({
      q: "*",
      query_by: "title",
      per_page: SAMPLE_SIZE,
    });

  const hits = (sample as { hits?: { document: Record<string, unknown> }[] }).hits ?? [];
  let withSlugs = 0;
  let withExpanded = 0;
  let withAliases = 0;
  let withCoords = 0;
  const ids = new Set<string>();
  let duplicateIds = 0;

  for (const h of hits) {
    const d = h.document;
    const id = String(d.id ?? "");
    if (id) {
      if (ids.has(id)) duplicateIds++;
      ids.add(id);
    }
    if (Array.isArray(d.practiceAreaSlugs) && (d.practiceAreaSlugs as string[]).length > 0) {
      withSlugs++;
    }
    if (typeof d.expandedSearchText === "string" && d.expandedSearchText.length > 10) {
      withExpanded++;
    }
    if (Array.isArray(d.taxonomyAliases) && (d.taxonomyAliases as string[]).length > 0) {
      withAliases++;
    }
    if (d.locationPoint != null) withCoords++;
  }

  const n = hits.length || 1;
  rows.push(
    row(
      "practiceAreaSlugs_populated",
      withSlugs > 0 ? "pass" : "warn",
      `${withSlugs}/${hits.length} in sample (re-index if 0)`,
    ),
  );
  rows.push(
    row(
      "expandedSearchText_populated",
      withExpanded / n >= 0.9 ? "pass" : "warn",
      `${withExpanded}/${hits.length} in sample`,
    ),
  );
  rows.push(
    row(
      "taxonomyAliases_populated",
      withAliases > 0 ? "pass" : "warn",
      `${withAliases}/${hits.length} in sample (projection may be sparse)`,
    ),
  );
  rows.push(
    row(
      "coordinates",
      "pass",
      `${withCoords}/${hits.length} with locationPoint in sample`,
    ),
  );
  rows.push(
    row(
      "duplicate_ids_sample",
      duplicateIds === 0 ? "pass" : "fail",
      duplicateIds === 0 ? "none in sample" : `${duplicateIds} duplicates in sample`,
    ),
  );

  const prisonProbe = await client
    .collections(LEGAL_ENTITIES_COLLECTION)
    .documents()
    .search({
      q: "prison",
      query_by: "expandedSearchText,practiceAreaSlugs,taxonomyAliases,practiceAreas",
      per_page: 5,
    });
  const prisonHits = ((prisonProbe as { found?: number }).found ?? 0) as number;
  rows.push(
    row(
      "prison_probe",
      prisonHits > 0 ? "pass" : "warn",
      `${prisonHits} matches for "prison"`,
    ),
  );

  const balance = await collectIndexBalanceReport();
  if (balance) {
    rows.push(
      row("entityType_counts", "pass", formatCountMap(balance.byEntityType)),
    );
    rows.push(row("source_counts", "pass", formatCountMap(balance.bySource)));
    rows.push(
      row(
        "practiceAreaSlug_counts",
        "pass",
        formatCountMap(balance.byPracticeAreaSlug),
      ),
    );
    rows.push(
      row("funding_route_counts", "pass", formatCountMap(balance.byFundingRoute)),
    );
    rows.push(
      row(
        "family_by_source",
        "pass",
        formatCountMap(balance.familyBySource),
      ),
    );
    rows.push(
      row(
        "family_private_sra_curated",
        balance.familyPrivateFacingCount > 0 ? "pass" : "warn",
        balance.familyPrivateFacingCount > 0
          ? `${balance.familyPrivateFacingCount} private/SRA/curated family entities`
          : "No private/SRA family entities indexed; results may skew toward legal aid.",
      ),
    );
    rows.push(
      row(
        "family_sra_count",
        balance.familySraCount > 0 ? "pass" : "warn",
        `SRA family docs: ${balance.familySraCount}`,
      ),
    );
    rows.push(
      row(
        "immigration_sra_count",
        (balance.sraByPracticeAreaSlug.immigration ?? 0) > 0 ? "pass" : "warn",
        `SRA immigration docs: ${balance.sraByPracticeAreaSlug.immigration ?? 0}`,
      ),
    );
    rows.push(
      row(
        "employment_sra_count",
        (balance.sraByPracticeAreaSlug.employment ?? 0) > 0 ? "pass" : "warn",
        `SRA employment docs: ${balance.sraByPracticeAreaSlug.employment ?? 0}`,
      ),
    );
    rows.push(
      row(
        "housing_sra_count",
        (balance.sraByPracticeAreaSlug.housing ?? 0) > 0 ? "pass" : "warn",
        `SRA housing docs: ${balance.sraByPracticeAreaSlug.housing ?? 0}`,
      ),
    );
    rows.push(
      row(
        "criminal_sra_count",
        (balance.sraByPracticeAreaSlug.criminal_defence ?? 0) > 0 ? "pass" : "warn",
        `SRA criminal_defence docs: ${balance.sraByPracticeAreaSlug.criminal_defence ?? 0}`,
      ),
    );
    rows.push(
      row(
        "prison_sra_count",
        (balance.sraByPracticeAreaSlug.prison_law ?? 0) > 0 ? "pass" : "warn",
        `SRA prison_law docs: ${balance.sraByPracticeAreaSlug.prison_law ?? 0}`,
      ),
    );
    if (balance.sraProjectionSamples.length > 0) {
      const sampleLine = balance.sraProjectionSamples
        .slice(0, 3)
        .map(
          (s) =>
            `${s.title.slice(0, 40)} [${s.practiceAreaSlugs.join(",")}]${s.sraProjectionConfidence != null ? ` conf=${s.sraProjectionConfidence}` : ""}`,
        )
        .join("; ");
      rows.push(row("sra_projection_samples", "pass", sampleLine));
    }
    if (balance.sraProjectionConfidenceRange) {
      rows.push(
        row(
          "sra_projection_confidence",
          "pass",
          `range ${balance.sraProjectionConfidenceRange.min}–${balance.sraProjectionConfidenceRange.max}`,
        ),
      );
    }
    rows.push(
      row(
        "family_divorce_private",
        balance.familyDivorcePrivateCount > 0 ? "pass" : "warn",
        `family/divorce private-facing: ${balance.familyDivorcePrivateCount}`,
      ),
    );
    rows.push(
      row(
        "legal_aid_only_areas",
        balance.legalAidOnlySlugCount > 0 ? "warn" : "pass",
        `${balance.legalAidOnlySlugCount} practice areas with legal aid only (no private/SRA)`,
      ),
    );
  } else {
    rows.push(row("index_balance", "warn", "could not collect balance diagnostics"));
  }

  const ok = rows.every((r) => r.status !== "fail");
  return { ok, rows, balance: balance ?? undefined };
}

export function formatVerifyReportTable(report: IndexVerifyReport): string {
  const w = Math.max(28, ...report.rows.map((r) => r.check.length));
  const lines = [
    `${"CHECK".padEnd(w)}  STATUS   DETAIL`,
    "-".repeat(w + 40),
    ...report.rows.map(
      (r) => `${r.check.padEnd(w)}  ${r.status.padEnd(7)}  ${r.detail}`,
    ),
  ];
  lines.push("");
  lines.push(report.ok ? "Overall: PASS" : "Overall: FAIL (see failed rows)");
  return lines.join("\n");
}
