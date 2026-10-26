import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactGitleaksReport, redactText, stripUrlQuery, truncate } from "./redact.mjs";

const REQUIRED = [
  "npm-audit",
  "osv-scanner",
  "semgrep",
  "gitleaks",
  "app-security-checks",
  "zap",
  "data-patterns",
];

const SEVERITY_RANK = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

export function londonDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function readJson(file) {
  if (!existsSync(file)) return { missing: true };
  const text = readFileSync(file, "utf8").trim();
  if (!text) return { empty: true, value: null };
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "invalid JSON" };
  }
}

function countFindings(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) {
    if (counts[finding.severity] != null) counts[finding.severity] += 1;
  }
  return counts;
}

function mapNpmSeverity(value) {
  const text = String(value || "").toLowerCase();
  if (text === "critical") return "critical";
  if (text === "high") return "high";
  if (text === "moderate" || text === "medium") return "medium";
  if (text === "low") return "low";
  return "high";
}

function npmFix(vuln) {
  if (vuln.fixAvailable && typeof vuln.fixAvailable === "object") {
    return `Upgrade ${vuln.fixAvailable.name} to ${vuln.fixAvailable.version} or newer. Review the advisory before changing the lockfile.`;
  }
  if (vuln.fixAvailable === true) {
    return `A fix is available through a direct dependency update for ${vuln.name}. Review the advisory before upgrading.`;
  }
  return `No patched version was listed for ${vuln.name}. Review the advisory and remove or replace the package.`;
}

export function parseNpmAudit(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { error: "npm audit did not return a JSON object." };
  }
  if (doc.error && !doc.vulnerabilities) {
    const summary = doc.error.summary || doc.error.code || "npm audit failed";
    return { error: redactText(summary) };
  }
  const vulns = doc.vulnerabilities || {};
  const findings = [];
  for (const vuln of Object.values(vulns)) {
    const vias = Array.isArray(vuln.via) ? vuln.via : [];
    const titles = vias
      .map((item) => (typeof item === "object" ? item.title : null))
      .filter(Boolean);
    const url = vias.map((item) => (typeof item === "object" ? item.url : null)).find(Boolean) || null;
    findings.push({
      scanner: "npm-audit",
      ruleId: String(vuln.name),
      severity: mapNpmSeverity(vuln.severity),
      title: titles[0] ? `${vuln.name}: ${titles[0]}` : `${vuln.name} ${vuln.severity || "vulnerability"}`,
      location: "web/package-lock.json",
      line: null,
      url,
      evidence: truncate(`${vuln.name}@${vuln.range || "unknown"} is listed as ${vuln.severity || "unlabelled"}.`),
      remediation: npmFix(vuln),
    });
  }
  return { findings };
}

function osvSeverity(vuln) {
  const labelled = String(vuln.database_specific?.severity || "").toLowerCase();
  if (labelled === "critical") return "critical";
  if (labelled === "high") return "high";
  if (labelled === "moderate" || labelled === "medium") return "medium";
  if (labelled === "low") return "low";
  const numeric = Number(vuln.database_specific?.cvss?.score);
  if (Number.isFinite(numeric)) {
    if (numeric >= 9) return "critical";
    if (numeric >= 7) return "high";
    if (numeric >= 4) return "medium";
    return "low";
  }
  return "high";
}

export function parseOsv(doc) {
  if (!doc || !Array.isArray(doc.results)) {
    return { error: "osv-scanner did not return a results array." };
  }
  const findings = [];
  for (const result of doc.results) {
    const location = result.source?.path || "lockfile";
    for (const pkg of result.packages || []) {
      const name = pkg.package?.name || "unknown package";
      const version = pkg.package?.version || "unknown version";
      for (const vuln of pkg.vulnerabilities || []) {
        const id = vuln.id || vuln.aliases?.[0] || "OSV";
        const severity = osvSeverity(vuln);
        const unlabelled = !vuln.database_specific?.severity && !Number.isFinite(Number(vuln.database_specific?.cvss?.score));
        findings.push({
          scanner: "osv-scanner",
          ruleId: id,
          severity,
          title: `${name}@${version}: ${vuln.summary || id}`,
          location,
          line: null,
          url: Array.isArray(vuln.references) ? vuln.references.find((item) => item?.url)?.url || null : null,
          evidence: truncate(`${id} affects ${name}@${version}.${unlabelled ? " OSV did not label a severity, so this scan treats it as high." : ""}`),
          remediation: `Upgrade ${name} to a version that does not match ${id}, or remove the dependency. Do not apply an automatic fix from this scan.`,
        });
      }
    }
  }
  return { findings };
}

