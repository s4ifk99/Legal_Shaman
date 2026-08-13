import { resolveSraSearchFlags } from "@/lib/coherence/sraQuery";

import { MatterEngine } from "../resolve";
import { KnowledgeRetriever } from "../retrieve";
import { MATTER_EVAL_FIXTURES } from "./fixtures";
import type {
  MatterEvalCase,
  MatterEvalCaseResult,
  MatterEvalLayerScores,
  MatterEvalReport,
  MatterEvalSuite,
} from "./types";

function avg(scores: MatterEvalLayerScores[]): MatterEvalLayerScores {
  const keys = Object.keys(scores[0] || {}) as (keyof MatterEvalLayerScores)[];
  const out = {} as MatterEvalLayerScores;
  for (const k of keys) {
    out[k] = scores.reduce((s, row) => s + (row[k] || 0), 0) / Math.max(scores.length, 1);
  }
  return out;
}

function hitBlob(hits: { title: string; category: string }[]): string {
  return hits.map((h) => `${h.title} ${h.category}`).join(" ").toLowerCase();
}

function scoreCase(
  testCase: MatterEvalCase,
  matterPrimarySlugs: string[],
  matterSecondarySlugs: string[],
  matterExclusions: string[],
  ambiguities: number,
  overallConfidence: number,
  hits: { title: string; category: string }[],
  resolutionStatus: string,
  relationshipTypes: string[],
): { scores: MatterEvalLayerScores; failures: string[] } {
  const failures: string[] = [];
  const exp = testCase.expected;
  const blob = hitBlob(hits);

  let matterPrimary = 0;
  if (exp.allowEmptyPrimary && !matterPrimarySlugs.length) {
    matterPrimary = exp.resolutionStatusAny?.includes(resolutionStatus) ? 1 : 0;
    if (!matterPrimary) {
      failures.push(
        `empty primary expected resolutionStatus in ${exp.resolutionStatusAny?.join("|") || "?"}, got ${resolutionStatus}`,
      );
    }
  } else if (exp.primaryIssuesAny.some((s) => matterPrimarySlugs.includes(s))) {
    matterPrimary = 1;
  } else {
    failures.push(`primary expected one of ${exp.primaryIssuesAny.join("|")}, got ${matterPrimarySlugs.join(",")}`);
  }

  if (exp.resolutionStatusAny?.length && !exp.allowEmptyPrimary) {
    if (!exp.resolutionStatusAny.includes(resolutionStatus)) {
      failures.push(
        `resolutionStatus expected one of ${exp.resolutionStatusAny.join("|")}, got ${resolutionStatus}`,
      );
      matterPrimary = Math.min(matterPrimary, 0.5);
    }
  }

  if (exp.mustRelationshipTypes?.length) {
    const missing = exp.mustRelationshipTypes.filter((t) => !relationshipTypes.includes(t));
    if (missing.length) {
      failures.push(`missing relationships: ${missing.join(", ")}`);
      matterPrimary = Math.min(matterPrimary, 0.5);
    }
  }

  let matterSecondary = 1;
  if (exp.secondaryIssuesAny?.length) {
    matterSecondary = exp.secondaryIssuesAny.some((s) => matterSecondarySlugs.includes(s)) ? 1 : 0;
    if (!matterSecondary) {
      failures.push(`secondary expected one of ${exp.secondaryIssuesAny.join("|")}`);
    }
  }

  let exclusionScore = 1;
  if (exp.mustExclude?.length) {
    const missing = exp.mustExclude.filter((e) => !matterExclusions.includes(e));
    if (missing.length) {
      exclusionScore = Math.max(0, 1 - missing.length / exp.mustExclude.length);
      failures.push(`missing exclusions: ${missing.join(", ")}`);
    }
  }

  let matterAmbiguity = 1;
  if (exp.expectAmbiguities && ambiguities === 0) {
    matterAmbiguity = 0;
    failures.push("expected ambiguities but none recorded");
  }
  if (exp.expectLowConfidence && overallConfidence > 0.75) {
    matterAmbiguity = Math.min(matterAmbiguity, 0.5);
    failures.push(`expected low confidence, got ${overallConfidence.toFixed(2)}`);
  }

  let retrievalPrecision = 1;
  if (exp.mustNotRetrieveDomains?.length) {
    const bad = exp.mustNotRetrieveDomains.filter((term) => blob.includes(term.toLowerCase()));
    if (bad.length) {
      retrievalPrecision = Math.max(0, 1 - bad.length / exp.mustNotRetrieveDomains.length);
      failures.push(`forbidden retrieval domains in top hits: ${bad.join(", ")}`);
    }
  }

  let retrievalRecall = 1;
  if (exp.mustRetrieveConcepts?.length) {
    const found = exp.mustRetrieveConcepts.filter((term) => blob.includes(term.toLowerCase()));
    retrievalRecall = found.length / exp.mustRetrieveConcepts.length;
    if (retrievalRecall < 0.5) {
      failures.push(`low concept recall: found ${found.join(", ") || "none"}`);
    }
  }

  let helpMatchAlignment = 1;
  if (exp.helpMatchPracticeAny?.length) {
    const flags = resolveSraSearchFlags({
      query: testCase.submission,
      taxonomySlug: matterPrimarySlugs[0] || null,
    });
    const flagBlob = JSON.stringify(flags).toLowerCase();
    const matched = exp.helpMatchPracticeAny.some((p) => flagBlob.includes(p.toLowerCase()));
    if (!matched) {
      helpMatchAlignment = 0;
      failures.push(`helpMatch flags do not align with ${exp.helpMatchPracticeAny.join("|")}`);
    }
  }

  return {
    scores: {
      matterPrimary,
      matterSecondary,
      matterExclusions: exclusionScore,
      matterAmbiguity,
      retrievalPrecision,
      retrievalRecall,
      helpMatchAlignment,
    },
    failures,
  };
}

