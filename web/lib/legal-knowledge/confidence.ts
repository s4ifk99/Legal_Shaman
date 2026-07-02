import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";

import type { IssueClassification, RetrievedChunk } from "./types";

export type ConfidenceInput = {
  query: string;
  chunks: RetrievedChunk[];
  classification: IssueClassification;
};

export type ConfidenceResult = {
  score: number;
  level: "high" | "medium" | "low";
  reasons: string[];
  clarifyingQuestion: string | null;
};

const LOW_THRESHOLD = 0.38;
const HIGH_THRESHOLD = 0.68;

export function scoreRetrievalConfidence(input: ConfidenceInput): ConfidenceResult {
  const { query, chunks, classification } = input;
  const reasons: string[] = [];
  let score = 0;

  const resolution = resolveLegalIssueFromQuery(query);
  const taxonomyMatch = resolution?.matchStrength ?? 0;

  if (chunks.length === 0) {
    return {
      score: 0.08,
      level: "low",
      reasons: ["No matching legal guidance chunks were found."],
      clarifyingQuestion:
        resolution?.clarificationQuestion ??
        "Can you say which area this relates to — for example employment, housing, family, immigration, or debt?",
    };
  }

  const top = chunks[0]!;
  const topThree = chunks.slice(0, 3);
  const avgTopScore =
    topThree.reduce((sum, c) => sum + c.finalScore, 0) / Math.max(topThree.length, 1);
  const authoritativeCount = chunks.filter((c) => c.authorityScore >= 0.85).length;
  const freshCount = chunks.filter((c) => c.freshnessScore >= 0.8).length;

  score += Math.min(0.35, avgTopScore * 0.4);
  score += Math.min(0.2, taxonomyMatch * 0.55);
  score += Math.min(0.2, authoritativeCount * 0.08);
  score += Math.min(0.1, freshCount * 0.04);
  score += Math.min(0.1, top.phraseScore * 0.25);
  score += Math.min(0.05, top.vectorScore * 0.12);

  if (top.finalScore >= 0.55) {
    reasons.push("Strong match to retrieved legal guidance.");
  } else if (top.finalScore >= 0.35) {
    reasons.push("Moderate match — sources may be partially relevant.");
  } else {
    reasons.push("Weak match — retrieved pages may not directly answer the issue.");
    score -= 0.12;
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

  score = Math.max(0, Math.min(1, score));

  let level: ConfidenceResult["level"] = "low";
  if (score >= HIGH_THRESHOLD) level = "high";
  else if (score >= LOW_THRESHOLD) level = "medium";

  let clarifyingQuestion: string | null = null;
  if (level === "low") {
    clarifyingQuestion =
      resolution?.clarificationQuestion ??
      (classification.subArea
        ? `To narrow this down, is your ${classification.area.toLowerCase()} issue about court action, a letter you received, or getting advice before you act?`
        : "Which type of legal problem is this — work, home, family, immigration, benefits, or something else?");
  }

  return { score, level, reasons, clarifyingQuestion };
}