function semgrepSeverity(extra) {
  const impact = String(extra?.metadata?.impact || "").toLowerCase();
  if (impact === "critical") return "critical";
  const level = String(extra?.severity || "").toUpperCase();
  if (level === "ERROR") return "high";
  if (level === "WARNING") return "medium";
  if (level === "INFO") return "low";
  return "medium";
}

export function parseSemgrep(doc) {
  if (!doc || !Array.isArray(doc.results)) {
    return { error: "Semgrep did not return a results array." };
  }
  const findings = doc.results.map((result) => {
    const extra = result.extra || {};
    const remediation = extra.metadata?.remediation || extra.metadata?.fix || extra.fix || "Review the finding and change the code so the matched pattern is no longer possible.";
    return {
      scanner: "semgrep",
      ruleId: result.check_id || "semgrep",
      severity: semgrepSeverity(extra),
      title: extra.message ? String(extra.message).split("\n")[0] : result.check_id,
      location: result.path || "unknown",
      line: result.start?.line ?? null,
      url: null,
      evidence: truncate(extra.lines || extra.message || ""),
      remediation: redactText(remediation),
    };
  });
  const engineErrors = Array.isArray(doc.errors) ? doc.errors.length : 0;
  if (engineErrors > 0) {
    return {
      error: `Semgrep finished with ${engineErrors} engine error(s). Partial results are included and this scanner is not complete.`,
      findings,
    };
  }
  return { findings };
}

export function parseGitleaks(doc) {
  if (doc == null) return { findings: [] };
  if (!Array.isArray(doc)) return { error: "Gitleaks did not return a JSON array." };
  const redacted = redactGitleaksReport(doc);
  return {
    findings: redacted.map((item) => ({
      scanner: "gitleaks",
      ruleId: item.RuleID || "secret",
      severity: "critical",
      title: `Secret pattern ${item.RuleID || "match"}`,
      location: item.File || "unknown",
      line: item.StartLine ?? null,
      url: null,
      evidence: "A secret pattern matched. The secret value was removed from this report.",
      remediation: "Rotate the credential, remove it from the current tree and git history, and load it from a repository or deployment secret.",
    })),
  };
}

function zapSites(doc) {
  if (!doc) return [];
  if (Array.isArray(doc.site)) return doc.site;
  if (doc.site && Array.isArray(doc.site.alerts)) return [doc.site];
  if (Array.isArray(doc.alerts)) return [{ alerts: doc.alerts }];
  return [];
}

function zapSeverity(alert) {
  const code = String(alert.riskcode ?? "");
  if (code === "3" || /^high/i.test(alert.riskdesc || "")) return "high";
  if (code === "2" || /^medium/i.test(alert.riskdesc || "")) return "medium";
  if (code === "1" || /^low/i.test(alert.riskdesc || "")) return "low";
  return "info";
}

export function parseZap(doc) {
  const sites = zapSites(doc);
  if (!doc || typeof doc !== "object" || sites.length === 0 && !Array.isArray(doc.site) && !doc.alerts) {
    return { error: "ZAP did not return a site alert report." };
  }
  const findings = [];
  for (const site of sites) {
    for (const alert of site.alerts || []) {
      const instances = Array.isArray(alert.instances) ? alert.instances : [];
      const urls = instances
        .map((item) => stripUrlQuery(item.uri || item.url || ""))
        .filter(Boolean)
        .slice(0, 5);
      findings.push({
        scanner: "zap",
        ruleId: String(alert.pluginid || alert.alertRef || alert.name || "zap"),
        severity: zapSeverity(alert),
        title: alert.alert || alert.name || "ZAP alert",
        location: urls[0] || site["@name"] || "deployed site",
        line: null,
        url: urls[0] || null,
        evidence: truncate(alert.desc || alert.evidence || "ZAP passive alert."),
        remediation: truncate(alert.solution || "Review the alert and change the deployed response or application configuration.", 600),
      });
    }
  }
  return { findings };
}

export function parseDataPatterns(doc) {
  const files = Array.isArray(doc?.files) ? doc.files : null;
  if (!files) return { error: "Data pattern scan did not return a file list." };
  return {
    findings: files.map((file) => ({
      scanner: "data-patterns",
      ruleId: "high-confidence-key-pattern",
      severity: "critical",
      title: "High-confidence credential pattern in generated data",
      location: file,
      line: null,
      url: null,
      evidence: "A key pattern matched in this file. The matching text was not copied into the report.",
      remediation: "Remove the credential from the data file and history, rotate it, and keep generated catalogues free of secrets.",
    })),
  };
}

