import { prisma } from "@/lib/db/prisma";
import { applyProviderIntelligence, loadEnrichmentCache } from "@/lib/search-index/apply-provider-intelligence";
import { sraOrganisationToDocument } from "@/lib/search-index/build-legal-entity-doc";
import { enrichLegalEntityForIndex } from "@/lib/search-index/enrich-legal-entity-index";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";
import type {
  CoverageDataSources,
  CoverageHealth,
  CoverageLoadContext,
} from "@/lib/provider-enrichment-ladder/coverage-report-types";

export const COVERAGE_SRA_MIN_WARN_ROWS = 1000;

export type { CoverageDataSourceStatus, CoverageDataSources, CoverageHealth } from "@/lib/provider-enrichment-ladder/coverage-report-types";

export type CoverageLoadResult = CoverageLoadContext & {
  docs: LegalEntityDocument[];
  enrichmentByEntity: Map<string, ProviderEnrichment[]>;
};

import {
  formatCoverageDatasourceError,
  warnCoverageDatasourceUnavailable,
  resetCoverageDatasourceWarnDedupe,
} from "@/lib/provider-enrichment-ladder/coverage-report-log";

export { warnCoverageDatasourceUnavailable, resetCoverageDatasourceWarnDedupe };

function enrichmentFromRow(row: {
  id: string;
  entityId: string;
  entityType: string;
  fieldName: string;
  extractedValue: string;
  confidence: number;
  sourceUrl: string | null;
  sourceType: string;
  extractionMethod: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): ProviderEnrichment {
  return {
    id: row.id,
    entityId: row.entityId,
    entityType: row.entityType,
    fieldName: row.fieldName,
    extractedValue: row.extractedValue,
    confidence: row.confidence,
    sourceUrl: row.sourceUrl ?? undefined,
    sourceType: row.sourceType as ProviderEnrichment["sourceType"],
    extractionMethod: row.extractionMethod as ProviderEnrichment["extractionMethod"],
    status: row.status as ProviderEnrichment["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function buildEnrichmentMapFromRows(rows: ProviderEnrichment[]): Map<string, ProviderEnrichment[]> {
  const map = new Map<string, ProviderEnrichment[]>();
  for (const row of rows) {
    const list = map.get(row.entityId) ?? [];
    if (!list.some((x) => x.id === row.id)) list.push(row);
    map.set(row.entityId, list);
  }
  return map;
}

async function safeTableCount(
  label: "sraOrganisation" | "providerEnrichment",
  fn: () => Promise<number>,
): Promise<number | null> {
  try {
    return await fn();
  } catch (e) {
    warnCoverageDatasourceUnavailable(`${label}.count`, e);
    return null;
  }
}

export async function loadSraOrganisationRowsForCoverage(
  take = 50_000,
): Promise<{ ok: boolean; rows: Awaited<ReturnType<typeof prisma.sraOrganisation.findMany>>; error?: string }> {
  try {
    const rows = await prisma.sraOrganisation.findMany({ take });
    return { ok: true, rows };
  } catch (e) {
    warnCoverageDatasourceUnavailable("sraOrganisation", e);
    return { ok: false, rows: [], error: formatCoverageDatasourceError(e) };
  }
}

export async function loadProviderEnrichmentRowsForCoverage(): Promise<{
  ok: boolean;
  rows: ProviderEnrichment[];
  error?: string;
}> {
  try {
    const rows = await prisma.providerEnrichment.findMany({
      where: { status: { in: ["approved", "auto_approved", "pending_review"] } },
    });
    return { ok: true, rows: rows.map(enrichmentFromRow) };
  } catch (e) {
    warnCoverageDatasourceUnavailable("providerEnrichment", e);
    return { ok: false, rows: [], error: formatCoverageDatasourceError(e) };
  }
}

async function buildIndexDocumentsFromSraRows(
  rows: Awaited<ReturnType<typeof prisma.sraOrganisation.findMany>>,
): Promise<LegalEntityDocument[]> {
  await loadEnrichmentCache();
  const docs: LegalEntityDocument[] = [];
  for (const org of rows) {
    const base = await sraOrganisationToDocument(org, { skipGeo: true });
    const intel = await applyProviderIntelligence(base);
    docs.push(enrichLegalEntityForIndex(intel));
  }
  return docs;
}

export async function loadCoverageReportInputs(opts?: {
  take?: number;
}): Promise<CoverageLoadResult> {
  const take = opts?.take ?? 50_000;
  const warnings: string[] = [];

  const sraLoad = await loadSraOrganisationRowsForCoverage(take);
  const enrichmentLoad = await loadProviderEnrichmentRowsForCoverage();

  const dataSources: CoverageDataSources = {
    sraOrganisations: {
      ok: sraLoad.ok,
      rowsLoaded: sraLoad.rows.length,
      error: sraLoad.error,
    },
    providerEnrichments: {
      ok: enrichmentLoad.ok,
      rowsLoaded: enrichmentLoad.rows.length,
      error: enrichmentLoad.error,
    },
  };

  const expectedSraRows = sraLoad.ok
    ? await safeTableCount("sraOrganisation", () => prisma.sraOrganisation.count())
    : null;
  const expectedEnrichmentRows = enrichmentLoad.ok
    ? await safeTableCount("providerEnrichment", () => prisma.providerEnrichment.count())
    : null;

  const loadedSraRows = sraLoad.rows.length;
  const loadedEnrichmentRows = enrichmentLoad.rows.length;

  if (sraLoad.ok && loadedSraRows === 0) {
    warnings.push("loadedSraRows is 0 (empty catalogue)");
  } else if (sraLoad.ok && loadedSraRows < COVERAGE_SRA_MIN_WARN_ROWS) {
    warnings.push(
      `loadedSraRows (${loadedSraRows}) is below sanity threshold (${COVERAGE_SRA_MIN_WARN_ROWS})`,
    );
  }
  if (!sraLoad.ok) {
    warnings.push("sraOrganisation unavailable — contact and weak metrics not computed");
  }
  if (!enrichmentLoad.ok) {
    warnings.push("providerEnrichment unavailable — enrichment-assisted contact counts may be understated");
  }

  const docs = sraLoad.ok ? await buildIndexDocumentsFromSraRows(sraLoad.rows) : [];
  const enrichmentByEntity = buildEnrichmentMapFromRows(enrichmentLoad.rows);

  return {
    docs,
    enrichmentByEntity,
    dataSources,
    health: {
      expectedSraRows,
      loadedSraRows,
      expectedEnrichmentRows,
      loadedEnrichmentRows,
      warnings,
    },
    sraAvailable: sraLoad.ok,
    enrichmentsAvailable: enrichmentLoad.ok,
  };
}
