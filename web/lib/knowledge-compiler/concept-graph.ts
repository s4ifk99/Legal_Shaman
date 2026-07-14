import { prisma } from "@/lib/db/prisma";
import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import { getWikiIndex } from "@/lib/wiki/load-index";
import { wikiPagePublicPath } from "@/lib/wiki/public-url";
import type { WikiPageIndex } from "@/lib/wiki/types";

import { areaPathFromWikiPageId, isConsumerWikiPageId, wikiAreaForTaxonomy } from "./taxonomy-map";
import type { ConceptNode, KnowledgeEdgeType } from "./types";

function normalizeLinkTitle(title: string): string {
  return title.trim().toLowerCase();
}

function inferTaxonomyFromPage(page: WikiPageIndex): string | null {
  const hay = `${page.title} ${page.summary} ${page.category} ${page.id}`.toLowerCase();
  let best: { slug: string; score: number } | null = null;
  for (const entry of LEGAL_ISSUE_TAXONOMY) {
    let score = 0;
    if (page.category === wikiAreaForTaxonomy(entry.slug)) score += 3;
    for (const phrase of [...entry.userPhrases, ...entry.aliases, entry.canonicalName]) {
      if (phrase.length >= 4 && hay.includes(phrase.toLowerCase())) score += 1;
    }
    if (entry.slug.replace(/_/g, " ") && hay.includes(entry.slug.replace(/_/g, " "))) {
      score += 2;
    }
    if (!best || score > best.score) best = { slug: entry.slug, score };
  }
  return best && best.score >= 2 ? best.slug : null;
}

function pageToConcept(page: WikiPageIndex, dbRow?: {
  id: string;
  taxonomySlug: string | null;
  summaryText: string | null;
}): ConceptNode {
  return {
    id: dbRow?.id ?? page.id,
    taxonomySlug: dbRow?.taxonomySlug ?? inferTaxonomyFromPage(page),
    wikiPageId: page.id,
    title: page.title,
    areaPath: areaPathFromWikiPageId(page.id),
    summaryText: dbRow?.summaryText ?? page.summary,
    page,
  };
}

export async function loadConceptByWikiPageId(wikiPageId: string): Promise<ConceptNode | null> {
  const index = getWikiIndex();
  const page = index.pages.find((p) => p.id === wikiPageId);
  if (!page) return null;
  try {
    const row = await prisma.knowledgeConcept.findUnique({ where: { wikiPageId } });
    return pageToConcept(page, row ?? undefined);
  } catch {
    return pageToConcept(page);
  }
}

export async function upsertConceptFromPage(page: WikiPageIndex): Promise<ConceptNode> {
  const taxonomySlug = inferTaxonomyFromPage(page);
  const row = await prisma.knowledgeConcept.upsert({
    where: { wikiPageId: page.id },
    create: {
      wikiPageId: page.id,
      title: page.title,
      taxonomySlug,
      areaPath: areaPathFromWikiPageId(page.id),
      summaryText: page.summary?.slice(0, 4000) ?? null,
    },
    update: {
      title: page.title,
      taxonomySlug,
      areaPath: areaPathFromWikiPageId(page.id),
      summaryText: page.summary?.slice(0, 4000) ?? null,
    },
  });
  return pageToConcept(page, row);
}

export async function upsertEdge(
  fromConceptId: string,
  toConceptId: string,
  edgeType: KnowledgeEdgeType,
): Promise<void> {
  if (fromConceptId === toConceptId) return;
  await prisma.knowledgeEdge.upsert({
    where: {
      fromConceptId_toConceptId_edgeType: {
        fromConceptId,
        toConceptId,
        edgeType,
      },
    },
    create: { fromConceptId, toConceptId, edgeType },
    update: {},
  });
}

function resolveRelatedPageId(title: string, pages: WikiPageIndex[]): string | null {
  const norm = normalizeLinkTitle(title);
  const exact = pages.find((p) => normalizeLinkTitle(p.title) === norm);
  if (exact) return exact.id;
  const partial = pages.find(
    (p) => normalizeLinkTitle(p.title).includes(norm) || norm.includes(normalizeLinkTitle(p.title)),
  );
  return partial?.id ?? null;
}

