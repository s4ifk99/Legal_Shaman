import { prisma } from "@/lib/db/prisma";
import { sanitizeAdviceText } from "@/lib/guardrails/validator";
import { cleanChunkForProse, cleanWikiMarkup } from "@/lib/legal-knowledge/clean-prose";
import type { LegalSearchContext } from "@/lib/legal-knowledge/search-context";
import type { LegalSearchIntent } from "@/lib/legal-knowledge/search-intent";
import { wikiPagePublicUrl } from "@/lib/wiki/public-url";
import type { WikiPageIndex } from "@/lib/wiki/types";

import { bfsConceptCluster, loadConceptByWikiPageId } from "./concept-graph";
import { isKnowledgeGraphDbReady } from "./db-ready";
import {
  conceptNodeFromPage,
  isConsumerIntent,
  pageMatchesIntent,
  queryPageTokenOverlap,
  resolvePrimaryPageFromIndex,
} from "./page-index";
import { wikiAreaForTaxonomy } from "./taxonomy-map";
import type { ConceptCluster, GraphAssemblyResult } from "./types";

function dedupeBullets(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const cleaned = cleanWikiMarkup(item);
    const key = cleaned.trim().toLowerCase().slice(0, 120);
    if (!key || key.length < 20 || seen.has(key)) continue;
    if (/\b(cite the source|raw file path|Answers should)\b/i.test(cleaned)) continue;
    seen.add(key);
    out.push(cleaned.trim());
  }
  return out;
}

function bulletsToProse(bullets: string[], max = 4): string {
  const slice = bullets.slice(0, max);
  if (!slice.length) return "";
  return slice
    .map((b) => cleanChunkForProse(b.replace(/^[-*]\s*/, "").trim(), 1))
    .filter((b) => b.length >= 20)
    .join(" ");
}

function pageToSourceHit(page: WikiPageIndex, rank: number): GraphAssemblyResult["sources"][number] {
  const url = wikiPagePublicUrl(page.id);
  const snippetRaw = page.summary || page.keyInformation[0] || "";
  return {
    title: page.title,
    url,
    source: "Legal Shaman Wiki",
    snippet: cleanChunkForProse(snippetRaw, 1).slice(0, 240),
    score: Math.max(0.5, 1 - (rank - 1) * 0.08),
  };
}

