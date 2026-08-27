import { searchWikiPages } from "@/lib/wiki/search";
import { wikiAnchorsForQuery } from "@/lib/wiki/rerank-hits";

import { buildConceptRetrievalPlan } from "./conceptRetrievalPlan";
import { buildRetrievalPlan } from "./retrieval-plan";
import { exclusionPatternsForSlugs } from "./scopes";
import type { MatterEvidenceSet, MatterFrame } from "./types";

/** Legacy path: raw submission drives search (pre–Matter Engine baseline). */
export function retrieveBaseline(submission: string, limit = 8): MatterEvidenceSet {
  const trimmed = submission.replace(/\s+/g, " ").trim();
  const anchors = wikiAnchorsForQuery(trimmed);
  const searchQ =
    anchors.length > 0
      ? [...new Set([...anchors, trimmed.slice(0, 180)])].join(" ").slice(0, 320)
      : trimmed.slice(0, 320);

  const hits = searchWikiPages(searchQ, limit * 2)
    .slice(0, limit)
    .map((h) => ({
      id: h.id,
      title: h.title,
      category: h.category,
      score: h.score,
      intent: "baseline:submission",
    }));

  return { hits, intents: [searchQ.slice(0, 80)], mode: "baseline" };
}

function titleExcluded(title: string, patterns: RegExp[], exclusionLabels: string[]): boolean {
  const t = title.toLowerCase();
  if (patterns.some((p) => p.test(t))) return true;
  if (exclusionLabels.includes("employment") && /employment tribunal|rights at work|working time/.test(t)) {
    return true;
  }
  if (exclusionLabels.includes("used_vehicle") && /used car|repairing a car|problem with a car/.test(t)) {
    return true;
  }
  if (exclusionLabels.includes("travel_agent") && /travel agent/.test(t)) return true;
  if (exclusionLabels.includes("distance_contracts") && /consumer contracts.*regulations|cancel.*online/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Matter-scoped retrieval: event → issue → intent chain; submission only ranks within scope.
 */
export function retrieveForMatter(opts: {
  matterFrame: MatterFrame;
  submission: string;
  limit?: number;
}): MatterEvidenceSet {
  const { matterFrame, submission } = opts;
  const limit = opts.limit ?? 8;
  const primarySlugs = matterFrame.primaryIssues.map((i) => i.slug);
  const { intents, traces } = buildRetrievalPlan(matterFrame, submission);
  const conceptPlan = buildConceptRetrievalPlan(matterFrame, submission);
  const exclusionPatterns = [
    ...exclusionPatternsForSlugs(primarySlugs, submission),
    ...conceptPlan.titleExclusions,
  ];

  const intentTrace = new Map<string, string>();
  for (const t of traces) {
    intentTrace.set(t.intent, `${t.eventId}:${t.issueSlug}`);
  }

  const byId = new Map<string, MatterEvidenceSet["hits"][number]>();

  for (const intent of intents) {
    for (const hit of searchWikiPages(intent, 6)) {
      if (titleExcluded(hit.title, exclusionPatterns, matterFrame.exclusions)) continue;
      const existing = byId.get(hit.id);
      const row = {
        id: hit.id,
        title: hit.title,
        category: hit.category,
        score: hit.score,
        intent,
        trace: intentTrace.get(intent),
      };
      if (!existing || row.score > existing.score) byId.set(hit.id, row);
    }
  }

  const tail = submission.replace(/\s+/g, " ").trim().slice(-220);
  // Belongings / small-claims: skip raw story-tail search — "year old" / "her house" pollute housing & IHT
  const skipTail =
    primarySlugs.includes("consumer_small_claims") ||
    /\b(threw|broke|broken|damaged).{0,80}(switch|console|toy|gift|belongings)\b/i.test(submission);
  if (tail.length >= 40 && !skipTail) {
    for (const hit of searchWikiPages(tail, 4)) {
      if (titleExcluded(hit.title, exclusionPatterns, matterFrame.exclusions)) continue;
      const existing = byId.get(hit.id);
      const row = {
        id: hit.id,
        title: hit.title,
        category: hit.category,
        score: hit.score * 0.85,
        intent: "matter:submission-tail",
        trace: "submission-tail",
      };
      if (!existing || row.score > existing.score) byId.set(hit.id, row);
    }
  }

  const hits = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, limit);

  return { hits, intents, retrievalTraces: traces, mode: "matter-scoped" };
}

export const KnowledgeRetriever = {
  baseline: retrieveBaseline,
  forMatter: retrieveForMatter,
};

/** Map matter-scoped hits into wiki search shape for Overview synthesis. */
export function matterEvidenceToWikiHits(
  hits: MatterEvidenceSet["hits"],
): ReturnType<typeof searchWikiPages> {
  return hits.map((h) => ({
    id: h.id,
    title: h.title,
    category: h.category,
    summary: "",
    keyInformation: [],
    practicalGuidance: [],
    relatedConcepts: [],
    relatedOrganisations: [],
    score: h.score,
  }));
}
