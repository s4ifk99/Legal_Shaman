import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runAppChecks } from "./app-security-checks.mjs";
import { buildReport, classifyConclusion, severityFromSignals } from "./build-report.mjs";
import { decryptBytes, encryptBytes, unpack } from "./encrypt-report.mjs";
import { shouldRunScheduledScan } from "./london-schedule-gate.mjs";
import { redact } from "./redact.mjs";
import { resolveZapTarget } from "./resolve-zap-target.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("London gate runs the BST slot and skips the GMT slot in summer", () => {
  const at = new Date("2026-07-15T01:00:00Z");
  assert.equal(shouldRunScheduledScan({ now: at, schedule: "0 1 * * *" }).run, true);
  assert.equal(shouldRunScheduledScan({ now: at, schedule: "0 2 * * *" }).run, false);
});

test("London gate runs the GMT slot and skips the BST slot in winter", () => {
  const at = new Date("2026-01-15T02:00:00Z");
  assert.equal(shouldRunScheduledScan({ now: at, schedule: "0 2 * * *" }).run, true);
  assert.equal(shouldRunScheduledScan({ now: at, schedule: "0 1 * * *" }).run, false);
});

test("a delayed matching slot still runs inside the London window", () => {
  const winter = new Date("2026-01-15T05:30:00Z");
  assert.equal(shouldRunScheduledScan({ now: winter, schedule: "0 2 * * *" }).run, true);
  assert.equal(shouldRunScheduledScan({ now: new Date("2026-01-15T06:00:00Z"), schedule: "0 2 * * *" }).run, false);
  const summer = new Date("2026-07-15T04:30:00Z");
  assert.equal(shouldRunScheduledScan({ now: summer, schedule: "0 1 * * *" }).run, true);
  assert.equal(shouldRunScheduledScan({ now: summer, schedule: "0 2 * * *" }).run, false);
});

test("clock change mornings run once", () => {
  assert.equal(shouldRunScheduledScan({ now: new Date("2026-03-29T01:00:00Z"), schedule: "0 1 * * *" }).run, true);
  assert.equal(shouldRunScheduledScan({ now: new Date("2026-03-29T02:00:00Z"), schedule: "0 2 * * *" }).run, false);
  assert.equal(shouldRunScheduledScan({ now: new Date("2026-10-25T01:00:00Z"), schedule: "0 1 * * *" }).run, false);
  assert.equal(shouldRunScheduledScan({ now: new Date("2026-10-25T02:00:00Z"), schedule: "0 2 * * *" }).run, true);
});

test("manual trigger always runs", () => {
  const decision = shouldRunScheduledScan({
    now: new Date("2026-01-15T12:00:00Z"),
    schedule: "",
    eventName: "workflow_dispatch",
  });
  assert.equal(decision.run, true);
});

test("severity mapping treats an empty OSV score as high and CVSS numbers by band", () => {
  assert.equal(severityFromSignals({ score: "", label: "" }), "high");
  assert.equal(severityFromSignals({ score: "9.8", label: "" }), "critical");
  assert.equal(severityFromSignals({ score: "7.5", label: "MODERATE" }), "high");
  assert.equal(severityFromSignals({ score: "5.3", label: "LOW" }), "medium");
});

test("redact removes secret shaped values", () => {
  const text = redact("token=sk-or-abcdefghijklmnopqrstuvwxyz password=supersecret Bearer abcdefghijklmnop");
  assert.equal(text.includes("abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(text.includes("supersecret"), false);
  assert.equal(text.includes("abcdefghijklmnop"), false);
});

test("encrypted report round trip", () => {
  const secret = "test-passphrase-value";
  const plain = Buffer.from("name\n5\nhello");
  const encrypted = encryptBytes(plain, secret);
  assert.equal(encrypted.includes(Buffer.from("hello")), false);
  assert.deepEqual(decryptBytes(encrypted, secret), plain);
});

test("repo ZAP sources agree on the public site", () => {
  const result = resolveZapTarget(repoRoot);
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://www.legalshaman.com");
});

test("disagreeing site URLs are not guessed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zap-target-"));
  fs.mkdirSync(path.join(dir, "web/lib/email"), { recursive: true });
  fs.mkdirSync(path.join(dir, "web/app"), { recursive: true });
  fs.writeFileSync(path.join(dir, "web/.env.example"), "NEXT_PUBLIC_SITE_URL=https://www.legalshaman.com\n");
  fs.writeFileSync(
    path.join(dir, "web/lib/email/config.ts"),
    'function resolveSiteUrl() {\n  return "https://example.com";\n}\n',
  );
  fs.writeFileSync(
    path.join(dir, "web/lib/email/triage-summary-template.ts"),
    'function resolveSiteUrl() {\n  return "https://www.legalshaman.com";\n}\n',
  );
  fs.writeFileSync(
    path.join(dir, "web/app/layout.tsx"),
    'export const metadata = { metadataBase: new URL("https://www.legalshaman.com") }\n',
  );
  const result = resolveZapTarget(dir);
  assert.equal(result.ok, false);
  assert.equal(result.url, null);
});