function parseAppChecks(doc) {
  if (!doc || !Array.isArray(doc.findings)) {
    return { error: "Application checks did not return findings." };
  }
  return {
    findings: doc.findings.map((item) => ({
      ...item,
      evidence: truncate(item.evidence || ""),
      remediation: redactText(item.remediation || ""),
      title: redactText(item.title || item.ruleId || "Application check"),
    })),
    coverageNotes: doc.coverageNotes || [],
  };
}

const PARSERS = {
  "npm-audit": parseNpmAudit,
  "osv-scanner": parseOsv,
  semgrep: parseSemgrep,
  gitleaks: parseGitleaks,
  zap: parseZap,
  "data-patterns": parseDataPatterns,
  "app-security-checks": parseAppChecks,
};

const OUTPUTS = {
  "npm-audit": "npm-audit.json",
  "osv-scanner": "osv.json",
  semgrep: "semgrep.json",
  gitleaks: "gitleaks.json",
  zap: "zap.json",
  "data-patterns": "data-patterns.json",
  "app-security-checks": "app-checks.json",
};

function loadStatus(rawDir, id) {
  const statusPath = path.join(rawDir, "status", `${id}.json`);
  const loaded = readJson(statusPath);
  if (loaded.missing) {
    return { id, status: "failed", detail: "The scanner did not record a status file.", coverageNotes: [] };
  }
  if (loaded.error || !loaded.value) {
    return { id, status: "failed", detail: "The scanner status file was not valid JSON.", coverageNotes: [] };
  }
  return {
    id,
    status: loaded.value.status === "completed" ? "completed" : "failed",
    detail: redactText(loaded.value.detail || ""),
    privateDetail: truncate(loaded.value.privateDetail || "", 1500),
    coverageNotes: loaded.value.coverageNotes || [],
  };
}

export function buildReport({ rawDir, commit = "", ref = "", targetUrl = "", generatedAt = new Date() }) {
  const scanners = [];
  const findings = [];
  for (const id of REQUIRED) {
    const status = loadStatus(rawDir, id);
    const output = readJson(path.join(rawDir, OUTPUTS[id]));
    let parsed = { findings: [] };
    if (status.status === "completed") {
      if (output.missing || output.error || output.empty) {
        status.status = "failed";
        status.detail = output.error || `${id} completed without a readable JSON report.`;
      } else {
        parsed = PARSERS[id](output.value);
        if (parsed.error) {
          status.status = "failed";
          status.detail = parsed.error;
        }
        if (parsed.coverageNotes) status.coverageNotes.push(...parsed.coverageNotes);
      }
    }
    const scannerFindings = (parsed.findings || []).map((item) => ({
      ...item,
      title: redactText(item.title),
      evidence: redactText(item.evidence),
      remediation: redactText(item.remediation),
    }));
    status.counts = countFindings(scannerFindings);
    scanners.push(status);
    findings.push(...scannerFindings);
  }

  findings.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  const counts = countFindings(findings);
  const failed = scanners.filter((scanner) => scanner.status !== "completed");
  const blocking = findings.filter((item) => item.severity === "critical" || item.severity === "high");
  const gaps = scanners.some((scanner) => scanner.coverageNotes.length > 0);
  let result = "clean";
  let resultDetail = "CLEAN: every required scanner finished, no coverage limits were recorded, and there were no high or critical findings.";
  if (failed.length > 0) {
    result = "scan_failure";
    resultDetail = "SCAN FAILURE: one or more checks did not finish. Do not treat this run as clean.";
    if (blocking.length > 0) {
      resultDetail += " Completed checks also reported high or critical findings.";
    }
  } else if (blocking.length > 0) {
    result = "findings";
    resultDetail = "FINDINGS: the workflow failed because high or critical issues were found. The scanners finished, so this is not a scanner crash.";
  } else if (gaps) {
    result = "no_high_critical";
    resultDetail = "No high or critical findings in the scanned scope. Coverage limits are listed on the scanners. This is not a claim that every historical file was scanned.";
  }

  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    londonDate: londonDate(generatedAt),
    commit,
    ref,
    targetUrl: targetUrl || null,
    result,
    resultDetail,
    counts,
    scanners,
    findings,
  };
}

