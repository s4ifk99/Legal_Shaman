import { runUnitCase } from "./run-unit";
import { casesForTier, LEGAL_KNOWLEDGE_EVAL_CASES } from "./cases";

/** Backward-compatible wrapper around commission regression unit checks. */
export function runSearchIntentCases(): { pass: number; fail: number; notes: string[] } {
  const commissionCase = LEGAL_KNOWLEDGE_EVAL_CASES.find((c) => c.id === "employment_commission");
  if (!commissionCase) {
    return { pass: 0, fail: 1, notes: ["employment_commission case missing"] };
  }

  const result = runUnitCase(commissionCase);
  const pass = result.passed ? 6 : 0;
  const fail = result.passed ? 0 : 6;
  return { pass, fail, notes: result.failures };
}

export function runSearchIntentUnitCases(): ReturnType<typeof runSearchIntentCases> {
  const unitCases = casesForTier("unit").filter((c) => c.unitChunkScenario);
  let pass = 0;
  let fail = 0;
  const notes: string[] = [];
  for (const testCase of unitCases) {
    const result = runUnitCase(testCase);
    if (result.passed) pass += 1;
    else {
      fail += 1;
      notes.push(...result.failures.map((f) => `${testCase.id}: ${f}`));
    }
  }
  return { pass, fail, notes };
}
