import {
  gatePracticeAreaPhrase,
  isBlockedPracticeAreaPhrase,
} from "@/lib/provider-intelligence-crawler-v2/practice-area-taxonomy-gate";

/** Marketing / UI phrases that must never become practice areas. */
const MUST_REJECT_PHRASES = [
  "Newsletter Sign Up",
  "Reach out",
  "Free confidential call",
  "Booking Details",
  "Personal Info",
  "A clear three step process to peace of mind",
] as const;

/** Known-good taxonomy labels (sanity check — gate must still allow). */
const MUST_ALLOW_PHRASES = [
  "Employment Law",
  "Family Law",
  "Immigration",
  "Housing Law",
  "Criminal Defence",
] as const;

export function runPracticeAreaTaxonomyGateEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL practice-area-taxonomy-gate: ${msg}`);
    failed++;
  };

  for (const phrase of MUST_REJECT_PHRASES) {
    const blocked = isBlockedPracticeAreaPhrase(phrase);
    const gate = gatePracticeAreaPhrase(phrase);
    if (!blocked && gate.allowed) {
      fail(`must reject marketing/UI phrase: "${phrase}"`);
    }
  }

  for (const phrase of MUST_ALLOW_PHRASES) {
    const gate = gatePracticeAreaPhrase(phrase);
    if (!gate.allowed) {
      fail(`must allow taxonomy phrase: "${phrase}" (${gate.reason})`);
    }
  }

  const fuzzyMarketing = gatePracticeAreaPhrase("Our three step booking process for peace of mind");
  if (fuzzyMarketing.allowed) {
    fail("long marketing sentence should not map to taxonomy");
  }

  if (failed === 0) {
    console.info(
      `PASS practice-area-taxonomy-gate eval (${MUST_REJECT_PHRASES.length} reject + ${MUST_ALLOW_PHRASES.length} allow cases)`,
    );
  }
  return failed;
}
