import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isHighOrCritical, repoRoot, reportDir, semgrepSeverity, tryReadJson } from "./lib.mjs";
import { redactText } from "./redact.mjs";

export const REQUIRED_SCANNERS = [
  "npm-audit",
  "osv-scanner",
  "gitleaks",
  "semgrep",
  "zap-baseline",
  "application-checks",
];

export function mapSeverityWord(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "") return "unspecified";
  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    if (numeric >= 9) return "critical";
    if (numeric >= 7) return "high";
    if (numeric >= 4) return "medium";
    if (numeric > 0) return "low";
    return "info";
  }
  if (text === "critical") return "critical";
  if (text === "high") return "high";
  if (text === "moderate" || text === "medium" || text === "warning") return "medium";
  if (text === "low") return "low";
  if (text === "info" || text === "informational") return "info";
  return "unspecified";
}

export function decideConclusion({ statuses, findings }) {
  const failedScanners = REQUIRED_SCANNERS.filter((name) => statuses[name] !== "completed");
  const highOrCriticalCount = findings.filter((finding) => isHighOrCritical(finding.severity)).length;
  const unspecifiedCount = findings.filter((finding) => finding.severity === "unspecified").length;
  let conclusion = "clean";
  if (failedScanners.length > 0) conclusion = "incomplete";
  else if (highOrCriticalCount > 0) conclusion = "findings";
  return { conclusion, highOrCriticalCount, unspecifiedCount, failedScanners };
}

function git(command) {
  try {
    return execSync(command, { encoding: "utf8", cwd: process.cwd() }).trim();
  } catch {
    return "";
  }
}

function displayPath(file) {
  let normalized = String(file || "").split("\\").join("/");
  if (normalized.startsWith("/src/")) normalized = normalized.slice("/src/".length);
  const root = repoRoot.split("\\").join("/");
  if (normalized === root) return "";
  if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
  return normalized;
}

function locationLabel(location = {}) {
  if (location.url) return location.url;
  if (location.file && location.line) return `${location.file}:${location.line}`;
  if (location.file) return location.file;
  return "unspecified location";
}

function pushFinding(list, partial) {
  list.push({
    scanner: partial.scanner,
    severity: partial.severity,
    title: redactText(partial.title).slice(0, 240),
    location: partial.location,
    evidence: redactText(partial.evidence || "").slice(0, 500),
    suggestedFix: redactText(partial.suggestedFix || "").slice(0, 500),
    category: partial.category || partial.scanner,
  });
}

function npmFindings(document, list) {
  const vulns = document?.vulnerabilities;
  if (!vulns || typeof vulns !== "object") return false;
  for (const vuln of Object.values(vulns)) {
    const via = Array.isArray(vuln.via) ? vuln.via.find((item) => item && typeof item === "object") : null;
    const advisory = via?.url || via?.title || vuln.name;
    let suggestedFix = "Upgrade the affected package to a release that includes the advisory fix.";
    if (vuln.fixAvailable && typeof vuln.fixAvailable === "object") {
      suggestedFix = `Upgrade ${vuln.fixAvailable.name} to ${vuln.fixAvailable.version}.`;
      if (vuln.fixAvailable.isSemVerMajor) {
        suggestedFix += " The patched release is a major upgrade, so review the changelog before deploying.";
      }
    } else if (vuln.fixAvailable === false) {
      suggestedFix = `No automatic fix is recorded for ${vuln.name}. Review ${advisory} and replace or remove the package.`;
    }
    pushFinding(list, {
      scanner: "npm-audit",
      severity: mapSeverityWord(vuln.severity),
      title: `${vuln.name} ${vuln.severity || "unspecified"}: ${via?.title || advisory || "advisory"}`,
      location: { file: displayPath("web/package-lock.json") },
      evidence: `${vuln.name} ${vuln.range || ""}. ${via?.title || ""}`.trim(),
      suggestedFix,
      category: "dependencies",
    });
  }
  return true;
}

