import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { redactText } from "./redact.mjs"
import { severityFromSignals } from "./severity.mjs"

const SEVERITIES = ["critical", "high", "medium", "low", "info"]

export function emptyCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
}

function countFindings(findings) {
  const counts = emptyCounts()
  for (const finding of findings) {
    if (counts[finding.severity] !== undefined) counts[finding.severity] += 1
  }
  return counts
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function metaOf(rawDir, name) {
  const file = path.join(rawDir, `${name}.meta.json`)
  if (!fs.existsSync(file)) {
    return { name, status: "failed", exitCode: null, error: "Scanner metadata is missing." }
  }
  const meta = readJson(file)
  return {
    name,
    status: meta.status === "completed" ? "completed" : "failed",
    exitCode: meta.exitCode ?? null,
    error: meta.error || null,
  }
}

function relativize(filePath, treeRoot) {
  if (!filePath) return null
  const normalised = filePath.split(path.sep).join("/")
  const root = treeRoot ? treeRoot.split(path.sep).join("/").replace(/\/$/, "") : ""
  if (root && (normalised === root || normalised.startsWith(`${root}/`))) {
    return normalised.slice(root.length).replace(/^\//, "") || "."
  }
  if (normalised.startsWith("/src/")) return normalised.slice("/src/".length)
  return normalised.replace(/^\.\//, "")
}

function makeFinding(partial) {
  return {
    url: null,
    line: null,
    location: null,
    ...partial,
  }
}

export function parseNpmAudit(payload) {
  if (!payload || payload.error) {
    const summary = payload?.error?.summary || payload?.error?.detail || "npm audit returned an error payload."
    return { failed: summary, findings: [] }
  }
  const vulns = payload.vulnerabilities || {}
  const findings = []
  const seen = new Set()
  for (const vuln of Object.values(vulns)) {
    const vias = Array.isArray(vuln.via) && vuln.via.length ? vuln.via : [vuln.name]
    for (const via of vias) {
      const advisory = typeof via === "object" && via ? via : null
      const title = advisory?.title || `Vulnerability in ${vuln.name}`
      const severityInput = advisory?.severity || vuln.severity
      const cvss = advisory?.cvss?.score
      const { severity, unparsed } = severityFromSignals([severityInput, cvss])
      const key = `${advisory?.url || title}|${vuln.name}|${severity}`
      if (seen.has(key)) continue
      seen.add(key)
      const fix = vuln.fixAvailable
      let remediation = "Upgrade the affected package. This workflow does not run npm audit fix or edit the lockfile."
      if (fix && typeof fix === "object" && fix.version) {
        remediation = `Upgrade ${fix.name || vuln.name} to ${fix.version}${fix.isSemVerMajor ? " (major update)" : ""}. This workflow does not apply the update.`
      } else if (fix === false) {
        remediation = "npm has no automatic fix recorded. Review the advisory and upgrade or replace the package manually."
      }
      findings.push(makeFinding({
        scanner: "npm-audit",
        severity,
        category: "dependency",
        title,
        location: "web/package-lock.json",
        evidence: [
          `Package ${vuln.name}.`,
          advisory?.url ? `Advisory ${advisory.url}.` : null,
          unparsed ? "Severity was missing and was treated as high." : null,
        ].filter(Boolean).join(" "),
        remediation,
        url: advisory?.url || null,
      }))
    }
  }
  return { failed: null, findings }
}

export function parseOsv(payload, treeRoot) {
  if (!payload || !Array.isArray(payload.results)) {
    return { failed: "OSV-scanner JSON did not contain results.", findings: [] }
  }
  const findings = []
  for (const result of payload.results) {
    const location = relativize(result.source?.path, treeRoot)
    for (const item of result.packages || []) {
      const pkg = item.package || {}
      const byId = new Map((item.vulnerabilities || []).map((vuln) => [vuln.id, vuln]))
      for (const group of item.groups || []) {
        const primary = (group.ids || []).map((id) => byId.get(id)).find(Boolean)
        const signals = [group.max_severity, primary?.database_specific?.severity]
        for (const entry of primary?.severity || []) signals.push(entry.score)
        const { severity, unparsed } = severityFromSignals(signals)
        const advisory = (group.ids || []).find((id) => id.startsWith("GHSA-") || id.startsWith("CVE-")) || group.ids?.[0] || "advisory"
        findings.push(makeFinding({
          scanner: "osv-scanner",
          severity,
          category: "dependency",
          title: `${pkg.name}@${pkg.version}: ${advisory}`,
          location,
          evidence: [
            primary?.summary || "OSV reported this package version.",
            group.max_severity ? `max_severity ${group.max_severity}.` : null,
            unparsed ? "No CVSS score was present, so the finding was treated as high." : null,
          ].filter(Boolean).join(" "),
          remediation: "Upgrade or remove this package version. The advisory lists the fixed range. This workflow does not apply updates.",
          url: `https://osv.dev/vulnerability/${advisory}`,
        }))
      }
    }
  }
  return { failed: null, findings }
}

export function parseGitleaks(payload, treeRoot) {
  if (!Array.isArray(payload)) return { failed: "gitleaks JSON was not a list.", findings: [] }
  return {
    failed: null,
    findings: payload.map((item) => makeFinding({
      scanner: "gitleaks",
      severity: "high",
      category: "secrets",
      title: item.Description || item.RuleID || "Secret pattern matched",
      location: relativize(item.File, treeRoot),
      line: item.StartLine ?? null,
      evidence: `Rule ${item.RuleID || "unknown"} matched. The secret value is redacted.`,
      remediation: "Remove the secret from the file, rotate it, and store the replacement in the host or Actions secret store. This workflow does not edit the file.",
    })),
  }
}

export function parseSemgrep(payload, scannerName) {
  if (!payload || !Array.isArray(payload.results)) {
    return { failed: "Semgrep JSON did not contain results.", findings: [] }
  }
  const findings = (payload.results || []).map((result) => {
    const severityWord = result.extra?.severity || "WARNING"
    const { severity } = severityFromSignals([
      severityWord === "ERROR" ? "high" : severityWord === "WARNING" ? "medium" : "low",
    ])
    const metadata = result.extra?.metadata || {}
    return makeFinding({
      scanner: scannerName,
      severity,
      category: metadata.category || metadata.cwe || "sast",
      title: result.check_id || "Semgrep finding",
      location: relativize(result.path, ""),
      line: result.start?.line ?? null,
      evidence: result.extra?.message || "Semgrep matched a security rule. The source line is not copied.",
      remediation: "Review the match and change the code. This workflow does not apply Semgrep autofix.",
    })
  })
  const errors = Array.isArray(payload.errors) ? payload.errors : []
  return {
    failed: errors.length ? `Semgrep reported ${errors.length} file error(s). Findings from files that parsed are included, but the scanner is incomplete.` : null,
    findings,
  }
}

function zapSeverity(alert) {
  const code = String(alert.riskcode ?? "")
  if (code === "3") return "high"
  if (code === "2") return "medium"
  if (code === "1") return "low"
  if (code === "0") return "info"
  return severityFromSignals([alert.riskdesc]).severity
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

export function parseZap(payload) {
  const sites = payload?.site || payload?.Site || []
  if (!Array.isArray(sites)) return { failed: "ZAP JSON did not contain a site list.", findings: [] }
  const findings = []
  for (const site of sites) {
    for (const alert of site.alerts || []) {
      const instances = Array.isArray(alert.instances) ? alert.instances : []
      const urls = instances.slice(0, 5).map((instance) => instance.uri).filter(Boolean)
      findings.push(makeFinding({
        scanner: "zap-baseline",
        severity: zapSeverity(alert),
        category: "zap",
        title: alert.alert || alert.name || `ZAP rule ${alert.pluginid || ""}`.trim(),
        location: null,
        url: urls[0] || site["@name"] || null,
        evidence: [
          alert.riskdesc ? `Risk ${alert.riskdesc}.` : null,
          alert.pluginid ? `Plugin ${alert.pluginid}.` : null,
          `Instances ${alert.count || instances.length}.`,
          urls.length ? `URLs ${urls.join(", ")}.` : null,
          instances[0]?.evidence ? `Evidence ${instances[0].evidence}.` : null,
        ].filter(Boolean).join(" "),
        remediation: stripHtml(alert.solution) || "Review the ZAP baseline alert. This was a passive baseline scan, not an authenticated or active scan.",
      }))
    }
  }
  return { failed: null, findings }
}

function loadCompleted(rawDir, name, treeRoot, literals) {
  const meta = metaOf(rawDir, name)
  if (meta.status !== "completed") {
    return { scanner: { ...meta, counts: emptyCounts() }, findings: [] }
  }
  const file = path.join(rawDir, `${name}.json`)
  if (!fs.existsSync(file)) {
    return {
      scanner: { ...meta, status: "failed", error: "The scanner finished without a JSON report.", counts: emptyCounts() },
      findings: [],
    }
  }
  let payload
  try {
    payload = readJson(file)
  } catch {
    return {
      scanner: { ...meta, status: "failed", error: "The scanner JSON could not be parsed.", counts: emptyCounts() },
      findings: [],
    }
  }
  let parsed
  if (name === "npm-audit") parsed = parseNpmAudit(payload)
  else if (name === "osv") parsed = parseOsv(payload, treeRoot)
  else if (name === "gitleaks") parsed = parseGitleaks(payload, treeRoot)
  else if (name === "semgrep-local" || name === "semgrep-registry") parsed = parseSemgrep(payload, name)
  else if (name === "zap-baseline") parsed = parseZap(payload)
  else if (name === "app-checks") parsed = { failed: null, findings: payload.findings || [] }
  else if (name === "script-tests") parsed = { failed: null, findings: [] }
  else parsed = { failed: "Unknown scanner payload.", findings: [] }
  const findings = parsed.findings.map((item, index) => redactFinding({
    id: `${name}-${index + 1}`,
    ...item,
  }, literals))
  if (parsed.failed) {
    return {
      scanner: { ...meta, status: "failed", error: redactText(parsed.failed, literals), counts: countFindings(findings) },
      findings,
    }
  }
  return { scanner: { ...meta, error: null, counts: countFindings(findings) }, findings }
}

function redactFinding(item, literals) {
  return {
    ...item,
    title: redactText(item.title, literals).slice(0, 300),
    location: item.location ? redactText(item.location, literals).slice(0, 300) : null,
    url: item.url ? redactText(item.url, literals).slice(0, 500) : null,
    evidence: redactText(item.evidence, literals).slice(0, 1200),
    remediation: redactText(item.remediation, literals).slice(0, 1200),
    category: item.category || "security",
  }
}

export function conclusionOf(scanners, findings) {
  if (scanners.some((scanner) => scanner.status !== "completed")) return "incomplete"
  if (findings.some((item) => item.severity === "high" || item.severity === "critical")) return "findings"
  return "passed"
}

export function exitCodeFor(conclusion) {
  if (conclusion === "passed") return 0
  if (conclusion === "findings") return 1
  return 2
}

export function loadAllowlistLiterals(tomlText) {
  return [...tomlText.matchAll(/regexes\s*=\s*\[\s*'''([^']+)'''\s*\]/g)].map((match) => match[1])
}

const LIMITATIONS = [
  "GitHub Actions cron is UTC only. The workflow registers 01:00 and 02:00 UTC and continues only when the runner clock says 02:00 in Europe/London. A delayed job that starts outside that hour is skipped, so a day can be missed.",
  "The scan reads the current default-branch tree. It does not search git history, so a secret removed from the latest tree is not reported.",
  "data/ and web/data/ are excluded. Those dumps are large and can contain personal data.",
  "Dependency scanners send package names and versions to the npm advisory API and the OSV API. They do not upload source code.",
  "Semgrep runs locally with metrics off and autofix off. It downloads rule packs from the Semgrep Registry and does not use Semgrep Cloud.",
  "OWASP ZAP runs the baseline script only: a short spider and passive rules. It does not log in, does not run an active scan, and does not send source code anywhere.",
  "This workflow does not fix, commit, or deploy anything.",
]

export function buildReport({ scannedAt, commit, ref, targetUrl, targetError, scanners, findings }) {
  const conclusion = conclusionOf(scanners, findings)
  const severe = findings.filter((item) => item.severity === "high" || item.severity === "critical")
  let summary
  if (conclusion === "incomplete") {
    summary = "One or more scanners did not finish. This is not a clean result."
  } else if (conclusion === "findings") {
    summary = "High or critical findings are present. This is not a clean result."
  } else {
    summary = "No high or critical findings. This is a completed scan. Medium, low, and informational items may still be listed."
  }
  return {
    schemaVersion: 1,
    project: "Legal Shaman",
    scannedAt,
    commit,
    ref,
    targetUrl,
    targetError,
    conclusion,
    exitCode: exitCodeFor(conclusion),
    summary,
    severeCount: severe.length,
    scanners,
    findings,
    limitations: LIMITATIONS,
  }
}

export function renderMarkdown(report) {
  const lines = [
    `# Legal Shaman security scan ${report.scannedAt}`,
    "",
    report.summary,
    "",
    `Conclusion: ${report.conclusion}`,
    `Commit: ${report.commit || "unknown"}`,
    `Ref: ${report.ref || "unknown"}`,
    `Target URL: ${report.targetUrl || "not resolved"}`,
    report.targetError ? `Target error: ${report.targetError}` : null,
    "",
    "## Scanners",
    "",
    "| Scanner | Status | Critical | High | Medium | Low | Info |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ]
  for (const scanner of report.scanners) {
    const counts = scanner.counts || emptyCounts()
    lines.push(`| ${scanner.name} | ${scanner.status} | ${counts.critical} | ${counts.high} | ${counts.medium} | ${counts.low} | ${counts.info} |`)
    if (scanner.error) lines.push(`| ${scanner.name} error | ${scanner.error.replace(/\|/g, "/")} | | | | | |`)
  }
  lines.push("", "## Findings", "")
  if (!report.findings.length) lines.push("No findings were recorded by the scanners that returned a report.")
  for (const finding of report.findings) {
    lines.push(`### ${finding.severity}: ${finding.title}`)
    lines.push("")
    lines.push(`- Scanner: ${finding.scanner}`)
    lines.push(`- Category: ${finding.category}`)
    if (finding.location) lines.push(`- Location: ${finding.location}${finding.line ? `:${finding.line}` : ""}`)
    if (finding.url) lines.push(`- URL: ${finding.url}`)
    lines.push(`- Evidence: ${finding.evidence}`)
    lines.push(`- Suggested fix: ${finding.remediation}`)
    lines.push("")
  }
  lines.push("## Limitations", "")
  for (const item of report.limitations) lines.push(`- ${item}`)
  lines.push("")
  return lines.filter((line) => line !== null).join("\n")
}

export function renderPublicSummary(report, publishNote) {
  const lines = [
    "# Daily security scan",
    "",
    `Scan conclusion: ${report.conclusion.toUpperCase()}`,
    report.summary,
    "",
    `Publish: ${publishNote}`,
    `Scanned commit: ${report.commit || "unknown"}`,
    `Default branch ref: ${report.ref || "unknown"}`,
    `Target URL: ${report.targetUrl || "not resolved"}`,
    "",
    "## Scanners",
    "",
    "| Scanner | Status | Critical | High | Medium | Low | Info |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ]
  for (const scanner of report.scanners) {
    const counts = scanner.counts || emptyCounts()
    lines.push(`| ${scanner.name} | ${scanner.status} | ${counts.critical} | ${counts.high} | ${counts.medium} | ${counts.low} | ${counts.info} |`)
  }
  const failures = report.scanners.filter((scanner) => scanner.status !== "completed" && scanner.error)
  if (failures.length) {
    lines.push("", "## Scanner errors", "")
    for (const scanner of failures) lines.push(`- ${scanner.name}: ${scanner.error}`)
  }
  const severe = report.findings.filter((item) => item.severity === "high" || item.severity === "critical")
  lines.push("", "## High and critical findings", "")
  if (!severe.length) {
    lines.push("None recorded by the scanners that returned findings.")
  } else {
    lines.push("File, line, URL, evidence, and the suggested fix are in the encrypted report. This public summary lists identifiers only.")
    const shown = severe.slice(0, 40)
    for (const finding of shown) {
      const where = finding.location ? `${finding.location}${finding.line ? `:${finding.line}` : ""}` : (finding.url || "see report")
      lines.push(`- ${finding.severity} | ${finding.scanner} | ${finding.title} | ${where}`)
    }
    if (severe.length > shown.length) {
      lines.push(`- ${severe.length - shown.length} more high or critical findings are in the encrypted report.`)
    }
  }
  lines.push("", "## Limitations", "")
  for (const item of report.limitations) lines.push(`- ${item}`)
  lines.push("")
  return lines.join("\n")
}

function placeholderScanner(name, error) {
  return { name, status: "failed", exitCode: null, error, counts: emptyCounts() }
}

export function aggregateRawDir(rawDir, options = {}) {
  const literals = options.literals || []
  const treeRoot = options.treeRoot || ""
  const source = fs.existsSync(path.join(rawDir, "source.meta.json"))
    ? readJson(path.join(rawDir, "source.meta.json"))
    : {}
  const names = [
    "script-tests",
    "npm-audit",
    "osv",
    "gitleaks",
    "semgrep-local",
    "semgrep-registry",
    "app-checks",
    "zap-baseline",
  ]
  const scanners = []
  const findings = []
  for (const name of names) {
    if (!fs.existsSync(path.join(rawDir, `${name}.meta.json`))) {
      scanners.push(placeholderScanner(name, "This scanner did not run."))
      continue
    }
    const loaded = loadCompleted(rawDir, name, treeRoot, literals)
    scanners.push(loaded.scanner)
    findings.push(...loaded.findings)
  }
  return buildReport({
    scannedAt: options.scannedAt || new Date().toISOString(),
    commit: source.commit || null,
    ref: source.ref || null,
    targetUrl: source.targetUrl || null,
    targetError: source.targetError || null,
    scanners,
    findings,
  })
}

function main() {
  const rawFlag = process.argv.indexOf("--raw")
  const outFlag = process.argv.indexOf("--out")
  const treeFlag = process.argv.indexOf("--tree")
  if (rawFlag === -1 || outFlag === -1) {
    console.error("Usage: aggregate-report.mjs --raw DIR --out DIR [--tree DIR]")
    process.exit(2)
  }
  const rawDir = process.argv[rawFlag + 1]
  const outDir = process.argv[outFlag + 1]
  const treeRoot = treeFlag === -1 ? "" : process.argv[treeFlag + 1]
  const tomlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "gitleaks.toml")
  const literals = fs.existsSync(tomlPath) ? loadAllowlistLiterals(fs.readFileSync(tomlPath, "utf8")) : []
  const report = aggregateRawDir(rawDir, { treeRoot, literals, scannedAt: new Date().toISOString() })
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(outDir, "report.md"), renderMarkdown(report))
  const publishNote = "pending"
  fs.writeFileSync(path.join(outDir, "public-summary.md"), renderPublicSummary(report, publishNote))
  fs.writeFileSync(path.join(outDir, "exit-code"), String(report.exitCode))
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
