/**
 * Provider coverage / enrichment ladder report.
 * Usage: npm run providers:coverage-report
 */
import "./load-dotenv";

import { buildCoverageLadderReport } from "@/lib/provider-enrichment-ladder/coverage-report";
import { validateCoverageReport } from "@/lib/provider-enrichment-ladder/coverage-report-validate";
import { loadCoverageReportInputs } from "@/lib/provider-enrichment-ladder/coverage-report-datasources";

async function main() {
  const inputs = await loadCoverageReportInputs();
  const report = await buildCoverageLadderReport(
    inputs.docs,
    inputs.enrichmentByEntity,
    inputs,
  );
  const validation = validateCoverageReport(report, inputs);

  console.info(JSON.stringify({ event: "providers_coverage_report", ...report }, null, 2));

  for (const w of validation.warnings) {
    console.warn(JSON.stringify({ event: "coverage_report_warning", message: w }));
  }

  if (!validation.ok) {
    console.error("COVERAGE REPORT INCOMPLETE");
    for (const m of validation.messages) {
      console.error(JSON.stringify({ event: "coverage_report_invalid", reason: m }));
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("COVERAGE REPORT INCOMPLETE");
  console.error(
    JSON.stringify({
      event: "coverage_report_fatal",
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  process.exit(1);
});