function fixedVersions(vuln) {
  const versions = new Set();
  for (const affected of vuln.affected || []) {
    for (const range of affected.ranges || []) {
      for (const event of range.events || []) {
        if (event.fixed) versions.add(event.fixed);
      }
    }
  }
  return [...versions];
}

function osvFindings(document, list) {
  if (!Array.isArray(document?.results)) return false;
  for (const result of document.results) {
    const file = displayPath(result.source?.path || "web/package-lock.json");
    for (const pkg of result.packages || []) {
      const name = pkg.package?.name || "unknown";
      const version = pkg.package?.version || "unknown";
      const groupSeverity = new Map();
      for (const group of pkg.groups || []) {
        for (const id of group.ids || []) groupSeverity.set(id, group.max_severity || "");
      }
      for (const vuln of pkg.vulnerabilities || []) {
        const severity = mapSeverityWord(
          groupSeverity.get(vuln.id) || vuln.database_specific?.severity || "",
        );
        const fixed = fixedVersions(vuln);
        pushFinding(list, {
          scanner: "osv-scanner",
          severity,
          title: `${vuln.id}: ${name}@${version}`,
          location: { file },
          evidence: vuln.summary || vuln.details || vuln.id,
          suggestedFix: fixed.length
            ? `Upgrade ${name} to ${fixed.join(" or ")} or another unaffected version.`
            : `Review ${vuln.id} and upgrade ${name} off ${version}.`,
          category: "dependencies",
        });
      }
    }
  }
  return true;
}

function gitleaksFindings(document, list) {
  if (!Array.isArray(document)) return false;
  for (const row of document) {
    const file = displayPath(row.File || "unknown");
    const line = Number(row.StartLine) || undefined;
    pushFinding(list, {
      scanner: "gitleaks",
      severity: "critical",
      title: `Secret match: ${row.RuleID || "gitleaks"}`,
      location: line ? { file, line } : { file },
      evidence: `Rule ${row.RuleID || "unknown"} matched in ${file}${row.Commit ? ` at commit ${String(row.Commit).slice(0, 12)}` : ""}. The matched value is redacted.`,
      suggestedFix: "Rotate the credential, remove it from the current tree and from git history, and store the replacement in GitHub Actions secrets or the host environment. Do not commit the new value.",
      category: "secrets",
    });
  }
  return true;
}

function semgrepFindings(document, list) {
  if (!Array.isArray(document?.results)) return false;
  for (const result of document.results) {
    const file = displayPath(result.path || "unknown");
    const line = Number(result.start?.line) || undefined;
    const message = result.extra?.message || result.check_id || "Semgrep finding";
    const fix = result.extra?.metadata?.suggested_fix || result.extra?.fix || message;
    pushFinding(list, {
      scanner: "semgrep",
      severity: semgrepSeverity(result.extra?.severity),
      title: `${result.check_id || "semgrep"}: ${message}`,
      location: line ? { file, line } : { file },
      evidence: message,
      suggestedFix: typeof fix === "string" ? fix : message,
      category: result.extra?.metadata?.category || "sast",
    });
  }
  return true;
}

function zapFindings(document, list) {
  const sites = document?.site || document?.sites || [];
  if (!Array.isArray(sites)) return false;
  for (const site of sites) {
    for (const alert of site.alerts || []) {
      const risk = Number(alert.riskcode);
      const severity = risk === 3 ? "high" : risk === 2 ? "medium" : risk === 1 ? "low" : risk === 0 ? "info" : "unspecified";
      const instances = Array.isArray(alert.instances) ? alert.instances.slice(0, 5) : [];
      const url = instances[0]?.uri || site["@name"] || "";
      const evidence = instances
        .map((item) => item.evidence)
        .filter(Boolean)
        .join(" | ");
      pushFinding(list, {
        scanner: "zap-baseline",
        severity,
        title: alert.alert || alert.name || "ZAP alert",
        location: url ? { url } : { file: "deployed-site" },
        evidence: evidence || alert.desc || alert.alert || "ZAP baseline alert",
        suggestedFix: alert.solution || "Apply the ZAP baseline remediation for this alert and rescan.",
        category: "zap",
      });
    }
  }
  return true;
}

