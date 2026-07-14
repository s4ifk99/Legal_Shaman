import { prisma } from "@/lib/db/prisma";
import type { LegalSearchContext } from "@/lib/legal-knowledge/search-context";
import type { LegalSearchIntent } from "@/lib/legal-knowledge/search-intent";
import { wikiPagePublicPath, wikiPagePublicUrl } from "@/lib/wiki/public-url";
import type { WikiPageIndex } from "@/lib/wiki/types";

import { bfsConceptCluster, loadConceptByWikiPageId } from "./concept-graph";
import { isKnowledgeGraphDbReady } from "./db-ready";
import {
  conceptNodeFromPage,
  isConsumerIntent,
  pageMatchesIntent,
  resolvePrimaryPageFromIndex,
} from "./page-index";
import type { ConceptCluster, GraphAssemblyResult } from "./types";

function dedupeBullets(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase().slice(0, 120);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

function bulletsToProse(bullets: string[], max = 4): string {
  const slice = bullets.slice(0, max);
  if (!slice.length) return "";
  return slice.map((b) => b.replace(/^[-*]\s*/, "").trim()).join(" ");
}

function pageToSourceHit(page: WikiPageIndex, rank: number): GraphAssemblyResult["sources"][number] {
  const url = wikiPagePublicUrl(page.id);
  return {
    title: page.title,
    url,
    source: "Legal Shaman Wiki",
    snippet: page.summary.slice(0, 240) || page.keyInformation[0]?.slice(0, 240) || "",
    score: Math.max(0.5, 1 - (rank - 1) * 0.08),
  };
}

function assembleProse(
  primary: WikiPageIndex,
  clusterPages: WikiPageIndex[],
): string {
  const paragraphs: string[] = [];

  if (primary.summary?.trim()) {
    paragraphs.push(primary.summary.trim());
  }

  const keyInfo = dedupeBullets(
    clusterPages.flatMap((p) => p.keyInformation),
  );
  const keyProse = bulletsToProse(keyInfo);
  if (keyProse) paragraphs.push(keyProse);

  const guidance = dedupeBullets(
    clusterPages.flatMap((p) => p.practicalGuidance),
  );
  const guideProse = bulletsToProse(guidance);
  if (guideProse) paragraphs.push(guideProse);

  const related = clusterPages
    .filter((p) => p.id !== primary.id)
    .slice(0, 3)
    .map((p) => p.title);
  if (related.length) {
    paragraphs.push(
      `Related topics covered in the wiki include: ${related.join(", ")}. These points are general signposting only — not legal advice.`,
    );
  } else {
    paragraphs.push(
      "These points are general signposting only — not legal advice. Verify important details with the cited wiki pages or a qualified adviser.",
    );
  }

  return paragraphs.slice(0, 4).join("\n\n");
}

function scoreGraphConfidence(cluster: ConceptCluster, intent: LegalSearchIntent): number {
  let score = 0.45;
  if (intent.taxonomySlug && cluster.primary.taxonomySlug === intent.taxonomySlug) score += 0.2;
  if (intent.specificIssue) score += 0.1;
  if (cluster.related.length >= 1) score += 0.1;
  if (cluster.primary.page?.summary && cluster.primary.page.summary.length > 80) score += 0.1;
  if (intent.confidence === "high") score += 0.05;
  return Math.min(0.92, score);
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
  const relatedPages = cluster.related
    .map((n) => n.page)
    .filter((p): p is WikiPageIndex => Boolean(p));

  const clusterPages = [primary, ...relatedPages];
  const answer = assembleProse(primary, clusterPages);

  const sources = clusterPages.slice(0, 6).map((p, i) => pageToSourceHit(p, i + 1));

  const pendingConflicts = await dbConceptHasPendingContradictions(cluster.primary.id);

  let confidence = scoreGraphConfidence(cluster, intent);
  if (pendingConflicts) confidence = Math.min(confidence, 0.35);

  const clarifyingQuestion =
    confidence < 0.5 && intent.canonicalName
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
