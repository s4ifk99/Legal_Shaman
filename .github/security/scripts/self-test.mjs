import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { decideConclusion, mapSeverityWord } from "./assemble-report.mjs";
import { runApplicationChecks } from "./application-checks.mjs";
import { repoRoot } from "./lib.mjs";
import { londonOffsetMinutes, shouldRunScheduledScan } from "./london-schedule-gate.mjs";
import { redactText } from "./redact.mjs";
import { assertSingleTarget, resolveTargetUrls } from "./resolve-scan-target.mjs";
import { sanitizeGitleaksDocument } from "./sanitize-gitleaks.mjs";
import { sanitizeSemgrepDocument } from "./sanitize-semgrep.mjs";

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const winter = new Date("2026-01-15T02:00:00Z");
assert(londonOffsetMinutes(winter) === 0, "January should be GMT");
assert(shouldRunScheduledScan(winter, "0 2 * * *").run === true, "GMT 02:00 UTC should run");
assert(shouldRunScheduledScan(winter, "0 1 * * *").run === false, "GMT 01:00 UTC should skip");

const summer = new Date("2026-07-01T01:00:00Z");
assert(londonOffsetMinutes(summer) === 60, "July should be BST");
assert(shouldRunScheduledScan(summer, "0 1 * * *").run === true, "BST 01:00 UTC should run");
assert(shouldRunScheduledScan(summer, "0 2 * * *").run === false, "BST 02:00 UTC should skip");

const afterChange = new Date("2026-10-27T02:00:00Z");
assert(londonOffsetMinutes(afterChange) === 0, "27 October 2026 should be GMT");
assert(shouldRunScheduledScan(afterChange, "0 2 * * *").run === true, "after the clock change, 02:00 UTC should run");
assert(shouldRunScheduledScan(afterChange, "0 1 * * *").run === false, "after the clock change, 01:00 UTC should skip");
assert(shouldRunScheduledScan(winter, "0 3 * * *").error, "unexpected hour should error");

const target = assertSingleTarget(resolveTargetUrls(repoRoot));
assert(target.ok && target.url === "https://www.legalshaman.com", "site URL did not resolve");

const sampleValue = "super" + "secretvalue";
const samplePrefix = ["sk", "live", "abcdefghijklmnopqrstuvwxyz"].join("_");
const redacted = redactText(`password=${sampleValue} Bearer ${samplePrefix}`);
assert(!redacted.includes(sampleValue), "password value leaked");
assert(!redacted.includes(samplePrefix), "prefixed secret leaked");
assert(redacted.includes("[REDACTED]"), "redaction marker missing");

const leaks = sanitizeGitleaksDocument([
  {
    Secret: sampleValue,
    Match: `API_KEY=${sampleValue}`,
    Line: `API_KEY=${sampleValue}`,
    File: "web/.env.example",
    RuleID: "generic-api-key",
    StartLine: 18,
    Extra: sampleValue,
  },
]);
const leakText = JSON.stringify(leaks);
assert(!leakText.includes(sampleValue), "gitleaks sanitize kept a secret");
assert(leaks[0].Secret === "[REDACTED]", "secret field not replaced");
assert(leaks[0].File === "web/.env.example", "file path dropped");

const semgrep = sanitizeSemgrepDocument({
  results: [
    {
      extra: {
        lines: `const key = '${samplePrefix}'`,
        message: `token=${sampleValue}`,
        metavars: { $X: { abstract_content: sampleValue } },
      },
    },
  ],
});
const semgrepText = JSON.stringify(semgrep);
assert(!semgrepText.includes(sampleValue), "semgrep sanitize kept a secret");
assert(!semgrepText.includes(samplePrefix), "semgrep sanitize kept a prefixed secret");

const cleanDecision = decideConclusion({
  statuses: {
    "npm-audit": "completed",
    "osv-scanner": "completed",
    gitleaks: "completed",
    semgrep: "completed",
    "zap-baseline": "completed",
    "application-checks": "completed",
  },
  findings: [{ severity: "low" }, { severity: "medium" }],
});
assert(mapSeverityWord("9.5") === "critical", "CVSS 9.5 should be critical");
assert(mapSeverityWord("7.5") === "high", "CVSS 7.5 should be high");
assert(mapSeverityWord("5.3") === "medium", "CVSS 5.3 should be medium");
assert(mapSeverityWord("") === "unspecified", "blank severity should stay unspecified");
assert(cleanDecision.conclusion === "clean", "low findings should not fail the gate");

