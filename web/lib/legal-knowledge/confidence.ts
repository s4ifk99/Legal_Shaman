import type { LegalSearchIntent } from "./search-intent";
import type { IssueClassification, RetrievedChunk } from "./types";

export type ConfidenceInput = {
  query: string;
  chunks: RetrievedChunk[];
  classification: IssueClassification;
  intent?: LegalSearchIntent;
};

export type ConfidenceResult = {
  score: number;
  level: "high" | "medium" | "low";
  reasons: string[];
  clarifyingQuestion: string | null;
};

const LOW_THRESHOLD = 0.38;
const HIGH_THRESHOLD = 0.68;

/** How many of the top-3 chunks agree with intent topic terms (0–3). */
export function sourceIntentAgreementCount(
  chunks: RetrievedChunk[],
  intent?: LegalSearchIntent,
): number {
  const terms = intent?.requiredTopicTerms ?? [];
  if (!terms.length || !chunks.length) return 0;
  let agree = 0;
  for (const c of chunks.slice(0, 3)) {
    const blob = `${c.title} ${c.heading ?? ""} ${c.chunkText}`.toLowerCase();
    if (terms.some((t) => blob.includes(t.toLowerCase()))) agree += 1;
  }
  return agree;
}

function isGeneralClassification(classification: IssueClassification): boolean {
  return (
    classification.area.toLowerCase() === "general" ||
    !classification.subArea?.trim()
  );
}

function firmPagesDominateTop3(chunks: RetrievedChunk[]): boolean {
  const top3 = chunks.slice(0, 3);
  if (!top3.length) return false;
  const firmHits = top3.filter((c) => {
    const blob = `${c.sourceUrl} ${c.title}`.toLowerCase();
    return (
      blob.includes("directory/firms") ||
      blob.includes("/firms/") ||
      blob.includes("wiki/directory")
    );
  }).length;
  return firmHits >= 2;
}

export function scoreRetrievalConfidence(input: ConfidenceInput): ConfidenceResult {
  const { chunks, classification, intent } = input;
  const reasons: string[] = [];
  let score = 0;

  const taxonomyMatch =
    intent?.confidence === "high" ? 0.55 : intent?.confidence === "medium" ? 0.3 : 0.1;
  const isGeneral = isGeneralClassification(classification);

  if (chunks.length === 0) {
    return {
      score: intent?.confidence === "high" ? 0.25 : 0.08,
      level: intent?.confidence === "high" ? "medium" : "low",
      reasons: ["No matching legal guidance chunks were found."],
      clarifyingQuestion:
        intent?.specificIssue
          ? `We identified this as ${intent.canonicalName} (${intent.specificIssue}) but could not retrieve matching guidance pages yet.`
          : "Can you say which area this relates to — for example employment, housing, family, immigration, or debt?",
    };
  }

  const onTopicChunks = intent?.requiredTopicTerms.length
    ? chunks.filter((c) => {
        const blob = `${c.title} ${c.sourceUrl} ${c.chunkText}`.toLowerCase();
        return intent.requiredTopicTerms.some((t) => blob.includes(t.toLowerCase()));
      })
    : chunks;

  const top = onTopicChunks[0] ?? chunks[0]!;
  const topThree = (onTopicChunks.length ? onTopicChunks : chunks).slice(0, 3);
  const avgTopScore =
    topThree.reduce((sum, c) => sum + c.finalScore, 0) / Math.max(topThree.length, 1);
  const authoritativeCount = chunks.filter((c) => c.authorityScore >= 0.85).length;
  const freshCount = chunks.filter((c) => c.freshnessScore >= 0.8).length;
  const agreement = sourceIntentAgreementCount(chunks, intent);

  score += Math.min(0.35, avgTopScore * 0.4);
  score += Math.min(0.2, taxonomyMatch * 0.55);
  score += Math.min(0.2, authoritativeCount * 0.08);
  score += Math.min(0.1, freshCount * 0.04);
  score += Math.min(0.1, top.phraseScore * 0.25);
  score += Math.min(0.05, top.vectorScore * 0.12);

  if (intent?.confidence === "high") {
    score += 0.12;
    reasons.push(`Issue identified as ${intent.canonicalName ?? intent.taxonomySlug}.`);
  }

  if (onTopicChunks.length === 0 && intent?.requiredTopicTerms.length) {
    score -= 0.15;
    reasons.push("Retrieved pages do not match the identified issue area.");
  }

  if (top.finalScore >= 0.55) {
    reasons.push("Strong match to retrieved legal guidance.");
  } else if (top.finalScore >= 0.35) {
    reasons.push("Moderate match — sources may be partially relevant.");
  } else {
    reasons.push("Weak match — retrieved pages may not directly answer the issue.");
    score -= 0.2;
  }

  if (authoritativeCount >= 2) {
    reasons.push("Multiple authoritative UK sources support the result.");
  } else if (authoritativeCount === 0) {
    reasons.push("No highly authoritative official source in the top results.");
    score -= 0.1;
  }

  const domains = new Set(chunks.map((c) => c.domain));
  if (domains.size >= 4 && avgTopScore < 0.45) {
    reasons.push("Results span many sources with mixed relevance.");
    score -= 0.08;
  }

  if (classification.urgency === "emergency" && authoritativeCount === 0) {
    score -= 0.1;
    reasons.push("Urgent issue but no strong official emergency guidance retrieved.");
  }

  if (firmPagesDominateTop3(chunks)) {
    score -= 0.15;
    reasons.push("Top results are dominated by firm directory pages rather than guidance.");
  }

  if (intent?.requiredTopicTerms.length && agreement < 2) {
    score = Math.min(score, 0.55);
    reasons.push("Fewer than two of the top sources clearly match the identified topic.");
  }

  if (isGeneral) {
    score = Math.min(score, 0.5);
    reasons.push("Issue area is general or unspecified — confidence capped.");
  }

  score = Math.max(0, Math.min(1, score));

  let level: ConfidenceResult["level"] = "low";
  if (score >= HIGH_THRESHOLD) level = "high";
  else if (score >= LOW_THRESHOLD) level = "medium";

  const weakAgreement = Boolean(intent?.requiredTopicTerms.length && agreement < 2);
  const shouldClarify = level === "low" || (level === "medium" && (weakAgreement || isGeneral));

  let clarifyingQuestion: string | null = null;
  if (shouldClarify) {
    clarifyingQuestion =
      intent?.specificIssue && intent.canonicalName
        ? `We think this is ${intent.canonicalName} (${intent.specificIssue}). Can you confirm, or say if it is about court action, a letter you received, or getting advice before you act?`
        : classification.subArea && !isGeneral
          ? `To narrow this down, is your ${classification.area.toLowerCase()} issue about court action, a letter you received, or getting advice before you act?`
          : "Which type of legal problem is this — work, home, family, immigration, benefits, or something else?";
  }

  return { score, level, reasons, clarifyingQuestion };
}