function loadStatuses(dir) {
  const statuses = {};
  const details = {};
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".status.json")) continue;
    const body = tryReadJson(path.join(dir, name));
    if (!body?.scanner) continue;
    statuses[body.scanner] = body.status;
    details[body.scanner] = body.detail || "";
  }
  return { statuses, details };
}

function markdownReport(report) {
  const lines = [];
  lines.push(`# Legal Shaman security report ${report.reportDate}`);
  lines.push("");
  lines.push(`Conclusion: **${report.conclusion}**.`);
  lines.push("");
  if (report.conclusion === "clean") {
    lines.push("No high or critical findings were recorded in the required checks that finished.");
  } else if (report.conclusion === "findings") {
    lines.push("High or critical findings were recorded. This is not a clean result.");
  } else {
    lines.push("The scan is incomplete. This is not a clean result.");
  }
  lines.push("Coverage gaps are listed below. A clean conclusion does not mean every possible check ran.");
  lines.push("");
  lines.push(`Scanned at: ${report.scannedAt}`);
  lines.push(`London time: ${report.londonTime}`);
  lines.push(`Commit: ${report.commit || "unknown"}`);
  lines.push(`Ref: ${report.ref || "unknown"}`);
  lines.push(`Target URL: ${report.targetUrl || "not resolved"}`);
  lines.push(`High or critical count: ${report.highOrCriticalCount}`);
  lines.push("");
  lines.push("## Scanners");
  lines.push("");
  for (const [name, status] of Object.entries(report.scanners)) {
    lines.push(`- ${name}: ${status}. ${report.scannerDetails[name] || ""}`);
  }
  lines.push("");
  lines.push("## Coverage gaps");
  lines.push("");
  for (const gap of report.coverageGaps) {
    lines.push(`- ${gap.item}: ${gap.detail}`);
  }
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  if (report.findings.length === 0) {
    lines.push("No findings were produced by the checks that finished.");
  }
  for (const item of report.findings) {
    const where = item.location?.url
      || (item.location?.file ? `${item.location.file}${item.location.line ? `:${item.location.line}` : ""}` : "unspecified");
    lines.push(`### ${item.severity}: ${item.title}`);
    lines.push("");
    lines.push(`- Scanner: ${item.scanner}`);
    lines.push(`- Location: ${where}`);
    lines.push(`- Evidence: ${item.evidence}`);
    lines.push(`- Suggested fix: ${item.suggestedFix}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function buildReport({ dir, statuses, details, findings, coverageGaps, targetUrl }) {
  const decision = decideConclusion({ statuses, findings });
  const scanners = {};
  for (const name of REQUIRED_SCANNERS) scanners[name] = statuses[name] || "missing";
  const now = new Date();
  return {
    project: "Legal Shaman",
    reportDate: now.toISOString().slice(0, 10),
    scannedAt: now.toISOString(),
    londonTime: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      dateStyle: "full",
      timeStyle: "short",
    }).format(now),
    commit: git("git rev-parse HEAD"),
    ref: process.env.GITHUB_REF || git("git rev-parse --abbrev-ref HEAD"),
    targetUrl: targetUrl || "",
    conclusion: decision.conclusion,
    highOrCriticalCount: decision.highOrCriticalCount,
    unspecifiedCount: decision.unspecifiedCount,
    failedScanners: decision.failedScanners,
    reportStored: null,
    scanners,
    scannerDetails: details,
    coverageGaps,
    findings: findings.sort((a, b) => {
      const rank = { critical: 5, high: 4, medium: 3, low: 2, info: 1, unspecified: 0 };
      return (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0);
    }),
    reportDirectory: dir,
  };
}

function staticGaps(extra) {
  return [
    ...extra,
    {
      item: "Secret scan scope",
      detail: "Gitleaks scans git history reachable from HEAD, skips data/ and web/data/, and skips files larger than 2 MB. Other branches are not scanned. Skipped paths are not a clean secret scan result.",
    },
    {
      item: "ZAP scope",
      detail: "OWASP ZAP baseline is a passive spider of the public site for about one minute, depth 2, two threads, with form posts disabled. It does not log in, does not crawl the whole directory, and does not run an active or authenticated scan.",
    },
    {
      item: "Semgrep scope",
      detail: "Semgrep runs locally from the pinned image with metrics off and without a Semgrep Cloud token. It downloads rule packs. It does not upload source code. Generated data directories are excluded.",
    },
    {
      item: "Dependency query scope",
      detail: "npm audit and OSV send package names and versions to the public advisory databases. They do not send application source or user data. OSV fix and npm audit fix are not run.",
    },
  ];
}

function main() {
  const dir = reportDir();
  fs.mkdirSync(dir, { recursive: true });
  const { statuses, details } = loadStatuses(dir);
  const findings = [];
  const gaps = [];

  const npm = tryReadJson(path.join(dir, "npm-audit.json"));
  if (npm) {
    if (!npmFindings(npm, findings) && statuses["npm-audit"] === "completed") {
      statuses["npm-audit"] = "failed";
      details["npm-audit"] = "npm audit JSON did not contain a vulnerabilities object.";
    }
  }

  const osv = tryReadJson(path.join(dir, "osv.json"));
  if (osv) {
    if (!osvFindings(osv, findings) && statuses["osv-scanner"] === "completed") {
      statuses["osv-scanner"] = "failed";
      details["osv-scanner"] = "OSV JSON did not contain a results array.";
    }
  }

  const leaks = tryReadJson(path.join(dir, "sanitized", "gitleaks.json"));
  if (leaks) gitleaksFindings(leaks, findings);

  const semgrep = tryReadJson(path.join(dir, "sanitized", "semgrep.json"));
  if (semgrep) {
    semgrepFindings(semgrep, findings);
    const errors = Array.isArray(semgrep.errors) ? semgrep.errors.length : 0;
    if (errors > 0) {
      gaps.push({
        item: "Semgrep file errors",
        detail: `Semgrep reported ${errors} file errors. Findings only cover files it parsed.`,
      });
    }
  }

  const zap = tryReadJson(path.join(dir, "zap", "zap.json"));
  if (zap) zapFindings(zap, findings);

  const app = tryReadJson(path.join(dir, "application-checks.json"));
  if (app) {
    for (const item of app.findings || []) {
      pushFinding(findings, item);
    }
    gaps.push(...(app.coverageGaps || []));
  }

  let targetUrl = "";
  try {
    targetUrl = fs.readFileSync(path.join(dir, "target-url.txt"), "utf8").trim();
  } catch {
    targetUrl = "";
  }

  const report = buildReport({
    dir,
    statuses,
    details,
    findings,
    coverageGaps: staticGaps(gaps),
    targetUrl,
  });
  delete report.reportDirectory;
  fs.writeFileSync(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "report.md"), markdownReport(report));
  fs.writeFileSync(path.join(dir, "report-date.txt"), report.reportDate);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `date=${report.reportDate}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `conclusion=${report.conclusion}\n`);
  }
  console.log(`Report conclusion: ${report.conclusion}. High or critical: ${report.highOrCriticalCount}. Failed scanners: ${report.failedScanners.join(", ") || "none"}.`);
  console.log(`Locations recorded: ${report.findings.slice(0, 8).map((item) => locationLabel(item.location)).join(", ") || "none"}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
