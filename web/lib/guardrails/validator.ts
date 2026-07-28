import "server-only";

import type { LawyerWithRelations } from "@/lib/lawyers/db";
import type { SraOrgLite } from "@/lib/lawyers/search";

/**
 * Guardrail validator.
 *
 * Two responsibilities:
 *   1) `sanitizeAdviceText` — pure regex pass on any LLM-produced user-facing
 *      string. Removes advice-shaped phrases. Always safe to call.
 *   2) `validateExplanation` — additionally checks that the LLM's per-match
 *      sentence only references facts present on the lawyer record. If it
 *      asserts something not in the record (e.g. "guaranteed", "best in
 *      London"), the caller falls back to a deterministic template.
 */

/** Strict patterns for directory/explanation copy — flattens direct phrasing. */
const FORBIDDEN_PATTERNS: { pattern: RegExp; replace: string }[] = [
  { pattern: /\b(you (should|must|need to|ought to|have to|are entitled))\b/gi, replace: "consider whether" },
  { pattern: /\bi (recommend|suggest|advise)\b/gi, replace: "the directory lists" },
  { pattern: /\b(in my opinion|in my view|i think|i believe)\b/gi, replace: "" },
  { pattern: /\b(your (case|claim|situation|matter|chances|prospects))\b/gi, replace: "this type of matter" },
  { pattern: /\bthe law (says|requires|states) you\b/gi, replace: "this is a legal matter" },
  { pattern: /\b(you (will|won't|won not) win)\b/gi, replace: "outcomes vary" },
  { pattern: /\b(you (will|won't|won not) lose)\b/gi, replace: "outcomes vary" },
  { pattern: /\b(guarantee[ds]?|guaranteed|guaranty)\b/gi, replace: "" },
  { pattern: /\b(\d+%\s*(success|win|chance|likely|probability))\b/gi, replace: "" },
  { pattern: /\b(\d+\s*%\s*chance)\b/gi, replace: "" },
  { pattern: /\b(best|top|number one|#1|leading) (lawyer|solicitor|barrister)\b/gi, replace: "an experienced practitioner" },
  { pattern: /£\s?\d[\d,]*\s*(compensation|payout|settlement|damages)/gi, replace: "" },
  { pattern: /\$\d[\d,]*/g, replace: "" },
];

/** Lighter pass for Ask-the-Shaman synthesis — keeps practical signposting phrasing. */
const SIGNPOSTING_FORBIDDEN: { pattern: RegExp; replace: string }[] = [
  { pattern: /\bi (recommend|suggest|advise)\b/gi, replace: "the guidance notes" },
  { pattern: /\b(in my opinion|in my view|i think|i believe)\b/gi, replace: "" },
  { pattern: /\b(your (case|chances|prospects))\b/gi, replace: "this type of matter" },
  { pattern: /\b(you (will|won't|won not) (win|lose|get))\b/gi, replace: "outcomes can vary" },
  { pattern: /\b(guarantee[ds]?|guaranteed|guaranty)\b/gi, replace: "" },
  { pattern: /\b(\d+%\s*(success|win|chance|likely|probability))\b/gi, replace: "" },
  { pattern: /\b(best|top|number one|#1|leading) (lawyer|solicitor|barrister)\b/gi, replace: "a regulated practitioner" },
  { pattern: /£\s?\d[\d,]*\s*(compensation|payout|settlement|damages)/gi, replace: "" },
];

/**
 * Sanitize an LLM string. Returns the input with advice-shaped phrases replaced.
 * Idempotent.
 */
function applySanitizeRules(
  input: string,
  rules: { pattern: RegExp; replace: string }[],
  preserveParagraphs: boolean,
): string {
  if (!input) return input;
  let out = input;
  for (const rule of rules) {
    out = out.replace(rule.pattern, rule.replace);
  }
  if (preserveParagraphs) {
    out = out
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim())
      .filter(Boolean)
      .join("\n\n");
    return out.trim();
  }
  out = out.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  return out;
}

export function sanitizeAdviceText(input: string): string {
  return applySanitizeRules(input, FORBIDDEN_PATTERNS, false);
}

/** For wiki / legal-search synthesis — blocks unsafe claims without flattening all direct phrasing. */
export function sanitizeSignpostingText(input: string): string {
  return applySanitizeRules(input, SIGNPOSTING_FORBIDDEN, true);
}

/**
 * Generic fact-grounding check.
 *
 * Returns `null` if the explanation contains an unsupported factual claim,
 * meaning the caller should fall back to a deterministic template.
 * Otherwise returns the sanitised string.
 *
 * "Supported" means every proper-noun-looking token (capitalised word ≥ 3
 * chars, not at sentence start) appears in `allowedTokens`. This is a soft
 * check tuned for 1-sentence MVP explanations — strict enough to catch
 * hallucinated firm names, places, or credentials.
 */
export function validateExplanationAgainstTokens(
  candidate: string,
  allowedTokens: Set<string>,
): string | null {
  const cleaned = sanitizeAdviceText(candidate);
  if (!cleaned || cleaned.length === 0) return null;
  if (cleaned.length > 220) return null;

  const words = cleaned.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!.replace(/[^A-Za-z'-]/g, "");
    if (w.length < 3) continue;
    if (!/^[A-Z]/.test(w)) continue;
    if (i === 0) continue;
    if (COMMON_OK.has(w.toLowerCase())) continue;
    if (!allowedTokens.has(w.toLowerCase())) {
      return null;
    }
  }
  return cleaned;
}

/** Convenience wrapper for the curated-lawyer case. */
export function validateExplanation(
  candidate: string,
  lawyer: LawyerWithRelations,
): string | null {
  return validateExplanationAgainstTokens(candidate, buildLawyerTokenSet(lawyer));
}

/** Convenience wrapper for the SRA-org case. */
export function validateOrgExplanation(
  candidate: string,
  org: SraOrgLite,
): string | null {
  return validateExplanationAgainstTokens(candidate, buildOrgTokenSet(org));
}

const COMMON_OK = new Set<string>([
  "uk",
  "england",
  "wales",
  "scotland",
  "ireland",
  "northern",
  "british",
  "european",
  "english",
  "law",
  "the",
  "and",
  "with",
  "for",
  "from",
  "into",
  "this",
  "that",
  "based",
  "practising",
  "practices",
  "specialising",
  "verified",
  "experienced",
  "years",
  "year",
]);

function pushTokens(set: Set<string>, s: string | null | undefined) {
  if (!s) return;
  for (const tok of s.split(/[\s,/&-]+/)) {
    const t = tok.replace(/[^A-Za-z'-]/g, "").toLowerCase();
    if (t.length >= 3) set.add(t);
  }
}

export function buildLawyerTokenSet(l: LawyerWithRelations): Set<string> {
  const set = new Set<string>();
  pushTokens(set, l.name);
  pushTokens(set, l.firm?.name ?? null);
  for (const p of l.practiceAreas) pushTokens(set, p.practiceArea.name);
  for (const loc of l.locations) {
    pushTokens(set, loc.city);
    pushTokens(set, loc.country);
    pushTokens(set, loc.jurisdiction);
  }
  for (const lang of l.languages) pushTokens(set, lang.language.name);
  for (const c of l.credentials) pushTokens(set, c.authority);
  return set;
}

export function buildOrgTokenSet(o: SraOrgLite): Set<string> {
  const set = new Set<string>();
  pushTokens(set, o.businessName);
  pushTokens(set, o.city);
  pushTokens(set, o.postcode);
  pushTokens(set, o.county);
  pushTokens(set, o.country);
  // Mention of the SRA itself is always allowed in org explanations.
  set.add("sra");
  return set;
}
