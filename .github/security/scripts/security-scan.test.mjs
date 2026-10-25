import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cvssV3BaseScore, cvssV4Bucket, scoreToSeverity, severityFromAdvisory } from "./cvss.mjs";
import { scheduledSlotShouldRun } from "./london-schedule-gate.mjs";
import { buildReport, parseSemgrep } from "./normalize-reports.mjs";
import { redactText } from "./redact.mjs";
import { resolveTargetUrl } from "./resolve-target-url.mjs";

test("cvss v3 critical vector scores 9.8", () => {
  const score = cvssV3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H");
  assert.equal(score, 9.8);
  assert.equal(scoreToSeverity(score), "critical");
});

test("cvss v3 high vector stays high", () => {
  const score = cvssV3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N");
  assert.equal(score, 7.5);
  assert.equal(scoreToSeverity(score), "high");
});

test("cvss v4 high impact without an easy attack is high", () => {
  assert.equal(cvssV4Bucket("CVSS:4.0/AV:N/AC:H/AT:P/PR:N/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N"), "high");
});

test("missing advisory severity fails closed as high", () => {
  assert.equal(severityFromAdvisory({}), "high");
});

test("semgrep warnings stay medium and error rules stay high", () => {
  const parsed = parseSemgrep({
    results: [
      { check_id: "warn", path: "a.yml", start: { line: 1 }, extra: { severity: "WARNING", message: "mutable tag", metadata: { impact: "HIGH" } } },
      { check_id: "err", path: "a.ts", start: { line: 2 }, extra: { severity: "ERROR", message: "sql", metadata: { impact: "HIGH", confidence: "HIGH" } } },
    ],
  });
  assert.equal(parsed.findings[0].severity, "medium");
  assert.equal(parsed.findings[1].severity, "high");
});

test("redaction removes constructed secret material", () => {
  const secret = ["sk", "live", "abcdef0123456789"].join("_");
  assert.equal(redactText(`seen ${secret} end`), "seen [REDACTED] end");
});

test("london gate matches 02:00 GMT and BST and skips the other utc hour", () => {
  assert.equal(scheduledSlotShouldRun(new Date("2026-01-15T02:00:00Z")).run, true);
  assert.equal(scheduledSlotShouldRun(new Date("2026-01-15T01:00:00Z")).run, false);
  assert.equal(scheduledSlotShouldRun(new Date("2026-07-15T01:00:00Z")).run, true);
  assert.equal(scheduledSlotShouldRun(new Date("2026-07-15T02:00:00Z")).run, false);
  assert.equal(scheduledSlotShouldRun(new Date("2026-10-25T01:00:00Z")).run, false);
  assert.equal(scheduledSlotShouldRun(new Date("2026-10-25T02:00:00Z")).run, true);
  assert.equal(scheduledSlotShouldRun(new Date("2026-03-29T01:00:00Z")).run, true);
});

test("target url comes from matching repository configuration", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const result = resolveTargetUrl(root);
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://www.legalshaman.com");
});

test("high findings fail and a missing scanner is not clean", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "security-scan-"));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), value);
  write("target.json", JSON.stringify({ ok: true, url: "https://www.legalshaman.com", reason: "test" }));
  write("artifact-status.json", JSON.stringify({ status: "ready", reason: "test" }));
  write("custom-checks.json", JSON.stringify({ findings: [], limitations: [] }));
  write("gitleaks.json", "[]");
  write("gitleaks.exit", "0");
  write("semgrep.json", JSON.stringify({ results: [], errors: [] }));
  write("semgrep.exit", "0");
  write(
    "npm-audit.json",
    JSON.stringify({
      vulnerabilities: {
        example: { severity: "critical", range: "<1.2.3", via: [{ title: "Example issue" }], fixAvailable: { name: "example", version: "1.2.3" } },
      },
    }),
  );
  write("npm-audit.exit", "1");
  write("osv-npm.json", JSON.stringify({ results: [] }));
  write("osv-npm.exit", "0");
  write("osv-python.json", JSON.stringify({ results: [] }));
  write("osv-python.exit", "0");
  write("zap.json", JSON.stringify({ site: [] }));
  write("zap.exit", "0");
  write("commit.txt", "abc");

  const withFinding = buildReport(dir);
  assert.equal(withFinding.overall, "high_or_critical");
  assert.equal(withFinding.exitCode, 1);
  assert.equal(withFinding.wordCleanAllowed, false);

  write("npm-audit.json", JSON.stringify({ vulnerabilities: {} }));
  write("npm-audit.exit", "0");
  fs.rmSync(path.join(dir, "zap.json"));
  const incomplete = buildReport(dir);
  assert.equal(incomplete.overall, "scan_failed");
  assert.equal(incomplete.exitCode, 2);
  assert.match(JSON.stringify(incomplete), /not a clean result|scan_failed|This result is not clean|Scan incomplete|did not finish/i);
});

test("medium findings do not fail and are not called clean", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "security-scan-medium-"));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), value);
  write("target.json", JSON.stringify({ ok: true, url: "https://www.legalshaman.com", reason: "test" }));
  write("artifact-status.json", JSON.stringify({ status: "ready", reason: "test" }));
  write(
    "custom-checks.json",
    JSON.stringify({
      findings: [
        {
          severity: "medium",
          category: "xss",
          rule: "example",
          location: "web/example.tsx:1",
          evidence: "interpolated html",
          suggestion: "Render text with React.",
        },
      ],
      limitations: ["web/data was not pattern scanned"],
    }),
  );
  write("gitleaks.json", "[]");
  write("gitleaks.exit", "0");
  write("semgrep.json", JSON.stringify({ results: [] }));
  write("semgrep.exit", "0");
  write("npm-audit.json", JSON.stringify({ vulnerabilities: {} }));
  write("npm-audit.exit", "0");
  write("osv-npm.json", JSON.stringify({ results: [] }));
  write("osv-npm.exit", "0");
  write("osv-python.json", JSON.stringify({ results: [] }));
  write("osv-python.exit", "0");
  write("zap.json", JSON.stringify({ site: [{ "@name": "https://www.legalshaman.com", alerts: [] }] }));
  write("zap.exit", "0");
  write("commit.txt", "abc");
  const report = buildReport(dir);
  assert.equal(report.exitCode, 0);
  assert.equal(report.overall, "completed_with_findings");
  assert.equal(report.wordCleanAllowed, false);
});