const findingDecision = decideConclusion({
  statuses: cleanDecision && {
    "npm-audit": "completed",
    "osv-scanner": "completed",
    gitleaks: "completed",
    semgrep: "completed",
    "zap-baseline": "completed",
    "application-checks": "completed",
  },
  findings: [{ severity: "high" }],
});
assert(findingDecision.conclusion === "findings", "high finding should fail as findings");

const incompleteDecision = decideConclusion({
  statuses: {
    "npm-audit": "completed",
    "osv-scanner": "failed",
    gitleaks: "completed",
    semgrep: "completed",
    "zap-baseline": "completed",
    "application-checks": "completed",
  },
  findings: [{ severity: "critical" }],
});
assert(incompleteDecision.conclusion === "incomplete", "scanner failure must not be reported as findings-only or clean");
assert(incompleteDecision.highOrCriticalCount === 1, "incomplete scans should still count highs");

const versions = fs.readFileSync(path.join(repoRoot, ".github/security/tool-versions.env"), "utf8");
const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/daily-security-scan.yml"), "utf8");
const semgrepScript = fs.readFileSync(path.join(repoRoot, ".github/security/scripts/run-semgrep.sh"), "utf8");
const zapScript = fs.readFileSync(path.join(repoRoot, ".github/security/scripts/run-zap.sh"), "utf8");
for (const key of ["CHECKOUT_SHA", "SETUP_NODE_SHA", "UPLOAD_ARTIFACT_SHA"]) {
  const value = versions.match(new RegExp(`^${key}=(\\S+)$`, "m"))?.[1];
  assert(value && workflow.includes(value), `${key} is not pinned in the workflow`);
}
for (const key of ["SEMGREP_IMAGE", "ZAP_IMAGE", "GITLEAKS_SHA256", "OSV_SCANNER_SHA256"]) {
  const value = versions.match(new RegExp(`^${key}=(\\S+)$`, "m"))?.[1];
  assert(value && value.length > 16, `${key} is not pinned in tool-versions.env`);
}
assert(semgrepScript.includes('source "$ROOT/.github/security/tool-versions.env"'), "semgrep script does not load pins");
assert(semgrepScript.includes('"$SEMGREP_IMAGE"'), "semgrep script does not use the pinned image");
assert(zapScript.includes('"$ZAP_IMAGE"'), "zap script does not use the pinned image");
assert(semgrepScript.includes("--metrics=off"), "semgrep metrics are not disabled");
assert(!semgrepScript.includes("semgrep ci"), "semgrep cloud mode is present");
assert(workflow.includes('cron: "0 1 * * *"'), "missing 01:00 UTC cron");
assert(workflow.includes('cron: "0 2 * * *"'), "missing 02:00 UTC cron");
assert(workflow.includes("retention-days: 14"), "artifact retention is not 14 days");
assert(workflow.includes("contents: read"), "contents permission missing");
assert(workflow.includes("actions: write"), "actions permission missing");
assert(!/npm audit fix|osv-scanner fix|zap-full-scan|zap-api-scan|SEMGREP_APP_TOKEN|semgrep ci/.test(workflow), "workflow contains a forbidden scanner mode");
assert(!workflow.includes("pull_request"), "workflow should not run on pull requests");
assert(workflow.includes("publish"), "artifact path should be the encrypted publish directory");

const gitleaksConfig = fs.readFileSync(path.join(repoRoot, ".github/security/gitleaks.toml"), "utf8");
assert(!gitleaksConfig.includes(".env.example"), "gitleaks allowlist must not skip .env.example");
assert(gitleaksConfig.includes("(?i)^5ar5K5mpXwwkcFGOTKH51Q$"), "public analytics key allowlist missing");

const app = runApplicationChecks();
const reset = app.findings.find((item) => item.title === "Password reset link is written to logs");
assert(reset?.severity === "high", "password reset log was not flagged high");
assert(reset?.location?.file === "web/lib/auth/password-reset.ts", "password reset location missing");
const ahrefs = fs.readFileSync(path.join(repoRoot, "web/components/analytics/ahrefs-analytics.tsx"), "utf8");
const key = ahrefs.match(/data-key="([^"]+)"/)?.[1] ?? "";
const appText = JSON.stringify(app);
assert(key.length > 8, "could not read the public analytics key for the leak check");
assert(!appText.includes(key), "application check output contains the public analytics key");
assert(!appText.includes(sampleValue), "application checks contained a test secret");

if (failures.length) {
  console.error(`self-test failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("self-test passed");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // entry
}
