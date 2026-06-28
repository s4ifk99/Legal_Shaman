import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";

const PARKING_QUERY =
  /\b(parking|pcn|penalty charge notice|penalty charge|council fine|parking ticket|motoring|speeding|traffic regulation|decriminalised parking|civil parking)\b/i;

const PARKING_SIGNAL =
  /\b(pcn|penalty charge|parking fines?|council parking|parking tickets?|private parking|parking appeals?|traffic (management|regulation)|double yellow|permit zone|decriminalised|civil parking enforcement)\b/i;

const PARKING_NOISE =
  /\b(storage parking|new build|extending|planning permission|developer|garage conversion)\b/i;

/** Build 1–2 Reddit search strings — primary query plus a focused variant when helpful. */
export function buildOslawSearchQueryVariants(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return [];

  const variants = [trimmed];
  const lower = trimmed.toLowerCase();
  const resolution = resolveLegalIssueFromQuery(trimmed);

  if (resolution?.taxonomySlug === "parking_pcn" || PARKING_QUERY.test(trimmed)) {
    if (!/\bpcn\b/i.test(lower)) variants.push("parking PCN council fine appeal");
    if (/regulation/i.test(lower) && !/ticket|fine|pcn/i.test(lower)) {
      variants.push("parking regulations council PCN UK");
    }
    if (/private parking/i.test(lower)) variants.push("private parking charge appeal UK");
  }

  if (resolution && resolution.taxonomySlug !== "parking_pcn") {
    const boost = resolution.searchBoostTerms.find(
      (term) => term.length >= 4 && !lower.includes(term.toLowerCase()),
    );
    if (boost) variants.push(boost);
  }

  return [...new Set(variants.map((v) => v.trim()).filter((v) => v.length >= 2))].slice(0, 2);
}

/** Boost on-topic parking / regulatory threads and down-rank obvious noise. */
export function topicalRelevanceBoost(query: string, title: string, snippet = ""): number {
  const text = `${title} ${snippet}`.toLowerCase();
  const q = query.toLowerCase();
  let boost = 0;

  if (PARKING_QUERY.test(q) || resolveLegalIssueFromQuery(query)?.taxonomySlug === "parking_pcn") {
    if (PARKING_SIGNAL.test(text)) boost += 18;
    if (PARKING_NOISE.test(text) && !PARKING_SIGNAL.test(text)) boost -= 14;
    if (!/\bparking\b/i.test(text) && !PARKING_SIGNAL.test(text)) boost -= 10;
    if (/\bregulation/i.test(q) && /\b(council|local authority|traffic|enforcement|permit|tmo|parking)\b/i.test(text)) {
      boost += 8;
    }
  }

  return boost;
}
