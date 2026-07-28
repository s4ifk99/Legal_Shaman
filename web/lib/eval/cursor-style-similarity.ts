import { answerSimilarity, tokenize } from "./answer-similarity";

export type CursorGoldCase = {
  id: string;
  title: string;
  query: string;
  /** Preferred section labels (any match counts). */
  sections?: string[];
  /** Keywords/phrases that a complete answer should mention. */
  mustMention?: string[];
  /** Source title fragments expected in retrieval. */
  expectedSourceFragments?: string[];
  /** Gold reference answer for tone/completeness similarity. */
  goldAnswer: string;
};

const SECTION_PATTERNS = [
  /what the sources say/i,
  /practical route/i,
  /limits\s*\/\s*missing facts/i,
  /who to report/i,
  /what to do now/i,
  /bottom line/i,
];

export function hasStructuredSections(answer: string): boolean {
  return SECTION_PATTERNS.some((re) => re.test(answer));
}

export function sectionCoverage(answer: string, expected: string[] = []): number {
  if (!expected.length) return hasStructuredSections(answer) ? 1 : 0.5;
  const lower = answer.toLowerCase();
  let hit = 0;
  for (const s of expected) {
    if (lower.includes(s.toLowerCase())) hit += 1;
  }
  return hit / expected.length;
}

export function keywordCoverage(answer: string, keywords: string[] = []): number {
  if (!keywords.length) return 1;
  const lower = answer.toLowerCase();
  let hit = 0;
  for (const k of keywords) {
    if (lower.includes(k.toLowerCase())) hit += 1;
  }
  return hit / keywords.length;
}

export function sourceFragmentCoverage(
  titles: string[],
  fragments: string[] = [],
): number {
  if (!fragments.length) return 1;
  const joined = titles.join(" ").toLowerCase();
  let hit = 0;
  for (const f of fragments) {
    if (joined.includes(f.toLowerCase())) hit += 1;
  }
  return hit / fragments.length;
}

  /** Penalise old excerpt-stitching openers when cursor-style is expected. */
export function excerptStylePenalty(answer: string): number {
  const lower = answer.toLowerCase();
  if (hasStructuredSections(answer)) return 0;
  if (/^according to “/.test(answer.trim())) return 0.15;
  if (/key points from that page:/i.test(lower)) return 0.1;
  if (/practical guidance noted there includes:/i.test(lower)) return 0.1;
  return 0;
}

export function cursorStyleScore(args: {
  answer: string;
  sourceTitles: string[];
  gold: CursorGoldCase;
}): {
  toneSim: number;
  sectionSim: number;
  keywordSim: number;
  sourceSim: number;
  combined: number;
} {
  const { answer, sourceTitles, gold } = args;
  const toneSim = answerSimilarity(answer, gold.goldAnswer);
  const sectionSim = sectionCoverage(answer, gold.sections);
  const keywordSim = keywordCoverage(answer, gold.mustMention);
  const sourceSim = sourceFragmentCoverage(sourceTitles, gold.expectedSourceFragments);
  const penalty = excerptStylePenalty(answer);
  const combined = Math.max(
    0,
    0.35 * toneSim + 0.25 * sectionSim + 0.25 * keywordSim + 0.15 * sourceSim - penalty,
  );
  return {
    toneSim: Number(toneSim.toFixed(3)),
    sectionSim: Number(sectionSim.toFixed(3)),
    keywordSim: Number(keywordSim.toFixed(3)),
    sourceSim: Number(sourceSim.toFixed(3)),
    combined: Number(combined.toFixed(3)),
  };
}

/** Quick lexical overlap against gold must-mention + gold answer tokens. */
export function groundingOverlap(answer: string, gold: CursorGoldCase): number {
  const answerTokens = new Set(tokenize(answer));
  const goldTokens = new Set([
    ...tokenize(gold.goldAnswer),
    ...(gold.mustMention ?? []).flatMap((m) => tokenize(m)),
  ]);
  if (!goldTokens.size) return 1;
  let inter = 0;
  for (const t of goldTokens) if (answerTokens.has(t)) inter += 1;
  return inter / goldTokens.size;
}
