/** Map taxonomy slugs to consumer wiki Areas/ folder names. */
export const TAXONOMY_TO_WIKI_AREA: Record<string, string> = {
  employment: "Work and Employment",
  housing: "Home and Housing",
  family: "Family and Relationships",
  immigration: "Immigration and Citizenship",
  debt: "Money Benefits and Debt",
  welfare_benefits: "Money Benefits and Debt",
  consumer: "Consumer Rights",
  consumer_small_claims: "Courts and Disputes",
  criminal_defence: "Crime and Police",
  personal_injury: "Health and Injury",
  prison_law: "Crime and Police",
  neighbour_dispute: "Neighbours and Property",
  conveyancing: "Home and Housing",
};

export function wikiAreaForTaxonomy(slug: string | undefined): string | null {
  if (!slug) return null;
  if (TAXONOMY_TO_WIKI_AREA[slug]) return TAXONOMY_TO_WIKI_AREA[slug]!;
  // consumer_services → Consumer Rights, etc.
  if (slug.startsWith("consumer")) return "Consumer Rights";
  return null;
}

export function isConsumerWikiPageId(wikiPageId: string): boolean {
  return wikiPageId.startsWith("Areas/") && !wikiPageId.includes("_quarantine");
}

export function areaPathFromWikiPageId(wikiPageId: string): string | null {
  if (!isConsumerWikiPageId(wikiPageId)) return null;
  const parts = wikiPageId.split("/");
  if (parts.length < 2) return null;
  return parts.slice(0, 2).join("/");
}