function assembleProse(
  primary: WikiPageIndex,
  clusterPages: WikiPageIndex[],
  intent: LegalSearchIntent,
): string {
  const paragraphs: string[] = [];
  const topic =
    intent.specificIssue ||
    intent.canonicalName ||
    primary.title.replace(/^Areas\//, "").split("/").pop() ||
    "this legal topic";

  paragraphs.push(
    `Here is plain-language guidance on ${topic.toLowerCase()}. This is general signposting from trusted UK sources — not legal advice.`,
  );

  const summary = cleanChunkForProse(primary.summary ?? "", 2);
  if (summary.length >= 40) {
    paragraphs.push(summary);
  }

  const keyInfo = dedupeBullets(clusterPages.flatMap((p) => p.keyInformation));
  const keyProse = bulletsToProse(keyInfo, 3);
  if (keyProse) paragraphs.push(keyProse);

  const guidance = dedupeBullets(clusterPages.flatMap((p) => p.practicalGuidance));
  const guideProse = bulletsToProse(guidance, 3);
  if (guideProse) {
    paragraphs.push(`Practical next steps often include: ${guideProse}`);
  }

  const related = clusterPages
    .filter((p) => p.id !== primary.id)
    .slice(0, 3)
    .map((p) => p.title.replace(/^Areas\/[^/]+\//, "").trim())
    .filter(Boolean);
  if (related.length) {
    paragraphs.push(
      `Related wiki topics: ${related.join("; ")}. Check the sources below, or speak with a qualified solicitor about your situation.`,
    );
  } else {
    paragraphs.push(
      "Verify important details with the cited sources or a qualified solicitor. Outcomes depend on your circumstances.",
    );
  }

  return sanitizeAdviceText(
    paragraphs
      .map((p) => cleanWikiMarkup(p))
      .filter((p) => p.length >= 20)
      .slice(0, 5)
      .join("\n\n"),
  );
}

function scoreGraphConfidence(
  cluster: ConceptCluster,
  intent: LegalSearchIntent,
  query: string,
): number {
  let score = 0.28;
  const page = cluster.primary.page;
  const overlap = page ? queryPageTokenOverlap(query, page) : 0;
  const area = wikiAreaForTaxonomy(intent.taxonomySlug ?? "");
  const taxonomyMatch =
    Boolean(area && page?.category === area) ||
    Boolean(intent.taxonomySlug && cluster.primary.taxonomySlug === intent.taxonomySlug);

  if (taxonomyMatch) score += 0.18;
  if (intent.taxonomySlug && cluster.primary.taxonomySlug === intent.taxonomySlug) score += 0.08;
  if (overlap >= 0.25) score += 0.16;
  else if (overlap >= 0.15) score += 0.08;
  else score -= 0.18;

  if (intent.specificIssue) score += 0.08;
  if (cluster.related.length >= 1) score += 0.08;
  if (page?.summary && page.summary.length > 80) score += 0.08;
  if (intent.confidence === "high") score += 0.04;

  // High-band scores require both taxonomy match and real query overlap.
  if (score >= 0.6 && !(taxonomyMatch && overlap >= 0.2)) {
    score = Math.min(score, 0.55);
  }

  return Math.max(0, Math.min(0.92, score));
}

export async function resolveConceptCluster(
  intent: LegalSearchIntent,
  query: string,
): Promise<ConceptCluster | null> {
  const primaryPage = await resolvePrimaryPageFromIndex(intent, query);
  if (!primaryPage || !pageMatchesIntent(primaryPage, intent)) return null;

  let dbConcept: { id: string } | null = null;
  if (await isKnowledgeGraphDbReady()) {
    dbConcept = await prisma.knowledgeConcept.findUnique({
      where: { wikiPageId: primaryPage.id },
      select: { id: true },
    });
  }

  const primary = dbConcept
    ? {
        ...(await loadConceptByWikiPageId(primaryPage.id))!,
        page: primaryPage,
      }
    : conceptNodeFromPage(primaryPage, dbConcept?.id);

  let related: ConceptCluster["related"] = [];
  if (dbConcept) {
    try {
      const bfs = await bfsConceptCluster(dbConcept.id, 2, 6);
      related = bfs
        .filter((n) => n.wikiPageId !== primaryPage.id)
        .filter((n) => n.page && pageMatchesIntent(n.page, intent));
    } catch {
      related = [];
    }
  }

  if (!related.length) {
    const { getWikiIndex } = await import("@/lib/wiki/load-index");
    const index = getWikiIndex();
    for (const title of primaryPage.relatedConcepts.slice(0, 5)) {
      const norm = title.trim().toLowerCase();
      const page = index.pages.find(
        (p) =>
          p.title.trim().toLowerCase() === norm ||
          p.title.trim().toLowerCase().includes(norm),
      );
      if (page && pageMatchesIntent(page, intent)) {
        related.push(conceptNodeFromPage(page));
      }
    }
  }

  return { primary, related, depth: related.length ? 2 : 0 };
}

export async function assembleFromKnowledgeGraph(
  context: LegalSearchContext,
  intent: LegalSearchIntent,
): Promise<GraphAssemblyResult | null> {
  if (!isConsumerIntent(intent)) return null;

  const cluster = await resolveConceptCluster(intent, context.query);
  if (!cluster?.primary.page) return null;

  const primary = cluster.primary.page;
  if (queryPageTokenOverlap(context.query, primary) < 0.12) return null;
  const relatedPages = cluster.related
    .map((n) => n.page)
    .filter((p): p is WikiPageIndex => Boolean(p));

  const clusterPages = [primary, ...relatedPages];
  const answer = assembleProse(primary, clusterPages, intent);

  const sources = clusterPages.slice(0, 6).map((p, i) => pageToSourceHit(p, i + 1));

  const pendingConflicts = await dbConceptHasPendingContradictions(cluster.primary.id);

  let confidence = scoreGraphConfidence(cluster, intent, context.query);
  if (pendingConflicts) confidence = Math.min(confidence, 0.35);

  const clarifyingQuestion =
    confidence < 0.58 && intent.canonicalName
      ? `This looks like a ${intent.canonicalName} issue${intent.specificIssue ? ` (${intent.specificIssue})` : ""}. Can you share a few more details about your situation?`
      : null;

  return {
    answer,
    sources,
    confidence,
    conceptCluster: cluster,
    clarifyingQuestion,
  };
}

async function dbConceptHasPendingContradictions(conceptIdOrWikiId: string): Promise<boolean> {
  if (!(await isKnowledgeGraphDbReady())) return false;
  let conceptId = conceptIdOrWikiId;
  const byWiki = await prisma.knowledgeConcept.findUnique({
    where: { wikiPageId: conceptIdOrWikiId },
  });
  if (byWiki) conceptId = byWiki.id;

  const count = await prisma.knowledgeContradiction.count({
    where: {
      status: "pending",
      OR: [{ claimA: { conceptId } }, { claimB: { conceptId } }],
    },
  });
  return count > 0;
}

export function graphAssemblySourcesWithCitations(
  answer: string,
  sources: GraphAssemblyResult["sources"],
): string {
  if (!sources.length) return answer;
  const cited = sources
    .slice(0, 4)
    .map((s, i) => `[${i + 1}]`)
    .join(" ");
  if (/\[\d+\]/.test(answer)) return answer;
  return `${answer}\n\nSources: ${cited}`;
}
