import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { aggregateRawDir, conclusionOf, parseGitleaks, parseNpmAudit, parseOsv, renderPublicSummary } from "./aggregate-report.mjs"

test("npm audit and OSV severities are mapped, and secrets are dropped", () => {
  const secret = ["ghp", "0123456789abcdef0123456789abcdef"].join("_")
  const gitleaks = parseGitleaks([{
    Description: "GitHub personal access token",
    RuleID: "github-pat",
    File: "/tmp/tree/web/.env.example",
    StartLine: 4,
    Secret: secret,
    Match: secret,
  }], "/tmp/tree")
  assert.equal(JSON.stringify(gitleaks).includes(secret), false)
  assert.equal(gitleaks.findings[0].location, "web/.env.example")
  assert.equal(gitleaks.findings[0].severity, "high")

  const npm = parseNpmAudit({
    vulnerabilities: {
      leftpad: {
        name: "leftpad",
        severity: "critical",
        via: [{ title: "Example advisory", url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz", severity: "critical" }],
        fixAvailable: { name: "leftpad", version: "2.0.0", isSemVerMajor: true },
      },
    },
  })
  assert.equal(npm.findings[0].severity, "critical")
  assert.match(npm.findings[0].remediation, /2\.0\.0/)

  const osv = parseOsv({
    results: [{
      source: { path: "/tmp/tree/web/package-lock.json", type: "lockfile" },
      packages: [{
        package: { name: "axios", version: "1.0.0" },
        vulnerabilities: [{ id: "GHSA-1111-2222-3333", summary: "Example issue", database_specific: { severity: "LOW" } }],
        groups: [
          { ids: ["GHSA-1111-2222-3333"], max_severity: "9.1" },
          { ids: ["GHSA-aaaa-bbbb-cccc"], max_severity: "" },
        ],
      }],
    }],
  }, "/tmp/tree")
  assert.equal(osv.findings[0].severity, "critical")
  assert.equal(osv.findings[0].location, "web/package-lock.json")
  assert.equal(osv.findings[1].severity, "high")
  assert.match(osv.findings[1].evidence, /treated as high/)
})

test("an unfinished scanner is incomplete even when there are no findings", () => {
  const report = {
    conclusion: conclusionOf(
      [{ name: "zap-baseline", status: "failed" }],
      [],
    ),
    summary: "One or more scanners did not finish. This is not a clean result.",
    commit: "abc",
    ref: "main",
    targetUrl: null,
    scanners: [{ name: "zap-baseline", status: "failed", error: "Docker is not available, so the OWASP ZAP baseline did not run.", counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } }],
    findings: [],
    limitations: ["history is not scanned"],
  }
  assert.equal(report.conclusion, "incomplete")
  const summary = renderPublicSummary(report, "encrypted report uploaded")
  assert.match(summary, /Scan conclusion: INCOMPLETE/)
  assert.match(summary, /not a clean result/)
  assert.doesNotMatch(summary, /Scan conclusion: PASSED/)
})

test("completed scans with only medium findings pass and say so", () => {
  const scanners = [{ name: "app-checks", status: "completed", counts: { critical: 0, high: 0, medium: 1, low: 0, info: 0 } }]
  const findings = [{ severity: "medium", scanner: "app-checks", title: "Missing header", location: "web/next.config.mjs", line: 1, evidence: "none", remediation: "add headers" }]
  assert.equal(conclusionOf(scanners, findings), "passed")
  const summary = renderPublicSummary({
    conclusion: "passed",
    summary: "No high or critical findings. This is a completed scan. Medium, low, and informational items may still be listed.",
    commit: "abc",
    ref: "main",
    targetUrl: "https://www.legalshaman.com",
    scanners,
    findings,
    limitations: [],
  }, "encrypted report uploaded")
  assert.match(summary, /Scan conclusion: PASSED/)
  assert.match(summary, /No high or critical findings/)
  assert.doesNotMatch(summary, /not a clean result/)
})

test("aggregate output does not keep a planted secret", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aggregate-"))
  const secret = ["sk", "or", "v1", "Q9mZ4pL8sT2kR7wX6nB3"].join("-")
  const names = ["script-tests", "npm-audit", "osv", "gitleaks", "semgrep-local", "semgrep-registry", "app-checks", "zap-baseline"]
  for (const name of names) {
    fs.writeFileSync(path.join(dir, `${name}.meta.json`), JSON.stringify({ name, status: "completed", exitCode: 0, error: null }))
  }
  fs.writeFileSync(path.join(dir, "script-tests.json"), "{}")
  fs.writeFileSync(path.join(dir, "npm-audit.json"), JSON.stringify({ vulnerabilities: {} }))
  fs.writeFileSync(path.join(dir, "osv.json"), JSON.stringify({ results: [] }))
  fs.writeFileSync(path.join(dir, "gitleaks.json"), JSON.stringify([{ RuleID: "generic-api-key", File: "web/example.ts", StartLine: 2, Secret: secret, Match: secret, Description: "generic" }]))
  fs.writeFileSync(path.join(dir, "semgrep-local.json"), JSON.stringify({ results: [], errors: [] }))
  fs.writeFileSync(path.join(dir, "semgrep-registry.json"), JSON.stringify({ results: [], errors: [] }))
  fs.writeFileSync(path.join(dir, "app-checks.json"), JSON.stringify({ findings: [] }))
  fs.writeFileSync(path.join(dir, "zap-baseline.json"), JSON.stringify({
    site: [{ "@name": "https://www.legalshaman.com", alerts: [{ alert: "Missing header", riskcode: "2", riskdesc: "Medium (High)", pluginid: "10038", instances: [{ uri: "https://www.legalshaman.com/search?q=secret", evidence: secret }], solution: "Set the header." }] }],
  }))
  fs.writeFileSync(path.join(dir, "source.meta.json"), JSON.stringify({ commit: "abc", ref: "main", targetUrl: "https://www.legalshaman.com" }))
  const report = aggregateRawDir(dir, { literals: [secret] })
  const serialised = JSON.stringify(report)
  assert.equal(serialised.includes(secret), false)
  assert.equal(report.conclusion, "findings")
  assert.match(report.findings.find((item) => item.scanner === "zap-baseline").url, /\[REDACTED-QUERY\]/)
})
