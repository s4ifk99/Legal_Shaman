import { getWikiIndex } from "@/lib/wiki/load-index";

import type { MatchedClaim } from "./match-concepts";
import type { ExtractedSource, MergeAction } from "./types";
import { wikiAreaForTaxonomy } from "./taxonomy-map";

export function buildMergePlan(
  extracted: ExtractedSource,
  matched: MatchedClaim[],
): MergeAction[] {
  const actions: MergeAction[] = [];
  const byPage = new Map<string, MatchedClaim[]>();

  for (const claim of matched) {
    if (claim.wikiPageId) {
      const list = byPage.get(claim.wikiPageId) ?? [];
      list.push(claim);
      byPage.set(claim.wikiPageId, list);
    }
  }

  for (const [wikiPageId, claims] of byPage) {
    const bySection = new Map<string, string[]>();
    for (const c of claims) {
      const section = c.sectionTarget ?? "Key Information";
      const list = bySection.get(section) ?? [];
      list.push(c.claimText);
      bySection.set(section, list);
    }
    for (const [section, bullets] of bySection) {
      actions.push({ type: "update_section", wikiPageId, section, bullets });
    }
  }

  for (const concept of extracted.concepts) {
    const hasPage = matched.some(
      (m) => m.conceptHint?.toLowerCase() === concept.title.toLowerCase() && m.wikiPageId,
    );
    if (hasPage) continue;
    const area = wikiAreaForTaxonomy(concept.taxonomySlug ?? "");
    if (!area) continue;
    actions.push({
      type: "create_page",
      areaPath: `Areas/${area}`,
      title: concept.title,
      sections: {
        Summary: [`Overview of ${concept.title}.`],
        "Key Information": matched
          .filter((m) => !m.wikiPageId)
          .slice(0, 4)
          .map((m) => m.claimText),
        "Practical Guidance": [],
        "Related Concepts": [],
        "Related Organisations": extracted.organisations.map((o) => `[[${o}]]`),
        Sources: extracted.sources,
      },
    });
  }

  for (const src of extracted.sources) {
    for (const wikiPageId of byPage.keys()) {
      actions.push({ type: "append_source", wikiPageId, sourceUrl: src });
    }
  }

  const index = getWikiIndex();
  const linkedPairs = new Set<string>();
  const pageIds = [...byPage.keys()];
  for (let i = 0; i < pageIds.length; i++) {
    for (let j = i + 1; j < pageIds.length; j++) {
      const fromId = pageIds[i]!;
      const toId = pageIds[j]!;
      const pairKey = [fromId, toId].sort().join("|");
      if (linkedPairs.has(pairKey)) continue;
      linkedPairs.add(pairKey);

      const fromPage = index.pages.find((p) => p.id === fromId);
      const toPage = index.pages.find((p) => p.id === toId);
      if (fromPage && toPage) {
        actions.push({ type: "add_wikilink", fromWikiPageId: fromId, toTitle: toPage.title });
        actions.push({ type: "add_wikilink", fromWikiPageId: toId, toTitle: fromPage.title });
      }
    }
  }

  for (const concept of extracted.concepts) {
    const matchedPage = matched.find(
      (m) =>
        m.wikiPageId &&
        m.conceptHint?.toLowerCase().includes(concept.title.toLowerCase().slice(0, 12)),
    );
    if (!matchedPage?.wikiPageId) continue;
    for (const other of matched) {
      if (!other.wikiPageId || other.wikiPageId === matchedPage.wikiPageId) continue;
      const otherPage = index.pages.find((p) => p.id === other.wikiPageId);
      if (!otherPage) continue;
      const pairKey = [matchedPage.wikiPageId, other.wikiPageId].sort().join("|");
      if (linkedPairs.has(pairKey)) continue;
      linkedPairs.add(pairKey);
      actions.push({
        type: "add_wikilink",
        fromWikiPageId: matchedPage.wikiPageId,
        toTitle: otherPage.title,
      });
    }
  }

  return actions;
}
