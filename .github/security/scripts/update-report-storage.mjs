import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const stored = process.argv[2] === "true";
const note = process.argv.slice(3).join(" ").trim();
const dir = process.env.REPORT_DIR;
if (!dir) {
  console.error("REPORT_DIR is not set");
  process.exit(1);
}
const file = path.join(dir, "report.json");
const report = JSON.parse(fs.readFileSync(file, "utf8"));
report.reportStored = stored;
if (!stored) {
  report.coverageGaps = report.coverageGaps || [];
  report.coverageGaps.push({
    item: "Private report",
    detail: note || "The encrypted artifact was not stored. Plaintext was not uploaded.",
  });
  if (report.conclusion === "clean") report.conclusion = "incomplete";
}
fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
const markdown = fs.existsSync(path.join(dir, "report.md"))
  ? fs.readFileSync(path.join(dir, "report.md"), "utf8")
  : "";
const banner = stored
  ? "Report storage: encrypted artifact.\n\n"
  : `Report storage: not stored. ${note}\n\n`;
fs.writeFileSync(path.join(dir, "report.md"), banner + markdown.replace(/^Report storage:.*\n\n/, ""));
console.log(stored ? "Report marked stored." : `Report not stored. Conclusion: ${report.conclusion}.`);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // script entry
}
