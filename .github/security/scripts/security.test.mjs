import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runAppChecks } from "./app-security-checks.mjs";
import { buildReport, noteArtifact, parseZap, renderMarkdown } from "./build-report.mjs";
import { decideSchedule, londonOffsetHours } from "./london-schedule-gate.mjs";
import { redactText } from "./redact.mjs";
import { defaultRepoRoot, resolveScanTargetFromRoot, chooseScanTarget } from "./resolve-scan-target.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("London offset follows GMT and BST", () => {
  assert.equal(londonOffsetHours(new Date("2026-01-15T02:00:00Z")), 0);
  assert.equal(londonOffsetHours(new Date("2026-07-15T01:00:00Z")), 1);
  assert.equal(londonOffsetHours(new Date("2026-10-26T02:00:00Z")), 0);
});

test("only the UTC slot that is 02:00 in London runs", () => {
  const summer = decideSchedule({
    now: new Date("2026-07-15T01:40:00Z"),
    eventName: "schedule",
    schedule: "0 1 * * *",
  });
  const summerOther = decideSchedule({
    now: new Date("2026-07-15T02:00:00Z"),
    eventName: "schedule",
    schedule: "0 2 * * *",
  });
  const winter = decideSchedule({
    now: new Date("2026-01-15T02:05:00Z"),
    eventName: "schedule",
    schedule: "0 2 * * *",
  });
  const winterOther = decideSchedule({
    now: new Date("2026-01-15T01:00:00Z"),
    eventName: "schedule",
    schedule: "0 1 * * *",
  });
  assert.equal(summer.run, true);
  assert.equal(summerOther.run, false);
  assert.equal(winter.run, true);
  assert.equal(winterOther.run, false);
  assert.match(winterOther.reason, /not a clean result/);
});

test("manual runs are not delayed until 02:00", () => {
  const decision = decideSchedule({
    now: new Date("2026-01-15T12:00:00Z"),
    eventName: "workflow_dispatch",
    schedule: "",
  });
  assert.equal(decision.run, true);
  assert.equal(decision.failClosed, false);
});

test("deployed URL comes from matching repository configuration", () => {
  const result = resolveScanTargetFromRoot(defaultRepoRoot);
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://www.legalshaman.com");
});