function publicLocation(finding) {
  if (finding.scanner === "zap") return stripUrlQuery(finding.url || finding.location);
  return finding.line ? `${finding.location}:${finding.line}` : finding.location;
}

export function renderMarkdown(report, { includeEvidence }) {
  const lines = [
    "# Legal Shaman security report",
    "",
    `London date: ${report.londonDate}`,
    `Generated: ${report.generatedAt}`,
    `Commit: ${report.commit || "unknown"}`,
    `Ref: ${report.ref || "unknown"}`,
    `ZAP target: ${report.targetUrl || "not resolved"}`,
    "",
    `Result: ${report.result}`,
    "",
    report.resultDetail,
    "",
    "## Scanner status",
    "",
    "| Scanner | Status | Critical | High | Medium | Low | Info | Detail |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const scanner of report.scanners) {
    const counts = scanner.counts || {};
    lines.push(`| ${scanner.id} | ${scanner.status} | ${counts.critical || 0} | ${counts.high || 0} | ${counts.medium || 0} | ${counts.low || 0} | ${counts.info || 0} | ${scanner.detail || ""} |`);
    for (const note of scanner.coverageNotes || []) {
      lines.push(`| ${scanner.id} coverage | note |  |  |  |  |  | ${note} |`);
    }
    if (includeEvidence && scanner.privateDetail) {
      lines.push("", `Scanner log (${scanner.id}, redacted):`, "", "```", scanner.privateDetail, "```", "");
    }
  }
  lines.push("", "## Findings", "");
  if (!includeEvidence) {
    lines.push(`Recorded findings: ${report.findings.length}.`);
    if (report.artifactStored === false) {
      lines.push("The encrypted report was not stored. Evidence was left out of this summary.");
    } else {
      lines.push("Locations, redacted evidence, and suggested fixes are in the encrypted report.");
    }
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
  if (report.findings.length === 0) {
    lines.push("No findings were recorded from the scanners that completed.");
    lines.push("");
  }
  for (const finding of report.findings) {
    lines.push(`### ${finding.severity.toUpperCase()} ${finding.title}`);
    lines.push("");
    lines.push(`- Scanner: ${finding.scanner}`);
    lines.push(`- Rule: ${finding.ruleId}`);
    lines.push(`- Location: ${publicLocation(finding)}`);
    if (includeEvidence) {
      lines.push(`- Evidence: ${finding.evidence || ""}`);
      lines.push(`- Suggested fix: ${finding.remediation || ""}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = {
    rawDir: "",
    outDir: "",
    commit: "",
    ref: "",
    targetUrl: "",
    rewrite: false,
    artifactStored: true,
    artifactDetail: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--rewrite") {
      args.rewrite = true;
      continue;
    }
    const value = argv[++i];
    if (key === "--raw") args.rawDir = value;
    else if (key === "--out") args.outDir = value;
    else if (key === "--commit") args.commit = value;
    else if (key === "--ref") args.ref = value;
    else if (key === "--target") args.targetUrl = value;
    else if (key === "--artifact-stored") args.artifactStored = value === "true";
    else if (key === "--artifact-detail") args.artifactDetail = value;
  }
  return args;
}

export function noteArtifact(report, stored, detail) {
  report.artifactStored = stored;
  if (!stored) {
    const earlier = report.resultDetail;
    report.result = "scan_failure";
    report.resultDetail = `SCAN FAILURE: ${detail} Do not treat this run as clean. Earlier scanner result: ${earlier}`;
  }
  return report;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.rewrite) {
    const jsonPath = path.join(args.outDir, "security-report.json");
    const report = noteArtifact(JSON.parse(readFileSync(jsonPath, "utf8")), args.artifactStored, args.artifactDetail);
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    writeFileSync(path.join(args.outDir, "security-report.md"), renderMarkdown(report, { includeEvidence: true }));
    writeFileSync(path.join(args.outDir, "public-summary.md"), renderMarkdown(report, { includeEvidence: false }));
    process.stdout.write(`${report.result}\n`);
    return;
  }
  const report = buildReport(args);
  mkdirSync(args.outDir, { recursive: true });
  writeFileSync(path.join(args.outDir, "security-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(args.outDir, "security-report.md"), renderMarkdown(report, { includeEvidence: true }));
  writeFileSync(path.join(args.outDir, "public-summary.md"), renderMarkdown(report, { includeEvidence: false }));
  process.stdout.write(`${report.result}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