export function runMatterEval(
  mode: "baseline" | "matter-scoped" = "baseline",
  opts: { suite?: MatterEvalSuite } = {},
): MatterEvalReport {
  const caseResults: MatterEvalCaseResult[] = [];
  const fixtures = opts.suite
    ? MATTER_EVAL_FIXTURES.filter((c) => c.suite === opts.suite)
    : MATTER_EVAL_FIXTURES;

  for (const testCase of fixtures) {
    const { frame } = MatterEngine.resolve({ submission: testCase.submission });
    const primarySlugs = frame.primaryIssues.map((i) => i.slug);
    const secondarySlugs = frame.secondaryIssues.map((i) => i.slug);

    const evidence =
      mode === "baseline"
        ? KnowledgeRetriever.baseline(testCase.submission)
        : KnowledgeRetriever.forMatter({ matterFrame: frame, submission: testCase.submission });

    const { scores, failures } = scoreCase(
      testCase,
      primarySlugs,
      secondarySlugs,
      frame.exclusions,
      frame.ambiguities.length,
      frame.overallConfidence,
      evidence.hits,
      frame.resolutionStatus,
      frame.relationships.map((r) => r.type),
    );

    const pass =
      scores.matterPrimary >= 1 &&
      scores.retrievalPrecision >= 0.8 &&
      (scores.retrievalRecall >= 0.5 ||
        !testCase.expected.mustRetrieveConcepts?.length ||
        Boolean(testCase.expected.allowEmptyPrimary));

    caseResults.push({
      id: testCase.id,
      label: testCase.label,
      suite: testCase.suite,
      matterPrimarySlugs: primarySlugs,
      matterSecondarySlugs: secondarySlugs,
      matterExclusions: frame.exclusions,
      resolutionStatus: frame.resolutionStatus,
      relationshipTypes: frame.relationships.map((r) => r.type),
      retrievalTitles: evidence.hits.slice(0, 5).map((h) => h.title),
      retrievalMode: evidence.mode,
      scores,
      failures,
      pass,
    });
  }

  const suites: MatterEvalSuite[] = ["regression", "coverage", "adversarial"];
  const bySuite = {} as MatterEvalReport["bySuite"];
  for (const suite of suites) {
    const rows = caseResults.filter((c) => c.suite === suite);
    bySuite[suite] = {
      passCount: rows.filter((c) => c.pass).length,
      total: rows.length,
    };
  }

  return {
    mode,
    cases: caseResults,
    averages: avg(caseResults.map((c) => c.scores)),
    passCount: caseResults.filter((c) => c.pass).length,
    total: caseResults.length,
    bySuite,
  };
}

export function formatMatterEvalReport(report: MatterEvalReport): string {
  const lines = [
    `Matter eval (${report.mode}) — ${report.passCount}/${report.total} pass`,
    "",
    "By suite:",
    `  regression   ${report.bySuite.regression.passCount}/${report.bySuite.regression.total}`,
    `  coverage     ${report.bySuite.coverage.passCount}/${report.bySuite.coverage.total}`,
    `  adversarial  ${report.bySuite.adversarial.passCount}/${report.bySuite.adversarial.total}`,
    "",
    "Layer averages:",
    `  matterPrimary        ${(report.averages.matterPrimary * 100).toFixed(0)}%`,
    `  matterExclusions     ${(report.averages.matterExclusions * 100).toFixed(0)}%`,
    `  retrievalPrecision   ${(report.averages.retrievalPrecision * 100).toFixed(0)}%`,
    `  retrievalRecall      ${(report.averages.retrievalRecall * 100).toFixed(0)}%`,
    `  helpMatchAlignment   ${(report.averages.helpMatchAlignment * 100).toFixed(0)}%`,
    "",
  ];
  for (const c of report.cases) {
    lines.push(`${c.pass ? "PASS" : "FAIL"} [${c.suite}] ${c.id} — ${c.label}`);
    lines.push(`  status: ${c.resolutionStatus || "—"}`);
    lines.push(`  primary: ${c.matterPrimarySlugs.join(", ") || "—"}`);
    if (c.relationshipTypes?.length) {
      lines.push(`  relationships: ${c.relationshipTypes.join(", ")}`);
    }
    lines.push(`  excluded: ${c.matterExclusions.join(", ") || "—"}`);
    lines.push(`  hits: ${c.retrievalTitles.slice(0, 3).join(" | ") || "—"}`);
    if (c.failures.length) lines.push(`  failures: ${c.failures.join("; ")}`);
    lines.push("");
  }
  return lines.join("\n");
}
