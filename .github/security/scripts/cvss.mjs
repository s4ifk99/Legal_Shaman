const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC = { L: 0.77, H: 0.44 };
const UI = { N: 0.85, R: 0.62 };
const CIA = { N: 0, L: 0.22, H: 0.56 };

function roundup(input) {
  const intInput = Math.round(input * 100000);
  if (intInput % 10000 === 0) return intInput / 100000;
  return (Math.floor(intInput / 10000) + 1) / 10;
}

export function cvssV3BaseScore(vector) {
  if (!vector || !/^CVSS:3\.[01]\//.test(vector)) return null;
  const parts = Object.fromEntries(
    vector
      .split("/")
      .slice(1)
      .map((item) => item.split(":"))
      .filter((pair) => pair.length === 2),
  );
  const scopeChanged = parts.S === "C";
  const prTable = scopeChanged ? { N: 0.85, L: 0.68, H: 0.5 } : { N: 0.85, L: 0.62, H: 0.27 };
  const av = AV[parts.AV];
  const ac = AC[parts.AC];
  const pr = prTable[parts.PR];
  const ui = UI[parts.UI];
  const c = CIA[parts.C];
  const i = CIA[parts.I];
  const a = CIA[parts.A];
  if ([av, ac, pr, ui, c, i, a].some((n) => n === undefined)) return null;
  const impact = 1 - (1 - c) * (1 - i) * (1 - a);
  if (impact <= 0) return 0;
  const impactSub = scopeChanged
    ? 7.52 * (impact - 0.029) - 3.25 * (impact - 0.02) ** 15
    : 6.42 * impact;
  const exploitability = 8.22 * av * ac * pr * ui;
  if (scopeChanged) return roundup(Math.min(1.08 * (impactSub + exploitability), 10));
  return roundup(Math.min(impactSub + exploitability, 10));
}

export function scoreToSeverity(score) {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "info";
}

export function cvssV4Bucket(vector) {
  if (!vector || !vector.startsWith("CVSS:4")) return null;
  const parts = Object.fromEntries(
    vector
      .split("/")
      .slice(1)
      .map((item) => item.split(":"))
      .filter((pair) => pair.length === 2),
  );
  const highs = ["VC", "VI", "VA"].filter((key) => parts[key] === "H").length;
  const easy = parts.AC === "L" && (!parts.AT || parts.AT === "N");
  if (highs === 3 && easy) return "critical";
  if (highs > 0) return "high";
  if (["VC", "VI", "VA", "SC", "SI", "SA"].some((key) => parts[key] === "L")) return "low";
  return "medium";
}

const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export function higherSeverity(left, right) {
  return (RANK[left] ?? -1) >= (RANK[right] ?? -1) ? left : right;
}

export function severityFromAdvisory(vuln) {
  const named = String(vuln?.database_specific?.severity || "").toLowerCase();
  const namedMap = {
    critical: "critical",
    high: "high",
    moderate: "medium",
    medium: "medium",
    low: "low",
  };
  let severity = namedMap[named] || null;
  for (const entry of vuln?.severity || []) {
    const score = entry?.score || "";
    if (String(entry?.type || "").includes("CVSS_V3") || /^CVSS:3/.test(score)) {
      severity = higherSeverity(severity, scoreToSeverity(cvssV3BaseScore(score))) || severity;
    } else if (String(entry?.type || "").includes("CVSS_V4") || /^CVSS:4/.test(score)) {
      severity = higherSeverity(severity, cvssV4Bucket(score)) || severity;
    }
  }
  return severity || "high";
}
