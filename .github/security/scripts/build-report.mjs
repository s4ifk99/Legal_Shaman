import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { clip, redact, redactValue } from "./redact.mjs";
import { londonParts } from "./london-schedule-gate.mjs";

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export function rankSeverity(severity) {
  return SEVERITY_RANK[severity] ?? 3;
}

export function higherSeverity(left, right) {
  return rankSeverity(left) >= rankSeverity(right) ? left : right;
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readMeta(dir, name) {
  return readJson(path.join(dir, `${name}.meta.json`)) || { name, exitCode: null, stderrTail: null };
}

function npmSeverity(value) {
  const map = { critical: "critical", high: "high", moderate: "medium", medium: "medium", low: "low", info: "info" };
  return map[String(value || "").toLowerCase()] || "high";
}

function cvssScore(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const match = String(value).match(/\/(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1]) : null;
}

export function severityFromSignals({ score, label }) {
  const fromLabel = label
    ? npmSeverity(String(label).toLowerCase() === "moderate" ? "moderate" : String(label).toLowerCase())
    : null;
  const numeric = cvssScore(score);
  let fromScore = null;
  if (numeric != null) {
    if (numeric >= 9) fromScore = "critical";
    else if (numeric >= 7) fromScore = "high";
    else if (numeric >= 4) fromScore = "medium";
    else fromScore = "low";
  }
  if (fromScore && fromLabel) return higherSeverity(fromScore, fromLabel);
  if (fromScore) return fromScore;
  if (fromLabel) return fromLabel;
  return "high";
}

function npmFix(fixAvailable, name) {
  if (fixAvailable && typeof fixAvailable === "object") {
    const major = fixAvailable.isSemVerMajor ? " This may be a major upgrade." : "";
    return `Upgrade ${fixAvailable.name} to ${fixAvailable.version}.${major} Review the advisory before upgrading. This workflow does not apply npm audit fix.`;
  }
  if (fixAvailable === true) {
    return `A fix is reported for ${name}. Review the advisory and upgrade that dependency. This workflow does not apply npm audit fix.`;
  }
  return `No automatic fix is reported for ${name}. Review the advisory and upgrade, replace, or remove the dependency. This workflow does not apply npm audit fix.`;
}

function parseNpm(json) {
  const findings = [];
  const vulns = json?.vulnerabilities || {};
  for (const [name, vuln] of Object.entries(vulns)) {
    const vias = Array.isArray(vuln.via) ? vuln.via : [];
    const advisories = vias.filter((item) => item && typeof item === "object");
    const parents = vias.filter((item) => typeof item === "string");
    const rows = advisories.length ? advisories : [null];
    for (const advisory of rows) {
      const severity = npmSeverity(advisory?.severity || vuln.severity);
      const title = advisory?.title || name;
      findings.push({
        scanner: "npm-audit",
        ruleId: advisory?.url || `npm:${name}`,
        severity,
        category: "dependency",
        location: `web/package-lock.json (${name})`,
        line: null,
        url: advisory?.url || null,
        evidence: clip(`${title}. Vulnerable range ${advisory?.range || vuln.range || "unknown"}. Via ${parents.join(", ") || name}.`),
        suggestedFix: npmFix(vuln.fixAvailable, name),
      });
    }
  }
  return findings;
}

function parseOsv(json) {
  const findings = [];
  for (const result of json?.results || []) {
    let sourcePath = String(result?.source?.path || "lockfile").replace(/\\/g, "/").replace(/^.*?source-tree\//, "");
    if (sourcePath.endsWith("scripts/exa/requirements.txt")) sourcePath = "scripts/exa/requirements-exa.txt";
    for (const pkg of result.packages || []) {
      const name = pkg?.package?.name || "unknown";
      const version = pkg?.package?.version || "unknown";
      const scores = new Map();
      for (const group of pkg.groups || []) {
        for (const id of group.ids || []) scores.set(id, group.max_severity);
      }
      for (const vuln of pkg.vulnerabilities || []) {
        const id = vuln.id || "OSV";
        const severity = severityFromSignals({
          score: scores.get(id),
          label: vuln.database_specific?.severity,
        });
        findings.push({
          scanner: "osv-scanner",
          ruleId: id,
          severity,
          category: "dependency",
          location: `${sourcePath} (${name}@${version})`,
          line: null,
          url: `https://osv.dev/vulnerability/${id}`,
          evidence: clip(`${id}: ${vuln.summary || "No summary"}. Score ${scores.get(id) || "none"}.`),
          suggestedFix: `Review ${id} and upgrade ${name} away from ${version}. This workflow does not run osv-scanner fix.`,
        });
      }
    }
  }
  return findings;
}

function parseGitleaks(json) {
  const rows = Array.isArray(json) ? json : [];
  return rows.map((row) => ({
    scanner: "gitleaks",
    ruleId: row.RuleID || "secret",
    severity: "high",
    category: "exposed-api-key",
    location: row.File || "unknown",
    line: row.StartLine ?? null,
    url: null,
    evidence: clip(`${row.Description || "Secret pattern"} at ${row.File || "unknown"}:${row.StartLine || "?"}. Value redacted.`),
    suggestedFix:
      "Remove the secret from the current tree and rotate it. This scan does not rewrite git history.",
  }));
}

function semgrepSeverity(value) {
  const text = String(value || "").toUpperCase();
  if (text === "ERROR") return "high";
  if (text === "WARNING") return "medium";
  if (text === "INFO") return "low";
  return "high";
}

function parseSemgrep(json) {
  return (json?.results || []).map((row) => ({
    scanner: "semgrep",
    ruleId: row.check_id || "semgrep",
    severity: semgrepSeverity(row.extra?.severity),
    category: row.extra?.metadata?.category || "sast",
    location: row.path || "unknown",
    line: row.start?.line ?? null,
    url: null,
    evidence: clip(row.extra?.message || "Semgrep finding"),
    suggestedFix: clip(row.extra?.message || "Review the matched code and apply the rule guidance."),
  }));
}

function zapSeverity(code) {
  const value = String(code);
  if (value === "3") return "high";
  if (value === "2") return "medium";
  if (value === "1") return "low";
  if (value === "0") return "info";
  return "high";
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseZap(json) {
  const sites = json?.site || json?.sites || [];
  const findings = [];
  for (const site of sites) {
    for (const alert of site.alerts || []) {
      const instances = alert.instances || [];
      const urls = instances.map((item) => item.uri).filter(Boolean).slice(0, 3);
      findings.push({
        scanner: "zap-baseline",
        ruleId: String(alert.pluginid || alert.alert || "zap"),
        severity: zapSeverity(alert.riskcode),
        category: "baseline",
        location: urls[0] || site["@name"] || "unknown",
        line: null,
        url: urls[0] || null,
        evidence: clip(`${alert.alert || "ZAP alert"} (${alert.riskdesc || alert.riskcode}). URLs: ${urls.join(", ") || "none"}. ${stripHtml(alert.desc)}`),
        suggestedFix: clip(stripHtml(alert.solution) || "Review the alert and change the deployed configuration."),
      });
    }
  }
  return findings;
}

function countSeverities(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const item of findings) {
    if (counts[item.severity] == null) counts.high += 1;
    else counts[item.severity] += 1;
  }
  return counts;
}

export function classifyConclusion(scanners, findings) {
  const failed = scanners.filter((scanner) => scanner.status !== "completed").map((scanner) => scanner.name);
  const counts = countSeverities(findings);
  const highOrCritical = counts.critical + counts.high;
  if (failed.length) {
    return {
      conclusion: "incomplete",
      conclusionReason: `Scanners did not complete: ${failed.join(", ")}. This is not a clean result.`,
      counts,
      failed,
    };
  }
  if (highOrCritical > 0) {
    return {
      conclusion: "high_or_critical",
      conclusionReason: "All scanners completed and high or critical findings are present. This is not a clean result.",
      counts,
      failed,
    };
  }
  return {
    conclusion: "clean",
    conclusionReason:
      "All scanners completed and there are no high or critical findings. Medium and low findings, if any, are listed in this report.",
    counts,
    failed,
  };
}

function scannerRecord(name, status, error, extra = {}) {
  return {
    name,
    status,
    error: error ? clip(error, 500) : null,
    ...extra,
  };
}

function normaliseLocation(location) {
  return String(location || "unknown").replace(/\\/g, "/");
}

export function buildReport(outDir, env = process.env) {
  const npmJson = readJson(path.join(outDir, "npm-audit.json"));
  const osvJson = readJson(path.join(outDir, "osv.json"));
  const gitleaksJson = readJson(path.join(outDir, "gitleaks.json"));
  const semgrepJson = readJson(path.join(outDir, "semgrep.json"));
  const zapJson = readJson(path.join(outDir, "zap.json"));
  const appJson = readJson(path.join(outDir, "app-checks.json"));
  const metas = {
    npm: readMeta(outDir, "npm-audit"),
    osv: readMeta(outDir, "osv-scanner"),
    gitleaks: readMeta(outDir, "gitleaks"),
    semgrep: readMeta(outDir, "semgrep"),
    zap: readMeta(outDir, "zap-baseline"),
    app: readMeta(outDir, "app-security-checks"),
  };

  const scanners = [];
  const findings = [];

  if (!npmJson || npmJson.error) {
    scanners.push(scannerRecord("npm-audit", "failed", npmJson?.error?.summary || metas.npm.stderrTail || "npm audit did not produce a report"));
  } else if (metas.npm.exitCode != null && metas.npm.exitCode > 1) {
    scanners.push(scannerRecord("npm-audit", "failed", metas.npm.stderrTail || `npm audit exited ${metas.npm.exitCode}`));
  } else {
    scanners.push(scannerRecord("npm-audit", "completed", null, { exitCode: metas.npm.exitCode }));
    findings.push(...parseNpm(npmJson));
  }

  if (!osvJson || osvJson.error) {
    scanners.push(scannerRecord("osv-scanner", "failed", metas.osv.stderrTail || "osv-scanner did not produce a report"));
  } else if (metas.osv.exitCode != null && metas.osv.exitCode > 1) {
    scanners.push(scannerRecord("osv-scanner", "failed", metas.osv.stderrTail || `osv-scanner exited ${metas.osv.exitCode}`));
  } else {
    scanners.push(scannerRecord("osv-scanner", "completed", null, { exitCode: metas.osv.exitCode }));
    findings.push(...parseOsv(osvJson));
  }

  if (!Array.isArray(gitleaksJson)) {
    scanners.push(scannerRecord("gitleaks", "failed", metas.gitleaks.stderrTail || "gitleaks did not produce a JSON array"));
  } else if (metas.gitleaks.exitCode != null && metas.gitleaks.exitCode > 1) {
    scanners.push(scannerRecord("gitleaks", "failed", metas.gitleaks.stderrTail || `gitleaks exited ${metas.gitleaks.exitCode}`));
  } else {
    scanners.push(scannerRecord("gitleaks", "completed", null, { exitCode: metas.gitleaks.exitCode }));
    findings.push(...parseGitleaks(gitleaksJson));
  }

  if (!semgrepJson || !Array.isArray(semgrepJson.results)) {
    scanners.push(scannerRecord("semgrep", "failed", metas.semgrep.stderrTail || "Semgrep did not produce results"));
  } else if (metas.semgrep.exitCode != null && metas.semgrep.exitCode > 1) {
    scanners.push(scannerRecord("semgrep", "failed", metas.semgrep.stderrTail || `Semgrep exited ${metas.semgrep.exitCode}`, {
      parseWarnings: Array.isArray(semgrepJson.errors) ? semgrepJson.errors.length : 0,
    }));
    findings.push(...parseSemgrep(semgrepJson));
  } else {
    scanners.push(scannerRecord("semgrep", "completed", null, {
      exitCode: metas.semgrep.exitCode,
      parseWarnings: Array.isArray(semgrepJson.errors) ? semgrepJson.errors.length : 0,
    }));
    findings.push(...parseSemgrep(semgrepJson));
  }

  if (!zapJson || (!zapJson.site && !zapJson.sites)) {
    scanners.push(scannerRecord("zap-baseline", "failed", metas.zap.stderrTail || "OWASP ZAP baseline did not produce a report"));
  } else if (metas.zap.exitCode != null && metas.zap.exitCode > 2) {
    scanners.push(scannerRecord("zap-baseline", "failed", metas.zap.stderrTail || `ZAP exited ${metas.zap.exitCode}`));
    findings.push(...parseZap(zapJson));
  } else {
    scanners.push(scannerRecord("zap-baseline", "completed", null, { exitCode: metas.zap.exitCode }));
    findings.push(...parseZap(zapJson));
  }

  if (!appJson || !Array.isArray(appJson.findings)) {
    scanners.push(scannerRecord("app-security-checks", "failed", metas.app.stderrTail || "Application checks did not produce findings"));
  } else if (metas.app.exitCode != null && metas.app.exitCode > 0) {
    scanners.push(scannerRecord("app-security-checks", "failed", metas.app.stderrTail || `Application checks exited ${metas.app.exitCode}`));
  } else {
    scanners.push(scannerRecord("app-security-checks", "completed", null, { filesScanned: appJson.filesScanned, passed: appJson.passed || [] }));
    for (const item of appJson.findings) {
      findings.push({
        scanner: "app-security-checks",
        ruleId: item.ruleId,
        severity: item.severity,
        category: item.category,
        location: item.location,
        line: item.line,
        url: null,
        evidence: item.evidence,
        suggestedFix: item.suggestedFix,
      });
    }
  }

  const normalised = redactValue(
    findings.map((item) => ({
      ...item,
      location: normaliseLocation(item.location).replace(/^.*?source-tree\//, ""),
    })),
  );
  const classified = classifyConclusion(scanners, normalised);
  const now = new Date();
  const london = londonParts(now);
  const londonDate = `${london.year}-${String(london.month).padStart(2, "0")}-${String(london.day).padStart(2, "0")}`;
  const report = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    londonDate,
    target: {
      ref: env.SCAN_REF || null,
      sha: env.SCAN_SHA || null,
    },
    conclusion: classified.conclusion,
    conclusionReason: classified.conclusionReason,
    counts: classified.counts,
    failedScanners: classified.failed,
    versions: {
      gitleaks: env.GITLEAKS_VERSION || null,
      osvScanner: env.OSV_SCANNER_VERSION || null,
      semgrepImage: env.SEMGREP_IMAGE || null,
      zapImage: env.ZAP_IMAGE || null,
      node: process.version,
    },
    scope: [
      "Scans the git archive of the default branch checkout (tracked files at that commit).",
      "Git history is not scanned. A secret removed from the current tree can still exist in older commits.",
      "Secret scanning skips data/, web/data/, files larger than 2 MB, and common binary assets.",
      "Dependency scanning covers web/package-lock.json with npm audit and osv-scanner, plus scripts/exa/requirements-exa.txt with osv-scanner.",
      "Semgrep runs locally in the pinned image with metrics and the Semgrep app disabled. It does not use semgrep ci.",
      "OWASP ZAP baseline is unauthenticated, does not submit forms, and does not run an active attack policy. The spider is capped at 5 minutes and depth 4. The passive scan wait is capped at 20 minutes.",
      "This workflow does not fix, commit, or deploy anything.",
    ],
    schedule: {
      intended: "02:00 Europe/London",
      cronUtc: ["0 1 * * *", "0 2 * * *"],
      limitations: [
        "GitHub Actions cron is UTC only and can start late.",
        "During British Summer Time, 02:00 London is 01:00 UTC. During Greenwich Mean Time it is 02:00 UTC.",
        "The matching UTC slot still runs if London time is from 02:00 through 05:59.",
        "A delay past 05:59 London time skips that day's scheduled scan.",
        "Scheduled workflows run only after this workflow file is on the default branch. GitHub can disable schedules after 60 days without a repository update.",
      ],
    },
    scanners: redactValue(scanners),
    findings: normalised,
  };
  fs.writeFileSync(path.join(outDir, "security-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "security-report.md"), renderMarkdown(report));
  return report;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Security report ${report.londonDate}`);
  lines.push("");
  lines.push(`Conclusion: **${report.conclusion}**`);
  lines.push("");
  lines.push(report.conclusionReason);
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Ref: ${report.target.ref || "unknown"} @ ${report.target.sha || "unknown"}`);
  lines.push("");
  lines.push("## Counts");
  lines.push("");
  for (const [severity, count] of Object.entries(report.counts)) {
    lines.push(`- ${severity}: ${count}`);
  }
  lines.push("");
  lines.push("## Scanners");
  lines.push("");
  for (const scanner of report.scanners) {
    const extra = scanner.parseWarnings ? `, parse warnings ${scanner.parseWarnings}` : "";
    lines.push(`- ${scanner.name}: ${scanner.status}${scanner.error ? ` (${scanner.error})` : ""}${extra}`);
  }
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  for (const note of report.scope) lines.push(`- ${note}`);
  lines.push("");
  lines.push("## Schedule");
  lines.push("");
  for (const note of report.schedule.limitations) lines.push(`- ${note}`);
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  const ordered = [...report.findings].sort((a, b) => rankSeverity(b.severity) - rankSeverity(a.severity));
  if (!ordered.length) {
    lines.push("No findings were recorded by the scanners that completed.");
  }
  for (const item of ordered) {
    const line = item.line ? `:${item.line}` : "";
    lines.push(`### ${item.severity} ${item.ruleId}`);
    lines.push("");
    lines.push(`- Scanner: ${item.scanner}`);
    lines.push(`- Location: ${item.location}${line}`);
    if (item.url) lines.push(`- URL: ${item.url}`);
    lines.push(`- Evidence: ${item.evidence}`);
    lines.push(`- Suggested fix: ${item.suggestedFix}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function summaryLines(report) {
  const lines = [
    `SECURITY_SCAN_CONCLUSION=${report.conclusion}`,
    report.conclusionReason,
    `Counts critical=${report.counts.critical} high=${report.counts.high} medium=${report.counts.medium} low=${report.counts.low} info=${report.counts.info}`,
  ];
  for (const scanner of report.scanners) {
    const extra = scanner.parseWarnings ? ` parseWarnings=${scanner.parseWarnings}` : "";
    lines.push(`Scanner ${scanner.name}: ${scanner.status}${scanner.error ? ` error=${scanner.error}` : ""}${extra}`);
  }
  const important = report.findings.filter((item) => item.severity === "critical" || item.severity === "high");
  for (const item of important.slice(0, 40)) {
    const line = item.line ? `:${item.line}` : "";
    lines.push(`Finding ${item.severity} ${item.scanner} ${item.ruleId} ${item.location}${line}`);
  }
  if (important.length > 40) lines.push(`Additional high or critical findings: ${important.length - 40}`);
  return lines;
}

function isCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCli()) {
  const outDir = process.argv[2] || process.env.OUT_DIR;
  if (!outDir) {
    console.error("OUT_DIR is required");
    process.exit(1);
  }
  const report = buildReport(outDir);
  const text = summaryLines(report).join("\n");
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  }
}