test("application checks record known issues and skip ignored env files", () => {
  const result = runAppChecks(repoRoot);
  const ids = new Set(result.findings.map((item) => item.ruleId));
  assert.equal(ids.has("password-reset-link-logged"), true);
  assert.equal(ids.has("missing-security-headers"), true);
  assert.equal(ids.has("xss-dangerous-html"), true);
  assert.equal(ids.has("admin-route-missing-auth"), false);
  assert.equal(ids.has("password-hash-response"), false);
  assert.equal(ids.has("xss-innerhtml"), false);
  const reset = result.findings.find((item) => item.ruleId === "password-reset-link-logged");
  assert.equal(reset.severity, "high");
  assert.match(reset.location, /password-reset\.ts$/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-checks-"));
  fs.writeFileSync(path.join(dir, ".env.local"), "API_KEY=sk-live-abcdefghijklmnopqrstuvwxyz\n");
  fs.writeFileSync(path.join(dir, "note.js"), "export const ok = 1;\n");
  const isolated = runAppChecks(dir);
  assert.equal(JSON.stringify(isolated).includes("sk-live-abcdefghijklmnopqrstuvwxyz"), false);
});

test("report conclusion distinguishes clean, high, and incomplete", () => {
  assert.equal(
    classifyConclusion([{ name: "npm-audit", status: "completed" }], [{ severity: "medium" }]).conclusion,
    "clean",
  );
  assert.equal(
    classifyConclusion([{ name: "npm-audit", status: "completed" }], [{ severity: "high" }]).conclusion,
    "high_or_critical",
  );
  const incomplete = classifyConclusion(
    [{ name: "semgrep", status: "failed" }],
    [{ severity: "critical" }],
  );
  assert.equal(incomplete.conclusion, "incomplete");
  assert.match(incomplete.conclusionReason, /not a clean result/);
});

test("fixture report redacts evidence and fails closed on a missing scanner", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "security-report-"));
  fs.writeFileSync(
    path.join(dir, "npm-audit.json"),
    JSON.stringify({
      vulnerabilities: {
        demo: {
          severity: "critical",
          via: [{ title: "demo bug", severity: "critical", range: "<1.0.0", url: "https://example.test/adv" }],
          range: "<1.0.0",
          fixAvailable: { name: "demo", version: "1.2.3", isSemVerMajor: false },
        },
      },
    }),
  );
  fs.writeFileSync(path.join(dir, "npm-audit.meta.json"), JSON.stringify({ exitCode: 1, stderrTail: null }));
  fs.writeFileSync(path.join(dir, "osv.json"), JSON.stringify({ results: [] }));
  fs.writeFileSync(path.join(dir, "osv-scanner.meta.json"), JSON.stringify({ exitCode: 0, stderrTail: null }));
  fs.writeFileSync(
    path.join(dir, "gitleaks.json"),
    JSON.stringify([{ RuleID: "generic", File: "web/lib/example.ts", StartLine: 4, Description: "token", Secret: "sk-or-abcdefghijklmnopqrstuvwxyz" }]),
  );
  fs.writeFileSync(path.join(dir, "gitleaks.meta.json"), JSON.stringify({ exitCode: 1, stderrTail: null }));
  fs.writeFileSync(path.join(dir, "semgrep.json"), JSON.stringify({ results: [] }));
  fs.writeFileSync(path.join(dir, "semgrep.meta.json"), JSON.stringify({ exitCode: 2, stderrTail: "semgrep crashed" }));
  fs.writeFileSync(path.join(dir, "zap.json"), JSON.stringify({ site: [] }));
  fs.writeFileSync(path.join(dir, "zap-baseline.meta.json"), JSON.stringify({ exitCode: 0, stderrTail: null }));
  fs.writeFileSync(
    path.join(dir, "app-checks.json"),
    JSON.stringify({ findings: [], passed: [], filesScanned: 1 }),
  );
  fs.writeFileSync(path.join(dir, "app-security-checks.meta.json"), JSON.stringify({ exitCode: 0, stderrTail: null }));
  const report = buildReport(dir, { SCAN_REF: "main", SCAN_SHA: "abc" });
  assert.equal(report.conclusion, "incomplete");
  assert.equal(JSON.stringify(report).includes("abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(report.findings.some((item) => item.severity === "critical"), true);
});

test("workflow stays least privilege and does not auto fix", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/daily-security-scan.yml"), "utf8");
  assert.match(workflow, /cron: "0 1 \* \* \*"/);
  assert.match(workflow, /cron: "0 2 \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /retention-days: 14/);
  assert.match(workflow, /SECURITY_SCAN_REPORT_KEY/);
  const runner = fs.readFileSync(path.join(repoRoot, ".github/security/scripts/run-all.sh"), "utf8");
  assert.match(runner, /zap-baseline.py/);
  assert.match(runner, /--entrypoint semgrep/);
  assert.match(runner, /--metrics=off/);
  assert.equal(runner.includes("semgrep ci"), false);
  assert.equal(workflow.includes("contents: write"), false);
  assert.equal(workflow.includes("semgrep ci"), false);
  assert.equal(workflow.includes("npm audit fix"), false);
  assert.equal(workflow.includes("osv-scanner fix"), false);
  assert.match(workflow, /github.event.repository.default_branch/);
});
