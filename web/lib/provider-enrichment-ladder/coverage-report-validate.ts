import type { CoverageLoadContext } from "@/lib/provider-enrichment-ladder/coverage-report-types";
import type { ProviderCoverageLadderReport } from "@/lib/provider-enrichment-ladder/coverage-report";

const COVERAGE_SRA_MIN_WARN_ROWS = 1000;

export type CoverageReportValidation = {
  ok: boolean;
  reportValid: boolean;
  degraded: boolean;
  exitCode: number;
  messages: string[];
  warnings: string[];
};

export function validateCoverageReport(
  report: ProviderCoverageLadderReport,
  load?: Pick<CoverageLoadContext, "health" | "sraAvailable" | "enrichmentsAvailable">,
): CoverageReportValidation {
  const messages: string[] = [];
  const warnings = [...(load?.health.warnings ?? report.health.warnings)];

  if (!load?.sraAvailable) {
    messages.push("critical datasource sraOrganisation unavailable");
  }
  if (load?.health.loadedSraRows === 0) {
    messages.push("loadedSraRows is 0");
  }
  if (!report.reportValid) {
    messages.push("report marked invalid");
  }

  if (load?.sraAvailable && load.health.loadedSraRows > 0 && load.health.loadedSraRows < COVERAGE_SRA_MIN_WARN_ROWS) {
    warnings.push(
      `loadedSraRows (${load.health.loadedSraRows}) < ${COVERAGE_SRA_MIN_WARN_ROWS}`,
    );
  }
  if (load && !load.enrichmentsAvailable) {
    warnings.push("providerEnrichment unavailable (degraded)");
  }

  const criticalFailure = !load?.sraAvailable || load.health.loadedSraRows === 0;
  const ok = !criticalFailure && report.reportValid;

  return {
    ok,
    reportValid: report.reportValid,
    degraded: report.degraded,
    exitCode: ok ? 0 : 1,
    messages,
    warnings,
  };
}

export function applyHealthSanityFlags(
  health: CoverageLoadContext["health"],
  sraAvailable: boolean,
): CoverageLoadContext["health"] {
  const warnings = [...health.warnings];
  if (sraAvailable && health.loadedSraRows === 0) {
    warnings.push("FAIL: loadedSraRows is 0");
  } else if (sraAvailable && health.loadedSraRows < COVERAGE_SRA_MIN_WARN_ROWS) {
    warnings.push(`WARN: loadedSraRows (${health.loadedSraRows}) < ${COVERAGE_SRA_MIN_WARN_ROWS}`);
  }
  return { ...health, warnings };
}
