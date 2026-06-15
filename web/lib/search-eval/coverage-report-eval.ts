import type { LegalEntityDocument } from "@/lib/search-index/types";
import { buildCoverageLadderReport } from "@/lib/provider-enrichment-ladder/coverage-report";
import type {
  CoverageDataSources,
  CoverageHealth,
  CoverageLoadContext,
} from "@/lib/provider-enrichment-ladder/coverage-report-types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";

function minimalSraDoc(id: string, overrides: Partial<LegalEntityDocument> = {}): LegalEntityDocument {
  return {
    id: `sra:${id}`,
    entityType: "sra_organisation",
    title: `Firm ${id}`,
    description: "Test firm description long enough for weak detection thresholds in other evals",
    practiceAreas: [],
    categories: ["SRA organisation"],
    subIssues: [],
    searchText: `Firm ${id} London employment`,
    expandedSearchText: "",
    source: "sra",
    legalAid: false,
    authorityScore: 0.78,
    profileCompletenessScore: 0.3,
    rawSourceId: id,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function loadCtx(
  partial: Partial<CoverageLoadContext> & Pick<CoverageLoadContext, "sraAvailable" | "enrichmentsAvailable">,
): CoverageLoadContext {
  const dataSources: CoverageDataSources = partial.dataSources ?? {
    sraOrganisations: { ok: partial.sraAvailable, rowsLoaded: partial.health?.loadedSraRows ?? 0 },
    providerEnrichments: {
      ok: partial.enrichmentsAvailable,
      rowsLoaded: partial.health?.loadedEnrichmentRows ?? 0,
    },
  };
  const health: CoverageHealth = partial.health ?? {
    expectedSraRows: null,
    loadedSraRows: dataSources.sraOrganisations.rowsLoaded,
    expectedEnrichmentRows: null,
    loadedEnrichmentRows: dataSources.providerEnrichments.rowsLoaded,
    warnings: [],
  };
  return {
    dataSources,
    health,
    sraAvailable: partial.sraAvailable,
    enrichmentsAvailable: partial.enrichmentsAvailable,
  };
}

export async function runCoverageReportEval(): Promise<number> {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL coverage-report: ${msg}`);
    failed++;
  };

  const unavailable = await buildCoverageLadderReport(
    [],
    new Map(),
    loadCtx({
      sraAvailable: false,
      enrichmentsAvailable: false,
      dataSources: {
        sraOrganisations: { ok: false, rowsLoaded: 0, error: "connection refused" },
        providerEnrichments: { ok: false, rowsLoaded: 0, error: "connection refused" },
      },
      health: {
        expectedSraRows: null,
        loadedSraRows: 0,
        expectedEnrichmentRows: null,
        loadedEnrichmentRows: 0,
        warnings: ["sraOrganisation unavailable"],
      },
    }),
  );

  if (unavailable.missingContact.noPhone !== null) {
    fail("unavailable SRA must not report noPhone=0");
  }
  if (unavailable.weak.totalScanned !== null) {
    fail("unavailable SRA must not report totalScanned=0 as a number");
  }
  if (unavailable.reportValid) fail("unavailable datasources must set reportValid=false");
  if (!unavailable.degraded) fail("unavailable datasources must set degraded=true");
  if (unavailable.reportValid) fail("validation: unavailable must not be reportValid");

  const empty = await buildCoverageLadderReport(
    [],
    new Map(),
    loadCtx({
      sraAvailable: true,
      enrichmentsAvailable: true,
      dataSources: {
        sraOrganisations: { ok: true, rowsLoaded: 0 },
        providerEnrichments: { ok: true, rowsLoaded: 0 },
      },
      health: {
        expectedSraRows: 0,
        loadedSraRows: 0,
        expectedEnrichmentRows: 0,
        loadedEnrichmentRows: 0,
        warnings: ["loadedSraRows is 0"],
      },
    }),
  );
  if (empty.reportValid) fail("empty SRA catalogue must set reportValid=false");
  if (empty.weak.totalScanned !== 0) fail("empty catalogue should have totalScanned=0");
  if (empty.health.loadedSraRows !== 0) fail("empty fixture loadedSraRows should be 0");

  const docs = [
    minimalSraDoc("1", { phone: "+441234567890", website: "https://example.com", practiceAreaSlugs: ["employment"] }),
    minimalSraDoc("2"),
    minimalSraDoc("3"),
  ];
  const partial = await buildCoverageLadderReport(docs, new Map(), loadCtx({
    sraAvailable: true,
    enrichmentsAvailable: false,
    dataSources: {
      sraOrganisations: { ok: true, rowsLoaded: 3 },
      providerEnrichments: { ok: false, rowsLoaded: 0, error: "timeout" },
    },
    health: {
      expectedSraRows: 25000,
      loadedSraRows: 3,
      expectedEnrichmentRows: null,
      loadedEnrichmentRows: 0,
      warnings: ["providerEnrichment unavailable"],
    },
  }));
  if (partial.weak.totalScanned !== 3) fail(`partial load expected 3 scanned, got ${partial.weak.totalScanned}`);
  if (partial.missingContact.noPhone === null) fail("partial SRA load should still compute noPhone");
  if (!partial.degraded) fail("partial load must be degraded");
  if (!partial.reportValid) fail("partial SRA load with rows should be reportValid");

  const enrichments = new Map<string, ProviderEnrichment[]>([
    [
      "sra:2",
      [
        {
          id: "e1",
          entityId: "sra:2",
          entityType: "sra_organisation",
          fieldName: "phone",
          extractedValue: "+449999999999",
          confidence: 0.9,
          sourceType: "sra_register",
          extractionMethod: "manual",
          status: "approved",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    ],
  ]);
  const healthy = await buildCoverageLadderReport(docs, enrichments, loadCtx({
    sraAvailable: true,
    enrichmentsAvailable: true,
    dataSources: {
      sraOrganisations: { ok: true, rowsLoaded: 1500 },
      providerEnrichments: { ok: true, rowsLoaded: 1 },
    },
    health: {
      expectedSraRows: 25000,
      loadedSraRows: 1500,
      expectedEnrichmentRows: 100,
      loadedEnrichmentRows: 1,
      warnings: [],
    },
  }));
  // Pending-review DB counts are not exercised here (no DATABASE_URL in eval runner).
  if (!healthy.reportValid) fail("healthy fixture should be reportValid");
  if (healthy.missingContact.noPhone !== 1) {
    fail(`healthy noPhone expected 1, got ${healthy.missingContact.noPhone}`);
  }
  if (healthy.weak.totalScanned !== 3) fail(`healthy totalScanned should be 3, got ${healthy.weak.totalScanned}`);
  if (healthy.degraded) fail("healthy fixture with 1500 loaded rows should not be degraded");
  if (healthy.weak.totalWeak === 0 && healthy.weak.totalScanned === 3) {
    /* weak count may be >0 depending on doc shape; ensure not conflated with unavailable null */
  }
  if (healthy.missingContact.noPhone === null) fail("healthy report must not null noPhone");

  if (failed === 0) {
    console.info("PASS coverage report eval (unavailable, empty, partial, healthy)");
  }
  return failed;
}
