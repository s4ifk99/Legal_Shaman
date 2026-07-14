import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LegalKnowledgeEvalCaseResult, LegalKnowledgeEvalReport } from "./types";

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function formatConsoleSummary(report: LegalKnowledgeEvalReport): string {
  const { aggregate: a } = report;
  const lines: string[] = [
    "",
    `=== Legal Knowledge Eval Summary (${report.tier}) ===`,
    `Cases: ${a.caseCount}  Passed: ${a.passedCount}  Failed: ${a.failedCount}`,
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Intent taxonomy accuracy | ${pct(a.intentTaxonomyAccuracy)} |`,
    `| Source topical P@3 | ${a.sourcePrecisionAt3.toFixed(3)} |`,
    `| Directory topical P@K | ${a.directoryPrecisionAtK.toFixed(3)} |`,
    `| Forbidden violation rate | ${pct(a.forbiddenViolationRate)} |`,
    `| Answer safety pass rate | ${pct(a.answerSafetyPassRate)} |`,
    "",
    `Pass criteria met: ${a.passCriteriaMet ? "YES" : "NO"}`,
    "",
  ];

  const failures = report.results.filter((r) => !r.passed);
  if (failures.length) {
    lines.push(`=== Failing cases (${failures.length}) ===`);
    for (const r of failures) {
      lines.push("");
      lines.push(formatCaseFailureLine(r));
    }
  }

  return lines.join("\n");
}

function formatCaseFailureLine(r: LegalKnowledgeEvalCaseResult): string {
  const parts = [
    `[${r.caseId}] "${r.query}" (${r.tier})`,
    `  Failures: ${r.failures.join("; ")}`,
  ];
  if (r.taxonomySlug != null) parts.push(`  Taxonomy: ${r.taxonomySlug}`);
  if (r.sourcePrecisionAt3 != null) {
    parts.push(`  Source P@3: ${r.sourcePrecisionAt3.toFixed(2)} (${r.relevantSourcesInTop3 ?? 0} relevant)`);
  }
  if (r.directoryPrecisionAtK != null) {
    parts.push(
      `  Directory P@K: ${r.directoryPrecisionAtK.toFixed(2)} (${r.relevantDirectoryInTopK ?? 0} relevant)`,
    );
  }
  if (r.confidence != null) {
    parts.push(`  Confidence: ${r.confidence} sources=${r.sourceCount} directory=${r.directoryCount}`);
  }
  if (r.intentSignals?.length) {
    parts.push(`  Intent signals: ${r.intentSignals.slice(0, 6).join(", ")}`);
  }
  return parts.join("\n");
}

export function formatMarkdownReport(report: LegalKnowledgeEvalReport): string {
  const { aggregate: a } = report;
  const failures = report.results.filter((r) => !r.passed);

  const md: string[] = [
    "# Legal Knowledge Evaluation Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Tier: ${report.tier}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Cases | ${a.caseCount} |`,
    `| Passed | ${a.passedCount} |`,
    `| Failed | ${a.failedCount} |`,
    `| Intent taxonomy accuracy | ${pct(a.intentTaxonomyAccuracy)} |`,
    `| Source topical P@3 | ${a.sourcePrecisionAt3.toFixed(3)} |`,
    `| Directory topical P@K | ${a.directoryPrecisionAtK.toFixed(3)} |`,
    `| Forbidden violation rate | ${pct(a.forbiddenViolationRate)} |`,
    `| Answer safety | ${pct(a.answerSafetyPassRate)} |`,
    "",
    `**Pass criteria met:** ${a.passCriteriaMet ? "Yes" : "No"}`,
    "",
  ];

  if (failures.length) {
    md.push("## Failing cases", "");
    for (const r of failures) {
      md.push(`### ${r.caseId} (${r.tier})`, "");
      md.push(`- **Query:** ${r.query}`);
      md.push(`- **Failures:** ${r.failures.join("; ")}`);
      if (r.taxonomySlug != null) md.push(`- **Taxonomy:** ${r.taxonomySlug}`);
      if (r.sourcePrecisionAt3 != null) {
        md.push(`- **Source P@3:** ${r.sourcePrecisionAt3.toFixed(2)}`);
      }
      md.push("");
    }
  }

  md.push(
    "## All cases",
    "",
    "| ID | Tier | Query | Pass | Taxonomy | Source P@3 |",
    "|----|------|-------|------|----------|------------|",
  );
  for (const r of report.results) {
    md.push(
      `| ${r.caseId} | ${r.tier} | ${r.query.replace(/\|/g, "\\|").slice(0, 60)} | ${r.passed ? "✓" : "✗"} | ${r.taxonomySlug ?? "—"} | ${r.sourcePrecisionAt3?.toFixed(2) ?? "—"} |`,
    );
  }

  return md.join("\n");
}

export async function writeLegalKnowledgeEvalReports(
  report: LegalKnowledgeEvalReport,
  reportsDir: string,
): Promise<{ jsonPath: string; mdPath: string }> {
  await mkdir(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, "legal-knowledge-eval.json");
  const mdPath = path.join(reportsDir, "legal-knowledge-eval.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, formatMarkdownReport(report), "utf8");
  return { jsonPath, mdPath };
}
