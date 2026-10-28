const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }

const WORDS = {
  critical: "critical",
  high: "high",
  moderate: "medium",
  medium: "medium",
  low: "low",
  info: "info",
  informational: "info",
  none: "info",
}

export function higherSeverity(left, right) {
  return (RANK[left] ?? -1) >= (RANK[right] ?? -1) ? left : right
}

export function severityFromNumber(value) {
  const score = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(score) || score <= 0) return null
  if (score >= 9) return "critical"
  if (score >= 7) return "high"
  if (score >= 4) return "medium"
  return "low"
}

export function severityFromWord(value) {
  if (typeof value !== "string") return null
  const word = value.trim().toLowerCase()
  if (!word || word === "unknown") return null
  return WORDS[word] ?? null
}

const CVSS_V3 = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
  PR: {
    U: { N: 0.85, L: 0.62, H: 0.27 },
    C: { N: 0.85, L: 0.68, H: 0.5 },
  },
}

function roundup(value) {
  return Math.ceil(value * 10 - 1e-8) / 10
}

export function cvssV3Score(vector) {
  if (typeof vector !== "string" || !/^CVSS:3\.[01]\//.test(vector)) return null
  const metrics = {}
  for (const part of vector.split("/").slice(1)) {
    const [key, val] = part.split(":")
    if (key && val) metrics[key] = val
  }
  const scope = metrics.S === "C" ? "C" : metrics.S === "U" ? "U" : null
  if (!scope) return null
  const av = CVSS_V3.AV[metrics.AV]
  const ac = CVSS_V3.AC[metrics.AC]
  const ui = CVSS_V3.UI[metrics.UI]
  const pr = CVSS_V3.PR[scope][metrics.PR]
  const c = CVSS_V3.CIA[metrics.C]
  const i = CVSS_V3.CIA[metrics.I]
  const a = CVSS_V3.CIA[metrics.A]
  if ([av, ac, ui, pr, c, i, a].some((n) => n === undefined)) return null
  const iss = 1 - (1 - c) * (1 - i) * (1 - a)
  const impact = scope === "U" ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15
  if (impact <= 0) return 0
  const exploitability = 8.22 * av * ac * pr * ui
  const raw = scope === "U" ? impact + exploitability : 1.08 * (impact + exploitability)
  return roundup(Math.min(raw, 10))
}

export function severityFromSignals(signals) {
  let best = null
  for (const signal of signals) {
    if (signal == null || signal === "") continue
    const parsed =
      severityFromWord(signal) ||
      severityFromNumber(signal) ||
      severityFromNumber(cvssV3Score(String(signal)))
    if (parsed) best = best ? higherSeverity(best, parsed) : parsed
  }
  if (best) return { severity: best, unparsed: false }
  return {
    severity: "high",
    unparsed: true,
  }
}