test("disagreeing site URLs fail closed", () => {
  const result = chooseScanTarget({
    configUrls: ["https://www.legalshaman.com"],
    envUrls: ["https://example.invalid"],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /could not be determined/);
  assert.match(result.message, /www\.legalshaman\.com/);
  assert.match(result.message, /example\.invalid/);
});

test("redaction removes secret values and can run twice", () => {
  const input = "token sk_live_abcdefghij123456 and Bearer supersecretvalue";
  const once = redactText(input);
  const twice = redactText(input);
  assert.equal(once, twice);
  assert.equal(once.includes("abcdefghij123456"), false);
  assert.equal(once.includes("supersecretvalue"), false);
  assert.match(once, /redacted/);
});

test("application checks flag SQL interpolation and keep the admin gate", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ls-app-"));
  try {
    const route = path.join(root, "web/app/api/demo");
    mkdirSync(route, { recursive: true });
    writeFileSync(path.join(route, "route.ts"), "export async function GET(){ return prisma.$queryRawUnsafe(`SELECT ${id}`); }\n");
    writeFileSync(path.join(root, "web/middleware.ts"), 'if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) return new Response("no", { status: 401 });\n');
    const report = runAppChecks(root);
    assert.equal(report.findings.some((item) => item.ruleId === "injection.query-raw-unsafe" && item.severity === "high"), true);
    assert.equal(report.findings.some((item) => item.ruleId === "auth.middleware-admin-gate"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository admin and account routes keep their gates", () => {
  const report = runAppChecks(repoRoot);
  const missing = report.findings.filter((item) => item.severity === "critical" && item.ruleId.startsWith("auth."));
  assert.deepEqual(missing.map((item) => item.ruleId), []);
});

function status(id, detail = "ok") {
  return { id, status: "completed", detail, coverageNotes: id === "gitleaks" ? ["history of large files is skipped"] : [] };
}

function writeScanner(dir, id, file, body, extra = {}) {
  mkdirSync(path.join(dir, "status"), { recursive: true });
  writeFileSync(path.join(dir, "status", `${id}.json`), JSON.stringify({ ...status(id), ...extra }));
  writeFileSync(path.join(dir, file), JSON.stringify(body));
}

test("high findings fail and secret values stay out of the report", () => {
  const raw = mkdtempSync(path.join(tmpdir(), "ls-raw-"));
  try {
    writeScanner(raw, "npm-audit", "npm-audit.json", {
      vulnerabilities: {
        leftpad: { name: "leftpad", severity: "high", range: "<1.0.0", via: [{ title: "example", url: "https://example.invalid/adv" }], fixAvailable: { name: "leftpad", version: "1.0.0" } },
      },
    });
    writeScanner(raw, "osv-scanner", "osv.json", { results: [] });
    writeScanner(raw, "semgrep", "semgrep.json", { results: [] });
    writeScanner(raw, "gitleaks", "gitleaks.json", [{
      RuleID: "aws-access-key",
      File: "web/lib/example.ts",
      StartLine: 4,
      Secret: "AKIAIOSFODNN7EXAMPLE",
      Match: "AKIAIOSFODNN7EXAMPLE",
    }]);
    writeScanner(raw, "app-security-checks", "app-checks.json", { findings: [], coverageNotes: [] });
    writeScanner(raw, "zap", "zap.json", { site: [] });
    writeScanner(raw, "data-patterns", "data-patterns.json", { files: [] });
    const report = buildReport({ rawDir: raw, commit: "abc", targetUrl: "https://www.legalshaman.com" });
    assert.equal(report.result, "findings");
    const packed = JSON.stringify(report);
    assert.equal(packed.includes("AKIAIOSFODNN7EXAMPLE"), false);
    assert.match(report.resultDetail, /FINDINGS/);
  } finally {
    rmSync(raw, { recursive: true, force: true });
  }
});

test("a missing scanner is a scan failure even when other checks are empty", () => {
  const raw = mkdtempSync(path.join(tmpdir(), "ls-raw-"));
  try {
    writeScanner(raw, "npm-audit", "npm-audit.json", { vulnerabilities: {} });
    writeScanner(raw, "osv-scanner", "osv.json", { results: [] });
    writeScanner(raw, "semgrep", "semgrep.json", { results: [] });
    writeScanner(raw, "gitleaks", "gitleaks.json", []);
    writeScanner(raw, "app-security-checks", "app-checks.json", { findings: [], coverageNotes: [] });
    writeScanner(raw, "data-patterns", "data-patterns.json", { files: [] });
    const report = buildReport({ rawDir: raw });
    assert.equal(report.result, "scan_failure");
    assert.match(report.resultDetail, /not treat this run as clean/);
    const stored = noteArtifact(report, false, "key missing");
    assert.equal(stored.result, "scan_failure");
    const summary = renderMarkdown(stored, { includeEvidence: false });
    assert.equal(summary.includes("Evidence:"), false);
  } finally {
    rmSync(raw, { recursive: true, force: true });
  }
});

test("ZAP high alerts are high severity", () => {
  const parsed = parseZap({
    site: [{
      "@name": "https://www.legalshaman.com",
      alerts: [{
        pluginid: "10038",
        alert: "Content Security Policy Header Not Set",
        riskcode: "3",
        riskdesc: "High (Medium)",
        desc: "CSP was missing",
        solution: "Set a Content-Security-Policy.",
        instances: [{ uri: "https://www.legalshaman.com/search?token=sekret" }],
      }],
    }],
  });
  assert.equal(parsed.findings[0].severity, "high");
  assert.equal(parsed.findings[0].url.includes("token="), false);
  assert.equal(JSON.stringify(parsed).includes("sekret"), false);
});

test("workflow pins actions and keeps scanner digests in the version file", () => {
  const workflow = readFileSync(path.join(repoRoot, ".github/workflows/daily-security-scan.yml"), "utf8");
  const runner = readFileSync(path.join(repoRoot, ".github/security/scripts/run-security-scan.sh"), "utf8");
  const versions = readFileSync(path.join(repoRoot, ".github/security/tool-versions.env"), "utf8");
  for (const name of ["CHECKOUT_SHA", "SETUP_NODE_SHA", "UPLOAD_ARTIFACT_SHA"]) {
    const value = versions.match(new RegExp(`^${name}=(.+)$`, "m"))[1];
    assert.equal(workflow.includes(value), true, name);
  }
  for (const name of ["SEMGREP_IMAGE", "ZAP_IMAGE", "GITLEAKS_SHA256", "OSV_SCANNER_SHA256"]) {
    const value = versions.match(new RegExp(`^${name}=(.+)$`, "m"))[1];
    assert.match(value, /sha256:| [a-f0-9]{64}|^[a-f0-9]{64}$/);
    assert.equal(value.includes("latest"), false, name);
  }
  const installer = readFileSync(path.join(repoRoot, ".github/security/scripts/install-pinned-tools.sh"), "utf8");
  assert.match(installer, /curl --fail --location/);
  assert.match(runner, /\$SEMGREP_IMAGE/);
  assert.match(runner, /\$ZAP_IMAGE/);
  assert.match(runner, /scanner\.attackOnStart=false/);
  assert.match(runner, /spider\.postform=false/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /actions:\s*write/);
  assert.equal(workflow.includes("contents: write"), false);
  assert.equal(workflow.includes("security-events:"), false);
  assert.equal(workflow.includes("pull-requests:"), false);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /retention-days:\s*14/);
  assert.match(workflow, /cron:\s*"0 1 \* \* \*"/);
  assert.match(workflow, /cron:\s*"0 2 \* \* \*"/);
  assert.equal(workflow.includes("npm audit fix"), false);
  assert.equal(runner.includes("osv-scanner fix"), false);
  assert.equal(runner.includes("npm audit fix"), false);
});
