import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { reportDir, tryReadJson } from "./lib.mjs";

function summary(report, uploadOutcome) {
  const lines = [];
  lines.push(`# Security scan: ${report.conclusion}`);
  lines.push("");
  if (report.conclusion === "clean") {
    lines.push("No high or critical findings were recorded in the required checks that finished. This is not a statement that every possible check ran.");
  } else if (report.conclusion === "findings") {
    lines.push("High or critical findings were recorded. This is not a clean result.");
  } else {
    lines.push("The scan is incomplete. This is not a clean result.");
    if (report.highOrCriticalCount > 0) {
      lines.push(`Checks that did finish recorded ${report.highOrCriticalCount} high or critical findings.`);
    }
  }
  lines.push("");
  lines.push(`Report stored: ${report.reportStored === true ? "yes, encrypted artifact" : "no"}`);
  if (uploadOutcome && uploadOutcome !== "success" && uploadOutcome !== "skipped") {
    lines.push(`Artifact upload outcome: ${uploadOutcome}`);
  }
  lines.push("");
  lines.push("| Scanner | Status |");
  lines.push("| --- | --- |");
  for (const [name, status] of Object.entries(report.scanners || {})) {
    lines.push(`| ${name} | ${status} |`);
  }
  lines.push("");
  lines.push("## Coverage gaps");
  lines.push("");
  for (const gap of report.coverageGaps || []) {
    lines.push(`- **${gap.item}.** ${gap.detail}`);
  }
  lines.push("");
  const highs = (report.findings || []).filter((item) => item.severity === "high" || item.severity === "critical");
  lines.push(`## High and critical findings (${highs.length})`);
  lines.push("");
  const shown = highs.slice(0, 30);
  if (shown.length === 0) lines.push("None recorded.");
  for (const item of shown) {
    const where = item.location?.url
      || (item.location?.file ? `${item.location.file}${item.location.line ? `:${item.location.line}` : ""}` : "unspecified");
    lines.push(`- **${item.severity}** ${item.scanner}: ${item.title} (${where})`);
  }
  if (highs.length > shown.length) {
    lines.push(`- ${highs.length - shown.length} more are in the encrypted report.`);
  }
  if (report.unspecifiedCount > 0) {
    lines.push("");
    lines.push(`${report.unspecifiedCount} findings had no severity. They are in the encrypted report and were not treated as high. They are also not a clean result for those items.`);
  }
  lines.push("");
  lines.push("Evidence and suggested fixes are in the encrypted artifact only.");
  return lines.join("\n");
}

function main() {
  const dir = process.env.REPORT_DIR;
  const uploadOutcome = process.env.UPLOAD_OUTCOME || "";
  if (!dir || !fs.existsSync(path.join(dir, "report.json"))) {
    const text = [
      "# Security scan: incomplete",
      "",
      "No report was written. This is not a clean result.",
      uploadOutcome ? `Artifact upload outcome: ${uploadOutcome}` : "",
    ].filter(Boolean).join("\n");
    writeSummary(text);
    console.error("Scan incomplete: report.json was not written. This is not a clean result.");
    process.exit(1);
  }

  const report = tryReadJson(path.join(dir, "report.json"));
  if (!report?.conclusion) {
    writeSummary("# Security scan: incomplete\n\nThe report file could not be read. This is not a clean result.");
    console.error("Scan incomplete: report.json could not be read. This is not a clean result.");
    process.exit(1);
  }

  if (uploadOutcome === "failure") {
    report.reportStored = false;
    if (report.conclusion === "clean") report.conclusion = "incomplete";
    report.coverageGaps = report.coverageGaps || [];
    report.coverageGaps.push({
      item: "Artifact upload",
      detail: "The encrypted report was not uploaded. This is not a clean result.",
    });
  }

  writeSummary(summary(report, uploadOutcome));

  if (report.conclusion === "findings") {
    console.error("High or critical findings. This is not a clean result.");
    process.exit(1);
  }
  if (report.conclusion === "incomplete") {
    console.error("Scan incomplete. This is not a clean result.");
    process.exit(1);
  }
  if (report.conclusion !== "clean") {
    console.error(`Unexpected conclusion ${report.conclusion}. This is not a clean result.`);
    process.exit(1);
  }
  console.log("No high or critical findings in the checks that finished. Coverage gaps are in the job summary.");
}

function writeSummary(text) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) fs.appendFileSync(file, `${text}\n`);
  else console.log(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    reportDir();
  } catch {
    // enforce handles a missing REPORT_DIR itself
  }
  main();
}