export async function backfillConceptGraphFromWikiIndex(opts?: {
  limit?: number;
  onProgress?: (progress: {
    phase: "concepts" | "edges";
    done: number;
    total: number;
    conceptsUpserted: number;
    claimsCreated: number;
    edgesCreated: number;
  }) => void;
}): Promise<{
  conceptsUpserted: number;
  claimsCreated: number;
  edgesCreated: number;
}> {
  const index = getWikiIndex();
  const areasPages = index.pages.filter((p) => isConsumerWikiPageId(p.id));
  const limit = opts?.limit ?? areasPages.length;
  const pages = areasPages.slice(0, limit);
  const reportProgress = (phase: "concepts" | "edges", done: number) => {
    opts?.onProgress?.({
      phase,
      done,
      total: pages.length,
      conceptsUpserted,
      claimsCreated,
      edgesCreated,
    });
  };

  const titleToConceptId = new Map<string, string>();
  let conceptsUpserted = 0;
  let claimsCreated = 0;
  let edgesCreated = 0;

  reportProgress("concepts", 0);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const concept = await upsertConceptFromPage(page);
    titleToConceptId.set(normalizeLinkTitle(page.title), concept.id);
    conceptsUpserted += 1;

    const existingClaims = await prisma.knowledgeClaim.count({ where: { conceptId: concept.id } });
    if (existingClaims === 0) {
      const bullets = [
        ...page.keyInformation,
        ...page.practicalGuidance,
      ].filter((b) => b.trim().length >= 10);

      for (const bullet of bullets.slice(0, 12)) {
        await prisma.knowledgeClaim.create({
          data: {
            conceptId: concept.id,
            claimText: bullet.slice(0, 2000),
            sectionTarget: page.keyInformation.includes(bullet) ? "Key Information" : "Practical Guidance",
            sourceUrl: wikiPagePublicPath(page.id),
          },
        });
        claimsCreated += 1;
      }

      if (page.summary?.trim()) {
        await prisma.knowledgeClaim.create({
          data: {
            conceptId: concept.id,
            claimText: page.summary.slice(0, 2000),
            sectionTarget: "Summary",
            sourceUrl: wikiPagePublicPath(page.id),
          },
        });
        claimsCreated += 1;
      }
    }

    if (i === 0 || (i + 1) % 10 === 0 || i + 1 === pages.length) {
      reportProgress("concepts", i + 1);
    }
  }

  reportProgress("edges", 0);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const from = await prisma.knowledgeConcept.findUnique({ where: { wikiPageId: page.id } });
    if (!from) continue;

    for (const relatedTitle of page.relatedConcepts) {
      const targetId = resolveRelatedPageId(relatedTitle, pages);
      if (!targetId) continue;
      const to = await prisma.knowledgeConcept.findUnique({ where: { wikiPageId: targetId } });
      if (!to) continue;
      await upsertEdge(from.id, to.id, "related");
      edgesCreated += 1;
    }

    const areaPath = areaPathFromWikiPageId(page.id);
    if (areaPath) {
      const indexPage = pages.find((p) => p.id === `${areaPath}/_index`);
      if (indexPage) {
        const parent = await prisma.knowledgeConcept.findUnique({
          where: { wikiPageId: indexPage.id },
        });
        if (parent) {
          await upsertEdge(parent.id, from.id, "parent_area");
          edgesCreated += 1;
        }
      }
    }

    if (i === 0 || (i + 1) % 10 === 0 || i + 1 === pages.length) {
      reportProgress("edges", i + 1);
    }
  }

  const subIssueEdges = await seedSubIssueEdges(pages);
  edgesCreated += subIssueEdges;

  return { conceptsUpserted, claimsCreated, edgesCreated };
}

function pageHaystackForSeed(page: WikiPageIndex): string {
  return `${page.title} ${page.summary} ${page.id}`.toLowerCase();
}

/** Link area index concepts to sub-issue pages from taxonomy seeds. */
export async function seedSubIssueEdges(pages: WikiPageIndex[]): Promise<number> {
  let edgesCreated = 0;

  for (const entry of LEGAL_ISSUE_TAXONOMY) {
    const area = wikiAreaForTaxonomy(entry.slug);
    if (!area) continue;

    const areaIndexPage = pages.find((p) => p.id === `Areas/${area}/_index`);
    if (!areaIndexPage) continue;

    const areaConcept = await prisma.knowledgeConcept.findUnique({
      where: { wikiPageId: areaIndexPage.id },
    });
    if (!areaConcept) continue;

    const areaPages = pages.filter(
      (p) => p.category === area && !p.id.endsWith("/_index"),
    );

    for (const subIssue of entry.subIssues ?? []) {
      const subNorm = subIssue.toLowerCase();
      const tokens = subNorm.split(/\W+/).filter((t) => t.length >= 4);

      let bestPage: WikiPageIndex | null = null;
      let bestScore = 0;
      for (const page of areaPages) {
        const hay = pageHaystackForSeed(page);
        let score = 0;
        if (hay.includes(subNorm)) score += 5;
        for (const t of tokens) {
          if (hay.includes(t)) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestPage = page;
        }
      }

      if (!bestPage || bestScore < 3) continue;

      const to = await prisma.knowledgeConcept.findUnique({
        where: { wikiPageId: bestPage.id },
      });
      if (!to) continue;

      await upsertEdge(areaConcept.id, to.id, "sub_issue");
      edgesCreated += 1;
    }
  }

  return edgesCreated;
}

export async function bfsConceptCluster(
  startConceptId: string,
  maxDepth = 2,
  maxNodes = 8,
): Promise<ConceptNode[]> {
  const visited = new Set<string>();
  const result: ConceptNode[] = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: startConceptId, depth: 0 }];

  while (queue.length && result.length < maxNodes) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const row = await prisma.knowledgeConcept.findUnique({ where: { id } });
    if (!row) continue;

    const index = getWikiIndex();
    const page = index.pages.find((p) => p.id === row.wikiPageId);
    if (!page) continue;

    result.push(pageToConcept(page, row));
    if (depth >= maxDepth) continue;

    const edges = await prisma.knowledgeEdge.findMany({
      where: { fromConceptId: id },
      take: 12,
    });
    for (const edge of edges) {
      if (!visited.has(edge.toConceptId)) {
        queue.push({ id: edge.toConceptId, depth: depth + 1 });
      }
    }
  }

  return result;
}

export async function listPendingContradictions(limit = 50) {
  return prisma.knowledgeContradiction.findMany({
    where: { status: "pending" },
    include: {
      claimA: { include: { concept: true } },
      claimB: { include: { concept: true } },
    },
    orderBy: { detectedAt: "desc" },
    take: limit,
  });
}

export async function resolveContradiction(
  id: string,
  status: "resolved" | "ignored",
): Promise<void> {
  await prisma.knowledgeContradiction.update({
    where: { id },
    data: { status, resolvedAt: new Date() },
  });
}
