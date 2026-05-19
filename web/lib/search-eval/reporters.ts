import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SearchEvalCaseResult, SearchEvalReport } from "@/lib/search-eval/types";

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatHitLine(h: SearchEvalCaseResult["hits"][number]): string {
  const rel = h.relevant ? "✓" : "✗";
  const reasons = h.relevanceReasons.length ? ` [${h.relevanceReasons.join(", ")}]` : "";
  return `  ${h.rank}. ${rel} ${h.title} (${h.source})${reasons}`;
}

export function formatConsoleSummary(report: SearchEvalReport): string {
  const { aggregate: a } = report;
  const lines: string[] = [
    "",
    "=== Search RAG Eval Summary ===",
    `Cases: ${a.caseCount}  Passed: ${a.passedCount}  Failed: ${a.failedCount}`,
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Taxonomy accuracy | ${pct(a.taxonomyAccuracy)} |`,
    `| Clarification accuracy | ${pct(a.clarificationAccuracy)} |`,
    `| No-result failure rate (mustReturn) | ${pct(a.noResultFailureRate)} |`,
    `| Avg Precision@K | ${a.avgPrecisionAtK.toFixed(3)} |`,
    `| Avg Recall@K | ${a.avgRecallAtK.toFixed(3)} |`,
    `| Avg MRR | ${a.avgMrr.toFixed(3)} |`,
    `| Avg NDCG-lite@K | ${a.avgNdcgAtK.toFixed(3)} |`,
    `| Map marker availability | ${pct(a.mapMarkerAvailabilityRate)} |`,
    `| Explanation safety pass rate | ${pct(a.explanationSafetyPassRate)} |`,
    "",
    `Pass criteria met: ${a.passCriteriaMet ? "YES" : "NO"}`,
    `  (taxonomy ≥ ${pct(report.passCriteria.taxonomyAccuracyMin)},`,
    `   no-result ≤ ${pct(report.passCriteria.noResultFailureRateMax)},`,
    `   explanation safety = ${pct(report.passCriteria.explanationSafetyPassRateMin)})`,
    "",
  ];

  const failures = report.results.filter((r) => !r.passed);
  if (failures.length) {
    lines.push(`=== Failing cases (${failures.length}) ===`);
    for (const r of failures) {
      lines.push("");
      lines.push(`[${r.caseId}] "${r.query}" (${r.channel})`);
      lines.push(`  Failures: ${r.failures.join("; ")}`);
      lines.push(
        `  Parsed taxonomy: ${r.taxonomySlug ?? "—"}  Results: ${r.resultCount}  Relevant@${r.hits.length}: ${r.relevantInTopK}`,
      );
      if (r.parsedQuery) {
        lines.push(
          `  Parsed: intent=${r.parsedQuery.intent} confidence=${r.parsedQuery.queryConfidence ?? "—"} semantic="${r.parsedQuery.semanticQuery.slice(0, 60)}"`,
        );
      }
      if (r.searchDebug) {
        lines.push(
          `  Debug: engine=${r.searchDebug.activeSearchEngine ?? "—"} fallback=${r.searchDebug.fallbackTriggered ?? false} initial=${r.searchDebug.initialTypesenseHitCount ?? "—"} final=${r.searchDebug.finalHitCount ?? "—"}`,
        );
        if (r.searchDebug.degradedModeWarnings?.length) {
          lines.push(`  Degraded: ${r.searchDebug.degradedModeWarnings.join(", ")}`);
        }
        if (r.degradedModes.length) {
          lines.push(`  Modes: ${r.degradedModes.join(", ")}`);
        }
      }
      if (r.fallbackTriggered) lines.push("  Fallback/rescue: triggered");
      if (r.hasRefinementPrompt) lines.push("  Refinement prompt: yes");
      if (r.hits.length) {
        lines.push("  Top retrieved:");
        for (const h of r.hits.slice(0, 5)) {
          lines.push(formatHitLine(h));
          if (h.scoreBreakdown) {
            const keys = Object.entries(h.scoreBreakdown)
              .filter(([, v]) => typeof v === "number" && v !== 0)
              .slice(0, 6)
              .map(([k, v]) => `${k}=${Number(v).toFixed(2)}`)
              .join(" ");
            if (keys) lines.push(`      scores: ${keys}`);
          }
          if (h.retrievalSources?.length) {
            lines.push(`      sources: ${h.retrievalSources.join(", ")}`);
          }
        }
      }
    }
  }

  return lines.join("\n");
}

export function formatMarkdownReport(report: SearchEvalReport): string {
  const { aggregate: a } = report;
  const failures = report.results.filter((r) => !r.passed);

  const md: string[] = [
    "# Search RAG Evaluation Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Cases | ${a.caseCount} |`,
    `| Passed | ${a.passedCount} |`,
    `| Failed | ${a.failedCount} |`,
    `| Taxonomy accuracy | ${pct(a.taxonomyAccuracy)} |`,
    `| Clarification accuracy | ${pct(a.clarificationAccuracy)} |`,
    `| No-result failure rate | ${pct(a.noResultFailureRate)} |`,
    `| Avg Precision@K | ${a.avgPrecisionAtK.toFixed(3)} |`,
    `| Avg Recall@K | ${a.avgRecallAtK.toFixed(3)} |`,
    `| Avg MRR | ${a.avgMrr.toFixed(3)} |`,
    `| Avg NDCG-lite@K | ${a.avgNdcgAtK.toFixed(3)} |`,
    `| Map marker availability | ${pct(a.mapMarkerAvailabilityRate)} |`,
    `| Explanation safety | ${pct(a.explanationSafetyPassRate)} |`,
    "",
    `**Pass criteria met:** ${a.passCriteriaMet ? "Yes" : "No"}`,
    "",
  ];

  if (failures.length) {
    md.push("## Failing cases", "");
    for (const r of failures) {
      md.push(`### ${r.caseId}`, "");
      md.push(`- **Query:** ${r.query}`);
      md.push(`- **Channel:** ${r.channel}`);
      md.push(`- **Failures:** ${r.failures.join("; ")}`);
      md.push(`- **Taxonomy:** ${r.taxonomySlug ?? "—"} (accurate: ${r.taxonomyAccurate})`);
      md.push(`- **Results:** ${r.resultCount} (relevant in top-K: ${r.relevantInTopK})`);
      md.push(
        `- **Metrics:** P@${r.hits.length}=${r.precisionAtK.toFixed(2)} R@${r.hits.length}=${r.recallAtK.toFixed(2)} MRR=${r.mrr.toFixed(2)} NDCG=${r.ndcgAtK.toFixed(2)}`,
      );
      if (r.searchDebug) {
        md.push(
          `- **Retrieval:** engine=${r.searchDebug.activeSearchEngine ?? "—"}, fallback=${r.fallbackTriggered}, degraded=${(r.searchDebug.degradedModeWarnings ?? r.degradedModes).join(", ") || "none"}`,
        );
      }
      if (r.hits.length) {
        md.push("", "| Rank | Relevant | Title | Source | Reasons |", "|------|----------|-------|--------|---------|");
        for (const h of r.hits.slice(0, 8)) {
          md.push(
            `| ${h.rank} | ${h.relevant ? "yes" : "no"} | ${h.title.replace(/\|/g, "\\|")} | ${h.source} | ${h.relevanceReasons.join(", ") || "—"} |`,
          );
        }
      }
      md.push("");
    }
  }

  md.push("## All cases", "", "| ID | Query | Pass | Taxonomy | Results | Relevant |", "|----|-------|------|----------|---------|----------|");
  for (const r of report.results) {
    md.push(
      `| ${r.caseId} | ${r.query.replace(/\|/g, "\\|")} | ${r.passed ? "✓" : "✗"} | ${r.taxonomySlug ?? "—"} | ${r.resultCount} | ${r.relevantInTopK} |`,
    );
  }

  return md.join("\n");
}

export async function writeSearchEvalReports(
  report: SearchEvalReport,
  reportsDir: string,
): Promise<{ jsonPath: string; mdPath: string }> {
  await mkdir(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, "search-eval-rag.json");
  const mdPath = path.join(reportsDir, "search-eval-rag.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, formatMarkdownReport(report), "utf8");
  return { jsonPath, mdPath };
}
