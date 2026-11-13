import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function finalDecision({ report, encryptionStatus, uploadOutcome, requireArtifact }) {
  if (!report) {
    return {
      conclusion: "incomplete",
      exitCode: 1,
      lines: [
        "SECURITY_SCAN_CONCLUSION=incomplete",
        "The security report was not written. This is not a clean result.",
      ],
    };
  }
  const artifactMissing =
    requireArtifact && (encryptionStatus !== "true" || uploadOutcome !== "success");
  if (artifactMissing) {
    return {
      conclusion: "incomplete",
      exitCode: 1,
      lines: [
        "SECURITY_SCAN_CONCLUSION=incomplete",
        `Report conclusion was ${report.conclusion}. The encrypted artifact was not stored (encryption=${encryptionStatus || "missing"}, upload=${uploadOutcome || "missing"}). This is not a clean result.`,
        report.conclusionReason,
      ],
    };
  }
  return {
    conclusion: report.conclusion,
    exitCode: report.conclusion === "clean" ? 0 : 1,
    lines: [`SECURITY_SCAN_CONCLUSION=${report.conclusion}`, report.conclusionReason],
  };
}

function isCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCli()) {
  const reportPath = process.argv[2] || path.join(process.env.OUT_DIR || "out", "security-report.json");
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, "utf8")) : null;
  const decision = finalDecision({
    report,
    encryptionStatus: process.env.ENCRYPTION_STATUS,
    uploadOutcome: process.env.UPLOAD_OUTCOME,
    requireArtifact: process.env.REQUIRE_ENCRYPTED_ARTIFACT === "true",
  });
  const text = decision.lines.join("\n");
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  }
  process.exit(decision.exitCode);
}
