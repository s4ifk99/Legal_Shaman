import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { severityFromAdvisory } from "./cvss.mjs";
import { clip, redactText } from "./redact.mjs";

const SEVERITIES = ["critical", "high", "medium", "low", "info"];

function emptyCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function countFindings(findings) {
  const counts = emptyCounts();
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] || 0) + 1;
  return counts;
}

function readJson(file) {
  if (!file || !fs.existsSync(file)) return { ok: false, value: null, reason: "report file missing" };
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, "utf8")), reason: "" };
  } catch (error) {
    return { ok: false, value: null, reason: `report file is not JSON (${error.message})` };
  }
}

function readText(file) {
  if (!file || !fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8").trim();
}

export function finding(partial) {
  const severity = SEVERITIES.includes(partial.severity) ? partial.severity : "high";
  return {
    severity,
    category: partial.category || "unspecified",
    rule: clip(partial.rule || "unspecified", 180),
    location: clip(partial.location || "unspecified", 240),
    evidence: clip(partial.evidence || "", 280),
    suggestion: clip(partial.suggestion || "Review the finding and apply a fix in a separate change.", 360),
  };
}

function fixedVersions(vuln) {
  const fixed = new Set();
  for (const affected of vuln.affected || []) {
    for (const range of affected.ranges || []) {
      for (const event of range.events || []) {
        if (event.fixed) fixed.add(String(event.fixed));
      }
    }
  }
  return [...fixed];
}

export function parseNpmAudit(doc) {
  const vulns = doc?.vulnerabilities;
  if (!vulns || typeof vulns !== "object") {
    return { ok: false, findings: [], reason: "npm audit JSON has no vulnerabilities object" };
  }
  const findings = [];
  for (const [name, meta] of Object.entries(vulns)) {
    const severity = { critical: "critical", high: "high", moderate: "medium", medium: "medium", low: "low", info: "info" }[
      meta.severity
    ];
    if (!severity) continue;
    const titles = [];
    const viaNames = [];
    for (const via of meta.via || []) {
      if (typeof via === "string") viaNames.push(via);
      else if (via && typeof via === "object") titles.push(via.title || via.url || via.name || "advisory");
    }
    const fix = meta.fixAvailable;
    let suggestion = "No fixed version is recorded. Review the advisory before upgrading. This scan does not edit files.";
    if (fix && typeof fix === "object" && fix.version) {
      suggestion = `Upgrade ${fix.name || name} to ${fix.version} or newer after review. This scan does not edit files.`;
    } else if (fix === true) {
      suggestion = "npm records a fix as available. Upgrade after review. This scan does not edit files.";
    }
    findings.push(
      finding({
        severity,
        category: "dependencies",
        rule: titles[0] ? `npm-audit: ${titles[0]}` : `npm-audit: ${name}`,
        location: `web/package-lock.json (${name}${meta.range ? `, ${meta.range}` : ""})`,
        evidence: titles.length ? titles.join("; ") : `Reached via ${viaNames.join(", ") || "a transitive dependency"}.`,
        suggestion,
      }),
    );
  }
  return { ok: true, findings, reason: "" };
}

export function parseOsv(doc, lockfile) {
  if (!doc || !Array.isArray(doc.results)) {
    return { ok: false, findings: [], reason: "OSV JSON has no results array" };
  }
  const findings = [];
  for (const result of doc.results) {
    for (const pkg of result.packages || []) {
      const name = pkg.package?.name || "unknown";
      const version = pkg.package?.version || "unknown";
      for (const vuln of pkg.vulnerabilities || []) {
        const fixed = fixedVersions(vuln);
        findings.push(
          finding({
            severity: severityFromAdvisory(vuln),
            category: "dependencies",
            rule: vuln.id || "OSV",
            location: `${lockfile} (${name}@${version})`,
            evidence: vuln.summary || vuln.details || vuln.id || "OSV advisory",
            suggestion: fixed.length
              ? `Upgrade ${name} to ${fixed.join(" or ")} or newer after review. This scan does not edit files.`
              : `Review ${vuln.id || "the OSV advisory"} and upgrade ${name}. This scan does not edit files.`,
          }),
        );
      }
    }
  }
  return { ok: true, findings, reason: "" };
}

export function parseGitleaks(doc) {
  if (!Array.isArray(doc)) return { ok: false, findings: [], reason: "gitleaks JSON is not an array" };
  const findings = doc.map((item) =>
    finding({
      severity: "critical",
      category: "secrets",
      rule: `gitleaks:${item.RuleID || "secret"}`,
      location: `${item.File || "unknown"}:${item.StartLine || 1}`,
      evidence: `Rule ${item.RuleID || "secret"} matched. Secret value redacted.`,
      suggestion: "Revoke the credential, remove it from the branch, and store a replacement in a repository or host secret. This scan does not edit files or rewrite history.",
    }),
  );
  return { ok: true, findings, reason: "" };
}

export function parseSemgrep(doc) {
  if (!doc || !Array.isArray(doc.results)) {
    return { ok: false, findings: [], reason: "Semgrep JSON has no results array" };
  }
  const findings = doc.results.map((result) => {
    const impact = String(result.extra?.metadata?.impact || "").toLowerCase();
    const confidence = String(result.extra?.metadata?.confidence || "").toLowerCase();
    const raw = String(result.extra?.severity || "").toLowerCase();
    let severity = "high";
    if (impact === "critical") severity = "critical";
    else if (raw === "error" || raw === "high" || (impact === "high" && raw !== "warning" && raw !== "info")) {
      severity = confidence === "low" ? "medium" : "high";
    } else if (raw === "warning" || impact === "medium" || impact === "high") severity = "medium";
    else if (raw === "info" || impact === "low") severity = "low";
    const suggestion = result.extra?.metadata?.suggestion || result.extra?.message || "Review this static finding.";
    return finding({
      severity,
      category: result.extra?.metadata?.category || "sast",
      rule: result.check_id || "semgrep",
      location: `${result.path || "unknown"}:${result.start?.line || 1}`,
      evidence: result.extra?.message || result.check_id || "Semgrep finding",
      suggestion,
    });
  });
  const errors = Array.isArray(doc.errors) ? doc.errors.length : 0;
  return { ok: true, findings, reason: errors ? `${errors} Semgrep file errors` : "" };
}

export function parseZap(doc) {
  const sites = doc?.site || doc?.sites || [];
  if (!Array.isArray(sites)) return { ok: false, findings: [], reason: "ZAP JSON has no site array" };
  const findings = [];
  for (const site of sites) {
    for (const alert of site.alerts || []) {
      const risk = String(alert.riskcode ?? "");
      const severity = risk === "3" ? "high" : risk === "2" ? "medium" : risk === "1" ? "low" : "info";
      const instances = alert.instances || [];
      const urls = instances
        .slice(0, 3)
        .map((instance) => instance.uri)
        .filter(Boolean);
      const evidenceBits = instances
        .slice(0, 1)
        .map((instance) => instance.evidence || instance.param || "")
        .filter(Boolean);
      findings.push(
        finding({
          severity,
          category: "zap-baseline",
          rule: `zap:${alert.pluginid || alert.alertRef || alert.alert || "alert"}`,
          location: urls[0] || site["@name"] || "target",
          evidence: `${alert.alert || alert.name || "ZAP alert"}${evidenceBits.length ? `; ${evidenceBits[0]}` : ""}`,
          suggestion: String(alert.solution || "Review the alert and change the deployed configuration in a separate change.").replace(/<[^>]+>/g, " "),
        }),
      );
    }
  }
  return { ok: true, findings, reason: "" };
}

function scannerFailed(exitText, parsedOk) {
  if (!parsedOk) return true;
  if (exitText === "") return true;
  const code = Number(exitText);
  return Number.isNaN(code);
}

function checkFrom(name, details) {
  const findings = details.findings || [];
  let status = "completed";
  if (details.failed) status = "scan_failed";
  return {
    name,
    status,
    reason: redactText(details.reason || ""),
    limitations: details.limitations || [],
    scope: details.scope || [],
    counts: countFindings(findings),
    findings,
  };
}

export function buildReport(dir) {
  const checks = [];
  const target = readJson(path.join(dir, "target.json"));
  const artifact = readJson(path.join(dir, "artifact-status.json"));

  const custom = readJson(path.join(dir, "custom-checks.json"));
  checks.push(
    checkFrom("project-checks", {
      failed: !custom.ok,
      reason: custom.ok ? "" : custom.reason,
      findings: custom.ok ? (custom.value.findings || []).map(finding) : [],
      limitations: custom.ok ? custom.value.limitations || [] : [],
      scope: [
        "Authentication and authorisation gates on admin and internal routes.",
        "SQL injection patterns in unsafe Prisma raw queries.",
        "XSS sinks, hardcoded public analytics keys, ignored TypeScript build errors, and persisted raw search queries.",
        "web/data content indexes are not pattern-scanned.",
      ],
    }),
  );

  const gitleaksExit = readText(path.join(dir, "gitleaks.exit"));
  const gitleaks = readJson(path.join(dir, "gitleaks.json"));
  const gitleaksParsed = gitleaks.ok ? parseGitleaks(gitleaks.value) : { ok: false, findings: [], reason: gitleaks.reason };
  const gitleaksCode = Number(gitleaksExit);
  checks.push(
    checkFrom("gitleaks", {
      failed: scannerFailed(gitleaksExit, gitleaksParsed.ok) || gitleaksCode > 1,
      reason: gitleaksParsed.ok ? "" : gitleaksParsed.reason,
      findings: gitleaksParsed.findings,
      scope: [
        "Current checkout only. Git history is not scanned.",
        "node_modules and .next are skipped. LinkedIn client-id hits under web/data are ignored as generated-text false positives. Other rules still scan web/data.",
        "Secret values are redacted before the report is stored.",
      ],
    }),
  );

  const semgrepExit = readText(path.join(dir, "semgrep.exit"));
  const semgrep = readJson(path.join(dir, "semgrep.json"));
  const semgrepParsed = semgrep.ok ? parseSemgrep(semgrep.value) : { ok: false, findings: [], reason: semgrep.reason };
  const semgrepCode = Number(semgrepExit);
  checks.push(
    checkFrom("semgrep", {
      failed: scannerFailed(semgrepExit, semgrepParsed.ok) || semgrepCode > 1,
      reason: semgrepParsed.ok ? "" : semgrep.reason,
      findings: semgrepParsed.findings,
      limitations: semgrepParsed.reason ? [semgrepParsed.reason] : [],
      scope: [
        "Local Semgrep OSS with metrics and version checks disabled. Source is not uploaded to Semgrep Cloud.",
        "Rules: repository rules plus p/javascript, p/typescript, p/nextjs, p/nodejs, and p/owasp-top-ten.",
        "web/data, node_modules, and .next are excluded.",
      ],
    }),
  );

  const npmExit = readText(path.join(dir, "npm-audit.exit"));
  const npm = readJson(path.join(dir, "npm-audit.json"));
  const npmParsed = npm.ok ? parseNpmAudit(npm.value) : { ok: false, findings: [], reason: npm.reason };
  const npmCode = Number(npmExit);
  checks.push(
    checkFrom("npm-audit", {
      failed: scannerFailed(npmExit, npmParsed.ok) || npmCode > 1,
      reason: npmParsed.ok ? "" : npmParsed.reason,
      findings: npmParsed.findings,
      scope: [
        "npm audit of web/package-lock.json, including direct and transitive dependencies.",
        "Package names and versions are sent to the npm advisory database. Source code is not.",
      ],
    }),
  );

  const osvFindings = [];
  const osvReasons = [];
  let osvFailed = false;
  for (const [file, lockfile] of [
    ["osv-npm.json", "web/package-lock.json"],
    ["osv-python.json", "scripts/exa/requirements-exa.txt"],
  ]) {
    const exitText = readText(path.join(dir, file.replace(".json", ".exit")));
    const parsedFile = readJson(path.join(dir, file));
    const parsed = parsedFile.ok ? parseOsv(parsedFile.value, lockfile) : { ok: false, findings: [], reason: parsedFile.reason };
    const code = Number(exitText);
    if (scannerFailed(exitText, parsed.ok) || code > 1) {
      osvFailed = true;
      osvReasons.push(`${lockfile}: ${parsed.reason || `exit ${exitText || "missing"}`}`);
    }
    osvFindings.push(...parsed.findings);
  }
  checks.push(
    checkFrom("osv-scanner", {
      failed: osvFailed,
      reason: osvReasons.join("; "),
      findings: osvFindings,
      limitations: [
        "scripts/update-legal-aid-providers.py, web/scripts/update-legal-aid-listings-adl.py, and web/scripts/embed-listings.py import pandas, requests, or numpy without a lockfile. Those versions were not queried.",
      ],
      scope: [
        "OSV-Scanner 2.x lockfile scan. Package names and versions are sent to OSV and deps.dev. Source code is not.",
        "The scanner fix command is not used.",
      ],
    }),
  );

  const zapExit = readText(path.join(dir, "zap.exit"));
  const zapError = readText(path.join(dir, "zap-error.txt"));
  const zap = readJson(path.join(dir, "zap.json"));
  const zapParsed = zap.ok ? parseZap(zap.value) : { ok: false, findings: [], reason: zap.reason };
  const zapCode = Number(zapExit);
  checks.push(
    checkFrom("zap-baseline", {
      failed: Boolean(zapError) || scannerFailed(zapExit, zapParsed.ok) || zapCode > 2,
      reason: zapError || (zapParsed.ok ? "" : zapParsed.reason),
      findings: zapParsed.findings,
      scope: [
        "OWASP ZAP baseline only: passive scan and a bounded spider. Active attacks, authentication, and form posts are not used.",
        "Spider depth 2, at most 20 children per node, 2 spider minutes, 12 minute cap.",
        target.ok ? `Target ${target.value.url}. ${target.value.reason}` : "Target URL was not confirmed.",
      ],
    }),
  );

  checks.push(
    checkFrom("artifact", {
      failed: !artifact.ok || artifact.value?.status !== "ready",
      reason: artifact.ok ? artifact.value?.reason || "" : artifact.reason,
      findings: [],
      scope: [
        "Reports are encrypted with SECURITY_SCAN_REPORT_KEY before upload because this repository is public and GitHub artifacts follow repository visibility.",
        "Retention is 14 days. Plaintext reports are not uploaded.",
      ],
    }),
  );

  const failed = checks.filter((item) => item.status === "scan_failed");
  const blocking = checks.flatMap((item) => item.findings).filter((item) => item.severity === "high" || item.severity === "critical");
  const anyFindings = checks.some((item) => item.findings.length > 0);
  const anyLimits = checks.some((item) => item.limitations.length > 0);
  let overall = "no_high_or_critical";
  let exitCode = 0;
  if (failed.length) {
    overall = "scan_failed";
    exitCode = 2;
  } else if (blocking.length) {
    overall = "high_or_critical";
    exitCode = 1;
  } else if (anyFindings || anyLimits) {
    overall = "completed_with_findings";
    exitCode = 0;
  }

  return {
    generatedAt: new Date().toISOString(),
    commit: readText(path.join(dir, "commit.txt")),
    target: target.ok ? target.value : { ok: false, url: "", reason: target.reason },
    overall,
    exitCode,
    wordCleanAllowed: overall === "no_high_or_critical" && !anyFindings && !anyLimits,
    checks,
  };
}

function markdown(report) {
  const lines = [];
  lines.push(`# Legal Shaman security scan ${report.generatedAt.slice(0, 10)}`);
  lines.push("");
  lines.push(`Overall: ${report.overall}.`);
  if (report.overall === "scan_failed") {
    lines.push("One or more checks did not finish. This result is not clean.");
  } else if (report.overall === "high_or_critical") {
    lines.push("High or critical findings are present. The workflow fails for that reason. This is not a scanner crash.");
  } else if (report.wordCleanAllowed) {
    lines.push("Clean: every required check finished and reported no findings.");
  } else {
    lines.push("No high or critical findings. Lower findings or coverage gaps are listed. This result is not described as clean.");
  }
  lines.push("");
  lines.push(`Commit: ${report.commit || "unknown"}.`);
  lines.push(`Target: ${report.target?.url || "not confirmed"}.`);
  lines.push("");
  for (const item of report.checks) {
    lines.push(`## ${item.name}`);
    lines.push("");
    lines.push(`Status: ${item.status}.`);
    if (item.reason) lines.push(`Reason: ${item.reason}.`);
    const counts = SEVERITIES.map((severity) => `${severity} ${item.counts[severity] || 0}`).join(", ");
    lines.push(`Counts: ${counts}.`);
    for (const note of item.scope || []) lines.push(`Scope: ${note}`);
    for (const note of item.limitations || []) lines.push(`Limitation: ${note}`);
    const shown = item.findings.slice(0, 40);
    for (const entry of shown) {
      lines.push(
        `- ${entry.severity} | ${entry.location} | ${entry.rule} | ${entry.evidence} | Fix: ${entry.suggestion}`,
      );
    }
    if (item.findings.length > shown.length) {
      lines.push(`- ${item.findings.length - shown.length} more findings are in the JSON report.`);
    }
    lines.push("");
  }
  return redactText(lines.join("\n"));
}

function main() {
  const dir = process.argv[2];
  if (!dir) {
    process.stderr.write("usage: normalize-reports.mjs <report-dir>\n");
    process.exit(2);
  }
  const report = buildReport(dir);
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "report.md"), markdown(report));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown(report));
  }
  process.stdout.write(`overall=${report.overall} exit=${report.exitCode}\n`);
  process.exit(report.exitCode);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
